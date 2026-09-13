# Phase 3: 对话内嵌活动流与状态机

## 目标

在对话消息流内嵌工具/步骤活动项：默认折叠、同回合归组、状态 `running → done | failed | aborted` 可探针；与变更列表同组可判定；回放重建活动项且不因回放允许 live 发送；补齐 cancel 导致的活动项 aborted（AC-13c）。

## 前置条件

- 依赖 Phase：`phase-2-streaming-cancel-follow`
- design 活动模型；X5 工具 abort 事件序列

## 验收标准（裁剪自 requirements）

- [ ] **AC-13c** 中断时 running 活动项收敛为 `aborted`；不永久 running；**不**因中断自动 revert 文件
- [ ] **AC-20** live 工具/步骤活动插入对话流（不得仅 Timeline）
- [ ] **AC-21** 活动项默认折叠；探针可读
- [ ] **AC-22** 用户展开 → 可读状态；探针 expanded true
- [ ] **AC-23** 同回合多活动项归为同一回合组（DOM/契约可判定）
- [ ] **AC-24** 活动流独立于文本 chunk：无文本时工具活动仍可出现
- [ ] **AC-25** 变更列表出现时与所属回合气泡/活动组同组可判定
- [ ] **AC-26** 层 A 能断言默认折叠与展开切换
- [ ] **AC-27** 状态可探针 `running → done | failed | aborted`（含 cancel→aborted）
- [ ] **AC-28** 回放重建活动项；回放不得允许 live 发送

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-13c | 层 B + 层 A | cancel 中工具 running fixture | 活动项 aborted；无自动 revert |
| AC-20 | 层 B/A | tool/call 事件 → DOM `[data-kind=activity]` | 对话流内可见 |
| AC-21–22 | 层 A | 默认 collapsed；toggle | 探针/属性正确 |
| AC-23 | 层 A | 同 turn 两活动 | 共享 `data-turn` 或组容器 |
| AC-24 | 层 B | 仅 tool 无 chunk | 活动项仍出现 |
| AC-25 | 层 A | change-list + activity 同 turn | 同组契约 |
| AC-26 | 层 A | 折叠切换用例 | 绿 |
| AC-27 | 层 A/B | 三段终态 fixture | 状态属性匹配 |
| AC-28 | 层 B | ReplayHydrator + mode=replay | 有活动项；reject-send |

## 约束

- Timeline 仍弱化，不作活动主阅读面
- 活动状态映射参考 tool/result `ABORTED` / `ABORTED_BEFORE_DISPATCH`（X5）
- Out：引用卡共享解析产品化与 T8 内联 diff 主交付在 phase-4（本 Phase 仅归组契约）

## 产出清单

- activity 投影（live + replay）
- `activity-dom` 渲染与探针
- cancel→aborted 接线
- 层 A 折叠/状态测试；层 B 回放禁用发送

## Out of scope（本 Phase）

- T8 内联 diff 默认路径完整产品化（phase-4）
- fork / 搜索
- thinking UI
