# Connectivity Review — Phase 3（`phase-3-layer-v-smoke-loop`）

## 视角

**Integration Connectivity** — 模块间是否真正连通。唯一问题：这些零件真的连上了吗？
本轮把「**写了脚本但没人调用**」「**判据存在但不在执行路径上**」「**断言只 note 不 fail**」当作默认怀疑对象，逐条以**实际运行**取证。

## 判决：SHOULD-FIX

- 6 条被指定追通的连通链：**5 条可达、1 条部分可达**（本体机制可达，但两处「标准」无触发点）。
- **无端到端断裂、无契约不一致、无被吞掉的 `throw`** ⇒ 无 🔴 Must-Fix。
- 两处真实但非致命的连通缺口 ⇒ 🟡 Should-Fix（见 §6）。

## 0. 启动自清理（已完成）

上一轮报告已归档（`mv`，非删除、未用 git）：

```
$ ls -1 .specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/.archive/ | grep -i connectivity
review-connectivity-20260917T062822Z.md        ← 上一轮（本轮启动时归档）
review-connectivity-round1-20260916T140231Z.md ← 更早一轮（既存）
$ ls .specdev/.../phase-3-layer-v-smoke-loop/review-connectivity.md
ls: cannot access ...: No such file or directory   ← 直接路径已清空，本报告为唯一新产物
```

未触碰其他 reviewer 产物、未碰 `current-status.json`、未执行任何 git 操作。

---

## 1. 连通链逐条追踪

### 链 1 — `scripts/check-test-scripts-syntax.sh` 是否真的被 CI 调用

**可达 ✅**

| # | 跳 | 位置 |
|---|---|---|
| 1 | npm script 声明 | `package.json:67` — `"check:test-scripts-syntax": "bash scripts/check-test-scripts-syntax.sh"` |
| 2 | gate 注册（含 DEBT-018 因果注释） | `scripts/run-gates.ts:309-312`（`:312` = `pnpmScript('test-scripts-syntax', 'check:test-scripts-syntax', { label: 'test-scripts shell syntax' })`，位于 `ciSharedStaticGates()` `:293-314`） |
| 3a | `ci-static` 展开 | `gatesForMode('ci-static')` `:236-237` → `ciStaticGates()` `:413-415` → `...ciSharedStaticGates()` |
| 3b | `ci-primary` / `ci-linux-primary` 展开 | `ciPrimaryGates()` `:316-318` → `...ciSharedStaticGates()` |
| 4 | 实际执行 | 见下方 ci-static 聚合原始输出 |
| 5 | 被调脚本 | `scripts/check-test-scripts-syntax.sh`（`bash -n` 实解析 + 资产清单钉死） |

原始证据（`ci-static` 聚合实跑）：

```
run-gates: start test-scripts shell syntax
run-gates: PASS test-scripts shell syntax (1.01s)
```

同一聚合中其它 gate 有 `FAILED`（仓库级基线），本 gate 仍**真的执行并 PASS** —— 即它不是靠「无人跑到」侥幸。

程序化核对该 gate 出现在哪些 mode（`/tmp` 脚本直接 import `gatesForMode`，非采信文档）：

```
ci-static: 45 gates; test-scripts-syntax present=true
ci-primary: 62 gates; test-scripts-syntax present=true
ci-linux-primary: 63 gates; test-scripts-syntax present=true
check-all: present=false        ← 独立核实：文档若声称「纳入 check-all」即为失实
ci-lint-contracts-ready: present=false
```

被调用者本体可运行：

```
$ bash scripts/check-test-scripts-syntax.sh
check-test-scripts-syntax: 3 shell asset(s) parse        (exit 0)
$ pnpm run check:test-scripts-syntax
$ bash scripts/check-test-scripts-syntax.sh
check-test-scripts-syntax: 3 shell asset(s) parse        (exit 0)
```

旁路核查（是否被并发 / 预算 / `skip` 吞掉）：

- 并发：gate 以 worker 池执行，但结果状态只有 `passed|failed|skipped`（`run-gates.ts:42`）；本 gate 在实跑中产出 `PASS`，不是 `skipped`。
- fail-fast：`const failFast = flagEnabled('DSH_GATE_FAIL_FAST')`（`:111`），**默认关闭**；启用时后续 gate 会被标 `skipped`（`:939-984`）。属 opt-in 且该情形整条 lane 本就非零退出，不构成对本 gate 的绕过（见 🟢-3）。
- 预算：未发现对本 gate 的预算裁剪（`coverageWorkerArgs` 一类只影响 coverage lane）。

**结论**：声明 → gate 注册 → 聚合展开 → 真实执行 → 被调脚本，四跳齐全，**可达**。

---

### 链 2 — `layer-v-support/` 三个新模块是否真的被调用、返回值是否被消费

**可达 ✅，无孤儿模块**

| 模块 | 定义 | 调用点 | 契约（CLI） | 返回值消费点 |
|---|---|---|---|---|
| `build-freshness.cjs` | `run-layer-v-smoke.sh:63` | `assert_build_freshness()` `:1144` 内 `:1146` | 模块 `:282-291`：`argv[2..]` = `<artifactRoot> <entry> <sourceRoot>...`，退出码 `0/1/2` | `:1147-1149` 空输出→`fail_harness`；`:1150-1163` 解析 JSON；`:1158` `ok===true` 才放行；`:1164-1166` 否则 `fail_harness`；`:1167-1171` 计数写日志 |
| `artifact-index.cjs` | `:64` | `append_index_row()` `:2923` 内 `:2932`（`append` 子命令） | 模块 `:172-187`：`append <indexPath> <row>`，退出码 `0/1/2`，成功时 stdout 打 rowLine | `:2934` 非 0 →`record_evidence_violation("artifact-index", …)`；`:2936` 空输出 → 同上；`record_evidence_violation` `:257-263` 在 `CONCLUSION=PASS` 时**单向上转** `HARNESS_ERROR`/4 |
| `display-evidence.cjs` | `:65` | `display_evidence_verdict()` `:2631` 内 `:2640`（`judge`）；`read_display_evidence_floor()` `:2706`（`require().MIN_DISTINCT_MD5`） | 模块 `:166-185`：`measure <dir>` / `judge <dir> <mode> <0\|1>`，第 1 行 action、第 2 行 JSON、stderr 原因、退出码 `0/2` | `:2641-2642` 拆行；`:2646-2650` 任一为空 → `return 1`（**fail-closed**）；`:2730-2733` `return 1` → `fail_harness`；`:2739-2757` `case` 消费 action（`pass`/`retry`/`skip`/`*`）；`:2745` `retry` → `DISPLAY_RETRY_REQUIRED` |

**孤儿判定**：三个模块各自被**主路径**调用（不是只在测试里被引用）：

- 入口排序：`main():3211-3213` 把三者列入必需输入（缺失 → `HARNESS_ERROR`/4 `preflight`），`:3230` 调 `assert_build_freshness`（注释明写「Before anything is created or launched」）、`:3233` 调 `read_display_evidence_floor`。
- `append_index_row` 的调用点：`:3040`（`finish`，证据落表时）。
- `assert_display_evidence` 的调用点：`:3140`（结论**之前**，AC-26(e)），`retry` 经 `:3141` 返回 → `main` 换 attempt + `:3200` 置 `DISPLAY_EVIDENCE_FORCED_XVFB="true"` → `resolve_display` `:632` 消费 → 第二次 attempt 强制 `xvfb`。**`retry` 不是「拿到结果就丢掉」**。

**契约一致性**（调用方与被调用方逐字对齐，非只看存在性）：

- `:1146` 传 3 个位置参数（无 verb） ↔ 模块 `:283` `[artifactRoot, entry, ...sourceRoots]`，且 `sourceRoots.length === 0` 时判 usage ✅
- `:2932` `append …` ↔ 模块 `:174` `mode !== 'append'` 判 usage ✅
- `:2640` `judge ${ARTIFACT_DIR} ${mode} ${forced_flag}`（flag 已由布尔翻译成 `0|1`，`:2635`） ↔ 模块 `:167` `[mode, directory, displayMode, forcedFlag]` + `:176` 只接受 `0|1` ✅

**结论**：三模块全部在调用链上，返回值（退出码 / stdout / JSON）均被真实消费，**可达**。

---

### 链 3 — `layer-v-driver/sandbox-clean-state.cjs` 是否真在链路上，`offenderCount > 0` 是否真会 `HARNESS_ERROR`

**可达 ✅（throw 不会被吞）**

| # | 跳 | 位置 |
|---|---|---|
| 1 | 模块引入 | `layer-v-driver/extension.cjs:43` — `const { runStartedAtMsOf, staleProductState } = require('./sandbox-clean-state.cjs')` |
| 2 | 链路**前**守卫 | `:2281` `const runStart = runStartedAtMsOf(plan)` → `:2282` `ok !== true` → `:2283-2287` `throw harnessError('sandbox-clean-state-check-unavailable', …)` |
| 3 | 每步复扫（`index >= 1`） | `:2300` `staleProductState(plan, runStart.value)` → `:2301` 落 `status.cleanStateChecks` → `:2302-2307` journal → `:2308-2310` `offenderCount > 0` → `throw harnessError('step-N-sandbox-product-state-not-clean', cleanliness)` |
| 4 | 异常语义 | `:112` `const harnessError = (reason, evidence) => new StageError('HARNESS_ERROR', { reason, evidence })` |
| 5 | 捕获是否吞掉 | `:2347-2352` `catch (error)` → `staged = error instanceof StageError ? error : harnessError(...)` → `status.conclusion = staged.conclusion`。**不做降级**：既不改成 `LINK_FAILURE`，也不只记 warning；非 `StageError` 的意外错误同样归为 `HARNESS_ERROR`（`:2350`，fail-closed） |
| 6 | 落到脚本退出码 | `run-layer-v-smoke.sh:3118` 读 `status.conclusion` → `:3145-3162` `case` 中无 `HARNESS_ERROR` 分支 → `:3160` `set_conclusion "HARNESS_ERROR" 4 …` → `exit_now` `:265-268` `exit 4` |

**是否退化成 `LINK_FAILURE`？** 否。第 5 跳显示 `status.conclusion` 原样取自 `StageError`，第 6 跳的 `case` 把**任何**未列出的结论都归到 `HARNESS_ERROR`/4（`:3159-3161`），映射路径单向且无中间降级分支。

**本轮可达性边界**：本机无 `code` CLI，**未**端到端跑通整轮 driver（该路径上的 `HARNESS_ERROR` 实测证据由 `implementation.md` §7.7 (1) 的模块层 + 逐字抽取层提供，属行为面）。本视角的可达性结论建立在**静态链路 + 模块 CLI 契约 + 退出码映射**三层证据上，并已明确此边界（见 §7）。

**结论**：模块在链路上、守卫在链路前与每步前、throw → catch → status → 脚本 case → exit 4 全链无吞咽，**可达**。

---

### 链 4 — 新增 4 个 spec 是否真的被测试运行器收集并执行

**可达 ✅（非静默跳过）**

| # | 证据 |
|---|---|
| 1 | 收集面由配置决定：`vitest.config.ts:113` `testIncludes = ['packages/*/*/tests/**/*.spec.{ts,tsx}', 'apps/*/tests/**/*.spec.{ts,tsx}', 'scripts/**/*.spec.ts']`，用于两个 project 的 `include`（`:155`、`:170`）⇒ `apps/vscode-dsh/tests/*.spec.ts` 在配置级被覆盖 |
| 2 | CI 语料：`scripts/run-gates.ts:610` `coverageGates()` → `vitest run --coverage`（全语料），`ciPrimaryGates()` 含 `coverageGates()` ⇒ 4 个 spec 在 CI 语料内 |
| 3 | 实际执行（原始输出） |

```
$ pnpm run test apps/vscode-dsh/tests/artifact-index.spec.ts apps/vscode-dsh/tests/build-freshness.spec.ts \
      apps/vscode-dsh/tests/display-evidence.spec.ts apps/vscode-dsh/tests/sandbox-clean-state.spec.ts
 RUN  v4.1.8 /workspace/chendecheng/code/need/deepseek/deepseek-harness
 Test Files  4 passed (4)
      Tests  49 passed (49)
   Duration  374ms
```

4 个文件全部出现在执行结果中（`Test Files 4 passed`），逐文件计数与 `implementation.md:88` 声明的 20 + 15 + 14 + 11 相符，**无一个被静默跳过**。

**结论**：命名 / 路径 / 配置三处均匹配，**可达**。

---

### 链 5 — `apps/vscode-dsh/tests/tsconfig.json` 是否真的被 lint 链路使用

**部分可达 ⚠️**（机制可达；「新文件必须零诊断」这条**标准**无触发点）

| # | 跳 | 位置 |
|---|---|---|
| 1 | 类型感知引擎 | `package.json:190-191`：`oxlint 1.76.0` + **`oxlint-tsgolint 7.0.2001`**（即调度侧所问的 tsgolint） |
| 2 | lint 入口 | `package.json:31-32`：`lint` = `build:lib:host && tsx scripts/run-oxlint.ts .`；`run-oxlint.ts:60-68` 是**透明 spawn 包装**（不传 `-c`），故 oxlint 按默认发现读取根 `.oxlintrc.json` |
| 3 | tsconfig 发现 | **无任何显式引用**：`run-oxlint.ts` 不出现 `tsconfig`/`tsgolint` 字样 ⇒ 完全依赖 tsgolint 的「就近 tsconfig」发现；`apps/vscode-dsh/tests/tsconfig.json` 是为此目的新增（其文件头注释 `:4-7` 自陈这一点） |
| 4 | include 名单 | `apps/vscode-dsh/tests/tsconfig.json:22-31` 显式列举 8 个 spec，含本 Phase 的 4 个（`:27-30`） |
| 5 | 实测生效 | 见下方对照 |

对照实测（同一命令、同一 config，仅换文件）：

```
INCLUDED  build-freshness.spec.ts            → {"files":1,"rules":110,"diags":0}   ← 纳入程序 ⇒ 0 条 no-unsafe-*
EXCLUDED  chat-ready-regression.spec.ts      → {"files":1,"rules":110,"diags":3}   ← 未纳入程序 ⇒ node:path / node:fs 退化为 error 类型
```

**反向验证（回答「0 诊断是否可能意味着未扫描」）**：用 `--deny no-magic-numbers` 作阳性对照，对 4 个目标 spec 逐个 lint，**全部产出该规则的诊断** ⇒ 这 4 个文件**确实被解析、被扫描**，「0 诊断」是「通过」而非「未扫描」。同时 `display-evidence.spec.ts` 能产出非类型感知的 `@stylistic` 诊断，亦证其被真实读取。

**「未 include 的文件会怎样」——实测与文档表述相反**：

- `implementation.md` 声称未纳入程序的文件会被**跳过**（不产出诊断）。
- 实测：未纳入程序的文件**照样产出诊断**（3 条 `no-unsafe-*`），其机制是「无程序 ⇒ Node 内建/`process` 解析为 error 类型 ⇒ 类型感知规则报警」。`apps/vscode-dsh/tests/tsconfig.json:4-7` 的注释对此描述才是准确的。
- 这属**文档失实**且方向是「实际更吵、而非更松」⇒ 未掩盖任何缺陷（见 🟢-1）。

**本链的连通缺口（🟡-2 的连通面）**：`tsconfig.json` 的存在、`include` 名单是否仍覆盖目标文件、以及「本 Phase 新增文件零诊断」这条标准，**没有任何 gate / 脚本 / 断言在检查**。它只在「某人记得手跑 `npx tsx scripts/run-oxlint.ts <file>`」时成立 —— 正是「判据存在但不在执行路径上」的形态。实证见 🟡-2。

---

### 链 6 — `review.md` 与本视角产物的下游连通

**可达 ✅**

| # | 跳 | 位置 |
|---|---|---|
| 1 | 本视角产物路径 | `.specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/review-connectivity.md`（= 本文件） |
| 2 | 调度者合并契约 | `.cursor/rules/spec-workflow.mdc`「并行四视角 Reviewer — Merge 规则」：4 份 `review-*.md` → 调度者合并写 `review.md`（含单一判决行） |
| 3 | 下游程序化消费者 | `.cursor/hooks/pipeline-gate.sh:377-380` 显式枚举 `review-correctness.md` / `review-design.md` / **`review-connectivity.md`** / `review-visual.md` 并清点各报告 Must-Fix 区的 🔴 条目 ⇒ 本文件是被 gate 读取的既有下游契约 |
| 4 | 合并后的 gate 契约 | `pipeline-gate.sh` 的 `parse_review_verdict` 读 `review.md` 判决行；本报告已在 §2 只写单值判决（**不写多值枚举**），不会让上游合并产生「无可解析判决」 |

**结论**：产物路径与合并 / 门禁契约一致，**可达**。本报告不含任何其它视角的判决或产物。

**本文件已对 gate 的解析器实测**（source 门禁自己的共享库，非我自写校验）：

```
$ bash -c 'source .cursor/hooks/lib/verdict-parse.sh; f=<本文件>; \
    parse_review_verdict "$f"; count_blocking_findings "$f"'
parse_review_verdict -> [SHOULD-FIX]     ← 单值可解析（不会触发「无可解析判决」deny）
count_blocking_findings -> [0]           ← Must-Fix 区无 🔴 证据项（不会触发「自陈与证据矛盾」deny）
```

---

## 2. 「断言是否落入执行路径」专表

| 判据 | 触发点 | 是否真会 fail |
|---|---|---|
| 构建产物新鲜度（DEBT-014） | `run-layer-v-smoke.sh:1146` → `:1148`/`:1165` `fail_harness` ← `:3230`（创建/拉起之前） | ✅ 会（`HARNESS_ERROR`/4） |
| 索引写入结构（DEBT-016） | `:2932` → `:2934`/`:2936` `record_evidence_violation`（`:257-263`，PASS 单向上转） ← `:3040` | ✅ 会（`HARNESS_ERROR`/4） |
| 帧证据力（AC-26(e)/AC-28 R2.3） | `:2640` → `:2646-2650` fail-closed；`:2739-2757` `skip`→`fail_display`/`*`→`fail_harness`；`retry`→`:2745`+`:3141` | ✅ 会（skip→`SKIPPED_NO_DISPLAY`/2；退化→`HARNESS_ERROR`/4） |
| 逐步骤沙箱洁净（DEBT-015） | `extension.cjs:2282`/`:2308` → `throw` → `:2347-2352` → `run-layer-v-smoke.sh:3160` | ✅ 会（`HARNESS_ERROR`/4，见链 3） |
| plan 的 `runStartedAtMs` 可读性 | `:1344` → `fail_harness` ← `:3086` | ✅ 会（`HARNESS_ERROR`/4） |
| `.sh` 语法（DEBT-018） | `check-test-scripts-syntax.sh` 非 0 → gate 失败 → 聚合非零（`run-gates.ts:117`） | ✅ 会（在 `ci-static`/`ci-primary`/`ci-linux-primary` 中实跑） |
| 4 个 spec 被收集执行 | `vitest.config.ts:113` | ✅ 会（实测 4 files / 49 tests） |
| **「本 Phase 新增测试文件 lint 零诊断」** | **无触发点**（只在人手跑命令时成立；见 🟡-2） | ❌ **不会 fail** |
| **`tests/tsconfig.json` 的 `include` 覆盖是否仍成立** | **无触发点**（仅被 tsgolint 隐式发现） | ❌ **不会 fail** |

---

## 3. 上下游连接检查

| 新增组件 | 上游（谁调用） | 状态 | 下游（调用谁） | 状态 |
|---|---|:--:|---|:--:|
| `check-test-scripts-syntax.sh` | `run-gates.ts:312`（← `:415`/`:318` ← `:237`/`:233`） | ✅ | `bash -n` + 3 个 shell 资产 | ✅ |
| `build-freshness.cjs` | `run-layer-v-smoke.sh:1146`（← `:3230`） | ✅ | `fail_harness`(`:1165`) / run 日志(`:1167`) | ✅ |
| `artifact-index.cjs` | `:2932`（← `:3040`） | ✅ | `record_evidence_violation`(`:2934`) | ✅ |
| `display-evidence.cjs` | `:2640` / `:2706`（← `:3140` / `:3233`） | ✅ | `case`(`:2739`) → `fail_display`/`fail_harness`；`retry`→`:3141`→`:3200` | ✅ |
| `sandbox-clean-state.cjs` | `extension.cjs:2281` / `:2300` | ✅ | `StageError`→`status.conclusion`→脚本 `:3160` | ✅ |
| `tests/tsconfig.json` | tsgolint 隐式发现（**无显式引用**） | ⚠️ | oxlint 类型感知规则 | ✅（实测生效） |
| 4 个新 spec | `vitest.config.ts:113` 的 include | ✅ | 断言 → 退出码 | ✅ |

## 4. 跨模块契约验证（逐字比对调用方 vs 被调用方）

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|---|---|---|:--:|
| shell → `build-freshness.cjs` | `node <m> <dir> <entry> <src...>`，看退出码是否非 0 | `:283-291` 同形；usage(2)/stale(1)/ok(0) | ✅ |
| shell → `artifact-index.cjs` | `append <index> <row>`，0=落表、非 0=问题 | `:174-186` 同形；成功打 rowLine | ✅ |
| shell → `display-evidence.cjs` | `judge <dir> <mode> 0\|1`，第 1 行 action、第 2 行 JSON | `:167-183` 同形；`forcedFlag` 非 `0\|1` 时 exit 2 | ✅ |
| shell → 模块读常量 | `require(m).MIN_DISTINCT_MD5`（`:2706`，**非** CLI 用法） | `:157` exports 含 `MIN_DISTINCT_MD5` | ✅ |
| `extension.cjs` → `sandbox-clean-state.cjs` | `runStartedAtMsOf(plan)::{ok,value}`、`staleProductState(plan, instant)::{offenderCount,…}` | 解构导入 `:43`，`cleanliness.offenderCount` 取自返回值 | ✅ |
| 脚本退出码契约 | `0/1/2/3/4` ↔ `PASS`/`LINK_FAILURE`/`SKIPPED_NO_DISPLAY`/`SKIPPED_NO_CREDENTIALS`/`HARNESS_ERROR` | `:3160` 未列结论一律归 `HARNESS_ERROR`/4（fail-closed） | ✅ |

## 5. 跨 Phase 依赖检查

| 本 Phase 依赖 | 来源 | 接口状态 | 连接状态 |
|---|---|---|---|
| `code --extensionDevelopmentPath` 拉起 EDH | 既有产品面 | 未改动 | ✅（本机无 `code` CLI ⇒ 本视角未端到端复跑） |
| `@deepseek-ai/dsh-*` 运行时解析 | `packages/*/lib`（`packages/ide/ide-bridge/package.json` `exports.default = ./lib/index.js`） | 已冻结 | ⚠️ 见 🟡-1：解析目标是 `lib/`，但新鲜度判据不覆盖它 |
| `apps/vscode-dsh/lib` | 本 Phase 的 DEBT-014 修复对象 | 已接判据 | ✅ |
| 4 个 spec 依赖的 `vitest` 项目配置 | 仓库既有 | 未改动 | ✅ |

---

## 6. 关键发现

### 🔴 Must-Fix

无。

### 🟡 Should-Fix

**🟡-1（连通性，本视角核心）`build-freshness` 判据不覆盖运行时真正加载的 workspace 产物另一半区**

- **链**：脚本设想的「先构建」顺序含 **workspace host 面**（`pnpm run build:lib:host`，`package.json:23` = `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`，其 tsdown `workspace` glob 明确含 `packages/*/*`，`tsdown.config.ts:19`）；而 `run-layer-v-smoke.sh:1146` 只把 `${APP_DIR}/lib` 与 `${APP_DIR}/src` 交给模块 ⇒ **`packages/*/lib` 与 `packages/*/src` 的新旧关系从未被比较**。
- **为何是真实缺口**：运行时确实从 `lib/` 加载 —— 构建产物 `apps/vscode-dsh/lib/extension-sQ-qhJSF.js` 中 `@deepseek-ai/dsh-*` 出现 **43 次**（外部依赖），而 `packages/ide/ide-bridge/package.json` 的 `exports` 指向 `./lib/index.js`。故「只重建 app、不重建 packages」仍可产出 `PASS`，即 DEBT-014 想消灭的「陈旧产物 ⇒ 假 PASS」在 workspace 半区**依然可达**。
- **加重情节（措辞层面）**：`:1165` 的失败提示把 `pnpm run build:lib:host` 列为补救动作，但该命令产出的是**判据永远不看的** `packages/*/lib` —— 提示与判据指示的产物不是同一批。
- **定级理由**：`DEBT-014` 的授权文本（`tech-debt-registry.md` 已解决表）明确是「比对 `lib/**` 与 `src/**`」，即**既定范围已按其字面完成**；本 Phase 的 AC 集合亦未要求覆盖 workspace 面。故这是**同类的相邻新缺口**（🟡 而非 🔴），建议按注册表 *Write on creation* 补登一条 DEBT，由后续 Phase 处置。

**🟡-2（连通性，因追链 5 而发现）「本 Phase 新增测试文件零 lint 诊断」这条标准没有触发点，且已被违反一次**

- **标准来源**：`implementation.md` 的 **D16**（`interaction-approval-resolution.spec.ts:30` 的 `@stylistic(arrow-parens)`）与 **D17**（`host-diagnostics.spec.ts:256` 的 `typescript(no-unnecessary-template-expression)`）确立的口径：`@stylistic` **不属于**仓库全局容忍家族（容忍家族是 `no-unsafe-*`），本 Phase 新增文件必须清零。两人为修复动作都以 `npx tsx scripts/run-oxlint.ts <file>` 求证。
- **触发点缺失**：该标准**没有任何 gate / 脚本 / 断言**在执行路径上（`package.json:31-32` 的 `lint` 是全仓扫描且基线本就非零，`:117` 的聚合判据只看整体退出码）。它只在「有人记得手跑」时成立。
- **实证（同命令、同 config）**：

```
$ npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests/display-evidence.spec.ts
apps/vscode-dsh/tests/display-evidence.spec.ts:40:57: error @stylistic(comma-dangle): Missing trailing comma.
exit=1
（同命令对 build-freshness / artifact-index / sandbox-clean-state 三个 spec：exit=0，无诊断）
```

- `display-evidence.spec.ts` 是本 Phase **新增**文件（`implementation.md:88` 新增清单）⇒ 该诊断**不是** `DEBT-019` 的既存基线（基线测于 base 树 `300f492f84`，当时该文件不存在）。相同家族在 `apps/vscode-dsh/tests/` 下另有 17 个文件、约 56 行，**那部分属 DEBT-019 基线，本轮不计入**。
- **定级理由**：`spec.md:197` 第三子项的文字范围是 `test-scripts/**` 与 hooks，**不含 `tests/**`** ⇒ 不构成 AC 级失败，故 🟡；而它确实被本 Phase 自身标准判为「新文件不该有的诊断」，且逃过了 4 个 reviewer 与本轮前的验证回合（同类 D16 曾被记为「四个 reviewer 均漏报」）。
- **边界声明**：此为追链 5 的**连带发现**，与实现正确性 / 设计一致性无关；若 `reviewer-correctness` 亦已记录同一文件，请在合并时**去重**（合并取最严即可，不受影响）。

### 🟢 Observations

- **🟢-1 `[文档保真]`**：`implementation.md` 关于「未被 `tests/tsconfig.json` include 的文件会**跳过**而非报错」的表述与实测相反 —— 实测未 include 的 `chat-ready-regression.spec.ts` **产出 3 条** `no-unsafe-*` 诊断；真实的机制是「无程序 ⇒ Node 内建解析为 error 类型 ⇒ 类型感知规则报警」，而这正是该文件 `apps/vscode-dsh/tests/tsconfig.json:4-7` 注释所述。**方向是「实际更吵、而非更松」**，未掩盖任何缺陷（机制本身经阳性对照证明有效），故不参与判决；仍建议就地订正文字。
- **🟢-2**：`display-evidence.cjs` 的 `measure` 子命令（`:172-175`）不在冒烟主路径上（`run-layer-v-smoke.sh` 只用 `judge` 与 `require().MIN_DISTINCT_MD5`），仅由该模块的 spec 覆盖。属有意暴露的 CLI 面，非孤儿模块，记为观察项。
- **🟢-3**：`ci-static` 的 fail-fast 是 **opt-in**（`run-gates.ts:111` `flagEnabled('DSH_GATE_FAIL_FAST')`，默认关闭）。若在 CI 中启用，排在首个 blocking 失败之后的 gate（含本 gate）会被标 `skipped`（`:939-984`）。这**不是**对本 gate 的绕过：该聚合本就以非零退出收场，且实跑（未启用 fail-fast）证明本 gate 会执行并报 `PASS`。仅提示「`skipped` 不等于 `passed`」这一读法。
- **🟢-4**：`review-connectivity.md` 的下游合并方 `review.md` 目前尚不存在（本轮 4 视角尚未合并），与本视角连通性无关，仅供调度者确认合并步骤待执行。

---

## 7. 本轮审查范围声明

1. **仅评集成连通性**：不评实现正确性（`reviewer-correctness`）、设计一致性（`reviewer-design`）、视觉一致性（`reviewer-visual`）。§6 的 🟡-2 是追链 5 的连带发现，已标注边界。
2. **不纳入 DEBT-019（仓库级 lint 基线）**：`apps/vscode-dsh/tests/` 下 17 个既存文件的约 56 行 `@stylistic`、以及 `ci-static` 聚合中其它既存失败 gate（`documentation standard tests` / `module graph`），均**不计入**本报告判决。
3. **未做任何写操作**（除本报告与 §0 的归档 `mv`）：未改代码 / 测试 / 脚本 / 配置 / spec 文档；未执行任何 git 命令；未改 `current-status.json`；未碰其他 reviewer 产物。
4. **可达性边界（未端到端跑通的链路）**：
   - **链 3** 的完整 driver 路径（`code --extensionDevelopmentPath`）——本机无 `code` CLI，**未**端到端复跑；到 `extension.cjs:2308 throw` 为止经静态链路 + 退出码映射取证，之后的行为证据引用 `implementation.md` §7.7。**未以静态阅读冒充运行证据**。
   - **链 5** 的「linter 内部如何发现 tsconfig」——未读 tsgolint 实现（不在本仓库）；结论由**对照实验**得出（include / 未 include 同一命令的差异 + `--deny` 阳性对照），机制解释以仓库内 `tests/tsconfig.json:4-7` 注释为据。
   - 其余各链均由**原始命令 + 原始输出**取证，见 §1 各节。
5. **数值口径**：本文所有条数均为本轮本树实测；`apps/vscode-dsh/tests/` 的 `@stylistic` 逐文件计数经 `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` 单次运行统计，未跨时点比较。
