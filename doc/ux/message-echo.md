---
type: spec
status: specified
owner: Alex
created: 2026-11-18
---

# UX: One user message per MiniMax submission

## 1. Why

GeckIt immediately shows a submitted user message. MiniMax then echoes the saved message with a different ID, creating a second bubble. Correct the provider event stream so one submission remains one bubble. The existing path is compose, Send, read progress, then read the answer; reopening reads native saved history.

## 2. What is added

No controls or wording are added. The existing desktop and phone transcript keeps its immediate user item when native history catches up.

## 3. States

| State | When | What the user sees | What to do |
|---|---|---|---|
| Submitted | Send accepted by GeckIt | One existing user bubble | Wait or Stop |
| Saved | MCode persists the submitted message | The same bubble | Wait or Stop |
| Answered | Native work finishes | One user bubble and the answer | Send another message |
| Reopened | History is loaded again | Every saved user message once | Read or continue |
| Failed | Existing native submission failure | Existing failure UI and the submitted message | Use existing retry controls |

## 4. Transitions

| From | Event | To | What the user sees |
|---|---|---|---|
| Composer | Press Send | Submitted | One user bubble immediately |
| Submitted | MCode saves the message, automatically | Saved | No additional bubble |
| Saved | MCode finishes, automatically | Answered | Existing answer and completion status |
| Submitted or Saved | Stop or native failure | Failed | Existing stopped/failure state |
| Any | Close and reopen | Reopened | Saved native messages |
| Answered, Failed or Reopened | Send another message | Submitted | A separate new user bubble, even for identical text |

No diagram is required for this correction to the existing linear send path; no prototype is produced.

## 5. What stays silent

Native acknowledgement of a message already displayed does not create a bubble or notification. Previously saved and externally generated user messages remain available.

## 6. Thresholds and time

No text comparison window or time threshold is introduced. Each submitted turn owns its next new native user record after its pre-send history snapshot. IDs preserve that ownership for the driver's lifetime.

## 7. Wording

No labels, status messages, notifications or error wording change.

## 8. Edge cases

Multiline text, command context, images and native content normalization do not affect ownership. Identical deliberate submissions remain separate. Saved user messages before submission remain visible. Native goals and external user records still emit user items. Existing Stop, failures and reconnect behavior remain in force; no replay or saved-history rewrite occurs.

## 9. What is deliberately absent

No global text deduplication, native-history deletion, model retry or renderer filtering is added. These could erase deliberate repeated requests or hide externally created messages.

## 10. Forks

Suppress only the native echo belonging to a held driver's ordinary send. Keep native reads complete. Injection retains the host's existing reconciliation; native goals retain their existing event path.

## 11. Reconciliation with requirements

This restores the requested single-message behavior. Apple UX immediate feedback, no surprises and quiet notifications apply to keeping the original bubble. Direct manipulation, forgiveness, visible next step, permissions and wording use existing controls. No visual design values or flows change. Live installed-provider behavior requires applying the rebuilt plugin; fake-native integration is recorded separately.
