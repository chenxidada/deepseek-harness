# Phase 1 实现摘要 — phase-1-auto-start-orchestrator（MUST-FIX loop 1）

## 本轮 Must-Fix 关闭说明

**问题（review MUST-FIX）：** `dsh.deleteHistory` / `deleteHistorySession` 在 Host 未连时仅 `return { outcome: 'host-not-ready' }`，无用户可见提示 → 违反 AC-1e / AD-CR-9「禁用或提示 / 不静默失败」。

**修复：**
1. `deleteHistorySession` 与 `runDeleteActive` 对齐：
   - `conversations === undefined` → `showErrorMessage('Host 连接后可删除')` + `host-not-ready`
   - `deleteSession` 返回 `host-not-ready`（Host 已断但 controller 仍绑定）→ 同款提示，不假删、不调用 Orchestrator Start
   - 缺 `sessionId` → 信息提示「No history session to delete.」，返回 `missing`（不再误标 `host-not-ready`）
2. L2：`phase1-auto-start.spec.ts` 新增 `AC-1e: offline deleteHistory …`（断言提示文案 + `IdeSessionHost.start` 调用=0 + orchestrator idle + 无 Tab 假删）
3. README 命令表补 `dsh.deleteHistory` 离线文案，与矩阵一致

**关闭判定：** Must-Fix #1 已关闭（提示路径 + L2）。未改菜单 `when` 禁用（与 `deleteConversation` 同策略：可点但明确提示）。

## 变更清单（文件列表）

### 本轮（loop 1）
- `apps/vscode-dsh/src/extension.ts` — `deleteHistorySession` 离线 UX
- `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` — AC-1e `deleteHistory` L2
- `apps/vscode-dsh/README.md` — `dsh.deleteHistory` 离线说明

### 前轮已交付（仍有效，未回退）
- `apps/vscode-dsh/src/auto-start-orchestrator.ts`
- `apps/vscode-dsh/src/connection-ui.ts`
- `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts`
- `apps/vscode-dsh/src/chat-panel/*`（connectionPhase 缝）
- `apps/vscode-dsh/package.json`（showPanel / settings / statusBar）
- `.specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md`（STUB-001 / DEBT-001）

### 未改
- `packages/core/**/agent-loop*`（AC-26）

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| AC-1 | Orchestrator `request` 经活动栏 / 可见性 / 启动·发送 / 状态栏；已连复用 |
| AC-1a | activate 仅注册；L2 spy `start`=0 |
| AC-1b | `openActivityBar` → reveal + request（生产信号见偏差 2） |
| AC-1c | README 矩阵；查询/删除不完整建连 |
| AC-1d | FSM 六态；L1 并发 / Stop-during-starting |
| AC-1e | **本轮关闭 Must-Fix：** `deleteConversation` + `deleteHistory` 离线均提示「Host 连接后可删除」；不 Start；不假删 |
| AC-2 | failed 面板 + 状态栏；缺凭据设置深链 |
| AC-5 | Host 单例 |
| AC-6a | disconnect → retry-once |
| AC-7 切片 | L2 反向 + 凭据 + showPanel |
| AC-13 | connecting 投影缝（专用 L2 仍属 Should-Fix） |
| AC-14 | failed 投影 + retry/settings |
| AC-25/26 | Webview 跟 panel/state；未改 agent-loop |

## 测试结果（命令 + 输出）

```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts
# Test Files  2 passed (2)
# Tests  13 passed (13)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests
# Test Files  21 passed (21)
# Tests  93 passed (93)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0
```

## 偏差记录

### 偏差 1 — Start 成功路径仍绑定 restore/New
- **偏差描述**：`StartHostPort.start` 成功后仍调用 `restoreOpenTabSet` + 空则 `newConversation`。
- **影响范围**：spec.md §不在本 Phase 范围 / design.md AD-CR-3
- **原因**：完整 AutoReady 属 phase-2（DEBT-001）
- **影响**：phase-2 拆出；仅激活仍不 New（AC-1a）

### 偏差 2 — 活动栏打开的产品信号
- **偏差描述**：生产「点击活动栏」无独立事件时，主要依赖 Conversation 可见性 / test hook / 状态栏。
- **影响范围**：spec.md AC-1b；design.md AD-CR-2（review Should-Fix，本轮未改）
- **原因**：repo-exploration R8
- **影响**：L2 仍证明 reveal+request

## 债务

见 `tech-debt-registry.md`：STUB-001、DEBT-001（本轮无新增桩；无已解决项变更）。

## Should-Fix（本轮未做，非门禁）

1. AC-1b 生产活动栏信号加强
2. AC-13 connecting 专用 L2
3. Webview `action/continue` 走 `ensureHostForSend`
