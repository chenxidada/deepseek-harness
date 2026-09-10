# Design Consistency Review — phase-2-streaming-cancel-follow

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

> 以 `design.md` AD 编号为权威（任务清单中的 AD 描述与编号有交叉错位：chunk/thinking≈AD-CUX-10+7；cancel≈AD-CUX-3；follow≈AD-CUX-4；fail-closed≈AD-CUX-3/10）。

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CUX-3** I-真 cancel：`session/cancel` → `sdkSessionCancel` → `Agent.cancel({kind:'user'},{keepInbox:true})`；超时 + AC-13d fail-closed；不改 agent-loop | 是 | 三件套：`packages/ide/ide-bridge` 帧/校验/`handleCancel`；`packages/sdk/server/src/session-cancel.ts` + `server.cancelSession` 调用 `keepInbox: true`；`IdeSessionHost.cancelSession` 默认 5000ms、无重试；`ConversationController.cancelActiveTurn` 失败只 banner、不标 incomplete；implementation 明确未改 agent-loop | ✅ |
| **AD-CUX-4** 跟滚 = 纯 `decideFollowState` + `data-follow-state`；`atBottom`/`userTookOver` 同源接管条件 | 是 | `render/follow-state.ts` 纯函数；Webview `userTookOver = !atBottom`；scroll /「回到底部」走 `decideFollowState`；`applyFollowState` 写 `data-follow-state`；cancel/断连不强制重置 follow（P2-2） | ✅ |
| **AD-CUX-7** T6 锁定 B：不投影 reasoning / thinking UI | 是 | `projectAssistantChunk` 对 `reasoning-delta` early return；仅 `text-delta` + generating/Stop chrome；无 thinking DOM | ✅ |
| **AD-CUX-10** `messages/patch` + 节点身份；`text` XOR `appendText`；streaming 探针 fail-closed | 是 | 协议 `messages/patch`；`MessageStore.patch` / `ChatPanelHost.pushPatch` / Webview 均拒双字段；稳定 `streamingAssistant` id + `data-message-id`；收敛用 `text=`；断连 `failClosedAllStreaming` 置 `streaming:false` + banner | ✅ |
| **AD-CUX-1 / §7.2** 呈现态下放；决策态留 Host；Stop 只发 action | 是 | follow/streaming 在 Webview probes；`action/stop` → Host `cancelActiveTurn`；mode/send 仍 Host | ✅ |
| **§7.1** 层 A 抽离模块测 patch + follow | 是 | 层 A `tests/layer-a/streaming-cancel-follow.spec.ts` + 既有 `render/*`；非整页 `runScripts` 主路径 | ✅ |
| **§7.3 / §7.4** 不做 thinking UI；真 cancel；不改 agent-loop | 是 | 同上 AD-CUX-3/7；无 agent-loop 改动 | ✅ |
| **范围** 不进 phase-3 活动项 UI、phase-5 fork | 是 | 无 `activity-dom.ts` / `ActivityItem` 产品路径；无 `action/branch`/`forkFromClosed`/`sessions.fork`；AC-13c 明确延后 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 / 改动面 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `session-cancel.ts` | `packages/sdk/server/src/` | ✅ | 镜像 dispose/resume Cordis 服务 |
| bridge cancel 帧 | `packages/ide/ide-bridge/src/` | ✅ | 与 dispose/resume triad 同层 |
| `cancelSession` | `apps/vscode-dsh/src/session-host.ts` | ✅ | Host bridge 编排位 |
| chunk / cancel / aborted | `conversation-controller.ts` | ✅ | Host 投影权威 |
| `MessageStore.patch` + `streaming?` | `message-store.ts` | ✅ | 投影存储扩展，非第二权威库 |
| `messages/patch` / `action/stop` | `chat-panel/protocol.ts` | ✅ | 协议契约 |
| `pushPatch` / stop 路由 | `chat-panel-host.ts` | ✅ | Host→Webview / Webview→Host |
| Stop / follow 接线 | `chat-panel-provider.ts` | ✅ | 呈现态产品路径 |
| `decideFollowState` / `patchMessageDom` | `chat-panel/render/` | ✅ | 符合 AD 抽离模块布局；未提前建 `activity-dom` / fork 模块 |
| 层 A/B 测试 | `tests/layer-a/` + `tests/chat-ux-*.spec.ts` | ✅ | 与 phase-1 分层一致 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| SDK 服务 | `sdkSessionCancel` / `SDK_SESSION_CANCEL_SERVICE` | 镜像 `sdkSessionDispose` | ✅ |
| Bridge 帧 | `session/cancel` + `/response` | dispose/resume 命名族 | ✅ |
| Host API | `cancelSession` / `cancelActiveTurn` | design Host 编排 API | ✅ |
| 跟滚 | `decideFollowState` / `FollowDecisionInput` / `data-follow-state` | AD-CUX-4 | ✅ |
| 协议 | `messages/patch` / `action/stop` | design API 域 | ✅ |
| 探针 | `streaming` / `followState` | `ChatUxProbes` | ✅ |

### Constitution §7 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §7.1 | 可脚本渲染 + 抽离层 A | ✅ | patch→DOM + follow 层 A 覆盖 |
| §7.2 | 决策态 Host / 呈现态 Webview + 探针 | ✅ | streaming/follow 呈现；cancel 决策在 Host |
| §7.3 | 无 thinking UI；不改 agent-loop | ✅ | T6 B；O-3 |
| §7.4 | 真 cancel bridge→Agent.cancel | ✅ | keepInbox 薄接线 |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- **首 chunk 用 `messages/append`，后续 `appendText` patch**：与 design 草图「ensure bubble + patch」略有表述差，但稳定 `messageId`、禁止整表 `replace` 冒充增量，符合 AD-CUX-10；implementation 已记偏差；exploration R6 允许二选一。
- **流式收敛 `text=` 走 `textContent`**：不重跑 Markdown；AD 要求文本收敛与节点身份，未强制流式路径即时 Markdown；完整渲染仍可由后续 `messages/replace` 恢复。
- **`initFollowOnStreamStart` 直接赋值 on/off**：未再包一层 `decideFollowState`，但与 P2-2「流式开始 → on，除非已接管」及同源 `!atBottom` 规则一致；scroll/resume 仍走纯决策函数。
- **Cancel 超时 5000ms、无重试**：spec 未钉死毫秒；镜像 dispose，implementation 已文档化——符合 AD-CUX-3「在 phase-2 钉死」意图。

## 范围边界（显式核对）
| 禁区 | 结果 |
|------|------|
| phase-3 活动项折叠 UI / AC-13c 完整验收 | 未实现产品 UI；live aborted→incomplete 属本 Phase 允许预备 |
| phase-5 fork / retry / edit / branch | 无对应协议 action 或编排 API |
| thinking / reasoning UI | 明确忽略 `reasoning-delta` |
| agent-loop 改动 | 无 |
