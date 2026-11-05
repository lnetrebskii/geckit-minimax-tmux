import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { parseQuota, quotaReader } from '../src/mcode-quota.mjs';

test('reads the actual /usage layout with a credit balance and no subscription', () => {
  const panel = [
    'Usage                                                    Account only',
    'Model  minimax/MiniMax-M3.1-Flash',
    '',
    'This session',
    'No token activity yet.',
    '',
    'Account',
    'Plan                                                       Token Plan',
    'Credits                                                         1,250',
    'Quota                                      No Token Plan subscription',
  ].join('\n');
  assert.deepEqual(parseQuota(panel), {
    windows: {}, credits: 1250, unavailableReason: 'No active Token Plan subscription',
  });
  assert.equal(parseQuota('Plan  Pro\nCredits  0').label, 'Pro');
  assert.equal(parseQuota('Plan  Pro\nCredits  0').credits, 0);
  assert.equal(parseQuota('\x1b[32m│ Credits: 1,234.5 │\x1b[0m').credits, 1234.5);
  for (const balance of ['—', 'unknown', '-1', 'NaN', 'Infinity', '1,23', '1,234x', '9007199254740992', '']) {
    const parsed = parseQuota(`Credits  ${balance}\nQuota  No Token Plan subscription`);
    assert.equal(parsed?.credits, undefined, balance);
  }
  assert.equal(parseQuota('Credits\n1250'), undefined);
  assert.equal(parseQuota('Session total 1250 tokens'), undefined);
});

test('refreshes credits after the trial ends, keeps zero distinct from unknown, and coalesces reads', async () => {
  let exists = false, inspection = false, report = 'Plan  Trial\nCredits  1,250\n5-hour: 90% left · resets in 1h';
  let reads = 0, launches = 0, kills = 0;
  const commands = [];
  const log = [];
  const execute = (_file, args, _options, done) => {
    commands.push(args);
    switch (args[0]) {
      case 'has-session': done(exists ? null : new Error('No session'), ''); break;
      case 'new-session': exists = true; launches++; done(null, ''); break;
      case 'display-message': done(null, '0'); break;
      case 'capture-pane': done(null, inspection ? report : 'Message · Enter send\n──────────\n› Ask Mcode to do anything\n──────────\nroot │ Auto │ Context 512K'); break;
      case 'send-keys':
        if (args.at(-1) === 'Enter') { inspection = true; reads++; }
        if (args.at(-1) === 'Escape') inspection = false;
        done(null, ''); break;
      case 'kill-session': exists = false; kills++; done(null, ''); break;
      default: done(new Error('Unexpected tmux command'), '');
    }
  };
  const options = { execute, every: -1, tmuxProgram: async () => ({ file: 'fake-tmux', server: [] }), command: () => 'fake-mcode', environment: () => ({ PATH: '/bin' }), log: (...args) => log.push(args) };
  const reader = quotaReader(options);
  const unused = quotaReader(options);
  const waitForRead = async (count) => {
    for (let n = 0; n < 200 && log.length < count; n++) await delay(20);
    assert.equal(log.length, count);
  };
  try {
    const [one, two] = await Promise.all([reader.windows(), reader.windows()]);
    assert.deepEqual(one, two);
    assert.equal(reads, 1);
    assert.equal(reader.credits(), 1250);
    assert.equal(reader.label(), 'Trial');
    assert.ok(Number.isFinite(reader.measuredAt()));
    report = 'Plan  Token Plan\nCredits  0\nQuota  No Token Plan subscription';
    await reader.windows(); // Starts a background refresh of the same private TUI.
    await waitForRead(2);
    assert.equal(reader.credits(), 0);
    assert.equal(reader.label(), undefined);
    assert.equal(reader.unavailableReason(), 'No active Token Plan subscription');
    assert.deepEqual((await reader.refresh()).windows, {});
    report = 'Plan  Token Plan\nQuota  Temporarily unavailable';
    await reader.windows();
    await waitForRead(3);
    assert.equal(reader.credits(), undefined);
    assert.equal(reader.unavailableReason(), 'MiniMax is temporarily not reporting limits');
    assert.equal(launches, 1);
    await unused.dispose();
    assert.equal(kills, 0);
    const pasted = commands.filter(args => args[0] === 'send-keys' && args.includes('-l')).map(args => args.at(-1));
    assert.deepEqual(pasted, ['/usage', '/usage', '/usage']);
    assert.equal(JSON.stringify(log).includes('1250'), false);
  } finally {
    await reader.dispose();
    assert.equal(kills, 1);
  }
});
