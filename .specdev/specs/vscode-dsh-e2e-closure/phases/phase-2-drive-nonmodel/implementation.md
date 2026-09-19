# Phase 2 实现摘要（phase-2-drive-nonmodel）

> 目标：用 Phase 1 闭环基座对 `requiresModel:false` 的 18 项能力逐项真机驱动、升级弱证据、能闭环则闭环、不能则如实登记。
> 结论：**18 项全驱动 → 7 项闭环 + 11 项未闭环（已登记 registry）**。

## 变更清单（文件列表）

| 文件 | 改动性质 |
|------|---------|
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | 本批 4 处断言升级（见下表），未改 `ac` 字段、未重写 41 项 |
| `apps/vscode-dsh/test-scripts/obsolete-features.md` | 新增过时功能清单（AC-4） |
| `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | 更新 DEBT-5（4/5 已闭环），新增 DEBT-7 / DEBT-8 |
| `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/<runId>/` | 6 个 run 目录（3 个中间迭代 + 3 个终版，共 18 张 PNG + status/summary/journal） |

### manifest 断言升级明细

| id | 升级前 | 升级后 |
|----|--------|--------|
| `cap-editor-panel-singleton` | `dsh.showPanel` ×2 弱断言（`viewId`/`panelOpen`） | 前置 `setCredentialPresence(true)` + `fireConversationVisibility(true)` + `wait host-started`；具体断言 `newConversation`（`outcome:'created'`, `mode:'live'`）+ re-reveal 前后 `panelSnapshot`（`mode:'live'`, `sessionId:$string`, `tabId:$string`） |
| `cap-extension-activate` | `simulateStartupOnly` `{ok:true, startState:'$string'}`（weak） | `simulateStartupOnly` `{ok:true, startState:'idle'}`（concrete） |
| `cap-test-hooks` | `simulateStartupOnly` `{ok:true}`（weak） | `dsh.test.getStartState` `{state:'idle'}`（concrete） |
| `cap-interaction-coordinator` / `cap-interaction-ui` | 无 `setCredentialPresence`（`fireConversationVisibility` 后直接 `wait host-started`） | 前置 `setCredentialPresence(true)`（使 host 在无真实 key 下可启动），断言本身不变（本就是具体断言） |

## 对每个验收标准的实现说明

| AC | 说明 |
|----|------|
| AC-3 | 41 项 `evidence` 均带 `路径:行号`（工作流级 code-explorer 产出，本 Phase 未改 `evidence`/`ac`）；本批 18 项 id 与 `repo-exploration.md` §1 覆盖组一一对应 |
| AC-4 | `obsolete-features.md` 落盘：`buildThinChatHtml`（thin HTML 面板，fixture-only）+ `buildSidebarMigrationHtml`（sidebar 迁移启动器）不建立闭环覆盖，均不在本批驱动选择器内 |
| AC-6 | 18 项每项产出非退化 PNG + ≥1 断言通过（弱证据项的 `panelOpen`/`viewId` 断言仍通过，只是非 concrete）；7 项 `closedLoop.concreteAssertion === true`，11 项如实登记 |
| AC-15 | 每项有 `closedLoop` 结论（`closed:true` 或 `closed:false` + `missing` + `reason`）；11 项未闭环登记 registry（DEBT-7/DEBT-8）；per-run 隔离（6 个独立 `runId` 目录，互不覆盖） |

## 测试结果（命令 + 输出）

```bash
# 1) react-spa-main(8) + editor-panel(4) 默认选择器
bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
# → conclusion: PASS (exit 0)，closed=1 (singleton)，notClosed=11
#   run: runs/20260919T171809Z-2024832/

# 2) code-context(2) + extension-activate(1) + test-hooks(1)
bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh \
  --capability cap-extension-activate --capability cap-test-hooks \
  --capability cap-at-path-token --capability cap-workspace-path-resolve
# → conclusion: PASS (exit 0)，closed=4
#   run: runs/20260919T171443Z-1995097/

# 3) interaction(2)
bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh \
  --capability cap-interaction-coordinator --capability cap-interaction-ui
# → conclusion: PASS (exit 0)，closed=2
#   run: runs/20260919T171640Z-2012756/
```

- Node 解析：`v22.22.0`（脚本 `resolve_node` 从候选目录命中，`driver.nodeVersion` 实测）；显示 `DISPLAY=:1` 复用；三个终版 run 均 `driver conclusion: PASS`。
- 无 `DEEPSEEK_API_KEY`，未触发 exit 3（本批全 `requiresModel:false`）。

## 未闭环登记表（11 项）

| id | 组 | 缺哪条 | 原因 | 登记 |
|----|----|--------|------|------|
| `cap-react-spa-root` | react-spa-main | concreteAssertion + actualTrigger | App 根，纯 webview 内部，无 host 侧探测 hook | DEBT-7 |
| `cap-tab-chrome` | react-spa-main | concreteAssertion + actualTrigger | TabChrome 渲染不可观测；`simulateStartupOnly.tabs` 仅证 registry 有 tab 非 TabChrome 渲染 | DEBT-7 |
| `cap-composer` | react-spa-main | concreteAssertion + actualTrigger | Composer 纯 webview 内部；`prefillComposer` 仅 `{ok:true}` 副作用，无内容回读 | DEBT-7 |
| `cap-delete-confirm-modal` | react-spa-main | concreteAssertion + actualTrigger | 删除确认 Modal 纯 webview 内部 | DEBT-7 |
| `cap-chat-ui-store` | react-spa-main | concreteAssertion + actualTrigger | webview 内部 store，无 host 侧探测 | DEBT-7 |
| `cap-message-bridge` | react-spa-main | concreteAssertion + actualTrigger | bridge 消息流无 host 侧探测 | DEBT-7 |
| `cap-editor-panel-viewtype` | editor-panel | concreteAssertion + actualTrigger | `viewId` 属 weak 字段；viewType 常量是事实但「已创建」只能经 `panelOpen` 间接证 | DEBT-7 |
| `cap-react-spa-html-builder` | editor-panel | concreteAssertion + actualTrigger | `buildEditorChatSpaHtml` 返回字符串，无 host 探测 | DEBT-7 |
| `cap-webview-html-injection` | editor-panel | concreteAssertion + actualTrigger | `panel.webview.html=...` 注入不可观测 | DEBT-7 |
| `cap-history-panel` | react-spa-main | actualTrigger + concreteAssertion | `listHistory` 无模型往返时返回空（真实历史会话需 `firstUserPreview`，仅模型往返后产生） | DEBT-8 |
| `cap-message-list-streaming` | react-spa-main | actualTrigger + concreteAssertion | 流式内容需模型往返，且无 host 侧流式探测 hook | DEBT-8 |

## 偏差记录

### 偏差 1：为 singleton / interaction 新增 `setCredentialPresence(true)` 步骤
- **影响范围**：spec.md §约束（「不改产品代码、只改本批 steps/expect」——仍遵守，未改产品代码、只改 manifest steps）
- **原因**：真机实测发现 `dsh.test.newConversation` / `panelSnapshot` / `injectApproval` 均依赖 `conversations`（ConversationController），而该控制器仅在 host 启动成功后 `bindConversations` 创建；host 启动受 `hasCredentials()` 门控，无 key 时 `runStart` 抛 `missing-credentials` → `startState` 恒 `failed`。`dsh.test.setCredentialPresence(true)` 是**既有测试钩子**（`extension.ts:1251`），专门用于无真实 key 时驱动 host 启动，与 repo-exploration R4「host 启动不需要模型 key」一致。
- **影响**：singleton / interaction 四项因此能从「弱证据/从未真机执行」升级为具体断言并闭环；未引入任何降断言或跳步。

### 偏差 2：`cap-history-panel` 未按 repo-exploration §7.1「可升级」执行
- **影响范围**：repo-exploration.md §7.1（tab 行「✅ 可升级」）/ design.md §实现方案（「历史窗口用 listHistory 返回真实会话」）
- **原因**：真机验证 `isHistoryEligibleSession`（`extension-index.ts:288-291`）——无 `firstUserPreview` 且为空 title 的会话不入历史；`newConversation` 只产生 `EMPTY_LIVE_TITLE` 会话，无模型往返时 `listHistory` 恒为 `[]`，无法形成具体断言（`expect: []` 分类为 `unknown`）。
- **影响**：如实登记 DEBT-8（建议 `requiresModel` 改 `true` 交 Phase 3，或用「仅注入用户消息不等待模型」的测试钩子）。

## 完成前自检

- 空函数检查：本 Phase 未新增/修改任何函数（纯 manifest + 文档改动），无 `(void)` / `return []` / TODO 桩。
- 连通性检查：改动的 manifest 断言均对接真实 `dsh.test.*` 钩子，真机 run 的 journal 逐 step 验证（`new-conversation` / `singleton-before-reveal` / `inject-approval` 等均 PASS）。
- 反桩验证：无桩代码；未闭环项非桩，是「验证覆盖缺口」（GAP），已登记。
- 未修改 `src/` / `webview/src/` / `tests/`；未自行 commit / push；分支 `impl-phase-2-drive-nonmodel`。
