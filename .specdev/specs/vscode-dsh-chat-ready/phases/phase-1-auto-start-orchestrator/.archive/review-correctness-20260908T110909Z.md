# Correctness Review — phase-1-auto-start-orchestrator

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**MUST-FIX**

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 活动栏/视图可见/启动·发送/状态栏 → 有凭据则 Start；已连复用 | `extension.ts` `handleConversationVisibility` / `ensureHostForSend` / `statusBarAction` / `dsh.startSession`→`request`；`auto-start-orchestrator.ts:request` | ✅ | FSM `isConnected` 短路不二次 `start`（L1）；可见性/命令/状态栏均 `request`；活动栏产品主路径依赖 `dsh.chat` 为首视图 + 可见性（见 AC-1b ⚠️） |
| AC-1a | 仅激活不 Start / 不 restore·New / 不抢焦点 / 不堆空 Tab | `extension.ts:activate`；L2 `dsh.test.simulateStartupOnly` | ✅ | activate 无 `request`/`start`；L2 断言 `IdeSessionHost.start` 调用=0、`hostCreateCount=0`、`startState=idle`、`tabs/openTabSet=0`（HG-2 四项） |
| AC-1b | 活动栏打开且 Conversation 未可见 → reveal | `onActivityBarOpened` + `revealConversationPanel`；L2 `dsh.test.openActivityBar` | ⚠️ | 逻辑与 L2 证明 reveal+`request('activity-bar')`；**生产无独立活动栏打开信号**，仅测钩/可见性/状态栏（偏差 2，非空壳） |
| AC-1c | 启动/发送触发；查询/删除不完整建连；README 矩阵 | `ensureHostForSend` vs `openHistory`/`runDeleteActive`/`deleteHistorySession`；`README.md` matrix | ✅ | openHistory L2 离线 `start`=0；删除路径不调 orchestrator；README 有矩阵 |
| AC-1d | 六态 FSM；断线离开 started；禁并行 Start | `auto-start-orchestrator.ts`；L1 并发/stop/retry | ✅ | 六态齐全；`pending-start` 合流；`generation` 忽略迟到 settle；L1 覆盖 |
| AC-1e | 离线删除禁用或提示「Host 连接后可删除」；不建连；不静默失败 | `runDeleteActive` ✅；`deleteHistorySession` ❌ | ❌ | `dsh.deleteConversation` 离线 `showErrorMessage('Host 连接后可删除')` 且 L2 覆盖；**`dsh.deleteHistory` 离线仅 `return { outcome: 'host-not-ready' }`，无提示、菜单未禁用 → 静默失败** |
| AC-2 | 失败可读原因+重试+设置深链；面板为主；不可见→状态栏可点；非唯一 Toast | `ConnectionUiController`；`dsh.showPanel`/`openExtensionSettings`/`statusBarAction`；L2 AC-2 | ✅ | missing-credentials → failed + phase + statusBar.show + showPanel/settings；`onError` Toast 仅为次要 |
| AC-5 | 不叠多个 Host；至多一条有效连接 | `createStartHostPort` 单例 `host` + FSM in-flight；L1 reuse | ✅ | 已连短路；并发一次 `start`；替换前 shutdown previous |
| AC-6a | 非 Stop 断线 → disconnected + 自动重试至多一次 | `onUnexpectedDisconnect` + `autoRetryUsed`；L1 | ✅ | 首次 `disconnect-retry`；二次保持 `disconnected` 且不再 `start` |
| AC-7 切片 | L2 反向 + 凭据开关 + showPanel | `phase1-auto-start.spec.ts` | ✅ | AC-1a / setCredentialPresence / showPanel 均有脚本证据 |
| AC-13 | 连接中 → Connecting 投影 | `ConnectionUiController.mapSnapshot` starting→connecting；`ChatPanelHost.applyConnectionState` | ✅ | 真实映射 + banner/`connectionPhase`；Webview `syncConnection` 显示 Connecting（缺专用 L2，见 Should-Fix） |
| AC-14 | 失败/手动重试态 → 失败说明+Retry+设置 | panel HTML Retry/Open settings；`requestRetryConnect`/`requestOpenSettings` | ✅ | failed 投影 + 按钮；L2 缺凭据路径验证 phase=failed |
| AC-25 | Webview 不自持 mode/session 权威 | `chat-panel-provider` 跟 `panel/state`；`sendPrompt` Host 门闸 | ✅ | mode 仅来自 Host 帧；composer 仅 `live` 可发 |
| AC-26 | 不改 agent-loop | 变更面限 `apps/vscode-dsh` | ✅ | 无 `packages/core/**/agent-loop*` 改动 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | `connection-ui.ts:AutoReadyLatchSeam.onVisibilityChanged` / `onHostReadyChanged` | ⚠️ Known | 仅更新 latch 字段；**不** New（AC-1a 安全）；`@STUB(phase-2-auto-ready-surface)` |
| DEBT-001 | `extension.ts:createStartHostPort.start` restore/New | ⚠️ Known | Start 成功仍 bind restore/空则 New；仅激活路径不触达（AC-1a 仍成立） |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无新增空壳冒充完成 |

## 关键发现
### 🔴 Must-Fix
- **AC-1e：`dsh.deleteHistory` 离线静默失败** — `extension.ts` `deleteHistorySession` 在 `conversations === undefined` 或 `deleteSession`→`host-not-ready` 时直接返回 `{ outcome: 'host-not-ready' }`，**不**调用 `showErrorMessage('Host 连接后可删除')`，`package.json` 菜单亦无 Host 就绪 `when` 禁用。与同文件 `runDeleteActive`、README 矩阵、AD-CR-9 不一致。L2 仅覆盖 `dsh.deleteConversation`，未覆盖 History 删除入口。
  - 修复建议：与 `runDeleteActive` 对齐提示（或禁用菜单 + 非静默反馈）；补 L2：离线 `dsh.deleteHistory` → 有提示/禁用、`IdeSessionHost.start` 调用=0、无假删。

### 🟡 Should-Fix
- **AC-1b 生产活动栏信号不完整（偏差 2）** — `onActivityBarOpened` 仅由 `dsh.test.openActivityBar` 调用；TreeView 可见性未挂钩。默认 `dsh.chat` 为首视图时多数「点开侧栏」会走可见性 Start，但「活动栏开、Conversation 仍不可见」无生产 reveal 路径。建议挂任意 `dsh.*` view 可见或文档化等价并加生产级钩。
- **AC-13 缺专用 L2** — connecting 投影代码路径真实，但无 starting 中读 `getConnectionPhase()==='connecting'` 的脚本断言（AC-7 切片未强制，回归风险）。
- **`deleteHistory` 在 conversations 仍绑定但 Host 已断时同样无 UI** — `deleteSession` 返回 `host-not-ready` 后命令处理函数未提示（与上条同一修复面）。

### 🟢 Observations
- Orchestrator / ConnectionUi 函数体为真实 FSM 与投影逻辑，非空壳；12 个 L1+L2 测试本地复跑通过。
- HG-2 `onUserStop` during starting → 最终 idle、无迟到回写：L1 覆盖且 `generation` 实现正确。
- `dsh.test.*` 已从 `package.json` contributes 移除，门闩 `shouldRegisterTestHooks` 符合 AD-CR-10。
- STUB-001 / DEBT-001 已登记且与代码一致；不重复判为新桩。

## 测试覆盖摘要（关键路径）

| 路径 | 覆盖 | 充分？ |
|------|------|:--:|
| AC-1a 反向（start=0 / idle / 无 Tab） | `phase1-auto-start.spec.ts` | ✅ |
| FSM 并发 / retry-once / Stop-during-start / 缺凭据 | `auto-start-orchestrator.spec.ts` | ✅ |
| 离线 `deleteConversation` | L2 | ✅ |
| 离线 `deleteHistory` | — | ❌ |
| 缺凭据 → failed + showPanel + settings | L2 | ✅ |
| AC-1b reveal+request | L2 via test hook | ⚠️ |
| openHistory 不建连 | L2 | ✅ |
| 无 workspace cwd 降级 | L2 | ✅ |
