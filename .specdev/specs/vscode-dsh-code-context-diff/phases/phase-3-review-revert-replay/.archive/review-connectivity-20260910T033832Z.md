# Connectivity Review — phase-3-review-revert-replay

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**MUST-FIX**

## 端到端路径追踪

### Path 1: mark-reviewed（AC-11）
```
Webview change-list row「已审阅」
  → post { type: 'change/mark-reviewed', changeId }
       │
    ▼
ChatPanelHost.handleMessage
  → deps.requestMarkReviewed(changeId)            ✅ protocol + host branch
       │
    ▼
extension.ts requestMarkReviewed
  → ConversationController.markChangeReviewed
       → ChangeStore.updateStatus(..., 'reviewed') ✅
       → MessageStore.patchChangeStatus(...)        ✅ 投影同步
       → persistChangeIndex → writeChangeIndex      ✅ 元数据落盘
       → panelHost.pushFullState()                  ✅ UI 回推
       ✗ 不调用 workspace write / SnapshotStore.write ✅ 无写盘副作用
Exit: status=reviewed；盘面不变
```
**判定**: ✅ 数据路径完整，起点到终点连通

### Path 2: 单文件 revert + 冲突/脏门禁拒绝（AC-13/14/15/17）
```
Webview「撤销」
  → change/revert { changeId }
       │
    ▼
Host → requestRevert → runRevertWithConfirms
  → analyzeChangeRevertGates → analyzeRevertGates
       gates: later-changes / delete-created / restore-conflict / dirty
  → confirmRevertGate → interaction-ui confirm*     ✅ 四类门禁接到 UI
  cancel any gate → { ok:false, reason:'cancelled' }
       → 不调用 executeRevert / writeText / deleteFile ✅ 取消无写盘
  confirm all → revertChange({ confirmedGates })
       → executeRevert
            created → workspace.deleteFile          ✅
            modified/deleted → SnapshotStore.read
              → oldText → workspace.writeText       ✅ read→write 连通
            snapshot missing → reason snapshot-unavailable，status 不变 ✅
       → success: ChangeStore status=reverted
            → patchChangeStatus + persistChangeIndex + pushFullState ✅
  → Host post change/revert-result → Webview banner ✅
```
**判定**: ✅ 成功与拒绝路径均连通；SnapshotStore.read 是撤销写回唯一正文来源

### Path 3: 批量 revert-many（AC-18 / AD-CCD-10）
```
Webview「撤销勾选」/「全部撤销」
  → change/revert-many { changeIds[] }
       │
    ▼
Host → requestRevertMany
  → controller.revertChanges(..., { confirmGate })
       → executeRevertMany
            orderChangeIdsForBatch (同 path turn DESC) ✅
            per-id: analyze gates → confirmGate → executeRevert
            逐项 RevertResult[]                        ✅
       → 成功项 patchChangeStatus + persistChangeIndex
  → change/revert-result { results[] } → banner 成功/失败计数 ✅
```
**判定**: ✅ 批量路径连通；倒序与逐项结果返回到 Webview

### Path 4: SnapshotStore 落盘读写（settle → revert / get-diff）
```
Live settleChangeListProjection
  → attributor.settleTurn → SnapshotStore.write(blob *.json) ✅
  → persistChangeIndex → <storageRoot>/changes/<sessionId>/index.json ✅
       │
    ▼
Revert / get-diff
  → SnapshotStore.read(sessionId, snapshotRef)
       present → oldText/newText 消费                 ✅
       missing/pruned → unavailable，不伪造正文       ✅
```
**判定**: ✅ 生产者→消费者磁盘链路连通（含 prune 后拒绝伪造）

### Path 5: openFromHistory hydrate change-list（AC-22 回放入口）
```
openFromHistory(sessionId)
  → hydrateFromAuthoritativeLog (text + timeline)
  → hydrateChangeListsFromIndex(sessionId)
       → readChangeIndex(storageRoot, sessionId)    ✅
       → ChangeStore.upsert*                        ✅
       → 注入 kind:'change-list' (+ diff-summary)   ✅ path+stats
  → panelHost.pushFullState()
```
**判定**: ✅ `openFromHistory` / `restoreMoreTabs`（经 openFromHistory）连通

### Path 6: 冷启动 restoreOpenTabSet（AC-22 冷启动入口）
```
AutoReady / reconnect → restoreOpenTabSetBody
  → loadEvents + hydrateFromAuthoritativeLog
  → messages.replace / timeline.replace
  → registry.create(replay tabs)
  ✗ 从未调用 hydrateChangeListsFromIndex            🔴
  ✗ ChangeStore 未从 index.json 回填                 🔴
  ✗ 无 change-list / path+stats 气泡                  🔴
Exit: 冷恢复 Tab 有对话正文，但变更列表数据面断裂
```
**判定**: 🔴 MUST-FIX — AC-22 验证策略要求「冷启动/回放 Tab 读索引」；回放入口已接，冷启动入口未接，端到端断裂

### Path 7: deleteConversation → clearSession（AD-CCD-6）
```
deleteConversation / deleteSession (confirmed)
  → attributor.clearSession → ChangeStore.clearSession ✅
  → snapshotStore.clearSession
       → rm(<storageRoot>/changes/<sessionId>/)      ✅
         （含 blob *.json + index.json）
Exit: 内存索引与磁盘会话目录一并清除
```
**判定**: ✅ 删除路径连通（exploration 缺口已闭合）

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `markChangeReviewed` | Host `requestMarkReviewed` | ✅ | `ChangeStore.updateStatus` + `patchChangeStatus` + `writeChangeIndex` | ✅ |
| `analyzeRevertGates` / `executeRevert` | `revertChange` / `executeRevertMany` | ✅ | `SnapshotStore.read` + `RevertWorkspace` | ✅ |
| `executeRevertMany` | Host `requestRevertMany` | ✅ | `orderChangeIdsForBatch` + `confirmGate` + `executeRevert` | ✅ |
| `confirmRevertGate` | `runRevertWithConfirms` / batch confirmGate | ✅ | `interaction-ui` 四确认 | ✅ |
| `createRevertWorkspace` | `wireChangePipeline` → `setRevertWorkspace` | ✅ | fs / WorkspaceEdit / textDocuments | ✅ |
| `writeChangeIndex` / `readChangeIndex` | settle / mark / revert / hydrate | ✅ | 磁盘 `index.json` | ✅ |
| `hydrateChangeListsFromIndex` | `openFromHistory` | ✅ | `ChangeStore` + `MessageStore` | ✅ |
| `hydrateChangeListsFromIndex` | `restoreOpenTabSetBody` | 🔴 | — | ❌ 未调用 |
| `SnapshotStore.clearSession` | `deleteConversation` / `deleteSession` | ✅ | `rm` session dir | ✅ |
| `pruneToBudget(isSessionFullyReverted)` | `pruneChangeSnapshots` | ✅ | `ChangeStore.isSessionFullyReverted` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host | `change/mark-reviewed \| revert \| revert-many` | `protocol.ts` parse + Host switch | ✅ |
| Host → extension | `requestMarkReviewed` / `requestRevert(Many)` | `createChatPanelHost` deps 已接线 | ✅ |
| Controller → revert | `RevertDeps` + `RevertWorkspace` | `setRevertWorkspace` 在 wire 时注入 | ✅ |
| revert → SnapshotStore | `read → { oldText }` | `SnapshotStore.read`；缺失返回 `undefined` | ✅ |
| Controller → MessageStore | `patchChangeStatus(sessionId, changeId, status)` | 就地 patch change-list rows | ✅ |
| settle / hydrate → index | 元数据 only，无 snapshot 明文 | `ChangeRecord[]` JSON；blob 分文件 | ✅ |
| 冷启动 → index | `restoreOpenTabSet` 应读 index 并注入列表 | 仅权威日志 hydrate，跳过 index | 🔴 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `ChangeStore` / `ChangeRecord` / `afterContentHash` | phase-2 | 已冻结；本 Phase 仅扩展 status API | ✅ |
| `SnapshotStore.write/read` + 全文件 blob | phase-2 | 已冻结；本 Phase 扩展 prune 优先序 + 消费者 revert | ✅ |
| `settleChangeListProjection` / change-list UI | phase-2 | 保留；叠加 mark/revert 协议与按钮 | ✅ |
| `get-diff` prune →「完整 diff 不可用」 | phase-2 | 未改契约；hydrate 后仍走同一 Host 路径 | ✅ |
| chat-ready AutoReady → `restoreOpenTabSet` | chat-ready / phase-2 | 入口仍在；本 Phase 未把 index hydrate 挂上 | 🔴 |

## 关键发现

### 🔴 Must-Fix
- **`restoreOpenTabSetBody` 未调用 `hydrateChangeListsFromIndex`**：AC-22 / N-4 要求冷启动与历史回放均从扩展 index 恢复 path+stats。`openFromHistory` 已接通，但 AutoReady/重连冷恢复走独立路径，只 fold 权威日志，导致 ChangeStore 空、无 change-list 气泡，后续 mark/revert/get-diff 在该 Tab 上也无法定位记录。应在每个成功 hydrate 的 session 上调用 `await this.hydrateChangeListsFromIndex(record.sessionId)`（与 `openFromHistory` 对称）。

### 🟡 Should-Fix
- （无独立 Should-Fix；冷启动缺口已升为 Must-Fix。）

### 🟢 Observations
- mark-reviewed / 单文件与批量 revert / 冲突取消 / SnapshotStore read→write / delete `clearSession` 链路均完整接线。
- `wireChangePipeline` 同时配置 attribution 读盘与 `createRevertWorkspace`，产品 Host 路径不会因 `revert-workspace-not-configured` 断裂。
- 会话删除通过 `attributor.clearSession` + `snapshotStore.clearSession` 同时清内存与 `changes/<sessionId>/`（含 `index.json`），闭合 exploration 所述 AD-CCD-6 缺口。

## 详细依据（call sites）
- Webview：`chat-panel-provider.ts` mark-reviewed / revert / revert-many
- Host：`chat-panel-host.ts` `change/mark-reviewed|revert|revert-many` → deps
- Extension：`requestMarkReviewed` / `runRevertWithConfirms` / `requestRevertMany` / `createRevertWorkspace`
- Controller：`markChangeReviewed` / `revertChange(s)` / `hydrateChangeListsFromIndex` / `deleteConversation`
- Domain：`change/revert.ts` · `change-index.ts` · `snapshot-store.ts` · `change-store.ts`
