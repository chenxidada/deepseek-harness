# 连通性审查 — phase-3-review-revert-replay（Should-Fix polish 复审）

## 视角
**集成连通性（Integration Connectivity）** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### 路径 1：mark-reviewed（AC-11）— 无回归
```
Webview「已审阅」
  → post { type: 'change/mark-reviewed', changeId }
       │
    ▼
ChatPanelHost → deps.requestMarkReviewed
  → ConversationController.markChangeReviewed
       → ChangeStore.updateStatus(..., 'reviewed') ✅
       → MessageStore.patchChangeStatus              ✅
       → persistChangeIndex → writeChangeIndex       ✅
       → panelHost.pushFullState()                   ✅
       ✗ 不调用 workspace write / SnapshotStore.write ✅
Exit: status=reviewed；盘面不变
```
**判定**: ✅ 起点到终点连通；polish 未改此链路

### 路径 2：单文件 revert + 门禁（AC-13/14/15/17）— 无回归
```
Webview「撤销」
  → change/revert
       │
    ▼
Host → requestRevert → runRevertWithConfirms
  → analyzeChangeRevertGates → confirmRevertGate
  cancel → { ok:false, reason:'cancelled' }；无 write ✅
  confirm → revertChange → executeRevert
       created → deleteFile
       modified/deleted → SnapshotStore.read(oldText) → writeText ✅
       write throw → write-failed:${sanitizeReason(...)}；status 不变 ✅
  → Host post change/revert-result → Webview banner ✅
```
**判定**: ✅ 成功/取消/写失败路径均连通；SnapshotStore.read 仍是写回唯一正文来源

### 路径 3：revert-many + write-fail 混批（AC-18 / AD-CCD-10）— polish 焦点
```
Webview「撤销勾选」/「全部撤销」
  → change/revert-many { changeIds[] }
       │
    ▼
Host → requestRevertMany
  → controller.revertChanges(..., { confirmGate })
       → executeRevertMany
            orderChangeIdsForBatch（同 path turn 倒序）✅
            per-id: analyze → confirmGate → executeRevert
            一 path writeText throw → { ok:false, reason:'write-failed:…' }
              ✗ 不 upsert status；继续下一项                        ✅ 不短路整批
            另一 path 成功 → status=reverted                          ✅
       → 仅 ok 项：patchChangeStatus + persistChangeIndex + pushFullState ✅
       → 失败项保持原 status / 原盘面                                  ✅
  → change/revert-result { results[] per-id ok|reason }
       → Webview banner「成功 N / 失败 M」                             ✅
```
**判定**: ✅ 混批写失败端到端连通；逐项结果回传到 Host/Webview；成功与失败状态/盘面隔离

### 路径 4：sanitizeReason → 失败 reason 出口（AC-24 接线）
```
executeRevert catch(Error.message)
  → sanitizeReason(raw)
       短码直通 / 内容型·超长 → 'io-error'
  → reason = `write-failed:${sanitized}`
       │
    ▼
RevertResult → revertChange(s) → Host map → change/revert-result
  （正文片段不进入 reason 出口）
```
**判定**: ✅ 写失败诊断出口与 Host 协议契约连通；`change/index.ts` 再导出供 L2 断言

### 路径 5：SnapshotStore settle → revert / get-diff
```
settleTurn → SnapshotStore.write(blob)
  → persistChangeIndex（仅元数据）
Revert / get-diff → SnapshotStore.read
  missing/pruned → unavailable，不伪造 ✅
```
**判定**: ✅ 生产者→消费者磁盘链路仍连通

### 路径 6：openFromHistory hydrate（AC-22）
```
openFromHistory
  → hydrateFromAuthoritativeLog
  → hydrateChangeListsFromIndex → readChangeIndex
       → ChangeStore.upsert* + 注入 change-list path+stats ✅
```
**判定**: ✅ 无回归

### 路径 7：冷启动 restoreOpenTabSet（AC-22）
```
restoreOpenTabSetBody
  → await hydrateChangeListsFromIndex(record.sessionId) ✅
```
**判定**: ✅ 与 openFromHistory 对称；无回归

### 路径 8：prune / delete（AD-CCD-6）
```
settle → pruneChangeSnapshots(isSessionProtected) ✅
deleteConversation → clearSession + rm session dir ✅
```
**判定**: ✅ 无回归

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `markChangeReviewed` | Host `requestMarkReviewed` | ✅ | `updateStatus` + `patchChangeStatus` + `writeChangeIndex` | ✅ |
| `executeRevert`（写失败） | `revertChange` / `executeRevertMany` | ✅ | `sanitizeReason` → `RevertResult`（不改 status） | ✅ |
| `executeRevertMany` | Host `requestRevertMany` | ✅ | per-id `executeRevert`；批内继续 | ✅ |
| `sanitizeReason` | `executeRevert` catch | ✅ | reason 字符串出口 / `index` 再导出 | ✅ |
| `revertChanges` 成功侧 | `executeRevertMany` ok 项 | ✅ | MessageStore + index + pushFullState | ✅ |
| `hydrateChangeListsFromIndex` | `openFromHistory` / `restoreOpenTabSetBody` | ✅ | `readChangeIndex` → ChangeStore + MessageStore | ✅ |
| `createRevertWorkspace` | `wireChangePipeline` | ✅ | `setRevertWorkspace` → FS/文档写面 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host | `mark-reviewed` / `revert` / `revert-many` | protocol parse + Host switch | ✅ |
| Host → extension | `requestMarkReviewed` / `requestRevert(Many)` | `createChatPanelHost` deps 已接线 | ✅ |
| Host ← revert-many | `ReadonlyArray<{changeId, ok, reason?}>` | controller `RevertResult[]` 映射保留 reason | ✅ |
| Host → Webview | `change/revert-result.results[]` | protocol 类型含 per-id reason；banner 聚合计数 | ✅ |
| executeRevert → status | 写失败不改 status | catch 在 upsert 前 return | ✅ |
| revertChanges → MessageStore | 仅成功项 patch | `if (!result.ok) continue` | ✅ |
| settle/hydrate → index | 仅元数据 | `ChangeRecord[]`；blob 分文件 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `ChangeStore` / `afterContentHash` | phase-2 | 冻结；本 Phase 扩展 status API | ✅ |
| `SnapshotStore.write/read` | phase-2 | 冻结；revert 为消费者 | ✅ |
| change-list UI / get-diff | phase-2 | 叠加 mark/revert；契约未破 | ✅ |
| AutoReady → `restoreOpenTabSet` | chat-ready | 仍挂 index hydrate | ✅ |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）— AC-18 write-fail 混批与 `sanitizeReason` 硬化均已接到既有 Host/Webview 出口，无新增断链。

### 🟢 Observations
- polish 仅触及 `revert.ts`（`sanitizeReason`）+ 再导出 + L2；mark / 单文件 revert / hydrate / prune / delete 接线未动。
- 混批写失败：`executeRevertMany` 不因单 path throw 中止后续项；失败 reason 经 Host 原样进入 `change/revert-result`；成功项才 patch/persist/push。
- Webview banner 以成功/失败计数呈现混态；行级 status 经 `pushFullState` 反映成功项 `reverted`、失败项仍 `unreviewed`。
- L2：`AC-18: same-batch write throw + success` + Host mark/revert routing + cold hydrate 覆盖关键 call site。

## 详细依据（call sites）
- Domain：`change/revert.ts` `executeRevert` catch → `sanitizeReason`；`executeRevertMany` 顺序循环
- Controller：`revertChanges` 仅 ok 项 patch/persist；`markChangeReviewed`；`hydrateChangeListsFromIndex` @ openFromHistory / restoreOpenTabSetBody
- Host/UI：`chat-panel-host.ts` mark/revert/revert-many；`chat-panel-provider.ts` 按钮 + `change/revert-result` banner
- Extension：`requestRevertMany` reason 映射；`wireChangePipeline` → `createRevertWorkspace`
- L2：`phase3-review-revert-replay.spec.ts` — write-fail 混批、sanitizeReason、Host routing、cold hydrate
