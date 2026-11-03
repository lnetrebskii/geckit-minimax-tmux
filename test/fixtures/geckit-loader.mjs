// Validation functions copied verbatim from installed GeckIt app.asar on 2026-11-03.
// Only unrelated host logging and identity-normalization helpers are stubbed.
// Independent plugin identities are already normalized. See UPSTREAM.md.
import { readFile, realpath } from 'node:fs/promises';
import { join, basename, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const independentProviderInfo = (provider) => provider;
const independentProvider = (provider, info) => ({ ...provider, ...info });
const pluginLogger = () => ({ write() {} });
const withPluginLogs = (provider) => provider;
const pluginId = (id) => id === "claude-tmux" || /^plugin:[a-z][a-z0-9-]*$/.test(id);
const methods = ["account", "program", "models", "limits", "list", "search", "hidden", "create", "fork", "has", "read", "links", "goal", "setGoal", "clearGoal", "hold", "rename", "remote", "mcp", "browsers", "correct", "setInstructions", "delete", "dispose"];
const capabilities = ["available", "localOnly", "subscriptionOnly", "images", "remoteControl", "nativeGoals", "waitForExit"];
const manifestAt = async (path2) => {
  const parsed2 = JSON.parse(await readFile(join(path2, "geckit-plugin.json"), "utf8"));
  if (!("apiVersion" in parsed2) || parsed2.apiVersion !== 1 || !("entry" in parsed2) || typeof parsed2.entry !== "string" || !("provider" in parsed2) || typeof parsed2.provider !== "object" || parsed2.provider === null) throw new Error("Invalid GeckIt plugin manifest.");
  const provider = parsed2.provider;
  if (!("id" in provider) || typeof provider.id !== "string" || !pluginId(provider.id) || !("family" in provider) || typeof provider.family !== "string" || !("name" in provider) || typeof provider.name !== "string" || !("shortName" in provider) || typeof provider.shortName !== "string" || !("icon" in provider) || typeof provider.icon !== "string" || !("browser" in provider) || !["none", "claude", "codex"].includes(String(provider.browser)) || !("loginCommand" in provider) || typeof provider.loginCommand !== "string" || !("planName" in provider) || typeof provider.planName !== "string") throw new Error("Invalid provider metadata.");
  if ("iconPath" in provider && (typeof provider.iconPath !== "string" || provider.iconPath.length > 2048)) throw new Error("Invalid provider icon.");
  if ("resumeCommand" in provider && typeof provider.resumeCommand !== "string") throw new Error("Invalid provider resume command.");
  if ("runtime" in provider && provider.runtime !== "codex") throw new Error("Invalid provider runtime.");
  if ("instructions" in provider && provider.instructions !== "claude" && provider.instructions !== "codex" && provider.instructions !== "own") throw new Error("Invalid provider instructions.");
  const transport = "transport" in provider ? provider.transport : void 0;
  const replaces = "replaces" in provider ? provider.replaces : void 0;
  if (provider.id === "claude-tmux" ? provider.family !== "claude" || transport !== "tmux" || replaces !== void 0 : replaces === "codex" ? provider.family !== "codex" || transport !== void 0 : replaces !== void 0 || provider.family !== provider.id || transport !== void 0) throw new Error("Plugin provider ID does not match its family and transport.");
  if (parsed2.entry !== "index.mjs") throw new Error("Plugin entry must be index.mjs.");
  return parsed2;
};
const loadPlugin = async (path2) => {
  const manifest = await manifestAt(path2);
  const info = independentProviderInfo(manifest.provider);
  const name = basename(path2);
  const loadKind = name.startsWith(".active-") ? "snapshot" : /^\.(?:ready|update|install|reinstall)-/.test(name) ? "candidate" : "repository";
  const log2 = pluginLogger(info, { loadId: randomUUID(), loadKind });
  log2.write("info", "plugin.load.started");
  let stage = "entry";
  try {
    const entry2 = await realpath(join(path2, manifest.entry));
    if (relative(await realpath(resolve(path2)), entry2).startsWith("..")) throw new Error("Plugin entry leaves its repository.");
    const moduleUrl = pathToFileURL(entry2);
    moduleUrl.searchParams.set("geckit", randomUUID());
    stage = "module";
    const module = await import(moduleUrl.href);
    if (typeof module.create !== "function") throw new Error("Plugin must export create().");
    stage = "factory";
    const provider = await module.create({ log: log2 });
    stage = "contract";
    const compatible = typeof provider === "object" && provider !== null && typeof provider.setInstructions !== "function" ? { ...provider, setInstructions: async () => {
    } } : provider;
    if (typeof compatible !== "object" || compatible === null || methods.some((method) => typeof compatible[method] !== "function") || capabilities.some((field2) => typeof compatible[field2] !== "boolean") || typeof compatible.idleMs !== "number") throw new Error("Plugin does not implement LlmProvider.");
    if (provider.id !== manifest.provider.id) throw new Error("Plugin ID differs from its manifest.");
    const loaded = { path: path2, info, provider: withPluginLogs(independentProvider({ ...compatible, ...manifest.provider }, info), log2) };
    log2.write("info", "plugin.load.completed");
    return loaded;
  } catch (error) {
    log2.write("error", "plugin.load.failed", { stage });
    throw error;
  }
};
export { manifestAt, loadPlugin };
