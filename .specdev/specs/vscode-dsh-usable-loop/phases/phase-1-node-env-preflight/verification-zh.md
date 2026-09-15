# Phase 1 验证报告 — `phase-1-node-env-preflight`

## 判决：PARTIAL

Phase 1 能够判定的范围内（AC-1 – AC-10(e)）全部十条验收标准均以**独立执行证据**达成；上一轮遗留的三项（D-1、D-2、N1）经独立复核**确认已真修复**；差量门禁**零新增失败**。判决不是 PASS 的原因有且只有一个：AC-10 的真机消费分支（AC-10(f)）按本工作流设计由 Phase 3 提供证据，而 spec 明确禁止「把该缺口登记为 known gap 之后仍判 PASS」。**未发现任何 CRITICAL / MEDIUM 功能缺陷。** 另有 7 条审查条目仍未闭合，全部为零行为影响的文档/引用保真项——见 §7。

验证执行于分支 `impl-phase-1-node-env-preflight`（工作区，未提交 Phase 1 代码），HEAD `d92b0e55e1`，时间 2026-09-15。

> **AC-10 跨 Phase 登记（spec 要求原文写出）：** AC-10 真机消费分支由 Phase 3 提供证据（跨 Phase 依赖）。Phase 1 **不**因此判失败，本报告**不**声称真机分支已在 Phase 1 验证；Phase 3 的对应补充证据行若失败，则整条 AC-10 不成立。§4.4 说明本登记为何仍使判决降为 PARTIAL。

---

## 0. 验证环境与测量口径

| 项 | 值（本次实测） |
|---|---|
| 分支 | `impl-phase-1-node-env-preflight` —— 与要求一致 |
| HEAD | `d92b0e55e1`（spec 状态收尾提交，不含任何 Phase 1 代码） |
| 默认 `node` | v20.16.0 —— 不合格（缺 `zlib.createZstdDecompress`、`Promise.withResolvers`） |
| 合格 Node | `/usr/local/n/versions/node/24.3.0` |
| 命令前缀 | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm --config.verify-deps-before-run=false` |
| 实际测得的模块平面 | 源码平面：`@deepseek-ai/dsh-sdk-client` → `packages/sdk/client/src/index.ts`（见下表 v0 行） |

### 0.1 差量回归矩阵

基线本身就是部分红；验收口径是**零新增失败且失败集合一致**，不是全绿。

| 门禁 | 基线（spec） | 本次实测 | 新增失败 |
|---|---|---|---|
| `pnpm run typecheck` | 绿 | exit 0 | 0 |
| `pnpm test packages/sdk/client` | 绿 | exit 0 — `Test Files 3 passed (3)`、`Tests 84 passed (84)` | 0 |
| `pnpm run test apps/vscode-dsh` | 红 — 4 文件 / 6 用例 | exit 1 — `Test Files 4 failed \| 46 passed (50)`、`Tests 6 failed \| 351 passed \| 1 skipped (358)` | 0 |
| `pnpm run test:docs` | 红 — 10 passed / 5 failed | exit 1 — `run-gates: 10 passed, 5 failed, 0 skipped in 26.78s` | 0 |
| `pnpm run lint` | 红 | exit 1 — **10381** 条（规则集：权威 `.oxlintrc.json`） | 0 |

- `apps/vscode-dsh` 的失败文件恰为基线的四个：`spike-t0b-continue-capability.spec.ts`、`panel-close-delete.e2e.spec.ts`、`spike-t0a-replay-rebuild.spec.ts`（4 用例）、`verifier-phase1/layer-a-rtl.spec.tsx`。
- 文档门禁失败恰为基线的五个：markdown links、translation pairing、markdown wrap、agent note format、documentation standard tests。
- 任何失败集合中均**不含** Phase 1 的文件。本 Phase 自己的文档对是干净的：整个 `test:docs` 输出中 `docs/development` 出现 **0** 次，且 `docs/development.i18n.yaml` 记录的成对哈希与工作区完全一致（`development.md` → `32be857e…`，`development.zh.md` → `821d84be…`）。
- lint 总数与第 3 轮审查报的 10382 相差 1；决定性测量是 §0.2 而非总数。

### 0.2 lint —— 只看新增行

规则集：`.oxlintrc.json`（门禁）。`.oxlintrc.staged.json` 是另一套无类型分析的缩减集，本处数字不使用它。

我把每一条诊断与 Phase 1 全部 25 个路径的工作区 diff 新增行区间做了交集（新增行区间取自 `git diff -U0`；未跟踪文件视为整文件新增）：

| 文件 | 该文件诊断数 | 命中新增行 |
|---|:--:|:--:|
| `apps/vscode-dsh/src/extension.ts` | 22 | 0 |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 1 | 0 |
| `apps/vscode-dsh/src/session-host.ts` | 1 | 0 |
| `apps/vscode-dsh/src/index.ts` | 1 | 0 |
| `apps/vscode-dsh/tests/{auto-start-orchestrator,phase1-auto-start,phase2-auto-ready,phase4-new-conversation-chrome}.spec.ts` | 4 / 2 / 15 / 11 | 各 0 |
| 其余 Phase 1 路径（新门槛、新用例、SDK 文件、文档、清单） | 0 | 不适用 |

新增行零新增 lint 诊断；脚本未打印任何 `NEW-DIAGNOSTIC` 行。本 Phase 自身产物目录下的诊断数：**0**。

---

## 1. 测试执行矩阵

标注「静态」的行是文本/结构断言，**明确不是端到端**。每条行为类验收标准另有一行运行时证据。

| 验收标准 | 来源 | 命令 | 结果 | 证据 |
|---|---|:--:|:--:|---|
| AC-1(a) 机器可读 pin | spec | `tsx v1-ac1-pinned-locate.mts` | ✅ | `AC-1a exactly one version line 1 line(s)`；`version form 24.3.0`；`ends with one newline ".0\n"`；`no CR`；根 `engines.node` 与门槛常量同为 `^22.19.0 \|\| >=24.0.0` |
| AC-1(b) 被 pin 的版本能跑通门槛 | spec | `tsx v1-ac1-pinned-locate.mts` | ✅ | 定位到 `/usr/local/n/versions/node/24.3.0/bin/node`、同一路径经 PATH、以及 `/usr/local/bin/node`；三者均 `ok:true version=24.3.0 hasZstd=true hasWithResolvers=true`；`~/.nvm/versions/node/v24.3.0` 不存在。`FAILURES=0`。谓词对照正确拒绝 22.18.0 / 23.5.0 / 20.16.0。仓内用例的 pass/非 skip 事实另见 §4.2 |
| AC-1(c) 文档写出 pin | spec | `tsx v1-ac1-pinned-locate.mts` | ✅（静态） | `docs/development.md` 与 `docs/development.zh.md` 均含 `.nvmrc` 与 `24.3.0` |
| AC-2 Node 前提清单 | spec | `tsx v5-docs-ac2-ac3.mts` | ✅（静态） | 两种语言均含：下限 `22.19` ✅、来源（`engines.node` + `package.json`）✅、`zlib.createZstdDecompress` ✅、`Promise.withResolvers` ✅、`.jsonl.zstd` 关联 ✅ |
| AC-3 两张责任清单、两个覆盖面 | spec | `tsx v5-docs-ac2-ac3.mts` | ✅（静态） | 两种语言均为 `{"repositoryOnce":true,"localOnce":true,"faceOnce":[true,true],"bulletsPerFace":[3,3],"everyEntryDecidable":true}`；`terminal=3 bullets, subprocess=3 bullets, shared=0`；`5 repository rows name a pnpm run command`；反证：删掉任一覆盖面标题或任一清单标题都会让谓词变假（8 条对照全部符合要求） |
| AC-4 spawn 前校验确实先于 spawn | spec | `tsx --import … v3-e2e-preflight.mts` | ✅（运行时） | 三种失败类别全链路：`missing-apis`（场景 1）、`missing`（场景 2、3）、`not-executable`（场景 5）；每一条都是 `spawnCount=0`、`no bridge socket existsSync=false`、host 状态 `error`。次序在出货代码中可见于 `session-host.ts:289-310`（先门槛、再 `bridge.listen`、再把**同一对象**交给 `HarnessClient`） |
| AC-4 顺序契约 | spec | implementer 用例 `session-host-preflight.spec.ts`（仅作背景） | ✅ | 已由 §0.1 的套件覆盖；我自己的运行时证据是上述 `spawnCount=0` 各行加 §2 的正向对照 |
| AC-5 `DSH_NODE_BIN` 优先、不注入 Electron 标志 | spec | `tsx v2-resolution-priority.mts` | ✅ | `{"path":"/x/node","source":"dsh-node-bin","electronRunAsNode":false}`；`launch.command === '/x/node'`；无论是否在 Electron 下 `ELECTRON_RUN_AS_NODE === undefined`；env 与设置项同时非空仍为 `dsh-node-bin`；失败路径（v3 场景 3）为 `source=dsh-node-bin kind=missing spawnCount=0` |
| AC-6 第 3 级是 `process.execPath`，绝不走 `PATH` | spec | `tsx v2-resolution-priority.mts` | ✅ | `{"path":"/usr/local/n/versions/node/24.3.0/bin/node","source":"process-exec-path","electronRunAsNode":false}`；模拟 Electron 下 `electronRunAsNode:true` → `ELECTRON_RUN_AS_NODE === '1'`；`PATH shim shadows node which=/tmp/…/node` 但 `PATH node is not selected resolved=…/24.3.0/bin/node` |
| AC-7 阻止 spawn、先于 socket | spec | `tsx --import … v3-e2e-preflight.mts` | ✅（运行时） | 场景 1：`kind=node-environment`、`host.status=error`、`host.errorMessage === diagnostic`、`diagnostic.kind=missing-apis`、无 socket、`spawnCount=0`、无 witness 文件、`elapsed=8ms of 60000ms bound`（即非握手超时）。场景 2/3/5 形态相同 |
| AC-8 五要素诊断 | spec | `tsx --import … v3-e2e-preflight.mts` | ✅（运行时） | 真实消息恰为 5 行：路径 ✅、实测版本 `20.16.0` ✅、期望范围（同时含 `22.19` 与 `24`）✅、两个 API 名 ✅、两条修复指令（`DSH_NODE_BIN` 与 `dsh.nodeBin`）✅ |
| AC-9 归类为环境问题而非 dsh 缺陷 | spec | `tsx --import … v3-e2e-preflight.mts`、`tsx v4-m2-classification.mts` | ✅（运行时） | 首行 `Node environment check failed — source: dsh.nodeBin setting`；全文不含 `dsh bug` / `internal error` / `defect` / `broken`；该归类在三个独立观测中都存活到消费者快照（见 §3） |
| AC-10(a) manifest 设置面 | spec | 读取 manifest | ✅（静态） | `dsh.nodeBin`：`type "string"`、`default ""`、`scope "machine-overridable"`、非空 `description`（写明两个 API、版本范围、解析顺序与「Leave empty to not participate in resolution」） |
| AC-10(b) 优先级链写进文档 | spec | `tsx v5-docs-ac2-ac3.mts` | ✅（静态） | 两种开发文档均含 `DSH_NODE_BIN`、`dsh.nodeBin`、`process.execPath` |
| AC-10(c) 设置来源与同一对象 | spec | `tsx v2-resolution-priority.mts` | ✅（运行时） | 空 env + `nodeBinSetting='/y/from-setting'` → `{"path":"/y/from-setting","source":"vscode-setting"}`；`spawn command is the setting`；无 Electron 标志；`AD-1 retained object is spawned /frozen/node`、`AD-1 absent object resolves fresh /x/later` |
| AC-10(d) 无效设置 fail loud、无回退 | spec | `tsx --import … v3-e2e-preflight.mts` | ✅（运行时） | 场景 2（设置来源的 `missing`）：`kind=missing`、`spawnCount=0`、无 socket、消息含该不存在路径。场景 5：`not-executable`。场景 7（同一路径经真实 `activate()`）：快照 `state=failed`、`errorKind=node-environment`、消息同时含路径与 `dsh.nodeBin` |
| AC-10(e) 扩展读取设置并显式传入 | spec | `tsx --import … v3-e2e-preflight.mts` | ✅（运行时） | 场景 6：真实激活先读 `dsh` 再读 `dsh.nodeBin`；非字符串 fail loud（`dsh.nodeBin must be a path to a Node.js executable string, got number`）、`spawnCount=0`、且**没有**前置校验诊断（说明抛出早于 Host 启动）。场景 8 为正向且是最强可得证据：**仅**由 `settings.json` 命名的可执行文件成为真正被 spawn 的解释器——spawn 日志 `{"command":"/tmp/dsh-verify-e2e-oXsiak/node-good-8","args":["--import",…"apps/cli/src/bin.ts","--profile","ide",…]}` |
| AC-10(f) 真机分支 | Phase 3 | Phase 1 内不可得 | ⏳ 已登记 | 跨 Phase 依赖，见文首方框与 §4.4。不计为 Phase 1 失败；此处也不声称已验证 |
| 回归（差量） | spec | §0.1 / §0.2 | ✅ | typecheck 绿；`packages/sdk/client` 绿；`apps/vscode-dsh`、`test:docs`、`lint` 红且失败集合与基线完全一致；新增行零诊断 |

### 1.1 AC-10 无效设置分支的证据强度（spec 强制要求标注）

该分支由两部分组成，第一部分**是代理证据**：

1. **代理证据** —— 运行后预置 `settings.json` 字节未变（`AC-10d proxy: settings.json untouched bytes identical`）。它只能说明扩展没有把该设置改写成别的来源。
2. **不可代理的负面证据** —— **没有**任何 Host 子进程被创建（`AC-10d real activation spawn count 0`、`AC-10d no socket`、`existsSync(bridgeSockPath)===false`）。这是该场景中脚本唯一无法自证的观测。

按用户 HG-2 裁定未新增独立观测点，因此本报告**不**把该分支表述为「已直接观测到解析链消费了设置项」。设置真正到达 spawn 的直接正向观测确实存在，但经由场景 8 的真实 `activate()`，而非任何 `.test.*` 投影。

---

## 2. 本验证者独立设计的场景

implementer 的测试不构成任何判决的依据。下列每一行都自建输入、调用产品代码、断言可观测输出。

| # | 场景 | 脚本 | 结果 |
|:--:|---|---|:--:|
| 1 | 实际加载的是哪个模块平面，使其余各行都能写明自己测的是哪个产物 | `v0-resolution-probe.mts` | ✅ `@deepseek-ai/dsh-sdk-client` → `packages/sdk/client/src/index.ts` |
| 2 | 在 spec 指定的各根目录定位被 pin 的版本，再对定位到的解释器跑出货门槛；独立实现的版本范围谓词自带对照 | `v1-ac1-pinned-locate.mts` | ✅ 21 行（17 条断言 + 4 条 INFO），`FAILURES=0` |
| 3 | 经真实入口遍历所有来源组合：env/设置冲突、空白边界、真正遮蔽 `node` 的 `PATH` shim、模拟 Electron | `v2-resolution-priority.mts` | ✅ 19 行，`FAILURES=0` |
| 4 | 驱动真实 `IdeSessionHost` 与真实扩展 `activate()` 的八个场景，`child_process.spawn` 由 preload 包装**计数**而非推断 | `v3-e2e-preflight.mts` | ✅ 46 行，`FAILURES=0` |
| 5 | 消费者可见的归类及其可证伪性（一行变异体），并（本轮新增）加一道漂移护栏证明该变异体就是出货模块减那一行 | `v4-m2-classification.mts` + `mutation/auto-start-orchestrator-flattened.ts` | ✅ 9 行，`FAILURES=0` |
| 6 | AC-2 / AC-3 的文档契约，附必然使各谓词变假的反证 | `v5-docs-ac2-ac3.mts` | ✅ 18 行，`FAILURES=0` |
| 7 | **本轮新增 — N3.1：** `source` 是否改变任何校验结果（还是只改文案），以及探测模式是否由 `electronRunAsNode` 而非 `source` 决定 | `v6-source-label-behaviour.mts` | ✅ 10 行，`FAILURES=0` |

场景 4 的存在是必要的：只有当同一套计数在场景 4 中记录到 spawn（`spawnCount=1`、shim 日志与 witness 文件均已写出）时，场景 1 的「无子进程」才构成证据。

### 2.1 独立构造的端到端运行时路径（构造输入 → 执行 → 断言输出/退出码）

最强的一条路径：**`settings.json` 的值 → 真实 `vscode.workspace.getConfiguration('dsh').get('nodeBin')` → `readNodeBinSetting` → `IdeSessionHost.start` → 解析 → 前置校验 → 真实 `child_process.spawn`，由 preload 包装计数。**

- 构造输入：临时 `settings.json`，其 `dsh.nodeBin` 指向一个可执行 shim；`DSH_NODE_BIN` 未设置。
- 执行：真实 `activate()` + 真实 `dsh.test.requestStart`；该 shim 是 shell 脚本，先写自己的日志再 `exec` 真实 Node。
- 断言输出：`spawnCount >= 1`；shim 调用日志存在；spawn 日志的 command 字段恰为该 shim 路径，argv 为 `… apps/cli/src/bin.ts --profile ide …`。
- 同一路径的失败孪生：设置指向 `missing` 路径 → `state=failed / errorKind=node-environment / spawnCount=0 / settings.json 字节未变`。

---

## 3. 已验证的端到端数据路径

| 数据路径 | 结果 | 证据 |
|---|:--:|---|
| `settings.json` → `getConfiguration('dsh').get('nodeBin')` → `readNodeBinSetting` → `start()` 选项 → `resolveNodeExecutableSpec` → `assertNodeExecutable` → 真实 spawn | ✅ | v3 场景 8 的 spawn 日志（command 恰为设置值） |
| `DSH_NODE_BIN` → 解析 → spawn | ✅ | v3 场景 4：shim 日志写出、witness 脚本被执行 |
| 不合格 Node → `NodeEnvironmentError` → `HostStartError('node-environment')` → `startErrorKindOf` → 快照 `errorKind` | ✅ | v3 场景 1（`error.kind`）、场景 7（真实激活快照）、v4 part A |
| 非字符串设置 → `HostStartError('invalid-setting')` → 快照 `errorKind` | ✅ | v3 场景 6（`D-2 non-string class is invalid-setting invalid-setting`） |
| 不合格 Node → 先于 `bridge.listen` 阻止 → 无 socket、无子进程 | ✅ | v3 场景 1、2、3、5 |
| SDK 公共面 → 扩展消费者 | ✅ | v0 探针显示两侧解析到同一源码模块 |

---

## 4. 转交事项（合并报告 §七 的 7 项，加上我被要求修的两条 F 项）

### 4.1 D-2 可证伪性 —— 在**仓库内**独立复现，并证明还原干净

correctness 视角的探针两次被以「仓外探针」为由阻断；连通性视角用自己的变异体复现过。我做了第三次复现，且用的是**出货中的仓库文件**而非任何夹具：

1. 基线：`git hash-object apps/vscode-dsh/src/auto-start-orchestrator.ts` → `63e427f48e78d8562a48083597f51d211b0be644`；`git diff -- <file> | sha256sum` → `5d9afbed6c26bfd87224b2459a638c673ae575599e89defe5ff719dd9bcb1435`。
2. 变异：从该文件的 `START_ERROR_KINDS` 中删除 `'invalid-setting',`。
3. 执行：`vitest run apps/vscode-dsh/tests/node-env-guard.spec.ts -t "classifies a non-string setting"` →

```
 × |thread-safe| … > classifies a non-string setting as invalid-setting, not a process failure 17ms
   → expected 'process-failed' to be 'invalid-setting' // Object.is equality
AssertionError: expected 'process-failed' to be 'invalid-setting'
 ❯ apps/vscode-dsh/tests/node-env-guard.spec.ts:744:32
    744|     expect(snapshot.errorKind).toBe('invalid-setting')
```

4. 还原：把该成员加回；`git hash-object` → `63e427f48e78d8562a48083597f51d211b0be644`（**一致**）、`git diff -- <file> | sha256sum` → `5d9afbed…`（**一致**）、`git diff --stat` 仍为 `+37 −7`。

因此 `node-env-guard.spec.ts:744` 的断言在出货文件上确实可证伪，且工作区可证已被还原到探针前的状态。这正是 correctness 视角留下的差异所在：仓内 `auto-start-orchestrator.spec.ts:166-176`（无 `kind` → `process-failed`）只验证**兜底**；上面的探针验证的是「删成员即红」，这才是 D-2 需要的主张。

### 4.2 N1（AC-1(b)）—— 独立确认为真 pass，而非恒 skip

`vitest run apps/vscode-dsh/tests/node-env-guard.spec.ts --reporter=verbose`：

```
 ✓ |thread-safe| … > locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) 55ms
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

被 skip 的用例会渲染成向下箭头并**不计入** `Tests passed`；此处是 `✓` 且耗时 55ms，与三次真实子进程能力探测相符，整个文件报告 **0 skipped**。该用例在构造上也非空洞（`node-env-guard.spec.ts:502-516`：只有一处都没定位到时才 `ctx.skip`；否则每个定位到的解释器都必须 `ok:true` **且** `report.version === pinned`，最后还有 `expect(located.length).toBeGreaterThan(0)`）。我自己的独立定位脚本（v1）找到同样的两个不同解释器路径，故 AC-1(b) 既被执行通过、也被独立佐证。

### 4.3 N3.1 —— 错标的 `source` 零行为影响；已实测

`node-env-guard.ts` 使用 `executable.source` 的地方恰有两处，且都是文案：`:120` → `sourceLabel`，被消息首行（`:170`）与 remedy（`:192`）消费。探测的调用模式由**独立字段** `executable.electronRunAsNode`（`:258`）驱动。我的独立探针（`v6-source-label-behaviour.mts`）对这两半都做了**测量**而非阅读：

- 同一候选、三种 `source` → **判定完全一致**：好候选为 `{"ok":true,"report":{"version":"24.3.0",…}}`；坏候选为 `{"ok":false,"kind":"missing-apis","missingApis":[…]}`，且 kind 不随 source 变化。
- 诊断文案**确实**随 source 不同（三种不同首行），故 `source` 并非惰性字段——只是文案。
- 探测模式：会记录自己所见标志位的 shim 报告，在 `electronRunAsNode:true` 下三种 source 均为 `ELECTRON_RUN_AS_NODE=1`，在 `false` 下三种均为 `unset`。模式跟随 `electronRunAsNode`，从不跟随 `source`。

结论：N3.1 维持原定级——测试/验证代码**失败路径**上的措辞缺陷，非 AC 失败。运行时定级走成功路径，那里该标签根本不会被渲染。

### 4.4 AC-10(f) —— 已登记，且该登记**确实**把判决压在 PARTIAL

依赖已按原文登记于文首，且 Phase 1 不因此判失败。但它仍然使判决不能为 PASS，两个理由指向同一结论：

1. **spec 已明文规定。** AC-10 的跨 Phase 说明写着「**不得** 因此把 AC-10 记为 known gap 后判 PASS」。一个被推迟、且按缝未取证的 AC 分支正是「已登记的缺口」，spec 直接封死了「登记后放行」这条捷径。
2. **我自己的判决定义。** `PASS` 要求所有验收标准达成且无 CRITICAL/MEDIUM 残余风险；一条 `[Must]` AC 的未验证分支不可能被定为 LOW。§6 中它登记为 MEDIUM。

这是**设计上**的限制，不是缺陷：该分支需要真机 Extension Development Host，而它归 Phase 3 所有。这一区分对 HG-3 决策很重要——诚实的读法是「Phase 1 自身范围已完整且经独立验证；一条 AC 的一个分支在构造上必须等到 Phase 3 才能结清」。我既没有为了推动流程而弱化判决，也没有为了好看而拔高：PARTIAL 是准确的词。

### 4.5 E-1 —— 成立：讲设置读取处引了 `(AD-10)`，应为 `(AD-9)`

`grep -n "AD-9\|AD-10" apps/vscode-dsh/src/extension.ts` →

```
224:     * Read this extension's settings (AD-10).
2173: * Read the `dsh.nodeBin` Node executable setting (AD-10). A non-string value
```

而 `design.md:225` = `### AD-9: 提供 dsh.nodeBin VS Code 设置项 …`；`design.md:243` = `### AD-10: AC-2 / AC-3 的文档落点 …`。两处引用都位于描述**读取设置**的新增行上，按编号追下去会落到文档决策。与所报一致。无运行时影响。

### 4.6 E-2 —— 成立：成员列表与来源句不自洽

- `session-host.ts:43`：「Class of a failed {@link IdeSessionHost.start}」。
- `auto-start-orchestrator.ts:36`：「the `HostStartErrorKind` vocabulary `IdeSessionHost.start` throws with」。
- 该成员的实际抛出面：`extension.ts:2186`，位于 `readNodeBinSetting` 内，而它由 `createStartHostPort` 的 `start()`（`extension.ts:2210-2217`）调用——即 `StartHostPort` 实现，**不是** `IdeSessionHost.start`。
- `grep -rn "invalid-setting" apps/vscode-dsh/src/` 只返回词表/JSDoc 各处加那一处抛出。与所报一致。无运行时影响。

### 4.7 E-3 —— 成立：`implementation.md` §2.3 把本 Phase 自己写的文件归为既有改动

`implementation.md:105` 仍写着：

```
| `.cursor/skills/project-build/SKILL.md`, `.specdev/specs/workflows.json` | modified | Pre-existing. |
```

实测：mtime `2026-09-15 20:11:19 +0800`（本轮修复窗口内；调度者测得 09-14 17:10 → 09-15 20:11）、`git diff --stat` → `1 file changed, 25 insertions(+), 2 deletions(-)`，且 diff 中命中本 Phase 关键词（`invalid-setting|24.3.0|nodeBin|20.16`）**8** 处。该文件受 git 跟踪，而 `.cursor/skills/project-test/SKILL.md` 未跟踪（`git ls-files --error-unmatch` 失败）。故「Pre-existing」的归类自本轮起失实；且如 design 视角所指，它影响的是 HG-3 提交范围而非运行时行为——属文档更正，不是代码缺陷。

### 4.8 F-1 与 F-2 —— 本轮由我修复（均为我自己的产物）

**F-1。** `v3-e2e-preflight.mts:236` 原先断言的是修复前的值。现为 `check('D-2 non-string class is invalid-setting', snapshot.errorKind === 'invalid-setting', …)`，过期的 "today" 标签已删除，且该场景带有注释说明为何此处留一份过期期望会**制造**假红。重跑全套脚本后每个脚本均 `FAILURES=0`，该行由真实激活报出 `invalid-setting`。

**F-2。** `mutation/auto-start-orchestrator-flattened.ts` 不再是滞后的副本：它现在是出货 `auto-start-orchestrator.ts` 恰好删掉一行（`  'node-environment',`）、其余完全一致，且 `v4-m2-classification.mts` **程序化强制**这一关系，而不再用文字声称。新增护栏会计算两文件的「单行删除 diff」并输出 `removed line 30: "  'node-environment',"`；任何新增行、改动行或第二处删除都会使其失败。v4 的 part D 仍观测到 `real=node-environment mutant=process-failed`，可证伪对照仍然有效。

### 4.9 F-3 —— 记为 Phase 2 输入，Phase 1 无需改动

`launch.ts:131-145` 对三个来源中的两个**原样返回调用方给的值**——`{ path: environmentValue, source: 'dsh-node-bin' }` 与 `{ path: setting, source: 'vscode-setting' }`（后者仅有 `setting.trim() !== ''` 这一道守卫）。只有 `process-exec-path` 有绝对性保证。故 `ResolvedNodeExecutable.path` **仅**对第 3 级绝对，Phase 2 必须为 `invalid-setting` 补明确映射分支、并在读 `.diagnostic` 前按 `kind` 收窄。已记录给 Phase 2；Phase 1 无需改动（其自身路径 `session-host.ts:289-292` 只消费该对象、不假设其绝对性）。

---

## 5. 桩感知验证

`tech-debt-registry.md` 活跃表仅 1 条 `DEBT-004`（ide profile 主会话不可写，用户裁定本工作流不修，且不在 Phase 1 路径上），另有新解决的 `DEBT-005`/`DEBT-006`/`DEBT-007`。关键路径参数变化测试：`resolveNodeExecutableSpec` 在不同输入下给出三种不同结果（`/x/node` / `dsh-node-bin`、`/y/from-setting` / `vscode-setting`、`process.execPath` / `process-exec-path`），`validateNodeEnvironment` 对 24.3.0 返回 `ok:true`、对四种失败给出四个不同 kind（`missing`、`not-executable`、`unusable`、`missing-apis`）——两者的输出都随输入变化，均非桩。未发现未登记的桩，故未新增 registry 条目。我另外核验了三条已解决条目确属真解决：D-1 条目码零命中（见下与 §7），D-2 是真实成员且有已证伪证明，N1 是真跑用例。

---

## 6. 残余风险

| 风险 | 严重性 | 说明 |
|---|:--:|---|
| AC-10(f) 真机分支未验证 | 🟡 MEDIUM | 按设计推迟到 Phase 3。在此之前 AC-10 证据不完整。已登记，未打折 |
| AC-1(b) 自动化在无该 pin 安装的机器上会 skip | 🟢 LOW | 本机该用例真跑通过（55ms、0 skipped），本报告也独立复现了主机事实；但在没有 24.3.0 安装的机器上它会报 `skipped` 而非失败。这正是 spec 验证策略与 DEBT-007 所规定；记录下来以免被误当成门禁 |
| E-1 / E-2 的 `AD` 编号错引与「成员来源句」不准确 | 🟢 LOW | 仅注释/JSDoc 保真；无行为影响、无 AC 依赖。但更正它们需改产品源码，而回路上限现已阻断——见 §7 |
| E-3 `implementation.md` 对某文件归属失实 | 🟢 LOW（行为面）/ 需决策 | 影响 HG-3 提交集合，不影响运行时行为 |
| N3.1 `source:'process-exec-path'` 标注了非 `execPath` 的解释器 | 🟢 LOW | §4.3 已实测证明仅文案影响，且位于测试/验证代码的失败路径 |
| 验证脚本不受仓库门禁覆盖 | 🟢 LOW | `test-scripts/*.mts` 不在 `typecheck`/`lint` 覆盖内（该目录诊断数为 0）；它们真正的检查是「能执行」，本轮确实执行了 |
| 顺序证明来自代码次序加实测的「无发生」，而非注入竞态 | 🟢 LOW | 「无 socket、无子进程」在四个失败场景中被测量；未在敌意调度下做交错实验 |

无 CRITICAL 风险。无 MEDIUM **功能**风险。

---

## 7. 问题清单 —— 仍未闭合的项（判决为 PARTIAL）

1. **AC-10(f) 未在 Phase 1 验证。** 真机消费分支需要 Phase 3 的冒烟脚本（AD-11）。已登记的跨 Phase 依赖不等于已解决的验收项，故本 Phase 不能直接放行。这是本判决不为 PASS 的**唯一**原因。
2. **E-1** —— 把 `extension.ts:224` 与 `:2173` 的 `(AD-10)` 改为 `(AD-9)`。
3. **E-2** —— `session-host.ts:43` 与 `auto-start-orchestrator.ts:36` 的来源句未覆盖 `invalid-setting`，该成员由 `extension.ts` 的 `readNodeBinSetting`（在 `StartHostPort` 内）抛出，而非 `IdeSessionHost.start`。
4. **E-3** —— `implementation.md:105` 把 `.cursor/skills/project-build/SKILL.md` 归为「Pre-existing」，但本轮 implementer 确实写了它（mtime 20:11、`+25 −2`、8 处 Phase 关键词）。影响 HG-3 提交集合。
5. **N3.1** —— `node-env-guard.spec.ts:509` 与 `v1-ac1-pinned-locate.mts` 把定位到的解释器标为 `source:'process-exec-path'`。零行为影响（§4.3）；需要更正的是措辞。
6. **F-3** —— Phase 2 必须补 `invalid-setting` 的明确映射分支，并在读 `.diagnostic` 前按 `kind` 收窄；`launch.ts:131-145` 只对 `process-exec-path` 保证绝对性。
7. **F-1 / F-2 已闭合** —— 由本验证者在本轮修复，变异体漂移现由护栏强制（§4.8）。

**第 2、3 条需要编排者/用户决策。** 它们是**产品源码**改动（`apps/vscode-dsh/src/*.ts`），而本 Phase 的 `loop_count` 已达上限 2，`pipeline-gate.sh` 会拒绝 implementer 派发。因此我**不**假定还有回炉轮次：要么用户授权在回路之外做这些注释级更正，要么把它们作为已知文档债承接。第 4 条（spec 侧文档）与第 6 条（Phase 2 输入）不受该回路上限阻断。

为什么判 PARTIAL：上一轮 PARTIAL 的三条驱动（D-1、D-2、N1）均经独立复核**确认已修**，故旧理由不再成立。剩下的是**唯一一条设计上的推迟**（AC-10(f)，spec 禁止提前结清），以及 7 条我逐条定级过的开放项：除 F-3 属 Phase 2 外，全部是注释、引用或提交归属层面的保真问题，零行为影响。没有验收标准失败，没有端到端路径断裂，也不存在 CRITICAL 或 MEDIUM 功能缺陷。

---

## 8. 与上一轮判决的差异

| 轮次 | 判决 | 驱动原因 |
|---|:--:|---|
| 第 1 轮（2026-09-15 19:05） | PARTIAL | (1) AC-10(f) 推迟；(2) N1 —— AC-1(b) 的自动化断言的是 `process.execPath`；(3) D-1 未修；(4) D-2 未修。另有 AC-1(b) 无仓内覆盖的 MEDIUM |
| 本轮 | PARTIAL | **仅** AC-10(f)，且属设计使然。驱动 (2)(3)(4) 已消失；AC-1(b) 覆盖的 MEDIUM 也已消失 |

变化发生在**证据**层，而不只是文字层：

- **(2) N1** —— 该用例现已实现 spec 的三处定位逻辑，且本轮**真跑**（55ms、`✓`、28 passed / 0 skipped，§4.2）。此前该 AC 的证据完全依赖我自己仓外的脚本。
- **(3) D-1** —— `grep -rnE '\((S[0-9]+|M[0-9]+)[,)]|// *(S|M)[0-9]+:' apps/vscode-dsh/` 退出码 1（零命中），同时 `AD-*` 引用仍在（`session-host.ts` 5 处、`extension.ts` 2 处、`auto-start-orchestrator.ts` 1 处），即条目码被移除而未误删合法的决策编号。
- **(4) D-2** —— `invalid-setting` 是真实传播的词表成员（三处集合结构性相等），实测快照归类为 `invalid-setting`，且我在出货文件上复现了「删成员即红」的证伪并证明还原干净（§4.1）。
- 本轮新增：我**自己证据通道**的两个缺陷（F-1 过期断言、F-2 漂移变异体）已修复，且变异体漂移改为程序化强制；N3.1 由**测量**而非阅读结清（§4.3）。

判决**数值**未变，但不是出于惯性：驱动原因的成分已完全改变——从「三条开放项 + 一处覆盖缺口」变成「一条设计上的跨 Phase 推迟」。我没有沿用上一轮的 PARTIAL，也没有把它升为 PASS——决定性的规则是 spec 自己禁止提前结清被推迟的 AC 分支。

---

## 9. Pipeline 合规

- 分支：`impl-phase-1-node-env-preflight` —— 要求的那个分支，在任何结论之前已确认。✅
- Phase 1 改动在该分支的工作区中、未提交，符合工作流要求（implementer 不提交；由编排者在 HG-3 统一提交）。
- HEAD `d92b0e55e1` 不含 Phase 1 代码；所有 ref 上最近 6 个提交均为收尾/其他 Phase 的提交。
- 无任何非 spec 文件在 `impl-*` 分支之外被改动。
- 工作区中存在但**未**归因于 Phase 1 的既有产物：`pnpm-lock.yaml`、`apps/vscode-dsh/webview/dist/assets/*`、`.specdev/specs/workflows.json`。
- 方法约束已遵守：未使用任何 git 写命令（仅用 `hash-object`、`diff`、`log`、`ls-files`、`branch`、`rev-parse`）；对 `auto-start-orchestrator.ts` 的变异以编辑器编辑完成并还原为**同一 blob**；未修改 `current-status.json`、`review.md`、`review-*.md`、`implementation.md`、`spec.md`；未创建任何 commit。
- 启动自清理：本轮开始前已用 `mv` 把上一轮的 `verification.md` 与 `verification-zh.md` 归档到 `.archive/verification-{,-zh}-20260915T123532Z.md`。

---

## 10. 验证脚本

全部位于 `.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/test-scripts/`。

| 脚本 | 用途 | 本轮 |
|---|---|---|
| `spawn-counter-preload.mjs` | 包装 `child_process.spawn` 并把每次调用追加到 `DSH_VERIFY_SPAWN_LOG`，使「无子进程」成为**测量值** | 未改 |
| `run-harness.sh` | 设置 `PATH` 与 spawn 日志后经 `tsx` 运行场景 | 未改 |
| `v0-resolution-probe.mts` | 指明各 import 实际解析到的模块平面（源码 vs 构建后的 `lib`） | 0 失败 |
| `v1-ac1-pinned-locate.mts` | AC-1(a)(b)(c)：在要求的各根目录定位被 pin 的版本，并对其跑出货门槛 | 21 行（17 断言），0 失败 |
| `v2-resolution-priority.mts` | AC-5、AC-6、AC-10(c)、AD-1 同一性、空白边界、`PATH` shim、Electron 标志 | 19 行，0 失败 |
| `v3-e2e-preflight.mts` | 经真实 host 与真实激活覆盖 AC-4、AC-5 失败路径、AC-7、AC-8、AC-9、AC-10(d)(e)、D-2 | 46 行，0 失败；**F-1 已修** |
| `v4-m2-classification.mts` + `mutation/auto-start-orchestrator-flattened.ts` | AC-9 归类及其可证伪性，加变异体漂移护栏 | 9 行，0 失败；**F-2 已修** |
| `v5-docs-ac2-ac3.mts` | AC-2、AC-3、AC-1(c)、AC-10(b) 的静态断言附反证（明确非端到端） | 18 行，0 失败 |
| `v6-source-label-behaviour.mts` | **新增** —— N3.1：`source` 只影响文案，探测模式跟随 `electronRunAsNode` | 10 行，0 失败 |

合计 119 条断言被执行、0 失败、无静默 skip（唯一带 skip 机制的 `v1` 把「未定位到」转成记录在案的 FAIL，而非 skip）。

复现命令：

```sh
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
TS=.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/test-scripts
./node_modules/.bin/tsx $TS/v0-resolution-probe.mts
./node_modules/.bin/tsx $TS/v1-ac1-pinned-locate.mts
./node_modules/.bin/tsx $TS/v2-resolution-priority.mts
DSH_VERIFY_SPAWN_LOG=/tmp/dsh-verify-spawn.log \
  sh $TS/run-harness.sh --import ./$TS/spawn-counter-preload.mjs ./$TS/v3-e2e-preflight.mts
./node_modules/.bin/tsx $TS/v4-m2-classification.mts
./node_modules/.bin/tsx $TS/v5-docs-ac2-ac3.mts
./node_modules/.bin/tsx $TS/v6-source-label-behaviour.mts
```
