# Phase 4: 引用卡 + 变更归属 + 内联 diff

## 目标

交付结构化引用卡（输入 / 已发 / 回放同一确定性解析路径）；变更列表与回合气泡/活动组可判定归属；diff 默认**内联展开预览** + **显式跳转** VS Code 原生 diff（T8）；Timeline 保持弱化；历史/回放呈现不误导为可 live 发送。

## 前置条件

- 依赖 Phase：`phase-3-activity-stream`（同组归组契约已就绪）
- design AD-CUX-8 / **AD-CUX-11**；R5；既有 change-list / AD-CCD-11 `at-path` / `formatFileMention`
- **引用解析复用** code-context-diff 官方 `@` 规则；`ref-cards.ts` 只渲染，不新写 @ 文法
- **内联 diff** 复用 `change/get-diff` / `change/diff-content`；`change-diff-dom` 只渲染

## 验收标准（裁剪自 requirements）

- [ ] **AC-40** 输入框内结构化引用以引用卡呈现，不仅纯 `@path` 文本
- [ ] **AC-41** 含引用卡消息进入消息流后已发内保持引用卡；输入/已发/回放同一确定性解析路径
- [ ] **AC-42** 变更列表与所属回合气泡/活动组可判定归属
- [ ] **AC-43** diff 默认 = 内联展开预览 + 显式跳原生入口；层 A/B 可断言默认路径
- [ ] **AC-44** Timeline 保持弱化；助手长文主投影在对话面；层 B 断言 Timeline 不含完整助手长文 body
- [ ] **AC-45** 历史打开与回放中，引用卡/变更/diff/**活动项**呈现不误导为可 live 发送（Host 禁用发送）

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-40 | 层 A | composer 含 `@path` fixture | 出现 ref-card 节点 |
| AC-41 | 层 A + 静态 | 同一 parse 函数用于三处；消息流 DOM 有卡 | 路径一致 |
| AC-42 | 层 A | change-list `data-turn` / source 与气泡一致 | 同组可判定 |
| AC-43 | 层 A + 层 B | 默认点击走内联；另有 open-native-diff action | 双路径可测 |
| AC-44 | 层 B | Timeline 投影快照 | 无完整助手长文 |
| AC-45 | 层 B | replay 打开含引用/变更/活动 | reject-send / mode≠live 可发 |

## 约束

- T8 锁定；不得改成仅原生或仅内联
- 共享解析模块，禁止三处分叉正则（R5）
- 若引用卡有折叠态，层 A 须覆盖（AC-71 条件）；无则不必造折叠
- Out：fork、搜索档 2、thinking

## 产出清单

- `ref-cards` DOM 渲染（解析委托 at-path / AD-CCD-11，不新写 @ 文法）
- 内联 diff DOM（数据 ← `change/get-diff` / `change/diff-content`）+ Host 打开原生 diff
- Timeline 弱化回归测试
- 回放禁用发送回归（含活动项）

## Out of scope（本 Phase）

- P-接续 / P-标明
- path→session 搜索索引
- 改 agent-loop / 同会话截断
