# Phase 4 实现摘要

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `PanelMode` 增加 `readonly-live`；`panel/state` 增加 `contextSessionId` / `breadcrumb`；W→H `nav/open-subagent` / `nav/back` / `action/pin-subagent`；`RejectSendReason` 增加 `readonly-live` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `resolvePanelProjection`；导航/钉路由；effective session 的 replace/append/status/send gate |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 薄 HTML：subagent 卡片点击、面包屑返回、钉 Tab、`readonly-live` composer 禁用 |
| `apps/vscode-dsh/src/chat-panel/index.ts` | 导出 `PanelBreadcrumb` / `PanelProjection` |
| `apps/vscode-dsh/src/conversation-registry.ts` | `contextSessionId` / `pinnedSubagent` + setter |
| `apps/vscode-dsh/src/conversation-controller.ts` | subagent 卡片投影、banner、`openSubagentContext` / `navBack` / `pinSubagent` / `resolvePanelProjection`；删除父不清子权威 |
| `apps/vscode-dsh/src/extension-index.ts` | `OpenTabRecord.pinnedSubagent` |
| `apps/vscode-dsh/src/message-store.ts` | `childSessionId` / `subagentStatus`；`patchWhere` |
| `apps/vscode-dsh/src/timeline-store.ts` | 公开 `getParent` / `childrenOf` |
| `apps/vscode-dsh/src/extension.ts` | panel deps 接导航；L2 hooks `dsh.test.openSubagent|navBack|pinSubagent|injectSubagent` |
| `apps/vscode-dsh/package.json` | 注册上述 test 命令 |
| `apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts` | **新建** VP-4-sub L2/L3（FakeWebview） |
| `.specdev/.../phase-4-subagent-enter-pin/test-scripts/run-phase4-l2-l3.sh` | **新建** AC-54/84 脚本门禁 |
| `.cursor/skills/project-test/SKILL.md` | Phase 4 测试知识 |
| `.cursor/skills/project-build/SKILL.md` | Phase 4 构建知识 |

未改：`packages/core/agent-loop`。

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-35** | `subagent.started` → 父 MessageStore `kind:'subagent'` 卡片；`nav/open-subagent` → `openSubagentContext` → `messages/replace` 子会话 |
| **AC-36** | `nav/back` 清除 `contextSessionId`（或从钉 Tab 切回父 Tab） |
| **AC-37** | 默认路径只写 `contextSessionId`，`registry.list().length` 不变 |
| **AC-39** | 父为当前上下文时 `ui/banner`「子代理运行中」；`subagent.finished` 清除 banner 并将卡片改为「已结束，可进入回放」 |
| **AC-40/71** | 运行中进入 → `readonly-live` + composer reject；结束后 hydrate → `replay` |
| **AC-38/79** | `action/pin-subagent` 创建子 Tab（`pinnedSubagent`）、清 context、恢复父视图 |
| **AC-78** | 已有子 Tab 时 `openSubagentContext` → `switchTo` 子 Tab，不设 context |
| **AC-74** | `index.isDeleted(child)` → 卡片「子会话已删除」/ `outcome:'deleted'`，不进入 |
| **AC-75** | 父 tombstone 后子投影 `breadcrumb.parentDeleted`；`nav/back` 返回 `disabled` |
| **AC-54/84** | `phase4-subagent-enter-pin.spec.ts` + `run-phase4-l2-l3.sh`（FakeWebview L3） |

## 测试结果（命令 + 输出）

```text
PATH=.../node/24.3.0/bin:$PATH ./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts
# Test Files  1 passed (1)  |  Tests  12 passed (12)

PATH=.../node/24.3.0/bin:$PATH ./node_modules/.bin/vitest run apps/vscode-dsh/tests
# Test Files  20 passed (20)  |  Tests  92 passed (92)

PATH=.../node/24.3.0/bin:$PATH ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0

bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/run-phase4-l2-l3.sh
# vitest 12/12 + tsc 0
```

## 偏差记录

### 偏差 1：父删不关闭已钉子 Tab

- **偏差描述**：`deleteConversation` / `deleteSession` 在标记父 tombstone 后**保留**已打开的子 Tab，仅清除指向该 session 的 `contextSessionId`；不 `markDeleted` 子会话。
- **影响范围**：spec.md「父子已删」AC-75；design.md AD-CU-3 / AC-61；repo-exploration §4 Path C 曾建议「close pinned child Tabs」。
- **原因**：AC-75 要求子视图仍可展示「父会话已删除」禁用面包屑；若父删时关掉子 Tab，该导航 UX 无法成立。权威仍不级联（AC-61）。
- **影响**：下游若期望「父删即关子 Tab」，需另开产品决策；当前以 AC-75 为准。

## 债务

无新建 `@STUB` / 无活跃债务 ID。
