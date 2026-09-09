# Phase 3 实现摘要 — phase-3-chat-ui-chassis

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
| `apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts` | VP-CR-6 四拆 + MD/XSS/copy/IA/回归；**Should-Fix 加固**（见下） |
| `apps/vscode-dsh/tests/fixtures/screenshots/README.md` | L4 截图辅助路径说明（B1–B3） |

## Should-Fix 加固（本轮，仅测试）

关闭 review-correctness 三条 🟡；**无产品行为变更**。

| SF | AC | 变更 |
|----|-----|------|
| SF#1 | AC-16/16a | 新增：HTML 嵌入 `escapeHtml`/`renderSafeMarkdown` 静态断言；`vm` 跑 `safeMarkdownBrowserSource` 与 TS `renderSafeMarkdown` 五夹具同源（port V-IND-1） |
| SF#2 | AC-20 | 新增：`openFromHistory` 非空 → `mode=replay`；`composer/send` → `ui/reject-send` reason=replay（port V-IND-2） |
| SF#3 | AC-7a | `test:visual-evidence-chain`：`existsSync(…/screenshots/README.md)` 替代 `path.length > 0`（不强制 PNG） |

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-7a** | 四独立用例；L4 README `existsSync`；PNG 可选 |
| **AC-8** | body/气泡/底栏/Send 均用 `var(--vscode-*)` |
| **AC-8a** | `onDidChangeActiveColorTheme` → `ui/theme` → Webview `theme-*` |
| **AC-9** | `.msg.bubble.user` / `.assistant`；`data-role` |
| **AC-10** | `status/set generating` →「Generating…」+ `.is-generating` |
| **AC-11** | `#composer` sticky bottom；Send button token |
| **AC-12** | `resolveComposerKeydown` + Webview keydown |
| **AC-16** | 标题/列表/fenced；失败回退转义纯文本 |
| **AC-16a** | XSS 否定 + **Webview 嵌入 ↔ TS 同源** |
| **AC-17** | Copy → `dsh.copyToClipboard` |
| **AC-18** | 未实现表格（非 Must） |
| **AC-19** | 空 registry → `[]`；空 live「新对话」 |
| **AC-19a** | History 过滤空 Tab 占位 |
| **AC-20** | **phase3 suite 显式** `openFromHistory`→replay + reject-send |
| **AC-25** | 仅跟随 `panel/state`；无 React |
| **AC-27** | live send 冒烟 + 全量回归 |

## 测试结果（命令 + 输出）

```text
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts
# 19/19 passed（原 16 + SF 加固 3）

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests
# 23 files / 123 tests passed（原 120 + 3）
```

## 偏差记录

无功能性偏差。说明性备注：

- **L4 截图**：仅 README 路径约定；未提交 PNG（AC-7a 主证据为 L2/L3）。
- **Should AC-28..32**：未实现（非门禁）。
- **DEBT-003**：Continue auto-start 旁路仍留给 phase-4（未改动）。

## 债务

未新增 `@STUB`。DEBT-003 保持活跃 → phase-4。三条 Should-Fix 测试硬化已关闭。
