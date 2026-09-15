# 实现正确性审查 — Phase 1（第 2 轮，回炉第 1 轮）

## 视角

**实现正确性（Implementation Correctness）** —— 代码是否真的能工作？函数体真实逻辑、真实子进程行为、
验收标准映射、边界与错误路径、副作用正确性。设计一致性（`reviewer-design`）与集成连通性
（`reviewer-connectivity`）不在本报告范围内。

## 判决

**SHOULD-FIX** —— 上一轮的 3 条阻塞项（**M1**、**M2**）与全部 10 条 should-fix（**S1–S10**）经本轮
亲自阅读变更后的函数体、文档原文与测试代码，并重跑全部验收命令，**全部 CONFIRMED-FIXED**。没有
任何 AC 未满足，没有未登记桩，也没有复现任何功能回归：4 个红文件 / 6 个失败用例与 v8 基线集合
完全一致，两条绿色基线（`typecheck`、`packages/sdk/client`）保持 exit 0。

唯一一条**新发现**（**N1**）不使任何 AC 失败，但让 AC-1(b) 的证据强度低于其 spec 自定的验证策略，
因此判决为 SHOULD-FIX 而非 PASS。

启动自清理第 0 步：直接的 Phase 目录下存在上一轮的 `review-correctness.md` 与
`review-correctness-zh.md`，本 agent 在写入任何新内容前已自行归档：

```
$ mv $PHASE_DIR/review-correctness.md    $PHASE_DIR/.archive/review-correctness-20260915T103350Z.md
$ mv $PHASE_DIR/review-correctness-zh.md $PHASE_DIR/.archive/review-correctness-zh-20260915T103350Z.md
```

只动了这两个文件；未运行任何 `git` 命令，未修改 `current-status.json`。

## 独立复现结果

先确认分支：`git branch --show-current` → `impl-phase-1-node-env-preflight`。
所有命令在 `/workspace/chendecheng/code/need/deepseek/deepseek-harness` 下执行，前置
`export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` 与
`PNPM="pnpm --config.verify-deps-before-run=false"`。

**（1）聚焦用例集 —— 与声称完全吻合。**

```
$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts
→ Test Files  4 passed (4)
→      Tests  69 passed (69)          exit 0          [声称 69 ✓]

$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts
→ Test Files  2 passed (2)   Tests 34 passed (34)     [27 + 7 ✓]

$PNPM run test packages/sdk/client
→ Test Files  3 passed (3)   Tests 84 passed (84)     [基线 73 + 11 ✓]
```

**（2）`typecheck` —— 基线绿，未变。** `$PNPM run typecheck` → exit 0。

**（3）app + SDK 回归 —— 失败集合与基线完全一致。**

```
$PNPM run test apps/vscode-dsh packages/sdk/client
→ Test Files  4 failed | 49 passed (53)
→      Tests  6 failed | 434 passed | 1 skipped (441)     exit 1
```

失败用例（无一属于本 Phase 触碰的文件）：`spike-t0b-continue-capability.spec.ts`（整文件）、
`panel-close-delete.e2e.spec.ts`（1）、`spike-t0a-replay-rebuild.spec.ts`（4：AC-30/47、AC-76、AC-77、
AC-80）、`verifier-phase1/layer-a-rtl.spec.tsx` V-A4（1）。与 `spec.md:80` 基线（4 文件 / 6 用例，
根因 `scripts/test-invariants.ts:188`）一致，也与 `implementation.md` §4.1 声称的
`53 files / 441 cases / 434 passed / 1 skipped` 逐字一致。

**（4）lint 增量 —— 以 gate 口径实测，且我上轮的数字才是错的那个。**

我跑了真正的 gate（`$PNPM run lint` → `tsx scripts/run-oxlint.ts .`）并按文件计数：

```
lint exit=1；输出 12681 行；诊断行 10382 行、涉及 263 个文件   [§4.3 声称 10382 / 263 ✓]

    0  apps/vscode-dsh/src/node-env-guard.ts               （新文件）
    0  apps/vscode-dsh/tests/node-env-guard.spec.ts        （新文件）
    0  apps/vscode-dsh/tests/session-host-preflight.spec.ts（新文件）
    0  apps/vscode-dsh/package.json
    0  packages/sdk/client/src/{launch,types,index}.ts、tests/launch.spec.ts
    1  apps/vscode-dsh/src/session-host.ts      :595:3   typescript(require-await)
    1  apps/vscode-dsh/src/auto-start-orchestrator.ts :230:24 typescript(no-non-null-assertion)
    1  apps/vscode-dsh/src/index.ts             :97:3    typescript(no-deprecated)
    4  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts  52,53,95,96（既有 mockPort 辅助函数）
   22  apps/vscode-dsh/src/extension.ts        271,375,380,385,407,425,662,750,1004,1102,1152,
                                               1418,1450,1492,1534,1791,2109×2,2110,2111,2270,2272
```

上述每一行都落在新增行区间之外。`git diff -U0` 显示 `extension.ts` 为纯插入 hunk
（`+48`、`+223,14`、`+2172,19`、`+2253`、`+2256`），`auto-start-orchestrator.ts` 为
（`+26,30`，及 `+220` 处的替换 —— 它只是后移、并未作者化 `:230`），`session-host.ts` 为
（`+14`、`+16`、`+27`、`+29`、`+42,38`、`+106,4`、`+253,2`、`+285,6`、`+300`、`+321,7`）——
均不含 `:595`。零新增诊断，实测。

**对我自己上一轮报告的更正。** 合并报告第 1 轮的 S3 条记录了我给出的「`extension.ts` 3 条诊断」。
该数字只在削减后的规则集下可复现：

```
$PNPM exec tsx scripts/run-oxlint.ts apps/vscode-dsh/src/extension.ts                    → 22
$PNPM exec tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json <同一文件>          →  3  （2109:1、2110:1、2111:1）
```

因此 implementer 的 §4.3 表格比我的第 1 轮发现**更准确**，其自报差异第 2 条（更正而非照抄审查给出
的数字）**成立**。另有一条值得记录的测量陷阱：对**单个测试文件**调用该 runner 会放大类型感知诊断
（`node-env-guard.spec.ts` → 109、`session-host-preflight.spec.ts` → 96），原因是
`apps/vscode-dsh/tsconfig.json` 只 include 了 `src`；在全量 gate 中这两个文件报 0 且完全不出现在输出
里，而其他 `apps/vscode-dsh/tests/**` 文件会出现（`spike-t0a-replay-rebuild.spec.ts` 173、
`phase2-auto-ready.spec.ts` 15 等）。以 gate 数字为准，两个新 spec 文件均为 0。

**（5）文档门禁 —— 计数一致，且任何违规清单都不含本 Phase 文件。**

```
$PNPM run test:docs → exit 1，run-gates: 10 passed, 5 failed, 0 skipped
失败门禁：markdown links | translation pairing | markdown wrap | agent note format | documentation standard tests
$ grep -icE "development(\.zh)?\.md|sdk/client/README" <docs gate 输出>  → 0
```

配对违规项为 `docs/wiki/**`（仅中文页，约 30 个）、`apps/vscode-dsh/README.md`、
`apps/vscode-dsh/tests/fixtures/screenshots/README.md`、`packages/README.*`、`packages/sdk/server/README.*`
以及 `2026-09-04-ide-profile-dual-channel.md` —— 与 `spec.md:98` 基线清单一致。既不包含
`docs/development.md` / `.zh.md`，也不包含 `packages/sdk/client/README.md` / `.zh.md`。配对记录与
工作区校验一致：

```
$ git hash-object docs/development.md docs/development.zh.md
32be857e74680f7631e85dcb7ed9fe21595e8111     # 记录值：32be857e74680f7631e85dcb7ed9fe21595e8111 ✓
821d84beefd40770ca4f5583a1aaeab64672432b     # 记录值：821d84beefd40770ca4f5583a1aaeab64672432b ✓
```

## 上一轮 13 条逐条判定

| # | 条目 | 判定 | 一手证据 |
|---|------|:--:|------|
| **M1** | AC-3(d) 的 reload 条目缺可判定记法 | **CONFIRMED-FIXED** | `docs/development.md:131` 现为「…run `Developer: Reload Window` (`workbench.action.reloadWindow`) from the Command Palette. The extension reads the setting on every start and does not cache it.」；`docs/development.zh.md:136` 含同样四个记法。`DECIDABLE_ENTRY_TOKENS` 已含 `workbench.action.reloadWindow`，且逐条目循环要求双语两份文档、两个清单小节下的每个 `- ` 条目都必须带一个记法。 |
| **M2** | `node-environment` 在 orchestrator 跳转处被压平为 `process-failed` | **CONFIRMED-FIXED** | `START_ERROR_KINDS = ['missing-credentials','node-environment','process-failed']`（`auto-start-orchestrator.ts:27`）；`startErrorKindOf`（`:47-55`）是 catch 路径上 **唯一** 写 `this.errorKind` 的位置（`:220`），且仅当 `kind` 不在词表内/缺失时才返回 `process-failed`；`HostStartErrorKind = StartErrorKind`（`session-host.ts:51`）；通用兜底 `throw HostStartError('process-failed', …)`（`:327`）。`'start-failed'` 在 `apps/` 与 `packages/` 下零命中。运行时证据：`auto-start-orchestrator.spec.ts:150-164` 把 **真实** 的 `HostStartError('node-environment', …)` 经 port 抛出并断言 `snapshot.errorKind === 'node-environment'`；`node-env-guard.spec.ts:648-671` 驱动真实 `activate()`、`settings.json` 指向不存在的路径，断言 `snapshot.errorKind === 'node-environment'`（`:666`）。均通过。 |
| **S1** | AC-4 行 payload 字段名写成 `zstd`/`withResolvers` | **CONFIRMED-FIXED** | `implementation.md` §3 AC-4 行与 §2 均为 `hasZstd`/`hasWithResolvers`，与 `node-env-guard.ts:279-281` 及 `node-env-guard.spec.ts:56,286-299`、`session-host-preflight.spec.ts:80` 的 fixture 一致。 |
| **S2** | `process-exec-path` 的 remediation 建议改 `PATH` | **CONFIRMED-FIXED** | `node-env-guard.ts:200` 改指该可执行文件的真正归属方 + 两个配置杠杆；所有渲染出的诊断均已不含 `PATH`。`node-env-guard.spec.ts:415-417` 断言第三档消息含 `this is the Extension Host's own Node.js executable, so set DSH_NODE_BIN`，且 **不** 含 `PATH`。 |
| **S3** | lint 数字无法复现 | **CONFIRMED-FIXED**（我上轮的数字才是错的，见（4）） | 实测 10382 / 263，且逐文件表格整体复现；§4.3 现同时给出两条命令与两个数值。 |
| **S4** | `scope` / `markdownDescription` 未记偏差 | **CONFIRMED-FIXED** | `implementation.md` §5.10 记录两键与 `machine-overridable` 理由；`package.json:60-66` 确有。 |
| **S5** | 「跨 start 不缓存」不可证伪 | **CONFIRMED-FIXED** | `node-env-guard.spec.ts:629-646` 先写真实 `settings.json` 为 `first-node`、start；再把文件改写为 `second-node`、再 start；断言第二次快照消息含 `second` 且 **不** 含 `first`。该值是有承载力的：`readNodeBinSetting`（`extension.ts:2179-2189`）无缓存，且在每次 start 时于 `createStartHostPort().start` 内被调用（`:2253`）—— 缓存取值 *或* 缓存解析结果都仍会报 `first`。强于第 1 轮建议（它同时可证伪缓存文件读取）。 |
| **S6** | AC-3(a)(b) 没有可执行断言 | **CONFIRMED-FIXED** | `assertChecklistStructure`（`node-env-guard.spec.ts:151-165`）要求四个标题各出现恰好一次、且本机环境侧每个条目必须带七个可判定记法之一；`:474-499` 对双语文件执行该断言，然后从内存文本中逐个删除一侧标题、要求 **同一** 断言抛错（`:486-492`）。执行证据：27/27 通过，且删除路径每次运行都被走到。 |
| **S7** | 「declared once」与 `EXPECTED_NODE_RANGE` 实为副本相冲突 | **CONFIRMED-FIXED** | `docs/development.md:105`：「The floor has one owner, `engines.node` in the root `package.json`, which the extension mirrors in the range it enforces and a test keeps equal to that field」；`development.zh.md:110` 同义。`node-env-guard.spec.ts:444-447` 即该「保持相等」的测试。 |
| **S8** | 设置项 → host 的路由决策未记录 | **CONFIRMED-FIXED** | `implementation.md` §5.11 附三条理由；代码在 `extension.ts:2253-2256`（`readNodeBinSetting(user)` → `start({ cwd, nodeBinSetting, credentials })`），选项声明在 `session-host.ts:108-109`。 |
| **S9** | 探针忽略 `ELECTRON_RUN_AS_NODE` | **CONFIRMED-FIXED** | `probeNodeApis(executable)`（`node-env-guard.ts:254-264`）构造 `{...process.env}`，当且仅当 `executable.electronRunAsNode` 时置 `ELECTRON_RUN_AS_NODE='1'`，并把 `env` 传给 `execFileAsync`；调用点 `:131` 传入已解析对象。`node-env-guard.spec.ts:240-267` 用「仅在带该 flag 时才表现为 Node」的 shim，断言带 flag 为 `ok:true`、不带则为 `unusable` —— 两个方向都会变红。 |
| **S10** | Phase 2 的「诊断注入点」未记录 | **CONFIRMED-FIXED** | `implementation.md` §5.12 指名三个既有类型化出口 —— `IdeSessionHost.onError`（`session-host.ts:195`）、`AutoStartOrchestrator.getSnapshot()/onChange`、`HostStartError{kind,diagnostic}`（`:57-77`）—— 并声明不新增 sink 类型。我核验三者的签名均存在。 |

**implementer 自报的 3 处刻意差异**（`implementation.md` §1.3）：

1. *保留 `process-failed` 作为唯一通用成员* —— **成立**。M2 禁止的是通用 `'start-failed'` 类，该名字
   已彻底消失。`process-failed` 是**已批准**的下游 spec 所要求：Phase 2 `spec.md:61` 明确「未知错误必须
   落到记录 `kind === 'other'`（对应 orchestrator 的 `errorKind === 'process-failed'`）」。删除它会
   破坏 Phase 2。
2. *更正 S3 的数字而非照抄* —— **成立**；我第 1 轮的数字来自削减后的规则集（见（4））。
3. *S5 以「重写真实 `settings.json`」满足* —— **成立**；严格强于建议的二次变更（它同时可证伪缓存
   文件读取）。

## 新发现

### N1 —— AC-1(b) 的自动化用例没有定位被 pin 的版本，因而无法报出 spec 要求的「本机无该版本安装」这一结果 🟡 Should-Fix

* **位置**：`apps/vscode-dsh/tests/node-env-guard.spec.ts:449-461`
  （用例名 `pins exactly one machine-readable version that the declared range admits (AC-1 a, b)`）。
* **spec 要求**：`spec.md:43` 的 (b) 项要求在 `/usr/local/n/versions/node/<v>`、
  `~/.nvm/versions/node/v<v>` 或 `command -v node` 中定位 `.nvmrc` 版本的安装，并对**那个被定位到的
  解释器**调用 `validateNodeEnvironment`；当本机并无该版本安装时，必须以非 PASS 结束并把「本机无该
  版本安装」记入报告，而不是把检查计为通过。
* **代码实际做法**：两条结构断言之后，它校验的是 `process.execPath`（`:455-460`）。没有任何断言要求被
  校验解释器所报告的版本等于被 pin 的版本，也没有搜索任何候选根目录。因此只要跑测试的 Node 是**某个**
  API 完备的版本（哪怕本机根本没装 24.3.0），该断言依然通过 —— 而「本机没装」正是 (b) 项要检出的
  状态。
* **影响**：AC-1 本身成立（`.nvmrc` = `24.3.0`，`grep -cE '^[0-9]+\.[0-9]+\.[0-9]+$' .nvmrc` → 1，
  `rangeAdmits('^22.19.0 || >=24.0.0','24.3.0')` 为 true，`engines.node` 与 `EXPECTED_NODE_RANGE`
  相同），且 `implementation.md` §4.5 已把真机探针（`/usr/local/n/versions/node/24.3.0/bin/node` →
  `ok:true`）记为人工测量。缺口在于**可执行**用例未编码这一点，使本 Phase 的 AC-1(b) 证据停留在
  报告文字而非断言。
* **建议修复（一条断言）**：捕获报告并断言 `validation.report.version === pinned`；若还想把定位步骤
  也变成断言，可遍历三个根目录查找 `pinned` 并 `expect(located).toBeDefined()`，这样「本机无该版本
  安装」会显式失败而不是静默通过。

## 桩代码检测

**已登记桩（对照 `tech-debt-registry.md`）**

| Registry ID | 文件:函数 | 状态 | 说明 |
|---|---|:--:|---|
| `DEBT-004` | `packages/specdev/specdev-presets/src/tool-policy.ts` | ⚠️ 已知，无关 | 🟡 非阻塞，目标为未来某个 preset-strategy 工作流；Phase 1 未触碰 `packages/specdev/**` 下任何文件（`git status` 可证）。不属本 Phase 义务。 |
| `DEBT-001` | — | 已解决 | 在 registry 的「已解决」表中，由本 Phase 的 AD-9 逆转解决。 |

**新发现的未登记桩**：无。

```
$ grep -nE "@STUB|TODO|FIXME|XXX|not implemented|placeholder" node-env-guard.ts session-host.ts \
    auto-start-orchestrator.ts extension.ts launch.ts types.ts   → 0 命中
$ grep -c "@STUB" <四个 Phase 源文件>                             → 0,0,0,0
```

我读过的每个函数体都执行真实逻辑：`validateNodeEnvironment` 先做 `stat` + `X_OK`，再走真实
`execFile` 子进程探针，再做能力差集；`probeNodeApis` 构造显式环境并解析收窄后的报告；
`startErrorKindOf` 扫描真实词表数组；`resolveNodeExecutableSpec` 读取两个真实输入与
`process.versions.electron`；`readNodeBinSetting` 读取真实配置访问器并在非字符串时抛错。没有
`(void)args`、没有 `return Ok(0)`、没有吞掉已归类失败的空 `catch`（`auto-start-orchestrator.ts:254`
与会话 host 监听器中的两处空 `catch` 都注明吞掉什么，且不可能掩盖 start 失败 —— 失败路径在其之外）。

## 逐条 AC 验证

| AC | 实现位置 | 运行时证据（我方实测） | 判定 |
|---|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0`（单行、带尾换行）；根 `engines.node` = `EXPECTED_NODE_RANGE` | `grep -cE '^[0-9]+\.[0-9]+\.[0-9]+$' .nvmrc` → 1；spec 用例 `:444-447`（engines ≡ 强制区间）、`:449-461`（区间容纳 pin；`process.execPath` 报 `ok:true`）；双语文档同时出现 `.nvmrc` 与 pin（`:463-471`） | ✅（证据强度见 N1） |
| AC-2 | `docs/development.md:105` / `.zh.md:110` | 已逐字阅读两文件：floor、`engines.node` 归属、两个 API、`.jsonl.zstd` 关联 | ✅ |
| AC-3 | `docs/development.md:109-131` / `.zh.md:114-136` | `:474-499` 可执行结构断言 + 逐侧删除证伪，双语，通过 | ✅ |
| AC-4 | `validateNodeEnvironment`（`node-env-guard.ts:115-147`），在 `session-host.ts:290` 于 `bridge.listen`（`:291`）**之前**调用 | `node-env-guard.spec.ts` 27 通过，含 `missing`/`not-executable`/`missing-apis`/`unusable`/正向；`session-host-preflight.spec.ts` 以「witness 文件不存在 + socket 不存在 + `<5s`（而 `initializeTimeoutMs` 为 60 000）」证明 spawn 计数恰为 0 | ✅ |
| AC-5 | `launch.ts:132-135` env 优先、`:136-139` 设置项、`:140-144` `process.execPath` | `launch.spec.ts:232-247`（env 胜过非空设置项，也胜过 Electron 档）、`:269-273`；`session-host-preflight.spec.ts:263-326`（真实 shim 被运行；env 压过设置项） | ✅ |
| AC-6 | 第三档 = `process.execPath`；`electronRunAsNode` 仅该来源在 Electron 下为真 | `launch.spec.ts:289-297`（`ELECTRON_RUN_AS_NODE === '1'`）、`:299-314`（用遮蔽 `PATH` 的 shim 证明解析**不查** `PATH`：`which node` 指向 shim，spec 仍返回 `process.execPath`） | ✅ |
| AC-7 | `session-host.ts:287-291` 顺序：解析 → 门禁 → listen，之后才 spawn | `session-host-preflight.spec.ts:124-153`（reject `kind==='node-environment'`、`status==='error'`、无 witness、无 socket、`<5s`）、`:155-202`（来自设置项；以 spy 证明恰好 1 次解析）、`:204-261`、`:305-326` | ✅ |
| AC-8 | `formatNodeEnvironmentDiagnostics`（`node-env-guard.ts:167-176`）渲染恰好 5 行 | `node-env-guard.spec.ts:355-383`（路径、版本、两个区间窗口、两个 API 名、两个杠杆、5 行）、`:420-442`（四种 kind → 四条互不相同的 5 行消息）；`session-host-preflight.spec.ts:189-200` 在真实被拒 start 上断言五要素 | ✅ |
| AC-9 | 首行 `Node environment check failed — source: …`；载体 `NodeEnvironmentError` / `HostStartError{kind:'node-environment'}`；类别抵达快照 | `:380-382`（首行含 `Node environment`，且不匹配 `/dsh bug|internal error|defect|broken/i`）、`session-host-preflight.spec.ts:192`，以及跳转断言 `auto-start-orchestrator.spec.ts:162` 与 `node-env-guard.spec.ts:666` | ✅ |
| AC-10 | (a) `package.json:60-66`；(b) `development.md:107` / `.zh.md:112`；(c)(d)(e) 代码 + 测试 | (a) `:504-517`；(b) 逐字阅读两文件；(c) `launch.spec.ts:249-267`；(d) `session-host-preflight.spec.ts:155-202`（`missing` 与 `missing-apis` 均源自设置项，1 次解析、不 spawn）+ `node-env-guard.spec.ts:648-671`（真实 `activate()`，运行后 `settings.json` 逐字节不变）；(e) `:584-686`（每次 start 重读、空值透传、重读不缓存、非字符串在 `IdeSessionHost.start` **之前** 显式失败 —— `startSpy` 未被调用） | (a)–(e) ✅；(f) 依设计属 Phase 3，并已在 `implementation.md` §3 登记为跨 Phase 依赖 |

AD-1 不变量（读代码而非假定）：`session-host.ts:287-289` 生成对象 → `:290`
`assertNodeExecutable(nodeExecutable)` → `:300` **同一绑定**交给 `HarnessClient` →
`launch.ts:177,184` 的 `options.nodeExecutable.path` 成为 `command`。AD-2 成立：guard 中不存在版本
比较分支，`unsupported-version` / `nodeVersionSupported` 零命中。

## 未能验证

* **M2 的变异式证伪**。我尝试了一个 out-of-tree 变异探针（复制 `auto-start-orchestrator.ts` 并从
  `START_ERROR_KINDS` 中移除 `node-environment`，由内联探针驱动），被审查沙箱以「未经授权的
  out-of-tree harness」为由阻断。因此其可证伪性依据是：(i) 阅读那 9 行分类器 —— 它是 catch 路径上
  `errorKind` 的唯一写入者，且对数组外的任何 kind 都返回 `process-failed`；(ii) 通过真实 port 抛出
  **真实** `HostStartError('node-environment')` 的那条断言通过。作为「已执行的变异」仍属 UNVERIFIED；
  代码阅读本身无歧义。
* **`unusable` 的超时分支**。要诱发 10 秒探针超时需长驻 fixture，未执行；退出码分支与非报告输出分支
  已覆盖。`implementation.md` §6.5 记录了同一限制。
* **真实 Extension Development Host、第三档**（无设置项且无 `DSH_NODE_BIN` 的 `process.exec-path`）——
  属 Phase 3 范围，且其 smoke preset 会设置 `dsh.nodeBin`，故第三档在 Phase 3 同样不被覆盖（自第 1 轮
  起延续的 Phase 3/4 登记项）。
* **`$PNPM run doc-sync`** 未运行：`spec.md:100` 把本 Phase 的首次 `test:docs` 通过定为门禁、把
  `doc-sync` 留给 Phase 4。`test:docs` 已运行，计数与基线一致。

## 与 `implementation.md` 的出入（第 2 轮）

没有任何足以改变判决的出入。两处措辞备注：§4.3 的逐文件表格在 gate 命令下完全复现，但把同一 runner
施加到单个测试文件时会放大类型感知诊断（109 / 96）—— 若日后逐文件重测该表，值得加一句括注；§4.5 的
`/usr/bin/node` 行为 18.12.1，与 §4.5 的 `env -i PATH=/usr/bin:/bin` 探针一致。AC-4 行现已使用探针
的真实字段名（S1 ✓）。

无升级项：本 Phase 是工作流的第一个 Phase，我方发现不可能影响任何已完成的上游 Phase；三条升级触发
条件（AC 不可测、3 个以上未登记桩、AC 冲突）均不成立 —— 第二条需要至少一个未登记桩，而实际为零。
