/**
 * Destructive-operation gate.
 *
 * One place decides whether an operation may run: read-only mode refuses
 * outright, then the host approval seam must grant exactly this operation.
 * A missing answerer or any non-grant outcome fails closed.
 * @module dsh-vps-ops/lib/gate
 */

import { approvalGranted, requestApproval } from './approval.js'

/**
 * Authorize one destructive operation.
 * @param {object} options - gate inputs.
 * @param {object} options.config - normalized config.
 * @param {object} options.ctx - plugin context (approval seam).
 * @param {object} options.exec - tool execution context.
 * @param {string} options.toolName - tool requesting authorization.
 * @param {string} options.operation - human-readable operation, e.g. `service_action restart`.
 * @param {string} options.reason - approval reason shown to the user.
 * @returns {Promise<{ ok: true, approval: string } | { ok: false, approval: string, error: Error }>} decision
 */
export async function authorizeDestructive({ config, ctx, exec, toolName, operation, reason }) {
  if (config.safety.readOnly) {
    return {
      ok: false,
      approval: 'read-only',
      error: new Error(`Refused: safety.readOnly is enabled, so ${operation} cannot run. Nothing was executed.`),
    }
  }

  let approval = 'not-required'
  if (config.safety.requireApproval) {
    approval = await requestApproval({ ctx, exec, toolName, reason })
    if (!approvalGranted(approval)) {
      return {
        ok: false,
        approval,
        error: new Error(`Approval not granted (${approval}); ${operation} was not executed.`),
      }
    }
  }
  return { ok: true, approval }
}
