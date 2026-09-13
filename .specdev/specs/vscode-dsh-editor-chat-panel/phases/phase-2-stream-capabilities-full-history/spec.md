# Phase 2: 可读流 + 能力 + 完整历史 + 退役内联

<!--
  phase-id: phase-2-stream-capabilities-full-history
  slug: vscode-dsh-editor-chat-panel
  design: ../../design.md
  ui: ../../requirements-ui.md + ../../ui-visual-spec.md
  stack: React SPA（主路径）；buildThinChatHtml 退出主路径
-->

## 目标

在 Phase 1 React 壳与历史入口之上，交付日常可用级消息流（Markdown settle+sanitize、空态/loading、停止/失败）、能力入口（活动/引用/变更/composer 四态+停止中、fork/重试/Continue、复制、搜索档1+2）、**完整历史窗口**（Continue、删除、父子、搜索联动、实时同步），并保证顶栏删除与历史删除语义一致（AC-60；**webview modal 确认**）。Timeline 进一步弱化。层 V 收齐 AC-41 与 `ui-visual-spec.md` §9 **Phase 2（含原 P3 并入项）**。**将 `buildThinChatHtml` 从主路径移除或仅留迁移 stub**（design 自决技术债），层 A 全量以 React RTL 为准。

## 前置条件

| 依赖 | 说明 |
|------|------|
| `phase-1-shell-tabs-basic-history` | HG-3 通过并合并 main |
| `tech-debt-registry.md` | Phase Entry Gate：消化 Phase 1 登记的历史/删除/视觉桩 |
| `design.md` AD-ECP-3（完整）、6、7、8、10 | |
| UI / 视觉契约 | UF2–UF5；`ui-visual-spec.md` §5.2–5.5、§9 Phase2+收尾 |

## 验收标准（功能）

| ID | 摘要 |
|----|------|
| AC-13c | 顶栏右键/溢出删除：确认不可恢复；同步 |
| AC-14a | 顶栏删除与历史 AC-55 一致 |
| AC-14b | 溢出含：删除会话、打开 Timeline |
| AC-20 | user/assistant 可区分 |
| AC-20a | replay 只读；禁直接发送 |
| AC-20b | 空态/loading |
| AC-21 | settle 可读 Markdown |
| AC-21a | sanitize；代码块可读 |
| AC-22 | streaming 指示；无 thinking |
| AC-23 | cancel 后半截+已停止 |
| AC-23a | 失败/断连可理解提示 |
| AC-24 | 跟滚可探针 |
| AC-25 | 流式错误 fail-closed |
| AC-30 / 30a | 活动项折叠+展开细节 |
| AC-31 / 31a | 引用卡 + 插入入口 |
| AC-32 / 32a | 变更可见 + 审阅/撤销入口 |
| AC-33 / 33a / 33b | composer 四态；禁用有因；停止中 |
| AC-34 / 34a / 34b | 重试/编辑 → fork+P-接续；入口可见；父子可区分 |
| AC-35 | 显式分叉 → fork+P-标明 |
| AC-36 / 36a | 复制可达；助手/代码块可见入口 |
| AC-37 / 37a | 历史/搜索既有路径；不 auto-Start；不档3；打开只读去重 |
| AC-38 / 38a / 38b | 搜索档1+2 主入口+与历史联动；Continue 可见可区分；same-id |
| AC-40 | 层 A+B+≥1 层 V |
| AC-41 | 层 V：Panel/顶栏/活动 Tab/角色/settle MD/composer 四态 |
| AC-42 | 无层 V 不得 PASS |
| AC-44 | Timeline 弱化；溢出可开 |
| AC-45 | 无 Should |
| AC-53 | 历史打开只读 |
| AC-54 | 历史 Continue 可见；same-id |
| AC-55 | 历史删除确认+同步 |
| AC-56 | 历史搜索档1+2；非档3 |
| AC-57 | fork 父子关系可见 |
| AC-59 | 历史列表随 Registry/索引实时更新 |
| AC-60 | 顶栏↔历史删除语义一致 |

## 验收标准（UI）

| ID | 摘要 |
|----|------|
| UI-AC-20 | user/assistant 层级；弱化粗描边主导 |
| UI-AC-21 | 活动行弱于主文 |
| UI-AC-22 | 引用/变更可识别可点 |
| UI-AC-23 | settle 后标题/段落/代码块层级+复制可见 |
| UI-AC-24 | 空态/loading |
| UI-AC-30 | composer sticky；四态可辨 |
| UI-AC-31 | 禁用态+原因位 |
| UI-AC-32 | streaming/停止中指示（无 thinking 面板） |
| UI-AC-40 | （回归）历史列表行外观 |
| UI-AC-42 | Continue/删除可发现、不喧宾 |
| UI-AC-43 | 父子「分支自 …」可读 |
| UI-AC-50 | hover + focus 环 |
| UI-AC-51 | 短过渡；`prefers-reduced-motion` |
| UI-AC-52 | ≥8px 间距；SVG/codicon；无 emoji 图标 |
| UI-AC-60 / 61 / 62 | 设计绑定；层 V 对照清单；禁止换皮炫技 |

## 设计验收锚点（本 Phase）

| 锚点 | 要求 |
|------|------|
| AD-ECP-10-P2 | 层 A 全量 RTL；DOM 契约补齐 activity/ref/change/copy/continue/follow-state；闭环路径完整 |
| 内联退役 | `buildThinChatHtml` **退出主路径**（删除或仅迁移 stub）；禁止双主路径假绿；旧 layer-a 依赖内联的测试已迁或删除 |

### 本 Phase 追加 DOM 契约

`activity-row`、`ref-card`、`change-list`（及既有 change 子 testid）、`btn-copy`、`btn-continue`、`btn-stop`、根上 `data-follow-state`；`data-composer-state` **仅四态**齐全。

**停止中（非第五态）**：`data-composer-state` 不变 + `btn-stop[disabled]` + `status` 含「正在停止…」（design R7）；层 A 可断言。

## 层 V 核对清单（本 Phase）

来自 `ui-visual-spec.md` §9 Phase 2 + Phase 3 收尾：

- [ ] user/assistant 层级符合 §5.2；MD settle 后代码块可读+复制可见
- [ ] 活动/引用/变更视觉权重正确
- [ ] composer 四态人眼可分；禁用有原因位
- [ ] 历史行含标题/时间/预览；Continue/删除可发现；父子可读
- [ ] 能力入口仍可发现且未回退成「演示按钮墙」
- [ ] focus/hover/reduced-motion 底线满足 UI-AC-50–52

另须：AC-41 四态清单；删除两处一致的 **webview modal** 确认流；Stop 在 streaming/停止中可见；§5.6 生成中指示；UI-AC-50–52（原 P3 并入）；双主题抽检。

## 约束（架构）

- AD-ECP-3（完整 F5）、AD-ECP-6、AD-ECP-7、AD-ECP-8（React 主路径）、AD-ECP-10
- 复用既有 cancel/fork/Continue/搜索/索引；不重做 agent-loop
- 填实 Phase 1 相关 `@STUB`
- 开源仅前端样式参考

## 产出清单

| 产出 | 说明 |
|------|------|
| 消息流 React 组件 + sanitize settle | 对齐 §5.2 |
| 活动/引用/变更入口 | 权重与可操作闭环 |
| composer 四态+停止中 | UI-AC-30–32 |
| 顶栏删除+溢出 | AC-13c / 14a / 14b |
| 完整历史窗口 | AC-53–57/59 + UI-AC-42/43 |
| 删除一致 | 单 `deleteSession`；AC-60 |
| 搜索档1+2 联动 | AC-38 / AC-56 |
| Timeline 弱化 | AC-44 |
| 内联主路径移除/stub | AD-ECP-8 退出条件 |
| 测试 | 层 A（RTL）+B+V |
| `implementation.md` + registry 清算 | |

## 不在范围内

- 搜索档 3、thinking UI、同会话 truncate/rewind、新协议栈
- 像素级品牌 redesign、玻璃拟态、霓虹
- 多窗口 Registry 同步（O-10）
- 回退到内联 HTML 主路径

## 验证提示（给 verifier）

| 层 | 示例 |
|----|------|
| A | RTL：settle MD、历史行、复制按钮、四态 composer、follow-state |
| B | deleteSession 单路径；Continue same-id；fork 新 sessionId；搜索索引 |
| V | 真机：四态可辨；历史 Continue/删除；无换皮；focus 可见 |
| 退役 | 确认 Panel 不加载 `buildThinChatHtml`；相关旧测试已迁 |
