# Phase 3 实现摘要 — GAP-005..009 债务修复（中文）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/session-host.ts` | 新增 `onError` / `notifyError`；传输死亡时通知 Extension |
| `apps/vscode-dsh/src/extension.ts` | 订阅 `onError` → `showErrorMessage`；补齐 InputBox / createQuickPick 类型 |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | 向 UI 传入 AbortSignal；新增按 session 的 `failClosedSession` |
| `apps/vscode-dsh/src/interaction-ui.ts` | abort 时 hide QuickPick；无 options 用 InputBox 收集自由文本 |
| `apps/vscode-dsh/src/conversation-controller.ts` | 关 Tab 先 fail-closed 该会话交互再 dispose |
| `apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts` | 新增 GAP-005..009 测试（含 questions 集成） |
| `apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts` | fake host 适配 failClosedSession；顺序断言更新 |
| `.specdev/specs/vscode-dsh-ide/tech-debt-registry.md` | GAP-005..009 标为已解决 |

## 对各 GAP 的实现说明

| ID | 说明 |
|----|------|
| GAP-005 | 传输/子进程死亡后 Extension 弹明确错误消息，不只写 status |
| GAP-006 | fail-closed 时强制关闭已打开的 QuickPick |
| GAP-007 | 产品树增加与 approval 对称的 questions 集成用例 |
| GAP-008 | 无选项提问用 InputBox 收集 `custom` |
| GAP-009 | 关 Tab 按 session 取消未结算 Host 交互（AD-5） |

## 测试结果

```
PATH=…/node/24.3.0/bin:$PATH ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/ packages/ide/ide-bridge/tests/ide-bridge.spec.ts
→ Test Files  9 passed (9) / Tests  41 passed (41)
```

## 偏差记录

无。

## 债务

GAP-005..009 已全部移入「已解决」；活跃债务表为空。
