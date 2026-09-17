# Tech Debt Registry

> 这是本工作流中所有已知技术债的 **唯一定义来源**。
> 所有 Phase 的 agent 共写共读。写入新债，读取已有债，解决后更新状态。

---

## 活跃债务

<!--
  ID 格式：STUB-xxx（桩代码）/ GAP-xxx（功能缺失）/ DEBT-xxx（其他技术债）
  状态：🔴 阻塞 / 🟡 非阻塞
  类型：空实现 / 假返回值 / 流程骨架 / 条件桩 / 类型占位
  来源：implementation.md / review.md / verification.md / scope-gap-report.md

  结构化索引字段（标签列）：
  - module:<name> — 所属模块。例：module:gateway
  - type:<stub|gap|debt> — 债务类型
  - concern:<topic> — 关注领域。例：concern:auth, concern:export
  - bind:<binding> — 绑定关系。例：bind:someip, bind:grpc
  标签 + depends_on → agent 精确查询。例：查「标签含 gateway 的 🔴阻塞项」→ 2 条，不扫全表
-->

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|
| DEBT-004 | plan-generator（设计阶段登记，非本工作流实现缺陷） | specdev-presets / ide profile | `packages/specdev/specdev-presets/src/tool-policy.ts:21-27`、`:30`（`ORCHESTRATOR_ALLOW` / `ORCHESTRATOR_WRITE_BLOCK`，模块级 const，plugin 无 `Config`）；`packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml:28-29`（挂载该 policy row） | 出厂 `ide` profile 的**主会话不可写文件**：默认 preset `specdev-orchestrator` 挂载的 `orchestrator-tool-policy` 把模型可见工具收窄为 5 个（`bash`/`glob`/`grep`/`read`/`read_image`），`write`/`edit`/`str_replace_editor` 被 guard 阻断；用户在 VS Code 里让助手改代码时无法写入 | 让 `ide` 主会话可写。**已定位的窄口径修法**：`packages/bundle/ide/cordis.patch.yml` 是 `dsh-base + dsh-sdk-app` 之上的薄 patch 层，可单独覆盖 `agent-presets.config.default`（**须重述全部 config 键**：`default`/`includeShippedRoot`/`includeUserRoot`/`roots`，patch 替换整段 `config`）；blast radius 限于 `ide` profile。**不得** 改 `tool-policy.ts`（会牵连 `sdk`/`headless` 共用的 SpecDev 编排契约） | 功能缺失 | module:specdev-presets, type:debt, concern:tool-policy | `packages/bundle/ide/cordis.patch.yml`、`ide` profile 默认人设 | 下一个处理 preset 策略 / IDE 默认人设的工作流 | 🟡非阻塞 | spikes/native-diff-feasibility.md（§P1.4/G1.4 真机实测工具集 5→25（计数以 `request/header.header.tools` 实测为准；spike 正文的"26"与其自身打印的 25 个工具名自相矛盾）+ 源码事实）+ design.md §6 | 2026-09-15 |
| DEBT-009 | phase-1-node-env-preflight（第 3 轮审查 E-3 发现，**用户裁定承接为债、本 Phase 不改**） | spec 产物（`implementation.md`） | `phases/phase-1-node-env-preflight/implementation.md` §2.3 | 把 `.cursor/skills/project-build/SKILL.md` 归为「not this phase / Pre-existing」——**失实**。调度者实测裁决：该文件 mtime 由 `2026-09-14 17:10` 变为 **`2026-09-15 20:11`**（落在 Phase 1 窗口 16:47–20:12 内）、`git diff` 为 **+25 −2**、含本轮关键词（`invalid-setting`/`24.3.0`/`nodeBin`/`20.16`）命中 **8 处** → **确由本 Phase 的 implementer/verifier 依其 agent 契约写入**（其 `project-build`/`project-test` SKILL 更新义务） | 该条目应归为「本 Phase 改动」。**附带限制**：其 diff **混有 09-14 的旧改动与本轮新改动、无法按内容拆分**；用户已裁定 `.cursor/` 工具树**不随本 Phase 入库**（保持仓库「Phase 提交几乎不含 `.cursor/`」惯例）→ 本轮写入的 Node 版本知识（24.3.0 合格 / v20.16.0 废弃）留在工作区未入库 | 文档归类失实 | module:specdev-artifact, type:debt, concern:classification | 无 | Phase 4 交付收口（或下一轮 spec 校正） | 🟡非阻塞 | review-design.md（E-3）+ 调度者实测（`stat` mtime、`git diff --stat`、关键词计数）；与 review-connectivity.md §8 的「非本 Phase」主张**实测冲突已被裁决推翻** | 2026-09-15 |
| DEBT-011 | phase-2-host-fail-loud-diagnostics（review-correctness 🟡-2 ≡ review.md SF-B；**用户裁定承接为债、本 Phase 不改**） | spec 产物（`implementation.md` 自检表） | `phases/phase-2-host-fail-loud-diagnostics/implementation.md` §9 自检表 | 两处**自述失准**（底层行为均正确，仅表述错）：**(a)** 把「还原第 0 轮 listener guard」的突变结果记为「**2 failures**」，实测为 **3**（`review-correctness.md` §4.6）—— 少报掩盖了一条端到端用例，使人低估该修复的承重面；**(b)** store→reader 那一行把 `records()` 说成 `createStartFailureListener` 的去重读取，实际该 listener **从不调用** `records()`（它比较 snapshot 签名，`apps/vscode-dsh/src/host-diagnostics.ts:289-292`），而 `lastSeq()`（`:393-395`）是 **extension** fallback 读的 | 两处按实测值与实际实现订正 | 文档保真 | module:specdev-artifact, type:debt, concern:doc-fidelity | 无（下游会读 §9 自检表的 agent） | Phase 4 交付收口（或下一轮 spec 校正） | 🟡非阻塞 | review-correctness.md 🟡-2 + review.md SF-B | 2026-09-16 |
| DEBT-012 | phase-2-host-fail-loud-diagnostics（review-design 🟡① ≡ review.md SF-C；**用户裁定承接为债、本 Phase 不改**） | spec 产物（`implementation.md` 偏差台账） | `phases/phase-2-host-fail-loud-diagnostics/implementation.md` §8（12 条偏差台账） | `repo-exploration.md` §8.4 **明文要求**把「`child-exited` **无需**新增 `StartErrorKind` 成员」这一裁定写进 `implementation.md`，实际只落在**代码**里（映射表为全函数 + JSDoc 说明），§8 台账 12 条无一覆盖该裁定 → 未读代码者无从得知这是**已决策**而非遗漏 | 在 §8 台账补一条该裁定的留痕（裁定内容 + 依据） | 文档保真 | module:specdev-artifact, type:debt, concern:doc-fidelity | 无 | Phase 4 交付收口（或下一轮 spec 校正） | 🟡非阻塞 | review-design.md 🟡① + review.md SF-C | 2026-09-16 |
| DEBT-013 | phase-2-host-fail-loud-diagnostics（review-connectivity 列为 SF、review-correctness **明确论证非 SF**、review-design 列为观察 —— 分类分歧已保留在 `review.md`；**用户裁定承接为债、本 Phase 不改**） | vscode-dsh host diagnostics（公共 API 面） | `apps/vscode-dsh/src/host-diagnostics.ts:333-335`（`HostDiagnosticRecorder.setSink()`） | `setSink()` 在**全仓无调用方、无测试**（`grep -rn setSink apps/ packages/` 仅命中自身声明与生成物 `.d.ts`）；sink 实际经**构造器选项**注入（`apps/vscode-dsh/src/extension.ts:429-433`）。**能工作、非桩**，故不构成正确性缺陷 | 二选一：**删除**（构造器选项才是产品路径），或在 JSDoc 中声明其所有者。风险在于保留一个**无消费者且未被测试**的公共 mutator，等于邀请未来调用方静默改道 channel | 死代码/预留面 | module:vscode-dsh, type:debt, concern:dead-api | 无 | Phase 4 交付收口（或下一个处理 host-diagnostics 面 / API 收敛的工作流） | 🟡非阻塞 | review-connectivity.md（SF-D）+ review-correctness.md 🟢-1 + review-design.md 观察 + review.md SF-D；verification.md R-5 独立复现 | 2026-09-16 |
| DEBT-019 | 仓库级（**非本工作流引入**；`phase-3-layer-v-smoke-loop` 的 HG-3 收口审查中由**调度者实测量化**） | 仓库级 lint 基线红（`pnpm run lint` 的**既有**失败） | 全仓 `tsx scripts/run-oxlint.ts .`（基线 = `new/vscode-dsh` @ `300f492f84` 的干净 worktree `/tmp/dsh-base-check`） | **干净 base 树**上 `pnpm run lint` 即 **exit 1**：**2218 条 error / 107 个文件**（`apps/vscode-dsh` **2029 / 88 文件**；`packages/**` 189 / 19 文件）。构成：`no-unsafe-*` **1774（80%）**、`@stylistic` 69、其余 375（`no-unnecessary-type-assertion` 85、`no-unnecessary-condition` 53、`no-non-null-assertion` 41、`no-unnecessary-type-conversion` 29、`no-deprecated` 28 …）。**88 个 apps 文件中 83 个是本工作流从未触碰的** ⇒ 与 Phase 3 无关，也**不由任何 AC 要求**（`spec.md:197` 只要求「lint 不因**新增** `test-scripts/**` 或 hooks 而失败」） | **另立独立工作流治理**（用户 2026-09-17 裁定）。**不得**纳入任一既有 Phase 的范围：`no-unsafe-*` 需补真实类型；`no-unnecessary-condition` / `no-unnecessary-type-assertion` 类**删改会改变运行行为**，须逐处判语义，属独立工程 | 功能缺失 | module:repo-wide, type:debt, concern:lint-baseline | `pnpm run lint` 门禁的可信度；`spec.md:197` 回归行的「全部 0 退出」末列；一切以「lint 全绿」为前提的下游判断 | **独立工作流**（用户裁定「另立工作流专门治理」，**不在本 Phase 内修**） | 🟡非阻塞 | 用户 HG-3 **重裁**留痕：调度者先以「会显著扩大范围」描述成本 → 用户选「在本 Phase 内修复」→ 调度者以实测数据**主动回退**该描述（107 文件 / 2218 条 / 80% 需补类型 / 83 个文件与本工作流无关）→ 用户重裁为「只做本 Phase 自己的」。实测证据：`/tmp/v3-base-gate2.txt`（base 全仓 lint 输出，2218 条 `: error`）、按家族与归属的计数、`/tmp/base-files.txt`（107 文件去重）；决策留痕见 `phases/phase-3-layer-v-smoke-loop/scope-amendment-02.md` §4.2 | 2026-09-17 |


> **`DEBT-014` / `DEBT-015` / `DEBT-016` / `DEBT-017` 已由用户裁定「在本 Phase 内修复」并已迁入「已解决」（2026-09-17，`scope-amendment-02.md` §4.1/§4.2）**：四条均属「**看起来有防线、实际不能失败**」的自证缺口，本轮由 `implementer` 修复并**逐条附可失败性证据**（原始命令与输出见 `phases/phase-3-layer-v-smoke-loop/implementation.md` **§7.7**）：`DEBT-015` 的启动前置断言与 `DEBT-016` 的判决上转由**逐字抽取的 shipped 函数**驱动，`DEBT-014` / `DEBT-017` 直接驱动 shipped 模块并**复用磁盘上真实归档产物**（`test-artifacts/layer-v/.archive/**`）。**活跃表因此由 11 条降为 7 条**（`DEBT-004`/`009`/`011`/`012`/`013` + `DEBT-018`/`019`），其中 `DEBT-018` **按派单「不用碰」未实施、仅复核，故留在活跃表**（理由见其条目下方注记），`DEBT-019` 不在本轮范围。条文级验证方式见「已解决」表。

> **Phase Entry Gate 裁定（2026-09-16，进入 `phase-3-layer-v-smoke-loop` 前）**：调度者按「目标Phase = 本 Phase」筛选后向用户呈现继承债务（🔴 阻塞项 **0 条**），并就 `DEBT-010` 给出三个处置选项（(a) 只评估 + 显式留痕、(b) **在本 Phase 内修复**、(c) 关闭）。**用户选择 (b)**，故 `DEBT-010` 的目标Phase 已更新为本 Phase，修法与下游约束见 `phases/phase-3-layer-v-smoke-loop/scope-amendment-01.md`；实现完成后由 implementer 迁入「已解决」。其余 5 条（`DEBT-004`/`009`/`011`/`012`/`013`）本 Phase **不处理**，其中 `DEBT-004` 的结论**必须**在 Phase 3 的 `verification.md` 中显式呈现。
>
> **`DEBT-005` / `DEBT-006` / `DEBT-007` 已解决（2026-09-15，`phase-1-node-env-preflight` 修复轮）**：三条均由 Phase 1 第 2 轮审查与独立验证产生，**均非功能缺陷**（verifier 判决 `PARTIAL` 时明确记录「无 CRITICAL / MEDIUM 功能缺陷」）。`DEBT-005` 为注释卫生、`DEBT-006` 为机器可读错误归类、`DEBT-007` 为 AC-1 的自动化验证手段缺口。用户裁定 `PARTIAL` 不算通过，implementer 在本 Phase 内直接修复三条，**不是**推迟到 Phase 2 / Phase 4。结论见「已解决」表；本轮证据链见 `phases/phase-1-node-env-preflight/implementation.md`。

> **`DEBT-004` 说明**：本工作流**已用 route A 在测试内绕过**该缺口（`HOME` 沙箱 + 影子 preset，见 `design.md` AD-15），用户**明确裁定不在本工作流内修**（只登记）。因此本条目为 🟡非阻塞，但**必须**在 Phase 4 的 `verification.md` 与 HG-3 汇报中可见。
>
> **活跃表现有 5 条，全部 🟡非阻塞**：`DEBT-004`（ide profile 主会话不可写，用户裁定本工作流不修）、`DEBT-009`（`implementation.md` §2.3 归类失实 + `.cursor/` 工具树不入库的连带后果）、`DEBT-011`/`DEBT-012`/`DEBT-013`（Phase 2 第 2 轮审查的三项 SHOULD-FIX，用户于 HG-3 裁定**承接为债、本 Phase 不回炉**：分别为 `implementation.md` §9 自述失准、`child-exited` 裁定未入 §8 台账、`setSink()` 死公共 API —— 三条**均零行为影响**）。`DEBT-010`（握手**后**的运行期断线不在诊断通道内）**已由用户裁定在 `phase-3-layer-v-smoke-loop` 内修复并移入「已解决」**。`DEBT-008`（E-1/E-2 注释引用失真，零行为影响）**已由用户裁定并入 `phase-2-host-fail-loud-diagnostics` 并修完**（其出错文件均在该 Phase 的 `primary_files` 内），已移出活跃表。`DEBT-001`（已解决归档）、`DEBT-002`（v4 撤销）、`DEBT-003`（v6 撤销）、`DEBT-005`/`DEBT-006`/`DEBT-007`（2026-09-15 在本 Phase 内修复并归档到「已解决」）均不出现在活跃表中；下游 agent **不得**再按条件性登记流程处理 `DEBT-003`（Xvfb 已由用户安装，脚本内不存在安装动作），**不得**把 `DEBT-005`–`DEBT-007` 当作尚未偿还的债。
>
> **v7 修订（用户评审 #3 / #4 / #9）不新增任何债务条目**：`schemaVersion` 契约版本策略与契约完整性用例（#3）、影子 preset 生成器 `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh` + `--check-shadow-preset`（#4）、文档门禁口径更正与早期评估（#9）均为**本工作流内必做的硬要求**（分别落在 Phase 2 / Phase 3 / Phase 1 + Phase 3 + Phase 4 的 spec 中），不是待偿还的债。Phase 1–3 的 implementer / reviewer / verifier **不得**把其中任何一项登记为"已知缺口"或降格为债务；若某 Phase 未完成，应按该 Phase 的 spec 判 `MUST-FIX` / 非 PASS，并在 `implementation.md` 记录，而不是新增 registry 条目绕过。
>
> **`DEBT-014` 新增说明（2026-09-16，`phase-3-layer-v-smoke-loop` round-2 `review-correctness` §C 发现）**：本次新增一条后，活跃表为 **6 条、全部 🟡非阻塞**（上面「活跃表现有 5 条」是本次新增前的计数，未改动原句）。`DEBT-014` 的定性依据：**本 Phase 的 AC 集合未要求构建新鲜度校验**，故它**不是**「本 Phase 未完成」，不构成该 Phase 的 MUST-FIX / 非 PASS；但它是一处**真实的、可致假 PASS 的工具链缺口**（脚本的 PASS 无法自证对应哪一份 bundle，且实测已导致 xvfb 分支的证据来自旧 bundle），因此依 `CLAUDE.md` 的 Tech Debt Registry Rules（*Write on creation* / *reviewer 发现缺陷 → 新增条目*）登记，交由后续 Phase / 工作流处置。本条**不**改变 `phase-3-layer-v-smoke-loop` 任何 AC 的判定。
>
> **`DEBT-015` 新增说明（2026-09-17，`phase-3-layer-v-smoke-loop` verifier 独立验证回合，F8）**：本次新增一条后，活跃表为 **7 条、全部 🟡非阻塞**。定性依据与 `DEBT-014` 同类：**本 Phase 的 AC 集合未要求逐步骤洁净防线"有效"**，故它不构成该 Phase 的非 PASS；但它是**本 Phase 交付面内**的一处真实缺口 —— AD-16 明文承诺「每步必须从干净沙箱产品状态起（否则 `replay` 会让 step3 假通过）」，而承载该承诺的逐步骤判据因时间戳恒 0 而不可达。verifier 本轮**未观测到实际危害**（step-3 的 `scannedFiles=0`、`sendPromptEnvelope={outer:"ok",inner:"ok"}`，无 `replay`），故定级 🟡 而非 🔴。判定依据：`phases/phase-3-layer-v-smoke-loop/verification.md` §E。
>
> **`DEBT-016` / `DEBT-017` 补登说明（2026-09-17，`phase-3-layer-v-smoke-loop` HG-3 收口前，**调度者**执行「Phase Closure 时同步推迟项」）**：本次新增两条后，活跃表为 **9 条、全部 🟡非阻塞**（上面 `DEBT-014` / `DEBT-015` 两段里的「6 条」/「7 条」是各自新增当时的计数，未改动原句）。**补登原因**：这两条是 `review-correctness` round-2 已明确写入 `review-correctness.md` 与 `review.md` 的 **🟡 开放发现**，但**从未进入注册表** —— 而注册表是本工作流技术债的**唯一定义来源**（`CLAUDE.md` §Tech Debt Registry：*Single source of truth*），仅存在于审查报告中的条目会在 Phase 收口后对下游 agent 隐形（`/status`、Phase Entry Gate 筛选、`wiki` 均只读注册表）。故依 *Write on creation* 与调度者「Phase Closure 时同步推迟项」的职责补登，**不新增任何技术判断**，只做位置迁移。
>
> **两条均不改变本 Phase 任何 AC 的判定**：`DEBT-016` 的 AC-33 行按字面为 ✅（索引结构已修为单张连续表，`:2653-2698` 的 4 项校验确实在跑，只是不 fail loud）；`DEBT-017` 的 AC-26 行按字面为 ✅（截图齐备、合法 PNG、稳定命名、ignore 命中）。两者都属「AC 未覆盖的真实缺口」，与 `DEBT-014` / `DEBT-015` 同类定性。
>
> ⚠️ **若用户在 HG-3 改选「立即修」**，这两条应随同 `DEBT-014` / `DEBT-015` 一并回炉，届时按规则迁入「已解决」而非保留在活跃表。
>
> ✅ **该条件已于 2026-09-17 实际成立并结清**：用户改选「在本 Phase 内修」（`scope-amendment-02.md` §4.1/§4.2），`DEBT-014` / `DEBT-015` / `DEBT-016` / `DEBT-017` 四条**已一并迁入「已解决」**（含可失败性证据指针）。本行保留原文以便追溯当时的条件式约定，**不再适用于当前状态**。
>
> **`DEBT-018` 新增说明（2026-09-17，`phase-3-layer-v-smoke-loop` HG-3 收口前，**调度者**独立发现）**：本次新增一条后，活跃表为 **10 条、全部 🟡非阻塞**。本条与 `DEBT-014`/`015`/`016` **同类** —— 都是「看起来有防线、实际不能生效」的自证缺口，且**同类缺口在本 Phase 交付面内已出现 4 次**（`014` 产物新鲜度未校验、`015` 洁净判据恒假、`016` 索引自断言只 note、`018` lint 子项对 `.sh`/`.cjs` 不可失败）。这是一个**系统性观察**，值得在 HG-3 呈现给用户。本条**不**改变本 Phase 任何 AC 的判定：`spec.md:197` 第三子项按**字面**仍可判 ✅（因本 Phase 新增的 3 件资产确实无法使门禁失败 —— 正面验证），但该 ✅ 是**空条件成立**，不具备保护力。

> **`DEBT-018` 工具链更正（2026-09-17，`phase-3-layer-v-smoke-loop` HG-3 收口前，**调度者**一手核实）**：本条自上表起曾把 `pnpm run lint` 的 config 写作 **`.oxlintrc.staged.json`** —— **该表述对 `lint` 链是错的**，已就地更正（该行内 `工具链 = …` 段）。核实依据：① `package.json` 的 `lint = 'npm run build:lib:host && npm run lint:contracts-ready'`、`lint:contracts-ready = 'tsx scripts/run-oxlint.ts .'` —— **不带 `--config`**；② `scripts/run-oxlint.ts` **全文纯透传**（只做 `spawnSync(oxlint, args)`，无 config 注入）；③ ⇒ Oxlint 走**默认发现**，即 **`.oxlintrc.json`**；④ `.oxlintrc.staged.json` 实际属**另一条**链路：`lefthook.yml:21`（pre-commit）与 `package.json:34`（`lint:fix:contracts-ready`）。**为何这条更正重要**：`DEBT-018` 的 `.cjs` 半修复（override）加在 `.oxlintrc.json`，若真实链用的是 staged profile，则该修复就是「**写了但不在执行路径上**」—— 正是本 Phase 反复出现的缺口形态。**更正后结论：override 确在 `pnpm run lint` 链路上且生效**（`git diff .oxlintrc.staged.json` 为空、未改；默认发现口径实测 `number_of_files: 5`、`number_of_rules: 110` —— 本条「证据」栏所引的 `on 1 file with 90 rules` 是 **override 生效前**的旧观测值，**110** 为当前真值）。**遗留残余（供 HG-3 知情，非 §4.1 选项 (a) 未达成）**：`.oxlintrc.staged.json`（**pre-commit profile**）的 `ignorePatterns` 含 `**/*.js`/`**/*.mjs`（不含 `**/*.cjs`）且**无任何 override** ⇒ 提交 `.cjs` 时该 profile **仍产生不了任何诊断**（「0 诊断 ≠ 干净」的老机制在 pre-commit 路径上依然存在）。§4.1 选项 (a) 只点名「`pnpm run lint` **或** `check:ci:static`」，pre-commit profile 属**第三条**链路，未被点名。

> ⚠️ **`DEBT-018` 机制与范围订正（2026-09-17，`verifier` round-3 独立复核之后）**：本条目初版有**三处**不准确，均已就地订正：
> 1. **机制**：初版称 `.cjs`「传入路径时**零输出（未处理）**」—— 实测该文件**被读取解析**（`on 1 file with 90 rules`），零诊断的真因是**无任何规则 override 匹配 `.cjs`**。「0 诊断 ≠ 干净」这一结论**不变**，但归因已更正。
> 2. **范围**：初版称该目录「对 linter **完全不可见** / **物理上无法失败**」—— **范围过宽**。隔离探针（`/tmp/v3-glob-probe/`）证明同目录下 `.ts`/`.tsx` 会被 `apps/**/*.{ts,tsx}` override 正常 lint（**3 条 error**）。**结论方向不变**（本 Phase 新增的 `.sh`/`.cjs`/`.json` 确为空条件成立），但模式层面的断言已收窄，并补 **R-10 风险提示**。
> 3. **前置与孪生**：初版漏了 `pnpm run lint` 的前置 `build:lib:host`；且初版（**含调度者本人**）曾断言「前置构建**生成** 768 个孪生」—— 该**因果未获一手证据支持**（孪生 mtime 为 2026-09-11/09-14，非本轮构建所致），已改为「**既存**孪生、生成链未独立核实」，并以「单个孪生 `packages/core/agent/src/index.d.ts` 独立 lint 产出 **169 条诊断**」正面证明其确在 oxlint 语料内。
>
> **发现来源**：`verification.md`（round-3）§DEBT-018 独立复核 + 观察项 O-4 / O-5；第 3 条孪生**因果**的反证由 `implementer` 在 D18 修订轮提出（**调度者采纳其反驳并更正了自己的表述**）。
>
> ⚠️ **状态订正（2026-09-17，round-5 `implementer` 轮，用户 `scope-amendment-02.md` §8.1 裁定落地）—— 以下三条**取代**上方相关段落的计数与去向声明，原文保留仅供追溯**：
>
> 1. **`DEBT-014` / `DEBT-017` 已由「已解决」迁回「活跃债务」**。上方第 36 行段与第 58 行段的「四条已一并迁入『已解决』（含可失败性证据指针）」**不再成立**：round-4 `verifier`（`verification.md`）与调度者（`scheduler-findings-round4.md`）确认其原「已解决」判定依据不足 —— `DEBT-014` 的可失败性证据只覆盖 **app 半区**（诉求是比较集覆盖 `build:lib:host` 全产物面），`DEBT-017` 的证据止步于**模块层**（模块 → shell 的消费契约无测试驱动）。「已解决」表中两条同 ID 行已就地标记**撤销**并保留原文**仅供追溯**；**有效现状以活跃表为准**。**仅 `DEBT-015` / `DEBT-016` 的「已解决」判定未受推翻**。
> 2. **活跃表当前为 8 条、全部 🟡非阻塞**：`DEBT-004` / `009` / `011` / `012` / `013` / **`014`** / **`017`** / `019`。上方第 36 行段的「由 11 条降为 7 条」、第 44 行段的「现有 5 条」、第 60 行段的「本次新增一条后为 10 条」均为各自时点的历史计数，**不得**用于当前判断。`DEBT-018` 已按用户裁定**迁入「已解决」**（下方第 3 条），故不再出现在活跃表。
> 3. **`DEBT-018` 迁入「已解决」（用户裁定：`scope-amendment-02.md` §8.1 第 5 项）**。迁移**不是**「问题消失」的声明，而是「该条目的**诉求**（让 `spec.md:197` 第三子项对本 Phase 新增资产类型可失败）两半均有承接 + 已给条文级验证方式指针」的结论；**pre-commit profile（`.oxlintrc.staged.json`）无 `.cjs` 规则这一残余，经用户裁定不另立条目，但已在「已解决」表的该行「验证方式」栏内如实留痕**（含 `bash -n` 仅解析级、`shellcheck` 未安装两项边界），**不得**因迁表而静默抹去。上方第 62 / 64–69 行段对该余的原始记录保持有效。
>
> 4. **`DEBT-014` / `DEBT-017` 已完成最终关闭并迁入「已解决」（2026-09-17，round-6 `verifier` 独立验证回合）**。第 1 条所述「已迁回活跃」是 round-5 时点的**中间状态**；两者各自的「关闭条件」已由 `verifier` **独立构造**（非复述 implementer 证据）全部证实 —— `DEBT-014` 三条条件 (i)(ii)(iii) 成立且另补正/负两向对照；`DEBT-017` 双向复现成立且四分支运行时各可达。**活跃表因此降为 6 条、全部 🟡非阻塞**：`DEBT-004` / `009` / `011` / `012` / `013` / `019`。第 2 条所述「活跃表当前为 8 条」是该条写作时点的历史计数，**不得**用于当前判断。
>
> **对下游的硬约束**：`/status`、Phase Entry Gate 筛选、`wiki` 及一切引用注册表的判断，**只**以两张表的**当前行**为准 —— 本节的订正说明属**追溯性注释**，不构成新条目、不改变任何 AC 判定。

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
| DEBT-001 | phase-1-node-env-preflight（原登记，未落入活跃表） | 「扩展缺 VS Code Node 可执行文件路径设置面」——v1 曾以「AC-10 条件前件为假」的方案承接该缺口。HG-2 D-4 否决该方案并把 AC-10 升为 `[Must]`，该能力由本工作流 Phase 1 直接交付 | `phase-1-node-env-preflight`（AD-9 反转） | 2026-09-15 | `apps/vscode-dsh/package.json` 的 `contributes.configuration.dsh.nodeBin` + 三级解析链（`DSH_NODE_BIN` > 设置 > Extension Host Node）+ 无效设置 fail loud；Phase 1 spec 的 AC-10 验证策略 |
| DEBT-002 | phase-3-layer-v-smoke-loop（原为"预计新增"，从未落入活跃表） | **撤销**：「AC-25 第 5 步的 Diff 元数据来自注入而非模型原生」这一预计债务**不再成立**。用户 HG-2（v4）裁定第 5 步走 **route A**（`HOME` 沙箱 + 影子 `specdev-orchestrator` preset，零仓库改动），Diff 元数据为**模型原生 `meta.diffs`**；`spikes/native-diff-feasibility.md` Follow-up §G1.4 已真机实测（模型调用 `edit`、`meta.diffs` 非空且含 `oldText`/`newText`、persona 仍为 SpecDev Orchestrator）。撤销依据：**用户选择 route A，原生 Diff 可达**。同时 v1–v3 的注入构造与 `dsh.test.openHistory` 依赖已从设计中删除 | 设计阶段（v4，未实施） | 2026-09-15 | `spikes/native-diff-feasibility.md` Follow-up §G1.1–§G1.4 实测；`design.md` AD-15（route A 构造 + 证据字段 `diffSource:"native-meta-diffs"`） |
| DEBT-003 | phase-3-layer-v-smoke-loop（原为"条件性登记"，从未落入活跃表） | **撤销**：v5 曾把「AC-28(c) 的 Xvfb 分支未在真机实测（因离线/权限导致 `sudo -n apt-get install -y xvfb` 非 0）」设为**条件性债务**（触发条件不成立时不登记）。**Xvfb 已由用户安装**（2026-09-15 用户指令；实测证据：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在；`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活），且 `requirements.md` 的 AC-28 已明确脚本 **必须不** 尝试通过 `apt`/`sudo` 安装 Xvfb —— **触发条件（脚本内安装失败）已不存在**，该条件性债务**不再可能成立且无需登记**。显示环境顺序收敛为 `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY`；Xvfb 日后不可用/启动失败 → `SKIPPED_NO_DISPLAY` / 退出码 2 + 输出跳过原因，**不得**报 PASS，**不得**判为 `LINK_FAILURE` 或 `HARNESS_ERROR` | 设计阶段（v6，未实施） | 2026-09-15 | 用户指令 + 2026-09-15 实测证据（`design.md` AD-8 环境事实段 / §6 / §7 F5）；`design.md` §10 原冲突点 5 已删除（需求侧已收敛为同一份规范文本） |
| DEBT-005 | phase-1-node-env-preflight | **注释卫生**：测试名/注释中的审查条目码（`S9` / `S5` / `M2`）——`apps/vscode-dsh` 下 4 处（`tests/node-env-guard.spec.ts` 的 `:240`、`:629`、`:664` 与 `tests/auto-start-orchestrator.spec.ts:144`）已全部清除；`AD-9` / `AD-4` / `AD-2` 等 `design.md` 决策编号按本仓惯例**保留** | `phase-1-node-env-preflight`（第 3 轮，本 Phase 内修复） | 2026-09-15 | 证伪探针：`grep -rnE '\((S[0-9]+\|M[0-9]+)[,)]\|// *(S\|M)[0-9]+:' apps/vscode-dsh/` → **零命中**（`AD-*` 不在该模式内）；同时 `grep -nE 'AD-[0-9]+'` 证明 `AD-9`/`AD-4`/`AD-2`/`AD-1` 引用仍在 |
| DEBT-006 | phase-1-node-env-preflight | **机器可读错误归类**：非字符串 `dsh.nodeBin` 曾抛裸 `Error`（无 `kind`），经 `startErrorKindOf` 归一化为 `process-failed`。现 `readNodeBinSetting` 抛 `HostStartError('invalid-setting', …)`；`START_ERROR_KINDS` 新增独立成员 `invalid-setting`（**未**复用 `node-environment`，以保住 `session-host.ts` 的「`diagnostic` 恰好当 `kind === 'node-environment'` 时存在」不变式）；三处文档（`StartErrorKind` JSDoc、`HostStartErrorKind` JSDoc、`design.md`/`design-zh.md` AD-4 错误词表）已同步 | `phase-1-node-env-preflight`（第 3 轮，本 Phase 内修复） | 2026-09-15 | 运行时断言：`dsh.test.requestStart` 快照的 `errorKind === 'invalid-setting'`（`node-env-guard.spec.ts`「classifies a non-string setting as invalid-setting, not a process failure」）。证伪探针：从 `START_ERROR_KINDS` 移除该成员 → 同一用例变红（`expected 'process-failed' to be 'invalid-setting'`）→ 恢复后变绿 |
| DEBT-007 | phase-1-node-env-preflight | **AC-1(b) 自动化证据面**：原用例名含 `AC-1 a, b` 但 (b) 段断言的是 `process.execPath`。现按 spec 验证策略拆为两条：AC-1(a)（恰 1 行、合法 semver、`rangeAdmits`）与 AC-1(b)（在 `/usr/local/n/versions/node/<v>`、`~/.nvm/versions/node/v<v>`、`command -v node` 三处定位被 pin 的 24.3.0，对定位到的解释器调用 `validateNodeEnvironment`，断言 `ok:true` 且 `report.version === pinned`）；三处均无该版本时以 `ctx.skip` 报 **skipped** 并在消息中写出 pin 版本与三处已查路径（不 PASS）。**未**改动 `spec.md` 与 `.nvmrc` | `phase-1-node-env-preflight`（第 3 轮，本 Phase 内修复） | 2026-09-15 | 运行 `node-env-guard` verbose：AC-1(b) 执行并通过（本机命中 `/usr/local/n/versions/node/24.3.0/bin/node` 与 PATH 上的同一解释器）。证伪探针一：把版本名根指向 `~/.nvm/versions/node/v22.14.0/bin/node` → 变红（`was rejected by the pre-flight: expected false to be true`）。证伪探针二：pin 设为本机未安装的 `24.4.0` → 旧形态（`process.execPath` + 仅 `ok:true`）仍 PASS，新形态报 `↓ skipped [no install of 24.4.0 to locate; checked …=absent; …=absent; command -v node=… (24.3.0)]` |
| DEBT-008 | phase-1-node-env-preflight（第 3 轮审查发现；**用户裁定并入 Phase 2**） | **注释/引用保真（E-1 + E-2），零行为影响**：**(E-1)** 设置读取处引 `(AD-10)`，但 `design.md:225` 的 **AD-9** 才是「提供 `dsh.nodeBin` 设置项 + 三级解析链」，`:243` 的 AD-10 是**文档落点**决策——按编号追会落到错误决策。**(E-2)** `session-host.ts` / `auto-start-orchestrator.ts` 的来源句（"Class of a failed `IdeSessionHost.start`" / "the vocabulary `IdeSessionHost.start` throws with"）**不覆盖**成员 `invalid-setting`（该成员实由 `extension.ts` 的 `readNodeBinSetting` 在 `StartHostPort` 层抛出，非 `IdeSessionHost.start` 自身）。修法：引用改 `(AD-9)`；来源句扩为覆盖 `StartHostPort` 层。**只改 JSDoc 措辞，未改类名/成员/行为** | `phase-2-host-fail-loud-diagnostics`（用户裁定并入本 Phase，人工核实随 Phase 1 行号漂移） | 2026-09-15 | 探测 `apps/vscode-dsh/src/`（分别 `grep -rn 'AD-9'` 与 `grep -rn 'AD-10'`）→ 仅 `extension.ts:233`（"Read this extension's settings (AD-9)"）与 `extension.ts:2245`（"Read the `dsh.nodeBin` Node executable setting (AD-9)"）两处命中，且两处都是 `AD-9`（`AD-10` 零命中）；来源句探测：`session-host.ts:54` 与 `auto-start-orchestrator.ts:40` 均含 "or the `StartHostPort` wrapping it"；行为面由既有用例兜底（`node-env-guard.spec.ts` / `auto-start-orchestrator.spec.ts` 全绿） |
| DEBT-010 | phase-2-host-fail-loud-diagnostics（SF-11 ≡ review-connectivity C-2；调度者严重度裁定「A + D」的 D 项） | **握手之后**的子进程死亡（运行期断线）走 `TransportClosedError` + transport-watcher 路径，**不产生**任何 `HostDiagnosticRecord`：全 `src/` 唯一的 `record()` 调用点在 `session-host.ts` 的 `start()` catch 内（握手前），握手后死亡不经此处；`host-diagnostics.ts` 的 `createStartFailureListener` 只覆盖 `failed` 态，无法代偿；`auto-start-orchestrator.ts` 另有一处由编排器自行合成、无生产者的 `failed` 快照。诊断通道因此只反映「启动窗口内」的失败边界 \| 给 `HostDiagnosticRecord.phase` 增加第三成员（`'post-handshake'`）以覆盖运行期断线，同一次改动内把 `HOST_DIAGNOSTIC_SCHEMA_VERSION` `1 → 2`（**未**新增独立记录面；字段集仍 18 个），并让新增记录边携带 `resolvedExecutable` 与 `source`；同一次断线**只允许一条**记录 | `phase-3-layer-v-smoke-loop`（用户裁定「在本 Phase 内修复」；授权依据 `phases/phase-3-layer-v-smoke-loop/scope-amendment-01.md` §1） | 2026-09-16 | **三条独立证据**：① 单元契约 —— `apps/vscode-dsh/tests/host-diagnostics.spec.ts` 的 `post-handshake` 用例（断言 `phase:'post-handshake'`、`retryOfSeq:null`、**字段集恰 18 个**）；② 真机路径集成 —— `apps/vscode-dsh/tests/session-host.spec.ts` 的 `DEBT-010: a runtime death after the handshake records phase post-handshake with the resolved executable`（断言两字段取值来源）与 `... a death while the start is still in flight is recorded once, by the start sequence`（去重）；③ 落点实测 —— `apps/vscode-dsh/tests/layer-v-inject-disconnect.spec.ts`（落点为 Host 死亡边、**恰 1 条**记录、两字段齐备）。**真机证据**：`phases/phase-3-layer-v-smoke-loop/implementation.md` §4 与正向冒烟运行的 `layer-v-status.json` 的 **`postLink` 段**（`postHandshakeRecordCount: 1`、`record.phase: "post-handshake"`、`record.source: "vscode-setting"`、`record.resolvedExecutable` = 24.3.0 绝对路径）。**接线方式**：`dsh.test.injectDisconnect` 改为经 `IdeSessionHost.injectRuntimeDeath()` 制造**真实死亡边**（不再自造 FSM 态），FSM 仍由产品自身的 `onStatusChange → orchestrator.onUnexpectedDisconnect()` 退出（入口未变）；握手前死亡仍由 `start()` catch 记录，两处互斥 → 同一次死亡**只留一条** |
| DEBT-014 | phase-3-layer-v-smoke-loop（round-2 `review-correctness` §C 发现；经**用户裁定「在本 Phase 内修」**） | **构建产物新鲜度未校验** ⇒ 脚本的 PASS 无法自证对应哪一份 bundle（陈旧 bundle 可假 PASS）。修法 = 新增 `layer-v-support/build-freshness.cjs` + 脚本侧 `assert_build_freshness()`；**workspace 半区**（`packages/*/*`、`vendor/*` 的 `<root>/lib` vs `<root>/src`）已纳入比较集，缺失 / 陈旧 / 不可读一律 `ok:false`（fail-closed，不静默通过）。**关闭（2026-09-17）**：verifier 独立构造三条关闭条件全部成立（见「验证方式」栏）。「已解决」判定曾于 round-4 被推翻（当时证据只覆盖 app 半区），本条为**推翻后修复并经独立验证**的最终结论 | `phase-3-layer-v-smoke-loop` | 2026-09-17 | `verifier` **独立构造**（非复述 implementer 证据）：(i) 陈旧 sibling ⇒ `workspace-artifacts-stale` + CLI exit 1；(ii) 未构建 sibling ⇒ `workspace-artifacts-absent` + exit 1；(iii) `members=[vendor/*, packages/*/*, apps/cli, apps/vscode-dsh]`、`uncovered=[]`。**verifier 另补两向对照**（implementer 未做）：负向 = 注入 `apps/new-tool` 必须被报出；正向 = 健康 sibling ⇒ `ok` / exit 0。判据边界如实声明：**mtime 是必要性判据、非充分条件**（不做内容级比对）。溯源：`verification.md`（round-6）§DEBT-014、`scheduler-findings-round4.md` §5、`scope-amendment-02.md` §8.1 第 4 项 |
| DEBT-017 | phase-3-layer-v-smoke-loop（round-2 `review-correctness` 🟡 F10 + **调度者独立发现** + **verifier 独立复现**；经**用户裁定「在本 Phase 内修」**） | **截图证据力判据的消费侧不可运行**：模块 stderr 报告经 `log` 进 stdout ⇒ `action="$( … )"` 把日志行与动作值串成一个字符串 ⇒ `case` 恒落 `*` ⇒ **凡 driver 判 PASS 的运行一律被改写成 `HARNESS_ERROR`/4**；三个 `DISPLAY_EVIDENCE_*` 在子 shell 内赋值 ⇒ 记账恒 null；`DISPLAY_RETRY_REQUIRED` 恒 `false` ⇒ R2.3 的 xvfb 重跑从未执行。修法 = 消费侧抽为 `layer-v-support/display-evidence-shell.sh`（stdout 恒空、动作走变量、**直接调用**禁止 `$( … )`）+ 回归 `tests/display-evidence-shell.spec.ts`。**关闭（2026-09-17）**：verifier 独立复现双向并确认四分支可达（见「验证方式」栏）。「已解决」判定曾于 round-4 被推翻（当时证据止步模块层），本条为**推翻后修复并经独立验证**的最终结论 | `phase-3-layer-v-smoke-loop` | 2026-09-17 | `verifier` **独立复现双向**：缺陷在（`$( … )` 捕获）⇒ 动作词在父 shell 丢失、落 `*`；同一次运行改为**直接调用** ⇒ `pass`。**四分支运行时各有一条可达路径**：`pass`（当次实跑 distinct=5）、`retry`（真实归档 distinct=2 < 3，且置 `DISPLAY_RETRY_REQUIRED=true`）、`skip`（`xvfb` 仍退化）、`*`（fail-closed，帧不足）。AC-26(e) 记账真落到产物：`layer-v-report-meta.json` 的 `displayEvidence` 含 `minDistinctMd5:3, distinctMd5:5, frames:5, action:"pass", attemptCount:1`。溯源：`verification.md`（round-6）§DEBT-017、`scheduler-findings-round4.md` §1–§3、`scope-amendment-02.md` §8.1 |
| DEBT-018 | phase-3-layer-v-smoke-loop（**调度者**在 HG-3 收口审查中独立发现；原状态「按派单不用碰、留在活跃表」→ 用户 §8.1 第 5 项裁定**迁入已解决**） | **让 `spec.md:197` 的第三子项（「`pnpm run lint` 不因新增 `test-scripts/**` 或新增 hooks 失败」）对本 Phase 新增资产类型可失败**，两半各有承接：**`.cjs` 半** = `.oxlintrc.json:341` 的 override（`files: apps/vscode-dsh/test-scripts/**/*.cjs`），5 个 shipped `.cjs` 各 **0 error**，且该 override **确在生效路径上** —— `package.json:31` 的 `lint` = `build:lib:host && tsx scripts/run-oxlint.ts .`，`scripts/run-oxlint.ts` 纯透传（不注入 `--config`）⇒ Oxlint 默认发现 `.oxlintrc.json`（`.oxlintrc.staged.json` 属**另一条**链路：`lefthook.yml:21` pre-commit 与 `package.json:34`，本项未改、`git diff` 为空）；**`.sh` 半** = `scripts/check-test-scripts-syntax.sh`（`package.json:67` `check:test-scripts-syntax` → `scripts/run-gates.ts:312` 纳入 `check:ci:static`），实测 `3 shell asset(s) parse` / 退出码 **0**（**第 5 轮刷新为 `4 shell asset(s) parse`** —— 第 5 轮把消费侧抽出为 `layer-v-support/display-evidence-shell.sh`，见 `implementation.md` §7.8 (7)；`3` 是迁移当时的真值）。同时 `spec.md:197` 的〔修订段 R2〕量程限定已明文收窄为「该子项只覆盖**可 lint 资产**（`.ts`/`.tsx`）；`test-scripts/**` 下的 `.sh`/`.cjs`/`.json` 不在 oxlint 量程内」 | `phase-3-layer-v-smoke-loop`（用户裁定：`scope-amendment-02.md` §8.1 第 5 项 + §7.3 保留四项改动） | 2026-09-17 | **条文级指针**：① `.oxlintrc.json:341`（override；实测 5 个 `.cjs` 各 0 error lines）；② `scripts/run-gates.ts:293/312` → `check:ci:static` 的 `bash -n` 门禁（实测退出码 0）；③ `spec.md:197` 的〔修订段 R2〕量程限定原文。**残余如实留痕（经用户裁定不另立条目）**：**(a)** `.oxlintrc.staged.json`（**pre-commit profile**，第三条链路，未被 §4.1 选项 (a) 点名）**无任何 override** 且 `ignorePatterns` 含 `**/*.js`/`**/*.mjs`（不含 `**/*.cjs`）⇒ 提交 `.cjs` 时该 profile 仍产生不了诊断（「0 诊断 ≠ 干净」在 pre-commit 路径上依然存在）；**(b)** `bash -n` 是**解析级**检查，不覆盖 `shellcheck` 类语义问题（`command -v shellcheck` → 未安装） |
| DEBT-015 | phase-3-layer-v-smoke-loop（**verifier 独立验证回合** F8 发现；经**用户裁定「在本 Phase 内修」**） | **逐步骤洁净判据恒假** —— `plan.runStartedAtMs` 先写进 plan JSON、后才在 `:1251` 赋真实时间戳 ⇒ 驱动侧 `stat.mtimeMs + 5000 < runStartedAtMs` **恒假**，`predates-run` 分支永不触发（AD-16 的「每步从干净沙箱起」承诺只剩 `unreadable` 分支）。修法：`RUN_STARTED_AT_MS` 改为**加载即取真实 instant**（`run-layer-v-smoke.sh:179` → 写 plan `:1289`），并新增 `assert_plan_run_start()`（`:1344`）在拉起 EDH 前**读回**校验 | `phase-3-layer-v-smoke-loop`（授权：`scope-amendment-02.md` §4.1 第 1 项） | 2026-09-17 | `implementation.md` **§7.7 (1)**：shipped `layer-v-driver/sandbox-clean-state.cjs` 的 `runStartedAtMsOf` 对 4 类非法输入（`0` / 负数 / `null` / 非数）各自拒绝；**同一**「1 小时前写入」的沙箱会话 fixture 在 `runStartedAtMs=0` 时 `offenderCount=0`（即旧恒假行为）、在真实 instant 时 `=1` 且 `reason:predates-run`。脚本层用**逐字抽取的 shipped `assert_plan_run_start`**（非重写）：`runStartedAtMs:0` → **`HARNESS_ERROR`/4**，真实 instant → 通过 |
| DEBT-016 | phase-3-layer-v-smoke-loop（round-2 `review-correctness` §B1 / 🟡 F9 发现；经**用户裁定「在本 Phase 内修」**） | **`artifact-index.md` 自断言只 `note` 不失败** —— 写后 4 项结构校验（该行出现恰 1 次 / 落在首个连续表块内 / 其前恰 1 个表头 / 可读性）识别出问题后**不改变** `conclusion` 与退出码。修法：结构判定外置为 shipped 模块 `layer-v-support/artifact-index.cjs`（`planRowWrite` / `inspectRow` / `describeProblem`），脚本侧 `append_index_row` 按**退出码**消费，非 0 → `record_evidence_violation` 把 `PASS` 上转为 `HARNESS_ERROR`。分级依据：结构性写歪属**致命**（失败），非缺陷观察照实记录（见 §10.1 第 11 条） | `phase-3-layer-v-smoke-loop`（授权：`scope-amendment-02.md` §4.1 第 3 项） | 2026-09-17 | `implementation.md` **§7.7 (3)**：shipped 模块三个失败面**各退出码 1** —— 重复行（`rowOccurrences=2`）/ 首个表块内出现第二个表头（`headerRowsBeforeRow=2`）/ 索引缺失（`indexMissing`）；健康写入退出码 **0**。脚本层用**逐字抽取的 shipped `record_evidence_violation`**（非重写）：`CONCLUSION=PASS`/0 → **`HARNESS_ERROR`/4**，而 `LINK_FAILURE`/1 **保持不变** |


> ⚠️ **`DEBT-010` 证据指针订正（2026-09-17）**：上行原文写「`layer-v-status.json` 的 `r1` 段」—— 该键**不存在**（该文件顶键为 `schemaVersion, runId, startedAt, driver, conclusion, failedStep, reason, steps, node, shell, postLink, cleanStateChecks, commands, finishedAt, nodeEnvironmentConstruction, nodeCoverage, logEvidence`，**无 `r1`**）；实测证据在 **`postLink`** 段，故上行已就地订正。**发现来源**：`phases/phase-3-layer-v-smoke-loop/review-design.md`（重派复审）🟢-4 `[文档保真]` —— 属「`implementation.md` 已改、registry 未改」的残留。**底层主张（记录确实存在且字段齐备）为真**，故这是**证据指针失实**，非结论失实，不参与任何判决。

---

## 维护规则

### 谁写入
- **implementer**：创建 `@STUB(phase-N)` 后立即注册到「活跃债务」。编码完成后检查是否有未注册的桩。
- **reviewer**：发现 implementer 未标注的桩/缺陷 → 新增条目到「活跃债务」
- **verifier**：独立验证发现疑似桩或已知缺陷 → 新增条目到「活跃债务」
- **Cursor Agent**（Phase Closure）：从 scope-gap-report.md 中同步推迟项到注册表

### 谁读取
- **code-explorer**（Phase 准备阶段）：读注册表，交叉验证代码中的桩 → 输出到 `repo-exploration.md` §9
- **plan-generator**：设计时检查 registry，确认依赖接口是否已有 stubs
- **implementer**：编码前读 registry，不把桩当真实现
- **reviewer**：审查时对照 registry，已知桩不误报为「发现」
- **verifier**：验证时对照 registry，已知桩跳过行为验证

### 谁更新状态
- **implementer**：实现之前注册的桩 → 从「活跃债务」移到「已解决」
- **reviewer**：确认桩已填实 → 可标记为已解决
- **verifier**：验证通过 → 确认可关闭
- **Cursor Agent**（Phase Closure）：标记不再适用的过时项 → ⚠️ 标记

### 字段规范

| 字段 | 说明 | 必须在 |
|------|------|:--:|
| **ID** | `STUB-N`(桩) / `GAP-N`(功能缺失) / `DEBT-N`(其他) | ✅ |
| **源Phase** | 产生该债的 Phase | ✅ |
| **模块** | 所属模块名 | ✅ |
| **文件:函数:行号** | 精确代码定位 | ✅ |
| **当前行为** | 代码实际做什么，不是意图 | ✅ |
| **预期行为** | 完整实现应该怎么做 | ✅ |
| **类型** | `空实现` / `假返回值` / `流程骨架` / `条件桩` / `类型占位` / `功能缺失` / `已知缺陷` / `性能问题` | ✅ |
| **标签** | `module:<name>`, `type:<stub\|gap\|debt>`, `concern:<topic>`, `bind:<binding>` | ✅ |
| **依赖它的模块** | 哪些模块依赖这个接口；**无依赖时写"无"** | ✅ |
| **目标Phase** | 计划在哪个 Phase 解决 | ✅ |
| **阻塞** | 🔴阻塞 / 🟡非阻塞 | ✅ |
| **来源** | 谁发现的（implementation.md / review.md / verification.md / scope-gap-report.md） | ✅ |
| **注册日期** | ISO 日期 | ✅ |

### 标签规范

- 每个条目必须有 `module:` 和 `type:` 标签
- `concern:` 和 `bind:` 为**可选标签**：**适用时必须填写**（提高查询精度），**不适用时省略该标签**（**不得**填占位值、**不得**填与其他条目相同的泛化值）
- 标签使用英文小写，多词用连字符连接
- 例：`module:auth-service, type:stub, concern:password-reset, bind:email`

### 查询指引（各 agent 如何精确查询）

| Agent | 查询方式 | 示例 |
|-------|---------|------|
| **plan-generator** | 查目标Phase=N AND 阻塞=🔴 → 按标签分组 | "下一 Phase 继承了哪些阻塞债务" |
| **implementer** | 查文件:函数精确匹配 → 已知桩不当真实现 | "我依赖的这个接口是桩吗" |
| **reviewer** | 查文件含当前目录前缀 → 已知桩不重复发现 | "我审查的代码里哪些函数是已知桩" |
| **verifier** | 查阻塞=🔴 且不在已解决表中 → 跳过验证 | "哪些已知问题不需要现在验证" |
| **code-explorer** | 逐行按文件:函数:行号验证代码是否匹配 | "registry 里的桩还在代码里吗" |

### 去重与清理
- 写入前搜索标签和文件:函数避免重复
- Phase Closure 时检查文件路径/函数名是否变化 → 标记 ⚠️ 或更新
- Phase 间传递的债务不重复注册

### Phase Entry Gate 联动
- 进入新 Phase 前，Cursor Agent 读取本文件
- 筛选「目标Phase = 当前Phase」且「阻塞 = 🔴」的条目
- 向用户呈现继承的债务清单，用户确认后正式开始 Phase
- 用户可选：(a) 本 Phase 优先解决 (b) 推迟 (c) 取消
- 根据决策更新 registry 中的目标Phase
