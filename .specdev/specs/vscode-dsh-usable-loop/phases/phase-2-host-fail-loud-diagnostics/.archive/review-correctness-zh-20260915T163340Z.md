# 实现正确性审查 — Phase 2

工作流：`vscode-dsh-usable-loop` · Phase：`phase-2-host-fail-loud-diagnostics` · 分支：`impl-phase-2-host-fail-loud-diagnostics`（HEAD `5307eec361`，改动尚未提交）
审查范围：`spec.md` 的 AC-13 – AC-22、AD-14 契约（18 字段 + 版本策略）、AD-13 投影扩展，以及 `spec.md` §产出清单 列出的全部文件。

## 视角

**实现正确性（Implementation Correctness）** —— 代码真的能工作吗？逐函数读函数体、逐条打开 AC→用例映射、独立复跑测试。

## 判决：SHOULD-FIX

AC-13 – AC-22 每一条都有真实实现逻辑，且都有非空、字段级的用例作证；未发现桩代码、占位符或可疑断言模式；差量门槛显示**零新增失败**，`packages/sdk/client/src/client.ts` 的「被信号终止」分支确实有被执行到的测试路径。判决为 SHOULD-FIX（而非 PASS）的原因是：3 个 `spec.md` 明确要求「必须」具备的测试产物缺失或形态不符、1 项调研报告要求记录却未记录的解读决策，以及 1 处字段契约声称（`resolvedExecutable` 为绝对路径）在三个来源中有两个既无代码路径、也无用例提供保证。这 5 项都不是行为缺陷，修复都很小、也都不阻塞 Phase 3 的驱动，但前三条 `spec.md` 写的是「必须」，因此记录在案而不是放过。

## 独立复跑证据（本次会话，`PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`）

| 门槛 | 命令（输出文件） | 结果 | 对比 `/tmp/p2-baseline-*` 的差量 |
|---|---|---|---|
| 类型检查 | `pnpm run typecheck`（`/tmp/p2r-typecheck.txt`） | **exit 0**，`grep -c "error TS"` → **0** | 绿 → 绿 |
| 扩展套件 | `pnpm run test apps/vscode-dsh`（`/tmp/p2r-vscode-dsh.txt`） | 4 个文件失败 \| 47 通过（51）；**6 失败 \| 396 通过 \| 1 跳过（403）** | **零新增失败**：排序后的失败用例名清单与 `/tmp/p2-baseline-vscode-dsh.txt` 逐行 `diff`，差异仅为末尾毫秒数。基线 351 通过（358）→ 新增 45 个通过用例 |
| SDK client 套件 | `pnpm run test packages/sdk/client`（`/tmp/p2r-sdkclient.txt`） | 3 个文件通过，**87 通过（87）** | 基线 84 通过 → +3，全绿 |
| 仅本次新增的两个 spec | `vitest run tests/host-diagnostics.spec.ts tests/session-host.spec.ts`（`/tmp/p2r-newspec.txt`） | **2 个文件，49 通过** | — |
| Lint | 对比 `/tmp/p2-after-lint.txt` 与 `/tmp/p2-baseline-lint.txt` | 二者均为 **10381** 条 `error` 级诊断；文件集合完全一致（`comm -13` 为空）；`host-diagnostics.ts` / `host-diagnostics.spec.ts` **0 条**；`client.ts` 仍为 0 | 零新增发现 |
| 覆盖率（per-file，`client.ts`） | `pnpm exec vitest run --coverage --coverage.include=packages/sdk/client/src/client.ts packages/sdk/client`（`/tmp/p2r-cov-client.txt`） | **exit 0**，3 个文件 / 87 个用例通过，语句 `188/188`、分支 `113/113`、函数 `44/44`、行 `161/161` | 与实现方数字完全一致 |
| 覆盖率（全仓） | `pnpm run test:coverage`（`/tmp/p2r-coverage-full.txt`） | **exit 1** —— 464 个文件失败 / 5120 个用例失败，主要是未触及包里的 `ACTIVE`-on-undefined `TypeError` | **`/tmp` 下无该口径基线产物** → 不可归因，详见下方覆盖率说明 |

断言密度（弱断言排查）：`host-diagnostics.spec.ts` 36 个 `it` 含 192 处 `expect(`；`session-host.spec.ts` 13 个含 51 处；`sdk-client.spec.ts` 40 个含 96 处。本次 Phase 范围内没有任何 `it.skip` / `describe.skip` / `todo(`。仅有的 3 处 `toBeGreaterThan(0)`（`host-diagnostics.spec.ts:908`、`:956`、`sdk-client.spec.ts:150`）都是前置条件，紧随其后即对同一数组做内容断言。

覆盖率：**全仓** `pnpm run test:coverage`（不带路径过滤）最终 **exit 1** —— 464 个文件失败 / 5120 个用例失败，其中占绝对多数的是 `TypeError: Cannot read properties of undefined (reading 'ACTIVE')`（5120 次），集中在本次改动**未触及**的包（`packages/api/session-controller`、`packages/core/agent-loop`、`packages/client/ui-conversation` 等）。`/tmp` 下**没有该口径的基线产物**，因此我既不能把这份红归因于本次改动，也不能替它开脱；我能第一手确证的是：其中失败的 `apps/vscode-dsh` 文件恰好就是 `.cursor/skills/project-test/SKILL.md:63-68` 记录为「本机恒红」的那 6 个用例（`spike-t0b-continue-capability`、`spike-t0a-replay-rebuild` ×4、`panel-close-delete.e2e`、`verifier-phase1/layer-a-rtl`），且本 Phase 拥有的两个套件中**没有任何新增失败用例**。因此 per-file 覆盖率改用本仓为这一需求明确记录的命令核验（`.cursor/skills/project-test/SKILL.md:44-49` 之所以存在，正是因为裸的 `<path>` 过滤会让所有未触及文件报 0% 并触发全局阈值）：`pnpm exec vitest run --coverage --coverage.include=packages/sdk/client/src/client.ts packages/sdk/client`（`/tmp/p2r-cov-client.txt`）→ **exit 0**，3 个文件 / **87 个用例通过**，`Statements 100% (188/188)`、`Branches 100% (113/113)`、`Functions 100% (44/44)`、`Lines 100% (161/161)`、无阈值报错，独立复现了实现方给出的数字。本视角必须确认的那一个分支——`transportDetails()` 的信号分支（`packages/sdk/client/src/client.ts:506-511`）——**确实被执行**：由 `packages/sdk/client/tests/sdk-client.spec.ts:439-451`（SIGTERM，断言 `terminationSignal === 'SIGTERM'` 且 `exitCode === null`）驱动，且该用例在我这次复跑中通过；`client.ts` 的 4 处 `/* v8 ignore next */` 位于 `:265`、`:354`、`:473`、`:537`，**没有一处**覆盖本次新增的「退出码 / 终止信号 / spawn 错误」路径。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据（读函数体后的结论 + 用例） |
|----|------|---------|:--:|------|
| AC-13 (a) | 以 Output Channel 作为诊断输出目标，且可由命令打开 | `extension.ts:422-425`（`createOutputChannel(HOST_DIAGNOSTICS_CHANNEL_NAME)`，并有 `typeof === 'function'` 守卫），名称常量 `host-diagnostics.ts:23`，打开命令 `extension.ts:537-539` | ✅ | 常量值为 `'DeepSeek Harness'`，用例同时断言「等于该常量」与字面量（`host-diagnostics.spec.ts:832-836`）；打开命令无条件注册，调用 `show()` 且不追加任何内容（`:838-846`） |
| AC-13 (b)(c) | 命令可打开该通道 | `extension.ts:537-539` | ✅ | 执行命令后 `channels[0].shown` 由 0 变 1；`channels[0].lines` 保持 `[]`；没有 Output Channel 的表面也仍返回 `{ ok: true }`（`:848-853`） |
| AC-13 (d) | `dsh.test.getDiagnosticsText` 位于门禁之内且返回数组 | `extension.ts:1104-1107`，位于 `shouldRegisterTestHooks` 块内 | ✅ | 已注册且 `records()` 为 `[]`（`:856-860`）；**门禁关闭方向被真正观测到**——通过替换 `Module._load`，使 `activate(ctx)` 在无注入模块的情况下解析 `vscode`（`:862-888`）。这正是 `repo-exploration.md` §7.1 的方案 (a)，也是进程内唯一能看到门禁关闭的途径；用例同时断言 `dsh.test.*` 为空、而 `dsh.showHostDiagnostics` 仍注册 |
| AC-14 | spawn 失败 → 可执行文件绝对路径 + 失败原因写入通道，Host 置失败态 | SDK：`client.ts:39-52`（`TransportClosedDetails`）、`:506-511`（`transportDetails`）、`:483-500`（保留消息前缀）。Host：`describeStartFailure` `session-host.ts:134-178`，记录点 `:451` | ✅ | **两层取证齐备，且没有任何一层被降级为 mock。** 第 1 层用生产入口 `createProcessHarnessClient` 传入不存在的绝对路径 `command`，令**真实** `child_process.spawn` 失败（`sdk-client.spec.ts:406-422`：`details.executable === missing`、`details.spawnError.message` 匹配 `ENOENT`、`exitCode`/`terminationSignal` 为 null、`stderrTail` 为 `[]`；`spawn error:` 前缀在 `:403` 断言）。第 2 层断言 `kind === 'spawn'`、`resolvedExecutable === missing`、`source !== null`、`detail !== ''`、`host.status === 'error'`、orchestrator `{ state: 'failed', errorKind: 'spawn' }`（`session-host.spec.ts:234-265`），其 `spawnError` 也来自一次真实 `spawn()`（`:227-232`）。分类是结构化的：由 SDK 错误类型决定，用一个 stage 计数器区分唯一的无类型边界，全程不匹配任何消息文本（`session-host.ts:134-178`） |
| AC-14 兜底 | `start()` 期间**任何**抛错都产出记录；未知异常归 `other` 且 `detail` 非空 | `session-host.ts:441-460`（单一 catch 覆盖整个 try）、`:144-151`（`kind: 'other'`），recorder 兜底 `host-diagnostics.ts:348-349` | ✅ | 未分类抛错 → `kind === 'other'`，`detail` 含原始消息，`hint` 非空（`session-host.spec.ts:267-283`）。catch 包住 try 内每一条语句，没有可逃逸的 throw；recorder 会把空的 `detail`/`hint` 替换为按 kind 的文案（`FAILURE_DETAILS`/`FAILURE_HINTS`，`:168-189`），因此「detail 非空」这条契约不可能被一个不贡献文本的边界破坏——`host-diagnostics.spec.ts:147-158`（`record({ kind: 'other' })` 仍产出非空 `detail`/`hint`）证明了这一点。在 Host **外围**（入口解析、`new HarnessClient()`）抛出的失败，由 `extension.ts:2331-2371` 借助 `lastSeq()` 水位记录，同时避免同一次尝试被记成两条 |
| AC-15 | 握手超时 → 失败态 + 超时语义与毫秒数写入通道 | `session-host.ts:384`（只解析一次时限）、`:148-153`（`kind: 'handshake-timeout'`、`handshakeTimeoutMs: context.initializeTimeoutMs`），`RequestTimeoutError` 由 `client.request` 抛出 | ✅ | `initializeTimeoutMs: 300` + 一个收到 `initialize` 不回应 的 runtime；断言 `kind === 'handshake-timeout'` **且** `handshakeTimeoutMs === 300`（字段级断言，`session-host.spec.ts:285-300`），并另有该分类按名字到达 snapshot 的用例（`host-diagnostics.spec.ts:680`）。全文没有任何文案匹配。记录中的时限与交给 client 的时限是同一个值（`session-host.ts:384` → `:427`），因此记录不可能声称一个 runtime 从未有过的时限 |
| AC-16 | bridge 监听失败 → socket 绝对路径 + 失败原因 | `session-host.ts:413-414`（stage）、`:175-176`（`kind: 'bridge-listen'`、`socketPath`） | ✅ | socket 路径是一个已存在的目录，令生产代码 `IdeBridgeHostServer.listen` 真实失败（`session-host.spec.ts:302-314`）；断言 `kind`、`socketPath === socketPath`（用例传入的绝对临时路径）、`detail !== ''`。没有 mock 任何生产私有方法 |
| AC-17 | 至少最后 20 行 stderr 原文，不得用摘要替换 | `client.ts:481-487`（尾部追加 + `STDERR_TAIL_LIMIT`）、`host-diagnostics.ts:347`（`stderrTail` 逐行过脱敏后原样复制） | ✅ | 25 行唯一标记后死亡：`markers.length >= 20`、`markers.slice(-20)` 与原文第 6–25 行**逐项严格相等且顺序一致**，并额外断言第 1–5 行也在，证明没有做摘要（`session-host.spec.ts:316-343`）。记录逐元素复制该数组——recorder 内不存在截断、补齐或摘要逻辑 |
| AC-18 | 退出码；若退出码不可得（被信号终止）则写终止信号名 | `client.ts:283-291`（捕获 `exit` 的第二个参数）、`:500`（消息分支）、`:506-511`（结构化拆分）、`session-host.ts:155-163` | ✅ | **两个分支都是字段级证据，且在两个层级各有一份。** SDK：`exit(7)` → `exitCode === 7`、`terminationSignal === null`、`spawnError === undefined`（`sdk-client.spec.ts:424-437`）；自杀于 SIGTERM → `terminationSignal === 'SIGTERM'`、`exitCode === null`（`:439-451`）。Host 记录：`{ exitCode: 7, terminationSignal: null }` 与 `{ exitCode: null, terminationSignal: 'SIGTERM' }`，两者 `kind === 'child-exited'`（`session-host.spec.ts:345-373`） |
| AC-19 | 凭据缺失 → 失败态、含缺凭据语义的提示、设置入口、且不得以「正在连接到 Host…」为终态 | orchestrator 预检 `auto-start-orchestrator.ts:214-219`；记录路径 `host-diagnostics.ts:227-241` + `:257-274`；UI 投影（未改动，`connection-ui.ts:140`、`:147-154`） | ✅ | 记录 `kind === 'missing-credentials'`，`phase: 'start'`、`retryOfSeq === null`、`detail` 非空；snapshot 为 `failed` + `errorKind === 'missing-credentials'`；面板 phase 为 `failed`；最后一条横幅消息含 `missing credentials` 且**不等于** `正在连接到 Host…`；设置命令存在且执行了 `workbench.action.openSettings`；状态栏带 `command === 'dsh.statusBarAction'` 且 `shown === true`（`host-diagnostics.spec.ts:890-919`）。单元侧另有一例直接在**生产** `ConnectionUiController` 上断言同样四项 UI 事实（`:539-556`） |
| AC-20 | 已失败的 Host 不得继续显示进行时文案；终态文案须含失败根因 | `connection-ui.ts:115-161`（无需改动——投影本就以 `failed` 为终态）、`host-diagnostics.ts:197-215`（每个失败 kind 对应唯一 orchestrator class） | ✅ | 记录侧：在一条真实的两段失败链上，kind 为 `['handshake-timeout', 'child-exited']`，二者都属于 AC-20 的集合且 `detail` 非空（`session-host.spec.ts:375-407`）。UI 侧：遍历全部 7 个 `StartErrorKind`，逐项断言 `phase === 'failed'`、`phase !== 'connecting'`、`message` 等于 snapshot 自身的 `errorMessage`、`message !== '正在连接到 Host…'`、message 非空、状态栏可见（`host-diagnostics.spec.ts:517-537`）。根因取自 `errorKind` 字段并原样透传，没有任何一处从文案反推 |
| AC-21 | 写入通道与 UI 的所有文本先脱敏；`KEY`/`PASSWORD`/`SECRET`/`TOKEN` 命名的键其值不得出现 | 复用 `redactSecrets`（`host-diagnostics.ts:12`，未另写第二套），在构造记录时对每个字符串字段统一施加（`:338-349`），并对 stderr 逐行施加（`:347`） | ✅ | 单元侧：把密文放进**每个**字段，断言其在 `recorder.records()`、其 JSON 形式、sink 收到的载荷、渲染块四处均不出现，且四处均含 `[redacted:DSH_TEST_TOKEN]`（`host-diagnostics.spec.ts:261-300`）；`API_KEY`/`SECRET`/`PASSWORD`/`TOKEN` 命名的键在多种取值形态下也被覆盖（`:302-324`）。端到端：把密文放进可执行文件路径本身，断言记录存储、`JSON.stringify(records())`（原始字符串）、通道文本、以及每一条面板横幅消息都不含密文（`:921-964`） |
| AC-22 (a)(c) | 失败态期间提供可点击重试入口；重试复用同一启动路径 | 入口 `extension.ts:519-523`（`dsh.statusBarAction` → `orchestrator.request('status-bar')`），重试重新进入 `AutoStartOrchestrator.request` → `runStart` → 同一个 `StartHostPort` | ✅ | 重试前后 `hostCreateCount` 由 1 增至 2，snapshot 保持 `failed` 后可恢复（`host-diagnostics.spec.ts:966-1004`）；orchestrator 层级上同一个 port 实例收到 `['command-start', 'manual-retry']` 并到达 `started`、`errorKind` 被清空（`auto-start-orchestrator.spec.ts:205-224`）；入口可点击性通过 `statusBar.command === 'dsh.statusBarAction'` + `statusBarVisible === true` 断言（`host-diagnostics.spec.ts:917-918`、`:976-977`、`:555-556`） |
| AC-22 (b) | 重试前后记录成对增加，`retryOfSeq` 指向首启记录，`seq` 严格递增 | `host-diagnostics.ts:335-336` + `:351`（链式记账）、`:320-322`（`onStartSucceeded` 关闭链） | ✅ | 首启失败 + 重试后共两条记录：`[0]` 为 `phase: 'start'`/`retryOfSeq: null`，`[1]` 为 `phase: 'retry'` 且 `retryOfSeq === opening.seq`、`seq > opening.seq`；第三次尝试在同一链上扩到 3 条（`host-diagnostics.spec.ts:984-1003`）。独立的链式用例断言同样的不变量，并覆盖「一次成功启动后链重新开启」（`:326-343`、`:450-514`） |
| AD-13 | approval 投影增加 `toolName` + 非空 `reason`，且不新增其它字段 | `interaction-coordinator.ts:192-227` | ✅ | approval 条目逐字携带这两个字段，且投影与入队时的原始值逐字段比对（`host-diagnostics.spec.ts:596-634`）；`questions` 分支被断言未获任何新字段（`:635-658`），因此联合类型仍具判别性。`resolveApproval` / `answerApproval` 不存在（本 Phase 不交付） |

## AD-14 契约：字段集与版本策略

| 要求（`spec.md:42`、`:57`、`:63`） | 交付情况 | 判定 |
|---|---|:--:|
| 字段集恰好 18 个，且以设计清单（而非实现类型推断）为期望值 | `RECORD_FIELDS` 是手写表，含字段名 + 类型 + 可空性 + 枚举成员（`host-diagnostics.spec.ts:60-86`）；实际产出的键集合用 `toEqual` 与之比对（`:128`） | ✅ |
| 每字段类型与可空性 | `expectFieldShape`（`:95-111`）检查 `typeof`、数组元素类型、枚举成员，并检查「只有设计声明为可空的字段才允许为 `null`」；不填任何事实的边界记录也按同一张表校验（`:147-158`） | ✅ |
| `schemaVersion === 1` 且取自产品常量（改常量即失败） | `host-diagnostics.ts:20` 是唯一定义；`Record` 类型用 `typeof HOST_DIAGNOSTIC_SCHEMA_VERSION`（`:57-58`），recorder 从常量填充（`:332`） | 实质 ✅ —— 形态缺口见 🟡-1 |
| `detail` / `hint` 之外不得有文本渲染字段 | `TEXT_RENDER_FIELDS = ['text','renderedText','summary','log']` 同时按查值和对全部产出键两条路径断言不存在（`:171-177`） | 实质 ✅ —— 形态缺口见 🟡-1 |
| 版本三口径：`2` → 只断 v1 子集且记录观测版本；缺失/`null`/`0`/`"1"` → `HARNESS_ERROR`；`[]` → 不对版本断言 | `readRecords`（`:186-207`）正是这套口径；用例分别在 `:212`（`[]`，`version` 为 null）、`:218`（v1 精确）、`:224`（接受 v2、容忍新增字段、记下观测版本 2）、`:233`（缺失 / `null` / `0` / `"1"` / `1.5` 全部抛 `HARNESS_ERROR`）、`:245`（非数组，即 `{schemaVersion, records}` 包裹形态，判 `HARNESS_ERROR`） | ✅ |

## 桩与占位检测

### 已注册桩（对照 `tech-debt-registry.md`）

| Registry ID | 文件:函数 | 状态 | 说明 |
|---|---|---|---|
| DEBT-004 | ide profile main session 不可写 | ⚠️ 已知 / 活跃，🟡 非阻塞 | 不在本 Phase 文件面内；实现未声称解决 |
| DEBT-008 | 4 处引用 / 来源短语不准确 | ✅ **本 Phase 已解决** | 我逐处复核：`extension.ts:233` 与 `:2245` 现已写 `(AD-9)`；`session-host.ts:51-58` 与 `auto-start-orchestrator.ts:38-48` 均已把来源短语拓宽为「由 `IdeSessionHost.start` **或包裹它的 `StartHostPort`** 抛出」，并列出了新增成员。注册表已相应更新 |
| DEBT-009 | Phase-1 `implementation.md` §2.3 归类错误 | ⚠️ 已知 / 活跃 | 属产物侧、不在本 Phase 面内（与调研结论一致） |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---|---|---|---|
| — | 无 | — | — |

检索范围：`apps/vscode-dsh/src`、`apps/vscode-dsh/tests`、`packages/sdk/client/{src,tests}`，关键词 `@STUB`、`TODO`、`FIXME`、`not implemented`、`placeholder`、空函数体、恒真断言、被跳过的用例。唯一命中是两个 fake runtime 里的 `process.exit(...)`（因 `xit(` 子串被匹配），属 fixture 行为而非桩。未发现未注册桩，未为新分支添加 `/* v8 ignore */`，也没有硬编码的 `return []`。

## 关键发现

### 🔴 Must-Fix

无。没有未实现的 AC，没有未注册桩，没有恒真断言，也没有任何门槛回退。

### 🟡 Should-Fix

**🟡-1 ——「契约完整性用例」被拆成 4 个用例，而非 1 个（`spec.md:63`）。**
`spec.md:63` 要求**单个用例内同时**断言：(a) 字段集恰好 18 个；(b) 每字段类型与可空性与 AD-14 清单一致；(c) `schemaVersion === 1` 且取自 `HOST_DIAGNOSTIC_SCHEMA_VERSION`；(d) `detail`/`hint` 之外无文本渲染字段。实际是一个 `describe` 块内的 4 条断言分散在 `host-diagnostics.spec.ts:114`（(a)+(b)）、`:147`、`:160`（(c)）、`:171`（(d)）。
证据：读 `:113-178` —— `:114` 这个用例从未提及 `schemaVersion`，也没有文本字段清单的否定断言；常量/字面量断言只存在于 `:166-168`。
影响：**验证力并未下降**（每个断言对同一类漂移仍会独立失败——新增字段会打挂 `:128`，递增常量会打挂 `:166`，改版本名会打挂 `:167`）；缺口在于 spec 要求的「原子性」，即一个可被读者或 Phase 3 驱动直接引用的「18 字段契约」用例。
建议修法：把 `schemaVersion`/常量断言与 `TEXT_RENDER_FIELDS` 否定断言并入 `:114`（或把 `:160`/`:171` 合入其中），其余用例可保留。

**🟡-2 —— 强制反向边界「stderr 少于 20 行时按实际行数记录」没有断言。**
`spec.md:61` 把「stderr 少于 20 行时按实际行数记录（不得伪造 20 行）」列入「必须全部存在」的用例清单。AC-17 用例跑的是 25 行（`session-host.spec.ts:316-343`）；AC-18 用例虽然传了 `FAKE_STDERR_LINES: '1'`（`:351`、`:365`），但从未断言 `stderrTail`，其余用例也没有对短尾做断言。
代码本身正确的证据：`host-diagnostics.ts:347` 逐元素复制 `input.stderrTail ?? []`，recorder 内没有任何补齐、截断或伪造行的逻辑，因此 1 行的尾就是 1 行（「记录有界」用例在 `host-diagnostics.spec.ts:360` 顺带把 `stderrTail: ['kept']` 钉住了）。
建议修法：在 AC-18 的退出码分支断言 `record.stderrTail` 等于那一行标记，或补一个专门用例。

**🟡-3 —— AC-18 边界清单中「正常退出码 0」这一实例未被执行。**
`spec.md:61` 要求「子进程正常退出码 0 后断线（记录 `kind === 'child-exited'`）与 spawn 失败（`kind === 'spawn'`）必须归为不同 kind」。**kind 的区分已被覆盖**（`child-exited` 见 `session-host.spec.ts:329`、`:355`、`:369`，`spawn` 见 `:259`），但所有被执行的死亡都带非零退出码：AC-17/AC-20 用例走的是 fixture 默认值，而 `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs:256` 把「未设置」和 `0` 一起折叠成退出码 `1`，因此当前旋钮根本无法产生退出码 `0`。
代码本身正确的证据：`session-host.ts:159` 只在退出码严格为 `null` 时省略该字段，因此真实的 `0` 会被记为 `0`（`host-diagnostics.ts:344`，`input.exitCode ?? null` 保留 `0`）。
建议修法：让 fixture 把请求的 `FAKE_EXIT_CODE: '0'` 原样透传，并断言 `exitCode === 0` 且 `kind === 'child-exited'`；或在 `implementation.md` 记录「该实例无法经 fake runtime 构造，故以代码走查断言」的理由。

**🟡-4 —— AC-18 的「握手后子进程退出」不产生诊断记录，且该决策未被记录。**
生产侧唯一的记录点就是 `session-host.ts:451`，即 `start()` 的 catch（以 `rg -n "diagnostics\?\." apps/vscode-dsh/src/session-host.ts` 复核，仅 `:377`、`:440`、`:451` 三处）；`onTransportDeath` 不记录。因此，**成功握手之后**退出的子进程不会产生 `child-exited` 记录，而 AC-18 的字面表述（「当子进程退出时」）并不区分握手前与握手后。
该解读正是 `repo-exploration.md` §7.2 所推荐的，也满足 `spec.md:52` 的验证方法（两个分支都经一次失败启动驱动）与 `spec.md:54`（只枚举启动失败类 kind）。缺的是 §7.2 明确要求「把映射决策**显式**做出并记录」，而 `implementation.md` §8 里没有这一条（`rg -n "onTransportDeath|post-connect|握手后" implementation.md` 无命中）。`implementation.md` §8.7 记录了相邻的 `StartHostPort` 兜底决策，因此这是遗漏而非隐瞒。
建议修法：在 `implementation.md` §8 补一行，说明 AC-18 的证据取在握手前的退出路径、握手后的退出属 transport watcher 路径的 `TransportClosedError` 且不产启动失败记录；若用户倾向更严格的解读，请在本 Phase 关闭前升级确认。

**🟡-5 —— 没有任何用例钉住 `resolvedExecutable` 的绝对路径性质，而字段文档无条件地声称它成立。**
`host-diagnostics.ts:70` 把该字段文档化为「Absolute path of the Node executable the Host resolved and spawned」，但 `resolveNodeExecutableSpec` 对 `DSH_NODE_BIN`（`launch.ts:132-135`）与 `nodeBinSetting`（`:136-139`）原样返回——只有 `process.execPath`（`:140-144`）在构造上必然是绝对路径。因此当 `dsh.nodeBin` 被设为 `node` 或一个相对路径时，记录可以携带 `resolvedExecutable === 'node'` 而仍然满足本 Phase 的全部断言：AC-14 用例自己传入了绝对路径，断的是与**该输入**相等，而非与某个被绝对化的值相等（`session-host.spec.ts:236-238`、`:260`；SDK 层用例同样把 `details.executable` 钉在它自己传入的 `command` 原值上，`sdk-client.spec.ts:406-422`）。recorder 也不做归一化（`host-diagnostics.ts:338` 只做脱敏并把 `''` 映射为 `null`），且 `rg -n "process-exec-path" apps/vscode-dsh/src/host-diagnostics.ts` 无命中——`implementation.md` §7/F-3.3 所依赖的「三来源」限制，在下游读者看到的契约里并不存在。
影响：`spec.md:57` 要求 Phase 3 的真机证据中存在 `kind === 'node-environment'` 记录且其 `resolvedExecutable` 为绝对路径。该性质对默认来源成立，但对另外两个来源既无代码保证也无用例，因此 Phase 3 的断言只在默认来源下才安全——而契约与测试都没有说明这一点。
建议修法：把该限制写进字段 JSDoc 与 `HostDiagnosticInput` 的对应字段（`host-diagnostics.ts:70`、`:104`）——契约所在之处；并补一个用例钉住**确实成立**的那部分保证（`process-exec-path` 解析出的 `resolvedExecutable` 为绝对路径）。若改为重新裁定 F-3.3、对两个调用方提供的来源做绝对化，会改变 `launch.ts` 行为，属设计轨而非本条修复。

### 🟢 观察项

- **🟢-1 成功的重试不追加「之后」的记录。** `onStartSucceeded()`（`host-diagnostics.ts:320-322`）只关闭链；成对增加只在重试本身也失败时发生。这与 `spec.md:56` 的验证方法（驱动一次失败的重试）以及 `host-diagnostics.spec.ts:966-1004` / `:326-343` 一致，且成功启动本就不是失败记录——列出以便该解读是显式的而非偶然的。
- **🟢-2 `bridge-listen` 的 stage 窗口多覆盖了一个同步调用。** `stage = 'bridge-listen'` 在 `await bridge.listen(...)` 之前设置，直到 `buildIdeChildEnv(...)` 返回后才推进（`session-host.ts:413-420`），因此若 `buildIdeChildEnv` 抛错会被标成 `bridge-listen` 并带上 socket 路径。实践中组装 env 不会抛错，风险为零；stage 注释可以写明它实际覆盖的窗口。
- **🟢-3 `records()` 是浅拷贝。** 数组被复制（`host-diagnostics.ts:364-365`），但记录对象是共享引用，因此 JSDoc「改它到不了 store」只对数组本身成立。元素类型是 `readonly`，本改动集内没有调用方能现实地改到它；文档措辞可以收紧。
- **🟢-4 契约表与设计清单逐字段比对，但只校验了一个方向。** `expectFieldShape` 会拒绝「声明为非可空却为 `null`」（这是有用的方向）；反过来，一个声明为可空却恒为 `null` 的字段仍会通过。设计清单本身已声明哪些字段可空，因此这是残留的次要问题。

## 附带：`project-test` skill 回写

本次复跑产生了一条新知识，已按 `.cursor/skills/project-test/SKILL.md` 自身的「有新知须回写」契约追加为新条目：全仓 `pnpm run test:coverage` 在本机为红（实测 `exit 1`、464 文件 / 5120 用例，主要是未触及包里的 `ACTIVE`-on-undefined `TypeError`），因此单文件覆盖率必须用 `--coverage.include=<file>` 形态核验；以及 `test:coverage:partitioned` 在漏设 `DSH_COVERAGE_PARTITIONS` 时会立刻抛错。该条目状态标为 ✅ 已验证，但同时标注「仅实测现象 / 未采基线 / 不可归因」，以免被引用为「可以忽略该门禁」的许可。该 skill 中既有条目一字未改。
