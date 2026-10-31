/**
 * Plugin configuration schema and normalization.
 *
 * Nothing host-specific is baked in: the rclone remote, every target, the
 * transfer mode and the limits all come from config. Targets are an allow-list,
 * so the model can only ever name a backup the operator already defined.
 * @module dsh-drive-backup/config
 */

import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defaultAuditFile } from './lib/audit.js'
import { MODES, assertRemoteName, assertRemotePath, assertTargetId } from './lib/rclone.js'

const targetSchema = z.object({
  id: z.string().required().description('Stable id the model passes to the tools.'),
  label: z.string().default('').description('Human-readable label.'),
  local: z.string().required().description('Absolute local file or directory to back up.'),
  remotePath: z.string().required().description('Path below the remote root, e.g. `dsh-backups/openviking`.'),
  mode: z.union(MODES).default('copy')
    .description('`copy` never deletes remote files; `sync` mirrors and therefore deletes.'),
  excludes: z.array(z.string()).default([]).description('rclone exclude patterns.'),
  transfers: z.number().min(1).max(32).default(4).description('Parallel transfers.'),
  timeoutMs: z.number().min(1000).max(3600000).default(600000).description('Wall-clock limit for this target.'),
})

/** Config schema shown to operators and used to validate `apply()`. */
export const Config = z.object({
  remote: z.string().default('grive').description('rclone remote name, e.g. `grive`.'),
  rclone: z.string().default('rclone').description('rclone executable name or absolute path.'),
  targets: z.array(targetSchema).default([]).description('Allow-list of backup targets.'),

  verify: z.object({
    sizeOnly: z.boolean().default(true)
      .description('Compare file sizes only; false compares hashes and is much slower.'),
  }).default({}).description('Verification behaviour.'),

  safety: z.object({
    readOnly: z.boolean().default(false)
      .description('When true, `backup_transfer` refuses; status and verify still work.'),
    requireApproval: z.boolean().default(true)
      .description('When true, a real transfer asks the host for approval first.'),
    timeoutMs: z.number().min(1000).max(600000).default(120000).description('Default command timeout.'),
    maxOutputBytes: z.number().min(1024).max(1048576).default(65536).description('Output cap per call.'),
  }).default({}).description('Safety limits.'),

  audit: z.object({
    file: z.string().default('').description('Audit file path; empty uses `<DSH_HOME>/logs/drive-backup-audit.log`.'),
  }).default({}).description('Where approved transfers are recorded.'),
})

/**
 * Validate operator config into a shape the tools can trust.
 * @param {object} config - validated config from the schema.
 * @returns {{ config: object, warnings: string[] }} normalized config plus warnings.
 */
export function normalizeConfig(config) {
  const warnings = []
  const value = config ?? {}

  let remote = 'grive'
  try {
    remote = assertRemoteName(value.remote ?? 'grive')
  } catch (error) {
    warnings.push(`dsh-drive-backup: ${error.message}; falling back to "grive"`)
  }

  const targets = []
  const seen = new Set()
  for (const entry of value.targets ?? []) {
    let id
    try {
      id = assertTargetId(entry.id)
    } catch (error) {
      warnings.push(`dsh-drive-backup: ignoring target: ${error.message}`)
      continue
    }
    if (seen.has(id)) {
      warnings.push(`dsh-drive-backup: ignoring duplicate target ${JSON.stringify(id)}`)
      continue
    }
    const local = String(entry.local ?? '').trim()
    if (!isAbsolute(local)) {
      warnings.push(`dsh-drive-backup: ignoring target ${JSON.stringify(id)}: local must be an absolute path`)
      continue
    }
    let remotePath
    try {
      remotePath = assertRemotePath(entry.remotePath)
    } catch (error) {
      warnings.push(`dsh-drive-backup: ignoring target ${JSON.stringify(id)}: ${error.message}`)
      continue
    }
    const mode = String(entry.mode ?? 'copy')
    if (!MODES.includes(mode)) {
      warnings.push(`dsh-drive-backup: ignoring target ${JSON.stringify(id)}: unknown mode ${JSON.stringify(mode)}`)
      continue
    }
    seen.add(id)
    targets.push({
      id,
      label: String(entry.label ?? ''),
      local,
      remotePath,
      mode,
      excludes: (entry.excludes ?? []).filter(pattern => typeof pattern === 'string' && pattern.trim() !== ''),
      transfers: Number(entry.transfers ?? 4),
      timeoutMs: Number(entry.timeoutMs ?? 600000),
    })
  }

  return {
    config: {
      remote,
      rclone: String(value.rclone ?? 'rclone'),
      targets,
      verify: { sizeOnly: value.verify?.sizeOnly !== false },
      safety: {
        readOnly: value.safety?.readOnly === true,
        requireApproval: value.safety?.requireApproval !== false,
        timeoutMs: Number(value.safety?.timeoutMs ?? 120000),
        maxOutputBytes: Number(value.safety?.maxOutputBytes ?? 65536),
      },
      audit: { file: String(value.audit?.file ?? '').trim() || defaultAuditFile() },
    },
    warnings,
  }
}
