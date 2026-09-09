# 正确性审查 — phase-4-new-conversation-chrome

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-15 | 顶栏常驻「新建会话」；常见态可见可点；窄栏一次点击或展开+首项可达 | `chat-panel-provider.ts` `#newConversationBtn` + `#chromeOverflow` / `#newConversationOverflowBtn`；`chat-panel-host.ts` `pushFullState` 恒推 `chrome.newConversation.visibility=enabled` | ✅ | 文案按钮常驻；`flex-wrap` + overflow 首项同为「新建会话」且 `postNewConversation`；Host 不按 mode 隐藏；L2 HTML 断言通过 |
| AC-21 | 按钮为产品主入口；不将 keybindings 列为 Must | `chat-panel-provider.ts` chrome；`package.json` 无 `contributes.keybindings`；`README.md` AD-CR-8 节 | ✅ | 协议 `action/new-conversation` 可解析；无 Must keybinding 门禁 |
| AC-22 | 未连点击 → Start → 等待「正在连接到 Host…」→ 非可发送 live → 成功后 live + 聚焦；失败走 AC-2 | `extension.ts` `runNewConversationShared`/`ensureHostForSend`；`connection-ui.ts` connecting 文案；`chat-panel-host.ts` connecting→`mode=waiting-host`；Webview `syncComposer` | ✅ | L2：connecting 期间 `mode≠live` + banner；`sendPrompt`→`no-host`；成功后 live + `conversationShow`；缺凭证 → failed/`missing-credentials`、无 controller |
| AC-23 | 已连点击 → 新 Tab 或 AC-6 复用 → 聚焦 → live | `runNewConversationShared` → `newConversationOrReuseEmpty` + `revealConversationPanel` + `pushFullState` | ✅ | L2：有内容时 Tab+1、`mode===live`、reveal 被调用 |
| AC-24 | L2：协议/命令驱动；需新建时 Tab+1 且 live；复用不叠空 | `tests/phase4-new-conversation-chrome.spec.ts` AC-23/24 + AC-6 | ✅ | 可编程断言 Tab 计数与 `panel/state.mode===live`；非截图唯一证据 |
| AC-6 | 活动空 Tab 复用；活动有内容不跳到其它空 Tab | `conversation-controller.ts` `newConversationOrReuseEmpty`；按钮路径经 `action/new-conversation` | ✅ | L2：(a) 空活动 Tab 连续新建 tabs=1；(b) 有内容+遗留空 → Tab+1 且 active≠leftover |
| AC-34 `[Should]` | 若提供 keybindings 则等价；不替代按钮 | 未实现 keybindings；README 声明 | ✅ | Should 未做 keybindings；不削弱按钮（偏差已记） |

## 桩代码检测

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-003 | `extension.ts` `createPanelHost.requestContinue` | ✅ 已关闭 | 现 `await ensureHostForSend` → `continueConversation` → `pushFullState`；L2 离线 Continue → connecting → connected；registry「已解决」 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | — |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- AC-34 未实现 `contributes.keybindings`（spec 为 Should）；README 已声明不替代顶栏按钮——可接受偏差。
- connecting 且已有 Tab 时 `mode=waiting-host` 仍带 `sessionId`/消息（实现偏差 2）；composer 与 Host `sendPrompt` 双门禁保证非可发送 live，符合 AC-22。
- `#chromeOverflow` 在首次 `panel/state` 后恒显示（非仅窄栏）；主按钮始终可达，不损害 AC-15。
- Vitest：`phase4-new-conversation-chrome.spec.ts` — 9/9 passed（本审查复跑确认）。

## DEBT-003 关闭确认

| 检查项 | 结果 |
|--------|:----:|
| `requestContinue` 含 `ensureHostForSend` | ✅ |
| 与 `dsh.continueConversation` 对称（先 Start） | ✅ |
| registry 移入「已解决」、活跃表为空 | ✅ |
| L2 覆盖离线 Continue auto-start | ✅ |
