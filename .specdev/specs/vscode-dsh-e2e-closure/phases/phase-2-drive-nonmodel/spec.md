# Phase 2: 非模型能力批真机驱动

## 目标

用 Phase 1 落地的基座，对 `requiresModel:false` 的 18 项能力逐项真机驱动、给结论：升级弱证据为具体结果断言（能闭环则闭环），不能闭环的如实登记「未闭环 + 缺口三元组」。同时产出「真实功能能力清单」与「过时功能清单」的落盘核对。

覆盖组：`react-spa-main`(8) + `editor-panel`(4) + `code-context` 的 `at-path-token`/`workspace-path-resolve`(2) + `interaction`(2) + `test-hooks`(1) + `session-main-path` 的 `extension-activate`(1)。

## 前置条件

- Phase 1（`phase-1-closure-foundation`）已完成且 HG-3 通过。
- `layer-v-capabilities.json` 仍是工作流级调研产出的 41 项清单（本 Phase 只动本批组的断言）。
- 显示环境可用（Xvfb + `code` CLI；无显示 → SKIPPED_NO_DISPLAY，exit 2）。

## 验收标准

| AC | 内容（节选） |
|----|------|
| AC-3 | 能力清单由 workflow 级 code-explorer 产出，每项附 `路径:行号`，覆盖「历史已验证」与「未验证」两类，以当前代码为准 |
| AC-4 | 已废弃/被替代路径（如 thin HTML 聊天面板）不建立闭环覆盖，列入「过时功能清单」 |
| AC-6 | 清单中每项能力产出真实桌面截图（PNG）+ ≥1 条可独立判定的端到端断言 |
| AC-15 | 基座可重复运行；每项能力逐项真机驱动给结论，未闭环登记「缺哪条 + 原因 + 建议何种 feature」，不在本 feature 回归补齐 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-3 | 静态检查 | 核对 `layer-v-capabilities.json` 的 41 项 id/group 与 `repo-exploration.md` §12 清单一致，且每项 `evidence` 数组为 `路径:行号`（路径存在、行号不越界） | 清单 41 项、12 组，每项带有效证据 |
| AC-4 | 静态检查 | 确认 `buildThinChatHtml` 相关旧路径（`chat-panel-provider.ts`）**未**出现在本批驱动选择器内；产出「过时功能清单」（thin HTML 聊天面板等）文件或 registry 条目 | 过时路径不覆盖，清单存在 |
| AC-6 | 运行时（真机） | 对本批 18 项逐项（或按组分批）跑 `run-layer-v-capabilities.sh --capability <组>`，断言每项 `closedLoop.realScreenshot === true`（有非退化 PNG）且至少 1 条 `assert`/`wait`/`stream` 步骤通过 | 每项有 PNG + ≥1 断言通过 |
| AC-6 | 运行时（断言质量） | 检查本批升级后的 `react-spa-main`/`editor-panel` 能力不再仅 `panelOpen:true`：能闭环项的 `closedLoop.concreteAssertion === true` | 弱证据已升级或如实登记 |
| AC-15 | 运行时（真机） | 完整跑本批后读取 `runs/<runId>/layer-v-capabilities-status.json`，断言每项都有 `closedLoop`（`closed:true` 或 `closed:false` + `missing` + `reason`）；重复运行同一组两次，两次 run 目录独立（runId 不同）且 verdict 不互相覆盖 | 每项有结论；可重复运行 |
| AC-15 | 静态检查 | 未闭环项在 `tech-debt-registry.md` 有对应条目，含「缺哪条 + 原因 + 建议何种 feature 补充」 | 未闭环如实登记 |

> 本 Phase 只验收本批 18 项（`requiresModel:false`）；`requiresModel:true` 的能力留待 Phase 3。

## 约束

- 不改产品代码（`src/`/`webview/src/`）。
- 对纯 webview 内部组件（host 侧无 `dsh.test.*` 接口暴露渲染状态），不得硬造弱断言充数——如实登记「未闭环：缺具体结果断言」，建议后续 feature 补 webview 探测通道。
- 弱证据升级只改本批组在 `layer-v-capabilities.json` 的断言，不重写全量 41 项，不重写 `ac` 字段（旧编号体系）。
- 运行时长分批：按组（`react-spa-main` / `editor-panel` / `code-context` / `interaction` / `test-hooks`）分批跑，避免单次过长。
- 不修改产品业务逻辑、不回归补齐未闭环能力（AC-15）。

## 产出清单

- `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（改：本批组断言升级）
- `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/<runId>/`（本批 status + PNG + journal）
- 过时功能清单（`repo-exploration.md` 已含，本 Phase 落盘为 registry 或单独清单文件）
- `tech-debt-registry.md`（新增「未闭环」条目，如有）
