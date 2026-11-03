import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

// Scoped to launches owned by this provider. Never rewrite the user's global
// MCode instructions, and never leak another conversation's GECKIT_* identity.
export function instructionGuide({ read = readFile, home = homedir(), source = process.env.GECKIT_SOURCE_CLI,
  sourceGuide = process.env.GECKIT_SOURCE_CODEX_GUIDE || process.env.GECKIT_SOURCE_GUIDE } = {}) {
  let enabled = false;
  return {
    set(value) { enabled = value === true; },
    async prompt() {
      if (!enabled) return '';
      const command = source || join(home, '.geckit', 'bin', 'geckit');
      const paths = sourceGuide ? [sourceGuide] : source ? [] : [join(home, '.codex', 'GECKIT.md'), join(home, '.claude', 'GECKIT.md')];
      let guide;
      for (const path of paths) {
        try { guide = await read(path, 'utf8'); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      guide ??= `This conversation runs in GeckIt, a desktop app. The first line of your answer appears on its conversation card: state what is done or what remains. Write complete URLs for produced links. Report background commands and what they await. Do not set or clear goals on your own. Use the GeckIt CLI below to read sessions and assigned employee context (employees current, then employees memory with every returned cursor). Use its instructions providers or instructions app command before changing a provider or GeckIt. Independent work in another project belongs in a separate conversation requested with geckit start; read geckit help for the exact format. Do not duplicate the work of this conversation.`;
      return `${guide}\nUse this GeckIt CLI for all GeckIt commands: ${JSON.stringify(command)}.\n`;
    },
  };
}
