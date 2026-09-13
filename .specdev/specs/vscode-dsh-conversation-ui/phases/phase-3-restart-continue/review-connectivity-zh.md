# 连通性审查 — phase-3-restart-continue（MUST-FIX loop2 复审）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### 路径 1: `restoreMoreTabs` 读失败 → deferred 回队 → persist 保留 openTabSet（本轮 MUST-FIX）
```
入口: deferredRestore 含 sess-more；「查看更多」/ L2 restoreMoreTabs()
  → deferredRestore.shift() 取出 record                    ✅
  → openFromHistory(sess-more)
       readSessionLog throw → outcome='error'（无 registry 写入） ✅
  → outcome ∉ {opened, activated}
       → deferredRestore.push({ ...record })               ✅ 回队
  → persistOpenTabs()
       registry（sess-ui 有内容）∪ deferredRestore（sess-more） ✅
       → index.setOpenTabs → writeImmediate(workspaceState) ✅
  → panelHost.pushFullState
       deferredRestoreCount=1 → Webview 仍显示「查看更多」   ✅

二次冷启动:
  new ConversationController(同一 workspaceState)
  → ExtensionIndex 读 openTabSet 仍含 sess-more + sess-ui   ✅
  → restoreOpenTabSet → hydrated/deferred 覆盖两 session    ✅
```
**判定**: ✅ 上轮路径 5 断裂已接通；失败行不再被 `persistOpenTabs` 从耐久索引抹掉；二次冷启动仍见 session

### 路径 2: Webview「查看更多」→ Host → `restoreMoreTabs`（DEBT-004 × DEBT-006）
```
panel/state { deferredRestoreCount } → syncChrome 显示按钮   ✅
点击 → postMessage { type:'action/restore-more' }            ✅
ChatPanelHost → requestRestoreMore → restoreMoreTabs()       ✅
extension deps 已绑 requestRestoreMore                       ✅
失败分支走路径 1 回队+persist                                ✅
```
**判定**: ✅ UI 入口与失败保留路径串联完整

### 路径 3: `restoreOpenTabSet` 段读失败保留（DEBT-006 原路径）
```
readSessionLog throw → loadFailed → 不空剔 → deferred
  → persistOpenTabs 合并 deferred → openTabSet 保留          ✅
二次 restoreOpenTabSet（读成功）可 hydrate                   ✅
```
**判定**: ✅ 仍连通（未回退）

### 路径 4: 二次重启仍见 deferred 全量（DEBT-003）
```
N=1 恢复 → deferred 保留 → persist ∪ deferred
二次冷启动 openTabSet.length 不缩水                          ✅
```
**判定**: ✅ 仍连通

### 路径 5: Host connected → latch 自动 restore（DEBT-005）
```
waiting-host + pendingRestoreLatch
  → status=connected → onStatusChange → restoreOpenTabSet    ✅
```
**判定**: ✅ 仍连通

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `restoreMoreTabs` 失败回填 | `action/restore-more` / L2 / `dsh.restoreMoreTabs` | ✅ | `deferredRestore.push` → `persistOpenTabs` | ✅ |
| `persistOpenTabs` ∪ deferred | restoreMore / restore / registry 变更 | ✅ | `index.setOpenTabs` → `writeImmediate` | ✅ |
| `openFromHistory` error outcome | `restoreMoreTabs` | ✅ | 无 registry 写入；调用方回队 | ✅ |
| `panel/state.deferredRestoreCount` | `pushFullState` after restoreMore | ✅ | Webview `syncChrome` | ✅ |
| 二次冷启动读 index | 新 `ConversationController` | ✅ | `restoreOpenTabSet` 消费 openTabSet | ✅ |
| Webview → Host restore-more | 查看更多按钮 | ✅ | `requestRestoreMore` | ✅ |
| Host status → latch restore | `IdeSessionHost` setter | ✅ | `restoreOpenTabSet` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| `restoreMoreTabs` ← `openFromHistory` | 非成功 outcome 可区分 | `error` / `host-not-ready` / `missing` | ✅ |
| DEBT-006 失败行 | 保留 openTabSet 直至成功 hydrate | 失败 push 回 deferred 后再 persist | ✅ |
| `persistOpenTabs` → ExtensionIndex | 立即写 workspaceState | `setOpenTabs` → `writeImmediate` | ✅ |
| Host → controller 查看更多 | `requestRestoreMore(all?)` | `restoreMoreTabs(all)` | ✅ |
| `panel/state` → Webview | `deferredRestoreCount` | HTML `syncChrome` 消费 | ✅ |
| 冷启动 ← workspaceState | 同 mem/state 可读回完整 openTabSet | ExtensionIndex load + restore | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `openFromHistory` / ExtensionIndex / hydrator | phase-2 | 复用；失败 outcome 契约未破 | ✅ |
| `session/read-log` / `session/resume` | phase-2 / GAP-001 | 仍连通 | ✅ |
| Tab/registry `setMode`（Continue） | phase-1 | 原位升级路径未断 | ✅ |
| T-0b Continue chrome | phase-0b | 顶栏经 Webview 仍接通 | ✅ |

## 关键发现

### 🔴 Must-Fix
- （无）上轮 MUST-FIX（`restoreMoreTabs` 失败丢 deferred / 缩水 openTabSet）已修复并联通；回归用例覆盖「失败回队 → index 仍含两行 → 二次冷启动仍见 sess-more」。

### 🟡 Should-Fix
- （可选）`restoreMoreTabs(all=true)` 批处理中，成功行的 `openFromHistory` 会**中途**调用 `persistOpenTabs()`，此时尚未处理完的 `take` 行既不在 `deferredRestore` 也不在 registry，耐久 `openTabSet` 会短暂缩水；若进程在最终 `persistOpenTabs` 前崩溃可能丢行。产品 Webview 默认发无 `all` 的单行「查看更多」，主路径不受影响。可考虑：批内 suspend persist，或成功路径跳过内嵌 persist、仅在循环末统一写。

### 🟢 Observations
- DEBT-006 登记已注明 `restoreMoreTabs` 失败回填；implementation 与 vitest 回归一致。
- DEBT-003/004/005 与 DEBT-006 的 `restoreOpenTabSet` 段在本轮未回退，上下游仍完整。
- 失败回队使用 `{ ...record }` 浅拷贝，sessionId/tabId 契约与 persist 合并去重一致。
