# 连通性审查 — Phase 2（`phase-2-host-fail-loud-diagnostics`）

> 本文件是 [`review-connectivity.md`](./review-connectivity.md) 的中文译版；两者如有出入，以英文版为准。

## 视角

**集成连通性** — 这些部件真的连起来了吗？本报告只追踪端到端数据路径、上下游连接与跨模块契约。不评判实现正确性
（`reviewer-correctness`）、设计取舍（`reviewer-design`）或外观（`reviewer-visual`）。

范围：`spec.md` 的 AC-13 – AC-22、`repo-exploration.md` 列举的失败边界（§「Key Entry Points / Call Paths」、
§7.2、§8.1），以及 `design.md` 的 AD-3 / AD-4 / AD-5 / AD-13 / AD-14。
轮次：**第 2 轮**（回炉后重审）。第 1 轮合并报告见 `.archive/review-20260915T163307Z.md`；我第 1 轮的两份报告见
`.archive/review-connectivity-20260915T160437Z.md` 与 `.archive/review-connectivity-20260915T163355Z.md`。

## 判决：SHOULD-FIX

本 Phase 新增的每一条端到端数据路径现在都真正连通了，包括第 1 轮断裂的那一条。重试 →「追加一条记录」这条边对两个
编排器自有的失败类别重新接通：去重 guard 现在在**任何**离开 `failed` 的转移上重新武装
（`host-diagnostics.ts:283-286`），而每次尝试在能失败之前都必先经过 `starting`
（`auto-start-orchestrator.ts:207-210`），因此重复的 `missing-credentials` 拒绝会让 store 从 1 增到 2，第二条带
`phase: 'retry'` 且 `retryOfSeq` 指向首条 —— 这是**跑出来的**结论而非读台账得出的（扩展级用例驱动真实的
`dsh.statusBarAction` 命令并断言这一对记录）。同一次尝试内的去重语义在这次修改后依然成立；排队重试的递归现在也能
产记录；收窄记录词表后留下的 `invalid-setting` 缺口由扩展 fallback 仅凭高水位信号补上，恰好产出**一条** `other`。
生产者 → 有界 store → sink → Output Channel 仍是同一 recorder 实例上的单链，读出口在测试门禁内注册且读同一实例，
SDK 的结构化退出事实跨包边界无导出断点，AD-13 投影两端都有来自已校验线上数据的真实赋值与真实读取。

剩下的是清理而非断裂：新类上仍有一个公开接缝全仓无调用方，且承载「已裁定」的握手后缺口的债务条目指向了错误的
文件/函数，无法把后来者带到真正缺失的那条边上。

---

## 端到端路径追踪

### 路径 1 — Host 分类的启动失败 → 记录 → store → sink → Output Channel → reveal（✅ 连通，回归复核）

```
入口: IdeSessionHost.start() 抛出                              session-host.ts:441  (catch)
  → describeStartFailure(error, {stage, timeoutMs, socketPath, nodeExecutable})
                                                                  session-host.ts:445  ✅ 已分类
      ├─ NodeEnvironmentError.failure                             session-host.ts:139-151 ✅ → 'node-environment'
      ├─ TransportClosedError + spawnError                        session-host.ts:152-157 ✅ → 'spawn'
      ├─ TransportClosedError 无 spawnError                       session-host.ts:157     ✅ → 'child-exited'
      ├─ RequestTimeoutError                                      session-host.ts:166-173 ✅ → 'handshake-timeout'
      ├─ stage === 'bridge-listen'                                session-host.ts:175-176 ✅ → 'bridge-listen'
      └─ 无人认领                                                  session-host.ts:178     ✅ → 'other'
    → this.diagnostics?.record(failure)                           session-host.ts:451  ✅ src/ 中唯一的 record() 调用点
      → HostDiagnosticRecorder.record(input)                      host-diagnostics.ts:350 ✅
        → 逐字段脱敏、18 字段装配                                    host-diagnostics.ts:352-371 ✅
        → chainStartSeq ??= record.seq                            host-diagnostics.ts:372 ✅
        → store.push + 上界 200（丢弃最旧）                          host-diagnostics.ts:373-376 ✅
        → this.sink?.present(record)                              host-diagnostics.ts:377 ✅ 每条记录
          → 扩展侧 sink 闭包                                        extension.ts:430-434 ✅
            → hostDiagnosticsChannel?.appendLine(format(record))  extension.ts:432   ✅
              → createOutputChannel('DeepSeek Harness')           extension.ts:424-425 ✅（名称常量 host-diagnostics.ts:23）
  → throw HostStartError(startErrorKindForFailure(failure.kind))  session-host.ts:459  ✅ 同一个 failure 对象
出口: 通道中渲染的区块;  dsh.showHostDiagnostics → channel.show()   extension.ts:537-539 ✅
```

**判定**: ✅ 完整，且全程单实例 —— recorder 在 `extension.ts:429` 创建，`:436` 发布到模块，`:445` 交给 port，
`:2311` 交给每个新建 Host；读出口 `:1108` 返回的是同一个对象。仓库中不存在 store 的副本。

### 路径 2 — 编排器自有的「启动前拒绝」被重试 → 成对记录（✅ 连通 —— 这正是第 1 轮 C-1 断裂处）

```
入口: AC-19 定义的失败态（凭证缺失，状态栏可见且可点击）
  → connection-ui.ts:184-188     bar.command = 'dsh.statusBarAction'，失败态文案            ✅ 入口被提供
  ├─ 状态栏入口:  extension.ts:519-523  registerCommand('dsh.statusBarAction')
  │                       → orchestrator.request('status-bar')                            ✅
  ├─ 面板入口:    chat-panel-provider.ts:1126 发出 'action/retry-connect'
  │                     → protocol.ts:304 解析
  │                       → chat-panel-host.ts:728-729  deps.requestRetryConnect?.()
  │                         → extension.ts:1427-1429  orchestrator.request('manual-retry')  ✅
  └─ 测试入口:    extension.ts:1207-1211  orchestrator.request(r)                           ✅
        ⇓ 三个入口全部汇聚到同一次启动实现
  → AutoStartOrchestrator.runStart(reason)          auto-start-orchestrator.ts:205          ✅ 无并行路径
    → :207 state = 'starting'                       auto-start-orchestrator.ts:207          ✅
    → :210 notify()                                 auto-start-orchestrator.ts:210          ✅
      → extension.ts:449-453 onChange                → connectionUi.projectOrchestrator     ✅
                                                     → recordOrchestratorFailure(snap)      ✅
        → host-diagnostics.ts:283-286  state !== 'failed'  → recorded = undefined   ✅ guard 重新武装
        → return                                                                    ✅（提前 return，不记录）
    → :214 !port.hasCredentials() → throw Error('missing credentials', {kind:'missing-credentials'})
                                                    auto-start-orchestrator.ts:214-219      ✅ 早于 port.start
    → :232-234 state='failed', errorKind/errorMessage 置位（二者皆为常量）                 ✅
    → :241 notify()                                                                        ✅
      → listener: state === 'failed'，kind !== null
        → hostFailureKindForStartError('missing-credentials') === 'missing-credentials'     ✅（host-diagnostics.ts:247-248）
        → 签名 `${kind}\0${detail}` !== recorded                                            ✅ guard 已在上面重新武装
        → recorder.record({kind, detail})            host-diagnostics.ts:293               ✅ 记录落库
          → phase = chainStartSeq === null ? 'start' : 'retry'   host-diagnostics.ts:356   ✅ 'retry'
          → retryOfSeq = chainStartSeq                            host-diagnostics.ts:357  ✅ 指向首条
          → sink → channel                                        （同路径 1）              ✅
    → :249 notify()（同一次尝试内的第二次结算）                                                ✅
      → listener: 同一签名 === recorded → 被抑制                    host-diagnostics.ts:291  ✅ 无重复
  → onStartSucceeded() 永不被调用（Host 从未被进入）                                          ✅ 链路保持开启
出口: store 1 → 2;  records()[1] = {kind:'missing-credentials', phase:'retry',
        retryOfSeq: records()[0].seq, seq > records()[0].seq}                               ✅ 成对且可追溯
```

**判定**: ✅ **第 1 轮的断裂已闭合。** 依据是运行时证据而非读代码的判断：`host-diagnostics.spec.ts:1117-1142`
的扩展级用例激活真实扩展、通过真实 `AutoStartOrchestrator` 驱动真实的 `dsh.test.setCredentialPresence` +
`dsh.statusBarAction` 命令，并断言 `records()` 从 1 → 2 且 `phase: 'retry'`、`retryOfSeq === paired[0].seq`。
该用例是**结构性可判别**的：`'missing credentials'` 是常量字面量（`auto-start-orchestrator.ts:215`）、
`errorKind` 也是常量（`:233`），所以两次尝试的签名完全相同 —— 在第 1 轮的 guard（只在 `state === 'started'`
清除，而该状态永远到不了）下第二次写入会被抑制，`toHaveLength(2)` 会失败。另有两条用例分别钉住契约的两半：
`:586-595`（三个相同的失败快照 → **一条**记录）与 `:597-614`（跨越已重新武装边界之后的重试 → **两条**）。

### 路径 3 — 词表收窄后的 `invalid-setting` → 扩展 fallback → 恰好一条 `other`（✅ 连通）

```
入口: 启动请求时 dsh.nodeBin 配置项持有非字符串值
  → createStartHostPort.start                     extension.ts:2294
    → :2332  const seqBeforeStart = diagnostics?.lastSeq() ?? null   extension.ts:2332  ✅ 先取高水位
    → :2334  collectCredentialsEnv()                                  extension.ts:2334  ✅
    → :2335  readNodeBinSetting(vscode)                               extension.ts:2335  ✅
      → extension.ts:2257-2261  throw HostStartError('invalid-setting')                  ✅ 在 try 内抛出
    → catch                                            extension.ts:2351-2372            ✅
      → :2356 unbindConversations(); :2357 host = undefined                               ✅
      → :2367  diagnostics.lastSeq() === seqBeforeStart                                  ✅ 无其他记录写入
        → diagnostics.record({kind:'other', detail: redactSecrets(message)})  :2368-2371  ✅ 写入一条
        → → sink → channel                                             （同路径 1）        ✅
    → :2373-2375 重新抛出同一个错误                                                         ✅
  → 编排器 catch → state='failed', errorKind='invalid-setting'   auto-start-orchestrator.ts:232-233 ✅
    → :241 notify() → listener                                                           ✅
      → hostFailureKindForStartError('invalid-setting') → 显式 `case` → null
                                                     host-diagnostics.ts:249-250          ✅ 不写第二条
出口: 恰好一条记录，kind 'other'，携带该配置项的消息                                        ✅ 一条，不多不少
```

**判定**: ✅ 连通。记录词表已收窄回契约的 7 个成员（`host-diagnostics.ts:44-51`），失去自有 `kind` 的消息
仅凭精确信号改由扩展的 `other` 桶承载 —— 第 1 轮的 `!(error instanceof HostStartError)` 启发式已移除
（`extension.ts:2367`）。「一次尝试 = 一条记录」两个方向都被钉住：本用例由
`host-diagnostics.spec.ts:1099-1115`（断言长度为 1、kind 为 `other`、detail 含 `dsh.nodeBin`）覆盖，而
listener 对该信号拒不动手由 `:512-528` 覆盖（`invalid-setting` 快照之后 store 为空）。促成移除启发式的重复计数
风险由另一侧兜住：已被边界记录过的失败会推进高水位，故 `:2367` 跳过它 —— Host 自有的重试用例
`:1189-1227` 恰好断言一次重试后是 2 条记录，而不是 3 条。

### 路径 4 — `runStart` 的 `finally` 内被合并（排队）的重试 → 记录（✅ 连通；第 1 轮曾是缺口）

```
入口: 第一次尝试在途时到达第二个启动 reason
  → request('command-send')                        auto-start-orchestrator.ts:152-169
    → :160 state === 'starting' → pending.push; state = 'pending-start'; :164 notify()  ✅
      → listener: 'pending-start' !== 'failed' → recorded = undefined                   ✅ guard 重新武装
  → 在途尝试失败 → catch → state='failed'                                               ✅
  → finally :240 const more = this.pending.splice(0)                                    ✅ 排队的 reason 被保留
    → :241 notify() → listener 记录 #1（phase 'start'）                                  ✅
    → :242 more.length > 0 && !isConnected && generation 未变
    → :245 await this.runStart(next)                                                     ✅ 递归，同一个类
      → :207 'starting' → :210 notify → guard 重新武装                                   ✅
      → 排队尝试失败 → :241 notify → listener 记录 #2（phase 'retry'）                    ✅
出口: 两次尝试两条记录，第二条与第一条成链                                                  ✅
```

**判定**: ✅ 连通。该路径在第 1 轮因与路径 2 相同的原因而失效（`starting` 转移不清除 guard），同一处修改同时修复。
运行时证据：`host-diagnostics.spec.ts:616-655` 用真实 `AutoStartOrchestrator` 与真实 port（`start` 抛出
`missing-credentials` 一类）驱动，让第二个 reason 合并进 `pending-start`，断言
`starts === ['command-start','command-send']` 以及两条 `phase: 'retry'` 且 `retryOfSeq` 正确的记录。

### 路径 5 — 诊断读出口（✅ 连通，回归复核）

```
入口: 扩展命令面
  ├─ package.json:142-145  { "command": "dsh.showHostDiagnostics",
  │                          "title": "DeepSeek Harness: Show Host Start Diagnostics" }   ✅ 已贡献
  ├─ extension.ts:537-539  registerCommand('dsh.showHostDiagnostics')  ← 逐字符一致              ✅
  │    → :538  hostDiagnosticsChannel?.show()                                                 ✅ 真被调用
  │    → name = HOST_DIAGNOSTICS_CHANNEL_NAME = 'DeepSeek Harness'（单一来源，:23）            ✅ 稳定
  └─ extension.ts:1100-1109 registerCommand('dsh.test.getDiagnosticsText')
       └─ 该 register 调用位于 shouldRegisterTestHooks 的 if 块之内
            门禁开启于  extension.ts:1009;  块结束于  extension.ts:1224                        ✅ 在门禁内
            → () => hostDiagnostics?.records() ?? []     extension.ts:1108                    ✅ 数组，绝不为 null
            → hostDiagnostics 即交给 Host 的那个实例
              （:436 → :445 → :2311）                                                        ✅ 同一实例
            → records() 返回 [...this.store]         host-diagnostics.ts:385-387            ✅ 元素共享
出口: 结构化 HostDiagnosticRecord[]                                                           ✅
```

**判定**: ✅ 连通。`dsh.test.getDiagnosticsText` 只能经由门禁到达 —— 且反向现在真正可观测：`host-diagnostics.spec.ts:1040-1066`
通过 stub `node:module._load` 在无注入 `vscode` 替身的情况下触达 `activate(ctx)`，随后断言
`dsh.showHostDiagnostics` **已**注册而 `dsh.test.getDiagnosticsText` **未**注册、整个 `dsh.test.*` 前缀为空。
本 Phase 自己的读取辅助函数走注册命令而非直接读 recorder（`host-diagnostics.spec.ts:989-993`），因此该文件中
每条 AC 断言都在检验这条接线，而非走捷径。

### 路径 6 — 成功连接**之后**的运行期死亡 → 无记录（⚠️ 未变 —— 已裁定，现已留痕）

```
入口: 握手成功之后子进程退出
  → watchTransport 循环 reject                            session-host.ts:714-718  ✅ 已观测
    → onTransportDeath(reason)                            session-host.ts:727-757  ✅ status='error'（:729）、notifyError（:756）
      → diagnostics.record(...)                           🔴 缺失 —— :727-757 内无调用点；session-host.ts:451 是
                                                               src/ 中唯一的 record() 调用点
  → store / channel / dsh.test.getDiagnosticsText         从不观测到该事件
  → 编排器: 'started' → onUnexpectedDisconnect() → 'disconnected'
                                                          auto-start-orchestrator.ts:174-189 ✅
    → listener: state !== 'failed'                        host-diagnostics.ts:283-285  ✅ 按设计不贡献任何内容
出口: 无记录                                                                              ⚠️ 未变

同一缺口的第二个、更窄的入口 —— 死亡落在启动窗口的最后一瞬:
  → start() 返回时 status = 'connected'                   session-host.ts:439  ✅
  → 编排器读取之前 transport 死亡                          session-host.ts:729（status = 'error'）✅ 已观测
  → :222 this.port.isConnected() === false                auto-start-orchestrator.ts:2289  ✅
    → :226-228 state='failed', errorKind='process-failed'，消息置位
                                                    ← 该分支为 Phase 1 既有代码（本 Phase 对该文件的
                                                       diff 只动 START_ERROR_KINDS 与其 JSDoc）        ✅
    → :241 notify() → listener
      → hostFailureKindForStartError('process-failed') → null   host-diagnostics.ts:255      ✅ 按设计
    → 扩展 port: start() 已正常返回，其 catch 不会执行 → 无 `other` fallback                    ✅ 未抛出
  → store: 一个 `failed` 快照，零条记录                                                      ⚠️ 与 DEBT-010 同根因
```

**判定**: ⚠️ **按已接受的读法不构成断裂 —— 且不再静默。** 见下方裁定复核。上面第二个入口是该缺口最尖锐的形态：
一个由编排器**自己合成**消息的 `failed` 快照（`auto-start-orchestrator.ts:227`），任何地方都没有它的生产者 ——
listener 按设计拒收（`host-diagnostics.ts:255`），而 port 的 fallback 只能经 `throw` 到达
（`extension.ts:2351`）。它是 Phase 1 代码、经握手后死亡到达，因此落在已裁定范围**之内**而非之外，但它是债务条目
未携带的第二个定位点（见 S-2）。

---

## 上下游连接检查

| 新增/变更面 | 上游（谁调用） | 连接 | 下游（调用谁） | 连接 |
|---|---|:--:|---|:--:|
| `describeStartFailure()`（`session-host.ts:134`） | `start()` catch（`:445`） | ✅ | `HostDiagnosticInput` → recorder（`:451`） | ✅ |
| `startErrorKindForFailure()`（`host-diagnostics.ts:224`） | `session-host.ts:459` | ✅ | `HostStartError.kind`（`session-host.ts:67`、`:454/459`） | ✅ |
| `HostDiagnosticRecorder.record()`（`host-diagnostics.ts:350`） | `session-host.ts:451`；`host-diagnostics.ts:293`；`extension.ts:2368` | ✅ | `store.push` + `sink.present`（`:373`、`:377`） | ✅ |
| 扩展 sink 闭包（`extension.ts:430-434`） | recorder ctor（`:429`） | ✅ | `channel.appendLine(format…)`（`:432`） | ✅ |
| `createStartFailureListener()`（`host-diagnostics.ts:278`） | `extension.ts:448` | ✅ | recorder（`:293`）——**现在每次尝试都会到达** | ✅ |
| 编排器 `onChange` 订阅（`extension.ts:449-453`） | `AutoStartOrchestrator.onChange`（`:449`） | ✅ | UI 投影 + listener（`:450`、`:452`） | ✅ |
| `dsh.statusBarAction`（`extension.ts:519`） | `package.json:147`；`connection-ui.ts:81`、`:188` | ✅ | `orchestrator.request`（`:521`）→ `runStart` | ✅ |
| 面板 `action/retry-connect`（`chat-panel-provider.ts:1126`） | webview 消息 | ✅ | `chat-panel-host.ts:729` → `extension.ts:1428` → `request` | ✅ |
| `dsh.showHostDiagnostics`（`extension.ts:537`） | `package.json:143` | ✅ ID 逐字符一致 | `channel.show()`（`:538`） | ✅ |
| `dsh.test.getDiagnosticsText`（`extension.ts:1106-1109`） | 在 `shouldRegisterTestHooks` 之内（`:1009`） | ✅ 门禁真会关 | `hostDiagnostics.records()`（`:1108`）——同一实例 | ✅ |
| `hostFailureKindForStartError()`（`host-diagnostics.ts:245`） | `host-diagnostics.ts:287` | ✅ | 快照类别 → 记录 kind（或 `null` 表示交由他人） | ✅ |
| `START_ERROR_KIND_BY_FAILURE`（`host-diagnostics.ts:209`） | 对 7 个 kind 的编译期穷尽 | ✅ | `startErrorKindForFailure`（`:224`）→ `HostStartError.kind` | ✅ |
| `TransportClosedError.details`（`client.ts:68`、`:506-513`） | `closedError()`（`:496-503`） | ✅ | `session-host.ts:152-164` | ✅ |
| `TransportClosedDetails` 导出（`packages/sdk/client/src/index.ts:20`） | `client.ts:39` | ✅ 值 + 类型均已导出 | `session-host.ts:15` 导入 | ✅ |
| `onTransportDeath`（`session-host.ts:727`） | `watchTransport`（`:716`） | ✅ | recorder | ❌ **无边**（已裁定） |
| `HostDiagnosticRecorder.setSink()`（`host-diagnostics.ts:333`） | **全仓无调用方** | ❌ 未接线 | — | 不适用 |
| `HostDiagnosticRecorder.setCredentials()`（`host-diagnostics.ts:325`） | `session-host.ts:377` | ✅ | 逐记录脱敏（`:411`） | ✅ |
| `onStartSucceeded()`（`host-diagnostics.ts:341`） | `session-host.ts:440` | ✅ | 关闭链路（`:342`） | ✅ |
| `lastSeq()`（`host-diagnostics.ts:393`） | `extension.ts:2332`、`:2367` | ✅ | port fallback 的尝试级去重 | ✅ |
| `records()`（`host-diagnostics.ts:385`） | `extension.ts:1108`；测试辅助（`spec:990`） | ✅ | 命令 + 断言 | ✅ |
| AD-13 投影字段 | `handleApproval`（`interaction-coordinator.ts:273`、`:276`） | ✅ | `projectEntry`（`:225`、`:227`）→ `extension.ts:1098` | ✅ |
| `FAKE_STDERR_LINES` / `FAKE_EXIT_CODE` / `FAKE_SELF_SIGNAL`（`fixtures/fake-sdk-runtime.mjs:241-259`） | — | ✅ | `session-host.spec.ts:324`、`:351`、`:371`、`:385` | ✅ |
| `FAKE_EXIT_CODE` / `FAKE_SELF_SIGNAL`（`packages/sdk/client/tests/fake-runtime.ts:65-66`） | — | ✅ | `sdk-client.spec.ts:424`、`:439` | ✅ |

## 跨模块契约验证

| 边界 | 调用方期望 | 被调用方实际 | 一致 |
|---|---|---|:--:|
| `extension.ts` → `IdeSessionHost` ctor | `HostFailureDiagnostics`（扩展 `HostFailureRecorder` + `onStartSucceeded`） | `HostDiagnosticRecorder` 实现之（`host-diagnostics.ts:304`；`session-host.ts:103-106`） | ✅ |
| `extension.ts` → `StartHostPort.start` fallback | 仅当无人记录过时才写一条 | 前后取 `lastSeq()`（`:2332`、`:2367`）——精确信号，无 `instanceof` 启发式 | ✅ |
| `auto-start-orchestrator` → 抛出的启动错误 | `START_ERROR_KINDS` 的成员（`:27-35`） | 结构化读取，不做文本匹配（`:60-68`），与 AD-3 一致（`spec.md:67`） | ✅ |
| `auto-start-orchestrator` → 快照 | `errorKind` 忠实反映抛出的类别 | 两条失败路径都置位（`:227`、`:233`） | ✅ |
| 重试记录的 `phase` / `retryOfSeq` | 该重试是链路的下一环 | 每个生产者都成立 —— Host 记录（`session-host.ts:451`）与编排器 listener（`host-diagnostics.ts:356-357`）读同一个 `chainStartSeq`（`:372`） | ✅ |
| `HostDiagnosticRecord.kind` 词表 | 恰为契约冻结的 7 个成员 | `host-diagnostics.ts:44-51`（7 个）；契约测试的期望取自设计清单而非该类型（`spec:450`） | ✅ |
| `resolvedExecutable` 的「绝对路径」 | 字段文档如此声明 | 文档现已说明仅 `process-exec-path` 为绝对（`host-diagnostics.ts:75-80`、`:114-118`）；生产者 `launch.ts:132-139` 未改 | ✅（契约已对齐） |
| SDK `TransportClosedDetails` | 类型可被应用使用 | 值 + 类型分列导出（`index.ts:14-20`） | ✅ |
| 审批帧 → 投影 | `toolName` 非空，`reason` 可选 | 线上校验 + 条件展开（`interaction-coordinator.ts:273-276`） | ✅ |
| `phase` 词表 vs 连接后死亡 | 仅 `'start' \| 'retry'` | 无第三个成员；缺口以文档 + 登记方式承载 | ✅（见裁定） |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 | 接口状态 | 连接 |
|---|:--:|:--:|:--:|
| `resolveNodeExecutableSpec` / `ResolvedNodeExecutable` | Phase 1 / SDK | 未变；消费于 `session-host.ts:408` | ✅ |
| `NodeEnvironmentError.failure` | Phase 1 | 经 `instanceof` 收窄后再读取（`session-host.ts:139-151`） | ✅ |
| `HostStartError` / `StartErrorKind` 词表 | Phase 1 | 以增量方式扩展 `bridge-listen` / `spawn` / `handshake-timeout`（`auto-start-orchestrator.ts:27-35`）；`HostStartErrorKind = StartErrorKind`（`session-host.ts:67`） | ✅ |
| `redactSecrets` | Phase 1 | 复用而非重写（`host-diagnostics.ts:12`） | ✅ |
| `shouldRegisterTestHooks` 门禁 | 早期 Phase | 原样复用；新命令在其内（`extension.ts:1009`、`:1106-1109`） | ✅ |
| `ConnectionUiController` / `errorKind → settingsDeepLinkAvailable` | Phase 1 | 未变（`connection-ui.ts:140`）、`bar.command`（`:188`） | ✅ |
| DEBT-008（注释/引用保真，用户指派给本 Phase） | Phase 1 审查 | 已解决行在位（`tech-debt-registry.md:48`）；本次复核：`extension.ts:233`、`:2245` 的 `AD-9` 在位，配置项读取处无 `AD-10` | ✅ |
| DEBT-010（握手后缺口） | 本 Phase | 已登记为 🟡 非阻塞（`tech-debt-registry.md:28`）——**定位不精确**，见 S-2 | ⚠️ |
| Phase 3 机器驱动断言 `resolvedExecutable` 为绝对路径（`spec.md:57`） | Phase 3 | 依赖字段文档，而该文档现在如实说明了仅 `process-exec-path` 的限制 | ⚠️ 延续（Phase 2 无消费者受损） |

---

## 严重度裁定复核 —— 我是否同意 C-2 的握手前读法

调度者裁定：AC-18 的 `child-exited` 取证是**握手前**退出路径（`spec.md:52` 用 `FAKE_PENDING_INIT` 下的
`process.exit(7)` / `SIGTERM` 驱动），握手后死亡属运行期断连而非启动失败边界，并把我第 1 轮重跑版的发现
转化为「取证 + 显式台账 + 登记残余缺口」。**我对照原始来源复核了该裁定，并同意。** 理由取自文本本身而非裁定的
转述：

- `spec.md:13` 把整组 AC 限定为「Host **启动**的每个失败边界」—— 握手后死亡按定义在窗口之外。
- `spec.md:52` 是 spec 自己的 AC-18 验证方法，且落在启动窗口内（`FAKE_PENDING_INIT` + 真实退出码/自信号）。
  因此该验收读法可达、且确已达成 —— `session-host.spec.ts:351`、`:371`、`:385` 分别在三条独立断言中覆盖
  `exitCode === 7`、`exitCode === 0` 与 `SIGTERM`，三者在我的运行中全部通过。
- 记录词表本身就是启动中心的：`FAILURE_DETAILS['child-exited']` 的措辞是「was reaped **before the handshake
  completed**」（`host-diagnostics.ts:187`），而 `phase` 只有 `'start' | 'retry'`（`:54`）。接上连接后那条边需要
  第三个 `phase` 成员 —— 这是字段面变更，AD-14 决议 11 要求必须升 `schemaVersion`（`spec.md:70`），会打破
  Phase 3 的 `=== 1` 精确字段断言。代价收益确实严重失衡。
- 该缺口**不再静默**，而这正是我原本的异议所在：`implementation.md:224`（§8.12）正确点出了机制
  （`TransportClosedError` / transport watcher，通道未被动过），`DEBT-010` 亦警告 Phase 3 不得把空的
  `getDiagnosticsText()` 读作「未发生失败」。

我**没有新的证据**可推翻该裁定，且 `repo-exploration.md:606` 本身建议的正是这一解法（「satisfy AC-18 through
the pre-handshake exit path inside `start()` … If that reading is rejected, this is a spec ambiguity worth
escalating before coding, not after」）。因此我**不**把它重新提为阻塞项。我提出的是其交接的精确性（见下方 S-2）。
复核裁定期间我确实发现了同一缺口的另一个子情形 —— 死亡落在 `session-host.ts:439` 与编排器 `:222` 的读取之间，
留下一个无任何生产者的合成 `process-failed` 快照（路径 6 第二个入口）。该情形落在已裁定范围**之内**，不构成推翻
它的证据：它只是同一条握手后的边早一瞬被看到，因此它支持「把债务定位符写全」，而非「重开该决定」。

---

## 关键发现

### 🔴 Must-Fix

无。第 1 轮的阻塞边（编排器自有类别重试 →「追加一条记录」）已连通，且回炉未引入新断裂：
`createStartHostPort.start` 内的每条失败路径仍然恰好产出一条记录，而 `starting` 转移的重新武装不可能在同一次
尝试内造成重复记录（`runStart` 的 `finally`（`auto-start-orchestrator.ts:240-249`）里两次结算之间没有任何
非 `failed` 的 notify）。

### 🟡 Should-Fix

**S-1 —— `HostDiagnosticRecorder.setSink()` 全仓仍无任何调用方。**

- 位置：`apps/vscode-dsh/src/host-diagnostics.ts:333-335`（定义，JSDoc 在 `:329-332`）。
- 实测：全仓搜索 `setSink(` 只返回 **1** 处 —— 定义本身。无生产调用点、无测试使用、无文档指明所有者。
  实际接线是构造参数（`:316`），消费于 `extension.ts:429-434`。
- 为何与连通性相关：一个全新类上的导出接缝若无任何消费者，就等于同一字段（`private sink`）存在第二条从未被
  执行过的路径，读者无法判断哪条是权威。本仓自身的约定要求这类面必须有当前所有者与实际需求
  （`packages/AGENTS.md`，「Require a current owner and need」）。
- 第 1 轮原样延续（当时为 C-3，合并报告中列为 O-5）。处置二选一：删除，或指明所有者与需要晚绑定 sink 的场景。
- 非 MUST-FIX：构造路径完整，该死接缝不可达，故无端到端路径断裂。

**S-2 —— `DEBT-010` 指向的文件/函数不是真正缺失的那条边。**

- 位置：`tech-debt-registry.md:28`，`文件:函数:行号` 列写作
  「`apps/vscode-dsh/src/host-diagnostics.ts:260-294`（`createStartFailureListener`）与 `apps/vscode-dsh/src/session-host.ts`
  的 fail-loud 出口（`describeStartFailure` / `StartStage` 覆盖的五个启动阶段）」。
- 缺失的插入点是 `session-host.ts:727-757`（`onTransportDeath`）—— 这个私有方法已经设置 `status = 'error'`
  （`:729`）并调用 `notifyError`（`:756`），却从不触碰 `diagnostics`。所引的 `describeStartFailure` / `StartStage`
  是**已存在**的 fail-loud 面，不是**缺失**的那条边；照此条目行动的读者会去 `start()` 的 catch 里找，而那里
  并无缺失。
- 还缺**第二个**定位点：`auto-start-orchestrator.ts:225-229` 是唯一一处由编排器自行合成、且无人拥有的 `failed`
  快照 —— listener 按设计拒收 `process-failed`（`host-diagnostics.ts:255`），而 port 的 `other` fallback 需要
  `throw`（`extension.ts:2351`），故该次尝试以零条记录收尾。它经由同一次握手后死亡到达
  （`session-host.ts:729` 在 `:439` 与编排器 `:222` 的读取之间翻转状态），因此属于本行范围而非新开一条。
  另需注意 `host-diagnostics.ts:229-240` 为该 `null` 给出的理由「the Host writes its own record for those」对每个
  **抛出**的成员成立，对这个**合成**的分支不成立 —— 这正是该行应捕获的信息，以免下一位所有者重新推导。
- 为何与连通性相关：registry 行是这条「有意未接线」的边跨 Phase 交接的通道。若其定位符不指向缺失的边，交接即被
  削弱 —— 而同一行已正确写明 AD-14 的 `schemaVersion` 代价，更提高了下一位所有者从零重新定位的可能。
- 低成本修法：在该列补上 `session-host.ts:727-757`（`onTransportDeath`）与 `auto-start-orchestrator.ts:225-229`，
  与现有引用并列。
- 非 MUST-FIX：该行的**决策**内容与其对 Phase 3 的警示准确，仅指针偏移；且 Phase 2 无任何验收路径依赖那条未接线的边。

### 🟢 Observations

- **O-1 —— `apps/vscode-dsh/src/index.ts` 未再导出 `./host-diagnostics.ts`。** 新契约
  （`HostDiagnosticRecord`、`HostFailureKind`、`formatHostDiagnosticRecord` …）只能经深路径到达。今天无消费者需要它 ——
  扩展内部消费，Phase 3 的驱动走命令面 —— 且 `spec.md` 未要求该导出，故非断裂。记录在此，是因为未来若有人想为
  `dsh.test.getDiagnosticsText` 的结果标注类型，否则得重新声明那 18 个字段。
- **O-2 —— Host 无 `createOutputChannel` 时的降级。** `extension.ts:424-426` 让 channel 保持 `undefined`，
  于是 `:432` 的可选调用被跳过，而 store 继续累积。真实 VS Code 总是提供该 API，AC-13(a) 替身亦提供，且
  `host-diagnostics.spec.ts:1026-1031` 断言降级后的 host 在 reveal 命令上仍是作答而非抛错。记录仍可经测试钩子读出。
  属有意为之且有行内文档（`:427-428`）。
- **O-3 —— 连接后死亡之后，下一次尝试会以 `phase: 'start'` 记录而非 `'retry'`。** `onStartSucceeded()` 在成功启动时
  关闭链路（`host-diagnostics.ts:341-343` ← `session-host.ts:440`），因此 `DEBT-010` 最终无论采取何种解法，都需同时
  说明连接后死亡是否应开启链路。与当前「失败开链、成功闭链」规则一致；记下来是为了该债务的所有者不必重新推导。
- **O-4 —— `resolvedExecutable` 的绝对性仍是文档契约。** `launch.ts:132-139` 原样返回 `DSH_NODE_BIN` 与配置项值；
  只有 `process-exec-path` 天然绝对。字段文档已不再夸大（`host-diagnostics.ts:75-80`），Phase 2 无消费者因此改变判断，
  且 `apps/vscode-dsh/package.json` 中 `dsh.nodeBin` 的描述本就告诉用户要「绝对路径」。只有 Phase 3 的驱动断言
  （`spec.md:57`）会察觉到相对值。
- **O-5 —— 工作区中存在一个游离的探针文件。**
  `apps/vscode-dsh/tests/zz-rc2-probe.spec.ts`（未跟踪，mtime 00:36）自述为
  「TEMPORARY independent probe (reviewer-correctness, round 2) … Deleted after the run」。它是同级审查者的在途产物、
  非本 Phase 交付物，**也不该由我移除** —— 仅提示不要在 HG-3 时被扫进本 Phase 的提交集。没有任何生产或 Phase 测试
  文件引用它。
- **O-6 —— `pnpm-lock.yaml` 出现与本 Phase 无关的工作区漂移。** 差异涉及 `tsdown`、一个 `dsh-specdev` importer
  重排，以及 `vite` 6 → 8 的链接变更；没有一项对应该 Phase 新增的依赖（`spec.md:76` 禁止新依赖，且 `package.json`
  的差异仅限命令）。记录下来以免被读作本 Phase 的改动。

---

## 已执行的验证动作

以下全部读自重定向后的输出文件，而非采信 implementer 的自述。

| 动作 | 命令 / 位置 | 结果 |
|---|---|---|
| 跨包边界的编译级连通性 | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run typecheck` | ✅ 退出 0，`grep -c 'error TS'` → **0** |
| 运行本 Phase 自己的 spec（承载全部 AC 用例的文件） | `pnpm run test apps/vscode-dsh/tests/host-diagnostics` | ✅ 退出 0 —— 1 个文件，**44/44** 通过（第 1 轮测得 36；本次回炉 +8 条用例）|
| 经生产代码走通 SDK → Host → 编排器链路 | `pnpm run test packages/sdk/client/tests/sdk-client apps/vscode-dsh/tests/session-host apps/vscode-dsh/tests/auto-start-orchestrator` | ✅ 退出 0 —— 4 个文件，**76/76** 通过 |
| 命令 ID 一致性 | `package.json:142-145` vs `extension.ts:537`；`package.json:69-153` vs 各 `registerCommand` 调用 | ✅ `dsh.showHostDiagnostics` 逐字符一致；无孤儿贡献点 |
| 读出口的门禁位置 | 读取 `if (shouldRegisterTestHooks(…))` 块边界（`extension.ts:1009` … `:1224`） | ✅ `:1106-1109` 在门禁之内 |
| 门禁关闭方向 | 读 `host-diagnostics.spec.ts:1040-1066`（`node:module._load` stub） | ✅ 命令不存在，且整个 `dsh.test.*` 前缀皆不存在 |
| store 实例同一性 | 追踪 `extension.ts:429 → :436 → :445 → :2311 → :1108` | ✅ 单实例，无副本 |
| 死代码 / 未接线面 | 为每个新导出搜索消费者 | ⚠️ `setSink` 无消费者（S-1）；其余每个导出都有真实调用方 |
| 合成 `process-failed` 快照的可达性 | 读 `session-host.ts:439` 对照 `auto-start-orchestrator.ts:222` / `extension.ts:2289` | ⚠️ 仅经握手后死亡可达 → 零条记录；该分支本身为既有代码（本 Phase 对该文件的 diff 仅 `START_ERROR_KINDS` + JSDoc）|
| fixture 旋钮 | 为每个新旋钮搜索消费者 | ✅ 全部被使用（`session-host.spec.ts:324`、`:351`、`:371`、`:385`；`sdk-client.spec.ts:424`、`:439`）|
| 代码中的审查条目码 | `rg 'F-3\.[0-9]|\((S[0-9]+|M[0-9]+|C-[0-9]+)[,)]' apps/vscode-dsh` | ✅ 零匹配（`AD-*` 引用保留）|
| 第 1 轮阻塞边已闭合 | 运行 + 读 `host-diagnostics.spec.ts:1117-1142`、`:586-595`、`:597-614`、`:616-655`、`:1189-1227` | ✅ 已连通、可判别、覆盖去重契约的两个方向 |

未执行：我没有改动生产源码去复现第 1 轮的失败模式，因为那会篡改被审代码树。新重试用例的可判别性是通过阅读使两次
尝试签名相同的常量（`auto-start-orchestrator.ts:215`、`:233`）对照第 1 轮 guard 的已记录生命周期，加上实测的绿色运行
来确立的。

---

## 范围声明

本报告**只覆盖连通性**，范围限于 `spec.md`（AC-13 – AC-22）与 `design.md`（AD-1 – AD-14）定义的 Phase 2 范围。
行为正确性（脱敏完整性、逐字段装配、断言强度）属 `reviewer-correctness`；设计取舍与词表收窄的合理性属
`reviewer-design`；外观属 `reviewer-visual`（本非 UI Phase 为 N/A）。
