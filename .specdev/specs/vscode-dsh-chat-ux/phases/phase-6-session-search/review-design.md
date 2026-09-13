# Design Consistency Review — phase-6-session-search

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md / constitution 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CUX-9** 档 1 = `title` + `firstUserPreview` | 是 | `session-search.ts` `matchTier1Field` 仅匹配这两字段；命中带 `matchField` | ✅ |
| **AD-CUX-9** 档 2 = path→session 反查，变更 index 派生，不建正文库 | 是 | `PathSessionIndex` + `persistChangeIndex` → `replaceSessionPaths(records.map(r => r.path))`；无 blob/正文入库 | ✅ |
| **AD-CUX-9** 打开走历史/回放/已有 Tab，不 Start | 是 | `openSearchHit` → `openFromHistory`；命令/协议同路径；README Query/browse | ✅ |
| **AD-CUX-9** 拒绝扫 JSONL 正文冒充 | 是 | `search/` 无 MessageStore/JSONL 依赖；`TIER3_FULL_TEXT_SEARCH_API = null` | ✅ |
| **§7.3** 搜索至多档 1+2；无档 3 / 第二正文库 | 是 | 仅 tier 1\|2 API；显式无档 3 出口 | ✅ |
| **§7.3** 不做 thinking / 不改 agent-loop / 不拆第二 slug | 是 | 本 Phase 未引入 thinking UI；未改 agent-loop；改动限于 vscode-dsh 搜索接线 | ✅ |
| **§7.2** 决策态留 Host | 是 | 查询与打开均在 Host（`ConversationController` / 命令 / `action/search-sessions`）；无 Webview 裁决 sessionId/Start | ✅ |
| **§7.1** 层 A（本 Phase 无新呈现 DOM） | 是 | 入口为命令面板 + 协议；未新增需层 A 的搜索页 DOM（符合 spec「UI **或** 命令面板」） | ✅ |
| Host API `searchSessions(query)` | 是 | `ConversationController.searchSessions` 委托 `runSessionSearch` | ✅ |
| W→H `action/search-sessions` | 是 | `protocol.ts` + `chat-panel-host.ts` → `search/results` | ✅ |
| 文件计划 `src/search/path-session-index.ts` | 是 | 新建该模块；另增 `session-search.ts` / `index.ts` 作查询面（职责清晰） | ✅ |
| 索引维护：写入/删除会话时更新 | 是 | `persistChangeIndex` 同步；`deleteConversation` / `deleteSession` → `removeSession` | ✅ |
| Out：fork 产品 / 流式·活动项 | 是 | 未改 fork 编排语义、未改 `messages/patch`/活动流产品路径；搜索模块无 fork/streaming 依赖 | ✅ |
| Fork 空桶不拷贝父 Change → 不发明父 path 到 child | 是 | 反查仅随本 session `ChangeRecord.path` 写入；fork 仍空桶，不拷贝父 index | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `path-session-index.ts` | `apps/vscode-dsh/src/search/` | ✅ | 与 design 文件计划一致；元数据反查独立于 `change/` session 桶 |
| `session-search.ts` | `apps/vscode-dsh/src/search/` | ✅ | 档 1+2 查询面；不读正文 |
| `index.ts` | `apps/vscode-dsh/src/search/` | ✅ | 包导出 |
| `chat-ux-session-search.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 层 B Host 套件，符合既有 chat-ux-* 命名 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件名 | kebab-case (`path-session-index.ts`) | 既有 vscode-dsh 惯例 | ✅ |
| `PathSessionIndexEntry` | 与 design 类型一致（path / sessionIds / mtime） | design 数据模型 | ✅ |
| 持久化键 | `dsh.pathSessionIndex` | 对齐 `dsh.conversationIndex` 风格 | ✅ |
| 命令 | `dsh.searchSessions` | `dsh.*` 命令族 | ✅ |

### Constitution §2 / §7 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | search = 索引/查询；Host = 打开编排 | ✅ | `PathSessionIndex` 不打开会话；`openSearchHit` 薄委托 `openFromHistory` |
| §2.2 依赖方向 | search 不依赖外围 Webview/agent-loop | ✅ | 仅依赖 `ExtensionIndex` 类型 + 自身索引 |
| §2.3 接口隔离 | Host API / 协议 / 命令入口清晰 | ✅ | |
| §7.3 | 无档 3 | ✅ | 见上表 |
| §7.4 | fork/流式假设 | ✅ | 本 Phase 未推翻；未越界重做 fork/流式 |

### 档 1 / 2 / 3 边界（重点）

| 档 | 设计要求 | 实现 | 判定 |
|----|---------|------|:--:|
| 档 1 | ExtensionIndex 元数据字段 | `listHistorySessions` + `matchTier1Field` | ✅ |
| 档 2 | Change 元数据派生 path→session | `PathSessionIndex` + persist/delete 钩子 | ✅ |
| 档 3 | **禁止** | 无全文 API；`TIER3_FULL_TEXT_SEARCH_API = null` | ✅ |

### 未越界检查（fork / 流式）

| 边界 | 期望 | 结果 |
|------|------|------|
| fork 产品（phase-5） | 不改 P-接续/P-标明/E2 语义 | ✅ 仅在既有 controller 上挂索引维护；无新 fork 产品路径 |
| 流式 / 活动项 | 不改 patch/activity | ✅ `search/` 无相关符号；implementation 未列 agent-loop / MessageStore 正文扫描改动 |
| Start 矩阵 | 搜索属 Query/browse | ✅ README 已归类；打开复用 `openFromHistory` |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）— 冷启动未全量扫各 session `change/index.json` 属实现选择，与 design「durable reverse index」及 exploration「prefer durable」一致；写入/删除路径已同步，不构成架构违反。

### 🟢 Observations
- 协议增量含 `action/open-search-hit` 与 H→W `search/results`（design 表仅显式列出 `action/search-sessions`）——属于打开路径的合理补全，不破坏 AD-CUX-9。
- 未做独立 Webview 搜索页 DOM；命令面板 + 协议满足 spec「搜索 UI **或** 命令面板」。
- 档 2 派生挂在 `ConversationController.persistChangeIndex`，而非直接改 `change/*` 文件——仍从 Change 元数据派生，模块边界优于把反查塞进 session-scoped `ChangeStore`。

## 结论

实现遵循 **AD-CUX-9** 与 **constitution §7.3** 的档 1/2 边界与无档 3 铁律；索引维护点正确；模块落在 `src/search/`；打开路径不 Start；未越界 fork/流式。**PASS**。
