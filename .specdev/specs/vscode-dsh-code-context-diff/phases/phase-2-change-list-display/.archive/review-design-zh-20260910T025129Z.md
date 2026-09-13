# 设计一致性审查 — phase-2-change-list-display

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-1 · 归属 = 顶层 turn 内可恢复 `meta.diffs`；宁可漏记 | 是 | `ChangeAttributor.ingestToolResult` → `recoverableDiffsFromMeta`；无 `FileSystemWatcher` / 全量 `onDidSave` 入账 | ✅ |
| 附录 A.1 覆盖边界（create/`diffs:[]`、str_replace、bash、手动保存不入账） | 是 | Attributor 头注释 + registry 关闭 GAP-010/011 为「永久漏记」+ L2 夹具 | ✅ |
| AD-CCD-2 / N-2 · 列表挂靠 turn 内最后一条助手；定稿 turn/end | 是 | `noteAssistant` + `clearSettled` 再 settle；`turn/end` 再 enqueueSettle；`sourceMessageId` = Host 投影 id | ✅ |
| AD-CCD-3 · 快照仅扩展本地 | 是 | `SnapshotStore` 写 `<storageRoot>/changes/...`；列表载荷不含 old/new 全文 | ✅ |
| AD-CCD-4 / N-1 · AC-30 与 change-list 共存 | 是 | N>0 注入 `diff-summary` 并 reveal 列表；N=0 无摘要；非仅 Timeline | ✅ |
| AD-CCD-5 · 同 turn 同 path 合并 | 是 | `PathMergeState`；一条记录 / turn+path | ✅ |
| 附录 A.2 / DEBT-001 · hunk 仅信号；blob 整文件 | 主路径是；cache miss 回退否 | before 缓存 + 盘面 after；cache miss 时用 hunk `firstOld` 写入 blob | 🟡 |
| 附录 A.3 · 存储布局 / 根 / 预算 | 是 | `storageUri` → 否则 `globalStorageUri/<workspaceKey>/`；`changes/<sessionId>/<ref>.json`；软预算 | ✅ |
| AD-CCD-6 · prune | 部分（本 Phase 合理） | 仅 oldest-session；reverted-first  defer phase-3 | ✅* |
| AD-CCD-7 · 禁止改 agent-loop | 是 | 仅 vscode-dsh；未改 packages/core / tool-fs；无写盘撤销 | ✅ |
| AD-CCD-8 · 排除规则 | 是 | `change-ignore.ts` | ✅ |
| AD-CCD-9 · Diff 渲染安全 | 是 | diff pane 仅 `textContent` | ✅ |
| 债务处置 vs「宁可漏记」 | 是 | GAP-010/011 永久漏记；DEBT-001 主路径整文件 | ✅ |
| Phase-2 OOS · 无 revert / mark-reviewed | 是 | 无写盘 UI；仅展示 unreviewed | ✅ |

\* 完整 LRU 依赖 phase-3 审阅状态；本 Phase soft budget + 删会话清目录即可。

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `change-*.ts` / `snapshot-store.ts` | `apps/vscode-dsh/src/change/` | ✅ | 符合 design 产出计划 |
| `types.ts` / `index.ts` | `…/change/` | ✅ | 类型与导出；可接受 |
| （无）`revert.ts` | — | ✅ | phase-3 范围，本 Phase 不应交付 |

接线：`conversation-controller` / `message-store` / `chat-panel/*` / `extension.ts` 与 design「修改预期」一致。

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 目录 / 文件 | `src/change/` + kebab-case | design 指定 | ✅ |
| 类型 / 协议 | `ChangeRecord`、`change/get-diff`、`reveal-change-list` | design 模型与 API 表 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 模块只做一件事 | ✅ | Attributor / Store / Snapshot / Ignore 分离 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 未反向依赖 agent-loop |
| §2.3 接口隔离 | 明确协议 | ✅ | `change/*` 窄化解析 |
| §2.4 Feature 硬约束 | 禁改 loop / 快照本地 / 宁可漏记 | ✅ | 已遵守 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
- **before-cache 未命中时，Snapshot blob 不得回退写入 `meta.diffs` hunk。**  
  `settleTurn` 在无整文件 before 时用 `merge.firstOld` 作 `oldText`，违反附录 A.2。应拒绝写 blob（省略 `snapshotRef`），而非把 hunk 当整文件旧文落盘。

### 🟢 Observations
- N=0 每 turn 一句空说明：符合 N-1。
- AC-30 主路径改为 reveal change-list：符合 AD-CCD-4。
- prune 暂用 oldest-session：与 phase-3 一致。
- ChangeStore 内存索引：冷回放持久化非本 Phase Must。
- 未建 `revert.ts`：正确推迟。

## 详细证据索引
- `implementation.md`；`apps/vscode-dsh/src/change/*`；`conversation-controller.ts`；`chat-panel-provider.ts`；`tech-debt-registry.md`
