# Correctness Review — phase-6-session-search

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-50 | 档 1 返回匹配列表；命中来自索引字段而非全文扫描 | `session-search.ts:matchTier1Field` / `searchSessions`；`conversation-controller.ts:searchSessions` | ✅ | `matchTier1Field` 仅对 `title` / `firstUserPreview` 做大小写不敏感子串匹配；`searchSessions` 不读 MessageStore / JSONL。层 B：`chat-ux-session-search.spec.ts` 断言 `matchField`，body-only token 空结果，`messages.get` spy 未调用。 |
| AC-51 | 按路径档 2 path→session 反查 | `path-session-index.ts`；`persistChangeIndex` → `replaceSessionPaths`；delete → `removeSession` | ✅ | `PathSessionIndex` 持久化 `dsh.pathSessionIndex`；`queryByPath` 规范化 + 子串/后缀匹配。写入：`persistChangeIndex`（含 `settleChangeListProjection` / mark-reviewed / revert 路径）同步 paths；删除清索引。层 B：双 session 同 path 命中；delete 后仅剩 sessionB。 |
| AC-52 | 打开走历史/回放或已有 Tab；不 Start | `openSearchHit` → `openFromHistory`；`dsh.searchSessions`；`action/open-search-hit` | ✅ | `openSearchHit` 直接委托 `openFromHistory`（激活已有 Tab 或创建 `replay`）；路径内无 `Host.start`。命令与协议均走同一打开路径；README Query/browse 矩阵含 `dsh.searchSessions`。层 B：spy `host.start` 未调用；协议打开后 mode=`replay`。 |
| AC-53 | 无档 3 / 第二正文库；不静默扫 JSONL 正文 | `TIER3_FULL_TEXT_SEARCH_API = null`；`src/search/*` | ✅ | 命名导出恒为 `null`；模块无 `searchFullText` / `scanJsonlBodies` / `searchMessageBodies`；body-only 查询空结果。搜索包头注释与实现均禁止读 JSONL/正文。 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | ✅ | 活跃债务表为空；无已知桩需对照 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无。`searchSessions` / `PathSessionIndex.*` / `openSearchHit` 均为完整逻辑；空 `return []` 仅空查询边界。 |

## 约束交叉检查（本 Phase 重点）

| 约束 | 判定 | 证据 |
|------|:--:|------|
| 档 1 非正文扫描 | ✅ | 仅 `listHistorySessions` 元数据字段；测试 spy 证明不触 MessageStore |
| 档 2 path 索引维护 | ✅ | Change 持久化与会话删除双向维护；workspaceState 持久化真实写入 |
| 打开不 Start | ✅ | 唯一打开入口 → `openFromHistory`；层 B spy Start |
| 无档 3 | ✅ | 无全文 API；否定用例通过 |
| 无新桩 | ✅ | registry 活跃空；代码无 `@STUB` / 空壳 |
| 未改 agent-loop | ✅ | `packages/core/agent-loop` 工作区无改动；搜索实现仅在 `apps/vscode-dsh` |

## 关键发现

### 🔴 Must-Fix
- 无

### 🟡 Should-Fix
- 无（冷启动全量扫 change `index.json` 未做：implementation 已记录为符合 design 的 durable reverse index 选择；spec 要求写入/删除时维护，当前满足，不构成 AC 失败）

### 🟢 Observations
- 层 B `chat-ux-session-search.spec.ts`：**6 passed**（本审查独立复跑确认）。
- 搜索入口为命令面板 + `action/search-sessions` 协议（无独立 Webview 搜索页），符合 spec「搜索 UI **或** 命令面板」。
- `openFromHistory` 本身不调用 Start；Continue/重试/编辑/分叉仍为后续显式动作，符合 AC-52 例外条款。

## 测试证据

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-session-search.spec.ts
# Test Files  1 passed (1)
# Tests  6 passed (6)
```
