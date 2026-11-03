import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { create } from '../index.mjs';
import { API, namespaced, nativeId, messageItems, contextSpend, sessions } from '../src/mcode-history.mjs';

function fixture() {
  const rows = new Map([
    ['mvs_one', { session_id: 'mvs_one', workspace_dir: '/repo', title: 'One', created_at: 1, updated_at: 20 }],
    ['mvs_child', { session_id: 'mvs_child', workspace_dir: '/repo/child', title: 'Child', created_at: 2, updated_at: 30 }],
    ['mvs_other', { session_id: 'mvs_other', workspace_dir: '/repository', title: 'Other', created_at: 3, updated_at: 40 }],
  ]);
  const history = new Map([['mvs_one', [
    { msg_id: 'u', role: 'user', msg_content: 'find both words', timestamp: 10 },
    { msg_id: 'a', role: 'assistant', msg_content: '[Result](https://example.com/result)', timestamp: 11, actions: { fork: true } },
    { msg_id: 'b', role: 'assistant', msg_content: 'not forkable', timestamp: 12, actions: { fork: false } },
    { msg_id: 'c', role: 'assistant', msg_content: 'later', timestamp: 15, actions: { fork: true } },
  ]]]);
  const calls = [];
  let disposed = 0;
  const rpc = {
    account: async () => ({ state: 'authenticated' }),
    dispose() { disposed++; },
    async request(path, method = 'GET', body) {
      calls.push({ path, method, body });
      const url = new URL(path, 'http://fixture');
      if (url.pathname === `${API}/models/select`) return {};
      if (url.pathname === `${API}/agent/mavis/session`) {
        if (method === 'POST') {
          rows.set('mvs_created', { session_id: 'mvs_created', workspace_dir: body.workspace_dir, created_at: 50, updated_at: 50 });
          return { session_id: 'mvs_created' };
        }
        return { sessions: [...rows.values()], has_more: false };
      }
      const id = url.pathname.split('/')[5];
      const session = rows.get(id);
      if (!session) { const error = new Error('Not found'); error.status = 404; throw error; }
      if (url.pathname.endsWith('/message')) return { messages: history.get(id) ?? [], has_more: false };
      if (url.pathname.endsWith('/fork')) {
        const copied = { ...session, session_id: 'mvs_fork' };
        rows.set('mvs_fork', copied);
        history.set('mvs_fork', history.get(id).slice(0, 2));
        return { session: copied };
      }
      if (method === 'PATCH') session.title = body.title;
      if (method === 'DELETE') rows.delete(id);
      return { session };
    },
  };
  const quota = { windows: async () => undefined, label: () => undefined, refresh: async () => undefined, dispose() {} };
  const provider = create({}, { rpc, quota, program: async () => ({ version: '0.7.4' }) });
  return { provider, rpc, calls, rows, history, disposed: () => disposed };
}

test('every required provider member and advertised capability matches the pinned host contract', async () => {
  const snapshot = JSON.parse(await readFile(new URL('./fixtures/geckit-contracts.json', import.meta.url)));
  const f = fixture();
  const declaration = snapshot.contracts.LlmProvider.declaration;
  try {
    for (const [, name, optional] of declaration.matchAll(/^  (\w+)(\?)?\(/gm)) {
      if (optional && f.provider[name] === undefined) continue;
      assert.equal(typeof f.provider[name], 'function', name);
    }
    for (const [, name] of declaration.matchAll(/^  readonly (\w+): boolean/gm)) assert.equal(typeof f.provider[name], 'boolean', name);
    assert.ok(Number.isFinite(f.provider.idleMs) && f.provider.idleMs > 0);
    assert.equal(f.provider.family, 'plugin:minimax-tmux');
    assert.equal(f.provider.id, f.provider.family);
    assert.equal(f.provider.transport, undefined);
    assert.equal(f.provider.replaces, undefined);
    assert.equal(f.provider.runtime, undefined);
    assert.equal(f.provider.browser, 'none');
    assert.equal(f.provider.localOnly, true);
    assert.equal(f.provider.waitForExit, true);
    assert.equal(f.provider.subscriptionOnly, false);
    assert.throws(() => f.provider.hold({ id: namespaced('mvs_one'), root: '/repo', launch() {} }, () => {}, () => {}), /local launch/);
  } finally { f.provider.dispose(); }
});

test('list/search/hidden preserve namespace, project boundary and date semantics', async () => {
  const f = fixture();
  try {
    const listed = await f.provider.list(['/repo']);
    assert.deepEqual(listed.map(row => [row.id, row.root, row.project]), [
      [namespaced('mvs_one'), '/repo', undefined], [namespaced('mvs_child'), '/repo/child', '/repo'],
    ]);
    assert.deepEqual(await f.provider.list(['ssh://host/repo']), []);
    assert.deepEqual(await f.provider.search(['/repo'], 'WORDS find'), [
      { id: namespaced('mvs_one'), root: '/repo', said: 'find both words', count: 1 },
    ]);
    assert.deepEqual(await f.provider.search(['/repo'], '   '), []);
    assert.deepEqual((await f.provider.hidden(20, 30, () => true)).map(row => row.id), [namespaced('mvs_one')]);
    assert.deepEqual(await f.provider.hidden(0, 100, () => false), []);
  } finally { f.provider.dispose(); }
});

test('read/has/links reject cross-project access and distinguish absence from backend failure', async () => {
  const f = fixture(), id = namespaced('mvs_one');
  try {
    assert.equal(await f.provider.has('/repo', id), true);
    assert.equal(await f.provider.has('/other', id), false);
    assert.equal(await f.provider.read('/other', id), undefined);
    assert.equal(await f.provider.read('/repo', namespaced('missing')), undefined);
    assert.deepEqual(await f.provider.links('/other', id), []);
    assert.deepEqual(await f.provider.links('/repo', id), [{ url: 'https://example.com/result', text: 'Result' }]);
    const read = await f.provider.read('/repo', id);
    assert.deepEqual(read.items.map(item => item.id), ['u', 'a', 'b', 'c']);
    assert.deepEqual(read.tasks, []);
    f.rpc.request = async () => { throw new Error('Disconnected'); };
    await assert.rejects(f.provider.has('/repo', id), /Disconnected/);
    await assert.rejects(f.provider.read('/repo', id), /Disconnected/);
  } finally { f.provider.dispose(); }
});

test('create/fork/rename/delete use native IDs and enforce ownership before mutations', async () => {
  const f = fixture(), id = namespaced('mvs_one');
  try {
    assert.equal(await f.provider.create({ root: '/repo', mode: 'manual', model: 'minimax/model/version' }), namespaced('mvs_created'));
    assert.deepEqual(f.calls.at(-1).body, { workspace_dir: '/repo', model: { provider_id: 'minimax', model_id: 'model/version' } });
    await assert.rejects(f.provider.create({ root: 'ssh://host/repo' }), /local/);
    await assert.rejects(f.provider.create({ root: '/repo', model: 'invalid' }), /provider\/model/);
    await f.provider.rename(id, 'Renamed');
    assert.equal(f.rows.get('mvs_one').title, 'Renamed');
    const fork = await f.provider.fork('/repo', id, 12, 'manual', 'custom/model');
    assert.equal(fork.id, namespaced('mvs_fork'));
    assert.equal(fork.begun, true);
    assert.deepEqual(fork.items.map(item => item.id), ['u', 'a']);
    assert.equal(f.calls.find(call => call.path.endsWith('/fork')).body.assistant_message_id, 'a');
    assert.deepEqual(f.calls.find(call => call.path.endsWith('/models/select')).body, {session_id: 'mvs_fork', provider_id: 'custom', model_id: 'model'});
    await assert.rejects(f.provider.fork('/repo', id, 5, 'manual'), /completed assistant/);
    await assert.rejects(f.provider.delete('/other', id), /project/);
    assert.ok(f.rows.has('mvs_one'));
    assert.equal(await f.provider.delete('/repo', id), true);
    assert.equal(await f.provider.has('/repo', id), false);
    for (const call of f.calls) assert.equal(call.path.includes('plugin:'), false);
  } finally { f.provider.dispose(); }
});

test('unsupported contracts return honest empty/error results and startup remains lazy', async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.calls, []);
    assert.equal(f.provider.nativeGoals, false);
    assert.equal(f.provider.remoteControl, false);
    assert.equal(await f.provider.goal('/repo', namespaced('mvs_one')), undefined);
    await assert.rejects(f.provider.setGoal(namespaced('mvs_one'), 'goal'), /goal-driver/);
    await assert.rejects(f.provider.clearGoal(namespaced('mvs_one')), /not managed/);
    assert.equal(await f.provider.browsers('/repo'), undefined);
    assert.equal(await f.provider.setInstructions(true, {}), undefined);
    await assert.rejects(f.provider.remote({}, true), /local/);
    assert.equal((await f.provider.correct('text', 'fix', 'model')).ok, false);
    assert.deepEqual(f.calls, []);
  } finally { f.provider.dispose(); }
  assert.throws(() => f.provider.hold({ id: namespaced('mvs_one'), root: '/repo' }, () => {}, () => {}), /disposed/);
  await assert.rejects(f.provider.create({ root: '/repo' }), /disposed/);
});

test('account absence and sign-out do not trigger a quota process', async () => {
  for (const installed of [undefined, { version: '0.7.4' }]) {
    const p = create({}, {
      program: async () => installed,
      rpc: { account: async () => ({ state: 'unauthenticated' }), request: async () => ({ active_source: 'token_plan', models: [] }), dispose() {} },
      quota: { windows() { assert.fail('No quota read before authentication'); }, dispose() {} },
    });
    try {
      assert.equal(await p.program(), installed);
      const account = await p.account();
      assert.equal(account.here, installed !== undefined);
      assert.equal(account.signedIn, installed ? false : undefined);
      assert.equal(account.plan, undefined);
      assert.equal(account.key, undefined);
    } finally { p.dispose(); }
  }
});

test('models and limits preserve native selection metadata and omit unknown/invalid numbers', async () => {
  const p = create({}, {
    rpc: { request: async () => ({ models: [
      { provider_id: 'native', model_id: 'known', display_name: 'Known', context_limit: '512000', max_output_tokens: 128000, selected: true, effort_options: ['low', 'alien', 'high'] },
      { provider_id: 'native', model_id: 'unknown', context_limit: 'Infinity', max_output_tokens: -1, enabled: false },
    ] }), dispose() {} },
    quota: { windows: async () => undefined, dispose() {} },
  });
  try {
    const models = await p.models();
    assert.deepEqual(models[0], { value: 'native/known', id: 'known', name: 'Known', isDefault: true, contextWindow: 512000, maxOutputTokens: 128000, reasoning: [{ value: 'low', says: 'low' }, { value: 'high', says: 'high' }] });
    assert.equal(models[1].disabled, true);
    assert.equal(models[1].contextWindow, undefined);
    assert.equal(models[1].maxOutputTokens, undefined);
    assert.equal(models[0].pricing, undefined);
    const limits = await p.limits(['known', 'native/known', 'unknown', 'absent']);
    assert.deepEqual([...limits.windows.values()], [512000, 512000, undefined, undefined]);
    assert.equal(limits.plan, undefined);
  } finally { p.dispose(); }
});

test('the complete contract inventory has an explicit audit disposition for every type', async () => {
  const snapshot = JSON.parse(await readFile(new URL('./fixtures/geckit-contracts.json', import.meta.url)));
  const audit = await readFile(new URL('../CONTRACT-COVERAGE.md', import.meta.url), 'utf8');
  for (const [name, contract] of Object.entries(snapshot.contracts)) {
    assert.ok(contract.declaration.includes(name), name);
    assert.match(contract.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(audit.includes('`' + name + '`'), `Missing disposition: ${name}`);
  }
});

test('session pagination advances opaque cursors and rejects repeated cursors', async () => {
  const calls = [];
  const data = await sessions({ request: async path => {
    calls.push(path);
    return calls.length === 1 ? { sessions: [{ session_id: 'first' }], has_more: true, next_cursor: 'a&b' } : { sessions: [{ session_id: 'second' }], has_more: false };
  } });
  assert.deepEqual(data.map(row => row.session_id), ['first', 'second']);
  assert.match(calls[1], /cursor=a%26b$/);
  await assert.rejects(sessions({ request: async () => ({ has_more: true, next_cursor: 'same' }) }), /pagination/);
});

test('optional timestamps and null native context do not produce NaN or throw', () => {
  const item = messageItems({ msg_id: 'a', role: 'assistant', msg_content: 'answer' })[0];
  assert.equal(item.at, undefined);
  assert.equal(contextSpend([{ raw_json: 'null' }]), undefined);
  assert.equal(contextSpend([{ raw_json: '{"context_usage":{"usedTokens":-1}}' }]), undefined);
});

test('outgoing namespace rejects missing or invalid native IDs', () => {
  for (const value of [undefined, '', '../escape', 'a/b', 'a:b']) assert.throws(() => namespaced(value));
  assert.equal(nativeId(namespaced('mvs_one')), 'mvs_one');
});
