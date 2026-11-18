# MiniMax approval form

- Request: Можешь поправить дизайн формы?
- Checkout: /Users/alex/Projects/mine/geckit-minimax-tmux, main, permanent checkout.
- UX: ../../doc/ux/approval-form.md
- Acceptance: single readable heading, no terminal framing, evidence and permission reason preserved, all three native choices, existing confirmation steps, correct keys, usable real renderer in both themes on desktop and phone.

## 1. UX document

Done: doc/ux/approval-form.md records the existing permission flow and corrected presentation. No new flow or prototype is introduced.

## 2. UI

Done: reuse GeckIt's real Transcript question card and product tokens. The provider now supplies one question title, supporting permission reason and code evidence. No host renderer or style changes.

## 3. Production code

Done: src/mcode-terminal.mjs handles repeated cursor markers, isolates options from evidence and normalizes approval and confirmation content. Keys, permission scopes and Auto eligibility remain unchanged. index.mjs rebuilt. JavaScript syntax checks and git diff --check pass. This repository has no lint or typecheck scripts.

## 4. Distributed skills

Not applicable: no shipped skill changes.

## 5. Feature list

Not applicable: correction of an existing plugin form, no added GeckIt feature.

## 6. Regression tests

Done: full suite passes 71/71. After replacing the fake CLI permission screen with the screenshot's wrapped header and double cursor, the affected mcode and auto-mode suites pass 20/20. Coverage includes exact card title/reason/evidence, all three options and keys, shell pipes, unchanged signatures, full-review key and confirmation keys. Logs: /private/tmp/geckit-form-tests.log and /private/tmp/geckit-form-final-targeted.log.

## 7. Public boundary

Done: the bundled provider passes with fake MCode in real isolated tmux. The emitted question and card contain clean text, supporting reason, exact URL JSON and three choices. Existing permission and Auto/Manual/Plan behavior passes. No real account action or model request was sent.

## 8. Final UI and performance

Done: real GeckIt Transcript, Sidebar and Composer rendered through a temporary Vite harness. Parsed native fixture data and a fake answer boundary were used. Inspected full desktop context at 1280x800 in dark and light themes, and phone context at 390x844 in both themes. Checked 44 px mobile buttons, no page horizontal overflow, visible keyboard focus, Enter selecting native key 1, remember confirmation and Back, denial guidance submission, long evidence scrolling to line 50 and Review all details sending C-e. Initial test browser stopped during one check; resumed a task-owned test tab and repeated the affected keyboard and submission checks successfully.

Screenshots: /private/tmp/minimax-approval-dark.png, /private/tmp/minimax-approval-light.png, /private/tmp/minimax-approval-phone-dark.png, /private/tmp/minimax-approval-phone-light.png, /private/tmp/minimax-approval-phone-focus.png, /private/tmp/minimax-approval-long-scrolled.png.

Performance review: no host renderer, CSS, dependencies, polling or timers changed. Existing question signature prevents repeated cards as cursor position changes; parser work remains linear in the captured terminal lines. Browser harness files and its server are removed after verification.

## Result

Source and rebuilt bundle are ready for direct delivery to origin/main, authorized by Alex on 2026-11-18. Installed-plugin/live-account verification remains unperformed. The permanent checkout is retained; no temporary worktree was created. No audience content type matches; Apple UX standard and GeckIt components apply.
