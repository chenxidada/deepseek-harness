# Phase 6: Feature 跨 Phase 全量回归

## 目标

在 phase-1…5 全部 Must 交付后，建立**跨 Phase 可编程回归矩阵**（L2/L3 为主，可选 L4 截图清单），覆盖自动建连、自动就绪、Chat UI 底盘、新建 chrome、升格抛光。**无新产品架构**；仅允许修复回归中发现的缺陷。更新 `feature-delivery-summary.md`，确认 `tech-debt-registry.md` 活跃表为空或仅含已文档化 Out-of-Scope。

## 前置条件

- HG-1 / HG-2 已确认；post-HG-2 amendment（2026-09-09）已写入 `phase-plan.md`
- 依赖 Phase：`phase-5-should-polish`（HG-3 通过）；实质覆盖 phase-1…5
- 已读：各 Phase `verification.md`、`tech-debt-registry.md`、`design.md` R3、`should-ac-retrospective.md`

## 验收标准

全部为 **Must**：

- [ ] **AC-R1** 统一回归套件/脚本在 `apps/vscode-dsh/tests`（或文档化的聚合入口）下可一键/一条命令跑通；矩阵覆盖 phase-1…5 的 Must AC 主证据路径（至少：AC-1a 反向、视图可见主路径、UI 底盘关键 L3、新建 chrome L2、phase-5 六条抛光）；**全绿**
- [ ] **AC-R2** phase-1…4 既有 smoke / phase* 规格测试入口 **仍通过**（不得因 phase-5 改动回退）
- [ ] **AC-R3** `tech-debt-registry.md` 活跃阻塞债为空，**或**仅剩已显式标注 Out-of-Scope（含 AC-33）且带关闭理由的条目；禁止静默残留「以后再做」的 Should
- [ ] **AC-R4** 更新 Feature 交付摘要（`feature-delivery-summary.md` 或本 slug 约定路径）：列出已交付 Must、Out-of-Scope、回归命令与结果摘要

## 验证策略

| AC | VP 引用 | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|---------|
| AC-R1 | VP-CR-R1 | 运行时 / 回归 | 执行统一回归入口（如 `pnpm exec vitest run` 过滤 `phase1|phase2|phase3|phase4|phase5|chat-ready-regression` 或专用脚本）；附矩阵表勾选 | 退出码 0；矩阵行全绿 |
| AC-R2 | VP-CR-R2 | 回归 | 单独/复跑 `phase1-auto-start`、`phase2-auto-ready`、`phase3-chat-ui-chassis`、`phase4-new-conversation-chrome` 套件 | 全部通过 |
| AC-R3 | VP-CR-R3 | 静态 | 读 `tech-debt-registry.md` 活跃表 | 无 🔴阻塞；残留仅 Out-of-Scope 文档化 |
| AC-R4 | VP-CR-R4 | 静态 | 读 delivery summary | 含 Must 清单、AC-33 Out、回归命令与结果 |

可选 L4：在 verification 附浅/深色 + 未读增强 + 新建 chrome 截图路径清单（**非** Must 唯一证据）。

## 约束

- **禁止**新产品架构、新 AC 功能（修复回归除外）
- **禁止**重开 AC-33 或其它 Out-of-Scope
- **禁止**改 `packages/core/agent-loop`
- 回归矩阵须可编程；不得以「人工点一遍」作为 AC-R1 唯一证据
- 发现缺陷 → 最小修复 + 补测；重大设计变更须回 HG（本 Phase 默认不做）

## 产出清单

- [ ] 统一回归套件/脚本（`apps/vscode-dsh/tests/` 下聚合文件或 package script + README 入口）
- [ ] 验证矩阵表（写入本 Phase `verification.md` 或 `feature-delivery-summary.md`）
- [ ] 可选：L4 截图清单
- [ ] 更新 `feature-delivery-summary.md`
- [ ] `tech-debt-registry.md` 清点结果
- [ ] `implementation.md`（记录仅修了哪些回归、无新架构）

## 不在本 Phase 范围

- 新功能 / 新 UX 抛光
- AC-33 动画
- Cursor 全量、Remote 专项、多窗口协调

## 建议回归矩阵骨架（implementer 可扩展）

| 区段 | 最小覆盖 AC / 路径 | 既有测试锚点（示例） |
|------|-------------------|---------------------|
| 自动建连 | AC-1a 反向；AC-1d/6a 切片 | `phase1-auto-start.spec.ts`、`auto-start-orchestrator.spec.ts` |
| 自动就绪 | AC-3/4/4a/6/7 主路径 | `phase2-auto-ready.spec.ts` |
| Chat 底盘 | AC-8/12/16/16a/17/19 | `phase3-chat-ui-chassis.spec.ts` |
| 新建 chrome | AC-15/22/24/6 | `phase4-new-conversation-chrome.spec.ts` |
| 升格抛光 | AC-28…32、AC-34 | `phase5-should-polish.spec.ts` |
| 前序行为 | AC-27 抽测 | multitab / continue / close 相关既有用例 |
