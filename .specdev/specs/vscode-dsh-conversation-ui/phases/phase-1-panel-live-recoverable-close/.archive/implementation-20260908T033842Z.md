# Phase 1 实现摘要 — phase-1-panel-live-recoverable-close

## 变更清单（文件列表）

### 新增
- `apps/vscode-dsh/src/message-store.ts` — 按 session 的聊天投影（非权威库）
- `apps/vscode-dsh/src/extension-index.ts` — `workspaceState` 立即持久化 openTabSet/activeSessionId
- `apps/vscode-dsh/src/chat-panel/protocol.ts` — Host↔Webview 协议类型
- `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` — 协议推送 + `ui/reject-send` 门禁 + FakeWebviewPort
- `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — 极薄 WebviewView + HTML
- `apps/vscode-dsh/src/chat-panel/index.ts` — 导出
- `apps/vscode-dsh/tests/message-store-index.spec.ts` — L1
- `apps/vscode-dsh/tests/panel-close-delete.e2e.spec.ts` — L2 VP-1-close/delete/empty
- `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` — L2 hooks + L3 fake Webview
- `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-1-panel-live-recoverable-close/test-scripts/run-phase1-l2-l3.sh`

### 修改
- `apps/vscode-dsh/src/conversation-controller.ts` — close≠dispose；delete 状态机；MessageStore/Index；panel 联动
- `apps/vscode-dsh/src/conversation-registry.ts` — `mode`；同 sessionId 单开（AC-59）
- `apps/vscode-dsh/src/timeline-store.ts` — assistant 长文弱化（AC-14）
- `apps/vscode-dsh/src/interaction-coordinator.ts` — `onChange` 供 panel waiting 状态
- `apps/vscode-dsh/src/interaction-ui.ts` — Stop&Close / Delete 确认
- `apps/vscode-dsh/src/conversation-tab-bar.ts` — delete context 注释
- `apps/vscode-dsh/src/extension.ts` — 面板注册、delete、L2 `dsh.test.*` 钩子、workspaceState
- `apps/vscode-dsh/src/index.ts` — 导出新模块
- `apps/vscode-dsh/package.json` — `dsh.chat` WebviewView、delete/test 命令、菜单
- `apps/vscode-dsh/README.md` — 关≠删、面板 vs Timeline、L2 钩子
- `apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts` — dispose 断言改到 delete
- `apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts` — close 仅 fail-closed、不 dispose
- `apps/vscode-dsh/tests/multi-tab-dispose.e2e.spec.ts` — close 不 dispose
- `apps/vscode-dsh/tests/conversation-registry.spec.ts` — AC-59

未改：`packages/core/agent-loop*`、ide-bridge 双通道、AD-8。

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| AC-1 | `dsh.chat` WebviewView + `dsh.test.openPanel` |
| AC-2 | 无活动 Tab → `panel/state` mode=empty/waiting-host |
| AC-3 | 新建 Tab → live + 空 `messages/replace` |
| AC-4/5/6 | MessageStore 用户全文 + 完整 assistant `append`；无文本不造助手气泡 |
| AC-7 | `status/set` generating / idle |
| AC-9/10/11 | composer/send + Host 门禁 `ui/reject-send`；`dsh.test.sendPrompt` |
| AC-12 | 仍走 `IdeSessionHost.prompt` |
| AC-13 | `dsh.promptActiveConversation` 保留 |
| AC-14/15 | Timeline assistant 仅短 label + `description: assistant turn`；Diff 入口保留 |
| AC-17 | README「Panel vs Timeline」 |
| AC-18/21 | 切 Tab → `messages/replace`；status 跟活动 Tab |
| AC-59 | registry.create 同 sessionId 抛错 |
| AC-23 / 空 Tab / 立即持久化 | close 不 dispose；空 Tab 不入 openTabSet；每次变更 `writeImmediate` |
| AC-24/25 | 关活动 Tab 切邻/空态；running 需 confirmStopClose |
| AC-26/60/72/73 | delete 确认前不 dispose；host-not-ready 拒绝；命令 `dsh.deleteConversation` |
| AC-61 | markDeleted 不级联子 session |
| AC-62 | 命令 + Conversations 上下文菜单 |
| AC-41…43 | status waiting-interaction；fail-closed 后 onChange → pushStatus |
| AC-45/46 | 索引仅元数据 |
| AC-48…53 | 无 agent-loop 改动 |
| AC-54/84 | L2 hooks + L3 FakeWebviewPort + run-phase1-l2-l3.sh |

## 测试结果（命令 + 输出）

```text
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests
# Test Files  17 passed (17)
# Tests  58 passed (58)  — includes new AC-59

bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-1-panel-live-recoverable-close/test-scripts/run-phase1-l2-l3.sh
# ALL PHASE-1 L2/L3 STEPS OK
```

L2 采用仓库等价方案：vitest + duck-typed vscode + `activate()` 注册钩子（非 `@vscode/test-electron`；本环境无完整 VS Code Extension Host runner）。

## 偏差记录

1. **偏差描述**：L2 未引入 `@vscode/test-electron`，改用既有 vitest/duck-typed vscode 作为仓库等价 Extension Host 驱动面。  
   **影响范围**：spec.md §验证策略 / design.md §验证分层 L2  
   **原因**：应用内无既有 electron runner；duck-typed activate + `dsh.test.*` 可脱离 Webview 驱动 Host。  
   **影响**：CI/开发机可脚本验证 VP-1-*；真实 VS Code 像素渲染仍属 L4。

2. **偏差描述**：删除「清除权威」= bridge `session/dispose` + MessageStore/Timeline 清投影 + 索引 tombstone；不物理 unlink JSONL。  
   **影响范围**：spec.md AC-26 / design.md AD-CU-3  
   **原因**：T-0a/产品 persistence 无 delete API；进程内句柄清除 + 索引墓碑满足「不可回放正文」于 live 路径。  
   **影响**：phase-3 重启/历史若需物理删文件需另开能力。

## 债务

本 Phase **未新增** `@STUB`。活跃债务仍为 DEBT-001、GAP-001（均 🟡，目标 phase-2/3）。
