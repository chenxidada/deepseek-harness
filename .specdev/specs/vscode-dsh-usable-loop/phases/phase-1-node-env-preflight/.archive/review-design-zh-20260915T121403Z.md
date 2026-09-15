# 设计一致性审查 — Phase 1 `phase-1-node-env-preflight`（回炉第 1 轮）

| 项 | 值 |
|---|---|
| 审查者 | `reviewer-design`（三视角并行审查；本文件只报告设计一致性视角） |
| Phase | `phase-1-node-env-preflight`（逐字取自 `phase-plan.md` DAG JSON） |
| 分支 | `impl-phase-1-node-env-preflight`（已核验：`git branch --show-current` → `impl-phase-1-node-env-preflight`；本轮为只读审查——未创建、修改或提交任何产品文件，只写入本报告及其中文版） |
| 轮次 | 回炉第 1 轮，被审对象是合并判决 **MUST-FIX** 后于 2026-09-15 18:32 重写的实现 |
| 被审产物 | `apps/vscode-dsh` + `packages/sdk/client` + `docs/development.*` 的工作区改动，以 `phases/phase-1-node-env-preflight/implementation.md`（revision "rework round 1"）为索引 |
| 通读文件 | `spec.md`、`implementation.md`（§1–§7）、`repo-exploration.md`、`design.md`（AD-1 – AD-16、§1.2、§3、§9 – §11）、`phase-plan.md`（Phase 1 行 + DAG JSON）、`requirements.md` AC-1 – AC-10、`tech-debt-registry.md`、`.archive/review-20260915T103312Z.md`（第 1 轮合并报告）、我自己的第 1 轮报告（启动时由我归档）、根 `AGENTS.md`、`packages/AGENTS.md`、`docs/AGENTS.md`、`constitution.md`，以及 `apps/vscode-dsh/src/{auto-start-orchestrator,session-host,extension,index,node-env-guard}.ts`、`apps/vscode-dsh/{package.json,tests/*}`、`packages/sdk/client/{src/*,README*.md}`、`docs/development*.md` 的完整 diff |
| 使用命令 | `git branch --show-current`、`git diff`、`git status -s`、`git hash-object`、`git grep`、`pnpm run typecheck`、`pnpm run test apps/vscode-dsh`、`pnpm run test packages/sdk/client`、`pnpm run test:docs`、`pnpm run verify-translation-pairing`、`pnpm exec tsx scripts/run-oxlint.ts …`、`grep`、`tail -c 1 \| xxd -p` |

本审查范围：**实现是否遵循既定架构与仓库约定。** 实现正确性与端到端连通性刻意不在本文件评估，分别属 `reviewer-correctness` 与 `reviewer-connectivity`。

## 启动自清理（协议第 0 步）

第 1 轮的 `review-design.md` 与 `review-design-zh.md` 仍在直接路径下。在写入任何新内容前，我仅用 `mv` 归档了两者（全程未执行任何 git 命令）：

```sh
PHASE_DIR=".specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight"
mv "$PHASE_DIR/review-design.md"    "$PHASE_DIR/.archive/review-design-20260915T103354Z.md"
mv "$PHASE_DIR/review-design-zh.md" "$PHASE_DIR/.archive/review-design-zh-20260915T103354Z.md"
```

`.archive/` 中同名时间戳的文件此前已由编排者预归档；上述 `mv` 使得直接路径下的报告是**本轮**这一份。未触碰 `current-status.json`。

## 判决

**SHOULD-FIX** —— **本视角无 must-fix。** 我第 1 轮提出的 M1 与 S7 已真实修复，其余 11 条也按声明修复，且本 Phase 引用的每一条架构决策（AD-1、AD-2、AD-4、AD-9、AD-10、AD-11）与 Constitution §2 在回炉后依然成立。剩余两项均为**本轮新增代码**内的低烈度约定问题（测试名/注释里的失效审查条目编号；一条新失败路径落入本 Phase 自己刚消除的通用错误类）。两者都不阻断本 Phase 的验收标准。

## 13 条逐条判定（全部修复，逐条给出独立证据）

| # | 来源 | 声称状态 | 我的独立判定 | 我执行或阅读的证据 |
|---|---|:--:|---|---|
| **M1** | reviewer-design（第 1 轮） | done | ✅ **已修复** | `docs/development.md:131` 现为 `…run \`Developer: Reload Window\` (\`workbench.action.reloadWindow\`) from the Command Palette.`，`docs/development.zh.md:136` 含同样三个记号。双语中不可判定条目均已消失，AC-3(d) 的逐条断言现可满足。约束已可执行而非停留在叙述层：`apps/vscode-dsh/tests/node-env-guard.spec.ts:116-124`（`DECIDABLE_ENTRY_TOKENS`，含 `workbench.action.reloadWindow`）与 `:158-164` 会在任一本机环境侧条目缺少记号时抛错。配对是**真重录**而非声称：`git hash-object docs/development.md docs/development.zh.md` 返回 `32be857e…` / `821d84be…`，与 `docs/development.i18n.yaml` 中两个哈希完全一致，且 `verify-translation-pairing` 的违规清单不含这两个文件。 |
| **M2** | reviewer-connectivity（编排者升格） | done | ✅ **已修复** | `auto-start-orchestrator.ts:27` 的 `START_ERROR_KINDS = ['missing-credentials', 'node-environment', 'process-failed']` 同时是类型（`:37`）与守卫（`:47-55`）的唯一来源；`:220` 现为 `this.errorKind = startErrorKindOf(error)`。成员集由构造保证一致：`session-host.ts:27` 导入 `StartErrorKind`，`:51` 声明 `HostStartErrorKind = StartErrorKind`；`:327` 的通用兜底抛 `process-failed`。`grep -rn "start-failed"` 覆盖 `apps/vscode-dsh/src`、`apps/vscode-dsh/tests`、`packages/sdk/client/src` → **零命中**。证据是运行时而非类型层：`auto-start-orchestrator.spec.ts:150-164` 把真实 `HostStartError('node-environment')` 抛过端口并断言 `snapshot.errorKind`；`:166-176` 钉住通用兜底；`node-env-guard.spec.ts:666` 在**真实扩展激活**路径上断言同一字段。我实跑三份文件：`Test Files 4 passed (4)` / `Tests 69 passed (69)`，退出 0。 |
| **S1** | correctness | done | ✅ 已修复 | `implementation.md:120`（AC-4 行）写作 `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}`，与 `node-env-guard.ts:275-282`、`node-env-guard.spec.ts:426-430` 一致。摘要中不再残留 `zstd`/`withResolvers` 的字段名写法。 |
| **S2** | correctness | done | ✅ 已修复 | `node-env-guard.ts:200` 现为 `this is the Extension Host's own Node.js executable, so set DSH_NODE_BIN or the dsh.nodeBin setting to a Node.js ^22.19.0 \|\| >=24.0.0 executable, or install a VS Code build whose bundled Node.js provides …`；文件中仅存的 `PATH` 记号是 JSDoc `:190` 那句「解析**绝不查询** `PATH`」。`grep -n "PATH" apps/vscode-dsh/src/node-env-guard.ts` → 1 处，即 `:190`。双向断言见 `node-env-guard.spec.ts:415-417`。 |
| **S3** | correctness | done，附实测更正 | ✅ 已修复，且更正**经我复核为真** | 两个数字我都复现：`run-oxlint.ts apps/vscode-dsh/src/extension.ts` → **22** 条、分布在 21 个不同行（`:271 :375 :380 :385 :407 :425 :662 :750 :1004 :1102 :1152 :1418 :1450 :1492 :1534 :1791 :2109(×2) :2110 :2111 :2270 :2272`）；`run-oxlint.ts --config .oxlintrc.staged.json apps/vscode-dsh/src/extension.ts` → **3** 条（`:2109:1`、`:2110:1`、`:2111:1`）。第 1 轮报告里的「3」正是 staged 规则集下的数字，与实现所述完全一致。`git diff` 显示 `extension.ts` 只有 5 个纯插入 hunk（`+48`、`+223-236`、`+2172-2190`、`+2253`、`+2256`），无任何诊断落于其中。 |
| **S4** | reviewer-design | done | ✅ 已修复 | `implementation.md` §5 第 10 条记录了 `"scope": "machine-overridable"` 与 `"markdownDescription"`，附各自理由并指明测试钉住了哪些行为面（`node-env-guard.spec.ts:508-517`）。已在 `apps/vscode-dsh/package.json:63,65` 确认存在。 |
| **S5** | reviewer-design | done（更强机制） | ✅ 已修复，且更强机制属实 | `node-env-guard.spec.ts:629-646` 只激活一次，先用 `first-node` 的 `settings.json` 启动一次，再用 `writeFile` 把同一文件改写为 `second-node` 并二次启动，断言第二次快照含 `second` **且不含** `first`。由于 `settingsFile` 的读取器（`:564-571`）每次调用都重读文件，该用例同时证伪「缓存设置值」与「缓存文件读取」，严格强于第 1 轮建议的「换一个会返回新值的替身」。§4.4 记录了该变异探针；**该变异本身我未重跑**。 |
| **S6** | reviewer-design | done | ✅ 已修复，且每次运行都自我证伪 | `node-env-guard.spec.ts:96-165` 定义 `CHECKLIST_LABELS`、`countOccurrences`、`sectionAfter`、`localEnvironmentEntries`、`assertChecklistStructure`（四个标题各恰出现一次；每条条目须命中 `DECIDABLE_ENTRY_TOKENS` 之一）。`:474-499` 对两份语言文件执行该断言后，**就地**从文档文本中删除每个覆盖面标题（`:487`），并要求同一函数抛错（`:489-491`）——「删除任一子清单标题必须导致 (b) 失败」现已是套件内断言，而不再依赖 verifier 的 grep。我未改动真实文档；就地删除使这一步不再必要。 |
| **S7** | reviewer-design | done | ✅ **已修复** | `docs/development.md:105` 现称版本下限「has one owner, `engines.node` in the root `package.json`, which the extension mirrors in the range it enforces and a test keeps equal to that field」；`docs/development.zh.md:110` 同义（「版本下限只由一个地方负责……扩展在被强制执行的范围内镜像该值，并由测试保证两者相等」）。副本关系已被明确表述为镜像。`grep -rn "declared once\|只声明一次\|声明一次"` 覆盖两份文档与两份 SDK README → **零命中**，旧措辞无残留。钉住等值的用例见 `node-env-guard.spec.ts:444-447`。配对已重录（见 M1）。 |
| **S8** | reviewer-design | done | ✅ 已修复 | `implementation.md` §5 第 11 条记录该路由决策与三条理由（`IdeSessionHost` 拥有进程/传输接口层、不得依赖 `vscode`；SDK 已把同一输入建模为 request 对象；`readNodeBinSetting` 区分「未设置」与「空字符串」）。代码已确认：`extension.ts:2253,2256` 读取后以 `nodeBinSetting` 传入 `IdeSessionHost.start()`；`session-host.ts:106-109` 声明该选项、`:285-287` 用它解析一次。 |
| **S9** | connectivity | done | ✅ 已修复，且双向可证伪 | `node-env-guard.ts:254-264` 接收 `ResolvedNodeExecutable`，构造 `{ ...process.env }`，在 `executable.electronRunAsNode` 时置 `ELECTRON_RUN_AS_NODE='1'`，并把 `env` 传给 `execFileAsync`。`node-env-guard.spec.ts:240-267` 使用一个仅在带该 flag 时才表现为 Node 的替身：`electronRunAsNode: true` → `ok:true`；`false` → `unusable`。因此无论是漏注入还是误注入该 flag，用例都会失败。 |
| **S10** | connectivity | done | ✅ 已修复 | `implementation.md` §5 第 12 条点名三个既有类型化观测面（`IdeSessionHost.onError`、`AutoStartOrchestrator.getSnapshot()/onChange`、`HostStartError{kind, diagnostic}`），并明确本 Phase 未新增 sink 类型、未新增 `HostFailureKind` 成员。我在本 Phase 的 diff 中确认不存在此类类型，Phase 2 的词汇所有权因此完整。 |

## 三处「与审查字面要求不同」的独立裁定

| # | implementer 的主张 | 裁定 | 我核查的依据 |
|:--:|---|---|---|
| 1 | 保留 `process-failed` 作为唯一通用成员 | **接受** | M2 的要求是**不得存在吸收类型化失败的万能类**，从未要求删除 `process-failed`。删除它会与已批准的下游 spec 冲突：`phases/phase-2-host-fail-loud-diagnostics/spec.md:61` 要求未知错误在记录中落到 `kind === 'other'`，并明文「对应 orchestrator 的 `errorKind === 'process-failed'`」。回炉后仍满足其精神：`process-failed` 只能经由 `startErrorKindOf` 的成文兜底抵达，第二个伞类 `'other'` 已消失（`START_ERROR_KINDS` 恰三个成员，未使用的 `'other'` 在 app 中不复存在）。 |
| 2 | 更正 S3 的数字而非采纳「3」 | **接受** | 上文已实测复核：门禁规则集下 22 条、`.oxlintrc.staged.json` 下 3 条。把 3 当作*那个*实测值等于用一个不可核验的数字替换另一个。 |
| 3 | 以「重写真实 `settings.json`」满足 S5，而非改进替身 | **接受** | 阅读 `:564-571` 与 `:629-646` 确认：读取器每次调用重读文件，故该用例同时证伪缓存读取与缓存值，并断言了第 1 轮要求的同一编排层效果。 |

## AD / Constitution 一致性核对表（回炉后）

| 设计要求 | 证据（`file:line`） | 判定 |
|:---|:---|:--:|
| **AD-1（落点）** 前置校验放 `apps/vscode-dsh/src/node-env-guard.ts`；SDK 只**加性**新增 `resolveNodeExecutableSpec()`，并让 `resolveDshLaunch()` 消费它 | `node-env-guard.ts:1-303`；`packages/sdk/client/src/launch.ts:128-146`（`resolveNodeExecutableSpec`）；`:177`（`options.nodeExecutable ?? resolveNodeExecutableSpec()`） | ✅ |
| **AD-1（SDK 内不得有 app 域）** `packages/sdk/client` 无探测、无诊断渲染、无失败分类 | SDK 全部改动只是一个解析函数、两个类型、一个选项字段。`packages/sdk/client/src/launch.ts:117-146` 明确写下口径，`README.md:58` 同义（探测与诊断属嵌入方）。SDK 中不存在任何 `NodeEnvironment*` 符号。 | ✅ |
| **AD-1（不变量：门槛与 spawn 共用同一对象）** | `session-host.ts:285-287` 解析一次，`:288` 校验该对象，`:300` 把同一对象作为 `HarnessClient` 的 `nodeExecutable`。反面亦被钉住：`session-host-preflight.spec.ts:163,183` 监视 `resolveNodeExecutableSpec` 并要求**恰好调用一次**，故任何回退式二次解析都会失败。 | ✅ |
| **AD-2** 能力判定、版本仅用于诊断、无版本比较分支 | `node-env-guard.ts:138-146` 仅以 `missingApis` 判定；`EXPECTED_NODE_RANGE` 只出现在文案（`:124`、`:193`）与钉常量的测试中。`unsupported-version` / 版本比较无残留。 | ✅ |
| **AD-4** 不新增状态机成员；类型化失败穿过 SDK 边界 | `HostStartError`（`session-host.ts:57-78`）携带 `kind` 与结构化 `diagnostic`；`StartErrorKind` 三个成员；本 Phase 未新增 `HostFailureKind`。 | ✅ |
| **AD-9（设置项契约）** `string`、默认 `""`、description 写明优先级与空值含义 | `apps/vscode-dsh/package.json:57-65`；由 `node-env-guard.spec.ts:503-517` 断言（type、default、`DSH_NODE_BIN`、`Extension Host`、empty、`22.19`、`24`） | ✅ |
| **AD-9（优先级：取第一个非空输入）** | `launch.ts:130-145`；`launch.spec.ts` 各用例 + `session-host-preflight.spec.ts:305-326`（环境变量压过设置项） | ✅ |
| **AD-9（无效设置 fail loud，绝不静默跳过）** | `session-host-preflight.spec.ts:155-235`（设置项 → missing 与 unusable：reject、无 witness 文件、无 bridge socket、`status === 'error'`、`resolveNodeExecutableSpec` 只调用一次） | ✅ |
| **AD-9（每次启动重读，不缓存跨启动结果）** | `extension.ts:2253` 在每次启动函数内读取；无模块级状态。现由可证伪用例（S5）承载。 | ✅ |
| **AD-10（单一落点，不得新建第三份 Node 文档）** | `docs/development.md:103-131` + `docs/development.zh.md:107-136`；`git status -s` 显示 `docs/` 下无新文档页；SDK README 新增节属该包自身公共面契约，不是第三份 Node 文档。 | ✅ |
| **AD-10（两张清单、本机侧按两覆盖面分列、写明优先级链）** | `docs/development.md:109-117`（仓库侧 5 行，每行含真实 `pnpm run …` 脚本）与 `:119-131`（`*Terminal side*` 3 条 / `*Extension subprocess side*` 3 条）；`:107` 写明优先级链；中文对照 `:112`、`:114-122`、`:124-136`。由套件强制（S6）。 | ✅ |
| **AD-10（文档门禁在本 Phase 内跑；预算处置顺序）** | 我实跑 `pnpm run test:docs` → `run-gates: 10 passed, 5 failed, 0 skipped`，与基线计数一致，且全输出中 `development.md`、`development.zh.md`、`sdk/client/README`、`node-env` 出现次数均为 **0**；`doc budgets` **PASS**。`docs/development.md` 不在 `scripts/doc-budgets.manifest.json`（我读文件确认仅 8 条）内，故未上调任何预算、也未为迁就预算删减内容——Relocate → Condense → Raise 顺序从未被触发。 | ✅ |
| **AD-11（Phase 1 不得引入竞争性的 Node 锁定路径）** | 本 Phase 未在 `apps/vscode-dsh/test-scripts/` 下新增任何文件；它交付的三级解析链正是 AD-11 所依赖的前提。 | ✅ |
| **Constitution §2.1 / §2.2 / §2.3** 单一职责、依赖方向、接口隔离 | 只有 `apps/vscode-dsh` → `@deepseek-ai/dsh-sdk-client`；`node-env-guard.ts` 仅从 SDK 导入**类型** `ResolvedNodeExecutable`，别无其他；SDK 从不导入 app。未引入环依赖。 | ✅ |
| **仓库约定**：ESM、跨包用包名、包内相对引用带 `.ts`、文件末尾恰一个换行 | `session-host.ts:29` `from './node-env-guard.ts'`；`node-env-guard.ts:13` 包名导入；`tail -c 1 \| xxd -p` 对 `.nvmrc`、两份新 spec、guard、两份 `docs/development*.md`、两份 SDK README 均为 `0a` | ✅ |
| **仓库约定**：所有新导出有 JSDoc，函数类导出含 `@param`/`@returns` | `node-env-guard.ts`（模块级 + 每个导出）、`session-host.ts:42-78`（类型、类、构造函数 `@param`）、`launch.ts:119-130`、`types.ts:23-46`、`extension.ts:222-234` / `:2172-2180`；`index.ts:25-37` 仅 re-export，无需 JSDoc | ✅ |
| **spec 约束**：不得引入新依赖 | 两份 manifest 的 `git diff` 未新增任何 dependency 键；探测只用内建模块 `node:child_process`、`node:fs`、`node:fs/promises`、`node:util`。 | ✅ |
| **spec 约束**：禁止降级/回退/跳过分支 | 三级只有两种结局：命中即使用，或 fail loud。空白字符串的不对称正是 spec 自己的边界清单（`DSH_NODE_BIN='   '` 视为已设置 → fail loud；`dsh.nodeBin='   '` 视为未设置 → 下一级），与第 1 轮一致，已记为偏差 3。 | ✅ |
| **公共面文档同步** | `packages/sdk/client/README.md:56-58` 与 `README.zh.md:56-59` 描述了解析函数、优先级与「校验对象回传」；该文件对不在 `verify-translation-pairing` 违规清单中（即 `.i18n.yaml` 为最新）。 | ✅ |

## 本轮新增发现

### 🟡 New-S1 — 本轮新增代码中存在失效的审查条目编号引用

`apps/vscode-dsh/tests/node-env-guard.spec.ts:240` 的 `it('probes a process-exec-path candidate in the Electron mode the spawn will use (S9)', …)`、`:629` 的 `it('re-reads the setting on every start instead of caching the first value (S5, AD-9)', …)`，以及 `:664-665` 的注释 `// M2: the class crosses the host → orchestrator hop intact, …`，引用的是**审查报告条目编号**，而非 spec/design 标识。

- `(AD-9)` 可在 `design.md` 中解析；`(S9)` / `(S5)` / `M2` 只能解析到位于 `.archive/` 的第 1 轮审查报告。代码读者无法解析它们，这正是仓库行文标准所禁止的「失效的设计会话引用 / 审查条目码」一类（`docs/AGENTS.md` 写作规则：注释「state complete contracts, not reasoning transcripts … delete narration, test walkthroughs, review analysis, and code restatement」）。
- 并非既有惯例：`git grep -nE "\((M[0-9]|S[0-9]+)[,)]"` 覆盖已跟踪的 `*.ts`/`*.tsx`，只命中无关的会话夹具标识（`packages/api/session-controller/tests/manager.client.spec.ts` 中的 `S1`/`S2` 取值），从未命中审查条目码。
- 最小修法：保留行为描述、去掉引用——`(S9)` → 直接描述 Electron 探测模式；`(S5, AD-9)` → `(AD-9)`；`// M2: ` → 直接陈述不变量（「类必须穿过该跳转，使消费者把失败归因于 Node 环境」）。`AD-`/`AC-` 引用是本 app 的既有行文风格（`extension.ts` 35 处、`conversation-controller.ts` 58 处），无需改动。
- 烈度：仅约定层面。无门禁会捕获，也无任何验收标准依赖它。

### 🟡 New-S2 — 新增的「`dsh.nodeBin` 非字符串」路径落入通用错误类

`extension.ts:2173-2185` 对非字符串设置抛出一个普通 `Error`；`createStartHostPort` 原样重抛同一 `Error`（`:2276-2278`）；`startErrorKindOf`（`auto-start-orchestrator.ts:47-55`）找不到 `kind`，返回 `'process-failed'`。

- 于是本轮为设置来源新加的这条失败路径，在**结构化通道上**被归类为 dsh 侧进程失败，而同来源的「路径校验失败」被归类为 `node-environment`——正是 M2 旨在消除的不对称，且出现在一条新分支上。`node-env-guard.spec.ts:673-686` 只断言 `state === 'failed'`、host start 未被调用、消息含 `dsh.nodeBin` 与 `string`，**未断言 `errorKind`**，因此该行为既未被记录也未被断言。
- 范围说明（为何是 should-fix 而非 must-fix）：没有任何 AC 枚举「非字符串设置」这一情形。AC-10 的无效设置分支是「指向的路径无效或缺少 AC-4 所列 API」，`spec.md:106` 的边界清单覆盖空白 / 非空但无效路径，不含类型错误。用户可见文案仍是环境口径（点名 `dsh.nodeBin` 与期望类型），故 AC-9 的面向用户那一半未被违反。`implementation.md` §5 第 11 条记录了*为何*提前抛错，却未记录为何沿用通用类。
- 两种修法任选：抛出 `HostStartError('node-environment', …)` 形态的错误（或让 `readNodeBinSetting` 带出 `kind`）并补断言；**或**在 §5 记录该选择及理由。两者都是一行级决策；也可由编排者登记为 Phase 2 债务，因为失败词汇归 Phase 2 所有。

### 🟢 观察（新增，无需动作）

- **New-O1 — 我对 lint 基线的重数。** 本轮 `pnpm run lint`：退出 1，共 **10 381** 条诊断、**263** 个不同路径，而 `implementation.md` §4.3 写 10 382 / 263。文件数与逐文件表完全吻合；单行差异属计数方式噪声（我统计的是匹配 `: (error|warning) ` 的行）。不影响「零新增」结论。
- **New-O2 — 给 verifier 的测量方法警告。** 单文件 `run-oxlint.ts <file>` 与门禁的目录遍历**不可比**：既有的 `apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts` 门禁报 **14** 条、单文件调用报 **36** 条；本 Phase 的 `node-env-guard.spec.ts` 门禁报 **0** 条、单文件调用报 **109** 条（`no-unsafe-call` ×41、`no-unsafe-assignment` ×29、`no-unsafe-argument` ×21、`no-unsafe-member-access` ×16、`no-unsafe-return` ×2），`session-host-preflight.spec.ts` 门禁 0 / 单文件 96。差异源于类型程序解析（`apps/vscode-dsh/tsconfig.json` 仅 include `src`），与文件内容无关。§4.3 的表是用门禁命令取的，因此正确；任何用显式路径重测的 verifier 都会看到幻影诊断，必须改为跑 `pnpm run lint` 后 grep。
- **New-O3 — `PROBE_TIMEOUT_MS = 10_000`**（`node-env-guard.ts:30`）是模块常量而非 `Config` 字段。仓库「不得硬编码 tunable」规则的作用域是 Cordis 插件（`packages/AGENTS.md` / 根 `AGENTS.md`），而 `apps/vscode-dsh` 是无 `cordis.yml` 配置面的私有 app，故不适用；且该上限会打印进诊断文案，失败时会自述所用值。仅记录，避免后来的读者误判为疏漏。
- **New-O4 — `unusable` 仍是 app 内部的第四类失败**（偏差 2），与第 1 轮一致，仍接受：AC-4/AC-7/AC-8 未枚举封闭分类集，该类别按 AC-7 要求阻止 spawn，并通过 `probeDetail`（`:219-221`）保持 AC-8(d) 真实，而非打印从未观测到的 API 名。

## 我执行的证据（命令与真实输出）

所有命令均在仓库根、`export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` 之后执行，并使用 `pnpm --config.verify-deps-before-run=false`。

| 命令 | 观测 | 判读 |
|---|---|---|
| `git branch --show-current` | `impl-phase-1-node-env-preflight` | 分支正确，无停止升级条件。 |
| `pnpm run typecheck` | 退出 **0**（`tsc -b tsconfig.client.json` 完成） | 与 spec 的绿基线一致，无回归。 |
| `pnpm run test packages/sdk/client` | `Test Files 3 passed (3)` / `Tests 84 passed (84)`，退出 **0** | 基线为 3 文件 / 73 用例；+11 用例属本 Phase。绿。 |
| `pnpm run test apps/vscode-dsh` | `Test Files 4 failed \| 46 passed (50)` / `Tests 6 failed \| 350 passed \| 1 skipped (357)`，退出 1 | 失败文件恰为基线那四个：`panel-close-delete.e2e.spec.ts`、`spike-t0a-replay-rebuild.spec.ts`（4 例）、`spike-t0b-continue-capability.spec.ts`、`verifier-phase1/layer-a-rtl.spec.tsx`——身份与 6 例计数均与 spec 快照一致。**零新增失败。** |
| `pnpm run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | `Test Files 4 passed (4)` / `Tests 69 passed (69)`，退出 **0** | 与 §4.2 完全一致。 |
| `pnpm run test:docs` | `run-gates: 10 passed, 5 failed, 0 skipped`；失败 = markdown links、translation pairing、markdown wrap、agent note format、documentation standard tests。`grep -c "development\.md\|development\.zh\.md"` → **0**；`grep -c "sdk/client/README"` → **0**；`grep -c "node-env"` → **0**。`doc budgets` **PASS**。 | 计数与门禁集合与基线快照一致；本 Phase 的文档对不出现在任何违规清单，且无预算门禁被触发。 |
| `pnpm run verify-translation-pairing` | 退出 1；违规为 `docs/wiki/**`、`apps/vscode-dsh/README.md`、`.agents/notes/…dual-channel.md`、`packages/README.*`、`packages/sdk/server/README.*` | 既不含 `docs/development.md(+.zh.md)` 也不含 `packages/sdk/client/README*` → 两对均为最新。 |
| `git hash-object docs/development.md docs/development.zh.md` 对比 `docs/development.i18n.yaml` | `32be857e74680f7631e85dcb7ed9fe21595e8111` / `821d84beefd40770ca4f5583a1aaeab64672432b`——两侧完全相等 | M1 的「已重录配对」是真重录，非声明。 |
| `pnpm run lint` | 退出 1；10 381 条诊断 / 263 路径；`node-env-guard.ts`、`node-env-guard.spec.ts`、`session-host-preflight.spec.ts` 各 **0** 条；`auto-start-orchestrator.spec.ts` 4 条（均为既有行）；`auto-start-orchestrator.ts:230` 1 条（文本未变、仅因 `:220` 替换而位移——已由 `git diff` 确认）；`session-host.ts:595` 1 条 | 在门禁命令下，本 Phase 未新增任何可归因诊断。 |
| `run-oxlint.ts apps/vscode-dsh/src/extension.ts` / `… --config .oxlintrc.staged.json …` | 22 / 3 | S3 的更正数字两者均可复现。 |
| `git diff -- packages/sdk/client/{src,README.md,README.zh.md}`、`-- apps/vscode-dsh/src/*` | 加性解析函数 + 类型 + 选项字段；guard、host 前置校验、扩展读取、编排器分类 | AD-1/AD-2/AD-9 的一致性是从源码读出，而非采信摘要。 |
| 对 8 个新增/改动文件 `tail -c 1 \| xxd -p` | 全部 `0a` | 末尾换行约定成立。 |
| `grep -rn "start-failed"` / `"declared once"` / guard 内 `"PATH"` | 零命中 / 零命中 / 仅 1 处 JSDoc | 第 1 轮各项无残留。 |

## 未验证项

- 我**未重跑** `implementation.md` §4.4 的四个证伪变异（M2 变异、S9 的 `&& false`、S5 的记忆化、S6 的文档删除）。我改为核查每个探针都有可失败的对应断言：S9 双向断言该 flag，S5 每次调用重读真实文件，S6 每次运行就地删除标题，M2 在「端口 → 快照」与「真实激活」两个层面均有断言。变异本身应由 verifier 重跑。
- 我未运行 `pnpm run doc-sync`：spec 把它留给 Phase 4，本 Phase 的义务是 `pnpm run test:docs`，我已运行。
- `packages/sdk/client` 的逐文件 100% 覆盖率无法由 diff 判定；`launch.spec.ts` 新增 11 用例且套件为绿，但只有 `test:coverage` / `test:coverage:partitioned` 能证明该门禁。
- New-S2 的运行时归类（非字符串设置 → `errorKind === 'process-failed'`）是从代码路径推导（`extension.ts:2173-2185` → `:2276-2278` → `auto-start-orchestrator.ts:47-55`），**未实跑**；无测试断言它。若 verifier 想观测，请在临时副本中补断言，而不要写入本 Phase 的文件。
- AC-1(b) 的字面口径「在三个安装根下定位 `.nvmrc` 版本并校验该解释器」在套件中仍以 `process.execPath` 加对钉住字符串的范围检查近似（`node-env-guard.spec.ts:449-461`）；与第 1 轮一致，仍属 verifier 的义务。
- 我未评估 AC-4 / AC-7 / AC-8 / AC-9 / AC-10 的行为**是否正确**（属 `reviewer-correctness`），也未评估端到端接线（属 `reviewer-connectivity`）。
