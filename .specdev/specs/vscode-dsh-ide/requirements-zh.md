# Requirements: vscode-dsh-ide

<!--
  slug: vscode-dsh-ide
  audience: plan-generator / implementer / reviewer / verifier / HG-1
  language: zh (canonical). Mirror: requirements-zh.md
  constitution: .specdev/specs/vscode-dsh-ide/constitution.md
  revised: 2026-09-04 — HG-1 feedback: multi-tab Must; feature scope = one window; Spec/hooks deferred to other features
-->

## 产品目标

本 feature 的**主目的**是提供一个 **VS Code 窗口壳**：在同一工程（工作区）内用多 Tab 管理多个 DSH 对话，经双通道接入 DSH（SDK 观察/驱动 + Host bridge 审批/提问），并保留原生编辑器与事后 Diff/SCM 确认。

定位是「好用 + 可定制」的 **IDE 窗口面**，不是 Cursor 替代品黑盒。**Spec 驱动流程、hooks 策略包等**明确留给后续 feature（可能落在 DSH 侧或其他形态），**大概率不在本插件内做深**；本版不为它们做 Must 交付。

## 问题陈述

开发者本人用 AI 辅助编程时，需要同时满足：

1. **一个窗口、多个对话**：同一工程下明确会出现并行/切换多个会话的场景，需要 Tab（或等价）管理，而不是单会话挤在一个面板里。
2. **看得见改动**：在熟悉的 IDE 里阅读、确认文件 Diff，而不是依赖 TUI 或黑盒自动落盘。
3. **不重做循环**：Agent 编排、工具执行、会话持久化继续由 DSH 既有 seam 承担，扩展侧不重写 `agent-loop`。
4. **交互通道完整（窗口所需最小集）**：SDK 负责驱动与时间线；审批 / 提问经 Host bridge 弹到 VS Code 并 fail-closed；权限档位可切换。
5. **范围克制**：Spec 面板、可组合 hooks 策略包等扩展能力不作为本 feature 的主交付；通过后续 feature / DSH 扩展承接。

当前缺口：缺少面向 VS Code 的「多会话窗口壳 + SDK/bridge 双通道」组合；`dsh-sdk-app` 独占 stdout 且无审批应答 RPC；Web/ACP 不是本窗口的主形态。

## 目标终态

开发者在 **一个 VS Code 窗口** 中：

- 对当前工作区打开 **多个对话 Tab**，每个 Tab 对应独立（或可恢复）的 DSH 会话，可切换、可关闭；
- 用 `ide` profile 拉起本地 DSH（`dsh-base` + `sdk-app` + `ide-bridge`）；
- 通过 SDK `initialize` / `session/prompt` / `shutdown` 驱动，并订阅 `session.event`、`session.status`（及可见的 subagent 通知）渲染**当前 Tab** 的步骤时间线；
- 工具审批 / 模型提问经 Host bridge（非 stdout）弹到 VS Code，回传合法结局；失败 fail-closed；
- 可切换 `permission-presets`；
- 事后在 Diff/SCM 中确认改动；
- **不**要求本版交付 Spec 流程面板或可替换 hooks 策略包（留给后续 feature）。

## 目标用户

| Actor | 角色 | 关键需求 |
|-------|------|----------|
| **开发者本人（主 Actor）** | 使用 AI 辅助改代码的程序员 | 多对话 Tab、看清 Diff、审批/提问、跟踪当前会话时间线、权限档位 |
| **传输/UI 适配作者（Should）** | 定制 Host 集成的开发者 | 替换 Host bridge 适配器或 UI 呈现策略，不改 DSH 核心 |
| **Hooks / Spec 扩展作者** | 后续 feature 的实现者 | **Out of Scope（本版）**——本插件不为他们交付 Must 面；扩展更可能在 DSH 或其他形态 |
| **非程序员模式用户** | 简化交互用户 | **Could / Out（本版）** |

## 核心场景

| ID | 场景 | 优先级 |
|----|------|:------:|
| S-1 | 开发者从 VS Code 启动/停止 `ide` profile，完成一次 `session/prompt` 并看到时间线到 idle | Must |
| S-2 | **同一工作区打开多个对话 Tab**；切换 Tab 时 UI 显示对应会话的时间线与输入态；关闭 Tab 有明确会话处置策略 | Must |
| S-3 | 工具触发审批；VS Code 弹出审批；允许/拒绝后继续或 fail-closed | Must |
| S-4 | 模型提问；VS Code 弹出提问；答案回传后继续 | Must |
| S-5 | Host bridge 不可用/超时 → fail-closed，不静默放行 | Must |
| S-6 | 权限 UI 切换 `permission-presets` | Must |
| S-7 | 写文件后事后 Diff/SCM 审阅 | Must |
| S-8 | 审批弹窗与「当前活动 Tab / 对应 session」可关联，避免串台 | Must |
| S-9 | 替换 Host bridge 传输或 UI 策略（同一契约） | Should |
| S-10 | subagent 通知出现在时间线 | Should |
| S-11 | Spec 面板 / hooks 策略包 | Out → 后续 feature |
| S-12 | 非程序员全自动模式 | Could / Out |

## 预期范围

### In Scope（Must）

- VS Code Extension：**一个窗口壳**；保留原生编辑器；不以 TUI 为主交互。
- **多对话 Tab**：同一工程下多会话并行展示与切换；每个 Tab 绑定明确的 `sessionId`（或等价会话句柄）。
- Agent 后端 = DSH；扩展只做驱动、观察、交互应答与 UI 投影。
- **双通道**：
  - **SDK stdio**：`initialize` / `session/prompt` / `shutdown`；订阅事件 → 当前 Tab 时间线。
  - **Host bridge IPC（非 stdout）**：`approval/request` / `user-questions/request` answerer → VS Code UI → 类型化合规结局；fail-closed。
- **ide profile**：`dsh-base` + `sdk-app` + `ide-bridge`；stdout 独占 JSON-RPC；不与 Web `ui-approval` / `ui-user-questions` 同挂争瀑布。
- **permission-presets** UI（调用 Host 既有能力）。
- **事后 Diff**（tool 事件和/或 git）；默认非执行中逐步确认。
- 启动/生命周期、失败与超时、依赖边界文档化。
- 可定制边界（本版）：UI 策略、传输适配、auto-allow **可替换**；不改 `agent-loop`。

### In Scope（Should）

- 时间线 subagent 层级。
- Host bridge / UI 替换契约与至少一个替换证明。
- 时间线写文件条目跳转 Diff。
- Tab 关闭时：结束会话 / 仅卸 UI 保留可恢复会话——策略文档化并实现一种默认。

### In Scope（Could）

- 执行中写前确认（非默认）。
- 多根工作区增强。
- Tab 拖拽排序、固定、重命名等体验增强。

### Out of Scope（本 feature；留给后续 feature / DSH 侧）

- **Spec 驱动流程面板**（投影 `.specdev/`、推进 HG 等）——用户确认将通过其他 feature 扩展，大概率不在本插件深做。
- **可组合 hooks 策略包**（路径 deny / 强制 ask 等作为可发布策略产品）——同上；本版不把 hooks 包当 Must。既有 DSH `tools/pre-execute` / approval 语义仍由 runtime 自身与 bridge 承接，但不在本插件交付「策略包框架」。
- 复刻 Cursor Tab 补全 / 完整 Cursor 产品。
- Fork Code-OSS；以 ACP 为完整 IDE 主协议；扩展内重写 agent-loop。
- 把 Spec 塞进 SDK；在 stdout 混入审批 RPC；与 Web 终端应答双挂。
- 非程序员全自动模式（无 Diff、无审批）作为 Must。

## 功能区域

### F1. 启动与生命周期

- Extension 启动 `dsh --profile <ide>`（或等价名）；`initialize` 成功前拒 prompt。
- `shutdown` 与异常回收；stdout 仅 JSON-RPC。

### F2. 多对话 Tab（窗口核心）

- 同一工作区可创建多个对话 Tab。
- 每个 Tab 绑定独立会话身份；切换 Tab 切换可见时间线与输入目标。
- 新建 / 关闭 / 切换行为有明确默认；审批 UI 与触发会话可关联（防串台）。

### F3. SDK 观察与驱动

- 按 **当前 Tab 的 session** 调用 `session/prompt`；订阅并投影 `session.event` / `session.status`。
- 时间线：turn / step / tool / assistant。

### F4. Host bridge（审批 / 提问）

- `ide-bridge` 注册终端 answerer；非 stdout IPC；fail-closed。
- 请求路由到正确会话对应的 UI 上下文（与活动 Tab 一致或可指示）。

### F5. 权限档位

- UI 调用 `permission-presets`；不平行发明权限语义。

### F6. Diff 审阅

- 事后 Diff/SCM；可选从时间线跳转。

### F7. 可替换性（窗口相关）

- 更换 UI / 传输 / auto-allow 不改 `agent-loop`。
- **不**把 Spec/hooks 产品包列为可替换交付物（后续 feature）。

## 验收标准（EARS）

优先级：`[Must]` / `[Should]` / `[Could]`。

### A. 启动与生命周期

**AC-1:** `[Must]` **事件驱动型** — **当** 开发者从扩展发起启动会话 **时**，系统 **必须** 以 `ide` profile（`dsh-base` + `sdk-app` + `ide-bridge`）启动 DSH 子进程，并完成 SDK `initialize` 后才接受 `session/prompt`。

**AC-2:** `[Must]` **普遍型** — 系统 **必须** 保证 ide profile 下 stdout 仅承载 newline-delimited JSON-RPC；诊断 **必须不** 写入 stdout。

**AC-3:** `[Must]` **事件驱动型** — **当** 开发者关闭会话宿主或卸载扩展 **时**，系统 **必须** 有序 `shutdown`、回收子进程，并更新 UI。

**AC-4:** `[Must]` **不期望行为型** — **如果** 握手前崩溃或 `initialize` 失败，**那么** 系统 **必须** 展示可诊断错误，**必须不** 呈现「已连接」假象。

**AC-5:** `[Must]` **不期望行为型** — **如果** ide profile 与 Web `ui-approval` / `ui-user-questions` 终端应答同挂争瀑布终点，**那么** 系统 **必须** 在组合/启动校验失败并明确报错，**必须不** 静默双挂。

### B. 多对话 Tab

**AC-6:** `[Must]` **事件驱动型** — **当** 开发者在同一工作区请求「新建对话」**时**，系统 **必须** 新增一个 Tab，并为其分配可区分的会话身份（新 `sessionId` 或文档化的等价句柄）。

**AC-7:** `[Must]` **事件驱动型** — **当** 开发者切换活动 Tab **时**，系统 **必须** 将输入目标与时间线投影切换到该 Tab 绑定的会话，**必须不** 把用户输入发到错误会话。

**AC-8:** `[Must]` **事件驱动型** — **当** 开发者关闭某一 Tab **时**，系统 **必须** 按文档化的默认策略处置该会话（例如结束会话，或保留可恢复会话仅卸 UI），并更新 Tab 栏。

**AC-9:** `[Must]` **普遍型** — 系统 **必须** 支持在同一工作区同时存在不少于两个对话 Tab（创建与切换可验证）。

**AC-10:** `[Must]` **状态驱动型** — **在** 某会话触发审批或提问 **时**，UI **必须** 能将该交互关联到正确的会话/Tab（例如自动聚焦对应 Tab 或明确标注会话），**必须不** 在无提示下把应答记到错误会话。

**AC-11:** `[Should]` **可选功能型** — **若** 实现提供 Tab 标题，系统 **应该** 允许使用会话标题或首条用户消息摘要作为默认标题。

### C. SDK 观察与驱动

**AC-12:** `[Must]` **事件驱动型** — **当** 开发者在活动 Tab 提交任务 **时**，扩展 **必须** 对该 Tab 的 `sessionId` 调用 `session/prompt`，并获得含 `messageId` 的入队回执。

**AC-13:** `[Must]` **事件驱动型** — **当** 运行时发出该会话的 `session.event` 或 `session.status` **时**，活动（或对应）Tab 的时间线 **必须** 更新 turn / step / tool / assistant 进度。

**AC-14:** `[Should]` **事件驱动型** — **当** 发出 subagent 启动/结束相关通知 **时**，时间线 **应该** 以可区分层级或标注展示。

**AC-15:** `[Must]` **普遍型** — 扩展 **必须不** 在 VS Code 进程内重实现 `agent-loop`、工具执行管线或会话持久化权威源。

### D. Host bridge — 审批与提问

**AC-16:** `[Must]` **事件驱动型** — **当** DSH 发出需人类应答的 `approval/request` **时**，Host bridge **必须** 在 VS Code 展示审批，并将选择映射为合法 `ApprovalOutcome` 回传。

**AC-17:** `[Must]` **事件驱动型** — **当** DSH 发出 `user-questions/request` **时**，Host bridge **必须** 展示提问，并将回答映射为合法 `AskUserQuestionAnswer` 回传。

**AC-18:** `[Must]` **普遍型** — Host bridge **必须** 使用非 stdout 通道，**必须不** 侵占 SDK JSON-RPC stdout。

**AC-19:** `[Must]` **不期望行为型** — **如果** bridge 未连接、超时、抛错或非法结局，**那么** 路径 **必须** fail-closed，**必须不** 静默放行。

**AC-20:** `[Must]` **状态驱动型** — **在** 等待人类应答期间，工具调用 **必须** 保持在既有 DSH waterfall 契约内阻塞，直至合法结局或 fail-closed。

### E. 权限档位

**AC-21:** `[Must]` **事件驱动型** — **当** 开发者选择某一 `permission-presets` 档位 **时**，系统 **必须** 经 Host 应用该档位，使后续沙箱与审批策略与 preset 一致。

**AC-22:** `[Must]` **普遍型** — 扩展 **必须不** 引入与 `dsh-permission-presets` 冲突的第二套权限权威源。

### F. Diff 审阅

**AC-23:** `[Must]` **事件驱动型** — **当** 会话中工具产生工作区文件改动 **时**，系统 **必须** 提供事后 Diff 审阅入口（tool 事件和/或 git）。

**AC-24:** `[Must]` **普遍型** — 默认行为 **必须** 是事后 Diff；**必须不** 将执行中逐文件确认设为默认必选。

**AC-25:** `[Should]` **事件驱动型** — **当** 开发者从时间线写文件类条目跳转 **时**，系统 **应该** 打开对应 Diff 或编辑器视图。

**AC-26:** `[Could]` **可选功能型** — **若** 显式启用执行中确认，系统 **必须** 在写前请求确认；未启用则 **必须不** 强制。

### G. 可替换性与依赖边界

**AC-27:** `[Must]` **普遍型** — 更换 UI 策略、Host bridge 传输适配器或 auto-allow 策略 **必须不** 要求修改 `packages/core` 中 `agent-loop`。

**AC-28:** `[Must]` **普遍型** — 实现 **必须** 复用既有 DSH 包边界；新行为优先落在 `ide-bridge` / VS Code Extension。

**AC-29:** `[Should]` **普遍型** — 系统 **应该** 文档化 Host bridge 与 UI 的替换契约，并有至少一个可验证替换路径。

### H. 失败、超时与安全

**AC-30:** `[Must]` **不期望行为型** — **如果** SDK 传输关闭或子进程异常退出，**那么** 扩展 **必须** 终止 UI 等待、展示错误态，并对未结算审批/提问 fail-closed。

**AC-31:** `[Must]` **普遍型** — 系统 **必须** 校验 Host bridge 入站载荷等外部输入；非法输入不得导致未定义放行（Constitution §3.1）。

**AC-32:** `[Must]` **普遍型** — 系统 **必须不** 将密钥明文写入扩展日志、spec 或提交物（Constitution §3.2）。

**AC-33:** `[Must]` **状态驱动型** — **在** 每个交付 Phase 的验证中，**必须** 至少包含 1 个真实组件集成测试与 1 个独立 e2e 场景（Constitution §1.2–§1.3）。

## 不在范围内（明确排除）

1. 本版 **Spec 流程面板** / Spec 状态写入 / Spec→SDK 协议化（后续 feature；可能在 DSH 或其他形态）。
2. 本版 **可发布 hooks 策略包框架**（路径策略产品化等；后续 feature；可能在 DSH）。
3. 复刻 Cursor 补全 Tab / 完整 Cursor 产品。
4. Fork Code-OSS；以 ACP 为 IDE 主协议；扩展内重写 agent-loop。
5. 默认执行中逐文件确认；非程序员全自动模式作为 Must。
6. 与 Web 终端应答双挂；stdout 混入审批 RPC。
7. 以 TUI 取代 VS Code 编辑器作为主编码表面。

## 约束

### 项目宪法

- 遵守 `.specdev/specs/vscode-dsh-ide/constitution.md`。
- 空壳公开 API、跳过集成/e2e、明文密钥 → 与 Constitution 冲突。

### 架构与仓库约束

- Agent 后端 = DSH；扩展 = 窗口 Host + 投影。
- `ide` profile：`dsh-base` + `sdk-app` + `ide-bridge`；stdout 独占 JSON-RPC。
- 审批/提问复用 `dsh-user-approval`、`dsh-user-questions`；结局为 `ApprovalOutcome` / `AskUserQuestionAnswer`。
- 权限复用 `dsh-permission-presets`。
- 应用启动遵守「仅 `dsh` profiles 启动受支持 Node 应用」。
- 本需求 **不** 授权修改 agent-loop；**不** 要求本插件交付 Spec/hooks 产品包。

### 依赖边界

| 区域 | 依赖（复用） | 本方案拥有 | 禁止 |
|------|--------------|------------|------|
| 循环 / Agent | `dsh-agent` / `dsh-agent-loop` | 无 | 分叉循环 |
| 会话事件 | `dsh-session` + SDK `session.event` | 时间线投影 | 另立权威日志 |
| SDK | `dsh-sdk-*` | Extension 客户端 | stdout 加审批 RPC |
| 审批 / 提问 | `dsh-user-approval` / `dsh-user-questions` | bridge + VS Code UI | 绕过 fail-closed |
| 权限 | `dsh-permission-presets` | 档位 UI | 第二套语义 |
| 多会话 UI | （新）Extension Tab 模型 | Tab↔session 绑定 | 单会话硬编码死 |
| Spec / hooks 产品 | — | **本版不拥有** | 强行塞进本插件 Must |
| Web UI 应答 | `ui-approval` 等 | 不作为 ide 默认终端 | 双挂 |
| 桥接 | （新）`ide-bridge` | IPC + answerer | 污染 sdk stdout |

## 开放问题

**Q-1:** `ide` profile / `ide-bridge` 的最终命名与是否进官方包树，还是工作区/私有包？

**Q-2:** Host bridge IPC 机制偏好（留给 HG-2 亦可）？

**Q-3:** 关闭 Tab 的默认策略：销毁 DSH 会话 vs 仅卸 UI、会话可恢复？

> 未决前：Q-2 默认可由 HG-2 选定任一本机非 stdout IPC；Q-3 默认可先实现「关闭 Tab 结束对应会话」，并在设计中保留可恢复策略为 Should/后续。

## 风险/假设

| ID | 类型 | 内容 |
|----|------|------|
| A-1 | 假设 | 多会话由 SDK 多 `sessionId`（或 runtime 多 agent）支撑；扩展负责 Tab 映射。 |
| A-2 | 假设 | Spec/hooks 深扩展不在本插件；本版不做其 Must UI。 |
| A-3 | 假设 | 审批 waterfall 仍为进程内 answerer；bridge 只做终端应答。 |
| R-1 | 风险 | 多 Tab 下审批串台；需 AC-10。 |
| R-2 | 风险 | 单 DSH 进程多会话的资源与取消边界需在设计中写清。 |
| R-3 | 风险 | bridge 与 SDK 生命周期不同步 → 超时 fail-closed。 |
| R-4 | 风险 | 误挂 Web ui-approval → 启动互斥（AC-5）。 |

## 建议的 Phase 拆分方向

> 正式 DAG 由 plan-generator 产出。

1. **Profile + 双通道骨架 + 生命周期**（含与 Web 应答互斥）。
2. **多对话 Tab + session 绑定**（窗口核心）。
3. **交互闭环**：审批 + 提问 + 会话关联 + fail-closed；permission UI。
4. **当前 Tab 时间线 + 事后 Diff**。
5. **可替换性文档/轻量证明**（传输或 UI 适配面）。

**不**将 Spec 面板、hooks 策略包列入本 feature 的 Phase Must。

---

## 追溯

| 用户共识要点 | 覆盖 |
|--------------|------|
| 本 feature = 一个窗口 | 产品目标、F2、范围 |
| 多对话 Tab（同工程） | S-2、AC-6–11 |
| 保留 IDE + Diff | F6、AC-23–25 |
| DSH 后端、双通道、bridge | F3–F4、AC-12–20 |
| Spec / hooks 后续扩展、不大概率在本插件 | Out #1–2、目标终态 |
| 可定制（窗口相关） | AC-27–29 |
| 非 Cursor 黑盒复刻 | Out #3 |

**Constitution 冲突检查：** 与 §1–§6 无直接冲突。修订后 Spec/hooks 从 Must 降为 Out，不削弱集成/e2e 要求（AC-33）。
