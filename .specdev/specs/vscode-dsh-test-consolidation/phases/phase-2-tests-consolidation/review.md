# Phase 2 审查报告（合并）— phase-2-tests-consolidation

## 判决：PASS

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | SHOULD-FIX → 已落实 | 556 用例全绿、CAP 全树唯一、台账 556 双向差集为空；裸 AC 已清、.tmp 已删 |
| 设计一致性 | reviewer-design | SHOULD-FIX → 已落实 | 10 域/12 文件忠实执行；4 空目录已删 |
| 集成连通性 | reviewer-connectivity | PASS | 107 处 import 无悬空、fixture/helper 依赖闭合、entryAssertions 映射真实 src 入口 |
| 视觉一致性 | reviewer-visual | N/A | ui: false，本视角不适用 |

## Must-Fix 汇总

无。

## Should-Fix 汇总（原三项均已在回流中落实）

1. 🟡 **裸 AC 引用**：已由 implementer 清理（6 处 string literal），`grep -rnE 'AC-[0-9]'` 全树为空。
2. 🟡 **临时脚本 `apps/vscode-dsh/tests/.tmp-clean-ac.mjs`**：已删除。
3. 🟡 **4 空目录**（`verifier-phase1/`、`verifier-phase2/`、`layer-a/`、`layer-a-rtl/`）：已删除。

> 另：**AC-10 需求已修正**——移除「旧 AC 引用须带工作流限定（`AC[vscode-dsh-usable-loop]-n`）」这一错误设计，改为「`it`/`test` 标题与代码注释不得出现工作流需求文档的 `AC-<数字>` 编号，标题/注释按功能语义描述」。`requirements.md` / `requirements-zh.md` / `design.md` 已同步。

## 详细报告

- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
- [review-visual.md](./review-visual.md)
