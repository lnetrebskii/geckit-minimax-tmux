import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir as mkdirCache, readFile, rename, rm as rmPart, writeFile as writePart } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const KNOWN = () => ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin", join(homedir(), ".nix-profile", "bin"), "/run/current-system/sw/bin", "/nix/var/nix/profiles/default/bin", join(homedir(), ".local", "bin")];

const tmuxRuns = (file) => new Promise((resolve) => {
  execFile(file, ["-V"], { timeout: 5000, windowsHide: true }, (error) => resolve(error === null));
});

const cacheFolder = (env) => process.platform === "darwin" ? join(homedir(), "Library", "Caches", "geckit-minimax-tmux") : join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "geckit-minimax-tmux");

const binaryList = () => readFile(new URL("./tmux-binaries.json", import.meta.url), "utf8").then(JSON.parse, () => ({ files: {} }));

async function locateTmux({ env = process.env, folder = cacheFolder(env), binaries = binaryList, download = fetch, known = KNOWN() } = {}) {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("MiniMax Code (tmux) runs on macOS and Linux only.");
  const seen = new Set();
  for (const directory of [...(env.PATH ?? "").split(delimiter), ...known]) {
    if (directory === "" || seen.has(directory)) continue;
    seen.add(directory);
    const file = join(directory, "tmux");
    if (await tmuxRuns(file)) return { file, server: [] };
  }
  const install = `Install tmux (${process.platform === "darwin" ? "brew install tmux" : "for example sudo apt install tmux"}) and try again.`;
  const { version, files } = await binaries();
  const target = `${process.platform}-${process.arch}`;
  const entry = files?.[target];
  if (entry === void 0) throw new Error(`tmux is not installed. ${install}`);
  const file = join(folder, `tmux-${version}-${target}`);
  if (!await tmuxRuns(file)) {
    try {
      const response = await download(entry.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("checksum mismatch");
      await mkdirCache(folder, { recursive: true });
      const part = `${file}.${randomUUID()}.part`;
      await writePart(part, bytes, { mode: 0o755 });
      await rename(part, file).catch(async (error) => { await rmPart(part, { force: true }); throw error; });
    } catch (error) {
      throw new Error(`tmux is not installed and its copy could not be downloaded (${error.message}). ${install}`);
    }
    if (!await tmuxRuns(file)) throw new Error(`tmux is not installed and the downloaded copy does not run here. ${install}`);
  }
  return { file, server: ["-L", "geckit-minimax"] };
}

let located;
const findTmux = () => located ??= locateTmux().catch((error) => { located = void 0; throw error; });

export { findTmux, locateTmux };
