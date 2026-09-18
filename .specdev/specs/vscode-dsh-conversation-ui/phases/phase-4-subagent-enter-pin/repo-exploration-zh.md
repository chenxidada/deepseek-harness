# 代码调研报告 — phase-4-subagent-enter-pin（phase 级）

## 1. 任务背景

这是工作流 `vscode-dsh-conversation-ui` 中 `phase-4-subagent-enter-pin` 的 **phase 级**调研。本 Phase 目标是实现「Subagent 进入子会话 / 钉 Tab / 父子已删导航」，验收标准见 AC-35/36/37/38/39/40/71/74/75/78/79/54/84。

**关键事实**：phase-4 曾实现过一次，但代码**从未 git commit**，切换分支后丢失。现仅存一份 recovery patch（`.specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/recovery/phase-4-subagent-enter-pin.patch`，13 个文件、1668 行），基于 `phase-3-restart-continue` 时代生成。phase-3 之后仓库又经过 `vscode-dsh-chat-ready`、`vscode-dsh-code-context-diff`、`vscode-dsh-chat-ux`、`vscode-dsh-editor-chat-panel` 等演进（新增 fork、activity-stream、change-list、session-search、editor-chat-panel）。**该 patch 无法直接打上。** 本报告回答「在当前代码结构下这套功能应落在哪些文件、哪些接口、哪些调用链」，而非复述 patch 旧结构。

Grep 证据（全 `apps/vscode-dsh/src` 树）：phase-4 的符号（`openSubagentContext`、`pinSubagent`、`navBack`、`markSubagentCardDeleted`、`setPinnedSubagent`、`setContextSessionId`、`pinnedSubagent`、`contextSessionId`、`readonly-live`、`PanelBreadcrumb`、`PanelProjection`、`resolvePanelProjection`）在当前代码库中**均不存在**，仅 `extension.ts` 命中无关的 `createPanelHost`。因此 subagent 功能当前**完全缺失**，需重新实现。

## 2. 仓库概览

- **语言 / 模块体系**：TypeScript、ESM（`"type": "module"`）、严格类型；VS Code 扩展位于 `apps/vscode-dsh/`。
- **两个面板面**（phase-3 以来最大的结构变化）：
  1. **侧边栏 WebviewView**（`chat-panel-provider.ts`）—— 通过 `buildThinChatHtml` 生成极薄 HTML，现为 **fixture-only**（`chat-panel-provider.ts:7`），仅为遗留/L2 测试保留。
  2. **编辑器区 WebviewPanel**（`editor-chat-panel.ts`）—— 生产 React SPA，通过 `buildEditorChatSpaHtml`（`chat-panel/index.ts:25`）生成，源码在 `webview/`（React 18 + Vite，`webview/package.json:11-12`）。
- **Host 侧**（`src/`）：`ConversationController`（编排 registry/messages/timeline/changes）、`ConversationRegistry`（Tab 集合）、`ExtensionIndex`（持久化会话元数据）、`MessageStore`（每会话气泡投影）、`TimelineStore`（每会话时间线 + subagent 父子边）、`IdeSessionHost`（`session-host.ts`，传输 + 通知解复用）、`ChatPanelHost`（Host↔Webview 协议）、`chat-panel/protocol.ts`（线协议类型）。
- **包管理**：pnpm workspaces（`pnpm install`）；测试用 vitest，位于 `apps/vscode-dsh/tests/`。

## 3. 最相关区域

| 文件 / 目录 | 与本 Phase 的关系 | 来源 |
|---|---|---|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 给 `PanelMode` 增加 `readonly-live`；给 `panel/state` 增加 `PanelBreadcrumb`/`breadcrumb`；给 `WebviewToHostMessage` + 解析器增加 `nav/open-subagent`/`nav/back`/`action/pin-subagent` | 👁 已读 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 增加 `PanelProjection` + `resolvePanelProjection` 依赖；接线 `requestOpenSubagent`/`requestNavBack`/`requestPinSubagent`；在 `pushFullState`/`sendPrompt`/`onWebviewMessage` 中尊重投影 | 👁 已读 |
| `apps/vscode-dsh/src/chat-panel/index.ts` | 重新导出新协议类型（`PanelBreadcrumb`、`PanelProjection`） | 👁 已读 |
| `apps/vscode-dsh/src/conversation-controller.ts` | 新增 `openSubagentContext`/`navBack`/`pinSubagent`/`resolvePanelProjection`/`markSubagentCardDeleted`/`ensureChildHydrated`/`clearContextsReferencing`/`applyTestSubagentNotification`；在 `onSdkNotification` 处理 `subagent.*` | 👁 已读 |
| `apps/vscode-dsh/src/conversation-registry.ts` | 给 `ConversationTab` 增加 `contextSessionId`/`pinnedSubagent` + `setContextSessionId`/`setPinnedSubagent` | 👁 已读 |
| `apps/vscode-dsh/src/extension-index.ts` | 给 `OpenTabRecord` 增加 `pinnedSubagent`；恢复时消费 | 👁 已读 |
| `apps/vscode-dsh/src/message-store.ts` | `kind:'subagent'` 已声明；增加 `SubagentCardStatus`/`childSessionId`/`subagentStatus` + `patchWhere` | 👁 已读 |
| `apps/vscode-dsh/src/timeline-store.ts` | 暴露 `getParent`/`childrenOf`（当前为私有 `parents`/`children` map） | 👁 已读 |
| `apps/vscode-dsh/src/session-host.ts` | `subagent.*` 通知已解复用给监听器（`session-host.ts:731-758`） | 👁 已读 |
| `apps/vscode-dsh/src/extension.ts` | 接线新 `ChatPanelHostDeps` + `dsh.test.*` 命令（`createPanelHost` 在 `extension.ts:1397`） | 👁 已读 |
| `apps/vscode-dsh/webview/src/bridge/message-bridge.ts` | 给 `ChromeIntent` 增加 `nav/open-subagent`/`nav/back`/`action/pin-subagent` | 👁 已读 |
| `apps/vscode-dsh/webview/src/store/chat-ui-store.ts` | 给 `ChatUiState` 增加 `contextSessionId`/`breadcrumb` + `panel/state` 映射；给 `PanelMode`/`ComposerState` 增加 `readonly-live` | 👁 已读 |
| `apps/vscode-dsh/webview/src/components/{TabChrome,MessageList,Composer}.tsx` | 渲染 breadcrumb/back/pin chrome + subagent 卡片气泡 | 👁 已读 |

## 4. 关键入口 / 调用路径

### 4.1 现有数据链路 — subagent 父子边已捕获（✅ CONFIRMED）

```
SDK 子进程 ──HarnessNotification──▶ IdeSessionHost.watchTransport   (session-host.ts:731-758)
   └─▶ ConversationController.onSdkNotification                      (conversation-controller.ts:2151)
        └─▶ TimelineStore.apply(notification)                        (timeline-store.ts:66)
             ├─ method === 'subagent.started'  → linkChild(parent, child) + push 'subagent' 行 (timeline-store.ts:81-94)
             └─ method === 'subagent.finished' → linkChild(parent, child) + push 'subagent' 行 (timeline-store.ts:96-110)
```

`linkChild`（私有，`timeline-store.ts:344`）维护私有 `children: Map<string, Set<string>>` 与 `parents: Map<string, string>`（`timeline-store.ts:56-57`）。父→子边**已在内存中计算**，但**未**通过公开 `getParent`/`childrenOf` API 暴露，也**未**投影到任何消息气泡、Tab 或面板状态。

### 4.2 当前面板投影 — 无 subagent 感知（✅ CONFIRMED）

```
Webview intent ──▶ ChatPanelHost.onWebviewMessage (chat-panel-host.ts:644)
   └─▶ parseWebviewToHostMessage (protocol.ts:274) → 类型化帧
        └─▶ deps.request* → ConversationController
             └─▶ pushFullState (chat-panel-host.ts:348)
                  ├─ panel/state.mode ← active.mode ('live' | 'replay')  (chat-panel-host.ts:384-388)
                  ├─ messages/replace ← MessageStore.get(active.sessionId) (chat-panel-host.ts:405-409)
                  └─ panel/tabs ← registry.snapshot() (chat-panel-host.ts:421-437；未发 parentHint)
```

`panel/state.mode` 完全由 `active.mode` 推导（`chat-panel-host.ts:384-388`）；不存在「context 子会话」或 `readonly-live` 投影。`pushTabsFrame` **未**发出 `protocol.ts:198` 已声明的 `parentHint` 字段。

### 4.3 目标调用链 — 进入子会话 → 投影 → 钉 → 返回（待实现）

```
Webview 点击 subagent 卡片
  └─▶ emitIntent({ type:'nav/open-subagent', childSessionId })   (message-bridge.ts ChromeIntent 新增)
       └─▶ parseWebviewToHostMessage → { type:'nav/open-subagent', childSessionId }  (protocol.ts:274 新增)
            └─▶ ChatPanelHost.onWebviewMessage  (chat-panel-host.ts:644 新增分支)
                 └─▶ deps.requestOpenSubagent(childSessionId)     (chat-panel-host.ts:36 新增依赖)
                      └─▶ ConversationController.openSubagentContext(childSessionId)  (新增；移植 patch:797-867)
                           ├─▶ ensureChildHydrated(childId) — 经 host readSessionLog  (新增；移植 patch:1213)
                           ├─▶ registry.setContextSessionId(activeTabId, childId)     (新增；移植 patch:1266)
                           ├─▶ messages.append(kind:'subagent', childSessionId, …)    (新增；message-store patch:1418)
                           └─▶ resolvePanelProjection() → mode = childRunState==='running' ? 'readonly-live' : 'replay'
                                └─▶ pushFullState → panel/state { mode, breadcrumb }  (新增字段)
Webview 钉    → action/pin-subagent → requestPinSubagent → controller.pinSubagent → registry.setPinnedSubagent (新增)
Webview 返回  → nav/back → requestNavBack → controller.navBack → registry.setContextSessionId(undefined) → pushFullState (新增)
```

## 5. 可能影响面

| 文件 | 变更 | 风险 |
|---|---|---|
| `chat-panel/protocol.ts` | 给 `PanelMode` 增加 `readonly-live`（第 12 行）；给 `RejectSendReason` 增加 `readonly-live`（第 15 行）；新增 `PanelBreadcrumb` 类型 + `panel/state` 上的 `breadcrumb?`（第 44 行）；新增 3 个 Webview→Host 帧 + 解析器分支（第 219 / 274 行） | 🔴 核心协议 — 必须保持 `parseWebviewToHostMessage` fail-closed |
| `chat-panel/chat-panel-host.ts` | 新增 `PanelProjection` + `resolvePanelProjection` 依赖；新增 `requestOpenSubagent`/`requestNavBack`/`requestPinSubagent` 依赖；在 `pushFullState`（第 384 行）从投影推导 `mode`；`readonly-live` 拒绝发送（第 603 行）；3 个新 `onWebviewMessage` 分支（第 644 行） | 🔴 发送门必须保持 Host 侧所有 |
| `chat-panel/index.ts` | 重新导出 `PanelBreadcrumb`/`PanelProjection`（第 34-43 行） | 🟢 |
| `conversation-controller.ts` | 新增方法（移植 patch:505-1237）+ `childRunState` map（patch:535）+ `onSdkNotification` 处理 `subagent.*`（第 2151 行） | 🔴 核心编排；`deleteConversation`/`deleteSession`（第 1448/1484 行）必须调用 `markSubagentCardDeleted` |
| `conversation-registry.ts` | 给 `ConversationTab` 增加 `contextSessionId`/`pinnedSubagent`（第 17 行）；`setContextSessionId`/`setPinnedSubagent`（patch:1266/1280） | 🟡 |
| `extension-index.ts` | 给 `OpenTabRecord` 增加 `pinnedSubagent`（第 13 行）；恢复时消费（patch:1301） | 🟡 |
| `message-store.ts` | 新增 `SubagentCardStatus`/`childSessionId`/`subagentStatus`（patch:1408-1420）；`patchWhere`（patch:1435） | 🟡 |
| `timeline-store.ts` | 在私有 map 之上新增公开 `getParent`/`childrenOf`（patch:1469/1478） | 🟢 |
| `extension.ts` | 接线依赖 + `dsh.test.openSubagent`/`navBack`/`pinSubagent`/`injectSubagent` 命令（patch:1313-1399；当前 `createPanelHost` 在第 1397 行） | 🟡 |
| `webview/src/bridge/message-bridge.ts` | 3 个新 `ChromeIntent` 变体（第 8 行） | 🟡 |
| `webview/src/store/chat-ui-store.ts` | `PanelMode`/`ComposerState` 增加 `readonly-live`（第 5/7 行）；`ChatUiState` 增加 `contextSessionId`/`breadcrumb` + `panel/state` 映射（第 97/382 行） | 🔴 composer 门 |
| `webview/src/components/*.tsx` | breadcrumb/back/pin chrome（TabChrome）、subagent 卡片气泡（MessageList）、`readonly-live` composer 文案（Composer） | 🟡 |

## 6. 既有约束 / 约定

- **Host 拥有决策状态；Webview 只镜像** —— `panel/state` 是 mode/sessionId/send-gate/Continue 的唯一权威；Webview「不得自行发明这些」（`protocol.ts:2-5`、`chat-ui-store.ts:2`）。subagent 投影（mode + breadcrumb + 发送门）**必须**由 Host 推送，而非在 SPA 中自行推导。
- **发送门在 Host 侧** —— `ChatPanelHost.sendPrompt`（`chat-panel-host.ts:603-634`）以 `RejectSendReason` 拒绝；`readonly-live` 必须同时加到 `RejectSendReason` 与 Webview 侧的 `ComposerState`/`deriveComposerState` 处理（`chat-ui-store.ts:171-177`），否则 `readonly-live` 会落到 `waiting`。
- **注册即副作用 / 纯存储** —— `MessageStore`/`TimelineStore`/`ConversationRegistry` 均为纯存储、无 VS Code 依赖（`message-store.ts:61`、`timeline-store.ts:5`、`conversation-registry.ts:4`）。新的 subagent 状态应落在这些 store + controller，而非 `extension.ts`。
- **模型可见 ⟺ 可记录** —— 任何新的模型可见输入（subagent 卡片）必须能从会话日志重建；`subagent.started`/`subagent.finished` 通知已提供 `parentSessionId`/`childSessionId`/`status`（`timeline-store.ts:81-110`），因此投影可由日志重建（ReplayHydrator）。
- **Fail-closed 解析** —— `parseWebviewToHostMessage` 对未知类型返回 `undefined`（`protocol.ts:274-412`）；新增 `nav/*`/`action/pin-subagent` 分支必须遵循同样的守卫模式（校验 `childSessionId` 为非空字符串）。
- **不透明 id 品牌化** —— `sessionId`/`childSessionId` 在本 UI 层以 `string` 流转（非 `Branded<>`）；沿用 `protocol.ts`/store 中现有的 `string` 约定。
- **按判别标签 switch** —— `UiMessage.kind` 已包含 `'subagent'`（`message-store.ts:21`、`chat-ui-store.ts:63`）；`MessageList.tsx:173-201` 已按 `kind` switch（activity/change-list/diff-summary），因此新增 `subagent` 分支即既定模式。
- **测试描述行为** —— phase-2/phase-3 spec 已存在（`apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts`、`phase3-restart-continue.spec.ts`）；丢失的 phase-4 spec（patch:1485-1604 的 phase2… 与 phase3 测试 diff）须按当前结构重新推导。

## 7. 风险 / 未知

- ✅ **CONFIRMED** —— `TimelineStore` 已在私有 `parents`/`children` map 中存储父→子边（`timeline-store.ts:56-57`、`:344-352`）；这是「子会话 id / 父子关系」的权威内存来源。
- ✅ **CONFIRMED** —— `subagent.started`/`subagent.finished` 通知经 `onSdkNotification` → `timeline.apply` 到达 `TimelineStore.apply`（`conversation-controller.ts:2151-2152`），但 controller **未**对 `subagent.*` 分支处理（仅 `session.status` 与 `session.event`，`conversation-controller.ts:2153-2163`）。未投影任何 subagent 卡片。
- ✅ **CONFIRMED** —— `kind:'subagent'` 存在于 `ChatMessage`（`message-store.ts:21`）与 `UiMessage`（`chat-ui-store.ts:63`），但**任何地方都未写入**（grep 只命中类型声明）。
- ✅ **CONFIRMED** —— `ConversationTab` **无** `contextSessionId`/`pinnedSubagent`（`conversation-registry.ts:17-32`）；`OpenTabRecord` **无** `pinnedSubagent`（`extension-index.ts:13-24`）。
- ✅ **CONFIRMED** —— `PanelMode` **无** `readonly-live`（`protocol.ts:12`）；`RejectSendReason` **无** `readonly-live`（`protocol.ts:15-24`）；Webview `PanelMode`/`ComposerState` 同样无（`chat-ui-store.ts:5,7`）。
- ✅ **CONFIRMED** —— `buildThinChatHtml` 仍存在但 **fixture-only**（`chat-panel-provider.ts:7`）；生产面板是 React SPA（`editor-chat-panel.ts` / `chat-panel/index.ts:25`）。patch 中 `buildThinChatHtml` 的 subagent UI（backBtn/pinBtn/subagent 样式/modeBanner）**不是**生产目标。
- ⚠️ **HYPOTHESIS** —— `HarnessNotification` 的 `subagent.finished` 携带 `status` 字段（`timeline-store.ts:101`），但完整参数形状（如 `stopReason`、`provider`、`agentId`）尚未对照 SDK client 类型核实；卡片只需 `status` 来表示 running/ended/deleted，该字段已确认存在。
- ❓ **UNKNOWN** —— 子会话自身的 `session.event` 流（用于 `ensureChildHydrated` 经 `readSessionLog`）是否经 `IdeSessionHost` 暴露 —— patch 调用 `readSessionLog`（`patch:1213`）；当前 host 有 `pendingReadLog`/`session/read-log/response`（`session-host.ts:908-918`），读路径存在，但当前 controller 上的确切公开方法名须在实现时确认。

## 8. 不确定 / 未经核验

| 项 | 状态 |
|---|---|
| `TimelineStore.getParent` / `childrenOf` | ❌ **不存在** —— 私有 `parents`/`children` map 存在（`timeline-store.ts:56-57`），`linkChild`/`depthOf`/`collectTree` 均为私有（`:344`、`:354`、`:369`）；patch 新增公开 `getParent`/`childrenOf`（`patch:1469/1478`）需重新添加。 |
| `ChatMessage.childSessionId` / `subagentStatus` | ❌ **不存在** —— `ChatMessage` 无此字段（`message-store.ts:13-42`）；patch 新增 `SubagentCardStatus` + 字段（`patch:1408-1420`）。 |
| `MessageStore.patchWhere` | ❌ **不存在** —— 仅有 `patch`/`removeWhere`/`patchChangeStatus`（`message-store.ts:96,125,141`）；patch 新增 `patchWhere`（`patch:1435`）。 |
| `panel/tabs.parentHint` | ⚠️ **已声明但从未填充** —— 协议中有（`protocol.ts:198`）且 SPA 映射有（`chat-ui-store.ts:430-432`），但 `pushTabsFrame` 从未发出（`chat-panel-host.ts:421-437`）。 |
| `registry.setContextSessionId` / `setPinnedSubagent` | ❌ **不存在** —— registry 仅有 `setTitle/setStatus/setMode/setUnread/setApprovalBadge`（`conversation-registry.ts:174-229`）。 |
| `buildThinChatHtml` 的 subagent DOM（backBtn/pinBtn/modeBanner） | ⚠️ **不在生产路径** —— fixture-only（`chat-panel-provider.ts:7`）；移植它只影响遗留测试，不影响 SPA。 |

## 9. 桩检测与注册表交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|---|---|---|---|---|
| DEBT-007（`pushFullState`/`panelSnapshot` 对 replay/context 委托 Continue） | `conversation-controller.ts:panelSnapshot` | 已解决（`tech-debt-registry.md:32`） | `panelSnapshot` 存在（第 1607 行）但**无** `contextSessionId`/`resolvePanelProjection` 逻辑 | 🔴 registry 称已解决、代码缺失 |
| DEBT-008（context 子回放 Continue 绑 `contextSessionId`） | `conversation-controller.ts` | 已解决（`tech-debt-registry.md:33`） | `continueChromeForTab`（第 737 行）无 `contextSessionId` 分支 | 🔴 不一致 |
| DEBT-009（`deleteConversation`/`deleteSession` → `markSubagentCardDeleted`） | `conversation-controller.ts:1448/1484` | 已解决（`tech-debt-registry.md:34`） | `markSubagentCardDeleted` 不存在 | 🔴 不一致 |
| DEBT-010（`restoreOpenTabSet`/`restoreMoreTabs` 消费 `pinnedSubagent`） | `conversation-controller.ts:447/616` | 已解决（`tech-debt-registry.md:35`） | `OpenTabRecord.pinnedSubagent` 不存在（`extension-index.ts:13-24`） | 🔴 不一致 |
| DEBT-011（breadcrumb `parentDeleted`） | `conversation-controller.ts` | 已解决（`tech-debt-registry.md:36`） | `buildBreadcrumb` 不存在 | 🔴 不一致 |
| DEBT-012（L2 冷读；phase-2） | phase-2 spec | 已解决（`tech-debt-registry.md:37`） | n/a（phase-2 测试基建） | ⚠️ 超范围 |
| DEBT-013（`restoreMoreTabs` 批处理 persist；phase-3） | phase-3 spec | 已解决（`tech-debt-registry.md:38`） | `restoreMoreTabs` 存在（第 616 行） | ⚠️ 实现时核验 |

### Stub Detection Summary

- ✅ **与 registry 匹配的已确认桩**：0（活跃债务表为空 —— `tech-debt-registry.md:24-26`）。
- ⚠️ **Registry 不一致**：5 条 —— DEBT-007…DEBT-011 在 registry 中标记「已解决」，但对应代码缺失（切换分支丢失）。registry 相对代码**已过期**；phase-4 重新实现会重新满足这些条目，但编码时**不得**把它们当作已完成的依据。
- 🔴 **未注册桩**：产品代码中 0 个硬桩。注意 `kind:'subagent'` 联合成员（`message-store.ts:21`）是「已声明但从未产出」的类型成员（是「gap」而非桩函数），`parentHint`（`protocol.ts:198`）是「已声明但从未发出」的协议字段 —— 两者均为休眠缝，非桩。

## 10. 建议下一步阅读

1. ⭐ **必读** —— `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/spec.md`（AC-35…84 验收标准）。
2. ⭐ **必读** —— `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/recovery/phase-4-subagent-enter-pin.patch`（作为移植参考的丢失实现，尤其是 `conversation-controller.ts` 段 patch:486-1237 与 `protocol.ts` 段 patch:403-486）。
3. 🔷 **应读** —— `apps/vscode-dsh/src/conversation-controller.ts`（全文 2301 行；重点 `onSdkNotification` 第 2151 行、`panelSnapshot` 第 1607 行、`deleteSession` 第 1484 行、`forkFromClosedTurn` 第 794 行）。
4. 🔷 **应读** —— `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` + `chat-panel/protocol.ts`（协议扩展点）。
5. 🔷 **应读** —— `apps/vscode-dsh/src/timeline-store.ts` + `message-store.ts`（边与卡片落点）。
6. 🔹 **可选** —— `apps/vscode-dsh/webview/src/store/chat-ui-store.ts`、`components/{TabChrome,MessageList,Composer}.tsx`（SPA 渲染目标）。
7. 🔹 **可选** —— `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts`、`phase3-restart-continue.spec.ts`（重新推导丢失 phase-4 spec 的测试约定）。

## 11. UI / 设计系统盘点

### 11.1 组件库与来源

| 项 | 值 | 证据 |
|----|----|------|
| UI 框架 | React 18（`react`/`react-dom` `^18.2.0`） | `webview/package.json:11-12` |
| 组件库 | 无，手写组件 + 内联 `style` + 少量 CSS 类 | `webview/src/components/*.tsx` |
| 组件目录 | `apps/vscode-dsh/webview/src/components/`（`App.tsx`、`TabChrome`、`MessageList`、`Composer`、`HistoryPanel`、`DeleteConfirmModal`） | Glob 12 文件 |
| 已存在可复用组件 | `TabChrome`（Tab 栏 + fork 父 banner + 搜索面板 + 溢出菜单）、`MessageList`（气泡 + activity/change-list/diff-summary 变体）、`Composer`（发送/停止/Continue）、`HistoryPanel`、`DeleteConfirmModal` | `TabChrome.tsx`、`MessageList.tsx:173-201`、`Composer.tsx` |

### 11.2 样式方案与主题配置

| 项 | 值 | 证据 |
|----|----|------|
| 样式方案 | 原生 CSS + CSS 变量（无 Tailwind / CSS Modules / styled-components） | `webview/src/styles/tokens.css` |
| 配置文件路径 | `webview/src/styles/tokens.css`（唯一样式文件） | Glob |
| 主题扩展位置 | 无扩展；直接复用 VS Code 原生 `--vscode-*` | `tokens.css:6-39` |
| CSS 变量定义文件 | `tokens.css` | `tokens.css:6-39` |
| 暗色模式机制 | 由 VS Code 主题驱动（`--vscode-*` 原生解析），无显式 class/media 切换 | `tokens.css:2-3` |

### 11.3 现有 token / 变量清单（实测值）

| Token / 变量 | 当前值 | 定义位置 |
|------|------|------|
| `--dsh-fg` / `--dsh-bg` | `var(--vscode-foreground)` / `var(--vscode-editor-background)` | `tokens.css:7-8` |
| `--dsh-border` | `var(--vscode-panel-border, var(--vscode-widget-border))` | `tokens.css:10` |
| `--dsh-muted` | `var(--vscode-descriptionForeground, var(--vscode-foreground))` | `tokens.css:11` |
| `--dsh-tab-active-bg` / `-fg` | `var(--vscode-tab-activeBackground, …)` / `var(--vscode-tab-activeForeground, …)` | `tokens.css:12-15` |
| `--dsh-btn-bg` / `--dsh-btn-fg` | `var(--vscode-button-background)` / `var(--vscode-button-foreground)` | `tokens.css:16-17` |
| `--dsh-bubble-user` / `-assistant` | `var(--vscode-editor-inactiveSelectionBackground)` / `var(--vscode-editor-selectionHighlightBackground, …)` | `tokens.css:27-28` |
| `--dsh-focus` | `var(--vscode-focusBorder, var(--vscode-button-background))` | `tokens.css:29` |
| `--dsh-chrome-height` | `36px` | `tokens.css:30` |
| `--dsh-radius-sm` / `-md` | `4px` / `6px` | `tokens.css:32-33` |
| `--dsh-space-1…4` | `4px / 8px / 12px / 16px` | `tokens.css:34-37` |
| 断点定义 | 无断点体系（无 Tailwind `screens`、无 `@media` 布局断点；仅 `prefers-reduced-motion` 一处 `@media`） | `tokens.css:247-254` |

### 11.4 可复用组件变体清单

| 组件 | 路径 | 已有变体 / props | 能否满足本 Phase |
|------|------|------|:--:|
| `TabChrome` | `webview/src/components/TabChrome.tsx` | `tabs`、`activeTabId`、`forkParentTitle` banner、搜索面板、溢出菜单 | ⚠️ 需新增 breadcrumb/back/pin chrome（现有 `forkParentTitle` banner 可作 breadcrumb 布局参照） |
| `MessageList` / `MessageBubble` | `webview/src/components/MessageList.tsx` | `kind`：activity / change-list / diff-summary / text；`readonly` 控制操作按钮 | ⚠️ `kind:'subagent'` 无渲染分支（`MessageList.tsx:173-201`），需新增可点击子会话卡片 |
| `Composer` | `webview/src/components/Composer.tsx` | `state` ∈ `live/readonly/waiting/error`；`continueChrome` | ⚠️ 无 `readonly-live` 文案（`Composer.tsx:32` `disabled = state !== 'live'`） |
| `HistoryPanel` | `webview/src/components/HistoryPanel.tsx` | `open/loading/rows/query` | ✅ 不涉及 |

### 11.5 UI 相关的既有约束与反模式

- 视觉基准文件：`design-system/<slug>/MASTER.md` **未生成**（本工作流是 VS Code 扩展，无 HG-1.5 视觉基准产出记录；`ui-spec.md`/`visual-baseline.md` 若存在应在 `.specdev/specs/vscode-dsh-conversation-ui/` 下，本探索未发现冻结 token）。
- 硬编码色值：**无**（业务组件全部引用 `--dsh-*`/`--vscode-*` 变量；唯一字面色值在 `tokens.css` 的 fallback `rgba(127,127,127,0.12)`/`rgba(0,0,0,0.2)` 内，属 token 文件本身）。
- 反模式：`App.tsx` 与 `TabChrome.tsx` 大量使用内联 `style` 对象（非 CSS 类），新 UI 若沿用此风格则保持一致；若引入新 CSS 类需在 `tokens.css` 集中定义。
- `readonly` 语义：`MessageList` 的 `readonly` 只影响消息操作按钮（`MessageList.tsx:99`），**不**驱动 composer 禁用；composer 禁用只由 `state !== 'live'` 决定（`Composer.tsx:32`）。`readonly-live` 需同时落到 `PanelMode`、`ComposerState` 派生（`chat-ui-store.ts:171-177`）与 Host 侧 `sendPrompt` reject（`chat-panel-host.ts:603`）三处。

### 11.6 UI 调研的 UNKNOWN

| 问题 | 确认度 | 影响 |
|------|:--:|------|
| 冻结视觉基准 `visual-baseline.md` / `design-system/` 是否存在 | ❓ | 若不存在，`reviewer-visual` 将缺少 token 对照；需确认本工作流是否 `ui_relevant` |
| 子会话卡片的精确视觉形态（位置、图标、running/ended/deleted 三态样式） | ❓ | 实现时需对齐 spec.md 的 UI 骨架（若有）或与调度者确认 |
| breadcrumb 的具体布局（置于 TabChrome 顶部还是消息区上方） | ❓ | 现有 `forkParentTitle` banner（`TabChrome.tsx:319-327`）是最近似参照 |
