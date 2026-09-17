# Phase 3 实现摘要 — `phase-3-layer-v-smoke-loop`

> **第 5 轮（本轮，2026-09-17）授权依据**：`scope-amendment-02.md` **§8（用户裁定六项）** + `scheduler-findings-round4.md`（🔴 BLOCKING 消费侧缺陷）+ 派单四任务（A 修 `DEBT-017` 消费侧 / B §8.1 六项 / C registry 状态订正 / D 文档订正）。
> **本轮同样「追加」而非「归档」**：台账接续 `D24` 之后从 **`D25`** 起编号，见 §1.6 / §6.2 / §7.8 / §8.1a / §8.2a / §10.2。
> **第 5 轮结论**：消费侧缺陷已修并补 **shell 层消费契约回归测试**（`apps/vscode-dsh/tests/display-evidence-shell.spec.ts`，11 例，**双向演示**：缺陷在 ⇒ 8 红 / 修后 ⇒ 11 绿）；§8.1 六项逐项落地（含 `MIN_DISTINCT_MD5` `2 → 3` 与 `homeSandbox` 判据收紧）；registry 状态按实情订正（`DEBT-014`/`017` 回活跃、`DEBT-018` 迁「已解决」）。**本轮未重跑真机链路**（本机无 `DEEPSEEK_API_KEY`），新增证据**全部**为离线可失败性证据，对象是 shipped 代码本身（见 §7.8）。
>
> 分支：`impl-phase-3-layer-v-smoke-loop`（开工复核 `git branch --show-current` ✅，全程未换分支、**未执行任何 git 写操作**）
> 授权依据：`spec.md`（含文末修订段 R1/R2）+ `scope-amendment-01.md`（修订 01 `DEBT-010` + 追加裁定 R1）
> **第 4 轮授权依据**：`scope-amendment-02.md`（四项自证缺口 `DEBT-014`/`015`/`016`/`017` + 截图口径 R2 + 本 Phase 可归因 lint 清零）。
> **第 4 轮「追加」而非「归档」**（对启动自清理协议的**显式已披露偏离**，派单 §硬约束 5 授权）：台账接续 `D18` 之后从 **`D19`** 起编号，见 §1.5 / §6.2 / §7.7 / §8.1。
> 本文件版本：**MUST-FIX 回流轮（`loop_count` 1，第 1 轮）后的更新版**。round-1 全文归档于
> `.archive/implementation-round1-20260916T134255Z.md`（归档优于删除，未物理删除）。
> 结论：**五步真机链路在真实 EDH 上仍 `PASS` / 退出码 0**（**第 4 轮的观测**；本轮未重跑真机链路，本机无 `DEEPSEEK_API_KEY`）；
> `DEBT-010` 修复保持成立（字段集仍恰 18）；
> 回流轮定向修掉 3 🔴 + 5 🟡，其中 **🔴-3（`kind === 'node-environment'` 记录）走受控构造并已构造成功**。
> **第 4 轮另修掉 4 项「防线不能失败」的自证缺口**（`DEBT-014`/`015`/`016`/`017`，每项均附**可失败性证据**）+ 清零本 Phase 可归因的 **54** 条 `no-unsafe-*`；真机链路**未**重跑。

---

## 0. 本轮（回流轮）修了什么 —— 对照表

| # | 审查发现（合并报告编号 / 来源编号） | 修法 | 落点 | 本轮运行证据 |
|:--:|---|---|---|---|
| **🔴-1** | correctness **F1** —— AC-11(a) `terminalSide` 证据面完全缺失 | 脚本新增 `measure_terminal_side()` 与 `assert_terminal_side_evidence()`：在 `node` 段写出**终端侧自己的**判定（`ok` / `judge` / `qualified` / `threshold` / `missing[]` / `action` / `docsAnchor: docs/development.md#node-environment` / `providerQualifiedNodeDir`）；驱动新增 `assertNodeCoverageSides()`：断言**两侧字段同时存在**、各自带判定、**且不存在合并结论字段** | `run-layer-v-smoke.sh:446`（测量）、`:494`（断言）、`:1167`/`:1170`（写入 `node` 段）、`:2412-2420`（协证）；驱动 `extension.cjs:2114-2170`（`assertNodeCoverageSides` + `status.nodeCoverage`） | 真机 `layer-v-status.json`：`node` 键 = `path/version/source/directory/defaults/dshNodeBin/terminalSide/extensionSubprocessSide`；`terminalSide = {ok:false, judge:"fail", path:"/home/chendc/.nvm/versions/node/v20.16.0/bin/node", version:"20.16.0", qualified:false, action:"…export PATH=…", docsAnchor:"docs/development.md#node-environment"}`；`nodeCoverage = {terminalSideJudge:"fail", extensionSubprocessSideSource:"vscode-setting", mergedVerdictFields:[]}` |
| **🔴-2** | design **🔴-1** —— `dsh.showHostDiagnostics` 与 `spec.md:151` 白名单冲突未登记 | **登记**（不改 spec）：见本文 §6.1 **D9** | 本文 §6.1 D9 | `spec.md:196` 明文要求该命令 → 驱动 `extension.cjs:68/1009/1018-1021` 依 `:196` 落地；调度者已在 `:151` 补入允许集 |
| **🔴-3** | design **🔴-2** —— `spec.md:196` 要求 `kind === 'node-environment'` 记录，实现零命中 | **受控构造**（置于五步链路之前）：把 `dsh.nodeBin` 指向一个确定不合格的解释器 → 触发一次受控 `start()` 预检失败 → 断言记录存在（`kind === 'node-environment'`、`resolvedExecutable` 为**绝对路径**）→ **还原**设置为合格 Node → 再跑五步链路 | 脚本 `prepare_unqualified_node()` `run-layer-v-smoke.sh:748`（不合格解释器来源 + 写进 `layer-v-plan.json`）；驱动 `runNodeEnvironmentConstruction()` `extension.cjs:1929`、凭据拒绝分流 `:1904/1964/1999/2004/2076`；协证 `run-layer-v-smoke.sh:2441-2449` | 真机 `nodeEnvironmentConstruction`：`recordsBeforeCount:0 → recordsAfterCount:1`、`nodeEnvironmentRecordCount:1`、`record.kind:"node-environment"`、`record.phase:"start"`、`record.resolvedExecutable:"/home/chendc/.nvm/versions/node/v20.16.0/bin/node"`（绝对路径 ✅）、`settingRestoredTo:"/usr/local/n/versions/node/24.3.0/bin/node"`（还原 ✅）；**构造成功** |
| **🟡-1** | correctness **F5** ≡ design **🟡-1** | 插入锚由「全文最后一行以 `|` 开头」改为「**首个连续表格块的末尾**」并加写入后自断言；`artifact-index.md` 的 `## Reading an entry` 散文移到表**前**；修正 `:8` 措辞为 splice 进表 | 脚本 `emit_report_files()` `:2577`，锚与自断言 `:2611-2614` / `:2690-2691`；`.specdev/specs/vscode-dsh-usable-loop/artifact-index.md`（散文前置 + `:8` 措辞） | 真机连跑 8 次后表格仍为**单块**：`blocks=[{start:25,end:68}]`（1 表头 + 1 分隔 + 42 数据行，末行 = 最新 PASS 运行），每行由脚本自断言「落在首个连续表格块内」 |
| **🟡-2** | correctness **F2** | `toolCount !== 25` 由 `warnings` 提升为 `problems`（硬失败），口径与 AC-25 step4 一致 | `run-layer-v-smoke.sh:2361-2365` | `layer-v-corroboration.json` = `{"problems":[],"warnings":[],"toolCount":25}`；本次值恰 25 → 既有 PASS 结论未被改变 |
| **🟡-3** | correctness **F4** | 实现 AC-28 偏好序：`xvfb-run` 优先（`:590-635`，由 `start_xvfb_via_xvfb_run()` `:644` 执行）→ 回退自拉 `Xvfb` → 两者皆无 → `SKIPPED_NO_DISPLAY`；并把 `xvfb-run` 报告的 `XAUTHORITY` 透传给宿主进程 | 脚本 `:586-635`（偏好序）、`:644-690`（wrapper 分支）、`DISPLAY_AUTHORITY` `:111`/`:678`、`launch_host` 透传 | **真机 `env -u DISPLAY` 运行**（runId `20260916T134549Z-1807615`）：日志 `started a display through xvfb-run on :102 with its credential file`，`report-meta.display = {mode:"xvfb", value:":102"}`，结论 **`PASS` / 退出码 0** |
| **🟡-4** | correctness **F6** | 登记 `createStartFailureListener` 的真实行为变更 + 修正 §3 第 3 点相反措辞 | §6.2 **D10** + 本文 §3 第 3 点 | `host-diagnostics.ts:323-346`（`mark()` 高水位判据 + 补写 `kind:'other'`） |
| **🟡-5** | correctness **O3**（加固） | 记录边**断言** `resolvedExecutable` / `source` 存在（fail loud），并在 `onTransportDeath` 处包 `try-catch` 保证诊断不变量违例不阻断 teardown | `session-host.ts:787`（保护）、`:833`（`recordTransportDeath`）、`:842`（取 `requireNodeExecutable()`）、`:1019`（新断言函数） | 字段集仍**恰 18**；真机 `postLink.fieldSet = {expectedV1Fields:18, actualKeys:18, missingFields:[]}` |

> **不随本轮回流**（已按调度者交接给 `verifier`）：🟡-6（AC-12(b) 反向构造 / AC-27(a) step3 失败路径 / AC-28 的 `SKIPPED_NO_DISPLAY` 分支的运行证据）、🟡-7（回归 6 条既存基线在 HG-3 的显式接纳）。
> 本轮**未**新增技术债、**未**改字段集（仍 18）、**未**加 `kind` 词表成员、**未**改退出码/结论分类契约、**未**改 `spec.md`、**未**动 `scope-amendment-01.md`。

---

## 1. 变更清单

### 1.1 新增 / 修改 — 产品源码 / 测试（round-1）

| 文件 | 内容 |
|---|---|
| `apps/vscode-dsh/src/interaction-coordinator.ts`（修改） | `resolveApproval(id, outcome)`（AD-12）+ 拒绝词表类型 `ApprovalRefusalReason` / 结果类型 `ApprovalResolution`；复用既有 `finishApproval` + `entry.abort.abort()`（先 settle 再 dismiss，避免 `unavailable` 竞态二次回答） |
| `apps/vscode-dsh/src/extension.ts`（修改） | ① `dsh.test.answerApproval` 注册（在 `shouldRegisterTestHooks` 门禁内，`extension.ts:1009`）；② `dsh.test.injectDisconnect` 改为 `host?.injectRuntimeDeath()`（见 §6.2 D5） |
| `apps/vscode-dsh/src/host-diagnostics.ts`（修改） | `HostDiagnosticPhase` 增第三成员 `'post-handshake'`；`HOST_DIAGNOSTIC_SCHEMA_VERSION` `1 → 2`（唯一常量真相源）；`HostDiagnosticInput.phase?` 可选入参；`HostFailureRecorder.lastSeq?()` 契约成员（D6）；`createStartFailureListener` 补写 `kind:'other'` 记录（**D10**） |
| `apps/vscode-dsh/src/session-host.ts`（修改） | `recordTransportDeath()` + `onTransportDeath` 仅当 `status === 'connected'` 时落 `phase:'post-handshake'` 记录（携带 `resolvedExecutable` + `source`）；`injectRuntimeDeath()` 经 `client.close()` 制造真实死亡边；**本轮**：记录边 fail-loud 断言（D11、🟡-5） |
| `apps/vscode-dsh/tests/interaction-approval-resolution.spec.ts`（新增，146 行） | AD-12 六条用例（按 id 回答不影响其它等待 / 未知 id 拒绝 / 词表外 outcome 拒绝 / dismiss 且不二次回答 / fail-closed 后不可回答 / `questions` 不被当作可批准 id） |
| `apps/vscode-dsh/tests/layer-v-inject-disconnect.spec.ts`（新增） | R1.3 落点实测：恰一条 `post-handshake` 记录且两字段齐备；FSM 经产品状态观察退出、重试不重复记录 |
| `apps/vscode-dsh/tests/host-diagnostics.spec.ts` / `session-host.spec.ts` / `node-env-guard.spec.ts`（修改） | 契约完整性随 v2 同步（字段集仍恰 18）；新增 `post-handshake` 契约与去重用例；三文件加 `beforeEach/afterEach` 清除/恢复 `DSH_NODE_BIN`（D7） |

### 1.2 新增 — 层 V 冒烟资产

| 文件 | 内容 |
|---|---|
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（新增，唯一入口、无参数、不读 stdin） | 构建前检、`PATH` 前置（AC-12）、`VSCODE_DSH_TEST=1` + workspace settings、`HOME` 沙箱（route A）、显示环境 `reuse → xvfb-run → Xvfb → SKIPPED_NO_DISPLAY`、`code --extensionDevelopmentPath` 拉起 EDH、zstd 多帧日志抽取、截图、`report_meta.json`、五步协证 `corroborate`、进程/socket/沙箱回收、`artifact-index.md` 表内插入 |
| `apps/vscode-dsh/test-scripts/layer-v-driver/`（新增） | SDK 驱动扩展：**CJS**（`extension.cjs` 入口）、`package.json` **不含 `bin`**、**零 npm 依赖**；五步场景驱动 + 审批回答 + 原生 Diff 校验 + R1 断线取证 + **AC-13/AC-14 受控构造** |
| `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`（新增） | 影子 preset 生成器 + `--check-shadow-preset` 自检（不动 shipped 源） |

### 1.3 新增 / 修改 — 仓库与文档

| 文件 | 内容 |
|---|---|
| `.gitignore`（修改） | 显式规则 `apps/vscode-dsh/test-artifacts/`（AC-26；先落规则后建目录） |
| `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md`（新增，**git 追踪**） | 每次运行的结论 / 退出码 / 五步截图文件名清单（AC-33） |
| `apps/vscode-dsh/README.md`（修改）+ `README.zh.md`（新增）+ `README.i18n.yaml`（新增） | 四节（产物目录 / 截图命名 / 跳过条件 / 退出码）+ 显式清除继承 `DSH_NODE_BIN` + 影子 preset 用法（D3） |
| `.cursor/skills/project-build/SKILL.md`、`.cursor/skills/project-test/SKILL.md`（修改） | 回写本 Phase 新知识（含「冒烟脚本不会替你构建」的坑）与验证状态 + 时间 |
| `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md`（修改） | `DEBT-010` 迁入「已解决」并补足验证方式与剩余边界表述 |

### 1.4 本轮（回流轮）改动

| 文件 | 改动 |
|---|---|
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | ① `measure_terminal_side()` / `assert_terminal_side_evidence()`（🔴-1）；② `prepare_unqualified_node()` + `plan.unqualifiedNode`（🔴-3）；③ `xvfb-run` 偏好序 + `XAUTHORITY` 透传（🟡-3）；④ `toolCount !== 25` → `problems`（🟡-2）；⑤ `artifact-index` 插入锚改为「首个连续表格块末尾」+ 写入后自断言（🟡-1）；⑥ 协证新增 `terminalSide` / `nodeEnvironmentConstruction` 检查（🔴-1、🔴-3）；⑦ 跳过结论的 `failed stage` 改为优先取 `driver_stage` |
| `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` | ① `runNodeEnvironmentConstruction()`（🔴-3）并接在五步链路之前；② `assertNodeCoverageSides()` + `nodeCoverage` 落盘（🔴-1）；③ 受控构造遇凭据门 → `credentialSkipForConstruction`（AC-32 语义，避免把跳过误判为构造失败）；④ `finally` 中设置还原失败优先抛出 |
| `apps/vscode-dsh/src/session-host.ts` | 记录边 fail-loud 断言（🟡-5 / D11）；`onTransportDeath` 包 `try-catch` 保护 teardown |
| `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` | `## Reading an entry` 移到表前；`:8` 措辞改为「splices one row into the run table」 |

### 1.5 本轮（第 4 轮：`scope-amendment-02` §4.1 四项自证缺口 + §4.2 截图口径 + §4.3 lint 清零）改动

> 授权依据：`scope-amendment-02.md`（本轮唯一授权）+ `spec.md` 修订段 R1/R2 + `verification.md`(round-3) §问题清单 P1'–P5 / §L3。
> 本轮**未**重跑真机链路（本机无 `DEEPSEEK_API_KEY`），故 §0 的真机结论仍为上一轮的观测。

| 文件 | 改动 |
|---|---|
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | ① `RUN_STARTED_AT_MS` 改为**加载时**采样真实 epoch-ms（`:179`）并写进 plan（`:1289`）+ 启动前 `assert_plan_run_start()` 断言正有限（`:1344`，读回**已写出**的 plan 而非变量；调用点 `:3086`，失败即 `fail_harness "plan"` → `HARNESS_ERROR` 4）；② `assert_clean_product_state()` 改由 `sandbox-clean-state.cjs` 复扫（`:1097`）；③ 新增 `assert_build_freshness()`（`:1144`）→ `fail_harness`；④ 索引自断言的失败路径统一走 `record_evidence_violation()`（`:257`）：`PASS → HARNESS_ERROR`（退出码 4），其它结论保持不变（**单向上转**），`append_index_row()` 的每个失败分支（`:2927` / `:2938`）都调用它；⑤ 截图判据 `display_evidence_verdict()`（`:2631`）/ `read_display_evidence_floor()`（`:2705`，floor 从模块读、不在此重述）/ `assert_display_evidence()`（`:2723`）+ 退化即回退 `xvfb` 并重试一次（`discard_attempt()` `:3171`）；⑥ `display_evidence_record_json()`（`:2678`）把 `distinctMd5` / `frames` / `mode` / `forced` / `action` / `attemptCount` 落进运行记录的 `displayEvidence` 块（`:2825` 写进 report-meta）；⑦ `append_index_row()`（`:2923`）改走 `artifact-index.cjs` 并**校验返回值**（`:2932-2939`），不再内联拼接 |
| `apps/vscode-dsh/test-scripts/layer-v-driver/sandbox-clean-state.cjs`（新增） | `runStartedAtMsOf()`（拒绝 `0`/非有限/非数）+ `staleProductState()`（`predates-run` / `unreadable` 两类 offender，5s 粒度冗余） |
| `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` | 链**前**校验 plan 的 start instant（不可用即 `harnessError`，`:2281-2287`）；**每步**（`index ≥ 1`）复扫，`offenderCount > 0` → `throw harnessError('step-N-sandbox-product-state-not-clean')`（`:2300-2310`）；结果落盘 `cleanliness` 供脚本协证 |
| `apps/vscode-dsh/test-scripts/layer-v-support/build-freshness.cjs`（新增） | `evaluateBuildFreshness()`：产物存在 + 可读 + 文件数 > 0 + 入口存在 + 入口相对导入可解析 + 产物最新 mtime **不早于**源码最新 mtime，五类失败各有 `reason` |
| `apps/vscode-dsh/test-scripts/layer-v-support/artifact-index.cjs`（新增） | `appendIndexRow()` / `judgeIndexWrite()` / `describeProblem()`：行出现次数恰 1 / 落在首个连续表格块内 / 其前恰 1 个表头（+ `mkTmp` 供测试注入） |
| `apps/vscode-dsh/test-scripts/layer-v-support/display-evidence.cjs`（新增） | `MIN_DISTINCT_MD5 = 2`；`measureFrames()`（帧数恰 5、链接步各 1、可读）+ `judgeEvidence()`（`pass` / `retry` / `fail`，理由必带实测计数） |
| `apps/vscode-dsh/tests/{sandbox-clean-state,artifact-index,build-freshness,display-evidence}.spec.ts`（新增） | 四个模块的集成测试（真实文件系统 fixture，非 mock）。**用例数订正（第 5 轮）**：原句「20 + 15 + 14 + 11 例」为笔误，`review-design` 🟢-1 实测 round-4 时为 **15 / 11 / 9 / 14 = 49**；本轮新增用例后的**当前真值**（逐文件复跑，见 §7.8 (7)）= **25 / 11 / 19 / 16**，加上本轮的 `display-evidence-shell.spec.ts` **11** 例 ⇒ 5 个 spec 合计 **82** |
| `apps/vscode-dsh/tests/tsconfig.json`（新增） | 为 4 个目标 spec 建立类型程序（`include` 显式列举 + `moduleResolution: bundler` + `paths` 指向 `src`），使类型感知规则可解析其符号 |
| `apps/vscode-dsh/tests/{host-diagnostics,node-env-guard,session-host,layer-v-inject-disconnect}.spec.ts` | 为新增/改动行补**真实类型**（具名诊断替身接口、类型化 stub、`as unknown as` → 具名边界接口），清零 54 条 `no-unsafe-*`；无 `eslint-disable`、无 `any`、无新增类型断言消警告 |
| `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md` | `DEBT-014` / `015` / `016` / `017` / `018` 的核实更新（见 §8） |

> **本轮未碰**：`.oxlintrc*.json`、`package.json`、`scripts/run-gates.ts`、`packages/**`、任何非本 Phase 文件、仓库级 lint 基线（`DEBT-019`，2218 条 / 107 文件）。

### 1.6 本轮（第 5 轮：任务 A/B/C/D）改动

> 授权依据：`scope-amendment-02.md` **§8.1（六项裁定）** + §8.2（硬约束）+ `scheduler-findings-round4.md`（🔴 BLOCKING 消费侧缺陷）。本轮**未**重跑真机链路。

| 文件 | 改动 |
|---|---|
| `apps/vscode-dsh/test-scripts/layer-v-support/display-evidence-shell.sh`（新增） | **消费侧**从 `run-layer-v-smoke.sh` 的内联函数中抽出为独立模块（`display_evidence_verdict` `:55`、`display_evidence_reason_text` `:95`、`assert_display_evidence` `:169`），使这条契约可被单独驱动：**stdout 完全为空**（动作经变量 `DISPLAY_EVIDENCE_ACTION` 回传，调用方**不再**用命令替换捕获），模块 stderr 经 `printf … >&2` 直达操作者；`case` 四分支（`pass`/`retry`/`skip`/`*`）齐备，`retry` 置 `DISPLAY_RETRY_REQUIRED="true"`（**任务 A1/A2/A3/A4**） |
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | `source` 该模块（`:284`，路径常量 `:68`）；模块缺失进 `missing` 清单（`:3097`）；**直接调用** `assert_display_evidence`（**不得**用 `$( … )`，否则变量丢失）；`retry` 分支触发 R2.3 的 `xvfb` 重跑 |
| `apps/vscode-dsh/tests/display-evidence-shell.spec.ts`（新增，A5） | **shell 层消费契约回归**（11 例）：真帧 + 真模块 + 真 shell，断言四分支各自可达、`DISPLAY_RETRY_REQUIRED` 语义、运行记录字段反映本次判决；另含「调用方不得用命令替换」的静态契约 |
| `apps/vscode-dsh/test-scripts/layer-v-driver/sandbox-clean-state.cjs` | 新增 `homeSandboxOf(plan)` → `{ok,value}`；`staleProductState(sandboxHome, runStartedAtMs)` 改为**只接受已校验的字符串**，空 ⇒ `TypeError`（**🟡-1**） |
| `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` | 链前 `homeSandboxOf(plan)` 不可用 ⇒ `harnessError('sandbox-clean-state-check-unavailable')`（`:2293-2299`）；每步复扫改传 `sandboxHome.value`（`:2312`） |
| `apps/vscode-dsh/tests/sandbox-clean-state.spec.ts` | 期望由「空即干净」改为「**空即拒绝**」（`:196-202`，原期望的替换理由就地注释）；新增 7 类不可用 `homeSandbox` 的 `it.each` 与「指向文件而非目录」用例 |
| `apps/vscode-dsh/tests/display-evidence.spec.ts` | 补 `:40` 行尾逗号（`@stylistic(comma-dangle)`，**🟡-5 / U-a**）；边界用例钉住新下限 |
| `apps/vscode-dsh/test-scripts/layer-v-support/display-evidence.cjs` | `MIN_DISTINCT_MD5` `2 → 3`（**🟡-3**）；`:10` 与 `:40-44` 的注释同步改写为新裁定与「机制未变、只是数字变了」的说明 |
| `apps/vscode-dsh/test-scripts/layer-v-support/build-freshness.cjs` | workspace 半区（`packages/*/*`、`vendor/*` 的 `lib` vs `src`）纳入比较集，缺失 / 陈旧 / 不可读一律 `ok:false`（**🟡-4 / U-b**）；边界（mtime 是必要性判据）如实声明 |
| `apps/vscode-dsh/tests/build-freshness.spec.ts` | 新增 workspace 半区的三态用例（未构建 / 陈旧 / 健康） |
| `apps/vscode-dsh/tests/tsconfig.json` | 加 `display-evidence-shell.spec.ts` 到 `include`（9 项）；头注释改为**可复核口径**（含两条 `tsc` 数目的测量形状），去掉不可复现的因果句（**任务 D，见 D33**） |
| `scripts/oxlint-contract.spec.ts` | 把 `apps/vscode-dsh/tests/tsconfig.json` 的归属做成**被断言的契约**（**🟡-2**，形态见 **D28**） |
| `.specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/spec.md` | 阈值措辞 `≥2` → `≥3`（AC-26(e) / AC-28 R2 的〔修订段 R2〕） |
| `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md` | 状态订正：`DEBT-014`/`017` 回「活跃债务」并给关闭条件；`DEBT-018` 迁「已解决」并留痕 `.cjs` 残余（**任务 C + U-c**） |
| `.specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/scope-amendment-02.md` | 追加 **§8.4**（`DEBT-018` 关闭的落地留痕，含 pre-commit profile 无 `.cjs` 规则的残余） |
| `.cursor/skills/project-test/SKILL.md` | 回写本轮新知识（**shell ↔ 模块消费契约的驱动形态** + **`oxlint --tsconfig` 会跳过非该程序内文件**）；「`pnpm exec vitest` 需 Node 24」**已在册**（该文件既有条目）⇒ 本轮**只引用、未重复登记**（遵循技能内「同一事物的多条记录应合并」规则） |

> **本轮未碰**：`.oxlintrc*.json`（只读复核）、`package.json`、`scripts/run-gates.ts`、`packages/**`、`spec.md` 的 AC 语义与归属、`design.md`、`scope-amendment-01.md`、仓库级 lint 基线（`DEBT-019`）。
> 证据文件（scratch probe 与原始输出）全部落在**被 `.gitignore` 忽略**的 `apps/vscode-dsh/test-artifacts/layer-v/.probe/`，**不进入交付物**。

---

## 2. 对每条验收标准的实现说明

| AC | 实现方式 | 可检视证据 |
|---|---|---|
| **AC-11(a)** 终端侧 | **本轮补齐**：`measure_terminal_side()` 以「本 shell 会拿到的默认 `node`（`command -v node`，在脚本前置候选目录**之前**测量）」为准，写 `node.terminalSide`：绝对路径 / 版本 / `qualified` / `threshold`（AC-4：`engines.node` + `node-env-guard` 探测的 API）/ `missing[]` / **终端侧需执行的动作** / `docsAnchor`；`assert_terminal_side_evidence()` 断言这些字段齐备且锚点可解析；驱动 `assertNodeCoverageSides()` 断言两侧同时存在、**无合并结论字段** | 真机 `node.terminalSide`（`judge:"fail"`、`qualified:false`、`path` = 默认 v20.16.0 绝对路径、`action` 为 `export PATH=…` 文案、`docsAnchor:"docs/development.md#node-environment"`）+ `nodeCoverage.mergedVerdictFields:[]` |
| **AC-11(b)** 扩展子进程侧（R1 补充证据） | 设置项 `dsh.nodeBin` = 24.3.0 绝对路径（脚本写 workspace settings，并**清除**继承的 `DSH_NODE_BIN`）；五步链路完成后的受控断线产出**字段级**记录 | 真机：`node.extensionSubprocessSide = {ok:true, judge:"pass", resolvedExecutable:<24.3.0 abs>, source:"vscode-setting", recordPhase:"post-handshake"}`；`postLink.postHandshakeRecordCount = 1`、`postLink.fieldSet = {expectedV1Fields:18, actualKeys:18, missingFields:[]}` |
| **AC-12** 脚本前置 `PATH` | 脚本在拉起源进程前解析合格解释器并把其 `bin` 目录前置到 `PATH`；解析失败 → `HARNESS_ERROR` | `report_meta.json.node`（`resolved` / `source` / `version`）；`node.defaults.distinctFromUnprependedDefault:true` |
| **AC-13 / AC-14** 诊断记录面（补充证据） | **本轮补齐受控构造**：五步链路**之前**把 `dsh.nodeBin` 指向确定不合格的解释器 → 断言 `kind === 'node-environment'` 且 `resolvedExecutable` 为绝对路径 → **还原**设置；v2 版本号由唯一常量产出 | 真机 `nodeEnvironmentConstruction.record`（见 §0 与 §4）；`schemaVersion = 2` 取自常量 |
| **AC-23** 单命令、无人工 | `bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`，无参数、不读 stdin | PASS 运行日志 `[step-1..5]` 顺序 |
| **AC-24** `code --extensionDevelopmentPath` | 以 `code --extensionDevelopmentPath=<repo>/apps/vscode-dsh` 拉起 EDH（`/proc` 命令行二次核验） | `report_meta.json` 的 `launch` 段 + 宿主命令行断言日志 |
| **AC-25** 五步 + 断言证据 | ① 启动 → `getStartState === 'started'`；② 新会话 → 数量 / 激活 tab；③ 真实模型往返 → assistant 消息 + 工具调用 ≥1；④ 审批 → `approval/asked` + 默认权限探针被沙箱拒绝 + 升级后 `allowed-once`；⑤ Diff → **模型原生 `meta.diffs`** + 磁盘一致 + `dsh.reviewWorkspaceDiffs` 可达。**step4 的 `toolCount === 25` 本轮升为硬失败（🟡-2）** | 真机 `steps[0..4].status = ok`（`step-1…step-5` 全 `ok`）；`corroboration = {problems:[], warnings:[], toolCount:25}`；step5 `evidence.diffSource = "native-meta-diffs"` + hunk `oldText/newText` |
| **AC-26** 固定产物目录 + 稳定文件名 + 显式 ignore | 截图落 `apps/vscode-dsh/test-artifacts/layer-v/`，命名 `step-<n>-<slug>.png`；根 `.gitignore` 显式规则（先于产物落盘断言） | 运行日志 `ignore rule verified before any artifact exists: .gitignore:52:…`；`git status --porcelain` 无输出 |
| **AC-27** 任一步失败 → 非零退出 + 步骤名 + 不报通过 | 失败按门禁层归类，输出 `FAILED STEP` / `reason` / `failureEvidence` | 本轮 AC-27(b)：`LINK_FAILURE` / 退出码 1 / `failed stage: step-5 — step-5-review-command-failed` |
| **AC-28** 显示环境顺序 | `reuse` → `xvfb`（**优先 `xvfb-run`，失败才自拉 `Xvfb`**）→ `SKIPPED_NO_DISPLAY`(2)；**无** `apt`/`sudo` | 两条真机证据：`mode='reuse'`（`DISPLAY=:1`，此时 `xvfb-run` **未**被调用，符合「优先复用既有 display」）；`mode='xvfb'` + `xvfb-run` on `:102 with its credential file`（`env -u DISPLAY`，runId `20260916T134549Z-1807615`，PASS）；`SKIPPED_NO_DISPLAY` 分支仍待 verifier |
| **AC-29** 进程回收 | 结束后按运行自有归属（沙箱 `HOME` / 进程组）回收 EDH 及子进程并核对残留 | `report_meta.processResidue` + 运行日志 `process reclamation verified (AC-29 i-iv)` |
| **AC-30** 临时 bridge socket 释放 | 运行前分配临时 socket 路径、结束后删除并断言不存在 | 运行日志 `bridge socket released and temporary root removed (AC-30)` |
| **AC-31** 真实模型往返 | 凭据可用时步骤 3 为真模型往返（禁 fixture/替身） | step3 `status ok` + 会话日志 assistant/工具帧；`rg 'fake-sdk-runtime|llm-mock-server|fixture'` 于脚本/驱动 → 0 命中 |
| **AC-32** 缺凭据 ≠ 链路失败 | 凭据门拒绝时 → `conclusion=SKIPPED_NO_CREDENTIALS`、退出码 **3**、`reason=missing-credentials`，不计 `LINK_FAILURE`；**受控构造遇上凭据门时同样归为跳过**（`credentialSkipForConstruction`） | 本轮真机负向：退出码 **3**、`failed stage: node-environment-construction — missing-credentials`、`host diagnostics: kind=missing-credentials \| phase=start`。**构造方式更正**见 §6.2 D15（凭据来自**扩展宿主** `process.env`；仅改 cwd 无效，脚本 `:1264` 会 `cd "${REPO_ROOT}"` 拉起宿主）。另：跳过时的 `failed stage` 由 round-1 的 `step-1` 改为取 `driver_stage`（更准确 —— 宿主根本未启动），**不改退出码/结论分类** |
| **AC-33** 文档 + git 追踪的产物索引 | README 四节 + 每次运行 splice 一行进 `artifact-index.md`（时间 / 目录 / 结论 / 退出码 / 五步文件名；缺截图写 `—`） | `artifact-index.md` 表格为**单块**（`blocks=[{start:25,end:68}]`，表头恰 1 组），末行 = 本轮 PASS 运行；文件被 git 追踪 |
| **AC-10 补充证据** | 「扩展子进程侧」的 Node 修复可被独立判定：`node.dshNodeBin` 含 `inherited/unsetPerformed/printenvAfterUnset/assertion`（脚本显式清除 + 空值断言）+ AC-11(b) 字段级记录 | 真机 `node.dshNodeBin` + `node.extensionSubprocessSide` |

---

## 3. `DEBT-010` 修复结果（本 Phase 内完成）

**修法**（未新增记录面、未加字段、未改 `kind` 词表）：

1. `HostDiagnosticPhase` = `'start' | 'retry' | 'post-handshake'`（第三成员表达「握手后 / 运行期」边界）。
2. 同一次改动内 `HOST_DIAGNOSTIC_SCHEMA_VERSION` `1 → 2`。
3. 补齐缺失的记录边：
   - `session-host.ts` `onTransportDeath`：**仅当** `status === 'connected'`（握手已成功）时落一条 `phase:'post-handshake'` 记录，并携带 `resolvedExecutable`（= 启动时 `resolveNodeExecutable` 的产物）与 `source`；
   - **【本轮修正措辞】** 编排器自行合成的 `failed` 快照（`auto-start-orchestrator.ts:225-229`）**自身不写记录**（保持「无生产者即无记录」，避免第二条通道）；但该快照的**既有消费者** `createStartFailureListener`（`host-diagnostics.ts:323-346`）会以高水位 `mark()` 未移动为判据，为它补写**一条** `kind:'other'` 记录 —— 见 §6.2 **D10**。round-1 此处曾写作「不写记录」，与已交付行为相反，本轮更正。
4. 去重：握手**前**的死亡由 `start()` catch 记录（`phase: 'start'`），`onTransportDeath` 在 `status !== 'connected'` 时**不**记录 → 同一次失败只留一条。

**三条独立证据**（已落为可重跑用例，round-2 复跑仍全绿）：

| # | 证据 | 位置 | 断言 |
|---|---|---|---|
| ① | 单元契约 | `tests/host-diagnostics.spec.ts:404`；同文件 `:122` 字段集**恰 18**、`:177` 版本取自唯一常量 | `phase:'post-handshake'`、`retryOfSeq:null`、字段集恰 18、版本 = 常量 |
| ② | 真机路径集成 | `tests/session-host.spec.ts:455` / `:502` | 两字段取值来源正确；**同一次死亡只记录一条** |
| ③ | 落点实测 | `tests/layer-v-inject-disconnect.spec.ts:123` / `:156` | 落在 post-handshake 死亡边、恰一条且两字段齐备；重试不重复记录 |

**已核实的边界（照实登记）**：`onStartSucceeded()`（`host-diagnostics.ts:341-343`）只重置失败链、**不写记录**；`records()`（`:385-387`）只返回 `record()` 推入项 —— 故「成功启动 + `getDiagnosticsText`」必然为 `[]`，该现象**合法**（见 §5.2）。

---

## 4. AC-13 / AC-14 受控构造（本轮新增，**已构造成功**）

**为什么必须构造**：`NodeEnvironmentError` 全仓**只有一个抛出点** `apps/vscode-dsh/src/node-env-guard.ts:157`（`start()` 的 `preflight`），因此 `kind === 'node-environment'` 记录**只可能**由「Node 不合格导致的启动失败」产生；而绿灯运行要求 Node 合格 → 在正常链路里**结构上不可得**。`spec.md:196` 的该子句**不在** R1 授权范围（`scope-amendment-01.md` §4 明文未改 AC-10/AC-13/AC-14），故**依然生效** → 走**受控构造**（= 忠实实现既有 AC），而非删改子句。

**构造步骤（真机执行顺序）**：

1. 脚本在五步链路**之前**挑一个「确定不合格」的解释器并写入 `layer-v-plan.json` 的 `unqualifiedNode`：优先用**本 shell 默认 `node`**（本机 = `/home/chendc/.nvm/versions/node/v20.16.0/bin/node`，`kind:"default-path-node"`），否则退化为一个 v20 语义替身（`prepare_unqualified_node()` `:748`）。
2. 驱动 `runNodeEnvironmentConstruction()`（`extension.cjs:1929`）读该路径 → `vscode.workspace.getConfiguration().update('dsh.nodeBin', …)`（产品侧 `extension.ts:2352` 每次 `start()` **现读**该设置）。
3. 经 `dsh.test.requestStart` 触发一次受控启动 → 预检拒绝 → 轮询诊断，断言**恰一条** `kind === 'node-environment'`、`resolvedExecutable` 为**绝对路径**、`source = 'vscode-setting'`、`startState.errorKind === 'node-environment'`。
4. **还原** `dsh.nodeBin` 为脚本预置的合格 Node，并**断言还原成功**（`finally` 中还原失败优先抛出，避免带着错设置继续跑）。
5. 之后才进入五步链路。

**硬约束遵守情况（逐条）**：

| 硬约束 | 遵守方式 | 证据 |
|---|---|---|
| ① 不破坏「每步开始前沙箱产品状态为空」 | 构造发生在**链路之前**且只触发一次启动尝试；其失败快照不产生会话/存储；链路的 clean-state 检查在构造之后按原逻辑执行（本轮 8 次运行均未触发 clean-state 问题） | 运行日志 `cleanStateChecks` 段 + 结论 PASS |
| ② 不破坏 R1 的「恰 1 条 `post-handshake`」 | 驱动改用**相对计数**：`recordsBeforeCount`（构造前）→ `recordsAfterCount` → `freshRecordCount` / `nodeEnvironmentRecordCount`（只看增量），`post-handshake` 断言仍按「本次运行内恰 1 条」判定 | 真机 `recordsBeforeCount:0 → after:1`；`postLink.postHandshakeRecordCount:1`（两者互不干扰） |
| ③ 不破坏「无合格 Node 即 `HARNESS_ERROR`」 | 两者是**两件事**：脚本对**宿主环境**的判定仍在链路前独立执行（无合格 Node → `HARNESS_ERROR`，不看设置项）；受控构造是「**一次刻意指向不合格 Node 的启动尝试**」，其失败是**预期内**并被断言为记录，不是宿主环境不合格 | 脚本路径判定先于构造；本轮构造失败快照被记为证据而非 `HARNESS_ERROR` |
| ④ 若与不变式结构冲突须升级 | **未冲突** → 无需升级（构造在真机上成功产出记录并成功还原设置） | 见 §0 / §7 |

**AC-32 交互（本轮补充）**：受控构造期间若产品凭据门先于预检拒绝启动（缺 `DEEPSEEK_API_KEY` 的运行），驱动将其识别为 AC-32 的**跳过**（`credentialSkipForConstruction`，`extension.cjs:2076`）并让整轮结论为 `SKIPPED_NO_CREDENTIALS` / 退出码 3 —— 不把「跳过的运行」误判成「构造失败」（本轮已实测，见 §7.3）。

---

## 5. R1 前置实测结论（`injectDisconnect` 落点 / 条数 / 字段来源）

### 5.1 实测（非推断，round-1 结论 + round-2 复核）

| 观察项 | 实测结果 | 证据 |
|---|---|---|
| 落点 | `dsh.test.injectDisconnect` → `IdeSessionHost.injectRuntimeDeath()` → `client.close()` → transport death → `onTransportDeath`（`status === 'connected'`）→ `recordTransportDeath()` 落 `phase:'post-handshake'` | `layer-v-inject-disconnect.spec.ts:123`；真机 `postLink` |
| 记录条数 | **恰 1 条**；随后编排器的重试不追加 post-handshake 记录 | 同上 `:156` + `session-host.spec.ts:502` + 真机 `postLink.postHandshakeRecordCount = 1` |
| FSM 出口 | 死亡后由**产品自身**的状态观察驱动：`extension.ts:2337-2345` 的 `onStatusChange('error')` → `orchestrator.onUnexpectedDisconnect()` → 既有重试路径（入口**未变**） | 同上 |
| 字段来源 | `source === 'vscode-setting'`；`resolvedExecutable` = 启动时解析出的 24.3.0 绝对路径（与 spawn 使用者同一对象，非重新解析） | 真机 `node.extensionSubprocessSide.resolvedExecutable` 与 `report_meta.node.resolved` 逐字相同 |

### 5.2 R1.2 `[]` 最终口径（实现所遵循的判定）

| 情形 | 判定 | 实现位置 |
|---|---|---|
| **构造后的那次读取**为 `[]` | `HARNESS_ERROR`（字段级证据不可得，不得静默降级） | 驱动读 `dsh.test.getDiagnosticsText`，过滤 `phase === 'post-handshake'` 且两字段齐备；找不到 → `HARNESS_ERROR` |
| **未构造时**的任何读取为 `[]` | **合法**，且不对版本断言（与 AD-14 决策 5 一致） | 驱动在构造前不读诊断 |

---

## 6. 偏差台账

### 6.1 spec 文字漂移（实测事实，已在实现中按事实落地；**未**改 spec 文件）

| # | spec 写法 | 实测事实 | 处理 |
|---|---|---|---|
| **D1** | `dsh.reviewWorkspaceDiffs` 在 `apps/vscode-dsh/src/extension.ts:812` | 实际在 **`extension.ts:872`** | 按实际行号定位（AC-25 step5 取证位置） |
| **D2** | `agent-presets` overlay 指向 IDE patch | 实际在 **`packages/bundle/sdk-app/cordis.patch.yml:46-55`** | 影子 preset 生成器按**实际**位置定位被删的 2 行（AD-15 route A） |
| **D3** | 只改 `README.md` | `README.zh.md` / `README.i18n.yaml` **都不在 HEAD 中** | 按「补齐配对」处理（新增两文件） |
| **D4** | `.gitignore` 规则「需确认」 | 规则与目录**都不存在** | 遵守 spec 顺序约束：先落规则、后建目录（AC-26 / AC-33） |
| **D9** | **`spec.md:151` 与 `:196` 自相矛盾**：`:151`「**任何**其它命令名**不得**出现在驱动源码中」，`:196` 明文要求驱动**断言并执行** `dsh.showHostDiagnostics` | 驱动源码确实出现并执行了 `dsh.showHostDiagnostics`（`extension.cjs:68` 白名单、`:1009` 与 `:1018-1021` 断言与执行） | **依 `:196` 落地是正确且必要**：该命令是 **HEAD 既有的只读诊断面**（非本 Phase 新增、不改变任何 AC 语义），且 `:196` 明文授权。**调度者已在 `spec.md:151` 就地消解该矛盾**（把该命令补入允许集）；本 agent **未**改 spec。依 `constitution.md` §6.2（「所有与 spec 不一致的实现必须登记」）在此登记 |

### 6.2 我的实现偏差（需 reviewer 关注）

| # | 偏差 | 影响范围 | 原因 | 影响 |
|---|---|---|---|---|
| **D5** | `dsh.test.injectDisconnect` 由「直接戳编排器 FSM」改为「真实杀死运行时连接（`host.injectRuntimeDeath()`），FSM 由**产品自身**的状态观察退出」 | AC-6a（`vscode-dsh-chat-ready`）的「同 FSM 入口」性质；`spec.md` §R1.3；`design.md` AD-14 | R1 要求记录**必须**携带 `resolvedExecutable` + `source`，唯一能同时满足两字段与「只一条」的落点是 Host 死亡边 | FSM 入口**未变**，**触发方式**变了（更贴近真机崩溃）；属测试钩子语义收紧，非产品行为变更（连通性视角已独立确认为 PASS） |
| **D6** | 给 `HostFailureRecorder` **接口**补 `lastSeq?()`（类上本就存在） | AD-14 记录面契约 | 接口是记录器的对外契约，去重读取依赖该高水位 | 接口成员新增本身**零行为**；**但同一文件同次改动还含 D10 的真实行为变更**，round-1 曾把 D6 表述为「零行为变更」的全部内容，本轮已拆开登记 |
| **D7** | 三个既有测试文件加 `beforeEach/afterEach` 清除/恢复 `DSH_NODE_BIN` | 测试环境隔离 | 开发机若导出 `DSH_NODE_BIN`，解析链优先命中它 → 「设置项来源」用例恒假红 | 仅测试卫生；脚本侧的同类要求在 AC-10 行已落实 |
| **D8** | `pnpm-lock.yaml` 出现 `7+/4-` 改动（`git diff 300f492f84` 实测 **4 个 hunk / 3 处变更点**：① `@@ -507,6 +507,9 @@ importers:` **+3** —— `apps/vscode-dsh` importer 新增 `tsdown` 条目；② `@@ -6906,6 +6909,9 @@ importers:` **+3** 与 ③ `@@ -6949,9 +6955,6 @@ importers:` **−3** —— `packages/sdk/server` importer 内 `@deepseek-ai/dsh-specdev` 的**同一处按字母序重排**（同一变更点跨两个 hunk）；④ `@@ -18781,7 +18784,7 @@ snapshots:` **±1** —— vitest 的 vite peer `6.4.3(@types/node@22.20.0)(jiti@2.7.0)(lightningcss@1.32.0)(…)` → `8.0.16(@types/node@22.20.0)(esbuild@0.28.1)(jiti@2.7.0)(…)`） | 依赖面 | ① **`tsdown` 确属 `pnpm install` 追平 base**：`apps/vscode-dsh/package.json:234` 本就声明 `"tsdown": "^0.22.2"`，而 `300f492f84:pnpm-lock.yaml` 的 `apps/vscode-dsh` importer **0 条 `tsdown`** ⇒ **base lock 已过期**，本次变化是 `pnpm install` 把它追平；**零 `package.json` 改动** → 非新增依赖（唯一未跟踪的 `package.json` 是本 Phase 新增的驱动清单）。②③ 重排同属 `pnpm install` 的规范化输出。④ **vite peer 变更的成因未独立核实**（不推测为「回填」以凑整齐） | 与本 Phase 交付物无关；调度者已裁定**不纳入本次提交**（本 agent 未执行任何 git 操作）。**D8 的性质判定（依赖面 / 非本 Phase 交付物 / 不纳入提交）不变，本行仅补全括注枚举**（见 §6.2 **D18 (D)**） |
| **D10** | **【🟡-4 登记】** `createStartFailureListener`（`host-diagnostics.ts:323-346`）为「编排器自行合成、**无 Host 边界记录**的 `process-failed` 快照」补写**一条** `kind:'other'` 记录 | `scope-amendment-01.md` §1.3 的第二条记录边；`spec.md` §R1.3；`design.md` AD-14 | **判据**：进入 listener 时取高水位 `mark() = recorder.lastSeq()`，若一次启动尝试结束（`:324`/`:329` 两处采样）后 `mark()` **未移动**（`:344`），说明 Host 边界**没有任何生产者**为这次失败留下记录，而该失败确实发生过 → 由该快照**既有的消费者**补记一条。**为何必要**：否则「握手响应已达但 `status` 尚为 `'starting'` 时死亡」这一竞态会出现**零记录**（R1 要求失败可被判据）。**为何不构成第二条通道**：补记发生在**无生产者**的前提下（有生产者则 `mark()` 移动、直接 `return`，`:344`），故任一次失败**最多一条**；`auto-start-orchestrator.ts` 侧仍然**不写** `record()` | 经两个视角独立核验为**正确**（互斥、去重、真机恰 1 条、两条新用例覆盖两种相对顺序）；round-1 遗漏登记，本轮补登并**修正 §3 第 3 点措辞** |
| **D11** | **【🟡-5 加固】** `recordTransportDeath` 对 `resolvedExecutable` / `source` 由**条件展开**改为**断言后直取**（`requireNodeExecutable()` `session-host.ts:1019`），并给 `onTransportDeath` 包 `try-catch` | `spec.md` §R1.3 的字段面；AD-14 | 原实现下 `nodeExecutable` 缺失会**静默少字段**，而 R1 的证据面依赖这两字段 → 改为 fail loud；同时保证「诊断不变量违例」不会阻断 teardown | 字段集**仍恰 18**（真机 `fieldSet.missingFields: []`）；当前该分支不可达（`session-host.ts:418` 在任何可能到达 `connected` 的 await 之前赋值），属**防御性收紧**，零既有行为变更 |
| **D12** | **【🟡-3 偏差】** 采用 `xvfb-run` 时必须把 `xvfb-run` 生成的 `XAUTHORITY`**透传**给 EDH 进程；若 wrapper 未报告**可读**的凭据文件则**回退**自拉 `Xvfb` | AC-28 的 `xvfb` 分支 | `xvfb-run` 启动的 X server 带 `-auth`，无凭据文件时宿主连接会被 **ACCESS_DENIED** 拒绝（round-1 实测：`xdpyinfo` 拒绝 → 驱动无状态文件 → `HARNESS_ERROR`）；而自拉 `Xvfb :N` 无凭据要求 | 偏好序仍严格是 `xvfb-run` → `Xvfb` → `SKIPPED_NO_DISPLAY`；只是「`xvfb-run` 起了 display 但没有可用凭据」这一情形按「wrapper 未能提供可用 display」处理并回退，**不是**把 `xvfb-run` 降级为非首选 |
| **D13** | **【🟡-2 偏差】** `toolCount !== 25` 由 `warnings` 升为 `problems` | AC-25 step4 | AC 明文要求 `toolCount === 25`，原实现只 `note` 不改结论 → 门禁强度低于 AC 口径 | 本次值恰 25，**既有 PASS 结论不变**；负向分类（AC-27(b) / AC-32）本轮复跑确认未受影响 |
| **D14** | **【🔴-1 偏差】** `node` 段新增 `terminalSide`（终端侧自己的判定 / 动作 / 文档锚点），并新增 `nodeCoverage`（两侧覆盖断言结果） | AC-11；`docs/development.md#node-environment` | spec 要求两侧**各自**给结论且**不得**由一侧推导另一侧 | 未引入任何「合并结论」字段（`nodeCoverage.mergedVerdictFields: []`）；`terminalSide` 的 `judge:"fail"` 与整轮 `PASS` **并不矛盾**：前者衡量「本 shell 默认会拿到什么 node」，后者是脚本前置 `PATH` 后的链路结果（AC-12），故 (a) 侧特意携带「终端侧需执行的动作」 |
| **D15** | **【AC-32 构造事实更正】** 缺凭据的构造必须让**扩展宿主** `process.env` 中不存在任何凭据类变量（项目知识：门槛读宿主 env，且匹配 `KEY\|PASSWORD\|SECRET\|TOKEN` 命名的非空变量）；**仅切 cwd 无效** | AC-32；README 的跳过条件；`extension.ts` 的 `detectCredentialsFromEnv` | 脚本 `:1264` 在拉起宿主前 `cd "${REPO_ROOT}"`，故「从 `/tmp` 运行」并不会让宿主失去仓库 cwd 的凭据来源；本项目既有测试知识（`project-test` 技能）给出的**稳健做法**是白名单环境（`env -i PATH=… HOME=… DISPLAY=… TERM=… LANG=… VSCODE_DSH_TEST=1 bash …`），而**逐个 `-u` 剥离**只是「当前恰好只存在这两个变量」时的可行形态 | round-1 的 AC-32 行写作「可信 cwd（不含 `.env`）下运行 → SKIPPED」，本轮更正为「宿主 env 无凭据变量」。本轮实测：仅切 cwd → 仍 `PASS`（runId `…134751Z`）；`env -u DEEPSEEK_API_KEY -u FEISHU_PROJECT_MCP_TOKEN` → `SKIPPED_NO_CREDENTIALS` / 退出码 3（runId `…134855Z`）。**不是**产品缺陷，是构造方式的事实；稳健形态仍以白名单环境为准 |
| **D16** | **【P1 — verifier 独立验证回合发现；四个 reviewer 均漏报】** `apps/vscode-dsh/tests/interaction-approval-resolution.spec.ts:30` 的箭头函数参数缺括号：`new Promise<ApprovalOutcome>(resolve => {`，触发 `@stylistic(arrow-parens)`（该参数体含花括号，仓库 stylistic 配置要求加括号） | 本 Phase **新交付测试文件**的 lint 面；`pnpm run lint` 的全局退出码 | 同文件 `:25` 的 `(outcome: ApprovalOutcome) => void` 即为仓库要求的正确写法，本行属漏改 | **修法 = 纯语法等价**：`resolve =>` → `(resolve) =>`，**零行为变更**。修后 `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests/interaction-approval-resolution.spec.ts` 零 `@stylistic` 错误（该文件已无任何诊断）；`pnpm run test …/interaction-approval-resolution.spec.ts` 复跑 **6 passed**。**为何可归因于本 Phase**：`git ls-files --error-unmatch apps/vscode-dsh/tests/interaction-approval-resolution.spec.ts` **失败（exit 1，尚未入库）** → 本 Phase 新增文件；`layer-v-inject-disconnect.spec.ts` 的 `no-unsafe-*` 属**仓库全局容忍类**，不属本次范围。**该家族规模（两个命令口径分开计，禁止混用）**：① **`apps/vscode-dsh` 范围**（`npx tsx scripts/run-oxlint.ts apps/vscode-dsh`）error 行 **2085**，其中 `no-unsafe-*` **1678**、`@stylistic` **67**；② **门禁全仓范围**（`pnpm run lint`，verifier 实测）error **10371**，其中 `@stylistic` **9542**、`no-unsafe-*` **434**（**①②两组数字带不同测量时点、且 ② 依赖构建状态，直接并列会被误读为同刻对比 —— 测量时点、当前真值与闭合算式见下方 D18**）。**登记为已修项，不新增技术债条目** |
| **D17** | **【verifier round-2 窄口径复核发现；调度者 round-1 分桶时漏报】** `apps/vscode-dsh/tests/host-diagnostics.spec.ts:256:35` 的「不可用 `schemaVersion`」用例写成 `${String(HOST_DIAGNOSTIC_SCHEMA_VERSION)}`，触发 `typescript(no-unnecessary-template-expression)`（模板字面量包裹单个表达式属冗余）。**调度者漏报原因**：round-1 分桶只检查了本 Phase 两个**新增**文件，且按**规则家族**（`no-unsafe-*` / `@stylistic`）而非「**是否本 Phase 新引入**」判断，故本行未被纳入 | 本 Phase **新交付测试文件**的 lint 面；`pnpm run lint` 的全局退出码 | 上一轮回流补「不可用 `schemaVersion`」用例集时，对既有普通字面量写法做了不必要的模板包裹 | **修法 = 纯等价**：`${String(x)}` → `String(x)`（`x` 为 number 时两者结果**逐字相同**，都是字符串）。该行意图 = 传入**字符串**型 `schemaVersion` 并断言被拒，`String()` 仍返回字符串 ⇒ **测试意图与断言行为完全不变，零行为变更**。**归因三重证据**：① base 提交 `300f492f84` 同一文件该处是普通字面量 `{ ...v1, schemaVersion: 0 }`；② 本行是 Phase 3 diff 的**新增行**；③ `no-unnecessary-template-expression` 在**全仓 `apps/vscode-dsh` 范围内仅此 1 条**。修后 `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests/host-diagnostics.spec.ts` 该规则 **0 条**（退出码仍为 1，余项**全部**是 `no-unsafe-*` 容忍家族）；`pnpm run test …/host-diagnostics.spec.ts` → **48 passed / 退出码 0**。**登记为已修项，不新增技术债条目** |
| **D18** | **【`[文档保真]` 类订正 — 零行为影响；未改任何代码/测试/脚本/配置，未 commit、未改 git 状态、未归档本文件】** 五项文档订正：① **修正 §6.3** 的失实措辞「**未**动 `pnpm-lock.yaml`」（原文可被读成「该文件未变」，与实测相反）；② **为 D16 的两组家族数字补标注测量时点**（原文未标注，两组取自不同时点，直接并列会被误读为同刻对比）；③ **补「全仓 lint 条数依赖树状态」说明 + 更正 O-5 的一处因果措辞**（见「原因」栏 (C)）；④ **补全 D8 括注**：原文只枚举 2 处，实测 `7+/4-` 含 **4 个 hunk / 3 处变更点**（见「原因」栏 (D)）—— D8 与 §6.3 属**同类**「自述与实测不符」；⑤ **为 §6.3「未动既存未跟踪构建产物」补证据化表述**（见「原因」栏 (E)）—— 经证据核验该项**不是失实**，故为**加固**而非更正。**发现来源如实标注**：发现 A ← `review-design.md`（重派复审）🟢-3；发现 B ← `verification.md`（round-3）O-3 / O-5；发现 ④ ← 本 agent 本轮实测 `git diff` hunk（调度者裁定采纳）；发现 ⑤ ← 本 agent 上轮提出的同类疑虑（调度者裁定处理，本轮经证据核验后按「原文为真、补证据」处理） | §6.3 边界声明；§6.2 **D16**（仅补测量时点与当前真值，**D16 的数值本身不变**）；§6.2 **D8**（仅补全括注枚举，性质判定不变）；**AC 判定不受影响** | **(A) `pnpm-lock.yaml` 与实测对齐（发现 A）**：`git status --porcelain pnpm-lock.yaml` → ` M pnpm-lock.yaml`；`git diff --stat 300f492f84 -- pnpm-lock.yaml` → `7 insertions(+), 4 deletions(-)` ⇒ 该改动**真实存在**，来自 `pnpm install` 的**一致性回填**、**非本 agent 主动所为**（**D8** 已登记且内容不变；调度者已裁定**不纳入提交**）。**(B) 测量时点 + 当前真值（发现 B / O-3）**：D16 ① **`apps/vscode-dsh` 范围**（`npx tsx scripts/run-oxlint.ts apps/vscode-dsh`）error **2085**（`no-unsafe-*` 1678 / `@stylistic` 67）测于**两次 lint 修复（D16、D17）之前**；② **门禁全仓范围**（`pnpm run lint`）error **10371**（`@stylistic` 9542 / `no-unsafe-*` 434）测于 **D16 修复之后、D17 修复之前**。**当前真值**：① **2083 / 1678 / 66**；② **10370 / 9542 / 434**。**闭合算式（便于后人复核）**：`2085 − 1`（`@stylistic`，随 **D16** 修复消失）`− 1`（`no-unnecessary-template-expression`，随 **D17** 修复消失）`= 2083`；`67 − 1 = 66`（D16）；`1678` **不变**；`10371 − 1 = 10370`（D17）。本轮订正时**复跑 ①** 得 **2083 error 行**（`no-unsafe-*` 1678 / `@stylistic` 66），与算式一致。**(C) 全仓条数依赖树状态（发现 B / O-5）**：`pnpm run lint` 的真实链条 = `build:lib:host && tsx scripts/run-oxlint.ts .`。本树存在 **768** 个未跟踪构建孪生（一手实测 = **672** 个 `packages/**/src/**` + **96** 个 `vendor/cordis/src/**`，后缀 `.d.ts/.js/.map`），且**它们确在 oxlint 语料内**（一手实测：对单个孪生 `packages/core/agent/src/index.d.ts` 单独跑 `run-oxlint.ts` → `number_of_files: 1`、169 条诊断 ⇒ `.d.ts` 被 `**/src/**/*.{ts,tsx}` override 当作 `.ts` 匹配）⇒ **任何「全仓条数」结论都必须声明树状态，跨树/跨时点的全仓对比无效**（O-5 实测：当前树全仓 error **10370** vs 干净 base worktree **2218**，差值几乎全来自孪生）。⚠️ **更正 O-5 的一处因果措辞（本轮一手证据）**：这 768 个孪生的 **mtime 全部是 2026-09-11 14:xx / 09-14 12:xx**，本轮 `build:lib:host` / `build:host` **未重写它们**；同日构建确实会改 mtime（同一个构建把 `packages/sdk/client/src/{index,client}.ts` 重写为**内容相同**、mtime 2026-09-16 14:30；本轮产物落在被 `.gitignore:4`（`lib/`）忽略的 `**/lib/**`，今日 mtime 281 个 `.js`）⇒ 「前置构建**会生成**这 768 个孪生」**未获本轮证据支持**，应表述为「本树**既存**孪生（生成链未独立核实）」；但「跨树对比无效」的结论**不受影响** —— 它只依赖「孪生在场与否」这一树状态差异。**(D) D8 括注补全（发现 ④，与 (A) 同源的「自述与实测不符」）**：`git diff 300f492f84 -- pnpm-lock.yaml` 实测 **4 个 hunk**（`@@ -507,6 +507,9 @@ importers:` / `@@ -6906,6 +6909,9 @@ importers:` / `@@ -6949,9 +6955,6 @@ importers:` / `@@ -18781,7 +18784,7 @@ snapshots:`）= **3 处变更点**（②③ 为 `packages/sdk/server` importer 内 `@deepseek-ai/dsh-specdev` 同一处重排的两侧），逐 hunk 计数 `3 + 3 − 3 + (1−1) = 7+/4−` 与 diffstat 一致；原括注只枚举 2 处 ⇒ 补全为三处（`tsdown` 新增 / `importers` 重排 / `snapshots:` 段 vite peer 变更），并补 `tsdown` 的因果证据（`apps/vscode-dsh/package.json:234` 已声明 + base lock 0 条 ⇒ 追平过期 lock）；**vite peer 变更成因如实标注「未独立核实」**，不推测。**D8 的性质判定（依赖面 / 非本 Phase 交付物 / 不纳入提交）不变**。**(E) §6.3 后半句的证据化加固（发现 ⑤，经核验**不是**失实）**：判据为「未重写 ⇒ 内容未变」—— ① 768 个既存未跟踪孪生 mtime 全为 2026-09-11/09-14（无一个今日 mtime）；② 全仓**未跟踪（非忽略）**文件中今日 mtime 的共 **38** 个，**全部是 `.md`/`.mdc`/`.sh`/`.ts`/`.cjs`/`.yaml` 工作流与源码文件**（唯一 `.cjs` 是本 Phase 手写的 `layer-v-driver/extension.cjs`），**零构建产物**；③ 反证 mtime 敏感性：同日构建确实把 `packages/sdk/client/src/{index,client}.ts` 的 mtime 改到 2026-09-16 14:30（内容相同）。故 §6.3 保留「未动」表述并**内联上述证据**（原措辞为真但无证据，易被再次误判） | **零**：**D18 是文档订正，不是新的实现变更** —— 不改变任何 AC 判定、不改任何代码/测试/脚本/配置、不新增或关闭技术债条目 |

| **D19** | **【`scope-amendment-02` §4.1 / `DEBT-015` 修复】** 逐步骤洁净判据由「**不可能失败**」改为「可失败」：① 脚本在**加载时**采样一次真实 epoch-ms（`RUN_STARTED_AT_MS` `run-layer-v-smoke.sh:179`）并写进 plan（`:1289`）；② 启动前 `assert_plan_run_start()`（`:1344`，调用点 `:3086`）**读回已写出的 plan** 断言 `runStartedAtMs` 为正有限数，否则 `fail_harness "plan"` → `HARNESS_ERROR` 4；③ 判据本体移入幂等模块 `layer-v-driver/sandbox-clean-state.cjs`（`runStartedAtMsOf` / `staleProductState`），驱动在链**前**校验（不可用即 `harnessError`，`extension.cjs:2281-2287`）、**每步**（`index >= 1`）复扫并在 `offenderCount > 0` 时 `throw harnessError('step-N-sandbox-product-state-not-clean')`（`:2304-2310`）→ `HARNESS_ERROR` 4 | `spec.md:199` 边界清单的「每步开始前沙箱产品状态为空」；`design.md` AD-16 决策 3。**不改**任何 AC 语义 / 字段集 / `kind` 词表 / 退出码契约 | 修前 plan 写出时该字段**仍是初始值**（真实时间戳在此之后才赋），而判据是 `stat.mtimeMs + 5000 < runStartedAtMs` ⇒ 对**任何**文件恒假，`predates-run` 分支**永不触发** —— 恰是它存在的理由（上一轮会话残留使面板进入 `replay`、step 3 不经模型往返即通过）被完全漏掉。模块注释原文：「**一个不会失败的守卫比没有守卫更糟，因为证据链仍显示它跑过**」 | 判据**从不可达变为可达且可失败**；保留 5s 粒度冗余（防文件系统时间戳粗粒度误报）与 `unreadable` 分支（防「读不出来」被当成「干净」）。代价 = 每步一次递归 walk（沙箱内文件数为个位）；失败面 = 无新桩。**可失败性证据见 §7.7 (1)**（模块层 + **shipped 断言函数层**双证） |
| **D20** | **【`scope-amendment-02` §4.1 / `DEBT-014` 修复】** 新增构建产物**新鲜度**断言 `assert_build_freshness()`（`run-layer-v-smoke.sh:1144`）→ 幂等模块 `layer-v-support/build-freshness.cjs`：产物根存在 + 可读 + 文件数 > 0 + 入口 `lib/extension.js` 存在 + **入口的相对导入可解析**（防「chunks 写完、入口未写完」的中断构建）+ 产物最新 mtime **不早于**源码最新 mtime | AC-26 / AC-28 的共同前置（脚本「构建前检」）；**不改** AC 语义与退出码契约 | 修前只查产物**存在** ⇒ 陈旧 bundle 可跑出假 PASS（本轮真实发生过）。「存在」与「本次交付物」不是同一命题，而 PASS 是**关于本次交付物**的断言 | **判 `HARNESS_ERROR`（4）而非「带证据升级」的理由**：脚本既有契约把「脚本自身前置条件不满足」一律归 `fail_harness`（build 前置、`plan` 不可用、`display-evidence` 模块不可用等，均 `HARNESS_ERROR`）；陈旧产物属**同类** —— 脚本无法保证被测对象是本轮产物 ⇒ 判 `PASS`/`SKIPPED_*` 会把环境问题伪装成产品结论。**归因**：取证在**拉起 EDH 之前**，故失败只花一次前置检查、不产生「跑完五步才发现」的浪费。**边界如实声明**：mtime 只是**必要性**判据、非充分条件（不做内容级比对：代价与误报率）；门禁**不保证**产物与源码语义一致。**可失败性证据见 §7.7 (2)** |
| **D21** | **【`scope-amendment-02` §4.1 / `DEBT-016` 修复】** `artifact-index.md` 的写入后自断言由「只 `note`」改为**致命**：`append_index_row()`（`run-layer-v-smoke.sh:2923`）在三个失败面（行构建失败 `:2927` / 模块返回非 0 `:2934` / 模块无输出 `:2936`）全部经 `record_evidence_violation("artifact-index", …)`（`:257`），后者在 `CONCLUSION = PASS` 时**单向上转**为 `HARNESS_ERROR` 4；写入本身改走 `artifact-index.cjs`（`append` → 退出码即答案）并**校验返回值**，不再内联拼接 | AC-33 / AC-33(b)；**不改** AC 语义 | 修前自断言只 `note` ⇒ 行重复 / 行落在表外 / 表头不唯一都**不改变结论**，PASS 依然成立，而「证据在 AC-33 说的地方」正是 PASS 的一部分 | **分级依据（为何本轮不分级、全部致命）**：判据 = 「该断言是否属于 PASS 这句话的内容」。PASS 的含义**包含**「本次运行的证据在索引表内且恰一行」⇒ 行缺失/重复/不在表内**直接使 PASS 为假**，不是次要瑕疵。反之只有「仅影响可读性」的断言才该留 `note` —— 本轮**不存在**这类断言（`describeProblem` 的 5 个失败面**全部**是结构性的）。故**全部致命、零 `note`-only**。**单向上转是有意的**：把 `LINK_FAILURE` 改写成 `HARNESS_ERROR` 会掩盖本轮要报告的产品发现（脚本注释原文）。**可失败性证据见 §7.7 (3)**（模块层 3 个失败面 + **shipped `record_evidence_violation` 逐字抽取**层） |
| **D22** | **【`scope-amendment-02` §4.2（`DEBT-017` / R2）】** 截图有效性判据：新增 `display-evidence.cjs`（`MIN_DISTINCT_MD5 = 2`，`measureFrames` / `judgeEvidence`）+ 脚本 `assert_display_evidence()`（`:2723`）与 `display_evidence_record_json()`（`:2678`，落 `displayEvidence` 块 → report-meta `:2825`）；`reuse` 退化 ⇒ `retry` ⇒ **强制 `xvfb` 重跑一次**；`xvfb` 也退化 ⇒ 不 PASS；实际 `distinctMd5` 一律记账 | AC-26 新增子项 (e)；AC-28 的 `reuse` 前件 | 修前没有「截图是否承载界面」的判据：`reuse` 模式 5 帧全是 3840×1080 桌面壁纸、md5 全同，仍算证据 | **机制选择 = 「跑完发现退化再回退 `xvfb`」，非「先探针」**（成本理由有实测依据）：判据定义在**同一一次运行的 5 帧**上，帧只在运行产生后才存在；而任何「先探针」要**省**成本就必须**更严**，更严会误杀 —— 实测归档运行 `20260916T170431Z-2270421`（`reuse`）为 **4 帧逐字节相同 + 第 5 帧不同 ⇒ `distinctMd5 = 2` 满足硬下限，必须判 `pass`、不得重跑**（「前两帧相同即退化」的探针会把它误判成退化 → 白跑 5 步）。故只在**真退化**（本机 `reuse` 的常态）时付 2× 成本，且不破坏「同一次运行的帧」这一判据不变量。**归档 43 个真实运行的实测分布**：`reuse` + 5 帧 → `distinctMd5=1` **7** 次（全部 `retry`）、`=2` **1** 次（`pass`）、`=5` **2** 次（`pass`）；`xvfb` + 5 帧 → **4** 次全部 `distinctMd5=5` / `pass`。**可失败性证据见 §7.7 (4)** |
| **D23** | **【`scope-amendment-02` §4.3 — 本 Phase 可归因 lint 清零】** 4 个测试文件的 54 条 `no-unsafe-*` 清零。手段 = **真实类型**：① 新增 `apps/vscode-dsh/tests/tsconfig.json` 为这 4 个 spec 建立**类型程序**（`include` 显式列举 + `moduleResolution: "bundler"` + `paths` 指向 `src`），使类型感知规则能解析其符号；② 为新增/改动行补具名类型（诊断替身接口、类型化 stub、具名边界接口），把裸对象字面量与宽类型访问替换为有类型契约的访问 | 本 Phase 新交付测试文件的 lint 面 | 这些 spec 此前**不在任何 tsconfig 程序内** ⇒ 所触达的每个符号都退化为 `error` 类型 ⇒ `no-unsafe-*` 家族成片报出（**不是**代码真的在滥用 `any`） | **数字（显式路径口径 `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests/<file>`）**：修前 **54**（`host-diagnostics` +6 / `node-env-guard` +6 / `session-host` +15 / `layer-v-inject-disconnect` +27，**引自 `verification.md` round-3**；本 agent 无法独立重测修前值，原因见 **D24 (D)**）→ 修后 4 文件各 **0 error lines**（`§7.7` 末尾原始输出）。**机制证据（本 agent 自测的 A/B 对照，同规则同命令）**：**未被**该 tsconfig 覆盖的同类 spec `phase2-change-list-display.spec.ts`（Phase 2 交付物、**不在本轮范围**）报 **50** 条 `no-unsafe`，而 4 个目标文件 **0** 条 ⇒ 差异来自「有无类型程序」，**不是**规则被关掉。**合规声明**：零 `eslint-disable`、零 `any`、零新增类型断言。**剩余边界如实声明**：`npx tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit` 仍报 **170** 条**类型错误** —— 该 tsconfig 提供程序、**不**代替修类型；本轮清零范围**仅限 `no-unsafe-*` 家族**，**未**声称「这些测试文件类型全对」 |
| **D24** | **【本轮边界 + 已披露偏离 + 对派单事实陈述的更正】** (A) **`implementation.md` 未归档**（按派单 §硬约束 5 的**显式已披露偏离**：D1–D18 描述的是**仍在交付物中**的代码，归档会把台账移出 reviewer 直接读取路径；本文件**保留直接路径、未建副本**，§6.2 接续 `D18` 编号、`### 6.1`/`### 6.2`/`### 6.3` 各恰一次）。(B) **`DEBT-018` 归属冲突（产物级不一致遗留）**：`scope-amendment-02` §4.1 的 `DEBT-018` 行与 §5 的 implementer bullet **仍指派本 agent 实施并登记 `.oxlintrc*.json` 改动**，而派单明示「你不用碰它」「不要动 `.oxlintrc*.json`」⇒ 依**派单**（后发且更具体）**未实施、仅验证**：5 个 shipped `.cjs` 各 **0 error lines**，override 在 `.oxlintrc.json:341`。**遗留**：单独读 `scope-amendment-02.md` 的人会预期本 agent 改过这些文件 —— 需调度者或后续轮次校正该文档。(C) **未 commit、未切分支、未动 git 索引**：`git branch --show-current` = `impl-phase-3-layer-v-smoke-loop`（§7.7 末尾）；`git diff --cached --name-only` **仅** `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` 一个文件，且它在**本轮开工前的会话初始 `git status` 中已是 ` A`（staged）** ⇒ 非本轮所为。(D) **对派单的三处更正 + 一处无法核实的记录**：① 派单称「54 条落在 **3 个**测试文件」但同句列举 **4** 个 —— 实测为 **4** 个（各 0）。② **修前 54 无法由本 agent 独立重测**：工作区已是修后态；`run-layer-v-smoke.sh` / `layer-v-support/` / `layer-v-driver/` / `tests/tsconfig.json` / `layer-v-inject-disconnect.spec.ts` **均未入库**（无 HEAD 基线），3 个已跟踪 spec 的本轮修后内容亦未提交 ⇒ **修前内容既不在 HEAD 也无归档**；另实测 `oxlint --tsconfig=<其它 tsconfig>` 会**直接跳过**不属于该程序的文件（**不产出诊断**）⇒ 无法用 override 反推修前分布。故 54 **如实标注为引自 `verification.md` round-3**，机制改由 A/B 对照（D23）独立证明。③ 派单称 `plan.runStartedAtMs` 的缺陷点在「约 `:1185` 附近，`HOST_LAUNCH_MS`」—— **现状**：plan 写出行是 `:1289`、`HOST_LAUNCH_MS` 的赋值在 `:1384`；与 `:1185` 的差异可用「本轮新增行造成位移」解释，**但该文件无基线 ⇒ 本 agent 既不能证实也不能证伪修前行号**，故仅记录现状、**不主张行号更正**。④ 本轮**未触碰** `DEBT-019` 范围（仓库级基线 2218 条 / 107 文件未动）、未动 `.oxlintrc*.json` / `package.json` / `scripts/run-gates.ts` / 任何非本 Phase 文件 | **零**（除 (A) 的台账保真处置外）：不改变任何 AC 判定、不改字段集 / `schemaVersion` / `kind` 词表 / 退出码契约；不改 `spec.md` / `design.md` / `scope-amendment-01.md` / `scope-amendment-02.md` | 见左栏 | 见左栏 |

| **D25** | **【任务 A / `DEBT-017` 消费侧缺陷修复】** 判据的**消费侧**改为「动作经变量回传、stdout 保持为空」：`display_evidence_verdict` 的日志改走 `>&2`（模块 stderr 也直达 fd 2，不再经 `log` 进 stdout）；`assert_display_evidence` **直接调用**该函数（不再 `$( … )`），故 `DISPLAY_EVIDENCE_ACTION` / `_JSON` / `_REASON` 落在**调用者 shell**；`case` 判 `DISPLAY_EVIDENCE_ACTION`；`retry` 置 `DISPLAY_RETRY_REQUIRED="true"` 并触发 R2.3 的 `xvfb` 重跑。消费侧从 `run-layer-v-smoke.sh` 内联函数抽出为独立模块 `layer-v-support/display-evidence-shell.sh`（`run-layer-v-smoke.sh:68/284` source 之） | `spec.md` AC-26(e) / AC-28 R2.3；`scheduler-findings-round4.md` §1–§3；`verification.md`（round-4）§1.4 | 原缺陷链：模块 stderr 报告经 `log`（写 stdout）⇒ `action="$( … )"` 把日志行与 `pass`/`retry`/`skip` **串成一个字符串** ⇒ `case` 恒落 `*` ⇒ `fail_harness` ⇒ **凡 driver 判 `PASS` 的运行一律被改写成 `HARNESS_ERROR`/4**（层 V 冒烟闭环唯一成功路径被关闭，全归档 20/20 命中）；三个 `DISPLAY_EVIDENCE_*` 在 `$( … )` 子 shell 内赋值 ⇒ 运行记录恒 null（AC-26(e) 的「记账」未达成）；`DISPLAY_RETRY_REQUIRED` 恒 `false` ⇒ R2.3 的 `xvfb` 重跑从未执行 | **四条修复全部达成且逐项对照**（§7.8 (1)）：`pass` / `retry` / `skip` / `*` 四分支在**真实归档产物的五种输入**下各至少一次命中；`retry` 的 `DISPLAY_RETRY_REQUIRED=true`、`distinctMd5` / `frames` / `recordAction` / `recordReason` 均反映本次判决；非 PASS 路径的 `note` 不再夹带日志行（`consumerStdoutBytes` 在 `pass`/`skip`/`*` 路径为 **0**）。**抽成模块**是为了让这条契约可被**单独驱动**（D26） |
| **D26** | **【任务 A5 / 新增 shell 层消费契约回归测试】** 新增 `apps/vscode-dsh/tests/display-evidence-shell.spec.ts`（11 例）：真帧 + 真模块 + 真 shell 源（`bash` 起子进程），断言「模块 verdict → shell 动作」这条契约的四分支可达性、`DISPLAY_RETRY_REQUIRED` 语义、运行记录字段；另含**调用方静态契约**（`run-layer-v-smoke.sh` 必须 source 模块并**直接**调用 `assert_display_evidence`）。同时把该文件加入 `tests/tsconfig.json` 的 `include` 与 oxlint-contract 的 `owned` 数组 | 本 Phase 新增测试面；`spec.md` AC-26(e) 的**消费**半（此前无任何测试驱动：模块层 `display-evidence.spec.ts` 头部自述只驱动 shipped 模块） | `scheduler-findings-round4.md` 指出：四视角 + 模块层 spec **全部**漏掉「模块 → shell」这条缝；`DEBT-017` 的关闭条件明文要求「消费契约须可被测试驱动」 | 新增 **11** 例；**双向演示**：缺陷在（stdout 污染 + 子 shell 赋值）⇒ **8 红 / 3 绿**；修后 ⇒ **11 绿**；调用方改用 `$( … )` ⇒ 静态契约那条**单独变红**（§7.8 (1) 的原始输出）。**本文件是新增，不改任何既有测试**（`tests/tsconfig.json` 的 `include` 由 8 项变 9 项，`tsc -p` 计数仍 **170**，见 §7.8 (6)） |
| **D27** | **【`scope-amendment-02` §8.1 🟡-1 修复】** 洁净判据在 `homeSandbox` 缺失时**不再退化为恒真**：新增 `homeSandboxOf(plan)` → `{ok,value}`（缺字段 / 空串 / 非字符串 / 路径不存在 / 非目录 全部 `ok:false`）；`staleProductState` 签名由「收 plan」改为 **`(sandboxHome, runStartedAtMs)`**，空 / 非字符串 ⇒ `TypeError`（**空扫描正是它绝不能给出的答案**）；驱动在链**前**校验（不可用 ⇒ `harnessError('sandbox-clean-state-check-unavailable')`，`extension.cjs:2293-2299`），每步复扫改传**已校验**的 `sandboxHome.value`（`:2312`） | `spec.md:199` 边界清单的「每步开始前沙箱产品状态为空」；`design.md` AD-16 决策 3。**不改**任何 AC 语义 / 字段集 / `kind` 词表 / 退出码契约 | 与 `runStartedAtMsOf` **同构**处理：缺失的**根目录**与缺失的**时刻**是同一类退化 —— 「扫了零个根」会报 `offenderCount: 0`，即「沙箱是干净的」，这是该判据绝不能给出的答案 | 判据**从「不可用即恒真」变为 fail-closed**；`sandbox-clean-state.spec.ts` 的期望由「空即干净」**改为「空即拒绝」**（`:196-202`，替换理由就地注释）+ 新增 7 类不可用输入的 `it.each` 与「指向文件而非目录」用例。**可失败性双向**：把 `homeSandboxOf` 退化回「一律 `ok:true`」⇒ 该 spec **9 红 / 16 绿**；恢复 ⇒ **25 绿**（§7.8 (2)）。行数变化：`sandbox-clean-state.spec.ts` 由 round-4 的 15 例增至 **25** 例 |
| **D28** | **【🟡-2 的落地形态与派单字面**不同**（已披露偏离）】** 派单要求在 `scripts/oxlint-contract.spec.ts` 的 probe 列表（约 `:52-61`）补一行 `['vscode app test', 'apps/vscode-dsh/tests', 'apps/vscode-dsh/tests/tsconfig.json']`。**该行不可满足**：`probes` 的断言口径是「为某**文件类**目录写一个**探针文件**，断言 oxlint 为它解析到该目录的 `tsconfig`」（`:93`）；而 `apps/vscode-dsh/tests/` 在仓库存量工作区内，其 `tsconfig.json` 的 `include` 是**显式列举**（9 个文件）⇒ 写入该目录的临时探针文件**必然** `Got tsconfig for file …: <none>` / `Total programs: 0. Unmatched files: 1` ⇒ 断言恒假（**与判据强度无关，是构造本身矛盾**）。故改用**同等效力**的形态：把该文件加入既有「vscode app test」`owned` 数组（`scripts/oxlint-contract.spec.ts:119-135`），即「该文件**必须**由其所属 tsconfig 认领」成为**被断言的契约** | `spec.md:197` 第三子项的 `.json`/归属面；`scope-amendment-02.md` §8.1 第 3 项的字面要求 | 目的（消灭「**无人断言**的文件类归属」）与字面形态冲突时，取**能真实失败的契约**：`owned` 数组的断言在「该文件不在自己的 tsconfig `include` 里」时会红（本轮已演示），而 probes 形态在任何情况下都只会因**构造矛盾**而恒红 | **🟡-2 的目的达成**（归属成为被断言契约，可失败性双向见 §7.8 (4)）；**字面形态未采用**并在此如实登记，**需调度者确认**（若认为必须保留 probes 字面形态，则该行需连同「探针文件须落在其 `include` 内」一起重设计） |
| **D29** | **【`scope-amendment-02` §8.1 🟡-4 / U-b 补全】** `build-freshness` 的比较集由 app 半区扩到 **workspace 半区**：脚本把 `packages/*/*` 与 `vendor/*` 作为 `--sibling` 传入（`run-layer-v-smoke.sh:1167-1182`，提示文案 `:1165` 的 `build:lib:host` 产物因此**真的落在校验范围内**）；模块对每个 sibling 比较 `<root>/lib` vs `<root>/src` 的 mtime，**缺失 / 陈旧 / 不可读一律 `ok:false`**（fail-closed，不静默通过） | `spec.md:197` 回归行 / AC-26 / AC-28 的共同前置；`DEBT-014` 的诉求面 | 「PASS 对应本轮产物」是**关于本次交付物**的断言，而 `build:lib:host` 的产物面**不止** app 半区 —— 只查 app 半区时，workspace 半区陈旧仍可假 PASS | app + workspace **两半区**统一 fail-closed；**判据边界如实声明**：mtime 是**必要性**判据、**非充分条件**（不做内容级比对 ⇒ 门禁**不保证**产物与源码语义一致）。**可失败性**：`workspace-artifacts-absent` / `workspace-artifacts-stale` 两类各 `ok:false`（原始 JSON 见 §7.8 (3)），健康态 `ok:true` |
| **D30** | **【`scope-amendment-02` §8.1 🟡-3 / 用户裁定】** `MIN_DISTINCT_MD5` 由 `2` **收紧到 `3`**（`display-evidence.cjs:39`），`:10` 的「the floor the user adjudicated」注释与 `:40-44` 的成本说明同步改写；`spec.md` 的〔修订段 R2〕/ AC-26(e) / AC-28 R2 中写死 `≥2` 的措辞更新为 `≥3`；`display-evidence.spec.ts` 的边界用例确认**恰好命中**新下限（并钉住 `MIN_DISTINCT_MD5 === 3`） | `spec.md` AC-26(e) / AC-28 R2（**措辞由用户显式授权修改**，见 §8.3 覆盖声明）；`display-evidence.cjs` / `display-evidence-shell.sh` 的注释 | 用户裁定：`distinctMd5 = 2` 的 `reuse` 运行（4 帧逐字节相同 + 第 5 帧不同）**不再**视为可接受的界面证据，改判退化并回退 `xvfb` | **机制未变、只是数字变了**（这是「跑完再回退」而非「先探针」的既有选择，本改动**不**改变成本模型）。**对既有归档判定的影响面（真实归档实测）**：47 个归档运行中 16 个可测 ⇒ 仅 **1** 个（`distinctMd5 = 2`）改判：`reuse` `pass → retry`、`xvfb` `pass → skip`；其余 15 个（`distinctMd5` 为 1 或 5）**判定不变**（§7.8 (5)，原始输出已归档） |
| **D31** | **【任务 C + U-c：registry 状态订正】** `tech-debt-registry.md` 中 `DEBT-014` / `DEBT-017` 由「已解决」**迁回「活跃债务」**并写明**关闭条件**（谁在什么条件下才算解决、验证方式指针）；`DEBT-018` 按用户裁定**迁入「已解决」**并给条文级验证方式指针，其 `.cjs` 残余（pre-commit profile `.oxlintrc.staged.json` 无 override 且 `ignorePatterns` 不含 `**/*.cjs`）**如实留痕**；同事实追加到 `scope-amendment-02.md` **§8.4** | `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md`；`scope-amendment-02.md`（**仅追加 §8.4**，未改 §8.1–§8.3 的裁定原文）；`/status`、Phase Entry Gate、`wiki` 的读源 | 原「已解决」判定与事实不符：`DEBT-017` 的证据止步于**模块层**、`DEBT-014` 的证据只覆盖 **app 半区**（`verification.md` round-4 + `scheduler-findings-round4.md` 均确认）—— 表格若继续显示「已解决」，会污染 `/status`、Phase Entry Gate 与 wiki | 三条状态**与当前事实一致**（活跃表 8 条：`004/009/011/012/013/014/017/019`）。**未**删除任何历史记录：被推翻的「已解决」行保留原文并就地标 **撤销**（供追溯）。**未**新立条目（`.cjs` 残余按用户裁定不另立） |
| **D32** | **【任务 D + `[文档保真]` 订正】** 三件事：① **核对**派单所述「`implementation.md` §6.3 与 `D8` 互相矛盾」—— **不成立**：§6.3 的正确措辞**已由 `D18 (A)` 落定**（「该文件**确有**改动，但来自 `pnpm install` 一致性回填、非本 agent 主动所为、调度者裁定不纳入提交」），与 `D8` 的判定**同向**；本轮在 §6.3 就地补一条**互引**（指向 `D8` / `D18 (A)`）使「唯一表述」显式化；② 修 **`review-design` 🟢-2 / 🟢-3**：`apps/vscode-dsh/tests/tsconfig.json` 的头注释改为**可复核口径**（两条数字给出**测量形状**：`pnpm exec tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit` = **170**；同目录探针 `{"extends":"../../../tsconfig.base.json","include":["**/*.ts"]}` = **460**），并**删除**不可复现的因果句「listing it would break `tsc -b tsconfig.host.json`」（实测：**无任何** `references` 图指向该程序 —— `apps/vscode-dsh/tsconfig.json` 只引用 4 个 package，`tsconfig.host.json` 只引用 `./apps/vscode-dsh` ⇒ 该句既不可复核也不成立）；③ 修 `review-design` 🟢-1：§1.5 的「20 + 15 + 14 + 11 例」为**失实**，改为实测值（见 §1.5 行内订正） | `implementation.md`（§1.5 / §6.3 / §6.2）；`apps/vscode-dsh/tests/tsconfig.json`（**仅注释**，`include`/`compilerOptions` 未动）；**第 5 轮末再收紧一次**：注释不再声称「the test sources this Phase touched, and only those」，而是给出**可复核判据**「**给了程序后 `no-unsafe-*` 被清零的 Phase-3 spec**」+ 显式排除两种误读（「全部干净的 spec」/「全部 Phase-3 spec」）+ 点名其它**无需程序即干净**的 spec 与可重跑枚举命令（实测形状见 §7.8 (6) 末行） | 三处均为 `[文档保真]` 类：**不改交付物行为**，但本仓库的 prose 标准要求 claim 可复核（`dsh-prose-standard`）；且 §6.3 的旧措辞与 `D8` 相邻时容易被读成矛盾（`review-design` 🟢-3 即如此读） | 注释改动后复跑：`tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit` 仍 **170**；`oxlint-contract.spec.ts` **14 passed**（§7.8 (6)）。**零**行为影响：注释不参与编译，`include` / `compilerOptions` 一字未动 |
| **D33** | **【本轮边界与会话事实（含对 `D18 (E)` 的复测刷新）】** ① **未 commit / 未切分支 / 未动 git 索引**：全程 `impl-phase-3-layer-v-smoke-loop`；未执行 `commit` / `checkout` / `switch` / `add` / `stash` / `reset` / `restore` / `clean`；② **未运行全仓 `pnpm run lint`**（它会先跑 `build:lib:host`；本轮一律用**显式路径口径** `npx tsx scripts/run-oxlint.ts <path>`），**未触碰** `DEBT-019` 范围；③ **未重跑真机链路**（本机无 `DEEPSEEK_API_KEY`）；④ 所有 scratch probe 与原始输出落在**被忽略**的 `apps/vscode-dsh/test-artifacts/layer-v/.probe/`；⑤ **复测刷新 `D18 (E)` 的三项判据**：768 个既存未跟踪构建孪生的 mtime **仍为 2026-09-11（708）/ 09-14（60）**、**无一个今日 mtime**（本轮 `build:*` 未重写它们）；全仓**未跟踪（非忽略）**文件中今日 mtime 者由 38 → **42**（**计数规则 = 本机时区 UTC+8 的 mtime 日期**；用 UTC 分桶为 32，两者都真、差在规则 —— 已把规则写进 §7.8 (6)）；该 42 **不是**「本轮改动集」（含 round-4 的 verifier 产物与其它 agent 的 `.md`，且 round-4 同样发生在 09-17）⇒ **逐文件归属以 §1.6 为准，mtime 只证明「今日被写过」**；其中**构建产物 0** | `.gitignore` 的 `test-artifacts/` 边界；`spec.md:197`；**AC 判定不受影响** | 如实区分「本轮做了什么 / 没做什么」，并给出**可复核**的树状态数字（跨树/跨时点的全仓 lint 对比无效，这是 `O-5` 的结论） | **零**（边界声明 + 复测）：不改变任何 AC 判定；`D18 (E)` 的**结论**（未动既存构建产物 ⇒ 其内容未变）**经本轮复测保持成立**，仅计数刷新（38 → 42）。**未 commit ⇒ 工作区仍是唯一交付面**（调度者在 HG-3 统一 commit） |
| **D34** | **【技能回写】** `.cursor/skills/project-test/SKILL.md` 追加本轮新知识：① **未重复登记**本机 `node` 版本坑 —— `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`（否则 `pnpm exec vitest` 报 `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`）**已在技能内既有条目中**（「Node 必须前置 24.3.0」），本轮**只引用**（遵循「同一事物的多条记录应合并」）；② shell 契约类测试的驱动形态（`spawnSync('bash', …)` + **source shipped shell 模块** + 真帧目录 + 双向变异结果 8 红 / 11 绿）；③ `oxlint` 的 `--tsconfig=<program>` **会跳过**不属于该程序的文件 ⇒ 既**不能**用它反推修前分布，也正是 **D28** 那句构造矛盾的成因 | `.cursor/skills/project-test/SKILL.md` | `CLAUDE.md` 的 Project Operation Skills 规则（agent MUST update the skill after successful operations） | 后续 agent 不再重复踩同一个 Node 版本坑；D28 的构造矛盾的成因有了落盘出处 |

### 6.3 未做 / 不做的事（边界声明）

- **未**修改 `packages/core/agent-loop`；**未**新增任何 npm 依赖（驱动 `package.json` 无依赖、无 `bin`）。
- **未**触碰真实 `~/.dsh`（route A 的 `HOME` 沙箱是唯一写入面，脚本断言真实 `~/.dsh` 摘要不变）。
- **未**使用注入/回放构造 Diff（`dsh.test.openHistory` 未用于构造）；**未**使用 UI 自动化（`xdotool` 等）。
- **未**放宽影子 preset 的「严格 2 行删除且零新增」断言。
- **未**改字段集（仍恰 18）/ `kind` 词表 / 退出码与结论分类契约；**未**改 `spec.md`、`scope-amendment-01.md`；**未**新增技术债条目。
- **未主动改动** `pnpm-lock.yaml` —— 但该文件**确有**改动（实测：`git status --porcelain pnpm-lock.yaml` → ` M pnpm-lock.yaml`；`git diff --stat 300f492f84 -- pnpm-lock.yaml` → `7 insertions(+), 4 deletions(-)`）：来源为 `pnpm install` 的**一致性回填**、**非本 agent 主动所为**，详见 §6.2 **D8**；调度者已裁定该改动**不纳入提交**。**（与 §6.2 `D8` / `D18 (A)` 为同一表述 —— 三处同向，不存在矛盾：文件**变了**、成因**不是**本 agent、处置**不纳入提交**。）** **未**动工作区既存未跟踪构建产物 —— 768 个既存未跟踪孪生（672 个 `packages/**/src/**` + 96 个 `vendor/cordis/src/**`，后缀 `.d.ts/.js/.map`）的 **mtime 仍为 2026-09-11 / 09-14**（第 5 轮复测同值，见 §6.2 **D33 (⑤)** 与 §7.8 (6)）⇒ 内容未变；工作区既有的 `**/lib/**` 产物被 `.gitignore:4`（`lib/`）忽略，**不构成**未跟踪产物（**第 5 轮未构建**，见 §6.2 **D33**）。

本轮（第 4 轮）新增的边界声明：

- **未归档 `implementation.md`** —— 对「启动自清理协议」的**显式已披露偏离**（派单 §硬约束 5 明文授权）。理由：D1–D18 描述的是**仍在交付物中**的代码，归档会把台账移出 `reviewer` 的直接读取路径。本文件**保留直接路径、未建副本**；§6.2 接续 `D18` 编号（`D19`–`D24`）、未新开节、未重排既有编号；`### 6.1` / `### 6.2` / `### 6.3` 各**恰好一次**。
- **未 commit、未切分支、未动 git 索引**：全程 `impl-phase-3-layer-v-smoke-loop`；未执行 `commit` / `checkout` / `switch` / `add` / `stash` / `reset` / `restore` / `clean`。`git diff --cached --name-only` 当前**仅** `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` 一项，且它在本轮开工前的会话初始 `git status` 中已是 ` A`（staged）⇒ **非本轮所为**。
- **未触碰 `DEBT-019` 范围**：仓库级 lint 基线（2218 条 / 107 文件）未动、未重测、未登记变化；本轮所有 lint 数字一律用**显式路径口径**（`npx tsx scripts/run-oxlint.ts <path>`），**未**使用全仓 `oxlint .`（受 768 个既存构建孪生影响、跨树不可比）。
- **未动 `.oxlintrc*.json` / `package.json` / `scripts/run-gates.ts`**（派单明示）；对 `DEBT-018` 只做**验证性复核**（5 个 shipped `.cjs` 各 0 error lines；override 见 `.oxlintrc.json:341`），不为它登记改动 —— 归属冲突见 §6.2 **D24 (B)**。
- **未动** `spec.md` / `design.md` / `scope-amendment-01.md` / `scope-amendment-02.md` / `ui-spec.md`（本 Phase `ui: false`，无 `visual-baseline.md`）。
- **未改**：`HostDiagnosticRecord` 字段集（仍恰 18）/ `schemaVersion` 语义 / `kind` 词表 / 任何 AC 的归属与语义 / 退出码契约（`PASS` 0 / `LINK_FAILURE` 1 / `SKIPPED_NO_DISPLAY` 2 / `SKIPPED_NO_CREDENTIALS` 3 / `HARNESS_ERROR` 4）。
- **未重跑真机链路**（本机无 `DEEPSEEK_API_KEY`，派单 §硬约束 4）⇒ §0 / §7.2 / §7.3 的真机结论仍为**上一轮**的观测，本轮**未**新增运行证据。本轮新增的**全部**是「离线可失败性证据」（§7.7），其对象是 shipped 代码本身。

第 5 轮新增的边界声明：

- **未归档 `implementation.md`**（第 5 轮同样「追加」而非「归档」，理由与第 4 轮相同：`D1`–`D24` 描述的是**仍在交付物中**的代码）。§6.2 接续 `D24` 编号（`D25`–`D34`），`### 6.1` / `### 6.2` / `### 6.3` 各**恰好一次**。
- **未 commit / 未切分支 / 未动 git 索引**：全程 `impl-phase-3-layer-v-smoke-loop`；未执行 `commit` / `checkout` / `switch` / `add` / `stash` / `reset` / `restore` / `clean`（§7.8 末尾复核）。
- **未运行全仓 `pnpm run lint`**：它会先跑 `build:lib:host`（本轮刻意不触发构建，以保住 §6.3 上半段「既存孪生未被重写」这一可复核事实）；本轮所有 lint 数字一律用**显式路径口径** `npx tsx scripts/run-oxlint.ts <path>`。**未触碰 `DEBT-019` 范围**。
- **未改**：`schemaVersion` 语义 / 字段集（仍恰 18）/ `kind` 词表 / 任何 AC 的归属与语义 / 退出码契约（`PASS` 0 / `LINK_FAILURE` 1 / `SKIPPED_NO_DISPLAY` 2 / `SKIPPED_NO_CREDENTIALS` 3 / `HARNESS_ERROR` 4）/ `ui: false`。
- **未动** `design.md` / `scope-amendment-01.md`；**未动** `scope-amendment-02.md` 的 §8.1–§8.3 裁定原文（**只在文末追加 §8.4** 的落地留痕）。
- **未动** `.oxlintrc*.json` / `package.json` / `scripts/run-gates.ts`（只读复核 `DEBT-018` 的两半：override 与 `check:test-scripts-syntax`）。
- **未改** `spec.md` 的 AC 归属与语义：唯一改动是**用户显式授权**的阈值措辞（`≥2` → `≥3`，§8.3 覆盖声明）。
- **未新增技术债条目**：`DEBT-014` / `017` 的状态订正是**回到事实**；`DEBT-018` 的残余按用户裁定**不另立条目**但**如实留痕**（registry + `scope-amendment-02.md` §8.4）。
- **未动非本 Phase 文件**：本轮改动集见 §1.6，全部落在 `apps/vscode-dsh/test-scripts/**`、`apps/vscode-dsh/tests/**`、`scripts/oxlint-contract.spec.ts`、`.cursor/skills/project-test/SKILL.md` 与本 Phase 的 spec 目录内。

---

## 7. 命令与真实结果（本轮 = 回流轮，全部在本机实跑）

### 7.1 影子 preset 生成器自检（**先于**真机链路）

```bash
bash apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh --check-shadow-preset
```

退出码 **0**；两次生成 `sha256` 相同（`f0e15ed6…15915`），与 shipped 的 `diff` = `28,29d27`（**2 删除 0 新增**），shipped 哈希不变（`e1a9a55d…f360e`）。本次与 round-1 逐字一致。

### 7.2 真机正向冒烟

```bash
bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh          # 标准环境（DISPLAY=:1）
env -u DISPLAY bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh   # 强制走 xvfb 分支
```

| 运行（runId） | 结论 | 退出码 | 关键证据 |
|---|---|---|---|
| `20260916T134549Z-1807615`（`env -u DISPLAY`，**xvfb 分支**；重建前 —— 见下方构建新鲜度注） | **`PASS`** | **0** | 日志 `started a display through xvfb-run on :102 with its credential file`；`report-meta.display = {mode:"xvfb", value:":102"}`；五步齐备；`terminalSide` / `nodeEnvironmentConstruction` 均落盘 |
| `20260916T135716Z-1864170`（标准环境，**最终运行** = 当前 live 产物，**已重建后**） | **`PASS`** | **0** | `steps = step-1:ok step-2:ok step-3:ok step-4:ok step-5:ok`；`failedStep:null`；`display = {mode:"reuse", value:":1"}`；`corroboration = {problems:[],warnings:[],toolCount:25}`；step5 `diffSource:"native-meta-diffs"`；`postLink = {postHandshakeRecordCount:1, fieldSet:{expectedV1Fields:18, actualKeys:18, missingFields:[]}}`；`node.terminalSide`（`judge:"fail"`、`qualified:false`、默认路径、`docsAnchor` 可解析、`action` 非空）+ `node.extensionSubprocessSide`（`judge:"pass"`、`source:"vscode-setting"`、`resolvedExecutable` = 24.3.0 绝对路径、`phase:"post-handshake"`），`nodeCoverage.mergedVerdictFields:[]`；`nodeEnvironmentConstruction`：`before:0 → after:1`、`kind:"node-environment"`、`phase:"start"`、绝对路径 ✅、`settingRestoredTo` = 合格 Node ✅ |

> **⚠️ 构建新鲜度（本轮自查发现并修正）**：本节前一组运行（`…134549Z` / `…134712Z` / `…134751Z` / `…134855Z` / `…134922Z`）跑在**当日 16:23 的旧 bundle** 上 —— 冒烟脚本**只检查产物存在、不检查是否比源码新**（`:2805-2812`），而本轮对 `src/session-host.ts` 的 🟡-5 改动晚于该 bundle。
> 因此我按 spec 顺序重建（`pnpm run build:lib:host` → `pnpm --filter @deepseek-ai/dsh-vscode-dsh run build:host`），并用「新 bundle 内含本轮新增符号 `requireNodeExecutable`」自证构建确实包含本轮源码，然后**重跑了本节与 §7.3 的三条运行**（`…135618Z` / `…135657Z` / `…135716Z`）。上面表中给出的正是**重建后**的证据；`lib/` 被 `.gitignore:4` 忽略且未被 git 跟踪，重建不污染提交面。

### 7.3 负向运行（确认 B2 / B3 未破坏结论分类）

| 运行（runId） | 构造 | 结论 | 退出码 | 关键证据 |
|---|---|---|---|---|
| `20260916T135618Z-1854427`（重建后） | `LAYER_V_FAULT_STEP5_DIFF_COMMAND=dsh.definitelyNotARealCommand`（AC-27(b)） | `LINK_FAILURE` | **1** | `failed stage: step-5 — step-5-review-command-failed`；输出 `FAULT INJECTION ACTIVE`；未输出通过结论 |
| `20260916T135657Z-1859595`（重建后） | `env -u DEEPSEEK_API_KEY -u FEISHU_PROJECT_MCP_TOKEN`，cwd `/tmp`（AC-32） | `SKIPPED_NO_CREDENTIALS` | **3** | `failed stage: node-environment-construction — missing-credentials`；`host diagnostics: kind=missing-credentials \| phase=start`；**未**计入链路失败 |
| `20260916T134751Z-1820608`（重建前） | 仅 `cd /tmp`（**不**清空凭据环境变量） | `PASS` | 0 | 记录为构造事实（§6.2 **D15**）：宿主由脚本 `:1264` 从 `${REPO_ROOT}` 拉起，凭据来自宿主进程环境 → 仅改 cwd 不足以构造「缺凭据」 |
| `20260916T134712Z-1815427` / `20260916T134855Z-1828194`（重建前同构造） | 同上两项构造 | `LINK_FAILURE` 1 / `SKIPPED_NO_CREDENTIALS` 3 | 1 / 3 | 与重建后一致（说明这两条分类与 bundle 版本无关，只取决于脚本+驱动） |

### 7.4 单元 / 集成测试

```bash
# 本 Phase 改动集内的测试文件
pnpm exec vitest run apps/vscode-dsh/tests/{interaction-approval-resolution,layer-v-inject-disconnect,host-diagnostics,session-host,node-env-guard}.spec.ts
# chat-ready 回归套件（排除既存基线失败文件 panel-close-delete.e2e）
./node_modules/.bin/vitest run apps/vscode-dsh/tests/{chat-ready-regression,auto-start-orchestrator,phase1-auto-start,phase2-auto-ready,phase3-chat-ui-chassis,phase4-new-conversation-chrome,phase5-should-polish,phase3-restart-continue,phase2-multitab-history-replay}.spec.ts
# 全量 app 套件
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test apps/vscode-dsh
```

| 命令 | 结果 |
|---|---|
| 本 Phase 5 个测试文件 | **`Test Files 5 passed (5)` / `Tests 99 passed (99)`**，退出码 0 |
| chat-ready 回归套件（9 文件） | **`Test Files 9 passed (9)` / `Tests 91 passed (91)`**，退出码 0 |
| 全量 `apps/vscode-dsh` | `Test Files 4 failed \| 49 passed (53)`；`Tests 6 failed \| 418 passed \| 1 skipped (425)` —— 与 round-1 **逐项相同** |

全量套件的 6 条失败 = **本机既有基线**，与 round-1 完全同集，且已由 `reviewer-correctness` 用 base 对照树（`300f492f84`）独立证实非本改引入：

| 失败文件 | 条数 | 基线对照结论 |
|---|:--:|---|
| `tests/spike-t0a-replay-rebuild.spec.ts` | 4（AC-30/47、AC-76、AC-77、AC-80） | 干净 base 树全绿；带上工作区既存未跟踪 `vendor/cordis/src/*.js`（mtime 2026-09-11）时同样红；单独跑全绿 → 环境/隔离性问题 |
| `tests/spike-t0b-continue-capability.spec.ts` | 0 测试（**加载错误**，`packages/core/agent-loop/src/index.ts:40`） | 同源同因（round-1 未列出该文件，本轮按 O1 补全） |
| `tests/panel-close-delete.e2e.spec.ts` | 1（VP-1-close / VP-1-delete） | 在 base `300f492f84` 上**同样失败** |
| `tests/verifier-phase1/layer-a-rtl.spec.tsx` | 1（V-A4） | 在 base `300f492f84` 上**同样失败** |

### 7.5 Lint（新增 `test-scripts/**` 面）

```bash
pnpm exec oxlint apps/vscode-dsh/test-scripts
```

退出码 **0**；`--format=json` 复核：`number_of_files: 1`（该目录下唯一可 lint 的 JS 是 `layer-v-driver/extension.cjs`；两个 `.sh` 不在 oxlint 范围）、`number_of_rules: 90`、`diagnostics: 0`。

**非空跑证明**（避免「没 lint 到」被当成「干净」）：同一命令加 `--config .oxlintrc.staged.json --deny no-magic-numbers` 会对同一文件产出多条诊断（如 `extension.cjs:2449:6 No magic number: 1500`）→ 规则确实作用于该路径，故 exit 0 的语义是「干净」而非「未扫描」。

### 7.6 文档门禁

round-1 结果（与改动前同一组 6 条既有基线失败，均与本 Phase 无关）在本轮未重跑：本轮回流**未触碰** README / 文档面（§1.4 无文档改动），故沿用 round-1 结论；双语文档配对面未受影响。

### 7.7 本轮（第 4 轮）可失败性证据 —— **全部为原始命令与输出**，对象是 shipped 代码本身

> 本轮**未**重跑真机链路（本机无 `DEEPSEEK_API_KEY`）。下面每项的证明方式都是：**故意构造违反 → 判据确实失败 → 恢复 → 通过**。
> 抽取 shipped 函数时用 `sed -n '<a>,<b>p'` **按行区间逐字提取**，不重写、不转述；唯一被替换的是 `exit_now`（其 shipped 版本会调 `finish` 去写运行报告），这一点在每处单独标注。
> 全部 fixture 建在 `/tmp` 下，仓库在此过程中**只被读**（模块 + 归档截图）。

#### (1) `DEBT-015` —— 逐步骤洁净判据：不可达 → 可失败

```bash
# 判据本体（shipped 模块，fixture = 一个「1 小时前写入」的沙箱会话文件）
FIX=/tmp/d15-failability; rm -rf "$FIX"; mkdir -p "$FIX/.dsh/sessions"
printf 'prior run\n' > "$FIX/.dsh/sessions/previous-run-session.json"
touch -d '1 hour ago' "$FIX/.dsh/sessions/previous-run-session.json"
node -e '
const m = require(process.cwd() + "/apps/vscode-dsh/test-scripts/layer-v-driver/sandbox-clean-state.cjs");
const plan = { homeSandbox: process.argv[1] };
const now = Date.now();
console.log("runStartedAtMsOf({runStartedAtMs: 0})   ->", JSON.stringify(m.runStartedAtMsOf({runStartedAtMs: 0})));
console.log("runStartedAtMsOf({runStartedAtMs: now}) ->", JSON.stringify(m.runStartedAtMsOf({runStartedAtMs: now})));
const a = m.staleProductState(plan, 0);
console.log("staleProductState(plan, 0)             -> {\"offenders\":" + a.offenderCount + ",\"note\":\"the pre-fix value: inert\"}");
const b = m.staleProductState(plan, now);
console.log("staleProductState(plan, real instant)  ->", JSON.stringify({scannedFiles: b.scannedFiles, offenderCount: b.offenderCount, first: b.offenders[0]}));
console.log("runStartedAtMsOf(-1)        ->", JSON.stringify(m.runStartedAtMsOf({runStartedAtMs: -1})));
console.log("runStartedAtMsOf(null)      ->", JSON.stringify(m.runStartedAtMsOf({runStartedAtMs: null})));
console.log("runStartedAtMsOf(\"x\")       ->", JSON.stringify(m.runStartedAtMsOf({runStartedAtMs: "x"})));
console.log("runStartedAtMsOf(undefined) ->", JSON.stringify(m.runStartedAtMsOf(undefined)));
' "$FIX"
```

> 上列命令是**可复跑的确切形态**。原始捕获（14:0x）用的是 `mktemp -d` 生成的沙箱路径（`/tmp/scs-xoi2ES`，见下方输出首行）；**2026-09-17 以固定路径 `/tmp/d15-failability` 复盘**，输出逐字一致（仅路径与 instant 数值不同）：

```
runStartedAtMsOf({runStartedAtMs: 0})   -> {"ok":false,"value":0}
runStartedAtMsOf({runStartedAtMs: now}) -> {"ok":true,"value":1789626228305}
staleProductState(plan, 0)             -> {"offenders":0,"note":"the pre-fix value: inert"}
staleProductState(plan, real instant)  -> {"scannedFiles":1,"offenderCount":1,"first":{"path":"/tmp/d15-failability/.dsh/sessions/previous-run-session.json","mtimeMs":1789622628292.123,"runStartedAtMs":1789626228305,"reason":"predates-run"}}
runStartedAtMsOf(-1)        -> {"ok":false,"value":-1}
runStartedAtMsOf(null)      -> {"ok":false,"value":null}
runStartedAtMsOf("x")       -> {"ok":false,"value":"x"}
runStartedAtMsOf(undefined) -> {"ok":false,"value":null}
```

原始捕获（`/tmp/scs-xoi2ES`）的输出：

```
fixture: one session file written 1h before this run -> /tmp/scs-xoi2ES/.dsh/sessions/previous-run-session.json
runStartedAtMsOf({runStartedAtMs: 0})  -> {"ok":false,"value":0}
staleProductState(plan, 0)             -> {"offenders":0,"note":"the pre-fix value: inert"}
staleProductState(plan, real instant)  -> {"scannedFiles":1,"offenderCount":1,"first":{"path":"/tmp/scs-xoi2ES/.dsh/sessions/previous-run-session.json","mtimeMs":1789621237375,"runStartedAtMs":1789624837380,"reason":"predates-run"}}
runStartedAtMsOf(-1)          -> {"ok":false,"value":-1}
runStartedAtMsOf(null)        -> {"ok":false,"value":null}
runStartedAtMsOf("x")         -> {"ok":false,"value":"x"}
runStartedAtMsOf(undefined)   -> {"ok":false,"value":null}
```

同一份 fixture：**用修前那个值（`0`）⇒ `offenderCount = 0`（判据惰性、放行残留）；用真实 instant ⇒ `offenderCount = 1` + `reason: "predates-run"`（判据失败）**。

```bash
# 脚本层：逐字抽取 shipped 断言函数（run-layer-v-smoke.sh:1344-1365 + :206-207 / :214-219 / :221-225）
#   exit_now 被替换为 `exit "${EXIT_CODE}"`（stub，shipped 版本会调 finish 写报告）
```

```
=== case A: the plan carries the writer's initialiser (runStartedAtMs: 0) ===
[layer-v] HARNESS_ERROR at plan: runStartedAtMs is 0, not a positive epoch-ms instant — the per-step sandbox cleanliness predicate cannot fail without it (DEBT-015)
exit=4

=== case B: the plan carries a real instant (what the script now writes) ===
no failure raised -> conclusion=PASS exit=0
exit=0

=== case C: the plan lost the field entirely ===
[layer-v] HARNESS_ERROR at plan: runStartedAtMs is null, not a positive epoch-ms instant — the per-step sandbox cleanliness predicate cannot fail without it (DEBT-015)
exit=4
```

**失败路径的另一半**（驱动侧，读自 shipped 源码 `extension.cjs:2304-2310`）：`offenderCount > 0` ⇒ `throw harnessError('step-N-sandbox-product-state-not-clean')` ⇒ `HARNESS_ERROR`。

#### (2) `DEBT-014` —— 陈旧 bundle：不 PASS

```bash
node apps/vscode-dsh/test-scripts/layer-v-support/build-freshness.cjs <artifactRoot> <entry> <sourceRoot...>
```

| fixture | 判据输出 | 退出码 |
|---|---|:--:|
| 产物（2026-01-02）**新于**源码（2026-01-01） | `"ok":true,"reason":null` | **0** |
| 源码被 touch 到 2026-01-03（**陈旧 bundle**） | `"ok":false,"reason":"build-artifacts-stale"` | **1** |
| 产物在、入口 `require('./chunk-that-was-never-written.js')`（**中断构建**） | `"ok":false,"reason":"build-entry-incomplete"` | **1** |
| 产物根不存在 | `"ok":false,"reason":"build-artifacts-absent"` | （同上，非 0） |

消费侧（shipped `run-layer-v-smoke.sh:1144`）：非 `ok` ⇒ `fail_harness "build-freshness"` ⇒ `HARNESS_ERROR` 4。**该检查在拉起 EDH 之前**。

#### (3) `DEBT-016` —— `artifact-index.md` 自断言：只 `note` → 致命

**模块层**（`artifact-index.cjs append <index> <row>`，退出码即答案；fixture = 真实 `artifact-index.md` 的副本）：

| 构造 | 输出 | 退出码 |
|---|---|:--:|
| 正常追加 | `77`（落盘行号） | **0** |
| **同一行追加两次**（重复） | `the appended row appears 2 times, not once` | **1** |
| 首个表格块内**插入第二个表头行** | `the index renders as 2 run tables before the new row, not one` | **1** |
| 索引文件不存在 | `the index /tmp/round4-failability/absent.md does not exist; no row was appended` | **1** |

> 附带发现（记为**健壮性观察，非失败证据**）：在索引**尾部**追加第二张表**不会**触发失败 —— 追加锚点始终落在**首个连续表格块**内，故 `headerRowsBeforeRow` 仍为 1。即「末尾多一张表」不是本模块定义的违规，本条**不作为**该判据的失败证据。

**脚本层**（shipped `record_evidence_violation` 逐字抽取）：

```
before: conclusion=PASS exit=0
[layer-v] note: artifact-index: the appended row appears 2 times, not once
[layer-v] evidence violation at artifact-index: the appended row appears 2 times, not once
after:  conclusion=HARNESS_ERROR exit=4 stage=artifact-index

before: conclusion=LINK_FAILURE exit=1
... 同一违规 ...
after:  conclusion=LINK_FAILURE exit=1 stage=step-3      ← 单向上转：不得掩盖产品发现
```

#### (4) `DEBT-017` / R2 —— 截图有效性判据（直接用磁盘上**真实**归档产物）

```bash
node apps/vscode-dsh/test-scripts/layer-v-support/display-evidence.cjs judge <artifactDir> <mode> 0
```

**退化（`reuse`，5 帧全同）** —— `20260916T170525Z-2277459`：

```
retry
{"ok":true,"frames":5,"md5":{"step-1-host-started.png":"c515d51f…","step-2-new-conversation.png":"c515d51f…","step-3-model-round-trip.png":"c515d51f…","step-4-approval.png":"c515d51f…","step-5-native-diff.png":"c515d51f…"},"distinctMd5":1,"degenerate":true,"action":"retry","reason":"the reused DISPLAY produced five identical frames (distinct md5 = 1/5); AC-26(e) requires interface evidence and AC-28 R2.3 requires the xvfb display instead"}
```

**健康（`xvfb`，真实 EDH 窗口）** —— `20260916T165522Z-2238377`：

```
pass
{"ok":true,"frames":5,"md5":{"step-1-host-started.png":"076ad323…","step-2-new-conversation.png":"096fa52a…","step-3-model-round-trip.png":"366c16c9…","step-4-approval.png":"978a9df1…","step-5-native-diff.png":"5ceab7ef…"},"distinctMd5":5,"degenerate":false,"action":"pass","reason":"AC-26(e) satisfied (distinct md5 = 5/5)"}
```

**帧几何（独立复核**派单给出的事实依据**）**：退化运行 5 帧均 **3840×1080**（桌面壁纸）；`xvfb` 运行 5 帧均 **1600×1000**（EDH 窗口）⇒ 与派单陈述一致，**无异议**。

**「满足下限但不得重跑」的边界用例** —— `20260916T170431Z-2270421`（`reuse`，**4 帧逐字节相同 + 第 5 帧不同**）：

```
pass
{"ok":true,"frames":5,"md5":{"step-1-host-started.png":"9f81cca7…","step-2-new-conversation.png":"9f81cca7…","step-3-model-round-trip.png":"9f81cca7…","step-4-approval.png":"9f81cca7…","step-5-native-diff.png":"c515d51f…"},"distinctMd5":2,"degenerate":false,"action":"pass","reason":"AC-26(e) satisfied (distinct md5 = 2/5)"}
```

这是选择「跑完再回退」而非「先探针」的**实测依据**：任何「首两帧相同即退化」的探针都会把这条**合规**运行误判为退化并白跑 5 步（2× 成本）。

**归档 43 个真实运行的判据分布**（`reuse` / `xvfb` 混合，逐个跑 `judge`）：`reuse` + 5 帧 ⇒ `distinctMd5=1` **7** 次（全部 `retry`）、`=2` **1** 次（`pass`）、`=5` **2** 次（`pass`）；`xvfb` + 5 帧 ⇒ **4** 次全部 `=5` / `pass`。

#### (5) lint 清零（显式路径口径）

```bash
npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests/<file>
```

| 文件 | 修前（`verification.md` round-3） | 修后 `no-unsafe` | 修后 error lines |
|---|:--:|:--:|:--:|
| `host-diagnostics.spec.ts` | +6 | **0** | **0** |
| `node-env-guard.spec.ts` | +6 | **0** | **0** |
| `session-host.spec.ts` | +15 | **0** | **0** |
| `layer-v-inject-disconnect.spec.ts` | +27 | **0** | **0** |
| 合计 | **54** | **0** | **0** |

**A/B 对照（证明是「补了类型」而不是「关了规则」）** —— 同规则、同命令、同为本仓 spec：

```
### B: control — a sibling spec NOT owned by that tsconfig (phase-2, out of scope)
phase2-change-list-display.spec.ts no-unsafe=50
```

即：**未被** `apps/vscode-dsh/tests/tsconfig.json` 覆盖的同类文件仍报 50 条，4 个目标文件 0 条。

`DEBT-018` 覆盖（**只验证、未改动**）：5 个 shipped `.cjs` 各 `error-lines=0`；override 见 `.oxlintrc.json:341`。

#### (6) 语法门禁与分支复核

```
bash -n OK: apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
bash -n OK: apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh
node --check OK: layer-v-driver/extension.cjs / layer-v-driver/sandbox-clean-state.cjs
node --check OK: layer-v-support/{artifact-index,build-freshness,display-evidence}.cjs
```

`git branch --show-current` = `impl-phase-3-layer-v-smoke-loop`；`git diff --cached --name-only` = 仅 `artifact-index.md`（**开工前即为 staged**，非本轮所为）。

### 7.8 第 5 轮可失败性证据 —— **全部为原始命令与输出**，对象是 shipped 代码本身

> 所有 probe 与原始输出落在**被 `.gitignore` 忽略**的 `apps/vscode-dsh/test-artifacts/layer-v/.probe/`（`ls` 可见），**不进入交付物**。
> 本机默认 `node` 为 v20.16.0（不满足 `engines.node`）⇒ 所有 `pnpm exec vitest` / `tsc` 均前置 `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`。

#### (1) 任务 A —— `DEBT-017` 消费侧：`action` / 分支 / `RETRY_REQUIRED` / 记账的前后对照

驱动形态：`consumer-run-level.sh` **逐字复用** `run-layer-v-smoke.sh` 的 `log` / `note` / `fail_harness` / `fail_display` 语义，`source` shipped 的 `display-evidence-shell.sh`，对**磁盘上真实归档运行目录**调用 `assert_display_evidence`，并把结果打成 JSONL。

**缺陷态**（把三处改回复现：`printf >&2` → `printf`；`assert_display_evidence` 改回 `action="$(display_evidence_verdict …)"`；`case` 改判 `${action}`）：

```
{"label":"before","run":"20260916T113508Z-1419033","mode":"reuse","conclusion":"PASS","action":"","reachedBranch":"* (fail-closed)","retryRequired":false,"distinctMd5":null,"frames":null,"recordAction":"","failure":"HARNESS_ERROR display-evidence: AC-26(e): the frames of this attempt are not evi"}
{"label":"before","run":"20260916T170431Z-2270421","mode":"reuse","conclusion":"PASS","action":"","reachedBranch":"* (fail-closed)","retryRequired":false,"distinctMd5":null,"frames":null,"recordAction":"","failure":"HARNESS_ERROR display-evidence: AC-26(e): the frames of this attempt are not evi"}
{"label":"before","run":"20260916T132421Z-1711361","mode":"reuse","conclusion":"LINK_FAILURE","action":"","reachedBranch":"(none)","retryRequired":false,"distinctMd5":null,"frames":null,"recordAction":"","noteCount":1,"failure":""}
```

⇒ 与 `scheduler-findings-round4.md` 一致：**凡 driver 判 `PASS` 一律 `HARNESS_ERROR`/4**；`action` 恒空（`case` 恒落 `*`）；`distinctMd5`/`frames`/`recordAction` 恒 null/空（**记账不成立**）；`retryRequired` 恒 `false`（**R2.3 的 `xvfb` 重跑从未执行**）。

**修复态**（同一批归档输入，shipped 代码）：

```
{"label":"after","run":"20260916T113508Z-1419033","mode":"reuse","conclusion":"PASS","action":"pass","reachedBranch":"pass","retryRequired":false,"distinctMd5":5,"frames":5,"recordAction":"pass","recordReason":"AC-26(e) satisfied (distinct md5 = 5/5, floor 3)","consumerStdoutBytes":0}
{"label":"after","run":"20260916T170431Z-2270421","mode":"reuse","conclusion":"PASS","action":"retry","reachedBranch":"retry","retryRequired":true,"distinctMd5":2,"frames":5,"recordAction":"retry","consumerStdoutBytes":305}
{"label":"after","run":"20260916T132421Z-1711361","mode":"reuse","conclusion":"PASS","action":"retry","reachedBranch":"retry","retryRequired":true,"distinctMd5":1,"frames":5,"recordAction":"retry","consumerStdoutBytes":305}
{"label":"after","run":"20260916T132421Z-1711361","mode":"xvfb","forced":true,"conclusion":"PASS","action":"skip","reachedBranch":"skip","retryRequired":false,"distinctMd5":1,"frames":5,"recordAction":"skip","failure":"DISPLAY display-evidence: AC-28 R2.3 / AC-26(e): every display this run could us"}
{"label":"after","run":"20260916T133438Z-1751909","mode":"reuse","conclusion":"PASS","action":"fail-closed","reachedBranch":"* (fail-closed)","distinctMd5":null,"frames":4,"recordAction":"fail-closed","failure":"HARNESS_ERROR display-evidence: AC-26(e): the frames of this attempt are not evi"}
{"label":"after","run":"20260916T132421Z-1711361","mode":"reuse","conclusion":"LINK_FAILURE","action":"retry","reachedBranch":"(none)","retryRequired":false,"distinctMd5":1,"frames":5,"recordAction":"retry","noteCount":1,"failure":""}
```

| 追问（派单 §完成后请回报 3） | 实测答案 |
|---|---|
| `action` 值 | `pass` / `retry` / `skip` / `fail-closed`（缺陷态恒 `""`） |
| `case` 命中分支 | `pass`（distinct=5）、`retry`（distinct=2 与 1）、`skip`（`xvfb` 且仍退化）、`*`（不足 5 帧 ⇒ `fail-closed`）—— **四个分支各至少一次可达**；非 PASS 驱动结论时**不进入分支**（`reachedBranch:"(none)"`），只 `note`，**不改结论** |
| `DISPLAY_RETRY_REQUIRED` | 缺陷态恒 `false`；修复态在 `retry` 分支为 **`true`**（⇒ `main` 会跑 R2.3 的 `xvfb` 重跑），其它分支 `false` |
| 运行记录 `distinctMd5` / `action` / `reason` | 缺陷态 **null / 空 / 空**；修复态 **5 / `pass` / `AC-26(e) satisfied (distinct md5 = 5/5, floor 3)`**、**2 / `retry` / 低于下限的实测句子**、**1 / `skip`**、**4 帧 / `fail-closed`** —— 即 `record_display_evidence_attempt` 记到了**本次判决** |
| `note` 是否再夹带日志行 / 空 reason 占位 | `consumerStdoutBytes` 在 `pass` / `skip` / `*` 路径为 **0**；`retry` 路径的 305 字节是**运行自己的 `log` 行**（调用方**不**捕获 stdout ⇒ 无二次拼接）；非 PASS 驱动的 `note` 恰 1 条（`noteCount:1`），无空 reason 占位 |

**A5 回归测试的双向演示**（`apps/vscode-dsh/tests/display-evidence-shell.spec.ts`）：

```
# 缺陷在（stdout 污染 + 子 shell 赋值 + case 判局部变量）
Test Files  1 failed (1)
      Tests  8 failed | 3 passed (11)

# 修后
Test Files  1 passed (1)
      Tests  11 passed (11)

# 调用方缺陷（把 run-layer-v-smoke.sh 的 assert_display_evidence 调用包回 $( … )）
❯ apps/vscode-dsh/tests/display-evidence-shell.spec.ts (11 tests | 1 failed)
     × sources the consumer and calls it directly rather than through a command substitution
      Tests  1 failed | 10 passed (11)
```

#### (2) `scope-amendment-02` §8.1 🟡-1 —— `homeSandbox` 缺失：由「恒真」到「拒绝」

**驱动侧（shipped 守卫文本 × shipped 判据模块）**：从 `layer-v-driver/extension.cjs` **逐字抽取** `:2293-2299` 的守卫块（含 `if (sandboxHome.ok !== true) { throw harnessError('sandbox-clean-state-check-unavailable', …) }`），只 stub 驱动自己的报告器（`harnessError` / `safeJson`），判据用**shipped** `homeSandboxOf`：

```
accepted  a plan with the shell-sampled instant and the sandbox HOME
refused   a plan missing homeSandbox -> sandbox-clean-state-check-unavailable
refused   a plan whose homeSandbox is the empty string -> sandbox-clean-state-check-unavailable
refused   a plan whose homeSandbox names nothing on disk -> sandbox-clean-state-check-unavailable
refused   a plan missing runStartedAtMs -> sandbox-clean-state-check-unavailable
```

（`runAll` 未导出、只能在 EDH 内到达 ⇒ 本项的驱动侧证据是**逐字抽取的 shipped 守卫** + **shipped 模块**，**不是**一次 live EDH 运行 —— 边界如实声明。）

**判据本体（shipped spec，双向）**：把 `homeSandboxOf` 退化回「一律 `ok:true`」（即 🟡-1 描述的那条退化）：

```
     × refuses a missing field / × refuses an empty string / × refuses a path that does not exist
     × refuses a relative path that resolves to nothing / × refuses a number / × refuses null
     × refuses a plan that is not an object
     × refuses a sandbox home that names a file rather than a directory
     × refuses the empty home instead of reporting a clean sandbox
      Tests  9 failed | 16 passed (25)
```

恢复 shipped 实现后（`sha256sum -c` 比对备份 **OK**）：

```
      Tests  25 passed (25)
```

#### (3) `scope-amendment-02` §8.1 🟡-4 / U-b —— workspace 半区：缺失 / 陈旧一律**不通过**

同一模块、同一命令，只改 `--sibling` 指向的工作区根（三条为故意构造的违反情形）：

```
[unbuilt ] {"ok":false,"reason":"workspace-artifacts-absent","detail":"…/unbuilt: no build artifact could be read under …/unbuilt/lib; this workspace root was never built, so the host would resolve a bundle this check never inspected"}
[stale   ] {"ok":false,"reason":"workspace-artifacts-stale","detail":"…/stale: …/stale/src/a.ts is newer than every file under …/stale/lib (source 2026-09-02T00:00:00.000Z > artifacts 2026-09-01T00:00:00.000Z)"}
[healthy ] {"ok":true,"reason":null,"detail":"the build is at least as new as the sources it was built from","artifactCount":256,"entry":"apps/vscode-dsh/lib/extension.js","entryExists":true}
[real    ] {"ok":true,…}（本工作区真实产物面）
```

⇒ workspace 半区**缺失 / 陈旧** ⇒ `ok:false`（**fail-closed，不静默通过**）；健康态 `ok:true`。判据边界（mtime 是必要性判据、非充分条件）已在模块与 §6.2 **D29** 声明。

#### (4) `scope-amendment-02` §8.1 🟡-2 —— 派单字面形态**不可满足**（一手实测）

```
OXC_LOG=debug oxlint --config <继承 .oxlintrc.json 的探针 config> --format unix apps/vscode-dsh/tests/oxlint-contract-<id>.ts
Got tsconfig for file …/apps/vscode-dsh/tests/oxlint-contract-1789634448.ts: <none>
Done assigning files to programs. Total programs: 0. Unmatched files: 1
  Unmatched file: …/apps/vscode-dsh/tests/oxlint-contract-1789634448.ts
```

⇒ 该目录的 `tsconfig.json` 是**显式列举**（9 个文件），落在其中的临时探针文件**永远**解析不到程序 ⇒ 派单要求的 `['vscode app test', 'apps/vscode-dsh/tests', 'apps/vscode-dsh/tests/tsconfig.json']` 一行**恒假**（`scripts/oxlint-contract.spec.ts:119` 的注释亦已记录同一事实）。

**落地的同等形态 + 双向**（把该文件从 `tests/tsconfig.json` 的 `include` 中拿掉 ⇒ 契约必须红）：

```
# 违反情形（include 中移除该文件）
AssertionError: apps/vscode-dsh/tests/display-evidence-shell.spec.ts: expected '…chat-ux-session…' to contain 'Got tsconfig for file /workspace/chen…'
      Tests  1 failed | 13 skipped (14)

# 恢复（sha256sum -c OK）
      Tests  1 passed | 13 skipped (14)
```

#### (5) `scope-amendment-02` §8.1 🟡-3 —— `MIN_DISTINCT_MD5` `2 → 3`：真实归档前后对照

同一批**磁盘上真实归档运行**，同一模块的**两份拷贝**（floor 3 与把常量改回 2 的临时拷贝）各自 `measureFrames` + `judgeEvidence`（原始输出已归档到 `test-artifacts/layer-v/.archive/round5-floor-compare-<UTC>.txt`）：

```
archived run directories: 47
  with five step frames and a measurement both floors agree on: 16
distinct-md5 histogram: {"1":9,"2":1,"5":6}

run                                distinct  floor2(reuse/xvfb)  floor3(reuse/xvfb)  moved
20260916T170431Z-2270421                  2  pass/pass           retry/skip          YES
（其余 15 个运行 · distinct 为 1 或 5 · 两档判定相同）

runs whose verdict moves under the raised floor: 1 of 16
  20260916T170431Z-2270421: distinct=2 reuse pass -> retry, xvfb pass -> skip
```

⇒ **原先判 `pass` 的 `distinctMd5 = 2` 运行在 `≥3` 下改判退化**：`reuse` → `retry`（触发 `DISPLAY_RETRY_REQUIRED`）、`xvfb` → `skip`（不 PASS）。
**影响面**：16 个可测归档中 **1** 个改判；`distinctMd5` 为 1 或 5 的 15 个**判定不变**（`1` 处本来就 `retry`/`skip`）。31 个不可测目录（不足 5 帧）**两档皆不可测**，不受影响。

#### (6) 任务 D —— 文档保真订正后的复核 + 树状态复测

```
pnpm exec tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit          → 170 error lines   （注释改写前=后）
同目录探针 {"extends":"../../../tsconfig.base.json","include":["**/*.ts"]} → 460 error lines
pnpm exec vitest run scripts/oxlint-contract.spec.ts                   → Test Files 1 passed / Tests 14 passed
bash scripts/check-test-scripts-syntax.sh                             → 4 shell asset(s) parse / exit 0
npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests                   → 44 / 54 个 spec 有诊断；16 个为 0，其中**只有 9 个**在 include 内
npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests/tsconfig.json      → "No files found to lint"（`.json` 不是可 lint 资产；exit 1 = 无文件，非诊断）
```

> **注释口径的最后一次收紧（回应 `review-design` 🟢-3 的「`include` = the test sources this Phase touched, and only those」）**：现行注释**不再**声称「本 Phase 触及的测试源」，而是给出**可复核的判据**——「**给了程序后 `no-unsafe-*` 被清零的 Phase-3 spec**」，并显式声明它**既不是**「全部干净的 spec」**也不是**「全部 Phase-3 spec」，同时点名 `interaction-approval-resolution.spec.ts` 与另外几个**无需程序即干净**的 spec（`auto-start-orchestrator` / `timeline-projector` / `conversation-registry`）并给出可重跑的枚举命令。上表最后一行即该命令的实测形状（44 有诊断 / 16 为零 / 9 在 include 内）。

树状态复测（§6.2 **D33** ⑤；**计数规则**：`git ls-files --others --exclude-standard --untracked-files=all` 后按**本机时区（UTC+8）**的 mtime 日期分桶 —— 用 UTC 分桶会少 10 个（32 而非 42），两值都真，差在规则）：

```
untracked entries（--untracked-files=all）: 1151
既存构建孪生（packages|vendor/**/src/** 的 .d.ts/.js/.map）: 768 = packages 672 + vendor 96
孪生 mtime 分布: 2026-09-11 × 708 / 2026-09-14 × 60（无一个今日 mtime）  ← 第 5 轮复测同值
今日 mtime 的未跟踪（非忽略）文件: 42（全仓，含 .specdev/ 与其它 agent 产物）—— 构建产物 0
```

> 第 5 轮复测口径（可重跑）：
> `git ls-files --others --exclude-standard > /tmp/uo.txt`
> 孪生 = `grep -E '^(packages|vendor)/.*/src/.*\.(d\.ts|js|map)$' /tmp/uo.txt` → `wc -l` = **768**；再 `while read f; do date -r "$f" +%F; done` 分桶 → **708 / 60 / 0 今日**。
> **说明**：42 这个数字**不是**「本轮改动集」—— 它包含 round-4 的 verifier 产物（`test-scripts/verifier-round4-*.sh`）与其它 agent 的 `.md`。**逐文件归属以 §1.6 的改动集为准，mtime 只能证明「今日被写过」**（round-4 也发生在 09-17）。

#### (7) 本轮门禁与测试（显式路径口径 / 逐文件）

```
# lint（本 Phase 触及且可 lint 的文件；退出码与 error 行数）
display-evidence.cjs / build-freshness.cjs / sandbox-clean-state.cjs / extension.cjs / artifact-index.cjs
display-evidence.spec.ts / display-evidence-shell.spec.ts / sandbox-clean-state.spec.ts / build-freshness.spec.ts
scripts/oxlint-contract.spec.ts                          → 各 exit=0 / errorLines=0

# 逐文件用例数（本轮真值）
sandbox-clean-state.spec.ts → Tests 25 passed (25)
artifact-index.spec.ts      → Tests 11 passed (11)
build-freshness.spec.ts     → Tests 19 passed (19)
display-evidence.spec.ts    → Tests 16 passed (16)
display-evidence-shell.spec.ts → Tests 11 passed (11)          （合计 82）

# 5 个 spec 一次跑
Test Files  5 passed (5) / Tests  82 passed (82)
```

`lint` 控制项（证明该门禁**不是恒绿**）：故意写入含违反的文件 ⇒

```
scripts/lint-probe-1789634208.ts:1:30: error @stylistic(semi): Extra semicolon.
apps/vscode-dsh/tests/lint-probe-1789634208.spec.ts:3:22: error typescript(no-unsafe-call): Unsafe call of a(n) `error` type typed value.
```

（探针文件已删除。）

#### (8) 分支与 git 状态复核（第 5 轮）

```
git branch --show-current          → impl-phase-3-layer-v-smoke-loop
git status --porcelain（摘）        → 仅工作区改动，无 commit/add；本轮未执行任何 git 写操作
```

---

## 8. 桩与债务

- **`@STUB` 自检：本 Phase 产物内零 `@STUB` 标签**（对脚本 / 驱动 / 源码 / 测试与三份 phase 产物 grep → 无命中；**第 4 轮**新增的 4 个模块 + 4 个 spec + `tests/tsconfig.json` 同样零标签）。
- **本轮未新增任何技术债**：7 条审查发现（3 🔴 + 5 🟡 中随本轮回流的部分）全部在本 Phase 内**修完或登记**；其中 🔴-3 是「忠实实现既有 AC」而非新债，🟡-6 / 🟡-7 属 verifier 与 HG-3 的处置，均不需要新条目。
- `DEBT-010` 保持「**已解决**」，验证方式含三条独立证据（§3）；本轮复跑该三条用例仍全绿。
- 其余活跃债务（`DEBT-004` / `DEBT-009` / `DEBT-011`–`DEBT-013`）均为用户已裁定「承接为债、本 Phase 不改」的条目，本 Phase **未**新增、**未**关闭。

### 8.1 第 4 轮的债务处置（`scope-amendment-02` §4.1/§4.2）

| 债 | 第 4 轮处置 | 是否迁入「已解决」 | 验证方式（落盘于注册表） |
|---|---|:--:|---|
| `DEBT-015` | 修（D19） | ✅ **迁入** | §7.7 (1)：`runStartedAtMsOf` 拒绝 `0`/非有限；同一残留 fixture 在 `0` 下 `offenderCount=0`、在真实 instant 下 `=1 / predates-run`；**逐字抽取的 shipped `assert_plan_run_start`** 对 `runStartedAtMs:0` → `HARNESS_ERROR` 4、对真实 instant → 通过 |
| `DEBT-014` | 修（D20） | ✅ **迁入** | §7.7 (2)：`build-artifacts-stale`（源码 touch 到构建之后）/ `build-entry-incomplete`（中断构建）/ `build-artifacts-absent` 三类**均退出码 1**，健康态 `ok:true` 退出码 0；消费侧 `fail_harness` 位于拉起 EDH **之前** |
| `DEBT-016` | 修（D21） | ✅ **迁入** | §7.7 (3)：模块层三个失败面各退出码 1（重复 / 双表头 / 缺失）；**逐字抽取的 shipped `record_evidence_violation`** 把 `PASS/0` → `HARNESS_ERROR/4`，`LINK_FAILURE/1` 保持不变 |
| `DEBT-017` | 修（D22） | ✅ **迁入** | §7.7 (4)：真实归档产物上 `reuse` 退化（`distinctMd5=1`，3840×1080）→ `retry`；`xvfb`（`distinctMd5=5`，1600×1000）→ `pass`；`distinctMd5=2` 的合规运行 → `pass`（**不得**重跑）；`displayEvidence` 记账含 `distinctMd5` / `mode` / `forced` / `attemptCount` |
| `DEBT-018` | **不修**（派单明示「不用碰」）→ 只做**验证性复核** | ❌ **留在活跃表** | 见 8.2 |
| `DEBT-019` | **不在本轮范围**（派单 §硬约束 2） | ❌ 不动 | 仓库级基线 2218 条 / 107 文件；本轮 **零**全仓口径测量 |

> ⚠️ **上表「是否迁入『已解决』」一列在 `DEBT-014` / `DEBT-017` 两行已被第 5 轮推翻 ⇒ 本表仅供追溯**：当时（第 4 轮）给出的可失败性证据只覆盖 **app 半区** / **模块层**，不足以支撑「已解决」。**有效现状以 §8.1a 为准。**

### 8.1a 第 5 轮的状态订正（**有效现状**）

| 债 | 第 4 轮的判定 | 第 5 轮的**实际状态** | 关闭条件 / 验证方式指针 |
|---|---|---|---|
| `DEBT-015` | ✅ 迁入 | ✅ **保持「已解决」**（判定未被推翻） | `implementation.md` §7.7 (1) |
| `DEBT-016` | ✅ 迁入 | ✅ **保持「已解决」**（判定未被推翻） | `implementation.md` §7.7 (3) |
| `DEBT-014` | ✅ 迁入 | 🔴 **迁回「活跃债务」**（证据只覆盖 app 半区）；本轮**已补全 workspace 半区**（D29 / §7.8 (3)） | registry 活跃表条目「关闭条件」(i)(ii)(iii)：由 `verifier` **独立构造**（非复述本 agent 证据）确认陈旧 / 未构建 sibling 各非 0、且比较集 = `tsdown.config.ts` 的 workspace 集 |
| `DEBT-017` | ✅ 迁入 | 🔴 **迁回「活跃债务」**（证据止步模块层）；本轮**已修消费侧 + 补 A5 回归**（D25/D26 / §7.8 (1)） | registry 活跃表条目「关闭条件」：`verifier` 独立复现 A5 的**双向**（缺陷在 ⇒ 红；修复在 ⇒ 绿）+ 确认四分支各至少一条可达路径 |
| `DEBT-018` | ❌ 留活跃（派单「不用碰」） | ✅ **迁入「已解决」**（用户裁定 `scope-amendment-02.md` §8.1 第 5 项；残余 `.cjs` 面已如实留痕于 registry 与 §8.4） | registry「已解决」表条文级指针（`.oxlintrc.json:341` / `run-gates.ts` 的 `bash -n` 门禁 / `spec.md:197` 修订段） |
| `DEBT-019` | ❌ 不动 | ❌ **不动**（不在本轮范围） | — |

> 订正依据：`verification.md`（round-4）+ `scheduler-findings-round4.md` + `scope-amendment-02.md` §8.1；落盘位置 `tech-debt-registry.md`（活跃表 8 条 = `004/009/011/012/013/014/017/019`）。

### 8.2 为什么 `DEBT-018` **不**迁入「已解决」

1. **本 agent 未实施该条**（派单明示「DEBT-018 已由我改完 spec 措辞，**你不用碰它**，也不要动 `.oxlintrc*.json`」），而 `scope-amendment-02` §4.1 的 `DEBT-018` 行与 §5 的 implementer bullet **仍指派本 agent 实施** —— 归属冲突已登记为 **D24 (B)**。按后发且更具体的派单执行，**未实施、只复核**。
2. **`spec.md` 的 R2 量程限定已由调度者写入并实测在案**（本 agent 复核：回归行含「**〔修订段 R2〕量程限定**」段，明文「该子项**只覆盖可 lint 资产（`.ts`/`.tsx`）**；`test-scripts/**` 下的 `.sh` / `.cjs` / `.json` **不在 oxlint 量程内** …… 改由 `DEBT-018` **另行跟踪**」）⇒ 该条**按自身定义仍存在**（其「另行跟踪」的 `.sh` 质量面并未关闭）。
3. **两半的现状（本 agent 复核，未改动）**：
   - **`.cjs` 半**：`.oxlintrc.json:341` 的 override 已就位，5 个 shipped `.cjs` 各 **0 error lines** ⇒ 可 lint 且干净（**但**「0 诊断」在 override 生效前曾是空条件，故此处给的是**当前实测值**而非推论）。
   - **`.sh` 半**：仓库已有 `scripts/check-test-scripts-syntax.sh`（`package.json:67` `check:test-scripts-syntax` → `scripts/run-gates.ts:312` 纳入 `check:ci:static`），本 agent 实跑 → `check-test-scripts-syntax: 3 shell asset(s) parse` / 退出码 **0**（**第 5 轮刷新为 4**：第 5 轮新增 `layer-v-support/display-evidence-shell.sh`，见 §6.2 **D25** / §7.8 (7)）。**但它是 `bash -n` 级解析门禁**（不覆盖 `shellcheck` 类语义问题）⇒ 与 `DEBT-018` 条目里「接入真实检查（`shellcheck`/`shfmt`）」的完整诉求**仍有差距**，**不足以**据以关闭该条。
4. 上述三处文件（`.oxlintrc.json` / `package.json` / `scripts/run-gates.ts`）**带工作区改动，但均非本轮所为**：本轮对 5 项任务的改动集见 §1.5，其中**不含**这三个文件；本 agent 只读它们做复核。

> ⚠️ **本节（§8.2）在第 5 轮已被用户裁定取代 ⇒ 仅供追溯**：用户（`scope-amendment-02.md` §8.1 第 5 项）裁定 `DEBT-018` **关闭**（`bash -n` 满足 §4.1 选项 (a)）并**不另立条目**，同时要求把 `.cjs` 残余在 registry **与**本文件内如实留痕。落地情况见下节。

### 8.2a 第 5 轮：`DEBT-018` 按用户裁定迁入「已解决」（落地记录）

- **迁移已执行**：`tech-debt-registry.md` 的「已解决」表内 `DEBT-018` 行给出**条文级验证方式指针**（override `.oxlintrc.json:341` + `scripts/run-gates.ts:293/312` 的 `bash -n` 门禁 + `spec.md:197` 的〔修订段 R2〕量程限定）。
- **残余如实留痕**（不因迁表而抹去；本轮一手复核）：
  - `.oxlintrc.staged.json`（**pre-commit profile**，第三条链路）**无任何 `overrides`**，`ignorePatterns` 只含 `**/*.js` / `**/*.mjs`（**不含** `**/*.cjs`）⇒ 提交 `.cjs` 时该 profile 仍产生不了任何诊断。
  - `bash -n` 是**解析级**检查（`command -v shellcheck` → 未安装；§5:124 明文排除）。
- **同一事实已追加到 `scope-amendment-02.md` §8.4**（§8.1 第 5 项要求「本文件与 registry 的『已解决』条目中如实留痕」）。
- `DEBT-018` 的两半本轮**只读复核、未改动**：5 个 shipped `.cjs` 各 **0 error lines**（§7.8 (7)）；override 在**执行路径上**（`lint = build:lib:host && tsx scripts/run-oxlint.ts .`，`run-oxlint.ts` 纯透传）。

---

## 9. 自检表（完成前自检）

| 检查 | 结果 |
|---|---|
| 空壳函数扫描（`(void)` / `return []` 型桩） | ✅ 无：`measure_terminal_side` / `assert_terminal_side_evidence` / `prepare_unqualified_node` / `runNodeEnvironmentConstruction` / `assertNodeCoverageSides` / `requireNodeExecutable` 均有真实副作用或硬断言 |
| 连通性：数据存 → 谁读 | ✅ `terminalSide` 由脚本写 → 驱动 `assertNodeCoverageSides` 读并落 `nodeCoverage` → 脚本 `corroborate` 二次读；`node-environment` 记录由 `HostDiagnosticRecorder` 写 → `dsh.test.getDiagnosticsText` 读 → 驱动断言 → `nodeEnvironmentConstruction` 落盘 → 脚本协证 |
| 连通性：我调用 → 是否桩 | ✅ `finishApproval` / `entry.abort` / `client.close` / `onStatusChange` / `getConfiguration().update` 均为既有产品实现 |
| 连通性：被谁调用 → 端到端一次 | ✅ 本轮真机 EDH 共 **8 次**完整运行（含 xvfb 分支、故障注入 ×2、缺凭据跳过 ×2、`cd /tmp` 对照、正向 ×2）；其中 **3 次跑在含本轮源码的 bundle 上**（§7.2 注） |
| 警告信号扫描（`TODO` / `will be wired` / `placeholder`） | ✅ 本 Phase 新增产物中无（唯一 `placeholder` 命中原为 index 占位行字符串，本轮已改为按表块锚定 + 占位行替换分支） |
| 测试质量：功能被禁用会红？ | ✅ 删除 `recordTransportDeath` → `layer-v-inject-disconnect.spec.ts` 变红；删 `terminalSide` → 脚本协证与驱动断言同时变红 |
| 测试质量：主路径断裂会红？ | ✅ `session-host.spec.ts:455/502` 覆盖字段来源与「只一条」；`corroborate` 的 `problems` 空才能 `PASS` |
| UI 完成定义（8 项） | N/A —— 本 Phase `ui: false` |
| Git 分支 | ✅ 全程 `impl-phase-3-layer-v-smoke-loop`；未 commit / 未 checkout / 未 stash / 未 add |
| **第 4 轮：可失败性证据（本轮核心验收点）** | ✅ **4/4 项均做到**「故意构造违反 → 判据**确实失败**；恢复 → 通过」，原始命令与输出见 **§7.7**。其中 **2 项**（`DEBT-015` 的启动前置断言、`DEBT-016` 的判决上转）由**逐字抽取的 shipped 函数**驱动，**不是**重写实现；另 2 项（`DEBT-014` / `DEBT-017`）直接驱动 shipped 模块并**复用磁盘上真实归档截图** |
| **第 4 轮：空壳函数扫描** | ✅ 无：`runStartedAtMsOf`（4 类非法输入各自拒绝）/ `staleProductState`（`predates-run` + `unreadable` 两类 offender）/ `evaluateBuildFreshness`（5 类失败面各有 `reason`）/ `measureFrames` / `judgeEvidence` / `planRowWrite` / `inspectRow` / `describeProblem` / `assert_plan_run_start` / `assert_build_freshness` / `assert_display_evidence` 均有真实分支且不同输入产生不同输出 |
| **第 4 轮：连通性（写 → 谁读）** | ✅ 四条新数据路径均闭合：① `RUN_STARTED_AT_MS` → 写 plan `:1289` → `assert_plan_run_start` 读回 `:1344` → 驱动 `runStartedAtMsOf` → 每步比对 → `throw`；② 产物新鲜度：模块读 `lib/**` 与 `src/**` mtime → 结论 → `fail_harness`；③ 索引：模块写 → **读回校验** → 非 0 → `record_evidence_violation` → `HARNESS_ERROR`；④ 截图：模块 `measure` → `judge` → `action` → 脚本 `retry` / `fail_display` **且** `displayEvidence` 落盘 |
| **第 4 轮：测试质量（本轮新增 4 个模块的测试）** | ✅ `pnpm exec vitest run` 9 个 Phase 测试文件 → **`Test Files 9 passed (9)` / `Tests 148 passed (148)`**（本轮新增 4 个 spec 计 60 例）；去掉 `predates-run` 分支 / 去掉 `build-entry-incomplete` 分支 / 放宽 `MIN_DISTINCT_MD5` 均会使对应用例变红 |
| **第 4 轮：lint 口径** | ✅ 只用显式路径口径 `npx tsx scripts/run-oxlint.ts <path>`；4 个目标文件各 **0**；**未**跑全仓 `oxlint .`（受 768 个既存孪生影响、跨树不可比）；`DEBT-019` 范围**零触碰** |
| **第 4 轮：Git 分支** | ✅ 同一分支 `impl-phase-3-layer-v-smoke-loop`；本轮**未**执行任何 git 写操作（无 `commit` / `add` / `checkout` / `switch` / `stash` / `reset` / `restore` / `clean`） |
| **第 5 轮：可失败性证据（本轮核心验收点）** | ✅ **7/7 项均做到**「故意构造违反 → 判据**确实失败**；恢复 → 通过」，原始命令与输出见 **§7.8**：任务 A 的**三处缺陷复现**（8 红）、🟡-1 的**退化守卫**（9 红）、🟡-2 的**归属契约**（1 红）、🟡-4 的**未构建 / 陈旧 sibling**（`ok:false` 两例）、🟡-3 的**真实归档前后对照**（1/16 改判）、任务 D 的**注释口径**（170/460 复现）、lint 门禁的**控制项**（故意违规 ⇒ 红） |
| **第 5 轮：任务 A 的四分支可达性与记账** | ✅ `pass` / `retry` / `skip` / `*` 在真实归档产物上**各至少一次命中**；`retry` ⇒ `DISPLAY_RETRY_REQUIRED=true`（⇒ R2.3 的 `xvfb` 重跑）；运行记录 `distinctMd5` / `action` / `reason` 由**恒 null** 变为**反映本次判决**（§7.8 (1) 表） |
| **第 5 轮：空壳函数扫描（本轮新增 / 改动的函数）** | ✅ 无：`homeSandboxOf`（7 类输入各自拒绝 + 1 类接受）/ `staleProductState`（`predates-run` + `unreadable` 两类 offender、空与非法类型两类 throw）/ `display_evidence_verdict`（模块无输出 ⇒ `return 1`，且 stdout 恒空）/ `assert_display_evidence`（三个前置 `fail_harness` + 四分支）/ `display_evidence_reason_text`（缺 reason 时**陈述缺失**而非留空）均有真实分支 |
| **第 5 轮：连通性（模块 verdict → shell 动作 → 报告）** | ✅ 闭合：`display-evidence.cjs judge`（stdout 两行）→ `display_evidence_verdict` 收进 `DISPLAY_EVIDENCE_*` 变量（stdout 空）→ `assert_display_evidence` 的 `case` →（`retry`）`DISPLAY_RETRY_REQUIRED=true` → `main` 的 `xvfb` 重跑 → `record_display_evidence_attempt` 落 `displayEvidence` 块 → `report-meta` / 索引 |
| **第 5 轮：测试质量（双向）** | ✅ 两处缺陷**均**由测试当场抓住：① 消费侧缺陷（stdout 污染 + 子 shell 赋值 + `case` 判局部变量）⇒ `display-evidence-shell.spec.ts` **8 红**，调用方改回 `$( … )` ⇒ 静态契约**单独红**；② 判据退化（`homeSandboxOf` 一律 `ok:true`）⇒ `sandbox-clean-state.spec.ts` **9 红**。两者恢复后分别 **11 绿 / 25 绿** |
| **第 5 轮：lint 口径** | ✅ 只用显式路径口径（`npx tsx scripts/run-oxlint.ts <path>`）：本 Phase 触及的 **10** 个可 lint 文件各 **exit 0 / error 0**；**未**跑全仓 `pnpm run lint`（见 §6.3 边界）；`DEBT-019` **零触碰**；控制项证明该门禁**不是恒绿**（§7.8 (7)） |
| **第 5 轮：Git 分支与工作区** | ✅ 同一分支；**未** commit / add / checkout / stash（§7.8 (8)）；scratch probe 与原始输出**全部**落在被忽略的 `.probe/` 下，交付物中**零**新增临时文件 |

---

## 10. 遗留问题与需 reviewer / 调度者关注的点

1. **🔴-3 的构造语义**值得复审关注：它是「受控的、故意失败的启动尝试」，与「宿主环境无合格 Node → `HARNESS_ERROR`」是两件事（§4 硬约束 ③ 已区分）。若 reviewer 认为构造位置（链路之前）应改为其他位置，请给出替代方案与理由。
2. **D12（`xvfb-run` 凭据透传）** 是本轮唯一涉及**运行环境**的新增分支；`SKIPPED_NO_DISPLAY` 分支（退出码 2）仍无运行证据 → 已交接 `verifier`。
3. **D15（AC-32 构造方式）** 更正了 round-1 的表述：构造「缺凭据」必须清空继承的凭据环境变量；仅切 cwd 无效。README 的跳过条件描述与之相符（未改动）。
4. **回归口径（🟡-7）**：全量套件 6 条失败为本机既有基线，需在 HG-3 由调度者**显式接纳**，不得默认视为通过。
5. **D8（`pnpm-lock.yaml`）** 与本 Phase 交付物无关，调度者已裁定不纳入提交（本 agent 未执行 git 操作）。
6. 本机默认 `node` 为 v20.16.0（不满足 `engines.node`）—— 真机链路必须按 README 前置 `PATH`（脚本已内置，手工跑 `pnpm` 时需自行处理）。**该事实本身正是 AC-11(a) 要写进产物的「终端侧动作」**。
7. **✅ 已闭合（第 4 轮）—— 曾记为「证据的构建新鲜度」**：冒烟脚本此前**只检查产物存在、不检查新旧**（原 `:2805-2812`），故「跑出 PASS」不等于「跑的是本轮源码」（round-2 真实发生过：`xvfb` 分支那次证据来自旧 bundle）。**第 4 轮已修**（§6.2 **D20** / `assert_build_freshness()` `:1144`）：陈旧 / 中断 / 缺失三类均判 `HARNESS_ERROR`，取证在拉起 EDH **之前**。可失败性证据见 §7.7 (2)。**该条不再是遗留项**；保留此行的历史判据（`lib/extension.js` 入口 chunk 内 grep 本轮新增符号 `requireNodeExecutable`）供 reviewer / verifier 手工复核 live 产物。

### 10.1 第 4 轮新增的遗留项（需 reviewer / 调度者关注）

8. **`DEBT-018` 归属冲突（产物级不一致，需调度者裁决）**：`scope-amendment-02` §4.1 / §5 指派本 agent 实施该条，而派单明示「不用碰」→ 本 agent 只复核未实施（§6.2 **D24 (B)** / §8.2）。**影响**：单独读 `scope-amendment-02.md` 的 reviewer 会预期本 agent 改过 `.oxlintrc.json` / `package.json` / `scripts/run-gates.ts` —— 这三个文件**确有**工作区改动但**非本轮所为**。另：`.sh` 半当前只有 `bash -n` 级解析门禁（实测 `3 shell asset(s) parse` / 退出码 0；**第 5 轮刷新为 4**），与条目里「`shellcheck`/`shfmt` 类真实检查」的诉求**仍有差距**，故该条**留在活跃表**。**（第 5 轮状态变更：本段的「留在活跃表」已被用户裁定取代 —— `scope-amendment-02.md` §8.1 第 5 项判定 `bash -n` **满足** §4.1 选项 (a) 并关闭该条，落地见 §8.2a 与 `tech-debt-registry.md`「已解决」表；`.cjs` 残余仍如实留痕，**不**视为已修。）**
9. **修前 lint 数字（54）不可由本 agent 独立重测**：工作区已是修后态，相关资产多为未入库文件（无 HEAD 基线），且实测 `oxlint --tsconfig=<其它 tsconfig>` 会**直接跳过**不属于该程序的文件（不产出诊断）⇒ 无法反推修前分布。**54 如实标注为引自 `verification.md` round-3**（§6.2 **D24 (D)**），机制改由 A/B 对照独立证明（§7.7 (5)：未被该 tsconfig 覆盖的同类 spec 仍报 **50** 条）。若 reviewer 要求「修前数字」有独立出处，需调度者提供 round-3 的原始 lint 输出。
10. **`tests/tsconfig.json` 的边界（不得被误读为「类型全对」）**：该 tsconfig 的职责是**建立类型程序**，使 `no-unsafe-*` 家族可解析；`npx tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit` 仍报 **170** 条**类型错误**。本轮清零范围**仅限 `no-unsafe-*`**，**未**声称（也**未**被要求）修完这 170 条（§6.2 **D23**）。
11. **索引自断言的一处健壮性观察（非缺陷、非失败证据）**：在 `artifact-index.md` **尾部**追加第二张表**不会**触发失败 —— 追加锚点始终落在**首个连续表格块**内，故 `headerRowsBeforeRow` 仍为 1（实测退出码 0）。即「末尾多一张表」不在本模块定义的违规面内；**真正**会失败的是「首个表格块内出现第二个表头」（实测 `the index renders as 2 run tables before the new row, not one` / 退出码 1）。§7.7 (3) 已如实标注该构造**不作为**失败证据。
12. **截图判据的成本模型（供 HG-3 汇报口径）**：本机 `reuse` 的常态是退化（归档 43 个运行中 `reuse` + 5 帧出现 `distinctMd5=1` **7** 次）⇒ 走 `reuse` 的**每一次真机运行都会**触发一次 `xvfb` 重跑（**2× 运行成本**）。这是**判据定义使然**（判据定义在「同一次运行的 5 帧」上），不是实现缺陷；若后续要降低成本，正确方向是**改判据**（例如把默认显示模式收敛到 `xvfb`），**不得**放松 `MIN_DISTINCT_MD5` —— 它与 `DEBT-017` 的修复目的直接冲突。
13. **`implementation.md` 的非归档处置需 reviewer 确认**：本轮按派单 §硬约束 5 **保留直接路径、未归档**（对「启动自清理协议」的**显式已披露偏离**），理由与边界见 §6.3。若 reviewer 判定该偏离不可接受，请给出替代方案（例如「归档旧版 + 新建一份仅含 D19–D24 的续页」），而不是默默接受。

### 10.2 第 5 轮新增的遗留项（需 reviewer / 调度者关注）

14. **🟡-2 的落地形态与派单字面不同（需调度者确认）**：派单要求的那一行 probes 条目**不可满足**（一手实测：该目录的 tsconfig 显式列举而探针文件必然 `Unmatched`，§7.8 (4)），故改用 `owned` 数组的等价契约。**目的达成、字面未采用** —— 若调度者坚持字面形态，需连同「探针须落在其 `include` 内」一并重设计（见 §6.2 **D28**）。
15. **`DEBT-014` / `DEBT-017` 的关闭权在 `verifier`，本 agent 不自证关闭**：本轮只做到「修复已在工作区 + 附可失败性证据」。两条的 registry「关闭条件」明文要求**独立构造**（不复述本 agent 证据）与 **A5 双向复现**。
16. **驱动侧 `homeSandbox` 守卫的证据形态（边界）**：`runAll` 未导出、只能在 EDH 内到达 ⇒ 该项证据是**逐字抽取的 shipped 守卫 + shipped 判据模块**（接受 / 拒绝表见 §7.8 (2)），**不是**一次 live EDH 运行。若 reviewer 要求 live 证据，需在有凭据的机器上重跑真机链路。
17. **R2.3 的 `xvfb` 重跑在 live 链路上仍未被观测**：本轮证明的是「`retry` ⇒ `DISPLAY_RETRY_REQUIRED=true` ⇒ `main` 会重跑」这条**离线契约**；真机（`reuse` 退化 → 自动重跑 → `xvfb` 通过）的端到端观测仍属 `verifier` / 有凭据机器。
18. **阈值 `2 → 3` 的成本模型变化（如实声明）**：`distinctMd5 = 2` 的 `reuse` 运行**现在也会**触发一次 `xvfb` 重跑（此前判 `pass`）⇒ 每次这样的运行多付 1 次尝试成本。这是**用户裁定**的直接后果，非实现选择（§7.8 (5) 给影响面：16 个可测归档中 1 个）。
19. **`pnpm run lint` 的全仓结论本轮未取得**：本轮刻意不触发 `build:lib:host`（以保住「既存孪生未被重写」这一可复核事实）⇒ 门禁的**全仓**口径仍以 `spec.md` 已修订的口径为准（该子项只覆盖可 lint 资产），本 Phase 触及文件的 **0 错**已逐文件证明（§7.8 (7)）。
20. **`tests/tsconfig.json` 的 170 条类型错误仍在**（第 4 轮 **D23** 的边界，本轮复测同值）：该 tsconfig 提供**程序**，不承诺类型全对；本轮**未**扩大这一口径。
21. **`.oxlintrc.staged.json` 的 `.cjs` 缺口仍在**（经用户裁定**不另立条目**）：已在 registry 与 `scope-amendment-02.md` §8.4 双向留痕，**不得**因 `DEBT-018` 关闭而视为已修。
