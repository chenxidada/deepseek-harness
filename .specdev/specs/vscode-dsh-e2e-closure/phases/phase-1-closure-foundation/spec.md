# Phase 1: 闭环判定模型与证据隔离基座

## 目标

在既有层 V 能力驱动之上落地「真闭环判定」机器可读结论模型与 per-run 证据隔离，为后续逐项驱动打底：

1. `capability-runner.cjs` 新增 `classifyAssertionStrength`（弱证据/具体结果分类）与 `assessClosedLoop`（① 实际触发 ② 具体结果断言 ③ 真实截图 三元判定），`runCapability`/`runManifest` 返回值携带 `closedLoop`。
2. `run-layer-v-capabilities.sh` 把产物从 flat 单一目录改为 `runs/<runId>/` per-run 隔离（plan 稳定路径 + `plan.artifactDir` 指向 per-run 目录）。
3. 确认 journal 逐步追加（AC-7）与退出码契约（AC-8）在改造后不破坏。

**核心原则**：复用，不重造——不改 `primitives.cjs`、不改 `layer-v-runtime.sh` 的既有函数、不改退出码契约（0/1/2/3/4）、不改 `MATCHERS`/`matchesExpect`。

## 前置条件

- `requirements.md` 已确认（HG-1 passed）。
- `design.md` / `phase-plan.md` 已确认（HG-2，本 Phase 是 DAG 第一个、无依赖）。
- 工作流级 `repo-exploration.md` 已产出（本 Phase 依据其 §6 现状）。

## 验收标准

| AC | 内容（节选） |
|----|------|
| AC-1 | 以「① 真机实际触发 + ② 针对具体结果的断言 + ③ 真实桌面截图」三项同时满足作为「闭环通过」唯一标准；未齐备按 AC-15 登记未闭环 |
| AC-2 | 断言仅证明「面板已打开/DOM 存在/HTTP 200/命令已注册」→ 判「未闭环」，不得记「验证通过」 |
| AC-5 | 复用 `run-layer-v-smoke.sh` 的显示/Node/沙箱/凭证/进程逻辑，不得从零重建 |
| AC-7 | 运行期间逐步追加写 machine-readable JSONL journal（中途崩溃仍能按 step 定位） |
| AC-8 | 遵循退出码契约 0=PASS/1=LINK_FAILURE/2=SKIPPED_NO_DISPLAY/3=SKIPPED_NO_CREDENTIALS/4=HARNESS_ERROR，结论不得合并/降级/猜测 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | fixture dry-run | 用 `node` 直接 `require` 改后的 `capability-runner.cjs`，构造含「command + assert(具体) + screenshot」的 cap 样例调用 `assessClosedLoop`（或跑一个 mock host 的 `runCapability`），断言 `closedLoop.closed === true`；再构造「缺 screenshot」「缺具体断言」样例，断言 `closed === false` 且 `missing` 数组正确 | 三条齐备 → `closed:true`；缺一 → `closed:false` 且 `missing` 含对应维度 |
| AC-1 | 运行时（反向） | 对弱证据 cap（`react-spa-main` 单例）跑真机单项，确认 `conclusion=PASS` 但 `closedLoop.closed=false`（若断言未升级） | 两维度正交：run 通过但未闭环 |
| AC-2 | fixture dry-run | `classifyAssertionStrength` 输入 `{expect: {panelOpen:true}}` / `{expect: {viewId:'x'}}` → `'weak'`；输入 `{expect: '$assistantContains:LAYER-V-CAP-X-OK'}` / `{expect: {hits: [{$contains:'x'}]}}` → `'concrete'`；未知形态 → `'unknown'` 且 reason 显式记录 | weak/concrete/unknown 分类正确，不误判 |
| AC-5 | 静态检查 | `git diff` 确认 `layer-v-support/primitives.cjs` 与 `layer-v-support/layer-v-runtime.sh` 的既有函数体未被改动；新增代码只落在 `capability-runner.cjs` / `run-layer-v-capabilities.sh` / `extension.cjs`（仅复核） | 共享 runtime 与 primitives 无逻辑改动 |
| AC-7 | 运行时 | 真机单项 run 后读取 `runs/<runId>/layer-v-capabilities-journal.jsonl`，断言含每 step 行（success/failure）+ conclusion 行，且按 step 顺序逐步追加；构造中途 kill（`kill -9` host）再读取，仍能按 step 名定位最后一步 | journal 逐行追加、崩溃后仍可定位 |
| AC-8 | 回归验证 | 用 `node` 跑 mock host 的 `runManifest`：无 key 选 `requiresModel` cap → 聚合 `SKIPPED_NO_CREDENTIALS`；空选择 → `HARNESS_ERROR`；全 PASS → `PASS`。再核对 `run-layer-v-capabilities.sh` 的 case 映射（0/1/2/3/4）与改造前一致 | 退出码映射不变，不合并不降级 |

> 说明：AC-1/AC-2 的 fixture dry-run 用 `node -e` 或临时目录脚本执行（AC-13：临时脚本放临时目录、验证后删除，不落 `tests/`）。改后的 `capability-runner.cjs` 在 plain Node 下可 `require`（无 `vscode` 依赖），这是其设计初衷。

## 约束

- 不改产品代码（`src/`/`webview/src/`）。
- 不改 `primitives.cjs` / `layer-v-runtime.sh` 既有函数。
- 退出码契约 0/1/2/3/4 语义不变；`closedLoop` 是新增正交维度，不新增退出码。
- per-run 目录名用 `runs/${RUN_ID}`；`wait_for_status` 保留「读到不属于本 run 的 status → HARNESS_ERROR」fail-closed。
- 临时验证脚本放临时目录（如 `mktemp -d`），验证后删除，不落 `apps/vscode-dsh/tests/`。

## 产出清单

- `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（改）
- `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh`（改：per-run 隔离 + closure 汇总）
- `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs`（复核 `resolveArtifactDir`）
- `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md`（新增模板）
