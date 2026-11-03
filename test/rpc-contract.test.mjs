import assert from 'node:assert/strict';
import test from 'node:test';
import { McodeRpc } from '../src/mcode-rpc.mjs';

function transport(respond) {
  const rpc = new McodeRpc({ timeout: 40 });
  const sent = [];
  rpc.ready = async () => {};
  rpc.write = message => {
    sent.push(message);
    if (message.id !== undefined) queueMicrotask(() => respond(message, rpc));
  };
  return { rpc, sent };
}
const frame = (rpc, id, type, extra = {}) => rpc.received({ method: 'desktopService/transport', params: { frame: { id, type, ...extra } } });

test('RPC assembles interleaved streams, grants credits and preserves request bodies', async () => {
  const held = [];
  const { rpc, sent } = transport((message, rpc) => {
    held.push(message);
    if (held.length !== 2) return;
    for (const request of held.reverse()) {
      rpc.received({ id: request.id, result: { accepted: true } });
      const id = request.params.frame.id;
      frame(rpc, id, 'response-start', { status: 200 });
      frame(rpc, id, 'stream-chunk', { payload: '{"url":' });
      frame(rpc, id, 'stream-chunk', { payload: { data: Buffer.from(JSON.stringify(request.params.frame.url) + '}').toString('base64') } });
      frame(rpc, id, 'stream-done');
    }
  });
  const [first, second] = await Promise.all([rpc.request('/first', 'POST', { text: 'ю🙂\n' }), rpc.request('/second')]);
  assert.match(first.url, /\/first$/); assert.match(second.url, /\/second$/);
  assert.equal(JSON.parse(sent[0].params.frame.body).text, 'ю🙂\n');
  assert.equal(sent.filter(value => value.params?.frame.type === 'stream-credit').length, 4);
  assert.equal(rpc.pending.size, 0); assert.equal(rpc.streams.size, 0);
  rpc.dispose();
});

for (const failure of ['http', 'invalid-json', 'stream-error', 'rpc-error', 'timeout', 'missing-status', 'invalid-chunk']) {
  test(`RPC rejects ${failure} without returning a successful empty response`, async () => {
    const { rpc } = transport((message, rpc) => {
      if (failure === 'rpc-error') { rpc.received({ id: message.id, error: { code: -1, message: 'Rejected' } }); return; }
      rpc.received({ id: message.id, result: { accepted: true } });
      if (failure === 'timeout') return;
      const id = message.params.frame.id;
      if (failure !== 'missing-status') frame(rpc, id, 'response-start', { status: failure === 'http' ? 403 : 200 });
      if (failure === 'stream-error') { frame(rpc, id, 'stream-error'); return; }
      frame(rpc, id, 'stream-chunk', { payload: failure === 'invalid-chunk' ? null : failure === 'invalid-json' ? '{' : '{}' });
      frame(rpc, id, 'stream-done');
    });
    await assert.rejects(rpc.request('/test'), error => failure !== 'http' || error.status === 403);
    assert.equal(rpc.pending.size, 0); assert.equal(rpc.streams.size, 0);
    rpc.dispose();
  });
}

test('disposal rejects in-flight requests and blocks restarting a disposed transport', async () => {
  const { rpc } = transport(() => {});
  const waiting = rpc.request('/waiting');
  const rejection = assert.rejects(waiting, /disposed/);
  await Promise.resolve();
  rpc.dispose();
  await rejection;
  await assert.rejects(McodeRpc.prototype.ready.call(rpc), /disposed/);
});

test('missing CLI fails initialization without waiting for a response timeout', async () => {
  const rpc = new McodeRpc({ command: () => '/nonexistent/geckit-mcode-test', timeout: 2000 });
  try { await assert.rejects(rpc.ready(), /Cannot start/); }
  finally { rpc.dispose(); }
});
