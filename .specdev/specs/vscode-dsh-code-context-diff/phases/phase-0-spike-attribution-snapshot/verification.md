# Phase 0 验证报告 — phase-0-spike-attribution-snapshot

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-S1: Gate 报告单一 PASS + meta.diffs 归因可复跑 | spec | `./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts` | ✅ | Test Files 1 passed; Tests **7 passed**; exit 0（verifier 2026-09-09 重跑） |
| AC-S1: spike-report 方法/覆盖矩阵/AD-CCD-1 | static | `test -f spike-report.md` + 内容审计 | ✅ | Verdict **PASS**；覆盖矩阵含 create/str_replace/bash/user-save；宁可漏记边界明确 |
| AC-S1: design 附录 A 回写 | static | grep `Spike-phase-0` / A.1–A.3 | ✅ | `design.md` 附录 A 实证锁定；修订记录 `Spike-phase-0` |
| AC-S2: SnapshotStore dry-run 写读删 + 权威日志隔离 | spec | 同上 vitest（AC-S2 describe） | ✅ | 实现者套件内 dry-run 通过；布局 `changes/<sessionId>/<ref>.json`；200 MiB / 2 MiB 与 design A.3 对齐 |
| AC-S3: 用户手动保存误报否定 | spec | `…spike-attribution-snapshot.spec.ts -t "user manual save"` | ✅ | 1 passed \| 6 skipped；`user-manual.ts ∉` 候选集 |
| 禁止 watcher 入账 | static | helpers 源码无 `vscode` / `createFileSystemWatcher` / `onDidSaveTextDocument` | ✅ | `NO_WATCHER_OK` |
| 禁止改 agent-loop | static | Phase 产物仅 tests + specs | ✅ | 非 specs 代码变更仅 `apps/vscode-dsh/tests/spike-attribution-*` |

## 独立验证场景（你自己设计的）

脚本：`test-scripts/verifier-independent.spec.ts`（独立 vitest 配置 `test-scripts/vitest.config.ts`）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 同 turn 多 path 可恢复 meta → 双路径入账 | `vitest run --config …/test-scripts/vitest.config.ts` | ✅ |
| `oldText:null` 可恢复 hunk → 入账（AD-CU-6） | 同上 | ✅ |
| 参数变化探测：`attributionCandidatesFromMeta` 输出随输入变化（非桩） | 同上 | ✅ |
| dry-run 后磁盘 `access` 确认 blob 已删 + session 路径隔离 | 同上 | ✅ |
| 权威日志路径缺失时 `touchedAuthorityLog === false` | 同上 | ✅ |
| 权威 marker 字节内容 dry-run 后不变 | 同上 | ✅ |
| 格式化等价保存第二 path **不得**入账（AC-S3 兄弟场景） | 同上 | ✅ |

**结果：** Test Files 1 passed；Tests **7 passed**；exit 0。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| correctness：重跑完整 spike vitest | `./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts` | ✅ 7/7 |
| connectivity：AC-S3 `-t "user manual save"` | 同上 + `-t "user manual save"` | ✅ 1/1 |
| connectivity：报告命令 ↔ 测试文件对齐 | 静态对照 spike-report / helpers / design A | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| Producer: inject `session.event` turn/start + tool/result.meta.diffs → Framework: `TimelineStore.apply` / `narrowDiffs` → Consumer: `attributionPathsForLatestTurn` | ✅ | 实现者 7 tests + verifier multi-path / null-oldText / format FP |
| Producer: `dryRunSnapshotStore` → Framework: fs mkdir/write/read/rm under temp storageRoot → Consumer: 元数据返回 + 权威 `.dsh/sessions` 未触碰 | ✅ | 实现者 AC-S2 + verifier disk-delete confirm + marker byte equality |
| False-positive: DSH path 入账 vs user/format save 无 meta → 后者不在候选集 | ✅ | AC-S3 重跑 + verifier format-equivalent |

宿主层为 L2（spec 允许）；未跑 IdeSessionHost→ConversationController 全链，与 exploration Path C / review-connectivity 一致。

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| create / str_replace_editor / bash 写盘不入账 | 🟢 LOW | 已登记 GAP-CCD-010 / GAP-CCD-011；Gate 按「宁可漏记」接受，非 FAIL |
| hunk≠full-file blob（DEBT-CCD-001） | 🟢 LOW | 已回写 design A.2；phase-2 入账时另取整文件 |
| `design-zh.md` 附录 A 未同步 | 🟢 LOW | review SHOULD-FIX；canonical `design.md` 已锁定，不阻塞 Gate |
| L2 未经 Host 全链 | 🟢 LOW | spec 明确 L1/L2 即可 |

无 CRITICAL / MEDIUM 残余风险。

## 问题清单（为何不是 FAIL / 为何可 PASS）

本判决为 **PASS**，无「为何不是 PASS」条目。已知缺口均已在 registry 登记为 🟡非阻塞，且与 spike-report / design 附录 A 一致。

## Pipeline 合规检查

- 当前分支：`impl-phase-0-spike-attribution-snapshot`
- 本 Phase 非 specs 代码：`apps/vscode-dsh/tests/spike-attribution-helpers.ts`、`spike-attribution-snapshot.spec.ts`（均在 `impl-*` 分支工作区，未提交）
- Pipeline compliance: ✅ 所有本 Phase 代码变更位于 `impl-phase-0-spike-attribution-snapshot` 分支（无 main 上的实现提交）

## 验证脚本

| 脚本 | 用途 |
|------|------|
| `test-scripts/verifier-independent.spec.ts` | verifier 独立 7 场景 |
| `test-scripts/vitest.config.ts` | 使 `.specdev/.../test-scripts` 可被 vitest include |

### 复跑命令

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts
./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts -t "user manual save"
./node_modules/.bin/vitest run --config .specdev/specs/vscode-dsh-code-context-diff/phases/phase-0-spike-attribution-snapshot/test-scripts/vitest.config.ts
```
