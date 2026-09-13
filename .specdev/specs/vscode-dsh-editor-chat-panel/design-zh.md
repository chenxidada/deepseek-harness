# Solution Design: vscode-dsh-editor-chat-panel

<!--
  slug: vscode-dsh-editor-chat-panel
  audience: implementer / reviewer / verifier / HG-2
  language: zh (mirror of design.md; canonical is also zh)
  constitution: §7
  status: draft for HG-2
  created: 2026-09-11
  hg1-lock: Q-1=A Q-2=A Q-3=A Q-4=B
-->

> 本文为 `design.md` 的中文镜像（正文与 canonical 同为中文）。

## 范围覆盖

本设计覆盖完整 feature（3 Phase DAG，见 `phase-plan.md`）：

| Phase ID | 用户可感知增量 |
|----------|----------------|
| `phase-1-editor-shell-tabs` | 主面对齐编辑器区；顶栏多会话 Tab；侧栏主聊天废弃 |
| `phase-2-usable-stream` | settle 后 Markdown 可读；活动/引用/变更/composer 停止像日常聊天 |
| `phase-3-discovery-timeline-v` | 历史/搜索顶栏 UI；fork/重试/复制入口收齐；Timeline 默认弱化；层 V 全清单 |

**HG-1 锁定（不得再开放，本设计不得推翻）：**

| ID | 决议 |
|----|------|
| Q-1 = A | 废弃侧栏主聊天 WebviewView；只保留 Editor Chat Panel 一个主界面；TreeView Tab 条从主路径移除/降级 |
| Q-2 = A | 单 WebviewPanel 内多会话顶栏 Tab（非每会话一个 VS Code editor tab） |
| Q-3 = A | 历史/搜索以面板顶栏 UI 为主，命令可并存 |
| Q-4 = B | Timeline 进一步弱化：默认隐藏/折叠；能力主投影在对话流 |

---

## 架构摘要

将现有侧栏 `WebviewView`（`dsh.chat`）+ 侧栏 Conversations `TreeView` 的「双壳」收敛为**唯一**编辑器区 `WebviewPanel`（Editor Chat Panel）。`ChatPanelHost` 的 `WebviewMessagePort` 抽象不变：Panel 创建后 `attach` 同一 Host；决策态仍由 Host 经 `panel/state` 下发。多会话身份继续以 `ConversationRegistry` 为权威；UI 投影从 TreeView 迁入 Webview **顶栏 Tab chrome**（Host 推送 `panel/tabs` 快照，Webview 只渲染与发点击事件）。消息流复用既有 activity / ref / change / composer / cancel / fork 协议；本 feature 补齐 **streaming→settle 的安全 Markdown 重渲**、顶栏发现入口，以及 **层 V** 可见验收。Timeline 侧栏视图默认隐藏或折叠，不再作为长文主阅读面。

---

## HG-1 锁定决策写入（架构级）

### AD-ECP-1 — 唯一主面 = Editor WebviewPanel（Q-1=A）

- **决议**：废弃 `dsh.chat` 作为可读写主消息流；`package.json` 移除或不再贡献该 webview view 为主入口；旧 `revealConversationPanel` / `dsh.showPanel` 改为 `createWebviewPanel` / 聚焦单例 Panel。
- **理由**：双聊天面必然分叉权威投影（R-3）；宪法 §7.1 要求主界面在编辑器区。
- **替代方案（已否决）**：保留侧栏 WebviewView 作次面 / launcher——与 Q-1=A「必须不提供可读写第二套消息流」冲突。
- **允许**：侧栏保留非聊天 launcher（例如「打开 Conversation」按钮/命令），或空容器提示已迁移；**禁止**第二套 messages 投影。

### AD-ECP-2 — 单 Panel 内顶栏 Tab（Q-2=A）

- **决议**：全局至多一个 Editor Chat Panel 实例；未关会话以面板内水平 Tab 条呈现；**禁止**「一会话一 VS Code editor tab」作为主模型。
- **理由**：对齐参考图与 Cursor 式体验；Registry 已是多 Tab 模型，只需换投影面。
- **替代方案（已否决）**：每会话 `createWebviewPanel`——破坏 Q-2、增加生命周期与串台风险。

### AD-ECP-3 — 历史/搜索以面板顶栏 UI 为主（Q-3=A）

- **决议**：顶栏时钟/历史入口 + 搜索 UI（overlay 或内嵌面板）为档 1+2 主路径；`dsh.openHistory` / `dsh.searchSessions` 命令保留为次入口，命中打开仍走既有 `requestOpenSearchHit`（不 auto-Start）。
- **理由**：人眼可发现性（§7.2）；后端已有 `requestSearchSessions`。
- **替代方案（已否决）**：仅命令面板——与 Q-3=A 冲突。

### AD-ECP-4 — Timeline 默认隐藏/折叠（Q-4=B）

- **决议**：`dsh.timeline` 默认不作为启动可见主视图（`visibility: collapsed` 或等价隐藏策略）；工具/活动主投影保持对话流 activity 气泡；溢出菜单可提供「打开 Timeline」低频入口。
- **理由**：避免与消息流双主阅读面（O-7）；活动状态机已在流内（AC-30）。
- **替代方案（已否决）**：删除 Timeline 代码——超出范围；保留默认展开——与 Q-4=B 冲突。

---

## 核心实体 / 数据模型

### 不变（复用，不重做）

```typescript
// ConversationRegistry — Tab 身份权威（E7）
interface ConversationTab {
  tabId: string
  sessionId: string
  title?: string
  status: 'idle' | 'running' | 'error' | 'disconnected'
  mode: OpenTabMode  // live | replay
  unread: boolean
  approvalBadge: boolean
}

interface ConversationRegistrySnapshot {
  activeTabId: string | undefined
  tabs: readonly ConversationTab[]
}
```

### 新增 / 扩展（协议投影，非新会话模型）

```typescript
/** Host → Webview：顶栏 Tab 投影（Phase 1） */
type PanelTabsMessage = {
  type: 'panel/tabs'
  activeTabId: string | undefined
  tabs: readonly Array<{
    tabId: string
    sessionId: string
    title: string          // EMPTY_LIVE_TITLE 规则与 TreeView 一致
    active: boolean
    unread?: boolean
    approvalBadge?: boolean
    status?: ConversationTabStatus
  }>
}

/** Webview → Host：顶栏交互 */
type TabChromeActions =
  | { type: 'action/switch-tab'; tabId: string }
  | { type: 'action/close-tab'; tabId: string }
  | { type: 'action/new-conversation' }   // 已有路径，可复用
  | { type: 'action/open-history' }       // Phase 3：打开历史 UI
  | { type: 'action/open-search'; query?: { text?: string; path?: string } }
  | { type: 'action/open-overflow'; item: OverflowItemId }

/** 层 V 清单条目（验收基建，非运行时类型） */
type VisibleCheckItem = {
  id: string
  description: string
  phaseIds: string[]   // 哪些 Phase 必须核对本条
}
```

### 呈现态（Webview 可持有，须可探针）

| 字段 | 探针 | 权威 |
|------|------|------|
| `data-follow-state` | DOM | Webview（继承 T7） |
| `streaming` | `__dshProbes` / `#status` | 由 Host `status/set` + patch 驱动 |
| 顶栏活动 Tab | `data-active="true"` / `aria-selected` | Host `panel/tabs` |
| Markdown settle | settle 后 `.md-*` 节点存在 | Webview 渲染；正文权威仍在日志 |

---

## API 域

### Extension Host

| 符号 | 变更 | Phase |
|------|------|:-----:|
| `registerChatPanelProvider` | 改为注册/管理 **单例 WebviewPanel**（或拆 `registerEditorChatPanel` + 薄包装）；去掉对 `registerWebviewViewProvider('dsh.chat')` 的主路径依赖 | 1 |
| `revealConversationPanel` / `dsh.showPanel` | `createWebviewPanel`（若不存在）或 `reveal`；`viewColumn` 默认 `Beside` 或 `Active`（实现选一侧并测层 V） | 1 |
| `ChatPanelHost.attach` | 签名不变；Panel `webview` 作 port；支持 dispose 后 re-attach | 1 |
| `pushFullState` | 在既有 `panel/state` + messages 之外 **同步推送 `panel/tabs`** | 1 |
| `conversation-tab-bar.ts` | TreeView 注册从 activate 主路径移除/降级；**投影纯函数**（`conversationTreeItems` / label 规则）复用到 Host→`panel/tabs` 映射 | 1 |
| `package.json` views | 移除 `dsh.chat` webview 贡献；`dsh.conversations` 降级或改为 launcher；`dsh.timeline` 默认 collapsed/hidden | 1+3 |
| Markdown settle | `messages/patch` 或 replace 在 `streaming:false` 时 Webview 调 `renderSafeMarkdown` 写入 `innerHTML`（非 `textContent`） | 2 |
| 历史/搜索 overlay | Webview UI + 已有 `requestSearchSessions` / `requestOpenSearchHit` | 3 |

### 协议（最小增量）

- **新增帧**：`panel/tabs`（Host→Webview）；Webview→Host 的 `action/switch-tab`、`action/close-tab`（若尚无）。
- **禁止**：新建正文库、档 3 搜索 API、重写 agent-loop、改 Registry 身份语义。

---

## 实现方案

### 1. 壳层迁移（WebviewView → WebviewPanel）

```
activate()
  ├─ create ChatPanelHost (eager, 不变)
  ├─ registerEditorChatPanel(vscode, host)
  │     └─ 不 registerWebviewViewProvider(dsh.chat)
  ├─ commands: dsh.showPanel / newConversation / …
  │     └─ ensureEditorChatPanel() → create|reveal → host.attach(port)
  └─ 侧栏：无 dsh.chat；Conversations TreeView 不注册或仅 launcher
```

**生命周期（R-2）：**

1. `createWebviewPanel('dsh.editorChat', 'Conversation', column, { enableScripts, retainContextWhenHidden: true })`
2. 设置 `html = buildThinChatHtml(...)`（可演进为 `buildEditorChatHtml`，共享渲染源）
3. `host.attach({ postMessage, onDidReceiveMessage })`
4. `onDidDispose` → detach；清除单例引用；**不** dispose Registry / Controller
5. 再次打开 → 新 Panel + re-attach + `pushFullState()` + `panel/tabs`

**废弃侧栏主面步骤（有序）：**

| 步 | 动作 | 验收 |
|----|------|------|
| 1 | `package.json` 去掉 `views.dsh` 中 `dsh.chat` webview；activationEvents 去掉 `onView:dsh.chat` | 扩展不再贡献侧栏主聊天 |
| 2 | `registerChatPanelProvider` 不再调用 `registerWebviewViewProvider` | 层 B |
| 3 | 一切原 reveal 路径改走 Editor Panel | AC-2 |
| 4 | 若用户触发旧 view id / 文档链接：命令重定向到 Panel 或信息提示「已迁移」 | AC-4 |
| 5 | 停止注册 Conversations TreeView 为主 Tab 条；或改为单行「打开 Conversation」 | AC-5 / AC-10 |

### 2. Tab chrome 数据流

```
Registry.emit / Controller 变更
        │
        ▼
ChatPanelHost.pushTabs()  ← map snapshot via conversationTreeItems 规则
        │  panel/tabs { activeTabId, tabs[] }
        ▼
Webview #tab-bar
  ├─ 渲染 button[role=tab][data-tab-id][data-active]
  ├─ + → action/new-conversation
  ├─ 时钟 → action/open-history（P3）
  └─ … → overflow（删除 / Timeline / 设置）
        │
用户点击 Tab / 关闭
        ▼
Host → Controller.switchConversation / closeTab / …
        ▼
pushFullState + pushTabs（消息流随 activeSessionId 切换，不串台）
```

**DOM 契约（层 A，Phase 1）：**

- `#tab-bar` / `[data-testid="tab-bar"]`
- `[data-testid="tab"][data-tab-id][data-active="true"|"false"]`
- `[data-testid="tab-new"]`、`[data-testid="tab-history"]`（history 可 P1 占位可见、P3 接线）、`[data-testid="tab-overflow"]`

### 3. Markdown settle 策略

| 阶段 | 行为 | 依据 |
|------|------|------|
| streaming | `appendText`/`text` → **纯文本** `textContent`（或转义纯文本节点）；保持 `data-streaming=true` | 性能 + 避免半截 MD 抖动；继承 chat-ux deferred |
| settle（`streaming:false` 或 messages/replace 终态） | 对助手气泡调用 `renderSafeMarkdown`，`innerHTML = result.html`；挂 copy 等 actions；清 streaming 指示 | AC-21 |
| 错误/断连 | fail-closed：清 streaming；若有半截文本仍 settle 一次 MD 或 plainFallback | AC-25 |
| 安全 | 禁止绕过 `renderSafeMarkdown` 直接塞原始字符串；`containsUnsafeHtml` 回归保留 | §3 / 既有 MD 模块 |

**关键修复点：** `patchMessageDom`（TS + browser source）在 `streaming === false` 且拿到完整 `text` 时必须走 MD settle，不得停留在 `textContent`（wiki「Deferred」项）。

### 4. Timeline 默认隐藏方案（Q-4=B）

1. `package.json`：`dsh.timeline` 设 `"visibility": "collapsed"`（或移出默认可见列表）；文档说明默认折叠。
2. 溢出菜单提供「打开 Timeline」→ `vscode.commands.executeCommand` 聚焦该 view（Should）。
3. **不**删除 `TimelineStore` / diff 打开路径；消息流 activity + change-list 仍为工具可见主投影（AC-30/32）。
4. 层 V：启动后 Timeline 区域不可见或折叠；对话流内可见活动项。

### 5. 层 V 验收如何做

每个 Phase 的 `verification.md` **必须**含：

1. **环境**：真实 VS Code 扩展宿主加载 `apps/vscode-dsh`（或项目既定 Extension Development Host 流程）。
2. **动作**：执行 `dsh.showPanel`（或产品主入口）打开 Editor Chat Panel。
3. **可见清单**：按下表勾选；缺项 → FAIL/PARTIAL（AC-40–42）。
4. **证据**：截图路径或 verifier 手填清单表；**禁止**仅 jsdom PASS。

**全 feature 层 V Must 清单（AC-41 + 扩展）：**

| ID | 可见项 | P1 | P2 | P3 |
|----|--------|:--:|:--:|:--:|
| V-1 | 编辑器区 Panel 可见（非仅侧栏窄面） | ✅ | ✅ | ✅ |
| V-2 | 顶栏 Tab chrome 可见 | ✅ | ✅ | ✅ |
| V-3 | 活动 Tab 可区分 | ✅ | ✅ | ✅ |
| V-4 | composer 可见 | ✅ | ✅ | ✅ |
| V-5 | user/assistant 层级可区分 | — | ✅ | ✅ |
| V-6 | settle 后 Markdown 可读（强调/代码块） | — | ✅ | ✅ |
| V-7 | 活动或引用或变更至少一类流内可见 | — | ✅ | ✅ |
| V-8 | 历史或搜索顶栏入口可点开 UI | — | — | ✅ |
| V-9 | Timeline 默认不可见/折叠 | — | — | ✅ |
| V-10 | fork/重试或复制入口在消息 chrome 可发现 | — | — | ✅ |

---

### 文件产出计划

**新增（建议）：**

```
apps/vscode-dsh/src/chat-panel/
├── editor-chat-panel.ts          # 单例 WebviewPanel 创建/聚焦/dispose
├── render/tab-bar-dom.ts         # 顶栏 Tab DOM + browser source
└── render/history-search-ui.ts   # Phase 3 overlay（可选独立文件）
```

**修改：**

```
apps/vscode-dsh/package.json              — views / activationEvents / 命令文案
apps/vscode-dsh/src/extension.ts          — activate 注册路径、reveal、TreeView/Timeline 可见性
apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts — HTML 壳 + Tab 条 + settle 路径；去 WebviewView 主注册
apps/vscode-dsh/src/chat-panel/chat-panel-host.ts     — pushTabs；tab actions 路由
apps/vscode-dsh/src/chat-panel/protocol.ts            — panel/tabs + tab actions
apps/vscode-dsh/src/chat-panel/render/message-dom.ts  — settle Markdown
apps/vscode-dsh/src/conversation-tab-bar.ts           — 降级 TreeView；保留投影纯函数
apps/vscode-dsh/src/**/*.test.ts                      — 层 A/B；层 V 清单文档化
```

**不修改（基线）：** `conversation-registry.ts` 身份模型、agent-loop、搜索档 3、ide-bridge 传输契约。

### 关键骨架代码

```typescript
// editor-chat-panel.ts（骨架）
let panel: vscode.WebviewPanel | undefined

export function ensureEditorChatPanel(
  vscode: VsCodeLike,
  host: ChatPanelHost,
): vscode.WebviewPanel {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, false)
    return panel
  }
  panel = vscode.window.createWebviewPanel(
    'dsh.editorChat',
    'Conversation',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  )
  panel.webview.html = buildThinChatHtml(panel.webview.cspSource)
  host.attach({
    postMessage: (m) => void panel!.webview.postMessage(m),
    onDidReceiveMessage: (l) => panel!.webview.onDidReceiveMessage(l),
  })
  panel.onDidDispose(() => {
    host.detach?.() // 若尚无 detach，则 clear port 引用
    panel = undefined
  })
  host.pushFullState()
  host.pushTabs()
  return panel
}
```

```typescript
// Host：Registry → panel/tabs
pushTabs(): void {
  const snap = this.deps.registry.snapshot()
  const items = conversationTreeItems(snap) // 复用标题/未读规则
  this.port?.postMessage({
    type: 'panel/tabs',
    activeTabId: snap.activeTabId,
    tabs: items.map((t) => ({
      tabId: t.tabId,
      sessionId: /* from registry */,
      title: t.label,
      active: t.active,
      unread: t.unread,
      approvalBadge: t.approvalBadge,
    })),
  } satisfies PanelTabsMessage)
}
```

```javascript
// Webview settle（patch 路径）
function settleAssistantMarkdown(el, text) {
  var rendered = renderSafeMarkdown(text || '');
  el.innerHTML = rendered.html;
  el.removeAttribute('data-streaming');
  wireCopyButtons(el);
}
// streaming 中仍用 textContent / patchMessageDom 纯文本路径
```

---

## Phase DAG 依赖

见 `phase-plan.md`。线性：`phase-1` → `phase-2` → `phase-3`（无并行边；壳未立不可做可读流验收）。

---

## 外部依赖

- 无新 npm 运行时依赖。
- 复用既有 `safe-markdown`、`ChatPanelHost` deps（search/fork/cancel/copy）。
- 层 V 需要本机 / CI 可启动的 VS Code Extension Development Host（沿用仓库既有扩展测试惯例；若环境不可用 → verifier 记 PARTIAL 并列出阻塞，不得伪 PASS）。

---

## 高风险子系统

| 风险 | 缓解 |
|------|------|
| Panel dispose 丢呈现态 / 丢 attach（R-2） | `retainContextWhenHidden: true`；dispose 后 re-attach + full push |
| TreeView 与顶栏双投影短暂并存（R-3） | Phase 1 即切断 TreeView 主路径；禁止双写消息权威 |
| settle MD XSS | 只走 `renderSafeMarkdown`；保留 `containsUnsafeHtml` 测试 |
| 层 V 变模糊观感（R-5） | 强制条目化清单 V-1…V-10；每 Phase 子集 |
| `showPanel` 仍指向旧 viewId | 统一改 Editor Panel；返回值/测试断言更新 |

---

## 权衡/替代方案

| 主题 | 选用 | 未选 | 理由 |
|------|------|------|------|
| 壳层 | 单 WebviewPanel | 多 Panel / 保留 WebviewView | Q-1/Q-2 |
| Tab 投影 | Host `panel/tabs` 推送 | Webview 自读 Registry | Webview 无 Registry；权威在 Host |
| 流式 MD | settle 后重渲 | 逐 token 解析 MD | 抖 + 半截 fence；承接 deferred |
| Timeline | 默认 collapsed | 删除实现 | Q-4=B；保留低频入口 |
| Phase 数 | 3 | 2 或 5+ | AC-43；P3 发现/弱化可独立验收 |

---

## 验收标准验证方案（feature 级）

| ID | 类型 | 场景 | 预期结果 | 优先级 |
|----|------|------|---------|:------:|
| VP-1 | 层 V | `dsh.showPanel` | 编辑器区 Panel + 顶栏 Tab | must |
| VP-2 | 层 B | FakeWebview + switch-tab | activeSessionId 切换、messages 不串台 | must |
| VP-3 | 层 A | jsdom Tab DOM | `data-active` 契约 | must |
| VP-4 | 层 A/V | settle 后助手气泡 | `.md-pre` / 强调节点可读 | must |
| VP-5 | 层 B | Stop | I-真 cancel + incomplete | must |
| VP-6 | 层 B | search hit open | 无 auto-Start；既有 search API | must |
| VP-7 | 层 V | 冷启动 | Timeline 默认折叠/隐藏 | must |
| VP-8 | 否定 | 仅 jsdom 绿 | verifier **不得** PASS | must |

---

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| — | — | — | — | — | — |

## 建议的下一步

进入 HG-2：用户确认本设计与 Phase DAG 后，从 `phase-1-editor-shell-tabs` 启动 code-explorer → implementer。
