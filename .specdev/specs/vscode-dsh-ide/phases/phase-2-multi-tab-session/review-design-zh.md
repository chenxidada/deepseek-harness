# 设计一致性审查 — Phase 2（GAP-003 / GAP-004 债务修复）

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## 审查范围

本轮仅审查 **GAP-003 / GAP-004** 债务修复相对 `design.md` **Q-3 / AD-5**（及本 Phase `spec.md` 约束）的一致性。STUB-001 / STUB-002（目标 Phase 3）按 registry 延期，**不判 MUST-FIX**。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **Q-3** 关闭 Tab 默认结束对应会话 | 是 | `closeConversation`：`registry.get` → `await host.disposeSession(sessionId)` → 成功后才 `registry.close`；dispose 失败时 Tab 仍在注册表可重试 | ✅ |
| **AD-5** 关 Tab：dispose 该 session 的 agent，再移除 Tab | 是 | 顺序为 dispose → close，与「结束会话」为主动作、本地 Tab 投影随后更新一致；未改为可恢复默认 | ✅ |
| **AD-5** 活动 Tab 决定输入目标；切换仅改本地指针 | 是 | TreeView `getTreeItem` 设 `command: dsh.switchConversation` + `arguments: [tabId]`；`extension` 有参时直接 `controller.switchConversation(tabId)`（→ `registry.switchTo`），无参仍 QuickPick；不切换 DSH 进程 | ✅ |
| **多会话生命周期** dispose 经 ide-bridge，不扩 SDK stdout | 是（本轮未改坏） | 仍走 `IdeSessionHost.disposeSession` → bridge `session/dispose`；本轮 diff 未触及 protocol / agent-loop | ✅ |
| **AD-1** 单进程多 `sessionId` | 是（本轮未改坏） | Controller / Tab 栏修复不引入 per-Tab 进程 | ✅ |
| STUB-001 / STUB-002 | 故意未实现 | registry 仍活跃，目标 `phase-3-interaction-fail-closed`；implementation 明确未改 approval/questions stubs | ✅ 延期（非缺陷） |

## 模块/命名/结构审查

### 目录合理性

| 文件 | 所在目录 | 是否合理 | 说明 |
|------|---------|:--:|------|
| `conversation-controller.ts` | `apps/vscode-dsh/src/` | ✅ | Host 路由 + registry；关 Tab 策略归属 Controller，符合既有划分 |
| `conversation-tab-bar.ts` | `apps/vscode-dsh/src/` | ✅ | Tab 栏投影层；点击切换属 UI 呈现（AD-8），不污染 registry |
| `extension.ts` | `apps/vscode-dsh/src/` | ✅ | 命令面接线：可选 `tabId` 与 TreeView `item.command` 对齐 |
| `gap-003-004-debt-fix.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 包级 tests/ 惯例 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 命令 id | `dsh.switchConversation` | 既有 `dsh.*` | ✅ |
| 关闭 API | `closeConversation` / `disposeSession` | Phase 2 既有命名；Q-3 语义清晰 | ✅ |
| TreeItem `contextValue` | `dshConversation` / `dshConversationActive` | Extension 前缀一致 | ✅ |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | Controller 拥有关闭顺序；Tab bar 只投影 + 绑定命令；Host 仍拥有 bridge dispose |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 本轮仅 Extension 侧；未引入核心→外围依赖 |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | Controller 仍经 `IdeSessionHost.disposeSession`；Tab bar 不直接碰 Host |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **GAP-003 与 Q-3/AD-5：** 修复前若先 `registry.close` 再 dispose，失败时本地已无 Tab、会话可能仍存活，偏离「关 Tab → 结束该 session」。dispose-first 与设计关闭路径一致。
- **GAP-004 与 AD-5：** TreeView 点击经同一 `switchConversation` 改活动指针，与「切换 Tab = 仅改本地活动指针与投影」一致；QuickPick 保留为无参命令路径，符合 AD-8 UI 可替换。
- **STUB-001 / STUB-002：** 仍指向 Phase 3，本审查不升级。
- **Verifier 断言：** implementation 注明既有 V-U3/V-U4 仍断言 gap 存在；属验证债，非设计违背。

## 摘要

GAP-003 / GAP-004 债务修复在设计一致性上 **PASS**：关 Tab 先 bridge dispose 再移除本地映射（Q-3 / AD-5），TreeView 点击经 `dsh.switchConversation(tabId)` 切换活动 Tab（AD-5），未触及 STUB 或 SDK stdout / agent-loop 禁区。
