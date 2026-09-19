# Phase 4 审查报告（合并）

## 判决：SHOULD-FIX

> 已解决：S-1 / S-2 / S-3 三条 SHOULD-FIX 已通过文档回写关闭（design.md 修订记录 R-3 jsx flag、R-4 oxlint 145 基线；implementation.md 补 D-4 no-deprecated 豁免偏差 + 修正误导引用）。交付物层面无遗留缺陷。

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | PASS | AC-13~18 独立复跑全通过；无 src 改动、断言无削弱、无未注册桩 |
| 设计一致性 | reviewer-design | SHOULD-FIX | 实现严格遵循硬约束；2 处真相源漂移未回写 design.md（jsx flag + oxlint 145 基线） |
| 集成连通性 | reviewer-connectivity | PASS | 4 条端到端路径连通；vitest 556 = entryAssertions 总和 556 |
| 视觉一致性 | reviewer-visual | N/A | `ui: false`，本视角不适用 |

## Must-Fix 汇总

无。

## Should-Fix 汇总

1. **S-1（reviewer-design）**：`tests/tsconfig.json` 补 `jsx: react-jsx`（复用 `webview/tsconfig.json:7` 既有值，消除 35 条 TS17004 假错误，glob 覆盖 `.tsx` 的必要前置）属合理补全，但未回写 design.md 修订记录。
2. **S-2（reviewer-design）**：oxlint glob 化真实起点 145（非 design.md §决策 5 / §架构摘要字面写的「203」），已在 implementation.md D-2 留档，但 design.md 未回写。
3. **S-3（reviewer-correctness）**：25 处 `no-deprecated`（`buildThinChatHtml`）用行级豁免替代 design.md 步骤 4 的「替换为 `buildEditorChatSpaHtml`」；豁免本身不削弱断言、符合仓库窄豁免惯例，但属未记录的方案偏差，需补记 D-4 并修正 implementation.md 中「见 design.md 决策」的误导引用。

## 详细报告

- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
- [review-visual.md](./review-visual.md)
