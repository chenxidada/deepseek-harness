# Phase 3: 可用级 Chat UI 底盘（主题 / 气泡 / composer / MD / 侧栏 IA）

## 目标

在既有极薄 Conversation Webview 上交付**可用级呈现底盘**：`--vscode-*` 主题基线与主题切换刷新；user/assistant 气泡分层；生成中指示；固定底栏 + Enter 发送 / Shift+Enter 换行；Connecting/失败态可读；Markdown 最小集（标题/列表/代码块+复制）且安全；Conversations/History 侧栏 IA（空 live=「新对话」；History 不列空 Tab；去命令标题堆砌）。验证以 L2/L3 为主，B1–B3 辅以 L4 截图。

## 前置条件

- HG-1 / HG-2 已确认
- 依赖 Phase：`phase-1-auto-start-orchestrator`（连接态投影缝可用）
- 可与 `phase-2-auto-ready-surface` **并行**
- 已读：`design.md` AD-CR-7；前序 AD-CU-1；`tech-debt-registry.md`

## 验收标准

- [ ] **AC-7a** B1/B2/B3 证据链 = L2/L3 主 + L4 截图辅助；非像素色值自动化；非仅人工无截图宣称达标
- [ ] **AC-8** 面板样式由 `--vscode-*`（或文档化等价）驱动；非默认裸灰框主视觉
- [ ] **AC-8a** 活动颜色主题变更 → 刷新令牌；切换后仍可读
- [ ] **AC-9** user/assistant 可区分分层（默认可不依赖角色前缀文字）
- [ ] **AC-10** 生成中可见「生成中…」或等价；空闲/完整消息后清除
- [ ] **AC-11** 固定底栏；Send 在默认浅/深色主题可辨认
- [ ] **AC-12** Enter 发送非空；Shift+Enter 换行不发送
- [ ] **AC-16** 标题/列表可读渲染；安全策略（转义 HTML、不执行脚本、不加载外链）；失败回退安全纯文本
- [ ] **AC-16a** 恶意 HTML/脚本夹具 → 不执行、不加载外链；L2/L3 否定用例
- [ ] **AC-17** fenced 代码块等宽 + 复制 → `dsh.copyToClipboard`（内部命令，可 executeCommand）；L2/L3 断言写入路径；非菜单主入口
- [ ] **AC-18** 表格/链接预览 **非** Must（缺省不构成失败）
- [ ] **AC-19** Conversations 可读标题/摘要；空 live 显示「新对话」；空态不堆砌命令标题
- [ ] **AC-19a** History **不**展示空 Tab
- [ ] **AC-20** 点击 History 非空行 → 回放（继承前序）
- [ ] **AC-25** 呈现升级不引入 Webview mode/session 权威
- [ ] **AC-27** 前序行为不回退（抽测发送/回放）

### Should（余力，非门禁）

- [ ] **AC-28** 表格或链接预览（失败仍回退纯文本）
- [ ] **AC-29** Continue 灰态短说明
- [ ] **AC-30** 「本回合改了 N 个文件」入口
- [ ] **AC-31** 代码块语言标签
- [ ] **AC-32** 未读点更明显（不改清除语义）

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-7a | L2/L3 + L4 辅助 | 协议/DOM 类名或 test hook 断言主题 class；附浅/深色截图路径说明 | 主证据非 L4-only |
| AC-8 | L3/静态 | HTML/CSS 含 `--vscode-`；无唯一硬编码灰底为主背景 | 主题变量驱动 |
| AC-8a | L2/L3 | 触发 theme change 钩子或重推消息 | 样式令牌更新；无长期不可读残留 |
| AC-9 | L3 + L4 辅助 | 气泡 class 区分 user/assistant；截图可选 | 可区分 |
| AC-10 | L2/L3 | `status/set generating|running` → UI 指示；idle 清除 | 指示出现/消失 |
| AC-11 | L3 + L4 辅助 | 底栏结构固定；Send 对比度截图辅助 | 底栏可用 |
| AC-12 | **L3 运行时** | fake Webview / 测试钩子模拟 keydown Enter / Shift+Enter | Enter→composer/send；Shift+Enter→无 send |
| AC-16 | L3 | 注入含标题/列表 MD 的 messages | 结构化渲染或安全纯文本回退 |
| AC-16a | **L3 否定** | 注入 `<script>` / 外链 img | 不执行；无外部加载 |
| AC-17 | L2/L3 | 点击复制或发 `action/copy-code`；`executeCommand('dsh.copyToClipboard')` | 命令收到目标文本；有成功反馈路径 |
| AC-18 | 静态 | 规格/实现不把表格列为 Must 失败 | 缺表格不 FAIL |
| AC-19 | L2 | 空 live Tab 时 Conversations 标签 | 「新对话」；空态无命令标题堆 |
| AC-19a | L2 | 空 session 不出现在 History list | 列表无该条 |
| AC-20 | 回归 L2 | `dsh.test.openHistory` 非空 | replay mode |
| AC-25/27 | 静态+回归 | 协议仍 Host 权威；抽测 prompt/replay | 通过 |

## 约束

- AD-CR-7；AD-CU-1 极薄决策约束不变
- CSP：禁止加载外部资源；脚本仅 webview 自有
- 复制不依赖 Webview clipboard 权限静默失败
- 不引入第二套面板架构

## 产出清单

- [ ] `chat-panel-provider` HTML/CSS/JS 升级（或 `media/chat-panel.css`）
- [ ] 安全 Markdown 渲染路径 + 否定测试
- [ ] `dsh.copyToClipboard` 内部命令
- [ ] `conversation-tab-bar` / `history-view` IA 调整
- [ ] L3 keydown / XSS / copy 测试；L4 截图存放说明（如 `tests/fixtures/screenshots/` 或 verification 附链）
- [ ] implementation.md

## 不在本 Phase 范围

- 顶栏「新建会话」主按钮与 AC-22 等待 Start 产品流（phase-4）
- Cursor 全量 / token 打字机 / 工具富卡片
- 虚拟滚动性能专项

## HG-2 收口备注（非阻塞，实施时遵守）

### VP-CR-6 执行拆解（同一 traceability 行键，测试必须拆开）

design 的 VP-CR-6 覆盖 AC-7a/8/9/11。phase-3 **必须**拆为可独立运行的用例，例如：

1. `test:theme-tokens` — AC-8（`--vscode-*` / 非裸灰框）
2. `test:bubble-layers` — AC-9（user/assistant 可区分 class）
3. `test:composer-contrast` — AC-11（底栏固定 + Send 可辨）
4. `test:visual-evidence-chain` — AC-7a（L2/L3 主证据存在；L4 截图路径仅辅助）

不得用单测「一锅烩」后宣称四条 AC 全绿。
