import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { create } from '../index.mjs';
import { McodeRpc } from '../src/mcode-rpc.mjs';
import { nativeId } from '../src/mcode-history.mjs';

const until = async (condition) => {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await condition()) return;
    await delay(20);
  }
  throw new Error('Timed out');
};

test('ordinary sends emit no native user echo while history, repeated sends and native messages survive', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geckit-mcode-echo-'));
  const executable = join(directory, 'mcode');
  const fixture = new URL('./fake-mcode.mjs', import.meta.url).pathname;
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(executable, `#!/bin/sh\nexec env MCODE_TEST_DIR=${quote(directory)} ${quote(process.execPath)} ${quote(fixture)} "$@"\n`);
  await chmod(executable, 0o755);
  const server = 'mcode-echo-' + Date.now();
  const rpc = new McodeRpc({ command: () => executable, timeout: 5000 });
  const provider = create({}, {
    rpc,
    guide: { prompt: async () => '', set() {} },
    quota: { refresh: async () => undefined, dispose() {} },
    terminal: { command: () => executable, tmuxProgram: async () => ({ file: 'tmux', server: ['-L', server] }) },
  });
  let driver;
  let resumed;
  const events = [];
  let shown = new Map();
  const hear = event => {
    events.push(event);
    for (const id of event.gone) shown.delete(id);
    for (const item of event.items) shown.set(item.id, item);
  };
  const ended = () => events.flatMap(event => event.signals).filter(signal => signal.kind === 'ended');
  try {
    const id = await provider.create({ root: directory });
    const path = join(directory, nativeId(id) + '.json');
    const text = "Literal $(echo unchanged)\nю🙂 with apostrophe '";
    const before = ['Command context'];
    const fullText = [...before, text].join('\n\n');
    const native = JSON.parse(await readFile(path, 'utf8'));
    native.messages.push({ msg_id: 'prior-user', role: 'user', msg_content: fullText, timestamp: 1 });
    await writeFile(path, JSON.stringify(native));
    shown = new Map((await provider.read(directory, id)).items.map(item => [item.id, item]));
    driver = provider.hold({ id, root: directory }, hear, () => {});

    shown.set('mine:first', { kind: 'mine', id: 'mine:first', text });
    driver.send(text, [], before);
    await until(() => ended().length === 1);
    assert.equal(ended()[0].how, 'done');
    assert.equal([...shown.values()].filter(item => item.kind === 'mine').length, 2);
    assert.deepEqual((await provider.read(directory, id)).items.filter(item => item.kind === 'mine').map(item => item.text), [fullText, fullText]);
    assert.equal(events.flatMap(event => event.items).filter(item => item.kind === 'mine' && item.id !== 'prior-user').length, 0);

    shown.set('mine:repeat', { kind: 'mine', id: 'mine:repeat', text });
    driver.send(text, [], before);
    await until(() => ended().length === 2);
    assert.equal([...shown.values()].filter(item => item.kind === 'mine').length, 3);
    assert.equal((await provider.read(directory, id)).items.filter(item => item.kind === 'mine').length, 3);

    shown.set('mine:photo', { kind: 'mine', id: 'mine:photo', text: 'photo' });
    driver.send('photo', [{ media: 'image/png', data: 'aW1hZ2U=' }]);
    await until(() => ended().length === 3);
    assert.equal([...shown.values()].filter(item => item.kind === 'mine').length, 4);
    assert.equal((await provider.read(directory, id)).items.filter(item => item.kind === 'mine').length, 4);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).receivedImages.length, 1);

    const changed = JSON.parse(await readFile(path, 'utf8'));
    changed.messages.push({ msg_id: 'external-user', role: 'user', msg_content: 'From native terminal', timestamp: Date.now() });
    await writeFile(path, JSON.stringify(changed));
    await until(() => shown.has('external-user'));
    assert.equal([...shown.values()].filter(item => item.kind === 'mine').length, 5);

    await driver.end();
    shown = new Map((await provider.read(directory, id)).items.map(item => [item.id, item]));
    resumed = provider.hold({ id, root: directory, resume: true }, hear, () => {});
    shown.set('mine:resumed', { kind: 'mine', id: 'mine:resumed', text: 'after reopening' });
    resumed.send('after reopening');
    await until(() => ended().length === 4);
    assert.equal([...shown.values()].filter(item => item.kind === 'mine').length, 6);
    assert.equal((await provider.read(directory, id)).items.filter(item => item.kind === 'mine').length, 6);
  } finally {
    await driver?.end();
    await resumed?.end();
    provider.dispose();
    try { execFileSync('tmux', ['-L', server, 'kill-server'], { stdio: 'ignore' }); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
