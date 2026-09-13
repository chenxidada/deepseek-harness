# 代码库调研报告 — Phase 3：审批+提问+权限 fail-closed

## 1. Task Context

Phase `phase-3-interaction-fail-closed` 负责填实 STUB-001 / STUB-002，打通 Host bridge 人类交互闭环：DSH 发出 `approval/request` 或 `user-questions/request` 时，`ide-bridge` 经非 stdout 的 UDS/NDJSON bridge 转发；VS Code Extension 在正确的 Tab/`sessionId` 上展示 UI（AC-10）；Host 应答映射为合法 `ApprovalOutcome` / `AskUserQuestionAnswer`（AC-16/17）；断连、超时、抛错、非法载荷、子进程异常一律 fail-closed，禁止静默放行（AC-19/20/30/31）。权限 UI 只能调用 `dsh-permission-presets`（AC-21/22）。禁止再挂 Web `ui-approval` / `ui-user-questions`。需 ≥1 集成测试 + ≥1 独立 e2e（AC-33）。

**相对 Phase 2 调研的更新：** 多 Tab 注册表、`session/dispose`、`IdeSessionHost` 的 prompt/dispose 路由已就绪；审批/提问 answerer 仍是 fail-closed 桩；Host `onBridgeFrame` 仍忽略交互帧；尚无 ApprovalPanel / Questions / PermissionPicker UI。

## 2. Repository Overview

- **语言 / 运行时：** TypeScript ESM，Node `^22.19 || >=24`，Cordis 插件，pnpm workspaces。
- **IDE 栈（Phase 1–2）：** `apps/vscode-dsh` + `packages/ide/ide-bridge` + `packages/bundle/ide`（`dsh-base` + `sdk-app` + `ide-bridge`，`profile: ide`）。
- **双通道（不变）：** 子进程 stdio 上的 SDK NDJSON JSON-RPC；Host bridge 经 `DSH_IDE_BRIDGE_SOCK` 的 UDS/named-pipe NDJSON（AC-18 — 不得回退）。
- **交互能力包：** `packages/interaction/user-approval`、`user-questions`、`permission-presets`（Service Definition + waterfall 事件）。
- **ACP 先例：** `packages/acp/acp` 在 ACP JSON-RPC 的 `session/request_permission` 上注册机器侧 `approval/request` answerer（同进程 waterfall → 客户端 RPC）。ACP **没有** `user-questions` answerer。
- **反模式：** `packages/client/ui-approval` / `ui-user-questions` 是 Web Host answerer — **禁止**挂到 ide profile（AD-3 / AC-5）。

## 3. Most Relevant Areas

| 路径 | 为何相关 | 来源 |
|------|----------|------|
| `packages/ide/ide-bridge/src/index.ts` | **STUB-001/002** 终端 answerer；当前仅处理 Host 入站 `session/dispose` | 👁 |
| `packages/ide/ide-bridge/src/types.ts` | `BridgeFrame` 已声明审批/提问 request+response；**尚无** `permission/select` | 👁 |
| `packages/ide/ide-bridge/src/{client,host,ndjson}.ts` | 传输与帧格式；`parseBridgeFrame` 仅校验 `kind` 为字符串（对 AC-31 偏弱） | 👁 |
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | 断言桩 fail-closed + dispose 往返；需扩展真实 round-trip | 👁 |
| `packages/ide/ide-bridge/README.md` | 明确推迟 Host UI 往返与 permission RPC | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | Host listen + spawn；`onBridgeFrame` 仅 hello + dispose/response；`pendingDispose` 超时模式可复用 | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | 已有 `getBySessionId`（服务 AC-10）；尚无 `pendingInteraction` | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | Tab ↔ prompt/dispose；无交互等待态 API | 👁 |
| `apps/vscode-dsh/src/extension.ts` | start/stop/new/switch/close 命令；**无**审批/提问/权限命令或面板 | 👁 |
| `packages/interaction/user-approval/src/{index,types}.ts` | `ApprovalOutcome` 词汇；waterfall + 服务层 fail-closed / 非法返回归一 | 👁 |
| `packages/interaction/user-questions/src/{index,types}.ts` | `AskUserQuestionAnswer`；`UserQuestionError`（含 `NO_PROVIDER`） | 👁 |
| `packages/interaction/permission-presets/src/index.ts` | 权限唯一权威：`set(session, name)` / `/permission` 命令 + `permissions` 投影 | 👁 |
| `packages/acp/acp/src/index.ts` L152–173 | 带所有权门控的审批 answerer + 结局映射（主先例） | 👁 |
| `packages/acp/acp/tests/approval.spec.ts` | allow/reject/cancel；未知→reject；客户端抛错→`unavailable`；外部分支 `next()` | 👁 |
| `packages/client/ui-approval/src/client/index.ts` | Web pending-interaction 模式（仅参考 — 勿挂载） | 👁 |
| `packages/bundle/ide/cordis.patch.yml` | 仅挂 `ide-bridge`；注释禁止与 ui-approval 双挂 | 👁 |
| `.specdev/specs/vscode-dsh-ide/design.md` AD-4/AD-5/AD-6 | 终端 answerer 语义；Tab 防串台；仅 permission-presets | 👁 |
| `tech-debt-registry.md` | STUB-001/002 → 本 Phase（🟡非阻塞） | 👁 |

**缺失（本 Phase 需新建）：**

| 路径 / 符号 | 设计角色 |
|-------------|----------|
| answerer 真实 bridge 往返 | 替换桩：发请求、等响应、映射结局 |
| Host pending-interaction 映射 + 超时 | 对齐 `pendingDispose`；断连/shutdown 时结算 |
| Extension ApprovalPanel / Questions UI | AC-16/17 呈现；经 `sessionId` → Tab 绑定 |
| PermissionPicker + bridge permission RPC | AC-21/22；当前 `BridgeFrame` 缺帧类型 |
| 更严格的入站帧校验 | AC-31（超越 `kind: string` 强转） |
| fail-closed 测试：断连/超时/非法/子进程退出 | AC-19/30/33 |

## 4. Key Entry Points / Call Paths

### 路径 A — 审批 waterfall → Host UI（本 Phase 主路径；当前为桩）

```
工具 / 策略请求审批
  → ApprovalService.request(req)          // 需 open turn；写入 asked/decided
  → ctx.waterfall('approval/request', req, 默认=unavailable)
       → ide-bridge 监听器（终端）
            现状: return 'unavailable'    // STUB-001；不调用 next()
            需要:
              if !connected → 'unavailable'
              send BridgeFrame { kind:'approval/request', id, sessionId: agent.session.id, toolName, reason? }
              await Host approval/response（超时 / abort）
              映射合法 ApprovalOutcome；非法 → 'unavailable'
  → session.append('approval/decided', { outcome })
  → 工具在既有契约内继续/拒绝（AC-20：waterfall 阻塞至结算）
```

✅ CONFIRMED：桩行为 + ApprovalService fail-closed 收容。
✅ CONFIRMED：`BridgeFrame` request/response 种类已类型化。
⚠️ HYPOTHESIS：是否要像 ACP 一样做所有权过滤（非本 bridge 拥有则 `next()`）— 当前桩认领**全部**请求（符合 ide profile「终端」定位，但与 ACP 的 ownership `next()` 略有差异）。

### 路径 B — 用户提问 waterfall → Host UI（桩）

```
UserQuestionService.ask(request)
  → 校验 questions / live root agent
  → waterfall('user-questions/request', …, noAnswerer=NO_PROVIDER)
       → ide-bridge 现状: reject UserQuestionError NO_PROVIDER  // STUB-002
       → 需要: bridge 往返 → AskUserQuestionAnswer
```

✅ CONFIRMED：ACP **无** user-questions answerer — IDE 需自行实现 Host UI 映射；Web `ui-user-questions` 仅作参考。
✅ CONFIRMED：应答形状为 `{ answers: AskUserQuestionAnswerItem[] }`。

### 路径 C — ACP 审批先例（机器客户端，同一 waterfall 角色）

```
ctx.on('approval/request', (request, next) => {
  record = ownedRecord(request.agent)
  if (!record || !request.callId) return next()
  drainUpdates → conn.request(session/requestPermission, { allow-once, reject-once })
  map: cancelled | allow-once→allowed-once | else→rejected
})
// 客户端抛错 → ApprovalService.catch → 'unavailable'
```

✅ CONFIRMED：见 `packages/acp/acp/src/index.ts` + `tests/approval.spec.ts`。
注意：ACP 占用**同一** JSON-RPC 通道；IDE 必须使用**侧通道** bridge（AD-2）。

### 路径 D — 权限档位（AC-21/22；bridge RPC 缺失）

```
Extension PermissionPicker 选择 preset 名
  → 需要: Host→runtime 帧（设计稿: permission/select { sessionId, preset })
  → runtime: ctx.permissionPresets.set(session, name)
       → append permission/preset + setSandboxMode + setApprovalPolicy/setPolicy
  → 后续沙箱与审批策略与 preset 一致
```

✅ CONFIRMED：唯一写入 API 为 `PermissionPresetService.set` / `/permission` 命令。
✅ CONFIRMED：当前 `BridgeFrame` **没有** permission 种类（README：推迟）。
⚠️ HYPOTHESIS：本 Phase 按 design.md 示意实现 Host→runtime `permission/select`（可加可选 response）。

### 路径 E — Tab 关联（AC-10；Host 侧部分就绪）

```
approval/request frame.sessionId
  → ConversationRegistry.getBySessionId(sessionId)
  → 聚焦 / 标注对应 Tab；记录 pendingInteraction
  → 用户作答 → 同连接上发 approval/response { id, outcome }
```

✅ CONFIRMED：`getBySessionId` 已存在。
❌ ABSENT：pending-interaction 状态、UI 面板、Host 对入站审批/提问请求的处理。

## 5. Likely Impact Surface

| 区域 | 变更类型 | 风险 |
|------|----------|------|
| `packages/ide/ide-bridge/src/index.ts` | 用可等待往返替换桩；pending-map；超时；所有权策略 | 🔴 高 — AC-16/17/19/20 核心 |
| `packages/ide/ide-bridge/src/types.ts` | 可能增加 permission 帧；收紧 response 类型（`AskUserQuestionAnswer` vs `unknown`） | 🟠 中 |
| `packages/ide/ide-bridge/src/ndjson.ts` | 更严格的 `parseBridgeFrame` / 校验器（AC-31） | 🟠 中 |
| `apps/vscode-dsh/src/session-host.ts` | 处理入站审批/提问；pending 映射；shutdown/传输死亡时取消（AC-30） | 🔴 高 |
| `apps/vscode-dsh/src/conversation-*` + `extension.ts` | 待交互绑定；Approval/Questions/Permission UI | 🔴 高 |
| `packages/ide/ide-bridge/tests` + `apps/vscode-dsh/tests` | fail-closed 矩阵 + Tab 路由 + e2e | 🟠 中 |
| `tech-debt-registry.md` | 填实后将 STUB-001/002 移入已解决 | 🟢 低 |
| `packages/bundle/ide` | 若仅扩展 bridge 行为，多半不变 | 🟢 低 |
| `packages/interaction/*` | 优先**消费**，避免改 Service Definition | 🟢 低（除非线协议缺口） |

## 6. Existing Constraints / Conventions

- **AD-4：** 终端 answerer；对本 runtime 认领的请求**禁止** `next()` 到无人 Web Host；以 `unavailable` / 等价物 fail-closed。
- **AD-3 / AC-5：** 切勿在 ide profile 挂载 `dsh-client-ui-approval` / `ui-user-questions`。
- **AD-6 / AC-22：** 权限变更只走 `permission-presets`（禁止第二套权威源）。
- **AD-2 / AC-18：** 交互流量只走 Host bridge，绝不走 SDK stdout。
- **Waterfall 语义：** 不调用 `next()` 即认领请求；`ApprovalService` 已将非法结局归一、并将抛错收容为 `unavailable`。
- **User-questions fail-closed：** 无 answerer → `UserQuestionError` `NO_PROVIDER`；abort → `ASK_ABORTED`。
- **注册即 effect：** 保持 `ctx.on` / `ctx.effect` 可处置（fiber dispose 时关闭 client 已有）。
- **Dispose 超时模式：** `IdeSessionHost.disposeTimeoutMs` + `pendingDispose` Map 是审批/提问等待的模板。
- **测试：** 优先无 key 的 bridge/fail-closed 路径；产品可见插件按包政策做 REAL composition。
- **文档：** 桩移除后更新 README Known Limitations；同步 JSDoc。

## 7. Risks / Unknowns

| 条目 | 确认度 | 说明 |
|------|:------:|------|
| STUB-001/002 仍与 registry 行为一致 | ✅ CONFIRMED | 行号漂移（约 95/101 vs registry L86/L92）；行为相同 |
| `BridgeFrame` 已有审批/提问种类 | ✅ CONFIRMED | Host 尚未处理这些帧 |
| ApprovalService 将抛错/非法 → `unavailable` | ✅ CONFIRMED | 仍需 Host 侧校验（AC-31） |
| ACP 是审批映射先例 | ✅ CONFIRMED | 无 user-questions 的 ACP 先例 |
| Permission bridge 帧未实现 | ✅ CONFIRMED | 设计稿有；types/README 推迟 |
| ide-bridge 是否应对非本拥有请求 `next()` | ⚠️ HYPOTHESIS | AD-4 写 next；当前桩认领全部；ide 无第二 answerer，两种都能 fail-closed，但所有权过滤利于未来组合 |
| Questions UI 在 VS Code 的呈现形态（modal / webview / QuickPick） | ❓ UNKNOWN | Spec 写 “Questions UI”；呈现策略属 AD-8 可替换面 |
| 子进程退出 → 取消 UI 等待 | ⚠️ HYPOTHESIS | `shutdownInternal` 会清理 dispose 等待者；需为进行中审批/提问补 child/`TransportClosed` 监听（AC-30） |
| 交互等待默认超时值 | ❓ UNKNOWN | dispose 默认 5000ms；设计未钉死审批超时 |
| `agent.session.id` ↔ Tab `sessionId` 映射 | ✅ CONFIRMED | 均为 SDK session UUID；registry 已按此键索引 |

## 8. Uncertain / Unverified

- **从 bridge 调用 `PermissionPresetService` 的 live `setPolicy` 路径：** `/permission` 命令对 live 切换用 `ctx.approval.setPolicy(agent, …)`；`set(session, name)` 用 `setApprovalPolicy(session, …)`（仅写日志）。bridge handler 需为 live agent session 选择正确写入器 — 已读 `set`/命令体，但 Host 接线未设计。
- **SDK 通知订阅是否服务「工具等待中」UX：** Host 可能仅依赖 bridge 请求帧；是否还需按 `session.event` 过滤时间线状态，本轮未核验。
- **Windows named-pipe 审批延迟 / 路径特性：** Host server 支持 pipe 路径；现有 fail-closed 测试偏 UDS。
- **ApprovalRequest / AskUserQuestionRequest 的 AbortSignal：** 必须与 Host 等待竞态 → `cancelled` / `ASK_ABORTED`；Host UI 取消语义除词汇外未细规定。
- **非法 `AskUserQuestionAnswer` 结构：** waterfall 返回后服务未见深度校验 answer items — Host→runtime 应在 resolve waterfall 前拒绝畸形应答。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| STUB-001 | `packages/ide/ide-bridge/src/index.ts:apply`（约 L95–97；registry 写 L86） | 认领每个 `approval/request`，返回 `unavailable`，无 Host 往返 | 同：`@STUB(phase-3-interaction-fail-closed)`，返回 `'unavailable'`，不调用 `next()` | ✅ 匹配（行号漂移） |
| STUB-002 | `packages/ide/ide-bridge/src/index.ts:apply`（约 L101–105；registry 写 L92） | 认领每个 `user-questions/request`，以 `NO_PROVIDER` 拒绝 | 同：`reject UserQuestionError(..., 'NO_PROVIDER')` | ✅ 匹配（行号漂移） |
| — | `parseBridgeFrame` | 未注册 | 任意带字符串 `kind` 的对象即当 `BridgeFrame`（弱校验） | 🟡 非桩；AC-31 缺口 |
| — | `IdeSessionHost.onBridgeFrame` | 未注册 | 忽略审批/提问帧（无 handler） | 🟡 功能缺失（本 Phase 范围，非已标 `@STUB`） |
| — | Extension Approval/Questions/Permission UI | 未注册 | 不存在 | 🟡 功能缺失（本 Phase 产出） |

### Stub Detection Summary

- ✅ Confirmed stubs: **2**（STUB-001、STUB-002 与 registry 行为一致）
- ⚠️ Registry mismatch: **0** 行为不匹配；**行号**已漂移（建议 implementer 更新 registry 定位）
- 🔴 Unregistered stubs: **0**（未发现新的 `@STUB` / 空壳冒充完成逻辑）
- 🟡 Phase 范围缺口（非桩）：Host 交互 handler + UI + permission RPC + 入站 schema 校验

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/ide/ide-bridge/src/index.ts`（桩 + dispose handler 模式）
2. ⭐ MUST READ — `packages/ide/ide-bridge/src/types.ts`（`BridgeFrame` 线协议）
3. ⭐ MUST READ — `packages/acp/acp/src/index.ts`（审批 answerer）+ `packages/acp/acp/tests/approval.spec.ts`
4. ⭐ MUST READ — `packages/interaction/user-approval/src/{types,index}.ts`（`ApprovalOutcome`、fail-closed decide）
5. ⭐ MUST READ — `packages/interaction/user-questions/src/{types,index}.ts`（应答 + 错误码）
6. ⭐ MUST READ — `apps/vscode-dsh/src/session-host.ts`（待扩展的 pendingDispose / bridge 生命周期）
7. 🔷 SHOULD READ — `apps/vscode-dsh/src/conversation-registry.ts`（`getBySessionId`）
8. 🔷 SHOULD READ — `packages/interaction/permission-presets/src/index.ts`（`set` / `/permission`）
9. 🔷 SHOULD READ — `.specdev/specs/vscode-dsh-ide/design.md` AD-4 / AD-5 / AD-6 + bridge 帧示意
10. 🔹 OPTIONAL — `packages/client/ui-approval` / `ui-user-questions`（仅 pending-interaction UX 模式）
11. 🔹 OPTIONAL — Phase 1/2 `implementation.md`（确认 STUB 推迟历史）
