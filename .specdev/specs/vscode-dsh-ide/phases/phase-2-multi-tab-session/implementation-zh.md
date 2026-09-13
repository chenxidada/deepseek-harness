# Phase 2 实现摘要（债务修复回路：GAP-003 / GAP-004）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/conversation-controller.ts` | GAP-003：`closeConversation` 先 `await host.disposeSession`，成功后再 `registry.close` |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` | GAP-004：`getTreeItem` 设置 `command: dsh.switchConversation` + `arguments: [tabId]` |
| `apps/vscode-dsh/src/extension.ts` | `dsh.switchConversation` 接受可选 `tabId`（TreeView 点击直切）；无参仍走 QuickPick |
| `apps/vscode-dsh/README.md` | 文档：切换可通过 TreeView 点击或 QuickPick |
| `apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts` | **新增**：GAP-003/004 回归测试（4 cases） |
| `.specdev/specs/vscode-dsh-ide/tech-debt-registry.md` | GAP-003/004 → 已解决；STUB-001/002 保持活跃 |
| `.cursor/skills/project-test/SKILL.md` | 记录 debt-fix 测试命令与 verifier V-U3/U4 过期提示 |

**未改动（禁止范围）**：ide-bridge approval/questions stubs（STUB-001/002）、Phase 3 交互 UI。

## 对每个验收标准的实现说明

| AC / Gap | 实现 |
|----------|------|
| **GAP-003**（AC-8 失败路径） | `closeConversation` 先 `registry.get(tabId)` → `await disposeSession(sessionId)` → 仅成功后 `registry.close(tabId)`。dispose 抛错时 Tab 仍在注册表，可重试关闭。 |
| **GAP-004**（AC-7 TreeView UX） | Tab bar `TreeItem.command` 指向 `dsh.switchConversation` 并传入 `tabId`；Extension 命令在收到 string tabId 时直接 `controller.switchConversation(tabId)`，否则保持原 QuickPick。 |
| AC-6/7/9/11/15 成功路径 | 无行为回归；既有 multi-tab / dispose e2e 仍通过。 |
| STUB-001/002 | **未实现**（目标 Phase 3）。 |

## 测试结果（命令 + 输出）

### TDD：先失败再修复

```text
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
./node_modules/.bin/vitest run apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts
# 修复前：4 failed（预期）
```

### 修复后全套

```text
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
./node_modules/.bin/vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts
# Test Files  6 passed (6)
# Tests       21 passed (21)
# （原 17 + 新增 GAP 债务修复 4）
```

覆盖点：
- dispose 进行中 Tab 仍在 registry
- dispose 失败 Tab 保留（可重试）
- 成功路径顺序：`dispose` → `close`
- TreeItem.command === `dsh.switchConversation` 且 arguments 为各 tabId

## 偏差记录

无。实现与 verification.md 对 GAP-003/004 的预期一致；未触及 STUB-001/002。

**下游注意**：既有 `verifier-independent-unit.mts` 的 V-U3/V-U4 仍断言「gap 存在」；下次 verifier 重跑前需把断言改为验证「gap 已关闭」。

## 债务注册

- GAP-003、GAP-004 → `tech-debt-registry.md`「已解决」
- STUB-001、STUB-002 → 仍在「活跃债务」（Phase 3）
