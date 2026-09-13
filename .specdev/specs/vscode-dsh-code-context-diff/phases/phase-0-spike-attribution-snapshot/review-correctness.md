# Correctness Review — Phase 0 (phase-0-spike-attribution-snapshot)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-S1 | Spike 产出单一 PASS/FAIL 结论；回答 meta.diffs 是否足以稳定识别 DSH 写入 | `spike-report.md`；`spike-attribution-helpers.ts:27-34`；`spike-attribution-snapshot.spec.ts` AC-S1 用例 | ✅ | 报告 Verdict=**PASS**；`attributionCandidatesFromMeta` 委托生产路径 `recoverableDiffsFromMeta`（非空壳）；TimelineStore `changedFilesForLatestTurn` 在 turn 窗口内入账可恢复 hunk；空 diffs / patch-only / missing `oldText` → 空候选；覆盖矩阵 + 宁可漏记边界写入报告；本机重跑 `vitest …spike-attribution-snapshot.spec.ts` → **7 passed**, exit 0 |
| AC-S2 | 锁定存储位置/关联键/生命周期/上限/清理；dry-run 写读删；不碰权威日志 | `SNAPSHOT_STORE_SPIKE`；`dryRunSnapshotStore` (`spike-attribution-helpers.ts:134-179`)；design 附录 A.3；vitest AC-S2 | ✅ | 布局 `changes/<sessionId>/<snapshotRef>.json`；键 sessionId/snapshotRef/sourceMessageId/turn；200 MiB / 2 MiB；prune 常量 `lru-reverted-first-then-oldest-session`；真实 `mkdir`/`writeFile`/`readFile`/`rm`；`stat` 前后对比权威 marker → `touchedAuthorityLog === false`；返回值仅元数据键；design 附录 A 已回写 |
| AC-S3 | 可复跑误报否定：用户手动保存不得标为 DSH 变更 | `simulateUserManualSave`；spec `-t "user manual save"`；spike-report §AC-S3 | ✅ | 注入 `src/dsh-owned.ts` 可恢复 meta → 在候选集；`simulateUserManualSave('src/user-manual.ts')` 且不追加 session.event → `user-manual.ts ∉` 集；helpers 源码断言无 `vscode` / FileSystemWatcher / `onDidSaveTextDocument`；报告含命令与期望 |

### Spike Gate PASS 真实性

| 检查项 | 结果 |
|--------|:----:|
| `spike-report.md` 存在且单一结论 PASS | ✅ |
| 证据脚本可复跑且本审独立重跑通过 | ✅（7/7） |
| 可恢复 `meta.diffs` 归因用生产解析器，非伪造假阳性 | ✅ |
| SnapshotStore probe 真实落盘/读回/删除 | ✅ |
| 误报否定用例存在且禁止 watcher 入账 | ✅ |
| design 附录 A 实证回写 + registry 缺口登记 | ✅ |
| 未用裸 FileSystemWatcher 冒充 PASS | ✅ |
| 未改 `packages/core/agent-loop` | ✅（本 Phase 产物仅 tests + specs） |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-CCD-010 | `tool-fs write.ts:presentationMeta` | ⚠️ Known | create/identical → `diffs:[]`；Spike 测为空候选；🟡非阻塞 |
| GAP-CCD-011 | `tool-str-replace-editor` | ⚠️ Known | 无 presentationMeta；矩阵记漏记；🟡非阻塞 |
| DEBT-CCD-001 | design 附录 A.2 | ⚠️ Known | hunk≠full-file blob；已写入报告/附录；🟡非阻塞 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无 |

说明：`simulateUserManualSave` 固定返回 `emittedMetaDiffs: false` 是 **AC-S3 契约文档化 helper**（故意不发 meta、不接线 watcher），不是产品空壳；归因侧仍走真实 TimelineStore。

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- `dryRunSnapshotStore` 在 `rm` 后硬编码 `deleted: true`，未再 `stat` 确认文件已消失；当前测试仍覆盖 write/read/authority-untouched，不影响 Gate。
- `simulateUserManualSave` 本身不触发任何 I/O——AC-S3 效力来自「仅 meta.diffs 入账」对比 + 禁止 watcher 源码守卫，与 exploration「无 watcher 时用户保存不可能假阳性」一致。
- AC-S1 覆盖矩阵中 tool-fs create/str_replace/bash 行来自既有代码路径知识 + L2 空 meta 夹具，未在本 Spike 内实跑 tool-fs 进程；对 L1/L2 Spike Gate 可接受，且缺口已登记 registry。

## 独立重跑证据

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts
# Test Files  1 passed (1)
# Tests       7 passed (7)
# exit 0
```
