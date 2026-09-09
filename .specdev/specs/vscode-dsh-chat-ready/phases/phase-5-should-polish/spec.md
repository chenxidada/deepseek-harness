# Phase 5: 升格抛光 Must（原 Should AC-28…32 / AC-34）

## 目标

将本 Feature 原标注为 Should、在 phase-1…4 **未交付**的产品项升格为 **Must** 并实现：Markdown 表或链接可读呈现；Continue 灰态旁短原因；「本回合改了 N 个文件」入口；代码块语言标签；非活动 Tab 未读指示更易发现；新建会话 `contributes.keybindings`（≡ `dsh.newConversation`，含 ensureHost）。**AC-33** 底盘抛光动画明确 **Out of Scope**。禁止再以「余力/非门禁」跳过。

## 前置条件

- HG-1 / HG-2 已确认；本修订为 **post-HG-2 amendment（2026-09-09，用户选项 A）**
- 依赖 Phase：`phase-4-new-conversation-chrome`（及已合入的 phase-1…3）
- 已读：`design.md` R3 修订；`should-ac-retrospective.md`；`tech-debt-registry.md`；phase-3/4 `implementation.md` 偏差记录
- Phase Entry Gate：登记/确认无阻塞活跃债后开始

## 验收标准

全部为 **Must**（无 Should 标签）：

- [ ] **AC-28** 对话 Markdown **必须**支持表格 **或** 链接的可读呈现（至少其一）；渲染失败时 **必须** 回退安全纯文本（与 AC-16 安全策略一致：不执行脚本、不加载不可信外链）
- [ ] **AC-29** 「继续此会话」不可用或灰态期间，UI **必须**在控件旁展示简短可区分原因（例如能力不可用 / 已是 live / Host 未就绪等之一）；不得仅依赖笼统「暂不可用」且无法区分场景
- [ ] **AC-30** 当某一回合产生**可统计**的文件改动时，对话面板 **必须**在该回合相关消息流末尾（或紧邻助手消息下方）提供「本回合改了 N 个文件」简单入口；若扩展已有 Timeline/Diff 路径则 **必须**可链到该路径；无可统计改动时 **必须不**伪造入口
- [ ] **AC-31** fenced 代码块 **必须**在 fence 指定了语言时显示语言标签；无语言标记时 **必须不**编造语言名
- [ ] **AC-32** 非活动 Tab 的未读指示 **必须**比 phase-3 基线更易发现（对比度或尺寸增强至少其一）；**必须不**改变前序清除语义（激活且面板已展示后清除）
- [ ] **AC-34** `package.json` `contributes.keybindings` **必须**提供新建会话键盘入口，行为与 `dsh.newConversation` **等价**（含未连先 Start / ensureHost）；**必须不**替代或削弱面板顶栏「新建会话」按钮；缺省和弦可在 design/README 声明，用户可在 VS Code 键盘快捷方式中覆盖/禁用

### Out of Scope（本 Phase 明确不做）

- **AC-33** 底盘抛光微动画 / 密度微调
- Cursor 全量 UX、token 打字机、工具富卡片、改 agent-loop

## 验证策略

| AC | VP 引用 | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|---------|
| AC-28 | VP-CR-14a | L3 | 注入含 pipe 表格 **或** Markdown 链接的 messages；另注入恶意 HTML 夹具 | 表或链可读呈现；失败路径为安全纯文本；脚本/外链不执行 |
| AC-29 | VP-CR-14b | L2/L3 | 分别构造 Continue `visibility=disabled` 且不同 reason（能力不可用 / live / Host 未就绪） | 控件旁短文案可区分；灰态可观测 |
| AC-30 | VP-CR-14c | L2/L3 | 回合夹具带可计数 file change 元数据；无改动对照组 | 有改动 → 「本回合改了 N 个文件」入口且 N 正确；可链 Timeline/Diff（若路径存在）；无改动 → 无伪造入口 |
| AC-31 | VP-CR-14d | L3 | fence 带 `ts` / 无语言 两组 | 有语言 → 标签可见且匹配；无语言 → 无编造标签 |
| AC-32 | VP-CR-14e | L2/L3 + 可选 L4 | 对比基线 unread 指示样式（class/CSS 或可测属性）；激活清除用例 | 对比度或尺寸增强可测；激活且面板展示后 unread 清除 |
| AC-34 | VP-CR-13 | 静态 + L2 | `package.json` 含绑定 `dsh.newConversation`（或文档化等价 command）；执行命令路径含 ensureHost；顶栏按钮仍在 | keybindings 存在；行为 ≡ newConversation；chrome 按钮未移除/未降为次要唯一入口 |

建议测试落点：`apps/vscode-dsh/tests/phase5-should-polish.spec.ts`（或等价命名）；复用既有 FakeWebview / panel protocol / registry 夹具。

## 约束

- 继承 AD-CU-1：Webview 不自持 mode/session 权威
- Markdown 增强不得削弱 AC-16a（XSS 否定用例仍绿）
- AC-34 **不**改变 AD-CR-8「顶栏按钮 = 产品主入口」；键盘为辅入口但仍为 Must 交付
- AC-18（phase-3「缺表/链不构成 phase-3 失败」）**不**豁免本 Phase；Feature 收口以本 Phase AC-28 为准
- 不改 `packages/core/agent-loop`
- 文件改动入口优先复用既有 Timeline/Diff（见 `timeline-diff*` 测试与投影路径），禁止平行第二套权威 Diff UI

## 产出清单

- [ ] chat-panel Markdown：表 **或** 链接可读呈现 + 失败回退
- [ ] Continue 灰态旁短原因（协议字段或既有 continue chrome 扩展）
- [ ] 「本回合改了 N 个文件」入口 + 可选 Timeline/Diff 链接
- [ ] fenced 代码语言标签（有则显、无则不编造）
- [ ] 未读指示增强（对比度/尺寸）且清除语义不变
- [ ] `contributes.keybindings` + README 声明（和弦、可覆盖、不替代按钮）
- [ ] L2/L3：`apps/vscode-dsh/tests/` phase-5 用例
- [ ] `implementation.md` / 更新 `tech-debt-registry.md`（若有）

## 不在本 Phase 范围

- AC-33 动画抛光
- 重做自动建连/就绪/新建 chrome 核心（已交付）
- Feature 全量回归矩阵（→ phase-6）
- Cursor 全量能力

## HG-2 修订备注（实施时遵守）

1. **Must 语言**：verifier 不得对 AC-28…32、AC-34 标 ⏭️ / LOW；缺一项 → FAIL / PARTIAL。
2. **AC-34 与 phase-4 冲突消解**：phase-4 曾写「不将 keybindings 列为 Must」且测试断言无 keybindings；本 Phase **必须**更新那些断言，改为「存在且行为等价」。
3. **AC-30 计数**：仅在回合存在可统计文件改动时展示；N 来自既有投影/事件，禁止估算编造。
