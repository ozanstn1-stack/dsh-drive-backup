/**
 * One-line audit trail for approved destructive operations.
 *
 * Each record is a single JSON line so operators can grep or ship the file
 * without a parser, and no secret ever enters a record.
 * @module dsh-vps-ops/lib/audit
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Resolve the Harness home directory the same way the runtime does.
 * @returns {string} absolute DSH home path.
 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/**
 * Default audit file location.
 * @returns {string} absolute path under the DSH home.
 */
export function defaultAuditFile() {
  return join(resolveDshHome(), 'logs', 'vps-ops-audit.log')
}

/**
 * Append one audit record.
 * @param {string} file - audit file path.
 * @param {Record<string, unknown>} record - fields to log.
 * @returns {Promise<string>} the exact line written.
 */
export async function appendAudit(file, record) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record })
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await appendFile(file, `${line}\n`, { mode: 0o600 })
  return line
}
