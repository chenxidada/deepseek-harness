# 正确性审查 — Phase 3（`phase-3-interaction-fail-closed`）

## 视角
**实现正确性** — 代码是否真正可工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-10 | 审批/提问关联到正确会话/Tab，应答不落到错误会话 | `apps/vscode-dsh/src/interaction-coordinator.ts` 的 `resolveTabId` / `handleApproval`；`conversation-controller.ts` 构造时 `setConversationRegistry` | ✅ | 经 `getBySessionId` 注入 `tabId`；应答按 bridge `id` 回传，不按当前 active Tab。集成测试断言绑定 `tabB` 而非 `tabA`；Host 集成断言 `request.tabId === tab.tabId` |
| AC-16 | `approval/request` → Host 展示 → 合法 `ApprovalOutcome` | `packages/ide/ide-bridge/src/index.ts` 的 `awaitHostApproval`；`session-host.ts` 的 `onBridgeFrame`；`interaction-ui.ts` 的 `presentApproval` | ✅ | 不再恒返回 `unavailable`：已连接时发送 `approval/request` 并用 `raceInteraction` 等待 `approval/response`。合法 outcome 映射；非法 outcome 由 `validateBridgeFrame` 拒收。测试覆盖合法往返 + fake-runtime Host 往返 |
| AC-17 | `user-questions/request` → Host 展示 → 合法 `AskUserQuestionAnswer` | ide-bridge 的 `awaitHostQuestions`；`interaction-ui.ts` 的 `presentQuestions`；`session-host.ts` 提问分支 | ✅ | 已连接时真实 Host 往返；非法 answer → `NO_PROVIDER`。ide-bridge 单测覆盖成功路径。Extension 成功往返缺少独立集成用例（见 Should-Fix） |
| AC-19 | 断连/超时/抛错/非法结局 fail-closed，不静默放行 | `awaitHostApproval` / `awaitHostQuestions`；`failClosedApprovals`；`validate.ts` | ✅ | 未连接 → `unavailable` / `NO_PROVIDER`；超时 → `unavailable`；断连 settle pending → `unavailable`；**不**调用 `next()`。非法 outcome/answer 入站被拒，最终靠超时 fail-closed（非放行） |
| AC-20 | 等待人类应答期间瀑布阻塞至合法结局或 fail-closed | `awaitHostApproval` / `awaitHostQuestions` 返回未结算 Promise | ✅ | waterfall listener 返回 Promise；合法往返测断言 `nextCalled === false`，且等到 Host 响应后才 settle |
| AC-21 | PermissionPicker → Host 应用 `permission-presets` | ide-bridge 的 `handlePermissionSelect` → `presets.set`；`extension.ts` 的 `dsh.selectPermissionPreset`；`pickPermissionPreset` | ✅ | 仅调用 `permissionPresets.set`；未知 preset / 缺服务 → `ok:false`。单元测断言 `applied`；e2e 经 Host RPC list/select |
| AC-22 | 不引入第二套权限权威 | `apps/vscode-dsh/src/**` 无 `setPolicy`/`setApprovalPolicy` 旁路；bridge 只 `ctx.get(permissionPresets)` | ✅ | Extension 只经 bridge RPC；runtime 写入口唯 `presets.set` |
| AC-30 | SDK 传输关闭/子进程退出 → 终止 UI 等待、错误态、fail-closed | `session-host.ts` 的 `watchTransport` / `onTransportDeath` / `bridge.onDisconnect` / `failClosedAll` | ⚠️ | UI 等待经 `AbortController` 竞态终止；已写入 `status='error'` 与 `errorMessage`/`getLastError`。Extension **未**在异步 transport death 时调用 `showErrorMessage`；已打开的 QuickPick **未**被强制关闭（见 Should-Fix）。e2e：`FAKE_EXIT_AFTER_MS` 后 pending 清空且 lastError 有值 |
| AC-31 | 校验 Host bridge 入站载荷；非法不得未定义放行 | `validate.ts` 的 `validateBridgeFrame`；`ndjson.ts` 的 `parseBridgeFrame` | ✅ | 未知 kind / 非法 outcome / 畸形 answer → `undefined`（丢弃）。测试覆盖 `allow-all`、非 string selected 等 |
| AC-33 | ≥1 集成 + ≥1 独立 e2e | `interaction-fail-closed.integration.spec.ts`；`interaction-fail-closed.e2e.spec.ts`；`ide-bridge.spec.ts` | ✅ | 集成：Tab 关联 + Host approval 往返；e2e：permission RPC + 子进程退出 fail-closed。本地 `vitest`：8 个文件 / 33 个用例通过 |

## 桩代码检测

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | `packages/ide/ide-bridge/src/index.ts` approval answerer | ✅ 已解决 | 已移入「已解决」；代码为真实 Host 往返 + 超时/断连 fail-closed，**不是**恒 `unavailable` |
| STUB-002 | `packages/ide/ide-bridge/src/index.ts` user-questions answerer | ✅ 已解决 | 已移入「已解决」；已连接时 Host 往返；仅断连/超时/未连接才 `NO_PROVIDER` |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | 未发现 `@STUB` / 空壳冒充完成逻辑 |

## 关键发现

### 🔴 Must-Fix
- （无）— STUB-001/002 已填实；成功路径有真实 Host 往返；fail-closed 路径有实际逻辑与测试。

### 🟡 Should-Fix
1. **AC-30 用户可见错误展示不完整**：`IdeSessionHost.onTransportDeath` 会写入 `status='error'` / `errorMessage`，但 `extension.ts` 没有订阅/轮询去调用 `showErrorMessage`。子进程异常退出后，用户可能只看到卡住的 QuickPick，看不到明确错误态。建议在 transport death / bridge disconnect 时由 Extension 展示 `errorMessage`（或状态栏）。
2. **failClosedAll 不取消已打开的 QuickPick**：`Promise.race` 会 settle Host 侧等待，但 `showQuickPick` 没有 abort 句柄，面板可能仍挂起直到用户手动关闭。建议向 UI 注入可取消信号，或在 fail-closed 时关闭/替换 QuickPick。
3. **AC-17 Extension 成功路径缺集成覆盖**：fake-runtime 已实现 `FAKE_EMIT_QUESTIONS_SESSION`，但没有对应的 Host→UI→response 集成测试（仅 approval 有）。建议补一条 questions 往返集成，与 approval 对称。
4. **无 options 的提问仅有 `(skip)`**：`presentQuestions` 在 `options.length === 0` 时无法收集 `custom` 自由文本（无 InputBox）。答案形状合法，但自由文本提问体验不完整。

### 🟢 Observations
- AD-4 终端 answerer：approval/questions 均不调用 `next()`；失败返回 `unavailable` / `UserQuestionError(NO_PROVIDER)`。
- 非法 `approval/response` outcome 在校验层被丢弃后，pending 依赖超时 fail-closed（默认可达 120s）；语义正确，但可考虑按 `id` 立即 settle 为 `unavailable` 以缩短失败延迟。
- 偏差（QuickPick 呈现、`presets.set` vs live `setPolicy`）不影响本视角「函数体真实性 / fail-closed」结论；live agent 旁白差异已记入 implementation 偏差 2。
- 本地复跑：`vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts apps/vscode-dsh/tests/` → **8 passed / 33 passed**。
