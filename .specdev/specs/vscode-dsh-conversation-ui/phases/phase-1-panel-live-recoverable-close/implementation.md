# Phase 1 实现摘要（MUST-FIX loop 1）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushFullState` 空态分支追加 `messages/replace({ sessionId: '', messages: [] })` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 薄 Webview：`panel/state` 为 `empty`/`waiting-host` 时 `renderMessages([])`；`messages/replace` 接受清空帧（`sessionId: ''`） |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | 新增 L3 回归：关最后一个有内容 Tab → `hasReplaceEmpty === true` |

未改：`packages/core/agent-loop*`、design.md、spec.md。

## 对 Must-Fix / 验收标准的实现说明

### MF-1 / AC-2 / AC-24 — 空态清空消息列表

**根因**：`ChatPanelHost.pushFullState()` 在 `registry.getActive() === undefined` 时只推 `panel/state` + `status/set`，不下发清空消息帧；薄 HTML 在 `panel/state` empty 时也不清 `#messages`。关最后一个有内容 Tab 后 banner 已是「No active conversation」，气泡残留。

**修复（双端）**：
1. **Host**：空态 / waiting-host 分支在 `panel/state` 之后立即推送 `messages/replace({ sessionId: '', messages: [] })`，再推 `status/set`。
2. **Webview**：收到 `mode === 'empty' | 'waiting-host'` 时调用 `renderMessages([])`；`messages/replace` 对 `sessionId === ''` 的清空帧始终接受（即使客户端仍持有上一 live `sessionId`）。

权威侧 MessageStore 仍保留已关 Tab 投影（供 phase-2 再开）；清空仅针对已 attach 面板的 H→W 渲染面。

### MF-2 — 回归测试

L3 用例 `closes last content Tab with messages/replace([]) (AC-2 / AC-24)`：
- 建唯一有内容 Tab → attach FakeWebview → `closeConversation`
- 断言出站含 `panel/state:empty` 且 `hasReplaceEmpty === true`（复现 review 探针）

## 测试结果（命令 + 输出）

| 命令 | 结果 |
|------|------|
| `vitest run apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | ✅ 1 file / **6** tests passed（含新回归） |
| `bash …/test-scripts/run-phase1-l2-l3.sh` | ✅ `ALL PHASE-1 L2/L3 STEPS OK` |
| `vitest run apps/vscode-dsh/tests` | ✅ 17 files / **59** tests passed |
| `tsc -p apps/vscode-dsh/tsconfig.json --noEmit` | ✅ exit 0 |

## 偏差记录

本轮无新偏差。空态清空帧使用 `sessionId: ''` 作为协议约定（与有活动 Tab 的真实 sessionId 区分）；薄客户端同时用 DOM 清空作兜底。影响范围：spec.md AC-2 / AC-24；design.md AD-CU-1（Host 拥有模式与列表推送）。

## 债务

未新增 `@STUB`。活跃债 DEBT-001 / GAP-001 仍 🟡，目标 phase-2 / phase-3，本轮未动。

## Pre-completion Self-Verification

- 空函数：无；empty 分支有真实 `post(messages/replace)`。
- 连通性：`closeConversation` → `pushFullState` → FakeWebview 收到清空 replace → Webview `renderMessages([])`。
- 测试：禁用 Host 清空帧时，新 L3 断言 `hasReplaceEmpty` 会 FAIL。
