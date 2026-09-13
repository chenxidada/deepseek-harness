# Layer V checklist — Phase 2（vscode-dsh-editor-chat-panel）

> Source: `ui-visual-spec.md` §9 Phase 2 + Phase 3 收尾；AC-41 / AC-42
> Probes: React DOM contracts in `tests/layer-a-rtl/editor-chat-phase2.spec.tsx`
> Environment note: without Extension Development Host + DISPLAY, human Layer V cannot claim PASS.

## Checklist

| # | Item | Probe / how | Status |
|---|------|-------------|--------|
| 1 | user/assistant hierarchy §5.2；MD settle 后代码块可读 + 复制可见 | RTL: `msg-md`, `btn-copy`, `btn-copy-code` | ⬜ needs DISPLAY |
| 2 | 活动/引用/变更视觉权重正确 | RTL: `activity-row`, `ref-card`, `change-list` | ⬜ needs DISPLAY |
| 3 | composer 四态人眼可分；禁用有原因位 | RTL: `data-composer-state` ×4 + `composer-disabled-reason` | ⬜ needs DISPLAY |
| 4 | 历史行含标题/时间/预览；Continue/删除可发现；父子可读 | RTL: `history-row`, `btn-continue`, `btn-history-delete`, `history-parent` | ⬜ needs DISPLAY |
| 5 | 能力入口可发现且非「演示按钮墙」 | RTL: overflow menu + search panel | ⬜ needs DISPLAY |
| 6 | focus/hover/reduced-motion 底线 UI-AC-50–52 | CSS: `tokens.css` focus-visible + `prefers-reduced-motion` + ≥8px gaps | ⬜ needs DISPLAY |
| 7 | 删除两处一致的 **webview modal** | RTL: `delete-confirm-modal` + `ui/delete-request` | ⬜ needs DISPLAY |
| 8 | Stop / 停止中可见（无 thinking） | RTL: `btn-stop[disabled]` + status「正在停止…」 | ⬜ needs DISPLAY |
| 9 | 双主题抽检 | Manual light/dark | ⬜ needs DISPLAY |

## Honest environment status

Recorded by implementer at Phase 2 close (2026-09-13):

```
DISPLAY=<unset>
CI=<unset>
code CLI=no
cursor CLI=no
```

**Verdict for Layer V in this environment:** cannot claim PASS (AC-42). Checklist + Layer A probes shipped; human Host walkthrough still required when DISPLAY/Extension Development Host is available. Do not fake screenshots.

## How to run Layer V when DISPLAY is available

1. `pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build`
2. Launch Extension Development Host (`F5` / `code --extensionDevelopmentPath=...`)
3. Open Editor Chat Panel (`dsh.showPanel`)
4. Walk the checklist above; tick items; attach screenshots under this Phase folder if desired
