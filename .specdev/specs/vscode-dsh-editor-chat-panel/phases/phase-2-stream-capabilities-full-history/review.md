# Phase 2 审查报告（合并 · Q-6 Tab 右键删除后）

> phase-id: `phase-2-stream-capabilities-full-history`
> 合并时间: 2026-09-13
> 规则：任一 MUST-FIX → 整体 MUST-FIX；否则取最高严重度

## 判决：SHOULD-FIX

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | **SHOULD-FIX** | Q-6 右键删除已实装且共用 modal；缺非活动 Tab 双入口 RTL |
| 设计一致性 | reviewer-design | **PASS** | AD-ECP-6 单路径；右键+溢出密度一致 |
| 集成连通性 | reviewer-connectivity | **PASS** | contextmenu → modal → `ui/delete-request` → Host 全通；非活动 `sessionId` 经 `panel/tabs` |

## Must-Fix 汇总
（无）

## Should-Fix 汇总
1. RTL 补双 Tab 用例：右键**非活动** Tab → modal → 确认后 `ui/delete-request` 的 `sessionId` 为非活动会话（非仅静态路径证明）。

## 详细报告
- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
