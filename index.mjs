// src/mcode-provider.mjs
import { randomUUID as randomUUID3 } from "node:crypto";

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
  if (approval && /Always allow matching actions\?/.test(body)) return question(body.trim(), [{ label: "Always allow matching actions", keys: ["Enter"] }, { label: "Back", keys: ["Escape"] }]);
  if (approval && /Deny this action\?/.test(body)) return question(body.trim(), [{ label: "Deny", keys: ["Enter"] }, { label: "Back", keys: ["Escape"] }], true);
  if (approval) {
    const choices = lines.map((line) => /^\s*[│┃]?\s*(?:›\s*)?([123])\s+((?:Allow for this conversation|Always allow matching actions|Deny and guide MCode).*)/.exec(line)).filter(Boolean);
    if (choices.length) return question(body.trim(), choices.map((one) => ({ label: one[2].replace(/\s*[│┃]\s*$/, "").trim(), keys: [one[1]] })));
  }
  const askAt = lines.findLastIndex((line) => /[╭┌].*\bAsk\b/.test(line));
  if (askAt !== -1 && (prompt === -1 || askAt > prompt)) {
    const frame = lines.slice(askAt).join("\n");
    if (/Type your answer · Enter (?:send|next)/.test(frame)) return question(frame.trim(), [], true);
    if (/↑↓ move|Space toggle/.test(frame)) {
      const multiple = /Space toggle/.test(frame);
      const options = lines.slice(askAt).flatMap((line) => {
        const match = /^\s*[│┃]?\s*(?:[›→]\s*)?(?:([●○])\s*)?([1-9])\s{1,}(.+?)\s*[│┃]?\s*$/.exec(line);
        return match ? [{ label: `${match[1] ? `${match[1]} ` : ""}${match[3].trim()}`, keys: [match[2]] }] : [];
      });
      if (multiple) options.push({ label: "Submit selected", keys: ["Enter"] });
      if (/Other…/.test(frame) && !options.some((option) => option.label.includes("Other\u2026"))) options.push({ label: "Other\u2026", keys: ["o"] });
      if (/more below/.test(frame)) options.push({ label: "More options", keys: ["Down"] });
      if (/more above/.test(frame)) options.push({ label: "Previous options", keys: ["Up"] });
      if (options.length) return question(frame.trim(), options);
    }
  }
  const status = prompt === -1 ? body : lines.slice(Math.max(0, prompt - 4), prompt).join("\n");
  const working = /Esc (?:interrupt|to interrupt|stop)|esc (?:interrupt|to interrupt|stop)|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s/.test(status);
  return { kind: working ? "working" : prompt !== -1 && /(?:Message · Enter send|Start · @ file|Context .*|Effort .*|Permissions)/.test(body) && !/Starting server|Checking account/.test(body) ? "idle" : "unknown", text: body };
}
function question(title, options, input = false) {
  return { kind: "question", title, options, input, signature: JSON.stringify({ title, options }) };
}
function holdMcode({ rpc, options, hear, left, log = () => {
}, tmuxProgram = findTmux, command = mcodeCommand, environment = mcodeEnvironment }) {
  if (process.platform === "win32" || options.root.startsWith("ssh://")) throw new Error("MCode tmux requires a local macOS or Linux project.");
  const name = `geckit-minimax-${randomUUID2().slice(0, 12)}`;
  let closed = false, running = false, turn = false, stopping = false, submitting = false, polling, started;
  let checking = false;
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
    emit([], [], [{ kind: "asks", ask: pending.id, wanted: { kind: "question", question: value.title, choices: value.options.map((option) => option.label) } }]);
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
  const paste = async (text, guard) => {
    const buffer = `geckit-minimax-${randomUUID2()}`;
    try {
      await guard();
      await tmux(["load-buffer", "-b", buffer, "-"], text);
      await guard();
      await tmux(["paste-buffer", "-p", "-r", "-d", "-b", buffer, "-t", name]);
      await delay(100);
      await guard();
      await tmux(["send-keys", "-t", name, "Enter"]);
    } finally {
      await tmux(["delete-buffer", "-b", buffer]).catch(() => {
      });
    }
  };
  const input = (text, images, before) => {
    if (images?.length) throw new Error("MCode tmux image attachments are not supported yet.");
    const prompt = [...before ?? [], text].join("\n\n");
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(prompt)) throw new Error("Terminal control characters are not allowed in prompts.");
    return prompt;
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
        baseline = new Set((await refresh()).map((message) => message.msg_id));
        await paste(prompt, async () => {
          if (closed || stopping) throw new Error("MCode delivery stopped.");
        });
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

// src/mcode-provider.mjs
var local = (root) => typeof root === "string" && !root.startsWith("ssh://");
var inRoot = (path, root) => path === root || path?.startsWith(root.replace(/\/$/, "") + "/");
var modelSelection = (value) => {
  const at = value.indexOf("/");
  if (at <= 0 || at === value.length - 1) throw new Error("Select a provider/model from MCode\u2019s model list.");
  return { provider_id: value.slice(0, at), model_id: value.slice(at + 1) };
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
  let disposed = false, known = [];
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
  return {
    id: ID,
    family: ID,
    transport: "tmux",
    name: "MiniMax Code (tmux)",
    shortName: "MCode",
    icon: "terminal",
    browser: "none",
    loginCommand: "mcode login",
    planName: "MiniMax",
    localOnly: true,
    available: true,
    subscriptionOnly: false,
    images: false,
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
      return { provider: ID, here: true, signedIn: account.state === "authenticated", program: installed };
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
      const result = await rpc.request(`${API}/session/${nativeId(id)}/fork`, "POST", { assistant_message_id: point.msg_id, client_request_id: randomUUID3(), use_suggested_title: false, create_isolated_worktree: false });
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
    links: async (root, id) => [...new Set(((await read(root, id))?.items ?? []).flatMap((item) => [...(item.text ?? "").matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)].map((match) => match[0].replace(/[.,;:!?]+$/, ""))))].map((url) => ({ url })),
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
    mcp: async () => void 0,
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
      driver = holdMcode({ rpc, options: { ...options, id: nativeId(options.id) }, hear, left: () => {
        drivers.delete(driver);
        left();
      }, log, ...dependencies.terminal });
      drivers.add(driver);
      return driver;
    },
    dispose: () => {
      disposed = true;
      void Promise.allSettled([...drivers].map((driver) => driver.end())).then(() => rpc.dispose());
    }
  };
}
export {
  create
};
