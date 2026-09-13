# Design Consistency Review — Phase 5 (phase-5-fork-retry-branch)

> **复审**（MUST-FIX loop 1 后）· 焦点：AD-CUX-5/6、constitution §7、`emptySeed` 偏差、phase-6 越界

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CUX-5** 重试/编辑/分叉皆 fork @ 已关闭 turn；aborted 非法 | 是 | `resolveClosedTurnBoundary` 先验 closed/非 aborted；非法不传 SDK | ✅ |
| **AD-CUX-5 P-接续** retry/edit → `continue-switch`；父 **mode→replay** + E2 | 是 | `applyContinueSwitch`：`setMode(replay)` + `parentReadonlySessions` / `continueSealedSessions`；切 child；不 resume 父 id | ✅ |
| **AD-CUX-5 P-标明** branch → `branch-mark`；父 mode 不强制 replay | 是 | `applyBranchMark` 保留 `parentMode`；不写 E2 Sets | ✅ |
| **AD-CUX-5 boundary** turn/seq → 正常 `turn/end` | 是 | orchestrator 校验 open/aborted/invalid → `ForkReject` | ✅ |
| **AD-CUX-5 Continue ≠ fork** | 是 | `continueConversation` 仍 same-id resume；P-接续走 child | ✅ |
| **AD-CUX-5 无 prior 空前缀（loop 1）** | 是（可接受偏差） | turn=0：`emptySeed: true` → SDK `seed: []`；**禁止** omit=`tip`；与 prior-cut + `promptTab` 语义一致 | ✅ |
| **AD-CUX-5 UI 投影对齐 seed（loop 1）** | 是 | `projectMessagesForForkSeed`：`emptySeed`→`[]`；有 `seedMaxTurn`→`turn ≤ seedMaxTurn` | ✅ |
| **AD-CUX-6** 子 ChangeStore 空桶；不拷贝父 index；不 checkout | 是 | fork 路径不触碰 `changes` 拷贝；新 sessionId 天然空桶 | ✅ |
| **Bridge/SDK 三件套** | 是（语义等价） | Host → `session/fork` → `sdkSessionFork`；落地 `agents.create`+seed（偏差 1 仍适用）+ **`emptySeed` 互斥 `boundarySeq`** | ✅ |
| **§7.2** 决策态 Host / 呈现态可下放 | 是 | mode / E2 / 能否发送在 Host；探针只读镜像 | ✅ |
| **§7.3 / §7.4** 无 truncate；不改 agent-loop；fork≠Continue；无 thinking | 是 | 无同会话 truncate；未改 agent-loop；无 thinking UI | ✅ |
| **§7.3 范围 / phase-6** 搜索档 1+2 未越界 | 是 | 无 `searchSessions` / path→session 索引 / 搜索 UI 产品落地 | ✅ |
| **P2-1** 父 running 拒 fork | 是 | `parentTab.status === 'running'` → `parent-running` | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `fork/fork-orchestrator.ts` | `apps/vscode-dsh/src/fork/` | ✅ | `emptySeed` / `seedMaxTurn` / `projectMessagesForForkSeed` 留在纯辅助层 |
| `session-fork.ts` + `server.ts` | `packages/sdk/server/` | ✅ | `emptySeed` 进 SDK 选项与 tip 语义解耦，正确分层 |
| bridge `session/fork.emptySeed` | `packages/ide/ide-bridge/` | ✅ | types / validate 互斥校验与 cancel 同层 |
| controller 水合裁剪 | `conversation-controller.ts` | ✅ | apply* 使用 orchestrator 投影，副作用仍在 Host |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| `emptySeed` | bridge / SDK / `ForkResult` | 显式空 seed（非 tip） | ✅ |
| `seedMaxTurn` | Host 投影裁剪 | 与 prior/target turn 对齐 | ✅ |
| presentation / intent | 未改 | design `ForkResult` / `ForkRequest` | ✅ |

### Constitution §7 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §7.1 | 可脚本渲染 / 层 B Host | ✅ | 层 B fork 套件覆盖 emptySeed；非本复审新增层 A 缺口 |
| §7.2 | 决策态 Host | ✅ | E2 / mode / reject-send 仍 Host 权威 |
| §7.3 | 无档 3 / 无 thinking / 不改 agent-loop；搜索≤档1+2 属 phase-6 | ✅ | 本 Phase 未落地搜索产品 |
| §7.4 | fork=closed；Continue≠fork；禁 truncate | ✅ | emptySeed 仍先校验目标 closed turn；无 truncate |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 模块做一件事 | ✅ | orchestrator=映射/投影；SDK=seed；controller=Tab/E2 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | Host→bridge→sdk；未改 agent-loop |
| §2.3 接口隔离 | 明确接口 | ✅ | `emptySeed`⊥`boundarySeq` 双检（validate + server） |

## 复审专项：`emptySeed` 偏差是否可接受

| 维度 | 结论 |
|------|------|
| 与 AD-CUX-5 语义 | **可接受**。目标 turn 仍先验 closed；无 prior 时「空前缀 + child 重发」是 prior-cut 在 turn=0 的自然外延，不是 tip-fork，也不是同会话 truncate。 |
| 与 design 字面 | ForkRequest/ForkResult 未写 `emptySeed`；属 **传输/SDK 契约澄清**（omit boundary = tip）。`implementation.md` 偏差 4 已记录。 |
| 与 loop 0 偏差 2/3 | 一致：retry/edit = prior-cut（或空）+ `promptTab`；本轮把「空」从危险的 omit 改为显式 `emptySeed`。 |
| UI 投影 | loop 0 观察「MessageStore 全量拷父」已用 `projectMessagesForForkSeed` 对齐权威 seed → 设计一致性 **改善**。 |
| 升格 MUST-FIX？ | **否** — 不违背 AD-CUX-5/6 或 §7 硬约束。 |

## 未越界 phase-6

- 无搜索 UI、无 path→session 反查索引、无 `action/search-sessions`。
- 代码中 `firstUserPreview` 为既有历史索引字段，非本 Phase 新增档 2 产品路径。

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无强制代码项）可选：在 `design.md` Bridge / `ForkResult` 补一行 `emptySeed`（与 `boundarySeq` 互斥；omit≠空 seed），避免下游再误用 tip-fork。

### 🟢 Observations
- `emptySeed` 贯通 Host → bridge validate → SDK `forkSeedFromParent`，契约闭合。
- 先前「投影与 seed 可短期不一致」观察已在本轮消除。
- SDK 仍用 `agents.create`+seed（偏差 1）；与 web Remote 同模式，继续可接受。

## 详细对照路径
- design: `.specdev/specs/vscode-dsh-chat-ux/design.md`（AD-CUX-5/6）
- constitution: `.specdev/specs/vscode-dsh-chat-ux/constitution.md`（§7）
- spec / impl / exploration: `.specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/{spec,implementation,repo-exploration}.md`
- 前轮归档: `.specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/.archive/review-design-20260911T025027Z.md`
