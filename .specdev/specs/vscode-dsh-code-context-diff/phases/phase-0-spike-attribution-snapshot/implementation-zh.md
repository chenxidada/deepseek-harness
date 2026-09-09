# Phase 0 实现摘要 — phase-0-spike-attribution-snapshot

## 变更清单（文件列表）

| 路径 | 动作 | 说明 |
|------|------|------|
| `apps/vscode-dsh/tests/spike-attribution-helpers.ts` | 新增 | 归因候选解析 + SnapshotStore dry-run + 锁定常量 |
| `apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts` | 新增 | AC-S1 / AC-S2 / AC-S3 可复跑 L2 探测（7 tests） |
| `.specdev/specs/.../phases/phase-0-spike-attribution-snapshot/spike-report.md` | 新增 | Gate 报告，Verdict **PASS** |
| `.specdev/specs/.../design.md` | 修订 | 附录 A 实证锁定 + 修订记录 Spike-phase-0 |
| `.specdev/specs/.../tech-debt-registry.md` | 修订 | GAP-CCD-010 / GAP-CCD-011 / DEBT-CCD-001 |
| `.specdev/specs/.../phases/.../implementation.md` | 新增 | 英文主文件 |
| `.specdev/specs/.../phases/.../implementation-zh.md` | 新增 | 本中文镜像 |

未改：`packages/core/agent-loop`；无产品变更列表 / 撤销 / 代码引用 UI；无权威会话日志明文快照。

## 对每个验收标准的实现说明

| AC | 实现 | 证据 |
|----|------|------|
| **AC-S1** | 测量可恢复 `meta.diffs` 可入账；create/空/patch-only 不入账；覆盖矩阵写入报告；结论 **PASS**（宁可漏记） | `spike-report.md`；vitest AC-S1 |
| **AC-S2** | 锁定扩展本地 `changes/<sessionId>/<snapshotRef>.json`、关联键、字节预算与 prune；dry-run 验证不碰权威日志 | 常量 + vitest AC-S2 + design 附录 A.3 |
| **AC-S3** | DSH 注入路径入账、用户手动保存路径不入账；禁止用 watcher 冒充 | vitest「user manual save」 |

## 测试结果

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts
```

7 passed，exit 0。

## 偏差记录

无与 phase-0 spec 冲突的偏差。design 附录 A 已由「假设」回写为「实证锁定」（修订 `Spike-phase-0`）。

## Gate 信号

**PASS** — 允许后续 phase-2/3（仍须各自流程）；不阻塞 phase-1。
