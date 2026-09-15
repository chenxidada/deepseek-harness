# Phase 1 验证报告（中文版）— phase-1-node-env-preflight

## 判决：PARTIAL

Phase 1 范围内的十条验收标准（AC-1 – AC-10(e)）全部达成，且每条都有独立执行证据；AC-10(f) 是已登记的对 Phase 3 的跨 Phase 依赖；另有两项未修复的 SHOULD-FIX 审查事项（D-1、D-2）与一处自动化覆盖缺口（N1）仍开放。按工作流规则「已记录 ≠ 已解决」，本 Phase 判决为 PARTIAL，而非直接通过。未发现任何 CRITICAL 或 MEDIUM 级功能缺陷。

验证在分支 `impl-phase-1-node-env-preflight`（工作区未提交，无 Phase 1 commit）上执行，HEAD 为 `d92b0e55e1`。

## 0. 验证环境与测量口径

| 项目 | 本次实测值 |
|---|---|
| 当前分支 | `impl-phase-1-node-env-preflight`（与要求一致） |
| 默认 `node` | v20.16.0 — 不合格（缺 `zlib.createZstdDecompress`、`Promise.withResolvers`） |
| 所有命令使用的合格 Node | `/usr/local/n/versions/node/24.3.0/bin` |
| 命令前缀 | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm --config.verify-deps-before-run=false` |
| 被验证的模块面 | 源码面：`sdk-client` 解析到 `packages/sdk/client/src/index.ts`（证据见 §2.1） |

差量验收严格按 spec「执行环境与基线快照」执行：基线本身部分为红，验收口径是**零新增失败且失败集合一致**，而不是全绿。

### 0.1 差量回归矩阵

| 门禁 | 基线（spec） | 本次实测 | 新增失败 |
|---|---|---|---|
| `pnpm run typecheck` | 绿 | exit 0（`tsc -b tsconfig.client.json`） | 0 |
| `pnpm run test packages/sdk/client` | 绿（3 文件 / 73 用例） | exit 0 — `Test Files 3 passed (3)`、`Tests 84 passed (84)` | 0 |
| `pnpm run test apps/vscode-dsh` | 红 — 4 文件 / 6 用例 | exit 1 — `Test Files 4 failed \| 46 passed (50)`、`Tests 6 failed \| 350 passed \| 1 skipped (357)` | 0 |
| `pnpm run test:docs` | 红 — 10 passed / 5 failed | exit 1 — `run-gates: 10 passed, 5 failed, 0 skipped in 24.83s` | 0 |
| `pnpm run lint` | 红 | exit 1 — 10381 条诊断 / 262 个文件（**规则集：`.oxlintrc.json`**，即门禁权威规则集） | 0 |

`apps/vscode-dsh` 失败集合（与基线完全一致，均为既有失败）：`spike-t0b-continue-capability.spec.ts`、`panel-close-delete.e2e.spec.ts`、`spike-t0a-replay-rebuild.spec.ts`（4 用例）、`verifier-phase1/layer-a-rtl.spec.tsx`。
`test:docs` 失败门禁（与基线完全一致）：markdown wrap、agent note format、documentation standard tests、markdown links、translation pairing。
以上失败集合中**不含任何 Phase 1 改动文件**，故零新增成立；Phase 1 自身产物在「本可绿」的每个门禁中均为绿。

Phase 1 自身关注用例亦通过：`vitest run node-env-guard.spec.ts session-host-preflight.spec.ts auto-start-orchestrator.spec.ts launch.spec.ts` → `Test Files 4 passed (4)`、`Tests 69 passed (69)`。这证明 implementer 的测试可运行，但**不是**下文任何判决的依据。

### 0.2 lint 逐文件与新增 hunk 的对照

规则集：`.oxlintrc.json`（门禁）。`.oxlintrc.staged.json` 是无类型分析的缩减集，不是下表数字的来源。

| 文件 | 诊断数 | 新增区间（来自 `git diff -U0`） | 是否落在新增行 |
|---|:--:|---|:--:|
| `apps/vscode-dsh/src/extension.ts` | 22 | 48；223-236；2172-2190；2253；2256 | 否 — 诊断行为 271、375、380、385、407、425、662、750、1004、1102、1152、1418、1450、1492、1534、1791、2109×2、2110、2111、2270、2272 |
| `apps/vscode-dsh/src/session-host.ts` | 1 | 14；16；27；29；42-79；106-109；253-254；285-290；300；321-327 | 否（第 595 行） |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 1 | 26-55；220 | 否（第 230 行） |
| `apps/vscode-dsh/src/index.ts` | 1 | 25-39 | 否（第 97 行） |
| `apps/vscode-dsh/src/node-env-guard.ts`（新增） | 0 | 全部新增 | — |
| `tests/node-env-guard.spec.ts`、`tests/session-host-preflight.spec.ts`（新增） | 0 | 全部新增 | — |
| `packages/sdk/client/src/{launch,types,index}.ts`、`tests/launch.spec.ts` | 0 | 全部新增 | — |

即：诊断行与新增 hunk 的交集为空 → 零新增 lint 诊断。

## 1. 测试执行矩阵

每条 AC 独占一行。标注「静态」的行是文本/结构断言，**显式声明为非端到端**；每条行为型 AC 另有运行时行。

| 验收标准 | 来源 | 命令 | 结果 | 证据 |
|---|---|:--:|:--:|---|
| AC-1(a) `.nvmrc` 机器可读 pin | spec | `tsx v1-ac1-pinned-locate.mts` | ✅ | `PINNED=24.3.0`；`od -c .nvmrc` → `2 4 . 3 . 0 \n`（7 字节、仅一个换行、无 CR）；无 `.node-version` / `.tool-versions`；根 `engines.node` = `^22.19.0 \|\| >=24.0.0`，与门禁常量 `EXPECTED_NODE_RANGE` 完全一致 |
| AC-1(b) 以 pin 版本运行门禁 | spec | `tsx v1-ac1-pinned-locate.mts` | ✅ | spec 指定的三处定位中命中两处：`/usr/local/n/versions/node/24.3.0/bin/node`（24.3.0）与 `/usr/local/bin/node`（24.3.0）；`~/.nvm/versions/node/v24.3.0/bin/node` 不存在（本机未安装该版本）。对每个定位到的解释器调用 `validateNodeEnvironment` → `ok:true`、`version=24.3.0`、`hasZstd=true`、`hasWithResolvers=true`。谓词控制：22.19.0/24.3.0 被接受，22.18.0/23.5.0/20.16.0 被拒绝 |
| AC-1(c) 开发文档写出 `.nvmrc` 与 pin | spec | `tsx v5-docs-ac2-ac3.mts` | ✅（静态） | `docs/development.md` 与 `docs/development.zh.md` 均含 `.nvmrc` 与 `24.3.0` |
| AC-2 版本边界在文档中权威 | spec | `tsx v5-docs-ac2-ac3.mts` | ✅（静态） | 双语文档均含下限 `22.19`、归属（`engines.node` + `package.json`）、`zlib.createZstdDecompress`、`Promise.withResolvers`、`.jsonl.zstd` 日志链 |
| AC-3 两份职责清单、两面分列 | spec | `tsx v5-docs-ac2-ac3.mts` | ✅（静态） | 各标题出现次数均为 1；终端侧 3 条、扩展子进程侧 3 条且无任何交叉条目；仓库侧 5 行每行都给出 `pnpm run` 命令；本机环境侧每条均可判定（nvm / `n 24.3.0` / `export PATH=` / `node --version` / `DSH_NODE_BIN` / `dsh.nodeBin` / reload 命令）。负控制：删除任一标题后谓词在两种语言下都变假 |
| AC-4 预检先于 listen、先于 spawn | spec | `tsx --import spawn-counter-preload.mjs v3-e2e-preflight.mts` | ✅ | 三类失败端到端全覆盖：`missing-apis`（场景 1）、`missing`（场景 2、3）、`not-executable`（场景 5）。三者均为：`spawnCount=0`、`existsSync(bridgeSockPath)===false`、Host `status='error'`。顺序在源码层面亦可见：`session-host.ts:287-291`（`assertNodeExecutable` 在 `bridge.listen` 之前）、`:308`（`client.start()`）。正向对照（场景 4）：`spawnCount=1` 且子进程 witness 文件被写出——所以「计数为 0」是测量结果，不是插桩缺失 |
| AC-5 `DSH_NODE_BIN` 优先、不加 Electron 标志 | spec | `tsx v2-resolution-priority.mts` | ✅ | `DSH_NODE_BIN=/x/node` → `{path:'/x/node', source:'dsh-node-bin'}`；`resolveDshLaunch().command === '/x/node'`；在非 Electron 与模拟 Electron 两种情况下 `ELECTRON_RUN_AS_NODE === undefined`。环境压过设置：`DSH_NODE_BIN=/x/from-env` + `nodeBinSetting='/y/from-setting'` → 仍为 `dsh-node-bin`。失败路径（场景 3）：`DSH_NODE_BIN` 指向不存在文件 → `kind='missing'`、`source='dsh-node-bin'`、`spawnCount=0`。空白边界与 spec 的非对称一致：设置项空白等同未设置，环境变量空白等同已设置 |
| AC-6 第 3 级是 `process.execPath`，绝不查 `PATH` | spec | `tsx v2-resolution-priority.mts` | ✅ | `DSH_NODE_BIN` 未设置 + 设置为空串 → `{path: process.execPath, source:'process-exec-path', electronRunAsNode:false}`；模拟 Electron → `electronRunAsNode:true` 且 `ELECTRON_RUN_AS_NODE === '1'`。`PATH` 遮蔽用例：把 `node` 替身置于 `PATH` 之首后 `command -v node` 确实命中该替身（`which=/tmp/.../node`），但解析结果仍是 `process.execPath` —— 替身未被选用 |
| AC-7 启动在 socket / spawn 之前终止，两个来源共用同一路径 | spec | `tsx --import … v3-e2e-preflight.mts` | ✅ | 场景 1（设置来源、`missing-apis`）：`error.kind==='node-environment'`、`host.status==='error'`、`host.errorMessage` 与抛出的诊断逐字相同、无 socket、`spawnCount=0`、无 witness 文件、耗时 8 ms（对照 60000 ms 握手上限）。场景 2（设置来源 `missing`）与场景 3（环境变量来源 `missing`）行为一致 |
| AC-8 五要素诊断 | spec | `tsx --import … v3-e2e-preflight.mts` | ✅ | 真实消息 5 行：`Node environment check failed — source: dsh.nodeBin setting` / `Executable: …/node-legacy-1` / `Actual: Node.js 20.16.0 does not provide zlib.createZstdDecompress, Promise.withResolvers` / `Expected: Node.js ^22.19.0 \|\| >=24.0.0 with …` / `Fix: … set DSH_NODE_BIN or the dsh.nodeBin setting …`。断言：路径 ✅、实际版本 `20.16.0` ✅、期望范围（同时含 `22.19` 与 `24`）✅、两个 API 名 ✅、两条修复指令（`DSH_NODE_BIN` 与 `dsh.nodeBin`）✅ |
| AC-9 首行环境归类、无代码缺陷归因 | spec | `tsx --import … v3-e2e-preflight.mts`、`tsx v4-m2-classification.mts` | ✅ | 首行给出环境与来源归类；全文不匹配 `dsh bug` / `internal error` / `defect` / `broken`。归类在三次独立观测中都存活到消费者快照（见 §4 M2） |
| AC-10(a) manifest 表面 | spec | `Grep apps/vscode-dsh/package.json:60-66` | ✅（静态） | `dsh.nodeBin`：`type: "string"`、`default: ""`、`scope: "machine-overridable"`，description 非空且写明两项 API 要求、支持范围、优先级链与「留空表示不参与解析」 |
| AC-10(b) 优先级链写入文档 | spec | `tsx v5-docs-ac2-ac3.mts` | ✅（静态） | 双语 `docs/development.md`(+`.zh.md`) 均含 `DSH_NODE_BIN`、`dsh.nodeBin`、`process.execPath` |
| AC-10(c) 空设置 → vscode-setting、同一对象 | spec | `tsx v2-resolution-priority.mts` | ✅ | 空环境 + `nodeBinSetting='/y/from-setting'` → `{path:'/y/from-setting', source:'vscode-setting'}`；`resolveDshLaunch({nodeExecutable: spec})` 以 `/y/from-setting` 为 spawn 命令且无 Electron 标志。`AD-1` 同一性：已保留对象即为被 spawn 命令且不再重新解析，缺省时才重新解析 |
| AC-10(d) 无效设置 fail loud、无回退 | spec | `tsx --import … v3-e2e-preflight.mts` | ✅ | 场景 2（设置指向不存在路径）：`kind='missing'`、`spawnCount=0`、无 socket、消息含该路径。场景 7（同路径经真实 `activate()`）：快照 `state='failed'`、`errorKind='node-environment'`、消息同时含路径与 `dsh.nodeBin` |
| AC-10(e) 扩展读取设置并以显式输入传入 | spec | `tsx --import … v3-e2e-preflight.mts` | ✅ | 场景 6：真实激活先读 `dsh` 再读 `dsh.nodeBin`；非字符串值 fail loud（`dsh.nodeBin must be a path to a Node.js executable string, got number`）、`spawnCount=0`、且**无预检诊断**（说明抛出发生在 Host start 之前）。场景 8（正向，且是现有最强证据）：仅由 `settings.json` 指定的可执行文件成为**实际被 spawn 的解释器** —— spawn 日志为 `{"command":"/tmp/dsh-verify-e2e-…/node-good-8","args":["--import","…/tsx/dist/esm/index.mjs","…/apps/cli/src/bin.ts","--profile","ide","--patch",…],"pid":…}` |
| AC-10(f) 真机分支 | Phase 3 | Phase 1 不可得 | ⏳ 已登记 | 见 §4 第 4 项、§7 第 1 项。Phase 1 判定范围是 (a)–(e)，真机 Extension Development Host 证据由 Phase 3 提供（AD-11）。此条**不**计作 Phase 1 失败，本报告也**不**声称真机分支已验证 |
| 回归（差量） | spec | §0.1 | ✅ | typecheck 绿；`packages/sdk/client` 绿；`apps/vscode-dsh`、`test:docs`、`lint` 均红在**与基线完全相同的失败集合**上 —— 零新增 |

## 2. 本验证者独立设计的场景

implementer 的测试未被复用为证据。以下每个场景自建输入、调用生产代码、断言可观测输出。

| # | 场景 | 脚本 | 结果 |
|:--:|---|---|:--:|
| 1 | 判定实际被验证的模块面（源码 vs 构建产物 `lib`），使后文每行证据都能点名被测量的产物 | `v0-resolution-probe.mts` | ✅ `@deepseek-ai/dsh-sdk-client` → `packages/sdk/client/src/index.ts`；范围常量读自 `src/node-env-guard.ts` |
| 2 | 在 spec 指定的三处定位 pin 版本，并对定位到的解释器运行实际门禁；自带独立范围谓词及其控制 | `v1-ac1-pinned-locate.mts` | ✅ 24 行、`FAILURES=0` |
| 3 | 用真实解析入口覆盖所有来源组合：环境/设置冲突、空白边界、真实遮蔽 `node` 的 `PATH` 替身、模拟 Electron 运行时 | `v2-resolution-priority.mts` | ✅ 19 行、`FAILURES=0` |
| 4 | 驱动真实 `IdeSessionHost` 与真实扩展 `activate()` 的 7 个场景，`child_process.spawn` 由 preload 包装器**计数**而非推断 | `v3-e2e-preflight.mts` | ✅ `FAILURES=0` |
| 5 | 消费者实际拿到的归类，并加一个移除 `node-environment` 词汇的变异体以证明该断言**可以变假** | `v4-m2-classification.mts` + `mutation/auto-start-orchestrator-flattened.ts` | ✅ 7 行、`FAILURES=0`；真实 → `node-environment`，变异体 → `process-failed` |
| 6 | AC-2 / AC-3 的文档契约，并对每个谓词施加**必须使其变假**的负控制 | `v5-docs-ac2-ac3.mts` | ✅ 18 行、`FAILURES=0` |

场景 4 的存在理由：一次通过只有在正向对照下才成立——场景 1 的「无子进程」之所以是证据，是因为场景 4 用同一套插桩记录到了 spawn（`spawnCount=1`、witness 文件被写出）。

## 3. 已验证的端到端数据路径

| 数据路径 | 结果 | 证据 |
|---|:--:|---|
| `settings.json` `dsh.nodeBin` → `getConfiguration('dsh').get('nodeBin')` → `readNodeBinSetting` → `start()` 选项 → `resolveNodeExecutableSpec` → `assertNodeExecutable` → `HarnessClient` spawn | ✅ | 场景 8 spawn 日志：被 spawn 的命令正是设置指定的替身，运行 `apps/cli/src/bin.ts --profile ide` |
| `DSH_NODE_BIN` → `resolveNodeExecutableSpec` → spawn | ✅ | 场景 4：替身调用日志被写出、witness 脚本被执行 |
| 无效 Node → `NodeEnvironmentError` → `HostStartError('node-environment')` → `AutoStartOrchestrator.startErrorKindOf` → 快照 `errorKind` | ✅ | 场景 1（`error.kind`）、场景 7（真实激活快照）、v4 A 组（快照） |
| 无效 Node → 在 `bridge.listen` 前终止 → 无 socket、无子进程 | ✅ | 场景 1、2、3、5：`spawnCount=0`、`existsSync(socket)===false` |
| `packages/sdk/client` 公共面 → 扩展消费者 | ✅ | v0 探针显示扩展侧导入解析到与优先级用例相同的源码模块 |

## 4. 审查转交的 6 项事项结论

**1. N1 — AC-1(b)。** 审查所述正确：`node-env-guard.spec.ts:449-461` 校验的是 `process.execPath`，而非 spec 字面的「在三处定位 pin 版本」。我的独立判断：这是**验证手段缺口，不是产品行为缺口**。该句描述的是主机事实（「跑门禁的是 pin 版本」），不是产品行为；把 `report.version === '24.3.0'` 焊进单测会让套件在任何未安装该确切版本的机器上失败——这正是审查警示、我也同意的结果。因此我**亲手执行**了该字面步骤：`/usr/local/n/versions/node/24.3.0/bin/node` 与 `/usr/local/bin/node` 均为 24.3.0 且都通过实际门禁（`ok:true`）；`~/.nvm/...` 无该版本。AC-1(b) 在本机达成，缺失的自动化作为 MEDIUM 残余风险登记于 §6。

**2. D-1 — 审查条目码。** 复核结论：**D-1 成立且未修复** —— `node-env-guard.spec.ts:240` 的 `(S9)`、`:629` 的 `(S5, AD-9)`、`:664` 的 `// M2:`、以及 `auto-start-orchestrator.spec.ts:144` 的 `(AC-9, AD-4, M2)` 均在。这些是把审查历史带进出货注释，与 `AGENTS.md:144` 冲突。`AD-*` **未被误删**：`AD-9`、`AD-4` 都还在，且属 `design.md` 架构决策编号、是仓库既有惯例（对照 `session-host.ts:106`、`extension.ts:2173`）。正确改法是去掉 `S*` / `M*` 码、保留 `AD-*`。无任何 AC 依赖此项。

**3. D-2 — 非字符串 `dsh.nodeBin` 归类为 `process-failed`。** 已独立复现，并通过读源码确认链条：`readNodeBinSetting` 抛裸 `Error`（无 `kind`，`extension.ts:2183-2187`，位于 `createStartHostPort` 的 `start()` 内 `:2253`）→ `AutoStartOrchestrator` 把缺失的 `kind` 归一化为 `process-failed`（`auto-start-orchestrator.ts:230`）。真实激活实测：`errorKind='process-failed'`，消息 `dsh.nodeBin must be a path to a Node.js executable string, got number`。我的判断：**不构成 AC-9 的可验收偏离**。AC-9 的分类对象是 Node 环境失败（`missing`、`not-executable`、`missing-apis`），这三类确实都归到 `node-environment`；手写类型错误的设置属另一类失败，从未进入预检，且 manifest 已声明 `type: "string"`，设置 UI 无法产生该值。该路径仍是 fail loud、消息具体且用户可见。登记为开放的 SHOULD-FIX，严重性 LOW，不判为 AC 失败。

**4. AC-10(f) 跨 Phase 依赖 —— 原文登记。** **AC-10 的「设置项在真机被解析链消费」分支由 Phase 3 提供证据（跨 Phase 依赖）。** Phase 1 的判定范围仅为 AC-10(a)–(e)；不因此判 Phase 1 失败，本报告也**不**声称真机分支已在 Phase 1 验证。若 Phase 3 的对应补充证据行失败，则整条 AC-10 不成立。

**5. M2 可证伪性 —— 已完成，断言升级为 VERIFIED。** 两次独立观测，均非 correctness 视角那个被阻断的探针：(i) 端到端经真实扩展——设置指定的无效 Node 产生快照 `errorKind='node-environment'`（场景 7）；(ii) 一个刻意构造的变异体（把 `node-environment` 从 `START_ERROR_KINDS` 移除，其余与出货模块逐字节相同）在同样输入下产生 `process-failed`，而出货模块产生 `node-environment`（v4 的 A 组 vs D 组）。该观测**可以变假**，因此它是证据。另有两个控制：普通 `Error` → `process-failed`；未知 `kind` → `process-failed`（不会被误认为已知类）。

**6. `HostStartError.diagnostic` 是 Phase 2 预留表面 —— 登记，不判失败。** Phase 1 自身流程只需要 `kind` 与五行消息，结构化 `diagnostic` 载体未被 Phase 1 使用。它的存在不导致 Phase 1 失败；Phase 2 也不得假定 Phase 1 的调用方会填充它。

## 5. 桩感知验证

`tech-debt-registry.md` 仅有一条活跃债务 `DEBT-004`（非阻塞、不在 Phase 1 路径上）。关键路径参数变化测试：`resolveNodeExecutableSpec` 在不同输入下产出三种不同结果（`/x/node`/`dsh-node-bin`、`/y/from-setting`/`vscode-setting`、`process.execPath`/`process-exec-path`）；`validateNodeEnvironment` 对 24.3.0 返回 `ok:true`，对 `missing`、`not-executable`、`missing-apis` 返回 `ok:false` 且 `kind` 各不相同。输出随输入变化，故二者都不是桩。未发现未登记桩，故未新增 registry 条目。

## 6. 残余风险

| 风险 | 严重性 | 说明 |
|---|:--:|---|
| AC-10(f) 真机分支未验证 | 🟡 MEDIUM | 真机 Extension Development Host 的运行时消费按设计推迟到 Phase 3；在那之前 AC-10 未获完整证据。已登记，未被折价处理 |
| AC-1(b) 无仓库内守门 | 🟡 MEDIUM | 在本机达成并由本仓库外脚本证明；但若某开发机失去该 pin 安装，仓库中没有任何东西会因此变红。spec 未要求这样的门禁；记录此风险以免被误认为已有自动化 |
| D-1 注释卫生未解决 | 🟢 LOW | 出货测试注释中仍保留 4 处审查条目码，与 `AGENTS.md:144` 冲突。仅文档/注释层面，不影响行为 |
| D-2 非字符串设置的归类是泛化类 | 🟢 LOW | 仍 fail loud、消息具体、无 spawn；只是归类为 `process-failed` 而非 Node 环境类。仅当对手写违反 manifest `string` 声明的 `settings.json` 才可触发 |
| 正/负向证据使用临时目录中的替身可执行文件 | 🟢 LOW | 门禁会拒绝这些替身，同时 §1 AC-1(b) 中门禁接受真实 24.3.0 解释器，故门禁的「接受侧」锚定在真实 Node 上 |
| 顺序证明来自源码顺序 + 缺失观测，而非注入竞态 | 🟢 LOW | 四个失败场景均实测「无 socket、无子进程」；未在敌意调度下验证交错执行 |

无 CRITICAL 级风险。非 PASS 判决所要求的分条问题清单如下。

## 7. 仍未关闭的问题清单（判决为 PARTIAL 的原因）

1. **AC-10(f) 未在 Phase 1 验证** —— 真机消费分支需要 Phase 3 的冒烟脚本（AD-11）。已登记的跨 Phase 依赖不等于已解决的要求，故本 Phase 不能直接放行。
2. **N1：AC-1(b) 的自动化用例未实现 spec 字面步骤** —— `node-env-guard.spec.ts:449-461` 断言的是 `process.execPath`；该 AC 的证据改由本报告的 `v1-ac1-pinned-locate.mts` 承担。可选修复（且明确不是把版本断言焊进套件）：要么改写 spec 的 (b) 使自动化期望与 `process.execPath` + 范围谓词一致，要么加入一个在 pin 版本缺失时跳过、并被报告为 skipped 的定位器。
3. **D-1 未修复** —— 去掉 `node-env-guard.spec.ts:240`、`:629`、`:664` 与 `auto-start-orchestrator.spec.ts:144` 中的 `S*` / `M*` 审查条目码；保留 `AD-9` / `AD-4`。
4. **D-2 未修复** —— 若希望对无效 `dsh.nodeBin` 取值给出独立归类，就显式分类，而不是让它落到 `process-failed`；否则记录「泛化类是预期行为」的决策。按 AC-9 现有表述，两者都不是必需。
5. **新增发现 N-3（提交范围，不是 AC 问题）：** 合并报告的 O-4 把 `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`、`phase2-auto-ready.spec.ts`、`phase4-new-conversation-chrome.spec.ts` 归为「与本 Phase 无关的既有改动」。这一点无法复现：三个文件的 diff 都是给 duck-typed `vscode` fixture 增加 `getConfiguration(section)` 成员，其中之一还带注释「`dsh.nodeBin` unset: the empty value does not participate in Node resolution」；而 `getConfiguration` 与 `nodeBin` 在 HEAD 版本中**都不存在**。这些改动由本 Phase 新增的设置项读取所产生，属于 Phase 1 提交集合；若剔除，提交后的树将与该工作区不一致。

判决为 PARTIAL 的直白说明：未发现 CRITICAL 或 MEDIUM 级功能缺陷，Phase 1 范围内的每条 AC 都有独立执行证据，差量门禁零新增失败 —— 但有一条 AC 分支推迟到 Phase 3、一条 AC 的自动化与 spec 表述不符、两项 SHOULD-FIX 审查事项仍开放。按工作流规则，存在已记录缺口即判 PARTIAL。

## 8. Pipeline 合规检查

- 分支：`impl-phase-1-node-env-preflight` —— 与要求一致，在作出任何结论前已确认。✅
- Phase 1 改动位于该分支的工作区且未提交，符合工作流（implementer 不自行 commit，由调度者在 HG-3 统一提交）。HEAD 为 `d92b0e55e1`，其最后两次提交是 spec 状态收尾、不含 Phase 1 代码。
- 没有非 specs 文件在 `impl-*` 分支之外被修改：所有修改/新增路径都在本分支工作区内。
- 工作区中存在与本 Phase 无关的既有产物，**不得**归因于 Phase 1：`.cursor/skills/project-build/SKILL.md`、`.specdev/specs/workflows.json`、`pnpm-lock.yaml`、`apps/vscode-dsh/webview/dist/assets/*`、`docs/wiki/**`，以及未跟踪的 `docs/wiki/.wiki-status.json`。
- 验证手段合规：未使用任何 `git` 写命令；未修改 `current-status.json`、`review.md`、`review-*.md`、`implementation.md`；未创建任何 commit。

## 9. 验证脚本（已落盘 `test-scripts/`）

| 脚本 | 用途 |
|---|---|
| `spawn-counter-preload.mjs` | 包装 `child_process.spawn` 并把每次调用追加到 `DSH_VERIFY_SPAWN_LOG`，使「无子进程」成为测量结果 |
| `run-harness.sh` | 设置 `PATH` 与 spawn 日志后经 `tsx` 运行某场景 |
| `v0-resolution-probe.mts` | 点名每个导入解析到的模块面（源码 vs 构建产物 `lib`） |
| `v1-ac1-pinned-locate.mts` | AC-1(a)(b)(c)，含在 spec 指定三处定位 pin 版本并对其实跑门禁 |
| `v2-resolution-priority.mts` | AC-5、AC-6、AC-10(c)、AD-1 同一性、空白边界、`PATH` 替身、Electron 标志 |
| `v3-e2e-preflight.mts` | AC-4、AC-5 失败路径、AC-7、AC-8、AC-9、AC-10(d)(e)、D-2，经真实 Host 与真实激活 |
| `v4-m2-classification.mts` + `mutation/auto-start-orchestrator-flattened.ts` | AC-9 归类及其通过刻意变异体的可证伪性 |
| `v5-docs-ac2-ac3.mts` | AC-2、AC-3、AC-1(c)、AC-10(b) 的静态断言与负控制（显式声明非端到端） |

复现命令：

```sh
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
TS=.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/test-scripts
./node_modules/.bin/tsx $TS/v0-resolution-probe.mts
./node_modules/.bin/tsx $TS/v1-ac1-pinned-locate.mts
./node_modules/.bin/tsx $TS/v2-resolution-priority.mts
DSH_VERIFY_SPAWN_LOG=/tmp/dsh-verify-spawn.log \
  ./node_modules/.bin/tsx --import ./$TS/spawn-counter-preload.mjs ./$TS/v3-e2e-preflight.mts
./node_modules/.bin/tsx $TS/v4-m2-classification.mts
./node_modules/.bin/tsx $TS/v5-docs-ac2-ac3.mts
```
