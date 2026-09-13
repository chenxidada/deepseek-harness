# Connectivity Review — Phase 2 (Q-6 Tab right-click delete)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: Tab 右键删除（Q-6 / AC-13c）
```
Entry: TabChrome tab-item.onContextMenu
  → preventDefault + setTabContextMenu({ tabId, sessionId, title })
  → tab-context-menu / menu-tab-delete-session
    → openDeleteConfirm({ sessionId, title, source: 'tab-context' })  ✅ store
  → App renders DeleteConfirmModal when ui.deleteConfirm set            ✅
  → btn-delete-confirm
    → bridge.emitIntent({ type: 'ui/delete-request', sessionId })       ✅
  → ChatPanelHost.handleMessage ui/delete-request
    → deps.requestDeleteConfirmed(sessionId)                           ✅
  → extension.runDeleteConfirmed(sessionId)
    → controller.deleteSession(sessionId, { confirmed: true })         ✅
Exit: delete + pushFullState / historyRefresh
```
**判定**: ✅ 数据路径完整；确认 UI 在 webview modal，Host 无二次原生确认。

### Path 2: 非活动 Tab 的 sessionId（panel/tabs 绑定）
```
Entry: Registry snapshot (per-tab sessionId)
  → ChatPanelHost.pushTabsFrame()
    → panel/tabs.tabs[].sessionId                                      ✅ Host 推送
  → chat-ui-store applyHostFrame panel/tabs
    → TabChromeItem.sessionId 解析（非空 string）                       ✅
  → TabChrome: deleteSessionId = tab.sessionId
      ?? (active && activeSessionId ? activeSessionId : undefined)
  → 非活动 Tab：必须用 tab.sessionId；缺失则不打开菜单（fail-closed） ✅
Exit: openDeleteConfirm.sessionId === 该 Tab 绑定 session（非 activeSessionId）
```
**判定**: ✅ Host→store→context menu 契约连通；非活动 Tab 不误用活动会话 ID。

### Path 3: 溢出菜单删除（回归）
```
Entry: btn-overflow → menu-delete-session
  → openDeleteConfirm({ sessionId: activeSessionId, source: 'chrome' }) ✅
  → DeleteConfirmModal → ui/delete-request → requestDeleteConfirmed
  → deleteSession({ confirmed: true })                                 ✅
```
**判定**: ✅ 溢出路径未断；与右键共用同一 modal / intent / Host 后端。

### Path 4: 历史删除（AC-60 同后端）
```
Entry: HistoryPanel btn-history-delete
  → openDeleteConfirm({ sessionId: row.sessionId, source: 'history' }) ✅
  → 同一 DeleteConfirmModal → ui/delete-request → deleteSession({confirmed:true})
```
**判定**: ✅ 三角入口（tab-context / chrome / history）汇入单消费者。

### Path 5: Cancel（无 intent）
```
Entry: btn-delete-cancel → closeDeleteConfirm()
Exit: 无 ui/delete-request                                              ✅
```
**判定**: ✅ 确认门控连通；取消不进入 Host 删除。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `tab-item` contextmenu | 用户右键 | ✅ | `setTabContextMenu` / fail-closed | ✅ |
| `menu-tab-delete-session` | `tab-context-menu` | ✅ | `openDeleteConfirm(source:'tab-context')` | ✅ |
| `openDeleteConfirm` | TabChrome / overflow / History | ✅ | `ui.deleteConfirm` → `DeleteConfirmModal` | ✅ |
| `DeleteConfirmModal` confirm | App 条件渲染 | ✅ | `ui/delete-request` via bridge | ✅ |
| `ChatPanelHost` `ui/delete-request` | protocol parser | ✅ | `requestDeleteConfirmed` | ✅ |
| `runDeleteConfirmed` | extension deps | ✅ | `deleteSession({confirmed:true})` | ✅ |
| `pushTabsFrame` sessionId | Registry | ✅ | store `TabChromeItem.sessionId` | ✅ |
| `menu-delete-session` (overflow) | overflow menu | ✅ | `openDeleteConfirm(source:'chrome')` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host → Webview `panel/tabs` | 每 Tab 有 `sessionId` | `pushTabsFrame` 映射 `tab.sessionId`；protocol 标注 required | ✅ |
| Store ← `panel/tabs` | 保留非空 `sessionId` | 条件展开进 `TabChromeItem` | ✅ |
| TabChrome → `openDeleteConfirm` | `{ sessionId, source:'tab-context' }` | `DeleteConfirmState` 含 `'tab-context'` | ✅ |
| Modal → Host | `ui/delete-request` + non-empty sessionId | parser 校验 string 非空；Host 路由 confirmed | ✅ |
| Host → Controller | `deleteSession(id, {confirmed:true})` | `runDeleteConfirmed` 正是此调用 | ✅ |
| Overflow | `activeSessionId` + `source:'chrome'` | 仍接线；与右键分流 source、汇合后端 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `panel/tabs` + Registry Tab 投影 | Phase 1 | 已实现；本回路扩展 `sessionId` 字段（additive） | ✅ |
| `DeleteConfirmModal` / `ui/delete-request` | Phase 2 先前回路 | 冻结消费路径；右键仅增入口 | ✅ |
| `requestDeleteConfirmed` / `deleteSession({confirmed:true})` | Phase 2 / 既有 controller | 签名未破坏 | ✅ |
| `action/delete` → 原生确认 | 遗留 | React 主路径不 emit；不参与 Q-6 | ✅ 闲置无害 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无 — 端到端与契约均连通）

### 🟢 Observations
1. **非活动 Tab 的 RTL 覆盖偏薄**：`editor-chat-phase2` Q-6 用例为单活动 Tab（`s-ctx`）；多 Tab 下「右键非活动 Tab → emit 该 Tab 的 sessionId」靠代码路径保证（`panel/tabs.sessionId` + fail-closed），未在本回路 RTL 参数化断言。不构成断链。
2. **`ui/delete-request` 后 Host 强制 `historyOpen = true`**：删除后会打开历史帧再 `pushFullState`；三条删除入口行为一致，非断链。
3. **活动 Tab 回退**：若 `tab.sessionId` 缺失且为活动 Tab，回退 `activeSessionId`；非活动缺失则不打开菜单——避免误删活动会话。

## 反狡辩自检

| 借口 | 本审查实际做法 |
|------|----------------|
| 「接口定义了就连通」 | 追踪 call site：contextmenu → menu → store → modal → intent → Host → `deleteSession` |
| 「存了就行」 | 确认 `panel/tabs.sessionId` 被 store 解析且被非活动 Tab 右键消费 |
| 「implementer 写的上下游肯定通」 | 独立核对 overflow / history 仍汇入同一 `ui/delete-request` 消费者 |
