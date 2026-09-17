# Connectivity Review — Phase 3（第 3 轮）

审查对象：round-5 implementer 的改动（D25–D34）

## 视角

**Integration Connectivity** — 模块间是否真正连通。本轮只回答一个问题：**端到端的数据与判决是否真的流得通、断得掉、接得上**。
（不评价实现正确性 = reviewer-correctness；不评价设计合理性 = reviewer-design；不评价界面 = reviewer-visual。）

## 判决：PASS

🔴 0 / 🟡 0 / 🟢 5

上一轮我报的唯一 🟡（`display-evidence.spec.ts` 的 `@stylistic(comma-dangle)`）本轮**已确认修复**（见 §5）。

---

## 1. 端到端路径追踪

### Path 1 — 显示证据判决如何决定 run 的结论（DEBT-017 / AC-28 R2.3，本轮最关键的连通性）

```
Entry: main()  →  while :; do（run-layer-v-smoke.sh:3132）
  → prepare_attempt()                                    :1333   ── 建沙箱 / 起 xvfb 或复用 DISPLAY
  → run_attempt()
      → driver_conclusion 从状态文件读出                  :3001   `?? "UNKNOWN"`（读不出→UNKNOWN）
      → assert_display_evidence "${driver_conclusion}"   :3023   ✅ 调用点存在，参数正确
        → [模块] assert_display_evidence()               display-evidence-shell.sh:169
            → 可用性闸门（NODE_TOOL / 模块文件）           :172    ✅ 不可用 → fail_harness → HARNESS_ERROR/4
            → 地板闸门（MIN_DISTINCT_MD5 非空）            :176    ✅ 未读到 → fail_harness → HARNESS_ERROR/4
            → display_evidence_verdict(...)              :185    ✅ **直接调用，不走 $( )** ← DEBT-017 的修复本体
                → node -e "…judge…"                      :146    ✅ 真实调用 display-evidence.cjs:judgeEvidence
                → 判决经**变量**回传（非 stdout）           :21     ACTION / REASON / ATTEMPTS_JSON / RETRY_REQUIRED
            → record_display_evidence_attempt()          :189    ✅ 本轮测量落进记录（两种结论都记）
            → driver_conclusion != PASS ⇒ 只记录、不改结论  :192   ✅ 单向规则：不把 LINK_FAILURE 改写成 HARNESS_ERROR
            → case action: pass | retry | skip | *       :196-216
                retry ⇒ DISPLAY_RETRY_REQUIRED="true"    :202
  → 回到调用方：if [ "${DISPLAY_RETRY_REQUIRED}" = "true" ]; then return 0; fi   :3024  ✅ 消费者存在且可达
  → discard_attempt()                                    :1339
      → DISPLAY_EVIDENCE_FORCED_XVFB="true"              :3084   ── 下一次必然是 owned display
      → DISPLAY_RETRY_REQUIRED="false"                   :3084   ── 标志复位，二次置位只可能来自模块
      → 换掉这次尝试的进程/沙箱/报告叙述
  → if [ "${DISPLAY_ATTEMPT}" -ge 2 ]; then fail_harness …  :3142   ── 第三次尝试 = 断言失败（HARNESS_ERROR/4）
  → DISPLAY_ATTEMPT=$((+1))  →  loop 回到 prepare_attempt  :3145-3146
  → 第 2 次尝试（owned / xvfb）→ 模块 forced=true ⇒ 不再 retry
      → pass / skip / fail-closed 之一 ⇒ set_conclusion … ; exit_now   :3044
Exit: 单一结论 + 退出码（PASS=0 / LINK_FAILURE=1 / SKIPPED_NO_DISPLAY=2 / SKIPPED_NO_CREDENTIALS=3 / HARNESS_ERROR=4）
```

**判定**：✅ 完整连通。`retry` → `DISPLAY_RETRY_REQUIRED=true` → **`main` 重跑 xvfb** 这条链在代码上闭合：生产者唯一（模块 `:202`）、消费者唯一（`:3024`）、复位点唯一（`:3084`）、循环入口存在（`:3132`），且第 2 次尝试的 `forced=true` 使 `retry` 在契约上不可能再次出现（`display-evidence.cjs:158-164` 只在 `mode==='reuse' && forced!==true` 时返回 retry）。

### Path 2 — 消费侧模块**缺失**时确实阻断（而非静默降级）

```
Entry: 脚本加载期  . "${DISPLAY_EVIDENCE_CONSUMER}"       :283-285
  → 由 `if [ -f … ]` 包裹                                  :283    ✅ 缺失时不 source、不报错、不中止
Entry: main()
  → 预检：missing += " layer-v-support/display-evidence-shell.sh"   :3097
  → if [ -n "${missing}" ]; then set_conclusion "HARNESS_ERROR" 4 "preflight" …; exit_now    :3100-3103
  → 预检在 `while` 循环之前（:3100-3103 vs :3132）          ✅ 因此在 assert_display_evidence(:3023) 之前
  → 消费侧第二次设防（即使被调用）                            :172-175  ✅ 不可用即 fail_harness
Exit: HARNESS_ERROR / 4，且 `missing required inputs: … display-evidence-shell.sh` 进报告
```

**判定**：✅ 阻断，且是**双点**阻断（预检 + 模块内闸门），非静默降级。注意脚本是 `set -uo pipefail`（**无 `-e`**），所以「模块缺失却仍走到 `:3023`」不会被 shell 自己中止 —— 挡住它的是预检的**顺序**。当前顺序正确（见 🟢-2）。

### Path 3 — `homeSandboxOf` 不可用 ⇒ HARNESS_ERROR / 4

```
Entry: extension.cjs step-6（sandbox clean-state 检查）
  → homeSandboxOf(plan)                                   extension.cjs:2293
  → ok !== true ⇒ throw harnessError('sandbox-clean-state-check-unavailable', …)   :2294-2298
      → harnessError = new StageError('HARNESS_ERROR', …)  :112    ✅ conclusion 随对象走，不依赖消息文本
  → 该 step 的 catch 分支                                  :2359
      → error instanceof StageError ⇒ status.conclusion = staged.conclusion('HARNESS_ERROR')   :2365
      → 非 StageError（意外异常）⇒ 包成 harnessError('unexpected-driver-error: …')             :2360-2362  ✅ 也是 HARNESS_ERROR，fail-loud
      → 写状态文件（含 failureEvidence / failedStep）
  → shell 读回 conclusion                                  run-layer-v-smoke.sh:3001   `?? "UNKNOWN"`
  → case *)（HARNESS_ERROR 与 UNKNOWN 同路）               :3041-3044  set_conclusion "HARNESS_ERROR" 4
Exit: HARNESS_ERROR / 4
```

**判定**：✅ 完整连通，且读不出结论时回落 `UNKNOWN` 也归入 `*)` → exit 4（fail-closed），不存在「读不出就当通过」的窗口。
配套：`sandbox-clean-state.cjs:91` 的 `staleProductState` 显式拒绝未经 `homeSandboxOf` 校验的值（`TypeError`），所以参数不可能被静默地以空值传入。

### Path 4 — `build-freshness` 的 workspace 半区**真的被传进去了**

```
Entry: assert_build_freshness()                            run-layer-v-smoke.sh:1167
  → for root in "${REPO_ROOT}"/packages/*/* "${REPO_ROOT}"/vendor/*   :1173-1176   ✅ 无依赖当前目录的通配展开
  → siblings+=("${root}")  仅当 [ -d ]                        :1175-1176
  → sibling_args=(--sibling "${siblings[@]}")                :1178-1181
  → node build-freshness.cjs <lib> <extension.js> <src> ${sibling_args[@]+"${sibling_args[@]}"}   :1182 ✅
      → 被调用方解析 --sibling                                build-freshness.cjs:388-403
      → verdict.siblings = { compared, artifactCount, sourceCount, failed }   ✅ 下游报告行引用它 :1206-1207
调用侧：main() → assert_build_freshness                      :3114   ✅ 存在且无参数依赖
实测：以脚本自身收集的参数直接驱动该模块 → compared: 266 个 root，failed: 0（workspace 半区确实参与比较）
```

**判定**：✅ 连通，**不是「模块有能力、调用侧没传」那类半边**（我上一轮发现的形状）。这里调用侧确实把 workspace 半区传了进去，并且成员列表与 `build:lib:host` 发布的两层（`packages/*/*`、`vendor/*`）一致；`apps/vscode-dsh/tests/build-freshness.spec.ts` 读同一份列表 → 未来新增成员不会静默落在比较范围之外。

### Path 5 — `scripts/oxlint-contract.spec.ts` 的 `owned` 契约在门禁链路上会被执行

```
scripts/oxlint-contract.spec.ts
  → vitest.config.ts 的 testIncludes 含 'scripts/**/*.spec.ts'      ✅ 会被收集
  → package.json: "test" = vitest run                               ✅
  → scripts/run-gates.ts: ciPrimaryGates() 含 pnpmScript('test','test')  ✅ CI 门禁链上（非仅本地）
  → 契约本体：owned 数组 = 由 apps/vscode-dsh/tests/tsconfig.json 拥有的文件名列表
      实测（OXC_LOG=debug）：列表内文件归属 = apps/vscode-dsh/tests/tsconfig.json；
                            非列表文件归属 = <none>
Exit: 归属被破坏 ⇒ spec 失败 ⇒ test 门禁红
```

**判定**：✅ 该契约确实跑在 `pnpm run test` / CI 链上，不是「只在本地 vitest 里跑」；且 `owned` 断言在**真实 `.oxlintrc.json`** 下成立（我复跑确认，不是只在 spec 内嵌的临时配置下成立）。

### Path 6 — lint / 语法链（本轮 12 个触及文件）

```
实测（直接调用 linter 二进制，不经仓库脚本）：
  11 个 .ts/.cjs 文件（含上一轮的 🟡-2 现场 apps/vscode-dsh/tests/display-evidence.spec.ts）
    → Found 0 warnings and 0 errors. Finished in 2.3s on 11 files with 110 rules   ✅
4 个 .sh 文件（oxlint 不 lint shell）→ bash -n 全部 OK                              ✅
  （覆盖它们的是 check-test-scripts-syntax.sh 门禁：bash -n，见 🟢-4 的打包提醒）
```

**判定**：✅ 0 错，与调度者实测一致。本轮无新增 lint 债。

---

## 2. 上下游连接检查

| 新增/改动的单元 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|---|---|:--:|---|:--:|
| `assert_display_evidence()`（消费者，模块内 :169） | `run_attempt` `:3023` | ✅ 实参 `driver_conclusion` 正确 | `display_evidence_verdict` `:185`（直接调用，不 subshell） | ✅ |
| `display_evidence_verdict()`（模块内） | 同上（唯一） | ✅ | `node … display-evidence.cjs judge` `:146` | ✅ |
| `read_display_evidence_floor()`（模块内 :151） | `main` `:3117` | ✅ 在首次尝试之前 | `require(...).MIN_DISTINCT_MD5`（单一真相源） | ✅ |
| `DISPLAY_RETRY_REQUIRED` | 模块 `:202`（唯一生产者） | ✅ | `run_attempt` `:3024` → 循环 `:3132` → `prepare_attempt` | ✅ 可达 |
| `discard_attempt()` | 循环 `:3139` | ✅ | 置 `FORCED_XVFB=true` `:3084`、复位标志 `:3084` | ✅ |
| `homeSandboxOf()` | `extension.cjs:2293`（唯一调用点） | ✅ | `staleProductState(…, sandboxHome.value)` `:2312` | ✅ |
| `--sibling` 传参 | `assert_build_freshness` `:1178-1182` | ✅ 调用侧确实收集并传入 | `build-freshness.cjs` `:388-403` | ✅ |
| `owned` 契约 | `vitest.config.ts` → `test` → CI gate | ✅ | `owned` 数组断言 tsconfig 归属 | ✅ |

**变量面（source 方必须提供的每一个）**：`NODE_TOOL:135` / `TMP_ROOT:113` / `ARTIFACT_DIR:69` / `DISPLAY_MODE:156` / `DISPLAY_EVIDENCE_FORCED_XVFB:165` / `DISPLAY_ATTEMPT:167` / `DISPLAY_EVIDENCE_JSON:161` / `DISPLAY_EVIDENCE_ACTION:162` / `DISPLAY_EVIDENCE_REASON:163` / `DISPLAY_EVIDENCE_ATTEMPTS_JSON:164` / `DISPLAY_RETRY_REQUIRED:166` / `DISPLAY_EVIDENCE_MODULE:65` / `MIN_DISTINCT_MD5:170` —— **全部在脚本顶层声明（decls=1），无一「只在测试里定义、生产路径下为空」**。其中 `MIN_DISTINCT_MD5` 的形态是「顶层声明空串 → `:3117` 由 `read_display_evidence_floor` 从 `.cjs` 填值（=3）→ 消费侧 `:146` 用作输入、`:176` 为空即 fail_harness」，因此**生产路径上不存在空值直达判决的窗口**。

---

## 3. 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|---|---|---|:--:|
| `run-layer-v-smoke.sh` ← 消费者模块 | 经变量回传 `ACTION/REASON/ATTEMPTS_JSON/RETRY_REQUIRED`，**不经 stdout** | 模块注释与实现一致（`:21`、`:171`、`:202`），且调用点 `:185` 显式不用 `$( )` | ✅ |
| 消费者 → `display-evidence.cjs` | `judge` 返回 `pass/retry/skip/fail-closed` | `:196-216` 四个分支齐备，未知值走 `*` → `fail_harness` | ✅ |
| 消费者 → 调用方结论 | 非 PASS 不得改写结论 | `:192-195` 单向规则；`LINK_FAILURE` 只记录测量 | ✅ |
| `extension.cjs` ← `sandbox-clean-state.cjs` | `{ ok, value }` 形状 | `homeSandboxOf:56-74` / `runStartedAtMsOf:36` 同形；`staleProductState:91` 拒绝未校验值 | ✅ |
| `run-layer-v-smoke.sh` → `build-freshness.cjs` | `--sibling <root>…` | `:388-403` 解析并返回 `verdict.siblings{compared,failed,…}` | ✅ |
| `oxlint-contract.spec.ts` → oxlint | 文件归属 = `apps/vscode-dsh/tests/tsconfig.json` | 实测归属一致（列表内 tsconfig、列表外 `<none>`） | ✅ |

---

## 4. 跨 Phase 依赖检查

| 本 Phase 依赖 | 来源 | 接口状态 | 连接状态 |
|---|---|:--:|:--:|
| `display-evidence.cjs` 的 `judgeEvidence` / `measureFrames` / `MIN_DISTINCT_MD5`（Phase 3 内建立） | 本 Phase | 本轮新增导出 `MIN_DISTINCT_MD5`（`:169`） | ✅ 消费侧已改为从模块读取，无第二份副本 |
| `sandbox-clean-state.cjs` 的 `homeSandboxOf`（DEBT-015 的兄弟缺口修复） | 本 Phase | 本轮补齐 | ✅ |
| `artifact-index.cjs` / `build-freshness.cjs` | 本 Phase | 无签名变更 | ✅ |

未发现被冻结接口被改动而未通知的情形；未发现循环依赖；未发现写后即弃的数据黑洞（本轮新增的 `displayEvidence` 记录在非 PASS 结论下仍被写入并被报告行消费 —— `:1206-1207` 与 `record_display_evidence_attempt :189`）。

---

## 5. 上一轮遗留项确认

| 上一轮条目 | 本轮状态 | 证据 |
|---|:--:|---|
| 🟡-2 `display-evidence.spec.ts:40` `@stylistic(comma-dangle)` | ✅ 已修复 | 直接调用 linter 二进制对该文件（连同另 10 个文件）→ `Found 0 warnings and 0 errors`；该处已是多行调用形态（`:40-42`），不再触发 |

---

## 6. 关键发现

### 🔴 Must-Fix

无。

### 🟡 Should-Fix

无。

### 🟢 Observations

1. **`owned` 数组替代 probe 列表 —— 连通性上等效，我独立同意该偏离。**
   字面要求（`scope-amendment-02.md` §8.1 第 3 项）是「probe 列表补一行」，但该要求**在物理上不可满足**，有两个各自独立的原因：① 探针文件名匹配 `.oxlintrc.json` 的忽略形状（`**/oxlint-contract-*`），因此探针**根本不会被 lint**，任何「断言它触发类型感知规则」的写法都无从成立；② `apps/vscode-dsh/tests/tsconfig.json` 用**显式列举文件名**（非 glob），所以即使强行喂给 oxlint，探针的归属也必然解析为 `<none>`。
   `owned` 形态断言的是「这些**已存在**的文件归属 = `apps/vscode-dsh/tests/tsconfig.json`」——这正是「归属被破坏」时的破法（把某文件从 tsconfig 的列举里删掉 / 改名 → 归属变 `<none>` → 断言失败）。我复跑确认该断言在**真实 `.oxlintrc.json`** 下成立。
   **残留差异（记录，非判决项）**：`owned` 不校验「类型感知规则真的在这些文件上开火」。该差异源自文件类别本身的限制，不是实现取巧；且原字面要求同样无法覆盖它。

2. **`assert_display_evidence` 不存在时的唯一屏障是预检顺序（加固建议）。**
   脚本是 `set -uo pipefail`（无 `-e`），而 `:283-285` 的 source 由 `if [ -f … ]` 包裹 —— 于是「模块文件缺失」时，`:3023` 若被执行到，只是一次**非致命**的 `command not found`（127），随后 `case` 会照常按 `driver_conclusion` 记账（PASS 就可能被写下）。今天挡住它的是 `main` 的预检位于循环之前（`:3100-3103` < `:3132`）**且**模块内 `:172-175` 二次设防。当前顺序正确、结论不受影响；仅记录该形状，供未来若有人调整 `main` 顺序时注意。

3. **第三次尝试的守卫是「按契约不可达」的 dead-man switch（已人工触发验证）。**
   `:3142-3144` 在 `DISPLAY_ATTEMPT >= 2` 时 `fail_harness`。由于 `retry` 需要 `mode==='reuse' && forced!==true`，而 `discard_attempt` 置 `FORCED_XVFB=true`（`:3084`），二次尝试在契约上不可能再 retry —— 该守卫在正确实现下不可达。我用定向探针把它人工触发，得到预期的 `HARNESS_ERROR/4`：**可达且能报错**，属刻意的自检而非死代码。

4. **HG-3 打包提醒（非代码缺陷，属提交面连通性）。**
   `scripts/check-test-scripts-syntax.sh`（门禁 `check:test-scripts-syntax` 的实体）当前仍是 **untracked**，`layer-v-support/`、`run-layer-v-smoke.sh`、若干 spec 亦然。`scripts/run-gates.ts` 引用该 pnpm script：若提交时漏掉 `check-test-scripts-syntax.sh`（或未同步 `package.json` 里的 script 别名），门禁会以 `bash: … No such file` **响亮失败**（fail-closed，不会静默放行）。请在 HG-3 的显式 add 清单里带上它们。

5. **消费者侧「形状钉」与「行为钉」的覆盖分工（记录）。**
   spec 中对调用点 `:3023` 的钉子（`lines` 文本比对）钉的是**形状**（不允许把判决包进 `$( )`），不覆盖行为；行为一半由 `display-evidence-shell.spec.ts` 的 `retry` 用例与我的定向驱动（reuse 退化 → 换 owned → PASS；两次都退化 → skip；第三次尝试 → HARNESS_ERROR/4）各自独立覆盖。两者合起来完整，但若将来只保留文本钉，则「换一种破坏形状」（例如 `assert_display_evidence … | cat`）不会被那条正则发现。

---

## 7. 本轮我实际做了什么（可复跑）

- 静态追踪：`source`/调用点/变量声明/标志生产-消费-复位点/case 分支/退出码映射的全部 `file:line` 引用（见上文括号内行号）。
- 定向驱动：用「按行区间抽取真实脚本片段」生成的独立 harness 驱动消费侧，覆盖 6 个连通场景（reuse 退化→owned 通过、reuse 退化→owned 再退化→skip、owned 初次退化→skip、第三次尝试守卫、产品 `LINK_FAILURE` 不被显示判决覆盖、地板读不到 → `HARNESS_ERROR/4`），全部符合 `spec.md` 修订段 R1/R2 的预期。
- `build-freshness.cjs`：以脚本自身收集的 `--sibling` 参数直接驱动 → `compared: 266, failed: 0`。
- `homeSandboxOf`：确认唯一调用点、`ok !== true` 抛错路径、catch 分支取 `conclusion` 字段（不依赖消息文本）、非 StageError 也包成 HARNESS_ERROR、shell 侧 `UNKNOWN` 回落 `*)` → 4。
- 门禁链：确认 `oxlint-contract.spec.ts` 被 `vitest.config.ts` 收集 → `pnpm run test` → `ciPrimaryGates()` 覆盖；`OXC_LOG=debug` 复核归属。
- lint/语法：直接调用 `node_modules/.bin/oxlint`（11 个 `.ts`/`.cjs` → 0 warnings / 0 errors）+ `bash -n`（4 个 `.sh` 全部 OK）。
