# 代码库探索报告 — phase-2-change-list-display

> 本 Phase：消息附属变更列表 + 安全按需 diff + AC-30 共存。  
> Spike Gate（`phase-0-spike-attribution-snapshot`）= **PASS**（2026-09-09）。  
> Phase Entry Gate：用户选择 **(a)** 在本 Phase 优先处理 GAP-CCD-010 / GAP-CCD-011 / DEBT-CCD-001。  
> 已在分支 `impl-phase-2-change-list-display` 上对照 live 代码复核（2026-09-10）；非 phase-0 探索的盲抄。

## 1. 任务上下文

Phase 2 交付**消息附属变更感知与展示**：在顶层 turn 内仅凭可恢复的 `tool/result.meta.diffs` 归属入账（AD-CCD-1）；排除二进制 / 超大 / 生成目录 / 工作区外路径（AD-CCD-8）；同 path 合并为最终前后文（AD-CCD-5）；将**整文件**快照写入扩展本地 SnapshotStore（附录 A.3 + DEBT-CCD-001）；在该 turn **最后一条**助手消息下投影 `change-list`（N-2；N=0 = 一句无变更说明、禁止空骨架）；经 `change/get-diff` → `change/diff-content` 按需取正文（AC-12）；单击打开定位（AC-12a）；双向溯源与执行隔离（AC-19/21）；XSS 安全渲染（AC-23）；并将 AC-30 `diff-summary` 点击改为 **reveal 消息下 change-list**（N-1 / AD-CCD-4），而非仅打开 Timeline/`reviewWorkspaceDiffs`。范围外：撤销写盘 / 完整「标记已审阅」（phase-3）、改 agent-loop、代码引用指针面（phase-1 已完成）。

## 2. 仓库概览

| 层 | 位置 | 对本 Phase 的作用 |
|----|------|-------------------|
| Extension Host + Webview | `apps/vscode-dsh/` | 主实现落点（AD-CCD-7） |
| 写盘工具 | `packages/fs/tool-fs`、`tool-str-replace-editor` | 产出 / 省略 `presentationMeta.diffs` |
| Tools 核心 | `packages/core/tools/src/index.ts` | 将 `presentationMeta` 挂到父级 `tool/result.meta` |
| SDK 流 | `packages/sdk/*` + `session-host.ts` | `session.event` 扇出到 Timeline / Conversation |
| 权威日志 | DSH session JSONL | **禁止**写入快照明文（AD-CCD-3 / AC-24） |
| 扩展索引 | `extension-index.ts` / `workspaceState` | 仅元数据模式；非 blob 存储 |
| SnapshotStore | **尚未产品化** | 仅测试 dry-run；phase-2 负责正式模块 |

- **语言**：TypeScript ESM monorepo（`pnpm`）；L2 夹具在 `apps/vscode-dsh/tests/`。
- **缺失产品模块**：`apps/vscode-dsh/src/change/` **尚不存在**（spec 预期产出）。
- **Git 分支**：`impl-phase-2-change-list-display`（已确认）。

## 3. 最相关区域

| 路径 | 原因 | 来源 |
|------|------|------|
| `apps/vscode-dsh/src/timeline-store.ts` | Live `narrowDiffs` + turn 窗口 `changedFilesForLatestTurn` — 归属信号源 | 👁 已复核 |
| `apps/vscode-dsh/src/replay-hydrator.ts` | `recoverableDiffsFromMeta`（同契约；冷路径） | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `onSdkNotification` → 助手投影 + `maybeAppendDiffSummary`（AC-30）；N-2 锚点挂钩 | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage.kind` — 需增补 `'change-list'` | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Host↔Webview 帧 — 尚无 `change/*` | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 气泡渲染；`diff-summary` 点击 → `open-workspace-diffs`；escapeHtml / 安全 markdown | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 路由 `action/open-workspace-diffs` → Timeline Diff | 👁 |
| `apps/vscode-dsh/src/diff-entry.ts` | 事后 `vscode.diff` 来自**日志 hunk**（Timeline 路径；AC-30 主路径应弱化） | 👁 |
| `apps/vscode-dsh/src/markdown/safe-markdown.ts` | 文本气泡 XSS 基线（diff 面板可复用模式） | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.reviewWorkspaceDiffs`；`ExtensionContextLike` **当前无** `storageUri`/`globalStorageUri` | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | 扩展持久元数据模式（`workspaceState`） | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | `client.subscribe()` → `onNotification` | 👁 |
| `apps/vscode-dsh/tests/spike-attribution-helpers.ts` | 锁定的 SnapshotStore 常量 + 归属辅助（应提升，勿另起炉灶） | 👁 |
| `apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts` | Spike Gate 证据（7 passed） | 👁 |
| `apps/vscode-dsh/tests/phase5-should-polish.spec.ts` | AC-30 L2：N>0 注入 diff-summary；N=0 不伪造 | 👁 |
| `packages/fs/tool-fs/src/write.ts` | **GAP-CCD-010**：create / identical → `diffs: []` | 👁 |
| `packages/fs/tool-fs/src/edit.ts` | 经 `presentationMeta` 产出可恢复 hunks | 👁 |
| `packages/fs/tool-fs/src/diff.ts` | **DEBT-CCD-001**：`DIFF_CONTEXT = 3` 上下文 hunk | 👁 |
| `packages/fs/tool-str-replace-editor/src/index.ts` | **GAP-CCD-011**：仅 `presentCall` diffs；**无** `presentationMeta` | 👁 |
| `packages/core/tools/src/index.ts` ~1797 | 将 `presentationMeta` → result `meta`（仅 parent） | 👁 |
| Spec：`design.md` AD-CCD-1…10、N-1/N-2、附录 A；`spike-report.md` | 契约真相源 | 👁 |
| Spec：`tech-debt-registry.md` | 本 Phase 继承 GAP/DEBT | 👁 |

## 4. 关键入口 / 调用路径

### 路径 A — 归属入账（直播）✅ 已确认

```
tool-fs write/edit execute
  → ToolsService createSuccessResult
       presentationMeta(args, value) → meta.diffs[]
  → session.append tool/result { message, meta }
  → SDK notify session.event
       │
       ▼
IdeSessionHost.onNotification
       │
       ▼
ConversationController.onSdkNotification
  timeline.apply(notification)          # 全部 session.event
  if type === assistant/message:
    projectAssistantMessage(randomUUID())  # 今日 N-2 锚点 id = Host UUID
    maybeAppendDiffSummary(N from Timeline)
       │
       ▼
TimelineStore.applySessionEvent('tool/result')
  metaDiffs = narrowDiffs(data.meta)     # path + newText + oldText:string|null
  push TimelineItem { diffs? }
       │
       ▼
[phase-2 新建] ChangeAttributor
  window = 最近顶层 turn/start…（同 changedFilesForLatestTurn）
  candidates = 可恢复 meta.diffs ∩ IgnoreRules
  同 path 合并 → 首次 oldText + 末次 newText（AD-CCD-5）
  另取整文件 before/after → SnapshotStore（DEBT-CCD-001）
  ChangeStore.upsert ChangeRecord { sourceMessageId = 最后一条 assistant id }
```

**✅ 已确认可恢复契约**（`narrowDiffs` / `recoverableDiffsFromMeta` 一致）：

| 字段 | 必填 | 拒绝条件 |
|------|:----:|----------|
| `path` | 是 | 缺失 / 空 |
| `newText` | 是 | 非 string |
| `oldText` | 是 | 缺 key（必须是 `string` **或** `null`） |

### 路径 B — 消息附属展示 + AC-30 共存 ✅ 当前已确认 / ⚠️ 目标为假设落地

**当前（chat-ready）：**

```
assistant/message 投影
  → maybeAppendDiffSummary：N>0 则追加 kind:'diff-summary'
  → Webview 按钮点击 → action/open-workspace-diffs
  → ChatPanelHost → dsh.reviewWorkspaceDiffs
  → TimelineStore.writeDiffsForSessionTree → vscode.diff（diff-entry）
```

**Phase-2 目标（设计）：**

```
turn 定稿（优先 turn/end 或 idle）  # N-2
  → 在最后一条 assistant 下追加 kind:'change-list'（N=0 则 emptyNotice）
  → 仅当 N>0 保留/注入 kind:'diff-summary'
       点击 → reveal change-list（滚动+展开），不得仅开 Timeline
  → 展开行 → change/get-diff → Host 读 SnapshotStore → change/diff-content
  → change/open → 打开文件 + 有行则 revealLine
  → change/reveal-source → 滚到 sourceMessageId 气泡
```

### 路径 C — SnapshotStore 布局（Spike 锁定）✅ 契约已确认 / ❌ 无产品代码

```
storageRoot = context.storageUri.fsPath
             || globalStorageUri.fsPath/<workspaceKey>/
blob = <storageRoot>/changes/<sessionId>/<snapshotRef>.json
keys = sessionId · snapshotRef · sourceMessageId · turn
budget = 根软上限 200 MiB；单 blob 软上限 2 MiB
prune = 先 reverted，再最旧 session 目录
权威会话日志 / workspaceState 消息体 = 永不存快照明文
```

证据：`spike-attribution-helpers.ts` 中 `SNAPSHOT_STORE_SPIKE` + `dryRunSnapshotStore`。产品 `snapshot-store.ts` 仍不存在。

### 路径 D — 冷回放（同一 meta 信号）✅ 已确认

```
session/read-log → ReplayHydrator.recoverableDiffsFromMeta
  → TimelineStore.replace
  → [phase-2] 从扩展存储重归属或水合 ChangeStore 索引
```

**注意（附录 A.3）：** 直播 `sourceMessageId` = Host `randomUUID()`；冷回放优先 SDK `message.id`。Phase-2 挂靠列表时必须记录当时所用 id。

## 5. 可能影响面

| 区域 | 变更类型 | 风险 | 说明 |
|------|----------|:----:|------|
| **新建** `apps/vscode-dsh/src/change/*.ts` | Attributor / ChangeStore / SnapshotStore / IgnoreRules | 🔴 高 | Spec 预期落点；今日为空 |
| `conversation-controller.ts` | tool/result 上接线归属 + turn 定稿推 change-list；改 AC-30 跳转 | 🔴 高 | 中心投影；N-2 时机 vs 多 assistant |
| `message-store.ts` | 增加 `kind: 'change-list'`（及可选载荷字段） | 🟡 中 | 类型与拷贝语义 |
| `chat-panel/protocol.ts` | 增加 `change/get-diff`、`change/diff-content`、`change/open`、`change/reveal-source`（revert 可桩） | 🔴 高 | 收窄未知 postMessage |
| `chat-panel-provider.ts` | 渲染 change-list / 空说明；安全 diff 展开；改 diff-summary 跳转 | 🔴 高 | XSS（AC-23）；今日无 `data-message-id` |
| `chat-panel-host.ts` | 路由 change/* | 🟡 中 | 镜像 open-workspace-diffs 模式 |
| `extension.ts` | 在 context like 上暴露 storageUri；L2 测试钩子 | 🟡 中 | `ExtensionContextLike` 现缺存储 URI |
| `diff-entry.ts` / Timeline Diff | 保留为次路径；AC-30 主路径改为 reveal 列表 | 🟢 低 | 勿删；弱化为主 UX |
| `tool-fs` / `tool-str-replace-editor` | 可选关闭 GAP-010/011 | 🟡 中 | 用户选 (a) — 需产品决策漏记 vs 补全 |
| phase-3 撤销 UI | 不得实现写盘；若暴露按钮 → `@STUB(phase-3-…)` + 登记 | 🟢 若省略则低 | Spec 允许仅列表 |

## 6. 既有约束 / 约定

1. **AD-CCD-1 / AC-9**：归属**仅**来自顶层 turn 内可恢复 `meta.diffs`。**禁止**裸 `FileSystemWatcher` / 全量保存入账。✅ `apps/vscode-dsh/src` 今日无此类 watcher。
2. **AD-CCD-7**：不改 agent-loop / 写盘模型；实现主落 vscode-dsh（关闭 GAP 时可改工具 presentationMeta）。
3. **AD-CCD-3 / AC-24**：快照明文仅在扩展本地 `changes/`；不得进权威 JSONL / `workspaceState` 消息体。
4. **AD-CU-6 可恢复规则**：缺 `oldText` key → 拒绝（永不强制成 `''`）。`oldText: null` = Timeline Diff 的创建语义。
5. **MessageStore**：仅投影，非第二权威库。Change **索引**可用 Memento/文件；blob 只在 `changes/`。
6. **Webview 安全**：助手文本用 `renderSafeMarkdown` / `escapeHtml`；`diff-summary` 用 `textContent`。Diff 面板须默认转义、不执行脚本、不加载外链（AC-23 / AD-CCD-9）。
7. **AC-30 现有行为**：`maybeAppendDiffSummary` 已在 N=0 跳过（✅）。点击现开 Timeline Diff（❌ 相对 AD-CCD-4）— 必须改跳转。
8. **N-2 锚点**：列表挂靠 turn 内**最后一条** assistant；定稿优先 `turn/end` / idle。今日每个有文本的 assistant 投影在 N>0 时都可能再追加 `diff-summary` — phase-2 须避免重复列表 / 错锚点。
9. **排除（AD-CCD-8）**：工作区外、二进制、默认 **1 MiB** 文本、gitignore 思路构建/生成目录 — **尚无共享 IgnoreRules 模块**；phase-2 须新增（code-context `at-path` 只覆盖路径存在/多 root）。
10. **测试**：优先 L2 注入 TimelineStore / fake SDK notify（见 `phase5-should-polish.spec.ts`、spike helpers）。L4 不得作唯一证据。

## 7. 风险 / 未知项

| 项 | 确信度 | 细节 |
|----|:------:|------|
| 可恢复 meta.diffs 足以支撑 edit / 非空 write update | ✅ 已确认 | Spike PASS + live 解析器 |
| Create / identical write → 空 diffs（GAP-010） | ✅ 已确认 | `write.ts` presentationMeta |
| str_replace_editor 从不写 meta.diffs（GAP-011） | ✅ 已确认 | 包内无 `presentationMeta` |
| meta.diffs 为 DIFF_CONTEXT=3 hunk，非整文件（DEBT-001） | ✅ 已确认 | `diff.ts` + 附录 A.2 |
| 产品 Change* 模块缺失 | ✅ 已确认 | 无 `src/change/` |
| `ExtensionContextLike` 缺 storageUri | ✅ 已确认 | SnapshotStore 根路径须扩展类型 |
| Webview 气泡无稳定 `data-message-id` / provider JS 无 scroll/reveal 处理 | ✅ 已确认 | AC-19 reveal 需新 DOM + Host→Webview 处理 |
| 何时**定稿** change-list（每个 assistant vs turn/end） | ⚠️ 假设 | 设计偏好 turn/end/idle；live AC-30 按 assistant 文本触发 |
| 入账时整文件 before：读工作区 vs 工具 `value.before` | ⚠️ 假设 | 设计允许任一；write/edit 结果有 before/after，但 **不在** meta hunk 上 |
| 本 Phase 修 GAP-010/011 还是文档化宁可漏记 | ⚠️ 假设 | 用户选优先 (a)；产品取舍仍开放 |
| 子代理树 diffs 并入父顶层 turn 的 ChangeStore | ⚠️ 假设 | Timeline 有 session tree；N-2 要求并入父顶层 turn |
| 无 blob 时回放 Tab 的 change-list 水合 | ❓ 未知 | 索引级路径+统计为 Must；prune 后完整 diff 可为说明态 |

## 8. 未核实 / 不可假设

下游**不得**假设下列项已为 Phase 2 可用，除非自行阅读/实现：

| 符号 | 状态 | 注意 |
|------|------|------|
| 产品 `ChangeAttributor` / `ChangeStore` / `SnapshotStore` | ❌ 不存在 | Spike helpers 仅为测试 dry-run |
| 将 `TimelineStore.collectDiffs` 当作 AD-CCD-5 合并 | ⚠️ 语义不符 | 按 `path+newText` 去重；**不会**保留「首次 old / 末次 new」单条 |
| 将 `diff-entry.reviewWorkspaceDiffs` 当作 change-list diff UI | ⚠️ 表面错误 | 用 **hunk** 文本开 `vscode.diff`；AC-12 要 Webview 按需从 SnapshotStore 取正文 |
| 直播用 SDK `message.id` 作 `sourceMessageId` | ❌ 未使用 | `projectAssistantMessage` 始终 `randomUUID()` |
| Webview `scroll/reveal` Host 帧 | ⚠️ 部分 | Host 可 post；provider 脚本**尚未**处理 |
| `panel/state` 携带 change-list 载荷 | ❌ 无 | 设计提及；协议今日无字段 |
| 二进制 / 1 MiB / 生成目录的 IgnoreRules | ❌ 无 | 须按 AD-CCD-8 新建 |
| 受控快照对比补 create 覆盖 | Spike 可选 | 仅当产品选择关闭 GAP-010 且仍禁止 watcher |

## 9. 桩检测与 Registry 交叉校验

### Phase Entry Gate 继承项（用户选择 **a** — 优先处理）

| ID | Live 代码核查 | 是否匹配？ | Implementer 处理选项 |
|----|---------------|:----------:|----------------------|
| **GAP-CCD-010** | `packages/fs/tool-fs/src/write.ts` `presentationMeta`：`value.before === null ? [] : computeHunkDiffs(...)`；identical → 空 hunks | ✅ 匹配 | **(1)** 宁可漏记（ChangeAttributor + 测试断言 create 不入账）。**(2)** 在 write create 的 tool/call 边界做受控前后快照（仍禁 watcher）。**(3)** 扩展 presentationMeta 发合成 create diff（`oldText: null` + 完整 `newText`）— 改 tool-fs。 |
| **GAP-CCD-011** | `tool-str-replace-editor/src/index.ts`：diffs 仅在 `presentCall`；**grep `presentationMeta` = 0** | ✅ 匹配 | **(1)** 文档化永久漏记 + 类 AC-9 测试。**(2)** 增加 `output.presentationMeta` 镜像 presentCall diffs（进日志）。除非产品强制覆盖 editor 工具，优先 (1)。 |
| **DEBT-CCD-001** | `tool-fs/src/diff.ts` `DIFF_CONTEXT = 3`；spike-report + 设计 A.2 要求整文件 blob | ✅ 匹配 | 入账时 **必须** 将整文件 before/after 写入 SnapshotStore（工作区读盘和/或工具结果 `before`/`after`）；`meta.diffs` 仅作**信号与路径集合**。禁止把仅 hunk 当作可撤销 blob。 |

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| GAP-CCD-010 | `tool-fs/.../write.ts:presentationMeta` | create/identical → 空 diffs | 确认空数组路径 | ✅ 匹配 |
| GAP-CCD-011 | `tool-str-replace-editor/.../index.ts` | 无 presentationMeta | 确认缺失 | ✅ 匹配 |
| DEBT-CCD-001 | 设计附录 A.2 / SnapshotStore | hunk ≠ 整文件 blob | DIFF_CONTEXT=3 确认；产品 store 缺失 | ✅ 匹配（债仍活跃） |
| — | `apps/vscode-dsh/src/change/*` | — | 模块缺失（预期） | ℹ️ 非桩 — 绿地 |
| — | `change/revert*` UI | — | N/A | 若过早暴露 → 必须 `@STUB(phase-3-review-revert-replay)` |

### 桩检测摘要

- ✅ 与 registry 匹配的已确认缺口/债：**3**（GAP-010、GAP-011、DEBT-001）
- ⚠️ Registry 不一致：**0**
- 🔴 Phase-2 主路径未注册桩：**0**（未发现假 ChangeStore 空壳）
- ℹ️ 绿地：整个 `src/change/` + 协议 `change/*` 帧

### 建议给 implementer 的债务策略（对齐用户 **a**）

1. **DEBT-CCD-001** — 尽管 registry 标 🟡，对正确 SnapshotStore 设计视为**实质必须**：归属第一天即捕获整文件。
2. **GAP-CCD-010 / 011** — 默认产品立场仍是**宁可漏记**，除非明确做工具侧 presentationMeta / 受控快照；无论如何用 L2 测试固化所选覆盖矩阵（同行 spike 覆盖表）。
3. **禁止**用 FileSystemWatcher「补」漏记。

## 10. 建议下游优先阅读

1. ⭐ **必读** — `design.md`（ChangeRecord / ChangeListPayload、AD-CCD-1…9、N-1/N-2、附录 A）
2. ⭐ **必读** — `phases/phase-0-spike-attribution-snapshot/spike-report.md` + `apps/vscode-dsh/tests/spike-attribution-helpers.ts`
3. ⭐ **必读** — `apps/vscode-dsh/src/timeline-store.ts`（`narrowDiffs`、`changedFilesForLatestTurn`）
4. ⭐ **必读** — `apps/vscode-dsh/src/conversation-controller.ts`（`projectAssistantMessage`、`maybeAppendDiffSummary`、`onSdkNotification`）
5. ⭐ **必读** — `apps/vscode-dsh/src/message-store.ts` + `chat-panel/protocol.ts` + `chat-panel-provider.ts`（diff-summary 渲染/点击）
6. 🔷 **应读** — `packages/fs/tool-fs/src/write.ts` / `edit.ts` / `diff.ts`（GAP-010 + DEBT-001）
7. 🔷 **应读** — `packages/fs/tool-str-replace-editor/src/index.ts`（GAP-011）
8. 🔷 **应读** — `apps/vscode-dsh/tests/phase5-should-polish.spec.ts`（可扩展的 AC-30 夹具）
9. 🔷 **应读** — `apps/vscode-dsh/src/markdown/safe-markdown.ts`（AC-23 模式）
10. 🔹 **可选** — `diff-entry.ts`、`replay-hydrator.ts`、phase-0 `repo-exploration.md`（仅背景）
11. 🔹 **可选** — `extension-index.ts`（ChangeRecord 元数据的 Memento 模式参考）

---

**下游一句话：** 从 Timeline/`meta.diffs` 接到 ChangeAttributor → 整文件 SnapshotStore（`changes/<sessionId>/`）→ MessageStore `change-list` + 协议 `change/get-diff`；把 AC-30 从 Timeline Diff 改成 reveal 该列表；将 GAP-010/011 固化为明确的漏记或补全决策；归属路径永不监听工作区。
