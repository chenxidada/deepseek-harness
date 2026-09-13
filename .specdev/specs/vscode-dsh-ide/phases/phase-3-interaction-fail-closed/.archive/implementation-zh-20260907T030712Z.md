# Phase 3 实现摘要 — 交互 fail-closed

## 变更清单（文件列表）

### `packages/ide/ide-bridge`
- `src/types.ts` — 收紧 approval/questions 类型；新增 `permission/select|list` 帧与服务键
- `src/validate.ts` — **新增** AC-31 严格帧校验
- `src/ndjson.ts` — `parseBridgeFrame` 改为严格校验
- `src/client.ts` — `onDisconnect` 用于 pending 交互 fail-closed
- `src/host.ts` — Host `onDisconnect`（AC-30）
- `src/index.ts` — 填实 STUB-001/002：真实 Host 往返 + 超时 + 断连；permission RPC
- `tests/ide-bridge.spec.ts` — 往返 / fail-closed / 校验 / permission 覆盖
- `README.md` / `README.zh.md` — 移除 Phase 3 stub 延期说明

### `apps/vscode-dsh`
- `src/interaction-coordinator.ts` — **新增** sessionId→Tab 关联 + abort 竞态 fail-closed
- `src/interaction-ui.ts` — **新增** 审批/提问 QuickPick + PermissionPicker
- `src/session-host.ts` — 入站审批/提问应答；permission RPC；传输死亡监视
- `src/conversation-controller.ts` — 绑定 registry；permission list/select API
- `src/extension.ts` — `dsh.selectPermissionPreset`；启动挂 InteractionUi
- `src/index.ts` — 导出交互模块
- `package.json` — 注册 permission 命令
- `tests/fixtures/fake-sdk-runtime.mjs` — 发出/记录审批、提问、权限；可选退出
- `tests/interaction-fail-closed.integration.spec.ts` — **新增** Tab 关联 + Host 往返集成
- `tests/interaction-fail-closed.e2e.spec.ts` — **新增** permission e2e + 子进程退出 fail-closed

### Spec / 债务
- `tech-debt-registry.md` — STUB-001/002 → 已解决

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-10** | `InteractionCoordinator` + `getBySessionId`；测试断言绑定正确 Tab |
| **AC-16** | bridge 转发审批并映射合法 `ApprovalOutcome` |
| **AC-17** | bridge 转发提问并返回 `AskUserQuestionAnswer` |
| **AC-19** | 未连接/超时/断连/非法 → fail-closed，不 `next()` |
| **AC-20** | 瀑布阻塞至合法结局或 fail-closed |
| **AC-21** | Host permission RPC → `permissionPresets.set` |
| **AC-22** | 无第二权限权威源 |
| **AC-30** | 传输关闭/子进程退出/Host shutdown → 终止 UI 等待 |
| **AC-31** | 严格入站帧校验 |
| **AC-33** | ≥1 集成 + ≥1 e2e |

## 测试结果（命令 + 输出）

```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts \
  apps/vscode-dsh/tests/
```

结果：`8` 个文件 / `33` 个测试全部通过。

## 偏差记录

### 偏差 1：Permission UI 使用 QuickPick，非独立 Webview Panel
- **偏差描述**：审批/提问/权限以 QuickPick 呈现。
- **影响范围**：spec.md 产出清单；design.md AD-8
- **原因**：AD-8 允许替换呈现；便于无 VS Code engine 的测试注入。
- **影响**：下游可换 Webview；线协议不变。

### 偏差 2：`permission/select` 走 `set` 而非 live `setPolicy`
- **偏差描述**：使用公开 `permissionPresets.set`。
- **影响范围**：design.md AD-6；repo-exploration.md §8
- **原因**：live `apply(..., setPolicy)` 为私有；公开权威是 `set`。
- **影响**：策略写入会话日志；live 旁白可能少于 Web `/permission`。见 package README。

### 偏差 3：未改 agent-loop / 未挂 Web ui-approval
- **偏差描述**：无（符合约束）。
- **影响范围**：spec.md 约束 / design.md AD-3
- **原因**：N/A
- **影响**：无
