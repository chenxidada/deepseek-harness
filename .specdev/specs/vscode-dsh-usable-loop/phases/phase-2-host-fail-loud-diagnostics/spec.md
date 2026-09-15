# Phase 2: 启动失败 fail-loud 诊断

| 项 | 值 |
|---|---|
| Phase ID | `phase-2-host-fail-loud-diagnostics`（来自 `phase-plan.md` DAG JSON，唯一真相源） |
| 分支 | `impl-phase-2-host-fail-loud-diagnostics` |
| 依赖 | `phase-1-node-env-preflight`（消费其 `node-environment` 失败分类与 `ResolvedNodeExecutable`） |
| 覆盖 AC | AC-13 – AC-22（10 条） |
| 设计依据 | `design.md` AD-3（诊断边界）、AD-4（`failed` 终态复用）、AD-5（结构化错误细节）、AD-14（**新增** `dsh.test.getDiagnosticsText`，返回**结构化 JSON 记录数组**，**18 字段契约**含 `schemaVersion` + 版本策略 + 契约完整性用例）、AD-13（**扩展** `dsh.test.listPendingInteractions` 投影） |

## 目标

把 Host 启动的每个失败边界（Node 门槛 / bridge listen / spawn / `initialize` 握手 / 子进程退出 / 缺凭据）变成一条可检视、已归类、已脱敏的诊断记录，并让连接区在失败时显示根因终态而非进行时文案；同时**不新增第二套状态权威**（继续由 `AutoStartOrchestrator` → `ConnectionUiController` 承担）。本 Phase 同时交付两个真机可读的测试面：**新增** `dsh.test.getDiagnosticsText`（返回 `HostDiagnosticRecord[]` 的**结构化 JSON 记录数组**，字段契约见 AD-14：**18 个字段**，含 `schemaVersion`）与**扩展** `dsh.test.listPendingInteractions` 投影（补 `toolName` / `reason`）。

## 前置条件

- `phases/phase-1-node-env-preflight/`（含 `implementation.md` / `verification.md`）已通过 HG-3
- `phases/phase-2-host-fail-loud-diagnostics/repo-exploration.md`（code-explorer 产出，implementer 必须先读）
- **Phase Entry Gate**：读取 `tech-debt-registry.md` 并向用户呈现「目标 Phase = `phase-2-host-fail-loud-diagnostics`」的 🔴阻塞条目。预期为**空**（`DEBT-001` 已随 AD-9 反转撤销，Phase 1 按 spec 不产生阻塞债）
- Phase 1 已提供：`HostStartError{kind:'node-environment'}`、`validateNodeEnvironment`、`ResolvedNodeExecutable`（含 `source`）、门槛先于 `bridge.listen` 的顺序契约
- 代码事实：`dsh.test.*` 注册门禁为 `shouldRegisterTestHooks`（`extension.ts:2124-2125`，条件 `VSCODE_DSH_TEST === '1' | 'true'`）；`listPending()` 现有投影字段为 `kind` / `id` / `sessionId` / `state` / `abort` / `tabId`（`interaction-coordinator.ts:188-199`）

## 验收标准（提取自 requirements.md，原文不改）

- **AC-13**: `[Must]` **普遍型** `[责任侧: 仓库]` — 扩展 **必须** 提供一个 VS Code Output Channel 作为 Host 启动诊断的输出目标，该通道 **必须** 可经至少一个扩展命令打开。
- **AC-14**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** `dsh` 子进程 spawn 失败 **时**，系统 **必须** 把「子进程可执行文件绝对路径」与「失败原因」写入诊断通道，并 **必须** 把 Host 状态置为失败态。
- **AC-15**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** SDK `initialize` 握手在超时时限内未完成 **时**，系统 **必须** 把 Host 状态从连接中转为失败态，并 **必须** 把「握手超时」语义与超时时长（毫秒）写入诊断通道。
- **AC-16**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** ide bridge socket 监听失败 **时**，系统 **必须** 把 bridge socket 绝对路径与失败原因写入诊断通道。
- **AC-17**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** `ide` profile 的插件树加载失败 **时**，系统 **必须** 把子进程 stderr 的末尾内容（至少最后 20 行）写入诊断通道，**必须不** 用摘要替换或丢弃其中的错误原文。
- **AC-18**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 子进程退出 **时**，系统 **必须** 把退出码写入诊断通道；**如果** 退出码不可得（进程被信号终止），**那么** 系统 **必须** 把终止信号名写入诊断通道。
- **AC-19**: `[Must]` **事件驱动型** `[责任侧: 仓库]` — **当** 模型凭据缺失 **时**，系统 **必须** 进入失败态并显示含「缺少凭据」语义的提示，**必须** 提供打开扩展设置的入口，**必须不** 把「正在连接到 Host…」作为该情形的终态文案。
- **AC-20**: `[Must]` **不期望行为型** `[责任侧: 仓库]` — **如果** Host 启动已经失败，**那么** 连接区 **必须不** 继续显示进行时的「正在连接到 Host…」文案，**必须** 显示包含失败根因的终态文案。
- **AC-21**: `[Must]` **普遍型** `[责任侧: 仓库]` — 写入诊断通道与 UI 的所有文本 **必须** 先经凭据脱敏，**必须不** 包含任何匹配 `KEY` / `PASSWORD` / `SECRET` / `TOKEN` 的环境变量名所对应的值内容。
- **AC-22**: `[Must]` **状态驱动型** `[责任侧: 仓库]` — **在** Host 处于失败态 **期间**，连接区 **必须** 提供一个可点击的重试入口；触发该入口后 **必须** 复用同一启动路径，并 **必须** 在重试的前后向诊断通道追加记录。

## 验证策略

> 本 Phase 的失败路径大多**无法**在真机上稳定构造（例如让真机 Extension Host 内的 spawn 失败），因此主验证面是 `apps/vscode-dsh/tests/**` 的 Node 层 + fake runtime 真实子进程（`apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs`）+ 鸭子类型 `vscode`——这些用例执行的是**真实生产代码路径**，不是替身实现。真机侧的补充证据由本 Phase 新增的 `dsh.test.getDiagnosticsText` 提供，并在 Phase 3 的冒烟运行中实机执行（见 Phase 3 spec「AC-13 / AC-14 真机补充证据」）。
>
> **断言口径（AD-14，用户 HG-2 裁定，不可打折）**：`dsh.test.getDiagnosticsText` 返回**结构化 JSON 记录数组**，本 Phase 与 Phase 3 的**所有**相关断言**必须**解析该数组并**逐字段**判定（数组元素为 `HostDiagnosticRecord`，字段与可空性见 AD-14 清单：**18 个字段**）。**禁止**任何"从文本中提取/匹配文案或对整篇文本做正则"的断言方式。唯一例外是 AC-19 / AC-20 对 UI `message` 文案本身的要求（那是 AC 明文要求，见对应行）。
>
> **版本策略（AD-14 决策 9–12，v7 用户评审 #3，不可打折）**：每条记录**必须**含 `schemaVersion`（字面量 `1`、不可空、恒存在；唯一真相源为产品常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION`）。驱动与测试的断言口径**必须**按版本分流：(i) `schemaVersion === 1` → **必须**做**字段集精确**断言（字段名 + 类型 + 可空性**恰好**等于 AD-14 的 18 字段；多字段 / 少字段 / 改名 / 类型或可空性不符均判失败）；(ii) `schemaVersion > 1` → **只允许**断言其依赖的 **v1 子集**字段（`kind`、`resolvedExecutable`、`source`、`exitCode`、`terminationSignal`、`stderrTail`、`handshakeTimeoutMs`、`phase`、`retryOfSeq`、`seq` 等），**不得**因出现新增字段而失败，且**必须**把观测到的版本号记入证据（状态 JSON）；(iii) `schemaVersion` **缺失** / `null` / 非整数 / `< 1` → 判 **`HARNESS_ERROR`**。无记录时返回 `[]` 合法，**不得**对版本做任何断言。

| AC | 验证类型 | 验证方法 | 预期结果 |
|---|---|---|---|
| AC-13 | 运行时验证（鸭子类型 vscode）+ 真机命令检查 | (a) `apps/vscode-dsh/tests/host-diagnostics.spec.ts`：注入含 `window.createOutputChannel` 的 fake vscode 激活扩展，断言 `createOutputChannel` 被调用一次且通道名稳定（`DeepSeek Harness`）；(b) 断言 `dsh.showHostDiagnostics` 已 `registerCommand`；(c) 执行该命令后断言 fake channel 的 `show()` 被调用；(d) **新增钩子**：断言 `dsh.test.getDiagnosticsText()` 在 `VSCODE_DSH_TEST=1` 下已注册、在门禁关闭时**未**注册，且返回值为**数组**（`Array.isArray() === true`）；真机侧由 Phase 3 驱动断言 `getCommands()` 含该命令并取回**结构化 JSON 记录数组**（逐字段读取，**不得**读文本；按 AD-14 决策 10 的版本口径断言） | (a)(b)(c)(d) 断言成立；真机留证由 Phase 3 报告提供，且证据形态为 JSON 数组、断言口径按 `schemaVersion` 分流 |
| AC-14 | 运行时验证（两层证据：真实 spawn 失败 + 生产错误类型分类） | **重要前置事实**：Phase 1 的门槛会拦下「Node 路径不存在/不可执行」，且三个来源共用同一路径，因此 Phase 1 之后**真实的 spawn 失败在正常路径上不可达**——这正是 AC-7 想要的。于是 AC-14 分两层取证：<br/>(1) **SDK 层（真实 spawn 失败）** — 扩展 `packages/sdk/client/tests/sdk-client.spec.ts`：用生产入口 `createProcessHarnessClient({ command: '<不存在文件的绝对路径>', args: [], env, profile })` 让真实 `child_process.spawn` 失败，断言 `initialize()` 抛 `TransportClosedError`、`details.spawnError !== undefined`、`details.executable === '<该绝对路径>'`、消息含 `spawn error:` 前缀；<br/>(2) **Host 层（生产错误类型 + 真实分类代码）** — 扩展 `apps/vscode-dsh/tests/session-host.spec.ts`：用生产类 `TransportClosedError`（步骤 (1) 产出的同一类型）构造 `spawnError` 场景，驱动 `IdeSessionHost` 的失败出口，断言诊断记录字段 `kind === 'spawn'`、`resolvedExecutable === '<该绝对路径>'`、`detail !== ''`、`source !== null`，且 `host.status === 'error'`、`orchestrator.getSnapshot()` 为 `failed` 且 `errorKind === 'spawn'` | 两层断言全过（Host 层为**字段级**断言）；**不得** 以「无法在真机构造 spawn 失败」为由跳过第 (1) 层 |
| AC-14（兜底完整性） | 运行时验证（穷尽启动失败出口） | 断言凡是 `IdeSessionHost.start()` 期间的任何抛错（含 `new HarnessClient()` 阶段的 dsh 入口解析失败、未知异常）都会产出一条诊断记录：入口解析失败与未知异常均归 `kind === 'other'` 且记录必须含原始消息（`detail` 非空）。断言「start 失败但没有诊断记录」的用例不存在 | 任何启动失败都有记录 |
| AC-15 | 运行时验证（fake runtime 不响应 `initialize`） | 用 `initializeTimeoutMs: 300` 启动一个「收到 `initialize` 不回应」的 fake runtime → 断言抛 `RequestTimeoutError`；诊断记录字段 `kind === 'handshake-timeout'` 且 `handshakeTimeoutMs === 300`；orchestrator 为 `failed` + `errorKind === 'handshake-timeout'` | 四个字段/状态全部命中（**不得**以文本匹配"超时"措辞代替字段断言） |
| AC-16 | 运行时验证（bridge listen 失败） | 令 `bridge.listen()` 失败（用一个已存在的普通文件路径作为 socket 路径，或注入一个 reject 的 `listen`；不得只 mock 生产代码私有方法）：断言记录字段 `kind === 'bridge-listen'`、`socketPath === '<该绝对路径>'`、`detail !== ''`；`errorKind === 'bridge-listen'` | 路径字段 + 原因非空 + 分类 |
| AC-17 | 运行时验证（stderr 尾部原文） | fake runtime 向 stderr 打印 25 行带唯一标记（`DSH-FAKE-STDERR-<n>`）后 `process.exit(1)`：断言记录字段 `stderrTail.length >= 20`，且 `stderrTail[i]` 与原文第 6–25 行**逐项严格相等**、顺序一致（不得只保留最后一行、不得摘要替换） | ≥20 行原文齐全且逐行相等 |
| AC-18 | 运行时验证（退出码 + 信号） | (a) fake runtime `process.exit(7)` → 记录 `exitCode === 7` 且 `terminationSignal === null`；(b) fake runtime 自杀于 `SIGTERM`（`process.kill(process.pid,'SIGTERM')`）→ 记录 `terminationSignal === 'SIGTERM'` 且 `exitCode === null` | 两个分支各有一条字段级证据 |
| AC-19 | 运行时验证（orchestrator + connection-ui 联合） | 用 `hasCredentials() === false` 的 port：断言记录 `kind === 'missing-credentials'`；snapshot 为 `failed` + `errorKind === 'missing-credentials'`；`ConnectionUiController.getState()` 满足 `phase === 'failed'`、`message` 含缺凭据语义（`missing credentials` 或占位文案）、`settingsDeepLinkAvailable === true`、`message !== '正在连接到 Host…'`；并断言存在打开设置的命令（沿用既有 settings deep link 实现，断言命令 id 已注册） | 字段断言 + 四项 UI 断言 + 设置入口 |
| AC-20 | 运行时验证（不期望行为型，遍历所有失败分类） | 遍历 AC-14/15/16/17/18/19 产生的诊断记录，断言每条 `kind ∈ {spawn, handshake-timeout, bridge-listen, child-exited, missing-credentials}`（**根因一律取自 `kind` 字段，不得从文案反推**）；再遍历对应 snapshot，断言 `ConnectionUiController.getState().phase !== 'connecting'` 且 `message` 非空并包含该失败的根因终态文案（此项是 AC-20 对产品 UI 文案本身的要求，文本断言保留） | 记录侧字段级分类齐备；无任何失败态停留在进行时文案 |
| AC-21 | 运行时验证（脱敏） | 令 `process.env.DSH_TEST_TOKEN='super-secret-value-1234'`（或注入 credentials bag）且 fake runtime 的 stderr 回显该值：断言 `records()`、`JSON.stringify(records)`（即 `getDiagnosticsText` 的返回序列化）、sink 收到的文本与 UI `message` 均不含该字面值、含 `[redacted:DSH_TEST_TOKEN]`；再断言当凭据含 `KEY`/`PASSWORD`/`SECRET`/`TOKEN` 命名的键时其值一律不出现在上述四处 | 密文零泄漏（含 JSON 序列化侧） |
| AC-22 | 运行时验证（重试） | (a) 扩展 `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts`（或 `host-diagnostics.spec.ts` 的扩展级用例）：进入失败态后触发 `dsh.statusBarAction`（或面板 `requestRetryConnect`）→ 断言 `hostCreateCount` 递增、`createStartHostPort.start` 以同一路径被重入（spy 计数 1 次/重试）、成功时 snapshot 回 `started`；(b) 断言重试**前**与重试**后**记录成对增加，含 `phase === 'retry'` 且 `retryOfSeq` 指向首启记录 `seq` 的记录（`seq` 严格递增）；(c) 断言失败态下状态栏/面板确实提供可点击入口（`statusBar.command === 'dsh.statusBarAction'` 且 `statusBarVisible === true`） | 入口可点击 + 路径复用 + 记录成对且可溯源 |
| 真机补充证据（AC-13 / AC-14 的实机通道） | 运行时验证（真机，跨 Phase） | 由 Phase 3 驱动扩展在 `VSCODE_DSH_TEST=1` 的真机中执行 `dsh.test.getDiagnosticsText()`，**必须** 逐字段断言返回数组：`Array.isArray(records) === true`；**当 `schemaVersion === 1` 时**每条记录的字段集**恰好**等于 AD-14 的 **18 字段**清单（`> 1` 时只断言其依赖的 v1 子集并把观测到的版本号记入状态 JSON；缺失 / `null` / 非整数 / `< 1` 判 `HARNESS_ERROR`；`[]` 合法且不对版本断言）；存在 `kind === 'node-environment'` 记录且其 `resolvedExecutable` 为绝对路径、`source ∈ {dsh-node-bin, vscode-setting, process-exec-path}`；本 Phase 内以 `host-diagnostics.spec.ts` 断言该钩子的 **JSON 契约**（18 字段字段集 + 类型与可空性 + 版本取自产品常量 + 门禁注册） | Phase 2 内断言钩子注册与 JSON 字段契约（含版本来源常量）；真机取证见 Phase 3 |

**投影扩展断言（AD-13，属于 AC-25 step4 的断言前提，本 Phase 交付）**：在 `host-diagnostics.spec.ts` 中构造一条 `PendingHostInteraction`（approval），断言 `listPending()` 的投影**同时**含 `toolName` 与非空 `reason`，并与入队时的原始值逐字一致；断言未新增其它字段（避免无约束地扩大投影面）。

**边界与反向用例清单（必须全部存在）**：`initialize` 在超时边界内成功（不得误报超时）；stderr 少于 20 行时按实际行数记录（不得伪造 20 行）；子进程正常退出码 0 后断线（记录 `kind === 'child-exited'`）与 spawn 失败（`kind === 'spawn'`）必须归为不同 kind；未知错误必须落到记录 `kind === 'other'`（对应 orchestrator 的 `errorKind === 'process-failed'`）而不是崩溃；**当 `schemaVersion === 1` 时**返回数组的字段集**恰好**等于 AD-14 的 **18 字段**清单（多字段/少字段/改名/类型或可空性不符均判失败）；无任何记录时返回 `[]`（不得返回 `undefined`/抛错）且**不对版本做任何断言**；`VSCODE_DSH_TEST` 未设置时 `dsh.test.getDiagnosticsText` **必须**不存在（断言 `registerCommand` 未被调用）；**版本三口径反向用例（v7，#3）**：记录 `schemaVersion === 2`（模拟未来版本）时断言逻辑**只**校验 v1 子集且**不得**因新增字段失败（并把观测版本记入证据）、记录 `schemaVersion` 缺失或为 `null` / `0` / `"1"`（非整数）时判 `HARNESS_ERROR`。

**契约完整性用例（v7，用户评审 #3；必须存在于 `apps/vscode-dsh/tests/host-diagnostics.spec.ts`）**：单个用例内同时断言 (a) 字段集**恰好 18 个**；(b) 每字段的类型与可空性与 AD-14 清单一致（以设计清单为期望值逐字段比对，不以实现类型推断）；(c) `schemaVersion === 1` 且取自产品常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION`（改常量即该用例失败）；(d) `detail` / `hint` 之外**不得**出现任何文本渲染字段（沿用既有 `renderedText` / `summary` / `log` 的否定断言）。**任何**对字段清单的改动**必须**在同一次改动中把 `schemaVersion` +1 并在该 Phase 的 `implementation.md` 记录理由与对驱动的影响；**禁止**在不递增版本的情况下改字段清单（AD-14 决策 11）。

## 约束（来自 design.md 与本 Phase 相关的架构决策）

- **AD-3**：观察与归类在 `IdeSessionHost`；呈现（Output Channel）在扩展；`AutoStartOrchestrator` 只透传校验过的 kind；`ConnectionUiController` 不重构。**禁止** 在 `extension.ts` 通过解析错误消息字符串做分类。
- **AD-4**：**禁止** 新增 `StartOrchestratorState` / `ConnectionUiPhase` 成员；`failed` 是既有终态，本 Phase 补的是回归断言。
- **AD-5**：退出码/信号/stderr 尾部/可执行文件路径以 `TransportClosedError` 的结构化只读字段传递；消息保留既有前缀（`exit code: N`、`stderr tail:`、`spawn error:`）以免破坏既有 spec。
- **AD-14**：**新增** `dsh.test.getDiagnosticsText`，**返回 `HostDiagnosticRecord[]` 的结构化 JSON 记录数组**（**18 个字段**的确切清单 = `schemaVersion` + 17 个载荷字段、字段恒存在、不适用时 `null`/空数组、无记录时返回 `[]`），**禁止**返回字符串或任何整篇渲染文本字段（`text` / `renderedText` / `summary` / `log`）；**必须** 注册在既有 `shouldRegisterTestHooks` 门禁之内，**不得** 在门禁之外暴露。命令名保持不变（历史标签），注册时的 JSDoc **必须** 写明"名称沿用，返回结构化 JSON 记录数组，不返回文本"。驱动与测试**必须**逐字段断言，**不得**从文本提取/匹配文案。**版本契约（v7，#3，AD-14 决策 9–12）**：每条记录**必须**含 `schemaVersion`（类型为字面量 `1`、**不可空**、恒存在；产品代码内**必须**以单一常量 `HOST_DIAGNOSTIC_SCHEMA_VERSION = 1` 为唯一真相源，**不得**散落字面量）；**不得**改成 `{schemaVersion, records}` 包裹对象（返回值**必须**满足 `Array.isArray(records) === true`）；驱动与测试**必须**按版本分流断言（`=== 1` 精确字段集 / `> 1` 只断 v1 子集并记录版本 / 缺失或非法 → `HARNESS_ERROR`；`[]` 不判版本）；**任何**字段面改动**必须**同一次改动 +1 版本（严于 `SESSION_FORMAT_VERSION`，理由见 AD-14 取舍）。
- **AD-13**：**扩展** 既有 `dsh.test.listPendingInteractions` 的投影，增加 `toolName` 与 `reason`（命令已存在，只改投影内容）；**不得** 新增读取会话日志的 `dsh.test.*` 命令。
- **本 Phase 不交付** `dsh.test.answerApproval` 与 `InteractionCoordinator.resolveApproval`（属 Phase 3 的 step4 作答面，见 AD-12）；本 Phase 的 `interaction-coordinator.ts` 改动**仅限**投影字段。
- 所有写入 sink 与 UI 的文本必须先过 `redactSecrets`（复用 `apps/vscode-dsh/src/redact.ts`，不得另写一套）。
- 仓库硬约束：ESM + `strict: true`；导出需 JSDoc；`packages/sdk/client/src/client.ts` 受 per-file 100% 覆盖率门槛约束；文件末尾恰好一个换行。
- 诊断文案语言：`apps/vscode-dsh/src` 不在 `verify-client-ui-i18n` 扫描范围内，用户可见文案沿用既有扩展风格（中文），Output Channel 的技术片段保持原文（英文），两者都不得包含密文。
- 不新增依赖（不引入日志库）；不新增 `contributes.configuration`（设置面已在 Phase 1 引入）。
- 本 Phase 不得修改 `packages/core/agent-loop`。

## 产出清单

| 类型 | 路径 |
|---|---|
| 新增 | `apps/vscode-dsh/src/host-diagnostics.ts` |
| 新增 | `apps/vscode-dsh/tests/host-diagnostics.spec.ts`（sink / 记录 / 脱敏 / 投影字段 / `getDiagnosticsText` 的 JSON 字段契约（**18 字段**）与门禁 / **契约完整性用例（字段集 18 + 逐字段类型与可空性 + 版本取自 `HOST_DIAGNOSTIC_SCHEMA_VERSION` + 无文本渲染字段）** / Output Channel + 命令 + 重试入口） |
| 修改 | `packages/sdk/client/src/client.ts`（`TransportClosedError` 结构化细节） |
| 修改 | `packages/sdk/client/tests/sdk-client.spec.ts`（真实 spawn 失败 → `details.spawnError` / `details.executable`） |
| 修改 | `apps/vscode-dsh/src/session-host.ts`（六类边界记录 + `HostFailureKind` + 类型化启动错误） |
| 修改 | `apps/vscode-dsh/src/auto-start-orchestrator.ts`（`StartErrorKind` 扩展 + 读取校验过的 kind） |
| 修改 | `apps/vscode-dsh/src/extension.ts`（Output Channel + sink、`dsh.showHostDiagnostics`、重试记录、`dsh.test.getDiagnosticsText`） |
| 修改 | `apps/vscode-dsh/src/interaction-coordinator.ts`（**仅**投影补 `toolName` / `reason`） |
| 修改 | `apps/vscode-dsh/package.json`（`contributes.commands += dsh.showHostDiagnostics`） |
| 修改 | `apps/vscode-dsh/tests/session-host.spec.ts`、`apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` |
| 过程 | `phases/phase-2-host-fail-loud-diagnostics/implementation.md`、`repo-exploration.md`、`review.md`、`verification.md` |
