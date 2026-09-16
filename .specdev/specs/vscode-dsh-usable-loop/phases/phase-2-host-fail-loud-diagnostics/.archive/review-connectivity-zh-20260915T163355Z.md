# 连通性审查 — Phase 2（`phase-2-host-fail-loud-diagnostics`）

## 视角

**Integration Connectivity** — 这些部件真的连起来了吗？本报告只追踪端到端数据路径、上下游连接与跨模块契约；不评价实现正确性（reviewer-correctness）、设计/架构取舍（reviewer-design）或外观（reviewer-visual）。

审查范围：`spec.md` 的 AC-13 – AC-22、`repo-exploration.md`（§「Key Entry Points / Call Paths」）列出的各失败边界，以及 `design.md` 的 AD-3 / AD-5 / AD-13 / AD-14。

## 判决：MUST-FIX

本 Phase 新增的 7 条接线边中有 6 条是真正连通的：生产侧 → 有界 store → sink → Output Channel 是同一条链、同一个 recorder 实例；`dsh.test.getDiagnosticsText` 钩子注册在测试门禁**之内**且返回 store 自身的数组；`dsh.showHostDiagnostics` 与 `package.json` 的命令 ID 逐字符一致并真的调用 `channel.show()`；SDK 的结构化退出事实沿 `client.ts → index.ts → session-host.ts` 传递且导出链无断点；各重试入口都汇入同一个 `StartHostPort`；AD-13 投影确实由已校验的线缆数据赋值。有两条边是断的/失效的：第六个启动失败边界（`onTransportDeath`）**完全没有** record 边；orchestrator 自有的两个失败类别的「重试 → 记录」边被抑制，导致重复同一失败时不产生任何记录。

---

## 端到端路径追踪

### Path 1 — Host 分类的启动失败 → 记录 → store → Output Channel → 展示命令（连通）

```
入口：IdeSessionHost.start() 抛错                                  session-host.ts:441  （catch）
  → describeStartFailure(error, {stage, timeout, socket, node})     session-host.ts:445  ✅ 归类 → HostDiagnosticInput
      ├─ Node 预检拒绝（NodeEnvironmentError）                       session-host.ts:139-151 ✅ → 'node-environment'
      ├─ bridge.listen 拒绝                                         session-host.ts:175-177 ✅ → 'bridge-listen'
      ├─ TransportClosedError 且含 spawnError                       session-host.ts:157     ✅ → 'spawn'
      ├─ TransportClosedError 且无 spawnError                       session-host.ts:157     ✅ → 'child-exited'
      └─ 无边界能命名它                                              session-host.ts:178     ✅ → 'other'
    → this.diagnostics?.record(failure)                            session-host.ts:451  ✅ src/ 中唯一的 record() 调用点
      → HostDiagnosticRecorder.record(input)                        host-diagnostics.ts:329 ✅
        → store.push(record)                                        host-diagnostics.ts:352 ✅
        → 有界：超过 200 条先丢最旧                                   host-diagnostics.ts:353-355 ✅（上限常量 :26）
        → sink?.present(record)                                     host-diagnostics.ts:356 ✅ 每条都无条件推送
          → 扩展侧 sink 闭包                                          extension.ts:430-434 ✅
            → hostDiagnosticsChannel?.appendLine(format(record))    extension.ts:432   ✅
              → createOutputChannel('DeepSeek Harness')             extension.ts:424-425 ✅（名字常量 host-diagnostics.ts:23）
出口：通道中的渲染块（formatHostDiagnosticRecord host-diagnostics.ts:409-433）；
      dsh.showHostDiagnostics → channel.show()                      extension.ts:537-539 ✅
```
**判定**：✅ 完整，且全程同一实例 —— recorder 在 `extension.ts:429` 创建、`:436` 发布、`:445` 交给 port、`:2310` 交给 Host；测试钩子读的是同一个对象（`:1107`）。store 不存在任何副本。

### Path 2 — orchestrator 自有类别 → 记录 → 同一 store → 同一通道（连通）

```
入口：runStart → !hasCredentials()                                 auto-start-orchestrator.ts:214-218 ✅ kind='missing-credentials'
       （或 StartHostPort 的 readNodeBinSetting 在 port.start 内抛 HostStartError('invalid-setting')）
  → startErrorKindOf(error) —— 结构化读取 `.kind`                    auto-start-orchestrator.ts:60-68 ✅（不做文案匹配，AD-3）
  → snapshot {state:'failed', errorKind, errorMessage}              auto-start-orchestrator.ts:132-140 ✅
  → notify()                                                        auto-start-orchestrator.ts:262 ✅
  → 扩展侧 onChange 监听器                                            extension.ts:449-453 ✅
    → createStartFailureListener(recorder)                          host-diagnostics.ts:257-275 ✅
      → hostFailureKindForStartError(snapshot.errorKind)            host-diagnostics.ts:266 ✅（Host 自有类别返回 null → 跳过，避免重复记录）
      → recorder.record({kind, detail})                             host-diagnostics.ts:272 ✅ → 与 Path 1 同一 sink
  → connectionUi.projectOrchestrator(snapshot)                      extension.ts:450 → connection-ui.ts:110-113 ✅
    → mapSnapshot：'failed' / errorMessage / 设置深链                 connection-ui.ts:128-140, :147 ✅
      → panel.applyConnectionState + 状态栏 tooltip                  connection-ui.ts:173-189 ✅
出口：面板与状态栏显示脱敏文案；该失败被记录一次 ✅
```
**判定**：✅ 首次尝试完整，且结构上只有一条记录（`missing-credentials` 根本不会进入 port 的通用兜底 `extension.ts:2363-2372`；`invalid-setting` 的 `HostStartError` 在那里被 `!(error instanceof HostStartError)` 排除）。但**同一类别的重试不产生第二条记录** —— 见 Path 4b。

### Path 3 — SDK 结构化退出事实 → 包边界 → Host 记录（连通）

```
入口：child_process 的 'exit' (code, signal)                        client.ts:288-293 ✅
  → this.exitSignal = signal ?? undefined                          client.ts:290（字段 :230）✅
  → closedError(reason)                                            client.ts:496-502 ✅
    → transportDetails()                                           client.ts:506-511 ✅ {executable, exitCode, terminationSignal, stderrTail, spawnError}
      → new TransportClosedError(message, details)                 client.ts:502 ✅
        → @deepseek-ai/dsh-sdk-client 导出                          packages/sdk/client/src/index.ts:14-20 ✅（值 + 类型都导出）
          → session-host 导入                                       session-host.ts:15 ✅（tsconfig.base.json:214 将该 specifier 映射到 src/）
            → describeStartFailure 分支                             session-host.ts:152-164 ✅
              → kind = spawnError === undefined ? 'child-exited' : 'spawn'   session-host.ts:157 ✅
              → exitCode / terminationSignal / stderrTail / resolvedExecutable ✅
出口：结构化值同时进入 store、JSON 形式与渲染块 ✅
```
**判定**：✅ 完整。已产出的声明面也不陈旧 —— `packages/sdk/client/lib/types/index.d.ts:14` 已导出 `TransportClosedDetails`。

### Path 4a — **Host 分类**失败的重试重入同一路径，且记录成对（连通）

```
入口：dsh.statusBarAction                                          extension.ts:519-523 ✅
       （或面板按钮：chat-panel-provider.ts:1126 发送
        'action/retry-connect' → chat-panel-host.ts:728-729 →
        deps.requestRetryConnect）                                 extension.ts:1426 ✅
  → orchestrator.request(reason)                                   auto-start-orchestrator.ts:152-169 ✅
    → runStart → this.port.start(reason)                           auto-start-orchestrator.ts:205-220 ✅
      → createStartHostPort.start（唯一 port，绑定于）               extension.ts:445 → :2293 ✅
        → hostCreateCount += 1                                     extension.ts:2311 ✅（每次重入都递增）
        → new IdeSessionHost(diagnostics)                          extension.ts:2310 ✅ 同一 recorder 实例
          → Host 在每次尝试都记录自己的边界                            session-host.ts:451 ✅
            → phase 'retry' + retryOfSeq = 链条首条记录的 seq        host-diagnostics.ts:335-336, :351 ✅
出口：首启记录 + 重试记录靠 retryOfSeq 配对；成功后 snapshot 回到 'started' ✅
      （由 host-diagnostics.spec.ts:966-1003 以 Host 自有类别 'node-environment' 端到端证明）
```
**判定**：✅ 对 Host 分类的类别完整。

### Path 4b — **orchestrator 自有**失败（`missing-credentials` / `invalid-setting`）的重试不产生记录（失效边）

```
入口：AC-19 的失败态下点击 dsh.statusBarAction                      extension.ts:519-523 → :1426 ✅
  → request → runStart（同一条 port 路径）                          auto-start-orchestrator.ts:152-169, :205 ✅
    → 失败以同一类别、同一 message 重现                               auto-start-orchestrator.ts:214-218, :230-234 ✅
      → 监听器：state==='starting' 并没有清掉守卫                     host-diagnostics.ts:262-264（只有 'started' 才清）
        → `${kind}\0${detail}` 与上一条相同                          host-diagnostics.ts:269-270 🔴 提前 return
        → recorder.record(...)                                    host-diagnostics.ts:272 🔴 永不触达
出口：⛔ 该次重试不留任何记录；用户刚点击的重试在通道里看不到任何新内容
```
**判定**：🔴 MUST-FIX —— 见发现 C-1。

### Path 5 — 交互投影携带真实线缆数据（连通）

```
入口：桥接帧 'approval/request' {toolName（必填）, reason?}           ide-bridge/src/types.ts:175-181 ✅
  → validateBridgeFrame（toolName 必须非空）                        ide-bridge/src/validate.ts:75-86 ✅
    → session-host 帧分发                                          session-host.ts:839-843 ✅
      → InteractionCoordinator.handleApproval(frame)               interaction-coordinator.ts:257-277 ✅（entry.toolName := frame.toolName，:273）
        → 入队 → listPending()                                     interaction-coordinator.ts:197-201 ✅
          → projectEntry → { toolName, reason? }                   interaction-coordinator.ts:208-228 ✅（:225, :227）
            → dsh.test.listPendingInteractions（原样透传）            extension.ts:1096-1099 ✅（不裁剪字段）
出口：Phase 3 的驱动可从投影读到 toolName / reason ✅
```
**判定**：✅ 完整。生产路径上 `toolName` 不可能为空或伪造（线缆校验），`reason` 在运行期未提供时是**省略**而不是置 null。

### Path 6 — 成功连接**之后**运行期进程死亡 → 什么都不记录（缺边）

```
入口：握手成功之后子进程退出
  → watchTransport → onTransportDeath(reason)                       session-host.ts:698 → :727-757 ✅ status='error'（:729）、notifyError（:756）
    → diagnostics.record(...)                                       🔴 不存在 —— :727-757 内无调用点，
                                                                     且 session-host.ts:451 是 src/ 中唯一的 record() 调用
  → store / Output Channel / dsh.test.getDiagnosticsText             🔴 永远不会观察到该事件
  → orchestrator：snapshot 'disconnected' → 监听器什么都不记          host-diagnostics.ts:262（仅 state==='failed' 才记录）
  → 之后的重试发现链条早已关闭                                        host-diagnostics.ts:320 ← session-host.ts:440
出口：⛔ 这个失败边界在任何地方都没有记录
```
**判定**：🔴 MUST-FIX —— 见发现 C-2。

---

## 上下游连接检查

| 新增 / 改动面 | 上游（谁调用） | 连接 | 下游（调用谁） | 连接 |
|---|---|:--:|---|:--:|
| `describeStartFailure()`（`session-host.ts:134`） | `start()` catch（`:445`） | ✅ | `HostDiagnosticInput` → recorder | ✅ |
| `HostDiagnosticRecorder.record()`（`host-diagnostics.ts:329`） | `session-host.ts:451`、`host-diagnostics.ts:272`、`extension.ts:2368` | ✅ | `store.push` + `sink.present`（`:352`、`:356`） | ✅ |
| 扩展侧 sink 闭包（`extension.ts:430-434`） | recorder 构造函数（`:429`） | ✅ | `channel.appendLine(format…)`（`:432`） | ✅ |
| `formatHostDiagnosticRecord()`（`host-diagnostics.ts:409`） | 仅 sink | ✅ | Output Channel 文本 | ✅ |
| `createStartFailureListener()`（`host-diagnostics.ts:257`） | `extension.ts:448` | ✅ | recorder（`:272`）—— **重复同一失败时被抑制（Path 4b）** | 🔴 |
| `dsh.showHostDiagnostics`（`extension.ts:537`） | `package.json:143-145` | ✅ 命令 ID 逐字符一致 | `channel.show()`（`:538`） | ✅ |
| `dsh.test.getDiagnosticsText`（`extension.ts:1105-1108`） | 位于 `shouldRegisterTestHooks` 内（`:1009`，守卫 `:2211-2214`） | ✅ 只在门禁内注册 | `hostDiagnostics.records()`（`:1107`）—— 同一实例 | ✅ |
| `startErrorKindForFailure()`（`host-diagnostics.ts:213`） | `session-host.ts:459` | ✅ | `HostStartError.kind` | ✅ |
| `hostFailureKindForStartError()`（`host-diagnostics.ts:227`） | `host-diagnostics.ts:266` | ✅ | snapshot 类别 → 记录 kind | ✅ |
| `TransportClosedError.details`（`client.ts:66`） | `closedError()`（`:502`） | ✅ | `session-host.ts:152-164` | ✅ |
| `onTransportDeath`（`session-host.ts:727`） | `watchTransport`（`:698`） | ✅ | recorder | ❌ **无边**（C-2） |
| `HostDiagnosticRecorder.setSink()`（`host-diagnostics.ts:312`） | **无** | ❌ 未接线 | — | n/a |
| `HostDiagnosticRecorder.setCredentials()`（`host-diagnostics.ts:304`） | `session-host.ts:377` | ✅ | 逐字段脱敏（`:389-390`） | ✅ |
| `onStartSucceeded()`（`host-diagnostics.ts:320`） | `session-host.ts:440` | ✅ | 链条记账（`:321`） | ✅ |
| `lastSeq()`（`host-diagnostics.ts:372`） | `extension.ts:2331`、`:2366` | ✅ | port 兜底的「按次」去重 | ✅ |
| AD-13 投影字段 | `handleApproval`（`interaction-coordinator.ts:273`） | ✅ | `extension.ts:1098` | ✅ |

## 跨模块契约验证

| 边界 | 调用方期望 | 被调用方实际 | 一致？ |
|---|---|---|:--:|
| `extension.ts` → `IdeSessionHost` 构造 | `HostFailureDiagnostics`（record / setCredentials / onStartSucceeded / lastSeq） | `HostDiagnosticRecorder` 实现 `HostFailureRecorder`（`host-diagnostics.ts:283`） | ✅ |
| `extension.ts` → `StartHostPort.start` | 仅在别处都没记时才写兜底记录 | 尝试前后的 `lastSeq()`（`:2331`、`:2366`） | ✅ |
| `auto-start-orchestrator` → 抛出的启动错误 | `START_ERROR_KINDS` 的成员（`:27-35`） | `startErrorKindForFailure` 显式命名 `invalid-setting`（`host-diagnostics.ts:213-224`，F-3.1） | ✅ |
| `auto-start-orchestrator` → snapshot | `errorKind` 忠实于抛出的类别 | 结构化读取、不做文案匹配（`:60-68`），与 AD-3（`spec.md:67`）一致 | ✅ |
| `ConnectionUiController` ← snapshot | `errorKind`、`errorMessage` | 两条失败路径都会设置（`auto-start-orchestrator.ts:227-233`） | ✅ |
| 记录字段 `resolvedExecutable` | 文档写「绝对路径」（`host-diagnostics.ts:70`、`:104`） | `resolveNodeExecutableSpec` 对 `DSH_NODE_BIN` / 设置值**原样返回**（`launch.ts:133-139`） | ⚠️ 见 C-4 |
| 记录字段 `socketPath` | 绝对 bridge socket 路径 | Host 生成的临时绝对路径，`session-host.spec.ts:312` 断言相等 | ✅ |
| 重试记录上的 `phase` / `retryOfSeq` | 一次重试 = 同一次失败的第二条记录 | Host 分类的类别成立；orchestrator 自有的重复失败**根本不产生记录**（C-1） | 🔴 |
| SDK `TransportClosedDetails` | App 侧可用该类型 | 值与类型都导出（`packages/sdk/client/src/index.ts:14-20`） | ✅ |
| approval 帧 → 投影 | `toolName` 非空、`reason` 可选 | 线缆层强制非空（`validate.ts:77`） | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 | 接口状态 | 连接 |
|---|:--:|:--:|:--:|
| `resolveNodeExecutableSpec` / `ResolvedNodeExecutable` | Phase 1 / SDK | 未改动；消费点 `session-host.ts:408` | ✅ |
| `NodeEnvironmentError.failure` | Phase 1 | 读取前先 `instanceof` 收窄（`session-host.ts:139-151`，F-3.2） | ✅ |
| `HostStartError` / `StartErrorKind` 词表 | Phase 1 | 加性扩展 `bridge-listen` / `spawn` / `handshake-timeout`（`auto-start-orchestrator.ts:27-35`） | ✅ |
| `redactSecrets` | Phase 1 | 复用，未另写一套（`host-diagnostics.ts:12`、`extension.ts:54`） | ✅ |
| `shouldRegisterTestHooks` 门禁 | 更早 Phase | 复用，新命令注册在门禁内（`extension.ts:1009`、`:1105-1108`） | ✅ |
| `errorKind === 'missing-credentials'` → 设置深链 | 更早 Phase | 既有投影已满足（`connection-ui.ts:140`），未重做（implementation §8.1） | ✅ |
| DEBT-008（注释/引用保真，用户裁定并入本 Phase） | Phase 1 审查 | 注册表该行已在「已解决」表（`tech-debt-registry.md:47`）；本轮复跑探针：`AD-9` 命中 `extension.ts:233`、`:2245`；来源句加宽命中 `session-host.ts:54`、`auto-start-orchestrator.ts:40` | ✅ |
| Phase 3 真机驱动断言 `resolvedExecutable` 为绝对路径（`spec.md:57`） | Phase 3 | 依赖 C-4 中的契约 | ⚠️ |
| AC-30 的子进程死亡探针（`FAKE_EXIT_AFTER_MS`） | 更早 Phase | 仍可用且在用（`tests/interaction-fail-closed.e2e.spec.ts:98`） | ✅ |

---

## 关键发现

### 🔴 Must-Fix

**C-1 —— 重复同一 orchestrator 自有失败的重试不产生任何记录，导致「重试 → 记录」这条边在 AC-19 / AC-22(c) 摆到用户面前的那两个类别上完全失效。**
`createStartFailureListener` 用一个闭包级 `recorded` 签名，遇到相同 `(kind, message)` 就直接 return（`host-diagnostics.ts:260`、`:269-270`），而它**只被一次成功的启动清除**（`:263`）。重试时会先进入 `state = 'starting'`（`auto-start-orchestrator.ts:207`），这**不**清守卫，随后以完全相同的类别与文案再次失败 —— `'missing credentials'` 是常量文案（`auto-start-orchestrator.ts:215-218`），`readNodeBinSetting` 抛出的文案也是常量 —— 于是 `host-diagnostics.ts:272` 的 `recorder.record(...)` 永不执行。由于这两个类别没有 Host 侧边界替它们说话（`hostFailureKindForStartError` 对 Host 自有类别返回 `null`，`:227`），也没有其他生产者会写这条记录。实测后果：在 AC-19 的失败态（状态栏可见且可点击，`host-diagnostics.spec.ts:917-918`）下点击重试，store 增加 **0** 条记录；通道与 `dsh.test.getDiagnosticsText` 对用户刚触发的这次重试完全沉默，AC-22(b) 要求的「重试前后记录成对增加」在该类别上不成立。现有 AC-22 证据是由 **Host 自有**的 `node-environment` 类别承载的（`host-diagnostics.spec.ts:966-1003`）——那条路径上 Host 每次尝试都自己写记录、绕过该守卫；而 store 级的配对用例（`:326-343`）直接调用 `record()`，从未经过监听器。
修法：把守卫的粒度从「失败链」改成「单次尝试」（例如在进入新的尝试时清除，或按启动 generation 做键），同时保留注释所声称的「一次尝试可能多次通知」防护 —— 但需先核实该情形：注释提到的是「disconnect 边重复」，而这两个类别下 disconnect 边并不会产生第二个 `failed` snapshot（`auto-start-orchestrator.ts:174-189`、`:214-234`）。并为 `missing-credentials` 补一条重试配对证据，因为 AC-22(c) 要求可点击入口的正是这个失败态。

**C-2 —— 第六个启动失败边界（成功连接之后运行期进程死亡）没有任何记录边。**
`repo-exploration.md:123` 明确列出了它（「`child-exited` is a sixth boundary that is NOT in `start()`. … the recorder needs a second insertion point in `onTransportDeath`」），`:603-605` 进一步要求把「连接后退出应产生什么 `errorKind`」这件事**显式**决定（开放问题 8.1，`:648`）。实测：实现中 `src/` 内**只有一处** `record()` 调用点（`session-host.ts:451`，位于 `start()` 的 catch 内）；`onTransportDeath`（`:727-757`）设置了 `status = 'error'`（`:729`）并调用 `notifyError`（`:756`），但从不触碰 `diagnostics`。orchestrator 侧监听器也补不上：它只在 `snapshot.state === 'failed'` 时记录（`host-diagnostics.ts:262`），而连接后死亡产生的是 `disconnected` → `disconnected-retrying`（`auto-start-orchestrator.ts:174-189`）。store 自身的词表也把该类钉在握手之前（`host-diagnostics.ts:174`），因此该边界所描述的 `child-exited` 情形不可达。`implementation.md` §8 记了 8 条偏离，从未提到 `onTransportDeath` —— 即：探勘报告要求的第二个插入点既没有接线，也没有被显式否决。
影响：连接**之后**才死亡的 Host（`spec.md:61`：「子进程正常退出码 0 后断线（记录 `kind === 'child-exited'`）」）会把用户可见状态推到 `disconnected`，而 Output Channel 与 `dsh.test.getDiagnosticsText` 依然为空 —— fail-loud 面恰好在用户最常遇到的失败上沉默；同时它也拿掉了 AC-22(b) 在该场景下用来配对重试的那条「重试前」记录。
修法（二者择一，必须显式决定并写入 `implementation.md`）：(a) 接上第二个插入点 —— 在 `onTransportDeath` 用被回收子进程的退出事实记录 `child-exited`，并在同一次改动中回答探勘报告 §7.2 / §8.1 的问题；(b) 记录一条经审查的偏离：连接后死亡不在本 Phase 的记录词表内，同步修正 `host-diagnostics.ts:174` 与该 kind 的自述文案，并登记残留缺口，避免 Phase 3 真机运行把「通道为空」读成「没有发生失败」。

### 🟡 Should-Fix

**C-3 —— `HostDiagnosticRecorder.setSink()` 在全仓没有任何调用方。**
定义在 `host-diagnostics.ts:312`；生产环境唯一的 sink 接线是构造参数（`extension.ts:429-434`），测试也没有用它。已接线的路径不受影响，但新类上一个无人使用的公共接缝属于「为将来预留」的表面：要么删除，要么给它一个当前的所有者与需求。

**C-4 —— `resolvedExecutable` 文档写成绝对路径，但生产侧只对三个来源中的一个保证绝对性，而 Phase 3 的消费方断言了绝对性。**
记录字段写着「**Absolute** path of the Node executable the Host resolved and spawned」（`host-diagnostics.ts:70`；输入侧 `:104` 重复同一说法），而 `resolveNodeExecutableSpec` 对 `DSH_NODE_BIN` 的值（`launch.ts:134`）与 `dsh.nodeBin` 设置值（`launch.ts:138`）都是**原样返回** —— 绝对性只对 `process-exec-path` 成立。本 Phase 自己的实现表写的是更窄的事实（「absolute **only** for the `process-exec-path` source (F-3.3)」，`implementation.md:108`），因此字段 JSDoc 与本 Phase 声明的契约彼此矛盾。会因此踩坑的消费方是跨 Phase 的：`spec.md:57` 要求 Phase 3 的真机驱动断言 `node-environment` 记录的 `resolvedExecutable` 为绝对路径。值本身传递正确，所以这是模块边界上的契约缺口、而非断掉的调用 —— 修法二选一：在字段文档里写明该限制，或在记录边界重新绝对化（本 Phase 刻意没有这么做）。

### 🟢 Observations

- **O-1** —— `apps/vscode-dsh/src/index.ts` 没有 re-export `./host-diagnostics.ts` 的任何内容，而该包的其它模块是 re-export 的（`:25`、`:41`）。当前没有任何消费方，`spec.md` 也未要求，因此不构成断裂；提出来是因为 Phase 3 的驱动可能想直接引用 `dsh.test.getDiagnosticsText` 的返回类型，而不是重新声明那 18 个字段。
- **O-2** —— 宿主没有 `createOutputChannel` 时的降级：通道保持 `undefined`（`extension.ts:424-426`），而 sink 仍然接线（`:430-434`），于是记录仍会入库、可通过测试钩子读取，但永远不渲染。这是刻意的，代码内已说明（`:427-428`）。
- **O-3** —— 连接后死亡之后的那次尝试，其 `phase` 是 `'start'` 而非 `'retry'`，因为一次成功的启动已经关闭了链条（`host-diagnostics.ts:320` ← `session-host.ts:440`）。这与「失败开链、成功关链」一致，但 C-2 无论取哪种修法，都必须同时说明「连接后死亡是否应开一条链」。
- **O-4** —— 本 Phase 之后 `apps/vscode-dsh/src` 中不存在任何 `@STUB` 标记，注册表的活跃表也没有因本 Phase 新增条目（`tech-debt-registry.md:33-35`）；唯一被本 Phase 触及的行是 DEBT-008，已正确移入「已解决」表（`:47`）。以上均对照代码复核，未采信报告自述。

---

## 本轮实测证据

| 检查 | 命令 | 结果 |
|---|---|---|
| 编译级连通性 | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run typecheck` | exit 0 |
| 通过生产代码实跑已接线路径（Path 1 / 2 / 3 / 4a / 5） | `pnpm run test apps/vscode-dsh/tests/host-diagnostics` | exit 0 —— 1 个文件，**36/36** 用例通过 |

两项均从重定向的输出文件读取，未采信 implementer 的报告。Path 4b 与 Path 6 是通过读函数体追踪得出的；两者都没有任何会因其失败而变红的用例。
