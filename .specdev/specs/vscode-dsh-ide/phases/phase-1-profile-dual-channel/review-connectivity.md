# Connectivity Review — Phase 1 (GAP-001 / GAP-002 fix loop)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: credentials → redact → error UI / status (AC-32 / GAP-001)
```
Entry: IdeSessionHost.start({ credentials: { DEEPSEEK_API_KEY: secret, … } })
  → this.credentials = options.credentials                         ✅ 会话袋暂存
  → buildIdeChildEnv({ credentials }) → HarnessClient.env          ✅ 密钥注入子进程（不经日志）
  → initialize 失败（fake runtime 将 key 嵌入 JSON-RPC error）      ✅ 下游错误携带明文
  → catch:
       status = 'error'                                            ✅ 非 connected（AC-4）
       errorMessage = redactSecrets(message, this.credentials)     ✅ bag + process.env 双扫
       throw new Error(errorMessage)                               ✅ 抛出已脱敏文案
  → Extension catch (dsh.startSession):
       redactSecrets(error.message)  // 二次、仅 env（幂等）         ✅ Host 已脱敏
       vscode.window.showErrorMessage(...)                         ✅ 错误 UI 消费脱敏文本
Exit: host.status === 'error' ∧ errorMessage 含 [redacted:…] 无明文
```
**判定**: ✅ 数据路径完整。credentials 袋在诊断 redact 前可用；`shutdownInternal` 清袋发生在 `errorMessage` 赋值之后，无「写后即弃」断裂。集成测断言 Host `errorMessage` 与 throw 文案均脱敏。

### Path 2: start → connected → shutdown → disconnected (AC-3 / GAP-002)
```
Entry: IdeSessionHost.start({ dshBin: fake-sdk-runtime, … })
  → status = 'starting'
  → IdeBridgeHostServer.listen → HarnessClient.start → initialize  ✅
  → status = 'connected' 仅 initialize 成功后                      ✅ AC-1 / AC-4
  → IdeSessionHost.shutdown()
       → shutdownInternal: client.close() → bridge.close()         ✅ 有序回收
       → status !== 'error' → status = 'disconnected'              ✅
Exit (Extension):
  → dsh.stopSession / deactivate → current.shutdown()              ✅ 上游调用接上
  → showInformationMessage('…stopped')                             ✅ UI 更新
```
**判定**: ✅ 生命周期状态机与 Extension 停机入口连通；单测覆盖 connected→shutdown→disconnected。

### Path 3: STUB-001 / STUB-002（故意未实现）
```
approval/request → ide-bridge → 'unavailable'                      🟡 Phase 3
user-questions/request → NO_PROVIDER                               🟡 Phase 3
```
**判定**: ✅ 不切断 GAP-001/002 路径；registry 活跃、目标 Phase 3、🟡非阻塞。本回路**不**判 MUST-FIX。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `redactSecrets(text, credentials?)` | `IdeSessionHost` catch / close 失败；单测 | ✅ | `redactBag(process.env)` + optional bag | ✅ |
| `IdeSessionHost.credentials` | `start(options.credentials)` | ✅ | `redactSecrets(..., this.credentials)`；`buildIdeChildEnv` | ✅ |
| `errorMessage` + thrown Error | `start` catch | ✅ | Extension `showErrorMessage`；测试读 `host.errorMessage` | ✅ |
| `status='connected'` | `start` after `initialize` | ✅ | GAP-002 测试断言；Extension 成功 info UI | ✅ |
| `status='disconnected'` | `shutdown` after `shutdownInternal` | ✅ | GAP-002 测试；stop/deactivate 完成后再提示 | ✅ |
| STUB approval/questions | interaction waterfall | ✅ 已挂 | Host UI round-trip | 🟡 故意延后 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host → `redactSecrets` | `(text, credentials?) => scrubbed` | 先扫 `process.env`，再扫 optional bag | ✅ |
| Host catch → throw | 抛出已脱敏 `Error.message` | `throw new Error(this.errorMessage)` | ✅ |
| Extension → Host 错误 | `Error.message` 可二次 redact 后 UI | Host 已脱敏；二次仅 env，幂等 | ✅ |
| Host → `buildIdeChildEnv` | credentials 合并进 child env | `...options.credentials` after scrub | ✅ |
| fake runtime → Host | init error message 含 `DEEPSEEK_API_KEY` | `FAKE_FAIL_INIT_WITH_API_KEY` 嵌入 env 值 | ✅ |
| `shutdown` → status | happy path → `disconnected`；error 保持 `error` | `if (this.status !== 'error') …` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| （无上游 Phase） | — | Phase 1 首 Phase | ✅ |
| STUB-001 / STUB-002 | 本 Phase 登记 → Phase 3 | 故意骨架，未改 | ✅ 不阻塞本回路 |
| GAP-001 / GAP-002 | 本 Phase 已解决 | registry「已解决」 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- `extension.ts` 的 `dsh.startSession` 目前调用 `start({ cwd })`，未传入 `credentials` 袋；GAP-001 连通性在 Host API + 测试夹具路径上已闭环。生产侧若仅靠 bag 注入密钥，需后续把凭证源接到 `start` 选项（非本债务修复断裂）。
- Extension 对 throw 的二次 `redactSecrets` 不传 bag；依赖 Host 先脱敏。当前契约一致且幂等，非路径断裂。
- STUB-001/002 仍活跃、指向 Phase 3；不纳入本回路 MUST-FIX。
