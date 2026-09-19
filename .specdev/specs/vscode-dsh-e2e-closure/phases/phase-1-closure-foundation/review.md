# Phase 1 审查报告（合并）— phase-1-closure-foundation

## 判决：SHOULD-FIX

> 无 MUST-FIX。两处 SHOULD-FIX 均为 design.md 回填性质（非代码返工），一处 connectivity 低危项已登记技术债 DEBT-6 顺延 Phase 4。均不阻塞 verifier。

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | PASS | 5 项 AC 全过，fixture dry-run 11/11 分类 + 三元判定 4 场景 + mock host 退出码复验正确；skip/catch 分支均带 `closedLoop`；无桩 |
| 设计一致性 | reviewer-design | SHOULD-FIX | SF-1：design.md「默认 weak」与三态 `unknown` 矛盾；SF-2：设计修订记录空表，偏差 1/2 未补记。核心架构决策全部忠实落地 |
| 集成连通性 | reviewer-connectivity | SHOULD-FIX | 主链路（plan.artifactDir 双向、per-run journal、fail-closed、closureSummary、退出码映射）全连通；1 处低危：`activate()` 兜底路径孤儿文件 + reason 丢失 |
| 视觉一致性 | reviewer-visual | N/A | 本 Phase 无 UI 变更 |

## Must-Fix 汇总

无。

## Should-Fix 汇总

| # | 来源 | 内容 | 处置 |
|---|------|------|------|
| SF-1 | reviewer-design | design.md §核心实体 #1「分类失败默认 weak」与实现三态 `unknown` 矛盾 | ✅ 已就地回填 design.md（「默认 weak」→「判为 unknown」） |
| SF-2 | reviewer-design | design.md「设计修订记录」空表，偏差 1（extension.cjs planPath）、偏差 2（classifyAssertionStrength 返回 `{strength,reason}`）未补记 | ✅ 已就地补记修订记录 #1/#2 |
| SF-3 | reviewer-connectivity | `activate()` 兜底路径写 base 目录而 shell 只读 RUN_DIR → 孤儿文件 + reason 丢失（低危，fail-closed 未破、无假 PASS） | ✅ 已登记 DEBT-6（🟡非阻塞，目标 Phase 4） |

## 详细报告

- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
- [review-visual.md](./review-visual.md)
