# Phase 3 实现摘要

## 变更清单（文件列表）

### 新增
- `apps/vscode-dsh/src/continue-capability.ts` — T-0b Gate + AD-CU-8 probe / top-bar chrome
- `apps/vscode-dsh/src/restore-planner.ts` — empty-strip + active-first UI cap N
- `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` — VP-3-restore / Diff / Continue L2+L3
- `packages/sdk/server/src/session-resume.ts` — `sdkSessionResume` capability
- `.specdev/specs/.../phases/phase-3-restart-continue/test-scripts/run-phase3-l2-l3.sh`

### 修改（ide-bridge / SDK — GAP-001）
- `packages/ide/ide-bridge/src/types.ts` — `session/resume` (+ response) / `session/continue-capability`；`SDK_SESSION_RESUME_SERVICE`
- `packages/ide/ide-bridge/src/validate.ts` — frame validation
- `packages/ide/ide-bridge/src/index.ts` — `handleResume` → `sdkSessionResume`；`handleContinueCapability`
- `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` — resume round-trip
- `packages/sdk/server/src/server.ts` — `resumeSession` → `agents.resume` + Map register
- `packages/sdk/server/src/index.ts` — publish `sdkSessionResume`

### 修改（Extension 产品）
- `apps/vscode-dsh/src/session-host.ts` — `resumeSession` bridge client
- `apps/vscode-dsh/src/conversation-controller.ts` — `restoreOpenTabSet` / `restoreMoreTabs` / `continueConversation`
- `apps/vscode-dsh/src/extension.ts` — startSession restore；`dsh.continueConversation`；L2 hooks
- `apps/vscode-dsh/src/replay-hydrator.ts` — `detectIncomplete` + notice「已停止/未完成」
- `apps/vscode-dsh/src/diff-entry.ts` — both Diff sides from log snapshots（禁工作区冒充）
- `apps/vscode-dsh/src/chat-panel/protocol.ts` — `action/continue` / `action/restore-more`；Continue chrome on `panel/state`
- `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` — Continue / 查看更多 / banner
- `apps/vscode-dsh/package.json` — command contributions
- `apps/vscode-dsh/README.md` — N / 查看更多 / Continue / empty Tab / Diff / dual-channel resume
- `apps/vscode-dsh/tests/timeline-diff.integration.spec.ts` — assert `rightScheme: dsh-diff`
- `.specdev/specs/vscode-dsh-conversation-ui/tech-debt-registry.md` — **GAP-001 → 已解决**

未改：`packages/core/agent-loop`；SDK stdout `createSession` 路径保持 create-only（Continue 走 bridge）。

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-33** | `restoreOpenTabSet`：空 Tab 剔除写回；一律 `mode=replay`；无自动 prompt |
| **AC-69** | Host 未连 → `waiting-host` latch；就绪后再 hydrate → `messages/replace` + `replay` |
| **AC-70** | `planRestoreOpenTabs`：index 全保留；UI 限 N；`restoreMoreTabs` / `action/restore-more` |
| **AC-34** | 活动 session 强制入 UI 集并 `switchTo` 聚焦 |
| **AD-CU-4** | 既有 `writeImmediate`；restore 写回 sanitized openTabSet；Continue/`setMode` 触发 `persistOpenTabs` |
| **AC-76 / AD-CU-6** | `recoverableDiffsFromMeta` 拒缺 oldText；`openTimelineDiff` 双侧 `dsh-diff`，spy 无 `Uri.file` |
| **AC-77** | `detectIncomplete` → message `incomplete` + notice「已停止/未完成」 |
| **AC-68 / AD-CU-8** | T-0b = `same-id`；`continueChromeFor` 四态；FAIL→hidden（常量路径） |
| **AC-32** | `continueConversation`：resume → 同 `tabId` `setMode(live)` |
| **AC-66** | same-id resume；不改写日志；follow-up 同 sessionId |
| **AC-67** | derive banner 路径保留（Gate 主路径 same-id）；`continueLink` / banner 钩子就绪 |
| **AC-54/84** | L2 hooks `dsh.test.restoreOpenTabs` / `diffAvailability` / `continue`；L3 FakeWebview `action/continue` |

## 测试结果（命令 + 输出）

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-3-restart-continue/test-scripts/run-phase3-l2-l3.sh
# Test Files 3 passed | Tests 24 passed

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts
# Test Files 20 passed | Tests 90 passed

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0
```

## 偏差记录

无功能性偏差。实现细节：
- **偏差描述**：Continue 主路径使用 SDK 侧 `sdkSessionResume`（与 dispose 对称），而非 ide-bridge 直接 `ctx.agents.resume`，以便把 AgentHandle 登记进 SDK session Map，后续 `session/prompt` 可复用。
- **影响范围**：spec.md Continue 映射 / design.md AD-CU-8 / GAP-001 落点
- **原因**：仅 `agents.resume` 而不登记 Map 会导致后续 prompt 走 create 并触发 `SessionAlreadyExistsError`（spike 已证）
- **影响**：下游仍经 bridge `session/resume`；未扩展 SDK stdout

## 已关闭债务

| ID | 说明 |
|----|------|
| **GAP-001** | bridge `session/resume` + `sdkSessionResume` → `agents.resume`；产品 Continue 已接线 |
