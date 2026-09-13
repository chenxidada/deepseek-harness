# Requirements (UI): vscode-dsh-editor-chat-panel

<!--
  slug: vscode-dsh-editor-chat-panel
  kind: ui-supplement
  audience: plan-generator / implementer / reviewer / verifier / HG-UI
  language: zh (canonical)
  companion: ui-visual-spec.md
  parent: requirements.md（行为真相源；本文为 UI 补充，不替代功能 AC）
  status: HG-UI passed 2026-09-13
  amended: 2026-09-13 HG-2 前审查 — E14 元规则、软措辞消除、映射表、Phase 列
  created: 2026-09-13
-->

## 文档关系（必读）

| 文档 | 职责 |
|------|------|
| [`requirements.md`](./requirements.md) | **功能 / 行为 / 协议** 真相源（HG-1 passed）。行为冲突时以它为准。 |
| **本文 `requirements-ui.md`** | **呈现 / 样式 / 信息层级 / 可发现视觉** 的 Must 需求（HG-UI passed）。 |
| [`ui-visual-spec.md`](./ui-visual-spec.md) | 视觉契约细节；标定值与层 V 清单。 |

**E14 适用范围（元规则）**：功能需求 E14 / AC-45「无 Should」**同等约束本文全部 UI-AC**。禁止「建议 / 可选 / 若存在则…可不定」作为验收逃逸；凡涉及数值/时限，以 `ui-visual-spec.md` **标定值为准**，偏离须在 `design.md` 记录并经 HG-2/偏差章节批准。

**冲突裁决**：行为语义以 `requirements.md` 为准；纯视觉呈现以本文 + `ui-visual-spec.md` 为准。若视觉方案会改变行为语义 → 必须回功能需求修订。

**Phase 分期**：每条 UI-AC 的「最低交付 Phase」见下文映射表；P1 层 V **仅**核对已交付子集（见 design P1 豁免清单），**不得**用未交付的 UI-AC-30 四态等人眼项卡死 P1 PASS（C4 消解）。

**进入方案设计的前置**：功能 HG-1 **且** HG-UI 已确认（本文 status=passed）。

---

## 术语（UI 专用，补全功能术语）

| 术语 | 含义 |
|------|------|
| **Chrome** | 顶栏 Tab 条、历史/搜索/新建/溢出等面板外壳控件（非消息正文） |
| **信息层级** | 主文（user/assistant）> 活动/变更卡 > 元信息/角标 > 装饰 |
| **IDE 原生感** | 颜色/字体/边框跟随 VS Code theme tokens；不引入独立品牌皮肤 |
| **可用级视觉** | 人眼可扫读：间距一致、状态可区分、空态有引导、交互有 hover/focus |
| **视觉契约** | `ui-visual-spec.md` 中的布局、密度、反模式与对齐参考 |

---

## 产品目标（UI）

在不重做协议栈的前提下，把 Editor Chat Panel 从「功能演示底盘」提升为 **IDE 原生、Cursor 式薄顶栏对话面**：薄 chrome、消息区为主、composer 稳固底部、历史窗口列表可读，使日常开发可敢用且入口可发现。

## 问题陈述（UI）

| 表面 | 现状 | 本 UI 需求要解决 |
|------|------|------------------|
| 气质 | 粗边框气泡 + 按钮条 chrome，偏「功能探针」 | 对齐 Cursor/Continue 式对话密度与层级 |
| 顶栏 | TreeView 侧栏 Tab，非面板内 chrome | 面板内薄 Tab 条视觉 |
| 历史 | 易靠 QuickPick | 面板内列表行视觉 + 空态 |
| AI 实施 | 功能 AC 不描述「长什么样」 | 可验证的视觉 Must + 契约文档 |

## 目标终态（UI）

1. 打开 Panel：一眼是「编辑器区主对话面」，非侧栏窄条放大版。
2. 顶栏：薄、可扫；活动 Tab / running / 角标可区分；溢出不挤爆消息区。
3. 消息流：user/assistant 层级清晰；活动/变更弱于主文；MD settle 后可阅读。
4. Composer：四态视觉可辨；禁用有原因文案位。
5. 历史窗口：列表行（标题/时间/预览）+ 空态/loading；删除/Continue 入口可见但不喧宾夺主。
6. 全程 IDE 原生 token；无独立品牌换皮。

---

## 已拍板（UI）

| ID | 决议 |
|----|------|
| **U1** | 视觉目标 = **IDE 原生 + Cursor 式薄顶栏对话**；参考开源 **仅前端样式/布局**（Continue / OpenCursor / OpenCUI），**禁止** 抄后端/协议。 |
| **U2** | 颜色、字体、边框、控件态 **优先** `--vscode-*`（及少量 `--dsh-*` 派生）；**禁止** 外链字体 CDN、禁止独立主色板换皮。 |
| **U3** | 遵守功能需求 O-1：不做像素级品牌 redesign / 动画炫技；本文要求的是 **可用级视觉与层级**，不是营销落地页。 |
| **U4** | 遵守功能 T6/O-3：**不** 做 thinking/reasoning 展示 UI。 |
| **U5** | 层 V（人眼可见）验收时，verifier **必须** 对照本文 UI-AC + `ui-visual-spec.md` 关键清单（不仅对照功能 AC）。 |
| **U6** | `/plan` 与各 Phase `spec.md` **必须** 引用本文；implementer **必须** 读 `ui-visual-spec.md`。 |
| **U7** | 本文受 E14 约束（见文档关系元规则）；软数值以 visual spec 标定值为准。 |

### 待拍（UI）

无。HG-UI 已通过；默认 **Cursor 薄顶栏 + Continue 消息密度**。

---

## 范围

### 在范围内（全部 Must）

- 布局骨架：顶栏 chrome / 消息流 / sticky composer / 历史窗口覆层或分栏。
- 信息层级与密度、空态/loading/错误条视觉。
- Tab / 气泡 / 活动卡 / 引用 chip / 变更卡 / composer / 历史列表行的呈现规则。
- Hover / focus / 禁用态可见性；图标用 SVG/codicon 风格，不用 emoji 当图标。
- 开源前端对齐清单（路径级，见视觉契约）。

### 不在范围内

| ID | 排除 |
|----|------|
| UO-1 | 修改 `requirements.md` 功能 AC / 协议 / Host 决策语义 |
| UO-2 | 像素级品牌 redesign、玻璃拟态、霓虹 glow、营销动效 |
| UO-3 | thinking UI、搜索档 3、新 agent-loop |
| UO-4 | 强制迁移到 React/Vue（技术选型留给 design；本文只约束呈现结果） |
| UO-5 | 以截图像素 diff 作为唯一门禁（可作辅助） |

---

## 功能区域（UI）

- **UF0** 整体气质与 token
- **UF1** 顶栏 Chrome / Tab
- **UF2** 消息流与卡片层级
- **UF3** Composer 与状态条
- **UF4** 历史窗口列表
- **UF5** 动效与无障碍底线
- **UF6** 设计输入与验收绑定

---

## 验收标准（EARS）

> 编号前缀 **UI-AC-***，与功能 `AC-*` 并列、互不替代。

### UF0 — 气质与 token

**UI-AC-1**（普遍型）：Editor Chat Panel **必须** 呈现为编辑器区主对话面布局，并满足 `ui-visual-spec.md` §3：顶栏 chrome 总高约 32–40px、消息区 `flex:1`、composer sticky 底栏；**必须不** 将「侧栏窄条控件堆叠」原样放大作为最终视觉。

**UI-AC-2**（普遍型）：颜色、边框、前景/背景、按钮态 **必须** 派生自 VS Code theme CSS 变量（及文档标明的 `--dsh-*`）；**必须不** 引入独立品牌主色板或外链 Web 字体作为默认外观。

**UI-AC-3**（普遍型）：视觉气质 **必须** 对齐「薄 chrome、消息区占主导、中等信息密度」；**必须不** 以厚重多阴影卡片墙或营销 Hero 布局作为主面。

### UF1 — 顶栏 Chrome

**UI-AC-10**（普遍型）：面板内顶栏 Tab chrome **必须** 视觉上薄于消息区（高度与字号见 `ui-visual-spec.md` §5.1）；**必须不** 用占满上半屏的大按钮条冒充 Tab。

**UI-AC-11**（状态驱动型）：**在** 多 Tab 存在期间，活动 Tab **必须** 有明确视觉区分（底衬与/或下划线等）；非活动 Tab **必须** 可扫读标题；**必须不** 全部 Tab 视觉同权。

**UI-AC-12**（状态驱动型）：**在** 会话 running 或存在未读/审批角标期间，指示 **必须** 可见且不遮挡标题可读性；**必须不以颜色为唯一区分手段**，须有形状/位置/字形辅助（色盲可辨）。

**UI-AC-13**（普遍型）：新建、历史、搜索、溢出入口 **必须** 在顶栏可发现且视觉权重低于消息主文；**必须不** 用与主发送按钮同级的大块 CTA 铺满顶栏。

**UI-AC-14**（普遍型）：Tab 或动作溢出时 **必须** 提供滚动/溢出菜单，使消息区主阅读高度不被顶栏挤占至不可用；**必须不** 让 chrome 纵向扩张挤爆消息区（与目标终态 2 对齐）。

### UF2 — 消息流与卡片

**UI-AC-20**（普遍型）：user 与 assistant 消息 **必须** 可一眼区分（对齐、底衬或标签之一即可）；assistant 主文 **必须** 以可读正文为主；**禁止**粗彩色描边主导层级（允许弱分隔）。

**UI-AC-21**（普遍型）：活动项（折叠行）视觉权重 **必须** 弱于 assistant 主文（更矮行高/次要前景色）；展开后细节 **必须** 缩进可读；**必须不** 与主回复气泡同权重抢视线。

**UI-AC-22**（普遍型）：引用 chip 与变更/diff 卡 **必须** 可识别为「可操作附属块」；**必须不** 与正文段落无差别混排导致无法点击发现。

**UI-AC-23**（状态驱动型）：**在** Markdown settle 之后，标题/段落/列表/代码块 **必须** 层级分明、代码块可读且复制入口可见；**必须不** 以不可读纯文本堆或空白壳收场（与功能 AC-21 对齐，本文约束呈现质量）。

**UI-AC-24**（状态驱动型）：**在** 空会话或加载中，消息区 **必须** 显示空态引导或 loading 指示；**必须不** 无文案白屏。

### UF3 — Composer 与状态

**UI-AC-30**（普遍型）：composer **必须** sticky 于面板底部，输入区为主、发送/停止为辅；四态（live / readonly / waiting / error）**必须** 人眼可区分。**最低交付 Phase = P2**；P1 仅须挂 `data-composer-state` 骨架并可区分 live vs 非 live，完整四态层 V 延至 P2（见 design P1 豁免；延期不得作 P1 PASS 借口外的漏验）。

**UI-AC-31**（状态驱动型）：**在** 禁用发送期间，控件 **必须** 呈现禁用态，并在可见区域展示原因或等价提示位；**必须不** 看起来可点却无反馈。

**UI-AC-32**（状态驱动型）：**在** streaming / 停止中，状态指示 **必须** 在消息区或 status 行可见（见 `ui-visual-spec.md` §5.6）；**必须不** 仅靠顶栏文案而消息区毫无生成中反馈（允许轻量指示，禁止 thinking 面板）。

### UF4 — 历史窗口

**UI-AC-40**（普遍型）：历史窗口 **必须** 呈现为面板内可浏览列表（行：标题、时间、预览或路径）；**必须不** 以命令面板 QuickPick 的外观冒充本窗口。

**UI-AC-41**（状态驱动型）：**在** 无历史或加载中，**必须** 有空态/loading 视觉；**必须不** 打开空壳无字窗口。

**UI-AC-42**（普遍型）：条目上的 Continue / 删除等操作 **必须** 可发现；**默认入口**为行尾 ⋮（hover 显示），右键为增强；视觉权重 **必须** 低于标题与预览主信息；**必须不** 每行常驻一排大战场按钮（与 visual-spec §5.5 一致）。

**UI-AC-43**（状态驱动型）：**在** 展示 fork 子会话期间，父子关系提示 **必须** 可读（如次要色「分支自 …」）；**必须不** 与普通会话行无法区分。

### UF5 — 动效与无障碍

**UI-AC-50**（普遍型）：可点击控件 **必须** 有 hover 与键盘 focus 可见反馈；**必须不** 去掉 outline 且无替代 focus 环。**P1**：凡本 Phase 已交付的可点控件（Tab、新建/历史/搜索/溢出等）**必须**满足基础 hover/focus；**P2**：间距/动效精修与全控件覆盖（见映射表）。

**UI-AC-51**（普遍型）：过渡动效 **必须** 落在 `ui-visual-spec.md` 标定区间（150–300ms），并尊重 `prefers-reduced-motion`；无过渡时视为 0ms（允许）；**必须不** 使用长时装饰动画或霓虹 glow 作为默认。偏离标定值须在 design 记录。

**UI-AC-52**（普遍型）：相邻可点目标 **必须** 保持 ≥8px 等效间隙（visual-spec 标定）；图标 **必须** 使用 SVG/codicon 风格；**必须不** 用 emoji 充当工具图标。偏离 ≥8px 须在 design 记录。

### UF6 — 设计绑定与验收

**UI-AC-60**（普遍型）：`plan-generator` 产出的 `design.md` / `phase-plan.md` / 各 Phase `spec.md` **必须** 显式引用本文与 `ui-visual-spec.md`；**必须不** 仅复制功能 AC 而忽略视觉契约。

**UI-AC-61**（普遍型）：每 Phase 含 UI 交付时，verifier 层 V **必须** 至少核对 `ui-visual-spec.md` §9 中**映射到该 Phase**的清单条目（含原「P3」并入 P2 的条目）；**必须不** 仅用层 A DOM 存在性宣称视觉完成；**必须不** 用未映射到本 Phase 的条目卡 PASS。

**UI-AC-62**（不期望行为型）：**如果** 实施引入与 U2/U3 冲突的独立换皮或炫技，**那么** reviewer **必须** 按偏离程度判 MUST-FIX 或 SHOULD-FIX。说明：此处 SHOULD-FIX / MUST-FIX 为**评审处置等级**（reviewer verdict），**不是**需求范围等级，与 E14「无 Should 范围」不冲突；**必须不** 以「更好看」覆盖契约。

---

## UI-AC ↔ 功能 AC ↔ Phase（机械可校验）

| UI-AC | 对齐功能 AC | P1 | P2 | 备注 |
|-------|-------------|:--:|:--:|------|
| UI-AC-1 | AC-1, AC-2 | ✓ | — | §3 布局 |
| UI-AC-2 | —（主题） | ✓ | — | |
| UI-AC-3 | — | ✓ | — | |
| UI-AC-10 | AC-10 | ✓ | — | |
| UI-AC-11 | AC-15 | ✓ | — | |
| UI-AC-12 | AC-10a | ✓ | — | |
| UI-AC-13 | AC-14 | ✓ | — | |
| UI-AC-14 | AC-14c | ✓ | — | |
| UI-AC-20 | AC-20 | — | ✓ | |
| UI-AC-21 | AC-30 | — | ✓ | |
| UI-AC-22 | AC-31, AC-32 | — | ✓ | |
| UI-AC-23 | AC-21, AC-21a, AC-36a | — | ✓ | |
| UI-AC-24 | AC-20b | ✓ 骨架 | ✓ 完善 | 消息区空态/loading；§9 P1 已列 |
| UI-AC-30 | AC-33, AC-20a, AC-53 | 骨架 | ✓ | P1：`data-composer-state`+live；P2：四态人眼可分 |
| UI-AC-31 | AC-33a, AC-1d | 部分 | ✓ | P1：waiting/error 可见即可 |
| UI-AC-32 | AC-22, AC-33b | 部分 | ✓ | P1：允许仅 status 行；P2：§5.6+Stop |
| UI-AC-40 | AC-50, AC-51 | ✓ | — | |
| UI-AC-41 | AC-58, AC-50a | ✓ | — | |
| UI-AC-42 | AC-54, AC-55 | — | ✓ | |
| UI-AC-43 | AC-57 | — | ✓ | |
| UI-AC-50 | — | ✓ 基础 | ✓ 精修 | P1 已交付控件 hover/focus；P2 全量+精修 |
| UI-AC-51 | — | — | ✓ | 动效标定 |
| UI-AC-52 | — | — | ✓ | ≥8px 精修（P1 不因间距卡死） |
| UI-AC-60 | — | design | design | |
| UI-AC-61 | AC-40–42 | ✓ | ✓ | 按本表映射 |
| UI-AC-62 | U2/U3 | 持续 | 持续 | review |

---

## 开源对齐（前端 only）

详细路径见 `ui-visual-spec.md` §开源对齐。摘要：

| 优先级 | 项目 | 借什么 |
|:--:|------|--------|
| 1 | OpenCursor | 薄顶栏 / 多 Tab 气质 |
| 2 | Continue `gui/` | 消息密度、输入区、代码块/复制 |
| 3 | OpenCUI / opencode-gui | 历史列表行、空态 |
| — | 任意 | **不** 借 agent-loop / MCP / provider |

---

## 风险

| ID | 内容 | 缓解 |
|----|------|------|
| UR-1 | AI 把 UI 需求理解成换皮落地页 | U2/U3 + 反模式表 |
| UR-2 | 只做功能 AC 忽略视觉 | UI-AC-60/61 绑定 plan/层 V |
| UR-3 | 抄开源后端 | 本文反复限定前端 only |

---

## 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-13 | 初稿：补充 UI 需求与 EARS UI-AC；待 HG-UI 确认 |
| 2026-09-13 | HG-UI passed；审查合入：E14 元规则 U7；消除软措辞；UI-AC-14；逐条映射+最低 Phase；C4 四态分期 |
| 2026-09-13 | 复检：映射表拆 P1/P2 列；UI-AC-50 P1 基础 hover/focus；UI-AC-24 与 §9 对齐 |
