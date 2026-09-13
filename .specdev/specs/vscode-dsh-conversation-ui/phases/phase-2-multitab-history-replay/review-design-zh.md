# 设计一致性审查 — phase-2-multitab-history-replay（MUST-FIX loop 1 复审）

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 复审焦点：AC-63 / AD-CU-4

| 设计约束 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-4 / AC-63：历史列表可独立于 Host 展示索引 | 是 | `resolveWorkspaceIndex()`：未绑定 `conversations` 时从 `workspaceState` 冷读 `ExtensionIndex`；TreeView / `listHistory` / `getIndex` 均走该路径 | ✅ |
| AD-CU-4：打开/重建正文仍需 Host + 权威日志 | 是 | `openHistory` 可先从冷索引选会话；无 Host 明确报错，不再虚报列表可见；回放仍 hydrate | ✅ |
| AD-CU-4：索引非聊天正文权威 | 是 | 冷路径只列索引；正文仍走权威日志 | ✅ |
| 本轮仅修 AC-63，不越界 | 是 | 无 Continue / 无 `interaction-queue.ts` / 未改 agent-loop | ✅ |

## 架构决策对照（本 Phase 全量）

| design.md 决策 | 实现是否遵循 | 判定 |
|:---|:---|:--:|
| AD-CU-7 队列并入 coordinator | 是 | ✅ |
| AD-CU-2 ReplayHydrator 全量折叠 | 是 | ✅ |
| AD-CU-5 同 session 单开 / 历史 replay | 是 | ✅ |
| AD-CU-8 unknown 列表无「可继续」 | 是 | ✅ |
| AD-CU-12 不改 agent-loop | 是 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 文件 | 判定 | 说明 |
|------|:--:|------|
| `resolveWorkspaceIndex` @ `extension.ts` | ✅ | 激活层编排 live vs 冷读 |
| `history-view.ts` | ✅ | 仍只消费 `getRows`，不感知 Host |
| `extension-index.ts` | ✅ | workspaceState 索引所有权稳定 |
| `dsh.deleteHistory` | ✅ | 产品删除入口与测试钩子分离 |

### Constitution §2
| 条款 | 是否违反 | 说明 |
|------|:--:|------|
| §2.1 单一职责 | ✅ | Index / View / extension 职责清晰 |
| §2.2 依赖方向 | ✅ | 扩展 → workspaceState，无反向 |
| §2.3 接口隔离 | ✅ | View 经回调；打开经 controller |

## 范围边界

| 约束 | 结果 |
|------|------|
| 列表不依赖 Host | ✅ |
| 打开可要求 Host | ✅ |
| 不做 GAP-001 | ✅ |
| 删除仍需 Host（AC-73） | ✅ |

## 关键发现
### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- MUST-FIX 在编排接线，不在 Index/View 模块设计；`resolveWorkspaceIndex` 对齐 AD-CU-4。
- 无 Host 时每次新建 `ExtensionIndex` 可接受；`workspaceState` 仍是唯一真相源。
- 上一轮若只看 `history-view` 会漏判接线违规；本轮按端到端列表路径复审通过。
