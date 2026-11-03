export const API = '/minimax-desktop/api/v1';
export const ID = 'plugin:minimax-tmux';
export const namespaced = (id) => `${ID}:${id}`;
export function nativeId(id) {
  if (typeof id !== 'string' || !id.startsWith(`${ID}:`) || !/^[A-Za-z0-9_-]+$/.test(id.slice(ID.length + 1))) throw new Error('Invalid MCode session ID.');
  return id.slice(ID.length + 1);
}
export function messageItems(message) {
  const id = message.msg_id;
  if (typeof id !== 'string') return [];
  const items = [];
  if (message.msg_content) items.push({ kind: message.role === 'user' ? 'mine' : message.role === 'assistant' ? 'theirs' : 'note', id,
    text: message.msg_content, ...(message.role === 'user' || message.role === 'assistant' ? { at: Number(message.timestamp) } : { note: 'task' }) });
  if (message.thinking_content) items.push({ kind: 'thought', id: `${id}:thinking`, text: message.thinking_content });
  for (const [index, tool] of (message.tool_calls ?? []).entries()) items.push({ kind: 'did', id: `${id}:tool:${tool.tool_call_id ?? tool.id ?? index}`, what: tool.tool_name ?? tool.name ?? tool.function?.name ?? 'Tool', detail: JSON.stringify(tool, null, 2), live: tool.tool_call_status === 1 });
  return items;
}
export function contextSpend(messages) {
  for (const message of [...messages].reverse()) {
    let raw;
    try { raw = JSON.parse(message.raw_json ?? '{}'); } catch { raw = {}; }
    const usage = raw.context_usage;
    if (typeof usage?.usedTokens === 'number') return { used: usage.usedTokens, ...(typeof usage.contextWindowTokens === 'number' ? { window: usage.contextWindowTokens } : {}) };
    if (message.role === 'assistant' && message.usage) {
      const value = message.usage;
      const used = ['input_tokens', 'output_tokens', 'cache_read', 'cache_write'].reduce((sum, key) => sum + (Number(value[key]) || 0), 0);
      if (used) return { used, ...(Number(value.context_window) > 0 ? { window: Number(value.context_window) } : {}) };
    }
  }
}
export async function messages(rpc, id) {
  const pages = [];
  let before;
  const cursors = new Set();
  for (;;) {
    const page = await rpc.request(`${API}/session/${encodeURIComponent(id)}/message?limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    pages.unshift(page.messages ?? []);
    if (!page.has_more) break;
    if (!page.next_cursor || cursors.has(page.next_cursor)) throw new Error('MCode history pagination did not advance.');
    before = page.next_cursor; cursors.add(before);
  }
  return pages.flat();
}
export async function sessions(rpc) {
  const result = [];
  const cursors = new Set();
  let cursor;
  for (;;) {
    const page = await rpc.request(`${API}/agent/mavis/session?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    result.push(...(page.sessions ?? []));
    if (!page.has_more) return result;
    if (!page.next_cursor || cursors.has(page.next_cursor)) throw new Error('MCode session pagination did not advance.');
    cursor = page.next_cursor; cursors.add(cursor);
  }
}
export const providerRow = (session) => ({ id: namespaced(session.session_id), root: session.workspace_dir,
  title: session.title || 'MiniMax Code', stands: '', at: Number(session.updated_at ?? session.created_at), created: Number(session.created_at), driven: true,
  ...(session.effective_model ? { model: session.effective_model } : {}) });
