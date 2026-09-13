# Phase 5 验证报告 — phase-5-fork-retry-branch（中文）

## 判决：PASS

上轮 MUST-FIX（turn=0 `emptySeed` 非 tip-fork；MessageStore 按 seed 裁剪）已用独立场景复验关闭。AC-30–34 / AC-60–66、P2-1、GAP-CUX-002、未改 agent-loop 均有执行证据。

## 通过场景摘要

- **AC-30**：复制路径 + `lastCopiedText` 可观测；文本参数变化不坍塌
- **AC-31/31b/66**：新 id、父 `mode→replay`、E2 probes、切到 child、不 resume 父 id
- **Must-Fix**：turn=0 / 无 prior → `{emptySeed:true}`；子会话不保留父 assistant
- **Must-Fix**：prior-cut `seedMaxTurn` 裁剪 MessageStore；`projectMessagesForForkSeed` 参数变化成立
- **AC-32**：编辑重发 P-接续 + `editedText`；emptySeed
- **AC-34/61**：拒 aborted / open / 非法 seq；fork 未发出
- **AC-60**：P-标明父 mode 仍 live；无 parentReadonly
- **AC-64**：子 ChangeStore 空桶
- **AC-65**：Continue same-id resume
- **约束**：无 agent-loop 改动；无同会话 truncate

## 产物路径

- 报告：`.specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/verification.md`
- 脚本：`.specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/test-scripts/`
