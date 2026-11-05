import { randomUUID } from 'node:crypto';
import { McodeRpc, program } from './mcode-rpc.mjs';
import { holdMcode } from './mcode-terminal.mjs';
import { quotaReader } from './mcode-quota.mjs';
import { backgroundTasks, selectedModel, usesKey, quotaUsage, efforts } from './mcode-state.mjs';
import { instructionGuide } from './mcode-guide.mjs';
import { API, ID, nativeId, namespaced, messages, messageItemsWithImages, contextSpend, sessions, providerRow, messageLinks } from './mcode-history.mjs';

const local = (root) => typeof root === 'string' && !root.startsWith('ssh://');
const inRoot = (path, root) => path === root || path?.startsWith(root.replace(/\/$/, '') + '/');
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const modelSelection = (value) => {
  const at = value.indexOf('/');
  if (at <= 0 || at === value.length - 1) throw new Error('Select a provider/model from MCode’s model list.');
  return { provider_id: value.slice(0, at), model_id: value.slice(at + 1) };
};
// How MCode was put on this machine, as GeckIt says it for the other tools.
const installFrom = (path) => {
  if (typeof path !== 'string') return undefined;
  if (path.includes('/.minimax-code/')) return 'the native installer';
  if (path.includes('node_modules/@minimax-ai/code')) return 'npm';
  if (path.includes('/Cellar/') || path.includes('/homebrew/')) return 'Homebrew';  return undefined;
};
export function create(context = {}, dependencies = {}) {
  const rpc = dependencies.rpc ?? new McodeRpc();
  const log = (level, event, fields) => { try { context.log?.write(level, event, fields); } catch {} };
  const drivers = new Set();
  let disposed = false, known = [], reported;
  const quota = dependencies.quota ?? quotaReader({ log });
  const guide = dependencies.guide ?? instructionGuide();
  const info = async (root, id) => {
    const native = nativeId(id);
    const session = (await rpc.request(`${API}/session/${native}`)).session;
    if (!session || !local(root) || session.workspace_dir !== root) { const error = new Error('MCode session does not belong to this project.'); error.status = 404; throw error; }
    return session;
  };
  const read = async (root, id) => {
    try { await info(root, id); } catch (error) { if (error.status === 404) return undefined; throw error; }
    const saved = await messages(rpc, nativeId(id));
    return { items: (await Promise.all(saved.map(message => messageItemsWithImages(message, root)))).flat(), tasks: await backgroundTasks(rpc, nativeId(id)), ...contextSpend(saved) };
  };
  // The plan is the account's, so it is said once for every conversation.
  const reportPlan = async () => {
    if (await usesKey(rpc, await selectedModel(rpc)) === true) return;
    const found = await quota.refresh();
    if (!found?.windows) return;
    const said = JSON.stringify(reported);
    reported = quotaUsage(found.windows, found.measuredAt, found.unavailableReason, found.credits);
    if (said === JSON.stringify(reported)) return;
    for (const driver of drivers) driver.report({ items: [], gone: [], signals: [{ kind: 'plan', plan: found.windows }, { kind: 'usage', usage: reported }] });
  };
  const provider = {
    id: ID, family: ID, name: 'MiniMax Code (tmux)', shortName: 'MCode', icon: 'terminal', browser: 'none',
    loginCommand: 'mcode login --region global', resumeCommand: 'mcode --session {id}', planName: 'MiniMax', localOnly: true,
    available: true, subscriptionOnly: false, images: true, remoteControl: false, nativeGoals: false,
    idleMs: 3600000, waitForExit: true, instructions: 'own', setInstructions: async (enabled) => { guide.set(enabled); },
    program: dependencies.program ?? program,
    account: async () => {
      const installed = await (dependencies.program ?? program)();
      if (!installed) return { provider: ID, here: false, signedIn: undefined };
      const account = await rpc.account();
      const from = installFrom(installed.path);
      const program2 = { ...installed, ...(from === undefined ? {} : { from }) };
      const model = await selectedModel(rpc);
      const key = await usesKey(rpc, model);
      if (key === true) return { provider: ID, here: true, signedIn: model?.enabled === true ? true : undefined, key, program: program2 };
      if (account.state !== 'authenticated') return { provider: ID, here: true, signedIn: false, program: program2 };
      const plan = await quota.windows();
      const label = quota.label();
      return { provider: ID, here: true, signedIn: true, program: program2,
        ...(key === undefined ? {} : { key }), ...(plan === undefined ? {} : { usage: quotaUsage(plan, quota.measuredAt?.(), quota.unavailableReason?.(), quota.credits?.()) }),
        ...(plan === undefined || label === undefined ? {} : { plan: label }) };
    },
    models: async () => {
      const data = await rpc.request(`${API}/models/list`);
      known = (data.models ?? []).map((model) => ({ value: `${model.provider_id}/${model.model_id}`, id: model.model_id,
        name: model.display_name || model.model_id, isDefault: model.selected === true,
        ...(model.enabled === false ? { disabled: true } : {}),
        ...(positive(model.context_limit) ? { contextWindow: Number(model.context_limit) } : {}),
        ...(positive(model.max_output_tokens) ? { maxOutputTokens: Number(model.max_output_tokens) } : {}),
        ...(efforts.includes(model.default_effort) ? { defaultReasoning: model.default_effort } : {}),
        reasoning: (model.effort_options ?? []).filter((value) => ['none','minimal','low','medium','high','xhigh','max','ultra'].includes(value)).map((value) => ({ value, says: value })),
      }));
      return known;
    },
    limits: async (models) => {
      if (!known.length && models.length) await provider.models();
      const windows = new Map(models.map((model) => [model, known.find((item) => item.value === model || item.id === model)?.contextWindow]));
      const selected = known.find(model => model.isDefault)?.value;
      if (await usesKey(rpc, selected ? { provider_id: selected.split('/')[0] } : undefined) === true) return { windows };
      const plan = await quota.windows();
      return { windows, ...(plan === undefined ? {} : { plan, ...quotaUsage(plan, quota.measuredAt?.(), quota.unavailableReason?.(), quota.credits?.()) }) };
    },
    list: async (roots) => (await sessions(rpc)).filter((session) => roots.some((root) => local(root) && inRoot(session.workspace_dir, root))).map((session) => {
      const row = providerRow(session), parent = roots.find((root) => inRoot(row.root, root));
      return parent === row.root ? row : { ...row, project: parent };
    }),
    search: async (roots, asked) => {
      const words = asked.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const found = [];
      for (const session of await sessions(rpc)) {
        if (!roots.some((root) => local(root) && inRoot(session.workspace_dir, root))) continue;
        const matched = (await messages(rpc, session.session_id)).filter((message) => words.every((word) => (message.msg_content ?? '').toLowerCase().includes(word)));
        if (matched.length) found.push({ id: namespaced(session.session_id), root: session.workspace_dir, count: matched.length, said: matched.at(-1).msg_content.slice(0, 240) });
      }
      return found;
    },
    hidden: async (from, to, include) => (await sessions(rpc)).filter((session) => Number(session.updated_at) >= from && Number(session.updated_at) < to && include(namespaced(session.session_id))).map(providerRow),
    create: async ({ root, model } = {}) => {
      if (disposed) throw new Error('MCode provider disposed.');
      if (!local(root)) throw new Error('MCode requires a local project.');
      const result = await rpc.request(`${API}/agent/mavis/session`, 'POST', { workspace_dir: root, ...(model ? { model: modelSelection(model) } : {}) });
      if (!result.session_id) throw new Error('MCode did not return a session ID.');
      return namespaced(result.session_id);
    },
    fork: async (root, id, at, _mode, model) => {
      await info(root, id);
      const selection = model ? modelSelection(model) : undefined;
      const saved = await messages(rpc, nativeId(id));
      const point = saved.findLast((message) => message.role === 'assistant' && Number(message.timestamp) <= at && message.actions?.fork === true);
      if (!point) throw new Error('MCode has no completed assistant response to fork at this point.');
      const result = await rpc.request(`${API}/session/${nativeId(id)}/fork`, 'POST', { assistant_message_id: point.msg_id, client_request_id: randomUUID(), use_suggested_title: false, create_isolated_worktree: false });
      if (!result.session?.session_id) throw new Error('MCode did not return the forked session.');
      const forkId = namespaced(result.session.session_id);
      if (selection) await rpc.request(`${API}/models/select`, 'POST', { session_id: result.session.session_id, ...selection });
      return { id: forkId, begun: true, items: (await read(root, forkId)).items };
    },
    has: async (root, id) => { try { await info(root, id); return true; } catch (error) { if (error.status === 404) return false; throw error; } },
    read,
    links: async (root, id) => messageLinks((await read(root, id))?.items ?? []),
    goal: async () => undefined,
    setGoal: async () => { throw new Error('Native MCode goals need a GeckIt goal-driver lifecycle; this provider does not advertise nativeGoals.'); },
    clearGoal: async () => { throw new Error('Native MCode goals are not managed by this provider.'); },
    rename: async (id, title) => { await rpc.request(`${API}/session/${nativeId(id)}`, 'PATCH', { title }); },
    remote: async () => { throw new Error('MCode tmux supports local projects only.'); },
    mcp: async (_root, change) => {
      if (change !== undefined) await rpc.request(`${API}/mcp/servers/${encodeURIComponent(change.name)}/enabled`, 'PATCH', { enabled: change.enabled === true });
      const listed = await rpc.request(`${API}/mcp/servers`);
      const runtime = await rpc.request(`${API}/mcp/runtime/servers`).catch(() => ({}));
      const states = new Map((runtime.servers ?? []).map((server) => [server.name, server]));
      return (listed.servers ?? []).map((server) => {
        const state = states.get(server.name);
        const enabled = server.enabled !== false;
        const status = !enabled ? 'disabled'
          : ['expired', 'pending_auth'].includes(state?.auth_status ?? state?.authStatus) ? 'needs-auth'
          : state === undefined || state.configured === false ? 'pending' : 'connected';
        return { name: server.name, status };
      });
    },
    browsers: async () => undefined,
    correct: async () => ({ ok: false, error: 'Text correction is unavailable in MCode tmux.' }),
    delete: async (root, id) => { await info(root, id); await rpc.request(`${API}/session/${nativeId(id)}`, 'DELETE'); return true; },
    hold: (options, hear, left) => {
      if (disposed) throw new Error('MCode provider disposed.');
      let driver;
      const report = (event) => {
        if (event.signals?.some((signal) => signal.kind === 'ended')) void reportPlan().catch(error => log('warn', 'quota.refresh.failed', { error: error.name }));
        hear(event);
      };
      driver = holdMcode({ rpc, options: { ...options, id: nativeId(options.id) }, guide: () => guide.prompt(), hear: report, left: () => { drivers.delete(driver); left(); }, log, ...dependencies.terminal });
      driver.report = report;
      drivers.add(driver); return driver;
    },
    dispose: () => {
      disposed = true;
      quota.dispose();
      void Promise.allSettled([...drivers].map((driver) => driver.end())).then(() => rpc.dispose());
    },
  };
  return provider;
}
