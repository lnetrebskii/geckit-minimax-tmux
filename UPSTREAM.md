# Provenance

The integration is based on the architecture of https://github.com/anetrebskii/geckit-claude-tmux at commit `7f762b575b75ee5a901697b6474e9dbb0021f08a` (2026-11-03).

Retained/adapted from that repository: `src/tmux-binary.mjs`, its tests, the tmux release build script/workflow, build setup and original license notice. The Claude runtime, Claude transport and Claude account/usage implementation are not included.

`src/mcode-*.mjs` implements the native MiniMax Code adapter. Protocol and terminal layouts were verified against the locally installed official `@minimax-ai/code` 0.7.4 and the official source at https://github.com/MiniMax-AI/minimax-code (retrieved 2026-11-03). No MCode runtime source or credentials are bundled. Runtime requests go to the installed MCode CLI's local app-server over stdin/stdout, while model prompts are delivered to its TUI through tmux.

GeckIt contract: https://github.com/anetrebskii/geckit/blob/main/docs/provider-plugins.md, apiVersion 1.
