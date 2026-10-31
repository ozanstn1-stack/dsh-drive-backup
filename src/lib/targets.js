/**
 * Target lookup helpers shared by the tools.
 * @module dsh-drive-backup/lib/targets
 */

/**
 * Find one configured target by id, case-insensitively.
 * @param {Array<{ id: string, label: string }>} targets - configured targets.
 * @param {string} query - id supplied by the model.
 * @returns {object | undefined} the matching target.
 */
export function findTarget(targets, query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (needle === '') return undefined
  return (targets ?? []).find(target => target.id.toLowerCase() === needle
    || (target.label !== '' && target.label.toLowerCase() === needle))
}

/**
 * Render the target allow-list for a tool description or an error message.
 * @param {Array<{ id: string, label: string }>} targets - configured targets.
 * @returns {string} e.g. `openviking (OpenViking memory), kod (Code)`.
 */
export function describeTargets(targets) {
  const list = targets ?? []
  if (list.length === 0) return '(none configured)'
  return list.map(target => (target.label && target.label !== target.id ? `${target.id} (${target.label})` : target.id)).join(', ')
}

/**
 * Describe a target's destination and mode.
 * @param {{ id: string, mode: string, remotePath: string }} target - configured target.
 * @param {string} remote - remote name.
 * @returns {string} e.g. `grive:dsh-backups/openviking (copy)`.
 */
export function describeDestination(target, remote) {
  return `${remote}:${target.remotePath} (${target.mode})`
}
