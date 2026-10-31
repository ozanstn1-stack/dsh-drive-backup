import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Config, normalizeConfig } from '../src/config.js'
import { createBackupRunTool } from '../src/tools/run.js'
import { createBackupStatusTool } from '../src/tools/status.js'
import { createBackupTargetsTool } from '../src/tools/targets.js'
import { createBackupVerifyTool } from '../src/tools/verify.js'

const EXEC = { callId: 'call-1', signal: new AbortController().signal, agent: { id: 'agent-1' } }

/** Build one canonical run result. */
function ok(overrides = {}) {
  return {
    file: 'rclone',
    args: [],
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    durationMs: 5,
    timedOut: false,
    truncated: false,
    aborted: false,
    spawnError: null,
    ...overrides,
  }
}

/** Build a runner that records every call. */
function makeRunner(handler = () => ok()) {
  const calls = []
  const run = async (file, args, options) => {
    calls.push({ file, args, options })
    return handler(file, args, options)
  }
  return { run, calls }
}

/** Build the approval seam. */
function approval(outcome) {
  return { approval: { request: async () => outcome } }
}

const noApproval = {}

async function setup(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'drive-backup-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const local = join(dir, 'openviking-2026.tar.gz')
  await writeFile(local, 'tarball-bytes')
  const auditFile = join(dir, 'audit.log')
  const { config, warnings } = normalizeConfig(Config({
    remote: 'grive',
    targets: [
      { id: 'openviking', label: 'OpenViking memory', local, remotePath: 'dsh-backups/openviking', mode: 'copy', timeoutMs: 5000 },
      { id: 'mirror', label: 'Mirror', local, remotePath: 'dsh-backups/mirror', mode: 'sync', timeoutMs: 5000 },
    ],
    safety: { readOnly: false, requireApproval: true, timeoutMs: 5000, maxOutputBytes: 65536 },
    audit: { file: auditFile },
    ...overrides,
  }))
  return { dir, local, auditFile, config, warnings }
}

test('backup_targets lists every configured target', async t => {
  const { config } = await setup(t)
  const tool = createBackupTargetsTool({ config })
  const value = await tool.execute({}, EXEC)
  assert.match(value.text, /Backup targets \(rclone remote: grive\)/)
  assert.match(value.text, /openviking · OpenViking memory/)
  assert.match(value.text, /grive:dsh-backups\/openviking \(copy\)/)
  assert.match(value.text, /grive:dsh-backups\/mirror \(sync\)/)
})

test('backup_status reports local and remote sizes', async t => {
  const { config, local } = await setup(t)
  const { run, calls } = makeRunner((file, args) => {
    if (args[0] === 'size' && args[2] === local) return ok({ stdout: '{"count":1,"bytes":2048}' })
    if (args[0] === 'size') return ok({ stdout: '{"count":2,"bytes":4096}' })
    return ok({ stdout: 'openviking-2026.tar.gz;2048;2026-10-31 03:30:00\n' })
  })
  const tool = createBackupStatusTool({ config, run })
  const value = await tool.execute({ id: 'openviking' }, EXEC)
  assert.match(value.text, /local .*: 1 file, 2\.0 KiB/)
  assert.match(value.text, /remote grive:dsh-backups\/openviking: 2 files, 4\.0 KiB/)
  assert.match(value.text, /newest remote files: openviking-2026\.tar\.gz \(2026-10-31 03:30:00\)/)
  assert.ok(calls.some(call => call.args[0] === 'lsf'))
})

test('backup_status rejects an unknown target', async t => {
  const { config } = await setup(t)
  const { run } = makeRunner()
  const tool = createBackupStatusTool({ config, run })
  await assert.rejects(tool.execute({ id: 'nope' }, EXEC), /Unknown backup target/)
})

test('backup_verify summarizes a matching copy', async t => {
  const { config } = await setup(t)
  const { run, calls } = makeRunner(() => ok({ stdout: '= a.tar.gz\n= b.tar.gz\n' }))
  const tool = createBackupVerifyTool({ config, run })
  const value = await tool.execute({ id: 'openviking' }, EXEC)
  assert.deepEqual(calls[0].args.slice(0, 3), ['check', calls[0].args[1], 'grive:dsh-backups/openviking'])
  assert.ok(calls[0].args.includes('--size-only'))
  assert.match(value.text, /2 files match, 0 differ/)
  assert.match(value.text, /The remote copy matches the local path/)
})

test('backup_verify reports differences', async t => {
  const { config } = await setup(t)
  const { run } = makeRunner(() => ok({ stdout: '= a\n* b\n' }))
  const tool = createBackupVerifyTool({ config, run })
  const value = await tool.execute({ id: 'openviking' }, EXEC)
  assert.match(value.text, /1 file match, 1 differs/)
  assert.match(value.text, /Differences: b/)
})

test('backup_transfer dry run needs no approval and uploads nothing', async t => {
  const { config, auditFile } = await setup(t)
  const { run, calls } = makeRunner(() => ok({ stdout: 'Transferred: 0 B / 0 B' }))
  const tool = createBackupRunTool({ ctx: noApproval, config, run })
  const value = await tool.execute({ id: 'openviking', dryRun: true }, EXEC)
  assert.ok(calls[0].args.includes('--dry-run'))
  assert.match(value.text, /Dry run for openviking: nothing was uploaded/)
  await assert.rejects(readFile(auditFile, 'utf8'), /ENOENT/)
})

test('backup_transfer refuses in read-only mode', async t => {
  const { config } = await setup(t, { safety: { readOnly: true, requireApproval: true, timeoutMs: 5000, maxOutputBytes: 65536 } })
  const { run, calls } = makeRunner()
  const tool = createBackupRunTool({ ctx: approval('allowed-once'), config, run })
  await assert.rejects(tool.execute({ id: 'openviking' }, EXEC), /safety\.readOnly is enabled/)
  assert.equal(calls.length, 0)
})

test('backup_transfer fails closed when approval is rejected', async t => {
  const { config, auditFile } = await setup(t)
  const { run, calls } = makeRunner()
  const tool = createBackupRunTool({ ctx: approval('rejected'), config, run })
  await assert.rejects(tool.execute({ id: 'openviking' }, EXEC), /Approval not granted \(rejected\)/)
  assert.equal(calls.length, 0)
  assert.match(await readFile(auditFile, 'utf8'), /"outcome":"rejected"/)
})

test('backup_transfer fails closed without an approval answerer', async t => {
  const { config } = await setup(t)
  const { run, calls } = makeRunner()
  const tool = createBackupRunTool({ ctx: noApproval, config, run })
  await assert.rejects(tool.execute({ id: 'openviking' }, EXEC), /Approval not granted \(unavailable\)/)
  assert.equal(calls.length, 0)
})

test('backup_transfer executes an approved copy and audits it', async t => {
  const { config, auditFile, local } = await setup(t)
  const { run, calls } = makeRunner(() => ok({ stdout: 'Transferred: 2 KiB / 2 KiB, 100%' }))
  const tool = createBackupRunTool({ ctx: approval('allowed-once'), config, run })
  const value = await tool.execute({ id: 'OpenViking memory' }, EXEC)
  assert.deepEqual(calls[0].args.slice(0, 3), ['copy', local, 'grive:dsh-backups/openviking'])
  assert.match(value.text, /Backup openviking finished/)
  assert.match(value.text, /Run backup_verify/)
  assert.match(await readFile(auditFile, 'utf8'), /"tool":"backup_transfer".*"target":"openviking".*"outcome":"executed"/)
})

test('backup_transfer uses sync for a mirror target', async t => {
  const { config } = await setup(t)
  const { run, calls } = makeRunner()
  const tool = createBackupRunTool({ ctx: approval('allowed-once'), config, run })
  await tool.execute({ id: 'mirror' }, EXEC)
  assert.equal(calls[0].args[0], 'sync')
})

test('backup_transfer rejects an unknown target and a missing local path', async t => {
  const { config } = await setup(t, {
    targets: [{ id: 'ghost', local: '/nonexistent/path/for/test', remotePath: 'a/b' }],
  })
  const { run, calls } = makeRunner()
  const tool = createBackupRunTool({ ctx: approval('allowed-once'), config, run })
  await assert.rejects(tool.execute({ id: 'nope' }, EXEC), /Unknown backup target/)
  await assert.rejects(tool.execute({ id: 'ghost' }, EXEC), /Local path does not exist/)
  assert.equal(calls.length, 0)
})

test('normalizeConfig drops invalid targets with warnings', () => {
  // Feed the normalizer a raw object: the schema itself already rejects a bad
  // mode, so this covers the defensive path for anything that slips through.
  const { config, warnings } = normalizeConfig({
    remote: 'grive',
    targets: [
      { id: 'good', local: '/root/x', remotePath: 'a/b' },
      { id: 'Bad Id', local: '/root/x', remotePath: 'a/b' },
      { id: 'relative', local: 'x', remotePath: 'a/b' },
      { id: 'escape', local: '/root/x', remotePath: '../etc' },
      { id: 'mode', local: '/root/x', remotePath: 'a/b', mode: 'move' },
      { id: 'good', local: '/root/y', remotePath: 'a/c' },
    ],
  })
  assert.deepEqual(config.targets.map(target => target.id), ['good'])
  assert.equal(config.targets[0].local, '/root/x')
  assert.equal(warnings.length, 5)
})
