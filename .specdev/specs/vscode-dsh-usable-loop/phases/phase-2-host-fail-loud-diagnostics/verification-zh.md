# Phase 2 验证报告（round 3 — lint 修复再验证） — `phase-2-host-fail-loud-diagnostics`

| 项 | 值 |
|---|---|
| 工作流 | `vscode-dsh-usable-loop` |
| Phase ID | `phase-2-host-fail-loud-diagnostics`（来自 `phase-plan.md` DAG JSON `phases[].id`） |
| 验证分支 | `impl-phase-2-host-fail-loud-diagnostics`（`git branch --show-current` 实测） |
| Phase 类型 | **非 UI** —— `phase-plan.md:74` DAG JSON 实测 `"ui": false` → 视觉验证**不适用**（不因此降级判决） |
| 覆盖 AC | AC-13 – AC-22（10 条；沿用第 2 轮证据，本轮不重推） |
| 本轮性质 | **提交期驱动变更的再验证**（4 处 lint 修复 + 7 行格式化），**不是**从零重验 |
| 启动自清理 | 第 0 步检测：直接路径 `verification.md` **不存在**，第 2 轮两份报告已在 `.archive/`（`verification-20260916T060214Z.md` + `verification-zh-20260916T060214Z.md`）→ 本轮无需归档。**未运行任何 git 命令**，未触碰 `current-status.json` |
| 验证者 | `verifier`（全部结论来自本人实测，不采信 `implementation.md` / `review.md` 的自述） |

## 判决：PASS

**理由。** 4 处修复与删除前代码语义等价，由三条互相独立的证据链共同确立：① 静态 AST 形状校验 20/20（旧形态确实消失、新形态精确成立）；② 行为探针 16/16 —— 跑在**真实** `AutoStartOrchestrator` / `InteractionCoordinator` / `activate()` 上，含 188 个真实类插入形状对拍 pre-fix oracle、512 个循环形态超集、以及一条变异对照；③ `lint (staged)` 门禁本身在这 3 个文件上 exit 0 —— 并另有**非空跑证明**（同一 wrapper、同一 config、同 3 个文件，强制打开一条规则即产出 3/9/1 条诊断）证明这次 exit 0 是「真的干净」而非「根本没 lint」。第 2 轮赖以判 PASS 的两条端到端路径（AC-22 `start → 失败 → 重试记录成对`、`dsh.test.getDiagnosticsText` 读取面）在改动后**仍然通过**，`pnpm run typecheck` exit 0，整包套件失败集合与第 2 轮基线**逐条相同**（同样 4 文件 / 6 条既有失败），且「有/无探针」两轮计数差**恰好 +16**。**因此第 2 轮的 PASS 结论未被本轮改动推翻** —— 无新增失败、无证据弱化、无 AC 回归。唯一未闭合项均在本 Phase 交付物之外（3 条纯文档型 SHOULD-FIX 待用户裁决、已登记的 `DEBT-010`、spec 指派给 Phase 3 的真机冒烟），记于 §范围外维度与已登记债务，**不**计入 §残余风险。

---

## 测试执行矩阵

| # | 场景 | 来源 | 命令 | 结果 | 证据 |
|:--:|---|:--:|---|:--:|---|
| 1 | `lint (staged)`，3 个被改文件 | 门槛 | `node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern apps/vscode-dsh/src/auto-start-orchestrator.ts apps/vscode-dsh/src/interaction-coordinator.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | ✅ exit 0，零诊断 | shell 输出（`STAGED_LINT_EXIT=0`） |
| 1b | **#1 的非空跑对照** —— 同 wrapper、同 config、同 3 文件，强制打开一条规则 | 本人 | 在 #1 上追加 `--deny no-magic-numbers` | ✅ 三个文件分别产出 **3 / 9 / 1** 条诊断 → 三者确被解析与上报，故 #1 的 exit 0 语义是「干净」而非「未 lint」 | shell 输出 |
| 2 | `typecheck` | 门槛 | `pnpm run typecheck` | ✅ exit 0 | `/tmp/p3r3-typecheck.txt` |
| 3 | 定向套件（被改 spec + 两个 Phase 2 核心 spec） | 门槛 | `pnpm exec vitest run apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/host-diagnostics.spec.ts apps/vscode-dsh/tests/session-host.spec.ts` | ✅ exit 0 — **3 文件 / 68 passed (68)** | `/tmp/p3r3-targeted.txt` |
| 4 | `apps/vscode-dsh` 整包，**第 A 轮（无探针）** | 门槛 | `pnpm run test apps/vscode-dsh` | ⚠️ exit 1（仓库既有基线）— 文件 **4 failed \| 47 passed (51)**；用例 **6 failed \| 404 passed \| 1 skipped (411)** | `/tmp/p3r3-roundA.txt` |
| 5 | 同套件，**第 B 轮（带本人 16 条探针）** | 本人 | 把探针拷入 `apps/vscode-dsh/tests/` 后跑 #4 同命令 | ⚠️ exit 1（同样那 6 条）— 文件 **4 failed \| 48 passed (52)**；用例 **6 failed \| 420 passed \| 1 skipped (427)** | `/tmp/p3r3-roundB.txt` |
| 6 | 探针单独 verbose | 本人 | `pnpm exec vitest run apps/vscode-dsh/tests/verifier-independent-phase3.spec.ts --reporter=verbose` | ✅ exit 0 — **16 passed (16)**，16 条用例逐条列名 | `/tmp/p3r3-probe.txt` |
| 7 | 静态 AST 等价校验 | 本人 | `node_modules/.bin/tsx .../test-scripts/verifier-ast-static-phase3.ts` | ✅ exit 0 — **20/20 PASS** | shell 输出（`AST_EXIT=0`） |
| 8 | 工作区完整性（我有没有留下东西） | 本人 | 每轮探针运行后 `git diff --stat -- apps/ packages/` | ✅ **空** —— 我未改任何产品文件；`git status -s -- apps/vscode-dsh/tests/` 恰为预期 4 条，无探针残留 | shell 输出 |

### 证据细节

**#1 / #1b —— 为什么这次「干净」可信，以及一个正对照本该长什么样。** 报出的 4 处违规由 `.oxlintrc.json:151-176` 覆盖，其 `files` glob 含 `apps/*/src/**/*.{ts,tsx}` 且该块把 `typescript/no-non-null-assertion` 设为 `"error"`（`.oxlintrc.json:160`）—— 正是修复 #1/#2 的规则。同一覆盖块**不**覆盖 `apps/vscode-dsh/tests/**`（那里 `.oxlintrc.json:198-215` 把该规则设为 `off`），故 #3/#4 由基础配置中别的规则驱动；我无需确定规则名即可验证改动（我的判据是行为，不是规则名）。

原计划的正对照（把修复前写法放回去、确认门禁变红）**无法按设计执行**：

- 本仓 oxlint **无 stdin 模式**（`--stdin` → `` Error: `--stdin` is not expected in this context ``），无法把 `git show HEAD:<file>` 管进 lint；
- 且**放在覆盖 glob 之外的对照文件证明不了任何事**：`.specdev/**` 不匹配 `.oxlintrc.json` 中任何 `files` 列表，于是无论规则是否存在，原地 lint 一律零诊断。我本轮第一次对照正是这样失败的（对刻意写坏的代码 exit 0）—— 是**对照**无效，不是门禁失灵。

替代对照比原计划更强，因为它用的是真实语料：用**同一个 wrapper、同一份 config**，对**同样的 3 个文件**追加 `--deny no-magic-numbers`，分别在 `auto-start-orchestrator.ts` 得 3 条、`interaction-coordinator.ts` 得 9 条（含第 359 行 —— 正落在改写后的循环内）、`auto-start-orchestrator.spec.ts` 得 1 条。文件确实被加载、解析、上报，故 #1 的 exit 0 是真实的干净结论。

**#4 / #5 —— 两轮计数差（证明我的探针确实被执行）。**

```
第 A 轮（无探针）:  Test Files  4 failed | 47 passed (51)   Tests  6 failed | 404 passed | 1 skipped (411)
第 B 轮（带探针）:  Test Files  4 failed | 48 passed (52)   Tests  6 failed | 420 passed | 1 skipped (427)
差量:               +1 文件、+16 passed、失败集合完全相同（6 条）、skipped 相同（1）
```

差值**恰好**等于探针的 16 条用例，且失败集合在数量与身份上两轮一致 —— 既证明探针**确实被执行且全绿**（而非「没被收集所以看起来零失败」），也证明**改动没有动摇套件任何一处**。这同时复现了 `.cursor/skills/project-test/SKILL.md` 记录的恒定不变量：无探针时 411 用例 / 6 红、47 文件 / 404 passed（与第 2 轮实测完全一致）。

**#7 —— 20 条静态校验。** 它们钉住行为探针看不到的机械事实：`setConnected` 恰有一处声明且方法体 **`this` 计数为 0**（故去掉 `.bind` 是惰性的）、前向声明 `let setConnected` 与 `.bind(port)` 均已消失、6 个调用点全部经返回的 port 对象且**裸调用为 0**、`more.at(-1)` 已提到守卫之前且 `next !== undefined` 守卫恰 1 处、被删的长度检查与带断言的索引读取均已消失、`enqueue` 用 `for..of` 且 `while` 为 0、`this.queue[i]` 读取为 0、而 `splice(insertAt, 0, entry)` 仍在原位；`(r) => r` 与 `r => r` 产出**完全相同的 AST 节点种类序列**（7 行格式化确实只关乎括号：spec 2 处、coordinator 11 处单参箭头）。

---

## 独立验证场景（本人设计，非 implementer 用例）

脚本已落盘：`.../test-scripts/verifier-independent-phase3.spec.ts`（16 条）。复现方式见该文件头部注释（拷入 `apps/vscode-dsh/tests/` 跑完即删；刻意不留在仓库测试树内，以免污染产品覆盖率）。其**被执行**一事有独立证明（见上 §两轮计数差）。

| # | 场景 | 它能抓到什么 | 命令 | 结果 |
|:--:|---|---|---|:--:|
| S1-a | 待启列表为空时绝不重入 start —— 守卫是 load-bearing（`[].at(-1)` 为 `undefined`，缺守卫则 `undefined` 会流进 `runStart`） | 「顺手简化」时把守卫删掉 | 探针 S1 | ✅ |
| S1-b | 有积压时用**最后一条** reason 重试，且只重试一次（取 `at(-1)` 而非 `[0]`、也非「全部」） | 提取后取错元素 | 探针 S1 | ✅ |
| S1-c | 连接已存活时，即便有积压也抑制重试 | 把 `!isConnected()` 项写反 | 探针 S1 | ✅ |
| S1-d | starting 期间用户停止 → 迟到 settle 是 no-op（generation 守卫） | 重排 `if` 时丢掉 generation 判定 | 探针 S1 | ✅ |
| S1-e | 7 种形状上 `length > 0` ≡ `at(-1) !== undefined`；运行期 `typeof [].at === 'function'`；负对照（首元素 ≠ 尾元素，故「取首元素」不可能蒙混过关） | 名为等价实不等价的改写；运行期缺 `Array.prototype.at` | 探针 S1 | ✅ |
| S2-a | **真实 `InteractionCoordinator`**（经 `handleApproval`/`handleQuestions`）：**188 个尾部形状**（2 × 94）必须落在 pre-fix `while` 循环所放的位置，且断言判别数 > 0（把 `presented` 子句拿掉的 oracle 至少在 1 个形状上给出不同答案） | 软优先级插入位的任何变化，含仅 `presented` 子句的回归 | 探针 S2 | ✅ |
| S2-b | 非活跃 session 追加；无活跃 session 也追加 | 改写成「只看首元素就停」 | 探针 S2 | ✅ |
| S2-c | 两种循环形态在「状态 × session 超集」（4×2×4×2×4×2 = 512 组、3 元素队列）上一致，外加空/单元素边界 | 只在 `tests/*.spec.ts` 未覆盖的形状上出现的 off-by-one | 探针 S2 | ✅ |
| S3-a | 无 receiver 调用时 `setConnected` 仍翻转标志（`this` 无关这一前提是被**测**出来的，不是被假设的） | 依赖 `this` 的重构 | 探针 S3 | ✅ |
| S3-b | 只在**因为**该调用发生时，被闸门放行的启动才到达 `'started'` | 让用例变空洞的 fixture 改动 | 探针 S3 | ✅ |
| S3-c | **变异对照**：从不翻转标志的启动必须失败 | 「happy path 天然通过」假阳性 | 探针 S3 | ✅ |
| S3-d | 合并 + 迟到 settle 仍如两处被改用例所期望 | 藏在 helper 编辑里的行为漂移 | 探针 S3 | ✅ |
| S4-a | **AC-22 链**：首启 + 成对重试，随后在可达启动之后新开一条链 | 守卫改写后重试记录丢失 `retryOfSeq` 配对 | 探针 S4 | ✅ |
| S4-b | 读取面是**恰好 18 个字段**的数组（不多不少） | 借重构夹带形状变更 | 探针 S4 | ✅ |
| S5-a | **真实 `activate()`** 上的 `dsh.test.getDiagnosticsText`：hook 已注册且返回结构化数组（初始为空） | 读取面静默消失 | 探针 S5 | ✅ |
| S5-b | 真实激活下，Host 启动前的拒绝以**成对**记录到达读取面 | 单测全绿但端到端配对已断 | 探针 S5 | ✅ |

**方法透明性 —— 我本轮自己的失败尝试（留痕，以免被误记成产品缺陷、也以免被当成掩盖）。** 我最初把 lint 对照写在 `test-scripts/` 里**原地** lint，结果对「含修复前 `!` 断言与 `while`/索引读取形态」的代码回了 **exit 0**。是**对照**错了，不是门禁瞎了：`.specdev/**` 不落在 `.oxlintrc.json` 任何 `files` glob 内，因而从未有任何规则对它生效。我没有接受这个绿色读数，而是先找出原因，再用「强制规则」的非空跑对照替换（同 wrapper、同 config、文件在 glob 内）。该对照文件保留在 `test-scripts/`，头部注释已改写为「必须放进覆盖 glob 才能 lint」，以免后续有人再用它「证明」门禁失灵。

## Reviewer 建议的验证场景

本轮 `review.md` 判决 SHOULD-FIX、**无 MUST-FIX**，且 3 条 SHOULD-FIX **全部**是 `implementation.md` §11 的自述文本缺陷、零行为影响。其处置权在用户，不是判决输入，我因此**未**重审它们（也未让其拉低判决）。我另行独立核查了：

| 场景 | 命令 | 结果 |
|---|---|---|
| 4 处修复就是本轮**全部**产品改动（没有第五条改动藏在暂存区里） | 逐段读 `git diff --cached -- apps/ packages/` | ✅ 三个文件的 hunk 恰为修复 #1–#4 + 7 行箭头括号/缩进；暂存区其余部分是 Phase 2 原实现与 `.specdev` 文档，无未受审的产品改动 |
| 改动未让工作区相对索引漂移（没人留个半应用状态） | `git diff --stat -- apps/ packages/` | ✅ 空 —— 产品改动全部在暂存区，工作区与索引一致 |
| `.at(-1)` 是本仓既有写法，不是本次引入的新事物 | `grep -rn "\.at(-1)" apps/vscode-dsh/src packages/*/*/src` | ✅ 已有 10+ 处（`fork/fork-orchestrator.ts:269`、`acp/acp/src/index.ts:326`、`api/gateway/src/client/journal-stream.ts:187,513`、`api/session-controller/src/history.ts:74,322` 等） |
| 改写后的循环仍然执行插入（重构没有把 splice 弄丢） | AST 项 `coord: the insertion index is still spliced at` + S2-a 真实类排序 | ✅ |

---

## 端到端验证（真实路径，非隔离单测）

| # | 数据路径 | 结果 | 证据 |
|:--:|---|:--:|---|
| E-1 | **AC-22 链** —— `AutoStartOrchestrator.request()` → 启动失败 → `HostFailureRecorder` 开链 → 重试入口 → **成对**记录（`retryOfSeq` 指向开链者），随后可达启动再新开一链 | ✅ | S4-a（真实类）；且仓库自带 AC-22 用例（`re-enters the same start port on the retry entry point`）在 #3 定向运行中于改动后树上通过（68/68） |
| E-2 | **读取面** —— `records()` → `dsh.test.getDiagnosticsText` → 18 字段齐全的 `HostDiagnosticRecord[]`，经**真实 `activate()`**（第 2 轮 E-2/E-5 路径，改动后复跑） | ✅ | S4-b（18 字段数组）+ S5-a/S5-b（hook 已注册；Host 启动前拒绝以成对记录到达） |
| E-3 | **重试尾部改写** —— orchestrator `finally` 块带积压重入 `runStart`：连接存活/不存活 × generation 变化/不变 | ✅ | S1-a..d（真实类）—— 提到守卫前的 `more.at(-1)` 与重排后的守卫所能取到的四种组合 |
| E-4 | **被改的测试 helper 调用点** —— 两处 `startImpl`（含合并 + 迟到 settle），并经真实 orchestrator 驱动，附变异对照 | ✅ | S3-a..d |

---

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|---|:--:|:--:|---|
| 等价性 oracle 是我本人构造的（pre-fix `while` 循环的转写；`length > 0` ≡ `at(-1) !== undefined` 的恒等式），而非**重跑修复前的二进制**。 | **LOW** | 否 | oracle 是照 `git diff --cached` 中**被删（`-`）行**与 `interaction-coordinator.ts:353-372` 实际读到的循环体转写的，属忠实复制；且 S2-a 保留判别断言（>0 个形状两 oracle 不一致），使「oracle 与实际语义错位却静默通过」不可能发生。 |
| 一切运行于 vitest + Node 24.3.0（`Array.prototype.at` 必然存在），并非真实 VS Code Electron 宿主。 | **LOW** | 否 | 双重缓解：探针在运行期断言 `typeof [].at === 'function'`；且 `.at(-1)` 在已发货 `src/` 中已有 10+ 处既有用法，若运行期不支持，产品早已在多处破产。 |
| 4 处修复前违规**未做原地复现**（oxlint 无 stdin；对照只能放进覆盖 glob，即需拷入产品相邻路径）。 | **LOW** | 否 | 已用「强制规则」非空跑对照等价替代（同 wrapper 同 config 下 `--deny no-magic-numbers` → 同 3 文件 3/9/1 条诊断），在不触碰工作区的前提下证明同一件事。 |

以上三项均非本 Phase 交付物内的缺陷，且均未超过 `LOW` —— 故判 PASS。

## 范围外维度与已登记债务

刻意与 §残余风险 分节：这些是真实事项，但**不可归因于本 Phase 交付物**，故不改变判决。

| 项 | 当前严重性 | 为何在范围外 |
|---|:--:|---|
| `apps/vscode-dsh` 6 条既有失败（`spike-t0a-replay-rebuild` 4 条 —— 经 `packages/core/agent-loop/src/index.ts:40` 的 `FiberState` undefined；`panel-close-delete.e2e` 1 条；`verifier-phase1/layer-a-rtl` 1 条；`spike-t0b-continue-capability` 0-test 套件级失败） | 作为仓库状态为 **MEDIUM** | 在本轮 A 轮与第 2 轮基线中**同时存在**，数量与身份未变（两轮同为 6 条 / 同 4 文件）。属既有、与主机诊断工作无关（agent-loop / 面板 / RTL chrome），且未被本轮改动推动 —— 既非本轮引入，也未被人为掩盖。因其不属本 Phase 所有权，故记于此而非 §残余风险。 |
| `review.md` 的 3 条 SHOULD-FIX（全部为 `implementation.md` §11 自述缺陷：§11.6 账目不可复现且自相矛盾、§11.7 范围声明与 §8.8 矛盾） | **LOW**（纯文档、零行为影响） | `review.md` 判决 SHOULD-FIX、无 MUST-FIX，其处置方式（登记为债 / 改文案）**由用户裁决**。我明确未让其改变判决。 |
| `DEBT-010`（握手后断线路径） | **LOW** | spec 明文排除并已登记于 `tech-debt-registry.md`；第 2 轮已按真实源码位置核验条目。 |
| 真机（Layer-V）诊断面取证 | 对本 Phase 为 **LOW** | `phase-plan.md:77` 已把 AC-11/AC-12/AC-23… 指派给 `phase-3-layer-v-smoke-loop`；spec 明确把真机取证推迟到该 Phase。 |

## 方法限制（如实记录）

1. **lint 正对照无法原地执行**（oxlint 无 stdin；`.specdev/**` 不落在任何覆盖 glob 内）。已用「强制规则」非空跑对照替代，详见 §证据细节。
2. **探针在仓库测试树之外**，每轮拷入/拷出；拷入件运行后立即删除，其 16 条**确实执行**由计数差方法证明（自报「16 passed」本身不构成证据）。
3. **基线器具是重建而非复用**：第 2 轮的 `/tmp` 留存（`/tmp/p2-baseline-*.txt`、`/tmp/p2r2-lint-norm.txt`）已被清理。因此我 (a) 自己重测了一份新的 A 轮基线，(b) 再与 `.cursor/skills/project-test/SKILL.md` 记录的恒定不变量（411 用例 / 6 红；无探针时 47 文件 / 404 passed）交叉核对。两者吻合 —— 失败集合与第 2 轮相同，计数也精确复现。
4. **语义在单元/集成层验证，未观测真实 VS Code 窗口。** 对非 UI Phase（其外部行为即诊断内容），第 2 轮的 AC 证据（记录字段级断言、真实子进程）是恰当器具；且这 4 处均为纯重构，另有本人真实类探针覆盖。
5. 按任务设定，**未从零重推 AC-13 – AC-22**：本轮对象是 ① 4 处修复的等价性、② 第 2 轮已验证端到端路径在改动后仍通过、③ 独立复核门槛事实。三类均已在上文逐条给出证据。

## Pipeline 合规检查

| 检查项 | 结果 |
|---|---|
| 分支 | ✅ `impl-phase-2-host-fail-loud-diagnostics` —— `git branch --show-current` 实测，与 `current_phase` 一致 |
| 产品改动是否都在 `impl-*` 分支 | ✅ `apps/` + `packages/` 下的暂存集合即 Phase 2 改动集，无分支外产品文件 |
| 验证者是否改过产品代码 | ✅ **否** —— 各轮运行后 `git diff --stat -- apps/ packages/` 为空；我仅新增本报告、其 `-zh` 副本与 `test-scripts/` 下的脚本 |
| 是否运行过任何 git 写/还原命令 | ✅ **无** —— 仅只读 `git branch/show/diff/status/log`。无 `add`、无 `commit`、无 `reset/checkout/clean/restore/stash` |
| 探针残留 | ✅ 无 —— `git status -s -- apps/vscode-dsh/tests/` 恰为预期 4 条 |
| 是否触碰 `current-status.json` | ✅ 否（状态推进是调度者职责） |
| 临时突变 | ✅ 未做 —— 全程未编辑任何产品文件，故无需还原 |

## 验证脚本

全部落盘于 `.specdev/specs/vscode-dsh-usable-loop/phases/phase-2-host-fail-loud-diagnostics/test-scripts/`：

| 脚本 | 用途 | 运行方式 |
|---|---|---|
| `verifier-ast-static-phase3.ts` | 对 3 个被改文件做 20 条静态 AST 校验（旧形态消失、新形态精确、方法不依赖 `this`、箭头括号中性） | `node_modules/.bin/tsx <脚本>` —— 原地运行，不触碰任何文件 |
| `verifier-independent-phase3.spec.ts` | 16 条行为探针（S1–S5）：orchestrator 重试尾部、coordinator 插入（188 个真实类形状 + 512 形态超集）、被改 helper 调用点含变异对照、AC-22 记录链、18 字段读取面与真实 `activate()` | 拷入 `apps/vscode-dsh/tests/` → `pnpm exec vitest run apps/vscode-dsh/tests/verifier-independent-phase3.spec.ts [--reporter=verbose]` → 删除 |
| `verifier-lint-control-phase3.ts` | 修复前形态的 lint 正对照，供后续轮次复用 | ⚠️ 必须**拷入覆盖 glob 内**（如 `scripts/`）再 lint —— 留在 `.specdev/` 下不落入任何规则范围，会恒读为干净（见该文件头部注释） |

复现本轮门槛证据：

```bash
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH   # 默认 PATH 的 v20.16.0 会以 `Failed to import module "unrun"` 报错，误导性极强
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness

# 门槛 1 —— 3 个被改文件的 staged lint（应为 exit 0）
node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern \
  apps/vscode-dsh/src/auto-start-orchestrator.ts \
  apps/vscode-dsh/src/interaction-coordinator.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts

# 门槛 1b —— 非空跑：同 wrapper/config/文件，强制打开一条规则（应得 3/9/1 条诊断，exit 1）
node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern \
  --deny no-magic-numbers \
  apps/vscode-dsh/src/auto-start-orchestrator.ts \
  apps/vscode-dsh/src/interaction-coordinator.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts

# 门槛 2 / 3 / 4 / 5
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false exec vitest run \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/host-diagnostics.spec.ts \
  apps/vscode-dsh/tests/session-host.spec.ts
pnpm --config.verify-deps-before-run=false run test apps/vscode-dsh                    # A 轮：411 用例、6 红
# B 轮：先把探针拷入 apps/vscode-dsh/tests/，再跑同一条命令 → 427 用例、6 红、+16 passed
```

## 给 HG-3 的结论

- 第 2 轮的 PASS 在本轮改动后**仍然成立**，本轮无任何事项推翻它。
- 无新增失败、无 AC 回归、我未触碰任何产品文件、无「先前绿、现在红」的门槛。
- `phase-plan.md:74` 实测 `ui: false` → 视觉验证不适用，无 `visual-blocking` 项。
- 唯一需要人来决策的是 `review.md` 的 3 条纯文档型 SHOULD-FIX（见 §范围外维度与已登记债务），处置权在用户。
