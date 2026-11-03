import { open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
export const API = '/minimax-desktop/api/v1';
export const ID = 'plugin:minimax-tmux';
export const namespaced = (id) => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid native MCode session ID.');
  return `${ID}:${id}`;
};
export function nativeId(id) {
  if (typeof id !== 'string' || !id.startsWith(`${ID}:`) || !/^[A-Za-z0-9_-]+$/.test(id.slice(ID.length + 1))) throw new Error('Invalid MCode session ID.');
  return id.slice(ID.length + 1);
}
export function messageItems(message) {
  const id = message.msg_id;
  if (typeof id !== 'string') return [];
  const items = [];
  const timestamp = message.timestamp == null ? undefined : Number(message.timestamp);
  if (message.msg_content || (message.role === 'user' && message.attachments?.length)) items.push({ kind: message.role === 'user' ? 'mine' : message.role === 'assistant' ? 'theirs' : 'note', id,
    text: message.msg_content || '', ...(message.role === 'user' || message.role === 'assistant' ? Number.isFinite(timestamp) ? { at: timestamp } : {} : { note: 'task' }) });
  if (message.thinking_content) items.push({ kind: 'thought', id: `${id}:thinking`, text: message.thinking_content });
  for (const [index, tool] of (message.tool_calls ?? []).entries()) items.push({ kind: 'did', id: `${id}:tool:${tool.tool_call_id ?? tool.id ?? index}`, what: tool.tool_name ?? tool.name ?? tool.function?.name ?? 'Tool', detail: JSON.stringify(tool, null, 2), live: tool.tool_call_status === 1 });
  return items;
}

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const maxImageBytes = 20 * 1024 * 1024;
function verifiedImage(media, data) {
  if (!imageTypes.has(media) || typeof data !== 'string' || data.length > maxImageBytes * 4 / 3 + 4) return;
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.toString('base64') !== data) return;
  const valid = media === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : media === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : media === 'image/gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (valid) return { media, data };
}
async function attachmentImage(attachment) {
  const url = attachment.local?.data_url;
  if (typeof url === 'string') {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([\s\S]+)$/.exec(url);
    return match && verifiedImage(match[1], match[2]);
  }
  const media = attachment.meta?.mime_type, path = attachment.local?.file_path;
  if (!imageTypes.has(media) || typeof path !== 'string' || !isAbsolute(path)) return;
  let file;
  try {
    file = await open(path, 'r');
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxImageBytes) return;
    // Bounded read also handles files growing after stat().
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return verifiedImage(media, buffer.subarray(0, bytesRead).toString('base64'));
  } catch { return undefined; }
  finally { await file?.close(); }
}
export async function messageItemsWithImages(message, root) {
  const items = messageItems(message);
  const mine = items.find(item => item.kind === 'mine');
  if (mine) {
    const images = (await Promise.all((message.attachments ?? []).map(attachmentImage))).filter(Boolean);
    if (images.length) mine.images = images;
  }
  for (const [index, tool] of (message.tool_calls ?? []).entries()) {
    const item = items.find(item => item.id === `${message.msg_id}:tool:${tool.tool_call_id ?? tool.id ?? index}`);
    let args, result;
    try { args = JSON.parse(tool.tool_call_args ?? '{}'); } catch {}
    try { result = JSON.parse(tool.tool_call_result_data ?? '{}'); } catch {}
    const path = args?.file_path ?? args?.path;
    if (typeof path === 'string') item.path = path;
    if (root && typeof path === 'string' && ['write', 'edit'].includes(tool.tool_name) && tool.tool_call_status === 2 && !result?.error && result?.isError !== true) {
      items.push({ kind: 'wrote', id: `${item.id}:wrote`, paths: [resolve(root, path)] });
    }
    const images = (Array.isArray(result?.content) ? result.content : []).flatMap(block => {
      const image = block.type === 'image' ? verifiedImage(block.mimeType ?? block.source?.media_type, block.data ?? block.source?.data) : undefined;
      return image ? [image] : [];
    });
    if (images.length) item.images = images;
  }
  return items;
}
export function contextSpend(messages) {
  for (const message of [...messages].reverse()) {
    let raw;
    try { raw = JSON.parse(message.raw_json ?? '{}'); } catch { raw = {}; }
    const usage = raw?.context_usage;
    if (Number.isFinite(usage?.usedTokens) && usage.usedTokens >= 0) return { used: usage.usedTokens, ...(Number.isFinite(usage.contextWindowTokens) && usage.contextWindowTokens > 0 ? { window: usage.contextWindowTokens } : {}) };
    if (message.role === 'assistant' && message.usage) {
      const value = message.usage;
      const used = ['input_tokens', 'output_tokens', 'cache_read', 'cache_write'].reduce((sum, key) => sum + (Number(value[key]) || 0), 0);
      if (Number.isFinite(used) && used > 0) return { used, ...(Number.isFinite(Number(value.context_window)) && Number(value.context_window) > 0 ? { window: Number(value.context_window) } : {}) };
    }
  }
}
// Match GeckIt's conversation Links panel: newest first, named links retain
// their labels, and internal thoughts/tool output do not become shared links.
export function messageLinks(items) {
  const found = new Map();
  for (const item of [...items].reverse()) {
    if (item.kind !== 'mine' && item.kind !== 'theirs') continue;
    for (const [, text, url] of item.text.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
      if (!found.get(url)?.text) found.set(url, text === url ? { url } : { url, text });
    }
    for (const [bare] of item.text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
      const url = bare.replace(/[.,;:!?]+$/, '');
      if (!found.has(url)) found.set(url, { url });
    }
  }
  return [...found.values()];
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
