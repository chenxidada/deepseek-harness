# 连通性审查 — phase-3-chat-ui-chassis

## 视角
**集成连通性** — 模块间是否真正端到端连通

## 判决
**PASS**

## 端到端路径追踪

### 路径 1：主题刷新（AC-8a）
```
入口: onDidChangeActiveColorTheme / activate / onViewResolved
  → extension.pushActiveTheme
    → ColorTheme.kind → light|dark|high-contrast
    → panelHost.pushThemeKind → ui/theme          ✅
  → Webview applyThemeKind → body.theme-*         ✅
  原生 --vscode-* 仍为主驱动（AD-CR-7）            ✅
出口: 主题 class + CSS 变量刷新
```
**判定**: ✅ 完整。首屏若早于 attach，靠 onViewResolved 补推，已接通。

### 路径 2：Composer Enter→发送（AC-12）
```
入口: #input keydown → resolveComposerKeydown
  → send → sendComposer → composer/send           ✅
  → ChatPanelHost.sendPrompt → acceptSend
    → ConversationController.promptActive         ✅
  Shift+Enter → newline，不发 send                ✅
出口: Host 门禁发送（权威未变）
```
**判定**: ✅ Enter/Shift+Enter 与 Host 发送链连通。

### 路径 3：MD 渲染→复制→dsh.copyToClipboard（AC-16/17）
```
入口: messages/replace|append
  → renderSafeMarkdown → Copy 按钮
  → action/copy-code → requestCopyCode
  → executeCommand('dsh.copyToClipboard')
  → clipboard.writeText + 成功提示                ✅
出口: 剪贴板写入（命令非菜单主入口）
```
**判定**: ✅ 全链连通。

### 路径 4：Conversations 空态标签（AC-19）
```
EMPTY_LIVE_TITLE「新对话」
  → auto-ready / controller / tab-bar 同源        ✅
  → 空 registry → []（无命令标题堆砌）             ✅
```
**判定**: ✅ 连通。

### 路径 5：History 滤空→回放（AC-19a/AC-20）
```
listHistorySessions → isHistoryEligibleSession
  → History 行 → dsh.openHistory
  → openFromHistory → panel/state replay          ✅
```
**判定**: ✅ 过滤与回放路径均连通。

### 路径 6：panel/state 权威仍在 Host（AC-25）
```
Host 推 panel/state；Webview 只跟 mode
composer/send 仍经 Host 门禁；无第二套面板权威    ✅
```
**判定**: ✅ 权威未外移。

## 上下游连接检查

| 新函数/组件 | 上游 | 状态 | 下游 | 状态 |
|------------|------|:--:|------|:--:|
| `pushActiveTheme` | 主题监听 / activate / onViewResolved | ✅ | `pushThemeKind` | ✅ |
| `pushThemeKind` | `pushActiveTheme` | ✅ | Webview `ui/theme` | ✅ |
| `resolveComposerKeydown` | `#input` keydown | ✅ | `composer/send` | ✅ |
| `renderSafeMarkdown` | `renderBubble` | ✅ | DOM + Copy 接线 | ✅ |
| `action/copy-code` | Copy 点击 | ✅ | `dsh.copyToClipboard` | ✅ |
| `EMPTY_LIVE_TITLE` | auto-ready / controller | ✅ | Tab 标签 | ✅ |
| `isHistoryEligibleSession` | `listHistorySessions` | ✅ | History 列表 | ✅ |
| `dsh.openHistory` | History 点击 | ✅ | `openFromHistory` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview→Host | `action/copy-code` + text | parse + Host 处理 | ✅ |
| Host→Webview | `ui/theme` + themeKind | `applyThemeKind` | ✅ |
| Host→命令 | `dsh.copyToClipboard` | 注册并写剪贴板 | ✅ |
| Tab 栏←标题 | 空 live→「新对话」 | `EMPTY_LIVE_TITLE` | ✅ |
| History←index | 排除空 live | `isHistoryEligibleSession` | ✅ |
| Webview←Host | 仅跟 `panel/state` | HTML 赋值 mode | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 | 接口状态 | 连接 |
|--------------|:--:|:--:|:--:|
| panel/state / composer/send | 前序 | 权威语义未改；仅增 theme/copy 帧 | ✅ |
| ConnectionUi 投影 | phase-1 | 仍 Host 投影 | ✅ |
| AutoReady 空 live 标题 | phase-2 | 改用「新对话」常量 | ✅ |
| openFromHistory 回放 | 前序 | 签名未改 | ✅ |
| DEBT-003 | →phase-4 | 未触碰 | ✅ |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- 主题首推依赖 `onViewResolved` 补推；生产路径已接通。
- keydown / safe-MD 存在 TS 与 Webview 内联双份；当前对齐，注意后续漂移。
- `requestCopyCode?.` 可选；`createPanelHost` 已接线。
- L4 截图仅路径约定，不影响连通。
