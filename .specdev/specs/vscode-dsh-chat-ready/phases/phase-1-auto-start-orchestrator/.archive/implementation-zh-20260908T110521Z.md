# Phase 1 实现摘要 — phase-1-auto-start-orchestrator

## 变更清单（文件列表）

### 新增
- `apps/vscode-dsh/src/auto-start-orchestrator.ts` — Start-reason 状态机
- `apps/vscode-dsh/src/connection-ui.ts` — 连接 UI 投影 + AutoReady 门闩缝（phase-2 桩）
- `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` — L1 FSM 测试
- `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` — L2 集成测试

### 修改
- `extension.ts`、`chat-panel/*`、`package.json`、`README.md`、`tech-debt-registry.md`（详见英文版 `implementation.md`）

### 未改
- `packages/core/**/agent-loop*`

## 验收标准实现说明

见 `implementation.md` 中的 AC 对照表（AC-1…AC-7 切片、AC-13/14、AC-25/26）。

## 测试结果

```sh
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit   # exit 0
./node_modules/.bin/vitest run apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/phase1-auto-start.spec.ts
# 12 passed
./node_modules/.bin/vitest run apps/vscode-dsh/tests
# 92 passed
```

## 偏差与债务

- **偏差**：Start 成功后仍临时 restore/New（phase-2 解耦）；活动栏打开信号以可见性/测试钩子/状态栏为主。
- **债务**：STUB-001 AutoReadyLatchSeam；DEBT-001 restore-on-start → `phase-2-auto-ready-surface`。
