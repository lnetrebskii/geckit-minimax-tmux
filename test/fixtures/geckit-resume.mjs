// Resume-command formatter copied from installed GeckIt on 2026-11-03.
// Only provider lookup is injected; formatting is unchanged. See UPSTREAM.md.
let info;
export const register = (value) => { info = value; };
const llmProviderInfo = () => info;
const providerOf = (id) => id.startsWith(info.family + ":") ? info.family : "claude";
export const resumeCommand = (id) => {
  const provider = providerOf(id);
  if (provider === "codex") return `codex resume ${id.slice(6)}`;
  if (provider === "claude") return `claude --resume ${id}`;
  const template = llmProviderInfo(provider).resumeCommand;
  if (template === void 0) return void 0;
  const session = id.slice(provider.length + 1).replaceAll("'", "'\\''");
  return template.replaceAll("{id}", `'${session}'`);
};
