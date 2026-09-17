# Correctness Review — Phase 3 `phase-3-layer-v-smoke-loop`（**round-2 复审**）

## 视角

**Implementation Correctness** — 代码是否正确工作。不评价设计一致性 / 集成连通性 / 视觉（分别属 `reviewer-design` / `reviewer-connectivity` / `reviewer-visual`）。

审查基线：round-1 对照提交 `300f492f84`；当前分支 `impl-phase-3-layer-v-smoke-loop`（`git branch --show-current` 复核通过）；本 Phase `ui: false`。

本轮是**复审**，不是重跑 round-1：round-1 报告（MUST-FIX，1🔴 F1 / 6🟡 F2–F7 / 3🟢 O1–O3）已由我归档至 `<产物>/.archive/review-correctness-round1-20260916T141819Z.md`。实施者在 round-1 之后**改动了产品源码**（`apps/vscode-dsh/src/session-host.ts` mtime `2026-09-16 21:22:57`），故本轮对**整个 Phase 的实现**重新判定；round-1 已 ✅ 且未被回流波及的 AC 在表中显式标注「沿用 round-1」。

## 判决

**SHOULD-FIX**

> 判据：**全部 AC 行均满足**（`AC-11(a)` 的 🔴 F1 已实证修复为 ✅；`AC-13/14`、`AC-10`、`AC-25 step4`、`AC-33` 的新证据均在**本轮源码**的 bundle 上落盘），**零未注册桩**，故不构成 MUST-FIX。但本轮发现 **4 项 🟡**，其中 3 项是**自证面强度不足**的真实缺陷（1 项为可证伪的死断言、1 项为断言只 note 不改结论、1 项为截图证据退化），1 项是既存基线失败仍需在 HG-3 显式接纳 → 按「代码可工作但有边界未覆盖」判 **SHOULD-FIX**（非阻塞：按合并规则 SHOULD-FIX 不回流 implementer，交由 `verifier` + HG-3）。
>
> **未**把「与 `design.md` AD-14 原文（两成员 / 版本 1）不一致」计入（已由 `scope-amendment-01.md` 授权）；**未**把纯「文档保真」类发现计入（见 🟢 O2）。

---

## §A. round-2 八条修复的独立复核（逐条，实测证据）

复核方法：读脚本 / 驱动 / 产品源码的**函数体与守卫位置**、读**真机产物**（`apps/vscode-dsh/test-artifacts/layer-v/` 的 live run `20260916T135716Z-1864170` 与 `.archive/` 下 **39 次**归档运行，其中 29 次保留截图）、核对 `lib/` 与 `src/` 的新鲜度、比对基线树日志。**未**采信 `implementation.md` 的任何自述。

| 项 | 修复内容 | 我的独立复核动作 | 结论 |
|---|---|---|---|
| **A1** | `terminalSide` + `nodeCoverage` | 读 `run-layer-v-smoke.sh:446-542`（`measure_terminal_side` / `assert_terminal_side_evidence`）；读 `extension.cjs:2114-2174`（`assertNodeCoverageSides`，调用点在 `:2398`，非死代码）；读 `corroborate` 的合并字段检测（`:2433-2436`）；读 live 产物 `node` / `nodeCoverage` | **✅ 成立（本轮重验）**。① live `node.terminalSide = {ok:false, judge:"fail", path:…v20.16.0/bin/node, version:"20.16.0", qualified:false, threshold:"AC-4 …", enginesOk:false, apisOk:false, missing:[…], measuredAs:"command -v node in the inherited PATH, before this script prepends…", action:"…export PATH=…", docsAnchor}` —— **判定 + 动作文本 + 锚点齐备**；② 锚点**可解析**是硬断言：`:524-535` 拆 `file#fragment`，要求文件存在 **且** 标题 slug 命中该 fragment，否则 `fail_harness`（该断言在 live run 中通过，本身就是锚点可解析的证据）；③ 自洽性断言 `qualified===ok`、`(judge==='pass')===ok`（`:521-523`），并拒绝「自称合格却无 path」（`:518-520`）；④ **不存在合并结论字段**：live `node` 键恰为 `path/version/source/directory/defaults/dshNodeBin/terminalSide/extensionSubprocessSide`，`nodeCoverage.mergedVerdictFields: []`；驱动与脚本**各自独立实现**该检测（驱动 `assertNodeCoverageSides` + 脚本 `:2433` 的 `/^(ok\|judge\|qualified\|verdict\|conclusion\|status)$/i` 过滤）→ 不是「值恰好为空」而是**实现了检测**；⑤ 断言非恒真：`assertNodeCoverageSides` 走 `problems.push`/`throw harnessError`（`extension.cjs:2121-2135,2160+`），且被 `runAll` 实际调用（`:2398`） |
| **A3** | 驱动增 `runNodeEnvironmentConstruction()`（受控预检失败的启动尝试） | 读 `extension.cjs:1929-2062`（构造主体）、`:1958-2007`（try/poll/分流）、`:2044-2059`（`finally` 还原）、`:2064-2102`（`credentialSkipForConstruction` / `restoreNodeBinSetting`）；读 live `nodeEnvironmentConstruction`；枚举 `cleanStateChecks` | **✅ 成立（本轮重验，本轮回流最大新增风险面）**。① **还原**：`restoreNodeBinSetting` 在 **`finally`** 中调用（`:2044`）→ 成功/失败路径都还原；还原后**回读校验**（`configuration.get(key) !== original` → 返回问题，`:2097-2100`）；**还原失败即 `throw harnessError('node-construction-setting-not-restored')` 且刻意「凌驾于在飞异常之上」**（`:2050-2058`）→ **不存在「fail 路径不还原」的漏洞**。live `settingRestoredTo = /usr/local/n/versions/node/24.3.0/bin/node`（= 链路的合格 Node）✅；② **不变式**：构造在链路**之前**（`:2341` vs `:2344`），且 live `cleanStateChecks` 在 step-2 / step-3 的 `scannedFiles` 均为 **0**（该计数与判定谓词无关，是**扫到几个文件**的裸事实）→ 构造的失败启动**确实未写入任何 session/storage** ✅（注意：implementation.md §6.2 ① 引用的 `cleanStateChecks` 片段见 🟡 F8 —— 其**结论**我用独立口径证实，但**该字段本身不能证伪**该主张）；③ **R1「恰 1 条」未被弱化**：改用**相对计数**（`recordsBeforeCount:0 → recordsAfterCount:1`、`freshRecordCount:1`、`postHandshakeRecordCount:1`，驱动程序按 `beforeSeqs` 差集过滤 `phase==='post-handshake'`）→ 窗口内第二条 post-handshake 记录会使计数变 2 并 fail，**不是恒真**；④ **`credentialSkipForConstruction` 不会被用来把构造失败静默归为 SKIPPED**：它只在①启动快照**正向报告**凭据拒绝（`:1964`）或②轮询超时后**回读**到产品侧 `kind==='missing-credentials'` 记录（`:1999-2005`）时抛出；否则 `throw error`（原始 HARNESS_ERROR，`:2006`）→ 「拿不到记录」不会变成跳过 ✅。live 侧该分流在真机跑通：`135657Z` / `134855Z` = `SKIPPED_NO_CREDENTIALS` / 退出码 3 / `failedStage: node-environment-construction`（**归因到构造阶段**，不是链路失败）✅；⑤ **恰一条 + 绝对路径**：live `nodeEnvironmentRecordCount:1`、记录 `kind:"node-environment"`、`phase:"start"`、`resolvedExecutable="/home/chendc/.nvm/…/v20.16.0/bin/node"`（绝对路径）、`source:"vscode-setting"`、`Object.keys(record).length = 18`；构造内另有硬断言：绝对路径 / `source` 非空 / `phase==='start'` / `missingApis` 为数组 / v1 字段集（`:2010-2027` 失败即 `throw`） |
| **A2** | `dsh.showHostDiagnostics`：仅登记 D9，未改 spec | 读 `implementation.md` §6.1 D9；核对 `spec.md:151` 现状；核对驱动确实使用该命令 | **✅ 登记准确（本轮重验）**。D9 的事实陈述与现场一致（`:151`「任何其它命令名不得出现」与 `:196`「必须断言并执行 `dsh.showHostDiagnostics`」相冲突；该命令是 **HEAD 既有的只读诊断面**，非本 Phase 新增，`:196` 明文授权）；**调度者已就地消解 `:151`**（现文本已将 `dsh.showHostDiagnostics` 列入允许集），故按指示**不**再把它判为缺陷。登记未改 spec 文件 ✅（与我读到的 `spec.md` mtime `21:07` 一致） |
| **B1** | `artifact-index.md` 插入锚 + 写后自断言 | 结构化解析 `artifact-index.md`（管道行分布）；读 `run-layer-v-smoke.sh:2640-2702` | **✅ 结构已修（本轮重验）**，**但自断言不 fail loud（见 🟡 F9）**。结构化实测：文件 69 行，管道行 **25–68 连续 44 行、零断口**，表头 + 分隔行在第 25/26 行，**表后无散文块** → 渲染为**一张**连续表（round-1 F5 的「22 行落在表外」已消除）；散文段已移到表前。插入锚实现为「首个连续表格块的末尾」（`:2653-2661`），并做 4 项写后校验：行出现**恰 1 次**、行落在**首个连续表块内**、其前**恰有 1 个表头**、可读性（`:2684-2693`）。**边界行为**：表不存在 → `indexMissing`；表为空/无表头 → `headerRowsBeforeRow` 计数不符即报问题；表后有散文 → 该行仍落在首块内（判定按「首个不中断的管道块」）→ 三种边界都不会静默写错（但都只 `note`） |
| **B2** | `toolCount !== 25` 升为 `problems` | 读 `corroborate` 的收口逻辑（`:2462-2470`）与 `toolCount` 判定位置（`:2361-2365`） | **✅ 成立（本轮重验）**。`problems` 非空 → `fail_link "corroboration"`（`:2466`）→ `LINK_FAILURE` / 退出码 **1** + `exit_now` ✅（**确实改变结论与退出码**，不是「写进 problems 但仍只 note」）；`warnings` 才只 `note`（`:2468-2470`）。负向分类未被牵连：`135618Z`（重建后，`LAYER_V_FAULT_STEP5_DIFF_COMMAND`）仍为 `LINK_FAILURE` / 1 / `failedStage step-5` ✅；`135657Z`（重建后，缺凭据）仍为 `SKIPPED_NO_CREDENTIALS` / 3 ✅；live `corroboration = {problems:[], warnings:[], toolCount:25}` ✅ |
| **B3** | 显示偏好序 `xvfb-run` → 自拉 `Xvfb` → `SKIPPED_NO_DISPLAY`；`XAUTHORITY` 透传 | 读 `start_xvfb_via_xvfb_run`（`:644-694`）、`start_xvfb`（`:595-636`）、`fail_display`（`:194-198`）、`launch_host` 的环境透传（`:1259-1278`）、`assert_host_argv`（`:1293-1300+`） | **✅ 成立（本轮重验）**。偏好序严格：先 `xvfb-run` 路径，取不到可用 display 才自拉 `Xvfb`，两者都不可用 → `fail_display` → `SKIPPED_NO_DISPLAY` / **退出码 2**（`:195`，**不报 PASS**，且不是 `LINK_FAILURE`/`HARNESS_ERROR`）✅；`XAUTHORITY` **透传**（`:1259-1262` 只在本次分配了带凭据的 display 时加入 `display_env`，由 `env` 传给 `setsid code`），并有 `/proc/<pid>/environ` **回读验证**环境真正生效 ✅；实施者 D12 承认「wrapper 起了 display 但凭据不可读」时**回退**自拉 `Xvfb`（属「wrapper 未提供可用 display」的正确处置，非把 `xvfb-run` 降级）——该回退路径我**未**实跑（见「未能验证」） |
| **B4** | `createStartFailureListener` 真实行为变更登记（D10）+ §3 措辞修正 | 读 `host-diagnostics.ts:306-348`（listener 全体）；读 `implementation.md` §6.2 D10 + §3 第 3 点；查该 listener 的测试覆盖 | **✅ 成立（本轮重验）**。D10 的判据描述与代码逐字吻合：进入时取高水位 `attemptMark = mark()`（`:324/329`），`process-failed` 且 `mark()` **未移动**（说明无 Host 边界为该次失败留下记录）才补写**一条** `kind:'other'`（`:342-346`）；有生产者则 `mark()` 移动 → 直接 `return`（`:344`）→ **互斥**；另有 `signature === recorded` 去重（`:334-335`）；`auto-start-orchestrator.ts` 侧仍**不**写 `record()` ✅。§3 第 3 点措辞已修正为与实现一致（我读 `implementation.md:104`：明确写出「自身不写记录 … 但既有消费者 `createStartFailureListener` 会以高水位 mark() 未移动为判据补写一条 `kind:'other'` —— 见 §6.2 D10」）✅。行为变更本身**正确性成立**，且有 2 条相对顺序用例（`host-diagnostics.spec.ts:504/532/550/606/617/651/693/726`） |
| **B5** | `requireNodeExecutable()` fail loud + `onTransportDeath` 包 `try-catch` | 读 `session-host.ts:776-820`（`onTransportDeath`）、`:1019-1025`（`requireNodeExecutable`）；查测试覆盖；读 live 字段集 | **✅ 成立（本轮重验）**。⚠️ 我重点核了「`try-catch` 是否吞掉 fail-loud 断言」：`onTransportDeath` 的 `try/catch` **包裹的是调用方**（`:781-792`），catch **只在「已 linked 且 `status==='connected'`（post-handshake 边）」时吞**并记入诊断不变量违例，**不阻断 teardown**；而 `'starting'` / `'one-shot'` 两个边**不经过该 catch，仍 fail loud**（`:779-780` 的守卫在 try 之外读 `this.status`）→ 加固**没有自我抵消**。`requireNodeExecutable` 抛错时：post-handshake 路径会被 catch 记录（teardown 不被阻断，属**刻意**：优先保证进程回收），其余路径 fail loud ✅。字段集**仍恰 18**：live `postLink.record` 有 18 键、`fieldSet.missingFields: []`、`Object.keys().length=18` ✅ —— 注意该断言在真机**正常路径**上确实执行成功（记录携带 `resolvedExecutable` / `source`），否则 F1 的证据面会缺字段 |

**A1–A3 / B1–B5 统一结论**：八条修复**全部成立**且均可由真机产物或函数体实测复现，无一条属「自述成立」。

---

## §B. round-1 F3 / F7 的本轮处置

### F3（AC-12(b) / AC-27(a) / AC-28 三分支缺运行证据）→ **部分消解，仍未全绿**

我只核「构造是否真的可运行、代码路径无桩」，**运行证据由 `verifier` 独立补**。为此我枚举了 `.archive/` 下 **39 个**归档运行目录（**38 份** `run-summary.json`）+ live 1 次（`conclusion` / `exitCode` / `failedStage` / `faults` / 截图去重数）：

| 分支 | 运行证据现状 | 我的判定 |
|---|---|---|
| AC-12(b)（`PATH=<fake-node-dir>:$PATH` 反向构造） | **0 次**（无任何运行的 `faults`/构造标记指向该项） | 🟡 **仍缺**（沿用 round-1）——代码路径存在且非桩 |
| AC-27(a)（`DEEPSEEK_BASE_URL` 不可达 → step3 失败） | **0 次**（全量枚举中 `failedStage` 从不等于 `step-3`） | 🟡 **仍缺**（沿用 round-1） |
| AC-27(b)（故障注入 → step5 失败） | `135618Z`（**重建后**）`LINK_FAILURE` / 1 / `failedStage: step-5` / `faults.step5DiffCommand` ✅（另有重建前 3 次） | ✅ 证据在**本轮源码**上 |
| AC-28（xvfb 分支） | `133218Z`(21:32) / `133319Z`(21:33) / `134549Z`(21:46) 均 `PASS` + `mode: xvfb` —— **全部早于重建（`lib/` mtime 21:56:04）** | 🟡 **证据来自旧 bundle**（见 §C） |
| AC-28(b)（`SKIPPED_NO_DISPLAY` / 退出码 2） | **0 次** | 🟡 **仍缺**（沿用 round-1）——`fail_display` 实现已核实为「退出码 2 + 不报 PASS」 |
| AC-32（缺凭据跳过） | `135657Z`（**重建后**）`SKIPPED_NO_CREDENTIALS` / 3 / `failedStage: node-environment-construction` ✅ | ✅ 在**本轮源码**上 |

> 因此 F3 **不能**关闭：三分支里只有 AC-27(b)/AC-32 拿到了「本轮源码」上的证据；AC-28 的 xvfb 证据是**旧 bundle**的；AC-12(b)/AC-27(a)/AC-28(b) 仍**零运行证据**。这正是 round-1 把「补跑」交给 `verifier` 的原因，本轮维持该分工。

### F7（回归全绿字面未达）→ **主张成立：6 条均为既存基线，无一触及本 Phase 改动集**

**动作**：读**本轮源码**上的全量套件日志 `/tmp/lv-round2-apptests.log`（**21:51:36**，晚于 `session-host.ts` 的 21:22:57 改动）、round-1 的基线对照日志 `/tmp/dsh-base-full.log` / `dsh-base-focus2.log` / `dsh-base-spike-alone.log`（均为基线树 `300f492f84`，19:53–19:55）；对 4 个失败文件逐个查 import。

| 失败项 | 条数 | 是否触及本 Phase 改动集 | 基线对照证据 |
|---|:--:|---|---|
| `tests/panel-close-delete.e2e.spec.ts`（VP-1-close / VP-1-delete） | 1 | ⚠️ 该文件 import `session-host.ts`（本轮**确被改动**）——**但在基线树同样失败** | `/tmp/dsh-base-full.log`：`Tests 2 failed` 含同名用例 ✅ → **非本改引入** |
| `tests/verifier-phase1/layer-a-rtl.spec.tsx`（V-A4） | 1 | ❌ 不 import 任何改动文件 | `/tmp/dsh-base-full.log`：同名失败 ✅ |
| `tests/spike-t0a-replay-rebuild.spec.ts`（AC-30/47、AC-76、AC-77、AC-80） | 4 | ❌ 只 import `@deepseek-ai/dsh-llm` / `dsh-session` / `dsh-session-query` / `cordis`（我本轮复核 import 列表） | 基线树**带**工作区既存未跟踪 `vendor/cordis/src/*.js`（mtime 2026-09-11）时复现同 4 条（`dsh-base-focus2.log`）；干净基线树与**单独**跑该文件均全绿（`dsh-base-spike-alone.log`）→ 既存环境/隔离性问题 |
| `tests/spike-t0b-continue-capability.spec.ts`（加载错误、**0 测试**） | 0（只计 `Test Files failed`） | ❌ | 同源同因 |

**当前源码实测**：`Test Files 4 failed | 49 passed (53)`、`Tests 6 failed | 418 passed | 1 skipped (425)`（对照基线树 `2 failed | 412 passed | 415`）。本 Phase 的 **5 个 spec 文件在该次全量运行中全部通过**（`host-diagnostics.spec.ts` / `session-host.spec.ts` / `layer-v-inject-disconnect.spec.ts` / `node-env-guard.spec.ts` / `interaction-approval-resolution.spec.ts` 均不在失败列表），我另跑的 chat-ready 9 文件 **91/91** 亦全绿；文件数 51 → 53 恰为本 Phase 新增的 2 个测试文件。

**结论**：implementer 的核心主张**成立** —— 6 条失败**无一条由本 Phase 改动引入**（唯一 import 交集 `panel-close-delete` 在基线树上同样失败）。但 AC 表写的是「全绿」，字面仍未达 → 仍需在 HG-3 由调度者**以基线结论显式接纳**（🟡 F11）。

---

## §C. 本轮新增风险：构建新鲜度（必审两项）

### C.1 披露是否属实 → **属实，且比自述更精确**

| 待核项 | 实测 |
|---|---|
| 脚本是否缺新鲜度校验 | **是**。`run-layer-v-smoke.sh:2805-2814`（`main()` 前置块）只做**存在性**检查（`[ ! -d "${APP_DIR}" ]`、`[ ! -f "${SHADOW_SCRIPT}" ]`、`[ ! -f "${DRIVER_DIR}/extension.cjs" ]`、`[ ! -f "${DRIVER_DIR}/package.json" ]`），**无** mtime / 哈希比对，全脚本**无**任何构建调用（`pnpm`/`tsbuild`/`extension.js` 在脚本内 0 命中）→ 「跑出 PASS」只证明「磁盘上那份 bundle 通过了」 |
| 重建时刻 | `apps/vscode-dsh/lib/extension.js` mtime **21:56:04**（入口 515 B，`import … from "./extension-sQ-qhJSF.js"`） |
| 本轮新增符号在当前 live 产物中的位置 | `requireNodeExecutable` 在 `lib/**.js` 中**只**出现于 `extension-sQ-qhJSF.js`（×2，= 当前入口 chunk），与 `src/session-host.ts`（×2）一致；旧 chunk `extension-Bngxh6du.js`（16:34）**×0** → 判据有效 |
| 哪些运行在重建之前 | 我按 **runId 时间戳**（不按目录 mtime —— 目录 mtime 是**归档时刻**，会晚于运行）逐条比对：**runId ≤ `20260916T134922Z`（13:49:22Z = 21:49 本地）的全部运行（含 xvfb PASS `133218Z` / `133319Z` / `134549Z`）都早于重建（`lib/` mtime = 13:56:04Z）** → 均跑在旧 bundle 上；**只有 `135618Z`(13:56:18Z，AC-27(b) 负向) / `135657Z`(13:56:57Z，AC-32 跳过) / `135716Z`(13:57:16Z，live PASS) 三次晚于重建** |

**→ 披露属实**：AC-28 的 xvfb 运行证据**确实来自旧 bundle**（三个 xvfb PASS 的 runId 均 ≤ 13:49Z < 重建 13:56:04Z）；AC-11(a)/AC-13/14 等新证据所在的 live PASS 运行**确实在重建之后**（runId `135716Z` = 13:57:16Z > 13:56:04Z）✅。

### C.2 是否登记新技术债 → **已登记 `DEBT-014`**（我唯一的 registry 写入）

`<工作流>/tech-debt-registry.md` 的「活跃债务」表已新增一行 `DEBT-014`（源 Phase = 本 Phase；模块 = 层 V 冒烟工具链（产物新鲜度自证面）；`文件:函数:行号` = `run-layer-v-smoke.sh:2805-2814` + `apps/vscode-dsh/package.json`（`main: lib/extension.js`）；当前行为 = 只查存在、从不构建、PASS 无法自证对应哪一份 bundle；预期行为 = 启动前断言 `lib/**` 不旧于 `src/**`（或可 grep 到本轮新增符号），不符即 `HARNESS_ERROR`，**最低限度**是把 bundle 的 mtime/sha256 落进 `layer-v-report-meta.json`；类型 = 工具链缺口（可致假 PASS）；阻塞 = 🟡非阻塞；目标 Phase = `phase-4-regression-closure`），并在文末补了定性说明段（**不**改变本 Phase 任何 AC 判定）。**未改动任何其它既有条目** ✅。

> 精度备注（**不**回改 registry，故记于此）：`DEBT-014` 里「重建后才产生 3 次有效运行」应读作 **1 次 PASS + 1 次 AC-27(b) 注入失败 + 1 次 AC-32 跳过**（分别为 `…135716Z` / `…135618Z` / `…135657Z`），其中后者两次是**负向/跳过证据**，不是 PASS。

---

## 逐条 AC 验证（标注「本轮重验」/「沿用 round-1」）

| AC | 实现位置 | 判定 | 本轮/沿用 | 证据 |
|---|---|:--:|---|---|
| AC-11(a) 终端侧 | `run-layer-v-smoke.sh:446-542`；`extension.cjs:2114-2174` | ✅ | **本轮重验** | live `node.terminalSide` 含判定 + 动作 + **可解析**锚点（`:524-535` 校验文件存在 + 标题 slug 命中）；`nodeCoverage.mergedVerdictFields: []`；驱动与脚本**各有一份**独立检测实现；断言被 `runAll` 实际调用（`:2398`） |
| AC-11(b) 子进程侧 | `session-host.ts:776-838`；`host-diagnostics.ts:70/131/405/413` | ✅ | **本轮重验** | live `postLink.record`：`phase='post-handshake'`、`source='vscode-setting'`、`resolvedExecutable=/usr/local/n/versions/node/24.3.0/bin/node`（绝对路径、与 `report_meta.node.path` 逐字相同）、18 键、`freshRecordCount:1` |
| AC-12(a) 前置 PATH | `launch_host` + `report_meta` | ✅ | 沿用 round-1（未被回流波及；本轮值同） | `node.path` 落在脚本自前置的候选目录 `/usr/local/n/versions/node/24.3.0/bin`，且 ≠ `defaults.onPath`（v20.16.0） |
| AC-12(b) 反向构造 | — | 🟡 | 沿用 round-1（F3 未消） | 39+1 次运行枚举中**无**该构造；代码路径存在且非桩 |
| AC-12(c) 源内 PATH 前置 | `run-layer-v-smoke.sh:1263-1278` | ✅ | **本轮重验** | `exec env -u DSH_NODE_BIN <XAUTHORITY?> PATH="${NODE_DIR}:${PATH}" HOME=<sandbox> DISPLAY=… VSCODE_DSH_TEST=1 DSH_TEST_BRIDGE_SOCKET=… setsid "${code_bin}" …`（`DSH_PERMISSION_MODE` 未出现）；`assert_host_argv` 从 **`/proc/<pid>/environ` 回读**验证生效，不靠传入假设 |
| AC-23 单命令无人工 | 脚本唯一入口 | ✅（证据侧） | **本轮重验（静态）** | 全脚本唯一 `read` 是 `while IFS= read -r entry`（`:946`，管道/here-doc 读），**无** `read -p` / `</dev/tty`；live 五步顺序 `ok` |
| AC-24 双 `--extensionDevelopmentPath` | `launch_host` + 驱动自证 | ✅ | **本轮重验** | `:1276-1277` 两个 `--extensionDevelopmentPath`（app + driver）；`assert_host_argv` / `assert_host_cmdline` 存在并在 live report-meta 落 `hostCmdline` / `hostEnvVerified` |
| AC-25 step1–step5 | 驱动 5 个 runner | ✅ | **本轮重验** | live `steps` 5×`status:'ok'`、`failedStep: null`；step4 的 `toolCount===25` 已由 B2 升为 `problems`；step5 `diffSource:'native-meta-diffs'`、无注入 |
| AC-25（命令面，静态） | 驱动源码 | ✅ | **本轮重验** | 我按驱动实际调用的命令名逐一对照 spec 白名单：全部命中；`dsh.showHostDiagnostics` 属 HEAD 既有只读面且 `:196` 明文要求（D9 登记，`:151` 已由调度者就地消解）；无 `dsh.test.openHistory`、无 `xdotool`、无 UI 自动化 |
| AC-26 产物 + 稳定命名 + ignore | `.gitignore` 规则 + 驱动截图 | ✅ | **本轮重验** | 5 张 `step-<n>-<slug>.png` 齐备且为合法 PNG（magic bytes + 尺寸下限）、`git check-ignore` 命中**仓库根**规则、`git status --porcelain` 不含该目录（`report_meta.artifactsGitStatus`）。**但**本轮 live 的 5 帧逐字节相同且近乎全黑 → 🟡 **F10**（判定口径字面满足，但像素证据不可用） |
| AC-27(a) step3 失败路径 | 驱动 `StageError`→`LINK_FAILURE` | 🟡 | 沿用 round-1（F3 未消） | 无运行证据；代码路径存在且分类完整 |
| AC-27(b) 故障注入 | 脚本开关 + 驱动 | ✅ | **本轮重验** | `135618Z`（重建后）：`LINK_FAILURE` / 1 / `failedStage: step-5` / `faults.step5DiffCommand:"dsh.definitelyNotARealCommand"`；开关取值非法 → `fail_harness`（`:1099`/`:1104`） |
| AC-28 显示顺序 | `:595-694` / `:194-198` | 🟡 | **本轮重验** | (a) `mode:'reuse'` ✅；(xvfb) 有 3 次 PASS 证据**但均早于重建** → 旧 bundle；(b) `SKIPPED_NO_DISPLAY` 无运行证据；偏好序 + `XAUTHORITY` 透传 + 退出码 2 已核实（B3） |
| AC-29 进程回收（含 Crashpad） | `assert_process_reclamation` / `assert_runtime_residue` | ✅（证据侧） | **本轮重验** | 源码内 `<UD>/Crashpad` 显式匹配 + `pgrep -af '/usr/share/code/'`；teardown 违例把 PASS 单向降级为 `HARNESS_ERROR`（`:200-208`）；live PASS 即该断言通过 |
| AC-30 socket 释放 | `assert_runtime_residue`（`:1748-1793`） | ✅（证据侧） | **本轮重验** | socket 在 `TMP_ROOT`（`mktemp -d`，私有）内；收尾分别断言 socket 路径已释放、临时根已删、本次持有的 bridge 进程已退出（基线差分） |
| AC-31 真实模型往返 | 驱动 step3 + 脚本 | ✅ | **本轮重验** | `rg 'mock|fake|fixture|llm-mock-server|fake-sdk-runtime'` 于**脚本与驱动** → **0 命中**；live `steps[2]` 带响应长度/耗时；无 fixture 替身 |
| AC-32 缺凭据 ≠ 链路失败 | 脚本 + 驱动构造分流 | ✅ | **本轮重验** | `135657Z`（重建后）：`SKIPPED_NO_CREDENTIALS` / 3 / `failedStage: node-environment-construction`；`credentialSkipForConstruction` 仅在**产品侧确实拒绝**时触发（A3 ④）；两结论可区分、均不报 PASS |
| AC-33 文档 + 被追踪索引 | `README.md`/`README.zh.md`/`artifact-index.md` | ✅ | **本轮重验** | 双语四节齐备（产物目录、截图命名 `step-<n>-<slug>.png`、跳过条件、退出码含义）；`report_meta.index = {path:…, tracked:true}`；索引现为**单张连续表**（B1）。**自断言只 note** → 🟡 F9 |
| AC-10 真机补充证据 | 脚本 + `session-host.ts` | ✅ | **本轮重验** | `node.dshNodeBin` 含是否检测到继承值 / 已清除 / 清除后 `printenv` 空值断言；`DSH_NODE_BIN` 由 `env -u` 显式清除；字段级记录由受控构造产出（A3）；`requireNodeExecutable` fail loud（B5） |
| AC-13 / AC-14 补充证据 | 驱动 `runNodeEnvironmentConstruction` | ✅ | **本轮重验** | live `nodeEnvironmentConstruction`：`recordsBeforeCount 0 → recordsAfterCount 1`、`kind:'node-environment'`、`phase:'start'`、绝对路径、`source:'vscode-setting'`、18 字段、`settingRestoredTo` = 合格 Node；脚本侧另有独立复核（`:2441-2454`） |
| 回归（`pnpm run test apps/vscode-dsh` 全绿） | — | 🟡 | 沿用 round-1 | 字面未达：`Tests 6 failed | 418 passed`（**本轮源码**日志 `21:51:36`）。已由基线与 import 双向证实**非本改引入**（§B F7）→ 需 HG-3 显式接纳 |

---

## Stub Detection

| 类别 | 结果 |
|---|---|
| 已注册桩（对照 registry） | **无**。本 Phase 三份产物内零 `@STUB(...)`；`DEBT-010` 在「已解决」；其余活跃债务（`DEBT-004`/`009`/`011`–`013`）均非本 Phase 新增且未被本 Phase 误报；`DEBT-014`（本轮新增）为工具链缺口，非代码桩 |
| 新发现未注册桩 | **0 条**。三处新函数经函数体核验均有真实副作用或硬断言：`measure_terminal_side` / `assert_terminal_side_evidence`（写字段 + 锚点解析 + `fail_harness`）、`runNodeEnvironmentConstruction`（改设置 → 触发启动 → 断言 → `finally` 还原失败 `throw`）、`assertNodeCoverageSides`（`problems`/`throw` 且被调用）。`(void)` 命中均为既有 fire-and-forget 惯用法 |
| 空壳扫描 | 无 `return []` / `(void)args` 型空壳；驱动的 `assertions:{…true}` 均在 `throw` 守卫之后写入 |

---

## 关键发现

### 🔴 Must-Fix

**无。** 全部 AC 行满足（两处 🟡 为「无运行证据」而非「AC 未满足」，其余 🟡 为自证面强度问题），且无未注册桩。

### 🟡 Should-Fix

- **F8 — 步骤级「沙箱产品状态为空」断言的**可证伪性为零**（`plan.runStartedAtMs` 恒为 0）**
  `staleProductState()`（`apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs:579-608`）的判定是 `stat.mtimeMs + 5000 < runStartedAtMs`，而 `runStartedAtMs` 取自 plan（`:581 const runStartedAtMs = Number(plan.runStartedAtMs ?? 0)`）。**实测**：live `layer-v-plan.json` 的 `runStartedAtMs = 0`（`layer-v-status.json` 的 4 条 `cleanStateChecks` 亦全为 `runStartedAtMs: 0`）。**根因**：写入 plan 的语句在 `run-layer-v-smoke.sh:2854 write_plan`，其值来自 `${HOST_LAUNCH_MS}`（`:1185`），而 `HOST_LAUNCH_MS` 直到 `:1251`（`launch_host` 内）才被赋值为 `date +%s%3N`，此前一直是 `:141` 的初值 `0` → **plan 恒写 0**。后果：该谓词对任何文件系统 mtime 都恒为假 → **断言永远不可能失败**（live 在 step-4/step-5 各 `scannedFiles: 2` 却 `offenderCount: 0`），`extension.cjs:2362-2364` 的 `harnessError` 与 `spec.md:199`「每步开始前沙箱产品状态为空 … 断言失败即判 `HARNESS_ERROR`」永远不可达；且驱动对**缺失的时间戳静默取 0**，与本项目「读不出来不得降级」的 fail-closed 纪律相悖。
  **为何不判 🔴**：同一不变式的**实质**由**启动前**的 `assert_clean_product_state`（`run-layer-v-smoke.sh:1035-1052`）真实且 fail-loud 地把守 —— 它同时覆盖 `<sandbox>/.dsh/sessions|storages` **与** `--user-data-dir` 的 `User/{History,globalStorage,workspaceStorage,state.vscdb}`，任何条目 → `fail_harness`（退出码 4）；而「预置了早于启动的 mtime」在当前 `mktemp -d` 沙箱设计中不可能出现（步内新增文件 mtime 必然晚于启动）→ 该步骤级断言在**设计上即冗余**，其失效**未削弱**本 Phase 的任何保证。
  **顺带纠正**：`implementation.md` §6.2 ① 以「`cleanStateChecks` 未触发问题」为不变式证据 —— 该字段**不能证伪**该主张（恒 0）。但主张本身**为真**，我用独立口径证实：`cleanStateChecks` 的 **`scannedFiles`**（裸文件计数，与谓词无关）在 step-2 / step-3 均为 **0** → 构造的失败启动**确实没有写入任何 session/storage** ✅。
  **最小修法**：把 `HOST_LAUNCH_MS="$(date +%s%3N)"` 提到 `write_plan`（`:2854`）**之前**（`launch_host` 复用同一值），**并**在驱动侧对「缺失 / 非正数」的时间戳 `throw harnessError`（不得静默取 0）。
- **F9 — `artifact-index` 的写后自断言只 `note`，不改变结论/退出码**（`run-layer-v-smoke.sh:2679-2698`）
  自断言本身**真实存在**且覆盖四个边界（行出现恰 1 次 / 落在首个连续表块内 / 其前恰 1 个表头 / 结论可读），但「verdict 不可读」与「四项任一不满足」都只走 `note` + `return 0` → 索引被写坏时该次运行**仍可 PASS**（问题只出现在 `report_meta.notes` 与 stderr）。AC-33(b) 要求「断言脚本每次运行后 `artifact-index.md` 被追加一条记录且与实际产物一致」，其文本**未**明文规定失败分类（区别于 AC-10 的「不得降级为提示」），故**不构成 AC 违反**；但与 implementer 自己在 D13/B2 采纳的口径（AC 明文要求的检查应进 `problems`，而非只 note）**不一致**。建议升为 `problems`（→ `LINK_FAILURE`）或在自述中显式登记该降级决定。live 索引**当前是好的**（表连续、`index.tracked: true`）→ 无假 PASS。
- **F10 — 最终 PASS 运行的 5 张「截图证据」为一组逐字节相同的**空白暗屏帧**（`AC-26` 字面满足，证据退化）**
  实测（live run `20260916T135716Z-1864170`，`display {mode:'reuse', value:':1'}`，`PASS` / 退出码 0）：5 张 PNG **md5 全等**（`013661a1487c…`，各 127 977 B，3840×1080），第一帧 p50 亮度 **24** / p90 **41** → 一片几乎全黑的同一静态画面；驱动记录的采集方式为 `driver.screenshot {tool: ffmpeg, args:[… -f x11grab -video_size 3840x1080 -i :1 -frames:v 1 …], mode:"full screen (3840x1080, read from x11grab)"}`，`attempts[0].verdict {ok:true, size:127977}`（**只做尺寸下限**，不做内容有效性）。
  **帧证据普查**（我对 `.archive/` 下**全部 29 次保留 PNG 的归档运行** + live 逐帧算 md5 与亮度分位，本轮新做）：

  | 时段（本地） | 显示模式 | 帧去重数 | 首帧 p50 | 判定 |
  |---|:--:|:--:|:--:|---|
  | 17:05–19:43（`090545Z`…`114328Z`） | reuse | 3–5（= 帧数） | **243–255**，0.4–1.1 MB | **可用的真实界面帧**（`114328Z`：uniq 5、p50 244 / p90 255） |
  | 18:38–18:51（`103829Z`/`104653Z`/`105157Z`） | reuse | 1–2 | 24 | 首次退化 |
  | 21:24 起（`132421Z`…`135618Z`，含 **live**） | reuse | **1** | 24 | 每次都是同一张暗帧 |
  | 21:32 / 21:33 / 21:46（`133218Z`/`133319Z`/`134549Z`） | **xvfb** | 5（各帧 p50 全为 16） | 16 | 5 张互不相同但**同样极暗**；且三次运行的**首帧逐字节相同**（`c3d324dfe721`）→ 更像 Xvfb 初始化噪声，**同样不构成可用界面证据** |

  **→ 退化与「时间 / 物理显示 `:1` 的会话状态」相关，而非与显示模式相关**：本轮实测**推翻**了「切到 xvfb 就能拿到真实帧」的假设（xvfb 三跑同样是暗帧）。非本 Phase 代码变更所致（本轮回流未触碰 `resolveCaptureTool`）。
  影响：AC-26 的判定口径（5 张 + 稳定命名 + 仓库根规则命中）**字面满足**，运行 PASS 也**不依赖**像素（五步由命令级断言驱动），因此**不是假 PASS**；但**本轮 live 证据里没有任何可用的界面像素**，`artifact-index.md` / HG-3 的读者若把「5 张截图」当作「界面被看到过」会被误导（正对应本项目反狡辩表里「DOM 对了、HTTP 200 就以为 UI 没问题」的变体）。
  建议：① 让截图面**拒绝退化帧**（跨帧去重 < N、或亮度/熵阈值不达 → `HARNESS_ERROR`）；② 在运行元数据里记「本次 5 帧的去重数与亮度分布」，使「截图是否具备区分力」在产物层可判定；③ **不要**把「改用 xvfb」当作解法（本轮 xvfb 帧同样不可用）。
- **F11 — 回归「全绿」字面未达，需以基线结论显式接纳**（沿用 round-1 F7）
  `pnpm run test apps/vscode-dsh`（**本轮源码**，21:51 日志）= `Test Files 4 failed | 49 passed`、`Tests 6 failed | 418 passed`。6 条**无一条**由本 Phase 引入（§B F7：`panel-close-delete` / `layer-a-rtl` 在基线树同样失败；4 条 `spike-t0a` 只在带既存未跟踪 `vendor/cordis/src/*.js` 时复现，干净基线树与单独跑均全绿；`spike-t0b` 为加载错误、0 测试）。请在 HG-3 以「基线对照结论」显式接纳，不要默认视为通过。

### 🟢 Observations

- **O1** `requireNodeExecutable()` 的 **fail-loud 分支没有直接单元测试**（全仓 `rg requireNodeExecutable` 仅源码 2 处 + 当前 bundle 2 处，无测试引用）；其**正面路径**已由真机证据走通（记录携带 `resolvedExecutable` + `source`，18 字段齐全），且该分支当前不可达（`session-host.ts:418` 早于任何可到达 `connected` 的 await 赋值）→ 属「加固面的取证边界」，非缺陷。
- **O2 `[文档保真]`** `implementation.md` §7.2 的运行表未标注 `135618Z` / `135657Z` 各自是**负向（AC-27(b) 注入失败）**与**跳过（AC-32）**证据（§7.3 有列，但 §7.2/§9 的「3 次跑在本轮 bundle 上」读起来像三次正向运行）。底层主张为真（三次确实在重建后），零影响 → 按文档保真记，**不计入判决**。
- **O3** `implementation.md` §7.6 声明「文档门禁本轮未重跑，沿用 round-1 结论」——理由（本轮回流未触碰 README / 文档面）与改动集一致，我未复核门禁命令本身（属 `verifier` 范围）。
- **O4** `DEBT-014` 的「3 次有效运行」措辞可更精确（= 1 PASS + 1 负向 + 1 跳过）；我**未**改动该条目（本轮 registry 写入被限定为「新增 `DEBT-014`」），仅在 §C.2 记明读法。

---

## 未能验证 / 边界（明确声明）

1. **未由我重跑真机冒烟**：AC-23/24/25/27(b)/29/30/31/32 的「运行时」性质，是通过**当前源码对应的 live 产物**（`20260916T135716Z-1864170`）+ 39 次归档运行 + 脚本/驱动源码审读判定的；**端到端复跑属 `verifier` 独立职责**，本报告不代替它 —— 特别是 **AC-12(b) / AC-27(a) / AC-28(b) 仍需独立补跑**（`SKIPPED_NO_DISPLAY` 分支一次都没有跑过），**AC-28 的 xvfb 分支必须在重建后的 bundle 上重跑**（现有证据是旧 bundle 的）。
2. **未做任何 git 写操作**（本轮**未**新建对照树；round-1 的只读对照树 `/tmp/dsh-base-check`（detached `300f492f84`）仍在原处，供 `verifier` 复用或由调度者清理）；**未**修改任何产品代码 / 脚本 / 测试 / spec 文件。本报告与 `tech-debt-registry.md` 的 `DEBT-014` 新增行是我**全部**的写入。
3. **未运行「删代码看变红」的证伪探针**（需改产品代码，超出只读审查边界）；`implementation.md` §9 自述的探针结论我仅做逻辑核验，未独立复现。
4. **未实跑 D12 的 `ACCESS_DENIED` 回退路径**（需要「`xvfb-run` 起了 display 但凭据不可读」的环境），仅核实源码的偏好序与回退结构成立。
5. **截图内容无法被判为「界面真的被渲染」**：我只能给出像素级证据（逐字节去重数、亮度分位）说明**本轮 live 帧是同一张空白画面**，而无法证明 EDH 的 UI 在该 display 上是否被绘制过 —— 这正是 F10 要求「让帧的区分力可判定」的原因。
6. **F8 的死谓词是数学结论而非实跑结论**：`mtime + 5000 < 0` 恒假，无需运行即可判定；我**未**通过注入早于启动的文件来实证「断言不会触发」（当前 `mktemp` 沙箱设计下无法构造该前件）。
7. **归档动作说明**：round-1 的 `review-correctness.md` 已由我在本轮启动时归档到 `<产物>/.archive/review-correctness-round1-20260916T141819Z.md`（归档优于删除，未物理删除）；本文件即新一轮产物。`review-correctness-zh.md` 不存在，无需归档。
