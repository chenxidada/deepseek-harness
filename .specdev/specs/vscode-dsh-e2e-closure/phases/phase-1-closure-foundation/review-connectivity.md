# Connectivity Review — Phase 1 (phase-1-closure-foundation)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

> 主链路（shell → in-host → shell 双向、per-run 隔离、fail-closed、closureSummary 落盘、退出码映射）全部连通且契约一致；仅 `activate()` 的「driver-failed-before-run」兜底路径的落点与 shell 读取点不一致（1 处 SHOULD-FIX，低危：fail-closed 保留、无假 PASS 风险，但会遗留孤儿文件并丢失诊断 reason）。

## 端到端路径追踪

### Path 1: plan.artifactDir 的 shell → in-host → shell 双向闭环
```
Entry: run-layer-v-capabilities.sh write_plan()
  → RUN_DIR="${ARTIFACT_DIR}/runs/${RUN_ID}"                          (sh:88)  ✅
  → write_plan 传参 ["${PLAN_PATH}","${RUN_ID}","${MANIFEST_PATH}","${RUN_DIR}",...]  (sh:162)
  → plan.artifactDir = "${RUN_DIR}"                                   (sh:154)  ✅ 写入稳定路径 PLAN_PATH=base
  → mkdirSync(artifactDir) 建 RUN_DIR                                  (sh:160)  ✅
Exit: base/layer-v-capabilities-plan.json { artifactDir: runs/<runId> }

in-host: extension.cjs runAll()
  → readPlan() 读 FALLBACK_ARTIFACT_DIR/layer-v-capabilities-plan.json  (ext:78)  ✅
  → resolveArtifactDir(plan) = plan.artifactDir = RUN_DIR              (ext:62)  ✅
  → statusPath  = RUN_DIR/status.json                                 (ext:99)  ✅
  → journalPath = RUN_DIR/journal.jsonl                               (ext:100) ✅
  → writeFileSync(statusPath)                                          (ext:178) ✅

back to shell: wait_for_status()
  → STATUS_PATH="${RUN_DIR}/layer-v-capabilities-status.json"          (sh:89)  ✅ 同路径
```
**判定**: ✅ 数据路径完整。`FALLBACK_ARTIFACT_DIR`（ext:50）= `path.resolve(DRIVER_DIR,'..','..','test-artifacts','layer-v-capabilities')` 与 shell `ARTIFACT_DIR`（sh:47）= `${APP_DIR}/test-artifacts/layer-v-capabilities` 逐段等价，稳定 plan 路径两侧一致；`plan.artifactDir` 是唯一下沉 per-run 目录的真相源，shell 与 in-host 从同一字段收敛到同一 `RUN_DIR`。

### Path 2: journal 逐步追加的 per-run 落点
```
Entry: runCapability 每步 emit → opts.journal(entry)                   (runner:504-505)
  → extension.cjs: journal = entry => appendJournal(journalPath, artifactDir, entry)  (ext:155)
  → journalPath = RUN_DIR/journal.jsonl，artifactDir = RUN_DIR          (ext:100/98)
Exit: RUN_DIR/layer-v-capabilities-journal.jsonl 逐行 JSONL

shell 侧: JOURNAL_PATH="${RUN_DIR}/layer-v-capabilities-journal.jsonl"  (sh:91)  ✅ 同路径
```
**判定**: ✅ journal 落点 per-run 正确；`appendJournal` 契约（`(journalPath, artifactDir, entry)`）未改，逐步追加语义保留。repo-exploration §7.4 担心的「行内硬编码 journal 路径」已消除（现为 `JOURNAL_PATH` 变量，sh:384 `rm -f "${STATUS_PATH}" "${JOURNAL_PATH}"` 也同步为变量）。

### Path 3: wait_for_status 读 status 路径 + fail-closed
```
Entry: wait_for_status()
  → 轮询 [ -f "${STATUS_PATH}" ] && status_belongs_to_this_run        (sh:186)
  → status_run_id_of 读 STATUS_PATH 的 .runId                          (sh:168-174)
  → status.runId = plan.runId = RUN_ID（sh:83 生成 → write_plan:152 → ext:131）
  → 超时/liveness 判定 return 1                                       (sh:180-202)
  → stale_claim 分流（sh:392-399）+ 复检 status_belongs_to_this_run（sh:408-411）
```
**判定**: ✅ `RUN_ID` 全链路一致（sh 生成 → plan.runId → status.runId → shell 回读比对），fail-closed 完整保留：「读到不属于本 run 的 status → HARNESS_ERROR」与「无 status → 超时 HARNESS_ERROR」两条路径均健在，且 `rm -f`（sh:384）只清 `RUN_DIR` 内文件，不存在读旧 flat 残留的可能。

### Path 4: closureSummary 写 summary.json
```
Entry: exit_now() → finish()（layer-v-runtime.sh:102-104 已确认 exit_now 调用 finish）
  → finish() 读 statusPath=STATUS_PATH 的 capabilities[].closedLoop       (sh:229-257)
  → 逐项读 c.group/c.skipped/c.conclusion/c.closedLoop.closed/missing/reason
  → writeFileSync(SUMMARY_PATH, { runId, conclusion, exitCode, ..., closureSummary })  (sh:259-265)
Exit: RUN_DIR/layer-v-capabilities-summary.json
```
**判定**: ✅ 字段对齐已验证——`runCapability`（runner:676-684）返回 `closedLoop=assessClosedLoop(...)`；skip 分支（runner:740-746）与 catch 分支（runner:755-761）均带 `closedLoop=unclosedLoop(...)`，三者都有 `id/group/conclusion/closedLoop`，`finish()` 读取的字段在三处来源中全部存在。`finish` 被 `exit_now` 稳定触发（INT/TERM trap + main 尾部 + 各错误分支）。**下游读取方为 Phase 4 全链入口**（design §核心实体 #3、implementation 偏差 3），本 Phase 无消费者——属「写以待读」的有意设计（非 oversight），但当前确为数据暂存无消费者，见 Observations。

### Path 5: 退出码 case 映射 vs in-host conclusion 词汇
```
in-host 词汇（capability-runner.cjs CONCLUSION_PRECEDENCE，runner:74）
  = ['HARNESS_ERROR','LINK_FAILURE','SKIPPED_NO_CREDENTIALS','PASS']
  （SKIPPED_NO_DISPLAY 由 shell 显示门禁产出，非 driver）

shell case 映射（sh:413-429）
  PASS → 0；LINK_FAILURE → 1；SKIPPED_NO_DISPLAY → 2；SKIPPED_NO_CREDENTIALS → 3；* → 4
```
**判定**: ✅ 完全一致。primitives.cjs:13 冻结词汇 `PASS / LINK_FAILURE / SKIPPED_NO_DISPLAY / SKIPPED_NO_CREDENTIALS / HARNESS_ERROR` = 0/1/2/3/4，shell case 覆盖 driver 可能产出的全部 4 个词汇 + 防御性 `SKIPPED_NO_DISPLAY` + 兜底 `* → HARNESS_ERROR`，无合并、无降级、无猜测。`closedLoop` 是正交维度，不新增退出码。

## 上下游连接检查

| 新函数/变量 | 上游（谁调用/写） | 连接状态 | 下游（谁消费/读） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `assessClosedLoop(cap, records)` | `runCapability` (runner:683) | ✅ | `finish()` 读 `status.capabilities[].closedLoop` (sh:238) | ✅ |
| `unclosedLoop(reason)` | `runManifest` skip/catch 分支 (runner:745/760) | ✅ | 同上 `finish()` | ✅ |
| `classifyAssertionStrength(step)` | `assessClosedLoop` (runner:428) | ✅ | （导出供 fixture dry-run） | ✅ |
| `RUN_DIR` | `write_plan` 传 `artifactDir` (sh:162) | ✅ | `STATUS/JOURNAL/SUMMARY_PATH` + in-host `resolveArtifactDir` | ✅ |
| `SUMMARY_PATH` | `finish()` 写 (sh:266) | ✅ | Phase 4 全链入口（本 Phase 无消费者） | ⚠️ 延后 |
| `driver.planPath` | `extension.cjs` status 元数据 (ext:107) | ✅ | 无（仅 status 记录，无下游读取） | 🟢 无消费者 |
| `activate()` 兜底 status/journal | `extension.cjs` (ext:213/217) | 🔴 | shell `wait_for_status` 读 `RUN_DIR` | ❌ 路径不一致 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| shell `write_plan` → in-host `readPlan` | plan.json 落稳定 base 路径 | `readPlan` 读 `FALLBACK_ARTIFACT_DIR`（=base） | ✅ |
| shell `write_plan` → in-host `resolveArtifactDir` | `plan.artifactDir`=RUN_DIR | `resolveArtifactDir` 返回 `plan.artifactDir` | ✅ |
| in-host 写 status → shell `wait_for_status` | 写 `RUN_DIR/status.json` | shell 读 `RUN_DIR/status.json` | ✅ |
| in-host 写 journal → shell 读 | 写 `RUN_DIR/journal.jsonl` | shell `JOURNAL_PATH` 同路径 | ✅ |
| `runCapability/runManifest` → `finish()` | `capabilities[].closedLoop.{closed,missing,reason}` | 三来源均含该对象 | ✅ |
| in-host `activate()` 兜底 → shell 读 | 写 base `status.json` | shell 只读 `RUN_DIR/status.json` | 🔴 不一致 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `primitives.cjs` 冻结词汇 / `StageError` / `captureScreenshot` | 已存在（共享 support） | 已冻结，本 Phase 未改 | ✅ |
| `layer-v-runtime.sh` 的 `exit_now/finish/set_conclusion/wait` 生命周期 | 已存在（共享 runtime） | 已冻结，`exit_now→finish` 链确认 | ✅ |
| `layer-v-capabilities.json` 的 `steps/expect` | 已存在（manifest） | 未改 | ✅ |
| `closureSummary` 下游读取方（`run-vscode-dsh-e2e-closure.sh`） | Phase 4 | 未实现（本 Phase 只写） | ⚠️ 延后（有意） |

## 关键发现
### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- **`activate()` 的「driver-failed-before-run」兜底路径落点与 shell 读取点不一致**（ext:198-217 vs sh:89/STATUS_PATH）。当 `readPlan`/`readManifest`/`resolveCaptureTool` 在 `runAll()` 内部 try 块（ext:142）之前抛错时，兜底 status 与 journal 写到 `FALLBACK_ARTIFACT_DIR`（base 平铺目录），而 shell 只读 `RUN_DIR/status.json`。后果：① 该兜底产出的失败 reason（`plan-not-an-object`/`manifest-not-a-capability-list` 等）永远到不了 shell，shell 只报泛化「no status file within timeout」；② 兜底 status/journal 落在 base 目录，而 shell 的 `rm -f`（sh:384）现在只清 `RUN_DIR`，这些孤儿文件不再被清理。**缓解说明（降低定级）**：fail-closed 未破——shell 仍 HARNESS_ERROR 退出，无假 PASS；且兜底 status 本就无 `runId` 字段，即便改造前 `status_belongs_to_this_run` 也会拒绝它，故「reason 丢失」是既有事实、非本 Phase 新增，本 Phase 新增的是「孤儿文件不再清理」。建议（可选）：shell 在 `wait_for_status` 超时后，除 `RUN_DIR` 外额外探测 base 路径的「driver-failed-before-run」兜底 status 以回收 reason；或至少在 `rm -f` 时一并清 base 路径的兜底 status/journal。

### 🟢 Observations
- `driver.planPath`（ext:107）为 status 内纯元数据，无任何下游消费者（全仓 grep 无读取方）。deviation 1 已如实声明「无下游消费者」，不影响连通性。
- `closureSummary` 与 `summary.json` 本 Phase 无下游读取方，属「写以待 Phase 4 消费」的有意设计（implementation 偏差 3 已记录），非 oversight。若 Phase 4 被 descope，该数据将成为永久 dead-end，届时需回填消费方。
- `finish()` 仅在 `NODE_TOOL` 非空时写 summary（sh:220）；早期退出分支（如 CLI 参数错误 sh:333/340、preflight 缺文件 sh:359）因 `NODE_TOOL` 尚未解析而跳过 summary，属合理（此时尚无 run 产物）。`wait_for_status` 失败时 `finish()` 仍会写 `closureSummary={total:0,...}`（status 不存在 → 内层 `catch {}` 兜底），不破坏契约。
