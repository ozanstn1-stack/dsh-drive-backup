/**
 * Shared tool plumbing: the canonical text result shape and small guards.
 * @module dsh-vps-ops/lib/tooling
 */

/**
 * Canonical tool output declaration: one text block for the model.
 * @returns {{ schema: object, render: (args: unknown, value: { text: string }) => Array<{ type: 'text', text: string }> }} output declaration
 */
export function textOutput() {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  }
}

/**
 * Wrap a string in the canonical tool result shape.
 * @param {string} text - model-facing text.
 * @returns {{ text: string }} tool result.
 */
export function textResult(text) {
  return { text: String(text ?? '') }
}


