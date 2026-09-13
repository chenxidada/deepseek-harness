# Phase 3 审查报告（合并）

## 判决：SHOULD-FIX

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|------|----------|:----:|--------|
| 实现正确性 | reviewer-correctness | PASS | 对话内 activity 真实投影；cancel→aborted；回放重建+禁发；GAP-CUX-001 已关；无新桩 |
| 设计一致性 | reviewer-design | PASS | 呈现/决策边界、activity-dom 层 A、状态机、未越界 phase-4/5 均符合 AD |
| 集成连通性 | reviewer-connectivity | PASS* | 六条关键路径接通；*报告内含测试覆盖 SHOULD-FIX（非断链） |

\* connectivity 正文判决为 PASS，但列出测试覆盖类 Should-Fix → 合并抬升为 **SHOULD-FIX**（不回炉 implementer，进入 verifier）。

## Must-Fix 汇总

（无）

## Should-Fix 汇总

1. 层 B 宜补 Host 出站 `messages/patch.activityStatus` 断言
2. AC-28 宜将 hydrate → `pushFullState` 打成一条集成断言（代码路径已连通）

## 详细报告
- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
