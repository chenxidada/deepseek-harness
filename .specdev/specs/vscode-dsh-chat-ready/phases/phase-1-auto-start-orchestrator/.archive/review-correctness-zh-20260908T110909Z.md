# 正确性审查 — phase-1-auto-start-orchestrator

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**MUST-FIX**

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 活动栏/视图可见/启动·发送/状态栏 → 有凭据则 Start；已连复用 | `extension.ts` 可见性/`ensureHostForSend`/状态栏/`startSession`；`auto-start-orchestrator.ts:request` | ✅ | 已连短路不二次 `start`（L1）；各入口均 `request`；活动栏主路径依赖首视图可见性（见 AC-1b ⚠️） |
| AC-1a | 仅激活不 Start / 不 restore·New / 不抢焦点 / 不堆空 Tab | `activate`；L2 `simulateStartupOnly` | ✅ | 无 `request`/`start`；L2 满足 HG-2：`start`=0、`hostCreateCount=0`、idle、无空 Tab |
| AC-1b | 活动栏打开且 Conversation 未可见 → reveal | `onActivityBarOpened` + `revealConversationPanel`；L2 `openActivityBar` | ⚠️ | 逻辑与 L2 成立；生产无独立活动栏信号（偏差 2） |
| AC-1c | 启动/发送触发；查询/删除不建连；README 矩阵 | 命令分支 + README | ✅ | openHistory L2 `start`=0；删除不调 orchestrator；矩阵已写 |
| AC-1d | 六态 FSM；断线离开 started；禁并行 | orchestrator + L1 | ✅ | 六态、pending 合流、`generation` 防迟到回写 |
| AC-1e | 离线删除禁用或提示；不建连；不静默失败 | `runDeleteActive` ✅；`deleteHistorySession` ❌ | ❌ | Conversation 删除有中文提示+L2；**History 删除离线静默返回 host-not-ready** |
| AC-2 | 失败原因+重试+设置；面板为主；状态栏可点 | ConnectionUi + 命令 + L2 | ✅ | failed 投影、statusBar、showPanel/settings |
| AC-5 | 至多一条有效 Host | 单例 host + in-flight | ✅ | 并发一次 start；替换前 shutdown |
| AC-6a | 断线自动重试至多一次 | `onUnexpectedDisconnect` + L1 | ✅ | 一次 disconnect-retry，再断保持 disconnected |
| AC-7 切片 | L2 反向+凭据+showPanel | phase1 L2 | ✅ | 已覆盖 |
| AC-13 | Connecting 投影 | ConnectionUi → panel | ✅ | 映射真实；缺专用 L2 |
| AC-14 | 失败说明+Retry+设置 | panel 按钮 + Host 动作 | ✅ | 与 AC-2 路径一致 |
| AC-25 | Webview 不自持权威 | panel/state + Host 门闸 | ✅ | mode 仅跟 Host |
| AC-26 | 不改 agent-loop | 变更限 vscode-dsh | ✅ | 无 core agent-loop 改动 |

## 桩代码检测

### 已注册桩
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | `AutoReadyLatchSeam` | ⚠️ Known | 只记可见性/就绪，不 New |
| DEBT-001 | Start 成功路径 restore/New | ⚠️ Known | 绑在 Start；仅激活不触达 |

### 新发现未注册桩
无。

## 关键发现
### 🔴 Must-Fix
- **AC-1e：`dsh.deleteHistory` 离线静默失败** — 无「Host 连接后可删除」提示、菜单未禁用；与 `deleteConversation` / README / AD-CR-9 不一致。需对齐提示或禁用，并补 L2。

### 🟡 Should-Fix
- AC-1b 生产活动栏信号不完整（偏差 2）
- AC-13 缺 starting→connecting 专用 L2
- Host 已断但 conversations 仍绑定时 `deleteHistory` 同样无 UI 反馈

### 🟢 Observations
- Orchestrator/ConnectionUi 为真实逻辑；12 项 L1+L2 复跑通过
- HG-2 onUserStop 飞行态处理正确
- test 钩子门闩符合 AD-CR-10；已知 STUB/DEBT 不重复计

## 测试覆盖摘要

| 路径 | 充分？ |
|------|:--:|
| AC-1a 反向 | ✅ |
| FSM 并发/retry/Stop/缺凭据 | ✅ |
| 离线 deleteConversation | ✅ |
| 离线 deleteHistory | ❌ |
| 缺凭据 + showPanel | ✅ |
| AC-1b（测钩） | ⚠️ |
| openHistory 不建连 / 无 workspace | ✅ |
