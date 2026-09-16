# Phase 2 实现摘要 — `phase-2-host-fail-loud-diagnostics`

| 字段 | 值 |
|---|---|
| Phase ID | `phase-2-host-fail-loud-diagnostics`（逐字取自 `phase-plan.md` 的 DAG JSON） |
| 工作流 | `vscode-dsh-usable-loop` |
| 分支 | `impl-phase-2-host-fail-loud-diagnostics` —— 首次编辑前已用 `git branch --show-current` 核对；所有改动留在工作区，本 agent 除查看外未执行任何 git 命令 |
| UI | DAG JSON 标 `ui: false` → 无原型门禁、无 `visual-baseline.md`、本 Phase 不含任何样式工作 |
| 执行者 | implementer（子Agent）；只做自测 —— 判决权归独立 reviewer 与 verifier |
| 日期（UTC） | 2026-09-15 |
| 修订 | **第 1 轮**全新执行。启动时 `implementation.md` 不存在，启动自清理协议无物可归档（未触碰 `.archive/`） |
| 完整读取 | `spec.md`、`repo-exploration.md`、`tech-debt-registry.md`、`.cursor/skills/project-build/SKILL.md`、`.cursor/skills/project-test/SKILL.md` |
| 按要求定点读 | `design.md:160-333`（AD-1 – AD-14）、`requirements.md:135-153` + `:334`（AC-13 – AC-22 原文） |
| 读函数体（非仅签名） | `node-env-guard.ts`、`session-host.ts`、`extension.ts`、`auto-start-orchestrator.ts`、`redact.ts`、`interaction-coordinator.ts`、`connection-ui.ts`、`packages/sdk/client/src/client.ts`、`packages/sdk/client/src/launch.ts` |

范围：把 Host 启动失败的每个边界都变成一条可检视、有分类、已脱敏的诊断记录，并让用户能查看与重试。改动为 12 个已跟踪文件的修改（`git diff --stat` 计 +734 / −34 行）加 2 个新增文件（约 1450 行：439 行记录器 + 1011 行 spec），全部落在本 Phase 的 `primary_files` 内，另加本 Phase 自己的两份文档面（`tech-debt-registry.md` 的 DEBT-008，以及属于 agent 契约而非 Phase 产物的两个 operation skill，见 §8.8）。

## 1. 本 Phase 交付了什么

```
                    ┌─────────────────────────────────────────────┐
  start() 阶段      │  记录（18 字段、已脱敏）→ sink               │
  ───────────────   │                                             │
  resolve      ──┐  │  kind: node-environment | invalid-setting   │
  preflight    ──┤  │      | bridge-listen | spawn                │
  bridge-listen ─┼──┼→     | handshake-timeout | child-exited     │
  client-create ─┤  │      | missing-credentials | other          │
  spawn        ──┤  │  + resolvedExecutable / source / socketPath │
  handshake    ──┘  │  + exitCode / terminationSignal / stderrTail│
                    │  + handshakeTimeoutMs / detail / hint       │
                    └───────────────┬─────────────────────────────┘
                                    │
        extension.ts：HostDiagnosticRecorder（上限 200 条、seq 递增、统一脱敏）
                                    │
              ┌─────────────────────┴──────────────────────┐
              ▼                                            ▼
   Output Channel「DeepSeek Harness」            dsh.test.getDiagnosticsText
   （`dsh.showHostDiagnostics` 揭示它）          （仅测试门禁内，返回数组）
```

这条链是端到端连通的：`session-host.ts` 归类边界 → `HostDiagnosticRecorder` 编号、打时间戳、脱敏 → sink 渲染进 Output Channel → `ConnectionUiController` 投影出终态（`failed` + 根因文案）→ 状态栏入口（`dsh.statusBarAction`）经**同一条 `StartHostPort`** 重试，且重试记录与开启该链的记录配对（`phase: 'retry'`、`retryOfSeq`）。

## 2. 变更清单

### 2.1 新增产品文件

| 文件 | 行数 | 内容 |
|---|---|---|
| `apps/vscode-dsh/src/host-diagnostics.ts` | 439（新增） | 整套诊断契约与记录器 |

导出（按当前实测行号）：

| 符号 | 行号 | 说明 |
|---|---|---|
| `HOST_DIAGNOSTIC_SCHEMA_VERSION` | `:20` | 字面量 `1`，契约版本的唯一来源（AD-14） |
| `HOST_DIAGNOSTICS_CHANNEL_NAME` | `:23` | `'DeepSeek Harness'` —— 唯一稳定通道名（AC-13） |
| `HOST_DIAGNOSTIC_RECORD_LIMIT` | `:26` | `200`；超出时先丢最旧记录 |
| `HostFailureKind` | `:38` | 8 个成员：`node-environment`、`invalid-setting`、`bridge-listen`、`spawn`、`handshake-timeout`、`child-exited`、`missing-credentials`、`other` |
| `HostDiagnosticPhase` | `:49` | `'start' \| 'retry'`（AC-22） |
| `HostDiagnosticRecord` | `:57-94` | 冻结的 18 字段记录 —— 见 §3 |
| `HostDiagnosticInput` | `:97` | 边界只需提供的子集；`schemaVersion`/`seq`/`time`/`phase`/`retryOfSeq` 由 store 填 |
| `HostDiagnosticSink` | `:127` | 扩展实现的端口（Output Channel） |
| `HostFailureRecorder` | `:139` | `IdeSessionHost` 只依赖它，因此完全不知道 VS Code 的存在 |
| `HostDiagnosticRecorderOptions` | `:155` | `sink`、`now`、`credentials` |
| `startErrorKindForFailure` | `:213` | `HostFailureKind` → `StartErrorKind`，对 `invalid-setting` **显式**处理（F-3.1） |
| `hostFailureKindForStartError` | `:227` | 反向映射；Host 自己拥有的 kind 返回 `null` |
| `createStartFailureListener` | `:257` | 调度者侧监听：记录 Host 无法归类的那部分失败（AC-22） |
| `HostDiagnosticRecorder` | `:283` | 有界存储、seq/时间戳/phase 记账、对每个字符串字段脱敏 |
| `formatHostDiagnosticRecord` | `:409` | 通道用的渲染块；技术片段保持英文 |

脱敏复用 `./redact.ts` 的 `redactSecrets`，**没有**再写一套（AC-21）。

### 2.2 修改的产品文件

| 文件 | Diff | 关键行 |
|---|---|---|
| `apps/vscode-dsh/src/session-host.ts` | +146 | `StartStage`（`:109`）、`StartFailureContext`（`:114`）、`describeStartFailure`（`:134`，含 `bridge-listen` 分支 `:175`）、`HostFailureDiagnostics` + 构造参数（`:223`、`:269-270`）、spawn 前 `setCredentials`（`:377`）、逐步赋值 stage（`:403-433`）、成功时 `onStartSucceeded()`（`:440`）、`catch` 中 `record` + `startErrorKindForFailure`（`:445-455`） |
| `apps/vscode-dsh/src/extension.ts` | +105 | `OutputChannelLike`（`:297`）、`VsCodeLike.createOutputChannel`（`:169`）、模块状态（`:355-357`）、通道 + 记录器 + sink + 调度者监听（`:424-448`）、`dsh.showHostDiagnostics`（`:537-539`）、`shouldRegisterTestHooks` 内的 `dsh.test.getDiagnosticsText`（`:1106-1107`）、释放接线（`:1229`、`:1279-1281`） |
| `packages/sdk/client/src/client.ts` | +62 | `TransportClosedDetails`（`:39-50`）、`NO_TRANSPORT_DETAILS`（`:53`）、`TransportClosedError.details`（`:68`、`:74`）、捕获的状态（`:225-231`）、从 exit 处理器取信号（`:290`）、`closedError()`（`:502`）、`transportDetails()`（`:506`） |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | +19 | `START_ERROR_KINDS` 增补 `bridge-listen` / `spawn` / `handshake-timeout`（`:27-43`）；Host 自己的 `kind` 直通快照，不再被压平 |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | +38 | approval 投影带上 `toolName` 与可选 `reason`（AD-13）（`:91-92`）；`listPending` 改为委托 `projectEntry`（`:195-227`） |
| `packages/sdk/client/src/index.ts` | +4 | 导出 `TransportClosedDetails` 与 `DEFAULT_INITIALIZE_TIMEOUT_MS` |
| `apps/vscode-dsh/package.json` | +4 | `contributes.commands += dsh.showHostDiagnostics`（`:143-145`）—— 唯一的 `package.json` 改动（无新设置项、无新依赖） |

### 2.3 测试文件

| 文件 | Diff | 用例 |
|---|---|---|
| `apps/vscode-dsh/tests/host-diagnostics.spec.ts` | 新增（1011 行） | 36 条 —— 契约、版本策略、store、分类、UI 终态、投影、直通、扩展面 |
| `apps/vscode-dsh/tests/session-host.spec.ts` | +254 | `describe('IdeSessionHost start-failure diagnostics (AC-14 – AC-20)')` 下 7 条新用例 |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | +48 | 2 条新用例（词表直通、重试重入） |
| `packages/sdk/client/tests/sdk-client.spec.ts` | +47 | 3 条新用例（结构化 transport 细节） |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | +35 | 旋钮 `FAKE_STDERR_LINES`（`:241`）、`FAKE_EXIT_CODE`（`:249`）、`FAKE_SELF_SIGNAL`（`:250`）、`FAKE_PENDING_INIT`（`:279`） |
| `packages/sdk/client/tests/fake-runtime.ts` | +6 | 旋钮 `FAKE_EXIT_CODE`（`:65`）、`FAKE_SELF_SIGNAL`（`:66`） |

每个失败边界都由**真实子进程**驱动（`child_process.spawn` 那个 fixture），而不是 mock 掉 `spawn` 或桩掉私有方法：AC-14 的 spawn 失败用不存在的路径，AC-15/16 用一个真的不应答的握手与一个真的绑不上的 `listen`，AC-17/18 让子进程真的死掉。

## 3. 冻结的 18 字段契约（AD-14）

| # | 字段 | 类型 | 可空性 / 形态 |
|--:|---|---|---|
| 1 | `schemaVersion` | `typeof HOST_DIAGNOSTIC_SCHEMA_VERSION` | 永不为空；字面量 `1` |
| 2 | `seq` | `number` | 从 1 开始，store 生命周期内严格递增 |
| 3 | `time` | `number` | 毫秒；单调不减 |
| 4 | `phase` | `'start' \| 'retry'` | 恒为二者之一 |
| 5 | `retryOfSeq` | `number \| null` | 链首为 `null` |
| 6 | `kind` | `HostFailureKind` | 8 个成员之一 |
| 7 | `resolvedExecutable` | `string \| null` | **仅** `process-exec-path` 来源保证绝对路径（F-3.3） |
| 8 | `source` | `NodeExecutableSource \| null` | 该可执行文件是怎么被选中的 |
| 9 | `nodeVersion` | `string \| null` | 预检跑过时才有 |
| 10 | `expectedRange` | `string \| null` | 预检比对的要求范围 |
| 11 | `missingApis` | `readonly string[]` | 空数组而非缺字段 |
| 12 | `socketPath` | `string \| null` | 绑不上的 bridge socket |
| 13 | `exitCode` | `number \| null` | 被信号终止时为 `null` |
| 14 | `terminationSignal` | `string \| null` | 正常退出（带码）时为 `null` |
| 15 | `handshakeTimeoutMs` | `number \| null` | 握手被给定的上限 |
| 16 | `stderrTail` | `readonly string[]` | 原文、最旧行在前 |
| 17 | `detail` | `string` | 永不为空 |
| 18 | `hint` | `string` | 永不为空 |

`detail` / `hint` 是**唯一**的文本渲染字段；通道会渲染它们，但记录本身保持结构化，驱动因此永远不需要解析日志行（AD-14）。

**本 Phase 未改动 `schemaVersion`，也不得改动。** 18 字段清单在实施开始前已由 v7 契约完整性要求冻结，所以实现出来的形态就是 v1 形态；实施过程中没有增删字段、没有改类型、没有改可空性。未来若改字段清单，必须在同一次改动里 +1 `HOST_DIAGNOSTIC_SCHEMA_VERSION` —— 契约用例读取该常量，因此只改常量会让该用例变红，直到期望清单同步更新。

版本策略双向都有覆盖：`schemaVersion === 1` 时断言精确字段集；伪造的 `schemaVersion: 2` 只在核对 v1 子集后接受（并把观测到的版本留作证据）；`undefined` / `null` / `0` / `"1"`（非整数）判 `HARNESS_ERROR`；空 store 返回 `[]` 且**完全不**对版本做断言。

## 4. AC-13 – AC-22 → 测试用例映射

| AC | 实现 | 用例（行号为当前实测值） |
|---|---|---|
| AC-13 | 通道名常量 `host-diagnostics.ts:23`；在 `activate()` 只创建一次（`extension.ts:424-425`）；揭示命令 `extension.ts:537-539`；测试专用读取器位于 `shouldRegisterTestHooks` 内（`extension.ts:1106-1107`） | `host-diagnostics.spec.ts:832` AC-13(a) 名字稳定 · `:838` AC-13(b)(c) 揭示但不追加 · `:856` AC-13(d) 门禁内存在且返回数组 · `:862` AC-13(d) 门禁关闭时不注册 |
| AC-14 | SDK 层：`TransportClosedDetails` + `transportDetails()`（`client.ts:39-50`、`:506`）。Host 层：`describeStartFailure`（`session-host.ts:134`）配合 stage 上下文。扩展兜底：无法归类的 `StartHostPort` 失败仍记为 `other` | `sdk-client.spec.ts:406` 结构化 spawn 失败细节（真实 `spawn` 一个不存在的绝对路径）· `session-host.spec.ts:234` AC-14（kind `spawn`、`resolvedExecutable`、`detail !== ''`、`source !== null`）· `session-host.spec.ts:267` AC-14 兜底（未归类 → `other`）· `host-diagnostics.spec.ts:921` 经扩展的 AC-14 兜底（记录 + 脱敏，横幅中无密文） |
| AC-15 | `initializeTimeoutMs` 对 `DEFAULT_INITIALIZE_TIMEOUT_MS` 解析并写入记录 | `session-host.spec.ts:285` —— fixture 永不应答 `initialize`；断言 `kind === 'handshake-timeout'` **且** `handshakeTimeoutMs === 300`（字段断言，不做文案匹配）· `host-diagnostics.spec.ts:680` 超时类按名字抵达快照 |
| AC-16 | `describeStartFailure` 的 `bridge-listen` 分支（`session-host.ts:175`）记录实际选定的 socket 路径 | `session-host.spec.ts:302` —— 用一个已存在的普通文件作为 socket 路径，让真实 `listen` 失败；断言 `kind === 'bridge-listen'`、`socketPath` 绝对、`detail` 非空 · `host-diagnostics.spec.ts:680` 类直通 |
| AC-17 | `stderrTail` 原文按序保留，受 SDK 既有 tail 上限约束 | `session-host.spec.ts:316` —— 打印 25 行唯一标记（`DSH-FAKE-STDERR-<n>`）后 `exit(1)`；断言长度 ≥ 20 **且**与原文第 6–25 行逐项相等、顺序一致（不摘要、不只留最后一行） |
| AC-18 | 从 `exit` 处理器捕获 `exitSignal`（`client.ts:290`），并在 `transportDetails()` 中与 `exitCode` 分开 | `sdk-client.spec.ts:424` 有退出码、`terminationSignal === null` · `:439` 有信号、`exitCode === null` · `session-host.spec.ts:345` 记录侧把两者分开 |
| AC-19 | `missing-credentials` kind + 调度者快照 + UI 设置入口 | `host-diagnostics.spec.ts:405` 只记录一次并带快照文案 · `:539` `phase === 'failed'`、缺凭据文案、`settingsDeepLinkAvailable === true`、文案 ≠ `正在连接到 Host…`、状态栏重试入口存在 · `:890` 经扩展的端到端 |
| AC-20 | 每个失败分类保留自己的终态文案；失败的 Host 绝不回落到连接中文案 | `session-host.spec.ts:375` 一条链上的不同边界保持可区分（`kind` + `retryOfSeq`）· `host-diagnostics.spec.ts:517` 没有任何根因留在进行中文案上（根因**取自 `kind`**，不从文案反推）· `:568` failed 永不会退回 `connecting` |
| AC-21 | 对每个字符串字段、JSON 形态与渲染块统一套 `redactSecrets`；凭据包在 spawn 前登记 | `host-diagnostics.spec.ts:261` 值不出现在 `records()` / `JSON.stringify(records)` / sink 文本 / 渲染块，且含 `[redacted:DSH_TEST_TOKEN]` · `:302` 对 `KEY` / `PASSWORD` / `SECRET` / `TOKEN` 命名的键、各种取值形态同样断言 · `:921` 端到端（通道 + 面板横幅） |
| AC-22 | 调度者侧监听开启/延伸失败链；`onStartSucceeded()` 收链；重试重入同一 `StartHostPort` | `host-diagnostics.spec.ts:326` 每次重试都与开启该链的记录配对（`phase: 'retry'`、`retryOfSeq`、`seq` 严格递增）· `:966` 重试重入同一启动路径、`hostCreateCount` 递增、链恢复为 `started` · `auto-start-orchestrator.spec.ts:205` 重试入口重入同一 port |

不依赖单个 AC 但本 Phase 必须交付的用例还有：契约用例（`host-diagnostics.spec.ts:114`，恰好 18 字段且形态符合声明）、无事实边界（`:147`，仍是完整非空形态）、版本三口径（`:209-245`）、有界 store（`:345`）、读取返回副本（`:358`）、时钟回拨下时间仍不减（`:366`）、`F-3.1` 显式 `invalid-setting` 分类（`:378`）、每个失败 kind 恰好映射一个调度者类（`:394`）、调度者侧监听忽略 Host 自有 kind（`:450`）、投影面（`:586-635`）、以及 `F-3.2`（`:1006`，非预检失败不带 `diagnostic` 负载）。

## 5. 门禁证据（与 Phase 基线对比）

基线由调度者在 21:03–21:04 取得；本轮首次产品改动是 21:48 的 `client.ts`、21:59 的 `host-diagnostics.ts`、22:22 的新 spec —— 因此前后对比确实成立。

| 门禁 | 基线 | 改动后 | 差量 |
|---|---|---|---|
| `pnpm run typecheck` | 绿 | **exit 0**（`/tmp/p2-after-typecheck.txt`） | 绿，无新错误 |
| `pnpm run test apps/vscode-dsh` | 4 文件 / 6 用例失败，351 通过（358） | **失败集合完全相同**，396 通过（403） | **零新增失败**；+1 spec 文件（`host-diagnostics.spec.ts`）、+45 通过用例 |
| `pnpm run test packages/sdk/client` | 3 文件、84 通过 | **3 文件、87 通过** | 全绿，+3 用例 |
| `client.ts` per-file 覆盖率 | （门禁） | **100%** —— 188/188 语句、113/113 分支、44/44 函数、161/161 行，exit 0（`/tmp/p2-after-coverage.txt`） | 门禁绿 |
| `pnpm run lint` | 890 个 `(rule,file)` 组合 | **890 个组合，集合与每组合出现次数均一致** | **零新增**（`/tmp/p2-after-lint.txt` vs `/tmp/p2-baseline-lint.txt`） |
| `pnpm run test:docs` | 1 失败 / 11 通过（`scripts/doc-standard.spec.ts`） | **1 失败 / 11 通过，同一用例** | 无新增失败 |

`apps/vscode-dsh` 的失败集合与基线逐条相同 —— 同样 4 个文件里的同样 6 条（`spike-t0a-replay-rebuild` ×4、`spike-t0b-continue-capability`、`panel-close-delete.e2e`、`verifier-phase1/layer-a-rtl`），根因是 `scripts/test-invariants.ts:188`，与本 Phase 无关。lint 对比精确到出现次数（不只是集合），因此某个文件在已有规则上多出若干条也会被发现。

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

覆盖率命令刻意收窄 `coverage.include`：仓库配置把 `packages/*/*/src/**/*.{ts,tsx}` 全量纳入插桩且 per-file 阈值 100%，若只过滤 spec 文件，每个未被触及的源文件都会被记 0%，把门禁淹掉。这条已写入 `project-test`，避免下一个 agent 重新踩。

## 6. DEBT-008 —— 已在本 Phase 解决

| 项 | 修前 | 修后 | 证据 |
|---|---|---|---|
| E-1 引用 | 两处 JSDoc 引 `(AD-10)`，但 `design.md:225` 的 AD-9 才是「提供 `dsh.nodeBin` 设置项 + 三级解析链」，`:243` 的 AD-10 是*文档落点*决策 | 两处均引 `(AD-9)` | `grep -rn 'AD-9\|AD-10' apps/vscode-dsh/src/` → 只命中 `extension.ts:233`（"Read this extension's settings (AD-9)"）与 `extension.ts:2245`（"Read the `dsh.nodeBin` Node executable setting (AD-9)"）；**零** `(AD-10)` 命中 |
| E-2 来源句 | 来源句（"Class of a failed `IdeSessionHost.start`" / "the vocabulary `IdeSessionHost.start` throws with"）未覆盖成员 `invalid-setting`（它实际由 `extension.ts` 的 `readNodeBinSetting` 在 `StartHostPort` 层抛出） | 两句均扩为覆盖 `StartHostPort` 层 | `session-host.ts:54` 与 `auto-start-orchestrator.ts:40` 均含 "or the `StartHostPort` wrapping it" |

只动了 JSDoc 措辞：类、成员、类型、行为一律未变，既有行为用例保持全绿。题面给的近似行号（`:224`、`:2173`）在 Phase 1 之后已漂移；实际位置以实测定位。registry 条目已从「活跃债务」移入「已解决」并附上述验证文本；活跃表现列 2 条（DEBT-004、DEBT-009），汇总说明也做了相应更正。

## 7. F-3 三条落地（Phase 1 第 3 轮审查转交）

| 项 | 落地方式 |
|---|---|
| F-3.1 —— `invalid-setting` 必须有显式分支 | `hostFailureKindForStartError`（`host-diagnostics.ts:227`）与 `startErrorKindForFailure`（`:213`）都显式点名它，不落兜底；由 `host-diagnostics.spec.ts:378` 与 `:394`（后者校验每个 kind 恰好映射一个调度者类）断言 |
| F-3.2 —— 读 `.diagnostic` 前先按 `kind` 收窄 | 既有不变式保住：`.diagnostic` 恰好当 `kind === 'node-environment'` 时存在。`session-host.ts` 中新增的路径遵守该约束，且 `host-diagnostics.spec.ts:1006` 断言非预检失败完全不带 `diagnostic` 负载 |
| F-3.3 —— `resolvedExecutable` 仅 `process-exec-path` 保证绝对 | `launch.ts:132-139` 对设置来源的 Node 路径原样返回，因此诊断中任何位置都不假设绝对性。字段文档写明该限制（`host-diagnostics.ts:70`），`session-host.spec.ts:234` 断言的是 Host 实际解析出的取值，而非重新拼绝对路径 |

## 8. 与 `spec.md` / `repo-exploration.md` 的刻意不一致处

以下每一条都是实现「有意不照字面做」的地方，或代码现状与调研报告冲突的地方。

**8.1 `apps/vscode-dsh/src/connection-ui.ts` 无需改动** —— spec 的文件清单把 AC-19/AC-20 的 UI 投影划给该文件。实测该投影**已存在且已满足 AC**：`errorKind === 'missing-credentials'` 驱动 `settingsDeepLinkAvailable`（`connection-ui.ts:140`）、`phase = 'failed'` 是既有终态（`:128-129`）、文案回落 Host 自己的 `errorMessage`（`:152-154`）、状态栏恒带 `command = 'dsh.statusBarAction'`（`:81`、`:188`）。改它等于空转重写，因此本 Phase 改为补上缺失的**证据**：`host-diagnostics.spec.ts:517`、`:539`、`:568` 驱动真实的 `ConnectionUiController`（VS Code 侧用 shim，而非桩掉控制器本身）。影响范围：仅 `spec.md` §primary_files；AC-19/AC-20 的行为无任何偏离。

**8.2 `packages/sdk/client/src/index.ts` 进入变更集** —— 它导出 `TransportClosedDetails`（AC-14 的 SDK 层要能被消费方使用）与 `DEFAULT_INITIALIZE_TIMEOUT_MS`（让 AC-15 的 `handshakeTimeoutMs === 300` 断言绑在产品默认值上，而不是把字面量抄进 Host）。影响范围：`spec.md` §primary_files 的增益项。

**8.3 测试 fixture 增补旋钮** —— `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` 与 `packages/sdk/client/tests/fake-runtime.ts`。AC-15/17/18 要求真实进程行为（永不应答 `initialize`、长 stderr 尾、指定退出码、自我发信号），fixture 是唯一能表达它的地方。没有为可测性改造产品代码，也没有新增依赖。影响范围：超出 spec 文件清单，但仅限测试面。

**8.4 `interaction-coordinator.ts` 的改动比「补两个投影字段」略多** —— approval 分支被抽成私有 `projectEntry`（`:195-227`），而不是内联三元链。两个新字段是功能部分；抽取是为了投影可读并满足仓库的缩进规则。公开面未变（返回形态相同，`reason` 缺失时依旧省略）。

**8.5 重试记录由调度者侧监听产生，而不是 UI** —— AC-22(b) 要的是重试「前 / 后」成对记录，靠 `retryOfSeq` 关联。机制是 `createStartFailureListener`（`host-diagnostics.ts:257`）加 store 的链记账：Host 归类它能归类的，扩展记录调度者投影出来的，并做去重，避免一次失败记成两条。`dsh.test.answerApproval` 与 `InteractionCoordinator.resolveApproval` **未**新增 —— 它们属于 Phase 3（AD-12）。

**8.6 AC-14 两层取证都用了真实 spawn** —— SDK 层失败由 `createProcessHarnessClient({ command: '<不存在的绝对路径>' })` 产生，即真实 `child_process.spawn` 失败，并断言 `TransportClosedError.details.spawnError` / `.executable`；Host 层则由同一生产错误类型驱动 `IdeSessionHost`。两层都没有 mock 掉 spawn。

**8.7 扩展层对未归类失败的兜底** —— spec 要求 AC-14 的兜底完整：`IdeSessionHost.start()` 期间任何抛错都必须产出记录。`IdeSessionHost` 覆盖它自己的边界；对于在它外面 `StartHostPort` 层抛出的失败（入口解析、`new HarnessClient()`），`createStartHostPort` 在尝试前取 `diagnostics.lastSeq()`，并在 `catch` 中仅当**同时**满足两个条件时记一条通用 `other`：错误不是 `HostStartError`（该类型由 Host 边界记录，或由调度者侧监听为 `missing-credentials` / `invalid-setting` 记录），且 `lastSeq()` 未变化（Host 什么都没记）。这层去重正是让一次尝试不会被报成两条记录的原因（AD-3、AC-22）。分类始终是结构化的 —— `extension.ts` 从不匹配错误消息文本。

**8.8 `.cursor/skills/*` 的更新不属于 Phase 产物** —— 本 agent 的契约要求在构建/测试成功后更新 `project-build` / `project-test`，两者都已更新。它们位于工具树，而用户已裁定该树不随本 Phase 入库（DEBT-009），所以 `git status` 会显示它们，但 §2 的 Phase 产品变更集不含它们。另有一件值得调度者注意的发现：工作区的 `project-build/SKILL.md` 曾在 20:57（Phase 1 窗口之后）被重置为一句话骨架，丢掉了 `HEAD` 仍保留的 56 行。本 agent 用 `git show HEAD:` **回补**了这些条目并逐条标注状态（`❌ 未验证（回补）`；两条现已不成立的断言标 `⚠️ 已过期` 并写明原因 —— 「宿主 git 2.25.1 需要 pnpm 绕行」与「Node v20.16.0」作为环境事实），**没有**为任何无法复核的内容编造替代值，并在该 skill 中留了显式警告而不是静默留白。是否为此登记债务条目交由调度者决定 —— 毕竟它涉及的正是已被裁定出范围的工具树。

## 9. 反桩与完成前自检

| 检查项 | 结果 |
|---|---|
| 空壳 / no-op | 无 —— 在 `apps/vscode-dsh/src`、`apps/vscode-dsh/tests`、`packages/sdk/client/src`、`packages/sdk/client/tests` 上 `grep -rn '@STUB'` 无命中 |
| 欺骗性注释 | 无 —— 被改动的产品文件中没有 `TODO` / `FIXME` / "will be wired" / "placeholder" |
| `tech-debt-registry.md` | 无需新增活跃条目：本 Phase 未引入桩，而它承接的唯一一条（DEBT-008）已解决并移入已关闭表 |
| store → 读取方连通性 | 记录器的 `records()` 被 `dsh.test.getDiagnosticsText`（`extension.ts:1107`）与 `createStartFailureListener` 的去重检查读取；sink 被 Output Channel 读取（`extension.ts:432`）；两者都有端到端用例（`host-diagnostics.spec.ts:856` 经注册命令的读取、`:966` 经 sink 的重试链） |
| 调用方 → 被调方连通性 | `IdeSessionHost` 依赖 `HostFailureRecorder` 端口而非 VS Code；扩展提供真实记录器。端到端追踪：`start()` → `describeStartFailure` → `record` → sink → 通道，外加 `onChange` → 监听 → `record` → 重试链 |
| 功能关掉时测试会红吗 | 会：版本用例读取 `HOST_DIAGNOSTIC_SCHEMA_VERSION`（改常量即红）、AC-17 用例在尾行被摘要或截断时失败、AC-18 用例在信号与退出码不分开时失败、AC-22 用例在重试记录不配对时失败 |
| 越界禁令 | `resolveApproval` / `answerApproval` 不存在；`packages/core/agent-loop` 未动；`package.json` 差异仅命令（无依赖、无新配置键）；未新增 `StartOrchestratorState` / `ConnectionUiPhase` 成员；测试名与注释中无审查条目码；无 sidecar / `workflow-context.md` 文件 |

## 10. 本 Phase 未触碰的文件

`apps/vscode-dsh/src/connection-ui.ts`、`apps/vscode-dsh/src/node-env-guard.ts`、`apps/vscode-dsh/src/redact.ts`、`packages/sdk/client/src/launch.ts`、`packages/core/agent-loop/**`、`design.md`、`requirements.md`、`phase-plan.md`、`spec.md`、`repo-exploration.md` 以及 `current-status.json`（状态推进属调度者职责）。除查看外未执行任何 git 命令：没有 add、commit、branch 或 stash，因此整套改动仍在工作区，等调度者在 HG-3 统一提交。
