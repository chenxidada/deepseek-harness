# Phase 1 实现摘要 — `phase-1-node-env-preflight`

| 字段 | 值 |
|---|---|
| Phase ID | `phase-1-node-env-preflight`（逐字复制自 `phase-plan.md` 的 DAG JSON） |
| 工作流 | `vscode-dsh-usable-loop` |
| 分支 | `impl-phase-1-node-env-preflight` — 任何编辑之前已用 `git branch --show-current` 核实；全部改动留在工作区，本 agent 除查看外不执行任何 git 命令 |
| 执行者 | implementer（子 agent）；仅自测 —— 判决权归独立的 reviewer 与 verifier |
| 日期（UTC） | 2026-09-15 |
| 版本 | **修复轮 2**，回应 `review.md` §二 的 **N1 / D-1 / D-2** 与 `verification.md` §7。上一版已由本 agent 在启动时归档到 `phases/phase-1-node-env-preflight/.archive/implementation-20260915T115405Z.md`（`implementation-zh-20260915T115405Z.md` 同理），属被取代而非删除。 |
| 完整读取的上游 | `spec.md`、`review.md`（§二 / §四）、`verification.md`（§7）、`review-correctness.md`、`review-design.md`、`review-connectivity.md`、`repo-exploration.md`、`requirements.md`、`design.md`（AD-4 词表）、`tech-debt-registry.md` |

范围：本轮只改三件事 —— 测试名与注释中的审查条目码（D-1）、非字符串 `dsh.nodeBin` 的机器可读归类（D-2）、AC-1(b) 的三处定位（N1），外加两处随动文档（`design.md` / `design-zh.md` 的 AD-4 词表、`tech-debt-registry.md`）。既有 Phase 1 实现未被推翻：每一处编辑都是新增，或对本 Phase 已拥有的一行做文本替换。§3–§5 承接第一轮内容，使本文件对 reviewer 自洽可读；行号均为本轮位移后实测所得。

## 1. 修复轮 2（N1、D-1、D-2）

### 1.1 总览

| # | 审查判决 | 状态 | 位置 |
|---|---|---|---|
| D-1 | 🟡 should-fix（design） | **已完成** | `apps/vscode-dsh/tests/node-env-guard.spec.ts:267`、`:685`、`:698`；`apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:144` |
| D-2 | 🟡 should-fix（design；connectivity 独立复现同一条） | **已完成** | `apps/vscode-dsh/src/auto-start-orchestrator.ts:27-43`；`apps/vscode-dsh/src/session-host.ts:42-53`；`apps/vscode-dsh/src/extension.ts:2172-2191`；`apps/vscode-dsh/tests/node-env-guard.spec.ts:729-747`；`design.md:186` + `design-zh.md:187` |
| N1 | 🟡 should-fix（correctness） | **已完成** | `apps/vscode-dsh/tests/node-env-guard.spec.ts:89-113`、`:476-482`、`:484-517` |

无任何条目被推迟。§5 记录本轮在三处刻意采用了与字面要求不同的做法及其理由。

### 1.2 D-1 —— 清除测试名与注释中的审查条目码

`AGENTS.md:144` 明文禁止保留 review history，而 `S*` / `M*` 条目码在本仓无既有惯例（`packages/client/ui-commands` 的 `S1` / `S2` 是变量名）。共清除 4 处，各处均保留其描述性文字：

| 位置 | 改前 | 改后 |
|---|---|---|
| `node-env-guard.spec.ts:267` | `probes a process-exec-path candidate in the Electron mode the spawn will use (S9)` | `probes a process-exec-path candidate in the Electron mode the spawn will use` |
| `node-env-guard.spec.ts:685` | `re-reads the setting on every start instead of caching the first value (S5, AD-9)` | `re-reads the setting on every start instead of caching the first value (AD-9)` |
| `node-env-guard.spec.ts:698` | `// M2: A cached resolution or setting value would still report the first path here.` | `// A cached resolution or setting value would still report the first path here.` |
| `auto-start-orchestrator.spec.ts:144` | `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4, M2)')` | `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4)')` |

`AD-*` 引用**全部保留**，因为它们是 `design.md` 的架构决策编号，属可引用契约且本模块已有先例（`session-host.ts:106` 引 AD-1，`extension.ts:2173` 引 AD-10）。扫描命令与结果见 §4.4。

### 1.3 D-2 —— 以 `invalid-setting` 承载非字符串选择类设置

**审查已核实的链条。** `readNodeBinSetting` 抛的是**裸 `Error`（无 `kind`）**；该调用位于 `createStartHostPort` 的 `start()` 内（`extension.ts:2255`），因此异常冒泡到 `startErrorKindOf`（定义于 `auto-start-orchestrator.ts:53`，在 `:226` 被调用），而该函数按构造只能返回 `START_ERROR_KINDS` 的成员，于是无 `kind` 的错误被归一化为 `process-failed`。用户可见文案本已正确（`dsh.nodeBin must be a path to a Node.js executable string, got number`），说谎的只是机器可读字段，且当时没有任何断言覆盖它。

**本轮改动。**

1. `START_ERROR_KINDS`（`auto-start-orchestrator.ts:27-32`）新增 `'invalid-setting'`。该数组是词表的唯一真相源：`:43` 由它派生 `StartErrorKind`，`session-host.ts:53` 声明 `HostStartErrorKind = StartErrorKind`，因此类型、运行时 guard 与 host 抛出的类不可能彼此漂移。
2. `readNodeBinSetting`（`extension.ts:2180-2191`）改抛 `HostStartError('invalid-setting', …)` 而非裸 `Error`，该类因此能到达 `startErrorKindOf` 并被原样透传。`HostStartError` 原本就从 `session-host.ts` 导入，其 `.kind` 字段正是 guard 读取的对象。
3. `node-env-guard.spec.ts:729-747` 断言的是 **orchestrator 快照**而非错误文本：以 `get('nodeBin') === 42` 激活后，`dsh.test.requestStart` 快照必须 `state === 'failed'` 且 `errorKind === 'invalid-setting'`（`:744`），消息必须点出设置名与实际收到的类型，并且 `IdeSessionHost.prototype.start` 不得被调用。上一轮指出的缺口正是这条断言缺失。

**词表决策与理由。** 新增成员而**未**复用 `node-environment`。`session-host.ts:62` 载有不变式「Pre-flight diagnostic; present exactly when `kind` is `node-environment`」，第 2 轮审查也确认该不变式正确；而取值类型错误的设置根本没有 pre-flight diagnostic —— 从未探查过任何解释器 —— 复用 `node-environment` 会使 `diagnostic` 变成「必填却必缺」，从而破坏该不变式。新成员也符合本模块既有先例：`missing-credentials` 同样既非 Node 也非 process 类。`process-failed` 仍保留为唯一的通用成员：审查要求的是取消 `'start-failed'` 作为万能类（第 1 轮已完成），并非取消通用成员，且 Phase 2 的 spec 对未分类失败明确断言 `process-failed`。

**文档三处同步、词表一致。** `StartErrorKind` 的 JSDoc（`auto-start-orchestrator.ts:34-42`）与 `HostStartErrorKind` 的 JSDoc（`session-host.ts:42-52`）均已点出 `invalid-setting` 及其含义；`design.md:186` 与 `design-zh.md:187` 的 AD-4 词表现读作既有的 `missing-credentials` / `process-failed`，加本工作流新增的 `node-environment` / `invalid-setting`（Phase 1）与 `spawn` / `handshake-timeout` / `bridge-listen`（Phase 2）。

**穷尽性。** 仓库内不存在对 `StartErrorKind` 的 `switch`；唯一按它分支的消费点是 `connection-ui.ts:140`，其对 `'missing-credentials'` 做**等值判断**以决定是否提供凭据深链。因此 `invalid-setting` 正确地走非凭据分支 —— `dsh.nodeBin` 类型错误不是凭据问题 —— 也没有任何地方需要补 `default:`。`typecheck` 退出码 0（§4.1），这是「无联合成员被漏处理」的机械确认。

### 1.4 N1 —— AC-1(b) 在三处文档化位置定位被 pin 的版本

`spec.md:43` 的 AC-1 验证策略 (b) 要求用 `.nvmrc` 的版本在 `/usr/local/n/versions/node/<v>`、`~/.nvm/versions/node/v<v>`、`command -v node` 三处定位，并对定位到的解释器调用 `validateNodeEnvironment`。原用例名为 `AC-1 a, b`，但其 (b) 段断言的是 `process.execPath`，于是在没装该版本的机器上照样通过 —— AC 的**要求**（恰一行、合法 semver、被 range 接纳）被覆盖了，**验证步骤**没有。

现拆为两条，名字与实际断言一一对应：

- `node-env-guard.spec.ts:476-482` —— **AC-1 a**：`.nvmrc` 恰有一行非空内容，匹配 `^\d+\.\d+\.\d+$`，且 `rangeAdmits(EXPECTED_NODE_RANGE, pinned)` 为真。
- `node-env-guard.spec.ts:484-517` —— **AC-1 b**：`pinnedInstallRoots(pinned)`（`:89-101`）给出两个以版本命名的根，`nodeOnPath()`（`:103-107`）解析 `command -v node`。两个以版本命名的根按路径即命中（路径本身即含版本）；`PATH` 不以版本命名，故必须由 `reportedVersion()`（`:109-113`）报告出被 pin 的版本才算命中。对每一个定位到的解释器都调用 `validateNodeEnvironment`，并断言 `validation.ok === true`（`:512`）**且** `validation.report.version === pinned`（`:514`）—— 后者才是本条真正要证明的事：证明的是被 pin 的那个版本，而不是任意一个能跑的 Node。
- 三处均未定位到时，`ctx.skip`（`:502-505`）把用例报为 **skipped**，消息中写明被 pin 的版本与三处已查路径。这对应 spec.md 的「以非 PASS 结束并在 `verification.md` 写明」，而非静默通过。

原先挂在 AC-1 名下的「本机解释器可通过 pre-flight」这条前向覆盖断言**未**重新挂回 AC-1；它由本 Phase 自己的 AC-4 用例与第一轮真机探针（§4.5）承担。`spec.md` 与 `.nvmrc` 均未被改动。

## 2. 变更清单

### 2.1 新增文件（本 Phase）

| 路径 | 行数 | 用途 |
|---|---:|---|
| `.nvmrc` | 1 | `24.3.0` —— AC-1 所需的机器可读 Node 声明。本轮未改。 |
| `apps/vscode-dsh/src/node-env-guard.ts` | 303 | 唯一 pre-flight 入口：`validateNodeEnvironment()`、抛错包装 `assertNodeExecutable()`、失败分类法、五元素诊断渲染、可执行/权限探查，以及按调用方模式以真实子进程运行候选解释器的能力探查。本轮未改。 |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` | 748 | 28 条运行时用例。**本轮改动**：AC-1 定位辅助函数与 AC-1(a)/(b) 拆分（N1）、`invalid-setting` 快照断言（D-2）、三处条目码清除（D-1）。 |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts` | 327 | 7 条运行时用例，验证 spawn 顺序契约：gate → `bridge.listen` → spawn，spawn 通过见证文件观测而非 mock。本轮未改。 |

### 2.2 修改文件（含各轮；★ = 本轮改动）

| 路径 | 变更 |
|---|---|
| ★ `apps/vscode-dsh/src/auto-start-orchestrator.ts` | `START_ERROR_KINDS` 新增 `invalid-setting`，其 JSDoc 点明该成员（D-2）。第 1 轮引入该数组作为共享词表、`startErrorKindOf` guard，以及 `:226` 处对抛出类的投影。 |
| ★ `apps/vscode-dsh/src/session-host.ts` | `HostStartErrorKind` 的 JSDoc 点明 `invalid-setting` 并表示该类归属于设置取值（D-2）。第 1 轮新增 `HostStartError` 载体、`nodeExecutable` / `nodeBinSetting` 选项、`resolve → assertNodeExecutable → bridge.listen → client start` 顺序，并令通用 catch-all 抛 `process-failed`。 |
| ★ `apps/vscode-dsh/src/extension.ts` | `readNodeBinSetting` 改抛 `HostStartError('invalid-setting', …)`，其 JSDoc 点明该类（D-2）。第 1 轮新增 `VsCodeLike.workspace.getConfiguration`、设置读取，以及把 `nodeBinSetting` 传给 `IdeSessionHost.start`。 |
| `apps/vscode-dsh/src/node-env-guard.ts` | 第 1 轮：探查改为接收已解析的可执行对象，并在 `electronRunAsNode` 候选上注入 `ELECTRON_RUN_AS_NODE=1`；`process-exec-path` 的补救文案改为点名可执行文件的归属方与两个可用杠杆，不再提 `PATH`。本轮未改。 |
| `apps/vscode-dsh/src/index.ts` | 对 guard 类型、常量、错误类与 `HostStartError` 做加性再导出。 |
| `apps/vscode-dsh/package.json` | `apps/` 下首个 `contributes.configuration` 块：`dsh.nodeBin` 字符串属性，含 `default`、`scope`、`description`、`markdownDescription`。 |
| ★ `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | describe 标题中的 `M2` 条目码已清除（D-1）。第 1 轮新增 `SameSet` 词表钉定与三条分类用例。 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`、`phase2-auto-ready.spec.ts`、`phase4-new-conversation-chrome.spec.ts` | 各自的鸭子类型 `vscode` 替身补上 `workspace.getConfiguration('dsh')`，使扩展新增的设置读取不会在早于它的测试套件中抛错（各 5 行）。 |
| `packages/sdk/client/src/types.ts`、`src/launch.ts`、`src/index.ts` | `ResolvedNodeExecutable` / `NodeExecutableRequest` / `NodeExecutableSource` 与唯一的 `resolveNodeExecutableSpec()` 入口（全部为加性）。 |
| `packages/sdk/client/tests/launch.spec.ts` | 扩展（非替换）新增 11 条用例，覆盖三级来源、Electron 交互与边界输入。 |
| `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | 新增「Choosing the Node executable」小节；配对已记录。 |
| `docs/development.md` + `development.zh.md` + `development.i18n.yaml` | 新增 `### Node environment` 小节与 AC-3 两份清单；第 1 轮为该小节的 reload 步骤补上命令 token，并修正「谁声明下限」的措辞；配对已记录。 |
| ★ `design.md` + `design-zh.md` | AD-4 词表现完整枚举 `StartErrorKind` 的全部成员，含 `invalid-setting`（D-2）。 |

### 2.3 工作区中已修改/未跟踪，但**不属于本 Phase**

列出以免 HG-3 把它们算进 Phase 1。以下文件均未被本 Phase 打开写入。

| 路径 | 状态 | 说明 |
|---|---|---|
| `pnpm-lock.yaml` | 已修改 | 既有改动；本 Phase 全程未执行安装（一律带 `--config.verify-deps-before-run=false`）。 |
| `apps/vscode-dsh/webview/dist/assets/index.{css,js}` | 已修改 | 既有 webview 构建产物。 |
| `.cursor/skills/project-build/SKILL.md`、`.specdev/specs/workflows.json` | 已修改 | 既有改动。 |
| `.cursor/**`、`.trae/**`、`.explore/`、`.mcp.json`、`opencode.jsonc`、`docs/wiki/**`、`.wiki-work/` | 未跟踪 | 既有的工具/配置/知识库目录树。 |
| `packages/**/src/*.d.ts`、`*.js`、`*.js.map`、`*.d.ts.map`（数千个） | 未跟踪 | 树内构建残留，也是红色 `lint` 基线的主要成分；非本 Phase 产生。 |

## 3. 验收标准覆盖

| AC | 实现位置 | 证明手段 |
|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0`；`EXPECTED_NODE_RANGE` 镜像根 `engines.node` | **(a)** `node-env-guard.spec.ts:476-482` —— 恰一行 semver 且 `rangeAdmits('^22.19.0 \|\| >=24.0.0', pinned)`。**(b)** `:484-517` —— 两个以版本命名的根与 `command -v node`，对每个定位到的解释器调用 `validateNodeEnvironment`，要求 `ok:true` **且** `report.version === pinned`；三处皆无时报 skipped 并写明 pin 版本与三处路径。**(c)** `:519-528` —— 两份开发者文档均含 `.nvmrc`、pin 版本、`DSH_NODE_BIN` 与 `dsh.nodeBin`。另有 *keeps the enforced range identical to the root engines field*：`engines.node` === `EXPECTED_NODE_RANGE`。 |
| AC-2 | `docs/development.md` 的 `### Node environment` 小节（含中文对照） | 该小节写明下限（22 线上为 22.19，24 及以后）、声明文件（根 `package.json` 的 `engines.node`）、两个 API（`zlib.createZstdDecompress`、`Promise.withResolvers`），并把 API 与 `.jsonl.zstd` 会话日志关联起来。 |
| AC-3 | 同小节的两份清单 | **实现：** *Repository-side responsibilities* 为 5 行表格，每行都带可判定命令；*Local-environment responsibilities* 拆为 *Terminal side*（3 条）与 *Extension subprocess side*（3 条，含用 `workbench.action.reloadWindow` 重载窗口）。无任何条目把两侧并成一条指令。**证明：** `:530-548` 对两份语言文件断言四个标题各出现恰一次、且每条 local-environment 条目都带有 `DECIDABLE_ENTRY_TOKENS` 中的可判定 token；同一条用例随后逐个删除 face 标题并要求它自己的断言抛错 —— 因此任一侧不再单独列出时，(a) 与 (b) 都会失败。 |
| AC-4 | `node-env-guard.ts` 的 `validateNodeEnvironment()`，由 `IdeSessionHost.start()` 在 `bridge.listen` 之前调用；三级来源都经由 `resolveNodeExecutableSpec()`，故一道 gate 覆盖全部来源 | (a) `inspectExecutableFile()` 检查存在、是常规文件、具备 `X_OK`；(b) `probeNodeApis()` 以真实子进程运行候选者并索要 `zlib.createZstdDecompress` 与 `Promise.withResolvers`。用例：对本机合格 Node 的正向报告；`missing`；`not-executable`；由 `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}` 替身产生的 `missing-apis`（消息列出两个 API 名）；以及 §4.4 的 `electronRunAsNode` 用例。 |
| AC-5 | `resolveNodeExecutableSpec()` 先读 `DSH_NODE_BIN`，且只把空字符串视为未设置 | `launch.spec.ts`：环境变量已设 → `{source:'dsh-node-bin'}`，且即便 `process.versions.electron` 有定义也不出现 `ELECTRON_RUN_AS_NODE`；环境变量与设置同时非空 → 环境变量胜出；该不对称由「空 `DSH_NODE_BIN` 视为未设置并下落到设置」与「纯空白 `DSH_NODE_BIN` 按原值使用」两条钉定。`session-host-preflight.spec.ts`：`DSH_NODE_BIN` 指向真实 shim → shim 被运行且真实 Node 子进程运行了 runtime 脚本；而不可用的设置从未走到 spawn。 |
| AC-6 | 第 3 级是 `process.execPath`；`electronRunAsNode` 仅在 Electron 下对该来源为真 | `launch.spec.ts`：Electron host + 无环境变量 + 空设置 → `{source:'process-exec-path', electronRunAsNode:true}` 且 `ELECTRON_RUN_AS_NODE === '1'`；注入 `PATH` 的 shim `node` 被断言不得成为被 spawn 的可执行文件。该级诊断中不出现 `PATH`。 |
| AC-7 | `start()` 顺序为 gate → `bridge.listen` → spawn | `session-host-preflight.spec.ts`，分别针对来自 `DSH_NODE_BIN` 的不可用候选，以及来自设置的缺失与不可用候选：`start()` 以 `kind === 'node-environment'` 拒绝，证明有子进程运行过的见证文件保持缺失，`existsSync(bridgeSockPath)` 为 false，`host.status === 'error'`，且耗时远低于配置的 60 000 ms `initializeTimeoutMs`（断言 < 5 000 ms）—— 因此该失败既不是「先 spawn 再崩」，也不是握手超时。 |
| AC-8 | `formatNodeEnvironmentDiagnostics()` 恰渲染五行，每元素一行 | 每种失败类都产出五行消息，且五条消息两两不同。`process-exec-path` 的消息被断言包含候选路径、检出运行版本、期望区间（`22.19` 与 `24` 均在）、缺失的 API 名，以及两个授权输入。扩展层面，失败启动的用户可见消息被断言包含违规路径与 `dsh.nodeBin`。 |
| AC-9 | 文案把失败归类为 Node 环境问题；载体为 `NodeEnvironmentError` 与 `HostStartError{kind:'node-environment'}`，且该类原样到达 orchestrator 快照 | 首行诊断包含 `Node environment`；消息给出检出运行版本与期望区间，只提供环境侧修法；无任何诊断把失败归咎于 dsh 代码。该跳变在两层均有断言：`auto-start-orchestrator.spec.ts:150-176`（port → 快照）与 `node-env-guard.spec.ts:722`（真实激活 → 快照）。非 Node 类现在也能穿过该跳变：`invalid-setting` 见 §1.3，未分类失败则为 `process-failed`。 |
| AC-10 | (a) `apps/vscode-dsh/package.json` 的 `contributes.configuration.dsh.nodeBin`；(b) 文档化的优先级；(c)–(e) 运行时 | (a) 声明为 `string`，默认 `""`，描述写明优先级与「留空」。(b) `docs/development.md`（含中文）写明 `DSH_NODE_BIN` > `dsh.nodeBin` > Extension Host Node。(c) 仅设置 → `{source:'vscode-setting'}`，且 gate 校验的对象正是交给 `resolveDshLaunch` 的对象。(d) 设置指向缺失路径 → 拒绝，`kind === 'node-environment'`，无见证文件，无 bridge socket，`status === 'error'`，且 `resolveNodeExecutableSpec` **恰好被调用一次**。(e) 扩展从真实 `settings.json` 读取 `workspace.getConfiguration('dsh').get('nodeBin')`，把该值显式传给 host，空值原样透传，下一次启动重新读取而非缓存，并在任何 host 存在之前把非字符串取值归类为 `invalid-setting`（`node-env-guard.spec.ts:729-747`）。 |

**跨 Phase 依赖（AC-10 f）。** AC-10 的真机分支 —— 预置 `settings.json` 在真实 Extension Development Host 内被解析链消费 —— 按 AD-11 由 Phase 3 的 smoke 脚本提供。Phase 1 只判 (a)–(e)，不认领该分支。

**invalid-setting 分支的证据切分。** (i) *代理证据*：运行后 `settings.json` 逐字节不变，说明扩展是消费该设置而非把它改写成别的来源。(ii) *非代理的反向证据*：所有 spawn 标记的缺失 —— 见证文件、bridge socket、`status === 'error'`，并且断言 `start()` 从未被调用。产品代码未新增任何观测点；调用计数由测试通过对导入模块命名空间的 spy 完成。

## 4. 测试证据

全部命令在 `/workspace/chendecheng/code/need/deepseek/deepseek-harness` 下、先执行 `export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"`，并带 `pnpm --config.verify-deps-before-run=false`（下文简写 `$PNPM`）。

### 4.1 差量结果（Phase 1 的验收本位）

| 命令 | spec 基线 | 本轮实测 | 新增失败 |
|---|---|---|---|
| `$PNPM run typecheck` | 绿 | **退出码 0**（`tsc -b tsconfig.client.json`） | 无 |
| `$PNPM run test packages/sdk/client` | 绿（3 文件 / 73 用例） | 绿，退出码 0 —— `Test Files 3 passed (3)`，`Tests 84 passed (84)` | 无 |
| `$PNPM run test apps/vscode-dsh packages/sdk/client` | app 套件 48 文件 / 320 用例，**4 文件 / 6 用例红** | 退出码 1 —— `Test Files 4 failed \| 49 passed (53)`，`Tests 6 failed \| 435 passed \| 1 skipped (442)` | 无 —— 同为那 4 个文件、同为那 6 个用例 |
| `$PNPM run lint` | 红 | 退出码 1 —— **10 382** 条诊断，与上一轮实测总数一致；`extension.ts` 22 条、`auto-start-orchestrator.ts` 1 条（`:236`）、`session-host.ts` 1 条（`:597`）、`node-env-guard.spec.ts` **0** 条 | 无（见 §4.3） |
| `$PNPM run test:docs` | 红 —— `run-gates: 10 passed, 5 failed, 0 skipped` | 红 —— `run-gates: 10 passed, 5 failed, 0 skipped in 27.53s`，同为那五个 gate（`markdown links`、`translation pairing`、`markdown wrap`、`agent note format`、`documentation standard tests`） | 无；对输出执行 `grep -cE "development\.(md\|zh\.md)"` 返回 **0** |
| `$PNPM run test <path>`（带 `--`） | 不可用 —— 会跑全量语料 | 按 spec 要求未使用 | — |

四个红色 app 套件文件与基线在身份与数量上完全一致：`spike-t0b-continue-capability.spec.ts`（整套，根因 `Cannot read properties of undefined (reading 'UNLOADING')`，位于 `packages/core/agent-loop/src/index.ts:40`）、`spike-t0a-replay-rebuild.spec.ts`（4 用例，`Cannot read properties of undefined (reading 'PENDING')`，位于 `scripts/test-invariants.ts:88`）、`panel-close-delete.e2e.spec.ts`（1 用例）、`verifier-phase1/layer-a-rtl.spec.tsx`（1 用例）。均非本 Phase 触及的文件。用例总数由 441 升至 442，因为 N1 把一条拆成了两条。

### 4.2 本 Phase 自有用例

| 命令 | 结果 |
|---|---|
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | `Test Files 4 passed (4)`，`Tests 70 passed (70)`，退出码 0 |
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts --reporter=verbose` | `Tests 28 passed (28)`，退出码 0 |

N1/D-2 三条用例的 verbose 原文：

```
✓ … > node environment diagnostic (AC-8, AC-9) > pins exactly one machine-readable version that the declared range admits (AC-1 a) 1ms
✓ … > node environment diagnostic (AC-8, AC-9) > locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) 53ms
✓ … > node environment diagnostic (AC-8, AC-9) > names the pinned release in both developer docs (AC-1 c, AC-3) 1ms
✓ … > extension reads dsh.nodeBin (AC-10 e) > re-reads the setting on every start instead of caching the first value (AD-9) 3ms
✓ … > extension reads dsh.nodeBin (AC-10 e) > classifies a non-string setting as invalid-setting, not a process failure 1ms
```

AC-1(b) 耗时 53 ms 本身就是证据：它确实 spawn 了定位到的解释器，而不是读一个常量。所有 AC-4 / AC-7 / AC-8 / AC-9 / AC-10 运行时用例都先构造输入、再执行、再断言输出；无一条是静态断言。

### 4.3 lint 差量（按文件实测）

`$PNPM run lint`（gate：`tsx scripts/run-oxlint.ts .`，权威规则集为 `.oxlintrc.json`）在基线与现在都退 1，产出 **10 382** 条诊断 —— 与上一轮实测总数相同。本 Phase 触及文件的分项：

| 文件 | 诊断数 | 是否落在本 Phase 新增行上？ |
|---|---:|---|
| `apps/vscode-dsh/src/node-env-guard.ts`（新增） | 0 | — |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts`（新增） | 0 | —（含本轮新增的 24 行定位辅助与断言） |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts`（新增） | 0 | — |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 1 —— `:236:24`（`no-non-null-assertion`） | 否 —— 新增区间为 `26-61` 与 `226`；`:236` 是 `more[more.length - 1]!`，文本未变，本轮新增六行前位于 `:230` |
| `apps/vscode-dsh/src/session-host.ts` | 1 —— `:597:3`（`require-await`） | 否 —— 新增区间为 `14`、`16`、`27`、`29`、`42-81`、`108-111`、`255-256`、`287-292`、`302`、`323-329` |
| `apps/vscode-dsh/src/extension.ts` | 22 —— `:271`、`:375`、`:380`、`:385`、`:407`、`:425`、`:662`、`:750`、`:1004`、`:1102`、`:1152`、`:1418`、`:1450`、`:1492`、`:1534`、`:1791`、`:2109`（2 条）、`:2110`、`:2111`、`:2272`、`:2274` | 否 —— 新增区间为 `34`、`48`、`223-236`、`2172-2192`、`2255`、`2258`；22 条全部落在区间之外 |
| `apps/vscode-dsh/src/index.ts` | 1 —— `:97:3`（`no-deprecated`） | 否 —— 新增区间为 `25-39` |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | 4 —— `:52:39`、`:53:9`、`:95:36`、`:96:9` | 否 —— 新增区间为 `8`、`12-15`、`143-177`；4 条都在既有的 `mockPort` 辅助函数内 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`、`phase2-auto-ready.spec.ts`、`phase4-new-conversation-chrome.spec.ts` | 2 / 15 / 11 | 否 —— 新增区间为 `70-74`、`49-53`、`75-79` |
| `packages/sdk/client/{src/launch.ts,src/types.ts,src/index.ts,tests/launch.spec.ts}` | 0 | — |
| `apps/vscode-dsh/package.json` | 0 | — |

新增区间读自 `git diff -U0` 的 hunk 头（因未提交，此为第 1–2 轮的累计结果）。在缩减规则集（`.oxlintrc.staged.json`，即 `lint:fix` 所用）下 `extension.ts` 为 **3** 条，且同样都在未改动代码上；本报告给出两条命令各自产生的数值而不做取舍，零新增结论在任一规则集下都成立。

### 4.4 证伪探针（本轮的运行时主张）

每支探针都只改一个文件、跑同一条命令、记录变红结果，随后恢复文件并再次确认变绿。无任何残留：恢复后 spec 文件的 `sha256` 为 `6ccde32118ced45094069c10e8ac4016eca350a42904f042c810fc131dd0cacb`，与探针前完全一致；对探针标记（`// PROBE N1`、`// PROBE D-2`）的扫描无命中。

| 主张 | 施加的变异 | 观测结果（原文片段） | 已恢复 |
|---|---|---|---|
| **D-1** —— 条目码已清除且 `AD-*` 未受损 | 无需变异；探针即该条目自身规定的扫描，外加一条反向检查确认保留的引用仍在 | `grep -rnE '\((S[0-9]+\|M[0-9]+)[,)]\|// *(S\|M)[0-9]+:' apps/vscode-dsh/` → **无输出，退出码 1**。`grep -rnE 'AD-[0-9]+' apps/vscode-dsh/src/*.ts` 仍列出 `auto-start-orchestrator.ts:38`（AD-4）、`extension.ts:224`/`:2173`（AD-10）、`session-host.ts:51`/`:108`（AD-4/AD-1）、`node-env-guard.ts:111`/`:152`/`:250`（AD-2/AD-1/AD-1） | 无需 |
| **D-2a** —— 新类必须是词表成员，而非通用类的改名 | 从 `START_ERROR_KINDS` 移除 `'invalid-setting'`，使抛出的类回落到通用成员 | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts -t "invalid-setting"` → 退出码 1，`Tests 1 failed \| 27 skipped (28)`，`AssertionError: expected 'process-failed' to be 'invalid-setting' // Object.is equality` | 是 |
| **D-2b** —— 类必须由来源携带，而非由 guard 猜出 | 把 `readNodeBinSetting` 改回 `throw new Error(…)`（即修复前无 `kind` 的形态） | 同一命令 → 退出码 1，`Tests 1 failed \| 27 skipped (28)`，`AssertionError: expected 'process-failed' to be 'invalid-setting' // Object.is equality` | 是 |
| **N1-P1** —— 用例必须校验**定位到的**解释器，而非任意能跑的 Node | 把 AC-1(b) 用例的版本钉为 `22.14.0`，该版本已装于 nvm 根下但缺 API | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts -t "AC-1 b"` → 退出码 1，`× locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b)`，`AssertionError: ~/.nvm/versions/node/v22.14.0/bin/node (/home/chendc/.nvm/versions/node/v22.14.0/bin/node) was rejected by the pre-flight: expected false to be true` | 是 |
| **N1-P2** —— 无该版本安装必须以非 PASS 结束，而旧形态会通过 | 把同一用例钉为 `24.4.0`，该版本本机各处均未安装 | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts -t "AC-1 b" --reporter=verbose` → 退出码 0，输出 `↓ … locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) 15ms [no install of 24.4.0 to locate; checked /usr/local/n/versions/node/24.4.0/bin/node=absent; ~/.nvm/versions/node/v24.4.0/bin/node=absent; command -v node=/usr/local/n/versions/node/24.3.0/bin/node (24.3.0)]`，并 `Tests 28 skipped (28)`。对照上一轮的 AC-1 用例：它断言 `process.execPath`，在同样变异下会报 **pass** —— 这正是 N1 指出的缺口 | 是 |

恢复之后：`$PNPM run typecheck` 退出码 0，§4.2 的四文件命令报 `Tests 70 passed (70)`，退出码 0。

### 4.5 真机探针（第一轮证据，仍然现行）

通过 `tsx` 运行已编译模块并调用 `validateNodeEnvironment({path, source, electronRunAsNode:false})`，经真实 guard 探查：

| 解释器 | 报告版本 | `hasZstd` | `hasWithResolvers` | 判定 |
|---|---|---|---|---|
| `/usr/local/n/versions/node/24.3.0/bin/node` | 24.3.0 | true | true | `ok:true` |
| `/usr/bin/node` | 18.12.1 | false | false | `missing-apis`，两个名字均列出 |
| `~/.nvm/versions/node/v22.14.0/bin/node` | 22.14.0 | false | true | `missing-apis`，仅列 `zlib.createZstdDecompress` |
| `/usr/local/n/versions/node/22.9.0/bin/node` | 22.9.0 | false | true | `missing-apis`，仅列 `zlib.createZstdDecompress` |

后两行同时也是 AD-2 的演示：这些解释器低于声明下限，但报告的类仍是 `missing-apis` 并列出 API 名，从不出现基于版本号的拒绝。另有两个真机测量：

| 探针 | 实测 |
|---|---|
| `env -i PATH=/usr/bin:/bin sh -c 'command -v node; node --version'` | `/usr/bin/node`，`v18.12.1` |
| `PATH="/usr/bin:/usr/local/node/bin:$PATH" $PNPM run typecheck` | 退出码 1，`ERROR: This version of pnpm requires at least Node.js v22.13` |

## 5. 偏差与同该 Phase 既定前提的冲突

1. **D-2 采用新增词表成员的方式满足，而非复用 `node-environment`。** 理由见 §1.3：`session-host.ts:62` 的诊断不变式会被破坏。这是对该指令意图（「一个独立的机器可读类」）的刻意落实，而非最短编辑。
2. **N1 未把 AC-1(b) 原先对 `process.execPath` 的断言重新挂到 AC-1 名下。** 重新挂回会把该 AC 重新焊死在本机安装的版本上；那项观测由 AC-4 的前向覆盖与 §4.5 的探针承担。
3. **D-1 额外清除了 `auto-start-orchestrator.spec.ts:144` 的 describe 标题中的条目码**，超出审查列出的三处，因为同一规则适用，且审查文本本身点名了该文件。
4. **`process-failed` 保留为唯一通用成员。** 第 1 轮取消了 `'start-failed'` 作为万能类，这正是审查要求；而 Phase 2 的 spec 对未分类失败断言 `errorKind === 'process-failed'`，删除该成员会破坏已获批的下游 spec。
5. **本 Phase 首版曾违反 AD-2，已在第 1 轮修正。** 最初的 `node-env-guard.ts` 按版本字符串设闸（`unsupported-version`）；AD-2 规定闸门由能力决定，且 AC-4(c) 要求 `{"version":"20.16.0",…}` 替身归类为 `missing-apis`。版本比较已删除，能力测试顺序已相应重排。
6. **存在第四种失败类 `unusable`，超出 spec 点名的三种。** 它覆盖「存在且可执行、但无法报告 Node 能力」的候选者（非零退出、非报告输出或超时）。并入 `missing-apis` 会打印从未观测到的 API 名。spec 并未规定封闭分类法。
7. **空白字符串的不对称是刻意的，且与 spec 的边界清单一致。** `DSH_NODE_BIN='   '` 视为*已设置*（按原值使用，随后被闸门大声拒绝），而 `dsh.nodeBin='   '` 视为*未设置*并下落到下一级。
8. **`docs/development.md` 的验证措辞已在第 1 轮修正。** 首版声称解释器超出 `engines.node` 时 `pnpm run typecheck` 会拒绝启动；实测（§4.5）显示拒绝来自 pnpm 自身的下限（22.13），且本机干净 `PATH` 解析到的是 `/usr/bin/node` v18.12.1，而非 spec 快照所称的 v20.16.0。
9. **与 spec 快照不同的机器事实。** spec 称 `/usr/local/n/versions/node/24.3.0` 是唯一合格安装；本机 `/usr/local/bin/node` 是第二个真实的 v24.3.0 二进制，`~/.nvm/versions/node/v20.16.0` 存在但并非干净 `PATH` 所解析的对象。两者都不影响实现，且 AC-1(b) 现按版本定位而非按硬编码单一路径，因此两种情况都能容忍。
10. **两份清单标题与两个 face 标题是加粗引导语，不是 ATX 标题**，遵循 `docs/development.md` 中同类内容的本仓风格。结构化断言匹配的是标签文本，故与强调标记无关。
11. **`HostStartError` 是加性的，但改变了所有 `start()` 失败的抛出类**，现覆盖 `invalid-setting`、`node-environment` 与 `process-failed`。既有 app 套件仍通过；该类型已导出，调用方可据此判别。
12. **`contributes.configuration` 另带 `title`**（第 1 轮加入）：必需部分只有属性块；title 用于在 VS Code 设置界面内分组。
13. **未移除任何已发布名称。** `resolveNodeExecutable()` 在 HEAD 上对 `launch.ts` 私有，故以 `resolveNodeExecutableSpec()` 取代它不改变公开面。
14. **`dsh.nodeBin` 属性带有两个超出最小要求的键**：`"scope": "machine-overridable"`（因为违规取值属机器属性），以及 `"markdownDescription"`（使设置界面把 API 名与区间渲染为代码）。
15. **设置以显式输入路由给 host，而非隐式读取。** `extension.ts:2255-2258` 读取后传给 `IdeSessionHost.start`，因为 host 也在无 VS Code 环境下被演练、SDK 已把同一输入建模为请求对象，且 `readNodeBinSetting` 对未设置返回 `undefined`，使「未设置」与「空字符串」在编辑器边界保持可区分。
16. **「为 Phase 2 预留的诊断注入点」是三处既有类型化表面**，而非新 sink：`IdeSessionHost.onError`、`AutoStartOrchestrator.getSnapshot()` / `onChange()`、`HostStartError{kind, diagnostic}`。sink 类型、其六类 `HostFailureKind` 词表与脱敏策略仍归 Phase 2 所有。
17. **`StartErrorKind` 在第 1 轮丢弃了 `'other'` 成员。** 同时保留 `'other'` 与 `process-failed` 会留下两个通用类。`'other'` 仍存在于 Phase 2 的记录词表中，那是另一 Phase 的另一类型。

## 6. 未决事项与风险

1. **AC-10(f)**（真实 Extension Development Host 消费预置 `settings.json`）按 spec 要求仍是 Phase 3 的义务。不得据此判定 Phase 1 完成或不完成。
2. **未运行 `$PNPM run doc-sync`**：spec 把首次 `test:docs` 归本 Phase，把 `doc-sync` 留给 Phase 4 复查。
3. **红色 `lint` 基线按设计未触碰。** 其成分是树内构建残留（未跟踪的 `packages/**/src/*.d.ts` 与 map）以及 `apps/vscode-dsh/tests/**` 中既有的 `no-unsafe-*` / `no-unnecessary-*` 类问题，其结构性成因是 `apps/vscode-dsh/tsconfig.json` 只 include 了 `src`，使这些测试文件落在任何 TypeScript program 之外。修复该类问题会改变本 Phase 必须保持绿色的 `typecheck` 基线。
4. **`apps/vscode-dsh` 没有覆盖率门禁**，而 `packages/sdk/client` 保留逐文件 100% 要求。本 Phase 未给 SDK 增加未覆盖分支。
5. **`unusable` 是唯一依赖子进程行为的分类**（退出码、输出、超时），因此也是「仅靠单测的回归」可能藏身处。它由真实非零退出的替身与 `electronRunAsNode` 用例覆盖；超时分支未单独演练，因为诱导它需要一个长运行 fixture。
6. **AC-1(b) 按设计依赖环境。** 在没有安装被 pin 版本的机器上，它报 skipped 而非 passed，verifier 必须把该结果记为非 PASS 而非成功 —— 这正是 spec 验证策略的要求。本机上它通过，实际执行了 `/usr/local/n/versions/node/24.3.0/bin/node` 以及 `command -v node` 所解析到的同一解释器。
7. **app 套件红色集合在成员上受并发影响，但在数量上稳定。** 四文件六用例在本文记录的每次运行中都与基线一致，但两条单用例失败属于同一类共享资源族、会在运行间变化。verifier 若读到不同的两条，应比对总数与根因，而非只看名字。

## 7. 文档门禁（实际执行的命令）

| 命令 | 结果 |
|---|---|
| `$PNPM run test:docs` | 退出码 1 —— `run-gates: 10 passed, 5 failed, 0 skipped in 27.53s`，与基线计数及上一轮的失败五项完全一致（`markdown links`、`translation pairing`、`markdown wrap`、`agent note format`、`documentation standard tests`） |
| 对 `test:docs` 输出执行 `grep -cE "development\.(md\|zh\.md)"` | **0** —— 本 Phase 的文档对未出现在任何违规清单中 |
| `$PNPM run verify-translation-pairing --write docs/development.md` | 第 1 轮曾为 M1 与 S7 的编辑记录；**本轮未重跑**，因为本轮未改动任何参与配对的文档正文 —— `design.md` / `design-zh.md` 是配对门禁之外的流程产物，其两行 AD-4 已在两种语言中做了一致修改 |

本轮未触任何配对文档。五个失败 gate 已逐行核对：`translation pairing` 报的是缺英文对照的 `docs/wiki/**` 页面与 `packages/**/README.*`，`markdown links` 报的是 `docs/wiki/**` 与 `packages/ide/ide-bridge`、`packages/bundle/ide` 中的两个 `README.zh.md` 锚点 —— 均非本 Phase 的文件。
