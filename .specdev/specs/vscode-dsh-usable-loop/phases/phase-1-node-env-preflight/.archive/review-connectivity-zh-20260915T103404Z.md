# 连通性审查 — Phase 1（`phase-1-node-env-preflight`）

- **角色**：`reviewer-connectivity`（三视角并行审查之一）。
- **范围**：只审集成连通性 —— 各部分是否真的连起来、数据是否端到端流动。实现内部正确性归 `reviewer-correctness`、设计一致性归 `reviewer-design`，本文不评。
- **仓库**：`/workspace/chendecheng/code/need/deepseek/deepseek-harness`，分支 `impl-phase-1-node-env-preflight`（只读审查；未修改任何代码、未改 spec 状态、未动 git）。

## 判决

**SHOULD-FIX**

本 Phase 追踪到的每一条端到端链路**当前都是连通的**：AD-1 同一性不变量成立（门槛校验的对象就是交给 `spawn()` 的同一个对象）、设置来源**没有**被误注入 `ELECTRON_RUN_AS_NODE`、第 3 级 Electron 分支的 flag **确实**进入了真实 spawn 的 `env`、门槛失败**确实**到达用户可见的诊断出口、node 门槛**确实**排在 `bridge.listen` 之前。没有断链，因此没有 MUST-FIX。

但有 3 处连接是靠**约定**而非代码保证的：

- **S-1** 门槛探测在运行第 3 级 Electron 可执行文件时**没有**施加同一个 `ResolvedNodeExecutable` 为 spawn 声明的 `ELECTRON_RUN_AS_NODE` 模式。已实测复现（下文探针 F）：父进程未继承该 flag 时判为 `unusable`；真机上之所以通过，只因 VS Code 的 Extension Host 恰好导出了该 flag。
- **S-2** `HostStartError.kind` / `.diagnostic` 被写入，但 Phase 1 内**无任何消费者**；且 `spec.md:133` 声称在 `extension.ts`「为 Phase 2 预留诊断注入点」，而 `implementation.md` 完全未记录。
- **S-3** `AutoStartOrchestrator` 把所有启动失败**压平**为 `process-failed`（`auto-start-orchestrator.ts:192-196`），`node-environment` 这一机器可读类别在 Host 之下再走一跳就丢失。

判决依据：路径完整、连接可优化 → SHOULD-FIX（不判 PASS，因为「靠隐式假设的连接不得算 PASS」；不判 MUST-FIX，因为没有断链、也没有违反任何验收标准 —— AC-5 / AC-6 / AC-10 钉的是 `resolveDshLaunch().environment()`，不是探测进程的 env，见 `spec.md:47-49,53`）。

## 端到端链路追踪

### 链路 1 — VS Code 设置 → 真实 `spawn()`

| # | 环节 | `file:line` | 是否连通 | 备注 |
|---|------|-------------|:--:|------|
| 1 | `dsh.nodeBin` 声明（`string`、默认 `""`、描述写明优先级与"留空"） | `apps/vscode-dsh/package.json:60-66` | ✅ | 满足 AC-10(a)；`settings.json` 里的值因此会被 VS Code 接受并进入 `getConfiguration` |
| 2 | 扩展读取设置 | `apps/vscode-dsh/src/extension.ts:2179-2189`（`readNodeBinSetting`） | ✅ | `workspace.getConfiguration?.('dsh')` → `.get?.('nodeBin')`；`undefined`/`null` → `undefined`；非字符串抛错（fail loud，无默认值） |
| 3 | 每次 start 重新读取并交给 Host | `extension.ts:2253-2256` | ✅ | 读取发生在启动路径内（无跨 start 缓存，满足 AC-9/AD-10）；仅在定义时展开 `{ nodeBinSetting }` |
| 4 | Host 解析 + 门槛 | `apps/vscode-dsh/src/session-host.ts:282-285` | ✅ | `resolveNodeExecutableSpec({nodeBinSetting})` 后 `assertNodeExecutable(同一绑定)` |
| 5 | 解析（第 2 级） | `packages/sdk/client/src/launch.ts:136-139` | ✅ | 设置项 `trim()` 后非空 → `{path: setting, source:'vscode-setting', electronRunAsNode:false}` |
| 6 | 门槛消费该对象 | `apps/vscode-dsh/src/node-env-guard.ts:155-158` → `115-147` | ✅ | `NodeEnvironmentFailure.source` = `executable.source`（`node-env-guard.ts:118-122`）—— Phase 3 要断言的字段级证据就在这里 |
| 7 | 同一对象交给 client | `session-host.ts:292-301`（字段在 `:295`） | ✅ | `nodeExecutable` 与 `:285` 校验的是同一个绑定 |
| 8 | launch 消费它、不再重新解析 | `launch.ts:164-192`（消费点 `:177`，command 在 `:184`） | ✅ | `options.nodeExecutable ?? resolveNodeExecutableSpec()` —— 本路径不会走 fallback |
| 9 | 真实 spawn | `packages/sdk/client/src/client.ts:214-218`（`command`/`args`/`env: this.runtime.environment()`） | ✅ | `args` 含 `--profile ide`（`launch.ts:185`）；`environment()` 是在 spawn 站点被调用的，flag 在那里才真正落地 |

**AD-1 不变量 —— 门槛校验的对象与最终 spawn 的对象是否同一个？** 是。
- 同一性：`session-host.ts:282` 绑定唯一的 `const nodeExecutable`；`:285` 校验该绑定；`:295` 转发该绑定。没有拷贝、没有重新推导。
- `launch.ts:177` 只在 `options.nodeExecutable` **缺失**时才解析；IDE 路径上它总是存在。
- **本路径上没有任何一环重新读取环境变量或重新解析。** 已用自研探针实测（下文"独立验证"的 D/E）：在 `DSH_NODE_BIN=/frozen/node` 时解析，随后删掉该环境变量，再用保留的对象调用 `resolveDshLaunch` → `command` 仍是 `/frozen/node`（若实现重新解析，会得到 `process.execPath`）。反向对照：不传对象调用 `resolveDshLaunch` 得到 `/late/node`，说明 fallback 确实存在，且只对直接使用 SDK 的调用方诚实可达。
- 集成测试在失败路径上断言了同一性质：`apps/vscode-dsh/tests/session-host-preflight.spec.ts:163` 对 `resolveNodeExecutableSpec` 打点并断言恰好调用一次、不二次取其他来源（用例见 `:155`、`:204`）。

### 链路 2 — `DSH_NODE_BIN`（第 1 级）→ spawn

| # | 环节 | `file:line` | 是否连通 | 备注 |
|---|------|-------------|:--:|------|
| 1 | 读取**父进程** Extension Host 环境 | `launch.ts:132`（`process.env.DSH_NODE_BIN`） | ✅ | 在解析方进程内读取；解析发生在 Extension Host 内（`session-host.ts:282`），**不是**在子进程内 —— 两者没有混淆 |
| 2 | 非空即第 1 级胜出 | `launch.ts:133-134` | ✅ | 优先级压过设置项已实测（即便 `nodeBinSetting=/setting/node` 仍返回 `{"path":"/env/node","source":"dsh-node-bin","electronRunAsNode":false}`），并由 `launch.spec.ts` AC-5(b) 覆盖 |
| 3 | `electronRunAsNode:false` → 不注入 flag | `launch.ts:180-182` | ✅ | 实测：在 `process.versions.electron` 已定义时，环境变量来源的 launch `environment().ELECTRON_RUN_AS_NODE === undefined`（AC-5(a)） |
| 4 | 子进程 env 清洗 | `apps/vscode-dsh/src/env.ts:30-39` + `packages/subprocess/subprocess/src/index.ts:64-68` | ✅ | `scrubbedParentEnv()` 剔除 `DSH_*` 与敏感名 —— **对本链路无影响**：第 1 级读的是解析时刻的**父进程** env（`launch.ts:132`），清洗只决定已经解析完的 `dsh` 子进程看到什么。解析结果以对象（`nodeExecutable`）形式传递，不是以"再读一次变量"的形式 |

### 链路 3 — Electron 第 3 级（`process.execPath` + `ELECTRON_RUN_AS_NODE`）

| # | 环节 | `file:line` | 是否连通 | 备注 |
|---|------|-------------|:--:|------|
| 1 | 选中第 3 级并声明模式 | `launch.ts:140-144` | ✅ | `{path: process.execPath, source:'process-exec-path', electronRunAsNode: process.versions.electron !== undefined}` |
| 2 | launch 注入 flag | `launch.ts:180-182`，在 `:190` 展开 | ✅ | `{ELECTRON_RUN_AS_NODE:'1'}` 在 `options.env` **之后**展开，因此能压过被清洗过的继承 env |
| 3 | flag 进入真实 spawn 的 `env` | `client.ts:216`（`env: this.runtime.environment()`） | ✅ | 追踪到真实 `spawn()` 调用点，而非只看闭包的返回值 |
| 4 | 第二条独立通路 | `env.ts:32` → `subprocess/src/index.ts:67` | ✅ | 清洗只剔除敏感名与 `DSH_*`，`ELECTRON_RUN_AS_NODE` 也能原样留在 `buildIdeChildEnv` 里 —— 两条独立通路，spawn env 不可能丢掉这个 flag |
| 5 | 实测（第 3 级） | 自研探针 C | ✅ | `commandIsExecPath:true`、`electronEnv:'1'` |
| 6 | 实测（第 2 级 —— **本 Phase 最易断的一环**） | 自研探针 A | ✅ | `{"command":"/setting/node"}` 且序列化 env 中**没有** `ELECTRON_RUN_AS_NODE` 键 —— 设置来源未被误注入；原先 `launch.ts` 两处重复的 `DSH_NODE_BIN` 判空已不再渗入设置分支 |
| 7 | 实测（第 1 级） | 自研探针 B | ✅ | `{"command":"/env/node"}`，无 flag |
| 8 | 门槛探测的 env | `apps/vscode-dsh/src/node-env-guard.ts:253-256` | 🟡 | `execFileAsync(path, ['-e', PROBE_SOURCE], {timeout, windowsHide})` **不传 `env`** → 探测继承原始 `process.env`，从不施加 `executable.electronRunAsNode`（S-1） |
| 9 | 实测（第 3 级下的门槛） | 自研探针 F | 🟡 | `{electronRunAsNode:true}` 且父 env 无该 flag → `unusable`；有该 flag → `ok`。即门槛只在模式被"顺带继承"时才能校验 Electron 可执行文件 |

### 链路 4 — 门槛失败 → 用户可见诊断

| # | 环节 | `file:line` | 是否连通 | 备注 |
|---|------|-------------|:--:|------|
| 1 | 门槛抛错 | `node-env-guard.ts:155-158`（`NodeEnvironmentError`） | ✅ | 携带五要素（`:167-176`） |
| 2 | Host 捕获、归类、脱敏 | `session-host.ts:311-322` | ✅ | `status='error'`（`:312`）、`errorMessage=redactSecrets(五要素文本)`（`:314`）、`shutdownInternal`（`:315`）、随后 `HostStartError('node-environment', …, {diagnostic: error.failure})`（`:317-320`） |
| 3 | 既有类别未被吞 | `session-host.ts:322` | ✅ | 非 `NodeEnvironmentError` → `HostStartError('start-failed')`；偏差 #7 没有吞掉原有的 `start-failed` 归类 |
| 4 | 编排器快照 | `apps/vscode-dsh/src/auto-start-orchestrator.ts:189-197` | ✅ | `state='failed'`、`errorMessage=error.message`（五要素文本存活） |
| 5 | ……但类别被压平 | `auto-start-orchestrator.ts:192-196`，类型在 `:27` | 🟡 | 凡不是 `missing-credentials` 的错误都变成 `process-failed`；`node-environment` 在 `StartErrorKind` 里无法表达（S-3） |
| 6 | UI 状态 | `apps/vscode-dsh/src/connection-ui.ts:141-160`（`message` 在 `:147`）、`shouldShowStatusBar` 在 `:163-170` | ✅ | `failed` → 面板可见时以面板为主，否则用状态栏 —— 至少有一个载体一定展示该消息 |
| 7 | 面板载体 | `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:282-284`（`pushBanner(state.message, 'failed')`） | ✅ | 横幅正文就是该消息 |
| 8 | 次级载体**未**被触发 | `extension.ts:2238-2239`（`next.onError` → `showErrorMessage`） | ⚠️ | 门槛失败不会产生 `HarnessClient`，因此没有 `errorListeners` 触发。当前正确，因为 ConnectionUi 是指定的主载体；见隐式假设 I-7 |
| 9 | 全链路的端到端测试 | `apps/vscode-dsh/tests/node-env-guard.spec.ts:500-519` | ✅ | 磁盘上真实 `settings.json` → 真实 `activate` → 真实 `IdeSessionHost.start`（未被 mock）→ `dsh.test.requestStart` → `snapshot.state==='failed'`、`errorMessage` 同时含缺失路径**与** `dsh.nodeBin`；事后设置文件逐字节不变（无静默回退的代理证据） |

### 链路 5 — AC-7 顺序契约（node 门槛 → `bridge.listen` → spawn）

| # | 环节 | `file:line` | 是否连通 | 备注 |
|---|------|-------------|:--:|------|
| 1 | 状态/字段记账 | `session-host.ts:253-266` | ⚠️ | 门槛前确有写入：`status='starting'`（`:256`）与 `bridgePath`（`:266`）。它们不是 spawn/socket 副作用；唯一可观察效果是阶段为 `starting` 的状态通知 |
| 2 | bridge 构造 + 注册处理器 | `session-host.ts:267-278` | ⚠️ | 构造与注册在门槛之前，但两者都不创建 socket —— socket 是在 `listen()` 里创建的 |
| 3 | 门槛 | `session-host.ts:285` | ✅ | `await assertNodeExecutable(nodeExecutable)` |
| 4 | 创建 socket | `session-host.ts:286` | ✅ | `await bridge.listen(bridgePath)` —— 严格在门槛之后 |
| 5 | spawn | `session-host.ts:292-303` → `client.ts:214` | ✅ | 严格在两者之后 |
| 6 | AC-7(ii) 证据 | `session-host-preflight.spec.ts` | ✅ | 门槛失败 → `existsSync(bridgeSockPath) === false` 且无 witness 文件；`status === 'error'`；耗时远低于握手超时（AC-7(iv)） |
| 7 | 失败即收口 | `session-host.ts:315` → `shutdownInternal` | ✅ | 失败时关闭 bridge；测试的"socket 不存在"断言确认没有残留 socket |

**我没有发现门槛之前除 `status='starting'` 与对象构造之外的任何副作用**；特别是门槛之前的路径没有任何一处会触达 `IdeBridgeHostServer.listen()`，因此 AC-7(ii) 不是空条款。

### 链路 6 — 测试到底覆盖了链路，还是只测孤立单元？

| 问题 | 证据 | 结论 |
|---|---|:--:|
| 是否用真实子进程而非 mock？ | `session-host-preflight.spec.ts:7-10,40-62` —— `dshBin` 指向一个会 `writeFileSync(...)` 的 witness `.cjs`，测试读取该文件 | ✅ 真实 |
| 是整条链（设置 → 门槛 → 不 spawn）还是只测 `node-env-guard`？ | `:124`（缺 API）、`:155`（设置来源，含 `resolveNodeExecutableSpec` 调用计数）、`:204`（设置指向缺失路径）、`:237`（环境变量来源）、`:263/:284`（各来源的正向 spawn）、`:305`（环境变量压过设置）—— 全部经真实 `IdeSessionHost.start()` | ✅ 端到端 |
| 正向对照（证明真 spawn 时 witness 会写）？ | `:263/:284` 断言 `witness.execPath === process.execPath`，即 start 成功时 witness **确实**被写 | ✅ |
| 是否消费真实 `settings.json`？ | `node-env-guard.spec.ts:434-436,500-519` | ✅ |
| 一审结果（本人执行） | `pnpm run test apps/vscode-dsh/tests/session-host-preflight.spec.ts` → **1 文件 / 7 用例通过**；`pnpm run typecheck` → exit 0 | ✅ |

## Must-Fix

无。未发现断链、契约不一致、被改动的冻结接口，也未发现跨 Phase 回归。

## Should-Fix

**🟡 S-1 —— 门槛探测没有施加"已解析对象所声明的调用模式"。**
`apps/vscode-dsh/src/node-env-guard.ts:253-256` 以 `{timeout, windowsHide}` 运行候选、不传 `env`；而 `launch.ts:180-190` 在 `electronRunAsNode` 为真时用 `ELECTRON_RUN_AS_NODE=1` spawn 同一个对象。探针 F 复现了该分歧：只有带 flag 才表现为 Node 的候选，在父 env 无该 flag 时返回 `failure.kind === 'unusable'`，有该 flag 时 `ok`。真机 VS Code 上该 flag **是**存在的 —— `/usr/share/code/resources/app/out/vs/workbench/api/node/extensionHostProcess.js` 在进程启动补丁里设置 `process.env.ELECTRON_RUN_AS_NODE="1"`（与 `process.crash = …` 同一语句块），因此真实 Extension Host、它的探测子进程与被 spawn 的子进程都会继承。影响因此有限，且失败方向是 fail-loud（拒绝启动）而非"跑起来但坏掉"。建议方向：给探测传 `env: {...process.env, ...executable.electronRunAsNode ? {ELECTRON_RUN_AS_NODE:'1'} : {}}`，让校验与 spawn 处于同一模式。范围说明：AC-5 / AC-6 / AC-10 检查的是 launch 的 environment 而非探测进程 env（`spec.md:47-49,53`），所以这不是 MUST-FIX。

**🟡 S-2 —— 声称的 Phase 2 注入点未被记录，且 `HostStartError.diagnostic` 在 Phase 1 内无消费者。**
`spec.md:133` 称 `extension.ts` 被修改以「为 Phase 2 预留诊断注入点」，但 `implementation.md` / `implementation-zh.md` 全文未提及 Phase 2（已检索确认）。实际注入面确实存在且已导出（`apps/vscode-dsh/src/index.ts:25`、`session-host.ts:46,52-70`、`:317-320`），且错误对象在消费点 `auto-start-orchestrator.ts:189-197` 就在作用域内，因此 Phase 2 无需新增管道即可接上。缺的只是可追溯性：把该交接写清，并承认 `kind`/`diagnostic` 在 Phase 1 内属"先写、后 Phase 读"（不是数据黑洞 —— 用户可见消息已经走 `errorMessage` 通了）。建议方向：在 `implementation.md` §4/§5（若 registry 是约定载体则同步 `tech-debt-registry.md`）补上 Phase 2 交接说明。

**🟡 S-3 —— 机器可读类别活不过编排器这一跳。**
`auto-start-orchestrator.ts:27` 定义 `StartErrorKind = 'missing-credentials' | 'process-failed' | 'other'`，`:192-196` 把除 `missing-credentials` 之外的一切映射为 `process-failed`。因此 `HostStartError.kind === 'node-environment'`（`session-host.ts:317`）只在 `runStart` 的 catch 内可读。任何基于快照构建的 Phase 2 诊断记录，都必须要么拓宽该类型，要么去读原始错误。建议方向：让 catch 把 `HostStartError.kind`（与 `diagnostic`）带进快照，而不是压平成 `process-failed`。

## 隐式假设清单

| # | 假设 | 依赖位置 | 为什么重要 |
|---|------|---------|-----------|
| I-1 | Extension Host 进程环境中存在 `ELECTRON_RUN_AS_NODE=1` | `node-env-guard.ts:253`（探测） | 第 3 级门槛仅靠"继承"通过（S-1，探针 F）。已在已安装的 VS Code 构建中静态核实；未在真实 Extension Development Host 中运行时核实 |
| I-2 | 第 1/2 级指定的 Node 路径**不带**该 flag 也能作为 Node 运行 | `launch.ts:134,138,180-182` | 这是设计意图（JSDoc `launch.ts:126-127`）：若把 `dsh.nodeBin` 指向 Electron 二进制本身，会被无 flag 探测并无 flag spawn，从而 fail loud —— 属可接受的失败模式，不是静默失败 |
| I-3 | 已解析出可执行文件的调用方一定会转发它 | `session-host.ts:282-295`；fallback 在 `launch.ts:177` | AD-1 之所以成立，只因 Host 绑定并转发同一个对象。若某调用方传了 `nodeBinSetting` 却漏传 `nodeExecutable`，就会按当前环境静默重新解析。当前仓库中不存在这样的调用方（只有 `session-host.ts` 与 SDK 自身默认路径） |
| I-4 | 构造 bridge 与注册处理器无副作用 | `session-host.ts:267-278` | AC-7(ii) 依赖"socket 只在 `listen()`（`:286`）内创建"；已由"socket 不存在"断言验证 |
| I-5 | 纯空白值在两个来源上的行为不同（设计如此） | `launch.ts:133`（`!== ''`）vs `:137`（`.trim() !== ''`） | `DSH_NODE_BIN=' '` 被视为**已设置**并在门槛处 fail loud；`dsh.nodeBin=' '` 被视为**未设置**并落到第 3 级。两个方向都是"fail loud 或已文档化"；记录在此是因为该不对称在调用点不可见 |
| I-6 | "spawn 计数 0"指的是 `dsh` 运行时子进程，而非"任何子进程" | `session-host-preflight.spec.ts:40-62` | 门槛自身的探测是候选解释器的一个子进程（AC-4(c) 里的旧版候选在被拒绝之前**确实被执行过**）。witness 文件技术把观测正确地限定在 `dsh` 子进程上；未来若有驱动断言"完全没有子进程"，那是错的 |
| I-7 | 对门槛失败而言，ConnectionUi 是主诊断载体 | `extension.ts:2238-2239` 对比 `connection-ui.ts:147` | `next.onError` 在门槛失败时不会触发（无 client ⇒ 无 error listener）。ConnectionUi 的两个载体必有一个在显示，消息不会丢；但若将来把失败展示改成只依赖 `onError`，该消息就会消失 |
| I-8 | 脱敏不会抹掉诊断文本 | `session-host.ts:314` | AC-8 断言读取脱敏后的 `host.errorMessage` 并匹配路径、期望范围与 API 名；AC-8 用例通过，说明脱敏后五要素完整 |

## 跨 Phase 接口面

**Phase 2（诊断 fail-loud）—— 能否不改本 Phase 接口就接上？**
Phase 2 所需输入已导出且为增量式：`HostStartError` + `HostStartErrorKind`（`index.ts:25`）、带 `source`/`sourceLabel`/`executablePath`/`kind`/`missingApis` 的 `diagnostic: NodeEnvironmentFailure`（`session-host.ts:56`、`:317-320`、`node-env-guard.ts:118-122`）、以及 guard 自身的导出（`index.ts:26-39`）。原始错误对象在消费点（`auto-start-orchestrator.ts:189-197`）就在作用域内，Phase 2 可在此读取 `kind`/`diagnostic`，无需 Phase 1 新增管道。Phase 2 必然需要**拓宽**的是 `StartErrorKind`（`:27`）与 guard 的失败类别词汇表 —— 两者都写在其自身 spec 范围内，且该 spec 明确声明会修改 `session-host.ts` 与 `auto-start-orchestrator.ts`；这属于增量拓宽，不是"破坏已被其他 Phase 依赖的 Phase 1 接口"。唯一缺口是文档（S-2）：`spec.md:133` 的"为 Phase 2 预留诊断注入点"在 `implementation.md` 中没有对应记录。

**Phase 3（真机冒烟）—— 能否不改本 Phase 接口就接上？**
可以。Phase 3 的字段级断言（`source === 'vscode-setting'`、`resolvedExecutable` 等于预置路径）需要：(i) 暴露来源的唯一解析入口 —— `resolveNodeExecutableSpec`（`launch.ts:131-145`）与 `packages/sdk/client/src/types.ts` 中的 `NodeExecutableSource`；(ii) 真实的 `settings.json` → `dsh.nodeBin` 消费路径 —— `package.json:60-66` + `extension.ts:2179-2189`；(iii) 观测来源的出口 —— `failure.source`（`node-env-guard.ts:59,119`）经 `HostStartError.diagnostic` 交给 Phase 2 记录。其 AD-11 要求"显式清除继承的 `DSH_NODE_BIN`"，正是本次审查已实测确认的优先级（第 1 级压过设置项 —— 探针 B），因此 Phase 3 的前置条件是真问题而非假设。

**AC-10(f) 分工 —— 三份文档是否一致？**
一致且表述相同：`spec.md:102`（Phase 1 只判 (a)–(e)；真机分支由 Phase 3 提供；必须原文写入 `verification.md`；该分支失败则整条 AC 不成立）、`implementation.md:68` 与 `:163`、以及 Phase 3 侧 `phases/phase-3-layer-v-smoke-loop/spec.md:9` 与 `:195`（"补充证据（非二次归属）"，AC-10 归属 Phase 1）。归属与"失败即整条不成立"的规则都没有矛盾。

## 未验证项

- **UNVERIFIED（运行时）**：真实 Electron Extension Host 确实向扩展导出 `ELECTRON_RUN_AS_NODE=1`。证据是静态的（`/usr/share/code/resources/app/out/vs/workbench/api/node/extensionHostProcess.js` 中 Extension Host 进程启动补丁里的 `process.env.ELECTRON_RUN_AS_NODE="1"` 赋值）。本次审查未启动 Extension Development Host —— 那是 Phase 3 的义务。
- **UNVERIFIED**：S-1 在真机上的实际影响（没有任何测试覆盖 Electron 下探测进程的 env；本 Phase 的 AC 针对的是 `resolveDshLaunch().environment()`）。
- **UNVERIFIED**：用户 `settings.json` 中 `dsh.nodeBin` 的值（`scope: machine-overridable`）经 VS Code 优先级链后是否原样到达 `getConfiguration('dsh')`；本次只检视了测试替身与声明本身。
- **未执行（超出本次要求范围）**：`pnpm run test:coverage`、`pnpm run lint`、doc-sync 门禁，以及 `apps/vscode-dsh` + `packages/sdk/client` 之外的 e2e/snapshot 套件。

## 验证命令与结果（本人执行）

| 命令 | 结果 |
|---|---|
| `pnpm run test apps/vscode-dsh/tests/session-host-preflight.spec.ts` | **1 文件 / 7 用例通过** |
| `pnpm run test apps/vscode-dsh packages/sdk/client` | 4 文件 / 6 用例红：`panel-close-delete.e2e.spec.ts`（4 中 1）、`spike-t0a-replay-rebuild.spec.ts`（4 中 4）、`spike-t0b-continue-capability.spec.ts`（收集期报错，0 用例）、`verifier-phase1/layer-a-rtl.spec.tsx`（7 中 1）。观察到的成因：`TypeError: Cannot read properties of undefined (reading 'UNLOADING')`、`expected true to be false`、`expected '' to contain '--dsh-chrome-height'` —— 均不在 Node 解析或 launch 链路上 ⇒ 与声明基线同根因，Phase 1 未引入新失败 |
| `pnpm run typecheck` | exit 0 |
| 自研探针：`tsx /tmp/dsh-conn-probe/probe.mts`（写在仓库之外，未触碰任何仓库文件） | A：设置 + Electron ⇒ `command=/setting/node`、无 `ELECTRON_RUN_AS_NODE`。B：env + 设置 + Electron ⇒ `/env/node`、无 flag。C：第 3 级 ⇒ `commandIsExecPath:true`、flag 为 `'1'`。D：在 `/frozen/node` 下解析、删掉环境变量后 launch 保留对象 ⇒ `stillFrozen:true`（未重新解析）。E：不传对象 launch ⇒ `/late/node`（fallback 存在，仅直接 SDK 调用方可达）。F：`electronRunAsNode:true` 的门槛 ⇒ 无继承 flag 时 `unusable`，有则 `ok` |
