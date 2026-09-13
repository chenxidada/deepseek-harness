# Phase 6 实现摘要 — phase-6-session-search

## 变更清单（文件列表）

| 路径 | 变更 |
|------|------|
| `apps/vscode-dsh/src/search/path-session-index.ts` | **新建** 档 2 path→session 反查索引 + workspaceState 持久化 |
| `apps/vscode-dsh/src/search/session-search.ts` | **新建** 档 1/2 `searchSessions`；显式 `TIER3_FULL_TEXT_SEARCH_API = null` |
| `apps/vscode-dsh/src/search/index.ts` | **新建** 包导出 |
| `apps/vscode-dsh/src/conversation-controller.ts` | 挂载 `pathSessionIndex`；`persistChangeIndex` 同步档 2；删除清索引；`searchSessions` / `openSearchHit` |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `action/search-sessions`、`action/open-search-hit`、`search/results` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 处理搜索 / 打开命中；deps 接线 |
| `apps/vscode-dsh/src/extension.ts` | 命令 `dsh.searchSessions`（Query/browse，不 Start）；Panel Host 接线 |
| `apps/vscode-dsh/package.json` | 注册 `dsh.searchSessions` |
| `apps/vscode-dsh/README.md` | 自动 Start 矩阵：搜索归入 Query/browse |
| `apps/vscode-dsh/tests/chat-ux-session-search.spec.ts` | **新建** 层 B：AC-50–53 |

未改：`agent-loop`、fork 产品路径、MessageStore / JSONL 正文扫描。

## 对每个验收标准的实现说明

### AC-50 — 档 1 标题/预览查询
- `searchSessions({ text })` 只匹配 `ExtensionIndex` 的 `title` / `firstUserPreview`（`matchTier1Field`）。
- 命中带 `matchField: 'title' | 'firstUserPreview'`，层 B 可断言来源。
- 正文仅存在于 MessageStore 的 token **不会**命中；搜索路径不调用 `messages.get`。

### AC-51 — 档 2 path→session
- `PathSessionIndex` 持久化键 `dsh.pathSessionIndex`；条目 `{ path, sessionIds, mtime }`。
- `persistChangeIndex` 在写入 Change `index.json` 后用该会话全部 `ChangeRecord.path` 调用 `replaceSessionPaths`。
- `deleteConversation` / `deleteSession` 调用 `removeSession`（并 `changes.clearSession`）。
- `searchSessions({ path })` → `queryByPath`（规范化 + 子串/后缀匹配）。

### AC-52 — 打开不 Start
- `openSearchHit` → `openFromHistory`（激活已有 Tab 或打开 replay）。
- 命令 `dsh.searchSessions` QuickPick 打开走同一路径；协议 `action/open-search-hit` 同理。
- README / 命令矩阵归类为 Query/browse；层 B spy `Host.start` 未调用。

### AC-53 — 无档 3
- 无全文/JSONL 扫描 API；导出 `TIER3_FULL_TEXT_SEARCH_API = null`。
- 否定用例：body-only 查询空结果；模块无 `searchFullText` / `scanJsonlBodies` / `searchMessageBodies`。

### 搜索入口
- 命令面板：`dsh.searchSessions`（支持 `{ text, path }` 或 `path:…` 输入前缀）。
- 协议：`action/search-sessions` → Host 回 `search/results`；`action/open-search-hit` 打开。

## 测试结果（命令 + 输出）

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-session-search.spec.ts
# Test Files  1 passed (1)
# Tests  6 passed (6)

# 相关回归（过滤）
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/chat-ux-session-search.spec.ts \
  apps/vscode-dsh/tests/chat-ux-fork-retry-branch.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  -t "AC-1c|openHistory|search"
# 7 passed | 20 skipped
```

覆盖：
- AC-50 索引字段命中 + body-only 否定 + 无 MessageStore 读取
- AC-51 persist（mark-reviewed 写路径）+ delete 更新反查
- AC-52 openSearchHit / 协议打开不 Start
- AC-53 无档 3 API

## 偏差记录

无行为偏差。以下为实现选择（符合 spec「搜索 UI **或** 命令面板」）：

| 项 | 说明 | 影响 |
|----|------|------|
| 搜索 UI | 以命令面板 + 协议为主，未做独立 Webview 搜索页 DOM | spec.md 产出清单「搜索 UI 或命令面板」；design AD-CUX-9 / W→H `action/search-sessions` 已接线 |
| 冷启动全量扫 change `index.json` | 未做；依赖 workspaceState 增量维护 | design 倾向 durable reverse index；写入/删除路径已同步 |

## 债务注册

- 活跃债务：无新增 `@STUB` / GAP。
- `tech-debt-registry.md` 活跃表保持空占位。
