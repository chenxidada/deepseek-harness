# 设计一致性审查 — phase-1-auto-start-orchestrator（Should-Fix #2/#3 复审）

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## 本轮范围说明

本轮仅关闭合并审查 Should-Fix **#2**（AC-13 connecting 专用 L2）与 **#3**（`deleteHistory` unbound / bound+offline 双 L2）。产品路径未改（`extension.ts` / `connection-ui.ts` / `chat-panel/*` 无本轮 diff）。Should-Fix **#1**（活动栏生产信号）与 **#4**（Webview Continue 旁路）仍开——按本轮任务约定**可接受**，不升格门禁。

## 测试补强 vs AD-CR

| 补强项 | 相关 AD-CR / AC | 是否违反 | 证据 | 判定 |
|--------|-----------------|:--------:|------|:--:|
| #2 AC-13 mid-flight `connectionPhase==='connecting'` | AD-CR-4 投影缝；AD-CR-10 L2 可观测；AC-13 | **否** | `dsh.test.requestStart` 挂起 `IdeSessionHost.start` → 读生产 `ChatPanelHost.getConnectionPhase()`；settle 后 `connected` + orchestrator `started`；**未**直接改 AutoReady latch | ✅ |
| #3 `deleteHistory` unbound | AD-CR-9 / AC-1e | **否** | 无 controller → 生产 `dsh.deleteHistory` → 提示「Host 连接后可删除」+ `start`=0 + idle；不调 Orchestrator | ✅ |
| #3 `deleteHistory` bound+host-offline | AD-CR-9 / AC-1e | **否** | 首启后断线、retry 挂起保持绑定 → `deleteSession`→`host-not-ready` 同文案；delete 前后 `start` 调用数不增 | ✅ |
| 可观测钩子 `getChatPanelHost` / `getConversationController` | AD-CR-10 | **否** | 只读导出，断言生产投影/绑定态；非 `dsh.test.*` 生产 contributes；门闩仍 `shouldRegisterTestHooks` | ✅ |
| 文档 `project-test/SKILL.md` 用例说明 | AD-CR-10 验证分层 | **否** | 记录双 L2 + AC-13；不改变验证分层策略 | ✅ |

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CR-1** Orchestrator 纯逻辑 FSM；`StartHostPort` 注入 | 是（未回退） | 本轮无产品改动；AC-13 L2 经 `requestStart` 观察 FSM `starting`/`pending-start` | ✅ |
| **AD-CR-2** 触发边界；activate 不 Start | 是（偏差 2 / #1 仍开，可接受） | 本轮未扩活动栏生产信号；既有 L2 reveal+request 仍在 | ✅ |
| **AD-CR-3** 就绪与 Start 解耦 | 是（本 Phase 边界） | STUB-001 / DEBT-001 → phase-2 | ✅ |
| **AD-CR-4** 面板为主 + connecting 投影 | 是 | AC-13 L2 断言面板 `connectionPhase` 经 `applyConnectionState` 生产路径 | ✅ |
| **AD-CR-5** 无 workspace cwd 降级 | 是（未回退） | 本轮未触及 | ✅ |
| **AD-CR-9** 删除离线：提示或不建连/不假删 | 是（#3 加强证明） | unbound + bound+offline 两分支均提示且不增 `start` | ✅ |
| **AD-CR-10** 验证分层；禁 latch 冒充；test 门闩 | 是 | 新 L2 走生产命令/投影只读；未直接写 latch；`dsh.test.*` 仍门闩 | ✅ |
| **AD-CR-11 / AC-26** 不改 agent-loop | 是 | 变更仅 `phase1-auto-start.spec.ts` + SKILL 说明 | ✅ |
| **AC-25 / AD-CU-1** Webview 无 mode 权威 | 是（#4 旁路仍开，非本轮） | 本轮未改 Webview Continue 接线 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件/改动 | 所在目录 | 是否合理 | 说明 |
|-------------|----------|:--:|------|
| `phase1-auto-start.spec.ts`（新增用例） | `apps/vscode-dsh/tests/` | ✅ | Phase 1 L2 归属正确；未另起平行 harness |
| `project-test/SKILL.md` | `.cursor/skills/` | ✅ | 验证知识同步，非架构漂移 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| AC-13 用例名 | `…connectionPhase connecting` | 对齐 AC-13 / ConnectionPhase | ✅ |
| AC-1e 双分支 | `unbound` / `bound+host-offline` | 对齐 AD-CR-9 两失败面 | ✅ |
| `getConnectionPhase` | ChatPanelHost 只读 accessor | design 投影缝 + L2 约定 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块一件事 | ✅ | 测试补强未搅乱 Orchestrator / ConnectionUi / extension 职责 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 无 `packages/core` / agent-loop 改动 |
| §2.3 接口隔离 | 经明确接口 | ✅ | L2 经命令与公开只读钩子，未掏内部 latch |

## 关键发现

### 🔴 Must-Fix
（无）

已知桩/债（registry，不升格）：
- **STUB-001** `AutoReadyLatchSeam` → phase-2（🟡）
- **DEBT-001** Start 成功仍 restore/New → phase-2（🟡）

### 🟡 Should-Fix
（无 — #2/#3 已由正式 L2 关闭）

仍开但本轮约定可接受（非本轮门禁）：
- **#1** AC-1b 活动栏生产信号弱（偏差 2 / AD-CR-2）
- **#4** Webview `action/continue` 未走 `ensureHostForSend`（命令分类完备性，非 AD-CR-9）

### 🟢 Observations
- **bound+offline** 用 `hostRef.status = 'disconnected'` + 第二次 `start` 挂起模拟断线重试飞行中：属 Host 断线注入，**不是** AD-CR-10 禁止的「直接改 latch 冒充可见性接线」。
- AC-13 读生产 `connectionPhase`，比仅断言 orchestrator 态更贴 AD-CR-4「面板投影」意图。
- 上一轮 AD-CR-9 产品对称性结论仍成立；本轮仅把第二分支拆成独立 L2 证据。

## 详细报告
- 对照：`design.md` AD-CR-1/2/4/9/10/11；`spec.md` AC-13 / AC-1e；`implementation.md`（#2/#3 关闭说明）；`constitution.md` §2
- 代码抽查：`phase1-auto-start.spec.ts` 新增三用例；`ChatPanelHost.getConnectionPhase`；`shouldRegisterTestHooks`
- 归档：`.archive/review-design-20260908T115602Z.md`（及 zh）
