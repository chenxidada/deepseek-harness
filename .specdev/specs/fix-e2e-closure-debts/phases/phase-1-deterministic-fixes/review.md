# Phase 1 审查报告（合并）— phase-1-deterministic-fixes

## 判决：SHOULD-FIX

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|----|:--:|---|
| 实现正确性 | reviewer-correctness | SHOULD-FIX | DEBT-9/8/11 三条债务静态+单测全过；唯一 should-fix：删 CAP-TEST-HARNESS-083 后两处台账孤儿引用（capability-domains.json:766 + assertion-map.md:471），已回填 |
| 设计一致性 | reviewer-design | PASS | 严格遵循 design.md（完整 token 判定、照抄既有范式、删脚本+4守卫），AC-1 范围未突破 |
| 集成连通性 | reviewer-connectivity | PASS | isLanguageIdTokenLeaked 导出-调用-单测链路完整；DEBT-8 新步骤命令/断言原语全注册；DEBT-11 守卫全同步 |
| 视觉一致性 | reviewer-visual | N/A | ui:false，本 Phase 无 UI 视觉变更 |

## Must-Fix 汇总

无。

## Should-Fix 汇总

1. **台账孤儿引用（reviewer-correctness，已回填）**：删 CAP-TEST-HARNESS-083 测试后，`capability-domains.json:766` 与 `assertion-map.md:471` 仍保留对该断言的孤儿引用，破坏台账「双向差集为空」不变式。**已由调度者回填**：从 `entryAssertions[].caps` 移除 `CAP-TEST-HARNESS-083`；`assertion-map.md` 该行 keep→drop（理由码 D4，关闭依据 `run-chat-ready-regression.sh removed (DEBT-11)`）。不阻塞 verifier。

## 观察项（🟢，不参与判决）

- DEBT-9 `isPathTokenChar` 字符集 `[A-Za-z0-9._-]` 对 `+`/`$`/`!` 有残余误判风险，但无标准 languageId 含这些字符，且与 design.md 冻结算法一致。
- `index.ts:31` 是第二个被改的 src/ 文件（纯 barrel 导出，无业务逻辑，属 AC-1 授权范围）。
- DEBT-8 步骤验证「历史会话往返」而非「HistoryPanel 组件渲染」，语义轻微错位，真机闭环属 verifier 职责。
- `run-layer-v-smoke.sh:89` 注释仍提已删脚本（stale 注释，非守卫，不阻塞）。

## 详细报告

- [review-correctness.md](./review-correctness.md)
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
- [review-visual.md](./review-visual.md)
