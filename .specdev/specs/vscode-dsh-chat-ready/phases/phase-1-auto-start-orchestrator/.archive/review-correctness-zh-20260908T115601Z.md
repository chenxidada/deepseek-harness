# 正确性审查 — phase-1-auto-start-orchestrator（Must-Fix 回路后复审）

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**SHOULD-FIX**

上一轮 **AC-1e Must-Fix 已关闭**。无未注册桩；全部 Must AC 均有可工作路径。残留为已知非阻塞边界（AC-1b 生产信号、AC-13 专用 L2），不要求回炉。

## 上一轮 Must-Fix 关闭确认

| 项 | 要求 | 本轮证据 | 状态 |
|----|------|---------|:----:|
| `dsh.deleteHistory` 离线提示 | 对齐「Host 连接后可删除」；不静默 | `extension.ts` `deleteHistorySession`：无 controller 与 `host-not-ready` 均 `showErrorMessage('Host 连接后可删除')` | ✅ 关闭 |
| 不完整建连 | `start` 调用=0 | L2 spy `start`=0；orchestrator `idle` | ✅ |
| 不假删 | 无索引-only 假象 | 离线无 controller → tabs 为空；有 controller 走真删除或提示后返回 | ✅ |
| L2 覆盖 | History 删除入口 | 新用例；本地 **13/13** 绿 | ✅ |
| 与 `deleteConversation` 对称 | 同文案策略 | 两入口同款提示；README 已补 | ✅ |

未改菜单 `when` 禁用（与 `deleteConversation` 同策略）——符合「禁用**或**提示」。

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 多入口自动 Start；已连复用 | orchestrator + extension 接线 | ✅ | FSM 短路；多入口 `request` |
| AC-1a | 仅激活不 Start | activate + L2 反向 | ✅ | HG-2 四项断言 |
| AC-1b | 活动栏 → reveal | `onActivityBarOpened` + L2 | ⚠️ | 逻辑成立；生产信号弱（偏差 2） |
| AC-1c | 查询/删除不建连；README 矩阵 | 删除/openHistory 路径 + README | ✅ | `start`=0；矩阵完整 |
| AC-1d | 六态 FSM；禁并行 | orchestrator + L1 | ✅ | pending 合流；generation |
| AC-1e | 离线删除提示；不建连；不静默 | `runDeleteActive` + **`deleteHistorySession`** | ✅ | 双入口提示 + 双 L2 |
| AC-2 | 失败 UI + 设置深链 + 状态栏 | ConnectionUi + L2 | ✅ | failed 投影；非唯一 Toast |
| AC-5 | Host 单例 | createStartHostPort | ✅ | 并发一次 start |
| AC-6a | 断线 retry≤1 | onUnexpectedDisconnect | ✅ | L1 覆盖 |
| AC-7 切片 | L2 反向/凭据/showPanel | phase1-auto-start.spec.ts | ✅ | 含 AC-1e×2 |
| AC-13 | Connecting 投影 | mapSnapshot | ✅ | 缺专用 L2 |
| AC-14 | 失败说明+Retry+设置 | panel + L2 | ✅ | |
| AC-25 | Webview 无权威冲突 | panel/state | ✅ | |
| AC-26 | 不改 agent-loop | 变更面限 vscode-dsh | ✅ | |

## 桩代码检测

### 已注册桩
| Registry ID | 状态 | 说明 |
|-------------|:----:|------|
| STUB-001 | ⚠️ Known | AutoReady latch 仅更新字段；phase-2 |
| DEBT-001 | ⚠️ Known | Start 仍 bind restore/New；phase-2 |

### 新发现未注册桩
无。

## 关键发现
### 🔴 Must-Fix
- 无。上一轮 AC-1e 已关闭。

### 🟡 Should-Fix
- AC-1b 生产活动栏信号不完整（偏差 2）
- AC-13 缺专用 connecting L2
- `deleteHistory`「controller 在、Host 断」分支缺独立 L2（代码已提示）

### 🟢 Observations
- 缺 `sessionId` 现标 `missing`（不再误标 `host-not-ready`）
- 13/13 测试复跑通过；STUB/DEBT 与 registry 一致

## 测试覆盖摘要

| 路径 | 充分？ |
|------|:----:|
| 离线 `deleteConversation` / `deleteHistory`（无 controller） | ✅ |
| 离线 `deleteHistory`（controller 在、Host 断） | ⚠️ 无专用 L2 |
| AC-1a / FSM / 缺凭据 / openHistory | ✅ |
| AC-1b 生产信号 | ⚠️ |
