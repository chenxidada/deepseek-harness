# Design: vscode-dsh-conversation-ui

<!--
  slug: vscode-dsh-conversation-ui
  audience: implementer / reviewer / verifier / HG-2
  language: zh (canonical). Mirror: design-zh.md
  requirements: .specdev/specs/vscode-dsh-conversation-ui/requirements.md (HG-1 confirmed)
  constitution: .specdev/specs/vscode-dsh-conversation-ui/constitution.md
  prior: .specdev/specs/vscode-dsh-ide (window shell merged)
  created: 2026-09-07
  revised: 2026-09-08 (R11: 极薄 Webview; 空 Tab 不入 openTabSet+恢复剔除; tabId 生命周期; Diff before 权威快照; 索引立即持久化; L2 测试钩子; 状态转换 ASCII)
  note: Spike T-0a/T-0b NOT RUN. `@vscode/test-electron` is preferred L2 runner, not yet proven in this feature.
-->

## 范围覆盖

本设计覆盖整个 feature `vscode-dsh-conversation-ui`：在已交付的 VS Code 窗口壳（多 Tab、SDK+Host bridge 双通道、Timeline、fail-closed InteractionUi、AD-8）之上，交付对话面板主阅读/输入面、Timeline 弱化、关 Tab 可恢复、显式删除、历史列表与回放、重启恢复未关 Tab、多 Tab 未读/审批串行、（Should）继续此会话、Subagent 进入与钉 Tab。

对应 `requirements.md` AC-1…AC-84（含 T-0a/T-0b Gate）。**不**覆盖 Spec/hooks、GAP-010/011、审批表单重做、跨工作区历史、S-20、改 agent-loop、重做双通道/AD-8。

Phase 拆分见 `phase-plan.md`。各 Phase 细规与逐条验证策略见 `phases/<phase-id>/spec.md`。

## 架构摘要

扩展继续只做**投影 + Host UI + 扩展索引**：权威正文仍在 DSH **权威会话日志**。新增 **Conversation Webview**（或等价持久面板）作为 user/assistant 主阅读面与 live 输入面；Timeline TreeView **弱化**为 turn/step/tool/status/subagent/Diff 调试面（无 assistant 长文）。关 Tab **改为卸 UI**（默认不再 `session/dispose`）；显式「删除会话」才 dispose + 清权威并关已打开视图。工作区 **扩展索引**维护历史列表、未关 Tab 集、活动 Tab、续写能力元数据与派生关联；历史打开一律 **回放视图**（输入禁用 + 强「回放中」标识），从权威日志**一次性全量**重建面板消息流与 Timeline（组件名 **ReplayHydrator**）。用户显式「继续」成功后，同一 `tabId` **原位**将 `OpenTabRecord.mode` 从 `replay` 升为 `live`（禁止同会话并存 replay+live）。多 Tab 未读点与审批角标走既有 bridge；交互 UI **串行队列**（活动 Tab **软优先**插队、不打断已弹；切 Tab 未作答回 pending）+ 会话↔交互绑定防错配。Subagent 默认面板上下文进入（运行中只读实时投影 → 结束自动回放），Should 可钉 Tab。

**Spike 尚未执行（NOT RUN）：** 含回放重建的 Phase 依赖 **T-0a**；含「继续此会话」的 Phase 依赖 **T-0b**。纯 live 面板 Phase **不受** T-0a/T-0b 阻塞。Gate 失败走下文降级路径，禁止假装能力已验证。

**前端极薄（AD-CU-1）：** Webview **不**持决策性状态；`mode` / `sessionId` 只跟 Host 下发的 `panel/state`；发送以 Host `ui/reject-send` 兜底；Webview 仅最小渲染。L3=模拟客户端覆盖 Host 可测逻辑；真实渲染属 L4 辅助，**不当**产品 Phase 达标门槛。

**质量约束（AC-54 / AC-84）：** 产品 Phase 达标须有可脚本的 **L2**（适用时 **L3=模拟 Webview**）自动证据；每个 VP 须有可脱离 Webview 的 Host 命令/测试钩子；禁止仅人工点选 / 仅真实渲染（L4）作为达标门槛。细节见「验收标准验证方案」。

## 相对前序策略变更

| 主题 | vscode-dsh-ide / README 现状 | 本设计 |
|------|------------------------------|--------|
| 关 Tab | `closeConversation` → bridge `session/dispose` | **卸 UI**；**不**默认 dispose；更新未关 Tab 集 / 索引 |
| 结束会话 | 关 Tab 即结束 | **仅显式删除** → dispose + 清权威 + 关视图 |
| Timeline | 可含 assistant 截断行 | **禁止** assistant 长文；短 label；Diff 保留 |
| 历史 / 重启 | 无 | 扩展索引 + 权威回放；重启恢复未关 Tab（先只读 replay） |

## 核心实体 / 数据模型

```typescript
type PanelMode = 'live' | 'replay' | 'readonly-live' | 'waiting-host' | 'empty'

interface ConversationTab {
  /** Tab 栏可见存在期身份；关闭即销毁；再打开/历史恢复 → 新 tabId（同 session 单开由 sessionId 索引） */
  tabId: string
  sessionId: string
  title?: string
  status: 'idle' | 'running' | 'error' | 'disconnected'
  mode: PanelMode
  unread?: boolean
  approvalBadge?: boolean
  /** 面板上下文进入的子会话；钉 Tab 后应清空并改由子 Tab 承载 */
  contextSessionId?: string
}

interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'notice'
  /** MVP：text 为主；subagent / diff-summary / notice 可占位扩展 */
  kind: 'text' | 'subagent' | 'diff-summary' | 'notice'
  text: string
  turn?: number
  incomplete?: boolean
}

interface ExtensionIndex {
  workspaceKey: string
  sessions: SessionIndexEntry[]
  /**
   * 未关 Tab 集。空 Tab（无消息、从未成功发送）**禁止**写入持久化 openTabSet。
   * openTabSet / mode / activeSessionId 等**每次变更立即**写 workspaceState（禁止仅 deactivate 快照）。
   */
  openTabSet: OpenTabRecord[]
  activeSessionId?: string
  ui: { restoreUiLimit: number } // 默认 N=8，须文档化
  continueLinks?: { fromId: string; toId: string }[]
}

interface SessionIndexEntry {
  sessionId: string
  title: string
  mtime: number
  /** 来自 T-0b 探测；禁止「只读/可继续」二元标 */
  continueCapability?: 'same-id' | 'derive-only' | 'unknown'
  firstUserPreview?: string
  parentSessionId?: string
  deleted?: boolean
}

interface OpenTabRecord {
  /** 与 ConversationTab.tabId 同生命周期：关闭销毁；历史再开 → 新 tabId */
  tabId: string
  sessionId: string
  mode: 'live' | 'replay'
  title?: string
  pinnedSubagent?: boolean
  /** 可选：上次关闭前曾为 live；恢复时仍以 mode=replay 呈现，直到 Continue */
  liveIntent?: boolean
}
```

`MessageStore`（新，纯 TS）按 `sessionId` 保存消息数组。用户气泡优先权威 `user/message`；缺省可用本地已发送 prompt 投影补齐用户侧（假设 A-1），**禁止**伪造助手正文（AC-6）。等待交互用 `status/set` / `ui/banner`，**不必**塞进每条 `ChatMessage`。

### 状态转换图（核心实体）

**Tab mode（OpenTabRecord.mode / panel/state.mode）**

```
  [历史打开 / 重启恢复]
           │
           ▼
       ┌───────┐   Continue 成功（同打开期内同一 tabId）   ┌──────┐
       │ replay│ ───────────────────────────────────────→ │ live │
       └───────┘ ←─────────────────────────────────────── └──────┘
           ▲         （仅恢复路径强制写回；非 Continue 回退）
           │
    恢复一律 → replay（可记 liveIntent，呈现仍为 replay）
```

**会话运行（ConversationTab.status）**

```
  idle ←→ running
    │         │
    └→ error ←┘   （断开 → disconnected；恢复/重连策略见失败模式）
```

**审批 / 交互队列项（AD-CU-7）**

```
  pending → presented → resolved
                     └→ abort
  切 Tab（未作答）：presented → pending（角标保留；已作答不撤回）
```

**重启 / Host 恢复路径**

```
  waiting-host → replay → live（仅用户 Continue 成功后）
                 │
                 └─ 恢复时若 openTabSet 含空 Tab → 自动剔除（不展示、不聚焦）
```

## API 域

### Host ↔ Webview 消息协议（AD-CU-1）

| 方向 | 消息 | 用途 / 语义 |
|------|------|-------------|
| H→W | `panel/state` | 空态 / 等待 Host / 回放中 / live / 错误；当前 `sessionId`、`mode`、标题 |
| H→W | `messages/replace` | **全量替换**消息列表（切 Tab、回放 hydrate、派生换绑后重建） |
| H→W | `messages/append` | **追加一条完整消息**（非整条消息的 token/分片）；live 新 user/assistant 回合落定后下发 |
| H→W | `status/set` | running / waiting-interaction / idle / disconnected |
| H→W | `ui/banner` | 「回放中」「等待 Host」「新会话 · 接续自 …」等强标识 |
| H→W | `ui/reject-send` | Host 拒绝发送；原因枚举如 `replay` / `empty` / `no-host` / `disconnected` / …（**发送判定权在 Host**） |
| W→H | `composer/send` | 请求发送；Host 校验 mode===live、非空、Host 就绪等后走既有 `session/prompt`，否则回 `ui/reject-send` |
| W→H | `nav/open-subagent` \| `nav/back` | Subagent 进入/返回（Phase 4） |
| W→H | `action/continue` \| `action/delete` | 顶栏动作请求（Host 做 Gate/确认） |
| H↔W | `scroll/reveal` | Timeline 点击定位（Should） |

**Assistant 输出 MVP：** 回合级完整 `messages/append`；运行中须有强「正在生成…」指示；流式 `messages/patch` = Could。消息加载：**一次性全量** hydrate；本版不做超大流分页。

### 投影模式（AD-CU-2）

| 模式 | 消息流来源 | Timeline 来源 | 输入 |
|------|------------|---------------|------|
| **live** | SDK `session.event` / status → `MessageStore`；完整消息 `append` | 既有 `TimelineStore.apply`（弱化后无 assistant 长文） | 允许 |
| **回放** | 权威日志 **一次性全量**折叠 → `messages/replace` | 同日志折叠 turn/tool/status/subagent；Diff 仅当含 `meta.diffs` | **禁用** |
| **只读实时投影**（运行中子会话） | 同 live 投影，composer 禁用 | 同 live | **禁用**（未点继续） |

回放读日志 API **不**绑死 RPC 名。选型意向（由 T-0a 实证）：

1. **优先：** ide-bridge 薄方法（例：`session/read-log` / `session/stat`）→ `sessionPersistence.open(id,'read')`
2. **次选：** SDK stdout 只读方法（默认不首选）
3. **降级：** 仅进程内挂起 session 可投影、磁盘不可读 → T-0a **FAIL**

### 既有 Host 缝（复用，不另立循环）

- `ConversationController.promptActive` / `IdeSessionHost.prompt` → `session/prompt`
- 删除路径 → bridge `session/dispose`
- 审批 / 提问 → 既有 InteractionUi + bridge（不重做 Webview 表单）

## 实现方案

### 架构决策（锁定）

#### AD-CU-1：Conversation Webview + Host 消息协议（极薄前端）

见上文「API 域」。理由：Webview 适合富文本消息流；状态权威留在 Host；发送门禁集中在 Host。替代：纯 TreeView/Markdown 作聊天面 — 体验不足，拒绝作 Must。废弃 W→H `composer/cancel-noop`。

**极薄约束（锁定）：**

| 规则 | 语义 |
|------|------|
| 无决策性状态 | Webview **不**持 mode / session 权威；不本地裁定可否发送 |
| 跟 `panel/state` | 当前 `mode` / `sessionId` / 标题等**只**跟 Host `panel/state` |
| 发送兜底 | 即便 UI 误显可写，Host 仍以 `ui/reject-send` 拒绝非法发送 |
| 最小渲染 | Webview 仅渲染 Host 下发的消息与状态；不另建第二套消息库 |
| 验证分层 | L3=模拟客户端覆盖 Host 可测协议逻辑；真实 HTML/CSP/像素渲染 = L4 辅助，**不当**产品 Phase 达标门槛 |

#### AD-CU-3：关 Tab 可恢复 vs 删除

| 动作 | UI | 进程内 agent | 权威会话日志 | 扩展索引 |
|------|-----|--------------|--------------|----------|
| **关闭 Tab**（有内容） | 卸 Tab | **默认不 dispose** | **保留** | 从未关集移除；历史可打开集合保留；`tabId` **销毁**（再开新 id） |
| **空 Tab 关闭** | 卸 Tab；**无确认** | **不 dispose** | 无正文 | **只清**内存 Tab；**不写/不留**持久化 `openTabSet`；**不进**历史 |
| **删除会话** | 关该 session 一切 live/回放 Tab | `session/dispose` | **清除** | 从未关集与历史可打开集移除 |

空 Tab = 无消息 / 用户从未成功发送。**空 Tab 与「关闭空 Tab」并列规则：**（1）关闭时空 Tab **不**写入持久化 `openTabSet`；（2）重启恢复时若索引误含空 Tab → **自动剔除**，不展示、不聚焦。非 running 删除亦须简单确认。running 关 Tab：「停止并关闭」（不可逆）/「取消」。running 删除：「停止并删除」/「取消」；确认前禁止 dispose（AC-72）。Host 未就绪删除：禁用或标明；禁止只清索引留权威（AC-73）。父删子：不级联删子权威（AC-61）。墓碑 GC（Should）：有引用保留；无引用超窗口（建议 30 天）可清。

#### AD-CU-4：扩展索引 vs 权威会话日志

扩展本地以当前工作区 `workspaceState` 为准（不读其他 workspace；`globalState` 禁止跨工作区泄漏会话列表）。**禁止**把扩展索引当聊天正文库（AC-45/46）。历史列表可独立于 Host 展示索引（AC-63）；打开/重建正文仍需 Host + 权威日志（AC-69 等待态）。

**立即持久化（锁定）：** `openTabSet` / `mode` / `activeSessionId`（及同索引上同等关键字段）在**每次变更时立即**写入 `workspaceState`；**禁止**仅依赖 `deactivate` 一次性快照。空 Tab 永不进入持久化 `openTabSet`（见 AD-CU-3）。

#### AD-CU-5：回放 vs live；同会话单 live；Tab 原位升级；tabId 生命周期

- 同 `sessionId` 最多一个打开视图；禁止并存 `replay`+`live`（AC-59/64/65）。**单开由 `sessionId` 索引保证**，**不**依赖 `tabId` 复用。
- **`tabId` 生命周期：** = Tab 栏可见存在期；关闭即销毁身份；再打开 / 历史恢复 → **新 `tabId`**。Continue 原位升级仍是**同一打开期内**的同一 `tabId`。
- 历史打开一律先回放；已有打开 Tab → 激活（沿用既有 `tabId`）。
- Continue 成功后同一 `tabId` 上 `replay → live`；派生续写建议同 `tabId` 换绑新 `sessionId` + banner「新会话 · 接续自 …」。
- 重启恢复：一律先 `mode=replay`（可记 `liveIntent`，但恢复写回 replay），直到再次 Continue；恢复时剔除空 Tab（AD-CU-3）。

#### AD-CU-6：Timeline 弱化与回放 Diff

- 停止推送 assistant 长文为主行（AC-14）；保留短 label 与 Diff 入口（AC-15）。
- 回放 Diff（AC-76）：仅日志含可恢复 `meta.diffs` 时启用；禁止工作区冒充。
- **`meta.diffs` 快照语义（锁定）：** 若条目**仅含补丁**（无完整 before/after）：`before` 须来自权威日志该 turn **前序快照**或当时内容；无法重建 `before` → Diff **按不可用**（入口禁用并说明）；**禁止**用当前磁盘文件作 `before`/`after`。
- 不完整回合（AC-77）：标「已停止/未完成」。
- Should 定位优先序（AC-56）：工具触发的 user → 该 turn assistant → 「无可定位」。

#### AD-CU-7：审批串行 + 活动 Tab 唤醒（软优先）

**现状确认（phase-2 开工前强制）：** 先读既有 `InteractionCoordinator` 实现，确认当前是阻塞式单弹层还是已有队列；再决定对 AD-CU-7 做重构或增量扩展（活动软优先 / 出队 / 切 Tab 唤醒）。队列逻辑**并入** `interaction-coordinator.ts`，**不**新建 `interaction-queue.ts`。

行为锁定：

| 规则 | 语义 |
|------|------|
| 全局串行 | 同时至多一个弹层；会话↔交互绑定防错配；不 Webview 重做表单 |
| **软优先** | 活动 Tab 的 pending 可**插队到队首**；**不打断**已弹出项；同 Tab 内 FIFO |
| 队头出队 | fail-closed / 超时 / Abort → 立即出队并呈现下一项 |
| 切 Tab（未作答） | 关闭当前弹层；该交互回 **pending**（角标保留）；若目标 Tab 有 pending → 再弹；**已作答不撤回** |
| 切 Tab（有 pending） | 切到含 pending 的 Tab 主动唤起队头（受软优先约束） |
| 面板 | 展示「等待交互」状态 |

#### AD-CU-8：继续此会话与 continueCapability 映射

优先同 `sessionId` 续写；禁止改写旧前缀（AC-66）；只能派生则新 id + 「新会话 · 接续自 …」（AC-67）。列表暗示与顶栏 Continue **解耦**，完整映射：

| capability | 历史列表 | 顶栏 Continue |
|------------|----------|---------------|
| `same-id` | 「可继续」 | **可用** → 原位续写（同 `tabId` `replay→live`） |
| `derive-only` | 「可继续（将开新会话）」 | **可用** → 派生 + 「新会话 · 接续自 …」标识 |
| `unknown` / 未探测 | **不显示**暗示 | **禁用** + tooltip「暂不可用」 |
| T-0b **FAIL** | **不显示** | **隐藏** |

#### AD-CU-9：关 Tab 后进程内句柄

关闭 Tab **不**调用 `session/dispose`。deactivate 仍 `shutdown` 整进程。可选空闲回收进程内 agent 但须不抹盘；未实证前关闭路径禁止调用会抹盘的 dispose。

#### AD-CU-10：重启恢复上限

索引永久保留全部未关 Tab（AC-70）——**空 Tab 除外**（从不入持久化 `openTabSet`；恢复时若误含则剔除）。UI 默认 hydrate 最近 **N=8**：上次活动 Tab 恒优先，再补 N−1；活动须强制 hydrate 并聚焦（AC-34）。恢复一律先回放。`openTabSet` 等字段按 AD-CU-4 **立即**持久化。

#### AD-CU-11：Subagent 上下文 vs 钉 Tab

默认父面板上下文进入（不占 Tab）；运行中只读实时 → 结束自动回放；父「子代理运行中」在子结束且父为当前上下文时清除。Should 钉 Tab：提升为独立 Tab；已钉后从父进入激活已有子 Tab（AC-78/79）。父子已删导航（AC-74/75）。

#### AD-CU-12：边界不变式

不修改 `packages/core/agent-loop`；不重做双通道 / `ide` profile / AD-8；新行为优先 `apps/vscode-dsh`；bridge 薄适配限 `packages/ide/ide-bridge`。

### Spike Gate（T-0a / T-0b）— NOT RUN

#### T-0a — 权威日志能否支撑回放重建

**阻塞：** `phase-2-multitab-history-replay` 回放重建切片，以及依赖该重建的 Diff/不完整回合（AC-76/77）。**不阻塞：** `phase-1` 纯 live。

必答：dispose 后磁盘日志是否可读；事件集是否足以折叠消息条数/顺序/角色与 Timeline turn/tool；`meta.diffs` / 不完整回合可否探测；推荐读日志缝与 **ReplayHydrator**。

**PASS：** 书面报告 + 可重复脚本；报告须含「对相关 AD-CU 的更新建议」（至少 AD-CU-2 / ReplayHydrator 读缝）。确认后写入本文件「设计修订记录」。**FAIL：** 历史列表仍可展示；打开显示「无法从权威日志重建回放」；不得冒充；Phase 2 回放切片停工。

#### T-0b — 同 id 续写 vs 派生

**阻塞：** Continue 产品切片（AC-32/66/67/68）→ **仅** `phase-3`（**不**阻塞 phase-2）。**不阻塞：** 只读回放、重启恢复、phase-2 历史/审批。

**PASS：** 选定 same-id 或 derive-only；报告须含「对相关 AD-CU 的更新建议」（至少 AD-CU-8 映射与探测缝）。确认后写入本文件「设计修订记录」。**FAIL：** 顶栏 Continue **隐藏**；列表不显示暗示；phase-3 仍可交付重启与 AC-76/77。

### 组件图

```
┌──────────────────────────── apps/vscode-dsh ────────────────────────────┐
│ ConversationTabBar │ TimelineView(弱化) │ HistoryList │ ChatWebview     │
│ ConversationRegistry + OpenTabSet │ ExtensionIndexStore                 │
│ MessageStore │ TimelineStore │ ReplayHydrator(T-0a) │ Continue(T-0b)   │
│ ConversationController │ InteractionCoordinator(串行+软优先)            │
│ IdeSessionHost (SDK stdio + BridgeHostServer)                           │
└───────────────┬───────────────────────────────┬─────────────────────────┘
                │ SDK JSON-RPC                  │ bridge NDJSON
                ▼                               ▼
     dsh --profile ide                 ide-bridge (+ 可选 session/read-log)
     sessionPersistence = 权威日志      session/dispose = 仅删除路径
```

### 文件产出计划

**新增：**

```
apps/vscode-dsh/src/
  chat-panel/          # webview provider + protocol types
  message-store.ts
  extension-index.ts   # workspaceState 索引（当前 workspace）
  replay-hydrator.ts   # 权威日志 → MessageStore/TimelineStore（T-0a 后）
  history-view.ts
  # 审批队列：并入 interaction-coordinator.ts（禁止新建 interaction-queue.ts）
```

**修改：**

```
conversation-controller.ts  # close≠dispose；delete 确认；mode 原位升级；open replay
conversation-registry.ts    # mode / unread / badge / open-tab set；禁 replay+live 双开
timeline-store.ts           # 弱化 assistant；回放 hydration；定位优先序
session-host.ts             # 可选 read-log / continue 探测调用
interaction-coordinator.ts  # 串行队列 + 软优先 + 队头出队 + 切 Tab 回 pending/唤醒（AD-CU-7）
extension.ts / README.md    # 命令、关 Tab 策略、面板 vs Timeline、恢复 N、无分页 MVP
packages/ide/ide-bridge/    # 仅当 Spike 证明需要薄读日志/续写探测 RPC
```

**phase-1 必须落地的首批产出：**（1）**极薄 Webview**（无决策性状态；跟 `panel/state`；Host `ui/reject-send` 兜底）；（2）**L2 可调用面 / 测试钩子**（例：`dsh.test.sendPrompt` 及只读钩子），使 L2 **可脱离 Webview** 驱动 Host；（3）L2 Extension Host harness（优先 `@vscode/test-electron`）+ 最小冒烟（激活扩展 / 打开面板或等价命令）——与 Webview/关删实现同 Phase 验收，不得只留 TODO。

**禁止：** `packages/core/**/agent-loop*`；扩展内第二套正文权威库；AD-8 冲突文档；新建 `interaction-queue.ts`。

### 关键骨架代码

```typescript
// MessageStore — 按 sessionId 持有完整消息；切 Tab / 回放用 replace
class MessageStore {
  replace(sessionId: string, messages: ChatMessage[]): void
  append(sessionId: string, message: ChatMessage): void
  get(sessionId: string): readonly ChatMessage[]
}

// Host 发送门禁 — 判定权在 Host，拒绝经 ui/reject-send
async function handleComposerSend(
  tab: OpenTabRecord,
  text: string,
): Promise<'accepted' | { reject: RejectReason }> {
  if (tab.mode !== 'live') return { reject: 'replay' }
  if (!text.trim()) return { reject: 'empty' }
  if (!hostReady) return { reject: 'no-host' }
  await sessionHost.prompt(tab.sessionId, text)
  return 'accepted'
}

// ReplayHydrator — T-0a 选定读缝后实现；一次性全量折叠
async function hydrateFromAuthoritativeLog(
  sessionId: string,
): Promise<{ messages: ChatMessage[]; timelineItems: TimelineItem[] }>

// Continue 原位升级 — 成功后同 tabId
function upgradeReplayToLive(tabId: string): void {
  const rec = openTabSet.get(tabId)
  if (!rec || rec.mode !== 'replay') throw new Error('invalid continue')
  rec.mode = 'live'
  // 派生路径：换绑 sessionId + banner，仍单 Tab
}
```

### 失败模式（增量）

| 故障 | 行为 |
|------|------|
| Host 未连 + 打开历史/恢复 | 「等待 Host」；索引仍可见；就绪后自动重建 |
| T-0a 不可重建 | 明确错误；不空白假装；不冒充 Diff |
| 回放误发送 | Host `ui/reject-send`（`replay`）；composer 禁用 |
| 删除但 Host 离线 | 入口禁用；不假删索引 |
| SDK/子进程死 | 终止发送中/等待中；fail-closed 未决交互（AC-53）；队头出队 |
| UI 恢复截断 | 索引仍全；活动 Tab 强制 hydrate；提供查看更多 |
| 空 Tab 关闭 | 无确认；不进历史；不写持久化 `openTabSet`；不 dispose |
| 恢复含空 Tab | 自动剔除；不展示、不聚焦 |

## Phase DAG 依赖

见 `phase-plan.md`。摘要（**0b 只进 phase-3，不阻塞 phase-2**）：

```
phase-0a ──┐
           ├→ phase-2 ──┬→ phase-3 ──→ phase-4
phase-1 ───┘            │       ▲
                        │       │
phase-0b ───────────────┴───────┘   ← 0b → phase-3 only
```

- `phase-0a` / `phase-0b` / `phase-1`：无互相依赖，可并行。
- `phase-2` 依赖 **仅** 0a PASS + phase-1（**不**依赖 0b）。
- `phase-3` 依赖 phase-2 + 0b（0b FAIL 则 Continue 按 AD-CU-8 **隐藏**，仍交付重启与 Diff/不完整）。
- `phase-4` 依赖 phase-2 + phase-3。

## 外部依赖

| 依赖 | 用途 |
|------|------|
| 既有 `apps/vscode-dsh` + `ide` profile / ide-bridge | 窗口壳、双通道、InteractionUi |
| 既有 `InteractionCoordinator` | phase-2 前读代码确认单弹层 vs 队列，再扩展 AD-CU-7（并入同文件） |
| VS Code Webview / WebviewView API | 对话面板 |
| `@vscode/test-electron`（或仓库等价 Extension Host runner） | **意向** L2 宿主；phase-1 须落地 harness + 最小冒烟；未跑通则不得宣称 L2 已验证 |
| 可选：ide-bridge 只读/续写探测 RPC | 仅当 T-0a/T-0b 选定 |

无新基础设施服务。不新增第二正文库。

## 高风险子系统

| 风险 | 缓解 |
|------|------|
| Webview 与 Tab 串台 | `panel/state` 始终带 sessionId；切 Tab 全量 replace |
| 关 Tab 仍走旧 dispose | Phase 1 改 controller + README + L2 回归 |
| Spike 未过却开 Continue/回放 | DAG 依赖 + Gate 报告门禁 |
| 审批错配 / 队列卡死 | 串行 + 软优先（不打断已弹）+ 切 Tab 回 pending + 队头 fail 立即出队 + session 绑定 |
| 恢复上限漏掉活动 Tab | AC-34：活动恒优先 + 强制 hydrate |
| 回放 Diff 冒充 | 仅日志 `meta.diffs`；补丁缺 before → 不可用；禁当前磁盘 before/after |
| 同会话 replay+live 双开 | AD-CU-5 单 OpenTabRecord + 原位升级；单开按 sessionId |
| tabId 误复用 | 关闭销毁；再开新 id；Continue 仅同打开期内 |
| 索引仅 deactivate 落盘 | AD-CU-4：每次变更立即写 workspaceState |
| 仅 L1 / 仅人工点选冒充达标 | AC-54/84：产品 Phase 须 L2/(适用 L3) 脚本证据 + 每 VP Host 测试钩子 |

## 权衡/替代方案

| 议题 | 选定 | 拒绝 |
|------|------|------|
| 聊天面 | **极薄** Webview（跟 panel/state；Host 拒发兜底） | 厚前端自持 mode/session；仅 Timeline/Toast |
| 关 Tab | 不 dispose；空 Tab 不入持久化 openTabSet | 默认 dispose（前序）；空 Tab 误持久化 |
| 助手输出 MVP | 回合级完整 append + 强「正在生成」 | MVP 流式分片 patch |
| 发送拒绝 | H→W `ui/reject-send` | W→H `composer/cancel-noop`；Webview 本地裁定 |
| Continue Tab | 同打开期内同 tabId 原位 mode 升级 | 另开 live Tab / 双开；跨关闭复用 tabId |
| 重启 mode | 强制写回 replay；剔除空 Tab | 直接恢复可写 live |
| 索引持久化 | 每次变更立即写 workspaceState | 仅 deactivate 快照 |
| Diff before | 权威日志前序快照；不可重建则不可用 | 当前磁盘文件冒充 before/after |
| 交互 | 串行 + **软优先**（插队不打断已弹）+ 切 Tab 回 pending | 并行多 QuickPick；硬打断已弹层 |
| 继续 | 同 id 优先，否则派生标明；unknown=禁用+tooltip；FAIL=隐藏 | 默认可写旧前缀；unknown/FAIL 与列表混同 |
| 读日志 API | Spike 后定；偏 bridge | 需求绑死 RPC 名 |
| Subagent | 先上下文，后钉 Tab | 默认占 Tab |
| 消息加载 | 一次性全量 | MVP 超大流分页 |
| L2 可测性 | 每 VP Host 命令/测试钩子（可脱离 Webview） | 仅人手点侧栏可测 |

## 验收标准验证方案

> **设计约束（AC-54 / AC-84 / Constitution §1）：** 产品 Phase 达标证据须可脚本自动复现；**禁止**仅人工点选（L4）作为唯一或主要证据。逐 Phase 可执行步骤见各 `phases/<id>/spec.md`「验证策略」表。

### 验证分层（本系统验证架构）

| 层 | 宿主 / 手段 | 覆盖什么 | 充分性 |
|----|-------------|----------|--------|
| **L1** | Node / vitest / fake SDK·bridge | 库与控制器契约（MessageStore、Registry、关 Tab≠dispose、协议类型等） | **必要但不充分** |
| **L2** | 扩展测试宿主（**优先** `@vscode/test-electron`，或仓库选定等价 Extension Host runner） | 激活扩展、命令 API、会话 / Tab / 索引行为 | 产品 Phase **达标必须** |
| **L3** | **模拟 Webview 客户端**（Extension Host 内 fake Webview：`postMessage` / `onDidReceiveMessage`）对接**真实 Host**消息处理 | 协议与边界（`composer/send`、`ui/reject-send`、`messages/*`、`panel/state` 等） | 对话面板相关 Phase **Must**，与 L2 一并作为达标证据；**不**验证 HTML/CSP/渲染细节 |
| **L4** | 真人点击 / 真实渲染（banner/滚动/禁用态视觉等） | 仅人工探索或辅助观感 | **不得**作为产品 Phase 达标门槛；真实渲染属 L4 辅助，**不**计入达标证据 |

**L3 写死：** 用模拟 Webview 客户端驱动真实 Host 处理器，断言协议与边界；禁止把 HTML/CSP/像素级渲染当作 L3 或产品 Phase 达标条件。真实渲染属 L4 辅助。

**Runner 选型：** 优先 `@vscode/test-electron`（或仓库已有等价）。若环境无法跑 L2 → **不得**宣称该行为已在 Extension Host 验证通过（产品 Phase 至多记为证据不足 / 未完成自动验证）。

**可调用面 / 测试钩子（锁定）：** 每个 VP 须有命令或只读/测试钩子（例：`dsh.test.sendPrompt`、打开/关 Tab、删除、Continue、恢复编排入口），使 **L2 可脱离 Webview** 驱动 Host；钩子**仅测试暴露**，不改变产品语义。L3 仍用 fake Webview 测协议。功能不得仅存在于「人手点侧栏」。

### PASS 证据门槛（质量属性）

| Phase 类型 | 达标最低证据 | 禁止作为达标唯一证据 |
|------------|--------------|----------------------|
| **产品 Phase 1–4** | **L2** + 本 Phase 适用的 **L3（模拟 Webview）**，可脚本（命令、退出码、关键日志） | 仅 L1；仅人工点选 / 仅真实渲染观感（L4） |
| **Spike 0a / 0b** | L1 / 探测脚本 + Gate 书面报告（含「对相关 AD-CU 的更新建议」） | 无书面报告、无可重复证据、或无 AD-CU 更新建议却宣称 PASS |

### 跨 Phase 验证路径（VP）

| ID | Phase | 宿主层 | 场景 / 预期 | 优先级 |
|----|-------|--------|-------------|:------:|
| VP-1-send | `phase-1-panel-live-recoverable-close` | L2 + L3 | **L2 钩子**（例 `dsh.test.sendPrompt`）或 fake Webview `composer/send` → Host 接受 → `messages/append`；`panel/state` 与 status 一致；Webview 无决策性状态 | must |
| VP-1-close | 同上 | L2 | 关有内容 Tab：**不**调用会抹盘的 `session/dispose`；权威仍在；UI 卸 Tab；`tabId` 销毁；索引立即持久化 | must |
| VP-1-delete | 同上 | L2 | 显式删除 → dispose + 权威不可再正文回放；确认路径可测（Host 钩子） | must |
| VP-1-empty | 同上 | L2 | 空 Tab 关闭：无确认、不进历史、不 dispose、**不写**持久化 `openTabSet` | must |
| VP-1-reopen | 同上 | L2 | 关 Tab 后权威仍在（为 phase-2 铺路）；若本 Phase 已有重开命令则一并测（重开 → **新 tabId**） | must |
| VP-1-reject | 同上 | L3 | 非法发送 → `ui/reject-send`，无假成功（Host 兜底） | must |
| VP-2-history | `phase-2-multitab-history-replay` | L2 + L3 | 关 Tab → 历史回放：`ReplayHydrator` 全量 `messages/replace`；mode=replay；composer 禁用；再开 **新 tabId**；同 session 单开按 sessionId | must |
| VP-2-wake | 同上 | L2 | 未读/审批角标；切到含 pending 的 Tab → 串行队列唤醒（presented→pending 未作答）；队头 fail 可出队 | must |
| VP-2-replay-reject | 同上 | L3 | 回放态 `composer/send` → `ui/reject-send`（`replay`） | must |
| VP-3-restore | `phase-3-restart-continue` | L2（+ L3 hydrate） | 重启后恢复未关 Tab（活动恒优先；写回 `mode=replay`）；**空 Tab 自动剔除**；索引立即持久化可测 | must |
| VP-3-continue | 同上 | L2 + L3 | **仅当 T-0b PASS**：Continue → 同打开期同 `tabId` `replay→live`；否则跳过并注明降级 | must（条件） |
| VP-3-diff | 同上 | L2 / L1 | 仅补丁且无法重建 before → Diff 不可用；断言未用当前磁盘作 before/after | must |
| VP-4-sub | `phase-4-subagent-enter-pin` | L2 + L3 | 进入子会话；`nav/open-subagent` / `panel/state` 与上下文一致 | must |
| VP-0a | `phase-0a-spike-replay-rebuild` | L1 / 探测脚本 | Gate：日志可读、条数/顺序/角色、Diff/不完整可探测 | must（Spike） |
| VP-0b | `phase-0b-spike-continue-capability` | L1 / 探测脚本 | Gate：same-id / derive-only / FAIL | must（Spike） |

Feature 结束前：VP-3-restore 与 VP-4-sub **必须**各至少独立覆盖一次。

### 与 requirements 一致性注记

`requirements.md` **已含** AC-72…AC-84。本设计引用以当前 requirements 为准；不在本文件改写 AC 正文。

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| R1–R8 | 2026-09-07 | AD-CU / VP / L1–L4 | 见历史：协议、关删、原位升级、审批唤醒、capability 映射、恢复优先、验证分层 | HG-2 锁定 | 审查决议 |
| R9 | 2026-09-07 | 「Agent 怎么验证」操作手册 | **删除**；验证架构保留为 L1–L3 + VP；逐 Phase 可执行验证写入 `phases/*/spec.md`「验证策略」 | 用户明确否定 agent 流程体裁 | HG-2 体裁纠正 |
| R10 | 2026-09-07 | L3 / AD-CU-7 / AD-CU-8 / Spike PASS / DAG / phase-1 产出 | L3=模拟 Webview（非 HTML/CSP/渲染）；AD-CU-7 软优先+切 Tab 回 pending、并入 coordinator；AD-CU-8 Continue 四态表；Spike PASS 须含 AD-CU 更新建议；ASCII 标明 0b→phase-3 only；phase-1 须落地 L2 harness+冒烟 | 用户锁定补丁（HG-2 前） | 增量修订 |
| R11 | 2026-09-08 | AD-CU-1/3/4/5/6/10；实体旁状态图；验证可调用面；phase 交叉 | 极薄 Webview；空 Tab 不入 openTabSet+恢复剔除；tabId 生命周期；Diff before 权威快照；索引立即持久化；每 VP L2 测试钩子；ASCII 状态转换；phase-1/3 产出与 VP 同步 | 用户锁定补丁（HG-2 前） | 增量修订 |

## 建议的下一步

确认本设计与 `phase-plan.md` DAG 后，并行启动 **phase-0a / phase-0b Spike** 与 **phase-1**（纯 live）；Phase 2+ 严格遵守 Gate 依赖。
