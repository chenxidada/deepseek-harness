# Phase 1: 代码引用 — 指针预填 + 磁盘 read 契约

## 目标

交付 **R3.1a 指针模型** 代码引用面：非空选区经命令/右键在 **自动保存成功** 后预填官方 `@路径`（含空格则 `@"…"`）+ 自然语言行范围（**无**选区正文 / `languageId`）；发送门禁按官方文法提取并校验 `@路径` 后 **原样** 纳入 user 消息（**禁止**读盘拼接）；ide profile 挂载等效 `FILE_REFERENCE_PROMPT`（AC-3b）；L2 stub 证明 **每个去重后的有效引用 path** 在最终回答前至少一次「入参覆盖该 path」的 `read`（AC-3a）。本 Phase **不依赖** 归属 Spike，**必须不**假定变更列表已存在，**必须不**实现旧 AD-CCD-11 正文注入。

## 前置条件（依赖的 spec 文件 + 已完成的 Phase）

- HG-1 / HG-2 已确认
- 依赖 Phase：**无**（可与 `phase-0-spike-attribution-snapshot` 并行）
- 基线：`vscode-dsh-chat-ready` Conversation 面板、`ensureHostForSend`、composer 协议（仅 `text`）
- 必读：`design.md` **AD-CCD-11…15**（含 HG2-review-P1 修订）、P2 接受声明；`requirements.md` AC-1…4 / 3a / 3b；`phases/phase-1-code-context/repo-exploration.md`
- **开工前必查（P2-3）**：确认 ide profile 默认 agent **已注册 `read`（或文档化等价）**；若无则先补齐/升级设计，**禁止**在无 read 时假装 AC-3b 生效
- **开工首探（P2-A）**：探测 read 工具入参 schema；无结构化 path/file/target 时须定义提取规则并回写 `design.md` AD-CCD-14，不得假设字段存在

## 验收标准

全部 **[Must]**：

- [ ] **AC-1** — 非空选区触发命令或右键 → 若文档脏则先自动保存；**保存失败 → 必须不**生成引用并提示手动保存后重试；成功或不脏 → 激活/复用 **live** 对话，预填 **仅** 官方 `@路径` token + 自然语言行范围；路径含空格时 **必须** `@"path with spaces"`（**禁止**无引号空格路径）；**必须不**预填选区正文或 `languageId`；可补充提问发送。回放/只读 Tab → **必须不**向只读 Tab 发送，改为 live Tab 预填。
- [ ] **AC-2** — 空选区触发 → **必须不**生成引用消息，且 **必须**轻量提示。
- [ ] **AC-3** — 发送含 `@路径` → 按官方文法提取 token；校验存在且在工作区内（reason 仅 `not-found` / `outside-workspace` / `ambiguous-root`）；**禁止** `unreadable` 预检；无效 → 明确提示且 **必须不**发送；有效 → 引用文本 **原样**纳入 user 消息，且 **必须不**在发送前读取并附加任何文件内容。
- [ ] **AC-3a** — 含一个或多个有效引用的交互：对消息内有效引用 path **按路径去重**后，会话日志中 **每个** path **至少一次**读取工具调用，且调用入参经 AD-CCD-14 判定**覆盖**该 path，且全部先于该 turn **最后一条** `assistant/message`（与 N-2 锚点同一定义；L2 stub）。单引用无 read 即答 → 失败；多引用只覆盖其一 → 失败；同 path 两处 `@` 只需覆盖一次；全覆盖（顺序任意）→ 通过。文档注明 stub ≠ 真模型。
- [ ] **AC-3b** — ide 缺省时：扩展所启动的 ide profile **必须**具备等效 `FILE_REFERENCE_PROMPT`（实现：`packages/bundle/ide` **预挂载** `file-reference-local`，扩展激活 spawn 后自带引导，**无需**运行时二次注入；见 AD-CCD-13 P2-C）；L2 可观测 assembled system prompt 含该引导；**禁止**改 agent-loop。implementation.md **必须**记录挂载前后 idle CPU/内存观测（不设硬阈值，P2-2）。
- [ ] **AC-4** — 消息中每条引用可被识别为具体文件（引用卡/折叠 `@路径`）；行范围可作描述；底层消息 **必须不**含文件正文。点击引用卡打开时行号来自预填时扩展本地选区元数据（若有），**必须不**解析自然语言行范围。

### P1 硬性落点（本 Phase Must — HG-2 审查）

- [ ] **P1-1** — `covering path` 判定实现 AD-CCD-14：从 tool 入参提取 path 集合并与归一化引用 path 规范化相等；目录/glob 默认不算除非文档化规则；stub 优先精确单文件 path；「最终回答」= N-2 锚点（turn 内最后一条 assistant）。
- [ ] **P1-2** — `AtPathResolve.reason` **不得**含 `unreadable`。
- [ ] **P1-3** — at-path 解析对齐 `dsh-file-reference/grammar`（含 `@"…"`）；自然语言后缀不并入 path；**必须**有带空格路径 L2 夹具。
- [ ] **P2-A** — 开工探测 read 入参 schema；若无结构化 path 字段 → 定义提取规则并回写 design AD-CCD-14。

### P2 文档义务（本 Phase Must）

- [ ] 在实现 README / phase implementation 或 Host 模块注释中声明：**本版本接受模型可能整文件 `read`**（AD-CCD-15）；不得以实现「只贴选区」为由回退内联。

### Out of Scope（本 Phase）

- `@` 自动补全下拉 UI
- Cmd+L / 浮动对话框
- `@path:start-end` 文法
- 变更列表 / 归属 / 撤销
- 修改 agent-loop
- 正文注入（VOID）
- 发送前读文件内容做权限探测

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | L2/L3 | 脏文档 save 成功/失败；非空选区；含空格路径预填；回放 Tab | 失败无预填；成功预填为官方 token+自然语言；空格用 `@"…"`；live 激活 |
| AC-2 | L2 | 空选区触发 | 无引用发送；提示可观测 |
| AC-3 | L2 | 合法相对/绝对；非法；多 root；**禁止**为 unreadable 造假拒绝 | 合法：user text 含 @、无文件正文；非法/歧义 reject-send |
| AC-3a | L2 | stub：① 单引用无 read；② 双 path 只覆盖其一；③ 双 path 均覆盖；④ 同 path 两处 `@` 只 read 一次即过；⑤ 入参无法映射到 path 的假 read | ①②⑤ 失败；③④ 通过 |
| AC-3b | L2 / 静态+运行时 | boot ide；system prompt；agent-loop 无 diff；idle 观测记录 | 含 FILE_REFERENCE；无 agent-loop 改动；观测写入 implementation.md |
| AC-4 | L2 | MessageStore / 引用卡；打开钩子带 meta 行号 | UI 可识别；权威无正文；打开用 meta |
| P1-1…3 | L2/静态 | 见上夹具 + 类型/解析单测 | 契约可测 |
| P2 | 静态检查 | implementation.md 声明 AD-CCD-15 | 有接受整文件 read 声明 |
| P2-3 | 静态/L2 | 核对 ide agent 工具列表含 read | 有则继续；无则阻断并升级 |
| 回归 | L2 | 普通无 @ 发送 | 不破坏 composer/send |

## 约束

- 右键与命令 **同路径**（D-6）
- Host 门禁在 Extension Host；Webview 不自作路径 IO 拼正文
- **AD-CCD-11**：指针 only；官方 `@` 文法；旧注入禁止
- **AD-CCD-12**：脏保存失败不生成引用
- **AD-CCD-13**：ide bundle mount；idle 观测；read 工具存在性必查
- **AD-CCD-14 / 15**：每去重 path 的覆盖性 read；接受整文件 read
- 不改 agent-loop；不写权威日志快照
- 验证主证据 L2/L3；L4 不得唯一达标

## 产出清单

| 产出 | 路径（预期） |
|------|----------------|
| 选区模块 | `apps/vscode-dsh/src/code-context/selection-ask.ts` |
| @路径模块 | `apps/vscode-dsh/src/code-context/at-path.ts`（镜像官方 grammar） |
| 选区元数据 | `apps/vscode-dsh/src/code-context/selection-meta.ts` |
| AC-3a 覆盖判定 | `apps/vscode-dsh/src/code-context/ref-read-coverage.ts`（或测试旁路纯函数） |
| ide mount | `packages/bundle/ide/cordis.patch.yml` + package 依赖 |
| 命令/菜单 | `extension.ts` + `package.json` contributes |
| 协议/发送门禁 | `chat-panel-host.ts` / `protocol.ts` |
| AC-3a stub 测试 | `apps/vscode-dsh/tests/`（含多引用、同 path 去重、空格路径、假入参） |
| 实现/审查/验证文档 | `phases/phase-1-code-context/*.md` |
| 中文镜像 | `spec-zh.md` |
