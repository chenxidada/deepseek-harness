# Phase 1: 编辑器壳层与顶栏多会话 Tab

**Phase ID:** `phase-1-editor-shell-tabs`  
**DAG 依赖:** 无

## 目标

将 Conversation **唯一主聊天面**迁到编辑器区单例 `WebviewPanel`；在面板内实现顶栏多会话 Tab chrome（对齐 `ConversationRegistry`）；废弃侧栏 `dsh.chat` WebviewView 与 TreeView Tab 主路径；保留最小可发送 composer。

用户一次能感到：**聊天在编辑器区，顶栏能切换/新建会话，侧栏不再是主聊天。**

## 前置条件

| 依赖 | 说明 |
|------|------|
| `requirements.md` | HG-1 已通过；Q-1=A / Q-2=A |
| `design.md` | AD-ECP-1 / AD-ECP-2 |
| `constitution.md` §7 | 壳层 + 面板内 Tab |
| 代码基线 | `chat-panel-provider.ts` / `chat-panel-host.ts` / `conversation-registry.ts` / `conversation-tab-bar.ts` / `conversation-controller.ts` |
| tech-debt-registry | 当前无活跃阻塞债 |

## 验收标准（本 Phase AC 子集）

**AC-1**（普遍型）：系统 **必须** 将 Conversation 主聊天面承载于编辑器区 `WebviewPanel`；**必须不**将「仅侧栏 `WebviewView` 窄面」作为唯一或主聊天面。

**AC-2**（事件驱动型）：**当** 用户执行「打开 Conversation / 显示对话」主入口（如 `dsh.showPanel` 或等价）时，系统 **必须** 打开或聚焦 Editor Chat Panel，并使其在编辑器区可见。

**AC-3**（状态驱动型）：**在** Panel 已打开且已绑定 Host 期间，决策态（`mode` / `sessionId` / 发送门闩等）**必须**由 Host 下发；Webview **必须不**自行裁定能否发送。

**AC-4**（不期望行为型）：**如果** 用户尝试已废弃的侧栏主聊天 `WebviewView` 路径，**那么** 系统 **必须** 打开/聚焦 Editor Chat Panel（或明确提示已迁移），**必须不**再提供可读写的第二套侧栏消息流。

**AC-5**（普遍型）：系统 **必须** 只保留一个主聊天界面；侧栏 Conversations TreeView Tab 条 **必须不**再作为多会话主切换面。

**AC-10**（普遍型）：Panel 内顶栏 **必须** 展示多会话 Tab chrome（标题、活动态可区分），投影 Registry 未关集合；**必须不**仅以侧栏 TreeView 冒充本条。

**AC-11**（事件驱动型）：**当** 用户点击非活动顶栏 Tab 时，系统 **必须** 切换 `activeTabId` 与消息流/composer 目标 `sessionId`，**必须不**串台。

**AC-12**（事件驱动型）：**当** 用户激活顶栏「新建」时，系统 **必须** 创建新 `tabId`+`sessionId`，设为活动，展示可输入空态。

**AC-13**（事件驱动型）：**当** 用户关闭顶栏 Tab 时，系统 **必须** 执行前序关 Tab 策略并更新顶栏投影。

**AC-15**（状态驱动型）：**在** 多个未关 Tab 期间，顶栏 **必须** 同时展示可区分的活动与非活动 Tab。

**AC-16**（不期望行为型）：系统 **必须不** 为每个会话强制打开独立 VS Code editor tab 作为多会话主模型。

**AC-33**（普遍型，本 Phase 最小集）：Editor Chat Panel **必须** 提供 composer：live 可发送；空输入/无会话/Host 未就绪时拒绝发送并有可感知反馈。（完整「生成中可停止」在 Phase 2 验收 AC-23/33 全量。）

**AC-40**（普遍型）：本 Phase 达标 **必须** 同时具备层 A + 层 B + **至少 1 条层 V**；**必须不**仅以层 A/B 宣称完成。

**AC-41**（普遍型，本 Phase 子集）：层 V 清单 **必须** 覆盖 V-1…V-4（编辑器区 Panel、顶栏 Tab chrome、活动 Tab 可区分、composer 可见）。

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 静态检查 + 运行时 | `package.json` 无 `dsh.chat` webview 主贡献；Extension Host 打开后主面为 WebviewPanel | 编辑器区 Panel；侧栏无主消息流 |
| AC-2 | 运行时 / 层 B | 执行 `dsh.showPanel`；断言 Panel 存在且可见 | Panel revealed |
| AC-3 | 层 B | FakeWebview：Host `panel/state` 控制 send gate；Webview 直接发 send 在未就绪时收到 reject | 门闩在 Host |
| AC-4 | 运行时 / 静态 | 无第二套 messages 投影路径；旧 view 触发则 redirect | 无双聊天面 |
| AC-5 | 静态 + 层 B | activate 不注册 Conversations TreeView 为主 Tab，或仅 launcher | 切换只经顶栏 |
| AC-10 | 层 A | jsdom：`[data-testid="tab-bar"]` + tabs 投影 snapshot | DOM 契约成立 |
| AC-11 | 层 B | FakeWebview `action/switch-tab` → Registry.active + messages/replace 目标 session | 不串台 |
| AC-12 | 层 B | `action/new-conversation` → 新 tab/session + 空态 | 可立即输入 |
| AC-13 | 层 B | close-tab → 前序 close 策略 + `panel/tabs` 更新 | 顶栏同步 |
| AC-15 | 层 A / 层 V | 两 Tab 时活动态属性可区分 | `data-active` 正确 |
| AC-16 | 静态 / 层 B | 切换 Tab 不 `createWebviewPanel` 每会话 | 全局单 Panel |
| AC-33 | 层 B | live 发送成功；空输入 reject | 门闩反馈可见 |
| AC-40/41 | 层 V | Extension Host：打开 Panel，勾选 V-1…V-4 | 清单全过；否则 FAIL |

### 本 Phase 层 V 清单（Must）

| ID | 核对项 |
|----|--------|
| V-1 | 编辑器区可见 Conversation Panel（非仅侧栏窄 WebviewView） |
| V-2 | 顶栏 Tab chrome 可见 |
| V-3 | 活动 Tab 与非活动 Tab 可区分 |
| V-4 | composer（输入区 + 发送）可见 |

## 约束

- Q-1=A / Q-2=A 已锁定；不得保留可读写侧栏主面；不得每会话一 editor tab。
- **不重做** `ConversationRegistry` 身份模型；复用 `conversationTreeItems` 标题/未读规则。
- `ChatPanelHost.attach` 端口抽象保持；`retainContextWhenHidden: true`。
- 历史/搜索完整 UI、Markdown settle、Timeline 弱化 → **不在本 Phase**（可占位可见但未接线须在 implementation 偏差或 registry 标明，且不得阻塞本 Phase AC）。
- thinking UI / 档 3 / 像素 redesign → Out。

## 产出清单

- [ ] 单例 Editor Chat Panel 注册与 `dsh.showPanel` 聚焦路径
- [ ] 废弃 `dsh.chat` WebviewView 主贡献与双消息流
- [ ] TreeView Tab 主路径移除/降级
- [ ] `panel/tabs` + 顶栏 DOM + switch/new/close 接线
- [ ] 最小 composer 发送门闩（Host 权威）
- [ ] 层 A/B 测试 + 层 V 场景写入 `verification.md`
- [ ] `implementation.md` / 必要时更新 `tech-debt-registry.md`
