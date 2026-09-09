# 代码库探索报告 — phase-4-new-conversation-chrome

## 1. Task Context（任务上下文）

`vscode-dsh-chat-ready` 的 Phase 4 交付 Conversation 面板 **chrome 产品主入口「新建会话」**（AC-15/21–24）：顶栏/chrome **常驻可达**（窄栏：一次点击或溢出展开+首项），经 Webview `action/new-conversation`（和/或 command id）走与 `dsh.newConversation` 等价的 Host 路径——**未连则先 Start**（`ensureHostForSend` → `AutoStartOrchestrator.request('command-send')`），等待 UI 展示「正在连接到 Host…」或等价文案（`connectionPhase=connecting`），完成前**不得**误示可发送 `live`；成功后 `ConversationController.newConversationOrReuseEmpty`（AD-CR-6）+ 聚焦面板 → live。同时 **在本 Phase 修复 DEBT-003**：Webview `action/continue` 必须与发送/新建类命令一样走 auto-start / `ensureHostForSend`。依赖 phase-1 Orchestrator + phase-3 底盘；**不**硬依赖 phase-2（复用 API 已落地）。范围外：重做建连/就绪核心、Markdown/主题大改。`code2prompt` 不可用 — 地图由 Grep/Read 建立（👁）。phase-1/3 探索为背景；本报告为 **Phase 4 更新版**。

## 2. Repository Overview（仓库概览）

| 项 | 现状 |
|----|------|
| 包 | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| 语言 | TypeScript ESM；Node Vitest L1/L2/L3 使用 duck-typed `vscode` |
| 入口 | `apps/vscode-dsh/src/extension.ts`（`activate` / `deactivate`） |
| 自动建连（已完成） | `src/auto-start-orchestrator.ts` + `ensureHostForSend` → `request('command-send')` |
| 自动就绪（已完成） | `src/auto-ready-coordinator.ts`（调用 `newConversationOrReuseEmpty`） |
| 连接态投影（已完成） | `src/connection-ui.ts` → `ChatPanelHost.applyConnectionState` |
| 空 Tab 复用（已完成） | `ConversationController.newConversationOrReuseEmpty`（AD-CR-6） |
| Chat Webview 底盘（已完成） | `src/chat-panel/` — `#chrome` 仅有 Continue / 查看更多；**无**新建按钮 |
| 协议 | `protocol.ts` — **无** `action/new-conversation`；**无** `chrome.newConversation` 字段 |
| 命令 | `package.json` 有 `dsh.newConversation`；**无** `contributes.keybindings` |
| 测试 | Vitest：`apps/vscode-dsh/tests/`（`phase1-*`、`phase2-auto-ready`、`phase3-*` 等） |
| 分支 | `impl-phase-4-new-conversation-chrome`（勿切换） |
| 债务 | 仅 **DEBT-003** 活跃 → 目标本 Phase（用户：本 Phase 优先解决）；无其它活跃桩 |

## 3. Most Relevant Areas（最相关区域）

| 路径 | 对本 Phase 的意义 | 来源 |
|------|-------------------|------|
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — `buildThinChatHtml` `#chrome`（约 L330–333） | **主 UI**：常驻「新建会话」+ 窄栏溢出；点击 → `action/new-conversation`；随 `panel/state` 同步 | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 增加 `action/new-conversation` 及 parse；可选 H→W `chrome.newConversation`（见 design 协议表） | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 处理新 action；增加 `requestNewConversation?`；等待/`connectionPhase` 不得暗示可发送 live | 👁 |
| `apps/vscode-dsh/src/extension.ts` — `dsh.newConversation`（约 L340–350）、`ensureHostForSend`（约 L1346–1349）、`createPanelHost` 的 `requestContinue`（约 L1010–1014） | 命令 New 已走 ensure + 复用空 Tab；**DEBT-003**：面板 Continue 旁路 ensure；面板 New 应共享同一实现并 reveal | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` — `newConversationOrReuseEmpty`（约 L212–219） | 直接复用（AD-CR-6）；phase-2 已有 L2 — **按钮路径须复验** | 👁 |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` — `request(reason)` | Start 合流；New/Continue 用 `command-send` | 👁 API 不变 |
| `apps/vscode-dsh/src/connection-ui.ts` — connecting 文案 | 投影 `'Connecting to Host…'`（英文 ≡ AC-22「或等价」）；中文可选 | 👁 |
| `apps/vscode-dsh/src/auto-ready-coordinator.ts` | 已调用 `newConversationOrReuseEmpty`；**勿**重设计，仅保证 chrome New 不漂移 | 👁 |
| `apps/vscode-dsh/package.json` | 有 commands/menus；**无** keybindings（AC-34 Should 可选）；无视图标题菜单挂 New | 👁 |
| `apps/vscode-dsh/README.md` | 已文档化 New auto-start；Webview New / Continue 矩阵变更时更新 | 👁 |
| `apps/vscode-dsh/tests/phase2-auto-ready.spec.ts` — AD-CR-6 | 活动空 Tab 复用；phase-4 补按钮/协议 L2 | 👁 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | `getConnectionPhase()` connecting/failed，供 AC-22 L2 | 👁 |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | Continue HTML + `action/continue` — 扩展覆盖 DEBT-003 | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | FakeWebview 协议基线 | 👁 |
| 预期新测 | 如 `phase4-new-conversation-chrome.spec.ts` — AC-15/22/23/24/6 + DEBT-003 | 👁 spec |
| L2 钩子 | `dsh.test.panelSnapshot`、`dsh.test.getStartState`、`getChatPanelHost()?.getConnectionPhase()`、registry `snapshot()` Tab 数 | 👁 |
| `.specdev/.../design.md` AD-CR-8/6 + 协议表 | chrome + 等待 Start + 空 Tab 复用权威 | 👁 |
| `.specdev/.../tech-debt-registry.md` | 本 Phase 仅 DEBT-003 | 👁 |

**今日缺失（Phase 4 须交付）：**

- 常驻 chrome「新建会话」+ 窄栏可达
- `action/new-conversation` 协议 + Host 处理 ≡ `dsh.newConversation`（ensure → New/复用 → reveal）
- 该点击路径的等待 Start UX（connecting banner；composer 非可发送 live）
- DEBT-003：`requestContinue` 先 `ensureHostForSend`（或共享 helper）再 continue
- L2：按钮/协议新建、未连先 Start、按钮路径 AC-6；可选 AC-34 keybindings + README

## 4. Key Entry Points / Call Paths（关键入口 / 调用路径）

### 路径 A — 今日命令 New（chrome 模板）✅ CONFIRMED

```
用户：命令面板 / API
  → dsh.newConversation（extension.ts ~L340）
       → await ensureHostForSend(vscode)
            → 若 host?.status === 'connected' 则 return
            → 否则 await orchestrator.request('command-send')
                 → AutoStartOrchestrator FSM → StartHostPort.start
                 → ConnectionUiController.projectOrchestrator
                      → phase connecting + message 'Connecting to Host…'
                      → ChatPanelHost.applyConnectionState → panel/state + ui/banner
       → requireConversations() / newConversationOrReuseEmpty(EMPTY_LIVE_TITLE)
       → panelHost?.pushFullState()
       → showInformationMessage(…)
       ✗ 未显式调用 revealConversationPanel / dsh.showPanel
```

✅ **已确认：** 命令侧 New 的发送类 auto-start 已完整。Phase-4 chrome 须复用（抽 `runNewConversation` / `executeCommand('dsh.newConversation')` / panel dep 同体）。AC-22 还要求成功后**聚焦面板** — Webview 驱动时命令路径可能需补 reveal。

### 路径 B — 目标 chrome New（缺口）— design AD-CR-8

```
Webview #newConversationBtn 点击（chrome 常驻；窄栏可溢出）
  → postMessage { type: 'action/new-conversation' }
  → ChatPanelHost.onWebviewMessage
       → deps.requestNewConversation?.()   ← 新增
            → 同路径 A（ensureHostForSend → newConversationOrReuseEmpty）
            → reveal Conversation webview
  Start 等待期间：
       connectionPhase === 'connecting'
       banner: Connecting /「正在连接到 Host…」
       syncComposer：不得当作可发送 live
            （今日：mode==='live' 即启用 composer — 见风险 R1）
  成功后：mode live（或复用空 Tab）+ 面板聚焦
```

✅ **已确认缺口：** `#chrome` 仅 `continueBtn` + `restoreMoreBtn`；协议无 `action/new-conversation`；Host 无 `requestNewConversation`。

### 路径 C — DEBT-003 Continue 不对称 ✅ CONFIRMED

```
命令：
  dsh.continueConversation → ensureHostForSend → continueConversation()   ✅

Webview：
  continueBtn → action/continue
    → ChatPanelHost → deps.requestContinue
         → 仅 conversations?.continueConversation()     ❌ 无 ensureHostForSend
         → conversations === undefined 时静默 return
```

✅ **已确认** 与 registry DEBT-003 一致。修复：在 `requestContinue` 内镜像命令路径（先 ensure 再 continue；处理未绑定 Host）。

### 路径 D — AD-CR-6 复用（已交付）✅ CONFIRMED

```
newConversationOrReuseEmpty(title?):
  active = registry.getActive()
  if active && !messages.hasContent(active.sessionId):
       聚焦复用活动 Tab   // Tab 数不 +1
  else:
       newConversation(...) // 禁止 findEmptyLive() 全局偷换
```

✅ Phase-2 L2 覆盖 Controller；Phase-4 须证明 **按钮/协议** 路径（AC-6 / AC-24）。

### 路径 E — 等待 / 发送门禁基线 ✅ CONFIRMED

```
sendPrompt:
  !isHostReady() → ui/reject-send 'no-host'   // Host 门禁

Webview syncComposer:
  live = (mode === 'live') → 启用 input/send
  // 今日未参考 connectionPhase
```

设计（协议节）：等待 Start → mode 为 `waiting-host`/`empty` + `connectionPhase=connecting`，**禁止**误示可发送 `live`。Implementer 须用路径 E 对齐 AC-22（见 §7 R1）。

## 5. Likely Impact Surface（影响面）

| 区域 | 变更类型 | 风险 |
|------|----------|------|
| `chat-panel-provider.ts` HTML/CSS/JS chrome | **新增** New 按钮 + 溢出 CSS；点击；可选 `chrome.newConversation` 同步 | 中 — 窄栏 AC-15 |
| `protocol.ts` | **新增** W→H `action/new-conversation`；可选 H→W chrome 字段；parse | 低 |
| `chat-panel-host.ts` | Handler + deps；connecting 时 mode/composer | 中 — AC-22 live vs connecting |
| `extension.ts` `createPanelHost` | 接线 `requestNewConversation`；**修** `requestContinue`（DEBT-003）；reveal helper | 中 — 共享 ensure |
| `connection-ui.ts` / banner 文案 | 可选中文「正在连接到 Host…」；英文已可作等价 | 低 |
| `package.json` | 可选 Should keybindings 仅绑 `dsh.newConversation` | 低 |
| `README.md` | Webview New ≡ 命令；Continue auto-start | 低 |
| 新 `tests/phase4-*.spec.ts` | L2 AC-22 序列、AC-23/24 Tab 数、按钮 AC-6、DEBT-003 | 中 — 证据硬性 |
| `conversation-controller.ts` | 预计 **不变** | 低 |
| Orchestrator / AutoReady | 预计 **不变** | 低 |

## 6. Existing Constraints / Conventions（既有约束）

- **AD-CU-1 / AD-CR-7：** Webview 仅呈现；Host 拥有 mode/session/发送门禁；Webview 脚本不得自行 Start，只 post action。
- **AD-CR-8：** 按钮为产品主入口；键盘为 Should，不得替代/削弱 chrome。
- **AD-CR-6：** 仅复用**活动**空 Tab；禁止全局偷换。
- **AD-CR-1/2：** Start 只经 Orchestrator `request`；`ensureHostForSend` 使用 `'command-send'`。
- **AD-CR-10：** L2 可编程证据 — Tab 数用 registry/`panelSnapshot`；live 用 `panel/state` 的 `mode` + 非 connecting；AC-24 禁止仅靠截图。
- **空标题：** `EMPTY_LIVE_TITLE = '新对话'`；按钮文案「新建会话」与 Tab 标题不同。
- **发送门禁：** Host `sendPrompt` + `ui/reject-send` 仍为等待期兜底。
- **测试钩子：** 仅 `VSCODE_DSH_TEST` 或注入 vscode 时注册 `dsh.test.*`。
- **文案：** 本扩展面板内多为硬编码中/英字符串 — 沿用现有模式（`apps/vscode-dsh` 无 chrome 字典）。
- **禁止**把「新建会话」藏在二级菜单深处。

## 7. Risks / Unknowns（风险 / 未知）

| ID | 主张 | 确认度 | 说明 |
|----|------|:------:|------|
| R1 | `connectionPhase=connecting` 且已有活动 Tab 时，`pushFullState` 仍设 `mode: 'live'`，Webview 会启用 composer — 可能违背 AC-22/设计「不可误示可发送 live」 | ✅ CONFIRMED | 冷启动无 Tab → `waiting-host` OK；有 Tab 重连/Start 中需显式按 connecting 禁用 |
| R2 | 命令 New 不调 `revealConversationPanel`；Webview New Must 聚焦面板 — 需抽取并补 reveal | ✅ CONFIRMED | 已有 `dsh.showPanel` / `revealConversationPanel`（约 L277、L1321） |
| R3 | Connecting 文案为英文；AC-22 允许「或等价」 | ✅ CONFIRMED | 可选改为「正在连接到 Host…」 |
| R4 | 窄栏：仅 `#chrome { flex-wrap: wrap }`，**无**溢出菜单；wrap 或可「可达」，但 AC-15 拒绝仅图标替代 | ⚠️ HYPOTHESIS | 需有意的溢出+文案或保证文本按钮仍可达 |
| R5 | 面板内 `executeCommand('dsh.newConversation')` 可能每次弹出 InformationMessage | ⚠️ HYPOTHESIS | 宜内部共享函数免 toast，或 Webview 路径抑制 |
| R6 | Should：新建后回收其它非活动空 Tab（AD-CR-6 Should）— 非 Must | ✅ CONFIRMED design | 有余力再做 |
| R7 | `panelSnapshot` 不含 `connectionPhase` — AC-22 L2 可用 `getConnectionPhase()` + outbound log | ✅ CONFIRMED | phase-1 测试已用 |
| R8 | DEBT-003 修复在已连接时不得二次 Start（ensure 短路） | ✅ CONFIRMED | `ensureHostForSend` 已连即 return |

## 8. Uncertain / Unverified（未核实）

- VS Code WebviewView 窄宽下 `#chrome` flex-wrap 真实行为 — 未在 IDE 实测（❓ UNKNOWN）；按 AC-15 用 L3 字符串/CSS 断言 + L4 辅助。
- 冷 Start 时 `orchestrator.request` 完成后、New 前 `conversations` 是否必定已 bind — 未逐行复读全部 `StartHostPort` 接线（⚠️ HYPOTHESIS：与已绿的命令 New / phase-1 L2 同路径）。
- `dsh.test.continue`（约 L765）是否也旁路 ensureHost — 疑为仅测试钩子；写 DEBT-003 测试时核对（⚠️ HYPOTHESIS）。
- Feature 收口 AC-27 四条回归入口存在于前序套件；verification 须逐条勾选（✅ 需求确认；⚠️ 各条对应哪份测试入口待定）。

## 9. Stub Detection & Registry Cross-Validation（桩检测与注册表交叉校验）

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-003 | `apps/vscode-dsh/src/extension.ts` `createPanelHost` → `requestContinue`（约 L1010–1014）；Webview `action/continue` | Continue 不经 `ensureHostForSend`；命令路径会 auto-start | ✅ 仍是：仅 `await controller.continueConversation()`；**无** `ensureHostForSend`。对比：`dsh.continueConversation`（约 L593–596）**有** `await ensureHostForSend(vscode)` | ✅ 匹配 — **本 Phase 修复** |
| — | `action/new-conversation` / `#newConversationBtn` | 未注册 | **不存在** — Phase 4 Must 功能缺口，非空壳桩函数 | ⚪ 缺口（非桩）— 本 Phase 交付 |
| STUB-001 / DEBT-001 / DEBT-002 | （已解决） | 已解决 | 未作为活跃项复扫；AutoReadyCoordinator 存在 | ✅ 保持已解决 |

### Stub Detection Summary

- ✅ 与 registry 匹配的已确认债务/桩：**1**（DEBT-003 — 本 Phase 修复）
- ⚠️ Registry 不一致：**0**
- 🔴 未注册桩：**0**（未发现 `@STUB` / 空壳 New handler）
- ⚪ 预期功能缺口：chrome New UI + `action/new-conversation` + Host 接线 + 可选 keybindings

**无需升级：** DEBT-003 已注册、🟡 非阻塞，且 Entry Gate 已选 **a) 本 Phase 优先解决**。缺失的新建 chrome 是本 Phase Must 交付物，不是未注册桩。

## 10. Recommended Next Reads（推荐阅读）

1. ⭐ **必读** — `apps/vscode-dsh/src/extension.ts`：`dsh.newConversation`、`ensureHostForSend`、`createPanelHost.requestContinue`、`revealConversationPanel`
2. ⭐ **必读** — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts`：`#chrome` HTML + `syncChrome` / `syncComposer` / `syncConnection`
3. ⭐ **必读** — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts`（`onWebviewMessage`、`applyConnectionState`、`pushFullState`）
4. ⭐ **必读** — `apps/vscode-dsh/src/conversation-controller.ts` 的 `newConversationOrReuseEmpty` + `message-store.ts` 的 `hasContent`
5. 🔷 **宜读** — `apps/vscode-dsh/src/connection-ui.ts` connecting 投影
6. 🔷 **宜读** — `tests/phase2-auto-ready.spec.ts`（AD-CR-6）、`phase1-auto-start.spec.ts`（connectionPhase）、`phase3-restart-continue.spec.ts`（Continue 协议）
7. 🔷 **宜读** — `.specdev/specs/vscode-dsh-chat-ready/design.md` AD-CR-8/6 + Host↔Webview 协议表（约 L202–213）
8. 🔹 **可选** — `package.json` contributes；`README.md` Auto-start 矩阵；`auto-start-orchestrator.ts` 的 `request`
9. 🔹 **可选** — 前序 `phases/phase-3-chat-ui-chassis/repo-exploration.md` §Path G DEBT-003；`tech-debt-registry.md`
