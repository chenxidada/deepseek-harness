# Connectivity Review — phase-2-multitab-history-replay

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: 非活动未读点（AC-19 / AC-57）
```
Entry: SDK session.event assistant/message | dsh.test.injectAssistant
  → ConversationController.projectAssistantMessage / injectAssistantMessage
    → MessageStore.append                                   ✅
    → inactive Tab → registry.setUnread(tabId, true)        ✅
    → registry.onChange → extension tabBarRefresh           ✅ (bindConversations)
  → switchConversation / registry.switchTo
    → unread=false (AC-57)                                  ✅
    → host.interactions.onActiveSessionChange?.(sessionId)  ✅
    → panelHost.pushFullState                               ✅
Exit: Tab chrome unread cleared; panel shows session
```
**判定**: ✅ 数据路径完整

### Path 2: 审批串行软优先 + 切 Tab demote（AC-20 / AC-58 / AD-CU-7）
```
Entry: bridge approval/request | user-questions/request
  → IdeSessionHost.onBridgeFrame
    → InteractionCoordinator.handleApproval / handleQuestions
      → enqueue (active soft-priority insert; same-Tab FIFO) ✅
      → syncApprovalBadges → registry.setApprovalBadge      ✅
      → pump → presentEntry (global single presented)       ✅
  → switchConversation → onActiveSessionChange
    → unanswered presented → demote presented→pending
      (abort UI, badge kept, no bridge settle)              ✅
    → pump wakes target pending                             ✅
  → failClosedSession / settleAbort at head
    → dequeue → pump next                                   ✅
Exit: serial UI; soft priority; badge retained across demote
```
**判定**: ✅ 队列并入 `interaction-coordinator.ts`；生产路径经 `host.interactions` 连通

### Path 3: 历史打开 → read-log → ReplayHydrator → panel + Timeline（AC-30 / AC-47）
```
Entry: History TreeView click / dsh.openHistory / dsh.test.openHistory
  → (list pick) listHistoryFromIndex(resolveWorkspaceIndex()) ✅ 可冷读
  → requireConversations() / controller.openFromHistory
       ├─ registry.getBySessionId → switchTo (AC-64/65)     ✅
       └─ else:
            Host.readSessionLog(sessionId)                  ✅
              → bridge session/read-log → persistence       ✅
            registry.create(..., mode='replay')             ✅
            hydrateFromAuthoritativeLog(events)             ✅
            messages.replace + timeline.replace             ✅
            panelHost.pushFullState                         ✅
Exit: replay Tab; panel + Timeline rebuilt from authority log
```
**判定**: ✅ 回放切片连通；无 Host 时 open 明确 `host-not-ready`（列表仍可独立）

### Path 4: 关 Tab → 历史回放（VP-2-history）
```
Entry: closeConversation(tabId)
  → failClosedSession → registry.close → index.setOpenTabs  ✅
  → later openFromHistory → cold events / new tabId         ✅
Exit: reopen mint new tabId; single open per sessionId
```
**判定**: ✅ 连通

### Path 5: 回放拒发（AC-31 / VP-2-replay-reject）
```
Entry: FakeWebview / Webview composer/send | dsh.test.sendPrompt
  → ChatPanelHost.sendPrompt
    → active.mode === 'replay' → reject('replay')           ✅
    → post ui/reject-send { reason: 'replay' }              ✅
Exit: reject only; no prompt
```
**判定**: ✅ 连通

### Path 6: Host / conversations 未绑定仍列历史索引（AC-63）— MUST-FIX 回炉焦点
```
Entry: activate（未 startSession）或 stopSession → unbindConversations
  → workspaceState / workspaceKey 在 activate 写入模块态   ✅
  → resolveWorkspaceIndex():
       conversations !== undefined → conversations.index   ✅ live
       else → new ExtensionIndex(workspaceKey, workspaceState)
              → state.get(EXTENSION_INDEX_STATE_KEY)       ✅ 冷读
  → History TreeView getRows:
       () => listHistoryFromIndex(resolveWorkspaceIndex()) ✅
  → dsh.test.listHistory → 同上                            ✅
  → dsh.test.getIndex → resolveWorkspaceIndex().read()     ✅
  → dsh.openHistory:
       无 sessionId → QuickPick 用冷读 rows                ✅
       无 controller → Error「Connect Host before…replay」 ✅
       不再声称 “History list is visible”                  ✅
  → unbindConversations → clearLocal 清 Tabs/消息，不擦 sessions
       → historyRefresh → TreeView 再 getChildren 冷读     ✅
Exit: 无 conversations 绑定时列表/索引仍来自 workspaceState
```
**判定**: ✅ 上轮断裂已修复；AC-63 列表路径与 open-needs-Host 边界接通

### Path 7: L2/L3 验证面（AC-54 / AC-84）
```
phase2-multitab-history-replay.spec.ts
  → AC-63: listHistory / getIndex / TreeView cold rows     ✅ (vitest PASS)
  → unread / queue / history / hydrator / replay reject    ✅
ide-bridge.spec.ts session/read-log                        ✅
panel-l2-l3-protocol.spec.ts                               ✅
```
**判定**: ✅ 验证钩子接到产品路径（含冷读）

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `resolveWorkspaceIndex()` | History getRows / listHistory / getIndex / openHistory pick | ✅ | live `conversations.index` 或 `ExtensionIndex(workspaceState)` | ✅ |
| `listHistoryFromIndex` | TreeView / L2 / openHistory QuickPick | ✅ | `ExtensionIndex.listHistorySessions` | ✅ |
| `createHistoryView` | `extension.activate` | ✅ | `dsh.openHistory` | ✅ |
| `dsh.openHistory` | TreeView / 命令面板 | ✅ | 冷读选会话 → `openFromHistory`（需 Host） | ✅ |
| `dsh.deleteHistory` | History 右键菜单 | ✅ | `deleteSession`（需 conversations） | ✅ |
| `registry.setUnread` | inject / project assistant | ✅ | Tab bar via `onChange` | ✅ |
| `InteractionCoordinator` | bridge frames | ✅ | UI + badges | ✅ |
| `hydrateFromAuthoritativeLog` | `openFromHistory` | ✅ | messages + timeline replace | ✅ |
| `ChatPanelHost.sendPrompt` replay gate | Webview / L2 | ✅ | `ui/reject-send` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| History UI ← index | Host 断开仍可读 workspace 索引 | `resolveWorkspaceIndex` 冷读 workspaceState | ✅ |
| `openHistory` ← 用户 | 列表可独立；打开需 Host | 冷读 pick + host-not-ready 文案 | ✅ |
| Host → ide-bridge `session/read-log` | `{ id, sessionId }` → `{ ok, events }` | handler + persistence | ✅ |
| `openFromHistory` → hydrator | events → messages + timeline | `hydrateFromAuthoritativeLog` | ✅ |
| History 菜单 → 删除 | 产品命令可发现 | `dsh.deleteHistory`（test 为别名） | ✅ |
| Replay composer | reject `replay` | `sendPrompt` + `ui/reject-send` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| T-0a fold / read-log | phase-0a | PASS；产品 hydrator + bridge 落地 | ✅ |
| Panel / close≠dispose / MessageStore | phase-1 | 沿用；未破坏 close/delete | ✅ |
| `InteractionCoordinator` 扩展 | phase-1 | 同文件扩展；无 `interaction-queue.ts` | ✅ |
| GAP-001 `session/resume` | phase-3 | 排除项 | ✅ 故意断开 |
| AC-69 未连后自动重建 | phase-3 | `host-not-ready` 说明 | ✅ |

## 关键发现

### 🔴 Must-Fix
- （无）上轮 AC-63 列表绑死 `conversations` 的断裂已通过 `resolveWorkspaceIndex()` 冷读接通。

### 🟡 Should-Fix
- **生产 `openFromHistory` ↔ bridge 冷读缺一条串联 L2**：hydrate 与 read-log 仍多为旁路/`events` 注入；可选补 Extension Host 不注入 `events` 的端到端断言（非路径断裂）。

### 🟢 Observations
- 无绑定冷读与有绑定 live index 共用 `listHistoryFromIndex` / `ExtensionIndex.listHistorySessions`，契约一致。
- `clearLocal` 清 Tabs/消息，不擦 `ExtensionIndex` sessions；`unbind` 后 `historyRefresh` 再走冷读，stopSession 后列表仍可恢复。
- AC-62 产品菜单已挂 `dsh.deleteHistory`；删除仍需 Host（与「列表独立、变更需 Host」一致）。
- AC-63 回归：`vitest … -t "AC-63"` → 1 passed。
