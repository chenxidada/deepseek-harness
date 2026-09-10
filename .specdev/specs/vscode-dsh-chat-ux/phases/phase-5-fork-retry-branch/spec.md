# Phase 5: 复制 / P-接续重试编辑 / P-标明分叉

## 目标

交付消息复制；重试/编辑重发 = fork @ 已关闭 turn + **P-接续** + 父 Tab **E2**；显式分叉 = fork + **P-标明**；非法 boundary（含 aborted turn 自身）拒绝；子会话变更基线 = fork 时磁盘空桶（AC-64）；Continue 保持 same-id 且可对照测试。

## 前置条件

- 依赖 Phase：`phase-2-streaming-cancel-follow`（可与 phase-3/4 并行）
- X2 / X3；AD-CUX-5 / AD-CUX-6
- 多 Tab live|replay 闸门已存在

## 验收标准（裁剪自 requirements）

- [ ] **AC-30** 复制写入剪贴板；可脚本环境另有 `lastCopiedText`（或 Fake clipboard）供层 B
- [ ] **AC-31** 重试上一 closed turn → 新 sessionId + P-接续；**父 Tab `mode` 强制 → `replay`** + E2；层 B 断言 id 不同且父 mode≠live；父 E2 可被 AC-3 探针断言
- [ ] **AC-31b** 父 Tab E2（`mode=replay`、禁发送、Continue 封印、可浏览/revert）可探针；层 B 拒绝「父仍 live 仅前端禁发」的假只读
- [ ] **AC-32** 编辑重发 fork 自该 user 所属 closed turn；P-接续+E2（含父 mode→replay）；非 Continue resume；无同会话截断假设
- [ ] **AC-33** 重试/编辑/分叉共用 fork(closed turn)；产品用入口区分 P-接续 vs P-标明；无同会话截断能力
- [ ] **AC-34** 非合法 closed turn（含 aborted 自身、open、无法映射到正常 `turn/end` 的 seq）禁用/拒绝并可见原因
- [ ] **AC-60** 指定已关闭 turn 分叉 → 新 sessionId + P-标明；层 B 断言 fork 成功；**父 mode 不强制改为 replay**
- [ ] **AC-61** 非已关闭 turn → 拒绝/禁用；`turn`/`seq` 均须先验为正常 closed `turn/end`
- [ ] **AC-62** 分叉入口/结果与 Continue 可区分
- [ ] **AC-63** UI 展示可理解父子关系（派生自/父会话）
- [ ] **AC-64** 子变更基线 = fork 时磁盘；父未撤销变更不入子；不 checkout；父 aborted 变更留父可 revert
- [ ] **AC-65** Continue = same-id resume；层 B 断言 Continue 前后 sessionId 不变
- [ ] **AC-66** P-接续不复用原位 `continueConversation` resume 父 id；须绑定 child 并切换活动 Tab

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-30 | 层 B | 触发 copy；读 `dsh.test.lastCopiedText` | 文本匹配 |
| AC-31/31b/66 | 层 B | 重试后读 tab set / probes | 新 id；父 mode=replay；parentReadonly；active=child；非父 id resume |
| AC-32 | 层 B | 编辑 user 重发 | 边界正确；E2 |
| AC-33 | 静态+层 B | 三入口皆调 fork 编排 | 无 truncate API |
| AC-34/61 | 层 B | aborted turn 点重试/分叉 | 拒绝+原因 |
| AC-60/62/63 | 层 B | 分叉 | 新 id；父仍可按原 mode；父子文案 |
| AC-64 | 层 B | 父有未撤销 change；fork 后读子 ChangeStore | 空；无 checkout |
| AC-65 | 层 B | Continue 前后 sessionId | 相同 |

## 约束

- 禁止同会话 truncate；禁止拷贝父 Change index
- E2：**父 `mode=replay`**、禁发送、Continue sealed、可 revert 父变更；探针 parentReadonly（Host 决策态镜像，Webview 只读）
- boundary：`turn`/`seq` 均须验证正常 closed `turn/end`（非 aborted）后再 fork（design AD-CUX-5）
- **父会话 running 闸（HG-2 P2-1）**：若父会话当前存在 **running open turn**（`streaming`/session status running 或等价），重试 / 编辑重发 / 分叉入口 **必须** 禁用或拒绝并给出可见原因；**必须不**在父仍生成中时发起 fork，避免多 live 交叉干扰
- bridge/SDK fork 按 design 接线；不改 agent-loop
- Out：搜索档 2；thinking；中断自动 revert

## 产出清单

- `fork-orchestrator`（或 controller 方法）
- bridge/SDK `session/fork`（若尚无）
- P-接续 / P-标明 UI + E2 封印
- 父 running 时禁用/拒绝重试·编辑·分叉（层 B 可测）
- 复制可观测出口
- 层 B 集成测试（fork / E2 / AC-64 / Continue 对照）

## Out of scope（本 Phase）

- 搜索 UI 与 path 索引（phase-6）
- 引用/diff 主交付（phase-4，并行不阻塞本 Phase 开工）
