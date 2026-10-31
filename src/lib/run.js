/**
 * Bounded command runner.
 *
 * Commands are always executed as an executable plus an argv array — never
 * through a shell — so user-supplied names cannot inject syntax. Each run is
 * capped by a wall-clock timeout and by a stdout/stderr byte budget, and the
 * child receives a minimal environment so unrelated secrets never leak into it.
 * @module dsh-vps-ops/lib/run
 */

import { spawn } from 'node:child_process'

/** Minimal, secret-free environment handed to every child process. */
const BASE_ENV = Object.freeze({
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  TERM: 'dumb',
  SYSTEMD_COLORS: '0',
  SYSTEMD_PAGER: '',
  SYSTEMD_LESS: 'FRSXMK',
  DOCKER_CLI_HINTS: 'false',
})

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Build the child environment: a fixed base plus explicitly passed overrides.
 * @param {Record<string, string>} [overrides] - extra variables.
 * @returns {Record<string, string>} environment.
 */
export function buildChildEnv(overrides = {}) {
  const env = { ...BASE_ENV }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (ENV_KEY.test(key) && typeof value === 'string') env[key] = value
  }
  return env
}

/**
 * Append one chunk to a byte-capped buffer.
 * @param {Buffer} current - bytes collected so far.
 * @param {Buffer} chunk - new chunk.
 * @param {number} cap - byte cap.
 * @returns {{ buffer: Buffer, overflowed: boolean }} updated buffer.
 */
function appendCapped(current, chunk, cap) {
  const room = cap - current.length
  if (room <= 0) return { buffer: current, overflowed: true }
  if (chunk.length <= room) return { buffer: Buffer.concat([current, chunk]), overflowed: false }
  return { buffer: Buffer.concat([current, chunk.subarray(0, room)]), overflowed: true }
}

/**
 * Run one command with a timeout and output caps.
 * @param {string} file - executable name or absolute path.
 * @param {string[]} [args] - argv array (never shell-interpreted).
 * @param {object} [options] - run options.
 * @param {number} [options.timeoutMs] - wall-clock cap; the child is killed on expiry.
 * @param {number} [options.maxOutputBytes] - stdout byte cap; overflow kills the child.
 * @param {number} [options.maxErrorBytes] - stderr byte cap.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {string} [options.cwd] - working directory.
 * @param {Record<string, string>} [options.env] - extra environment variables.
 * @returns {Promise<{ file: string, args: string[], code: number | null, signal: string | null, stdout: string, stderr: string, durationMs: number, timedOut: boolean, truncated: boolean, aborted: boolean, spawnError: string | null }>} result
 */
export function runCommand(file, args = [], options = {}) {
  const {
    timeoutMs = 15000,
    maxOutputBytes = 65536,
    maxErrorBytes = 8192,
    signal,
    cwd,
    env,
  } = options

  return new Promise(resolve => {
    const startedAt = Date.now()
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let truncated = false
    let timedOut = false
    let aborted = false
    let settled = false
    let spawnError = null
    let child

    const finish = (code, exitSignal) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
      resolve({
        file,
        args: [...args],
        code: code ?? null,
        signal: exitSignal ?? null,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated,
        aborted,
        spawnError,
      })
    }

    const killChild = () => {
      try {
        child?.kill('SIGKILL')
      } catch {
        // The child may already be gone; the close handler still settles us.
      }
    }

    const onAbort = () => {
      aborted = true
      killChild()
    }

    try {
      child = spawn(file, args, {
        cwd,
        env: buildChildEnv(env),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    } catch (error) {
      spawnError = error?.code ?? 'SPAWN_FAILED'
      finish(null, null)
      return
    }

    let timer
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        killChild()
      }, timeoutMs)
    }
    if (signal !== undefined) {
      if (signal.aborted) {
        aborted = true
        killChild()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    child.stdout?.on('data', chunk => {
      const next = appendCapped(stdout, chunk, maxOutputBytes)
      stdout = next.buffer
      if (next.overflowed) {
        truncated = true
        killChild()
      }
    })
    child.stderr?.on('data', chunk => {
      const next = appendCapped(stderr, chunk, maxErrorBytes)
      stderr = next.buffer
      if (next.overflowed) {
        truncated = true
        killChild()
      }
    })
    child.on('error', error => {
      spawnError = error?.code ?? 'SPAWN_FAILED'
      finish(null, null)
    })
    child.on('close', (code, exitSignal) => finish(code, exitSignal))
  })
}

/**
 * Throw when a finished run was cancelled by the caller.
 * @param {Awaited<ReturnType<typeof runCommand>>} result - finished run.
 * @returns {void}
 */
export function throwIfAborted(result) {
  if (result.aborted) {
    const error = new Error('Operation cancelled.')
    error.name = 'AbortError'
    throw error
  }
}

/**
 * Describe a failed run for a tool message.
 * @param {Awaited<ReturnType<typeof runCommand>>} result - finished run.
 * @returns {string} short failure description.
 */
export function describeFailure(result) {
  if (result.spawnError !== null) return `could not start ${result.file}: ${result.spawnError}`
  if (result.timedOut) return `${result.file} timed out after ${result.durationMs} ms`
  if (result.code !== 0) return `${result.file} exited with code ${result.code}${result.stderr.trim() !== '' ? `: ${result.stderr.trim().split('\n')[0]}` : ''}`
  return 'unknown failure'
}
