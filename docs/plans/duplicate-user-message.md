# MiniMax user-message echo

- Request: minimax pluging дублирует исходное сообщение.
- Checkout: /Users/alex/Projects/mine/geckit-minimax-tmux, main, permanent checkout.
- Started: 2026-11-18

## Acceptance conditions

- Send one message through the held provider -> GeckIt keeps its immediate user item and receives no second user item for the native echo; MCode receives the message once.
- Send identical text twice deliberately -> both sends remain, once each.
- Send multiline text, command context or images -> the same single-message rule applies.
- Reopen/read history -> all saved user messages remain available.
- Native goal and unsolicited native messages -> their user items still reach GeckIt.
- Assumption: fix the independent provider, without changing the host renderer or existing conversation data.

## Progress

### 1. Prepare the UX document

- [x] Done
- Skill: define-ux-behavior.
- Evidence: doc/ux/message-echo.md records the correction to the existing send contract. No prototype or new flow is introduced; the request authorizes removing the duplicate.

### 2. Prepare the UI and test it

- Not applicable: library event correction; no renderer, component, layout, style or wording changes.

### 3. Write the feature code

- [x] Done
- Skill: write-feature-code.
- Evidence: src/mcode-terminal.mjs omits the owned native echo after an ordinary send. index.mjs rebuilt with npm run build. Source, bundle and new test pass node --check; git diff --check passes. This JavaScript repository defines no lint or typecheck scripts.

### 4. Update the related distributed skills

- Not applicable: no shipped skill describes message echo handling.

### 5. Update the feature list

- Not applicable: bug fix to existing messages, no added product feature; the independent plugin has no feature list.

### 6. Write unit tests

- [x] Done
- Skill: verify-change.
- Evidence: test/message-echo.test.mjs failed before the change with 3 visible user items instead of 2, then passed after rebuilding. Full npm test passes 69/69, including native goals, permissions, Stop and failure paths.

### 7. Test the feature through its public boundary

- [x] Done
- Skill: verify-change.
- Evidence: read-only native MCode API reports one matching message in mvs_a9b54cb1961048efab2e41b6c97e971d, while GeckIt show prints two. The rebuilt provider public boundary passes with fake MCode in real isolated tmux: immediate host-item simulation, native history, identical repeated sends, multiline input with command context, image delivery, unsolicited native messages and a new driver after reopening. Existing native-goal tests also pass. Test tmux sessions and temporary data were cleaned up. No real model turn or installed renderer test was performed.

### 8. Test the final UI

- Not applicable: no renderer change; library checks prove events and durable reads. Live installed-provider verification remains unavailable until the fixed bundle is applied.

## Result

- Delivery: source and rebuilt index.mjs; direct delivery to origin/main authorized by Alex on 2026-11-18. Installation is outside this delivery.
- Remaining verification limit: the installed library still uses its existing bundle; live application behavior with this fix is unverified until the library is updated. No temporary worktree was created; permanent checkout retained.
- Audience type standard: none matched; existing product behavior follows the Apple UX standard.
