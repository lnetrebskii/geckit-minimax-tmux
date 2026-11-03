// src/mcode-provider.mjs
import { randomUUID as randomUUID4 } from "node:crypto";

// src/mcode-rpc.mjs
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
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
var program = () => new Promise((resolve) => execFile(mcodeCommand(), ["--version"], { env: mcodeEnvironment(), timeout: 15e3 }, (error, stdout) => {
  const version = stdout?.trim().match(/^\d+\.\d+\.\d+[^\s]*/)?.[0];
  resolve(error || !version ? void 0 : { version, path: mcodeCommand() });
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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        map.delete(id);
        reject(new Error("MCode control request timed out."));
      }, this.timeout);
      map.set(id, { resolve: (value) => {
        clearTimeout(timer);
        map.delete(id);
        resolve(value);
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
    if (frame.type === "response-start") stream.status = frame.status;
    if (frame.type === "stream-chunk") {
      stream.chunks.push(typeof frame.payload === "string" ? Buffer.from(frame.payload) : Buffer.from(frame.payload.data, "base64"));
      this.write({ method: "desktopService/transport", params: { frame: { type: "stream-credit", id: frame.id, credits: 1 } } });
    }
    if (frame.type === "stream-error") stream.reject(new Error("MCode local service failed."));
    if (frame.type === "stream-done") {
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
import { join as join3 } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// src/tmux-binary.mjs
import { execFile as execFile2 } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir as mkdirCache, readFile, rename, rm as rmPart, writeFile as writePart } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { delimiter as delimiter2, join as join2 } from "node:path";
var KNOWN = () => ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin", join2(homedir2(), ".nix-profile", "bin"), "/run/current-system/sw/bin", "/nix/var/nix/profiles/default/bin", join2(homedir2(), ".local", "bin")];
var tmuxRuns = (file) => new Promise((resolve) => {
  execFile2(file, ["-V"], { timeout: 5e3, windowsHide: true }, (error) => resolve(error === null));
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

// src/mcode-history.mjs
var API = "/minimax-desktop/api/v1";
var ID = "plugin:minimax-tmux";
var namespaced = (id) => `${ID}:${id}`;
function nativeId(id) {
  if (typeof id !== "string" || !id.startsWith(`${ID}:`) || !/^[A-Za-z0-9_-]+$/.test(id.slice(ID.length + 1))) throw new Error("Invalid MCode session ID.");
  return id.slice(ID.length + 1);
}
function messageItems(message) {
  const id = message.msg_id;
  if (typeof id !== "string") return [];
  const items = [];
  if (message.msg_content) items.push({
    kind: message.role === "user" ? "mine" : message.role === "assistant" ? "theirs" : "note",
    id,
    text: message.msg_content,
    ...message.role === "user" || message.role === "assistant" ? { at: Number(message.timestamp) } : { note: "task" }
  });
  if (message.thinking_content) items.push({ kind: "thought", id: `${id}:thinking`, text: message.thinking_content });
  for (const [index, tool] of (message.tool_calls ?? []).entries()) items.push({ kind: "did", id: `${id}:tool:${tool.tool_call_id ?? tool.id ?? index}`, what: tool.tool_name ?? tool.name ?? tool.function?.name ?? "Tool", detail: JSON.stringify(tool, null, 2), live: tool.tool_call_status === 1 });
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
    const usage = raw.context_usage;
    if (typeof usage?.usedTokens === "number") return { used: usage.usedTokens, ...typeof usage.contextWindowTokens === "number" ? { window: usage.contextWindowTokens } : {} };
    if (message.role === "assistant" && message.usage) {
      const value = message.usage;
      const used = ["input_tokens", "output_tokens", "cache_read", "cache_write"].reduce((sum, key) => sum + (Number(value[key]) || 0), 0);
      if (used) return { used, ...Number(value.context_window) > 0 ? { window: Number(value.context_window) } : {} };
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

// src/mcode-terminal.mjs
var quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
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
  return { kind: working ? "working" : prompt !== -1 && /(?:Message · Enter send|Start · @ file|Context .*|Effort .*|Permissions)/.test(body) && !/Starting server|Checking account/.test(body) ? "idle" : "unknown", text: body };
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
function holdMcode({ rpc, options, hear, left, log = () => {
}, tmuxProgram = findTmux, command = mcodeCommand, environment = mcodeEnvironment }) {
  if (process.platform === "win32" || options.root.startsWith("ssh://")) throw new Error("MCode tmux requires a local macOS or Linux project.");
  const name = `geckit-minimax-${randomUUID2().slice(0, 12)}`;
  let closed = false, running = false, turn = false, stopping = false, submitting = false, polling, started;
  let checking = false, imagesDirectory, wanted, applying;
  let serial = Promise.resolve(), activity = false, idle = 0, pending, previous = /* @__PURE__ */ new Map(), baseline = /* @__PURE__ */ new Set();
  const emit = (items = [], gone = [], signals = []) => {
    if (!closed) hear({ items, gone, signals });
  };
  const tmux = async (args, input2) => {
    const { file, server } = await tmuxProgram();
    return new Promise((resolve, reject) => {
      const child = execFile3(file, [...server, ...args], { env: environment(), timeout: 1e4, maxBuffer: 4 * 1024 * 1024 }, (error, out) => error ? reject(new Error(`tmux ${args[0]} failed.`)) : resolve(out));
      if (input2 !== void 0) child.stdin.end(input2);
    });
  };
  const alive = () => tmux(["display-message", "-p", "-t", name, "#{pane_dead}"]).then((text) => text.trim() === "0", () => false);
  const screen = async () => terminalScreen(await tmux(["capture-pane", "-p", "-t", name]));
  const resolveQuestion = () => {
    if (pending) {
      emit([], [`card:${pending.id}`], [{ kind: "resolved", ask: pending.id }]);
      pending = void 0;
    }
  };
  const showQuestion = (value) => {
    if (pending?.signature === value.signature) return;
    resolveQuestion();
    pending = { ...value, id: `mcode-question:${randomUUID2()}` };
    emit([], [], [{ kind: "asks", ask: pending.id, wanted: { kind: "question", question: value.detail, choices: value.options.map((option) => option.label) } }]);
    emit([{ kind: "card", id: `card:${pending.id}`, card: { kind: "question", title: value.title, detail: value.detail, choices: value.options.map((option) => option.label) } }]);
  };
  const refresh = async () => {
    const saved = await messages(rpc, options.id);
    const items = saved.flatMap(messageItems);
    const current = new Map(items.map((item) => [item.id, JSON.stringify(item)]));
    const changed = items.filter((item) => previous.get(item.id) !== current.get(item.id));
    const gone = [...previous.keys()].filter((id) => !current.has(id));
    if (turn && saved.some((message) => !baseline.has(message.msg_id))) activity = true;
    const spend = contextSpend(saved);
    emit(changed, gone, spend ? [{ kind: "spend", ...spend }] : []);
    previous = current;
    return saved;
  };
  const finish = (how, text) => {
    if (!turn) return;
    turn = false;
    stopping = false;
    idle = 0;
    emit([], [], [{ kind: "ended", how, ...text ? { text } : {} }]);
    log("info", "session.turn.ended", { session: options.id, outcome: how });
  };
  const close = async () => {
    if (closed) return;
    resolveQuestion();
    finish("stopped");
    closed = true;
    clearInterval(polling);
    await started?.catch(() => {
    });
    if (running) {
      await tmux(["send-keys", "-t", name, "Escape", "C-u", "C-d"]).catch(() => {
      });
      for (let attempt = 0; attempt < 20 && await alive(); attempt++) await delay(100);
      await tmux(["kill-session", "-t", name]).catch(() => {
      });
    }
    running = false;
    if (imagesDirectory) await rm(imagesDirectory, { recursive: true, force: true });
    left();
    log("info", "session.closed", { session: options.id });
  };
  const poll = async () => {
    if (closed || !running || submitting) return;
    if (!await alive()) {
      finish("failed", "MCode exited.");
      await close();
      return;
    }
    const saved = await refresh();
    const shown = await screen();
    if (shown.kind === "question") {
      activity = true;
      idle = 0;
      showQuestion(shown);
      return;
    }
    resolveQuestion();
    if (shown.kind === "working") activity = true;
    if (turn && (activity || stopping) && shown.kind === "idle") {
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
    const removed = Object.keys(process.env).filter((key) => key.startsWith("GECKIT_"));
    const launch = ["exec", "env", ...removed.flatMap((key) => ["-u", key]), `PATH=${env.PATH}`, ...["MINIMAX_DATA_DIR", "MAVIS_DATA_DIR", "MINIMAX_PROFILE", "MAVIS_PROFILE"].filter((key) => env[key]).map((key) => `${key}=${env[key]}`), ...args].map(quote).join(" ");
    if (closed) return;
    await tmux(["new-session", "-d", "-s", name, "-x", "140", "-y", "50", "-c", options.root, launch, ";", "set-option", "-p", "-t", name, "remain-on-exit", "on"]);
    running = true;
    log("info", "session.started", { session: options.id });
    emit([], [], [{ kind: "started", session: namespaced(options.id), key: false, ...options.model ? { model: options.model } : {} }]);
    polling = setInterval(() => {
      if (checking || closed) return;
      checking = true;
      serial = serial.then(poll).catch((error) => {
        if (!closed) log("warn", "session.poll.failed", { error: error.name });
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
      if (shown.kind === "idle") {
        resolveQuestion();
        return;
      }
      if (shown.kind === "question") {
        showQuestion(shown);
        attempt = 0;
      }
      await delay(100);
    }
    throw new Error(`MCode is waiting in its terminal. Attach with: tmux attach -t ${name}`);
  };
  const paste = async (text, guard, submit = true) => {
    if (!text) {
      await guard();
      if (submit) await tmux(["send-keys", "-t", name, "Enter"]);
      return;
    }
    const buffer = `geckit-minimax-${randomUUID2()}`;
    try {
      await guard();
      await tmux(["load-buffer", "-b", buffer, "-"], text);
      await guard();
      await tmux(["paste-buffer", "-p", "-r", "-d", "-b", buffer, "-t", name]);
      await delay(100);
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
      await delay(350);
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
      const path = join3(imagesDirectory, `${randomUUID2()}.${imageExtensions[image.media]}`);
      await writeFile(path, Buffer.from(image.data, "base64"), { mode: 384, flag: "wx" });
      await paste(path, guard, false);
      let attached = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        await guard();
        if (numbers(await capture()).some((number) => !previous2.has(number))) {
          attached = true;
          break;
        }
        await delay(100);
      }
      if (!attached) throw new Error("MCode did not accept the image attachment.");
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
          await delay(350);
          await ready();
          await paste(`/plan ${options.mode === "plan" ? "on" : "off"}`, async () => {
            if (closed || stopping) throw new Error("MCode stopped.");
          });
          await delay(350);
          await ready();
        }
        while (wanted && !closed) {
          await ready();
          await applyPermission(true);
        }
        baseline = new Set((await refresh()).map((message) => message.msg_id));
        const guard = async () => {
          if (closed || stopping) throw new Error("MCode delivery stopped.");
        };
        await attach(images, guard);
        await paste(prompt, guard);
        log("info", "message.sent", { session: options.id, delivery: "send" });
      })().catch(async (error) => {
        finish(stopping ? "stopped" : "failed", error.message);
        await close();
      }).finally(() => {
        submitting = false;
      });
    },
    async inject(text, images = [], before = []) {
      if (closed || !turn || stopping || submitting || pending) throw new Error("MCode cannot accept guidance now; the message remains queued.");
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
        resolveQuestion();
        void tmux(["send-keys", "-t", name, "Escape"]).catch(() => {
        });
      }
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
import { randomUUID as randomUUID3 } from "node:crypto";
import { tmpdir as tmpdir2 } from "node:os";
import { setTimeout as delay2 } from "node:timers/promises";
var MINUTE = 6e4;
var quote2 = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
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
  for (const match of plain.matchAll(/^\s*[│┃]?\s*(5-hour|Weekly)\b[^\n]*?(\d{1,3})\s*%\s*left\b[^\n]*?resets in\s+([0-9dhms]+(?:\s*[0-9dhms]+)*)/gim)) {
    const duration = quotaDuration(match[3]);
    if (duration === void 0) continue;
    const spent = Math.max(0, Math.min(100, 100 - Number(match[2]))) / 100;
    const window = { part: spent, resetsAt: now + duration };
    if (match[1].toLowerCase() === "5-hour") windows.fiveHour = window;
    else windows.sevenDay = window;
  }
  if (!windows.fiveHour && !windows.sevenDay) return void 0;
  const account = /^\s*[│┃]?\s*Account:\s*(.+?)\s*$/im.exec(plain)?.[1];
  const label = account === void 0 ? void 0 : /\(([^()]+)\)\s*$/.exec(account)?.[1]?.trim();
  return { windows, ...label ? { label } : {} };
}
function quotaReader({ name = `geckit-mcode-quota-${randomUUID3()}`, tmuxProgram = findTmux, command = mcodeCommand, environment = mcodeEnvironment, log = () => {
}, every = 10 * MINUTE } = {}) {
  const tmux = async (args) => {
    const { file, server } = await tmuxProgram();
    return new Promise((resolve, reject) => {
      execFile4(file, [...server, ...args], { env: environment(), timeout: 2e4, maxBuffer: 4 * 1024 * 1024 }, (error, out) => error ? reject(new Error(`tmux ${args[0]} failed.`)) : resolve(out));
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
    ].map(quote2).join(" ");
    await tmux(["new-session", "-d", "-s", name, "-x", "140", "-y", "50", "-c", tmpdir2(), command2]);
    owned = true;
  };
  const ready = async () => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (disposed) throw new Error("MCode provider disposed.");
      if (!await alive()) throw new Error("MCode exited before the status panel.");
      if (terminalScreen(await capture()).kind === "idle") return;
      await delay2(100);
    }
    throw new Error("MCode did not become ready for /status.");
  };
  const read = async () => {
    if (disposed) return void 0;
    if (await exists() && !await alive()) await tmux(["kill-session", "-t", name]).catch(() => {
    });
    if (!await exists()) await launch();
    await ready();
    await tmux(["send-keys", "-t", name, "-l", "/status"]);
    await delay2(500);
    await tmux(["send-keys", "-t", name, "Enter"]);
    let found;
    try {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (disposed) return void 0;
        await delay2(200);
        found = parseQuota(await capture());
        if (found !== void 0) break;
      }
    } finally {
      await tmux(["send-keys", "-t", name, "Escape"]).catch(() => {
      });
    }
    lastRead = Date.now();
    if (found !== void 0) cached = { ...found, measuredAt: lastRead };
    log("info", "quota.read", { outcome: found === void 0 ? "unreadable" : "completed", windows: found === void 0 ? 0 : Object.keys(found.windows).length });
    return found;
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

// src/mcode-provider.mjs
var local = (root) => typeof root === "string" && !root.startsWith("ssh://");
var inRoot = (path, root) => path === root || path?.startsWith(root.replace(/\/$/, "") + "/");
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
    return { items: saved.flatMap(messageItems), tasks: [], ...contextSpend(saved) };
  };
  const reportPlan = async () => {
    const found = await quota.refresh();
    if (!found?.windows) return;
    const said = JSON.stringify(reported);
    reported = found.windows;
    if (said === JSON.stringify(found.windows)) return;
    for (const driver of drivers) driver.report({ items: [], gone: [], signals: [{ kind: "plan", plan: found.windows }] });
  };
  return {
    id: ID,
    family: ID,
    name: "MiniMax Code (tmux)",
    shortName: "MCode",
    icon: "terminal",
    browser: "none",
    loginCommand: "mcode login",
    resumeCommand: "mcode --session {id}",
    planName: "MiniMax",
    localOnly: true,
    available: true,
    subscriptionOnly: false,
    images: true,
    remoteControl: false,
    nativeGoals: false,
    idleMs: 36e5,
    waitForExit: true,
    instructions: "own",
    setInstructions: async () => {
    },
    program: dependencies.program ?? program,
    account: async () => {
      const installed = await (dependencies.program ?? program)();
      if (!installed) return { provider: ID, here: false, signedIn: void 0 };
      const account = await rpc.account();
      const from = installFrom(installed.path);
      const program2 = { ...installed, ...from === void 0 ? {} : { from } };
      if (account.state !== "authenticated") return { provider: ID, here: true, signedIn: false, program: program2 };
      const plan = await quota.windows();
      const label = quota.label();
      return {
        provider: ID,
        here: true,
        signedIn: true,
        program: program2,
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
        ...Number(model.context_limit) > 0 ? { contextWindow: Number(model.context_limit) } : {},
        ...Number(model.max_output_tokens) > 0 ? { maxOutputTokens: Number(model.max_output_tokens) } : {},
        reasoning: (model.effort_options ?? []).filter((value) => ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value)).map((value) => ({ value, says: value }))
      }));
      return known;
    },
    limits: async (models) => {
      const windows = new Map(models.map((model) => [model, known.find((item) => item.value === model || item.id === model)?.contextWindow]));
      const plan = await quota.windows();
      return { windows, ...plan === void 0 ? {} : { plan } };
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
    fork: async (root, id, at) => {
      await info(root, id);
      const saved = await messages(rpc, nativeId(id));
      const point = saved.findLast((message) => message.role === "assistant" && Number(message.timestamp) <= at && message.actions?.fork === true);
      if (!point) throw new Error("MCode has no completed assistant response to fork at this point.");
      const result = await rpc.request(`${API}/session/${nativeId(id)}/fork`, "POST", { assistant_message_id: point.msg_id, client_request_id: randomUUID4(), use_suggested_title: false, create_isolated_worktree: false });
      if (!result.session?.session_id) throw new Error("MCode did not return the forked session.");
      const forkId = namespaced(result.session.session_id);
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
    goal: async () => void 0,
    setGoal: async () => void 0,
    clearGoal: async () => {
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
        const status = !enabled ? "disabled" : ["expired", "pending_auth"].includes(state?.authStatus) ? "needs-auth" : state === void 0 || state.configured === false ? "pending" : "connected";
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
        if (event.signals?.some((signal) => signal.kind === "ended")) void reportPlan();
        hear(event);
      };
      driver = holdMcode({ rpc, options: { ...options, id: nativeId(options.id) }, hear: report, left: () => {
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
}
export {
  create
};
