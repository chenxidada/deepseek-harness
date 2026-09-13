# 连通性审查 — phase-2-auto-ready-surface

## 视角
**集成连通性** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### 路径 1（本回炉焦点）: applyInFlight 期间 hide→show → 二次 maybeApplyReady
```
入口: hostReady=true + onVisibilityChanged(true)
  → maybeApplyReady()
       → applyInFlight = applyBody()
            → readyAppliedForVisibilityEpoch = true
            → restoreOpenTabSet()  …阻塞（L1 hold）         ✅ 第一次 restore

  ── applyInFlight 期间 ──
  onVisibilityChanged(false)
       → visibilityEpoch += 1
       → readyAppliedForVisibilityEpoch = false             ✅ AD-CR-3 hide 门闩
       → maybeApplyReady → gated                            ✅
  onVisibilityChanged(true)
       → maybeApplyReady
            → applyInFlight !== undefined
            → await applyInFlight                           ✅ 挂起等待

  释放 restore → 第一次 applyBody 完成（empty→New）
       → finally: applyInFlight = undefined

  await 返回后重检:
       → visible ∧ hostReady                                ✅
       → !readyAppliedForVisibilityEpoch                    ✅ hide 已清
       → return this.maybeApplyReady(options)               ✅ 递归再 apply
            → applyBody → restoreOpenTabSet（第 2 次）      ✅
            → empty → newConversationOrReuseEmpty
            → readyAppliedForVisibilityEpoch = true
出口: restoreCalls ≥ 2；news ≥ 2；readyApplied === true
证据: L1 `hide→show during applyInFlight re-applies…` PASS
```
**判定**: ✅ 先前断裂点（await 后直接 `reason:'in-flight'`、新 epoch 无 apply）已连通；hide→show 期间的 waiter 重新进入完整 restore/New

### 路径 2: AC-7 主路径 — 可见 → Start → 就绪 → live/restore
```
入口: chat-panel-provider onDidChangeVisibility
  → handleConversationVisibility(true)                      ✅ extension.ts
       ├─ autoReady.onVisibilityChanged → maybeApplyReady   ✅（hostReady 前 gated）
       └─ orchestrator.request('conversation-view-visible')
            → StartHostPort.start
                 → bindConversations                        ✅
                 → 无 restore/New（DEBT-001 关闭）           ✅
            → state='started' → onHostReadyChanged(true)
                 → maybeApplyReady → restore 或 New         ✅
                 → afterApply → panelHost.pushFullState     ✅
出口: live 或 replay Tab；unread 抑制
```
**判定**: ✅ Start 与 AutoReady 解耦后仍由同一可见性入口串联

### 路径 3: AC-3 — restore（无 Continue / 无未读）
```
入口: maybeApplyReady（visible ∧ hostReady，本 epoch 未 apply）
  → restoreOpenTabSet({ markUnread:false, autoContinue:false })  ✅
  → restoreOpenTabSetBody: void options.*；从不 continueConversation ✅
  → suppressUnreadForAutoReady                                   ✅
出口: replay Tabs
```
**判定**: ✅ 契约消费端连通

### 路径 4: AC-4 / AC-4a / AC-4b / AC-6
```
AC-4:  empty → newConversationOrReuseEmpty → live            ✅
AC-4a: persistOpenTabs 跳过 !hasContent；入队后写入 openTabSet ✅
AC-4b: hasWorkspaceIndex()=false → 跳过 restore，直接 New    ✅
AC-6:  readyApplied → ensureReadySurface → 仅活动空复用       ✅
```
**判定**: ✅ 各分支上下游均接通；幂等面不叠空 Tab

### 路径 5: AC-1a 反向
```
activate / 隐藏 Start → AutoReady gated → 0 Tabs             ✅
随后可见 → 路径 2 恢复就绪面                                 ✅
```
**判定**: ✅ 反向仍通

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `maybeApplyReady`（epoch 再入） | in-flight waiter（hide→show） | ✅ | 递归 `maybeApplyReady` → `applyBody` | ✅ |
| `onVisibilityChanged` | `handleConversationVisibility` / reveal | ✅ | epoch bump + `maybeApplyReady` | ✅ |
| `onHostReadyChanged` | orchestrator `onChange` / stop | ✅ | `maybeApplyReady` | ✅ |
| `applyBody` | `maybeApplyReady` | ✅ | `restoreOpenTabSet` / `newConversationOrReuseEmpty` / `suppressUnread` / `afterApply` | ✅ |
| `ensureReadySurface` | `applyBody`（本 epoch 已 apply） | ✅ | `newConversationOrReuseEmpty` | ✅ |
| `newConversationOrReuseEmpty` | AutoReady；`dsh.newConversation` | ✅ | 活动空复用或 `newConversation` | ✅ |
| `createStartHostPort.start` | Orchestrator | ✅ | 仅 bind + push（无 restore/New） | ✅ |
| `dsh.test.triggerAutoReady` | L2 | ✅ | `triggerAutoReady` → `maybeApplyReady` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| hide→show waiter → `maybeApplyReady` | await in-flight 后若新 epoch 未 apply 则再 apply | `!readyApplied` → `return this.maybeApplyReady(options)` | ✅ |
| Extension → AutoReadyDeps | getController / hasWorkspaceIndex / afterApply | conversations / folders.length>0 / pushFullState | ✅ |
| AutoReady → Controller | `restoreOpenTabSet({markUnread,autoContinue,events?})` | 签名接受；body 不 Continue | ✅ |
| AutoReady → Controller | `newConversationOrReuseEmpty(title)` | 仅活动空复用 | ✅ |
| Visibility → Orchestrator + AutoReady | 同入口双通知 | `handleConversationVisibility` 两者皆调 | ✅ |
| Controller `restoreInFlight` vs AutoReady 二次 apply | 第二次 restore 不被第一次 coalesce 吞掉 | 第一次 restore finally 先于 AutoReady finally 清 `restoreInFlight`；二次 apply 发起时已可独立 restore | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `AutoStartOrchestrator` + `StartHostPort` | phase-1 | 冻结；Start 内无 restore/New | ✅ |
| `handleConversationVisibility` / `fireConversationVisibility` | phase-1 | 保留；Coordinator apply | ✅ |
| `ConversationController.restoreOpenTabSet` / `persistOpenTabs` | 前序 | 可选 options；空 Tab 过滤 | ✅ |
| `pendingRestoreLatch` connected restore | 前序 | 旁路保留；非 AutoReady 主路径 | ✅ |
| DEBT-003 Continue 旁路 | → phase-4 | 未改 | ✅ 显式推迟 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **epoch 回炉关闭连通缺口**：`maybeApplyReady` 在 `await applyInFlight` 后重检门闩；`!readyAppliedForVisibilityEpoch` 时递归再 apply，hide→show 不再被 `in-flight` 早退吞掉。L1 竞态用例绿。
- **二次 restore 与 Controller `restoreInFlight`**：生产路径上第一次 restore 的 `finally` 先于 AutoReady `applyInFlight` 清除，二次 apply 可独立调用 `restoreOpenTabSet`，不会 coalesce 成「假二次」。
- 既有 AC-3/4/4a/4b/6/7 与 AC-1a 反向路径连通性相对上次 PASS 审查未回退。
- DEBT-003 仍指向 phase-4；非本 Phase 接线范围。
