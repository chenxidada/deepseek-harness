# Connectivity Review — phase-3-chat-ui-chassis

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 复审上下文

本轮为 **test-only Should-Fix 加固后的连通性复审**（`implementation.md`：无产品行为变更）。先前 `review-connectivity.md` 已归档至 `.archive/`。复审重点：确认端到端接线仍完整，并记录 phase3 suite 新增的 **AC-20** 显式证据。

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
**判定**: ✅ 数据路径完整。`resolveWebviewView` → `attach` → `onViewResolved` → `pushActiveTheme` 补推首屏主题；产品接线本轮未改。

### Path 2: Composer Enter → send (AC-12) + live smoke (AC-27)
```
Entry: #input keydown
  → resolveComposerKeydown({ key, shiftKey, isComposing, text })  ✅
  → action === 'send' → postMessage { type: 'composer/send' }     ✅
  → ChatPanelHost.onWebviewMessage → sendPrompt(text)             ✅
    → Host gates → deps.acceptSend → ConversationController.promptActive ✅
  Shift+Enter → 'newline' → no composer/send                      ✅
Exit: Host-owned prompt path
```
**判定**: ✅ Enter→send / Shift+Enter→newline 接通。phase3 suite 仍有 live Tab `composer/send` 冒烟（AC-27）。

### Path 3: MD render → Copy → dsh.copyToClipboard (AC-16/17)
```
Entry: Host messages/replace|append { text }
  → Webview renderBubble → renderSafeMarkdown (embedded safeMarkdownBrowserSource) ✅
  → Copy → postMessage { type: 'action/copy-code', text }         ✅
  → parseWebviewToHostMessage → ChatPanelHost.requestCopyCode     ✅
  → executeCommand('dsh.copyToClipboard', text)                   ✅
  → env.clipboard.writeText(text)                                 ✅
Exit: clipboard write + Host feedback
```
**判定**: ✅ 全链连通。SF#1 仅加 HTML/TS 同源静态断言（测试），不改接线。

### Path 4: Conversations empty label (AC-19)
```
Entry: AutoReady / newConversationOrReuseEmpty / controller default
  → title = EMPTY_LIVE_TITLE ('新对话')                              ✅
  → conversationTreeItems: empty registry → []                     ✅
Exit: TreeView 「新对话」；无命令标题堆砌
```
**判定**: ✅ 跨 controller / auto-ready / tab-bar 同源接通。

### Path 5: History filter → open → replay gate (AC-19a / AC-20)
```
Entry: ExtensionIndex.listHistorySessions()
  → filter deleted !== true && isHistoryEligibleSession(row)         ✅
  → createHistoryView → TreeItem.command = dsh.openHistory           ✅
  → ConversationController.openFromHistory → mode=replay             ✅
    → panelHost.pushFullState (panel/state mode=replay)              ✅
  → Webview composer/send → Host sendPrompt → reject('replay')       ✅
    → ui/reject-send { reason: 'replay' }                            ✅
Exit: History 非空行可回放；replay Tab 发送被 Host 拒绝
```
**判定**: ✅ 端到端连通。**本轮新增证据（SF#2）**：`phase3-chat-ui-chassis.spec.ts` 内显式用例  
`openFromHistory non-empty → mode=replay and rejects composer/send`：
- `openFromHistory(..., { events })` → `outcome=opened`, `mode=replay`, `messageCount=2`
- FakeWebview 收到 `panel/state` `mode=replay`
- `composer/send` → `ui/reject-send` `reason=replay`

此前 AC-20 主要依赖 phase2 suite；现已在 **本 Phase 套件** 有独立回归锚点。

### Path 6: Generating indicator (AC-10) + connection chrome
```
Tab.status running → ChatPanelHost.resolveStatus → status/set 'generating'
  → Webview 「Generating…」+ .is-generating                         ✅
Connection: Orchestrator → ConnectionUi → applyConnectionState
  → panel/state + ui/banner（phase-1 缝，本 Phase 仅呈现）           ✅
```
**判定**: ✅ 既有缝未拆；无第二套状态通道。

### Path 7: AC-25 Host authority
```
Webview follows panel/state only; no createRoot/ReactDOM
Host owns mode/session/send gate via ui/reject-send                  ✅
```
**判定**: ✅ 呈现升级未引入 Webview 权威。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `pushThemeKind` | `pushActiveTheme` / theme listener | ✅ | `post(ui/theme)` → Webview | ✅ |
| `resolveComposerKeydown` | Webview `#input` keydown | ✅ | `composer/send` 或 newline | ✅ |
| `renderSafeMarkdown` / browser source | `buildThinChatHtml` embed + renderBubble | ✅ | DOM / copy buttons | ✅ |
| `requestCopyCode` | Host `action/copy-code` | ✅ | `dsh.copyToClipboard` | ✅ |
| `EMPTY_LIVE_TITLE` | controller / auto-ready / tab-bar | ✅ | TreeView label | ✅ |
| `isHistoryEligibleSession` | `listHistorySessions` | ✅ | History TreeView rows | ✅ |
| `openFromHistory` | `dsh.openHistory` / phase3 AC-20 test | ✅ | registry replay + `pushFullState` | ✅ |
| `sendPrompt` replay gate | Webview `composer/send` | ✅ | `ui/reject-send` reason=replay | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host | `action/copy-code` `{ text }` | `parseWebviewToHostMessage` + Host handler | ✅ |
| Host → command | `executeCommand('dsh.copyToClipboard', text)` | `registerCommand` + `package.json` contributes | ✅ |
| Host → Webview | `ui/theme` `{ themeKind }` | protocol + HTML handler | ✅ |
| History → Controller | `openFromHistory(sessionId)` → `mode=replay` | controller creates replay Tab | ✅ |
| Webview send → Host | live accept / replay reject | `sendPrompt` gates + `ui/reject-send` | ✅ |
| MD TS ↔ Webview embed | 同源渲染 | SF#1 五夹具同源断言（测试加固） | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `ChatPanelHost` / `panel/state` / `ui/reject-send` | conversation-ui / prior | 冻结，未改语义 | ✅ |
| AutoStart / ConnectionUi 投影缝 | phase-1 | 仅呈现消费，未改 FSM | ✅ |
| AutoReady + `EMPTY_LIVE_TITLE` | phase-2 | 标题常量对齐，无 API 破坏 | ✅ |
| History `openFromHistory` replay | prior AC-20 | 接口未改；phase3 补显式证据 | ✅ |
| DEBT-003 Continue 旁路 | → phase-4 | 未触碰 | ✅ |

## AC-20 证据备注（本轮）

| 来源 | 覆盖 |
|------|------|
| `phase2-multitab-history-replay.spec.ts` | 既有 History → replay / reject-send（前序） |
| **`phase3-chat-ui-chassis.spec.ts`（SF#2 新增）** | **本 Phase 套件内** `openFromHistory` → `mode=replay` + `composer/send` → `ui/reject-send` `reason=replay` |

产品路径未因测试加固而改动；连通性以 call-site 复核 + 上述测试锚点确认。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无 — 前轮 correctness Should-Fix 已由测试加固关闭；连通性无新增缺口）

### 🟢 Observations
- 本轮仅测试变更：SF#1 MD 同源、SF#2 AC-20 显式路径、SF#3 L4 README `existsSync`；产品模块接线与上轮 PASS 一致。
- AC-20 现同时有 phase2 回归与 phase3 chassis suite 双锚点，跨 Phase 回放门更易被本 Phase CI 直接守住。
- DEBT-003（Continue 未走 `ensureHostForSend`）仍留给 phase-4，本 Phase 未引入新断点。

## 反狡辩自检
- 未仅凭「接口定义了」下结论：核对了 extension ↔ Host ↔ Webview ↔ Index ↔ Controller 的实际 call site。
- 未假设「测试加固不影响连通」而不复验：对 Paths 1–7 与 AC-20 新用例做了对照。
- 未把 correctness/design 问题混入本视角。
