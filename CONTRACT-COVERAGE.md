# Complete provider boundary inventory

Audit date: 2026-11-03. Scope: the MiniMax library ↔ GeckIt apiVersion 1 boundary, its native MCode transport, and host consumers. This is not an audit of unrelated GeckIt application APIs.

Pinned host source: [69ad36623228400acc4b2fa94a4368fb91033d3f](https://github.com/anetrebskii/geckit/tree/69ad36623228400acc4b2fa94a4368fb91033d3f). Provider/Driver declarations match the source used for the installed host inspection. The snapshot in `test/fixtures/geckit-contracts.json` retains complete comment-stripped declarations, source paths and SHA-256 hashes. The member column below is an index; inherited and nested field types remain in the declarations.

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
| `ProviderGoal` | Alias / index signature; see pinned declaration | Stub: no native goal/status/end-state synchronization. |
| `ProviderFork` | Alias / index signature; see pinned declaration | Native id, begun=true and copied items. Legacy fork descriptor is not used. Requested mode is applied at hold; requested model is not explicitly applied in fork: gap. |
| `ProviderLimits` | Alias / index signature; see pinned declaration | windows and legacy plan are supplied. Generic quotas and Codex limits are omitted. windows depends on a prior models() call for known capacities. |
| `ProviderBrowser` | Alias / index signature; see pinned declaration | Unsupported; undefined result. |
| `Driver` | `send`, `inject`, `answer`, `permit`, `control`, `stop`, `end`, `leave` | send/answer/stop/end plus inject/permit implemented. control and leave absent. Repeated end now returns the same cleanup promise. See event/lifecycle checks below. |
| `Heard` | `items`, `gone`, `signals` | items/gone/signals always supplied. Items are upserted by stable native IDs; disappearances produce gone IDs. |
| `Signal` | `started`, `doing`, `said`, `retry`, `writing`, `asks`, `resolved`, `mode`, `model`, `reasoning`, `spend`, `usage`, `plan`, `task`, `begun`, `held`, `goal`, `ended` | All 18 variants enumerated below. Only 7 kinds are currently emitted; lack of emission is not hidden by method-presence validation. |
| `ClaudeOptions` | `managerPrompt`, `reasoning`, `root`, `id`, `resume`, `mode`, `model`, `fork`, `launch` | root/id/mode/model/reasoning mapped; resume intentionally uses native --session for both created and existing sessions. managerPrompt now forwarded through --append-system-prompt. launch and legacy fork explicitly rejected rather than silently ignored. |
| `Held` | `stdin`, `stdout`, `stderr`, `on`, `once`, `kill`, `leave` | Not provided: custom/remote launch transport is unsupported. Native process is owned internally. |
| `Conversation` | `items`, `cost`, `goal`, `tasks` | items and tasks=[] returned, context included. Cost, currency, native goal and restored background tasks absent. Extra used context is returned but is not a declared Conversation member. |
| `Found` | `id`, `title`, `stands`, `at`, `driven`, `model`, `used`, `work`, `cwd` | Native listing supplies core fields; same omissions and driven semantics as ProviderRow. |
| `GoalRead` | `goal`, `ended`, `met` | Unsupported: goal()/setGoal() return undefined, clearGoal is a no-op. |
| `Usage` | `plan`, `windows` | windows Map plus optional legacy plan. Initial quotas may wait for account load; stale cached data can be returned while refresh runs. |
| `McpChange` | `name`, `enabled` | name is URL-encoded, enabled is passed to native PATCH. Native config is global, not per requested root. |
| `Wanted` | `elicitation`, `write`, `command`, `web`, `read`, `question`, `start`, `other` | Only question is emitted, including native approvals. Other 7 variants are absent. Native approval cards therefore bypass host permission classification/Auto re-evaluation and remain explicit questions. |
| `LlmProviderInfo` | `id`, `family`, `transport`, `name`, `shortName`, `icon`, `iconPath`, `browser`, `loginCommand`, `planName`, `resumeCommand`, `source`, `localOnly`, `replaces`, `runtime`, `instructions` | id/family/name/shortName/icon/browser/loginCommand/planName/resumeCommand/source/localOnly/instructions supplied by manifest. Optional iconPath absent; reserved transport/replaces and Codex runtime deliberately absent. |
| `LlmProviderId` | Alias / index signature; see pinned declaration | Independent plugin:minimax-tmux identity; namespace conversion validated in both directions. |
| `SessionMode` | Alias / index signature; see pinned declaration | manual→ask, auto→auto, plan→ask plus /plan on. Plan applies on a new driver. Additional internal bypassPermissions support is outside this public enum and not advertised. |
| `SessionProvider` | Alias / index signature; see pinned declaration | Only plugin:minimax-tmux; no builtin provider impersonation. |
| `ReasoningEffort` | Alias / index signature; see pinned declaration | Recognized native options filtered to this enum. No defaultReasoning or actual-reasoning event mapping. |
| `CardKind` | Alias / index signature; see pinned declaration | question only. permission/start/elicitation absent. |
| `SessionCard` | `kind`, `title`, `detail`, `where`, `choices`, `elicitation`, `answered` | question/title/detail/choices supplied; host owns answered state. where/elicitation absent. Free-text questions and known menu choices use native terminal input. |
| `CardAnswer` | Alias / index signature; see pinned declaration | Not emitted as permission buttons by this adapter. Answers are choice labels or free text; once/session/no are not native approval mappings. |
| `SessionItem` | `mine`, `theirs`, `did`, `thought`, `shell`, `card`, `wrote`, `note`, `request`, `team-request`, `steps` | mine/theirs/did/thought/note mapped; transient question cards emitted. shell/request/team-request are host-owned. wrote/steps absent. Native saved user/tool images and assistant phase absent. |
| `SessionSpend` | `used`, `window`, `cost`, `currency`, `costKind` | used/window only; optional dates and null context validated after this audit. Finite nonnegative used and positive finite window. Cost/currency/costKind unknown and omitted. |
| `ProviderQuota` | `id`, `name`, `used`, `limit`, `unit` | Not produced: legacy PlanUsage is used. Unknown absolute used/limit/unit omitted. |
| `ProviderUsage` | `quotas`, `measuredAt` | Not produced through account or usage events. Legacy plan still accepted by the installed host. |
| `ModelPricing` | `currency`, `input`, `output`, `cacheRead`, `cacheWrite`, `source`, `asOf` | Not produced; all unknown prices omitted rather than zero. |
| `PlanWindow` | `part`, `resetsAt` | Spent fraction plus reset timestamp. Parser tests cover zero/full usage and reset durations; values are rounded to the CLI display. |
| `PlanUsage` | `fiveHour`, `sevenDay` | fiveHour and sevenDay, only when present in native /status. Shared account semantics; no model-specific quota split. |
| `BackgroundTask` | `id`, `kind`, `what`, `command`, `use`, `status`, `started`, `ended`, `exit`, `output`, `progress` | Not produced/restored despite native background-task routes. Task output/stop/background UI cannot be considered integrated. |
| `McpServer` | `name`, `status` | name/status supplied. pending_auth/expired→needs-auth, disabled first, unknown runtime→pending. connected inferred from configured, not a live network probe. |
| `SessionImage` | `media`, `data`, `ref` | media/data validated and delivered for send/inject. ref is a host lazy-image reference, not resolved by the adapter. Saved message images and tool-result images are not restored. |
| `ChatFound` | `id`, `root`, `said`, `count` | id/root/said/count supplied; case-insensitive all-words matching per message; blank search returns []. Tool/image contents excluded. |
| `ClaudeAccount` | `usage`, `provider`, `limits`, `here`, `signedIn`, `plan`, `key`, `who`, `program` | provider/here/signedIn/program and optional plan supplied. who/key/usage/limits absent. Account/key provenance is not detected. |
| `ClaudeProgram` | `version`, `from`, `path` | version/path supplied; installation from is enriched in account.program only. path is discovered on PATH but symlink realpath is not resolved as the comment requires: gap. |
| `ClaudeModel` | `pricing`, `reasoning`, `defaultReasoning`, `isDefault`, `value`, `name`, `says`, `id`, `version`, `contextWindow`, `maxOutputTokens`, `supportsAdaptiveThinking`, `supportsFastMode`, `supportsAutoMode`, `disabled` | value/name/id/isDefault/disabled/contextWindow/maxOutputTokens/recognized reasoning supplied. Other optional metadata omitted, including actual defaults, versions, capability flags and pricing. |
| `SessionGoal` | `condition`, `checks`, `reason` | No synchronized condition/checks/reason from MCode. Host display alone does not establish a working goal lifecycle. |
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
| `TaskOutput` | `printed`, `helper` | Not supplied by this adapter; native background task output integration is absent. |
| `Json` | Alias / index signature; see pinned declaration | Recursive data shape used by structured elicitation; elicitation unsupported. |
| `JsonObject` | Alias / index signature; see pinned declaration | Structured elicitation content; unsupported. |
| `CodexGoal` | `threadId`, `objective`, `status`, `tokenBudget`, `tokensUsed`, `timeUsedSeconds`, `createdAt`, `updatedAt` | Only its status type is referenced by ProviderGoal. Native MiniMax goal integration remains absent. |

The public export aliases are: `ProviderSessionOptions` → `ClaudeOptions`, `ProviderConversation` → `Conversation`, `ProviderModel` → `ClaudeModel`, `ProviderAccount` → `ClaudeAccount`, and `ProviderProgram` → `ClaudeProgram`. Node stream types and TypeScript utility types retain their standard-library meanings. Host-owned request/team payloads are included for completeness, not claimed as MiniMax-native support.

## Every event variant

| Signal | Producer and consumer result |
| --- | --- |
| `started` | Namespaced session and optional requested model, key=false. **Gap:** actual account/model key provenance is not determined; custom API-key models can be misrepresented. Actual mode/reasoning/commands are absent. |
| `doing` | Absent; no descriptive live activity from native tools. |
| `said` | Absent as a signal; assistant text arrives as transcript items. |
| `retry` | Absent; native retry status not exposed. |
| `writing` | Absent; host cannot identify imminent writes. |
| `asks` | Native dialogs become question requests with native choice labels. Permission classification is not inferred. |
| `resolved` | Emitted when the terminal dialog disappears or is answered; card ID removed via `gone`. |
| `mode` | Absent; applying a requested mode does not synchronize independently changed native mode. |
| `model` | Absent after startup; actual native model switches not synchronized. |
| `reasoning` | Absent; requested effort is sent at startup, actual changes not synchronized. |
| `spend` | Context used/window only. Missing/null/invalid context data now handled; no cost claims. |
| `usage` | Absent; legacy plan is used. |
| `plan` | Refreshed account quota after turns, deduplicated, shared with active drivers. |
| `task` | Absent; background-task affordances and handover guards incomplete. |
| `begun` | Emitted for adapter sends; unsolicited native background turns not detected as new host turns. |
| `held` | Absent; no native hook continuation events. |
| `goal` | Absent; no native goal-state integration. |
| `ended` | done/stopped/failed only, once per tracked turn. Specific native blocked/limit/signedOut conditions and reset times not classified. offPlan is host-owned. |

## Native transport and lifecycle boundary

Checked request methods: initialize/initialized, account/read and
desktopService/transport. HTTP calls used by the adapter include model listing
and selection, session create/list/read/activity/messages/fork/rename/delete,
MCP listing/runtime/enabled. Quotas use terminal `/status`; prompts, attachments,
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
clicks, full phone flows, or all supported MCode versions were run. Native
goals, background tasks, image restoration and instructions remain **missing**;
the expanded passing suite must not be interpreted as their implementation.

Final validation: 38 automated tests passed. A read-only smoke check against installed MCode 0.7.4 completed initialization, account/read (authenticated) and models/list (two models) with the hardened transport. No model request was made.
