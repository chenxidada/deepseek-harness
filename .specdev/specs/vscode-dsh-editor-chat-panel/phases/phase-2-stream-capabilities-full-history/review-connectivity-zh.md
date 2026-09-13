# 连通性审查 — Phase 2（Q-6 Tab 右键删除）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### 路径 1：Tab 右键删除（Q-6 / AC-13c）
```
入口: TabChrome tab-item.onContextMenu
  → preventDefault + setTabContextMenu({ tabId, sessionId, title })
  → tab-context-menu / menu-tab-delete-session
    → openDeleteConfirm({ sessionId, title, source: 'tab-context' })  ✅ store
  → App 在 ui.deleteConfirm 有值时渲染 DeleteConfirmModal              ✅
  → btn-delete-confirm
    → bridge.emitIntent({ type: 'ui/delete-request', sessionId })       ✅
  → ChatPanelHost 处理 ui/delete-request
    → deps.requestDeleteConfirmed(sessionId)                           ✅
  → extension.runDeleteConfirmed(sessionId)
    → controller.deleteSession(sessionId, { confirmed: true })         ✅
出口: 删除 + pushFullState / historyRefresh
```
**判定**: ✅ 数据路径完整；确认 UI 在 webview modal，Host 无二次原生确认。

### 路径 2：非活动 Tab 的 sessionId（经 panel/tabs 绑定）
```
入口: Registry 快照（每 Tab 的 sessionId）
  → ChatPanelHost.pushTabsFrame()
    → panel/tabs.tabs[].sessionId                                      ✅ Host 推送
  → chat-ui-store applyHostFrame panel/tabs
    → 解析 TabChromeItem.sessionId（非空 string）                       ✅
  → TabChrome: deleteSessionId = tab.sessionId
      ?? (active && activeSessionId ? activeSessionId : undefined)
  → 非活动 Tab：必须用 tab.sessionId；缺失则不打开菜单（fail-closed） ✅
出口: openDeleteConfirm.sessionId === 该 Tab 绑定会话（非 activeSessionId）
```
**判定**: ✅ Host→store→右键菜单契约连通；非活动 Tab 不会误用活动会话 ID。

### 路径 3：溢出菜单删除（回归）
```
入口: btn-overflow → menu-delete-session
  → openDeleteConfirm({ sessionId: activeSessionId, source: 'chrome' }) ✅
  → DeleteConfirmModal → ui/delete-request → requestDeleteConfirmed
  → deleteSession({ confirmed: true })                                 ✅
```
**判定**: ✅ 溢出路径未断；与右键共用同一 modal / intent / Host 后端。

### 路径 4：历史删除（AC-60 同后端）
```
入口: HistoryPanel btn-history-delete
  → openDeleteConfirm({ sessionId: row.sessionId, source: 'history' }) ✅
  → 同一 DeleteConfirmModal → ui/delete-request → deleteSession({confirmed:true})
```
**判定**: ✅ 三角入口（tab-context / chrome / history）汇入单一消费者。

### 路径 5：取消（不发 intent）
```
入口: btn-delete-cancel → closeDeleteConfirm()
出口: 无 ui/delete-request                                              ✅
```
**判定**: ✅ 确认门控连通；取消不进入 Host 删除。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `tab-item` contextmenu | 用户右键 | ✅ | `setTabContextMenu` / fail-closed | ✅ |
| `menu-tab-delete-session` | `tab-context-menu` | ✅ | `openDeleteConfirm(source:'tab-context')` | ✅ |
| `openDeleteConfirm` | TabChrome / 溢出 / 历史 | ✅ | `ui.deleteConfirm` → `DeleteConfirmModal` | ✅ |
| `DeleteConfirmModal` 确认 | App 条件渲染 | ✅ | bridge 发 `ui/delete-request` | ✅ |
| `ChatPanelHost` `ui/delete-request` | protocol 解析 | ✅ | `requestDeleteConfirmed` | ✅ |
| `runDeleteConfirmed` | extension deps | ✅ | `deleteSession({confirmed:true})` | ✅ |
| `pushTabsFrame` sessionId | Registry | ✅ | store `TabChromeItem.sessionId` | ✅ |
| `menu-delete-session`（溢出） | 溢出菜单 | ✅ | `openDeleteConfirm(source:'chrome')` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host → Webview `panel/tabs` | 每 Tab 有 `sessionId` | `pushTabsFrame` 映射 `tab.sessionId`；protocol 标注必填 | ✅ |
| Store ← `panel/tabs` | 保留非空 `sessionId` | 条件展开进 `TabChromeItem` | ✅ |
| TabChrome → `openDeleteConfirm` | `{ sessionId, source:'tab-context' }` | `DeleteConfirmState` 含 `'tab-context'` | ✅ |
| Modal → Host | `ui/delete-request` + 非空 sessionId | parser 校验非空 string；Host 走 confirmed | ✅ |
| Host → Controller | `deleteSession(id, {confirmed:true})` | `runDeleteConfirmed` 即此调用 | ✅ |
| 溢出 | `activeSessionId` + `source:'chrome'` | 仍接线；与右键分流 source、汇合后端 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `panel/tabs` + Registry Tab 投影 | Phase 1 | 已实现；本回路 additive 扩展 `sessionId` | ✅ |
| `DeleteConfirmModal` / `ui/delete-request` | Phase 2 先前回路 | 冻结消费路径；右键仅增入口 | ✅ |
| `requestDeleteConfirmed` / `deleteSession({confirmed:true})` | Phase 2 / 既有 controller | 签名未破坏 | ✅ |
| `action/delete` → 原生确认 | 遗留 | React 主路径不 emit；不参与 Q-6 | ✅ 闲置无害 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无 — 端到端与契约均连通）

### 🟢 Observations
1. **非活动 Tab 的 RTL 覆盖偏薄**：Q-6 RTL 用例为单活动 Tab；多 Tab「右键非活动 → emit 该 Tab sessionId」靠代码路径保证，未做参数化断言。不构成断链。
2. **`ui/delete-request` 后 Host 强制 `historyOpen = true`**：删除后打开历史再 `pushFullState`；三入口行为一致，非断链。
3. **活动 Tab 回退**：`tab.sessionId` 缺失且为活动 Tab 时回退 `activeSessionId`；非活动缺失则不打开菜单——避免误删活动会话。
