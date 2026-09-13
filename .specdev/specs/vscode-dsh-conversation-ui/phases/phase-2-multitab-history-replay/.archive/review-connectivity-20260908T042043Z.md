# Connectivity Review — phase-2-multitab-history-replay

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**MUST-FIX**

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
**判定**: ✅ 队列并入 `interaction-coordinator.ts`（无 `interaction-queue.ts`）；生产路径经 `host.interactions` 连通

### Path 3: 历史打开 → read-log → ReplayHydrator → panel + Timeline（AC-30 / AC-47）
```
Entry: History TreeView click / dsh.openHistory / dsh.test.openHistory
  → ConversationController.openFromHistory(sessionId)
       ├─ registry.getBySessionId → switchTo (AC-64/65)     ✅
       └─ else:
            Host.readSessionLog(sessionId)                  ✅
              → bridge broadcast session/read-log           ✅
              → ide-bridge handleReadLog
                   → ctx.get(sessionPersistence).open/read  ✅
                   → session/read-log/response { events }   ✅
              → IdeSessionHost.pendingReadLog resolve       ✅
            registry.create(..., mode='replay')             ✅ 新 tabId
            hydrateFromAuthoritativeLog(events)             ✅
            messages.replace + timeline.replace             ✅
            panelHost.pushFullState
              → panel/state mode=replay
              → messages/replace                            ✅
            timeline.onChange → timelineRefresh             ✅
Exit: replay Tab; panel + Timeline rebuilt from authority log
```
**判定**: ✅ 主回放切片连通（T-0a read 缝已产品化）；L2/L3 可用 `{ events }` 旁路测 hydrate，bridge 往返由 ide-bridge spec 覆盖

### Path 4: 关 Tab → 历史回放（VP-2-history）
```
Entry: closeConversation(tabId)
  → failClosedSession (pending UI abort)                    ✅
  → registry.close (tabId destroyed; stores kept in memory) ✅
  → index.setOpenTabs drops closed tab                      ✅
  → later openFromHistory → cold events (not memory-only)   ✅
  → new tabId; mode=replay                                  ✅
Exit: reopen mint new tabId; single open per sessionId
```
**判定**: ✅ 连通

### Path 5: 回放拒发（AC-31 / VP-2-replay-reject）
```
Entry: FakeWebview / Webview composer/send | dsh.test.sendPrompt
  → ChatPanelHost.sendPrompt
    → active.mode === 'replay' → reject('replay')           ✅
    → post ui/reject-send { reason: 'replay' }              ✅
    → no acceptSend / no prompt                             ✅
Exit: reject only
```
**判定**: ✅ 连通

### Path 6: Host 断开仍列历史索引（AC-63）
```
Entry: Extension activate / Host stopSession / Host never started
  → History TreeView getRows:
       conversations === undefined → return []              🔴
  → dsh.test.listHistory → [] when conversations undefined  🔴
  → dsh.test.getIndex → empty sessions stub (not workspaceState) 🔴
  → dsh.openHistory (no controller) error copy claims
       "History list is visible"                            🔴 文案与实际断裂
  → workspaceState 中 EXTENSION_INDEX 仍有数据，但无独立
       ExtensionIndex 消费者在 Host 未绑定时读取            🔴
Exit: ❌ Host 未绑定 / stop 后列表为空，AC-63 端到端断裂
```
**判定**: 🔴 MUST-FIX — 索引 API（`listHistoryFromIndex` / `ExtensionIndex`）本身 Host 无关，但 Extension 接线把列表消费绑死在 `conversations` 生命周期上

### Path 7: L2/L3 验证面（AC-54 / AC-84）
```
run-phase2-l2-l3.sh
  → phase2-multitab-history-replay.spec.ts
      unread / queue / history / hydrator oracle / replay reject / DEBT-002 ✅
  → ide-bridge.spec.ts session/read-log                     ✅
  → panel-l2-l3-protocol.spec.ts                            ✅
Exit: scripted L2 + L3 (FakeWebview) coverage present
```
**判定**: ✅ 验证路径连通（不替代 AC-63 产品路径修复）

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `registry.setUnread` | `projectAssistantMessage` / `injectAssistantMessage` | ✅ | Tab bar via `onChange` | ✅ |
| `InteractionCoordinator.enqueue/pump` | bridge frames via `IdeSessionHost` | ✅ | `InteractionUi.present*` + `setApprovalBadge` | ✅ |
| `onActiveSessionChange` | `switchConversation` / create / close / openFromHistory | ✅ | demote + `pump` | ✅ |
| `IdeSessionHost.readSessionLog` | `openFromHistory` | ✅ | bridge `session/read-log` | ✅ |
| `handleReadLog` (ide-bridge) | Host frame | ✅ | `sessionPersistence.open/read` | ✅ |
| `hydrateFromAuthoritativeLog` | `openFromHistory` | ✅ | `messages.replace` + `timeline.replace` | ✅ |
| `ChatPanelHost.pushFullState` | openFromHistory / switch / registry watch | ✅ | `panel/state` + `messages/replace` | ✅ |
| `ChatPanelHost.sendPrompt` replay gate | Webview / L2 hooks | ✅ | `ui/reject-send` | ✅ |
| `listHistoryFromIndex` | History TreeView / L2 hooks | 🔴 | `ExtensionIndex.listHistorySessions` | ✅ API；🔴 仅在 conversations 存活时接到 UI |
| `createHistoryView` | `extension.activate` | ✅ | `dsh.openHistory` command | ✅ open；🔴 list 依赖 conversations |
| `dsh.test.deleteHistory` | History context menu | ✅ | `deleteSession` → dispose + `markDeleted` | ✅（需 Host） |
| `revealTarget` / `changedFileCount` | `scroll/reveal` / L2 hooks | ✅ | MessageStore + TimelineStore | ✅ Should 面 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host → ide-bridge `session/read-log` | `{ id, sessionId }` → `{ ok, events }` | types + validate + handler | ✅ |
| ide-bridge → `sessionPersistence` | `open(id,'read').read(0)` | Cordis key `sessionPersistence`（base+jsonl） | ✅ |
| `openFromHistory` → hydrator | `HydratorSessionEvent[]` → messages + timelineItems | `hydrateFromAuthoritativeLog` | ✅ |
| hydrator → `TimelineStore.replace` | bulk rows w/ Diff `oldText: string\|null` | `replace` + Diff 类型 | ✅ |
| Tab bar ← registry | `unread` / `approvalBadge` | fields + chrome glyphs | ✅ |
| History UI ← index | Host 断开仍可读 workspace 索引 | TreeView/`listHistory` 仅在 `conversations` 绑定后可读 | 🔴 |
| Replay composer | reject `replay` | `sendPrompt` + `ui/reject-send` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| T-0a fold / read-log 选型 | phase-0a | PASS；产品 `ReplayHydrator` + bridge frame 落地 | ✅ |
| Panel / close≠dispose / MessageStore | phase-1 | 沿用；未破坏 close/delete 契约 | ✅ |
| `InteractionCoordinator` 扩展 | phase-1 | 同文件扩展队列；未另建 queue 文件 | ✅ |
| GAP-001 `session/resume` | phase-3 | 未实现（排除项） | ✅ 故意断开 |
| AC-69 Host 未连后自动重建 | phase-3 | `host-not-ready` 说明文案 | ✅ 对齐偏差记录 |

## 关键发现

### 🔴 Must-Fix
- **AC-63 Host 独立历史列表路径断裂**：`ExtensionIndex` / `listHistoryFromIndex` 可 Host 无关读取，但 `extension.ts` 中 History TreeView、`dsh.test.listHistory`、`dsh.test.getIndex` 均在 `conversations === undefined`（未 `startSession` 或已 `stopSession`）时返回空，未从 `workspaceState` 重建索引。`dsh.openHistory` 在无 controller 时仍提示 “History list is visible”，与实际空列表矛盾。须在 Host 生命周期外保留/加载 workspace 作用域索引供列表消费（open replay 仍可要求 Host）。

### 🟡 Should-Fix
- **AC-62 删除入口挂在 `dsh.test.deleteHistory`**：产品 History 右键菜单指向 test 命令而非产品级 delete-history 命令；路径可执行，但产品/测试面混用，后续 phase 易误删测试钩子。
- **生产 `openFromHistory` ↔ bridge 冷读缺一条串联 L2**：hydrate 与 read-log 分别有测，缺少 Extension Host 不注入 `events` 的端到端断言（非路径断裂，属集成覆盖加强）。

### 🟢 Observations
- 未读、审批软优先、关 Tab→回放、回放拒发、Timeline `replace`、DEBT-001/002 相关接线均连通。
- ide profile 经 base `session-persistence-jsonl` 提供 `sessionPersistence`，与 bridge `SESSION_PERSISTENCE_SERVICE` 键一致。
- Host 未连打开历史返回 `host-not-ready` 并有说明，符合 phase-2 对 AC-69 的延期边界。
