# Complete provider boundary inventory

Audit date: 2026-11-03. Scope: the MiniMax library ↔ GeckIt apiVersion 1 boundary, its native MCode transport, and host consumers. This is not an audit of unrelated GeckIt application APIs.

Pinned host source: [69ad36623228400acc4b2fa94a4368fb91033d3f](https://github.com/anetrebskii/geckit/tree/69ad36623228400acc4b2fa94a4368fb91033d3f). Provider/Driver declarations match the source used for the installed host inspection. The snapshot in `test/fixtures/geckit-contracts.json` retains complete comment-stripped declarations, source paths and SHA-256 hashes. The member column below is an index; inherited and nested field types remain in the declarations.

Follow-up in separate host checkout adds optional `autoStartingGoals`/`startGoal` and an optional driver argument to `resumeGoal`; the pinned snapshot remains a baseline compatibility fixture. The adapter now enables native goals only with the attached-driver lifecycle. See INTEGRATION-AUDIT.md for the new behavior and tests.

**Checked is not the same as implemented.** Unsupported surfaces are explicitly recorded. Automated tests cover behavior listed in the verification section, not every possible UI state.

## All exposed and directly related types

| Contract | Members / variants | Result |
| --- | --- | --- |
| `PluginContext` | `log` | Supported. Optional host logger is accessed defensively; no factory-time CLI start. |
| `PluginLogger` | `path`, `write` | write is used; path is unused. Logger exceptions are swallowed. Fields contain identifiers/outcomes, not prompt or credential content. |
| `PluginLogFields` | Alias / index signature; see pinned declaration | Scalar fields only in current call sites; no backend body logging. |
| `PluginLogLevel` | Alias / index signature; see pinned declaration | Current call sites use info and warn; other levels are not required. |
| `PluginLogValue` | Alias / index signature; see pinned declaration | Current values are strings/numbers; optional field types need no implementation. |
| `LlmProvider` | `available`, `localOnly`, `subscriptionOnly`, `images`, `remoteControl`, `nativeGoals`, `idleMs`, `waitForExit`, `account`, `program`, `models`, `limits`, `list`, `search`, `hidden`, `create`, `fork`, `has`, `read`, `links`, `goal`, `setGoal`, `clearGoal`, `pauseGoal`, `resumeGoal`, `hold`, `rename`, `remote`, `mcp`, `browsers`, `correct`, `setInstructions`, `delete`, `dispose` | Every required member checked against this pinned declaration. Behavioral coverage and unsupported methods are listed in INTEGRATION-AUDIT.md. |
| `ProviderRow` | Alias / index signature; see pinned declaration | id/root/title/at/created/model and parent project are mapped. stands is empty; driven is always true, including imported native sessions: semantic gap. Actual reasoning, work item, cost and used context are not listed. |
| `ProviderGoal` | Alias / index signature; see pinned declaration | Native GET/POST/PATCH status mapped; completed goals omit the active condition. |
| `ProviderFork` | Alias / index signature; see pinned declaration | Native fork point and copied history. Requested model is selected on the new native session; mode is applied at hold. |
| `ProviderLimits` | Alias / index signature; see pinned declaration | Context windows, legacy plan and generic quotas supplied. An initial limits call loads model capacities if needed. |
| `ProviderBrowser` | Alias / index signature; see pinned declaration | Unsupported; undefined result. |
| `Driver` | `send`, `inject`, `answer`, `permit`, `control`, `stop`, `end`, `leave` | send/answer/stop/end/inject/permit implemented; control supports stop_task with native errors preserved; leave performs local shutdown. Unknown controls reject. |
| `Heard` | `items`, `gone`, `signals` | items/gone/signals always supplied. Items are upserted by stable native IDs; disappearances produce gone IDs. |
| `Signal` | `started`, `doing`, `said`, `retry`, `writing`, `asks`, `resolved`, `mode`, `model`, `reasoning`, `spend`, `usage`, `plan`, `task`, `begun`, `held`, `goal`, `ended` | All 18 variants enumerated below. Unsupported native hook/retry/goal events remain explicit omissions. |
| `ClaudeOptions` | `managerPrompt`, `reasoning`, `root`, `id`, `resume`, `mode`, `model`, `fork`, `launch` | root/id/mode/model/reasoning mapped; resume intentionally uses native --session for both created and existing sessions. managerPrompt now forwarded through --append-system-prompt. launch and legacy fork explicitly rejected rather than silently ignored. |
| `Held` | `stdin`, `stdout`, `stderr`, `on`, `once`, `kill`, `leave` | Not provided: custom/remote launch transport is unsupported. Native process is owned internally. |
| `Conversation` | `items`, `cost`, `goal`, `tasks` | Restores text, tools, local user/tool images, write paths and background tasks with output-file references; context is included. Unknown cost and native goals omitted. |
| `Found` | `id`, `title`, `stands`, `at`, `driven`, `model`, `used`, `work`, `cwd` | Native listing supplies core fields; same omissions and driven semantics as ProviderRow. |
| `GoalRead` | `goal`, `ended`, `met` | Native goal/status read from MCode; bare setGoal rejects because starting a goal requires a held consumer. |
| `Usage` | `plan`, `windows` | windows Map plus optional legacy plan. Initial quotas may wait for account load; stale cached data can be returned while refresh runs. |
| `McpChange` | `name`, `enabled` | name is URL-encoded, enabled is passed to native PATCH. Native config is global, not per requested root. |
| `Wanted` | `elicitation`, `write`, `command`, `web`, `read`, `question`, `start`, `other` | Only question is emitted, including native approvals. Other 7 variants are absent. Native approval cards therefore bypass host permission classification/Auto re-evaluation and remain explicit questions. |
| `LlmProviderInfo` | `id`, `family`, `transport`, `name`, `shortName`, `icon`, `iconPath`, `browser`, `loginCommand`, `planName`, `resumeCommand`, `source`, `localOnly`, `replaces`, `runtime`, `instructions` | id/family/name/shortName/icon/browser/loginCommand/planName/resumeCommand/source/localOnly/instructions supplied by manifest. Optional iconPath absent; reserved transport/replaces and Codex runtime deliberately absent. |
| `LlmProviderId` | Alias / index signature; see pinned declaration | Independent plugin:minimax-tmux identity; namespace conversion validated in both directions. |
| `SessionMode` | Alias / index signature; see pinned declaration | manual→ask, auto→auto, plan→ask plus /plan on. Plan applies on a new driver. Additional internal bypassPermissions support is outside this public enum and not advertised. |
| `SessionProvider` | Alias / index signature; see pinned declaration | Only plugin:minimax-tmux; no builtin provider impersonation. |
| `ReasoningEffort` | Alias / index signature; see pinned declaration | Recognized native options/defaults mapped. Session-scoped selected model thinking.effort is emitted when the native API supplies a recognized value. |
| `CardKind` | Alias / index signature; see pinned declaration | question only. permission/start/elicitation absent. |
| `SessionCard` | `kind`, `title`, `detail`, `where`, `choices`, `elicitation`, `answered` | question/title/detail/choices supplied; host owns answered state. where/elicitation absent. Free-text questions and known menu choices use native terminal input. |
| `CardAnswer` | Alias / index signature; see pinned declaration | Not emitted as permission buttons by this adapter. Answers are choice labels or free text; once/session/no are not native approval mappings. |
| `SessionItem` | `mine`, `theirs`, `did`, `thought`, `shell`, `card`, `wrote`, `note`, `request`, `team-request`, `steps` | Text/thought/tool/note and question cards; verified saved user/tool images; native write/edit completion produces wrote. Host owns shell/request/team-request/steps grouping. Unknown assistant phases omitted. |
| `SessionSpend` | `used`, `window`, `cost`, `currency`, `costKind` | used/window only; optional dates and null context validated after this audit. Finite nonnegative used and positive finite window. Cost/currency/costKind unknown and omitted. |
| `ProviderQuota` | `id`, `name`, `used`, `limit`, `unit` | Generic id/name/part/resetsAt mapped from native account usage. Credits use the optional `remaining` extension; spent/limit/percent are not invented. Rendering it requires GeckIt PR #51. |
| `ProviderUsage` | `quotas`, `measuredAt` | Account usage and deduplicated usage events supplied alongside legacy plan. measuredAt included when known; optional unavailableReason explains an explicit missing subscription or failed lookup. |
| `ModelPricing` | `currency`, `input`, `output`, `cacheRead`, `cacheWrite`, `source`, `asOf` | Not produced; all unknown prices omitted rather than zero. |
| `PlanWindow` | `part`, `resetsAt` | Spent fraction plus reset timestamp. Parser tests cover zero/full usage and reset durations; values are rounded to the CLI display. |
| `PlanUsage` | `fiveHour`, `sevenDay` | fiveHour and sevenDay, only when present in native /usage. Shared account semantics; no model-specific quota split. |
| `BackgroundTask` | `id`, `kind`, `what`, `command`, `use`, `status`, `started`, `ended`, `exit`, `output`, `progress` | Native task lifecycle, command, times, exit and output-file path restored and polled. Native stop errors propagate. No guessed helper progress or send-to-background support. |
| `McpServer` | `name`, `status` | name/status supplied. pending_auth/expired→needs-auth, disabled first, unknown runtime→pending. connected inferred from configured, not a live network probe. |
| `SessionImage` | `media`, `data`, `ref` | Send/inject supported. Saved local/data-URL attachments and inline tool-result images restored with media/signature checks and bounded file reads. Remote/cloud-only attachments are not downloaded. |
| `ChatFound` | `id`, `root`, `said`, `count` | id/root/said/count supplied; case-insensitive all-words matching per message; blank search returns []. Tool/image contents excluded. |
| `ClaudeAccount` | `usage`, `provider`, `limits`, `here`, `signedIn`, `plan`, `key`, `who`, `program` | Native authentication, selected model billing source, program, plan and usage. API-key accounts omit subscription quota and report signedIn only when the selected native model is enabled. Opaque account identity is not exposed by account/read and remains omitted. |
| `ClaudeProgram` | `version`, `from`, `path` | Version and resolved executable path supplied; account.program includes installation provenance. |
| `ClaudeModel` | `pricing`, `reasoning`, `defaultReasoning`, `isDefault`, `value`, `name`, `says`, `id`, `version`, `contextWindow`, `maxOutputTokens`, `supportsAdaptiveThinking`, `supportsFastMode`, `supportsAutoMode`, `disabled` | Native IDs/default/disabled/context/output/recognized efforts and defaultReasoning supplied when known. Unknown capability flags and pricing omitted. |
| `SessionGoal` | `condition`, `checks`, `reason` | Native objective, turns used and status reason mapped. |
| `Answered` | `ok`, `text`, `error`, `plan`, `heard` | correct() returns ok=false plus error. Successful text/plan/heard responses unsupported. |
| `CodexLimitWindow` | `usedPercent`, `windowDurationMins`, `resetsAt` | Not used by this MiniMax provider. |
| `CodexRateLimit` | `limitId`, `limitName`, `normalModelSlug`, `primary`, `secondary` | Not used by this MiniMax provider. |
| `Link` | `url`, `text` | url and optional Markdown text, newest first, duplicate elimination, user/assistant messages only. |
| `Elicitation` | `serverName`, `message`, `fields`, `url`, `error`, `rememberAllowed` | Unsupported: no MCP structured authorization/form cards. |
| `WorkItem` | `label`, `url`, `says` | Not derived or supplied in provider rows. Host may derive separately. |
| `ElicitationField` | `name`, `label`, `description`, `type`, `required`, `options`, `default`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `format` | Unsupported with Elicitation; native question menus are not equivalent to typed schema forms. |
| `ElicitationValue` | Alias / index signature; see pinned declaration | Unsupported typed elicitation; no silent conversion to a question answer. |
| `ElicitationResponse` | `action`, `content`, `_meta` | Unsupported accept/decline/cancel form response contract. |
| `ElicitationAnswer` | Alias / index signature; see pinned declaration | Unsupported remembered elicitation responses. |

| `Browser` | `id`, `name`, `current` | Unsupported browser selection; no id/name/current results. |
| `RequestTask` | `provider`, `project`, `title`, `text`, `goal`, `started`, `note` | Host-owned request item payload. Not constructed by native adapter. |
| `RequestAnswer` | `how`, `where`, `reply` | Host-owned answer to a conversation request; not a native tool permission. |
| `TeamAnswer` | `how`, `where`, `note` | Host-owned employee/team permission result; not constructed by native adapter. |
| `TaskOutput` | `printed`, `helper` | The host reads printed output from BackgroundTask.output, mapped from the native absolute output_file_path. No fabricated output or Claude JSONL helper parsing. |
| `Json` | Alias / index signature; see pinned declaration | Recursive data shape used by structured elicitation; elicitation unsupported. |
| `JsonObject` | Alias / index signature; see pinned declaration | Structured elicitation content; unsupported. |
| `CodexGoal` | `threadId`, `objective`, `status`, `tokenBudget`, `tokensUsed`, `timeUsedSeconds`, `createdAt`, `updatedAt` | Only its status type is referenced by ProviderGoal. Native MiniMax goal integration remains absent. |

The public export aliases are: `ProviderSessionOptions` → `ClaudeOptions`, `ProviderConversation` → `Conversation`, `ProviderModel` → `ClaudeModel`, `ProviderAccount` → `ClaudeAccount`, and `ProviderProgram` → `ClaudeProgram`. Node stream types and TypeScript utility types retain their standard-library meanings. Host-owned request/team payloads are included for completeness, not claimed as MiniMax-native support.

## Every event variant

| Signal | Producer and consumer result |
| --- | --- |
| `started` | Namespaced session and requested model with explicit billing source; unknown source fails startup instead of falsely claiming a subscription. |
| `doing` | Changed running native tool names reported. |
| `said` | Changed assistant transcript text reported. |
| `retry` | Absent; native retry status not exposed. |
| `writing` | Absolute paths from running native write/edit calls. |
| `asks` | Native dialogs become question requests with native choice labels. Permission classification is not inferred. |
| `resolved` | Emitted when the terminal dialog disappears or is answered; card ID removed via `gone`. |
| `mode` | Observed permission label from the current TUI footer, never inferred from requested mode or quoted transcript. |
| `model` | Actual selected model polled through session-scoped models/list. |
| `reasoning` | Recognized actual thinking.effort from the selected native model; unknown/default values omitted. |
| `spend` | Context used/window only. Missing/null/invalid context data now handled; no cost claims. |
| `usage` | Generic quota snapshot emitted with legacy plan after turns; measurement timestamp when available. |
| `plan` | Refreshed account quota after turns, deduplicated, shared with active drivers. |
| `task` | Native task snapshots emitted on change, including terminal states. Output path enables host output reading; control stop_task uses native stop. |
| `begun` | Emitted for adapter sends and observed unsolicited native working turns. |
| `held` | Absent; no native hook continuation events. |
| `goal` | Host emits accepted goal mutations and reads native status after turns; MCode has no dedicated streamed goal event. |
| `ended` | done/stopped/failed, plus signedOut/limit for authoritative HTTP 401/429. Unknown terminal error dialogs, blocked reasons and reset times are not guessed. offPlan is host-owned. |

## Native transport and lifecycle boundary

Checked request methods: initialize/initialized, account/read and
desktopService/transport. HTTP calls used by the adapter include model listing
and selection, session create/list/read/activity/messages/fork/rename/delete,
MCP listing/runtime/enabled. Quotas and credits use terminal `/usage`; prompts, attachments,
permissions and planning use native TUI input. This inventory does not claim to
implement every DesktopService endpoint.

- Independent request IDs and stream IDs; interleaved responses and text/base64
  chunks tested. Credits are returned for chunks.
- HTTP failures preserve status; malformed JSON, stream errors, RPC errors,
  missing status, invalid chunks and timeouts reject rather than succeed with
  empty data. Missing status and invalid chunks were defects fixed here.
- Missing executable and disposal during requests tested. Disposed transport
  cannot restart. Authentication renewal, reconnect races and real backend
  overload are not exhaustively exercised by these fixtures.
- Namespace validation now applies to returned native IDs as well as incoming
  GeckIt IDs. Root ownership guards are tested before fork/delete/read.
- Session and message pagination reject missing/repeated cursors; cursor URL
  encoding tested. Backend errors are not converted to false “not found”.
- Driver send/inject/stop/end behavior uses an isolated real tmux server with
  fake MCode. Repeated end calls now share the cleanup promise; left occurs
  once. Startup is lazy and validation/disposal of an unused quota reader does
  not kill another reader's session.
- Native TUI scraping still depends on MCode 0.7.4 layouts. Unknown dialogs
  remain unanswered. Active-input draft rollback and timing across arbitrary
  third-party TUI changes are not guaranteed by protocol-level tests.
- Public provider dispose returns void as the contract allows. It initiates
  asynchronous cleanup; this differs from Driver.end's awaited guarantee.

## Additional defects reproduced and corrected

1. Missing optional message timestamps became NaN instead of being omitted.
2. `raw_json: null` threw during context extraction; invalid numeric context
   could propagate into spend.
3. Outgoing native IDs accepted missing/malformed values.
4. A second Driver.end resolved before the first cleanup completed.
5. `managerPrompt` was silently ignored. It now reaches MCode as one literal
   `--append-system-prompt` argument; Unicode, quotes and shell syntax are tested.
6. Remote/custom launch and legacy fork options were silently ignored. They
   now fail explicitly; normal native forks still work.
7. RPC stream completion without a response status was treated as success.
8. Malformed chunks threw inside the event handler and left requests waiting
   for a timeout; they now reject immediately.
9. Invalid model capacities such as Infinity were published; unknown/invalid
   capacities are now omitted.
10. An impossible quota percentage could be clamped into a believable zero;
    values above 100 are now omitted.

## What verification means here

- `test/provider-contract.test.mjs`: required provider members/capabilities,
  laziness, account states, metadata/numbers, all history/CRUD operations,
  project isolation, dates, namespace conversion, pagination, explicit optional
  stubs, and completeness of this inventory against the pinned snapshot.
- `test/rpc-contract.test.mjs`: interleaved streams, chunk encoding/credits,
  HTTP/RPC/stream/malformed/timeout failures, missing CLI and disposal.
- `test/mcode.test.mjs`: driver integration and emitted item/event discriminants,
  IDs, timestamp/numeric validity; manager prompt and repeat-end regressions,
  quota/MCP/links behavior and terminal state recognition.
- Installation tests use the actual copied loader and resume-command formatter.
  tmux distribution checks verify discovery and artifact integrity.

No destructive tests against real user history, real model prompts, clipboard
clicks, full phone flows, or all supported MCode versions were run. Native goal kickoff has fake-MCode permission/history coverage in the separate host integration. Background tasks, local image restoration and scoped launch instructions have behavioral coverage. Cloud-only attachments, structured MCP elicitation, retry/hook events and unknown terminal errors remain limitations.

Validation before this follow-up: 38 automated tests passed. The follow-up adds native state, task, guide and image regression tests; see INTEGRATION-AUDIT.md for the final result. A read-only smoke check against installed MCode 0.7.4 completed initialization, account/read (authenticated) and models/list (two models) with the hardened transport. No model request was made.

## Follow-up implementations

Instructions are appended only to provider-owned TUI launches and preserve the Manager prompt. Source-app guide/CLI overrides take precedence; missing builtin guide files use a bundled minimal GeckIt guide. Disabling affects subsequent driver launches, not a system prompt already loaded by MCode. No global user instruction file is rewritten. The separate host checkout now attaches a driver before native goal kickoff, and UI rename no longer depends on nativeGoals.
