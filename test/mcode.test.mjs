import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { create } from '../index.mjs';
import { terminalScreen } from '../src/mcode-terminal.mjs';
import { nativeId, messageItems, contextSpend, messages } from '../src/mcode-history.mjs';
import { McodeRpc } from '../src/mcode-rpc.mjs';
import { parseQuota, quotaDuration, quotaReader } from '../src/mcode-quota.mjs';

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

test('reads the plan from the status panel MCode shows, and nothing else', () => {
  assert.equal(quotaDuration('2h 23m'), 2 * 3600000 + 23 * 60000);
  assert.equal(quotaDuration('5d 11h'), 5 * 86400000 + 11 * 3600000);
  assert.equal(quotaDuration('45m'), 45 * 60000);
  assert.equal(quotaDuration('later'), undefined);
  const panel = [
    '╭─ MCode status ───────────────────────────────────────────────╮',
    '│   Account:      MiniMax123456 (Trial)                          │',
    '│   5-hour:       [██░░░░░░░░░░░░░░░░░░░░░░] 10% left · resets in 2h 23m │',
    '│   Weekly:       [██████████████████████░░] 90% left · resets in 5d 11h │',
    '╰───────────────────────────────────────────────────────────────╯',
  ].join('\n');
  const parsed = parseQuota(panel, 1000);
  assert.deepEqual(parsed.windows.fiveHour, { part: 0.9, resetsAt: 1000 + 2 * 3600000 + 23 * 60000 });
  assert.deepEqual(parsed.windows.sevenDay, { part: 0.1, resetsAt: 1000 + 5 * 86400000 + 11 * 3600000 });
  assert.equal(parsed.label, 'Trial');
  assert.equal(parseQuota('│   Account:      MiniMax123456 (Trial)  │'), undefined);
  assert.equal(parseQuota(''), undefined);
});

test('the plan reaches GeckIt as limits, the account plan and MCP servers', async () => {
  const plan = { fiveHour: { part: 0.9, resetsAt: Date.now() + 3600000 }, sevenDay: { part: 0.1, resetsAt: Date.now() + 86400000 } };
  const quota = { windows: async () => plan, label: () => 'Trial', refresh: async () => ({ windows: plan, label: 'Trial' }), dispose() {} };
  const rpc = { request: async (path) => {
    if (path.endsWith('/models/list')) return { models: [{ provider_id: 'minimax', model_id: 'MiniMax-Test', display_name: 'Test', context_limit: 512000, selected: true }] };
    if (path.endsWith('/mcp/servers')) return { servers: [{ name: 'test-server', enabled: true }] };
    if (path.endsWith('/mcp/runtime/servers')) return { servers: [{ name: 'test-server', configured: true }] };
    return {};
  }, account: async () => ({ state: 'authenticated' }), dispose() {} };
  const provider = create({}, { rpc, program: async () => ({ version: '0.7.4', path: '/Users/leonid/.minimax-code/bin/mcode' }), quota });
  try {
    await provider.models();
    assert.deepEqual((await provider.limits(['minimax/MiniMax-Test'])).plan, plan);
    assert.equal((await provider.limits(['minimax/MiniMax-Test'])).windows.get('minimax/MiniMax-Test'), 512000);
    const account = await provider.account();
    assert.equal(account.plan, 'Trial');
    assert.equal(account.program.from, 'the native installer');
    assert.deepEqual(await provider.mcp('/tmp'), [{ name: 'test-server', status: 'connected' }]);
  } finally { provider.dispose(); }
});

test('reads the native status layout in tmux and isolates quota reader lifetimes', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geckit-mcode-quota-'));
  const executable = join(directory, 'mcode');
  const fixture = new URL('./fake-mcode.mjs', import.meta.url).pathname;
  const q = (text) => `'${text.replaceAll("'", "'\\''")}'`;
  await writeFile(executable, `#!/bin/sh\nexec env MCODE_TEST_DIR=${q(directory)} ${q(process.execPath)} ${q(fixture)} "$@"\n`); await chmod(executable, 0o755);
  const server = 'mcode-quota-' + Date.now();
  const reader = quotaReader({ name: 'geckit-mcode-quota-test', tmuxProgram: async () => ({ file: 'tmux', server: ['-L', server] }), command: () => executable });
  const unused = quotaReader({ name: 'geckit-mcode-quota-test', tmuxProgram: async () => ({ file: 'tmux', server: ['-L', server] }) });
  try {
    const windows = await reader.windows();
    assert.equal(windows.fiveHour.part, 0.9);
    assert.equal(windows.sevenDay.part, 0.1);
    assert.equal(reader.label(), 'Trial');
    assert.ok(windows.fiveHour.resetsAt > Date.now());
    await unused.dispose();
    execFileSync('tmux', ['-L', server, 'has-session', '-t', 'geckit-mcode-quota-test']);
  } finally {
    await reader.dispose();
    try { execFileSync('tmux', ['-L', server, 'kill-server'], { stdio: 'ignore' }); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test('fake native mcode: bundled provider, exact multiline input, permissions, stop, resume, crash and disposal', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geckit-mcode-test-'));
  const executable = join(directory, 'mcode');
  const fixture = new URL('./fake-mcode.mjs', import.meta.url).pathname;
  const q = (text) => `'${text.replaceAll("'", "'\\''")}'`;
  await writeFile(executable, `#!/bin/sh\nexec env MCODE_TEST_DIR=${q(directory)} ${q(process.execPath)} ${q(fixture)} "$@"\n`); await chmod(executable, 0o755);
  const server = 'mcode-test-' + Date.now();
  const rpc = new McodeRpc({ command: () => executable, timeout: 5000 });
  const p = create({}, { rpc, program: async () => ({ version: '0.7.4' }), quota: { windows: async () => undefined, label: () => undefined, refresh: async () => undefined, dispose() {} }, terminal: { command: () => executable, tmuxProgram: async () => ({ file: 'tmux', server: ['-L', server] }) } });
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
    assert.equal(p.images, true);
    assert.throws(() => driver.send('bad', [{ media: 'text/plain', data: 'YQ==' }]), /Image attachments/);
    const pictures = [{ media: 'image/png', data: 'aW1hZ2Ux' }, { media: 'image/jpeg', data: 'aW1hZ2Uy' }];
    driver.send('', pictures); await until(() => ended().length === 2);
    const received = JSON.parse(await readFile(join(directory, nativeId(id) + '.json'))).receivedImages;
    assert.deepEqual(received.map(image => image.data), pictures.map(image => image.data));
    for (const image of received) assert.equal((await stat(image.path)).mode & 0o777, 0o600);
    driver.send('permission'); await until(() => events.some((event) => event.signals.some((signal) => signal.kind === 'asks')));
    const ask = events.flatMap((event) => event.signals).findLast((signal) => signal.kind === 'asks');
    const card = events.flatMap(event => event.items).find(item => item.id === `card:${ask.ask}`);
    assert.equal(card.card.title.includes('\n'), false);
    assert.match(card.card.detail, /Run this command/);
    await assert.rejects(driver.inject('blocked', pictures), /cannot accept guidance/);
    driver.answer(ask.ask, ask.wanted.choices[0]); await until(() => ended().length === 3);
    driver.send('hold'); await delay(700); await driver.inject('guidance', pictures); await until(() => ended().length === 4);
    const guided = JSON.parse(await readFile(join(directory, nativeId(id) + '.json'))).receivedImages;
    assert.deepEqual(guided.map(image => image.data), pictures.map(image => image.data));
    driver.permit('manual');
    await until(async () => (JSON.parse(await readFile(join(directory, nativeId(id) + '.json'))).commands ?? []).includes('/permission ask'));
    driver.send('hold'); await delay(700);
    driver.permit('auto');
    await delay(200);
    assert.equal((JSON.parse(await readFile(join(directory, nativeId(id) + '.json'))).commands ?? []).at(-1), '/permission ask');
    driver.stop(); await until(() => ended().length === 5); assert.equal(ended()[4].how, 'stopped');
    await until(async () => (JSON.parse(await readFile(join(directory, nativeId(id) + '.json'))).commands ?? []).at(-1) === '/permission auto');
    driver.permit('manual'); driver.permit('auto'); driver.permit('manual');
    driver.send('after mode change'); await until(() => ended().length === 6);
    assert.equal((JSON.parse(await readFile(join(directory, nativeId(id) + '.json'))).commands ?? []).at(-1), '/permission ask');
    assert.equal((await p.read(directory, id)).items.findLast(item => item.kind === 'theirs').text, 'answer: after mode change');
    await driver.end(); assert.equal(closed, 1);
    for (const image of [...received, ...guided]) await assert.rejects(stat(image.path), { code: 'ENOENT' });
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

test('approval cards isolate evidence, preserve pipes and ignore transcript changes', () => {
  const frame = `╭─ ◆ Approval required ─ Bash ─╮
│ Run this command?            │
│ $ cat file | sort            │
│ Why · Needs confirmation     │
│ Details 6 of 47 lines · Ctrl+E review all │
│ › 1 Allow for this conversation │
│     MCode asks again in a new conversation │
│   2 Always allow matching actions │
│   3 Deny and guide MCode      │
├──────────────────────────────┤
│ ↑/↓ choose · Enter confirm · Esc deny │
╰──────────────────────────────╯
project | Auto | Context 48% left`;
  const parsed = terminalScreen('Old transcript\n' + frame);
  assert.equal(parsed.kind, 'question');
  assert.match(parsed.detail, /cat file \| sort/);
  assert.doesNotMatch(parsed.detail, /Old transcript|project|MCode asks again|[│╭╰]|Enter confirm/);
  assert.equal(parsed.options[0].label, 'Allow for this conversation');
  assert.deepEqual(parsed.options.at(-1).keys, ['C-e']);
  assert.equal(parsed.signature, terminalScreen('Changed transcript\n' + frame).signature);
  assert.equal(parsed.title.includes('\n'), false);
});
