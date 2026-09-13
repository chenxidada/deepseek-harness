# Phase 3 验证报告 — phase-3-activity-stream

## 判决：PASS

独立端到端验证通过。Should-Fix 两项（Host 出站 `messages/patch.activityStatus`；hydrate→`pushFullState` 一体路径）已由 verifier 独立补测并绿；GAP-CUX-001 确认已关闭；未改 `packages/core/agent-loop`。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-21/22/23/25/26/27 层 A 折叠/状态/同 turn | spec | `vitest run apps/vscode-dsh/tests/layer-a/` | ✅ | **19 passed**（含 `activity-stream.spec.ts` 5） |
| AC-13c/20/24/27/28 层 B | spec | `vitest run …/chat-ux-activity-stream.spec.ts` | ✅ | 5/5（含在下方 15 内） |
| phase-2 cancel + message-store 回归 | regression | 同上 batch + streaming-cancel-follow + message-store-index | ✅ | **15 passed** / 3 files |
| AC-13c cancel→aborted 无 revert | spec | 层 B `AC-13c` + 独立 Host patch | ✅ | Store 终态 aborted；无 `change/revert-result`；`revertCalls=[]` |
| AC-20 tool→`[data-kind=activity]` | spec + independent | 层 B append + 独立 mount DOM | ✅ | Host `messages/append` kind=activity；DOM `data-kind=activity` |
| AC-24 无文本仍有活动 | spec | 层 B tool-only | ✅ | 无 assistant text，仍有 activity |
| AC-28 fold + reject-send | spec + Should-Fix | hydrate 分测 + **一体** openFromHistory | ✅ | `messages/replace` 含 2 activity；`ui/reject-send reason=replay` |
| Host `patch.activityStatus` 出站 | reviewer Should-Fix | independent spec | ✅ | tool/result→`done`；cancel→`aborted`；ABORTED_BEFORE_DISPATCH |
| probes.setActivity 产品路径 | GAP-CUX-001 | static + layer A/B + independent | ✅ | `activity-dom`/`provider` 调用；探针可读 |
| 未改 agent-loop | 约束 | `static-checks.sh` | ✅ | working tree / untracked 均无 `packages/core/agent-loop` |
| GAP-CUX-001 已解决 | registry | static grep | ✅ | 活跃表无；已解决表 phase-3-activity-stream |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| Should-Fix: Host 出站 `messages/patch.activityStatus`（tool/result done） | vitest independent | ✅ |
| Should-Fix: cancel/turn-end Host patch `aborted` + 无 revert | vitest independent | ✅ |
| Should-Fix: `openFromHistory` → `pushFullState` `messages/replace` 含 activity + reject-send 一体 | vitest independent | ✅ |
| `activityStatusFromToolResult` 参数变化（info.code / error.code / content.isError） | vitest independent | ✅ |
| Host append → layer-A DOM `data-kind=activity` + probes（接合 E2E） | vitest independent | ✅ |
| 产品 HTML 嵌入 activityStatus / setActivity / activityDom | vitest independent | ✅ |
| live `ABORTED_BEFORE_DISPATCH` → Host patch aborted | vitest independent | ✅ |
| 静态：agent-loop / GAP / 符号接线 | `static-checks.sh` | ✅ |

独立套件：**7 passed**（`verifier-independent-phase3.spec.ts`）。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 层 B 宜补 Host 出站 `messages/patch.activityStatus` | independent（非 implementer） | ✅ 已补测通过 |
| AC-28 hydrate→`pushFullState` 一体断言 | independent `openFromHistory` | ✅ 已补测通过 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| tool/call → MessageStore `kind:activity` → Host `messages/append` → DOM `[data-kind=activity]` + probes | ✅ | 层 B + independent join mount |
| tool/result → Store status → Host `messages/patch.activityStatus` | ✅ | independent 出站断言（Should-Fix） |
| action/stop → turn/end aborted → `abortRunningActivities` → patch aborted；无 auto-revert | ✅ | 层 B + independent |
| `openFromHistory(events)` → hydrate foldActivities → replace → `pushFullState` → mode=replay → reject-send | ✅ | independent 一体路径 |
| Timeline 非唯一表面 | ✅ | MessageStore 有 activity（Timeline 仍可弱化并存） |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 无 VS Code 真机 Webview 视觉截图 | 🟢 LOW | 层 A jsdom + Host FakePort 覆盖契约；constitution 允许提取模块路径 |
| change-list live settle 与 activity 同 turn 未做 SnapshotStore 联测 | 🟢 LOW | AC-25 归组契约由 `data-turn` + 层 A 共属性断言覆盖；live settle 属既有 change-list 路径 |

无 CRITICAL / MEDIUM 残余风险。

## Pipeline 合规检查

- Pipeline compliance: ✅ 所有非 specs 代码改动在 `impl-phase-3-activity-stream` 工作区（未 commit，符合流程）
- 未修改 `packages/core/agent-loop`
- 无 commit（verifier 不提交）

## 问题清单（为何不是 FAIL / PARTIAL）

（无阻断问题。）Should-Fix 仅为测试覆盖缺口，代码路径已连通；本轮独立补测已关闭该缺口，故判决 **PASS**。

## 验证脚本

落盘目录：`.specdev/specs/vscode-dsh-chat-ux/phases/phase-3-activity-stream/test-scripts/`

| 文件 | 用途 |
|------|------|
| `run-verifier-phase3.sh` | 一键：static + layer-A + layer-B/regression + independent |
| `static-checks.sh` | agent-loop / GAP-CUX-001 / 产品符号 |
| `verifier-independent-phase3.spec.ts` | 7 个独立场景（含 Should-Fix） |
| `vitest.config.ts` | 独立 vitest 配置 |

一键命令：

```bash
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-3-activity-stream/test-scripts/run-verifier-phase3.sh
```

执行摘要（2026-09-11，Node v22.14.0）：static PASS → layer-A 19 → layer-B/regression 15 → independent 7 → **ALL VERIFIER PHASE-3 CHECKS DONE**（exit 0）。
