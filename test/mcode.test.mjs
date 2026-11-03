import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { create } from '../index.mjs';
import { terminalScreen } from '../src/mcode-terminal.mjs';
import { nativeId, messageItems, contextSpend, messages } from '../src/mcode-history.mjs';
import { McodeRpc } from '../src/mcode-rpc.mjs';

const until = async (condition) => { for (let n = 0; n < 500; n++) { if (await condition()) return; await delay(20); } throw new Error('Timed out'); };
test('validates namespaces without accepting paths or other providers', () => {
  assert.equal(nativeId('plugin:minimax-tmux:mvs_123'), 'mvs_123');
  for (const id of ['mvs_123', 'plugin:claude:123', 'plugin:minimax-tmux:../../auth', 'plugin:minimax-tmux:']) assert.throws(() => nativeId(id));
});
test('converts native messages, tools and context without invented costs', () => {
  assert.equal(messageItems({ msg_id: 'u', role: 'user', msg_content: 'hi', timestamp: 10 })[0].kind, 'mine');
  assert.equal(messageItems({ msg_id: 'a', role: 'assistant', msg_content: 'reply', tool_calls: [{ name: 'bash', arguments: '{}' }] })[1].kind, 'did');
  const tool = messageItems({ msg_id: 'a', role: 'assistant', tool_calls: [{ tool_name: 'write', tool_call_id: 'call_1', tool_call_status: 1, tool_call_args: '{"path":"proof.txt"}' }] })[0];
  assert.equal(tool.what, 'write'); assert.equal(tool.id, 'a:tool:call_1'); assert.equal(tool.live, true);
  assert.deepEqual(contextSpend([{ role: 'assistant', usage: { input_tokens: 10, output_tokens: 2, cache_read: 30, context_window: 512000 } }]), { used: 42, window: 512000 });
  assert.deepEqual(contextSpend([{ raw_json: JSON.stringify({ context_usage: { usedTokens: 33, contextWindowTokens: 99 } }) }]), { used: 33, window: 99 });
});
test('paginates full native history and rejects broken cursors', async () => {
  let calls = 0;
  const result = await messages({ request: async () => ++calls === 1 ? { messages: [{ msg_id: 'new' }], has_more: true, next_cursor: 'older' } : { messages: [{ msg_id: 'old' }], has_more: false } }, 'mvs_1');
  assert.deepEqual(result.map((one) => one.msg_id), ['old', 'new']);
  await assert.rejects(messages({ request: async () => ({ has_more: true, next_cursor: 'same' }) }, 'mvs_1'), /pagination/);
});
test('recognizes native idle, work and explicit approval screens', () => {
  const prompt = 'Message · Enter send\n  ───────────\n› Ask Mcode to do anything\n  ───────────\nroot │ Auto │ Context 512K';
  assert.equal(terminalScreen(prompt).kind, 'idle');
  assert.equal(terminalScreen('⠋ Working · Esc interrupt\n' + prompt).kind, 'working');
  assert.equal(terminalScreen('Starting server\n' + prompt).kind, 'unknown');
  assert.equal(terminalScreen('unrecognized layout').kind, 'unknown');
  const approval = terminalScreen('◆ Approval required\nRun this command?\n› 1 Allow for this conversation\n  2 Always allow matching actions\n  3 Deny and guide MCode');
  assert.equal(approval.kind, 'question'); assert.deepEqual(approval.options[0].keys, ['1']);
  assert.equal(terminalScreen('◆ Save permission rule\nAlways allow matching actions?').kind, 'question');
  assert.equal(terminalScreen('╭─ Ask ─╮\nQuestion?\n› 1 Yes\n  2 No\n↑↓ move · 1-2 select · Enter send').options.length, 2);
  assert.equal(terminalScreen('╭─ Ask ─╮\nQuestion?\nType your answer · Enter send').input, true);
});

test('fake native mcode: bundled provider, exact multiline input, permissions, stop, resume, crash and disposal', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geckit-mcode-test-'));
  const executable = join(directory, 'mcode');
  const fixture = new URL('./fake-mcode.mjs', import.meta.url).pathname;
  const q = (text) => `'${text.replaceAll("'", "'\\''")}'`;
  await writeFile(executable, `#!/bin/sh\nexec env MCODE_TEST_DIR=${q(directory)} ${q(process.execPath)} ${q(fixture)} "$@"\n`); await chmod(executable, 0o755);
  const server = 'mcode-test-' + Date.now();
  const rpc = new McodeRpc({ command: () => executable, timeout: 5000 });
  const p = create({}, { rpc, program: async () => ({ version: '0.7.4' }), terminal: { command: () => executable, tmuxProgram: async () => ({ file: 'tmux', server: ['-L', server] }) } });
  let driver, resumed;
  try {
    assert.equal((await p.account()).signedIn, true);
    assert.equal((await p.models())[0].contextWindow, 512000);
    assert.equal((await p.limits(['minimax/MiniMax-Test'])).windows.get('minimax/MiniMax-Test'), 512000);
    const id = await p.create({ root: directory });
    const events = []; let closed = 0;
    driver = p.hold({ id, root: directory, mode: 'auto' }, (event) => events.push(event), () => closed++);
    const ended = () => events.flatMap((event) => event.signals).filter((signal) => signal.kind === 'ended');
    const prompt = "Long prompt with apostrophe ' and literal $(touch should-not-exist)\n" + 'ю🙂'.repeat(120);
    driver.send(prompt); await until(() => ended().length === 1);
    assert.equal(ended()[0].how, 'done');
    const history = await p.read(directory, id);
    assert.equal(history.items[0].text, prompt); assert.equal(history.items[1].text, 'answer: ' + prompt);
    driver.send('permission'); await until(() => events.some((event) => event.signals.some((signal) => signal.kind === 'asks')));
    const ask = events.flatMap((event) => event.signals).findLast((signal) => signal.kind === 'asks');
    driver.answer(ask.ask, ask.wanted.choices[0]); await until(() => ended().length === 2);
    driver.send('hold'); await delay(700); await driver.inject('guidance'); await until(() => ended().length === 3);
    driver.send('hold'); await delay(700); driver.stop(); await until(() => ended().length === 4); assert.equal(ended()[3].how, 'stopped');
    await driver.end(); assert.equal(closed, 1);
    const next = []; resumed = p.hold({ id, root: directory, resume: true }, (event) => next.push(event), () => {});
    resumed.send('followup'); await until(() => next.some((event) => event.signals.some((signal) => signal.kind === 'ended' && signal.how === 'done')));
    resumed.send('crash'); await until(() => next.some((event) => event.signals.some((signal) => signal.kind === 'ended' && signal.how === 'failed')));
    assert.equal((await p.read(directory, id)).items.some((item) => item.text === 'answer: followup'), true);
    assert.throws(() => driver.send('again'), /not ready/);
  } finally {
    await driver?.end(); await resumed?.end(); p.dispose();
    try { execFileSync('tmux', ['-L', server, 'kill-server'], { stdio: 'ignore' }); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
