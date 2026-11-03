import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestAt, loadPlugin } from './fixtures/geckit-loader.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('published manifest and bundle pass installed GeckIt loader validation', async () => {
  const loaded = await loadPlugin(root);
  try {
    assert.equal(loaded.info.id, 'plugin:minimax-tmux');
    assert.equal(loaded.provider.family, loaded.info.id);
    assert.equal(loaded.info.transport, undefined);
    assert.equal(loaded.provider.transport, undefined);
    assert.equal(typeof loaded.provider.hold, 'function');
  } finally { loaded.provider.dispose(); }
});

test('reproduces the installation rejection for the original reserved transport field', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geckit-install-regression-'));
  try {
    const manifest = JSON.parse(await readFile(join(root, 'geckit-plugin.json'), 'utf8'));
    manifest.provider.transport = 'tmux';
    await writeFile(join(directory, 'geckit-plugin.json'), JSON.stringify(manifest));
    await assert.rejects(manifestAt(directory), /Plugin provider ID does not match its family and transport/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
