/**
 * `backup_verify`: read-only comparison of a local path with its remote copy.
 * @module dsh-drive-backup/tools/verify
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { checkArgs, destinationFor, parseCheckOutput } from '../lib/rclone.js'
import { describeFailure, runCommand, throwIfAborted } from '../lib/run.js'
import { describeTargets, findTarget } from '../lib/targets.js'
import { textOutput, textResult } from '../lib/tooling.js'

/**
 * Build the read-only `backup_verify` tool.
 * @param {object} deps - dependencies.
 * @param {object} deps.config - normalized config.
 * @param {Function} [deps.run] - command runner (injectable for tests).
 * @returns {object} tool definition.
 */
export function createBackupVerifyTool({ config, run = runCommand }) {
  const limits = { timeoutMs: config.safety.timeoutMs, maxOutputBytes: config.safety.maxOutputBytes }

  return defineTool({
    name: 'backup_verify',
    description: `Read-only comparison of a target's local path with its remote copy using \`rclone check\`${config.verify.sizeOnly ? ' (sizes only)' : ' (hashes)'}. Reports how many files match and which differ. Configured: ${describeTargets(config.targets)}.`,
    parameters: {
      id: { type: 'string', required: true, description: `Configured target id or label. Configured: ${describeTargets(config.targets)}.` },
    },
    output: textOutput(),
    timeoutMs: 600000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const target = findTarget(config.targets, args.id)
      if (target === undefined) {
        throw new Error(`Unknown backup target ${JSON.stringify(String(args.id ?? ''))}. Configured: ${describeTargets(config.targets)}.`)
      }
      const destination = destinationFor(config.remote, target.remotePath)
      const result = await run(config.rclone, checkArgs(target.local, destination, config.verify.sizeOnly, target.excludes), {
        timeoutMs: Math.max(config.safety.timeoutMs, 120000),
        maxOutputBytes: config.safety.maxOutputBytes,
        signal: exec.signal,
      })
      throwIfAborted(result)
      if (result.spawnError !== null) throw new Error(`rclone is not available: ${describeFailure(result)}`)

      const summary = parseCheckOutput(result.stdout)
      const mode = config.verify.sizeOnly ? 'size' : 'hash'
      if (result.code !== 0 && summary.differences === 0 && summary.matches === 0) {
        throw new Error(`rclone check ${target.id} failed: ${describeFailure(result)}`)
      }
      const blocks = [
        `Verified ${target.id} against ${destination} (${mode} comparison).`,
        `${summary.matches} file${summary.matches === 1 ? '' : 's'} match, ${summary.differences} differ${summary.differences === 1 ? 's' : ''}.`,
      ]
      if (summary.samples.length > 0) blocks.push(`Differences: ${summary.samples.join(', ')}`)
      if (summary.differences === 0) blocks.push('The remote copy matches the local path.')
      return textResult(blocks.join('\n'))
    },
  })
}
