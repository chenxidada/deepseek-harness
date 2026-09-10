# Phase 2: 流式 chunk + I-真 cancel + follow-state

## 目标

交付流式文本增量可见、「生成中」指示、I-真中断、跟滚 follow-state 可探针、流式错误 fail-closed；保持消息节点身份；**不**展示 thinking。依赖 phase-1 层 A 基建。

## 前置条件

- 依赖 Phase：`phase-1-foundation-render-probe`（HG-3 已通过）
- design.md AD-CUX-3 / 4 / 7 / 10
- exploration X1（cancel 接线）、X5（aborted 序列）

## 验收标准（裁剪自 requirements）

- [ ] **AC-10** 收到 live `assistant/chunk` 文本增量即投影到助手气泡，不等完整 `assistant/message`
- [ ] **AC-11** 流式期间 `streaming=true` +「生成中」；**不**展示 thinking/reasoning UI
- [ ] **AC-12** 流式正常结束 → `streaming=false`，气泡与权威完整文本收敛
- [ ] **AC-13** 用户中断 → bridge `session/cancel` → `Agent.cancel`；停止追加；streaming false；禁止仅前端停追加验收
- [ ] **AC-13b** 半截助手文本保留 +「已停止/未完成」；认 live `turn/end` `reason.kind === 'aborted'`（及 `interrupted`）
- [ ] **AC-13d** cancel 失败/超时 → fail-closed；提示用户；不得宣称仅前端停为成功中断
- [ ] **AC-14** follow on 时新增量保持底部可见策略（决策函数 + `data-follow-state`）
- [ ] **AC-15** 满足接管条件 → follow off；后续 chunk 不强制回底
- [ ] **AC-16** 恢复条件（回底或「回到底部」）→ follow on
- [ ] **AC-17** 不以「先改 SDK 才有 chunk」为硬依赖
- [ ] **AC-18** 层 A：受控 chunk 后 DOM 增量；同 `data-message-id` 身份保持；禁止整表拆除重建冒充
- [ ] **AC-19** chunk 异常/断连 → streaming false + 可理解失败态
- [ ] **AC-71** 层 A 覆盖流式 patch→DOM 与 follow-state 跟滚/接管（不断言像素布局）
- [ ] **AC-72** 层 C 仅辅助；A/B 失败不得靠 C PASS

### 延后到 phase-3 的相关 AC

- **AC-13c**（活动项 → aborted）在本 Phase 可完成 Host/事件侧映射预备，但完整活动项 UI 与断言归 **phase-3**。

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-10 | 层 B + 层 A | Fake 事件喂 chunk；读 MessageStore + DOM | 增量可见 |
| AC-11 | 层 A/B | 探针 streaming；DOM 无 reasoning 块 | true + 无 thinking |
| AC-12 | 层 B | 完整 message 后探针 | streaming false；文本一致 |
| AC-13 | 层 B | spy bridge/sdk cancel；点 Stop | 真调用；streaming false |
| AC-13b | 层 B | fixture turn/end aborted | incomplete 标记；半截保留 |
| AC-13d | 层 B | cancel 返回 error | fail-closed + 提示 |
| AC-14–16 | 层 A | 决策函数单测 + DOM `data-follow-state` | on/off/on |
| AC-17 | 静态检查 | 无「须改 SDK」硬依赖注释/代码 | 消费既有 chunk |
| AC-18 | 层 A | 同 id 多次 patch；记录 element 引用 | 同一节点 |
| AC-19 | 层 B | 模拟断连 | streaming false |
| AC-71 | 层 A | 专测 patch + follow | 绿 |
| AC-72 | 静态检查 | 测试分层标注 | 无仅 C Must |

## 约束

- I-真：`session/cancel` → `sdkSessionCancel` → `Agent.cancel(..., { keepInbox: true })`；不改 agent-loop
- T6 锁定 B：不投影 reasoning
- `detectIncomplete` 必须认 `aborted`
- **Follow 边界（HG-2 P2-2）**：
  - 新一轮流式开始（首次 chunk / streaming 置 true）时，follow-state **必须** 初始化为 `on`（除非用户已处于接管条件）
  - `decideFollowState`：`atBottom===false && userTookOver===false` 时保持当前 `followState`（骨架末支）；`userTookOver` 与 `atBottom` 须同源「接管条件」，不得矛盾
  - cancel 成功或断连 fail-closed 后：**不强制**重置 follow-state（用户接管态可保留）；streaming **必须** 为 false
- Out：活动项完整 UI（phase-3）；fork 产品路径（phase-5）

## 产出清单

- bridge/SDK cancel 三件套
- `messages/patch` 协议 + MessageStore.patch
- Host chunk 订阅与投影
- follow-state 接线到 Webview
- `replay-hydrator.detectIncomplete` 更新
- 层 A/B 测试

## Out of scope（本 Phase）

- 活动项折叠 UI 与 AC-13c 完整验收
- 重试/编辑/分叉；搜索；引用卡产品化
- 中断自动 revert 文件
