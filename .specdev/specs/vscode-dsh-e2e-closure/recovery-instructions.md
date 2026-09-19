# 上下文压缩恢复指南 — 2026-09-19T17:10:36Z

上下文已于 2026-09-19T17:10:36Z 被压缩。

## 恢复步骤（按序执行）
1. 读取 `.specdev/active-workflow` → slug: vscode-dsh-e2e-closure
2. 读取 `.specdev/specs/vscode-dsh-e2e-closure/current-status.json` → 确认当前状态
3. 检查 Human Gate 状态
4. 读取最后完成的 spec 输出文件
5. 向用户报告当前状态，等待确认后继续

## 当前状态快照
- **工作流**: vscode-dsh-e2e-closure
- **阶段**: phase-implementation
- **当前 Phase**: phase-2-drive-nonmodel
- **HG-1**: passed
- **HG-2**: passed
- **HG-3**: pending
- **循环次数**: 0
- **快照时间**: 2026-09-19T17:10:36Z

---

## 🔒 流程与角色锚定（恢复后必读，优先于任何操作）

> ⚠️ 强制第 0 步：在执行任何流程动作（委托子 Agent、推进 Human Gate、切换阶段）之前，
> **必须先用 Read 工具完整读取 `.cursor/rules/spec-workflow.mdc`**（always-applied 权威流程规则，含全部命令定义）。
> 未读取该文件前，不得委托任何子 Agent、不得推进任何 Human Gate。

### 你的角色三条铁律（复述并遵守）

1. **不实施 / 不审查 / 不验证（只委托）** — 你是 Cursor Agent，担任**调度者**：讨论需求 → 设计方案 → 委托子 Agent 执行 → 等待用户确认。你不自己写实现代码（委托 implementer）、不自己审查代码（委托 reviewer）、不自己运行验证（委托 verifier）。
2. **Human Gate 不可跳** — HG-1 需求确认 / **HG-1.5 视觉基准确认（仅 UI 工作流）** / HG-2 方案确认 / HG-3 Phase 完成确认，四个节点必须停下等待用户**明确确认**（如「确认」「开始实施」「验收通过」）；UI Phase 另有**原型确认门禁**（用户确认原型前不得派发 reviewer / verifier）；禁止跳过 Human Gate 直接委托下一阶段子 Agent；用户说「看看」「好的」等模糊回复不算通过。
3. **Phase ID 来自 DAG JSON、禁止自编** — current_phase 必须原样取自 `phase-plan.md` 中 DAG JSON 的 `phases[].id`，任何 Agent 或调度者都不得自己另起名字。

### 下一步如何确定流程

- 参照 `spec-workflow.mdc` 的「可用命令」表与「工作流阶段定义」来判断当前应委托哪个子 Agent、下一步是什么。
- **不依赖** `current-status.json` 中的 `command` 字段（该字段不存在，不要臆造）。

### 当前阶段：phase-implementation（Phase 实施）

- ✅ 该做：每个 Phase 前**先委托 `code-explorer`** → 建 `impl-<phase-id>` 分支 → 委托 `implementer` →**（UI Phase：先把原型截图呈现给用户确认，`touch .prototype-approved` 后再续做）**→ 4 个并行 reviewer（correctness / design / connectivity / visual）→ `verifier`；每个 Phase 完成后等待 **HG-3** 验收。current_phase 必须取自 DAG JSON。
- ⛔ 不能做：不能跳过 code-explorer / reviewer / verifier；不能自己写、审、验代码；UI Phase 未确认原型不得派发 reviewer / verifier（`pipeline-gate.sh` 会 deny）；HG-3 未过不能进入下一 Phase。

### 权威来源声明

> 以上注入摘要（状态表 + 锚定提示）**仅供参考**。权威运行状态以 `current-status.json` 为准，
> 流程规则以 `.cursor/rules/spec-workflow.mdc` 为准。二者与本摘要不一致时，以这两个文件为准。
