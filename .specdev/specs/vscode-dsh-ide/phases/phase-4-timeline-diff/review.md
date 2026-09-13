# Phase 4 审查报告（合并）

## 判决：SHOULD-FIX

（合并规则：correctness=SHOULD-FIX，design=PASS，connectivity=PASS → **SHOULD-FIX**；无 MUST-FIX → 进入 verifier）

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | SHOULD-FIX | 主路径通；create-file 空 `meta.diffs` 无 args 回退；相对路径 Diff 未优先开 workspace 文件 |
| 设计一致性 | reviewer-design | PASS | AD-7 事后 Diff；扩展只投影 |
| 集成连通性 | reviewer-connectivity | PASS | prompt/时间线/Diff/subagent/多 Tab 隔离贯通 |

## Must-Fix 汇总
无

## Should-Fix 汇总
1. `write`/`edit` 在 `meta.diffs` 为空时，应从 tool/call args 合成 hunk（对齐 Web diff-card-model）
2. 相对路径 Diff 有 workspace 时应优先打开真实文件 URI

## 详细报告
- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
