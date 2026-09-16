# 设计一致性审查 — Phase 2（`phase-2-host-fail-loud-diagnostics`）

## 视角

**设计一致性（Design Consistency）** — 实现是否遵循 `design.md` 的架构决策、模块划分、命名/分层与代码库既有约定。

本报告**不**评价：实现逻辑是否正确（属 `reviewer-correctness`）、端到端是否连通（属 `reviewer-connectivity`）、界面外观（属 `reviewer-visual`；本 Phase 实测 `ui: false` → `N/A`）。

## 判决：MUST-FIX

唯一的 must-fix 是**冻结契约的类型面偏离**（`HostDiagnosticRecord.kind` 的成员词表为 8 个，而设计冻结为 7 个；且契约用例的期望值取自实现，`implementation.md` §3 自陈"无类型变更"与事实不符）。其余架构决策逐条遵循。修复需要一次**显式裁定**（收窄类型，或改设计并留痕），因此不能在 `implementation.md` 里沉默通过。

## 审查输入（实测时间 2026-09-15 22:5x，分支 `impl-phase-2-host-fail-loud-diagnostics`）

| 输入 | 读法 |
|---|---|
| `phases/phase-2-host-fail-loud-diagnostics/spec.md` | 完整读（94 行） |
| `phases/phase-2-host-fail-loud-diagnostics/repo-exploration.md` | 完整读（含「Existing Constraints」与契约字段清单 `repo-exploration.md:293`） |
| `phases/phase-2-host-fail-loud-diagnostics/implementation.md` | 完整读（224 行） |
| `design.md:160-333`（AD-1 – AD-14） | 定点读。另核 `AD-15:334` / `AD-16:416` 的标题与决策行（均属 Phase 3） |
| `requirements.md:135-153`（AC-13 – AC-22 原文） | 定点读 |
| `tech-debt-registry.md` | 完整读（117 行） |
| 产品代码（读函数体） | `host-diagnostics.ts`（新）、`session-host.ts`、`auto-start-orchestrator.ts`、`extension.ts`、`interaction-coordinator.ts`、`package.json`、`client.ts`、`index.ts` |
| 测试代码（读用例体） | `host-diagnostics.spec.ts`（新，1011 行）、`session-host.spec.ts`、`sdk-client.spec.ts` 的相关区间 |

独立探测（可复跑）：`git diff` / `git show HEAD:<file>`（只读）、`git status -s`、`stat -c '%y %n'`、若干 `grep -rn`（命令与结论见各条证据）。**未运行任何 git 写命令，未修改 `current-status.json`。**

## 架构决策对照（AD-1 – AD-16）

| 决策 | 本 Phase 相关性 | 实现是否遵循 | 关键证据 | 判定 |
|:---|:---|:---|:---|:--:|
| AD-1 门槛与 spawn 共用解析结果 | 消费 Phase 1 的 `ResolvedNodeExecutable`（含 `source`） | 是 | `session-host.ts:209`（`nodeBinSetting` 透传）、`host-diagnostics.ts:73`（`source: NodeExecutableSource \| null`）、`packages/sdk/client/src/types.ts:24` 的 3 成员与设计一致 | ✅ |
| AD-2 版本号仅用于诊断 | 记录 `nodeVersion` / `expectedRange` | 是 | `host-diagnostics.ts:75-77`、`session-host.ts:145-149` | ✅ |
| AD-3 观察/归类的权威位置 | **核心** | 是 | 归类只在 `session-host.ts:134-179`（`describeStartFailure`，按 `instanceof` + stage 判定，JSDoc 明写 "without reading its message"）；扩展只呈现（`extension.ts:422-453`），并在**未归类**时写一条 `other`（`extension.ts:2363-2372`，判据是 `!(error instanceof HostStartError) && lastSeq() === seqBeforeStart`——结构化判据，**未**解析消息）；`IdeSessionHost` 依赖端口而非 VS Code（`session-host.ts:103`）；`ConnectionUiController` 未重构（`connection-ui.ts` 不在改动集） | ✅ |
| AD-4 复用 `failed` 终态，不加状态机成员 | 是 | `StartOrchestratorState` 成员未变（`auto-start-orchestrator.ts:18-25`，diff 未触及）；`START_ERROR_KINDS`（`:27-33`）加性扩展 `bridge-listen` / `spawn` / `handshake-timeout`，与 AD-4（`design.md:186`）的词表逐一相同；`ConnectionUiPhase` 无改动 | ✅ |
| AD-5 结构化只读字段穿 SDK 边界 + 前缀兼容 | 是 | `TransportClosedDetails`（`client.ts:39-46`，5 个 `readonly` 字段 = 可执行文件 / spawn 错误 / 退出码 / 终止信号 / stderr 尾部）、`TransportClosedError.details`（`:68`）、`transportDetails()`（`:506`）；三条既有前缀保留（`:498` `spawn error:`、`:499` `exit code: N`、`:501` `stderr tail:`）；文本与字段在同一构造点生成（AD-5 取舍「不得漂移」） | ✅（前缀集有一处加性改动，见 SF-4） |
| AD-6 真机加载通道 | Phase 3 | 本 Phase 未触碰启动脚本 | N/A |
| AD-7 截图/索引 | Phase 3/4 | 无产物索引、无截图 | N/A |
| AD-8 显示环境 | Phase 3 | 无 `xvfb` / `DISPLAY` 相关改动 | N/A |
| AD-9 `dsh.nodeBin` + 三级链 | Phase 1 交付，本 Phase 消费 | 未改设置面（`package.json` diff 仅 `contributes.commands`，`configuration` 键未动）；`extension.ts:233` / `:2245` 引用 AD-9 正确 | ✅ |
| AD-10 文档落点 | Phase 1/3 | 本 Phase 不改 `docs/`；`AD-10` 在 `apps/vscode-dsh/src` 零命中 | ✅ |
| AD-11 冒烟脚本 Node 锁定 | Phase 3 | 无 `test-scripts/` 改动 | N/A |
| AD-12 审批两步式 + 作答钩子 | **本 Phase 明确不交付** | `answerApproval` / `resolveApproval` 在 `apps/vscode-dsh/src` 与 `packages/sdk/client/src` 零命中 | ✅ |
| AD-13 投影补 `toolName` / `reason` | **核心** | 改动仅限批准分支：`toolName`（必填，`interaction-coordinator.ts:69`）、`reason`（可选，`:71`）；`questions` 分支字段未变（`:208-215`）；`listPending()` 签名未变（`:197`）；抽出的 `projectEntry` 为 `private`（`:208`）。导出面比对 `git show HEAD:` 与工作区：8 个导出名/顺序完全一致，无新增导出 | ✅ |
| AD-14 `getDiagnosticsText` + 18 字段 + 版本策略 | **核心** | 字段名/数量 18 ✅（`host-diagnostics.ts:57-94`）、版本取自单一常量 ✅（`:20`）、`readonly` + 恒存在 + `null`/`[]` 语义 ✅、版本三口径均有用例（`host-diagnostics.spec.ts:186-207`、`:212-245`）、`[]` 不判版本 ✅（`:212`）、门禁内注册 ✅（`extension.ts:1105-1108`）、无文本渲染字段 ✅（用例 `:171-177`） | ⚠️ **`kind` 成员词表偏离**（MF-1） |
| AD-15 Diff 步骤 route A | Phase 3 | 无 `test-scripts/layer-v*`、无影子 preset 改动 | N/A |
| AD-16 真机生命周期 | Phase 3 | 无相关改动 | N/A |

## 关键发现

### 🔴 Must-Fix

#### MF-1 `HostDiagnosticRecord.kind` 的成员词表比冻结契约多 1 个，且契约用例的期望值来自实现，`implementation.md` §3 自陈"无类型变更"与事实不符

**冻结的期望值（三处权威一致，均为 7 个成员）**

- `design.md:307`（AD-14 决策 4 的字段清单，条款自述为「唯一真相源」）：`kind` = `'node-environment' | 'bridge-listen' | 'spawn' | 'handshake-timeout' | 'child-exited' | 'missing-credentials' | 'other'`
- `design-zh.md:308`（同表中文版）：同上，7 个成员
- `repo-exploration.md:78`（本 Phase 的调研报告，implementer 必读）：明写「the AD-14 `kind` vocabulary …… **（7 members, `design.md:307`）**」；`repo-exploration.md:293` 的契约字段表再次给出同一 7 成员类型

**实现实际是 8 个成员**

- `host-diagnostics.ts:38-46`：多出 `| 'invalid-setting'`（`:40`）
- `implementation.md:58`（导出表）与 `:107`（§3 字段表）都自称「8 members / one of the 8 members」
- 契约用例把 8 成员**内联**成期望值：`host-diagnostics.spec.ts:55-69`

**为什么这是设计一致性问题（而不是"实现更完善"）**

1. AD-14 决策 10（`design.md:326`）规定：`schemaVersion === 1` 时消费者**必须**断言「字段名 + 类型 + 可空性**恰好**等于上表」；`design.md:332` 明确「字段清单本身是本设计的实现细节，由本设计定稿」→ 冻结的 v1 类型里 `kind` 不含 `invalid-setting`。Phase 3 驱动按设计编写时，遇到 `invalid-setting` 记录会判类型不符。
2. `spec.md:63(b)` 对契约用例的要求是「以设计清单为期望值逐字段比对，**不以实现类型推断**」；而 `host-diagnostics.spec.ts:40-43` 的 JSDoc 声明「This is the expectation source …… never against the implementation's own types」，实际把实现的第 8 个成员写进了期望表 → 用例的自陈与实际不符，且这正是 `spec.md:63(b)` 要防的写法。
3. `implementation.md:123` 断言「**no field was added, removed, retyped or re-nulled** while implementing」，与 `kind` 联合类型相对设计加宽 1 个成员的事实冲突；§8「Deviations」也没有登记该偏离（§2.1 / §3 只是描述了 8 成员，未声明它偏离设计）。

**成因是设计侧的一个空档（因此不能只"改代码"了事）**：AD-4（`design.md:186`）把 `invalid-setting` 定为 `StartErrorKind` 的成员，而该失败由 `extension.ts` 的 `readNodeBinSetting` 在 `StartHostPort` 层抛出，`IdeSessionHost` 看不到它；若记录词表没有这个名字，`hostFailureKindForStartError` 只能返回 `null`（`host-diagnostics.ts:227-241` 的 default 分支），该失败就完全没有记录——这与 Phase 1 审查 hand-over 的「`invalid-setting` 必须有显式分支」以及 fail-loud 的取向相反。实现选择了"加一个成员"来消解空档，工程上合理，但**改的是被冻结的契约类型**。

**放行条件（两种收口，必须择一并在 `implementation.md` 留痕；两者都需同步修正用例期望表）**

- (a) **收窄类型**：`HostFailureKind` 去掉 `invalid-setting`，`hostFailureKindForStartError('invalid-setting')` 归入既有成员（`other`），并把 `START_ERROR_KIND_BY_FAILURE`（`host-diagnostics.ts:197-206`）与映射用例（`host-diagnostics.spec.ts:378`、`:394`）同步。此时 v1 字段面与设计逐字一致，不需递增版本。
- (b) **改设计**：在 `design.md`（+`design-zh.md`）AD-14 的 `kind` 行与 `repo-exploration.md:78` / `:293` 补上第 8 个成员，说明理由（该失败不经 Host 边界，需由 orchestrator 侧监听器归类）与对 Phase 3 驱动的影响；同时按 AD-14 决策 11（`design.md:327`）判断是否需要递增版本——本轮 v1 尚未发布，若裁定"8 成员即 v1"则不递增，但必须在 `implementation.md` 写明该判断，并撤掉 §3（`:123`）"无类型变更"的表述。
- 无论择哪条，`implementation.md` §8 都必须新增一条偏离记录（当前 §8 未覆盖它）。这是**用户/调度者层**的裁定，implementer 不应自行选择后沉默推进。

### 🟡 Should-Fix

#### SF-1 两处测试名保留了 Phase 1 审查条目码（违反本 Phase 硬约束，且与 `DEBT-005` 的收口口径相悖）

- `host-diagnostics.spec.ts:378` — `it('F-3.1: invalid-setting has an explicit class …')`
- `host-diagnostics.spec.ts:1006` — `it('F-3.2: a non-preflight failure carries no diagnostic payload')`

`F-3.x` 是 Phase 1 审查第 3 轮的发现编号（`implementation.md:182` 自述「F-3 landings（handed over from Phase 1 review round 3）」）。本 Phase 的约束禁的是"测试名或注释中的审查条目码"（`AD-*` 决策编号保留）。同族问题已在 Phase 1 作为 `DEBT-005` 修掉（`tech-debt-registry.md:44` 的证伪探针正是扫 `(S9)` / `(M2)` 这类码），本轮以 `F-3.x` 形态复现。附带：`implementation.md:220` 的自检声称「no review item codes in test names or comments」，与实测 2 处命中不符。建议改写用例名（内容不变），例如「`invalid-setting` has an explicit class instead of a default fallthrough」。`AD-14` / `AD-13` 等决策编号保留。

#### SF-2 §7 的 F-3.3 落点自述不实：`host-diagnostics.ts:70` 并未写明"仅 `process-exec-path` 来源才是绝对路径"

`implementation.md:188` 称「The record's field doc states the restriction (`host-diagnostics.ts:70`)」。实测该处 JSDoc 是「Absolute path of the Node executable the Host resolved and spawned, when known.」——无条件声称绝对路径，且全文件 `process-exec-path` 零命中（`grep -n "process-exec-path\|absolute" apps/vscode-dsh/src/host-diagnostics.ts`）。设计侧 `design.md:308` 同样写"绝对路径"，所以字段本身合规；问题是 §7 的落点声明与代码不符（`HostDiagnosticInput` 的同名字段 `:104` 亦然）。建议把该限制写进字段 JSDoc，或修正 §7 的表述（改文档即可，无行为影响）。

#### SF-3 `dsh.test.getDiagnosticsText` 注册处 JSDoc 未按 AD-14 决策 2 写明"不返回文本"

`design.md:296`（决策 2）与 `spec.md:70` 都要求注册时 JSDoc **必须**写明"名称沿用，返回结构化 JSON 记录数组，不返回文本"。`extension.ts:1100-1104` 写的是"名称沿用 + 值是 `HostDiagnosticRecord[]` + reader asserts fields rather than parsing prose"——语义上等价，但没有那句否定。加一句即可（零风险、零行为影响）。

#### SF-4 SDK 消息面在"被信号终止"分支增加了未列入设计前缀集的文本，且未在 §8 留痕

`design.md:190`（AD-5）钉的前缀集是 `exit code: N` / `stderr tail:` / `spawn error:`。`client.ts:499-500` 现在是：

- `exitCode !== undefined && !== null` → `exit code: N`（保留）
- 否则若有信号 → `termination signal: <sig>`（**新增**，且此前的 `exit code: null` 不再出现）

实测无仓内消费者依赖旧文本（`grep -rn "exit code" apps packages scripts` 无 `exit code: null` 断言；`client.ts` 之外无该前缀的解析者），因此不构成本 Phase 的功能阻塞；但它是公共错误类消息面的加性变更、未在 `implementation.md` §8 记录。建议二选一：(i) 在 §8 补一条偏离并说明"既不破坏仓内断言、也让消息与结构化字段一致（AD-5 取舍）"；(ii) 保留 `exit code:` 行并另起一行给信号。

#### SF-5 §8.1 的前提不成立（结论正确，论据错误）

`implementation.md:194` 称「the spec's file list assigns AC-19/AC-20 UI projection to this file（`connection-ui.ts`）」。实测 `spec.md:79-93` 的产出清单没有 `connection-ui.ts` 这一行；`repo-exploration.md` 的 `primary_files` 也没有它。该文件不改是对的（`spec.md:67` 的约束正是「`ConnectionUiController` 不重构」，且 `connection-ui.ts:128-129` / `:140` / `:152-154` / `:81` / `:188` 已满足 AC-19/AC-20 的 UI 侧要求），但偏离记录的前提要改成"设计约束要求不重构 + 实测既有投影已满足"。属文档保真问题（`DEBT-009` 同族）。

### 🟢 Observations（观察项）

- **O-1 `pnpm-lock.yaml` 在工作区是脏的，但与本 Phase 无关**：`stat -c '%y %n' pnpm-lock.yaml` → `2026-09-14 16:08:25`，早于本 Phase 的首次产品编辑（`implementation.md:146` 记 `client.ts` 21:48）。`git diff` 显示的是 `tsdown` specifier 与 vitest/vite 解析变化，而 `apps/vscode-dsh/package.json` 的 diff 只有 4 行 `contributes.commands`。→ 不由本 Phase 产生，§9 的"未新增依赖"对 `package.json` 成立；但 **HG-3 提交时不得把该文件纳入本 Phase 的改动集**。
- **O-2 `AGENTS.md` 亦为既存脏文件**：`stat` → `2026-09-15 20:57:35`（早于本 Phase 首次编辑），diff 是工具树文档改写（+349/−126），与本 Phase 无关。
- **O-3 `.cursor/skills/project-build/SKILL.md`**（`stat` → `22:46`，落在本 Phase 窗口内）由 implementer 依 agent 契约更新，`implementation.md:208`（§8.8）已披露，并与 `DEBT-009` 的用户裁定（`.cursor/` 工具树不随 Phase 入库）一致 → 已留痕，可接受。
- **O-4 `createStartHostPort` 的参数是具体类 `HostDiagnosticRecorder`（`extension.ts:2285`）而非 `HostFailureRecorder` 端口**：这是扩展内部的装配代码（扩展本来就是端口的实现方），AD-3 只要求 **Host** 依赖端口——该点已满足（`session-host.ts:103`）。仅作记录，不建议改。
- **O-5 `TransportClosedDetails.executable` 取 `this.runtime.command`（`client.ts:507`）**：即 SDK 层解析后的命令，不是 `dsh.nodeBin` 的原始值；与设计 AD-5 的"可执行文件绝对路径"在同一层语义上一致（Phase 1 已裁定 setting 来源允许非绝对，见 F-3.3 语境）。
- **O-6 未发现循环依赖**：`auto-start-orchestrator.ts` 无 import；`host-diagnostics.ts` 仅 `import type` 其类型（`host-diagnostics.ts:11`）；`session-host.ts` → `host-diagnostics.ts`（类型 + 纯函数）；`extension.ts` → 三者。方向单向。

## 模块 / 命名 / 结构审查

### 目录与模块划分

| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|:---|:---|:--:|:---|
| `host-diagnostics.ts`（新，439 行） | `apps/vscode-dsh/src/` | ✅ | 与 AD-3「归类在 Host / 呈现在扩展」的分层一致：本模块只放词表 + 记录契约 + store + 渲染，不含任何 `vscode` 依赖；`Host` 通过 `HostFailureRecorder` 端口消费它（`session-host.ts:103`） |
| `host-diagnostics.spec.ts`（新） | `apps/vscode-dsh/tests/` | ✅ | 与既有 `session-host.spec.ts` / `auto-start-orchestrator.spec.ts` 平级 |
| `client.ts` / `index.ts` | `packages/sdk/client/src/` | ✅ | 结构化细节落在 SDK 侧（AD-5）；`index.ts` 的 2 处导出见 §8.2 评估 |
| `interaction-coordinator.ts` | `apps/vscode-dsh/src/` | ✅ | 未新建文件、未搬层 |

### 命名规范（对照 `repo-exploration.md` 的既有一致性：kebab-case 文件、`dsh.*` 命令 id、`AD-*` JSDoc 引用）

| 项目 | 实际 | 判定 |
|:---|:---|:--:|
| 新文件名 / 命令 id | `host-diagnostics.ts`、`dsh.showHostDiagnostics`、`dsh.test.getDiagnosticsText`（名称沿用，设计决策 2） | ✅ |
| 导出符号 | `HOST_DIAGNOSTIC_SCHEMA_VERSION` / `HostDiagnosticRecord` / `HostFailureRecorder` / `formatHostDiagnosticRecord` …… 与既有 `NodeEnvironmentError` / `validateNodeEnvironment` 风格一致 | ✅ |
| 决策编号引用 | `(AD-3)` / `(AD-14)` / `(AD-13)`（`host-diagnostics.ts:6`、`:15`、`session-host.ts:108` 等） | ✅ 保留 |
| 审查条目码 | 2 处 `F-3.x` 用例名 | 🔴 → 见 SF-1 |

### 分层与依赖方向

| 约束 | 实测 | 判定 |
|:---|:---|:--:|
| Host 不依赖 VS Code | `session-host.ts` 无 `vscode` import；诊断能力经端口注入（`:103`、`:223`） | ✅ 与 AD-3 取舍「Host 多一个构造函数参数」逐字对应 |
| SDK 不依赖扩展 | `client.ts` 只加结构化字段与类型；`index.ts` 只加导出 | ✅ |
| 归类唯一入口 | `describeStartFailure` 仅 `session-host.ts:134` 一处定义 | ✅ |
| 扩展不解析消息做分类 | `grep -nE '\.message\.(includes\|startsWith\|match\|indexOf)'` 在 4 个改动文件中零命中；扩展兜底判据为 `instanceof` + `lastSeq()` 比较（`extension.ts:2363-2367`）；`detail` 字段内存放原文（AC-14 兜底要求）不构成分类 | ✅ |

### 代码库既有约定

| 约定 | 实测 | 判定 |
|:---|:---|:--:|
| ESM + `strict: true` | 无 CJS 写法；新增类型均为显式联合/接口 | ✅ |
| 导出需 JSDoc | `host-diagnostics.ts` 全部 15 个导出均有 JSDoc；`client.ts:31-38` 接口与 `:68` 属性均有 | ✅ |
| 文件末尾恰好一个换行 | 8 个改动文件逐一 `tail -c 2 \| xxd` → 均为 `…0a`（单换行） | ✅ |
| 无新增依赖 / 无日志库 | `package.json` diff = 4 行 commands；新模块 import 仅 `node:*`、`./redact.ts`、SDK 类型、同目录类型 | ✅ |
| 不新增 `contributes.configuration` | `configuration` 仍只有 Phase 1 的 `dsh.nodeBin`（`package.json:57`） | ✅ |
| 测试用真实子进程而非 mock 私有方法 | `implementation.md:96` 与 `session-host.spec.ts` 用例体一致（真实 `listen` 失败 / 真实不响应 `initialize` / 真实自杀信号） | ✅ |

## 不得越界项逐条核对

| 越界禁止项 | 出处 | 独立探测 | 结论 |
|:---|:---|:---|:--:|
| 未修改 `packages/core/agent-loop` | `spec.md:77` | `git status -s -- packages/core/agent-loop` → 空 | ✅ |
| 未新增依赖（尤其日志库） | `spec.md:76` | `package.json` diff 仅 commands；新模块无日志库 import；`pnpm-lock.yaml` 的脏态 mtime 为 09-14（O-1） | ✅ |
| 未新增 `contributes.configuration` | `spec.md:76` | `git diff -- apps/vscode-dsh/package.json` 无 `configuration` 段改动 | ✅ |
| `interaction-coordinator.ts` 未扩到审批作答面 | `spec.md:72`、AD-12 | `grep -rn "answerApproval\|resolveApproval" apps/vscode-dsh/src packages/sdk/client/src` → 零命中；diff 仅投影 | ✅ |
| `ui: false` → 无 UI 样式/视觉基准内容 | `spec.md:8` 与 DAG | 改动集无 `.css/.scss/theme/design-system/visual-baseline` 文件；本 Phase 无 HG-1.5 产物 | ✅ |
| 未新建 `workflow-context.md` 或任何 sidecar | 任务约束 | Phase 目录 `ls` = `implementation(.md/-zh)` / `repo-exploration(.md/-zh)` / `review-visual(.md/-zh)` / `spec.md`；`find` 无 `*workflow-context*` / `*sidecar*` | ✅ |

## DEBT-008 收口核对（独立复核，未采信 `implementation.md` 自述）

| 项 | 期望 | 独立实测 | 判定 |
|:---|:---|:---|:--:|
| `design.md:225` = AD-9、`:243` = AD-10 | 改后引用须指向 AD-9 | `grep -n "^### AD-"` → `:225 ### AD-9`（设置项 + 三级链）、`:243 ### AD-10`（文档落点） | ✅ 参照系正确 |
| `(AD-10)` → `(AD-9)` | 两处 JSDoc | `grep -rn "AD-9" apps/vscode-dsh/src/` → 仅 `extension.ts:233`、`extension.ts:2245`；`grep -rn "AD-10" apps/vscode-dsh/src/` → 零命中（exit 1） | ✅ 改对了 |
| 来源句覆盖 `StartHostPort` 层 | `session-host.ts` / `auto-start-orchestrator.ts` | `session-host.ts:49-66`（"…or by the `StartHostPort` wrapping it — the latter is where a wrong-typed Node selection setting (`invalid-setting`) is raised"）、`auto-start-orchestrator.ts:40`（"or the `StartHostPort` wrapping it"） | ✅ 已扩 |
| 仅改 JSDoc，行为不变 | — | 相关 hunk 均为注释；`HostStartErrorKind`（`session-host.ts:67`）仍是 `= StartErrorKind` 别名，成员未增删 | ✅ |
| registry 已移入「已解决」并写明 Phase/日期/验证方式 | — | `tech-debt-registry.md:47`：解决 Phase `phase-2-host-fail-loud-diagnostics`、日期 `2026-09-15`、验证方式含两处 grep 探测与行为面兜底 | ✅ |
| 活跃表只剩 `DEBT-004` / `DEBT-009` | — | `tech-debt-registry.md:26`（DEBT-004）、`:27`（DEBT-009）；`:33` 汇总说明已同步 | ✅ |

## §8 偏差记录评估（逐条）

| 偏离 | 判定 | 理由 |
|:---|:--:|:---|
| 8.1 `connection-ui.ts` 无需改动 | 🟡 **结论合理、前提不实**（SF-5） | 不重构正是 `spec.md:67` 的约束；AC-19/AC-20 的 UI 侧既有实现已满足，且本 Phase 用真实 `ConnectionUiController` + shim 补了证据（`host-diagnostics.spec.ts:517/539/568`）。但"spec 的文件清单把该文件分给 AC-19/20"不成立（`spec.md:79-93` 无该行） |
| 8.2 `packages/sdk/client/src/index.ts` 进入改动集 | ✅ **合理且有必要** | `session-host.ts:10-18` 从包根导入 `DEFAULT_INITIALIZE_TIMEOUT_MS` 与既有类，故该导出是编译必需（该常量本就带 JSDoc 导出于 `launch.ts:12`）；`TransportClosedDetails` 是 `client.ts` 公共错误类型的配套导出（AD-5 结构化字段的可用性前提）。两处均为加性导出，仓库内无 index 导出快照/API 契约比对门禁（`grep` 未发现 api-extractor 类检查），故无下游文档必须同步 |
| 8.3 两个 fixture 新增旋钮 | ✅ **合理** | AC-15/17/18 要求真实子进程行为（不响应 `initialize` / 长 stderr / 自我信号），只有 fixture 能表达；未为可测性改造产品代码，未加依赖（`spec.md:47/:51/:52` 明确要求真机行为而非 mock） |
| 8.4 `interaction-coordinator.ts` 多抽了 `projectEntry` | ✅ **合理** | 公开面逐项比对未变（8 个导出同名同序；`listPending()` 签名未变；`projectEntry` 为 `private`）。AD-13 的约束是"仅改投影内容"，抽方法属投影内部组织方式，未触及审批作答面 |
| 8.5 重试记录由 orchestrator 侧监听器产生 | ✅ **与设计一致** | AD-3 规定"`AutoStartOrchestrator` 只透传已校验的 kind"，扩展侧监听器按 `hostFailureKindForStartError`（`host-diagnostics.ts:227-241`）记录 Host 边界看不到的两类，并以 `${kind}\0${detail}` 去重（`:269-272`）避免一次失败记两条 |
| 8.6 AC-14 两层证据均为真实 spawn | ✅ | 与 `spec.md:47` 的两层取证要求逐条对应 |
| 8.7 扩展层未归类失败的兜底记录 | ✅ **合理且必须有** | 判据为 `instanceof HostStartError` + `lastSeq()` 未前进（`extension.ts:2363-2367`），满足「AC-14 兜底：任何抛错都有记录」且不重复计数；未引入消息解析 |
| 8.8 `.cursor/skills/*` 非本 Phase 产物 | ✅ **已留痕** | 与本 Phase 的 agent 契约（build/test skill 维护义务）一致，且符合 `DEBT-009` 的用户裁定（工具树不入库） |

## 结论

- **与本 Phase 相关的架构决策中，除下条外逐条遵循**；AD-6/7/8/11/15/16 属 Phase 3/4，本 Phase 未越界触碰。
- **阻塞项只有一处**：`kind` 成员词表与被冻结的 v1 契约（`design.md:307` / `design-zh.md:308` / `repo-exploration.md:78,:293`）不一致，且契约用例的期望值取自实现、`implementation.md` §3 的"无类型变更"自陈不实。该项不解决，Phase 3 驱动按设计编写时会在 `schemaVersion === 1` 的精确断言上与产品记录冲突——这正是 AD-14 决策 10/11 要防的漂移。
- 其余 5 条 should-fix（审查码卫生、F-3.3 落点自述、注册处 JSDoc 措辞、SDK 消息面加性变更留痕、§8.1 前提）均为零行为影响，建议随同一轮修复。
- **重跑自清理**：本文件与 `review-design.md` 在本次启动时均不存在（旧产物检查 → `no prior review-design.md`），故 `.archive/` 未产生新条目。

## 参考

- 契约版本策略：`design.md:321-328`（决策 5/9/10/11/12）、`spec.md:42`、`spec.md:63`
- Host 边界分类：`session-host.ts:108-179`、`host-diagnostics.ts:197-241`
- 扩展装配与兜底：`extension.ts:422-453`、`:1100-1108`、`:2283-2379`
