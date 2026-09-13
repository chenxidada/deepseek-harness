# Correctness Review — Phase 2 (GAP-003 / GAP-004 debt fix)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

审查范围仅限 GAP-003（dispose 后再删注册表）与 GAP-004（TreeView command 接线切换）。STUB-001/002 为已注册 Phase-3 桩，不判 MUST-FIX。

## 逐条 AC 验证

本回路针对债务修复；与 GAP 直接相关的 AC 全量核对，其余 AC 确认无回归空壳。

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-6 | 新建对话分配可区分 sessionId | `conversation-registry.ts:create` / `conversation-controller.ts:newConversation` | ✅ | `create()` 为每个 Tab `randomUUID()` 生成独立 `tabId`+`sessionId`；本回路未改动 |
| AC-7 | 切换 Tab 不串会话 | `conversation-controller.ts:switchConversation` + `conversation-tab-bar.ts:getTreeItem` + `extension.ts:dsh.switchConversation` | ✅ | TreeItem 设置 `command: 'dsh.switchConversation'` 且 `arguments: [element.tabId]`；Extension 在 `typeof tabIdArg === 'string'` 时直接 `controller.switchConversation(tabIdArg)`，否则 QuickPick；`promptActive` 仍读 `getActive()` |
| AC-8 | 关 Tab 按默认策略结束会话 | `conversation-controller.ts:closeConversation` L51–56 | ✅ | `get(tabId)` → `await host.disposeSession(sessionId)` → 仅成功后 `registry.close(tabId)`；dispose 抛错则 Tab 保留可重试（GAP-003） |
| AC-9 | ≥2 Tab 同工作区 | `ConversationRegistry` + 既有 multi-tab 测试 | ✅ | 本回路未削弱多 Tab 能力；debt-fix 用例使用 2 Tab |
| AC-11 | Tab 标题 | `titleFromFirstMessage` / `setTitle` | ✅ | 本回路未改动；非空壳 |
| AC-15 | 不重实现 agent-loop / 持久化 | Extension 仅 registry + Host 路由 | ✅ | dispose 仍走 `IdeSessionHost.disposeSession` → bridge `session/dispose` |
| AC-33 | ≥1 集成 + ≥1 e2e | 既有 + `gap-003-004-debt-fix.spec.ts` | ✅ | 新增 4 个债务回归用例全部通过（见下） |
| **GAP-003** | dispose 失败路径保留 Tab | `closeConversation` L51–56 | ✅ | 失败用例断言 reject 后 `registry.get(drop.tabId)` 仍在；顺序用例断言 `dispose:` 先于 `close:` |
| **GAP-004** | TreeView 点击切换 | `conversation-tab-bar.ts` L91–101 | ✅ | `getTreeItem` 写入 command+arguments；测试断言两 Tab 的 `arguments[0]` 等于各自 `tabId` |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 | `ide-bridge/src/index.ts:apply` (approval) | ⚠️ Known | 目标 Phase 3；本回路未改；**不判 MUST-FIX** |
| STUB-002 | `ide-bridge/src/index.ts:apply` (user-questions) | ⚠️ Known | 目标 Phase 3；本回路未改；**不判 MUST-FIX** |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | GAP-003/004 相关路径均为真实 await / 赋值逻辑，非空壳 |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。核心失败路径（dispose 失败保留 Tab）与成功顺序（dispose→close）均有自动化覆盖；TreeItem command 接线有断言。

### 🟢 Observations
- `apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts`：4/4 通过（本审查实测 `vitest run …/gap-003-004-debt-fix.spec.ts`）。
- GAP-004 的 Extension 侧 `tabIdArg` 分支有真实逻辑，但无独立单元测试直接驱动 `extension.ts` 命令 handler；TreeItem → command 字符串/参数已覆盖，风险低。
- `implementation.md` 注明既有 verifier V-U3/U4 仍断言「gap 存在」——属下游 verifier 更新事项，不构成本回路实现错误。
- 并发对同一 `tabId` 双重 `closeConversation` 时两侧都会先 `get` 再 `dispose`（二次 dispose 行为依赖 Host）；非本债务范围，属边缘竞态，当前可接受。

## 函数体真实性（债务修复点）

| 符号 | 判定 | 摘录证据 |
|------|:--:|---------|
| `ConversationController.closeConversation` | ✅ 真实 | `await this.host.disposeSession(tab.sessionId)` 后才 `this.registry.close(tabId)`；无先行 close |
| `createConversationTabBar` → `getTreeItem` | ✅ 真实 | `item.command = { command: 'dsh.switchConversation', arguments: [element.tabId] }` |
| `extension.ts` `dsh.switchConversation` | ✅ 真实 | string `tabIdArg` → `controller.switchConversation`；否则 QuickPick |
| `extension.ts` `dsh.closeConversation` | ✅ 真实 | `try/await controller.closeConversation` + catch 展示错误（失败时 Tab 仍在，可重试） |
