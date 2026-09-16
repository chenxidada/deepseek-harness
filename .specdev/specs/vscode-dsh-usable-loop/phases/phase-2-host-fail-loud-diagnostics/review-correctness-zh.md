# 实现正确性审查 — Phase 2（第 3 轮，增量：提交门禁的四处 lint 改写）

工作流：`vscode-dsh-usable-loop`
Phase：`phase-2-host-fail-loud-diagnostics`
分支：`impl-phase-2-host-fail-loud-diagnostics`
审查者：`reviewer-correctness`（仅实现正确性视角）

## 视角

**实现正确性** —— 代码是否真的能工作？

本次受命范围：**只审查为清掉仓库 `pre-commit` → `lint (staged)` 门禁而做的四处改写**（`auto-start-orchestrator.ts:242-243`、`interaction-coordinator.ts:357`，以及 `tests/auto-start-orchestrator.spec.ts` 的两处），外加同一 hook 的 `--fix` 施加的 7 行纯格式化。Phase 2 主体（18 字段诊断契约、listener、store、extension 接线）**已在第 2 轮收口**，本轮**不重新审判**（`verifier` 已独立 PASS）。本轮未在主体中发现新的严重问题。

启动自清理：**无产物需归档**。直接路径下没有 `review-correctness.md` / `-zh.md`（第 2 轮那对已在 `.archive/review-correctness-20260916T040334Z.md` / `-zh-…`）。故未执行任何 `mv`；未写任何非本人产物的文件；未运行任何改变 git 状态的命令。

本审查者自身记录的延续：第 2 轮 🟡-1（`DEBT-010` 出处引用成 `§8.9/§8.10`）**已修复** —— `tech-debt-registry.md:28` 现引 `§8.12`，并写明 §8.9/§8.10 实际是什么。第 2 轮 🟡-2 已被用户在 HG-3 裁定承接为 `DEBT-011`（承接为债，不回炉）。

## 判决：SHOULD-FIX

四处改写**均保持行为** —— 我逐处重新推导了等价性、复现了突变证据，且未发现任何消 lint 手段、未丢失任何断言、未新增任何失败。**MUST-FIX 为零**。判决不是 PASS，是因为仍有一处账目问题未闭环（§5.2，🟡-1）：§11.6 的整仓 lint 账目与它自己的表格矛盾、漏掉一行 `git diff` 里看得见的改动，且因基线产物已消失而无法再复现。这与本 Phase 已经两次裁定为 SHOULD-FIX 的同类 `implementation.md` 保真问题（第 2 轮 🟡-1/🟡-2 → `DEBT-011`/`DEBT-012`）属同一类，若此处降格为观察，就与已经施加于本 Phase 的标准不一致。它不阻塞：代码能工作、门禁确实变绿、该发现落在一段关于外围主张的章节里。

## 1. 四处改写 —— 独立等价性推导

### 1.1 #1 —— `auto-start-orchestrator.ts:242-243`（`no-non-null-assertion`）

```242:247:apps/vscode-dsh/src/auto-start-orchestrator.ts
        const next = more.at(-1)
        if (next !== undefined && !this.port.isConnected() && generation === this.generation) {
          this.startInFlight = undefined
          await this.runStart(next)
          return
        }
```

**等价性所依赖的前提。** `more.at(-1) !== undefined` ⟺ `more.length > 0` **只在**（a）`more` 是稠密 JS 数组、（b）无任何元素字面为 `undefined` 时成立。本代码两条都成立：

| 事实 | 证据 |
|---|---|
| `more` 是新建的稠密数组 | `const more = this.pending.splice(0)`（`:240`），`splice` 返回新稠密数组 |
| 元素类型排除 `undefined` | `private pending: StartReason[] = []`（`:103`）；`StartReason` 是 7 成员字符串联合，无 `undefined` 成员（`:8-15`） |
| 无任何写入点能塞入 `undefined` | `this.pending` 的全部 4 处访问为：`getSnapshot` 的展开读（`:135`）、`push(reason)` 且 `reason: StartReason`（`:161`）、`this.pending.length = 0`（`:198`）、`splice(0)`（`:240`） |

**反例情形（写明前提，避免让人凭信心接受）：** 若可能存在稀疏数组或 `undefined` 元素，两种写法**就会**分叉 —— 旧守卫（`more.length > 0`）会进入分支并调用 `runStart(undefined)`，新守卫则落到 else。该分叉不可达（那条分支本身就是个 bug），而在两者可能不同的地方，新写法是更安全的一边。因此 `next === undefined` 的落空分支是**可达的**（空 `pending`，即最常见情形）—— 是真实收窄，不是死分支。`tsc` 也接受：`next` 在 `runStart(next)` 处收窄为 `StartReason`，由 `pnpm run typecheck` exit 0 佐证。

**求值顺序变化不可观察。** `more.at(-1)` 被提到 `this.port.isConnected()` 之前。`at()` 是对本地数组的零副作用读取，而该数组已被 `splice(0)` 从 `this.pending` 摘出，因此 `StartHostPort` 实现在 `isConnected()` 里做任何事都无法改变 `more` 或 `next`。逐项核对：

| 关注点 | 结论 |
|---|---|
| `this.notify()` 时序 | 未变 —— 两个版本都在 `:241`、守卫之前 |
| 短路求值 | `next !== undefined` 在 `isConnected()` 被咨询之前就已判定，与 `more.length > 0` 完全一致 |
| `startInFlight` 复位路径 | 未变：`:237`（代次不符，提前 return）、`:244`（守卫为真，在递归 `runStart` 之前）、`:248`（落空分支） |
| 三条出口 | 均与之前一样可达 —— `:238`、`:246`，以及 `finally` 末尾的隐式返回 |
| 每轮多一次读取 | 现在即使后面的合取项本可短路也会计算 `next`；纯读取，无可观察影响 |

### 1.2 #2 —— `interaction-coordinator.ts:357`（`no-non-null-assertion`）

```353:369:apps/vscode-dsh/src/interaction-coordinator.ts
  private enqueue(entry: QueueEntry): void {
    if (this.activeSessionId !== undefined && entry.sessionId === this.activeSessionId) {
      // Soft priority: insert at front of waiting queue, same-Tab FIFO.
      let insertAt = 0
      for (const current of this.queue) {
        if (current.state === 'presented') {
          insertAt += 1
          continue
        }
        if (current.sessionId === entry.sessionId && current.state === 'pending') {
          insertAt += 1
          continue
        }
        break
      }
      this.queue.splice(insertAt, 0, entry)
      return
    }
    this.queue.push(entry)
  }
```

`insertAt` 同时充当循环下标，从 0 起、每次恰 +1（`:359`、`:363`），因此旧的 `while (insertAt < this.queue.length)` 读取 `this.queue[insertAt]` 的下标序列与顺序，与 `for…of` 逐个产出的一致。

**「迭代期间队列被变更」这类分叉在此不可能发生** —— 我是读循环体确认的，不是假设：`:357-367` 只有 `insertAt += 1`、`continue`、`break`。`splice` 在 `:368`，**在循环之后**。循环体内没有别的东西碰 `this.queue`。

各路径的终值 —— 两种写法完全一致：

| 路径 | 旧 `insertAt` | 新 `insertAt` | 结果调用 |
|---|:--:|:--:|---|
| 首个元素即不匹配而 `break`（`i = 0`） | 0 | 0 | `splice(0, 0, entry)` = 插到最前 |
| 匹配 `k` 个后 `break` | `k` | `k` | `splice(k, 0, entry)` |
| 全部元素都匹配 | `queue.length` | `queue.length`（每元素一次迭代） | `splice(length, 0, entry)` = 追加到末尾 |
| 空队列 | 0（从未进入循环） | 0（零次迭代） | 插到最前 |

`break` / `continue` 在 `for…of` 中语义不变。`this.queue` 是 `private readonly queue: QueueEntry[] = []`（`:117`）—— **普通数据字段，不是 getter** —— 因此 `for…of` 只捕获一次数组引用，与 `while` 每轮重读的是同一个对象。去掉 `!` 不影响 `QueueEntry` 联合（`:110`）；`current.state` / `current.sessionId` 的收窄仍能通过类型检查。

附带的一处健壮性增益（非行为改变）：`for…of` 不可能死循环，而旧 `while` 在未来有人加了 `continue` 却忘了自增时会挂死。

### 1.3 #3 / #4 —— `tests/auto-start-orchestrator.spec.ts:52-56`、`:93-97`（`eslint(prefer-const)`）

```17:38:apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts
function mockPort(overrides?: Partial<StartHostPort> & {
  connected?: boolean
  startImpl?: (reason: StartReason) => Promise<void>
}): StartHostPort & { startCalls: StartReason[]; setConnected(v: boolean): void } {
  let connected = overrides?.connected ?? false
  const startCalls: StartReason[] = []
  const port: StartHostPort & { startCalls: StartReason[]; setConnected(v: boolean): void } = {
    startCalls,
    setConnected(v) { connected = v },
    isConnected: () => connected,
```

**`.bind(port)` 是空操作。** `setConnected` 是方法简写且**从不读 `this`**（`:25`）—— 它改的是 `mockPort` 闭包里的 `connected` 局部量（`:21`）。因此旧绑定下的 `setConnected(true)` 与 `port.setConnected(true)` 是同一次调用；连现在变得非平凡的 `this === port` 绑定也与可观察效果无关。

**无 TDZ。** 闭包 `async startImpl() { await started; port.setConnected(true) }` 只在 `startImpl` 被调用时读 `port`。`mockPort`（`:17-38`）只是**存下** `overrides.startImpl`，真正调用它是在 `port.start` 内部（`:28-35`）—— 构造期从不执行它。首个 `orch.request(...)`（`:60`、`:101`）发生在 `const port = mockPort(...)` 完成之后。这是延迟读取，§11.3 的说法成立。

**异步时序未变** —— 两版都是 `await started` / `await gate` 之后 `setConnected(true)`。

## 2. 是否使用了「消 lint」手段？

**没有。** 三个文件里各抑制家族一律不存在：

```text
$ grep -nE "eslint-disable|oxlint-disable|ts-expect-error|ts-ignore|as any|: any|@ts-" <3 文件>
（无输出；exit 1）
$ grep -nE "[A-Za-z0-9_\)\]]!" <3 文件>
（无输出；exit 1）
```

无 `eslint-disable` / `oxlint-disable`、无 `@ts-expect-error` / `@ts-ignore`、无 `any`，且三个文件中**未残留任何变体的非空断言**。四处都是真改写，与任务前提一致。

## 3. 测试覆盖是否被削弱？

**没有**，分三层：

1. **没有被禁用或删除的用例。** 对受影响 spec 与源码 `grep -nE "\.skip|\.only|it\.todo|xit\(|xdescribe\("` → 无命中（exit 1）。spec 文件相对 `HEAD` 的 diff 恰为三个 hunk 加两个新增 `it()`；被改的两个用例只丢了前向声明与其事后赋值 —— **两个用例的全部断言都保留**（全文件 11 个 `it()` / 34 个 `expect(`）。
2. **被改写的 `enqueue` 分支有真实行为覆盖** —— 并非仅靠推理作证。`tests/phase2-multitab-history-replay.spec.ts:106-171`（「AD-CU-7 serial soft-priority queue (AC-20/58)」）调用 `setRegistry` + `onActiveSessionChange(active.sessionId)`（`:132-133`），随后在已有条目处于 `presented` 时为一个**活跃** session 入队（`:144-148`）—— 这正是 `current.state === 'presented' → insertAt += 1` 分支加随之而来的 `splice(insertAt, 0, entry)` 下标，`:`151-152` 与 `:161-162` 间接断言了顺序。该用例在改写后的循环上**通过**（§6）。`break` 在最前的那个分支我没找到任何用例覆盖，但其语义未变。
3. **#1 的改写守卫有覆盖** —— `auto-start-orchestrator.spec.ts` 既有的合并 / 重试用例同时走到 `next !== undefined` 的重入分支与落空分支（11/11 通过）。

## 4. 突变证据 —— 独立复现

§11.5 的主张是：还原 #2 后门禁会在**与提交 hook 报告相同的位置**报错，从而证明门禁确实在看那一行，而不是悄悄停止了扫描该文件。我在原位复现，并做了哈希校验的立即还原：

```text
$ md5sum apps/vscode-dsh/src/interaction-coordinator.ts
db53f8bbc38accd4d7e0ce049d1888e8  apps/vscode-dsh/src/interaction-coordinator.ts
### MUTATED（for (const current of this.queue) → while (insertAt < this.queue.length) + this.queue[insertAt]!）###
$ node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern \
    apps/vscode-dsh/src/auto-start-orchestrator.ts apps/vscode-dsh/src/interaction-coordinator.ts \
    apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts
apps/vscode-dsh/src/interaction-coordinator.ts:358:25: error typescript(no-non-null-assertion): Forbidden non-null assertion.
MUTANT_LINT_EXIT=1
### RESTORED ###
$ md5sum apps/vscode-dsh/src/interaction-coordinator.ts /tmp/p2r3-mut/coord-backup.ts   # 工作树未变
db53f8bbc38accd4d7e0ce049d1888e8  apps/vscode-dsh/src/interaction-coordinator.ts
db53f8bbc38accd4d7e0ce049d1888e8  /tmp/p2r3-mut/coord-backup.ts
$ <同样的 staged lint，3 个文件>
POST_RESTORE_LINT_EXIT=0
```

**结果与 §11.5 逐字一致：`358:25`，exit 1** —— 门禁确实看得见这一行。仓库工作树与突变前逐字节相同（md5 相同；对备份 `diff` 无差异；`git diff HEAD` 中不残留 `while (insertAt…` / `this.queue[insertAt]`；仓库内未留下任何审查产物）。

我也独立核对了 §11 的**前提** —— 这四处违规是既存的、不是 Phase 2 产物 —— 直接对着 `HEAD`：

```text
$ git show HEAD:apps/vscode-dsh/src/auto-start-orchestrator.ts  | grep -n "more.length - 1]!"   → 236:
$ git show HEAD:apps/vscode-dsh/src/interaction-coordinator.ts  | grep -n "this.queue\[insertAt\]!" → 328:
$ git show HEAD:apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts | grep -n "let setConnected!" → 53:, 96:   （2 处）
```

这正是 §11 前言所断言的 `1 / 1 / 2`。因此 §11 的「棘轮」说法成立：hook 之所以暴露这些违规，仅因为变更集动了这三个文件。

## 5. §11 自述与代码实际

### 5.1 已核实一致

| §11 主张 | 独立核对 |
|---|---|
| §11.1 的「Before」列与 `HEAD` 相符 | 四处均以 `git show HEAD:` grep 确认 |
| §11.2 `noUncheckedIndexedAccess: true` 使裸去 `!` 不通过；`const x!: T` 需带初始化器；未用抑制；无残留 `!` | 由 `tsconfig.base.json` 行为（typecheck）+ §2 的 grep 确认 |
| §11.3 三条等价性论证 | 已在 §1 独立重推；三条均成立，含 `insertAt` 终值的穷举 |
| §11.4 `lint (staged)` → exit 0、无输出 | 已复现（§6） |
| §11.4 `pnpm run typecheck` → exit 0 | 已复现（§6） |
| §11.4 4 个 spec 文件 / 66 用例通过 | 逐字复现，66/66（§6） |
| §11.4 `pnpm run test apps/vscode-dsh` → 6 failed / 404 passed / 1 skipped (411)，同样 6 条 | 逐字复现，同样 6 条用例名（§6） |
| §11.5 `358:25` 突变 | 逐字复现（§4） |
| §11.6 两条**新增**条目是 verifier 探针自身的 unused directive | 已确认：`.specdev/…/verifier-independent-phase2.spec.ts:220` 与 `:490` 是 `// eslint-disable-next-line @typescript-eslint/no-explicit-any`，被本 profile 判为未使用；两者都在 `test-scripts/` 探针里，不是产品代码 |
| §11.6 「`pnpm run lint` 前后都是红的」 | 已确认，`LINT_EXIT=1` |
| §11.6 「无文件新增诊断」（实质主张） | 对三个被改文件而言**为真** —— 见 5.2 |
| §11.7 「未创建也未消解任何 `@STUB`」 | 已确认 —— 三文件 `grep @STUB` 无命中 |

### 5.2 🟡-1 —— §11.6 的账目自相矛盾、漏掉一行可见改动、且已无法复现

这是唯一未闭环的发现。同一节里有四个可分离的缺陷：

**（a）标题与表格矛盾。** 「Removed — 7 entries, every one a removal」之下五行合计为 **1 + 1 + 2 + 2 + 3 = 9**。数字 7 是 hook 的 `--fix` 施加的*格式化行*数；标题似乎借用了它，却套用到整张表上。

**（b）`git diff` 里看得见的一行被漏掉。** 同一次 `--fix` 还改了 `tests/auto-start-orchestrator.spec.ts` 的两处 `@stylistic(arrow-parens)`：

```text
$ git show HEAD:apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts | grep -nE "new Promise<void>\(r =>"
52:    const started = new Promise<void>(r => { resolveStart = r })
95:    const gate = new Promise<void>(r => { resolveStart = r })
```

表里把 2 条 arrow-parens 移除记在 `interaction-coordinator.ts`（`new Promise((resolve) => {` 那两处），却**一条也没记在 spec 文件**上。补上这行后，格式化移除为 2 + 2 + 3 = 7 —— 恰是标题引用的数字，进一步说明标题本意是格式化计数。

**（c）归一化总数对不上，且产物已消失。** 以 `.cursor/skills/project-test/SKILL.md` 记录的口径对新跑的整仓 lint 归一化，得 **887** 个去重后的 `file|severity|rule` 键（原始诊断实例 10373 条）。§11.6 的算术隐含 886（891 − 7 + 2）；按其表格自身的和则应 884（891 − 9 + 2）。基线 `/tmp/lint-base-norm.txt`、第 2 轮输出 `/tmp/p2r2-lint-norm.txt` 以及 §11.3 的差分脚本 `/tmp/p2r2-equivalence.ts` **均已不存在**，因此差值无法归因。（仓库自身记录也不一致：`project-build` 说基线 890 个 `(rule,file)` 组合，`project-test` / §11.4 说 891 条。）

**（d）括号内的枚举不完整。** §11.6 写「`interaction-coordinator.ts` keeps its 5 `no-unnecessary-condition` entries, `auto-start-orchestrator.ts` and the spec keep 0」。该文件实际有 **6** 条：

```text
$ grep -E "^apps/vscode-dsh/src/interaction-coordinator\.ts:" <整仓 lint>
…:423:13: typescript(no-unnecessary-condition)  …:441:62: typescript(no-confusing-void-expression)
…:450:15  …:454:13  …:475:13  …:478:13: typescript(no-unnecessary-condition)
```

我核对了第 6 条也是**既存**的，因此 §11.6 的实质主张仍站得住：被标记的表达式 `() => resolve('unavailable')`（`:441:62`）同样位于 `HEAD:412` 且文本一致，本轮 `--fix` 只动了它**上一行**。`auto-start-orchestrator.ts` 与 spec 文件确有 0 条，与所述一致。所以：**「无文件新增诊断」为真**；作为其证据的枚举不完整，而按报告去 grep 该文件的审计者会看到 6 条而非 5 条，且无从判断第 6 条是否新增。

**为什么这是 SHOULD-FIX 而非观察。** 它正落在本 Phase 已裁定过两次的同一类上：第 2 轮 🟡-1（`DEBT-010` 引错章节）与 🟡-2（§9 自检失准）—— 两者都是 `implementation.md` / registry 保真问题，用户选择承接为债而非忽略。失效模式完全相同：按报告给出的证据去追，落到的位置与实际不符，核查能力随之丧失。此处没有任何正确性缺陷，也不触及四处改写。一行级修法：把标题改成 9（或改成「7 条格式化 + 4 条门禁 error」）、补上 spec 文件的 `@stylistic(arrow-parens) | 2` 行、点名 coordinator 的第 6 条、并在下轮要么把基线产物复制进 phase 目录，要么把账目写成「当前绝对计数」而不是对一个不会存活的 `/tmp` 文件做差量。

## 6. 独立复跑证据（命令与结果）

所有 Node/pnpm 调用均前置 `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`；pnpm 命令加 `--config.verify-deps-before-run=false`。

| # | 命令 | 结果 |
|---|---|---|
| 1 | `tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern <3 文件>` | **exit 0，无任何输出**（突变还原后复跑：exit 0） |
| 2 | `pnpm run typecheck` | **exit 0** |
| 3 | `pnpm exec vitest run auto-start-orchestrator.spec.ts interaction-fail-closed.integration.spec.ts gap-005-009-debt-fix.spec.ts host-diagnostics.spec.ts` | **4 文件 / 66 用例通过**，exit 0 |
| 4 | `pnpm exec vitest run phase2-multitab-history-replay.spec.ts interaction-fail-closed.e2e.spec.ts` | **2 文件 / 10 用例通过**，exit 0 —— 覆盖被改写 `enqueue` 循环的软优先用例，外加一条端到端 Host/UI 路径 |
| 5 | `pnpm run test apps/vscode-dsh` | `Test Files 4 failed \| 47 passed (51)`；`Tests 6 failed \| 404 passed \| 1 skipped (411)`；exit 1。失败集合 = `panel-close-delete.e2e` VP-1-close/delete、`spike-t0a-replay-rebuild` ×4（AC-30/47、AC-76、AC-77、AC-80）、`spike-t0b-continue-capability`（0 test）、`verifier-phase1/layer-a-rtl` V-A4 —— **恰为 `project-test` 与我第 2 轮 §4 记录的 6 条基线**。无新增失败。 |
| 6 | `pnpm run lint`（整仓） | exit 1（与记录一致，前后皆红）；1411332 字节；归一化后 887 个去重键 / 10373 条原始实例 |
| 7 | #2 的突变 + 还原 | 突变下 `358:25` exit 1；还原后 `exit 0`；前后 md5 相同 |
| 8 | 对被改文件 `git diff HEAD --stat` | `auto-start-orchestrator.ts` 在被守卫的块内 2 行改动；`interaction-coordinator.ts` +37 −8（本轮）—— 与 §11.1 一致 |

关于基线的说明：本机 `/tmp/p2-baseline-vscode-dsh.txt` 与 `/tmp/p2-baseline-lint.txt` **已不存在**，因此第 5 行的失败集合比对是拿 `project-test` 与我第 2 轮报告里记录的 6 条用例名做的，而我的运行逐条复现了它们。

## 7. 桩代码检测

### 已登记债务（不重复上报）

registry 活跃表恰 6 条（`tech-debt-registry.md:26-31`），全部 🟡非阻塞：`DEBT-004`、`DEBT-009`、`DEBT-010`、`DEBT-011`、`DEBT-012`、`DEBT-013`。其中没有任何一条由四处改写创建或触及；§11.7 的「不新增条目」与 registry diff 一致（Phase 2 的四条是在 HG-3 裁定时加入的，不是 lint 轮加入的）。

### 新发现的未登记桩

**无。** 对三个被改文件 `grep -n "@STUB"` 无命中（exit 1）。四处改写都是对既有行的保行为改写，没有引入任何占位。

## 8. 关键发现

### 🔴 Must-Fix

**无。** 四处改写与各自原形语义等价；不涉及任何验收标准；未使用抑制手段；未丢失任何断言；不存在未登记的桩。

### 🟡 Should-Fix

- **🟡-1 §11.6 的整仓 lint 账目与它自己的表格不符，且已不可复现。**（a）标题「Removed — 7 entries」之下各行合计为 9。（b）表里漏掉 spec 文件的两处 `@stylistic(arrow-parens)` 移除，而它们在 `git diff` 里看得见（`HEAD:52`、`HEAD:95` → 当前 `:52`、`:93`），补上后格式化移除正好是标题引用的 7。（c）按记录口径对新一次运行归一化得 887 个去重键，而隐含值为 886（按标题）或 884（按表格之和）；基线与差分脚本均已消失，差值无法归因。（d）括号里写「它的 5 条 `no-unnecessary-condition`」，而该文件实有 6 条 —— 第 6 条 `typescript(no-confusing-void-expression)`（`:441:62`）同样既存（其表达式在 `HEAD:412`，未改动），故实质主张「无文件新增诊断」成立，但作为证据的枚举与该文件不符。四个子项都属于一段外围主张章节里的措辞/产物卫生问题；没有一项是正确性缺陷，也没有一项触及四处改写。

### 🟢 观察

- **🟢-1 #2 严格减少了一类隐患。** 旧的 `while (insertAt < this.queue.length)` 若未来有人在加了 `continue` 后忘了 `insertAt += 1`，会永久挂死；`for…of` 不会。因此这次改写除保等价之外还有小的健壮性增益 —— 值得独立于 lint 门禁保留。
- **🟢-2 #1 的等价性有一个应当落纸的前提，而 §11.3 表述得偏松。** §11.3 说「`at(-1)` 恰在 `more` 为空时为 `undefined`」。这对稠密数组成立；一般形式应是「`at(-1) !== undefined` ⟺ 非空**且**末元素不是 `undefined`」。该前提在此成立（见 §1.1），且 §11.2 提供了 `noUncheckedIndexedAccess` 的上下文，因此实践上不会误导读者 —— 但该守卫的正确性确实依赖于「`StartReason` 永不接纳 `undefined`」这一**类型层**的事实，而非 `at()` 本身的属性。
- **🟢-3 提交门禁可证为活的，四处修复可证为承重。** §4 的突变排除了会让 §11 循环论证的失效模式（「exit 0 是因为文件被静默跳过」）：一旦还原违规形态，同一条调用、同一份配置、同一批文件立刻报出 `358:25`。再加上 `HEAD` grep 证明四处违规本就存在，本轮的全部理由都获得了独立支撑。
- **🟢-4 流程提示（非代码发现）。** `/tmp` 是本 Phase 的证据载体（`lint-base-norm.txt`、`p2r2-lint-norm.txt`、各基线、差分脚本），而它跨轮不存活 —— 这正是 §11.6 现在无法审计的原因。未来任何依赖 `/tmp` 产物支撑的主张，要么把它复制进 phase 目录，要么把主张改写成「当前绝对测量值」。
- **🟢-5 本轮没动别的东西。** 归属本轮的仓库改动只有 `implementation.md` §11；`extension.ts` / 两个源文件里的 7 行格式化是 hook `--fix` 的产物，且被保留而非回退（`-w` diff 恰好隔离出 `extension.ts` 的 3 对纯空白增删；arrow-parens 两处为非空白改动，计数 2 + 2）。无 `@STUB`、无测试文件删除、无 `.skip`。

## 9. 方法与限制说明

- **我通过执行验证了什么：** staged lint 门禁、typecheck、四个定向 spec、覆盖被改写 `enqueue` 的软优先行为用例、一条端到端路径、`apps/vscode-dsh` 全量套件、整仓 lint，以及带哈希校验还原的 #2 突变。上文标注「已复现」的每一项都是我在当前工作树上重跑得到的。
- **三个突变探针被工具策略拒绝**（一个基于 `/tmp` 的对照探针，以及 #1 + #3/#4 的合并还原）。我**没有**升级申请，因为 #2 的突变已经回答了它们本要回答的问题（「门禁是否真在扫描这些文件？」），且在工作区含不相关未提交改动的情况下，每多一次写入都自带风险。后果：对 `auto-start-orchestrator.ts` 与 spec 文件，我证明门禁为活只能靠**推断** —— 与已证为活那次相同的调用、配置与文件列表，加上 `HEAD` grep 显示修复前构造确在 §11.4 所报位置。这两个文件的直接突变证据未取得。
- **我没有重跑：** §11.6 相对其自身基线的整仓差量（基线文件已消失；见 §5.2(c)）。我跑了整仓 lint 并做了归一化，且直接枚举了三个被改文件的条目集 —— 这正是让 §11.6 的实质部分得以脱离基线核查的原因。
- **按指示排除、并已遵守：** Phase 2 主体（诊断契约、listener、store、extension 接线）未重新审判。本轮未在主体中发现新的严重问题。
- **独立性：** 本文没有一处发现取自 `implementation.md`、其他 reviewer 的报告或 verifier 的报告；§5 是我自己对代码的阅读，§5.1 的表格逐条标出 §11 的每项主张是「已复现」还是「未复现」。
- **交接时的工作树状态：** 与我接手时逐字节相同（coordinator 的 md5 前后均为 `db53f8bbc38accd4d7e0ce049d1888e8`）；我未突变的两个文件从未被写入（因其命令在执行前即被拦截，备份从未创建）；仓库内未留下任何审查产物；全程未执行 `git add` / `git commit` / reset / checkout / stash / clean。
