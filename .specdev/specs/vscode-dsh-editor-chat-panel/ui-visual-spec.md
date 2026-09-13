# UI Visual Spec — vscode-dsh-editor-chat-panel

<!--
  companion to: requirements-ui.md
  audience: plan-generator / implementer / reviewer / verifier
  status: HG-UI passed 2026-09-13
  amended: 2026-09-13 HG-2 前审查 — §5.2/5.4/5.5/5.6、§9 并入 2 Phase、圆角上限
  created: 2026-09-13
  skill-assist: .trae/skills/ui-ux-pro-max（仅密度/空态/focus/反模式；已剔除落地页色板与外链字体）
-->

## 1. 目的

给实施与审查 AI 一个**可对齐的视觉概念**：在遵守 VS Code 主题变量的前提下，达到「IDE 原生 + Cursor 式薄顶栏对话」的可用级呈现。
**不是**品牌 redesign 说明书；**不是**后端设计。

必读顺序：`requirements.md`（行为）→ `requirements-ui.md`（UI Must）→ **本文**（怎么长什么样）。

---

## 2. 设计原则（硬约束）

| # | 原则 | 含义 |
|---|------|------|
| P1 | Theme-first | 背景/前景/边框/按钮/输入/链接全部跟 `--vscode-*`；`--dsh-*` 仅作派生别名 |
| P2 | Chrome 薄、内容重 | 顶栏与工具控件让位给消息阅读区 |
| P3 | 单一主列 | 主对话面为单列流（历史窗口为覆层或右侧/下方面板，不拆成仪表盘） |
| P4 | 中等密度 | 可扫读，不拥挤到误触，不留营销大留白 |
| P5 | 状态可见 | 活动 Tab、running、禁用原因、空态、loading 均有视觉位 |
| P6 | 克制动效 | 短过渡；尊重 `prefers-reduced-motion`；无霓虹/玻璃拟态 |

### 反模式（禁止默认采用）

- 独立 OLED 品牌色板、霓虹 accent、外链 Inter/Fira Google Fonts
- Neumorphism 厚软阴影、玻璃拟态、营销 Hero；**圆角上限以 §4 为准（`--dsh-radius-md` ≤6px，禁止加码到「大圆角营销卡片」）**
- Emoji 充当工具图标
- 去掉 focus outline 且无替代环
- 用 QuickPick 外观冒充历史窗口
- 展示 thinking/reasoning 面板（功能 O-3 / T6）

---

## 3. 布局骨架

```
┌─────────────────────────────────────────────────────────────┐
│ Chrome ~32–40px                                              │
│ [Tab][Tab*][…]  …scroll/overflow…   [+] [History] [Search] [⋮]│
├─────────────────────────────────────────────────────────────┤
│ Messages (flex:1, overflow:auto)                             │
│   · empty / loading 占位                                     │
│   · user bubble (次要底衬，偏右或右对齐标签)                    │
│   · assistant body (主阅读，弱分隔)                            │
│   · activity row (更矮、次要色，可折叠)                         │
│   · ref chips / change cards (附属块)                         │
├─────────────────────────────────────────────────────────────┤
│ Status / reject 一行（有则显示）                               │
├─────────────────────────────────────────────────────────────┤
│ Composer sticky                                              │
│   [ref chips…]                                               │
│   [  textarea 主区域  ]  [Stop?] [Send]                      │
│   禁用原因文案位（非 live 时）                                  │
└─────────────────────────────────────────────────────────────┘

历史窗口（顶栏 History 打开）：
┌──────────────────────┐
│ 搜索框（档1+2 联动）   │
│ 列表行 × N            │
│ 空态 / loading        │
└──────────────────────┘
（实现可为 Panel 内 modal/drawer/分栏；不得跳到仅 QuickPick）
```

---

## 4. Token 约定

```css
/* 只允许这类绑定；数值可调，来源不可换成品牌色 */
--dsh-fg: var(--vscode-foreground);
--dsh-bg: var(--vscode-editor-background);
--dsh-panel-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
--dsh-border: var(--vscode-panel-border, var(--vscode-widget-border));
--dsh-muted: var(--vscode-descriptionForeground);
--dsh-link: var(--vscode-textLink-foreground);
--dsh-input-bg: var(--vscode-input-background);
--dsh-input-fg: var(--vscode-input-foreground);
--dsh-btn-bg: var(--vscode-button-background);
--dsh-btn-fg: var(--vscode-button-foreground);
--dsh-btn-secondary-bg: var(--vscode-button-secondaryBackground);
--dsh-list-hover: var(--vscode-list-hoverBackground);
--dsh-focus: var(--vscode-focusBorder);
--dsh-error: var(--vscode-errorForeground);
--dsh-code-bg: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
--dsh-font: var(--vscode-font-family);
--dsh-font-mono: var(--vscode-editor-font-family, monospace);
--dsh-radius-sm: 4px;
--dsh-radius-md: 6px;
--dsh-space-1: 4px;
--dsh-space-2: 8px;
--dsh-space-3: 12px;
```

字号：跟随 `--vscode-font-size`；辅助信息 11–12px 等效；避免随意第三套比例。

---

## 5. 组件视觉规则

### 5.1 顶栏 Tab

| 项 | 规则 |
|----|------|
| 高度 | 约 32–40px 总 chrome；Tab 项紧凑 |
| 活动 | 底衬或 2px 底边 + 字重略增 |
| 非活动 | 较低对比；hover 用 `--dsh-list-hover` |
| Running | 小点/spinner 在标题旁，不盖字 |
| 角标 | 未读/审批用小徽章，靠标题尾 |
| 溢出 | 「…」或滚动，保证每未关 Tab 可达 |

### 5.2 消息气泡 / 主文

| 角色 | 规则 |
|------|------|
| User | 可右对齐或右侧标签；弱底衬；**避免** 粗三色左边框作为唯一识别 |
| Assistant | 左起主阅读宽；底衬近透明或极弱；靠排版层级而非重描边 |
| Notice | 居中、警告色 token、短文 |

相对现状（`buildThinChatHtml` 粗左边框双色气泡）：本 feature **必须**减弱描边权重，改为对齐 + 轻底衬 + 可选角色标签（禁止粗彩色描边主导）。

### 5.3 活动 / 引用 / 变更

| 块 | 规则 |
|----|------|
| Activity 折叠行 | 行高更矮；`--dsh-muted`；左侧细指示即可 |
| Activity 展开 | 缩进 + 等宽细节；不升格成第二篇回复 |
| Ref chip | 徽章态、mono 路径、hover focus 环 |
| Change 卡 | 次要面板边框；行 hover；展开 diff 限高滚动 |

### 5.4 Composer

| 项 | 规则 |
|----|------|
| 结构 | 上 chips、中 textarea、右/下 Send；**Stop 在 streaming 与停止中均显示**；停止中呈禁用态直至完成/失败（对齐 AC-33b） |
| 四态 | live 可发；**readonly = 禁用输入/发送 + 可见「继续此对话」CTA**（对齐 AC-20a/AC-53）；waiting/error 禁用 + 原因位 |
| 主按钮 | 使用 `--dsh-btn-*`；勿另造绿色营销 CTA |

### 5.5 历史列表行

| 项 | 规则 |
|----|------|
| 主信息 | 标题（一行省略）+ 相对时间 |
| 次信息 | 预览或变更路径（`--dsh-muted`） |
| 父子 | 「分支自 …」次要色一行 |
| 操作 | **默认**：hover 显示行尾 ⋮ 菜单（含删除/Continue 等）；**增强**：右键菜单。删除确认见 design（webview modal）。**禁止**三入口并列无默认 |
| 空态 | 短文案 + 新建/开始引导（非空白） |

### 5.6 生成中 / Status 指示（UI-AC-32）

| 项 | 规则 |
|----|------|
| Status 行 | `#status` / `[data-testid="status"]` 可承载「生成中…」/ 错误摘要 |
| 消息区 | streaming 期间 **必须**有可见反馈：末条助手区 shimmer/光标/「生成中」之一；**禁止**仅顶栏有文案而消息区静止 |
| 停止中 | Stop 按钮可见且禁用；status 可显示「正在停止…」 |
| Thinking | **禁止**（O-3 / T6） |

---

## 6. 开源对齐（前端路径级）

> Clone 后只读 UI；禁止移植其 agent 后端。

| 优先级 | 仓库 | 建议关注 | 对齐目标 |
|:--:|------|----------|----------|
| 1 | [PawanOsman/OpenCursor](https://github.com/PawanOsman/OpenCursor) | 侧栏/面板 chat 壳、Tab、模式切换条样式 | UF1 薄顶栏气质 |
| 2 | [continuedev/continue](https://github.com/continuedev/continue) | `gui/src/pages/gui/Chat.tsx`、`gui/src/components/mainInput/`、消息/代码块样式 | UF2/UF3 密度与输入区 |
| 3 | [arthurzengg/opencui](https://github.com/arthurzengg/opencui) 或 [ktmage/opencode-gui](https://github.com/ktmage/opencode-gui) | webview 历史列表、空态、工具折叠卡片 | UF4 历史行；活动卡弱层级 |

**明确不对齐**：Copilot Chat 对 VS Code Chat API 的深度耦合实现；任意项目的推理后端与 MCP 主机逻辑。

---

## 7. ui-ux-pro-max 采纳 / 拒绝

来源：`.trae/skills/ui-ux-pro-max`（2026-09-13 检索）。

| 采纳 | 拒绝 |
|------|------|
| 空态必须有引导文案+动作 | OLED 固定 `#000` / 霓虹 accent 色板 |
| Active 导航高亮 | 落地页 Hero / Single CTA 营销结构 |
| Focus ring 可见 | 外链 Inter / Fira / JetBrains 字体包 |
| 触控/点击间距 ≥8px | Neumorphism / 玻璃拟态 |
| 过渡 150–300ms；reduced-motion | 像素级品牌动画炫技 |
| 字号阶梯一致（跟 VS Code） | 把 Chat 做成 Dashboard 多卡墙 |

---

## 8. 相对现状的改造方向（给 implementer）

当前：`apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` → `buildThinChatHtml()` 内联 CSS（功能底盘）。

| 现状特征 | 目标方向 |
|----------|----------|
| 侧栏 WebviewView 背景感 | 编辑器区 Panel + `--vscode-editor-background` 为主 |
| `#chrome` 按钮横排 | 薄 Tab 条 + 图标型次要动作 |
| `.msg.bubble` 粗左边框 | 弱分隔 + 角色可辨 |
| 活动卡接近普通气泡 | 降权为 timeline-lite 行 |
| 无面板内历史列表视觉 | 按 §5.5 补列表 |

技术栈以 **`design.md` AD-ECP-8（React + Vite SPA）** 为准；本文只约束**最终 DOM 呈现结果**满足 UI-AC。

---

## 9. 层 V 核对清单（映射实际 2 Phase）

> design 定为 **2 Phase**。下列原「Phase 3」条目 **并入 Phase 2**，条目不得丢（C6）。

### Phase 1（壳 + 顶栏 + 历史骨架 + 最小可聊）

- [ ] Panel 打开后可见顶栏 Tab chrome（非 TreeView 冒充）；chrome ≤40px；消息区 flex:1
- [ ] 活动 Tab 可区分；新建/历史/搜索入口可见；溢出不挤爆消息区（UI-AC-14）
- [ ] **消息区**空态引导或 loading（UI-AC-24 骨架；非无文案白屏）
- [ ] 历史入口打开后为面板内列表或明确 loading/空态（非空窗、非仅 QuickPick）
- [ ] Composer sticky 底栏可见；`data-composer-state` 可挂；主题 light/dark 可读
- [ ] P1 已交付可点控件具备基础 hover/focus（UI-AC-50 基础；间距/动效精修 → P2）
- [ ] **不查**：完整四态人眼可分、Stop 完整、MD settle 精修（见 design P1 豁免）

### Phase 2（消息流 + 能力 + 完整历史 + 原 P3 无障碍）

- [ ] user/assistant 层级符合 §5.2；MD settle 后代码块可读+复制可见
- [ ] 活动/引用/变更视觉权重正确；§5.6 生成中指示可见
- [ ] composer 四态人眼可分；禁用有原因位；Stop 在 streaming/停止中可见
- [ ] 历史行含标题/时间/预览；行尾 ⋮ 默认可发现；父子可读
- [ ] 能力入口仍可发现且未回退成「演示按钮墙」
- [ ] focus/hover/reduced-motion 与 ≥8px 间距满足 UI-AC-50–52（原 P3 并入）

---

## 10. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-13 | 初稿；绑定 requirements-ui；纳入 skill 可用项并剔除换皮项 |
| 2026-09-13 | HG-UI passed；§5.2 必须减弱描边；§5.4 Stop/readonly 锁死；§5.5 默认 ⋮；§5.6 生成中；§9 并入 2 Phase；圆角 ≤6px |
| 2026-09-13 | 复检：§9 P1 加消息区空态 + UI-AC-50 基础 hover/focus |
