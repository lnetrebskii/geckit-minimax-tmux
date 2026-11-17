# MCode Auto mode

- Request: Implement Auto mode in the tmux MCode plugin; user authorized delivery to lnetrebskii main.
- Checkout: /Users/alex/Projects/mine/geckit-minimax-tmux, feat/auto-mode, permanent checkout.
- Started: 2026-11-17.
- Session: Codex 01a1eaf6-e2c2-7e42-8fd2-30bab4e1eff3.

## Acceptance conditions

- Auto recognizes native tool approval menus and chooses "Allow for this conversation" without showing an approval card.
- Manual and Plan keep tool approvals manual; explicit denial still works.
- Ordinary questions, permission-rule confirmations and unknown dialogs remain manual.
- Selecting Auto resolves an already waiting approval; returning to Manual or Stop prevents pending automatic answers.
- Native goals follow the same policy; lifecycle and saved history remain available.
- Never select permanent rules or substitute Full permissions.
- Rebuild the distributable bundle and pass the public-boundary test suite.
- Assumption: the requested Auto behavior means handling native tool approvals automatically, including the web fetch menu in the screenshot. Native MCode Auto alone still asks for these.

## Progress

### 1. Prepare the UX document

- [x] Done
- Skill: define-ux-behavior.
- Evidence: doc/ux/auto-mode.md records states, wording, transitions, native grant persistence and Apple UX checks. No prototype or renderer change.

### 2. Prepare the UI and test it

- Not applicable: no renderer, layout, visual control or style changes; existing host controls remain in use.

### 3. Write the feature code

- [x] Done
- Skill: write-feature-code.
- Evidence: src/mcode-terminal.mjs distinguishes explicit approval menus, tracks current permission policy, rechecks the active dialog, uses only the native conversation grant and honors Stop/mode changes. index.mjs rebuilt. node --check passes. This JavaScript repository has no typecheck or lint script.

### 4. Update the related distributed skills

- Not applicable: the plugin ships no related task skills or instruction commands describing this policy.

### 5. Update the feature list

- [x] Done
- Evidence: this repository has no feature list. README.md, CONTRACT-COVERAGE.md and INTEGRATION-AUDIT.md now describe the behavior and verification boundary. No GeckIt host feature-list changes because this task modifies only the independent plugin.

### 6. Write unit tests

- [x] Done
- Skill: verify-change.
- Evidence: baseline npm test passed 66/66; full updated npm test passed 68/68. test/auto-mode.test.mjs covers repeated approvals, ordinary questions with the same answer label, rule confirmations, unknown dialogs, Manual/Plan, pending mode switches, Stop and native goals. The final focused run adds explicit Plan denial. Existing manual approval tests retain their manual coverage.

### 7. Test the feature through its public boundary

- [x] Done
- Skill: verify-change.
- Evidence: real isolated tmux sessions run the fake MCode CLI through the rebuilt provider create/hold/send/permit/answer/stop and goal methods. Saved native history and events are checked. Installed MCode 0.7.6 source confirms web_fetch prompts even under its native Auto policy. No real-account tool action or live host renderer test was performed.

### 8. Test the final UI

- Not applicable: no renderer/layout changes. The library boundary is verified with real tmux and a fake backend; the installed GeckIt plugin has not been updated during this task.

## Result

- Delivery: prepared for commit and authorized integration into origin/main.
- Checkout: permanent plugin checkout retained; no temporary worktree was created.
- Remaining verification limits: real-account tool execution and installed GeckIt behavior are unverified.
- Audience type standard: none matched; product behavior uses the Apple UX standard.
- Day-plan validation: pre-existing unrelated missing proof and duplicate Zabookni-section errors remain; the task entry is valid.
