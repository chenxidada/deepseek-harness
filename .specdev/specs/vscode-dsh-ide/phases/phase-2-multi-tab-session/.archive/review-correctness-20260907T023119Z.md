# Correctness Review — Phase 2 (phase-2-multi-tab-session)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-6 | 新建对话 → 新 Tab + 可区分 `sessionId` | `conversation-registry.ts:50-64` `extension.ts:109-117` | ✅ | `create()` 用 `randomUUID()` 分别铸造 `tabId`/`sessionId`，写入 Map 并设为 active；`dsh.newConversation` 调用 `controller.newConversation` |
| AC-7 | 切换 Tab → 输入目标切到绑定会话，不串会话 | `conversation-controller.ts:40-42,60-72` `session-host.ts:150-153` | ✅ | `switchTo` 只改本地 active 指针；`promptActive` 仅对 `getActive().sessionId` 调 `host.prompt`；集成测试断言两条 prompt 日志 `sessionId` 与 Tab A/B 一一对应 |
| AC-8 | 关 Tab → 默认结束会话 + 更新 Tab 栏 | `conversation-controller.ts:49-53` `session-host.ts:160-188` `ide-bridge/src/index.ts:115-142` `sdk/server/src/server.ts:207-221` | ⚠️ | 成功路径完整：registry `close` → bridge `session/dispose` → `sdkSessionDispose` → Map delete + `handle.dispose()`；README 文档化 Q-3。但 **本地 Tab 在 dispose 成功前已删除**（见 Must/Should-Fix） |
| AC-9 | 同工作区 ≥2 对话 Tab | `conversation-registry.ts` + 集成测试 | ✅ | 注册表支持多 Tab；`multi-tab-session.integration.spec.ts` 创建两个 Tab 并切换 prompt |
| AC-11 | Tab 标题可用首条用户消息摘要 | `conversation-registry.ts:207-212` `conversation-controller.ts:67-70` | ✅ | `titleFromFirstMessage` 有真实 trim/截断逻辑；首次 `promptActive` 在无 title 时写入；单元 + 集成覆盖 |
| AC-15 | 扩展不重实现 agent-loop / 工具 / 持久化权威源 | `apps/vscode-dsh/src/*`（仅路由/投影） | ✅ | Extension 只做 registry + Host `prompt`/`disposeSession`；无 agent-loop/工具执行/持久化实现；stdout 无 `session/close`（protocol 侧仍无该方法） |
| AC-33 | ≥1 集成 + ≥1 独立 e2e | `multi-tab-session.integration.spec.ts` `multi-tab-dispose.e2e.spec.ts` | ✅ | 本机 `vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts` → **5 files / 17 tests passed** |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | `packages/ide/ide-bridge/src/index.ts` approval listener | ⚠️ Known | 仍 `Promise.resolve('unavailable')`；目标 Phase 3 — **不判 MUST-FIX** |
| STUB-002 | `packages/ide/ide-bridge/src/index.ts` questions listener | ⚠️ Known | 仍 `UserQuestionError`/`NO_PROVIDER`；目标 Phase 3 — **不判 MUST-FIX** |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | Phase 2 主路径（registry / prompt / dispose / TreeView）均为真实逻辑，未发现空壳 |

## 关键发现

### 🔴 Must-Fix
无。所有 Must AC 在成功路径上有可追踪的真实实现与测试证据；STUB-001/002 按任务说明不计入本 Phase MUST-FIX。

### 🟡 Should-Fix

1. **关 Tab 时先本地删除再 await dispose（AC-8 失败路径不一致）**  
   - 位置：`conversation-controller.ts:49-53`  
   - 现状：`registry.close(tabId)` 先移除 Tab 并刷新栏，再 `await host.disposeSession(...)`。  
   - 问题：若 bridge 超时 / 无连接 / runtime 返回 `ok: false`，`extension.ts` 的 `dsh.closeConversation` 会 `showErrorMessage`，但 Tab 已从 registry 消失，运行时会话可能仍存活，用户无法从 UI 重试关闭该 `sessionId`。  
   - 建议：先 `disposeSession` 成功后再 `registry.close`；或 dispose 失败时把 Tab 写回 registry（并保持 active 合理）。

### 🟢 Observations

- `IdeSessionHost.disposeSession` 有超时、`bridgeHello` 门闩、pending map、shutdown 时 reject — 错误路径有实际逻辑，非空 catch。
- `HarnessSdkJsonRpcServer.disposeSession` 先 `sessions.delete` 再 `handle.dispose()`，正确规避 zombie `assertLiveAgent` 路径；`packages/sdk/server/tests/server.spec.ts` 本环境因 `zstdCompress` 不可用未能加载整套 suite，但函数体逻辑与 ide-bridge 集成测试（mock `sdkSessionDispose`）可交叉佐证。
- Tab 栏以 TreeView + QuickPick 实现切换（implementer 已记偏差）；TreeView 未绑定 selection→switch，切换依赖命令 — 不影响 AC-7 可验证性。
- `SDK_SESSION_DISPOSE_SERVICE` 在 ide-bridge 与 sdk-server 各定义一份，字符串均为 `'sdkSessionDispose'`，运行时匹配。

## 测试复核（本审查独立执行）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts
# Test Files  5 passed (5)
# Tests       17 passed (17)
```
