# Correctness Review — phase-1-auto-start-orchestrator（Must-Fix 回路后复审）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

上一轮 **AC-1e Must-Fix 已关闭**。无未注册桩；全部 Must AC 有可工作路径。残留为已知非阻塞边界（AC-1b 生产信号、AC-13 专用 L2），不挡回炉。

## 上一轮 Must-Fix 关闭确认

| 项 | 要求 | 本轮证据 | 状态 |
|----|------|---------|:----:|
| `dsh.deleteHistory` 离线提示 | 对齐「Host 连接后可删除」；不静默 | `extension.ts` `deleteHistorySession`：`conversations===undefined` 与 `deleteSession`→`host-not-ready` 均 `showErrorMessage('Host 连接后可删除')` | ✅ 关闭 |
| 不完整建连 | `IdeSessionHost.start` 调用=0 | L2 `AC-1e: offline deleteHistory…` spy `start`=0；orchestrator `idle` | ✅ |
| 不假删 | 无索引-only 删除假象 | 离线无 controller → `getConversationSnapshot().tabs===[]`；有 controller 时走 `deleteSession` 真路径或 `host-not-ready` 提示后返回 | ✅ |
| L2 覆盖 | 覆盖 History 删除入口 | `phase1-auto-start.spec.ts` 新用例；本地复跑 **13/13** 绿 | ✅ |
| 与 `deleteConversation` 对称 | 同文案策略 | `runDeleteActive` 与 `deleteHistorySession` 同款提示；README 矩阵已补 `dsh.deleteHistory` | ✅ |

未改菜单 `when` 禁用（与 `deleteConversation` 同策略：可点但明确提示）——符合 AC-1e「禁用**或**提示」。

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 活动栏/视图可见/启动·发送/状态栏 → 有凭据则 Start；已连复用 | `extension.ts` 可见性/`ensureHostForSend`/状态栏/`dsh.startSession`→`request`；`auto-start-orchestrator.ts` | ✅ | FSM `isConnected` 短路；多入口 `request`；L1 reuse |
| AC-1a | 仅激活不 Start / 不 restore·New / 不抢焦点 / 不堆空 Tab | `activate`；L2 `simulateStartupOnly` | ✅ | `start`=0、`hostCreateCount=0`、`idle`、无空 Tab（HG-2 四项） |
| AC-1b | 活动栏打开且 Conversation 未可见 → reveal | `onActivityBarOpened` + `revealConversationPanel`；L2 `openActivityBar` | ⚠️ | 逻辑+L2 证明 reveal+`request`；**生产无独立活动栏打开信号**（偏差 2 / 已知 Should-Fix） |
| AC-1c | 启动/发送触发；查询/删除不完整建连；README 矩阵 | 删除/openHistory 不调完整 `request`；README | ✅ | 离线删除/openHistory `start`=0；矩阵含 delete 离线文案 |
| AC-1d | 六态 FSM；断线离开 started；禁并行 Start | `auto-start-orchestrator.ts`；L1 | ✅ | 六态；pending 合流；generation 忽略迟到 settle |
| AC-1e | 离线删除禁用或提示；不建连；不静默失败 | `runDeleteActive` + **`deleteHistorySession`（本轮修复）** | ✅ | 两入口均提示「Host 连接后可删除」；双 L2；不 Start；不假删 |
| AC-2 | 失败可读+重试+设置深链；面板为主；状态栏可点 | `ConnectionUiController`；showPanel/settings；L2 | ✅ | missing-credentials → failed + phase + statusBar；非唯一 Toast |
| AC-5 | Host 单例 | `createStartHostPort` + FSM | ✅ | 已连短路；并发一次 start |
| AC-6a | 断线 → disconnected + retry≤1 | `onUnexpectedDisconnect`；L1 | ✅ | 首次 retry；二次不再 start |
| AC-7 切片 | L2 反向 + 凭据 + showPanel | `phase1-auto-start.spec.ts` | ✅ | 含 AC-1a / AC-1e×2 / AC-2 |
| AC-13 | Connecting 投影 | `mapSnapshot`→`applyConnectionState` | ✅ | 真实映射；缺专用 L2（Should-Fix） |
| AC-14 | 失败态说明+Retry+设置 | panel Retry/settings；L2 failed phase | ✅ | 代码+缺凭据路径 |
| AC-25 | Webview 不自持 mode/session 权威 | panel/state 跟 Host | ✅ | composer 仅 live 可发 |
| AC-26 | 不改 agent-loop | 变更面 `apps/vscode-dsh` | ✅ | 无 agent-loop 改动 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | `connection-ui.ts:AutoReadyLatchSeam.onVisibilityChanged` / `onHostReadyChanged` | ⚠️ Known | 仅 latch；`@STUB(phase-2-auto-ready-surface)`；本轮未改 |
| DEBT-001 | `extension.ts:createStartHostPort.start` restore/New | ⚠️ Known | Start 仍 bind restore/空则 New；目标 phase-2；本轮未改 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无 |

## 关键发现
### 🔴 Must-Fix
- （无）上一轮 AC-1e `deleteHistory` 静默失败 **已关闭**。

### 🟡 Should-Fix
- **AC-1b 生产活动栏信号不完整（偏差 2）** — `onActivityBarOpened` 仍主要由 `dsh.test.openActivityBar` 驱动；默认首视图可见性可部分覆盖，但「活动栏开、Conversation 仍不可见」生产 reveal 路径弱。本轮未改（implementer 标注非门禁）。
- **AC-13 缺专用 L2** — connecting 投影真实，无 starting 中 `getConnectionPhase()==='connecting'` 脚本断言。
- **`deleteHistory` 第二分支（controller 仍绑定但 Host 已断）缺独立 L2** — 代码已提示（`deleteSession`→`host-not-ready`→`showErrorMessage`）；L2 仅覆盖 `conversations===undefined` 主离线路径。建议补一条：绑 controller + `host.status≠connected` → 同文案且不假删。

### 🟢 Observations
- `deleteHistorySession` 缺 `sessionId` 现返回 `missing` + 信息提示（不再误标 `host-not-ready`）——边界更正确。
- Orchestrator / ConnectionUi 仍为真实 FSM/投影，非空壳；L1+L2 **13/13** 复跑通过。
- STUB-001 / DEBT-001 与 registry 一致，不重判。

## 测试覆盖摘要（关键路径）

| 路径 | 覆盖 | 充分？ |
|------|------|:--:|
| AC-1a 反向 | L2 | ✅ |
| FSM 并发 / retry / Stop-during-start / 缺凭据 | L1 | ✅ |
| 离线 `deleteConversation` | L2 | ✅ |
| 离线 `deleteHistory`（controller 未建） | L2 本轮新增 | ✅ |
| 离线 `deleteHistory`（controller 在、Host 断） | 代码有提示，无专用 L2 | ⚠️ |
| 缺凭据 → failed + showPanel + settings | L2 | ✅ |
| AC-1b reveal+request | L2 via test hook | ⚠️ 生产信号 |
| openHistory 不建连 | L2 | ✅ |
