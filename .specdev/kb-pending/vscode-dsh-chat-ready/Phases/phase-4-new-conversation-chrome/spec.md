# Phase 4: 顶栏新建会话 + 等待 Start 态 + 窄栏可达

## 目标

Conversation 界面顶栏/chrome **常驻**「新建会话」产品主入口；点击走与 `dsh.newConversation` 等价路径；Host 未连时 **先 Start**，等待期间展示「正在连接到 Host…」（或等价），**不得**误示可发送 live；成功后聚焦面板并进入 live（或按 AC-6 复用空 Tab）。窄栏下可溢出，但须一次点击或「展开+首项」可达。交付 L2 按钮/协议证据。Should：键盘辅入口（AC-34）不得替代按钮。

## 前置条件

- HG-1 / HG-2 已确认
- 依赖 Phase：`phase-1-auto-start-orchestrator`、`phase-3-chat-ui-chassis`（均 HG-3 通过）；**不**硬依赖 phase-2（可与 phase-2 并行）
- 已读：`design.md` AD-CR-8/6；`tech-debt-registry.md`

## 验收标准

- [ ] **AC-15** 顶栏/chrome 常驻「新建会话」；live/回放/空态/连接中等常见态可见可点；窄栏一次点击或展开+首项可达；不因缺少可达入口合格
- [ ] **AC-21** 按钮为产品主入口；默认可发现可激活；**不**将 `contributes.keybindings` 列为 Must
- [ ] **AC-22** 未连时点击 → 先 Start → 成功后 New/复用 → 聚焦面板 → live；等待期明确「正在连接到 Host…」；等待期 **非** 可发送 live；Start 失败走 AC-2
- [ ] **AC-23** 已连时点击 → 新 Tab 或 AC-6 复用空 Tab → 聚焦 → live
- [ ] **AC-24** L2：经 `action/new-conversation` 或 command id → 需新建时 Tab+1 且 live；AC-6 复用时证明未叠空 Tab 且 live
- [ ] **AC-6**（按钮路径复验）连续多次新建 + **活动**空 Tab → 复用；活动已有内容 → 新建（不跳到其它空 Tab）
- [ ] **AC-34** `[Should]` 若提供 keybindings → 与 `dsh.newConversation` 等价（含未连先 Start）；**不**替代或削弱顶栏按钮

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-15 | L3 + L4 辅助 | panel/state chrome 字段或 DOM 含新建控件；窄栏溢出模拟 | 可达；非图标-only 唯一替代 |
| AC-21 | L2/L3 | 断言按钮协议存在；package.json **无**强制 Must keybinding 门禁 | 主入口为按钮 |
| AC-22 | **L2/L3** | Host 未连；发 `action/new-conversation`；观察 connectionPhase 序列 | connecting 文案；完成前 mode≠可发送 live；成功后 live |
| AC-23 | L2 | Host 已连；新建 | Tab+1 或复用；live |
| AC-24 | **L2** | 脚本驱动协议/命令；断言 Tab 计数与 panel snapshot mode | 证据可脚本；L4 非唯一 |
| AC-6 | L2 | (a) 活动空 Tab 连续新建；(b) 活动有内容且另有遗留空 Tab 时新建 | (a) Tab 数保持 1；(b) 新建而非切到遗留空 Tab |
| AC-34 | 静态/可选 L2 | 若实现 keybindings：执行绑定命令 | 行为等价；README 声明不替代按钮 |

## 约束

- AD-CR-8/6；复用 `newConversationOrReuseEmpty`（活动空 Tab 复用）与 phase-1 Orchestrator
- 等待 Start 期间发送门禁仍由 Host `ui/reject-send` 兜底
- 不以二级菜单深处隐藏「新建会话」
- 完整 Feature 回归：抽测 AC-1a 反向与视图可见主路径仍绿

## 产出清单

- [ ] Webview 顶栏「新建会话」+ 窄栏溢出行为
- [ ] `action/new-conversation` 协议处理（Host）
- [ ] 等待 Start 文案/connectionPhase 绑定
- [ ] L2：`tests/` 按钮新建 / 未连先 Start / AC-6 复用
- [ ] 可选：`package.json` keybindings（Should）+ README
- [ ] implementation.md；更新 `feature` 收尾所需 verification

## 不在本 Phase 范围

- 重做自动建连/就绪核心（已在 phase-1/2）
- Markdown/主题大改（已在 phase-3）
- Cursor 全量能力

## HG-2 收口备注（非阻塞，实施时遵守）

### VP-CR-10c / AC-24 断言载体

「Tab+1 且 live」与「复用不叠空且 live」**必须**用可编程断言，不得靠视觉：

- Tab 计数 / 活动 tabId：`ConversationController` / registry 快照，或 `dsh.test.*` 暴露的索引快照；
- live 可发送：`panel/state`（或等价）中 `mode === 'live'`（及非 connecting）；
- 禁止仅用 DOM 截图作为 AC-24 Must 唯一证据。

### AC-27 回归（收口逐项，禁止笼统「抽测」）

Feature 收口时至少各 1 条最小 L2（或复用前序测试入口）：

1. 关 Tab 可恢复
2. 历史回放打开
3. Continue（能力可用时）
4. Subagent 进入（前序已交付路径）

每条在 verification 中单独勾选，不得合并成一句「抽测通过」。

### 可选：回收其它非活动空 Tab（AD-CR-6 Should）

若实现：须**静默**关闭/回收，不产生历史条目、不弹确认、不发未读/通知；走既有卸 UI + 更新索引路径时不得把空 Tab 写入权威历史。空 Tab 无内容，不触发「有内容关闭确认」。
