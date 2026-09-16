# 实现正确性审查 — Phase 2（第 2 轮，回炉后重审）

工作流：`vscode-dsh-usable-loop`
Phase：`phase-2-host-fail-loud-diagnostics`
分支：`impl-phase-2-host-fail-loud-diagnostics`
审查者：`reviewer-correctness`（仅实现正确性视角）

## 视角

**Implementation Correctness** — 代码是否真的工作？

范围：对第 1 轮修复集（2 项阻塞 + 12 项 SHOULD-FIX + 1 项严重度裁定）在**当前工作区**上重新独立复核，并对 AC-13 – AC-22 逐条重走函数体。不复述、不采信 `implementation.md` 的自述。

启动自清理：**直接路径上无前一份报告** —— 第 1 轮的 `review-correctness.md` / `review-correctness-zh.md` 早已在 `.archive/`（`review-correctness-20260915T163340Z.md`、`-zh`）。本次未归档任何文件，也未触碰本 Phase 两份自身产物之外的任何路径。

## 判决：SHOULD-FIX

判决依据，明写以免被误读为「回炉失败」：

- **第 1 轮两项阻塞均已解决并经独立确认** —— `MF-1`（词表收窄回冻结的 7 个成员）与 `C-1`（含 pre-Host 拒绝在内的任何失败态重试都产出成对记录）。既读代码，也由我施加并回滚的两处突变证实（见 §4.6–§4.7）：两处修复都是「承重的」，撤掉修复后对应用例立刻变红。
- **12 / 12 项 SHOULD-FIX 全部解决** —— §1 逐条核实。
- **C-2 的裁定被如实执行** —— 按握手前读法取证（含 `exitCode === 0` 实例）、取舍写入 `implementation.md` §8.12、残余缺口登记为 `DEBT-010`。
- **零新增失败**：测试失败集合与 Phase 基线逐条相同、typecheck 全绿、lint 无任何新触发规则。
- 未判 PASS 的原因：仍有两项**非行为性、文档保真**类发现未闭合（§5 🟡-1 / 🟡-2）。本 Phase 第 1 轮自身就把文档保真（SF-4 / SF-6 / SF-7 / SF-8）计为 SHOULD-FIX，若在此把它们降为「观察项」会与本 Phase 已适用的标准不一致。两项均不阻塞：代码可工作、每条 AC 成立、无未登记桩。

## 1. 第 1 轮修复集 —— 独立复核

### 1.1 阻塞项

| # | 条目 | 判定 | 独立证据 |
|---|------|:--:|------|
| MF-1 | `kind` 词表收窄回冻结的 7 个成员 | ✅ 已解决 | `HostFailureKind` 恰为 7 个成员（`host-diagnostics.ts:44-51`）。三张 `Record<HostFailureKind, …>` 表各 7 键且无多余：`FAILURE_DETAILS`（`:182-190`）、`FAILURE_HINTS`（`:193-201`）、`START_ERROR_KIND_BY_FAILURE`（`:209-217`）。`invalid-setting` **只**出现在 JSDoc（`:40`、`:235-240`，以及 `session-host.ts:55-58`、`auto-start-orchestrator.ts:43`）、一条**显式** `case 'invalid-setting': return null`（`:249-250`）与测试中。`design.md` / `design-zh.md` **未被改动**（`git status -s` 二者均无输出）。契约完整性用例的期望取自按设计清单独立转写的字面表（`host-diagnostics.spec.ts:45-91`，`含 :60-63 关于为何不含 `invalid-setting` 的说明），并与**产出记录**的键集合比对（`:136`），不取自实现类型；反向断言显式存在（`:439-450` `expect(kind?.enum).not.toContain('invalid-setting')`），null 分支直接断言（`:458`）。 |
| C-1 | pre-Host 拒绝后的重试必须产出成对记录 | ✅ 已解决 | guard 在**任何**离开 `failed` 的转移上重新武装（`host-diagnostics.ts:283-286`：`if (snapshot.state !== 'failed') { recorded = undefined; return }`）。两个方向均已验证：(a) 成对性经真实扩展接线断言于 `host-diagnostics.spec.ts:1117-1142`（`phase === 'retry'`、`retryOfSeq === paired[0].seq`、`seq` 严格递增），另有 `:597` / `:616`；(b) 同一次尝试内 orchestrator 以**同一份** snapshot 通知两次（`auto-start-orchestrator.ts:241` 与 `:249` —— reason 写入与 `finally` 写入），签名 guard（`host-diagnostics.ts:289-292`）抑制重复，故一次尝试只记一条。该判别力由我在突变下独立复跑（§4.6）：把 guard 回退到第 0 轮的 `state === 'started'` 语义，恰好 3 条用例变红，而同一次尝试内的去重用例保持**绿色**。 |

### 1.2 12 项 SHOULD-FIX

| # | 第 1 轮条目 | 判定 | 证据 |
|---|---|:--:|---|
| SF-1 / SF-2 | 契约完整性必须是**单个**用例 | ✅ | 单个 `it` 同时断言 (a) 字段集、(b) 逐字段形状、(c) 版本来源、(d) 无文本渲染字段：`host-diagnostics.spec.ts:122-160` |
| SF-3 | 测试名/注释中的 `F-3.x` 审查条目码须清除 | ✅ | `grep -rnE '\((S[0-9]+\|M[0-9]+\|C-[0-9]+)\|F-3\|SF-[0-9]' apps/vscode-dsh/tests packages/sdk/client/tests` → 零命中；`AD-*` 保留（`host-diagnostics.spec.ts` 内 18 处） |
| SF-4 / SF-5 | `resolvedExecutable` 的「绝对路径」限制须**写明**且两个方向都钉住 | ✅ | 限制写在记录字段上（`host-diagnostics.ts:75-80`），并在输入侧镜像（`:114-118`）；两个方向均有断言（`host-diagnostics.spec.ts:284` 为 `process-exec-path`、`:300` 为调用方传入的设置值原样透传） |
| SF-6 | 注册处 JSDoc 须写明返回记录、不返回文本（AD-14 决策 2 / `spec.md:70`） | ✅ | `extension.ts:1100-1105`：名字为历史沿用，且「this returns the `HostDiagnosticRecord[]` array and never text」 |
| SF-7 | SDK 的 `termination signal:` 前缀超出冻结前缀集，须在 §8 留痕 | ✅ | `implementation.md` §8.11，并给出补充理由（旧 guard 对信号终止的子进程会打印 `exit code: null`）与代价 |
| SF-8 | §8.1 前提须按实际重写 | ✅ | `implementation.md:202` 以核实后的事实替换第 0 轮主张（产出清单从未含 `connection-ui.ts`；该投影本就存在） |
| SF-9 | 「stderr 少于 20 行按实际行数记录」须有断言 | ✅ | `session-host.spec.ts:362`：`expect(codeRecord.stderrTail).toEqual(['DSH-FAKE-STDERR-1'])` —— 不向 AC-17 下限补行（`spec.md:51` 只对 25 行的尾部要求 `>= 20`，该断言在 `:320-343`） |
| SF-10 | AC-18 的 `exitCode === 0` 实例须可达 | ✅ | fixture 现按原样透传该 knob（含 `0`，`tests/fixtures/fake-sdk-runtime.mjs:249-259`）；该实例有断言（`session-host.spec.ts:366-378`，`exitCode: 0, terminationSignal: null`） |
| SF-11 | 握手后死亡不产记录 —— 该取舍须留痕 | ✅ | `implementation.md` §8.12（裁定 + 代价 + 为何加一个 `phase` 成员会连带 `schemaVersion` 升级），另在注册表登记 `DEBT-010`（`tech-debt-registry.md:28`） |
| SF-12 | 排队/合并重试路径须纳入 AC-22 验证面 | ✅ | 由 `host-diagnostics.spec.ts:616` 覆盖 —— 且具备判别力：突变下该用例变红（§4.6） |

### 1.3 被裁定的 C-2（`spec.md:61`，握手后退出）

调度者裁定（`review.md`「严重度裁定」：取证窗口为握手前，`implementation.md` §8.12 + `DEBT-010`）被如实落地：`child-exited` 的分类不依赖退出码的真值性（`session-host.ts:157` 以 `details.spawnError === undefined` 判定），且 `exitCode === 0` 实例现已可达并有断言。`DEBT-010` 以 🟡非阻塞登记，并写明 Phase 3 的触发条件（「读 `dsh.test.getDiagnosticsText()` 为空不得读作『无失败』」）—— 对一个「属于设计决策而非编码错误」的缺口，这是正确处理。确认记录见下方 🟢-2。

### 1.4 O-5（`setSink` 调用方）—— 状态不变

`HostDiagnosticRecorder.setSink()`（`host-diagnostics.ts:333-335`）全仓仍**零调用方**（`grep -rn setSink` → 仅其定义与生成的 `lib/types/host-diagnostics.d.ts` 声明）。第 1 轮把它定为 **O-5 非阻塞观察项**（不是 12 项 SF 之一），故 implementer 并不欠此项修复，也未改。它不是桩（实现完整且行为正确）；sink 经构造函数选项注入，产品路径正是该选项（`extension.ts:429-433`）。此处再次记为 🟢-1，并给出处置建议。

## 2. AC-13 – AC-22 逐条验证

| AC | 要求（摘要） | 实现位置 | 判定 | 证据 |
|----|------|------|:--:|------|
| AC-13 | Output Channel 命名/只创建一次、可显示、记录有保留上限 | `host-diagnostics.ts:23`（名称）、`:26`（上限 200）、`:374-376`（裁剪）；`extension.ts:424-426`（单次 `createOutputChannel`）、`:537-540`（显示命令）、`:1280-1282`（随窗口释放）；`package.json:143-145` | ✅ | 渲染器逐字段原样输出（`host-diagnostics.ts:430-452`）；测试断言唯一通道、显示命令与钩子注册：`host-diagnostics.spec.ts:1010`、`:1016`、`:1034`、`:1040` |
| AC-14 | 启动失败均可达；分类绝不读文本 | `session-host.ts:134-179`（`describeStartFailure`，消息只在 `:135` 作为 `detail` 读取）、`:441-460`（catch → `record`）；SDK 侧 `client.ts:496-514`；扩展兜底 `extension.ts:2332`、`:2367-2372` | ✅ | 两层各以真实 spawn 失败取证（`sdk-client.spec.ts:406`）；裸非 Error 兜底（`session-host.spec.ts:267`）；`other` 桶（`:178`）；扩展兜底恰好一条（`host-diagnostics.spec.ts:1099-1115`） |
| AC-15 | 握手超时必须带其时限被记录 | `session-host.ts:166-174`；时限取自产品常量 `:384`（`DEFAULT_INITIALIZE_TIMEOUT_MS`） | ✅ | `session-host.spec.ts:285-300`（断言 300 ms，Host 内不写字面量）、`host-diagnostics.spec.ts:858` |
| AC-16 | bridge-listen 失败须被记录 | `session-host.ts:175-177` + 阶段由抛出步骤赋值（`:413-414`） | ✅ | `session-host.spec.ts:302-315` |
| AC-17 | stderr 末尾原文（至少最后 20 行），不得摘要替换 | `session-host.ts:162` 原样透传 `details.stderrTail`；SDK 保留 400 行（`client.ts:29`、`:481-487`）；记录逐行拷贝（`host-diagnostics.ts:368`） | ✅ | 25 行尾部逐行与原文比对（`session-host.spec.ts:316-343`）；短尾部不补行（`:362`） |
| AC-18 | 退出码须记录；码不可得时记录信号名 | `client.ts:288-291`（`code`/`signal` 不用真值判断）、`:499-500`（码分支在信号分支之前，故 `0` 仍按码打印）、`:506-514`（结构化 details）；`session-host.ts:157-161` | ✅ | `exitCode: 7`、`exitCode: 0`、`terminationSignal: 'SIGTERM'` 且 `exitCode: null`：`session-host.spec.ts:345-393`；SDK 层 `sdk-client.spec.ts:424`、`:439` |
| AC-19 | 缺凭据须进入失败态 + 提供设置入口 + 终态文案非进行时 | 由 listener 记录（`host-diagnostics.ts:247-248`、`:278-295`）；UI 投影原本存在，按原样消费（`connection-ui.ts:140`、`:128-129`、`:152-154`） | ✅ | 记录 + snapshot + 四项 UI 断言：`host-diagnostics.spec.ts:484`、`:695`、`:1068` |
| AC-20 | 失败不得停在进行时文案；根因取自 `kind`，不得从文案反推 | `describeStartFailure` 以结构区分 `child-exited` 与 `spawn`（`session-host.ts:157`），全程不匹配消息文本 | ✅ | 全分类遍历 `host-diagnostics.spec.ts:746`；同一链上不同边界保持可区分 `:695`；`session-host.spec.ts:395` |
| AC-21 | 到达通道或 UI 的所有文本须先脱敏 | 每个字符串字段都过 `redact`（`host-diagnostics.ts:410-412`，作用于 `:359-370`）；凭据在 spawn **之前**注册（`session-host.ts:377`） | ✅ | 环境变量值 + 凭据袋 + JSON 序列化 + 渲染文本四处均断言无密文：`host-diagnostics.spec.ts:320`、`:361`、`:1144-1180` |
| AC-22 | 可点击重试入口、复用同一路径、重试前后各追加记录 | listener `host-diagnostics.ts:278-295`；链账本 `:341-343`、`:356-357`、`:372`；重试入口 `extension.ts:2367-2372` 经 `auto-start-orchestrator.ts:205-249` 重入同一路径 | ✅ | 入口可点击 `host-diagnostics.spec.ts:1068`；路径复用含调用计数 `auto-start-orchestrator.spec.ts:205-224`；成对记录 `host-diagnostics.spec.ts:1117-1142`；sink 侧链 `:1189-1230` |
| AD-13 投影 | `toolName` + 非空 `reason` 须被投影，且不得新增其它字段 | `interaction-coordinator.ts:208-229`（两个分支，`reason` 缺失时省略） | ✅ | 有/无 `reason` 两种精确键集合断言：`host-diagnostics.spec.ts:779-809` |

契约完整性（`spec.md:63`）：18 字段恒存在，不适用者为 `null`/`[]` 而非缺失 —— 以设计来源表断言，含字段集相等（`host-diagnostics.spec.ts:122-160`）。版本策略（`> 1` 容忍、`< 1`/缺失/非整数拒绝、`[]` 合法）：`:226-266`。

## 3. 桩检测

对照 `tech-debt-registry.md`。

### 已登记债务（不重复上报）

| Registry ID | 文件:函数 | 状态 | 说明 |
|---|---|:--:|---|
| DEBT-004 | `packages/specdev/specdev-presets/src/tool-policy.ts:21-27`、`:30` | ⚠️ 已知 🟡 | 用户裁定不属本 Phase 范围；非 Phase 2 产物 |
| DEBT-009 | `phases/phase-1-node-env-preflight/implementation.md` §2.3 | ⚠️ 已知 🟡 | 自 Phase 1 承接的文档归类债 |
| DEBT-010 | `host-diagnostics.ts:260-294` + `session-host.ts` 的 fail-loud 出口 | ⚠️ 已知 🟡 | 握手后的运行期断线不产记录 —— 已裁定落在本 Phase 验收面之外（§8.12）。已正确登记，故**不**作为新发现上报 |
| DEBT-008 | — | ✅ 已解决 | 已移入「已解决」表；两处编辑均已落地（`extension.ts:233`、`:2245` 引用 AD-9；`session-host.ts:54` / `auto-start-orchestrator.ts:40` 的来源句已扩为覆盖 `StartHostPort`） |

活跃表恰为 `DEBT-004` / `DEBT-009` / `DEBT-010`（`tech-debt-registry.md:26-28`），全部 🟡 —— 与 `:34` 的说明一致。

### 新发现的未登记桩

**无。** `grep -rn '@STUB' apps/vscode-dsh/src apps/vscode-dsh/tests packages/sdk/client/src packages/sdk/client/tests` → 零命中；被触碰的产品文件中无 `TODO` / `FIXME` / "placeholder" / "will be wired"。本次变更集里没有任何函数体是空壳：我追踪的每个分支都在计算真实值（分类、脱敏、链账本、投影）。

## 4. 独立复跑证据（含与基线的差量）

环境：Node `24.3.0`（`PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`）。Phase 基线产物复用 `/tmp/p2-baseline-*.txt`。

| 门槛 | 命令（节选） | 结果 | 相对基线 |
|---|---|---|---|
| 类型检查 | `pnpm run typecheck` | exit **0**，`error TS` 计数 **0**（`/tmp/rc2-typecheck.txt`） | green → green |
| `apps/vscode-dsh` 套件 | `pnpm run test apps/vscode-dsh` | **6 failed / 404 passed / 1 skipped（411）**（`/tmp/rc2-vscode-dsh.txt`） | **零新增失败**：`diff /tmp/rc2-fails-base.txt /tmp/rc2-fails-cur.txt` 仅剩逐条耗时差异（16→21 ms、2→4 ms、115→114 ms、24→37 ms），失败用例名 6 个、失败文件 4 个完全相同，且全部落在 Phase 1 / spike / e2e 区域。通过数 `351 → 404` 的增量即本 Phase 自身新增用例 |
| `packages/sdk/client` 套件 | `pnpm run test packages/sdk/client` | **87 / 87 passed**，exit 0（`/tmp/rc2-sdkclient.txt`） | 基线 84 → +3，全绿 |
| `client.ts` 逐文件覆盖率 | `pnpm exec vitest run --coverage --coverage.include=src/client.ts packages/sdk/client` | exit 0 —— **语句 188/188、分支 113/113、函数 44/44、行 161/161（100%）**（`/tmp/rc2-cov-client.txt`） | 与第 1 轮数字一致：新增的信号 / `exitCode === 0` 分支确被执行，而非仅存在于代码中 |
| Phase 2 定向用例 | `pnpm exec vitest run host-diagnostics.spec.ts session-host.spec.ts auto-start-orchestrator.spec.ts sdk-client.spec.ts` | **113 / 113 passed**，exit 0（`/tmp/rc2-targeted-r3.txt`） | 突变回滚后 4 个文件全绿 |
| Lint 门禁 | `pnpm run lint` | exit 1 —— 全仓恒红，与基线相同（`/tmp/rc2-lint-full.txt`） | **零新增触发规则**。把行列号归一化（`sed`）后错误多重集完全相同：**两侧各 10381 行，`diff` = IDENTICAL**。原始行级差异全是被改动文件内的行号漂移（extension.ts +77、session-host.ts +130、interaction-coordinator.ts +30、auto-start-orchestrator.ts +7），没有任何在基线未触发过的规则触发。新文件 `host-diagnostics.spec.ts` 贡献 0 条诊断 |
| 整仓 `pnpm run test:coverage` | — | 未作判据 | 本机已知恒红；按指令改用逐文件覆盖率 |

### 4.6 突变 A —— `C-1` 的修复是否「承重」？

过程：先备份 `host-diagnostics.ts`（含 sha1），把重新武装分支替换为第 0 轮语义（`if (snapshot.state === 'started') recorded = undefined; if (snapshot.state !== 'failed') return`），跑套件，再以完全反向的编辑还原；还原经 `diff` + sha1（`37be2046…` 相符）验证。

结果（`/tmp/rc2-mutA.txt`）：**3 failed / 41 passed（44）**，exit 1，变红的三条为

1. `records a retry of a pre-Host refusal as the next link of the chain`（SF-12 / C-1 的成对性）
2. `re-arms on a queued retry, so a coalesced second reason also gets a record`（SF-12 的排队重试覆盖缺口）
3. `AC-22: a retry after a pre-Host refusal adds a paired record`（经真实扩展的端到端）

而同一次尝试内的去重用例保持**绿色** —— 这正是 C-1 需要的判别力。由此独立确认：(a) 成对记录的出现确由该 guard 改动带来；(b) 这三条用例不是空转。

注：`implementation.md` §9 把该突变记为 **2** 处失败，我实测为 **3** 处。此处差异是**低估了 implementer 自己的证据强度**（第三处是端到端用例）；记为 🟡-2，不作为代码缺陷。

### 4.7 突变 B —— `A′` 的修复是否「承重」？

过程：对 `extension.ts` 采用同样的备份/还原纪律；把删掉的启发式重新插回兜底条件（`… && !(error instanceof HostStartError) && …`），跑套件，反向还原并验证字节级一致（sha1 `2aed2b6b…` 相符）。

结果（`/tmp/rc2-mutB.txt`）：**1 failed / 43 passed（44）**，exit 1，且**恰好只有** `AC-14 兜底: a pre-Host setting refusal is recorded once, as 'other'` 变红。可见「无任何 Host 边界认领的失败」其覆盖完全由 `lastSeq()` 这一精确信号承担，重新引入启发式即重新打开 `A′` 关掉的覆盖空洞。

### 4.8 突变测试后的工作区状态

两个文件均已按字节级一致还原（sha1 与突变前备份相符），其后完整定向集合复跑全绿（**113 / 113**，`/tmp/rc2-targeted-r3.txt`）。除只读检视外未运行任何 git 命令；`current-status.json` 未被触碰。

## 5. 关键发现

### 🔴 Must-Fix

**无。** 第 1 轮两项阻塞均已解决并经独立确认；无 AC 未满足；无未登记桩。

### 🟡 Should-Fix

- **🟡-1 `DEBT-010` 的来源引用指向了错误的章节。** `tech-debt-registry.md:28` 结尾为「…本 Phase 内已按握手前读法取证并显式留痕（`implementation.md` §8.9/§8.10）」。该裁定与留痕位于 **§8.12**；§8.9 是词表收窄、§8.10 是兜底信号。按此引用追查会落到错误的偏离条目上。修法一行：`§8.9/§8.10` → `§8.12`。（该条目的作者是起草注册表条目的调度者，但它是本 Phase 证据链的一部分，故在此上报而不是静默放过。）
- **🟡-2 `implementation.md` §9 自检表有两处自述失准。** (a) 「恢复第 0 轮 listener guard」的突变记为「**2 处失败**」，实测 3 处（§4.6）—— 低估掩盖掉了一条端到端用例。(b) store→reader 一行把 `createStartFailureListener` 的去重说成读取 `records()`；listener 从不调用 `records()`，它比对的是来自 snapshot 的签名（`host-diagnostics.ts:289-292`），而读 `lastSeq()`（`:393-395`）的是**扩展兜底**。两处均为自述表的措辞修正，底层行为是正确的。

### 🟢 观察项

- **🟢-1 `setSink` 仍是死公共 API**（第 1 轮 O-5，状态不变）。`host-diagnostics.ts:333-335` 全仓无调用方、无测试；sink 经构造函数选项注入（`extension.ts:429-433`）。它不是桩（能工作），故不构成正确性缺陷，且与第 1 轮的定级一致，不算 should-fix。建议后续清理：删除它（构造选项就是产品路径）或在 JSDoc 里写明其所有者。留一个无消费方且无测试的公共 mutator，会诱使未来的调用方静默改接通道。
- **🟢-2 `DEBT-010` 的残余缺口边界划定正确，我确认该取舍是实情而非便利。** 覆盖握手后死亡需要给 `phase` 加第三个成员，而按 AD-14 决策 11 任何字段面改动都强制 `schemaVersion` 升级，进而打破 Phase 3 的 `=== 1` 精确字段断言。以写明 Phase 3 触发条件的方式登记缺口是正确的；唯一风险是 Phase 3 冒烟把空记录数组误读为「无失败」，而注册表条目已显式点出这一点。
- **🟢-3 `host-diagnostics.spec.ts:437-451` 的词表用例是拿设计字面量与自身比对。** 如所写是同义反复 —— 只有有人改动该字面量时才会失败。真正把实现钉住的是另外三处：产出记录的键集合（`:136`）、显式的 `invalid-setting → null` 断言（`:458`）、以及 `Record<HostFailureKind, StartErrorKind>` 的编译期完整性（`host-diagnostics.ts:209`，增删成员都会成为类型错误）。因此契约**确实**被强制；若将来导出运行时词表数组，`:437` 应改为与该数组比对，而非与自身字面量比对。
- **🟢-4 脱敏落在存储边界而非渲染边界**，且 `stderrTail` 在入库前逐行过 `redact`（`host-diagnostics.ts:368`）—— 因此只出现在某行 stderr 里的凭据值也无法经渲染路径逃逸。方向正确（由构造保证安全，而非依赖调用点自觉），这也是 AC-21 四处断言有意义的前提。

## 6. 方法与局限说明

- 我重读了变更集中每个函数体，而非采信 `implementation.md`；AC 表中每条判定都指向决定该判定的那一行。
- 我对被审代码做了两处突变并回滚，因为「测试通过」并不证明「正是该修复让它通过」。两次还原均以 `diff` 与 sha1 验证，其后工作区复跑全绿。这是我本次唯一的写操作，且未在工作区留下任何痕迹。
- **未**验证的部分：`DEBT-010` 关于「`schemaVersion` 升级会打破 Phase 3 断言」的成本评估是否与 Phase 3 的实际 spec 一致 —— 那属于 Phase 3 自身的审查。另外我未重新推导 Phase 1 的 `invalid-setting` 路径，只确认其未被触碰且仍有断言（`node-env-guard.spec.ts:729-744`）。
