# Connectivity Review — Phase 5 (phase-5-should-polish)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: Markdown 表/链 → Webview 渲染（AC-28）
```
Host messages/replace|append { text }
  → ChatPanelHost.post(messages/*)
  → Webview renderMessages / appendMessage
    → renderBubble(msg)
      → renderSafeMarkdown(text)   // safeMarkdownBrowserSource() 嵌入
           → renderMarkdownSubset
                → GFM pipe table → <table class="md-table">     ✅
                → [label](http(s):…) → <a class="md-link">       ✅
                → 非 http(s) / 失败 → escape / plainFallback     ✅
  → CSS .md-table / a.md-link 已接线                               ✅
Exit: 可读表或链 HTML；XSS 夹具仍走 containsUnsafeHtml 否定路径
```
**判定**: ✅ 数据路径完整。TS `renderSafeMarkdown` 与 browser 源同步（phase5 夹具对照）；provider 注入 `safeMarkdownBrowserSource()` 并消费 `md-table`/`md-link` 样式。

### Path 2: Continue 灰态 reason → 旁路 UI（AC-29）
```
ConversationController.continueChromeForTab(tabId?)
  → hostReady = host.status === 'connected'
  → continueChromeFor(gate, capability, { mode, hostReady })
       → already-live | host-not-ready | capability-unavailable
       → { visibility:'disabled', reason, reasonText, tooltip }
  → panelSnapshot / resolveContinueChrome
  → ChatPanelHost.pushFullState → panel/state.continue
  → Webview syncChrome(msg)
       → continueBtn.disabled
       → #continueReason.textContent = cont.reasonText   ✅ 旁路，非仅 tooltip
Exit: 灰态旁可区分短文案
```
**判定**: ✅ 协议字段 `reason`/`reasonText`（protocol + host 类型）与 Webview DOM/`data-testid="continue-reason"` 贯通；三场景映射均有 call site。

### Path 3: 本回合文件数 → diff-summary → Diff（AC-30）
```
SDK session.event (tool/result meta.diffs)
  → TimelineStore.apply → items[].diffs
SDK session.event (assistant/message)
  → onSdkNotification: timeline.apply 先于 projectAssistantMessage
  → maybeAppendDiffSummary
       → changedFileCountForLatestTurn (最新 turn/start 后 unique path)
       → N>0 → messages.append kind:'diff-summary' + panelHost.pushAppend
       → N=0 → 不伪造                                          ✅
Webview renderBubble(kind==='diff-summary')
  → button.diff-summary-entry click
  → action/open-workspace-diffs
  → parseWebviewToHostMessage → ChatPanelHost
  → deps.requestOpenWorkspaceDiffs
  → executeCommand('dsh.reviewWorkspaceDiffs')
  → writeDiffsForSessionTree → reviewWorkspaceDiffs            ✅ 复用既有 Diff
Exit: 「本回合改了 N 个文件」入口可打开既有 Timeline/Diff 路径
```
**判定**: ✅ 生产→投影→点击→Host→既有 Diff 命令全链连通；无平行第二套 Diff 权威。

### Path 4: Fence 语言标签（AC-31）
```
```lang … ```
  → renderCodeBlock(code, lang)
       → lang 非空 → <span class="code-lang"> + data-lang       ✅
       → lang 空 → 无标签、无 data-lang                        ✅
  → Webview CSS .code-block .code-lang                         ✅
Exit: 有语言可见标签；无语言不编造
```
**判定**: ✅ HTML 产出与 CSS 呈现接线完整（非仅 data-lang 属性）。

### Path 5: 未读指示增强 + 清除（AC-32）
```
inactive Tab + assistant/diff-summary 投影
  → registry.setUnread(tabId, true)
  → conversationTreeItems → label 前缀 UNREAD_INDICATOR='⬤'   ✅ 相对基线 ● 更大
registry.switchTo(tabId) → tab.unread = false                 ✅ 清除语义未改
Exit: TreeView 标签更易发现；激活后清除
```
**判定**: ✅ 增强与清除路径连通。TreeView 无自定义 unread CSS（探索 R6）；尺寸增强走 glyph，满足「对比度或尺寸至少其一」。

### Path 6: keybindings → dsh.newConversation → ensureHost（AC-34）
```
package.json contributes.keybindings
  → command: dsh.newConversation (ctrl/cmd+shift+alt+n)        ✅
registerCommand('dsh.newConversation')
  → runNewConversationFromCommand
    → runNewConversationShared
         → ensureHostForSend → orchestrator.request('command-send')  ✅
         → newConversationOrReuseEmpty + revealConversationPanel
Webview #newConversationBtn → action/new-conversation
  → requestNewConversation → runNewConversationFromPanel
    → 同一 runNewConversationShared（announce=false）          ✅ 主入口保留
Exit: 键盘辅入口 ≡ 命令路径（含 ensureHost）；顶栏按钮未移除
```
**判定**: ✅ 键绑定落在既有命令 id，自动继承 ensureHost；与 chrome 共享路径。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `renderMarkdownSubset` 表/链 | Webview `renderBubble` / TS 测试 | ✅ | `renderTable` / `renderInline` | ✅ |
| `renderCodeBlock` lang 标签 | `renderMarkdownSubset` fence | ✅ | DOM + `.code-lang` CSS | ✅ |
| `continueChromeFor(..., options)` | `continueChromeForTab` | ✅ | `panel/state.continue` → `syncChrome` | ✅ |
| `#continueReason` | `syncChrome` | ✅ | 展示 `reasonText` | ✅ |
| `changedFileCountForLatestTurn` | `maybeAppendDiffSummary` | ✅ | `TimelineStore.changedFilesForLatestTurn` | ✅ |
| `kind:diff-summary` 消息 | `maybeAppendDiffSummary` / `pushAppend` | ✅ | `renderBubble` 专用分支 | ✅ |
| `action/open-workspace-diffs` | Webview click | ✅ | `requestOpenWorkspaceDiffs` → `dsh.reviewWorkspaceDiffs` | ✅ |
| `UNREAD_INDICATOR` | `conversationTreeItems` label | ✅ | TreeView 展示；`switchTo` 清 unread | ✅ |
| `keybindings` → `dsh.newConversation` | VS Code contributes | ✅ | `runNewConversationShared` → `ensureHostForSend` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| protocol `continue.reasonText` ↔ Webview | disabled 时旁路文案 | `syncChrome` 读 `cont.reasonText` | ✅ |
| protocol `action/open-workspace-diffs` ↔ Host | 可解析并转发 | `parseWebviewToHostMessage` + host case | ✅ |
| `ChatPanelHostDeps.requestOpenWorkspaceDiffs` ↔ extension | 可选钩子已接线 | extension 绑定 `executeCommand('dsh.reviewWorkspaceDiffs')` | ✅ |
| `ContinueChrome`（capability）↔ panel continue | reason / reasonText / visibility | 同名字段透传 `pushFullState` | ✅ |
| MessageStore `kind:'diff-summary'` ↔ renderBubble | 专用 UI 非 MD | `if (msg.kind === 'diff-summary')` 按钮入口 | ✅ |
| MD dual-source | browser ≡ TS | phase5 夹具对 link/table 同步 | ✅ |
| package.json keybindings.command | `dsh.newConversation` | 已注册同名 command | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `safe-markdown` + Webview `renderBubble` | phase-3 | 扩展表/链/lang；未拆毁 XSS 回退 | ✅ |
| Continue chrome / `panel/state.continue` | phase-3 / conversation-ui | 增 reason 字段；visibility 语义保留 | ✅ |
| `TimelineStore` + `dsh.reviewWorkspaceDiffs` | 既有 Diff | 复用；未平行权威 | ✅ |
| `runNewConversationShared` / `ensureHostForSend` | phase-4 | 未改签名；keybindings 挂同一 command | ✅ |
| `registry.switchTo` unread 清除 | phase-3 AC-57 | 未改 | ✅ |
| phase-4「无 keybindings」测试断言 | phase-4 | 已翻转为「存在且 ≡ newConversation」 | ✅ |

## 关键发现

### 🔴 Must-Fix
- （无）— 所列六条产品路径均从入口贯通到出口，无断链、无契约不一致、无未通知的冻结接口破坏。

### 🟡 Should-Fix
- （无阻断级）可选观察：`requestOpenWorkspaceDiffs?.()` 为可选链；当前 extension 已接线。若未来构造无 dep 的 Host，点击会静默空操作——属防御性完备性，非本 Phase 交付断链。

### 🟢 Observations
- AC-30 入口 N 按「最新 turn」计数，点击打开的是 **session tree** 级 `reviewWorkspaceDiffs`（规格要求链到既有 Timeline/Diff，非强制 turn 过滤）— 连通正确。
- AC-32 增强为 glyph（`⬤`），非 TreeItem CSS；与 repo-exploration 约束一致。
- AC-28 表与链均交付（规格「或」）；MD→CSS→DOM 双侧均接线。
- 未触碰 `packages/core/agent-loop`；无循环依赖。

## 详细依据（源码 call site）

| AC | 关键接线点 |
|----|-----------|
| AC-28/31 | `safe-markdown.ts` `renderTable`/`renderInline`/`renderCodeBlock`；`chat-panel-provider.ts` CSS + `renderBubble` → `renderSafeMarkdown` |
| AC-29 | `continue-capability.ts` `continueChromeFor`；`conversation-controller.ts` `continueChromeForTab`；provider `#continueReason` + `syncChrome` |
| AC-30 | `timeline-store.ts` `changedFilesForLatestTurn`；`maybeAppendDiffSummary`；provider diff-summary 按钮；`extension.ts` `requestOpenWorkspaceDiffs` |
| AC-32 | `conversation-tab-bar.ts` `UNREAD_INDICATOR`；`conversation-registry.ts` `switchTo` |
| AC-34 | `package.json` `contributes.keybindings`；`extension.ts` `runNewConversationShared` → `ensureHostForSend` |
