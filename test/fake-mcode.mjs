#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const directory = process.env.MCODE_TEST_DIR;
const path = (id) => join(directory, id + '.json');
const get = (id) => JSON.parse(readFileSync(path(id), 'utf8'));
const save = (value) => writeFileSync(path(value.session.session_id), JSON.stringify(value));
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('0.7.4'); process.exit(0); }
if (args.includes('app-server')) {
  for await (const line of createInterface({ input: process.stdin })) {
    const value = JSON.parse(line);
    const out = (reply) => process.stdout.write(JSON.stringify(reply) + '\n');
    if (value.method === 'initialize') { out({ id: value.id, result: { protocolVersion: 1 } }); continue; }
    if (value.method === 'account/read') { out({ id: value.id, result: { state: 'authenticated' } }); continue; }
    const frame = value.params?.frame;
    if (frame?.type !== 'request') continue;
    const url = new URL(frame.url), body = frame.body ? JSON.parse(frame.body) : {};
    const id = url.pathname.match(/\/session\/(mvs_[a-z0-9]+)/)?.[1];
    let result = {}, status = 200;
    if (url.pathname.endsWith('/models/list')) result = { models: [{ provider_id: 'minimax', model_id: 'MiniMax-Test', display_name: 'Test', context_limit: 512000, max_output_tokens: 128000, selected: true }] };
    else if (url.pathname.endsWith('/agent/mavis/session') && frame.method === 'POST') {
      const session = { session_id: 'mvs_' + randomUUID().replaceAll('-', ''), workspace_dir: body.workspace_dir, title: 'Test', created_at: Date.now(), updated_at: Date.now(), effective_model: 'minimax/MiniMax-Test' };
      save({ session, messages: [], active: false });
      result = { session_id: session.session_id, session };
    } else if (id && existsSync(path(id))) {
      const data = get(id);
      if (url.pathname.endsWith('/message')) result = { messages: data.messages, has_more: false };
      else if (url.pathname.endsWith('/activity')) result = { state: data.active ? 1 : 0, items: [] };
      else result = { session: data.session };
    } else status = 404;
    out({ id: value.id, result: { accepted: true } });
    for (const response of [{ type: 'response-start', status }, { type: 'stream-chunk', payload: JSON.stringify(result) }, { type: 'stream-done' }]) out({ method: 'desktopService/transport', params: { frame: { id: frame.id, ...response } } });
  }
  process.exit(0);
}
const id = args[args.indexOf('--session') + 1];
get(id);
let input = '', pasting = false, busy = false, permission = false, timer;
const paint = (body) => process.stdout.write('\x1b[2J\x1b[H' + body);
const prompt = '    ───────────────────────────────────\n  › Ask Mcode to do anything\n    ───────────────────────────────────\n  project │ Auto │ ✦ Test │ Context 512K\n';
const idle = () => paint('Message · Enter send · Ctrl+J newline\n' + prompt);
const working = () => paint('⠋ Working · Esc interrupt\n' + prompt);
const message = (role, text) => {
  const data = get(id);
  data.messages.push({ msg_id: randomUUID(), role, msg_content: text, timestamp: Date.now(), ...(role === 'assistant' ? { finish_reason: 'stop', usage: { input_tokens: 100, output_tokens: 10, context_window: 512000 } } : {}) });
  save(data);
};
const active = (value) => { const data = get(id); data.active = value; save(data); busy = value; };
const reply = (text) => { message('assistant', text); active(false); idle(); };
const submit = (text) => {
  if (text.startsWith('/permission ') || text.startsWith('/plan ')) { idle(); return; }
  message('user', text); active(true); working();
  if (text === 'hold') return;
  if (text === 'permission') { permission = true; paint('╭─ ◆ Approval required ─╮\nRun this command?\n  › 1 Allow for this conversation\n    2 Always allow matching actions\n    3 Deny and guide MCode\nEnter select · Esc cancel\n'); return; }
  if (text === 'crash') process.exit(1);
  timer = setTimeout(() => reply('answer: ' + text), 250);
};
process.stdin.setRawMode(true); process.stdin.resume(); process.stdout.write('\x1b[?2004h'); idle();
process.stdin.on('data', (bytes) => {
  let data = bytes.toString();
  while (data.length) {
    if (data.startsWith('\x1b[200~')) { pasting = true; data = data.slice(6); continue; }
    if (data.startsWith('\x1b[201~')) { pasting = false; data = data.slice(6); continue; }
    const char = data[0]; data = data.slice(1);
    if (pasting) { input += char; continue; }
    if (char === '\x1b') { clearTimeout(timer); permission = false; active(false); idle(); continue; }
    if (char === '\x04' && input === '') process.exit(0);
    if (permission && char === '1') { permission = false; reply('allowed'); continue; }
    if (char === '\x15') { input = ''; continue; }
    if (char === '\r' || char === '\n') { const text = input; input = ''; submit(text); }
    else input += char;
  }
});
