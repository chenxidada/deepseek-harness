# Phase 4 实现摘要（债务清扫 DEBT-007…013）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushFullState`：投影路径始终 `resolveContinueChrome`（DEBT-007） |
| `apps/vscode-dsh/src/conversation-controller.ts` | Continue 有效 session/mode；删子 patch 父卡；restore 钉态；面包屑禁用；`restoreMoreTabs` suspend persist |
| `apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts` | DEBT-007…011 回归 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | DEBT-012 L2 |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | DEBT-013 批处理 openTabSet 不缩水 |
| `.specdev/specs/vscode-dsh-conversation-ui/tech-debt-registry.md` | DEBT-007…013 → 已解决；活跃表空 |

## 对每个验收标准的实现说明

| ID | 实现 |
|----|------|
| **DEBT-007** | `pushFullState` / `panelSnapshot` 不再 `mode==='live'` 才解析 Continue；委托 `continueChromeForTab`（仅有效 replay 启用） |
| **DEBT-008** | `effectiveContinueSessionId` = `contextSessionId ?? sessionId`；Continue resume 子 id，并提升为 live（钉）Tab |
| **DEBT-009** | `deleteConversation` / `deleteSession` 在清 timeline 前取 parent，删后立即 `markSubagentCardDeleted` |
| **DEBT-010** | `restoreOpenTabSetBody` 与 `restoreMoreTabs` 成功后 `setPinnedSubagent` |
| **DEBT-011** | `buildBreadcrumb`：父已删或父 Tab 未打开 → `parentDeleted` + 禁用文案，对齐 `navBack` |
| **DEBT-012** | L2：无 `events` 注入走 `readSessionLog`；live upsert → `clearLocal` → activate 冷读 `listHistory` |
| **DEBT-013** | `restoreMoreTabs` 全程 `openTabPersistSuspended`，批末一次 `persistOpenTabs` |

## 测试结果（命令 + 输出）

```text
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts
→ Test Files 3 passed | Tests 41 passed

PATH=... ./node_modules/.bin/vitest run apps/vscode-dsh/tests
→ Test Files 20 passed | Tests 100 passed

PATH=... ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
→ exit 0
```

## 偏差记录

无。未改 `packages/core/agent-loop`；未 git commit。

## 已关闭 ID

DEBT-007, DEBT-008, DEBT-009, DEBT-010, DEBT-011, DEBT-012, DEBT-013

## 仍未关项

无（活跃债务表为空）。
