# Design Consistency Review — Phase 4 (phase-4-new-conversation-chrome)

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CR-8：chrome 常驻「新建会话」；窄栏溢出须一次点击或展开+首项可达 | 是 | `chat-panel-provider.ts`：`#newConversationBtn` 文案「新建会话」；`#chromeOverflow` 首项同为新建并 `postMessage({ type: 'action/new-conversation' })` | ✅ |
| AD-CR-8：点击 → `action/new-conversation` → Host 未连先 Start（`command-send`）→ New/reuse + reveal；`dsh.newConversation` 等价 | 是 | `protocol.ts` 含 W→H `action/new-conversation`；`ChatPanelHost` → `requestNewConversation` → `runNewConversationFromPanel` / `runNewConversationShared`（`ensureHostForSend` → `newConversationOrReuseEmpty` → `revealConversationPanel`）；命令走同一 shared 体 | ✅ |
| AD-CR-8：`keybindings` 仅 Should，不得替代按钮 | 是 | 未加 `contributes.keybindings`；README 声明键盘不得替代按钮；implementation 偏差 1 已记录 | ✅ |
| AD-CR-6：仅活动空 Tab 复用；禁止全局 `findEmptyLive` 偷换 | 是 | 共用既有 `ConversationController.newConversationOrReuseEmpty`；控制器逻辑未改写为全局搜空；L2 经按钮路径复验 | ✅ |
| 协议：等待 Start 时 `mode` 为 `waiting-host`/`empty` + `connectionPhase=connecting`，禁止误示可发送 `live` | 是 | `pushFullState`：`connectionPhase === 'connecting'` 时强制 `mode: 'waiting-host'`；Webview `syncComposer` 要求 `mode==='live' && connectionPhase!=='connecting'`；Host `sendPrompt` 仍 `ui/reject-send` | ✅ |
| 协议：H→W `chrome.newConversation`；W→H `action/new-conversation` | 是 | `panel/state.chrome.newConversation.visibility`；解析与路由齐全 | ✅ |
| AD-CU-1 / AD-CR-7：Webview 呈现-only；权威（Start / mode / send gate）不外移 | 是 | Webview 只 post action；Start 经 Orchestrator；mode/chrome 由 Host 投影；发送门禁仍在 Host | ✅ |
| AD-CR-11：主落点 `apps/vscode-dsh/`；不改 agent-loop | 是 | 变更限于 vscode-dsh 源码 / 测试 / README / registry | ✅ |
| DEBT-003（入口 Gate）：Continue 对齐 ensureHost | 是 | `requestContinue` 先 `ensureHostForSend` 再 `continueConversation`；registry 标已解决 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 / 改动面 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `action/new-conversation` + `chrome.newConversation` | `apps/vscode-dsh/src/chat-panel/protocol.ts` | ✅ | 协议增量落在既有 AD-CU-1 协议面 |
| New 路由 / connecting mode | `chat-panel-host.ts` | ✅ | Host 拥有投影与 inbound action |
| 「新建会话」DOM/CSS/溢出 | `chat-panel-provider.ts` `buildThinChatHtml` | ✅ | 与 phase-3 chassis 同处，未另起 UI 栈 |
| `runNewConversationShared` | `extension.ts` | ✅ | 命令与面板共享产品路径，避免双实现漂移 |
| L2 套件 | `apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts` | ✅ | 与既有 phase-* 命名一致 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 协议 type | `action/new-conversation` | 既有 `action/*` 斜杠命名 | ✅ |
| Host dep | `requestNewConversation` | 与 `requestContinue` / `requestDelete` 对称 | ✅ |
| Shared helper | `runNewConversationShared` / `FromCommand` / `FromPanel` | 清晰区分入口与共享体 | ✅ |
| DOM id | `newConversationBtn` / `chromeOverflow` | 与既有 `continueBtn` camelCase 一致 | ✅ |
| 文案 | chrome「新建会话」vs Tab `EMPTY_LIVE_TITLE`「新对话」 | design / exploration 约定区分入口与 Tab 标题 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | Orchestrator 仍管 Start；Controller 管 Tab；Host 管协议投影；Webview 只呈现 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 无 `packages/core` 反向依赖；改动停在扩展应用层 |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | W↔H 仅经协议消息与注入 deps；未直调 Webview 内逻辑启动 Host |

## waiting-host / chrome / authority 焦点核对

### waiting-host（AC-22 / design 协议节）
- Host 在 connecting 期间将 `panel/state.mode` 压成 `waiting-host`，即使仍有活动 Tab / session 字段（implementation 偏差 2）。
- 该偏差**不违背** design 明文：「`mode` 保持 `waiting-host` / `empty` + `connectionPhase=connecting`，**禁止**误示 `live`」——session 字段保留属于呈现连续性，权威仍由 Host mode 裁定。
- Composer 禁用 + Host `ui/reject-send` 双闸，符合 spec「等待 Start 期间发送门禁仍由 Host 兜底」。

### chrome（AD-CR-8 / AC-15）
- 主入口为常驻文案按钮，非图标-only 唯一替代。
- 溢出菜单首项同为「新建会话」，满足「展开+首项」可达；主按钮未藏入二级深处。
- `chrome.newConversation` 默认 / 推送为 `enabled`，覆盖连接中等常见态（AC-15）。

### 无 authority drift
- Webview **不**自行调用 Start / Orchestrator；仅 `action/new-conversation`。
- New 与 Continue 均经 `ensureHostForSend` → `request('command-send')`，与 AD-CR-1/2 启动类边界一致。
- 未引入第二套「可否发送」权威源；Webview 对 `connectionPhase` 的检查是跟随 Host 投影的呈现闸，非独立裁定。

## 关键发现
### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- AC-34 keybindings 未实现：符合 AD-CR-8「Should、不得替代按钮」；已在 implementation 偏差 1 与 README 记录。
- connecting 时 `mode=waiting-host` 仍带 `sessionId`/`messages`：与 design 禁止误示 live 一致；已记偏差 2，利于等待期不闪空。
- `#chromeOverflow` 在 `syncNewConversationChrome` 中常设 `hidden=false`（主按钮同时可见）。略宽于「仅窄栏溢出」字面，但主入口仍是文案按钮且溢出首项等价，不构成 AD-CR-8 违反。
- DEBT-003 关闭后 Continue 与 New 共享 ensureHost 路径，降低命令 vs 面板权威漂移风险。
