# Phase 2 实现摘要 — `phase-2-host-fail-loud-diagnostics`

| 项 | 值 |
|---|---|
| Phase ID | `phase-2-host-fail-loud-diagnostics`（逐字复制自 `phase-plan.md` DAG JSON） |
| 工作流 | `vscode-dsh-usable-loop` |
| 分支 | `impl-phase-2-host-fail-loud-diagnostics` —— 首次编辑前用 `git branch --show-current` 核实；所有改动留在工作区，本 agent 除只读检查外不执行任何 git 命令 |
| UI | DAG JSON 为 `ui: false` → 无原型门禁、无 `visual-baseline.md`、本 Phase 无样式工作 |
| 执行者 | implementer（子 Agent）；仅自测 —— 判决权归独立 reviewer 与 verifier |
| 日期（UTC） | 2026-09-16 |
| 版本 | **回炉第 1 轮** —— 在 round-0 成果之上按 `review.md` 修复（2 项 🔴 MUST-FIX、12 项 🟡 SHOULD-FIX，全部处理，无跳过）。round-0 摘要已按「启动自清理协议」用 `mv` 归档到 `.archive/implementation-20260915T161215Z.md`，本文件取代之 |
| 本轮必读 | `review.md`（完整）、`spec.md`（完整重读）、`design.md:186-201`（AD-5）+ AD-14 字段表、`tech-debt-registry.md`、`.cursor/skills/project-test/SKILL.md`；四份 `review-*.md` 报告仅按需定点 grep |
| round-0 已读 | `spec.md`、`repo-exploration.md`、`tech-debt-registry.md`、两个运维技能、`design.md:160-333`，以及每个被改产品文件的函数体 |

范围：把 Host 启动的每个失败边界变成一条可检视、已归类、已脱敏的诊断记录，并给用户提供查看与重试的入口。共 12 个被改的受版本控制文件（+757 / −34，据 `git diff --stat`）加 2 个新文件（460 行记录器、1,234 行测试），全部落在本 Phase 的文件清单内；另有两个文档面（`tech-debt-registry.md`，以及属 agent 契约而非 Phase 产物的运维技能 —— 见 §8.8）。

## 1. 本 Phase 交付了什么

```
                    ┌─────────────────────────────────────────────┐
  start() 阶段      │  记录（18 字段，已脱敏）  →  sink            │
  ───────────────   │                                             │
  解析         ──┐  │  kind: node-environment | bridge-listen      │
  门槛校验     ──┤  │      | spawn | handshake-timeout             │
  bridge 监听  ─┼──┼→     | child-exited | missing-credentials    │
  建 client    ─┤  │      | other            （7 个成员）          │
  spawn        ─┤  │  + resolvedExecutable / source / socketPath │
  握手         ──┘  │  + exitCode / terminationSignal / stderrTail│
                    │  + handshakeTimeoutMs / detail / hint       │
                    └───────────────┬─────────────────────────────┘
                                    │
        extension.ts: HostDiagnosticRecorder（上限 200，带 seq，逐字段脱敏）
                                    │
              ┌─────────────────────┴──────────────────────┐
              ▼                                            ▼
   Output Channel「DeepSeek Harness」            dsh.test.getDiagnosticsText
   （dsh.showHostDiagnostics 打开）              （仅测试门禁内，返回数组）
```

链路端到端连通：`session-host.ts` 归类边界 → `HostDiagnosticRecorder` 编号、打时间戳、脱敏 → sink 渲染进通道 → `ConnectionUiController` 投影出终态（`failed` + 根因文案）→ 状态栏入口（`dsh.statusBarAction`）经同一个 `StartHostPort` 重试，重试记录与开链记录配对（`phase: 'retry'`、`retryOfSeq`）。

词表成员恰好等于冻结契约所写的那些 —— 6 个被 AC 点名的边界 + `other`。`StartErrorKind` 另含 `invalid-setting`（Phase 1 的类，由 `StartHostPort` 层在任何 Host 边界存在之前抛出）；两个类型**刻意不同构**，§3 说明该失败由谁承载。

## 2. 变更清单

### 2.1 新增产品文件

| 文件 | 行数 | 内容 |
|---|---|---|
| `apps/vscode-dsh/src/host-diagnostics.ts` | 460（新增） | 诊断契约与记录器整体 |

当前实测导出：

| 符号 | 行 | 说明 |
|---|---|---|
| `HOST_DIAGNOSTIC_SCHEMA_VERSION` | `:20` | 字面量 `1`，契约版本的唯一真相源（AD-14） |
| `HOST_DIAGNOSTICS_CHANNEL_NAME` | `:23` | `'DeepSeek Harness'` —— 唯一稳定通道名（AC-13） |
| `HOST_DIAGNOSTIC_RECORD_LIMIT` | `:26` | `200`；超出后先丢最旧记录 |
| `HostFailureKind` | `:44` | **7 个成员**（冻结契约）：`node-environment`、`bridge-listen`、`spawn`、`handshake-timeout`、`child-exited`、`missing-credentials`、`other` |
| `HostDiagnosticPhase` | `:54` | `'start' \| 'retry'`（AC-22） |
| `HostDiagnosticRecord` | `:62` | 冻结的 18 字段记录 —— 见 §3 |
| `HostDiagnosticInput` | `:107` | 边界提供的子集；`schemaVersion`/`seq`/`time`/`phase`/`retryOfSeq` 由存储层填 |
| `HostDiagnosticSink` | `:141` | 扩展实现的端口（输出通道） |
| `HostFailureRecorder` | `:153` | `IdeSessionHost` 依赖的端口 —— 它永远不知道 VS Code |
| `HostDiagnosticRecorderOptions` | `:169` | `sink`、`now`、`credentials` |
| `startErrorKindForFailure` | `:224` | `HostFailureKind` → `StartErrorKind`，对 7 个成员穷尽 |
| `hostFailureKindForStartError` | `:245` | 反向映射；`case 'invalid-setting': return null` 为**显式**分支，理由写在其 JSDoc |
| `createStartFailureListener` | `:278` | 编排器侧监听器：记录 Host 无法归类者（AC-22） |
| `HostDiagnosticRecorder` | `:304` | 有界存储、seq / 时间戳 / phase 记账、每个字符串字段脱敏 |
| `formatHostDiagnosticRecord` | `:430` | 通道用的渲染块；技术片段保持英文 |

脱敏走 `./redact.ts` 的 `redactSecrets` —— 未另写第二套脱敏器（AC-21）。

### 2.2 被改产品文件

| 文件 | Diff | 关键行 |
|---|---|---|
| `apps/vscode-dsh/src/session-host.ts` | +146 | `StartStage`（`:109`）、`StartFailureContext`（`:114`）、`describeStartFailure`（`:134`）含 `bridge-listen` 分支（`:175`）、`HostFailureDiagnostics` + 构造参数（`:223`、`:269-270`）、spawn 前 `setCredentials`（`:377`）、按 await 步骤赋 stage（`:403-433`）、成功时 `onStartSucceeded()`（`:440`）、`catch` 内 `record` + `startErrorKindForFailure`（`:445-455`） |
| `apps/vscode-dsh/src/extension.ts` | +105 | `OutputChannelLike`（`:297`）、`VsCodeLike.createOutputChannel`（`:169`）、模块态（`:355-357`）、通道 + 记录器 + sink + 编排监听器（`:424-448`）、`dsh.showHostDiagnostics`（`:537-539`）、`shouldRegisterTestHooks` 内的 `dsh.test.getDiagnosticsText`（`:1100-1109`）、尝试前取高水位（`:2332`）与 `catch` 内的兜底记录（`:2367-2373`）、释放接线（`:1229`、`:1279-1281`） |
| `packages/sdk/client/src/client.ts` | +62 | `TransportClosedDetails`（`:39-50`）、`NO_TRANSPORT_DETAILS`（`:53`）、`TransportClosedError.details`（`:68`、`:74`）、捕获态（`:225-231`）、从 exit 处理器取信号（`:290`）、`closedError()`（`:502`）、`transportDetails()`（`:506`） |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | +19 | `START_ERROR_KINDS` 增 `bridge-listen` / `spawn` / `handshake-timeout`（`:27-43`）；Host 自己的 `kind` 被透传而非压平 |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | +38 | approval 投影携带 `toolName` + 可选 `reason`（AD-13）（`:91-92`），`listPending` 委派 `projectEntry`（`:195-227`） |
| `packages/sdk/client/src/index.ts` | +4 | 导出 `TransportClosedDetails` 与 `DEFAULT_INITIALIZE_TIMEOUT_MS` |
| `apps/vscode-dsh/package.json` | +4 | `contributes.commands += dsh.showHostDiagnostics`（`:143-145`）—— 唯一的 `package.json` 改动（无新设置、无新依赖） |

### 2.3 测试文件

| 文件 | Diff | 用例数 |
|---|---|---|
| `apps/vscode-dsh/tests/host-diagnostics.spec.ts` | 新增（1,234 行） | 44 —— 契约、版本策略、可执行路径形态、存储、分类、尝试边界、UI 终态、投影、透传、扩展面 |
| `apps/vscode-dsh/tests/session-host.spec.ts` | +274 | 7 条诊断用例，位于 `describe('IdeSessionHost start-failure diagnostics (AC-14 – AC-20)')`（`:164`） |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | +48 | 2 条新用例（词表透传、重试重入，`:205`） |
| `packages/sdk/client/tests/sdk-client.spec.ts` | +47 | 3 条结构化传输细节用例（`:406`、`:424`、`:439`） |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | +38 | 旋钮 `FAKE_STDERR_LINES`、`FAKE_EXIT_CODE`（原样透传，含 `0`）、`FAKE_SELF_SIGNAL`、`FAKE_PENDING_INIT` |
| `packages/sdk/client/tests/fake-runtime.ts` | +6 | 旋钮 `FAKE_EXIT_CODE`（`:65`）、`FAKE_SELF_SIGNAL`（`:66`） |

每个失败边界都由**真实子进程**驱动（`child_process.spawn` 起 fixture），不是 mock `spawn`、也不是桩掉私有方法：AC-14 的 spawn 失败用不存在的路径，AC-15/16 用真实不回答的握手与真实绑不上的 `listen`，AC-17/18 让子进程真的死。

## 3. 冻结契约：记录 18 字段、`kind` 7 成员

| # | 字段 | 类型 | 可空性 / 形态 |
|--:|---|---|---|
| 1 | `schemaVersion` | `typeof HOST_DIAGNOSTIC_SCHEMA_VERSION` | 永不为 null；字面量 `1` |
| 2 | `seq` | `number` | 从 1 起，存储生命周期内严格递增 |
| 3 | `time` | `number` | 毫秒；单调不减 |
| 4 | `phase` | `'start' \| 'retry'` | 恒为二者之一 |
| 5 | `retryOfSeq` | `number \| null` | 链的开头为 `null` |
| 6 | `kind` | `HostFailureKind` | **7** 个成员之一 —— 6 个被 AC 点名的边界 + `other` |
| 7 | `resolvedExecutable` | `string \| null` | **仅** `process-exec-path` 来源为绝对路径；`dsh-node-bin` / 设置来源按解析结果原样记录，不做绝对化 |
| 8 | `source` | `NodeExecutableSource \| null` | 可执行文件是怎么选出来的 |
| 9 | `nodeVersion` | `string \| null` | 门槛校验跑过时才有 |
| 10 | `expectedRange` | `string \| null` | 门槛校验比对的版本要求 |
| 11 | `missingApis` | `readonly string[]` | 空数组，不缺席 |
| 12 | `socketPath` | `string \| null` | 绑不上的 bridge socket |
| 13 | `exitCode` | `number \| null` | 被信号杀死时为 `null` |
| 14 | `terminationSignal` | `string \| null` | 带退出码时为 `null` |
| 15 | `handshakeTimeoutMs` | `number \| null` | 握手被给的上限 |
| 16 | `stderrTail` | `readonly string[]` | 原文，最旧一行在前；子进程写了多少行就有多少行 |
| 17 | `detail` | `string` | 永不空 |
| 18 | `hint` | `string` | 永不空 |

`detail` / `hint` 是唯一的文本渲染字段；通道会渲染它们，但记录仍是结构化的，因此驱动永不解析日志行（AD-14）。

**`schemaVersion` 仍为 `1`，本轮未改 18 字段清单。** 没有字段被增、删、改类型或改可空性；版本策略双向覆盖：`=== 1` 断言精确字段集；构造 `schemaVersion: 2` 的记录只校验 v1 子集即通过（观测到的版本作为证据留存）；`undefined` / `null` / `0` / `"1"` 判 `HARNESS_ERROR`；空存储返回 `[]` 且**不做任何**版本断言。

**本轮真正被改的是一个类型，而 round-0 的自述与此不符。** `HostFailureKind` 曾长出第 8 个成员（`invalid-setting`），而冻结契约（`design.md:307`、`design-zh.md:308` 与 `repo-exploration.md` 的字段表）写的是 7 个。本轮收窄回契约的 7 个（§8.9）—— 因此诚实的表述是：*记录的字段清单未变；`kind` 的成员清单被纠正，且因契约本就写 7 个，不欠版本递增。* 编译期影响面是三张 `Record<HostFailureKind, …>` 表（`FAILURE_DETAILS`、`FAILURE_HINTS`、`START_ERROR_KIND_BY_FAILURE`），全部由编译器兜住。

契约完整性用例（`host-diagnostics.spec.ts:122`）现在以**设计清单**为期望值，而非实现类型，其断言的 `kind` 枚举即 7 成员清单，并附一条反向断言：`'invalid-setting'` **不在**合法取值集合内（`:450`）。

## 4. AC-13 – AC-22 → 用例映射

| AC | 实现 | 用例（文件:行，均为当前实测） |
|---|---|---|
| AC-13 | 通道名常量 `host-diagnostics.ts:23`；在 `extension.ts:424-425` 创建一次；打开命令 `extension.ts:537-539`；测试专用读取点位于 `shouldRegisterTestHooks` 内 `extension.ts:1100-1109` | `host-diagnostics.spec.ts:1010` AC-13(a) 名称稳定 · `:1016` AC-13(b)(c) 命令打开通道且不追加内容 · `:1034` AC-13(d) 钩子存在且返回数组 · `:1040` AC-13(d) 门禁关闭 → 未注册 |
| AC-14 | SDK：`TransportClosedDetails` + `transportDetails()`（`client.ts:39-50`、`:506`）。Host：带 stage 上下文的 `describeStartFailure`（`session-host.ts:134`）。扩展兜底：未被归类的 `StartHostPort` 失败仍记为 `other` | `sdk-client.spec.ts:406` 结构化 spawn 失败细节（真实 `spawn` 一个不存在的绝对路径） · `session-host.spec.ts:234` AC-14（kind `spawn`、`resolvedExecutable`、`detail !== ''`、`source !== null`） · `:267` AC-14 兜底（未归类 → `other`） · `host-diagnostics.spec.ts:1099` AC-14 兜底经扩展：Host 之前的设置拒绝被记为**恰好一条** `other`（这条用例正是 §8.10 中 A′ 覆盖空洞的钉子） · `:1144` 同一出口记录已解析的可执行文件且不泄漏密文 |
| AC-15 | `initializeTimeoutMs` 对 `DEFAULT_INITIALIZE_TIMEOUT_MS` 解析后写入记录 | `session-host.spec.ts:285` —— fixture 永不回答 `initialize`；断言 `kind === 'handshake-timeout'` **且** `handshakeTimeoutMs === 300`（字段断言，不做措辞匹配） · `host-diagnostics.spec.ts:858` 超时类按名抵达快照 |
| AC-16 | `describeStartFailure` 的 `bridge-listen` 分支（`session-host.ts:175`）记录选定的 socket 路径 | `session-host.spec.ts:302` —— 用一个已存在的普通文件当 socket 路径让真实 `listen` 失败；断言 `kind === 'bridge-listen'`、绝对 `socketPath`、`detail` 非空 · `host-diagnostics.spec.ts:858` 类透传 |
| AC-17 | `stderrTail` 按序原文保留，受 SDK 既有尾部上限约束 | `session-host.spec.ts:316` —— 25 个唯一标记（`DSH-FAKE-STDERR-<n>`）后 `exit(1)`；断言长度 ≥ 20 **且**与原文第 6–25 行逐项相等且顺序一致（不摘要、不只留最后一行） |
| AC-18 | `exitSignal` 从 `exit` 处理器捕获（`client.ts:290`），在 `transportDetails()` 与 `exitCode` 分流 | `sdk-client.spec.ts:424` 有退出码且 `terminationSignal === null` · `:439` 有信号且 `exitCode === null` · `session-host.spec.ts:345` 记录把二者分开 —— 本轮新增：`exitCode === 7`、**`exitCode === 0`**、`SIGTERM` 三种结果互不相同，且「少于 20 行」的尾部按值断言（`stderrTail` 恰等于子进程写的那一行） |
| AC-19 | `missing-credentials` 类 + 编排快照 + UI 设置入口 | `host-diagnostics.spec.ts:484` 只记一次，带快照消息 · `:717` `phase === 'failed'`、缺凭据文案、`settingsDeepLinkAvailable === true`、文案 ≠「正在连接到 Host…」、状态栏重试入口在 · `:1068` 经扩展端到端 |
| AC-20 | 每个失败类保留自己的终态文案；失败态永不退回进行时文案 | `session-host.spec.ts:395` 一条链上的不同边界保持可区分（`kind` + `retryOfSeq`） · `host-diagnostics.spec.ts:695` 没有根因停留在进行时文案（根因**取自 `kind`**，不从文案反推） · `:746` 失败态永不退回 `connecting` |
| AC-21 | `redactSecrets` 覆盖每个字符串字段、JSON 形态与渲染块；凭据袋在 spawn 前登记 | `host-diagnostics.spec.ts:320` 该值不出现在 `records()` / `JSON.stringify(records)` / sink 文本 / 渲染块，且出现 `[redacted:DSH_TEST_TOKEN]` · `:361` `KEY` / `PASSWORD` / `SECRET` / `TOKEN` 命名的键对任意取值形态同样成立 · `:1144` 端到端（通道 + 面板横幅） |
| AC-22 | 编排器侧监听器开链/延链；`onStartSucceeded()` 闭链；重试重入同一 `StartHostPort` | `host-diagnostics.spec.ts:385` 每次重试都与开链记录配对（`phase: 'retry'`、`retryOfSeq`、`seq` 严格递增） · `:586` 同一次尝试无论快照重复几次只记一次 · **`:597` Host 之前的拒绝，其重试记为链的下一环**（1 → 2，即 C-1 用例） · **`:616` 排队重试同样重新武装**（`pending` 拼接路径，SF-12） · **`:1117` 经扩展的同一件事：Host 之前的拒绝后重试新增配对记录** · `:1189` 重试重入同一起动路径、`hostCreateCount` 递增、链可恢复为 `started` · `auto-start-orchestrator.spec.ts:205` 重试入口重入同一 port |

与单条 AC 无关但本 Phase 必须存在的用例：契约用例（`host-diagnostics.spec.ts:122`，恰好 18 字段及其声明形态、版本取自产品常量、无文本渲染字段）、无事实边界（`:164`，仍是完整的非空形态）、版本字面量（`:177`）、文本字段缺席（`:188`）、版本分流（`:226-274`）、可执行路径形态（`:276-308`）、有界存储（`:404`）、读时拷贝（`:417`）、时钟回拨下时间不减（`:425`）、7 成员词表及反向断言（`:437`）、`invalid-setting` 的显式 `null` 裁决（`:453`、`:458`）、每个失败 kind 恰好映射一个编排类（`:474`）、监听器忽略 Host 自有类（`:530`）、投影面（`:764-825`）、非 preflight 失败不携带 `diagnostic`（`:1229`）。

## 5. 门槛证据（与 Phase 基线的差量）

基线由调度者于 21:03–21:04 采集，**早于**本 Phase 第一个产品文件的出现（两份基线产物中都不含 `host-diagnostics.ts` 的任何字样），因此对比是真正的前后关系。

| 门槛 | 基线 | round-0 之后 | **回炉第 1 轮之后** |
|---|---|---|---|
| `pnpm run typecheck` | 绿 | exit 0 | **exit 0**（`/tmp/p2r-typecheck.txt`） |
| `pnpm run test apps/vscode-dsh` | 4 文件 / 6 用例失败，351 通过（358） | 失败集合相同，396 通过（403） | **失败集合相同**，404 通过（411）—— `Tests 6 failed \| 404 passed \| 1 skipped`、`Errors 4`（`/tmp/p2r-vscode-dsh.txt`） |
| `pnpm run test packages/sdk/client` | 3 文件、84 通过 | 3 文件、87 通过 | **3 文件、87 通过**（`/tmp/p2r-sdkclient.txt`） |
| `client.ts` 单文件覆盖率 | （门槛） | 100% —— 188/188 语句、113/113 分支、44/44 函数、161/161 行 | **不变，100%，exit 0**（`/tmp/p2r-coverage.txt`） |
| `pnpm run lint` | 红（既有、全仓） | 零新增 | **零新增** —— 本 Phase 触及的每个文件都不高于其基线计数：`extension.ts` 22 → 22、`host-diagnostics.ts` 0、`host-diagnostics.spec.ts` 0、`session-host.spec.ts` 0、`auto-start-orchestrator.spec.ts` 4 → 4、`interaction-coordinator.ts` 9 → 9、`session-host.ts` 1 → 1、`auto-start-orchestrator.ts` 1 → 1，四个 SDK 侧文件均为 0（`/tmp/p2r-lint3.txt`） |
| `pnpm run test:docs` | 9 通过 / 6 失败 | 9 / 6，同样几道门 | **9 通过 / 6 失败，同六道门**（`/tmp/p2r-docs.txt`） |

需要直说的几点：

- `apps/vscode-dsh` 的失败集合与基线**逐条相同** —— 同样 6 条用例、同样 4 个文件（`spike-t0a-replay-rebuild` ×4、`spike-t0b-continue-capability`、`panel-close-delete.e2e`、`verifier-phase1/layer-a-rtl`），根因在 `scripts/test-invariants.ts:188`，与本 Phase 无关。判据是**集合**，不是「全绿」。
- 通过数 358 → 411（+53）、文件数 50 → 51（+1），纯粹因为采集基线时本 Phase 自己的测试尚不存在：`host-diagnostics.spec.ts` 是新增（44 条），其余差量来自 round-0 加到 `session-host.spec.ts` / `auto-start-orchestrator.spec.ts` 的用例，加上本轮新增的 8 条。没有任何既有用例消失或翻面。
- lint 按**文件**比而非逐行比：本轮的编辑使 `extension.ts` 行号偏移，逐行 diff 会把 22 条既有发现报成「新增」。lint 全仓改动前后都是红的（生成 `.d.ts` 里数千条）；此处唯一的主张是**本 Phase 触及的文件零新增**。我自己的新用例一度引入 2 条 `no-unnecessary-type-assertion`（`gates[0]` / `gates[1]`），已在收尾前移除，复跑确认为 0。
- 文档门禁不扫描 `.specdev/specs/**`（两份产物都没有提到本工作流的文件），因此六条既有失败与本文档无关。

验证命令（`PATH` 前置 Node 24.3.0）：

```
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run typecheck
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test apps/vscode-dsh
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test packages/sdk/client
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm exec vitest run --coverage \
    --coverage.include=packages/sdk/client/src/client.ts packages/sdk/client
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run lint
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test:docs
```

覆盖率命令刻意收窄 `coverage.include`：仓库配置对 `packages/*/*/src/**/*.{ts,tsx}` 套单文件 100% 阈值，若只过滤测试文件而不过滤插桩集合，每个未被触及的源文件都会被记 0% 并淹没门槛。这条已写进 `project-test`，避免下一个 agent 重新踩。

## 6. DEBT-008 —— 本 Phase 已解决

| 项 | 之前 | 之后 | 证据 |
|---|---|---|---|
| E-1 引用 | 两处 JSDoc 引 `(AD-10)`，但 `design.md:225` 的 **AD-9** 才是「提供 `dsh.nodeBin` 设置项 + 三级解析链」，`:243` 的 AD-10 是**文档落点**决策 | 两处均引 `(AD-9)` | 对 `apps/vscode-dsh/src/` 分别 `grep -rn 'AD-9'` 与 `'AD-10'`：仅 `extension.ts:233`（"Read this extension's settings (AD-9)"）与 `extension.ts:2245`（"Read the `dsh.nodeBin` Node executable setting (AD-9)"）两处命中，且都是 AD-9，`AD-10` **零命中** |
| E-2 来源句 | 来源句（"Class of a failed `IdeSessionHost.start`" / "the vocabulary `IdeSessionHost.start` throws with"）未覆盖成员 `invalid-setting`，而该成员实由 `extension.ts` 的 `readNodeBinSetting` 在 `StartHostPort` 层抛出 | 两句均扩为覆盖 `StartHostPort` 层 | `session-host.ts:54` 与 `auto-start-orchestrator.ts:40` 均含 "or the `StartHostPort` wrapping it" |

只动了 JSDoc 措辞：没有类、成员、类型或行为变化，既有行为用例保持全绿。注册表条目已从「活跃债务」移入「已解决」，并附上述验证文本。

## 7. F-3 落点（自 Phase 1 审查第 3 轮移交）

| 项 | 落点 |
|---|---|
| F-3.1 —— `invalid-setting` 必须有显式分支 | `hostFailureKindForStartError`（`host-diagnostics.ts:245`）为它写了独立的 `case` 并 `return null`，理由成文，而非落进 `undefined` 的兜底；由 `host-diagnostics.spec.ts:453`（取值为 `null`）与 `:458`（该成员不在记录词表内）断言。`startErrorKindForFailure`（`:224`）对 7 个记录 kind 保持穷尽。 |
| F-3.2 —— 读 `.diagnostic` 前先按 `kind` 收窄 | 既有不变式仍成立：`.diagnostic` 恰好在 `kind === 'node-environment'` 时存在。`session-host.ts` 的新路径遵守之，`host-diagnostics.spec.ts:1229` 断言非 preflight 失败完全不携带 `diagnostic` 负载 |
| F-3.3 —— `resolvedExecutable` 仅在 `process-exec-path` 来源为绝对 | `launch.ts:132-139` 对设置来源原样返回，诊断侧不含任何「绝对」假设。字段文档现在**写明**该限制（`host-diagnostics.ts:75-80`，`HostDiagnosticInput` 侧对应 `:114-118`），并新增两条用例钉住两个方向：`host-diagnostics.spec.ts:284`（`process-exec-path` 来源确为绝对且原样记录）与 `:300`（调用方提供的设置值原样透传、不做绝对化）。`launch.ts` 本身未动 —— 其归一化行为属设计轨，超出本 Phase。 |

## 8. 与 `spec.md` / `design.md` / `repo-exploration.md` 的偏离

每一条都是「实现刻意与字面指令不同」或「代码事实与调研报告冲突」之处。没有一条是静默的。

**8.1 `apps/vscode-dsh/src/connection-ui.ts` 无需改动。** round-0 那句自述的**前提本身是错的**：`spec.md` 的文件清单**并未**把 AC-19/AC-20 的 UI 投影指派给该文件 —— 本 Phase 的产出清单列的是 `session-host.ts`、`auto-start-orchestrator.ts`、`extension.ts`、`interaction-coordinator.ts`、`package.json` 与两个 SDK 文件，`connection-ui.ts` **不在其中**（round-0 摘要把这一点说反了）。真实且成立的部分是：该投影**已经存在**且已满足 AC：`errorKind === 'missing-credentials'` 驱动 `settingsDeepLinkAvailable`（`connection-ui.ts:140`）、`phase = 'failed'` 即终态（`:128-129`）、文案回落 Host 自己的 `errorMessage`（`:152-154`）、状态栏恒带 `command = 'dsh.statusBarAction'`（`:81`、`:188`）。改它只会是零收益重写，因此本 Phase 交付的是缺失的**证据**：`host-diagnostics.spec.ts:695`、`:717`、`:746` 驱动真实 `ConnectionUiController`（用 VS Code shim，不是桩掉 controller）。影响：行为上无任何偏离；被纠正的是本文档自己的前提（SF-8）。

**8.2 `packages/sdk/client/src/index.ts` 在变更集内。** 它导出 `TransportClosedDetails` 与 `DEFAULT_INITIALIZE_TIMEOUT_MS`。前者是让 SDK 的结构化错误可被消费方使用（AC-14 的 SDK 层）；后者让 AC-15 的 `handshakeTimeoutMs === 300` 断言绑定产品默认值，而不是把字面量抄进 Host。影响：对 `spec.md` 文件清单的加性扩展。

**8.3 测试 fixture 增加了旋钮。** `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` 与 `packages/sdk/client/tests/fake-runtime.ts`。AC-15/17/18 要求真实进程行为（不回答 `initialize`、长 stderr 尾、指定退出码、自我发信号），而 fixture 是唯一能表达它的地方。没有产品文件为可测性被改造，也没有新增依赖。影响：超出 spec 文件清单的测试专用面。

**8.4 `interaction-coordinator.ts` 的改动略多于「加两个投影字段」。** approval 分支被抽成私有 `projectEntry`（`:195-227`），而非内联三元链。两个新字段是功能部分；抽取只是让投影可读并满足仓库缩进规则。公开面未变（返回形态相同，`reason` 缺席时仍不出现）。

**8.5 重试记录由编排器侧监听器产生，而非 UI。** AC-22(b) 要求一次重试「前后」都有记录、并经 `retryOfSeq` 配对。机制是 `createStartFailureListener`（`host-diagnostics.ts:278`）加油存储层的链记账：Host 归类它能归类的，扩展记录编排器投影出来的，并做去重以免一次失败被记两次。`dsh.test.answerApproval` / `InteractionCoordinator.resolveApproval` **未**添加 —— 它们属 Phase 3（AD-12）。

**8.6 AC-14 有两层证据，且两层都跑真实 spawn。** SDK 层失败由 `createProcessHarnessClient({ command: '<不存在的绝对路径>' })` 产生，真实 `child_process.spawn` 失败，断言 `TransportClosedError.details.spawnError` / `.executable`；Host 层用同一生产错误类型经 `IdeSessionHost` 驱动。两层都没 mock spawn。

**8.7（round-0，未变）扩展层对未归类失败的兜底。** `IdeSessionHost` 覆盖自己的边界；对于在它外面（`StartHostPort` 层，如入口解析、`new HarnessClient()`）抛出的失败，`createStartHostPort` 在尝试前取 `diagnostics.lastSeq()`，并在 `catch` 中于高水位线未推进时记一条通用 `other`。本轮对「哪些失败会走到这个分支」的更正见 §8.10。

**8.8 `.cursor/skills/*` 的更新不是 Phase 产物。** 本 agent 的契约要求在构建/测试成功后更新 `project-build` / `project-test`，本轮更新了 `project-test`。它们位于工具树，而用户已裁定该树不随本 Phase 入库（DEBT-009），故 `git status` 会显示，但本 Phase 的产品变更集（§2）不含它们。

**8.9（第 1 轮）`HostFailureKind` 从 8 个成员收窄回契约的 7 个 —— 这**确实**是一处类型变更。** round-0 把 `invalid-setting` 加进了记录词表，而冻结契约从未写它（`design.md:307` 列的是 7 个；`requirements.md` 中无任何 AC 覆盖「无效设置」）。审查判 MUST-FIX，调度者裁定修法为「收窄实现，不动设计」。`design.md` 与 `design-zh.md` 逐字节未改。被改动的是：类型本身（`host-diagnostics.ts:44`）、编译器强制暴露的三张 `Record<HostFailureKind, …>` 表（`FAILURE_DETAILS`、`FAILURE_HINTS`、`START_ERROR_KIND_BY_FAILURE`）、以及契约用例的期望枚举。为什么设计对、实现错：这 7 个成员恰好等于 6 个被 AC 点名的边界 + `other` 桶；而 `invalid-setting` 是 `StartHostPort` 层读 Node 选择设置时抛出的 `StartErrorKind` —— 那时任何 Host 边界都还不存在 —— 因此没有任何 Host 记录能覆盖它。它的根因文案由 Phase 1 的路径承担（`StartErrorKind` → 连接区快照），这正是 AC-19/AC-20 所断言的。影响：`spec.md:63(b)`（期望值取自设计清单）、`design.md` AD-14 的 `kind` 行。**不欠 `schemaVersion` 递增**：契约本就写 7 个，字段*清单*未变。

**8.10（第 1 轮）扩展兜底不再问 `instanceof HostStartError`。** 那条启发式原本是为了避免 Host 自己已记录的失败被重复计数。收窄词表（§8.9）把它变成了覆盖空洞：`dsh.nodeBin` 取值类型错误是 `HostStartError`，而 Host 从不记录它（没有边界认领），于是启发式会跳过它，这次尝试将不产生任何记录 —— 而 `spec.md` 的兜底条款要求**每一次**启动失败都有记录。现在该 guard 只看精确信号：`diagnostics.lastSeq() === seqBeforeStart`（`extension.ts:2332` / `:2367`）。它在两种情形下都仍然正确：已被某边界记录过的失败会**推进高水位线**（于是被跳过，AC-22 的「一次尝试不记两条」成立）；未被推进者（无效设置、dsh 入口解析失败）保持原值并被记为 `other` —— 这正是设计留给「没有边界认领的失败」的桶。归类仍是结构化的：`extension.ts` 依旧不匹配消息文本（AD-3）。证据：`host-diagnostics.spec.ts:1099` 断言 Host 之前的设置拒绝产生**恰好一条** `other` 记录，§9 记录了「启发式一旦回来该用例即变红」的变异验证。

**8.11（第 1 轮）SDK 的「被信号终止」分支保留 `termination signal: <name>` 消息行。** AD-5 把消息前缀冻结为 `exit code: N` / `stderr tail:` / `spawn error:`（`design.md:190`），因此该行超出冻结前缀集 —— 即审查的 SF-7。这里**刻意保留**并在本文档登记，而不是删掉，理由有三：(a) AD-5 自己的理由（`design.md:191`）是「消息为只有文本的读者携带同样的事实」，而 AC-18 要求在退出码不可得时记录信号名 —— 结构化字段满足断言，文本行满足纯文本读者；(b) 它是**加性**的：没有任何既有前缀含义被改；(c) 它取代的东西更糟 —— 本 Phase 之前的代码对被信号终止的进程打印 `exit code: null`，因为旧 guard 是 `exitCode !== undefined`，而 `child.once('exit')` 对信号终止的子进程给的是 `code === null`。现在该行说 `termination signal: SIGTERM`，且 guard 只在真有退出码时才声称有退出码。代价：被信号终止的运行时消息多一行；结构化字段 `details.terminationSignal` 仍是被断言的主通道（`sdk-client.spec.ts:439` 两者都断言）。影响：`design.md` AD-5（前缀清单）、`spec.md` §约束（同一句）。日后若要移除，成本是一行加一条断言 —— 写在这里是为了让取舍可见，而不是让人去猜。

**8.12（第 1 轮）AC-18 的取证窗口是握手**前**的退出路径；握手**后**的死亡不产生启动失败记录。** 这就是审查的 SF-11 ≡ connectivity C-2，调度者已裁定读法：`spec.md:13` 把整个 AC 集的范围限定为「Host **启动**的每个失败边界」，`spec.md:52` 用该窗口内的 `process.exit(7)` / `SIGTERM` 驱动 AC-18，而记录自己的 `phase` 词表（`'start' | 'retry'`）本就是启动中心的 —— 因此**握手之后**的死亡是运行期断线，不是启动失败。于是 AC-18 在握手前路径上取证，包括本轮让 fixture 原样透传的 `exitCode === 0` 情形（`session-host.spec.ts:345`）；握手后的死亡走 `TransportClosedError` / transport-watcher 路径，诊断通道不受影响。该缺口**已登记为 `DEBT-010`**（🟡非阻塞），因为 Phase 3 的冒烟运行若读到空的 `getDiagnosticsText()`，不得把它读作「没有失败发生」。要接上它需要给 `phase` 加第三个成员 —— 属字段面改动，按 AD-14 决策 11 必须递增 `schemaVersion`，进而破坏 Phase 3 的 `=== 1` 精确字段集断言；代价与收益不成比例，不宜在本 Phase 内做。

## 9. 反桩与完成前自检

| 检查 | 结果 |
|---|---|
| 新代码中的空壳 / no-op | 无 —— 对 `apps/vscode-dsh/src`、`apps/vscode-dsh/tests`、`packages/sdk/client/src`、`packages/sdk/client/tests` 跑 `grep -rn '@STUB'` 零命中 |
| 欺骗性注释 | 无 —— 被改产品文件中没有 `TODO` / `FIXME` / "will be wired" / "placeholder" |
| `tech-debt-registry.md` | 本轮无新桩可登记（本 Phase 不产生桩）；DEBT-008 已关闭；审查裁定要求的残余缺口已登记为 **DEBT-010** |
| 存储 → 读取方连通性 | 记录器的 `records()` 被 `dsh.test.getDiagnosticsText`（`extension.ts:1107`）与 `createStartFailureListener` 的去重检查读取；sink 被输出通道读取（`extension.ts:429-433`）；两者都有端到端用例（`host-diagnostics.spec.ts:1034` 经已注册命令读取，`:1189` 经 sink 的重试链） |
| 调用方 → 被调方连通性 | `IdeSessionHost` 依赖 `HostFailureRecorder` 端口而非 VS Code；扩展提供真实记录器。端到端追踪：`start()` → `describeStartFailure` → `record` → sink → 通道，以及 `onChange` → 监听器 → `record` → 重试链；编排器侧路径 `requestRetry` → `runStart` → `starting` → `failed` → 监听器（`auto-start-orchestrator.ts:205-249`） |
| **功能关掉时用例会红吗？** | 会，而且本轮是**实测**而非论证。三次变异，各自施加后已复原：(1) 恢复旧监听器 guard（`if (state === 'started') recorded = undefined`）→ `host-diagnostics.spec.ts` **2 条失败** —— 重试配对待（`:597`）与排队重试待（`:616`）—— 而「尝试内去重」待仍然**绿**，这正是 C-1 所需的区分度；(2) 在扩展 `catch` 里恢复 `!(error instanceof HostStartError)` → A′ 待（`:1099`）变红；(3) 恢复 fixture 的 `process.exit(code \|\| 1)` → AC-18 待（`session-host.spec.ts:345`）变红。每次复原后复跑，失败集合回到基线。 |
| 越界禁令 | 无 `resolveApproval` / `answerApproval`；`packages/core/agent-loop` 未动；`package.json` 仅改 commands（无依赖、无新配置键）；未新增 `StartOrchestratorState` / `ConnectionUiPhase` 成员；测试名与注释中无审查条目码（本轮删净 `F-3.x`，按仓库惯例保留 `AD-*` 决策编号）；无 sidecar / `workflow-context.md` 文件 |

## 10. 本 Phase 未触及

`apps/vscode-dsh/src/connection-ui.ts`、`apps/vscode-dsh/src/node-env-guard.ts`、`apps/vscode-dsh/src/redact.ts`、`packages/sdk/client/src/launch.ts`、`packages/core/agent-loop/**`、`design.md`、`design-zh.md`、`requirements.md`、`phase-plan.md`、`spec.md`、`repo-exploration.md`，以及 `current-status.json`（状态推进属调度者职责）。除只读检查外未执行任何 git 命令：没有 add、commit、branch 或 stash，整个变更集仍在工作区，供调度者在 HG-3 统一提交。

## 11. 轮次 2 —— 清除提交期 staged-lint 门禁

仓库自带的 `pre-commit`（`lefthook` 的 `lint (staged)` job）以 **4 个 error** 拒绝了本变更集。这 4 处**都不是** Phase 2 的产物 —— 每一行在 `HEAD` 与 Phase 2 的 index 中**逐字相同**（`git show HEAD:<f> | grep -c` 与 `git show :<f> | grep -c` 对下述三个文件都返回 `1` / `1` / `2`）。它们暴露的原因是 hook 的棘轮机制：`lint (staged)` 只 lint 变更集**动过的文件**，所以本 Phase 恰好动到的脏文件会把该文件既有的全部违规一并带出来。调度者裁定「本轮直接修掉」，下面就是全部范围。

### 11.1 四处修复

| # | 位置（修复后） | 规则 | 修复前 | 修复后 |
|---|---|---|---|---|
| 1 | `auto-start-orchestrator.ts:242-243` | `typescript(no-non-null-assertion)` | `if (more.length > 0 && …) {` 内部 `const next = more[more.length - 1]!` | `const next = more.at(-1)` 提到守卫之前；守卫改为 `next !== undefined && …` |
| 2 | `interaction-coordinator.ts:357` | `typescript(no-non-null-assertion)` | `while (insertAt < this.queue.length) {` + `const current = this.queue[insertAt]!` | `for (const current of this.queue) {` |
| 3 | `tests/auto-start-orchestrator.spec.ts:53-58` | `eslint(prefer-const)` | `let setConnected!: (v: boolean) => void` … `setConnected = port.setConnected.bind(port)` | 删掉该绑定；`startImpl` 覆写里直接调 `port.setConnected(true)` |
| 4 | `tests/auto-start-orchestrator.spec.ts:93-98` | `eslint(prefer-const)` | 与 #3 同形 | 同一种改法 |

### 11.2 为什么「想当然的改法」过不了

`tsconfig.base.json:20` 设了 `noUncheckedIndexedAccess: true`，因此 `more[more.length - 1]` 与 `this.queue[insertAt]` 的类型是 `T | undefined`，**只删 `!` 过不了 typecheck**。而 `const x!: T` 在**无初始化器**时非法，所以 #3/#4 的 `let` → `const` 直接替换**根本不是合法 TypeScript**。全程未使用任何规避手段：对三个文件 `grep` `eslint-disable` / `oxlint-disable` / `@ts-expect-error` / `@ts-ignore` / `as any` 均无命中，且文件中已不存在 `!`。

### 11.3 逐处语义等价论证

- **#1.** `more.at(-1)` 为 `undefined` 当且仅当 `more` 为空，故 `next !== undefined` ⟺ 原来的 `more.length > 0`。`at(-1)` 无副作用，把它提到同一条 `&&` 链中的 `this.port.isConnected()` 之前不可观测，`runStart` 收到的仍是 `splice` 出来的最后一个 reason。`next === undefined` 这一支是**可达**的（`pending` 为空），因此这是真实收窄，不是死分支。
- **#2.** 该循环唯一的产物是 `insertAt`：前导中「`state === 'presented'`」或「同 session 且 `pending`」的条目计数。`for … of` 以相同顺序访问相同元素，循环体内不改动 `this.queue`（`splice` 在循环之后），`continue` / `break` 语义不变，故退出值仍是同一个下标 —— 当所有条目都命中跳过条件时即 `this.queue.length`。
- **#3/#4.** `mockPort` 的 `setConnected(v) { connected = v }` 是方法简写，从不读 `this`（它闭包引用 helper 内部的 `connected` 局部变量），所以 `.bind(port)` 本来就是空操作，`port.setConnected(true)` 是同一次调用。`mockPort` 在构造时不会调用 `startImpl`，所以闭包体只在 `port` 已存在之后才执行 —— 对同一条语句所声明 const 的引用是一次**延后读取**，而测试里第一次 `orch.request(…)` 在其之后。

除论证之外，两处改写还做了**差分执行**校验：`/tmp/p2r2-equivalence.ts`（一次性脚本，用 `tsx` 跑，**刻意不入库** —— 本轮范围就是这 4 处）把 `enqueue` 扫描与「取最后一个元素」的修复前 / 修复后两种写法在穷举输入上对比，输出 `EQUIVALENT: enqueue insertAt over 37320 cases; pending last-element over 7 cases`。

### 11.4 命令与结果

所有 Node 调用均前置 `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`。

| 命令 | 修复前 | 修复后 |
|---|---|---|
| `node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern <3 个文件>` | exit 1，即下方 4 条 | **exit 0，完全无输出** |
| `pnpm run typecheck` | — | **exit 0** |
| `pnpm exec vitest run <auto-start-orchestrator / interaction-fail-closed.integration / gap-005-009-debt-fix / host-diagnostics>` | — | **4 文件 / 66 用例全过**，exit 0 |
| `pnpm run test apps/vscode-dsh` | 4 文件 / 6 用例失败，404 通过 | **失败集合逐条相同**，`Tests 6 failed \| 404 passed \| 1 skipped (411)` |
| `node_modules/.bin/tsx scripts/gen-third-party-notices.ts` | — | exit 0；`THIRD_PARTY_NOTICES.md` md5 `e71d3692671c5adf815bb232f757b188` **未变**，且 `git status --porcelain` 对其为空 → **无 diff，无需加入提交集** |
| `pnpm run lint`（整仓） | `/tmp/lint-base-norm.txt`，891 条归一化条目 | `/tmp/p2r2-lint-norm.txt`，差量见 11.6 |
| `pnpm run test:docs` | 9 passed / 6 failed（`/tmp/p2r-docs.txt`） | **9 passed / 6 failed，同六道门**（`/tmp/p2r2-docs.txt`）—— 本节写作未移动任何门 |

修复前的 staged-lint 输出原文：

```
apps/vscode-dsh/src/auto-start-orchestrator.ts:243:24: error typescript(no-non-null-assertion): Forbidden non-null assertion.
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:53:9: error eslint(prefer-const): `setConnected` is never reassigned. help: Use `const` instead.
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:96:9: error eslint(prefer-const): `setConnected` is never reassigned. help: Use `const` instead.
apps/vscode-dsh/src/interaction-coordinator.ts:358:25: error typescript(no-non-null-assertion): Forbidden non-null assertion.
EXIT=1
```

`apps/vscode-dsh` 的失败集合与 `/tmp/p2-baseline-vscode-dsh.txt` 逐条比对（按**集合**，不按「全绿」）：完全相同 —— 同 4 文件同 6 用例（`spike-t0a-replay-rebuild` ×4、`spike-t0b-continue-capability`、`panel-close-delete.e2e`、`verifier-phase1/layer-a-rtl`），没有任何用例翻转。

### 11.5 突变证据 —— 是这 4 处让门禁变绿

把 #2 临时还原为修复前写法（`while (insertAt < this.queue.length) {` + `const current = this.queue[insertAt]!`），对该文件重跑 staged lint：

```
### MUTATED (pre-fix form restored) ###
apps/vscode-dsh/src/interaction-coordinator.ts:358:25: error typescript(no-non-null-assertion): Forbidden non-null assertion.
EXIT=1
```

error 在**完全相同的 `358:25`** 复现 —— 这正是提交 hook 报出的位置，说明门禁确实在扫这一行，而不是「本来就没扫到」。随后恢复该处（用读回文件 + `git diff` 双重确认，而非信任写入动作），对三个文件重跑同一命令 → `EXIT=0`。

### 11.6 整仓 lint 差量

`pnpm run lint` 修复前后都是红的，故沿用既定口径：归一化为 `file|severity|rule` 计数、**去掉行号**（本轮改动会位移行号）后 diff。`/tmp/p2r2-lint-norm.txt` 对 `/tmp/lint-base-norm.txt`：

**减少** —— 共 6 条 / 11 次，全部是移除：

| 被移除条目 | 计数 | 归属 |
|---|:--:|---|
| `auto-start-orchestrator.ts \| typescript(no-non-null-assertion)` | 1 | 修复 #1 |
| `interaction-coordinator.ts \| typescript(no-non-null-assertion)` | 1 | 修复 #2 |
| `auto-start-orchestrator.spec.ts \| eslint(prefer-const)` | 2 | 修复 #3/#4 |
| `auto-start-orchestrator.spec.ts \| @stylistic(arrow-parens)` | 2 | 工作区里既有的 `pre-commit --fix` 格式改动 |
| `interaction-coordinator.ts \| @stylistic(arrow-parens)` | 2 | 工作区里既有的 `pre-commit --fix` 格式改动 |
| `extension.ts \| @stylistic(indent)` | 3 | 同一次 `--fix`（本轮**未**编辑该文件） |

条目数是这份差量算术的支点，而它三条路都对得上：`(文件,规则)` 键集 **891 → 887 = 891 − 6 + 2**；这些条目里的 `@stylistic` 子集正是下文引用的 3 + 2 + 2 = 7 行格式化；而本文表格的**早前版本只有 5 行**，那正是让标题里的「7」看起来像条目数的原因。

**新增** —— 2 条，均非本轮产生：本 Phase 目录下 `test-scripts/verifier-independent-phase2.spec.ts:220` 与 `:490` 的 `warning: Unused eslint-disable directive`。该文件是 verifier 的独立场景脚本（写于 03:18，晚于 `00:30` 的基线抓取），oxlint 会扫 `specs/**/test-scripts/`，而 `project-build` 已把这一类发现记为预期的 +2 —— 它是关于探针自身指令的 warning，不是产品代码里的发现。仓库其余部分未变动：没有任何文件新增诊断，被触及文件既有计数也不变（`interaction-coordinator.ts` 仍是那 5 条 `no-unnecessary-condition`，`auto-start-orchestrator.ts` 与该 spec 仍为 0）。

`pre-commit --fix` 先前已施加到工作区的那 7 行格式改动（按 lint 差量口径为 `extension.ts` 的 3 条 `@stylistic(indent)`，以及另两个文件各 2 条 `@stylistic(arrow-parens)`）被**原样保留**：本轮 diff 是叠加在它们之上，而不是把它们还原回去。

### 11.7 债务

未新增也未消解任何 `@STUB`，故 `tech-debt-registry.md` 不新增条目：这 4 处都是对既有行的保持行为改写，没有需要登记的东西。除只读检查外未执行任何 git 命令，除三个源文件与本文件外未写入任何位置 —— §8.8 记载的、`implementer` 契约所要求的 `.cursor/skills/project-build/SKILL.md` 维护性写入除外。

### 11.8 调度者事实订正（本节非 implementer 撰写）

> **署名**：§11.6 的账目与 §11.7 的范围声明由**调度者（Cursor Agent）**在 round-3 审查后订正，不是 implementer 的原文。订正只涉及对**已存在事实**的复述，未改动任何主张的实质；订正前的文本仍可从 round-3 的 `review-*.md` 引用与 git 历史读到。

订正依据 —— 由调度者独立复现，未采信任何 reviewer 的结论：

| 处 | 订正 | 复现方式 |
|---|---|---|
| §11.6 标题与表格 | `共 7 条` → `共 6 条 / 11 次`；补入漏记的 `auto-start-orchestrator.spec.ts \| @stylistic(arrow-parens)` 一行 | 对三个源文件逐行枚举 `git diff HEAD` → 得 **6 个 `(文件,规则)` 组合 / 11 次出现**；且 `891 − 6 + 2 = 887` 与归一化实测 887 吻合 |
| §11.7 范围声明 | 补入 `.cursor/skills/project-build/SKILL.md` 例外 | 该文件 `git diff HEAD` 的新增行自标「2026-09-16 by implementer，Phase 2 回炉第 2 轮」 |

**一处未能订正（如实记录，不掩饰）**：§11.6 括号内「`interaction-coordinator.ts` 仍是那 5 条 `no-unnecessary-condition`」无法复现 —— `no-unnecessary-condition` 是**类型感知**规则，需整仓 `build:lib:host` 才能重跑，而该节引用的归一化基线（`/tmp/*-norm.txt`）已被清理。reviewer-correctness 读作 6，但它同时把第 6 条指为 `no-confusing-void-expression`（**另一条规则**）—— 若实为 5 条本规则 + 1 条他规则，则原句成立。在基线与类型感知重跑皆不可得的前提下，此点**无法判定**，故保持原文不动，不作猜测性修改。
