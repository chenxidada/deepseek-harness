# Correctness Review — Phase 3（round-5 复审）

## 视角
**Implementation Correctness** — 代码是否正确工作（只审实现正确性；设计/连通性/视觉分别由并行视角负责）

## 判决
**PASS**

> 范围：`scope-amendment-02.md` §8.1 六项在 round-5 工作区的落地，聚焦调度者指派的 5 个核查点。
> 本次为**重派**（上一次停摆），按派单约束未跑 90s 级 `oxlint-contract.spec.ts` 全套；证据类别在每行注明。

## 独立核查结果（5 个指派点）

| # | 核查点 | 判定 | 独立证据 |
|--:|---|:--:|---|
| 1 | `MIN_DISTINCT_MD5` `2 → 3` 且仅一处写值 | ✅ | `display-evidence.cjs:39` 是唯一数值定义；`display-evidence-shell.sh:151-157` **从模块读取**并在空值时 `fail_harness`（不重述常量）；`run-layer-v-smoke.sh:170` 仅为 sourcing 前的空串复位。规格面一致：`spec.md:187`(AC-26(e)) 与 `:304`(R2) 均为 `≥ 3`，`AC-28 R2.3` 以前件方式引用 AC-26(e)、未残留数字；全文仅存「由 ≥ 2 收紧」的历史叙述（`spec.md:187/304`），属追溯而非口径 |
| 2 | `build-freshness` workspace 半区真 fail-closed | ✅ | **执行 shipped 模块**（非读码）：无 `lib` → `ok:false / workspace-artifacts-absent`；`lib` 早于 `src` 1h → `ok:false / workspace-artifacts-stale`；`lib` 新于 `src` → `ok:true`。聚合分支 `build-freshness.cjs:206-216` 在任一 sibling 失败时返回 `ok:false`（取首个失败原因码） |
| 2b | 比较集 vs `tsdown.config.ts` workspace 集**被测试断言** | ✅ | `build-freshness.spec.ts:359-378`：从 `tsdown.config.ts` 读 `workspace` 列表 → 断言「每个成员要么落在 `COMPARED_GLOBS=['vendor/*','packages/*/*']`、要么在显式排除集 `OUTSIDE_THE_GLOBS=['apps/vscode-dsh','apps/cli']` 内」→ `uncovered===[]`；且有**反空跑护栏** `expect(members.length).toBeGreaterThan(3)`（`:363`）。脚本侧 `run-layer-v-smoke.sh:1174-1176` 按同一两 tier glob 展开 |
| 3 | `homeSandboxOf` 不可用确实上转 `harnessError` | ✅ | **执行 shipped 模块**：7 类不可用输入（缺字段 / 空串 / 绝对不存在 / 相对不存在 / number / null / 非对象）**全部 `ok:false`**；`staleProductState('')` 抛 `TypeError(/homeSandboxOf/)`。调用侧 `extension.cjs:2293-2299` `ok!==true` ⇒ `harnessError('sandbox-clean-state-check-unavailable')`；每步扫描传**已校验**的 `sandboxHome.value`（`:2312`） |
| 4 | `sandbox-clean-state.spec.ts` 期望改为「空即拒绝」 | ✅ | `:195-201`：`homeSandboxOf({homeSandbox:''})` 断言 `ok:false` + `value===''`，并在注释说明「被替换的期望曾是 `checkedRoots:[] / offenderCount:0`（空即干净）」；`:145-149` 另断言 `staleProductState('')` 抛错而非空扫描 |
| 5 | `oxlint-contract.spec.ts` 的 `owned` 契约非恒真、且为等价/更强实现 | ✅ | `:120-123` `owned` = 两个**确在** `apps/vscode-dsh/tests/tsconfig.json` `include`（9 项显式列举）内的 spec；`:124,:148-150` 断言 `notOwned=chat-ux-session-search.spec.ts` 解析为 `<none>`（该文件确**不在** include 内）。归属若被破坏（文件被移出/改名），`Got tsconfig …: <none>` 即令断言失败 ⇒ **非恒真**。旁证：单文件 lint `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests/display-evidence.spec.ts` → 0 诊断（若归属失效会出现成片 `no-unsafe-*`） |

## 逐条 AC 验证（与本轮改动相关的 AC）

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-26(e) | 同一次运行 5 张截图 md5 不同数 `≥ 3`，并把实际数记账 | `display-evidence.cjs:39/110`；`display-evidence-shell.sh:151-157` | ✅ | 常量单点 = 3；2 distinct ⇒ `degenerate:true` ⇒ `judgeEvidence` → `retry`；3 distinct ⇒ `pass`（**实跑**）。记账字段由消费侧回传（调度者已独立复测四分支 + `retry⇒DISPLAY_RETRY_REQUIRED=true`，本次不重复） |
| AC-28 R2.3 | `reuse` 仅在能产出满足 AC-26(e) 证据时可采用，否则改走 `xvfb` | `display-evidence-shell.sh:169-217`（`case` 四分支） | ✅ | 静态：`case` 判 `DISPLAY_EVIDENCE_ACTION`（非 stdout 串接）、`retry` 置 `DISPLAY_RETRY_REQUIRED`；证据类别 = 调度者已独立复测（消费侧缺陷解除），本次未重复 live 验证 |
| `spec.md:197`(第三子项) | lint 门禁对本 Phase 新增资产可失败（`.cjs` override + `.sh` 解析门禁） | `.oxlintrc.json:341`；`scripts/check-test-scripts-syntax.sh` → `run-gates.ts:312` | ✅（范围限定） | 单文件 lint 0 诊断；归属契约可失败（见核查点 5）。**仓库级基线 `DEBT-019` 属用户裁定排除项**，不在判定内 |
| `spec.md:199`(洁净判据) | 「每步开始前沙箱产品状态为空」，缺失 home/时刻即 `HARNESS_ERROR` | `sandbox-clean-state.cjs:36-67/89-92`；`extension.cjs:2286-2299` | ✅ | 实跑：`runStartedAtMsOf(0).ok=false`；7 类 home 不可用全拒绝；空 home 抛错；调用侧上转 `harnessError` |
| AC-33 | `artifact-index` 自断言必须能失败 | `artifact-index.cjs`（`planRowWrite`/`inspectRow`/`describeProblem`）+ 脚本按退出码消费 | ✅（沿用 round-4 证据） | `DEBT-016` 已迁「已解决」，`implementation.md` §7.7 (3) 给出三类失败面各退出码 1；本轮未改动该链路 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | 本 Phase 交付面内**无** `@STUB(...)` 标记（`implementation.md:769` 自检 + 本次对 `test-scripts/**` 与 4 个新 spec 的 grep 复核，零命中） |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | `artifact-index.cjs` 中的 `placeholderReplaced` 是 `## Runs` 表体占位符语义，非桩代码 |

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- 无（功能契约均成立；未发现「功能成立但有实质缺口」的项）。

### 🟢 Observations
- `[文档保真]` **核查点 5 的字面形态未采用，但替代实现等价或更强**：`scope-amendment-02.md` §8.1 第 3 项要求「在 `probes` 列表补一行 `['vscode app test','apps/vscode-dsh/tests','apps/vscode-dsh/tests/tsconfig.json']`」。该目录的 tsconfig 用**显式文件列举**，scratch 探针必然解析为 `<none>` ⇒ 字面形态**物理不可满足**（`implementation.md` **D28** 已如实披露并标注「需调度者确认」）。`owned` 形态断言的是**真实承载风险的文件**（本 Phase 清零 `no-unsafe-*` 的两个 spec）归属到该 tsconfig，并**同时断言边界**（非所属 spec 为 `<none>`）——就「消灭无人断言的文件归属」这一目的而言，**可失败且指向真实文件**，强于一个恒红的探针行。**调度者的确认动作仍待完成**，不影响实现正确性判定。
- `[文档保真]` `tech-debt-registry.md` 的段落叙述存在**历史计数与新状态并存**（如 `:36/:58` 的「四条已并迁『已解决』」被 `:73-75` 的订正段取代）。订正段显式声明旧句「不再成立」「仅供追溯」，且 `DEBT-014`/`DEBT-017` 的活跃状态与关闭条件（待 `verifier` 独立构造证据）一致，**无功能影响**。
- `[文档保真]` `homeSandboxOf` 对**存在的相对路径**（如 `.`）返回 `ok:true`。这与文档契约一致（「路径必须存在且为目录」），且脚本传绝对路径；规格中相对路径的用例专指「resolves to nothing」。记录为边界事实，非缺口。
- **证据类别边界（如实声明）**：核查点 5 的「可失败性」由**静态交叉核对**（`include` 与断言的双向映射）+ **单文件 lint 正样本**确立，**未执行** `oxlint-contract.spec.ts` 本身（遵派单「不重跑 90s 级全套」）。`owned` 断言在归属被破坏时的失败路径由前述映射直接推出；若需执行级证据，可由 `verifier` 在独立回合补跑该单测。
- **继承债务状态**：`DEBT-014` / `DEBT-017` 在 registry 保持**活跃**（「修复已在工作区、独立验证未完成」），与其关闭条件（须 `verifier` 独立构造证据）一致 —— 这是流程状态，不构成实现缺陷。
