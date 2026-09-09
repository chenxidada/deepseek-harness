# Phase 4 实现摘要 — phase-4-new-conversation-chrome

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 新增 W→H `action/new-conversation`；H→W `panel/state.chrome.newConversation` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 处理 New；`requestNewConversation` dep；connecting 时 mode≠live（AC-22/R1）；banner「正在连接到 Host…」 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 顶栏常驻「新建会话」+ 窄栏 overflow（⋯ 首项同为新建）；composer 禁用 connecting |
| `apps/vscode-dsh/src/extension.ts` | `runNewConversationShared`（ensureHost → New/reuse → reveal）；命令与 Webview 共用；**DEBT-003** `requestContinue` 对齐 ensureHost |
| `apps/vscode-dsh/src/connection-ui.ts` | connecting 文案改为「正在连接到 Host…」 |
| `apps/vscode-dsh/README.md` | 文档：chrome 主入口、Webview New/Continue auto-start、无 keybindings（AC-34） |
| `apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts` | **新增** L2/L3：AC-15/21–24/6 + DEBT-003 + Host 路由 |
| `.specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md` | DEBT-003 → 已解决 |
| `.cursor/skills/project-test/SKILL.md` | 追加 Phase 4 测试命令 |

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-15** | `#newConversationBtn` 文案「新建会话」常驻；`#chrome` flex-wrap + `#chromeOverflow` 展开后首项同为新建（一次点击或展开+首项） |
| **AC-21** | 按钮为产品主入口；`package.json` 无 `contributes.keybindings`（非 Must） |
| **AC-22** | Webview New → `ensureHostForSend` → connecting banner/文案；`pushFullState` 在 connecting 强制 `mode=waiting-host`（非可发送 live）；失败走 AC-2（missing-credentials → failed）；成功后 live + reveal |
| **AC-23** | 已连：`newConversationOrReuseEmpty` + `revealConversationPanel` + live |
| **AC-24** | L2 脚本驱动 `action/new-conversation`；断言 Tab 计数与 `panel/state.mode===live` |
| **AC-6** | 按钮路径：(a) 活动空 Tab 复用 Tab 数不变；(b) 活动有内容时新建，不切到遗留空 Tab |
| **AC-34** `[Should]` | **未**实现 keybindings；README 声明键盘不得替代按钮 |

## DEBT-003

- **已修复并关闭**：`createPanelHost` → `requestContinue` 现 `await ensureHostForSend` 再 `continueConversation` + `pushFullState`。
- L2：离线 `action/continue` → `connectionPhase=connecting` → Start → `connected`。

## 测试结果（命令 + 输出）

```text
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts
# Test Files  1 passed (1) | Tests  9 passed (9)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts
# Test Files  6 passed (6) | Tests  65 passed (65)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0
```

## 偏差记录

### 偏差 1：AC-34 keybindings 未实现

- **偏差描述**：未添加 `contributes.keybindings`。
- **影响范围**：spec.md §验收标准 AC-34；design.md AD-CR-8。
- **原因**：AC-34 为 Should；入口 Gate/spec 明确按钮为 Must、键盘不得替代按钮。
- **影响**：下游无阻塞；命令面板 / `dsh.newConversation` 仍可用。

### 偏差 2：connecting 时保留 session 字段但 mode=waiting-host

- **偏差描述**：有活动 Tab 且 `connectionPhase=connecting` 时，`panel/state.mode` 为 `waiting-host`（仍带 sessionId/tabId + messages/replace），而非完全 empty。
- **影响范围**：spec.md AC-22；design.md 协议节「mode 保持 waiting-host/empty」。
- **原因**：满足「非可发送 live」同时保留消息列表，避免等待期闪空。
- **影响**：Webview 在 connecting 期间清空逻辑已避开 `connectionPhase===connecting`；composer 禁用。
