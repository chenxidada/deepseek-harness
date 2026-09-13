# 连通性审查 — phase-5-replaceability-docs

## 视角
**集成连通性** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### 路径 1：文档描述的三可替换面 → 代码缝（AD-8 / AC-27–29）

```
design.md AD-8
  → packages/ide/ide-bridge/README.md § Replaceability contract (AD-8)
       传输面     → NdjsonSocket(Duplex) + validateBridgeFrame / BridgeFrame
       UI 面      →（交叉链接）apps/vscode-dsh README → InteractionUi / setInteractionUi
       Auto-allow → permission/select → dsh-permission-presets.set
  → apps/vscode-dsh/README.md § Replaceability (AD-8)
       UI 面      → InteractionUi，经 IdeSessionHost.setInteractionUi
       Auto-allow → dsh.selectPermissionPreset → Host permission/select
       传输面     → 链回 ide-bridge（权威源，无第二权威）
  → packages/bundle/ide/README.md
       删除过期「UI deferred / stubs」；指向 ide-bridge replaceability ✅
```

**判定**: ✅ 文档面与 call site 一一对应；权威源单向（ide-bridge 拥有传输/帧；vscode-dsh 拥有 UI/picker 并回链）

### 路径 2：PassThrough 内存传输证明（AC-29 / AC-33）

```
入口: tests/replaceability-memory-transport.spec.ts
  → createMemoryDuplexPair()  // PassThrough 交叉双工
  → new NdjsonSocket(hostDuplex) / new NdjsonSocket(runtimeDuplex)
       同生产: IdeBridgeHostServer.accept → new NdjsonSocket(socket) ✅
       同生产: IdeBridgeClient.connect → new NdjsonSocket(socket) ✅
  → validateBridgeFrame / parseBridgeFrame（公共导出自 src/index.ts）✅
  → runtime.send(hello) → host.onFrame(hello) ✅
  → host.send(hello) → runtime.onFrame(hello) ✅
  → runtime.send(approval/request) → host frames ✅
  → validateBridgeFrame(allow-all) → undefined（fail-closed 契约）✅
  → host.send(approval/response allowed-once) → runtime frames ✅
出口: hello + approval 双程在内存 Duplex 上闭合；不经 agent-loop
```

**判定**: ✅ 第二传输（memory）与生产共享同一帧缝；数据从 send → Duplex → onFrame 完整流通

### 路径 3：第二 InteractionUi 注入 + Host 审批（AC-29 / AC-33）

```
入口: tests/replaceability-interaction-ui.spec.ts
  → createRejectOncePresenter()  // 非 QuickPick，返回 'rejected'
  → IdeSessionHost.setInteractionUi(ui)
       → InteractionCoordinator.setUi(ui) ✅
  → host.start({ dshBin: fake-sdk-runtime, FAKE_EMIT_APPROVAL_SESSION, … })
       → IdeBridgeHostServer.listen(sock) ✅
       → spawn fake runtime → bridge hello ✅
  → fake runtime send approval/request
  → IdeSessionHost.onBridgeFrame(approval/request)
       → interactions.handleApproval(frame)
            → ui.presentApproval(...) → 'rejected' ✅
       → connection.send({ kind: 'approval/response', outcome: legal }) ✅
  → fake runtime 写 FAKE_APPROVAL_LOG { outcome: 'rejected' } ✅
  → presenterLog 含 reject-once:<sessionId>:… ✅
出口: 第二 presenter 经真实 Host bridge 结算，无 agent-loop
```

**判定**: ✅ UI 替换缝上游注入、下游 bridge 回写均接通

### 路径 4：Auto-allow / permission（文档缝；前序 Phase 已实装）

```
入口: Extension 命令 dsh.selectPermissionPreset
  → pickPermissionPreset → ConversationController.selectPermissionPreset
  → IdeSessionHost.selectPermissionPreset / permissionRpc
       → send { kind: 'permission/select', sessionId, preset }
  → ide-bridge handlePermissionSelect
       → ctx.get(permissionPresets).set(session, preset) ✅
       → danger-full-access → approval: 'never'（dsh-permission-presets 表）✅
  → permission/select/response → Host pending resolve ✅
出口: 策略落在 permission-presets；不改 agent-loop
```

**判定**: ✅ 文档指向的缝与 Phase 3 实装 call site 一致（本 Phase 无新桩、无断链）

### 路径 5：AC-27 — 更换上述面不依赖改 agent-loop

```
prove-replaceability.sh
  → git diff master...HEAD：无 packages/core/agent-loop 路径 ✅
  → git status porcelain agent-loop：工作区无改动 ✅
  → rg：ide-bridge/src、vscode-dsh/src 无 dsh-agent-loop import ✅
  → package.json：无 @deepseek-ai/dsh-agent-loop 依赖 ✅
replaceability-*.spec.ts
  → ide-bridge 公共面无 runAgentLoop 符号 ✅
  → vscode-dsh package.json 不含 agent-loop ✅
implementation.md：刻意未改 packages/core/agent-loop/** ✅
```

**判定**: ✅ 证明脚本与测试把「不碰 agent-loop」接到可执行检查；替换行为落在 ide-bridge / Extension

## 上下游连接检查

| 新函数/组件 / 产物 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| README § AD-8（ide-bridge） | 设计 AD-8 / AC-27–29 | ✅ | `NdjsonSocket` / `validateBridgeFrame` / 证明测试路径 | ✅ |
| README § AD-8（vscode-dsh） | 设计 AD-8 | ✅ | `setInteractionUi` / `dsh.selectPermissionPreset` / ide-bridge 锚点 | ✅ |
| `createMemoryDuplexPair` + PassThrough 证明 | vitest / prove script | ✅ | `NdjsonSocket` + `validateBridgeFrame` | ✅ |
| `createRejectOncePresenter` | replaceability-interaction-ui.spec | ✅ | `InteractionUi.presentApproval` → Host `approval/response` | ✅ |
| `IdeSessionHost.setInteractionUi` | Extension / 证明测试 | ✅ | `InteractionCoordinator.setUi` | ✅ |
| `handleApproval` → `presentApproval` | `onBridgeFrame(approval/request)` | ✅ | 注入的第二 UI / 默认 QuickPick | ✅ |
| `handlePermissionSelect` | bridge `permission/select` | ✅ | `permissionPresets.set` | ✅ |
| `prove-replaceability.sh` | 手动 / verifier | ✅ | vitest 两文件 + grep 文档 + agent-loop 门禁 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| 证明测试 → ide-bridge 公共面 | `NdjsonSocket` / `validateBridgeFrame` / `parseBridgeFrame` | `src/index.ts` 导出上述符号 | ✅ |
| PassThrough 证明 ↔ 生产 Host | 任意 `Duplex` 上 NDJSON + 同帧校验 | `host.accept` / `client.connect` 均 `new NdjsonSocket(socket)` | ✅ |
| 第二 UI → `InteractionUi` | `presentApproval` → `ApprovalOutcome` | interface + coordinator 竞态 abort；非法 outcome Host 侧压成 `unavailable` | ✅ |
| 文档 Transport 替换面 | 换 Duplex / `NdjsonSocket`，不改帧契约 | 无生产 `IdeBridgeTransport` 类型；与 design 偏差已记，Duplex 缝仍是真实替换点 | ✅ |
| 文档 Auto-allow | 仅经 `permission/select` → presets | `handlePermissionSelect` 唯一 `presets.set`；Extension 不另存策略 | ✅ |
| vscode-dsh / ide-bridge → agent-loop | 无依赖、无 import | package.json + src rg 均无 | ✅ |
| stdout 纯度 / fail-closed（文档约束） | bridge 不写 SDK stdout；非法/断连 fail-closed | README 双通道表 + 终端 answerer 不 `next()`（前序 Phase 冻结） | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `BridgeFrame` / `validateBridgeFrame` / `NdjsonSocket` | Phase 1 | 已冻结；本 Phase 仅复用 + 证明 | ✅ |
| `IdeBridgeHostServer` Host 监听 | Phase 1 | 未改签名；UI 证明仍走 UDS listen | ✅ |
| `InteractionUi` / `setInteractionUi` / fail-closed | Phase 3 | 未改契约；第二 presenter 注入同一缝 | ✅ |
| `permission/select` → `permissionPresets.set` | Phase 3 / AD-6 | 未改；文档指向既有 RPC | ✅ |
| `packages/core/agent-loop` | — | **禁止改动**；diff/rg 证据无触碰 | ✅ |
| GAP-010 / GAP-011 | Phase 4 | 明确未改（非本 Phase 替换面） | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- design.md 中的 `IdeBridgeTransport` TypeScript 接口仍未落地；本 Phase 以 `NdjsonSocket(Duplex)` + 文档描述替换面，并与 Phase 1 review 偏差一致。生产 Host/Client 与 memory 证明共用同一 Duplex→NDJSON 缝，**连通性不依赖**该接口抽象。
- Auto-allow 面在本 Phase 以文档 + 既有 Phase 3 RPC 连通；AC-29 要求的「≥1 可验证替换路径」已由 PassThrough transport 与第二 `InteractionUi` 两条证明覆盖。`prove-replaceability.sh` 未再跑 permission e2e，但不构成文档→代码断链。
- 双 README 权威源拆分正确：传输/帧/fail-closed/stdout 在 ide-bridge；UI/picker 在 vscode-dsh 并回链，避免双写契约。
