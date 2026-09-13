# 设计一致性审查 — phase-1-auto-start-orchestrator（Must-Fix 回路 1 复审）

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## AD-CR-9 / deleteHistory 对齐结论

**已对齐。** 上一轮 SHOULD-FIX（`deleteHistory` 离线静默 `host-not-ready`、与 `deleteConversation` 不对称）本轮已关闭：

| 检查项 | 证据 | 判定 |
|--------|------|:--:|
| 离线提示「Host 连接后可删除」 | `deleteHistorySession`：`conversations === undefined` 与 `deleteSession`→`host-not-ready` 均 `showErrorMessage('Host 连接后可删除')` | ✅ |
| 与 `runDeleteActive` 对称 | 同文案、同「可点但提示」策略；未改菜单 `when`（与 Conversation 删除一致） | ✅ |
| 不完整建连 / 不 Start | 路径不调 Orchestrator；L2 spy `IdeSessionHost.start`=0 | ✅ |
| 不假删权威 | 无 controller 时直接返回；有 controller 时仅在权威 `deleteSession` 成功后 `historyRefresh` | ✅ |
| 不静默失败 | 不再仅 `return { outcome: 'host-not-ready' }` | ✅ |
| README 矩阵 | 命令表 + Auto-start matrix 均写明 offline「Host 连接后可删除」 | ✅ |
| L2 | `AC-1e: offline deleteHistory …` 断言文案 + start=0 + idle + 无 Tab 假删 | ✅ |

AD-CR-9 允许「默认禁用 **或** 明确提示」——实现选择后者，与 `deleteConversation` 同一产品策略，符合决策字面与意图。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CR-1** AutoStartOrchestrator 纯逻辑 FSM；`StartHostPort` 注入；无 vscode 依赖 | 是 | `auto-start-orchestrator.ts` 六态 + 注入 port；零 vscode import | ✅ |
| **AD-CR-2** 触发 = 活动栏 / 视图可见 / 启动·发送 / 状态栏；activate 仅注册 | 是（活动栏生产信号弱，已记偏差） | activate 不 `request`；可见性 / start·send / status-bar 已接线；`onActivityBarOpened` 主要经 test hook + Conversation 可见性等价（偏差 2，本轮可接受） | ✅ |
| **AD-CR-3** 自动就绪与 Start 解耦（本 Phase 可留缝） | 是（本 Phase 边界） | STUB-001 / DEBT-001 → phase-2；AC-1a 仅激活不 New | ✅ |
| **AD-CR-4** 面板为主 + 状态栏 → showPanel；禁止唯一阻塞 Toast | 是 | `ConnectionUiController` 可见性路由；status-bar 可点 | ✅ |
| **AD-CR-5** 无 workspace 仍 Start；cwd 降级 | 是 | `resolveStartCwd` folder → cwd → tmpdir | ✅ |
| **AD-CR-9** 删除离线：禁用或「Host 连接后可删除」；不完整建连；不假删 | **是（本轮闭合）** | `runDeleteActive` + `deleteHistorySession` 同款提示；README + L2 | ✅ |
| **AD-CR-10** test 钩子门闩；可见性经生产入口 | 是 | `shouldRegisterTestHooks`；`fireConversationVisibility` → 生产 handler；无生产 `dsh.test.*` contributes | ✅ |
| **AD-CR-11 / AC-26** 不改 agent-loop；主落点 vscode-dsh | 是 | 无 `packages/core/**/agent-loop*` 改动 | ✅ |
| **AC-25 / AD-CU-1** Webview 无 mode/session 权威 | 是 | mode 跟 panel/state | ✅ |
| **命令矩阵** README；showPanel 不强制 Start | 是 | README「Auto-start command matrix」；`dsh.deleteHistory` 行已补齐 | ✅ |
| **状态机 / 断线 retry-once** | 是 | `disconnected` + `autoRetryUsed`；Stop-during-starting | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `auto-start-orchestrator.ts` | `apps/vscode-dsh/src/` | ✅ | 与 design 计划一致 |
| `connection-ui.ts` | 同上 | ✅ | 投影 + latch 缝 |
| `extension.ts`（deleteHistory 修复） | 同上 | ✅ | 删除 UX 留在 Host 命令层，正确 |
| `tests/phase1-auto-start.spec.ts` | `tests/` | ✅ | 本轮补 AC-1e History L2 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| `deleteHistorySession` | 与 `dsh.deleteHistory` 对称 | 既有命令命名 | ✅ |
| 离线文案 | `Host 连接后可删除` | AD-CR-9 / AC-1e 字面 | ✅ |
| FSM / ConnectionUi | 与 design 骨架一致 | AD-CR-1 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块一件事 | ✅ | Orchestrator / ConnectionUi / extension 接线分离 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 未反向依赖 agent-loop |
| §2.3 接口隔离 | 经明确接口 | ✅ | `StartHostPort` / panel 协议 |

## 关键发现

### 🔴 Must-Fix
（无）

已知桩/债（registry，不升格）：
- **STUB-001** `AutoReadyLatchSeam` → phase-2-auto-ready-surface（🟡）
- **DEBT-001** Start 成功仍 restore/New → phase-2（🟡）

### 🟡 Should-Fix
（无 — 上一轮 AD-CR-9 `deleteHistory` 不对称已关闭）

活动栏生产信号弱（偏差 2 / 上一轮 Should-Fix #1）本轮按上游约定**可接受**：L2 仍覆盖 reveal+request；生产主要依赖 Conversation 可见性 / 状态栏。不升格为本轮门禁。

### 🟢 Observations
- **AD-CR-9 对称性**：`deleteConversation` 与 `deleteHistory` 现同策略（提示、不 Start、不假删）；菜单未 `when` 禁用属有意选择，设计允许。
- **缺 sessionId**：`missing` + 信息提示，不再误标 `host-not-ready`——与 `runDeleteActive`「无 Tab」分支对称，设计清晰。
- **协议字段名**（`settingsDeepLinkAvailable` vs 协议表 `canOpenSettings`）仍为轻偏，语义等价，不影响本 Phase。
- **Webview `action/continue` 未走 `ensureHostForSend`**：implementation 列为 Should-Fix 非门禁；属命令分类接线完备性，非 AD-CR-9 范围。

## 详细报告
- 对照：`design.md` AD-CR-9（及 AD-CR-1/2/4/5/10/11）、命令矩阵；`spec.md` AC-1e；`implementation.md` Must-Fix 关闭说明；`tech-debt-registry.md`；`constitution.md` §2
- 代码抽查：`extension.ts` `deleteHistorySession` / `runDeleteActive`；`README.md` 命令表 + matrix；`phase1-auto-start.spec.ts` AC-1e History
- 上一轮归档：`.archive/review-design-*.md`
