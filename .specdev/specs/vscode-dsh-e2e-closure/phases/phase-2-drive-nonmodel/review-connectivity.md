# Connectivity Review — Phase 2（phase-2-drive-nonmodel）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

本 Phase 的核心链路是「manifest 断言 → runner 分类/闭环判定 → status.json 的 `closedLoop` → shell 汇总/退出码 → per-run 隔离」，逐段追踪如下。

### Path 1: manifest 断言 → 闭环判定 → status.json
```
Entry: layer-v-capabilities.json 每项 steps（command/assert/wait/stream/screenshot）
  → capability-runner.cjs runManifest (:717) → selectCapabilities (:474)
    → runCapability (:501) 逐 step 执行 + 记录 records
      → classifyAssertionStrength (:360) 对每条 assert 判定 weak/concrete ✅
      → assessClosedLoop (:417) 三元判定（actualTrigger/concreteAssertion/realScreenshot）✅
        → closedLoop{closed, actualTrigger, concreteAssertion, realScreenshot, missing, reason} ✅
  → extension.cjs runAll 写 status.json capabilities[].closedLoop ✅
Exit: 18 项每项都有 closedLoop 结论（closed:true 或 closed:false + missing + reason）
```
**判定**: ✅ 数据路径完整。实测 3 个终版 run 目录（`171809Z`/`171443Z`/`171640Z`）的 status.json 中，18 项（12+4+2）逐项均含 `closedLoop` 字段，7 项 `closed:true`、11 项 `closed:false`（均带完整 `missing` 数组 + 可读 `reason`）。

### Path 2: status.json closedLoop → shell 汇总 → summary.json
```
Entry: shell finish() (:214-269) 读 STATUS_PATH
  → 解析 status.capabilities[].closedLoop.closed / skipped / notClosed ✅
  → 派生 closureSummary{total, closed, notClosed, skipped, byGroup, notClosedDetails} ✅
  → 写 SUMMARY_PATH（RUN_DIR 下）✅
Exit: summary.json 的 closureSummary 与 status.json closedLoop 一致
```
**判定**: ✅ 数据路径完整。三份 summary.json 的 closureSummary 与各自 status.json 完全一致：
- `171809Z`：total=12, closed=1, notClosed=11
- `171443Z`：total=4, closed=4, notClosed=0
- `171640Z`：total=2, closed=2, notClosed=0
合计 18 项，closed=7、notClosed=11，与 implementation.md 结论「7 闭环 + 11 未闭环」一致。

### Path 3: status.json conclusion → shell 退出码
```
Entry: shell wait_for_status (:180) → status_belongs_to_this_run (:176) 校验 runId ✅
  → case "${driver_conclusion}" (:413) PASS→0 / LINK_FAILURE→1 / SKIPPED_NO_DISPLAY→2 / SKIPPED_NO_CREDENTIALS→3 / *→4 ✅
Exit: 三个 run 均 conclusion=PASS → exit 0（hasCredential:false，全 requiresModel:false，未触发 exit 3）
```
**判定**: ✅ 退出码契约（0/1/2/3/4）未被破坏。三份 status.json `hasCredential:false` 且 18 项全 `requiresModel:false`，凭证门控（`runManifest :731`）正确未触发，无 key 不误伤。

### Path 4: per-run 隔离
```
Entry: shell RUN_ID=$(date +%s)-$$ (:83) → RUN_DIR=runs/${RUN_ID} (:88)
  → write_plan 把 artifactDir 写为 RUN_DIR (:162)
  → driver resolveArtifactDir 读同一 RUN_DIR ✅
Exit: 不同 runId → 独立 runs/<runId>/，互不覆盖
```
**判定**: ✅ 隔离生效。磁盘上存在 6 个独立 run 目录（`164452Z`/`171215Z`/`171443Z`/`171547Z`/`171640Z`/`171809Z`），各自含独立 status/summary/journal/PNG，runId 互不相同，无任何跨目录覆盖。终版 3 个 run 是 `171443Z`/`171640Z`/`171809Z`。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `dsh.test.setCredentialPresence`（manifest 新增步骤，偏差 1） | runner `runCapability` command 步 | ✅ | `extension.ts:1251` 注册命令 | ✅ |
| `dsh.test.newConversation` | singleton/interaction 断言 | ✅ | `extension.ts:1170` 返回 `outcome/sessionId/tabId/mode` | ✅ |
| `dsh.test.panelSnapshot` | singleton re-reveal 断言 | ✅ | 返回 `mode/sessionId/tabId`（run 171809 证实 re-reveal 前后 sessionId/tabId 不变） | ✅ |
| `dsh.test.simulateStartupOnly` | `host-started` wait 步 | ✅ | 返回 `startState:'started', hostStatus:'connected'`（无 key 下经 setCredentialPresence 驱动成功） | ✅ |
| `dsh.test.resolveAtPath` / `getStartState` / `injectApproval` / `listPendingInteractions` / `answerApproval` | code-context / test-hooks / interaction 断言 | ✅ | 均返回具体结果（status.json 逐 step 证实） | ✅ |

> 关键连通性实证：偏差 1 引入的 `setCredentialPresence(true)` 步骤在真机 run（`171809Z`/`171640Z`）中逐 step PASS，使无真实 key 下 host 成功 `startState:'started'`，`newConversation`/`panelSnapshot` 得以返回具体字段——整条「测试钩子 → host 启动 → 具体断言」链路端到端连通。

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| runner `assessClosedLoop` → status.json | `closedLoop{closed,actualTrigger,concreteAssertion,realScreenshot,missing[],reason}` | 字段完整，`missing` 数组 + `reason` 文案由 `:435-442` 生成 | ✅ |
| shell `finish` → status.json | `capabilities[].closedLoop.closed / skipped / missing / reason` | 字段读取路径与 runner 输出一致 | ✅ |
| manifest `dsh.test.setCredentialPresence` | 期望命令已注册且无 key 可驱动 host | `extension.ts:1251` 已注册，真机返回 `{ok:true, present:true}` | ✅ |
| `cap-extension-activate` 断言 `startState:'idle'` | 期望字面量 | 真机返回 `startState:'idle'`（`171443Z`） | ✅ |
| `cap-test-hooks` 断言 `getStartState → state:'idle'` | 期望字面量 | 真机返回 `{state:'idle'}` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `capability-runner.cjs` 的 `classifyAssertionStrength`/`assessClosedLoop` | Phase 1 | 已实现，未改动 | ✅ |
| per-run 隔离（`RUN_DIR`/`resolveArtifactDir`） | Phase 1 | 已实现，未改动 | ✅ |
| 退出码契约（0/1/2/3/4） | Phase 1 | 已实现，未改动 | ✅ |
| `dsh.test.*` 测试钩子（含 `setCredentialPresence`） | 产品代码（非本 Phase 改动） | 已注册，未改动 | ✅ |

> 未发现任何 Phase 1 冻结接口被改动或签名漂移。

## 关键发现

### 🔴 Must-Fix
无。未发现端到端路径断裂、跨模块契约不一致、或冻结接口被改动。

### 🟡 Should-Fix
无。数据路径完整，未发现需优化才能连通的连接点。

### 🟢 Observations
- **[文档保真]** `implementation.md` 变更清单写「3 个 run 目录」，实际磁盘存在 **6 个** run 目录（含 `164452Z`/`171215Z`/`171547Z` 三个中间/被替代 run，均 `conclusion=PASS`）。终版 18 项覆盖由 `171443Z`/`171640Z`/`171809Z` 三个 run 完成，per-run 隔离下中间 run 是独立目录、不互相覆盖，**对交付物与闭环结论零影响**。建议 implementation.md 注明「6 个 run 目录（3 个中间 + 3 个终版）」。
- **[文档保真]** `tech-debt-registry.md` DEBT-8 与 `implementation.md` 未闭环登记表把 `cap-history-panel`/`cap-message-list-streaming` 的「缺哪条」写为仅 `concreteAssertion`，但 status.json 实测这两项 `missing = ["actualTrigger", "concreteAssertion"]`（与 DEBT-7 的 9 项相同——它们当前 manifest 只有 `dsh.showPanel` 弱断言，既无非 UI-prep 的 actualTrigger，也无具体断言）。底层主张「未闭环、需模型往返」为真，仅「缺哪条」字段表述不精确，**对 AC/行为/闭环结论零影响**。建议 registry DEBT-8「缺哪条」更正为 `actualTrigger + concreteAssertion`。
- **[文档保真]** `implementation.md` 写「Node 解析 v24.3.0」，但 status.json `driver.nodeVersion` 实测为 `v22.22.0`（`resolve_node` 从候选目录命中 v22.22.0）。运行已成功，零影响。

## 结论

数据链路「manifest 断言 → runner 分类/闭环判定 → status.json `closedLoop` → shell 汇总/退出码 → per-run 隔离」端到端连通、逐段实测可追溯；18 项每项均有 `closedLoop` 结论，7 闭环 + 11 未闭环与 registry DEBT-7（9）/DEBT-8（2）对应；退出码契约未破坏；无 key 下凭证门控未误伤；逐 id 选择（`--capability cap-extension-activate` 等）正确避开了 `cap-selection-ask` 等模型项。无 Must-Fix、无 Should-Fix。
