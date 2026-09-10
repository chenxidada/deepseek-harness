# Phase 1: 层 A 基建 + 呈现态边界与探针

## 目标

交付可脚本渲染（层 A）主基建：从 Webview 内联逻辑抽离 `render/sync` 模块，jsdom 挂载并断言真实 DOM；按**修订 AD-CU-1**允许呈现态下放并强制探针契约（含 follow-state 骨架）；决策态仍留 Host。为后续流式/活动/交互 Phase 提供可复用测试入口。

## 前置条件

- HG-1 / HG-2 已确认
- 依赖 Phase：无
- 前序 `vscode-dsh-conversation-ui` / `vscode-dsh-code-context-diff` 已在主干可用
- `tech-debt-registry.md` 当前无活跃阻塞债

## 验收标准（裁剪自 requirements）

- [ ] **AC-1** 决策态保留在 Host；Webview **不得**单独裁决最终 mode/sessionId/能否发送/Continue/变更权威结果
- [ ] **AC-2** 允许 Webview 持有呈现态（滚动、展开折叠、流式中间态、optimistic、follow-state）
- [ ] **AC-3** 下放呈现态须暴露探针：至少 streaming、活动项状态、展开态、follow-state；P-接续父 E2 探针位预留；**若**有 optimistic **则**收敛态可观测（禁止无 optimistic 时造假探针）
- [ ] **AC-4** optimistic 须向 Host 权威收敛，不得永久覆盖决策态（无 optimistic 实现时可文档化「本 Phase 无 optimistic」+ 契约位）
- [ ] **AC-5** 本 Phase 达标含层 A 证据（本 Phase 无强制 Host 行为 cancel/fork 时，层 B 以探针/协议契约冒烟即可）
- [ ] **AC-6** 层 A 以抽离 render/sync 为主入口；jsdom 断言真实节点/属性；**禁止**整页 `runScripts: 'dangerously'` 作唯一/主路径；**禁止**仅 `toContain`
- [ ] **AC-7** 仅层 C 不得判达标
- [ ] **AC-8** 按修订 AD-CU-1 执行；不得以「极薄不得持呈现态」拒绝 AC-2/3
- [ ] **AC-70** F0 功能区至少一条层 A 可断言形态（本 Phase 交付骨架断言：挂载、`data-follow-state`、消息节点契约）

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 层 B 静态/协议 | 读 protocol + Host push `panel/state`；FakeWebview 不得本地改 mode 生效 | 决策字段仅 Host 帧 |
| AC-2 | 层 A | jsdom 中设置 follow/expanded 呈现态 | DOM/`dsh.test` 可读 |
| AC-3 | 层 A + 契约 | 读取探针对象最小集；乐观条件分支单测 | 必选探针存在；无 optimistic 时无假字段 |
| AC-4 | 层 A/B 条件 | 若实现 optimistic：注入 Host 否决帧 | 收敛到 Host；探针 converged/rejected |
| AC-5 | 回归验证 | 本 Phase CI 含 layer-a 测试文件 | 层 A 绿 |
| AC-6 | 层 A + 静态检查 | 测试 import `chat-panel/render/*`；grep 主测试路径无 dangerously 依赖 | 抽离模块为入口 |
| AC-7 | 静态检查 | spec/测试说明层 C 非 Must | 无仅 Electron Must |
| AC-8 | 静态检查 | 代码/注释不再把 AD-CU-1 解释为禁止呈现态 | 与 constitution §7.2 一致 |
| AC-70 | 层 A | 最小 fixture：render 空列表 + 设 `data-follow-state=on` | 断言通过 |

## 约束（来自 design.md）

- AD-CUX-1、AD-CUX-2、AD-CUX-4（决策函数可先单测，完整跟滚接线可在 phase-2）
- 宪法 §7.1 / §7.2
- Out：不实现完整 chunk/cancel/fork/搜索产品行为（可 stub 探针位并注册非阻塞债若需）

## 产出清单

- `apps/vscode-dsh/src/chat-panel/render/`（follow-state、message-dom、sync-chrome 等）
- `apps/vscode-dsh/src/chat-panel/probes.ts`（或等价）
- protocol / provider 改为调用抽离模块
- `apps/vscode-dsh/tests/layer-a/`（或等价）jsdom 套件
- `phases/phase-1-foundation-render-probe/implementation.md` 等流水线产物

## Out of scope（本 Phase）

- 真实 `assistant/chunk` 消费与 cancel bridge
- 活动项完整状态机、fork、搜索档 2
- thinking UI；整页 dangerously 主基建
