# Phase 4 实现摘要：Subagent 进入 / 钉 Tab / 父子已删导航

> 本次为**在当前代码结构上重新实现**（原实现未 commit 已丢失，仅剩过期 patch）。
> 落点以 `repo-exploration.md` 的当前结构为准；`recovery/*.patch` 仅作旧逻辑参考，未直接打补丁。

## 变更清单（文件列表）

### Host 侧（`apps/vscode-dsh/src/`）

| 文件 | 变更 |
|------|------|
| `chat-panel/protocol.ts` | `PanelMode` 加 `readonly-live`；`RejectSendReason` 加 `readonly-live`；新增 `PanelBreadcrumb` 类型；`panel/state` 加 `breadcrumb?`/`contextSessionId?`；新增 `nav/open-subagent` / `nav/back` / `action/pin-subagent` 三个 Webview→Host 帧，`parseWebviewToHostMessage` 增加 fail-closed 解析分支 |
| `chat-panel/chat-panel-host.ts` | 新增 `PanelProjection` 接口 + `resolvePanelProjection` 依赖；`requestOpenSubagent`/`requestNavBack`/`requestPinSubagent` 依赖；`pushFullState`/`pushAppend`/`pushPatch`/`pushStatus`/`sendPrompt`/`onWebviewMessage` 全部尊重投影；新增私有 `projectedSessionId()` |
| `chat-panel/index.ts` | 重新导出 `PanelProjection`、`PanelBreadcrumb` 新类型 |
| `conversation-controller.ts` | 新增 `openSubagentContext`/`navBack`/`pinSubagent`/`resolvePanelProjection`/`markSubagentCardDeleted`/`ensureChildHydrated`/`clearContextsReferencing`/`applyTestSubagentNotification`/`onSubagentStarted`/`onSubagentFinished`；`childRunState` 跟踪子生命周期；`onSdkNotification` 处理 `subagent.started`/`subagent.finished`；`deleteConversation`/`deleteSession` 调用 `markSubagentCardDeleted`；`continueConversation`/`continueChromeForTab` 支持子上下文（`effectiveContinueSessionId`/`effectiveContinueMode`）；新增 `isProjectedSession` 使 assistant 消息/流式投影在子上下文时仍推送 webview |
| `conversation-registry.ts` | `ConversationTab` 加 `contextSessionId`/`pinnedSubagent` 字段 + `setContextSessionId`/`setPinnedSubagent` 方法 |
| `extension-index.ts` | `OpenTabRecord` 加 `pinnedSubagent`，持久化与恢复时消费 |
| `message-store.ts` | 新增 `SubagentCardStatus` 类型；`ChatMessage` 加 `childSessionId`/`subagentStatus`；新增 `patchWhere` 方法 |
| `timeline-store.ts` | 公开已有父子边 `getParent`/`childrenOf`（边由 `subagent.started`/`finished` 填充，未重复造边） |
| `extension.ts` | `createPanelHost` 接线 `resolvePanelProjection`/`requestOpenSubagent`/`requestNavBack`/`requestPinSubagent`；新增测试命令 `dsh.test.openSubagent`/`navBack`/`pinSubagent`/`injectSubagent` |

### Webview 侧（`apps/vscode-dsh/webview/src/`）

| 文件 | 变更 |
|------|------|
| `bridge/message-bridge.ts` | `ChromeIntent` 增加 `nav/open-subagent`/`nav/back`/`action/pin-subagent` 三个 intent |
| `store/chat-ui-store.ts` | `PanelMode` 加 `readonly-live`；新增 `BreadcrumbState`；`ChatUiState` 加 `contextSessionId`/`breadcrumb`；`deriveComposerState` 把 `readonly-live` 映射为 `readonly`；`UiMessage` 加 `childSessionId`/`subagentStatus`；`applyHostFrame` 消费 `panel/state.breadcrumb`/`contextSessionId`，`ui/reject-send` 处理 `readonly-live` 文案 |
| `components/TabChrome.tsx` | 渲染 breadcrumb / back / pin chrome（参照现有 `forkParentTitle` banner），尊重 `parentDeleted` 禁用态 |
| `components/MessageList.tsx` | 新增 `SubagentCard` 组件，渲染 `kind:'subagent'` 卡片三态（running/ended/deleted）；deleted 不可点，其余可点进入子会话 |
| `components/Composer.tsx` | `readonly-live` 模式的 placeholder / reason 文案 |
| `App.tsx` | Composer 禁用原因纳入 `readonly-live`；向 `TabChrome` 传 `contextSessionId`/`breadcrumb`；`MessageList` 的 `readonly` 纳入 `readonly-live` |

### 测试

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts` | **新增**（补回丢失的测试）：11 个用例覆盖 AC-35/36/37/38/39/40/71/74/75/78/79/84 |

## 对每个验收标准的实现说明

| ID | 实现说明 |
|----|---------|
| **AC-35** 父流入口进入子会话可读消息流 | `openSubagentContext` 设置 `contextSessionId`，`ensureChildHydrated` 从 `readSessionLog`/测试钩子水合子消息，`pushFullState` 以子 session 为投影下发 `messages/replace` |
| **AC-36** 面包屑返回父 | `navBack` 清 `contextSessionId` 恢复父根；`buildBreadcrumb` 产出 `PanelBreadcrumb`；Webview `TabChrome` 渲染返回按钮 |
| **AC-37** 进入默认不占 Tab | `openSubagentContext` 只设 `contextSessionId`，不 mint 新 Tab（测试断言 `registry.list().length` 不变） |
| **AC-38** 可钉成 Tab | `pinSubagent` 提升子为独立 Tab（`pinnedSubagent=true`），写入 `OpenTabRecord` |
| **AC-39** 子进行中/结束卡片状态 | `onSubagentStarted`/`onSubagentFinished` + `childRunState`；`MessageStore` 卡片 `subagentStatus` running↔ended↔deleted |
| **AC-40** 子结束后进入只读回放 | `resolvePanelProjection` 在 `childRunState !== 'running'` 时投影 `mode='replay'`，Continue 策略与父一致（`effectiveContinueMode`） |
| **AC-71** 运行中进入 = 只读实时；结束自动转回放 | `resolvePanelProjection` 在 running 时投影 `readonly-live`；`sendPrompt` 据此 reject（`reason='readonly-live'`）；`isProjectedSession` 保证子 `session.event` 流式消息在子上下文时仍推 webview（修复 V-IND-5）；结束事件后投影自动翻转为 `replay` |
| **AC-74** 子已删 → 父卡片「子会话已删除」不可进入 | `markSubagentCardDeleted` 把父卡片 `subagentStatus='deleted'`、文案「子会话已删除」；`openSubagentContext` 对已删子返回 `outcome:'deleted'` |
| **AC-75** 父已删 → 子面包屑「父会话已删除」禁用返回 | `buildBreadcrumb` 对父已删/父未打开产出 `parentDeleted=true` + 禁用文案；`navBack` 返回 `outcome:'disabled'` |
| **AC-78** 已钉后从父进入激活已有 Tab | `openSubagentContext` 对已钉子返回 `outcome:'activated-tab'` 并 `switchTo` 已有子 Tab |
| **AC-79** 钉定时处于子上下文 → 提升 Tab 并恢复父视图 | `pinSubagent` 清 `contextSessionId`、恢复父为 active、`pinnedSubagent=true` |
| **AC-54/84** L2 + L3（模拟 Webview） | `phase4-subagent-enter-pin.spec.ts`（L2/L3，FakeWebview 对接真实 Host）+ `test-scripts/verifier-independent-phase4.mts`（独立验证 V-IND-1~6） |

## 测试结果（命令 + 输出）

```text
$ export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"

$ ./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts
 RUN  v4.1.8 .../deepseek-harness
 Test Files  1 passed (1)
      Tests  11 passed (11)

$ ./node_modules/.bin/vitest run apps/vscode-dsh/tests
 Test Files  59 passed (59)
      Tests  522 passed | 1 skipped (523)

$ ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
(exit 0，无输出)
```

补充验证：

```text
$ ./node_modules/.bin/tsx .specdev/.../phase-4-subagent-enter-pin/test-scripts/verifier-independent-phase4.mts
=== done failed=0 ===          （V-IND-1 ~ V-IND-6 全部 PASS）

$ vite build --config webview/vite.config.ts
✓ built in 340ms             （webview 构建通过）
```

## 偏差记录

| 偏差 | 影响范围 | 原因 | 影响 |
|------|---------|------|------|
| 生产 UI 落在 React SPA（`webview/src/`），未改动 `buildThinChatHtml` 的 subagent UI | spec.md 产出清单「面板 Subagent 卡片」 | `repo-exploration` 明确 `buildThinChatHtml` 已降级为 fixture-only，生产 UI 是 React SPA | 无（符合当前代码结构约束，`buildThinChatHtml` 的 subagent 逻辑本就缺失且被排除） |
| `assistant/message`、`assistant/chunk`、`markTurnIncomplete` 等投影推送判断由 `active.sessionId === sessionId` 改为 `isProjectedSession(active, sessionId)`（含 `contextSessionId`） | spec.md AC-71 | 原判断在「子上下文投影」时误把子 session 当作后台 session（不再推 webview），导致 V-IND-5 失败；这是投影语义统一修复 | 无副作用；后台 Tab 仍走 `setUnread`，行为不回归 |

## 仍未关项

无。未留任何桩标记；`tech-debt-registry.md` 活跃债务表为空，DEBT-007~013 已在本 Phase 重新真实成立（重新实现后回归测试覆盖）。未 git commit（改动留在工作区，待调度者 HG-3 统一提交）。

## SHOULD-FIX 修复记录

> 本轮为续做修复：处理 review 合并判决的 2 条 SHOULD-FIX（`review.md` 判决 SHOULD-FIX）。未 git commit。

### SHOULD-FIX-1：钉「运行中」子会话 Tab 投影为 `readonly-live`，消除口径分裂

- **现象**：`pinSubagent` 对运行中子会话建成 `mode='live'` 的可写 Tab，而上下文进入路径投影 `readonly-live`（只读），同一运行中子会话存在「上下文只读 / 钉 Tab 可写」的口径分裂。
- **改法（reviewer-design 建议方案 a，投影层最小改动）**：
  - `conversation-controller.ts` 的 `resolvePanelProjection` 根分支新增判断：当 `active.pinnedSubagent === true` 且 `childRunState.get(active.sessionId) === 'running'` 时投影 `mode = 'readonly-live'`；否则维持 `active.mode === 'replay' ? 'replay' : 'live'`。
  - Tab 的 registry `mode` 字段仍保持 `'live'`（`OpenTabMode` 只有 `'live' | 'replay'`，不扩展）；`sendPrompt` 无需改动，`chat-panel-host.ts` 已对 `projection.mode === 'readonly-live'` 返回 `reject('readonly-live')`。
  - `onSubagentFinished` 既有兜底（`childTab.mode === 'live'` 时 `setMode('replay')`）保持成立：钉运行中子 Tab 的 registry `mode` 仍为 `'live'`，子结束事件后 `setMode('replay')` 且 `childRunState` 置 `'ended'`，投影由 `readonly-live` 翻转为 `replay`。
- **影响范围**：spec.md AC-71 / design.md AD-CU-11。
- **测试**：`phase4-subagent-enter-pin.spec.ts` 新增用例「pinned running child Tab projects readonly-live and rejects send until finished (AD-CU-11)」，断言钉运行中子 Tab 投影 `readonly-live`、`sendPrompt` 以 `readonly-live` 拒绝、子结束后投影翻转为 `replay`。

### SHOULD-FIX-2：删除 `TimelineStore.childrenOf()` 休眠 API

- **现象**：`timeline-store.ts` 的 `childrenOf(sessionId)` 公开方法全树零调用（`getParent` 有 3~4 处消费方），属「暴露但从未读取」的死 API。
- **改法**：删除 `childrenOf` 公开方法及其 JSDoc；保留私有 `children` map（`linkChild`/`clearSession`/`apply` 等内部仍使用）。
- **影响范围**：无（零调用方，不影响任何端到端路径）。
- **验证**：grep `childrenOf` 在 `apps/vscode-dsh` 下零残留（`packages/client/connection/src/client/fixture.ts` 的同名局部闭包与本方法无关）。

### 测试与验证（本轮重跑）

```text
$ ./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)

$ ./node_modules/.bin/vitest run apps/vscode-dsh/tests
 Test Files  59 passed (59)
      Tests  523 passed | 1 skipped (524)

$ ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
(exit 0，无输出)
```

### 仍未关项

无。未新增 `@STUB`；`tech-debt-registry.md` 无新增活跃债务。未 git commit（改动留在工作区 `impl-phase-4-subagent-enter-pin` 分支，待调度者 HG-3 统一提交）。
