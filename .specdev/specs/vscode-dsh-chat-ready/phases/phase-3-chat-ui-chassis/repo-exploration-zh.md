# 代码库探索报告 — phase-3-chat-ui-chassis

## 1. Task Context（任务上下文）

`vscode-dsh-chat-ready` 的 Phase 3 要在既有**极薄 Conversation Webview**上交付**可用级 Chat UI 底盘**，且不把 mode/session 权威外移到 Webview（AD-CR-7 / AD-CU-1 / AC-25）。范围：`--vscode-*` 主题基线与主题切换刷新（AC-8/8a）；user/assistant 可区分气泡分层（AC-9）；生成中指示与空闲清除（AC-10）；固定底栏 + Enter 发送 / Shift+Enter 换行（AC-11/12）；Connecting/失败态可读呈现加固（基于 phase-1 投影缝）；**安全** Markdown 最小集（标题/列表/围栏代码块 + 经 `dsh.copyToClipboard` 复制，AC-16/16a/17）；Conversations/History 侧栏 IA（空 live=「新对话」；History 不列空 Tab；空态不堆砌命令标题 — AC-19/19a/20）。视觉 B1–B3 证据链 = L2/L3 主 + L4 截图辅助（AC-7a）；VP-CR-6 **必须**拆成四个可独立运行用例（`theme-tokens` / `bubble-layers` / `composer-contrast` / `visual-evidence-chain`）。**不在范围：**顶栏「新建会话」chrome 与等待 Start 产品流（phase-4 / AC-15/21–24）；DEBT-003 Continue 自动建连留到 phase-4。依赖已合入 master 的 phase-1 `AutoStartOrchestrator` 与 phase-2 `AutoReadyCoordinator`。本环境无 `code2prompt` — 地图由定向 Grep/Read 建成（👁）。phase-2 探索仅作背景；本报告为 **Phase 3 更新版**。

## 2. Repository Overview（仓库概览）

| 项 | 现状 |
|----|------|
| 包 | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| 语言 | TypeScript ESM；Node Vitest L1/L2/L3 使用 duck-typed `vscode` |
| 入口 | `apps/vscode-dsh/src/extension.ts`（`activate` / `deactivate`） |
| 自动建连（已完成） | `src/auto-start-orchestrator.ts` + `extension.ts` 内 `StartHostPort` |
| 自动就绪（已完成） | `src/auto-ready-coordinator.ts`（取代 LatchSeam）；可见性 + `started` 接线 |
| 连接投影（已完成） | `src/connection-ui.ts` → `ChatPanelHost.applyConnectionState` |
| 对话核心 | `conversation-controller.ts` + `conversation-registry.ts` + `message-store.ts` + `extension-index.ts` |
| Chat Webview | `src/chat-panel/` — `chat-panel-provider.ts`（`buildThinChatHtml`）、`chat-panel-host.ts`、`protocol.ts` |
| 侧栏 | `conversation-tab-bar.ts`（`dsh.conversations`）、`history-view.ts`（`dsh.history`） |
| Media | 仅有 `apps/vscode-dsh/media/dsh.svg` — **尚无** `chat-panel.css` |
| 测试 | `apps/vscode-dsh/tests/` 下 Vitest（`panel-l2-l3-protocol.spec.ts`、phase1/2 套件等） |
| 分支 | `impl-phase-3-chat-ui-chassis`（勿改） |
| 债务 | 仅 **DEBT-003** 活跃 → 目标 **phase-4**；**无** 指向 phase-3 的债 |

## 3. Most Relevant Areas（最相关区域）

| 路径 | 与 Phase 3 的关系 | 来源 |
|------|-------------------|------|
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — `buildThinChatHtml`（约 L130–312） | **主改面**：CSS 令牌、布局（固定底栏）、气泡 class、MD 渲染、Enter/Shift+Enter、复制按钮、可选 themeKind class | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 新增 `action/copy-code`（+ AD-CR-7 可选 `themeKind` H→W）；保持 Host 权威 | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` — `onWebviewMessage` / `FakeWebviewPort` | 处理 `action/copy-code` → 命令；L3 fake 仍是协议口（无 DOM） | 👁 |
| `apps/vscode-dsh/src/extension.ts` | 注册**内部** `dsh.copyToClipboard`；可选 `onDidChangeActiveColorTheme` → 推主题 class；接线 copy | 👁 |
| `apps/vscode-dsh/package.json` `contributes.commands` | 今日无 `dsh.copyToClipboard`；须以内部命令加入（非菜单/快捷键主入口） | 👁 |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` — `conversationTreeItems` | 空 registry → `Start IDE Session…` + Command Palette 描述（**AC-19 反模式**）；空 live 标题为英文 `New conversation` | 👁 |
| `apps/vscode-dsh/src/history-view.ts` + `extension-index.ts` `listHistorySessions` | History 列出全部未删除 session；**无显式空 Tab 过滤**（AC-19a 防御缺口） | 👁 |
| `apps/vscode-dsh/src/connection-ui.ts` + Host `applyConnectionState` | Connecting/失败 banner 已投影 — phase-3 仅**呈现**加固 | 👁 |
| `apps/vscode-dsh/src/message-store.ts` `ChatMessage` | `role: user\|assistant\|notice`；`text` 纯字符串 — MD 在渲染层而非 store | 👁 |
| `apps/vscode-dsh/src/auto-ready-coordinator.ts` / orchestrator | 仅集成触点 — 勿重设计；标题仍为 `'New conversation'` | 👁 |
| 可选新建 `apps/vscode-dsh/src/markdown/` 或 `media/chat-panel.css` | design.md 文件计划；抽出可测安全渲染纯函数 | 👁 design + 👁 code |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | 既有 L3 FakeWebview composer/send 基线 | 👁 |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | Continue/查看更多 静态 HTML 断言 — 扩展时小心 | 👁 |
| `apps/vscode-dsh/tests/conversation-registry.spec.ts` | Tab 栏投影单测 | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | History 列表 / `dsh.test.openHistory` / 回放 AC-20 回归 | 👁 |
| 预期新测 | `phase3-chat-ui-chassis.spec.ts`（或拆文件）覆盖 VP-CR-6/6a/7/8/8a/8b/9a/11 | 👁 spec |
| L4 截图 | 尚无；规划 `tests/fixtures/screenshots/` 或 verification 附链 | 👁 |
| `.specdev/.../design.md` AD-CR-7、VP-CR-6…11 | 协议与证据拆分权威 | 👁 |
| `.specdev/.../tech-debt-registry.md` | 仅 DEBT-003；无 phase-3 STUB | 👁 |

**今日缺失（Phase 3 须落地）：**

- 固定/sticky 底栏 + Enter/Shift+Enter 键盘路径
- 安全 Markdown 渲染（标题/列表/围栏 + XSS 否定）与纯文本回退
- `WebviewToHostMessage` / `parseWebviewToHostMessage` 中的 `action/copy-code`
- `dsh.copyToClipboard` 命令（+ Host 调 `env.clipboard.writeText` 或 duck 等价）
- 主题切换刷新（`onDidChangeActiveColorTheme` 和/或文档化原生 `--vscode-*` + 可选 `themeKind`）
- Conversations IA：「新对话」标签；去掉命令标题堆砌空态
- History 空 Tab 排除（显式过滤或可证不变量 + L2）
- 拆分的 L2/L3 视觉证据测试 + L4 截图路径说明
- 可选：`media/chat-panel.css`、`src/markdown/*`

## 4. Key Entry Points / Call Paths（关键入口 / 调用链）

### Path A — 今日极薄面板渲染 + 发送（基线）✅ CONFIRMED

```
registerChatPanelProvider (chat-panel-provider.ts)
  → resolveWebviewView
       → webview.html = buildThinChatHtml(cspSource)
       → panelHost.attach(postMessage / onDidReceiveMessage)
  → Webview 脚本:
       messages/replace|append → renderMessages/appendMessage
            → div.className = 'msg ' + role
            → div.textContent = msg.text          ← 无 Markdown，靠 textContent 安全
       status/set → 'Generating…' | waiting | disconnected | ''
       Send 按钮 click → composer/send { text }
            ✗ textarea 无 keydown Enter / Shift+Enter
  → ChatPanelHost.onWebviewMessage('composer/send')
       → sendPrompt → acceptSend → ConversationController.promptActive
```

**Composer 布局缺口：** `#composer` 只是 `#messages` 后的普通 flex 行（仅 `margin-top`）— **不是** `position: sticky/fixed` 或纵向填满布局。消息一长，底栏会滚出首屏 → AC-11 缺口。

**主题基线（部分）：** body 已用 `var(--vscode-font-family)`、`var(--vscode-foreground)`；气泡用 `var(--vscode-editor-inactiveSelectionBackground)` + `.msg.user` / `.msg.assistant` 左边框。仍偏薄/「灰框」感；无 light/dark class 钩子；`extension.ts` 无 `onDidChangeActiveColorTheme` 监听。

### Path B — 目标 Markdown + 复制（AC-16/16a/17）— 缺口

```
Host messages/replace|append（权威不变）
  → Webview renderBubble(msg)
       → try safeMarkdown(msg.text)   ← 新建纯函数（优先 apps/vscode-dsh/src/markdown/）
            - 默认转义 HTML
            - 标题 / 列表 / 围栏代码
            - 不执行脚本；不加载外链资源
            - 失败 → textContent 纯文本回退
       → 围栏 UI: <pre><code> + [复制]
            → click → postMessage { type: 'action/copy-code', text }
  → ChatPanelHost.onWebviewMessage
       → deps.requestCopyCode?(text) 或 executeCommand('dsh.copyToClipboard', text)
  → extension.ts registerCommand('dsh.copyToClipboard')
       → vscode.env.clipboard.writeText(text)   ← 不作为菜单主 UX
```

✅ **CONFIRMED：** `parseWebviewToHostMessage` **无** `action/copy-code`；`package.json` **无** `dsh.copyToClipboard`；`apps/vscode-dsh` 下无 clipboard API 用法。

⚠️ **HYPOTHESIS：** L3 XSS/MD 测试应打在**纯渲染函数**（或无 jsdom 的字符串断言）上，因 `FakeWebviewPort` 不执行 HTML/JS。

### Path C — 目标键盘 + 固定底栏（AC-11/12）

```
#layout（目标）:
  body { display:flex; flex-direction:column; height:100vh; }
  #messages { flex:1; overflow:auto; }
  #composer { flex-shrink:0; /* 贴底 */ }

#input keydown:
  if Enter && !Shift && !composing:
    preventDefault → post composer/send（非空；Host 仍门禁空串）
  if Shift+Enter:
    允许默认换行 → 必须不 post send
```

✅ **CONFIRMED：** `buildThinChatHtml` 脚本中零 `keydown` / `keypress`。发送仅按钮。

### Path D — 侧栏 IA（AC-19/19a/20）

```
Conversations (conversation-tab-bar.ts):
  snapshot.tabs.length === 0
    → 今日: label 'Start IDE Session…'
             description 'Click here, or use the Command Palette'
             commandId 'dsh.startSession'     ← AC-19「命令标题堆砌」空态
  带 title 'New conversation' 的 Tab（AutoReady / newConversationOrReuseEmpty）
    → tabBarLabel 显示英文；AC-19 要求「新对话」或文档化等价

History (history-view ← listHistoryFromIndex ← ExtensionIndex.listHistorySessions):
  过滤: 仅 deleted !== true
  空 live Tab: 通常直到 promptTab 首条消息才 upsertSession
    → History 里往往本就不出现
  AC-19a 仍需显式过滤或 L2 证明 + 防御性排除

History 行点击 → dsh.openHistory(sessionId)
  → ConversationController.openFromHistory → mode=replay  ✅ 已存在（AC-20 回归）
```

### Path E — 生成中指示（AC-10）— 大体已有

```
ConversationController 在 prompt 期间设 tab.status = 'running'
  → ChatPanelHost.resolveStatus → PanelStatus 'generating'
  → status/set → Webview: 'Generating…'
  → idle → 清为空串
```

✅ **CONFIRMED** 字符串路径存在。Phase-3 或只需加强可见性 + 专测 VP-CR-9a；勿另起第二套状态通道。

### Path F — 连接 chrome（呈现加固）

```
AutoStartOrchestrator snapshot
  → ConnectionUiController.projectOrchestrator
  → ChatPanelHost.applyConnectionState
  → panel/state connectionPhase + ui/banner
  → Webview syncConnection / banner + Retry / Open settings
```

✅ **CONFIRMED** phase-1 缝可用。Phase-3 用 CSS 改善可读性；**不**重做 Start FSM。等待 Start 的「新建会话」属 phase-4。

### Path G — DEBT-003（phase-3 勿修）✅ CONFIRMED

```
Webview Continue → action/continue
  → ChatPanelHost.requestContinue
  → extension: conversations.continueConversation()   ← 无 ensureHostForSend
命令 dsh.continueConversation → ensureHostForSend 后再 continueConversation
```

与 registry DEBT-003 一致 → **phase-4**。

## 5. Likely Impact Surface（影响面）

| 区域 | 变更 | 风险 |
|------|------|:----:|
| `chat-panel-provider.ts` `buildThinChatHtml` | 大幅 CSS/JS 升级（或拆到 `media/chat-panel.css`） | **高** — 覆盖全部视觉 AC；CSP 须保持 `default-src 'none'` |
| 新建 markdown 辅助模块 | 安全渲染 + 回退 + 复制辅助 | **高** — 若滥用 `innerHTML` 引入 XSS |
| `protocol.ts` + `chat-panel-host.ts` | `action/copy-code`；Host 复制回调 | 中 |
| `extension.ts` + `package.json` | `dsh.copyToClipboard`；可选主题监听 | 中 |
| `conversation-tab-bar.ts` | 空态 IA +「新对话」文案 | 中 — 改变自动建连空态体验 |
| `history-view.ts` / `listHistorySessions` | 过滤空会话 | 中 — 过度过滤可能藏掉真历史 |
| `auto-ready-coordinator.ts` / New 标题字符串 | 可选对齐「新对话」 | 低 |
| 既有 `panel-l2-l3-protocol` / Continue HTML 测 | 须保持绿（AC-27） | 中 |
| 新 phase-3 测 + 截图夹具 | VP-CR-6 强制拆分 | 中 |
| `auto-start` / `auto-ready` / agent-loop | **不重设计** — 仅共享标题/chrome 字符串时触碰 | 低 |
| `packages/core/**` | **禁止**（AD-CR-11） | — |

## 6. Existing Constraints / Conventions（既有约束）

- **AD-CU-1 / AC-25：** Webview 跟随 `panel/state`；不裁定 mode/session/发送门禁。Host 经 `ui/reject-send` 拒绝。呈现升级不得引入第二套面板架构或 Webview 自持权威。
- **AD-CR-7：** 优先原生 `--vscode-*` 刷新；可选 Host `themeKind` 广播 — **不要**整表重推 CSS 变量。安全 MD 在 Webview；复制走扩展命令。
- **AD-CR-11：** 不改 `packages/core` / agent-loop。
- **CSP（当前）：** `default-src 'none'; style-src … 'unsafe-inline'; script-src … 'unsafe-inline'` — 外链脚本/图已在 CSP 层阻断；MD 路径不得引入 `http(s):` 加载。
- **消息投影：** `MessageStore` 存纯 `text`；incomplete/notice 已有 — 只动渲染层。
- **空 Tab 规则（AD-CU-3）：** `!messages.hasContent(sessionId)`；空 Tab 永不入持久化 `openTabSet`；首次成功 `promptTab` 才 upsert 索引并持久化。
- **Duck-typed vscode：** L2 用假 vscode activate；clipboard/theme 若要在 Node 断言需 duck 类型。
- **测试门闩 AD-CR-10：** `dsh.test.*` 仅 `VSCODE_DSH_TEST`；键盘/MD/XSS 优先纯函数 + FakeWebview。
- **HG-2 VP-CR-6 拆分：** 四个独立用例 — 禁止一锅烩宣称 AC-7a+8+9+11。
- **文案：** vscode-dsh 目前硬编码英文（如 `Generating…`、`New conversation`）；「新对话」可为中文产品文案或文档化 EN 等价 — 跟 AC-19，勿自造完整 i18n 体系。
- 遵循仓库 AGENTS.md：尾换行、ESM `.ts` import 等。

## 7. Risks / Unknowns（风险 / 未知）

| ID | 项 | 确认度 |
|----|-----|--------|
| R1 | 无 Enter/Shift+Enter — AC-12 在 HTML 脚本中为绿地 | ✅ CONFIRMED |
| R2 | Composer 未固定 — AC-11 布局缺口 | ✅ CONFIRMED |
| R3 | 仅 `textContent` — AC-16 MD 缺失；当前路径 XSS 安全但无结构化 MD | ✅ CONFIRMED |
| R4 | 无 `action/copy-code` / `dsh.copyToClipboard` | ✅ CONFIRMED |
| R5 | Conversations 空态为 Start Session + Command Palette — 违反 AC-19 | ✅ CONFIRMED |
| R6 | 已有 `.msg.user` / `.msg.assistant` — AC-9 或是「加强 + 证据」而非从零发明 | ✅ CONFIRMED |
| R7 | `Generating…` 路径已存在 | ✅ CONFIRMED |
| R8 | 部分使用主题 CSS 变量；无主题变更 Host 钩子 | ✅ CONFIRMED 部分 |
| R9 | MD 若用 `innerHTML` 而无硬化消毒 → 重引 XSS（AC-16a） | ⚠️ HYPOTHESIS（库 vs 手写） |
| R10 | `FakeWebviewPort` 无法驱动真实 keydown/DOM — 需可抽取处理器或轻量 HTML 夹具 | ✅ CONFIRMED 限制 |
| R11 | History 空排除可能已因 upsert 时机成立；仍需 L2 + 可能防御过滤 | ⚠️ HYPOTHESIS |
| R12 | 「新对话」vs 既有 `'New conversation'` 跨 AutoReady/New/Tab 栏一致性风险 | ⚠️ HYPOTHESIS |
| R13 | 真实 VS Code Webview 主题变量是否自动刷新即可满足 AC-8a | ❓ UNKNOWN（未跑 Extension Host） |
| R14 | L4 截图存放约定未建立 | ❓ UNKNOWN |
| R15 | `notice` 角色无独立 CSS（仅 user/assistant 边框） | ✅ CONFIRMED |
| R16 | DEBT-003 Continue 缺口仍在；勿扩进 phase-3 Must | ✅ CONFIRMED |

## 8. Uncertain / Unverified（未核实）

- **VS Code Webview 换色主题时是否自动刷新 `--vscode-*`** — AD-CR-7 优先原生；实施者应验证或加 `themeKind` 双保险以满足 AC-8a。
- **安全 MD 实现选型**（手写子集 vs 小依赖）— 设计拒绝 Host 预渲染 HTML 为首选；`apps/vscode-dsh/package.json` 无现成 markdown 依赖。
- **IME / `isComposing` 下 Enter** — 规格未写；AC-12 边界可考虑。
- **索引中无 `firstUserPreview` 的 session 是否算「空」** — 实施者须对齐 D-11 / 前序空 Tab 定义。
- **`dsh.copyToClipboard` 贡献可见性** — 须可 `executeCommand`，但非菜单/快捷键主入口；是否出现在命令面板取决于 package.json — 需文档化。
- **WebviewView 下 `height:100%` / sticky 底栏真实表现** — 未运行时核验。
- **AC-13/14「呈现加固」幅度** — phase-1 已投影 connecting/failed；phase-3 以 CSS/文案抛光为主，除非 L2 证不可读。
- **前序 conversation-ui 注释中的 AC 编号**（如 tab-bar「AC-9」）指**旧** Feature AC，勿与 chat-ready AC-9 混淆。

## 9. Stub Detection & Registry Cross-Validation（桩检测与登记表交叉校验）

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-003 | `chat-panel` Webview `action/continue` → `extension.ts` `requestContinue`（约 L951–954） | 已知缺陷：Continue 不经 `ensureHostForSend`；目标 **phase-4**；🟡非阻塞 | ✅ 确认：`requestContinue` 仅调 `continueConversation()`；命令路径约 L559 **会** `ensureHostForSend` | ✅ 匹配 — **留给 phase-4** |
| STUB-001 |（已解决）AutoReadyLatchSeam | 已解决 → `AutoReadyCoordinator` | `auto-ready-coordinator.ts` 含真实 apply | ✅ 已解决 |
| DEBT-001 / DEBT-002 | Start restore / 活动栏 | phase-2 已解决 | 未重开 | ✅ 已解决 |
| —（phase-3 目标） | — | **无** 目标Phase=phase-3 条目 | N/A | ✅ 无 phase-3 继承阻塞债 |

### 代码扫描（桩信号）

| 信号 | 结果 |
|------|------|
| `apps/vscode-dsh` 内 `@STUB` / `@STUB(phase-3)` | **无** |
| chat-panel 中 TODO/FIXME 空实现 | **无**阻塞项；极薄 UI 是有意未完成产品，非标注桩 |
| 假装已实现 MD/copy 的硬编码假返回 | 不适用 — 功能**直接缺失**（缺口），非假成功返回 |
| 阻塞 phase-3 主路径的未注册桩 | **无** — 工作是在真实 Host/协议上的绿地呈现 |

### Stub Detection Summary

- ✅ 与 registry 匹配的已确认债/桩：**1**（DEBT-003 — phase-4）
- ⚠️ Registry 不一致：**0**
- 🔴 未注册桩：**0**
- Phase Entry：**无** 指向 `phase-3-chat-ui-chassis` 的 🔴 阻塞债

**给 implementer：** 缺失的 MD/copy/keydown 是**本 Phase 功能缺口**，不是 registry STUB。除非刻意推迟 Must AC（本 Phase Must 必须交付），否则不要标 `@STUB(phase-4)`。

## 10. Recommended Next Reads（建议优先阅读）

1. ⭐ **必读** — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts`（完整 `buildThinChatHtml`）
2. ⭐ **必读** — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts`
3. ⭐ **必读** — `.specdev/specs/vscode-dsh-chat-ready/phases/phase-3-chat-ui-chassis/spec.md`（含 VP-CR-6 拆分备注）
4. ⭐ **必读** — `.specdev/specs/vscode-dsh-chat-ready/design.md` §AD-CR-7 与 VP-CR-6/6a/7/8/8a/8b/9a/11
5. 🔷 **应读** — `apps/vscode-dsh/src/conversation-tab-bar.ts`（空态分支）
6. 🔷 **应读** — `apps/vscode-dsh/src/history-view.ts` + `extension-index.ts` `listHistorySessions` / `upsertSession`
7. 🔷 **应读** — `apps/vscode-dsh/src/extension.ts` 命令注册 + `createChatPanelHost` deps（约 L930–988）+ 测试钩子门闩
8. 🔷 **应读** — `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts`
9. 🔷 **应读** — `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts`（AC-20 基线）
10. 🔹 **可选** — `connection-ui.ts`、`auto-ready-coordinator.ts`（仅标题字符串）、`message-store.ts`
11. 🔹 **可选** — `apps/vscode-dsh/README.md` Conversation 薄面板节（底盘落地后更新）
12. 🔹 **可选** — `.specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md`（仅知悉 DEBT-003）

### Implementer 检查表（派生）

| AC | 当前缺口 | 建议落点 |
|----|----------|----------|
| AC-8/8a | 部分 `--vscode-*`；无主题钩子 | 扩展 CSS 令牌；主题监听或文档化原生刷新 + L2/L3 |
| AC-9 | 基础左边框角色 | 加强气泡分层 + 可测 class |
| AC-10 | 已有 `Generating…` | 证据测试；可选 chrome 抛光 |
| AC-11 | Composer 未固定 | Flex/sticky 底栏 + Send 对比令牌 |
| AC-12 | 无 keydown | 脚本内 Enter/Shift+Enter + L3 夹具 |
| AC-16/16a | 仅 textContent | 安全 MD + XSS 否定夹具 |
| AC-17 | 缺失 | `action/copy-code` + `dsh.copyToClipboard` |
| AC-18 | N/A（负向） | 无表格不判 FAIL |
| AC-19/19a | Start Session 空态 + 英文标题；History 软过滤 | Tab 栏 IA + History 过滤/L2 |
| AC-20 | 已有 | 仅回归 |
| AC-7a | 无拆分视觉套件/截图 | 四个 VP-CR-6 测 + L4 路径 |
| AC-25/27 | — | 保持 Host 权威；抽测发送/回放 |
