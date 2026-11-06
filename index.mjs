// src/mcode-provider.mjs
import { randomUUID as randomUUID5 } from "node:crypto";

// src/mcode-rpc.mjs
import { spawn, execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import { createInterface } from "node:readline";
function mcodeEnvironment() {
  const env = { ...process.env };
  env.PATH = [...(env.PATH ?? "").split(delimiter), join(homedir(), ".minimax-code", "bin"), join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].join(delimiter);
  for (const key of Object.keys(env)) if (key.startsWith("GECKIT_")) delete env[key];
  return env;
}
function mcodeCommand() {
  if (process.env.GECKIT_MCODE_COMMAND) return process.env.GECKIT_MCODE_COMMAND;
  return mcodeEnvironment().PATH.split(delimiter).map((dir) => join(dir, "mcode")).find(existsSync) ?? "mcode";
}
var program = () => new Promise((resolve3) => execFile(mcodeCommand(), ["--version"], { env: mcodeEnvironment(), timeout: 15e3 }, (error, stdout) => {
  const version = stdout?.trim().match(/^\d+\.\d+\.\d+[^\s]*/)?.[0];
  let path = mcodeCommand();
  try {
    path = realpathSync(path);
  } catch {
  }
  resolve3(error || !version ? void 0 : { version, path });
}));
var McodeRpc = class {
  constructor({ command = mcodeCommand, environment = mcodeEnvironment, timeout = 6e4 } = {}) {
    this.command = command;
    this.environment = environment;
    this.timeout = timeout;
    this.pending = /* @__PURE__ */ new Map();
    this.streams = /* @__PURE__ */ new Map();
    this.sequence = 0;
  }
  async ready() {
    if (this.disposed) throw new Error("MCode provider has been disposed.");
    return this.starting ??= this.start().catch((error) => {
      this.child?.kill("SIGTERM");
      this.starting = void 0;
      throw error;
    });
  }
  async start() {
    this.child = spawn(this.command(), ["app-server", "--stdio"], { cwd: homedir(), env: this.environment(), stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.failed(new Error("MCode control input disconnected.")));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      try {
        this.received(JSON.parse(line));
      } catch {
      }
    });
    this.child.on("error", () => this.failed(new Error("Cannot start mcode. Install MiniMax Code and run mcode login.")));
    this.child.on("exit", () => {
      this.starting = void 0;
      this.failed(new Error("MCode control process exited."));
    });
    const result = await this.call("initialize", { protocolVersion: 1, clientInfo: { name: "geckit-minimax-tmux", version: "1.0.0" }, capabilities: { desktopService: { transportProtocolVersion: 2 } } });
    if (result.protocolVersion !== 1) throw new Error("Unsupported MCode app-server protocol.");
    this.write({ method: "initialized" });
  }
  write(value) {
    if (!this.child?.stdin.writable) throw new Error("MCode control process is disconnected.");
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  wait(map, id) {
    return new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        map.delete(id);
        reject(new Error("MCode control request timed out."));
      }, this.timeout);
      map.set(id, { resolve: (value) => {
        clearTimeout(timer);
        map.delete(id);
        resolve3(value);
      }, reject: (error) => {
        clearTimeout(timer);
        map.delete(id);
        reject(error);
      }, chunks: [] });
    });
  }
  call(method, params) {
    const id = ++this.sequence;
    const result = this.wait(this.pending, id);
    try {
      this.write({ id, method, params });
    } catch (error) {
      this.pending.get(id)?.reject(error);
    }
    return result;
  }
  received(value) {
    if (!value || typeof value !== "object") return;
    if (value.id !== void 0) {
      const pending = this.pending.get(value.id);
      if (value.error) pending?.reject(new Error(`MCode RPC ${value.error.code}: ${value.error.message}`));
      else pending?.resolve(value.result);
      return;
    }
    const frame = value.params?.frame;
    if (value.method !== "desktopService/transport" || !frame) return;
    const stream = this.streams.get(frame.id);
    if (!stream) return;
    if (frame.type === "response-start") {
      if (!Number.isInteger(frame.status) || frame.status < 100 || frame.status > 599) {
        stream.reject(new Error("Invalid MCode service status."));
        return;
      }
      stream.status = frame.status;
    }
    if (frame.type === "stream-chunk") {
      if (typeof frame.payload !== "string" && typeof frame.payload?.data !== "string") {
        stream.reject(new Error("Invalid MCode service chunk."));
        return;
      }
      stream.chunks.push(typeof frame.payload === "string" ? Buffer.from(frame.payload) : Buffer.from(frame.payload.data, "base64"));
      try {
        this.write({ method: "desktopService/transport", params: { frame: { type: "stream-credit", id: frame.id, credits: 1 } } });
      } catch (error) {
        stream.reject(error);
      }
    }
    if (frame.type === "stream-error") stream.reject(new Error("MCode local service failed."));
    if (frame.type === "stream-done") {
      if (stream.status === void 0) {
        stream.reject(new Error("MCode service response has no status."));
        return;
      }
      const text = Buffer.concat(stream.chunks).toString("utf8");
      if (stream.status >= 400) {
        const error = new Error(`MCode local service HTTP ${stream.status}`);
        error.status = stream.status;
        stream.reject(error);
      } else {
        try {
          stream.resolve(text ? JSON.parse(text) : {});
        } catch {
          stream.reject(new Error("Invalid MCode service response."));
        }
      }
    }
  }
  async request(path, method = "GET", body) {
    await this.ready();
    const id = `geckit-${++this.sequence}`;
    const result = this.wait(this.streams, id);
    result.catch(() => {
    });
    try {
      await this.call("desktopService/transport", { frame: { type: "request", id, method, url: `http://local-runtime.transport${path}`, headers: { "content-type": "application/json" }, ...body === void 0 ? {} : { body: JSON.stringify(body) }, streamWindow: 16 } });
    } catch (error) {
      this.streams.get(id)?.reject(error);
    }
    return result;
  }
  async account() {
    await this.ready();
    return this.call("account/read", {});
  }
  failed(error) {
    for (const map of [this.pending, this.streams]) for (const pending of [...map.values()]) pending.reject(error);
  }
  dispose() {
    this.disposed = true;
    this.failed(new Error("MCode provider disposed."));
    this.lines?.close();
    this.child?.stdin.end();
    const child = this.child;
    if (child) {
      const timer = setTimeout(() => child.kill("SIGTERM"), 3e3);
      timer.unref();
      child.once("exit", () => clearTimeout(timer));
    }
  }
};

// src/mcode-terminal.mjs
import { execFile as execFile3 } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join3, resolve as resolve2 } from "node:path";
import { randomUUID as randomUUID3 } from "node:crypto";
import { setTimeout as delay2 } from "node:timers/promises";

// src/tmux-binary.mjs
import { execFile as execFile2 } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir as mkdirCache, readFile, rename, rm as rmPart, writeFile as writePart } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { delimiter as delimiter2, join as join2 } from "node:path";
var KNOWN = () => ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin", join2(homedir2(), ".nix-profile", "bin"), "/run/current-system/sw/bin", "/nix/var/nix/profiles/default/bin", join2(homedir2(), ".local", "bin")];
var tmuxRuns = (file) => new Promise((resolve3) => {
  execFile2(file, ["-V"], { timeout: 5e3, windowsHide: true }, (error) => resolve3(error === null));
});
var cacheFolder = (env) => process.platform === "darwin" ? join2(homedir2(), "Library", "Caches", "geckit-minimax-tmux") : join2(env.XDG_CACHE_HOME || join2(homedir2(), ".cache"), "geckit-minimax-tmux");
var binaryList = () => readFile(new URL("./tmux-binaries.json", import.meta.url), "utf8").then(JSON.parse, () => ({ files: {} }));
async function locateTmux({ env = process.env, folder = cacheFolder(env), binaries = binaryList, download = fetch, known = KNOWN() } = {}) {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("MiniMax Code (tmux) runs on macOS and Linux only.");
  const seen = /* @__PURE__ */ new Set();
  for (const directory of [...(env.PATH ?? "").split(delimiter2), ...known]) {
    if (directory === "" || seen.has(directory)) continue;
    seen.add(directory);
    const file2 = join2(directory, "tmux");
    if (await tmuxRuns(file2)) return { file: file2, server: [] };
  }
  const install = `Install tmux (${process.platform === "darwin" ? "brew install tmux" : "for example sudo apt install tmux"}) and try again.`;
  const { version, files } = await binaries();
  const target = `${process.platform}-${process.arch}`;
  const entry = files?.[target];
  if (entry === void 0) throw new Error(`tmux is not installed. ${install}`);
  const file = join2(folder, `tmux-${version}-${target}`);
  if (!await tmuxRuns(file)) {
    try {
      const response = await download(entry.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("checksum mismatch");
      await mkdirCache(folder, { recursive: true });
      const part = `${file}.${randomUUID()}.part`;
      await writePart(part, bytes, { mode: 493 });
      await rename(part, file).catch(async (error) => {
        await rmPart(part, { force: true });
        throw error;
      });
    } catch (error) {
      throw new Error(`tmux is not installed and its copy could not be downloaded (${error.message}). ${install}`);
    }
    if (!await tmuxRuns(file)) throw new Error(`tmux is not installed and the downloaded copy does not run here. ${install}`);
  }
  return { file, server: ["-L", "geckit-minimax"] };
}
var located;
var findTmux = () => located ??= locateTmux().catch((error) => {
  located = void 0;
  throw error;
});

// src/mcode-login.mjs
import { randomUUID as randomUUID2 } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
var quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
var signInError = (text) => Object.assign(new Error(text), { status: 401 });
function createLogin({ tmux, command, environment, root, account, emit, timeout = 3e5 }) {
  let active, question2, choose, cancelled = false;
  const resolveQuestion = () => {
    if (!question2) return;
    emit([], [`card:${question2.id}`], [{ kind: "resolved", ask: question2.id }]);
    question2 = void 0;
  };
  const ask = (title, detail, choices) => {
    resolveQuestion();
    question2 = { id: `mcode-login:${randomUUID2()}`, choices };
    emit([], [], [{ kind: "asks", ask: question2.id, wanted: { kind: "question", question: title, choices } }]);
    emit([{ kind: "card", id: `card:${question2.id}`, card: { kind: "question", title, detail, choices } }]);
  };
  const cancel = () => {
    cancelled = true;
    choose?.("Cancel");
    resolveQuestion();
  };
  const run = async () => {
    cancelled = false;
    let spawned = false;
    const name = `geckit-minimax-login-${randomUUID2()}`;
    try {
      const selection = new Promise((resolve3) => {
        choose = resolve3;
      });
      ask("Sign in to MiniMax Code", "Your message has not been sent. Choose your account region to open browser sign-in.", ["Sign in (Global)", "Sign in (China)", "Cancel"]);
      const selected = await selection;
      choose = void 0;
      if (cancelled || selected === "Cancel") throw signInError("MiniMax sign-in cancelled. Your message has not been sent.");
      const region = selected === "Sign in (China)" ? "cn" : "global";
      ask("Waiting for MiniMax sign-in", "Opening browser authorization. Complete sign-in in your browser to continue.", ["Cancel"]);
      const env = environment();
      const removed = Object.keys(process.env).filter((key) => key.startsWith("GECKIT_"));
      const launch = [
        "exec",
        "env",
        ...removed.flatMap((key) => ["-u", key]),
        `PATH=${env.PATH}`,
        ...["MINIMAX_DATA_DIR", "MAVIS_DATA_DIR", "MINIMAX_PROFILE", "MAVIS_PROFILE"].filter((key) => env[key]).map((key) => `${key}=${env[key]}`),
        command(),
        "login",
        "--region",
        region
      ].map(quote).join(" ");
      await tmux(["new-session", "-d", "-s", name, "-x", "500", "-y", "40", "-c", root, launch, ";", "set-option", "-p", "-t", name, "remain-on-exit", "on"]);
      spawned = true;
      const deadline = Date.now() + timeout;
      let displayed;
      while (!cancelled && Date.now() < deadline) {
        const screen = await tmux(["capture-pane", "-p", "-J", "-t", name]);
        const candidate = screen.match(/https:\/\/account\.minimax\.(?:io|cn)\/oauth-authorize\?[^\s\x1b]+/)?.[0];
        if (candidate && candidate !== displayed) {
          const url = new URL(candidate);
          if (url.hostname !== (region === "cn" ? "account.minimax.cn" : "account.minimax.io")) throw signInError("MiniMax returned a sign-in link for a different region.");
          displayed = candidate;
          ask("Complete MiniMax sign-in in your browser", `If the browser did not open, copy this URL:
${candidate}

Your message will continue after sign-in.`, ["Cancel"]);
        }
        const status = (await tmux(["display-message", "-p", "-t", name, "#{pane_dead}:#{pane_dead_status}"])).trim();
        if (status.startsWith("1:")) {
          if (status !== "1:0") throw signInError("MiniMax sign-in did not complete. Please try again.");
          if ((await account()).state !== "authenticated") throw signInError("MiniMax has not confirmed sign-in. Please retry.");
          if (cancelled) break;
          emit([{ kind: "note", id: `mcode-login-done:${randomUUID2()}`, note: "mode", text: "Signed in to MiniMax Code. Continuing your message." }]);
          return;
        }
        await delay(250);
      }
      throw signInError(cancelled ? "MiniMax sign-in cancelled." : "MiniMax sign-in timed out. Please try again.");
    } finally {
      choose = void 0;
      resolveQuestion();
      if (spawned) await tmux(["kill-session", "-t", name]).catch(() => {
      });
    }
  };
  return {
    get active() {
      return active !== void 0;
    },
    run() {
      return active ??= run().finally(() => {
        active = void 0;
      });
    },
    answer(id, answer) {
      if (question2?.id !== id) return false;
      if (!question2.choices.includes(answer)) return true;
      if (answer === "Cancel") cancel();
      else {
        choose?.(answer);
        resolveQuestion();
      }
      return true;
    },
    cancel,
    async end() {
      cancel();
      await active?.catch(() => {
      });
    }
  };
}

// src/mcode-history.mjs
import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
var API = "/minimax-desktop/api/v1";
var ID = "plugin:minimax-tmux";
var namespaced = (id) => {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid native MCode session ID.");
  return `${ID}:${id}`;
};
function nativeId(id) {
  if (typeof id !== "string" || !id.startsWith(`${ID}:`) || !/^[A-Za-z0-9_-]+$/.test(id.slice(ID.length + 1))) throw new Error("Invalid MCode session ID.");
  return id.slice(ID.length + 1);
}
function messageItems(message) {
  const id = message.msg_id;
  if (typeof id !== "string") return [];
  const items = [];
  const timestamp = message.timestamp == null ? void 0 : Number(message.timestamp);
  if (message.msg_content || message.role === "user" && message.attachments?.length) items.push({
    kind: message.role === "user" ? "mine" : message.role === "assistant" ? "theirs" : "note",
    id,
    text: message.msg_content || "",
    ...message.role === "user" || message.role === "assistant" ? Number.isFinite(timestamp) ? { at: timestamp } : {} : { note: "task" }
  });
  if (message.thinking_content) items.push({ kind: "thought", id: `${id}:thinking`, text: message.thinking_content });
  for (const [index, tool] of (message.tool_calls ?? []).entries()) items.push({ kind: "did", id: `${id}:tool:${tool.tool_call_id ?? tool.id ?? index}`, what: tool.tool_name ?? tool.name ?? tool.function?.name ?? "Tool", detail: JSON.stringify(tool, null, 2), live: tool.tool_call_status === 1 });
  return items;
}
var imageTypes = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
var maxImageBytes = 20 * 1024 * 1024;
function verifiedImage(media, data) {
  if (!imageTypes.has(media) || typeof data !== "string" || data.length > maxImageBytes * 4 / 3 + 4) return;
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.toString("base64") !== data) return;
  const valid = media === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) : media === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : media === "image/gif" ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (valid) return { media, data };
}
async function attachmentImage(attachment) {
  const url = attachment.local?.data_url;
  if (typeof url === "string") {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([\s\S]+)$/.exec(url);
    return match && verifiedImage(match[1], match[2]);
  }
  const media = attachment.meta?.mime_type, path = attachment.local?.file_path;
  if (!imageTypes.has(media) || typeof path !== "string" || !isAbsolute(path)) return;
  let file;
  try {
    file = await open(path, "r");
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxImageBytes) return;
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return verifiedImage(media, buffer.subarray(0, bytesRead).toString("base64"));
  } catch {
    return void 0;
  } finally {
    await file?.close();
  }
}
async function messageItemsWithImages(message, root) {
  const items = messageItems(message);
  const mine = items.find((item) => item.kind === "mine");
  if (mine) {
    const images = (await Promise.all((message.attachments ?? []).map(attachmentImage))).filter(Boolean);
    if (images.length) mine.images = images;
  }
  for (const [index, tool] of (message.tool_calls ?? []).entries()) {
    const item = items.find((item2) => item2.id === `${message.msg_id}:tool:${tool.tool_call_id ?? tool.id ?? index}`);
    let args, result;
    try {
      args = JSON.parse(tool.tool_call_args ?? "{}");
    } catch {
    }
    try {
      result = JSON.parse(tool.tool_call_result_data ?? "{}");
    } catch {
    }
    const path = args?.file_path ?? args?.path;
    if (typeof path === "string") item.path = path;
    if (root && typeof path === "string" && ["write", "edit"].includes(tool.tool_name) && tool.tool_call_status === 2 && !result?.error && result?.isError !== true) {
      items.push({ kind: "wrote", id: `${item.id}:wrote`, paths: [resolve(root, path)] });
    }
    const images = (Array.isArray(result?.content) ? result.content : []).flatMap((block) => {
      const image = block.type === "image" ? verifiedImage(block.mimeType ?? block.source?.media_type, block.data ?? block.source?.data) : void 0;
      return image ? [image] : [];
    });
    if (images.length) item.images = images;
  }
  return items;
}
function contextSpend(messages2) {
  for (const message of [...messages2].reverse()) {
    let raw;
    try {
      raw = JSON.parse(message.raw_json ?? "{}");
    } catch {
      raw = {};
    }
    const usage = raw?.context_usage;
    if (Number.isFinite(usage?.usedTokens) && usage.usedTokens >= 0) return { used: usage.usedTokens, ...Number.isFinite(usage.contextWindowTokens) && usage.contextWindowTokens > 0 ? { window: usage.contextWindowTokens } : {} };
    if (message.role === "assistant" && message.usage) {
      const value = message.usage;
      const used = ["input_tokens", "output_tokens", "cache_read", "cache_write"].reduce((sum, key) => sum + (Number(value[key]) || 0), 0);
      if (Number.isFinite(used) && used > 0) return { used, ...Number.isFinite(Number(value.context_window)) && Number(value.context_window) > 0 ? { window: Number(value.context_window) } : {} };
    }
  }
}
function messageLinks(items) {
  const found = /* @__PURE__ */ new Map();
  for (const item of [...items].reverse()) {
    if (item.kind !== "mine" && item.kind !== "theirs") continue;
    for (const [, text, url] of item.text.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
      if (!found.get(url)?.text) found.set(url, text === url ? { url } : { url, text });
    }
    for (const [bare] of item.text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
      const url = bare.replace(/[.,;:!?]+$/, "");
      if (!found.has(url)) found.set(url, { url });
    }
  }
  return [...found.values()];
}
async function messages(rpc, id) {
  const pages = [];
  let before;
  const cursors = /* @__PURE__ */ new Set();
  for (; ; ) {
    const page = await rpc.request(`${API}/session/${encodeURIComponent(id)}/message?limit=200${before ? `&before=${encodeURIComponent(before)}` : ""}`);
    pages.unshift(page.messages ?? []);
    if (!page.has_more) break;
    if (!page.next_cursor || cursors.has(page.next_cursor)) throw new Error("MCode history pagination did not advance.");
    before = page.next_cursor;
    cursors.add(before);
  }
  return pages.flat();
}
async function sessions(rpc) {
  const result = [];
  const cursors = /* @__PURE__ */ new Set();
  let cursor;
  for (; ; ) {
    const page = await rpc.request(`${API}/agent/mavis/session?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    result.push(...page.sessions ?? []);
    if (!page.has_more) return result;
    if (!page.next_cursor || cursors.has(page.next_cursor)) throw new Error("MCode session pagination did not advance.");
    cursor = page.next_cursor;
    cursors.add(cursor);
  }
}
var providerRow = (session) => ({
  id: namespaced(session.session_id),
  root: session.workspace_dir,
  title: session.title || "MiniMax Code",
  stands: "",
  at: Number(session.updated_at ?? session.created_at),
  created: Number(session.created_at),
  driven: true,
  ...session.effective_model ? { model: session.effective_model } : {}
});

// src/mcode-state.mjs
import { isAbsolute as isAbsolute2 } from "node:path";
import { fileURLToPath } from "node:url";
var efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
async function selectedModel(rpc, id) {
  const data = await rpc.request(`${API}/models/list${id ? `?session_id=${encodeURIComponent(id)}` : ""}`);
  return data.models?.find((model) => model.selected === true);
}
async function usesKey(rpc, model) {
  if (model?.provider_kind === "user") return true;
  if (model?.provider_id && model.provider_id !== "minimax") return true;
  const source = (await rpc.request(`${API}/model-providers/minimax-source`)).active_source;
  return source === "minimax_api_key" ? true : source === "token_plan" ? false : void 0;
}
function taskView(task) {
  if (!task || task.is_deleted || typeof task.task_id !== "string") return void 0;
  const status = ["running", "running", "running", "completed", "failed", "stopped", "failed"][task.status];
  const started = Number(task.started_at ?? task.created_at);
  if (!status || !Number.isFinite(started)) return void 0;
  let output = task.output_file_path;
  if (output?.startsWith("file://")) {
    try {
      output = fileURLToPath(output);
    } catch {
      output = void 0;
    }
  }
  return {
    id: task.task_id,
    kind: "local_bash",
    what: task.display_name || "MCode background task",
    status,
    started,
    ...typeof task.command === "string" ? { command: task.command } : {},
    ...task.ended_at != null && Number.isFinite(Number(task.ended_at)) ? { ended: Number(task.ended_at) } : {},
    ...Number.isInteger(task.exit_code) ? { exit: task.exit_code } : {},
    ...typeof output === "string" && isAbsolute2(output) ? { output } : {}
  };
}
async function backgroundTasks(rpc, id) {
  const base = `${API}/session/${encodeURIComponent(id)}/background-tasks`;
  const { items = [] } = await rpc.request(base);
  const result = [];
  for (const summary of items) {
    if (summary.is_deleted) continue;
    try {
      const { task } = await rpc.request(`${base}/${encodeURIComponent(summary.task_id)}`);
      const view = taskView(task);
      if (view) result.push(view);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  return result;
}
async function stopTask(rpc, id, task) {
  if (typeof task !== "string" || !task) throw new Error("Missing MCode task ID.");
  const result = await rpc.request(`${API}/session/${encodeURIComponent(id)}/background-tasks/${encodeURIComponent(task)}/stop`, "POST", {});
  if (result.operation_error) throw new Error(result.operation_error.message || "MCode could not stop this task.");
  return result;
}
function quotaUsage(plan, measuredAt, unavailableReason, credits) {
  if (!plan) return void 0;
  return {
    quotas: [
      ...Object.entries(plan).map(([id, window]) => ({ id, name: id === "fiveHour" ? "5h" : id === "sevenDay" ? "Week" : id, ...window })),
      ...Number.isFinite(credits) && credits >= 0 ? [{ id: "credits", name: "Credits", remaining: credits, unit: "credits" }] : []
    ],
    ...Number.isFinite(measuredAt) ? { measuredAt } : {},
    ...unavailableReason ? { unavailableReason } : {}
  };
}

// src/mcode-terminal.mjs
var quote2 = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
var loginInstruction = "MiniMax Code needs sign-in. Run mcode login --region global in a terminal, complete sign-in in your browser, then resend this message. For a China account, use mcode login --region cn.";
function terminalScreen(text) {
  const lines = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split("\n").map((line) => line.trimEnd());
  const body = lines.join("\n");
  const border = (line) => /^\s*[─━]{5}/.test(line ?? "");
  const prompt = lines.findLastIndex((line, index) => /^\s*›\s/.test(line) && border(lines[index - 1]) && border(lines[index + 1]));
  const approvalAt = lines.findLastIndex((line) => /◆ Approval required|Always allow matching actions\?|Deny this action\?/.test(line));
  const approval = approvalAt !== -1 && (prompt === -1 || approvalAt > prompt);
  const approvalLines = approval ? dialogLines(lines.slice(approvalAt)) : [];
  const approvalText = approvalLines.join("\n");
  if (approval && /Always allow matching actions\?/.test(approvalText)) return question(dialogTitle(approvalLines), [{ label: "Always allow matching actions", keys: ["Enter"] }, { label: "Back", keys: ["Escape"] }]);
  if (approval && /Deny this action\?/.test(approvalText)) return question(dialogTitle(approvalLines), [{ label: "Deny", keys: ["Enter"] }, { label: "Back", keys: ["Escape"] }], true);
  if (approval) {
    const choices = approvalLines.map((line) => /^\s*[│┃]?\s*(?:›\s*)?([123])\s+(Allow for this conversation|Always allow matching actions|Deny and guide MCode)\b/.exec(line)).filter(Boolean);
    if (choices.length) {
      const options = choices.map((one) => ({ label: one[2], keys: [one[1]] }));
      if (/Ctrl\+E review all/.test(approvalText)) options.push({ label: "Review all details", keys: ["C-e"] });
      return question(dialogTitle(approvalLines.slice(0, approvalLines.findIndex((line) => /^\s*(?:›\s*)?[123]\s+(?:Allow|Always|Deny)/.test(line)))), options);
    }
  }
  const askAt = lines.findLastIndex((line) => /[╭┌].*\bAsk\b/.test(line));
  if (askAt !== -1 && (prompt === -1 || askAt > prompt)) {
    const askLines = dialogLines(lines.slice(askAt));
    const frame = askLines.join("\n");
    if (/Type your answer · Enter (?:send|next)/.test(frame)) return question(dialogTitle(askLines), [], true);
    if (/↑↓ move|Space toggle/.test(frame)) {
      const multiple = /Space toggle/.test(frame);
      const options = askLines.flatMap((line) => {
        const match = /^\s*[│┃]?\s*(?:[›→]\s*)?(?:([●○])\s*)?([1-9])\s{1,}(.+?)\s*[│┃]?\s*$/.exec(line);
        return match ? [{ label: `${match[1] ? `${match[1]} ` : ""}${match[3].trim()}`, keys: [match[2]] }] : [];
      });
      if (multiple) options.push({ label: "Submit selected", keys: ["Enter"] });
      if (/Other…/.test(frame) && !options.some((option) => option.label.includes("Other\u2026"))) options.push({ label: "Other\u2026", keys: ["o"] });
      if (/more below/.test(frame)) options.push({ label: "More options", keys: ["Down"] });
      if (/more above/.test(frame)) options.push({ label: "Previous options", keys: ["Up"] });
      if (options.length) return question(dialogTitle(askLines), options);
    }
  }
  const status = prompt === -1 ? body : lines.slice(Math.max(0, prompt - 4), prompt).join("\n");
  const working = /Esc (?:interrupt|to interrupt|stop)|esc (?:interrupt|to interrupt|stop)|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s/.test(status);
  const footer = prompt < 0 ? "" : lines.slice(prompt + 2).join("\n");
  const mode = /[│|]\s*(Auto|Ask|Manual|Full|Plan)\s*[│|]/.exec(footer)?.[1];
  const errorAt = prompt < 2 ? -1 : lines.findLastIndex((line, index) => index < prompt - 1 && /^\s*×\s+Error\s+·\s/.test(line));
  const error = errorAt === -1 || prompt - errorAt > 8 ? void 0 : lines.slice(errorAt, prompt - 2).join(" ").replace(/^\s*×\s+Error\s+·\s+/, "").replace(/\s+/g, " ").trim();
  return {
    kind: working ? "working" : prompt !== -1 && /(?:Message · Enter send|Start · @ file|Context .*|Effort .*|Permissions)/.test(body) && !/Starting server|Checking account/.test(body) ? "idle" : "unknown",
    text: body,
    ...!working && error ? { error } : {},
    ...mode ? { mode: { Auto: "auto", Ask: "manual", Manual: "manual", Full: "bypassPermissions", Plan: "plan" }[mode] } : {}
  };
}
function dialogLines(lines) {
  const end = lines.findIndex((line) => /^\s*[╰└]/.test(line));
  return (end < 0 ? lines : lines.slice(0, end)).map((line) => line.replace(/^\s*[╭┌][─━ ]*/, "").replace(/[─━ ]*[╮┐]\s*$/, "").replace(/^\s*[│┃] ?/, "").replace(/\s*[│┃]\s*$/, "").trimEnd()).filter((line) => !/^\s*[─━├┤┬┴]{3}/.test(line));
}
function dialogTitle(lines) {
  return lines.filter((line) => !/^\s*(?:↑|Enter |Type your answer|Space toggle)/.test(line)).join("\n").trim();
}
function question(detail, options, input = false) {
  const title = detail.split("\n").find((line) => line.trim()) ?? "MCode question";
  return { kind: "question", title, detail, options, input, signature: JSON.stringify({ detail, options, input }) };
}
function holdMcode({ rpc, options, hear, left, guide = async () => "", log = () => {
}, tmuxProgram = findTmux, command = mcodeCommand, environment = mcodeEnvironment }) {
  if (process.platform === "win32" || options.root.startsWith("ssh://")) throw new Error("MCode tmux requires a local macOS or Linux project.");
  if (options.launch || options.fork) throw new Error("MCode tmux requires local launch and a natively forked session.");
  const name = `geckit-minimax-${randomUUID3().slice(0, 12)}`;
  let closed = false, running = false, turn = false, stopping = false, submitting = false, polling, started;
  let checking = false, imagesDirectory, wanted, applying, closing;
  let serial = Promise.resolve(), activity = false, idle = 0, pending, previous = /* @__PURE__ */ new Map(), baseline = /* @__PURE__ */ new Set();
  let stateAt = 0, actualModel, actualEffort, actualMode, taskStates = /* @__PURE__ */ new Map();
  const emit = (items = [], gone = [], signals = []) => {
    if (!closed) hear({ items, gone, signals });
  };
  const tmux = async (args, input2) => {
    const { file, server } = await tmuxProgram();
    return new Promise((resolve3, reject) => {
      const child = execFile3(file, [...server, ...args], { env: environment(), timeout: 1e4, maxBuffer: 4 * 1024 * 1024 }, (error, out) => error ? reject(new Error(`tmux ${args[0]} failed.`)) : resolve3(out));
      if (input2 !== void 0) child.stdin.end(input2);
    });
  };
  const alive = () => tmux(["display-message", "-p", "-t", name, "#{pane_dead}"]).then((text) => text.trim() === "0", () => false);
  const screen = async () => terminalScreen(await tmux(["capture-pane", "-p", "-t", name]));
  const login = createLogin({ tmux, command, environment, root: options.root, account: () => rpc.account(), emit });
  const requireLogin = async () => {
    const model = options.model ? { provider_id: options.model.split("/")[0] } : await selectedModel(rpc, options.id);
    if (await usesKey(rpc, model) === true) return;
    if ((await rpc.account()).state === "authenticated") return;
    await login.run();
    if (closed || stopping) throw new Error("MCode stopped before delivery.");
  };
  const resolveQuestion = () => {
    if (pending) {
      emit([], [`card:${pending.id}`], [{ kind: "resolved", ask: pending.id }]);
      pending = void 0;
    }
  };
  const showQuestion = (value) => {
    if (pending?.signature === value.signature) return;
    resolveQuestion();
    pending = { ...value, id: `mcode-question:${randomUUID3()}` };
    emit([], [], [{ kind: "asks", ask: pending.id, wanted: { kind: "question", question: value.detail, choices: value.options.map((option) => option.label) } }]);
    emit([{ kind: "card", id: `card:${pending.id}`, card: { kind: "question", title: value.title, detail: value.detail, choices: value.options.map((option) => option.label) } }]);
  };
  const refresh = async () => {
    const saved = await messages(rpc, options.id);
    const items = (await Promise.all(saved.map((message) => messageItemsWithImages(message, options.root)))).flat();
    const current = new Map(items.map((item) => [item.id, JSON.stringify(item)]));
    const changed = items.filter((item) => previous.get(item.id) !== current.get(item.id));
    const gone = [...previous.keys()].filter((id) => !current.has(id));
    if (turn && saved.some((message) => !baseline.has(message.msg_id))) activity = true;
    const spend = contextSpend(saved);
    emit(changed, gone, spend ? [{ kind: "spend", ...spend }] : []);
    const doing = changed.findLast((item) => item.kind === "did" && item.live);
    if (doing) emit([], [], [{ kind: "doing", what: doing.what }]);
    const paths = changed.filter((item) => item.kind === "did" && item.live && ["write", "edit"].includes(item.what) && item.path).map((item) => resolve2(options.root, item.path));
    if (paths.length) emit([], [], [{ kind: "writing", paths }]);
    const said = changed.findLast((item) => item.kind === "theirs");
    if (said) emit([], [], [{ kind: "said", text: said.text }]);
    previous = current;
    return saved;
  };
  const refreshState = async () => {
    if (Date.now() - stateAt < 3e3) return;
    stateAt = Date.now();
    const results = await Promise.allSettled([backgroundTasks(rpc, options.id), selectedModel(rpc, options.id)]);
    if (results[0].status === "fulfilled") for (const task of results[0].value) {
      const value = JSON.stringify(task);
      if (taskStates.get(task.id) !== value) emit([], [], [{ kind: "task", task }]);
      taskStates.set(task.id, value);
    }
    if (results[1].status === "fulfilled") {
      const selected = results[1].value;
      const model = selected && `${selected.provider_id}/${selected.model_id}`;
      const effort = selected?.thinking?.effort;
      if (model && model !== actualModel) {
        actualModel = model;
        emit([], [], [{ kind: "model", model }]);
      }
      if (efforts.includes(effort) && effort !== actualEffort) {
        actualEffort = effort;
        emit([], [], [{ kind: "reasoning", effort }]);
      }
    }
    for (const result of results) if (result.status === "rejected") log("warn", "session.state.failed", { error: result.reason.name });
  };
  const finish = (how, text) => {
    if (!turn) return;
    turn = false;
    stopping = false;
    idle = 0;
    if (how === "signedOut") emit([{ kind: "note", id: `mcode-signin:${randomUUID3()}`, note: "failed", text: loginInstruction }]);
    emit([], [], [{ kind: "ended", how, ...text ? { text } : {} }]);
    log("info", "session.turn.ended", { session: options.id, outcome: how });
  };
  const close = () => {
    if (closing) return closing;
    login.cancel();
    resolveQuestion();
    finish("stopped");
    closed = true;
    clearInterval(polling);
    closing = (async () => {
      await login.end();
      await started?.catch(() => {
      });
      if (running) {
        await tmux(["send-keys", "-t", name, "Escape", "C-u", "C-d"]).catch(() => {
        });
        for (let attempt = 0; attempt < 20 && await alive(); attempt++) await delay2(100);
        await tmux(["kill-session", "-t", name]).catch(() => {
        });
      }
      running = false;
      try {
        if (imagesDirectory) await rm(imagesDirectory, { recursive: true, force: true });
      } finally {
        left();
        log("info", "session.closed", { session: options.id });
      }
    })();
    return closing;
  };
  const poll = async () => {
    if (closed || !running || submitting || login.active) return;
    if (!await alive()) {
      finish("failed", "MCode exited.");
      await close();
      return;
    }
    const saved = await refresh();
    await refreshState();
    const shown = await screen();
    if (turn && shown.kind === "unknown") await requireLogin();
    if (shown.mode && shown.mode !== actualMode) {
      actualMode = shown.mode;
      emit([], [], [{ kind: "mode", mode: actualMode }]);
    }
    if (shown.kind === "question") {
      activity = true;
      idle = 0;
      showQuestion(shown);
      return;
    }
    resolveQuestion();
    if (shown.kind === "working") {
      if (!turn) {
        baseline = new Set(saved.map((message) => message.msg_id));
        turn = true;
        emit([], [], [{ kind: "begun" }]);
      }
      activity = true;
    }
    if (turn && !stopping && shown.kind === "idle" && shown.error) {
      const native = await rpc.request(`${API}/session/${options.id}/activity`);
      if (native.state === 0) idle++;
      else idle = 0;
      if (idle >= 2) {
        await tmux(["send-keys", "-t", name, "C-c"]).catch(() => {
        });
        finish(/usage limit|rate limit/i.test(shown.error) ? "limit" : "failed", shown.error);
      }
    } else if (turn && (activity || stopping) && shown.kind === "idle") {
      const native = await rpc.request(`${API}/session/${options.id}/activity`);
      if (native.state === 0) idle++;
      else idle = 0;
      if (idle >= 2) {
        const last = saved.findLast((message) => message.role === "assistant" && !baseline.has(message.msg_id));
        finish(stopping ? "stopped" : last?.finish_reason === "error" ? "failed" : "done");
      }
    } else idle = 0;
    await applyPermission();
  };
  const start = async () => {
    const session = (await rpc.request(`${API}/session/${options.id}`)).session;
    if (!session || session.workspace_dir !== options.root) throw new Error("MCode session does not belong to this project.");
    if (options.reasoning) {
      const model = options.model || session.effective_model || `${session.model?.provider_id}/${session.model?.model_id}`;
      const slash = model.indexOf("/");
      if (slash < 1 || model.includes("undefined")) throw new Error("Select a model before setting reasoning effort.");
      await rpc.request(`${API}/models/select`, "POST", { session_id: options.id, provider_id: model.slice(0, slash), model_id: model.slice(slash + 1), thinking: { effort: options.reasoning } });
    }
    baseline = new Set((await refresh()).map((message) => message.msg_id));
    const env = environment();
    const args = [command(), "--session", options.id, "--tui-mode", "regular"];
    if (options.model) args.push("--model", options.model);
    const prompt = [await guide(), options.managerPrompt].filter(Boolean).join("\n\n");
    if (prompt) args.push("--append-system-prompt", prompt);
    const selected = await selectedModel(rpc, options.id);
    const key = await usesKey(rpc, options.model ? { provider_id: options.model.split("/")[0] } : selected);
    if (key === void 0) throw new Error("MCode did not report the model billing source.");
    const removed = Object.keys(process.env).filter((key2) => key2.startsWith("GECKIT_"));
    const launch = ["exec", "env", ...removed.flatMap((key2) => ["-u", key2]), `PATH=${env.PATH}`, ...["MINIMAX_DATA_DIR", "MAVIS_DATA_DIR", "MINIMAX_PROFILE", "MAVIS_PROFILE"].filter((key2) => env[key2]).map((key2) => `${key2}=${env[key2]}`), ...args].map(quote2).join(" ");
    if (closed) return;
    await tmux(["new-session", "-d", "-s", name, "-x", "140", "-y", "50", "-c", options.root, launch, ";", "set-option", "-p", "-t", name, "remain-on-exit", "on"]);
    running = true;
    log("info", "session.started", { session: options.id });
    emit([], [], [{ kind: "started", session: namespaced(options.id), key, ...options.model ? { model: options.model } : {} }]);
    await refreshState();
    polling = setInterval(() => {
      if (checking || closed) return;
      checking = true;
      serial = serial.then(poll).catch(async (error) => {
        if (!closed) log("warn", "session.poll.failed", { error: error.name });
        if (error.status === 401 || error.status === 429) {
          finish(error.status === 401 ? "signedOut" : "limit", error.message);
          await close();
        }
      }).finally(() => {
        checking = false;
      });
    }, 700);
  };
  const ready = async () => {
    for (let attempt = 0; attempt < 600; attempt++) {
      if (closed || stopping) throw new Error("MCode stopped before delivery.");
      if (!await alive()) throw new Error("MCode exited before input. Run mcode in a terminal to check login and startup.");
      const shown = await screen();
      if (shown.kind === "unknown" && attempt % 30 === 0) await requireLogin();
      if (shown.kind === "idle") {
        resolveQuestion();
        return;
      }
      if (shown.kind === "question") {
        showQuestion(shown);
        attempt = 0;
      }
      await delay2(100);
    }
    throw new Error(`MCode is waiting in its terminal. Attach with: tmux attach -t ${name}`);
  };
  const paste = async (text, guard, submit = true) => {
    if (!text) {
      await guard();
      if (submit) await tmux(["send-keys", "-t", name, "Enter"]);
      return;
    }
    const buffer = `geckit-minimax-${randomUUID3()}`;
    try {
      await guard();
      await tmux(["load-buffer", "-b", buffer, "-"], text);
      await guard();
      await tmux(["paste-buffer", "-p", "-r", "-d", "-b", buffer, "-t", name]);
      await delay2(100);
      await guard();
      if (submit) await tmux(["send-keys", "-t", name, "Enter"]);
    } finally {
      await tmux(["delete-buffer", "-b", buffer]).catch(() => {
      });
    }
  };
  const input = (text, images, before) => {
    validateImages(images);
    const prompt = [...before ?? [], text].join("\n\n");
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(prompt)) throw new Error("Terminal control characters are not allowed in prompts.");
    return prompt;
  };
  const applyPermission = (beforeSend = false) => {
    if (applying) return applying;
    if (!wanted || closed || !running || !beforeSend && (turn || submitting)) return Promise.resolve();
    applying = (async () => {
      const requested = wanted;
      const mode = { manual: "ask", auto: "auto", bypassPermissions: "full" }[requested];
      if (!mode || (await screen()).kind !== "idle") return;
      await paste(`/permission ${mode}`, async () => {
        if (closed || stopping) throw new Error("MCode stopped.");
      });
      await delay2(350);
      await ready();
      if (wanted === requested) wanted = void 0;
      log("info", "session.permission.changed", { session: options.id, mode });
    })().finally(() => {
      applying = void 0;
    });
    return applying;
  };
  const attach = async (images, guard) => {
    if (!images.length) return;
    imagesDirectory ??= await mkdtemp(join3(tmpdir(), "geckit-mcode-images-"));
    const capture = () => tmux(["capture-pane", "-p", "-t", name]);
    const numbers = (text) => {
      const lines = text.split("\n");
      const editor = lines.findLastIndex((line) => /^\s*›\s/.test(line));
      return editor < 0 ? [] : [...lines.slice(editor).join("\n").matchAll(/\[Image #(\d+)\]/g)].map((match) => Number(match[1]));
    };
    for (const image of images) {
      const previous2 = new Set(numbers(await capture()));
      const path = join3(imagesDirectory, `${randomUUID3()}.${imageExtensions[image.media]}`);
      await writeFile(path, Buffer.from(image.data, "base64"), { mode: 384, flag: "wx" });
      await paste(path, guard, false);
      let attached = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        await guard();
        if (numbers(await capture()).some((number) => !previous2.has(number))) {
          attached = true;
          break;
        }
        await delay2(100);
      }
      if (!attached) throw new Error("MCode did not accept the image attachment.");
    }
  };
  const prepare = async () => {
    await requireLogin();
    const fresh = started === void 0;
    started ??= start();
    await started;
    await applying;
    await ready();
    if (fresh && options.mode) {
      const mode = { manual: "ask", auto: "auto", plan: "ask", bypassPermissions: "full" }[options.mode];
      if (!mode) throw new Error(`Unsupported MCode permission mode: ${options.mode}`);
      await paste(`/permission ${mode}`, async () => {
        if (closed || stopping) throw new Error("MCode stopped.");
      });
      await delay2(350);
      await ready();
      await paste(`/plan ${options.mode === "plan" ? "on" : "off"}`, async () => {
        if (closed || stopping) throw new Error("MCode stopped.");
      });
      await delay2(350);
      await ready();
    }
    while (wanted && !closed) {
      await ready();
      await applyPermission(true);
    }
    baseline = new Set((await refresh()).map((message) => message.msg_id));
  };
  const goalTurn = async (method, body) => {
    if (closed || submitting || turn) throw new Error("MCode is not ready for a goal turn.");
    submitting = true;
    try {
      await prepare();
      if (closed || stopping) throw new Error("MCode stopped before goal delivery.");
      turn = true;
      stopping = false;
      activity = false;
      idle = 0;
      emit([], [], [{ kind: "begun" }]);
      submitting = false;
      const result = await rpc.request(`${API}/session/${options.id}/goal`, method, body);
      log("info", "goal.started", { session: options.id, operation: method });
      return result;
    } catch (error) {
      finish(error.status === 401 ? "signedOut" : error.status === 429 ? "limit" : "failed", error.message);
      await close();
      throw error;
    } finally {
      submitting = false;
    }
  };
  const driver = {
    send(text, images = [], before = []) {
      if (closed || submitting || turn) throw new Error("MCode is not ready for a new turn.");
      const prompt = input(text, images, before);
      submitting = true;
      turn = true;
      stopping = false;
      activity = false;
      idle = 0;
      emit([], [], [{ kind: "begun" }]);
      void (async () => {
        await prepare();
        const guard = async () => {
          if (closed || stopping) throw new Error("MCode delivery stopped.");
        };
        await attach(images, guard);
        await paste(prompt, guard);
        log("info", "message.sent", { session: options.id, delivery: "send" });
      })().catch(async (error) => {
        finish(stopping ? "stopped" : error.status === 401 ? "signedOut" : error.status === 429 ? "limit" : "failed", error.message);
        await close();
      }).finally(() => {
        submitting = false;
      });
    },
    startGoal: (objective, existing = false) => goalTurn(existing ? "PATCH" : "POST", existing ? { objective, status: "active" } : { objective }),
    observeGoal: async () => {
      if (closed) throw new Error("MCode is closed.");
      started ??= start();
      await started;
    },
    resumeGoal: () => goalTurn("PATCH", { status: "active" }),
    async inject(text, images = [], before = []) {
      if (closed || !turn || stopping || submitting || pending || login.active) throw new Error("MCode cannot accept guidance now; the message remains queued.");
      const prompt = input(text, images, before);
      submitting = true;
      const guard = async () => {
        if (closed || !turn || stopping || !await alive() || (await screen()).kind !== "working") throw new Error("MCode is no longer ready for guidance.");
      };
      try {
        await attach(images, guard);
        await paste(prompt, guard);
        log("info", "message.sent", { session: options.id, delivery: "inject" });
      } catch (error) {
        const shown = await screen().catch(() => ({}));
        if (shown.kind === "idle" || shown.kind === "working") await tmux(["send-keys", "-t", name, "C-u"]).catch(() => {
        });
        throw error;
      } finally {
        submitting = false;
      }
    },
    answer(id, answer) {
      if (login.answer(id, answer)) return;
      if (pending?.id !== id || closed) return;
      const current = pending;
      serial = serial.then(async () => {
        const shown = await screen();
        if (shown.signature !== current.signature) {
          resolveQuestion();
          return;
        }
        const selected = shown.options.find((option) => option.label === answer);
        if (!selected && !shown.input) return;
        if (selected) await tmux(["send-keys", "-t", name, ...selected.keys]);
        else await paste(input(String(answer), [], []), async () => {
          if (closed) throw new Error("MCode closed.");
        });
        resolveQuestion();
      }).catch((error) => {
        log("warn", "permission.reply.failed", { error: error.name });
      });
    },
    permit(mode, again = []) {
      if (closed || !["manual", "auto", "bypassPermissions"].includes(mode)) return;
      wanted = mode;
      if (mode === "auto" && pending !== void 0 && again.includes(pending.id)) {
        const allow = pending.options.find((option) => /^Allow for this conversation$/.test(option.label));
        if (allow !== void 0) this.answer(pending.id, allow.label);
      }
      void applyPermission().catch((error) => {
        log("warn", "session.permission.failed", { error: error.name });
      });
    },
    stop() {
      if (!closed && turn) {
        stopping = true;
        login.cancel();
        resolveQuestion();
        if (running) void tmux(["send-keys", "-t", name, "Escape"]).catch(() => {
        });
      }
    },
    async control(request) {
      if (closed) throw new Error("MCode is closed.");
      if (request.subtype !== "stop_task") throw new Error(`Unsupported MCode control: ${request.subtype}`);
      const result = await stopTask(rpc, options.id, request.task_id);
      stateAt = 0;
      await refreshState();
      return result;
    },
    leave() {
      void close();
    },
    end: close
  };
  return driver;
}
var imageExtensions = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
function validateImages(images = []) {
  for (const image of images) {
    if (!Object.hasOwn(imageExtensions, image?.media) || typeof image.data !== "string" || !image.data.length || image.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(image.data) || Buffer.from(image.data, "base64").toString("base64") !== image.data) {
      throw new Error("Image attachments must contain PNG, JPEG, GIF or WebP base64 data.");
    }
  }
}

// src/mcode-quota.mjs
import { execFile as execFile4 } from "node:child_process";
import { randomUUID as randomUUID4 } from "node:crypto";
import { tmpdir as tmpdir2 } from "node:os";
import { setTimeout as delay3 } from "node:timers/promises";
var MINUTE = 6e4;
var quote3 = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
function quotaDuration(text) {
  let total = 0, found = false;
  for (const match of String(text ?? "").matchAll(/(\d+)\s*([dhms])/g)) {
    total += Number(match[1]) * { d: 864e5, h: 36e5, m: MINUTE, s: 1e3 }[match[2]];
    found = true;
  }
  return found ? total : void 0;
}
function parseQuota(text, now = Date.now()) {
  const plain = String(text ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split("\n").map((line) => line.replace(/^\s*[│┃]\s?/, "").replace(/\s*[│┃]\s*$/, "")).join("\n");
  const windows = {};
  const balance = /^[ \t]*Credits(?:[ \t]*:[ \t]*|[ \t]+)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?[ \t]*$/im.exec(plain);
  const amount = balance ? Number(balance[1].replaceAll(",", "") + (balance[2] ? `.${balance[2]}` : "")) : void 0;
  const credits = Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER ? amount : void 0;
  const unavailableReason = /^[ \t]*Quota(?:[ \t]*:[ \t]*|[ \t]+)No Token Plan subscription[ \t]*$/im.test(plain) ? "No active Token Plan subscription" : /^[ \t]*Quota(?:[ \t]*:[ \t]*|[ \t]+)Temporarily unavailable[ \t]*$/im.test(plain) ? "MiniMax is temporarily not reporting limits" : void 0;
  for (const match of plain.matchAll(/^\s*[│┃]?\s*(5-hour|Weekly)\b[^\n]*?(\d{1,3})\s*%\s*left\b[^\n]*?resets in\s+([0-9dhms]+(?:\s*[0-9dhms]+)*)/gim)) {
    const duration = quotaDuration(match[3]);
    const remaining = Number(match[2]);
    if (duration === void 0 || remaining > 100) continue;
    const spent = (100 - remaining) / 100;
    const window = { part: spent, resetsAt: now + duration };
    if (match[1].toLowerCase() === "5-hour") windows.fiveHour = window;
    else windows.sevenDay = window;
  }
  if (!windows.fiveHour && !windows.sevenDay && credits === void 0 && !unavailableReason) return void 0;
  const account = /^\s*[│┃]?\s*Account:\s*(.+?)\s*$/im.exec(plain)?.[1];
  const tier = /^[ \t]*Plan(?:[ \t]*:[ \t]*|[ \t]+)([^\n]+?)[ \t]*$/im.exec(plain)?.[1]?.trim();
  const label = tier && tier !== "Token Plan" ? tier : account === void 0 ? void 0 : /\(([^()]+)\)\s*$/.exec(account)?.[1]?.trim();
  return { windows, ...label ? { label } : {}, ...credits === void 0 ? {} : { credits }, ...unavailableReason ? { unavailableReason } : {} };
}
function quotaReader({ name = `geckit-mcode-quota-${randomUUID4()}`, tmuxProgram = findTmux, command = mcodeCommand, environment = mcodeEnvironment, log = () => {
}, every = 10 * MINUTE, execute = execFile4 } = {}) {
  const tmux = async (args) => {
    const { file, server } = await tmuxProgram();
    return new Promise((resolve3, reject) => {
      execute(file, [...server, ...args], { env: environment(), timeout: 2e4, maxBuffer: 4 * 1024 * 1024 }, (error, out) => error ? reject(new Error(`tmux ${args[0]} failed.`)) : resolve3(out));
    });
  };
  const exists = () => tmux(["has-session", "-t", name]).then(() => true, () => false);
  const alive = () => tmux(["display-message", "-p", "-t", name, "#{pane_dead}"]).then((text) => text.trim() === "0", () => false);
  const capture = () => tmux(["capture-pane", "-p", "-J", "-t", name]);
  let cached, reading, disposal, owned = false, disposed = false, lastRead = 0;
  const launch = async () => {
    const env = environment();
    const removed = Object.keys(process.env).filter((key) => key.startsWith("GECKIT_"));
    const command2 = [
      "exec",
      "env",
      ...removed.flatMap((key) => ["-u", key]),
      `PATH=${env.PATH}`,
      ...["MINIMAX_DATA_DIR", "MAVIS_DATA_DIR", "MINIMAX_PROFILE", "MAVIS_PROFILE"].filter((key) => env[key]).map((key) => `${key}=${env[key]}`),
      command(),
      "--tui-mode",
      "regular"
    ].map(quote3).join(" ");
    await tmux(["new-session", "-d", "-s", name, "-x", "140", "-y", "50", "-c", tmpdir2(), command2]);
    owned = true;
  };
  const ready = async () => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (disposed) throw new Error("MCode provider disposed.");
      if (!await alive()) throw new Error("MCode exited before the status panel.");
      if (terminalScreen(await capture()).kind === "idle") return;
      await delay3(100);
    }
    throw new Error("MCode did not become ready for /usage.");
  };
  const read = async () => {
    if (disposed) return void 0;
    if (await exists() && !await alive()) await tmux(["kill-session", "-t", name]).catch(() => {
    });
    if (!await exists()) await launch();
    await ready();
    await tmux(["send-keys", "-t", name, "-l", "/usage"]);
    await delay3(500);
    await tmux(["send-keys", "-t", name, "Enter"]);
    let found;
    try {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (disposed) return void 0;
        await delay3(200);
        found = parseQuota(await capture());
        if (found !== void 0) break;
      }
    } finally {
      await tmux(["send-keys", "-t", name, "Escape"]).catch(() => {
      });
    }
    lastRead = Date.now();
    if (found !== void 0) cached = { ...found, measuredAt: lastRead };
    log("info", "quota.read", { outcome: found === void 0 ? "unreadable" : "completed", windows: found === void 0 ? 0 : Object.keys(found.windows).length, creditsReported: found?.credits !== void 0 });
    return found === void 0 ? void 0 : cached;
  };
  const refresh = () => {
    if (disposed) return Promise.resolve(void 0);
    reading ??= read().finally(() => {
      reading = void 0;
    });
    return reading.catch((error) => {
      if (!disposed) log("warn", "quota.read.failed", { error: error.name });
      return void 0;
    });
  };
  return {
    // The plan's windows as last read. The first reading waits for MCode;
    // later ones are answered from what is known and refreshed behind them.
    async windows() {
      if (cached === void 0) return (await refresh())?.windows;
      if (Date.now() - cached.measuredAt > every) void refresh();
      return cached.windows;
    },
    // The name of the plan, as MCode itself names it.
    label() {
      return cached?.label;
    },
    credits() {
      return cached?.credits;
    },
    unavailableReason() {
      return cached?.unavailableReason;
    },
    measuredAt() {
      return cached?.measuredAt;
    },
    // Read the plan again, and say how long ago it was last read.
    async refresh() {
      if (Date.now() - lastRead < MINUTE) return cached;
      return refresh();
    },
    dispose() {
      disposed = true;
      return disposal ??= (async () => {
        await reading?.catch(() => {
        });
        if (owned) await tmux(["kill-session", "-t", name]).catch(() => {
        });
      })();
    }
  };
}

// src/mcode-guide.mjs
import { homedir as homedir3 } from "node:os";
import { join as join4 } from "node:path";
import { readFile as readFile2 } from "node:fs/promises";
function instructionGuide({
  read = readFile2,
  home = homedir3(),
  source = process.env.GECKIT_SOURCE_CLI,
  sourceGuide = process.env.GECKIT_SOURCE_CODEX_GUIDE || process.env.GECKIT_SOURCE_GUIDE
} = {}) {
  let enabled = false;
  return {
    set(value) {
      enabled = value === true;
    },
    async prompt() {
      if (!enabled) return "";
      const command = source || join4(home, ".geckit", "bin", "geckit");
      const paths = sourceGuide ? [sourceGuide] : source ? [] : [join4(home, ".codex", "GECKIT.md"), join4(home, ".claude", "GECKIT.md")];
      let guide;
      for (const path of paths) {
        try {
          guide = await read(path, "utf8");
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      guide ??= `This conversation runs in GeckIt, a desktop app. The first line of your answer appears on its conversation card: state what is done or what remains. Write complete URLs for produced links. Report background commands and what they await. Do not set or clear goals on your own. Use the GeckIt CLI below to read sessions and assigned employee context (employees current, then employees memory with every returned cursor). Use its instructions providers or instructions app command before changing a provider or GeckIt. Independent work in another project belongs in a separate conversation requested with geckit start; read geckit help for the exact format. Do not duplicate the work of this conversation.`;
      return `${guide}
Use this GeckIt CLI for all GeckIt commands: ${JSON.stringify(command)}.
`;
    }
  };
}

// src/mcode-provider.mjs
var local = (root) => typeof root === "string" && !root.startsWith("ssh://");
var inRoot = (path, root) => path === root || path?.startsWith(root.replace(/\/$/, "") + "/");
var positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
var goalStatus = { active: "active", paused: "paused", complete: "complete", blocked: "blocked", budget_limited: "budgetLimited", usage_limited: "usageLimited" };
var shownGoal = (native) => native && typeof native.objective === "string" ? {
  ...native.status === "complete" ? {} : { goal: {
    condition: native.objective,
    checks: Number.isSafeInteger(native.turns_used) ? native.turns_used : 0,
    ...typeof native.status_reason === "string" ? { reason: native.status_reason } : {}
  } },
  ...goalStatus[native.status] ? { status: goalStatus[native.status] } : {}
} : void 0;
var modelSelection = (value) => {
  const at = value.indexOf("/");
  if (at <= 0 || at === value.length - 1) throw new Error("Select a provider/model from MCode\u2019s model list.");
  return { provider_id: value.slice(0, at), model_id: value.slice(at + 1) };
};
var installFrom = (path) => {
  if (typeof path !== "string") return void 0;
  if (path.includes("/.minimax-code/")) return "the native installer";
  if (path.includes("node_modules/@minimax-ai/code")) return "npm";
  if (path.includes("/Cellar/") || path.includes("/homebrew/")) return "Homebrew";
  return void 0;
};
function create(context = {}, dependencies = {}) {
  const rpc = dependencies.rpc ?? new McodeRpc();
  const log = (level, event, fields) => {
    try {
      context.log?.write(level, event, fields);
    } catch {
    }
  };
  const drivers = /* @__PURE__ */ new Set();
  let disposed = false, known = [], reported;
  const quota = dependencies.quota ?? quotaReader({ log });
  const guide = dependencies.guide ?? instructionGuide();
  const info = async (root, id) => {
    const native = nativeId(id);
    const session = (await rpc.request(`${API}/session/${native}`)).session;
    if (!session || !local(root) || session.workspace_dir !== root) {
      const error = new Error("MCode session does not belong to this project.");
      error.status = 404;
      throw error;
    }
    return session;
  };
  const read = async (root, id) => {
    try {
      await info(root, id);
    } catch (error) {
      if (error.status === 404) return void 0;
      throw error;
    }
    const saved = await messages(rpc, nativeId(id));
    const native = await rpc.request(`${API}/session/${nativeId(id)}/goal`);
    return {
      items: (await Promise.all(saved.map((message) => messageItemsWithImages(message, root)))).flat(),
      tasks: await backgroundTasks(rpc, nativeId(id)),
      ...contextSpend(saved),
      ...shownGoal(native.goal)?.goal ? { goal: shownGoal(native.goal).goal } : {}
    };
  };
  const reportPlan = async () => {
    if (await usesKey(rpc, await selectedModel(rpc)) === true) return;
    const found = await quota.refresh();
    if (!found?.windows) return;
    const said = JSON.stringify(reported);
    reported = quotaUsage(found.windows, found.measuredAt, found.unavailableReason, found.credits);
    if (said === JSON.stringify(reported)) return;
    for (const driver of drivers) driver.report({ items: [], gone: [], signals: [{ kind: "plan", plan: found.windows }, { kind: "usage", usage: reported }] });
  };
  const provider = {
    id: ID,
    family: ID,
    name: "MiniMax Code (tmux)",
    shortName: "MCode",
    icon: "terminal",
    browser: "none",
    loginCommand: "mcode login --region global",
    resumeCommand: "mcode --session {id}",
    planName: "MiniMax",
    localOnly: true,
    available: true,
    subscriptionOnly: false,
    images: true,
    remoteControl: false,
    nativeGoals: true,
    autoStartingGoals: true,
    idleMs: 36e5,
    waitForExit: true,
    instructions: "own",
    setInstructions: async (enabled) => {
      guide.set(enabled);
    },
    program: dependencies.program ?? program,
    account: async () => {
      const installed = await (dependencies.program ?? program)();
      if (!installed) return { provider: ID, here: false, signedIn: void 0 };
      const account = await rpc.account();
      const from = installFrom(installed.path);
      const program2 = { ...installed, ...from === void 0 ? {} : { from } };
      const model = await selectedModel(rpc);
      const key = await usesKey(rpc, model);
      if (key === true) return { provider: ID, here: true, signedIn: model?.enabled === true ? true : void 0, key, program: program2 };
      if (account.state !== "authenticated") return { provider: ID, here: true, signedIn: false, program: program2 };
      const plan = await quota.windows();
      const label = quota.label();
      return {
        provider: ID,
        here: true,
        signedIn: true,
        program: program2,
        ...key === void 0 ? {} : { key },
        ...plan === void 0 ? {} : { usage: quotaUsage(plan, quota.measuredAt?.(), quota.unavailableReason?.(), quota.credits?.()) },
        ...plan === void 0 || label === void 0 ? {} : { plan: label }
      };
    },
    models: async () => {
      const data = await rpc.request(`${API}/models/list`);
      known = (data.models ?? []).map((model) => ({
        value: `${model.provider_id}/${model.model_id}`,
        id: model.model_id,
        name: model.display_name || model.model_id,
        isDefault: model.selected === true,
        ...model.enabled === false ? { disabled: true } : {},
        ...positive(model.context_limit) ? { contextWindow: Number(model.context_limit) } : {},
        ...positive(model.max_output_tokens) ? { maxOutputTokens: Number(model.max_output_tokens) } : {},
        ...efforts.includes(model.default_effort) ? { defaultReasoning: model.default_effort } : {},
        reasoning: (model.effort_options ?? []).filter((value) => ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value)).map((value) => ({ value, says: value }))
      }));
      return known;
    },
    limits: async (models) => {
      if (!known.length && models.length) await provider.models();
      const windows = new Map(models.map((model) => [model, known.find((item) => item.value === model || item.id === model)?.contextWindow]));
      const selected = known.find((model) => model.isDefault)?.value;
      if (await usesKey(rpc, selected ? { provider_id: selected.split("/")[0] } : void 0) === true) return { windows };
      const plan = await quota.windows();
      return { windows, ...plan === void 0 ? {} : { plan, ...quotaUsage(plan, quota.measuredAt?.(), quota.unavailableReason?.(), quota.credits?.()) } };
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
        const matched = (await messages(rpc, session.session_id)).filter((message) => words.every((word) => (message.msg_content ?? "").toLowerCase().includes(word)));
        if (matched.length) found.push({ id: namespaced(session.session_id), root: session.workspace_dir, count: matched.length, said: matched.at(-1).msg_content.slice(0, 240) });
      }
      return found;
    },
    hidden: async (from, to, include) => (await sessions(rpc)).filter((session) => Number(session.updated_at) >= from && Number(session.updated_at) < to && include(namespaced(session.session_id))).map(providerRow),
    create: async ({ root, model } = {}) => {
      if (disposed) throw new Error("MCode provider disposed.");
      if (!local(root)) throw new Error("MCode requires a local project.");
      const result = await rpc.request(`${API}/agent/mavis/session`, "POST", { workspace_dir: root, ...model ? { model: modelSelection(model) } : {} });
      if (!result.session_id) throw new Error("MCode did not return a session ID.");
      return namespaced(result.session_id);
    },
    fork: async (root, id, at, _mode, model) => {
      await info(root, id);
      const selection = model ? modelSelection(model) : void 0;
      const saved = await messages(rpc, nativeId(id));
      const point = saved.findLast((message) => message.role === "assistant" && Number(message.timestamp) <= at && message.actions?.fork === true);
      if (!point) throw new Error("MCode has no completed assistant response to fork at this point.");
      const result = await rpc.request(`${API}/session/${nativeId(id)}/fork`, "POST", { assistant_message_id: point.msg_id, client_request_id: randomUUID5(), use_suggested_title: false, create_isolated_worktree: false });
      if (!result.session?.session_id) throw new Error("MCode did not return the forked session.");
      const forkId = namespaced(result.session.session_id);
      if (selection) await rpc.request(`${API}/models/select`, "POST", { session_id: result.session.session_id, ...selection });
      return { id: forkId, begun: true, items: (await read(root, forkId)).items };
    },
    has: async (root, id) => {
      try {
        await info(root, id);
        return true;
      } catch (error) {
        if (error.status === 404) return false;
        throw error;
      }
    },
    read,
    links: async (root, id) => messageLinks((await read(root, id))?.items ?? []),
    goal: async (root, id) => {
      await info(root, id);
      return shownGoal((await rpc.request(`${API}/session/${nativeId(id)}/goal`)).goal);
    },
    setGoal: async () => {
      throw new Error("MCode goals start a turn; hold a driver and call startGoal.");
    },
    startGoal: async (id, objective, driver, message) => {
      if (typeof driver?.startGoal !== "function") throw new Error("MCode goal driver is unavailable.");
      const native = nativeId(id);
      const current = (await rpc.request(`${API}/session/${native}/goal`)).goal;
      const task = message?.trim();
      const effective = task && task !== objective ? `Task: ${task}

Completion condition: ${objective}` : objective;
      if (current?.status === "active") {
        if (typeof driver.observeGoal !== "function") throw new Error("MCode goal observer is unavailable.");
        await driver.observeGoal();
        if (current.objective === effective) return shownGoal(current);
        return shownGoal((await rpc.request(`${API}/session/${native}/goal`, "PATCH", { objective: effective })).goal);
      }
      return shownGoal((await driver.startGoal(effective, current !== void 0)).goal);
    },
    clearGoal: async (id) => {
      await rpc.request(`${API}/session/${nativeId(id)}/goal`, "DELETE");
    },
    pauseGoal: async (id) => {
      await rpc.request(`${API}/session/${nativeId(id)}/goal`, "PATCH", { status: "paused" });
    },
    resumeGoal: async (_id, driver) => {
      if (typeof driver?.resumeGoal !== "function") throw new Error("MCode goal driver is unavailable.");
      await driver.resumeGoal();
    },
    rename: async (id, title) => {
      await rpc.request(`${API}/session/${nativeId(id)}`, "PATCH", { title });
    },
    remote: async () => {
      throw new Error("MCode tmux supports local projects only.");
    },
    mcp: async (_root, change) => {
      if (change !== void 0) await rpc.request(`${API}/mcp/servers/${encodeURIComponent(change.name)}/enabled`, "PATCH", { enabled: change.enabled === true });
      const listed = await rpc.request(`${API}/mcp/servers`);
      const runtime = await rpc.request(`${API}/mcp/runtime/servers`).catch(() => ({}));
      const states = new Map((runtime.servers ?? []).map((server) => [server.name, server]));
      return (listed.servers ?? []).map((server) => {
        const state = states.get(server.name);
        const enabled = server.enabled !== false;
        const status = !enabled ? "disabled" : ["expired", "pending_auth"].includes(state?.auth_status ?? state?.authStatus) ? "needs-auth" : state === void 0 || state.configured === false ? "pending" : "connected";
        return { name: server.name, status };
      });
    },
    browsers: async () => void 0,
    correct: async () => ({ ok: false, error: "Text correction is unavailable in MCode tmux." }),
    delete: async (root, id) => {
      await info(root, id);
      await rpc.request(`${API}/session/${nativeId(id)}`, "DELETE");
      return true;
    },
    hold: (options, hear, left) => {
      if (disposed) throw new Error("MCode provider disposed.");
      let driver;
      const report = (event) => {
        if (event.signals?.some((signal) => signal.kind === "ended")) void reportPlan().catch((error) => log("warn", "quota.refresh.failed", { error: error.name }));
        hear(event);
      };
      driver = holdMcode({ rpc, options: { ...options, id: nativeId(options.id) }, guide: () => guide.prompt(), hear: report, left: () => {
        drivers.delete(driver);
        left();
      }, log, ...dependencies.terminal });
      driver.report = report;
      drivers.add(driver);
      return driver;
    },
    dispose: () => {
      disposed = true;
      quota.dispose();
      void Promise.allSettled([...drivers].map((driver) => driver.end())).then(() => rpc.dispose());
    }
  };
  return provider;
}
export {
  create
};
