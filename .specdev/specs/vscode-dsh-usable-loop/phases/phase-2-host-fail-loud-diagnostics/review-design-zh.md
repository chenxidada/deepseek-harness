# 设计一致性审查 — Phase 2（第 2 轮，提交门禁 lint 修复）

## 视角
**设计一致性（Design Consistency）** — 实现是否遵循既定架构

## 判决：SHOULD-FIX

> 无 🔴 MUST-FIX。本轮 4 处改写符合 `design.md`、`spec.md` 与本仓既有惯例；契约面可证未被触碰。
> 两条 🟡 SHOULD-FIX 均为**文档保真**缺陷，且都在本轮自己的说明文本 `implementation.md` §11 之内，
> **零行为影响** —— 修法是一句话与一行表格，**不需要改任何代码**。

## 审查范围声明

本报告是**限定在第 2 轮增量**上的复审，不是对 Phase 2 主体的重新审判。Phase 2 主体（诊断记录契约、
`HostFailureKind`、listener、store、extension 接线、AC 取证）已在第 2 轮被审并收口，遗留项已按
`DEBT-010`…`DEBT-013` 处置。第 2 轮 = 提交门禁清理：**4 个 lint 点 + 7 行自动格式化**，由 `lefthook`
的 `lint (staged)` 棘轮触发，且这些行**在 `HEAD` 中即已存在**（下方给出证明）。

---

## 1. 本轮增量是否触碰冻结契约面？—— **未触碰，逐项核实**

| `design.md` 冻结面 | 契约所在 | 本轮是否触碰 | 证据 |
|---|---|:--:|---|
| `schemaVersion` 字面量 `1`、单一真相源常量、18 字段清单（AD-14 决策 9–12） | `host-diagnostics.ts:20`（`HOST_DIAGNOSTIC_SCHEMA_VERSION = 1`）、`:64`（字段）、`:353`（写入点） | **否** | `host-diagnostics.ts` 不在本轮 3 个文件内，且不在任何本轮 hunk 中 |
| `HostFailureKind` —— **恰好 7 个成员** | `host-diagnostics.ts:44-51` | **否** | 实读：7 个成员 = `node-environment`、`bridge-listen`、`spawn`、`handshake-timeout`、`child-exited`、`missing-credentials`、`other` |
| `HostDiagnosticRecord` —— **恰好 18 个字段**、全 `readonly`、恒存在 | `host-diagnostics.ts` | **否** | `sed -n '55,110p' host-diagnostics.ts \| grep -cE '^  readonly '` → **18** |
| `phase` 取值域 `'start' \| 'retry'`（AD-14 字段 11） | `HostDiagnosticPhase = 'start' \| 'retry'` | **否** | 未变；未新增第三成员（`DEBT-010` 明确裁定本 Phase 不采纳） |
| 公共 API 面（`dsh.test.getDiagnosticsText`、记录形状） | AD-14 决策 1–4 | **否** | 本轮 hunk 不含任何签名 / 名称 / 参数顺序 / 可空性变更 |
| `PendingHostInteraction` 投影（AD-13：`toolName` / `reason`） | `interaction-coordinator.ts:55-72` | **否** | 该文件的本轮 hunk 是 `:357`（循环形态）与 2 处 `arrow-parens`；AD-13 字段块与 `projectEntry` 抽取（§8.4）是更早的独立 hunk |
| `design.md` / `design-zh.md` 自身 | — | **否** | `git hash-object design.md` 与 `git rev-parse HEAD:design.md` 同为 `09c65ffe19f264172d3cab2d4dca692190593d5c`；两者 `git status --porcelain` 为空 → **与 `HEAD` 逐字节相同**（印证 §8.9 的「byte for byte」） |

**`schemaVersion` 是否需要递增：不需要。** AD-14 决策 11 要求递增的条件是**字段面**变化（新增 / 删除 /
改名 / 类型 / 可空性）。本轮增量是控制流（`next !== undefined` 取代 `more.length > 0`；`for…of` 取代索引
`while`）、格式化、以及测试内绑定删除。无任何字段被增删改名或改类型；`host-diagnostics.spec.ts` 中
`schemaVersion === 1` 的「18 字段精确相等」断言原样通过（见 §4）。

### 本轮 3 个 hunk 的位置（hunk 粒度）

```
apps/vscode-dsh/src/auto-start-orchestrator.ts
  @@ -235,2 +242,2 @@   ← 本轮（修复 #1）      [另两个 hunk 属更早轮次：START_ERROR_KINDS + JSDoc]
apps/vscode-dsh/src/interaction-coordinator.ts
  @@ -327,2 +357 @@     ← 本轮（修复 #2）
  @@ -233 +263 @@       ← 本轮（arrow-parens）
  @@ -411 +440 @@       ← 本轮（arrow-parens）
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts
  @@ -52,2 +52 @@ / @@ -57 +56 @@ / @@ -60 +58,0 @@  ← 本轮（修复 #3 + arrow-parens）
  @@ -95,2 +93 @@ / @@ -100 +97 @@ / @@ -103 +99,0 @@  ← 本轮（修复 #4 + arrow-parens）
  @@ -176,0 +173,48 @@  ← 更早轮次（两条 AC-9 / AC-22 用例）
```
本轮任何 hunk 中都不出现契约符号。

---

## 2. 本轮增量是否符合代码库既有约定？—— **符合，附计数证据**

### 2.1 `more.at(-1)` 与 `more[more.length - 1]!`（修复 #1）

决定性事实不是口味，而是规则配置 + `strict` 索引：

| 证据 | 值 |
|---|---|
| `tsconfig.base.json:20` | `"noUncheckedIndexedAccess": true` → `more[more.length - 1]` 类型为 `T \| undefined`；原来那行能过类型检查**只能**靠裸 `!` |
| `.oxlintrc.json:160` | `"typescript/no-non-null-assertion": "error"` —— **作用于 `apps/*/src/**` 与 `packages/*/*/src/**`** |
| `.oxlintrc.json:207` | 同规则 `"off"` —— **仅测试** |
| 全仓对该规则的内联抑制 | `rg 'no-non-null-assertion' -t ts -t tsx -t md apps packages docs AGENTS.md CLAUDE.md` → **0 命中**。三个文件中不存在 `eslint-disable` / `oxlint-disable` / `@ts-expect-error` / `@ts-ignore`（`rg` 退出码 1） |

也就是说，在 `src` 里 `[len - 1]!` 是 **error** 级违规，仓库事实上的两种答案是 `.at(-1)`（配
`undefined` 检查）或可选链读取。计数：

| 形态 | 全仓 `src`（ts/tsx，排除 `lib`/`vendor`） | 文件数 | `apps/vscode-dsh/src` |
|---|:--:|:--:|:--:|
| `.at(-1)` | **92** | 55 | 2 |
| `[x.length - 1]` | 27 | — | 1 |
| 其中带 `!` 的 | **1** | 1 | 0 |

样例：`packages/api/gateway/src/client/journal-stream.ts:187` `const tail = accepted.at(-1)`；
`packages/core/session/src/chunk-rows.ts:234` `const last = run[run.length - 1]`；
`apps/vscode-dsh/src/host-diagnostics.ts:394` `return this.store[this.store.length - 1]?.seq ?? null`
（同域最近的先例：保留索引形态，但**走可选链，从不写 `!`**）。

诚实的保留：单看 `apps/vscode-dsh/src` 样本太小（2 : 1），不足以定论。承重证据是 (a) 该规则在 `src` 中是
`error` 且全仓零抑制 —— 基线里的 13 个 `(文件, 规则)` / 41 处是**已认账的债**，不是被接受的惯例；(b) 全仓
范围 `.at(-1)` 对索引形态约为 **3.4 : 1**。修复 #1 落在多数派惯例上，且是**消除**一条 `error` 违规而不是
重申它。 ✅

### 2.2 `for…of` 与索引 `while`（修复 #2）

| 形态 | 全仓 `src` 出现次数 |
|---|:--:|
| `for (const X of …)` | **1776** |
| `while (i < x.length)`（索引扫描） | 16 |

这 16 个索引 `while` 是字节/字符扫描器，不是集合遍历：`while (offset < html.length)`
（`packages/web/tool-web/src/fetch.ts`）、`while (i < lines.length)`
（`apps/vscode-dsh/src/markdown/safe-markdown.ts`）、`while (index < this.pending.length)`
（`packages/terminal/terminal-bash/src/sanitize.ts`）。而被改文件自身已用过 4 次 `for (const entry of …)`
（`interaction-coordinator.ts:326`、`:342`、`:539`、`:545`）—— 因此这次改写是让 `enqueue` 与它的邻居一致，
而非引入新风格。 ✅

（循环退出值与 `break` 语义属正确性范畴，归 `reviewer-correctness`。设计视角：`:355` 的既定意图
「Soft priority: insert at front of waiting queue, same-Tab FIFO」与函数的 `private` 可见性均未变，
即架构面未移动。）

### 2.3 测试侧惯例：`port.setConnected(true)` 与 `.bind(port)`（修复 #3/#4）

`port.setConnected(...)` **正是本 spec 既有（改前）的调用方式**，共 4 处：

```
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:77   port.setConnected(false)
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:85   port.setConnected(false)
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:127  port.setConnected(true)
apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:206  port.setConnected(true)
```

整个 `apps/vscode-dsh/tests/` 树里 `.bind(` 只有 3 处，且都不属本形态。前向声明 + `.bind` 才是异类；
删掉它同时**消除**一条 `eslint(prefer-const)` `error`，而不是抑制它。 ✅

---

## 3. `@STUB` 与技术债登记

- **未创建任何 `@STUB`。** 三个文件 `rg '@STUB'` 无命中；整个变更集中每一条 `+…@STUB…` 都是**spec 文档
  内的叙述**（`implementation.md` / `verification.md` / `review-*.md` 自检表在引用该标记），没有一条是代码
  注释。没有需要登记的东西。 ✅（§11.7 在这一点上的自述准确。）
- **注册表未被本子轮改动 —— 但轮次说明中给出的判据需要更正。** `tech-debt-registry.md` **确实出现在**
  `git diff HEAD` 里（Phase 2 尚未提交：49 个文件已入索引，其余在工作区），所以「不在 `git diff` 中」不是
  正确的判据。正确判据是时间，而时间是干净的：

  | 文件 | mtime |
  |---|---|
  | `tech-debt-registry.md` | `2026-09-16 11:41:12` |
  | `src/auto-start-orchestrator.ts`（修复 #1） | `2026-09-16 11:52:36` |
  | `tests/auto-start-orchestrator.spec.ts`（修复 #3/#4） | `2026-09-16 11:52:40` |
  | `src/interaction-coordinator.ts`（修复 #2） | `2026-09-16 11:54:36` |
  | `implementation.md`（§11 本身） | `2026-09-16 12:00:41` |

  注册表早于第一处修复约 11 分钟，其 diff 只含 `DEBT-008`（已移入已解决，用户裁定）与审查轮次登记的
  `DEBT-010`…`DEBT-013`。→「本轮注册表不新增条目」成立。 ✅
- **这 4 处确实先于 Phase 2 存在**（独立复核，因为这是本轮如此定范围的依据）：

```
git show HEAD:apps/vscode-dsh/src/auto-start-orchestrator.ts    | grep -c 'const next = more\[more.length - 1\]!'  → 1
git show HEAD:apps/vscode-dsh/src/interaction-coordinator.ts    | grep -c 'const current = this.queue\[insertAt\]!' → 1
git show HEAD:apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts | grep -c 'let setConnected!'                → 2
```

---

## 4. 我独立执行的命令（非 implementer 的）

全部前置 `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`（`node --version` → `v24.3.0`）。

| 命令 | 结果 |
|---|---|
| `node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern <3 文件>` | **`EXIT=0`，完全无输出** —— 提交门禁已绿 |
| `pnpm run typecheck` | **`TYPECHECK_EXIT=0`** |
| `pnpm exec vitest run <auto-start-orchestrator / interaction-fail-closed.integration / gap-005-009-debt-fix / host-diagnostics>` | **`Test Files 4 passed (4)` / `Tests 66 passed (66)`**，exit 0 —— 含 AD-14 契约完整性用例 |
| `diff /tmp/lint-base-norm.txt /tmp/p2r2-lint-norm.txt` | 恰为移除 6 个 `(文件, 规则)` 条目 / 11 处，新增 2 条（verifier 探针自身的 `Unused eslint-disable directive` warning）；`891` → `887` 行。**没有任何文件新增诊断。** |
| `git hash-object design.md` 与 `git rev-parse HEAD:design.md` | 相同（`09c65ffe19f…`）—— 设计文档未动 |
| `rg 'eslint-disable\|oxlint-disable\|@ts-expect-error\|@ts-ignore\|as any' <3 文件>` | 无命中（退出码 1）—— **未使用任何抑制**，与 §11.2 一致 |

被触及文件的逐文件 lint 计数与 §11.6 所述完全一致（`interaction-coordinator.ts` 仍保留
`no-unnecessary-condition` ×5 + `no-confusing-void-expression` ×1；`extension.ts` 其余 7 条保留；
`auto-start-orchestrator.ts` 与该 spec 归 0）。 ✅

---

## 5. 架构决策对照（仅本轮增量）

| design.md 决策 | 是否遵循 | 证据 | 判定 |
|---|:--:|---|:--:|
| AD-14 决策 1–12 —— 记录契约（`schemaVersion` 1 / 18 字段 / 7 成员 / `phase` 取值域） | 是 | 契约类型未变；`design.md` 与 `HEAD` 逐字节相同；契约用例通过 | ✅ |
| AD-14 决策 11 —— 仅在字段面变化时递增版本 | 是（无需递增） | 本轮任何 hunk 均未增删改名或改类型 | ✅ |
| AD-13 —— 扩展投影携带 `toolName` / `reason` | 是（未被触碰） | 该文件本轮 hunk 只有循环形态 + 2 处 arrow-parens | ✅ |
| AD-3 —— 归类是结构性的，绝不匹配消息文本 | 是（未被触碰） | 本轮增量不含任何针对消息的 `.includes(` / 正则 | ✅ |
| AD-4 —— `StartErrorKind` ⇄ `HostFailureKind` 映射表 | 是（未被触碰） | 本轮 hunk（`@@ -235,2 +242,2 @@`）未改 `START_ERROR_KINDS` / 映射表 | ✅ |
| AD-5 —— 冻结的消息前缀集 | 是（未被触碰） | `auto-start-orchestrator.ts` 本轮 hunk 只动控制流 | ✅ |
| 模块划分 / 依赖方向 | 是 | 本轮未新增文件、未新增 import、未新增跨模块边 | ✅ |
| 命名规范 | 是 | 本轮未重命名任何符号；`current` / `next` 均为局部变量 | ✅ |

## 模块 / 命名 / 结构审查

| 新增·变更文件 | 所在目录 | 是否合理 | 说明 |
|---|---|:--:|---|
| `src/auto-start-orchestrator.ts`（`finally` 内控制流） | `apps/vscode-dsh/src/` | ✅ | 原地改写，未移动模块边界 |
| `src/interaction-coordinator.ts`（`private` 方法内的循环形态） | `apps/vscode-dsh/src/` | ✅ | 公共投影未动；`enqueue` 仍为 `private` |
| `tests/auto-start-orchestrator.spec.ts`（删除绑定） | `apps/vscode-dsh/tests/` | ✅ | 仅测试面；与该文件既有调用方式对齐 |

---

## 6. 发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix

**🟡① `implementation.md` §11.6 的「移除条目数」与表格均失准（数字少报）。**
该节的明确目的就是证明整仓 lint 差量，因此它的数字就是证据本身。以下是我自己 `diff` 两个归一化文件得到的实际值：

| 被移除的 `(文件, 规则)` 条目 | 处数 | 是否在 §11.6 表中 |
|---|:--:|:--:|
| `auto-start-orchestrator.ts \| typescript(no-non-null-assertion)` | 1 | 有（修复 #1） |
| `interaction-coordinator.ts \| typescript(no-non-null-assertion)` | 1 | 有（修复 #2） |
| `auto-start-orchestrator.spec.ts \| eslint(prefer-const)` | 2 | 有 |
| `interaction-coordinator.ts \| @stylistic(arrow-parens)` | 2 | 有 |
| `extension.ts \| @stylistic(indent)` | 3 | 有 |
| **`auto-start-orchestrator.spec.ts \| @stylistic(arrow-parens)`** | **2** | **无 —— 缺一行** |
| **合计** | **6 条目 / 11 处** | 表格 = 5 行 / 9 处；标题写「**7** entries」 |

那个「7」是**格式化行数**（3 + 2 + 2，紧随其后的段落算得是对的），不是条目数。缺失的那一行在同段落里
其实被点名了（「2 × `@stylistic(arrow-parens)` in each of the other two files」），却没有进表。影响：审计
差量的读者会看到 6 条里的 5 条，把移除量少算 2 处。**与 `DEBT-011` 同属一类缺陷**（同一文档内的数字自述
错误，已被承接为债），零行为影响。修法：补上缺失行，把「7 entries」改为「6 entries (11 occurrences)」。

**🟡② §11.7 的「范围声明」句与同一文档 §8.8 自相矛盾。**
§11.7（及其中文孪生）写：「*No git command beyond inspection and **no write outside the three source
files and this document** were performed*」/「除三个源文件与本文件外未写入任何位置」。可核实的事实：

```
stat -c '%y' .cursor/skills/project-build/SKILL.md   → 2026-09-16 11:59:39   （落在本轮窗口 11:52:36–12:00:45 内）
git diff HEAD -- .cursor/skills/project-build/SKILL.md | rg '^\+'  →  新增行 :52 "…（2026-09-16 by implementer，Phase 2 回炉第 2 轮）"
                                                                        与 :63 "gen-third-party-notices.ts 幂等（2026-09-16 by implementer）"
```

同一文档的 §8.8 已经确立了通则 —— agent 契约要求构建/测试成功后更新这些 `.cursor/skills/*`，且该工具树
被排除在提交集之外 —— 但它的举例只点了 `project-test`，而 §11 通篇未提本轮这次 `project-build` 写入。
于是 §11.7 那句按字面读（自述本来就该按字面读）会告诉审计者「本轮 `.cursor/` 未被写入」，与工作区事实相反。
写入本身是**正确行为**，不准确的只是那句话。修法：补一个从句 —— 「……除三个源文件与本文件外未写入任何
**产品**文件（§8.8 所述的 `project-build` SKILL 更新除外）」。

**为什么是 🟡 而不是 🔴 或 🟢。** 定为 🟡 而非 🔴：两条都没违反 `design.md` 决策、`spec.md` 约束或
Constitution §2，也不改变行为 —— 4 处代码改写是正确的。定为 🟡 而非 🟢：本仓的明文契约是「偏离绝不静默」
（§8 自己的前提：「Nothing here is silent」），且 `DEBT-011` 表明本项目把**同一类**（自检表里的数字/范围
失准）当作正式登记项而非脚注。我**不要求任何代码改动**；修法是文本性的，调度者/用户也可以像处置
`DEBT-011`/`DEBT-012` 那样把这两条一并承接为债。

### 🟢 观察

- **🟢① §11 前言里 `git show :<file>` 那一半已不可复现（`HEAD` 那一半可以，而它才是承重的那半）。**
  §11 说每条违规行都存在于 `HEAD` **与**「phase-2 index，未变」。今天
  `git show :apps/vscode-dsh/src/auto-start-orchestrator.ts | grep -c 'more\[more.length - 1\]'` → `0`，
  因为暂存区已持有**修复后**的内容（3 个文件的 `git status -s` 均为 `M ` 且工作区无差额），即 11:52 之后
  发生过一次 `git add`。实质结论不受影响 —— `HEAD` 那一半返回 `1 / 1 / 2`，独立证明了这些行先于本 Phase
  存在 —— 且**该 `git add` 的归属无法从仓库状态判定**（可能是调度者而非 implementer 所为），故列为观察，
  不并入 🟡②。
- **🟢② §8 共 12 条，无一覆盖 `child-exited` 裁定** —— 见 §7；与 `DEBT-012` 已被登记而非修复一致。
- **🟢③ `--fix` 的格式化行被保留而非回退。** `extension.ts` 少了 3 条 `@stylistic(indent)`，另两个文件各少
  2 条 `arrow-parens` —— §4 的差量证实本轮编辑是叠在格式化结果之上，而不是把格式化撤销。
- **🟢④ 我自己的 `pnpm run typecheck` 未向工作区新增构建产物。** `git status` 中未跟踪 `.js` 数量前后为
  `192` / `192`（相对本次会话开始时多出的 4 个未跟踪文件是并发 reviewer 各自的 `.archive/` 移动，不是我产生
  的）。

---

## 7. 第 2 轮 🟡①（`child-exited` 裁定未入 §8）的现状

**仍未入账，且已承接为债 —— 本轮不要求修。**

```
grep -n '^\*\*8\.' implementation.md              → 8.1 … 8.12   （12 条）
sed -n '198,241p' implementation.md | grep -c 'child-exited'  → 0
grep -n 'child-exited' implementation.md          → 仅 :25（ASCII 边界框）与 :59（冻结的 7 成员清单）
```

`repo-exploration.md` §8.4 要求把该裁定（「`child-exited` **无需**新增 `StartErrorKind` 成员」）写进
`implementation.md`；它目前只活在代码里（全函数映射表 + JSDoc）。该现状与第 2 轮**完全相同** ——
§8.9 / §8.10 / §8.12 覆盖的是相邻话题，没有一条是这项裁定。它已登记为 **`DEBT-012`**
（`tech-debt-registry.md:30`，来源列写 `review-design 🟡① ≡ review.md SF-C`，目标「后续工作流」，
🟡非阻塞），这是用户裁定，也即当前正确状态。本轮既未修复也未恶化它，我不要求在此修复。

---

## 8. 给合并判决的结论

- 契约面（AD-14 18 字段 / `schemaVersion` / 7 个 `HostFailureKind` 成员 / `phase` 取值域 / AD-13 投影 /
  AD-3 / AD-4 / AD-5）：**未触碰，逐项核实。**
- 既有约定（`at(-1)`、`for…of`、重构而非抑制、直调 port 方法）：**符合**，附计数证据。
- `@STUB` / 注册表：**无物需登记；注册表未被本子轮改动**（以时间证明）。
- 本轮的**代码**是干净的；两条 🟡 都在本轮的**说明文本**里。若调度者按处置 `DEBT-011`/`DEBT-012` 的先例
  把「自述保真」归入后续工作流收口，可把这两条承接为债，并在实质上把本审查读作 PASS。
