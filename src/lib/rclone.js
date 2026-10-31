/**
 * Pure rclone helpers: argv building, path validation, and output parsing.
 *
 * Every command is an executable plus an argv array, so a target path can never
 * turn into shell syntax. Remote paths are validated before they reach an argv
 * slot, and `sync` (which deletes remote files) must be opted into per target.
 * @module dsh-drive-backup/lib/rclone
 */

/** Backup modes a target may use. `copy` never deletes; `sync` mirrors. */
export const MODES = Object.freeze(['copy', 'sync'])

const TARGET_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * Validate a target id.
 * @param {string} value - candidate id.
 * @returns {string} the validated id.
 * @throws {Error} when the id is empty or contains unsafe characters.
 */
export function assertTargetId(value) {
  const id = String(value ?? '').trim()
  if (!TARGET_ID.test(id)) throw new Error(`Invalid backup target id: ${JSON.stringify(String(value ?? ''))}`)
  return id
}

/**
 * Validate an rclone remote name.
 * @param {string} value - remote name such as `grive`.
 * @returns {string} the validated remote name.
 * @throws {Error} when the name is not a bare remote identifier.
 */
export function assertRemoteName(value) {
  const name = String(value ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) {
    throw new Error(`Invalid rclone remote name: ${JSON.stringify(String(value ?? ''))}`)
  }
  return name
}

/**
 * Validate a remote sub-path.
 * @param {string} value - path below the remote root, e.g. `dsh-backups/openviking`.
 * @returns {string} normalized path without leading or trailing slashes.
 * @throws {Error} when the path is absolute, empty, or contains traversal.
 */
export function assertRemotePath(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') throw new Error('Backup target needs a remotePath')
  if (raw.startsWith('/')) throw new Error(`remotePath must be relative to the remote root: ${JSON.stringify(raw)}`)
  const parts = raw.split('/').filter(part => part !== '')
  if (parts.some(part => part === '.' || part === '..')) {
    throw new Error(`remotePath must not contain "." or "..": ${JSON.stringify(raw)}`)
  }
  return parts.join('/')
}

/**
 * Build the full rclone destination for a target.
 * @param {string} remote - validated remote name.
 * @param {string} remotePath - validated relative path.
 * @returns {string} destination such as `grive:dsh-backups/openviking`.
 */
export function destinationFor(remote, remotePath) {
  return `${assertRemoteName(remote)}:${assertRemotePath(remotePath)}`
}

/**
 * Build the argv for a size query.
 * @param {string} destination - full rclone destination.
 * @returns {string[]} argv (without the `rclone` executable).
 */
export function sizeArgs(destination) {
  return ['size', '--json', destination]
}

/**
 * Build the argv for a recent-file listing.
 * @param {string} destination - full rclone destination.
 * @returns {string[]} argv.
 */
export function listArgs(destination) {
  return ['lsf', destination, '--format', 'pst', '--files-only', '--max-depth', '1']
}

/**
 * Build the argv for a verification run.
 * @param {string} local - absolute local path.
 * @param {string} destination - full rclone destination.
 * @param {boolean} [sizeOnly] - compare sizes only instead of hashes.
 * @param {string[]} [excludes] - exclude patterns, so verification compares the
 *   same set of files the transfer would upload.
 * @returns {string[]} argv.
 */
export function checkArgs(local, destination, sizeOnly = true, excludes = []) {
  const argv = ['check', local, destination, '--combined', '-']
  if (sizeOnly) argv.push('--size-only')
  for (const pattern of excludes) {
    if (typeof pattern === 'string' && pattern.trim() !== '') argv.push('--exclude', pattern)
  }
  return argv
}

/**
 * Build the argv for a transfer.
 * @param {'copy'|'sync'} mode - transfer mode.
 * @param {string} local - absolute local path.
 * @param {string} destination - full rclone destination.
 * @param {{ dryRun?: boolean, excludes?: string[], transfers?: number }} [options] - transfer options.
 * @returns {string[]} argv.
 * @throws {Error} when the mode is not allow-listed.
 */
export function transferArgs(mode, local, destination, options = {}) {
  if (!MODES.includes(mode)) throw new Error(`Unsupported backup mode: ${JSON.stringify(String(mode ?? ''))}`)
  const argv = [mode, local, destination, '--stats-one-line', '--stats', '5s']
  for (const pattern of options.excludes ?? []) {
    if (typeof pattern === 'string' && pattern.trim() !== '') argv.push('--exclude', pattern)
  }
  if (Number.isInteger(options.transfers) && options.transfers > 0) argv.push('--transfers', String(options.transfers))
  if (options.dryRun === true) argv.push('--dry-run')
  return argv
}

/**
 * Parse `rclone size --json` output.
 * @param {string} text - command output.
 * @returns {{ count: number, bytes: number } | null} parsed size, or null.
 */
export function parseSizeJson(text) {
  try {
    const value = JSON.parse(String(text ?? '').trim())
    if (typeof value?.count === 'number' && typeof value?.bytes === 'number') {
      return { count: value.count, bytes: value.bytes }
    }
  } catch {
    // Fall through to null.
  }
  return null
}

/**
 * Parse `rclone lsf --format pst` output into entries.
 * @param {string} text - one `path;size;time` line per file.
 * @returns {Array<{ path: string, bytes: number, time: string }>} entries, newest first.
 */
export function parseListOutput(text) {
  const entries = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const [path, size, time] = trimmed.split(';')
    if (path === undefined || path === '') continue
    entries.push({ path, bytes: Number(size) || 0, time: time ?? '' })
  }
  entries.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0))
  return entries
}

/**
 * Summarize `rclone check --combined -` output.
 * @param {string} text - combined output lines such as `= path` or `* path`.
 * @returns {{ matches: number, differences: number, samples: string[] }} summary.
 */
export function parseCheckOutput(text) {
  let matches = 0
  let differences = 0
  const samples = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const marker = trimmed[0]
    if (marker === '=') matches += 1
    else if (marker === '*' || marker === '+' || marker === '-') {
      differences += 1
      if (samples.length < 5) samples.push(trimmed.slice(2))
    }
  }
  return { matches, differences, samples }
}

/**
 * Format a byte count.
 * @param {number} bytes - byte count.
 * @returns {string} human-readable size.
 */
export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return 'unknown'
  if (value < 1024) return `${Math.round(value)} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(1)} ${units[unit]}`
}
