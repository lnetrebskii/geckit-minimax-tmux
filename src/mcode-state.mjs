import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from './mcode-history.mjs';

export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export async function selectedModel(rpc, id) {
  const data = await rpc.request(`${API}/models/list${id ? `?session_id=${encodeURIComponent(id)}` : ''}`);
  return data.models?.find(model => model.selected === true);
}
export async function usesKey(rpc, model) {
  if (model?.provider_kind === 'user') return true;
  if (model?.provider_id && model.provider_id !== 'minimax') return true;
  const source = (await rpc.request(`${API}/model-providers/minimax-source`)).active_source;
  return source === 'minimax_api_key' ? true : source === 'token_plan' ? false : undefined;
}
export function taskView(task) {
  if (!task || task.is_deleted || typeof task.task_id !== 'string') return undefined;
  const status = ['running', 'running', 'running', 'completed', 'failed', 'stopped', 'failed'][task.status];
  const started = Number(task.started_at ?? task.created_at);
  if (!status || !Number.isFinite(started)) return undefined;
  let output = task.output_file_path;
  if (output?.startsWith('file://')) { try { output = fileURLToPath(output); } catch { output = undefined; } }
  return { id: task.task_id, kind: 'local_bash', what: task.display_name || 'MCode background task', status, started,
    ...(typeof task.command === 'string' ? { command: task.command } : {}),
    ...(task.ended_at != null && Number.isFinite(Number(task.ended_at)) ? { ended: Number(task.ended_at) } : {}),
    ...(Number.isInteger(task.exit_code) ? { exit: task.exit_code } : {}),
    ...(typeof output === 'string' && isAbsolute(output) ? { output } : {}) };
}
export async function backgroundTasks(rpc, id) {
  const base = `${API}/session/${encodeURIComponent(id)}/background-tasks`;
  const { items = [] } = await rpc.request(base);
  const result = [];
  for (const summary of items) {
    if (summary.is_deleted) continue;
    try {
      const { task } = await rpc.request(`${base}/${encodeURIComponent(summary.task_id)}`);
      const view = taskView(task);
      if (view) result.push(view);
    } catch (error) { if (error.status !== 404) throw error; }
  }
  return result;
}
export async function stopTask(rpc, id, task) {
  if (typeof task !== 'string' || !task) throw new Error('Missing MCode task ID.');
  const result = await rpc.request(`${API}/session/${encodeURIComponent(id)}/background-tasks/${encodeURIComponent(task)}/stop`, 'POST', {});
  if (result.operation_error) throw new Error(result.operation_error.message || 'MCode could not stop this task.');
  return result;
}

export function quotaUsage(plan, measuredAt, unavailableReason, credits) {
  if (!plan) return undefined;
  return { quotas: [
    ...Object.entries(plan).map(([id, window]) => ({ id, name: id === 'fiveHour' ? '5h' : id === 'sevenDay' ? 'Week' : id, ...window })),
    ...(Number.isFinite(credits) && credits >= 0 ? [{ id: 'credits', name: 'Credits', remaining: credits, unit: 'credits' }] : []),
  ],
    ...(Number.isFinite(measuredAt) ? { measuredAt } : {}),
    ...(unavailableReason ? { unavailableReason } : {}) };
}
