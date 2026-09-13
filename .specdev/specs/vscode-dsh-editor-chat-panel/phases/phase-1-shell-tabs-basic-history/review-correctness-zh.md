# 正确性审查 — phase-1-shell-tabs-basic-history

> Must-Fix 回路 #1 复审（`loop_count=1`）。旧报告已归档至 `.archive/`。

## 视角
**实现正确性** — 代码是否真正工作

## 判决
**PASS**

上一轮 AC-1c（外部打开未聚焦 Editor Panel + 层 B 假绿）已闭合：生产路径函数体已接线，`openHistory` / `searchSessions` / `switchConversation` 成功后均经 `revealConversationPanel` → `openOrFocus({ sessionId })`；层 B 独立覆盖且本机 **13/13** 通过（禁止再以旧 9/9 宣称 PASS）。

## 要点

- 所有本 Phase AC 功能路径有真实实现；无新增未注册桩
- 已登记 GAP/DEBT 仍为 P1 豁免，不挡 PASS
- 残留 Should-Fix：`history-loading` 同 tick 双帧（可观测性）；Q-5 层 B 未断言 InformationMessage 文案——不破坏 Must
- 层 V 仍交 verifier 真机

完整 AC 表与函数体证据见同目录 `review-correctness.md`。
