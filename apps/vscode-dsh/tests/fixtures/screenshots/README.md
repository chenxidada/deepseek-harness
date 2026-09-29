# Chat UI chassis — L4 screenshot assist (AC-7a)

English | [中文](README.zh.md)

Primary evidence for B1–B3 is **L2/L3** in `phase3-chat-ui-chassis.spec.ts`
(`test:theme-tokens`, `test:bubble-layers`, `test:composer-contrast`, `test:visual-evidence-chain`).

Capture optional L4 screenshots here after a real Extension Host run (not pixel-color automation):

| File | Covers |
|------|--------|
| `B1-theme-light.png` | Default light theme; `--vscode-*` readable |
| `B1-theme-dark.png` | Dark theme after switch; no long-lived unreadable residual |
| `B2-bubbles-composer.png` | User/assistant bubble layers + fixed bottom Send bar |
| `B3-markdown-code.png` | Heading/list/fenced code + Copy affordance |

Place captured PNGs beside this README. Absence of PNGs does **not** fail L2/L3 gates; verifier may attach them as assist-only evidence.
