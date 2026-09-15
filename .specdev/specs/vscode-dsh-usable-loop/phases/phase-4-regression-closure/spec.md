# Phase 4: 全量回归与交付收口

| 项 | 值 |
|---|---|
| Phase ID | `phase-4-regression-closure`（来自 `phase-plan.md` DAG JSON，唯一真相源） |
| 分支 | `impl-phase-4-regression-closure` |
| 依赖 | `phase-3-layer-v-smoke-loop` |
| 覆盖 AC | AC-34 – AC-37（4 条） |
| 设计依据 | `design.md` AD-10（文档落点与两覆盖面；**v7 更正文档门禁口径**：`docs/development.md` 与 `apps/vscode-dsh/README.md` **不在**预算表内，本 Phase **只复核不首修**）、AD-9（`DEBT-001` 撤销）、AD-14（`dsh.test.getDiagnosticsText` 的 **18 字段**（含 `schemaVersion`）JSON 契约与版本策略，收口时须复核）、AD-15（**route A** 原生 Diff + **决策 4** 的影子 preset 生成器与 `--check-shadow-preset`；`DEBT-002` 已撤销）、AD-8（显示环境 `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY` + 结论分类契约；Xvfb 已由用户安装，`DEBT-003` **已撤销**）、§6（**`DEBT-004` 新增**：出厂 `ide` profile 主会话不可写文件，用户裁定只登记、本工作流不修）；`AGENTS.md`（Agent Note / 文档门禁 / 只跑相关检查） |

## 目标

对**合并后**的工作区整体断言累积不回归（`agent-loop` 未改动、entrypoints 门禁通过、全量构建与既有套件通过、既有回归脚本 0 退出），并完成本工作流的交付收口：Agent Note、`docs/wiki` 受影响页面、双语文档配对与技术债注册表状态复核。

## 前置条件

- Phase 1、Phase 2、Phase 3 均已通过 HG-3 并合并回 `main`
- `phases/phase-4-regression-closure/repo-exploration.md`（code-explorer 产出，implementer 必须先读）
- **Phase Entry Gate**：读取 `tech-debt-registry.md` 并逐条复核 Phase 1–3 留下的债务，向用户呈现后再开始。预期为：`DEBT-001` 已解决（归档说明）；`DEBT-002` **已撤销**（用户 HG-2（v4）裁定 AC-25 step5 走 route A，Diff 元数据为模型原生 `meta.diffs`，`spikes/native-diff-feasibility.md` Follow-up §G1.4 已实测）；`DEBT-003` **已撤销且不适用**（v6：Xvfb 已由用户安装，实测 `/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 存在、`dpkg-query` → `install ok installed`，脚本内安装动作不存在，触发条件不再可能成立）；`DEBT-004`（**新增活跃条目**：出厂 `ide` profile 主会话不可写文件，🟡非阻塞，目标 = 下一个处理 preset 策略 / IDE 默认人设的工作流；**用户裁定本工作流不修**）
- 构建产物可按需重出：`apps/vscode-dsh/lib/`、`packages/sdk/client/lib/`、`apps/vscode-dsh/webview/dist/`

## 验收标准（提取自 requirements.md，原文不改）

- **AC-34**: `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** 本工作流的改动被应用，**那么** `packages/core/agent-loop/` 下的文件 **必须** 不发生改动。
- **AC-35**: `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** 本工作流的改动被应用，**那么** 仓库 **必须不** 新增任何应用 bin 或 argv 入口逃逸，且 `verify-application-entrypoints` 门禁 **必须** 通过。
- **AC-36**: `[Must]` **普遍型** `[责任侧: 仓库]` — 本工作流的全部改动 **必须** 使 `pnpm run build:lib:host` 以 0 退出，**且** `apps/vscode-dsh` 下既有 vitest 套件全部通过。
- **AC-37**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 本工作流改动完成后运行 `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` **时**，该脚本 **必须** 以 0 退出。

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|---|---|---|---|
| AC-34 | 静态检查（git diff） | (a) `git diff --name-only <phase-1 前基线>..HEAD -- packages/core/agent-loop` 输出为空；(b) 运行 `bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`（其内部含 `agent-loop` 未改动断言步骤）并确认该步骤通过 | 空 diff + 脚本内该步通过 |
| AC-35 | 门禁 + 静态检查 | (a) `pnpm run verify-application-entrypoints`（或 `pnpm run doc-sync` / `pnpm run hygiene` 中对应叶子）退出 0；(b) `git diff --stat` / `git diff -- package.json apps/*/package.json` 断言未新增 `bin` 字段、未新增可执行入口；(c) 断言 Phase 3 的驱动扩展目录（`apps/vscode-dsh/test-scripts/layer-v-driver/`）未被声明为包 `bin`；(d) 断言新增的 `contributes.configuration`（`dsh.nodeBin`）与 `contributes.commands`（`dsh.showHostDiagnostics`）**不构成** argv/bin 逃逸（它们不是 CLI 入口），并断言相关包级门禁（`verify-package-invariants` 面）通过 | 门禁 0 退出 + 无新增 `bin` |
| AC-36 | 编译验证 + 回归 | (a) `pnpm run build:lib:host` 退出 0；(b) `pnpm run test -- apps/vscode-dsh` 全部通过（含 Phase 1/2/3 新增 spec 与既有套件）；(c) `pnpm run test -- packages/sdk/client` 全部通过；(d) `pnpm run typecheck`、`pnpm run lint`、`pnpm run hygiene` 退出 0；(e) `pnpm run test:coverage`（或在 `scripts/coverage-partitions.ts` 中定位到的分区调用）确认被改动且受门槛约束的文件（`packages/sdk/client/src/{launch,client}.ts`）仍满足 per-file 100% | 全部 0 退出 |
| AC-37 | 运行时验证（端到端回归） | 直接执行 `bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` 并记录退出码与输出末尾 | 退出码 0 |
| 交付收口 | 静态检查（文档门禁）+ 契约复核 | (a) `pnpm run doc-sync` 退出 0（含 `verify-translation-pairing`、`verify-export-jsdoc`、`pnpm run website:build` 的死链检查）；**(a′) 文档门禁的"只复核不首修"边界（v7，#9）**：本 Phase **只**复核，**不得**在 Phase 4 才首次做预算 / 双语配对 / 引用类修复——这些修复**必须**已在其产出 Phase（Phase 1 的 `docs/development.md`(+`.zh.md`)、Phase 3 的 `apps/vscode-dsh/README.md`(+`.zh.md`)）完成；若 `doc-sync` 在本 Phase 变红，implementer **必须**回到产出该文档的 Phase 的产物状态查明差异，并按 **Relocate → Condense → Raise**（`docs/AGENTS.md:51-55`）在**本 Phase 的 implementation.md 记录**处置理由（`Raise` **仅当**内容确实需要该篇幅、且**必须**改 `scripts/doc-budgets.manifest.json`），**禁止**为迁就预算删减必需内容；**(b) 文档门禁事实口径（v7 更正）**：`docs/development.md` 与 `apps/vscode-dsh/README.md` **不在** `scripts/doc-budgets.manifest.json`（当前仅 8 条）内，属 `docs/AGENTS.md:57` 的 "Review governs unbudgeted tiers." 非预算层，**不得**再声称二者"受 `verify-doc-budgets` 约束"；(c) 断言本工作流新增/改动的每个英文文档都有对应 `.zh.md` 与重录的 `.i18n.yaml`（含 `docs/development.md` 的 Node 环境前提与两覆盖面清单）；(d) Agent Note 已落地：`.agents/notes/implemented/{architecture\|process\|testing}/2026-09-15-*.md` + `README.zh.md` + sidecar，且 `.agents/notes/README.md` 的格式要求（`Status:`、双语言、交叉引用为相对链接）被满足；(e) `docs/wiki/VS Code IDE 集成/` 受影响页面已更新（由 `wiki` agent 执行，changelog 追加一条）；(f) **契约复核（按 18 字段与版本策略重述）**：`dsh.test.getDiagnosticsText` 的返回字段集**当 `schemaVersion === 1` 时恰好**等于 `design.md` AD-14 的 **18 字段**清单（由 `apps/vscode-dsh/tests/host-diagnostics.spec.ts` 的契约完整性用例覆盖，随 `pnpm run test -- apps/vscode-dsh` 一同通过），`schemaVersion` 取自产品常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION`，且源码中不存在自由文本回退（`grep` 断言无 `renderedText` / 无把记录 `join` 成字符串后 `return` 的路径）；(g) **生成器自检证据复核（#4）**：`layer-v-shadow-preset.sh --check-shadow-preset` 的留证（实际 `diff` + 两次生成哈希 + 退出码）在 Phase 3 的状态 JSON 或 `artifact-index.md` 中可见，且 shipped preset 未被修改 | 文档门禁 0 退出 + Agent Note 齐备 + wiki 更新 + JSON 契约（18 字段 / 版本策略）在合并后仍成立 + 生成器自检证据齐备 |
| 债务收口 | 静态检查（registry） | 逐条复核 `tech-debt-registry.md`：(a) `DEBT-001` 已从活跃表移出并保留"已由本工作流 Phase 1 交付"的归档说明；(b) `DEBT-002` **已撤销**并在「已解决」表留有撤销说明（原文须写明"用户选择 route A，原生 Diff 可达"）；(c) `DEBT-003` **已撤销且不适用**且在「已解决」表留有撤销说明（须写明"Xvfb 已由用户安装，触发条件（脚本内安装失败）已不存在"，附 2026-09-15 实测证据），活跃表中**不得**出现 `DEBT-003`；(d) **`DEBT-004` 为活跃条目**且写清现象/证据/已定位的窄口径修法/目标工作流，并在 `verification.md` 与 HG-3 汇报中**可见**；(e) Phase 1–3 是否有**未登记**的桩/缺口（若有，**必须** 新增条目）。**禁止** 把已知缺口写成 known gap 后仍判 PASS | registry 与实际代码一致；活跃表**只**有 `DEBT-004`；无未登记缺口；`DEBT-004` 在报告中可见 |

**缺口判定口径（不得打折）**：任何 Phase 1–3 中「未实测」「已削弱」「代理证据」的项，**必须** 在 `verification.md` 显式登记并在 `tech-debt-registry.md` 留有对应条目；对应 AC 的判决**必须**反映该缺口（降低口径判 PASS 属于禁止行为）。

## 约束（来自 design.md 与本 Phase 相关的架构决策）

- 本 Phase 不做产品代码改动（除非回归失败必须修复，此时按 MUST-FIX 回路在 `impl-phase-4-regression-closure` 分支修复并说明）。
- **禁止** 用「已知缺口」解释 AC-34 – AC-37 的任一项失败：失败即失败，必须修复或按流程升级。
- 关于「只跑相关检查」（`AGENTS.md`）：AC-36 / AC-37 属本 Phase 的**明确要求**，因此本 Phase 需要跑全量 `build:lib:host`、`apps/vscode-dsh` 套件与既有回归脚本；其余检查按最小必要范围执行并如实报告执行过的命令。
- Agent Note 属非平凡改动的强制交付物（`AGENTS.md`）；归档/审计流程遵循 `.agents/notes/README.md` 与 `dsh-archive-agent-notes` skill（仅新增，不做归档决策）。
- 文档改动必须成对且重录 `.i18n.yaml`，否则 `verify-translation-pairing` 失败。**文档门禁边界（v7，#9）**：本 Phase **只复核**（`pnpm run doc-sync` 要求退出 0），**不得**在 Phase 4 才首次做预算 / 双语配对 / 引用类修复；`docs/development.md` 与 `apps/vscode-dsh/README.md` **不在** `scripts/doc-budgets.manifest.json`（仅 8 条）内，属 review governs 的非预算层（AD-10）。
- 本 Phase 不新增依赖、不新增应用 `bin`、不修改 `packages/core/agent-loop`。

## 产出清单

| 类型 | 路径 |
|---|---|
| 新增 | `.agents/notes/implemented/<class>/2026-09-15-vscode-dsh-usable-loop.md`（+ `README.zh.md` + sidecar） |
| 修改 | `docs/wiki/VS Code IDE 集成/<受影响页面>.md`、`docs/wiki/changelog.md`（由 `wiki` agent 执行） |
| 修改 | `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md`（`DEBT-001` 归档 + `DEBT-002` 撤销说明 + `DEBT-003` **撤销**说明 + `DEBT-004` 活跃条目） |
| 修改 | 文档门禁所需的 `.i18n.yaml`；**仅当**内容确实需要超出 `scripts/doc-budgets.manifest.json` 的 ceiling 且改动落在该清单内的 8 个预算文件之一时，按 **Relocate → Condense → Raise**（`docs/AGENTS.md:51-55`）的顺序处置，**Raise 必须**显式上调并在本 Phase 的 `implementation.md` 记录理由，**禁止**删减必要内容迁就预算；`docs/development.md` 与 `apps/vscode-dsh/README.md` **不在**该清单内（v7 更正） |
| 证据 | 本次执行的命令清单与退出码（写入 `verification.md`，只报告实际执行过的命令） |
| 过程 | `phases/phase-4-regression-closure/implementation.md`、`repo-exploration.md`、`review.md`、`verification.md` |
