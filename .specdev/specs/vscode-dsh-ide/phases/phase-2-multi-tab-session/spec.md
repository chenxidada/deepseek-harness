# Phase 2: 多对话 Tab + session 绑定

## 目标

在同一工作区实现多对话 Tab：每个 Tab 绑定可区分的 `sessionId`；切换 Tab 切换输入目标与可见会话态；关闭 Tab 按默认策略结束对应会话；扩展侧不重实现 agent-loop / 工具执行 / 会话持久化权威源。

## 前置条件

- Phase `phase-1-profile-dual-channel` HG-3 通过并已合并
- 可读：`design.md` AD-1/AD-5/Q-3、`phases/phase-1-*/implementation.md`（若存在）
- Phase Entry Gate：读取 `tech-debt-registry.md` 中目标为本 Phase 的 🔴 项

## 验收标准

**AC-6:** `[Must]` **事件驱动型** — **当** 开发者在同一工作区请求「新建对话」**时**，系统 **必须** 新增一个 Tab，并为其分配可区分的会话身份（新 `sessionId` 或文档化的等价句柄）。

**AC-7:** `[Must]` **事件驱动型** — **当** 开发者切换活动 Tab **时**，系统 **必须** 将输入目标与时间线投影切换到该 Tab 绑定的会话，**必须不** 把用户输入发到错误会话。

**AC-8:** `[Must]` **事件驱动型** — **当** 开发者关闭某一 Tab **时**，系统 **必须** 按文档化的默认策略处置该会话（本版默认：结束会话），并更新 Tab 栏。

**AC-9:** `[Must]` **普遍型** — 系统 **必须** 支持在同一工作区同时存在不少于两个对话 Tab（创建与切换可验证）。

**AC-11:** `[Should]` **可选功能型** — **若** 实现提供 Tab 标题，系统 **应该** 允许使用会话标题或首条用户消息摘要作为默认标题。

**AC-15:** `[Must]` **普遍型** — 扩展 **必须不** 在 VS Code 进程内重实现 `agent-loop`、工具执行管线或会话持久化权威源。

**AC-33:** 本 Phase ≥1 集成测试 + ≥1 独立 e2e。

## 约束

- 单 DSH 进程多 `sessionId`（AD-1）
- 关 Tab → dispose 该 session（Q-3）；dispose 经 ide-bridge，不扩展 SDK stdout 方法集（design「多会话生命周期」）
- 可恢复策略仅文档预留，不做默认

## 产出清单

- Extension：`ConversationRegistry`、Tab 栏、新建/切换/关闭命令
- Bridge：`session/dispose`（或等价）调用 `AgentHandle.dispose()`
- 默认关闭策略文档（README / 扩展说明）
- 集成测试（≥2 Tab 切换不串 sessionId）+ e2e
- registry 更新（填实 Phase 1 遗留、与本 Phase 相关的 stub）

## 不在范围内

- 审批弹窗与 Tab 关联（Phase 3，AC-10）
- 完整时间线渲染与 Diff（Phase 4）
- Tab 拖拽/固定/重命名增强（Could）
