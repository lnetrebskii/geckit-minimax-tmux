import assert from 'node:assert/strict';
import test from 'node:test';
import { holdMcode } from '../src/mcode-terminal.mjs';
import { createLogin } from '../src/mcode-login.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const until = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(10); }
  throw new Error('Timed out');
};

for (const state of ['login_required', 'unauthenticated']) {
  test(`missing login (${state}) offers sign-in before opening tmux; cancellation preserves the message`, async () => {
    const events = [];
    let left;
    const closed = new Promise(resolve => { left = resolve; });
    const driver = holdMcode({
      rpc: {
        account: async () => ({ state }),
        request: async path => {
          if (path.includes('/models/list')) return { models: [{ selected: true, provider_id: 'minimax' }] };
          if (path.endsWith('/minimax-source')) return { active_source: 'token_plan' };
          assert.fail(`Unexpected request before login: ${path}`);
        },
      },
      options: { id: 'mvs_auth', root: '/tmp' },
      hear: event => events.push(event), left,
      tmuxProgram: async () => assert.fail('Must not open a terminal before login'),
    });
    driver.send('Do not lose this message');
    await until(() => events.some(e => e.signals.some(s => s.kind === 'asks')));
    const ask = events.flatMap(e => e.signals).find(s => s.kind === 'asks');
    assert.deepEqual(ask.wanted.choices, ['Sign in (Global)', 'Sign in (China)', 'Cancel']);
    driver.answer(ask.ask, 'Cancel');
    await closed;
    assert.deepEqual(events.flatMap(e => e.signals).filter(s => s.kind === 'ended').map(s => s.how), ['signedOut']);
    assert.match(events.flatMap(e => e.items).find(i => i.kind === 'note').text, /mcode login --region global/);
  });
}

for (const region of ['Global', 'China']) {
  test(`login runs in a separate tmux session for ${region}, shows the URL and verifies the account`, async () => {
    const calls = [], events = [];
    let dead = false, checked = false;
    const url = `https://account.minimax.${region === 'Global' ? 'io' : 'cn'}/oauth-authorize?user_code=TEST-CODE`;
    const login = createLogin({
      command: () => '/path with space/mcode', environment: () => ({ PATH: '/bin', MINIMAX_PROFILE: 'my profile' }), root: '/tmp',
      account: async () => { checked = true; return { state: 'authenticated' }; },
      emit: (items = [], gone = [], signals = []) => events.push({ items, gone, signals }),
      tmux: async args => {
        calls.push(args);
        if (args[0] === 'capture-pane') return `Open: ${url}\nCode: TEST-CODE\nWaiting for authorization…`;
        if (args[0] === 'display-message') return dead ? '1:0' : '0:';
        return '';
      },
    });
    const work = login.run();
    const first = events.flatMap(e => e.signals).find(s => s.kind === 'asks');
    login.answer(first.ask, `Sign in (${region})`);
    await until(() => events.some(e => e.items.some(i => i.card?.detail.includes(url))));
    assert.equal(checked, false);
    dead = true;
    await work;
    assert.equal(checked, true);
    const spawn = calls.find(c => c[0] === 'new-session');
    assert.match(spawn[3], /^geckit-minimax-login-/);
    assert.ok(spawn.includes('500'));
    assert.ok(spawn.some(arg => arg.includes(`'login' '--region' '${region === 'Global' ? 'global' : 'cn'}'`)));
    assert.ok(spawn.some(arg => arg.includes("'/path with space/mcode'")));
    assert.ok(calls.some(c => c[0] === 'kill-session' && c[2] === spawn[3]));
    assert.ok(events.some(e => e.items.some(i => /Continuing your message/.test(i.text))));
    assert.equal(login.active, false);
  });
}

for (const outcome of ['cancel', 'exit-error', 'not-authenticated', 'timeout']) {
  test(`login cleans up after ${outcome}`, async () => {
    const events = [], calls = [];
    const login = createLogin({
      command: () => 'mcode', environment: () => ({ PATH: '/bin' }), root: '/tmp',
      timeout: outcome === 'timeout' ? 0 : 1000,
      account: async () => ({ state: 'login_required' }),
      emit: (items = [], gone = [], signals = []) => events.push({ items, gone, signals }),
      tmux: async args => {
        calls.push(args);
        if (args[0] === 'display-message') return outcome === 'exit-error' ? '1:1' : outcome === 'not-authenticated' ? '1:0' : '0:';
        return '';
      },
    });
    const work = login.run();
    const rejected = assert.rejects(work, error => error.status === 401);
    login.answer(events[0].signals[0].ask, 'Sign in (Global)');
    if (outcome === 'cancel') {
      await until(() => calls.some(c => c[0] === 'new-session'));
      await login.end();
    }
    await rejected;
    assert.ok(calls.some(c => c[0] === 'kill-session'));
    assert.equal(login.active, false);
    assert.ok(events.some(e => e.signals.some(s => s.kind === 'resolved')));
  });
}

for (const provider of ['custom', 'minimax']) {
  test(`API-key ${provider} does not require OAuth`, async () => {
    let reachedSession = false;
    let left;
    const closed = new Promise(resolve => { left = resolve; });
    const events = [];
    const driver = holdMcode({
      rpc: {
        account: async () => assert.fail('OAuth must not be checked for API-key models'),
        request: async path => {
          if (path.includes('/models/list')) return { models: [{ selected: true, provider_id: provider }] };
          if (path.endsWith('/minimax-source')) return { active_source: 'minimax_api_key' };
          reachedSession = true;
          throw new Error('End fixture after auth preflight');
        },
      },
      options: { id: 'mvs_auth', root: '/tmp' }, hear: event => events.push(event), left,
    });
    driver.send('hello');
    await closed;
    assert.equal(reachedSession, true);
    assert.equal(events.flatMap(e => e.signals).some(s => s.how === 'signedOut'), false);
  });
}
