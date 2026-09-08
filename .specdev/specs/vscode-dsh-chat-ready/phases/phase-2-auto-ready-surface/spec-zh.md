# Phase 2: 自动就绪 — restore / New / 空 Tab / 未读策略

## 目标

在 **Conversation 视图可见** 且 Host 就绪时自动就绪：有未关 Tab → restore（活动优先、保持回放、不自动 Continue、不打未读）；无 → 自动 New → live（不打未读）。空 Tab 不入持久化 `openTabSet`；无工作区降级直接 New；自动/重复路径通过 `newConversationOrReuseEmpty`（**仅活动空 Tab 复用**，禁止全局偷换）**不叠空 Tab**。补齐 AC-7「视图可见主路径」L2 全链路证据。

## 前置条件

- HG-1 / HG-2 已确认
- 依赖 Phase：`phase-1-auto-start-orchestrator`（HG-3 通过）
- 已读：本 Phase `repo-exploration.md`；`design.md` AD-CR-3/6；`tech-debt-registry.md`

## 验收标准

- [ ] **AC-3** Conversation 可见 + Host 就绪 + 存在未关 Tab → restore；活动优先；保持回放；不自动 Continue；不产生未读
- [ ] **AC-4** 可见 + 就绪 + 无未关 Tab → 自动 New → live 可提交非空 prompt；不产生未读
- [ ] **AC-4a** 从未成功入队 prompt 的空 Tab **不**写入持久化 openTabSet；重启不恢复该空会话
- [ ] **AC-4b** 无工作区文件夹时可见触发就绪 → 直接 New → live；不 restore；不因无工作区禁用 Start（Start 仍受凭据/AC-2）
- [ ] **AC-6** 自动就绪重复触发时，若已有空 live → 复用/聚焦，不叠额外空 Tab
- [ ] **AC-7**（收口）L2 主路径：视图可见 → Start（若需）→ 就绪 → live 或 restore 保持回放；含 phase-1 已有反向用例仍通过
- [ ] **AC-27** 前序 Must（关 Tab 可恢复、删除、历史回放、Continue、Subagent）不因自动就绪回退

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-3 | L2 | 预置非空 openTabSet；mark 可见 + Host ready；`dsh.test.triggerAutoReady` | Tabs 以 replay 恢复；活动优先；continue 未自动调用；unread 均为 false |
| AC-4 | L2 | 空 openTabSet；可见+就绪 | 出现 live Tab；可 `dsh.test.sendPrompt`；unread false |
| AC-4a | L2 | 自动 New 后读 `dsh.test.getIndex`；模拟重启 hydrate | 持久化 openTabSet 不含该空 session；恢复列表无该空会话 |
| AC-4b | L2 | workspaceFolders 空；触发 Start+就绪 | Start 成功（或凭据失败走 AC-2）；就绪为 New live；无 restore 调用 |
| AC-6 | L2 | 连续两次 triggerAutoReady / 可见抖动 | Tab 数不增加；仍 live 可发送 |
| AC-7 | L2 端到端 | 单脚本串起可见主路径 + 复跑 AC-1a 反向 | 主路径 PASS；反向仍无 Host/Tab |
| AC-27 | 回归验证 | 抽跑前序 phase2/3/4 关键用例或等价钩子 | 关删/回放/Continue/Subagent 语义保持 |

## 约束

- AD-CR-3/6；未开 Conversation **禁止**自动 New（即便 Host 已 started）
- restore 路径复用 `ConversationController.restoreOpenTabSet`；扩展参数或包装以抑制 unread / 禁止 auto Continue
- 空 Tab 定义 = 从未成功入队 prompt（D-23）
- 本 Phase 不要求视觉底盘像素级完成（phase-3）

## 产出清单

- [ ] `apps/vscode-dsh/src/auto-ready-coordinator.ts`
- [ ] `ConversationController.newConversationOrReuseEmpty`（或等价）
- [ ] 与 visibility / Host ready 的接线（extension / chat-panel-provider）
- [ ] L2：主路径 + 空 Tab + 无工作区 + 未读抑制测试
- [ ] README：自动就绪时序说明
- [ ] implementation.md（implementer）

## 不在本 Phase 范围

- Chat UI 主题/Markdown（phase-3）
- 顶栏新建按钮产品主入口（phase-4；复用函数可先落地供命令路径）
- 无限重连 / 自动 Continue

## HG-2 收口备注（非阻塞，实施时遵守）

### 空 Tab → 首条成功入队后的持久化转换点

「空 Tab 不入 openTabSet」仅指 **从未成功入队任何 prompt**。一旦该 Tab 上发生**成功入队**的用户消息，它即不再为空 Tab，**必须**按前序规则写入/更新持久化 `openTabSet`（与下次 restore 可见）。自动就绪若聚焦到仍为空的活动 Tab（复用），在首条入队前仍不持久化。L2 应用「New/复用 → 入队一条 → hydrate」证明转换点。
