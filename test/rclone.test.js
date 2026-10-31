import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MODES,
  assertRemoteName,
  assertRemotePath,
  assertTargetId,
  checkArgs,
  destinationFor,
  formatBytes,
  listArgs,
  parseCheckOutput,
  parseListOutput,
  parseSizeJson,
  sizeArgs,
  transferArgs,
} from '../src/lib/rclone.js'

test('MODES allow-lists copy and sync only', () => {
  assert.deepEqual([...MODES], ['copy', 'sync'])
})

test('assertTargetId accepts safe ids and rejects the rest', () => {
  assert.equal(assertTargetId('openviking'), 'openviking')
  assert.equal(assertTargetId('openviking-daily_2'), 'openviking-daily_2')
  assert.throws(() => assertTargetId('OpenViking'), /Invalid backup target id/)
  assert.throws(() => assertTargetId('../etc'), /Invalid backup target id/)
  assert.throws(() => assertTargetId(''), /Invalid backup target id/)
})

test('assertRemoteName rejects option injection and separators', () => {
  assert.equal(assertRemoteName('grive'), 'grive')
  assert.throws(() => assertRemoteName('--help'), /Invalid rclone remote name/)
  assert.throws(() => assertRemoteName('grive:path'), /Invalid rclone remote name/)
  assert.throws(() => assertRemoteName(''), /Invalid rclone remote name/)
})

test('assertRemotePath normalizes and blocks traversal', () => {
  assert.equal(assertRemotePath('dsh-backups/openviking'), 'dsh-backups/openviking')
  assert.equal(assertRemotePath('dsh-backups//openviking/'), 'dsh-backups/openviking')
  assert.throws(() => assertRemotePath('/absolute'), /must be relative/)
  assert.throws(() => assertRemotePath('a/../b'), /must not contain/)
  assert.throws(() => assertRemotePath(''), /needs a remotePath/)
})

test('destinationFor joins remote and path', () => {
  assert.equal(destinationFor('grive', 'dsh-backups/openviking'), 'grive:dsh-backups/openviking')
})

test('command builders keep paths in their own argv slots', () => {
  assert.deepEqual(sizeArgs('grive:a/b'), ['size', '--json', 'grive:a/b'])
  const list = listArgs('grive:a')
  assert.deepEqual(list, ['lsf', 'grive:a', '--format', 'pst', '--files-only', '--max-depth', '1'])
  assert.deepEqual(checkArgs('/root/x', 'grive:a'), ['check', '/root/x', 'grive:a', '--combined', '-', '--size-only'])
  assert.deepEqual(checkArgs('/root/x', 'grive:a', false), ['check', '/root/x', 'grive:a', '--combined', '-'])
  const filtered = checkArgs('/root/x', 'grive:a', true, ['*.log', ''])
  assert.equal(filtered.filter(value => value === '--exclude').length, 1)
  assert.ok(filtered.includes('*.log'))
})

test('transferArgs builds copy and sync argv with options', () => {
  assert.deepEqual(transferArgs('copy', '/root/x', 'grive:a'), ['copy', '/root/x', 'grive:a', '--stats-one-line', '--stats', '5s'])
  const sync = transferArgs('sync', '/root/x', 'grive:a', { dryRun: true, excludes: ['*.tmp', ''], transfers: 8 })
  assert.equal(sync[0], 'sync')
  assert.ok(sync.includes('--dry-run'))
  assert.ok(sync.includes('--exclude'))
  assert.ok(sync.includes('*.tmp'))
  assert.ok(sync.includes('8'))
  assert.equal(sync.filter(value => value === '--exclude').length, 1)
  assert.throws(() => transferArgs('move', '/root/x', 'grive:a'), /Unsupported backup mode/)
})

test('parseSizeJson reads rclone size output', () => {
  assert.deepEqual(parseSizeJson('{"count":3,"bytes":1234,"sizeless":0}'), { count: 3, bytes: 1234 })
  assert.equal(parseSizeJson('nope'), null)
  assert.equal(parseSizeJson(''), null)
})

test('parseListOutput reads lsf lines and sorts newest first', () => {
  const text = 'a.tar.gz;100;2026-10-01 03:30:00\nb.tar.gz;200;2026-10-31 03:30:00\n'
  assert.deepEqual(parseListOutput(text), [
    { path: 'b.tar.gz', bytes: 200, time: '2026-10-31 03:30:00' },
    { path: 'a.tar.gz', bytes: 100, time: '2026-10-01 03:30:00' },
  ])
  assert.deepEqual(parseListOutput(''), [])
})

test('parseCheckOutput counts matches and differences', () => {
  const text = '= a.tar.gz\n= b.tar.gz\n* c.tar.gz\n+ d.tar.gz\n'
  const summary = parseCheckOutput(text)
  assert.equal(summary.matches, 2)
  assert.equal(summary.differences, 2)
  assert.deepEqual(summary.samples, ['c.tar.gz', 'd.tar.gz'])
  assert.deepEqual(parseCheckOutput(''), { matches: 0, differences: 0, samples: [] })
})

test('formatBytes uses binary units', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1536), '1.5 KiB')
  assert.equal(formatBytes(1024 * 1024 * 3), '3.0 MiB')
  assert.equal(formatBytes(-5), 'unknown')
})
