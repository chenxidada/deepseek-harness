# 代码库调研报告 — Phase 2：多对话 Tab + session 绑定

## 1. Task Context

Phase `phase-2-multi-tab-session` 要在同一 VS Code 工作区窗口内交付多对话 Tab：每个 Tab 绑定可区分的 SDK `sessionId`；切换 Tab 切换输入目标与可见会话态；关闭 Tab 默认结束该会话（Q-3 / AD-5）。窗口内仍只跑一个 `dsh --profile ide` 子进程，由 DSH 拥有 agent-loop、工具执行与会话持久化权威源（AC-15）。销毁必须走 Host→runtime 的 ide-bridge（`session/dispose` → `AgentHandle.dispose()`），**不得**新增 SDK stdout 方法。审批/提问 Host UI 仍属 Phase 3（STUB-001/002）。验收：AC-6/7/8/9/11/15/33。

**相对 Phase 1 调研的更新：** `ide` profile、`apps/vscode-dsh`、`packages/ide/ide-bridge` 已存在；本 Phase 缺口是多 Tab 注册表/UI、Host 侧 prompt 路由，以及按 session 的 dispose 所有权缝。

## 2. Repository Overview

- **语言 / 运行时：** TypeScript ESM，Node `^22.19 || >=24`，Cordis 插件，pnpm workspaces。
- **Phase 1 后的 IDE 面：** `apps/vscode-dsh`（扩展 Host）+ `packages/ide/ide-bridge` + `packages/bundle/ide`（`dsh-base` + `sdk-app` + `ide-bridge`，`profile: ide`）。
- **双通道（不变）：** 子进程 stdio 上的 SDK NDJSON JSON-RPC；经 `DSH_IDE_BRIDGE_SOCK` 的 Host bridge UDS/命名管道 NDJSON。
- **SDK 多会话现状：** `HarnessSdkJsonRpcServer` 在首次 `session/prompt` 时按 `sessionId` get-or-create 一个 agent。协议文档写明 **无 cancel / session-close**（`packages/sdk/protocol/README.md` Known Limitations）。
- **应用启动规则：** 扩展必须继续只 spawn `dsh --profile ide`，不得新增 Cordis bin。

## 3. Most Relevant Areas

| 路径 | 为何相关 | 来源 |
|------|----------|------|
| `apps/vscode-dsh/src/session-host.ts` | 窗口级进程所有者；`HarnessClient` **私有**；尚无 Tab/prompt/dispose API | 👁 |
| `apps/vscode-dsh/src/extension.ts` | 模块级单一 `host`；仅有 `dsh.startSession` / `dsh.stopSession`；无 Tab 命令 / WebviewView | 👁 |
| `apps/vscode-dsh/package.json` | 仅有 `contributes.commands` — 无 views、无 Tab UI 贡献点 | 👁 |
| `apps/vscode-dsh/tests/session-host.spec.ts` | 生命周期与脱敏夹具，可扩展为 ≥2 session 路由测试 | 👁 |
| `packages/ide/ide-bridge/src/types.ts` | `BridgeFrame` 含 hello/approval/questions/error — **无** `session/dispose` | 👁 |
| `packages/ide/ide-bridge/src/index.ts` | Runtime bridge 客户端 + Phase-3 answerer 桩；README 将 session/dispose 标为延期 | 👁 |
| `packages/ide/ide-bridge/src/{host,client,ndjson}.ts` | 可复用的 Host listen / runtime connect / NDJSON，用于新增 dispose 帧 | 👁 |
| `packages/sdk/server/src/server.ts` | 拥有 `sessions: Map<sessionId, {handle}>`；get-or-create；shutdown 销毁**全部**；无按 id dispose；外部 dispose 后有 zombie 检测 | 👁 |
| `packages/sdk/server/src/index.ts` | 仅挂传输处理器 — **未**将 server 实例 `provide` 为 Cordis 服务 | 👁 |
| `packages/sdk/protocol/src/types.ts` + README Known Limitations | 线方法仅 `initialize` / `session/prompt` / `shutdown` — **禁止**加 `session/close` | 👁 |
| `packages/sdk/client/src/client.ts` | `prompt(sessionId, blocks)` 已可指向任意 id；`close()` 拆掉整个进程 | 👁 |
| `packages/sdk/client/src/api.ts` | `DeepSeekHarness.session(id?)` — 单客户端多会话模式（铸造 UUID / 复用 id） | 👁 |
| `packages/core/agent/src/index.ts` | `AgentHandle.dispose()` 合同：停 loop、注销、移除 session、展开 scope | 👁 |
| `packages/acp/acp/src/session.ts` | 先例：会话模块持有 `AgentHandle`，关闭时 `handle.dispose()` | 👁 |
| `packages/bundle/base/cordis.patch.yml` | 含 `session-title` — 后续可通过会话事件支撑 AC-11 标题 | 👁 |
| `packages/client/ui-workspace/**` | 仅作 Web 多会话 UX 参考 — **勿**挂入 ide profile | 👁 |
| `.specdev/specs/vscode-dsh-ide/design.md` | AD-1 / AD-5 / Q-3 / ConversationTab / 多会话生命周期 | 👁 |
| `tech-debt-registry.md` | STUB-001/002 → Phase 3；无阻塞本 Phase 的桩 | 👁 |

**缺失（Phase 2 需创建）：**

| 路径 / 符号 | 设计角色 |
|-------------|----------|
| `ConversationRegistry` / `ConversationTab` | 扩展侧 `tabId ↔ sessionId`、活动指针、标题的权威 |
| Tab 栏 UI + 新建/切换/关闭命令 | AC-6/7/8/9 |
| Host→runtime `session/dispose` 帧与处理 | Q-3 销毁路径 |
| `IdeSessionHost` 的 prompt / dispose / 通知过滤 API | 单进程下按活动 Tab 路由 |
| 默认关闭策略文档（README） | 文档化 Q-3 默认 |

## 4. Key Entry Points / Call Paths

### 路径 A — 窗口进程生命周期（Phase 1，**复用**）

```
activate → dsh.startSession
  → IdeSessionHost.start
       → IdeBridgeHostServer.listen(path)
       → HarnessClient({ profile: 'ide', env: DSH_IDE_BRIDGE_SOCK… })
       → client.initialize(cwd, provider, model)
       → status = 'connected'   // 每窗口一进程（AD-1）
deactivate / dsh.stopSession
  → client.close() → protocol shutdown → dispose ladder
  → bridge.close()
```

✅ 已在 `session-host.ts` / `extension.ts` 确认。Phase 2 **不得**每 Tab 一进程。

### 路径 B — 多会话 prompt（SDK 已有 → 扩展需接线）

```
活动 Tab（sessionId = UUID）
  →（待补）IdeSessionHost / registry → HarnessClient.prompt(sessionId, blocks)
  → stdout JSON-RPC session/prompt
  → HarnessSdkJsonRpcServer.getOrCreateSession(sessionId)
       → ctx.agents.create({ sessionId })   // 仅首次 prompt
       → agent.followup(userMessage)
  → { messageId }
  → notifications session.event / session.status（按 sessionId 过滤到 Tab 时间线）
```

✅ 已确认 server get-or-create + client `prompt(sessionId, …)`。
⚠️ 假设：扩展侧通知订阅/过滤 UX — `HarnessClient` 有树订阅辅助；Host 尚未暴露。

### 路径 C — 关 Tab dispose（**缺失；本 Phase 主缝**）

```
关闭 Tab
  → ConversationRegistry.remove(tabId)
  → Host 发 bridge 帧 session/dispose { sessionId }   // 非 stdout
  → IdeBridgeClient 接收 → 必须取得该 id 的 AgentHandle
  → handle.dispose()
  → server Map 条目必须清除（或等价的所有者 dispose）
```

✅ 已确认：协议无 `session/close`；设计要求 bridge dispose。
✅ 已确认缺口：`BridgeFrame` 无 dispose 种类；`ide-bridge` `apply()` 无 dispose 处理；`HarnessSdkJsonRpcServer.sessions` 私有且未发布。
⚠️ 假设（实现选择）：由 sdk-jsonrpc-server 发布小型 Cordis dispose 能力，**或**增加仅供 ide-bridge 调用的内部 `disposeSession` — 无论哪种都必须清 Map 并调用 `handle.dispose()`，以避免 zombie（见 §7）。

### 路径 D — 多会话客户端参考（SDK 高层 API）

```
DeepSeekHarness.session()           // 铸造 session-<uuid>
DeepSeekHarness.session(knownId)    // 复用
  → HarnessSession.run → client.prompt(this.id, …)
```

✅ 已在 `packages/sdk/client/src/api.ts` 确认。适合作为扩展 Tab→sessionId 铸造模型（设计：UUID 作 `sessionId`）。

### 路径 E — ACP 每会话 dispose 先例

```
AcpSession.create → ctx.agents.create → 保留 AgentHandle
AcpSession close  → handle.dispose()
```

✅ 已在 `packages/acp/acp/src/session.ts` 确认。ACP 自持 handle；ide 路径下 handle 已由 SDK server 持有 — dispose 必须经该所有者（或已发布能力），不得二次 `agents.create`。

## 5. Likely Impact Surface

| 区域 | 变更 | 风险 |
|------|------|------|
| `apps/vscode-dsh/src/` — 新增 `ConversationRegistry`（+ Tab UI / 命令） | AC-6/7/8/9/11 | **高** — 绿场 UI + 状态机 |
| `apps/vscode-dsh/src/session-host.ts` | 暴露 prompt / bridge 发送 / 事件过滤；保持单进程 | **高** — client 目前私有 |
| `apps/vscode-dsh/src/extension.ts` + `package.json` contributes | 新命令 / 视图；勿把「窗口 host」等同「一个对话」 | **高** |
| `packages/ide/ide-bridge/src/types.ts` + host/client 处理 | 增加 `session/dispose`（+ ack/error）帧 | **高** |
| `packages/ide/ide-bridge/src/index.ts` | 处理 Host dispose 帧；调用会话所有者 dispose | **高** |
| `packages/sdk/server/src/{server,index}.ts` | 按 `sessionId` dispose：清 Map + `handle.dispose()`；可选 Cordis provide | **高** — 所有权缝；**勿**加协议方法 |
| `apps/vscode-dsh/README.md`（+ bridge README limitations） | 文档默认关闭=结束会话；更新延期条目 | **中** |
| 测试：单元/集成（≥2 Tab 切换不串 id）+ e2e（AC-33） | fake runtime 可能需支持 dispose 帧 | **高** |
| `tech-debt-registry.md` | 无 Phase-2 目标 STUB；勿动 STUB-001/002 | **低** |
| `packages/core/**/agent-loop*` / SDK 协议方法集 | **禁止**（AC-15 / 设计） | — |
| STUB-001/002 answerer 体 | **范围外**（Phase 3） | — |

## 6. Existing Constraints / Conventions

1. **AD-1：** 每窗口 ≤1 个 ide 子进程；多对话 = 多 `sessionId`。✅
2. **AD-5 / Q-3：** Tab 模型 `ConversationTab { tabId, sessionId, title?, … }`；关 Tab → dispose 该会话；可恢复策略仅文档预留，不作默认。✅
3. **勿扩展 SDK stdout 方法**做 dispose；bridge 拥有 `session/dispose`。✅ 协议 Known Limitations + 设计。
4. **SDK stdout 纯度**保持；bridge 流量永不写 stdout。✅
5. **插件形态：** ide-bridge 为函数插件（`name`/`inject`/`Config`/`apply`，无 default export）。✅
6. **`AgentHandle.dispose()`** 是销毁能力；仅应由持有消费者调用。✅ agent 包合同。
7. **Zombie 会话：** 若 agent 已脱离而 `SessionRecord` 仍在，后续 `session/prompt` 抛 `session agent was disposed outside the server: <id>` 且**不会**重建。✅ 已在 `server.ts` + 测试确认 — Phase 2 dispose **必须**删除 Map 条目（或提供 server 拥有的 dispose）。
8. **`HarnessClient` env：** 提供 `env` 时完全替换父环境；保持 `buildIdeChildEnv` scrub + 回注 `DSH_IDE_BRIDGE_SOCK`。✅
9. **AC-15：** 扩展只做驱动/观察；不重实现 agent-loop / 工具管线 / 持久化权威。✅
10. **文案 / UI：** 产品文案宜可注入/可测（Phase 1 用 duck-typed vscode）；Tab 文案沿用同一模式。⚠️ 跟随现有扩展风格。
11. **session-title** 在 `dsh-base` 中；sdk-app 禁用 LLM 标题提供者 — AC-11 可本地用首条用户消息摘要，和/或监听 `session/title` 事件（若存在）。⚠️ 对经 SDK 通知的投递路径为假设。

## 7. Risks / Unknowns

| 项 | 确认度 | 说明 |
|----|:------:|------|
| 树中无 `ConversationRegistry` / Tab UI / WebviewView | ✅ 已确认 | 扩展绿场工作 |
| `IdeSessionHost` 未暴露 `HarnessClient` 或 `prompt` | ✅ 已确认 | 为实现 AC-7 必须加 Host API |
| `BridgeFrame` 无 dispose 变体 | ✅ 已确认 | `types.ts` |
| SDK 协议无 `session/close` | ✅ 已确认 | README Known Limitations |
| `HarnessSdkJsonRpcServer` 未发布按会话 dispose / 服务 | ✅ 已确认 | 私有 `sessions` Map |
| 外部 `handle.dispose()` 不清 Map → 该 id 永久 zombie | ✅ 已确认 | `assertLiveAgent` 路径 |
| ide-bridge README 仍将 session/dispose 标为延期 | ✅ 已确认 | 实现时更新 |
| STUB-001/002 仍为 Phase 3 fail-closed answerer | ✅ 已确认 | Phase 2 不实现 |
| 确切 VS Code Tab 壳（WebviewView vs custom editor vs TreeView） | ❓ 未知 | 规格要求 Tab 栏 + 命令；设计命名 TabBar/ConversationView，但除命令贡献外无 VS Code 打包先例 |
| ide-bridge 如何取得 `AgentHandle`（service provide vs 共享注册表 vs sdk-server API） | ⚠️ 假设 | 设计说 bridge 调 `AgentHandle.dispose()`；所有权今日在 sdk-server — 需有所有权缝且不加 stdout 方法 |
| Host 是否应在更新 Tab 栏前等待 dispose ack | ⚠️ 假设 | 建议 request/response 帧 + 超时响亮失败 |
| 用已 dispose 的 `sessionId` 再建 Tab | ⚠️ 假设 | 更安全：每新 Tab 铸造新 UUID（设计 AD-5） |

## 8. Uncertain / Unverified

- **`IdeBridgeHostServer` 多连接语义：** 可接受多个 socket；Phase 1 预期一条 runtime 连接。Dispose 帧假设该单连接 — 中途重连/断开行为未端到端核验。
- **时间线通知过滤（AC-13 属 Phase 4）：** Phase 2 仍需足够路由使输入不能串 Tab（AC-7）。`IdeSessionHost` 上确切订阅 API 尚未在代码中设计。
- **AC-11 标题来源：** 仅本地首条 prompt 文本，还是也消费 runtime 的 `session/title` 事件 — `session-title` 已挂在 base，但扩展尚未订阅会话事件。
- **Fake SDK runtime 夹具**（`apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs`）：支持 host 测试的 initialize/shutdown；多 id prompt 和/或 dispose-bridge e2e 可能需扩展 — 未完整审计多会话行为。
- **Windows 命名管道 dispose 路径：** listen/connect 代码路径存在；Phase 2 应保持路径无关帧；管道特有抖动此处未核验。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| STUB-001 | `packages/ide/ide-bridge/src/index.ts:apply` approval 监听（约 L86） | 认领每个 `approval/request`，返回 `unavailable` | 仍 `Promise.resolve('unavailable')`，带 `@STUB(phase-3-interaction-fail-closed)` | ✅ 匹配 |
| STUB-002 | `packages/ide/ide-bridge/src/index.ts:apply` questions 监听（约 L92） | 认领每个 `user-questions/request`，拒绝 `NO_PROVIDER` | 仍 `UserQuestionError` / `NO_PROVIDER`，带 Phase-3 桩标记 | ✅ 匹配 |
| — | `session/dispose` / `ConversationRegistry` | 不在 registry | **缺失**（非桩 — 本 Phase 待实现功能） | ✅ 预期缺口，非未注册桩 |

### Stub Detection Summary

- ✅ 与 registry 匹配的已确认桩：**2**（STUB-001、STUB-002）— **目标 Phase 3；对本 Phase 非阻塞**。
- ⚠️ Registry 不一致：**0**。
- 🔴 Phase 2 主路径上的未注册桩：**0**。
- **Phase Entry Gate：** 无「目标Phase = phase-2-multi-tab-session」且 🔴 的条目。用户确认 Phase-3 桩继续延期后即可推进。

**相关延期（已文档化，非 registry 桩）：** ide-bridge README「session/dispose 与 permission RPC 延期」；permission RPC 仍属更后 Phase（设计），非本 Phase 除 dispose 外的交付物。

## 10. Recommended Next Reads

1. ⭐ 必读 — `.specdev/specs/vscode-dsh-ide/design.md`（AD-1、AD-5、Q-3、多会话生命周期、ConversationTab）
2. ⭐ 必读 — `apps/vscode-dsh/src/session-host.ts` + `extension.ts`（当前单 host 模型）
3. ⭐ 必读 — `packages/sdk/server/src/server.ts`（`getOrCreateSession`、`assertLiveAgent`、`performShutdown`）
4. ⭐ 必读 — `packages/ide/ide-bridge/src/types.ts` + `index.ts` + `host.ts`/`client.ts`（帧与传输扩展点）
5. ⭐ 必读 — `packages/sdk/client/src/client.ts`（`prompt`）+ `api.ts`（`DeepSeekHarness.session`）
6. ⭐ 必读 — `packages/core/agent/src/index.ts`（`AgentHandle` dispose 合同）
7. 🔷 应读 — `packages/acp/acp/src/session.ts`（每会话 handle 所有权 / dispose）
8. 🔷 应读 — `packages/sdk/protocol/README.md` Known Limitations（无 session-close）
9. 🔷 应读 — `apps/vscode-dsh/tests/session-host.spec.ts` + `packages/ide/ide-bridge/tests/ide-bridge.spec.ts`
10. 🔷 应读 — Phase 1 `implementation.md`（Host/bridge 现状；STUB-001/002 留给 Phase 3）
11. 🔹 可选 — `packages/session/session-title`（AC-11 标题事件）+ Web `ui-workspace`（仅作多会话 UX 灵感）

### Implementer 清单（推导）

1. 增加扩展 `ConversationRegistry`（每新 Tab 铸造 UUID `sessionId`；活动指针；≥2 Tab）。
2. 接线 Tab 切换 → prompt/事件过滤仅用活动 `sessionId`（AC-7）。
3. 在 `IdeSessionHost` 上暴露 `prompt(sessionId, …)` 与 bridge `session/dispose`。
4. 扩展 `BridgeFrame` + ide-bridge 处理；实现 **server 拥有的** 按会话 dispose（Map delete + `AgentHandle.dispose()`）；永不加 stdout `session/close`。
5. 文档化默认关闭策略；不动 STUB-001/002；增加 ≥1 集成（≥2 Tab）+ ≥1 e2e（AC-33）。
