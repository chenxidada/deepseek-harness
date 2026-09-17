# Design Consistency Review — Phase 3（`phase-3-layer-v-smoke-loop`）· **round-2**

| 项 | 值 |
|---|---|
| 视角 | **Design Consistency** —— 实现是否遵循 `design.md`（含 §12 修订记录）、`scope-amendment-01.md` 叠加层、`spec.md`（含修订段 R1）与代码库**既有约定** |
| 本轮性质 | **round-2 复审**（非重跑 round-1）：round-1 报告审理的是「实施者据 MUST-FIX 修复后」的**整个 Phase**，不是只审增量；未涉改动且 round-1 已判 ✅ 的部分在 §E **显式声明沿用** |
| 分支 / 基线 | `impl-phase-3-layer-v-smoke-loop` / `300f492f84`（`git branch --show-current` 复核 ✅；全程**未**执行任何 git 写操作） |
| round-1 报告归档 | `.archive/review-design-round1-20260916T164655Z.md`（本 agent 自己归档；无 `review-design-zh.md`，无需归档） |
| 不在本报告范围 | 实现正确性（reviewer-correctness）、集成连通性（reviewer-connectivity）、界面外观（reviewer-visual = `N/A`，`ui: false`） |
| 未改动任何非报告文件 | 除归档 `mv`/`cp` 自己的报告外，**未**改产品代码 / 脚本 / 测试 / `spec.md` / `scope-amendment-01.md` / `current-status.json` |

---

## 判决

**PASS**

一句话：round-1 的 **2 🔴 + 1 🟡 逐条独立复核为真修复**（🔴-1 → `implementation.md` §6.1 **D9** 登记且事实准确，spec 的自相矛盾由调度者在 `spec.md:151` 就地消解；🔴-2 → 受控构造**真的**产出并断言了 `kind === 'node-environment'` 记录且 `resolvedExecutable` 为绝对路径，未被弱化为「若有则断言」；🟡-1 → 索引回归单块并新增写后自断言）；本轮新增的 **D10–D15 六条登记逐条与代码事实一致**，且 `session-host.ts` / `host-diagnostics.ts` / `interaction-coordinator.ts` / `extension.ts` 四处本轮改动**无未登记的行为变更**；`design.md` AD-14 的授权修订（第三成员 / 版本恒 2 / 字段集仍 18）**实施完整**；`runNodeEnvironmentConstruction()` 与 **AD-15 沙箱不变量相容**（§D）。

判据：无 AC 未满足（§C 逐条），无 design.md 明确决策被违反（§C 的 AD 表），无 `constitution.md` §2 架构约束被违反（§C 末行），无未登记的 spec 不一致实现（§B）。

---

## A. round-1 🔴 独立复核（用户 §A）

### A.1 🔴-1（`dsh.showHostDiagnostics` 与 `spec.md:151` 冲突未登记）

| 核验点 | 独立抽取到的事实 | 判定 |
|---|---|---|
| D9 是否落在 §6.1 | `implementation.md:174`（§6.1 表内，编号 **D9**） | ✅ |
| 冲突事实是否准确 | `spec.md:151` 原允许集 = 白名单 69 条 + `dsh.test.answerApproval` + `dsh.test.getDiagnosticsText`；而 `spec.md:196` 明文要求「驱动断言 `vscode.commands.getCommands()` 含 `dsh.showHostDiagnostics` 且可无异常执行」→ 两条互相矛盾 | ✅ 准确 |
| 「依 `:196` 落地」是否属实 | 驱动源码确实命名并**执行**该命令：`layer-v-driver/extension.cjs:68`（`REQUIRED_COMMANDS`）、`:1009`（注册前提检查）、`:1018-1021`（专用断言 + 执行一次，且把异常收敛为 `[]` 而非抛出） | ✅ |
| 该命令是否为 HEAD 既有只读面 | round-1 已用 `git show 300f492f84:…/extension.ts` 核过（基线已注册）→ 本 Phase **未**新增产品命令面 | ✅（沿用 round-1 实测） |
| 是否改过 spec | 工作区 `spec.md` 的 `:151` 现为「…+ `dsh.showHostDiagnostics`（HEAD 既有的只读诊断面；下文 AC-13 / AC-14 行明文要求驱动断言并执行它，**本行为该处的消解**）」→ **调度者就地消解**，D9 亦写明「本 agent **未**改 spec」 | ✅ |

**结论：round-1 🔴-1 的修复成立。** 按调度者指示，本报告**不再**把 `spec.md:151` 的自相矛盾判为缺陷，也不要求实施者改 spec。

### A.2 🔴-2（`spec.md:196` 要求的 `kind === 'node-environment'` 记录零命中）

驱动新增 `runNodeEnvironmentConstruction()`（`extension.cjs:1929`），置于五步链路**之前**。三项独立核验：

**① 是否真的满足 `:196` 的字面（记录存在 + `kind` 正确 + `resolvedExecutable` 绝对路径）**

| `:196` 子句 | 驱动实现 | 判定 |
|---|---|---|
| 记录**存在** | `:1969-1993` 轮询增量记录（`beforeSeqs` 集合 `:1954` + `fresh` `:1972`），`matching.length === 0` 继续轮询（`:1974-1980`），超时以 `HARNESS_ERROR('node-construction-produced-no-node-environment-record')` 收（`:1982-1993`） | ✅ 「必须存在」，**不是**「若有则断言」 |
| `kind === 'node-environment'` | `:1973` 过滤条件即该 kind；`:2014` 另断言 `phase === 'start'` | ✅ |
| `resolvedExecutable` 为**绝对路径** | `:2010` `typeof !== 'string' \|\| !path.isAbsolute(...)` → `problems` → `:2021-2026` 抛 `harnessError('node-environment-record-assertions-failed')` | ✅ |
| 附带（同为 `:196` 的逐字段口径） | `:2013` `source` 非空、`:2015` `missingApis` 为数组、`:2016-2017` v1 18 字段名齐全、`:2018` 版本分流下的精确计数 | ✅ |

真机证据（`test-artifacts/layer-v/layer-v-status.json`）：`nodeEnvironmentConstruction.construction.path = /home/chendc/.nvm/versions/node/v20.16.0/bin/node`（`kind: default-path-node`、`enginesOk: false`）、`recordsBeforeCount: 0 → recordsAfterCount: 1`、`nodeEnvironmentRecordCount: 1`、`startErrorKind: "node-environment"`、`settingRestoredTo: "/usr/local/n/versions/node/24.3.0/bin/node"`。

**② 是否与 `:196` 的**其它**子句冲突（「`[]` 合法且不对版本断言」）——两个时点是否被正确区分**

`:196` 的括号子句是一个**双时点**规则，而不是自相矛盾：

- **构造前**读取：`spec.md:196`「返回 `[]` 合法且**不对版本断言**」→ 实现 `:1948-1953` 只断 `Array.isArray`（非数组即 `HARNESS_ERROR('diagnostics-not-an-array-before-node-construction')`，理由是「非数组会让『没有 node-environment 记录』不可证伪」），**零版本断言** ✅；
- **构造后**读取：`spec.md` §R1.2 / `implementation.md` §5.2 表「构造后的那次读取为 `[]` → `HARNESS_ERROR`」→ 由 `:1969-1993` 的轮询语义实现 ✅。

两时点被显式区分，未把 `:196` 读成自相矛盾。**结论：**不冲突 ✅**。**

**③ 是否有 AC 语义被暗中改写**

- AC-32（缺凭据）不被误判为构造失败：`:1964-1966`（快照即拒）与 `:1994-2007`（轮询超时后回查 `startState`，再查 `missing-credentials` 记录）两条路径都分流为 `SKIPPED_NO_CREDENTIALS` / 退出码 3（`credentialSkipForConstruction` `:2076-2085`，`stage: 'node-environment-construction'`）。真机 runId `…135657Z`：`failed stage: node-environment-construction — missing-credentials`，结论 `SKIPPED_NO_CREDENTIALS` / 3 → **预期内的跳过，不是把「拿不到记录」洗成跳过** ✅。
- 未准备解释器时不得静默跳过：`:1932-1937` `node-construction-not-prepared` → `HARNESS_ERROR` ✅。
- 记录条数与 R1 的「恰 1 条 post-handshake」互不干扰：构造只看**增量**（`fresh`/`matching`），`postLink` 侧仍按本次运行内恰 1 条判定（真机 `postLink.postHandshakeRecordCount: 1`）✅。

**结论：round-1 🔴-2 的修复成立**，且实现路径正是 round-1 报告给出的选项 (a)（受控的 pre-handshake 预检失败构造）。

---

## B. 登记准确性与完整性（用户 §B：D9–D15）

每条均**从代码抽取事实**再与登记文字对照（不读登记文字下结论）。

| # | 登记声称 | 代码事实 | 判定 |
|---|---|---|---|
| **D9** | 见 §A.1 | 见 §A.1 | ✅ 准确 |
| **D10** | `createStartFailureListener` 为「编排器合成、无 Host 边界记录」的 `process-failed` 快照补写一条 `kind:'other'`；判据 = 高水位未移动 | `host-diagnostics.ts:319-347`：`mark()` 取 `recorder.lastSeq?.()`（`:323`），`attemptMark` 在**进入 listener**（`:324`）与**离开 `failed`**（`:329`）两处采样；`:332-339` `kind !== null` 走既有分支；`:341` 仅 `process-failed` 继续；`:344` `mark() !== attemptMark` 即 `return`（有生产者就**不**补写）；`:346` 写 `{ kind: 'other' }`。文件头 `:300-315` 的注释与登记逐点一致 | ✅ 准确（含「最多一条」的互斥理由） |
| **D11** | `recordTransportDeath` 对两字段由条件展开改为**断言后直取**，并给 `onTransportDeath` 包 `try-catch` | `session-host.ts:842` `const resolved = this.requireNodeExecutable()`（`:1019-1025` 缺失即抛）；`:849-853` 其余字段仍条件展开；`:786-791` `try { recordTransportDeath } catch { errorMessage += ' — host diagnostic invariant violated: …' }` —— 注释 `:782-785` 明写「违例不得阻断 teardown」，与登记「不阻断 teardown」一致 | ✅ 准确 |
| **D12** | `xvfb-run` 优先 + `XAUTHORITY` 透传；wrapper 未给可读凭据则回退自拉 `Xvfb` | 脚本偏好序 `xvfb-run` → 自拉 `Xvfb` → `SKIPPED_NO_DISPLAY`；真机 `env -u DISPLAY` 运行（runId `…134549Z`）结论 **PASS** / 0，`report-meta.display = {mode:"xvfb", value:":102"}` | ✅ 与 `spec.md:158` 的「优先 `xvfb-run`，否则自行拉起」逐字一致 |
| **D13** | `toolCount !== 25` 由 `warnings` 升为 `problems` | 真机 `layer-v-corroboration.json` = `{"problems":[],"warnings":[],"toolCount":25}`；本次值恰 25，故既有 PASS 结论不变 | ✅（与 `spec.md:183`「**预期 25**」的 AC 口径对齐） |
| **D14** | `node` 段新增 `terminalSide` + `nodeCoverage`（两侧各判、无合并结论字段） | shell 把 `terminalSide` 写进 `plan.node` → 驱动 `node: safeJson(plan.node ?? {})` 原样带出；驱动 `assertNodeCoverageSides()` 要求两侧字段同时存在、各带判定、且无合并结论字段。真机 `node.terminalSide = {ok:false, judge:"fail", path:"/home/chendc/.nvm/versions/node/v20.16.0/bin/node", version:"20.16.0", qualified:false, threshold:"AC-4 …", missing:[…], measuredAs:"command -v node in the inherited PATH, before this script prepends its candidate directory"}`；`nodeCoverage.mergedVerdictFields: []` | ✅ 准确；`judge:"fail"` 与整轮 `PASS` 不矛盾的理由（前者量「默认 PATH 的 node」，后者是脚本前置候选目录后的链路结果）与 `spec.md:176` 的 AC-11 口径一致 |
| **D15** | AC-32 的构造事实更正：必须让**扩展宿主 env** 无凭据变量，仅切 cwd 无效 | 真机两条运行互证：仅 `cd /tmp` → `PASS`（runId `…134751Z`，证明「仅切 cwd 不足」）；`env -u DEEPSEEK_API_KEY -u FEISHU_PROJECT_MCP_TOKEN` → `SKIPPED_NO_CREDENTIALS` / 3（runId `…134855Z`） | ✅ 准确（自我更正，非产品缺陷） |

### B.1 反向核对：登记了但代码并未如此？—— **未发现**

- `D5` 落点复核：`extension.ts:1228-1233` 确为 `await host?.injectRuntimeDeath()`（`dsh.test.injectDisconnect`），注释明写「The FSM is not poked directly …」→ 与 D5 描述一致。
- `D6` / `D7` / `D8` 与 round-1 核验一致，且 D6 已按 round-1 要求**拆开**表述（不再把 D10 的真实行为变更并进 D6 的「零行为变更」说法）。
- §3 第 3 点措辞已从 round-1 的相反表述更正（`implementation.md:104`：合成侧**不写**记录、由既有消费者 `createStartFailureListener` 补写）→ 与代码一致。

### B.2 未登记项扫描：本轮改动面是否**逐条**有登记

| 改动面（用户点名 + 我从 §1/§4 抽取） | 登记/出处 |
|---|---|
| `session-host.ts`：`nodeExecutable` 保留、`recordTransportDeath`、`requireNodeExecutable`、`onTransportDeath` try-catch、`injectRuntimeDeath` | §3 `DEBT-010` + **D11** + **D5** |
| `host-diagnostics.ts`：第三成员 `'post-handshake'`、`HOST_DIAGNOSTIC_SCHEMA_VERSION 1→2`、`HostDiagnosticInput.phase?` 可选、`lastSeq?()` 契约（D6）、`createStartFailureListener` 补写（**D10**） | `scope-amendment-01.md` §2 授权 + §3 + D6 + **D10** |
| `extension.ts`：`dsh.test.answerApproval` 注册（`:1108-1113`，在 `shouldRegisterTestHooks` 门内）、`injectDisconnect` 改真实死亡边（`:1228-1233`） | §1.1 + **D5**（`answerApproval` 由 `spec.md:183`/AD-12 明文要求，无偏差可登） |
| `interaction-coordinator.ts`：`resolveApproval` + `ApprovalRefusalReason` / `ApprovalResolution` | §1.1（AD-12 明文交付面，非偏差） |
| 驱动：`runNodeEnvironmentConstruction`、`credentialSkipForConstruction`、`assertNodeCoverageSides`、`V1_RECORD_FIELDS`、写前快照/写后自断言 | **§4**（专章，含 5 步 + 4 条硬约束逐条 + 真机证据）+ **D14** |
| 脚本：`measure_terminal_side` / `assert_terminal_side_evidence` / `prepare_unqualified_node` / `start_xvfb`（偏好序 + 凭据透传）/ `toolCount`→`problems` / 索引锚 + 写后自断言 | §0 对照表（🔴-1 / 🟡-1 / 🟡-2 / 🟡-3 行）+ **D12** + **D13** + **D14** |
| `.specdev/…/artifact-index.md`：散文前置 + `:9` 措辞改 splice | §0 🟡-1 行 |
| `pnpm-lock.yaml`（`7+/4-`） | **D8**（调度者已裁定不纳入提交） |

**结论**：仅两类事项未以「§6 台账条目」形式登记，但都在**他处显式落盘**且**不属「与 spec 不一致的实现」**（故未触发 `constitution.md` §6.2）→ 计入 §F 的 🟢-1 / 🟢-2，**不参与判决**。

---

## C. 逐条对照：依据 → 实现 → 偏差（用户 §C）

### C.1 AC 与授权文件（含本轮改动）

| 依据（可指认原文） | 实现 | 偏差 |
|---|---|---|
| `spec.md:176`（AC-11(a)：**终端侧**给出默认 `node` 绝对路径 / 版本 / 是否过门槛 / 需执行的动作 / 文档锚点；断言两侧**各自**判定且**不得**有合并结论字段） | `node.terminalSide`（真机见 §B D14 行，含 `action` 与 `docsAnchor`）+ 驱动 `assertNodeCoverageSides()`；`docsAnchor` 指向 `docs/development.md#node-environment`，该锚点可解析（`docs/development.md:103` `### Node environment`，且 `:11` 已用同锚引用） | 无 |
| `spec.md:176`（AC-11(b)：**必须**取诊断记录的 `resolvedExecutable` / `source`） | 真机 `node.extensionSubprocessSide` 的 `source: "vscode-setting"`、`resolvedExecutable` = 24.3.0 绝对路径、`schemaVersion: 2`（观测版本已落盘） | 无 |
| `spec.md:177`（AC-12：脚本前置 `PATH` 后使用自解析的合格 Node） | 未改 PATH 前置逻辑；`node.path` 落在脚本候选目录，且 `DSH_NODE_BIN` 清除证据在真机 `node.…{unsetPerformed:true, printenvAfterUnset:"", assertion:"printenv DSH_NODE_BIN returned empty"}`（对应 `spec.md:195` 的 AC-10 补充证据面） | 无 |
| `spec.md:196`（AC-13 / AC-14：JSON 契约 + 版本分流 + **存在** `node-environment` 记录） | 见 §A.2（三点全部满足）；版本分流三口径 = 驱动 `:2016-2019` 与 `:2218-2236`（`=== 1` 精确 18 / `> 1` 只断 v1 子集且观测版本落盘 / 非整数或 `< 1` → `HARNESS_ERROR`）——与 `spec.md:196` 逐字一致，属 **spec 明文要求**，非「强度不足」 | 无 |
| `spec.md:151` + `:183` + `:185`（AC-25：允许命令集 / step4 工具面 `toolCount = 25` / 命令面静态检查） | 驱动 `REQUIRED_COMMANDS`（`extension.cjs:64-69`）含 `dsh.test.answerApproval`、`dsh.test.getDiagnosticsText`、`dsh.showHostDiagnostics`（已由调度者补入 `:151`）；`toolCount` 现为 `problems`（**D13**）；无 `dsh.test.openHistory`、无 `xdotool`（round-1 实测，本轮复核 `REQUIRED_COMMANDS` 与白名单一致） | 无 |
| `spec.md:158`（AC-28：优先 `xvfb-run`，否则自拉 `Xvfb`） | **D12** + 真机 xvfb 分支 PASS | 无 |
| `spec.md:160-161` + `:167-170`（AC-32 / 结论分类契约三类不得互换） | 缺凭据 → 构造期分流为 `SKIPPED_NO_CREDENTIALS` / 3（**D15**、§4）；AC-27(b) 负向运行仍 `LINK_FAILURE` / 1（runId `…135618Z`） | 无 |
| `spec.md:194`（AC-33(b)：索引每次运行追加一行且内容与实际产物一致） | `artifact-index.md` 现为**单块**表（`:25-68`：1 表头 + 1 分隔 + 42 数据行，最新 = `…135753Z` 的 PASS 行）；写入器锚 = **首个连续表格块的末尾**（脚本 `:2631-2645`），并在写后**自断言**行出现恰 1 次、落在首个表格块内、其前恰 1 个 `run (UTC)` 表头（`:2651-2675`，问题经 `:2684-2698` 显式报出） | 无（细节见 🟢-3） |
| `scope-amendment-01.md` §1.3 / §2（两项用户裁定：第三成员、版本恒 2、字段集仍 18） | 见 §E 的沿用项 + 本节 AD-14 行 | 无 |
| `scope-amendment-01.md:70`（R1.4：不得把 `node-environment` 记录改写为「`[]` 合法」以规避） | 实现**未**规避，改为受控构造（§A.2） | 无（方向正确） |

### C.2 架构决策对照（本轮有落点的部分）

| 决策 | 本轮落点 | 遵循 | 证据 |
|---|---|:--:|---|
| **AD-14**（含 §12「修订 01」叠加层：`phase` 增第三成员、`schemaVersion` 恒 2、字段集仍 18） | 第三成员 `'post-handshake'`（`host-diagnostics.ts:70` 类型 + `:410` 由 `input.phase === 'post-handshake'` 显式决定 + `:413` `retryOfSeq: null` + `:430` `chainStartSeq ??= record.seq`）；版本唯一真相源 = `:26` 常量 `2`，使用点仅 `:407`（测试以常量为准：`tests/host-diagnostics.spec.ts:141/183` 对字面量 `2` 断言；驱动从**记录自身**读版本，属消费侧）；字段集仍恰 18（`:406-427` 18 个键；测试 `:135-136` 断言键集合**等于** 18 字段表） | ✅ | 第三成员语义 = 「握手**已成功**（`status === 'connected'`）之后的运行期死亡」——`session-host.ts:777-778` 在**任何 await 之前**同步读 `status`，`afterHandshake` 只在 connected 时为真，故语义精确覆盖「握手之后」，未混入「失败种类」轴（种类仍由 `kind` 承担，词表未动） |
| **AD-13 / AD-3**（Host 边界说话；无生产者即无记录） | 记录边仍落在 `IdeSessionHost`（`recordTransportDeath`）；**D10** 的补写发生在**既有消费者**中，且以「高水位未移动（= 无生产者）」为**前置**才写 | ✅ | `host-diagnostics.ts:341-346`；合成侧（`auto-start-orchestrator.ts`）仍不写记录 → 未新增第二条无生产者通道 |
| **AD-15**（route A：`HOME` 沙箱 + 影子 preset + 零仓库改动） | 影子 preset 生成器仍**单一实现**，`--check-shadow-preset` 自检 `diff = 28,29d27`（**2 删除 0 新增**）、两次 sha256 相同（`implementation.md` §7.1，与 round-1 逐字一致）；本 Phase 新增的运行时构造见 §D | ✅ | 同上 + §D |
| **AD-9 / AD-11**（设置项 + `PATH` 前置 + 显式清除继承 `DSH_NODE_BIN`） | 未改解析链；三条仍落实（清除证据见 C.1 的 AC-12 行） | ✅ | 真机 `node.…printenvAfterUnset: ""` |
| **AD-16**（生命周期约束：干净沙箱 / `replay` 判失败 / 不 `await newConversation`） | 未改；真机 `cleanStateChecks` 段存在且本次运行 `conclusion: "PASS"` / `failedStep: null` | ✅ | `layer-v-status.json:66-67, 1312+` |
| **AD-6**（纯 CJS 驱动 / 双 `--extensionDevelopmentPath` / 最小 flag 集） | 驱动仍 `.cjs`、零依赖、无 `bin`；未新增 flag | ✅ | `layer-v-driver/package.json`（round-1 实测，未变） |
| **AD-12**（`answerApproval` + 两步式 + 120s 作答窗口） | `extension.ts:1108-1113` 注册并委托 `interactions.resolveApproval(id, outcome)`（词表由 coordinator 拥有）；驱动 `approvalMs` 180s / `answerMs` 120s 未变 | ✅ | 同上（round-1 §3.5 实测，未变） |
| **constitution §2**（架构硬约束：单职责 / 无环 / 依赖方向） | `session-host.ts` 不反向依赖 `extension.ts`；扩展侧只经 `HostFailureRecorder` 接口读记录；驱动只经 `vscode.commands` 与 VS Code 配置 API 与产品交互 | ✅ | 见 §D 末段 |

### C.3 与代码库既有约定的一致性

| 检查项 | 实测 | 判定 |
|---|---|:--:|
| 类型成员命名 | `'post-handshake'`（kebab-case 字符串联合，与 `'start' \| 'retry'` 同形） | ✅ |
| 函数命名 | `requireNodeExecutable` / `recordTransportDeath` / `prepare_unqualified_node` / `measure_terminal_side`（TS camelCase、shell snake_case，各自与同文件既有同形） | ✅ |
| 注释策略 | 新增注释均为 **why**（如 `session-host.ts:782-785`「违例不得阻断 teardown」、`host-diagnostics.ts:300-315`「为何要区分有无生产者」、`extension.cjs:2611-2618`「为何要锚在表格块末尾且写后自证」、`extension.cjs:2046-2049`「为何还原失败要优先抛出」）；无 CoT 残留（仅引用 `DEBT-010` / `R1.3` / `AD-14` / AC 编号等**已冻结**标识） | ✅ |
| 单一真相源 | `HOST_DIAGNOSTIC_SCHEMA_VERSION` 全 `src/` 唯一赋值为 `:26`，使用点仅 `:407`；驱动不硬编码期望版本，读记录自身 | ✅ |
| 记录字段数不变式 | 产品侧：`:406-427` 恰 18 键 + 测试 `:135-136` 键集合相等断言；驱动侧：v1 精确计数 + 任意版本的 v1 子集齐全（= `spec.md:196` 的分流口径） | ✅ |

---

## D. 重点判断题：`runNodeEnvironmentConstruction()` 与 AD-15 沙箱不变量

**结论（一句话）：相容** —— 该构造改的是**运行中 EDH（沙箱 profile）内**的用户级设置 `dsh.nodeBin`，不是宿主真实 profile，且还原**经 re-read 校验后**才允许本轮继续，未触犯 AD-15 的「零仓库改动 / 沙箱隔离」，也未越过「驱动职责」的边界。

**证据链**

1. **改的是哪个键 / 写到哪**：`extension.cjs:1944-1946` 用 `vscode.workspace.getConfiguration(section)` + `ConfigurationTarget.Global`（`section='dsh'`、`key='nodeBin'`，不重复加前缀），`:1959` `configuration.update(key, construction.path, target)`。`Global` 的落点是**当前扩展宿主的 user-data-dir**，即本轮的 `mktemp` 沙箱（真机 `defaults.userDataDir = /tmp/dsh-layer-v-<rand>/user-data`）——正是 AD-11 要求 shell 预置**同一个键**的**同一个文件**；HOME 亦在沙箱内（route A）。命令注释 `:1942-1943` 也写明「与产品读取的是同一 section/key」。
2. **是否污染宿主**：真机 `~/.config/Code/User/settings.json` 内 **无任何 `dsh` 键**（本地只读核查）；`~/.dsh` 的既有「摘要不变」断言未变；仓库侧唯一运行时写入面仍是 `test-artifacts/`（git-ignored）→ **零宿主污染**。
3. **还原是否可靠**：`finally` 必走 `restoreNodeBinSetting`（`:2044-2045`），其实现先 `update` 再 **re-read 比对**（`:2097-2100` `configuration.get(key) !== original` → 返回 problem），problem 非空即从 `finally` **抛出** `harnessError('node-construction-setting-not-restored')`（`:2050-2054`），注释给出理由（错设置会让后续每次 start 以**另一原因**失败、甚至把凭据跳过洗成链路失败）→ 由于 `finally` 抛出会丢弃成功结果，**任何带 `settingRestoredTo` 的 PASS 状态都蕴含还原已被验证**。真机 `settingRestoredTo = "/usr/local/n/versions/node/24.3.0/bin/node"`（合格 Node）。
4. **是否应视为驱动职责（`dsh.test.*` 面）**：属**驱动职责**。它只使用两个既有公开面 —— (i) 允许集内的命令 `dsh.test.requestStart`（`spec.md:146` 白名单）；(ii) VS Code 配置 API（`spec.md:116` 的约束对象是「**命令**」，配置 API 不在命令面内）。而 `dsh.nodeBin` 本就是 AD-9/AD-11 规定由**壳**预置的用户级设置；壳无法在运行中改它、产品又在每次 `start()` **现读**（`extension.ts:2352`），因此这是「壳预置、驱动断言」分工在**运行期**的必然延伸，而非产品面越界。它位于驱动扩展内（`shouldRegisterTestHooks` 之外的驱动自有代码），不进入产品构建。
5. **是否扰动其它不变量**：真机显示构造只消耗一次**手工**尝试（`startSnapshot.lastReason: "manual-retry"`），且构造前后 `autoRetryUsed: false`（`layer-v-status.json:1430/1438`）→ **未吃掉** AC-6a 的自动重试预算（链路的断线重试处才为 `true`，见 `:1269/:1309`）；`cleanStateChecks` 段存在、整轮 `failedStep: null`；构造只回写诊断记录（增量读取），不产生会话/存储。

**若判为架构层面不妥，我会给的替代方案（本轮不适用）**：① **不构造**，改按 `scope-amendment-01.md:70`（R1.4）走「结构不可得」升级，请用户裁定 AC-13/AC-14 口径变更 —— 会给用户增加一次口径决策，并放弃 `spec.md:196` 的既有子句；② 由**壳**在启动前预置不合格值并单独拉起一次 EDH —— 成本是一轮完整宿主启动，且与「宿主无合格 Node 即 `HARNESS_ERROR`」（`spec.md:161`）的前置判定互相纠缠，更难证明「失败来自设置项而非宿主环境」。两者都比现值更贵或更弱，故**维持现值**，仅建议补一条台账（🟢-1）。

---

## E. round-1 结论的**沿用声明**（不静默略过）

| round-1 章节 | 本轮处置 | 理由 |
|---|---|---|
| §1 授权边界表（7 项） | **沿用 ✅** | 本轮未改授权面；`scope-amendment-01.md` 一字未动 |
| §2.1 版本唯一真相源 | **本轮重核 ✅** | 用户点名项：`src/` 唯一字面量 `:26`、使用点 `:407`、测试对字面量 `2` 断言、驱动为消费侧 |
| §2.2 AD-14 决策 10 三口径 | **本轮重核 ✅** | 驱动行号漂移（现 `:2016-2019` / `:2218-2236`），语义逐条未变（且与 `spec.md:196` 明文一致） |
| §2.3 第三成员语义 / 命名 / 消费方 | **本轮重核 ✅** | 用户点名项：语义覆盖「握手之后」（§C.2 AD-14 行）、命名与既有同形、无按 `phase` 分支的消费方（round-1 已 rg 全 `src/`，本轮改动未新增消费方） |
| §2.4 记录边是否遗漏 | **本轮重核 ✅** | 用户点名项：写记录点仍为 4 处（`host-diagnostics.ts:338/346`、`session-host.ts:459` 与 `:831`、`extension.ts:2385` 带守卫），每处都有明确 `phase`；D10 覆盖「握手响应已达但 `status` 尚为 `starting`」这一竞态 → 无遗漏记录边 |
| §2.5 R1 实测非推断 | **沿用 ✅** | 本轮未改落点链；真机 `postLink` 证据仍在 |
| §3.1–§3.5（D5/D6/D7 立场、驱动组织、AD-12 常量） | **沿用 ✅** | 本轮未改这些面（D5 落点本轮复核一致） |
| §4 文档保真（README 四节 / 双语配对） | **沿用 ✅** | 本轮未触碰文档面（`implementation.md` §7.6 同结论） |
| §5 `.gitignore` 规则 | **沿用 ✅** | 未变 |
| §6 注释与文档策略 | **沿用 ✅**（抽样复核见 §C.3） | 本轮新增注释同样 why-only |
| §7 AD-1..AD-16 全表 | **沿用 ✅**（本轮有落点的条目重核见 §C.2） | 其余条目本轮无改动 |
| §8 模块 / 命名 / 结构 | **沿用 ✅**（新符号命名见 §C.3） | 未新增文件 |
| §10 验证动作 | 部分沿用；本轮新动作见 §G | — |
| round-1 🟡-1 / 🟢-1 / 🟢-2 | 🟡-1 **已修**（§C.1 AC-33 行）；🟢-1 **已修**（`implementation.md` 不再引用不存在的 `r1.postHandshakeRecords`）；🟢-2 **未修**（见 §F 🟢-4） | — |

---

## F. 🟢 Observations（含 `[文档保真]`）

**🟢-1 · 受控构造（驱动改产品设置 + 额外一次启动）未以 §6 台账条目形式登记**（`implementation.md` §4 已完整落盘）
- 事实：`dsh.nodeBin` 的写入 + `dsh.test.requestStart('manual-retry')` 的额外一次启动，只在 §4 的「为什么必须构造 / 5 步 / 4 条硬约束 / AC-32 交互」中记载，未进 §6.2 台账（D9–D15 均不覆盖它）。
- 为何**不**计为 🟡：它不是「与 spec 不一致的实现」（`spec.md:196` 要求该记录，未规定产出方式），故未触发 `constitution.md` §6.2；且 §0（🔴-3 行）与 §4 已给出可追溯的落点与证据。
- 建议（非阻塞）：补一条 D16，写明「构造改 `dsh.nodeBin`（沙箱 profile 内 `ConfigurationTarget.Global`）+ 额外一次手工启动；`finally` 还原并 re-read 校验」——与本 Phase 已有的严格留痕风格一致。

**🟢-2 · `workbench.action.quit` 不属 `dsh.*` 命令面枚举，但建议留痕**
- 事实：驱动源码（header 注释）自述使用两个非 `dsh` 命令：`workbench.action.acceptSelectedQuickOpenItem`（`spec.md:201`/AD-12 明文要求作为对照探针，属 spec 授权）与 `workbench.action.quit`（用于让宿主干净退出；`spec.md` 未点名）。
- 为何**不**判为 🔴/🟡：`spec.md:24` 的白名单标题本身即限定为 `dsh.*` / `dsh.test.*`（「运行时枚举到的命令白名单（`dsh.*` / `dsh.test.*`，69 条）」），而 `spec.md:185` 的静态检查针对「白名单内的命令字面量 + 不出现 `dsh.test.openHistory` + 无 UI 自动化」；同一份 spec 又在 AD-12 处**要求**驱动使用一个 `workbench.*` 命令 → 该枚举的射程是产品命令面，`workbench.*` 不在其内。故不构成 `:151` 意义上的「白名单外命令」。
- 建议（非阻塞）：在台账或驱动 header 里各留一行，便于后续读者不必重新论证。

**🟢-3 · 索引写入失败经 `note` 报出，不改变结论（AC-33(b) 的强度口径）**
- 事实：`emit_report_files()` 在索引缺失/写不进去/行没落进首个表格块时执行 `note …; return 0`（脚本 `:2679-2698`）；`note()`（`:168`）只把文本推进 `NOTES` 并打印，最终写入 report-meta 的 `notes`（`:2574`）——**不参与** `problems`/结论判定。
- 为何**不**判为 🟡/🔴：① `spec.md:194` 的 AC-33(b) **没有**「不得降级为提示」这一类条款（对比 `spec.md:195` 的 AC-10 明文写了「不得降级为提示」）② 本轮已把「静默」修掉（问题文本 + stderr + 写后自证三项同时存在）③ 影响面限于索引可读性，不影响链路证据。**但**若调度者想与 **D13**（`toolCount` 升 `problems`）保持同一强度口径，可将其一并升为 `problems`。

**🟢-4 `[文档保真]` · `implementation.md:115` 仍引用改动前的行号**
- 该行引用 `onStartSucceeded()`（`host-diagnostics.ts:341-343`）与 `records()`（`:385-387`）；**当前实际为 `:394-396` 与 `:443-445`**（两处我已读原文）。
- 底层主张为真：`onStartSucceeded()` 只做 `this.chainStartSeq = null`（不写记录）、`records()` 返回 `this.store` 的副本 → 「成功启动 + `getDiagnosticsText` 必为 `[]`」的推论成立。
- 对交付物零影响 → **不计入判决**。附注：这是 round-1 🟢-2 的**未修正残留**（连续两轮）；同文件其余引用（如 §3 的 `:404`、§4 的 `:1929`、§6.2 的 `:323-346`/`:787`/`:842`/`:1019`）本轮抽核均与代码一致。

**🟢-5 · 驱动状态文档自身 `schemaVersion: 1` 与记录的 `schemaVersion: 2` 同文档同名**
- `extension.cjs:2306` 的 `schemaVersion: 1` 描述的是 `layer-v-status.json` **自身**的形状，与 `HostDiagnosticRecord` 的版本是两个契约；观测到的后者已按决策 10 记入同一文档（`node.extensionSubprocessSide.schemaVersion = 2`、`postLink.record.schemaVersion = 2`）。
- 壳侧从不读它（`run-layer-v-smoke.sh` 内 `schemaVersion` **零命中**）→ 不是「第二处版本真相源」，只是同一文档内同名不同义的**误读风险**；建议将来加一行注释区分。

---

## G. 实际验证动作（只读：读了什么、看到什么）

**读（原文）**：`implementation.md`（§0 对照表、§1、§3、§4、§5、§6.1/6.2/6.3、§7）；`spec.md`（`:116`、`:140-170` 白名单/跳过表/分类契约、`:174-197` 验证策略含 `:176`/`:183`/`:185`/`:194`/`:195`/`:196`、`:201`、`:211`）；`artifact-index.md`（全文 68 行）；`docs/development.md`（`:11`、`:103`）；`review-design.md`（round-1，全文）；`.archive/implementation-round1-…md`（§6 台账 D1–D8）；`review-correctness.md`（片段）；`tech-debt-registry.md`（片段）；`host-diagnostics.ts`（`:26`、`:300-348`、`:390-449` 原文）；`session-host.ts`（`:775-854`、`:1007-1031` 原文）；`extension.ts`（`:1102-1113`、`:1226-1234`）；`host-diagnostics.spec.ts`（`:110-190`）；`extension.cjs`（`:41-100`、`:1929-2102`、`:2209-2268`、`:2296-2313`、`:2577-2702`）；`run-layer-v-smoke.sh`（`:87-100`、`:161-177`、`:2577-2740`）；真机产物 `layer-v-status.json`（`:66-67`、`:108-114`、`:1183-1204`、`:1269-1310`、`:1312+`、`:1385-1459`）。

**跑过的只读核查**：
1. `HOST_DIAGNOSTIC_SCHEMA_VERSION|schemaVersion` 全 `apps/vscode-dsh` → `src/` 唯一赋值为 `:26`、使用点 `:407`；驱动侧 4 处（含其**自身**状态文档的 `:2306/:2460` 与 v1 分流 `:2018/:2223`）→ 版本单一真相源成立。
2. 驱动 `missingFields|V1_RECORD_FIELDS` → 确认「任意版本断 v1 子集齐全（`:2016`/`:2218`）+ 仅 v1 断精确 18（`:2018`/`:2223`）」，与 `spec.md:196` 的分流口径逐字对应。
3. 驱动 `recordTransportDeath|requireNodeExecutable` → `:833-854` 断言后直取 + `:786-791` try-catch；`requireNodeExecutable` `:1019-1025`。
4. `host-diagnostics.ts` 的 `onStartSucceeded()|records()` → 实际 `:394` / `:443`（用于 §F 🟢-4）。
5. `implementation.md` 的 `r1.postHandshakeRecords|341-343|385-387` → 前者**已不存在**（round-1 🟢-1 已修）、后者仍在（🟢-4）。
6. 脚本 `schemaVersion` → **零命中**（用于 🟢-5）。
7. `NOTES[@]` → `note()` 语义为「记录 + 打印」，最终进 report-meta（用于 🟢-3）。
8. 真机只读核查：`~/.config/Code/User/settings.json` 内 `dsh` **零命中**（用于 §D 的「零宿主污染」）。
9. 归档：`cp -p` round-1 报告到 `.archive/review-design-round1-20260916T164655Z.md`（保留原文；**未**删除、**未**使用 git、**未**改状态文件）。

**未能验证 / 边界**：
- **不做**（视角边界）：驱动各断言在真机的**行为正确性**（reviewer-correctness）；记录从 Host 到 `dsh.test.getDiagnosticsText` 的**端到端可达性**（reviewer-connectivity）；界面外观（`N/A`）。
- **未复跑**：本轮**未**运行构建 / 测试 / 冒烟（只读审查）——§7 的运行结论、8 次运行的 clean-state 通过情况、`pnpm-lock.yaml` 的 `7+/4-` 均由 `implementation.md` 自述，我没有独立复现（独立复现属 `verifier`）。我独立读的是**已落盘的真机产物**与**源码**。
- **只核了两条异常分流**：构造期的「缺凭据 → SKIPPED」与「未准备解释器 → HARNESS_ERROR」；其余组合（无 Xvfb、索引不可写、宿主早退等）未构造，未验证其分类是否都正确。
- **不可证的历史**：我只能证明「当前真实 profile 无 `dsh` 键 + 写入目标是沙箱 profile + 还原经 re-read 校验」，**不能**证明该文件历史上从未被写过（无审计轨迹）。
- **沿用不自证**：§E 的「沿用 ✅」表示本轮未复跑 round-1 的对应实测动作（仅在涉及本轮改动的条目上重核并标注），其证据效力仍以 round-1 报告为准。
