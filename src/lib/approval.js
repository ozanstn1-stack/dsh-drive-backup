/**
 * Approval seam wrapper.
 *
 * Destructive tools fail closed: a missing answerer, a throwing answerer, or
 * any outcome other than `allowed-once` means the operation does not run.
 * @module dsh-vps-ops/lib/approval
 */

/**
 * Ask the host for one approval decision.
 * @param {object} options - request inputs.
 * @param {import('@deepseek-ai/cordis').Context} options.ctx - plugin context.
 * @param {object} options.exec - tool execution context (`agent`, `callId`, `signal`).
 * @param {string} options.toolName - tool requesting the decision.
 * @param {string} options.reason - human-readable explanation.
 * @returns {Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>} decision.
 */
export async function requestApproval({ ctx, exec, toolName, reason }) {
  const approval = ctx?.approval
  const agent = exec?.agent
  if (approval === undefined || approval === null || typeof approval.request !== 'function') return 'unavailable'
  if (agent === undefined || agent === null) return 'unavailable'
  try {
    const outcome = await approval.request({
      agent,
      toolName,
      callId: exec.callId,
      reason,
      signal: exec.signal,
    })
    if (outcome === 'allowed-once' || outcome === 'rejected' || outcome === 'cancelled') return outcome
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Whether an approval outcome grants exactly this one operation.
 * @param {string} outcome - approval outcome.
 * @returns {boolean} true only for `allowed-once`.
 */
export function approvalGranted(outcome) {
  return outcome === 'allowed-once'
}
