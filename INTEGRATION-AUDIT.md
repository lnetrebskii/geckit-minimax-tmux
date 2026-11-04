# Integration audit and implemented follow-up

Scope: MiniMax tmux provider ↔ GeckIt apiVersion 1. The pinned host contracts and all 63 related types are listed in [CONTRACT-COVERAGE.md](CONTRACT-COVERAGE.md).

## Implemented

- Published library updates use Git commits and hot replacement; an app restart is unnecessary. Running drivers are replaced when safe.
- The top-right Copy action has `mcode --session {id}` metadata. Links preserve labels, deduplicate, and list newest first.
- Quotas come from native `/status`, with both legacy plan windows and generic usage/quotas. Their first read waits for account loading. No model call is used.
- Account/startup billing distinguishes Token Plan, MiniMax API key and custom providers. Unknown billing source does not silently become a subscription. Subscription quota is not shown for API-key accounts. Opaque account identity is unavailable from native account/read and is omitted.
- Native session CRUD, root isolation, pagination and fork point checks. Fork now applies a requested model. Context capacities load even if limits is called before models. Executable paths resolve symlinks.
- Background tasks restore on read and emit changed task events. Native lifecycle, command, timestamps, exit code and absolute output-file path are mapped. The host reads that file for task output. Stop uses the native task endpoint and reports operation errors. Unknown controls reject; leave uses local end semantics.
- Instruction toggle applies a scoped GeckIt system-prompt append to subsequent driver launches, preserving Manager instructions. It prefers a source-app guide and CLI where provided. If builtin guide files are absent, a minimal GeckIt guide is used. User global MCode instructions are never rewritten. A running TUI retains the prompt it already loaded.
- Saved user attachments restore from native local files/data URLs. Inline tool-result images restore. Reads are bounded and image signatures checked; inaccessible files and cloud-only URLs are omitted, not fetched.
- Native tool paths restore; completed successful write/edit operations produce wrote paths. Running write/edit calls produce writing events; changed tools/text produce doing/said.
- Observed TUI permission mode and session-scoped selected model/effort produce state events. Unknown effort/default values are omitted. Unsolicited native working turns produce begun.
- Missing OAuth before delivery offers English sign-in cards through the existing question contract. Global/China sign-in runs in a separate tmux session; native browser authorization and account verification gate continuation. Cancellation/timeout cleans up the login session. HTTP 401/429 during delivery/history polling map to signedOut/limit. Unknown terminal error dialogs are not classified from arbitrary text.
- Known native permission/question dialogs, literal multiline prompts, image delivery, active-turn guidance, Manual/Auto changes, stop/resume and cleanup remain covered. Repeated end awaits the same cleanup.

## Remaining boundaries

1. **Native goals require host integration.** `nativeGoals=false` remains deliberate. GeckIt handles a `/goal` request without necessarily holding a driver; MCode goal creation auto-starts work, potentially waiting on a native permission dialog with no event consumer. A message carrying a goal can also cause a second kickoff. Safe integration needs explicit goal-start/attach semantics, no duplicate turn, and pause/resume/clear lifecycle tests. Unsupported native goal mutations now reject rather than silently succeeding.
2. **Native rename from the UI is host-gated.** The provider PATCH works, but the inspected host invokes it only when nativeGoals is true. That condition must be decoupled from goals.
3. **No text-correction endpoint integration.** MCode exec is a full agent, not an isolated text-completion call; it must not be substituted without a verified tool-free configuration and cancellation lifecycle.
4. Remote projects/control, Chrome browser selection and structured MCP elicitation are not advertised. Unknown native TUI dialogs require the terminal. Native approval labels are preserved as question cards; a broader session grant is never misrepresented as “once”.
5. Native retry/hook/goal events, all blocked/terminal-auth/rate-limit layouts, assistant phase, cloud-only attachment recovery and helper progress remain unmapped. Optional pricing/cost/account identity are unknown, not zero.
6. Session rows lack a trustworthy persisted program-origin marker and last-message summary; current driven/stands semantics remain limited. Write events describe native write/edit tools, not arbitrary shell filesystem changes. Send-to-background is not offered without native support.

These limitations are not claims of complete UI support. Enabling capability flags alone would not fix them.

## Verification

The full suite uses the copied GeckIt loader/formatter, pinned contract declarations, RPC fixtures and isolated real tmux with fake MCode. Added tests cover background task restore/output/stop errors, state emissions, source guide enable/disable, local and inline images, failed-write exclusion, billing-source distinctions and fork/model requests. Native MCode 0.7.4 was also queried read-only for account/source/model/session/task schemas, without sending model prompts or changing user history.

No automated real clipboard click, phone/browser end-to-end flow, real model turn, or every MCode version is claimed. Final automated result: 47 tests passed; the final MCP snake_case authorization regression also passed after rebuilding.

Sign-in release verification: 58 tests pass, including real tmux with a fake CLI, browser authorization handoff, single message delivery, cancellation and cleanup. No real-account logout was performed for testing.
