# 代码库探索报告 — phase-0-spike-attribution-snapshot

> Spike Gate 焦点：vscode-dsh 能否通过 `tool/result.meta.diffs` **归属** DSH 工作区写入，以及 **SnapshotStore** 应落在何处？探索时 Spike 状态：**NOT RUN**。

## 1. Task Context

Phase 0 必须在任何 phase-2/3 产品变更列表开工前，产出单一 PASS/FAIL 的 `spike-report.md`，回答 AC-S1…AC-S3 / D-10。本报告梳理 **实况** 路径：tool-fs（及兄弟工具）→ 持久化 `tool/result.meta` → SDK `session.event` → `IdeSessionHost` → `TimelineStore` / ReplayHydrator；记录可恢复字段（`path` / `oldText` / `newText`）、误报测试钩子，以及适合 SnapshotStore 的扩展存储面。本报告 **不** 实现归属、ChangeStore 或 UI。代码引用 / `@path` 不在本 Phase（与 `phase-1-code-context` 并行）。

## 2. Repository Overview

- **语言 / 包管理**：TypeScript ESM monorepo（`pnpm`），Cordis 插件组合。
- **IDE 表面**：`apps/vscode-dsh` — Extension Host + Conversation Webview；拉起 `dsh --profile ide`（base + sdk-app + ide-bridge）。Stdout = SDK JSON-RPC；Host 审批走 `DSH_IDE_BRIDGE_SOCK`。
- **ide 写工具**：`packages/bundle/base/cordis.patch.yml` 挂载 `@deepseek-ai/dsh-tool-fs`（`write` / `edit` / `read` / `read_image`）与 `@deepseek-ai/dsh-tool-str-replace-editor`，以及 bash/pwsh。ide patch 仅追加 ide-bridge。
- **持久化分层**：
  - **权威会话日志**：DSH_HOME / session-persistence（运行时 + `session/read-log`）。快照 **禁止** 写入此处（AD-CCD-3 / AC-24）。
  - **扩展索引**：`workspaceState` Memento（`ExtensionIndex`，键 `dsh.conversationIndex`）— 仅元数据，无消息正文 / 文件 blob。
  - **SnapshotStore（规划中）**：扩展本地文件，位于 `globalStorageUri` 或工作区 `storageUri`（design 附录 A.3）— **尚未实现**。

## 3. Most Relevant Areas

| 路径 | 原因 | 来源 |
|------|------|------|
| `packages/fs/tool-fs/src/write.ts` | `presentationMeta` → `meta.diffs`；**创建 / 相同内容覆盖 → `diffs: []`** | 👁 |
| `packages/fs/tool-fs/src/edit.ts` | `presentationMeta` → `computeHunkDiffs(before, after)` | 👁 |
| `packages/fs/tool-fs/src/diff.ts` | `FileDiff` 形状；`DIFF_CONTEXT = 3` 上下文 hunk；`diffsFromMeta` | 👁 |
| `packages/core/tools/src/index.ts` ~1797 | 将 `presentationMeta` 挂到成功 `tool/result.meta`（仅 parent） | 👁 |
| `packages/core/session/src/types.ts` | `tool/result` 事件：`message` + 可选不透明 `meta` | 👁 |
| `packages/sdk/server` + `packages/sdk/client` | 每次 append 流式 `session.event` | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | `client.subscribe()` → `onNotification` 扇出；`readSessionLog` | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `timeline.apply(notification)`；AC-30 `diff-summary`；助手投影 | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` | `narrowDiffs` / `writeDiffsForSession(Tree)` / `changedFilesForLatestTurn` | 👁 |
| `apps/vscode-dsh/src/diff-entry.ts` | 事后 `vscode.diff`，虚拟 `dsh-diff`（两侧均来自日志） | 👁 |
| `apps/vscode-dsh/src/replay-hydrator.ts` | `recoverableDiffsFromMeta`；冷日志 Diff 重建 | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | 既有扩展持久化模式（`workspaceState`） | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.test.diffAvailability` / `changedFileCount`；`ExtensionContextLike` **尚无** `storageUri` | 👁 |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | `FAKE_EMIT_WRITE_DIFF` 注入可恢复 `meta.diffs` | 👁 |
| `apps/vscode-dsh/tests/timeline-diff.integration.spec.ts` | 端到端 notify → TimelineStore diffs | 👁 |
| `apps/vscode-dsh/tests/timeline-projector.spec.ts` / `phase5-should-polish.spec.ts` | turn + diffs 单元注入模式 | 👁 |
| `packages/fs/tool-str-replace-editor/src/index.ts` | Diff 仅在 `presentCall`；**无 `presentationMeta`** → 日志无 `meta.diffs` | 👁 |
| `docs/wiki/VS Code IDE 集成/Timeline 与事后 Diff.md` | 记载 GAP-010 / GAP-011（wiki 对 Diff 两侧可能滞后于代码） | 👁 |
| 先前：`phases/phase-1-code-context/repo-exploration.md` | 仅 composer/prompt 路径 — 对 Spike **背景不变** | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — 实时归属主源（AD-CCD-1 候选）✅ CONFIRMED

```
tool-fs write/edit execute
  → ToolsService createSuccessResult
       presentationMeta(args, value) → meta { diffs: FileDiff[] }
  → session.append('tool/result', { message, meta })
  → SDK server notify('session.event', { sessionId, event })
       │
       ▼
IdeSessionHost.watchTransport → notificationListeners
       │
       ▼
ConversationController.onSdkNotification
  timeline.apply(notification)          # 全部 session.event / status / subagent
  若 assistant/message → projectAssistantMessage + maybeAppendDiffSummary
       │
       ▼
TimelineStore.applySessionEvent('tool/result')
  metaDiffs = narrowDiffs(data.meta)    # path + newText + oldText:string|null
  push TimelineItem { diffs?, filePath?, callId?, toolName? }
       │
       ▼
writeDiffsForSession(Tree) / changedFilesForLatestTurn
  → dsh.reviewWorkspaceDiffs / dsh.test.diffAvailability / AC-30 diff-summary
```

**✅ CONFIRMED 字段契约**（`TimelineDiffHunk` / `FileDiff` / `recoverableDiffsFromMeta`）：

| 字段 | 可恢复必需 | 说明 |
|------|:----------:|------|
| `path` | 是 | 非空 string |
| `newText` | 是 | string（可为 `''`） |
| `oldText` | 是 | `string` **或** `null`；**缺键 → 拒绝**（绝不强转成 `''`） |

vscode-dsh 当前不消费其它 meta 键。

### Path B — 冷回放（同一 meta 契约）✅ CONFIRMED

```
Host bridge session/read-log
  → ReplayHydrator.foldTimeline / recoverableDiffsFromMeta(data.meta)
  → TimelineStore.replace(sessionId, items)
```

### Path C — 无真实工具的 L2 注入（Spike / AC-S3 夹具）✅ CONFIRMED

```
Fake IdeSessionHost.onNotification 或直接 TimelineStore.apply
  session.event tool/result { meta: { diffs: [...] } }
  （加 turn/start … turn/end 以界定最新 turn 窗口）
```

已有夹具：

- 环境变量：`FAKE_EMIT_TURN_EVENTS` + `FAKE_EMIT_WRITE_DIFF`（`fake-sdk-runtime.mjs`）
- 单元：`phase5-should-polish.spec.ts` 构造 `HarnessNotification` 并 `notify?.(event(...))`
- 探针：`dsh.test.diffAvailability`、`dsh.test.changedFileCount`

### Path D — **不会**产生日志 `meta.diffs` 的路径 ✅ CONFIRMED / ⚠️ 覆盖空洞

```
str_replace_editor  → 仅 presentCall diffs；无 presentationMeta → tool/result.meta 缺失
bash / pwsh 写入    → 无 diffs meta（宁可漏记下的预期遗漏）
write CREATE        → presentationMeta 返回 { diffs: [] }  # GAP-010
write 相同内容      → { diffs: [] }
FileSystemWatcher / onDidSave → 未接线；归属严禁使用（AD-CCD-1）
```

## 5. Likely Impact Surface

| 区域 | Spike / 后续改动 | 风险 |
|------|------------------|------|
| `apps/vscode-dsh/tests/` 下新探测（归属 + 存储 dry-run） | **新增**（优先 Spike 证据） | 低 |
| 可选薄辅助（如 `attribution-candidates.ts`）— 仅 Spike，非产品 UI | 如 AC-S3 需要可 **新增** | 低 |
| `ExtensionContextLike` + activate | **扩展** `globalStorageUri` / `storageUri` 供 SnapshotStore dry-run | 中（测试需假 URI） |
| `TimelineStore` / `diff-entry` / AC-30 | Spike **只读复用**；产品 ChangeAttributor 日后可 **另建收集逻辑**（turn 窗口 + 合并）— **勿**把 Timeline Diff UI 当成 ChangeStore | 中（若 Spike 改动产品语义） |
| `packages/core/agent-loop` | **禁止**（AD-CCD-7） | — |
| 权威会话日志 / ExtensionIndex Memento | **禁止**存快照明文 | 高（若违反） |
| `tool-fs` presentationMeta | 非 Spike 产品范围；可作为覆盖 FAIL 原因或后续债 **引用** | 高（create 路径覆盖） |

## 6. Existing Constraints / Conventions

- **AD-CCD-1**：仅在顶层 turn 窗口内从 `tool/result` 可恢复 `meta.diffs`（或 Spike 书面等价事件）入账。禁止裸 watcher / 全量保存入账。
- **AD-CCD-3 / AC-24**：快照与审阅状态仅扩展本地；日志仅元数据/统计。
- **AD-CCD-5**：同 turn 同 path → 合并首次 `oldText` + 末次 `newText`（产品 phase-2；Spike 须注明 hunk vs 整文件）。
- **AD-CCD-6 / N-4**：索引 vs blob 生命周期；openTabSet / 未撤销保留；删会话清目录；字节预算 LRU。
- **AD-CCD-7**：主落 `apps/vscode-dsh`（AC-3b 才动 ide bundle）。
- **Store 约定**：偏好纯 store（TimelineStore / MessageStore）+ Host 接线；L2 走 `dsh.test.*`。
- **可恢复 Diff（AD-CU-6）**：`oldText` 必须为 `string|null`；纯 patch 拒绝。
- **仅事后 Diff**：`DEFAULT_POST_HOC_DIFF_ONLY = true`；执行中逐步确认不在范围。
- **ExtensionIndex**：立即写 `workspaceState`；按 workspace 键控；永不存聊天正文 — 适合 **索引** 元数据，不适合多 MiB blob。
- **测试**：优先 `apps/vscode-dsh/tests/` 无密钥 vitest；复用 fake SDK runtime；Spike Gate 须在 `spike-report.md` 写可复跑命令。

## 7. Risks / Unknowns

| 项 | 确认度 | 说明 |
|----|:------:|------|
| meta 含可恢复 hunk 时，session.event → TimelineStore.diffs 通路成立 | ✅ CONFIRMED | 集成 + 单元夹具 |
| `narrowDiffs` / `recoverableDiffsFromMeta` 字段规则 | ✅ CONFIRMED | 缺 `oldText` 即拒绝 |
| write **create** 日志 `meta.diffs: []` → Timeline **无** Diff | ✅ CONFIRMED | tool-fs 测试 + wiki GAP-010 |
| edit/write **更新** 的 meta 是 **上下文 hunk**（`DIFF_CONTEXT=3`），未必是整文件前后像 | ✅ CONFIRMED | `diff.ts`；小文件可能看起来像整文件；大文件 → 局部片段 |
| str_replace_editor 从不挂 result `meta.diffs` | ✅ CONFIRMED | 无 `presentationMeta` |
| bash/shell 工作区写入对 Diff 归属不可见 | ✅ CONFIRMED | 无 diffs meta |
| 若 Spike **仅**用非空可恢复 meta.diffs 归属，用户保存无法误报 | ✅ CONFIRMED | 今日无 FS watcher；AC-S3 主要是「不要加 watcher」+ 注入 vs 非注入对照 |
| 上下文 hunk 是否足以作为 SnapshotStore 撤销前镜像 | ⚠️ HYPOTHESIS | Design 假定完整 old/new；tool-fs meta 常为 **hunk 局部**。Spike 必须实测，可能需 tool/call 边界受控整文件快照（附录 A.2）→ 可能导致 Gate FAIL 或修订 design |
| 无带 diffs meta 的专用 `delete` 工具 | ✅ CONFIRMED | 删除多经 edit 清空 / bash → 宁可漏记下易遗漏 |
| 实时助手 `ChatMessage.id` 为 `randomUUID()`，非 SDK `message.id`；回放 hydrator 优先 SDK id | ✅ CONFIRMED | live/replay 的 sourceMessageId 稳定性是 phase-2 风险；Spike 应记录首选键（`turn` + 投影 id vs SDK id） |
| blob 根：`context.storageUri`（工作区）vs `globalStorageUri` | ⚠️ HYPOTHESIS | 代码尚未使用；A.3 两者皆可。建议 `storageUri/changes/<sessionId>/` 或 global + 与 ExtensionIndex 同构的 `workspaceKey` — Spike 须 dry-run 写/读/删且不触达会话日志 |
| Wiki 称 Diff 右侧优先工作区文件 | ❌ Speculation / 过时 | 当前 `diff-entry.ts` **两侧**均为日志驱动的 `dsh-diff` 虚拟文档 |
| 字节预算 / prune 数值 | ❓ UNKNOWN | Design 只写 LRU 策略；无代码常量 — Spike 须提出具体上限 |

## 8. Uncertain / Unverified

- **真实 API** write→session.event→扩展 全路径（此处仅验证 fake/runtime 与单元路径）。Spike Gate 至少要 L2 注入；缺密钥时真实 e2e 可选。
- 本 Extension Host 默认 `dshHome` 下会话日志精确落盘布局（勿把 Spike blob 写进去 — dry-run 须证明路径隔离）。
- ide profile 实战是否更常走 `str_replace_editor` 而非 `write`/`edit`（覆盖空洞量级）。
- 多 root 下归属键的路径规范化（phase-1 管 `@path` 多 root；Spike 应记录 tool-fs `displayPath` 打出的绝对/相对形态）。
- Subagent 子会话 `session.event` diffs：TimelineStore 树经 `writeDiffsForSessionTree` 可收集；N-2 要求并入父顶层 turn — Spike 应确认 Gate 文案用树收集还是仅顶层。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 活跃债务为空 | N/A | ✅ 无已注册桩需校验 |

### Stub Detection Summary

- ✅ 与 registry 匹配的已确认桩：**0**
- ⚠️ Registry 不一致：**0**
- 🔴 未注册桩：**0**（vscode-dsh 归属/快照代码尚未开工 — 无 `ChangeAttributor` / `SnapshotStore` / `ChangeStore` 符号）

### 相关已知缺口（chat-ready / wiki — 不在本工作流 registry）

| ID | 位置 | 行为 | 与 Spike 关系 |
|----|------|------|----------------|
| GAP-010 | tool-fs write create / 相同内容 → `diffs: []`；Timeline **无** call-args 回退 | 创建写入对 Diff/归属静默 | 必须写入 AC-S1 覆盖 / FAIL 或债务 |
| GAP-011 | 相对路径 Diff UX（wiki） | 历史问题；代码现两侧虚拟 | 对 Spike Gate 低 |

勿将 Timeline 对 create 空静默当作「桩」— 这是 tool-fs presentationMeta 故意行为 + vscode 缺少回退。

## 10. Recommended Next Reads

1. ⭐ **必读** — `apps/vscode-dsh/src/timeline-store.ts`（`narrowDiffs`、`changedFilesForLatestTurn`、`writeDiffsForSessionTree`）
2. ⭐ **必读** — `packages/fs/tool-fs/src/write.ts` + `edit.ts` + `diff.ts`（真正进入 `meta.diffs` 的内容）
3. ⭐ **必读** — `apps/vscode-dsh/src/replay-hydrator.ts`（`recoverableDiffsFromMeta`）
4. ⭐ **必读** — `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` + `tests/timeline-diff.integration.spec.ts` + `tests/phase5-should-polish.spec.ts`（AC-S1/S3 注入/探针模式）
5. ⭐ **必读** — `design.md` 附录 A + AD-CCD-1 / AD-CCD-6 / N-4；`phases/.../spec.md` AC-S*
6. 🔷 **应读** — `apps/vscode-dsh/src/diff-entry.ts`（可复用 Diff 打开；**勿**当 ChangeStore）
7. 🔷 **应读** — `apps/vscode-dsh/src/extension-index.ts` + `extension.ts` 的 `ExtensionContextLike` / `dsh.test.diffAvailability`
8. 🔷 **应读** — `packages/fs/tool-str-replace-editor/src/index.ts`（覆盖空洞）
9. 🔹 **可选** — `docs/wiki/VS Code IDE 集成/Timeline 与事后 Diff.md`；chat-ready phase-5 探索报告

---

## Spike implementer 清单（推导）

### AC-S1 — meta.diffs 能否稳定识别 DSH 写入？

**至少测量：**

1. 注入可恢复 `meta.diffs` → 候选 / Timeline hunk 非空（PASS 路径）。
2. write-create 风格 `{ diffs: [] }` → **不**入账，除非 Spike 书面允许回退（call-args 合成）— 今日 Timeline 会漏（GAP-010）。
3. 明确写清：归属信号对带有效 meta 的 **edit / 非空更新 write** 存在；**并非**覆盖所有 DSH 磁盘变更（bash、str_replace_editor、create）。
4. 若 SnapshotStore 撤销需要整文件前后像：证明 meta hunk 是否够用，或必须走 A.2 受控快照 → 可能驱动 FAIL 或 design 修订（不可静默 PASS）。

### AC-S2 — 快照存储

- 扩展 / 伪造带 `storageUri` 和/或 `globalStorageUri` 的 `ExtensionContext`。
- Dry-run：在 `…/changes/<sessionId>/<snapshotRef>` 写 blob → 读 → 删。
- 索引键：`sessionId` + `snapshotRef`；对照 openTabSet / 删会话 / 字节 LRU 写清生命周期（提出具体数字）。
- 断言路径 ≠ 会话日志 / ExtensionIndex Memento 正文；日志仅元数据。

### AC-S3 — 误报否定

- 候选集 **A**：注入路径 `P` 的可恢复 diffs 之后。
- 候选集 **B**：对路径 `Q` 模拟用户保存/格式化且 **无** meta.diffs（且不增加 watcher）之后。
- 断言 `Q ∉` 归属集合；报告写明确切测试命令。
- 若归属靠 FileSystemWatcher 实现，**不得**宣称 PASS。

### 复用 vs 避免

| 复用 | 避免 / 勿当作产品 ChangeStore |
|------|-------------------------------|
| `TimelineStore.apply` / `narrowDiffs` / `recoverableDiffsFromMeta` 作 **信号解析** | 把 Timeline TreeView / `diff-summary` 当变更列表 |
| `dsh.test.*` + fake SDK 注入模式 | 把快照写入会话日志或 `workspaceState` 正文 |
| `diff-entry` 仅作可选 Diff 打开冒烟 | `FileSystemWatcher` / `onDidSave` 归属 |
| ExtensionIndex 生命周期思路（清会话） | 改动 `agent-loop` |

### `spike-report.md` 须闭合的缺口

1. 覆盖矩阵：工具 × 操作 × meta.diffs 形态 × 是否入账？
2. SnapshotStore 的 hunk vs 整文件决策。
3. 选定的存储根路径 + prune 常量。
4. sourceMessageId 键控说明（live UUID vs SDK id）— 即便产品在 phase-2。
5. 明确 PASS 或 FAIL；FAIL 时仅阻断 phase-2/3。
)
