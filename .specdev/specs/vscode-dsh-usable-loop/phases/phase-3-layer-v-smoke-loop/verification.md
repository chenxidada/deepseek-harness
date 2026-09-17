# Phase 3 验证报告（verifier round-6，独立重跑）

## 判决：PASS

> 旧报告已按启动自清理协议归档：`.archive/verification-20260917T093531Z.md`（`mv`，未删除、未动 git、未动 `current-status.json`）。
> 本 Phase `ui: false`（DAG），无 `ui-spec.md` / `visual-baseline.md` → 视觉验证矩阵不适用，`visual-blocking` 不适用。

## 0. 判决依据摘要（先看这里）

| 项 | 结果 |
|---|---|
| 本 Phase 终极目标：真机层 V 闭环可重复执行 | ✅ **由 verifier 亲自跑通**（非采信 implementer/调度者自述）：exit `0`、`conclusion=PASS`、43s |
| 五步执行 | ✅ 全 `ok` |
| 五张截图 md5 互不相同（floor = 3） | ✅ **5/5 distinct** |
| `postLink.postHandshakeRecordCount` | ✅ `1` |
| `artifact-index.md` 追加运行记录 | ✅ 新增一行（`2026-09-17T09:36:20.496Z`，`PASS`） |
| `DEBT-014` | ✅ **可关闭**（三条关闭条件独立构造并全部成立，含负向对照） |
| `DEBT-017` | ✅ **可关闭**（A5 双向独立复现 + 四分支各有一条运行时可达路径） |
| 最高残余风险 | 🟢 **LOW**（无 CRITICAL / MEDIUM） |

---

## 1. 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|---|---|------|:--:|---|
| 层 V 真机闭环（终极目标） | spec 验证计划 / AC-10·AC-13·AC-14 真机补充证据 | `set -a && . ./.env && set +a; bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | ✅ | `EXIT_CODE=0`，`[layer-v] conclusion: PASS (exit 0)`，耗时 `43s`（脚本自报 36s 级） |
| 五步全部到达 | spec 步骤定义 | 同上 | ✅ | `step-1..step-5` 均 `"status": "ok"` |
| 截图证据力 floor（AC-26(e)） | spec AC-26(e) / `MIN_DISTINCT_MD5` | `md5sum apps/vscode-dsh/test-artifacts/layer-v/step-*.png \| awk '{print $1}' \| sort -u \| wc -l` | ✅ | `5`（floor = 3） |
| 握手后记录（postLink） | spec AC-28 / 修订段 R1 | `grep -o '"postHandshakeRecordCount": *[0-9]*' layer-v-status.json` | ✅ | `1` |
| artifact-index 追加（AC-33） | spec AC-33 | `tail -3 .specdev/.../artifact-index.md` | ✅ | 新增 `2026-09-17T09:36:20.496Z \| PASS \| 0 \| step-1…step-5` |
| DEBT-017 消费契约回归 | `display-evidence-shell.spec.ts` | `npx vitest run apps/vscode-dsh/tests/display-evidence-shell.spec.ts` | ✅ | `Test Files 1 passed (1) / Tests 11 passed (11)`，1.85s |
| DEBT-014 关闭条件 (i)(ii)(iii) | 注册表 DEBT-014 关闭条件 | `node <phase>/test-scripts/verifier-round6-independent.cjs` | ✅ | `RESULT: ALL CONDITIONS MET`（7 项全 PASS） |
| DEBT-017 关闭条件（双向 + 四分支） | 注册表 DEBT-017 关闭条件 | `bash <phase>/test-scripts/verifier-round6-debt017.sh` | ✅ | `RESULT: ALL CONDITIONS MET`（8 项全 PASS） |
| floor 2→3 实际影响面 | Task 3 | 见 §4 | ✅ | 归档运行 `20260916T170431Z-2270421`：`distinctMd5=2/5`，原判 `PASS` ⇒ 现判 `retry` |

> **未采信 implementer 的测试**：上表「层 V 闭环」「DEBT-014」「DEBT-017」三行均由我独立设计并执行；implementer 的 `implementation.md` 只作为上下文阅读，未作为判决依据。

---

## 2. 独立验证场景（我设计的，非复述 implementer 证据）

### 2.1 真机闭环（最高优先）

```
$ cd /workspace/chendecheng/code/need/deepseek/deepseek-harness
$ set -a && . ./.env && set +a
$ bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
[layer-v] driver conclusion: PASS
[layer-v] conclusion: PASS (exit 0)
=== EXIT_CODE=0 ELAPSED=43s ===
```

`layer-v-status.json`（我亲自读取）：

```
runId: 20260917T093538Z-698103
conclusion: PASS
  step step-1 |status: ok
  step step-2 |status: ok
  step step-3 |status: ok
  step step-4 |status: ok
  step step-5 |status: ok
postLink = {"recordsBefore":1,"recordsAfter":2,"freshRecordCount":1,"postHandshakeRecordCount":1,...}
```

md5（我亲自计算）：

```
26bfa517b26bc1124c71ce41b449e83d  step-1-host-started.png
8212a291f17fd6c15d5e295779921d3b  step-2-new-conversation.png
324a761a078bed355ed29a053e394e19  step-3-model-round-trip.png
e6a83de23ef9d564f2a9e650cb914ffb  step-4-approval.png
2e244b56eab704d3d07174c8bdd91314  step-5-native-diff.png
distinct = 5
```

**这修正了我上一轮「缺凭证 ⇒ 无法运行」的结论**：凭证可用，脚本不自动加载 `.env`，需显式注入。

### 2.2 DEBT-014 关闭条件（独立构造）

脚本：`test-scripts/verifier-round6-independent.cjs`（自建临时树 + 真实 shipped 模块 + 真实 CLI 退出码，未复用 `implementation.md` 的任何命令）：

```
PASS  DEBT-014(i) stale sibling -> verdict refuses  ok=false reason=workspace-artifacts-stale
PASS  DEBT-014(i) stale sibling -> CLI exit != 0  exit=1
PASS  DEBT-014(ii) unbuilt sibling -> verdict refuses  ok=false reason=workspace-artifacts-absent
PASS  DEBT-014(ii) unbuilt sibling -> CLI exit != 0  exit=1
PASS  DEBT-014(control) healthy sibling -> verdict ok (refusals are not unconditional)  ok=true reason=null
PASS  DEBT-014(control) healthy sibling -> CLI exit 0  exit=0
PASS  DEBT-014(iii) every tsdown member covered or explicitly excluded
      members=["vendor/*","packages/*/*","apps/cli","apps/vscode-dsh"]
      comparedGlobs=["vendor/*","packages/*/*"] outside=["apps/vscode-dsh","apps/cli"] uncovered=[]
PASS  DEBT-014(iii) the spec globs are the globs the smoke script feeds the CLI  expandedInScript=["packages/*/*","vendor/*"]
PASS  DEBT-014(iii) negative control: an undeclared member IS flagged  flagged=["apps/new-tool"]
PASS  DEBT-014(iii) apps/cli is named in both the script and the spec
RESULT: ALL CONDITIONS MET
```

**关键设计说明（我的独立增量）**：

1. **负向对照**（implementer 证据里没有）：把 `apps/new-tool` 注入成员集后，断言**必须**报出 `uncovered` ⇒ 证明 (iii) 的断言不是恒真。这条对 (iii) 的必要性极高 —— 一个「永远为空」的过滤器同样会打印 `uncovered=[]`。
2. **正向对照**：健康 sibling ⇒ `ok=true` / CLI exit `0`。没有它，上面两条「拒绝」无法区分「fail-closed」与「无条件失败」。
3. **(iii) 的措辞按调度者订正后判定**：我确认 `apps/cli` 与 `apps/vscode-dsh` 确实**落在比较 glob 之外**，但两者都被**显式命名**在 `OUTSIDE_THE_GLOBS` 中，且 `apps/cli` 同时出现在 `run-layer-v-smoke.sh` 里（`build-freshness.spec.ts:351-379` 有断言）。故按订正后措辞（「无成员在**无人声明**的情况下落在比较之外」）判定 **成立**。

### 2.3 DEBT-017 关闭条件（双向 + 四分支）

脚本：`test-scripts/verifier-round6-debt017.sh`（自建 harness，真实 source shipped `display-evidence-shell.sh` + 真实 `display-evidence.cjs` + 真实 PNG 帧；未修改仓库任何文件，产物仅落 `$TMPDIR`）。

**(a) 修复在 ⇒ 绿，四分支各有一条运行时可达路径**

```
PASS  pass branch: action word is exactly one word, retry stays false   got=[BRANCH=pass retry=false]
PASS  retry branch: degenerate frames ask for the R2.3 owned-display re-run  got=[BRANCH=retry retry=true]
PASS  skip branch: an owned display that is degenerate refuses (not another retry)  got=[BRANCH=skip retry=false]
PASS  * branch: an unjudgeable display mode fails closed  got=[BRANCH=OTHER -> HARNESS_ERROR/4 action=[fail-closed]]
```

四分支的触发路径（我构造的输入）：

| 分支 | 构造 | 实得 |
|---|---|---|
| `pass` | reuse / forced=false / 5 帧互不相同 | `pass`，`retry=false` |
| `retry` | reuse / forced=false / 4 同 + 1 异（distinct=2） | `retry`，`DISPLAY_RETRY_REQUIRED=true` |
| `skip` | xvfb / forced=false / distinct=2 | `skip`，`fail_display` 记账「distinct md5 = 2/5, floor 3」 |
| `*` | mode=`wayland` / distinct=2 | `fail-closed` → `fail_harness`（`action 'fail-closed'`） |

**(b) 缺陷在 ⇒ 红（运行时复现缺陷机理）**

同一份 harness 内同时放「直接调用」与「`$( … )` 捕获」两种调用形态，**同一次运行**对比：

```
    case=legacy mode=reuse forced=false driver=PASS style=legacy
    out: BRANCH=pass retry=false
    out: LEGACY-BRANCH=OTHER -> HARNESS_ERROR/4 action=[]
PASS  captured verdict loses the action word in the parent shell (defect direction)  the legacy capture fell to *
PASS  the very same run's direct call still yields pass (fix direction)  direct branch = pass
```

即：**修复之所以成立，正是因为调用方不再捕获 stdout**；一旦把 `display_evidence_verdict` 放回 `$( … )`，动作词在父 shell 中为空（子 shell 吞掉 `DISPLAY_EVIDENCE_*` 的赋值），`case` 落 `*`。这就是原缺陷的完整机理在运行时被复现，且与「修复在 ⇒ 绿」构成双向对照。

**(c) 静态守卫的覆盖边界（如实报告，任务 2 要求）**

把 shipped spec 自己那条谓词（`\([^)]*(display_evidence_verdict|assert_display_evidence)`，先校验 spec 仍含该谓词再使用）套到五种调用形态上：

```
CAUGHT  M1  $( ) around the primary call                          guard=true  whitelist=true
CAUGHT  M2  backticks around the primary call                     guard=false whitelist=true
BYPASS  M3  $( ) opened on a different line                       guard=false whitelist=false
BYPASS  M4  an EXTRA backtick capture, primary line left intact    guard=false whitelist=false
CAUGHT  M5  an EXTRA $( ) capture, primary line left intact        guard=true  whitelist=false
RESULT: coverage boundary -> M3 | M4 bypasses BOTH assertions
```

**结论（守卫强度）**：
- 守卫由**两条互补断言**构成：① 谓词捕获「同一行 `(` + 函数名」；② 白名单 `lines.some(l => l.trim() === 'assert_display_evidence "${driver_conclusion}"')`。
- **M3 / M4 同时绕过两者** ⇒ 覆盖边界确实存在（我独立复现并**扩大了** `review-design.md` 🟡-1 的描述：不止 backtick，**跨行 `$(`** 也绕过）。
- **但爆炸半径是「响亮失败」而非「假 PASS」**：M3/M4 场景下父 shell 的 `DISPLAY_EVIDENCE_ACTION` 为空 ⇒ `case` 落 `*` ⇒ `fail_harness` ⇒ `HARNESS_ERROR/4`。即最坏后果是**多一次 fail-closed 误报**，不会让证据不足的运行被判 PASS。
- 因此我把它记入 §6 观察项（测试覆盖范围/静态守卫强度），**不计入判决**（对应任务说明中「测试覆盖范围类发现不计入判决」）。

### 2.4 桩感知验证（Stub-Aware Validation）

- 读取 `tech-debt-registry.md`：`DEBT-014` / `DEBT-017` 在活跃表；`DEBT-018` / `DEBT-019` 等已知债务登记在案。
- 参数变化测试：`build-freshness.cjs` 对 stale / unbuilt / healthy 三组不同输入产生**三种不同输出**（`workspace-artifacts-stale` / `workspace-artifacts-absent` / `ok=true`）⇒ 非桩，有真实逻辑。
- `display-evidence.cjs` 对 distinct=2 / distinct=5 / 不可测 产生 `retry` / `pass` / `fail-closed` ⇒ 非桩。
- **未发现未登记的新疑似桩**。

---

## 3. 端到端验证

| 数据路径 | 结果 | 证据 |
|---|:--:|---|
| `.env` 凭证 → 脚本 → driver → Extension Development Host → 五步 → `layer-v-status.json` → `artifact-index.md` | ✅ | 一次运行产出 `conclusion=PASS` + 5 张互异截图 + 索引追加行 |
| shipped `display-evidence.cjs` → `display-evidence-shell.sh`（stdout 空 + 变量回传）→ `run-layer-v-smoke.sh:3023` 直接调用 → 四分支 | ✅ | §2.3(a)；`run-layer-v-smoke.sh:3023` 我确认是**直接调用**（无 `$( … )`） |
| `tsdown.config.ts` workspace 列表 → `assert_build_freshness` 的 `--sibling` 展开（`:1175` `packages/*/*` / `vendor/*`）→ `build-freshness.cjs` 逐 sibling 判定 | ✅ | §2.2；脚本展开的 glob 与 spec 断言的 glob 一致 |
| 帧 md5 判定 → `MIN_DISTINCT_MD5` → 运行记录 `displayEvidence` | ✅ | §4：真实归档 `distinctMd5=2/5` 在 floor 3 下改判 `retry` |

---

## 4. Task 3：`MIN_DISTINCT_MD5` 2 → 3 的影响面（用磁盘真实归档）

对归档帧用**当前** shipped 模块重新判定（不改动归档）：

```
20260916T170431Z-2270421 | distinctMd5=2/5 | floor=3 | action=retry
20260916T113508Z-1419033 | distinctMd5=5/5 | floor=3 | action=pass
20260916T114328Z-1454058 | distinctMd5=5/5 | floor=3 | action=pass
--- 运行时的 recorded conclusion ---
20260916T170431Z-2270421 "conclusion": "PASS"
```

⇒ **证明成立**：`20260916T170431Z-2270421` 当年以 `distinctMd5=2` 被记录为 `PASS`；在 floor=3 下同一批帧改判 `retry`（退化 ⇒ 丢弃该 attempt 并在自持显示上重跑），**不再可能静默通过**。同时 `5/5` 的运行仍判 `pass` ⇒ 收紧不是「一律拒绝」。

> 补充：更早的归档状态文件（2026-09-16 全批）**不含** `distinctMd5` 字段（旧格式），故「磁盘归档 → 改判」这条链路我改用「归档 PNG + 当前模块重判」证明，而不是读旧字段。

`build-freshness.cjs` workspace 半区是否真 fail-closed：**是** —— 见 §2.2 的 (i)(ii) 两条（缺失与陈旧均 `ok:false` 且 CLI exit `1`），并有正向对照证明其非无条件失败。

---

## 5. Pipeline 合规检查

- 当前分支：`impl-phase-3-layer-v-smoke-loop` ✅
- 本 Phase 的非 specs 改动全部处于该分支工作区（未提交，符合「implementer 在分支上不自行 commit，由调度者在 HG-3 统一提交」）：`apps/vscode-dsh/src/*`、`apps/vscode-dsh/tests/*`、`apps/vscode-dsh/test-scripts/**`、`scripts/oxlint-contract.spec.ts`、`scripts/run-gates.ts` 等。
- `git log --oneline -3` 显示 `main` 上最近提交为 Phase 1 / Phase 2 的合并提交，**未见非 specs 改动落在 `impl-*` 分支之外**。
- 结论：**✅ 所有变更在 `impl-*` 分支**。
- 审查产物齐备性（四视角）：`review-correctness.md`（**PASS**，17:41 重派后返回）、`review-design.md`（SHOULD-FIX）、`review-connectivity.md`（PASS）、`review-visual.md`（N/A）；`review.md` 合并判决 `SHOULD-FIX`、合计 🔴 = 0。四份原件均存在。

---

## 6. 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|---|:--:|:--:|---|
| 静态守卫覆盖边界：跨行 `$(`（M3）与「保留原行 + 额外 backtick 捕获」（M4）可同时绕过谓词与白名单 | 🟢 LOW | 否 | 独立构造见 §2.3(c)。最坏后果是 `HARNESS_ERROR/4`（fail-closed 误报），**不会**产出假 PASS；且 shipped 调用点当前是直接调用。属测试覆盖范围，按任务口径不计入判决 |
| `mtime` 是必要性判据而非充分条件（`touch lib/**` 可满足） | 🟢 LOW | 否 | 模块头部已**显式声明**该边界，注册表 DEBT-014 亦如实记载；不做内容级比对是已声明的取舍 |
| 归档状态文件缺 `distinctMd5` 字段（旧格式） | 🟢 LOW | 否 | 仅影响「用旧字段做回归」的可行性，已改用「归档 PNG + 当前模块重判」完成证明 |
| 活跃债务 `DEBT-018` / `DEBT-019` 等仍在册 | 🟢 LOW | 否 | 已在注册表登记，非本 Phase AC 覆盖范围，属已声明的推迟项 |

**无 CRITICAL / MEDIUM 残余风险。**

### 主动问题清单（判决非 FAIL/PARTIAL，仍如实列出）

本次判决为 **PASS**，故不适用「为何不是 PASS」清单。仍列出**非阻塞**待办供调度者转述：

1. 🟢 `review-design.md` 🟡-2 的**悬空注释指针**（`run-layer-v-smoke.sh:1173-1174` 指向对 `apps/cli` 零命中的文档）—— 纯文字，不影响功能，标 `[文档保真]`。
2. 🟢 静态守卫 M3/M4 覆盖边界（见 §2.3(c)）—— 若后续要加强，最小改法是补一条「跨行仍是单条语句」检查，当前无功能影响。
3. 🟢 `review-correctness.md` 自述的 `expect(ACTIONS).toContain(summary.action)` 恒真断言 —— 零成本清理项，不参与判决。

---

## 7. 验证脚本

| 脚本 | 用途 |
|---|---|
| `test-scripts/verifier-round6-independent.cjs` | DEBT-014 关闭条件 (i)(ii)(iii) + 正/负向对照；自建临时树驱动 shipped 模块与 CLI 退出码 |
| `test-scripts/verifier-round6-debt017.sh` | DEBT-017 四分支可达性 + 缺陷机理运行时双向复现 + 静态守卫覆盖边界探查 |

两个脚本均**未修改仓库任何文件**（写入仅落 `$TMPDIR` 与 stdout），可独立重跑：

```bash
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness
node .specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/test-scripts/verifier-round6-independent.cjs
bash .specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/test-scripts/verifier-round6-debt017.sh
```

---

## 8. 债务关闭判定（调度者需要的明确结论）

### `DEBT-014`：✅ **可关闭**

| 关闭条件 | 我的独立构造 | 结论 |
|---|---|:--:|
| (i) 陈旧 sibling ⇒ 非 0 | 自建 `/tmp` 树：sibling `lib` 早于自身 `src` ⇒ `ok=false reason=workspace-artifacts-stale`，CLI `exit=1` | ✅ |
| (ii) 未构建 sibling ⇒ 非 0 | 自建 sibling 仅 `src`、无 `lib` ⇒ `ok=false reason=workspace-artifacts-absent`，CLI `exit=1` | ✅ |
| (iii) 每个 tsdown workspace 成员要么在比较 glob 内、要么被显式命名排除 | `members=["vendor/*","packages/*/*","apps/cli","apps/vscode-dsh"]`，`uncovered=[]`，且**负向对照** `apps/new-tool` 被正确报出；脚本实际展开的 glob 与 spec 断言一致 | ✅ |
| 附加：拒绝不是无条件的 | 健康 sibling ⇒ `ok=true`，CLI `exit=0` | ✅ |

**理由**：三条条件连同正/负向对照全部由我独立构造并实测成立；app 半区与 workspace 半区均为 fail-closed。判据边界（mtime 必要性而非充分性）已在模块头部与注册表中如实声明，属已披露取舍而非缺陷。

### `DEBT-017`：✅ **可关闭**

| 关闭条件 | 我的独立构造 | 结论 |
|---|---|:--:|
| 缺陷在 ⇒ 测试红 | 同一 harness 内以 `$( … )` 捕获 ⇒ `LEGACY-BRANCH=OTHER -> HARNESS_ERROR/4 action=[]`（动作词在父 shell 丢失，落 `*`） | ✅ |
| 修复在 ⇒ 绿 | 同一次运行的直接调用 ⇒ `BRANCH=pass retry=false`；`display-evidence-shell.spec.ts` 11/11 绿 | ✅ |
| `pass` / `retry` / `skip` / `*` 各有 ≥1 条可达路径 | 四条均由真实帧 + 真实模块在运行时实得（见 §2.3(a) 表） | ✅ |
| `retry` 真正置 `DISPLAY_RETRY_REQUIRED=true` | `retry` 例实得 `retry=true`（`skip` 例为 `false`，对照成立） | ✅ |

**理由**：双向对照成立、四分支运行时可达、`retry` 的 R2.3 触发变量被真实置位。**附带声明覆盖边界**：静态守卫对跨行 `$(`（M3）与「额外 backtick 捕获且保留原行」（M4）不设防 —— 但该边界的最坏后果是 `HARNESS_ERROR/4`（fail-closed），不产生假 PASS，故不构成阻塞关闭的缺口。

> 两条债务的注册表状态可由调度者据此迁入「已解决」；我未修改 `tech-debt-registry.md`（不属 verifier 产出面）。
