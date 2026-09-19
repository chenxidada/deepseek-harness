# Correctness Review — Phase 2（phase-2-drive-nonmodel）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述（节选） | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-3 | 能力清单每项附 `路径:行号`，路径存在、行号不越界 | `layer-v-capabilities.json`（`evidence` 字段，本 Phase 未改） | ✅ | 本批 18 项 evidence 逐一核对：路径全部存在、行号全部 ≤ 文件实际行数（App.tsx:19/64 ≤136；TabChrome.tsx:36 ≤480；HistoryPanel.tsx:30 ≤267；MessageList.tsx:25 ≤647；Composer.tsx:17 ≤172；DeleteConfirmModal.tsx:14 ≤80；chat-ui-store.ts:277 ≤644；message-bridge.ts:64 ≤100；editor-chat-panel.ts:89/116/161/218 ≤262；extension.ts:374/1011 ≤2939；at-path.ts:54/110 ≤240；interaction-coordinator.ts:136 ≤598；interaction-ui.ts:72 ≤394）。git diff 确认 `evidence` 无任何改动 |
| AC-4 | 废弃/被替代路径不闭环，列入「过时功能清单」 | `test-scripts/obsolete-features.md`（新增） | ✅ | 清单落盘 `buildThinChatHtml`（`chat-panel-provider.ts:190`，实测存在）与 `buildSidebarMigrationHtml`（`:151`，实测存在），二者均不在本批驱动选择器内（默认选择器 `react-spa-main,editor-panel` + 显式 id 选择器均不含 thin HTML 路径） |
| AC-6（证据） | 每项产出真实 PNG + ≥1 断言通过 | `runs/<runId>/layer-v-capabilities-status.json` | ✅ | 三份 status 逐项核对：18 项每项 `screenshot` 步 `ok:true`（`verdict.size` 700KB 级非退化 PNG）+ 至少 1 条 `assert`/`wait` 步 `ok:true`。18 张 PNG 落盘齐全（12+4+2） |
| AC-6（断言质量） | 升级后不再仅 `panelOpen:true`；能闭环项 `concreteAssertion===true` | manifest 4 处断言升级（git diff 5 hunks） | ✅ | 7 项闭环的 `concreteAssertion`/`actualTrigger` 均为 `true`，且断言确为字面量/负向断言：`singleton`（`newConversation.outcome:'created'`/`mode:'live'` + re-reveal 前后 `panelSnapshot.mode:'live'`）；`extension-activate`（`startState:'idle'` 字面量）；`test-hooks`（`getStartState.state:'idle'`）；`at-path-token`/`workspace-path-resolve`（`tokens:1`/`resolved.0.path` 字面量 + `result.ok:false` 负向）；`interaction-*`（`0.kind:'approval'`/`outcome:'allowed-once'`/`reason:'unknown-id'` 字面量+负向）。11 项未闭环的 `panelOpen:true` 弱断言仍保留，但均被 `assessClosedLoop` 正确判 `closed:false`，未冒充闭环 |
| AC-15（结论） | 每项有 `closedLoop` 结论；未闭环登记「缺哪条+原因+建议」；可重复运行 | status `closedLoop` + `tech-debt-registry.md` | ✅ | 18 项全部含 `closedLoop`（7×`closed:true`；11×`closed:false`+`missing`+`reason`）。registry DEBT-7（9 项 webview 内部，缺 concreteAssertion+actualTrigger，建议补 webview 探测通道）+ DEBT-8（2 项依赖模型，建议 `requiresModel:true` 交 Phase 3）共 11 项。3 个最终 run 目录独立（`runId` 不同、互不覆盖） |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
无本 Phase 新增/依赖的桩代码。

### 新发现的未注册桩
无。本 Phase 为纯 manifest + 文档 + 运行产物改动，git diff 确认未改动任何 `src/`/`webview/src/` 函数体，无 `(void)` / `return []` / 假返回值 / `@STUB` 新增。11 项「未闭环」是**验证覆盖缺口（GAP）**，非代码桩，已如实登记 DEBT-7/DEBT-8。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **[文档保真]** `tech-debt-registry.md` DEBT-8 行「当前行为」描述「缺 `concreteAssertion`」，但两份 status 实测 `cap-history-panel` / `cap-message-list-streaming` 的 `missing` 数组均为 `["actualTrigger","concreteAssertion"]`（因 manifest steps 仅 `dsh.showPanel`+`panelOpen:true`，`dsh.showPanel` 属 `UI_PREP_COMMANDS`，故 `actualTrigger` 同样缺失）。底层主张为真（两项确因依赖模型往返而未闭环，建议 Phase 3 补 `requiresModel:true`），建议字段「缺哪条」补齐为「缺 concreteAssertion + actualTrigger」。
- **[文档保真]** `implementation.md` §变更清单写「3 个 run 目录」，实际 `runs/` 下存在 6 个 runId 目录（3 个最终 run：`171443Z`/`171640Z`/`171809Z` + 3 个中间迭代 run：`164452Z`/`171215Z`/`171547Z`）。「18 张 PNG」与「7 闭环/11 未闭环」的实质主张均与最终 3 个 run 的 status 一致，多出的 3 个目录为迭代残留（per-run 隔离设计下的正常历史），不影响交付物正确性。

## 与 implementer 声称的核对

| 声称 | 实测 | 判定 |
|------|------|:--:|
| 闭环 7 项 / 未闭环 11 项 | status 三 run 合计：closed=7（singleton+extension-activate+test-hooks+at-path-token+workspace-path-resolve+interaction-coordinator+interaction-ui）、notClosed=11 | ✅ 一致 |
| 未改 `ac` 字段、未重写 41 项、未改 `evidence` | git diff 仅 5 hunks，全部落在 18 项本批的 `steps` 内，无 `ac`/`evidence` 改动、无其它 23 项改动 | ✅ 一致 |
| 未修改产品代码（`src/`/`webview/src/`） | git diff/status 无任何 `src/`/`webview/src/` 改动 | ✅ 一致 |
| 3 个 run 目录、18 张 PNG | 18 张 PNG 齐全；目录实为 6 个（见 🟢） | ⚠️ 陈述欠准（文档保真） |
| 无桩代码 | 确认无 | ✅ 一致 |
