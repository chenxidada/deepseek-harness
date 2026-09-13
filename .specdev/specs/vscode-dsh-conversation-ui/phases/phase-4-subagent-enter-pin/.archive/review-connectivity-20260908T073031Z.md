# Connectivity Review — phase-4-subagent-enter-pin

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

## 端到端路径追踪

### Path 1: 卡片 → nav/open-subagent → context（AC-35/37）
```
SDK subagent.started { parentSessionId, childSessionId }
  → ConversationController.onSdkNotification
    → timeline.apply + onSubagentStarted
      → MessageStore.append(kind:'subagent', childSessionId)  ✅
      → panelHost.pushAppend / pushBanner / pushFullState     ✅
Webview: click card (subagentStatus !== 'deleted')
  → postMessage { type: 'nav/open-subagent', childSessionId }
    → parseWebviewToHostMessage ✅
    → ChatPanelHost.onWebviewMessage
      → deps.requestOpenSubagent → openSubagentContext        ✅
        → registry.setContextSessionId(parentTab, child)     ✅ (no new Tab)
        → mode readonly-live | replay from childRunState     ✅
      → pushFullState
        → resolvePanelProjection → panel/state + messages/replace(child) ✅
Exit: panel/state.sessionId=child, contextSessionId=child; Tab count unchanged
```
**判定**: ✅ 数据路径完整（默认进入不占 Tab）

### Path 2: 钉 Tab（AC-38/78/79）
```
Webview pinBtn → action/pin-subagent
  → ChatPanelHost → pinSubagent
    → clear contextSessionId                                 ✅
    → registry.create(child) + setPinnedSubagent             ✅
    → switchTo(parent) 恢复父视图                            ✅ AC-79
    → persistOpenTabs(pinnedSubagent)                        ✅ write
再从父 openSubagentContext:
  → getBySessionId(child) → switchTo(child Tab)              ✅ AC-78
  → 不设 contextSessionId                                    ✅
```
**判定**: ✅ 运行期钉/激活路径连通；见下方 Should-Fix（restore 未回读 flag）

### Path 3: nav/back（AC-36）
```
Webview backBtn → nav/back
  → navBack()
    → 有 contextSessionId → clear → pushFullState 父流       ✅
    → 钉子 Tab → getParent / index.parentSessionId
      → parent deleted → outcome disabled                    ✅ AC-75
      → parent Tab exists → switchTo(parent)                 ✅
```
**判定**: ✅ 主路径连通；父 Tab 已关但未删时 breadcrumb 仍可点但 Host 返回 disabled（见 Should-Fix）

### Path 4: 已删导航（AC-74/75）
```
AC-74 进入门禁:
  openSubagentContext → index.isDeleted(child)
    → markSubagentCardDeleted + outcome 'deleted'            ✅
    → context 不设置                                         ✅
  Thin HTML: subagentStatus==='deleted' 不绑 click           ✅（依赖卡片已标记）

AC-75 父已删:
  delete parent → markDeleted；子 Tab 保留（偏差 1 / AC-61） ✅
  resolvePanelProjection → breadcrumb.parentDeleted=true     ✅
  thin HTML backBtn.disabled                                 ✅
  nav/back → disabled                                        ✅
```
**判定**: ✅ 「不可进入 / 禁用返回」门禁连通；删子后父卡片文案需靠再次 open 才补丁（见 Should-Fix）

### Path 5: readonly-live → replay（AC-40/71）
```
Enter while childRunState=running → mode readonly-live       ✅
  → sendPrompt / composer gate reject 'readonly-live'        ✅
Child session.event(assistant) while context=child
  → projectAssistantMessage → messages.append + pushAppend   ✅ 实时投影
subagent.finished while context=child
  → childRunState=ended → ensureChildHydrated → pushFullState ✅
  → resolvePanelProjection mode=replay                       ✅
```
**判定**: ✅ 只读实时 → 自动回放连通

### Path 6: L2 / L3（AC-54/84 / VP-4-sub）
```
protocol parse ↔ FakeWebviewPort ↔ ChatPanelHost deps
  requestOpenSubagent / requestNavBack / requestPinSubagent
  resolvePanelProjection                                     ✅ extension createPanelHost 已接线
dsh.test.openSubagent|navBack|pinSubagent|injectSubagent     ✅ package.json + extension.ts
phase4-subagent-enter-pin.spec.ts (12) + run-phase4-l2-l3.sh ✅
```
**判定**: ✅ 模拟 Webview 协议路径与测试钩子连通

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `onSubagentStarted` | `onSdkNotification` / `injectSubagent` | ✅ | MessageStore + panelHost + index.upsert | ✅ |
| `openSubagentContext` | Host `nav/open-subagent` / `dsh.test.openSubagent` | ✅ | registry context / switchTo / hydrate | ✅ |
| `navBack` | Host `nav/back` / `dsh.test.navBack` | ✅ | setContext / switchTo / pushFullState | ✅ |
| `pinSubagent` | Host `action/pin-subagent` / test hook | ✅ | create Tab + persist + restore parent | ✅ |
| `resolvePanelProjection` | ChatPanelHost.pushFullState / panelSnapshot | ✅ | mode/session/breadcrumb/messages | ✅ |
| `markSubagentCardDeleted` | open/pin when deleted | ✅ | MessageStore.patchWhere | ✅ |
| `deleteConversation` → parent card | — | 🟡 | 未调用 `markSubagentCardDeleted` | 🟡 |
| `persistOpenTabs.pinnedSubagent` | pinSubagent | ✅ | restoreOpenTabSet 回读 | 🟡 未 `setPinnedSubagent` |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host | `nav/open-subagent` + `childSessionId` | protocol parse + Host route | ✅ |
| Host → Controller | open/back/pin deps | extension `createPanelHost` 已注入 | ✅ |
| Controller → panel/state | `contextSessionId` / `readonly-live` / breadcrumb | protocol + pushFullState | ✅ |
| send gate | readonly-live 拒发 | reject reason + thin HTML composer off | ✅ |
| breadcrumb vs navBack | `parentDeleted` 时禁用 | 一致；父 Tab 缺失时 UI 仍可能 enabled | 🟡 |
| OpenTabRecord.pinnedSubagent | 持久化后再 restore 可用 | 只写不读回 registry | 🟡 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| FakeWebview + ChatPanelHost / MessageStore | phase-1/2 | 扩展字段（additive） | ✅ |
| openFromHistory / hydrate / Continue chrome | phase-2/3 | 未改签名；context 子会话 Continue 隐藏 | ✅（策略见观察） |
| delete 非级联权威（AC-61） | phase-1+ | 保留；故意不关子 Tab（偏差 1 / AC-75） | ✅ |
| Timeline parent/child | 既有 | 新增公开 `getParent` / `childrenOf` | ✅ |

无 Frozen interface 破坏；无循环依赖。

## 关键发现

### 🔴 Must-Fix
- （无）主进入 / 钉 / 返回 / 只读→回放 / L3 协议路径均贯通。

### 🟡 Should-Fix
1. **删子 → 父卡片状态未主动接线**：`deleteConversation` / `deleteSession` 对 child 只 `markDeleted` + `clearContextsReferencing`，不调用 `markSubagentCardDeleted`。AC-74 文案「子会话已删除」依赖再次 `openSubagentContext` / pin 才写入 MessageStore；Host 门禁仍拒入，但父流卡片投影有一段时间滞后。
2. **`pinnedSubagent` 写后弱读**：`persistOpenTabs` 写入 `OpenTabRecord.pinnedSubagent`，但 `restoreOpenTabSet` 仅 `registry.create(..., 'replay')`，未 `setPinnedSubagent`；下次 persist 可能冲掉 flag。运行期 AC-78 靠 `getBySessionId` 仍通，元数据跨重启不完整。
3. **breadcrumb 可点 vs `navBack` disabled（父 Tab 已关未删）**：`buildBreadcrumb` 只看 `index.isDeleted`；`navBack` 在 `parentTab === undefined` 时返回 `disabled`。薄 HTML 可能显示可点「返回父会话」但 Host 无操作——软契约不一致。

### 🟢 Observations
- 偏差 1（父删保留子 Tab）与 AC-75 面包屑禁用路径一致，连通性上合理。
- Context-only 子回放下 Continue chrome 隐藏（`mode !== 'live'`）；钉成 Tab 后沿用 phase-3 Continue——与「先上下文后钉」一致。
- Host 在 open/back/pin 后额外 `pushFullState`，与 controller 内推送重复但无断链。
- `packages/core/agent-loop` 未改；SDK `subagent.*` → controller 卡片生产路径已闭合（repo-exploration Path A 缺口已接上）。
