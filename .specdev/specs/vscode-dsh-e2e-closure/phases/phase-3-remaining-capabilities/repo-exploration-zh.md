# 代码库调研报告 — phase-3-remaining-capabilities（Phase 级调研）

## 1. Task Context

本 Phase 对「真实功能能力清单」（`repo-exploration.md` §12）中剩余 6 组 host 侧能力建立真机 EDH 驱动 + 截图 + 断言：§12.4 子会话进入/钉 Tab（#22–#23）、§12.5 代码上下文（@path / 选区提问，#24–#26）、§12.6 变更列表（#27–#29）、§12.7 搜索（#30–#31）、§12.10 历史（#37–#38）、§12.11 交互/审批 fail-closed（#39–#40）。复用 Phase 1 的 `run-layer-v-capabilities.sh` + `layer-v-capabilities.json` manifest + `layer-v-capability-driver/` 框架（纯编排 `capability-runner.cjs` + 宿主绑定 `extension.cjs`）。

本调研回答四个核心问题：(1) 六类能力在 `apps/vscode-dsh/src/` 的「已实现 vs 需补钩子」分布；(2) 哪些涉及真实 LLM 往返（继承 AC-9），哪些是纯 host 状态操作；(3) 现有 `dsh.test.*` 钩子覆盖与缺失；(4) Phase 1/2 已建立的可复用步骤模板。

关键结论先行：**14 项目标能力的产品实现全部 ✅ 已完整落地**，但 manifest 中的 steps 全是**占位/弱断言**（`listHistory` 代替 search、`openSubagent("__child__")` 传假 id、`openHistory("")` 传空串、`listPendingInteractions` 只断言 `$array`）。**6 组中有 2 组需要 implementer 新增产品测试钩子**（§12.6 回退、§12.11 交互注入），其余 4 组只需重写 manifest steps + 编排前置（真实会话/子会话）。

## 2. Repository Overview

| 项 | 值 | 证据 |
|----|----|------|
| 目标应用 | `@deepseek-ai/dsh-vscode-dsh`（VS Code 扩展，TypeScript ESM） | `apps/vscode-dsh/package.json:2,13` |
| 会话运行时 | `IdeSessionHost` 桥接 `dsh --profile ide` 子进程 | `apps/vscode-dsh/src/session-host.ts:430` |
| 驱动层 | CJS 扩展 `layer-v-capability-driver/`：`capability-runner.cjs`（纯编排，不 import vscode）+ `extension.cjs`（绑定 `vscode.commands` + 截图） | `capability-runner.cjs:47-48`、`extension.cjs:144-159` |
| manifest | `layer-v-capabilities.json`（41 项，每项 `id`/`group`/`ac`/`requiresModel`/`steps`/`evidence`） | `test-scripts/layer-v-capabilities.json` |
| 测试钩子门控 | `dsh.test.*` 仅 `VSCODE_DSH_TEST=1/true` 或注入 vscode 时注册 | `src/extension.ts:2343-2346` |
| 退出码契约 | 0=PASS / 1=LINK_FAILURE / 2=SKIPPED_NO_DISPLAY / 3=SKIPPED_NO_CREDENTIALS / 4=HARNESS_ERROR | `capability-runner.cjs:66` |

**步骤类型（runner 已支持，Phase 3 无需改 runner）**：`command` / `assert` / `wait` / `stream`（`requireIncrement` 增量门控）/ `replay`（关 Tab → `openHistory` 重开为 replay）/ `screenshot`（`pngVerdict` 非退化校验）— `capability-runner.cjs:600-772`。断言走 `MATCHERS` 可插拔注册表（`$string`/`$number`/`$boolean`/`$object`/`$array`/`$array:N`/`$present`），外加内联解析的 `$contains:`/`$assistantContains:`/`$assistantClosed:` — `capability-runner.cjs:321-369`。**Phase 3 的「实现 runStep」实质是重写 manifest 的 `steps` 数组，仅当需要新钩子时才触及产品源码**。

## 3. Most Relevant Areas

### 3.1 §12.4 子会话（#22–#23，group `subagent`）

| 文件:位置 | 内容 | 钩子 |
|------|------|------|
| `src/conversation-controller.ts:1758` | `openSubagentContext(childSessionId)`：子会话已 pin → `switchTo`；否则 `ensureChildHydrated` + `setContextSessionId`，返回 `{outcome:'opened-context'|'activated-tab'|'deleted'|'missing'|'host-not-ready'}` | `dsh.test.openSubagent` (`extension.ts:1289`) |
| `src/conversation-controller.ts:1831` | `pinSubagent(childSessionId?)`：把子会话提升为独立 Tab（`registry.create` + `setPinnedSubagent`），返回 `{outcome:'pinned'|'activated'|'deleted'|'missing'}` | `dsh.test.pinSubagent` (`extension.ts:1304`) |
| `src/conversation-controller.ts:1803` | `navBack()`：退出子会话上下文/从 pinned 子 Tab 回父 Tab，返回 `{outcome:'restored'|'noop'|'disabled'}` | `dsh.test.navBack` (`extension.ts:1297`) |
| `src/conversation-controller.ts:1934` | `applyTestSubagentNotification(phase, parent, child)`：L2 合成 `subagent.started/finished` 注入真实子会话 | `dsh.test.injectSubagent` (`extension.ts:1313`) |

**判定**：产品实现 ✅ 完整；4 个钩子 ✅ 全存在。**无需新增钩子**，但 manifest 现有 steps 传假 id `__child__` 必然返回 `missing`/`host-not-ready`，需改为「先 `injectSubagent` 造真实子会话 → 再 open/pin/nav」。

### 3.2 §12.5 代码上下文（#24–#26，group `code-context`）

| 文件:位置 | 内容 | 钩子 |
|------|------|------|
| `src/code-context/at-path.ts:54` | `extractAtPathTokens(text)`：提取 `@path`/`@"…"` token（纯函数，不读文件） | 无（仅 `prefillComposer` 侧面可达） |
| `src/code-context/at-path.ts:110` | `resolveAtPathInWorkspace(rawPath, opts)`：workspace 内路径解析 | 无 |
| `src/code-context/selection-ask.ts:143` | `askAboutSelection(deps)`：dirty-save → 生成指针文本 → prefill（**不触发模型往返**） | `dsh.test.askAboutSelection` (`extension.ts:1016`) → `runAskAboutSelection` (`extension.ts:2299`) |
| `src/chat-panel/render/ref-cards.ts:23` | `segmentTextWithRefs` / `renderRefCardNodes`：引用卡渲染（`@` token → ref card） | — |
| — | `panelHost.prefillComposer(text)` | `dsh.test.prefillComposer` (`extension.ts:1019`) |

**判定**：产品实现 ✅ 完整；`prefillComposer`/`askAboutSelection` 两个钩子 ✅ 存在。**但**：
- `@path token` / `workspace-path-resolve` 是**纯函数**，`prefillComposer` 只返回 `{ok:true}`，无法断言「token 确实被提取/解析」。要端到端断言需观察 webview ref-card 渲染或补钩子 → 见 §7 R3。
- `askAboutSelection` 需要 active editor + 非空 selection 前置（`getActiveEditor().selection`），headless EDH 默认无 active editor → 必返回 `no-editor`/`empty-selection`。且它**只 prefill、不触发模型往返** — 见 §7 R1。

### 3.3 §12.6 变更列表（#27–#29，group `change-list`）

| 文件:位置 | 内容 | 钩子 |
|------|------|------|
| `src/change/change-index.ts:34,54` | `writeChangeIndex` / `readChangeIndex`：ChangeRecord 元数据索引落盘/冷读 | — |
| `src/change/change-store.ts:19,108` | `ChangeStore.upsert` / `toListPayload`：会话级变更索引 | — |
| `src/change/change-attributor.ts:69,91,153` | `noteToolCall`（before 快照）/ `ingestToolResult`（`meta.diffs` 摄取）/ `settleTurn`（物化 ChangeRecord + SnapshotStore blob） | — |
| `src/change/snapshot-store.ts:87` | `SnapshotStore.write`：全文件 before/after blob | — |
| `src/change/revert.ts:187` | `executeRevert(deps, changeId)`：回退单个变更（写工作区，非桩） | **无 `dsh.test.revert` 钩子** |
| `src/conversation-controller.ts:1223,1270` | `revertChange` / `revertChanges`：回退编排（仅 Webview/`reviewWorkspaceDiffs` 可达） | **无钩子** |
| `src/conversation-controller.ts:1469` | `changedFileCount(sessionId)`：`timeline.writeDiffsForSession(sessionId).length` | `dsh.test.changedFileCount` (`extension.ts:1135`) |
| `src/chat-panel/render/change-diff-dom.ts:35` | `fillChangeDiffPane`：Diff 渲染（XSS-safe textContent） | — |
| — | `timeline.writeDiffsForSessionTree(active.sessionId)` 返回可恢复 hunks | `dsh.test.diffAvailability` (`extension.ts:1221`) |

**判定**：产品实现 ✅ 完整。`changedFileCount`/`diffAvailability` 钩子 ✅ 存在（但都是**只读**：无变更时返回 `{count:0}`/`{available:false}`）。**缺 `dsh.test.revert*` 钩子** → §12.6「快照与回退」（#28）无法真机驱动，与 Phase 2 的分叉钩子缺口同性质，见 §7 R2。变更的**产生**依赖真实模型往返触发写工具（`meta.diffs`）→ `ChangeAttributor.ingestToolResult`，故 `requiresModel:true` 正确。

### 3.4 §12.7 搜索（#30–#31，group `search`）

| 文件:位置 | 内容 | 钩子 |
|------|------|------|
| `src/search/session-search.ts:46` | `searchSessions(extensionIndex, pathIndex, query)`：Tier-1（title/firstUserPreview）+ Tier-2（path→session）搜索，**永不读 body** | **无 `dsh.test.searchSessions`** |
| `src/search/session-search.ts:116` | `matchTier1Field(row, text)`：大小写不敏感子串匹配 | — |
| `src/conversation-controller.ts:1356` | `searchSessions(query)` → `runSessionSearch` | — |
| `src/extension.ts:730` | 产品命令 `dsh.searchSessions`（无参时弹 InputBox；传 `{text}`/`{path}` 或字符串则返回 `{outcome, hits}`） | 产品命令，可 `executeCommand` |

**判定**：产品实现 ✅ 完整。**无测试钩子**，但产品命令 `dsh.searchSessions` 支持传参（`{text: '...'}`）并返回结构化 `hits`，**可直接 `executeCommand('dsh.searchSessions', {text})` 驱动，无需新增钩子**（若要与其它能力统一 `dsh.test.*` 门控风格可补一个薄钩子，见 §7 R4）。manifest 现有 steps 用 `dsh.test.listHistory`（**不是搜索**）是占位错误。

### 3.5 §12.10 历史（#37–#38，group `history`）

| 文件:位置 | 内容 | 钩子 |
|------|------|------|
| `src/history-view.ts:133` | `listHistoryFromIndex(index)`：Host 无关的历史列表（`index.listHistorySessions()`） | `dsh.test.listHistory` (`extension.ts:1077`) |
| `src/conversation-controller.ts:389` | `openFromHistory(sessionId, {events?})`：冷读权威日志 → 重放 Tab（`host.readSessionLog`） | `dsh.test.openHistory` (`extension.ts:1057`) |

**判定**：产品实现 ✅ 完整；两钩子 ✅ 存在。manifest 现有 `cap-open-from-history` 传 `args: [""]`（空串）→ `openHistory` 钩子拒绝空 sessionId 返回 `{outcome:'missing'}`（`extension.ts:1064-1066`），**占位必然失败**。需改为「先真实往返造会话 → `listHistory` 取真实 sessionId → `openHistory(sessionId)`」。`openFromHistory` 无 events 注入时需 host 已连（`readSessionLog`），故 `requiresModel` 应为 false（重放无生成）但前置依赖真实往返造出的会话。

### 3.6 §12.11 交互/审批 fail-closed（#39–#40，group `interaction`）

| 文件:位置 | 内容 | 钩子 |
|------|------|------|
| `src/interaction-coordinator.ts:217` | `InteractionCoordinator.listPending()`：pending/presented 交互投影 | `dsh.test.listPendingInteractions` (`extension.ts:1097`) |
| `src/interaction-coordinator.ts:288` | `resolveApproval(id, outcome)`：无 UI 往返答审批（AD-12），`unknown-id`/`invalid-outcome` fail-closed | `dsh.test.answerApproval` (`extension.ts:1109`) |
| `src/interaction-coordinator.ts:308,341` | `handleApproval` / `handleQuestions`：入队 + 串行呈现（**仅 `session-host.ts:938,945` 桥帧可达**） | **无注入钩子** |
| `src/interaction-coordinator.ts:372,390` | `failClosedAll` / `failClosedSession`：Host 死/Tab 关时 fail-closed 清队 | `dsh.test.injectDisconnect` (`extension.ts:1277`) 可间接触发 |
| `src/interaction-ui.ts:72` | `createVscodeInteractionUi`：QuickPick/InputBox 呈现（可替换 AD-8） | — |

**判定**：产品实现 ✅ 完整。`listPendingInteractions`/`answerApproval` 钩子 ✅ 存在。**但无 `dsh.test.injectApproval`（注入 pending 审批请求）钩子** — `handleApproval` 仅被真实 runtime 桥帧（`session-host.ts:938`）调用，而要触发桥帧需要一个真实模型往返发起需审批的工具调用。因此「审批队列 / answerApproval / fail-closed」无法在无注入钩子、无可控审批工具时真机驱动，见 §7 R5。这是**第二处需新增产品钩子的缺口**。

## 4. Key Entry Points / Call Paths

### 4.1 子会话进入/钉 Tab（§12.4，纯 host 状态）

```
dsh.test.injectSubagent({phase:'finished', parentSessionId, childSessionId})  (extension.ts:1313)
 └─ controller.applyTestSubagentNotification(...)  (conversation-controller.ts:1934)
     └─ timeline.apply('subagent.finished') + onSubagentStarted → 真实子会话入索引

dsh.test.openSubagent(childSessionId)  (extension.ts:1289)
 └─ controller.openSubagentContext(childSessionId)  (conversation-controller.ts:1758)
     ├─ 子会话已 pin → registry.switchTo(pinned.tabId) → {outcome:'activated-tab'}
     └─ 否则 ensureChildHydrated → registry.setContextSessionId → {outcome:'opened-context', mode:'replay'|'readonly-live'}

dsh.test.pinSubagent(childSessionId)  (extension.ts:1304)
 └─ controller.pinSubagent(childSessionId)  (:1831)
     └─ registry.create(title, childId, mode) + setPinnedSubagent → {outcome:'pinned'}

dsh.test.navBack()  (extension.ts:1297)
 └─ controller.navBack()  (:1803) → {outcome:'restored'|'noop'|'disabled'}
```

### 4.2 代码上下文（§12.5，@path 纯函数 / 选区 prefill）

```
dsh.test.prefillComposer('@README.md')  (extension.ts:1019)
 └─ panelHost.prefillComposer(text) → {ok:true}   ← 无解析结果回传（R3）

dsh.test.askAboutSelection()  (extension.ts:1016) → runAskAboutSelection (extension.ts:2299)
 └─ askAboutSelection(deps)  (selection-ask.ts:143)
     ├─ getActiveEditor().selection 为空 → {ok:false, reason:'empty-selection'}   ← headless 前置缺口
     ├─ dirty → save → toWorkspaceRelativePath → buildPointerText  (:83)
     ├─ ensureLiveTab() (replay 则 mint live Tab)
     └─ prefillComposer(pointerText) → {ok:true, pointerText, path, startLine, endLine}
[模型往返点] 需后续 dsh.test.sendPrompt(pointerText) 才触发（hook 本身不生成）
```

### 4.3 变更列表产生与回退（§12.6，真实模型触发归属 + 缺口）

```
[真实模型往返] sendPrompt("修改 <文件> ...") → 模型调 write/edit 工具
 └─ tool/result.meta.diffs → ChangeAttributor.ingestToolResult(sessionId, turn, meta)  (change-attributor.ts:91)
     └─ settleTurn → SnapshotStore.write(before/after) + ChangeStore.upsert(record)  (:153)

dsh.test.changedFileCount()  (extension.ts:1135)
 └─ controller.changedFileCount(active.sessionId)  (:1469) → timeline.writeDiffsForSession().length

dsh.test.diffAvailability()  (extension.ts:1221)
 └─ controller.timeline.writeDiffsForSessionTree(active.sessionId) → {available, hunks}

[缺] 无 dsh.test.revert* 钩子 → executeRevert (revert.ts:187) 仅 reviewWorkspaceDiffs/Webview 可达 (R2)
```

## 5. Likely Impact Surface

| 目标 | 涉及文件 | 风险 |
|------|------|:--:|
| 重写 14 项目标的 manifest steps + 断言（复用 marker 模板 + 编排前置） | `test-scripts/layer-v-capabilities.json` | 低（JSON steps/expect/args） |
| §12.6 回退钩子 `dsh.test.revert`（调 `controller.revertChange`/`executeRevert`） | `src/extension.ts`（`shouldRegisterTestHooks` 块 `:1009-1328`）+ 可能 `src/conversation-controller.ts` | **中高**（改产品源码，`ui:false` 但需 implementer 分支 + review） |
| §12.11 交互注入钩子 `dsh.test.injectApproval`（调 `host.interactions.handleApproval`） | `src/extension.ts`（同块） | **中高**（同上） |
| （可选）§12.7 补 `dsh.test.searchSessions` 薄钩子 | `src/extension.ts`（同块） | 低（可不用：产品命令已可 executeCommand） |
| 前置编排：真实会话/子会话/选区 | 驱动层 manifest steps（无产品代码改动） | 中（需真实 LLM 往返造会话、真实写工具触发变更、EDH 造 active editor + selection） |
| 运行产物 | `test-artifacts/layer-v-capabilities/`（gitignore） | 低 |

**注意**：本工作流 `ui_relevant:false`，但 §12.6/§12.11 若新增钩子仍会触碰产品 `src/extension.ts`。按 `spec-workflow.mdc` 这必须由 implementer 在 `impl-phase-3-remaining-capabilities` 分支上完成，并经 review + verifier。与 Phase 2 的 `dsh.test.fork*` 钩子（`extension.ts:1189-1215`）是同一模式，可直接参照。

## 6. Existing Constraints / Conventions

- **marker 真实往返范式（Phase 2 已证明）**：`newConversation` → `sendPrompt("…LAYER-V-CAP-N-OK")` → `wait $assistantContains:LAYER-V-CAP-N-OK`（或 `$assistantClosed:` 用于需闭合轮的场景）→ `screenshot`。`$assistantContains` 只匹配 assistant 文本（不回显 user 气泡），`$assistantClosed` 额外要求 `!streaming` — `capability-runner.cjs:351-367`。Phase 3 任何涉及模型往返的能力必须镜像此模式。
- **会话/建连 preamble（Phase 2 复用模板）**：`reveal-editor-panel`(`dsh.showPanel`) → `open-activity-bar`(`dsh.test.openActivityBar`) → `fire-conversation-visible`(`dsh.test.fireConversationVisibility`, args `[true]`) → `wait host-started`(`dsh.test.simulateStartupOnly`, expect `{ok:true,startState:'started',hostStatus:'connected'}`) → `assert new-conversation`(`dsh.test.newConversation`, expect `{outcome:'created'}`) — `layer-v-capabilities.json:186-195`。纯 host 状态能力可省 preamble，但需 host 已连的能力（openSubagent/pinSubagent 要求 `host.status==='connected'`）必须带。
- **credential 门控**：`requiresModel:true` 无 `DEEPSEEK_API_KEY` → `SKIPPED_NO_CREDENTIALS`(exit 3) 且优先级高于 PASS — `capability-runner.cjs:847-863`。Phase 3 中「变更列表 3 项」「选区提问」若 `requiresModel:true` 会继承此语义。
- **AC-9 铁律**：`dsh.test.injectAssistant`/`dsh.test.answerApproval`/`restoreOpenTabs`(带 events) 注入/回放**仅辅助**，不得作模型往返等价验收 — `spec.md`。
- **断言扩展位**：新增 `$selector`/`$visible` 等只需往 `MATCHERS` 注册一个条目，`matchesExpect` 核心不动 — `capability-runner.cjs:321-328`。Phase 3 六组能力用现有 matcher 已够，无需新增。
- **测试钩子门控**：新钩子必须写在 `if (shouldRegisterTestHooks(vscodeArg))` 块内（`extension.ts:1010-1328`），并 push 进 `testDisposables` — `extension.ts:1331-1354`。
- **CJS 驱动 + 纯编排分层**：`capability-runner.cjs` 不 import vscode，`extension.cjs` 绑定宿主；新增能力步骤无需改 driver，只改 manifest JSON。
- **journal/exit-code 契约**：逐步追加 journal、`verdict ∈ {PASS, LINK_FAILURE, HARNESS_ERROR, SKIPPED_NO_CREDENTIALS}`、截图 `pngVerdict` 非退化 — Phase 1 已固化。

## 7. Risks / Unknowns

| # | 风险/未知 | 确认度 | 说明 |
|---|---|---|---|
| R1 | §12.5 `selection-ask` 的 `requiresModel:true` 与实际不符：`askAboutSelection` 只 dirty-save + prefill，**不触发模型往返** | ✅ CONFIRMED | `selection-ask.ts:143-196` 全程无 `promptTab`/`host.prompt`；spec.md「选区提问会触发模型往返」指的是 prefill 之后**用户再发送**才往返。要满足 AC-9，manifest 必须链 `askAboutSelection` → `sendPrompt(pointer)` → `wait $assistantContains`。仅 `askAboutSelection`+screenshot 不满足 AC-9。 |
| R2 | §12.6「快照与回退」缺 `dsh.test.revert*` 钩子，真机驱动路径需新增（同 Phase 2 fork 缺口） | ❓ UNKNOWN（缺口已确认，解法未定） | `executeRevert`/`revertChange` 仅 `dsh.reviewWorkspaceDiffs`(Webview) 与 Webview revert 消息可达；无命令、无 test hook。需 spec/implementer 决策是否在 `extension.ts` 新增 `dsh.test.revert`。 |
| R3 | §12.5 `@path`/`workspace-path-resolve` 无法真机断言「解析结果」 | ⚠️ HYPOTHESIS | `extractAtPathTokens`/`resolveAtPathInWorkspace` 是纯函数，`prefillComposer` 只返回 `{ok:true}`。真机只能断言「prefill 后 webview 出现 ref-card」或补钩子返回解析结果。目前无返回解析结果的钩子。 |
| R4 | §12.7 搜索无 `dsh.test.searchSessions`，但产品命令 `dsh.searchSessions` 可 executeCommand 传参驱动 | ✅ CONFIRMED | `extension.ts:730-748`：传 `{text}`/`{path}`/字符串 → 返回 `{outcome, hits}`，无需 InputBox。无参才弹 InputBox（headless 不友好）。可直接用产品命令，不必新增钩子。 |
| R5 | §12.11 交互 fail-closed 无法真机驱动：无 `dsh.test.injectApproval` 注入 pending 审批 | ❓ UNKNOWN（缺口已确认） | `handleApproval` 仅 `session-host.ts:938` 桥帧可达，桥帧需真实模型往返触发需审批工具。`listPendingInteractions` 恒空 → `$array` 弱断言恒过。要测「answerApproval/fail-closed/队列」需注入钩子或可控审批工具。 |
| R6 | headless EDH 无 active editor/selection，`askAboutSelection` 前置难满足 | ⚠️ HYPOTHESIS | `runAskAboutSelection` 依赖 `vscode.window.activeTextEditor.selection`（`extension.ts:2308`）。EDH 需先 `vscode.commands.executeCommand('vscode.open')` + 设置 selection 才能非空。未实测沙箱 HOME 下能否稳定造出 active editor。 |
| R7 | §12.4 子会话真机前置：需先 `injectSubagent` 造真实子会话，否则 open/pin 返回 missing | ✅ CONFIRMED | `openSubagentContext` 对未知 childSessionId 会 `ensureChildHydrated`（读索引/日志）；`injectSubagent` 是唯一无模型注入真实子会话的钩子。manifest 现有 `__child__` 假 id 必然失败。 |
| R8 | 变更列表 3 项的 `requiresModel:true` 且需模型**实际产生写工具调用**，控制模型写指定文件是难点 | ⚠️ HYPOTHESIS | 变更归属依赖 `meta.diffs`（`change-attributor.ts:91`），需模型对工作区文件做 str_replace_editor/edit 产生 `presentationMeta`。提示词需精确诱导模型写文件；若模型拒绝/只说不写，`changedFileCount` 恒 0。 |
| R9 | 真机闭环时长：14 项含多项真实模型往返 + 写文件 | ⚠️ HYPOTHESIS | 建议按 `--capability <id>`（S-2，`run-layer-v-capabilities.sh:213-234`）分批复验，与 Phase 2 R6 一致。 |

## 8. Uncertain / Unverified

| 签名 | 位置 | 状态 |
|------|------|------|
| `dsh.test.askAboutSelection` 是否在 headless EDH 稳定拿到 active editor + selection | `extension.ts:2308` | ❓ 未实测（R6） |
| `host.interactions.handleApproval` 是否可被驱动层直接注入（无测试钩子） | `session-host.ts:938` | ✅ 已读：仅桥帧可达，无 hook |
| `dsh.searchSessions` 产品命令传参路径是否稳定返回 hits（不弹 InputBox） | `extension.ts:740-748` | ✅ 已读：传 object/string 时不弹 InputBox |
| `injectSubagent` 造出的子会话能否被 `openSubagentContext` 正确 hydrate（不依赖真实 fork） | `conversation-controller.ts:1934` | ⚠️ 签名存在，未实测 end-to-end |
| `SnapshotStore.write`/`ChangeAttributor.settleTurn` 在真实写工具下是否稳定产出 `snapshotRef` | `change-attributor.ts:153` | ✅ 已读逻辑；「真实模型是否触发写工具」未实测 |
| `executeRevert` 的 `workspace.writeText`/`deleteFile` 在沙箱 HOME 下是否可写 | `revert.ts:187-218` | ⚠️ 签名存在，未实测沙箱写权限 |

## 9. Stub Detection & Registry Cross-Validation

`tech-debt-registry.md` 现含 3 条活跃债务（DEBT-1/2/3），均 🟡 非阻塞、目标 `phase-5-cleanup-orchestration-regression`。

### Registry 校验结果

| Registry ID | 文件:位置 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-1 | `layer-v-capability-driver/capability-runner.cjs`（`StageError`/`safeJson`/`pngVerdict`/`sha256Of`/`resolveCaptureTool` 等 13+ 原语） | 已知缺陷：镜像 `layer-v-driver/extension.cjs` 语义复制 | 代码仍为独立第二份拷贝（`capability-runner.cjs:69-475`） | ✅ 匹配（目标 phase-5，本 Phase 无需处理，且语义逐字节一致不影响本 Phase） |
| DEBT-2 | `sdk/server` `createForkedSession` emptySeed + `conversation-controller.forkFromClosedTurn` retry | 已知缺陷：shadow preset 自主 loop 抢占 retry 首轮输入 | 属 §12.8 分叉（Phase 2 范围），**与本 Phase 六组能力无关** | ✅ 匹配（不阻塞本 Phase） |
| DEBT-3 | `layer-v-capabilities.json` #18 `stream` 步 `requireIncrement:true` | 已知缺陷：流式增量跨 run 波动（150ms 轮询偶发漏采） | 属 Phase 2 `cap-message-store-stream-patch` #18，**本 Phase 六组能力不依赖 `stream` 增量**（除非为 selection-ask 加 stream 步） | ✅ 匹配（不阻塞本 Phase；若 selection-ask 用 `stream` 步需注意同源时序敏感性） |

### Stub Detection Summary

- ✅ Confirmed stubs（匹配 registry）：3 个（DEBT-1/2/3，均 🟡 非阻塞、目标 phase-5，与本 Phase 六组能力无阻塞交叉）
- ⚠️ Registry mismatch：0 个
- 🔴 Unregistered stubs：0 个（六组能力源文件 `code-context/*`/`change/*`/`search/*`/`interaction-coordinator.ts`/`interaction-ui.ts`/`history-view.ts` 均已读，全为真实逻辑，无空壳/`return 0`/`@STUB`/TODO 桩）

**本 Phase 相关缺口（非桩，属「驱动触发面缺失」，与 Phase 2 fork 缺口同性质，无需 `@STUB` 登记）**：
1. §12.6 回退无 `dsh.test.revert*` 钩子（`revertChange`/`executeRevert` 仅 Webview 可达）；
2. §12.11 交互无 `dsh.test.injectApproval` 钩子（`handleApproval` 仅 runtime 桥帧可达）。

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/src/extension.ts`（`:1009-1328` 全部 test hooks、`:2343-2346` 门控、`:2299-2337` runAskAboutSelection）— 新增钩子的唯一正确落点
2. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（14 项目标现有占位 steps，见 §3 各 group 项）
3. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（`:600-772` 步骤类型、`:321-369` matcher 含 `$assistantContains`/`$assistantClosed`）
4. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts`（`:389` openFromHistory、`:1223/1270` revertChange、`:1356` searchSessions、`:1469` changedFileCount、`:1758/1803/1831/1934` subagent）
5. 🔷 SHOULD READ — `apps/vscode-dsh/src/code-context/at-path.ts` + `selection-ask.ts`（`:54/110` 提取解析、`:143` askAboutSelection 纯 prefill）
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/change/change-attributor.ts`（`:91/153` meta.diffs 摄取与 settle）+ `revert.ts`（`:187` executeRevert）
7. 🔷 SHOULD READ — `apps/vscode-dsh/src/search/session-search.ts`（`:46` searchSessions）+ `history-view.ts`（`:133` listHistoryFromIndex）
8. 🔷 SHOULD READ — `apps/vscode-dsh/src/interaction-coordinator.ts`（`:217/288/308/372` listPending/resolveApproval/handleApproval/failClosedAll）
9. 🔹 OPTIONAL — Phase 2 已交付的 fork 钩子 `dsh.test.forkRetry/forkBranch`（`extension.ts:1189-1215`）作为「新增测试钩子」的权威先例
