# Phase 3 实现摘要 — phase-3-chat-ui-chassis

（与 `implementation.md` 同文；中文交付副本。）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Chat UI 底盘：`--vscode-*` 主题、气泡分层、固定底栏、Enter/Shift+Enter、安全 MD、主题 class |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `action/copy-code`；Host→W `ui/theme` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `requestCopyCode`；`pushThemeKind` |
| `apps/vscode-dsh/src/chat-panel/composer-keydown.ts` | **新增** Enter/Shift+Enter 纯函数（L3） |
| `apps/vscode-dsh/src/chat-panel/index.ts` | 导出 keydown helper |
| `apps/vscode-dsh/src/markdown/safe-markdown.ts` | **新增** 安全 MD 子集 + 浏览器内联源 |
| `apps/vscode-dsh/src/conversation-titles.ts` | **新增** `EMPTY_LIVE_TITLE = '新对话'` |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` | 空态去命令堆砌；空 live 显示「新对话」 |
| `apps/vscode-dsh/src/extension-index.ts` | History 过滤空 Tab（`isHistoryEligibleSession`） |
| `apps/vscode-dsh/src/extension.ts` | `dsh.copyToClipboard`；主题变更广播；copy 接线 |
| `apps/vscode-dsh/src/auto-ready-coordinator.ts` | 空 live 标题 →「新对话」 |
| `apps/vscode-dsh/src/conversation-controller.ts` | 默认标题 →「新对话」 |
| `apps/vscode-dsh/package.json` | 注册内部命令 `dsh.copyToClipboard`（无菜单） |
| `apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts` | **新增** VP-CR-6 四拆 + MD/XSS/copy/IA/回归 |
| `apps/vscode-dsh/tests/fixtures/screenshots/README.md` | L4 截图辅助路径说明（B1–B3） |

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-7a** | 四独立用例 `test:theme-tokens` / `bubble-layers` / `composer-contrast` / `visual-evidence-chain`；L4 路径见 `tests/fixtures/screenshots/README.md` |
| **AC-8** | body/气泡/底栏/Send 均用 `var(--vscode-*)`；无裸灰框主背景 |
| **AC-8a** | `onDidChangeActiveColorTheme` → `ui/theme` → Webview `theme-*` class；原生 CSS 变量仍为主 |
| **AC-9** | `.msg.bubble.user` / `.assistant` 分层对齐与边框色差；`data-role` |
| **AC-10** | `status/set generating` →「Generating…」+ `.is-generating`；idle 清空 |
| **AC-11** | flex 列布局 + `#composer` sticky bottom；Send 用 button token |
| **AC-12** | `resolveComposerKeydown` + Webview keydown；Enter 发非空；Shift+Enter 换行 |
| **AC-16** | 标题/列表/fenced 代码；失败回退转义纯文本 |
| **AC-16a** | HTML/脚本转义；无 `<script>`/`<img>` 外链；L3 否定用例 |
| **AC-17** | Copy → `action/copy-code` → `dsh.copyToClipboard` → `env.clipboard.writeText` |
| **AC-18** | 未实现表格/链接预览（非 Must） |
| **AC-19** | 空 registry → `[]`；空 live 标签「新对话」 |
| **AC-19a** | `isHistoryEligibleSession` 过滤空 live 占位 |
| **AC-20** | 未改 replay 路径；phase2 回归绿 |
| **AC-25** | 仍仅跟随 `panel/state` |
| **AC-27** | 全量 120/120；send 冒烟本 suite |

## 测试结果

```text
vitest run apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts  # 16/16
vitest run apps/vscode-dsh/tests                                  # 120/120
tsc -p apps/vscode-dsh/tsconfig.json --noEmit                     # exit 0
```

## 偏差记录

无功能性偏差。L4 仅路径约定；Should AC-28..32 未做；DEBT-003 仍 → phase-4。

## 债务

未新增 `@STUB`。DEBT-003 保持活跃 → phase-4。
