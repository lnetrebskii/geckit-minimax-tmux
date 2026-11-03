# Provenance

The integration is based on the architecture of https://github.com/anetrebskii/geckit-claude-tmux at commit `7f762b575b75ee5a901697b6474e9dbb0021f08a` (2026-11-03).

Retained/adapted from that repository: `src/tmux-binary.mjs`, its tests, the tmux release build script/workflow, build setup and original license notice. The Claude runtime, Claude transport and Claude account/usage implementation are not included.

`src/mcode-*.mjs` implements the native MiniMax Code adapter. Protocol and terminal layouts were verified against the locally installed official `@minimax-ai/code` 0.7.4 and the official source at https://github.com/MiniMax-AI/minimax-code (retrieved 2026-11-03). No MCode runtime source or credentials are bundled. Runtime requests go to the installed MCode CLI's local app-server over stdin/stdout, while model prompts are delivered to its TUI through tmux.

GeckIt contract: https://github.com/anetrebskii/geckit/blob/main/docs/provider-plugins.md, apiVersion 1.

`test/fixtures/geckit-loader.mjs` contains the manifest and factory validation functions copied from the installed GeckIt `app.asar/out/main/index.js` on 2026-11-03. Host logging and identity-normalization helpers are stubbed for the independent plugin identity. This regression fixture verifies the actual installation boundary: independent `plugin:*` providers must omit the reserved `transport` metadata, even when their implementation uses tmux.
