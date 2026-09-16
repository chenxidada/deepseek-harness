# 连通性审查 — Phase 2

工作流：`vscode-dsh-usable-loop` · Phase：`phase-2-host-fail-loud-diagnostics` · 分支：`impl-phase-2-host-fail-loud-diagnostics`
审查范围：`spec.md` 的 AC-13 – AC-22、`design.md` 的 AD-1 – AD-14、`repo-exploration.md` §4 的调用链，以及 `spec.md` §产出清单 列出的全部文件。
证据形态：**逐函数读函数体 + 逐行定位 + 本仓测试套件实跑**（`pnpm run typecheck` 与 Phase 2 相关 spec，本轮已复跑）。

## 视角

**集成连通性（Integration Connectivity）** —— 这些部件真的连起来了吗？端到端数据路径、上下游集成、跨模块接线。不评价代码风格（`reviewer-design`）、不评价行为正确性（`reviewer-correctness`）、不评价界面外观（`reviewer-visual`）。

## 判决：MUST-FIX

本 Phase 的 21 条接线中有 20 条真实连通：记录的产生 → 有界 store → sink → Output Channel 整条链是真实调用；`dsh.test.getDiagnosticsText` 注册在门禁 `if` 块**内部**、返回 store 自身的数组（同一实例、无副本）；`dsh.showHostDiagnostics` 与 `package.json` 逐字符一致且真的调了 `channel.show()`；SDK 结构化细节沿 `client.ts → index.ts → session-host.ts` 穿透且类型链无断点；AD-13 投影两端都有真实赋值与真实读取。**有一条边是断的**：对编排器自有的两类失败，「重试 → 追加记录」这条边失效 —— 监听器的去重 guard 作用域是**整条失败链**而非**单次尝试**，因此「同一失败态下再次失败」不产生任何记录，而这恰恰是 AC-19 强制的失败态、也是 AC-22(c) 要求提供可点击重试入口的状态。结果是 AC-22 的第三句强制要求在 `missing-credentials` 与 `invalid-setting` 两类失败下不可达，且现有用例覆盖不到它（AC-22 的用例用的是 Host 自有类，绕过了该 guard）。

## 端到端路径追踪

### Path 1: Host 边界失败 → 记录 → 有界落库 → Output Channel → 用户可见（AC-13 / AC-14 / AC-15 / AC-16 / AC-18）

```
Entry: IdeSessionHost.start() 在六个边界之一失败
  → session-host.ts:411/413/420/430/433   stage 变量标记当前边界                   ✅ 已设置
  → session-host.ts:445   describeStartFailure(error, {…, stage, socketPath,
                          exitCode, terminationSignal, stderrTail})               ✅ 参数已传入
      ├─ Node 前置拒绝（NodeEnvironmentError.failure）→ 'node-environment'         ✅
      ├─ bridge.listen 拒绝（stage === 'bridge-listen'）→ 'bridge-listen'          ✅
      ├─ TransportClosedError.details.spawnError 存在 → 'spawn'                    ✅
      ├─ TransportClosedError.details.exitCode/信号   → 'child-exited'             ✅
      └─ 无边界可命名                                 → 'other'                    ✅
  → session-host.ts:451   this.diagnostics?.record(failure)                        ✅ 唯一入口
  → session-host.ts:454/459   throw HostStartError(…, diagnostic?) ← 同一 failure  ✅
  ── 记录侧 ──
  → host-diagnostics.ts:329-358   record()：逐字段脱敏 + 18 字段装配                ✅
  → host-diagnostics.ts:351-354   chainStartSeq ??= seq；超 200 条 splice          ✅ 有界
  → host-diagnostics.ts:356       this.sink?.present(record)                       ✅ sink 被调用
  → extension.ts:429-435          sink.present = channel.appendLine(format(record)) ✅ 同一 recorder
  → extension.ts:424-426          createOutputChannel('DeepSeek Harness')          ✅ 先于 recorder 创建
Exit: 通道 'DeepSeek Harness' 中追加一行（formatHostDiagnosticRecord 产出）         ✅
```

**判定**：✅ 完整连通。四段都是真实调用，不存在「函数存在但无人订阅」。`extension.ts:437-443` 在同一个 `dispose` 中同时清理 channel 与 recorder，不存在 sink 向已释放 channel 写入的窗口。

### Path 2: SDK 结构化细节 → Host 分类 → 记录字段（AC-14 / AC-16）

```
Entry: 真实 spawn 失败 / 子进程退出（packages/sdk/client）
  → client.ts:290        child.once('exit', (code, signal) => this.exitSignal = signal) ✅ 信号被捕获
  → client.ts:496-503    closedError(reason) → new TransportClosedError(msg, details)   ✅ 生产侧填充
  → client.ts:506-512    transportDetails() → { executable, exitCode, terminationSignal,
                                                stderrTail, spawnError }                 ✅ 逐字段
  → src/index.ts:18      export { TransportClosedError }                                ✅ 运行期值
  → src/index.ts:20      export type { …, TransportClosedDetails }                      ✅ 类型可命名
  → session-host.ts:134  describeStartFailure 读取 error.details.{…}                    ✅ 消费侧读取
  → record.{resolvedExecutable, exitCode, terminationSignal, stderrTail, socketPath}    ✅ 落到 18 字段
Exit: 记录数组中的结构化字段（Phase 3 驱动逐字段断言）                                   ✅
```

**判定**：✅ 无断点。类型与运行期值分两行导出（`index.ts:20` / `index.ts:18`）；`apps/vscode-dsh` 走包入口（非深路径）消费，`pnpm run typecheck` exit 0 证明该属性类型跨包可解析；`NodeJS.Signals → string | null` 的赋值在编译期成立。

### Path 3: 编排器侧前期失败 → 监听器 → 记录（AC-19 / F-3.1）

```
Entry A（首启，缺凭据）:
  触发启动 → auto-start-orchestrator.ts:214   !port.hasCredentials()
  → :215-218   throw Error('missing credentials', { kind: 'missing-credentials' })  ✅
  → :232-234   state='failed', errorKind='missing-credentials',
               errorMessage='missing credentials'（throw 的字面量，恒定）
  → :241 notify() → extension.ts:452 recordOrchestratorFailure(snap)                ✅ 已订阅
  → host-diagnostics.ts:266-267   hostFailureKindForStartError → 'missing-credentials' ✅ 非 null
  → :272   recorder.record({ kind, detail })                                        ✅
Exit A: 1 条记录（phase 'start'）                                                   ✅ 连通

Entry B（重试，凭据仍缺失 —— 同一失败态）:
  → auto-start-orchestrator.ts:207   state='starting'
  → :210 notify() → host-diagnostics.ts:262-265   非 failed → return，**不清 guard**   ⚠️
  → :220 跳过（port.start 未进入）→ :232-234  与 Entry A 逐字符相同的 kind + message
  → :241 / :249  两次 notify
  → host-diagnostics.ts:269-270   signature === recorded → return                    🔴 无记录
Exit B: **0 条记录** —— 该次重试在诊断通道完全不可见                                🔴 断裂
```

**判定**：🔴 MUST-FIX —— 见发现 C-1。首启连通，重试断裂。

### Path 4: 重试入口 → 同一启动路径 → 记录成对增加（AC-22）

```
Entry: 失败态下点击重试入口
  → 面板路径：extension.ts requestRetryConnect → orchestrator.request(…)
  → 状态栏路径：extension.ts:537 'dsh.statusBarAction' → 同一 orchestrator.request(…)  ✅ 同一入口
  → auto-start-orchestrator.ts:205  runStart(reason) —— 唯一启动实现，无平行路径        ✅ 路径复用
  → :220  await this.port.start(reason)
  → extension.ts:2310  new IdeSessionHost(diagnostics)  ← **同一个 recorder 实例**      ✅
  → extension.ts:2311  hostCreateCount += 1                                             ✅（:382 处重置）
  → 失败时由新 Host 自己的 session-host.ts:451 写入记录                                 ✅
Exit（Host 可达类，如 node-environment / spawn）:
     通道追加 1 行；数组新增 1 条 phase='retry'、retryOfSeq=首启 seq                    ✅
     （host-diagnostics.spec.ts:966 实测记录 1→2 条、hostCreateCount 1→2）
Exit（编排器自有类，如 missing-credentials / invalid-setting）:
     数组新增 0 条                                                                      🔴
```

**判定**：路径复用与 `hostCreateCount` ✅；**记录成对增加仅对 Host 可达的失败类成立**。`extension.ts:2357-2362` 的兜底注释假定「Host 会记录自己的边界，或 orchestrator 会记录（missing-credentials / invalid-setting）」—— 但重试时 orchestrator 侧被 guard 抑制，Host 侧根本没被进入（`:214` 在 `:220` 之前抛错），该次尝试**两面都无人记录**。见 C-1。

### Path 5: 诊断读取面（AC-13 / AD-14 钩子契约）

```
Entry: 扩展命令面
  ├─ package.json:143  { "command": "dsh.showHostDiagnostics", "title": … }             ✅ 已贡献
  ├─ extension.ts:537  registerCommand('dsh.showHostDiagnostics') ← 逐字符一致            ✅
  │    → :538  hostDiagnosticsChannel?.show()                                           ✅ 真的调 show()
  │    → 通道名 = HOST_DIAGNOSTICS_CHANNEL_NAME = 'DeepSeek Harness'（单一来源常量）      ✅ 稳定
  └─ extension.ts:1105-1108  registerCommand('dsh.test.getDiagnosticsText')
       └─ 该 register 调用位于 shouldRegisterTestHooks 的 if 块**内部**                  ✅ 门禁内
            → () => hostDiagnostics?.records() ?? []                                     ✅ 数组，非 null
            → hostDiagnostics 即交给 createStartHostPort 的那一实例
              （:436 → :445 → :2310 → :1107）                                            ✅ 无副本
Exit: 结构化 HostDiagnosticRecord[]                                                      ✅
```

**判定**：✅ 完整连通。`contributes.commands` 共 21 条、unique 21。门禁关闭时该命令**未被注册**（不是「注册了但返回空」）—— 契约成立。

### Path 6: 审批交互投影（AD-13）

```
Entry: bridge frame kind === 'approval/request'
  → session-host.ts:839-840    this.interactions.handleApproval(frame) ← frame 携带 toolName/reason ✅
  → interaction-coordinator.ts:265-277   ApprovalEntry{ toolName: frame.toolName,
                                           …reason === undefined ? {} : { reason } }    ✅ 真的赋值
  → :197-200  listPending() → :208-228 projectEntry(entry)
       ├─ :225  toolName: entry.toolName                                                ✅ 投影取值
       └─ :227  …reason 条件展开                                                         ✅
  ├─ 消费方 A（Phase 1 UI 路径）：:434-440 HostApprovalRequest{ toolName, …reason }
  │    → interaction-ui.ts:75                                                           ✅
  └─ 消费方 B（读取面）：extension.ts:1098 () => host?.interactions.listPending()        ✅
Exit: 投影数组（Phase 3 驱动断言）                                                       ✅
```

**判定**：✅ 无「加进类型但从未赋值」的断点。上游 frame → 队列条目 → 投影三段都有真实赋值与真实读取。

## 上下游连接检查

| 新组件 / 新字段 | 上游（谁调用 / 谁赋值） | 状态 | 下游（谁消费） | 状态 |
|---|---|:--:|---|:--:|
| `HostDiagnosticRecorder`（store + sink） | `extension.ts:429`（唯一实例化处） | ✅ | `extension.ts:432` sink → Output Channel | ✅ |
| `HostFailureRecorder` 接口 | `session-host.ts:451` `diagnostics?.record()` | ✅ | 上一行 | ✅ |
| `describeStartFailure()` | `session-host.ts:445` catch 块 | ✅ | `:451` record + `:454/:459` throw | ✅ |
| `startErrorKindForFailure()` | `session-host.ts:459` | ✅ | `auto-start-orchestrator.ts:64-66` 白名单校验 | ✅ |
| `hostFailureKindForStartError()` | `host-diagnostics.ts:266` 监听器 | ✅ | `:272` record | ✅ |
| `createStartFailureListener()` | `extension.ts:448` 构造 | ✅ | `extension.ts:452` 每次 onChange | ✅ |
| `dsh.showHostDiagnostics` | `package.json:143` | ✅ | `extension.ts:537` 逐字符一致 | ✅ |
| `dsh.test.getDiagnosticsText` | `extension.ts:1105`（门禁内） | ✅ | `hostDiagnostics.records()` 同实例 | ✅ |
| `TransportClosedDetails` | `client.ts:506-512` 生产 | ✅ | `session-host.ts:134` 消费 | ✅ |
| `PendingHostInteraction.toolName/reason` | `interaction-coordinator.ts:273/276` | ✅ | `:225/:227` → `:437-438` / `:1098` | ✅ |
| `HostDiagnosticRecorder.setSink()` | **全仓无调用方** | ⚠️ | — | ❌ 未接线 |
| `HOST_DIAGNOSTIC_RECORD_LIMIT` | `host-diagnostics.ts:353` | ✅ | `host-diagnostics.spec.ts` | ✅ |
| `invalid-setting` 显式分支（F-3.1） | `extension.ts:2256-2261` 抛出；`:2334` 调用 | ✅ | orchestrator `:233` → 监听器 → record | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|---|---|---|:--:|
| `extension.ts` → `HostDiagnosticRecorder` | `records(): readonly HostDiagnosticRecord[]` | `:364-366` 返回内部 store 只读视图 | ✅ |
| `extension.ts` → `dsh.test.getDiagnosticsText` | `Array.isArray(records) === true` | `:1107` `records() ?? []` | ✅ |
| `session-host.ts` → `HostFailureRecorder` | `record(input: HostDiagnosticInput)` | `:329` 接受 18 字段的子集输入 | ✅ |
| `IdeSessionHost.start` → `AutoStartOrchestrator` | 抛错携带 `.kind ∈ HostStartErrorKind` | `HostStartError` 设 `kind`（`session-host.ts:454/459`） | ✅ |
| `AutoStartOrchestrator.port` → `StartHostPort.start` | `StartErrorKind` 白名单 | 已扩到含 bridge-listen/spawn/handshake-timeout（`:28-36`） | ✅ |
| `ConnectionUiController` ← orchestrator snapshot | `errorKind` 驱动终态文案 | `:136` 条件展开 errorKind；`connection-ui.ts` 投影 | ✅ |
| **`resolvedExecutable` 的「绝对路径」契约** | 类型 doc + Phase 3 spec 断言绝对（`host-diagnostics.ts:71`、`spec.md:57`） | `launch.ts:133-138` 对设置来源**原样返回**；仅 `process-exec-path`（`:140-144`）天然绝对；本链在 `apps/vscode-dsh/src` 与 `packages/sdk/client/src` 内无 `isAbsolute` 校验 | ⚠️ 见 O-1 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 | 接口状态 | 连接状态 |
|---|:--:|:--:|:--:|
| `IdeSessionHost.start` / `HostStartError.diagnostic`（F-3.2 不变式） | Phase 1 | 签名未改，仅扩 JSDoc | ✅ 新增代码未新增无条件 `.diagnostic` 读取 |
| `AutoStartOrchestrator` / `StartHostPort` | Phase 1 | **扩枚举**（3 个新 `StartErrorKind`），纯增量 | ✅ 既有成员语义未变 |
| `ConnectionUiController.getState()` | Phase 1 | 未改 | ✅ |
| `interactions.listPending()` | Phase 1 | **扩返回形状**（`toolName` 必填、`reason` 可选） | ✅ 既有消费方不读新字段 |
| `packages/sdk/client` 公共导出 | Phase 1 | **新增导出**（`TransportClosedDetails` / `DEFAULT_INITIALIZE_TIMEOUT_MS`），未删改 | ✅ |
| Host 诊断链 与 IDE bridge socket | Phase 1 | 两条 socket 路径不同名，无交叉读写 | ✅ |

## 关键发现

### 🔴 Must-Fix

**C-1 — 编排器自有失败类的「重试 → 追加记录」这条边是断的（这些状态下 AC-22 第三句不可达）**

- 位置：`apps/vscode-dsh/src/host-diagnostics.ts:257-274` —— `:260` guard 声明、`:263` 其**唯一**清除点、`:269-271` 抑制点名。
- 上游：`apps/vscode-dsh/src/auto-start-orchestrator.ts:207-210`（重试把状态置 `'starting'` 并 notify）、`:214-219`（缺凭据在 **`port.start` 之前** 抛错）、`:232-234`（`errorKind` / `errorMessage` 恒定）。
- 下游：`apps/vscode-dsh/src/extension.ts:448-453`（监听器订阅）、`:2357-2362`（假定 orchestrator 已记录的那段兜底注释）。

`recorded` 去重 guard **只在快照到达 `state === 'started'` 时清除**（`:263`；其余所有非 `failed` 状态直接 return，且不清除）。而 `missing-credentials` 与 `invalid-setting` **永远到不了 `started`**，因此：

1. 第 1 次尝试 → 记录 1 条（`phase: 'start'`）✅
2. 用户点重试（状态栏 `dsh.statusBarAction` 或面板入口）→ `:214` 仍无凭据 → 抛同一条 `Error('missing credentials')` → kind 与 message **逐字符相同** → `:270` 命中 guard → **0 条记录**
3. 第 3、4、N 次重试同理 → 无论尝试多少次，通道里始终只有 1 条记录，也不会出现 `phase === 'retry'` + `retryOfSeq` 的配对记录

为什么不是「设计如此」：`spec.md:34` 把 AC-22 定为 `[Must]`，明文要求触发入口后**必须 在重试的前后向诊断通道追加记录**；`spec.md:31`（AC-19）恰恰把 `missing-credentials` 定义为失败态，且该状态必须提供可点击重试入口（`spec.md:56` AC-22(c) 断言 `statusBar.command === 'dsh.statusBarAction'`，本 Phase 的 `host-diagnostics.spec.ts:917-918` 也这样断言）。换言之，**spec 强制的重试入口，正是在这条记录边已死的状态里提供的**。`auto-start-orchestrator.ts:242-246` 的排队重试递归形状相同（`runStart(next)` 会再置一次 `'starting'` 却不清 guard），排队重试同样不留记录。

`extension.ts:2357-2362` 的兜底（`!(error instanceof HostStartError) && lastSeq() === seqBeforeStart` → 写 `kind: 'other'`）兜不住：`missing-credentials` 在 `:214` 抛出，`port.start`（`:2290-2375`）根本没被进入，该 catch 不会执行。

影响面：`missing-credentials` 与 `invalid-setting` 两类失败的**全部重试**（含 AC-22(c) 要求在 AC-19 终态下提供的那个重试）。`node-environment` / `spawn` / `bridge-listen` / `handshake-timeout` / `child-exited` 走 Host 自己的 `record()`，**不受影响** —— 这正是现有测试漏掉它的原因：`host-diagnostics.spec.ts:966`（AC-22）驱动的是 `node-environment`，`review-correctness.md` 的 AC-22(b) 证据（`host-diagnostics.spec.ts:984-1003`）驱动的是同一个 Host 自有类。

消除该断边的最小改动（此处仅记录，不作为设计选择代为决定）：把 guard 的生命周期收窄到单次尝试 —— 例如在 `:262` 的非 `failed` 分支里对 `'starting'` 也清 `recorded`。`runStart` 每次尝试必先置 `'starting'` 并 notify（`:207/:210`），同一尝试内 `:241` 与 `:249` 的两次 notify 都发生在最后一次 `'starting'` **之后**，故尝试内去重仍成立，成功路径的清 guard 语义不变。

> 证据说明：本条为**代码追踪**结论，并有本仓对 guard 生命周期语义的既有断言佐证 —— `host-diagnostics.spec.ts:405-477` 显式断言「只有 `'started'` 清除 guard」，且从未覆盖「同一失败态下再次失败」。我本拟用一次性探针实跑该序列，但执行环境拦截了未受检脚本，故**未取得运行期证据**；上述每条语句均为直接阅读所引行号所得。建议 implementer 修完后补一条扩展级用例（缺凭据态 → 触发重试 → 断言记录 1→2 条且第二条 `phase === 'retry'`）。

### 🟡 Should-Fix

**C-2 — 「子进程退出」边界只有握手前的入口接了记录，连接后退出无记录且该取舍未落文档**

- `session-host.ts:445-451` 是记录的唯一插入点（仅在 `start()` 期间）。
- 连接建立后子进程死亡走另一条链：`client.ts:445` → Host 的 `onTransportDeath` 边 → `extension.ts:2321-2325` `orchestrator.onUnexpectedDisconnect()`，该链**不经 `diagnostics.record`**（`repo-exploration.md` §7.2 已预见此点）。
- `spec.md:30`（AC-18）的措辞是「**当** 子进程退出 **时**」，未限定握手前后；`spec.md:52` 给的可验收读法（`process.exit(7)` / `SIGTERM` + `FAKE_PENDING_INIT`）落在握手前路径，已被 `session-host.spec.ts:345-375` 覆盖且通过 ✅。
- 为何不升为 MUST-FIX：可验收读法已满足。但 `implementation.md` **未见**对该取舍的记录（检索 `onTransportDeath` / post-connect 零命中），而连接后的崩溃在通道里确实不可见。建议把该取舍作为偏差写入 `implementation.md`，或补第二插入点。

**C-3 — 排队重试路径不在 AC-22 的验证面内**

- `auto-start-orchestrator.ts:240-247`：启动失败且仍有排队原因时，orchestrator 直接 `await this.runStart(next)`。
- 在 C-1 未修时该路径同样不留记录（`'starting'` 不清 guard）；修完 C-1 后自然一并解决。
- 现有覆盖只针对「用户显式触发重试」（`auto-start-orchestrator.spec.ts:205`、`host-diagnostics.spec.ts:966`），从未覆盖「排队原因驱动的自动重试」—— AC-22 验证面的一处空隙。

### 🟢 Observations

**O-1 — `resolvedExecutable` 的「绝对路径」是文档契约而非程序化保证（无 Phase 2 内消费方受损）**

- 生产侧：`packages/sdk/client/src/launch.ts:131-145` 对 `DSH_NODE_BIN`（`:133-134`）与 `dsh.nodeBin`（`:136-138`）来源**原样返回**；只有 `process-exec-path`（`:140-144`）天然绝对。本链在 `apps/vscode-dsh/src` 与 `packages/sdk/client/src` 内无 `isAbsolute` 校验（该两处的 `isAbsolute` 命中全部属于 `code-context` / `change`）。
- 消费侧：字段 doc 声明绝对（`host-diagnostics.ts:71-72`）；冻结的 Phase 3 spec 将断言「`node-environment` 记录的 `resolvedExecutable` 为绝对路径」（`spec.md:57`）。
- 该契约在**用户可见层面**有声明：`apps/vscode-dsh/package.json:64`（`dsh.nodeBin` 的 description）明写 "Absolute path to the Node.js executable…"。因此不构成断链，只是提示：文档是唯一保证，相对值会产出一条违反自身 doc 的记录。Phase 2 内消费方（`formatHostDiagnosticRecord`、各 spec 用例）均不因绝对性成立与否而改变判定。
- 附带：`implementation.md` 的 F-3.3 落点称「记录字段 doc 写明了该限制」，但 `host-diagnostics.ts:71` / `:105` 只声明「绝对路径」、未写限制 —— 文档还原度有偏差（归 `reviewer-design` 判断，此处仅记录该连通性相关的事实差异）。

**O-2 — `HostDiagnosticRecorder.setSink()` 无任何调用方**

- `host-diagnostics.ts:312-314` 定义了 setter；全仓（`src` + `tests`）检索仅命中定义本身。sink 实际经构造函数注入（`:294-296`）。属「为将来预留」的公共面，当前无消费者；功能无影响。

**O-3 — 无 `createOutputChannel` 的环境下记录可见性下降（防御分支，真实 VS Code 不可达）**

- `extension.ts:424-426` 在 `createOutputChannel` 非函数时把 channel 置 `undefined`，`:432` 的可选调用静默跳过，但 store 仍照常累积。
- 真实 VS Code 的 `window.createOutputChannel` 恒存在，故该分支只在鸭子类型宿主生效；AC-13(a) 的断言也用了提供该 API 的 double。不影响门禁；仅记录：此环境下记录只能经 `dsh.test.getDiagnosticsText` 读出。

**O-4 — `apps/vscode-dsh/src/index.ts` 未再导出新的诊断模块**

- 新契约（`HostDiagnosticRecord` / `HostFailureKind` / `formatHostDiagnosticRecord` 等）只能经深层路径 `./host-diagnostics.ts` 取得，包入口未挂。
- 无当前消费者需要（扩展内部消费；Phase 3 驱动走命令面而非类型导入），故不构成断链；若后续 Phase 需类型级复用，需补导出。

## 已执行的验证动作

| 动作 | 命令 / 位置 | 结果 |
|---|---|---|
| 编译级连通性 | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run typecheck` | ✅ exit 0，无跨包类型断点 |
| 命令 ID 一致性 | `node -e` 读 `package.json` + `rg` 定位 `registerCommand` | ✅ 21 条命令、unique 21；`dsh.showHostDiagnostics` / `dsh.test.getDiagnosticsText` 逐字符一致 |
| 存储实例同一性 | 追踪 `extension.ts:436 → :445 → :2310 → :1107` | ✅ 单一实例，无副本 |
| 门禁注册位置 | 读 `extension.ts:1105` 所在 `if` 块边界 | ✅ 位于 `shouldRegisterTestHooks` 内 |
| 映射双向覆盖 | `host-diagnostics.ts:213-241` + `auto-start-orchestrator.ts:28-36/60-68` | ✅ 双向齐备（8 项）；`invalid-setting` 有显式分支（`extension.ts:2256-2261`） |
| F-3.2 不变式 | 检索新增代码中的 `.diagnostic` 读取 | ✅ 新增业务代码零命中；新增读取仅出现在断言 `undefined` 的用例处 |
| 死代码 / 未接线 | 检索各新增导出的消费方 | ⚠️ `setSink` 无消费者（O-2） |

## 范围声明

本报告只覆盖**连通性**，且不超出 `spec.md`（AC-13 – AC-22）与 `design.md`（AD-1 – AD-14）定义的 Phase 2 范围。行为正确性（脱敏完备性、逐字段装配）归 `reviewer-correctness`；设计选择的合理性归 `reviewer-design`；界面外观归 `reviewer-visual`。
