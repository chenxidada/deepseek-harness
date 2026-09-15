# 连通性审查 — Phase 1（第 3 轮）

Phase：`phase-1-node-env-preflight` · 工作流：`vscode-dsh-usable-loop` · 轮次：第 3 轮（回炉 2 之后）
实测分支：`impl-phase-1-node-env-preflight`（`git branch --show-current`）

## 视角

**集成连通性** — 只问一个问题：这些零件真的接通了吗？端到端数据路径、上下游连接、跨模块与跨 Phase 契约。不评价逻辑正确性（reviewer-correctness 的职责）、不评价设计取舍（reviewer-design 的职责）。

## 判决

**PASS** — 产品侧端到端路径完整，跨模块与跨 Phase 契约一致，无孤儿成员，差量门禁零新增失败。

附带 3 条 🟡 Should-Fix 咨询项（`F-1`/`F-2`/`F-3`）：**均位于本 Phase 自有的验证脚本面或 Phase 2 的未来代码面，不触及 `apps/vscode-dsh/src` 产品代码，也不影响任何验收标准的成立**。按本轮严重性纪律（`loop_count` 已达上限 2，只有真正影响正确性/验收的缺陷才判 MUST-FIX），不应升为 MUST-FIX。其中 `F-1` 建议在 verifier 复用 `v3-e2e-preflight.mts` **之前**处理，否则会产生一次假红。

### 启动自清理（已执行）

上一轮的两份产物在写任何新内容前已归档（仅 `mv`，全程未运行任何 git 命令）：

```
.archive/review-connectivity-20260915T121413Z.md      (29 744 B)
.archive/review-connectivity-zh-20260915T121413Z.md   (29 090 B)
.archive/review-connectivity-20260915T103404Z.md      (24 570 B)
.archive/review-connectivity-zh-20260915T103404Z.md   (24 025 B)
```

写入前直接路径下已无 `review-connectivity*.md`（`ls` 实测）。

---

## 1. D-2 端到端追踪（本轮核心）

### 1.1 完整链路（逐跳，含实测锚点）

修法：`START_ERROR_KINDS` 新增 `'invalid-setting'`（`auto-start-orchestrator.ts:27-32`）；`readNodeBinSetting` 改抛 `HostStartError('invalid-setting', …)`（`extension.ts:2180-2191`，调用点 `:2255`）。

```
contributes.configuration 的 `dsh.nodeBin` = 非字符串（42）
  → workspace.getConfiguration('dsh').get('nodeBin')            extension.ts:2255 入口（readNodeBinSetting）
  → typeof value !== 'string' → throw HostStartError('invalid-setting', `dsh.nodeBin must be … got ${typeof value}`)
                                                                extension.ts:2185-2189  ✅ 生产侧真实生产者
  → 类经由 start port 的 start() 逃逸 → orchestrator.runStart 的 catch
                                                                auto-start-orchestrator.ts:226
  → startErrorKindOf(error)                                     :53-60 读 error.kind，并校验其 ∈ START_ERROR_KINDS
  → snapshot.errorKind = 'invalid-setting'                      :129  `...this.errorKind === undefined ? {} : { errorKind }`
  → connectionUi.projectOrchestrator(snap)                      extension.ts:402-405（onChange）
  → ConnectionUiController.mapSnapshot                          connection-ui.ts:117-160
  → 面板 / 状态栏                                               chat-panel-host.ts:279,353 → chat-panel-provider.ts:873
```

**实测（我自己的独立探针 `/tmp/dsh-conn-probe3/probe.mts`，调用的是**真实出货模块** `extension.ts` 的 `activate()` + 真实 `dsh.test.requestStart` 命令 + 真实 `ConnectionUiController`，只把 `getConfiguration().get()` 返回值设为 `42`）：**

```
A.snapshot.state => failed
A.snapshot.errorKind => invalid-setting
A.snapshot.errorMessage => dsh.nodeBin must be a path to a Node.js executable string, got number
A.ui.state => {"phase":"failed","message":"dsh.nodeBin must be a path to a Node.js executable string, got number","settingsDeepLinkAvailable":false,"statusBarVisible":true}
```

判定：✅ 起点（设置值）到终点（UI 投影）**全程连通**；`state=failed`、归类正确、`errorMessage` 为用户可见根因文案、`statusBarVisible=true`（面板不可见时有兜底入口）。implementer 关于「类存活到快照」的核心断言，被我用与生产激活路径相同的独立手段复现。

### 1.2 所有 `errorKind` 消费点清单及其行为（要求逐条判定）

枚举命令：`grep -rn "errorKind\|StartErrorKind" apps/vscode-dsh/src apps/vscode-dsh/tests`。**遍历后共 13 类消费点，无一处因新增成员产生未定义行为。**

| # | 消费点 | 读到什么 | `invalid-setting` 到达时的行为 | 判定 |
|---|---|---|---|---|
| 1 | `connection-ui.ts:140` | `snap.errorKind === 'missing-credentials'` | **false** → 不提供凭据深链（实测 `settingsDeepLinkAvailable:false`） | ✅ 正确分支：类型错误不是凭据问题 |
| 2 | `connection-ui.ts:146-155` | `snap.errorMessage` | 直接渲染根因文案（实测原文如上） | ✅ |
| 3 | `connection-ui.ts:117-139` | `snap.state`（`assertNever` 作用于 **state**，不是 errorKind） | `failed` → phase `'failed'`，不进 `default` | ✅ 与 errorKind 无关 |
| 4 | `chat-panel-host.ts:279` + `:353`（经 `protocol.ts:74`） | `state.settingsDeepLinkAvailable` | `false` → 面板隐藏「打开设置」按钮 | ✅ |
| 5 | `chat-panel-provider.ts:873` | 同上 | `openSettingsBtn.hidden = true` | ✅ |
| 6 | `extension.ts:402-405`（`onChange`） | `snap.state` + 把 snap 交给 UI 投影 | 只读 `state` | ✅ |
| 7 | `extension.ts:1108-1110`（`dsh.test.getStartState`） | 整个 snapshot | 原样返回（测试面） | ✅ |
| 8 | `extension.ts:1140-1144`（`dsh.test.requestStart`） | 整个 snapshot | 原样返回 —— **D-2 断言的载体**，也是我探针 A 的入口 | ✅ |
| 9 | `extension.ts:2243-2250`（`onStatusChange`） | `getStartState()` 的 `state` | 只读 `state` | ✅ |
| 10 | `extension.ts:2235-2240`（`onError` → `showErrorMessage`） | 主机错误 message | **该分支不触发**：`IdeSessionHost.start()` 从未被调用（实测 `startCalled=false`），故无二次报错 | ✅ |
| 11 | 测试侧字面量比较：`auto-start-orchestrator.spec.ts:123/162/175`、`node-env-guard.spec.ts:722/744`、`phase1-auto-start.spec.ts:231`、`phase4-new-conversation-chrome.spec.ts:206` | 各自期望成员 | 既有断言不受影响（相关 spec 全绿） | ✅ |
| 12 | **任何 `switch` over `StartErrorKind`** | — | **全仓 0 处**（`grep -rn "switch"` 命中的是 `snap.state` 与 `switchConversation`）；因此不存在「缺成员 → 落 default / `assertNever` 抛错」的路径 | ✅（`typecheck` exit 0 是机械确认） |
| 13 | **未来成员前向兼容**（Phase 2 计划的 `handshake-timeout` / `spawn`） | ConnectionUi 全流程 | 实测渲染 `phase=failed` + message；无 message 时兜底 `'Host connection failed.'`，**不崩、不读不存在字段** | ✅ 实测见 §1.3 |

### 1.3 `.diagnostic` 读取者清单（「未知成员当 node-environment 处理」的 hazard 判定）

要求核查的 hazard 是：「某处把未知成员当 `node-environment` 处理而去读 `diagnostic` → 读到 `undefined`」。

- **生产者**：`session-host.ts:324` —— 仅 `node-environment` 携带 `{ diagnostic: error.failure }`；字段声明 `session-host.ts:62-63`（`readonly diagnostic: NodeEnvironmentFailure | undefined`）。
- **产品侧读取者**：**0 处**。全仓对 `.diagnostic` 的读取只出现在测试：`session-host-preflight.spec.ts:180-182`（`error.diagnostic?.source` / `.executablePath` / `.kind`）。
- **实测**：`C.invalidSetting.diagnostic => undefined`（预期：该类不带诊断）。

判定：✅ **该 hazard 在当前代码树中不存在**——没有任何消费点会「按 kind 分支后读 diagnostic」而踩到 `invalid-setting`。`invalid-setting` 未复用 `node-environment`，正是保住「`diagnostic` 恰好当 `kind === 'node-environment'` 时存在」不变式的前提；两者一致。

⚠️ **前向提示（不是本 Phase 缺陷）**：`HostStartError.diagnostic` 的类型是 `NodeEnvironmentFailure | undefined`，**不是**以 `kind` 为判别式的联合类型，TypeScript 不会强制收窄。Phase 2 新增诊断 sink 时若直接读 `.diagnostic`，会读到 `undefined`。路由见 §1.4。

### 1.4 与 Phase 2 的跨 Phase 一致性（逐条对照 `phases/phase-2-host-fail-loud-diagnostics/spec.md`）

| Phase 2 的位置 | 内容 | 与本轮扩宽词表的关系 | 判定 |
|---|---|---|---|
| `spec.md:88` | 修改 `auto-start-orchestrator.ts`：`StartErrorKind` 扩展 + 读取校验过的 kind | **加法式**扩展、不重述成员清单 → 新增成员不与其冲突 | ✅ 不矛盾 |
| `spec.md:61` | 未知错误落记录 `kind === 'other'`（**对应 orchestrator 的 `errorKind === 'process-failed'`**） | 明确保留 `process-failed` 为唯一通用成员 → 与 implementer 的 deviation #4 一致 | ✅ 一致 |
| `spec.md:54`（AC-20） | 记录 `kind ∈ {spawn, handshake-timeout, bridge-listen, child-exited, missing-credentials}` | 这是**记录**词表（AC-14..19 的产物），与 `StartErrorKind` 的 4 个成员不是同一集合，无成员冲突 | ✅ 不矛盾 |
| `spec.md:57`（真机证据） | 要求存在**记录** `kind === 'node-environment'`，且 `resolvedExecutable` 为**绝对路径**、`source ∈ {dsh-node-bin, vscode-setting, process-exec-path}` | **生产者在 Phase 1 已存在**：`NodeEnvironmentFailure.source`（`node-env-guard.ts:59`）与 `.executablePath`（`:63`）随 `HostStartError.diagnostic` 一起传到 Phase 2 → 该记录**可构造**，不需 Phase 2 重新推导 | ✅ 连通（绝对性见 `F-3`） |
| `spec.md:19`（Phase Entry Gate） | 「目标 Phase = Phase 2 的 🔴 阻塞条目」预期为**空** | registry 实测：活跃表仅 `DEBT-004`（目标为「下一个处理 preset 策略的工作流」，🟡非阻塞）；`DEBT-005/006/007` 已在「已解决」表 | ✅ Phase 2 继承清单为空，Gate 不会误伤 |
| `spec.md:20`（前置条件） | Phase 1 提供 `HostStartError{kind:'node-environment'}`、`validateNodeEnvironment`、`ResolvedNodeExecutable`（含 `source`）、门槛先于 `listen` 的顺序契约 | 逐项核对：`session-host.ts:53/61`、`node-env-guard.ts:115`、`launch.ts:131`、`session-host.ts:287-291` 全部在位，且 `session-host-preflight.spec.ts` 7 例全绿 | ✅ 前置条件成立 |

**结论：本轮扩宽**不**使 Phase 2 断路。** 需要 Phase 2 侧同步的两点（Phase 1 **无需**改动）已在 `F-3` 给出精确落点。

### 1.5 可证伪性（用我自己的手段复核 implementer 的断言）

implementer 声称「移除词表成员 → 用例变红」。我没有去读它的断言代码判断，而是**自己构造变异体**：把出货模块复制到 `/tmp`，删掉 `  'invalid-setting',\n` 一行，再把**同一个** `HostStartError('invalid-setting', …)` 分别喂给出货版与变异版 orchestrator：

```
B.shipped.errorKind => invalid-setting
B.shipped.errorMessage => dsh.nodeBin must be a path to a Node.js executable string, got number
B.mutant.errorKind => process-failed
B.different => true
```

判定：✅ 断言**确实可证伪**——同一错误对象在移除成员后必然落回通用成员，`node-env-guard.spec.ts:744` 的 `toBe('invalid-setting')` 会因此变红。implementer 的 D-2a 探针机制被我独立复现。

---

## 2. D-1 判定 — 清除审查条目码

| 检查 | 命令 | 结果 |
|---|---|---|
| `S*`/`M*` 条目码残留 | `grep -rnE '\((S[0-9]+\|M[0-9]+)[,)]\|// *(S\|M)[0-9]+:' apps/vscode-dsh/` | **零命中** |
| 更宽模式（含括号内单码） | `grep -rnE '\(([SM][0-9]+)[,)]' apps/vscode-dsh/src apps/vscode-dsh/tests` | **零命中** |
| `AD-*` 是否被误删 | `grep -rnE 'AD-[0-9]+' apps/vscode-dsh/src apps/vscode-dsh/tests` | 仍在：`node-env-guard.spec.ts:685`(AD-9)、`:216`(AD-2)、`auto-start-orchestrator.spec.ts:144`(AD-4)；产品侧 `auto-start-orchestrator.ts:38`、`session-host.ts:51/108`、`extension.ts:224/2173`、`node-env-guard.ts:111/152/250` |

判定：✅ **满足**。四处清除点与 implementer 表格一致（含 `auto-start-orchestrator.spec.ts:144` 的 describe 标题），`AD-*` 一个未丢。

---

## 3. N1 判定 — AC-1(b) 三处定位

### 3.1 结构与接线

- AC-1(a) 与 AC-1(b) 已拆为两条独立用例；AC-1(b) 在 `node-env-guard.spec.ts:484-517`。
- 三个辅助函数**全部接线**（无孤儿）：`pinnedInstallRoots`（`:90` → 用于 `:491`）、`nodeOnPath`（`:104` → `:496`）、`reportedVersion`（`:110` → `:497-498`）。
- 断言含 `validation.ok === true`（`:512`）**且** `validation.report.version === pinned`（`:514`）→ 证明确实校验的是**被 pin 的那个解释器**，而不是「任意一个能用的 Node」。

### 3.2 本机是 pass 还是 skipped（要求实测）

```
$ pnpm --config.verify-deps-before-run=false run test apps/vscode-dsh/tests/node-env-guard.spec.ts --reporter=verbose
 ✓ |thread-safe| … > pins exactly one machine-readable version that the declared range admits (AC-1 a) 1ms
 ✓ |thread-safe| … > locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) 52ms
 ✓ |thread-safe| … > classifies a non-string setting as invalid-setting, not a process failure 1ms
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

判定：**pass，不是 skipped**。`52 ms` 的耗时本身证明它**真的跑了子进程**（读常量花不了 52 ms）。定位明细（我用 `validateNodeEnvironment` 直接实测三处）：

```
/usr/local/n/versions/node/24.3.0/bin/node => ok version=24.3.0 zstd=true wr=true
missing => /home/chendc/.nvm/versions/node/v24.3.0/bin/node
command -v node => /usr/local/n/versions/node/24.3.0/bin/node (24.3.0)
```

即：版本名根 1 命中、根 2 不存在、`command -v node` 命中同一文件 → `located` 有 2 条（指向同一条真实路径）→ `report.version === '24.3.0'` 成立。**覆盖非空**。

### 3.3 重点可疑点：`source: 'process-exec-path'` 传了一个**并非** `process.execPath` 的解释器

我用出货 guard 交叉实测 `source` 是否改变判定（同一解释器 × 三种 source）：

```
/usr/local/n/versions/node/24.3.0/bin/node [source=process-exec-path] => ok version=24.3.0 …
/usr/local/n/versions/node/24.3.0/bin/node [source=vscode-setting]    => ok version=24.3.0 …
/usr/local/n/versions/node/24.3.0/bin/node [source=dsh-node-bin]      => ok version=24.3.0 …
/home/chendc/.nvm/versions/node/v22.14.0/bin/node [source=process-exec-path] => FAIL kind=missing-apis remedy="this is the Extension Host's own Node.js executable, …"
/home/chendc/.nvm/versions/node/v22.14.0/bin/node [source=vscode-setting]    => FAIL kind=missing-apis remedy="repair or clear the dsh.nodeBin setting, …"
/home/chendc/.nvm/versions/node/v22.14.0/bin/node [source=dsh-node-bin]      => FAIL kind=missing-apis remedy="repair or clear the DSH_NODE_BIN value, …"
```

结论（三层）：
1. `source` **不影响判定**：`ok` / `failure.kind` 三种 source 完全一致；它只进入 `sourceLabel` 与 `remedy` 文案。
2. `electronRunAsNode` **不是**从 `source` 推导的，而是调用方显式传入的字段（`launch.ts:134/138/143` 逐个赋值），用例显式传 `electronRunAsNode: false` → **不可能**因该标注滑进 Electron 模式。所以「走错分支」的担心**不成立**。
3. 残留（cosmetic）：失败时渲染的 remedy 会声称「这是 Extension Host 自己的 Node 可执行文件」，而候选其实不是 `process.execPath`。该文案只在**变异失败场景**可达（正常 pin 命中时不会渲染），属测试夹具保真度问题，非缺陷 → 🟢 见 `O-5`。

**环境依赖说明（如实记录）**：该用例按设计是环境相关的——在未安装被 pin 版本的机器上它报 **skipped**（非 PASS），符合 spec「非 PASS 并写明」。本机 **pass**。

---

## 4. 未接线 / 死代码

| 本轮新增物 | 生产者 | 消费者 | 判定 |
|---|---|---|---|
| `START_ERROR_KINDS` 成员 `'invalid-setting'` | `extension.ts:2185-2189`（生产路径可达，探针 A 实测） | `startErrorKindOf`（`:53-60`）→ snapshot → ConnectionUi（§1.2 表） | ✅ 非孤儿 |
| `readNodeBinSetting` 的 `HostStartError` 抛出分支 | `extension.ts:2255` 调用，非字符串即触发 | 同上一行 | ✅ 非孤儿（不是在测试里手工构造的类型） |
| AC-1(b) 三个辅助函数 | `node-env-guard.spec.ts:90/104/110` | `:491/:496/:497-498` | ✅ 全部接线 |
| 两处新 JSDoc 措辞 | `auto-start-orchestrator.ts:34-42`、`session-host.ts:42-52` | 文档 | ✅ 与代码一致（均点名 `invalid-setting`） |

全仓无 `switch` over `StartErrorKind`，故不存在「新增成员但无人处理」的孤儿分支；`typecheck` exit 0 是穷尽性的机械确认。

---

## 5. 回归检查（既有端到端路径）

| 既有契约 | 证据 | 判定 |
|---|---|---|
| Node 三级解析链（`DSH_NODE_BIN` > 设置 > Extension Host Node） | `launch.spec.ts` 11 例（含 Electron 交互与边界输入）；`packages/sdk/client` 84 例全绿 | ✅ 未受影响 |
| pre-flight → `bridge.listen` → spawn 顺序 | `session-host-preflight.spec.ts` 7 例在 app 套件内全绿 | ✅ 未受影响 |
| `node-environment` 归类存活到快照 | `auto-start-orchestrator.spec.ts:150-176`、`node-env-guard.spec.ts:722` 全绿 | ✅ 未受影响 |
| `missing-credentials` 深链 | `phase1-auto-start.spec.ts:231`、`phase4-new-conversation-chrome.spec.ts:206` 全绿 | ✅ 未受影响 |
| 本轮是否改动既有行为 | `git diff` 显示 4 个源文件改动均为**加法或文本替换**（新增成员、新增 JSDoc 句、`throw new Error` → `throw new HostStartError`）；未删除任何已发布名 | ✅ |

---

## 6. 差量门禁（真实命令与真实输出）

所有命令均带 `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`，且 **`--config.verify-deps-before-run=false` 置于 `run` 之前**（放在 `run` 之后会被 pnpm 当脚本参数转发，从而触发 `pnpm install` → 本机 git 2.25.1 < lefthook 要求，必然失败；我第一次误放就复现了该假失败，故此处显式记录）。

| 命令 | 基线 | 本轮实测 | 新增失败 |
|---|---|---|---|
| `pnpm --config.verify-deps-before-run=false run typecheck` | 绿 | **exit 0**（`tsc -b tsconfig.client.json`） | 无 |
| `… run test packages/sdk/client` | 绿 | **exit 0** — `Test Files 3 passed (3)`、`Tests 84 passed (84)` | 无 |
| `… run test apps/vscode-dsh` | 4 文件 / 6 用例红 | **exit 1** — `Test Files 4 failed \| 46 passed (50)`、`Tests 6 failed \| 351 passed \| 1 skipped (358)` | 无（集合与计数一致） |
| `… run test:docs` | `10 passed, 5 failed` | **exit 1** — `run-gates: 10 passed, 5 failed, 0 skipped in 24.83s` | 无（同一 5 个门禁） |
| `… run lint`（`tsx scripts/run-oxlint.ts .`；规则集 **`.oxlintrc.json`**） | 红 | **exit 1** — **10382** 条诊断行（10381 error + 1 warning）：`@stylistic` 9549、`typescript` 819、`sonarjs` 7、`eslint` 6 | 无 |

四个红文件（与基线同一集合）：`panel-close-delete.e2e.spec.ts`(1)、`spike-t0a-replay-rebuild.spec.ts`(4)、`spike-t0b-continue-capability.spec.ts`(1)、`verifier-phase1/layer-a-rtl.spec.tsx`(1)；根因仍是 `scripts/test-invariants.ts:88/188` 与 `packages/core/agent-loop/src/index.ts:40`，无一是本 Phase 触碰的文件。

lint 逐文件（我独立统计，与 implementer 表格一致）：`node-env-guard.ts` 0、`node-env-guard.spec.ts` 0、`session-host-preflight.spec.ts` 0、`auto-start-orchestrator.ts` 1（`:236`）、`session-host.ts` 1（`:597`）、`extension.ts` 22（**全部 ≤ `:2274`，无一落在本轮新增区间 `34`/`48`/`223-236`/`2172-2192`/`2255`/`2258`**）、`index.ts` 1（`:97`）、`auto-start-orchestrator.spec.ts` 4（`:52/53/95/96`，均在既有 `mockPort` 辅助块内）、`packages/sdk/client/**` 0。→ **新增行零新诊断**。

docs：`grep -cE "development\.(md|zh\.md)"` → **0**；`grep -cE "packages/sdk/client"` → **0** → 本 Phase 的两组配对文档（`docs/development.*`、`packages/sdk/client/README*`）均未出现在任何失败归因里。

---

## 7. 新发现

### 🟡 Should-Fix

**F-1 — 本 Phase 自有的验证脚本仍断言修复前的归类（复用会产生假红）**
`test-scripts/v3-e2e-preflight.mts:236`：`check('D-2 non-string class is process-failed today', snapshot.errorKind === 'process-failed', …)`。该场景与我探针 A 的激活形态一致，而实测 `errorKind => invalid-setting` → **该 check 现在必然为 false**（同文件 `:237` 的 message 断言仍成立）。
影响：`verification.md` 已作废、verifier 将重写；但 `v3` 是 round-1 覆盖 AC-4/7/8/9/10(d)(e) 的**最强真机脚本**（`verification.md:64/67/68/73/74/87` 均引用它），极可能被原样复用 → 会把「修复成功」误报成回归。
**归属与建议**：verifier 的产物（非产品代码），复用前把场景 6 的期望值改为 `invalid-setting` 并同步标签措辞。

**F-2 — 变异体副本的出身漂移（provenance 描述已不成立）**
`test-scripts/mutation/auto-start-orchestrator-flattened.ts` 与出货模块 `diff` 实测只有 1 个 hunk，但它同时删掉了 `'invalid-setting'` 成员**和** D-2 新增的那段 JSDoc → 该副本现在比出货模块**落后两个成员 + 一段注释**。它作为「移除 `node-environment` 以复现 M2 扁平化」的用途仍然成立（`process-failed` 兜底），但 round-1 `verification.md:88` 的「otherwise byte-identical to the shipped module」表述**不再字面成立**。
**建议**：由当前出货模块重新生成该变异体，或把表述改为「模块的早期修订版快照」。

**F-3 — 跨 Phase 路由（Phase 1 无需改动；落点在 Phase 2）**
1. Phase 2 的 `StartErrorKind → 记录 kind` 映射需**为 `invalid-setting` 落一条明确分支**（或明说映射到 `other`）。否则本轮新增的、**已归类**的失败在 Phase 2 的记录面会退化成通用类，与「已归类」的意图相悖。落点：`phases/phase-2-host-fail-loud-diagnostics/spec.md` 产出清单 `:88` / AC-14「兜底完整性」`:48`。
2. Phase 2 的诊断 sink **必须**先按 `kind === 'node-environment'` 收窄再读 `HostStartError.diagnostic`（该字段类型为 `NodeEnvironmentFailure | undefined`，不是判别式联合，TS 不会拦截）——否则读到 `undefined`。落点同上 + `spec.md:57`。
3. `spec.md:57` 要求真机记录的 `resolvedExecutable` 为**绝对路径**，但 Phase 1 只对 `process-exec-path` 有绝对性保证：`resolveNodeExecutableSpec`（`packages/sdk/client/src/launch.ts:132-139`）把 env/设置值**原样**返回，`dsh.nodeBin: "node"` 这类相对值会让 `NodeEnvironmentFailure.executablePath` 为相对路径。**建议 Phase 2 收敛该断言口径**（或限 `source === 'process-exec-path'`）。我**不建议**在本轮改 Phase 1：那会动 `launch.ts` 并影响 11 个已绿的用例，而本轮 `loop_count` 已到上限。

### 🟢 Observations

- **O-1 深链缺口（非回归）**：`connection-ui.ts:140` 只对 `missing-credentials` 提供「打开设置」入口；`invalid-setting` / `node-environment` 这类「修 `dsh.nodeBin` 就能解决」的失败**没有**可点入口。无 AC 要求，且对 `node-environment` 是既有行为（非本轮引入）。自然归属是 Phase 2 的诊断呈现面（AD-3/AD-5 已把 sink 归给它）。
- **O-2 前向兼容有实测**：把 Phase 2 计划的未来成员 `handshake-timeout` / `spawn` 直接投影过真实 `ConnectionUiController`，分别得到 `{"phase":"failed","message":"socket closed",…}` 与无 message 时的兜底 `{"phase":"failed","message":"Host connection failed.",…}` → 未知成员**不崩、不产生 undefined 行为**，且 `statusBarVisible:true`。
- **O-3 知识面滞后**：`docs/wiki/VS Code IDE 集成/自动建连编排.md:114` 只以 `missing-credentials` 举例描述 `errorKind`（未声称穷尽，故**仍然准确**）。该树为未跟踪的既有知识库，词汇表现已 4 个成员、Phase 2 还要再加 3 个 → 建议工作流收尾时交给 `wiki` agent 刷新。
- **O-4 `implementation.md` §7 的措辞比实测窄**：它说 pairing 门禁报的是「`docs/wiki/**` 与 `packages/**/README.*`」；实测失败清单还包含 `apps/vscode-dsh/README.md`、`apps/vscode-dsh/tests/fixtures/screenshots/README.md`、`.agents/notes/implemented/architecture/2026-09-04-ide-profile-dual-channel.md`、`packages/sdk/server/README.*`。**结论不变**（这些都不是本 Phase 的文件：`apps/vscode-dsh/README.md` 在 `git status` 中干净、且 app 目录下无 `README.zh.md`；`packages/sdk/client` 与 `development.md` 均零命中），只是「基线集合」的表述不够精确。
- **O-5 AC-1(b) 的 `source` 标注**：见 §3.3——不影响判定，仅在失败变异下渲染出与实际不符的 remedy 文案。

---

## 8. 提交范围提醒（HG-3 提交须显式列举，禁止 `git add -A`）

**本 Phase 自有的跟踪改动（21 个文件）**：
`apps/vscode-dsh/package.json`；`apps/vscode-dsh/src/{auto-start-orchestrator,extension,index,session-host}.ts`；`apps/vscode-dsh/tests/{auto-start-orchestrator,phase1-auto-start,phase2-auto-ready,phase4-new-conversation-chrome}.spec.ts`；`docs/development.{md,zh.md,i18n.yaml}`；`packages/sdk/client/{README.md,README.zh.md,README.i18n.yaml,src/index.ts,src/launch.ts,src/types.ts,tests/launch.spec.ts}`

**本 Phase 自有新增（未跟踪）**：`.nvmrc`；`apps/vscode-dsh/src/node-env-guard.ts`；`apps/vscode-dsh/tests/node-env-guard.spec.ts`；`apps/vscode-dsh/tests/session-host-preflight.spec.ts`；`.specdev/specs/vscode-dsh-usable-loop/**`（含 `phases/phase-1-node-env-preflight/**` 与 `test-scripts/**` —— **若一并提交，请先处理 `F-1`/`F-2`**）

**工作区内但**不**属于本 Phase（请勿混入提交）**：

| 路径 | 状态 | 证据 |
|---|---|---|
| `pnpm-lock.yaml` | modified | 本 Phase 全程未 install（全部命令带 `--config.verify-deps-before-run=false`） |
| `apps/vscode-dsh/webview/dist/assets/index.{css,js}` | modified | **mtime 09:21:32**，早于本 Phase 首次编辑（16:30 起）数小时 → 既有构建产物 |
| `.cursor/skills/project-build/SKILL.md`、`.specdev/specs/workflows.json` | modified | 工具/配置树，本 Phase 未打开写入 |
| `.cursor/**`、`.explore/`、`.mcp.json`、`.cursorrules`、`docs/wiki/**`、`.wiki-work/`、`packages/**/src/*.{d.ts,js,map}` | untracked | 既有工具/知识/构建残留树 |

---

## 9. 数据路径完整性总结

| 路径 | 起点 → 终点 | 判定 |
|---|---|---|
| D-2：非字符串 `dsh.nodeBin` → UI 根因终态 | 设置读取 → `HostStartError('invalid-setting')` → `startErrorKindOf` → snapshot → ConnectionUi/面板/状态栏 | ✅ 全程连通（实测） |
| D-2：词表成员 → 类型/文档三处一致 | `START_ERROR_KINDS` → `StartErrorKind` → `HostStartErrorKind`（别名）→ 两处 JSDoc + `design.md`/`design-zh.md` AD-4 | ✅ 无漂移 |
| D-2：跨 Phase 承载面 | `HostStartError.diagnostic{source, executablePath}` → Phase 2 记录字段 | ✅ 生产者已在位（绝对性见 `F-3`） |
| D-1 → 代码可读性 | 审查条目码清除、`AD-*` 保留 | ✅ 零残留、零误删 |
| N1 → AC-1(b) 证据面 | `.nvmrc` pin → 三处定位 → `validateNodeEnvironment` → `ok && version === pinned` | ✅ 本机 pass（52 ms，真实子进程） |
| 前向：Phase 2 未来成员 | 未知 `errorKind` → ConnectionUi | ✅ 实测无未定义行为 |

**最终信号：PASS**（`F-1`/`F-2`/`F-3` 为 🟡 should-fix 咨询项，建议 `F-1` 在 verifier 复用 `v3-e2e-preflight.mts` 前处理；无 MUST-FIX，不触发 `loop_count` 上限阻断）。
