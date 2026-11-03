# GeckIt integration audit — 2026-11-03

The adapter implements all required apiVersion 1 factory methods, but that does
**not** mean every GeckIt feature works with MiniMax. This audit checks the
installed GeckIt host and renderer, the adapter sources, and MCode 0.7.4.
It is not a claim of exhaustive desktop or phone UI testing. The subsequent complete type/member inventory and additional regression findings are in [CONTRACT-COVERAGE.md](CONTRACT-COVERAGE.md).

## Confirmed defects fixed in this update

1. **Copy terminal command / open in terminal:** the host's `resumeCommand(id)`
   returns nothing unless the plugin metadata supplies a template. Added
   `mcode --session {id}` to both the manifest and factory. The host removes the
   plugin namespace and quotes the native ID. Tested with a copy of the installed
   renderer formatter and verified against `mcode --help`. The button copies a
   terminal resume command, not the transcript. Clipboard/UI interaction itself
   has not been exercised by an automated desktop test.
2. **Links:** board links included thought/note text, lost Markdown labels and
   were oldest first. They now follow the conversation panel's rules: user and
   assistant text only, newest first, deduplicated URLs and retained labels.
3. **MCP authentication:** MCode reports `pending_auth` for an OAuth server still
   awaiting authorization. This now maps to `needs-auth`, rather than
   `connected`. Disabled servers remain disabled. Runtime configuration is not
   a live connectivity probe; the remaining connected status is inferred from
   configuration, as before.

## Contract and feature coverage

| Surface | Actual implementation and limits |
| --- | --- |
| Identity, installation, updates | Namespaced IDs, apiVersion 1, bundled entry and manifest validated against the installed loader fixture. Normal updates require a published Git commit and support applying without restarting GeckIt. |
| `account`, `program` | Native installed version and authentication. Plan label from `/status`. Account quotas are returned through `limits`, not `account.usage`. |
| `models` | Native model IDs, names, context/output capacities, default/disabled flags and recognized effort levels. No invented pricing. No actual model/effort change events from the terminal. |
| `limits` | Per-model context windows plus legacy `plan` quota windows, accepted by this host. Initial read waits for a separate TUI/account load; later reads are cached. Temporary native account failures can leave quotas unavailable. |
| `list`, `search`, `hidden` | Native paginated history with root/date filtering. Search scans saved message text; it does not index tool arguments or images. |
| `create`, `has`, `read` | Native sessions and project ownership checks. Reads map text, thinking, tools and context. `tasks` is always empty; saved image fields are not mapped. |
| `fork` | Forks at the last eligible native assistant response at/before the supplied timestamp. No worktree creation. Covered by RPC contract fixtures; not exercised against a real model session. |
| `rename` | Native PATCH is implemented. In the inspected host, UI rename calls it only for providers with `nativeGoals=true`; MiniMax uses `false`, so a UI title can remain local to GeckIt. Do not change the goals flag just to bypass that condition. |
| `delete` | Native DELETE after project ownership validation; native history is removed too. Ownership and DELETE behavior covered by RPC fixtures; not tested against a real user's session. |
| `links` | Corrected above. Conversation panel uses its own host extractor; board uses provider `links`. |
| `hold`, `send` | Native TUI in an isolated tmux session. Exact multiline input and image attachment delivery tested with fake MCode. |
| `inject` | Guidance to an active turn; rejects idle, disconnected, submitting and permission-waiting states. Fake CLI integration coverage. |
| `answer` | Known native permission and questionnaire layouts map to question cards. Unknown dialogs require the terminal; no automatic acceptance. |
| `permit` | Manual/Auto applies when the terminal is idle and before a subsequent send. An in-flight turn continues under its previous mode. The host excludes question cards from `again`, so changing to Auto does not automatically answer these permission cards. |
| `stop`, `end`, `dispose` | Stop/exit/resume tested. Driver end awaits cleanup, including concurrent/repeated calls. Provider disposal starts asynchronous cleanup but returns immediately; consumers cannot await full cleanup through its return value. |
| Optional `control`, `leave` | Not implemented. Generic native control requests and detach semantics are unavailable; normal local shutdown uses `end`. |
| `mcp` | Native listing and enable/disable. Authorization mapping fixed above. No GeckIt-side server installation or authorization workflow. |
| `browsers`, `remote`, `correct` | Unsupported results/errors. Remote control and remote projects are not advertised. |
| `setInstructions` | **No-op**, despite `instructions: own`. The adapter does not install/remove GeckIt's guide or pass a source-app override into MCode. Explicit project AGENTS.md instructions may still work through MCode itself. |
| `goal`, `setGoal`, `clearGoal` | **Stubs**; `nativeGoals=false`. MCode's native goal state is not synchronized. Host bookkeeping/display is not evidence of native goal completion detection. Optional pause/resume are absent. |

## Signals and persisted content

Implemented: `started`, `begun`, `asks`, `resolved`, `spend` (context only),
legacy `plan`, and `ended` (`done`, `stopped`, `failed`). Transcript changes
and removed item IDs are streamed; usage costs are not fabricated.

Missing or partial:

- `task` and restored background tasks. MCode exposes background-task routes,
  but the adapter does not consume them. GeckIt's task list and its guards
  around handing a conversation to a terminal therefore lack that information.
- `writing` and `wrote` paths, so file-change affordances cannot rely on native
  changes reported by this adapter.
- `doing`, `said`, `retry`, `held`: no native progress/retry/hook events.
- Actual `mode`, `model`, `reasoning` changes, and slash-command discovery via
  `started.commands`. Changes made inside MCode can leave GeckIt metadata stale.
- Specific `limit`, `signedOut`, `blocked` end reasons and reset times. Current
  end detection cannot reliably distinguish these from failure or an unknown
  terminal dialog.
- Structured tool results/images and restored user attachments. Tool records
  are currently JSON details; native content is not a full GeckIt rendering.
- `usage` and cost events are absent; accepted legacy plan signals are used
  for quotas. Unknown pricing/cost is intentionally omitted.

## Verification boundary

The suite covers loader/identity, host resume-command formatting, link mapping,
quota parsing and fake native status panel, model/account/quota results, MCP
authorization and toggles, history pagination, transcript/context mapping,
terminal dialogs, multiline/image delivery, permissions and rapid mode changes,
guidance, stop/resume/crash/disposal, and tmux installation/checksums.

This audit also traced the installed UI's Copy button, Links and Status flows.
Status marking is host-owned. Native quotas were checked against real MCode in
the preceding fix and the user confirmed they appeared after updating.
No claim is made that the unimplemented surfaces above passed UI tests.

Next integration priorities: background tasks and handover guards; instruction
setup; native goal synchronization; richer state/tool/image mapping. Each needs
native contract fixtures and behavioral tests rather than additional stubs.
