# Connectivity Review — phase-3-chat-ui-chassis

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: Theme refresh (AC-8a)
```
Entry: vscode.window.onDidChangeActiveColorTheme / activate / onViewResolved
  → extension.pushActiveTheme(vscode)
    → maps ColorTheme.kind → 'light' | 'dark' | 'high-contrast'
    → panelHost.pushThemeKind(label)                    ✅
      → post { type: 'ui/theme', themeKind }            ✅
  → Webview message handler
    → applyThemeKind(msg.themeKind)                     ✅
    → body.theme-light | theme-dark | theme-high-contrast
  Native `--vscode-*` CSS remains primary (AD-CR-7)     ✅
Exit: Webview theme class + CSS variables refreshed
```
**判定**: ✅ 数据路径完整。`panelHost` 在 activate 早期创建；首屏 `pushActiveTheme` 若早于 attach 则 `port?.postMessage` 静默丢弃，但 `resolveWebviewView` → `attach` → `onViewResolved` → `pushActiveTheme` 补推，连通。

### Path 2: Composer Enter → send (AC-12)
```
Entry: #input keydown
  → resolveComposerKeydown({ key, shiftKey, isComposing, text })  ✅ (inline + TS twin)
  → action === 'send' → preventDefault → sendComposer()
    → postMessage { type: 'composer/send', text }                 ✅
  → ChatPanelHost.onWebviewMessage → sendPrompt(text)             ✅
    → Host gates (empty / no-host / replay / …)
    → deps.acceptSend → ConversationController.promptActive       ✅
  Shift+Enter → 'newline' → no composer/send                      ✅
Exit: Host-owned prompt path (unchanged gate)
```
**判定**: ✅ Enter→send / Shift+Enter→newline 端到端接通；发送权威仍在 Host。

### Path 3: MD render → Copy → dsh.copyToClipboard (AC-16/17)
```
Entry: Host messages/replace|append { text }
  → Webview renderBubble
    → renderSafeMarkdown(text) (embedded safeMarkdownBrowserSource)  ✅
    → div.innerHTML = rendered.html; wireCopyButtons(div)            ✅
  → Copy click
    → decodeURIComponent(data-copy-code)
    → postMessage { type: 'action/copy-code', text }                 ✅
  → parseWebviewToHostMessage → action/copy-code                     ✅
  → ChatPanelHost → deps.requestCopyCode(text)                       ✅
  → extension createPanelHost:
      executeCommand('dsh.copyToClipboard', text)                    ✅
  → registerCommand('dsh.copyToClipboard')
    → env.clipboard.writeText(text)                                  ✅
    → showInformationMessage('Copied to clipboard')                  ✅
Exit: clipboard write + Host feedback (command not menu-primary)
```
**判定**: ✅ MD→Copy→命令→clipboard 全链连通；`package.json` 注册命令且 menus 未挂主入口。

### Path 4: Conversations empty label (AC-19)
```
Entry: AutoReady / newConversationOrReuseEmpty / controller default
  → title = EMPTY_LIVE_TITLE ('新对话')                              ✅
  → conversationTreeItems(snapshot)
    → tabs.length === 0 → [] (no Start Session / Command Palette)    ✅
    → displayTitle: empty / 'New conversation' → EMPTY_LIVE_TITLE    ✅
Exit: TreeView label 「新对话」；空 registry 无命令标题堆砌
```
**判定**: ✅ 标题常量跨 controller / auto-ready / tab-bar 同源接通。

### Path 5: History filter empty tabs → replay (AC-19a / AC-20)
```
Entry: ExtensionIndex.listHistorySessions()
  → filter deleted !== true && isHistoryEligibleSession(row)         ✅
    → firstUserPreview non-empty → keep
    → else exclude isEmptyLiveTitle(title)
  → createHistoryView(getRows: listHistoryFromIndex)                 ✅
  → TreeItem.command = dsh.openHistory(sessionId)                    ✅
  → ConversationController.openFromHistory → mode=replay             ✅
    → panelHost.pushFullState (panel/state mode=replay)              ✅
Exit: empty placeholders absent from list; non-empty rows still replay
```
**判定**: ✅ 过滤落在 index→History 列表；回放命令路径未改、仍连通。

### Path 6: Panel / state authority still Host (AC-25)
```
Entry: ChatPanelHost.pushFullState / applyConnectionState
  → post panel/state { mode, sessionId, … }                          ✅
  → Webview: mode = msg.mode; syncComposer() disables non-live       ✅
  → composer/send always Host-gated (sendPrompt)                     ✅
  → no Webview-owned session/mode FSM; no second panel architecture  ✅
Exit: presentation-only chassis on AD-CU-1 seam
```
**判定**: ✅ 权威未外移；UI 底盘只消费 Host 帧。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `pushActiveTheme` | theme listener / activate / onViewResolved | ✅ | `panelHost.pushThemeKind` | ✅ |
| `pushThemeKind` | `pushActiveTheme` | ✅ | Webview `ui/theme` → `applyThemeKind` | ✅ |
| `resolveComposerKeydown` | Webview `#input` keydown | ✅ | `sendComposer` → `composer/send` | ✅ |
| `renderSafeMarkdown` (browser) | `renderBubble` | ✅ | DOM + `wireCopyButtons` | ✅ |
| `action/copy-code` handler | Webview Copy | ✅ | `requestCopyCode` → `dsh.copyToClipboard` | ✅ |
| `dsh.copyToClipboard` | Host / executeCommand | ✅ | `env.clipboard.writeText` | ✅ |
| `EMPTY_LIVE_TITLE` | auto-ready / controller / tab-bar | ✅ | Conversations TreeItem label | ✅ |
| `isHistoryEligibleSession` | `listHistorySessions` | ✅ | History TreeView rows | ✅ |
| `dsh.openHistory` | History row click | ✅ | `openFromHistory` → replay `panel/state` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host | `action/copy-code` `{ text: string }` | protocol parse + Host handler | ✅ |
| Host → Webview | `ui/theme` `{ themeKind: string }` | Webview `applyThemeKind` | ✅ |
| Host → command | `executeCommand('dsh.copyToClipboard', text)` | registered; validates string; writes clipboard | ✅ |
| Tab bar ← titles | empty live →「新对话」 | `EMPTY_LIVE_TITLE` + `displayTitle` | ✅ |
| History ← index | exclude empty live placeholders | `isHistoryEligibleSession` | ✅ |
| Webview ← Host | mode/session via `panel/state` only | HTML assigns `mode` from `panel/state` | ✅ |
| Composer → Host | `composer/send` still Host-gated | `sendPrompt` unchanged gates | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `panel/state` / `composer/send` / `status/set` | conversation-ui + phase-1/2 | 未改权威语义；仅增 `ui/theme` / `action/copy-code` | ✅ |
| ConnectionUi → `applyConnectionState` | phase-1 | 仍 Host 投影；本 Phase 仅 CSS/可读性 | ✅ |
| AutoReady empty live title | phase-2 | 改用 `EMPTY_LIVE_TITLE`；仍走 `newConversationOrReuseEmpty` | ✅ |
| History `openFromHistory` replay | prior | 未改签名；列表多了 eligibility 过滤 | ✅ |
| DEBT-003 Continue bypass | → phase-4 | 未触碰；非本 Phase Must | ✅ |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- Theme 首推依赖 `onViewResolved` 补推（activate 时可能尚无 port）；生产路径已接通，非断裂。
- `resolveComposerKeydown` / safe-MD 存在 TS 模块与 Webview 内联双份实现；当前内容对齐并由 L3 覆盖，漂移风险留作后续维护注意。
- `requestCopyCode?.` 为可选依赖；`createPanelHost` 已接线，未接线时会静默跳过（测试可故意省略）。
- L4 截图仅 README 路径约定（AC-7a 主证据为 L2/L3）；不影响模块连通。
