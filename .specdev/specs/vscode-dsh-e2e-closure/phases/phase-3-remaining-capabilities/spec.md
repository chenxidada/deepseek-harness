# Phase 3: 其余 host 侧能力逐项真机驱动

## 目标

对「真实功能能力清单」中剩余 host 侧能力建立真机 EDH 驱动 + 截图 + 断言：§12.4 子会话进入/钉 Tab（#22–#23）、§12.5 代码上下文（@path / 选区提问，`#24–#26`）、§12.6 变更列表（#27–#29）、§12.7 搜索（#30–#31）、§12.10 历史（#37–#38）、§12.11 交互/审批 fail-closed（#39–#40）。这些能力多为 host 侧操作，部分（如选区提问 `selection-ask`）会触发模型往返，须继承 AC-9 真实 LLM 要求。

## 前置条件

- 依赖 spec 文件：`../requirements.md`（AC-7~AC-10）、`../design.md`（AD-3/AD-4）、`../repo-exploration.md`（§12.4–§12.7、§12.10、§12.11）。
- 前置 Phase：`phase-1-driver-framework-pilot`。
- 与 `phase-2-session-main-path-llm` 无依赖，可并行。
- 涉及模型往返的子能力（选区提问）需真实 `DEEPSEEK_API_KEY`；无 key 以 exit 3 fail-closed。

## 验收标准（本 Phase 覆盖）

| AC | 内容（摘要） |
|----|------|
| AC-7 | 对清单每项能力执行操作序列 + 截图 + 断言；本 Phase 覆盖 §12.4–§12.7、§12.10、§12.11；不覆盖已废弃功能 |
| AC-8 | 已废弃功能不建立覆盖，列入过时功能清单（与 Phase 2 共享，此处仅确认本批不新增覆盖废弃项） |
| AC-9 | 本批中涉及模型往返的能力（如选区提问）必须真实 LLM，不得注入/模拟等价 |
| AC-10 | 每项能力至少 1 条可独立判定端到端断言，验证完整数据路径 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-7 | 运行时验证 | 带真实 key 跑 `run-layer-v-capabilities.sh`，覆盖 §12.4（打开子会话上下文 `:1758` + 钉 Tab `:1831`）、§12.5（@path 提取 + 选区提问）、§12.6（变更索引/快照/回退/Diff 渲染）、§12.7（`searchSessions`）、§12.10（历史列/打开会话）、§12.11（交互协调器 fail-closed）；逐项检查 journal + 截图 | 每项能力有操作序列 + ≥1 截图 + verdict PASS；无废弃功能覆盖 |
| AC-8 | 静态检查 | 确认本批 manifest 项均对应 §12 现有代码位置（非 §13 过时清单），过时清单不新增覆盖项 | manifest 无废弃功能项，证据 `路径:行号` 指向 §12 真实实现 |
| AC-9 | 运行时验证 | 对「选区提问」子能力：带真实 key 跑，断言真实模型往返（非注入）；无 key 跑，断言 exit 3 | 真实 key → PASS；无 key → `SKIPPED_NO_CREDENTIALS` exit 3，不记 PASS |
| AC-10 | 运行时验证 | 对每批能力设计端到端断言（如变更列表：触发变更 → 检查 change-index 归属 + Diff 渲染证据 + 截图），非 DOM 存在/HTTP 200 | 断言可独立判定 ✅/❌，覆盖完整数据路径 |

## 约束（来自 design.md）

- **AD-3/AD-4**：manifest 驱动；关键区域 + 非退化断言。
- **AC-9 继承**：本批中任何触发模型往返的能力，真实 LLM 要求与 Phase 2 一致。
- **AC-7 分工**：本 Phase 覆盖 §12.4–§12.7、§12.10、§12.11；§12.1/§12.2（Phase 1）、§12.3/§12.8/§12.9（Phase 2）、§12.12（`dsh.test.*` 为测试钩子，非产品能力，不作为验证对象）。

## 产出清单

```
apps/vscode-dsh/test-scripts/layer-v-capabilities.json   # 修改：补全 §12.4–§12.7/§12.10/§12.11 能力 steps + 断言
apps/vscode-dsh/test-scripts/layer-v-capability-driver/  # 修改：实现本批能力 runStep
apps/vscode-dsh/test-artifacts/layer-v/                  # 运行产物（gitignore，不提交）
.specdev/specs/vscode-dsh-e2e-closure/phases/phase-3-remaining-capabilities/implementation.md  # 新增
```
