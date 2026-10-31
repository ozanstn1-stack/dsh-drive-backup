/**
 * `backup_status`: read-only local/remote size and recency per target.
 * @module dsh-drive-backup/tools/status
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { describeFailure, runCommand, throwIfAborted } from '../lib/run.js'
import { destinationFor, formatBytes, listArgs, parseListOutput, parseSizeJson, sizeArgs } from '../lib/rclone.js'
import { describeTargets, findTarget } from '../lib/targets.js'
import { textOutput, textResult } from '../lib/tooling.js'

/**
 * Describe one rclone size answer.
 * @param {{ code: number | null, stdout: string, spawnError: string | null }} result - finished run.
 * @returns {string} e.g. `3 files, 12.3 MiB`.
 */
function sizeText(result) {
  if (result.spawnError !== null) return 'unavailable'
  if (result.code !== 0) return 'not found'
  const size = parseSizeJson(result.stdout)
  if (size === null) return 'unknown'
  return `${size.count} file${size.count === 1 ? '' : 's'}, ${formatBytes(size.bytes)}`
}

/**
 * Build the read-only `backup_status` tool.
 * @param {object} deps - dependencies.
 * @param {object} deps.config - normalized config.
 * @param {Function} [deps.run] - command runner (injectable for tests).
 * @returns {object} tool definition.
 */
export function createBackupStatusTool({ config, run = runCommand }) {
  const limits = { timeoutMs: config.safety.timeoutMs, maxOutputBytes: config.safety.maxOutputBytes }

  return defineTool({
    name: 'backup_status',
    description: `Read-only backup status: local size, remote size and the newest remote files for one configured target or all of them. Configured: ${describeTargets(config.targets)}.`,
    parameters: {
      id: { type: 'string', description: `Configured target id or label. Configured: ${describeTargets(config.targets)}.` },
    },
    output: textOutput(),
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (config.targets.length === 0) {
        return textResult('No backup targets are configured. Add at least one `targets` entry to the dsh-drive-backup plugin config.')
      }
      let selected = config.targets
      const wanted = String(args.id ?? '').trim()
      if (wanted !== '') {
        const target = findTarget(config.targets, wanted)
        if (target === undefined) {
          throw new Error(`Unknown backup target ${JSON.stringify(wanted)}. Configured: ${describeTargets(config.targets)}.`)
        }
        selected = [target]
      }

      const blocks = []
      for (const target of selected) {
        const destination = destinationFor(config.remote, target.remotePath)
        const local = await run(config.rclone, sizeArgs(target.local), { ...limits, signal: exec.signal })
        throwIfAborted(local)
        if (local.spawnError !== null) {
          blocks.push(`${target.id}: rclone is not available (${describeFailure(local)})`)
          continue
        }
        const remote = await run(config.rclone, sizeArgs(destination), { ...limits, signal: exec.signal })
        throwIfAborted(remote)
        const listing = remote.code === 0
          ? await run(config.rclone, listArgs(destination), { ...limits, signal: exec.signal })
          : null
        if (listing !== null) throwIfAborted(listing)

        const newest = listing === null || listing.code !== 0
          ? []
          : parseListOutput(listing.stdout).slice(0, 3)
        const lines = [
          `${target.id}${target.label !== '' && target.label !== target.id ? ` (${target.label})` : ''}`,
          `  local ${target.local}: ${sizeText(local)}`,
          `  remote ${destination}: ${sizeText(remote)}`,
        ]
        if (newest.length > 0) {
          lines.push(`  newest remote files: ${newest.map(entry => `${entry.path} (${entry.time})`).join(', ')}`)
        } else if (remote.code === 0) {
          lines.push('  newest remote files: (remote path is empty)')
        }
        blocks.push(lines.join('\n'))
      }
      return textResult(blocks.join('\n\n'))
    },
  })
}
