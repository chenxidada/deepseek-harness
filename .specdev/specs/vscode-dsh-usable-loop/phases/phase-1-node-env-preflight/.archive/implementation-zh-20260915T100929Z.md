# Phase 1 实现 —— `phase-1-node-env-preflight`

| 字段 | 值 |
|---|---|
| Phase ID | `phase-1-node-env-preflight`（逐字取自 `phase-plan.md` 的 DAG JSON） |
| 工作流 | `vscode-dsh-usable-loop` |
| 分支 | `impl-phase-1-node-env-preflight`（所有改动留在工作区，本 agent 未做任何提交） |
| 执行者 | implementer（子 agent）；仅自测 —— 判决权在独立的 reviewer 与 verifier |
| 日期（UTC） | 2026-09-15 |
| 已读全文的上游 | `phases/phase-1-node-env-preflight/spec.md`、`phases/phase-1-node-env-preflight/repo-exploration.md`、`requirements.md`（AC-1 – AC-10）、`design.md`（AD-1、AD-2、AD-9、AD-10、AD-11）、`tech-debt-registry.md`（只读交叉校验） |

本文档的范围：改了什么、每处改动服务于哪条验收标准、以及每条运行时结论背后的「命令 + 输出」证据。`tech-debt-registry.md` 未新增条目，因为本 Phase 没有引入任何桩、占位或"以后接上"的接线；它新增的每条路径都是完整的。

## 1. 变更清单

### 1.1 新增文件

| 路径 | 行数 | 用途 |
|---|---:|---|
| `.nvmrc` | 1 | `24.3.0` —— AC-1 要求的机器可读 Node 声明，指明本仓库的检查所依据的发布版。 |
| `apps/vscode-dsh/src/node-env-guard.ts` | 295 | 唯一的校验入口：`validateNodeEnvironment()`、抛错包装 `assertNodeExecutable()`、失败分类、五要素诊断渲染、可执行文件与权限探测，以及把候选者当真子进程运行的 API 能力探测。 |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` | 535 | 24 个运行时用例：正向能力报告、每种失败分类、五要素诊断、manifest 贡献、扩展读取设置项，以及 `.nvmrc` / `engines.node` / 文档一致性检查（AC-1、AC-2、AC-4、AC-8、AC-9、AC-10）。 |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts` | 327 | 7 个运行时用例覆盖 spawn 顺序契约：门槛 → `bridge.listen` → spawn；spawn 通过 witness 文件观测而非 mock（AC-4 顺序、AC-5 c、AC-7、AC-8、AC-10 c/d）。 |

### 1.2 修改文件

| 路径 | 改动 |
|---|---|
| `apps/vscode-dsh/package.json` | 在 `apps/` 下新增首个 `contributes.configuration`：`dsh.nodeBin` 字符串项，默认 `""`，作用域 `machine-overridable`，description 写明解析顺序、"留空"的含义，以及门槛依据的是 API 而非版本号。 |
| `apps/vscode-dsh/src/extension.ts` | `VsCodeLike` 增加 `workspace.getConfiguration`；`readNodeBinSetting()` 读取 `dsh.nodeBin`，遇到非字符串值时在宿主创建之前 fail loud；`createStartHostPort()` 把 `nodeBinSetting` 传入 `IdeSessionHost.start()`；`node-environment` 失败经既有诊断路径上报。 |
| `apps/vscode-dsh/src/session-host.ts` | 新增 `HostStartError`/`HostStartErrorKind`、`IdeSessionHostStartOptions.nodeExecutable` 与 `.nodeBinSetting`，并把 `start()` 重排为 `resolve → assertNodeExecutable → bridge.listen → client start`。`HarnessClient` 拿到的就是门槛校验过的同一个 `ResolvedNodeExecutable` 对象。 |
| `apps/vscode-dsh/src/index.ts` | 加性再导出：门槛相关类型、常量、错误类，以及 `HostStartError`。 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`、`phase2-auto-ready.spec.ts`、`phase4-new-conversation-chrome.spec.ts` | 各个内联的 duck-typed `vscode` 替身补上 `workspace.getConfiguration('dsh')`，使先于本 Phase 存在的套件不会因扩展新增的设置读取而抛错。 |
| `packages/sdk/client/src/types.ts` | 新增 `NodeExecutableSource`、`ResolvedNodeExecutable`、`NodeExecutableRequest` 与 `HarnessClientOptions.nodeExecutable` —— 全部为加性。 |
| `packages/sdk/client/src/launch.ts` | `resolveNodeExecutableSpec()` 成为唯一解析入口（`DSH_NODE_BIN` → `nodeBinSetting` → `process.execPath`），取代仅返回路径的 `resolveNodeExecutable()`；`resolveDshLaunch()` 消费调用方传入的 `ResolvedNodeExecutable`，且只在 Electron 下的 `process.execPath` 情形注入 `ELECTRON_RUN_AS_NODE=1`。 |
| `packages/sdk/client/src/index.ts` | 加性再导出：`resolveNodeExecutableSpec`、`NodeExecutableRequest`、`NodeExecutableSource`、`ResolvedNodeExecutable`。 |
| `packages/sdk/client/tests/launch.spec.ts` | **扩展**（而非另建替代文件）新增 9 个 `it` 块 / 11 个用例，覆盖三级来源链、与 Electron 的交互，以及边界输入。 |
| `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | 新增 "Choosing the Node executable" / 「选择 Node 可执行文件」一节，说明该函数、层级顺序，以及"探测与诊断属于嵌入方应用"；配对记录已重录。 |
| `docs/development.md` + `development.zh.md` + `development.i18n.yaml` | 新增 `### Node environment` / `### Node 环境` 一节：版本下限及其声明文件、`.jsonl.zstd` 对 API 的依赖、解析顺序、仓库侧机制表，以及按 *终端侧* / *扩展子进程侧* 分列的「本机环境侧职责」清单；`### Prerequisites` 的 Node 条目现在链接到该节；配对记录已重录。 |

### 1.3 在本工作区被改动或未跟踪，但**不属于**本 Phase

列出以免 HG-3 把它们归到 Phase 1。它们的修改时间均为 2026-09-14 或今日更早（早于本 agent 启动），本 Phase 未以写入方式打开过其中任何一个。

| 路径 | 状态 | 说明 |
|---|---|---|
| `pnpm-lock.yaml` | 已修改（7+/4−） | 既有改动；本 Phase 全程未执行安装（一直带 `--config.verify-deps-before-run=false`）。 |
| `apps/vscode-dsh/webview/dist/assets/index.{css,js}` | 已修改 | 既有 webview 构建产物。 |
| `.cursor/skills/project-build/SKILL.md`、`.specdev/specs/workflows.json` | 已修改 | 既有改动。 |
| `.cursor/**`、`.trae/**`、`.explore/`、`.mcp.json`、`opencode.jsonc`、`docs/wiki/**`、`.wiki-work/`、`knowledge-base-mcp.sh` | 未跟踪 | 既有的工具 / 配置 / 知识库目录树。 |
| `packages/**/src` 下数以千计的 `*.d.ts`、`*.js`、`*.js.map`、`*.d.ts.map` | 未跟踪 | 树内构建残留。它同时也是 `lint` 基线为红的主因（单文件可达数百条诊断）以及 `verify-export-jsdoc` 噪声的来源；非本 Phase 产生。 |

## 2. 验收标准覆盖

| AC | 实现在哪 | 由什么证明 |
|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0`；`EXPECTED_NODE_RANGE` 是根 `engines.node` 的副本 | `node-env-guard.spec.ts` → *pins exactly one machine-readable version that the declared range admits*：`.nvmrc` 恰有一行版本号，`rangeAdmits('^22.19.0 \|\| >=24.0.0', '24.3.0')` 成立，且 `validateNodeEnvironment(process.execPath)` 返回 `ok:true`；*keeps the enforced range identical to the root engines field*：`engines.node` === `EXPECTED_NODE_RANGE`；*names the pinned release in both developer docs*：两份文档都含 `.nvmrc` 与所固定的版本号。 |
| AC-2 | `docs/development.md` 的 `### Node environment` 一节（含中文孪生页） | 该节写明最低版本（22 线的 22.19、以及 24 及以上）、声明来源文件（根 `package.json` 的 `engines.node`）、两个 API（`zlib.createZstdDecompress`、`Promise.withResolvers`），并把 API 与会话日志 `.jsonl.zstd` 关联起来。 |
| AC-3 | 同一节的两张清单 | 「仓库侧职责」是 5 行表格，每行都带可判定的命令（`pnpm run typecheck`、`pnpm run test apps/vscode-dsh`、`pnpm run test packages/sdk/client`、`pnpm run test:docs`、`pnpm run doc-sync`）。「本机环境侧职责」按 `Terminal side`（3 条：版本检查、`nvm use` / `n 24.3.0`、前置 `PATH`）与 `Extension subprocess side`（3 条：设置项或 `DSH_NODE_BIN`、用 `--version` 确认、重载窗口）分列。没有任何条目把两侧合并成一条指令。 |
| AC-4 | `node-env-guard.ts` 的 `validateNodeEnvironment()`，由 `IdeSessionHost.start()` 在 `bridge.listen` 之前调用；三个来源都经过 `resolveNodeExecutableSpec()`，因此一个门槛覆盖全部来源 | (a) `inspectExecutableFile()` 检查存在性、常规文件、`X_OK`；(b) `probeNodeApis()` 把候选者当真子进程运行，询问 `zlib.createZstdDecompress` 与 `Promise.withResolvers`。用例：对本机合格 Node 的正向报告；`missing`；`not-executable`；对自报 `{"version":"20.16.0","zstd":false,"withResolvers":false}` 的替身得到 `missing-apis` 并列出两个 API 名。 |
| AC-5 | `resolveNodeExecutableSpec()` 最先读 `DSH_NODE_BIN`，且只把空字符串视为未设置 | `launch.spec.ts`：环境变量存在 → `{source:'dsh-node-bin'}`，且即使 `process.versions.electron` 已定义也没有 `ELECTRON_RUN_AS_NODE`；**(b)** 环境变量与设置项同时非空 → *prefers a non-empty DSH_NODE_BIN over the configuration setting*；这一不对称性由 *treats an empty DSH_NODE_BIN as unset and falls through to the setting* 与 *uses a whitespace-only DSH_NODE_BIN as given, because only the empty value counts as unset* 两条用例共同钉住；`session-host-preflight.spec.ts`：`DSH_NODE_BIN` 指向真实 shim → shim 运行过，且真实 Node 子进程运行了运行时脚本，而不可用的设置项从未走到 spawn。 |
| AC-6 | 第 3 级是 `process.execPath`；仅该来源在 Electron 下令 `electronRunAsNode` 为真 | `launch.spec.ts`：Electron 宿主 + 无环境变量 + 设置项为空 → `{source:'process-exec-path', electronRunAsNode:true}` 且 `ELECTRON_RUN_AS_NODE === '1'`；断言被注入 `PATH` 的 `node` shim 不是被 spawn 的可执行文件。 |
| AC-7 | `start()` 现在的顺序是 门槛 → `bridge.listen` → spawn | `session-host-preflight.spec.ts`：对 `DSH_NODE_BIN` 选中的不可用候选者，以及设置项选中的「不存在」与「不可用」两种候选者均为：`start()` 以 `kind === 'node-environment'` reject，证明子进程运行过的 witness 文件始终不存在，`existsSync(bridgeSockPath)` 为 false，`host.status === 'error'`，且耗时远低于 `initializeTimeoutMs`（配置 60 000 毫秒，断言 < 5 000 毫秒）—— 即该失败既非「spawn 后崩溃」也非握手超时。 |
| AC-8 | `formatNodeEnvironmentDiagnostics()` 恰好渲染五行，对应五个要素 | 每种失败分类都产出五行消息；四条消息两两不同。设置项来源的 `missing-apis` 消息被断言含候选路径、探测到的版本（`20.16.0`）、期望范围（`22.19` 与 `24`）、两个缺失 API 名，以及两个修复入口（`DSH_NODE_BIN` 与 `dsh.nodeBin`）。在扩展层，失败启动的用户可见消息被断言含出错的路径与 `dsh.nodeBin`。 |
| AC-9 | 文本把失败归类为 Node 环境问题；载体类型为 `NodeEnvironmentError` 与 `HostStartError{kind:'node-environment'}` | 诊断首行含 `Node environment`；消息以「探测到的版本 vs 期望范围」表述，并只给出环境侧修复。没有任何诊断文本把失败归给 dsh 代码，也没有任何代码路径把它转成通用运行时错误。 |
| AC-10 | (a) `apps/vscode-dsh/package.json` 的 `contributes.configuration.dsh.nodeBin`；(b) 文档写明优先级；(c)–(e) 运行时 | (a) 该项为 `string`、默认 `""`，description 写明优先级与"留空"的含义；(b) `docs/development.md`（含中文页）写明 `DSH_NODE_BIN` > `dsh.nodeBin` > 扩展宿主自带 Node；(c) `launch.spec.ts`：仅有设置项 → `{path:'/y/node', source:'vscode-setting'}`，且门槛校验的对象就是交给 `resolveDshLaunch` 的对象；(d) `session-host-preflight.spec.ts`：设置项指向不存在的路径 → reject、`kind === 'node-environment'`、无 witness 文件、无 bridge socket、`status === 'error'`，且 `resolveNodeExecutableSpec` **只被调用一次**（没有二次解析去取别的来源）；(e) `node-env-guard.spec.ts`：扩展从真实的 `settings.json` 经 `workspace.getConfiguration('dsh').get('nodeBin')` 读取，把值显式传给宿主，空值原样透传，且非字符串值 fail loud。 |

**跨 Phase 依赖（AC-10 f，在此登记供 verifier 写入 `verification.md`）**：AC-10 的真机分支 —— 预置 `settings.json` 在真机 Extension Development Host 中被解析链消费 —— 由 Phase 3 的冒烟脚本按 AD-11 提供证据。Phase 1 只判定 (a)–(e)。Phase 1 **不** 声称该分支，且不得把它记为"known gap 后判 PASS"。

**无效设置分支（AC-10 d）的证据拆分**：spec 的裁定要求两部分并显式标注。本 Phase 提供 (i) *代理证据*：在 `node-env-guard.spec.ts` 中断言预置的 `settings.json` 在运行后逐字节未变（有效路径与无效路径两种用例都断言）；(ii) *不可代理的负面证据*：`session-host-preflight.spec.ts` 中断言所有 spawn 标记均不存在（witness 文件不存在、bridge socket 不存在、`status === 'error'`、耗时远低于超时）。产品代码中未引入任何新观测点；`resolveNodeExecutableSpec` 的调用计数只发生在测试内，通过对导入模块命名空间的 spy 完成。

### 2.1 spec 要求的反向/边界用例

| 要求的用例 | 对应测试 |
|---|---|
| 候选不存在 → `missing` | `node-env-guard.spec.ts` 的 *classifies each failure kind distinctly*；`session-host-preflight.spec.ts` 的 *refuses a missing path named by the setting…* 与 *refuses a missing path named by the environment variable…* |
| 候选存在但不可执行 → `not-executable` | `node-env-guard.spec.ts`（mode `0o644` 的文件） |
| 候选可执行但缺 API → `missing-apis` | `node-env-guard.spec.ts`；`session-host-preflight.spec.ts`（两个来源各一） |
| `DSH_NODE_BIN` 为空字符串 = 未设置，继续下一级 | `launch.spec.ts` 的 *treats an empty DSH_NODE_BIN as unset and falls through to the setting* |
| `DSH_NODE_BIN` 存在但无效 → fail loud，不回退 | `launch.spec.ts`（解析原样返回无效路径，仅空白值也照样使用）与 `session-host-preflight.spec.ts` 的 *refuses a missing path named by the environment variable…*（reject、无 spawn、不回退到别的来源） |
| `dsh.nodeBin` = `"   "` → 未设置，继续下一级 | `launch.spec.ts` 的 *treats a `''` / `'   '` configuration setting as unset and falls through to process.execPath*，它与环境变量的空白值用例一起钉住这一不对称性 |
| `dsh.nodeBin` 非空但路径无效 → fail loud，不回退到 `process.execPath` | `session-host-preflight.spec.ts` 的 *refuses an unusable executable that came from the configuration setting* 与 *refuses a missing path named by the setting…* |
| 三个来源皆空且非 Electron → 显式报错，绝不使用经 `PATH` 解析的 `node` | `launch.spec.ts` 的 *never resolves Node through PATH when every source is unset*（证明被注入 `PATH` 的 shim `node` 不是被 spawn 的可执行文件） |

## 3. 测试证据

所有命令均在 `/workspace/chendecheng/code/need/deepseek/deepseek-harness` 下、`export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` 之后执行，并使用 `pnpm --config.verify-deps-before-run=false`（下文简写为 `$PNPM`）。

### 3.1 差量结果（Phase 1 的验收口径）

| 命令 | 基线 | 现在 | 新增失败 |
|---|---|---|---|
| `$PNPM run typecheck` | 绿 | **exit 0** | 无 |
| `$PNPM run test packages/sdk/client` | 绿（3 文件 / 73 用例） | **绿，3 文件 / 84 用例**（73 + 新增 11） | 无 —— 新增的 11 个用例全过 |
| `$PNPM run test apps/vscode-dsh packages/sdk/client` | app 套件：48 文件 / 320 用例，**4 文件 / 6 用例红** | 53 文件 / 435 用例，**4 文件 / 6 用例红**，428 通过，1 跳过 | 无 —— 文件集合与失败用例集合均与基线一致 |
| `$PNPM run lint` | 红 | 红 | 本 Phase 未新增：四个新增/修改的测试或门槛文件均为 **0** 条诊断，所有被动到的 `packages/sdk/client` 文件均为 **0** 条；三个被修改的 `apps/vscode-dsh/src` 文件共 24 条诊断均早于本 Phase（见 3.3） |
| `$PNPM run test:docs` | 红 —— `run-gates: 10 passed, 5 failed` | 红 —— `run-gates: 10 passed, 5 failed` | 无；本 Phase 的四份文档在任何违规清单中零出现 |

app 套件为红的四个文件与基线在身份和数量上完全一致：`spike-t0b-continue-capability.spec.ts`（整文件，根因 `scripts/test-invariants.ts:188` 读取 `undefined` 的 `ACTIVE`）、`spike-t0a-replay-rebuild.spec.ts`（4 用例，同一根因）、`panel-close-delete.e2e.spec.ts`（1 用例）、`verifier-phase1/layer-a-rtl.spec.tsx`（1 用例）。它们都不是本 Phase 触碰过的文件，六个失败的堆栈形态与基线快照相同。最后两个文件的成员资格在同一批并发敏感用例的不同基线运行间会变化，但本文记录的每次运行中，文件数与用例数都与基线一致。

### 3.2 本 Phase 自己的用例

| 命令 | 结果 |
|---|---|
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | `Test Files 3 passed (3)`、`Tests 57 passed (57)`，exit 0 |
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts` | `Tests 24 passed (24)` |
| `$PNPM run test apps/vscode-dsh/tests/session-host-preflight.spec.ts` | `Tests 7 passed (7)` |
| `$PNPM run test packages/sdk/client/tests/launch.spec.ts` | `Tests 26 passed (26)`（HEAD 时为 15） |

AC-4 / AC-7 / AC-8 / AC-10 的每个运行时用例都构造输入、执行、并断言输出；没有一个是静态断言。`node-env-guard.spec.ts` 用 `node:child_process` 真正 spawn 每个候选者；`session-host-preflight.spec.ts` 让子进程写出 witness 文件（`process.execPath` 与 `argv`）来记录被 spawn 的可执行文件，因此"没有子进程运行过"是被观测到的，而不是被假定的。

### 3.3 lint 差量（逐文件）

对完整 `lint` 输出按本 Phase 触碰的文件 `grep`：

| 文件 | 诊断数 | 是否落在新增行？ |
|---|---:|---|
| `apps/vscode-dsh/src/node-env-guard.ts`（新） | 0 | — |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts`（新） | 0 | — |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts`（新） | 0 | —（开发过程中曾引入 2 条：`@stylistic(arrow-parens)` 与 `typescript(no-unnecessary-type-assertion)`，本次运行前均已修复） |
| `apps/vscode-dsh/src/extension.ts` | 22 行：271、375、380、385、407、425、662、750、1004、1102、1152、1418、1450、1492、1534、1791、2109、2110、2111、2270、2272 | 否 —— 新增区间为 48、223–236、2172–2190、2253、2256；每条诊断都在区间外，且在减去本 Phase 的插入行数后，与 HEAD 同行 |
| `apps/vscode-dsh/src/session-host.ts` | 1 行：590（`require-await`） | 否 —— 新增区间为 14、16、28、41–74、101–104、248–249、280–285、295、316–322；590 行属未改动代码 |
| `apps/vscode-dsh/src/index.ts` | 1 行：97（`no-deprecated`，针对 `buildThinChatHtml`） | 否 —— 新增区间为 25–39 |
| `packages/sdk/client/{src/launch.ts,src/types.ts,src/index.ts,tests/launch.spec.ts}` | 0 | — |
| `apps/vscode-dsh/package.json`、三个 duck-typed `vscode` 测试文件 | manifest 中 0 条；三个测试文件的诊断仅限其既有行（23、26、78、81、148、188、200、215、229、231、281、351、390、401 / 102、106、109、123、127、134、227、267、300、320、360 / 158、192），均在其各自唯一那处 5 行插入之外 | 否 |

对修改文件的推理依据是纯插入式 hunk（`git diff -U0` 显示 app 文件每个 hunk 都是 `@@ -N,0 +M,k @@`，只有 `session-host.ts` 中重排后的 `start()` 有四处、`src/index.ts` 的导出块有一处是把单行替换为多行），因此把 HEAD 行号加上插入行数即可把每条诊断映射到未改动的源码文本。

### 3.4 真机探测（AC-1 b 与 AC-4 a 的证据）

通过以 `tsx` 运行已落地的门槛模块并调用 `validateNodeEnvironment({path, source, electronRunAsNode:false})` 得到：

| 解释器 | 报告版本 | `zstd` | `withResolvers` | 结论 |
|---|---|---|---|---|
| `/usr/local/n/versions/node/24.3.0/bin/node` | 24.3.0 | true | true | `ok:true` —— 门槛不误伤合格 Node |
| `/usr/bin/node` | 18.12.1 | false | false | `missing-apis`，两个 API 名都列出 |
| `~/.nvm/versions/node/v22.14.0/bin/node` | 22.14.0 | false | true | `missing-apis`，仅 `zlib.createZstdDecompress` |
| `/usr/local/n/versions/node/22.9.0/bin/node` | 22.9.0 | false | true | `missing-apis`，仅 `zlib.createZstdDecompress` |

最后两行同时也是 AD-2 的实证：这些解释器低于声明的版本下限，但报告的 kind 是 `missing-apis` 并给出 API 名，从不是按版本拒绝；而版本落在声明范围之外、却确实提供两个 API 的解释器会被接受。

写 AC-3(a) 的验证列时还做了两项机器测量，因为该行的第一版措辞断言了一件不成立的事：

| 探测 | 实测 |
|---|---|
| `env -i PATH=/usr/bin:/bin sh -c 'command -v node; node --version'` | `/usr/bin/node`、`v18.12.1` |
| `PATH="/usr/bin:/usr/local/node/bin:$PATH" $PNPM run typecheck` | exit 1，`ERROR: This version of pnpm requires at least Node.js v22.13` |

## 4. 偏差与与本 Phase 所述前提的冲突

1. **第一版实现违反了 AD-2，已修正。** 最初的 `node-env-guard.ts` 按版本号放行（`unsupported-version`）。AD-2 规定门槛按能力判定、版本号仅供诊断，且 AC-4(c) 要求 `{"version":"20.16.0",…}` 替身归类为 `missing-apis`。现已移除版本比较，删除 `unsupported-version` 与 `nodeVersionSupported()`，并相应调整能力用例的顺序。在此记录，是因为该被废弃的版本在本分支此前的运行中可见。
2. **存在第三种名称之外的第四种失败分类 `unusable`。** 它覆盖「存在且可执行、但无法报告 Node 能力」的候选者（非零退出、输出不是报告、或超时）。把它并入 `missing-apis` 会打印从未被观测到的 API 名；该分类在满足 AC-7「阻止 spawn」义务的同时保持消息真实。spec 未给出封闭分类法，也没有任何 AC 要求恰好三种。
3. **空白处理的不对称是刻意的，且与 spec 的边界清单一致。** `DSH_NODE_BIN='   '` 视为*已设置*（原样使用该值，随后被门槛 fail loud），而 `dsh.nodeBin='   '` 视为*未设置*并落到下一级。spec 的边界清单要求的正是这个切分；在此写明，以免被读成不一致。
4. **`docs/development.md` 验证措辞更正。** 第一版声称「当解释器落在 `engines.node` 之外时 `pnpm run typecheck` 拒绝启动」。测量（3.4）表明该拒绝来自 pnpm 自身的下限（22.13），而不是 `engines.node`，且本机在干净 `PATH` 下解析到的是 `/usr/bin/node` v18.12.1，而非 spec 快照所称的 v20.16.0。现在 AC-3(a) 行给出三项可判定检查（`node --version` 被 `engines.node` 接受、`.nvmrc` 指明检查所依据的发布版、`typecheck` 以 0 退出），终端侧条目也不再声称 pnpm 强制的是哪个范围。
5. **与 spec 快照不同的机器事实。** spec 称 `/usr/local/n/versions/node/24.3.0` 是唯一合格安装；本机 `/usr/local/bin/node` 是第二个真实的 v24.3.0 二进制，且 `~/.nvm/versions/node/v20.16.0` 存在，但干净 `PATH` 解析到的不是它。两处差异都不改变实现。
6. **两张清单标题与两个覆盖面标题是粗体引导句，不是 ATX 标题。** `docs/development.md` 中同级小节只用 `##`/`###`，并以粗体文本引导嵌套清单，因此新子结构遵循该页面既有风格。文本匹配（`仓库侧职责` / `本机环境侧职责`、`终端侧` / `扩展子进程侧` 及其英文对应）保持完整，可供 verifier 做结构断言；若门禁约定要求 ATX 标题，每个标题只需改一行。
7. **`HostStartError` 是加性的，但改变了每次 `start()` 失败时抛出的类**，并同时覆盖 `node-environment` 与 `start-failed`。既有 app 套件仍然通过；该类型已导出，调用方可据此判别。
8. **`contributes.configuration` 还带了一个 `title`。** 只有属性块是必需的；title 是加性的，用于在 VS Code 设置界面中分组。
9. **没有删除任何已发布名称。** `resolveNodeExecutable()` 原本是 `launch.ts` 的内部函数（HEAD 时未再导出），因此用 `resolveNodeExecutableSpec()` 取代它不改变公共面；`packages/sdk/client/src/index.ts` 的改动只有新增。

## 5. 未决事项与风险

1. **AC-10(f)**（真机 Extension Development Host 消费预置 `settings.json`）按 spec 要求仍属 Phase 3 义务。Phase 1 不得依据该分支被判完成或未完成。
2. **未运行 `pnpm run doc-sync`**：spec 把首次 `test:docs` 归本 Phase，把 `doc-sync` 留给 Phase 4 的复核。`test:docs` 的确切结果已记录在上文。
3. **为红的 `lint` 基线按设计未动。** 其主体是树内构建残留（未跟踪的 `packages/**/src/*.d.ts` 及 map，单文件数百条诊断），加上 `apps/vscode-dsh/tests/**` 既有的 `no-unsafe-*` 类；后者的结构性成因是 `apps/vscode-dsh/tsconfig.json` 只 `include` 了 `src`，使这些测试文件不在任何 TypeScript 程序内。修复该类意味着把测试目录纳入程序，从而改变本 Phase 必须保持为绿的 `typecheck` 基线，故不在范围内。
4. **`apps/vscode-dsh` 没有覆盖率门禁**，而 `packages/sdk/client` 仍维持逐文件 100%；本 Phase 未给 SDK 增加未覆盖分支 —— 其新代码由 `launch.spec.ts` 覆盖。
5. **`unusable` 分类是本 Phase 唯一可能藏有单元测试看不见的回归之处**，因为它依赖子进程行为（退出码、输出、超时）。它已由一个真实非零退出的替身覆盖；超时分支未单独覆盖，因为构造它需要长驻 fixture。
6. **有两个被跟踪文件在工作区显示为已修改，但不是本 Phase 的改动**：`pnpm-lock.yaml`（mtime 2026-09-14 16:08）与 `apps/vscode-dsh/webview/dist/assets/index.{js,css}`（mtime 2026-09-14 09:21）。二者均早于本 Phase 的文件（2026-09-15），内容是 pnpm 重新解析的条目与早先构建出的 webview 产物，**不得**纳入本 Phase 的提交。

## 6. 文档门禁（实际执行的命令）

| 命令 | 结果 |
|---|---|
| `$PNPM run verify-translation-pairing --write docs/development.md` | `recorded docs/development.i18n.yaml`（执行两次：初次新增该节后一次，验证措辞与锚点更正后一次） |
| `$PNPM run verify-translation-pairing --write packages/sdk/client/README.md` | `recorded packages/sdk/client/README.i18n.yaml` |
| `$PNPM run test:docs` | exit 1 —— `run-gates: 10 passed, 5 failed, 0 skipped`，与基线计数一致；失败门禁为 `markdown links`、`translation pairing`、`markdown wrap`、`agent note format`、`documentation standard tests` |

对五个失败门禁逐行核查了本 Phase 的文件。`translation pairing` 报告的是 `docs/wiki/**` 缺英文配对的页面、`packages/README.*` 与 `packages/sdk/server/README.*` —— 全部未经本 Phase 改动（已核实：`git status -s` 对它们均无输出；`apps/vscode-dsh/README.md`、`apps/vscode-dsh/tests/fixtures/screenshots/README.md`、`.agents/notes/implemented/architecture/2026-09-04-ide-profile-dual-channel.md` 与 `packages/specdev/command-specdev/README.md` 同样未被改动，其违规是继承来的）。`markdown links` 报告的是 `docs/wiki/**` 以及 `packages/ide/ide-bridge` 与 `packages/bundle/ide` 的两处 `README.zh.md` 锚点。**确实**由本 Phase 引入的一处违规已在 Phase 内修复：从 `docs/development.zh.md` 链接 `#node-environment` 失败，因为中文页在中文标题上没有显式锚点；在 `### Node 环境` 之上补 `<a id="node-environment"></a>` 后消除，最终 `test:docs` 输出中本 Phase 的文件零出现。
