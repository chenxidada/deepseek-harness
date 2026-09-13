# 设计一致性审查 — phase-1-auto-start-orchestrator

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CR-1** AutoStartOrchestrator 纯逻辑 FSM；`StartHostPort` 注入；无 vscode 依赖 | 是 | `auto-start-orchestrator.ts`：六态 + `request`/`onUnexpectedDisconnect`/`onUserStop`/`getSnapshot`；零 vscode import；extension 注入 port | ✅ |
| **AD-CR-2** 触发 = 活动栏 / 视图可见 / 启动·发送命令 / 状态栏；activate 仅注册 | 部分 | `activate` 不 `request`；可见性 → `handleConversationVisibility` → `request('conversation-view-visible')`；start/send/status-bar 已接线。**生产路径未挂真实活动栏打开事件**——`onActivityBarOpened` 仅经 `dsh.test.openActivityBar`（偏差 2） | ⚠️ |
| **AD-CR-3** 自动就绪与 Start 解耦（本 Phase 可留缝） | 是（本 Phase 边界） | `AutoReadyLatchSeam` `@STUB(phase-2…)`；**DEBT-001** Start 成功仍 restore/New——已登记、属 phase-2；AC-1a「仅激活不 New」仍成立 | ✅ |
| **AD-CR-4** 错误 = 面板为主 + 不可见时状态栏 → `dsh.showPanel`；禁止唯一阻塞 Toast | 是 | `ConnectionUiController` 按可见性路由；`dsh.statusBarAction` = reveal + `request('status-bar')`；`onError` Toast 标注为次要 | ✅ |
| **AD-CR-5** 无 workspace 仍 Start；cwd 降级 | 是 | `resolveStartCwd`：folder → `process.cwd()` → `os.tmpdir()`；无「必须开 folder」硬拒 | ✅ |
| **AD-CR-9** 删除离线：禁用或「Host 连接后可删除」；不完整建连；不假删 | 部分 | `runDeleteActive` 文案对齐；不调 orchestrator。`dsh.deleteHistory` 离线多返回 `host-not-ready`、**无**同款用户提示；菜单仍 `when` 常开 | ⚠️ |
| **AD-CR-10** L2 钩子门闩；可见性经生产入口；生产 contributes 无 `dsh.test.*` | 是 | `shouldRegisterTestHooks`（`VSCODE_DSH_TEST` / 注入 vscode）；`fireConversationVisibility` → `handleConversationVisibility`；`package.json` 无 `dsh.test.*` contributes | ✅ |
| **AD-CR-11 / AC-26** 不改 `agent-loop`；主落点 `apps/vscode-dsh` | 是 | 工作区 `packages/core` 无改动；变更限于 vscode-dsh + spec | ✅ |
| **AC-25 / AD-CU-1** Webview 无 mode/session 权威 | 是 | `mode` 仅自 `panel/state`；composer 跟 `mode === 'live'`；连接按钮只 `postMessage` `action/retry-connect` / `open-settings` | ✅ |
| **命令矩阵** README + showPanel 不强制 Start | 是 | README「Auto-start command matrix」；`dsh.showPanel` → `revealConversationPanel` 且默认不 `request` | ✅ |
| **状态机 / 断线 retry-once** | 是 | `disconnected` + `autoRetryUsed`；并发入 `pending-start`；`onUserStop` generation 忽略迟到 settle | ✅ |
| **协议缝** `connectionPhase` 等 | 是（命名略偏） | Host `panel/state` 推 `connectionPhase` / `connectionMessage` / `settingsDeepLinkAvailable`；retry 由 phase 推导。设计协议表另写 `canRetry`/`canOpenSettings`——语义等价、字段名未对齐 | 🟢 |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `auto-start-orchestrator.ts` | `apps/vscode-dsh/src/` | ✅ | 与 design 文件计划一致；纯 FSM |
| `connection-ui.ts` | 同上 | ✅ | 投影 + StatusBar；含 phase-2 latch 缝（可接受） |
| `tests/auto-start-orchestrator.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | L1 FSM |
| `tests/phase1-auto-start.spec.ts` | 同上 | ✅ | L2 AC-1a / 离线删 / 凭据等 |
| `chat-panel/protocol.ts` 等 | `chat-panel/` | ✅ | 连接投影缝留在 Host 协议面，未下沉 Webview 决策 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| FSM 模块 | `auto-start-orchestrator.ts` / `AutoStartOrchestrator` | design AD-CR-1 | ✅ |
| `StartReason` / 六态 | 与 design 类型一致 | design 骨架 | ✅ |
| `ConnectionUiPhase` / `ConnectionUiState` | 与 design 一致 | design 实体 | ✅ |
| Latch 桩 | `AutoReadyLatchSeam` | phase-1 缝；正式名 `AutoReadyCoordinator` 属 phase-2 | ✅ |
| 协议字段 | `settingsDeepLinkAvailable` | design `ConnectionUiState` 字段；协议表另有 `canOpenSettings` | ⚠️ 轻偏 |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块一件事 | ✅ | Orchestrator=建连 FSM；ConnectionUi=投影；extension=接线；Webview=渲染 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | orchestrator ← extension；connection-ui 仅依赖 orchestrator **类型**；未反向依赖 agent-loop |
| §2.3 接口隔离 | 经明确接口 | ✅ | `StartHostPort` / `ConnectionPanelPort` / panel 协议；测试注入 spy |

## 关键发现

### 🔴 Must-Fix
（无）

已知桩/债（registry，不重复升格为本轮 Must-Fix）：
- **STUB-001** `AutoReadyLatchSeam` — phase-2
- **DEBT-001** restore/New 仍绑在 Start 成功路径 — phase-2（符合本 Phase「不在范围」）

### 🟡 Should-Fix
1. **AD-CR-2 / AC-1b 生产活动栏信号**：`onActivityBarOpened` 已实现 reveal + `request('activity-bar')`，但产品路径未订阅活动栏/侧栏容器打开（仅 L2 `openActivityBar` + Conversation 可见性 / 状态栏）。请补 TreeView/`viewsContainers` 可见性或文档化「以 Conversation `onDidChangeVisibility` 为生产等价」并写进 README，避免与 AD-CR-2 字面触发集漂移。
2. **AD-CR-9 `dsh.deleteHistory` UX 不对称**：`deleteConversation` 离线提示「Host 连接后可删除」；`deleteHistory` 离线常静默 `{ outcome: 'host-not-ready' }`，上下文菜单仍可点。应对齐禁用或同款提示（不 Start、不假删已满足）。

### 🟢 Observations
- **DEBT-001 / STUB-001**：与 design「Start ≠ 就绪」终态目标不一致，但 phase-1 规格明确推迟 AutoReady；登记正确，不挡本 Phase 架构验收。
- **协议字段名**：实现跟 `ConnectionUiState.settingsDeepLinkAvailable`；design 协议表的 `canRetry`/`canOpenSettings` 未落地为同名字段——retry 由 `connectionPhase` 驱动，可接受；后续可统一命名以免 L3 双读。
- **`dsh.showPanel` 不强制 Start**：符合命令矩阵；状态栏走 `dsh.statusBarAction` 才 `request('status-bar')`。
- **Webview / agent-loop**：无 Webview 自持 mode；无 `packages/core/**/agent-loop*` 改动——AC-25/26、AD-CR-11 满足。
- **AD-CR-10**：生产 contributes 已去掉 `dsh.test.*`；Extension Development Host 未单独探测（依赖 env / 注入 double），与 README 一致，可接受。

## 详细报告
- 对照：`design.md` AD-CR-1/2/4/5/9/10/11、状态机、命令矩阵；`spec.md` AC-25/26；`implementation.md` 偏差；`tech-debt-registry.md`；`constitution.md` §2
- 代码抽查：`auto-start-orchestrator.ts`、`connection-ui.ts`、`extension.ts`（activate / StartHostPort / 可见性 / 删除 / 钩子门闩）、`chat-panel/{protocol,host,provider}.ts`、`package.json`、`README.md`
