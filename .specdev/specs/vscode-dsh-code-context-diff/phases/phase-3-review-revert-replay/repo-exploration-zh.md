# 代码库探索报告 — phase-3-review-revert-replay

> 本 Phase：标记已审阅、单文件/批量撤销（冲突 + AC-17）、回放路径与统计（AC-22）、日志安全（AC-24）、chat-ready 回归（AC-25）。  
> 在分支 `impl-phase-3-review-revert-replay` 上实读验证（2026-09-10）。  
> Phase Entry Gate：活跃债务表为空；前序 GAP/DEBT 已在 phase-1/2 关闭。  
> 以 phase-2 探索为背景；下文标注 **unchanged** vs **updated for Phase 3**。

## 1. Task Context

Phase 3 在 phase-2 变更列表数据面（归因 → `ChangeStore` + 整文件 `SnapshotStore` + 消息挂靠 `change-list` UI）之上交付：**标记已审阅**且不对工作区写盘（AC-11）；经 VS Code 文档层 / `workspace.fs` 的**单文件与批量撤销**，含新建删除确认、删除恢复冲突、后续 turn 确认、N-3 content-hash 脏门禁（AC-13…18、AD-CCD-10）；撤销后再经 DSH 写入产生**新 ChangeRecord**（AC-16）；历史回放至少展示路径与统计、blob prune 后不伪造正文（AC-22 / N-4）；快照明文不进扩展日志（AC-24）；以及 chat-ready Must 回归（AC-25）。Out of Scope：写盘前审批、Git 驱动撤销、中间版本恢复、改 agent-loop、代码引用新需求。

## 2. Repository Overview

| 层级 | 位置 | 对本 Phase 的作用 |
|------|------|-------------------|
| Extension Host + Webview | `apps/vscode-dsh/` | 主实现面（AD-CCD-7） |
| Change 域（phase-2 已交付） | `apps/vscode-dsh/src/change/` | 类型、ChangeStore、SnapshotStore、ChangeAttributor、ignore — **尚无 `revert.ts`** |
| Chat panel | `apps/vscode-dsh/src/chat-panel/*` | 协议 + Host 路由 + Webview 行（仅 open / get-diff / reveal-source） |
| Conversation | `apps/vscode-dsh/src/conversation-controller.ts` | 直播 settle → change-list；历史 hydrate **不**重建 ChangeStore |
| 确认 UX | `apps/vscode-dsh/src/interaction-ui.ts` | `showWarningMessage` 确认模式（撤销门禁可复用） |
| 脏文档模式 | `apps/vscode-dsh/src/code-context/selection-ask.ts` | `isDirty` + `save()`（AC-17 与 hash OR） |
| chat-ready 回归入口 | `tests/chat-ready-regression.spec.ts` + `test-scripts/run-chat-ready-regression.sh` | AC-25 |
| 权威日志 | DSH session JSONL | 禁止快照明文（AC-24 / AD-CCD-3） |

- **语言**：TypeScript ESM monorepo（`pnpm`）；vitest L2 在 `apps/vscode-dsh/tests/`。
- **Git 分支**：`impl-phase-3-review-revert-replay`（已确认）。
- **缺失模块**：`apps/vscode-dsh/src/change/revert.ts` **不存在**（本 Phase 预期产出）。

## 3. Most Relevant Areas

| 路径 | 原因 | 来源 | 相对 phase-2 |
|------|------|------|--------------|
| `change/types.ts` | `ChangeStatus` 已含 `reviewed`/`reverted`；`afterContentHash` 供 AC-17 | 👁 | 类型面不变 |
| `change/change-store.ts` | 内存索引；按 `(sessionId, turn, path)` upsert；**无持久化 / 跨 turn 按 path 查询助手** | 👁 | **本 Phase 强调** status + AC-22 |
| `change/snapshot-store.ts` | read/write/clearSession/prune；`hashTextContent`；注释写明 reverted-first 属 **phase-3** | 👁 | **更新** — 恢复源 + prune 策略 |
| `change/change-attributor.ts` | `status: 'unreviewed'`、写入 `afterContentHash`；settle 总是新 `changeId` | 👁 | 入账不变；AC-16 依赖新 turn |
| `change/revert.ts` | **预期新建** | 👁 | **缺失** |
| `chat-panel/protocol.ts` | 有 get-diff/open/reveal-source；**无** mark-reviewed/revert/revert-many | 👁 | **挂载点** |
| `chat-panel/chat-panel-host.ts` | 现有 change 路由与 deps 钩子模式 | 👁 | 同模式扩展 |
| `chat-panel/chat-panel-provider.ts` | 行 UI：打开 + Diff + 来源；状态仅特殊处理 `unreviewed`→`未查看` | 👁 | 加审阅/撤销/批量 |
| `extension.ts` | Diff/Open/Reveal 接线；`VsCodeLike.workspace` **缺** `fs`/textDocuments/applyEdit | 👁 | **必须扩 duck type** |
| `conversation-controller.ts` | settle 投影；`openFromHistory`/restore **省略** ChangeStore 与 change-list | 👁 | **AC-22 关键缺口** |
| `replay-hydrator.ts` | 权威折叠 → 文本+时间线；**无** `kind:'change-list'` | 👁 | **更新** |
| `interaction-ui.ts` / `selection-ask.ts` | 确认框 / 脏保存模式 | 👁 | 门禁复用 |
| `tests/phase2-change-list-display.spec.ts` | phase-2 L2 / Host fake | 👁 | 回归基线 |
| `tests/chat-ready-regression.spec.ts` | AC-25 入口 | 👁 | 回归 |
| `design.md` N-3/N-4、AD-CCD-3/6/10、A.3 | 契约真相 | 👁 | — |
| `tech-debt-registry.md` | 活跃表空 | 👁 | Entry Gate 通过 |

## 4. Key Entry Points / Call Paths

### 路径 A — 标记已审阅（目标；未实现）⚠️ 挂载点假设 ✅ 缺失已确认

```
Webview change-list 行
  → post { type: 'change/mark-reviewed', changeId }
       │
       ▼
ChatPanelHost.handleMessage（新分支）
  → deps.requestMarkReviewed(changeId)
       │
       ▼
extension / ConversationController
  → ChangeStore.upsert({ ...record, status: 'reviewed' })
  → 刷新该 turn 的 MessageStore change-list
  → pushFullState / 局部更新
  → 禁止任何工作区写盘 / SnapshotStore.write
```

**挂载点（✅ 已确认）：**
- `protocol.ts` 的 Webview→Host 联合类型与 `parseWebviewToHostMessage`。
- `ChatPanelHost` 入站 switch（约 L476，紧挨 `change/get-diff`）。
- `chat-panel-provider.ts` 行操作区（约 L638–707）。
- 状态文案：现仅 `unreviewed`→`未查看`，需补 `reviewed`/`reverted` 产品文案。

### 路径 B — 单文件/批量撤销 + 冲突门禁（目标）⚠️

```
Webview
  → change/revert { changeId }  或  change/revert-many { changeIds[] }
       │
       ▼
Host → extension 确认门禁（interaction-ui 风格）：
  1. kind=created → 确认删除（AC-14）
  2. kind=deleted → 同名已存在 → 冲突确认（AC-15）
  3. 同 path 存在更高 turn 且 unreverted → 「后续变更」确认（AD-CCD-10）
  4. AC-17：hash(当前)≠afterContentHash 或 打开文档 isDirty → 「将丢失后续改动」
  任一取消 → 不写盘，状态不变
       │
       ▼
revert.ts（新建）— AD-CCD-10 写盘面：
  文档已打开 → TextDocument / WorkspaceEdit
  否则 → workspace.fs write/delete/create
  恢复图：SnapshotStore.read(...).oldText
       │
       ▼
成功 → status=reverted；失败 → 报错且状态不变（AC-13）
批量 → 逐文件 success/fail（AC-18）
同 path 多项 → 按 turn 倒序执行（AD-CCD-10）
```

**快照恢复（✅ API 已确认）：**
- `SnapshotStore.read(sessionId, snapshotRef)` → `{ oldText, newText, path }` 或 prune/缺失时 `undefined`。
- `modified`/`deleted` 依赖 `oldText`；`created` 撤销为删文件（oldText 曾为 `null`）。
- 无 `snapshotRef` 或 read 失败 → 失败，禁止伪造内容。

**AC-17（✅ 原语齐，⚠️ 未接线）：**
- `hashTextContent` + settle 写入的 `afterContentHash`。
- 盘面文本：复用 `wireChangePipeline` 的 `readWorkspaceText`。
- 缓冲脏：`selection-ask` 的 `isDirty`；当前 `VsCodeLike` **无** `textDocuments`，需扩展。

### 路径 C — 回放/冷启动路径+统计（AC-22）— 缺口 ✅

**现状（变更列表回放断裂）：**

```
openFromHistory / restoreOpenTabs
  → readSessionLog
  → hydrateFromAuthoritativeLog  # 仅 text + timeline
  → 不加载 ChangeStore
  → 不产生 kind:'change-list'
```

**本 Phase 目标（A.3 + N-4）：**

```
在扩展存储持久化 ChangeRecord 元数据索引（禁止进权威日志）
打开历史/恢复时：
  载入索引 → ChangeStore
  按 sourceMessageId 注入 change-list（Must：路径+统计）
  get-diff：SnapshotStore.read → available；false 给 reason，不伪造正文
pruneToBudget：优先删已 reverted session，再最旧 session
```

### 路径 D — 直播归因（phase-2）— unchanged ✅

```
tool/call → before-cache
tool/result meta.diffs → ingest
assistant/message | turn/end → settleChangeListProjection
  → SnapshotStore.write + ChangeStore.upsert(unreviewed)
  → MessageStore change-list（+ N>0 时 diff-summary）
```

## 5. Likely Impact Surface

| 区域 | 变更类型 | 风险 | 说明 |
|------|----------|:----:|------|
| `change/revert.ts`（新） | 新增 | 🔴 高 | 写盘正确性；新建/删除/冲突；不动 agent-loop |
| `change/change-store.ts` | 扩展 | 🟡 中 | status 更新；跨 turn 按 path；可选持久索引 |
| `change/snapshot-store.ts` | prune 策略 | 🟡 中 | reverted-first |
| chat-panel protocol/host/provider | 协议+UI | 🟡 中 | mark-reviewed / revert(+many) |
| `extension.ts` | duck type + 接线 | 🔴 高 | fs/docs/edits + 确认框 |
| `conversation-controller.ts` | hydrate + 删除清理 | 🔴 高 | AC-22；删会话应清 ChangeStore+SnapshotStore（**现状未清**） |
| `replay-hydrator.ts` | 可能不动 | 🟢 低 | 优先扩展本地索引注入，勿塞权威日志 |
| phase-2 / chat-ready 测试 | 回归 | 🟡 中 | 保持 AC-6…12a/19/30 |
| agent-loop / tool-fs | **禁止改** | — | AD-CCD-7 |

## 6. Existing Constraints / Conventions

1. **AD-CCD-7**：实现落在 `apps/vscode-dsh`；不改 agent-loop。撤销是本 Feature 唯一产品写回路径。
2. **AD-CCD-3 / AC-24**：快照与审阅状态仅扩展本地；权威 JSONL / `workspaceState` 消息体禁旧/新明文。A.3 允许扩展存储中的**元数据**索引。
3. **AD-CCD-10**：打开中→文档层；关闭→`workspace.fs`。同 path 批量 **turn 倒序**。后续 unreverted 确认文案 ≠ AC-17「用户改过」。
4. **N-3 / AC-17**：SHA-256 vs `afterContentHash`，或 `isDirty` — **禁止仅 mtime**。
5. **N-4 / AC-22**：回放 Must 索引元数据；prune 后「完整 diff 不可用」（phase-2 get-diff 已用该 reason）。
6. **AD-CCD-5**：同 turn 同 path settle 合并；upsert 键 `(turn, path)` — 撤销后**新 turn** 产生新记录（AC-16）。
7. **协议**：一律经 `protocol.ts` + Host deps（对齐 get-diff/open）。
8. **确认 UX**：`interaction-ui` / `showWarningMessage`；取消=不写盘。
9. **AC-10**：状态文案保持中性（无「待审批」）。
10. **Duck-typed vscode**：新 FS API 须对 L2 可选安全。

## 7. Risks / Unknowns

| 项 | 确认度 | 说明 |
|----|:------:|------|
| 无 revert.ts / 无 mark-reviewed·revert 协议 | ✅ CONFIRMED | glob + grep；UI 无按钮 |
| ChangeStore 仅内存；回放无 change-list | ✅ CONFIRMED | `openFromHistory` + hydrator |
| `deleteConversation` 未清 ChangeStore/SnapshotStore | ✅ CONFIRMED | 相对 AD-CCD-6 的生命周期洞 |
| `pruneToBudget` 仅最旧 session | ✅ CONFIRMED | 注释标明 phase-3 |
| `VsCodeLike` 缺 fs/textDocuments/applyEdit | ✅ CONFIRMED | extension.ts |
| AC-24：当前无 OutputChannel 打 blob | ✅ CONFIRMED | 实现撤销诊断时仍禁明文 |
| ChangeRecord 索引文件名/布局 | ⚠️ HYPOTHESIS | A.3「可放扩展 index」；phase-2 仅 blob `*.json` |
| 回放注入按 sourceMessageId vs turn | ⚠️ HYPOTHESIS | 直播 Host UUID vs 冷日志 SDK id（A.3）可能不完全对齐 |
| 批量 UI：勾选 vs 全部 | ❓ UNKNOWN | 规格允许两者 |
| 脏缓冲是否先 save 再比 hash | ❓ UNKNOWN | N-3 为 isDirty OR hash |

## 8. Uncertain / Unverified

| 符号 | 已存在 | 未核验 |
|------|--------|--------|
| 产品路径上的 `workspace.fs.*` | 未写入 VsCodeLike | 真机 vscode 有；L2 需 stub |
| `WorkspaceEdit` / `applyEdit` | 本扩展未用 | 打开文档优先文档层 — 行为未测 |
| 跨 turn「后续 unreverted」扫描 | 无助手 | 需 list + path/status/turn 过滤 |
| ChangeRecord 持久格式 | 无 | 不得把 blob 放进 workspaceState |
| 每次 mark-reviewed 全量 pushFullState | 有 push | 是否需更轻量补丁 — 未证 |
| AC-25 全矩阵实测 | 脚本在盘 | 本次探索未重跑 |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| *(活跃表空)* | — | — | — | ✅ 无活跃债 |
| GAP-CCD-010 | tool-fs create/identical | 已解决 | Attributor 仍忽略空 diffs | ✅ 匹配 |
| GAP-CCD-011 | str_replace_editor | 已解决 | 无 presentationMeta 入账 | ✅ 匹配 |
| DEBT-CCD-001 | 整文件 blob vs hunk | 已解决 | 有 before-cache 时写整文件 | ✅ 匹配 |
| GAP-CCD-012/013、DEBT-CCD-002 | phase-1 | 已解决 | 非本 Phase | ✅ 匹配 |
| — | `change/revert.ts` | 未注册 | **文件缺失**（计划交付，非桩） | ⚪ 预期缺口 |
| — | `change/mark-reviewed` 协议 | 未注册 | 缺失（本 Phase 范围） | ⚪ 预期缺口 |
| — | 删会话 → SnapshotStore.clearSession | 未注册 | **未清理** vs AD-CCD-6 | 🟡 候选 GAP（生命周期洞，非空函数桩） |

### Stub Detection Summary

- ✅ 与 registry 匹配的确认桩：**0**（活跃表空）。
- ⚠️ Registry 不一致：**0**。
- 🔴 未注册空壳桩：`src/change/` 产品路径 **0**。
- ⚪ 本 Phase 预期缺失（非桩）：`revert.ts`、审阅/撤销协议与 UI、持久 ChangeRecord 索引、reverted-first prune、删会话清快照。

## 10. Recommended Next Reads

1. ⭐ **必读** — `change/snapshot-store.ts`（`read` / `hashTextContent` / `pruneToBudget`）
2. ⭐ **必读** — `change/change-store.ts` + `types.ts`
3. ⭐ **必读** — `chat-panel/protocol.ts` + `chat-panel-host.ts`
4. ⭐ **必读** — `chat-panel-provider.ts` change-list 行（约 617–710）
5. ⭐ **必读** — `extension.ts` 中 Diff/Open、`VsCodeLike`、`wireChangePipeline`
6. ⭐ **必读** — `conversation-controller.ts` settle / `openFromHistory` / `deleteConversation`
7. 🔷 **应读** — `design.md` N-3/N-4、AD-CCD-6/10、附录 A.3
8. 🔷 **应读** — `interaction-ui.ts`、`selection-ask.ts`
9. 🔷 **应读** — `tests/phase2-change-list-display.spec.ts`
10. 🔹 **可选** — chat-ready 回归脚本（AC-25）
11. 🔹 **可选** — phase-2 `implementation.md`（勿重做归因）

### Phase-2 已交付 vs Phase-3 缺口

| 已交付（phase-2） | 仍缺（phase-3） |
|-------------------|-----------------|
| 归因 + ChangeStore + SnapshotStore blob | `revert.ts` 写回 |
| 消息 change-list + get-diff/open/reveal-source | mark-reviewed + revert(+many) 协议/UI |
| `afterContentHash` 已填充 | AC-17 用 hash + isDirty 门禁 |
| 状态类型含 reviewed/reverted | 状态迁移与文案 |
| get-diff prune → unavailable | AC-22 冷启动/回放索引 hydrate + 路径统计气泡 |
| prune 最旧 session | reverted-first；删会话清理 |
| AC-24 消息体/权威侧（phase-2 已验） | 新增撤销诊断日志仍仅元数据 |
