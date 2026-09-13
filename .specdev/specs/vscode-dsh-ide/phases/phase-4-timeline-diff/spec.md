# Phase 4: 时间线 + 事后 Diff

## 目标

按活动（或对应）Tab 的 `sessionId` 订阅并投影 `session.event` / `session.status` 为 turn / step / tool / assistant 时间线；在工具产生工作区文件改动后提供事后 Diff/SCM 审阅入口；默认不做执行中逐文件确认。Should：subagent 层级标注、时间线写文件条目跳转 Diff。

## 前置条件

- Phase `phase-2-multi-tab-session` HG-3 通过（可与 Phase 3 并行启动）
- Phase Entry Gate：读取 registry
- SDK 协议通知：`session.event`、`session.status`、`subagent.started` / `subagent.finished`

## 验收标准

**AC-12:** `[Must]` **事件驱动型** — **当** 开发者在活动 Tab 提交任务 **时**，扩展 **必须** 对该 Tab 的 `sessionId` 调用 `session/prompt`，并获得含 `messageId` 的入队回执。

**AC-13:** `[Must]` **事件驱动型** — **当** 运行时发出该会话的 `session.event` 或 `session.status` **时**，活动（或对应）Tab 的时间线 **必须** 更新 turn / step / tool / assistant 进度。

**AC-14:** `[Should]` **事件驱动型** — **当** 发出 subagent 启动/结束相关通知 **时**，时间线 **应该** 以可区分层级或标注展示。

**AC-23:** `[Must]` **事件驱动型** — **当** 会话中工具产生工作区文件改动 **时**，系统 **必须** 提供事后 Diff 审阅入口（tool 事件和/或 git）。

**AC-24:** `[Must]` **普遍型** — 默认行为 **必须** 是事后 Diff；**必须不** 将执行中逐文件确认设为默认必选。

**AC-25:** `[Should]` **事件驱动型** — **当** 开发者从时间线写文件类条目跳转 **时**，系统 **应该** 打开对应 Diff 或编辑器视图。

**AC-33:** 本 Phase ≥1 集成测试 + ≥1 独立 e2e。

## 约束

- AD-7：事后 Diff；事件权威源为 session 日志 / SDK 通知，扩展只投影
- 按 `sessionId` 过滤，避免多 Tab 串时间线（与 AC-7 一致）
- 不把 Spec 状态写入时间线 Must

## 产出清单

- Timeline 视图（过滤、状态、基础条目类型）
- Diff/SCM 入口（事后）
- Should：subagent 标注、时间线→Diff 跳转
- 集成测试 + e2e（prompt 回执 + 时间线更新 + Diff 入口可见）

## 不在范围内

- 执行中写前确认（AC-26 Could）
- 审批 UI（属 Phase 3）
- Spec 面板
