# Connectivity Review — phase-3-restart-continue（PARTIAL 回炉复审）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**MUST-FIX**

## 端到端路径追踪

### Path 1: 二次重启仍见 deferred（AC-70 / DEBT-003）
```
Entry: restoreOpenTabSet（N=1，3 行 openTabSet）
  → planRestore：uiSet=1，deferred=2
  → openTabPersistSuspended=true（批内 registry 变更不缩写）
  → deferredRestore = deferred 副本
  → finally：suspend=false → persistOpenTabs()
       registry（有内容）∪ deferredRestore（sessionId 去重） ✅
  → workspaceState.openTabSet.length === 3

二次冷启动:
  new ConversationController(same workspaceState)
  → restoreOpenTabSet → 仍读到 3 行 → hydrate active + deferred=2 ✅
```
**判定**: ✅ DEBT-003 主路径连通；durable index 不再被 UI cap 缩水

### Path 2: Host connected → 自动 restore（AC-69 / DEBT-005）
```
Entry: restoreOpenTabSet while host.status !== 'connected'
  → pendingRestoreLatch=true
  → panelHost.pushFullState → waiting-host ✅

Host 就绪:
  IdeSessionHost.status setter → statusListeners
  → controller.onStatusChange('connected' && latch)
       → restoreOpenTabSet()（restoreInFlight 去重） ✅
  → hydrate + latch=false + panel/state replay ✅

产品 startSession:
  Host.start → status=connected → NEW controller → 显式 restoreOpenTabSet ✅
  （首连不依赖 latch；同 controller 晚连走 Path 2）
```
**判定**: ✅ DEBT-005 接通；`onStatusChange` 生产者→消费者完整

### Path 3: Webview Continue / 查看更多（DEBT-004）
```
Host pushFullState
  → panel/state { continue, deferredRestoreCount }              ✅
Webview buildThinChatHtml
  → syncChrome 读 continue / deferredRestoreCount               ✅
  → Continue 点击 → postMessage { type:'action/continue' }      ✅
  → 查看更多 → postMessage { type:'action/restore-more' }       ✅
ChatPanelHost.handleWebviewMessage
  → requestContinue → continueConversation                      ✅
  → requestRestoreMore → restoreMoreTabs                        ✅
extension deps 已接线 requestContinue / requestRestoreMore      ✅
```
**判定**: ✅ DEBT-004 协议上下游接通（HTML → Host → controller）

### Path 4: 读失败不丢索引（DEBT-006）— restoreOpenTabSet 段
```
readSessionLog throw
  → loadFailed.add(sessionId)
  → plan hasContent=true（失败行不空剔）                          ✅
  → 失败行移入 deferred；index.setOpenTabs(plan.indexSet)         ✅
  → persistOpenTabs 合并 deferred → openTabSet 保留失败行         ✅
  → 二次 restoreOpenTabSet（读成功）可 hydrate                    ✅
```
**判定**: ✅ 经 `restoreOpenTabSet` 的保留/重试路径连通

### Path 5: 读失败 +「查看更多」重试（DEBT-006 × DEBT-004）— 断裂
```
loadFailed 行在 deferredRestore；deferredRestoreCount>0
  → Webview「查看更多」→ action/restore-more → restoreMoreTabs
  → deferredRestore.shift()/splice(0) 先取出行                    ✅ 取出
  → openFromHistory → readSessionLog 再次失败 → outcome='error'
  → 未 push 回 deferredRestore；未写入 registry                   🔴
  → persistOpenTabs() = registry∪deferred（均无该 sessionId）
  → durable openTabSet **丢失**该未关 Tab                         🔴
Exit: 再次重启也恢复不了（索引已被缩水写回）
```
**判定**: 🔴 MUST-FIX — DEBT-004 把「查看更多」接到真实 UI 后，DEBT-006 的 deferred 行在 `restoreMoreTabs` 读失败时被消费丢弃，持久化路径断裂

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `persistOpenTabs`（合并 deferred） | registry/message watch / restore 末尾 | ✅ | `index.setOpenTabs` | ✅ |
| `openTabPersistSuspended` | `restoreOpenTabSetBody` | ✅ | 抑制 mid-batch persist | ✅ |
| `onStatusChange` → latch restore | `IdeSessionHost.status` setter | ✅ | `restoreOpenTabSet` | ✅ |
| `restoreInFlight` | `restoreOpenTabSet` | ✅ | 去重并发 auto-restore | ✅ |
| Webview `syncChrome` | `panel/state` | ✅ | 按钮显隐 | ✅ |
| `action/continue` | Continue 按钮 | ✅ | `requestContinue` → Continue | ✅ |
| `action/restore-more` | 查看更多按钮 | ✅ | `restoreMoreTabs` | ✅ |
| `loadFailed` → deferred | `restoreOpenTabSetBody` | ✅ | `persistOpenTabs` 合并 | ✅ |
| `restoreMoreTabs` 对失败行 | `action/restore-more` / L2 | ✅ | 失败后回填 deferred / 保留 index | 🔴 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host status → controller | `connected` 时若 latch 则 restore | `onStatusChange` + latch 重入 | ✅ |
| `panel/state` → Webview | `continue` + `deferredRestoreCount` | HTML `syncChrome` 消费 | ✅ |
| Webview → Host | `action/continue` / `action/restore-more` | protocol parse + ChatPanelHost | ✅ |
| Host → controller Continue | `requestContinue` | `continueConversation` | ✅ |
| Host → controller 查看更多 | `requestRestoreMore(all?)` | `restoreMoreTabs(all)` | ✅ |
| DEBT-006 失败行 | 保留 openTabSet直至成功 hydrate | `restoreMore` 失败后 persist 丢行 | 🔴 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `openFromHistory` / ExtensionIndex / hydrator | phase-2 | 复用；未改冻结语义 | ✅ |
| `session/read-log` / `session/resume` | phase-2 / 本 Phase GAP-001 | 仍连通 | ✅ |
| T-0b `same-id` Continue chrome | phase-0b | 顶栏经 Webview 接通 | ✅ |
| phase-1 Tab/registry `setMode` | phase-1 | Continue 原位升级仍用 | ✅ |

## 关键发现

### 🔴 Must-Fix
1. **`restoreMoreTabs` 在 `openFromHistory` 失败时丢弃 deferred 行并缩水 `openTabSet`**：`shift`/`splice` 后若 outcome 不是 `opened`/`activated`，行既不回队也不在 registry；随后 `persistOpenTabs()` 把该 session 从耐久索引抹掉。DEBT-004 已把「查看更多」接到真 Webview，使 DEBT-006 的失败行可经此路径永久丢失。应在失败（及 `host-not-ready` / `missing` 等非成功 outcome）时把 record 推回 `deferredRestore`（或跳过取出直到成功），并在回填后再 `persistOpenTabs`。

### 🟡 Should-Fix
- （无阻塞级优化项；主四债中 003/004/005 与 006 的 restore 段已接通。）

### 🟢 Observations
- DEBT-003：`persistOpenTabs` ∪ deferred + restore 批 suspend，二次冷启动路径有 vitest + V-IND-3 断言面。
- DEBT-005：`IdeSessionHost` status getter/setter 通知与 controller 订阅、`clearLocal` 解订均接线。
- DEBT-004：`buildThinChatHtml` 含 `continueBtn` / `restoreMoreBtn` + `syncChrome`；extension deps 已绑 `requestContinue` / `requestRestoreMore`。
- DEBT-006 经 **再次 `restoreOpenTabSet`** 的保留/重试仍通；断裂仅在「查看更多 → restoreMoreTabs」失败分支。
