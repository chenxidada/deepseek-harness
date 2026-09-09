# Design Consistency Review — phase-0-spike-attribution-snapshot

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-1 · 归属主源 = `meta.diffs`；禁止裸 watcher / 全量 onDidSave | 是 | `attributionCandidatesFromMeta` → `recoverableDiffsFromMeta`；TimelineStore turn 窗口；AC-S3 无 save/watch 入账；helpers 无 `vscode` import；spec 显式断言禁止 watcher API | ✅ |
| AD-CCD-1 · 宁可漏记（create / empty / patch-only / 无 meta） | 是 | 空 `diffs: []`、缺 `oldText` 不入账；覆盖矩阵写入 spike-report；GAP-CCD-010/011 登记为 🟡 | ✅ |
| AD-CCD-3 · 快照仅扩展本地；禁止权威日志明文 | 是 | dry-run 写 `<storageRoot>/changes/<sessionId>/<ref>.json`；断言 `touchedAuthorityLog === false`；返回值仅元数据键 | ✅ |
| AD-CCD-6 / N-4 · 生命周期 + 字节预算 LRU | 是 | `SNAPSHOT_STORE_SPIKE`：200 MiB / 2 MiB、`lru-reverted-first-then-oldest-session`、关联键含 sessionId/snapshotRef/sourceMessageId/turn；附录 A.3 已锁定同值 | ✅ |
| AD-CCD-7 · 禁止改 agent-loop；主落 vscode-dsh | 是 | 变更仅 `apps/vscode-dsh/tests/spike-attribution-*.ts` + specs；无 `packages/core/agent-loop` 改动；无产品 ChangeList/撤销 UI | ✅ |
| 附录 A 回写（PASS 时实证锁定） | 部分 | **canonical** `design.md` A.1–A.3 + 修订记录 `Spike-phase-0` 完整（含 hunk≠blob、storage 布局、禁止 watcher）；**镜像** `design-zh.md` 仍为「Spike 假设 / 待实证 / 待锁定」，与 header「Mirror: design-zh.md」及 PASS 结论冲突 | 🟡 |
| Constitution §2.4 · 宁可漏记、不可误记；快照不进权威日志；不改写盘模型 | 是 | AC-S3 误报否定；blob 隔离；无 agent-loop / 工具执行语义改动 | ✅ |
| Constitution §4.4 · Spike 先于 change-list 产品 Phase | 是 | Gate PASS 报告 + 不交付产品列表/撤销；phase-2 依赖结论已书面化 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `spike-attribution-helpers.ts` | `apps/vscode-dsh/tests/` | ✅ | Spike 探测放 tests/，未抢先建 `src/change/*` 产品模块（符合 phase-0 排除项与 exploration checklist） |
| `spike-attribution-snapshot.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 与既有 timeline/fake-sdk L2 夹具同层 |
| `spike-report.md` | `phases/.../` | ✅ | Gate 交付物路径正确 |
| `design.md` 附录 A | spec 根 | ✅ | PASS 回写目标正确 |
| `tech-debt-registry.md` GAP/DEBT | spec 根 | ✅ | create / str_replace / hunk≠blob 债务登记完整 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 测试文件 | `spike-attribution-snapshot.spec.ts` | kebab + `.spec.ts`（vscode-dsh 惯例） | ✅ |
| 常量 | `SNAPSHOT_STORE_SPIKE` | SCREAMING_SNAKE 锁定常量 | ✅ |
| 解析复用 | `recoverableDiffsFromMeta` / `changedFilesForLatestTurn` | 复用生产 parser，不平行发明 | ✅ |
| blob 形状 | `SnapshotBlobV0` | Spike 版本化前缀；phase-2 可演进 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | Spike helpers 仅归因候选 + 存储 dry-run | ✅ | 无 UI / ChangeStore 混入 |
| §2.2 依赖方向 | tests → vscode-dsh src parsers；不反向污染 core | ✅ | |
| §2.4 Feature 专属 | 不改 agent-loop；快照本地；宁可漏记 | ✅ | |
| §3.2 敏感数据 | 探测返回值无快照明文进日志面 | ✅ | dry-run 返回 metadata-only keys |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
- **`design-zh.md` 附录 A 未同步实证锁定**：canonical `design.md` 已改为「附录 A · Spike 实证锁定」并写入 A.1 覆盖表、A.2 hunk≠blob、A.3 路径/预算/生命周期与 `Spike-phase-0` 修订行；镜像 `design-zh.md` 仍停留在「假设 / 待实证 / 待锁定」，且修订记录缺 Spike 行。`design.md` header 声明 `Mirror: design-zh.md`——应把附录 A（及对应修订记录）对齐 canonical，避免 phase-2 误读旧假设。

### 🟢 Observations
- A.2「受控快照对比」正确标为后备而非归因主路径；DEBT-CCD-001 把 hunk≠blob 交给 phase-2，与 AD-CCD-1/6 一致。
- `simulateUserManualSave` 刻意不调用 VS Code save/watch API，从架构上满足「禁止 watcher-as-PASS」，而非伪实现产品监听。
- Spike 未在 `src/change/` 预建产品 SnapshotStore——符合「本 Phase 不交付产品变更列表」；锁定常量足以供 phase-2 消费。

## 附录 A 回写质量（PASS Gate）

| 项 | 判定 |
|----|:----:|
| A.1 主路径 + 覆盖边界表 + 禁止 watcher | ✅（`design.md`） |
| A.2 后备边界 + hunk≠full-file blob 规则 | ✅（`design.md`） |
| A.3 根/布局/键/生命周期/预算/sourceMessageId | ✅（与 `SNAPSHOT_STORE_SPIKE` 一致） |
| 修订记录 Spike-phase-0 | ✅（`design.md`） |
| 中文镜像同步 | 🟡（见 Should-Fix） |
