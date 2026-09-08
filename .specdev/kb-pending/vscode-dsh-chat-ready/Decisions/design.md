# Design: vscode-dsh-chat-ready

<!--
  slug: vscode-dsh-chat-ready
  audience: implementer / reviewer / verifier / HG-2
  language: zh (canonical). Mirror: design-zh.md
  requirements: .specdev/specs/vscode-dsh-chat-ready/requirements.md (HG-1 confirmed)
  constitution: .specdev/specs/vscode-dsh-chat-ready/constitution.md
  prior-feature: vscode-dsh-conversation-ui (behavior delivered; productization deferred)
  created: 2026-09-08
  revised: 2026-09-08 R2 — VP coverage + AC↔VP traceability matrix
-->

## 范围覆盖

本设计覆盖整个 feature `vscode-dsh-chat-ready`：在已交付的 `vscode-dsh-conversation-ui`（极薄对话面板、可恢复留存、历史回放、Continue、Subagent）之上，交付「点开即可聊」——**自动建连**、**自动就绪**、**可用级 Chat UI 底盘**、顶栏常驻「新建会话」。

对应 `requirements.md` AC-1…AC-34（含 Should AC-28…AC-34）。**不**覆盖 Cursor 全量、token 打字机、工具富卡片、改 agent-loop、双通道权威重做、多窗口协调、Remote 专项等 Out 项。

Phase 拆分见 `phase-plan.md`。各 Phase 细规与逐条验证策略见 `phases/<phase-id>/spec.md`。

## 架构摘要

扩展继续只做**投影 + Host UI + 扩展索引**：权威正文仍在 DSH **权威会话日志**；`mode` / 发送门禁仍跟 Host（继承 **AD-CU-1**）。本 Feature 新增两层编排，均落在 Extension Host，**不**进 Webview 决策：

1. **AutoStartOrchestrator（自动建连）**：可 L1 测试的 start-reason 状态机；仅在活动栏 / Conversation 视图可见 / 启动·发送类命令 / 状态栏触发时 Start；`onStartupFinished` 只注册；查询/删除类不拉起完整建连。
2. **AutoReadyCoordinator（自动就绪）**：仅当 **Conversation 视图可见** 且 Host 就绪时 restore（保持回放、不 Continue、不打未读）或自动 New → live；与 Start **解耦**。

Chat UI 底盘在既有 `chat-panel/` 内做**呈现升级**（主题令牌、气泡、底栏手势、安全 Markdown、侧栏 IA）；顶栏「新建会话」走 Host 编排（未连先 Start + 等待态），Webview 只发协议消息。错误主载体为面板内；面板未开 → 可点击状态栏 → `dsh.showPanel`。

**不改** `packages/core/agent-loop`、不重做双通道。验证以 **L2/L3 为主**；B1–B3 另加 L4 截图辅助；L4 不作 Must 唯一证据。

## 相对前序策略变更

| 主题 | vscode-dsh-conversation-ui 现状 | 本设计 |
|------|--------------------------------|--------|
| Start Host | 手动 `dsh.startSession`；`activate` 仅注册 | **自动建连**（触发收紧）；startup **禁止**仅因激活而 Start |
| 首屏就绪 | Start 后常需再 New；restore 绑在手动 Start | Conversation **视图可见** → 自动 restore 或 New；未开视图不 New |
| 无工作区 | Start 要求 workspace folder | Start **仍可执行**（cwd 降级）；就绪降级直接 New，不 restore |
| 错误提示 | 阻塞 Toast / InformationMessage 为主 | **面板内**为主；未开面板 → **状态栏可点**；缺凭据 → 设置深链 |
| 新建入口 | 命令面板 | 面板顶栏常驻按钮；未连先 Start +「正在连接到 Host…」 |
| UI | 极薄 HTML | **可用级底盘**；仍跟 `panel/state`，无 Webview 自持 mode |
| 空 Tab / 回放 / Continue / Subagent | 已交付 | **继承**；自动路径遵守空 Tab 不入 openTabSet、restore 不 Continue |

## 核心实体 / 数据模型

```typescript
/** start-reason：谁触发了自动建连（L1 可测） */
type StartReason =
  | 'activity-bar'
  | 'conversation-view-visible'
  | 'command-start'      // dsh.startSession 等启动类
  | 'command-send'       // newConversation / promptActive 等发送类
  | 'status-bar'
  | 'manual-retry'      // 面板/状态栏重试
  | 'disconnect-retry'  // 断线自动重试（至多一次）

/** AutoStartOrchestrator 状态（AC-1d） */
type StartOrchestratorState =
  | 'idle'
  | 'starting'
  | 'pending-start'  // starting 期间又来 reason，完成后统一结算
  | 'started'
  | 'disconnected'   // 曾 started，非用户 Stop 断线后显式迁移（不得继续报告 started）
  | 'failed'

interface StartOrchestratorSnapshot {
  state: StartOrchestratorState
  lastReason?: StartReason
  pendingReasons: StartReason[]
  errorKind?: 'missing-credentials' | 'process-failed' | 'other'
  errorMessage?: string  // 已 redact
  autoRetryUsed: boolean // 本连接生命周期内断线自动重试是否已用
}

/** 自动就绪门闩（与 Start 解耦） */
interface AutoReadyLatch {
  conversationViewVisible: boolean
  hostReady: boolean
  /** 本「可见周期」内是否已成功执行过一次就绪（防叠空 Tab） */
  readyAppliedForVisibilityEpoch: boolean
  visibilityEpoch: number
}

/** 连接/错误投影（面板 + 状态栏共用） */
type ConnectionUiPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'disconnected-retrying'
  | 'disconnected-manual'

interface ConnectionUiState {
  phase: ConnectionUiPhase
  message?: string
  /** 缺凭据时面板展示「打开设置」 */
  settingsDeepLinkAvailable: boolean
  /**
   * 路由（connection-ui.ts）：连接失败/断开需展示错误时 —
   * Conversation 视图可见 → 只推面板（statusBarVisible=false）；
   * 不可见 → 推状态栏（statusBarVisible=true）；
   * Host 就绪/成功 → 清除状态栏项。
   */
  statusBarVisible: boolean
}
```

继承前序实体（不重定义权威）：`ConversationTab` / `OpenTabRecord` / `ExtensionIndex` / `PanelMode` / `ChatMessage`。空 Tab 定义锁定为 **从未成功入队 prompt**（D-23 / AC-4a）。

### 状态转换图

**AutoStartOrchestrator（AC-1d）**

```
                    request(reason)
  idle ─────────────────────────────→ starting
    ▲                                    │
    │                              success / fail
    │                                    ▼
    │                         started / failed
    │                            │
    │         request while starting → pending-start
    │                            │
    │         非用户 Stop 断线（显式事件，不得静默保持 started）
    │                            ▼
    │                      disconnected
    │               ┌────────────┴────────────┐
    │     autoRetry 未用 → request(disconnect-retry)
    │     autoRetry 已用 → 等待 manual-retry / 其它 reason
    │               └────────────┬────────────┘
    │                            ▼
    │                      starting → …
    │
    └──── 用户 Stop / 窗口关闭 → idle（清 autoRetryUsed）────┘

  failed ──request(manual-retry|其它启动类)──→ starting
  disconnected ──request(*)──→ starting（若未连）
```

**断线语义（P0）：** Host 发出非用户 Stop 的 disconnect 时，Orchestrator **必须** 立即离开 `started`，进入 `disconnected`（并同步 ConnectionUiPhase）。`dsh.test.getStartState()` 在断线后 **必须不** 仍报告 `started`。自动 retry-once：若 `!autoRetryUsed`，由 disconnect 处理器调用 `request('disconnect-retry')` 并置 `autoRetryUsed=true`；已用则保持 `disconnected` + UI manual。用户 Stop → `idle` 并重置 `autoRetryUsed`。

并发规则：`starting` / `pending-start` 时新 reason **只入** `pendingReasons`，**禁止**并行飞两条 `IdeSessionHost.start`。

**自动就绪（与 Start 解耦）**

```
  Conversation 不可见 ──→ 不 restore / 不 New（即使 Host 已 started）

  Conversation 可见 ∧ Host 就绪 ∧ 本 epoch 未应用：
    openTabSet 非空（剔除空后） → restore（活动优先，mode=replay，不 Continue，不打未读）
    openTabSet 空 / 无工作区索引 → New → live（不打未读；空 Tab 不入持久化 openTabSet）
    重复触发 + 已有空 live → 复用（AC-6）
```

**断线 UI + Orchestrator（AC-6a）**

```
  ConnectionUi: connected → (非用户 Stop) → disconnected-retrying / disconnected-manual
  Orchestrator: started   → (同一事件)     → disconnected
       │                         │
       │              !autoRetryUsed → request(disconnect-retry) → starting
       │              autoRetryUsed  → 保持 disconnected + 手动重试入口
       │                         ┌────┴────┐
       │                      成功        失败
       │                        │          │
       │                   started    failed / disconnected
       └── 用户 Stop → Orchestrator idle + UI idle（不自动重试；清 autoRetryUsed）
```

## API 域

### 命令分类（AC-1c / AC-1e）— phase-1 必须文档化于 README

| 集合 | 命令（最小清单） | 自动建连 |
|------|------------------|:--------:|
| **启动类** | `dsh.startSession` | ✅ 触发（或即为 Start 本体） |
| **发送/新建类** | `dsh.newConversation`、`dsh.promptActiveConversation`、`dsh.continueConversation`（若需 Host） | ✅ 触发 |
| **查询/浏览类** | `dsh.openHistory`、`dsh.switchConversation`（仅切已有）、History/Conversations 列表刷新 | ❌ 不触发完整建连 |
| **删除类** | `dsh.deleteConversation`、`dsh.deleteHistory` | ❌ 不触发；Host 离线 → **默认禁用或提示「Host 连接后可删除」**（AC-1e + 前序 AC-73；见 AD-CR-9） |
| **面板/设置** | `dsh.showPanel`、`dsh.openExtensionSettings`（新建）、状态栏点击 | showPanel 不强制 Start；设置深链不 Start；状态栏点击 ✅ 触发 |

精确清单以 `apps/vscode-dsh/README.md`「Auto-start command matrix」为准；本表为设计下限。

### 新增 / 扩展命令

| Command id | 用途 |
|------------|------|
| `dsh.showPanel` | 打开/reveal Conversation 视图并展示当前连接/错误详情（L2 可调） |
| `dsh.openExtensionSettings` | `workbench.action.openSettings` + 扩展配置前缀（缺凭据直达） |
| `dsh.copyToClipboard` | **内部**复制命令（AC-17）；不注册为菜单/用户快捷键主入口；`executeCommand` 可测 |
| `dsh.test.getStartState` | L2：读 orchestrator snapshot（含 disconnected） |
| `dsh.test.simulateStartupOnly` | L2：模拟仅激活、无视图/命令（AC-1a 反向） |
| `dsh.test.setCredentialPresence` | L2：模拟有/无凭据而不改生产判定语义 |
| `dsh.test.fireConversationVisibility` | L2：经 **与生产相同** 的 `AutoReadyCoordinator.onVisibilityChanged(true\|false)` 入口驱动（**禁止**直接改 latch 字段绕过接线） |
| `dsh.test.triggerAutoReady` | L2：在 Host 就绪 + 可见条件下跑就绪编排 |

**`dsh.test.*` 暴露范围（AD-CR-10）：** 仅在开发/测试激活时注册（如 `process.env.VSCODE_DSH_TEST === '1'` 或 Extension Development Host 检测）；**必须不** 出现在用户正常安装的生产命令面板。既有同风格钩子一并收紧到同一门闩。

既有 `dsh.startSession` / `dsh.newConversation` **保留**；Start/New 产品路径改为走 Orchestrator / `newConversationOrReuseEmpty`。

### Host ↔ Webview 协议增量（仍 AD-CU-1）

| 方向 | 消息 | 语义 |
|------|------|------|
| H→W | `panel/state`（扩展字段） | 增加可选 `connectionPhase`、`connectionMessage`、`canRetry`、`canOpenSettings`、`chrome.newConversation`（可见/禁用） |
| H→W | `ui/banner` | Connecting /「正在连接到 Host…」/ 失败说明（可复用） |
| W→H | `action/new-conversation` | 顶栏新建；Host 执行未连先 Start → New（AC-22） |
| W→H | `action/retry-connect` | 手动重试建连 |
| W→H | `action/open-settings` | 请求 Host 执行设置深链 |
| W→H | `action/copy-code` | `{ text: string }` → Host 调 `dsh.copyToClipboard` |

Webview **仍不**裁定可否发送；等待 Start 期间 `mode` 保持 `waiting-host` / `empty` + `connectionPhase=connecting`，**禁止**误示 `live` 可发送（AC-22 / D-26）。

### 既有缝复用

- `IdeSessionHost.start` / `shutdown` / `status`
- `ConversationController.restoreOpenTabSet` / `newConversation` / `openHistoryReplay`
- `ChatPanelHost.pushFullState` / `ui/reject-send`
- `ExtensionIndex` 立即持久化；空 Tab 过滤（AD-CU-3/4）

## 实现方案

### 架构决策（锁定）

#### AD-CR-1：AutoStartOrchestrator 纯逻辑状态机（L1）

**决策：** 将自动建连编排抽成 `auto-start-orchestrator.ts`（纯 TS，无 vscode 依赖）；`extension.ts` 只把触发源映射为 `StartReason` 并调用 `request(reason)`。实际 `IdeSessionHost.start` 经注入的 `StartHostPort`。

**理由：** AC-1d 要求 L1 可测且禁止并行踩踏；从 `extension.ts` 内联 async 难以单测并发 reason。

**替代方案：** 全逻辑留在 `extension.ts` + 仅 L2 — 拒绝（并发与 AC-1a 反向难证）。在 Webview 内触发 Start — 拒绝（违反 AD-CU-1 / AC-25）。

#### AD-CR-2：触发边界 = 活动栏 / 视图 / 启动·发送类命令 / 状态栏；非 startup

**决策：** `activate` / `onStartupFinished` **仅**注册命令、视图、状态栏、orchestrator；**不**调用 `request`。活动栏容器打开时：`request('activity-bar')` **并**必要时 `reveal` Conversation（AC-1b / D-19 / D-28）。Conversation `onDidChangeVisibility === true` → `request('conversation-view-visible')` + 通知 AutoReady。

**理由：** D-9 产品锁；避免后台静默起 Host。

**替代方案：** 激活即 Start — 明确违背 AC-1a。仅视图可见才 Start、活动栏不 Start — 违背「点开侧栏即可聊」与 AC-1b。

#### AD-CR-3：自动就绪与 Start 解耦；可见门闩

**决策：** `auto-ready-coordinator.ts` 仅在 `conversationViewVisible && hostReady` 时执行一轮就绪；可见变为 false 时递增 `visibilityEpoch` 并清 `readyApplied`；重复可见可再就绪，但 **AC-6** 复用空 Tab。restore **不**自动 Continue、**不**打未读（清除/抑制 unread 标志）。

**理由：** D-2；前序 restore 已绑定 Start，需拆出「视图首次可见」语义。

**替代方案：** Start 成功立即 New（无论视图）— 违背 AC-1a / D-2，产生后台空 Tab。

#### AD-CR-4：错误载体 = 面板为主 + 状态栏引导

**决策：** 失败写入 `ConnectionUiState` → 按路由推送：Conversation **可见** → **只**推面板；**不可见** → 创建/更新可点击 `StatusBarItem`（文案如「DSH: Host 未连接」），点击执行 `dsh.showPanel`；Host 就绪后 **清除**状态栏项。缺凭据按钮走 `dsh.openExtensionSettings`。**禁止**以启动瞬间阻塞 Toast 作为唯一提示（可保留非阻塞次要提示，但不得作为唯一载体）。

**理由：** D-10 / AC-2。

**替代方案：** 仅 Toast — 拒绝。仅 Output channel — Discoverability 差，拒绝作主载体。

#### AD-CR-5：无工作区 Start 降级 cwd；就绪不 restore

**决策：** 无 `workspaceFolders` 时 Start 仍执行：`cwd` = 单文件父目录或 `os.tmpdir()`（文档化）；`ExtensionIndex` 不可用或不写跨仓泄漏；自动就绪 **跳过 restore**，直接 New → live（AC-4b）。**修改**当前「无 folder 则拒绝 Start」行为。

**理由：** D-7；产品锁要求不因无工作区禁用自动 Start。

**替代方案：** 继续强制打开文件夹 — 违背 AC-4b。

#### AD-CR-6：空 Tab 复用 = 仅活动空 Tab（禁止全局偷换）

**决策：** `ConversationController.newConversationOrReuseEmpty(title?)`：

1. **若当前活动 Tab 为空**（从未成功入队 prompt）→ **仅聚焦复用该活动 Tab**，不新建；
2. **若当前活动 Tab 已有入队内容（或无活动 Tab）** → **直接 `newConversation`**，**禁止**全局 `findEmptyLive()` 把用户切到别处遗留的空 Tab；
3. 可选（Should）：新建成功后关闭/回收其它非活动空 live，避免列表堆积多个「新对话」。

自动就绪 New 与顶栏/命令 New **共用**此函数（AC-6 / D-27）。自动就绪路径若「当前无活动 Tab」则新建，不搜全局空 Tab。

**理由：** 用户在有内容的会话点「新建」期望得到**新的**空页，而非被带回遗忘的旧空白页；AC-6 的幂等针对「活动仍为空时重复点击」，不是全局偷换。

**替代方案：** 全局查找任意空 Tab 复用 — 拒绝（体验歧义）。仅自动路径复用、手动总是新建 — 拒绝（双实现漂移且违背活动空 Tab 幂等）。

#### AD-CR-7：UI 底盘 = 呈现升级，权威不外移

**决策：** 在 `buildThinChatHtml`（或拆出 `media/chat-panel.css` + 内联脚本模块）使用 `--vscode-*` CSS 变量；**优先依赖** Webview 对主题变量的原生刷新。仅当需兼容旧引擎或切换 light/dark 类名时，Host 可监听 `onDidChangeActiveColorTheme` 后 `postMessage` **广播主题类名**（如 `themeKind`），**不必**重推整表 CSS 变量。Markdown **安全渲染**在 Webview：默认转义 HTML、禁脚本、禁外链资源；失败回退纯文本。复制经 `action/copy-code` → 扩展命令。侧栏 IA：Conversations 空 live 显示「新对话」；History **过滤**空 Tab；去掉命令标题堆砌空态。

**理由：** A-5；AD-CU-1；AC-16/16a/17/19/19a。

**替代方案：** 换第二套 React/Webview 框架 — 范围过大，本 Feature 拒绝。Markdown 在 Host 预渲染 HTML — 增加 XSS 面与协议膨胀，次选。

#### AD-CR-8：顶栏新建 = 产品主入口；键盘 = Should

**决策：** chrome 常驻「新建会话」；窄栏可进溢出菜单但须一次点击或「展开+首项」可达（D-21）。点击 → `action/new-conversation` → Host：未连则 `request('command-send')` 并展示 connecting 等待态，成功后再 `newConversationOrReuseEmpty` + reveal 面板。`dsh.newConversation` 等价。`keybindings` 仅 Should（AC-34），不得替代按钮。

**理由：** D-1 / D-16 / D-26。

**替代方案：** 仅命令/快捷键 — 拒绝。图标-only 替代顶栏文案按钮 — 拒绝（D-1）。

#### AD-CR-9：删除/查询离线边界（对齐前序 AC-73）

**决策：** 涉及**权威会话日志**的删除（`deleteConversation` / 会让用户以为会话已从权威侧消失的入口）在 Host 未连/未就绪时：**默认禁用**，或明确提示「Host 连接后可删除」；**禁止**只清扩展索引、保留权威日志而造成删除假象（前序 AC-73）。**不**调用 Orchestrator 完整建连（AC-1e）。

**唯一例外：** 目标对象**本身只是**扩展索引中的本地 UI 状态（不涉及权威会话日志）——可允许清理，且 UI **必须**明确标注「仅清除本地记录，权威会话将在 Host 可用时仍可见」。

**理由：** D-24 / AC-1e；与前序 AC-73 一致；与 AC-22（新建属启动/发送类）区分。

**替代方案：** 删除时偷偷 Start — 违背 AC-1c/1e。离线静默只清索引并显示已删除 — 违背 AC-73，拒绝。

#### AD-CR-10：验证分层、L2 主路径与 test 钩子门闩

**决策：** L2 主路径 =「Conversation 视图可见」全链路（Start→就绪→live/restore）+ **一条 AC-1a 反向用例**；其它 Start 入口用 L1 + 命令注册断言（D-18）。B1–B3：L2/L3 + L4 截图辅助（D-8）。Enter/Shift+Enter 与 Markdown 复制须有 L3 可驱动面（fake Webview keydown 钩子或协议）。可见性 L2 **必须**经 `onVisibilityChanged`（或生产等价）接线，**禁止**测试钩子直接改 latch 字段冒充已接线。所有 `dsh.test.*` **仅**开发/测试环境注册（见上表）。

**理由：** AC-7 / AC-7a；避免 L2 绿但生产可见性未接线。

**替代方案：** 每个触发入口独立 L2 — 成本过高且需求已锁 D-18。生产也暴露 test 命令 — 拒绝。

#### AD-CR-11：继承边界（不变式）

**决策：** 不修改 `packages/core/agent-loop`；不重做双通道；bridge 薄改仅当复制/读设置等确需；新代码主落点 `apps/vscode-dsh/`。前序 Must 行为回归（AC-27）。

### 组件图

```
┌──────────────────────────── apps/vscode-dsh ────────────────────────────┐
│ StatusBarItem │ ActivityBar/Views │ Commands (start/send vs query/delete)│
│ AutoStartOrchestrator (L1 FSM) │ AutoReadyCoordinator (visibility gate) │
│ ConversationController (+ newConversationOrReuseEmpty)                  │
│ ChatPanelHost / Webview（底盘呈现 + action/new-conversation）            │
│ Conversations TabBar │ HistoryView（滤空）│ Timeline（继承）               │
│ ExtensionIndex │ MessageStore │ IdeSessionHost（单例）                    │
└─────────────────────────────────────────────────────────────────────────┘
         │ SDK + bridge（不变）
         ▼
   dsh --profile ide    权威会话日志
```

### 文件产出计划

**新增：**

```
apps/vscode-dsh/src/
  auto-start-orchestrator.ts   # start-reason FSM + snapshot
  auto-ready-coordinator.ts    # 可见门闩 + restore/New 编排入口
  connection-ui.ts             # ConnectionUiState → 面板/状态栏
  markdown/                    # 可选：安全渲染辅助（若抽到可测纯函数）
apps/vscode-dsh/media/
  chat-panel.css               # --vscode-* 底盘（可选拆分）
```

**修改：**

```
extension.ts                 # 触发接线；去掉无 workspace 硬拒绝；状态栏；showPanel/settings/copy
session-host.ts              # 断线事件 → orchestrator retry-once（若尚未暴露）
conversation-controller.ts   # newConversationOrReuseEmpty；就绪未读抑制
conversation-tab-bar.ts      # 「新对话」标题；去命令堆砌空态
history-view.ts              # 过滤空 Tab
chat-panel/protocol.ts       # 协议增量
chat-panel/chat-panel-host.ts
chat-panel/chat-panel-provider.ts  # HTML/CSS/MD/底栏/顶栏按钮
package.json                 # 新命令；可选 Should keybindings
README.md                    # 命令矩阵、设置前缀、验证钩子
tests/                       # phase1–4 L1/L2/L3 规格测试
```

**禁止：** `packages/core/**/agent-loop*`；Webview 自持 mode/session 权威；删除类触发完整自动建连；startup 自动 Start；无限断线重连。

### 关键骨架代码

```typescript
// auto-start-orchestrator.ts
type StartHostPort = {
  isConnected(): boolean
  start(reason: StartReason): Promise<void>
  hasCredentials(): boolean
}

class AutoStartOrchestrator {
  private state: StartOrchestratorState = 'idle'
  private pending: StartReason[] = []
  private autoRetryUsed = false

  /** Host 非用户 Stop 断线：必须显式离开 started */
  onUnexpectedDisconnect(): void {
    if (this.state === 'starting' || this.state === 'pending-start') return // settle 路径处理
    this.state = 'disconnected'
    if (!this.autoRetryUsed) {
      this.autoRetryUsed = true
      void this.request('disconnect-retry')
    }
    // else: connection-ui → disconnected-manual
  }

  onUserStop(): void {
    this.state = 'idle'
    this.autoRetryUsed = false
    this.pending = []
  }

  async request(reason: StartReason): Promise<void> {
    if (this.port.isConnected()) {
      this.state = 'started'
      return
    }
    if (this.state === 'starting' || this.state === 'pending-start') {
      this.pending.push(reason)
      this.state = 'pending-start'
      return
    }
    await this.runStart(reason)
  }

  private async runStart(reason: StartReason): Promise<void> {
    this.state = 'starting'
    try {
      if (!this.port.hasCredentials()) throw Object.assign(new Error('missing credentials'), { kind: 'missing-credentials' })
      await this.port.start(reason)
      this.state = 'started'
    } catch (e) {
      this.state = 'failed'
      // connection-ui: panel + status bar（按可见性路由）
    } finally {
      const more = this.pending.splice(0)
      if (more.length && !this.port.isConnected()) await this.runStart(more[more.length - 1]!)
    }
  }
}

// conversation-controller.ts — 仅活动空 Tab 复用（AD-CR-6）
newConversationOrReuseEmpty(title?: string): ConversationTab {
  const active = this.registry.active()
  if (active && this.isEmptyTab(active)) {
    this.focus(active.tabId)
    return active
  }
  // 活动 Tab 已有内容或无活动 Tab：直接新建；禁止全局 findEmptyLive 偷换
  return this.newConversation(title ?? '新对话')
}

// auto-ready-coordinator.ts
async onVisibilityOrHostChanged(): Promise<void> {
  if (!this.latch.conversationViewVisible || !this.latch.hostReady) return
  if (this.latch.readyAppliedForVisibilityEpoch) {
    // 仍须保证有可聊面：若无 Tab 则 reuse/New
    return this.ensureReadySurface()
  }
  this.latch.readyAppliedForVisibilityEpoch = true
  if (!this.hasWorkspaceIndex()) {
    this.controller.newConversationOrReuseEmpty('新对话')
    this.suppressUnreadForAutoReady()
    return
  }
  const restored = await this.controller.restoreOpenTabSet({ markUnread: false, autoContinue: false })
  if (restored.outcome === 'empty') {
    this.controller.newConversationOrReuseEmpty('新对话')
  }
  this.suppressUnreadForAutoReady()
}
```

### 失败模式

| 故障 | 行为 |
|------|------|
| 缺凭据 | `failed` + 面板说明 + 设置直达；未开面板 → 状态栏 |
| Start 进程失败 | 同上 + 重试（`action/retry-connect` / 状态栏） |
| 无工作区 | Start 用降级 cwd；就绪直接 New |
| 断线（非 Stop） | 自动 retry 一次；再失败 → 手动重试 |
| 删除时 Host 离线 | **禁用或提示「Host 连接后可删除」**；禁止假删权威；**不**自动建连 |
| 重复打开侧栏 | 复用 Host；复用空 Tab |
| Markdown 恶意载荷 | 不执行脚本/外链；回退纯文本 |
| 主题切换 | 刷新令牌，避免不可读残留 |

## Phase DAG 依赖

见 `phase-plan.md`：

```
phase-1-auto-start-orchestrator
  ├→ phase-2-auto-ready-surface          （可与 phase-4 并行收尾）
  └→ phase-3-chat-ui-chassis ──→ phase-4-new-conversation-chrome
         （phase-4 仅依赖 phase-1 + phase-3；不阻塞于 phase-2）
```

phase-2 与 phase-3 可在 phase-1 HG-3 通过后**并行**；phase-4 在 phase-1+phase-3 就绪后即可启动，**不**等待 phase-2。

## 外部依赖

- 无强制新 npm 运行时依赖；Markdown 优先最小自研安全子集或已有可审计轻量库（若引入须说明 CSP/安全）。
- 继续 vitest + 既有 duck-typed vscode / FakeWebview L2/L3 模式。
- **不**新增 Remote/多窗口基础设施。

## 高风险子系统

| 风险 | 缓解 |
|------|------|
| R-1 前序分支未合入 master | 基于前序交付分支开发；不缩小目标 |
| 自动 Start+New 叠空 Tab | AD-CR-6 + L2 AC-6 |
| start-reason 并发踩踏 | AD-CR-1 L1 单测 |
| XSS（Markdown） | AC-16a 否定用例 + 安全默认 |
| 窄栏挤掉新建按钮 | AD-CR-8 溢出可达规则 |
| 无工作区 cwd 语义 | README 文档化；L2 覆盖 AC-4b |

## 权衡/替代方案

见各 AD-CR「替代方案」。总览：

| 选项 | 结论 |
|------|------|
| 激活即连 vs 触发才连 | **触发才连**（产品锁） |
| Start 与就绪耦合 vs 解耦 | **解耦**（可见才就绪） |
| 第二套 UI 框架 vs 原地升级 | **原地升级** |
| 删除离线自动建连 vs 提示 | **提示/降级** |
| 键盘主入口 vs 顶栏按钮 | **顶栏按钮**；键盘 Should |

## 验收标准验证方案

**覆盖率要求（强制）：** 每条 `[Must]` / `[Should]` AC **至少**被一个 `VP-CR-*` 行覆盖（或在「委托/豁免」列显式声明理由）；每个 `VP-CR-*` **必须**列出所覆盖的 AC 编号。`[Could]`（AC-33）与「非验收条件」（AC-18）可不设独立 VP，但须在矩阵中标注。本表为 **design 权威 traceability**；各 `phases/*/spec.md` 负责把 VP 落到具体测试命令/夹具，**不得**再从零推导覆盖面，也 **不得**用「凭据式」场景描述替代 AC 编号。

### VP 场景表（含显式 AC）

| ID | 层级 | 覆盖 AC | 场景 / 方法 | 预期结果 | 优先级 |
|----|------|---------|-------------|---------|:------:|
| VP-CR-1 | L2 | AC-1, AC-5, AC-7（主路径切片） | Conversation 视图可见 → Start → 就绪 → live | Host 单例；可发送 live；重复触发不叠 Host | must |
| VP-CR-1a | L2 | AC-1a, AC-7（反向切片） | 仅激活、从不打开 Conversation / 不发会话命令 | 无 Host、无新 Tab、不抢焦点 | must |
| VP-CR-1b | L2 | AC-1b | 打开活动栏且 Conversation 尚未可见 | 执行 reveal Conversation（或等价）；非静默跳过就绪 | must |
| VP-CR-1c | L1+L2 | AC-1c | 启动/发送类命令 vs 查询/浏览类；对照 README 矩阵 | 前者触发 Start；后者不触发完整建连 | must |
| VP-CR-1d | L1 | AC-1d | 并发多 `request(reason)` during starting | 单次 `start()`；pending 结算；含 `disconnected` 合法态 | must |
| VP-CR-1e | L2 | AC-1e | Host 离线执行删除/依赖 Host 的查询删除 | 禁用或「Host 连接后可删除」；未 Start；无假删权威 | must |
| VP-CR-2 | L2 | AC-2, AC-14 | 无凭据 / Start 失败；面板可见与不可见 | 可读错误+重试；设置深链；可见只推面板；不可见状态栏→`dsh.showPanel` | must |
| VP-CR-3 | L2 | AC-3 | 有非空 openTabSet；可见+Host ready | restore 回放；活动优先；无自动 Continue；无未读 | must |
| VP-CR-4 | L2 | AC-4, AC-6（自动路径） | 无未关 Tab；可见+ready；重复就绪 | 自动 New→live；无未读；活动空则复用不叠 | must |
| VP-CR-4a | L2 | AC-4a | 自动 New 后读索引；模拟重启 hydrate | 空 Tab 不入持久化 openTabSet；恢复列表无该空会话 | must |
| VP-CR-4b | L2 | AC-4b | 无 workspaceFolders；触发 Start+就绪 | Start 仍可；跳过 restore；直接 New→live | must |
| VP-CR-5 | L2 | AC-6a | started→非用户 Stop 断线 | Orchestrator=`disconnected`（≠started）；auto retry≤1；再失败手动；无死循环 | must |
| VP-CR-6 | L2/L3 | AC-7a, AC-8, AC-9, AC-11 | 主题令牌钩子 + 默认浅/深色截图辅助 | L2/L3 主证据；L4 截图非唯一；非裸灰框；气泡可辨；底栏/Send 对比可读 | must |
| VP-CR-6a | L2/L3 | AC-8a | 触发主题变更（或 postMessage themeKind） | 切换后文本/对比仍可读；无长期旧主题残留 | must |
| VP-CR-7 | L3 | AC-12 | live 输入区 Enter / Shift+Enter | Enter 发送非空；Shift+Enter 换行不发送 | must |
| VP-CR-8 | L3 | AC-16a | 注入可执行 HTML/脚本夹具 | 不执行脚本、不加载外链 | must |
| VP-CR-8a | L3 | AC-16 | 含标题/列表 Markdown 消息 | 结构化可读渲染；失败回退纯文本 | must |
| VP-CR-8b | L2/L3 | AC-17 | fenced 代码块「复制」→ `dsh.copyToClipboard` | executeCommand 路径收到目标文本；非菜单主入口 | must |
| VP-CR-9 | L2/L3 | AC-13 | Host starting / connecting | 面板展示 Connecting；非可发送 live | must |
| VP-CR-9a | L3 | AC-10 | live 生成中 → 空闲 | 「生成中…」出现后清除 | must |
| VP-CR-10 | L2/L3 | AC-15, AC-21 | chrome 常驻「新建会话」；窄栏溢出模拟 | 一次点击或展开+首项可达；产品主入口可发现 | must |
| VP-CR-10a | L2/L3 | AC-22 | 未连：`action/new-conversation` | connecting 等待态；完成前非 live；成功后 live | must |
| VP-CR-10b | L2 | AC-23, AC-6（按钮路径） | 已连新建；(a) 活动空连续点；(b) 活动有内容+遗留空 Tab | (a) 复用；(b) 新建不偷换遗留空 Tab；聚焦 live | must |
| VP-CR-10c | L2 | AC-24 | 脚本驱动协议/命令断言 Tab 计数与 mode | 需新建时 Tab+1 且 live；AC-6 复用时不叠空且 live | must |
| VP-CR-11 | L2 | AC-19, AC-19a | Conversations 空 live；History 列表 | 空 live 显示「新对话」；History 不列空 Tab；无命令标题堆砌空态 | must |
| VP-CR-11a | L2 | AC-20 | 点击 History 非空行 | 打开/激活回放；不叠副本 | must |
| VP-CR-12 | 静态+L3 | AC-25, AC-26 | Webview 无 mode 权威；diff 无 agent-loop | AD-CU-1 保持；无核心 loop 改动 | must |
| VP-CR-12a | 回归 L2 | AC-27 | 关 Tab 可恢复 / 回放 / Continue / Subagent 抽测 | 前序 Must 语义仍成立 | must |
| VP-CR-13 | 静态/可选 L2 | AC-34 | 若实现 keybindings：绑定命令 ≡ `dsh.newConversation` | 行为等价；不替代顶栏按钮 | should |
| VP-CR-14 | 可选 L3 | AC-28, AC-29, AC-30, AC-31, AC-32 | 若实现对应 Should：表格/Continue 说明/改动入口/语言标签/未读增强 | 符合各自 Should；失败不升 Must | should |
| — | — | AC-18 | **豁免**：明确「表格/链接预览非 Must」 | 缺省不构成失败；无需正向 VP | n/a |
| — | — | AC-33 | **豁免**：Could 抛光 | 不做 Must 门禁 | n/a |

### AC → VP Traceability 矩阵

| AC | 优先级 | VP | Phase（执行落点） |
|----|:------:|-----|-------------------|
| AC-1 | Must | VP-CR-1 | phase-1（触发）+ phase-2（就绪收口） |
| AC-1a | Must | VP-CR-1a | phase-1 |
| AC-1b | Must | VP-CR-1b | phase-1 |
| AC-1c | Must | VP-CR-1c | phase-1 |
| AC-1d | Must | VP-CR-1d | phase-1 |
| AC-1e | Must | VP-CR-1e | phase-1 |
| AC-2 | Must | VP-CR-2 | phase-1 |
| AC-3 | Must | VP-CR-3 | phase-2 |
| AC-4 | Must | VP-CR-4 | phase-2 |
| AC-4a | Must | VP-CR-4a | phase-2 |
| AC-4b | Must | VP-CR-4b | phase-1（Start）+ phase-2（就绪） |
| AC-5 | Must | VP-CR-1 | phase-1 |
| AC-6 | Must | VP-CR-4, VP-CR-10b | phase-2 + phase-4 |
| AC-6a | Must | VP-CR-5 | phase-1 |
| AC-7 | Must | VP-CR-1, VP-CR-1a | phase-1（反向）+ phase-2（主路径） |
| AC-7a | Must | VP-CR-6 | phase-3 |
| AC-8 | Must | VP-CR-6 | phase-3 |
| AC-8a | Must | VP-CR-6a | phase-3 |
| AC-9 | Must | VP-CR-6 | phase-3 |
| AC-10 | Must | VP-CR-9a | phase-3 |
| AC-11 | Must | VP-CR-6 | phase-3 |
| AC-12 | Must | VP-CR-7 | phase-3 |
| AC-13 | Must | VP-CR-9 | phase-1（投影缝）+ phase-3（呈现） |
| AC-14 | Must | VP-CR-2 | phase-1 + phase-3 |
| AC-15 | Must | VP-CR-10 | phase-4 |
| AC-16 | Must | VP-CR-8a | phase-3 |
| AC-16a | Must | VP-CR-8 | phase-3 |
| AC-17 | Must | VP-CR-8b | phase-3 |
| AC-18 | Must（负向） | 豁免行 | — |
| AC-19 | Must | VP-CR-11 | phase-3 |
| AC-19a | Must | VP-CR-11 | phase-3 |
| AC-20 | Must | VP-CR-11a | phase-3 |
| AC-21 | Must | VP-CR-10 | phase-4 |
| AC-22 | Must | VP-CR-10a | phase-4 |
| AC-23 | Must | VP-CR-10b | phase-4 |
| AC-24 | Must | VP-CR-10c | phase-4 |
| AC-25 | Must | VP-CR-12 | 各 Phase 静态门禁 |
| AC-26 | Must | VP-CR-12 | 各 Phase 静态门禁 |
| AC-27 | Must | VP-CR-12a | phase-4 收口抽测 + 各 Phase 回归 |
| AC-28 | Should | VP-CR-14 | phase-3（余力） |
| AC-29 | Should | VP-CR-14 | phase-3（余力） |
| AC-30 | Should | VP-CR-14 | phase-3（余力） |
| AC-31 | Should | VP-CR-14 | phase-3（余力） |
| AC-32 | Should | VP-CR-14 | phase-3（余力） |
| AC-33 | Could | 豁免 | — |
| AC-34 | Should | VP-CR-13 | phase-4 |

**覆盖核对：** Must AC-1…AC-27（除 AC-18 负向豁免）均有 ≥1 条 VP；Should AC-28…32、AC-34 有 VP-CR-14/13；Could AC-33 豁免。phase spec 的验证策略表应以本矩阵 VP id 为行键，补充命令/夹具细节即可。

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| R1 | 2026-09-08 | Orchestrator 状态；AD-CR-6/7/9/10；phase-4 依赖；骨架 | 增加 `disconnected` 显式迁移；空 Tab 仅活动复用；AD-CR-9 对齐 AC-73；test 钩子门闩+真实可见性；phase-4 仅依 phase-1+3；主题优先原生变量；状态栏路由 | 待 HG-2 | 设计评审 P0/P1/P2 |
| R2 | 2026-09-08 | 验收标准验证方案 | 覆盖率强制规则；VP 表扩至显式 AC；完整 AC→VP→Phase 矩阵 | 待 HG-2 | 验证覆盖评审 |

## Phase 1 实施第一步（强制）

在写 orchestrator 接线前，**先**对照现有 `extension.ts` / `IdeSessionHost.start` / 视图 `onDidChangeVisibility` / `ConversationController.newConversation` 与空 Tab 判定，确认激活路径与可复用缝（由 code-explorer 写入 `repo-exploration.md`；implementer 不得臆造平行启动面）。

## 建议的下一步

进入 HG-2：用户确认本设计与 `phase-plan.md` 后，按 DAG 启动 `phase-1-auto-start-orchestrator`（先 code-explorer，再 impl 分支）。
