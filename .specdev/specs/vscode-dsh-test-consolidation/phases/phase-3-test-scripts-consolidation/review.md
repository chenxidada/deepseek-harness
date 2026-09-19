# Phase 3 审查报告（合并）

## 判决：SHOULD-FIX

> 已解决：S-1 / S-2 两个 SHOULD-FIX 已通过修改 design.md 关闭（R-1 数据模型补 `testScripts` + `scripts` 降级；R-2 回写 3 处漂移选侧决策），见 design.md「设计修订记录」。交付物层面无遗留缺陷，可进入验证。

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | PASS | 19 项镜像原语单定义、captureScreenshot 3 参统一、3 处漂移选 runner 侧留档、AC-19~AC-23 全满足 |
| 设计一致性 | reviewer-design | SHOULD-FIX | S-1 `testScripts` 与 `domains[].scripts` 双轨归属漂移；S-2 漂移选侧决策未回写 design.md 修订记录 |
| 集成连通性 | reviewer-connectivity | PASS | require 链可解析、解构面零缺失、AC-23 实跑 smoke=4/capabilities=0 与基线一致 |
| 视觉一致性 | reviewer-visual | N/A | 本 Phase `ui: false` 纯后端脚本去重，不适用 |

## Must-Fix 汇总

无。

## Should-Fix 汇总

- **S-1**（reviewer-design）：`testScripts` 与 `domains[].scripts` 双轨归属漂移 —— `layer-v-support/primitives.cjs` 在 `testScripts` 归 `test-harness`，但未同步加入 `test-harness` 域的 `scripts` 数组。证据：`apps/vscode-dsh/tests/capability-domains.json:30`（有） vs `:656-669`（无）。
- **S-2**（reviewer-design）：3 处语义漂移「选 runner 侧为真身」决策未回写 design.md 设计修订记录。证据：`design.md:236/240/249`（「需逐行比对」） vs `design.md:360-363`（修订记录为空）。

## 详细报告

- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
- [review-visual.md](./review-visual.md)
