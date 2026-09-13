# Connectivity Review — phase-0-spike-attribution-snapshot

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: 归因信号 — `meta.diffs` → TimelineStore → Spike 候选集
```
Entry: HarnessNotification session.event
       turn/start + tool/result { meta.diffs: [{ path, oldText, newText }] }
  → TimelineStore.apply(notification)                 ✅ 测试直接注入（L2，spec 允许）
    → applySessionEvent('tool/result')
      → narrowDiffs(data.meta)                        ✅ 生产契约 path+newText+oldText:string|null
      → TimelineItem.diffs 入账
  → attributionPathsForLatestTurn(store, sessionId)
    → store.changedFilesForLatestTurn(sessionId)      ✅ 同 AC-30 回合窗口
Exit: string[] 归因路径（可恢复 hunk 非空 → 入账；diffs:[] / patch-only → 空）
```
**判定**: ✅ 数据路径完整。并行直连：`attributionCandidatesFromMeta` → `recoverableDiffsFromMeta`（replay-hydrator）与 live `narrowDiffs` 字段契约一致。

### Path 2: 探测脚本 ↔ Gate 报告可复跑命令
```
Entry: spike-report.md 引用命令
  → ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts
  → AC-S3: … -t "user manual save"
  → 实现文件: spike-attribution-snapshot.spec.ts + spike-attribution-helpers.ts
  → design.md 附录 A 证据命令同名；修订记录 Spike-phase-0
Exit: 报告 Verdict PASS ↔ 测试 describe/it 名称与常量可定位
```
**判定**: ✅ 报告命令、测试文件、helpers、design 附录 A 四方对齐，无悬空引用。

### Path 3: SnapshotStore dry-run 路径契约
```
Entry: SNAPSHOT_STORE_SPIKE 常量（associationKeys / 200MiB / 2MiB / prunePolicy）
  → snapshotSessionDir / snapshotBlobPath
       <storageRoot>/changes/<sessionId>/<snapshotRef>.json   ✅
  → dryRunSnapshotStore: mkdir → writeFile → readFile round-trip → rm
  → authority marker `.dsh/sessions/…` stat 前后对比 → touchedAuthorityLog === false
Exit: 元数据返回 { blobPath, bytesWritten, readOk, deleted, touchedAuthorityLog }
      （无快照明文进入返回值键面之外的下游）
```
**判定**: ✅ 写→读→删闭环连通；与权威会话日志路径隔离断言接上；布局与 design 附录 A.3 / 报告 AC-S2 锁定值一致。

### Path 4: 误报否定（用户手动保存）集成
```
Entry: turn 窗口内注入可恢复 meta.diffs → path P 入候选集
  → simulateUserManualSave(Q)                         ✅ emittedMetaDiffs: false
  → 不 emit session.event / 不调用 vscode watch/save
  → attributionPathsForLatestTurn 再取集
Exit: Q ∉ 候选集；P 仍在；helpers 源码无 vscode / FileSystemWatcher / onDidSave 导入
```
**判定**: ✅ 否定路径与正路径共用同一 TimelineStore 窗口 API，对比集成完整。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `attributionCandidatesFromMeta` | vitest AC-S1 | ✅ | `recoverableDiffsFromMeta` | ✅ |
| `attributionPathsForLatestTurn` | vitest AC-S1 / AC-S3 | ✅ | `TimelineStore.changedFilesForLatestTurn` | ✅ |
| `dryRunSnapshotStore` | vitest AC-S2 | ✅ | `snapshotBlobPath` + fs write/read/rm | ✅ |
| `simulateUserManualSave` | vitest AC-S3 | ✅ | （有意无下游入账） | ✅ |
| `SNAPSHOT_STORE_SPIKE` | tests + spike-report + design A.3 | ✅ | path/budget 断言 | ✅ |
| `attributionHunksForLatestTurn` | （无测试调用） | ⚪ | `writeDiffsForSession` + latest-turn paths | ⚪ 未消费 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| helpers → `recoverableDiffsFromMeta` | `path` + `newText` + `oldText: string\|null` | 同契约；缺 `oldText` / patch-only → `[]` | ✅ |
| helpers → `TimelineStore.changedFilesForLatestTurn` | 最新 `turn/start` 后唯一 path 列表 | 实现同 AC-30 | ✅ |
| tests → `TimelineStore.apply` | `session.event` + `tool/result.meta` | `narrowDiffs` 挂 `item.diffs` | ✅ |
| dry-run path → design A.3 | `changes/<sessionId>/<ref>.json` | `snapshotBlobPath` 同布局 | ✅ |
| spike-report 命令 → vitest `-t` | `"user manual save"` | it 标题含该子串 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `TimelineStore` / `narrowDiffs` / `changedFilesForLatestTurn` | chat-ready（既有） | 已实现，只读复用 | ✅ |
| `recoverableDiffsFromMeta` | chat-ready | 已实现，只读复用 | ✅ |
| SnapshotStore 产品挂载 / ChangeList UI | phase-2/3 | 未实现（Spike 仅 dry-run 契约） | ✅ 预期缺口 |
| `packages/core/agent-loop` | — | 禁止修改 | ✅ 未触碰 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无 — 无端到端断裂或契约不一致）

### 🟢 Observations
- Spike 证据刻意停在 `TimelineStore.apply` L2，未再经 `IdeSessionHost` → `ConversationController`；与 `spec.md`「L1/L2 即可」及 repo-exploration Path C 一致，不算断裂。
- `attributionHunksForLatestTurn` 已接线生产 API 但本 Phase 测试未消费；不影响 Gate 路径（AC 用 paths + fromMeta）。
- 产品侧尚未把 `storageUri` 接入 Extension Host；本 Phase 用 temp `storageRoot` 验证路径契约，phase-2 须按 A.3 实挂。

## 详细依据
- Spec / 实现 / Gate：`spec.md` · `implementation.md` · `spike-report.md`
- 调用链背景：`repo-exploration.md` Path A–C
- 证据代码：`apps/vscode-dsh/tests/spike-attribution-helpers.ts` · `spike-attribution-snapshot.spec.ts`
- 生产契约：`timeline-store.ts`（`narrowDiffs` / `changedFilesForLatestTurn`）· `replay-hydrator.ts`（`recoverableDiffsFromMeta`）
- 下游消费锁：`design.md` 附录 A / 修订记录 `Spike-phase-0`
