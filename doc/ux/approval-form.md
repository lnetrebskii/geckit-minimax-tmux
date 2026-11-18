---
type: spec
status: specified
owner: Alex
created: 2026-11-18
---

# UX: MiniMax action approval

## 1. Why

The existing approval card repeats native terminal framing and loses the selected first option when MCode renders two cursor markers. Keep the existing GeckIt question card and present the native decision as readable content.

## 2. What changes

Use the native question as the single title, the permission reason as normal supporting text, and arguments or commands as code evidence. Remove terminal borders, cursor marks and duplicate tool headings. Preserve all native options and their numeric key mappings.

## 3. States

| State | Visible content | Available action |
|---|---|---|
| Approval | One question, reason, evidence | Allow for this conversation, Always allow matching actions, Deny and guide MCode |
| Full evidence | Existing native detail review | Review all details when MCode offers it |
| Remember confirmation | Native confirmation question and evidence | Confirm or Back |
| Deny confirmation | Native confirmation question and evidence | Deny, Back or existing custom guidance |
| Resolved | Existing resolved request behavior | Continue reading |

## 4. Transitions

Choosing an option sends its existing native key. Always and Deny retain MCode's confirmation step. Back returns to the original approval. No option is selected automatically by the presentation change. Existing Auto mode policy is unchanged.

## 5. Silent behavior

Terminal layout, transcript history and changing cursor position do not become request content. Existing question signatures prevent repeated cards for unchanged requests.

## 6. Timing

No new polling, timers or waits. Existing permission lifetime and native scopes remain unchanged.

## 7. Wording

Keep MCode's question, permission reason, commands and option labels. Remove only terminal decoration and duplicated headings.

## 8. Surfaces

Reuse the real desktop and phone question component, product tokens and keyboard focus. Check light and dark themes, narrow viewport, long evidence scrolling and response submission.

## 9. Accessibility

Keep native HTML buttons and the existing labeled custom-answer input. The full URL, reason and commands remain accessible without relying on color.

## 10. Boundary

This fixes an existing form; no new product feature or standalone layout prototype is introduced. The user's request authorizes the correction.

## 11. Verification

Parser regression coverage includes the screenshot's double cursor, wrapped heading, URL and reason, shell pipes, full-detail review and unchanged action mappings. Browser checks use the real renderer with parsed native fixture data and a fake answer boundary; real account approvals are not sent.
