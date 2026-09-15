# Phase 1 实现摘要 — `phase-1-node-env-preflight`

| 字段 | 值 |
|---|---|
| Phase ID | `phase-1-node-env-preflight`（逐字复制自 `phase-plan.md` 的 DAG JSON） |
| 工作流 | `vscode-dsh-usable-loop` |
| 分支 | `impl-phase-1-node-env-preflight`（全部改动留在工作区；本 agent 未做任何 commit） |
| 执行者 | implementer（子 agent）；仅自测 — 判决权属于独立 reviewer 与 verifier |
| 日期（UTC） | 2026-09-15 |
| 版本 | 回炉第 1 轮，逐条回应 `review.md` 的 **MUST-FIX**（M1 + M2 + S1–S10）。本文件上一版已由本 agent 在启动时归档到 `phases/phase-1-node-env-preflight/.archive/implementation-20260915T100929Z.md`（`implementation-zh-20260915T100929Z.md` 同理），属被取代而非删除。 |
| 完整读取的上游 | `phases/phase-1-node-env-preflight/spec.md`、`review.md`、`review-correctness.md`、`review-design.md`、`review-connectivity.md`、`repo-exploration.md`、`requirements.md`（AC-1 – AC-10）、`design.md`（AD-1 – AD-11）、`tech-debt-registry.md`（只读交叉校验） |

本文件的范围：本轮回炉改了什么、每项改动服务哪条验收标准与哪条审查项，以及每个运行时论断背后的「命令 + 输出」证据。`tech-debt-registry.md` 未新增条目：本 Phase 不引入任何桩、占位或延后接线，registry 的既有条目也未被修改或重复注册。

## 1. 回炉逐条回应（M1、M2、S1–S10）

### 1.1 总览

| # | 判决 | 状态 | 位置 |
|---|---|---|---|
| M1 | 🔴 必须修 | **已做** | `docs/development.md:131`、`docs/development.zh.md:136`、`docs/development.i18n.yaml` |
| M2 | 🔴 必须修 | **已做** | `apps/vscode-dsh/src/auto-start-orchestrator.ts:26-55,220`、`apps/vscode-dsh/src/session-host.ts:27,42-51,327`、`apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:144-177`、`apps/vscode-dsh/tests/node-env-guard.spec.ts:666` |
| S1 | 🟡 应修 | **已做** | 本文件 §3 的 AC-4 行 |
| S2 | 🟡 应修 | **已做** | `apps/vscode-dsh/src/node-env-guard.ts:192-201`，断言在 `apps/vscode-dsh/tests/node-env-guard.spec.ts:415-417` |
| S3 | 🟡 应修 | **已做，并对数字作了实测更正** | 本文件 §4.3 |
| S4 | 🟡 应修 | **已做** | 本文件 §5.10 |
| S5 | 🟡 应修 | **已做** | `apps/vscode-dsh/tests/node-env-guard.spec.ts:629-646` |
| S6 | 🟡 应修 | **已做** | `apps/vscode-dsh/tests/node-env-guard.spec.ts:96-165,474-499` |
| S7 | 🟡 应修 | **已做** | `docs/development.md:105`、`docs/development.zh.md:110`，配对已重录 |
| S8 | 🟡 应修 | **已做** | 本文件 §5.11 |
| S9 | 🟡 应修 | **已做** | `apps/vscode-dsh/src/node-env-guard.ts:254-258`、`apps/vscode-dsh/tests/node-env-guard.spec.ts:240-267` |
| S10 | 🟡 应修 | **已做** | 本文件 §5.12 |

无一条跳过。§1.3 列出三处本轮**有意采用不同做法**的地方及其理由。

### 1.2 逐条细节

**M1 — AC-3(d) 命令记号。** `docs/development.md:131` 此前是纯叙述（"Reload the window after changing either …"）。现在点名了输入与重载动作的命令 id：*"Reload the window after changing either `dsh.nodeBin` or `DSH_NODE_BIN`: run `Developer: Reload Window` (`workbench.action.reloadWindow`) from the Command Palette. The extension reads the setting on every start and does not cache it."* 中文侧携带同一组记号（`Developer: Reload Window` / `workbench.action.reloadWindow` / `dsh.nodeBin` / `DSH_NODE_BIN`）。以 `$PNPM run verify-translation-pairing --write docs/development.md` 重录，`docs/development.i18n.yaml` 两侧哈希均已更新（见 §7）。随后 `$PNPM run test:docs` 计数为基线 `10 passed, 5 failed`，且输出中 `development.md` / `development.zh.md` **零出现**。

**M2 — 类型化 `node-environment` 穿过编排层不被压平。** 三处改动，全部落在归类路径上，未越界到 Phase 2 的诊断机制：

1. `StartErrorKind` 现在包含宿主真正抛出的类别。`apps/vscode-dsh/src/auto-start-orchestrator.ts:26-27` 只有一个数组 `START_ERROR_KINDS = ['missing-credentials', 'node-environment', 'process-failed']`，`:29-37` 由它派生 `StartErrorKind`，类型与运行时词表不可能漂移；此前未被使用的 `'other'` 万用成员已移除。
2. 捕获分支不再靠排除法压平。`:39-55` 新增 `startErrorKindOf(error)`：读取被抛对象上的机器可读 `kind`，只接受词表成员；无法识别或缺失时归入唯一的兜底成员 `process-failed`。`:220` 现在是 `this.errorKind = startErrorKindOf(error)`（此前的两分支三元只识别 `missing-credentials`）。`:214` 的「无活连接」路径继续报 `process-failed`。
3. 两侧成员集是**构造上同一**而非约定同一：`session-host.ts:27` 导入 `StartErrorKind`，`:42-51` 声明 `export type HostStartErrorKind = StartErrorKind`，其 JSDoc 写明这一对齐关系与 `node-environment` 的含义。`:327` 的兜底改为 `HostStartError('process-failed', …)`；`'start-failed'` 这个名字在全仓已不存在。

**要求的是运行时用例，故断言不止于类型。** `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:144-177` 新增 `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4, M2)')`：(a) `:145` 用 `SameSet<A extends B, B extends A>` 辅助类型把两个词表钉为同一集合；(b) `:150-164` 让端口抛出真实的 `HostStartError('node-environment', …)`，断言 `orch.getSnapshot().errorKind === 'node-environment'` 且文案为环境归因（这正是审查发现的被压平的那一跳）；(c) `:166-176` 抛普通 `Error('spawn EBADF')`，断言落回兜底成员，新兜底同样被钉住。端到端观测点也被加强：`node-env-guard.spec.ts:648-671` 驱动一次真实的扩展激活，其 `settings.json` 指向不存在的路径，现在断言 L2 投影快照上 `snapshot.errorKind === 'node-environment'`（`:666`）——这正是审查要求的断言，§4.4 记录了「归类被压平时该断言变红」的证伪过程。

**S1 — AC-4 夹具字段名。** §3 的 AC-4 行把替身描述为上报 `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}`。代码与测试本就是对的（`node-env-guard.ts:275-282` 以 `hasZstd`/`hasWithResolvers` 收窄；`node-env-guard.spec.ts:286-299` 构造同一 payload）；错的只是本摘要的正文，故只改正文。

**S2 — `process-exec-path` 的修复建议不再提 `PATH`。** `apps/vscode-dsh/src/node-env-guard.ts:192-201` 渲染第 3 级的修复建议；`:200` 现在是 *"this is the Extension Host's own Node.js executable, so set `DSH_NODE_BIN` or the `dsh.nodeBin` setting to a Node.js `^22.19.0 || >=24.0.0` executable, or install a VS Code build whose bundled Node.js provides `zlib.createZstdDecompress` and `Promise.withResolvers`"* —— 对该级真正有效的两个杠杆，加上重装路径。`:185-191` 的 JSDoc 记录了「点名该可执行文件的真正归属者而非 `PATH`」的理由。任何诊断文案中都不再出现 `PATH`。断言在 `node-env-guard.spec.ts:415-417`：第 3 级文案必须含 `this is the Extension Host's own Node.js executable, so set DSH_NODE_BIN`，且**不得**含 `PATH`。

**S3 — lint 数字改为实测值。** §4.3 用本轮 `$PNPM run lint` 的逐文件计数、具体行号，以及「本 Phase 新增行上零诊断」的机械证明，取代此前的定性说法。它同时记录了**对审查数字本身的更正**：门禁在 `extension.ts` 上给出 22 条，不是 3 条 —— 3 条是同一文件在 `lint:fix` 所用的缩减规则集 `.oxlintrc.staged.json` 下的结果。两个数字都在 §4.3 用各自命令复现。「零新增」结论不变，且现在建立在实测数据而非累计值之上。

**S4 — manifest 偏差已记录。** §5.10 记录了本 Phase 在最低要求之外为 `dsh.nodeBin` 增加的两个键：`scope: "machine-overridable"` 与 `markdownDescription`。

**S5 — 能证伪缓存的用例。** `node-env-guard.spec.ts:629-646` 只激活一次，先对指向 `first-node` 的 `settings.json` 启动一次，把文件改写为 `second-node` 后再启动一次，断言第二次快照文案含 `second` 且**不含** `first`。`vscode` 替身的 `get()` 每次调用都重读文件（`:564-571`），因此该用例同时证伪「缓存设置值」与「缓存解析结果」。§4.4 记录了证伪过程：把 `readNodeBinSetting` 记忆化后该用例变红。

**S6 — AC-3(a)(b) 变成可执行断言。** `node-env-guard.spec.ts:96-165` 新增机制：`CHECKLIST_LABELS`（`repository` / `localEnvironment` / `faces`）、`countOccurrences`、`sectionAfter`、`localEnvironmentEntries`，以及 `assertChecklistStructure` —— 要求四个标题各恰好出现一次，且每个「本机环境」条目至少携带一个 `DECIDABLE_ENTRY_TOKENS` 中的可判定记号（`nvm`、`n 24.3.0`、`export PATH=`、`node --version`、`DSH_NODE_BIN`、`dsh.nodeBin`、`workbench.action.reloadWindow`）。`:474-499` 对两份语言文件运行它，随后**就地自证伪**：对每个子清单标题，从文档文本中删除该标题，并要求**同一断言**抛错（`:486-492`）。§4.4 另外记录了在真实 `docs/development.md` 上做的、跳出测试之外的证伪探针。

**S7 — 版本下限归属的措辞。** `docs/development.md:105` 现在说版本下限 *"has one owner, `engines.node` in the root `package.json`, which the extension mirrors in the range it enforces and a test keeps equal to that field"*，取代原来的 "declared once"；中文侧 `:107` 表述一致。这与代码事实相符：`EXPECTED_NODE_RANGE` 是副本，且 `node-env-guard.spec.ts:444` 会在副本与 `engines.node` 不一致时失败。配对记录与 M1 在同一轮重录。

**S8** 与 **S10** 分别在 §5.11、§5.12 记录（路由决策；Phase 2 注入点）。

**S9 — 门槛探测现在按真正 spawn 的模式运行。** `apps/vscode-dsh/src/node-env-guard.ts:254-258` 不再接收裸路径而是接收 `ResolvedNodeExecutable`，显式构造环境，并在 `executable.electronRunAsNode` 为真时设置 `ELECTRON_RUN_AS_NODE=1`；`:260-264` 把该环境传给 `execFileAsync`。调用点 `:131` 本就持有该对象，因此门槛与 `resolveDshLaunch` 的 spawn 条件现在完全一致。`node-env-guard.spec.ts:240-267` 用真实的替身证明：该文件仅在带 flag 时才表现为 Node；`electronRunAsNode: true` 时校验 `ok:true`（`:259`），同一文件在 `electronRunAsNode: false` 时为 `unusable`（`:265-266`）—— 无论漏注入还是错注入 flag，该用例都会失败。§4.4 记录了「去掉 flag 注入 → 第一条断言变红」的证伪过程。

### 1.3 与审查字面要求的**有意差异**

1. **保留 `process-failed` 作为唯一兜底成员；审查并未要求删除它，而 Phase 2 需要它。** M2 禁止把 `'start-failed'` 当万能归类，这一点已达成。它并未要求删掉 `process-failed`：Phase 2 spec 的边界清单要求未归类失败断言 `errorKind === 'process-failed'`，AD-4 称扩展是加性的。删掉它会破坏一份已批准的下游 spec。本轮真正的变化是：`process-failed` 只经由 `startErrorKindOf` 的书面兜底抵达，且 `'other'` 万用成员被移除 —— 因此兜底成员只有一个而非两个。
2. **S3 的数字被更正而非照抄。** 审查称 `extension.ts` 实测为 3；本轮在门禁命令下实测为 22，只有在 `.oxlintrc.staged.json` 下才能复现审查的 3。§4.3 把两个数字与各自命令都列出，并保留「零新增」结论（两种规则集下均成立）。把 3 当作*唯一的*实测值，等于用一个不可复现的数字替换另一个不可复现的数字。
3. **S5 用了比审查建议更强的机制。** 审查建议改变 `vscode` 替身的返回值；本用例改为在两次启动之间重写真实的 `settings.json`，因此还一并证伪「缓存文件读取」，而不只是「缓存返回值」。审查要求的编排层效果（第二次启动使用新值）断言方式完全相同。

## 2. 变更清单

### 2.1 新增文件（本 Phase）

| 路径 | 行数 | 用途 |
|---|---:|---|
| `.nvmrc` | 1 | `24.3.0` —— AC-1 要求的机器可读 Node 声明，指明本仓库检查所依据的发布版。 |
| `apps/vscode-dsh/src/node-env-guard.ts` | 303 | 唯一门槛入口：`validateNodeEnvironment()`、抛错包装 `assertNodeExecutable()`、失败分类、五要素诊断渲染、可执行/权限探测，以及按调用方调用模式真实运行子进程的能力探测。 |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` | 687 | 27 个运行时用例：能力门槛、每种失败类型、五要素诊断、AC-3 结构断言、manifest 贡献、扩展的设置读取，以及 `.nvmrc` / `engines.node` 一致性检查（AC-1、AC-2、AC-3、AC-4、AC-8、AC-9、AC-10）。 |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts` | 327 | 7 个运行时用例，覆盖 spawn 顺序契约：门槛 → `bridge.listen` → spawn，spawn 通过 witness 文件观测而非 mock（AC-4 顺序、AC-5 c、AC-7、AC-8、AC-10 c/d）。 |

### 2.2 修改文件（两轮合计；★ = 本轮回炉改动）

| 路径 | 改动 |
|---|---|
| ★ `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 一个 `START_ERROR_KINDS` 数组同时供 `StartErrorKind` 类型与 `startErrorKindOf` 守卫使用；`node-environment` 成为成员，`'other'` 移除；捕获分支按被抛对象的 `kind` 归类（M2）。 |
| ★ `apps/vscode-dsh/src/session-host.ts` | `HostStartErrorKind` 现在就是 `StartErrorKind`（单一词表，AD-4）；兜底抛 `process-failed`；`HostStartError` / `HostStartErrorKind`、`IdeSessionHostStartOptions.nodeExecutable` / `.nodeBinSetting`，以及 `resolve → assertNodeExecutable → bridge.listen → client start` 顺序为第一轮所加。 |
| ★ `apps/vscode-dsh/src/node-env-guard.ts` | `probeNodeApis` 接收已解析对象，并对 `electronRunAsNode` 候选注入 `ELECTRON_RUN_AS_NODE=1`（S9）；`process-exec-path` 的修复建议点名该可执行文件的归属者与两个杠杆，不再提 `PATH`（S2）。 |
| ★ `apps/vscode-dsh/src/extension.ts` | `VsCodeLike` 增加 `workspace.getConfiguration`；`readNodeBinSetting()` 读取 `dsh.nodeBin`，非字符串值在任何 host 出现前 fail loud；`createStartHostPort()` 把 `nodeBinSetting` 传入 `IdeSessionHost.start()`；`node-environment` 失败经既有诊断路径上报。 |
| `apps/vscode-dsh/src/index.ts` | 加性 re-export：守卫的类型、常量、错误类与 `HostStartError`。 |
| `apps/vscode-dsh/package.json` | `apps/` 下首个 `contributes.configuration`：`dsh.nodeBin` 字符串属性，含 `default`、`scope`、`description`、`markdownDescription`。 |
| ★ `apps/vscode-dsh/tests/node-env-guard.spec.ts` | S6 结构断言与辅助函数；S9 用例；S2 断言；S5 用例；L2 的 `errorKind === 'node-environment'` 断言（M2）。 |
| ★ `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | `SameSet` 词表钉定 + 三个归类用例（M2）。 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`、`phase2-auto-ready.spec.ts`、`phase4-new-conversation-chrome.spec.ts` | 各自内联的 duck-typed `vscode` 替身补上 `workspace.getConfiguration('dsh')`，使扩展新增的设置读取不会让早于本 Phase 的套件抛错（每个 5 行，无其他改动）。 |
| `packages/sdk/client/src/types.ts`、`src/launch.ts`、`src/index.ts` | `ResolvedNodeExecutable` / `NodeExecutableRequest` / `NodeExecutableSource` 与唯一的 `resolveNodeExecutableSpec()` 入口（全部为加性；`resolveDshLaunch` 消费调用方传入的对象，且仅在 Electron 下的 `process.execPath` 注入 `ELECTRON_RUN_AS_NODE=1`）。 |
| `packages/sdk/client/tests/launch.spec.ts` | 扩展（非替换）既有文件，新增 11 个用例覆盖三来源、Electron 交互与边界输入。 |
| `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | 新增 "Choosing the Node executable" 章节；配对已重录。 |
| ★ `docs/development.md` + `development.zh.md` + `development.i18n.yaml` | 新增 `### Node environment` 章节（下限及其归属文件、`.jsonl.zstd` 的 API 依赖、解析顺序、仓库侧机制表、把本机环境侧清单拆为终端侧与扩展子进程侧）；M1 为该重载条目补上命令记号，S7 更正归属措辞；配对已重录。 |

### 2.3 本工作区中已改动/未跟踪，但**不属于**本 Phase

列出以免 HG-3 把它们算作 Phase 1 的改动。每一项的修改时间均为 2026-09-14 或更早，早于本 agent 开始工作；本 Phase 未打开其中任何文件进行写入。

| 路径 | 状态 | 说明 |
|---|---|---|
| `pnpm-lock.yaml` | modified | 既有；本 Phase 从未执行安装（全程 `--config.verify-deps-before-run=false`）。 |
| `apps/vscode-dsh/webview/dist/assets/index.{css,js}` | modified | 既有 webview 构建产物。 |
| `.cursor/skills/project-build/SKILL.md`、`.specdev/specs/workflows.json` | modified | 既有。 |
| `.cursor/**`、`.trae/**`、`.explore/`、`.mcp.json`、`opencode.jsonc`、`docs/wiki/**`、`.wiki-work/` | untracked | 既有的工具/配置/知识库目录树。 |
| 大量 `packages/**/src/*.d.ts`、`*.js`、`*.js.map`、`*.d.ts.map` | untracked | 仓内构建残留，也是红色 `lint` 基线的主要构成之一；非本 Phase 产生。 |

## 3. 验收标准覆盖

| AC | 实现位置 | 证明方式 |
|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0`；`EXPECTED_NODE_RANGE` 镜像根 `engines.node` | `node-env-guard.spec.ts` → *pins exactly one machine-readable version that the declared range admits*：`.nvmrc` 只有一行 semver，`rangeAdmits('^22.19.0 \|\| >=24.0.0', '24.3.0')` 成立，且 `validateNodeEnvironment(process.execPath)` 报 `ok:true`；*keeps the enforced range identical to the root engines field*：`engines.node` === `EXPECTED_NODE_RANGE`；*names the pinned release in both developer docs*：两份文档都含 `.nvmrc` 与所钉版本。 |
| AC-2 | `docs/development.md` 的 `### Node environment` 节（+ 中文侧） | 该节写明下限（22 线的 22.19，或 24 及以上）、归属文件（根 `package.json` 的 `engines.node`）、两个 API（`zlib.createZstdDecompress`、`Promise.withResolvers`），并把 API 与 `.jsonl.zstd` 会话日志关联。 |
| AC-3 | 同一节的两张清单 | **实现**：*Repository-side responsibilities* 是 5 行表格，每行都带可判定命令（`pnpm run typecheck`、`pnpm run test apps/vscode-dsh`、`pnpm run test packages/sdk/client`、`pnpm run test:docs`、`pnpm run doc-sync`）；*Local-environment responsibilities* 拆为 *Terminal side*（3 条：版本检查、`nvm use` / `n 24.3.0`、前置 `PATH`）与 *Extension subprocess side*（3 条：设置项或 `DSH_NODE_BIN`、`--version` 确认、用 `workbench.action.reloadWindow` 重载窗口），没有任何条目把两侧合并成一条指令。**证明**：`node-env-guard.spec.ts:474-499` 对两份语言文件断言四个标题各恰好出现一次，且每个本机环境条目携带 `DECIDABLE_ENTRY_TOKENS` 中的一个可判定记号；同一测试随后删除每个子清单标题并要求自己的断言抛错 —— 因此任一侧面不再单列时，(a)(b) 即失败。 |
| AC-4 | `node-env-guard.ts` 的 `validateNodeEnvironment()`，由 `IdeSessionHost.start()` 在 `bridge.listen` 之前调用；三来源都经 `resolveNodeExecutableSpec()`，故一个门槛覆盖全部来源 | (a) `inspectExecutableFile()` 检查存在性、普通文件与 `X_OK`；(b) `probeNodeApis()` 把候选当作真实子进程运行，询问 `zlib.createZstdDecompress` 与 `Promise.withResolvers`。用例：本机合格 Node 的正向报告；`missing`；`not-executable`；上报 `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}` 的替身产出 `missing-apis` 且列出两个 API 名；以及 §4.4 的 `electronRunAsNode` 用例。 |
| AC-5 | `resolveNodeExecutableSpec()` 优先读 `DSH_NODE_BIN`，仅把空字符串视为未设置 | `launch.spec.ts`：环境变量已设置 → `{source:'dsh-node-bin'}`，且即使 `process.versions.electron` 已定义也不带 `ELECTRON_RUN_AS_NODE`；(b) 环境变量与设置项同时非空 → *prefers a non-empty DSH_NODE_BIN over the configuration setting*；该不对称由 *treats an empty DSH_NODE_BIN as unset and falls through to the setting* 与 *uses a whitespace-only DSH_NODE_BIN as given, because only the empty value counts as unset* 钉定；`session-host-preflight.spec.ts`：`DSH_NODE_BIN` 指向真实替身脚本 → 该脚本被运行、真实 Node 子进程运行了 runtime 脚本；而不可用的设置项从未走到 spawn。 |
| AC-6 | 第 3 级是 `process.execPath`；仅在 Electron 下该来源的 `electronRunAsNode` 为真 | `launch.spec.ts`：Electron 宿主 + 无环境变量 + 空设置 → `{source:'process-exec-path', electronRunAsNode:true}` 且 `ELECTRON_RUN_AS_NODE === '1'`；注入 `PATH` 的替身 `node` 被断言不是被 spawn 的可执行文件。该级诊断文案不含 `PATH`（`node-env-guard.spec.ts:417`）。 |
| AC-7 | `start()` 顺序现为 门槛 → `bridge.listen` → spawn | `session-host-preflight.spec.ts`：对来自 `DSH_NODE_BIN` 的不可用候选，以及来自设置项的缺失与不可用候选 —— `start()` reject 且 `kind === 'node-environment'`，证明有子进程运行的 witness 文件始终缺失，`existsSync(bridgeSockPath)` 为 false，`host.status === 'error'`，耗时远低于 `initializeTimeoutMs`（配置 60 000 ms，断言 < 5 000 ms）—— 因此该失败既不是「spawn 后崩溃」也不是握手超时。 |
| AC-8 | `formatNodeEnvironmentDiagnostics()` 恰好渲染五行，每行一个要素 | 每种失败类型都产出五行文案，且四条文案两两不同。`process-exec-path` 文案被断言含候选路径、探测到的版本、期望范围（`22.19` 与 `24` 都要）、缺失 API 名，以及两个获准输入（`DSH_NODE_BIN` 与 `dsh.nodeBin`）。扩展层：失败启动的用户可见文案被断言含问题路径与 `dsh.nodeBin`。 |
| AC-9 | 文案把失败归类为 Node 环境问题；载体是 `NodeEnvironmentError` 与 `HostStartError{kind:'node-environment'}`，且该类别原样抵达编排快照 | 诊断首行含 `Node environment`；文案用「探测到的版本 vs 期望范围」表述，且只给环境侧修复；没有任何诊断把责任归给 dsh 代码，也没有任何代码路径把它转成通用运行时错误。快照那一跳在两个层级都被断言：`auto-start-orchestrator.spec.ts:150-164`（端口 → 快照）与 `node-env-guard.spec.ts:666`（真实扩展激活 → 快照）。 |
| AC-10 | (a) `apps/vscode-dsh/package.json` 的 `contributes.configuration.dsh.nodeBin`；(b) 文档化的优先级；(c)–(e) 运行时 | (a) 属性声明为 `string`、默认 `""`、描述写明优先级与「留空」语义；(b) `docs/development.md`（+ 中文侧）写明 `DSH_NODE_BIN` > `dsh.nodeBin` > 扩展宿主 Node；(c) `launch.spec.ts`：仅设置项 → `{path:'/y/node', source:'vscode-setting'}`，且门槛校验的对象就是交给 `resolveDshLaunch` 的对象；(d) `session-host-preflight.spec.ts`：设置项指向不存在的路径 → reject、`kind === 'node-environment'`、无 witness 文件、无 bridge socket、`status === 'error'`，且 `resolveNodeExecutableSpec` **恰好被调用一次**（没有第二次解析去取别的来源）；(e) `node-env-guard.spec.ts`：扩展从真实 `settings.json` 读取 `workspace.getConfiguration('dsh').get('nodeBin')`，把该值显式传给 host，空值原样传递，下一次启动重新读取而不缓存，非字符串值 fail loud。 |

**跨 Phase 依赖（AC-10 f，写入此处供 verifier 的 `verification.md` 引用）**：AC-10 的真机分支 —— 预置 `settings.json` 在真实 Extension Development Host 中被解析链消费 —— 由 Phase 3 的冒烟脚本按 AD-11 提供证据。Phase 1 只判 (a)–(e)，**不**声称该分支，且不得把它记成允许 PASS 的 known gap。

**AC-10(d) 无效设置路径的证据切分**：(i) *代理证据* 是运行后预置 `settings.json` 字节未变的断言（`node-env-guard.spec.ts:670`），说明扩展是消费该设置而非把它改写成别的来源；(ii) *不可代理的负面证据* 是 `session-host-preflight.spec.ts` 中所有 spawn 标记的缺失（witness 文件不存在、bridge socket 不存在、`status === 'error'`、耗时远低于超时）。产品代码中未新增任何观测点；`resolveNodeExecutableSpec` 的调用计数发生在测试里，通过对导入模块命名空间的 spy 实现。

## 4. 测试证据

所有命令均在 `/workspace/chendecheng/code/need/deepseek/deepseek-harness` 下、先 `export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"`，并按 `pnpm --config.verify-deps-before-run=false`（下称 `$PNPM`）执行。

### 4.1 差量结果（Phase 1 的验收口径）

| 命令 | 本 Phase 之前（spec 基线） | 本轮回炉之后 | 新增失败 |
|---|---|---|---|
| `$PNPM run typecheck` | 绿 | **exit 0** | 无 |
| `$PNPM run test packages/sdk/client` | 绿（3 文件 / 73 用例） | **绿，exit 0 — 3 文件 / 84 用例**（73 + 新增 11） | 无 |
| `$PNPM run test apps/vscode-dsh packages/sdk/client` | app 套件 48 文件 / 320 用例，**4 文件 / 6 用例红** | 53 文件 / 441 用例，**4 文件 / 6 用例红**，434 passed，1 skipped，exit 1 | 无 —— 文件集合与失败用例集合完全相同 |
| `$PNPM run lint` | 红（既有 `apps/vscode-dsh/tests/**` 与仓内构建残留） | 红，exit 1 —— 263 个文件共 10 382 条诊断；本 Phase 新建文件 **0** 条，本 Phase 新增行 **0** 条 | 无（见 4.3） |
| `$PNPM run test:docs` | 红 —— `run-gates: 10 passed, 5 failed, 0 skipped` | 红 —— `run-gates: 10 passed, 5 failed, 0 skipped`，同样的五个门禁 | 无；输出中本 Phase 的文档对零出现 |
| `$PNPM run test <path>`（带 `--`） | 不可用 —— 会跑全量 1 106 文件 | 未使用（按 spec 规定） | — |

四个红色 app 套件文件与基线快照在身份与数量上完全一致：`spike-t0b-continue-capability.spec.ts`（整个套件，根因 `Cannot read properties of undefined (reading 'UNLOADING')`，位于 `packages/core/agent-loop/src/index.ts:40`）、`spike-t0a-replay-rebuild.spec.ts`（4 用例，根因 `Cannot read properties of undefined (reading 'PENDING')`，位于 `scripts/test-invariants.ts:88`）、`panel-close-delete.e2e.spec.ts`（1 用例）、`verifier-phase1/layer-a-rtl.spec.tsx`（1 用例）。没有一个是本 Phase 触碰过的文件。

### 4.2 本 Phase 自己的用例

| 命令 | 结果 |
|---|---|
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | `Test Files 4 passed (4)`，`Tests 69 passed (69)`，exit 0 |
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts` | `Test Files 3 passed (3)`，`Tests 43 passed (43)`，exit 0 |
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts` | `Tests 27 passed (27)` |

每个 AC-4 / AC-7 / AC-8 / AC-9 / AC-10 运行时用例都构造输入、执行、并断言输出；没有一个是静态断言。`node-env-guard.spec.ts` 用 `node:child_process` 真实 spawn 每个候选，`session-host-preflight.spec.ts` 让子进程写 witness 文件（`process.execPath` 与 `argv`）来记录被 spawn 的可执行文件，AC-10(e) / M2 / S5 用例则对真实 `settings.json` 驱动真实 `activate()` —— 因此「没有子进程运行」与「快照报 `node-environment`」都是被观测的，而非被假设的。

### 4.3 lint 差量（逐文件，实测）

`$PNPM run lint`（门禁命令：`tsx scripts/run-oxlint.ts .`）在基线与现在都 exit 1。本轮实测：**263** 个文件共 **10 382** 条诊断。本 Phase 触碰过的文件逐个如下：

| 文件 | 诊断数 | 是否落在本 Phase 新增行上？ |
|---|---:|---|
| `apps/vscode-dsh/src/node-env-guard.ts`（新） | 0 | — |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts`（新） | 0 | —（开发过程中曾引入 3 条 —— 2 × `@stylistic(arrow-parens)`、1 × `typescript(no-non-null-assertion)` —— 已在本轮运行前全部修掉） |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts`（新） | 0 | — |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 1 —— `:230:24`（`no-non-null-assertion`） | 否 —— 新增区间是 `26-55` 与 `220`；`:230` 是 `more[more.length - 1]!`，未改动文本，因 `:220` 的替换而位移 |
| `apps/vscode-dsh/src/session-host.ts` | 1 —— `:595:3`（`require-await`） | 否 —— 新增区间是 `14`、`16`、`27`、`29`、`42-79`、`106-109`、`253-254`、`285-290`、`300`、`321-327` |
| `apps/vscode-dsh/src/extension.ts` | 22 —— `:271`、`:375`、`:380`、`:385`、`:407`、`:425`、`:662`、`:750`、`:1004`、`:1102`、`:1152`、`:1418`、`:1450`、`:1492`、`:1534`、`:1791`、`:2109`（2 条）、`:2110`、`:2111`、`:2270`、`:2272` | 否 —— 新增区间是 `48`、`223-236`、`2172-2190`、`2253`、`2256`；22 条全部在其外 |
| `apps/vscode-dsh/src/index.ts` | 1 —— `:97:3`（`no-deprecated`，对象为 `buildThinChatHtml`） | 否 —— 新增区间是 `25-39` |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | 4 —— `:52:39`、`:53:9`、`:95:36`、`:96:9` | 否 —— 新增区间是 `8`、`12-15`、`143-177`；4 条都位于既有的 `mockPort` 辅助函数内 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | 2 —— `:158`、`:192` | 否 —— 新增区间是 `70-74` |
| `apps/vscode-dsh/tests/phase2-auto-ready.spec.ts` | 15 | 否 —— 新增区间是 `49-53` |
| `apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts` | 11 | 否 —— 新增区间是 `75-79` |
| `packages/sdk/client/{src/launch.ts,src/types.ts,src/index.ts,tests/launch.spec.ts}` | 0 | — |
| `apps/vscode-dsh/package.json` | 0 | — |

**与审查 S3 数字的关系。** 审查称 `extension.ts` 为 3 条。该数字在缩减规则集下可复现，两个命令都列在此处，使差异不成为见仁见智的问题：

| 命令 | `extension.ts` 诊断数 |
|---|---|
| `$PNPM exec tsx scripts/run-oxlint.ts apps/vscode-dsh/src/extension.ts` | 22 |
| `$PNPM exec tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json apps/vscode-dsh/src/extension.ts` | **3** —— `:2109:1` 与 `:2110:1`（`@stylistic(indent)`）、`:2111:1`（`@stylistic(indent)`） |

在门禁规则集下，该文件的 22 条诊断分布于 21 个不同行，全部位于未改动代码；在 staged 规则集下为 3 条，也全部位于未改动代码。因此「零新增」在两种测量下都成立，本报告给出每个命令各自产出的数值，而不去选取其一。无论哪种口径，这些行都是未改动源码：`git diff -U0` 显示 `extension.ts` 的补丁块全为纯插入（`@@ -47,0 +48 @@`、`@@ -221,0 +223,14 @@`、`@@ -2156,0 +2172,19 @@`、`@@ -2218,0 +2253 @@`、`@@ -2220,0 +2256 @@`），没有任何诊断行号落在其中。

### 4.4 证伪探针（本轮运行时论断的依据）

每个探针都改动产品代码或文档、运行确切命令、记录变红结果，然后恢复文件并确认套件重新变绿。M2 / S5 / S6 / S9 的可证伪性正是这样确立的，而不是声明的。

| 论断 | 施加的改动 | 观测到的结果 | 是否恢复 |
|---|---|---|---|
| M2 —— 类别穿过那一跳 | 把 `startErrorKindOf` 限制为只识别 `missing-credentials`，其余返回 `process-failed`（即修复前的行为） | `$PNPM run test apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/node-env-guard.spec.ts` → exit 1，`Tests 2 failed \| 34 passed (36)`：`projects a host node-environment failure as node-environment, not a dsh process failure` 与 `fails loud on an unusable path named by settings.json and leaves the file untouched`。两个层级都被覆盖：编排快照与真实扩展激活。 | 是 |
| S9 —— 探测使用 spawn 模式 | `if (executable.electronRunAsNode)` 改为 `&& false`，使探测永不注入该 flag | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts` → exit 1，`Tests 1 failed \| 26 passed (27)`：`probes a process-exec-path candidate in the Electron mode the spawn will use (S9)` —— `electronRunAsNode: true` 的候选不再 `ok:true`。 | 是 |
| S5 —— 跨启动无缓存 | 用模块级变量把 `readNodeBinSetting` 记忆化 | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts` → exit 1，`Tests 4 failed \| 23 passed (27)`，其中含 `re-reads the setting on every start instead of caching the first value (S5, AD-9)` 与 `passes an empty setting through unchanged instead of inventing a path`。 | 是 |
| S6 —— 清单结构是有承载力的 | 从真实的 `docs/development.md` 删除 `Terminal side` 这一短语（`*Terminal side* — the Node that runs …` → `The Node that runs …`） | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts -t "keeps the AC-3 checklist structure"` → exit 1，`1 failed \| 26 skipped (27)`，`AssertionError: …/docs/development.md: expected [Function] to not throw an error but 'Error: checklist title "Terminal side" occurs 0 times, expected exactly 1' was thrown`。该测试自身在每次运行时就地删除每个子清单标题（`:486-492`），无需改动文件即可重复这一证伪。 | 是 —— 字节级原样恢复，已用 `sha256sum -c` 对探针前的哈希校验 |

恢复之后：`$PNPM run typecheck` exit 0，4.2 中四文件命令 `Tests 69 passed (69)`、exit 0。扫描残留探针标记（`cachedNodeBinSetting`、`electronRunAsNode && false`、守卫内的 `candidate === 'missing-credentials'`）无任何匹配。

### 4.5 真机探针（AC-1 b 与 AC-4 a 的证据）

通过随仓发布的守卫，用 `tsx` 运行编译后的模块并调用 `validateNodeEnvironment({path, source, electronRunAsNode:false})` 探测：

| 解释器 | 上报版本 | `hasZstd` | `hasWithResolvers` | 判定 |
|---|---|---|---|---|
| `/usr/local/n/versions/node/24.3.0/bin/node` | 24.3.0 | true | true | `ok:true` —— 门槛不会误伤合格 Node |
| `/usr/bin/node` | 18.12.1 | false | false | `missing-apis`，两个名字都列出 |
| `~/.nvm/versions/node/v22.14.0/bin/node` | 22.14.0 | false | true | `missing-apis`，仅 `zlib.createZstdDecompress` |
| `/usr/local/n/versions/node/22.9.0/bin/node` | 22.9.0 | false | true | `missing-apis`，仅 `zlib.createZstdDecompress` |

后两行同时是 AD-2 的演示：这些解释器低于声明下限，但报告的类别是 `missing-apis` 并给出 API 名，从不基于版本号拒绝；而一个落在声明范围之外、却提供两个 API 的解释器会被接受。

另有两项机器实测，是在撰写 AC-3(a) 的验证列时补做的 —— 因为该行最初的措辞断言了不成立的事：

| 探针 | 实测 |
|---|---|
| `env -i PATH=/usr/bin:/bin sh -c 'command -v node; node --version'` | `/usr/bin/node`、`v18.12.1` |
| `PATH="/usr/bin:/usr/local/node/bin:$PATH" $PNPM run typecheck` | exit 1，`ERROR: This version of pnpm requires at least Node.js v22.13` |

## 5. 偏差记录（与 spec / design 前提不一致之处）

1. **AD-2 曾被本 Phase 的第一版违背，已更正。** 最初的 `node-env-guard.ts` 按版本字符串设门（`unsupported-version`）。AD-2 规定门槛由能力决定、版本仅用于诊断，且 AC-4(c) 要求 `{"version":"20.16.0",…}` 替身归类为 `missing-apis`。版本比较已删除，`unsupported-version` 与 `nodeVersionSupported()` 已移除，能力测试顺序随之调整。
2. **在 spec 给出的三种失败类型之外还存在第四种 `unusable`。** 它覆盖「存在且可执行，但无法上报 Node 能力」的候选（非零退出、输出非报告、或超时）。把它并入 `missing-apis` 会打印从未被观测到的 API 名；该类别在满足 AC-7「阻断 spawn」义务的同时保持文案真实。spec 并未枚举封闭分类，也没有 AC 要求恰好三种。
3. **空白字符串的不对称是有意为之，且与 spec 的边界清单一致。** `DSH_NODE_BIN='   '` 视为*已设置*（按原值使用，随后被门槛 fail loud），而 `dsh.nodeBin='   '` 视为*未设置*并落向下一个来源。spec 的边界清单要求的正是这一区分。
4. **`docs/development.md` 的验证措辞更正。** 第一版声称当解释器落在 `engines.node` 之外时 `pnpm run typecheck` 会拒绝启动。实测（4.5）显示拒绝来自 pnpm 自己的下限（22.13），而非 `engines.node`；且本机干净 `PATH` 解析到的是 `/usr/bin/node` v18.12.1，而不是 spec 快照所称的 v20.16.0。AC-3(a) 行现在给出三项可判定检查（`node --version` 被 `engines.node` 接受、`.nvmrc` 指明检查所依据的发布版、`typecheck` 退出 0）。
5. **与 spec 快照不同的机器事实。** spec 称 `/usr/local/n/versions/node/24.3.0` 是唯一合格安装；本机上 `/usr/local/bin/node` 是第二个真实的 v24.3.0 二进制，`~/.nvm/versions/node/v20.16.0` 存在但不是干净 `PATH` 所解析到的。两者都不改变实现。
6. **两张清单标题与两个侧面标题是加粗引导句，不是 ATX 标题。** `docs/development.md` 同节的其他内容只用 `##`/`###`，嵌套列表以加粗文本引导，因此新子结构沿用了本仓风格。verifier 的结构断言与 `node-env-guard.spec.ts` 中的可执行断言匹配的是标签文本（`Repository-side responsibilities` / `Local-environment responsibilities`、`Terminal side` / `Extension subprocess side`，以及其中文对应），因此与强调标记无关。若将来某门禁要求 ATX 标题，每个标题改一行、标签不变即可。
7. **`HostStartError` 是加性的，但改变了每次 `start()` 失败的抛出类**，覆盖 `node-environment` 与 `process-failed`。既有 app 套件仍然通过；该类型已导出，调用方可据此判别。
8. **`contributes.configuration` 还带有 `title`。** 只有属性块是必需的；title 是加性的，用于在 VS Code 设置界面中分组。
9. **没有移除任何已发布名称。** `resolveNodeExecutable()` 是 `launch.ts` 的私有函数（在 HEAD 未被 re-export），因此用 `resolveNodeExecutableSpec()` 取代它不改变任何公开面；`packages/sdk/client/src/index.ts` 的改动全为新增。
10. **S4 —— `dsh.nodeBin` 属性带有两个超出最低要求的键。** `apps/vscode-dsh/package.json` 除 `type` / `default` / `description` 外还声明了 `"scope": "machine-overridable"` 与 `"markdownDescription"`。理由：出问题的值属于机器（已安装解释器的路径）而非仓库，因此允许工作区层级覆盖用户的机器设置是授予了错误的权限，`machine-overridable` 是仍允许机器级覆盖的最窄 scope；`markdownDescription` 是 `description` 的 Markdown 版本，让设置界面把两个 API 名与范围渲染为代码；VS Code 在存在时优先使用 `markdownDescription`，`description` 保留给读取它的界面。`node-env-guard.spec.ts:508-517` 通过 `description` 断言承载行为的要点（优先级、空值语义、`22.19`、`24`）；这两个额外键不增加任何行为。
11. **S8 —— 设置项作为显式输入路由到 host，而非隐式读取。** `extension.ts:2253-2256`（`createStartHostPort()`）调用 `readNodeBinSetting(vscode)`，并把结果作为 `IdeSessionHost.start({ cwd, nodeBinSetting, credentials })` 传入（该选项在 `session-host.ts:106-109` 声明）。三个理由：(a) `IdeSessionHost` 是进程/传输接缝，不得依赖 `vscode` 模块 —— 它在 `session-host-preflight.spec.ts` 中脱离 VS Code 被使用；(b) SDK 已经把同一输入建模为请求对象（`resolveNodeExecutableSpec({ nodeBinSetting })`），因此 host 把同一个值同时交给门槛与解析器，门槛校验的对象就是真正被 spawn 的对象；(c) `readNodeBinSetting` 对未设置返回 `undefined` 而不是 `''`，使编辑器边界处「未设置」与「空字符串」保持可区分，而解析器保留自己文档化的空串语义。非字符串值在 `readNodeBinSetting` 内部、任何 host 出现之前抛出，即 AC-10(e) 要求的 fail loud。
12. **S10 —— 「为 Phase 2 预留诊断注入点」具体指什么。** spec.md:133 把「读取设置项、作为显式输入传入、并为 Phase 2 的 AC-13 – AC-22 预留诊断注入点」派给 `extension.ts`。在本 Phase 中，这一预留就是以下三个既有的、有类型的观测面，没有新增 sink 类型、也没有新增 `HostFailureKind`：
    - `IdeSessionHost.onError(listener) → disposer`（`session-host.ts:195-200`）—— 既有的错误观测端口，扩展已在 `createStartHostPort()` 内订阅。Phase 2 的诊断 sink 以与今天注入 `setInteractionUi` / `onError` 相同的方式（在 `start()` 之前）挂接，无需改动 `start()`。
    - `AutoStartOrchestrator.getSnapshot()` / `onChange(handler)` —— L2 投影已携带 `state`、`errorKind`（M2 之后能说 `node-environment`）与 `errorMessage`。Phase 2 的记录器可在此订阅那些从未抵达 `start()` 的失败。
    - `HostStartError{kind, diagnostic}`（`session-host.ts:57-77`）—— 对 `node-environment` 类别，被抛错误已携带结构化 `NodeEnvironmentFailure`，因此 Phase 2 的记录器读 `error.diagnostic`，而不必重新解析渲染后的文案。
    合计起来，这就是 Phase 2 可以挂接的书面接口；sink 类型、六类 `HostFailureKind` 词表（含它自己的 `other`）与脱敏策略仍归 Phase 2 所有。
13. **`StartErrorKind` 去掉了 `'other'` 成员。** 同时保留 `'other'` 与 `process-failed` 会留下两个万用类别，正是 M2 要消除的压平；词表现为由本 Phase 能产出的类别加唯一一个有文档的兜底成员构成。`'other'` 仍存在于 Phase 2 的*记录*词表中，那是另一个 Phase 的另一个类型。

## 6. 未闭环事项与风险

1. **AC-10(f)**（真实 Extension Development Host 消费预置 `settings.json`）按 spec 要求仍是 Phase 3 的义务。Phase 1 不得因该分支被判定为完成或不完成。
2. **`$PNPM run doc-sync`** 未运行：spec 把首次 `test:docs` 派给本 Phase，把 `doc-sync` 留给 Phase 4 的复核。`test:docs` 已在 §4.1 与 §7 记录确切计数。
3. **红色 `lint` 基线按设计未触碰。** 其构成是仓内构建残留（未跟踪的 `packages/**/src/*.d.ts` 与 maps）以及 `apps/vscode-dsh/tests/**` 中既有的 `no-unsafe-*` / `no-unnecessary-*` 类问题；后者的结构性成因是 `apps/vscode-dsh/tsconfig.json` 只 include `src`，那些测试文件不在任何 TypeScript program 内。修复该类问题意味着把测试目录加入某个 program，从而改变本 Phase 必须保持为绿的 `typecheck` 基线，故不在范围内。
4. **`apps/vscode-dsh` 没有覆盖率门禁**，而 `packages/sdk/client` 仍要求逐文件 100%。本 Phase 未给 SDK 增加未覆盖分支：其新代码由 `launch.spec.ts` 的 11 个新用例覆盖。
5. **`unusable` 是唯一依赖子进程行为（退出码、输出、超时）的归类**，因此也是「只有单测时可能藏住回归」的地方。它有真实替身（非零退出）与 S9 用例覆盖；超时分支未被单独触发，因为构造它需要一个长时间运行的夹具。
6. **工作区中两个已跟踪文件的改动不属于本 Phase**：`pnpm-lock.yaml` 与 `apps/vscode-dsh/webview/dist/assets/index.{js,css}`（均日期为 2026-09-14）。它们分别是 pnpm 重新解析条目与先前构建的 webview bundle，必须排除在 Phase 提交之外。
7. **app 套件的红色集合在成员上对并发敏感，但在数量上稳定。** 四次失败文件与六个失败用例在本文件记录的所有运行中都与基线快照一致，但两个单用例失败（`panel-close-delete.e2e.spec.ts`、`verifier-phase1/layer-a-rtl.spec.tsx`）属于同一共享资源家族、在运行间会变化。若 verifier 观察到的是不同的那一对，应比较总数与根因，而不只是名字。

## 7. 文档门禁（实际执行的命令）

| 命令 | 结果 |
|---|---|
| `$PNPM run verify-translation-pairing --write docs/development.md` | `recorded docs/development.i18n.yaml`；两侧哈希均已更新（`development.md` → `32be857e…`，`development.zh.md` → `821d84be…`），涵盖 M1 与 S7 两处编辑 |
| `$PNPM run verify-translation-pairing --write packages/sdk/client/README.md` | `recorded packages/sdk/client/README.i18n.yaml`（第一轮） |
| `$PNPM run test:docs` | exit 1 —— `run-gates: 10 passed, 5 failed, 0 skipped`，与基线计数一致；失败门禁为 `markdown links`、`translation pairing`、`markdown wrap`、`agent note format`、`documentation standard tests` |
| 对 `test:docs` 输出执行 `rg -c "development\.md\|development\.zh\.md"` | **0** —— 本 Phase 的这对文件未出现在任何违规清单中 |

五个失败门禁已对本 Phase 的文件逐行检查。`translation pairing` 报告的是缺英文配对的 `docs/wiki/**` 页面、`packages/README.*` 与 `packages/sdk/server/README.*` —— 均非本 Phase 修改。`markdown links` 报告 `docs/wiki/**` 以及 `packages/ide/ide-bridge`、`packages/bundle/ide` 中的两个 `README.zh.md` 锚点。本 Phase 在第一轮**曾**引入一处违规并在同一轮修掉：从 `docs/development.zh.md` 链接 `#node-environment` 失败，因为中文页缺少显式锚点；在该标题上方加入 `<a id="node-environment"></a>` 后清除。
