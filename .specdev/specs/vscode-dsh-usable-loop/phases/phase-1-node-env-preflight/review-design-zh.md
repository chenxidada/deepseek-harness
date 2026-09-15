# Phase 1 `phase-1-node-env-preflight` 设计一致性审查（第 3 轮）

## 视角

**设计一致性（Design Consistency）** —— 代码是否遵循既定架构（`design.md` 的 AD 决策、仓库约定、既有模式）？

## 元信息

| 项 | 值 |
|---|---|
| 工作流 | `vscode-dsh-usable-loop` |
| Phase | `phase-1-node-env-preflight`（取自 `phase-plan.md` DAG JSON） |
| 轮次 | **第 3 轮** —— 回炉 2（D-1 / D-2 / N1）之后的首次审查 |
| 分支 | `impl-phase-1-node-env-preflight` —— `git branch --show-current` 输出 `impl-phase-1-node-env-preflight`。**相符，继续审查。** |
| 启动自清理 | 无需归档：启动时直接路径下**不存在** `review-design.md` / `review-design-zh.md`（调度者已把我的第 2 轮产物移入 `.archive/review-design-20260915T121403Z.md` / `…-zh-…`）。未执行 `mv`，也未用任何 git 命令做清理。 |
| 本轮范围 | D-1（条目码）、D-2（`invalid-setting` 词表）、N1（AC-1(b) 三处定位），以及是否有 AD 决策被偏离 |
| 审查者 | `reviewer-design`（三视角并行之一；正确性与连通性各有独立报告） |

### 已完整阅读

`spec.md`、`implementation.md`（第 2 轮回炉重写稿，§1–§7）、`implementation-zh.md` §1.3、`.archive/review-20260915T121304Z.md`（第 2 轮合并报告）、`.archive/review-design-20260915T121403Z.md`（我自己的第 2 轮报告）、`design.md` AD-1 – AD-16 + §1 + §2 + §8 + §9 + §11、`design-zh.md`（AD-4 行）、`verification.md`（已作废的 PARTIAL，仅作背景）、`repo-exploration.md`、`requirements.md` AC-1 – AC-10、`phase-plan.md`、`tech-debt-registry.md`、`phases/phase-2-host-fail-loud-diagnostics/spec.md`、`current-status.json`、根 `AGENTS.md`、`docs/AGENTS.md`、`packages/AGENTS.md`，以及被改动的源码本体：`apps/vscode-dsh/src/{auto-start-orchestrator,session-host,extension,node-env-guard,index}.ts`、`apps/vscode-dsh/tests/{node-env-guard,auto-start-orchestrator,session-host-preflight}.spec.ts`、`apps/vscode-dsh/package.json`、`packages/sdk/client/{src/*,tests/launch.spec.ts,README*.md}`、`docs/development.md`(+`.zh.md`)、`.cursor/skills/project-{build,test}/SKILL.md`。

## 判决

**SHOULD-FIX** —— **本视角无 MUST-FIX。**

本轮被派来修的三条**全部真修复**，且由我独立核验：D-1（审查条目码已清除、`AD-*` 保留）、D-2（`invalid-setting` 是真实且正确传播的词表成员；AD-4 的扩展**不构成**跨 Phase 越界 —— 裁定见 §3.3）、N1（`spec.md`/`.nvmrc` 未被改动；AC-1(b) 用例现已定位并校验被 pin 的版本，定位不到时以非 PASS 结束）。本 Phase 引用的每一条 AD 决策（AD-1、AD-2、AD-4、AD-9、AD-10、AD-11）在回炉后依然成立。

剩余的是 4 条**文档保真**问题，均落在本 Phase 自己新增的文字里，都不改变行为、不影响任何验收标准、也不违反任何设计决策：两处 `(AD-10)` 引用应读作 `AD-9`（D-3）；两句 JSDoc 的作用域断言已不再覆盖它刚被扩展去描述的那个成员（D-4）；`implementation.md` §2.3 有一行归属说明与其描述的文件自相矛盾（A-1）。鉴于本 Phase 的 `loop_count` 已达上限 2，我刻意未对其中任何一条加码：它们都不是对已声明架构决策的偏离，按本视角的判决规则均不构成 MUST-FIX。

## 1. 实际执行的命令（含真实输出片段）

所有 `pnpm` 调用均带 `export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` 与 `--config.verify-deps-before-run=false`。

| # | 命令 | 结果 |
|---|---|---|
| 1 | `git branch --show-current` | `impl-phase-1-node-env-preflight` |
| 2 | `pnpm run typecheck` | **exit 0** —— `tsc -b tsconfig.client.json`，无 `error TS` |
| 3 | `pnpm run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | **exit 0** —— `Test Files 4 passed (4)`，`Tests 70 passed (70)`，**0 skipped** |
| 4 | `pnpm run test apps/vscode-dsh packages/sdk/client` | exit 1 —— `Test Files 4 failed \| 49 passed (53)`，`Tests 6 failed \| 435 passed \| 1 skipped (442)` —— 与 spec 的红色基线（4 文件 / 6 用例）完全一致 |
| 5 | `pnpm run lint`（权威 `.oxlintrc.json`） | exit 1 —— 锚定正则计 **10 381** 行诊断，覆盖 **262** 个文件 |
| 6 | `pnpm run test:docs` | exit 1 —— `run-gates: 10 passed, 5 failed, 0 skipped in 24.03s`；**`doc budgets` PASS**；`grep -c "development\.(md\|zh\.md)"` → **0**；`grep -c "design\.md\|design-zh\.md"` → **0** |
| 7 | `git diff --stat -- …/phase-1-node-env-preflight/spec.md .nvmrc` | **空** → 两者均未被修改 |
| 8 | `git diff --check -- apps/vscode-dsh packages/sdk/client docs` | exit 0，无输出 → 本轮未引入空白/EOF 破坏 |
| 9 | 三个被改源文件的 `git diff -U0` hunk 头 | 见 §5 —— 每一条 lint 诊断都落在新增区间之外 |

`第 5 次运行的片段`（逐文件，这才是差量验收的凭据）：

```
apps/vscode-dsh/src/auto-start-orchestrator.ts:236:24: error typescript(no-non-null-assertion)
apps/vscode-dsh/src/session-host.ts:597:3: error typescript(require-await)
apps/vscode-dsh/src/extension.ts:2272:9: error typescript(no-unnecessary-condition)
apps/vscode-dsh/src/extension.ts:2274:9: error typescript(no-unnecessary-condition)
apps/vscode-dsh/src/index.ts:97:3: error typescript(no-deprecated)
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:52:39 … :53:9 … :95:36 … :96:9
```

`第 6 次运行的片段`：

```
run-gates: PASS doc budgets (0.69s)
run-gates: 10 passed, 5 failed, 0 skipped in 24.03s.
run-gates: unsuccessful gates:
  - FAILED markdown links  - FAILED translation pairing  - FAILED markdown wrap
  - FAILED agent note format  - FAILED documentation standard tests
```

失败的 5 个门禁及其名称**完全等于** `spec.md`「执行环境与基线快照」记录的基线集合；本 Phase 的文档对与 `design.md`/`design-zh.md` 在输出中**一次都没有出现**。

## 2. D-1 —— 清除测试名与注释中的审查条目码：**已修复**

扫描（"零残留"的可执行定义，范围覆盖整个 app）：

```
grep -rnE '\((S[0-9]+|M[0-9]+)|//\s*(M[0-9]+|S[0-9]+)\b|\[(M|S)[0-9]+\]' apps/vscode-dsh/
→ No matches found
```

第 2 轮点名的四处均已清除，且各自保留了描述性的一半：

| 位置 | 现文本 |
|---|---|
| `node-env-guard.spec.ts:267` | `probes a process-exec-path candidate in the Electron mode the spawn will use`（条目码已去，行为描述保留） |
| `node-env-guard.spec.ts:685` | `re-reads the setting on every start instead of caching the first value (AD-9)` |
| `node-env-guard.spec.ts:698-699` | `// A cached resolution or setting value would still report the first path here.` |
| `auto-start-orchestrator.spec.ts:144` | `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4)')` |

**`AD-*` 未被误删** —— 反向检查显示每条有架构含义的引用都完好：`node-env-guard.spec.ts:216` `(AD-2)`、`:685` `(AD-9)`；`auto-start-orchestrator.spec.ts:14` `/** Compile-time check that both failure vocabularies are the same set (AD-4). */`、`:144` `(AC-9, AD-4)`。这条切分线是对的：`S*`/`M*` 是只能回溯到已归档审查报告的审查条目码（`AGENTS.md` 禁止保留审查史），而 `AD-*`/`AC-*` 指向活的设计/需求文档，是本模块既有的行文惯例。

**该改动未产生新的门禁破坏**：五个被改的源/测试文件末尾均为恰好一个 `0a` 字节，且 `git diff --check`（pre-commit 的空白/EOF 门禁）exit 0 且无输出。

## 3. D-2 —— 非字符串 `dsh.nodeBin` 独立归类：**已修复**，且唯一的设计文档改动是站得住的

### 3.1 现在的链条

| 环节 | 证据 |
|---|---|
| 词表唯一真相源 | `START_ERROR_KINDS = ['invalid-setting', 'missing-credentials', 'node-environment', 'process-failed'] as const`（`auto-start-orchestrator.ts:27-32`；按字母序，无不可解释的不对称），`:43` 派生 `StartErrorKind`，`:53-61` 的 guard `startErrorKindOf` 只接受这些成员，其余一律归一化为 `process-failed` |
| 跨跳变共享同一个类 | `session-host.ts:53` —— `export type HostStartErrorKind = StartErrorKind`（类型别名，因此**与该数组的集合相等是结构性的，而非约定性的**） |
| 抛出点 | `extension.ts:2184-2189` —— `throw new HostStartError('invalid-setting', \`${NODE_BIN_SETTING} must be a path to a Node.js executable string, got ${typeof value}\`)` |
| 相对 Host 的位置 | 读取在 `extension.ts:2255`，`await next.start({…})` 在 `:2256` → 该失败在任何 host 存在**之前**抛出 |
| 投影到面向 UI 的快照 | `node-env-guard.spec.ts:729-747`：用 spy 断言 `IdeSessionHost.prototype.start` **未被调用**，然后 `snapshot.state === 'failed'`、`snapshot.errorKind === 'invalid-setting'`、消息含设置 id 与 `string` |

### 3.2 问题 1 —— 三处词表一致性：**一致**

| 来源 | 成员集合 | 判定 |
|---|---|---|
| `auto-start-orchestrator.ts:27-32`（数组；运行时 + 类型） | `{invalid-setting, missing-credentials, node-environment, process-failed}` | 权威 |
| `auto-start-orchestrator.ts:34-42`（`StartErrorKind` JSDoc） | 非枚举，但绑定同一声明；点出 `node-environment`、`invalid-setting`、`process-failed`，并声明与 `HostStartErrorKind` 逐成员对齐 | 一致 |
| `session-host.ts:42-53`（`HostStartErrorKind` JSDoc） | `HostStartErrorKind = StartErrorKind`；文字点出 `node-environment`（AC-7/AC-9）、`invalid-setting`、`process-failed`（AD-4） | 一致 |
| `design.md:186` / `design-zh.md:187`（AD-4 取舍） | 工作流级并集且带 Phase 标注：既有 `missing-credentials` / `process-failed` + 本工作流新增的 `node-environment` / `invalid-setting`（**Phase 1**）+ `spawn` / `handshake-timeout` / `bridge-listen`（**Phase 2**） | 一致 —— 其 **Phase 1 子集恰好等于该数组** |

唯一的不对称在文字层面，且性质上属既有风格：两处 JSDoc 都没有枚举 `missing-credentials`（它只出现在 AD-4 与 `connection-ui.ts` 的等值判断中）。这是刻意的行文取舍而非漂移 —— 类型别名加上唯一数组使文字漂移在结构上不可能发生，而 `typecheck` exit 0 是"无联合成员漏处理"的机械确认。

### 3.3 问题 2 —— AD-4 扩展的越界裁定：**不构成跨 Phase 越界**

我认真考虑过"越界"读法并予以否决，依据四条：

1. **声明点本就属于 Phase 1。** `HostStartError` 本身、以及 orchestrator 所投影的共享词表，都是 Phase 1 的交付物（`spec.md` §产出清单：`apps/vscode-dsh/src/session-host.ts` —— 类型化 `HostStartError`；`apps/vscode-dsh/src/index.ts` 再导出）。这个集合不是被 Phase 1 借用的 Phase 2 产物，而是 Phase 2 继承的既有物。
2. **该成员只关乎 Phase 1 新引入的面。** `dsh.nodeBin` 在 `HEAD` 上并不存在；`contributes.configuration` 由本 Phase 首次引入。只有 Phase 1 创建的设置项出现类型错误，归类责任就在 Phase 1。
3. **不加该成员会重新打开第 1 轮已关闭的缺陷（M2）。** 两个替代方案都更糟：复用 `node-environment` 会破坏 `session-host.ts:62` 声明的不变式（"Pre-flight diagnostic; present exactly when `kind` is `node-environment`"），因为从未探查过任何解释器 —— 而 Phase 2 的记录契约依赖 `node-environment` 失败携带 `diagnostic`；使用 `process-failed` 则把用户的配置笔误归咎于 `dsh` 进程，这正是 AC-9 在精神上禁止的压平，`node-env-guard.spec.ts:741-744` 的注释现在也把它记为新增该成员的理由。
4. **AD-4 自身文本就使词表按构造可分期扩展** —— "属于加性扩展" —— 且第 3 轮的改动是纯加性的：未新增任何 Phase 2 成员（`spawn` / `handshake-timeout` / `bridge-listen` 仍不在数组中），未新增任何 `StartOrchestratorState` 成员，未删除任何 `StartErrorKind` 成员。

**Phase 2 必须登记的一条后果（建议，非阻塞）。** 由于抛出点在扩展侧、位于 `IdeSessionHost.start()` **之前**，该失败永远不会到达 host；因此 Phase 2 的兜底条款「凡是 `IdeSessionHost.start()` 期间的任何抛错…都会产出一条诊断记录」（`phases/phase-2-host-fail-loud-diagnostics/spec.md:48`）**不覆盖**它，AD-14 的记录 `kind` 词表（`design.md:307`）也没有对应成员。Phase 2 没有任何验收标准要求为该情形出记录（AC-14…AC-18 枚举的是具体边界），所以这是交接说明，不是 Phase 1 的缺陷。若 Phase 2 希望覆盖，按顺序应改：

- `phases/phase-2-host-fail-loud-diagnostics/spec.md:61` ——「边界与反向用例清单」：补入"设置取值类型错误导致的启动失败不产生诊断记录"，并写明由哪一观测承接（orchestrator 快照的 `errorKind` + 连接区文案）。
- `phases/phase-2-host-fail-loud-diagnostics/spec.md:88` —— `auto-start-orchestrator.ts` 产出清单行：登记 `invalid-setting` 与共享的 `START_ERROR_KINDS` 数组/guard **已由 Phase 1 交付**，Phase 2 只新增自己的成员，不得重复声明该数组。
- `design.md:307`（AD-14 `kind` 词表）—— **仅当** Phase 2 决定为该情形出记录时：明确其归入 `other`（该枚举既有的兜底成员），而不是再次扩宽 AD-4。

我不会去改这些文件 —— 它们在本 Phase 的审查面之外，也在我的写入边界之外。

### 3.4 问题 3 —— 是否真的没有复用 `node-environment`：**确认没有**

`session-host.ts` 中只有两处 `HostStartError` 构造点：`:324` `new HostStartError('node-environment', …, { cause, diagnostic: error.failure })` 位于 `NodeEnvironmentError` 的 catch 内，`:329` `new HostStartError('process-failed', …)`。`invalid-setting` 的抛出点在 `extension.ts`，且**未传任何 options**，因此 `this.diagnostic` 保持 `undefined` —— 与 `:62` 的不变式一致。invalid-setting 路径没有伪造任何 pre-flight 诊断。

### 3.5 问题 4 —— `design.md`/`design-zh.md` 双语同步：**已同步**

`design.md:186` 与 `design-zh.md:187` 是同一句话的两种语言版本，包括 Phase 标注与括号内的 `（Phase 1，\`dsh.nodeBin\` 取值类型错误）`。两份文件都没有第二处需要同样修改的 `StartErrorKind` 枚举：对 `.specdev/specs/vscode-dsh-usable-loop/**` 执行 `grep "invalid-setting"` 只命中 AD-4 两行、`current-status.json` 的第 2 轮日志，以及本 Phase 自己的 `implementation*.md`。AD-14 的 `kind` 枚举（第 307 行）是另一个刻意更窄的词表，正确地未列入 `invalid-setting`（见 §3.3 的交接说明）。

### 3.6 问题 5 —— 仓库约定：**符合**，但有一处行文精确性问题（§6 的 D-4）

- 两个被改函数的 JSDoc 完备：`readNodeBinSetting` 带 `@param vscode` 与 `@returns`（`extension.ts:2172-2179`）；`startErrorKindOf` 带 `@param error` / `@returns`（`auto-start-orchestrator.ts:45-52`）。
- 无 `any`，无品牌类型误用（文件系统路径不是跨边界的不透明 id —— 与 SDK 中 `ResolvedNodeExecutable.path` 的既有选择一致），无硬编码 tunable（`invalid-setting` 是词表常量而非随部署变化的选项），设置项仍是"由属主显式 resolve 的输入"，没有变成 `run()` 内部的隐式 `?? default`。
- 新用例的注释陈述的是**不变式**而非叙述代码（`node-env-guard.spec.ts:741-743`：为何该类必须穿过这次跳变）—— 这是正确的语域。无 CoT 泄漏：未引用未提交草稿的 `§N`、无 `(decision N)`、无审查史引用。
- 需修正一处：两句宣称其词表即 `IdeSessionHost.start` 所抛内容的 JSDoc，在其中一个成员改为更早抛出之后已不准确（见 §6 D-4）。

## 4. N1 —— AC-1(b) 三处定位：**已修复**

| `spec.md` AC-1 验证策略 (b) 的要求 | 现状 |
|---|---|
| `spec.md` 的 AC-1 文本未被改动 | **已验证** —— 对 `spec.md` 与 `.nvmrc` 的 `git diff --stat` 相对 `HEAD` 为**空** |
| `.nvmrc` 内容未被改动 | **已验证** —— 仍为恰好一行 `24.3.0`；该值现在由用例读取，而非写死假设 |
| 定位 `/usr/local/n/versions/node/<v>` | `pinnedInstallRoots()`（`:89-101`），版本命名根，存在即命中 |
| 定位 `~/.nvm/versions/node/v<v>` | 同一 helper 的第二个根 |
| 定位 `command -v node` | `nodeOnPath()`（`:103-107`，经 `spawnSync('sh', ['-c','command -v node'])`），并要求 `reportedVersion()`（`:109-113`）报出被 pin 的版本 |
| 对定位到的解释器调用 `validateNodeEnvironment` 且要求 `ok:true` | `:506-515` —— `expect(validation.ok).toBe(true)` **且** `expect(validation.report.version).toBe(pinned)` |
| 三处均无 ⇒ 以非 PASS 结束并在 `verification.md` 写明 | `ctx.skip(located.length === 0, \`no install of ${pinned} to locate; checked ${checked.join('; ')}\`)`（`:502-505`），消息含 pin 版本与三处已查路径；`implementation.md` §6.6 写明了 verifier 必须将其记为非 PASS 而非成功 |

第 2 轮指出的名实不符已消除：承载三处定位逻辑的用例名为 `locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b)`，而单纯的 `.nvmrc` 内容断言被拆到 `:476-482` 的 `(AC-1 a)` 用例。新用例在 `PATH` 命中上**比 spec 文本更严**（只有该解释器确实报出被 pin 的版本才算命中），因此不可能削弱该验收标准。

我重新实测的机器事实，用以确认该用例在本机并未静默跳过：

```
.nvmrc                          → 24.3.0
/usr/local/n/versions/node/     → 22.9.0  24.3.0          （24.3.0 存在 → n 根命中）
~/.nvm/versions/node/           → v20.16.0  v22.14.0      （无 v24.3.0 → nvm 根落空）
前置 PATH=/usr/local/n/versions/node/24.3.0/bin 后：
  command -v node               → /usr/local/n/versions/node/24.3.0/bin/node (v24.3.0 → PATH 命中)
```

且上文第 3 次运行报 `Tests 70 passed (70)`、**0 skipped**，即 AC-1(b) 用例确实执行（约 53ms，与真正 spawn 定位到的解释器相符）而非跳过。`ctx.skip` 的语义与 spec 的条款相称：skip 是可被机器读出的非 PASS 结局（`Tests N skipped`）且携带原因字符串；而硬写 `expect(...).toBeGreaterThan(0)` 会让单测在"本机没装该版本"的机器上直接失败 —— 正是第 2 轮要求 implementer 避免的反模式。

## 5. AD 符合性对照（仅本轮改动）

| design.md 决策 | 本轮是否触及 | 符合 | 证据 |
|---|---|---|---|
| **AD-1** 门槛与 spawn 共用一个解析结果 | 否（仅在下游新增一个类成员） | ✅ | `node-env-guard.ts` 与 `packages/sdk/client/src/launch.ts` 本轮未改动（`git status -s` 无修改项）；第 2 轮证据（spy 断言 `resolveNodeExecutableSpec` 恰好一次）依然成立 |
| **AD-2** 能力判定，版本号仅用于诊断 | 否 | ✅ | 本轮 diff 中不存在版本比较；`invalid-setting` 由 `typeof value` 判定，与版本无关 |
| **AD-4** 复用 `failed`，加性扩展 `StartErrorKind` | **是** | ✅ 加性 | 数组 `:27-32`；未新增 `StartOrchestratorState` / `ConnectionUiPhase` 成员；未新增 Phase 2 成员；`design.md:186` + `design-zh.md:187` 同步；裁定见 §3.3 |
| **AD-9** 提供 `dsh.nodeBin`，fail loud，绝不静默回退 | **是（仅归类）** | ✅ | `readNodeBinSetting` 对未设置返回 `undefined`、对类型错误抛出，且从不改选别的解释器；消息点出设置 id，失败可操作 |
| **AD-10** 文档落 `docs/development.md`(+`.zh.md`)，不建第三份 Node 文档 | 否（本轮未动文档） | ✅ | `git status -s` 无新增 `docs/node-*.md`；`test:docs` 报 **`doc budgets` PASS** 且本 Phase 文档对零出现；未上调预算，故 Relocate → Condense → Raise 未被触发 |
| **AD-11** 冒烟脚本以设置项 + `PATH` 锁定 Node 并显式清除继承的 `DSH_NODE_BIN` | 否 | ✅ | Phase 1 未在 `apps/vscode-dsh/test-scripts/` 下新增任何文件（该目录只有既有的 `run-chat-ready-regression.sh`）；AD-11 所依赖的三级链正是本 Phase 的产出 |

仓库中不存在对 `StartErrorKind` 的 `switch`；唯一按它分支的消费点是 `connection-ui.ts:140`，它对 `missing-credentials` 做**等值判断**，因此 `invalid-setting` 走非凭据分支且无需 `default:`。`typecheck` exit 0 机械确认了这一点。

## 6. 本轮新发现

### 🟡 D-3 —— 两处 `(AD-10)` 引用指向了错误的决策（`extension.ts:224`、`:2173`）

`design.md` 的编号毫无歧义：

- **AD-9** = 「**提供 `dsh.nodeBin` VS Code 设置项**，并在 Host 侧落实三级 fail-loud 解析链」—— 其设置项契约条目（`design.md:238`）原文即"扩展经 `vscode.workspace.getConfiguration('dsh').get('nodeBin')` 读取，取值作为**显式输入**传给 `HarnessClient`"。
- **AD-10** = 「AC-2 / AC-3 的文档落点 = `docs/development.md`(+`.zh.md`)」—— 讲文档，与读取设置无关。

两处读取设置的 JSDoc 都引用了 AD-10：

```
extension.ts:223-227
    /**
     * Read this extension's settings (AD-10).
     * @param section - configuration section id, `dsh` for this extension.
     * @returns accessor for the section's values.
     */

extension.ts:2172-2176
 * Read the `dsh.nodeBin` Node executable setting (AD-10). A non-string value
 * fails loud under the `invalid-setting` class: ...
```

这两个表面在 `HEAD` 上都不存在（hunk 头 `+223-236` 与 `+2172-2192` 属本 Phase），因此这是本 Phase 自己新增的文字。后果仅对读者成立：照该引用去查设置项契约的开发者，会落到并不管辖此事的那条文档决策上。

**这条同时更正我自己的第 2 轮报告。** 当时我把 `extension.ts:2173` 引 AD-10 当作"`AD-*` 引用是本仓惯例"的证据 —— 惯例结论成立，但我没有核对该编号是否真的指向管辖该代码的决策。它不指向。惯例结论不受影响（`session-host.ts:106` → AD-1 等均正确）；错的是这一个实例。

最小修法：两处的 `(AD-10)` → `(AD-9)`。行为影响：无。

### 🟡 D-4 —— JSDoc 的作用域断言已不再覆盖它刚被扩展去描述的那个成员

D-2 的修复把 `invalid-setting` 加进了两句把自身词表定义为"`IdeSessionHost.start` 所抛内容"的说明，而真实抛出点在扩展侧、且早于 `start()`（`extension.ts:2255-2256`）：

```
auto-start-orchestrator.ts:34-42
 * Redacted connection failure classification, aligned member-for-member with
 * the `HostStartErrorKind` vocabulary `IdeSessionHost.start` throws with, so a
 * typed start failure reaches this snapshot instead of being flattened into the
 * generic member (AD-4): `node-environment` when the Node pre-flight refused the
 * spawn, `invalid-setting` when a Node selection setting held a value of the
 * wrong type. ...
```

```
session-host.ts:42-52
 * Class of a failed {@link IdeSessionHost.start}, identical to the
 * {@link StartErrorKind} the auto-start orchestrator projects, ...
 * `invalid-setting` means a Node selection setting held a value of the wrong
 * type, so the failure belongs to that setting's value rather than to dsh;
```

按字面读，两处都会诱导出"`start()` 自己会抛 `invalid-setting`"这一错误推断。`AGENTS.md` 要求注释陈述完整契约、包含所有权与失败事实，因此一句只覆盖四个成员中三个的抛出点断言是真实的行文缺陷 —— 但仅是行文缺陷：不涉行为、不涉验收、无任何消费方依赖它。

最小修法（任选一处即可消除歧义）：`auto-start-orchestrator.ts` 改为 "…with the `HostStartErrorKind` vocabulary **every start failure is classified with**"（或"the vocabulary the extension and `IdeSessionHost.start` throw with"）；`session-host.ts` 改为 "Class of a failed start: `IdeSessionHost.start` throws it for the failures it observes, and the extension throws it for an unreadable Node selection setting"。

### 🟡 A-1 —— `implementation.md` §2.3 把本轮实际写入的文件归为"Pre-existing / 非本 Phase"

`implementation.md` §2.3 的标题是"Modified or untracked in this worktree, but **not** this phase —— Listed so HG-3 does not attribute them to Phase 1. **None was opened for writing by this phase.**"，其表格含：

```
| `.cursor/skills/project-build/SKILL.md`, `.specdev/specs/workflows.json` | modified | Pre-existing. |
```

`.cursor/skills/project-build/SKILL.md` 与该断言不符：

- `stat` 的 mtime 为 **2026-09-15 20:11:19 +0800**，晚于 `implementation.md`（20:09）与 `implementation-zh.md`（20:10），落在本轮自己的时间窗内；
- 其新增的 `### Node.js（构建/类型检查的实际可用环境）` 条目逐字记录了**本轮**的测量值："`typecheck` exit 0；同环境跑通 4 个 spec 文件 **70** 用例与 app 套件 53 文件 **442** 用例" —— 70/442 正是 `implementation.md` §4.1/§4.2 的第 2 轮数字（第 1 轮记录的是 69）；
- `git diff --stat` 为 `25 insertions(+), 2 deletions(-)`，其中 v20.16.0 条目的 ⚠️ 改写与新的 v24.3.0 条目即 2026-09-15 的内容。

也就是说，本轮**确实**写了该文件（调度者的派发说明也将其归于 implementer，时间线亦相符），而 §2.3 却要求 HG-3 把它当作非本 Phase 产物。实际风险是提交范围：HG-3 时调度者按清单显式列举改动文件，本 Phase 写入的文件会被排除在提交之外，而报告里仍把它算作交付物。

严重性属行文/流程，不属代码：该 Phase 的任何验收证据都不依赖它。修法是 §2.3 的一行更正 —— 把该行从"非本 Phase"移到 §2.2 的 ★ 列表（或者，若调度者有意不把技能文件纳入本 Phase 提交，就明确写出该决定与理由）。知识本身经我核验是正确的（见 §7）。

### 🟢 观察项

- **O-1 —— `design.md` 未为 AD-4 的扩展留下变更记录。** 该文档自身的编辑惯例是"落点"清单（头部第 #9 条、§8 的编号式"实测事实 → 设计改动"）。AD-4 词表的扩展源于审查而非 spike，故 §8 的前提并不严格适用 —— 但对 `design.md` 做 diff 的读者无法看出该词表何时、为何多出第四个成员。在该文档的修订清单里补一行即可闭合。不是缺陷；之所以记录，是因为本 Phase 恰恰看重这类可追溯性。
- **O-2 —— lint 总数依赖计数口径（锚定正则 10 381，声称 10 382）。** 用仓库技能文件自己记录的锚定模式（`grep -cE "^[^ ].*: (error|warning) "`），我测到 **10 381** 行 / 262 个文件，与调度者 20:01 记录的数字一致；`implementation.md` §4.3 写的是 10 382。逐文件计数 —— 也就是"零新增"结论真正依赖的东西 —— 完全复现（`extension.ts` 22、`auto-start-orchestrator.ts` 1 于 `:236:24`、`session-host.ts` 1 于 `:597:3`、`index.ts` 1 于 `:97:3`、`auto-start-orchestrator.spec.ts` 4、`node-env-guard.spec.ts` 0），且 `auto-start-orchestrator.spec.ts` 那四条位置与第 2 轮完全一致，反证 D-1 的注释删除没有造成行号漂移。无新增失败；技能文件本身已提醒总数会随计数正则变化。
- **O-3 —— "零新增失败"在 hunk 层面被独立复现。** 累积第 1–2 轮 diff 的 `git diff -U0` hunk 头显示新增区间为 `extension.ts` `{34, 48, 223-236, 2172-2192, 2255, 2258}`、`auto-start-orchestrator.ts` `{26-61, 226}`、`session-host.ts` `{14, 16, 27, 29, 42-81, 108-111, 255-256, 287-292, 302, 323-329}`。§1 逐文件片段里列出的每一条诊断都落在这些区间之外 —— 包括 `extension.ts:2272`/`:2274`，它们之所以相对第 2 轮位置移动，仅仅因为 `readNodeBinSetting` 这段在 `2172-2192` 长了两行。

## 7. 技能文件的更正：核验为正确，未发现错误知识

implementer 对 `.cursor/skills/project-build/SKILL.md` 与 `.cursor/skills/project-test/SKILL.md` 的更新（`CLAUDE.md` 的契约：知识须随操作更新、错误条目须更正而非放任）**内容正确，且对自身的不确定性是诚实的**。凡我能否证的断言我都查了：

| 断言 | 我的核验 |
|---|---|
| v20.16.0 标为 ⚠️ 已过期（未删除），理由为"`engines.node` 为 `^22.19.0 \|\| >=24.0.0`"与"`pnpm` 会拒绝启动（requires at least Node.js v22.13）" | 与 `implementation.md` §4.5 记录的实测（`PATH="/usr/bin:/usr/local/node/bin:$PATH" $PNPM run typecheck` → `ERROR: This version of pnpm requires at least Node.js v22.13`）以及该文件自身维护契约中的"⚠️ 而非删除"规则一致 |
| 实际可用环境是 `/usr/local/n/versions/node/24.3.0`，用法为 `export PATH=…` | 由 `ls /usr/local/n/versions/node/`（22.9.0、24.3.0）与 §1 中在该前缀下全部成功的命令确认 |
| 所有 `pnpm` 调用需带 `--config.verify-deps-before-run=false`，因为宿主 `git` 2.25.1 < lefthook 要求的 2.26 | 与 `spec.md` 的"执行环境"节及第 1–6 次运行的行为一致 |
| `pnpm run test -- <path>` 不过滤 | 与 spec 基线快照中"已实测的陷阱"一致 |
| 报 lint 数字必须写明规则集（`.oxlintrc.json` 下 22、`.oxlintrc.staged.json` 下 3） | 已复现：我在权威配置下测到 `extension.ts` 为 22 |
| "24.3.0 是 n 根命中 **且** `command -v node` 命中；nvm 根落空" | 精确复现（`/usr/local/n/versions/node/24.3.0` 存在；`~/.nvm/versions/node/` 只有 v20.16.0 与 v22.14.0；前置 PATH 后 `command -v node` → 24.3.0） |
| `ctx.skip(cond, msg)` 以非 PASS 且带原因的形式可被机器读出 | 与 implementer 的探针 N1-P2（`Tests 28 skipped`、`↓ … [no install of 24.4.0 to locate; checked …]`）以及第 3 次运行（版本存在时 0 skipped）一致 |
| `~/.nvm/versions/node/v22.14.0/bin/node` 存在但缺 `zlib.createZstdDecompress` | 与 spec 前置条件一致，且可作为让 N1-P1 变红的现成变异体 |

唯一需要注意的是：⚠️ 条目的 `v20.16.0` 路径是 *nvm* 的 v20.16.0，而 spec 记录本机干净 `PATH` 解析到 `/usr/bin/node` v18.12.1 —— `implementation.md` §5.8/§5.9 已为 `docs/development.md` 记录了该区别，且两处说法都不错（两个解释器都在 `engines.node` 之外）。未引入误导性知识。

## 8. 升级检查

我的三个 Stop & Escalate 条件均不适用：`design.md` 不含本轮代码必须同时满足的互相矛盾约束；`constitution.md` §2 未被违反（本轮未引入依赖方向或单一职责层面的变化 —— 只是新增一个词表成员与一个抛出类）；也不存在相对既有已完成 Phase 的模式漂移（本轮引入的模式 —— 由 `as const` 数组同时派生类型与运行时 guard —— 是本 Phase 自己的，且被一致使用）。

## 9. 判决理由与 HG-3 不可遗漏的事项

**SHOULD-FIX，无 MUST-FIX。** 按本视角规则，MUST-FIX 需以违反 `design.md` 明确声明的决策或 `constitution.md` §2 为前提。D-3、D-4 是注释中的引用/作用域错误，A-1 是本 Phase 自己报告中的一行归属说明。实现本身符合 AD-1/2/4/9/10/11；而最可能被判为架构偏离的那一项 —— 在 Phase 1 扩展 AD-4 —— 有论证、是最小改动、纯加性，且与 AD-4 自身的表述一致（§3.3）。在 `loop_count` 已达上限 2 的情况下，把其中任何一条抬成 MUST-FIX，等于为行文问题阻断流水线。

交给调度者继续携带的事项（均不阻塞本 Phase）：

1. **D-3 / D-4** —— 一处很小的注释修改（两个文件合计四行），可在下次打开这些文件时顺手完成；D-4 涉及的句子本就落在本轮新增区间内，修完不会扩大本 Phase 的改动面。
2. **A-1** —— 决定 `.cursor/skills/project-build/SKILL.md` 在 HG-3 的提交处置（作为本 Phase 的技能知识交付物纳入，或有理由地刻意排除），并让 §2.3 的说法与事实一致。
3. **Phase 2 spec 同步** —— §3.3 给出的三处确切位置，由 Phase 2 spec 的属主处理，不由本 Phase 处理。
4. **Verifier** —— 若 AC-1(b) 用例触发 skip 分支，非 PASS 规则仍必须写入 `verification.md`（本机未触发：70 passed、0 skipped）；`AC-10(f)` 的跨 Phase 依赖必须原文登记。

## 10. 本视角未覆盖的内容

实现正确性（逐 AC 的逻辑与桩检测）与集成连通性分别由另两位 reviewer 的报告承担。我未评估它们，本报告中的任何内容都不应被读作对它们的判断。
