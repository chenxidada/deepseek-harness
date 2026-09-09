# Phase 0 实现摘要 — phase-0-spike-attribution-snapshot

## 变更清单（文件列表）

| 路径 | 动作 | 说明 |
|------|------|------|
| `apps/vscode-dsh/tests/spike-attribution-helpers.ts` | 新增 | 归因候选解析 + SnapshotStore dry-run + 锁定常量 |
| `apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts` | 新增 | AC-S1 / AC-S2 / AC-S3 可复跑 L2 探测（7 tests） |
| `.specdev/specs/.../phases/phase-0-spike-attribution-snapshot/spike-report.md` | 新增 | Gate 报告，Verdict **PASS** |
| `.specdev/specs/.../design.md` | 修订 | 附录 A 实证锁定 + 修订记录 Spike-phase-0 |
| `.specdev/specs/.../tech-debt-registry.md` | 修订 | GAP-CCD-010 / GAP-CCD-011 / DEBT-CCD-001 |
| `.specdev/specs/.../phases/.../implementation.md` | 新增 | 本文件 |
| `.specdev/specs/.../phases/.../implementation-zh.md` | 新增 | 中文镜像 |

未改：`packages/core/agent-loop`；无产品 ChangeList / 撤销 / 代码引用 UI；无权威会话日志明文快照。

## 对每个验收标准的实现说明

| AC | 实现 | 证据 |
|----|------|------|
| **AC-S1** | 测量 `meta.diffs` 可恢复路径可入账；create/空/patch-only 不入账；覆盖矩阵写入 spike-report；结论 **PASS**（宁可漏记） | `spike-report.md` §AC-S1；vitest AC-S1 用例 |
| **AC-S2** | 锁定 `storageUri…/changes/<sessionId>/<snapshotRef>.json`、关联键、200 MiB / 2 MiB、LRU prune；dry-run 写读删且不碰权威日志 | `SNAPSHOT_STORE_SPIKE`；vitest AC-S2；design 附录 A.3 |
| **AC-S3** | 注入 DSH path + 模拟用户保存另一 path → 后者不在候选集；禁止 watcher 入账 | vitest `-t "user manual save"` |

## 测试结果（命令 + 输出）

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts
```

```
Test Files  1 passed (1)
     Tests  7 passed (7)
```

Exit code: **0**.

## 偏差记录

无与 phase-0 `spec.md` 冲突的偏差。相对 design 附录 A「待实证」假设：已实证并回写（修订记录 `Spike-phase-0`）。

- **偏差描述**：附录 A 从「假设」升级为「实证锁定」，并补充 hunk≠blob 规则。
- **影响范围**：design.md §附录 A / AD-CCD-1 / AD-CCD-6；不影响 AD-CCD-7。
- **原因**：Spike Gate 要求 PASS 时回写。
- **影响**：phase-2 必须按 A.2/A.3 实现 SnapshotStore；create 漏记登记为 GAP-CCD-010（🟡）。

## Gate 信号

**PASS** — 允许后续 phase-2/3（仍须各自 HG）；不阻塞 phase-1。
