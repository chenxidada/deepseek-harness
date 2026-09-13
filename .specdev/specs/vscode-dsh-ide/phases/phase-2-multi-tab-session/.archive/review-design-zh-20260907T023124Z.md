# 设计一致性审查 — Phase 2（phase-2-multi-tab-session）

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-1** 单 DSH 进程 + 多 `sessionId` | 是 | `IdeSessionHost` 仍只 spawn 一次 `HarnessClient({ profile: 'ide' })`；`ConversationController.promptActive` / `promptTab` 按 Tab 的 `sessionId` 调 `host.prompt`；切换 Tab 只改本地指针 | ✅ |
| **AD-5** Tab ↔ session 绑定 | 是 | `ConversationTab { tabId, sessionId, title?, status }` 在 `conversation-registry.ts`；`create()` 铸造新 UUID `sessionId`；`getBySessionId` 预留后续审批关联 | ✅ |
| **Q-3** 关 Tab 默认结束会话 | 是 | `closeConversation` → `IdeSessionHost.disposeSession` → bridge `session/dispose`；README「Default close policy (Q-3)」文档化；可恢复非默认 | ✅ |
| **多会话生命周期** dispose 经 bridge，不扩 SDK stdout | 是 | `BridgeFrame` 增加 `session/dispose` / `session/dispose/response`；`packages/sdk/protocol` 无 `session/close`；server `disposeSession` 经 Cordis `sdkSessionDispose`，非 stdout 方法 | ✅ |
| dispose 清 Map + `AgentHandle.dispose()` | 是 | `HarnessSdkJsonRpcServer.disposeSession`：先 `sessions.delete` 再 `handle.dispose()`；ide-bridge `handleHostFrame` 调 `disposer.disposeSession` | ✅ |
| **AD-2** 双通道分离（本 Phase 相关） | 是 | prompt 仍走 SDK stdio；dispose 走 Host bridge NDJSON；未把 dispose 塞进 stdout | ✅ |
| **AC-15 / 包禁区** 不改 agent-loop；扩展不重实现权威源 | 是 | Extension 仅 registry / 路由 / TreeView 投影；未改 `packages/core/**/agent-loop*`；未扩 protocol 方法集 | ✅ |
| **AD-8** UI 呈现可替换 | 是 | Tab 栏以 Sidebar TreeView + QuickPick 实现（implementation 偏差记录）；session 绑定权威仍在 `ConversationRegistry`，可换 Webview 而不改模型 | ✅ |
| STUB-001 / STUB-002（Phase 3） | 故意未实现 | `@STUB(phase-3-interaction-fail-closed)` 仍 fail-closed；registry 目标 Phase 3 — **不判 MUST-FIX** | ✅ 延期 |

## 模块/命名/结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `conversation-registry.ts` | `apps/vscode-dsh/src/` | ✅ | 设计组件图 ConversationRegistry；Extension 权威 Tab 模型 |
| `conversation-controller.ts` | `apps/vscode-dsh/src/` | ✅ | 注册表 + Host 路由，职责单一 |
| `conversation-tab-bar.ts` | `apps/vscode-dsh/src/` | ✅ | Tab 栏投影；与 registry 分离 |
| `session-host.ts`（扩展 prompt/dispose） | `apps/vscode-dsh/src/` | ✅ | 窗口级单进程 owner；符合 AD-1 |
| `types.ts` dispose 帧 | `packages/ide/ide-bridge/src/` | ✅ | design 包落点：ide-bridge 拥有 bridge 帧 |
| `session-dispose.ts` | `packages/sdk/server/src/` | ✅ | session Map 权威在 sdk-server；经 Cordis 暴露给 bridge |
| 测试 | `apps/vscode-dsh/tests/`、`packages/*/tests/` | ✅ | 仓库惯例：包级 `tests/` |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件名 | `conversation-registry.ts` 等 kebab-case | 仓库 kebab-case | ✅ |
| 类名 | `ConversationRegistry` / `ConversationController` / `IdeSessionHost` | PascalCase | ✅ |
| 帧 kind | `session/dispose`、`session/dispose/response` | design「多会话生命周期」命名 | ✅ |
| Cordis 服务键 | `sdkSessionDispose` | 与 provide/get 一致；两侧常量值相同 | ✅ |
| 命令 | `dsh.newConversation` / `closeConversation` / `switchConversation` | 既有 `dsh.*` 前缀 | ✅ |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | Registry=Tab 状态；Controller=路由；Host=进程；bridge=帧/answerer；server=session 所有权 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | ide-bridge 经 `ctx.get('sdkSessionDispose')` 消费能力，不 peerDep sdk-server；未反向依赖 Extension |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | `SdkSessionDispose` / `SdkSessionDisposeCapability`；Host↔runtime 仅经 `BridgeFrame` |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **Tab UI chrome：** 使用 Conversations TreeView + QuickPick，而非独立 editor Tab。已在 `implementation.md` 记为偏差；符合 **AD-8**（UI 呈现可替换），session 绑定契约未变。下游 Phase 3/4 可继续依赖同一 `ConversationRegistry`。
- **`SDK_SESSION_DISPOSE_SERVICE` 双份常量：** ide-bridge 与 sdk-server 各定义同名字符串，避免硬依赖。设计允许该实现细化；两边 README 已记录服务名。
- **AD-5 散文中的 `timelineCursor` / `pendingInteraction`：** 正式数据模型与本 Phase 实现使用 `status`；时间线/待结算交互属 Phase 4 / Phase 3，本 Phase 不引入占位字段是合理的。
- **STUB-001 / STUB-002：** 仍指向 Phase 3，本审查不升级为缺陷。

## 摘要

Phase 2 在设计一致性上 **PASS**：单进程多 `sessionId`（AD-1）、`ConversationTab` 绑定（AD-5）、关 Tab → bridge `session/dispose` → Map 清除 + `AgentHandle.dispose()`（Q-3 / 多会话生命周期）均落实；未扩展 SDK stdout、未改 agent-loop。TreeView Tab 栏为已文档化的 AD-8 允许偏差。
