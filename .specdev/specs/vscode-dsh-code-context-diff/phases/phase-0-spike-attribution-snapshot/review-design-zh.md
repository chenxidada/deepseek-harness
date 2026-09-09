# 设计一致性审查 — phase-0-spike-attribution-snapshot

## 视角
**Design Consistency** — 实现是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-1 · 归属 = `meta.diffs`；禁裸 watcher / 全量 onDidSave | 是 | 复用 `recoverableDiffsFromMeta` + TimelineStore turn 窗口；AC-S3 无 watch/save 入账；helpers 无 `vscode` 依赖 | ✅ |
| AD-CCD-1 · 宁可漏记 | 是 | 空 diffs / 缺 oldText 不入账；覆盖矩阵 + GAP-CCD-010/011 | ✅ |
| AD-CCD-3 · 快照仅扩展本地 | 是 | `changes/<sessionId>/<ref>.json` dry-run；权威日志未触碰 | ✅ |
| AD-CCD-6 / N-4 · 生命周期与预算 | 是 | `SNAPSHOT_STORE_SPIKE` 与附录 A.3 锁定值一致 | ✅ |
| AD-CCD-7 · 不改 agent-loop | 是 | 仅 tests + specs；无 core 改动 | ✅ |
| 附录 A PASS 回写 | 部分 | `design.md` 完整锁定；`design-zh.md` 仍为假设稿 | 🟡 |
| Constitution §2.4 / §4.4 | 是 | 误报否定、本地快照、Spike 先于产品 Phase | ✅ |

## 模块/命名/结构

Spike 产物落在 `apps/vscode-dsh/tests/`，未提前创建 `src/change/*` 产品模块；命名与既有 L2 夹具惯例一致。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
- 将 `design-zh.md` 附录 A（及修订记录 `Spike-phase-0`）与 canonical `design.md` 实证锁定内容对齐。

### 🟢 Observations
- hunk≠blob 已登记 DEBT-CCD-001，交给 phase-2；未以 watcher 冒充 PASS。

完整对照表见同目录 `review-design.md`。
