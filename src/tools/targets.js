/**
 * `backup_targets`: read-only inventory of the configured backup targets.
 * @module dsh-drive-backup/tools/targets
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { textOutput, textResult } from '../lib/tooling.js'
import { describeDestination, describeTargets } from '../lib/targets.js'

/**
 * Build the read-only `backup_targets` tool.
 * @param {object} deps - dependencies.
 * @param {object} deps.config - normalized config.
 * @returns {object} tool definition.
 */
export function createBackupTargetsTool({ config }) {
  const ids = config.targets.map(target => target.id)

  return defineTool({
    name: 'backup_targets',
    description: `Read-only list of the configured backup targets: local path, rclone destination, transfer mode and timeout. Configured: ${describeTargets(config.targets)}.`,
    parameters: {},
    output: textOutput(),
    timeoutMs: 5000,
    isConcurrencySafe: () => true,
    async execute() {
      if (config.targets.length === 0) {
        return textResult('No backup targets are configured. Add at least one `targets` entry to the dsh-drive-backup plugin config.')
      }
      const lines = [`Backup targets (rclone remote: ${config.remote}):`]
      for (const target of config.targets) {
        lines.push([
          `  ${target.id}${target.label !== '' && target.label !== target.id ? ` · ${target.label}` : ''}`,
          `    local: ${target.local}`,
          `    remote: ${describeDestination(target, config.remote)}`,
          `    timeout: ${Math.round(target.timeoutMs / 1000)} s · transfers: ${target.transfers}`,
          ...(target.excludes.length > 0 ? [`    excludes: ${target.excludes.join(', ')}`] : []),
        ].join('\n'))
      }
      lines.push(`Mode note: \`copy\` never deletes remote files; \`sync\` mirrors and therefore deletes them.`)
      return textResult(lines.join('\n'))
    },
  })
}
