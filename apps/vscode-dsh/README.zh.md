# @deepseek-ai/dsh-vscode-dsh

[English](README.md) | 中文

`dsh --profile ide` 的 VS Code Extension Host。

## 概述

监听 Host bridge socket，以 `DSH_IDE_BRIDGE_SOCK` 拉起 `dsh --profile ide`，在报告已连接之前完成 SDK `initialize`，并在 deactivate 时关闭子进程。错误 UI 文案中的密钥已脱敏。

一个 DSH 进程服务整个窗口（AD-1）。多个会话页签各自绑定一个独立的 SDK `sessionId`。切换页签会重定向提示词并过滤 Timeline / Conversation 面板。

**Conversation** Webview 是实时的阅读与输入界面。**决策状态**（mode / sessionId / send gate / Continue）跟随 Host 的 `panel/state` / `messages/*` / `status/set` —— Webview 永不拥有这些决策。非法发送由 Host 经 `ui/reject-send` 拒绝。按修订后的 AD-CU-1 / AD-CUX-1，Webview **可以**持有**呈现状态**（follow-state、流式 chrome、展开座位），前提是经 DOM / `__dshProbes` 约定暴露。**Timeline** TreeView 保留简短的轮次/步骤/工具/状态/subagent 标签与 Diff 入口 —— 它**不**展示 assistant 长文本（那属于 Conversation 面板）。

SDK 的 `session.event` / `session.status` / `session.assistant-stream` / subagent 通知被投影到 Timeline 与 MessageStore。携带 `meta.diffs` 的 write/edit 工具结果暴露一个**事后** Diff 入口（`vscode.diff`）；运行中的逐文件确认不是默认行为（AD-7）。

安装、profile 布局与故障排查见 [VS Code 扩展指南](../../docs/user/guide/vscode-extension.zh.md)。

## Layer V 冒烟测试链路（真实 Extension Development Host）

一条命令驱动真实的 `code` Extension Development Host 走完五步链路 —— Host 已启动 → 新建会话 → 真实模型往返 → 审批 → 原生 Diff —— 并留下机器可读的证据：

```bash
bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
```

无参数、不读 stdin、无交互提示。脚本自行解析所用的 Node、自行解析显示环境、自行铺设 `HOME` 沙箱，然后读取 in-host 驱动的判决。

### 产物目录

每次运行都写入 `apps/vscode-dsh/test-artifacts/layer-v/` —— 该目录被仓库根 `.gitignore` 中的一条显式规则忽略（因此 `git check-ignore` 命中来自仓库根的规则，而不是全局 excludes 文件）：

| 文件 | 内容 |
|---|---|
| `layer-v-status.json` | 机器可读的运行记录：每步的判决与证据、Node 与显示环境事实 |
| `layer-v-plan.json` | shell → 驱动 的约定（marker、路径、探针目标、超时） |
| `layer-v-journal.jsonl` | 仅追加的驱动日志（步骤开始 / 成功 / 失败） |
| `layer-v-log-evidence.json` | 从产品自身 session 日志中抽取的证据 |
| `layer-v-corroboration.json` | 脚本对驱动 PASS 的独立复核 |
| `run-summary.json` | 汇总的运行元数据、结论与退出码 |
| `step-5-target.txt` | 第 5 步里模型编辑的探针文件 |
| `step-<n>-<slug>.png` | 五张步骤截图 |

每次运行还会向 `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` 追加一行，该文件**被 git 追踪**：索引是 spec 产物，因此绝不能放在被忽略的目录里。

### 截图命名规则

截图命名为 `step-<n>-<slug>.png`，`n` 取 1 到 5，每个链路步骤对应一个固定 slug：

| 文件 | 步骤 |
|---|---|
| `step-1-host-started.png` | Host 到达 `started` 且会话已连接 |
| `step-2-new-conversation.png` | 出现新的会话页签 |
| `step-3-model-round-trip.png` | 携带本次运行唯一 marker 的 assistant 文本 |
| `step-4-approval.png` | 先经 `dsh.test.answerQuestions` 作答 SpecDev 范围卡，再经 `dsh.test.answerApproval` 作答审批 |
| `step-5-native-diff.png` | 由 `meta.diffs` 打开的原生 `TabInputTextDiff` |

截图工具经实测而非假定选出，顺序为：`ffmpeg` 按**实测的全屏尺寸** → `ffmpeg` 按 plan 的裁剪尺寸 → `ffmpeg` 用 `x11grab` 自身默认区域 → `gnome-screenshot -f`（写明的备用手段）。某一步的截图缺失、或不是合法 PNG（magic bytes 加文件大小下限）时，该次运行以 `HARNESS_ERROR` 失败 —— 没有证据的步骤绝不会被判为成功。

这个顺序背后有两个在本机实测得到的事实（2026-09-16，`DISPLAY=:1`，屏幕 `3840x1080`）：

- **`-video_size` 是「证据是否可用」的前提。** `x11grab` 的默认区域是锚在左上角的 640x480，所以不带 `-video_size` 的捕获等于静默裁剪：它产出的是一张合法 PNG、也确有真实界面，但会话面板位于编辑器区域，落在裁剪范围之外。尺寸不是猜的 —— `ffmpeg` 不提供查询屏幕的接口，本机也没有 `xdpyinfo`/`xrandr`/`xwininfo`，因此驱动**先请求一块屏幕装不下的区域**（`4096x2160`），再从 `x11grab` 的拒绝信息里读出真实尺寸（`outside the screen size 3840x1080`）。请求**大于**屏幕是硬错误、不会被夹取到屏幕尺寸，这正是必须实测而不是假定一个常量的原因。
- **`-update 1` 是命令的一部分。** 缺了它，image2 muxer 会被要求把第二张图写进一个固定文件名，于是 `ffmpeg` 在**写出完好帧之后**以非 0 退出 —— 磁盘上的产物是好的，状态 JSON 里却像一次失败。

选中的模式、实测到的屏幕尺寸、以及每个候选的尝试结果都记在 `layer-v-status.json` 的 `driver.screenshot` 下，因此「裁剪」不会被误当成「全屏捕获」。

### 跳过条件

跳过是一等结局，绝不被当成静默通过：

| 条件 | 结论 | 退出码 |
|---|---|:--:|
| 无可用的显示环境，且没有 `Xvfb` 可拉起（`reuse` → `xvfb` → 跳过） | `SKIPPED_NO_DISPLAY` | 2 |
| 产品自身的凭据门禁拒绝启动（环境与工作目录的 `.env` 中都没有 `DEEPSEEK_API_KEY`） | `SKIPPED_NO_CREDENTIALS` | 3 |

脚本不安装任何东西。当无法获得显示环境时，它**不会**尝试包管理器；`xvfb-run` 或 `Xvfb` 必须已安装，否则该次运行就是 `SKIPPED_NO_DISPLAY` 并打印原因。缺凭据**不是**链路失败 —— 两种结论保持可区分，且两者都不得打印通过。

### 退出码含义

| 退出码 | 结论 | 含义 |
|:--:|---|---|
| 0 | `PASS` | 五步链路端到端跑通，且脚本自身的复核一致 |
| 1 | `LINK_FAILURE` | 产品链路本身失败 —— 某一步的断言不成立 |
| 2 | `SKIPPED_NO_DISPLAY` | 无显示环境且没有 `Xvfb` 可拉起 |
| 3 | `SKIPPED_NO_CREDENTIALS` | 没有凭据时产品拒绝启动 |
| 4 | `HARNESS_ERROR` | 脚本自身的约定被违反（缺少规则或前置条件、驱动的报告无法归类） |

只有退出码 0 是通过。脚本绝不把 `LINK_FAILURE` 或 `HARNESS_ERROR` 降级为跳过，也绝不在其它退出码上报告通过。

### 故障注入（负向运行，AC-27）

脚本不接受参数，因此让某一步「故意失败」的开关是环境变量。它们默认关闭，**都不**伪造或注入 `meta.diffs`（只制造失败），且每个生效的开关都会打到 stderr 并记入状态 JSON 的 `faults` 块，使故障运行的结论不可能被误认成正常运行：

```bash
LAYER_V_FAULT_STEP5_DIFF_COMMAND=dsh.thisCommandDoesNotExist \
  bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh   # → LINK_FAILURE, failed step step-5
LAYER_V_FAULT_SKIP_REVIEW_COMMAND=1  # step 5 never runs its diff command
LAYER_V_FAULT_ANSWER_DELAY_MS=130000 # answers past the 120s window → step-4 LINK_FAILURE
```

取值非法（延迟非数字、开关既不是 `0` 也不是 `1`）判 `HARNESS_ERROR`：一个静默失效的故障开关会把负向运行变成假通过。

### 显式清除继承的 `DSH_NODE_BIN`

该次运行同时是「扩展的解析链消费的是 `dsh.nodeBin` 设置」这一断言的证据。因此脚本**清除**继承的 `DSH_NODE_BIN`（仅仅不导出它并不够），断言清除后 `printenv DSH_NODE_BIN` 为空，并把该清理动作 —— 是否继承了值、脱敏后的原值、以及空值断言结果 —— 记入 `layer-v-status.json`。随后它在一次性的 `--user-data-dir` 设置中预置 `dsh.nodeBin`，值为它自行解析出的 Node 的绝对路径。

清除后仍非空、或缺少该清理记录，都判 `HARNESS_ERROR`：没有这次清理，该次运行就无法证明该设置被消费。

## 库

- `IdeSessionHost` —— 可被 Node 测试的生命周期持有者（prompt + bridge `session/dispose` / `session/read-log` / `session/resume` + 通知扇出）
- `AutoStartOrchestrator` —— 启动原因的 FSM（activate 时不 Start）
- `AutoReadyCoordinator` —— Conversation 可见 ∧ Host ready → 恢复 / 新建（与 Start 解耦）
- `ConversationRegistry` / `ConversationController` —— 页签 ↔ `sessionId` 绑定；可恢复的关闭与删除之别；**重启恢复** + **继续**；`newConversationOrReuseEmpty`
- `MessageStore` —— Conversation 面板的按 session 聊天投影（不是权威数据库）
- `ExtensionIndex` —— 针对 `openTabSet` / `activeSessionId` 的即时 `workspaceState` 写入（仅元数据）
- `ReplayHydrator` / `restore-planner` —— 权威日志注入；空页签剔除；active 优先的 UI 上限 N
- `continue-capability` —— T-0b Gate + AD-CU-8 顶栏 Continue chrome（列表提示保持解耦）
- `ChatPanelHost` —— Host↔Webview 协议 + send gate + Continue / 查看更多
- `TimelineStore` —— 纯按 session 作用域的轮次 / 步骤 / 工具 / 简短 assistant 标签 / Diff 投影
- `buildIdeChildEnv` —— 先擦洗再重新注入的子进程环境
- `redactSecrets` —— AC-32 的日志卫生

## 命令

| 命令 | 动作 |
|---|---|
| `dsh.startSession` | 启动 / 复用窗口会话 Host（经 AutoStartOrchestrator）。**不**恢复页签、也不新建 —— Conversation 可见时由 AutoReady 负责 |
| `dsh.stopSession` | 关闭会话 Host（用户 Stop → orchestrator idle） |
| `dsh.newConversation` | 新增一个带全新 `sessionId` 的页签，或**复用当前空的 active 页签**（AD-CR-6）；需要时自动启动 Host |
| `dsh.switchConversation` | 切换 active 页签（TreeView 点击或 QuickPick）—— **不**触发完整自动启动 |
| `dsh.closeConversation` | 关闭（卸载）active 页签 —— **不** dispose 会话 |
| `dsh.deleteConversation` | 显式删除：确认 → `session/dispose` + 清索引。离线时 → **「Host 连接后可删除」**（不假删、不自动启动） |
| `dsh.deleteHistory` | 删除历史列表中的会话（`session/dispose` + 清索引）。离线时 → **「Host 连接后可删除」**（不假删、不自动启动） |
| `dsh.deleteSessionFromDisk` | 把 active 页签的会话从磁盘删除：走已确认删除路径，但本身不弹确认（脚本 / 命令面板入口）。离线时 → **「Host 连接后可删除」** |
| `dsh.continueConversation` | 继续本会话（需要时自动启动 Host） |
| `dsh.restoreMoreTabs` | 注入被推迟的恢复页签（「查看更多 / 全部恢复」） |
| `dsh.promptActiveConversation` | 向 active 页签的 `sessionId` 发提示词（测试 / 脚本用；需要时自动启动） |
| `dsh.insertFileReference` | 输入工作区相对路径，把它的 `@path` mention 插入输入框（需要时自动启动） |
| `dsh.selectPermissionPreset` | 为 active 页签选择一个 permission-presets 档位 |
| `dsh.selectModel` | 模型选择的键盘入口（ctrl+shift+alt+m）：显示对话面板，并推送它模型下拉所需 settings 状态 |
| `dsh.triggerCompact` | 对 active 页签执行 `/compact` —— 与输入框「压缩上下文」按钮同一条路径。没有 active 页签 → 仅提示，不调用运行时 |
| `dsh.reviewWorkspaceDiffs` | 为 active 页签上的 write/edit 路径打开事后 Diff |
| `dsh.openTimelineDiff` | 从 Timeline 的 write 行打开 Diff（AC-25） |
| `dsh.showPanel` | 显示 Conversation 视图 / 连接错误详情（**不**强制 Start） |
| `dsh.openExtensionSettings` | 打开过滤到本扩展的 VS Code 设置（缺凭据的深链） |
| `dsh.statusBarAction` | 状态栏点击：显示面板**并**自动启动（`status-bar` 原因） |

### 自动启动命令矩阵（AC-1c / AC-1e）

| 类别 | 命令 | 自动启动？ |
|---|---|:---:|
| **Start** | `dsh.startSession` | ✅ (`command-start`) |
| **发送 / 新建** | `dsh.newConversation`、`dsh.promptActiveConversation`、`dsh.continueConversation`；Webview `ui/tab-new` / `action/continue` | ✅ (`command-send`) |
| **查询 / 浏览** | `dsh.openHistory`、`dsh.searchSessions`、`dsh.listSubagents`、`dsh.specdevStatus`、`dsh.switchConversation`、History/Conversations 刷新 | ❌ |
| **删除** | `dsh.deleteConversation`、`dsh.deleteHistory` | ❌ —— 离线时显示「Host 连接后可删除」；绝不假删权威数据 |
| **面板 / 设置** | `dsh.showPanel`、`dsh.openExtensionSettings` | ❌（仅显示详情 / 设置） |
| **状态栏** | `dsh.statusBarAction` | ✅ (`status-bar`) |
| **可见性** | Conversation `onDidChangeVisibility` / activity-bar 打开 | ✅ |

`onStartupFinished` / `activate` **只注册**命令、视图、状态栏与 orchestrator —— 它**不** Start（AC-1a）。

### 自动就绪时机（AD-CR-3 / AC-3/4/6）

AutoReady 仅在 **Conversation 可见 ∧ Host ready** 时运行：

1. 持久化的 `openTabSet` 非空 → 以 `mode=replay` 恢复（active 优先；**不**自动 Continue；抑制未读）。
2. 集合为空 / **无工作区文件夹** → `newConversationOrReuseEmpty` → live（空页签在首次成功入队 prompt 之前**不**写入 `openTabSet`）。
3. 在 **active** 页签仍为空时重复的可见性 / 触发 → 复用该页签（绝不全局抢占另一个空页签）。

隐藏状态下的 Start（Conversation 隐藏时执行 `dsh.startSession` / command-send）在 Conversation 变为可见之前留下**零个**页签。

**Activity-bar 生产信号（AC-1b）：** VS Code 没有独立的「activity bar 容器被打开」事件。生产路径依赖 reveal 之后的 Conversation `onDidChangeVisibility`（状态栏点击 / `dsh.showPanel` / 首次视图聚焦）。L2 保留 `dsh.test.openActivityBar` 作为显式的 reveal + `activity-bar` 请求钩子。

凭据 / 扩展配置深链的设置前缀：`@ext:deepseek-ai.dsh-vscode-dsh`。

### L2 测试钩子（脚本 / Extension Host harness）

**仅**当 `VSCODE_DSH_TEST=1`，或 `activate` 收到注入的 vscode 测试替身时注册（AD-CR-10）。**不**贡献到生产命令面板。

| 命令 | 动作 |
|---|---|
| `dsh.test.sendPrompt` | 经 Host 门禁的发送（与 Webview `composer/send` 同一门禁） |
| `dsh.test.closeConversation` | 可恢复的关闭；运行中传 `{ confirmStopClose: true }` |
| `dsh.test.deleteConversation` | 删除路径；确认后传 `{ confirmed: true }` |
| `dsh.test.panelSnapshot` | 读取面板 mode / messages / index / Continue chrome |
| `dsh.test.getIndex` | 读取持久化的 ExtensionIndex 快照 |
| `dsh.test.openPanel` | 推送面板状态（冒烟打开） |
| `dsh.test.restoreOpenTabs` | 重启恢复 orchestrator（可选 `eventsBySession`） |
| `dsh.test.continue` | 继续 active 的 replay 页签（可选 resume stub） |
| `dsh.test.restoreMoreTabs` | 「查看更多」注入 |
| `dsh.test.diffAvailability` | 探测可恢复的日志 Diff（不冒充工作区） |
| `dsh.test.getStartState` | Orchestrator 快照（`idle`/`starting`/`disconnected`/…） |
| `dsh.test.simulateStartupOnly` | AC-1a 反向：仅 activate 的指标（不 Start） |
| `dsh.test.setCredentialPresence` | 为 AC-2 模拟凭据存在 |
| `dsh.test.fireConversationVisibility` | 驱动生产可见性 → AutoReady 入口 |
| `dsh.test.triggerAutoReady` | 在可见 + Host ready 时强制 AutoReady 应用（可选 `eventsBySession`） |
| `dsh.test.openActivityBar` | AC-1b：reveal Conversation + `activity-bar` 启动原因 |
| `dsh.test.requestStart` | 直接调用 orchestrator 的 `request(reason)` |
| `dsh.test.hostCreateCount` | Host 构造计数（AC-5） |
| `dsh.test.injectDisconnect` | 触发意外的断连（AC-6a） |
| `dsh.test.answerApproval` | 按 id 作答一个 pending 审批（`allow-once` / …），不经 UI 往返（AD-12） |
| `dsh.test.answerApprovalFromWebview` | 经面板自身的 `interaction/approve` 帧作答一个 pending 审批 —— 交互卡片使用的作答路径 |
| `dsh.test.injectQuestions` | 经真实协调者创建一张 pending 用户提问卡，供驱动按 id 作答 |
| `dsh.test.answerQuestions` | 按 id 作答一个 pending 用户提问卡，不经 UI 往返（SpecDev guard 弹出的范围卡） |
| `dsh.test.getDiagnosticsText` | 结构化的 `HostDiagnosticRecord[]` —— 字段而非散文（AD-14） |

## 视图

| 视图 id | 内容 |
|---|---|
| `dsh.history` | 会话历史列表 —— 本扩展自绘的 WebviewView：会话行（打开 / 行菜单）、新建会话、空态 |
| `dsh.todo` | 当前对话 Tab 的待办列表 —— 每条已写入的待办一行 `TreeView` 行，行描述为 进行中 / 已完成 |

对话界面是编辑器面板（`dsh.editorChat`）；Activity Bar 容器 `dsh` 贡献 History 与 Todo。History 首次显示时同时打开对话面板 —— 每个窗口一次，且只在用户打开该容器时发生。

Todo 视图渲染活动 Tab 的 `todoItemsForSession`：没有活动会话时为空，模型写入后显示该列表；控制器在待办写入与 Tab 切换时刷新它。

History 是 **WebviewView** 而非 `TreeView`：行的字号与行菜单归本扩展所有，而原生树的字体由 VS Code 决定。每行显示记录时间与首句用户输入，运行时能恢复该会话时另加「可继续」。右键点击某行（或在行上按 `Shift+F10`）打开行菜单 —— **打开回放 / 继续本会话 / 复制会话 ID / 删除会话**。运行时无法恢复的会话，**继续本会话** 为禁用；该操作先打开回放再继续，因为继续作用于当前活动 Tab。**删除会话** 先请求确认，然后走与面板相同的已确认删除路径。没有可用会话时，该视图渲染自己的空态，其按钮用于新建会话或打开面板。

视图头部的 **多选** 把列表切换成选择面：每行出现复选框，**全选** / **清空** 管理该集合，**删除所选** 把整个集合作为一条 `sidebar/delete-many` 意图发出。完整开发周期里历史会话多是常态，因此该选择只做一次原生确认（提示里说明总数与其中正在运行的数量），随后每个 id 都走与单行删除相同的已确认路径。某条无法删除也不会拖垮其余选中项，最终由一条汇总说明报告差额。

## Composer `@path` 引用

在输入框键入 `@` 会为工作区根目录打开候选列表。候选来自 Host 挂在 `ctx.fileReferences` 背后的同一套搜索，因此面板、Web 客户端与模型自身的 `@` 指引在排序和排除上完全一致。`↑`/`↓` 移动高亮，`Enter` 或 `Tab` 接受，`Escape` 关闭；接受目录会让列表向下展开一级，含空格的路径以 `@"path with spaces"` 形式插入。

把文件拖到面板的任意位置都会把每个落下的路径转成一条 `@path` mention；整块会话区都是放置区，而不只是两行高的输入框。资源拖拽会同时读取 VS Code 填充的两种形式——单条的 `text/uri-list` URI 与列出全部被拖资源的 `text/plain` 标签——因此多选拖拽会贡献每一个文件。Host 用发送门禁同一套工作区校验解析每个路径，并合并同一文件的两种写法，因此工作区之外的落文件会被跳过（并给出提示），而不会变成本该被拒绝的 token。带有图片文件对象的拖拽会成为附件；其余拖拽一律成为 `@path` mention。`dsh.insertFileReference` 无需拖拽即可插入一条 mention。

**从资源管理器或编辑器标签拖拽时必须按住 Shift。** 在工作区内部拖拽期间，VS Code 会关闭 webview 的指针事件，好让编辑器组能打开被放下的文件；只有按住 Shift 时它才会恢复（[vscode#182449](https://github.com/microsoft/vscode/issues/182449) 与 [PR #209211](https://github.com/microsoft/vscode/pull/209211)，VS Code 1.91）。从窗口外拖入不受这条规则影响。

消息正文里的 `path:line` 与卡片同路打开：正文中的 `src/a.ts:12` 会变成文件链接并在第 12 行打开该文件（尾随的 `:column` 会显示但无需点击），而 URL、`@` mention 与不带行号的路径保持纯文本。

## Composer `/` 命令

在输入框行首键入 `/` 会打开候选列表，按 **命令 / 智能体 / 技能** 分组。命令来自该会话的命令注册表，智能体来自部署的 preset 名册，技能来自该会话中用户可调用的集合；三者都经 Host bridge 从运行时自己使用的注册表读取，因此列表给出的名字就是运行时能解析的名字。命令与技能按会话寻址，读取它们会物化该页签的会话 —— 走的是它首条 prompt 会用的同一条创建路径。`↑`/`↓` 移动高亮，`Enter` 或 `Tab` 插入，`Escape` 关闭，查询随输入收窄。

命令行与技能行插入 `/名字 `；智能体行插入 preset id，因为 preset 在会话创建时绑定，该行只是 prompt 提示而非命令。对命令行按 Enter 会在运行时**真正执行它**，而不是把这一行发给模型；结果 —— 成功文本、usage 错误或失败 —— 作为消息流中的本地提示出现，而不是模型看得到的消息。没有命令认领的行仍是 prompt，行首的 `/skill-name` 就在那里解析。命令行带图片附件时无法走本桥，因此面板会说明这一点，并把它当普通消息发送，而不是静默丢弃图片。

输入框的「压缩上下文」按钮与 `dsh.triggerCompact` 走同一条路径：它们在运行时执行 `/compact`，只有在没有命令认领时才回落到 prompt 路径。

## 面板与 Timeline

| 界面 | 职责 |
|---|---|
| Conversation 面板（编辑器页签） | 完整的用户 / assistant 消息文本；实时输入区；等待交互 / 生成中状态 |
| Timeline（`dsh.openTimelineDiff`） | 紧凑的轮次/步骤/工具/状态/subagent 标签；工具 Diff 入口 —— 不含 assistant 长正文 |

## 关闭与删除策略（AD-CU-3）

- **关闭页签**卸载 UI 并销毁 `tabId`，但**不**调用 bridge 的 `session/dispose`。权威数据保持可恢复。空页签永不进入持久化的 `openTabSet`。
- **删除会话**需要确认（运行中还需 Stop & Delete）。只有确认后，扩展才发送 `session/dispose`、清空该 session 的 MessageStore/Timeline，并在索引中打墓碑。父级删除不会级联到子会话的权威数据。
- 运行中的关闭会提示 **Stop and Close** / **Cancel**；取消则页签保持打开。
- Host 未就绪 → 删除被禁用 / 以「Host 连接后可删除」报错（不做仅索引的假删；不自动启动）。

`openTabSet` / `activeSessionId` 在每次变化时都写入 `workspaceState`（不只在 deactivate 时）。

## 重启恢复（AD-CU-3/4/10）

- 当 Conversation 变为可见且 Host ready 时，AutoReady 读取持久化的 `openTabSet`、**剔除空页签**（无消息 / 从未发送）、立即把清洗后的集合写回，并注入大小为 **N** 的 UI 子集（`ui.restoreUiLimit`，默认 **8**）。
- 仅有 Start（Conversation 隐藏时执行 `dsh.startSession`）**不**恢复、也不新建。
- 最近一个 **active** 会话总是被强制纳入 UI 集合并获得焦点（AC-34）。其余索引行留在 `openTabSet`（AC-70）；用 `dsh.restoreMoreTabs` / `action/restore-more` 实现「查看更多 / 全部恢复」。
- 被恢复的页签总是 `mode=replay`（即使曾存有 `liveIntent`）。不自动 Continue / 发提示词。AutoReady 抑制未读。
- Host 未就绪 → `waiting-host`；Host 连接后恢复会自动注入（AC-69）。无工作区文件夹 → AutoReady 跳过恢复并打开一个 live 空页签（AC-4b）。

## 会话 chrome ——「新建会话」(AD-CR-8)

- 顶栏的 **「新建会话」** 是**产品主入口**（始终带标签；窄侧栏可以换行，或使用溢出「⋯」，其中「新建会话」是第一个菜单项）。
- 点击 → Webview `ui/tab-new` → 与 `dsh.newConversation` 相同的 Host 路径：离线时**先 Start**（`ensureHostForSend` / `command-send`），等待横幅「正在连接到 Host…」（输入区**不可**发送 `live`），然后 `newConversationOrReuseEmpty` + reveal Conversation。
- 键盘 `contributes.keybindings` 把 **`ctrl+shift+alt+n`** / mac **`cmd+shift+alt+n`** 绑定到 `dsh.newConversation`（与 chrome 按钮相同的 ensureHost / 先 Start 路径）。用户可在 VS Code 键盘快捷方式中覆盖或禁用该组合键。快捷键是 **Must 次要**入口，且**不得**取代或削弱顶栏的「新建会话」按钮（AC-34）。
- Webview 的 `action/continue` 在离线时同样会自动启动 Host（与 `dsh.continueConversation` 同属发送类路径）。

## 继续本会话（AD-CU-8 / T-0b same-id）

- T-0b Gate 为 **PASS (same-id)**。当能力为 `same-id` 或 `derive-only` 时顶栏 Continue **启用**；为 `already-live` / `Host 未就绪` / `能力不可用` 时**禁用**并附一句简短原因（AC-29）；仅当 Gate 为 FAIL 时**隐藏**。
- 历史列表提示（「可继续」）与顶栏 Continue 控件保持**解耦**。
- Continue 调用 Host bridge 的 `session/resume` → SDK `sdkSessionResume` → `agents.resume`（**不**展开 SDK stdout create）。同一打开周期内的 `tabId` 由 `replay→live` 升级（AC-32）。旧日志前缀不被改写（AC-66）。

## 回放 Diff（AD-CU-6）

- 仅当 `meta.diffs` 携带可恢复的快照（`path` + `newText` + `oldText: string|null`）时 Diff 可用。仅有 patch（缺 `oldText`）→ Diff 不可用并给出说明。
- Diff 的两侧都作为来自日志的虚拟 `dsh-diff` 文档打开 —— **绝不**把当前工作区文件当作 before/after。
- 未完成 / 被中断的轮次会在消息上标记（`incomplete`），并提示「已停止/未完成」（AC-77）。

## 注入上下文行

- 日志中 `source.kind` 不是 `user` 的 `user/message`，是模型收到但并非用户键入的输入（agent 指令、goal 轮次、定时跟进、提问回答）。面板把它投影成自己的 `kind:'context-injection'` 行而不是用户气泡，并同时携带日志记录的 producer 与**完整**载荷。
- 该行默认折叠为 `上下文注入 · <producer>` 加一行有界预览，因此很长的指令载荷不会淹没对话；展开后显示模型实际收到的原文，超出部分在行内滚动。
- 实时会话与从日志折出的回放走同一条投影，因此事后展开读到的行就是实时面板当时展示的行。

## 子代理控制（AD-CU-11）

- `dsh.listSubagents` 通过 bridge 的 `subagent/list` 展示某会话的名册 —— 默认 `children`，传 `'descendants'` 得到整棵子树并带 `parentId` / `depth`。每行携带 `mode`（`one-shot` / `continuable`）与从实时 Agent 注册表重采样的 `activity`；无法读取的子会话显示为「无法识别 <id8>」。
- 面板在消息流上方保留一条固定名册条，由 `panel/state.subagents` 从该页签根会话自身的子代理卡片推送。运行中的子代理计入条头计数并标 ●，因此它的内嵌卡片滚出视野后仍然可见；已结束的子代理保留 ✓ 行、始终一键可达；已删除的子代理从名册中剔除。每行都经 `nav/open-subagent` 进入对应子会话，与内嵌卡片是同一条路径。
- 已结束的行各自带一个移除控件，条头另有 **清除已结束** 一次移除全部已结束项。移除只隐藏名册行 —— 对话里的卡片与持久会话都保留 —— 且从不作用于运行中的子代理，它的行就是进度面。被移除的子代理再次运行时回到名册。
- `continuable` 子代理仅在其父页签存活且该子代理未运行时可接收消息：输入区显示「发送给子代理 <label>」并经 bridge 的 `subagent/prompt` 投递。one-shot 子代理、运行中的子代理、回放父页签、bridge 不可达时输入区保持只读。
- 运行中的子代理卡片提供「中断」→ bridge 的 `subagent/interrupt`，以父会话为权威；one-shot 与 continuable 子代理都可中断。
- runtime 的拒绝文案（父会话不在运行、子代理不可续接、服务不可用）原样显示在横幅上。

## 交互卡片

- 面板可见时，运行时的审批与提问都在消息流里呈现为卡片，决定就出现在它阻塞的那次调用旁边；面板不可见时，协调器回落到 QuickPick 呈现者（AD-CU-7）。
- 两种卡片都经 bridge 作答：审批是「允许一次 / 拒绝 / 取消」，提问是「提交回答」，另有「取消」作为 fail-closed 的丢弃路径。决定做到一半切换页签只会把卡片放回队列，不会被误当作已作答。
- 等待过期的卡片——运行时的 `interactionTimeoutMs` 到期仍无人回答——保留它在决定的那件事，并把控件换成「已超时，回答不会再送达」，因为运行时已把那次调用以拒绝方式关闭，迟到的回答无处可去。点「知道了」只在面板内清掉这张卡；运行时不会再为该 id 发任何帧。

## SpecDev 状态（AD-CU-12）

- 工作区的 Spec 驱动工作流（`.specdev`）是持久状态而非日志状态，因此面板从运行时读取：只要 bridge 的 `specdev/snapshot` 回出一个工作流就有状态卡；工作区没有工作流时不渲染卡片。
- 状态条显示 slug、stage/phase、HG-1/HG-1.5/2/3 标记、计划顺序（当前阶段及其依赖）、当前阶段正在运行的角色、技术债计数、本会话最近一次放行范围、计划声明为 UI 的每个阶段的原型标记与待决门禁（按其显示名，如「等待门禁 HG-1.5」/「原型确认」）。切换页签与每个 `specdev/*` 事件都会重新读取，因此在别处推进过的工作流不会再占据卡片。
- 产物条按存在与否列出工作流级与当前计划的产物（缺失的显示「（缺）」），点击任一行都走 `@` 引用卡同一条路径打开该文件。
- 运行时记录了下一步时，卡片显示该动作并提供「填入输入框」，把文本放进输入框而不发送。
- 待决门禁在卡片内渲染决定表单：运行时接受通过前会检查的依据、状态已携带的风险行（阻塞债、回炉轮次、缺失产物）、多行备注，以及「通过并推进 / 打回修改 / 延后」三个决定。打回必须填写备注——按钮保持禁用，Host 也会拒绝无备注的打回——通过与延后则可留空。
- 决定与备注随一条 `action/specdev-gate` 意图经 bridge 的 `specdev/confirm-gate` 落盘；门禁次序、工件前置条件与持久写入都属于运行时，因此拒绝（`SPECDEV_GATE_NOT_PENDING: …`）原样显示，而已接受的决定会替换卡片上的状态。
- `dsh.specdevStatus` 保留 QuickPick 作为命令面板路径（通过 / 驳回 / 推迟，可附说明），并经同一条路径应用。
- `dsh-specdev-guard` 的越界访问申请复用交互卡：详情区给出工具、角色、访问类型、目标路径、整盘/递归扫描的风险行与申请方理由，选项即四档范围。

## 目标卡片

- 目标是持久会话状态，而它的自动续行按进程激活，因此卡片经 bridge 的 `goal/read` 从运行时读取这两半：目标描述、阶段、轮次计数，以及续行是否已激活。agent 尚未物化的会话仍有其持久阶段，运行时会用已注册的 `goal` 投影作答并报 `disarmed`。没有目标就不渲染卡片。
- 动词跟随上报的状态：已激活的 active 目标提供「暂停」，active-but-disarmed、paused、blocked 提供「恢复」，每个未完成目标提供「编辑」，每个阶段都提供「清除」。这正是用户恢复 paused 目标的路径——模型自己不可以，`update_goal` 会以 `GOAL_TOOL_RESUME_PAUSED` 拒绝。
- 「编辑」把目标描述放进文本域，只有当替换内容与屏幕上不同时才写入；「清除」会先问一次再执行，因为清除会停止续行而不把目标记为已达成。运行时一旦回以新的修订号，两种决定都会立刻收起。
- 动词随一条 `action/goal-update` 意图发出，运行的是运行时自己的 `/goal <verb>` 命令，因此比较并交换的 ref、合法转换与拒绝文案都归该命令；其结果作为命令通知出现在消息流里，卡片随后重读它产生的状态。
- 卡片只为当前页签渲染；每个 `goal/*` 事件、页签切换与打开回放页签之后都会重读目标。
- 「折叠」把卡片收成标题行加一行省略号截断的目标描述——与待办卡同一个开关——因此长目标可以把消息区的地方让出来，同时不隐藏正在跑的是哪个目标。折叠会丢弃未完成的编辑或清除确认，而不是把它带进一个显示不了它的状态；新的修订号会保留用户选择的折叠态。

## 对话中的图片

- composer 通过粘贴、拖放或文件选择附加图片，并按字节声明媒体类型，而不是平台给的 `File.type`，因为运行时会拒绝与自身探测结果相矛盾的声明。
- 模型目录中不含 `image` 的路由会把附件以占位文本发给模型，composer 会在发送前于发送按钮上方明示这一点。
- 已发送的图片用 composer 自己的字节回显在用户气泡里。从日志折出的会话只带附件引用，因此它的每张图片都经 bridge 的 `attachment/read` 读回并补写到气泡上；存储已不再持有的图片只让该气泡不带它，而不会让整次重放失败。
- 被拒绝的发送会在 `send-failed` 横幅之后把文本与附件交回 composer，用户读到的就是运行时自己的消息。

## 运行时的解析

扩展不自带运行时：自身的 bundle 只带扩展代码，会话子进程运行的是环境提供的 `dsh`。每个窗口解析两类输入，激活时与每次启动时各解析一遍。

- **Node.js** —— `DSH_NODE_BIN`，其次 `dsh.nodeBin` 设置，再次 Extension Host 自带的 Node.js；校验 `^22.19.0 || >=24.0.0` 与 harness 所需的 API。
- **dsh CLI 入口** —— 启动选项 `dshBin`，其次 `DSH_BIN`，其次 `dsh.cliPath` 设置，其次工作区自己的 `@deepseek-ai/dsh` 依赖，其次工作区上方的 dsh 检出，其次 `PATH` 上的 `dsh`，最后是本扩展自身的安装。

显式配置的路径（`DSH_BIN`、`dsh.cliPath`）若不存在，会让解析直接失败而不落到自动来源，诊断里同时点名这两个杠杆。

激活时向 **DeepSeek Harness** 输出通道写一行：入口、提供它的来源、其包声明的版本，并与本扩展自身的版本并列，版本不一致不阻塞。没有任何来源提供运行时的窗口会在加载时报出来并列出它找过的每个来源；这类窗口里的启动在任何 bridge socket 打开之前就以 `dsh-entry` 失败。

```
dsh runtime check failed — source: none
Probed: DSH_BIN environment variable (unset); dsh.cliPath setting (unset); the workspace @deepseek-ai/dsh dependency (no @deepseek-ai/dsh in a node_modules at /work/app or above); the dsh executable on PATH (no dsh executable on PATH)
Actual: no source provided a dsh CLI entry point
Expected: a dsh CLI entry point: the "dsh" bin file of @deepseek-ai/dsh (lib/bin.js)
Fix: install @deepseek-ai/dsh in the workspace so its "dsh" bin is found automatically, or set DSH_BIN or the dsh.cliPath setting to one
```

## 双通道

- **SDK stdout** —— 仅 JSON-RPC（`initialize` / `session/prompt` / `shutdown`）加上服务端通知（`session.event`、`session.status`、`session.assistant-stream`、`subagent.*`）。stdout 上没有 `session/close` / `session/resume`。
- **Host bridge** —— UDS/named-pipe NDJSON，承载 `session/dispose`、`session/read-log`、`session/resume`、审批/提问，以及 permission RPC。bridge 流量绝不与 SDK 共用 stdout。

扩展**不**重新实现 agent-loop、工具执行或会话持久化（AC-15）。fail-closed 的审批 / 提问位于 `InteractionCoordinator` + `ide-bridge` 的终端应答方 —— 不在 `packages/core/agent-loop`。

## 可替换性（AD-8）

权威的传输 + 帧约定：[`@deepseek-ai/dsh-ide-bridge` README § Replaceability](../../packages/ide/ide-bridge/README.zh.md#replaceability-contract-ad-8)。本扩展只拥有 **UI presenter** 与 **permission picker** 两个面。

| 面 | 本应用中的 seam | 默认 | 能否不改 agent-loop 替换 |
|---|---|---|---|
| UI presenter | 经 `IdeSessionHost.setInteractionUi` / `InteractionCoordinator.setUi` 的 `InteractionUi` | `createVscodeInteractionUi`（QuickPick / InputBox） | 任何返回合法 `ApprovalOutcome` / `AskUserQuestionAnswer` 的对象；证明：`tests/replaceability-interaction-ui.spec.ts` |
| Auto-allow | `dsh.selectPermissionPreset` → Host `permission/select` | `workspace-write`；`danger-full-access` 映射为审批 `never` | 只经 `dsh-permission-presets` 切换档位 —— 不要在扩展里存一份平行策略 |
| 传输 | Host 以 `IdeBridgeHostServer` 监听 | UDS / named pipe | 在 ide-bridge 的 duplex / `NdjsonSocket` 层替换（内存证明也在那里） |

把 QuickPick 换成 Webview（或其它 presenter）、替换 bridge duplex、或选择某个 auto-allow preset，都必须留在 `apps/vscode-dsh` + `packages/ide/ide-bridge` 之内（AC-27 / AC-28）。
