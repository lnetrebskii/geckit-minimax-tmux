import { spawn, execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { createInterface } from 'node:readline';

export function mcodeEnvironment() {
  const env = { ...process.env };
  env.PATH = [...(env.PATH ?? '').split(delimiter), join(homedir(), '.minimax-code', 'bin'), join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'].join(delimiter);
  for (const key of Object.keys(env)) if (key.startsWith('GECKIT_')) delete env[key];
  return env;
}
export function mcodeCommand() {
  if (process.env.GECKIT_MCODE_COMMAND) return process.env.GECKIT_MCODE_COMMAND;
  return mcodeEnvironment().PATH.split(delimiter).map((dir) => join(dir, 'mcode')).find(existsSync) ?? 'mcode';
}
export const program = () => new Promise((resolve) => execFile(mcodeCommand(), ['--version'], { env: mcodeEnvironment(), timeout: 15000 }, (error, stdout) => {
  const version = stdout?.trim().match(/^\d+\.\d+\.\d+[^\s]*/)?.[0];
  let path = mcodeCommand();
  try { path = realpathSync(path); } catch {}
  resolve(error || !version ? undefined : { version, path });
}));

// MCode's local DesktopService control plane; prompts still go only through
// the interactive TUI in tmux. No OAuth tokens or API keys cross this boundary.
export class McodeRpc {
  constructor({ command = mcodeCommand, environment = mcodeEnvironment, timeout = 60000 } = {}) {
    this.command = command; this.environment = environment; this.timeout = timeout;
    this.pending = new Map(); this.streams = new Map(); this.sequence = 0;
  }
  async ready() {
    if (this.disposed) throw new Error('MCode provider has been disposed.');
    return this.starting ??= this.start().catch((error) => { this.child?.kill('SIGTERM'); this.starting = undefined; throw error; });
  }
  async start() {
    this.child = spawn(this.command(), ['app-server', '--stdio'], { cwd: homedir(), env: this.environment(), stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    this.child.stdin.on('error', () => this.failed(new Error('MCode control input disconnected.')));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => { try { this.received(JSON.parse(line)); } catch {} });
    this.child.on('error', () => this.failed(new Error('Cannot start mcode. Install MiniMax Code and run mcode login.')));
    this.child.on('exit', () => { this.starting = undefined; this.failed(new Error('MCode control process exited.')); });
    const result = await this.call('initialize', { protocolVersion: 1, clientInfo: { name: 'geckit-minimax-tmux', version: '1.0.0' }, capabilities: { desktopService: { transportProtocolVersion: 2 } } });
    if (result.protocolVersion !== 1) throw new Error('Unsupported MCode app-server protocol.');
    this.write({ method: 'initialized' });
  }
  write(value) {
    if (!this.child?.stdin.writable) throw new Error('MCode control process is disconnected.');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  wait(map, id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { map.delete(id); reject(new Error('MCode control request timed out.')); }, this.timeout);
      map.set(id, { resolve: (value) => { clearTimeout(timer); map.delete(id); resolve(value); }, reject: (error) => { clearTimeout(timer); map.delete(id); reject(error); }, chunks: [] });
    });
  }
  call(method, params) {
    const id = ++this.sequence;
    const result = this.wait(this.pending, id);
    try { this.write({ id, method, params }); } catch (error) { this.pending.get(id)?.reject(error); }
    return result;
  }
  received(value) {
    if (!value || typeof value !== 'object') return;
    if (value.id !== undefined) {
      const pending = this.pending.get(value.id);
      if (value.error) pending?.reject(new Error(`MCode RPC ${value.error.code}: ${value.error.message}`));
      else pending?.resolve(value.result);
      return;
    }
    const frame = value.params?.frame;
    if (value.method !== 'desktopService/transport' || !frame) return;
    const stream = this.streams.get(frame.id);
    if (!stream) return;
    if (frame.type === 'response-start') {
      if (!Number.isInteger(frame.status) || frame.status < 100 || frame.status > 599) {
        stream.reject(new Error('Invalid MCode service status.')); return;
      }
      stream.status = frame.status;
    }
    if (frame.type === 'stream-chunk') {
      if (typeof frame.payload !== 'string' && typeof frame.payload?.data !== 'string') {
        stream.reject(new Error('Invalid MCode service chunk.')); return;
      }
      stream.chunks.push(typeof frame.payload === 'string' ? Buffer.from(frame.payload) : Buffer.from(frame.payload.data, 'base64'));
      try { this.write({ method: 'desktopService/transport', params: { frame: { type: 'stream-credit', id: frame.id, credits: 1 } } }); }
      catch (error) { stream.reject(error); }
    }
    if (frame.type === 'stream-error') stream.reject(new Error('MCode local service failed.'));
    if (frame.type === 'stream-done') {
      if (stream.status === undefined) { stream.reject(new Error('MCode service response has no status.')); return; }
      const text = Buffer.concat(stream.chunks).toString('utf8');
      if (stream.status >= 400) { const error = new Error(`MCode local service HTTP ${stream.status}`); error.status = stream.status; stream.reject(error); }
      else { try { stream.resolve(text ? JSON.parse(text) : {}); } catch { stream.reject(new Error('Invalid MCode service response.')); } }
    }
  }
  async request(path, method = 'GET', body) {
    await this.ready();
    const id = `geckit-${++this.sequence}`;
    const result = this.wait(this.streams, id);
    result.catch(() => {}); // The stream can fail before its RPC acknowledgement.
    try {
      await this.call('desktopService/transport', { frame: { type: 'request', id, method, url: `http://local-runtime.transport${path}`, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), streamWindow: 16 } });
    } catch (error) { this.streams.get(id)?.reject(error); }
    return result;
  }
  async account() { await this.ready(); return this.call('account/read', {}); }
  failed(error) { for (const map of [this.pending, this.streams]) for (const pending of [...map.values()]) pending.reject(error); }
  dispose() {
    this.disposed = true;
    this.failed(new Error('MCode provider disposed.'));
    this.lines?.close(); this.child?.stdin.end();
    const child = this.child;
    if (child) { const timer = setTimeout(() => child.kill('SIGTERM'), 3000); timer.unref(); child.once('exit', () => clearTimeout(timer)); }
  }
}
