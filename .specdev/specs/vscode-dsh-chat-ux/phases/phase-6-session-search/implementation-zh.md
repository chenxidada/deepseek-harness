# Phase 6 实现摘要 — phase-6-session-search（中文）

详见同目录 [implementation.md](./implementation.md)。摘要：

- **档 1**：按 `title` / `firstUserPreview` 查询，命中带 `matchField`；不扫正文。
- **档 2**：`PathSessionIndex`（`dsh.pathSessionIndex`）；Change 写入/会话删除时维护 path→session。
- **打开**：`openSearchHit` → `openFromHistory`；命令 `dsh.searchSessions` + 协议 `action/search-sessions` / `action/open-search-hit`；不 auto Start。
- **无档 3**：`TIER3_FULL_TEXT_SEARCH_API = null`；否定用例通过。
- **测试**：`chat-ux-session-search.spec.ts` **6 passed**；无新活跃债务。
