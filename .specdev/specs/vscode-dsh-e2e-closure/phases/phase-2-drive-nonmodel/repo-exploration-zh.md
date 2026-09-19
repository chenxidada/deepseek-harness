# 仓库探索报告 — phase-2-drive-nonmodel

> 模式：phase 级（`current_phase` = `phase-2-drive-nonmodel`）
> 调研目标：用 Phase 1 落地的闭环基座（`assessClosedLoop` + per-run 隔离）对 `requiresModel:false` 的 18 项能力逐项真机驱动；升级弱证据为具体结果断言（能闭环则闭环），不能闭环的如实登记。本报告只产出事实 + 证据（`文件:行号`），不给实施方案、不改产品代码。
> `ui: false` — 本 Phase 不追加 §11 UI Inventory。

---

## 1. Task Context

本 Phase（`phase-2-drive-nonmodel`）覆盖 18 项 `requiresModel:false` 能力（`spec.md` §目标 / §覆盖组）：

- `react-spa-main`（8 项）
- `editor-panel`（4 项）
- `code-context` 的 `at-path-token` / `workspace-path-resolve`（2 项）
- `interaction`（2 项）
- `test-hooks`（1 项）
- `session-main-path` 的 `extension-activate`（1 项，仅此 1 项非模型）

对每一项，逐项真机驱动并给结论：① 真机实际触发 ② 针对具体结果的断言 ③ 真实桌面截图 三条齐备 = 闭环通过；缺任一条 → 登记「未闭环 + 缺哪条 + 原因 + 建议何种 feature」（AC-15）。其中 `react-spa-main`(8) 与 `editor-panel`(4) 当前是弱证据（`panelOpen: true` / `viewId`），是本 Phase 升级/登记的核心。

## 2. Repository Overview

- 目标应用 `apps/vscode-dsh/`：TypeScript（`strict: true`，ESM）+ React 18 webview SPA（`webview/src/`）+ bash/CJS 真机驱动（`test-scripts/`）。
- 本 Phase 不改产品代码（`src/` / `webview/src/`），只改验证基础设施：`test-scripts/layer-v-capabilities.json`（仅本批断言）+ 运行产物 `test-artifacts/layer-v-capabilities/runs/<runId>/` + `tech-debt-registry.md`（未闭环登记）。
- 关键目录：`src/extension.ts`（`dsh.test.*` 钩子 + `dsh.showPanel`）、`src/chat-panel/editor-chat-panel.ts`（React SPA 单例面板）、`src/chat-panel/chat-panel-provider.ts`（过时 thin HTML）、`src/conversation-controller.ts`（`panelSnapshot`）、`test-scripts/`（驱动 + manifest）。

## 3. Most Relevant Areas

来源标注：👁 = 手动探索（Read/Grep）。

| 区域 | 路径 | 为何相关 |
|------|------|---------|
| 能力清单 manifest（41 项，本批只动 18 项断言） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | 每项能力的 `steps`/`expect` 定义；弱证据与具体断言的现状 |
| 能力 runner（纯逻辑） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | `classifyAssertionStrength` / `assessClosedLoop` / 凭证门控 / `selectCapabilities` |
| 能力 in-host 驱动 | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs` | `resolveArtifactDir`（per-run 目录）、`readPlan`、`runAll`、兜底路径 |
| 能力编排 shell | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | `--capability` 选择器、`RUN_DIR` per-run 隔离、凭证探测 `HAS_CREDENTIAL` |
| `dsh.test.*` 钩子注册 | `apps/vscode-dsh/src/extension.ts:1012-1539` | host 侧可观测接口（本 Phase 断言升级的唯一来源） |
| `dsh.showPanel` 命令 | `apps/vscode-dsh/src/extension.ts:512` | 弱证据 `panelOpen`/`viewId` 的返回点 |
| React SPA 单例面板 | `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts` | 单例控制器 / HTML 构建器 / 注入 |
| 会话投影 | `apps/vscode-dsh/src/conversation-controller.ts:1688` | `panelSnapshot()` 返回字段（可升级断言的数据源） |
| 过时 thin HTML | `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | `buildThinChatHtml`（已废弃，不覆盖） |
| `@path` 解析 | `apps/vscode-dsh/src/code-context/at-path.ts` | `extractAtPathTokens` / `resolveAtPathInWorkspace`（code-context 批断言依据） |

## 4. Key Entry Points / Call Paths

### 4.1 能力编排（本批运行的入口链）

```
run-layer-v-capabilities.sh main() (:323)
 ├─ --capability <id|group>（可重复）→ CAPABILITY_ONLY 覆盖 (:327-346)
 ├─ HAS_CREDENTIAL = DEEPSEEK_API_KEY 是否存在 (:370-373)
 ├─ write_plan → plan.artifactDir = RUN_DIR（runs/<runId>）(:142-166)
 ├─ prepare_shadow_preset（无条件执行，本批非模型能力实际不依赖）(:386)
 ├─ launch_host → layer-v-capability-driver/extension.cjs activate() (:189)
 │    └─ runAll() (:96) → runManifest (capability-runner.cjs)
 │         └─ selectCapabilities（按 group OR id 匹配）(:474)
 │              └─ runCapability（逐 capability 执行 command/assert/wait/stream/screenshot）(:501)
 │                   └─ assessClosedLoop（三元判定）(:417)
 └─ wait_for_status → case 结论 → exit code 0/1/2/3/4 (:413-429)
```

### 4.2 `dsh.showPanel` → 单例面板（弱证据断言的真实路径）

```
dsh.showPanel (extension.ts:512)
 └─ revealConversationPanel(vscode) (:2775)
     └─ editorChatPanel.openOrFocus() (editor-chat-panel.ts:190)
          ├─ panel !== undefined → reveal + pushFullState（单例复用分支，:194-201）
          └─ panel === undefined → createWebviewPanel + buildEditorChatSpaHtml（:203-218）
 → 返回 { ok, viewId:'dsh.editorChat', visible, panelOpen } (:514-519)
```

### 4.3 `dsh.test.*` 可观测接口（断言升级的唯一数据源）

`dsh.test.*` 仅在 `shouldRegisterTestHooks`（`VSCODE_DSH_TEST` 或注入 `vscodeArg`）下注册（`extension.ts:2575`）。与本批相关的可观测接口：

| 命令 | 位置 | 返回的「具体结果」字段（可用于具体断言） |
|------|------|------|
| `dsh.test.panelSnapshot` | `extension.ts:1044` | `mode`（`live`/`replay`/`empty`/`waiting-host` 字面量）、`sessionId`、`tabId`、`messages[]`、`tabStatus`、`index`、`continue` |
| `dsh.test.newConversation` | `extension.ts:1170` | `outcome:'created'`、`sessionId`、`tabId`、`mode`、`messageCount` |
| `dsh.test.listHistory` | `extension.ts:1079` | 历史数组（`0.sessionId`、`0.firstUserPreview`、`0.continueHint`） |
| `dsh.test.getIndex` | `extension.ts:1054` | 工作区索引 `{ workspaceKey, sessions, openTabSet, ui }` |
| `dsh.test.simulateStartupOnly` | `extension.ts:1243` | `ok:true`、`startState`、`hostStatus`、`hostCreateCount`、`tabs`（数值）、`openTabSet`（数值） |
| `dsh.test.resolveAtPath` | `extension.ts:1452` | `tokens`、`resolved[].token/path/result.ok/result.path` |
| `dsh.test.listPendingInteractions` | `extension.ts:1100` | 审批数组（`0.kind/id/toolName/state/reason`） |
| `dsh.test.answerApproval` | `extension.ts:1111` | `ok`、`reason`（`unknown-id` 等字面量） |
| `dsh.test.injectApproval` | `extension.ts:1419` | `ok:true`、`id` |
| `dsh.test.closeConversation` | `extension.ts:1026` | `outcome:'closed'` 等 |

> 关键结论：**没有任何 `dsh.test.*` 钩子能探测 webview 内部 React 组件的 DOM/渲染状态**。`panelSnapshot` 返回的是 host 侧会话投影（`mode`/`messages`/`index`），不是 webview DOM。因此 webview 内部组件（App/TabChrome/HistoryPanel/MessageList/Composer/DeleteConfirmModal/chat-ui-store/message-bridge）无法用 host 侧断言验证其「渲染结果」。

## 5. Likely Impact Surface

本 Phase 只动验证基础设施，风险面如下：

| 区域 | 改动性质 | 风险 |
|------|---------|:--:|
| `test-scripts/layer-v-capabilities.json` | 仅改本批 18 项的 `steps`/`expect`（升级弱证据或如实标注），**不改** `ac` 字段、**不重写** 41 项全量 | 🟡 中（改错 `expect` 会误伤同组；改到别组会越界） |
| `tech-debt-registry.md` | 新增「未闭环」条目（缺哪条 + 原因 + 建议 feature） | 🟢 低 |
| `test-artifacts/layer-v-capabilities/runs/<runId>/` | 运行产物（status/summary/journal/PNG） | 🟢 低 |
| `src/` / `webview/src/` | **不修改** | — |
| `tests/` | **不新增**（AC-13） | 🔴 若违反则污染 |

**弱证据 → 具体断言的影响行（manifest 内）**：本批 18 项中，需要升级/处理的 `expect` 行：

| id | 组 | 现状断言 | 行号 | 现状强度 |
|----|----|------|------|:--:|
| cap-react-spa-root | react-spa-main | `{ viewId:'dsh.editorChat', panelOpen:true }` | `layer-v-capabilities.json:18` | weak |
| cap-tab-chrome | react-spa-main | `{ panelOpen:true }` | `:31` | weak |
| cap-history-panel | react-spa-main | `{ panelOpen:true }` | `:44` | weak |
| cap-message-list-streaming | react-spa-main | `{ panelOpen:true }` | `:57` | weak |
| cap-composer | react-spa-main | `{ panelOpen:true }` | `:70` | weak |
| cap-delete-confirm-modal | react-spa-main | `{ panelOpen:true }` | `:83` | weak |
| cap-chat-ui-store | react-spa-main | `{ panelOpen:true }` | `:96` | weak |
| cap-message-bridge | react-spa-main | `{ panelOpen:true }` | `:109` | weak |
| cap-editor-panel-viewtype | editor-panel | `{ viewId:'dsh.editorChat' }` | `:122` | weak |
| cap-react-spa-html-builder | editor-panel | `{ panelOpen:true }` | `:135` | weak |
| cap-editor-panel-singleton | editor-panel | `{ viewId:'dsh.editorChat', panelOpen:true }` ×2 | `:148, :150` | weak |
| cap-webview-html-injection | editor-panel | `{ panelOpen:true }` | `:163` | weak |
| cap-extension-activate | session-main-path | `{ ok:true, startState:'$string' }` | `:175` | weak（`$string` 是类型谓词） |
| cap-test-hooks | test-hooks | `{ ok:true }` | `:719` | weak（`ok:true` 单独） |
| cap-at-path-token | code-context | 2 条字面量断言 | `:377-378` | **concrete（已达标）** |
| cap-workspace-path-resolve | code-context | 2 条字面量 + 负向断言 | `:390-391` | **concrete（已达标）** |
| cap-interaction-coordinator | interaction | 多条字面量 + 负向断言 | `:683-686` | **concrete（已达标）** |
| cap-interaction-ui | interaction | 多条字面量 + 负向断言 + `expect:[]` | `:703-707` | **concrete（已达标）** |

> 即：真正需要「升级或登记未闭环」的是 `react-spa-main`(8) + `editor-panel`(4) + `extension-activate`(1) + `test-hooks`(1) 共 14 项；`code-context`(2) + `interaction`(2) 共 4 项断言已具体，只需真机驱动取证（它们正是 DEBT-5 中「从未真机执行」的项）。

## 6. Existing Constraints / Conventions

### 6.1 弱证据分类规则（✅ CONFIRMED，本 Phase 升级断言的判定标尺）

`capability-runner.cjs` 的 `classifyAssertionStrength`（`:360-400`）：
- 纯存在性字段 `panelOpen` / `viewId` / `registered`（`WEAK_EXISTENCE_FIELDS`，`:348`）→ weak；
- 单独 `ok: true` → weak（`:383-386`）；
- `$string` / `$number` / `$boolean` / `$object` / `$array` / `$present`（`TYPE_PREDICATES`，`:323`）→ weak；
- `$contains:` / `$assistantContains:` / `$assistantClosed:`（`CONCRETE_PREDICATE_PREFIXES`，`:317`）与 `$array:N` → concrete；
- `expect` 中含**非** weak 字段的**字面量值**（如 `mode:'live'`、`outcome:'created'`、`0.kind:'approval'`、`ok:false`）→ concrete（`:391-393`）。

### 6.2 三元闭环判定（✅ CONFIRMED）

`assessClosedLoop`（`:417-444`）要求三条齐备：① `actualTrigger`（存在非 `UI_PREP_COMMANDS` 的 assert/wait/stream 步骤通过；`UI_PREP_COMMANDS` = `dsh.showPanel`/`dsh.test.openPanel`/`dsh.test.openActivityBar`/`dsh.test.fireConversationVisibility`，`:305-310`）② `concreteAssertion`（存在 classify=concrete 的步骤通过）③ `realScreenshot`（screenshot 步骤通过）。缺任一条 → `closed:false` + `missing`。

### 6.3 凭证门控（✅ CONFIRMED）

`runManifest`（`:731-748`）仅在 `cap.requiresModel === true && !hasCredential` 时判 `SKIPPED_NO_CREDENTIALS`（exit 3）。本批 18 项 `requiresModel` 全为 `false`（见 manifest），因此**完全不受凭证门控影响**——无 `DEEPSEEK_API_KEY` 时也能跑出 PASS/闭环结论。

### 6.4 per-run 证据隔离（✅ CONFIRMED）

`RUN_DIR="${ARTIFACT_DIR}/runs/${RUN_ID}"`（`run-layer-v-capabilities.sh:88`），`RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"`（`:83`）。status/summary/journal 全部落 `RUN_DIR`（`:89-91`）；`write_plan` 把 `artifactDir` 写为 `RUN_DIR`（`:162`），driver 经 `resolveArtifactDir`（`extension.cjs:61`）读同一目录。→ **重复跑两次：runId 不同 → 两个独立 `runs/<runId>/`，互不覆盖**（AC-15）。

### 6.5 退出码契约（✅ CONFIRMED，本 Phase 不破坏）

结论词汇 `PASS/LINK_FAILURE/SKIPPED_NO_DISPLAY/SKIPPED_NO_CREDENTIALS/HARNESS_ERROR`（`primitives.cjs:13`）= `0/1/2/3/4`。`closedLoop` 是 per-capability 正交维度，不改 exit code。

## 7. Risks / Unknowns

### 7.1 `react-spa-main`(8) 与 `editor-panel`(4) 的「可升级性」分层（核心）

| 能力 | host 侧可观测 hook | 结论 |
|------|:--:|------|
| cap-react-spa-root（App 根） | ❌ 无（`data-testid="editor-chat-root"` 仅在 webview DOM） | **未闭环：纯 webview 内部组件** |
| cap-tab-chrome（TabChrome） | ⚠️ 间接：`simulateStartupOnly.tabs`（数值）是 TabChrome 渲染的 host 侧数据源 | 边界：可断言 `tabs` 数值，但证明的是 registry 有 tab，非 TabChrome 渲染 |
| cap-history-panel（HistoryPanel） | ✅ `dsh.test.listHistory`（返回真实会话） | **可升级**（design §实现方案明示「历史窗口用 listHistory 返回真实会话」） |
| cap-message-list-streaming（MessageList） | ❌ 无；流式内容还需模型往返（本批 requiresModel=false） | **未闭环：webview 内部 + 需模型** |
| cap-composer（Composer） | ⚠️ `dsh.test.prefillComposer` 仅 `{ok:true}` 副作用 | **未闭环：webview 内部组件** |
| cap-delete-confirm-modal | ❌ 无（webview 内部 modal） | **未闭环：webview 内部组件** |
| cap-chat-ui-store | ❌ 无（webview 内部 store） | **未闭环：webview 内部组件** |
| cap-message-bridge | ❌ 无（bridge 消息流无 host 侧探测） | **未闭环：webview 内部组件** |
| cap-editor-panel-viewtype | ⚠️ `dsh.showPanel` 返回 `viewId:'dsh.editorChat'`；但 `viewId` 属 weak 字段 | 边界：viewType 常量 `EDITOR_CHAT_PANEL_VIEW_TYPE`（`editor-chat-panel.ts:89`）是事实，但「已创建」只能经 `panelOpen` 间接证明 |
| cap-react-spa-html-builder | ❌ 无（`buildEditorChatSpaHtml` 返回字符串，无 host 探测） | **未闭环：无 host 侧 hook** |
| cap-editor-panel-singleton | ✅ `dsh.test.panelSnapshot` 的 `sessionId`/`tabId` 在 re-reveal 后不变（单例复用分支 `editor-chat-panel.ts:194`） | **可升级**（design 明示「单例 Panel 用 re-reveal 后 panelSnapshot 仍单例」） |
| cap-webview-html-injection | ❌ 无（`panel.webview.html=...` 注入不可观测） | **未闭环：无 host 侧 hook** |

### 7.2 其它风险

- **R1（自指断言被分类为 weak）**：`cap-test-hooks`（`{ok:true}`）与 `cap-extension-activate`（`{ok:true, startState:'$string'}`）的**本质**是「测试钩子响应 / activate 已注册」，其最强可观测断言天然就是 `ok:true`。按 `classifyAssertionStrength` 它们会被判 weak。✅ CONFIRMED（`:383-386`、`:323`）。升级方向：`cap-extension-activate` 可把 `startState:'$string'` 改为字面量 `startState:'idle'`（activate 只注册不启动，`extension.ts:1243-1250` `startState = orchestrator?.getStartState() ?? 'idle'`）；`cap-test-hooks` 可补 `hostCreateCount`/`openTabSet` 字面量数值。否则需如实登记 `missing:['concreteAssertion']`。
- **R2（`code-context` 组选择器会拉入模型项）**：`selectCapabilities` 按 group OR id 匹配（`capability-runner.cjs:474-480`）。`code-context` 组含 3 项（`at-path-token`/`workspace-path-resolve`/`selection-ask`），其中 `selection-ask` 是 `requiresModel:true`（`:400`）。若用 `--capability code-context` 会选中 `selection-ask` → 无 key 时 exit 3。✅ CONFIRMED。**必须按 id 选择**：`--capability cap-at-path-token,cap-workspace-path-resolve`。
- **R3（`session-main-path` 组选择器同理会拉入 8 个模型项）**：`extension-activate` 属 `session-main-path` 组（9 项：8 model + 1 nonmodel）。必须按 id 选择 `--capability cap-extension-activate`，不能用 `--capability session-main-path`。✅ CONFIRMED。
- **R4（interaction 批触发真实 host 启动）**：`cap-interaction-coordinator`/`cap-interaction-ui` 的 steps 含 `fireConversationVisibility(true)` + `wait host-started`（`simulateStartupOnly`，timeoutMs 240000），会触发真实 auto-start 编排（`handleConversationVisibility` → `orchestrator.request('conversation-view-visible')`，`extension.ts:2748-2754`）。host 启动**不需要模型 key**（只有 `prompt` 才需要），但需运行时真实启动成功。⚠️ HYPOTHESIS：无 key 时该批能否 `startState:'started'` 需真机确认；若 runtime 启动失败会 LINK_FAILURE（非凭证门控）。
- **R5（默认选择器 `react-spa-main,editor-panel` 全非模型，安全）**：`run-layer-v-capabilities.sh:67` 默认 `CAPABILITY_ONLY=react-spa-main,editor-panel`（12 项，全 non-model），无参运行安全。✅ CONFIRMED。

## 8. Uncertain / Unverified

| 签名 / 路径 | 状态 | 说明 |
|-----------|:--:|------|
| `simulateStartupOnly` 在无 key 下 `startState` 是否可达 `'started'`（interaction 批依赖） | ⚠️ HYPOTHESIS | `startState` 由 `orchestrator.getStartState()` 给出；auto-start 由 `fireConversationVisibility(true)` 触发，与模型 key 无关，但「runtime 实际能否启动并 connect」需真机确认 |
| `panelSnapshot().mode` 在 re-reveal 后是否稳定为 `'live'`/`'empty'`（单例断言依据） | ⚠️ HYPOTHESIS | `panelSnapshot`（`conversation-controller.ts:1688`）的 `mode` 由 `resolvePanelProjection()` 派生；`newConversation` 后应为 `'live'`，但需真机确认 re-reveal 不改变 `sessionId`/`tabId` |
| `dsh.test.listHistory` 在仅 `newConversation`（无模型往返）后是否返回 ≥1 真实会话 | ⚠️ HYPOTHESIS | `listHistoryFromIndex(resolveWorkspaceIndex())` 从索引读；`newConversation` 会写索引，但索引写入时机需真机确认 |
| 旧 flat 目录的 `cap-at-path-token.png` 等截图（workflow 级 R5）是否仍在 per-run 改造后可见 | ❓ UNKNOWN | per-run 改造后新 run 落 `runs/<runId>/`；旧 flat 目录可能成孤儿文件，与本 Phase 判定无关 |

> 这些 ⚠️/❓ 项**不得**作为实现依据；实现时以真机运行结果为准，波动即如实登记（AC-14）。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 与本批关系 | 判定 |
|-------------|-----------|:--:|------------|:--:|:--:|
| DEBT-2 | `sdk/server` `createForkedSession` emptySeed + `conversation-controller.forkFromClosedTurn` retry | 🟡非阻塞（真机 LINK_FAILURE） | 未核验（模型行为） | Phase 3（模型） | 不涉及本批 |
| DEBT-3 | `cap-message-store-stream-patch` 流式增量波动 | 🟡非阻塞 | 未核验（时序敏感） | Phase 3（模型） | 不涉及本批 |
| DEBT-4 | `cap-change-index-store`/`cap-snapshot-revert`/`cap-change-diff-render` | 🔴阻塞「从未真机执行」 | 3 项 `requiresModel:true`（manifest `:416/:439/:465`），不在本批 | Phase 3 | ✅ 匹配（仍零取证，本批不碰） |
| DEBT-5 | `cap-at-path-token`/`cap-workspace-path-resolve`/`cap-selection-ask`/`cap-interaction-coordinator`/`cap-interaction-ui` | 🔴阻塞「取证文件数为 0」 | 其中 4/5（at-path-token/workspace-path-resolve/interaction-coordinator/interaction-ui）在本批；`selection-ask` 是 Phase 3 模型项 | **本批核心** | ⚠️ 待复核（workflow 级 R5 指出旧 flat 目录已有 4 张 PNG，但无 verdict JSON；per-run 改造后需重新真机取证） |
| DEBT-6 | `layer-v-capability-driver/extension.cjs` `activate()` 兜底路径写 `FALLBACK_ARTIFACT_DIR` | 🟡非阻塞（Phase 1 SHOULD-FIX） | 代码仍在（`extension.cjs:189-219`），孤儿文件不清理 | 无（诊断路径） | ✅ 匹配（Phase 1 已知债，本批不处理） |

### Stub Detection Summary

- ✅ Confirmed stubs（匹配 registry 且仍为空壳）：**1 条**（DEBT-4，3 项 change-list 能力，本批不涉及）。
- ⚠️ Registry mismatch（代码/磁盘已变但 registry 未更新）：**1 条**（DEBT-5，其「取证 0」描述需在 Phase 2 真机取证后更新——本批 4 项真机跑完后，registry 应更新为「已闭环」或「未闭环 + 缺口」）。
- 🔴 Unregistered stubs：**0**（本次扫描未在 `src/`/`test-scripts/` 发现未登记的 `@STUB(...)` / 空实现 / 假返回值桩代码；本批「未闭环」项将作为新的 GAP/DEBT 条目登记，非桩代码）。

> 说明：本批「未闭环」登记属**验证覆盖缺口**（GAP/DEBT），非产品代码桩。`react-spa-main`/`editor-panel` 的纯 webview 内部组件「缺 host 侧探测 hook」是真实覆盖缺口，应在 Phase 2 落地为 registry 条目（缺 `concreteAssertion` + 建议「后续 feature 补 webview 内 `data-testid` 探测通道」）。

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（本批 18 项的确切 `steps`/`expect`，升级/登记的直接对象）。
2. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（`classifyAssertionStrength`/`assessClosedLoop`/`UI_PREP_COMMANDS`/`selectCapabilities`，断言升级必须对齐的判定语义）。
3. ⭐ MUST READ — `apps/vscode-dsh/src/extension.ts:1012-1539`（`dsh.test.*` 各命令返回字段，具体断言的数据源）。
4. 🔷 SHOULD READ — `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts`（单例 `openOrFocus`、`buildEditorChatSpaHtml`，判断 editor-panel 组可升级性）。
5. 🔷 SHOULD READ — `apps/vscode-dsh/src/conversation-controller.ts:1688`（`panelSnapshot` 返回结构，单例/历史断言依据）。
6. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh`（`--capability` 选择器、`RUN_DIR` 隔离、凭证探测）。
7. 🔹 OPTIONAL — `apps/vscode-dsh/src/code-context/at-path.ts`（`resolveAtPath` 断言字段对应的解析函数语义）。
8. 🔹 OPTIONAL — `.specdev/specs/vscode-dsh-e2e-closure/design.md` §实现方案「逐项驱动的能力分批」（本批与 Phase 3 的边界）。
