# 设计一致性审查 — phase-2-multitab-history-replay

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-7：队列并入 `interaction-coordinator.ts`，禁止 `interaction-queue.ts` | 是 | `interaction-coordinator.ts` 内含队列 / 软优先 / 切 Tab demote；仓库无 `interaction-queue.ts` | ✅ |
| AD-CU-7：全局串行 + 软优先 + 切 Tab `presented→pending` | 是 | 活动会话插队且不打断已弹；未作答 demote；切到含 pending 再唤起 | ✅ |
| AD-CU-7 状态机 | 是 | `pending → presented → resolved\|abort` | ✅ |
| AD-CU-2 / ReplayHydrator 一次性全量重建 | 是 | `hydrateFromAuthoritativeLog` → `messages.replace` + `timeline.replace` | ✅ |
| AD-CU-2 读日志缝 `session/read-log` | 是 | Host 客户端 + ide-bridge 薄帧 → cold read | ✅ |
| AD-CU-5 同 session 单开 / 新 tabId / 历史先 replay | 是 | registry 禁双开；`create(..., 'replay')`；已有则激活 | ✅ |
| AD-CU-8 列表 `unknown` 不显示「可继续」 | 是 | `continueCapabilityListHint` 对 unknown 返回空串；未做 Continue 产品 | ✅ |
| AD-CU-4 历史独立于 Host；索引非正文权威 | 是 | History TreeView 读索引；正文仍 hydrate | ✅ |
| AD-CU-12 不改 agent-loop；桥仅薄适配 | 是 | 变更限 vscode-dsh + ide-bridge | ✅ |
| Host 未连打开历史 | 本 Phase 允许的部分落地 | 说明文案 + `host-not-ready`；自动重建归 phase-3 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `replay-hydrator.ts` | `apps/vscode-dsh/src/` | ✅ | 符合产出计划 |
| `history-view.ts` | `apps/vscode-dsh/src/` | ✅ | 历史列表归属扩展 Host |
| 审批队列 | 并入 `interaction-coordinator.ts` | ✅ | 未另建 queue 文件 |
| `session/read-log` | `packages/ide/ide-bridge/` | ✅ | 允许的薄桥适配 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件名 | kebab-case | 仓库惯例 | ✅ |
| 折叠入口 | `hydrateFromAuthoritativeLog` | design 骨架 | ✅ |
| 能力暗示 | `continueCapabilityListHint` | AD-CU-8 解耦 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块做一件事 | ✅ | Hydrator / Index / Coordinator / Controller 职责清晰 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 未反向依赖 agent-loop |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | bridge / protocol / InteractionUi |

## 范围边界

| 约束 | 结果 |
|------|------|
| 不改 agent-loop | ✅ |
| 不做 GAP-001 Continue | ✅ |
| 禁止 `interaction-queue.ts` | ✅ |

## 关键发现
### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- ReplayHydrator 以模块函数交付，与 design 骨架一致。
- Host 未连历史打开仅说明、不做自动重建，符合本 Phase 排除项与偏差记录。
- `design.md` Spike Gate 仍写「NOT RUN」属文档漂移，非实现偏离。
