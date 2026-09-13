# Solution Design: vscode-dsh-editor-chat-panel

<!--
  slug: vscode-dsh-editor-chat-panel
  audience: implementer / reviewer / verifier / HG-2
  language: zh (canonical). Mirror: design-zh.md
  constitution: §7
  status: rewrite 2026-09-13 — AD-ECP-8 → React+Vite webview SPA
  created: 2026-09-13
  inputs: requirements.md + requirements-ui.md + ui-visual-spec.md
  hg1-lock: Q-1…Q-7 / E14–E16
  hg-ui: passed
  note: HG-UI confirmed 2026-09-13（用户「进入方案设计」）；requirements-ui / ui-visual-spec header 已同步 passed
  amended: 2026-09-13 审查合入 — 删除确认归属、Q-5 提示通道、CI 打包、先建后拆、P1 豁免、探针/RTL 分工、AD-ECP-8 内联退役自决标注、retainContext AD
  superseded: 原「继续模块化内联 HTML」已废止；内联不得再作主呈现路径
-->

## 范围覆盖

本设计覆盖完整 feature（**2 Phase** DAG，见 `phase-plan.md`）。满足 AC-43（2–3 Phase）：P1=壳+React 脚手架+顶栏 Tab+基础历史+最小可聊；P2=可读流+能力+完整历史+视觉收齐+内联主路径退出。

| Phase ID | 用户可感知增量 |
|----------|----------------|
| `phase-1-shell-tabs-basic-history` | 编辑器区唯一主面（React SPA webview）；顶栏 Tab；主动打开/恢复/外部切会话；关 Panel×running 后台继续+提示；顶栏历史→面板内基础列表；最小可聊通；层 A（RTL）冒烟 + ≥1 层 V |
| `phase-2-stream-capabilities-full-history` | settle Markdown+sanitize；活动/引用/变更/composer 四态；复制/fork/Continue；完整历史（删除一致/Continue/父子/档1+2）；Timeline 弱化；层 V 全清单；`buildThinChatHtml` 退出主路径 |

**作废目录（禁止实施）：**

| 目录 | 状态 |
|------|------|
| `phases/phase-1-editor-shell-tabs/` | **OBSOLETE** |
| `phases/phase-2-usable-stream/` | **OBSOLETE** |
| `phases/phase-3-discovery-timeline-v/` | **OBSOLETE** |

**HG-1 / HG-UI 锁定（不得推翻）：**

| ID | 决议 |
|----|------|
| Q-1=A | 废弃侧栏主聊天；唯一 Editor Chat Panel |
| Q-2=A | 单 Panel 内顶栏多 Tab |
| Q-3=A | 历史/搜索以面板 UI 为主 |
| Q-4=B | Timeline 进一步弱化 |
| Q-5=A | 关 Panel×running → 后台继续 + 可见提示 |
| Q-6=A / E16 | 删除 Must；顶栏↔历史语义一致 |
| Q-7=A | 不自动弹 Panel |
| E14 / AC-45 | 全文无 Should |
| E15 / F5 | 历史窗口 Must；Phase 1 起历史入口不可空窗（AC-50a） |
| U1–U6 | IDE 原生 + Cursor 薄顶栏 + Continue 消息密度；开源仅前端样式 |

**UI 设计输入（必须一并遵守）：**

- [`requirements-ui.md`](./requirements-ui.md) — UI-AC-*
- [`ui-visual-spec.md`](./ui-visual-spec.md) — 布局 / token / 反模式 / 开源对齐 / 层 V 清单（呈现结果契约；技术栈见本文 AD-ECP-8）

---

## 架构摘要

将侧栏 `WebviewView`（`dsh.chat`）+ Conversations `TreeView` Tab 条收敛为**唯一**编辑器区单例 `WebviewPanel`。Panel 的 HTML 入口加载 **React + Vite（或等价）webview SPA**（AD-ECP-8）；Host 经既有 protocol 帧（`panel/state`、`panel/tabs`、`panel/history`、`messages/*`、`status/set` 等）下发**决策态**；React 侧经 **MessageBridge** 薄适配写入 store，只持**呈现态**。多会话身份仍以 `ConversationRegistry` 为权威。消息/cancel/fork/Continue/搜索档1+2/`deleteSession` 复用既有 Host/Controller，**不**重做 agent-loop。历史窗口为面板内列表。视觉按 `ui-visual-spec.md` theme-first（`--vscode-*`）。验证保留层 A + B + V 闭环，手段适配 React（AD-ECP-10）；**禁止**用旧 `buildThinChatHtml` 层 A 绿冒充新 UI。

---

## 架构决策

### AD-ECP-1 — 唯一主面 = Editor `WebviewPanel`（Q-1=A）

- **决议**：主聊天面改为 `vscode.window.createWebviewPanel` 单例（`viewType` 如 `dsh.editorChat`）；废弃 `dsh.chat` WebviewView 作为可读写消息流。旧 `reveal` / `dsh.showPanel` / `dsh.chat.focus` 改为打开或聚焦该 Panel。
- **理由**：宪法 §7.1；双主面必然分叉投影权威。
- **替代方案（已否决）**：保留侧栏 WebviewView 作次面。
- **允许**：侧栏保留「打开 Conversation」launcher / 迁移提示；**禁止**第二套 messages 投影。

### AD-ECP-2 — 单 Panel 内顶栏 Tab（Q-2=A / E7）

- **决议**：全局至多一个 Editor Chat Panel；未关会话以面板内水平 Tab 投影 Registry；**禁止**「一会话一 VS Code editor tab」主模型。
- **理由**：对齐参考图与 Cursor 体验；Registry 已是身份模型。
- **替代方案（已否决）**：每会话 `createWebviewPanel`。

### AD-ECP-3 — 历史窗口 = 面板内列表（Q-3=A / E15 / AC-50a）

- **决议**：顶栏 History 打开**面板内**历史列表；数据来自既有 `ExtensionIndex.listHistorySessions`（及档 1+2）；命令可并存但不得替代面板窗口。
- **Phase 1**：标题+时间+预览/路径骨架、点击打开（去重+只读）、空态/loading（AC-50/51/52/58/50a）。
- **Phase 2**：Continue、删除、父子、档 1+2 搜索联动、Registry 实时（AC-53–57/59）及与顶栏删除一致（AC-60）。
- **替代方案（已否决）**：仅 QuickPick；或把整段 F5 拖到末 Phase。

### AD-ECP-4 — 关 Panel × running（Q-5=A）

- **决议**：`onDidDispose` 时若存在 `status===running` 的 Tab：**不** cancel；给出**可见提示**；Registry / 会话进程保持；再开按 AC-1b 恢复。
- **可见提示通道（层 V 可查）**：
  1. `vscode.window.showInformationMessage`（或 `showWarningMessage`）——主通知；
  2. 若 Status Bar item 已存在可同步文案；**至少 (1) 必须执行**。
- **替代方案（已否决）**：关 Panel 静默 cancel；仅写日志无人可读。

### AD-ECP-5 — 不自动弹 Panel（Q-7=A）

- **决议**：activate / 工作区激活 / 有未关会话时 **不得** 自动 `createWebviewPanel`。
- **替代方案（已否决）**：有未关会话则自动 reveal。

### AD-ECP-6 — 删除统一后端（Q-6 / E16 / AC-60）

- **决议**：顶栏右键、溢出「删除会话」、历史条目删除 **全部** 调用同一 `ConversationController.deleteSession`；关 Tab ≠ 删除。
- **确认 UI 归属**：**webview 内 modal**（React），文案含「不可恢复」；确认后发 `ui/delete-request` → Host 执行同一后端。选用 webview modal 以便层 A 断言确认框 DOM；**禁止**仅用原生 `showWarningMessage` 作为唯一确认且无法层 A 探测（原生 dialog 可作为增强，不得替代 webview 确认契约）。
- **替代方案（已否决）**：两处各写一套删除；无确认静默删。

### AD-ECP-7 — Timeline 弱化（Q-4=B / AC-44）

- **决议**：Timeline 默认 collapsed/隐藏；溢出提供「打开 Timeline」；活动主投影在消息流 activity 行。
- **替代方案（已否决）**：删除 Timeline 代码；或默认展开作主面。

### AD-ECP-8 — 技术栈：React + Vite webview SPA（主呈现路径）【supersedes 内联 HTML】

- **决议（现行）**：本 feature **采用 React + Vite（或等价 SPA 打包）** 作为 Editor Chat Panel **唯一主呈现路径**。源码位于 `apps/vscode-dsh/webview/`；构建产物由 Host 经 `asWebviewUri` 注入 Panel；CSP 允许本地脚本/样式。Host 决策态与既有 protocol 帧形状保持；**不**重做 agent-loop；theme-first（`--vscode-*` / `--dsh-*`）；开源（OpenCursor / Continue `gui/` / OpenCUI）**只借**前端骨架与样式密度，禁止抄后端。
- **理由**：对齐主流；避免二次重写呈现层；UO-4 授权 design 选型；RTL+DOM 契约可延续层 A。
- **内联退出主路径（自决技术债治理，非 requirements 强制）**：UO-4 仅规定「不强制上 React」，**未**要求拆除内联。本 design **自决**：P2 结束时 `buildThinChatHtml` 退出生产路径，以避免双主路径假绿（AD-ECP-10）。该工作量计入 P2；若 HG-2 否决退役，须改为「生产仅 React、内联仅测试夹具」并书面记录。
- **替代方案（已否决）**：继续内联为主路径；无论证换 Vue。
- **约束**：P1 起生产 HTML = React；禁止先内联再 React 双主路径。

### AD-ECP-9 — 决策态 Host / 呈现态 Webview（AC-3）

- **决议**：能否发送、mode、Continue、变更审阅权威结果仅 Host 裁定；React store 不得本地「猜」可发送。
- **替代方案（已否决）**：Webview 本地乐观解锁 composer。

### AD-ECP-10 — 验证架构（层 A + B + V，React 适配）

见专章「验证架构（AD-ECP-10）」。

### AD-ECP-11 — Panel 保活策略

- **决议**：采用 `retainContextWhenHidden: true`，接受隐藏时 webview 常驻内存，换取再聚焦时呈现态（滚动/折叠/历史开合）保留与更少冷启动。
- **理由**：对话 Panel 为高频切回面；序列化/恢复成本高且易丢呈现态。
- **替代方案**：`retainContextWhenHidden: false` + setState/getState 序列化——P2+ 可再评估；本 feature 默认 retain。
- **风险**：多工作区内存；缓解：单例 Panel（AD-ECP-2）限制实例数。

---

## 验证架构（AD-ECP-10）

本 feature **Must** 达标 = 层 A + 层 B + 层 V（E2 / E9 / AC-40–42）。换栈后手段适配如下；闭环不得降级。

### 三层手段对照

| 层 | 含义 | React 后手段 | 禁止 |
|----|------|--------------|------|
| **A** | 可脚本 DOM | **React Testing Library + jsdom**；按固定 DOM 契约表断言 `data-testid` / `data-message-id` / `data-role` / `data-follow-state` 等；纯函数（`follow-state`、sanitize）继续单测 | **禁止**用旧 `buildThinChatHtml` 层 A 绿冒充新 UI 过关 |
| **B** | Host/协议 | **FakeWebview** + Host/Controller 协议帧（tabs / history / state / send / delete / continue / cancel / fork）——基本延续；Host **不**依赖 React | 用 mock React 代替 FakeWebview 宣称层 B |
| **V** | 人眼可用 | 真机 VS Code 扩展宿主 + `ui-visual-spec.md` §9 清单；**双主题**（light/dark）抽检 | 仅截图/DOM 存在性冒充层 V |

### DOM 契约表（层 A 真相源；各 Phase spec 可摘录子集）

React 组件 **必须**在稳定节点上保留下列契约（名称可扩展，删除须同步改测试与探针）：

| 契约属性 / 选择器 | 用途 | 最低出现 Phase |
|-------------------|------|----------------|
| `[data-testid="editor-chat-root"]` | Panel SPA 根 | P1 |
| `[data-testid="tab-chrome"]` / `[data-testid="tab-item"][data-tab-id]` | 顶栏 Tab | P1 |
| `[data-testid="tab-item"][data-active="true"]` | 活动 Tab | P1 |
| `[data-testid="btn-new-tab"]` / `btn-history` / `btn-search` / `btn-overflow` | 顶栏动作 | P1 |
| `[data-testid="history-panel"]` / `[data-testid="history-row"][data-session-id]` | 历史窗口 | P1 |
| `[data-testid="history-empty"]` / `history-loading` | 空态/loading | P1 |
| `[data-testid="composer"]` + `data-composer-state` = `live\|readonly\|waiting\|error` | composer 四态（**不含**第五态「停止中」） | P1 骨架；P2 齐全 |
| `[data-testid="btn-stop"]` | 停止按钮；停止中：`disabled` + 可见 | P2（P1 不交付） |
| `[data-testid="status"]` | Status/生成中/停止中/错误摘要行（§5.6；P1 允许仅此承载 streaming 指示） | **P1** |
| `[data-testid="msg"][data-message-id][data-role]` | 消息气泡 | P1 最小可聊；P2 settle |
| `[data-testid="messages-empty"]` / `messages-loading` | 消息区空态/loading（UI-AC-24） | **P1** |
| `[data-follow-state]` on root | 跟滚探针（T7） | P2（P1 可先挂属性） |
| `[data-testid="activity-row"]` / `ref-card` / `change-list` | 能力入口 | P2 |
| `[data-testid="btn-copy"]` / `btn-continue` / `btn-stop` | 复制/Continue/停止 | P2 |
| `window.__dshProbes`（或文档标明的等价） | e2e/层 A 探针面 | P1 起兼容 |

### MessageBridge（薄适配层）

```
Host (protocol frames)
        │  postMessage / onDidReceiveMessage
        ▼
┌───────────────────────┐
│ MessageBridge         │  帧 ↔ React store（单向决策态下行；意图上行）
│  - applyFrame(frame)  │  不裁定能否发送；不改写 session 权威
│  - emitIntent(intent) │
└───────────────────────┘
        │
        ▼
 React store / hooks → 组件树（呈现态）
```

- Bridge **必须**薄：映射既有帧类型（`panel/state`、`panel/tabs`、`panel/history`、`messages/*`、`status/set`、`ui/reject-send` 等）与 chrome 意图（`ui/tab-select`、`ui/history-open`、`ui/delete-request`、`ui/continue`、send/stop 等）。
- Host 侧可有对称适配（`src/chat-panel/bridge/`）把 Panel webview port 接到 `ChatPanelHost`；**Host 逻辑不 import React**。

### Probe 兼容

- Phase 1 起在 SPA 启动时挂载 `window.__dshProbes`（或等价命名空间，须在 implementation.md 写明），暴露至少：`getFollowState`、`getActiveTabId`、`getComposerState`、`queryMessages()` 等只读探针，使旧 FakeWebview / **层 V / e2e** 思路可迁。
- 探针 **不得**成为第二套决策权威。
- **分工**：**层 A（RTL）必须直接断言 DOM 契约属性，不得依赖 `__dshProbes` 作为唯一证据**；探针供真机 e2e / 层 V 辅助与迁移期兼容。

### CSP / asWebviewUri 冒烟

- Panel `webview.options`：`enableScripts: true`；HTML 仅引用经 `webview.asWebviewUri` 的本地 bundle（js/css）。
- CSP：`default-src 'none'`；`script-src` / `style-src` 绑定 `webview.cspSource`；**禁止**外链字体 CDN / 任意 remote script（对齐 U2）。
- Phase 1 **Must** 有冒烟：构建产物可加载；无 CSP 控制台阻断主路径；主题变量可读。

### 打包 / CI 硬验收（P1 Must）

| 项 | 要求 |
|----|------|
| 构建 | `webview/` 有独立 Vite build；根 `package.json` scripts 含 `webview:build`（或等价），扩展编译前/并跑 |
| 产物 | `webview/dist/`（或文档标明路径）含 js/css；**纳入**扩展发布物 |
| `.vscodeignore` | **不得**排除生产所需 `webview/dist/**`；可忽略 `webview/src`、node_modules |
| `vsce package` / 本地 VSIX | 打包后在**干净宿主**加载扩展，打开 Panel SPA 可渲染（非白屏） |
| 离线 | 无外链字体/脚本依赖（U2） |

缺任一项 → P1 verifier **不得** PASS。

### 旧内联层 A 退役策略（防假绿口径）

| 阶段 | 规则 |
|------|------|
| Phase 1 起 | Panel 生产 HTML = React SPA；`buildThinChatHtml` 标 **deprecated**；**本 feature UI PASS 证据集** = 仅 React RTL 层 A + 层 B + 层 V；旧层 A 文件若仍绿：须标 `describe.skip` / 迁测 / 文件头注明「非本 feature 证据」；reviewer **拒收**「旧套件绿 = UI 完成」 |
| Phase 2 结束 | `buildThinChatHtml` **退出主路径**（删除或仅非生产夹具）；CI 中本 feature 相关 job **不得**把旧 HTML 套件当作 required check |

### P1 豁免清单（消解 C4；AC-41 延期规则）

P1 层 V / UI 验收 **不要求**下列项齐全（须在 `phases/phase-1-…/spec.md` 与 verification 重申；**不得**因此跳过已映射 P1 的 UI-AC）：

| 豁免项 | 延至 | 说明 |
|--------|------|------|
| UI-AC-30 完整四态人眼可分 | P2 | P1 须 sticky composer + `data-composer-state`；至少 live 可发 |
| UI-AC-32 消息区生成中精致指示 / Stop 完整 | P2 | P1 允许仅 `[data-testid="status"]`「生成中」；**P1 不交付 Stop**（AC-33b 层 V 延至 P2） |
| UI-AC-20/23 气泡弱描边 + MD settle 精修 | P2 | P1 最小可聊可读即可 |
| UI-AC-42/43 历史删除/Continue/父子 | P2 | P1 基础列表+打开 |
| UI-AC-51/52 动效与 ≥8px 精修 | P2 | **不豁免** UI-AC-50 基础 hover/focus（P1 已交付控件必须满足） |
| **AC-23a** 失败/断连可理解原因文案 | P2 | P1 **Must**：streaming 指示 fail-closed 结束（AC-25）；完整 AC-23a 文案与可操作提示 → P2 |

**不在豁免列（P1 必查）**：UI-AC-24 消息区空态/loading 骨架；UI-AC-50 对已交付控件的基础 hover/focus。

标注延期 **不得**作为「未测也 PASS」；仅表示上述项不纳入 P1 PASS 范围。

### 「停止中」DOM 约定（R7；P2 Must，非第五 composer 态）

- `data-composer-state` **保持**四值枚举，不新增 `stopping`。
- **停止中** = 当前态不变 + `[data-testid="btn-stop"][disabled]` + `[data-testid="status"]` 文案含「正在停止…」（或等价）；直至 cancel 完成/失败后按 AC-23/23a 收口。
- 层 A：断言 Stop disabled + status 文本；层 B：真 cancel 调用。

### 闭环路径（Must 可追溯）

```
composer send (React)
  → Bridge emitIntent(ui/send|…)
  → Host / Controller（决策态、真 cancel/fork 等）
  → messages/* + panel/state 帧
  → Bridge applyFrame → React store
  → React 渲染 DOM（契约属性）
  → 层 A（RTL）/ 层 B（FakeWebview）/ 层 V（真机）断言
```

任一层断裂 → verifier 不得 PASS（AC-42）。

---

## 核心实体 / 数据模型

### 不变（复用）

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

// ChatPanelHost — 决策态下发；requestDelete / cancel / fork / Continue 既有 deps
```

### 新增 / 调整

```typescript
/** 单例 Editor Chat Panel 控制器 */
interface EditorChatPanelController {
  openOrFocus(opts?: { sessionId?: string; preserveFocus?: boolean }): Promise<void>
  isOpen(): boolean
  dispose(): void
}

/** Host → Webview：顶栏投影 */
type PanelTabsFrame = {
  type: 'panel/tabs'
  activeTabId: string | undefined
  tabs: Array<{
    tabId: string
    title: string
    status: ConversationTab['status']
    unread: boolean
    approvalBadge: boolean
    mode: OpenTabMode
    parentHint?: string  // Phase 2
  }>
}

/** Host → Webview：历史列表投影 */
type PanelHistoryFrame = {
  type: 'panel/history'
  open: boolean
  loading: boolean
  query?: string
  rows: Array<{
    sessionId: string
    title: string
    updatedAt: string
    previewOrPath: string
    parentTitle?: string
    continueHint?: string
  }>
}

/** Webview → Host：chrome 意图（示意） */
type ChromeIntent =
  | { type: 'ui/tab-select'; tabId: string }
  | { type: 'ui/tab-close'; tabId: string }
  | { type: 'ui/tab-new' }
  | { type: 'ui/history-open' }
  | { type: 'ui/history-close' }
  | { type: 'ui/history-select'; sessionId: string }
  | { type: 'ui/search-query'; query: string }
  | { type: 'ui/delete-request'; sessionId: string }
  | { type: 'ui/continue'; sessionId: string }
  | { type: 'ui/open-timeline' }

/** React 侧呈现态（示例；实现可微调） */
type ChatUiStore = {
  tabs: PanelTabsFrame['tabs']
  activeTabId?: string
  history: PanelHistoryFrame
  messages: Array<{ id: string; role: string; /* … */ }>
  composerState: 'live' | 'readonly' | 'waiting' | 'error'
  followState: 'follow' | 'pinned' | string
  // 决策字段只镜像 Host 帧，不本地推导发送权
}
```

---

## API 域

| 表面 | 变更 |
|------|------|
| `EditorChatPanelController`（新） | `openOrFocus` / dispose；加载 React SPA HTML |
| `registerChatPanelProvider` | Phase 1：停止作为主消息流；migration stub |
| `package.json` / 构建 | Vite webview 构建脚本；扩展打包纳入 `webview/dist` |
| `ConversationRegistry` | API 不变；订阅驱动 `panel/tabs` |
| `ConversationController.deleteSession` | 唯一删除后端 |
| `ExtensionIndex.listHistorySessions` | 历史数据源 |
| `MessageBridge`（webview + 可选 Host bridge） | 帧 ↔ store |
| `buildThinChatHtml` | **deprecated → P2 退出主路径** |

**不新增**：agent-loop、MCP、搜索档 3、thinking UI、新审批表单协议。

---

## 实现方案

### 总体步骤（先建后拆）

**顺序铁律**：先建立 React Panel 最小可聊并可层 A/B 冒烟，再切断侧栏主聊天可读写路径。禁止「先拆唯一可用面、新壳未通」。

1. **Phase 1 — React 壳 + 顶栏 + 历史骨架 + 最小可聊**
   1. Vite+React 脚手架 + 打包进扩展（见「打包 / CI」）+ CSP/`asWebviewUri` 冒烟。
   2. MessageBridge + DOM 契约 + `__dshProbes`；RTL 层 A 冒烟套件。
   3. `EditorChatPanelController` 单例；Q-5（通知通道）/ Q-7；Host attach；**最小 send/stream 通**。
   4. 顶栏 Tab + 历史基础列表（AC-50a）。
   5. **确认新壳可聊后**：废弃侧栏主聊天可读写路径（AC-4/5）。
   6. ≥1 层 V（对照 §9 Phase 1 + P1 豁免）；`buildThinChatHtml` deprecated。

2. **Phase 2 — 可读流 + 能力 + 完整历史 + 退役内联**
   - MD settle；活动/引用/变更；composer 四态+Stop；复制/fork/Continue。
   - 完整历史（webview 删除确认 + AC-60）；Timeline 弱化；§9 Phase 2（含原 P3）层 V。
   - 移除或 stub 内联主路径。

### 文件产出计划（预期）

**新增：**

```
apps/vscode-dsh/webview/
  package.json / vite.config.ts / index.html
  src/
    main.tsx
    App.tsx
    bridge/message-bridge.ts
    store/chat-ui-store.ts
    components/TabChrome.tsx
    components/HistoryPanel.tsx
    components/MessageList.tsx
    components/Composer.tsx
    probes.ts                 — __dshProbes
    styles/tokens.css         — --vscode-* / --dsh-*
  …

apps/vscode-dsh/src/chat-panel/
  editor-chat-panel.ts        — WebviewPanel 单例 + SPA HTML 注入
  bridge/                     — Host 侧 port 适配（可选独立文件）
```

**修改：**

```
apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts  — 降级；buildThinChatHtml deprecated
apps/vscode-dsh/src/chat-panel/chat-panel-host.ts        — tabs/history 帧接线
apps/vscode-dsh/src/extension.ts                        — 打开命令；去自动弹；侧栏降级
apps/vscode-dsh/src/conversation-tab-bar.ts              — 主路径停用
apps/vscode-dsh/src/history-view.ts                      — 数据投影复用
apps/vscode-dsh/package.json                            — contributes + webview build
apps/vscode-dsh/tests/layer-a/*                         — 迁 RTL；禁 buildThinChatHtml 假绿
```

### 关键骨架（示意）

```typescript
// editor-chat-panel.ts（骨架）
export function createEditorChatPanelController(deps: {
  vscode: EditorChatVsCode
  panelHost: ChatPanelHost
  registry: ConversationRegistry
  getWebviewHtml: (webview: vscode.Webview) => string  // React SPA + asWebviewUri
  onRunningPanelClosed: () => void  // showInformationMessage（AD-ECP-4）
}): EditorChatPanelController {
  let panel: WebviewPanel | undefined
  return {
    async openOrFocus(opts) {
      if (panel) { panel.reveal(...); /* switch if opts.sessionId */ return }
      panel = deps.vscode.window.createWebviewPanel(
        'dsh.editorChat', 'Conversation', /* column */,
        {
          enableScripts: true,
          retainContextWhenHidden: true, // AD-ECP-11
          localResourceRoots: [/* webview/dist */],
        },
      )
      panel.webview.html = deps.getWebviewHtml(panel.webview)
      deps.panelHost.attach(/* port from panel.webview */)
      panel.onDidDispose(() => {
        const running = deps.registry.snapshot().tabs.some(t => t.status === 'running')
        if (running) deps.onRunningPanelClosed()  // Q-5: 不 cancel
        deps.panelHost.detach?.()
        panel = undefined
      })
    },
    isOpen: () => panel !== undefined,
    dispose: () => panel?.dispose(),
  }
}

// webview MessageBridge（骨架）
export function createMessageBridge(opts: {
  postToHost: (msg: unknown) => void
  store: { applyFrame: (f: unknown) => void }
}) {
  return {
    onHostMessage(raw: unknown) { opts.store.applyFrame(raw) },
    sendIntent(intent: ChromeIntent) { opts.postToHost(intent) },
  }
}
```

---

## UI / 视觉契约绑定

| 文档 | 设计如何引用 |
|------|----------------|
| `requirements-ui.md` | 每 Phase spec 列出所属 UI-AC-*；verifier 层 V 对照 UI-AC + 功能 AC |
| `ui-visual-spec.md` | 布局 §3、token §4、组件 §5、反模式 §2、开源 §6、层 V §9；**技术栈以本文 AD-ECP-8 为准**（visual spec §8 不约束框架） |

**气质**：IDE 原生（U2）+ Cursor 薄顶栏（UF1）+ Continue 消息密度（UF2/UF3）。

---

## Phase DAG 依赖

```
phase-1-shell-tabs-basic-history
        │
        ▼
phase-2-stream-capabilities-full-history
```

选用 **2 Phase** 理由：AC-43；用户推荐默认；React 脚手架与壳/Tab/基础历史同 Phase 交付可避免「空壳 SPA」；能力与完整历史天然依赖壳。评估 3 Phase 会把 Tab/历史与脚手架拆开，增加 HG-3 开销且中间态难验收「可聊主面」，故不采用。详见 `phase-plan.md`。

---

## 外部依赖

- **新增（webview）**：React、React DOM、Vite（及类型/RTL/jsdom 测试栈）；锁定在 `webview/` 子包或 workspace，避免污染扩展 Host 运行时。
- Host 扩展包：**无**强制新运行时 npm（构建时打入 webview 静态资源）。
- 可选：只读对照开源前端（不打进产物）。
- 无新基础设施。

---

## 高风险子系统

| ID | 风险 | 缓解 |
|----|------|------|
| R-2 | Panel dispose 误 cancel | AD-ECP-4；层 B |
| R-10 | 历史入口空窗 | AC-50a 入 P1；层 V |
| R-11 | 删除两处不一致 | 单一 `deleteSession`；AC-60 |
| UR-1 | 做成换皮落地页 | U2/U3；UI-AC-62 |
| 串台 | Tab 切换消息混合 | activeTabId 全量重绑；AC-11b |
| 自动弹 | activate reveal | AD-ECP-5；AC-1f |
| 双主路径假绿 | 内联层 A 仍绿 | AD-ECP-8/10 退役策略；reviewer 拒收 |
| CSP | SPA 加载失败 | P1 asWebviewUri+CSP 冒烟 Must |

---

## 权衡 / 替代方案总表

| 主题 | 选定 | 否决 |
|------|------|------|
| 主面 | 单例 WebviewPanel | 侧栏双主面；每会话 editor tab |
| 历史 | 面板内列表 | 仅 QuickPick；整段拖末 Phase |
| 关 Panel | 后台继续+提示 | 静默 cancel |
| **技术栈** | **React + Vite SPA** | **继续内联 HTML 为主路径** |
| Phase 数 | **2** | 5+；先内联再 React；无论证的 3 段 |

---

## 验收标准验证方案（feature 级）

### 场景表（抽检）

| ID | 类型 | 场景 | 预期 | 层 |
|----|------|------|------|----|
| VP-1 | functional | 主动打开主入口 | 编辑器区 Panel；React SPA 加载 | A+B+V |
| VP-2 | functional | 多 Tab 切换 | 不串台；标题/running 可见 | A+B+V |
| VP-3 | boundary | activate 有未关会话 | **不**自动弹 Panel | B |
| VP-4 | functional | 关 Panel×running | **InformationMessage** 提示；未 cancel；再开可回 | B+V |
| VP-5 | functional | 顶栏历史 | 面板内列表或空态/loading | A+V |
| VP-6 | functional | 顶栏与历史删除 | **webview modal** 确认 + 同一后端；同步 | A+B+V |
| VP-7 | visual | light/dark | `--vscode-*`；无外链字体/霓虹 | V |
| VP-8 | visual | settle MD + 四态 | UI-AC-20/23/30；§9 P2 | V |
| VP-9 | regression | fork/Continue/cancel/搜索 | 既有语义 | B |
| VP-10 | tech | CSP / asWebviewUri / VSIX | SPA 可加载；干净宿主非白屏 | A/冒烟 |
| VP-11 | tech | 禁内联假绿 | 本 feature UI 证据仅 React 层 A | review |

### AC / UI-AC → 层覆盖（摘要矩阵；细则以 phase spec 为准）

| 证据类 | 典型 AC / UI-AC | A | B | V |
|--------|-----------------|:-:|:-:|:-:|
| Panel 壳 / Q-7 | AC-1, AC-1f, AC-2 | ✓ | ✓ | ✓ |
| Q-5 关 Panel | AC-1e | — | ✓ | ✓ |
| 顶栏 Tab | AC-10–16, UI-AC-10–14 | ✓ | ✓ | ✓ |
| 历史骨架 | AC-50–52, AC-58, AC-50a, UI-AC-40–41 | ✓ | ✓ | ✓ |
| 最小可聊 | AC-3, send/stream | ✓ | ✓ | ✓ |
| 只读+Continue | AC-20a, AC-53, AC-38a | ✓ | ✓ | ✓（P2） |
| 删除一致 | AC-13c, AC-55, AC-60 | ✓ modal | ✓ | ✓（P2） |
| 消息/能力 | AC-20–36, UI-AC-20–32 | ✓ | ✓ | ✓（P2） |
| 完整历史 | AC-53–60, UI-AC-42–43 | ✓ | ✓ | ✓（P2） |
| 层 V 门禁 | AC-40–42, UI-AC-61 | — | — | ✓ |
| 无障碍底线 | UI-AC-50–52 | ✓ | — | ✓（P2） |

**规则**：标「P2」的项不得用 P1 层 V 宣称已交付；P1 豁免见 AD-ECP-10。

每 Phase ≥1 层 V（E9）；对照 `ui-visual-spec.md` §9（UI-AC-61）。

---

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| 1 | 2026-09-13 | 2026-09-11 全稿 | 整份重写：F5/E16/UI；2 Phase | HG-2 待确认 | HG-UI |
| 2 | 2026-09-13 | AD-ECP-8 内联 HTML | **React+Vite SPA 主路径**；新增 AD-ECP-10 | HG-2 待确认 | 用户确认换栈 |
| 3 | 2026-09-13 | 审查缺口 | 删除 webview modal；Q-5 通知通道；CI/VSIX；先建后拆；P1 豁免；探针≠层 A；AD-ECP-8 退役自决；AD-ECP-11 retain；覆盖矩阵 | HG-2 待确认 | 跨文档审查 |
| 4 | 2026-09-13 | 复检残留 | status/messages-empty 入契约；停止中 DOM；P1 豁免收窄 UI-AC-50；AC-23a→P2；§9 消息区空态 | **HG-2 passed** | 用户复检放行 |

## 建议的下一步

HG-2 **已通过**。下一步：`code-explorer` → `git checkout -b impl-phase-1-shell-tabs-basic-history` → `implementer`（Phase 1）。
