# Connectivity Review — Phase 0b (spike-continue-capability)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: same-id 写前缀 → dispose → resume 续写 → 前缀不变（AC-66 / AC-32 core）
```
Entry: mountHarness(root) + SpikeMockAdapter
  → ctx.agents.create({ sessionId: t0b-same-id-resume })
    → AgentLoop create → persistence.create + live followup   ✅
  → h1.dispose()                                             ✅ 释放写所有权，日志留盘
  → readRaw(open('read')) → prefix snapshot                  ✅ 生产者快照
  → ctx1.fiber.dispose(); mountHarness(same root)            ✅ 跨 Context 生命周期
  → agents.create(sameId) → SessionAlreadyExistsError        ✅ 负向契约连通
  → agents.resume({ resumeSessionId })
    → resumeWith → persistence.open(id,'write')              ✅ 下游真实 API
    → handle.read(0) + optional closers append               ✅
    → setupAndPublish(..., source: 'resume')                 ✅
  → followup turn 2 → dispose
  → readRaw → prefixUnchanged(prefix, after)                 ✅ 消费者读回前缀
Exit: after.length > prefix.length; turn/start = [1,2]
```
**判定**: ✅ 数据路径完整；Spike L1 从 create 到 resume 再到前缀 oracle 全连通

### Path 2: derive create + parentSession + from→to 关联（AC-66 / AC-67）
```
Entry: parent create → followup → dispose → parentPrefix
  → agents.create({
       sessionId: t0b-child,
       seed: parentPrefix,
       inheritedEventCount,
       meta: { parentSession: fromId, isSeeded: true }
     })
    → CreateAgentOptions 契约与 agent/src 一致                ✅
  → live: header.parentSession / isSeeded / inheritedEventCount ✅
  → child followup → dispose
  → parent open('read') === parentPrefix                     ✅ 父日志未写
  → readColdSessionLog(child) → header.parentSession         ✅ 落盘头可冷读
  → continueLinkFromDerive(fromId, toId) → { fromId, toId }  ✅ AC-67 banner 数据
Exit: parent intact; child seeded + link
```
**判定**: ✅ 派生路径连通；关联数据足够驱动「新会话 · 接续自 …」（内存 dry-run，符合 Spike 范围）

### Path 3: continueCapability 三态探测（AC-28 / AD-CU-8）
```
Entry: probeContinueCapability({ gateVerdict, sessionExists, resumeApiAvailable })
  → FAIL | NOT_RUN → unknown
  → !sessionExists → unknown
  → same-id ∧ resumeApiAvailable → same-id
  → derive-only → derive-only
  → else → unknown
Exit: union ⊆ { same-id, derive-only, unknown }（无二元「只读/可继续」）
```
**判定**: ✅ 探测函数 ↔ 表驱动用例连通；与 design AD-CU-8 三态一致。Host/bridge 消费未接线属 phase-3（GAP-001），非本 Spike 断链

### Path 4: IDE SDK create-only 缺口实证（AC-32 IDE gap）
```
Entry (L1 empirical):
  create → dispose → agents.create(sameId)
    → SessionAlreadyExistsError                              ✅
  persistence.open(id,'write') still succeeds                ✅（resume 所用缝）

Static (call-site 对照):
  packages/sdk/server createSession → agents.create only
  → grep: server.ts 无 agents.resume                          ✅ 与报告一致
  packages/ide/ide-bridge: 无 session/resume / continue-capability ✅
  tech-debt GAP-001 → phase-3                                ✅ 缺口已登记，非静默断裂
```
**判定**: ✅ Spike 范围内缺口路径可追踪；产品 Continue 须经 bridge→resume（报告推荐缝 #1）

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `spike-t0b-continue-capability.spec` Path1 | vitest / `run-spike-t0b.sh` | ✅ | `agents.create` / `dispose` / `agents.resume` / `prefixUnchanged` | ✅ |
| `spike-t0b-continue-capability.spec` Path2 | vitest | ✅ | `agents.create({seed,meta})` / `readColdSessionLog` / `continueLinkFromDerive` | ✅ |
| `probeContinueCapability` | AC-28 表驱动 it | ✅ | （纯函数，无 IO） | ✅ |
| `prefixUnchanged` | resume + derive 断言 | ✅ | `JSON.stringify` 前缀切片比较 | ✅ |
| `continueLinkFromDerive` | derive it | ✅ | 返回 `{fromId,toId}`（phase-3 索引消费） | ✅ Spike dry-run |
| `SpikeMockAdapter` | `mountHarness` → `ctx.llm.registerAdapter` | ✅ | AgentLoop generate/stream | ✅ |
| `agents.resume`（core） | Spike L1（非 SDK） | ✅ | `persistence.open('write')` → `setupAndPublish` | ✅ |
| SDK `createSession` | IDE `session/prompt`（产品路径） | ✅ 存在 | **仅** `agents.create`；无 resume | ⚠️ 文档化缺口 |
| ide-bridge resume/probe | 无（未实现） | — | — | ⚠️ GAP-001 → phase-3 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Spike → AgentLoop.resume | `resume({ resumeSessionId })` → same id live | `resume` / `resumeWith` + `open('write')` | ✅ |
| Spike → AgentLoop.create (derive) | `seed` + `meta.parentSession` + `isSeeded` + `inheritedEventCount` | `CreateAgentOptions` 同名字段 | ✅ |
| Spike → persistence | create 已存在 → `SessionAlreadyExistsError` | `SessionAlreadyExistsError` | ✅ |
| Spike → session-query | `readColdSessionLog(persistence, id)` → events + header | 导出 API 存在且被用 | ✅ |
| Probe → AD-CU-8 | 三态 token | `same-id` \| `derive-only` \| `unknown` | ✅ |
| SDK prompt → agents | 同 id 续写 | 仅 create；dispose 后同 id 失败 | ⚠️ 已知；报告 + GAP-001 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| （spec：无 Phase 依赖） | — | — | ✅ |
| `readColdSessionLog`（库 API，0a 同用） | 共享 session-query | 未改签名 | ✅ |
| `agents.resume` / create+seed | 既有 core | **未改** agent-loop（符合 AD-CU-12） | ✅ |
| GAP-001 IDE resume unwired | 本 Phase 登记 | 目标 phase-3 | ✅ 非阻塞债务 |
| design AD-CU-8 修订建议 | spike-report → HG 后回填 | 报告已写；design 正文仍 NOT RUN 文案 | 🟢 Observation（文档回填属 HG，非代码断链） |

## 关键发现
### 🔴 Must-Fix
- （无）端到端 Spike 路径无断裂；跨模块契约一致；未破坏既有 Phase 冻结接口。

### 🟡 Should-Fix
- （无强制）SDK gap 用例以 `agents.create` 失败 + 静态 call-site 对照证明 IDE 缺口，未直接实例化 `HarnessSdkJsonRpcServer`。对 Spike L1 足够；若要加强证据连通性，可在后续加一层薄 SDK dry-run（非本 Gate MUST）。

### 🟢 Observations
- `probeContinueCapability` / `continueLinkFromDerive` 仅挂在 Spike helpers；产品 Host 接线留给 phase-3 + GAP-001，与 spec 排除项一致。
- Gate 主结论 **same-id** 与 core resume 路径连通；derive 路径作为回退演示完整连通，不篡改父前缀。
- `run-spike-t0b.sh` → vitest 入口与 `spike-report.md` / `implementation.md` 引用一致。
- ide-bridge 仍无 `session/resume` / `session/continue-capability`：产品 Continue 在 phase-3 接线前不可达——已登记，非本 Phase 交付断裂。
