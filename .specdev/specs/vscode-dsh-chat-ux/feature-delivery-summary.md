# Feature delivery summary — vscode-dsh-chat-ux

- **Status**: completed (2026-09-11T06:34:08Z)
- **Closed by**: user request (defer further UX polish)
- **Merged on master** (product only; specs gitignored):
  - phase-1 foundation render/probes
  - phase-2 streaming + true cancel + follow
  - phase-3 in-chat activity stream
  - phase-4 refs / change-diff extract / native diff
  - phase-5 fork P-continue / P-mark (+ emptySeed Must-Fix)
  - phase-6 session search tiers 1+2

## Deferred (explicit)
- Streaming-safe Markdown re-render on settle
- Top-of-panel conversation tabs (vs side TreeView)
- Broader visual redesign of Conversation webview

## Tip
Rebuild `apps/vscode-dsh/lib` (+ ide-bridge / sdk-server libs) before F5; Extension loads compiled `lib/`, not `src/`.
