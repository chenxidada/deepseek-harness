# Phase 1: 对话面板 live + 可恢复关 Tab / 删除 + Timeline 弱化

## 目标

交付**极薄**可打开的对话面板作为 live 主阅读/输入面（Webview 无决策性状态；跟 `panel/state`；Host `ui/reject-send` 兜底）；将关 Tab 默认从 dispose 改为卸 UI 可恢复；空 Tab **不**写入持久化 `openTabSet`；实现显式删除状态机；弱化 Timeline；面板等待交互可见；落地 **L2 Host 测试钩子**。**不**依赖 T-0a/T-0b。

## 前置条件

- HG-1 / HG-2 已确认
- 依赖 Phase：无（可与 Spike 并行）
- 前序 `vscode-dsh-ide` 已在 master

## 验收标准

### 面板与消息流

- [ ] **AC-1** 可打开对话面板（Webview 或等价）
- [ ] **AC-2** 无活动 Tab / Host 未连时空态或引导，无串台残留
- [ ] **AC-3** 新建活动 Tab → 面板绑定该会话空流；live 输入指向该会话
- [ ] **AC-4** 用户消息/已入队 prompt 以可读全文展示
- [ ] **AC-5** 助手输出以回合级完整 `messages/append`（非 token 分片）
- [ ] **AC-6** 内容来自权威投影；不臆造助手正文
- [ ] **AC-7** `[Should]` 运行中强「正在生成…」指示，空闲清除

### 输入发送

- [ ] **AC-9** live 输入区 + 发送动作
- [ ] **AC-10** 非空提交 → 既有 prompt 路径入队并在面板反映
- [ ] **AC-11** 非法发送经 Host `ui/reject-send`（`empty`/`replay`/`no-host`/`disconnected` 等）
- [ ] **AC-12** 复用既有会话驱动缝；不另立 agent 循环
- [ ] **AC-13** `[Should]` 保留可编程 prompt 命令（或文档化等价）

### Timeline 弱化

- [ ] **AC-14** Timeline 不再展示 assistant 长文
- [ ] **AC-15** 保留 turn/step/tool/status/subagent 短 label + 工具行 Diff 入口
- [ ] **AC-17** `[Should]` README 写明面板 vs Timeline 职责

### Tab 联动 / 关删

- [ ] **AC-18** 切 Tab → 面板与发送目标切换不串台
- [ ] **AC-21** 多 Tab 并行 running 时面板只显活动上下文
- [ ] **AC-59** 同窗口同会话仅一个 live 视图
- [ ] **AC-23** 关 Tab = 卸 UI + 保留权威；不默认 dispose；`tabId` 销毁
- [ ] **空 Tab 关闭** 无确认、不进历史、不 dispose、**不写**持久化 `openTabSet`（与恢复剔除并列，见 AD-CU-3）
- [ ] **索引立即持久化** `openTabSet` / `mode` / `activeSessionId` 每次变更立即写 `workspaceState`（AD-CU-4）
- [ ] **AC-24** 关活动 Tab 后面板切到新活动或空态
- [ ] **AC-25** running 关 Tab → 确认停止并关闭 / 取消
- [ ] **AC-26** 显式删除 → dispose + 清权威；非 running 亦须简单确认
- [ ] **AC-60** 删除关闭已打开 live Tab（禁幽灵）
- [ ] **AC-61** 父删不级联删子权威
- [ ] **AC-62** 删除入口可发现（至少命令或会话菜单）
- [ ] **AC-72** running 删除确认前不 dispose
- [ ] **AC-73** Host 未就绪禁用删除；禁止只清索引假删
- [ ] **L2 测试钩子** 每本 Phase VP 有可脱离 Webview 的 Host 命令/钩子（例 `dsh.test.sendPrompt`）；钩子仅测试暴露，不改产品语义

### 等待交互 / 权威 / 共存 / 验证门禁

- [ ] **AC-41…43** 等待交互可见；应答仍 InteractionUi；fail-closed 后解除或转错误
- [ ] **AC-45…46** 权威 = 权威会话日志；扩展只投影+索引
- [ ] **AC-48…53** 不改 agent-loop；不重做双通道/AD-8；密钥不落盘；传输失败终止不确定态
- [ ] **AC-54 / AC-84** 本 Phase 达标须 L2 + L3（**模拟 Webview 客户端**，非 HTML/CSP/渲染）可脚本证据；禁止仅 L1 / 仅人工点选（L4）

## 验证策略

> **L3 定义：** Extension Host 内 fake Webview（`postMessage` / `onDidReceiveMessage`）对接**真实 Host**消息处理，断言协议与边界；**不**验证 HTML/CSP/渲染细节。真实渲染属 L4 辅助，**不**作为本 Phase 达标门槛。
>
> **L2 可调用面：** 每个 VP 须有命令或只读/测试钩子，使 L2 **可脱离 Webview** 驱动 Host（例：`dsh.test.sendPrompt`）；钩子仅测试暴露。

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 运行时验证（L2） | Extension Host：`executeCommand` 打开面板 / 激活 WebviewView | 面板 provider 注册成功；无激活错误 |
| AC-2 | L2 + L3（模拟 Webview） | 无活动会话时经 fake Webview 读 `panel/state` / 导出快照；Webview 不自持 mode | mode=empty 或 waiting-host；消息列表空；跟 Host |
| AC-3 | L2 + L3（模拟 Webview） | 新建 Tab → 断言绑定 sessionId；composer 指向该 id | `panel/state.sessionId` 匹配；空消息 |
| AC-4 | L2 + L3（模拟 Webview） | **L2 钩子**或 fake Webview 发送用户消息后断言 MessageStore / `messages/append` | 用户全文出现 |
| AC-5 | L2 + L3（模拟 Webview） | live 完成一回合；断言单条完整 assistant `append`（非分片 patch） | 一条完整助手消息；无 token 级 patch 协议 |
| AC-6 | L1 + L2 | 伪造/缺失助手事件路径：投影不得编造助手正文 | 无幻觉助手气泡 |
| AC-7 | L2 + L3（模拟 Webview） | running 时 `status/set` 或 banner 协议；idle 清除（视觉属 L4） | 协议指示可见且可清除 |
| AC-9/10 | L2 + L3（模拟 Webview；VP-1-send） | **`dsh.test.sendPrompt`（或等价钩子）** / fake Webview `composer/send` 非空 → Host 接受 → 用户/助手消息出现 | exit 0；消息与 session 一致；可脱离 Webview |
| AC-11 | L3（模拟 Webview；VP-1-reject） | 空输入 / 未就绪 → 期望 `ui/reject-send`；无 `session/prompt` | 原因枚举正确；无假成功；Host 兜底 |
| AC-12 | 静态检查 + L1 | grep：发送路径调用既有 `prompt`/`sessionHost`；无新 agent-loop | 无另立循环 |
| AC-13 | 静态检查 / L2 | 命令仍注册或 README 文档化等价；测试钩子可发现 | 可编程入口存在 |
| AC-14 | L1 + L2 | TimelineStore 在有长助手正文时不推主行长文 | Timeline 项无长 assistant 正文 |
| AC-15 | L1 / L2 | 夹具含 tool + Diff → Timeline 仍有短 label / Diff 入口 | 入口可测 |
| AC-17 | 静态检查 | README 含面板 vs Timeline 职责说明 | 文案存在 |
| AC-18 | L2 + L3（模拟 Webview） | 两 Tab 各有消息；切 Tab → `messages/replace` 与 sessionId 切换 | 不串台 |
| AC-21 | L2 | 两 Tab running；活动面板 status 仅反映活动 Tab | 状态不串 |
| AC-59 | L1 / L2 | 尝试同 session 第二 live → 拒绝或激活已有 | 仅一条 OpenTabRecord live；按 sessionId 索引 |
| AC-23 | L2（VP-1-close） | 关有内容 Tab → spy/断言**未**调用抹盘 `session/dispose`；权威仍可读；`tabId` 销毁；索引立即落盘 | 权威仍在；UI 卸 Tab |
| 空 Tab | L2（VP-1-empty） | 空 Tab 关闭 → 无确认；持久化 `openTabSet` **无**该项；无 dispose | 不写持久化 openTabSet |
| 立即持久化 | L2 | 变更 openTabSet/mode/activeSessionId 后立刻读 workspaceState（杀进程前） | 非仅 deactivate 快照 |
| AC-24 | L2 | 关活动 Tab → 活动切换或空态 | `panel/state` 更新 |
| AC-25 | L2 | running 关 Tab：确认路径「停止并关闭」vs「取消」 | 取消不卸；确认后停止再卸 |
| AC-26/60/72 | L2（VP-1-delete） | 删除：确认前不 dispose；确认后 dispose + 权威不可回放正文；Tab 关闭（Host 钩子） | 状态机符合 AC |
| AC-61 | L1 / L2 | 父删：子 session 权威仍在（索引/磁盘） | 不级联清除 |
| AC-62 | L2 / 静态检查 | `dsh.deleteConversation`（或等价）可 `executeCommand` | 入口可发现 |
| AC-73 | L2 | Host 断开时删除命令禁用或返回明确错误；索引不被单独清空 | 无假删 |
| AC-41…43 | L2 + L3（模拟 Webview） | pending interaction → `status/set` waiting；fail-closed 后解除 | 状态正确 |
| AC-45/46 | L1 | 扩展索引写入不含消息正文库 | 仅元数据 |
| AC-48…53 | 静态检查 + 回归 | 无 agent-loop 改动；既有 fail-closed / 密钥回归用例仍过 | 回归绿 |
| AC-54/84 | 运行时验证 | 本 Phase `test-scripts` 跑通 L2 runner（含 Host 钩子）+ L3（模拟 Webview）协议用例；覆盖 VP-1-* | 命令 exit 0；禁止仅人手点 / 仅渲染观感达标 |

**Runner：** 优先 `@vscode/test-electron`（或仓库等价）。环境无法跑 L2 → 不得宣称本 Phase 行为已在 Extension Host 验证。

## 约束

- design AD-CU-1/3/4/5/6/9/12（极薄 Webview；空 Tab 不入 openTabSet；立即持久化；tabId 生命周期）
- MVP 无超大流分页 / 流式 patch；切 Tab 用 `messages/replace`
- 关闭路径禁止调用会抹盘的 dispose；删除才走 `session/dispose`
- 须暴露可被 L2（**脱离 Webview 的 Host 钩子**）与 L3（模拟 Webview）驱动的命令/钩子/协议 harness
- Webview 不持决策性状态；mode/session 只跟 `panel/state`
- 不实现历史回放重建 UI / Continue / 重启全集 / Subagent 进入

## 产出清单

- **极薄 Webview**（最小渲染；无决策性状态；Host `ui/reject-send` 兜底）
- **L2 Host 测试钩子**（例 `dsh.test.sendPrompt` 及关/删/读状态钩子）+ **L2 Extension Host harness + 最小冒烟（激活扩展 / 打开面板或等价）必须落地**
- `apps/vscode-dsh/src/chat-panel/**`（或等价）
- `message-store.ts`；更新 controller / registry / timeline-store / extension / README；`extension-index` 立即写 workspaceState
- L1 单测 + L2 Extension Host 用例 + L3（模拟 Webview）协议用例
- `implementation.md`（implementer）

## 排除项

| 项 | 归属 |
|----|------|
| 历史列表 + 回放重建 | phase-2 |
| 未读点 / 审批串行完备 | phase-2 |
| 重启恢复 / Continue / AC-76/77 | phase-3 |
| Subagent | phase-4 |

## 依赖

无。
