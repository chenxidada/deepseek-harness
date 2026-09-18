# Connectivity Review — Phase 4 (subagent-enter-pin) · 复审

## 视角
**Integration Connectivity** — 模块间是否真正连通（重跑：验证 2 条 SHOULD-FIX 修复后无断链、无新休眠缝）

## 判决
**PASS**

## 复审重点结论

### 1. SHOULD-FIX-2（删除 `TimelineStore.childrenOf()` 休眠 API）已闭合 ✅

- `grep childrenOf` 在 `apps/vscode-dsh` 全树（含 `src/` 与 `tests/`）**零匹配**——公开方法、JSDoc、测试引用均已无残留。
- `getParent` 保留且仍连通：定义于 `timeline-store.ts:223`，3 处消费方均在 `conversation-controller.ts`：
  - `:1594` `teardownDeletedSession` 捕获父边（AC-74 卡片→deleted）
  - `:1814` `navBack` 钉 Tab 返回父（AC-75）
  - `:1905` `resolvePanelProjection` 面包屑（AC-36）
- 私有 `children` map 保留并被内部使用：`linkChild`（`:353`）、`clearSession`（`:233-244`）、`collectTree`（`:378-392`）、`isDescendantOf`（`:214`）。**删除公开方法未破坏内部边维护**，无断链。

### 2. SHOULD-FIX-1（钉运行中子 Tab 投影 `readonly-live`）连通性 ✅

**链 A：钉运行中子 Tab → 投影 readonly-live → sendPrompt reject**

```
pinSubagent(running child)                                    (conversation-controller.ts:1831)
  → registry.create(childId, mode='live') + setPinnedSubagent(true)  (:1857/:1867)
  → switchTo(parent) → 恢复父 active                              (:1869)
重新进入:
openSubagentContext(child) → getBySessionId → switchTo(childTab) → 'activated-tab'  (:1769-1780)
  → resolvePanelProjection()                                     (:1885)
      pinnedRunning = active.pinnedSubagent===true
                      && childRunState.get(active.sessionId)==='running'   (:1913-1914)
      mode = pinnedRunning ? 'readonly-live' : ...               (:1916-1918)
  → pushFullState → panel/state.mode='readonly-live'             (chat-panel-host.ts:434-437)
  → Webview deriveComposerState → readonly                      (chat-ui-store.ts:190)
  → Composer disabled                                           (App.tsx:52 / Composer.tsx:159,167)
sendPrompt('hello')                                              (chat-panel-host.ts:689)
  → resolvePanelProjection().mode==='readonly-live' → reject('readonly-live')  (:701)
  → ui/reject-send reason='readonly-live' → Webview 文案        (chat-ui-store.ts:590)
```
**判定**: ✅ 链完整，口径统一——钉运行中子 Tab 与上下文进入路径同为 `readonly-live`（消除口径分裂）。

**链 B：子结束 → onSubagentFinished → setMode('replay') → 投影翻转 replay**

```
onSubagentFinished(parent, child)                               (conversation-controller.ts:2027)
  → childRunState.set(child, 'ended')                          (:2028)
  → childTab.mode==='live' → registry.setMode(childTab.tabId, 'replay')  (:2048-2052)
resolvePanelProjection()                                         (:1885)
  → pinnedRunning = pinnedSubagent===true && childRunState==='running'
      = true && ('ended'==='running' ? false) → false          (:1913-1914)
  → mode = active.mode==='replay' ? 'replay' : 'live' = 'replay'  (:1916-1918)
  → panel/state.mode='replay' → sendPrompt reject('replay')     (:699)
```
**判定**: ✅ 兜底 `setMode('replay')`（既有逻辑）仍成立——钉 Tab 的 registry `mode` 保持 `'live'` 直到 finish，finish 后由 `setMode('replay')` 收口，投影随之从 `readonly-live` 翻转为 `replay`。无「readonly-live 永远卡死」的缝。

### 3. 四条端到端链整体仍连通 ✅

- **进入子会话链（AC-35/37）**：`SubagentCard` 点击（MessageList.tsx:553）→ `nav/open-subagent` → parser（protocol.ts:438-441 fail-closed）→ `onWebviewMessage`（chat-panel-host.ts:821）→ `requestOpenSubagent` → `openSubagentContext` → `setContextSessionId` + `resolvePanelProjection` + `pushFullState`。默认不 mint Tab。
- **实时投影链（AC-39/71）**：`onSdkNotification`（conversation-controller.ts:2623-2635）分支 `subagent.started/finished` → `onSubagentStarted/Finished`；`isProjectedSession`（:2066-2069）使子 session 流式消息在子上下文时仍推 webview（V-IND-5）。
- **钉/返回/删除链（AC-38/78/79/74/75）**：`pinSubagent`/`navBack`/`markSubagentCardDeleted`/`clearContextsReferencing` 均连通；`pinnedSubagent` 字段在 `persistOpenTabs`（:2157）写入、restore 消费。
- **依赖接线链（extension.ts）**：`createPanelHost` 4 个新依赖全部接上（`:1576/:1577/:1586/:1592`），`bindConversations` → `setPanelHost`（:1761）。

### 4. 无新引入的休眠缝 ✅

- 修复 SHOULD-FIX-2 删除 `childrenOf` 后，未新增任何「声明但未发出/未消费」的公开 API（`getParent` 3 处消费；私有 `children` map 仍在内部使用）。
- 修复 SHOULD-FIX-1 新增的 `pinnedRunning` 判断（:1913-1914）被 `resolvePanelProjection` 消费并落到 `panel/state.mode`，有测试覆盖（spec.ts:186-212），非休眠逻辑。

## 上下游连接检查

| 新函数/字段 | 上游（谁调用/写入） | 连接状态 | 下游（谁消费） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `resolvePanelProjection()`（pinnedRunning 分支） | ChatPanelHost（pushFullState/sendPrompt/pushStatus/pushAppend/projectedSessionId） | ✅ | `panel/state.mode` / `sendPrompt` reject | ✅ |
| `onSubagentFinished()` | `onSdkNotification` + `applyTestSubagentNotification` | ✅ | `childRunState` + `registry.setMode('replay')` + `pushFullState` | ✅ |
| `pinSubagent()` | requestPinSubagent / dsh.test | ✅ | `registry.create` + `setPinnedSubagent` + `persistOpenTabs` + `switchTo(parent)` | ✅ |
| `getParent()` | teardownDeletedSession / navBack / resolvePanelProjection | ✅ | — | ✅ |
| `MessageStore.patchWhere()` | onSubagentStarted/Finished + markSubagentCardDeleted | ✅ | —（落库） | ✅ |
| ~~`childrenOf()`~~ | — | ✅ 已删（零引用） | — | ✅ 无残留 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host `nav/open-subagent` / `action/pin-subagent` | `{ childSessionId: string }` | parser 校验非空 string（protocol.ts:438-441） | ✅ |
| ChatPanelHost → Controller `resolvePanelProjection` | `() => PanelProjection \| undefined` | 同签名（含 pinnedRunning 分支） | ✅ |
| `PanelMode 'readonly-live'` | Host 推 mode | Webview `deriveComposerState` → `readonly`；Composer 文案（:159/:167） | ✅ |
| `RejectSendReason 'readonly-live'` | Host `sendPrompt` reject（:701） | Webview `ui/reject-send` 文案（chat-ui-store.ts:590） | ✅ |
| 钉 Tab registry `mode` vs 投影 `mode` | registry 保持 `'live'`（OpenTabMode） | 投影层映射为 `readonly-live`；finish 后 registry→`replay`，投影→`replay` | ✅ 分层一致 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `host.readSessionLog(sessionId)`（ensureChildHydrated/loadEvents） | phase-2/3 | 已实现，未变更 | ✅ |
| `TimelineStore` 父子边（subagent.started/finished 落边） | phase-0/2 | 边仍在 `apply` 填充；本 Phase 仅 `getParent` 读取 | ✅ |
| `MessageStore.append/patch/patchWhere` | phase-1/2 | 未变更 | ✅ |
| `ConversationRegistry.create/switchTo/setMode/setContextSessionId/setPinnedSubagent` | phase-1/2 | 未变更（后两者为新增） | ✅ |
| `OpenTabRecord.pinnedSubagent` 持久化 | phase-3 | 新增字段，restore 消费 | ✅ |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。（上一轮的 SHOULD-FIX-1 / SHOULD-FIX-2 均已闭合）

### 🟢 Observations
- `buildBreadcrumb` 仍把「父已删」与「父未打开」统一折叠进 `parentDeleted: true`（实为 `navDisabled`），与上一轮一致——连通性正确（`navBack` 同步返回 `disabled`），但字段名语义与「父未打开」场景不符，属命名观察项，非连通性缺陷。
- `PanelBreadcrumb.parentSessionId` 由 Host 写入并推送到 Webview 映射进 `BreadcrumbState`，但 TabChrome 渲染仅消费 `label`/`parentDeleted`，未渲染 `parentSessionId`；属「写入→映射→未渲染」的休眠元数据，Host 逻辑与测试仍用该字段，可选保留。

## 结论

两条 SHOULD-FIX 均已闭合：`childrenOf` 删除零残留、`getParent` 与内部边维护无断链；钉运行中子 Tab 的 `readonly-live` 投影链（进入→投影→sendPrompt reject）与子结束→`setMode('replay')`→投影翻转链均端到端连通。四条端到端链（进入子会话 / 实时投影 / 钉·返回·删除 / 依赖接线）整体仍连通，无新引入的休眠缝或断链。判决 PASS。
