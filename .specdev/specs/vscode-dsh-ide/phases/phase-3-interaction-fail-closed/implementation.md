# Phase 3 实现摘要 — GAP-005..009 债务修复

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/session-host.ts` | 新增 `onError` / `notifyError`；`onTransportDeath` 通知 Extension |
| `apps/vscode-dsh/src/extension.ts` | `startSession` 订阅 `host.onError` → `showErrorMessage`；`showInputBox` / `createQuickPick` 类型面 |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | UI 传入 `AbortSignal`；新增 `failClosedSession(sessionId)` |
| `apps/vscode-dsh/src/interaction-ui.ts` | `createQuickPick` + abort→`hide()`；空 options 走 `showInputBox` 收集 `custom` |
| `apps/vscode-dsh/src/conversation-controller.ts` | `closeConversation` 先 `failClosedSession` 再 `disposeSession` |
| `apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts` | **新增** GAP-005..009 覆盖（含 questions 集成） |
| `apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts` | fake host 补 `interactions.failClosedSession`；断言 failClosed→dispose→close 顺序 |
| `.specdev/specs/vscode-dsh-ide/tech-debt-registry.md` | GAP-005..009 → 已解决 |

## 对每个验收标准 / GAP 的实现说明

| ID | 实现 |
|----|------|
| **GAP-005** | `IdeSessionHost.onError(listener)`；`onTransportDeath` 在写入 `status='error'` / `errorMessage` / `failClosedAll` 后调用 `notifyError`。Extension `dsh.startSession` 订阅并 `showErrorMessage(\`DeepSeek Harness session error: ${message}\`)`。 |
| **GAP-006** | Coordinator 将 `abort.signal` 传给 `presentApproval` / `presentQuestions`。UI 优先 `createQuickPick()`，abort 时 `hide()`+settle；无 createQuickPick 时 race `showQuickPick`。 |
| **GAP-007** | `gap-005-009-debt-fix.spec.ts` 增加与 approval 对称的 questions Host→UI→response 集成：`FAKE_EMIT_QUESTIONS_SESSION` + `FAKE_QUESTIONS_LOG`，断言 Tab 绑定与 `selected:["yes"]`。 |
| **GAP-008** | `options.length===0` 时调用 `showInputBox`；非空文本写入 `custom`；取消/空白 → `selected:[]` 无 custom。 |
| **GAP-009** | `InteractionCoordinator.failClosedSession(sessionId, reason)` 仅 abort 该 session。`closeConversation` 顺序：failClosedSession → disposeSession → registry.close（他 session 不受影响）。 |
| **AC-30** | 传输死亡路径现同时：fail-closed pending、错误状态、用户可见 `showErrorMessage`、取消打开的 QuickPick。 |
| **AD-5** | 关 Tab 未结算 Host 交互按 session fail-closed。 |

## 测试结果（命令 + 输出）

```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/ \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts
```

```
Test Files  9 passed (9)
     Tests  41 passed (41)
```

聚焦债务套件：

```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts
```

（含于上述 41 通过内：GAP-005 onError、GAP-006 hide、GAP-007 questions 集成、GAP-008 InputBox、GAP-009 按 session abort）

## 偏差记录

无与 phase-3 `spec.md` / `design.md` 冲突的偏差。本轮为 verification/review 登记的 SHOULD-FIX（GAP-005..009）修复，未改变 AD-4/AD-5/AD-6 语义。

## 债务

- GAP-005、GAP-006、GAP-007、GAP-008、GAP-009 已从「活跃债务」移至「已解决」。
- 活跃表当前无条目。
