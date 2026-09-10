# Design: vscode-dsh-code-context-diff

<!--
  slug: vscode-dsh-code-context-diff
  audience: implementer / reviewer / verifier / HG-2
  language: zh (canonical). Mirror: design-zh.md
  requirements: R3.1a (HG-1 passed)
  constitution: constitution.md §2.4 pointer model
  status: awaiting HG-2
  supersedes: 2026-09-09 旧 design（AD-CCD-11 正文注入 = VOID）
  policy: 禁止 Should/Could；禁止改 agent-loop；快照仅扩展本地
-->

## 范围覆盖

本设计覆盖 `phase-plan.md` 全部四 Phase：`phase-0-spike-attribution-snapshot`（可与 phase-1 并行）、`phase-1-code-context`（指针引用 + read 契约）、`phase-2-change-list-display`、`phase-3-review-revert-replay`。  
**作废**：旧 AD-CCD-11「方案 A 改写权威 user 正文 / 内联文件内容」——与 R3.1a D-11 / Constitution §2.4 冲突，**不得**再实现。

## 架构摘要

本 Feature 在 chat-ready「点开即可聊」之上交付两条独立产品面：

1. **代码引用（指针 + 磁盘 read）**：选区命令/右键与手输 `@路径` 只把官方 `@路径`（+ 自然语言行范围）作为 **纯文本** 发给 DSH；权威 `user/message` **禁止**含文件正文。内容靠模型（或 L2 stub）调用 `read`（或等价）从磁盘取得。ide profile 通过挂载 `@deepseek-ai/dsh-file-reference-local` 补齐 `FILE_REFERENCE_PROMPT`（AC-3b），**不改** agent-loop。
2. **变更可见可控（阻塞于 Spike）**：在 `tool/result.meta.diffs` 归属之上做消息附属变更列表、按需 `change/get-diff`、审阅与扩展侧撤销；快照仅扩展本地。

**AC-30** 摘要入口保留，语义收紧为跳转消息附属列表（N-1）；N=0 隐藏入口。

## HG-1 确认附注 — 正式决议（N-1…N-4 + P2 + AC-3a/3b）

### N-1 · AC-6 与 AC-30 当 N=0

| 条件 | 消息附属变更列表（AC-6） | AC-30 `diff-summary` |
|------|--------------------------|----------------------|
| N > 0 | 折叠「改动了 N 个文件」+ 条目 | **展示**；点击 **必须** reveal 消息下 change-list（AD-CCD-4），**不得**仅开 Timeline |
| N = 0 | **必须**一句无变更说明；**不得**空列表骨架 | **必须不**注入 / 保留可点入口 |

### N-2 · 一次执行 ↔ 助手消息

| 术语 | 定义 |
|------|------|
| **一次执行** | 仅顶层会话一对 `turn/start`…`turn/end`；子代理嵌套 turn **不得**单独开窗 |
| **锚点消息** | 该 turn 内 **最后一条** `assistant/message` 投影；变更列表挂靠其 `messageId` |
| **定稿** | 优先顶层 `turn/end`（或 idle）合并定稿并推 Webview |

同 turn 多写同 path → 一条合并最终差异。Subagent 写入并入父顶层 turn。

### N-3 · AC-17 脏信号

1. **主信号**：目标路径当前权威内容 SHA-256 vs 变更 **after-image** hash。  
2. 不一致 → 必须确认「撤销将丢失后续改动」；取消不写盘。  
3. 打开文档 `isDirty` 与 hash **OR**。  
4. **禁止**仅用 mtime 作唯一判定。

### N-4 · AC-22 快照生命周期

| 层级 | 内容 | 回放 |
|------|------|------|
| ChangeRecord 索引 | path、type、+/-、status、sourceMessageId、turn、snapshotRef… | **Must** 路径+统计 |
| Snapshot blob | oldText/newText | 未 prune 可完整 diff；已 prune → 说明「完整 diff 不可用」，不伪造 |
| 权威会话日志 | **禁止**快照明文 | — |

生命周期见 AD-CCD-6。

### P2 · 自然语言行范围 vs 整文件 read（接受声明）

**本版本立场（Must 写清，非门禁收窄）**：行范围仅自然语言附着（D-14）；核心 `read` **尚无**产品化行范围参数时，模型可能 `read` **整文件**。本 Feature **接受**该 token / 「只看这段」预期偏差。

| 项 | 决议 |
|----|------|
| 扩展 | **不得**为「只读几行」而内联选区正文；**不得**发明 `@path:3-40` 文法 |
| 打开定位 | 点击引用卡用扩展本地选区元数据（`startLine`/`endLine`），**不**解析自然语言 |
| 未来 | 若核心 `read` 支持行范围，可另开 Feature 收窄；**不在本 Feature 范围** |
| 验证 | AC-3a 只要求「每个 path ≥1 次 read 且先于最终回答」；**不**要求 read 参数含行号 |

### AC-3a stub 接线（摘要；细节见 AD-CCD-14）

- L2 使用 **scripted / stub LLM**：遇 user 文本中有效 `@路径` 集合时，对 **按路径去重后的每个** path 发出「入参覆盖该 path」的 `read`（或等价），全部完成后再产出最终 assistant 文本。
- 断言：见 AD-CCD-14（入参映射 + 去重）；缺任一 path → 夹具失败。
- 多引用 **不**约束 path 间顺序。
- **边界**：stub PASS ≠ 真模型行为；真模型抽测仅观测记录，不得作 Must 唯一证据。

### AC-3b 挂载形态（摘要；细节见 AD-CCD-13）

- **主路径**：在 `packages/bundle/ide/cordis.patch.yml` **insert** `@deepseek-ai/dsh-file-reference-local`（与 web-app 同插件）。该插件在 agent 具备 `read` 时向 `systemPrompt` 注册 section `context:file-reference`，文本为稳定常量 `FILE_REFERENCE_PROMPT`（来自 `dsh-file-reference`）。
- vscode-dsh 始终 `spawn dsh --profile ide`：扩展激活 → Host 起进程 → ide 已含引导 = 「扩展侧产品面补齐」，**零 agent-loop 改动**。
- **禁止**：改写 user 正文塞文件；通过改 agent-loop / `deriveMessages` 注入；依赖未挂载时静默跳过。
- L2：boot ide（或等价 REAL 组合）后断言 assembled system prompt 含 `FILE_REFERENCE_PROMPT` 原文（或 `context:file-reference` section 非空）。

## 核心实体 / 数据模型

```typescript
type ChangeKind = 'created' | 'modified' | 'deleted'
type ChangeStatus = 'unreviewed' | 'reviewed' | 'reverted'

interface ChangeRecord {
  changeId: string
  sessionId: string
  turn: number
  sourceMessageId: string
  path: string
  kind: ChangeKind
  status: ChangeStatus
  additions: number
  deletions: number
  createdAt: number
  updatedAt: number
  snapshotRef?: string
  afterContentHash: string
}

interface ChangeSnapshot {
  snapshotRef: string
  path: string
  oldText: string | null
  newText: string
}

/** 选区预填：权威消息仅含指针文本；行号仅扩展本地 */
interface SelectionPointerPrefill {
  /** 将写入 composer / user 文本，例：`@src/foo.ts 的 3-40 行` */
  pointerText: string
  /** 工作区相对路径（校验后） */
  path: string
  startLine: number
  endLine: number
  // 禁止：selectionBody、languageId 进入权威 user 正文
}

/** @路径 校验 — 无 content；发送前仅 not-found / outside-workspace / ambiguous-root */
type AtPathResolve =
  | { ok: true; path: string }
  | { ok: false; raw: string; reason: 'not-found' | 'outside-workspace' | 'ambiguous-root' }
  // 禁止 'unreadable'：不做发送前内容读/权限探测；read 失败由会话自然汇报

interface ChangeListPayload {
  turn: number
  sourceMessageId: string
  changes: ReadonlyArray<Pick<ChangeRecord,
    'changeId' | 'path' | 'kind' | 'status' | 'additions' | 'deletions' | 'snapshotRef'>>
  emptyNotice: boolean
}
```

MessageStore：`kind` 增补 `'change-list'`（及既有 `diff-summary` / `notice` 等）。

## API 域

| 表面 | 协议 | 说明 |
|------|------|------|
| 命令 | `dsh.askAboutSelection` | 脏则先保存；失败 → 不生成引用 + 提示；成功 → live 对话预填 `pointerText`（无正文） |
| 菜单 | `editor/context` → 同上 | D-6 同路径 |
| composer 发送 | Host 门禁 | 解析/校验 `@路径`；非法 → `ui/reject-send`；合法 → **原样文本** `prompt`（**不**读盘拼接） |
| Webview→Host | `change/mark-reviewed` | 仅改状态 |
| Webview→Host | `change/revert` / `change/revert-many` | 确认后门禁写盘；批量见 AD-CCD-10 |
| Webview→Host | `change/open` / `change/reveal-source` / `change/get-diff` | 打开定位 / 溯源 / 按需 diff |
| Host→Webview | `change/diff-content` | `{ changeId, available, oldText?, newText?, reason? }` |
| Host→Webview | `panel/state` 含 `change-list` | 轻量列表，无大段正文 |
| AC-30 | `diff-summary` 点击 | reveal change-list（AD-CCD-4） |
| L2 | `dsh.test.*` 风格钩子 | 注入 diffs、读 ChangeStore、脏 hash、stub LLM 脚本、断言 prompt section |

## 架构决策（AD）

### AD-CCD-1 · 归属主源 = `meta.diffs`（宁可漏记）

**决策**：ChangeAttributor 仅在顶层 turn 窗口内，从 SDK `session.event` → `tool/result` 可恢复 `meta.diffs`（及 Spike 书面确认的等价事件）入账。**禁止**裸 `FileSystemWatcher` / 全量 `onDidSave` 入账。

**理由**：Timeline 已证明可测；全盘 watcher 无法满足 AC-9 / D-4。

**替代**：受控前后快照对比 — 仅 Spike 证明 `meta.diffs` 不足时启用，且仍绑定 tool/call。

**门禁**：phase-0 未 PASS → 禁止开工 phase-2/3。

### AD-CCD-2 · 一次执行 = 顶层 turn；列表挂靠最后一条助手消息

见 N-2。

### AD-CCD-3 · 快照与审阅状态仅扩展本地

禁止写入权威会话日志明文（AC-24）。

### AD-CCD-4 · AC-30 与变更列表共存

见 N-1。Timeline / `reviewWorkspaceDiffs` 弱化，非主路径。

### AD-CCD-5 · 同 turn 同 path 合并最终差异

首次 `oldText` + 末次 `newText`；中间版本 Out of Scope。

### AD-CCD-6 · 快照生命周期

见 N-4。openTabSet / 内存 Tab 存活保留 unreverted blob；删会话清目录；字节预算 LRU：已 reverted 优先，再最旧 session；索引元数据保留至会话删除。

### AD-CCD-7 · 禁止改 agent-loop / 写盘模型

实现主落 `apps/vscode-dsh`；AC-3b 允许改 `packages/bundle/ide`（配置面）。撤销是本 Feature 扩展事后写盘的唯一产品路径。

### AD-CCD-8 · 排除规则

工作区外、二进制、默认 1 MiB 文本阈值、gitignore 思路构建/生成目录 → 静默不入账。

### AD-CCD-9 · Diff 渲染安全

转义、不执行脚本、不加载外链（AC-23）。

### AD-CCD-10 · 撤销写盘面 + 批量倒序

打开中 → 文档层；关闭 → `workspace.fs`。新建撤销确认删除；删除撤销先冲突检查；AC-17 用 N-3。

**同 path 跨 turn 批量（Must）**：

1. `change/revert-many` 对同 path 多记录 **按 turn 倒序**执行。  
2. 只选较早 turn 且存在较晚 unreverted → 先提示「存在后续变更」类确认（非仅「用户改过」文案）。  
3. 单文件 `change/revert` 同规则。

### AD-CCD-11 · 代码引用 = 官方 `@路径` 指针（正文注入 VOID）

**决策**：选区预填与手输 `@路径` 进入权威 user 消息的内容 **仅**为指针文本（+ 可选自然语言行范围与用户提问）。Host `composer/send` **禁止**读取文件并拼接正文；权威日志与模型请求中的 user 内容 **不得**含引用文件字节。

**证据（repo-exploration）**：`composer/send` 仅 `{ text }`；SDK `contentBlocks` 无 file 块；官方 Web `@file` = 路径字符串 + 模型 `read`；ide **未**挂载 `file-reference-local`（本设计由 AD-CCD-13 补齐）。

**与 VOID 旧案对比**：旧方案 A 为「保证模型立刻看到内容」强制内联；R3.1a 明确对齐 Web 契约，用 **可测 read 契约（AC-3a）** 替代内联保证。

**多 root**：相对路径优先 active editor 所属 folder；否则按 folders 顺序匹配；零匹配或歧义 → reject-send，**禁止**静默猜错。

**发送前门禁可拒绝的 reason（仅此三类）**：`not-found` / `outside-workspace` / `ambiguous-root`。  
**禁止**把 `unreadable` 设计成解析器返回态：扩展发送前 **不得**打开文件读内容做权限探测；`stat` 权限位跨平台不可靠。模型侧 `read` 失败由会话自然汇报。

**`@` token 边界（Must，对齐 `dsh-file-reference/grammar`）**：

| 形式 | 规则 | 预填义务 |
|------|------|----------|
| 无空格路径 | `@` + 连续非空白，止于空白或行尾 | `@src/foo.ts` |
| 含空格路径 | 官方引号形式 `@"path with spaces"`（`formatFileMention`） | 选区预填 **必须** 使用引号形式，**禁止** 写出 `@src/my file.ts 的 3-40 行`（否则门禁无法切分 path 与自然语言） |
| 自然语言后缀 | 紧接合法 `@` token 之后的空白与中文/数字描述（如 `的 3-40 行`）**不属于** path | 提取引用集合时只取 grammar 认定的 token；后缀保留在 user 文本中但不参与路径校验 |

门禁提取「有效引用路径集合」时：**复用或镜像** `activeAtToken` / 全句扫描等价规则；带空格路径 **必须**有 L2 夹具。

**替代（拒绝）**：改写 user 正文内联（VOID）；新增 ContentBlock / 文件 attachment（核心未提供）；仅扩展元数据、权威无 `@` 字符串（破坏 Model-visible ⟺ logged 中的指针可回放）。

### AD-CCD-12 · 磁盘即真相：选区引用前自动保存（D-12）

**决策**：`dsh.askAboutSelection`（及右键）在生成预填前：若目标文档 `isDirty` → `save`；**失败 → 必须不**预填/发送引用，并轻量提示手动保存后重试；成功或不脏 → 再预填指针。

**理由**：DSH `read` 读磁盘；不保存则指针指向过时盘面。

**替代**：读 editor buffer 塞进消息 — 违反 D-11 / Out of Scope「dirty buffer 同步」。

### AD-CCD-13 · AC-3b = ide bundle 挂载 `file-reference-local`

**决策**：

1. **产品配置面**：`packages/bundle/ide/cordis.patch.yml` 的 `- insert:` 增加与 web-app 相同的：

   ```yaml
   - id: file-reference-local
     name: '@deepseek-ai/dsh-file-reference-local'
   ```

2. 插件在 agent 有 `read` 时安装：

   `systemPrompt.section({ name: 'context:file-reference', order: FILE_REFERENCE, text: FILE_REFERENCE_PROMPT })`

3. vscode-dsh 不改 spawn 协议即可获得引导；ide `package.json` 须声明对 `dsh-file-reference-local` 的依赖（与其它 bundle 行一致）。

4. **可选兜底（仅当主路径暂时不可用时的 Spike/测试）**：Host 以 `--patch` 叠加仅含该 insert 的临时 YAML——**不得**作为逃避把行合入 ide bundle 的长期方案。

5. **OOS**：Webview `@` 自动补全 UI。Discovery / `fileReferences.list` 可随插件存在，本 Feature **不调用**；phase-1 **必须**记录：挂载该插件前后 Host/ide 进程 idle 的 CPU/内存观测（**不设硬阈值**，写入 implementation.md，用于发现意外后台索引成本）。

6. **前置假设（开工前必查，非 Spike）**：`file-reference-local` 仅在 agent **具备 `read` 工具**时才注册 `context:file-reference`。phase-1 **code-explorer / 开工核对**须确认 ide profile 默认 agent **已注册 `read`（或文档化等价读文件工具）**；若无，AC-3b 挂载会静默不生效——须先补齐工具面或改设计，**不得**假装 section 已装上。

7. **与 AC-3b 时序等价（P2-C）**：需求写「扩展激活后补齐」；实现路径为 bundle **预挂载**。等价关系：扩展激活 → spawn `dsh --profile ide` → 该进程经预挂载 **自带** `FILE_REFERENCE_PROMPT`，故「激活后具备等效引导」成立，**无需**扩展在运行时二次注入 system prompt。

**理由**：复用已验证提示词与 section 名；不碰 agent-loop；满足「扩展激活后 ide 进程具备等效引导」。

**替代（次选）**：自研极薄插件只注册同一 `FILE_REFERENCE_PROMPT`、不建搜索索引——可减启动成本，但分叉文案与维护；本 Feature **优先**官方 local provider。

**禁止**：在 Extension Host 里拼假 system 字符串却不进 DSH 组装；改 `packages/core/agent-loop`。

### AD-CCD-14 · AC-3a = 每 path 至少一次 read（L2 stub 强制）

**决策**：

| 规则 | 内容 |
|------|------|
| 覆盖集合 | 对 user 消息做官方 `@` token 扫描后，经门禁校验的有效引用 path；**按路径维度去重**（同 path 多处 `@` / 多段自然语言行范围 → **一个**待覆盖 path） |
| 时机 | 每个去重后 path 对应 ≥1 次「覆盖该 path」的 read（或等价工具），且全部发生在 **最终回答之前** |
| 顺序 | 多 path **不**约束先后 |
| stub | 测试注入 scripted model：对去重后的 path 集合逐一发 read，再 answer |
| 失败 | 任一去重 path 在最终回答前缺少覆盖性 read → 夹具 **必须**失败 |
| 真模型 | 另记观测；**不得**单独作 Must 证据 |

**「read 覆盖 path」判定契约（Must，P1-1）**：

1. 从会话日志取出最终回答之前的每次读取类工具调用（工具名以 ide 实际为准，默认 `read`；允许 Spike/测试文档化的别名）。
2. 从该次调用的**入参样本**（JSON / 结构化 args / 可恢复 meta）提取「被读取的工作区路径」集合 `R`：
   - **主字段（ide / tool-fs）**：`file_path`（phase-1 P2-A 实测锁定）；
   - **别名（兼容）**：`path` / `file` / `target`（或工具 schema 另文档化的等价字段）；
   - 将该字符串与门禁侧归一化 path（工作区相对优先；绝对则相对化后比较）做 **规范化相等**比较。
3. 某用户引用 path `P` 被覆盖 ⟺ 存在一次调用，其 `R` 中至少一员规范化后等于 `P`。
4. **目录 / glob**：若一次 read 的入参是目录或 glob，**仅当**该入参经同一归一化规则可证明包含 `P`（例如目录前缀匹配且实现方文档化了规则）才算覆盖；否则 **不算**。L2 stub **优先**使用「精确单文件 path」入参，避免模糊覆盖。
5. **禁止**仅凭「出现过任意一次 read」或「工具名匹配但入参无法映射到 P」判通过。

6. **「最终回答」定义（与 N-2 对齐）**：本 AD 的「最终回答」与 N-2 **锚点消息** 同一定义——该顶层 turn 窗口内 **最后一条** `assistant/message`。实现 **不得** 自行选取 turn 内「看起来像最终答复」的中间 assistant 片段作为 `indexOfFinalAssistant` 基准。

7. **phase-1 开工首探（P2-A）**：code-explorer / 开工核对 **必须** 先探测 ide profile 实际装配的 read（或等价）工具 **入参 schema**。若入参 **不存在** 结构化 `file_path` / `path` / `file` / `target`（或文档化等价字段），**必须** 先定义基于该 schema 的路径提取规则并 **回写本 AD**，**不得**假设字段已存在。

**接线建议（实现可微调，须可测）**：

- 优先：vscode-dsh / bundle 测试用既有 LLM stub / recorded provider 模式，在 **不改 agent-loop** 前提下替换 generate 实现；或对 session 事件流做 **协议级回放夹具**。
- 若全进程 stub 成本过高：允许 **Host 侧契约测试** =（1）发送载荷无文件正文 +（2）独立 stub harness 验证「引用集合 → 必须全覆盖 read」的判定函数；但 **至少一条** 路径须穿过真实 session 事件类型以证明日志可断言。

**替代（拒绝）**：单引用抽测冒充多引用；仅检查「出现过任意一次 read」；对同 path 多处 `@` 要求 N 次 read。

### AD-CCD-15 · P2 接受整文件 read

见上文 P2 接受声明。Design / phase-1 **必须**在 README 或实现注释中指向本 AD，避免 implementer 回退到内联「只贴选区」。

## 实现方案

### 文件产出计划（跨 Phase）

**新增（预期）：**

```
apps/vscode-dsh/src/
  code-context/
    selection-ask.ts       # 脏保存 + 指针预填；空选区提示；回放 Tab → live
    at-path.ts             # @路径解析/校验（无读内容）
    selection-meta.ts      # 扩展本地 startLine/endLine 供引用卡打开
  change/
    change-attributor.ts
    change-store.ts
    snapshot-store.ts
    change-ignore.ts
    revert.ts

packages/bundle/ide/cordis.patch.yml   # insert file-reference-local（phase-1）
```

**修改（预期）：**

```
apps/vscode-dsh/src/extension.ts
apps/vscode-dsh/package.json            # 命令/菜单
apps/vscode-dsh/src/chat-panel/*         # 发送门禁、引用卡 UI、change 协议
apps/vscode-dsh/src/conversation-controller.ts
apps/vscode-dsh/src/message-store.ts
packages/bundle/ide/package.json         # 依赖 file-reference-local
```

### 关键流程骨架

**选区提问（无正文）：**

```
askAboutSelection():
  if selection empty → notice; return
  if doc.isDirty:
    ok = await doc.save()
    if !ok → warn("请手动保存后重试"); return
  pointerText = formatOfficialAtPath(relPath) + ` 的 ${start}-${end} 行`
  // formatOfficialAtPath: 无空格 → @path；有空格 → @"path with spaces"（formatFileMention）
  storeSelectionMeta(sessionOrDraft, { path, startLine, endLine })
  ensureLiveTab(); prefill(pointerText)  // 不含 selection text / languageId
```

**发送门禁（指针原样）：**

```
onComposerSend(text):
  refs = extractAtPaths(text)
  for r in refs:
    resolved = resolveInWorkspace(r)
    if !resolved.ok → reject-send(reason); return
  // 禁止 fs.readFile 拼进 text
  promptActive([{ type: 'text', text }])  // 权威 = 指针文本
```

**AC-3a 断言（伪）：**

```
assertEveryRefReadBeforeFinalAnswer(log, text):
  paths = dedupe(normalize(extractAtPaths(text)))  // 同 path 多 @ 合并为一个
  finalIdx = indexOfFinalAssistant(log)
  for (const path of paths) {
    assert exists tool-call whose args cover path (AD-CCD-14) with index < finalIdx
  }
```

**选区预填含空格路径时：** `pointerText` 使用 `formatFileMention` 引号形式，例如 `@"src/my file.ts" 的 3-40 行`。

## Phase DAG 依赖

见 `phase-plan.md`：phase-0 ∥ phase-1；phase-2 ← phase-0；phase-3 ← phase-2。

## 外部依赖

- 既有：`@deepseek-ai/dsh-file-reference` / `dsh-file-reference-local`、ide-bridge、SDK session.event、VS Code FS/TextDocument。
- **无**新网络服务；快照不上云。

## 高风险子系统

| 风险 | 缓解 |
|------|------|
| 真模型不 read | AC-3a stub 锁管线；AC-3b 提示；观测另记 |
| 归属误报 | Spike + AC-9 |
| 快照膨胀 | AD-CCD-6 prune |
| 与 AC-30 双轨 | N-1 / AD-CCD-4 |
| 误回退到内联 | AD-CCD-11 VOID 明示；phase-1 测试断言发送载荷 **无**文件正文 |

## 权衡 / 替代方案

| 议题 | 选用 | 拒绝 |
|------|------|------|
| 上下文进模型 | 指针 + read（AD-CCD-11/13/14） | 正文注入（旧 AD-CCD-11 VOID） |
| FILE_REFERENCE | ide mount file-reference-local | 改 agent-loop；仅 Host 假提示 |
| 归属 | meta.diffs + Spike | 全量 watcher |
| diff 下发 | 列表轻量 + get-diff | 列表内嵌全文 |
| AC-30 N=0 | 隐藏 | 置灰空壳 |
| AC-17 | content hash + isDirty | 仅 mtime |
| 批量撤销 | turn 倒序 | 正序 |
| 行范围 | 自然语言 + 接受整文件 read | `:lines` 文法；内联选区 |

## 验收标准验证方案（Feature 级）

| ID | 类型 | 场景 | 预期 | 优先级 |
|----|------|------|------|:------:|
| VP-A1 | L2/L3 | 脏保存成功/失败；非空/空选区 | 失败无引用；成功仅指针预填 | must |
| VP-A2 | L2 | 合法/非法 @路径；载荷无文件正文 | 合法发送；非法拒发 | must |
| VP-A3 | L2 | stub：单引用无 read→失败；多引用只读其一→失败；全覆盖→通过 | AC-3a | must |
| VP-A4 | L2 | ide 组装 prompt 含 FILE_REFERENCE_PROMPT | AC-3b；无 agent-loop diff | must |
| VP-B1 | L2 | 模拟 diffs → 列表 / N=0 | 字段+说明；无空骨架 | must |
| VP-B2 | L2 | 排除+误报否定 | 不入账 | must |
| VP-C1 | L2/L3 | 文案/审阅/diff/定位 | AC-10…12a | must |
| VP-D1 | L2/L3 | 撤销/批量/冲突/AC-17 | AC-13…18 | must |
| VP-E1 | L2/L3 | 溯源/合并/隔离/回放 | AC-19…22 | must |
| VP-F1 | L2/L3 | XSS；日志无旧文 | AC-23/24 | must |
| VP-G1 | L2 | chat-ready 抽测 | AC-25 | must |

## 附录 A · Spike 实证锁定（phase-0 PASS · 2026-09-09）

> 来源：`phases/phase-0-spike-attribution-snapshot/spike-report.md`（Verdict **PASS**）。  
> 证据命令：`./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts`（7 passed）。

### A.1 归属（已实证）

**主路径确认**：顶层 turn 窗口内 SDK `session.event` → `tool/result` 可恢复 `meta.diffs`（`path` + `newText` + `oldText: string|null`）足以**稳定入账** DSH 写入候选。解析复用 `recoverableDiffsFromMeta` / TimelineStore `narrowDiffs` + `changedFilesForLatestTurn`。

**覆盖边界（宁可漏记，非 FAIL）**：

| 情况 | 入账 |
|------|:----:|
| tool-fs `edit` / 非空 `write` update + 可恢复 hunks | ✅ |
| tool-fs `write` create / identical → `diffs: []` | ❌ |
| `str_replace_editor`（无 presentationMeta） | ❌ |
| bash/pwsh 写盘 | ❌ |
| 用户手动保存 / 格式化（无 meta.diffs） | ❌（必须） |

**禁止**：裸 FileSystemWatcher / 全量 `onDidSave` 入账。

### A.2 受控快照对比（后备，非归因主路径）

归因 **不依赖** 受控快照即可 PASS。若未来要补 create 等漏记，仅允许 **tool/call 边界** 的前后对比，仍禁止任意保存入账。

**Blob 内容规则（phase-2/3 Must）**：`meta.diffs` 常为 `DIFF_CONTEXT=3` **上下文 hunk**，不足以单独作为大文件撤销的 full-file before/after。ChangeAttributor 入账时须另取 **整文件** before/after（工作区读盘 / 工具结果）写入 SnapshotStore；`meta.diffs` 作**信号与路径集合**，不默认等于 blob 载荷。

### A.3 快照存储（已锁定）

| 项 | 值 |
|----|-----|
| **根** | 优先 `ExtensionContext.storageUri.fsPath`；否则 `globalStorageUri.fsPath/<workspaceKey>/` |
| **布局** | `<storageRoot>/changes/<sessionId>/<snapshotRef>.json` |
| **关联键** | `sessionId` · `snapshotRef` · `sourceMessageId` · `turn` |
| **生命周期** | AD-CCD-6 / N-4：openTabSet/unreverted 保留；删会话清 `changes/<sessionId>/`；字节预算 LRU：已 reverted 优先，再最旧 session |
| **预算** | 软上限 **200 MiB**/storage root；单 blob 软上限 **2 MiB** |
| **索引** | ChangeRecord 元数据可放扩展 index；**禁止**快照明文写入权威会话日志或 `workspaceState` 消息体 |
| **日志** | 仅元数据与统计（路径、字节数、prune 计数） |
| **sourceMessageId** | 直播投影为 Host `randomUUID()`；冷回放优先 SDK `message.id`——phase-2 挂靠列表时记录当时所用 id |
## 附录 B · 多 root / 回放 Tab

- **多 root**：见 AD-CCD-11；phase-1 夹具：单 root 合法、找不到拒发、多 root 匹配/歧义拒发。  
- **回放 Tab**：选区提问 **不得**写入只读 Tab；改为激活或新建 **live** Tab 并预填指针。

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| R3.1a-rewrite | 2026-09-09 | 全文（含 AD-CCD-11 注入） | 指针+read；AD-CCD-11…15 重定义；继承 N-1…N-4 / AD-1…10 | HG-2 待确认 | requirements R3.1a |
| HG2-review-P1 | 2026-09-09 | AtPathResolve；AD-CCD-11/13/14 骨架 | P1-1 covering=入参映射；P1-2 去掉 unreadable；P1-3 官方 @ 文法+空格夹具；P2-1 path 去重；P2-2 idle 观测；P2-3 read 工具存在性必查 | HG-2 待确认 | 用户 HG-2 审查 |
| HG2-review-P2 | 2026-09-09 | AD-CCD-13/14 | P2-A read schema 首探回写；P2-B 最终回答≡N-2 锚点；P2-C AC-3b 与 bundle 预挂载时序等价 | HG-2 待确认 | 用户 HG-2 复审 |
| Spike-phase-0 | 2026-09-09 | 附录 A（待实证假设） | A.1–A.3 实证锁定：meta.diffs 归因 PASS；存储路径/预算；hunk≠blob 规则 | phase-0 HG-3 | spike-report.md PASS |
| Phase1-P2A-file_path | 2026-09-09 | AD-CCD-14 入参示例 | 主字段锁定为 tool-fs `file_path`；`path`/`file`/`target` 为 aliases | phase-1 review SHOULD-FIX | review-design.md |

## 建议的下一步

进入 HG-2：确认本设计与 `phase-plan.md` 后，并行启动 `phase-0-spike-attribution-snapshot` 与 `phase-1-code-context`（code-explorer → implementer）。
