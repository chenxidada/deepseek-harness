# 正确性审查 — phase-1-auto-start-orchestrator（Should-Fix #2/#3 补测后）

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**SHOULD-FIX**

本轮重点：**Should-Fix #2（AC-13 connecting L2）与 #3（deleteHistory 双分支独立 L2）均已关闭**。无未注册桩；全部 Must AC 有可工作路径。残留 **#1（AC-1b 生产活动栏信号）** 仍为已知非阻塞边界（本轮按约定未关，不升 Must）。#4 Continue 旁路属连通性视角，本报告不升 Must。

## 本轮重点关闭确认

| # | 项 | 要求 | 本轮证据 | 状态 |
|---|----|------|---------|:----:|
| 2 | AC-13 mid-flight connecting | 正式 L2：Host `start` 挂起时 `getConnectionPhase()==='connecting'` | `phase1-auto-start.spec.ts` 对应用例：`startGate` 挂起 → `connecting` + orch ∈ `{starting,pending-start}` → release → `connected` + `started` | ✅ 关闭 |
| 3a | `deleteHistory` unbound | 无 controller → 提示 + 不 Start | 独立用例：controller `undefined` → `host-not-ready` →「Host 连接后可删除」→ `start`=0 | ✅ 关闭 |
| 3b | `deleteHistory` bound+offline | controller 仍绑、Host 断 → 提示 + 不 Start | 独立用例：绑 controller 后断线；delete 前后 `start` 不增；同文案 | ✅ 关闭 |

本地复跑：**15/15 passed**。

## 逐条 AC 验证
| AC | 描述 | 判定 | 证据要点 |
|----|------|:--:|---------|
| AC-1 | 多入口自动 Start；已连复用 | ✅ | FSM + 多入口 `request` |
| AC-1a | 仅激活不 Start | ✅ | HG-2 四项 L2 |
| AC-1b | 活动栏 → reveal | ⚠️ | L2 通；生产信号弱（#1 仍开） |
| AC-1c | 查询/删除不完整建连 | ✅ | openHistory/删除 `start`=0 |
| AC-1d | 六态 FSM / 禁并行 | ✅ | L1 |
| AC-1e | 离线删除提示、不建连 | ✅ | unbound + bound+offline 双 L2 |
| AC-2 | 失败 UI + showPanel + 设置 | ✅ | L2 |
| AC-5 | Host 单例 | ✅ | 短路 + 并发一次 start |
| AC-6a | 断线重试≤1 | ✅ | L1 |
| AC-7 切片 | L2 反向/凭据/showPanel | ✅ | 含 AC-13 |
| AC-13 | Connecting 投影 | ✅ | **正式 mid-flight L2** |
| AC-14 | 失败态投影 | ✅ | 代码 + L2 |
| AC-25 / AC-26 | Webview 权威 / 不改 loop | ✅ | 跟 panel/state；无 agent-loop 改动 |

## 桩检测
- **已注册**：STUB-001、DEBT-001（Known，目标 phase-2）
- **新未注册桩**：无

## 关键发现
### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- **#1 AC-1b 生产活动栏信号不完整** — 仍开；不升 Must。
- ~~#2 AC-13 connecting L2~~ — **已关闭**。
- ~~#3 deleteHistory 双分支 L2~~ — **已关闭**。

### 🟢 Observations
- AC-13：`onChange` → `mapSnapshot(starting|pending-start→connecting)` → `getConnectionPhase`；L2 用门控卡住 mid-flight。
- AC-1e bound+offline：第二次 `start` 永不 settle，隔离第二分支。
- 本轮仅测补强；15 绿。
