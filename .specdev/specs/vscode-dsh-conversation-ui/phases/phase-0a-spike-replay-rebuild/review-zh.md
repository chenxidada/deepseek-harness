# Phase 0a 审查报告（合并）

## 判决：SHOULD-FIX

（合并规则：correctness=SHOULD-FIX，design=PASS，connectivity=PASS → **SHOULD-FIX** → 进入 verifier，不强制回炉 implementer）

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | SHOULD-FIX | Gate/AC 真冷读折叠通过；Timeline `.some` 断言偏弱；replace/null oldText 夹具缺口 |
| 设计一致性 | reviewer-design | PASS | Spike 无 UI 越界；读缝建议对齐 AD-CU-2；未改 agent-loop/SDK stdout |
| 集成连通性 | reviewer-connectivity | PASS | 写→flush→冷读→折叠→断言连通；Diff/不完整 turn 路径接通 |

## Must-Fix 汇总
无

## Should-Fix 汇总
1. Timeline step/tool 比对改为完整序列 oracle（非仅 `.some`）
2. 补 `surfaceOp: replace` 夹具
3. 补 `oldText: null`（可恢复新建）AC-76 夹具

（可记入债务或 phase-2 ReplayHydrator 强化；不阻塞本 Spike verifier）

## 详细报告
- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
