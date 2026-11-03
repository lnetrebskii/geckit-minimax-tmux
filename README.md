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

Each conversation opens `mcode --session <native-id> --tui-mode regular` in a uniquely named `geckit-minimax-*` tmux session. Prompts are pasted using private tmux buffers with bracketed paste; Unicode, multiline input and literal shell characters are preserved. PNG, JPEG, GIF and WebP attachments are written to private temporary files and pasted as standalone paths using MCode’s native file attachment handler. The plugin waits for each image placeholder before submitting the message and removes its temporary files when the driver closes. The system clipboard is not used. Follow-up messages reuse the same terminal. **Send now** delivers guidance through MCode's active input and rejects delivery while a question is pending.

A plugin-owned `mcode app-server --stdio` process provides native session creation, model/account information, and saved history through the local DesktopService protocol. It does not send model prompts. Replies and tool records come from native saved messages, not reconstructed terminal text. The plugin does not extract or copy OAuth tokens and does not modify the CLI's instructions.

Supported operations include history, search, rename, fork at a completed assistant response, delete, resume, permission cards, native questionnaires, and Stop. Forking uses MCode's native fork operation; it does not create a Git worktree. Session IDs are isolated under `plugin:minimax-tmux:`. Native history is shared with MCode: deleting a conversation in GeckIt also deletes that native MCode conversation.

A turn finishes only after observed activity, two idle terminal polls and MCode reporting no active session work. Stop sends Escape and waits for native work to settle. Closing a driver releases its tmux session; disposing the provider closes its drivers and its own control process. It does not kill other tmux sessions or MCode processes.

GeckIt's Manual/Auto/Plan selection is applied using MCode's native `/permission` and `/plan` commands. These have the same settings effects as running those commands in MCode yourself. Model choices and context capacities are read from the installed CLI. Reported zero model cost is not presented as a verified bill.

## The plan and its quota

MCode keeps the state of the Token Plan in its own status panel and nowhere else: its app-server offers no account, plan or quota endpoint. The plugin reads it the way a person reads it — a TUI of its own, `mcode --tui-mode regular` in a unique `geckit-mcode-quota-*` tmux session, asked for `/status` and read from the screen. The five-hour and weekly windows it reports are given to GeckIt as the plan's windows, so the Assistants panel shows what is spent and when each window starts again. The name of the plan (`Trial`, `Pro`) is reported with the account.

Nothing is invented: a window MCode does not report is left out, and no quota is shown for an account that has no plan. The reading is kept warm and refreshed after a turn, and the quota session is closed with the provider. It costs one short MCode process and no model calls.

For the full behavioral audit, including missing integrations and the verification boundary, see [INTEGRATION-AUDIT.md](INTEGRATION-AUDIT.md) and the [complete contract inventory](CONTRACT-COVERAGE.md). Passing loader validation alone does not mean every UI feature is supported.

## What GeckIt may ask this provider for

| Interface | Answer |
| --- | --- |
| `account` | Whether MCode is installed and signed in, its version, how it was installed, and the name of the plan |
| `program` | The MCode that answers, with the version and where it came from |
| `models` | The models MCode lists, with their context windows and effort levels |
| `limits` | The context window of each model, and the plan's quota windows |
| `list`, `search`, `hidden` | MCode's own sessions, found by text and by date |
| `create`, `fork`, `has`, `read`, `links`, `rename`, `delete` | MCode's own sessions, created, forked at a finished answer, read and removed |
| `resumeCommand` | Copy/open the native terminal continuation command: `mcode --session {id}` |
| `hold` | The conversation in tmux, with permission and questionnaire cards, guidance while it works, Manual/Auto changes, and Stop |
| `mcp` | The MCP servers MCode has, and switching them on and off |
| `goal`, `setGoal`, `clearGoal` | Not offered: MCode keeps its own goals, and GeckIt is told so |
| `browsers`, `correct`, `remote` | Not offered by this adapter |
| `setInstructions` | No-op: global MCode instructions are left unchanged |

## Limits and troubleshooting

- Local projects only; Windows and SSH projects are unsupported.
- Background tasks, file-change events, saved images and native goal synchronization are not mapped into GeckIt. The GeckIt instruction switch currently has no effect; `setInstructions` is a no-op.
- Native goal management, correction, and browser configuration from Geckit's settings are not advertised. MCP servers that MCode already has are listed and can be switched on and off. Tools and MCP already configured in MCode still work inside the native agent.
- Publish the rebuilt bundle in a new commit on the source repository’s default branch. In GeckIt, check for library updates and apply the update; no app restart is required. Running conversations switch providers when safe. Copying local files alone does not make an update available: GeckIt compares Git commits.
- Model pricing is unknown and omitted.
- The plan's quota is read from MCode's `/status` panel, so the first reading waits for MCode to start. A changed CLI layout may require an adapter update.
- Changing Manual/Auto while a conversation is running is applied to MCode through its own `/permission` command as soon as its terminal is free; a turn in flight is never interrupted and nothing is queued into it.
- Unknown terminal dialogs remain open for manual handling. Attach with `tmux attach -t <geckit-minimax-session-name>`; list sessions with `tmux list-sessions`. Known permission and questionnaire layouts are surfaced as GeckIt question cards with separate multiline details and answer buttons. Truncated approval details offer a “Review all details” action. A changed CLI layout may require an adapter update.
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

Tests run a fake native MCode CLI and app-server inside isolated real tmux sessions, without a model account or API call. They cover namespace validation, history pagination, context, models, terminal states, exact multiline delivery, image attachment delivery and cleanup, isolated permission details, permissions, guidance, Stop, resume, process exit and disposal, plus tmux discovery and checksum handling. Commit the rebuilt `index.mjs` with source changes.

See [UPSTREAM.md](UPSTREAM.md) for provenance and [LICENSE](LICENSE) for terms.
