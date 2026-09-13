# Connectivity Review — Phase 1 (phase-1-profile-dual-channel)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: Extension dual-channel lifecycle (AC-1 / AC-3 / AC-4 / AC-18)
```
Entry: dsh.startSession / IdeSessionHost.start({ cwd })
  → IdeBridgeHostServer.listen(bridgePath)                    ✅ Host 先听
  → buildIdeChildEnv({ bridgeSock })                          ✅ scrub 后重注 DSH_IDE_BRIDGE_SOCK
  → HarnessClient({ profile: 'ide', env }) → client.start()   ✅ spawn dsh --profile ide
  → child: PROFILE_TEMPLATES.ide
       = base + sdk-app + dsh-ide                             ✅ 模板已注册
  → bundle/ide cordis.patch.yml
       profile: ide + insert ide-bridge                       ✅ patch 接上
  → ide-bridge apply: read DSH_IDE_BRIDGE_SOCK
       → IdeBridgeClient.connect() → send { kind: hello }     ✅ 侧通道连接
  → client.initialize(...)                                    ✅ SDK stdout JSON-RPC
  → status = 'connected' 仅在 initialize 成功后               ✅ AC-1 / AC-4
Exit (stop / deactivate):
  → IdeSessionHost.shutdown → client.close() → bridge.close() ✅ AC-3 有序回收
```
**判定**: ✅ 数据路径完整；SDK 与 bridge 双通道分离；假连接仅在 initialize 失败路径被阻断（`status='error'`）

### Path 2: Profile boot + dual-channel e2e smoke (AC-1 / AC-2 / AC-18 / AC-33)
```
Entry: execa(bin.ts --profile ide) + env DSH_IDE_BRIDGE_SOCK
  → apps/cli 依赖 @deepseek-ai/dsh-ide (workspace)            ✅ in-box 解析
  → Host IdeBridgeHostServer.listen                           ✅
  → stdin initialize JSON-RPC                                 ✅
  → stdout 每行 JSON.parse（非 JSON 即失败）                   ✅ AC-2
  → Host 收到 { kind: 'hello', role: 'runtime' }              ✅ AC-18 侧通道
  → stdin shutdown → exit 0                                   ✅
Exit: dual-channel-smoke.e2e.ts 覆盖真实进程连通路径
```
**判定**: ✅ e2e 覆盖真实 `dsh --profile ide` 双通道（stdout initialize + UDS hello），不是 mock 空壳

### Path 3: Answerer stubs (STUB-001 / STUB-002) vs Phase 1 必达路径
```
approval/request waterfall
  → ide-bridge ctx.on → 'unavailable'（不 next）              🟡 Phase 3 桩
user-questions/request waterfall
  → ide-bridge ctx.on → UserQuestionError NO_PROVIDER         🟡 Phase 3 桩
hello / initialize / shutdown                                 ✅ 不经过 stub 体
```
**判定**: ✅ STUB **不切断** Phase 1 骨架必达路径（listen → sock env → connect/hello → initialize → shutdown）；完整 Host 应答属 Phase 3，registry 标 🟡非阻塞

### Path 4: AC-5 Web UI 互斥
```
bundle/ide/cordis.patch.yml
  → 无 ui-approval / ui-user-questions 行
  → ide.spec.ts 静态断言 forbidden ids/names                  ✅
```
**判定**: ✅ 互斥在组合产物上可观测；ide profile 不会与 Web 终端应答同挂

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `PROFILE_TEMPLATES.ide` | `loadProfile('ide')` / CLI `--profile ide` | ✅ | `dsh-base` + `dsh-sdk-app` + `dsh-ide` bundles | ✅ |
| `bundle/ide` patch insert | profile stack 末层 | ✅ | `@deepseek-ai/dsh-ide-bridge` apply | ✅ |
| `IdeBridgeHostServer.listen` | `IdeSessionHost.start` / e2e | ✅ | UDS accept → NdjsonSocket | ✅ |
| `buildIdeChildEnv` | `IdeSessionHost.start` | ✅ | `HarnessClient.env` + `IDE_BRIDGE_SOCK_ENV` | ✅ |
| `IdeBridgeClient.connect` | ide-bridge `ctx.effect` | ✅ | Host socket + `hello` 帧 | ✅ |
| `HarnessClient.initialize` | `IdeSessionHost.start` / e2e stdin | ✅ | sdk-jsonrpc-server stdout | ✅ |
| `IdeSessionHost.shutdown` | `deactivate` / `dsh.stopSession` | ✅ | `client.close` + `bridge.close` | ✅ |
| STUB approval/questions | interaction waterfall | ✅ 已挂 | Host UI round-trip | 🟡 故意延后 Phase 3 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| app-boot → bundle/ide | `@deepseek-ai/dsh-ide` in templates | `packages/bundle/ide` name + `dsh.bundle.patch` | ✅ |
| apps/cli → dsh-ide | in-box workspace 依赖 | `package.json` 含 `@deepseek-ai/dsh-ide` | ✅ |
| patch → ide-bridge | insert `name: @deepseek-ai/dsh-ide-bridge` | package name 匹配；bundle deps 含 bridge | ✅ |
| Extension → HarnessClient | `profile: 'ide'` + custom `env` | client launch `--profile ide` + env 全量替换 | ✅ |
| Extension → scrub 契约 | scrub 掉 `DSH_*` 后须重注 sock | `buildIdeChildEnv` 重注 `DSH_IDE_BRIDGE_SOCK` | ✅ |
| Host ↔ runtime | NDJSON `hello` / BridgeFrame | `NdjsonSocket` + 同名常量 `DSH_IDE_BRIDGE_SOCK` | ✅ |
| ide-bridge → approval | 终端 answerer，fail-closed | `unavailable`；不 `next()` | ✅ Phase 1 |
| ide-bridge → user-questions | fail-closed | `NO_PROVIDER` reject | ✅ Phase 1 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| （无上游 Phase） | — | Phase 1 首 Phase | ✅ |
| sdk-app / SDK client-server | 既有 | 冻结复用，未改 agent-loop / stdout 审批 RPC | ✅ |
| STUB-001/002 → Phase 3 | phase-3 | 已登记；非本 Phase 必达 | ✅ 不阻断 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无阻塞级；见 Observations）

### 🟢 Observations
- **e2e 覆盖真实进程双通道**：`dual-channel-smoke.e2e.ts` 同时断言 stdout `initialize`/`shutdown` 与 bridge `hello`，并拒绝非 JSON stdout；与 Extension 生产路径（`HarnessClient` + 同 env 契约）同构。
- **STUB-001/002 不切断骨架**：桩只短路瀑布应答体；socket 连接与 `hello`、SDK 握手仍完整；目标 Phase 3、阻塞 🟡。
- **Extension UI「已连接」仅绑定 initialize**：`IdeSessionHost` 暴露 `bridgeConnected()`，但 `activate` 成功文案不要求 hello；与 design 启动步骤 3/4 分离一致，bridge 降级 UI 留给后续 Phase，不构成本 Phase 路径断裂。
- **AC-5 以静态 patch 断言落地**：未做 boot 时动态扫描，但对 ide 组合产物已足以防止 Web UI 行进入 profile。
