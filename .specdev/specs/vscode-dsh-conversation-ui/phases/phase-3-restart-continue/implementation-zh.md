# Phase 3 实现摘要（MUST-FIX loop 2）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/conversation-controller.ts` | `restoreMoreTabs`：`openFromHistory` 非 `opened`/`activated` 时把已取出行 `push` 回 `deferredRestore`，再 `persistOpenTabs` |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | 回归：查看更多 + 读失败 → deferred 保留 → 二次冷启动仍见该 session |
| `.specdev/specs/vscode-dsh-conversation-ui/tech-debt-registry.md` | DEBT-006 已解决说明补充 restore-more 失败回填 |
| `.cursor/skills/project-test/SKILL.md` / `project-build/SKILL.md` | 记录 loop 2 验证命令与结果 |

未改 `packages/core/agent-loop`。未 git commit。

## 对每个验收标准的实现说明

| 项 | 说明 |
|----|------|
| **Must-Fix：`restoreMoreTabs` 读失败不丢索引** | `shift`/`splice` 取出后，若 outcome 为 `error` / `host-not-ready` / `missing` 等非成功，将 `{ ...record }` 推回 `deferredRestore`；随后 `persistOpenTabs` 仍合并 deferred → 耐久 `openTabSet` 保留该 session |
| **回归** | N=1 恢复出 deferred → `failMoreReads` 后 `restoreMoreTabs()` → `deferredSessionIds===['sess-more']` 且 index 仍含两行 → 新 controller 冷启动仍见 `sess-more` |

## 测试结果（命令 + 输出）

```text
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-restart-continue.spec.ts
# Tests  13 passed (13)

PATH=... ./node_modules/.bin/vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts
# Test Files  20 passed (20); Tests  95 passed (95)

bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-3-restart-continue/test-scripts/run-phase3-l2-l3.sh
# Tests  29 passed (29)

PATH=... ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0
```

实现前单独跑回归用例：`deferredSessionIds` 期望 `['sess-more']` 实际 `[]`（FAIL）；修复后 PASS。

## 偏差记录

无。与 review Must-Fix / AC-70 / AD-CU-10（未进 UI ≠ 丢索引）一致。
