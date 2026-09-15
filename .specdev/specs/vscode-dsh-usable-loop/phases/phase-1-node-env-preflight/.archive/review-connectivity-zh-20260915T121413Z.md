# 连通性审查 — Phase 1（`phase-1-node-env-preflight`）第 2 轮

| 项 | 值 |
|---|---|
| 视角 | **Integration Connectivity** — 各零件是否真正端到端连通 |
| 被审分支 | `impl-phase-1-node-env-preflight`（以 `git branch --show-current` 确认） |
| 被审对象 | `implementation.md`（回炉第 1 轮，2026-09-15 18:32） |
| 轮次 | 第 2 轮 —— 第 1 轮三视角合并判决 **MUST-FIX** 之后 |
| 上一轮报告 | 本 Agent 启动时已按启动自清理协议归档到 `.archive/review-connectivity-20260915T103404Z.md`（`-zh` 同） |
| 已完整阅读的上游 | `spec.md`、`repo-exploration.md`、`implementation.md`、`design.md`、`requirements.md`、`phase-plan.md`、归档的第 1 轮 `review-connectivity.md`、`.archive/review-20260915T103312Z.md` |

## 判决

**PASS** —— 本 Phase 被要求连通的每一条路径都已端到端连通，本 Phase 引入的每一组跨模块契约在调用方与被调用方两侧一致。没有断裂的端到端路径，没有不一致的契约，没有未通知就改动的跨 Phase 接口。

另有 **1 条 Observation**（不是连通性缺陷、不阻塞）：一条没有任何 AC 枚举的失败分支的结构化归类问题，见 🟢 O-1。此处记录，便于调度者把它路由给合适的归属方（记录词表属于 Phase 2），而不是丢失。

判决依据是我自己读代码的结论，外加两份独立测量：仓库之外的探针harness（`/tmp/dsh-conn-probe2/probe.mts`，经用户批准）与仓库自身的差量门禁。

---

## 1. 对第 1 轮 13 条发现的逐条判定

图例：**FIXED-VERIFIED** = 我自己从代码重新推导或实际执行过；**FIXED** = 修复存在于被审产物中。

| # | 第 1 轮发现 | 判定 | 我的独立核验 |
|---|---|---|---|
| **M1** | `docs/development.md` / `.zh.md` 缺 AC-3(d) 的可判定记号 | **FIXED-VERIFIED** | `docs/development.md:131` 含 `Developer: Reload Window`、`workbench.action.reloadWindow`、`dsh.nodeBin`、`DSH_NODE_BIN`；`docs/development.zh.md:136` 携带同一组四个记号。文档 → 设置键 → 命令 id 的记号链闭合。 |
| **M2** | `HostStartError{kind:'node-environment'}` 在 orchestrator 一跳被压平为 `process-failed` | **FIXED-VERIFIED** | 三份独立确认：(i) 代码 —— `auto-start-orchestrator.ts:26-27` 用单一数组 `START_ERROR_KINDS = ['missing-credentials','node-environment','process-failed']`，`:29-37` 由它派生类型，`:47-55` 的 `startErrorKindOf` 是 catch 路径上唯一写 `errorKind` 的地方（`:220`），`session-host.ts:51` 声明 `HostStartErrorKind = StartErrorKind`（由构造保证一致，而非靠约定）；(ii) 我的探针 G —— 通过端口抛出**真实的** `HostStartError('node-environment', …)` 得到 `snapshot.errorKind === 'node-environment'`，普通 `Error('spawn EBADF')` 得到 `process-failed`，旧式 `{kind:'other'}` 对象也得到 `process-failed`；(iii) 运行时用例 `node-env-guard.spec.ts:666`（真实扩展激活 → L2 快照）。可证伪性：断言与字面量 `'node-environment'` 比较，而探针 G 已证明「压平实现」在同一快照上会产出 `'process-failed'`，故该用例可以变红；`implementation.md` §4.4 记录了实际执行的变异（`Tests 2 failed \| 34 passed (36)`）。 |
| **S1** | `implementation.md` AC-4 行的 payload 字段名写成 `zstd`/`withResolvers` | **FIXED** | §3 的 AC-4 行现为 `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}`，与收窄守卫 `node-env-guard.ts:275-282` 及夹具 `node-env-guard.spec.ts:286-299` 一致。 |
| **S2** | `process-exec-path` 的修复建议提 `PATH`，与「永不查 PATH」契约矛盾 | **FIXED-VERIFIED** | `node-env-guard.ts:200` 现在点名该可执行文件的归属者并给出两个真正有效的杠杆。`grep -nE "PATH" apps/vscode-dsh/src/node-env-guard.ts` → 仅 1 处 `:190`，即那句「解析**绝不查询** `PATH`」的 JSDoc；任何诊断文案都不含 `PATH`。双向断言在 `node-env-guard.spec.ts:415-417`。 |
| **S3** | `implementation.md` 对 `extension.ts` lint 数量的陈述不实 | **FIXED-VERIFIED** | 我亲自重跑门禁（`pnpm --config.verify-deps-before-run=false run lint`）：`extension.ts` = **22** 条（与 §4.3 一致，而非第 1 轮的 3），`session-host.ts` = 1（`:595`），`auto-start-orchestrator.ts` = 1（`:230`），`index.ts` = 1（`:97`），而 `node-env-guard.ts`、`node-env-guard.spec.ts`、`session-host-preflight.spec.ts`、`packages/sdk/client/{src/launch.ts,src/types.ts,src/index.ts,tests/launch.spec.ts}` 均为 **0**。我也亲自核了「无新增」那一半：`:230` 落在 orchestrator 的插入 hunk（`@@ -26,2 +26,30 @@`、`@@ -192,5 +220 @@`）之外，`:595` 落在 `session-host.ts` 的插入区间之外，`index.ts:97` 落在 `@@ -25 +25,15 @@` 之外，`extension.ts` 的 22 条无一落在那 5 个插入 hunk 内。 |
| **S4** | manifest 的 `scope` / `markdownDescription` 未记入偏差 | **FIXED-VERIFIED** | `implementation.md` §5.10 记录了两个键及理由；`apps/vscode-dsh/package.json` 的 diff 显示 `type`、`default`、`scope: "machine-overridable"`、`description`、`markdownDescription`。 |
| **S5** | AD-9「每次重新读取、不缓存」缺可证伪测试 | **FIXED** | `node-env-guard.spec.ts:629-646` 激活一次、启动两次，并在两次之间重写**真实** `settings.json`，断言第二次快照的消息含 `second` 且不含 `first`；`vscode` double 每次调用都重读该文件（`:564-571`），故「缓存了值」或「缓存了解析结果」都会变红。§4.4 记录了实际执行的变异（`Tests 4 failed \| 23 passed (27)`）。 |
| **S6** | AC-3(a)(b) 的结构断言无可执行测试 | **FIXED** | `node-env-guard.spec.ts:96-165` 新增 `assertChecklistStructure`（四个标题各恰好一次；每条「本机环境」条目携带可判定记号），`:474-499` 对**真实**的 `docs/development.md` + `.zh.md`（`:31-32`）运行，随后就地删除每个 face 标题并要求同一断言抛错。 |
| **S7** | 「declared once」措辞与 `EXPECTED_NODE_RANGE` 实为副本相冲突 | **FIXED-VERIFIED** | `docs/development.md:105` 现称该门槛「has one owner, `engines.node` in the root `package.json`, which the extension mirrors in the range it enforces and a test keeps equal to that field」；该测试存在 —— `node-env-guard.spec.ts:444-446` 断言 `engines.node === EXPECTED_NODE_RANGE`。 |
| **S8** | 设置项 → host 的路由决策未记录 | **FIXED-VERIFIED** | §5.11 记录了路由与三条理由；接线是真实的：`extension.ts:2253` `readNodeBinSetting(vscode)` → `:2254-2258` `next.start({ cwd, nodeBinSetting, credentials })` → `session-host.ts:106-109` 声明该选项 → `:287-289` 用它解析一次。 |
| **S9**（本视角第 1 轮提出） | `probeNodeApis()` 未传 `env`，导致需要 `ELECTRON_RUN_AS_NODE` 的候选被误判 | **FIXED-VERIFIED** | `node-env-guard.ts:254-258` 现接收 `ResolvedNodeExecutable`，构建显式环境，且当且仅当 `executable.electronRunAsNode` 时设 `ELECTRON_RUN_AS_NODE=1`；`:260-264` 把它交给 `execFileAsync`。被探测的对象就是被 spawn 的对象：`session-host.ts:290` 校验 `nodeExecutable`，`:300` 把同一对象交给 `HarnessClient`，`client.ts:204` → `launch.ts:177` 直接消费 `options.nodeExecutable` 而不重新解析。用例 `node-env-guard.spec.ts:240-267` 是双向的（有 flag 时 `ok:true`，无 flag 时 `unusable`）。我的探针 F 独立复现：`electronRunAsNode:true` 时 shim 观测到 `ELECTRON_RUN_AS_NODE="1"`，为 `false` 时观测到 `""`。 |
| **S10** | Phase 2 的「诊断注入点」未记录 | **FIXED-VERIFIED** | §5.12 点名了三处带 file/line 的类型化表面：`IdeSessionHost.onError(listener) → disposer`（存在于 `session-host.ts:195-200`；已在 `extension.ts:2237-2240` 订阅）、`AutoStartOrchestrator.getSnapshot()/onChange()`（存在；在 `extension.ts:402-405` 被消费）、`HostStartError{kind, diagnostic}`（`session-host.ts:57-77`）。因此 Phase 2 是挂到既有端口，而非新造 sink。 |

### 1.1 implementer 自报的 3 处「与审查字面要求不同」

| # | 偏差 | 我的裁定 |
|---|---|---|
| 1 | 保留 `process-failed` 作为唯一兜底，而非删除它 | **成立。** 词表是单一数组（`START_ERROR_KINDS`），同时是类型与守卫，第二个万能成员 `'other'` 已消失。我核过 app 内没有任何地方引用被移除的成员：`grep -rn "'other'\|"other"" apps/vscode-dsh/src apps/vscode-dsh/tests` → 2 处命中，都与 `errorKind` 无关（`phase1-code-context.spec.ts:131`、`timeline-projector.spec.ts:59`）；产品代码中唯一的 `errorKind` 比较是 `connection-ui.ts:140` 与 `'missing-credentials'`。`typecheck` 绿，说明没有消费者丢分支。Phase 2 spec 引用「未归类失败 → `errorKind === 'process-failed'`」依然有效。 |
| 2 | 更正 S3 的数字（门禁下为 22）而非照抄审查的 3 | **成立。** 我的独立门禁运行测得 `extension.ts` 为 22、三个新文件为 0，四个被改动的既有文件各 1 条且都在插入区间之外（见上 §1 S3）。把 3 当作「门禁命令下的」数字会是错的。 |
| 3 | S5 用「重写真实 `settings.json`」而非「改 double 的返回值」 | **成立。** 这是更强的证伪机制：它既能抓住「缓存了文件读取」，也能抓住「缓存了值」，而 orchestrator 层的断言（第二次启动看到第二个值）完全相同。 |

---

## 2. 端到端路径追踪

### 路径 1 —— 配置的 Node 可执行文件走到 spawn（AC-5 / AC-6 / AC-10）

```
入口：VS Code manifest 键 `contributes.configuration.properties["dsh.nodeBin"]`
  → extension.ts:2180  vscode.workspace.getConfiguration('dsh').get('nodeBin')      ✅ 按名读取该键
  → extension.ts:2182-2188  undefined/null → undefined；非字符串 → fail loud        ✅ 无静默默认
  → extension.ts:2253-2256  IdeSessionHost.start({ nodeBinSetting })                ✅ 显式输入，而非隐式读取
  → session-host.ts:287-289 resolveNodeExecutableSpec({ nodeBinSetting })           ✅ 唯一解析入口
       ├ DSH_NODE_BIN 非空             → {source:'dsh-node-bin',     electronRunAsNode:false}
       ├ nodeBinSetting 非空(trim 后)  → {source:'vscode-setting',   electronRunAsNode:false}
       └ 其余                          → {source:'process-exec-path',electronRunAsNode:process.versions.electron!==undefined}
  → session-host.ts:290  assertNodeExecutable(同一个对象)                           ✅ 被探测对象 == 被 spawn 对象
  → session-host.ts:300  new HarnessClient({ nodeExecutable })                      ✅ 对象被传递，未被重新推导
  → client.ts:204        resolveDshLaunch(options)                                  ✅
  → launch.ts:177        options.nodeExecutable ?? resolveNodeExecutableSpec()      ✅ 无第二次解析
  → launch.ts:180-182    仅当 electronRunAsNode 才注入 ELECTRON_RUN_AS_NODE          ✅ flag 不会泄漏到第 1/2 级
  → launch.ts:184-192    command = 被执行路径，env 只构建一次                        ✅
出口：在已校验的可执行文件下 spawn `dsh --profile ide`
```

**判定：连通。** 第 1 轮担心的「第二个独立判空把调用方指定的可执行文件误判为 Electron」已闭合：`launch.ts` 中只有两个非空判断，且都在唯一的 `resolveNodeExecutableSpec` 内（`:133` 判 `DSH_NODE_BIN`，`:137` 判设置项 —— `:64` 是与本项无关的 dsh bin 检查），`electronRunAsNode` 也只在一处计算（`:143`）。解析器的产品调用点只有 `launch.ts:177` 与 `session-host.ts:287`，而 VS Code 路径总是传入该对象，因此解析恰好发生一次。

用真实模块在探针中测得：

```
A.tier2.spec          => {"path":"/setting/node","source":"vscode-setting","electronRunAsNode":false}
A.tier2.command       => "/setting/node"
A.tier2.flagKey       => "ABSENT"
B.tier1.spec          => {"path":"/env/node","source":"dsh-node-bin","electronRunAsNode":false}
B.tier1.command       => "/env/node"
B.tier1.flagKey       => "ABSENT"
C.tier3.spec          => {"path":"/usr/local/n/versions/node/24.3.0/bin/node","source":"process-exec-path","electronRunAsNode":true}
C.tier3.isExecPath    => true
C.tier3.flag          => "1"
D.retainedObject.command => "/frozen/node"
D.noObjectFallback.command => "/usr/local/n/versions/node/24.3.0/bin/node"
E.settingSource.command => "/setting/node"
E.settingSource.isPathShim => false
E.tier3.commandIsExecPath => true
E.tier3.isPathShim => false
```

`D` 证明身份不变量（保留的对象即使 `DSH_NODE_BIN` 改变也优先；只有未提供对象时才回退），`E` 证明把 `node` shim 前置到 `PATH` 后，设置来源与第 3 级都不会选中它 —— 即回炉**没有重新引入 `PATH` 回退**。

### 路径 2 —— Node 环境失败抵达 VS Code 表面（AC-7 / AC-8 / AC-9，M2）

```
入口：候选未通过前置校验
  → node-env-guard.ts:230-244  inspectExecutableFile → 'missing' | 'not-executable'
  → node-env-guard.ts:254-273  probeNodeApis → 'unusable' | report
  → node-env-guard.ts:138-145  缺 REQUIRED_NODE_APIS → 'missing-apis'
  → node-env-guard.ts:167-176  formatNodeEnvironmentDiagnostics → 五行文案
  → NodeEnvironmentError(message, failure)                                        ✅ 结构化载荷保留
  → session-host.ts:319        errorMessage = redactSecrets(...)                  ✅ 脱敏在投影前只做一次
  → session-host.ts:321-325    throw HostStartError('node-environment', message, {cause, diagnostic})
  → extension.ts:2215-2279     port.start() 原样重抛                              ✅ 没有会丢掉 `kind` 的包装
  → auto-start-orchestrator.ts:207 await port.start() → :217 catch
  → auto-start-orchestrator.ts:220 this.errorKind = startErrorKindOf(error)       ✅ 读 `kind` 并做词表校验
  → auto-start-orchestrator.ts:123 snapshot {state:'failed', errorKind, errorMessage}
  → extension.ts:402-405       orchestrator.onChange → connectionUi.projectOrchestrator(snap)
  → connection-ui.ts:140       settingsDeepLinkAvailable = errorKind === 'missing-credentials'  → false
  → connection-ui.ts:147-154   message = snap.errorMessage                        ✅ 五要素诊断文案
  → connection-ui.ts:173-186   panel.applyConnectionState + 状态栏文本             ✅ 可见表面
出口：用户看到环境归因的消息，点明路径、期望与修复方法
```

**判定：连通，且归类被消费而非「写后即弃」。** `errorKind` 被 UI 投影读取（决定深链），`errorMessage` 被渲染；运行时用例 `node-env-guard.spec.ts:648-671` 正是走这条链（真实 `activate()`），断言 `state === 'failed'`、`errorKind === 'node-environment'`（`:666`）、消息含出错路径与 `dsh.nodeBin`（`:667-668`）、以及事后 `settings.json` 字节不变（`:670`）。

该用例使用的 `dsh.test.requestStart` 路径是生产对象而非 orchestrator 的测试替身：`extension.ts:1142-1143` 返回的是同一个单例的 `orchestrator?.getSnapshot()`，而该单例的 `onChange` 正是喂给 `connectionUi` 的那一路。因此断言落在真实投影上，距 UI 卡片只差一跳。

### 路径 3 —— 探测与 spawn 使用同一模式（S9 / AD-1）

```
node-env-guard.ts:131  probeNodeApis(executable)     ← 已解析的对象
  → :257-258  env = {...process.env}; if (executable.electronRunAsNode) env.ELECTRON_RUN_AS_NODE = '1'
  → :260-264  execFileAsync(executable.path, ['-e', PROBE_SOURCE], { env })
launch.ts:180-182       spawn 环境在同一 flag 为真时才注入 ELECTRON_RUN_AS_NODE
```

**判定：连通。** 探针 F（`F.electronMode.ok => true`、`F.electronMode.flagSeenByProbe => "\"1\""`、`F.plainMode.flagSeenByProbe => "\"\""`）表明该 flag 当且仅当 spawn 会设置它时才抵达候选，反之绝不。

### 路径 4 —— Phase 2 的交接表面（S10，跨 Phase 连通性）

```
(I) IdeSessionHost.onError(listener) → disposer     session-host.ts:195-200   已在 extension.ts:2237-2240 接线
(II) orchestrator.getSnapshot() / onChange(handler)  auto-start-orchestrator.ts:123-124  已在 extension.ts:402-405、1108-1113 消费
(III) HostStartError{kind, diagnostic}               session-host.ts:57-77     由 :324 从 error.failure 携带
```

**判定：交接连通，但有一处刻意保留。** (I)(II) 在 Phase 1 内有活的消费者。(III) 的 `.diagnostic` 在 Phase 1 内**没有读取者** —— `grep -rn "\.diagnostic\b" apps/vscode-dsh/src` 只返回声明与赋值。这正是 `spec.md:133` 为 Phase 2 预留的表面，而 §5.12 现在明确记录了它（包括「Phase 2 的记录器读 `error.diagnostic`，而非重新解析渲染文案」），因此这是**有记录的预留**，不是无人认领的数据黑洞。见 🟢 O-2。

---

## 3. 上下游连接检查

| 新增/改动单元 | 上游（谁调用） | 连通 | 下游（调用谁） | 连通 |
|---|---|:--:|---|:--:|
| `resolveNodeExecutableSpec()`（`launch.ts:131`） | `session-host.ts:287`、`launch.ts:177`、`launch.spec.ts` 10 个用例 | ✅ | `process.env.DSH_NODE_BIN`、调用方设置项、`process.execPath`/`process.versions.electron` | ✅ |
| `resolveDshLaunch()`（`launch.ts:164`） | `client.ts:204` | ✅ | `resolveNodeExecutableSpec()` 回退、env/argv 组装 | ✅ |
| `assertNodeExecutable()`（`node-env-guard.ts:155`） | `session-host.ts:290` | ✅ | `validateNodeEnvironment()` → `probeNodeApis()` → 真实子进程 | ✅ |
| `readNodeBinSetting()`（`extension.ts:2179`） | `createStartHostPort().start()` 内的 `extension.ts:2253` | ✅ | `vscode.workspace.getConfiguration('dsh').get('nodeBin')` | ✅ |
| `IdeSessionHost.start({nodeBinSetting, nodeExecutable})`（`session-host.ts:257`） | `extension.ts:2254`；`session-host-preflight.spec.ts`（脱离 VS Code） | ✅ | 前置校验 → `bridge.listen` → `HarnessClient(nodeExecutable)` | ✅ |
| `HostStartError{kind, diagnostic}`（`session-host.ts:57`） | 在 `:322`、`:327` 抛出；3 个测试文件断言 | ✅ | `AutoStartOrchestrator` catch `:217-221` → 快照 → ConnectionUi | ✅ |
| `startErrorKindOf()`（`auto-start-orchestrator.ts:47`） | `:220`（`errorKind` 的唯一写入者） | ✅ | `START_ERROR_KINDS` 词表 | ✅ |
| `contributes.configuration["dsh.nodeBin"]`（`package.json`） | VS Code 设置界面；由 spec 中的 `nodeBinProperty()` 断言 | ✅ | 运行时读取与诊断均使用常量 `NODE_BIN_SETTING` | ✅ |

**孤儿检查（新增导出/函数从未被调用）：没有实质孤儿。** `formatNodeEnvironmentDiagnostics` 从外部看像孤儿，实际是 `NodeEnvironmentError` 消息的生成体（`:92`）；`validateNodeEnvironment` 被 `assertNodeExecutable` 与 11 处测试调用；`REQUIRED_NODE_APIS`、`EXPECTED_NODE_RANGE`、`DSH_NODE_BIN_VARIABLE`、`NODE_BIN_SETTING` 被守卫、扩展与 spec 消费；`NodeEnvironmentReport` / `NodeEnvironmentValidation` 是校验接缝声明的返回类型并经 `apps/vscode-dsh/src/index.ts` 再导出。`HostStartError` / `HostStartErrorKind` 被抛出、断言并再导出。

---

## 4. 跨模块契约一致性

| 模块之间 | 调用方期望 | 被调用方实际 | 一致？ |
|---|---|---|:--:|
| `auto-start-orchestrator` ← `session-host` | `kind` 取自 orchestrator 自己的词表 | `HostStartErrorKind = StartErrorKind`（类型别名，非副本）；通用兜底抛 `process-failed` | ✅ |
| `session-host` → `HarnessClient` | `nodeExecutable?: ResolvedNodeExecutable` | `HarnessClientOptions.nodeExecutable`（`types.ts:61`）透传给 `resolveDshLaunch` | ✅ |
| `session-host` → `node-env-guard` | 被前置校验的对象就是被 spawn 的对象 | `assertNodeExecutable(executable)` 接收同一引用；探测使用 `executable.electronRunAsNode` | ✅ |
| `node-env-guard` → `dsh-sdk-client` | 使用 SDK 的 `NodeExecutableSource` 联合 | `packages/sdk/client/src/types.ts:36,43,61` —— 诊断里用的联合就是解析器的联合 | ✅ |
| manifest 键 ↔ 运行时读取 | `contributes.configuration.properties` 的键 == 扩展读取的键 | `NODE_BIN_SETTING = 'dsh.nodeBin'`，且 `properties[NODE_BIN_SETTING]` 是针对真实 `apps/vscode-dsh/package.json` 断言（`node-env-guard.spec.ts:167-176`，缺失即抛错） | ✅ |
| manifest 默认值 ↔ 解析语义 | 声明的默认 `""` 应当表示「不参与解析」 | `readNodeBinSetting` 原样返回 `""`；`resolveNodeExecutableSpec` 视 `''` 为未设置（`:137`）→ 落到第 3 级 | ✅ |
| 探测环境 ↔ spawn 环境 | 同一调用模式 | 两者都只在 `electronRunAsNode` 为真时注入 `ELECTRON_RUN_AS_NODE=1` | ✅ |
| 文档 ↔ 解析顺序 | 文档写明 `DSH_NODE_BIN` > `dsh.nodeBin` > 扩展宿主 Node，且绝不查 `PATH` | `launch.ts:122-127` 文档与 `:133-143` 代码；`docs/development.md:107` 与 `.zh.md:112` | ✅ |

仓库**不存在**校验 `contributes.configuration` 的门禁（用户已指出），因此 manifest 与代码的键耦合完全依赖 `nodeBinProperty()` 读取真实 manifest 并用运行时同一个常量查表。断言落在正确的位置，而且它确实存在。

---

## 5. 跨 Phase 依赖检查

| 本 Phase 的依赖/义务 | Phase | 接口状态 | 连通 |
|---|---|:--:|:--:|
| 未归类失败应得到 `errorKind === 'process-failed'`（Phase 2 spec 的边界清单） | Phase 2 | `process-failed` 作为唯一有记录的兜底被保留（`auto-start-orchestrator.ts:47-55`） | ✅ |
| Phase 2 的记录词表保留它自己的 `'other'` 类 | Phase 2 | `'other'` 已从**本** app 的 `StartErrorKind` 移除（§5.13），且据我的 grep 在此处无任何消费者 —— 两个词表仍是两个 Phase 里的两个类型 | ✅ |
| Phase 2 的诊断 sink 挂在已声明的表面上 | Phase 2 | §5.12 点名三处；(I)(II) 是活的，(III)（`HostStartError.diagnostic`）是带理由的预留 | ✅ |
| AC-10(f) —— 真实 Extension Development Host 消费预置 `settings.json` | Phase 3 | Phase 1 只主张 (a)–(e)，不主张该分支；Phase 3 的前置条件是真问题，因为第 1 级压过设置项（探针 B），且 Phase 3 的 AD-11 要求显式清除继承的 `DSH_NODE_BIN` | ✅ |
| 解析链第二段所用的 SDK 表面 | `packages/sdk/client` | `resolveNodeExecutableSpec` / `ResolvedNodeExecutable` / `NodeExecutableSource` 均为增量；未移除任何已发布名字（`resolveNodeExecutable` 在 HEAD 时是私有的） | ✅ |

---

## 6. 发现

### 🟢 O-1 —— 非字符串 `dsh.nodeBin` 分支沿用通用归类（Observation，建议路由给 Phase 2）

`extension.ts:2183-2187` 对非字符串设置抛出普通 `Error`。该抛出发生在 `:2253`，即 `createStartHostPort().start()` 内部，因此在 `auto-start-orchestrator.ts:217` 被捕获，并由 `:47-55` 归类为 `process-failed` —— 而**同一来源**的路径失败被归类为 `node-environment`。`node-env-guard.spec.ts:673-686` 断言了消息（含 `dsh.nodeBin` 与 `string`），但没有断言 `errorKind`。

**为何这不驱动连通性判决**：数据路径是完整的 —— 消息经由同一个快照跳抵达同一个可见表面 —— 且没有任何 AC 枚举类型错误的归类；而需要一个「配置错误」成员的记录词表属于 Phase 2（§5.12）。建议（二选一）：让 `readNodeBinSetting` 传出 `kind`，使归类可以同行；或在 §5 记录该选择，交由 Phase 2 分配成员。严重度：策略层面的 should-fix，无路径断裂。

### 🟢 O-2 —— `HostStartError.diagnostic` 被写入而 Phase 1 内无读取者

由 `grep -rn "\.diagnostic\b" apps/vscode-dsh/src` 确认（仅声明与赋值）。这正是 `spec.md:133` 为 Phase 2 预留的表面，且 §5.12 现已带 file/line 与理由记录它（记录器读 `error.diagnostic`，而非重新解析文案）。它不是无人认领的数据黑洞：预留被写下来了，而这恰是第 1 轮 S-2 所求。

### 🟢 O-3 —— 直接的 SDK 消费者不能传设置项名，必须先解析

`HarnessClientOptions` 暴露 `nodeExecutable` 但没有 `nodeBinSetting`，且 `resolveDshLaunch`（`launch.ts:177`）以空 request 调用 `resolveNodeExecutableSpec()`。因此第 2 级只能通过 `types.ts:26-28` 与 `README.md` 记录的「两步走」抵达：先解析，再传对象。这保持了 AD-1 的「一次解析，被校验对象即被 spawn 对象」不变量，且不存在会静默误解析的部分输入 —— 消费者要么给出已解析对象，要么得到第 1/3 级。此处记录，以免后续嵌入方意外。

### 🟢 O-4 —— 三处工作区改动不属于任何 Phase，必须排除在 Phase 提交之外

`pnpm-lock.yaml` 与 `apps/vscode-dsh/webview/dist/assets/index.{js,css}` 在工作区中是修改状态，但都早于本 Phase：`stat -c '%y'` 给出 `pnpm-lock.yaml → 2026-09-14 16:08:25`、`webview/dist/assets/index.js → 2026-09-14 09:21:32`，而 `node-env-guard.ts → 2026-09-15 18:27:43`。§2.3 与 §6.6 已声明并要求排除。由于 HG-3 提交必须显式列举文件而非 `git add -A`，这就是需要盯住的清单。

---

## 7. 证据（本审查者实际执行的命令）

| 命令 | 结果 |
|---|---|
| `git branch --show-current` | `impl-phase-1-node-env-preflight` |
| `pnpm --config.verify-deps-before-run=false run typecheck` | exit 0（基线绿，仍绿） |
| `pnpm --config.verify-deps-before-run=false run test packages/sdk/client` | `Test Files 3 passed (3)`、`Tests 84 passed (84)`，exit 0 |
| `pnpm --config.verify-deps-before-run=false run test apps/vscode-dsh` | `Test Files 4 failed \| 46 passed (50)`、`Tests 6 failed \| 350 passed \| 1 skipped (357)`，exit 1。失败文件：`spike-t0a-replay-rebuild.spec.ts`（4 用例）、`spike-t0b-continue-capability.spec.ts`（整 suite）、`panel-close-delete.e2e.spec.ts`（1）、`verifier-phase1/layer-a-rtl.spec.tsx`（1）→ 与基线**集合与数量完全一致**，根因不变（`scripts/test-invariants.ts:88` / `:188`）。无新增失败。 |
| `pnpm --config.verify-deps-before-run=false run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | `Test Files 4 passed (4)`、`Tests 69 passed (69)`，exit 0 |
| `pnpm --config.verify-deps-before-run=false run test:docs` | `run-gates: 10 passed, 5 failed, 0 skipped` —— 与基线同五个失败门禁；对输出执行 `grep -c "development\.md\|development\.zh\.md"` = **0** |
| `pnpm --config.verify-deps-before-run=false run lint` | exit 1（基线本就红）。逐文件：新文件 **0**；`extension.ts` 22；`session-host.ts` 1（`:595`）；`auto-start-orchestrator.ts` 1（`:230`）；`index.ts` 1（`:97`）—— 全部落在本 Phase 插入行区间之外（§1 S3）。 |
| `./node_modules/.bin/tsx /tmp/dsh-conn-probe2/probe.mts`（仓库之外的独立 harness，已获用户批准） | 探针 A–G，输出见 §2；exit 0 |
| `grep -rn "DSH_NODE_BIN" --include=*.ts packages/sdk/client/src apps/vscode-dsh/src` | 只有一个读取点（`launch.ts:132`）加常量/诊断文本 → 确认唯一解析入口 |
| `grep -rn "ELECTRON_RUN_AS_NODE" --include=*.ts …/src` | 恰好两个写入点，双方都以 `electronRunAsNode` 为条件（`launch.ts:181`、`node-env-guard.ts:258`） |
| `git diff -U0 -- apps/vscode-dsh/src/{session-host.ts,auto-start-orchestrator.ts,index.ts} \| grep -E "^@@"` | 插入区间：`session-host.ts` {14,16,27,29,42-79,106-109,253-254,285-290,300,321-327}、`auto-start-orchestrator.ts` {26-55,220}、`index.ts` {25-39} —— 用于把 lint 发现定位到插入行之外 |

## 8. 给调度者的摘要

* 被要求的连通性（设置项 → 解析 → 前置校验 → spawn；前置校验失败 → 脱敏文案 → 类型化归类 → 快照 → VS Code 表面）**端到端连通**，依据是代码追踪、仓库自身的运行时用例，以及一个仓库之外的独立探针（它复现了层级顺序、`PATH` 回退的缺席、探测与 spawn 模式的一致，以及 `node-environment` 跨越 orchestrator 一跳后依然存活）。
* 差量验收成立：`typecheck` 绿、`packages/sdk/client` 绿（84 用例）、app suite 红集合与基线一致（4 文件 / 6 用例）、`test:docs` 计数一致、lint 红但本 Phase 新增行上零诊断。
* 对第 1 轮 13 条发现的第 2 轮判定：**全部已修复**；implementer 自报的 3 处偏差**成立**。
* 值得路由的 1 条 Observation（`🟢 O-1` 非字符串设置沿用通用归类）与 3 条卫生类 Observation（`🟢 O-2` 预留的 Phase 2 表面、`O-3` SDK 两步走、`O-4` 提交时排除非本 Phase 产物）。
