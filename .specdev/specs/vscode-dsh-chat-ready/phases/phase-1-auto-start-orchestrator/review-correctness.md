# Correctness Review — phase-1-auto-start-orchestrator（Should-Fix #2/#3 补测后）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

本轮重点 **Should-Fix #2（AC-13 connecting L2）与 #3（deleteHistory 双分支独立 L2）均已关闭**。无未注册桩；全部 Must AC 有可工作路径。残留 **#1（AC-1b 生产活动栏信号）** 仍为已知非阻塞边界（本轮按约定未关，不升 Must）。#4 Continue 旁路属连通性视角，本报告不升 Must。

## 本轮重点关闭确认

| # | 项 | 要求 | 本轮证据 | 状态 |
|---|----|------|---------|:----:|
| 2 | AC-13 mid-flight connecting | 正式 L2：Host `start` 挂起时 `getConnectionPhase()==='connecting'` | `phase1-auto-start.spec.ts` `AC-13: Host starting projects panel connectionPhase connecting`：`startGate` 挂起 → `waitFor(phase==='connecting')` + orch ∈ `{starting,pending-start}` → release → `connected` + `started` | ✅ 关闭 |
| 3a | `deleteHistory` unbound | 无 controller → 提示 + 不 Start | 独立用例：`getConversationController()===undefined` → `outcome==='host-not-ready'` → 文案含「Host 连接后可删除」→ `start`=0 / orch `idle` | ✅ 关闭 |
| 3b | `deleteHistory` bound+offline | controller 仍绑、Host 断 → 提示 + 不 Start | 独立用例：首启绑 controller → `status='disconnected'` → disconnect-retry 挂起保绑定 → delete 前后 `start` 调用数不增 → 同文案 + `host-not-ready` | ✅ 关闭 |

本地复跑：`vitest run …/auto-start-orchestrator.spec.ts …/phase1-auto-start.spec.ts` → **15/15 passed**。

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 活动栏/视图可见/启动·发送/状态栏 → 有凭据则 Start；已连复用 | `extension.ts` + `auto-start-orchestrator.ts` | ✅ | 多入口 `request`；已连短路；L1 reuse |
| AC-1a | 仅激活不 Start / 不 restore·New / 不抢焦点 / 不堆空 Tab | `activate`；L2 `simulateStartupOnly` | ✅ | `start`=0、`hostCreateCount=0`、`idle`、无空 Tab（HG-2 四项） |
| AC-1b | 活动栏打开且 Conversation 未可见 → reveal | `onActivityBarOpened` + `revealConversationPanel`；L2 `openActivityBar` | ⚠️ | 逻辑+L2 证明 reveal+`request`；**生产无独立活动栏打开信号**（偏差 2 / Should-Fix #1 仍开） |
| AC-1c | 启动/发送触发；查询/删除不完整建连；README 矩阵 | 删除/openHistory 不调完整 `request` | ✅ | 离线删除/openHistory `start`=0 |
| AC-1d | 六态 FSM；断线离开 started；禁并行 Start | `auto-start-orchestrator.ts`；L1 | ✅ | 六态；pending 合流；generation 忽略迟到 settle |
| AC-1e | 离线删除禁用或提示；不建连；不静默失败 | `runDeleteActive` + `deleteHistorySession` | ✅ | unbound + bound+offline **两条独立 L2**；提示「Host 连接后可删除」；不 Start；不假删 |
| AC-2 | 失败可读+重试+设置深链；面板为主；状态栏可点 | `ConnectionUiController`；L2 | ✅ | missing-credentials → failed + phase + statusBar；非唯一 Toast |
| AC-5 | Host 单例 | `createStartHostPort` + FSM | ✅ | 已连短路；并发一次 start |
| AC-6a | 断线 → disconnected + retry≤1 | `onUnexpectedDisconnect`；L1 | ✅ | 首次 retry；二次不再 start |
| AC-7 切片 | L2 反向 + 凭据 + showPanel | `phase1-auto-start.spec.ts` | ✅ | AC-1a / AC-1e×3 / AC-2 / AC-13 |
| AC-13 | Connecting 投影 | `mapSnapshot`→`applyConnectionState` + **正式 L2** | ✅ | `starting`/`pending-start`→`connecting`；mid-flight L2 断言 `getConnectionPhase()==='connecting'` |
| AC-14 | 失败态说明+Retry+设置 | panel Retry/settings；L2 failed phase | ✅ | 代码+缺凭据路径 |
| AC-25 | Webview 不自持 mode/session 权威 | panel/state 跟 Host | ✅ | composer 仅 live 可发 |
| AC-26 | 不改 agent-loop | 变更面 `apps/vscode-dsh` | ✅ | 无 agent-loop 改动 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | `connection-ui.ts:AutoReadyLatchSeam.onVisibilityChanged` / `onHostReadyChanged` | ⚠️ Known | 仅 latch；目标 phase-2；本轮未改 |
| DEBT-001 | `extension.ts:createStartHostPort.start` restore/New | ⚠️ Known | Start 仍 bind restore/空则 New；目标 phase-2；本轮未改 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无 |

## 关键发现
### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- **#1 AC-1b 生产活动栏信号不完整（偏差 2）** — `onActivityBarOpened` 仍主要由 `dsh.test.openActivityBar` 驱动；默认首视图可见性可部分覆盖，但「活动栏开、Conversation 仍不可见」生产 reveal 路径弱。本轮按约定未做，**不升 Must**。
- ~~#2 AC-13 connecting 专用 L2~~ — **已关闭**（见上表）。
- ~~#3 `deleteHistory` unbound / bound+offline 独立 L2~~ — **已关闭**（见上表）。

### 🟢 Observations
- AC-13 产品路径真实：`orchestrator.onChange` → `projectOrchestrator` → `mapSnapshot(starting|pending-start→connecting)` → `panel.applyConnectionState` → `getConnectionPhase()`；L2 用 `startGate` 卡住 mid-flight，非仅终态断言。
- AC-1e bound+offline 用例用「第二次 `start` 永不 settle」保持 disconnect-retry 飞行中、controller 不卸——正确隔离第二分支，避免退化为 unbound。
- STUB-001 / DEBT-001 与 registry 一致，不重判。
- 本轮仅测补强，未改产品逻辑；15 用例绿。

## 测试覆盖摘要（关键路径）

| 路径 | 覆盖 | 充分？ |
|------|------|:--:|
| AC-1a 反向 | L2 | ✅ |
| FSM 并发 / retry / Stop-during-start / 缺凭据 | L1 | ✅ |
| 离线 `deleteConversation` | L2 | ✅ |
| 离线 `deleteHistory` unbound（无 controller） | L2 | ✅ |
| 离线 `deleteHistory` bound+host-offline | L2 **本轮新增** | ✅ |
| AC-13 mid-flight `connecting` | L2 **本轮新增** | ✅ |
| 缺凭据 → failed + showPanel + settings | L2 | ✅ |
| AC-1b reveal+request | L2 via test hook | ⚠️ 生产信号 |
| openHistory 不建连 | L2 | ✅ |
