# Phase 3 实现摘要 — phase-3-activity-stream

## 变更清单（文件列表）

| 路径 | 变更 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/activity-types.ts` | **新增** ActivityItem / ActivityStatus / abort 码映射 / 稳定 id |
| `apps/vscode-dsh/src/chat-panel/render/activity-dom.ts` | **新增** 折叠/状态 DOM + `activityDomBrowserSource()`（层 A） |
| `apps/vscode-dsh/src/chat-panel/render/index.ts` | 导出 activity-dom |
| `apps/vscode-dsh/src/chat-panel/index.ts` | 导出 activity API |
| `apps/vscode-dsh/src/message-store.ts` | `kind:'activity'` + `activity?` + `MessagePatch.activityStatus` |
| `apps/vscode-dsh/src/conversation-controller.ts` | live `tool/call\|result` → activity；`markTurnIncomplete` → abort running |
| `apps/vscode-dsh/src/replay-hydrator.ts` | `foldActivities` + hydrate 重建活动项（AC-28） |
| `apps/vscode-dsh/src/chat-panel/probes.ts` | 产品路径填实 `setActivity` 类型注释（GAP-CUX-001） |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `messages/patch.activityStatus`；`action/toggle-activity` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | pushPatch 透传 activityStatus；toggle 呈现态 ack |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | activity CSS + renderBubble 分支 + patch 状态 + embed activity-dom |
| `apps/vscode-dsh/tests/layer-a/activity-stream.spec.ts` | **新增** 层 A（AC-21/22/23/25/26/27） |
| `apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts` | **新增** 层 B（AC-13c/20/24/27/28） |
| `.specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md` | GAP-CUX-001 → 已解决 |

未改：`packages/core/agent-loop`；Timeline 仍弱化；无自动 revert。

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-13c** | `abortRunningActivities` 在 `markTurnIncomplete`（turn/end aborted\|interrupted）将同回合 `running` → `aborted`；cancel 路径不调用 revert |
| **AC-20** | `projectToolCallActivity` → MessageStore `kind:'activity'` → `pushAppend` → Webview `[data-kind=activity]` |
| **AC-21** | `renderActivityBubble` 默认 `data-expanded=false` + `is-collapsed`；`probes.setActivity(..., expanded:false)` |
| **AC-22** | `toggleActivityExpanded` / Webview toggle 按钮 → expanded true + probes |
| **AC-23** | 同 turn 活动共享 `data-turn`（`applyMessageIdentity`）+ `ordinal` 递增 |
| **AC-24** | 活动投影独立于 `assistant/chunk`；仅 tool 事件即可出现 |
| **AC-25** | activity 与 change-list 均写 `data-turn`；层 A 断言同 turn 共组 |
| **AC-26** | `activity-dom.ts` 抽离 + jsdom 用例覆盖折叠切换 |
| **AC-27** | `activityStatusFromToolResult`：ABORTED\*→aborted，isError→failed，else→done；DOM `data-status` + probes |
| **AC-28** | `foldActivities` 写入 hydrate messages；Host `mode=replay` 仍 `ui/reject-send reason=replay` |

## 测试结果（命令 + 输出）

环境：Node **22.14.0**（jsdom 需要；Node 20 会因 ESM/jsdom 失败）

```bash
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/layer-a/ \
  apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts \
  apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts \
  apps/vscode-dsh/tests/message-store-index.spec.ts
```

结果：**7 files / 34 tests passed**（含层 A 全部 + 本 Phase 层 B + phase-2 cancel 回归 + message-store）

本 Phase 新增：
- `layer-a/activity-stream.spec.ts` — **5 passed**
- `chat-ux-activity-stream.spec.ts` — **5 passed**

## 偏差记录

无功能性偏差。设计可选的 `action/toggle-activity` 已接线为 Host **ack no-op**（展开为呈现态，Webview 本地 + probes 为准），符合 design「呈现态可本地，同步探针」。

- **影响范围**：design.md API 表 W→H `action/toggle-activity`
- **原因**：避免 Host 对 MessageStore 做 remove+append 重排；展开不需要 Host 权威
- **影响**：下游仍可通过 DOM/`__dshProbes.activity` 断言展开态

## GAP-CUX-001 关闭说明

产品路径现已调用 `probes.setActivity`：
1. 初次 `renderActivityBubble` / mount
2. `applyActivityStatus` / `applyActivityExpanded` / toggle
3. Webview `messages/patch.activityStatus` 与 append 渲染

Registry：活跃表移除 → 已解决表新增（解决 Phase = phase-3-activity-stream）。
