# Spike Gate 报告 — phase-0-spike-attribution-snapshot（中文镜像）

| 字段 | 值 |
|------|-----|
| **判决** | **PASS** |
| 工作流 | `vscode-dsh-code-context-diff` |
| Phase | `phase-0-spike-attribution-snapshot` |
| 日期 (UTC) | 2026-09-09 |

完整英文正文与证据表见同目录 `spike-report.md`。

## 结论摘要

- **AC-S1**：可恢复 `tool/result.meta.diffs` 足以稳定入账；create / shell / str_replace_editor 漏记属「宁可漏记」，非 FAIL。
- **AC-S2**：SnapshotStore 锁定为 `<storageUri>/changes/<sessionId>/<snapshotRef>.json`；关联键 sessionId/snapshotRef/sourceMessageId/turn；200 MiB / 2 MiB；删会话清目录；LRU 先 reverted 再最旧 session。
- **AC-S3**：用户手动保存路径不得入账；命令见英文报告。

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts
```

7 passed → Gate **PASS**（不阻断 phase-1；允许后续 phase-2/3）。
