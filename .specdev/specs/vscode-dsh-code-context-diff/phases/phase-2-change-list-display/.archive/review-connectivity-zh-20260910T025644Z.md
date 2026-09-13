# 连通性审查 — phase-2-change-list-display

## 视角
**集成连通性** — 模块间是否真正连通

## 判决
**PASS**

> 基于 2026-09-10 live 代码重审。此前连通性 Must-Fix 已过时：主键单击 → `change/open` + 独立展开、`change/reveal-source` → `pushRevealSource` → `scroll/reveal-source`、以及 AC-30 `sourceMessageId` 过滤均已端到端接通。

## 端到端路径追踪

### 路径 1：AC-12a — 主键单击打开文件（与 Diff 展开分离）
```
入口：Webview change-list-item 单击
  → chat-panel-provider.ts:654-659
       postMessage { type: 'change/open', changeId, path }
  → chat-panel-host.ts:490-492
       requestChangeOpen?.(changeId, path)
  → extension.ts:1131-1132
       openChangedPath(vscode, changeId, path)
出口：打开编辑器（有行则定位首变更行）

并行展开（AC-12，非主键）：
  → change-list-expand 单击（provider.ts:661-686）
       postMessage { type: 'change/get-diff', changeId }
  → host.ts:476-487 → extension.ts:1111-1129
       SnapshotStore 读取 → change/diff-content
  → provider.ts:930+ 按 data-change-id 更新 pane
```
**判定**: ✅ 完整连通。主键只发 `change/open`；`change-list-expand` 独立发 `change/get-diff`。测试 `AC-12a` 两例覆盖。

### 路径 2：AC-19 — 变更「来源」→ 助手气泡
```
入口：Webview「来源」按钮
  → provider.ts:695-700
       postMessage { type: 'change/reveal-source', sourceMessageId }
  → host.ts:494-496
       requestRevealSource?.(sourceMessageId)
  → extension.ts:1134-1139
       panelHost.pushRevealSource(...)（不调用 pushRevealChangeList）
  → host.ts:333-338
       post { type: 'scroll/reveal-source', sourceMessageId }
  → provider.ts:916-927
       查询 [data-message-id=sourceMessageId] → scrollIntoView
出口：助手气泡高亮滚动
```
**判定**: ✅ 完整连通。协议与 parse 契约一致；测试断言推送 `scroll/reveal-source` 且不推 `scroll/reveal-change-list`。

### 路径 3：AC-30 — diff-summary 点击 reveal 对应 change-list
```
入口：Controller settle 投影
  → conversation-controller.ts:1152-1161
       diff-summary 写入 sourceMessageId
  → provider.ts:598-612
       点击携带 action/reveal-change-list + sourceMessageId
  → host.ts:472-474 → extension.ts:1095-1109
       按 changeList.sourceMessageId 过滤对应列表
       pushRevealChangeList
  → provider.ts:897-914
       按 messageId / data-source-message-id 滚动
出口：对应消息下 change-list 可见
```
**判定**: ✅ 完整连通。测试验证不会误选最新列表。

### 路径 4：change/get-diff 按需 diff（配套 AC-12）
```
入口：expandBtn → change/get-diff → SnapshotStore
  → change/diff-content → pane[data-change-id]
```
**判定**: ✅ 上下游闭环。

## 上下游连接检查

| 新函数/组件 | 上游 | 状态 | 下游 | 状态 |
|------------|------|:--:|------|:--:|
| `change/open` | 主键单击 | ✅ | `openChangedPath` | ✅ |
| `change/get-diff` | Diff 控件 | ✅ | SnapshotStore → `diff-content` | ✅ |
| `change/reveal-source` | 「来源」按钮 | ✅ | `pushRevealSource` | ✅ |
| `scroll/reveal-source` | Host | ✅ | `[data-message-id]` 滚动 | ✅ |
| `action/reveal-change-list` | diff-summary 点击 | ✅ | 按 id 过滤 + `pushRevealChangeList` | ✅ |
| settle 投影 `sourceMessageId` | attributor | ✅ | change-list + diff-summary | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host `change/open` | `{ changeId, path }` | `requestChangeOpen` | ✅ |
| Webview → Host `change/reveal-source` | `sourceMessageId: string` | parse + `requestRevealSource` | ✅ |
| Host → Webview `scroll/reveal-source` | `sourceMessageId` | `data-message-id` 定位 | ✅ |
| Webview → Host `action/reveal-change-list` | 可选 `sourceMessageId` | extension 按 id 过滤 | ✅ |
| Controller → MessageStore | `diff-summary.sourceMessageId` | 字段 + HTML 属性 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Chat panel / MessageStore | chat-ready / phase-1 | 扩展协议，未破坏既有路径 | ✅ |
| AC-30 摘要入口 | chat-ready | 收口为 reveal change-list | ✅ |
| Spike SnapshotStore | phase-0 | settle → get-diff 消费 | ✅ |
| Phase-3 revert | — | 未接线（预期） | ✅ N/A |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- 无 `sourceMessageId` 时「来源」early-return（provider.ts:696）为防御守卫。
- `scroll/reveal-change-list` 无命中时回退首个列表（907-908）仅为无身份兜底；AC-30 主路径已带 identity。
- L2 测试与上述 call site 一致。
