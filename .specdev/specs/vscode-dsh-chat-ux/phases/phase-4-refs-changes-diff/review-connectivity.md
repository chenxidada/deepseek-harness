# Connectivity Review — phase-4-refs-changes-diff

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: Composer 引用卡（AC-40）
```
Entry: textarea#input input/prefill/syncComposer
  → syncComposerRefCards(#composer-ref-cards, text)
    → extractAtPathTokens(text)          ✅ atPathExtractBrowserSource 嵌入
    → button.ref-card[data-testid=ref-card]
  → wireRefCards(composerRefCardsEl)
    → click → action/open-reference { path }
      → Host requestOpenReference → openReferencePath / planReferenceOpen ✅
Exit: 打开引用；发送仍 composer/send 纯文本 @path（Host validateComposerAtPaths）
```
**判定**: ✅ 数据路径完整；chip 为呈现层，发送契约未断

### Path 2: @ 解析共享链路（AC-41 / AD-CUX-11 / R5）
```
Host send gate:
  composer/send → validateComposerAtPaths → extractAtPathTokens (at-path.ts) ✅

Webview render (composer / sent / replay):
  provider 嵌入 atPathExtractBrowserSource + refCardsBrowserSource
  → segmentTextWithRefs / syncComposerRefCards / fillUserBubbleWithRefCards
  → 均调用 extractAtPathTokens（无 provider 本地第二套 @ 正则）✅

Sent / replay bubble:
  messages/replace|append → renderBubble(role=user)
    → fillUserBubbleWithRefCards → wireRefCards → action/open-reference ✅
```
**判定**: ✅ 三处渲染入口共用同一 extract；Host 门禁与 Webview 呈现同源文法

### Path 3: change-list → 内联 get-diff（AC-43 默认半）
```
Entry: [data-testid=change-list-expand] click
  → change/get-diff { changeId }
    → ChatPanelHost → requestChangeDiff(changeId)
      → ChangeStore + SnapshotStore.read
    → change/diff-content { available, oldText, newText } | available:false
  → provider: fillChangeDiffPane(pane[data-change-id], msg)  ✅ textContent
Exit: 内联 pane 展示 before/after（或不可用文案）
```
**判定**: ✅ 默认展开路径完整；Webview browser source 在无 postMessage 参数时回退 `vscode.postMessage`

### Path 4: open-native-diff → vscode.diff（AC-43 显式半）
```
Entry: [data-testid=change-list-open-native-diff] click
  → change/open-native-diff { changeId }
    → protocol.parse ✅
    → Host requestChangeOpenNativeDiff(changeId)
    → extension openChangedNativeDiff
      → changes.getById → SnapshotStore.read
      → openChangeSnapshotDiff → commands.executeCommand('vscode.diff', …) ✅
Exit: 原生 Diff 编辑器（dsh-diff 虚拟文档）
```
**判定**: ✅ 与 Timeline `openTimelineDiff` 共用 `openChangeSnapshotDiff`；非 Timeline-only 断路

### Path 5: data-turn 与 activity 共组（AC-42）
```
settleChangeListProjection(sessionId, sourceMessageId, turn)
  → MessageStore append kind:change-list { turn, changeList }
  → pushFullState / messages/replace
  → renderChangeListBubble → applyMessageIdentity → data-turn=N ✅
activity (phase-3) 同 turn → data-turn=N ✅
层 A: change-list[data-turn] 与 activity[data-turn] 同组可判定 ✅
```
**判定**: ✅ 归属契约未破；本 Phase extract 仍写入 `data-turn`

### Path 6: Replay 禁发不破（AC-45）
```
hydrate / openFromHistory → mode=replay
  → 仍可 render refs / change-list / activity（呈现）
  → composer/send → sendPrompt
    → active.mode === 'replay' → reject('replay')
    → ui/reject-send { reason: 'replay' } ✅
Exit: 不进入 acceptSend；mode 保持 replay
```
**判定**: ✅ 呈现与发送门禁解耦；回放渲染不绕过 Host 禁发

### Path 7: Timeline 弱化（AC-44，回归连通）
```
assistant/message → TimelineStore truncate(label, 40)
  → 完整助手正文仅 MessageStore / 对话面 ✅
```
**判定**: ✅ 无向 Timeline 倾倒长文 body 的新接线

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `syncComposerRefCards` | provider `input`/`prefill`/`syncComposer` | ✅ | `extractAtPathTokens` | ✅ |
| `fillUserBubbleWithRefCards` | provider `renderBubble(user)` | ✅ | `segmentTextWithRefs` → extract | ✅ |
| `wireRefCards` | composer + user bubble | ✅ | `action/open-reference` | ✅ |
| `renderChangeListBubble` | provider `renderBubble(change-list)` | ✅ | `change/get-diff` / `open-native-diff` / `change/open` | ✅ |
| `fillChangeDiffPane` | provider `change/diff-content` | ✅ | pane `textContent` | ✅ |
| `requestChangeOpenNativeDiff` | Host `change/open-native-diff` | ✅ | `openChangedNativeDiff` | ✅ |
| `openChangeSnapshotDiff` | `openChangedNativeDiff` / Timeline | ✅ | `vscode.diff` | ✅ |
| `atPathExtractBrowserSource` | provider HTML embed | ✅ | Webview `extractAtPathTokens` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → protocol | `change/open-native-diff` + `changeId` | `parseWebviewToHostMessage` 同名同字段 | ✅ |
| Host → extension | `requestChangeOpenNativeDiff(changeId)` | `openChangedNativeDiff` 已注入 deps | ✅ |
| Webview → Host inline | `change/get-diff` → `change/diff-content` | Host 展开 Snapshot 字段回推 | ✅ |
| ref-cards → at-path | `extractAtPathTokens(text)` | Host/Webview 同源规则（browser mirror） | ✅ |
| change-list → identity | `msg.turn` → `data-turn` | `applyMessageIdentity` 写入 | ✅ |
| design.md 帧名 | 表中写 `action/open-native-diff` | 实现统一为 `change/open-native-diff` | ⚠️ 文档名漂移；**运行时全链路一致** |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `data-turn` / activity 共组 | phase-3-activity-stream | 已冻结，未改语义 | ✅ |
| `change/get-diff` / `diff-content` | code-context-diff / 既有 | 复用，未新开引擎 | ✅ |
| `extractAtPathTokens` / AD-CCD-11 | code-context-diff | 复用；删除 provider 双正则 | ✅ |
| `openTimelineDiff` → `openChangeSnapshotDiff` | 既有 Timeline | Timeline 路径改为调用共享 helper | ✅ 兼容 |
| DEBT-CUX-001 extract | Phase Entry | `change-diff-dom` + provider 调用 | ✅ 关闭 |
| GAP-CUX-002 fork | phase-5 | 未实施、未误接 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无 — 关键产品路径均端到端连通，无契约断裂）

### 🟢 Observations
- **design 帧名 vs 实现**：`design.md` 协议表写 `action/open-native-diff`，实现/protocol/host/webview/tests 一律 `change/open-native-diff`。运行时连通，若后续按 design 字面接线会踩空——建议 HG 后改正 design 表，勿改已连通帧名。
- **`message-dom.renderTextBubble(user)`** 仍 `textContent` 无卡；产品路径走 provider `fillUserBubbleWithRefCards`，层 A 亦直接测 ref-cards。注意勿把 user 气泡回退到纯 `renderTextBubble`。
- **Host** `requestChangeOpenNativeDiff?.` 可选链：extension 已注入；若测试 Host 未注入则静默空操作（与同文件其他 optional deps 一致）。
- **at-path browser mirror**：TS 用 `/gu`，browser source 用 `/g`（无 `u`）。ASCII `@path` 行为一致；极端 Unicode 空白边界可能 Host/Webview 微差——非本 Phase 断路，可后续对齐。

## 产出路径
`.specdev/specs/vscode-dsh-chat-ux/phases/phase-4-refs-changes-diff/review-connectivity.md`
