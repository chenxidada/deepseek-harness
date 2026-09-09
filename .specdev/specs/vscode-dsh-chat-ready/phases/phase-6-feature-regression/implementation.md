# Phase 6 实现摘要：feature-regression

## 变更清单（文件列表）

| 路径 | 动作 | 说明 |
|------|------|------|
| `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | 新增 | AC-R1/R2 一键回归入口（vitest 显式文件列表 + 债表静态检查 + agent-loop 守卫） |
| `apps/vscode-dsh/tests/chat-ready-regression.spec.ts` | 新增 | 矩阵文档 + 入口脚本存在性 smoke（1 case） |
| `apps/vscode-dsh/README.md` | 修改 | 增加 Chat-ready Feature regression 节 |
| `.specdev/specs/vscode-dsh-chat-ready/phases/phase-6-feature-regression/test-scripts/run-chat-ready-regression.sh` | 新增 | 薄包装，委托 apps 脚本 |
| `.specdev/specs/vscode-dsh-chat-ready/feature-delivery-summary.md` | 新增 | AC-R4 交付摘要 |
| `.specdev/specs/vscode-dsh-chat-ready/feature-delivery-summary-zh.md` | 新增 | 中文交付摘要（与 en 同源） |
| 产品 `apps/vscode-dsh/src/**` | **未改** | 无回归缺陷，无架构变更 |
| `packages/core/agent-loop` | **未改** | 约束遵守 |

## 对每个验收标准的实现说明

### AC-R1 — 统一可编程回归入口

- 入口：`bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`
- 步骤 [1] 显式 vitest 文件列表覆盖：
  - 自动建连：`auto-start-orchestrator` + `phase1-auto-start`（含 AC-1a 反向）
  - 自动就绪：`phase2-auto-ready`
  - Chat 底盘：`phase3-chat-ui-chassis`
  - 新建 chrome：`phase4-new-conversation-chrome`
  - 升格抛光：`phase5-should-polish`
  - AC-27 抽测：`phase3-restart-continue` / `phase2-multitab-history-replay` / `panel-close-delete.e2e`
  - 矩阵文档 smoke：`chat-ready-regression.spec.ts`
- **结果：10 files / 90 tests passed；exit 0**

### AC-R2 — phase-1…4 仍通过

- 脚本步骤 [2] 单独复跑 phase1–4 相关 5 个文件
- **结果：5 files / 52 tests passed；exit 0**（phase-5 合入后无回退）

### AC-R3 — 活跃债 / Out-of-Scope

- 读 `tech-debt-registry.md`：活跃表仅「（无）」；脚本步骤 [3] 程序化断言
- AC-33 在 `feature-delivery-summary.md` Out-of-Scope 节显式文档化（非静默 Should）
- 无新增桩 / 无活跃 🔴

### AC-R4 — Feature 交付摘要

- 已写 `feature-delivery-summary.md` + `feature-delivery-summary-zh.md`
- 含：已交付 Must、Out-of-Scope（AC-33）、回归命令与结果矩阵

## 测试结果（命令 + 输出）

```bash
bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh
```

```
== [1] vitest chat-ready Must matrix (phase-1…5 + AC-27 sample) ==
 Test Files  10 passed (10)
      Tests  90 passed (90)
== [2] AC-R2 phase-1…4 suites still green (explicit re-run) ==
 Test Files  5 passed (5)
      Tests  52 passed (52)
== [3] AC-R3 tech-debt-registry active table empty ==
OK: active debt empty
== [4] agent-loop untouched in working tree ==
OK: no agent-loop changes in working tree
ALL CHAT-READY REGRESSION STEPS OK
```

退出码：**0**

## 偏差记录

无。本 Phase 仅增加回归 harness / 文档；未改产品架构；未实现 AC-33；未触碰 agent-loop。

## 债务注册

- 未创建 `@STUB`
- 活跃表保持空；无需迁入「已解决」
