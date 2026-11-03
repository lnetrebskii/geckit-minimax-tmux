# MiniMax Code tmux provider for GeckIt

Runs your locally installed **`mcode` in an interactive tmux terminal**, using your existing MiniMax Code login, models, tools and native history. No MiniMax API key, Claude Code installation or separate authentication profile is required.

## Install

1. Install [MiniMax Code](https://github.com/MiniMax-AI/minimax-code) and complete `mcode login` if you have not already signed in. Confirm that `mcode` works in your terminal.
2. Install tmux: `brew install tmux` on macOS, or your Linux distribution's package manager.
3. In GeckIt, open **Settings → Libraries → Add library** and enter:
   `https://github.com/lnetrebskii/geckit-minimax-tmux`
4. Enable **MiniMax Code (tmux)** under **Settings → Assistants** and select it in a local project.

Verified with **mcode 0.7.4** on macOS. Requires macOS or Linux, a tmux executable, and MCode's app-server protocol v1 / transport v2. GeckIt installs the committed `index.mjs`; no npm install is performed on installation.

The plugin finds `mcode` on PATH and in `~/.minimax-code/bin` or `~/.local/bin`. For another installation, set `GECKIT_MCODE_COMMAND` to its executable's absolute path in GeckIt's environment. Native `MINIMAX_DATA_DIR` / `MAVIS_DATA_DIR` and profile environment settings are preserved. The process uses your existing MCode configuration and OAuth session.

## How it works

Each conversation opens `mcode --session <native-id> --tui-mode regular` in a uniquely named `geckit-minimax-*` tmux session. Prompts are pasted using private tmux buffers with bracketed paste; Unicode, multiline input and literal shell characters are preserved. The system clipboard is not used. Follow-up messages reuse the same terminal. **Send now** delivers guidance through MCode's active input and rejects delivery while a question is pending.

A plugin-owned `mcode app-server --stdio` process provides native session creation, model/account information, and saved history through the local DesktopService protocol. It does not send model prompts. Replies and tool records come from native saved messages, not reconstructed terminal text. The plugin does not extract or copy OAuth tokens and does not modify the CLI's instructions.

Supported operations include history, search, rename, fork at a completed assistant response, delete, resume, permission cards, native questionnaires, and Stop. Forking uses MCode's native fork operation; it does not create a Git worktree. Session IDs are isolated under `plugin:minimax-tmux:`. Native history is shared with MCode: deleting a conversation in GeckIt also deletes that native MCode conversation.

A turn finishes only after observed activity, two idle terminal polls and MCode reporting no active session work. Stop sends Escape and waits for native work to settle. Closing a driver releases its tmux session; disposing the provider closes its drivers and its own control process. It does not kill other tmux sessions or MCode processes.

GeckIt's Manual/Auto/Plan selection is applied using MCode's native `/permission` and `/plan` commands. These have the same settings effects as running those commands in MCode yourself. Model choices and context capacities are read from the installed CLI. Unknown subscription quotas and prices are omitted; reported zero model cost is not presented as a verified bill.

## Limits and troubleshooting

- Local projects only; Windows and SSH projects are unsupported.
- Image attachments, native goal management, correction, and browser/MCP configuration from GeckIt's settings are not advertised. Tools and MCP already configured in MCode still work inside the native agent.
- Unknown terminal dialogs remain open for manual handling. Attach with `tmux attach -t <geckit-minimax-session-name>`; list sessions with `tmux list-sessions`. Known permission and questionnaire layouts are surfaced as GeckIt question cards. A changed CLI layout may require an adapter update.
- If login expires, run `mcode login` in your terminal and retry. Do not provide an API key to this plugin.
- The tmux download mechanism supports verified release assets, but this repository initially ships an empty binary catalog. Install tmux locally unless a later release adds your platform's binary.
- GeckIt diagnostic events contain session IDs and outcomes, not prompts, responses or credentials.

## Development

Use Node 22+ and tmux:

```sh
npm ci
npm run build
npm test
```

Tests run a fake native MCode CLI and app-server inside isolated real tmux sessions, without a model account or API call. They cover namespace validation, history pagination, context, models, terminal states, exact multiline delivery, permissions, guidance, Stop, resume, process exit and disposal, plus tmux discovery and checksum handling. Commit the rebuilt `index.mjs` with source changes.

See [UPSTREAM.md](UPSTREAM.md) for provenance and [LICENSE](LICENSE) for terms.
