# 代码库探索报告 — phase-6-session-search

## 1. 任务上下文

Phase 6 交付**会话搜索档 1 + 档 2**（AC-50–53 / AD-CUX-9 / X7 / 宪法 §7.3）：档 1 基于既有 ExtensionIndex 的 `title` + `firstUserPreview`（字段已 READY）；档 2 新建从变更元数据派生的 **path→session** 反查索引（不建第二正文库）；打开命中须复用 `openFromHistory` / 激活已有 Tab，**禁止**因此 auto-Start；档 3 / 静默扫 JSONL 正文明确不做。Phase Entry：无继承 🔴 债；本 feature 末 Phase。

## 2. 仓库概览

| 项 | 现状 |
|------|---------|
| 包 | `apps/vscode-dsh` — VS Code 扩展（TypeScript / vitest） |
| 索引 | `ExtensionIndex` → workspaceState 键 `dsh.conversationIndex`（仅元数据） |
| 变更 | `src/change/*` — 按 session 的 `ChangeStore` + 持久化 `change-index.ts`（`…/<sessionId>/index.json`） |
| 历史 UI | TreeView `dsh.history` + 命令 `dsh.openHistory` |
| 搜索模块 | **不存在** — `apps/vscode-dsh/src/search/` 目录缺失 |
| code2prompt | 本环境未安装；本次用定向 Grep/Read |

相关高层结构：

```
apps/vscode-dsh/src/
  extension-index.ts          # SessionIndexEntry title / firstUserPreview
  history-view.ts             # 列表 + TreeView → openHistory
  conversation-controller.ts  # openFromHistory / upsertSession / 变更持久化
  extension.ts                # 含 dsh.openHistory 等命令
  change/{change-store,change-index,types}.ts
  chat-panel/protocol.ts      # 尚无 action/search-sessions
  search/                     # ❌ 缺失（设计目标路径）
```

## 3. 最相关区域

| 路径 | 职责 | 来源 |
|------|------|:------:|
| `apps/vscode-dsh/src/extension-index.ts` | `SessionIndexEntry`、`upsertSession`、`listHistorySessions`、资格过滤 | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | 首条消息写 title/preview；`openFromHistory`；`persistChangeIndex` / `deleteSession` | 👁 |
| `apps/vscode-dsh/src/history-view.ts` | History TreeView → `dsh.openHistory` | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.openHistory` QuickPick + 打开路径；auto-start 矩阵 | 👁 |
| `apps/vscode-dsh/src/change/change-store.ts` | 按 session 存记录；仅有 `listByPath(sessionId, path)` | 👁 |
| `apps/vscode-dsh/src/change/change-index.ts` | 每 session 持久化变更元数据 | 👁 |
| `apps/vscode-dsh/src/change/types.ts` | `ChangeRecord.path` + `sessionId` | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Webview actions — **无** `action/search-sessions` | 👁 |
| `apps/vscode-dsh/package.json` | 贡献命令 — **无** 搜索命令 | 👁 |
| `apps/vscode-dsh/README.md` | Auto-start 矩阵：Query/browse ≠ Start | 👁 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | AC-1c：离线 openHistory 不 Start | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | 历史列表 / openHistory / 冷索引 | 👁 |
| `.specdev/.../design.md` AD-CUX-9 | 目标 `path-session-index.ts` + `action/search-sessions` | 👁 |
| `.specdev/.../exploration-findings.md` X7 | 档1 READY / 档2 NEED_INDEX | 👁 |

## 4. 关键入口 / 调用路径

### 路径 A — 档 1 索引字段（READY；缺查询 API）

```
用户首条 prompt
  → ConversationController.promptTab()
  → titleFromFirstMessage(text) / preview(80)
  → ExtensionIndex.upsertSession({ title, firstUserPreview, mtime, … })
  → workspaceState 持久化（不含消息正文）

今日列表/浏览：
  → ExtensionIndex.listHistorySessions()
  → history-view / dsh.openHistory QuickPick（label=title）
  ✗ 无 searchSessions(query) 按 title|firstUserPreview 过滤
```

### 路径 B — 变更元数据（档 2 来源；缺反查索引）

```
归属 / 审阅 / 撤销
  → ChangeStore.upsert(record)   # 按 sessionId
  → ConversationController.persistChangeIndex(sessionId)
  → writeChangeIndex(storageRoot, sessionId, records)
      → …/snapshots/<sessionId>/index.json

今日查询：
  → ChangeStore.listByPath(sessionId, path)  # 仅单 session 内
  ✗ 无工作区 path → sessionIds 反查表
  ✗ apps/vscode-dsh/src/search/path-session-index.ts 缺失
```

### 路径 C — 从结果打开（AC-52 复用；不 auto Start）

```
dsh.openHistory(sessionId?) | History TreeItem.command
  → ConversationController.openFromHistory(sessionId)
       ├─ 已有同 sessionId Tab → switchConversation（激活）
       └─ 否则读权威日志 hydrate → registry.create(..., 'replay')
  → 不调用 IdeSessionHost.start / auto-start 编排器
  （README Query/browse 类；AC-1c 测试确认离线 openHistory ≠ Start）
```

## 5. 可能影响面

| 区域 | 预期改动 | 风险 |
|------|-----------------|:----:|
| **新建** `src/search/path-session-index.ts`（+ 持久化） | 档 2 PathSessionIndexEntry { path, sessionIds, mtime } | 🟠 高 — 新持久化面 |
| **新建** 档 1 查询（过滤 title\|preview） | AC-50；禁止读 JSONL / MessageStore 正文 | 🟡 中 |
| 在 `persistChangeIndex` + `deleteSession` / `markDeleted` 维护索引 | path→session 与变更/删除同步 | 🟠 高 |
| `extension.ts` + `package.json` | 如 `dsh.searchSessions` 或 QuickPick；保持 Query/browse（不 Start） | 🟡 中 |
| 可选 `protocol.ts` 的 `action/search-sessions` + Host | design.md W→H；也可仅命令面板 | 🟡 中 |
| `history-view` / 面板 chrome | 独立搜索 UI vs 扩展 History — 产品选择 | 🟢 低–中 |
| 层 B 测试 | AC-50 无正文扫描 spy；AC-51 path 命中；AC-52 不 Start；AC-53 无档 3 API | 🟡 中 |
| `message-store` / `replay-hydrator` / agent-loop | **禁止**当作搜索后端 | 🔴 避免 |

## 6. 既有约束 / 惯例

1. **ExtensionIndex 永不存消息正文**（`extension-index.ts` 头注释 + AC-45/46）— 档 1 只能查元数据字段。
2. **Change index 仅元数据**（`change-index.ts`）；blob 在 SnapshotStore — 不得把快照明文当「搜索」。
3. **ChangeStore 按 session 分桶** — `listByPath(sessionId, path)` 不是工作区反查（X7 NEED_INDEX）。
4. **openFromHistory** 激活或打开 **replay**；Continue/重试/编辑/分叉是后续显式用户动作（AC-52）。
5. **Auto-start 矩阵**（README）：Query/browse 不得 Start；`dsh.openHistory` 已正确归类 — 新搜索打开须同属此类。
6. **宪法 §7.3**：无档 3 / 第二正文库；不静默扫 JSONL 正文。
7. **AD-CUX-9**：打开走历史/回放/已有 Tab，不 Start。
8. **Fork 变更桶**：设计规定 fork 不拷贝父 Change index — path-session 维护不得给 child 虚构父路径。
9. **Duck-typed vscode** + `VSCODE_DSH_TEST` L2 hooks — 沿用现有命令/测试模式。
10. **调度者角色**：产品代码由 implementer 写；不碰 agent-loop。

## 7. 风险 / 未知

| 项 | 确认度 | 说明 |
|------|:----------:|-------|
| 档 1 字段 `title` / `firstUserPreview` 存在且首条 prompt 写入 | ✅ CONFIRMED | 已读 `SessionIndexEntry` + `promptTab` upsert |
| `listHistorySessions` 返回上述字段但无子串搜索 API | ✅ CONFIRMED | 已读完整方法体 |
| 工作区 path→session 反查索引不存在 | ✅ CONFIRMED | 无 `src/search/`；ChangeStore 按 session |
| 每 session 的 change `index.json` 是档 2 派生源 | ✅ CONFIRMED | `writeChangeIndex` / `readChangeIndex` |
| `openFromHistory` 激活已有 Tab 或开 replay；该路径不 Start | ✅ CONFIRMED | 方法体 + AC-1c + README 矩阵 |
| `action/search-sessions` 尚未进协议 | ✅ CONFIRMED | `protocol.ts` action 联合类型 |
| 搜索 UI 用 Webview 还是仅命令面板 | ⚠️ HYPOTHESIS | 设计两者皆可；spec 写「搜索 UI 或命令面板」 |
| path-session 持久化位置（workspaceState vs 扩展存储文件） | ⚠️ HYPOTHESIS | 设计有类型，无存储路径 |
| 冷启动：扫全部 session `index.json` 一次 vs 仅增量 | ⚠️ HYPOTHESIS | X7「新建或扫全 index」；优先持久化反查表 |
| 查询路径规范化（相对路径、大小写、符号链接） | ❓ UNKNOWN | 须与 ChangeRecord.path 写入方对齐 |
| 删除/tombstone 的 session 是否立即从 path 索引剔除 | ⚠️ HYPOTHESIS | Spec：删除时更新；已有 `markDeleted` |

## 8. 未核实 / 勿假设

| 符号 | 状态 | 下游指引 |
|--------|--------|-------------------------|
| 未来的 `searchSessions` / `queryByPath` | 不存在 | 勿假设已有；本 Phase 实现 |
| `PathSessionIndexEntry` | 仅 design.md 类型 | 非已编译代码 |
| 遍历全部 `changeIndexPath` 做全库重建 | 未实现 | 若作迁移，仅扫**元数据** — 勿为「搜索」打开 JSONL 权威日志 |
| Webview 搜索 chrome DOM | 不存在 | 仅当 UI 落在可抽离 render 模块时才做层 A |
| `ChangeStore.listByPath` 跨 session | 不适用 — API 绑定单 session | 勿误用冒充 AC-51 |

## 9. 桩检测与 Registry 交叉校验

**Registry**：`.specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md` — **活跃债务为空**（仅 `—` 占位）。Phase Entry：无 🔴 继承。

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| —（活跃空） | — | 无活跃项 | N/A | ✅ 匹配 |
| GAP-CUX-002 | （已解决） | phase-5 已关闭 | 未作为桩复审 | ✅ 已关闭 |
| DEBT-CUX-001 | （已解决） | phase-4 已关闭 | 本 Phase 无关 | ✅ 已关闭 |
| GAP-CUX-001 | （已解决） | phase-3 已关闭 | 本 Phase 无关 | ✅ 已关闭 |

### 产品缺口（非 registry 桩 — 模块缺失）

| 缺口 | 证据 | AC |
|-----|----------|:--:|
| 无档 1 查询 API | 仅有 `listHistorySessions` / QuickPick 浏览 | AC-50 |
| 无 `path-session-index` 模块 | `src/search/` 缺失；设计路径不存在 | AC-51 |
| 无搜索命令 / `action/search-sessions` | `package.json` + `protocol.ts` | AC-50/51 UI |
| 无档 3 API（正确） | 无全文 / JSONL 扫描搜索面 | AC-53 ✅ |

### 桩检测摘要

- ✅ 已确认桩：**0**（与 registry 匹配；活跃表空）
- ⚠️ Registry 不一致：**0**
- 🔴 未注册桩：**0**（缺模块记为 **GAP**，非空壳函数桩）
- 📌 implementer 若故意延期须注册 `@STUB`；否则应完整交付查询 + path 索引 + 打开接线。

**否定检查（AC-53）：** Grep 未发现会话搜索全文 / JSONL 正文扫描产品路径。`message-store` 标明仅投影（非第二权威库）。禁止为通过 AC-50 而增加正文扫描「搜索」。

## 10. 建议优先阅读

1. ⭐ **必读** — `apps/vscode-dsh/src/extension-index.ts`（SessionIndexEntry + listHistorySessions）
2. ⭐ **必读** — `apps/vscode-dsh/src/conversation-controller.ts`（`openFromHistory`、`promptTab` upsert、`persistChangeIndex`、`deleteSession`）
3. ⭐ **必读** — `apps/vscode-dsh/src/change/change-index.ts` + `change-store.ts` + `types.ts`（`ChangeRecord.path`）
4. ⭐ **必读** — Phase `spec.md` AC-50–53 + `design.md` AD-CUX-9 + PathSessionIndexEntry + 文件规划 `src/search/path-session-index.ts`
5. 🔷 **宜读** — `apps/vscode-dsh/src/extension.ts`（`dsh.openHistory`）+ `history-view.ts` + README auto-start 矩阵
6. 🔷 **宜读** — `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`（AC-1c）+ `phase2-multitab-history-replay.spec.ts`
7. 🔷 **宜读** — `apps/vscode-dsh/src/chat-panel/protocol.ts`（仅当选 Webview 入口时再加 `action/search-sessions`）
8. 🔹 **可选** — `exploration-findings.md` X7；宪法 §7.3；phase-5 review 中搜索正确未越界的记录

---

### 关键缺口（implementer 清单）

| # | 缺口 | 现状 | 需要 |
|---|-----|---------|--------|
| G1 | 档 1 查询 | 字段 READY；仅列表/浏览 | 按 `title` + `firstUserPreview` 过滤/搜索；层 B 证明命中来自索引字段 |
| G2 | 档 2 反查索引 | 仅有 per-session change index | `path-session-index` 模块 + 持久化；在变更写入/删除时维护 |
| G3 | 搜索入口 | 无命令 / 无 `action/search-sessions` | UI 或命令面板入口 |
| G4 | 打开路径 | `openFromHistory` 已就绪 | 结果接线 → openHistory/激活；断言无 auto Start |
| G5 | 档 3 | 不存在（正确） | 保持不存在；不扫 JSONL 正文 |

*探索日期：2026-09-11。模式：per-Phase（phase-6-session-search）。本 Phase 目录此前无 repo-exploration.md（首次写入）。*
