---
type: spec
status: implemented
created: 2026-11-17
---

# UX: MCode Auto mode

## 1. Why

Selecting Auto currently runs MCode's native Auto policy, which still asks about web fetch and other tools. The requested change lets the plugin handle these tool approvals automatically using the native conversation-scoped grant.

### Journey

Choose MiniMax Code (tmux), select Auto in the existing composer and send a task. A signed-in MCode installation and working tmux are required. Recognized tool approvals proceed without an approval card. Ordinary questions still appear with their existing answers. Return to Manual to answer subsequent tool approvals yourself; already accepted native conversation grants remain in effect. Resumed conversations use the selected mode when their driver starts. There is no additional setup screen.

## 2. Surfaces

| Surface | Result | When |
| --- | --- | --- |
| Existing mode selector | Existing Auto selection controls automatic tool answers | New and running drivers |
| Existing conversation cards | Tool approval cards are omitted or resolved automatically | Auto recognizes a conversation-scoped tool grant |
| Existing question cards | Existing native wording and choices | Manual, Plan, ordinary questions and confirmations |

No renderer or layout changes; no prototype is required.

## 3. States

| State | Trigger | What the user sees | Next action |
| --- | --- | --- | --- |
| Working in Auto | Known tool approval | Continued work | Wait or Stop |
| Waiting in Manual or Plan | Known tool approval | Native approval title, details and choices | Choose an answer or select Auto |
| Waiting for an ordinary answer | Native Ask dialog or rule confirmation | Native question and choices | Answer or Stop |
| Unknown native dialog | Unsupported layout | Terminal remains open | Attach to terminal or Stop |
| Stopping | Stop selected | Existing stopped outcome when native work settles | Send another message |
| Closed or failed | Driver ends or CLI exits | Existing stopped or failed outcome | Resume or resend |

## 4. Transitions

| From | Event | To | What the user sees |
| --- | --- | --- | --- |
| Working in Auto | Recognized tool approval, automatically without user input | Working in Auto | Continued work, no question card |
| Waiting in Manual | Person selects Auto | Working in Auto | Waiting card resolves after native grant is sent |
| Working in Auto | Person selects Manual | Waiting on the next tool approval | Existing native approval card |
| Waiting in Manual | Person selects Auto then Manual before a reply is sent | Waiting in Manual | Existing approval card remains |
| Waiting for an answer | Person answers | Working | Existing card resolves |
| Any open state | Person selects Stop | Stopping | Existing stopped result |
| Any open state | Driver ends or CLI exits | Closed or failed | Existing lifecycle feedback |

No diagram: transitions reuse the existing selector and native dialogs without adding a navigation path.

## 5. What stays silent

Automatic answers produce no extra toast or card because Auto is the person's selected policy. Diagnostic logs record only session identity and conversation scope, never tool arguments or dialog text.

## 6. Thresholds and time

Reuse the existing terminal polling interval. Re-read the active dialog immediately before automatic input and check the latest mode and Stop state. No new timeout or retry threshold is introduced.

## 7. Wording

Existing labels remain "Auto", "Manual" and "Plan". The only automatically selected native option is "Allow for this conversation". "Always allow matching actions", "Deny and guide MCode" and ordinary question answers remain manual.

## 8. Edge cases

No approval means no automatic input. Repeated tool approvals can each receive the same conversation-scoped grant. A changed dialog signature cancels the automatic answer for that poll. Unknown layouts remain open. Stop or close cancels pending automatic input. A mode change takes effect for automatic answers immediately; native slash commands wait for an idle terminal. Native goals follow the same approval handling. MCode's own hard denials remain denials because no grant menu is offered.

## 9. What is deliberately absent

No permanent allow rules, automatic ordinary answers, blanket Full permissions, host contract changes or new settings.

## 10. Decisions

Assumption from the implementation request and screenshot: Auto should answer tool approval menus automatically, including web fetch. MCode's native Auto alone does not achieve that result. The implementation retains native Auto and adds conversation-scoped answers only for recognized tool menus.

## 11. Requirements

Auto handles explicit tool menus; Manual and Plan preserve manual decisions; ordinary questions, unknown dialogs and rule confirmations stay manual; mode switches and Stop are checked before automatic input. Public-boundary tests use real tmux and a fake MCode CLI. Real-account approval execution and rendered host review are unverified.

Apple UX checks: direct manipulation uses the existing selector; feedback uses existing transcript/cards; no new destructive control; next actions remain existing answers or Stop; mode changes are explicit; no new setup or permissions; automatic answers stay quiet; wording comes from native MCode. No new visible controls or styling are introduced, so visual requirements are unchanged.
