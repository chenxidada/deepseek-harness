# Phase 3 审查报告（合并）— phase-3-drive-model

## 判决：SHOULD-FIX

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | PASS | AC-9/10/6/11/15 全满足；19 项真实 LLM 往返闭环 + 2 项 subagent 注入如实标 AC-9 不满足（DEBT-10）+ 2 项未闭环（DEBT-2/3）；fail-closed 反向真实；无桩、无误改 |
| 设计一致性 | reviewer-design | SHOULD-FIX | 核心决策全遵循，4 处文档修正：spec.md AC-11 残留过期表述、design.md 未回写 DEBT-9/10、DEBT-9 目标Phase 误标、DEBT-2/3 目标Phase 指向 phantom phase-5 |
| 集成连通性 | reviewer-connectivity | PASS | key 链路（.env→host 真实 LLM→`$assistantContains` 命中）连通；fail-closed 反向真实（exit 3 零命令）；23 项结论一致 |
| 视觉一致性 | reviewer-visual | N/A | 本 Phase `ui:false`，无产品 UI 变更 |

## Should-Fix 汇总

| # | 来源视角 | 内容 | 处置 |
|---|---------|------|------|
| SF-1 | reviewer-design | spec.md AC-11 验证策略行残留过期「react-spa-main 模型能力 + `$titleContains`」 | ✅ 已处理：改为实际覆盖（history 组 + 流式末块断言） |
| SF-2 | reviewer-design | design.md 未回写 Phase 3 新增事实（DEBT-9/DEBT-10 + subagent 核实结论） | ✅ 已处理：design.md §设计修订记录追加第 4/5 条 + §能力分批表 subagent 行更新为已核实结论 |
| SF-3 | reviewer-design | DEBT-9（产品 bug）目标Phase 误标 phase-4，与「不在本 feature 修复产品 bug」边界不一致 | ✅ 已处理：改为「后续 feature（修复 selection-ask 防泄漏误报）」 |
| SF-4 | reviewer-design | DEBT-2/3 目标Phase 指向 DAG 不存在的 phase-5 | ✅ 已处理：改为 phase-4-orchestration-regression |

## Must-Fix 汇总

（无）

## 文档保真观察（🟢 Observations，不参与判决）

- correctness 记录 2 条措辞观察（manifest「2 行」口径、`shot` vs `realScreenshot` 易混淆），均未掩盖真实缺陷。
- connectivity 记录 3 条观察（凭证门控信任 `plan.hasCredential`、subagent 注入非真实往返、DEBT-2/3 为真实缺口），均已对应登记。
- design 记录 1 条（repo-exploration.md:155 note 因 spec 已修正而 stale，属上游输入，Phase 4 收尾顺带清理）。

## 详细报告

- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
- [review-visual.md](./review-visual.md)
