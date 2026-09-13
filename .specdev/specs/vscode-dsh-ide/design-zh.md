# Design: vscode-dsh-ide

<!--
  slug: vscode-dsh-ide
  audience: plan-generator / implementer / reviewer / verifier / HG-2
  language: zh mirror of design.md (canonical also zh)
  requirements: .specdev/specs/vscode-dsh-ide/requirements.md (HG-1 confirmed)
  constitution: .specdev/specs/vscode-dsh-ide/constitution.md
  created: 2026-09-04
-->

## 范围覆盖

本设计覆盖整个 feature `vscode-dsh-ide`（一个 VS Code 窗口壳），对应 `requirements.md` 中全部 Must AC（AC-1–AC-13、AC-15–AC-24、AC-27–AC-28、AC-30–AC-33）及 Should AC（AC-11、AC-14、AC-25、AC-29）。**不**覆盖 Spec 面板、hooks 策略包产品化（Out）。

Phase 拆分见 `phase-plan.md`。各 Phase 细规见 `phases/<phase-id>/spec.md`。

## 架构摘要

VS Code Extension 作为**窗口 Host**：在同一工作区用多 Tab 管理多个对话，每个 Tab 绑定一个 SDK `sessionId`。本地只启动**一个** `dsh --profile ide` 子进程（`dsh-base` + `sdk-app` + `ide-bridge`），经 **SDK stdio**（newline-delimited JSON-RPC）完成 `initialize` / `session/prompt` / `shutdown` 与事件订阅；经 **Host bridge**（本机 Unix domain socket + NDJSON，可替换）把 `approval/request` 与 `user-questions/request` 弹到 VS Code 并回传合法结局，失败 fail-closed。扩展只做驱动、观察、交互应答与 UI 投影，**不**改 `agent-loop`，**不**与 Web `ui-approval` / `ui-user-questions` 同挂争瀑布。

## 开放问题裁定（HG-2 默认）

| ID | 裁定 | 可替换性 |
|----|------|----------|
| **Q-1** | 本版采用：`packages/bundle/ide`（profile patch）+ `packages/ide/ide-bridge`（Host 侧 answerer 插件）+ `apps/vscode-dsh`（VS Code Extension）。是否升为官方 in-box profile 与发布通道留给后续；命名以 `ide` / `ide-bridge` 为准，可在实现中微调包路径但须保持 profile 名稳定。 | 包树位置可迁；契约不变 |
| **Q-2** | **默认 IPC：Unix domain socket + newline-delimited JSON 帧**（Windows：named pipe，同一帧格式）。Extension 先听 socket，再 spawn 子进程并注入 `DSH_IDE_BRIDGE_SOCK=<path>`；`ide-bridge` 连接后注册终端 answerer。 | 传输适配器接口可换 TCP localhost / 其他本机通道，不改 answerer 语义 |
| **Q-3** | **关闭 Tab 默认结束对应会话**（对该 `sessionId` 调用 SDK 侧可观测的销毁路径：dispose agent / 等价；本版若协议尚无 `session/close`，则由 Host 映射为停止对该 id 的 prompt 并释放本地映射，且在进程内 dispose 该 agent——见「多会话生命周期」）。可恢复会话列为 Should / 后续。 | 策略策略位可扩展，不改 Tab 模型 |

## 架构决策

### AD-1：单 DSH 进程 + 多 `sessionId`（窗口内多对话）

**决策：** 每个 VS Code 窗口（工作区）启动至多一个 `ide` profile 子进程；多对话 = SDK 多 `sessionId`（`dsh-sdk-jsonrpc-server` 已按 id get-or-create agent）。

**理由：** 与现有 SDK 服务器语义对齐；避免每 Tab 一进程的资源与 bridge 连接爆炸；时间线按 `sessionId` 过滤即可。

**替代方案：** 每 Tab 独立 DSH 进程 — 生命周期与端口/socket 管理更重，拒绝作为默认。

**风险缓解（R-2）：** 设计文档与实现须写清：取消/关闭只影响目标 session；`shutdown` 回收整进程；并发 prompt 按 session 串行（SDK 既有「每 session 独立 agent」）。

### AD-2：双通道分离（SDK stdout vs Host bridge）

**决策：**

| 通道 | 载体 | 职责 |
|------|------|------|
| SDK | 子进程 **stdout/stdin** NDJSON JSON-RPC | `initialize`、`session/prompt`、`shutdown`；`session.event` / `session.status` / subagent 通知 |
| Host bridge | **非 stdout** Unix socket（或 named pipe）NDJSON | `approval/request`、`user-questions/request` 的请求/应答；可选 permission-preset 切换 RPC |

**理由：** `sdk-app` 独占 stdout；协议 README 已声明 server→client request 为死能力、审批不走 SDK stdout。ACP 先例是在**同一** ACP JSON-RPC 上做 `session/request_permission`；IDE 不能占用 stdout，故侧通道对齐「进程内 waterfall 终端 answerer → Host UI」模式。

**替代方案：** 在 SDK 协议上新增 server→client approval RPC — 侵占/扩展 stdout 协议，与 Out 冲突，拒绝本版。

### AD-3：`ide` profile 组合与 Web 应答互斥

**决策：** `ide` profile = `dsh-base` + `dsh-sdk-app`（或等价 sdk-app patch）+ `ide-bridge`。**禁止**挂载 `dsh-client-ui-approval` / `dsh-client-ui-user-questions`（及任何争抢 `approval/request` / `user-questions/request` 终端应答的 Web 宿主插件）。启动时组合校验：若检测到冲突行 → **失败并明确报错**（AC-5），不静默双挂。

**理由：** 瀑布只有一个终端终点；Web UI 应答与 bridge 同挂会导致不确定路由。

**替代方案：** 运行时按 agent 作用域分流 — 复杂度高且易漏，本版用 profile 层硬互斥。

### AD-4：Host bridge 为终端 answerer（对齐 ACP 先例）

**决策：** `ide-bridge` 在 DSH 进程内 `ctx.on('approval/request', …)` / `ctx.on('user-questions/request', …)`：对**本 runtime 拥有的**请求，经 socket 发给 Extension；将 UI 选择映射为 `ApprovalOutcome` / `AskUserQuestionAnswer`；连接缺失、超时、抛错、非法结局 → 返回 `unavailable` / 等价 fail-closed，**不**调用 `next()` 把问题丢给「无人终端」。非本 bridge 拥有的请求 `next()`。

**理由：** 与 `dsh-acp` 的 `approval/request` 机器应答模式同构；`dsh-user-approval` 契约已规定缺失/抛错 fail-closed。

**替代方案：** Extension 内重做权限瀑布 — 违反「扩展不拥有循环」与依赖边界。

### AD-5：Tab ↔ session 绑定与审批防串台

**决策：** Extension 维护 `ConversationTab { tabId, sessionId, title?, timelineCursor, pendingInteraction? }`。新建 Tab → 生成新 UUID 作为 `sessionId`。活动 Tab 决定 `session/prompt` 目标与时间线过滤。审批/提问载荷携带 `sessionId`（及可选 `tabId`）；UI **必须**聚焦对应 Tab 或明确标注会话（AC-10）。

**关闭 Tab（Q-3）：** 默认 dispose 该 session 的 agent（见多会话生命周期），移除 Tab；未结算交互 fail-closed。

### AD-6：权限档位只走 `permission-presets`

**决策：** UI 下拉/命令调用 Host 的 `ctx.permissionPresets`（经 bridge RPC 或既有命令面），不发明第二套语义（AC-21/22）。

### AD-7：事后 Diff，默认非逐步确认

**决策：** 从 `session.event` 中写文件类 tool 结果和/或工作区 git 变更收集路径；提供 Diff/SCM 入口。默认不在执行中逐文件拦截（AC-23/24）。时间线跳转 Diff 为 Should（AC-25）。

### AD-8：可替换边界

**决策：** 可替换面限于：（1）bridge **传输适配器**；（2）VS Code **UI 呈现策略**（审批/提问面板）；（3）auto-allow 策略插件。三者均不得修改 `packages/core` 的 `agent-loop`（AC-27）。本版交付替换契约文档 + 至少一个轻量替换证明（AC-29，Phase 5）。

## 组件图

```
┌──────────────────────────────── VS Code Extension (apps/vscode-dsh) ────────────────────────────────┐
│  TabBar / ConversationView / ApprovalComposer / ApprovalApprovalPanel / PermissionPicker / DiffEntry │
│                    ConversationRegistry (tabId ↔ sessionId)                                          │
│         SdkClient (stdio)                         BridgeHostServer (UDS/named pipe)                    │
└────────────┬───────────────────────────────────────────────┬────────────────────────────────────────┘
             │ stdin/stdout JSON-RPC                         │ NDJSON bridge frames
             ▼                                               ▼
┌──────────────────── dsh --profile ide (单进程) ─────────────────────────────────────────────────────┐
│  dsh-base (agent, session, approval, user-questions, permission-presets, tools, …)                   │
│  sdk-app → dsh-sdk-jsonrpc-server (stdout 独占)                                                       │
│  ide-bridge → 连接 Host socket；注册 approval / user-questions 终端 answerer                            │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 核心实体 / 数据模型

```typescript
/** Extension 侧 Tab 模型（权威在 Extension；session 权威在 DSH） */
interface ConversationTab {
  tabId: string
  sessionId: string // SDK sessionId；新建时 UUID
  title?: string    // Should: 会话标题或首条消息摘要
  status: 'idle' | 'running' | 'error' | 'disconnected'
}

/** Host bridge 帧（示意；实现可细化为带 id 的 request/response） */
type BridgeFrame =
  | { kind: 'approval/request'; id: string; sessionId: string; payload: ApprovalRequestWire }
  | { kind: 'approval/response'; id: string; outcome: ApprovalOutcome }
  | { kind: 'user-questions/request'; id: string; sessionId: string; payload: AskUserWire }
  | { kind: 'user-questions/response'; id: string; answer: AskUserQuestionAnswer }
  | { kind: 'permission/select'; sessionId: string; preset: string }
  | { kind: 'error'; id?: string; message: string }

/** 传输适配器（可替换） */
interface IdeBridgeTransport {
  start(): Promise<void>
  stop(): Promise<void>
  send(frame: BridgeFrame): void
  onFrame(handler: (frame: BridgeFrame) => void): () => void
}
```

## 双通道时序（关键路径）

### 启动

1. Extension 创建 bridge socket 并 listen。
2. Spawn `dsh --profile ide`，env 注入 `DSH_IDE_BRIDGE_SOCK`；stdio 交给 SDK client。
3. 等待 SDK `initialize` 成功；失败 → 错误 UI，不呈「已连接」（AC-4）。
4. `ide-bridge` 连接 socket；失败 → answerer 不可用 → 后续审批 fail-closed（AC-19），并在 UI 标 bridge 降级/错误。

### Prompt（活动 Tab）

1. 用户在活动 Tab 提交 → `session/prompt({ sessionId, … })` → 回执含 `messageId`（AC-12）。
2. 订阅通知按 `sessionId` 过滤，更新该 Tab 时间线（AC-13）。

### 审批 / 提问

1. 工具路径触发 `ctx.approval.request` / user-questions → waterfall 至 `ide-bridge`。
2. bridge 发 `approval/request` 帧（含 `sessionId`）→ Extension 关联 Tab（AC-10）→ 弹窗。
3. 用户选择 → 合法结局回传 → waterfall 解除阻塞（AC-20）。
4. 超时/断开/非法 → fail-closed（AC-19、AC-30）。

### 关闭

- 关 Tab：默认结束该 session（AD-5 / Q-3）。
- 关窗口 / 卸扩展：`shutdown` + 杀子进程 + 关 socket（AC-3）。

## 多会话生命周期

| 事件 | 行为 |
|------|------|
| 新建 Tab | 新 `sessionId`；首 prompt 时 SDK server get-or-create |
| 切换 Tab | 仅改本地活动指针与投影；不切换进程 |
| 关闭 Tab | dispose 该 session 的 agent（实现：ide-bridge 或扩展经约定 RPC/本地映射触发 `AgentHandle.dispose()`；若需新增 bridge 方法 `session/dispose`，属 ide-bridge 拥有面，**不**改 agent-loop） |
| 进程 `shutdown` | 全部 session 回收 |

**说明：** 当前 SDK 协议无 `session/close`（protocol Known Limitations）。本版在 **ide-bridge** 增加 Host→runtime 的 `session/dispose`（经 bridge，非 stdout），由 bridge 调用既有 `AgentHandle.dispose()`；不扩展 SDK stdout 方法集，避免与 sdk-app 协议面耦合。

## 失败模式

| 故障 | UI / 运行时行为 |
|------|-----------------|
| `initialize` 失败 / 握手前崩溃 | 可诊断错误；非「已连接」（AC-4） |
| Profile 含 Web 应答插件 | 启动校验失败（AC-5） |
| Bridge 未连 / 超时 / 非法结局 | 审批/提问 fail-closed；工具不静默放行（AC-19） |
| SDK 传输关闭 / 子进程退出 | 终止等待、错误态、未结算交互 fail-closed（AC-30） |
| 非法 bridge 入站载荷 | 校验拒绝，不放行（AC-31） |
| 密钥 | 不进日志/spec/提交物（AC-32） |

## 包与文件落点（目标）

| 路径 | 角色 |
|------|------|
| `packages/bundle/ide/` | `cordis.patch.yml`：sdk-app 层 + ide-bridge；互斥注释/校验钩 |
| `packages/ide/ide-bridge/` | 插件：socket 客户端、answerer、session/dispose、permission RPC |
| `apps/vscode-dsh/` | VS Code Extension：进程管理、Tab、时间线、审批/提问 UI、Diff、permission picker |
| `apps/cli` profile 模板 | 注册 `ide` 自动初始化（若本版纳入官方模板；否则文档化手动 profile） |

**禁止：** 修改 `packages/core/**/agent-loop*`；在 `dsh-sdk-protocol` stdout 方法中加入审批 RPC；在 ide profile 挂载 Web ui-approval / ui-user-questions。

## 测试策略（宪法 §1.2–§1.3 / AC-33）

每个 Phase 至少：

1. **1 个真实组件集成测试**（非纯 mock 空壳）：例如 Loader 组合 boot、bridge 帧往返、Tab registry。
2. **1 个独立 e2e 场景**（verifier 设计）：进程级或 Extension host 级可观察路径。

密钥测试遵循仓库 e2e 自跳过策略；bridge/fail-closed 路径须可无 key 验证。

## 高风险子系统

1. **多 Tab 审批串台（R-1）** — 载荷强制 `sessionId` + UI 关联（AC-10）。
2. **Bridge 与 SDK 生命周期不同步（R-3）** — 任一侧断开则 fail-closed 并清 UI 等待。
3. **误挂 Web 应答（R-4）** — profile 互斥校验（AC-5）。
4. **session dispose 与 SDK 协议缺口** — dispose 走 bridge，不假装 SDK 已有 close。

## 权衡汇总

| 主题 | 选择 | 放弃 |
|------|------|------|
| IPC | UDS/named pipe NDJSON | 本版不把审批塞进 SDK stdout；TCP 仅作替换适配 |
| 多对话 | 单进程多 sessionId | 每 Tab 一进程 |
| 关 Tab | 结束会话 | 默认可恢复（Should 后续） |
| Diff | 事后 | 默认逐步写前确认 |
| Spec/hooks | Out | 不进本设计 Must |

## 不在范围内（设计层重申）

- Spec 驱动面板、hooks 策略包框架
- Fork Code-OSS；ACP 作 IDE 主协议
- 扩展内 agent-loop / 工具执行权威源
- 与 Web 终端应答双挂；stdout 混审批

## 建议的下一步

进入 HG-2：用户确认本设计与 `phase-plan.md` 后，按 DAG 从 `phase-1-profile-dual-channel` 开始实施。
