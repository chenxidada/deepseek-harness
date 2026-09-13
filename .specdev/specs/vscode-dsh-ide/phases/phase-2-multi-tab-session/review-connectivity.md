# Connectivity Review — Phase 2 (GAP-003 / GAP-004 debt fix)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

GAP-003：关 Tab 现为 `disposeSession` 成功后再 `registry.close`；dispose 失败时 Tab 仍在注册表且 Extension 错误路径不误删。GAP-004：TreeView `getTreeItem.command` → `dsh.switchConversation(tabId)` → `registry.switchTo` → 后续 `promptActive` 使用该 Tab 的 `sessionId`。STUB-001/002 目标 Phase 3，本审查不判 MUST-FIX。

## 端到端路径追踪

### Path 1: GAP-003 成功 — 关 Tab → dispose → 再 registry.close
```
Entry: dsh.closeConversation
  → requireConversations()
  → active = controller.registry.getActive()
  → await controller.closeConversation(active.tabId)
       → tab = registry.get(tabId)                    ✅ Tab 仍在
       → await host.disposeSession(tab.sessionId)     ✅ 先 dispose
            → bridge.broadcast({ kind:'session/dispose', id, sessionId })
              → ide-bridge handleHostFrame
                → sdkSessionDispose.disposeSession(sessionId)
                → session/dispose/response { ok:true }
            → Host pendingDispose.resolve()
       → registry.close(tabId)                        ✅ 仅成功后移除
            → onChange → tabBar.refresh()
Exit: Tab 从注册表/TreeView 消失；远端 session 已 dispose
```
**判定**: ✅ 顺序为 dispose → close；与 tech-debt-registry GAP-003「已解决」一致

### Path 2: GAP-003 失败 — dispose 抛错 → Tab 仍在
```
Entry: dsh.closeConversation / controller.closeConversation(tabId)
  → registry.get(tabId)                               ✅ 取得 sessionId
  → await host.disposeSession(sessionId)
       → throw / reject（bridge 失败、timeout、ok:false…）
  → registry.close(tabId)                             ❌ 不执行（await 抛出）
  → Extension catch → showErrorMessage                ✅ 不调用 clearLocal
Exit: registry.get(tabId) 仍存在；tabs 数量不变；可重试关闭
```
**判定**: ✅ 失败路径无「写后即弃 / 先删后败」；in-flight 期间 Tab 仍可读（debt-fix 断言）

### Path 3: GAP-004 — TreeView 点击 → switch → 正确 sessionId
```
Entry: TreeView item click (viewId: dsh.conversations)
  → getTreeItem(element)
       → item.command = {
           command: 'dsh.switchConversation',
           arguments: [element.tabId],               ✅ 与 Tab 一一对应
         }
  → VS Code 调用已注册命令（package.json contributes + activate registerCommand）
  → extension: typeof tabIdArg === 'string'
       → controller.switchConversation(tabIdArg)
            → registry.switchTo(tabId)               ✅ activeTabId = tabId
            → onChange → tabBar.refresh()
  → 后续 dsh.promptActiveConversation(text)
       → promptActive → getActive().sessionId
       → host.prompt(active.sessionId, …)            ✅ 目标 = 点击 Tab 的 sessionId
Exit: 活动指针与 prompt 目标同 Tab；无参命令仍走 QuickPick（旁路保留）
```
**判定**: ✅ TreeView → 命令 → registry → prompt 全链连通；view id / command id 与 `package.json` 一致

### Path 4: STUB-001 / STUB-002（审批 / 提问）
```
approval/request → unavailable
user-questions/request → NO_PROVIDER
```
**判定**: ⏭ 活跃债务，目标 `phase-3-interaction-fail-closed`；按任务说明不判 MUST-FIX

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `ConversationController.closeConversation` | `extension` `dsh.closeConversation` | ✅ | `host.disposeSession` → 成功后 `registry.close` | ✅ |
| `IdeSessionHost.disposeSession` | `closeConversation` | ✅ | bridge `session/dispose` → runtime disposer | ✅ |
| `ConversationTabBar.getTreeItem.command` | VS Code TreeView 点击 | ✅ | `dsh.switchConversation` + `[tabId]` | ✅ |
| `extension` `dsh.switchConversation(tabId?)` | TreeView args / 菜单无参 | ✅ | `controller.switchConversation` 或 QuickPick | ✅ |
| `ConversationController.switchConversation` | Extension 命令 | ✅ | `registry.switchTo` → prompt 消费 `getActive()` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Controller → Host | `disposeSession(sessionId): Promise<void>`；失败抛错 | `session-host.ts` 同签名；失败 reject | ✅ |
| Controller → Registry | dispose 成功后再 `close(tabId)` | `close` 仅在 await 之后 | ✅ |
| Tab bar → Extension 命令 | `command: 'dsh.switchConversation'`, `arguments: [tabId]` | `registerCommand` 读 `tabIdArg?: unknown`，string 直切 | ✅ |
| Extension → Controller switch | `switchConversation(tabId: string): void` | `registry.switchTo`；未知 tab 抛错，Extension catch | ✅ |
| package.json view | `dsh.conversations` | `createTreeView('dsh.conversations', …)` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `IdeSessionHost.disposeSession` / bridge `session/dispose` | phase-1 + phase-2 主实现 | 已实现，本修复未改签名 | ✅ |
| STUB-001 / STUB-002 approval & user-questions | phase-1 | 仍为桩，目标 Phase 3 | ⏭ 不判 MUST-FIX |
| Phase 1 冻结的 SDK stdout / 双通道启动 | phase-1 | 未因本债务修复改动 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）— 先前审查中的 GAP-003（先 close 后 dispose）与 GAP-004（TreeView 未绑切换）已由本回路闭合。

### 🟢 Observations
- GAP-003/004 已从 `tech-debt-registry.md` 移入「已解决」；回归测试 `gap-003-004-debt-fix.spec.ts` 覆盖 in-flight 保留、失败保留、dispose→close 顺序、TreeItem.command+tabId。
- 债务修复测试未跑 Extension `activate` 命令入参整链（TreeView → registerCommand）；源码 call site 已连通，属覆盖面观察而非路径断裂。
- STUB-001/002 仍活跃；与本 Phase 关 Tab / 切换路径无交叉依赖。
