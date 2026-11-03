import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { findTmux } from './tmux-binary.mjs';
import { mcodeCommand, mcodeEnvironment } from './mcode-rpc.mjs';
import { terminalScreen } from './mcode-terminal.mjs';

const MINUTE = 60000;
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

// How long a window is left, as MCode says it: "2h 23m", "5d 11h", "45m".
export function quotaDuration(text) {
  let total = 0, found = false;
  for (const match of String(text ?? '').matchAll(/(\d+)\s*([dhms])/g)) {
    total += Number(match[1]) * { d: 86400000, h: 3600000, m: MINUTE, s: 1000 }[match[2]];
    found = true;
  }
  return found ? total : undefined;
}

/**
 * What MCode's own status panel says about the plan: the share of the
 * five-hour and weekly windows that is spent, and when each starts again.
 * Nothing is invented: a window MCode does not report is not there.
 */
export function parseQuota(text, now = Date.now()) {
  const plain = String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .split('\n').map((line) => line.replace(/^\s*[│┃]\s?/, '').replace(/\s*[│┃]\s*$/, '')).join('\n');
  const windows = {};
  for (const match of plain.matchAll(/^\s*[│┃]?\s*(5-hour|Weekly)\b[^\n]*?(\d{1,3})\s*%\s*left\b[^\n]*?resets in\s+([0-9dhms]+(?:\s*[0-9dhms]+)*)/gim)) {
    const duration = quotaDuration(match[3]);
    if (duration === undefined) continue;
    const spent = Math.max(0, Math.min(100, 100 - Number(match[2]))) / 100;
    const window = { part: spent, resetsAt: now + duration };
    if (match[1].toLowerCase() === '5-hour') windows.fiveHour = window;
    else windows.sevenDay = window;
  }
  if (!windows.fiveHour && !windows.sevenDay) return undefined;
  const account = /^\s*[│┃]?\s*Account:\s*(.+?)\s*$/im.exec(plain)?.[1];
  const label = account === undefined ? undefined : /\(([^()]+)\)\s*$/.exec(account)?.[1]?.trim();
  return { windows, ...(label ? { label } : {}) };
}

/**
 * The plan's quota, read from the MCode that is installed on this computer.
 * MCode keeps it in its own status panel and nowhere else, so it is read the
 * way a person reads it: a TUI of its own, asked once, then kept warm.
 */
export function quotaReader({ name = `geckit-mcode-quota-${randomUUID()}`, tmuxProgram = findTmux, command = mcodeCommand, environment = mcodeEnvironment, log = () => {}, every = 10 * MINUTE } = {}) {
  const tmux = async (args) => {
    const { file, server } = await tmuxProgram();
    return new Promise((resolve, reject) => {
      execFile(file, [...server, ...args], { env: environment(), timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (error, out) => error ? reject(new Error(`tmux ${args[0]} failed.`)) : resolve(out));
    });
  };
  const exists = () => tmux(['has-session', '-t', name]).then(() => true, () => false);
  const alive = () => tmux(['display-message', '-p', '-t', name, '#{pane_dead}']).then((text) => text.trim() === '0', () => false);
  const capture = () => tmux(['capture-pane', '-p', '-J', '-t', name]);
  let cached, reading, disposal, owned = false, disposed = false, lastRead = 0;

  const launch = async () => {
    const env = environment();
    const removed = Object.keys(process.env).filter((key) => key.startsWith('GECKIT_'));
    const command2 = ['exec', 'env', ...removed.flatMap((key) => ['-u', key]), `PATH=${env.PATH}`,
      ...['MINIMAX_DATA_DIR', 'MAVIS_DATA_DIR', 'MINIMAX_PROFILE', 'MAVIS_PROFILE'].filter((key) => env[key]).map((key) => `${key}=${env[key]}`),
      command(), '--tui-mode', 'regular'].map(quote).join(' ');
    await tmux(['new-session', '-d', '-s', name, '-x', '140', '-y', '50', '-c', tmpdir(), command2]);
    owned = true;
  };

  const ready = async () => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (disposed) throw new Error('MCode provider disposed.');
      if (!await alive()) throw new Error('MCode exited before the status panel.');
      if (terminalScreen(await capture()).kind === 'idle') return;
      await delay(100);
    }
    throw new Error('MCode did not become ready for /status.');
  };

  const read = async () => {
    if (disposed) return undefined;
    if (await exists() && !await alive()) await tmux(['kill-session', '-t', name]).catch(() => {});
    if (!await exists()) await launch();
    await ready();
    await tmux(['send-keys', '-t', name, '-l', '/status']);
    await delay(500);
    await tmux(['send-keys', '-t', name, 'Enter']);
    let found;
    try {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (disposed) return undefined;
        await delay(200);
        found = parseQuota(await capture());
        if (found !== undefined) break;
      }
    } finally {
      await tmux(['send-keys', '-t', name, 'Escape']).catch(() => {});
    }
    lastRead = Date.now();
    if (found !== undefined) cached = { ...found, measuredAt: lastRead };
    log('info', 'quota.read', { outcome: found === undefined ? 'unreadable' : 'completed', windows: found === undefined ? 0 : Object.keys(found.windows).length });
    return found;
  };

  const refresh = () => {
    if (disposed) return Promise.resolve(undefined);
    reading ??= read().finally(() => { reading = undefined; });
    return reading.catch((error) => {
      if (!disposed) log('warn', 'quota.read.failed', { error: error.name });
      return undefined;
    });
  };

  return {
    // The plan's windows as last read. The first reading waits for MCode;
    // later ones are answered from what is known and refreshed behind them.
    async windows() {
      if (cached === undefined) return (await refresh())?.windows;
      if (Date.now() - cached.measuredAt > every) void refresh();
      return cached.windows;
    },
    // The name of the plan, as MCode itself names it.
    label() { return cached?.label; },
    // Read the plan again, and say how long ago it was last read.
    async refresh() {
      if (Date.now() - lastRead < MINUTE) return cached;
      return refresh();
    },
    dispose() {
      disposed = true;
      return disposal ??= (async () => {
        await reading?.catch(() => {});
        if (owned) await tmux(['kill-session', '-t', name]).catch(() => {});
      })();
    },
  };
}
