# Phase 1: React 壳 + 顶栏 Tab + 基础历史 + 最小可聊

<!--
  phase-id: phase-1-shell-tabs-basic-history
  slug: vscode-dsh-editor-chat-panel
  design: ../../design.md
  ui: ../../requirements-ui.md + ../../ui-visual-spec.md
  stack: React + Vite webview SPA (AD-ECP-8)
-->

## 目标

交付编辑器区唯一主聊天面（`WebviewPanel` + **React+Vite SPA**）、面板内顶栏多会话 Tab（对齐 `ConversationRegistry`）、生命周期（主动打开、恢复未关 Tab、外部切会话、waiting/error 可见、关 Panel×running 后台继续+提示、不自动弹 Panel），顶栏历史入口→**面板内基础可浏览历史列表**（AC-50a），以及既有 send/stream **最小可聊**通路。同步交付 MessageBridge、DOM 契约、`__dshProbes`（或等价）、CSP/`asWebviewUri` 冒烟与 **React Testing Library 层 A** 基建。侧栏主聊天可读写路径废弃。视觉：薄顶栏 + IDE 原生 token（UF0/UF1/UF4 骨架）。

## 前置条件

| 依赖 | 说明 |
|------|------|
| `requirements.md` HG-1 | passed |
| `requirements-ui.md` HG-UI | passed |
| `ui-visual-spec.md` | 实施必读（呈现结果；技术栈见 design AD-ECP-8） |
| `design.md` AD-ECP-1…5, **8, 9, 10** | HG-2 确认后实施 |
| 前序基线 | Registry、ChatPanelHost、ExtensionIndex、既有 send/stream 协议 |
| 依赖 Phase | **无** |

## 验收标准（功能）

| ID | 摘要 |
|----|------|
| AC-1 | 主面 = 编辑器区 WebviewPanel；非仅侧栏 WebviewView |
| AC-1b | 打开恢复未关 Tab / 空态引导 |
| AC-1c | 外部打开聚焦并切会话 |
| AC-1d | 未连接/等待/错误可见；composer 禁用有因 |
| AC-1e | 关 Panel×running：后台继续+可见提示；不静默 cancel |
| AC-1f | 不因未关会话自动弹 Panel |
| AC-2 | 主入口打开/聚焦 Panel |
| AC-3 | 决策态 Host；Webview/React 不自裁能否发送 |
| AC-4 | 废弃侧栏主聊天路径 → 主面或迁移提示 |
| AC-5 | 单一主面；TreeView 不作多会话主切换 |
| AC-10 | 面板内顶栏 Tab chrome（React） |
| AC-10a | running + 角标可见 |
| AC-10b | 标题可区分 |
| AC-10c | Registry 变更顶栏实时更新 |
| AC-11 | 切 Tab 不串台 |
| AC-11a | 回 Tab 恢复呈现态或确定性默认 |
| AC-11b | 层 A+B：流随 activeTabId |
| AC-12 | 新建 → 新 session + 可输入空态 |
| AC-13 | 关 Tab：可恢复策略 + running 确认 |
| AC-13a | 关活动 Tab fallback / 全关空态 |
| AC-13b | 关 running Tab 须确认 |
| AC-14 | 顶栏历史入口 → 面板内历史窗口；搜索入口可见（完整档1+2 → P2） |
| AC-14c | Tab 溢出/滚动可达 |
| AC-15 | 活动/非活动可区分 |
| AC-16 | 禁止每会话一个 editor tab 主模型 |
| AC-40 | 本 Phase 层 A+B+≥1 层 V |
| AC-42 | 仅单测绿无层 V → 不得 PASS |
| AC-43 | plan 为 2–3 Phase（本 plan=2） |
| AC-50 | 面板内历史窗口可经顶栏打开 |
| AC-50a | 历史入口不得空窗；本 Phase 至少基础列表 |
| AC-51 | 条目：标题、时间、预览或路径 |
| AC-52 | 点击：已有 Tab 则激活；否则只读打开；不 auto-Start |
| AC-58 | 空态/loading；不白屏 |

**本 Phase 不验收（归属 Phase 2，须 registry 登记若留桩）：**
AC-13c / AC-14a / AC-14b、F2 全文（含 **AC-23a** 完整失败文案）、F3 能力闭环、AC-53–57/59/60、AC-41 完整四态清单、AC-33b Stop。
**P1 对 streaming 边界**：Must fail-closed 结束 streaming 指示（AC-25）；AC-23a 可理解原因与可操作提示 → P2。

## 验收标准（UI）

| ID | 摘要 |
|----|------|
| UI-AC-1 | 顶栏+消息区+底栏 composer 主面对局 |
| UI-AC-2 | `--vscode-*` / `--dsh-*`；无外链字体/独立换皮 |
| UI-AC-3 | 薄 chrome、消息区主导、中等密度 |
| UI-AC-10 | 顶栏薄于消息区（约 32–40px） |
| UI-AC-11 | 活动 Tab 明确区分 |
| UI-AC-12 | running/角标可见且不挡标题 |
| UI-AC-13 | 新建/历史/搜索/溢出可发现、权重低于主文 |
| UI-AC-14 | 溢出不挤爆消息区 |
| UI-AC-24 | 消息区空态/loading 骨架 |
| UI-AC-40 | 历史为面板内列表行外观 |
| UI-AC-41 | 历史空态/loading 视觉 |
| UI-AC-50 | **P1 已交付控件**基础 hover/focus（精修 → P2） |
| UI-AC-60 | 本 spec 已引用 UI 文档 |
| UI-AC-61 | 层 V 对照 §9 **Phase 1** 清单（含 P1 豁免） |

**P1 豁免（详见 design AD-ECP-10）：** UI-AC-30 完整四态、UI-AC-32/Stop 完整、UI-AC-20/23 精修、UI-AC-42/43、UI-AC-51/52。**不豁免** UI-AC-24、UI-AC-50 基础。P1 composer 须 sticky + `data-composer-state`；streaming 允许仅 `[data-testid="status"]`。

## 设计验收锚点（本 Phase）

| 锚点 | 要求 |
|------|------|
| AD-ECP-8 | Panel 生产 HTML = React SPA；**非** `buildThinChatHtml` 主路径 |
| AD-ECP-10-P1 | MessageBridge；DOM 契约；`__dshProbes`（层 V/e2e，RTL 不依赖探针）；CSP/`asWebviewUri`；**打包/CI/VSIX** 冒烟；RTL 层 A；旧层 A 不得作本 Phase UI PASS |
| AD-ECP-4 | 关 Panel×running → `showInformationMessage`（+可选 status bar） |
| AD-ECP-11 | `retainContextWhenHidden: true` |
| 先建后拆 | 新壳最小可聊通后再弃侧栏主聊 |

### 本 Phase DOM 契约（最低集）

`editor-chat-root`、`tab-chrome`、`tab-item`+`data-tab-id`/`data-active`、`btn-new-tab`/`btn-history`/`btn-search`/`btn-overflow`、`history-panel`/`history-row`/`history-empty`/`history-loading`、`composer`+`data-composer-state`、`status`、`messages-empty`/`messages-loading`、`msg`+`data-message-id`+`data-role`（最小可聊）。

## 层 V 核对清单（本 Phase）

来自 `ui-visual-spec.md` §9 Phase 1（**不含**完整四态/Stop/MD 精修）：

- [ ] Panel 打开后可见顶栏 Tab chrome（非 TreeView 冒充）；chrome ≤40px
- [ ] 活动 Tab 可区分；新建/历史/搜索入口可见；溢出不挤爆消息区
- [ ] **消息区**空态/loading（UI-AC-24）
- [ ] 历史入口打开后为面板内列表或明确 loading/空态（非空窗、非仅 QuickPick）
- [ ] Composer sticky 底栏可见；主题 light/dark 可读
- [ ] P1 已交付控件基础 hover/focus（UI-AC-50 基础）

另须：关 Panel×running → InformationMessage（AC-1e）；SPA/VSIX 干净宿主非白屏；streaming fail-closed（AC-25）；**先建后拆**已满足。

## 约束（架构）

- AD-ECP-1…5, **8, 9, 10**（`design.md`）
- 宪法 §7.1–7.9
- 决策态 Host；复用 Registry / Host / Index；不重做协议
- **主呈现路径 = React+Vite**；禁止本 Phase 以模块化内联 HTML 作为 Panel 生产壳
- 禁止 Should；禁止历史入口空窗；禁止用旧 `buildThinChatHtml` 层 A 冒充新 UI

## 产出清单

| 产出 | 说明 |
|------|------|
| `apps/vscode-dsh/webview/` | React+Vite SPA 源码与构建 |
| Editor Chat Panel 单例 | `editor-chat-panel.ts` + SPA HTML / asWebviewUri |
| MessageBridge + probes | 帧↔store；`__dshProbes` |
| 顶栏 Tab chrome | Registry 投影 |
| 历史骨架 UI | 面板内列表 + 空态/loading + 打开规则 |
| 最小可聊 | send/stream → React 渲染闭环 |
| 侧栏主聊天降级 | AC-4/5 |
| 测试 | RTL 层 A 冒烟 + 层 B FakeWebview + ≥1 层 V + CSP 冒烟 |
| `buildThinChatHtml` | 标 deprecated；生产 Panel 不再使用 |
| `implementation.md` + 延后能力 `@STUB` + registry | |

## 不在范围内（本 Phase）

- 完整 Markdown settle 视觉升级、活动/引用/变更闭环、composer 四态收齐
- 顶栏删除完整流 / 历史删除 / Continue / 父子 / 档1+2 搜索联动（Phase 2）
- Timeline 弱化落地（Phase 2）
- 删除内联源码文件可延至 P2（但 **不得** 继续作为生产主路径）
- thinking UI、搜索档 3、像素级 redesign

## 验证提示（给 verifier）

| 层 | 示例 |
|----|------|
| A | RTL：顶栏 Tab、历史列表、消息节点契约；**拒绝**仅 `buildThinChatHtml()` 字符串测试 |
| B | FakeWebview：不自动 open；dispose+running 未 cancel；tabs/history/state 帧 |
| V | 真机：React Panel 薄顶栏+历史列表/空态；双主题抽检 |
| 闭环 | composer send → Host → messages → React 渲染可观测 |
