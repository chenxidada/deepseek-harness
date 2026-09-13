# Phase 3 实现摘要 — interaction fail-closed

## 变更清单（文件列表）

### `packages/ide/ide-bridge`
- `src/types.ts` — approval/questions 类型收紧；新增 `permission/select|list` 帧与服务键
- `src/validate.ts` — **新增** AC-31 严格帧校验（`validateBridgeFrame` / outcome / answer）
- `src/ndjson.ts` — `parseBridgeFrame` 改为走严格校验
- `src/client.ts` — `onDisconnect` 供 pending 交互 fail-closed
- `src/host.ts` — Host `onDisconnect`（AC-30）
- `src/index.ts` — 填实 STUB-001/002：真实 Host 往返 + 超时 + 断连；permission RPC
- `tests/ide-bridge.spec.ts` — 往返 / fail-closed / 校验 / permission 集成覆盖
- `README.md` / `README.zh.md` — 去掉 Phase 3 stub 延期说明

### `apps/vscode-dsh`
- `src/interaction-coordinator.ts` — **新增** sessionId→Tab 关联 + abort 竞态 fail-closed
- `src/interaction-ui.ts` — **新增** Approval / Questions QuickPick UI + PermissionPicker
- `src/session-host.ts` — 入站 approval/questions 应答；permission RPC；传输死亡监视
- `src/conversation-controller.ts` — 绑定 registry；permission list/select API
- `src/extension.ts` — `dsh.selectPermissionPreset`；启动时挂 InteractionUi
- `src/index.ts` — 导出交互模块
- `package.json` — 注册 permission 命令
- `tests/fixtures/fake-sdk-runtime.mjs` — 发出/记录 approval、questions、permission；可选自杀
- `tests/interaction-fail-closed.integration.spec.ts` — **新增** Tab 关联 + Host 往返集成
- `tests/interaction-fail-closed.e2e.spec.ts` — **新增** permission e2e + 子进程退出 fail-closed

### Spec / 债务
- `.specdev/specs/vscode-dsh-ide/tech-debt-registry.md` — STUB-001/002 → 已解决

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-10** | `InteractionCoordinator.resolveTabId` + `ConversationRegistry.getBySessionId`；UI 展示 Tab/session 提示；测试断言应答绑定 `tabB` 而非 `tabA` |
| **AC-16** | ide-bridge 发送 `approval/request`，阻塞瀑布直至 Host `approval/response`；Extension QuickPick 映射合法 `ApprovalOutcome` |
| **AC-17** | 同路径的 `user-questions/request` → `AskUserQuestionAnswer` |
| **AC-19** | 未连接 / 超时 / 断连 / 非法结局 → `unavailable` 或 `NO_PROVIDER`；**不** `next()` |
| **AC-20** | answerer 返回未结算 Promise，瀑布保持阻塞至合法结局或 fail-closed |
| **AC-21** | Host `permission/select` → `permissionPresets.set`；Extension `dsh.selectPermissionPreset` |
| **AC-22** | 无第二权限权威；仅调用 `permissionPresets` 服务 |
| **AC-30** | SDK subscribe 失败 / bridge disconnect / Host shutdown → `failClosedAll` 终止 UI 等待 |
| **AC-31** | `validateBridgeFrame` 拒绝非法 outcome / answer / 未知 kind |
| **AC-33** | ≥1 集成（Tab+approval 往返）+ ≥1 e2e（permission + child-exit） |

## 测试结果（命令 + 输出）

```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts \
  apps/vscode-dsh/tests/
```

结果：`Test Files  8 passed (8)` / `Tests  33 passed (33)`

覆盖要点：
- ide-bridge：合法往返、超时→unavailable、断连 fail-closed、非法 outcome 拒收、permission/select
- vscode-dsh：Tab 关联、abort fail-closed、fake-runtime approval 集成、permission e2e、子进程退出 e2e
- 回归：multi-tab、dispose、session-host、GAP-003/004

## 偏差记录

### 偏差 1：Permission UI 使用 QuickPick，非独立 Webview Panel
- **偏差描述**：ApprovalPanel / Questions UI / PermissionPicker 以 duck-typed `showQuickPick` 实现，而非 VS Code Webview 面板组件。
- **影响范围**：spec.md 产出清单「ApprovalPanel、Questions UI」；design.md AD-8（可替换呈现）
- **原因**：AD-8 允许替换呈现层；QuickPick 满足合法结局映射与 Tab 关联，且可在无 VS Code engine 的 Node 测试中注入。
- **影响**：下游可替换为 Webview；线协议与 fail-closed 语义不变。

### 偏差 2：`permission/select` 走 `permissionPresets.set`（日志写入），非 `/permission` 的 live `setPolicy`
- **偏差描述**：bridge 应用档位调用公开 `set(session, name)`，不复制命令处理器里的 `approval.setPolicy(agent, …)` 旁白注入。
- **影响范围**：design.md AD-6；repo-exploration.md §8
- **原因**：`apply(..., setPolicy)` 为服务私有；公开权威 API 是 `set`。AC-21/22 要求只经 permission-presets。
- **影响**：沙箱/审批策略仍写入会话日志；live agent 旁白消息可能略少于 Web `/permission` 路径。已记入 package README Known Limitations。

### 偏差 3：未改 `packages/core/**/agent-loop*` / 未挂 Web ui-approval
- **偏差描述**：无（符合约束）。
- **影响范围**：spec.md 约束 / design.md AD-3
- **原因**：N/A
- **影响**：无
