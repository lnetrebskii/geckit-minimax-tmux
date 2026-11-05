# MiniMax Code tmux provider for GeckIt

Runs your locally installed **`mcode` in an interactive tmux terminal**, using your existing MiniMax Code login, models, tools and native history. No MiniMax API key, Claude Code installation or separate authentication profile is required.

## Install

1. Install [MiniMax Code](https://github.com/MiniMax-AI/minimax-code) and confirm that `mcode --version` works in your terminal. If you are not signed in, the conversation can start browser sign-in for you. You can also run `mcode login --region global` (or `--region cn` for a China account) yourself.
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

The plugin reads MCode's account `/usage` panel in a private `geckit-mcode-quota-*` tmux session. This panel includes both the five-hour/weekly subscription windows and the remaining credit balance; `/status` omits credits. It uses your existing MCode login, with no API key, credential extraction or model call.

Subscription quota and credits are independent: credits may remain after a trial ends or when there is no active Token Plan subscription. The plugin returns subscription windows as spent fractions and credits as `{ id: 'credits', name: 'Credits', remaining: <balance>, unit: 'credits' }` in account usage, limits and refreshed usage events. A reported zero is preserved; an absent or unreadable balance stays unknown. Credit amounts have the precision shown by MCode and are not converted to tokens or percentages.

Correct credit display requires GeckIt support for the optional `ProviderQuota.remaining` field. The changes in [GeckIt PR #51](https://github.com/anetrebskii/geckit/pull/51) add `1,250 credits left` style values and provider explanations when no numeric quota is available. Older GeckIt versions show an unknown value for the credit row; updating the library alone cannot add support to their renderer. The patch also supports the optional `ProviderUsage.unavailableReason` field for `No active Token Plan subscription` and temporary lookup failures.

The reading is cached and refreshed after a turn. Explicit account reports replace previous windows and credit amounts, so a completed trial does not keep an obsolete quota. The quota session is closed with the provider. The `Token Plan` model source alone does not mean a subscription is active.

For the full behavioral audit, including missing integrations and the verification boundary, see [INTEGRATION-AUDIT.md](INTEGRATION-AUDIT.md) and the [complete contract inventory](CONTRACT-COVERAGE.md). Passing loader validation alone does not mean every UI feature is supported.

## What GeckIt may ask this provider for

| Interface | Answer |
| --- | --- |
| `account` | Whether MCode is installed and signed in, its version, how it was installed, and the name of the plan |
| `program` | The MCode that answers, with the version and where it came from |
| `models` | The models MCode lists, with their context windows and effort levels |
| `limits` | The context window of each model, subscription quota windows, and remaining credits |
| `list`, `search`, `hidden` | MCode's own sessions, found by text and by date |
| `create`, `fork`, `has`, `read`, `links`, `rename`, `delete` | MCode's own sessions, created, forked at a finished answer, read and removed |
| `resumeCommand` | Copy/open the native terminal continuation command: `mcode --session {id}` |
| `hold` | The conversation in tmux, with permission and questionnaire cards, guidance while it works, Manual/Auto changes, and Stop |
| `mcp` | The MCP servers MCode has, and switching them on and off |
| `goal`, `setGoal`, `clearGoal` | Native goals not advertised; unsupported mutations reject explicitly |
| `browsers`, `correct`, `remote` | Not offered by this adapter |
| `setInstructions` | Scoped GeckIt guide for subsequent TUI launches; source-app overrides and Manager prompt preserved |

## Limits and troubleshooting

- Local projects only; Windows and SSH projects are unsupported.
- Background tasks/output/stop, local saved images, native write/edit paths, observed mode/model/effort and scoped instructions are mapped. Native goals still need a host lifecycle change; see the audit for remaining boundaries.
- Native goal management, correction, and browser configuration from Geckit's settings are not advertised. MCP servers that MCode already has are listed and can be switched on and off. Tools and MCP already configured in MCode still work inside the native agent.
- Publish the rebuilt bundle in a new commit on the source repository’s default branch. In GeckIt, check for library updates and apply the update; no app restart is required. Running conversations switch providers when safe. Copying local files alone does not make an update available: GeckIt compares Git commits.
- Model pricing is unknown and omitted.
- Account quotas and credits are read from MCode's `/usage` panel, so the first reading waits for MCode to start. A changed CLI layout may require an adapter update.
- Changing Manual/Auto while a conversation is running is applied to MCode through its own `/permission` command as soon as its terminal is free; a turn in flight is never interrupted and nothing is queued into it.
- Unknown terminal dialogs remain open for manual handling. Attach with `tmux attach -t <geckit-minimax-session-name>`; list sessions with `tmux list-sessions`. Known permission and questionnaire layouts are surfaced as GeckIt question cards with separate multiline details and answer buttons. Truncated approval details offer a “Review all details” action. A changed CLI layout may require an adapter update.
- If login is missing before delivery, the conversation offers **Sign in (Global)**, **Sign in (China)** and **Cancel**. Sign-in runs the native `mcode login --region …` command in a separate private tmux session, opens browser authorization and shows a copyable authorization URL. The pending message continues after the CLI exits successfully and reports an authenticated account. Cancel or Stop closes the login terminal; a failed or timed-out login leaves the message unsent with a manual sign-in instruction. No command is pasted into the coding agent prompt. Do not provide an API key to this plugin.
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
