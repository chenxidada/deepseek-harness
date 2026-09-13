# Requirements: vscode-dsh-chat-ready

<!--
  slug: vscode-dsh-chat-ready
  audience: plan-generator / implementer / reviewer / verifier / HG-1
  language: zh (mirror of requirements.md)
  constitution: .specdev/specs/vscode-dsh-chat-ready/constitution.md
  prior-feature: vscode-dsh-conversation-ui (behavior delivered; productization deferred)
  product intent locked: 2026-09-08 — 「点开即可聊」；revised: 2026-09-08 R4 — 删除类离线边界；AC-7 反向 L2；新建等待 Start 态；手动 New 复用空 Tab；活动栏/视图术语；自动恢复不打未读注释
-->

## 术语（全文统一）

| 术语 | 含义 | 首次括注 |
|------|------|----------|
| **Host** | IDE Session Host（`dsh.startSession` 所启动的连接面） | — |
| **自动建连** | 开发者打开 DeepSeek 活动栏 / Conversation 相关视图 / 执行 DSH 会话命令 / 点击状态栏项时，在具备凭据时自动 Start Host；**不**在 `onStartupFinished` 仅因激活而 Start | auto-start Host |
| **自动就绪** | Conversation 视图可见且 Host 就绪后：有未关 Tab 则 restore（活动优先、保持回放）；否则自动 New → live | auto-ready input surface |
| **错误展示载体** | Conversation 面板内错误/连接态为主；面板未打开时用状态栏可点击项引导打开面板 | error surface |
| **活动栏 / Conversation 视图** | DeepSeek Harness **活动栏容器**打开后可含多个视图（至少 Conversation 主聊天面板、History，以及既有 Timeline 等）。「Conversation 视图可见」**仅**指 Conversation（`dsh.chat`）WebviewView 已创建且可见，**不是** History/Timeline 可见，也不是「活动栏已点开」的同义词 | activity bar vs Conversation view |
| **Chat UI 底盘** | 一版可用级 Conversation 呈现（主题变量、气泡分层、底栏输入、空态/连接态、Markdown 最小集、侧栏 IA），非 Cursor 全量对标 | usable chat chassis |
| **权威会话日志** | DSH 侧会话正文与可回放历史的唯一权威源（继承前序） | authoritative session log |
| **扩展索引** | 扩展本地维护的工作区会话元数据、未关 Tab 集、活动 Tab、UI 偏好等（继承前序） | extension index |
| **live / 回放视图** | 可发送 prompt 的交互上下文 / 从权威日志重建的只读呈现（继承前序） | — |
| **未关 Tab 集合** | 扩展索引中尚未关闭的 Conversation Tab 身份集合（继承前序） | open-tab set |
| **L1 / L2 / L3 / L4** | 与前序相同的验证层级：库测 / Extension Host 可脚本 / Webview 契约 / 人工辅助；真渲染 L4 **不得**作为产品 Phase 主证据 | verification levels |

下文优先使用上表中文术语。前序 `vscode-dsh-conversation-ui` 已交付的 Must 行为（极薄状态机、关 Tab 可恢复、历史回放、Continue、Subagent 等）视为本 Feature 的**基线能力**，本文件只新增「点开即可聊」相关验收，**不**重写 agent-loop / 双通道权威。

## 产品目标

在已交付的 `vscode-dsh-conversation-ui`（极薄对话面板 + 可恢复留存 + 历史回放 + Continue + Subagent）之上，交付开发者**点开即可聊**的体验：打开 DeepSeek 活动栏 / Conversation 视图 / 执行 DSH 会话命令 / 点击状态栏项时 **自动 Start Host**（`onStartupFinished` **仅注册**，不自动 Start）；**Conversation 视图可见**时再 **自动就绪**（restore 保持回放，或自动 New → live）；补齐 **可用级 Chat UI 底盘**；顶栏常驻「新建会话」按钮。**不做**完整对标 Cursor；键盘快捷键非 Must。

## 问题陈述

前序 Feature 已按规格交付可测的会话/聊天**行为面**，但产品反馈与交付总结明确指出：链路通了，仍不够「点开即用」。

| 表面 | 现状（前序交付） | 本 Feature 要解决 |
|------|------------------|-------------------|
| Host 生命周期 | 需命令面板 `DeepSeek Harness: Start IDE Session` | **Must**：打开活动栏/视图/DSH 命令/状态栏 → 自动 Start；**禁止** startup 仅因激活而 Start；失败可操作（面板+状态栏） |
| 输入面就绪 | 连上后常需再执行 `New Conversation`；恢复依赖手动编排感知 | **Must**：Conversation **视图首次可见**时自动 restore（有未关 Tab，保持回放）或自动 New → live；仅激活未开视图时**不**自动 New |
| 幂等 | 重复打开可能叠 Host / 叠空 Tab（产品风险） | **Must**：重复打开不叠多个 Host、不叠空 Tab |
| Conversation 观感 | 极薄 HTML：裸灰框、弱对比、原生感 | **Must**：跟 `--vscode-*` 的视觉基线 + 气泡分层 + 可用底栏 |
| 输入习惯 | 发送手势未产品化约定 | **Must**：Enter 发送 / Shift+Enter 换行（可文档化等价） |
| 空态 / 连接态 | 「Waiting for Host / No active conversation」弱、Discoverability 差 | **Must**：Connecting / 失败重试（缺凭据含设置直达）/ 顶栏「新建会话」常驻 |
| Markdown | 规格内 Could；未产品化 | **Must**：标题、列表、代码块（等宽 + 复制）；失败回退纯文本 |
| 侧栏 IA | Conversations/History 空态易露命令标题堆砌 | **Must**：Conversations 可读；空 live Tab 显示「新对话」；History **不**展示空 Tab；去命令标题堆砌 |
| 一键新建 | 已有 `dsh.newConversation` 命令；对话面缺少常驻新建入口 | **Must**：Conversation 界面常驻「新建会话」按钮；点击后未连则先 Start 再新建并聚焦可输入 live；键盘 `keybindings` **非 Must** |

本 Feature **明确不**把「完整对标 Cursor」列为目标；UI 变厚是**呈现**，不是 Webview 自持 mode/session（继承 AD-CU-1 精神）。

## 目标终态

开发者在同一 VS Code 窗口 / 当前工作区中：

- **`onStartupFinished` 仅注册命令与视图，必须不自动 Start。** 自动 Start 仅当：打开 DeepSeek 活动栏、Conversation 相关视图变为可见、执行 DSH 会话相关命令、或点击状态栏 DSH 项（有凭据则连）。**必须不**因「扩展已激活但用户未打开侧栏」而 Start。
- 若 Start 失败（含缺凭据）：**必须不**在启动瞬间弹阻塞式 Toast 作为唯一提示。错误主载体为 Conversation **面板内**；若面板未打开，**状态栏**显示可点击项（如「DSH: Host 未连接」），点击后打开面板展示详情（可读原因 + 重试 + 缺凭据时设置直达）。
- **自动就绪触发点 = Conversation 视图可见**（与 Host 就绪同时满足）：有未关 Tab → restore（活动优先），**保持回放、不自动 Continue、不产生未读点**；无未关 Tab → 自动 New → live（亦不因自动创建产生未读点）。
- **空 Tab 规则**：自动 New 产生的空 live Tab（从未成功发送 prompt）**必须不**写入持久化 `openTabSet`；重启后**必须不**恢复该空会话；面板侧仍保证可聊（视图打开时可再次自动 New 或复用当前空 Tab）。
- **幂等**：重复打开 / 重复自动建连 **必须不** 叠 Host、**必须不** 叠空 Tab。
- **无工作区**（空窗口/单文件）：自动 Start 仍可执行；索引不可用时自动就绪降级为「直接 New → live」；**必须不**因无工作区禁用自动 Start。
- **Host 运行中断线**（非用户主动 Stop）：展示断开态并**自动重试至多一次**；再次失败则错误 + 手动重试，**必须不**无限重连。
- Conversation **可用级 Chat UI 底盘** + 顶栏常驻「新建会话」按钮；**Conversations** 对空 live Tab 显示「新对话」；**History 必须不**列出空 Tab；空态**必须不**堆砌命令标题；主题切换后面板须刷新主题令牌。
- 自动建连 / 自动就绪 / 面板新建均可在 **L2** 脚本验证；B1–B3 视觉以 **L2/L3 为主 + L4 截图辅助**；**L4 不得**作为唯一达标证据。
- **继承**前序 Must；**不**改 agent-loop / 双通道；**不**交付 Cursor 全量等 Out 项；键盘 `keybindings` **非 Must**。

## 目标用户

| Actor | 角色 | 关键需求 |
|-------|------|----------|
| **开发者本人（主 Actor）** | 在 VS Code 用 DSH 改代码 | 点开侧栏即可聊；少记 Start → New 两步；可读可用的 Chat 面板 |
| **扩展/脚本作者** | 自动化或测试驱动 | L2 钩子/命令可验证自动建连与新建；既有 `dsh.test.*` 风格可延续 |
| **非 Cursor 全量对标用户** | 期望「能用」而非「像素级对标」 | 本版交付底盘即可；Composer/@/附件等 Out |

## 核心场景

| ID | 场景 | 优先级 |
|----|------|:------:|
| S-1 | 打开活动栏/视图/DSH 命令/状态栏 → 有凭据则自动 Start；startup 仅激活不 Start | Must |
| S-2 | Start 失败 → 面板内错误（未开面板则状态栏可点打开）；缺凭据含设置直达；不静默 | Must |
| S-3 | Conversation 视图可见且有未关 Tab → restore（活动优先）；保持回放；不自动 Continue；不打未读 | Must |
| S-4 | Conversation 视图可见且无未关 Tab → 自动 New → live；不打未读 | Must |
| S-5 | 重复打开 / 重复自动建连 → 不叠 Host、不叠空 Tab | Must |
| S-5a | 自动 New 的空 Tab 不入持久化 openTabSet；重启不恢复该空会话 | Must |
| S-5b | 无工作区：仍可自动 Start；就绪降级为直接 New → live | Must |
| S-5c | Host 非主动断线：自动重试至多一次，失败后手动重试 | Must |
| S-6 | Conversation 面板跟 VS Code 主题变量，去掉裸灰框感 | Must |
| S-7 | user/assistant 气泡可区分；生成中指示可见 | Must |
| S-8 | 固定底栏；Send 对比度正常；Enter 发送 / Shift+Enter 换行 | Must |
| S-9 | 面板内可见 Connecting / 失败重试 /「新建对话」 | Must |
| S-10 | Markdown：标题、列表、代码块（等宽+复制）；渲染失败回退纯文本 | Must |
| S-11 | Conversations 可读；空 live Tab 显示「新对话」；去掉命令标题堆砌 | Must |
| S-12 | History 不展示空 Tab；历史行点击 → 回放（继承前序） | Must |
| S-12a | Markdown 安全渲染（转义 HTML、不执行脚本、不加载外链） | Must |
| S-12b | 主题切换后面板刷新 CSS 变量，不残留旧主题导致不可读 | Must |
| S-13 | Conversation 界面「新建会话」按钮；未连则先 Start 再 New；聚焦面板 → live | Must |
| S-14 | L2：自动 Start + 自动就绪可脚本验证；命令 id → Tab +1 且 panel live | Must |
| S-15 | Continue/灰态旁短说明 | Should |
| S-15a | 键盘辅入口新建会话（不替代顶栏按钮） | Should |
| S-16 | 「本回合改了 N 个文件」简单入口 | Should |
| S-17 | 代码块语言标签 | Should |
| S-18 | 非活动 Tab 未读点更明显 | Should |
| S-19 | 表格 / 链接预览 Markdown 增强 | Could / Should（**非 Must**） |
| S-20 | Cursor 全量；token 打字机；工具富卡片；Timeline 定位；Webview 审批；改 agent-loop；关 Tab 后台跑完；多窗口协调；Remote 专项；草稿持久化；虚拟滚动；剪贴板全矩阵 | **Out** |

## 预期范围

### In Scope（Must）

#### A. 生命周期：自动建连 / 恢复 / 新建

- **Start 触发（收紧）**：`onStartupFinished` **仅注册**命令与视图，**必须不**自动 Start。自动 Start 仅当：（1）打开 DeepSeek 活动栏容器；（2）Conversation 相关视图变为可见；（3）执行 DSH 会话相关命令（如 start/new/prompt 等文档化集合）；（4）点击状态栏 DSH 项。已连接则复用。
- **就绪与 Start 解耦**：未打开 Conversation 视图时，即使用户已触发 Start，也 **必须不** 自动 restore/New。**自动就绪**仅在 Conversation 视图**可见**且 Host 就绪时执行。
- **失败展示载体**：主载体为 Conversation **面板内**；面板未打开时用**状态栏可点击项**（点击执行文档化命令如 `dsh.showPanel` 打开面板并展示详情）；**必须不**以启动瞬间阻塞 Toast 作为唯一提示。缺凭据时含设置直达。L2 可模拟有/无凭据。
- **自动就绪**：有未关 Tab → restore（活动优先），**保持回放、不自动 Continue、不产生未读点**；无 → 自动 New → live（亦不因自动创建产生未读）。
- **空 Tab**：自动 New 空 Tab **不**入 `openTabSet`；重启不恢复；与前序一致。
- **无工作区**：Start 仍可执行；就绪降级直接 New → live，**不**执行 restore。
- **断线状态机**：running → crashed/disconnected → **自动 retry-once** → 仍失败则 error + manual-retry；禁止无限重连。
- **幂等**：不叠 Host、不叠空 Tab。
- **L2**：Start 触发 + 视图可见就绪可脚本验证；B3/B5 须有可脚本驱动面（keydown/composer 或测试钩子），细节由 phase spec 写明。

#### B. Chat UI 底盘（「部分优化」，非 Cursor 全量）

- **B1** Conversation 面板视觉基线：使用 VS Code 主题 CSS 变量（`--vscode-*`），统一间距/字号/边框，去掉裸灰框感；**必须**在主题变更时刷新令牌，切换后不残留旧主题导致不可读。
- **B2** 消息气泡分层：user / assistant 视觉区分；生成中指示可见（允许「生成中…」，**不**要求 token 打字机）。
- **B3** 输入区：固定底栏；Send 对比度正常；**Enter 发送 / Shift+Enter 换行**（可文档化等价键位，默认倾向 Enter 发送）。
- **B4** 空态/连接态：Connecting、失败重试、「新建对话」在面板内可见。
- **B5** Markdown 最小集：标题、列表、**代码块**（等宽 + 复制）；失败回退纯文本；表格/链接预览非 Must。**安全**：默认转义 HTML、不执行内联脚本、不加载外部资源；回退纯文本亦须安全。复制经扩展侧剪贴板命令（可脚本断言动作成功；系统剪贴板读取用 L4 辅助）。
- **B6** 侧栏 IA：Conversations 可读；空 live Tab 显示「新对话」；**History 必须不**展示空 Tab；去掉命令标题堆砌；History 非空行点开回放。
- **视觉验收**：B1/B2/B3 以 L2/L3 + L4 截图辅助；不要求像素级色值断言。

#### C. 对话界面「新建会话」按钮（非键盘快捷键）

- Conversation 面板 **顶栏/chrome 常驻**「新建会话」按钮（与 Continue 等同排为默认；允许窄栏下缩短文案，但 **必须** 可发现）：在 live、回放、空态、连接中等常见状态下 **必须** 可见可点（连接失败态可保留，Start 失败遵循 AC-2）。**已锁定**：不以图标-only 或仅侧栏标题旁入口替代顶栏主按钮。
- 点击该按钮 **必须** 走与 `dsh.newConversation` 等价的新建路径；**当** Host 未连 **时**，**必须先**自动 Start，再 New Conversation，聚焦 Conversation 面板，进入可输入 live。
- 既有命令 `dsh.newConversation` **必须** 保留为等价后端入口（命令面板 / L2 钩子可调用）；产品主入口是 **面板按钮**，不是 `contributes.keybindings`。
- **系统键盘快捷键（`keybindings`）不是 Must**；若后续加快捷键，不得替代或削弱面板按钮。
- **L2**：可通过按钮协议消息（如 `action/new-conversation`）或等价 command id 验证 Tab +1（或 AC-6 幂等）且 panel live。

#### 继承与边界（Must）

- 继承前序 `vscode-dsh-conversation-ui` 已验收 Must 行为面；本 Feature **必须不** 回退关 Tab 可恢复、历史回放、Continue、Subagent 等已交付能力。
- 保持 Host 权威 / 极薄状态机（AD-CU-1 精神）：UI 变厚限于呈现；**必须不** 在 Webview 自持 mode/session 权威。
- **必须不** 修改 `packages/core/agent-loop`；**必须不** 重做双通道权威。

### In Scope（Should）

- Continue / 灰态旁短说明（为何不可点）。
- 简单「本回合改了 N 个文件」入口（可链到既有 Timeline/Diff）。
- 代码块语言标签显示。
- 非活动 Tab 未读点更明显（相对前序基线增强，不改变未读语义）。
- Markdown 表格或链接预览（增强可读性；失败仍回退纯文本）。
- **新建会话键盘辅入口**（`contributes.keybindings` 或等价）：**必须不**替代面板顶栏按钮；行为与 `dsh.newConversation` 等价（见 AC-34）。

### In Scope（Could）

- 更接近 Cursor 的间距密度、字体阶梯、动画微交互（仍非全量对标清单）。
- 主题切换瞬间的闪烁抑制等抛光项。

### Out of Scope（本 Feature）

- **完整对标 Cursor**（Composer 多栏、@引用、附件、斜杠命令生态等）。
- **Token 级流式打字机**（允许「生成中…」指示；完整消息追加仍可继承前序 MVP）。
- **工具调用富卡片** / 内嵌 Diff 编辑器。
- **Timeline 点击定位消息**（前序 Should；本版不升为 Must）。
- **Webview 重做审批表单**（审批仍走既有 InteractionUi）。
- **改 agent-loop / 双通道权威**。
- **关 Tab 后台跑完**（前序 Out，继续排除）。
- 非当前工作区跨仓会话、非程序员模式简化交互产品化。

### 相对前序 `vscode-dsh-conversation-ui` 的增量

| 项 | 前序 | 本 Feature |
|----|------|------------|
| Start Host | 手动命令 | **自动建连**（失败可操作） |
| 连上后首屏 | 常需再 New Conversation | **自动 restore 或自动 New** → live |
| UI | 极薄可测壳 | **可用级底盘**（B1–B6） |
| Markdown | Could | **Must 最小集** |
| 一键新建 | 命令存在、界面入口弱 | **Must：对话界面常驻「新建会话」按钮 + 未连先 Start**；键盘快捷键非 Must |
| Cursor 全量 | Out / Could | **仍 Out** |

## 功能区域

### F1. 自动建连与失败态

- Start 触发：活动栏 / Conversation 视图 / DSH **启动·发送类**命令 / 状态栏；**非** startup 仅激活。
- **会话相关命令最小边界**（自动 Start）：至少包括 `dsh.startSession`、`dsh.newConversation`、`dsh.promptActiveConversation` 及文档化的其它启动/发送类命令；**查询/浏览/删除类**（如仅打开历史列表、`dsh.deleteConversation` / `dsh.deleteHistory`）**必须不**仅因此触发完整自动建连。精确清单由 design 在 phase-1 文档化。
- **删除/查询类 × Host 离线**：若某删除/查询类命令在无 Host 时无法完成其功能（例如需 bridge `session/dispose`），则 Host 离线时 **必须** 给出明确不可用提示或文档化降级（如仅清本地索引视图），**必须不** 以此为由拉起完整自动建连；与 AC-22「新建未连先 Start」区分（新建属启动/发送类）。
- **start-reason 状态机**：自动 Start 须为可测纯逻辑状态机（L1 可测）：首个 reason 进入 `starting`；后续 reason 入 `pending-start`；在 `started`/`failed` 时统一结算；禁止并行飞两条互踩的 Start。单窗口单例 Host 不变。
- **Activity Bar 与 Conversation 非首视图**：若点击活动栏时 Conversation WebviewView 尚未创建/可见，扩展 **必须** 主动 reveal Conversation（或文档化等价），使「点开侧栏即可聊」成立（见 A-6 / AC-1b）。
- 失败载体：面板内为主；未开面板 → 状态栏可点（`dsh.showPanel`）；缺凭据「设置直达」= 打开本扩展 VS Code 设置页（`workbench.action.openSettings` + 扩展配置前缀）或文档化等价命令。
- 断线：running → crashed → retry-once → error+manual-retry。
- 无工作区：仍可 Start；幂等不叠 Host。

### F2. 自动就绪（restore / New Conversation）

- **触发**：Conversation 视图可见 + Host 就绪。
- restore 保持回放、不自动 Continue、**不打未读**（自动恢复=回到现场，等同用户已打开该 Tab，不因恢复前后增量消息补打未读）；New 亦不打未读。
- 空 Tab 不入 openTabSet；无工作区降级直接 New（不 restore）。
- L2 可脚本验证时序（视图可见与 Host 就绪）。

### F3. Conversation 视觉与气泡

- `--vscode-*` 主题基线；主题变更刷新；user/assistant 分层；生成中指示。

### F4. 输入底栏与键盘手势

- 固定底栏；Send 对比度；Enter 发送 / Shift+Enter 换行。

### F5. 空态 / 连接态 / 面板内新建

- Connecting、失败重试、面板内「新建对话」可见。

### F6. Markdown 最小集

- 标题、列表、代码块；安全渲染；失败回退纯文本。
- 复制走扩展内部命令（如 `dsh.copyToClipboard`）：**本 Feature 不**注册为菜单/用户快捷键主入口；**必须**可被测试进程 `executeCommand` 调用以闭合 AC-17。

### F7. 侧栏 IA（Conversations / History）

- Conversations：标题/摘要；空 live Tab =「新对话」。
- History：**不**列空 Tab；非空行点开回放；去命令标题堆砌。

### F8. 对话界面「新建会话」按钮与等价命令

- 面板顶栏常驻「新建会话」按钮；点击未连先 Start；聚焦面板。
- **空 Tab 复用**：连续多次「新建会话」时，若当前活动 Tab 仍为空（从未成功入队 prompt），**必须**聚焦/复用该空 Tab，**必须不**再叠另一空「新对话」；仅当活动 Tab 已有用户入队内容时才允许再建新 Tab。
- 与 Continue 等同排；**窄栏**下可折叠为溢出菜单（…），但「新建会话」**必须**经一次点击或「一次展开+首项」可达，**必须不**藏在二级菜单深处。
- `dsh.newConversation` 保留为等价后端入口；键盘辅入口为 Should（AC-34），**不得**替代顶栏按钮。
- L2：按钮协议或 command id 证据。

### F9. 继承与回归

- 前序行为面不回退；Host 权威 / 极薄状态机；不改 agent-loop。

## 验收标准（EARS 格式）

优先级：`[Must]` / `[Should]` / `[Could]`。每条可独立判 ✅/❌。  
EARS 模式：普遍型 / 事件驱动型 / 状态驱动型 / 不期望行为型 / 可选功能型。

### A. 自动建连 / 自动就绪 / 幂等

**AC-1:** `[Must]` **事件驱动型** — **当** 开发者打开 DeepSeek Harness 活动栏容器、Conversation 相关视图变为可见、执行文档化的 DSH 会话相关命令、或点击状态栏 DSH 项 **时**，若存在可用凭据，系统 **必须** 自动启动 Host（与 `dsh.startSession` 行为等价）；若 Host 已连接，系统 **必须** 复用已有连接。

**AC-1a:** `[Must]` **不期望行为型** — **如果** 扩展仅因 `onStartupFinished`（或等价）完成激活注册，而开发者尚未打开 DeepSeek 活动栏、Conversation 视图、也未执行 DSH 会话命令或状态栏项，**那么** 系统 **必须不** 自动 Start Host；**必须不** 执行自动 restore/New；**必须不** 抢夺编辑器焦点或后台堆积空 Tab。

**AC-1b:** `[Must]` **事件驱动型** — **当** 开发者打开 DeepSeek 活动栏容器，且 Conversation WebviewView 尚未创建或尚未可见（例如活动栏内其它视图排在前面）**时**，系统 **必须** 主动 reveal Conversation 视图（或文档化等价），使后续自动就绪条件可以达成；**必须不** 在「仅打开活动栏但 Conversation 永不可见」时静默跳过自动就绪。

**AC-1c:** `[Must]` **普遍型** — 自动 Start 的命令触发子集 **必须** 至少覆盖启动/发送类命令（含 `dsh.startSession`、`dsh.newConversation`、`dsh.promptActiveConversation`）；**必须不** 仅因查询/浏览/删除类命令（如仅打开历史、删除会话/历史）而触发完整自动建连。精确清单由 design 文档化。

**AC-1e:** `[Must]` **不期望行为型** — **如果** 用户执行查询/删除类命令且当时 Host 未连接，且该命令功能依赖 Host（如需 `session/dispose`），**那么** 系统 **必须** 展示明确不可用提示或文档化降级行为，**必须不** 因此触发完整自动建连；**必须不** 静默失败。此条与 AC-22（新建未连先 Start）不冲突：新建属启动/发送类。

**AC-1d:** `[Must]` **普遍型** — 自动 Start **必须** 通过可 L1 测试的 start-reason 状态机编排（`idle`/`starting`/`pending-start`/`started`/`failed` 或文档化等价）；并发 reason **必须不** 启动互相踩踏的并行 Start 流程。

**AC-2:** `[Must]` **不期望行为型** — **如果** 自动 Start 因缺凭据、进程失败或其他可检测错误而失败，**那么** 系统 **必须** 提供可感知且可操作的错误态，至少包含：（1）可读原因；（2）重试入口；（3）缺凭据时的设置直达——打开本扩展在 VS Code 设置面板中的配置页（`workbench.action.openSettings` + 扩展配置前缀）或文档化等价命令。错误主展示载体 **必须** 为 Conversation 面板内状态；**如果** 面板当时不可见，**那么** 系统 **必须** 通过状态栏可点击项（或文档化等价）提示，点击后打开面板并展示上述错误详情（命令 id 文档化，例如 `dsh.showPanel`，供 L2 调用）；**必须不** 静默失败；**必须不** 以启动瞬间阻塞 Toast 作为唯一提示。

**AC-3:** `[Must]` **事件驱动型** — **当** Conversation 视图变为可见（或文档化等价），且 Host 已就绪，且扩展索引中存在未关 Tab 集合 **时**，系统 **必须** 执行与前序一致的 restore 编排，且 **必须** 优先恢复/聚焦上次活动 Tab；恢复出的 Tab **必须** 保持回放规则，**必须不** 因自动就绪而自动 Continue/转 live；该次自动恢复 **必须不** 为任何 Tab 产生未读指示。

**AC-4:** `[Must]` **事件驱动型** — **当** Conversation 视图变为可见，且 Host 已就绪，且扩展索引中**不存在**未关 Tab 集合 **时**，系统 **必须** 自动创建新的 Conversation Tab（与 `dsh.newConversation` 等价），使面板进入 **live** 且可提交非空 prompt；该次自动创建 **必须不** 产生未读指示。

**AC-4a:** `[Must]` **不期望行为型** — **如果** 某 Tab **从未成功入队任何 prompt**（空 Tab；发送已入队但尚无助手回复 **不是** 空 Tab），**那么** 该 Tab **必须不** 写入持久化 `openTabSet`；重启恢复 **必须不** 还原该空会话；与前序「空 Tab 不持久化」规则一致。

**AC-4b:** `[Must]` **事件驱动型** — **当** 当前窗口无工作区文件夹（空窗口或单文件模式）且 Conversation 视图可见触发自动就绪 **时**，若扩展索引/未关 Tab 集合不可用，系统 **必须** 降级为直接新建会话并进入 live，**必须不** 执行 restore；**必须不** 因无工作区而跳过或禁用自动 Start（Start 仍受凭据与 AC-2 约束）。

**AC-5:** `[Must]` **不期望行为型** — **如果** 开发者在同一窗口内重复打开侧栏，或重复触发自动建连路径，**那么** 系统 **必须不** 叠出多个并发 Host 进程/连接实例；**必须** 至多保持一条有效 Host 连接（或文档化的单例复用）。

**AC-6:** `[Must]` **不期望行为型** — **如果** 自动就绪路径被重复触发，或用户连续触发「新建会话」（按钮/命令/Should 快捷键），且当前活动 Tab（或已存在可复用空 live Tab）仍为空（从未成功入队 prompt），**那么** 系统 **必须不** 再叠建额外空 Tab；**必须** 聚焦/复用已有空 live Tab。仅当活动 Tab 已有成功入队内容时，新建才允许创建另一 Tab。

**AC-6a:** `[Must]` **事件驱动型** — **当** Host 在运行中因非用户主动 Stop 的原因断开/崩溃 **时**，系统 **必须** 展示断开态并自动重试建连 **至多一次**；**如果** 该次自动重试仍失败，**那么** 系统 **必须** 展示错误与手动重试入口，**必须不** 无限自动重连。

**AC-7:** `[Must]` **普遍型** — 系统 **必须** 提供可在 **L2** 扩展宿主脚本执行的证据，**至少覆盖「Conversation 视图可见」主路径**的完整链路（符合触发条件的 Start → 就绪 → live 或 restore 保持回放）；其余 AC-1 触发入口视为同一 Start 编排的薄调用，可用 **L1 + 命令/注册断言**覆盖，**必须不** 要求每个入口各自一条独立 L2。**此外** L2 **必须** 含一条 **AC-1a 反向用例**：模拟扩展已激活但 Conversation 视图从未打开，断言未产生 Host 进程/连接、未产生新 Tab。并 **必须** 能模拟有/无凭据；**必须** 能调用 `dsh.showPanel`（或等价）断言错误载体；真渲染 **L4** **必须不** 作为该 Must 的唯一达标证据。

**AC-7a:** `[Must]` **普遍型** — 对 B1/B2/B3（主题基线、气泡分层、Send/底栏对比度）类视觉 Must，验收证据链 **必须** 为 **L2/L3 主证据 + L4 截图对照辅助**；评审者可依据默认浅色/深色主题截图判定分层与对比度是否可辨；**必须不** 要求自动化像素级色值断言，也 **必须不** 仅凭人工观感无截图/无 L2 钩子宣称达标。

### B. Chat UI 底盘

**AC-8:** `[Must]` **普遍型** — Conversation 面板样式 **必须** 使用 VS Code 主题相关 CSS 变量（`--vscode-*` 或文档化等价主题令牌）驱动背景/前景/边框/焦点色；**必须不** 以与主题无关的固定「裸灰框」作为默认主视觉。

**AC-8a:** `[Must]` **事件驱动型** — **当** VS Code 活动颜色主题变更（如 `onDidChangeActiveColorTheme` 或文档化等价）**时**，Conversation 面板 **必须** 刷新主题相关样式令牌，使切换后文本/对比度仍可读；**必须不** 长期残留导致不可读的旧主题颜色。

**AC-9:** `[Must]` **普遍型** — Conversation 面板 **必须** 对 user 与 assistant 消息采用可区分的视觉分层（如对齐、背景、标签或等价区分）；评审者在默认主题下 **必须** 能不依赖阅读角色前缀文字即可区分两类气泡（允许同时保留角色标签）。

**AC-10:** `[Must]` **状态驱动型** — **在** 活动 live 会话处于生成助手输出或等价运行中 **期间**，对话面板 **必须** 展示可见的「生成中…」或等价指示；回到空闲或助手完整消息已展示后 **必须** 清除该指示。

**AC-11:** `[Must]` **普遍型** — 对话面板 **必须** 提供固定于面板底部的输入底栏（滚动消息流时底栏保持可用）；Send 控件 **必须** 在默认浅色与深色主题下保持可辨认对比度（不得因过低对比而无法发现）。

**AC-12:** `[Must]` **事件驱动型** — **当** 开发者在 live 输入区按下 Enter（未按 Shift）**时**，系统 **必须** 将当前非空输入作为发送（或文档化的等价默认发送手势）；**当** 按下 Shift+Enter **时**，系统 **必须** 插入换行且 **必须不** 发送。

**AC-13:** `[Must]` **状态驱动型** — **在** Host 连接进行中 **期间**，Conversation 面板（或与其绑定的可见空态区域）**必须** 展示 Connecting（或等价）状态文案/指示。

**AC-14:** `[Must]` **状态驱动型** — **在** Host 连接失败、自动建连失败或断线进入手动重试态 **期间**，Conversation 面板（一旦可见）**必须** 展示失败说明与重试入口；缺凭据时 **必须** 含设置直达（与 AC-2 一致）；面板未可见时 **必须** 满足 AC-2 的状态栏引导。

**AC-15:** `[Must]` **普遍型** — Conversation 面板 **必须** 在顶栏/chrome 提供常驻「新建会话」（或等价）按钮（不仅限于空态）；窄栏下可与 Continue 一并收入溢出菜单，但「新建会话」**必须** 经一次点击或「一次展开+首项」可达；空态可另有引导文案，但 **必须不** 以缺少可达新建入口为合格。按钮激活后行为 **必须** 符合 AC-21～AC-23。

**AC-16:** `[Must]` **事件驱动型** — **当** 投影中的助手（或用户）消息包含 Markdown 标题或列表语法 **时**，面板 **必须** 以可读结构化形式渲染标题与列表；渲染管线 **必须** 采用安全策略（默认转义 HTML、不执行内联脚本、不加载外部资源）；**如果** 渲染失败，**那么** 系统 **必须** 回退为安全纯文本，**必须不** 因渲染错误导致该消息不可读、整面板崩溃或执行不可信脚本。

**AC-16a:** `[Must]` **不期望行为型** — **如果** 消息正文包含可执行 HTML/脚本载荷（测试夹具可注入），**那么** 面板渲染 **必须不** 执行该脚本或加载其外部资源；L2/L3 **必须** 提供至少一条对应否定用例。

**AC-17:** `[Must]` **事件驱动型** — **当** 消息包含 fenced 代码块 **时**，面板 **必须** 以等宽字体展示代码块内容，并提供可激活的「复制」动作；点击复制 **必须** 触发扩展侧文档化**内部**命令（例如 `dsh.copyToClipboard`），该命令在本 Feature **必须不** 作为用户菜单/快捷键主入口注册，但 **必须** 可被测试进程经 `executeCommand` 调用；L2/L3 **必须** 能断言该写入路径已成功接收目标文本；系统剪贴板人工核验以 **L4 辅助**；**必须不** 因 Webview 剪贴板权限而静默失败且无反馈。

**AC-18:** `[Must]` **普遍型** — 本 Feature **必须不** 将 Markdown 表格渲染或链接预览列为 Must；缺少表格/链接预览 **必须不** 构成 Must 验收失败（可作为 Should，见 AC-28）。

**AC-19:** `[Must]` **普遍型** — Conversations（当前打开的 Tab 身份栏/列表）在存在会话时 **必须** 展示可读标题，并在有摘要数据时展示摘要；**当** 存在尚无消息的空 live Tab **时**，Conversations **必须** 以「新对话」（或文档化等价）展示该条目；**必须不** 在空态中堆砌 Command Palette 式命令标题列表作为主要引导。

**AC-19a:** `[Must]` **不期望行为型** — **如果** 某会话为空 Tab（无实质消息、符合前序空 Tab 定义），**那么** History 历史列表 **必须不** 展示该会话条目。

**AC-20:** `[Must]` **事件驱动型** — **当** 开发者点击 History 列表中某一**非空**历史行 **时**，系统 **必须** 打开该会话的回放视图（创建或激活回放 Tab，行为继承前序：输入禁用、标明回放中、已有 Tab 则激活不叠副本）。

### C. 对话界面「新建会话」按钮

**AC-21:** `[Must]` **普遍型** — Conversation 对话界面 **必须** 提供可点击的「新建会话」按钮作为产品主入口；该按钮 **必须** 在默认主题下可发现且可激活；本 Feature **必须不** 将 `contributes.keybindings` 系统键盘快捷键列为 Must 验收条件。

**AC-22:** `[Must]` **事件驱动型** — **当** 开发者点击「新建会话」按钮（或执行等价 `dsh.newConversation` 命令），且 Host 尚未连接 **时**，系统 **必须先** 自动 Start Host，**然后**（在 Start 成功后）创建/激活新的 Conversation Tab，**必须** 聚焦 Conversation 面板，并进入可输入的 **live** 状态（Start 失败则遵循 AC-2，**必须不** 静默假装已新建可发送会话）。**在** 等待 Start 完成 **期间**，系统 **必须** 展示明确的「正在连接到 Host…」（或等价）等待态，且该态 **必须不** 被呈现为已就绪可发送；**必须不** 在 Start 完成前把面板误示为可发送 live。

**AC-23:** `[Must]` **事件驱动型** — **当** 开发者在 Host 已连接时点击「新建会话」按钮（或执行等价命令）**时**，系统 **必须** 新增一个 Conversation Tab（或按 AC-6 幂等规则复用空 live Tab），聚焦 Conversation 面板，并进入可输入 live。

**AC-24:** `[Must]` **普遍型** — 系统 **必须** 提供 **L2** 脚本证据：通过面板新建协议消息（文档化，例如 `action/new-conversation`）或等价 command id 触发新建后，在需要新建的场景下 Conversation Tab 数量增加 1，且活动面板上下文为 live 可发送；在触发 AC-6 幂等复用时，证据 **必须** 证明仍达 live 可发送且未额外叠空 Tab。

### D. 架构继承与回归

**AC-25:** `[Must]` **普遍型** — 本 Feature 的 UI 增强 **必须** 保持 Host / 扩展索引为会话 mode 与发送门禁的权威来源；Webview **必须不** 自持可与 Host 投影冲突的 mode/session 权威状态机（AD-CU-1 精神）。

**AC-26:** `[Must]` **普遍型** — 本 Feature **必须不** 修改 `packages/core/agent-loop`，**必须不** 将双通道（SDK + Host bridge）权威模型改为 Webview 单通道权威。

**AC-27:** `[Must]` **普遍型** — 前序已交付的 Must 行为（关 Tab 可恢复、显式删除、历史回放、Continue、Subagent 进入等）在本 Feature 合入后 **必须** 仍可按前序验收语义验证；本 Feature **必须不** 以降级这些行为为代价换取自动建连或 UI 底盘。

### E. Should / Could

**AC-28:** `[Should]` **可选功能型** — **若** 实现 Markdown 增强，系统 **应该** 支持表格或链接的可读呈现；失败时 **必须** 回退纯文本（与 AC-16 一致）。

**AC-29:** `[Should]` **状态驱动型** — **在** 「继续此会话」不可用或灰态 **期间**，UI **应该** 在控件旁展示简短说明（例如能力不可用 / 已是 live / Host 未就绪等可区分原因之一）。

**AC-30:** `[Should]` **事件驱动型** — **当** 某一回合产生可统计的文件改动 **时**，对话面板 **应该** 在该回合相关消息流末尾（或紧邻助手消息下方）提供简单的「本回合改了 N 个文件」入口，并可链到既有 Timeline/Diff 路径。

**AC-31:** `[Should]` **普遍型** — 代码块渲染 **应该** 显示语言标签（若 fence 指定了语言）；无语言标记时 **必须不** 编造语言名。

**AC-32:** `[Should]` **普遍型** — 非活动 Tab 的未读指示 **应该** 比前序基线更易发现（对比度或尺寸增强），且 **必须不** 改变前序未读清除语义（激活且面板已展示后清除）。

**AC-33:** `[Could]` **可选功能型** — **若** 资源允许，系统 **可以** 增加底盘抛光（微动画、密度微调）；**必须不** 因此把 Cursor 全量能力升为 Must。

**AC-34:** `[Should]` **可选功能型** — **若** 提供新建会话键盘直达入口（如 `contributes.keybindings`），该入口 **必须** 与 `dsh.newConversation` 行为等价（含未连先 Start），且 **必须不** 替代或削弱面板顶栏「新建会话」按钮（D-1）；缺省快捷键和弦由 design 选定，用户可在 VS Code 键盘快捷方式中覆盖/禁用。

## 不在范围内（明确排除）

1. 完整对标 Cursor（Composer 多栏、@引用、附件、斜杠命令生态等）。
2. Token 级流式打字机效果。
3. 工具调用富卡片 / 内嵌 Diff 编辑器。
4. Timeline 点击定位到面板消息。
5. 用 Webview 重做审批/提问表单。
6. 修改 agent-loop 或重做双通道权威。
7. 关 Tab 时「后台跑完再变历史」（前序 Out）。
8. 将表格/链接预览、Continue 灰态说明、改动摘要卡、代码块语言标签、未读点增强升为 **Must**（均为 Should/Could）。
9. **系统键盘快捷键作为新建会话主入口**（主入口必须是面板按钮；快捷键仅可为 Should 辅入口，见 AC-34）。
10. **因自动就绪而自动 Continue / 自动把恢复 Tab 转 live**。
11. **Host 断线后的无限自动重连**（至多自动一次）。
12. **`onStartupFinished` 仅因激活而自动 Start Host**；以及未打开 Conversation 视图时后台自动 New。
13. **多窗口协调 / 共享 Host / 跨窗口 Tab 同步**（单窗口内单例即可；各窗口独立 Host+索引）。
14. **Remote-SSH / Codespaces / 容器环境专项适配与专项测试矩阵**。
15. **未发送输入草稿的自动持久化与 Reload 恢复**。
16. **长消息流虚拟滚动 / 分批渲染等性能专项**（若极端卡顿，后续独立 feature）。
17. **剪贴板跨宿主环境全矩阵验证**（以扩展侧统一复制路径为准）。

## 约束

- 遵守 `.specdev/specs/vscode-dsh-chat-ready/constitution.md`（EARS、可验证、完整边界、Human Gate、无空壳、集成/端到端验证强制）。
- 实现与验证落在 `apps/vscode-dsh` 扩展面；复用已有命令：`dsh.startSession`、`dsh.newConversation`、既有 views（`dsh.chat` / `dsh.conversations` / `dsh.history` / `dsh.timeline`）与 `dsh.test.*` 钩子风格。
- 产品验证以 **L2/L3** 为主；B1–B3 视觉另加 **L4 截图辅助**（见 AC-7a）；**L4 不得**作为唯一达标证据。
- UI 变厚不得破坏 Host 权威与极薄状态机（AD-CU-1）。
- 敏感凭据不得写入 spec 或日志明文（Constitution §3）。
- 代码块复制优先扩展侧剪贴板路径，避免 Webview 权限静默失败（见 AC-17）。
- L2 必须能模拟有/无凭据两种状态而不改动生产判定语义（见 AC-7）。
- Markdown 渲染必须满足 AC-16/AC-16a 安全约束。
- B3（Enter/Shift+Enter）与 B5 相关交互须在 phase spec 中写明 L3 可驱动面（模拟 Webview keydown/composer 或测试钩子）。
- 实施前置：确认前序 `vscode-dsh-conversation-ui` 基线分支/合入状态（R-1），不得因此缩小本 Feature 目标。

## 已锁定决策（原开放问题）

| ID | 决策 | 落入 AC |
|----|------|---------|
| **D-1** | 「新建会话」= 顶栏常驻按钮；**不是**键盘快捷键 | AC-15、AC-21 |
| **D-2** | Conversation 视图可见才自动就绪；未开视图不 New | AC-1a、AC-3、AC-4 |
| **D-3** | 缺凭据 → 错误+重试+设置直达 | AC-2、AC-14 |
| **D-4** | 空自动 New Tab 不入 openTabSet | AC-4a |
| **D-5** | restore 不自动 Continue | AC-3 |
| **D-6** | 断线自动重试至多一次 | AC-6a |
| **D-7** | 无工作区：Start + 直接 New（不 restore） | AC-4b |
| **D-8** | B1–B3：L2/L3 + L4 截图辅助 | AC-7a |
| **D-9** | Start **不**在 startup 仅激活时触发；触发=活动栏/视图/DSH 命令/状态栏 | AC-1、AC-1a |
| **D-10** | 错误载体=面板内；未开面板=状态栏可点打开面板 | AC-2、AC-14 |
| **D-11** | Conversations 显示空「新对话」；History **不**列空 Tab | AC-19、AC-19a |
| **D-12** | 自动就绪/自动 New **不**产生未读点 | AC-3、AC-4 |
| **D-13** | Markdown 安全渲染 + 恶意载荷否定用例 | AC-16、AC-16a |
| **D-14** | 主题变更刷新面板令牌 | AC-8a |
| **D-15** | AC-17 以扩展侧复制动作可脚本断言为准；复制为内部命令 | AC-17 |
| **D-16** | 键盘快捷键可为 Should 辅入口，不得作主入口 | AC-34 |
| **D-17** | Start 命令集合：启动/发送类触发；查询/删除类不触发 | AC-1c |
| **D-18** | L2 主路径=视图可见全链路；其它入口 L1 即可 | AC-7 |
| **D-19** | 活动栏打开时必要时 reveal Conversation | AC-1b |
| **D-20** | Start 用 start-reason 状态机，防并发踩踏 | AC-1d |
| **D-21** | 窄栏新建须一次点击或展开+首项可达 | AC-15 |
| **D-22** | 设置直达=扩展设置页（或文档化等价） | AC-2 |
| **D-23** | 空 Tab=从未成功入队 prompt | AC-4a |
| **D-24** | 删除/查询类离线：提示或降级，不触发完整自动建连 | AC-1e |
| **D-25** | L2 含 AC-1a 反向用例 | AC-7 |
| **D-26** | 新建等待 Start 期间显示连接中，不可误示可发送 | AC-22 |
| **D-27** | 手动连续新建：活动空 Tab 则复用，不叠多个「新对话」 | AC-6 |
| **D-28** | 活动栏 ≠ Conversation 视图；必要时 reveal Conversation | 术语表、AC-1b |

## 开放问题

（无。已于 2026-09-08 锁定为上表 D-1～D-28。）

## 修订记录

| 修订 | 日期 | 摘要 |
|------|------|------|
| R1 | 2026-09-08 | 关闭原 Q-1～Q-3（按钮非快捷键；视图首开就绪；缺凭据设置直达）；空 Tab 不持久化；不自动 Continue；断线重试一次；无工作区降级；B1–B3 证据形态 |
| R2 | 2026-09-08 | Start 触发收紧（非 startup）；错误载体面板+状态栏；History 不列空 Tab；自动就绪不打未读；Markdown 安全；主题切换刷新；AC-17 可测措辞；多窗口/Remote/草稿/性能/剪贴板矩阵进 Out |
| R3 | 2026-09-08 | Should 键盘辅入口 AC-34；Start 命令集合边界；AC-7 L2 主路径；reveal Conversation；start-reason 状态机；窄栏按钮可达；设置直达落点；空 Tab=入队定义；复制为内部可测命令 |
| R4 | 2026-09-08 | 删除类离线边界 AC-1e；AC-7 反向 L2；AC-22 等待 Start 态；AC-6 手动新建复用空 Tab；术语活动栏/视图；自动恢复不打未读说明 |

## 风险/假设

### 假设

- **A-1：** 前序 Feature `vscode-dsh-conversation-ui` 的行为面已按规格验收；本 Feature 以「前序已交付能力」为基线进行增量，不重做会话状态机与 agent-loop。
- **A-2：** 现有命令 `dsh.startSession` / `dsh.newConversation` 及 restore 编排可被自动路径复用或薄封装，而无需改核心 loop。
- **A-3：** 工作区扩展索引中的未关 Tab 集合与活动 Tab 优先级语义与前序一致，自动就绪可直接调用。
- **A-4：** 「有凭据」的判定沿用扩展既有凭据/环境配置机制；本 Feature 不重新定义密钥存储格式。
- **A-5：** UI 底盘可在现有 Conversation Webview 内完成呈现升级，无需更换为第二套面板架构。
- **A-6：** 「Conversation 视图可见」= Conversation WebviewView 已创建且可见（如 `onDidChangeVisibility === true`）；若活动栏内 Conversation 非首视图，首次打开活动栏时须 reveal Conversation（AC-1b）。
- **A-7：** 「打开设置/配置凭据」与「状态栏打开面板」命令 id 由设计选定，需求要求可直达且 L2 可调用。
- **A-8：** 各 VS Code 窗口独立 Host + 索引；本 Feature 不协调跨窗口。

### 风险

- **R-1：** 前序产品代码可能仍在分支 `impl-phase-4-subagent-enter-pin`（或等价）**未合入 master**。若基线缺失，实施需先合入或基于该分支开发；此为**实现/集成风险**，**不得**因此缩小本 Feature 的产品目标。
- **R-2：** 自动 Start + 自动 New 与前序空 Tab 规则交互时，若幂等不足，可能产生幽灵空 Tab——AC-4a/AC-5/AC-6 必须有 L2 证据（产品决策已锁定：空 Tab 不持久化）。
- **R-3：** 多窗口协调已 Out；同窗口单例由 AC-5 约束；无工作区降级已由 AC-4b 锁定。
- **R-4：** Markdown XSS 已由 AC-16/AC-16a 升为 Must 安全约束与否定用例。
- **R-5：** 「新建会话」与 Continue 同排时窄栏可能挤兑——设计须保证主按钮可发现（D-1 已锁定顶栏常驻，允许缩短文案）。

## 建议的 Phase 拆分方向

> 仅作高层指引；**正式 Phase ID / DAG 由 plan-generator 产出**，此处不定义 Phase 编号。

1. **生命周期面（F1/F2）**：Start 触发收紧 + 命令集合边界 + start-reason 状态机 + reveal Conversation、状态栏错误引导、视图可见就绪、空 Tab/未读/Continue、断线 retry-once、无工作区、L2 主路径用例。
2. **Chat UI 底盘（B1–B5）**：主题+主题切换、气泡、底栏与 Enter 手势、Markdown 安全与可测复制、L4 截图辅助。
3. **侧栏 IA + 面板新建按钮（B6/F8）**：Conversations vs History 空 Tab 区分、顶栏「新建会话」、L2 按钮/命令证据；Should 按余力。

横切：AD-CU-1 / 不改 agent-loop / 前序回归；每切片至少 1 条 L2（适用时 L2+L3）；B3/B5 写明可脚本驱动面。
