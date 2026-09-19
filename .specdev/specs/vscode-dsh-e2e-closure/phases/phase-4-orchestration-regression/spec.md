# Phase 4: 全链编排、回归护栏与 registry 收尾

## 目标

把 Phase 1–3 的单项/分批驱动收敛为一条可重复的全量真机闭环入口，并清理回归护栏与技术债收尾：

1. 新增 `run-vscode-dsh-e2e-closure.sh` 编排入口：一键跑全量 41 项（或 18+23 分批），产出 per-run 隔离的 status + summary + journal + artifact-index 落盘。
2. 修复/归档 `run-chat-ready-regression.sh`（AC-12，现状引用已归并不存在的测试文件）。
3. registry 漂移收尾：DEBT-1 归档、DEBT-5 更新、DEBT-4 复核，并登记 Phase 2/3 产生的未闭环条目。

## 前置条件

- Phase 1、Phase 2、Phase 3 已完成且 HG-3 通过（全链编排依赖三个基座/驱动 Phase 的产物；registry 收尾依赖 Phase 2/3 登记的未闭环条目）。

## 验收标准

| AC | 内容（节选） |
|----|------|
| AC-12 | 现有回归（`run-layer-v-smoke.sh` / `run-chat-ready-regression.sh`）必须继续可用；本 feature 不得破坏既有回归 |
| AC-13 | 真机驱动脚本落在 `apps/vscode-dsh/test-scripts/`；临时脚本不进 `apps/vscode-dsh/tests/` |
| AC-14 | 对每项能力如实报告，发现真问题（如稳定性、真实 bug）如实登记，不许为重试绿灯而放宽断言/跳过用例 |
| AC-7 | 运行逐步追加写 machine-readable JSONL journal（中途崩溃仍能按 step 定位） |
| AC-5 | 复用 smoke 基座的显示/Node/沙箱/凭证/进程回收/退出码契约，不得从零重建 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-12 | 回归验证（真机） | 运行 `run-layer-v-smoke.sh`，确认退出码仍为契约值（无显示 exit 2 / 有显示 PASS exit 0），不因本 feature 改动失败 | smoke 回归通过 |
| AC-12 | 回归验证 | 检查 `run-chat-ready-regression.sh`：若已修复则 `bash -n` 通过且 `--list`/`--help` 可执行；若已归档则确认 `git status` 显示删除/移动且无残留引用 | chat-ready 回归脚本可用或明确归档 |
| AC-13 | 静态检查 | `git status -s` + `find apps/vscode-dsh/tests -newer` 确认：新增真机脚本只在 `test-scripts/`；`tests/` 无临时脚本残留 | 资产归属正确 |
| AC-14 | 静态检查 | 检查 `artifact-index.md` / `summary.json` / registry：未闭环项如实出现「缺哪条 + 原因」，无「为绿灯放宽断言」的痕迹（如无把 `panelOpen` 重定义为 closed 的记录） | 诚实报告无美化 |
| AC-7 | 运行时（真机） | 跑 `run-vscode-dsh-e2e-closure.sh`（有显示），中途 kill host，读取 `runs/<runId>/layer-v-capabilities-journal.jsonl` 断言按 step 追加、可定位最后 step | journal 逐步追加、崩溃可定位 |
| AC-5 | 静态检查 | `git diff` 确认 `layer-v-runtime.sh`/`primitives.cjs` 既有函数未改；退出码 case 映射（0/1/2/3/4）与 smoke 一致 | 基座契约未破坏 |
| AC-14/15 | 运行时（真机） | 全量编排跑完，逐项 `closedLoop` 结论齐备；汇总 `summary.json` 的 `closed`/`not-closed` 计数与 status 逐项一致；registry 中未闭环条目与 summary 一致 | 全量结论 + registry 收尾一致 |

## 约束

- 全链编排只组合 Phase 1–3 已有能力，不新增判定逻辑（复用 `assessClosedLoop`）。
- `run-chat-ready-regression.sh` 处置二选一（修复引用真实存在的 `cap-*.spec.ts`，或标注 obsolete 归档），不允许「静默留破」。
- registry 漂移收尾：DEBT-1 标记 resolved、DEBT-5 更新现状、DEBT-4 复核后保留或更新；新增未闭环条目登记。
- 不改产品代码、不改退出码契约。
- 编排入口支持 `--batch` 分批（真机单次耗时风险），默认按组/按 requiresModel 分两批。

## 产出清单

- `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh`（新增编排入口）
- `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`（修复或归档）
- `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md`（汇总落盘）
- `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md`（收尾更新）
