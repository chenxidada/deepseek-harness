# 实现正确性审查 — Phase 1（第 3 轮，回炉轮 2）

## 视角

**实现正确性（Implementation Correctness）**——代码是否正确工作：函数体真实性、真实子进程行为、
验收标准映射、边界与错误路径、副作用。设计一致性与集成连通性不在本视角范围内（由
`reviewer-design` / `reviewer-connectivity` 负责）。

## 判决

**SHOULD-FIX**——三条回炉项（**D-1**、**D-2**、**N1**）经**第一手阅读**改动的函数体、三条调用链、
文档与测试，并重跑全部验收命令，判定为 **CONFIRMED-FIXED**。没有任何 AC 未满足，没有未注册的桩。
差量门禁干净：`typecheck` 退出 0、`packages/sdk/client` 全绿、app 套件红且失败集合与基线完全一致
（4 文件 / 6 用例）、`test:docs` 为 10 passed / 5 failed 且本 Phase 的文档对不出现在任何违规清单中、
`lint` 为 263 文件共 10 382 条诊断且**本 Phase 新增行上零诊断**——各项指标与回炉前一致。

判 SHOULD-FIX 而非 PASS 的原因是一条**新**发现（**N3.1**），它不使任何 AC 失败：`AC-1(b)` 用例把定位到的
解释器以 `source: 'process-exec-path'` 传给 `validateNodeEnvironment`，而该解释器**并非**
`process.execPath`。我追完了该字段的全部消费方，此标注在本用例的成功路径上**无行为影响**；但若某个被定位
到的解释器将来未通过前置校验，它会给出错误的来源描述。属标注准确性问题而非行为缺陷，故为 SHOULD-FIX，
且**不构成再回炉的理由**：按合并规则它不会回流到 implementer，HG-3 可在记录该发现的前提下推进。

开始工作前已确认分支：`git branch --show-current` → `impl-phase-1-node-env-preflight`。

启动自清理（第 0 步）：上一轮的 `review-correctness.md` 与 `review-correctness-zh.md` 存在于 Phase 目录中，
本 agent 在写入任何新内容前已归档：

```
$ PHASE_DIR=.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight
$ mv $PHASE_DIR/review-correctness.md    $PHASE_DIR/.archive/review-correctness-20260915T121357Z.md
$ mv $PHASE_DIR/review-correctness-zh.md $PHASE_DIR/.archive/review-correctness-zh-20260915T121357Z.md
```

只触碰了这两个文件。本次审查**未运行任何写操作类 `git` 命令**（下文出现的 `git` 调用均为本工作流规定的
只读检查），未修改 `current-status.json`。

## D-1 / D-2 / N1 逐条判定

### D-1 — 清除审查条目码、保留 `AD-*`：**CONFIRMED-FIXED** ✅

该条目自带的探针零命中：

```
$ grep -rnE '\((S[0-9]+|M[0-9]+)[,)]|// *(S|M)[0-9]+:' apps/vscode-dsh/
（无输出；exit 1）
```

四处指名站点按当前行号读取：

| 站点 | 当前文本 | 判定 |
|---|---|:--:|
| `node-env-guard.spec.ts:267` | `it('probes a process-exec-path candidate in the Electron mode the spawn will use', …)` | `(S9)` 已清除 ✅ |
| `node-env-guard.spec.ts:685` | `it('re-reads the setting on every start instead of caching the first value (AD-9)', …)` | `S5` 已清除，`AD-9` **保留** ✅ |
| `node-env-guard.spec.ts:699` | `// A cached resolution or setting value would still report the first path here.` | `// M2:` 已清除 ✅ |
| `auto-start-orchestrator.spec.ts:144` | `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4)', …)` | `M2` 已清除，`AD-4` **保留** ✅ |

反方向同样完好，`AD-*` 未被误删：

```
$ grep -rnE 'AD-[0-9]+' apps/vscode-dsh/src/*.ts apps/vscode-dsh/tests/*.ts
auto-start-orchestrator.ts:38 (AD-4)   extension.ts:224 / :2173 (AD-10)
session-host.ts:51 / :108 (AD-4 / AD-1)   node-env-guard.ts:111 / :152 / :250 (AD-2 / AD-1 / AD-1)
auto-start-orchestrator.spec.ts:14 / :144 (AD-4)   node-env-guard.spec.ts:216 (AD-2) / :685 (AD-9)
```

**我确实找到了残留，但它不构成违规。** 放宽扫描会命中的是 `tests/spike-attribution-snapshot.spec.ts:3,30,90,152`
与 `tests/spike-attribution-helpers.ts:73` 中的 `AC-S1` / `AC-S2` / `AC-S3`。这些是另一份 `Spike phase-0`
spec 的验收标准编号（`describe('Spike phase-0 — AC-S1 attribution via meta.diffs')`），不是审查条目码，且位于本
Phase 从未触碰的文件（`git diff --stat` 未列出这两个文件）。D-1 针对的是本工作流报告中的 `S*`/`M*`
**审查**条目码；`AC-S*` 属 AC 命名空间，与 `AD-*` 同类，均为可引用契约。无需处理。

`grep -rnE 'review (item|round)|round [0-9]|must-fix|should-fix'` 扫 `apps/vscode-dsh/src` 与 `tests`
→ **0 命中**，未遗留其他审查历史用语。

### D-2 — 非字符串 `dsh.nodeBin` 归入 `invalid-setting`：**CONFIRMED-FIXED** ✅

**（1）该归类确实从 `readNodeBinSetting` 一路传到 orchestrator 快照。** 我逐跳追踪，未采信摘要：

```
extension.ts:2184-2189   typeof value !== 'string' → throw new HostStartError('invalid-setting', …)
extension.ts:2253        try {                                  ← 抛出点在此 try 内
extension.ts:2255          const nodeBinSetting = readNodeBinSetting(vscode)   ← 在此抛出
extension.ts:2256          await next.start({ cwd, … })                     ← 永不到达
extension.ts:2278-2280   } catch { … throw error instanceof Error ? error : … }   ← 实例被保留
auto-start-orchestrator.ts:213  await this.port.start(reason)     ← port.start 拒绝
auto-start-orchestrator.ts:226  this.errorKind = startErrorKindOf(error)
auto-start-orchestrator.ts:53-61  startErrorKindOf → 成员集扫描 → 'invalid-setting'
auto-start-orchestrator.ts:129  getSnapshot() → errorKind
```

在 catch 路径上，`startErrorKindOf` 是 `errorKind` 的**唯一**写入者（`:226`）；另一处写入者（`:220`，
`'process-failed'`）位于「start 完成但连接未存活」分支，本场景因 `port.start` 已拒绝而不可达。用例断言的是
**快照**而非文本（`node-env-guard.spec.ts:744`），且实际执行：

```
$ pnpm run test apps/vscode-dsh/tests/node-env-guard.spec.ts --reporter=verbose
 ✓ … > extension reads dsh.nodeBin (AC-10 e) > classifies a non-string setting as invalid-setting, not a process failure 1ms
 Tests  28 passed (28)
```

**（2）确实没有复用 `node-environment`。** `START_ERROR_KINDS`（`:27-32`）含四个互异成员，
且 `HostStartError` 的 `diagnostic` 对新归类保持 `undefined`（`session-host.ts:78` 拷贝
`options.diagnostic`，而 `invalid-setting` 的构造未传该参数）。因此
`session-host.ts:62` 的不变式「*前置校验诊断；恰好在 `kind` 为 `node-environment` 时存在*」仍然成立。
我检查了本 app 内 `.diagnostic` 的全部读取方——仅 `session-host-preflight.spec.ts:180-182,222-223,254-256`，
均处于 `node-environment` 场景，无消费者假设它在其他归类下存在。

**（3）没有 switch 丢失穷尽性。** 全仓**不存在**对 `StartErrorKind` 的 `switch`：

```
$ grep -rn "switch" apps/vscode-dsh/src --include=*.ts
connection-ui.ts:117   switch (snap.state)      ← StartOrchestratorState，非该归类联合
extension.ts:1854      switch (gate.kind)       ← RevertGate，无关联合
replay-hydrator.ts:252 switch (event.type)      ← 会话事件类型
```

`connection-ui.ts:134-138` 的 `default:` 是**穷尽性断言**而非吞掉型 default：`const _exhaustive: never =
snap.state` 在新增状态成员时会编译失败——且它守护的是本轮未改动的 `StartOrchestratorState`。唯一对归类
分支的消费方是等值判断 `connection-ui.ts:140`：`snap.errorKind === 'missing-credentials'`。在
`invalid-setting` 下该式为 `false`，于是 `settingsDeepLinkAvailable` 为 false、`failed` 相位渲染
`snap.errorMessage`——语义正确：`dsh.nodeBin` 取值类型错误不是凭据问题，用户看到的是那句具体的
"must be a path … got number"。`typecheck` 退出 0 是「没有联合成员被漏处理」的机械确认。
`grep -rn "StartErrorKind"` 在 `apps/vscode-dsh` 之外**无命中**，故 `packages/**` 无遗漏消费方。

**（4）三处词表一致。** `auto-start-orchestrator.ts:34-42`（点名 `node-environment`、`invalid-setting`，
并说明 `process-failed` 是唯一泛化成员）、`session-host.ts:42-52`（同三者，并说明新归类属于设置值问题）、
`design.md:186` / `design-zh.md:187`（"…加本工作流新增的 `node-environment` 与 `invalid-setting`（Phase 1，
`dsh.nodeBin` 取值类型错误）、以及 `spawn` / `handshake-timeout` / `bridge-listen`（Phase 2）"）——双语一致。
不存在第四套词表（`grep -rn "missing-credentials"` 仅命中 `START_ERROR_KINDS`、orchestrator 的抛出点与测试）。

**（5）新增断言确实可证伪——但有一半未实际执行。** 断言是
`expect(snapshot.errorKind).toBe('invalid-setting')`，即要求一个**特定的非泛化**成员。由（1）可知，该值只能
来自（a）`'invalid-setting'` 存在于 `START_ERROR_KINDS` **且**（b）抛出的载体携带该 `kind`。因此移除任一者都会
使该用例变红。我用一条**仓内既有用例**动态验证了其中一半：

```
auto-start-orchestrator.spec.ts:166-176
  throw new Error('spawn EBADF')  →  expect(orch.getSnapshot().errorKind).toBe('process-failed')   ✓ 通过
```

这正是「无 `kind` 的载体落到泛化成员」的已执行证据——也就是说 D-2 的断言不可能被裸 `Error`（即修复前的代码
形态）满足。互补的那次变异（删除数组成员）我**未**实际执行；见「未验证」——沙箱拒绝仓外探针脚本，与第 2 轮记录
的限制相同。无论哪种方式，代码阅读都是无歧义的：`startErrorKindOf` 对数组外的任何值都返回 `process-failed`。

**（6）与 Phase 2 spec 无冲突。** Phase 2 计划扩展同一联合——其第 88 行列出
`apps/vscode-dsh/src/auto-start-orchestrator.ts（StartErrorKind 扩展 + 读取校验过的 kind）`，其
`spawn` / `handshake-timeout` / `bridge-listen` 与 `invalid-setting` 互不相交。Phase 2 还依赖泛化成员继续存在
（第 61 行：`kind === 'other'` 的记录"对应 orchestrator 的 `errorKind === 'process-failed'`"），而它确实存在——
implementer 保留了 `process-failed`，第 1 轮仅移除了第二个伞形类 `'start-failed'`。Phase 2 的
`HostFailureKind` 是另一个模块中的另一种类型，未被触碰。最后，`invalid-setting` 由 `extension.ts`
在 `IdeSessionHost.start` 被调用**之前**抛出，因此不落在 Phase 2「`start()` 期间任何失败都必须产出一条诊断记录」
的范围内。

### N1 — AC-1(b) 三处定位：**CONFIRMED-FIXED**，附一条新 SHOULD-FIX 🟡

**（1）三处定位确实存在，版本相等确实被断言。** 辅助函数为 `pinnedInstallRoots`（`:89-101`，
`/usr/local/n/versions/node/<v>` 与 `~/.nvm/versions/node/v<v>`）、`nodeOnPath`（`:103-107`，
`command -v node`）、`reportedVersion`（`:109-113`）。用例同时断言二者：

```486:517:apps/vscode-dsh/tests/node-env-guard.spec.ts
    ctx.skip(
      located.length === 0,
      `no install of ${pinned} to locate; checked ${checked.join('; ')}`,
    )
    for (const { label, path } of located) {
      const validation = await validateNodeEnvironment({ path, source: 'process-exec-path', electronRunAsNode: false })
      expect(validation.ok, `${label} (${path}) was rejected by the pre-flight`).toBe(true)
      if (!validation.ok) continue
      expect(validation.report.version, label).toBe(pinned)
    }
```

在 `ok` 为真的前提下还要求 `report.version === pinned`，强于 spec 原文（`spec.md:43` 只要求 `ok:true`）。
因此该用例证明的是**被 pin 的版本**能通过前置校验，而不是*某个* Node 能通过。

**（2）skip 不是恒定的 skip——本机确实执行了，我实测了原因。** verbose 输出的原文行：

```
 ✓ |thread-safe| apps/vscode-dsh/tests/node-env-guard.spec.ts > node environment diagnostic (AC-8, AC-9)
   > locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) 53ms
```

我独立复现了定位器的输入：

```
$ P=$(tr -d '\n' < .nvmrc)        # 24.3.0，7 字节，恰 1 行 semver，末行有换行
PRESENT /usr/local/n/versions/node/24.3.0/bin/node -> v24.3.0
ABSENT  /home/chendc/.nvm/versions/node/v24.3.0/bin/node
command -v node -> /usr/local/n/versions/node/24.3.0/bin/node ; version=v24.3.0
```

三处已查、**两处命中**，两处均经真实子进程探测（53 ms 与两次 `execFile` 探测相符，而非读取常量）。
`ctx.skip` 分支未被走到。

**（3）🟡 SHOULD-FIX——`source: 'process-exec-path'` 是语义错误的标注，但无行为影响。**

被定位到的解释器并非 `process.execPath`。我追查了 `validateNodeEnvironment` 中 `source` 能影响的范围
（`node-env-guard.ts`）：`base.source`（:119）、`base.sourceLabel`（:120）、
`nodeEnvironmentRemedy(executable.source)`（:125）。这三者**只**喂给渲染出的诊断（`sourceLabel` → 首行，
`remedy` → 末行）。没有任何分支据 `source` 选择行为：

- 探测模式由**另一个独立字段**决定：`if (executable.electronRunAsNode) environment.ELECTRON_RUN_AS_NODE = '1'`（`:258`）；
- 用例显式传入 `electronRunAsNode: false`，Electron 分支关闭；
- 成功路径返回 `{ ok: true, report }`，不读取任何标签。

专用 Electron 用例证明了两个字段相互独立：**只**翻转 `electronRunAsNode` 而保持
`source: 'process-exec-path'` 不变（`node-env-guard.spec.ts:281-293`：`true` → `ok`，`false` →
`failure.kind === 'unusable'`）。

结论：**无校验行为偏差，对 AC-1 或任何断言均无影响。** 该不准确仅存在于假设的失败路径上——若某个被定位到的
解释器将来未通过前置校验，消息会写成 `source: the Extension Host Node.js process`，修复建议也会指向
Extension Host 自带 Node，而这对一个位于 `/usr/local/n/...` 或 `PATH` 上的解释器是错误的。当前没有任何断言
检查该文本，因此用例不可能因此错误地通过或失败；但它可能误导后续读者。有两点使该标注难以完全避免：
`NodeExecutableSource` 是封闭的 3 成员联合，没有「机器上找到的解释器」这一成员；而 `source` 是
`ResolvedNodeExecutable` 的必填字段——用例必须选一个，三个都不精确。诚实的下限是加一条注释说明该值在此定位器中
是名义值（用例对 PATH 命中规则已在 `:488-490` 这样做），或改为断言 `failure.executablePath` 而不采信来源标签。
不判 MUST-FIX：它不改变任何 AC 结果，也不改变任何产品行为。

**（4）`spec.md` 的 AC-1 文本与 `.nvmrc` 内容未被改动。** `spec.md:26` 仍是 AC-1 的原始需求文本，
`spec.md:43` 仍含三处定位的验证策略，**包括**"若三处均无该版本安装 → 以非 PASS 结束并在 `verification.md`
写明「本机无该版本安装」，**不得** 记为通过"。`.nvmrc` 为 `24.3.0` + 换行，7 字节，恰 1 行 semver。
实现是 spec 要求的严格超集，而非削弱。

## 逐条 AC 验证

拆分后 AC-1 – AC-10 仍各有可执行证据，无覆盖退化。

| AC | 实现位置 | 运行时证据（我实测） | 判定 |
|---|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0`；`EXPECTED_NODE_RANGE` ≡ 根 `engines.node` | (a) `:476-482` 恰 1 行 semver + `rangeAdmits`，**已执行**；(b) `:484-517` 三处定位、两处命中，各自 `ok:true` **且** `report.version === pinned`——**已执行，53 ms，未 skip**；(c) `:519-528` 双语文档；`:471-474` engines ≡ 强制范围 | ✅ |
| AC-2 | `docs/development.md` § *Node environment*（+ zh） | 两文件均直读：最低版本、`engines.node` 来源、两个 API、`.jsonl.zstd` 关联齐备 | ✅ |
| AC-3 | 同节两张清单、两个覆盖面 | `:530-555` 四个标题 + 每条目的可判定 token，外加「删除任一覆盖面标题会让同一断言抛错」的证伪路径——通过 | ✅ |
| AC-4 | `validateNodeEnvironment`（`node-env-guard.ts:115-147`），在 `session-host.ts:292` 于 `bridge.listen`（`:293`）之前调用 | `:216-241` 能力口径 vs 版本号；**正向覆盖由 `:244-251`（`process.execPath`，两个 API 均为 true）保留**——这正是拆分时从 AC-1 移出的那条断言；另有 `missing` / `not-executable` / `unusable` / `missing-apis`；`session-host-preflight.spec.ts` spawn 计数 0 | ✅ |
| AC-5 | `launch.ts` 环境变量优先，其次设置，最后 `process.execPath` | `launch.spec.ts` 环境变量压过设置；`session-host-preflight.spec.ts` 真实替身被运行 | ✅ |
| AC-6 | 第 3 级为 `process.execPath`；仅该来源在 Electron 下置 `electronRunAsNode` | `launch.spec.ts` Electron + `PATH` 影子探针；`node-env-guard.spec.ts:281-293` 证明驱动模式的是该标志而非 `source` | ✅ |
| AC-7 | `session-host.ts:286-330` 顺序 resolve → 门槛 → `listen` → spawn；`:318-330` 类型化载体 | `session-host-preflight.spec.ts:146,178,221,253`（`kind === 'node-environment'`）、未 spawn、无 socket、`status === 'error'`、耗时 < 5 000 ms | ✅ |
| AC-8 | `formatNodeEnvironmentDiagnostics` 恰好渲染 5 行 | `:447-469`（四种归类各 5 行且两两不同）、`:420-445`（两个配置杠杆、不含 `PATH`）、`session-host-preflight.spec.ts:189-200` | ✅ |
| AC-9 | 首行 `Node environment check failed — source: …`；载体 `NodeEnvironmentError` / `HostStartError{kind:'node-environment'}` | `:380-382` 无代码缺陷归因；跳变断言在 `auto-start-orchestrator.spec.ts:162` 与 `node-env-guard.spec.ts:722`；非 Node 归类现在也能穿过（D-2 的 `invalid-setting`） | ✅ |
| AC-10 | (a) `package.json` 的 `contributes.configuration`；(b) 文档写明优先级；(c)–(e) 运行时 | `:558-573`（类型/默认值/描述）、`:640-663`（读取并传入、文件未被改写）、`:665-683`（空值透传）、`:685-702`（每次重读、不缓存）、`:704-727`（无效路径 fail loud、`errorKind === 'node-environment'`、文件字节不变）、`:729-747`（**新增**：快照为 `invalid-setting`，`start` 从未被调用） | ✅ (a)–(e)；(f) 按设计属 Phase 3 |
| 回归 | 见下方门禁块 | 五条差量命令全部复现基线 | ✅ |

AD-1 仍是靠阅读而非假设成立：`session-host.ts:289-291` 铸造对象 → `:292` 校验**同一绑定** → `:302` 把**同一绑定**
交给 `HarnessClient`，因此被校验的可执行文件与被 spawn 的不可分叉。AD-2 成立：不存在版本号比较分支
（`unsupported-version` / `nodeVersionSupported` 零命中）。

## 差量门禁（真实命令、真实输出）

在仓库根执行，带 `export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` 与
`PNPM="pnpm --config.verify-deps-before-run=false"`。

| 命令 | 基线 | 我的实测 | 新增失败 |
|---|---|---|---|
| `$PNPM run typecheck` | 绿 | **exit 0**（`tsc -b tsconfig.client.json`） | 无 |
| `$PNPM run test packages/sdk/client` | 绿，3 文件 / 73 | **exit 0**，`Test Files 3 passed (3)`，`Tests 84 passed (84)` | 无 |
| `$PNPM run test apps/vscode-dsh packages/sdk/client` | 4 文件 / 6 用例红 | **exit 1**，`Test Files 4 failed \| 49 passed (53)`，`Tests 6 failed \| 435 passed \| 1 skipped (442)` | 无 |
| `$PNPM run test:docs` | 10 passed / 5 failed | **exit 1**，`run-gates: 10 passed, 5 failed, 0 skipped`，同样的五个门禁 | 无 |
| `$PNPM run lint` | 红 | **exit 1**，**10 382** 条诊断 / **263** 文件 | 无（见下） |

六个失败用例即基线的六个，位于基线的四个文件中，均非本 Phase 触碰：
`spike-t0b-continue-capability.spec.ts`（整文件）、`panel-close-delete.e2e.spec.ts`（1）、
`spike-t0a-replay-rebuild.spec.ts`（4：AC-30/47、AC-76、AC-77、AC-80）、
`verifier-phase1/layer-a-rtl.spec.tsx` V-A4。用例总数由 441 升至 442，因 N1 把一条拆为两条。

聚焦套件：

```
$ $PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts \
      apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
      apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts
 Test Files  4 passed (4)      Tests  70 passed (70)      exit 0

$ $PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts --reporter=verbose
 Tests  28 passed (28)        exit 0
```

`test:docs` 完全未提及本 Phase 的文档对：

```
$ grep -cE 'docs/development\.(md|zh\.md)' <test:docs 输出>   → 0
$ grep -cE 'sdk/client/README'              <test:docs 输出>   → 0
$ grep -E '^  - FAILED'                     <test:docs 输出>
  - FAILED markdown links / translation pairing / markdown wrap / agent note format / documentation standard tests
```

列出的违规为 `docs/wiki/**` 仅中文页、`apps/vscode-dsh/README.md` 及其截图 fixture README、
`packages/README.*`、`packages/sdk/server/README.*` 与 `2026-09-04-ide-profile-dual-channel.md` 笔记——
与 `spec.md:98` 记录的既有失败集合一致。

**lint 差量——新增行上零诊断，对照 `git diff -U0` 的新增范围逐条核对。** 门禁产出
`10 382` 条诊断 / `263` 文件，与 implementer 的 §4.3 总数及上一轮完全一致。逐文件并核对全部新增范围：

| 文件 | 诊断数 | 新增范围（累计，`git diff -U0`） | 位于新增行？ |
|---|---:|---|---|
| `node-env-guard.ts`（新）/ `node-env-guard.spec.ts`（新）/ `session-host-preflight.spec.ts`（新） | 0 / 0 / 0 | 整文件 | — |
| `auto-start-orchestrator.ts` | 1 — `:236:24` | `26-61`、`226` | 否 |
| `session-host.ts` | 1 — `:597:3` | `14`、`16`、`27`、`29`、`42-81`、`108-111`、`255-256`、`287-292`、`302`、`323-329` | 否 |
| `extension.ts` | 22 — `271, 375, 380, 385, 407, 425, 662, 750, 1004, 1102, 1152, 1418, 1450, 1492, 1534, 1791, 2109×3, 2110, 2111, 2272, 2274` | `34`、`48`、`223-236`、`2172-2192`、`2255`、`2258` | 否 |
| `index.ts` | 1 — `:97:3` | `25-39` | 否 |
| `auto-start-orchestrator.spec.ts` | 4 — `52, 53, 95, 96` | `8`、`12-15`、`143-177` | 否 |
| `phase1/2/4` duck-typed 套件 | 2 / 15 / 11 | `70-74`、`49-53`、`75-79` | 否 |
| `packages/sdk/client/{launch,types,index}.ts`、`tests/launch.spec.ts` | 0 | — | — |

## 桩检测

**已注册桩（对照 `tech-debt-registry.md` 交叉校验）**

| Registry ID | 文件:函数 | 状态 | 说明 |
|---|---|:--:|---|
| `DEBT-004` | `packages/specdev/specdev-presets/src/tool-policy.ts` | ⚠️ 已知，无关 | 🟡 非阻塞；目标为后续 preset 策略工作流。Phase 1 未触碰 `packages/specdev/**` 下任何文件。非本 Phase 义务。 |

`DEBT-005` / `DEBT-006` / `DEBT-007` 已在 registry 的「已解决」表中登记为本轮解决，且**三条在
第一手核查下均成立**：DEBT-005 由上述 D-1 扫描成立；DEBT-006 由已追踪的链路与通过的快照断言成立；
DEBT-007 由已执行的 AC-1(b) 用例（断言 `report.version === pinned`）成立。移入「已解决」是正确的，
并非提前结案。

**新发现的未注册桩：无。**

```
$ grep -nE "@STUB|TODO|FIXME|XXX|not implemented|placeholder" \
    node-env-guard.ts session-host.ts auto-start-orchestrator.ts node-env-guard.spec.ts \
    launch.ts types.ts   →  (0 命中)
```

我读过的每个函数体都执行真实逻辑。`validateNodeEnvironment` 先 `stat` + `X_OK`，再真实 `execFile` 探测，
再做能力差异比对。`probeNodeApis` 构造显式环境并收窄解析出的报告。`startErrorKindOf` 扫描真实的词表数组。
`readNodeBinSetting` 读取真实配置访问器、区分 `undefined`/`null`、对非字符串抛类型化错误。两处空 `catch`
（`auto-start-orchestrator.ts:260` 的监听器隔离、`extension.ts:2228`）都写明了吞掉什么，且无法隐藏启动失败
（失败路径在其外）。

## 关键发现

### 🔴 Must-Fix

无。没有 AC 未满足，没有未注册桩，未复现功能回归，没有任何门禁出现新增失败。

### 🟡 Should-Fix

- **N3.1——`AC-1(b)` 把定位到的解释器标注为 `source: 'process-exec-path'`**，而它并非 `process.execPath`
  （`node-env-guard.spec.ts:506-511`）。在本用例的成功路径上无影响，因为 `source` 只喂给 `sourceLabel`/`remedy`，
  而探测模式来自相互独立的 `electronRunAsNode` 字段（`node-env-guard.ts:119-125`、`:258`）。若某个被定位到的
  解释器将来未通过前置校验，它会把诊断写错。补一条注释（或改为断言 `failure.executablePath`）即可闭合。
  不判 MUST-FIX，也不构成回炉理由。

### 🟢 观察项

- `reportedVersion(onPath)` 对 PATH 候选被求值两次（`:497` 在提示模板中、`:498` 在命中判断中），每次运行多出
  一次 `--version` 探测。无害。
- 本机上 PATH 定位与 `n` 根解析到**同一个**绝对路径，因此该解释器被校验两次。幂等；两次探测的耗时即 53 ms 的
  来源。
- `expect(located.length).toBeGreaterThan(0)`（`:516`）在 `ctx.skip` 触发时不可达，因为 skip 信号会短路。
  一行无害的兜底。
- `ctx.skip` 会把 pin 版本与三处已查路径写入用例提示，满足 `spec.md:43`「以非 PASS 结束并写明」的机械部分；
  该分支被走到时在 `verification.md` 中记录仍是 verifier 的义务。本机不适用。
- registry 中 DEBT-007 的证据描述了针对**上一版**用例形态的反事实探针。该形态已不在树中，故反事实那一半
  无法重新推导——当前形态已被直接验证，且严格更强。

## 未验证

- **D-2 的「删除数组成员」变异。** 我尝试了仓外探针（一个 `/tmp` 脚本，按绝对路径 import
  `auto-start-orchestrator.ts` 并用合成载体驱动它），沙箱以「未授权的仓外 harness」为由拒绝——与第 2 轮记录的
  限制相同；探针文件已删除。因此可证伪性依据为：(i) 已追踪的唯一写入者链路加上成员数组；(ii) **已执行**的仓内用例
  `auto-start-orchestrator.spec.ts:166-176`，证明无 `kind` 的载体落到 `process-failed`。代码阅读无歧义。
- **`unusable` 的超时分支**（构造 10 s 探测超时需要一个长运行 fixture）。`implementation.md` §6.5 记录了同样的限制。
- **真机 Extension Development Host 第 3 级**（无设置、无 `DSH_NODE_BIN` 时的 `process-exec-path`）——属 Phase 3
  范围，原样结转。
- **`$PNPM run doc-sync`** 未运行：`spec.md:100` 把首次 `test:docs` 归本 Phase、把 `doc-sync` 留给后续工作流。
  `test:docs` 已运行且计数与基线一致。

## 与 `implementation.md` 的出入（第 3 轮）

无影响判决之处。三点措辞说明：§1.3 的「不存在对 `StartErrorKind` 的 switch」是正确的，我并确认
`connection-ui.ts:134` 的 `default:` 是穷尽性断言而非吞掉型 default；§4.2 的 `Tests 70 passed (70)`
在四文件命令下复现（单文件 verbose 为 28，属预期）；§4.3 的 `10 382` 在门禁命令下精确复现
（我的实测：`10 382` 条诊断 / `263` 文件），原始输出文件为 12 721 行——implementer 报的是诊断数，
与我的口径一致。

无升级项：本工作流尚处第一个 Phase，我发现的任何问题都无法影响已完成的更早 Phase，且三条升级触发条件
（AC 不可验证、3 个以上未注册桩、AC 相互冲突）均不成立（第二条需要至少一个未注册桩，而一个都不存在）。
