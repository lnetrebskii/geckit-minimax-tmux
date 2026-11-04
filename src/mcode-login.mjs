import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const signInError = text => Object.assign(new Error(text), { status: 401 });

// Login owns a separate terminal: shell commands must never be pasted into
// the coding agent's prompt. Only the native CLI handles OAuth credentials.
export function createLogin({ tmux, command, environment, root, account, emit, timeout = 300000 }) {
  let active, question, choose, cancelled = false;
  const resolveQuestion = () => {
    if (!question) return;
    emit([], [`card:${question.id}`], [{ kind: 'resolved', ask: question.id }]);
    question = undefined;
  };
  const ask = (title, detail, choices) => {
    resolveQuestion();
    question = { id: `mcode-login:${randomUUID()}`, choices };
    // The host creates its default card on asks; enrich it afterwards so the
    // authorization URL remains visible in the detail field.
    emit([], [], [{ kind: 'asks', ask: question.id, wanted: { kind: 'question', question: title, choices } }]);
    emit([{ kind: 'card', id: `card:${question.id}`, card: { kind: 'question', title, detail, choices } }]);
  };
  const cancel = () => { cancelled = true; choose?.('Cancel'); resolveQuestion(); };
  const run = async () => {
    cancelled = false;
    let spawned = false;
    const name = `geckit-minimax-login-${randomUUID()}`;
    try {
      const selection = new Promise(resolve => { choose = resolve; });
      ask('Sign in to MiniMax Code', 'Your message has not been sent. Choose your account region to open browser sign-in.', ['Sign in (Global)', 'Sign in (China)', 'Cancel']);
      const selected = await selection;
      choose = undefined;
      if (cancelled || selected === 'Cancel') throw signInError('MiniMax sign-in cancelled. Your message has not been sent.');
      const region = selected === 'Sign in (China)' ? 'cn' : 'global';
      ask('Waiting for MiniMax sign-in', 'Opening browser authorization. Complete sign-in in your browser to continue.', ['Cancel']);
      const env = environment();
      const removed = Object.keys(process.env).filter(key => key.startsWith('GECKIT_'));
      const launch = ['exec', 'env', ...removed.flatMap(key => ['-u', key]), `PATH=${env.PATH}`,
        ...['MINIMAX_DATA_DIR', 'MAVIS_DATA_DIR', 'MINIMAX_PROFILE', 'MAVIS_PROFILE'].filter(key => env[key]).map(key => `${key}=${env[key]}`),
        command(), 'login', '--region', region].map(quote).join(' ');
      await tmux(['new-session', '-d', '-s', name, '-x', '500', '-y', '40', '-c', root, launch, ';', 'set-option', '-p', '-t', name, 'remain-on-exit', 'on']);
      spawned = true;
      const deadline = Date.now() + timeout;
      let displayed;
      while (!cancelled && Date.now() < deadline) {
        const screen = await tmux(['capture-pane', '-p', '-J', '-t', name]);
        // Never expose arbitrary terminal output or tokens as a login URL.
        const candidate = screen.match(/https:\/\/account\.minimax\.(?:io|cn)\/oauth-authorize\?[^\s\x1b]+/)?.[0];
        if (candidate && candidate !== displayed) {
          const url = new URL(candidate);
          if (url.hostname !== (region === 'cn' ? 'account.minimax.cn' : 'account.minimax.io')) throw signInError('MiniMax returned a sign-in link for a different region.');
          displayed = candidate;
          ask('Complete MiniMax sign-in in your browser', `If the browser did not open, copy this URL:\n${candidate}\n\nYour message will continue after sign-in.`, ['Cancel']);
        }
        const status = (await tmux(['display-message', '-p', '-t', name, '#{pane_dead}:#{pane_dead_status}'])).trim();
        if (status.startsWith('1:')) {
          if (status !== '1:0') throw signInError('MiniMax sign-in did not complete. Please try again.');
          if ((await account()).state !== 'authenticated') throw signInError('MiniMax has not confirmed sign-in. Please retry.');
          if (cancelled) break;
          emit([{ kind: 'note', id: `mcode-login-done:${randomUUID()}`, note: 'mode', text: 'Signed in to MiniMax Code. Continuing your message.' }]);
          return;
        }
        await delay(250);
      }
      throw signInError(cancelled ? 'MiniMax sign-in cancelled.' : 'MiniMax sign-in timed out. Please try again.');
    } finally {
      choose = undefined;
      resolveQuestion();
      if (spawned) await tmux(['kill-session', '-t', name]).catch(() => {});
    }
  };
  return {
    get active() { return active !== undefined; },
    run() { return active ??= run().finally(() => { active = undefined; }); },
    answer(id, answer) {
      if (question?.id !== id) return false;
      if (!question.choices.includes(answer)) return true;
      if (answer === 'Cancel') cancel();
      else { choose?.(answer); resolveQuestion(); }
      return true;
    },
    cancel,
    async end() { cancel(); await active?.catch(() => {}); },
  };
}
