# Connectivity Review — phase-6-session-search

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: 档 1 searchSessions（title / firstUserPreview）
```
User first prompt
  → ConversationController.promptTab()
    → titleFromFirstMessage / preview(80)
    → ExtensionIndex.upsertSession({ title, firstUserPreview, … })   ✅ 元数据写入
  → Entry: dsh.searchSessions | action/search-sessions { text }
    → extension / ChatPanelHost.requestSearchSessions
      → controller.searchSessions({ text })
        → runSessionSearch(index, pathSessionIndex, query)
          → ExtensionIndex.listHistorySessions()                   ✅ 只读索引行
          → matchTier1Field(row, text) → 'title' | 'firstUserPreview'
          → SearchHit { matchTiers:[1], matchField }               ✅
          ✗ 不调用 messages.get / readSessionLog / JSONL            ✅ AC-53
Exit: QuickPick 列表 | Host post search/results { hits }
```
**判定**: ✅ 档 1 从索引字段到命中完整连通；无正文扫描旁路

### Path 2: 档 2 path 索引写 → 查
```
Change 归因 settle / mark-reviewed / revert …
  → ConversationController.persistChangeIndex(sessionId)
       ├─ writeChangeIndex(…/index.json)                         ✅ Change 元数据
       └─ pathSessionIndex.replaceSessionPaths(sessionId, paths) ✅ 反查同步
            → workspaceState key dsh.pathSessionIndex              ✅ 持久化

Entry: searchSessions({ path }) | path:… 命令输入
  → PathSessionIndex.queryByPath(normalizeSearchPath(path))
  → 过滤 isDeleted / 非删除 index 行
  → SearchHit { matchTiers includes 2, matchedPath }
Exit: 命中 sessionIds
```
**判定**: ✅ 写（persist）→ 持久化 → 查（queryByPath）连通；产品 Change 写入唯一出口 `persistChangeIndex` 已挂接

### Path 3: openSearchHit → openFromHistory（不 Start）
```
Entry: QuickPick 选中 | action/open-search-hit { sessionId }
  → controller.openSearchHit(sessionId)
    → openFromHistory(sessionId)                                 ✅ 直接委托
         ├─ 已有 Tab → switchConversation (activate)             ✅
         └─ 否则 hydrate authority log → registry.create(..., 'replay')
  → 不调用 IdeSessionHost.start                                  ✅ AC-52
Exit: activated | opened (replay)
```
**判定**: ✅ 打开路径复用历史/回放；命令与协议两入口均接到同一方法

### Path 4: 删除 / 写入同步索引
```
deleteConversation / deleteSession (confirmed)
  → changes.clearSession
  → pathSessionIndex.removeSession(sessionId)                    ✅
  → index.markDeleted
  → 后续 searchSessions({ path }) 跳过 deleted + 无该 session 行  ✅

persistChangeIndex（settle / reviewed / revert 等）
  → replaceSessionPaths（含空 paths 时从旧 path 行摘除）         ✅
```
**判定**: ✅ 删除与写入均更新档 2；无「只清 ExtensionIndex、残留 path 行」的断裂

### Path 5: 协议 / 命令 / Host 接线
```
package.json contributes dsh.searchSessions                      ✅
extension.ts registerCommand → searchSessions → openSearchHit    ✅
README Query/browse 矩阵含 dsh.searchSessions（≠ Start）         ✅

protocol: action/search-sessions | action/open-search-hit
        + Host→W search/results                                  ✅ parse 完整
ChatPanelHostDeps.requestSearchSessions / requestOpenSearchHit   ✅
extension Panel Host deps 注入 → controller                      ✅
```
**判定**: ✅ 命令面板与 Webview 协议双入口接到 Controller；契约形状（hits 字段）一致

### Path 6: 无档 3 / 无正文扫描（否定路径）
```
search/ 模块：仅 ExtensionIndex + PathSessionIndex
TIER3_FULL_TEXT_SEARCH_API = null                                ✅
无 searchFullText / scanJsonlBodies / searchMessageBodies 导出   ✅
searchSessions 不读 MessageStore / 权威 JSONL / snapshot blob    ✅
```
**判定**: ✅ 否定路径成立；无静默正文库旁路冒充搜索

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `searchSessions` (helper) | `ConversationController.searchSessions` | ✅ | `ExtensionIndex.listHistorySessions` + `PathSessionIndex.queryByPath` | ✅ |
| `ConversationController.searchSessions` | `dsh.searchSessions` / Host `requestSearchSessions` | ✅ | `runSessionSearch` | ✅ |
| `openSearchHit` | 命令 QuickPick / `requestOpenSearchHit` | ✅ | `openFromHistory` | ✅ |
| `PathSessionIndex.replaceSessionPaths` | `persistChangeIndex` | ✅ | `workspaceState.update(dsh.pathSessionIndex)` | ✅ |
| `PathSessionIndex.removeSession` | `deleteConversation` / `deleteSession` | ✅ | 同上持久化 | ✅ |
| `PathSessionIndex` ctor | `ConversationController` ctor（同 workspaceState） | ✅ | 冷读 `dsh.pathSessionIndex` | ✅ |
| Host `action/search-sessions` | Webview postMessage | ✅ | `search/results` post | ✅ |
| Host `action/open-search-hit` | Webview | ✅ | `openSearchHit` → history/replay | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host → Controller.searchSessions | `{ text?, path? }` → hits 元数据 | `SearchQuery` → `SearchHit[]`（含 matchTiers/matchField/matchedPath） | ✅ |
| Host search/results ↔ SearchHit | protocol hits 字段 | SearchHit 同形直接 post | ✅ |
| openSearchHit → openFromHistory | 激活/回放，不 Start | 方法体无 `host.start`；层 B spy 确认 | ✅ |
| persistChangeIndex → PathSessionIndex | ChangeRecord.path[] | `records.map(r => r.path)` + `normalizeSearchPath` | ✅ |
| 档 1 → ExtensionIndex | title / firstUserPreview | `SessionIndexEntry` + `listHistorySessions` 透出 | ✅ |
| 档 3 API | 不存在 | `TIER3_FULL_TEXT_SEARCH_API = null`；无正文扫描导出 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| ExtensionIndex `title` / `firstUserPreview` | chat-ux foundation / 既有 index | 已实现，只读查询 | ✅ |
| `openFromHistory`（activate / replay） | conversation-ui / 既有 Controller | 未改签名；直接委托 | ✅ |
| Change `index.json` + `ChangeRecord.path` | code-context-diff | `persistChangeIndex` 统一写出并派生反查 | ✅ |
| 自动 Start 矩阵 Query/browse | phase-1 | `dsh.searchSessions` 已归入矩阵 | ✅ |
| agent-loop / MessageStore 正文 | — | **未**接入搜索（正确） | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）— 冷启动不扫全量 change `index.json` 回填 path 索引为 implementation 已记录的设计选择；spec 要求「写入/删除时维护」，产品写入出口已挂接，不构成端到端断裂。

### 🟢 Observations
- `hydrateChangeListsFromIndex`（打开回放时）只灌 ChangeStore，不反写 `PathSessionIndex`；档 2 依赖 workspaceState 增量。Phase 6 上线后新 settle/persist 路径会填满索引；升级前仅有磁盘 change index、无 path 快照的旧会话，在再次 persist 前可能 path 搜不到——可接受，非本 Phase 契约断裂。
- 搜索 Webview DOM 未做；协议与命令面板已接通，符合 spec「搜索 UI **或** 命令面板」。
- `ChatPanelHostDeps.requestSearchSessions` 为可选；缺省返回 `[]`。生产 `extension.ts` 已注入，测试亦显式接线。

## 层 B 连通性证据（对照）

| AC | 测试 | 连通断言 |
|----|------|---------|
| AC-50 | `chat-ux-session-search.spec.ts` | title/preview 命中；body-only 空；`messages.get` spy 未调用 |
| AC-51 | 同上 | mark-reviewed → path 命中；delete 后反查更新 |
| AC-52 | 同上 + 协议用例 | `openSearchHit` / `action/open-search-hit` 不调用 `Host.start` |
| AC-53 | 同上 | `TIER3_*=null`；无全文导出 |

---

**Verdict: PASS**  
**Output:** `.specdev/specs/vscode-dsh-chat-ux/phases/phase-6-session-search/review-connectivity.md`
