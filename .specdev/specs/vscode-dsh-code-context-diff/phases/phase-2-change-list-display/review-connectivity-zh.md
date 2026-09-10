# 连通性审查 — phase-2-change-list-display

## 视角
**集成连通性** — 模块间是否真正连通

## 判决
**PASS**

> MUST-FIX 回路后重审（2026-09-10）。先前 AC-12a / AC-19 / AC-30 断链已在 live 代码闭合：主键单击 → `change/open`（展开独立）；`change/reveal-source` → `pushRevealSource` → `scroll/reveal-source`；AC-30 `sourceMessageId` 身份端到端传递。

## 端到端路径追踪

### 路径 1: AC-12a — 主键单击打开文件（与 Diff 展开分离）
```
入口: Webview .change-list-item 单击
  → chat-panel-provider.ts
       postMessage { type: 'change/open', changeId, path }
  → chat-panel-host.ts
       requestChangeOpen?.(changeId, path)
  → extension.ts
       openChangedPath(...)
出口: 打开编辑器（有快照时尽量定位首变更行）

并行展开（AC-12，非主键）:
  → .change-list-expand → change/get-diff
  → SnapshotStore → change/diff-content → pane
```
**判定**: ✅ 完整连通。主键单击只发 `change/open`；展开控件独立发 `change/get-diff`。

### 路径 2: AC-19 — 变更「来源」→ 助手气泡
```
入口: 「来源」按钮
  → change/reveal-source { sourceMessageId }
  → requestRevealSource → pushRevealSource
  → scroll/reveal-source
  → [data-message-id===sourceMessageId] scrollIntoView
出口: 助手气泡高亮滚动
```
**判定**: ✅ 完整连通（不再误滚到 change-list）。

### 路径 3: AC-30 — diff-summary 点击 reveal 对应列表
```
入口: Controller 投影 diff-summary.sourceMessageId
  → 点击携带 action/reveal-change-list + sourceMessageId
  → Host 按 changeList.sourceMessageId 过滤
  → scroll/reveal-change-list
出口: 对应消息下 change-list
```
**判定**: ✅ 完整连通（多 turn 不会误选最新列表）。

### 路径 4: change/get-diff 按需 diff
```
入口: expandBtn → change/get-diff → SnapshotStore → change/diff-content → pane
```
**判定**: ✅ 读写闭环；无 snapshot 时 available:false + reason。

### 路径 5: 入账 → change-list 投影
```
入口: meta.diffs → attributor → settle → MessageStore change-list (+ N>0 diff-summary)
```
**判定**: ✅ 主投影仍连通；N=0 仅 emptyNotice、无 diff-summary。

## 上下游连接检查

| 新函数/组件 | 上游 | 状态 | 下游 | 状态 |
|------------|------|:--:|------|:--:|
| `change/open` | Webview 主键单击 | ✅ | `openChangedPath` | ✅ |
| `change/get-diff` | Diff 展开控件 | ✅ | `change/diff-content` | ✅ |
| `change/reveal-source` | 「来源」按钮 | ✅ | `pushRevealSource` | ✅ |
| `scroll/reveal-source` | Host | ✅ | 助手气泡 scroll | ✅ |
| `action/reveal-change-list` | diff-summary 点击 | ✅ | 按 id 过滤 reveal | ✅ |

## 跨模块契约验证

| 模块间 | 一致？ |
|--------|:--:|
| Webview ↔ Host `change/open` / `change/reveal-source` / `action/reveal-change-list` | ✅ |
| Host ↔ Webview `scroll/reveal-source` / `scroll/reveal-change-list` / `change/diff-content` | ✅ |
| Controller → MessageStore `sourceMessageId` 投影 | ✅ |

## 跨 Phase 依赖检查

| 依赖 | 连接状态 |
|------|:--:|
| chat-ready 协议扩展（change/*、scroll/reveal-source） | ✅ |
| AC-30 收口为 reveal change-list（AD-CCD-4） | ✅ |
| Phase-0 SnapshotStore 契约 | ✅ |
| Phase-3 revert（未接线，预期） | ✅ N/A |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 观察
- 「来源」缺 `sourceMessageId` 时 early-return 为防御，非断链。
- `scroll/reveal-change-list` 无身份时的首列表兜底仅作后备；AC-30 主路径已带 identity。
- L2 用例覆盖 AC-12a / AC-19 / AC-30 HTML 契约与 Host 往返。
- 多 assistant re-anchor 现回写 `ChangeRecord.sourceMessageId`，与列表锚点一致。
