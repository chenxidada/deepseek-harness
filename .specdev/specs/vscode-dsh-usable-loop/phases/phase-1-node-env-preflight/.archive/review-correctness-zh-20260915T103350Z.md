# 实现正确性审查 — Phase 1：Node 环境契约、设置面与 spawn 前校验

## 视角

**实现正确性（Implementation Correctness）** — 代码是否真的能工作？函数体、真实子进程行为、验收标准映射、
边界与错误路径、副作用。设计一致性与集成连通性不在本视角内（由并行的 `reviewer-design` /
`reviewer-connectivity` 负责）。

## 判决

**SHOULD-FIX** — AC-1…AC-10 每条都有真实运行时证据，AD-1 不变量（被校验的 `ResolvedNodeExecutable`
对象就是被 spawn 的那个）与 AD-2（门槛按能力判定、版本号仅用于诊断）均成立，也不存在未注册桩；但有两处
不会导致 AC 失败、却会让下一阶段自我误导的缺陷：`spec.md` 的 AC-4(c) 夹具负载与探测器的报告契约不符
（照字面复现会把本已正确的 AC-4(c) 报成失败），以及 `process-exec-path` 来源的修复建议让用户去改
`PATH`——它改不动 `process.execPath`，且与文档中「解析绝不查询 `PATH`」的契约自相矛盾。

启动自清理（第 0 步）：phase 目录下不存在 `review-correctness.md` / `review-correctness-zh.md`，
无需归档。未触碰 `current-status.json`。

## 独立复现结果

所有命令均在 `/workspace/chendecheng/code/need/deepseek/deepseek-harness` 下执行，环境为
`export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"`、
`PNPM="pnpm --config.verify-deps-before-run=false"`。

**（1）本 Phase 聚焦测试 — 与报告一致。**

```
$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts \
  apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts
→ Test Files  3 passed (3)
→      Tests  57 passed (57)
→   Duration  878ms
```

**（2）typecheck — 与报告一致。**

```
$PNPM run typecheck
→ typecheck exit=0
```

**（3）app + SDK 回归 — 与基线快照同身份、同根因。**

```
$PNPM run test apps/vscode-dsh packages/sdk/client
→ Test Files  4 failed | 49 passed (53)
→      Tests  6 failed | 428 passed | 1 skipped (435)
→ exit_code: 1
```

失败用例均与 Node 前置校验无关：`panel-close-delete.e2e.spec.ts`（1）、
`spike-t0a-replay-rebuild.spec.ts`（4：AC-30/47、AC-76、AC-77、AC-80）、
`verifier-phase1/layer-a-rtl.spec.tsx` V-A4（1）；第 4 个失败文件为
`spike-t0b-continue-capability.spec.ts`。失败清单中不出现 `node-env-guard.spec.ts`、
`session-host-preflight.spec.ts` 或 `launch.spec.ts`。这与 `spec.md:80` 的 v8 基线一致
（4 文件 / 6 用例，根因 `scripts/test-invariants.ts:188`），且 `packages/sdk/client` 由 73 用例
增长到 84 用例全绿，与 `implementation.md` 所述相符。

**（4）lint 差量 — 实测，而非推理（见 Should-Fix/Observations 条目 O2）。**

```
$PNPM run lint → exit_code: 1
grep -n 'apps/vscode-dsh/src/extension\.ts:' <lint 输出>  → 3 条命中
   2109:1: error @stylistic(indent): Expected indentation of 8 spaces but found 10.
   2110:1: error @stylistic(indent): Expected indentation of 8 spaces but found 10.
   2111:1: error @stylistic(indent): Expected indentation of 6 spaces but found 8.
grep -n 'node-env-guard' <lint 输出>   → 0 条
grep -n 'session-host\.ts' <lint 输出> → 0 条
grep -n 'packages/sdk/client' <lint 输出> → 仅 1 条 "config file" 信息行
```

`extension.ts:2109-2111` 是 `askAboutSelection` 的 `asRelativePath` 箭头函数体
（实读 `apps/vscode-dsh/src/extension.ts:2103-2111`），即与本次改动无关的既有代码，因 `:48` 新增
import 而下移一行；本次全部改动 hunk（`:48`、`:2179-2188`、`:2253-2256`）内零诊断。

**（5）我自己设计的探测（被审报告中没有该用例，内联执行，全部为真实子进程）：**

```
node --import tsx --input-type=module -e "<probe>"
C1 exit-code-7 -> expect unusable: {"ok":false,"kind":"unusable","detail":"it exited with code 7","missing":[]}
C2 spec.md-literal payload -> spec says missing-apis: {"ok":false,"kind":"unusable","detail":"its output was not a Node.js capability report","missing":[]}
C3 code-contract payload -> expect missing-apis: {"ok":false,"kind":"missing-apis","missing":["zlib.createZstdDecompress","Promise.withResolvers"]}
C4a env="   " -> {"path":"   ","source":"dsh-node-bin","electronRunAsNode":false}
C4b setting="   " -> {"path":"/usr/local/n/versions/node/24.3.0/bin/node","source":"process-exec-path","electronRunAsNode":false}
C4c env="" setting=/y -> {"path":"/y","source":"vscode-setting","electronRunAsNode":false}
```

C1 证明第四类失败 kind 报告的是实测到的缺陷、不编造 API 名。C2 是一条发现（Should-Fix S1）。
C3 证明 AC-4(c) 在代码真正发出的契约下成立。C4 证明 `spec.md:106` 要求的「刻意不对称」——环境变量为
纯空白视为**已设置**、设置项为纯空白视为**未设置**——确实成立，且两者未被写成同一分支。

**（6）Electron 层的机制验证（headless，无 GUI 启动）：**

```
ELECTRON_RUN_AS_NODE=1 /usr/share/code/code -e "console.log(...)"
→ vsCodeNode 22.22.0 electron 39.8.0 zstd function withResolvers function execPath /usr/share/code/code
```

本机自带 VS Code 二进制在该 flag 下确实以 Node 方式运行，并提供两个必需 API——这正是
`probeNodeApis` 的调用形态。该 flag 由 VS Code 扩展宿主自己设置：其源码
`src/vs/workbench/api/node/extensionHostProcess.ts` 的 `patchProcess()` 中有
`process.env['ELECTRON_RUN_AS_NODE'] = '1'`（注释原文："for extensions that use child_process.spawn
with process.execPath and expect to run as node process on the desktop"，引用
https://github.com/microsoft/vscode/issues/151012 ）。因此继承环境的探测在
`process-exec-path` 来源上确实能走到 `ok:true`。

**（7）`pnpm run test:docs`** 已在本次审查会话早前执行：`run-gates: 10 passed, 5 failed`，与 v8 基线
`spec.md:81` 完全一致，且任何违规清单中都没有本 Phase 的文件。重跑被沙箱拦截（见「未验证项」）。

## Must-Fix

无。没有任何 AC 未满足，未发现未注册桩，也未复现出功能回归。

## Should-Fix

**S1 — `spec.md` 的 AC-4(c) 夹具与探测器的报告契约不符；照字面复现会把 AC-4(c) 报成失败。**

* 位置：`.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/spec.md:46`
  （AC-4 验证行 (c) 项）与 `implementation.md` §2 的 AC-4 行。
* 问题：两处都把替身规定为打印
  `{"version":"20.16.0","zstd":false,"withResolvers":false}`。而探测器发出、解析器要求的是
  `hasZstd` / `hasWithResolvers`（`apps/vscode-dsh/src/node-env-guard.ts:99-103`、`:268-274`），
  本 Phase 自己的用例用的也是这两个键（`apps/vscode-dsh/tests/node-env-guard.spec.ts:56-58`、
  `:185-198`）。按 spec 字面负载运行时，`isNodeEnvironmentReport` 返回 false，结果为
  `unusable` 而非 `missing-apis`。
* 证据：上面探测用例 C2
  → `{"ok":false,"kind":"unusable","detail":"its output was not a Node.js capability report"}`；
  探测用例 C3（用代码的键）→
  `{"ok":false,"kind":"missing-apis","missing":["zlib.createZstdDecompress","Promise.withResolvers"]}`。
* 影响：代码是对的、AC-4(c) 成立，错的是**证据契约**。独立 verifier 若照 `spec.md:46` 字面复现，
  观察到的结果不是 `missing-apis`，可能把 AC-4(c) 记为未通过——即一个文档缺陷足以让整个 Phase 被判失败。
  修法：把两处负载字面量改为 `hasZstd`/`hasWithResolvers`（探测器的报告才是权威契约，替身必须模仿探测器
  真正发出的内容），并要求 verifier 使用这两个键。

**S2 — `process-exec-path` 来源的修复建议给出了无法奏效的 `PATH` 改法。**

* 位置：`apps/vscode-dsh/src/node-env-guard.ts:198`
  （`start VS Code from a shell whose PATH resolves Node.js ${EXPECTED_NODE_RANGE}, or …`），且被
  `apps/vscode-dsh/tests/node-env-guard.spec.ts:305-320` 当作预期文案断言。
* 问题：对 `process-exec-path` 来源而言，失败的候选可执行文件**就是**扩展宿主自己的
  `process.execPath`；`PATH` 上放什么都不改变它，而文档契约明确写「解析绝不查询 `PATH`」
  （`packages/sdk/client/README.md:58`、`docs/development.md:107`）。该子句指向了一个代码并不具备的杠杆。
* 证据：`validateNodeEnvironment` 完全不读 `PATH`（只对已解析路径做 `stat`/`access`/`execFile`，
  `node-env-guard.ts:228-265`）；`resolveNodeExecutableSpec` 只有三个输入且无 `PATH` 查询
  （`packages/sdk/client/src/launch.ts:131-145`）；探测用例 C4b/C4c 表明解析结果只由环境变量 / 设置项 /
  `process.execPath` 决定。
* 影响：诊断仍满足 AC-8(e)（同时给出 `DSH_NODE_BIN` 与 `dsh.nodeBin`），因此没有 AC 失败；但句首那半句
  会把用户引向不可能生效的修法。建议保留两个配置杠杆、删掉该来源下的 `PATH` 子句。

## Observations

**O1 — Electron 层靠继承环境工作，这一耦合现在是有据可查的，而非假设。** `probeNodeApis` 调用
`execFileAsync(path, ['-e', SOURCE], {timeout, windowsHide})` 时不传 `env`，因此探测继承父进程环境；而
spawn 对同一对象注入 `ELECTRON_RUN_AS_NODE=1`（`launch.ts:178-192`）。这个不对称真实存在，但在桌面扩展
宿主上是良性的——VS Code 在扩展宿主内会设置 `process.env['ELECTRON_RUN_AS_NODE'] = '1'`
（VS Code `extensionHostProcess.ts` 的 `patchProcess()`，引用 issue #151012），并且本机已用宿主自带
二进制复现该机制（上文第 6 项）。残留风险（不作为发现）：探测的正确性依赖该外部行为；若它不存在，探测会
尝试以 GUI 方式启动 Electron 应用（正是 `launch.ts:178-179` 为 spawn 记下的后果），10 s 上限后报
`unusable`。Phase 1 与 Phase 3 都不会覆盖这一层——Phase 3 冒烟会预置 `dsh.nodeBin`（AC-10(f)/AD-11）——
因此在 `node-env-guard.ts` 里加一行注释记录该依赖（或显式传入该 flag）即可消除最后一个未验证的假设。

**O2 — `implementation.md` 的 lint 声明在数量上不实；结论仍成立。** §3.3 称 `extension.ts` 有 22 条既有
诊断；实测为 3 条（`2109`、`2110`、`2111`），全部在未改动行上，而 `node-env-guard.ts`、
`session-host.ts`、`packages/sdk/client` 均为 0 条。虚高的既有计数恰恰是最可能掩盖新诊断的论证方式，因此
应把该推理换成实测并写入 `verification.md`：本 Phase 新建/改动的文件 0 条，另有 3 条被位移的既有诊断。

**O3 — `unusable` 第四类确有必要、不会遮蔽其他类别、且有覆盖。** 必要性：若没有它，任何「从未产出报告」
的候选只能被报成 `missing-apis`，而该消息会枚举 `REQUIRED_NODE_APIS`（`node-env-guard.ts:220`）——即
列出在该路径上从未观测到的 API 名。探测 C1 显示实际携带的是实测细节
（`"it exited with code 7"`、`missing: []`）。不遮蔽：路径分类先跑（`:127-130`），
`missing`/`not-executable` 不可能被改判为 `unusable`；而 `missing-apis` 只能由已解析的报告产生
（`:138-145`）。覆盖面：`node-env-guard.spec.ts:323`（exit 7）与 `:319-340` 的四类文案互异断言。

**O4 — 「spawn 计数 0」的观测手段不会产生有影响的假阴性。** 失败路径用例同时断言三件独立事实：无 witness
文件（`session-host-preflight.spec.ts:150`、`:184`、`:224`、`:257`）、无 bridge socket
（`:151`、`:185`、`:225`、`:258`）、且耗时 < 5 s 而 `initializeTimeoutMs` 为 60 s
（`:141`、`:152`、`:188`）。即便子进程被创建却在写 witness 前就退出，缺失的 socket 与
5 s-vs-60 s 的计时仍能排除「先 spawn 再握手超时」——因为 `bridge.listen`（`session-host.ts:286`）在唯一
的 spawn 点（`:292-303`）之前。witness 只是佐证，不是唯一证据。

**O5 — `HostStartError` 改变了每次 `start()` 失败的抛出身份，但未观测到回归。** 唯一消费方在重抛时不检查
类型（`apps/vscode-dsh/src/extension.ts:2269-2277`），诊断文本作为 message 保留
（`session-host.ts:313-321`），未改动的 app 套件仍是基线水平（4 文件 / 6 用例）。`HostStartError` 已导出
（`apps/vscode-dsh/src/index.ts:25`），嵌入方可据此分类。

**O6 — 相对路径会被判为 `missing`。** `resolveNodeExecutableSpec` 原样返回调用方传入值
（`launch.ts:136-139`），因此 `dsh.nodeBin: "node"` 会以相对路径被探测、以 `missing`
（`(no such file)`）失败。这是「绝不查询 `PATH`」（AC-6）的既定后果，诊断仍给出两个配置输入，且探测
C4a/C4b 显示两条空白规则彼此独立；值得一提仅因为设置项描述里没写「必须是绝对路径」。

## AC 逐条核验表

| AC | 实现位置 | 运行时证据（除注明外均为我实测） | 判定 |
|----|---|---|:--:|
| AC-1 | `.nvmrc` = 24.3.0；根 `engines.node` = `EXPECTED_NODE_RANGE`（`node-env-guard.ts:18`） | `node-env-guard.spec.ts:342-345`（范围与 `engines` 完全一致）、`:347-352`（恰一行版本号且被该范围接受）、`:353-358`（对 `process.execPath` 真实子进程探测 → `ok:true`）；探测 C3/C4 输出亦证明探测真实执行 | ✅ |
| AC-2 | `docs/development.md:105` + `docs/development.zh.md:110`（下限、`engines.node` 来源、两个 API、`.jsonl.zstd` 关联） | `node-env-guard.spec.ts:361-370` 断言两份文档含 `.nvmrc`、固定版本、`DSH_NODE_BIN`、`dsh.nodeBin`；两份文档均已实读 | ✅ |
| AC-3 | `docs/development.md:109/121/127`、`docs/development.zh.md:114/126/132` | 双语文本均存在；本 Phase 套件只断言 `.nvmrc`/固定版本/两个输入（`:361-370`），结构性断言属 reviewer/verifier 步骤（review-design 亦以 S3 提出） | ✅ |
| AC-4 | `validateNodeEnvironment`（`node-env-guard.ts:115-147`）：先 `stat`+`X_OK`，再以真实 `execFile` 子进程探测（`:249-265`），再按能力比对（`:138-145`） | `node-env-guard.spec.ts:118-128`（接受 23.11.0）、`:130-141`、`:185-198`、`:203-210`、`:212+`；探测 C1/C2/C3 用真实替身跑出三种不同 kind | ✅ |
| AC-5 | `launch.ts:132-135`（环境变量优先）；消费于 `:177-192` | `launch.spec.ts:232-247`（`/environment/node` 胜出，且 Electron 宿主下 `ELECTRON_RUN_AS_NODE` 为 `undefined`）、`:269-273`；探测 C4c | ✅ |
| AC-6 | `launch.ts:140-144`（`process.execPath`，`electronRunAsNode` 取自 `process.versions.electron`）+ `:180-182` 注入 | `launch.spec.ts:289-297`（Electron 宿主 → `process-exec-path`、env 为 `'1'`）、`:299-314`（用真遮蔽 `PATH` 的 shim 证明它**没有**被选中——可证伪，非文本断言）；对 Electron 二进制的 headless 校验（第 6 项） | ✅ |
| AC-7 | `session-host.ts:282-286`：解析 → `assertNodeExecutable` → `listen`；并把同一对象传下去（`:295`） | `session-host-preflight.spec.ts:124-153`（无 witness、无 socket、< 5 s）、`:155-202`（设置项来源、经 `:163/:183` 证明只解析一次）、`:204-261` | ✅ |
| AC-8 | `formatNodeEnvironmentDiagnostics`（`node-env-guard.ts:167-176`）与 `actualNodeState`/`remedy`/`pathQualifier`（`:190-221`） | `node-env-guard.spec.ts:253-275`（五行、路径、版本、范围、两个 API 名）、`:319-340`（四类 kind → 四段互异文案）；探测 C1（实际状态）与 `session-host-preflight.spec.ts:191-200` 断言的文案 | ✅（remedy 措辞见 S2） |
| AC-9 | 首行 `Node environment check failed — source: …`（`node-env-guard.ts:170`）；`HostStartError` 携带 `kind`/`diagnostic`（`session-host.ts:46-72`） | `session-host-preflight.spec.ts:192`、`:227`；message 即被脱敏的诊断（`session-host.ts:313-321`） | ✅ |
| AC-10 | `package.json` 的 `contributes.configuration.dsh.nodeBin`（string、默认 `""`、description）；读取于 `extension.ts:2179-2188`，传入于 `:2253-2256` | `node-env-guard.spec.ts:373-389`（manifest）、`:455-478`（读取 + 显式传入 + settings 文件字节未变）、`:480-498`（空值原样传递）、`:500-519`（无效路径 → `failed`、文件未被改写）、`:521-533`（非字符串 → 在 Host 启动前 fail loud）；`session-host-preflight.spec.ts:155-202`、`:204-235`（不回退） | ✅ 覆盖 (a)–(e)；(f) 按设计属 Phase 3 |

AD-1 不变量的关键路径追踪（实读，非假设）：`session-host.ts:282-284` 生成对象 → `:285`
`assertNodeExecutable(nodeExecutable)` → `:295` 同一绑定交给 `HarnessClient` → `launch.ts:177`
`options.nodeExecutable ?? …` → `:184` `command: nodeExecutable.path`。成功路径上不存在第二次解析，且
`session-host-preflight.spec.ts:163/:183` 为失败路径钉住「只解析一次」。AD-2 成立：全仓无任何版本比较
（`unsupported-version`、`nodeVersionSupported` 与旧的 `resolveNodeExecutable` 在源码与测试中零命中）；
`version` 只出现在诊断字段（`node-env-guard.ts:67`、`:220`）。

## 与 implementation.md 的出入

1. §3.3 所称「`extension.ts` 22 条既有诊断」无法复现：实测为 3 条，位于 `2109-2111`，且在未改动行上。
   它要支撑的结论（零新增诊断）已被独立确认（第 4 项）。见 O2。
2. §2 的 AC-4 行沿用了 `spec.md` 的 `zstd`/`withResolvers` 夹具负载；本 Phase 自己的用例并不使用它，且它
   不会产出 `missing-apis`。见 S1——AC 成立，所述证据配方不成立。
3. §4 偏差 #7（每次 `start()` 失败改抛 `HostStartError`）陈述属实；我确认无调用方依赖旧的错误身份，
   且 app 套件维持在基线（O5）。
4. §2.1 的八条边界用例全部存在且均可证伪；两条空白规则我是行为级复现（C4a/C4b）而非看用例名，`PATH`
   禁用则由真实的遮蔽 shim 证伪（`launch.spec.ts:299-314`），不是文本断言。
5. §5.2 把 `doc-sync` 留给 Phase 4 与 `spec.md:100`（"Phase 4 only re-checks `pnpm run doc-sync`; it
   does not own the first fixes"）及 `:95`（首次 `test:docs` 归本 Phase）一致；本 Phase 内门禁已跑，
   计数与基线一致。不属逃避。

## 未验证项

* **本轮重新执行 `pnpm run test:docs`。** 本次审查会话早前的执行为 `run-gates: 10 passed, 5 failed`，
  与 v8 基线一致且清单中无本 Phase 文件；重跑被沙箱拦截，故该计数取自那次执行而非重新测量。
  作为「新鲜测量」标记为 UNVERIFIED。
* **早于 #151012 的 VS Code 版本是否同样从扩展宿主导出 `ELECTRON_RUN_AS_NODE`。** 设置该 flag 的代码
  存在于当前 VS Code 源码，且机制已用本机二进制复现，但未验证更旧版本或非桌面形态的宿主。标记
  UNVERIFIED；它只能收窄 O1，不构成缺陷确认。
* **在真实 Extension Development Host 上跑第 3 级**（无设置项、无 `DSH_NODE_BIN` 的
  `process-exec-path`）未执行：在宿主机启动 VS Code 被审查沙箱拦截，且这本属 Phase 3 范围。由于 Phase 3
  会预置 `dsh.nodeBin`，该冒烟不会覆盖第 3 级；标记 UNVERIFIED，并已知其在本 Phase 测试范围之外（见 O1）。
* **`packages/sdk/client` README/README.zh.md 锚点**仅确认了中文页存在显式锚点
  `<a id="choosing-the-node-executable">`，未重跑链接门禁；在案的唯一证据是早前的 `test:docs` 计数。

无升级项：本工作流中这是第一个 Phase，不存在会被本次发现影响的已完成上游 Phase。
