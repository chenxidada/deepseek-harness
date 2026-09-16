# 连通性审查 — Phase 2（`phase-2-host-fail-loud-diagnostics`）

## 视角

**集成连通性（Integration Connectivity）** — 模块之间是否真正连通。本报告只追踪端到端数据路径、上下游连接与跨模块契约，不评判实现正确性（属 `reviewer-correctness`）、设计选择（属 `reviewer-design`）或外观（属 `reviewer-visual`）。

**第 3 轮范围：为通过仓库自带 `pre-commit` 门禁（`lefthook` 的 `lint (staged)`）所做的 4 处改写，以及同一次 `--fix` 已施加的 7 行格式化。**

| # | 位置（修复后） | 清掉的规则 | 改动 |
|---|---|---|---|
| 1 | `apps/vscode-dsh/src/auto-start-orchestrator.ts:242-243` | `typescript(no-non-null-assertion)` | `const next = more.at(-1)` 提到守卫前；守卫改为 `next !== undefined && …` |
| 2 | `apps/vscode-dsh/src/interaction-coordinator.ts:357` | `typescript(no-non-null-assertion)` | `while (insertAt < …) { const current = this.queue[insertAt]! … }` → `for (const current of this.queue) { … }` |
| 3 | `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:52,56` | `eslint(prefer-const)` | 删前向声明 `let setConnected!` 与 `.bind(port)`；`startImpl` 直接调 `port.setConnected(true)` |
| 4 | 同上 `:93,97` | `eslint(prefer-const)` | 同 #3 |
| — | `extension.ts` ×3 `@stylistic(indent)`、`interaction-coordinator.ts` ×2 `@stylistic(arrow-parens)`、`auto-start-orchestrator.ts` ×2 `@stylistic(arrow-parens)` | `--fix` 已在工作区 | 7 行格式化，原样保留 |

**按指令排除、且下文不复审：** Phase 2 主体（诊断记录面、`createStartFailureListener`、`dsh.test.getDiagnosticsText` 投影、extension 接线、`invalid-setting` → `other` 兜底）已在第 2 轮审查并收口；握手后死亡的残余缺口（C-2）已裁定并登记为 `DEBT-010`。两者均不在下文重开。

## 判决：PASS

4 处改写对连通性均无影响。两个被改写守卫的**每一条出口都仍然可达，且都在运行期被走到** —— 包括被「提升」触及的那条分支：合并重试的递归（`next !== undefined && !isConnected() && generation === this.generation`）经真实 `AutoStartOrchestrator` 被实际走到；`retryOfSeq` 成对性（AC-22）在「落到函数尾」与「递归」两条路径上仍产出成对记录。`enqueue` 扫描的唯一产物 `insertAt`（被下一行 `splice` 消费）在我穷举的 **4 681** 种队列形态上**逐一相同**（含 `break` 提前退出、全 `presented`、空队列）。没有任何「消 lint」手段被使用，没有引入新的「无生产者」快照或死分支，Phase 3 的读取面（`dsh.test.getDiagnosticsText` → `HostDiagnosticRecord[]`）未被触及，且仍经已注册命令实测为绿。

---

## 4 处改写逐一裁定

| # | 所问的连通性问题 | 裁定 | 依据 |
|---|---|:--:|---|
| 1 | 提升是否改变了 `this.notify()` 与 `startInFlight` 复位路径的可观察顺序？所有出口是否仍可达？ | ✅ 等价 | `more.at(-1)` 只是对一个由 `splice(0)` 新产出的数组的纯读取，任何 listener 都够不到它；`:241` 的 `notify()` 与两处复位（`:244`、`:248`）位置不变。探针 B：24 组守卫输入，**结果与 `isConnected()` 调用次数双双 0 处不一致** |
| 1 | `generation !== this.generation` 早退（`:236-239`）与新增的 `next === undefined` 分支相互作用，是否会让重试记录不再成对？ | ✅ 不会 | 早退分支逐字未变、且发生在尾部之前；`next === undefined` 分支的落尾体（`startInFlight = undefined; notify()`）正是旧的 `more.length === 0` 短路体。探针 C2：连续三次失败 → **3 条记录，每条重试的 `retryOfSeq` 都指向开链条** |
| 2 | `insertAt` 的终值在所有路径上是否不变（`break` / 全 `presented` / 空队列）？ | ✅ 等价 | 探针 A：**4 681 种队列形态，0 处不一致**，另对「全 `presented`」「全同会话 `pending`」显式断言 `tail = length`。数组的 `for…of` 每步重读 `length`，`break`/`continue` 与 `while` 形式一一对应；循环体不改 `this.queue`（`splice` 在循环之后） |
| 3/#4 | 删掉前向声明与 `.bind(port)` 是否破坏了 mock 的连接翻转？ | ✅ 连通 | `mockPort` 的 `setConnected(v) { connected = v }` 闭包引用的是 helper 内的局部 `connected`、从不读 `this`（`tests/auto-start-orchestrator.spec.ts:21-26`），故 `.bind(port)` 本就无效。`mockPort` 只在 `start()` 内调 `startImpl`（`:28-33`），即 `const port` 初始化之后，自引用是延后读取，不可能触发 TDZ。两条改写用例通过，**且**合并用例的 `getStartState() === 'started'` 断言只有在 `setConnected(true)` 真的生效时才成立 |
| — | 是否用了消 lint 手段（`eslint-disable` / `oxlint-disable` / `@ts-expect-error` / `@ts-ignore` / `as any`）？ | ✅ 没有 | 对三个文件 `rg` 上述五种模式 → **无匹配**；亦无残留非空断言（`\)!`、`\]!`、`!.`、`as any`、`as unknown as` → 无匹配） |

---

## 端到端路径追踪

探针是一次性的（`/tmp/p2r3-probe.mts`，刻意**不**入仓测试树），驱动的是**真实产品类** —— `AutoStartOrchestrator` + `createStartFailureListener` + `HostDiagnosticRecorder`，而非它们的复刻。

### 路径 A —— 无排队项的失败启动 → `next === undefined` 臂（提升后的新臂）

```
入口：orch.request('command-start')                      auto-start-orchestrator.ts:152
  → runStart('command-start')                            :205
    → :207 state = 'starting' → :210 notify()            ✅  listener 看到 'starting'（记录器守卫重新武装）
    → :220 await this.port.start('command-start')        ✅  port 抛 {kind:'missing-credentials'}
    → :232-234 state = 'failed'，errorKind/errorMessage  ✅
    → finally :236 generation 未变 → :240 more = pending.splice(0) === []   ✅
      → :241 notify()                                    ✅  listener 记 #1（phase 'start'）
      → :242 const next = more.at(-1) === undefined      ← 被提升的读取
      → :243 next !== undefined 为 FALSE → 短路          ✅  isConnected() 未被调用（与旧写法一致）
      → :248 startInFlight = undefined; :249 notify()     ✅  同一份 snapshot → 签名守卫抑制第二条
出口：1 条记录 {kind:'missing-credentials', phase:'start', retryOfSeq:null}   ✅
      notify 序列：starting -> failed -> failed
```

**判定**：✅ 连通。空 `more` 走到落尾、且只记一条 —— 这正是 AC-22 后续搭链的起点状态。

### 路径 B —— 首次尝试在飞时并入第二个 reason → 递归臂

```
入口：request('command-start')，在飞时再 request('command-send')
  → :160-164 state = 'pending-start'，pending.push('command-send')，notify()   ✅
  → 在飞的那次尝试失败                                                            ✅
  → finally :240 more = pending.splice(0) === ['command-send']                  ✅
    → :241 notify() → listener 记 #1（phase 'start'）                             ✅
    → :242 next = 'command-send'（=== 旧写法 more[more.length - 1]）               ✅
    → :243 next !== undefined ✅ && !isConnected() ✅ && generation 未变 ✅ → 递归
      → :244 startInFlight = undefined
      → :245 await this.runStart('command-send')                                   ✅ 同一入口
        → :207 'starting' → :210 notify → listener 重新武装                         ✅
        → 排队的那次失败 → :241 notify → listener 记 #2（phase 'retry'）            ✅
出口：startCalls === ['command-start','command-send']；2 条记录，recs[1].retryOfSeq === recs[0].seq
      notify 序列：starting -> pending-start -> failed -> starting -> failed -> failed   ✅
```

**判定**：✅ 连通 —— 这正是改写 #1 触及的那条臂，也正是第 2 轮报告 Path 4 所覆盖的同一条臂。我的运行观察到了成对记录，以及递归携带的 reason。

### 路径 C —— 经真实扩展命令的重试成对（AC-22）

```
入口：编排器自行拒绝所产出的失败态
  → dsh.test.setCredentialPresence(false) → dsh.test.requestStart('command-start')  ✅ 真实命令
    → orchestrator → listener → recorder → records() = 1 条开链（phase 'start'）     ✅
  → dsh.statusBarAction（可点击的重试入口）                                           ✅ 真实命令
    → request('manual-retry') → runStart → 同一个 StartHostPort                        ✅ 同一路径
    → listener 记 #2（phase 'retry'，retryOfSeq = 开链条 seq）                          ✅ 成对
出口：records() = 2，成对且严格递增                                                     ✅
```

**判定**：✅ 连通。运行期证据来自我按名筛跑的扩展级用例（`host-diagnostics.spec.ts:1117`「AC-22: a retry after a pre-Host refusal adds a paired record」）与合并重试用例（`:616`「re-arms on a queued retry」），各自 `1 passed`；同一条链在我仅用产品类的路径 B 探针上也通关。

---

## 上下游连接检查

| 被改写的面 | 上游（谁调用） | 连接 | 下游（消费什么） | 连接 |
|---|---|:--:|---|:--:|
| `runStart` 的 `finally` 尾部（`auto-start-orchestrator.ts:240-249`） | `runStart`（`:205`），由 `request`（`:168`）、`onUnexpectedDisconnect`（`:187`）以及 `:245` 的递归进入 | ✅ 入口集合未变 | `this.notify()`（`:241`、`:249`）→ extension `onChange`（`extension.ts:449-453`）→ UI 投影 + `createStartFailureListener` | ✅ |
| `more.at(-1)`（`:242`） | 尾部，无条件 | ✅ | `:245` 的递归调用收到被 splice 出的最后一个 reason | ✅（探针 B/C3） |
| `next !== undefined`（`:243`） | 尾部 | ✅ 双向可达 | 与旧的 `more.length > 0` 一样短路 `isConnected()` | ✅（探针 B 调用次数） |
| `enqueue` 的扫描（`interaction-coordinator.ts:357-367`） | `enqueue` 的调用方（`handleApproval` / `handleQuestions` 路径） | ✅ 未变 | `this.queue.splice(insertAt, 0, entry)`（`:368`），再经 `pump` / `pickNext` / `listPending` | ✅（探针 A 穷举） |
| spec 里的 `port.setConnected(true)`（`:56`、`:97`） | `startImpl` 覆盖体，由 `mockPort.start` 调用 | ✅ | `isConnected: () => connected`（`:26`）→ 编排器的 `:222` / `:243` 读取 | ✅（用例为绿） |

## 跨模块契约验证

| 边界 | 调用方期望 | 被调用方提供 | 一致 |
|---|---|---|:--:|
| 尾部 → `runStart(next)` 递归 | 一个 `StartReason` | `pending: StartReason[]` 的最后一个元素 | ✅ |
| 尾部 → `notify()` 流 | 与改动前相同的 snapshot 序列 | 递归路径两次发射（开链 + 落定），落尾路径两次 | ✅（探针 B 调用次数；探针 C 的 notify 序列） |
| `enqueue` → `Array.prototype.splice` | `[0, queue.length]` 内的合法插入位 | `insertAt` = 前导 `presented` 或同会话 `pending` 的连续段，否则 `break` 处；全部匹配时为 `length` | ✅（探针 A） |
| `StartHostPort.setConnected`（测试替身） | 翻转编排器读取的 mock `connected` | 闭包引用 helper 局部量的方法简写，不用 `this` | ✅ |
| Phase 3 ← `dsh.test.getDiagnosticsText` | 冻结的 18 字段 v1 `HostDiagnosticRecord[]` | `() => hostDiagnostics?.records() ?? []`（`extension.ts:1107-1108`），本轮未动 | ✅ |

## 跨 Phase 依赖与 Phase 3 接入面

| 项 | 状态 | 说明 |
|---|---|---|
| Phase 3 读 `dsh.test.getDiagnosticsText` | ✅ 无影响 | 4 处均不在 `host-diagnostics.ts`、均不在读取路径上，记录形状 / `schemaVersion` 区域也不在改写行内。读取面已**实测为活**：本 Phase 自带 spec（44 例，含 `:1034` / `:1040` 的 AC-13(d) 门禁开/闭与 `:1117` 的 AC-22 命令级用例）全绿，我的路径 B 探针也读到了 listener 写入的同一记录器实例 |
| Phase 3 的已登记告警（`DEBT-010`：`getDiagnosticsText()` 为空不得读作「没有失败发生」） | ✅ 未变 | 已裁定的握手后缺口不受本轮影响；`process-failed` 快照的合成点（`auto-start-orchestrator.ts:225-229`）不属改写范围 |
| Phase 1 冻结的 `StartHostErrorKind` 词表 | ✅ 未变 | 本轮对 `auto-start-orchestrator.ts` 的改动不触及 `START_ERROR_KINDS`、`startErrorKindOf`、`catch` 块 |
| 改写 #2 所在文件同时是 AD-13 投影面 | ✅ 未变 | `projectEntry` / `listPending` / approval 与 `questions` 条目形状均不在改写行内；我跑的四套交互 spec 为绿 |

---

## 关键发现

### 🔴 MUST-FIX

无。4 处改写没有破坏任何端到端路径：重试 → 记录成对边与合并递归臂都在运行期被走到并成对；`enqueue` 扫描在所有穷举输入上逐一相同。

### 🟡 SHOULD-FIX

本轮范围内**无**。第 2 轮遗留的两条已由调度者裁定入注册表，此处**刻意不复审**：

- 第 2 轮 S-1（`HostDiagnosticRecorder.setSink()` 全仓无调用者）→ 登记为 `DEBT-013`（`tech-debt-registry.md`），用户裁定「承接为债、本 Phase 不改」；
- 第 2 轮 S-2（`DEBT-010` 定位符）→ 活跃行现已同时携带 `session-host.ts:727-757`（`onTransportDeath`）**与**第二个定位点 `auto-start-orchestrator.ts:225-229`。

### 🟢 观察

- **G-1 —— 提升在旧写法本会短路的场合多了一次纯读取。** 旧形式下当 `more.length > 0` 且 `isConnected()` 已为 `true` 时，元素读取 `more[more.length - 1]` 从不求值；新形式无条件求值 `more.at(-1)`。`more` 是由 `pending.splice(0)` 新产出的数组、任何 listener 都够不到，且 `Array.prototype.at` 无副作用（已直接核验：`[].at(-1) === undefined`、`['x','y'].at(-1) === 'y'`），故下游取值与顺序均不可能改变。探针 B 的调用次数列证实**可观察交互**一致：两种写法下 `more` 为空时 `isConnected()` 调 0 次、非空时恰调 1 次。
- **G-2 —— 两种守卫形式唯一可能分歧的输入是类型非法值，且新臂是更安全的一侧。** 若 `pending` 中真出现 `undefined` 元素，旧形式会走进重试臂并调用 `runStart(undefined)`；新形式落尾、不启动任何东西。按现状不可达：`pending` 是私有的，只由 `request(reason: StartReason)` 在闭合字符串联合（`auto-start-orchestrator.ts:8-15`）上写入，故 `more.at(-1) === undefined` ⟺ `more` 为空。记此一笔，以免上面的「等价」被读成「在类型允许但语义禁止的输入上也相同」。
- **G-3 —— `enqueue` 被改写的那一行没有针对该分支的单测。** 可见的顺序契约由 `phase2-multitab-history-replay.spec.ts:143-152`（「Soft priority: active pending inserts ahead of waiting (not interrupting presented)」）钉住，属探针 A 的 *tail = length* 类。`break` 提前退出与空队列两类形态只由我的穷举差分覆盖 —— 这正是本仓测试技能对「无既有用例覆盖的行为保持改写」规定的同类证据。不是发现项；记录下来是为了让后来的读者不必重新推导「哪一半有测试钉住」。
- **G-4 —— 记录器对四类失败保持沉默是设计使然，不是新的生产者缺口。** 我的探针最初对 `bridge-listen` 快照断言记录、实测为 0 条 —— 这正是 `hostFailureKindForStartError`（`host-diagnostics.ts:245-259`）所规定的：此处只记 `missing-credentials`，因为 `node-environment` / `bridge-listen` / `spawn` / `handshake-timeout` 由 Host 自己写记录，`invalid-setting` 由扩展的 `other` 兜底承载。编排器可投影出的 `errorKind` 取值集合不因本轮改写而变（`startErrorKindOf` 与 `catch` 逐字相同），因此这 4 处**没有引入任何新的无生产者快照、也没有新的死分支** —— 这两点我按提问刻意查过。
- **G-5 —— 那 7 行格式化都在链外。** `extension.ts` 的 3 行 `@stylistic(indent)` 构成该文件**唯一**的纯空白 hunk（3 `-` / 3 `+`，去空白后完全相同），位于 `runAskAboutSelection` 的 `asRelativePath` 箭头内 —— 任何 Phase 2 / Phase 3 链路都不经此处。4 行 `@stylistic(arrow-parens)` 是单参箭头的加括号（`new Promise(resolve => …)` → `new Promise((resolve) => …)`，`interaction-coordinator.ts:263` 与 `:440`）：参数名与函数体均未变，故没有调用目标、实参或默认值被移动。

---

## 已执行的验证动作

以下结果全部读自重定向的输出文件或命令自身的退出码，不采信 implementer 自述。

| 动作 | 命令 | 结果 |
|---|---|---|
| 这 4 处改写所要保住的提交门禁 | `node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern <3 文件>` | ✅ `EXIT=0`，输出**为空（0 行）** |
| 整包回归 | `pnpm run test apps/vscode-dsh` | ✅ `Test Files 4 failed \| 47 passed (51)`、`Tests 6 failed \| 404 passed \| 1 skipped (411)` —— 失败集合即文档化的恒定基线，逐条同名：`spike-t0a-replay-rebuild` ×4、`spike-t0b-continue-capability`、`panel-close-delete.e2e`、`verifier-phase1/layer-a-rtl` |
| Phase 集成面 | `pnpm run test apps/vscode-dsh/tests/{host-diagnostics,auto-start-orchestrator,interaction-fail-closed.integration,gap-005-009-debt-fix}` | ✅ 4 文件 / **66 通过**，exit 0 |
| `enqueue` 相邻交互面 | `pnpm run test apps/vscode-dsh/tests/{phase2-multitab-history-replay,interaction-fail-closed.e2e,panel-l2-l3-protocol}` | ✅ 3 文件 / **16 通过**，exit 0 |
| 按名筛跑的端到端用例（AC-22 成对、合并重试、重试重入、合并、HG-2 迟落定） | `pnpm exec vitest run <spec> -t "<名称>"` ×5 | ✅ 各自 `1 passed`（分别 43 / 10 skipped） |
| 改写 #2 的差分等价 | `/tmp/p2r3-probe.mts` 探针 A | ✅ `4681 queue shapes, 0 mismatches`；全 `presented` 与全同会话 `pending` 的 tail = `queue.length` |
| 改写 #1 的差分等价 + 各出口可达性 | 同文件，探针 B | ✅ `24 guard inputs, 0 mismatches; reached=fallthrough/isConnected-calls=0, fallthrough/isConnected-calls=1, retry/isConnected-calls=1` |
| 真实类端到端 FSM（落尾臂、重试成对、合并递归、成功即抑制递归、重入 `onUserStop`） | 同文件，探针 C1–C5 | ✅ `PROBE: ALL CHECKS PASSED`（exit 0）。C1 `1 条记录，phase 'start'，retryOfSeq null`；C2 `3 条记录，retryOfSeq 全指开链条`；C2b 成功不新增记录；C3 `startCalls ['command-start','command-send']`、2 条成对；C4 合并且成功 → 只 1 次启动；C5 `startCalls ['command-start']`、状态 `idle` |
| 提升后 `generation === this.generation` 合取项的可达性 | 探针 C5（listener 在 `:241` 的 `notify()` 内调 `onUserStop()`，且 `more` 非空、端口未连接） | ✅ 该臂被走到并抑制了重试 → 合取项**不是**死条件，提升也没有削弱陈旧代次保护 |
| 消 lint 手段 | `rg 'eslint-disable\|oxlint-disable\|ts-expect-error\|ts-ignore\|as any\|as unknown as\|\)!\|\]!' <3 文件>` | ✅ 无匹配 |
| 提升所依赖的 `Array.prototype.at` 语义 | `node -e '…'` 对 `[]` 与 `['x','y']` | ✅ `{empty:true, last:"y"}` |
| 那 7 行格式化 | 对 `git diff HEAD -- <文件>` 做 hunk 分类 + 直读纯空白 hunk | ✅ `extension.ts`：恰 1 个 3 行的纯空白 hunk（链外）；`interaction-coordinator.ts`：2 处 `arrow-parens` 均为单参加括号 |

**如实说明局限。** `/tmp/p2-baseline-vscode-dsh.txt` 已不在 `/tmp`，故上述 6 条失败集合是拿 `.cursor/skills/project-test/SKILL.md` 记录的恒定不变量（四个文件、六个用例名）与 `implementation.md` §11.4 对照的 —— 两者与我实测到的集合完全一致。§11.6 的整仓 lint 比差我**未**重跑；这 4 处改写所要保住的 staged profile 门禁已实测为绿且无输出。

---

## 范围声明

本报告**只覆盖连通性**，范围限定为本轮 4 处 `lint (staged)` 改写与 7 行 `--fix` 格式化。改写除等价性之外的行为正确性、所选写法的合理性，以及 Phase 2 主体（诊断记录面、listener、投影、extension 接线），属另外三个审查视角与已合并的第 2 轮报告；握手后缺口已裁定为 `DEBT-010`，不再重开。
