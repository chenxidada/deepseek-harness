# 设计一致性审查 — Phase 3（phase-3-review-revert-replay）

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

> MUST-FIX 回炉后的再审。上轮 SHOULD-FIX（prune 未挂写路径、openTabSet/unreverted 保护不足）已闭合；AD-CCD-6 / N-4 生命周期与既有 AD 对齐。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-3 · 快照/审阅仅扩展本地；禁权威日志明文 | 是 | `change-index.ts` → `changes/<sessionId>/index.json`；payload/status 无 old/new 正文；revert `sanitizeReason` | ✅ |
| AD-CCD-6 / N-4 · 索引 Must；prune 后不伪造；删会话清目录 | 是 | settle → `persistChangeIndex`；冷启动 `restoreOpenTabSetBody` + `openFromHistory` 均 `hydrateChangeListsFromIndex`；get-diff prune → unavailable；删除路径清 attributor + SnapshotStore | ✅ |
| AD-CCD-6 · 写路径后 soft-budget prune | 是 | `settleChangeListProjection` 在持久化 index 后 best-effort `pruneChangeSnapshots`；失败不阻断 | ✅ |
| AD-CCD-6 · openTabSet / 内存 Tab 保留 unreverted blob | 是 | `openIds = registry ∪ openTabSet`；`isSessionProtected = open ∩ !fullyReverted`；保护会话排队尾 | ✅ |
| AD-CCD-6 · 字节预算 LRU：已 reverted 优先，再最旧 session | 是 | 非保护 → fullyReverted 优先 → mtime；默认 200 MiB | ✅ |
| AD-CCD-7 · 禁改 agent-loop；主落 vscode-dsh | 是 | 仅 `apps/vscode-dsh` | ✅ |
| AD-CCD-10 · 文档层 / workspace.fs；turn 倒序；后续确认 | 是 | 既有回炉前实现保持 | ✅ |
| N-3 / AC-17 · content hash ± isDirty | 是 | 无 mtime 唯一判定 | ✅ |
| AC-11 · mark-reviewed 不写盘 | 是 | 状态 + index only | ✅ |
| 附录 A.3 · 存储 / 预算 / 索引 | 是 | 布局与 200 MiB 软上限一致 | ✅ |
| Constitution §2.4 | 是（产品主路径） | 撤销经 VS Code FS/文档 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 / 改动 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `change/revert.ts` / `change-index.ts` | `src/change/` | ✅ | 符合产出清单与 A.3 |
| `pruneToBudget` 扩展 | `snapshot-store.ts` | ✅ | 生命周期策略在存储层 |
| `pruneChangeSnapshots` / settle 接线 | `conversation-controller.ts` | ✅ | openTabSet 语义属编排层 |
| phase3 测试 | `tests/` | ✅ | 冷启动 hydrate + prune 保护顺序 |

### 命名规范审查
| 符号 | 判定 |
|------|:----:|
| `change/*` 协议与 gate kinds | ✅ |
| `isSessionProtected` / `isSessionFullyReverted` / `byteBudgetSoft` | ✅ |

### Constitution §2 检查
| 条款 | 是否违反 | 说明 |
|------|:--:|------|
| §2.1–§2.3 | ✅ | 职责与依赖方向 |
| §2.4 Feature 专属 | ✅ | 无 agent-loop；快照本地；撤销经 VS Code |

## MUST-FIX / 上轮 Should-Fix 闭合核对

| 上轮发现 | 本轮证据 | 状态 |
|----------|----------|:----:|
| prune 未挂产品写路径 | settle → persist → best-effort prune | ✅ 已修 |
| openTabSet / unreverted 未保护 | `isSessionProtected` + 队尾；L2 断言 | ✅ 已修 |
| 冷启动未 hydrate（correctness） | `restoreOpenTabSetBody` 后 hydrate；L2 冷路径 | ✅ N-4/AC-22 对齐 |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- 保护为软保留（队尾），预算仍超时可删；与 200 MiB 软上限及上轮建议一致。
- Open 且 fullyReverted 不保护，符合「保留 unreverted」字面。
- 删会话清 ChangeStore 经 attributor，行为满足 AD-CCD-6。

## 范围焦点核对（本委托）

| 焦点 | 结论 |
|------|------|
| prune wiring | ✅ |
| openTabSet protection | ✅ |
| AD-CCD-6 | ✅ |
| 其余 AD / 模块 | ✅ 保持 |
