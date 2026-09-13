# 连通性审查 — phase-2-stream-capabilities-full-history

> MUST-FIX 回路 #1 复审（旧报告已归档：`.archive/review-connectivity-20260913T150220Z.md`）

## 视角
**集成连通性** — 模块间端到端是否真正接通（webview ↔ bridge ↔ Host ↔ controller）

## 判决
**PASS**

## MUST-FIX 回路核对

| 先前断裂 | 本回路状态 |
|---------|-----------|
| React 无 `action/edit-resend` 调用点 | ✅ 消息操作内联表单确认后 emit |
| React 无 `action/branch` 调用点 | ✅ `btn-branch` → emit `action/branch` |
| 历史搜索结果串到顶栏 search-panel | ✅ 按 `searchOrigin` 写入 `historySearchHits` 驱动历史列表 |
| 跟滚探针恒为 off | ✅ 滚动 / 流式 / 恢复 → `setFollowState` → DOM + probes |

## 端到端路径（摘要）

1. **编辑重发（AC-34a）**：`btn-edit-resend` → 表单确认 → `action/edit-resend` → Host `requestEditResend` → `forkFromClosedTurn(intent:'edit-resend')` ✅
2. **显式分叉（AC-35）**：`btn-branch` → `action/branch` → Host `requestBranch` → `forkFromClosedTurn(intent:'branch')` ✅
3. **重试**：settled / incomplete 助手 → `action/retry` → Host 完整 ✅
4. **历史搜索（AC-56）**：history-search → `searchOrigin='history'` → Host hits → 历史列表；不强制打开顶栏面板 ✅
5. **顶栏搜索**：chrome origin → `searchHits` + search-panel；与历史分流 ✅
6. **跟滚（AC-24）**：滚动/`decideFollowState`/resume 按钮 ↔ store ↔ `data-follow-state` / probes（展示态，不经 Host）✅
7. **History Continue**：pending 在 chrome `disabled|hidden` 时清除，无粘滞 ✅
8. **Stop / 删除 AC-60 / 历史 lineage**：回归路径仍完整 ✅

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无（先前串线 / sticky pending / searchLoading 脱节均已修）。

### 🟢 Observations
- 顶栏与历史几乎同时搜索时，后到的 `search/results` 按当前 `searchOrigin` 分流，偶发错面风险极低，不升格。
- 历史命中行点选走 `ui/history-select`，顶栏命中走 `action/open-search-hit` — 双入口均可打开只读会话。

---

**产出**: `phases/phase-2-stream-capabilities-full-history/review-connectivity.md`（+ `-zh.md`）
**判决**: **PASS**
