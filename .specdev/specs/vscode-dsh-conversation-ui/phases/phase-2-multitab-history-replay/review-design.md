# Design Consistency Review — phase-2-multitab-history-replay（MUST-FIX loop 1 复审）

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 复审焦点：AC-63 / AD-CU-4

| 设计约束 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-4 / AC-63：历史列表可独立于 Host 展示索引 | 是 | `resolveWorkspaceIndex()`：`conversations` 未绑定时 `new ExtensionIndex(workspaceKey, workspaceState)` 冷读；TreeView `getRows`、`dsh.test.listHistory`、`dsh.test.getIndex` 均走该路径 | ✅ |
| AD-CU-4：打开/重建正文仍需 Host + 权威日志 | 是 | `dsh.openHistory` 可先从冷索引选会话；无 Host 时明确报错，不再虚报 “History list is visible”；回放仍走 `openFromHistory` / hydrate | ✅ |
| AD-CU-4：索引非聊天正文权威 | 是 | 冷路径只读 `ExtensionIndex` / `listHistorySessions`；正文仍 hydrate，未把索引当消息库 | ✅ |
| 范围：本轮仅修 AC-63 接线，不越界 Continue / agent-loop | 是 | 变更限 `extension.ts` / `package.json` / phase2 测例 + skill 记录；无 `session/resume`、无 `interaction-queue.ts`、未改 agent-loop | ✅ |

## 架构决策对照（本 Phase 全量，含既有交付）

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-7：队列并入 `interaction-coordinator.ts` | 是 | 无 `interaction-queue.ts`；队列在 coordinator 内 | ✅ |
| AD-CU-2：ReplayHydrator 一次性全量折叠 | 是 | `replay-hydrator.ts` / `hydrateFromAuthoritativeLog` | ✅ |
| AD-CU-5：同 session 单开；历史一律 replay | 是 | registry + `openFromHistory` mode=replay | ✅ |
| AD-CU-8：`unknown` 列表不显示「可继续」 | 是 | `continueCapabilityListHint('unknown') === ''` | ✅ |
| AD-CU-12：不改 agent-loop；桥仅薄适配 | 是 | 本轮 diff 未触及 `packages/core/agent-loop` | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `resolveWorkspaceIndex` | `extension.ts` | ✅ | 扩展激活层编排「live vs 冷读」数据源，符合 Host 编排职责 |
| `history-view.ts` | `apps/vscode-dsh/src/` | ✅ | 仍只消费 `getRows` 回调，不感知 Host |
| `extension-index.ts` | `apps/vscode-dsh/src/` | ✅ | workspaceState 索引所有权未漂移 |
| `dsh.deleteHistory` | `package.json` + `extension.ts` | ✅ | 产品删除入口与测试钩子分离（先前 Should-Fix） |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 冷读解析 | `resolveWorkspaceIndex` | 动词 + 作用域清晰 | ✅ |
| 列表数据源 | `listHistoryFromIndex(resolveWorkspaceIndex())` | 与 AD-CU-4「索引驱动列表」一致 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块做一件事 | ✅ | Index 只索引；View 只渲染行；extension 只解析数据源 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 冷读仍是扩展 → workspaceState；未反向依赖 bridge/正文 |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | View 经 `getRows`；打开仍经 `requireConversations` / controller |

## 范围边界

| 约束 | 结果 |
|------|------|
| AC-63 列表不依赖 Host 绑定 | ✅ 已修复并有 L2 夹具 |
| 打开回放可要求 Host | ✅ 设计允许；文案区分列表 vs 打开 |
| 不做 GAP-001 Continue | ✅ 未越界 |
| 删除会话仍需 Host（AC-73：禁只清索引留权威） | ✅ `deleteHistorySession` 无 controller → `host-not-ready` |

## 关键发现
### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- MUST-FIX 根因是编排层把列表绑死在 `conversations`，而非 `history-view` / `ExtensionIndex` 设计错误；`resolveWorkspaceIndex` 把「列表可独立于 Host」接到产品与测试钩子上，与 AD-CU-4 一致。
- 无 Host 时每次冷读新建 `ExtensionIndex` 实例属可接受编排选择；同一 `workspaceState` 为真相源，不构成第二套正文库。
- 先前设计复审曾仅凭 `history-view` 模块标 AD-CU-4 ✅，忽略 extension 接线；本轮以端到端列表路径为准复审通过。
