/**
 * Dev-only helper: link the DSH peer packages into `node_modules` so the test
 * suite can import the real `@deepseek-ai/dsh-tools` and `@deepseek-ai/schemastery`.
 *
 * A DSH plugin does not ship these packages: at runtime the Harness resolves
 * them from its own installation. Tests run in a plain Node process, so they
 * need a local link. This script derives the installation from the `dsh` binary
 * and links only the peers this package declares.
 *
 * Usage: node scripts/link-peers.mjs [path-to-@deepseek-ai-directory]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Resolve the installation's `@deepseek-ai` package directory. */
function findPeerRoot() {
  const explicit = process.argv[2]
  if (explicit !== undefined) return resolve(explicit)

  let bin
  try {
    bin = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('Cannot find `dsh` on PATH; pass the @deepseek-ai directory explicitly.')
  }
  if (bin === '') throw new Error('Cannot find `dsh` on PATH; pass the @deepseek-ai directory explicitly.')

  // <prefix>/bin/dsh -> <prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
  const realBin = execFileSync('readlink', ['-f', bin], { encoding: 'utf8' }).trim()
  const dshRoot = resolve(dirname(realBin), '..')
  return join(dshRoot, 'node_modules', '@deepseek-ai')
}

const manifest = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
const peers = Object.keys(manifest.peerDependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/'))
const peerRoot = findPeerRoot()
const targetDir = join(projectDir, 'node_modules', '@deepseek-ai')

rmSync(join(projectDir, 'node_modules'), { recursive: true, force: true })
mkdirSync(targetDir, { recursive: true })

let linked = 0
for (const peer of peers) {
  const name = peer.slice('@deepseek-ai/'.length)
  const source = join(peerRoot, name)
  if (!existsSync(join(source, 'package.json'))) {
    console.warn(`skip ${peer}: not found at ${source}`)
    continue
  }
  symlinkSync(source, join(targetDir, name))
  linked += 1
}
console.log(`linked ${linked}/${peers.length} peer packages from ${peerRoot}`)
