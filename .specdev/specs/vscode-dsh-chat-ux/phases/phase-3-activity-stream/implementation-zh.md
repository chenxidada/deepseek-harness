# Phase 3 实现摘要 — phase-3-activity-stream（中文）

见同目录 `implementation.md`（英/中内容一致，本文件为调度可读副本）。

## 要点

- 对话内嵌 `kind:'activity'`；默认折叠；同回合 `data-turn` 归组
- 状态机 `running → done | failed | aborted`；cancel/turn-end → aborted；不自动 revert
- `activity-dom.ts` 供层 A；回放 `foldActivities`；replay 仍拒发
- **GAP-CUX-001 已关闭**
