# Phase 2 实现摘要 — phase-2-streaming-cancel-follow

## 变更清单（文件列表）

### 新增
| 文件 | 说明 |
|------|------|
| `packages/sdk/server/src/session-cancel.ts` | `sdkSessionCancel` Cordis 服务接口 |
| `apps/vscode-dsh/tests/layer-a/streaming-cancel-follow.spec.ts` | 层 A：patch 身份 + follow 决策 |
| `apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts` | 层 B：chunk / cancel / aborted / fail-closed |

### 修改
| 文件 | 说明 |
|------|------|
| `packages/sdk/server/src/server.ts` | `cancelSession` → `agent.cancel({kind:'user'},{keepInbox:true})` |
| `packages/sdk/server/src/index.ts` | provide `sdkSessionCancel` |
| `packages/ide/ide-bridge/src/types.ts` | `session/cancel` 帧 + `SDK_SESSION_CANCEL_SERVICE` |
| `packages/ide/ide-bridge/src/validate.ts` | cancel 帧校验 |
| `packages/ide/ide-bridge/src/index.ts` | `handleCancel` |
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | cancel round-trip + parse |
| `apps/vscode-dsh/src/session-host.ts` | `cancelSession`（默认超时 5000ms，无重试） |
| `apps/vscode-dsh/src/message-store.ts` | `streaming?` + `patch()`（text XOR appendText） |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `messages/patch` + `action/stop` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushPatch` / `requestStop` |
| `apps/vscode-dsh/src/conversation-controller.ts` | chunk 投影、cancelActiveTurn、aborted incomplete、断连 fail-closed |
| `apps/vscode-dsh/src/replay-hydrator.ts` | `detectIncomplete` 认 `aborted` |
| `apps/vscode-dsh/src/chat-panel/render/message-dom.ts` | patch 支持 `streaming` 属性 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Stop、patch、follow 跟滚/接管/回到底部 |
| `apps/vscode-dsh/src/extension.ts` | 接线 `requestStop` |
| `.cursor/skills/project-test/SKILL.md` | phase-2 测试知识 |

**未改**：`packages/core/agent-loop`（O-3）。

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| AC-10 | `onSdkNotification` 消费 `assistant/chunk` `text-delta` → MessageStore + `messages/patch`/`append` |
| AC-11 | `status/set generating` + Stop 可见；忽略 `reasoning-delta`（T6） |
| AC-12 | `assistant/message` 收敛同 `messageId` 节点（`text=` + `streaming:false`） |
| AC-13 | Webview `action/stop` → `cancelActiveTurn` → `IdeSessionHost.cancelSession` → bridge → `Agent.cancel` |
| AC-13b | live `turn/end` `aborted`/`interrupted` → `incomplete` + 「已停止/未完成」；半截文本保留；hydrate `detectIncomplete` 同步 |
| AC-13d | cancel 异常/超时 → banner「中断失败：…」；不标记 incomplete；不宣称前端停成功 |
| AC-14–16 | Webview `decideFollowState` + scroll / 「回到底部」；`data-follow-state` 探针 |
| AC-17 | 仅消费既有 chunk 事件；无 SDK stdout 改动 |
| AC-18 | 稳定 `data-message-id`；后续 chunk 用 patch，禁止整表冒充 |
| AC-19 | Host `error`/`disconnected` → fail-closed streaming false + banner |
| AC-71 | 层 A `streaming-cancel-follow.spec.ts` |
| AC-72 | Must 用例均为层 A/B；无仅层 C |

### Follow P2-2
- 流式开始（首 chunk / streaming→true）：`follow=on`，除非已不在底部（接管）
- `decideFollowState` 骨架末支保持当前态
- cancel / 断连：**不强制**重置 follow；streaming 置 false（断连 / 成功 aborted）

## 测试结果（命令 + 输出）

```bash
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/layer-a/streaming-cancel-follow.spec.ts \
  apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts \
  apps/vscode-dsh/tests/layer-a/foundation-render-probe.spec.ts \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts
```

**结果**：4 files / **36 passed**（2026-09-10，Node 22.14.0）。

相关回归（detectIncomplete）：`phase3-restart-continue` 过滤 → 2 passed。

## 偏差记录

1. **Cancel 超时钉死**
   - **偏差描述**：采用 `cancelTimeoutMs = 5000`、**无重试**（镜像 dispose）
   - **影响范围**：spec.md 约束「须有超时」；design.md AD-CUX-3
   - **原因**：phase-2 spec 未钉死毫秒；exploration R4 建议
   - **影响**：下游测试可按 5s 断言超时文案

2. **首 chunk 用 append，后续用 patch**
   - **偏差描述**：首次 `text-delta` 创建气泡走 `messages/append`（含初始文本），后续走 `appendText` patch
   - **影响范围**：design.md AD-CUX-10「ensure bubble + patch」
   - **原因**：保证 Webview 首次有节点可 patch；身份仍稳定
   - **影响**：层 B 断言后续 chunk 禁止 replace/append

3. **流式收敛暂用 textContent**
   - **偏差描述**：`messages/patch` `text=` 用 `textContent` 收敛，不重跑 Markdown 渲染
   - **影响范围**：AC-12 文本收敛
   - **原因**：流式路径以纯文本为主；完整 Markdown 仍可由后续 `messages/replace`（Tab 切换等）恢复
   - **影响**：流式结束后气泡可能为纯文本直至下次全量刷新

## 债务注册

- 无新增 `@STUB`
- 未新增活跃债；DEBT-CUX-001 / GAP-CUX-001 / GAP-CUX-002 仍指向 phase-3/4/5
- AC-13c 活动项 UI 仍归 phase-3（本 Phase 仅 live aborted→incomplete）
