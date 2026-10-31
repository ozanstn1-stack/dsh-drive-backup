/**
 * dsh-drive-backup — rclone backup tooling for DeepSeek Harness.
 *
 * Targets are an allow-list from config, commands are argv arrays (never shell
 * strings), a dry run is free and a real transfer needs approval and leaves one
 * audit line. `copy` never deletes; `sync` mirrors and must be opted into.
 * @module dsh-drive-backup
 */

import { Config, normalizeConfig } from './config.js'
import { describeDestination, describeTargets } from './lib/targets.js'
import { createBackupRunTool } from './tools/run.js'
import { createBackupStatusTool } from './tools/status.js'
import { createBackupTargetsTool } from './tools/targets.js'
import { createBackupVerifyTool } from './tools/verify.js'

export { Config }

/** Plugin name used by the bundle patch and diagnostics. */
export const name = 'dsh-drive-backup'

/** Services this plugin needs before it can register tools. */
export const inject = ['tools', 'systemPrompt', 'approval']

/** Placement of this plugin's system-prompt section. */
const PROMPT_ORDER = 500

/**
 * Build the system-prompt section text from the effective config.
 * @param {object} config - normalized config.
 * @returns {string} prompt text.
 */
export function buildPromptText(config) {
  const targets = config.targets.map(target => `${target.id} → ${describeDestination(target, config.remote)}`)
  return [
    `rclone backups (dsh-drive-backup). Remote: ${config.remote}. Targets: ${describeTargets(config.targets)}.`,
    'Inspect with `backup_targets` and `backup_status`; confirm a copy with `backup_verify`.',
    'Before a real transfer, prefer `backup_transfer` with `dryRun: true` so the user sees what would move.',
    'A real `backup_transfer` needs the host approval; if approval is unavailable or rejected, say the transfer did not happen.',
    'Never invent target ids: when one is rejected, report the configured list instead of trying other names.',
    `\`sync\` targets delete remote files that are missing locally; \`copy\` never deletes. Destinations: ${targets.join('; ') || '(none)'}.`,
  ].join('\n')
}

/**
 * Register one tool, keeping the rest of the plugin alive when another plugin
 * already owns the name. A collision must never take down every tool here.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} tool - tool definition.
 * @returns {void}
 */
function install(ctx, tool) {
  ctx.effect(() => {
    try {
      return ctx.tools.register(tool)
    } catch (error) {
      ctx.logger?.('dsh-drive-backup')?.warn?.(`dsh-drive-backup: could not register tool ${tool.name}: ${error.message}`)
      return () => {}
    }
  })
}

/**
 * Plugin entry point.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} rawConfig - validated config from {@link Config}.
 * @returns {Promise<void>} resolves once tools and the prompt section are registered.
 */
export async function apply(ctx, rawConfig) {
  const { config, warnings } = normalizeConfig(rawConfig)
  for (const warning of warnings) {
    ctx.logger?.('dsh-drive-backup')?.warn?.(warning)
  }

  const env = { ctx, config }
  for (const tool of [
    createBackupTargetsTool(env),
    createBackupStatusTool(env),
    createBackupVerifyTool(env),
    createBackupRunTool(env),
  ]) install(ctx, tool)
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'drive-backup',
    order: PROMPT_ORDER,
    text: buildPromptText(config),
    interpolate: false,
  }))
}
