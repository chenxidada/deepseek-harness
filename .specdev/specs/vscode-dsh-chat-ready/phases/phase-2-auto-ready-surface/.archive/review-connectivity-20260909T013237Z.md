# Connectivity Review — phase-2-auto-ready-surface

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: AC-7 主路径 — 可见 → Start → 就绪 → New live
```
Entry: chat-panel-provider onDidChangeVisibility / initial visible
  → hooks.onVisibilityChanged(true)
  → handleConversationVisibility(true)                 ✅ extension.ts
       ├─ conversationVisible = true
       ├─ connectionUi.setConversationVisible(true)
       ├─ autoReady.onVisibilityChanged(true)          ✅ AutoReadyCoordinator
       │     → maybeApplyReady()  [gated until hostReady]
       └─ orchestrator.request('conversation-view-visible')
            → StartHostPort.start
                 → IdeSessionHost.start + bindConversations  ✅
                 → NO restoreOpenTabSet / newConversation   ✅ DEBT-001 closed
                 → panelHost.pushFullState()
            → state='started'
            → onChange → autoReady.onHostReadyChanged(true) ✅
                 → maybeApplyReady():
                      hasWorkspaceIndex? restore : New
                      empty → newConversationOrReuseEmpty   ✅
                      suppressUnreadForAutoReady            ✅
                      afterApply → panelHost.pushFullState  ✅
Exit: live Tab, unread=false, sendPrompt 可入队
```
**判定**: ✅ 数据路径完整；Start 与 AutoReady 解耦后仍由同一可见性入口串联

### Path 2: AC-3 — 非空 openTabSet → restore replay（无 Continue / 无未读）
```
Entry: fireConversationVisibility(true) / triggerAutoReady
  → maybeApplyReady (visible ∧ hostReady)
  → restoreOpenTabSet({ markUnread:false, autoContinue:false })  ✅ 调用方传参
  → restoreOpenTabSetBody: void options.*; never continueConversation  ✅
  → hydrate mode=replay
  → suppressUnreadForAutoReady (registry.setUnread false)         ✅
Exit: replay Tabs; continueConversation 未被 AutoReady 调用
```
**判定**: ✅ restore 契约与 AutoReady 消费端连通；L2 continueSpy 覆盖

### Path 3: AC-4 / AC-4a — 空 openTabSet → New；空 Tab 不入持久化直至入队
```
Entry: AutoReady empty outcome / no-workspace New
  → newConversationOrReuseEmpty → registry.create
  → persistOpenTabs skips !hasContent                     ✅ 写侧过滤
  → dsh.test.sendPrompt → prompt* → messages.append
  → persistOpenTabs 写入 openTabSet                       ✅ 读侧 getIndex 可见
Exit: 首条成功入队前 openTabSet 无该 session；入队后出现
```
**判定**: ✅ 生产者→持久化→消费者闭环（含 HG-2 转换点）

### Path 4: AC-4b — 无工作区跳过 restore，直接 New；Start 仍跑
```
Entry: workspaceFolders=[] + visibility
  → hasWorkspaceIndex() = folders.length > 0 → false      ✅ extension 注入
  → applyBody 跳过 restoreOpenTabSet
  → newConversationOrReuseEmpty → live
  → orchestrator 仍 request → Start → started             ✅
Exit: live Tab；restore 未被调用；无旧 session restore
```
**判定**: ✅ AD-CR-5 就绪分支与 Start 分支独立且均连通

### Path 5: AC-6 — 重复 triggerAutoReady / 可见抖动不叠空 Tab
```
Entry: 二次 triggerAutoReady 或 hide→show
  → readyApplied? ensureReadySurface : full apply
  → ensure / New 均走 newConversationOrReuseEmpty
       → 仅复用 active && !hasContent；禁止 findEmptyLive  ✅
Exit: Tab 数不变；仍可 sendPrompt
```
**判定**: ✅ 幂等面与复用 API 连通

### Path 6: AC-1a 反向 — activate / hidden Start 不建 Tab
```
Entry: activate only → simulateStartupOnly
  → 无 request；Start spy/hostCreateCount=0；tabs=0       ✅
Entry: hidden requestStart / command-start
  → StartHostPort.start → bindConversations
  → AutoReady gated (!visible) → 不 apply                 ✅
  → tabs 仍为 0
Entry: 随后 fireConversationVisibility(true)
  → 主路径 Path 1 恢复就绪面
```
**判定**: ✅ 反向仍通；与 phase1 AC-1a 接线兼容（phase2 L2 复跑）

### Path 7: L2 钩子 triggerAutoReady
```
Entry: dsh.test.triggerAutoReady(opts)
  → parseAutoReadyOptions → autoReady.triggerAutoReady
  → maybeApplyReady(options)                              ✅
  → panelHost.pushFullState()
Exit: AutoReadyApplyResult
```
**判定**: ✅ 设计表钩子已接线；与生产 maybeApplyReady 同入口

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `AutoReadyCoordinator` | `activate` 构造；`handleConversationVisibility`；orchestrator `onChange`；`triggerAutoReady`；`revealConversationPanel`；`stopSession` | ✅ | `getController` / `restoreOpenTabSet` / `newConversationOrReuseEmpty` / `suppressUnread` / `afterApply` | ✅ |
| `maybeApplyReady` | `onVisibilityChanged` / `onHostReadyChanged` / `triggerAutoReady` | ✅ | `applyBody` → restore/New/ensure | ✅ |
| `newConversationOrReuseEmpty` | AutoReady apply/ensure；`dsh.newConversation` | ✅ | `registry.getActive` + `hasContent` 或 `newConversation` | ✅ |
| `restoreOpenTabSet(options)` | AutoReady；`dsh.test.restoreOpenTabs`；`pendingRestoreLatch` connected | ✅ | hydrate / persist；不调 Continue | ✅ |
| `createStartHostPort.start` | Orchestrator | ✅ | bind + push only（无 restore/New） | ✅ |
| `dsh.test.triggerAutoReady` | L2 tests | ✅ | `autoReady.triggerAutoReady` | ✅ |
| `dsh.test.fireConversationVisibility` | L2 tests | ✅ | `handleConversationVisibility`（AD-CR-10） | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Extension → AutoReadyDeps | `getController()` / `hasWorkspaceIndex()` / `afterApply` | 注入 `conversations`、folders.length>0、`pushFullState` | ✅ |
| AutoReady → Controller | `restoreOpenTabSet({markUnread,autoContinue,events?})` | 签名接受；body 不 Continue / 不打未读 | ✅ |
| AutoReady → Controller | `newConversationOrReuseEmpty(title)` | 仅活动空复用 | ✅ |
| Visibility → Orchestrator + AutoReady | 同入口双通知 | `handleConversationVisibility` 两者皆调 | ✅ |
| Orchestrator → AutoReady hostReady | `started` ↔ true | `onChange` → `onHostReadyChanged(snap.state==='started')` | ✅ |
| index 导出 | `AutoReadyCoordinator` 替换 LatchSeam | `index.ts` 仅导出 Coordinator；LatchSeam 已删 | ✅ |
| STUB-001 / DEBT-001 | 关闭声称 | 无 `@STUB` LatchSeam；Start 无 restore/New | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `AutoStartOrchestrator` + `StartHostPort` | phase-1 | 冻结；本 Phase 仅删 Start 内 restore/New，未改 port 签名 | ✅ |
| `handleConversationVisibility` / `fireConversationVisibility` | phase-1 | 保留；升级为 Coordinator apply | ✅ |
| `ConversationController.restoreOpenTabSet` / `persistOpenTabs` | 前序 conversation-ui | 扩展可选 options；空 Tab 过滤保留 | ✅ |
| `pendingRestoreLatch` auto-restore on connected | 前序 | 仍存在；AutoReady 在 hostReady 时调用 restore，不依赖该 latch 主路径 | ✅ 旁路保留 |
| DEBT-003 Webview Continue 旁路 | phase-1 → phase-4 | 未改；非本 Phase 接线范围 | ✅ 显式推迟 |
| STUB-001 / DEBT-001 / DEBT-002 | phase-1 继承 | 本 Phase 关闭声称与代码一致（DEBT-002=README 等价） | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **DEBT-001 / STUB-001 关闭在连通性上成立**：Start 成功路径只 `bindConversations` + `pushFullState`；LatchSeam 已移除，Coordinator 承接 visibility + hostReady → apply。
- **偏差 1（DEBT-002 README 等价）**：生产活动栏仍无独立 container-open 监听；L2 `openActivityBar` → `onActivityBarOpened` → reveal + `request('activity-bar')` 仍通。不阻断本 Phase Must 路径。
- **偏差 2（restore options 显式 API）**：`markUnread`/`autoContinue` 被接受后 `void`；行为依赖既有「restore 不 Continue / 不打未读」+ `suppressUnreadForAutoReady`。契约消费端连通，无死写字段黑洞（选项本意即抑制）。
- **DEBT-003** 仍指向 phase-4；本 Phase 未切断 Continue 命令/`ensureHostForSend` 既有连通。
- **`pendingRestoreLatch`**：前序「waiting-host → connected 再 restore」旁路仍在；与 AutoReady 主路径并行不冲突（AutoReady 仅在 `hostReady` 时 apply）。
