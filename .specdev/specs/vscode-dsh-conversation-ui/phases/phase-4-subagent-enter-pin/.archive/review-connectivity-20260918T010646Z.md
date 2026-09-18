# Connectivity Review — Phase 4 (subagent-enter-pin)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: 进入子会话链（AC-35/37）
```
Webview SubagentCard 点击（MessageList.tsx:546-554）
  → emitIntent({ type:'nav/open-subagent', childSessionId })   ✅ childSessionId 非空守卫（clickable）
    → parseWebviewToHostMessage（protocol.ts:438-442）          ✅ fail-closed，空串返回 undefined
      → ChatPanelHost.onWebviewMessage（chat-panel-host.ts:821-824） ✅ 分支存在
        → deps.requestOpenSubagent(childSessionId)              ✅ ChatPanelHostDeps 声明（:183）
          → controller.openSubagentContext（conversation-controller.ts:1758） ✅
            ├─ isDeleted → markSubagentCardDeleted + pushFullState → 'deleted'（AC-74）
            ├─ getBySessionId → switchTo 已有 Tab → 'activated-tab'（AC-78）
            └─ childRunState==='running' ? 不 hydrate : ensureChildHydrated  ✅
            registry.setContextSessionId(active.tabId, childId)  ✅ registry 方法存在（conversation-registry.ts:234）
            pushFullState() → resolvePanelProjection()（:1885）
              └─ panel/state { mode:'readonly-live'|'replay', sessionId:childId,
                   contextSessionId:childId, breadcrumb:buildBreadcrumb(parent) } ✅
                └─ messages/replace { sessionId:childId, messages:get(childId) } ✅
Exit: Webview applyHostFrame 消费 panel/state.contextSessionId + breadcrumb（chat-ui-store.ts:451-454）
      TabChrome 渲染面包屑 + 返回 + 钉住按钮（TabChrome.tsx:332-379）
```
**判定**: ✅ 数据路径完整，起点到终点连通；默认进入不 mint Tab（`setContextSessionId` 仅写字段，`registry.list().length` 不变，测试覆盖）。

### Path 2: 实时投影链（AC-39/71）
```
SDK subprocess ──subagent.started/finished──▶ IdeSessionHost.watchTransport（session-host.ts:731-746）
  → 透传全部 HarnessNotification 给 onNotification 监听器（无 method 过滤） ✅
    → controller.onSdkNotification（conversation-controller.ts:2605）✅ 构造器注册（:287-289）
      ├─ subagent.started → onSubagentStarted（:2617-2622 → :1982）
      │   childRunState.set('running') + upsertSession + 父卡片 append/subagentStatus:'running'
      │   + pushAppend（仅当父为当前上下文）+ pushBanner + pushFullState ✅
      └─ subagent.finished → onSubagentFinished（:2624-2629 → :2021）
          patchWhere 卡片→'ended' + 视图中则 ensureChildHydrated + 翻转 replay ✅
运行中子 session.event（assistant/chunk、assistant/message…）:
  → onSdkNotification → projectAssistantChunk/Message（:2650/:2678）
    → messages.append(childId, …) 无条件落库  ✅ 未投影也累积，进入即可见
    → isProjectedSession(active, childId)（:2060）✅ 修复 V-IND-5：contextSessionId===childId 时推送
      → panelHost.pushAppend/pushPatch → projectedSessionId()（chat-panel-host.ts:974）
         = resolvePanelProjection().sessionId = childId  ✅ 与 message.sessionId 匹配
```
**判定**: ✅ 实时投影连通；运行中进入为只读实时，结束自动转 replay（`resolvePanelProjection` 依 `childRunState` 派生）。

### Path 3: 钉 / 返回 / 删除链（AC-38/78/79/74/75）
```
钉: TabChrome 钉住按钮 → action/pin-subagent → parse（:438）→ onWebviewMessage（:829）
  → requestPinSubagent → controller.pinSubagent（:1831）
    → registry.create(child) + setPinnedSubagent(true) + persistOpenTabs()（写 OpenTabRecord.pinnedSubagent）
    → 恢复父 active + pushFullState  ✅（AC-79）
返回: nav/back → onWebviewMessage（:825）→ requestNavBack → navBack（:1803）
  → contextSessionId!==undefined ? 清 context : 依 parent 边 switchTo 父 Tab ✅
删除: teardownDeletedSession（:1592）→ markSubagentCardDeleted（父卡→deleted）✅
  → clearContextsReferencing 清指向该 session 的 context；不级联删子 Tab（AC-61/75）✅
```
**判定**: ✅ 钉/返回/删除三条链连通，持久化字段 `pinnedSubagent` 在 restoreOpenTabSetBody（:597-599）与 restoreMoreTabs（:681-683）均消费。

### Path 4: 依赖接线完整性（extension.ts）
```
createPanelHost（extension.ts:1436）
  ├─ resolvePanelProjection: () => conversations?.resolvePanelProjection()  ✅（:1576）
  ├─ requestOpenSubagent: … → controller.openSubagentContext + pushFullState ✅（:1577-1585）
  ├─ requestNavBack: … → controller.navBack + pushFullState                ✅（:1586-1591）
  └─ requestPinSubagent: … → controller.pinSubagent + tabBarRefresh         ✅（:1592-1601）
bindConversations → controller.setPanelHost(panelHost)                     ✅（:1761）
chat-panel/index.ts 重新导出 PanelProjection + PanelBreadcrumb              ✅（index.ts:10/:40）
dsh.test.{openSubagent,navBack,pinSubagent,injectSubagent} 注册             ✅（:1240-1278）
```
**判定**: ✅ 新增 4 个依赖全部接上；`bindConversations` 保证 Host 投影由 controller 提供。

## 上下游连接检查

| 新函数/字段 | 上游（谁调用/写入） | 连接状态 | 下游（谁消费） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `openSubagentContext()` | ChatPanelHost.requestOpenSubagent / dsh.test | ✅ | `setContextSessionId` + `resolvePanelProjection` + `pushFullState` | ✅ |
| `resolvePanelProjection()` | ChatPanelHost（pushFullState/pushStatus/sendPrompt/pushAppend） | ✅ | `panel/state` / `messages/replace` 帧 | ✅ |
| `pinSubagent()` | requestPinSubagent / dsh.test | ✅ | `registry.create` + `setPinnedSubagent` + `persistOpenTabs` | ✅ |
| `navBack()` | requestNavBack / dsh.test | ✅ | `setContextSessionId` / `switchTo` | ✅ |
| `onSubagentStarted/Finished` | `onSdkNotification` + `applyTestSubagentNotification` | ✅ | `childRunState` + MessageStore 卡片 + `pushFullState` | ✅ |
| `isProjectedSession()` | projectAssistantChunk/Message/tool 等 | ✅ | `pushAppend/pushPatch` vs `setUnread` 分流 | ✅ |
| `markSubagentCardDeleted()` | `teardownDeletedSession` / openSubagentContext / pinSubagent | ✅ | MessageStore.patchWhere | ✅ |
| `ConversationTab.contextSessionId/pinnedSubagent` | setContextSessionId/setPinnedSubagent | ✅ | resolvePanelProjection / persistOpenTabs / restore | ✅ |
| `OpenTabRecord.pinnedSubagent` | persistOpenTabs | ✅ | restoreOpenTabSetBody + restoreMoreTabs | ✅ |
| `MessageStore.patchWhere()` | onSubagentStarted/Finished + markSubagentCardDeleted | ✅ | —（落库） | ✅ |
| `TimelineStore.getParent()` | navBack / resolvePanelProjection / teardownDeletedSession / buildBreadcrumb | ✅ | — | ✅ |
| `TimelineStore.childrenOf()` | **无** | ⚠️ 无消费者 | — | ⚠️ 休眠 API |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host `nav/open-subagent` | `{ childSessionId: string }` | parser 校验非空 string | ✅ |
| ChatPanelHost → Controller `requestOpenSubagent` | `(childSessionId: string) => Promise<unknown>` | `openSubagentContext(childSessionId): Promise<OpenSubagentResult>` | ✅ |
| ChatPanelHost → Controller `resolvePanelProjection` | `() => PanelProjection \| undefined` | 同签名 | ✅ |
| panel/state `contextSessionId`/`breadcrumb` | Host 推送 | Webview `applyHostFrame` 映射 `contextSessionId`/`BreadcrumbState` | ✅ |
| `PanelMode 'readonly-live'` | Host 推 mode | Webview `deriveComposerState` → `readonly` + App/Composer 文案 | ✅ |
| `RejectSendReason 'readonly-live'` | Host `sendPrompt` reject | Webview `ui/reject-send` 文案分支（chat-ui-store.ts:590） | ✅ |
| `MessageStore.patchWhere` 返回 | `number`（patched 行数） | `markSubagentCardDeleted` 用 `patched === 0` 判 append 兜底 | ✅ |
| `breadcrumb.parentDeleted` 语义 | Webview 用 `parentDeleted===true` 禁用返回 | Host `buildBreadcrumb` 将「父已删」或「父未打开」都置 `true`，`navBack` 同步返回 `disabled` | ✅ 一致（字段名偏语义，见 Observation） |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `host.readSessionLog(sessionId)`（ensureChildHydrated/loadEvents） | phase-2/3 | 已实现，未变更 | ✅ |
| `TimelineStore` 父子边（subagent.started/finished 已落边） | phase-0/2 | 边已在 `apply` 中填充，本 Phase 仅 `getParent` 读取 | ✅ |
| `MessageStore.append/patch/patchChangeStatus` | phase-1/2 | 未变更，`patchWhere` 为新增 | ✅ |
| `ConversationRegistry.create/switchTo/getBySessionId/setMode` | phase-1/2 | 未变更，`setContextSessionId`/`setPinnedSubagent` 为新增 | ✅ |
| `OpenTabRecord` 持久化 | phase-3 | 新增 `pinnedSubagent` 字段，sanitizeLoaded 未破坏旧数据 | ✅ |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
- **`TimelineStore.childrenOf()` 是无消费者的休眠公共 API**（timeline-store.ts:232）。`getParent` 有 4 处消费方（navBack / resolvePanelProjection / teardownDeletedSession / buildBreadcrumb），但 `childrenOf` 在 `apps/vscode-dsh` 全树**零调用**。这是「暴露但从未读取」的休眠缝（`parentHint` 教训的镜像方向）：不影响任何端到端路径，但属死 API 面，后续维护者会误以为某条链依赖它。建议二选一：删除该方法，或在未来 Phase 中接线消费方（当前无 `@STUB` 标记、无 registry 登记）。**不阻塞本 Phase 连通性判决**。

### 🟢 Observations
- `PanelBreadcrumb.parentSessionId` 由 Host 写入并推送，Webview 映射进 `BreadcrumbState.parentSessionId`，但 TabChrome 渲染只消费 `label` / `parentDeleted`，未渲染 `parentSessionId`。属「写入→映射→未渲染」的休眠元数据；Host 逻辑与测试仍在用该字段，属可选保留。
- `resolvePanelProjection()` 在子上下文时把 `sessionId` 与 `contextSessionId` 都设为 childId（conversation-controller.ts:1895/1897），存在语义冗余；`panel/state.sessionId` 语义为「投影会话」，`contextSessionId` 语义为「子上下文」，二者同值不影响任何消费方，但增加了读码歧义。
- `buildBreadcrumb` 把「父已删」与「父未打开」统一折叠进 `parentDeleted: true`（实为 `navDisabled`）。Webview 禁用态与 Host `navBack` 返回 `disabled` 一致（连通性正确），label 也正确区分两种文案；但字段名 `parentDeleted` 与「父未打开」场景语义不符，属命名/语义观察项，非连通性缺陷。

## 结论

四条端到端链（进入子会话 / 实时投影 / 钉·返回·删除 / 依赖接线）全部连通，跨模块契约一致，跨 Phase 依赖接口均冻结未变。`childrenOf` 死 API 与 `parentSessionId` 未渲染属非阻塞休眠项，不计入 MUST-FIX。
