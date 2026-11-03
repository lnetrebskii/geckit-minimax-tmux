import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, chmod, constants, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { locateTmux } from '../src/tmux-binary.mjs'

const script = Buffer.from('#!/bin/sh\necho "tmux 9.9"\n')
const sha256 = createHash('sha256').update(script).digest('hex')
const target = `${process.platform}-${process.arch}`
const listed = (entry) => async () => ({ version: '9.9', files: entry === undefined ? {} : { [target]: entry } })
const served = (bytes) => async () => new Response(bytes)
const posix = { skip: process.platform !== 'darwin' && process.platform !== 'linux' }

test('uses the tmux on PATH with its default server', posix, async () => {
  const bin = await mkdtemp(join(tmpdir(), 'tmux-path-'))
  await writeFile(join(bin, 'tmux'), script)
  await chmod(join(bin, 'tmux'), 0o755)
  const found = await locateTmux({ env: { PATH: bin }, known: [], folder: join(bin, 'cache'), binaries: listed(), download: () => { throw new Error('no download expected') } })
  assert.deepEqual(found, { file: join(bin, 'tmux'), server: [] })
})

test('downloads its own tmux when none is installed and runs it on a separate server', posix, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tmux-cache-'))
  const options = { env: { PATH: '' }, known: [], folder, binaries: listed({ url: 'https://example.invalid/tmux', sha256 }) }
  const found = await locateTmux({ ...options, download: served(script) })
  assert.deepEqual(found, { file: join(folder, `tmux-9.9-${target}`), server: ['-L', 'geckit-minimax'] })
  await access(found.file, constants.X_OK)
  assert.deepEqual(await locateTmux({ ...options, download: () => { throw new Error('downloaded twice') } }), found)
})

test('refuses a download that does not match its checksum', posix, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tmux-cache-'))
  await assert.rejects(locateTmux({ env: { PATH: '' }, known: [], folder, binaries: listed({ url: 'https://example.invalid/tmux', sha256 }), download: served(Buffer.from('#!/bin/sh\nrm -rf /\n')) }), /could not be downloaded \(checksum mismatch\)\. Install tmux/)
  await assert.rejects(access(join(folder, `tmux-9.9-${target}`)))
})

test('says how to install tmux when there is no copy for this system', posix, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tmux-cache-'))
  await assert.rejects(locateTmux({ env: { PATH: '' }, known: [], folder, binaries: listed() }), /^Error: tmux is not installed\. Install tmux \((brew install tmux|for example sudo apt install tmux)\) and try again\.$/)
})
