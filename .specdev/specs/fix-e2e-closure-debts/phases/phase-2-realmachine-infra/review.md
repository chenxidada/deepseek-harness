# Phase 2 审查报告（合并）— DEBT-14 增量修复轮

## 判决：SHOULD-FIX

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | SHOULD-FIX | DEBT-14 修复代码真实有效（纯 test hook、门控、无桩、registry 一致），但真机证据是 `openTabSet:0` 的隔离单跑，未复现根因失败路径，`newConversation` 重建分支端到端从未被执行 |
| 设计一致性 | reviewer-design | SHOULD-FIX | 修复落在 AC-1 授权范围、不违背冻结契约、与 DEBT-12 自洽；但 design.md 口径仍以「8 条债务」为准，未回填 DEBT-14 这条真机新暴露并已真修的债务 |
| 集成连通性 | reviewer-connectivity | PASS | 修复调用链端到端连通：`triggerAutoReady()` 单飞结算 restore + `newConversation` 重建 live Tab，`getActive()` 一致命中，与 DEBT-12 无时序竞争 |
| 视觉一致性 | reviewer-visual | N/A | `ui: false`，不涉及界面 |

## Must-Fix 汇总

（无）

## Should-Fix 汇总

1. **[correctness] 验证覆盖缺口**：DEBT-14 的真机证据是 `openTabSet:0` 隔离单跑（`restoreOpenTabSet` 走 empty 分支、不关闭 live Tab、`if (active.mode !== 'live')` 恒 false），`newConversation` 重建分支从未被执行。原始失败发生在全链 model 批（前序会话残留在 `openTabSet` 非空）。需在「含前序持久会话」场景复验，确认修复真正闭环。
2. **[design] design.md 口径漂移**：design.md「范围覆盖/架构摘要」仍以「8 条债务」为交付口径，未回填 DEBT-14 这条真机新暴露并已真修的债务，与 tech-debt-registry.md「已解决」记录不一致。

## 详细报告

- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
- [review-visual.md](./review-visual.md)

## 🟢 Observations（记录项，不计入判决）

（本轮无新增 Observation；上一轮 8 条 Observation 见归档 review-20260920T064749Z.md）
