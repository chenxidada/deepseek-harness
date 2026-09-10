# Requirements: vscode-dsh-chat-ux

<!--
  slug: vscode-dsh-chat-ux
  audience: plan-generator / implementer / reviewer / verifier / HG-1
  language: zh (canonical). Mirror: requirements-zh.md
  constitution: .specdev/specs/vscode-dsh-chat-ux/constitution.md (§7)
  exploration: .specdev/specs/vscode-dsh-chat-ux/exploration-findings.md
  prior: chat-ready / conversation-ui / code-context-diff
  revised: 2026-09-10 — HG-1 预修订 + P0/P1/P2 措辞补丁（AC-71 等）
  status: awaiting formal HG-1 confirmation
-->

## 术语（全文统一）

| 术语 | 含义 |
|------|------|
| **Host** | Extension Host 侧控制器与权威状态持有者 |
| **Webview** | 对话面板呈现层（thin HTML / DOM） |
| **决策态** | Host 裁决：`mode` / `sessionId` / 能否发送 / Continue 能力 / 变更审阅与撤销权威结果等 |
| **呈现态** | Webview 可持有：滚动、展开折叠、流式中间态、局部 optimistic UI、`follow-state` 等 |
| **探针** | `dsh.test.*` 或受控 snapshot，可脚本读呈现态 |
| **可脚本渲染 / 层 A** | jsdom（或文档标明的等价 DOM）挂载**抽离后的** render/sync 模块（或薄壳+模块），按固定 DOM 契约断言真实节点/属性；**禁止**仅 HTML 字符串 `toContain`；**禁止**以整页 `runScripts: 'dangerously'` 作为主达标基建 |
| **层 B** | Host/控制器/协议证据（FakeWebview、duck-typed L2、索引与 cancel/fork 调用结果等）；对 Host 行为类 AC **强制** |
| **层 C** | 真 Electron / 像素 / 人工观感；仅辅助，不上 Must |
| **活动项** | 对话流内嵌工具/步骤卡片（默认折叠，同回合归组；状态可探针） |
| **引用卡** | 结构化引用呈现（非纯 `@` 文本） |
| **分叉** | 从**已关闭 turn** 边界派生**新** `sessionId`（≠ Continue same-id resume） |
| **P-接续** | 机制仍为 fork；当前面板切换到 child；父 Tab 按 E2 保留只读 |
| **P-标明** | 机制为 fork；新会话身份清晰（独立 Tab/标记），父 Tab 保持原样 |
| **搜索档 1 / 2 / 3** | 标题+预览 / 变更路径 / 正文全文（档 3 本 feature 不做） |

Must 达标 = **层 A + 层 B**；层 C 不得单独判 PASS。

---

## 决策台账（废除虚假「开放问题 ≤3」上限）

> **R7**：不得用数量上限把实质未决挤出文档。下列三类互斥。

### 已拍板（不得再标开放、不得由设计自决推翻）

| ID | 决议 |
|----|------|
| D1 / §7.1 | 可脚本渲染进 Must；jsdom+DOM 契约；真 Electron/像素仅层 C |
| 呈现态 / §7.2 | 呈现态下放 Webview；决策态留 Host；必须有探针 |
| 搜索档 3 / §7.3 | 本 feature 不做正文全文索引 / 第二正文库 |
| 单 slug | 不拆第二个 feature slug；多 Phase DAG |
| **T1 / E2** | 重试 / 编辑重发 = **P-接续**；父 Tab：**只读浏览 + 可 revert 父变更；禁发送；禁 Continue→live**（需封印 Continue） |
| **T2** | 显式分叉 = **P-标明** |
| **T3** | 中断 = **I-真**：必须调用后端 `session.cancel`（或等价 → `Agent.cancel`），**禁止**仅前端停追加 |
| **T4** | 工具中中断：协作式 abort；活动项 → `aborted`；**不**自动 revert 文件 |
| **T5** | 中断后半截助手文本：**保留**，并标「已停止/未完成」；incomplete **必须**认 live `turn/end aborted`（不仅 `interrupted`） |
| **T6** | **锁定 B：不展示** thinking / reasoning-delta；仅「生成中」指示 + 文本 chunk。若未来需要展示，须**独立 feature** 立宪，本 feature 实施中不得偷加 |
| **T7** | 跟滚 = 纯决策函数（输入滚动几何/是否在底部等 → `follow: on\|off`）+ DOM 契约属性（如 `data-follow-state`）；探针最小集含 follow-state |
| **T8** | diff 默认：**内联展开预览** + **显式跳转** VS Code 原生 diff |
| **T9** | Host 行为类 AC（cancel 真接受、fork 真建会话、搜索真命中、重试真换 session 等）**强制**层 B 证据 |
| **T10** | 活动项状态 `running → done \| failed \| aborted` **升为 Must AC** |
| **R1** | chunk 到达时已存在消息 DOM **节点身份保持**（禁止整表 replace 冒充增量） |
| **R2** | 回放视图**重建**活动项；回放决策态仍禁用发送 |
| **R3** | 流式错误 / 断连 fail-closed（探针收场，不得假 streaming） |
| **R4** | 本 feature **修订** AD-CU-1：允许呈现态下放 + 探针（不再「极薄到不能持呈现态」） |
| **R5** | 引用解析：输入框 / 已发消息 / 回放 **同一确定性共享路径** |
| **R6** | 跟滚「接管」产品阈值可在设计选定，但 **AC 正文不内嵌**未锁定像素/一屏公式；AC 只断言「满足接管条件 → 停跟滚」且条件可探针 |
| **R8** | 分叉只分支对话；工作区文件保持**当前磁盘态**；不 checkout 到 turn N |
| 变更基线 | 子会话 Change 基线 = **fork 发生时当前磁盘**；父未撤销变更**不入**子变更集；父 aborted 回合变更挂父会话，可 revert |
| turn 模型 | 见专节；重试/编辑/分叉机制均为 fork(已关闭 turn)；无同会话截断 |

### 待拍（正式 HG-1 口头确认本修订稿）

| ID | 内容 |
|----|------|
| HG-1-formal | 用户明确「确认需求 / 进入设计」后，`human_gates.hg1 → passed` |

### 延后且不可由设计自决

| ID | 内容 | 责任 |
|----|------|------|
| T6-future | thinking 展示 / 设置项开启（推翻本 feature 锁定 B） | **独立 feature** 再立宪；本 feature **必须不**加入 reasoning UI |
| 同会话截断 | append-only 上 truncate/rewind | **不做**；擦 O-3；另立宪 |
| 真 Electron Must | `@vscode/test-electron` 进门槛 | **不做**；保持层 C |

---

## Turn 生命周期模型（机制地基）

```
open（生成中）──正常结束──► closed
     │
     └── I-真 cancel ──► aborted

closed / aborted ──► 不可同 id 回退 / 截断
aborted turn 本身 ──► 非法 fork boundary
「重试这次 / 中断后重试」──► 一律 fork 自该 turn「之前最后一个 closed boundary」
Continue ──► same-id 末尾 resume（不在 fork 枝上）
```

| 用户动作 | 机制 | 产品呈现 |
|----------|------|----------|
| 重试上一条 | fork @ **上一 closed turn** 边界 | **P-接续** + E2 |
| 编辑并重发 | fork @ **被编辑 user 所属 closed turn**；seed 含该 user；丢弃该 turn **之后**内容 | **P-接续** + E2 |
| 显式分叉 | fork @ 用户指定的已关闭 turn | **P-标明** |
| 中断 | `Agent.cancel` → turn `aborted`；半截文本按 T5 | 同会话收场，**不**自动 fork |
| Continue | same-id resume | 当前会话续写 |

---

## 产品目标

在前序能力底座上，交付 VS Code DSH 对话面板的**日常敢用**体验：流式、内嵌活动流、消息交互、引用/变更/diff 产品化、搜索档 1+2、分叉——并以可脚本渲染（层 A）+ Host 证据（层 B）为达标门槛。

## 问题陈述

前序解决了「有没有面板 / 能否恢复 / 变更能否审阅」，但流式只吃完整消息、活动不在对话内、无真 Stop、无重试/编辑/分叉产品路径、引用与 diff 未产品化、验证把真实呈现踢出门槛——不足以日常敢用。探查证实：chunk/cancel/fork 核心能力大多已有，缺口在扩展投影、bridge 接线与呈现层。

## 目标终态

1. 流式增量可见；「生成中」；可真中断；跟滚可探针；接管后不抢滚。  
2. 活动项内嵌、默认折叠、同回合归组、状态可测；与变更列表衔接。  
3. 复制 / 重试 / 编辑重发可用；机制 fork；呈现按 T1/T2。  
4. 引用卡三处一致；变更列表归属清晰；diff 内联默认 + 可跳原生。  
5. 搜索档 1+2；打开不误 Start。  
6. 分叉新 session、父子可见、变更隔离；Continue 语义不变。  
7. 层 A 覆盖 patch / follow-state / 展开折叠；Host 关键路径有层 B。

## 目标用户

| Actor | 需求 |
|-------|------|
| 开发者 | 敢看流式、敢停、敢重试/编辑、敢搜、敢分叉 |
| 维护者/验证者 | 层 A/B 脚本回归，不依赖人工点选 |

## 核心场景

| ID | 场景 | 成功标准（摘要） |
|----|------|------------------|
| S-1 | 观看流式 | 增量可见；streaming 探针 true；默认 follow on |
| S-2 | 上滚接管 | follow off；后续 chunk 不强制回底 |
| S-3 | 中断 | 后端 cancel；半截保留+已停止；streaming false；工具活动项 aborted |
| S-4 | 工具执行 | 活动项内嵌；折叠；状态转移可测 |
| S-5 | 回合变更 | 变更列表与回合组衔接 |
| S-6 | 复制 | 可复制文本到达剪贴板或可观测出口 |
| S-7 | 重试 | fork→P-接续；父 E2；层 B 证新 sessionId |
| S-8 | 编辑重发 | 同 S-7，边界=该 user 的 closed turn |
| S-9 | 引用卡 | 输入内+已发内结构化卡；共享解析 |
| S-10 | diff | 默认内联；可跳原生 |
| S-11/12 | 搜索 1/2 | 命中并打开既有路径；不 Start |
| S-13 | 分叉 | P-标明；父子可见；变更隔离 |
| S-14 | 层 A 回归 | patch / follow-state / 折叠可脚本 |

## 预期范围

### 在范围内（Must）

- 决策/呈现边界 + 探针（含 streaming、活动项、展开、**follow-state**）  
- 可脚本渲染基建（**抽离** render/sync + jsdom）  
- 流式消费 `assistant/chunk` 文本；真 cancel；跟滚状态机  
- 活动流；消息复制/重试/编辑；分叉  
- 引用卡/变更列表/diff（T8）  
- 搜索档 1 + 档 2（档 2 **须**含 path→session 索引能力，设计交付）  
- 验证：每功能区层 A；Host 行为层 B  

### 不在范围内

见专节。

---

## 功能区域

### F0 — 验证基建与呈现态边界

抽离可测 DOM 模块；探针；修订 AD-CU-1；层 A/B 门槛。

### F1 — 流式与中断

chunk 文本投影；节点身份保持；真 cancel；T5 incomplete；follow-state；失败/断连 fail-closed；**不**展示 reasoning。

### F2 — 活动/工具流

内嵌活动项；折叠/归组；`running→done|failed|aborted`；与变更列表衔接；回放重建活动项。

### F3 — 引用 / 变更 / diff

共享解析引用卡；变更归属；内联 diff + 跳原生；Timeline 保持弱化。

### F4 — 消息交互与分叉

复制；重试/编辑=P-接续+E2；分叉=P-标明；皆 fork@closed turn。

### F5 — 搜索

档 1（字段已 READY）；档 2（NEED_INDEX：path→session）。

---

## 验收标准（EARS）

### 边界与可观测性

**AC-1**（普遍型）：系统 **必须** 将决策态保留在 Host，**必须不**由 Webview 单独裁决最终值。

**AC-2**（普遍型）：系统 **必须** 允许 Webview 持有呈现态（滚动、展开折叠、流式中间态、optimistic UI、follow-state）。

**AC-3**（普遍型）：凡下放呈现态，系统 **必须** 暴露探针，至少覆盖：streaming 中、活动项状态、展开态、**follow-state（跟滚 on/off）**、**P-接续后父 Tab 的 E2 只读/Continue 封印态（如 `parent-readonly` 或等价 mode 探针）**。**若** 实现中存在 optimistic UI，**则** 其「仍待收敛 / 已收敛到 Host（或已被否决）」状态 **必须** 可观测（探针或 DOM 契约）；**必须不**为满足本条而强造无 optimistic 场景的假探针。

**AC-4**（不期望型）：**如果** Webview 呈现了 optimistic UI，**那么** 系统 **必须** 在 Host 权威到达后收敛到 Host 结论，**必须不**让 optimistic 永久覆盖决策态；收敛结果 **必须** 可通过探针或 DOM 契约观测（与 AC-3 条件探针一致）。

**AC-5**（普遍型）：每个交付 Phase 达标 **必须** 含层 A 证据；Host 行为类验收（见 AC-13/31/50/51/60 等）**必须**另含层 B 证据；**必须不**仅以层 C 判 PASS。

**AC-6**（普遍型）：可脚本渲染基建 **必须** 以**抽离的** render/sync（或等价）模块为主测入口，在 jsdom（或文档标明等价环境）中断言真实 DOM 节点/属性/结构；**必须不**以整页 `runScripts: 'dangerously'` 作为唯一或主达标路径；**必须不**仅用 HTML 字符串 `toContain` 冒充层 A。

**AC-7**（不期望型）：**如果** 仅有真 Electron/像素通过而层 A 未绿，**那么** **必须不**判达标。

**AC-8**（普遍型）：本 feature **必须** 按「修订 AD-CU-1」执行：呈现态可下放并须可观测；**必须不**以「极薄 Webview 不得持任何呈现态」为由拒绝 AC-2/3。

### 流式与中断（4.1）

**AC-10**（事件驱动型）：**当** Host 收到目标 live 会话的 `assistant/chunk` 文本增量时，系统 **必须** 将其投影到对应助手气泡可见内容，**必须不**等待完整 `assistant/message` 才首次展示该回合增量。

**AC-11**（状态驱动型）：**在** 流式生成期间，系统 **必须** 探针 `streaming=true`，并展示可感知「生成中」指示（**必须不**展示 thinking/reasoning UI）。

**AC-12**（事件驱动型）：**当** 流式正常结束时，系统 **必须** 将 `streaming` 置 false，气泡与权威完整文本消息收敛一致。

**AC-13**（事件驱动型）：**当** 用户触发中断且会话仍在生成中时，系统 **必须** 调用后端 cancel（bridge `session/cancel` 或等价 → `Agent.cancel`），**必须**停止继续追加 chunk，**必须**将 streaming 置 false；**必须不**仅靠前端停追加而放任模型/工具继续作为「已中断」验收。

**AC-13b**（事件驱动型）：**当** 中断发生且该回合已有助手文本片段时，系统 **必须** 保留该半截内容，并标记「已停止/未完成」（incomplete）；判定 **必须** 覆盖 live `turn/end` 且 `reason.kind === 'aborted'`（以及既有 `interrupted` 路径）。

**AC-13c**（事件驱动型）：**当** 中断发生且存在仍为 running 的活动项时，系统 **必须** 将活动项收敛为 `aborted`（或等价可探针终态），**必须不**永久停在 running；**必须不**因中断自动 revert 已落盘文件变更（撤销走既有 change-list/revert）。

**AC-13d**（不期望型）：**如果** 后端 cancel 调用失败或超时，**那么** 系统 **必须** fail-closed：streaming 不得无限保持 true，**必须** 向用户展示可理解失败提示，**必须不**将「仅前端停追加」宣称为已成功中断。

**AC-14**（状态驱动型）：**在** follow-state 为跟滚开启期间，系统 **必须** 在新增量到达时保持消息列表底部可见策略（由决策函数与 DOM `data-follow-state` 或等价契约表达）。

**AC-15**（事件驱动型）：**当** 探针表明已满足「用户接管」条件时，系统 **必须** 将 follow-state 置为关闭，**必须不**在后续 chunk 到达时强制滚回底部。

**AC-16**（事件驱动型）：**当** 用户再次满足跟滚恢复条件（回到底部区域或显式「回到底部」——具体控件设计选定，行为必须存在且可测）时，系统 **必须** 恢复 follow-state 为开启。

**AC-17**（普遍型）：流式 **必须不** 将「先改 SDK 才有 chunk」列为硬依赖。

**AC-18**（普遍型）：层 A **必须** 能断言受控 chunk 序列后目标 DOM 反映增量；且 **必须** 保持已存在消息节点身份（同一 `data-message-id` 或契约等价），**必须不**用整表拆除重建冒充增量通过。

**AC-19**（不期望型）：**如果** chunk 流异常或连接中途断连，**那么** 系统 **必须** 将 streaming 置 false，展示可理解失败/断连态（fail-closed），**必须不**无限假「生成中」。

### 活动/工具流（4.2）

**AC-20**（事件驱动型）：**当** live 回合产生工具/步骤活动时，系统 **必须** 在对话流插入活动项（不得仅 Timeline 可见）。

**AC-21**（普遍型）：活动项默认 **必须** 折叠；探针可读。

**AC-22**（事件驱动型）：**当** 用户展开活动项时，系统 **必须** 展示可读状态，探针展开态为 true。

**AC-23**（普遍型）：同回合多活动项 **必须** 归为同一回合组（DOM/视觉契约可判定）。

**AC-24**（普遍型）：活动流投影 **必须** 独立于文本 chunk：无文本 chunk 时工具活动仍 **必须** 能出现。

**AC-25**（普遍型）：变更列表出现时 **必须** 与所属回合气泡/活动组在 DOM/契约上**同组可判定**（共享归组属性或等价契约；与 AC-42 口径一致）。

**AC-26**（普遍型）：层 A **必须** 能断言默认折叠与展开切换。

**AC-27**（普遍型）：活动项状态 **必须** 支持并可探针断言 `running → done | failed | aborted` 转移（含 cancel 导致的 aborted）。

**AC-28**（普遍型）：回放视图 **必须** 重建活动项呈现；**必须不**因回放而允许 live 发送。

### 消息级交互（4.3）

**AC-30**（事件驱动型）：**当** 用户触发复制时，系统 **必须** 将该消息可复制文本写入系统剪贴板；在可脚本环境中 **必须** 另有可观测复制出口（如 `dsh.test.lastCopiedText` 或 Fake clipboard 钩子），使层 B 能断言复制内容而无须依赖真实 OS 剪贴板。

**AC-31**（事件驱动型）：**当** 用户对「上一 closed turn」边界触发重试时，系统 **必须** 以 fork 派生新 `sessionId`，并按 **P-接续** 将面板切到 child；父 Tab **必须** 满足 E2（只读浏览、可 revert、禁发送、禁 Continue→live）；层 B **必须** 能断言新 sessionId 与父 sessionId 不同；父 Tab E2 只读/Continue 封印态 **必须** 可被 AC-3 探针断言。

**AC-32**（事件驱动型）：**当** 用户编辑已发送 user 消息并确认重发时，系统 **必须** fork自该 user 所属 **closed turn** 边界（seed 含该 user 消息；丢弃该 turn 之后内容），呈现为 **P-接续** + E2；**必须不**静默等同 Continue same-id resume；**必须不**假设存在同会话截断 API；父 Tab E2 态 **必须** 可探针断言（同 AC-31）。

**AC-31b**（普遍型）：P-接续路径下，父 Tab 的 E2 约束（不可发送、Continue 封印、仍可浏览与 revert 父变更）**必须** 可被探针或 panel/state 契约断言；层 B **必须** 能拒绝「父 Tab 仍可发 / 仍可 Continue→live」的假只读。

**AC-33**（普遍型）：重试 / 编辑重发 / 分叉 **必须** 共用 fork(已关闭 turn) 机制；产品用入口与呈现（P-接续 vs P-标明）区分意图；**必须不**把「同会话内截断重开」写进本 feature 能力。

**AC-34**（不期望型）：**如果** 目标不是合法已关闭 turn 边界（含 aborted turn 自身），**那么** 系统 **必须** 禁用或拒绝并给出可见原因，**必须不**发起非法 fork。

### 引用卡 / 变更列表 / diff（4.4）

**AC-40**（普遍型）：输入框内结构化引用 **必须** 以引用卡呈现，**必须不**仅以纯 `@path` 为唯一呈现。

**AC-41**（事件驱动型）：**当** 含引用卡消息进入消息流时，系统 **必须** 在已发消息内保持引用卡；输入 / 已发 / 回放 **必须** 走同一确定性引用解析路径。

**AC-42**（普遍型）：变更列表 **必须** 与所属回合气泡/活动组可判定归属。

**AC-43**（普遍型）：diff 默认策略 **必须** 唯一锁定为：**内联展开预览**，并提供**跳转 VS Code 原生 diff** 的显式入口；层 A/B **必须** 能断言默认路径走通。

**AC-44**（普遍型）：Timeline **必须** 保持弱化，**必须不**恢复为助手长文主阅读面。层 B **必须** 能断言助手长文主投影落在对话消息面而非 Timeline（例如 Timeline 投影不含完整助手长文 body）；可选层 A 断言 Timeline DOM 不含长文主阅读块。

**AC-45**（普遍型）：历史打开与回放中，引用卡/变更/diff/**活动项**呈现 **必须不** 误导为可 live 发送（Host 禁用发送）。

### 会话搜索（4.5）

**AC-50**（事件驱动型）：**当** 用户使用会话搜索时，系统 **必须** 支持档 1（标题 + 预览元数据）返回匹配列表；层 B **必须** 能断言命中来自索引字段而非全文扫描冒充。

**AC-51**（事件驱动型）：**当** 用户按变更路径查询时，系统 **必须** 支持档 2（path→session 反查，基于变更索引，**不**建正文库）；层 B **必须** 能断言反查结果。

**AC-52**（事件驱动型）：**当** 用户从搜索结果打开会话时，系统 **必须** 走既有历史/回放或激活已有 Tab，**必须不**因此 Start 新会话（除非用户随后**显式**执行 Continue、重试/编辑重发、或分叉）。

**AC-53**（不期望型）：**如果** 意图是正文全文命中，**那么** 本 feature **必须不** 提供档 3 或第二正文库，**必须不**静默扫 JSONL 正文冒充搜索。

### 分叉（4.6）

**AC-60**（事件驱动型）：**当** 用户从指定**已关闭 turn** 触发分叉时，系统 **必须** 派生新 `sessionId`，并以 **P-标明** 打开独立会话身份；层 B **必须** 断言新 id 与 fork 调用成功。

**AC-61**（不期望型）：**如果** 目标不是已关闭 turn 边界，**那么** 系统 **必须** 拒绝或禁用，**必须不** fork。

**AC-62**（普遍型）：分叉入口与结果 **必须** 与 Continue（same-id resume）可区分；**必须不**做成无差别同一按钮语义。

**AC-63**（普遍型）：分叉后 UI **必须** 展示可理解父子关系（可断言「派生自 / 父会话」类信息）。

**AC-64**（普遍型）：子会话变更追踪基线 **必须** 为 fork 发生时的**当前磁盘状态**；父会话已存在的未撤销变更 **必须不** 进入子会话变更集；子会话从该基线重新记录变更；**必须不**为分叉自动 checkout 历史文件态。父会话 aborted/历史回合上的变更归属留在父会话，可走既有 revert。

**AC-65**（普遍型）：Continue 产品路径 **必须** 保持 same-id resume，**必须不**因分叉/重试被改写为隐式 fork；层 B **必须** 能断言 Continue 前后 `sessionId` 不变（与 AC-60/66 的「新 id / 非原位 resume」对照可测）。

**AC-66**（普遍型）：P-接续路径 **必须不** 复用「原位 `continueConversation` resume 父 id」；**必须** 创建/绑定 child session 并切换活动 Tab。

### 验证闭环

**AC-70**（普遍型）：F0–F5 各功能区在对应 Phase **必须** 至少一条层 A 可断言形态。

**AC-71**（普遍型）：层 A **必须** 覆盖：流式 patch→DOM、**follow-state 跟滚/接管**、**活动项展开折叠**（若引用卡在实现中提供折叠态，则层 A **必须** 一并覆盖引用卡展开折叠；**必须不**要求不存在的「消息气泡展开折叠」）。跟滚断言状态/DOM 属性，不断言 jsdom 真实像素布局。

**AC-72**（普遍型）：层 C **必须** 仅辅助；层 A 或层 B 失败时 **必须不** 单靠层 C PASS。

**AC-73**（可选功能型）：**若** 附带层 C 记录，**必须** 仍以层 A+B 为门禁。

---

## 不在范围内（明确排除）

| # | 排除项 |
|---|--------|
| O-1 | 多窗口模型 |
| O-2 | 重做多 Tab（只复用） |
| O-3 | 重做 `packages/core/agent-loop` / 双通道 ide profile；**含**核心 append-only 截断 |
| O-4 | 产品内 agent 自我验证循环 |
| O-5 | 搜索档 3 / 第二正文库 |
| O-6 | 真 Electron / 像素作为 Must |
| O-7 | 拆第二个 feature slug |
| O-8 | Timeline 恢复为助手长文主阅读面 |
| O-9 | 任意 message 中点 / aborted turn 自身作为 fork boundary |
| O-10 | 本 feature 展示 thinking / reasoning UI（T6 **锁定 B**） |
| O-11 | 中断时自动 revert 磁盘文件 |

---

## 约束

1. 宪法 §7 全文适用；本修订与之对齐。  
2. 探查结论见 `exploration-findings.md`（X1–X7）；设计不得假设同会话 truncate、不得假设 ide-bridge 已有 cancel（须新接）、不得假设档 2 已有 path 索引。  
3. I-真接线面：扩展 + bridge `session/cancel` + `sdkSessionCancel` → 已有 `Agent.cancel`；建议 `keepInbox: true`（对齐 Web）。  
4. 层 A：NEEDS_EXTRACT——抽离模块再测。  
5. 安全：无明文 Token/密钥进 spec/日志。  
6. 每 Phase ≥1 集成测试 + verifier 独立 e2e；另强制层 A，Host 行为强制层 B。

---

## 风险 / 假设

| 类型 | 内容 |
|------|------|
| 假设 | chunk / cancel / fork(closed turn) 核心可用；扩展可订阅投影 |
| 假设 | 档 1 字段已存在；档 2 可新增反查而不建正文库 |
| 假设 | jsdom + 抽离模块足以 CI 稳定跑层 A |
| 风险 | 双数据源（chunk vs tool）顺序竞态 → 须回合归组契约 |
| 风险 | P-接续若未封印父 Continue → 用户误 resume 父 |
| 风险 | fork 接线误拷贝父 Change index → 破坏 AC-64 |
| 风险 | DOM 契约过贴 CSS 类名 → 应用稳定 role/state 属性 |

---

## 建议的 Phase 拆分方向

> 供 plan-generator；**不**预分配 Phase ID。同 slug 多 Phase。

1. **F0** 抽离 render/sync + jsdom 层 A 骨架 + 探针（含 follow-state）+ 决策/呈现边界  
2. **F1** 流式 chunk + 节点身份保持 + 真 cancel + T5 incomplete(aborted) + follow-state + fail-closed  
3. **F2** 活动项内嵌 + 状态机 + 归组 + 回放重建  
4. **F3** 引用卡共享解析 + 变更归属 + diff T8  
5. **F4** fork 编排：P-接续重试/编辑 + E2；P-标明分叉；AC-64 基线  
6. **F5** 搜索档 1 UI + 档 2 path→session 索引  

允许合并相邻项或插 spike；**禁止**把层 A 整段拖到全部 UX 之后；**禁止**第二 slug。

---

## Constitution 合规

| 条款 | 结论 |
|------|------|
| §7.1 可脚本渲染 | 对齐 AC-5/6/7/18/70/71 |
| §7.2 决策/呈现 + 探针 | 对齐 AC-1–4、AC-8 |
| §7.3 档 3 / Out / 单 slug | 对齐 O-*、AC-53 |
| §7.4 chunk 已有；fork=closed；Continue≠fork | 对齐 AC-10/17、AC-60–66 |

**未发现与 §7 冲突。** T6 **锁定 B**（不展示 reasoning）写入 O-10 与决策台账。
