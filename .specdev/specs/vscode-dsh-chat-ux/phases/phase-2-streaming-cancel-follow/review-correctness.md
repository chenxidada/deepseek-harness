# Correctness Review — Phase 2 (phase-2-streaming-cancel-follow)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-10 | live `assistant/chunk` 文本增量投影到助手气泡 | `conversation-controller.ts:onSdkNotification` + `projectAssistantChunk`；`message-store.ts:patch`；`chat-panel-host.ts:pushPatch` | ✅ | `assistant/chunk` → 仅 `text-delta` 入 MessageStore；首包 `append` 建稳定 id，后续 `appendText` patch；层 B 断言文本 `Hel`→`Hello` 且同 id |
| AC-11 | 流式 `streaming=true` +「生成中」；不展示 thinking | `projectAssistantChunk`（忽略 `reasoning-delta`）；`resolveStatus` running→`generating`；`applyStreamingStatus`；Stop chrome | ✅ | reasoning-delta 早退且不入 store；`status/set generating` → probe streaming + `Generating…`；层 A/B 无 thinking/reasoning DOM；T6 锁定 B |
| AC-12 | 正常结束 → streaming false，与权威全文收敛 | `projectAssistantMessage` 收敛分支 | ✅ | 存在 `streamingAssistant` 时同 `messageId` `text=` + `streaming:false`；层 B 收敛为 `Hello world` 且 `streaming` 清除 |
| AC-13 | I-真 cancel：`session/cancel` → `Agent.cancel` | Webview `action/stop` → `cancelActiveTurn` → `IdeSessionHost.cancelSession` → bridge `handleCancel` → `sdkSessionCancel` → `server.cancelSession` → `agent.cancel({kind:'user'},{keepInbox:true})` | ✅ | 全链路函数体真实（非空壳）；层 B spy `cancelSession`；ide-bridge 单测 cancel→service；**未改** `packages/core/agent-loop`（git 无改动） |
| AC-13b | 半截保留 +「已停止/未完成」；认 live aborted/interrupted | `markTurnIncomplete`；`detectIncomplete` | ✅ | live `turn/end` `aborted`/`interrupted` → incomplete + notice；半截文本保留；hydrate 同步认 `aborted`；层 B 覆盖 |
| AC-13d | cancel 失败/超时 fail-closed | `cancelActiveTurn` catch；`session-host` 5000ms 超时 | ✅ | banner「中断失败：…」；不标 incomplete；不宣称前端停成功；层 B 超时用例 |
| AC-14 | follow on 时新增量保持底部策略 | `chat-panel-provider.ts` `keepBottomIfFollowing` + `data-follow-state`；`decideFollowState` | ✅ | follow=on 时 patch/append 调 `scrollIntoView`/`scrollTop`；属性可探针 |
| AC-15 | 接管条件 → follow off；后续不强制回底 | `syncFollowFromScroll`：`userTookOver=!atBottom` | ✅ | takeover → `decideFollowState` off；`keepBottomIfFollowing` 仅 follow=on |
| AC-16 | 回底 /「回到底部」→ follow on | `followResumeBtn` → `syncFollowFromScroll(true)` | ✅ | `explicitResume` 分支返回 `on`；层 A 覆盖 resume |
| AC-17 | 不以改 SDK 才有 chunk 为硬依赖 | `onSdkNotification` 消费既有 `assistant/chunk` | ✅ | 无 SDK stdout / agent-loop 改动；仅 Host 侧消费 |
| AC-18 | 层 A：同 `data-message-id`；禁止整表重建冒充增量 | `streamingAssistant` Map；后续 `messages/patch`；`patchMessageDom` | ✅ | 稳定 Host 生成 id；层 B 后续 chunk 零 `replace`/`append`；层 A 同节点引用断言（源码级） |
| AC-19 | chunk 异常/断连 → streaming false + 失败态 | `failClosedAllStreaming`；`onStatusChange` error/disconnected | ✅ | patch `streaming:false` + banner「Host 连接中断…」；层 B disconnect 用例 |
| AC-71 | 层 A 覆盖 patch→DOM + follow | `tests/layer-a/streaming-cancel-follow.spec.ts` | ✅ | 身份 / follow on→off→on / stay-current / incomplete attrs 用例存在且逻辑正确 |
| AC-72 | 层 C 仅辅助；A/B 失败不得靠 C | 测试分层 | ✅ | Must 证据为层 A + 层 B + ide-bridge；无仅层 C |

### Follow P2-2（约束）
| 约束 | 判定 | 证据 |
|------|:--:|------|
| 流式开始 follow=on（除非已接管） | ✅ | `initFollowOnStreamStart`：近底→on，否则 off |
| `decideFollowState` 末支保持当前态 | ✅ | `!userTookOver && !atBottom && !explicitResume` → `return input.followState` |
| cancel/断连不强制重置 follow | ✅ | `cancelActiveTurn` / `markTurnIncomplete` / `failClosedAllStreaming` 均不写 follow；仅清 streaming |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-CUX-001 | `chat-panel-provider.ts` change-list/diff 双路径 | ⚠️ Known | 🟡→phase-4；本 Phase 未扩大为桩 |
| GAP-CUX-001 | `probes.ts:activity` | ⚠️ Known | 🟡→phase-3（AC-13c UI） |
| GAP-CUX-002 | parentReadonly / continueSealed | ⚠️ Known | 🟡→phase-5 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无。`cancelSession`/`handleCancel`/`projectAssistantChunk`/`markTurnIncomplete`/`MessageStore.patch`/`detectIncomplete` 均为真实逻辑；未见 `@STUB` / 硬编码假成功 |

## 关键发现
### 🔴 Must-Fix
- 无

### 🟡 Should-Fix
- 无阻断级边界缺口。下列为已文档化偏差，不升格 Must：
  - 流式收敛 `text=` 暂用 `textContent`（implementation 偏差 3）：AC-12 文本收敛满足；Markdown 需后续 `messages/replace` 恢复。
  - 首 chunk 走 `messages/append`、后续 patch（偏差 2）：身份仍稳定；符合「有节点可 patch」需要。

### 🟢 Observations
- I-真链路完整：`action/stop` → Host → bridge → Cordis `sdkSessionCancel` → `Agent.cancel(..., { keepInbox: true })`；agent-loop 工作树无改动。
- Cancel 超时钉死 5000ms、无重试，与 dispose 镜像；失败只 banner，不清 incomplete（AC-13d）。
- 本审查环境层 A jsdom worker 因 `ERR_REQUIRE_ESM`（html-encoding-sniffer）无法拉起——同症影响 phase-1 `foundation-render-probe`，属环境/依赖问题；层 B + ide-bridge 本机复跑 **23 passed**。源码级核对层 A 断言与 `patchMessageDom`/`decideFollowState` 实现一致。
- AC-11 文案为 `Generating…`（phase-1 既有 chrome），语义等同「生成中」指示；无 thinking UI。
- registry 变更可能在首 chunk 的 `setStatus(running)` 触发一次 `pushFullState`（整表重建一次）；后续增量仍为 patch，未用 replace 冒充 chunk。

## 检查重点对照
| 重点 | 结果 |
|------|:----:|
| assistant/chunk → messages/patch 真增量且身份稳定 | ✅ |
| I-真 cancel 全链路到 Agent.cancel | ✅ |
| incomplete 认 live aborted（非仅 hydrate） | ✅ |
| fail-closed AC-13d | ✅ |
| follow 边界 P2-2（cancel/断连不强制重置） | ✅ |
| 无 thinking 泄露 | ✅ |
| 无未登记桩；未改 agent-loop | ✅ |
