# Phase 5: 清除过时产物 + 全链编排 + 回归护栏

## 目标

三个收尾任务：

1. **清除 mock/过时测试/过时验证产物**（AC-14~AC-16）：按 repo-exploration §14 清单，逐项读体确认（解决 §14.2 的 ⚠️ HYPOTHESIS R3）后删除，留痕于 implementation.md。
2. **全链编排 + 证据产出**（AC-17~AC-18）：一条命令串起 Phase 1/2/3 的全部能力驱动，产出机器可读状态记录 + 截图 + journal + run-summary + artifact-index；任一能力失败 → 非 0 退出码 + 标注失败步骤。
3. **回归护栏**（AC-19）：`vitest run apps/vscode-dsh/tests`（59 files / 523 passed + 1 skipped）与 `run-chat-ready-regression.sh`（ALL OK，96 + 57 tests）保持全绿。

## 前置条件

- 依赖 spec 文件：`../requirements.md`（AC-14~AC-19）、`../design.md`（AD-7）、`../repo-exploration.md`（§14）。
- 前置 Phase：`phase-2-session-main-path-llm`、`phase-3-remaining-capabilities`、`phase-4-audit-debt-fixes`（全链编排需 Phase 1/2/3 驱动就绪；回归护栏需 Phase 4 代码改动落地）。

## 验收标准（本 Phase 覆盖）

| AC | 内容（摘要） |
|----|------|
| AC-14 | workflow 级 code-explorer 产出「待清除 mock/过时测试/过时验证产物清单」，每项附路径 + 判定依据，不盲删 |
| AC-15 | 清除清单中已确认不再被生产路径使用的 mock 测试用例（thin HTML fixture-only 测试等） |
| AC-16 | 交付后工作区不残留「已废弃生产路径对应的 mock/测试/验证产物」；清除动作 implementation.md 留痕 |
| AC-17 | 闭环运行后产出机器可读状态记录（每项能力结论 + 证据路径 + 失败步骤）+ 截图 + journal + run-summary + artifact-index 追加 |
| AC-18 | 清单任一能力断言失败 → 非 0 退出码 + 状态记录标注失败步骤/原因，不静默放行 |
| AC-19 | 不破坏既有回归：vitest（523 passed）+ chat-ready regression（ALL OK）保持全绿 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-14 | 静态检查 | 检查 implementation.md 附「待清除清单」，逐项含路径 + 「为何过时/被什么替代」判定依据，且逐项读体确认记录（解决 §14.2 R3 的 HYPOTHESIS） | 清单完整、每项有判定依据、无「盲删」痕迹 |
| AC-15 | 静态检查 | 确认 `tests/layer-a/`（5 文件）、7 个 thin HTML phase 测试等已确认过时的 mock 用例被删除；`git status` 展示删除清单 | 已确认过时用例删除，且未删除 §14.1 白名单（`fake-sdk-runtime.mjs`、`run-layer-v-smoke.sh`、`layer-v-driver/`、`layer-v-support/`） |
| AC-16 | 静态检查 | 检查工作区无残留「废弃生产路径对应的 mock/测试/验证产物」（`tests/layer-a/`、39 个 `test-scripts/` 历史目录、`test-artifacts/.archive/`/`.probe/`）；implementation.md 列清除项清单 | 残留项清零（或显式列为「保留 + 理由」）；清除留痕完整 |
| AC-17 | 运行时验证 | 跑全链编排命令，检查 `test-artifacts/layer-v/` 产出：状态记录（含每项能力结论/证据路径/失败步骤）+ 截图 + journal + run-summary + artifact-index 新增一行 | 全部产物齐全且机器可读；artifact-index 追加一行 |
| AC-18 | 运行时验证 | 人为使一项能力断言失败（如移除某输入文件），重跑全链编排 | 非 0 退出码 + 状态记录标注该失败步骤/原因；不静默放行、不以 skip 掩盖 |
| AC-19 | 运行时验证 | ① `pnpm exec vitest run apps/vscode-dsh/tests`；② `bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | ① 523 passed + 1 skipped（无 FAIL）；② ALL OK（96 + 57 tests） |

## 约束（来自 design.md）

- **AD-7**：清单驱动 + 逐项读体确认 + 留痕；删除动作在 implementation.md 留痕（列出被清除项清单）。
- **§14.1 白名单必保留**：`fake-sdk-runtime.mjs`（11 用例引用）、`run-layer-v-smoke.sh`、`layer-v-driver/`、`layer-v-support/`。
- **AC-19 回归护栏**：清除/编排不得破坏既有测试；若回归失败须回滚对应清除项或修复。
- **真机时长（R1）**：全链编排允许按能力分组/单项复验运行，但 AC-17/18 的全链结论须覆盖清单全部能力。

## 产出清单

```
apps/vscode-dsh/tests/layer-a/                          # 删除：已确认过时的 thin HTML 遗留测试（逐项读体确认后）
apps/vscode-dsh/tests/phase1-*.spec.ts ... phase5-*.spec.ts  # 删除：thin HTML chassis 遗留（仅当确认不测共享算法）
.specdev/specs/*/phases/*/test-scripts/                 # 删除：39 个历史验证脚本目录（薄壳/被层 V 闭环取代）
apps/vscode-dsh/test-artifacts/layer-v/.archive/ + .probe/  # 删除：历史运行快照 + 调试残留
apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh  # 修改（如需）：全链编排入口
.specdev/specs/vscode-dsh-e2e-closure/phases/phase-5-cleanup-orchestration-regression/implementation.md  # 新增：清除清单 + 留痕
```
