# Phase 1 实现摘要 — phase-1-auto-start-orchestrator

## 变更清单（文件列表）

### 新增
- `apps/vscode-dsh/src/auto-start-orchestrator.ts` — Start-reason FSM（idle/starting/pending-start/started/disconnected/failed）
- `apps/vscode-dsh/src/connection-ui.ts` — ConnectionUi 投影 + `AutoReadyLatchSeam`（phase-2 stub）
- `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` — L1 FSM（并发、retry-once、onUserStop 飞行态、缺凭据）
- `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` — L2 集成（AC-1a 反向、离线删除、凭据失败、AC-1b、无 workspace）

### 修改
- `apps/vscode-dsh/src/extension.ts` — Orchestrator 接线；cwd 降级；触发边界；showPanel/settings/statusBar；test 钩子门闩；离线删除文案
- `apps/vscode-dsh/src/chat-panel/protocol.ts` — `connectionPhase` / retry / open-settings 协议缝
- `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` — `applyConnectionState` + retry/settings 动作
- `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — `onDidChangeVisibility` + reveal hooks；连接按钮 HTML
- `apps/vscode-dsh/src/chat-panel/index.ts` / `src/index.ts` — 导出
- `apps/vscode-dsh/package.json` — 新增 `dsh.showPanel` / `dsh.openExtensionSettings` / `dsh.statusBarAction`；移除生产 contributes 中的 `dsh.test.*`
- `apps/vscode-dsh/README.md` — Auto-start 命令矩阵 + 设置前缀 + test 钩子说明
- `.specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md` — STUB-001 / DEBT-001

### 未改
- `packages/core/**/agent-loop*`（AC-26）

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| AC-1 | `orchestrator.request(reason)` 经活动栏 / 可见性 / 启动·发送命令 / 状态栏；已连复用 |
| AC-1a | `activate` 仅注册；L2 `simulateStartupOnly` + spy `IdeSessionHost.start` 调用=0 |
| AC-1b | `onActivityBarOpened` → reveal Conversation（`show`/`focus`）+ `request('activity-bar')` |
| AC-1c | README 矩阵；查询/删除路径不调完整建连；发送类经 `ensureHostForSend` |
| AC-1d | FSM 六态含 `disconnected`；并发 pending；L1 覆盖 |
| AC-1e | 离线删除提示「Host 连接后可删除」；不 Start；不假删 |
| AC-2 | failed → panel `connectionPhase` + 不可见时 StatusBar→`dsh.statusBarAction`/`showPanel`；缺凭据 `dsh.openExtensionSettings`；Toast 仅次要 |
| AC-5 | 单例 `host` + in-flight 禁止并行 Start；`hostCreateCount` 可观测 |
| AC-6a | `onUnexpectedDisconnect` → `disconnected` + retry-once；再断线保持 manual |
| AC-7 切片 | L2 反向 + setCredentialPresence + showPanel |
| AC-13 | starting → ConnectionUi `connecting` → panel banner/state |
| AC-14 | failed/disconnected-manual 投影 + Retry / Open settings |
| AC-25/26 | Webview 跟 panel/state；未改 agent-loop |

## 测试结果（命令 + 输出）

```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts
# Test Files  2 passed | Tests  12 passed

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests
# Test Files  21 passed | Tests  92 passed
```

## 偏差记录

### 偏差 1 — Start 成功路径仍绑定 restore/New
- **偏差描述**：`StartHostPort.start` 成功后仍调用 `restoreOpenTabSet` + 空则 `newConversation`（前序行为暂留）。
- **影响范围**：spec.md §不在本 Phase 范围 / design.md AD-CR-3；AC-1a 仍由「仅激活不 Start」保证。
- **原因**：完整 AutoReady 属 phase-2；repo-exploration R11 允许暂留。
- **影响**：phase-2 须拆出 restore/New（登记 DEBT-001）。可见性触发 Start 后仍可能 New（因绑在 Start），但 **仅激活绝不 New**。

### 偏差 2 — 活动栏打开的产品信号
- **偏差描述**：真实「点击活动栏图标」无独立 VS Code 事件时，产品路径用 Conversation 可见性 / `dsh.test.openActivityBar` / 状态栏；TreeView 可见性未全量挂钩。
- **影响范围**：spec.md AC-1b；design.md AD-CR-2。
- **原因**：repo-exploration R8 UNKNOWN。
- **影响**：L2 用 `openActivityBar` 证明 reveal+request；生产主要依赖 chat 可见性 + status bar。

## 债务

见 `tech-debt-registry.md`：STUB-001（AutoReadyLatchSeam）、DEBT-001（restore-on-start）。
