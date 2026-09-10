# Design: vscode-dsh-chat-ux

<!--
  slug: vscode-dsh-chat-ux
  audience: implementer / reviewer / verifier / HG-2
  language: zh (canonical). Mirror: design-zh.md
  requirements: .specdev/specs/vscode-dsh-chat-ux/requirements.md (HG-1 passed)
  constitution: .specdev/specs/vscode-dsh-chat-ux/constitution.md (§7)
  exploration: .specdev/specs/vscode-dsh-chat-ux/exploration-findings.md (X1–X7)
  prior: chat-ready / conversation-ui / code-context-diff
  created: 2026-09-10
-->

## 范围覆盖

本设计覆盖整个 feature `vscode-dsh-chat-ux`：在已交付的对话面板 / 多 Tab / 回放 / Continue / 变更列表与审阅撤销底座上，交付「日常敢用」体验——**修订 AD-CU-1（呈现态下放 + 探针）**、可脚本渲染层 A 基建、流式 `assistant/chunk` 投影、I-真 cancel、跟滚 follow-state、内嵌活动流、消息复制/重试/编辑（P-接续+E2）、显式分叉（P-标明）、引用卡共享解析、变更归属与 T8 内联 diff、搜索档 1+2。

对应 `requirements.md` AC-1…AC-73（含 AC-13b/c/d、AC-31b）。**不**覆盖：多窗口、重做多 Tab、改 agent-loop / 同会话 truncate、搜索档 3、thinking UI（T6 锁定 B）、中断自动 revert、真 Electron Must、第二 slug。

Phase 拆分见 `phase-plan.md`。各 Phase 细规与逐条验证策略见 `phases/<phase-id>/spec.md`。

## 架构摘要

扩展继续做**投影 + Host 决策权威 + 扩展索引**；权威正文仍在 DSH 会话日志。本 feature **修订 AD-CU-1**：Webview 可合法持有呈现态（滚动、展开折叠、流式中间态、optimistic UI、`follow-state`），但 **mode / sessionId / 能否发送 / Continue / 变更审阅撤销权威结果** 仍只由 Host 裁决。凡下放呈现态必须暴露 `dsh.test.*` 或 DOM 契约探针；若存在 optimistic，须可观测收敛态并向 Host 权威收敛（AC-3 条件探针，禁止无 optimistic 时造假探针）。

**层 A 验证基建（F0 前置）**：从内联 Webview HTML 抽离 `render/sync` TS 模块，jsdom 挂载后断言真实节点/属性；跟滚为纯决策函数 + `data-follow-state`。**禁止**以整页 `runScripts: 'dangerously'` 作主达标路径；**禁止**仅 `toContain` 冒充层 A。Host 行为（cancel / fork / 搜索命中 / 换 sessionId）强制层 B。

**流式与中断**：Host 订阅并投影既有 `assistant/chunk` 文本；协议帧新增增量 patch，保持 `data-message-id` 节点身份。Stop → bridge 新帧 `session/cancel` → `sdkSessionCancel` → 已有 `Agent.cancel(..., { keepInbox: true })`，不改 agent-loop。incomplete 认 live `turn/end` `reason.kind === 'aborted'`（及既有 `interrupted`）。T6 锁定 B：不消费/不展示 reasoning。

**活动流 / 引用 / diff**：对话内嵌活动项（默认折叠、同回合归组、`running→done|failed|aborted`）；引用卡走共享确定性解析；diff 默认内联预览 + 显式跳原生。Timeline 保持弱化。

**Fork 产品路径**：重试/编辑 = `sessions.fork` @ 已关闭 turn + **P-接续**（切 child；**父 Tab mode→replay** + E2 封印）；显式分叉 = 同机制 + **P-标明**（父 mode 不强制改）。变更基线 = fork 时当前磁盘；不拷贝父 Change index；不 checkout。搜索档 1 用既有索引字段；档 2 新建 path→session 反查索引；无档 3。引用卡解析复用 AD-CCD-11 / `at-path`（AD-CUX-11）。

## 相对前序策略变更

| 主题 | conversation-ui / code-context-diff 现状 | 本设计 |
|------|------------------------------------------|--------|
| AD-CU-1 | 极薄 Webview，不得持决策/呈现态 | **修订**：呈现态可下放 + 强制探针；决策态仍 Host |
| 达标门槛 | L2/L3 Host；真实渲染 L4 辅助 | **层 A 进 Must**（抽离模块 + jsdom）；层 B Host；层 C 仅辅助 |
| 助手输出 | 完整 `messages/append` 回合级 | 增量 `messages/patch`（chunk）+ 结束收敛；节点身份保持 |
| Stop | 无 turn cancel（`dsh.stopSession`≠cancel） | I-真：`session/cancel` → `Agent.cancel` |
| 活动 | 仅 Timeline / 无对话内活动项 | 对话内嵌活动项 + 状态机 |
| 重试/编辑/分叉 | 无产品路径 | fork @ closed turn；P-接续 / P-标明 |
| incomplete | `detectIncomplete` 不认 `aborted` | 认 `aborted` + `interrupted` |
| 搜索 | 历史列表；无档 2 path 反查 | 档 1 READY 字段 + 档 2 path→session 索引 |
| thinking | 协议有、扩展忽略 | **锁定 B**：继续不展示 |

## 架构决策

### AD-CUX-1 — 修订 AD-CU-1：呈现态下放 + 探针

- **决策**：Webview 可持呈现态；决策态留 Host；探针至少覆盖 streaming、活动项状态、展开态、follow-state、P-接续后父 Tab E2（如 `parent-readonly`）；optimistic 若存在则须可观测收敛。
- **探针性质**：`parentReadonly` / `continueSealed` 属于 **Host 权威决策态的探针镜像**——Webview **只读展示**，**必须不**在 Webview 本地改写这些值；真实值只在 Host 状态机（Tab `mode` / Continue chrome / send gate）中。呈现态探针（streaming、followState、activity、optimistic）可由 Webview 持有并上报。
- **理由**：日常敢用需要跟滚/折叠/流式中间态在客户端即时反馈；探查与宪法 §7.2 已拍板。
- **替代方案**：维持极薄 Webview（拒绝）— 无法交付跟滚/层 A；决策态也下放（拒绝）— 破坏 Host 权威与多 Tab 闸门。

### AD-CUX-2 — 层 A = 抽离 render/sync + jsdom

- **决策**：主测入口为抽离 TS 模块（`renderBubble` / `patchMessage` / `syncChrome` / `applyFollowState` 等）；jsdom 挂薄壳调用；DOM 契约用 `data-*` / `data-testid`，避免绑死 CSS 类名。
- **理由**：X6 NEEDS_EXTRACT；整页 `runScripts` 不适合作主基建（AC-6）。
- **替代方案**：整页 dangerously runScripts（拒绝作主路径）；仅字符串 toContain（拒绝）。

### AD-CUX-3 — I-真 cancel 薄接线

- **决策**：镜像 dispose/resume 三件套：bridge `session/cancel` + SDK `sdkSessionCancel` → `Agent.cancel({ kind:'user' }, { keepInbox: true })`。扩展 `IdeSessionHost.cancelSession`；Webview Stop 只发 action。不改 agent-loop（O-3）。cancel 请求须有超时；失败/超时走 AC-13d fail-closed（具体毫秒与是否单次重试在 phase-2 spec 钉死）。
- **理由**：X1；核心 cancel 已存在。
- **替代方案**：仅前端停追加（违反 T3）；`dsh.stopSession` 整进程 shutdown（语义错误）。

### AD-CUX-4 — 跟滚 = 纯决策函数 + `data-follow-state`

- **决策**：`decideFollowState(input) → 'on' | 'off'`；DOM 写 `data-follow-state`；接管阈值由实现选定但 AC 只断言「满足接管条件 → off」且条件可探针（R6）。`atBottom` 与 `userTookOver` 由 Host/Webview 按同一「接管条件」推导，二者不得各自发明冲突阈值。
- **理由**：T7；层 A 不断言像素布局。
- **替代方案**：隐式滚动副作用无契约（拒绝）。

### AD-CUX-5 — Fork 编排：P-接续 / P-标明

- **决策**：重试/编辑/分叉皆 `sessions.fork` @ **已关闭 turn** boundary；aborted turn 自身非法。产品：重试/编辑 → P-接续 + E2；显式分叉 → P-标明。Continue 保持 same-id resume，禁止复用 `continueConversation` 原位 resume 父 id 冒充 P-接续。
- **P-接续父 Tab mode（P0）**：**必须** 将父 Tab `mode` **强制转为 `replay`**（与 X3「父 replay、子 live」一致），并封印 Continue + 禁发送 + 可 revert；探针 `parentReadonly=true`。**必须不**在父 Tab 仍为 `live` 时仅靠前端禁用发送冒充 E2。
- **boundary 校验**：无论 `boundary` 用 `turn` 还是 `seq` 表达，`fork-orchestrator` **必须**先经会话日志验证该位置对应一个正常 **`turn/end`（closed）**，且 **非** `aborted`；非法则直接拒绝（AC-61），**禁止**把 open/aborted 位置传给核心 fork。
- **理由**：X3 FEASIBLE；T1/T2；turn 模型；AC-31b。
- **替代方案**：同会话 truncate（O-3）；全部 P-标明（X3 已解锁 P-接续）；父留 live 仅禁发送（拒绝——决策态仍像可发）。

### AD-CUX-6 — 变更基线 = fork 时磁盘；空桶

- **决策**：子会话 ChangeStore 空桶起步；`tool/call` before 读当时磁盘；**禁止**拷贝父 index / 把 seed 历史 diffs 当 live 入账；不 checkout。
- **理由**：X2；AC-64。
- **替代方案**：拷贝父变更到子（破坏隔离）。

### AD-CUX-7 — T6 锁定 B

- **决策**：不投影 reasoning-delta / thinking UI；仅「生成中」+ 文本 chunk。
- **理由**：HG-1 锁定；未来须独立 feature。
- **替代方案**：本 feature 加 thinking 开关（禁止）。

### AD-CUX-8 — Diff T8

- **决策**：默认内联展开预览 + 显式「在编辑器中打开 diff」跳原生；层 A/B 可断言默认路径。
- **数据通道**：**内联 diff 预览复用 code-context-diff 的 `change/get-diff` / `change/diff-content` 协议**；`change-diff-dom.ts` **只负责渲染壳**，**不**重复计算 diff、不新开第二套 diff 引擎。
- **理由**：T8 已拍板；避免与既有 ChangeStore 双轨。
- **替代方案**：仅原生 / 仅内联（拒绝）；扩展侧重算 diff（拒绝）。

### AD-CUX-9 — 搜索档 1+2

- **决策**：档 1 用 `title` + `firstUserPreview`；档 2 新建 path→session 反查（变更 index 派生，不建正文库）；打开走历史/回放/已有 Tab，不 Start。
- **理由**：X7；AC-50–53。
- **替代方案**：扫 JSONL 正文冒充（违反档 3 排除）。

### AD-CUX-10 — 流式协议：patch + 节点身份

- **决策**：新增 Host→Webview `messages/patch`（按 `messageId` 增量文本）；禁止用整表 `messages/replace` 冒充 chunk 增量通过（R1）。结束时与权威完整消息收敛；streaming 探针 fail-closed。
- **payload 契约**：`text` 与 `appendText` **互斥**——同一帧 **必须** 只带其一：`appendText` = 追加到现有气泡文本；`text` = 全量替换该气泡可见文本（用于收敛/纠偏）。二者同时出现视为协议错误，Host **必须不**发送，层 B 可拒。
- **理由**：AC-10/18；现有仅 append 完整消息。
- **替代方案**：等完整 message 才展示（拒绝日常敢用）。

### AD-CUX-11 — 引用解析复用 AD-CCD-11（不新写 @ 文法）

- **决策**：**引用解析复用 code-context-diff 的 `at-path` / `formatFileMention` / 官方 `@` token 提取规则（AD-CCD-11）**，**必须不**新写第二套 `@` 文法。`ref-cards.ts` **只负责**结构化引用卡 DOM 渲染（输入框 / 已发消息 / 回放三处调用同一解析 → 同一渲染入口）。
- **理由**：R5 / AC-41；避免三处渲染不一致。
- **替代方案**：chat-ux 自写 @ 解析（拒绝）。

## 核心实体 / 数据模型

```typescript
/**
 * 探针契约：
 * - streaming / followState / activity / optimistic → 呈现态（Webview 可持有）
 * - parentReadonly / continueSealed → Host 决策态镜像（只读；Webview 不得改）
 */
interface ChatUxProbes {
  streaming: boolean
  followState: 'on' | 'off'
  /** 活动项 id → 状态 / 展开 */
  activity?: Record<string, { status: ActivityStatus; expanded: boolean }>
  /** P-接续后父 Tab E2（AC-3 / AC-31b）— Host 权威镜像 */
  parentReadonly?: boolean
  continueSealed?: boolean
  /** 仅当实现存在 optimistic 时出现（AC-3 条件） */
  optimistic?: { pending: boolean; converged: boolean; rejected?: boolean }
  lastCopiedText?: string
}

type ActivityStatus = 'running' | 'done' | 'failed' | 'aborted'

interface ActivityItem {
  id: string
  sessionId: string
  turn: number
  /** 同 turn 内稳定序（按权威日志 tool/call 出现序，0-based） */
  ordinal: number
  toolName?: string
  callId?: string
  status: ActivityStatus
  expanded: boolean
  summary?: string
}

/** 跟滚纯决策（AD-CUX-4） */
interface FollowDecisionInput {
  followState: 'on' | 'off'
  /** 实现定义的「在底部区域」可探针条件；与 userTookOver 同源「接管条件」 */
  atBottom: boolean
  /** true 当且仅当已满足接管条件（通常 !atBottom）；不得与 atBottom 矛盾 */
  userTookOver: boolean
  explicitResume: boolean
  streaming: boolean
}
type FollowState = 'on' | 'off'
// decideFollowState(input): FollowState

/**
 * P-接续后父 Tab：mode **必须** = 'replay'（不得保留 live 仅靠前端禁发）。
 * Continue chrome sealed；reject-send；可 revert；探针 parentReadonly=true。
 */
type PanelMode = 'empty' | 'waiting-host' | 'replay' | 'live' | 'error'

interface ForkRequest {
  parentSessionId: string
  /**
   * 已关闭 turn 边界。turn = 回合号；seq = 权威日志序列位置。
   * 无论哪种，fork 前 **必须** 验证映射到正常 turn/end（closed），非 aborted（AD-CUX-5）。
   */
  boundary: { kind: 'closed-turn'; turn: number } | { kind: 'seq'; seq: number }
  intent: 'retry' | 'edit-resend' | 'branch'
  /** edit-resend：seed 含该 user；丢弃其后 */
  seedUserMessageId?: string
  editedText?: string
}

interface ForkResult {
  ok: true
  childSessionId: string
  parentSessionId: string
  presentation: 'continue-switch' | 'branch-mark' // P-接续 | P-标明
}

/** 档 2 反查索引（不存正文） */
interface PathSessionIndexEntry {
  path: string           // workspace-relative 规范化
  sessionIds: string[]   // 曾变更该 path 的 session
  mtime: number
}
```

`ChatMessage` 扩展（相对 message-store）：

```typescript
interface ChatMessage {
  // …既有字段
  kind: 'text' | 'subagent' | 'diff-summary' | 'notice' | 'change-list' | 'activity'
  incomplete?: boolean
  /** 流式中助手气泡可先 append 空/部分，再 patch */
  streaming?: boolean
  activity?: ActivityItem
}
```

`ExtensionIndex.SessionIndexEntry`：写齐 `parentSessionId`；可选 `forkLabel`（「派生自 …」）。

## API 域

### Host ↔ Webview 协议增量

| 方向 | type | 用途 |
|------|------|------|
| H→W | `messages/patch` | `{ sessionId, messageId, text? XOR appendText?, incomplete?, streaming? }` — `text`/`appendText` **互斥**（AD-CUX-10） |
| H→W | `probe/state` 或嵌入 `panel/state.probes` | 下发/同步可观测探针镜像（可选；Webview 本地探针为主） |
| H→W | `panel/state` 扩展 | `probes?`、`parentReadonly?`、`continue.sealed?`、`forkParentTitle?` |
| W→H | `action/stop` | 用户中断 → Host cancelSession |
| W→H | `action/retry` | `{ messageId }` → fork P-接续 |
| W→H | `action/edit-resend` | `{ messageId, text }` → fork P-接续 |
| W→H | `action/branch` | `{ turn }` → fork P-标明 |
| W→H | `action/copy-message` | 复制；Host/测试钩写 `lastCopiedText` |
| W→H | `action/toggle-activity` | 展开折叠（呈现态可本地，同步探针） |
| W→H | `action/open-inline-diff` / `action/open-native-diff` | T8 |
| W→H | `action/search-sessions` | 档 1/2 查询（或 Host 命令面板） |

### Bridge / SDK

```
session/cancel { id, sessionId }
  → session/cancel/response { id, ok } | { id, ok:false, error }
  → sdkSessionCancel(sessionId) → Agent.cancel({ kind:'user' }, { keepInbox: true })

session/fork { id, parentSessionId, boundary, … }
  → session/fork/response { id, ok, childSessionId } | error
  → sdkSessionFork → sessions.fork(parent, boundarySeq, childId)
```

（fork 若已有可复用 SDK 缝，优先复用；否则按 dispose/resume 镜像新增。**禁止**改 agent-loop。）

### Host 编排 API（ConversationController）

```typescript
cancelActiveTurn(sessionId: string): Promise<CancelResult>
forkFromClosedTurn(req: ForkRequest): Promise<ForkResult>
/** P-接续：开 child Tab → active；父 Tab mode→replay + E2（禁发送、Continue sealed、可 revert） */
applyContinueSwitch(parentTabId: string, child: ForkResult): void
/** P-标明：开 child 独立身份；父 Tab mode/Continue 保持原样（不强制 replay） */
applyBranchMark(parentTabId: string, child: ForkResult): void
searchSessions(query: SearchQuery): SearchHit[]  // tier 1 | 2
```

### 抽离渲染模块（层 A 入口）

```
apps/vscode-dsh/src/chat-panel/render/
  ├── follow-state.ts      // decideFollowState
  ├── message-dom.ts       // renderBubble / patchMessageDom（节点身份）
  ├── activity-dom.ts      // 活动项折叠/状态属性
  ├── ref-cards.ts         // 卡 DOM 渲染；解析委托 at-path / AD-CCD-11（不新写 @ 文法）
  ├── change-diff-dom.ts   // 内联 diff 预览壳；数据来自 change/get-diff|diff-content
  └── sync-chrome.ts       // streaming 指示 / follow 属性 / probes
```

复用既有：

```
apps/vscode-dsh/src/…/at-path.ts（或 code-context 落地路径）  — 官方 @ 解析
apps/vscode-dsh 既有 change/* 协议                          — get-diff / diff-content
```

Webview provider 内联脚本改为调用上述模块（构建时内联或同步源），测试直接 `import` 模块 + jsdom。

## 实现方案

### 文件产出计划

**新增（示意）：**

```
apps/vscode-dsh/src/chat-panel/render/          — 抽离 DOM 模块
apps/vscode-dsh/src/chat-panel/probes.ts        — 探针读写契约
apps/vscode-dsh/src/fork/fork-orchestrator.ts   — fork + P-接续/P-标明 + E2
apps/vscode-dsh/src/search/path-session-index.ts — 档 2 索引
packages/ide/ide-bridge/…                      — session/cancel（+ fork 若需）
packages/sdk/server/…                          — sdkSessionCancel（+ fork）
apps/vscode-dsh/tests/layer-a/                  — jsdom 层 A 套件
apps/vscode-dsh/tests/chat-ux-*.spec.ts         — 层 B Host
```

**修改：**

```
apps/vscode-dsh/src/chat-panel/protocol.ts       — patch / actions / probes
apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts — 调用抽离模块；跟滚；Stop
apps/vscode-dsh/src/chat-panel/chat-panel-host.ts
apps/vscode-dsh/src/conversation-controller.ts   — chunk 投影、cancel、fork、E2
apps/vscode-dsh/src/session-host.ts              — cancel/fork 下发 bridge
apps/vscode-dsh/src/message-store.ts             — patch API；activity kind
apps/vscode-dsh/src/replay-hydrator.ts           — detectIncomplete 认 aborted；重建活动项
apps/vscode-dsh/src/extension-index.ts           — parentSessionId / 搜索
apps/vscode-dsh/src/change/*                     — 档 2 索引派生；fork 空桶不拷贝
```

### 关键数据流

**流式：**

```
SDK assistant/chunk
  → ConversationController.onChunk
  → MessageStore.ensureAssistantBubble + patch text
  → panelHost.post messages/patch
  → render.patchMessageDom (same data-message-id)
  → probes.streaming=true；follow 决策 → data-follow-state
```

**Cancel：**

```
Webview action/stop
  → cancelActiveTurn
  → bridge session/cancel → Agent.cancel(keepInbox:true)
  → live turn/end aborted
  → streaming=false；incomplete 标记；活动项→aborted（有则）
  → cancel 失败 → fail-closed + 用户提示（AC-13d）
```

**P-接续：**

```
action/retry|edit-resend
  → validate closed-turn boundary（拒 open / aborted；seq 须映射到正常 turn/end）
  → session/fork → childSessionId
  → 新 Tab live + active
  → 父 Tab：mode 强制 → replay；Continue sealed；reject-send；可 revert；parentReadonly=true
  → 子 ChangeStore 空；不 checkout；不拷贝父 index
```

**P-标明（对照）：** 同上 fork，但父 Tab **保持原 mode**，child 独立身份 + 父子标记。
### 关键骨架代码

```typescript
// follow-state.ts
export function decideFollowState(input: FollowDecisionInput): FollowState {
  if (input.explicitResume || (input.atBottom && !input.userTookOver)) return 'on'
  if (input.userTookOver) return 'off'
  return input.followState
}

// message-dom.ts — 节点身份保持
export function patchMessageDom(
  root: ParentNode,
  messageId: string,
  update: { appendText?: string; text?: string; incomplete?: boolean },
): Element | null {
  const el = root.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
  if (!el) return null
  // 更新文本子节点；禁止 replace 整个 messages 容器
  return el
}

// cancel — session-host
async cancelSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  return this.bridge.request({ kind: 'session/cancel', id: newId(), sessionId })
}
```

## Phase DAG 依赖

见 `phase-plan.md`。摘要：

```
phase-1-foundation-render-probe
  ├─→ phase-2-streaming-cancel-follow
  │     ├─→ phase-3-activity-stream → phase-4-refs-changes-diff
  │     └─→ phase-5-fork-retry-branch
  └─→ phase-6-session-search
```

F0 **不得**整段拖到最后；phase-1 无依赖、最先交付层 A 骨架。

## 外部依赖

- 既有 `jsdom@29`（仓库根）— 层 A
- 既有 `Agent.cancel` / `SessionStore.fork` — 不改 agent-loop
- 无新基础设施服务；无档 3 正文库

## 高风险子系统

| 风险 | 缓解 |
|------|------|
| chunk vs tool 双源竞态 | 回合归组契约 `data-turn`；活动流独立于文本 chunk（AC-24） |
| P-接续未封印父 Continue / 父仍 live | 强制 `mode=replay` + continue sealed + 层 B 拒假只读（AC-31b） |
| 第二套 @ 解析导致三处不一致 | AD-CUX-11 强制复用 at-path / AD-CCD-11 |
| 内联 diff 重算 | AD-CUX-8 强制复用 change/get-diff |
| fork 误拷贝父 Change | 编排检查清单；空桶测试（AC-64） |
| DOM 契约绑 CSS | 稳定 `data-*` / role |
| cancel 失败假成功 | AC-13d fail-closed |
| 层 A 抽离不彻底 | phase-1 门禁：主路径 import 模块，禁止 only dangerously |

## 权衡/替代方案

| 议题 | 选中 | 未选 |
|------|------|------|
| 呈现态 | 下放 + 探针 | 极薄拒绝呈现态 |
| 层 A | 抽离 + jsdom | 整页 runScripts / 仅 Electron |
| 中断 | I-真 cancel | 仅前端停 |
| 重试呈现 | P-接续 | 全部 P-标明 |
| 变更基线 | 磁盘空桶 | 拷贝父 index |
| thinking | 锁定 B 不展示 | 本 feature 加 UI |
| 搜索 | 档 1+2 | 档 3 / 扫正文 |

## 验收标准验证方案

| ID | 类型 | 场景 | 预期结果 | 优先级 |
|----|------|------|---------|:------:|
| VP-A1 | 层 A | jsdom 挂载 render，受控 chunk 序列 patch | DOM 增量；同 `data-message-id`；非整表重建 | must |
| VP-A2 | 层 A | follow 决策 + DOM | `data-follow-state` on→off（接管条件）→on（恢复） | must |
| VP-A3 | 层 A | 活动项默认折叠 / 展开 | 探针 expanded；状态属性 | must |
| VP-B1 | 层 B | Stop 生成中 | bridge 收到 cancel；Agent.cancel 调用；streaming false | must |
| VP-B2 | 层 B | 重试 | 新 sessionId ≠ 父；父 mode=replay；E2 探针；非 continueConversation 原位 | must |
| VP-B3 | 层 B | 分叉 | P-标明；parentSessionId；子变更空桶；父 mode 不强制改 | must |
| VP-B4 | 层 B | 搜索档 1/2 | 命中字段/path 索引；打开不 Start | must |
| VP-B5 | 层 B | Continue | sessionId 不变（对照 fork） | must |
| VP-X | 层 C | 可选观感 | 不得单独 PASS | auxiliary |

每 Phase 的 AC→验证表见各 `phases/*/spec.md`。

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| 1 | 2026-09-10 | AD-CUX-5 / P-接续流 | 父 Tab **强制 mode→replay** + E2；禁止 live 仅禁发 | 待 HG-2 | 用户 HG-2 审查 P0-1 |
| 2 | 2026-09-10 | ref-cards | **AD-CUX-11** 复用 at-path / AD-CCD-11；只渲染 | 待 HG-2 | 用户 HG-2 审查 P0-2 |
| 3 | 2026-09-10 | ForkRequest / AD-CUX-5 | boundary 须验证 closed turn/end | 待 HG-2 | P1-1 |
| 4 | 2026-09-10 | VP-X | should→auxiliary | 待 HG-2 | P1-2 |
| 5 | 2026-09-10 | AD-CUX-8 | 内联 diff 复用 change/get-diff | 待 HG-2 | P1-3 |
| 6 | 2026-09-10 | AD-CUX-1 / probes | 决策态镜像只读说明 | 待 HG-2 | P1-4 |
| 7 | 2026-09-10 | AD-CUX-10 | text XOR appendText；ActivityItem.ordinal | 待 HG-2 | 非阻塞观察 |

## 建议的下一步

进入 HG-2 方案确认。用户确认后按 DAG 启动 `phase-1-foundation-render-probe`（code-explorer → impl 分支 → implementer）。
