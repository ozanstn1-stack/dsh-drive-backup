/**
 * `backup_transfer`: the approved transfer tool.
 *
 * A dry run is read-only and needs no approval. A real transfer is destructive
 * for `sync` targets (it deletes remote files), so it always goes through the
 * approval gate and leaves one audit line.
 * @module dsh-drive-backup/tools/run
 */

import { stat } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendAudit } from '../lib/audit.js'
import { authorizeDestructive } from '../lib/gate.js'
import { destinationFor, transferArgs } from '../lib/rclone.js'
import { describeFailure, runCommand, throwIfAborted } from '../lib/run.js'
import { describeTargets, findTarget } from '../lib/targets.js'
import { textOutput, textResult } from '../lib/tooling.js'

/**
 * Build the approved `backup_transfer` tool.
 * @param {object} deps - dependencies.
 * @param {object} deps.ctx - plugin context (approval seam).
 * @param {object} deps.config - normalized config.
 * @param {Function} [deps.run] - command runner (injectable for tests).
 * @returns {object} tool definition.
 */
export function createBackupRunTool({ ctx, config, run = runCommand }) {
  return defineTool({
    name: 'backup_transfer',
    description: `Run one configured rclone transfer. \`dryRun: true\` only reports what would move and needs no approval; a real transfer asks the user for approval first and records one audit line. Targets in \`sync\` mode delete remote files that are gone locally; \`copy\` never deletes. Configured: ${describeTargets(config.targets)}.`,
    parameters: {
      id: { type: 'string', required: true, description: `Configured target id or label. Configured: ${describeTargets(config.targets)}.` },
      dryRun: { type: 'boolean', description: 'Only report the planned transfer; nothing is uploaded or deleted.' },
    },
    output: textOutput(),
    timeoutMs: 3600000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const target = findTarget(config.targets, args.id)
      if (target === undefined) {
        throw new Error(`Unknown backup target ${JSON.stringify(String(args.id ?? ''))}. Configured: ${describeTargets(config.targets)}. Nothing was transferred.`)
      }
      try {
        await stat(target.local)
      } catch {
        throw new Error(`Local path does not exist or is not readable: ${target.local}. Nothing was transferred.`)
      }

      const destination = destinationFor(config.remote, target.remotePath)
      const dryRun = args.dryRun === true
      const argv = transferArgs(target.mode, target.local, destination, {
        dryRun,
        excludes: target.excludes,
        transfers: target.transfers,
      })

      let approval = 'not-required'
      if (!dryRun) {
        const operation = `${target.mode} ${target.local} → ${destination}`
        const gate = await authorizeDestructive({
          config,
          ctx,
          exec,
          toolName: 'backup_transfer',
          operation,
          reason: `Run backup ${JSON.stringify(target.id)}: \`rclone ${operation}\`?`,
        })
        if (!gate.ok) {
          await safeAudit(config, { tool: 'backup_transfer', target: target.id, mode: target.mode, outcome: gate.approval })
          throw gate.error
        }
        approval = gate.approval
      }

      const result = await run(config.rclone, argv, {
        timeoutMs: target.timeoutMs,
        maxOutputBytes: config.safety.maxOutputBytes,
        signal: exec.signal,
      })
      throwIfAborted(result)

      if (!dryRun) {
        await safeAudit(config, {
          tool: 'backup_transfer',
          target: target.id,
          mode: target.mode,
          outcome: result.code === 0 ? 'executed' : 'failed',
          exitCode: result.code,
          durationMs: result.durationMs,
          approval,
        })
      }

      if (result.spawnError !== null) throw new Error(`rclone is not available: ${describeFailure(result)}`)
      if (result.code !== 0) {
        throw new Error(`rclone ${target.mode} ${target.id} failed: ${describeFailure(result)}${result.stderr.trim() !== '' ? `\n${result.stderr.trim().slice(0, 500)}` : ''}`)
      }

      const stats = result.stdout.trim() !== '' ? result.stdout.trim() : result.stderr.trim()
      const header = dryRun
        ? `Dry run for ${target.id}: nothing was uploaded.`
        : `Backup ${target.id} finished in ${result.durationMs} ms (${target.mode} → ${destination}).`
      const blocks = [header]
      if (stats !== '') blocks.push(stats)
      if (!dryRun) blocks.push('Run backup_verify to confirm the remote copy matches.')
      return textResult(blocks.join('\n\n'))
    },
  })
}

/**
 * Write an audit line without masking the operation's own result.
 * @param {object} config - normalized config.
 * @param {Record<string, unknown>} record - audit fields.
 * @returns {Promise<string | null>} warning text when the write failed.
 */
async function safeAudit(config, record) {
  try {
    await appendAudit(config.audit.file, record)
    return null
  } catch (error) {
    return `audit log write failed: ${error.message}`
  }
}
