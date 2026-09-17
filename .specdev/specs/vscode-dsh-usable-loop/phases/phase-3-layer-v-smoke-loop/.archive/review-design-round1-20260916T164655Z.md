# Design Consistency Review — Phase 3（`phase-3-layer-v-smoke-loop`）

| 项 | 值 |
|---|---|
| 视角 | **Design Consistency** —— 对照 `design.md`（AD-1..AD-16 + §12）与代码库**既有约定**，判断实现是否遵循架构 |
| 审查对象 | 工作流 `vscode-dsh-usable-loop` / Phase `phase-3-layer-v-smoke-loop`（`ui: false`） |
| 分支 / 基线 | `impl-phase-3-layer-v-smoke-loop` / `300f492f84` |
| 判定基准 | `design.md` + **`scope-amendment-01.md` 叠加层**（修订 01 + 追加裁定 R1）+ `spec.md` + `constitution.md` + `AGENTS.md` / `docs/AGENTS.md` / `.cursor/rules/spec-workflow.mdc` + `apps/vscode-dsh/src` 既有写法 |
| 不在本报告范围 | 实现正确性（reviewer-correctness）、集成连通性（reviewer-connectivity）、视觉外观（reviewer-visual = N/A） |
| 启动自清理协议 | 本 Phase 目录内**无**既有 `review-design.md` / `review-design-zh.md` → 无需归档；本报告运行期间**未**执行任何 `mv` / git 写操作 |

---

## 判决

**MUST-FIX**

一句话：**修订 01 与追加裁定 R1 的实施本身完整、自洽、无遗漏记录边**（§2 逐项 ✅，含「版本单一真相源」「决策 10 三口径未被削弱」「未留下第二个无生产者通道」这三项最易出错的检查）；但**有两处与 `spec.md` 明文不一致的实现没有写进 `implementation.md` 的偏差章节**（§9 的 🔴 × 2），违反 `constitution.md:59`（§6.2「**所有与 spec 不一致的实现必须写入 `implementation.md` 偏差章节**」）这一硬约束。

> 判决**不针对**产品代码、脚本或设计的质量：两处修复都**不需要改产品行为**。修复面 = `implementation.md` §6 补两行登记 + 一处口径裁定（§9）。
> 之所以给 MUST-FIX 而非 SHOULD-FIX：`constitution.md` §6.2 是「必须」级硬约束，且「未登记的一致性缺口没有任何 gate 能发现它」正是本项目明文防范的失败模式（`CLAUDE.md`「门禁的失败哲学：fail-closed」）。
>
> 同时明确的**不算偏离**项：代码与 `design.md` AD-14 原文（`phase` 两成员 / `schemaVersion` 恒 1）不一致 **已获用户授权**（`scope-amendment-01.md:22-24,34`，`design.md` §12 留痕），依 `scope-amendment-01.md:47` 的要求**不判** MUST-FIX。

---

## 1. 授权边界（先钉死判定基准）

| 授权项 | 出处 | 实现是否落在授权范围内 |
|---|---|---|
| `HostDiagnosticPhase` 增第三成员 | `scope-amendment-01.md:22` | ✅ 且**未**新增独立记录面、**未**加字段（仍 18） |
| `HOST_DIAGNOSTIC_SCHEMA_VERSION` `1 → 2` | `scope-amendment-01.md:24` | ✅ 常量真相源唯一（`host-diagnostics.ts:26`，全 `src/` 唯一赋值为该常量） |
| 补 `onTransportDeath` 记录边 | `scope-amendment-01.md:26` | ✅（`session-host.ts:776-782` → `:822`） |
| `auto-start-orchestrator.ts:225-229` 不写记录 | 实现选择 | ✅ 与 AD-3/AD-13 一致（§2.4 论证） |
| 记录边**必须**携带 `resolvedExecutable` + `source` | `scope-amendment-01.md:67`（R1.1） | ✅（`session-host.ts:415-418` 保存 → `:822` 起写入） |
| `injectDisconnect` 落点必须**实测**且**只一条**记录 | `scope-amendment-01.md:69`（R1.3） | ✅（`tests/layer-v-inject-disconnect.spec.ts:123,156`；§2.5） |
| 未授权扩张的禁止项 | `scope-amendment-01.md:57`（不改 `kind`、不加字段、不改 AC 语义、不改退出码契约） | ✅ 逐条核过：`HostFailureKind` 词表未动、字段集未动、退出码/结论分类契约未动 |

---

## 2. 修订 01 / 追加裁定 R1 实施完整性核验（重点 1·2·3）

### 2.1 版本真相源：**唯一**（`scope-amendment-01.md:24` 的核心要求）

| 位置 | 版本值 | 性质 | 判定 |
|---|---|---|---|
| `src/host-diagnostics.ts:26` | `HOST_DIAGNOSTIC_SCHEMA_VERSION = 2` | **唯一产品真相源** | ✅ |
| `src/host-diagnostics.ts:403`（`record()`） | `schemaVersion: HOST_DIAGNOSTIC_SCHEMA_VERSION` | 引用常量 | ✅ |
| `tests/host-diagnostics.spec.ts:177-185` | 由常量取 | 引用常量（`scope-amendment-01.md:36` 允许的最小改动） | ✅ |
| `tests/host-diagnostics.spec.ts:122` | 字段集**恰 18** | 契约 tripwire（字段集不变，独立钉死是**刻意**的） | ✅ |
| `tests/layer-v-inject-disconnect.spec.ts:46` | `RECORD_FIELD_COUNT = 18` | 同上，测试自带 tripwire | ✅ |
| `test-scripts/layer-v-driver/extension.cjs:1939-1951` | 从**记录自身**读 `schemaVersion`，走 `=== 1` / `> 1` 分流 | 消费侧，非真相源 | ✅ |

**全 `src/` 无第二处版本字面量**；`rg` 核过 `schemaVersion` 在 `apps/vscode-dsh` 的全部出现（`src/` 4 处 + 测试 3 处 + 驱动 4 处，驱动 2 处属**另一契约**，见 §10 观察 3）。
`scope-amendment-01.md:36` 点名的风险（「若发现硬编码字面量 `1`，必须改为引用常量」）在**已交付的 Phase 2 契约用例**中**未发现残留**。

### 2.2 AD-14 决策 10 的三口径：**完全未变**（`scope-amendment-01.md:35` 明文要求）

驱动 `test-scripts/layer-v-driver/extension.cjs:1904-1951` 实测：

| 口径 | 决策 10 要求 | 驱动实现 | 判定 |
|---|---|---|---|
| `=== 1` | 精确 18 字段 | `:1944-1950`：`schemaVersion === 1 && Object.keys(record).length !== 18` → `HARNESS_ERROR('diagnostics-v1-field-set-mismatch')` | ✅ 未被削弱 |
| `> 1` | 只断 v1 子集 + **记录观测版本** | `:1939` 算 `missingFields`（v1 18 字段清单 `:V1_RECORD_FIELDS`）→ `:1951-1957` 缺失即 `HARNESS_ERROR`；观测版本落进状态：`layer-v-status.json` 的 `node.extensionSubprocessSide.schemaVersion = 2`（`:1186-1194`）与 `postLink.record.schemaVersion = 2`（`:1253-1260`） | ✅ 两半都做到 |
| 缺失 / `null` / 非整数 / `< 1` | `HARNESS_ERROR` | `:1941-1943`：`!Number.isInteger(v) \|\| v < 1` → `HARNESS_ERROR('diagnostics-schema-version-invalid')` | ✅ |
| `[]` | 合法且**不对版本断言** | **构造前**读取（`:1904-1908`）只断 `Array.isArray`，无版本断言；构造后仍 `[]` → 轮询超时以 `HARNESS_ERROR` 收（`:1922-1928`，与 `spec.md` 修订段 R1.2 一致） | ✅ |

> 结论：**没有任何地方仍按版本 `1` 硬断言**，也没有第二处版本字面量。这是本次修订最易出错的两处，实测均未出错。

### 2.3 第三成员 `'post-handshake'`：语义、命名、消费方

- **语义**：`HostDiagnosticPhase = 'start' | 'retry' | 'post-handshake'`（`host-diagnostics.ts:70`）。`record()` 中 `afterHandshake` 分支（`:403` 起）同时决定 `phase` 与 `retryOfSeq: null`（`layer-v-inject-disconnect.spec.ts:141` 实测 `retryOfSeq: null`）。「握手已成功（`status === 'connected'`）之后的运行期死亡」与本成员的语义**精确对应**，且与既有 `'start' | 'retry'` 同属"失败链上的边界位置"这一语义轴（不是混入「失败种类」轴 —— 种类仍由 `kind` 承担，本 Phase **未**改 `kind` 词表）。
- **命名**：既有词汇体系是「阶段名」（`start` / `retry`），第三成员给的是「边界位置」（`post-handshake`）。**ADR 未规定更贴合的既有词汇**（`design.md` AD-14 只用过 `start`/`retry`），且 `post-handshake` 与代码库既有术语一致（`session-host.ts` 的 `afterHandshake`、`phase-3 spec` 的「握手后」）。判定 ✅；若 reviewer 认为应叫 `runtime`/`post-connect`，那是**口味**而非一致性缺陷（无既有词汇被违反）。
- **消费方覆盖**（用户点名的 `hostFailureKindForStartError` 一类映射）：
  - `rg` 核过 `HostDiagnosticPhase` 在 `src/` 只有 **3 处**引用：类型定义（`:70`）、字段声明（`:86`）、文档（`:20`）——**没有任何 `switch` / 穷尽 `Record<>` 以 `phase` 为输入**，故不存在「未覆盖分支」。
  - `hostFailureKindForStartError`（`:275-289`）的输入是 `StartErrorKind`、输出是 `HostFailureKind | null`，与 `phase` **不同轴**：其 `case 'node-environment'` 等返回 `null` 的语义是「该失败的记录由 Host 边界自己写」，与第三成员无关；`FAILURE_DETAILS` / `FAILURE_HINTS`（`:212-232`）是 `Record<HostFailureKind, …>`（穷尽），本 Phase **未**新增 `kind` → 无需扩展，实测也未出现未覆盖分支。
  - 渲染侧走通用路径（`host-diagnostics.ts:488` 的 `formatHostDiagnosticRecord`），**不按 `phase` 分支**（`:490` 直接把 `record.phase` 插进标题）→ 新成员自动可见，无未覆盖分支。附带事实（**不在本视角判决面**，属文案范畴）：该标题的前缀固定为「Host start failure #N」，对 `post-handshake` 记录而言措辞贴合度略降（`(post-handshake)` 括号已在同一行消歧）。
  - 文档侧：`apps/vscode-dsh/README*.md` 不描述记录字段面（`rg schemaVersion` 在三个 README 中**零命中**）→ 无「文档仍按两成员写」的残留。

### 2.4 记录边是否遗漏（`DEBT-010` 定位两处，实现只改一处）

| `DEBT-010` 定位 | 实现处置 | 与 AD-3 / AD-13「Host 边界说话」模型是否一致 |
|---|---|---|
| `session-host.ts` 的 `onTransportDeath` | ✅ **已补**：`status === 'connected'`（握手后）时 `recordTransportDeath()` 落 `phase:'post-handshake'` + `resolvedExecutable` + `source`（`session-host.ts:776-782` → `:822`） | 一致：观察与归类的唯一责任方是 `IdeSessionHost` |
| `auto-start-orchestrator.ts:225-229`（编排器自行合成的 `failed` 快照） | **有意不写**（`implementation.md:75`） | **一致，且是正确取舍**：该快照**无生产者**（它不是任何真实失败的观察点，只是编排器对「重试后仍未连上」的合成）。AD-13 要求的是「Host 说话」；在编排器侧再写一条会把**同一次死亡**记成两条 → 直接违反「同一失败只一条」（`scope-amendment-01.md:45,69`）。实测该路径以 `phase: 'retry'` + `retryOfSeq: <死亡 seq>` 的**一条**记录挂在死亡记录之后（`layer-v-inject-disconnect.spec.ts:198-200`）→ 未形成「第二个无生产者通道」 |

**去重边界**：握手**前**死亡仍由 `start()` catch 记录（`phase: 'start'`），`onTransportDeath` 在 `status !== 'connected'` 时不记录（`session-host.ts:776-782`）→ 两处互斥，`tests/session-host.spec.ts:502` 与 `layer-v-inject-disconnect.spec.ts:156` 双向锁死。判定 ✅。

### 2.5 R1 的「实测非推断」要求（`scope-amendment-01.md:69`）

交付物中有**独立于实现自述**的落点实测：`tests/layer-v-inject-disconnect.spec.ts:1-32` 以注释形式记录了落点链（`injectRuntimeDeath → transport death → onTransportDeath → status 'error' → 产品 status watch → onUnexpectedDisconnect`），并**由断言**（`:123` 落点/条数/两字段；`:156` FSM 经产品状态观察退出且重试不重复记录）承载。真机侧同一条链的证据落在 `layer-v-status.json` 的 `postLink.*`（`:1240-1260`：`recordsBefore: 0` → `recordsAfter: 1` → `freshRecordCount: 1` → `postHandshakeRecordCount: 1`）。判定 ✅（**这是 Phase 2/3 交界处最有说服力的一段取证**）。

---

## 3. ADR / 既有约定遵循

### 3.1 D5 —— `dsh.test.injectDisconnect` 语义收紧（是否与既有 `vscode-dsh-chat-ready` 契约冲突）

**结论：不冲突，且比原实现更贴近该契约的字面触发条件。**

| 证据 | 内容 |
|---|---|
| `apps/vscode-dsh/README.md:231` / `README.zh.md:231` | 该命令的**既有文档契约**是「Fire unexpected disconnect (AC-6a)」—— 语义级描述（触发一次意外断连），**未**承诺「直接戳编排器 FSM」 |
| 契约出处 | `AC-6a` 属前序工作流 `vscode-dsh-chat-ready`（`.specdev/specs/vscode-dsh-chat-ready/…/spec.md`：非用户 Stop 断线 → 断开态 + **至多一次**自动重试） |
| 旧实现（基线 `300f492f84`，diff 可见） | `orchestrator?.onUnexpectedDisconnect()` —— **跳过**断连的观察环节，只验证 FSM 对合成事件的反应 |
| 新实现（`extension.ts:1228-1233`） | `await host?.injectRuntimeDeath()` → 租约子进程真实死亡 → `onTransportDeath` → 状态变更 → **产品自身**的 status watch → `onUnexpectedDisconnect()`；注释明写「The FSM is not poked directly … this path exercises the same wiring a real runtime crash does」 |
| 契约可观测性未被削弱 | `layer-v-inject-disconnect.spec.ts:170-187` 复刻产品接线后断言 `startCalls === ['disconnect-retry']`、`getStartState() === 'failed'`、`records` 中死亡记录恰 1 条 —— 正是 AC-6a 的「至多一次重试、不无限重连」 |
| 无第三方消费者被破坏 | `rg injectDisconnect` 全仓（排除本 Phase 产物）只命中：README 表格、驱动 `:1911`、`session-host.ts:708`（注释）、`extension.ts:1228`。既有回归脚本 `test-scripts/run-chat-ready-regression.sh` **不调用**任何 `dsh.test.*` → 无脚本依赖旧语义 |

**边界（应显式化，但非缺陷）**：该命令现为「真实杀死运行时连接」，语义比「合成 FSM 事件」更强（会真实消耗一次连接与一次重试预算）。它位于 `shouldRegisterTestHooks` 门内（`extension.ts:1228`），不属产品面。README 表格仍只写「Fire unexpected disconnect (AC-6a)」，未提「现在走真实死亡边」——属**可选**的文档增强，不判问题（该表格描述的是行为意图，且新语义**更**符合该意图）。

### 3.2 D6 —— 把类上已有的 `lastSeq` 提升为 `HostFailureRecorder` 接口成员

- 位置：`host-diagnostics.ts:175-196`（接口）；`lastSeq?(): number | null` 为**可选**成员，`:451` 类上早有实现。
- 必要性：调用方 `extension.ts:2349` / `:2384` 用 `lastSeq()` 判定「本次 start 的失败是否已被 Host 边界记过」（避免 Extension 的 `other` 兜底重复记账）—— 属**跨模块契约**，调用方拿到的类型就是接口。
- 是否超范围：**不超**。`scope-amendment-01.md` 未禁止；它是「接口即对外契约」的既有做法的直接应用（同文件 `HostFailureRecorder` 已用可选成员 `mark`/`records` 收口），**零运行时行为变更**（类上实现原样复用），且 `:323` 的 `mark()` 已经依赖它。
- 判定 ✅（若调度者坚持最小面，可回退为仅类上成员；但接口形态更符合 AD-14「记录面契约」的既有取向）。

### 3.3 D7 —— 三个既有测试文件清除 `DSH_NODE_BIN`：**正确的测试卫生，不是掩盖产品缺陷**

**判断与理由**（用户要求给出立场）：

1. **这是产品行为，且是设计行为**：解析链优先级 `DSH_NODE_BIN > dsh.nodeBin 设置 > PATH > process.execPath` 是 AD-9/AD-11 明确规定的，README 与错误提示都以此为准（`tests/node-env-guard.spec.ts:431` 断言来源标签为「`DSH_NODE_BIN` environment variable」）。开发机导出该变量从而改变实际解释器 = **符合预期的产品行为**，不是缺陷。
2. **测试侧的后果是"假红/假绿"而非真缺陷**：这些用例测的是**设置项那一层**（`source === 'vscode-setting'`）；若继承值抢答，用例测的就不再是它声明的那一层 —— 这正是「测试未隔离」的经典问题。
3. **仓内已有先例**，属既有约定：`tests/session-host-preflight.spec.ts:90-112` 早已提供 `withoutEnvironmentValue` / `withEnvironmentValue` 两个"清除+恢复"助手；本 Phase 的三个文件采用同形（保存原值 → `beforeEach` 清除 → `afterEach` 恢复）：`session-host.spec.ts:20-34`、`node-env-guard.spec.ts:581-594`、`layer-v-inject-disconnect.spec.ts:50-69`（后者注释里显式引用该先例）。同形的第 4 处 `host-diagnostics.spec.ts:977-990` 亦在。
4. **未掩盖产品缺陷**：脚本侧的对应要求（AD-11 末句「显式清除继承的 `DSH_NODE_BIN`」）不是靠测试补的，而是由运行脚本**显式 `unset` + 断言 `printenv` 为空**落实，并有真机证据（`layer-v-status.json:1181-1184`：`unsetPerformed: true`、`printenvAfterUnset: ""`、`assertion: "printenv DSH_NODE_BIN returned empty"`）。

判定 ✅。

### 3.4 `layer-v-driver` 的组织约定（CJS / 无 `bin` / 零依赖）

| 约束 | 实测 | 判定 |
|---|---|---|
| 纯 CJS | `test-scripts/layer-v-driver/package.json` → `"main": "./extension.cjs"`；驱动为 `.cjs` | ✅（AD-6） |
| 无 `bin`、零依赖 | 该 `package.json` 无 `bin`、无 `dependencies`/`devDependencies`；`private: true` | ✅（AC-35 的「零仓库改动」承诺未被污染；`pnpm-lock.yaml` 的改动也没有引入新包，见 §10 观察 4） |
| 与仓内既有测试夹具的组织方式一致 | 落在既有、已 git 追踪的 `apps/vscode-dsh/test-scripts/`（`design.md:261` 指出的既有先例 `run-chat-ready-regression.sh` 同目录、同「从仓库根 bash 调用」入口惯例）；驱动作为**独立 extension 目录**而非被 app 的 `package.json` 吸收 —— 与「不把它们变成产品构建的一部分」的既有边界一致 | ✅ |
| `activationEvents` | `["*", "onStartupFinished"]`，`engines.vscode: ^1.90.0` | ✅ 可被真机加载（`code 1.112.0` 满足）；未引入与 app 侧不兼容的 engine 约束 |

### 3.5 AD-12 的常量口径（顺手核过，两处易错点均正确）

- `approvalMs: 180000`（`extension.cjs:78`）是**等待审批出现**的上限（`spec.md:183` 只要求"覆盖实测 4070ms 并留足余量"），**不是** 120s 上限。
- 120s 是**作答窗口**：`answerMs: 120000`（`:83`），实际用于 `:1405` / `:1658`，超即以 `LINK_FAILURE` 收（`:1668` `step-4-…-contrast-not-answered`）—— 与 `spec.md:107,211` 的「审批在 120s 内未被作答 → `LINK_FAILURE`」逐字一致 ✅。
- 首步未被拒绝时**立即**判失败（不等超时）：`:1321-1322`（`not-denied` → 当步失败）✅。

---

## 4. 文档保真（重点 5）

### 4.1 `README.md` / `README.zh.md` / `README.i18n.yaml` 四节 vs `spec.md` 契约

| 契约项 | `spec.md` 出处 | README 三件套 | 判定 |
|---|---|---|---|
| 产物目录路径 | `spec.md:26`（AC-26）/ `:34`（AC-33） | `apps/vscode-dsh/test-artifacts/layer-v/` | ✅ |
| 截图命名规则 | AC-26「稳定、与步骤一一对应」 | `step-<n>-<slug>.png`，`<n>` = 1–5，`<slug>` 列出 `started`/`conversation`/`round-trip`/`approval`/`diff` | ✅ 与驱动 `LINK_STEP_SLUGS`（`extension.cjs:71`）及真机文件名（`test-artifacts/layer-v/step-1-host-started.png` … `step-5-native-diff.png`）一致 |
| 跳过条件清单 | `spec.md:160-162` 跳过表 | 覆盖 `SKIPPED_NO_DISPLAY`（Xvfb 缺失/启动失败/权限不足）与 `SKIPPED_NO_CREDENTIALS`（无有效 `DEEPSEEK_API_KEY`），并含「不依赖 `apt`/`sudo`」 | ✅ |
| 退出码含义 | `spec.md:163-168` 结论分类契约 | `PASS 0` / `LINK_FAILURE 1` / `SKIPPED_NO_DISPLAY 2` / `SKIPPED_NO_CREDENTIALS 3` / `HARNESS_ERROR 4` | ✅ 逐值一致；且与 `artifact-index.md` 实测行（`PASS 0`、`LINK_FAILURE 1`、`SKIPPED_NO_CREDENTIALS 3`、`HARNESS_ERROR 4`）一致 |
| 双语一致性 | — | `pnpm run verify-translation-pairing`（显式 `PATH` 指向 `node 24.3.0`）→ `apps/vscode-dsh/README.md` ↔ `README.zh.md` **配对通过**（其余 `docs/wiki`、`packages/**/README` 的失配属既存状态，不在本 Phase 改动集） | ✅ |

### 4.2 `artifact-index.md` 的格式 vs AC-33

**内容面 ✅、结构面 🟡**（详见 §9 的 🟡-1）。

- AC-33 要求记录的**四件事**全部在行内：运行时间、产物目录、结论 + 退出码、步骤→稳定文件名映射（缺截图写 `—` 而非省略）。23 行覆盖 23 次运行，`git ls-files` 追踪（驱动侧亦有 `:2139` 的追踪校验并记入 `report-meta.json`）✅。
- 但文件**当前不是一张连续表**：`artifact-index.md:14-16` 是表头 + 1 行，`:18-24` 插入了 `## Reading an entry` 说明段，`:25-46` 才是其余 22 行 → Markdown 渲染为两张表，且第二张表的首行会被当成表头。
- 该分裂**会自持续**：写入器用「全文最后一行 `|`」定位插入点（`run-layer-v-smoke.sh:2261-2267`），永远接在**下方**那段块尾。

---

## 5. `.gitignore` 规则写法（重点 6）

- 实测 `apps/vscode-dsh/test-artifacts/`（`.gitignore:49-52`）：
  - 作用域：仓库根 `.gitignore` + 仓库根相对路径 + 目录尾斜杠 —— 与既有的 `apps/web/dist/`（`:35`）、`.agents/worktrees/`（`:42`）**同形** ✅
  - 粒度：忽略整个 `test-artifacts/` 树（截图、状态 JSON、step-5 探针），与 AC-26「该目录必须由一条显式规则忽略」一致；**未**过宽（不涉及 `apps/vscode-dsh/src` 或 `lib/`）✅
  - 注释风格：沿用文件既有的「`# 说明（do not commit）`」分组注释（对比 `:45`）✅；本处注释为 3 行，比文件其余分组注释长，但解释的是**非显然的 why**（「探针放在这里，是为了让模型能编辑它而不碰应用源码；它与截图都是运行产物，不是交付物」）——符合仓库注释哲学 ✅
  - 该规则不遮蔽任何被追踪文件（`test-artifacts/` 本就不在追踪集内），`git check-ignore` 命中来自仓库根规则 ✅

---

## 6. 注释与文档策略（重点 7）

| 检查项 | 实测 | 判定 |
|---|---|---|
| 新增注释解释「为什么」而非复述「做了什么」 | 抽样全部为 why：`extension.ts:1229-1231`（为何不直接戳 FSM）、`session-host.ts:714`（为何要保留已解析的可执行文件）、`host-diagnostics.ts:20-25`（v2 从何而来）、`extension.cjs:1130`（为何**不** `await dsh.newConversation`）、`run-layer-v-smoke.sh:2260-2266`（为何必须 splice 而不是 append）、`layer-v-inject-disconnect.spec.ts:50-56`（为何要清除环境变量并引用先例） | ✅ |
| 无 CoT 泄漏（未提交草稿的 §N、设计会话编号、思考过程） | 核过本 Phase 改动集的注释与文档：引用的都是**已提交/已冻结**的标识（`AD-12` / `AC-6a` / `DEBT-010` / `R1.3` / `spec.md` 章节），**未**出现「决策 N」「audit item」式会话残留 | ✅ |
| 双语注释策略与仓库一致 | 代码注释英文、spec/设计文档中文（`repo-exploration-zh.md` 成对）——与仓内 `AGENTS.md` / `docs/AGENTS.md` 的既有分工一致 | ✅ |
| 无冗余注释 | 未发现「// Import the module」式复述 | ✅ |

---

## 7. 架构决策对照（AD-1 .. AD-16）

> 逐条核过；「本 Phase 未触及」的条目给出未触及理由，避免"没看就说没问题"。

| 决策 | 本 Phase 的落点 | 遵循 | 证据 |
|---|---|:--:|---|
| AD-1 门槛与 spawn 共用解析结果 | 未改解析链；新记录边的 `resolvedExecutable` **就是** spawn 用的同一 `ResolvedNodeExecutable` | ✅ | `session-host.ts:415-418` 保存 → `:822` 写入；真机 `resolvedExecutable` 与 `report-meta.json` 的 `node.resolved` 同值 |
| AD-2 Node 校验口径 | 未改；`node-environment` 的 detail/hint 文案未动 | ✅ | `host-diagnostics.ts:212-232` |
| AD-3 观察/归类在 `IdeSessionHost` | 新记录边落在 `session-host.ts`（`onTransportDeath`/`recordTransportDeath`），呈现仍在扩展 | ✅ | `session-host.ts:776-822`；`extension.ts` 只读记录 |
| AD-4 复用既有 `failed` 终态 | FSM 入口与状态机成员**未变**；`injectDisconnect` 经由产品 status watch 退出 `started` | ✅ | `layer-v-inject-disconnect.spec.ts:170-187` |
| AD-5 结构化只读字段穿 SDK 边界 | 记录字段面未增；`kind` 词表未增（复用 `child-exited`） | ✅ | `host-diagnostics.ts:51-68,212-232`（穷尽 `Record`，无新成员） |
| AD-6 双 `--extensionDevelopmentPath` + 纯 CJS 驱动 + 最小 flag 集 | 驱动 = 独立 CJS extension，`main: ./extension.cjs` | ✅ | `layer-v-driver/package.json`；`run-layer-v-smoke.sh` 的 launch 段 |
| AD-7 截图 git-ignored / 索引 git 追踪 | `.gitignore:49-52` + `artifact-index.md` 被追踪 | ✅ | `git check-ignore`；`run-layer-v-smoke.sh:2139` |
| AD-8 显示顺序 `reuse → xvfb → SKIPPED_NO_DISPLAY` | 未改；索引中跳过行用码 2 语义 | ✅ | `artifact-index.md` 结果列；README 退出码节 |
| AD-9 `dsh.nodeBin` + 三级 fail-loud 链 | 真机证据显示解析命中**设置项**层 | ✅ | `layer-v-status.json:1189-1190`（`source: 'vscode-setting'`） |
| AD-10 AC-2/AC-3 文档落点 | 本 Phase 的 README 增补只写**冒烟脚本自身**的产物/命名/跳过/退出码（+ 其前置的 `DSH_NODE_BIN` 清除），**未**新建第三份 Node 指导文档 | ✅ | `apps/vscode-dsh/README.md` 四节 |
| AD-11 设置项 + `PATH` 前置 + 显式清除继承 `DSH_NODE_BIN` | 三条都落实；测试侧同类隔离见 D7 | ✅ | `layer-v-status.json:1176-1184` |
| AD-12 审批两步式 + `answerApproval` + 120s | 见 §3.5 | ✅ | `extension.cjs:83,1321-1322,1405,1668` |
| AD-13 审批证据双通道 | 未改证据通道；新记录边不替代会话日志通道 | ✅ | 驱动 step4 证据（`layer-v-log-evidence.json` 独立于诊断记录） |
| AD-14 诊断记录（**含修订 01 叠加层**） | 见 §2（第三成员 / 版本 2 / 18 字段 / 记录边 / 三口径） | ✅ | 同上 |
| AD-15 第 5 步 = route A（`HOME` 沙箱 + 影子 preset） | 影子 preset 生成器**单一实现**（`layer-v-shadow-preset.sh` 的 `layer_v_write_shadow_preset`；`--check-shadow-preset` 为薄入口），主脚本 source 后调用，**无第二处生成实现**；`diff` 断言恰 2 行删除 0 新增 | ✅ | `layer-v-shadow-preset.sh:38,153,180,234-254`；`run-layer-v-smoke.sh` 只引用其函数；自检输出 `28,29d27` + 两次 sha256 相同 |
| AD-16 生命周期约束（干净沙箱 / `replay` 判失败 / 不 `await newConversation` / 回收 Crashpad） | 三条均可见：`newConversation` 显式**不** await（`extension.cjs:1130-1136`，注释给出原因）；每步前干净状态断言（`:2066-2080`）；`replay` 判失败 | ✅ | 同上 |

---

## 8. 模块 / 命名 / 结构审查

| 新文件 | 所在目录 | 是否合理 | 说明 |
|---|:--:|:--:|---|
| `tests/layer-v-inject-disconnect.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 与既有 `*.spec.ts` 同目录、同 vitest 组织方式；名字表达范围（inject-disconnect 的落点实测） |
| `test-scripts/layer-v-shadow-preset.sh` | `apps/vscode-dsh/test-scripts/` | ✅ | 与 `run-layer-v-smoke.sh`、既有 `run-chat-ready-regression.sh` 同目录同级 |
| `test-scripts/layer-v-driver/`（extension 目录） | 同上 | ✅ | 独立 extension 夹具（有自己 `package.json`），与 app 构建解耦 |
| `.specdev/…/artifact-index.md` | spec 目录 | ✅ | 位置符合 AC-33（spec 产物、被 git 追踪、不落 ignore 目录） |

| 命名 / 符号 | 实际 | 既有规范 | 判定 |
|---|---|---|:--:|
| 文件 | `kebab-case`（`layer-v-inject-disconnect.spec.ts`、`layer-v-shadow-preset.sh`） | 仓内 `kebab-case` | ✅ |
| 函数 / 变量 | `recordTransportDeath` / `injectRuntimeDeath` / `V1_RECORD_FIELDS` / `postLink` | camelCase + 常量 UPPER_SNAKE；与同文件既有命名同形 | ✅ |
| 新类型成员 | `'post-handshake'` | kebab-case 字符串联合，与 `'start' \| 'retry'` 同形 | ✅ |
| shell 函数 | `layer_v_*`（生成器）与 `LV_*`（主脚本 env 传参） | 与主脚本既有的 `LV_*` 前缀约定一致；生成器自带前缀避免与调用方符号冲突 | ✅ |

**依赖方向**：`session-host.ts`（Host 边界）不反向依赖 `extension.ts`；扩展侧只通过 `HostFailureRecorder` 接口读记录（`host-diagnostics.ts:175-196`）；驱动侧只经 `vscode.commands` 与产品交互 → 无环、无越层 ✅。

---

## 9. 关键发现

### 🔴 Must-Fix

**🔴-1 · 驱动命名并执行白名单外命令 `dsh.showHostDiagnostics`，该与 `spec.md:151` 的冲突未登记（违反 `constitution.md` §6.2）**

- `spec.md:151`：「本 Phase 的**允许调用命令集 = 上表白名单 69 条 + `dsh.test.answerApproval` + `dsh.test.getDiagnosticsText`**。**任何** 其它命令名**不得**出现在驱动源码中。」
- 实际：`dsh.showHostDiagnostics` 出现在驱动源码 `test-scripts/layer-v-driver/extension.cjs:68`（`REQUIRED_COMMANDS`）、`:1009`（注册前提断言）、`:1018-1021`（专用断言 + **执行**一次）；而该名字在 `spec.md` 的 69 条白名单表中**不存在**（全 `spec.md` 仅 `:196` 提到它）。
- 同一份 spec 的 `:196` 又**要求**：「驱动断言 `vscode.commands.getCommands()` 含 `dsh.showHostDiagnostics` 且可无异常执行」→ 驱动**必须**在源码里写出该名字。即 `:151` 与 `:196` **互相矛盾**，实现方选择服从 `:196`（更具体、且该命令是 HEAD 既有、只读的诊断面：基线 `extension.ts:537` 已注册）——**这个选择是正确且必要的**。
- 问题不在代码，而在**未登记**：`implementation.md` §6.1（spec 文字漂移 D1–D4）与 §6.2（实现偏差 D5–D8）**都没有**这一条，而它正是 D1–D4 同一类「spec 文字与事实/自洽性冲突」。`constitution.md:59`（§6.2）要求「所有与 spec 不一致的实现必须写入 `implementation.md` 偏差章节」→ **硬约束被违反**。
- **修复面（无需改产品代码）**：在 `implementation.md` §6.1 增加一条（写明 `:151` vs `:196` 冲突、依 `:196` 落地、命令为 HEAD 既有只读面），并建议调度者把该命令补入 `spec.md` 白名单（spec 属用户的冻结面，需用户/调度者裁定，不属 implementer 自行改动）。

**🔴-2 · `spec.md:196` 要求的 `kind === 'node-environment'` 记录断言在实现中完全缺席，且未登记（违反 `constitution.md` §6.2）**

- `spec.md:196` 的逐字段断言清单明文包含：「**存在 `kind === 'node-environment'` 且 `resolvedExecutable` 为绝对路径的记录**」。
- 实测：`rg -n "node-environment" apps/vscode-dsh/test-scripts/` → **零命中**（驱动既不断言该 kind，也无该字符串）；`implementation.md:63` 的「AC-13 / AC-14 补充证据」只写了「18 字段面 + v2 版本号由唯一常量产出」，**丢失了该子句**。
- 该子句**不在**授权范围内：`scope-amendment-01.md:77`（§4）明文列出「**未**改变 …『补充证据』项（AC-10 / **AC-13 / AC-14**）」；`:70`（R1.4）进一步规定「若该构造在结构上无法产出…**不得**改写为『`[]` 合法』或『无需字段证据』（那属于改 AC 验收口径，须用户批准）」。
- 该子句在本脚本的绿灯运行中**很可能结构上不可得**：`HostDiagnosticRecord` 只在失败路径产生（`host-diagnostics.ts:394-396` 的 `onStartSucceeded()` 只重置失败链、`:403` 的 `record()` 为唯一推入点、`:443` 的 `records()` 只返回已推入项）；而 `kind === 'node-environment'` 只在 **pre-handshake 的 Node 预检被拒**时产生（`host-diagnostics.ts:52,281` + `session-host.ts:462`），本 Phase 的脚本又要求「无合格 Node 即 `HARNESS_ERROR`」（`spec.md:161`）→ 绿灯运行不可能出现该记录。
- **这正是必须显式处置的点**：不是"补一句断言"就能了事，也不是"静默略过"。二选一：**(a)** 若认为结构上可得（例如以受控的 pre-handshake 预检失败构造），补断言并落真机证据；**(b)** 若确认结构上不可得，按 `scope-amendment-01.md:70`（R1.4）的既定路径**以带证据的升级提交用户裁定口径变更**。无论哪条，先在 `implementation.md` §6.2 登记。

### 🟡 Should-Fix

**🟡-1 · `artifact-index.md` 的表被说明段拦腰截断（AC-33 的格式面）**

- 结构：`artifact-index.md:14-16` = 表头 + 分隔行 + 第 1 行；`:18-24` = `## Reading an entry` 说明段；`:25-46` = 其余 **22** 行（含两次 `PASS 0`）。
- 渲染结果：两张表，第二张无表头（其首行会被当作表头）。
- 会自持续：写入器以「全文最后一行 `|`」为插入锚（`run-layer-v-smoke.sh:2261-2267`，其注释自述目标是「Rows belong *inside* the run table」），因此新行永远落在**下方**那块之后，分裂不会自愈。
- 另有一处措辞与实现不符：`artifact-index.md:8` 写「`run-layer-v-smoke.sh` (appended at the end of every run)」，而写入器实际是 **splice 进表内**（`:2259-2269`）。
- 影响：AC-33 要求的四项**数据**齐全（不判 MUST-FIX），但索引作为"产物索引清单"的可读性/一致性受损；且它正是 AC-33 的交付物本体。
- 修复（任选其一，均为一处小改）：把 `## Reading an entry` 移到表前；或让 `lastTableLine` 锚定在**首个表头所在表的末行**；并同步 `:8` 的措辞。

### 🟢 Observations

**🟢-1 `[文档保真]` · `implementation.md` 引用的 `layer-v-status.json` 键路径不存在**

- `implementation.md:48` 与 `:99` 均以「`layer-v-status.json` 的 `r1.postHandshakeRecords[]`」作为 R1 字段级证据的位置。实测该文件**没有** `r1` 键：实际位置是 `postLink.record`（`layer-v-status.json:1253-1260`，含 18 字段 + `schemaVersion: 2`）与 `node.extensionSubprocessSide`（`:1186-1194`，含 `via: 'controlled-post-handshake-disconnect'`、`resolvedExecutable`、`source`、`schemaVersion: 2`、`recordSeq`、`recordKind`、`recordPhase`）。
- 底层主张为真（两字段与观测版本确实在真机产物中，且与 `report-meta.json` 的 `node.resolved` 同值）→ 仅**位置引用**失实，对交付物零影响，**不计入判决**。

**🟢-2 `[文档保真]` · `implementation.md:86` 引用的是**改动前**的行号**

- 该行引用 `host-diagnostics.ts:341-343`（`onStartSucceeded()`）与 `:385-387`（`records()`）；当前实际为 `:394-396` 与 `:443-445`。
- 同组数字也出现在 `scope-amendment-01.md:61`（连同 `:24` 的「常量真相源 `host-diagnostics.ts:20`」实为 `:26`、`:26` 的 `session-host.ts:727-757` 实为 `:776-822`、`:69` 的 `extension.ts:1214-1217` 实为 `:1228-1232`）—— 但该文件是**改动前**写下的裁定文本（自述为「叠加层」，且 `spec.md` 一字未改），行号漂移属**预期**，不算偏离。需要提醒的只是：`implementation.md` 是**改动后**的产物，应引用当前行号。
- 对交付物零影响，**不计入判决**。

**🟢-3 · 驱动的状态文档自身 `schemaVersion: 1` 不是「第二处版本真相源」**

- `extension.cjs:2026-2027`、`:2171-2172` 的 `schemaVersion: 1` 描述的是**驱动↔脚本**的状态文档契约（`layer-v-status.json` 自身的形状），与 `HostDiagnosticRecord` 的 `schemaVersion` 是**两个不同契约**；后者的观测值已按决策 10 记入同一文档（`node.extensionSubprocessSide.schemaVersion = 2`、`postLink.record.schemaVersion = 2`）。
- 两者同名确实有误读风险，建议将来在状态文档里加一行注释区分；**当前无需动作**（本项不构成"版本多处真相源"）。

**🟢-4 · `auto-start-orchestrator.ts` 不写记录：与 AD-3/AD-13 一致，未留下第二无生产者通道**

- 该处是编排器**合成**的 `failed` 快照（无观察者），依 AD-13「Host 边界说话」不应写记录；真实死亡已由 `onTransportDeath` 记录，重试以 `phase: 'retry'` + `retryOfSeq: <死亡 seq>` 挂在同一条链上（`layer-v-inject-disconnect.spec.ts:198-200` 实测）→ **一次死亡仍是一条记录**。此取舍**正确**，仅在此备案以便后续读者不再重复提问。

**🟢-5 · `lastSeq?()` 的"可选成员"形态**

- 接口用 `lastSeq?(): number | null`（可选）而非必填（`host-diagnostics.ts:175-196`；同接口的 `setCredentials` / `record` 仍为必填），调用侧以 `?.` 读取（`extension.ts:2349`、`:2384`）→ 零行为变更。可选形态的正当性由接口自身注释给出（「Optional: a recorder that retains nothing has no mark to report」），即它保护的是「保留不了记录的实现」这类替身，而非放宽产品契约。记录备查。

---

## 10. 实际验证动作（读了什么 / 跑了什么 / 看到什么）

**读（原文，非摘要）**：`spec.md`（含文末修订段 R1，逐节读；`:122-199` 白名单表 / skip 表 / 验证策略逐行对照）、`scope-amendment-01.md`（全文 79 行）、`design.md`（AD 标题全列 + AD-6a 相关 `:261`、AD-10/AD-11/AD-12/AD-14/AD-15/AD-16 段）、`implementation.md`（§1–§7 含 §6 偏差台账 D1–D8）、`constitution.md`（全文 69 行）、`artifact-index.md`（全文 47 行）、`host-diagnostics.ts` / `session-host.ts` / `extension.ts` 的改动面、`tests/{host-diagnostics,session-host,node-env-guard,layer-v-inject-disconnect,auto-start-orchestrator,session-host-preflight}.spec.ts` 的相关区段、`test-scripts/layer-v-driver/extension.cjs`（关键段：`:61-110`、`:1000-1040`、`:1120-1140`、`:1300-1330`、`:1400-1420`、`:1650-1670`、`:1893-1960`、`:2020-2035`、`:2085-2110`、`:2158-2180`）、`test-scripts/layer-v-shadow-preset.sh`（函数清单与薄入口）、`run-layer-v-smoke.sh`（`:2130-2275`）、`.gitignore`（全文）、`apps/vscode-dsh/README*.md` 与真机产物 `test-artifacts/layer-v/{layer-v-status.json,layer-v-plan.json}`。

**跑的命令与结论**：
1. `rg -n "HostDiagnosticPhase" apps/vscode-dsh/{src,tests}` → `src/` 仅 3 处（`:20` 文档、`:70` 类型、`:86` 字段）→ **无按 phase 分支的消费方**，不存在未覆盖分支。
2. `rg -n "hostFailureKindForStartError|HostFailureKind"` + 读 `host-diagnostics.ts:265-289` → 该映射的输入是 `StartErrorKind`，与 `phase` 不同轴；`FAILURE_DETAILS`/`FAILURE_HINTS` 为穷尽 `Record<HostFailureKind, …>`，本 Phase 未增 `kind`。
3. `rg -n "schemaVersion" apps/vscode-dsh/src apps/vscode-dsh/tests` + 读驱动 `:1939-1960` → 版本分流三口径完整；`src/` 唯一字面量即 `:26` 的常量。
4. 读 `test-artifacts/layer-v/layer-v-status.json`（`:1175-1200`、`:1235-1262`）→ 观测版本 `2` 已落盘；`recordsBefore: 0 → recordsAfter: 1`；`postHandshakeRecordCount: 1`；两字段齐备且 `source: 'vscode-setting'`；`DSH_NODE_BIN` 清除证据在 `:1176-1184`。
5. `rg -n "injectDisconnect"` 全仓（排除本 Phase 产物）→ 消费者只有 README 表格、驱动 `:1911`、两处源码；既有 `run-chat-ready-regression.sh` **不调用** `dsh.test.*` → D5 未破坏任何脚本级契约。
6. `git diff 300f492f84 -- apps/vscode-dsh/src/extension.ts`（读）→ 确认旧 `injectDisconnect` 是直接 `orchestrator?.onUnexpectedDisconnect()`，新实现为 `await host?.injectRuntimeDeath()`，并带"为什么不直接戳 FSM"的注释。
7. `rg -n "DSH_NODE_BIN" apps/vscode-dsh/tests` → 4 处同形的「保存/清除/恢复」写法，其中 `session-host-preflight.spec.ts:90-112` 是先例 → D7 属既有约定。
8. `rg -n "REQUIRED_COMMANDS|showHostDiagnostics"` 驱动 → `:64-69` 前提清单 + `:1009` 通用缺失检查 + `:1018-1021` 专用断言与执行；`rg -n "showHostDiagnostics" spec.md` → 仅 `:196`（**不在** `:122-148` 白名单表内）。
9. `rg -n "node-environment" apps/vscode-dsh/test-scripts` → **零命中**；`rg -n "node-environment" spec.md` → `:196`；读 `host-diagnostics.ts:275-289` 与 `session-host.ts:142,462` → 该 kind 只由 pre-handshake 预检失败产生。
10. `rg -n "approvalMs|answerMs|120000"` 驱动 → 等待上限 180s / 作答窗口 120s（`:83,1405,1658,1668`），与 `spec.md:107,211` 一致。
11. `git show 300f492f84:apps/vscode-dsh/src/extension.ts | rg showHostDiagnostics` → 该命令在 HEAD **已存在**（基线 `:537`、`:1230` 的导出）→ 驱动对它的命名不是新增产品面。
12. `pnpm run verify-translation-pairing`（显式 `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`，绕开 `node:sqlite` 不可用）→ `apps/vscode-dsh/README.md` ↔ `README.zh.md` 配对通过；同时看到 `docs/wiki`、`packages/**/README` 存在既存失配（不在本 Phase 改动集，属噪声）。
13. `git check-ignore -v apps/vscode-dsh/test-artifacts/layer-v/step-1-host-started.png` → 命中仓库根 `.gitignore` 规则（`.gitignore:52`）。
14. `ls` 本 Phase 目录 → 无既有 `review-design.md` / `review-design-zh.md` → 启动自清理协议无需求归档；全程**未**执行任何 `mv`、**未**执行任何 git 写操作、**未**改动任何产品/脚本/测试/spec 文件。

**未能核验（留给其他视角，避免越界）**：驱动各断言在真机上的**行为**正确性（属 reviewer-correctness）、记录从 Host 到 `dsh.test.getDiagnosticsText` 的**端到端可达性**（属 reviewer-connectivity）、以及 23 行索引所对应的 23 次运行是否**逐一可复现**（属 verifier）。
