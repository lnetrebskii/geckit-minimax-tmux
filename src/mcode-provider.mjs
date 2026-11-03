import { randomUUID } from 'node:crypto';
import { McodeRpc, program } from './mcode-rpc.mjs';
import { holdMcode } from './mcode-terminal.mjs';
import { API, ID, nativeId, namespaced, messages, messageItems, contextSpend, sessions, providerRow } from './mcode-history.mjs';

const local = (root) => typeof root === 'string' && !root.startsWith('ssh://');
const inRoot = (path, root) => path === root || path?.startsWith(root.replace(/\/$/, '') + '/');
const modelSelection = (value) => {
  const at = value.indexOf('/');
  if (at <= 0 || at === value.length - 1) throw new Error('Select a provider/model from MCode’s model list.');
  return { provider_id: value.slice(0, at), model_id: value.slice(at + 1) };
};
export function create(context = {}, dependencies = {}) {
  const rpc = dependencies.rpc ?? new McodeRpc();
  const log = (level, event, fields) => { try { context.log?.write(level, event, fields); } catch {} };
  const drivers = new Set();
  let disposed = false, known = [];
  const info = async (root, id) => {
    const native = nativeId(id);
    const session = (await rpc.request(`${API}/session/${native}`)).session;
    if (!session || !local(root) || session.workspace_dir !== root) { const error = new Error('MCode session does not belong to this project.'); error.status = 404; throw error; }
    return session;
  };
  const read = async (root, id) => {
    try { await info(root, id); } catch (error) { if (error.status === 404) return undefined; throw error; }
    const saved = await messages(rpc, nativeId(id));
    return { items: saved.flatMap(messageItems), tasks: [], ...contextSpend(saved) };
  };
  return {
    id: ID, family: ID, name: 'MiniMax Code (tmux)', shortName: 'MCode', icon: 'terminal', browser: 'none',
    loginCommand: 'mcode login', planName: 'MiniMax', localOnly: true,
    available: true, subscriptionOnly: false, images: false, remoteControl: false, nativeGoals: false,
    idleMs: 3600000, waitForExit: true, instructions: 'own', setInstructions: async () => {},
    program: dependencies.program ?? program,
    account: async () => {
      const installed = await (dependencies.program ?? program)();
      if (!installed) return { provider: ID, here: false, signedIn: undefined };
      const account = await rpc.account();
      return { provider: ID, here: true, signedIn: account.state === 'authenticated', program: installed };
    },
    models: async () => {
      const data = await rpc.request(`${API}/models/list`);
      known = (data.models ?? []).map((model) => ({ value: `${model.provider_id}/${model.model_id}`, id: model.model_id,
        name: model.display_name || model.model_id, isDefault: model.selected === true,
        ...(model.enabled === false ? { disabled: true } : {}),
        ...(Number(model.context_limit) > 0 ? { contextWindow: Number(model.context_limit) } : {}),
        ...(Number(model.max_output_tokens) > 0 ? { maxOutputTokens: Number(model.max_output_tokens) } : {}),
        reasoning: (model.effort_options ?? []).filter((value) => ['none','minimal','low','medium','high','xhigh','max','ultra'].includes(value)).map((value) => ({ value, says: value })),
      }));
      return known;
    },
    limits: async (models) => ({ windows: new Map(models.map((model) => [model, known.find((item) => item.value === model || item.id === model)?.contextWindow])) }),
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
    fork: async (root, id, at) => {
      await info(root, id);
      const saved = await messages(rpc, nativeId(id));
      const point = saved.findLast((message) => message.role === 'assistant' && Number(message.timestamp) <= at && message.actions?.fork === true);
      if (!point) throw new Error('MCode has no completed assistant response to fork at this point.');
      const result = await rpc.request(`${API}/session/${nativeId(id)}/fork`, 'POST', { assistant_message_id: point.msg_id, client_request_id: randomUUID(), use_suggested_title: false, create_isolated_worktree: false });
      if (!result.session?.session_id) throw new Error('MCode did not return the forked session.');
      const forkId = namespaced(result.session.session_id);
      return { id: forkId, begun: true, items: (await read(root, forkId)).items };
    },
    has: async (root, id) => { try { await info(root, id); return true; } catch (error) { if (error.status === 404) return false; throw error; } },
    read,
    links: async (root, id) => [...new Set(((await read(root, id))?.items ?? []).flatMap((item) => [...(item.text ?? '').matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)].map((match) => match[0].replace(/[.,;:!?]+$/, ''))))].map((url) => ({ url })),
    goal: async () => undefined, setGoal: async () => undefined, clearGoal: async () => {},
    rename: async (id, title) => { await rpc.request(`${API}/session/${nativeId(id)}`, 'PATCH', { title }); },
    remote: async () => { throw new Error('MCode tmux supports local projects only.'); },
    mcp: async () => undefined, browsers: async () => undefined,
    correct: async () => ({ ok: false, error: 'Text correction is unavailable in MCode tmux.' }),
    delete: async (root, id) => { await info(root, id); await rpc.request(`${API}/session/${nativeId(id)}`, 'DELETE'); return true; },
    hold: (options, hear, left) => {
      if (disposed) throw new Error('MCode provider disposed.');
      let driver;
      driver = holdMcode({ rpc, options: { ...options, id: nativeId(options.id) }, hear, left: () => { drivers.delete(driver); left(); }, log, ...dependencies.terminal });
      drivers.add(driver); return driver;
    },
    dispose: () => {
      disposed = true;
      void Promise.allSettled([...drivers].map((driver) => driver.end())).then(() => rpc.dispose());
    },
  };
}
