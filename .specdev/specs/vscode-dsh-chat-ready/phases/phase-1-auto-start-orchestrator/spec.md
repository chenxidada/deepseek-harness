# Phase 1: 自动建连编排 + start-reason + 触发/离线删除边界

## 目标

交付可 L1 测试的 **AutoStartOrchestrator**（start-reason 状态机），将自动 Start 绑定到活动栏 / Conversation 视图可见 / 启动·发送类命令 / 状态栏；`onStartupFinished` **仅注册**；查询/删除类不触发完整建连；Host 单例；断线自动重试至多一次；失败以面板为主、未开面板则状态栏可点（`dsh.showPanel`）；缺凭据含设置深链；无工作区仍可 Start。为后续自动就绪留下连接态投影缝（Connecting / failed）。

## 前置条件

- HG-1 / HG-2 已确认
- 依赖 Phase：无
- 前序 `vscode-dsh-conversation-ui` 行为基线可用（分支或已合入；见 requirements R-1）
- 已读：`design.md` AD-CR-1/2/4/5/9/10/11；`tech-debt-registry.md`

## 验收标准

从 `requirements.md` 抽取本 Phase Must：

- [ ] **AC-1** 活动栏 / Conversation 视图可见 / 文档化启动·发送类命令 / 状态栏 → 有凭据则自动 Start；已连则复用
- [ ] **AC-1a** 仅 `onStartupFinished` 激活注册、未开活动栏/视图/命令/状态栏 → **不** Start、不 restore/New、不抢焦点、不堆空 Tab
- [ ] **AC-1b** 打开活动栏且 Conversation 尚未可见 → **必须** reveal Conversation（或文档化等价）
- [ ] **AC-1c** 启动/发送类触发；查询/浏览/删除类 **不**触发完整自动建连；命令矩阵写入 README
- [ ] **AC-1d** start-reason 状态机 `idle|starting|pending-start|started|disconnected|failed`（或文档化等价）；非用户 Stop 断线须显式离开 `started`；禁止并行互踩 Start
- [ ] **AC-1e** 查询/删除类在 Host 离线时 → 权威会话删除入口**禁用或提示「Host 连接后可删除」**（对齐前序 AC-73，禁止假删）；仅本地 UI 状态可清且须标注；**不**因此完整建连；不静默失败
- [ ] **AC-2** Start 失败 → 可读原因 + 重试 + 缺凭据设置直达；主载体面板内；面板不可见 → 状态栏可点打开面板（`dsh.showPanel`）；不以阻塞 Toast 为唯一提示
- [ ] **AC-5** 重复触发不叠多个 Host；至多一条有效连接
- [ ] **AC-6a** 非用户 Stop 断线 → 断开态 + 自动重试至多一次 → 再失败则错误+手动重试；禁止无限重连
- [ ] **AC-7**（本 Phase 切片）L2 含 **AC-1a 反向用例**；可模拟有/无凭据；可调用 `dsh.showPanel`；其余入口可用 L1+注册断言（主路径全链路留给 phase-2）
- [ ] **AC-13** Host 连接进行中 → 面板（一旦可见或经 L3 投影）展示 Connecting / 等价
- [ ] **AC-14** 连接失败/建连失败/断线手动重试态 → 面板展示失败说明+重试；缺凭据含设置直达；面板未可见满足 AC-2 状态栏
- [ ] **AC-25** Webview 不自持与 Host 冲突的 mode/session 权威
- [ ] **AC-26** 不修改 `packages/core/agent-loop`；不改双通道权威为 Webview 单通道

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | L1 + L2 | Orchestrator `request` 各 reason；L2 对视图可见/命令抽测 | 有凭据 → Host connected；已连再 request 不第二次 start |
| AC-1a | **L2 反向** | `dsh.test.simulateStartupOnly`；见「反向断言对象」 | `start` 调用=0；无连接；orchestrator idle；无新空 Tab |
| AC-1b | L2 / 静态+运行时 | 模拟活动栏打开且 chat view 不可见 → 断言执行 reveal/`dsh.showPanel` 等价 | Conversation 被 reveal；非静默跳过 |
| AC-1c | 静态检查 + L1 | README 矩阵；对 delete/openHistory 路径断言未调 `orchestrator.request` 完整建连 | 删除/查询不 Start |
| AC-1d | **L1** | 并发 `request(A)`+`request(B)` during starting | 仅一次 `start()`；pending 结算；状态序列合法 |
| AC-1e | L2 | Host 离线执行 `dsh.deleteConversation` / `dsh.deleteHistory` | 禁用或「Host 连接后可删除」；未假删权威；`start` 未调用 |
| AC-2 | L2 | `dsh.test.setCredentialPresence(false)` 后触发 Start | failed 态；可 `dsh.showPanel`；可 `dsh.openExtensionSettings`；非唯一 Toast |
| AC-5 | L1/L2 | 连续多次 request / 重复打开侧栏模拟 | Host 实例数 ≤1 |
| AC-6a | L1/L2 | 注入 started→非 Stop 断线 | Orchestrator 进入 `disconnected`（getStartState≠started）；auto retry=1；再失败 manual；无循环 |
| AC-7（切片） | L2 | 反向用例 + 凭据开关 + showPanel | 证据可脚本；L4 非唯一 |
| AC-13 | L2/L3 | starting 时读 `panel/state` / banner / connectionPhase | connecting 可见；非 live 可发送 |
| AC-14 | L2/L3 | failed 投影 | 失败文案+retry；设置直达字段/按钮 |
| AC-25 | 静态+L3 | Webview 不写 mode 权威；跟 panel/state | 无本地 mode 决策 |
| AC-26 | 静态检查 | git diff / path 断言无 agent-loop 改动 | 无核心 loop 变更 |

## 约束

- AD-CR-1/2/4/5/9/10/11；继承 AD-CU-1；AD-CR-9 对齐前序 AC-73
- **实施第一步：** 先对照现有 `extension.ts` / `startSession` / 视图可见性 / `newConversation`（见 design「Phase 1 实施第一步」）
- 修改「无 workspace 拒绝 Start」→ 降级 cwd（AD-CR-5）；自动就绪逻辑可留 stub 接口但 **不得**在仅激活时 New
- `dsh.test.*` 仅 VSCODE_DSH_TEST / 开发宿主注册（AD-CR-10）
- 敏感凭据不入日志/spec（Constitution §3）
- 本 Phase **不**要求交付完整 Chat 视觉底盘或顶栏新建按钮（phase-3/4）

## 产出清单

- [ ] `apps/vscode-dsh/src/auto-start-orchestrator.ts`（+ L1 测试）
- [ ] `apps/vscode-dsh/src/connection-ui.ts`（或等价模块）
- [ ] `extension.ts` 触发接线；状态栏；命令矩阵
- [ ] `dsh.showPanel` / `dsh.openExtensionSettings` / L2 测试钩子
- [ ] `package.json` + `README.md` 命令矩阵与设置前缀
- [ ] `tests/`：AC-1a 反向、FSM 并发、离线删除、凭据失败
- [ ] `phases/.../implementation.md`（由 implementer 填写）

## 不在本 Phase 范围

- 自动 restore / 自动 New 完整语义（phase-2）
- Markdown / 气泡主题底盘（phase-3）
- 顶栏「新建会话」按钮与 AC-22 等待文案产品化（phase-4；本 Phase 仅需 connecting 投影缝）
- Should 键盘快捷键（AC-34）

## HG-2 收口备注（非阻塞，实施时遵守）

### VP-CR-1a / AC-1a 反向断言对象（必须同时满足）

不得仅用 `getStartState() === 'idle'` 作为「无 Host」的唯一证据。L2 **必须**断言：

1. `IdeSessionHost.start`（或注入的 `StartHostPort.start`）**调用次数 = 0**（spy/mock）；
2. 无有效 Host 连接 / 无会话子进程（与现有 Host status API 一致）；
3. orchestrator snapshot 为 `idle`（或从未进入 `starting`/`started`）；
4. openTabSet / Tab 注册表无新增空 Tab。

### onUserStop 与飞行中的 start

若 `onUserStop()` 在 `starting` / `pending-start` 期间被调用：必须 abort 或忽略随后 settle 的状态回写（不得在已 `idle` 后把状态写回 `started`/`failed`）；pending 清空；`autoRetryUsed` 重置。细节由实现保证，L1 至少覆盖「Stop during starting → 最终 idle 且无迟到回写」。
