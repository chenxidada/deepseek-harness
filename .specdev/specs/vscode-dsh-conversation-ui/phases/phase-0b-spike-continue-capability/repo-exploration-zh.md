# 代码库探索报告 — phase-0b-spike-continue-capability

## 1. Task Context

Phase 0b 是 Spike Gate **T-0b**（状态：**NOT RUN**）：在无产品 Continue UI 的前提下，证明 DSH 是否能在**同一 `sessionId` 的权威日志上续写且不改写已提交前缀**；若不能（或 IDE Host 路径够不到该 API），是否可用 **derive-only** 派生新 id，并给出可持久化的 from→to 关联（AC-67 / AD-CU-8）。Gate 须给出单一结论（`same-id` | `derive-only` | FAIL），定义 `continueCapability` 探测语义（`same-id` / `derive-only` / `unknown`），并为 phase-3 推荐 Host 缝。本探索梳理 persistence 重开写、`agents.resume`、IDE SDK 仅 create 的缺口、fork/seed 派生原语，以及能力元数据应挂在何处——便于 implementer 跑 L1 证据，且不改 `agent-loop`、不交付 Continue UI。

## 2. Repository Overview

- **语言 / 运行时：** TypeScript ESM，Node `^22.19 || >=24`，Cordis 插件组合。
- **包管理：** pnpm workspaces（`packages/<group>/<pkg>/`，应用在 `apps/`）。
- **权威日志：** `@deepseek-ai/dsh-session` 事件流；经 `@deepseek-ai/dsh-session-persistence` + JSONL 后端持久化。语义：**仅追加、seq 连续**；写者不改写已有事件；先前写句柄关闭后 `open(id,'write')` 从已存 next-seq 续写。
- **同 id 热恢复 API：** `@deepseek-ai/dsh-agent` 的 `ctx.agents.resume({ resumeSessionId })`，由 `@deepseek-ai/dsh-agent-loop` 实现 → `persistence.open(id,'write')` + 读日志 + 可选耐久追加 `interruptedTurnClosers` + 以 `source: 'resume'` 发布。
- **今日 IDE Host 路径：** `apps/vscode-dsh` → SDK stdout JSON-RPC（`initialize` / `session/prompt` / `shutdown`）+ `packages/ide/ide-bridge` NDJSON（`session/dispose`、审批、permission）。**SDK server 始终 `agents.create`，从不 `agents.resume`。**
- **冷读先例（phase-0a PASS）：** `readColdSessionLog` + `apps/vscode-dsh/tests/spike-t0a-*` — 可复用为前缀不变性夹具风格。
- **code2prompt：** 本环境不可用；探索采用定向 glob/grep + 读文件（👁）。相对 phase-0a 探索，本报告聚焦 **continue/resume/derive**。

## 3. Most Relevant Areas

| 区域 | 路径 | 原因 | 来源 |
|------|------|------|------|
| Persistence 重开写契约 | `packages/session/session-persistence/tests/contract.ts` | close 后 `open(id,'write')` 从 next-seq 续写；已存在 id 的 create 拒绝（`SessionAlreadyExistsError`） | 👁 |
| Persistence Service Definition | `packages/session/session-persistence/src/index.ts`, `errors.ts` | `create` / `open('read'\|'write')` / `stat` / `list`；仅追加契约 | 👁 |
| AgentLoop resume | `packages/core/agent-loop/src/index.ts`（`resume` / `resumeWith`） | 生产同 id 续写：开写 → 读 → closers → 发布 | 👁 |
| Resume 证据套件 | `packages/core/agent-loop/tests/resume.spec.ts` | dispose 释放写所有权；跨生命周期 resume；interrupted closers 追加在前缀之后 | 👁 |
| CreateAgentOptions seed/fork meta | `packages/core/agent/src/index.ts` | 派生用 `parentSession`、`isSeeded`、`seed`、`inheritedEventCount` | 👁 |
| 内存 fork 助手 | `packages/core/session/src/index.ts`（`SessionStore.fork`） | 新子 id + 种子前缀 + `parentSession` / `isSeeded` | 👁 |
| Persistence 文档（resume vs fork） | `docs/subsystems/persistence.md` | 明确：resume = `agents.resume`；fork/回放 = `agents.create({ seed, meta })` | 👁 |
| SDK 仅 create 的会话打开 | `packages/sdk/server/src/server.ts`（`createSession`、`disposeSession`、`getOrCreateSession`） | IDE prompt 路径从不 resume；dispose 先清 Map 再 dispose，后续 prompt **重新 create** | 👁 |
| ACP resume 参照 | `packages/acp/acp/src/session.ts`, `packages/acp/acp/src/index.ts` | 已在用的 `agents.resume` 产品消费者（`session/resume`）— IDE 缝模板 | 👁 |
| ide-bridge 帧 | `packages/ide/ide-bridge/src/types.ts`, `index.ts` | 现有 Host dispose；尚无 resume / continue-probe 帧 | 👁 |
| VS Code Host 接线 | `apps/vscode-dsh/src/session-host.ts`, `conversation-controller.ts` | Tab 关闭**当前**调用 `disposeSession`（与未来 AD-CU-9 意图矛盾） | 👁 |
| 设计 Continue 类型 | `.specdev/specs/vscode-dsh-conversation-ui/design.md` | `continueCapability`、`continueLinks`、AD-CU-8、T-0b | 👁 |
| Phase-0a 冷读 Spike | `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts`, `spike-t0a-replay-hydrator.ts` | L1 夹具模式；`readColdSessionLog` 作前缀 oracle | 👁 |
| Subagent fork（相关，非产品 Continue） | `packages/subagent/subagent-fork-in-process/` | 从父已完成回合前缀种子化**新**子会话 — 证明派生数据模型，非 UI Continue | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — persistence + agent-loop 同 id 续写（✅ 可用；Spike L1 主路径）

```
生命周期 1：
  agents.create({ sessionId })
    → persistence.create(header) → 取得写所有权
    → live followup → session/event → handle.append（+ flush）
    → AgentHandle.dispose → handle.close  （物化日志保留）

生命周期 2（同 id，新进程或 dispose 后）：
  agents.resume({ resumeSessionId })
    → persistence.open(id, 'write')     # 从 next-seq 续写
    → handle.read(0)                    # 已提交前缀
    → 可选 append(interruptedTurnClosers)  # 仅尾部修复
    → setupAndPublish(..., source: 'resume')
    → 后续 followup 追加在前缀之后

前缀不变性：
  resume 追加前后 open('read') / readColdSessionLog
  → events[0..prefixLen) 事件/字节相等
```

✅ CONFIRMED：契约 + `resume.spec.ts`（所有权释放、跨生命周期 resume、closers 追加在已提交前缀之后；撕裂尾截断后继续）。

### Path B — 今日 IDE SDK / vscode-dsh prompt 路径（❌ 无同 id resume）

```
Extension IdeSessionHost.prompt(sessionId)
  → SDK JSON-RPC session/prompt
  → HarnessSdkJsonRpcServer.getOrCreateSession
      Map 命中 → 复用 live handle
      否则 → createSession → agents.create({ sessionId })   # 从不 resume
  → agent.followup

Tab 关闭后（当前代码）：
  ConversationController.closeConversation
    → bridge session/dispose
    → disposeSession: Map.delete → handle.dispose
  之后同 sessionId prompt → 再次 agents.create
    → persistence.create → 若日志已物化则 SessionAlreadyExistsError
```

✅ CONFIRMED：`server.ts` 仅 create；dispose 注释写明后续 prompt **recreate**。Persistence `create` 拒绝已存在 id。因此**产品 Continue 不能仅依赖今日 SDK prompt** 在 dispose 后做同 id 续写。

⚠️ 注意：AD-CU-9 设计「关 Tab ≠ dispose」；当前 `closeConversation` 仍 dispose — 属相对设计的 phase-1 债务。Spike 应覆盖「仍在 Map 中 live」与「已 dispose + resume」两种场景；Gate 结论谈**能力**，不交付 AD-CU-9。

### Path C — Derive-only（新 id + 关联）

```
选项 C1 — 权威 header 上的耐久 fork 谱系：
  readColdSessionLog(oldId) / open('read')
  → agents.create({
       sessionId: newId,
       seed: balancedCompletedTurnPrefix(events),  # 或完整已平衡日志
       inheritedEventCount: seed.length,
       meta: { parentSession: oldId, isSeeded: true, cwd }
     })
  → 旧日志不动；新 header.parentSession = oldId

选项 C2 — 仅扩展索引关联（设计已草绘）：
  ExtensionIndexStore.continueLinks: { fromId, toId }[]
  + SessionIndexEntry.parentSessionId?
  → 经正常 SDK create(newId) 开空会话
  → UI banner「新会话 · 接续自 …」来自索引（AC-67）
```

✅ CONFIRMED 原语：`CreateAgentOptions.seed` + `meta.parentSession`/`isSeeded`；`SessionStore.fork`；subagent-fork 已完成回合前缀。C2 字段**仅在设计中** — 尚无 ExtensionIndexStore 实现。

### Path D — 产品 Host 缝意向：Continue + 探测（未实现）

```
Extension Continue / 历史列表
  →（优先）ide-bridge 薄帧：
        session/resume { sessionId }           # 同 id → agents.resume
        session/continue-capability { id }     # → same-id | derive-only | unknown
        session/derive-continue { fromId }     # 可选：创建种子子会话并返回 toId
  → 或在 bridge 落地前用 Gate 常量能力
  → Tab：同一 tabId，仅成功后 mode replay→live（AD-CU-8 / AC-32）

避免：扩展 SDK stdout 方法集（AD-8 封闭：initialize / session/prompt / shutdown）
```

参照消费者：ACP `session/resume` → `AcpSession.resume` → `agents.resume`。

## 5. Likely Impact Surface

| 面 | 0b 是否改动？ | 风险 | 说明 |
|----|---------------|------|------|
| `spike-report.md` + L1 vitest/脚本 | **是（必需）** | 低 | 对照 T-0a，放在 `apps/vscode-dsh/tests/` |
| `packages/core/agent-loop` | **禁止** | — | Spec：不改 agent-loop；原样消费 `resume` |
| `packages/sdk/server` create→resume | 可选原型 **或** 仅文档推荐 Host | 未锁定设计时高 | Spike 可证明缺口而不修复；由 phase-3 + AD-CU 更新决定 |
| `packages/ide/ide-bridge` resume/probe 帧 | 可选薄原型或仅报告 | 中 | 优先像 T-0a 对 `session/read-log` 一样写推荐帧 |
| `apps/vscode-dsh` Continue UI / Webview | **否** | — | Spec 禁止产品 Continue UI |
| 扩展索引 `continueLinks` / `continueCapability` | 设计态直至 phase-3 | Spike 低 | Spike 可在测试内存中 dry-run 关联结构 |
| Persistence / session-query | 优先原样消费 | 低 | 前缀 oracle 用 `open('read')` / `readColdSessionLog` |
| phase-2 ReplayHydrator / DEBT-001 | 无关 | — | 对本 Phase 非阻塞 |

## 6. Existing Constraints / Conventions

- **权威日志仅追加：** 不改写已提交前缀；撕裂尾在写打开时截断；读者永不看到撕裂记录（`session-persistence` 契约）。
- **同 id 热恢复 = `agents.resume`：** 见 `docs/subsystems/persistence.md` 与 agent-loop README；create 用于全新或带种子的**新**身份。
- **Fork/派生 = 新 sessionId**，可选 `seed` + `parentSession` + `isSeeded` + `inheritedEventCount` — 不修改父日志。
- **SDK stdout 方法集封闭**（AD-8）：Host 每会话生命周期已走 **bridge**（`session/dispose`）；resume/probe 应同通道。
- **AD-CU-8：** 列表暗示与顶栏 Continue **解耦**；禁止「只读/可继续」二元标；T-0b FAIL → 隐藏 Continue。
- **AD-CU-12：** 不改 `agent-loop`；优先 `apps/vscode-dsh` + 薄 `ide-bridge`。
- **Model-visible ⟺ logged：** Continue 不得伪造助手正文；派生 seed 必须是已校验的连续平衡事件。
- **测试：** 行为向 vitest 放在 app/package `tests/`；Gate 用 L1 即可（不要求 L2 Extension Host）。夹具在 dispose 前先 flush（T-0a 经验）。
- **对 AC-66 的 interrupted resume 说明：** resume 可能向**尾部追加**合成 closers；这不是改写旧前缀 — Spike 在 closers 场景下应断言前缀相等，而非整日志相等。

## 7. Risks / Unknowns

| 项 | 确认度 | 说明 |
|----|:------:|------|
| Persistence 同 id 重开写保留前缀并从 next-seq 追加 | ✅ CONFIRMED | `contract.ts` + 存储语义 |
| `agents.resume` 在 dispose 后恢复同 id 并可继续 | ✅ CONFIRMED | `resume.spec.ts` 多生命周期 |
| IDE SDK 路径不调用 resume；dispose 后对已物化日志 create 失败 | ✅ CONFIRMED | `server.ts` + `SessionAlreadyExistsError` |
| ACP 已将 resume 接成产品模式 | ✅ CONFIRMED | `AcpSession.resume` / `session/resume` |
| Gate 应判 **same-id**（核心具备）还是 **derive-only**（IDE 路径未通） | ⚠️ HYPOTHESIS | Spec 要求 DSH 能力 + Host 推荐；建议：若 Spike 证明 resume 路径并文档化 IDE 缺口与 phase-3 bridge/SDK 修复，则核心 **same-id PASS**；仅当产品策略拒绝 resume 时选 derive-only |
| 最佳派生 seed 切分（全量日志 vs 已完成回合前缀 vs 空会话+仅 UI 链接） | ⚠️ HYPOTHESIS | Subagent-fork 用已完成回合前缀；Continue UX 可能要完整可回放历史 — Spike 至少试一种种子 create + 一种仅链接 dry-run |
| 当前关 Tab 会 dispose（相对 AD-CU-9） | ✅ CONFIRMED（代码） | 影响「进程内无 resume 的 Continue」；产品 phase-1 需对齐 |
| 多窗口 / 多进程写租约是否阻塞 resume | ❓ UNKNOWN | 所有权为进程内；Gate 单进程即可 |
| IDE 模型在 resume 后的 KV-cache / 请求重建 | ❓ UNKNOWN | 除非 Gate 需要「prompt 成功」，否则 L1 用 mock adapter |
| Host 探测精确挂点（bridge vs Extension Gate 常量） | ⚠️ HYPOTHESIS | 设计允许列表元数据来自探测；建议 per-session 真相走 bridge 探测，默认 fail-closed 为 `unknown` |

## 8. Uncertain / Unverified

- **端到端 ide profile：** create → prompt → dispose → resume → prompt 在真实 `dsh --profile ide` 组合下 — 本探索未执行；意向 Gate 路径为 L1 + `persistentHarness` / JSONL 挂载（同 T-0a）。
- **真实 persistence 下 SDK dispose 后 recreate：** 由 create + `SessionAlreadyExistsError` 推断；Spike 应在同一 root 上**实证** create 失败且 resume 成功。
- **`SessionStore.fork` vs `agents.create({seed})` 做耐久派生：** fork 助手创建内存子会话；Continue 的耐久派生应走挂载 persistence 的 `agents.create` 以使子会话物化 — 不可假设仅 `sessions.fork` 就会落盘。
- **父会话开放/不完整回合上的平衡 seed 校验失败** — resume closers 与 derive seed 要求不同；Spike 对 derive 用**已完成**前缀夹具，对 resume closers 用单独 interrupted 夹具。
- **Extension workspaceState 索引形态** — 仅设计态；phase-3 前勿当作权威关联库。
- **Python SDK「复用 id 以继续」文案**（`docs/user/guide/python-sdk.md`）— 指多次 `run()` 间复用**同一 live Map 会话**，不是经 SDK 协议在 dispose 后 resume。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-001 | `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts`：Timeline `.some` / 缺 replace 与 null-oldText 夹具 | 🟡非阻塞；目标 phase-2 | 仍用 `.some` 做 step/tool 存在性（约 65–66 行）；无产品 Continue 桩 | ✅ 匹配（与本 Phase 无关；非 🔴） |
| — | `apps/vscode-dsh` Continue / `continueCapability` 探测 | 未注册 | **不存在**（仅设计名） | 🟡 能力缺口，非桩 |
| — | `packages/sdk/server` resume | 未注册 | 今日设计即为仅 create | 🟡 能力缺口，非桩 |
| — | `packages/ide/ide-bridge` session/resume | 未注册 | 无 resume/probe 帧 | 🟡 能力缺口，非桩 |

### Stub Detection Summary

- ✅ Confirmed stubs：**0**（无指向本 Phase 的 STUB；DEBT-001 是测试债，不是空壳 Continue 实现）。
- ⚠️ Registry mismatch：**0**
- 🔴 Unregistered stubs：**0**（续写路径未见 `@STUB` / 空 Continue 处理函数）。
- 🟡 能力缺口（写入 Spike；仅当 Gate FAIL 或故意留占位时再注册 GAP/DEBT）：
  - IDE SDK/`session/prompt` 无法 resume 已物化且已 dispose 的会话。
  - bridge / 扩展索引尚无 `continueCapability` 探测 API。
  - 尚无 `continueLinks` 持久化实现（仅设计草图）。
- Phase Entry Gate：**无目标为 phase-0b 的 🔴 债务**。

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/core/agent-loop/src/index.ts`（`resume` / `resumeWith` / `createStoredSession`）
2. ⭐ MUST READ — `packages/core/agent-loop/tests/resume.spec.ts`（dispose → 重开写；多生命周期 resume；closers）
3. ⭐ MUST READ — `packages/sdk/server/src/server.ts`（`createSession`、`disposeSession`）— IDE 缺口
4. ⭐ MUST READ — `.specdev/specs/vscode-dsh-conversation-ui/design.md` AD-CU-8 / T-0b；phase `spec.md` AC 表
5. 🔷 SHOULD READ — `packages/acp/acp/src/session.ts`（`AcpSession.resume`）— Host 接线模板
6. 🔷 SHOULD READ — `packages/session/session-persistence/tests/contract.ts`（重开写 / AlreadyExists）
7. 🔷 SHOULD READ — `docs/subsystems/persistence.md`（resume vs create+seed）
8. 🔷 SHOULD READ — `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts` + `packages/session-query/.../cold-read.ts`（前缀 oracle 模式）
9. 🔹 OPTIONAL — `packages/ide/ide-bridge/src/types.ts`（resume/probe 帧挂点）
10. 🔹 OPTIONAL — `packages/core/agent/src/index.ts` CreateAgentOptions；`packages/subagent/subagent-fork-in-process/` 种子切分

### Spike 探针入口文件（建议）

| 优先级 | 文件 | 角色 |
|--------|------|------|
| **1 — 主 L1 harness** | `apps/vscode-dsh/tests/spike-t0b-continue-capability.spec.ts`（新建；对照 T-0a） | Gate 证据：前缀 oracle + resume + create 失败 + 派生关联 |
| **2 — 可选 helpers** | `apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts` | 共享前缀快照 / 能力枚举 / 派生 link 结构 |
| **3 — oracle / 对照** | `packages/core/agent-loop/tests/resume.spec.ts` | 勿改；引用为生产 resume 行为 |
| **4 — 缺口证明** | `packages/sdk/server/src/server.ts` | 静态证据仅 create；必要时加聚焦测试 |
| **5 — Gate 主体避免** | `packages/ide/ide-bridge` 产品帧 | 报告推荐 API；仅当 Spike 选择原型时再实现 |

### 建议 L1 方法（无需 Extension Host）

1. 临时 root + 挂载 JSONL persistence（和/或带 mock adapter 的 agent-loop `persistentHarness`）。
2. **前缀夹具：** create → 追加已完成平衡回合 → flush → dispose/close → 快照 events（及可选原始字节）为 `prefix`。
3. **同 id 路径：** `agents.resume(sameId)` → 再追加一回合 → 冷读 → 断言 `events.slice(0, prefix.length) === prefix`（AC-66）且后续 seq 连续。
4. **SDK/create 缺口：** dispose 后 `agents.create(sameId)`（或 persistence.create）→ 期望 `SessionAlreadyExistsError` / already-exists — 说明仅靠 IDE prompt 不够。
5. **派生路径：** `agents.create(newId, { seed: prefix, meta: { parentSession: oldId, isSeeded: true }, inheritedEventCount })` → 断言旧冷读不变；新 header.parentSession / link `{ fromId, toId }` 足以驱动 UI banner（AC-67）。
6. **continueCapability 探测草图：** 由（Gate 结论 ∧ session.stat 存在 ∧ resume 可用标志）返回 `'same-id' | 'derive-only' | 'unknown'`；映射 AD-CU-8 表（AC-28）。
7. 写入 `spike-report.md`：单一结论 + **AD-CU-8 更新建议**（探测缝、IDE resume 要求）。

### 推荐 Host / 探测缝（供 spike-report 回填 AD-CU）

| 排序 | 缝 | 判定 |
|------|-----|------|
| **1 — 优先同 id 产品** | ide-bridge `session/resume` → `ctx.agents.resume`（ACP 模式）；可选 `session/continue-capability` | 解锁 AD-CU-8 `same-id`；保持 SDK stdout 封闭 |
| **2 — 派生回退** | bridge 或 Extension：建新 id + 持久化 `continueLinks` / `parentSession` | 若产品拒绝 resume，则 AD-CU-8 `derive-only` |
| **3 — 仅 Spike 证明** | vitest 内直接 `agents.resume` / persistence | 足以作 Gate 证据 |
| **避免** | dispose 后静默 SDK `create` 复用；改写旧 JSONL；二元「只读/可继续」标签 | 违反 AC-66/28 与现行 persistence 规则 |

---

*探索模式：phase-0b 首次探索（相对 phase-0a 更新焦点）。Registry：仅 DEBT-001（phase-2，🟡）。Spike Gate T-0b NOT RUN。*
