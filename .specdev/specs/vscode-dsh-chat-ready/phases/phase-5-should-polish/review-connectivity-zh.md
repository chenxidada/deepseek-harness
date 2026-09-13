# 连通性审查 — Phase 5（phase-5-should-polish）

## 视角
**集成连通性** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### 路径 1：Markdown 表/链 → Webview 渲染（AC-28）
```
Host messages/replace|append { text }
  → ChatPanelHost.post(messages/*)
  → Webview renderMessages / appendMessage
    → renderBubble(msg)
      → renderSafeMarkdown(text)   // 嵌入 safeMarkdownBrowserSource()
           → renderMarkdownSubset
                → GFM pipe 表 → <table class="md-table">     ✅
                → [label](http(s):…) → <a class="md-link">   ✅
                → 非 http(s) / 失败 → 转义 / plainFallback   ✅
  → CSS .md-table / a.md-link 已接线                         ✅
出口：可读表或链 HTML；XSS 夹具仍走 containsUnsafeHtml 否定路径
```
**判定**: ✅ 数据路径完整。TS `renderSafeMarkdown` 与 browser 源同步；provider 注入并消费表/链样式。

### 路径 2：Continue 灰态 reason → 旁路 UI（AC-29）
```
ConversationController.continueChromeForTab(tabId?)
  → hostReady = host.status === 'connected'
  → continueChromeFor(gate, capability, { mode, hostReady })
       → already-live | host-not-ready | capability-unavailable
       → { visibility:'disabled', reason, reasonText, tooltip }
  → resolveContinueChrome → pushFullState → panel/state.continue
  → Webview syncChrome → #continueReason 展示 reasonText     ✅
出口：灰态旁可区分短文案（非仅笼统 tooltip）
```
**判定**: ✅ 协议字段与 Webview DOM 贯通；三场景均有 call site。

### 路径 3：本回合文件数 → diff-summary → Diff（AC-30）
```
SDK tool/result meta.diffs → TimelineStore.apply
SDK assistant/message → timeline.apply 先于 projectAssistantMessage
  → maybeAppendDiffSummary
       → changedFileCountForLatestTurn（最新 turn/start 后 unique path）
       → N>0 → kind:'diff-summary' + pushAppend；N=0 不伪造   ✅
Webview 按钮 → action/open-workspace-diffs
  → Host requestOpenWorkspaceDiffs
  → dsh.reviewWorkspaceDiffs（既有 Diff）                    ✅
出口：「本回合改了 N 个文件」可链到既有 Timeline/Diff
```
**判定**: ✅ 生产→投影→点击→Host→既有 Diff 全链连通。

### 路径 4：Fence 语言标签（AC-31）
```
```lang … ``` → renderCodeBlock
  → 有 lang → <span class="code-lang"> + CSS                 ✅
  → 无 lang → 无标签、无 data-lang                          ✅
```
**判定**: ✅ HTML 与 CSS 呈现接线完整。

### 路径 5：未读指示增强 + 清除（AC-32）
```
非活动 Tab 投影 → setUnread(true)
  → conversationTreeItems 标签前缀 UNREAD_INDICATOR='⬤'     ✅
switchTo → unread=false                                      ✅ 清除语义未改
```
**判定**: ✅ 增强与清除路径连通（尺寸增强走 glyph，非 TreeItem CSS）。

### 路径 6：keybindings → dsh.newConversation → ensureHost（AC-34）
```
package.json keybindings → dsh.newConversation
  → runNewConversationShared → ensureHostForSend             ✅
顶栏「新建会话」→ 同一 shared 路径（主入口保留）              ✅
```
**判定**: ✅ 键盘辅入口与命令路径等价（含 ensureHost）。

## 上下游连接检查

| 新函数/组件 | 上游 | 状态 | 下游 | 状态 |
|------------|------|:--:|------|:--:|
| MD 表/链渲染 | `renderBubble` | ✅ | `md-table` / `md-link` CSS | ✅ |
| `code-lang` 标签 | fence 解析 | ✅ | `.code-lang` CSS | ✅ |
| `continueChromeFor` reason | `continueChromeForTab` | ✅ | `syncChrome` → `#continueReason` | ✅ |
| `changedFileCountForLatestTurn` | `maybeAppendDiffSummary` | ✅ | TimelineStore | ✅ |
| `diff-summary` 消息 | 投影 / pushAppend | ✅ | 按钮 → open-workspace-diffs | ✅ |
| `requestOpenWorkspaceDiffs` | Host 消息处理 | ✅ | `dsh.reviewWorkspaceDiffs` | ✅ |
| `UNREAD_INDICATOR` | TreeItem 标签 | ✅ | `switchTo` 清除 | ✅ |
| keybindings | VS Code contributes | ✅ | `ensureHostForSend` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| continue.reasonText ↔ Webview | 灰态旁路文案 | syncChrome 消费 | ✅ |
| action/open-workspace-diffs ↔ Host | 可解析转发 | parse + host case | ✅ |
| HostDeps.requestOpenWorkspaceDiffs ↔ extension | 已接线 | executeCommand reviewWorkspaceDiffs | ✅ |
| MessageStore diff-summary ↔ renderBubble | 专用入口 | kind 分支按钮 | ✅ |
| MD 双源 | browser ≡ TS | phase5 夹具同步 | ✅ |
| keybindings.command | dsh.newConversation | 同名 command 已注册 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| safe-markdown + renderBubble | phase-3 | 扩展表/链/lang；XSS 回退保留 | ✅ |
| Continue / panel/state.continue | phase-3 | 增 reason；visibility 保留 | ✅ |
| TimelineStore + reviewWorkspaceDiffs | 既有 Diff | 复用，无平行权威 | ✅ |
| runNewConversationShared / ensureHost | phase-4 | 签名未改；键绑定挂同 command | ✅ |
| switchTo unread 清除 | phase-3 | 未改 | ✅ |
| phase-4「无 keybindings」断言 | phase-4 | 已翻转为存在且等价 | ✅ |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）— `requestOpenWorkspaceDiffs?.()` 可选链在当前 extension 接线完备；仅作防御性观察。

### 🟢 Observations
- AC-30：N 按最新 turn 计，点击打开 session-tree 级 Diff（规格要求链到既有路径）— 连通正确。
- AC-32：glyph `⬤` 增强，非 unread CSS。
- AC-28：表与链均交付；未改 agent-loop；无循环依赖。
