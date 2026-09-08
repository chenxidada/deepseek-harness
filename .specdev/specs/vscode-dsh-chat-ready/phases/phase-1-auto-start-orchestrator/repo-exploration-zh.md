# 代码库探索报告 — phase-1-auto-start-orchestrator

## 1. Task Context（任务上下文）

`vscode-dsh-chat-ready` 的 Phase 1 交付可测的 **AutoStartOrchestrator**（start-reason 状态机）：把自动 Start 接到活动栏 / Conversation 可见 / 启动·发送类命令 / 状态栏；`onStartupFinished` 仅注册（AC-1a 反向）；查询/删除不触发完整建连（AC-1e / AD-CR-9）；断线自动重试至多一次 + 以面板为主的连接错误 UI 缝；并为 phase-2 的 AutoReady 可见门闩留接口。本报告对照**现有** Start 调用链、可见性钩子、离线删除、Host 断线面与 L2 spy 点，避免 implementer 另起平行启动面。

## 2. Repository Overview（仓库概览）

| 项 | 现状 |
|----|------|
| 包 | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| 语言 | TypeScript ESM；duck-typed `vscode` 面便于 Node L1/L2 |
| 入口 | `src/extension.ts`（`activate` / `deactivate`） |
| Host | `src/session-host.ts` — `IdeSessionHost` |
| 对话 UI | `src/chat-panel/*` WebviewView `dsh.chat`；`ConversationController` |
| 激活 | `package.json` 含 `onStartupFinished` + 命令/视图触发 |
| 活动栏 | `viewsContainers.activitybar` id `dsh`；视图 `dsh.chat` / conversations / history / timeline |
| 测试 | `apps/vscode-dsh/tests/` Vitest |
| 前序功能 | `vscode-dsh-conversation-ui` phase 0a–3 **已合入 `master`**（与当前 HEAD 同 tip） |

**基线分支说明（FYI，非阻塞）：** 当前分支名为 `impl-phase-4-subagent-enter-pin`，但 `master...HEAD` 为 `0/0`——本 Phase 依赖的面板 / Start / 删除 / restore **已在 master**。工作区有**未提交**的 phase-4 subagent 改动（`extension.ts`、`chat-panel-*`、`conversation-controller.ts` 等）。Implementer 应从 master 新建干净的 `impl-phase-1-auto-start-orchestrator`（或先 stash/迁走 phase-4），避免与脏树混写。关键 Start/删除/面板路径**并非**「仅存在于 phase-4 分支」。

## 3. Most Relevant Areas（最相关区域）

| 路径 | 原因 | 来源 |
|------|------|------|
| `apps/vscode-dsh/src/extension.ts` | 唯一产品 Start 调用点；命令矩阵；L2 钩子；离线删除 UX | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | `start` / `shutdown` / 状态与错误 / 传输死亡 | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | WebviewView 注册；**尚无** `onDidChangeVisibility` | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `panel/state`、`ui/banner`、waiting-host | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 协议类型；后续可扩 `connectionPhase` | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `newConversation`、删除门闩、空 Tab 持久化、restore | 👁 |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` | 空态行触发 `dsh.startSession` | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `hasContent` = 空 Tab 规则 | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | 持久化 `openTabSet` | 👁 |
| `apps/vscode-dsh/package.json` | 激活、视图、命令（含全部 `dsh.test.*` contributes） | 👁 |
| `apps/vscode-dsh/README.md` | 命令文档——尚无 Auto-start 矩阵 | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | L2 activate + 命令 Map（AC-1a 模板） | 👁 |
| `apps/vscode-dsh/tests/panel-close-delete.e2e.spec.ts` | AC-72/73 离线删除 | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | AC-63 查询不 Start | 👁 |
| `.specdev/specs/vscode-dsh-chat-ready/design.md` | AD-CR-1/2/4/5/9/10 | 👁 |
| `.specdev/specs/vscode-dsh-chat-ready/phases/phase-1-auto-start-orchestrator/spec.md` | AC + HG-2 收口 | 👁 |

**尚不存在（待建）：** `auto-start-orchestrator.ts`、`connection-ui.ts`、`auto-ready-coordinator.ts`（phase-2；phase-1 可只留门闩缝）、`dsh.showPanel` / `dsh.openExtensionSettings`、StatusBarItem、可见性监听。

## 4. Key Entry Points / Call Paths（关键入口 / 调用链）

### 路径 A — 当前产品 Start（今日唯一可建连路径）

```
用户 / 命令面板 / Conversations 空态行点击
  → commands.execute('dsh.startSession')
  → extension.ts registerCommand('dsh.startSession')
       │
       ├─ 若 host?.status === 'connected' → InformationMessage；return
       ├─ 若无 workspaceFolders[0] → ErrorMessage「请先打开工作区」；return  ← AD-CR-5 须改
       ├─ next = new IdeSessionHost()
       ├─ next.onError → showErrorMessage（Toast）
       ├─ host = next
       ├─ await next.start({ cwd: folder, credentials… })
       ├─ bindConversations(new ConversationController(...))
       ├─ restoreOpenTabSet() → empty 则 newConversation  ← 今日就绪绑在 Start 上
       └─ 成功/失败 Toast
```

✅ **CONFIRMED：** 产品代码仅在 `extension.ts` 的 `dsh.startSession`（约 L182–228）调用 `IdeSessionHost.start`。

### 路径 B — activate / onStartupFinished（AC-1a 基线）

```
VS Code 激活（onStartupFinished | onCommand:* | onView:dsh.*）
  → activate(...)
       → 注册 TreeView / ChatPanel / 全部命令（含 dsh.test.*）
       → （不 request、不 start）
```

✅ **CONFIRMED：** `activate` 不 Start；Phase 1 接线后仍须保持「仅注册」。

### 路径 C — 可见性 / 活动栏（AD-CR-2 缺口）

```
今日：resolveWebviewView → attach；无 onDidChangeVisibility；无 StatusBarItem
需要：可见 true → request('conversation-view-visible') + AutoReady 门闩通知；
      活动栏打开 → request('activity-bar') + reveal Conversation；
      状态栏点击 → request('status-bar') / showPanel
```

### 路径 D — 离线删除（AC-1e / AD-CR-9 / 前序 AC-73）

```
dsh.deleteConversation → runDeleteActive
  → requireConversations() 失败 → ErrorMessage（不 Start、不假删）
  → 否则 deleteConversation：host 非 connected → host-not-ready（不 dispose）

dsh.deleteHistory：conversations 未绑定 → host-not-ready
```

✅ **CONFIRMED：** 权威删除离线不假删、不触发 Start。缺口：文案非「Host 连接后可删除」；菜单未离线禁用。

### 路径 E — 断线 / 崩溃面（AC-6a 接线目标）

```
传输死亡 → onTransportDeath → status='error' + onError Toast
→ 无 orchestrator disconnected、无 retry-once
→ 有序 shutdown() 才置 disconnected
```

## 5. Likely Impact Surface（影响面）

| 区域 | 变更 | 风险 |
|------|------|------|
| **新建** `auto-start-orchestrator.ts` | 纯 FSM + `StartHostPort`；L1 | 低 |
| **新建** `connection-ui.ts` | 连接态 → 面板 + StatusBarItem | 中 |
| `extension.ts` | Start 改走 orchestrator；触发接线；showPanel/设置；cwd 降级；闸门 test 钩子 | **高**（中枢；且 WT 上 phase-4 也在改） |
| `session-host.ts` | 非用户断线 → orchestrator | 中 |
| `chat-panel-provider.ts` | `onDidChangeVisibility` | 中 |
| `chat-panel-host.ts` / `protocol.ts` | connecting/failed 投影缝 | 低–中 |
| `conversation-controller.ts` | Start≠自动 New（就绪拆到 phase-2） | 中 |
| `package.json` / `README.md` | 新命令 + 矩阵；AD-CR-10 | 中 |
| `tests/` | L1 FSM；L2 AC-1a spy；离线删除；凭据失败 | 中 |

## 6. Existing Constraints / Conventions（既有约束）

- Duck-typed vscode：新增 API 须扩 `VsCodeLike` / `WebviewViewLike`。
- L2 用注入命令 Map + `activate(..., vscodeFake)`。
- 模块级 `let host` 单例意图；并发 Start 须由 FSM 禁止。
- 空 Tab：`hasContent` 为假则不进 `openTabSet`；AC-1a 须断言无新空 Tab。
- Webview 不自持 mode；不改 `agent-loop`（AC-25/26）。
- 错误文案走 `redactSecrets`。
- 今日 Start 成功即 restore/New——phase-1 须留 AutoReady 缝，禁止仅激活就 New。
- 全部 `dsh.test.*` 现已 contributes 且无条件注册——须按 AD-CR-10 收紧。

## 7. Risks / Unknowns（风险 / 未知）

| ID | 断言 | 确认度 |
|----|------|:------:|
| R1 | 产品 Start 唯一入口为 `dsh.startSession` | ✅ CONFIRMED |
| R2 | `activate` 不 Start；AC-1a 目前因省略而成立 | ✅ CONFIRMED |
| R3 | 无工作区硬拒绝 Start（须改 AD-CR-5） | ✅ CONFIRMED |
| R4 | 无可见性监听 | ✅ CONFIRMED |
| R5 | 无 StatusBarItem | ✅ CONFIRMED |
| R6 | 离线删除挡权威但 UX/菜单未对齐 AD-CR-9 文案 | ✅ / ⚠️ |
| R7 | 传输死亡 → error+Toast，无 retry-once | ✅ CONFIRMED |
| R8 | 「活动栏打开」精确 API（AC-1b） | ❓ UNKNOWN |
| R9 | 无显式 `hasCredentials()` 预检 | ✅ CONFIRMED |
| R10 | 脏 phase-4 WT 与本 Phase 冲突 | ✅ CONFIRMED |
| R11 | Start 与 restore/New 解耦可能影响前序恢复 AC | ⚠️ HYPOTHESIS |

## 8. Uncertain / Unverified（未核实）

- 活动栏容器打开事件的可靠 VS Code API。
- `onDidChangeVisibility` 在 `retainContextWhenHidden: true` 下的实测行为。
- `error` 后再次 `new IdeSessionHost()` vs 复用实例的编排归属。
- 用户 Stop vs 崩溃到 orchestrator 的映射细节。
- `starting` 期间 `onUserStop`：现无 abort token，可能仅「忽略迟到 settle」。
- `dsh.test.*` 是否可从 contributes 移除、仅运行时按环境注册。

## 9. Stub Detection & Registry Cross-Validation（桩检测）

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| —（活跃表空） | — | 无活跃债 | N/A | ✅ 匹配 |

### Stub Detection Summary

- ✅ 已确认且匹配 registry 的桩：**0**
- ⚠️ Registry 与代码不一致：**0**
- 🔴 未注册空壳桩：**0**（已探 Start/删除/面板路径）
- 🟡 关注（功能缺口，非 `@STUB`）：无 orchestrator/connection-ui；无工作区硬拒；无可见性/状态栏/showPanel；`dsh.test.*` 未闸门；错误仅 Toast

无阻塞级升级：仓库现实与 Phase 1 假设兼容。

## 10. Recommended Next Reads（建议下一步阅读）

1. ⭐ **必读** — `extension.ts`（activate、startSession、runDeleteActive、test 钩子、`requireConversations`）
2. ⭐ **必读** — `session-host.ts`（start / shutdown / 状态 / 传输死亡）
3. ⭐ **必读** — Phase spec HG-2 备注 + `design.md` AD-CR-1/2/4/5/9/10 +「Phase 1 实施第一步」
4. 🔷 **应读** — `chat-panel-provider.ts` + `chat-panel-host.ts`
5. 🔷 **应读** — `conversation-controller.ts`（new / delete / persist / restore）
6. 🔷 **应读** — `tests/panel-l2-l3-protocol.spec.ts` + `panel-close-delete.e2e.spec.ts`
7. 🔹 **可选** — `conversation-tab-bar.ts`；`README.md`；phase2 AC-63 测试

---

## 附录 A — 建议新建文件与接线点

| 新文件 | 职责 | 接线自 |
|--------|------|--------|
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | FSM + snapshot | `activate` 构造；`StartHostPort` 包装 `IdeSessionHost.start` |
| `apps/vscode-dsh/src/connection-ui.ts` | 连接态 → 面板/状态栏 | orchestrator 状态迁移；provider 可见性 |
| （phase-2）`auto-ready-coordinator.ts` | 可见门闩 | phase-1 仅留调用缝，**禁止**仅激活 New |

**接线清单：** start/send 命令 → `request`；可见性 → `conversation-view-visible`；活动栏/状态栏；Stop → `onUserStop`；传输死亡 → `onUnexpectedDisconnect`；删除/查询不 `request`；L2 钩子闸门。

## 附录 B — L2 AC-1a：如何 spy `start` 调用次数

不得仅用 `getStartState() === 'idle'`（HG-2）。

1. 向 orchestrator 注入 `StartHostPort`，`start` 用 `vi.fn()` 计数（L1/L2 首选）；或
2. 在 `activate` 前 spy `IdeSessionHost.prototype.start`，再跑 `dsh.test.simulateStartupOnly`。
3. **同时**断言：`start` 调用次数 = 0；无有效连接；orchestrator `idle`；无新增空 Tab / openTabSet 未增长。

模板：`panel-l2-l3-protocol.spec.ts` 的 `activate` + 命令 Map。

## 附录 C — 删除离线 vs AC-73 / AD-CR-9

| 方面 | 现状 | Phase 1 目标 |
|------|------|--------------|
| 离线 dispose | 阻止 | 保持 |
| 仅清索引假删 | 无 | 禁止 |
| 触发 Start | 否 | 保持否 |
| 文案 | Start before deleting… | 「Host 连接后可删除」或禁用入口 |
| 离线菜单 | 仍可点 → 报错 | 禁用或标明 |

## 附录 D — 调用链一句话

**今日：** 仅 `dsh.startSession` → `IdeSessionHost.start` → bind → restore/New。**Phase 1：** 所有 Start reason → `AutoStartOrchestrator.request` → 单次 `StartHostPort.start`；startup 只注册；删除/查询离线不建连。
