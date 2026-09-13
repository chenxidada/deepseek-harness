# Phase 4 实现摘要 — 时间线 + 事后 Diff

## 变更清单

| 路径 | 变更 |
|------|------|
| `apps/vscode-dsh/src/timeline-store.ts` | **新建** — 将 `session.event` / `session.status` / `subagent.*` 投影为 turn/step/tool/assistant/status/subagent；按 `sessionId` 缓冲 + 父子会话树；从 `tool/result.meta.diffs` 收集写文件 Diff |
| `apps/vscode-dsh/src/timeline-view.ts` | **新建** — `dsh.timeline` TreeView；写文件行命令 → `dsh.openTimelineDiff` |
| `apps/vscode-dsh/src/diff-entry.ts` | **新建** — 事后 `vscode.diff`（`dsh-diff` 内容提供器）；`DEFAULT_POST_HOC_DIFF_ONLY`；无执行中确认 |
| `apps/vscode-dsh/src/session-host.ts` | 运输层 watcher 上增加 `onNotification` 分发（仍检测运输死亡） |
| `apps/vscode-dsh/src/conversation-controller.ts` | 持有 `TimelineStore`；应用 SDK 通知；用 `session.status` 同步 Tab 状态；关 Tab / 关机时清空时间线 |
| `apps/vscode-dsh/src/extension.ts` | 注册 Timeline 视图 + Diff 命令；导出测试辅助函数 |
| `apps/vscode-dsh/src/index.ts` | 再导出 timeline / Diff API |
| `apps/vscode-dsh/package.json` | 贡献 `dsh.timeline` 视图与 Diff 命令 |
| `apps/vscode-dsh/README.md` | 文档化 Timeline / Diff |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | `FAKE_EMIT_TURN_EVENTS` / `FAKE_EMIT_WRITE_DIFF` / `FAKE_SUBAGENT` 脚本化事件流 |
| `apps/vscode-dsh/tests/timeline-*.spec.ts` | 单元 / 集成 / e2e（AC-33） |
| `.cursor/skills/project-test/SKILL.md` / `project-build/SKILL.md` | Phase 4 知识条目 |

未创建桩。`tech-debt-registry.md` 活跃表仍为空。

## 验收标准实现说明

| AC | 实现 |
|----|------|
| **AC-12** | 活动 Tab `session/prompt` 回执含 UUID `messageId`（集成 + e2e 断言） |
| **AC-13** | 通知 → `TimelineStore` → 活动 Tab 过滤的 Timeline 视图（turn/step/tool/assistant） |
| **AC-14**（Should） | subagent 启停标注 + 子会话事件 `depth > 0` |
| **AC-23** | 从 `meta.diffs` 提供事后 Diff 入口 |
| **AC-24** | 默认仅事后 Diff；不注册执行中写前确认命令 |
| **AC-25**（Should） | 时间线写文件条目跳转 `dsh.openTimelineDiff` |
| **AC-33** | ≥1 单元 + ≥1 集成 + ≥1 e2e |

## 测试结果

```text
vitest run apps/vscode-dsh/tests/timeline-*.spec.ts
# 3 files / 5 tests PASSED

vitest run …timeline* + multi-tab-session + session-host + conversation-registry
# 6 files / 16 tests PASSED
```

## 偏差记录

无实质性偏差。

- **无 tool meta 时的纯 git/SCM 路径未实现**：AC-23 允许 tool 事件和/或 git；本 Phase 优先 `meta.diffs`。无 hunk 时命令给出提示信息，不调用未验证的 git API。
  - **影响范围**：spec.md AC-23 / design.md AD-7
  - **原因**：无真实 VS Code SCM 宿主验证；tool meta 已满足 Must
  - **下游影响**：后续可加 git fallback，无需改命令面

## 自检

- 新模块无空壳函数
- 完整路径：fake runtime → SDK client → Host 分发 → TimelineStore → 视图 / Diff
- 无 `@STUB` / “稍后接线” 注释
- 未改 agent-loop、Spec 面板、执行中写前确认
