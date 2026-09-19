# Phase 1: 基线冻结与能力域清单

## 目标

用 `find` 类命令（**不得**用 `git ls-tree`，会漏未入库文件）冻结整合前基线，把未入库 spec 纳入版本控制，产出能力域清单 `capability-domains.json` 与台账 `assertion-map.md` 骨架。这是后续全部双向差集 / 退出码比对判定的前提。

## 前置条件

- 依赖 spec 文件：`design.md`（能力域定稿清单）、`phase-plan.md`（DAG JSON）、`.specdev/specs/vscode-dsh-test-consolidation/repo-exploration.md`（SUT 归类事实）。
- 已完成的 Phase：无。
- 运行环境：唯一权威解释器 Node 24.3.0，命令统一 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" <cmd>`。
- Git 分支：`impl-phase-1-baseline-domain-inventory`（从 `new/vscode-dsh` 切出，**非** `main`）。

## 验收标准

| 编号 | 内容 |
|------|------|
| AC-2 | 产出 `apps/vscode-dsh/tests/capability-domains.json`，每域记录 `id`/`spec`/`scripts`/`absorbed`/`entryAssertions`；每个整合前 spec 路径恰好出现在一个域 `absorbed`（双向差集为空） |
| AC-16(基线) | 复测并留档 oxlint 基线：现状配置 error 数 + 仅换 glob 后 error 数（不把 203 当已确认实测值） |
| AC-23(基线) | 采集并留档 `run-layer-v-smoke.sh` / `run-layer-v-capabilities.sh` 在 Node 24.3.0 无凭证环境下的退出码 |
| AC-14(基线) | 确认 Node 24.3.0 下 `vitest run apps/vscode-dsh/tests` 整合前基线全绿（failed=0）并留档 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-2 | 静态检查 | 用 `find apps/vscode-dsh/tests -type f \( -name '*.spec.ts' -o -name '*.spec.tsx' \)` 冻结文件集；与 `capability-domains.json` 全部 `absorbed` 并集做双向差集 | 双向差集为空；每个 spec 恰归属一个域 |
| AC-2 | 静态检查 | 校验 JSON 结构：每域含非空 `id`/`spec`/`absorbed`，`spec` 值匹配 `cap-<domain>.spec.ts\|tsx` 命名 | 结构合法，域 id 集合 = design.md 定稿的 10 域 |
| AC-16(基线) | 运行时验证 | `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests`（现状配置）记录 error 数；临时改 `include` 为 glob 后复跑记录 error 数 | 两组数值留档于 `implementation.md`（注明来源为 Phase 1 实测） |
| AC-23(基线) | fixture dry-run | 无凭证环境运行 `env PATH=… bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` 与 `run-layer-v-capabilities.sh`，记录退出码 | 退出码留档（预期 `SKIPPED_*` 分支） |
| AC-14(基线) | 运行时验证 | `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests` | `failed` = 0 留档 |

## 约束（来自 design.md）

- 未入库 spec 文件（如 `layer-v-capabilities-phase3.spec.ts`）在本 Phase 纳入版本控制（`git add`），保证后续 AC-24 `git diff` 判定有完整基线。
- 域清单必须与 `design.md` 能力域定稿清单（10 域）一致，域 id 不得另起名字。
- `entryAssertions` 的 `entrypoint` 骨架本 Phase 填（入口字符串），`caps` 数组留空待 Phase 2 回填（`caps` 依赖 `CAP-` 编号）。
- `assertion-map.md` 本 Phase 产出骨架：表头 + 全量整合前用例声明行（每行「原文件」「原标题」填实，「处置/理由码/新编号」留空待 Phase 2）。

## 产出清单

- `apps/vscode-dsh/tests/capability-domains.json`（新增）
- `apps/vscode-dsh/tests/assertion-map.md`（新增，骨架）
- `apps/vscode-dsh/tests/` 下未入库 spec 纳入版本控制
- `.specdev/specs/vscode-dsh-test-consolidation/phases/phase-1-baseline-domain-inventory/implementation.md`（含基线留档）
