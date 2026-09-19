# Correctness Review — Phase 1（phase-1-closure-foundation）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 三元闭环判定（①实际触发+②具体断言+③真实截图 齐备才 closed） | `capability-runner.cjs:417-444` `assessClosedLoop` | ✅ | 已读函数体 + fixture dry-run：完整闭环 → `closed:true, missing:[]`；仅 UI-prep 触发 → `closed:false, missing:[actualTrigger,concreteAssertion]`；缺截图 → `closed:false, missing:[realScreenshot]` |
| AC-2 | 弱证据（panelOpen/viewId 等）不得记「验证通过」 | `capability-runner.cjs:360-400` `classifyAssertionStrength` + `:333-341` `classifyPredicate` | ✅ | 11/11 fixture 全过：`panelOpen:true`/`viewId`/`$string`/`ok:true`→weak；`$assistantContains`/`hits:[{$contains}]`/`ok:false`/`outcome:created`→concrete；`$bogus`/无 expect→unknown+reason。weak 断言使 `concreteAssertion=false` → 不闭环 |
| AC-5 | 复用 `run-layer-v-smoke.sh` 的显示/Node/沙箱/凭证/进程逻辑，不改共享 runtime/primitives | git diff 静态核对 | ✅ | `primitives.cjs` / `layer-v-runtime.sh` **不在 diff 中**；`MATCHERS`（`:203-210`）与 `matchesExpect`（`:276`）**零改动**（diff 仅 `:294` 之后纯新增）；shell 仍 `. layer-v-runtime.sh`，`ARTIFACT_DIR` 变量名保留供 `prepare_sandbox` |
| AC-7 | journal 逐步追加、崩溃可定位 | `extension.cjs:66-73` `appendJournal`（未改）+ `:100` journalPath 迁至 per-run | ✅ | `appendJournal` 仍 `appendFileSync` 逐行追加，未改；`journalPath = path.join(artifactDir,…)` 且 `artifactDir=resolveArtifactDir(plan)=RUN_DIR`，逐行追加语义不变，落点随 per-run 隔离 |
| AC-8 | 退出码契约 0/1/2/3/4 不变、不合并/降级 | `capability-runner.cjs:74` `CONCLUSION_PRECEDENCE`（未改）+ `run-layer-v-capabilities.sh:413-429` case 映射（未改） | ✅ | mock host 复验：无 key+requiresModel→`SKIPPED_NO_CREDENTIALS`；空选择→`HARNESS_ERROR`；全 PASS→`PASS`；step 抛异常→`LINK_FAILURE`/`HARNESS_ERROR`。`closedLoop` 为 per-capability 正交维度，无新退出码 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| （无 STUB-* 条目） | — | — | registry 中无 STUB 桩条目 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | 所有新增函数（`classifyPredicate`/`classifyAssertionStrength`/`assessClosedLoop`/`unclosedLoop`）均有真实逻辑，无空实现/假返回/占位 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **[文档保真/偏差 2]** `classifyAssertionStrength` 返回 `{strength, reason}` 对象而非 design.md 骨架的裸字符串。底层主张为真——这是满足 AC-2「未知形态 → `unknown` 且 **reason 显式记录**」的唯一最小结构（裸字符串无法承载 reason）；`assessClosedLoop` 内部用 `.strength === 'concrete'` 自洽。verifier 需按 `.strength` 字段断言，而非裸值相等。非交付物缺陷，不参与判决。
- **[偏差 1]** `extension.cjs` 的 `driver.planPath` 由 `path.join(artifactDir,…)` 改为 `path.join(FALLBACK_ARTIFACT_DIR,…)`。per-run 改造后 `artifactDir` 指向 `runs/<runId>/`，而 plan 实为稳定 base 路径；该字段仅作 status.json 元数据、无下游消费者，改动使记录恢复准确，无行为影响。
- `finish()` 去掉了 `[ -d "${ARTIFACT_DIR}" ]` 守卫，改为 `fs.mkdirSync(path.dirname(summaryPath), {recursive:true})` 自行创建 `RUN_DIR`；status 不存在时 `try{}catch{}` 兜底写全零 `closureSummary`。早退路径（如 node 解析失败）下 NODE_TOOL 非空时会写一份空 summary 到 RUN_DIR——无害（fail-closed 语义未被破坏）。
- `closureSummary.byGroup[g].total` 对 skipped 项也计数，而 `closed+notClosed` 只计非 skip 项，故含 skip 的组会出现 `total > closed + notClosed`。与本 Phase 覆盖组（react-spa-main / editor-panel，全非模型）无关，且与 design 的独立 `skipped` 顶层字段语义一致，非缺陷。

## 逐项专项核对（任务硬约束）

| 核对点 | 结论 | 证据 |
|--------|:--:|------|
| `classifyAssertionStrength` / `assessClosedLoop` 满足 AC-1/AC-2 三元判定，weak 不得记通过 | ✅ | fixture 11/11 + 三元判定 4 场景复验全过（见 AC-1/AC-2 行） |
| `runCapability`/`runManifest` 返回携带 `closedLoop`，skip/catch 分支覆盖（repo-exploration 提到的 :572/:586 无 steps records） | ✅ | 成功路径 `:683` `closedLoop: assessClosedLoop(cap, records)`；skip 分支 `:745` 与 catch 分支 `:760` 均 `unclosedLoop(...)`（全 false + 三缺项），mock 复验 case1/case4 覆盖 |
| per-run 隔离正确 | ✅ | `ARTIFACT_DIR`(base) 保留；`PLAN_PATH` 稳定 base；`RUN_DIR/STATUS/SUMMARY/JOURNAL` per-run；`write_plan` artifactDir→`RUN_DIR`；driver `readPlan` 读 base、`resolveArtifactDir` 返回 `RUN_DIR`，shell↔driver 同源无错位 |
| 退出码映射 0/1/2/3/4 不变 | ✅ | case 映射与 `CONCLUSION_PRECEDENCE` 均不在 diff，mock 复验一致 |
| 未误改 `primitives.cjs` / `layer-v-runtime.sh` / `MATCHERS` | ✅ | 三者均不在 diff（`MATCHERS`/`matchesExpect` 为 capability-runner.cjs 内既有块，diff 确认未触碰） |
