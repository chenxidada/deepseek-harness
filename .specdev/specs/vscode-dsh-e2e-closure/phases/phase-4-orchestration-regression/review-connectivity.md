# Connectivity Review — Phase 4

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

## 端到端路径追踪

### Path 1: 编排入口 → 分批 → 能力编排 → 驱动（主链路）
```
Entry: bash run-vscode-dsh-e2e-closure.sh [--batch nonmodel|model]
  → main() 解析 --batch（默认 both）                          ✅
  → preflight() 校验 APP_DIR/MANIFEST/CAPABILITIES_SCRIPT/INDEX 均存在 ✅
  → resolve_node() 定位 node 解释器                            ✅
  → run_batch "nonmodel":
      batch_ids "nonmodel" 读 manifest 按 requiresModel!==true 派生 id 列表（18 项）✅
      rm -f PLAN_PATH（清除上一 batch 的陈旧 plan）            ✅
      LAYER_V_CAPABILITY_ONLY="<18 ids>" bash run-layer-v-capabilities.sh  ✅
        → CAPABILITY_ONLY="${LAYER_V_CAPABILITY_ONLY:-...}"（:67）✅ 环境变量透传
        → write_plan 把 CAPABILITY_ONLY 序列化为 selector.only 写入 PLAN_PATH  ✅
        → 驱动 extension.cjs runAll 读 plan.selector → runManifest
        → capability-runner.cjs selectCapabilities(manifest, {only}) 按 group/id 匹配 ✅
        → 退出码 case 映射（0/1/2/3/4）                         ✅
  → run_batch "model": 同上，requiresModel===true 派生 23 项      ✅
  → aggregate_exit 跨 batch 取最坏退出码（见 Path 2）          ⚠️ 边界缺陷
  → 每 batch append_index_row 经 artifact-index.cjs append 落盘   ✅
Exit: aggregate 退出码（0/1/2/3/4）
```
**判定**: ✅ 主链路从入口到驱动全连通；`LAYER_V_CAPABILITY_ONLY` → `CAPABILITY_ONLY` → `selector.only` → `selectCapabilities` 四段 id 传递一致。

### Path 2: 跨 batch 退出码聚合
```
Entry: codes=() 收集 nonmodel/model 两批的退出码
  → severity_of(): 4→4, 1→3, 2→2, 3→1, 0→0, 未知→4      ✅ 优先级 4>1>2>3>0 与文档一致
  → aggregate_exit(): 遍历取最高 severity，平手保留先出现者
      worst-first 定义正确：HARNESS_ERROR > LINK_FAILURE > SKIPPED_NO_DISPLAY > SKIPPED_NO_CREDENTIALS > PASS
Exit: worst_code
```
**判定**: ⚠️ SHOULD-FIX — 优先级定义与 2>3 的语义正确，但「未知退出码」有一个平手残留缺陷（见 Must/Should-Fix 汇总）。

### Path 3: artifact-index 行拼接
```
batch 结束后:
  → build_closure_row(code, conclusion)
      → 读 PLAN_PATH 取 runId/artifactDir
      → 读 <artifactDir>/layer-v-capabilities-summary.json 取 finishedAt/conclusion/exitCode/closureSummary ✅
      → 读 <artifactDir>/layer-v-capabilities-status.json 取 capabilities[] 的截图映射 ✅
  → artifact-index.cjs append INDEX_PATH row（首个占位行被替换）
      → INDEX_PATH = .specdev/specs/vscode-dsh-e2e-closure/artifact-index.md ✅
Exit: 行落盘成功，或「plan 缺失时」以 shell 自身 conclusion/exit 记录、closure 记 "—" ✅
```
**判定**: ✅ 生产者（finish() 写 summary/status）→ 消费者（build_closure_row 读同字段）契约一致；字段名 finishedAt/conclusion/exitCode/closureSummary.closed/total 全部对齐。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `batch_ids()` | `run_batch()` | ✅ | 读 `layer-v-capabilities.json` | ✅ |
| `run_batch()` | `main()` | ✅ | `run-layer-v-capabilities.sh`（经 `LAYER_V_CAPABILITY_ONLY`） | ✅ |
| `LAYER_V_CAPABILITY_ONLY` | 编排入口 export | ✅ | `run-layer-v-capabilities.sh` :67 `CAPABILITY_ONLY` | ✅ |
| `CAPABILITY_ONLY` | `write_plan` :144 | ✅ | `selectCapabilities`（经 plan.selector.only） | ✅ |
| `build_closure_row()` | `append_index_row()` | ✅ | 读 summary/status/plan JSON | ✅ |
| `append_index_row()` | `run_batch()` | ✅ | `artifact-index.cjs append` | ✅ |
| `severity_of/aggregate_exit` | `main()` | ✅ | —（纯函数） | ✅ |
| DEBT-6 `rm -f` 清 base 兜底 | `run-layer-v-capabilities.sh` :388-390 | ✅ | 清 `${ARTIFACT_DIR}/layer-v-capabilities-{status,journal}` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| 编排入口 → run-layer-v-capabilities | env `LAYER_V_CAPABILITY_ONLY`（逗号分隔 id） | `CAPABILITY_ONLY="${LAYER_V_CAPABILITY_ONLY:-...}"`（:67） | ✅ |
| plan.selector.only → selectCapabilities | `only` 是 string[]，匹配 group 或 id | `wanted.has(cap.group) \|\| wanted.has(cap.id)`（:479） | ✅ |
| finish() summary → build_closure_row | `finishedAt/conclusion/exitCode/closureSummary{closed,total}` | 同名字段（run-layer-v-capabilities :259-265 vs closure :183-188） | ✅ |
| 编排入口 PLAN_PATH ↔ 能力脚本 PLAN_PATH | 同一稳定路径 `layer-v-capabilities-plan.json` | 两脚本同名同值（closure :45 / capabilities :52） | ✅ |
| aggregate_exit 未知码 | 期望退出码 ∈ {0,1,2,3,4} | 未知码原样返回，仅 severity 置 4 | ⚠️ 见下 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `run-layer-v-capabilities.sh` 编排/隔离/退出码 | Phase-1/2/3 | 已冻结，未改语义 | ✅ |
| `capability-runner.cjs` `selectCapabilities`/`assessClosedLoop`/`CONCLUSION_PRECEDENCE` | Phase-1 | 已冻结，未改 | ✅ |
| `layer-v-runtime.sh` / `primitives.cjs` 共享原语 | Phase-1 | 已冻结，未改（AC-5） | ✅ |
| `artifact-index.cjs append` | Phase-1 | 已冻结，未改 | ✅ |
| `FALLBACK_ARTIFACT_DIR` 兜底路径 | Phase-1 | DEBT-6 以 shell `rm -f` 清理孤儿文件，不动该路径 | ✅ |

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- **S-1（跨 batch 退出码聚合的未知码平手残留）**：`severity_of` 把未知退出码（硬崩溃，非契约五值之一）映射为 severity `4`（与 `HARNESS_ERROR` 同档），但 `aggregate_exit`（:138-148）返回的是 `worst_code` 原始值而非规范码。当某 batch 硬崩溃返回未知码（如 137/139）且另一 batch 为 `HARNESS_ERROR`(4) 时，两者 severity 同为 4，平手保留「先出现的 batch」——若先出现的是未知码，最终 `exit` 会原样吐出 137/139 之类非契约码，违背「聚合只取最坏单码、不做猜测」与 help 文本「Exit code 0/1/2/3/4」的契约。修复建议：`severity_of` 的 `*)` 分支应在聚合时归一化为契约码 `4`（fail-closed），或将未知码视为 code 4 参与 `worst_code` 计算，而非仅改 severity。影响面窄（仅在「一 batch 硬崩溃 + 另一 batch HARNESS_ERROR」同时发生时触发），且仍为非零退出（下游 CI 仍判失败），故定 SHOULD-FIX 而非 MUST-FIX。

### 🟢 Observations
- **[文档保真] `artifact-index.md` `Produces` 措辞反向**：`Produces:` 后紧跟的是「产出该索引的脚本」`run-vscode-dsh-e2e-closure.sh`，字面读成「本索引产出该脚本」，语义应表达为「本索引由该脚本产出」。路径真实存在、描述准确，仅标签措辞歧义，对交付物零影响，不参与判决。
- **`extension.cjs:190` `let outcome` 疑似死变量**：`activate()` 声明 `let outcome` 但 `outcome` 从未被赋值即被 `catch` 后的分支使用（:221-224）。该行为**不在本 Phase 改动范围**（Phase 4 未改 `extension.cjs`），且运行时 `outcome` 为 `undefined` 时走 `?? FALLBACK_ARTIFACT_DIR` 分支，不产生功能性断裂，故仅记录，不改判。
- **`run-chat-ready-regression.sh` 头部注释纯注释确认**：第 2-16 行的 obsolete 注释全部以 `#` 开头、位于 `set -euo pipefail`（:17）之前，无逻辑副作用；`bash -n` 通过。其余破损（10 个不存在测试文件、异工作流 registry）为方案 C 明确保留的既有死逻辑，已登记 DEBT-11，非本 Phase 新增连通断裂。

## 结论

主链路（分批 → id 透传 → 能力编排 → 驱动匹配 → 退出码 → 索引落盘）端到端连通，跨 Phase 依赖接口全部冻结未改，DEBT-6 清理仅作用于 base 兜底诊断文件、不影响 RUN_DIR 正常路径。唯一缺陷是跨 batch 退出码聚合在「未知退出码」与 HARNESS_ERROR 平手时会原样吐出非契约码，属聚合逻辑边界遗漏，判 **SHOULD-FIX**。
