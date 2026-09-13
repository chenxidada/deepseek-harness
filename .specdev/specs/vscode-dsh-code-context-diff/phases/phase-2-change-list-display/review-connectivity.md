# Connectivity Review — phase-2-change-list-display

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

> Re-review after MUST-FIX loop (2026-09-10). Prior Must-Fix breaks on AC-12a / AC-19 / AC-30 are closed in live code: primary click → `change/open` with separate expand; `change/reveal-source` → `pushRevealSource` → `scroll/reveal-source`; AC-30 `sourceMessageId` identity end-to-end.

## 端到端路径追踪

### Path 1: AC-12a — 主键单击打开文件（与 Diff 展开分离）
```
Entry: Webview .change-list-item click
  → chat-panel-provider.ts (~654-659)
       postMessage { type: 'change/open', changeId, path }
  → chat-panel-host.ts (~490-492)
       requestChangeOpen?.(changeId, path)
  → extension.ts (~1131-1132)
       openChangedPath(vscode, changeId, path)
Exit: editor open (locate first changed line when snapshot known)

Parallel expand (AC-12, not primary click):
  → .change-list-expand click (~661-686)
       postMessage { type: 'change/get-diff', changeId }
  → host (~476-487) → extension requestChangeDiff (~1111-1129)
       SnapshotStore.read → change/diff-content
  → provider (~930+) pane update by data-change-id
```
**判定**: ✅ 完整连通。主键单击只发 `change/open`；`change-list-expand` 独立发 `change/get-diff`。L2: `AC-12a: primary click posts change/open…` / `change/open parses and invokes open hook`。

### Path 2: AC-19 — 变更「来源」→ 助手气泡
```
Entry: Webview「来源」.change-list-reveal-source click
  → provider (~695-700)
       postMessage { type: 'change/reveal-source', sourceMessageId }
  → host (~494-496)
       requestRevealSource?.(sourceMessageId)
  → extension.ts (~1134-1139)
       panelHost.pushRevealSource(sessionId, sourceMessageId)
         ※ 明确不调用 pushRevealChangeList
  → host.pushRevealSource (~333-338)
       post { type: 'scroll/reveal-source', sourceMessageId }
  → provider (~916-927)
       querySelector('[data-message-id="' + sourceMessageId + '"]')
       → scrollIntoView + is-revealed
Exit: assistant bubble revealed
```
**判定**: ✅ 完整连通。协议 `scroll/reveal-source` / `change/reveal-source` 契约一致。L2: `AC-19: change→source posts reveal-source…` 断言 Host 推 `scroll/reveal-source` 且**不**推 `scroll/reveal-change-list`。

### Path 3: AC-30 — diff-summary 点击 reveal 对应 change-list
```
Entry: settle 投影（Controller）
  → conversation-controller.ts (~1152-1161)
       diff-summary 写入 sourceMessageId（与 change-list payload 同源）
  → provider (~598-612)
       data-source-message-id；click post
       { type: 'action/reveal-change-list', sourceMessageId }
  → host (~472-474)
       requestRevealChangeList?.(sourceMessageId)
  → extension.ts (~1095-1109)
       reverse().find change-list where
         changeList.sourceMessageId === sourceMessageId
       pushRevealChangeList(sessionId, id, list?.id)
  → host.pushRevealChangeList (~319-325)
       scroll/reveal-change-list { sourceMessageId, messageId? }
  → provider (~897-914)
       prefer [data-message-id] / [data-kind=change-list][data-source-message-id]
Exit: corresponding change-list scrolled into view
```
**判定**: ✅ 完整连通。身份从 Controller 投影 → Webview post → Host 过滤 → Webview scroll。L2: `AC-30: diff-summary click carries sourceMessageId…` 验证不会误选最新列表。

### Path 4: change/get-diff 按需 diff（配套 AC-12）
```
Entry: expandBtn → change/get-diff
  → host → requestChangeDiff → SnapshotStore
  → change/diff-content → pane[data-change-id] textContent
```
**判定**: ✅ 上下游闭环（写 pane 有消费者；无 snapshot 时 available:false + reason 回填）。

### Path 5: 入账 → change-list 投影（回归，本轮未回归断链）
```
Entry: tool/result meta.diffs → attributor → settleTurn
  → MessageStore kind:change-list (+ N>0 diff-summary)
  → pushFullState → Webview renderBubble
```
**判定**: ✅ 主投影路径仍连通；N=0 emptyNotice 且不注入 diff-summary。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `change-list-item` click → `change/open` | Webview 用户点击 | ✅ | `requestChangeOpen` → `openChangedPath` | ✅ |
| `change-list-expand` → `change/get-diff` | Webview Diff 控件 | ✅ | `requestChangeDiff` → `change/diff-content` | ✅ |
| `change-list-reveal-source` → `change/reveal-source` | Webview「来源」 | ✅ | `requestRevealSource` → `pushRevealSource` | ✅ |
| `scroll/reveal-source` handler | Host `pushRevealSource` | ✅ | `[data-message-id]` scroll | ✅ |
| `diff-summary-entry` → `action/reveal-change-list` | Webview 摘要点击 | ✅ | `requestRevealChangeList`（按 id 过滤） | ✅ |
| `pushRevealChangeList` | extension `requestRevealChangeList` | ✅ | `scroll/reveal-change-list` Webview | ✅ |
| `settleChangeListProjection` `sourceMessageId` | attributor settle | ✅ | change-list payload + diff-summary 消息字段 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host `change/open` | `{ changeId, path }` | host 转发 `requestChangeOpen(changeId, path)` | ✅ |
| Webview → Host `change/reveal-source` | `{ sourceMessageId: string }` | protocol parse 要求 string；host → `requestRevealSource` | ✅ |
| Host → Webview `scroll/reveal-source` | `{ sessionId, sourceMessageId }` | provider 用 `data-message-id` 定位助手气泡 | ✅ |
| Webview → Host `action/reveal-change-list` | optional `sourceMessageId` | extension 按 `changeList.sourceMessageId` 过滤 | ✅ |
| Controller → MessageStore | `diff-summary.sourceMessageId` | `ChatMessage.sourceMessageId?` + HTML `data-source-message-id` | ✅ |
| Host → Webview `change/diff-content` | `changeId` + texts / reason | provider 按 `data-change-id` 写 pane | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Chat panel Host ↔ Webview protocol / MessageStore | chat-ready / phase-1 基线 | 本 Phase **扩展**（新增 change/*、scroll/reveal-source），未破坏既有 send/scroll | ✅ |
| Timeline / AC-30 摘要入口语义 | chat-ready | 点击目标从 Timeline-only 收口为 reveal change-list（AD-CCD-4） | ✅ |
| Phase-0 spike attribution / SnapshotStore 契约 | phase-0 | settle → SnapshotStore → get-diff 消费 | ✅ |
| Phase-3 revert / mark-reviewed | — | 未接线（预期 out of scope） | ✅ N/A |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无 — 先前三项 Must-Fix / 两项 Should-Fix 对应连通缺口均已在 live 代码闭合）

### 🟢 Observations
- `provider.ts`：无 `payload.sourceMessageId` 时「来源」early-return — 防御守卫，非断链。
- `provider.ts`：`scroll/reveal-change-list` 在无 messageId/sourceMessageId 命中时回退到第一个 change-list — 仅无身份兜底；AC-30 主路径已带 identity，不构成断裂。
- L2 `phase2-change-list-display.spec.ts` 对 AC-12a / AC-19 / AC-30 均有 HTML 契约 + Host 往返断言，与上述 call site 一致。
- 多 assistant re-anchor 现会回写 `ChangeRecord.sourceMessageId`（Should-Fix 强化），与列表锚点保持一致。
