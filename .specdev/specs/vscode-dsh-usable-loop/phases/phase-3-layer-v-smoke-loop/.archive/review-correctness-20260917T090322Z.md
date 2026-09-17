# Correctness Review — Phase 3（`phase-3-layer-v-smoke-loop`）

## 视角
**Implementation Correctness** — 代码是否正确工作。

审查对象 = 第 4 轮回流交付的 5 项（`DEBT-015` / `014` / `016` / `017`+R2 / `no-unsafe-*` 清零）+ **从未被任何视角审查过**的 `DEBT-018` 四项配置改动（`scope-amendment-02.md` §7 裁定纳入）。本 Phase `ui: false`。

分支：`impl-phase-3-layer-v-smoke-loop`（`git branch --show-current` 未执行 —— 本审查全程不做 git 操作，见 §10）。

## 判决：PASS

### 判决依据（一句话）
本轮四项自证缺口的「可失败性」**由我独立构造反例逐项实测成立**（不是复述 implementer 的证据）；`no-unsafe-*` 清零的机制经 A/B 对照证明是**补类型程序**而非关规则；新增 4 个 spec 共 **49** 个用例真实执行且断言非空；`DEBT-018` 四项改动正确、生效且被 CI 链路消费。未发现空壳函数、未注册桩、AC 未覆盖或消费侧断裂。全部偏差均为**报告文字层面**（`[文档保真]`，见 §8「🟢 Observations」），不涉及交付物。

---

## 1. 独立可失败性验证（本轮核心要求）

> 方法：全部 fixture 建在 `/tmp` 下；`shipped` 函数用 `sed -n '<a>,<b>p'` **按行区间逐字抽取**后驱动（唯一 stub 是 `fail_harness` / `set_conclusion` / `note` —— shipped 版本会 `exit_now` 去写报告）；仓库只被读。

### 1.1 `DEBT-015` — 逐步骤洁净判据：恒假 → 可失败 ✅

**(a) 判据本体（shipped 模块）**：同一份「1 小时前写入的沙箱会话文件」fixture，用修前值 `0` 与真实 instant 各跑一次。

```bash
$ mkdir -p /tmp/rev-corr-d15/.dsh/sessions
$ printf 'prior run\n' > /tmp/rev-corr-d15/.dsh/sessions/previous-run-session.json
$ touch -d '1 hour ago' /tmp/rev-corr-d15/.dsh/sessions/previous-run-session.json
$ node -e '
  const m = require(process.argv[1] + "/apps/vscode-dsh/test-scripts/layer-v-driver/sandbox-clean-state.cjs")
  const plan = { homeSandbox: process.argv[2] }
  const now = Date.now()
  console.log("runStartedAtMsOf({runStartedAtMs:0})    ->", JSON.stringify(m.runStartedAtMsOf({runStartedAtMs:0})))
  console.log("runStartedAtMsOf({runStartedAtMs:now})  ->", JSON.stringify(m.runStartedAtMsOf({runStartedAtMs:now})))
  console.log("runStartedAtMsOf(-1|null|\"x\"|undefined) ->", JSON.stringify([-1,null,"x",undefined].map(v=>m.runStartedAtMsOf({runStartedAtMs:v}).ok)))
  const a = m.staleProductState(plan, 0)
  const b = m.staleProductState(plan, now)
  console.log("staleProductState(plan, 0)              -> offenderCount=" + a.offenderCount + "  (the pre-fix value: inert)")
  console.log("staleProductState(plan, real instant)   -> offenderCount=" + b.offenderCount + "  first=" + JSON.stringify(b.offenders[0]))
' "$PWD" /tmp/rev-corr-d15
```

原始输出：

```
runStartedAtMsOf({runStartedAtMs:0})    -> {"ok":false,"value":0}
runStartedAtMsOf({runStartedAtMs:now})  -> {"ok":true,"value":1789627558465}
runStartedAtMsOf(-1|null|"x"|undefined) -> [false,false,false,false]
staleProductState(plan, 0)              -> offenderCount=0  (the pre-fix value: inert)
staleProductState(plan, real instant)   -> offenderCount=1  first={"path":"/tmp/rev-corr-d15/.dsh/sessions/previous-run-session.json","mtimeMs":1789623958450.5933,"runStartedAtMs":1789627558465,"reason":"predates-run"}
```

⇒ **同一 fixture 在修前值下惰性放行（`0`），在真实 instant 下检出（`1` / `predates-run`）** —— 修复成立。

**(b) 脚本层（shipped `assert_plan_run_start`，`run-layer-v-smoke.sh:1344-1365` 逐字抽取）**：

```
case=zero     plan={"runStartedAtMs":0}                    -> plan: runStartedAtMs is 0, not a positive epoch-ms instant — the per-step sandbox cleanliness predicate cannot fail without it (DEBT-015)
case=real     plan={"runStartedAtMs":1789627588642}        -> <no failure raised>
case=missing  plan={"schemaVersion":2}                     -> plan: runStartedAtMs is null, not a positive epoch-ms instant — the per-step sandbox cleanliness predicate cannot fail without it (DEBT-015)
```

**(c) 生产侧接线**：`extension.cjs:2281-2287`（链前，不可用即 `harnessError('sandbox-clean-state-check-unavailable')`）、`:2300-2310`（`index >= 1` 每步 `staleProductState`，`offenderCount > 0` → `throw harnessError('step-N-sandbox-product-state-not-clean')`）、脚本侧采样与写盘 `:179` → `:1289`、读回断言调用点 `:3086` —— 均实读源码确认存在且分支非空。

### 1.2 `DEBT-014` — 陈旧 / 不完整 / 缺失产物：不得 PASS ✅

`build-freshness.cjs` 的 CLI 契约为 `node build-freshness.cjs <artifactRoot> <entry> <sourceRoot...>`（`entry` 走 `fs.statSync(entry)`，须为**绝对路径**；脚本调用点传 `${APP_DIR}/lib/extension.js`，绝对路径 ✅）。

| # | fixture | 判据输出（原始） | exit |
|---|---|---|:--:|
| A | 产物 ≥ 源码 | `{"ok":true,"reason":null,…,"entryReferences":[{"specifier":"./chunk-a.js","path":"…/chunk-a.js","exists":true}]}` | **0** |
| B | 源码 touch 到构建之后 | `{"ok":false,"reason":"build-artifacts-stale","detail":"/tmp/rev-corr-d14b/src/index.ts is newer than every file under /tmp/rev-corr-d14b/artifact (source 2026-01-02T16:00:00.000Z > artifacts 2025-12-31T16:00:00.000Z)"}` | **1** |
| C | 中断构建（入口引用未写出的 chunk） | `{"ok":false,"reason":"build-entry-incomplete","detail":"…/extension.js imports ./chunk-never-written.js, which the artifact root does not contain"}` | **1** |
| D | 产物根不存在 | `{"ok":false,"reason":"build-artifacts-absent"}` | **1** |
| E | 源码根不可读 | `{"ok":false,"reason":"sources-unreadable","detail":"the source root(s) /tmp/rev-corr-d14b/absent-src could not be read, so freshness cannot be established"}` | **1** |
| E2 | 源码根为空 | `{"ok":false,"reason":"sources-unreadable","detail":"no source file was found under /tmp/rev-corr-d14b/empty-src, so freshness cannot be established"}` | **1** |
| F | 入口不存在 | `{"ok":false,"reason":"build-entry-absent"}` | **1** |
| G | usage（缺 source root） | `{"ok":false,"reason":"usage",…}` | **2** |

消费侧：`assert_build_freshness()`（`run-layer-v-smoke.sh:1144`）非 `ok` → `fail_harness "build-freshness"` → `HARNESS_ERROR`/4；调用点在 `main` 的 **`:3230`**，而拉起宿主的 `launch_host`（定义 `:1376`，调用 `:3098`）在 `prepare_attempt`→`run_attempt` 里、即 `:3248-3262` 的循环内 ⇒ **新鲜度检查确实早于任何 EDH 启动** ✅（`implementation.md` §7.7(2) 的「在拉起 EDH 之前」为真，非行序误读）。

### 1.3 `DEBT-016` — 索引自断言：只 `note` → 致命 ✅

**(a) 模块层**（`artifact-index.cjs append <index> <row>`，fixture = 真实 `artifact-index.md` 的副本）：

| 构造 | 原始输出 | exit |
|---|---|:--:|
| 正常追加 | `77`（落盘行号） | **0** |
| 同一行再追加一次 | `the appended row appears 2 times, not once` | **1** |
| 首个表格块内插入第二个表头行 | `the index renders as 2 run tables before the new row, not one` | **1** |
| 索引文件不存在 | `the index /tmp/rev-corr-review/d16/absent.md does not exist; no row was appended` | **1** |

**(b) 脚本层（shipped `record_evidence_violation`，`:257-263` 逐字抽取）**：

```
before: conclusion=PASS exit=0  [layer-v] note: artifact-index: the appended row appears 2 times, not once
[layer-v] evidence violation at artifact-index: the appended row appears 2 times, not once
after:  conclusion=HARNESS_ERROR exit=4 stage=artifact-index

before: conclusion=LINK_FAILURE exit=1  [layer-v] note: artifact-index: the appended row appears 2 times, not once
[layer-v] evidence violation at artifact-index: the appended row appears 2 times, not once
after:  conclusion=LINK_FAILURE exit=1 stage=step-3
```

⇒ **单向上转成立**：PASS 被证据违规否证；已到达的产品级结论（`LINK_FAILURE`）不被掩盖。消费侧 `append_index_row()`（`:2923`）在 `:2932-2939` 按退出码消费并把模块消息交给 `record_evidence_violation`；空行分支 `:2927` 同样上报；上转发生在报告落盘之前（`:3040` 调用 → `:3041-3045` `write_report_meta`/`write_summary`）✅。

### 1.4 `DEBT-017` / R2 — 截图有效性：判据取自真实归档产物 ✅

直接用磁盘上**真实归档运行**驱动 shipped 模块（`judge <artifactDir> <mode> <0|1>`）：

```
20260916T113508Z-1419033   pass      (reuse, distinct=5)
20260916T114328Z-1454058   pass      (reuse, distinct=5)
20260916T132614Z-1717645   retry     (reuse, distinct=1)
20260916T133527Z-1757528   retry     (reuse, distinct=1)
20260916T134100Z-1785560   retry     (reuse, distinct=1)
20260916T134751Z-1820608   retry     (reuse, distinct=1)
20260916T134922Z-1833088   retry     (reuse, distinct=1)
20260916T135716Z-1864170   retry     (reuse, distinct=1)
20260916T165417Z-2231593   retry     (reuse, distinct=1)
20260916T170431Z-2270421   pass      (reuse, distinct=2  ← 边界用例)
20260916T170525Z-2277459   retry     (reuse, distinct=1)
```

退化判据的原始 JSON（`…2277459`）：

```
{"ok":true,"frames":5,"md5":{"step-1-host-started.png":"c515d51f…","step-2-new-conversation.png":"c515d51f…","step-3-model-round-trip.png":"c515d51f…","step-4-approval.png":"c515d51f…","step-5-native-diff.png":"c515d51f…"},"distinctMd5":1,"degenerate":true,"action":"retry","reason":"the reused DISPLAY produced five identical frames (distinct md5 = 1/5); AC-26(e) requires interface evidence and AC-28 R2.3 requires the xvfb display instead"}
```

`distinctMd5=2` 的边界用例（`…2270421`，4 帧同 + 第 5 帧不同）→ `"action":"pass","reason":"AC-26(e) satisfied (distinct md5 = 2/5)"` ⇒ **不是按 `display.mode` 名字一刀切**，而是按当次实测 md5 数 ✅（`MIN_DISTINCT_MD5 = 2`，`display-evidence.cjs:33`）。

### 1.5 终止性与 fail-closed（R2.3 的边界）✅

`judgeEvidence` 的动作词表实测为 **4 值**（`pass` / `retry` / `skip` / `fail-closed`）：

| 输入 | action | 脚本侧去向 |
|---|---|---|
| `reuse` 退化，attempt 1（`forced=0`） | `retry` | `assert_display_evidence` → `DISPLAY_RETRY_REQUIRED=true` → `discard_attempt()` 置 `DISPLAY_EVIDENCE_FORCED_XVFB="true"` → 重跑 |
| `reuse` 退化且 `forced=1`（重试本身也退化） | `skip` | `fail_display` → **`SKIPPED_NO_DISPLAY` / exit 2** |
| `xvfb` 退化 | `skip` | 同上 |
| mode 不属于 `{reuse,xvfb}` | `fail-closed` | `fail_harness` → **HARNESS_ERROR / 4** |
| 帧数 ≠ 5（`measure.ok=false`） | `fail-closed` | 同上 |

⇒ **任何路径都不会以退化帧获得 PASS**；重试上限 1 次（`:3258-3260` 在 `DISPLAY_ATTEMPT >= 2` 时 `fail_harness`），无死循环。`spec.md:313`（R2.3）明文允许「`xvfb` 亦无法产出有效证据 → 按既有跳过语义 `SKIPPED_NO_DISPLAY`/退出码 2」，代码走的正是这一条 ✅。

### 1.6 消费侧接线复核（写 → 谁读）✅

| 数据 | 写 | 读 | 复核 |
|---|---|---|---|
| `RUN_STARTED_AT_MS` | `:179` 采样 → `:1289` 写 plan | `assert_plan_run_start` `:1344` + 驱动 `runStartedAtMsOf`（`extension.cjs:2281`） | 实测 case A/B/C 三种 plan ✅ |
| 产物新鲜度 | 模块读 `lib/**` / `src/**` mtime | `assert_build_freshness` `:1144` → `fail_harness`；调用在 `:3230`（早于宿主） | 7 类 fixture ✅ |
| 索引行 | 模块写 + 读回校验 | `append_index_row` `:2932-2939` → `record_evidence_violation` `:257` | 4 类 fixture + 单向上转 ✅ |
| 截图计数 | `display_evidence_record_json()` `:2678` | 落 `displayEvidence`（含 `distinctMd5`/`mode`/`forced`/`attemptCount`） | 模块动作表 + 归档实测 ✅ |

---

## 2. 逐条 AC 验证（本轮交付范围）

| AC | 描述（本轮相关部分） | 实现位置 | 判定 | 证据 |
|---|---|---|:--:|---|
| AC-26(e)（R2） | 同一运行内 5 帧 md5 不得全同，硬下限 ≥ 2，并把实测不同 md5 数记入产物 | `display-evidence.cjs:33/126-155`；`run-layer-v-smoke.sh:2631/2678/2723` | ✅ | 归档 11 个 reuse 运行 → 8 `retry` / 3 `pass`；`distinctMd5=2` 判 `pass`；`displayEvidence` 落 `distinctMd5` |
| AC-28(a)（R2 前件） | `reuse` 仅在能产出满足 (e) 的证据时可用，否则**必须**改走 `xvfb` | `assert_display_evidence:2744-2747` + `discard_attempt:3200` | ✅ | `retry` → 置 `forced=true` → 重跑；`mode === 'xvfb'` 由 `resolve_display` 重算 |
| AC-28(b) / R2.3 | 显示类不可用不得报 PASS、不得计为 `LINK_FAILURE`/`HARNESS_ERROR` | `fail_display:233-237` | ✅ | `skip` → `SKIPPED_NO_DISPLAY` / exit 2，与 `spec.md:313` 一致 |
| AC-33 | 每次运行一行、落在运行表内 | `artifact-index.cjs:41/81/116/154` + `:2923` | ✅ | 重复 / 双表头 / 缺失三面各 exit 1；正常 exit 0 且落行号 |
| `spec.md:197` 回归行（R2 量程限定） | lint 不因**新增** `test-scripts/**` 失败 | `.oxlintrc.json:330-379`、`scripts/check-test-scripts-syntax.sh` | ✅ | `oxlint apps/vscode-dsh/test-scripts` → 5 文件 / 110 规则 / **0** 诊断；`bash scripts/check-test-scripts-syntax.sh` → `3 shell asset(s) parse` / exit 0 |
| 回归（测试） | 全绿 / 不破坏既有 spec | — | ✅（本 Phase 面） | 9 个 Phase 文件 `9 passed / 148 passed`；chat-ready 9 文件 `9 passed / 91 passed`（均 Node 24） |

> 本 Phase 其余 AC（AC-11–AC-25、AC-27、AC-29–AC-32 等）已由 round-1–3 的审查/验证裁决在案，**不在本轮回流 delta 内**，本次未逐条重推。

---

## 3. 桩代码检测

### 已注册桩（对照 registry）
| Registry ID | 主题 | 状态 | 说明 |
|---|---|---|---|
| `DEBT-004`/`009`/`011`/`012`/`013` | 见 registry | ⚠️ Known | 用户已裁定「承接为债、本 Phase 不改」 |
| `DEBT-018` | lint/syntax 覆盖面对 `test-scripts/**` | ⚠️ Known（**活跃**） | 本条**留在活跃表是对的**：`.sh` 半只有 `bash -n` 级解析，未达条目诉求（`shellcheck`/`shfmt`）—— `implementation.md` §8.2 的「不足以关闭该条」自陈成立，我复核其证据（见 §6） |
| `DEBT-019` | 仓库级 lint 基线（2218 条 / 107 文件） | ⚠️ Known | 用户已排除，**不在本次审查范围** |
| `DEBT-014`/`015`/`016`/`017` | — | ✅ Resolved | 已迁入「已解决」；本轮**独立复验其可失败性成立**（§1） |

### 新发现的未注册桩 / 空壳
**无。** 对交付文件 `rg "@STUB"`（4 个新模块 + `sandbox-clean-state.cjs` + 冒烟脚本 + 4 个新 spec）→ `none`。被点名的函数逐个读过函数体：`runStartedAtMsOf`（4 类非法输入各自拒绝）、`staleProductState`（`predates-run`/`unreadable` 两类 offender）、`evaluateBuildFreshness`（7 类失败面各带 `reason`）、`measureFrames`/`judgeEvidence`（4 值动作表）、`planRowWrite`/`inspectRow`/`applyRowWrite`/`describeProblem`（三面 exit 1）、`assert_plan_run_start`/`assert_build_freshness`/`assert_display_evidence` —— 均为真实分支，无 `(void)` / `return []` / 硬编码 `true` 型空壳。

---

## 4. `no-unsafe-*` 清零复核（54 条）

**(a) 4 个目标文件确为 0**（显式路径口径，`--format=json` 的键是 `code`）：

```bash
$ npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests/<file>.spec.ts --format=json
host-diagnostics.spec.ts            total=0 no-unsafe=0
node-env-guard.spec.ts              total=0 no-unsafe=0
session-host.spec.ts                total=0 no-unsafe=0
layer-v-inject-disconnect.spec.ts   total=0 no-unsafe=0
```

**(b) A/B 对照 —— 规则**仍在**对未被该 tsconfig 覆盖的同类 spec 生效**：

```
phase2-change-list-display.spec.ts  total=75 no-unsafe=50     ← 与 §7.7(5) 声称的 50 逐字相同
phase2-auto-ready.spec.ts           total=15 no-unsafe=2      ← 我另加的第二组对照
```

原始行（未覆盖文件仍报诊断）：

```
apps/vscode-dsh/tests/phase2-change-list-display.spec.ts:649:11: error typescript(no-unsafe-assignment): Unsafe assignment of an error typed value.
apps/vscode-dsh/tests/phase2-change-list-display.spec.ts:649:22: error typescript(no-unsafe-call): Unsafe call of a(n) `error` type typed value.
```

**(c) tsconfig 的性质判断：是「补类型程序」，不是「把诊断关掉」** ✅

`apps/vscode-dsh/tests/tsconfig.json` 实读：`extends ../../../tsconfig.base.json` + `composite/declaration/declarationMap/incremental=false` + `noEmit:true` + `rewriteRelativeImportExtensions:false` + `include` **显式列举 8 个文件**。

- 未新增任何规则级放宽：文件内**没有** `strict:false` / `noImplicitAny:false` / `skipLibCheck` 覆写；`skipLibCheck:true` 与 `strict:true` 均来自 `tsconfig.base.json`（`skipLibCheck` 见 `tsconfig.base.json:14`，是全仓既有设置，非本次引入）。
- `include` 只含 8 个文件，**不会**让别的诊断静默消失；A/B 对照已证未覆盖文件照报（50 / 2）。
- 无任何配置引用它（`rg "tests/tsconfig"` → 仅自身）⇒ 它不改变任何既有 `tsc -b` 项目的成员集。
- 逃生舱检查：4 个目标文件 `grep -E "eslint-disable|oxlint-disable|: any\b|as any\b"` → `none found`。

---

## 5. 新增测试复核

- **被收集且真实执行**：`vitest run` 9 个 Phase 文件 → `Test Files 9 passed (9)` / `Tests 148 passed (148)`；其中 4 个新 spec 贡献 **49** 例（15/9/11/14）。4 个文件单独跑同样全绿（`Test Files 4 passed (4)` / `49 passed`）。
- **断言非空**：`expect(` 计数 = `sandbox-clean-state` 15 / `build-freshness` 23 / `artifact-index` 29 / `display-evidence` 33（合计 100 处），无 `expect(true)` 型占位。
- **断言有区分力**：本轮我另用 CLI 级 fixture 独立打穿了三类失败面（§1.2/1.3/1.4）；此外本轮早段对 4 个模块做过变异（改 `MIN_DISTINCT_MD5`、反转 `staleProductState` 的分支条件、去掉 `build-entry-incomplete` 分支、关掉索引结构校验）→ 对应用例变红。变异测试作为方法论记录在此，不改变上面基于 shipped 代码的结论。

---

## 6. `DEBT-018` 四项改动复核（非本轮所为，首次被审）

| 改动 | 复核结论 | 证据 |
|---|---|---|
| `.oxlintrc.json` +override（`apps/vscode-dsh/test-scripts/**/*.cjs`） | ✅ 正确、生效 | 规则实数为 **23 条**（逐条点数与注释声称一致）；`no-unsafe-finally` 确实被排除，且理由**可验证为真**：`extension.cjs:1976` 的 `finally` 在 `:1983` **故意** `throw harnessError('node-construction-setting-not-restored')`，注释对该行为的解释与代码一致 |
| 该 override 是否「load-bearing」 | ✅ 是 | 提交态配置下 `oxlint apps/vscode-dsh/test-scripts --format=json` → `number_of_files: 5`（5 个 shipped `.cjs` 均被纳入）、`number_of_rules: 110`、`diagnostics: 0`；5 个 shipped `.cjs` 各 `error-lines=0`；本轮早段用敌对 `.cjs`（`debugger` / 常量条件 / 重复键 / 自比较）在「有 override」时报错、「删掉该 override 的同一配置」下 0 报错 ⇒ 该 override 是这 5 个文件可被 lint 的唯一原因（注：我在 `/tmp` 复刻该 A/B 时因插件解析与 JSONC 注释未成功，上述结论取自本轮早段在仓库路径下的对照组实验） |
| `package.json` +`check:test-scripts-syntax` | ✅ 正确 | `package.json:67` = `"check:test-scripts-syntax": "bash scripts/check-test-scripts-syntax.sh"` |
| `scripts/run-gates.ts` 并入 `ciSharedStaticGates()` | ✅ 正确 | `scripts/run-gates.ts:312` = `pnpmScript('test-scripts-syntax', 'check:test-scripts-syntax', { label: 'test-scripts shell syntax' })` |
| 新增 `scripts/check-test-scripts-syntax.sh` | ✅ 正确且可失败 | `bash scripts/check-test-scripts-syntax.sh` → `check-test-scripts-syntax: 3 shell asset(s) parse` / exit **0**；构造「新 `.sh` 含语法错误」→ 报错并 exit 1；构造「pinned 资产被改名」→ 报缺并 exit 1（**不空跑**） |

---

## 7. `implementation.md` 数字与结论对照实测

| 位置 | 自述 | 实测 | 判定 |
|---|---|---|---|
| §7.4 本 Phase 5 个测试文件 | `5 passed / 99 passed`，exit 0 | ✅ **逐字成立**（**前提：Node 24.3.0**；本机默认 Node 20 下同一命令为 `3 failed \| 2 passed (5)` / `17 failed \| 82 passed (99)`） | 见 §8 Observations ① |
| §7.4 chat-ready 9 文件 | `9 passed / 91 passed` | ✅ `Test Files 9 passed (9)` / `Tests 91 passed (91)` | 一致 |
| §7.4 全量套件 6 条失败 = 4 个文件 | spike-t0a 4 / spike-t0b 0（加载错误）/ panel-close-delete 1 / layer-a-rtl 1 | ✅ 这 4 个文件合跑 = `Test Files 4 failed (4)` / `Tests 6 failed \| 9 passed (15)` | 一致（**全量 53 文件未重跑**，见 §9） |
| §7.5 lint（`test-scripts`） | exit 0；`number_of_files: 1`、`number_of_rules: 90`、`diagnostics: 0`；「唯一可 lint 的 JS 是 `extension.cjs`」 | ⚠️ exit 0 ✅ / diagnostics 0 ✅；但实测 `number_of_files: 5`、`number_of_rules: 110`（当前状态**强于**自述） | `[文档保真]` |
| §7.7(4) 归档分布 | 「归档 **43** 个真实运行」；`reuse+5帧`: `distinct=1` **7** 次 / `=2` 1 次 / `=5` 2 次；`xvfb+5帧` 4 次全 `=5` | ⚠️ 归档目录实为 **47** 个；含 5 帧的 16 个：`reuse` `=1` **8** 次 / `=2` 1 次 / `=5` 2 次、`xvfb` `=5` 4 次、另有 1 个 meta 不可解析 `distinct=1`。**子结论（reuse 退化、xvfb 健康、存在 `=2` 合规边界）逐项成立** | `[文档保真]` |
| §7.7(5) A/B | 未覆盖 spec `no-unsafe=50` | ✅ 50（`phase2-change-list-display.spec.ts`） | 一致 |
| §7.7(5) 修前 54 条 = +6/+6/+15/+27 | — | ✅ 可在 `verification.md`(round-3) 第 103–107 行**逐条溯源** | 一致 |
| §9「本轮新增 4 个 spec 计 **60** 例」；§1.5「20 + 15 + 14 + 11 例」 | 60 | ⚠️ 实测 **49**（vitest）；原始 `it(`/`test(` 声明数为 42（8/9/11/14，部分用例由循环生成） | `[文档保真]` |
| §1.5 line 86 函数名 `appendIndexRow()` / `judgeIndexWrite()` | — | ⚠️ 实际导出为 `planRowWrite` / `inspectRow` / `applyRowWrite` / `describeProblem`（`artifact-index.cjs:165`） | `[文档保真]` |
| §1.5 line 87 动作表「`pass` / `retry` / `fail`」 | — | ⚠️ 实际 4 值：`pass` / `retry` / `skip` / `fail-closed` | `[文档保真]` |
| §8.2 `.oxlintrc.json:341` / `package.json:67` / `run-gates.ts:312` | — | ✅ 三处行号**逐字命中**（`:341` 为该 override 的 `files` 条目）；`spec.md:197` 的 R2 量程限定原文亦确认存在 | 一致 |

---

## 8. 关键发现

### 🔴 Must-Fix
**无。**

### 🟡 Should-Fix
**无。**

### 🟢 Observations

**① `[文档保真]` §7.4 第一个命令行/行未标注 Node 24 前置条件**
`implementation.md:284` 的命令与 `:293` 的结果行未声明 `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`（该前置只写在同一块的第三个命令行 `:288` 与 §10.6）。以本机默认 Node v20.16.0 直接跑同一命令：

```
$ npx vitest run apps/vscode-dsh/tests/{interaction-approval-resolution,layer-v-inject-disconnect,host-diagnostics,session-host,node-env-guard}.spec.ts
 Test Files  3 failed | 2 passed (5)
      Tests  17 failed | 82 passed (99)
$ export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH; <同一命令>
 Test Files  5 passed (5)
      Tests  99 passed (99)
```

底层主张为真（`99/99` 在仓库 `engines.node` 下成立，17 条失败是仓库自己的 node 资格门在拒绝不合格解释器 —— 正是 AC-11(a) 要的行为），**非掩盖**：我另行独立确认 148/148 与该 4 个基线失败文件。建议在结果行内联该前置。

**② `[文档保真]` §7.5 / §7.7(4) / §1.5 / §9 的计数与命名已过期或不准**（明细见 §7 表）。所有被描述的**事实**均独立成立且在多数处**强于**自述（如 `.cjs` 实际 5 文件 110 规则 0 诊断），不掩盖任何缺陷。

**③ `artifact-index` 的结构校验存在一条**已自陈**的覆盖边界**（非缺陷）
「索引尾部另有一张无关表格」不会判违规 —— 我复现：追加 exit **0**，新行落在**首个**表块末尾且全文件仅出现 1 次（位置正确）。
`implementation.md:425` 已如实记为「健壮性观察，非失败证据」。结论：写路径没有写歪，仅文档语义上允许尾部并存第二张表；**不构成本 Phase 的失败面**。

**④ `build-freshness` 对**裸副作用导入**的 chunk 缺失不判「构建不完整」**（有界，且不产生假 PASS）
入口写成 `import "./chunk-missing.js"`（无绑定）时：

```
{"ok":true,"reason":null,"entryReferences":[]}   exit=0
```

即 `build-entry-incomplete` **不**触发（有绑定/`require` 的形式会触发，见 §1.2 C）。影响有界：真实产物 `apps/vscode-dsh/lib/extension.js:1` 是**具名导入**（`import { … } from "./extension-sQ-qhJSF.js"`），故 tsdown 输出不会落入该形态；即便落入，宿主加载失败 → 无 status 文件 → `HARNESS_ERROR`（`run-layer-v-smoke.sh:3102-3113`），**仍不会出现假 PASS**，代价只是从「预检拒绝」退化为「启动后拒绝」。建议未来在该模块注释中显式写出这条边界（它现在只写了「imports」）。

**⑤ `build-freshness` 的默认值是 CWD 相对，且与 docstring 措辞不一致**（fail-closed，无害）
`DEFAULT_ENTRY='lib/extension.js'` / `DEFAULT_ARTIFACT_ROOT='lib'` 为相对路径，而 `fs.statSync(entry)` 按 **CWD** 解析；docstring 说「defaulted to the host app's own layout」。`evaluateBuildFreshness({})` 在仓库根调用会得 `build-entry-absent`（**拒绝**，不是放行）。CLI 与冒烟脚本均传绝对路径，`apps/vscode-dsh/tests/build-freshness.spec.ts` 亦传显式树 ⇒ 无实际影响。

**⑥ `[文档保真]` 「零新增类型断言消警告」这一条我无法证实（也未证伪）**
可证实的部分：4 文件 0 诊断、无 `eslint-disable`/`oxlint-disable`/`: any`/`as any`、A/B 对照证明**规则仍在生效**（这是「补类型 vs 关规则」这个问题的决定性证据）。无法证实的部分：`host-diagnostics.spec.ts` 现存 5 处 `as unknown as`（`:134` / `:168` / `:190` / `:227` / `:1146`），`node-env-guard.spec.ts` 另有多处类型断言 —— 它们**是否为本轮新增**需要 diff 才能判定，而本审查不做 git 操作（§10）。若需确定性，建议调度者跑一条只读命令比对（`git diff <base> -- apps/vscode-dsh/tests/host-diagnostics.spec.ts`）。**当前证据不支持**把这些断言认定为「消警告」：A/B 已把机制归因到类型程序上。

**⑦ `assert_display_evidence` 对「非 PASS 结论」只记录不改判**（设计如此，记以示明）
`run-layer-v-smoke.sh:2735-2737`：驱动已判 `LINK_FAILURE`/`SKIPPED_*` 时，截图测量照记入 `displayEvidence`，结论不变 —— 与 `record_evidence_violation` 的单向规则一致、且这是 spec R2.3 的精神（不得让证据门掩盖产品发现）；不构成缺陷，仅记录该语义边界。

---

## 9. 我未能独立验证的事项

1. **全量 `apps/vscode-dsh` 套件（§7.4 第三行：`4 failed | 49 passed (53)` / `6 failed | 418 passed | 1 skipped (425)`）未重跑。** 替代证据：我直接跑了 §7.4 声称的**那 4 个基线失败文件** → `4 failed (4)` / `6 failed | 9 passed (15)`，逐项吻合。因此「除了这 6 条之外没有别的失败」这一**完整性**我没有逐项验证（成本考量；该行是既存基线声明，前一轮已由 base 对照树裁定）。
2. **`as unknown as` 的「新增性」**（§8 Observations ⑥）：不做 git diff 无法判定。
3. **`.oxlintrc.staged.json` 的存在性/内容**（§7.5 的「非空跑证明」所用配置）不在仓库中，该条具体命令未复跑；我用 A/B 对照与 `number_of_files: 5` / `number_of_rules: 110` 独立替代。我在 `/tmp` 复刻「删掉 override 的同配置」时失败（插件解析 + JSONC 注释），该副作用是本方法的限制，与改动本身无关。
4. **§7.2 真机链路结论**（8 次 EDH 运行、`display.mode`、`node.extensionSubprocessSide` 等）：需要 `DEEPSEEK_API_KEY` 与显示环境，本轮**未重跑**（§7.7 开头亦声明本轮未重跑）—— 属 `verifier` 的职责面。
5. **`spec.md` R1 段（`DEBT-010`：`phase` 第三成员 + `schemaVersion` 恒 2）的运行时证据**：本轮 delta 未触碰该段实现（`extension.cjs` 的改动集中在 `:2281-2310`），其真机字段级证据由 round-1–3 与 verifier 承载；我复核的是「本轮改动未破坏该段」（`layer-v-inject-disconnect.spec.ts` 2 条 R1.3 用例在 Node 24 下通过）。

---

## 10. 本轮审查范围声明

**跑过的命令（择要）**：`vitest run`（4 新 spec / 9 个 Phase 文件 / chat-ready 9 文件 / 4 个基线失败文件，Node 20 与 Node 24 两个口径）；`npx tsx scripts/run-oxlint.ts <path> --format=json`（4 个目标 spec + 2 个对照 spec + `test-scripts` 目录 + 5 个 shipped `.cjs`）；`oxlint --config` 对照实验；`bash scripts/check-test-scripts-syntax.sh`；`node build-freshness.cjs`（7 类 fixture）；`node display-evidence.cjs judge`（11 个真实归档目录 + 4 类人造形态）；`node artifact-index.cjs append`（4 类 fixture，含尾部第二张表）；`node sandbox-clean-state.cjs`（`runStartedAtMsOf` / `staleProductState`）；`sed -n` 逐字抽取 shipped 函数后驱动（`assert_plan_run_start` / `record_evidence_violation`）；`node --check` 全部 5 个 `.cjs`；`rg`/`grep` 若干。

**未跑**：全量 app 套件（§9-1）；真机链路（§9-4）；`pnpm run lint` / 全仓 oxlint（`DEBT-019` 用户已明确排除，**零触碰**）；`oxlint .` 全仓口径。

**遵守的边界**：未修改任何代码 / 测试 / 脚本 / 配置 / spec 文档；未写 `current-status.json`；**未执行任何 git 操作**（不 commit / add / checkout / switch / stash / reset / restore / clean）；全部 fixture 建在 `/tmp` 下；旧报告已按「启动自清理协议」`mv` 至 `.archive/`（未删除任何文件）。
