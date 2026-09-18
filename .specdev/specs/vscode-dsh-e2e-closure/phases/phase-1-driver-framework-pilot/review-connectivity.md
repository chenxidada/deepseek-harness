# Connectivity Review — Phase 1（回炉复审，loop_count=1）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 复审焦点结论（先给结论）

| 焦点 | 结论 |
|------|------|
| 1. journal 数据路径（runner 回调 → extension appendFileSync） | ✅ 完整连通，分层正确 |
| 2. `plan.artifactDir` 唯一真相源（shell 写 → driver 读） | ✅ 输出单点派生，回退显式 |
| 3. 三条端到端路径（编排→共享库→EDH→回传；driver↔runner；smoke.sh source） | ✅ 全部连通，未断裂 |
| 4. 可插拔匹配器重构是否破坏 runner↔extension 契约（8 个 require 符号） | ✅ 8 符号全导出 |

---

## 端到端路径追踪

### Path 1: journal 逐步追加（runner 回调 → extension 落盘）
```
Entry: runCapability 每步执行完毕（command/assert/wait/screenshot）
  → emit({ step, kind, verdict, evidence, detail })            ✅ 成功/失败均 emit
  → 失败分支先 emit FAIL 行再 throw StageError                   ✅ crash-localisable
  → opts.journal 包装为 { capability: cap.id, ...entry }       ✅ capability 字段注入
  → runManifest 透传 options（含 journal）给 runCapability       ✅ 回调贯穿
  → extension.cjs: journal = entry => appendJournal(journalPath, artifactDir, entry)  ✅ 绑定
  → appendJournal: mkdirSync(artifactDir) + appendFileSync(journalPath, JSON)          ✅ 落盘
Exit: <artifactDir>/layer-v-capabilities-journal.jsonl 逐行追加（40 行实测）
```
**判定**: ✅ 数据路径完整。runner 只调用注入回调（不 import vscode、不决定路径），extension 负责路径/落盘 —— 分层与首轮一致且正确。`runManifest` 的 credential-gate 跳过行与 `runCapability` 的逐步行最终都汇入同一个 `appendJournal`。

### Path 2: 编排脚本 → 共享库 → EDH → 状态回传（主闭环）
```
Entry: run-layer-v-capabilities.sh main()
  → source layer-v-runtime.sh (line 109)                        ✅ 共享运行时
  → prepare_sandbox → resolve_display → baseline_processes      ✅ 来自共享库
  → write_plan: 写 plan（含 artifactDir=ARTIFACT_DIR 绝对路径） ✅ shell 侧真相源
  → launch_host: --extensionDevelopmentPath=${DRIVER_DIR}       ✅ 加载能力驱动
  → driver activate() → runAll() → readPlan() → resolveArtifactDir(plan)
      → 写 status 到 plan.artifactDir                            ✅ 回写 shell 读取目录
  → shell wait_for_status 读 ${ARTIFACT_DIR}/layer-v-capabilities-status.json
  → 映射 driver_conclusion → set_conclusion → exit_now
Exit: exit 0（真机实测 PASS）
```
**判定**: ✅ 闭环连通。`plan.artifactDir`（shell 的 `ARTIFACT_DIR`）与 driver 的 `FALLBACK_ARTIFACT_DIR` 均为同一绝对路径 `.../apps/vscode-dsh/test-artifacts/layer-v-capabilities`，文件名 `layer-v-capabilities-plan/status/journal.json[l]` 两侧逐字一致（shell 侧 `run-layer-v-capabilities.sh:45-49`，driver 侧 `extension.cjs:99-100`）。

### Path 3: driver ↔ runner 接口契约
```
Entry: extension.cjs require('./capability-runner.cjs')
  8 个符号: StageError / harnessError / safeJson / resolveCaptureTool /
            captureScreenshot / runManifest / nowIso / truncate     ✅ 全导出
  → runManifest(manifest, host, { selector, hasCredential, stepTimeoutMs, journal })
      host.executeCommand(id, ...args) → vscode.commands.executeCommand  ✅
      host.capture(fileName)          → captureScreenshot(capture, fileName, artifactDir)  ✅
Exit: 能力 verdict 聚合 → status.conclusion
```
**判定**: ✅ 契约一致。`capability-runner.cjs` 的 `module.exports`（`capability-runner.cjs:705-732`）包含 extension 所需全部 8 个符号；测试文件所需的 `matchesExpect/selectCapabilities/runManifest/overallConclusion/resolvePath/deepEqual/MATCHERS/resolveMatcher/typePredicate/linkFailure` 也全部导出。

### Path 4: smoke.sh source 共享库（AD-1 行为保持）
```
Entry: run-layer-v-smoke.sh
  → 定义 globals（NOTES/CONCLUSION/NODE_DIR_CANDIDATES/SCREEN_GEOMETRY/APP_DIR/ARTIFACT_DIR…, line 57-207）
  → source layer-v-runtime.sh (line 213)                          ✅ 库读全局，全局先定义
  → 保留 caller-specific finish() (line 2222) + main() (line 2409) → main "$@" (2468)
Exit: 共享函数（resolve_node/launch_host/prepare_sandbox/resolve_display/set_conclusion/
      cleanup/exit_now/baseline_processes/reclaim_run_processes）已全部迁入库
```
**判定**: ✅ 连通。grep 确认 smoke.sh 中上述 8 个运行时函数定义已移除（仅存 `finish()` 一处 caller-specific 定义），行为由共享库承接；两脚本 source 同一份实现，无第二份函数体。

---

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `runManifest()` | `extension.cjs runAll()` | ✅ | `runCapability()` + `selectCapabilities()` + `overallConclusion()` | ✅ |
| `runCapability()` | `runManifest()` | ✅ | `host.executeCommand` / `host.capture` / `opts.journal` | ✅ |
| `appendJournal()` | `extension.cjs` 的 `journal` 绑定 + `activate()` | ✅ | `fs.appendFileSync(journalPath)` | ✅ |
| `resolveArtifactDir()` | `runAll()` | ✅ | `plan.artifactDir`（回退 `FALLBACK_ARTIFACT_DIR`） | ✅ |
| `readPlan()` | `runAll()` | ✅ | `FALLBACK_ARTIFACT_DIR/layer-v-capabilities-plan.json` | ✅ |
| `resolveMatcher()` | `matchesExpect()`（经 `typePredicate`） | ✅ | `MATCHERS` 注册表 | ✅ |

---

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| runner → journal | `journal(entry)` 逐步回调，entry 含 capability/step/verdict | extension 绑定 `appendJournal(journalPath, artifactDir, entry)`，注入 `ts` | ✅ |
| shell → driver（plan） | `plan.artifactDir` 命名输出目录 | `resolveArtifactDir` 读 `plan.artifactDir`，非空则用 | ✅ |
| shell → driver（manifest） | `plan.capabilitiesManifestPath` 命名清单 | `readManifest(plan.capabilitiesManifestPath)` | ✅ |
| driver → shell（status） | shell 读 `${ARTIFACT_DIR}/...status.json` | driver 写 `path.join(artifactDir, '...status.json')` | ✅ |
| driver → shell（journal 文件名） | shell 清理 `${ARTIFACT_DIR}/layer-v-capabilities-journal.jsonl` | driver 写同文件名 | ✅ |
| runner → MATCHERS | `$string/$number/$boolean/$object/$array/$present` + `$array:N` | 注册表恰含 6 项 + 内联 `$array:N` 解析 | ✅ |
| 未知谓词 | 不得静默通过 | `resolveMatcher` 返回恒假 `() => false`（fail-closed） | ✅ |

---

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `layer-v-support/layer-v-runtime.sh`（共享运行时） | 本 Phase 新建（AD-1） | 冻结为唯一实现，两脚本 source | ✅ |
| `layer-v-capability-driver` 的 `MATCHERS` 注册表 | 本 Phase 新建 | 预留扩展位（Phase 2/3 加 `$selector`/`$visible`） | ✅ |
| `layer-v-driver/extension.cjs` 原语 | 既有（AD-2 不改） | 语义复制，登记 `DEBT-1`（非阻塞，目标 phase-5） | ⚠️ 已登记 |

> DEBT-1 说明：断言原语语义复制（非 require 复用）已登记技术债，目标 `phase-5-cleanup-orchestration-regression`。这是**已知、已登记**的漂移风险，非未察觉的断裂；连通性上不构成 MUST-FIX。

---

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **plan 文件定位仍是 `__dirname` 二次推导**：`readPlan()` 从 `FALLBACK_ARTIFACT_DIR`（`__dirname` 相对推导）定位 `layer-v-capabilities-plan.json`，与 shell 的 `ARTIFACT_DIR`（`SCRIPT_DIR` 相对推导）是**两套独立推导**。当前两者硬编码相等、真机实测一致，且若未来单侧改动导致分叉，故障是**响亮的**（plan-not-found → HARNESS_ERROR，或 status 超时 → HARNESS_ERROR），非静默。因 plan 文件路径必须先于读 plan 而存在（读 `plan.artifactDir` 前必须知道 plan 在哪），此耦合本质上无法完全消除，属可接受的固定契约。仅作未来维护观察项：若后续有人改 `run-layer-v-capabilities.sh` 的 `ARTIFACT_DIR`，须同步改 `extension.cjs` 的 `FALLBACK_ARTIFACT_DIR`（或改为经 env 传递 plan 路径，彻底单源）。
- **journal 的 `step: null`（credential-gate 行）**：`runManifest` 的 credential-gate 跳过行 `step` 为 `null`（`capability-runner.cjs:674`），与逐步行 `step` 为字符串不同。语义合理（无步骤可定位），且 design.md「journal 行」契约要求的是 `capability/step/verdict` 字段**存在**，未强制非空字符串。不构成断裂。

---

## 复审结论

首轮两项 SHOULD-FIX 已修复且未引入新断裂：

1. **SHOULD-FIX-1（journal 落错工件）**：journal 已改为逐步追加，runner 只调注入回调、extension 负责路径/落盘的分层正确，真机实测 40 行逐步记录，崩溃可定位（每步成功/失败均先写再抛）。
2. **SHOULD-FIX-2（`plan.artifactDir` 写了没人读）**：输出（status/journal/screenshot）已改读 `plan.artifactDir` 为唯一真相源，回退分支显式注释且仅在 plan 缺失 `artifactDir`（harness 缺陷）时触发；`__dirname` 仅残留于「定位 plan 文件」这一无法回避的固定契约（见 Observation）。

三条端到端路径（编排→共享库→EDH→状态回传、driver↔runner、smoke.sh source 共享库）均连通且契约一致，8 个 require 符号全导出，真机闭环 PASS(exit 0) + 反桩测试 21 passed 佐证连通性无回归。
