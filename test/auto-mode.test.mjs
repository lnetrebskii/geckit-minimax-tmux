import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { create } from '../index.mjs';
import { McodeRpc } from '../src/mcode-rpc.mjs';
import { nativeId } from '../src/mcode-history.mjs';
import { terminalScreen } from '../src/mcode-terminal.mjs';

const until = async (condition) => { for (let n = 0; n < 500; n++) { if (await condition()) return; await delay(20); } throw new Error('Timed out'); };

test('only explicit native tool approval menus are eligible for Auto', () => {
  const approval = '◆ Approval required\nAllow web_fetch?\n› 1 Allow for this conversation\n  2 Always allow matching actions\n  3 Deny and guide MCode';
  assert.equal(terminalScreen(approval).approval, true);
  assert.equal(terminalScreen('╭─ Ask ─╮\nAllow for this conversation\n› 1 Allow for this conversation\n  2 No\n↑↓ move · 1-2 select · Enter send').approval, undefined);
  assert.equal(terminalScreen('◆ Save permission rule\nAlways allow matching actions?').approval, undefined);
  assert.equal(terminalScreen('◆ Approval required\nDeny this action?').approval, undefined);
  assert.equal(terminalScreen('Unknown approval layout\nPress 1 to continue').approval, undefined);
});

test('Auto allows conversation-scoped tools; Manual, Plan, questions, mode changes and Stop retain their boundaries', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geckit-mcode-auto-'));
  const executable = join(directory, 'mcode');
  const fixture = new URL('./fake-mcode.mjs', import.meta.url).pathname;
  const q = text => `'${text.replaceAll("'", "'\\''")}'`;
  await writeFile(executable, `#!/bin/sh\nexec env MCODE_TEST_DIR=${q(directory)} ${q(process.execPath)} ${q(fixture)} "$@"\n`, { mode: 0o700 });
  const server = 'mcode-auto-' + Date.now();
  const rpc = new McodeRpc({ command: () => executable, timeout: 5000 });
  const provider = create({}, { rpc, quota: { refresh: async () => undefined, dispose() {} }, terminal: { command: () => executable, tmuxProgram: async () => ({ file: 'tmux', server: ['-L', server] }) } });
  const drivers = [];
  try {
    for (const mode of ['auto', 'manual', 'plan']) {
      const id = await provider.create({ root: directory });
      const events = [];
      const driver = provider.hold({ id, root: directory, mode }, event => events.push(event), () => {});
      drivers.push(driver);
      const signals = () => events.flatMap(event => event.signals);
      const ended = () => signals().filter(signal => signal.kind === 'ended');
      const ask = () => signals().findLast(signal => signal.kind === 'asks');
      const saved = async () => JSON.parse(await readFile(join(directory, nativeId(id) + '.json')));
      driver.send('permission');
      if (mode === 'auto') {
        await until(() => ended().length === 1);
        assert.equal(ended()[0].how, 'done');
        assert.equal(ask(), undefined);
        assert.equal((await saved()).approvals, 1);
        assert.equal((await provider.read(directory, id)).items.at(-1).text, 'allowed');
        driver.send('permission');
        await until(() => ended().length === 2);
        assert.equal((await saved()).approvals, 2);
        for (const text of ['question', 'confirm-rule', 'unknown-dialog']) {
          const before = signals().filter(signal => signal.kind === 'asks').length;
          driver.send(text);
          if (text !== 'unknown-dialog') await until(() => signals().filter(signal => signal.kind === 'asks').length > before);
          await delay(1000);
          assert.equal((await saved()).approvals, 2);
          if (text === 'unknown-dialog') assert.equal(signals().filter(signal => signal.kind === 'asks').length, before);
          const turns = ended().length;
          driver.stop();
          await until(() => ended().length > turns);
          assert.equal(ended().at(-1).how, 'stopped');
        }
        await provider.startGoal(id, 'permission', driver);
        await until(() => ended().length === 6);
        assert.equal((await provider.goal(directory, id)).status, 'complete');
        assert.equal((await saved()).approvals, 3);
      } else {
        await until(() => ask());
        await delay(900);
        assert.equal((await saved()).approvals, undefined);
        assert.equal(ended().length, 0);
        if (mode === 'manual') {
          const pending = ask();
          driver.permit('auto'); driver.permit('manual');
          await delay(900);
          assert.equal((await saved()).approvals, undefined);
          driver.permit('auto');
          await until(() => ended().length === 1);
          assert.equal((await saved()).approvals, 1);
          assert.ok(signals().some(signal => signal.kind === 'resolved' && signal.ask === pending.ask));
          driver.permit('manual');
          driver.send('permission');
          await until(() => ask().ask !== pending.ask);
          await delay(900);
          assert.equal((await saved()).approvals, 1);
          driver.permit('auto'); driver.stop();
          await until(() => ended().length === 2);
          assert.equal(ended().at(-1).how, 'stopped');
          assert.equal((await saved()).approvals, 1);
        } else {
          driver.answer(ask().ask, 'Deny and guide MCode');
          await until(() => ended().length === 1);
          assert.equal((await saved()).approvals, undefined);
          assert.equal((await provider.read(directory, id)).items.at(-1).text, 'denied');
        }
      }
      assert.ok((await saved()).commands.every(command => !command.includes('/permission full')));
      await driver.end();
    }
  } finally {
    await Promise.all(drivers.map(driver => driver.end())); provider.dispose();
    try { execFileSync('tmux', ['-L', server, 'kill-server'], { stdio: 'ignore' }); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
