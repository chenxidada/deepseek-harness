# Phase 2: 可用级消息流与流内能力呈现

**Phase ID:** `phase-2-usable-stream`
**DAG 依赖:** `phase-1-editor-shell-tabs`

## 目标

在 Editor Chat Panel 上交付**日常可读**的消息流：流式结束后安全 Markdown settle；user/assistant 层级清晰；生成中/停止/跟滚/fail-closed；活动步骤、引用卡、变更/diff 在流内可见；composer 支持 I-真停止。

用户一次能感到：**能正经读回复、看工具与改动、敢点停止。**

## 前置条件

| 依赖 | 说明 |
|------|------|
| Phase 1 HG-3 通过 | 唯一 Panel + 顶栏 Tab + 无侧栏主聊天 |
| `design.md` §Markdown settle | streaming 纯文本 → settle `renderSafeMarkdown` |
| 基线 | `safe-markdown.ts`、activity/ref/change DOM、`requestStop`（I-真）、T6/T7/T8 |
| tech-debt-registry | 继承 Phase 1 登记的阻塞债（若有）并按 Entry Gate 处理 |

## 验收标准（本 Phase AC 子集）

**AC-20**（普遍型）：消息流 **必须** 以可区分层级呈现 user 与 assistant（层 A 或层 V 可判定）。

**AC-21**（事件驱动型）：**当** 助手回合流式 settle 时，系统 **必须** 以可读 Markdown 呈现（含强调与代码块）；**必须不**在 settle 后仍仅不可读纯转义堆或空白壳。

**AC-22**（状态驱动型）：**在** streaming 期间 **必须** 展示可见「生成中」指示；**必须不**展示 thinking / reasoning-delta 正文（T6）。

**AC-23**（事件驱动型）：**当** 用户停止且 cancel 完成（I-真）时，系统 **必须** 保留半截助手文本（若有），标明已停止/未完成，并结束 streaming 指示。

**AC-24**（普遍型）：跟滚行为符合 T7；`data-follow-state` 可探针。

**AC-25**（不期望行为型）：错误或断连时 **必须** fail-closed 结束 streaming；**必须不**无限假「生成中」。

**AC-30**（普遍型）：对话流内呈现活动/工具步骤（默认折叠；`running|done|failed|aborted` 可区分）；**必须不**仅依赖 Timeline 才知道工具在执行。

**AC-31**（普遍型）：结构化引用展示引用卡（R5 路径）；**必须不**仅无结构纯文本冒充。

**AC-32**（普遍型）：变更/diff 可见：默认内联预览可用 + 跳转原生 diff 入口（T8）；审阅权威在 Host。

**AC-33**（普遍型，全量）：composer live 可发送；**生成中可停止**；门闩拒绝有反馈。

**AC-40** / **AC-41**（本 Phase）：层 A+B+V；层 V 至少含 V-1…V-7 中本 Phase 适用项（V-5/V-6/V-7 Must）。

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-20 | 层 A / 层 V | DOM `data-role=user\|assistant` + 可见样式层级 | 角色可区分 |
| AC-21 | 层 A + 层 V | settle 后助手气泡含 `.md-pre` / 强调节点；截图可读 | 非纯 textContent 终态 |
| AC-22 | 层 A / 层 B | streaming 时生成中指示；无 thinking 节点 | T6 遵守 |
| AC-23 | 层 B | Stop → cancel 调用 + `data-incomplete` + streaming false | I-真 |
| AC-24 | 层 A | `data-follow-state` 随滚动变化 | T7 |
| AC-25 | 层 B | 注入错误/断连 → streaming 结束 | fail-closed |
| AC-30 | 层 A / 层 V | activity 气泡状态机属性 | 流内可见 |
| AC-31 | 层 A | 引用卡 DOM / 解析路径 | 非纯文本冒充 |
| AC-32 | 层 A / 层 B | change-list / diff-summary + open native diff | T8 |
| AC-33 | 层 B | 发送 + Stop 路径 | 门闩 + cancel |
| AC-40/41 | 层 V | Host 打开 Panel，勾选 V-5…V-7（并回归 V-1…V-4） | 清单过 |

### 本 Phase 层 V 清单（Must）

| ID | 核对项 |
|----|--------|
| V-1…V-4 | 回归 Phase 1 |
| V-5 | user / assistant 层级可区分 |
| V-6 | settle 后 Markdown 可读（至少代码块或强调可见） |
| V-7 | 活动或引用或变更至少一类在流内可见 |

## 约束

- 不重做协议；优先接线既有 Host deps 与 DOM helpers。
- settle **必须**走 `renderSafeMarkdown`；禁止 raw `innerHTML` 未消毒文本。
- 历史/搜索顶栏完整 UI、Timeline visibility、fork/复制入口打磨 → Phase 3。
- 参考图「Thought for…」**不在范围**。

## 产出清单

- [ ] `patchMessageDom` / Webview patch 路径：settle Markdown 重渲
- [ ] 生成中指示 + incomplete/停止呈现 + fail-closed
- [ ] 跟滚探针保持
- [ ] 活动 / 引用 / 变更在 Editor Panel 流内可用级可见
- [ ] composer Stop → I-真
- [ ] 层 A/B 测试 + 层 V（含 V-5…V-7）
- [ ] `implementation.md` / registry 更新
