import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { findTmux } from './tmux-binary.mjs';
import { mcodeCommand, mcodeEnvironment } from './mcode-rpc.mjs';
import { messageItems, contextSpend, messages, API, namespaced } from './mcode-history.mjs';

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
export function terminalScreen(text) {
  const lines = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split('\n').map((line) => line.trimEnd());
  const body = lines.join('\n');
  const border = (line) => /^\s*[─━]{5}/.test(line ?? '');
  const prompt = lines.findLastIndex((line, index) => /^\s*›\s/.test(line) && border(lines[index - 1]) && border(lines[index + 1]));
  const approvalAt = lines.findLastIndex((line) => /◆ Approval required|Always allow matching actions\?|Deny this action\?/.test(line));
  const approval = approvalAt !== -1 && (prompt === -1 || approvalAt > prompt);
  const approvalLines = approval ? dialogLines(lines.slice(approvalAt)) : [];
  const approvalText = approvalLines.join('\n');
  if (approval && /Always allow matching actions\?/.test(approvalText)) return question(dialogTitle(approvalLines), [{ label: 'Always allow matching actions', keys: ['Enter'] }, { label: 'Back', keys: ['Escape'] }]);
  if (approval && /Deny this action\?/.test(approvalText)) return question(dialogTitle(approvalLines), [{ label: 'Deny', keys: ['Enter'] }, { label: 'Back', keys: ['Escape'] }], true);
  if (approval) {
    const choices = approvalLines.map((line) => /^\s*[│┃]?\s*(?:›\s*)?([123])\s+(Allow for this conversation|Always allow matching actions|Deny and guide MCode)\b/.exec(line)).filter(Boolean);
    if (choices.length) {
      const options = choices.map((one) => ({ label: one[2], keys: [one[1]] }));
      if (/Ctrl\+E review all/.test(approvalText)) options.push({ label: 'Review all details', keys: ['C-e'] });
      return question(dialogTitle(approvalLines.slice(0, approvalLines.findIndex((line) => /^\s*(?:›\s*)?[123]\s+(?:Allow|Always|Deny)/.test(line)))), options);
    }
  }
  const askAt = lines.findLastIndex((line) => /[╭┌].*\bAsk\b/.test(line));
  if (askAt !== -1 && (prompt === -1 || askAt > prompt)) {
    const askLines = dialogLines(lines.slice(askAt));
    const frame = askLines.join('\n');
    if (/Type your answer · Enter (?:send|next)/.test(frame)) return question(dialogTitle(askLines), [], true);
    if (/↑↓ move|Space toggle/.test(frame)) {
      const multiple = /Space toggle/.test(frame);
      const options = askLines.flatMap((line) => {
        const match = /^\s*[│┃]?\s*(?:[›→]\s*)?(?:([●○])\s*)?([1-9])\s{1,}(.+?)\s*[│┃]?\s*$/.exec(line);
        return match ? [{ label: `${match[1] ? `${match[1]} ` : ''}${match[3].trim()}`, keys: [match[2]] }] : [];
      });
      if (multiple) options.push({ label: 'Submit selected', keys: ['Enter'] });
      if (/Other…/.test(frame) && !options.some((option) => option.label.includes('Other…'))) options.push({ label: 'Other…', keys: ['o'] });
      if (/more below/.test(frame)) options.push({ label: 'More options', keys: ['Down'] });
      if (/more above/.test(frame)) options.push({ label: 'Previous options', keys: ['Up'] });
      if (options.length) return question(dialogTitle(askLines), options);
    }
  }
  // Unsupported native dialogs remain visible in the attached terminal and
  // are never mistaken for completion or automatically accepted.
  const status = prompt === -1 ? body : lines.slice(Math.max(0, prompt - 4), prompt).join('\n');
  const working = /Esc (?:interrupt|to interrupt|stop)|esc (?:interrupt|to interrupt|stop)|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s/.test(status);
  return { kind: working ? 'working' : prompt !== -1 && /(?:Message · Enter send|Start · @ file|Context .*|Effort .*|Permissions)/.test(body) && !/Starting server|Checking account/.test(body) ? 'idle' : 'unknown', text: body };
}
// Keep terminal history and frame borders out of the active question.
function dialogLines(lines) {
  const end = lines.findIndex((line) => /^\s*[╰└]/.test(line));
  return (end < 0 ? lines : lines.slice(0, end)).map((line) => line
    .replace(/^\s*[╭┌][─━ ]*/, '').replace(/[─━ ]*[╮┐]\s*$/, '')
    .replace(/^\s*[│┃] ?/, '').replace(/\s*[│┃]\s*$/, '').trimEnd())
    .filter((line) => !/^\s*[─━├┤┬┴]{3}/.test(line));
}
function dialogTitle(lines) {
  return lines.filter((line) => !/^\s*(?:↑|Enter |Type your answer|Space toggle)/.test(line)).join('\n').trim();
}

function question(detail, options, input = false) {
  const title = detail.split('\n').find((line) => line.trim()) ?? 'MCode question';
  return { kind: 'question', title, detail, options, input, signature: JSON.stringify({ detail, options, input }) };
}

export function holdMcode({ rpc, options, hear, left, log = () => {}, tmuxProgram = findTmux, command = mcodeCommand, environment = mcodeEnvironment }) {
  if (process.platform === 'win32' || options.root.startsWith('ssh://')) throw new Error('MCode tmux requires a local macOS or Linux project.');
  if (options.launch || options.fork) throw new Error('MCode tmux requires local launch and a natively forked session.');
  const name = `geckit-minimax-${randomUUID().slice(0, 12)}`;
  let closed = false, running = false, turn = false, stopping = false, submitting = false, polling, started;
  let checking = false, imagesDirectory, wanted, applying, closing;
  let serial = Promise.resolve(), activity = false, idle = 0, pending, previous = new Map(), baseline = new Set();
  const emit = (items = [], gone = [], signals = []) => { if (!closed) hear({ items, gone, signals }); };
  const tmux = async (args, input) => {
    const { file, server } = await tmuxProgram();
    return new Promise((resolve, reject) => {
      const child = execFile(file, [...server, ...args], { env: environment(), timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, (error, out) => error ? reject(new Error(`tmux ${args[0]} failed.`)) : resolve(out));
      if (input !== undefined) child.stdin.end(input);
    });
  };
  const alive = () => tmux(['display-message', '-p', '-t', name, '#{pane_dead}']).then((text) => text.trim() === '0', () => false);
  const screen = async () => terminalScreen(await tmux(['capture-pane', '-p', '-t', name]));
  const resolveQuestion = () => {
    if (pending) { emit([], [`card:${pending.id}`], [{ kind: 'resolved', ask: pending.id }]); pending = undefined; }
  };
  const showQuestion = (value) => {
    if (pending?.signature === value.signature) return;
    resolveQuestion(); pending = { ...value, id: `mcode-question:${randomUUID()}` };
    emit([], [], [{ kind: 'asks', ask: pending.id, wanted: { kind: 'question', question: value.detail, choices: value.options.map((option) => option.label) } }]);
    // The host's question title is plain text; use its code/detail field for
    // multiline evidence instead of flattening the whole terminal into a title.
    emit([{ kind: 'card', id: `card:${pending.id}`, card: { kind: 'question', title: value.title, detail: value.detail, choices: value.options.map((option) => option.label) } }]);
  };
  const refresh = async () => {
    const saved = await messages(rpc, options.id);
    const items = saved.flatMap(messageItems);
    const current = new Map(items.map((item) => [item.id, JSON.stringify(item)]));
    const changed = items.filter((item) => previous.get(item.id) !== current.get(item.id));
    const gone = [...previous.keys()].filter((id) => !current.has(id));
    if (turn && saved.some((message) => !baseline.has(message.msg_id))) activity = true;
    const spend = contextSpend(saved);
    emit(changed, gone, spend ? [{ kind: 'spend', ...spend }] : []);
    previous = current;
    return saved;
  };
  const finish = (how, text) => {
    if (!turn) return;
    turn = false; stopping = false; idle = 0;
    emit([], [], [{ kind: 'ended', how, ...(text ? { text } : {}) }]);
    log('info', 'session.turn.ended', { session: options.id, outcome: how });
  };
  const close = () => {
    if (closing) return closing;
    resolveQuestion(); finish('stopped'); closed = true; clearInterval(polling);
    closing = (async () => {
      await started?.catch(() => {});
      if (running) {
        // Let MCode release native ownership/turn locks before removing the pane.
        await tmux(['send-keys', '-t', name, 'Escape', 'C-u', 'C-d']).catch(() => {});
        for (let attempt = 0; attempt < 20 && await alive(); attempt++) await delay(100);
        await tmux(['kill-session', '-t', name]).catch(() => {});
      }
      running = false;
      try {
        if (imagesDirectory) await rm(imagesDirectory, { recursive: true, force: true });
      } finally { left(); log('info', 'session.closed', { session: options.id }); }
    })();
    return closing;
  };
  const poll = async () => {
    if (closed || !running || submitting) return;
    if (!await alive()) { finish('failed', 'MCode exited.'); await close(); return; }
    const saved = await refresh();
    const shown = await screen();
    if (shown.kind === 'question') { activity = true; idle = 0; showQuestion(shown); return; }
    resolveQuestion();
    if (shown.kind === 'working') activity = true;
    if (turn && (activity || stopping) && shown.kind === 'idle') {
      // A transcript alone is insufficient: helpers/tools can still be active.
      const native = await rpc.request(`${API}/session/${options.id}/activity`);
      if (native.state === 0) idle++; else idle = 0;
      if (idle >= 2) {
        const last = saved.findLast((message) => message.role === 'assistant' && !baseline.has(message.msg_id));
        finish(stopping ? 'stopped' : last?.finish_reason === 'error' ? 'failed' : 'done');
      }
    } else idle = 0;
    await applyPermission();
  };
  const start = async () => {
    const session = (await rpc.request(`${API}/session/${options.id}`)).session;
    if (!session || session.workspace_dir !== options.root) throw new Error('MCode session does not belong to this project.');
    if (options.reasoning) {
      const model = options.model || session.effective_model || `${session.model?.provider_id}/${session.model?.model_id}`;
      const slash = model.indexOf('/');
      if (slash < 1 || model.includes('undefined')) throw new Error('Select a model before setting reasoning effort.');
      await rpc.request(`${API}/models/select`, 'POST', { session_id: options.id, provider_id: model.slice(0, slash), model_id: model.slice(slash + 1), thinking: { effort: options.reasoning } });
    }
    baseline = new Set((await refresh()).map((message) => message.msg_id));
    const env = environment();
    const args = [command(), '--session', options.id, '--tui-mode', 'regular'];
    if (options.model) args.push('--model', options.model);
    if (options.managerPrompt) args.push('--append-system-prompt', options.managerPrompt);
    const removed = Object.keys(process.env).filter((key) => key.startsWith('GECKIT_'));
    const launch = ['exec', 'env', ...removed.flatMap((key) => ['-u', key]), `PATH=${env.PATH}`, ...['MINIMAX_DATA_DIR', 'MAVIS_DATA_DIR', 'MINIMAX_PROFILE', 'MAVIS_PROFILE'].filter((key) => env[key]).map((key) => `${key}=${env[key]}`), ...args].map(quote).join(' ');
    if (closed) return;
    await tmux(['new-session', '-d', '-s', name, '-x', '140', '-y', '50', '-c', options.root, launch, ';', 'set-option', '-p', '-t', name, 'remain-on-exit', 'on']);
    running = true;
    log('info', 'session.started', { session: options.id });
    emit([], [], [{ kind: 'started', session: namespaced(options.id), key: false, ...(options.model ? { model: options.model } : {}) }]);
    polling = setInterval(() => { if (checking || closed) return; checking = true; serial = serial.then(poll).catch((error) => { if (!closed) log('warn', 'session.poll.failed', { error: error.name }); }).finally(() => { checking = false; }); }, 700);
  };
  const ready = async () => {
    for (let attempt = 0; attempt < 600; attempt++) {
      if (closed || stopping) throw new Error('MCode stopped before delivery.');
      if (!await alive()) throw new Error('MCode exited before input. Run mcode in a terminal to check login and startup.');
      const shown = await screen();
      if (shown.kind === 'idle') { resolveQuestion(); return; }
      if (shown.kind === 'question') { showQuestion(shown); attempt = 0; }
      await delay(100);
    }
    throw new Error(`MCode is waiting in its terminal. Attach with: tmux attach -t ${name}`);
  };
  const paste = async (text, guard, submit = true) => {
    if (!text) {
      await guard();
      if (submit) await tmux(['send-keys', '-t', name, 'Enter']);
      return;
    }
    const buffer = `geckit-minimax-${randomUUID()}`;
    try {
      await guard(); await tmux(['load-buffer', '-b', buffer, '-'], text);
      await guard(); await tmux(['paste-buffer', '-p', '-r', '-d', '-b', buffer, '-t', name]);
      await delay(100); await guard(); if (submit) await tmux(['send-keys', '-t', name, 'Enter']);
    } finally { await tmux(['delete-buffer', '-b', buffer]).catch(() => {}); }
  };
  const input = (text, images, before) => {
    validateImages(images);
    const prompt = [...(before ?? []), text].join('\n\n');
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(prompt)) throw new Error('Terminal control characters are not allowed in prompts.');
    return prompt;
  };
  // GeckIt moved the conversation between Manual and Auto while it runs.
  // MCode is told through its own command, and only while its terminal is
  // free: a turn in flight is never interrupted and never queued.
  const applyPermission = (beforeSend = false) => {
    if (applying) return applying;
    if (!wanted || closed || !running || (!beforeSend && (turn || submitting))) return Promise.resolve();
    applying = (async () => {
      const requested = wanted;
      const mode = { manual: 'ask', auto: 'auto', bypassPermissions: 'full' }[requested];
      if (!mode || (await screen()).kind !== 'idle') return;
      await paste(`/permission ${mode}`, async () => { if (closed || stopping) throw new Error('MCode stopped.'); });
      await delay(350); await ready();
      if (wanted === requested) wanted = undefined;
      log('info', 'session.permission.changed', { session: options.id, mode });
    })().finally(() => { applying = undefined; });
    return applying;
  };
  const attach = async (images, guard) => {
    if (!images.length) return;
    imagesDirectory ??= await mkdtemp(join(tmpdir(), 'geckit-mcode-images-'));
    const capture = () => tmux(['capture-pane', '-p', '-t', name]);
    const numbers = (text) => {
      const lines = text.split('\n');
      const editor = lines.findLastIndex((line) => /^\s*›\s/.test(line));
      // Earlier turns also contain [Image #1]; only inspect the current draft.
      return editor < 0 ? [] : [...lines.slice(editor).join('\n').matchAll(/\[Image #(\d+)\]/g)].map((match) => Number(match[1]));
    };
    for (const image of images) {
      const previous = new Set(numbers(await capture()));
      const path = join(imagesDirectory, `${randomUUID()}.${imageExtensions[image.media]}`);
      await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600, flag: 'wx' });
      // MCode recognizes a standalone bracketed-pasted absolute path as an
      // attachment. Wait for its asynchronous resolver before sending Enter.
      await paste(path, guard, false);
      let attached = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        await guard();
        if (numbers(await capture()).some((number) => !previous.has(number))) { attached = true; break; }
        await delay(100);
      }
      if (!attached) throw new Error('MCode did not accept the image attachment.');
    }
  };
  const driver = {
    send(text, images = [], before = []) {
      if (closed || submitting || turn) throw new Error('MCode is not ready for a new turn.');
      const prompt = input(text, images, before);
      submitting = true; turn = true; stopping = false; activity = false; idle = 0;
      emit([], [], [{ kind: 'begun' }]);
      void (async () => {
        const fresh = started === undefined;
        started ??= start(); await started; await applying; await ready();
        if (fresh && options.mode) {
          const mode = { manual: 'ask', auto: 'auto', plan: 'ask', bypassPermissions: 'full' }[options.mode];
          if (!mode) throw new Error(`Unsupported MCode permission mode: ${options.mode}`);
          await paste(`/permission ${mode}`, async () => { if (closed || stopping) throw new Error('MCode stopped.'); });
          await delay(350); await ready();
          await paste(`/plan ${options.mode === 'plan' ? 'on' : 'off'}`, async () => { if (closed || stopping) throw new Error('MCode stopped.'); });
          await delay(350); await ready();
        }
        while (wanted && !closed) { await ready(); await applyPermission(true); }
        baseline = new Set((await refresh()).map((message) => message.msg_id));
        const guard = async () => { if (closed || stopping) throw new Error('MCode delivery stopped.'); };
        await attach(images, guard);
        await paste(prompt, guard);
        log('info', 'message.sent', { session: options.id, delivery: 'send' });
      })().catch(async (error) => { finish(stopping ? 'stopped' : 'failed', error.message); await close(); }).finally(() => { submitting = false; });
    },
    async inject(text, images = [], before = []) {
      if (closed || !turn || stopping || submitting || pending) throw new Error('MCode cannot accept guidance now; the message remains queued.');
      const prompt = input(text, images, before);
      submitting = true;
      const guard = async () => { if (closed || !turn || stopping || !await alive() || (await screen()).kind !== 'working') throw new Error('MCode is no longer ready for guidance.'); };
      try { await attach(images, guard); await paste(prompt, guard); log('info', 'message.sent', { session: options.id, delivery: 'inject' }); }
      catch (error) { const shown = await screen().catch(() => ({})); if (shown.kind === 'idle' || shown.kind === 'working') await tmux(['send-keys', '-t', name, 'C-u']).catch(() => {}); throw error; }
      finally { submitting = false; }
    },
    answer(id, answer) {
      if (pending?.id !== id || closed) return;
      const current = pending;
      serial = serial.then(async () => {
        const shown = await screen();
        if (shown.signature !== current.signature) { resolveQuestion(); return; }
        const selected = shown.options.find((option) => option.label === answer);
        if (!selected && !shown.input) return;
        if (selected) await tmux(['send-keys', '-t', name, ...selected.keys]);
        else await paste(input(String(answer), [], []), async () => { if (closed) throw new Error('MCode closed.'); });
        resolveQuestion();
      }).catch((error) => { log('warn', 'permission.reply.failed', { error: error.name }); });
    },
    permit(mode, again = []) {
      if (closed || !['manual', 'auto', 'bypassPermissions'].includes(mode)) return;
      wanted = mode;
      // Moving to Auto hands the waiting approval back to MCode, which then
      // decides on its own what it may do.
      if (mode === 'auto' && pending !== undefined && again.includes(pending.id)) {
        const allow = pending.options.find((option) => /^Allow for this conversation$/.test(option.label));
        if (allow !== undefined) this.answer(pending.id, allow.label);
      }
      void applyPermission().catch((error) => { log('warn', 'session.permission.failed', { error: error.name }); });
    },
    stop() { if (!closed && turn) { stopping = true; resolveQuestion(); void tmux(['send-keys', '-t', name, 'Escape']).catch(() => {}); } },
    end: close,
  };
  return driver;
}

const imageExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
function validateImages(images = []) {
  for (const image of images) {
    if (!Object.hasOwn(imageExtensions, image?.media) || typeof image.data !== 'string' || !image.data.length ||
        image.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(image.data) ||
        Buffer.from(image.data, 'base64').toString('base64') !== image.data) {
      throw new Error('Image attachments must contain PNG, JPEG, GIF or WebP base64 data.');
    }
  }
}
