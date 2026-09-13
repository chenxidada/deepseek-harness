# Spike 报告 — T-0b 续写能力（same-id / derive）

| 字段 | 值 |
|------|----|
| **Gate** | T-0b |
| **结论** | **same-id**（PASS） |
| **日期（UTC）** | 2026-09-08T02:51:48Z |
| **Slug / Phase** | `vscode-dsh-conversation-ui` / `phase-0b-spike-continue-capability` |
| **环境** | Linux；Node 24.3.0（`/usr/local/n/versions/node/24.3.0`）；仓库根目录 |
| **宿主层** | L1（vitest + 真实 JSONL persistence + AgentLoop）；无 Extension Host；无产品 Continue UI |

## 方法

1. 挂载 Cordis harness：LLM + SessionStore + projection + system-prompt + tools + AgentRegistry + `JsonlSessionPersistence`（`compression: 'none'`）+ AgentLoop；注册 `SpikeMockAdapter`。
2. **同 id 路径：** `agents.create` → 完成回合 → `dispose` → `open('read')` 快照前缀 → 同 root 第二 Context → 证明 `agents.create(sameId)` 抛 `SessionAlreadyExistsError` → `agents.resume({ resumeSessionId })` → 再 followup → 断言 `prefixUnchanged`（AC-66）且 turn 编号延续（AC-32 核心）。
3. **派生路径：** 父会话 create/dispose → `agents.create(newId, { seed, parentSession, isSeeded, inheritedEventCount })` → 子 followup → 父冷读不变；`continueLinkFromDerive({ fromId, toId })` 供 AC-67 banner；子 header 携带 `parentSession`。
4. **continueCapability 探测：** `probeContinueCapability({ gateVerdict, sessionExists, resumeApiAvailable })` → `same-id` \| `derive-only` \| `unknown`（AC-28 / AD-CU-8）；禁止「只读/可继续」二元标。
5. **IDE 缺口：** dispose 后 create 失败；写打开仍可用。静态：SDK `createSession` 始终 `agents.create`（从不 `resume`）— 产品 Continue 不能只靠今日的 `session/prompt`。

## 命令（可复跑）

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0b-continue-capability.spec.ts

# 或：
bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-0b-spike-continue-capability/test-scripts/run-spike-t0b.sh
```

**结果：** `Test Files 1 passed | Tests 4 passed`（exit 0）。

## 按 AC 的证据

| AC | 结果 | 证据 |
|----|:----:|------|
| **AC-68** | PASS | 本报告：单一结论 **same-id**；下文含 AD-CU-8 更新建议；上文脚本 |
| **AC-66** | PASS | dispose 后 resume：`after.slice(0, prefix.length)` 与前缀事件相等；派生：子 create+append 后父事件不变 |
| **AC-67** | PASS（演示） | 派生返回新 id；header.`parentSession` + `{ fromId, toId }` 可驱动「新会话 · 接续自 …」（回退路径已证；Gate 选定 same-id） |
| **AC-32** | PASS（核心）/ 缺口（IDE） | 核心：`agents.resume` 同 id 转 live 并可 followup。IDE SDK 今日仅 create → dispose 后同 id create 失败；产品须先加 bridge `session/resume` |
| **AC-28** | PASS | 探测仅返回 `same-id` \| `derive-only` \| `unknown`；映射 AD-CU-8；本 PASS 的 Gate 常量 = `same-id` |

### 夹具 / 用例

| Id / 用例 | 作用 |
|-----------|------|
| `t0b-same-id-resume` | create → dispose → resume → 第二回合；前缀 oracle |
| `t0b-parent` / `t0b-child` | 带 `parentSession` 的 seed 派生 + continue link |
| 探测表 | NOT_RUN/FAIL/无会话/无 resume API → `unknown`；Gate same-id → `same-id`；Gate derive-only → `derive-only` |
| `t0b-sdk-gap` | dispose 后 create 失败；写打开仍可用 |

## 推荐 Host / 探测缝（phase-3）

| 优先级 | 缝 | 发现 |
|--------|-----|------|
| **1 — 优先同 id 产品** | ide-bridge `session/resume { sessionId }` → `ctx.agents.resume`（ACP `AcpSession.resume` 模式）；可选 `session/continue-capability` | 解锁 AD-CU-8 `same-id` Continue；保持 SDK stdout 封闭（AD-8） |
| **2 — 派生回退** | bridge 或 Extension：`agents.create(newId, { seed, meta.parentSession, isSeeded })` + 持久化 `continueLinks` | 若产品拒绝 resume；UI「新会话 · 接续自 …」 |
| **3 — 仅 Spike 证明** | vitest 中直接 `agents.resume` / create+seed（本 Gate） | 足以 PASS |
| **避免** | dispose 后静默 SDK `create` 复用；改写 JSONL 前缀；二元「只读/可继续」 | 违反 AC-66/28 |

**本 Spike 未落地：** ide-bridge 帧、Extension Continue UI、SDK 方法变更（仅文档化缺口）。

## AD-CU 更新建议（Spike → 回填 design）

经 HG 审阅后写入 `design.md`「设计修订记录」：

### AD-CU-8（continueCapability）— 更新

1. **锁定 Gate 结果：** T-0b = **PASS（same-id）**。phase-3 在 Host 接好 resume 后可按同 id 路径交付顶栏 Continue；列表仅用探测 token（`same-id` / `derive-only` / `unknown`）；FAIL 行仍保留 fail-closed 隐藏。
2. **探测挂点：** 优先 ide-bridge `session/continue-capability`（或 bridge 落地前 Gate 常量 `same-id`）写入 `SessionIndexEntry.continueCapability`。缺省 fail-closed：未探测 → `unknown`（列表无暗示；Continue 禁用 + tooltip「暂不可用」）。
3. **IDE 要求：** 产品同 id Continue **必须**经 Host 调到 `agents.resume`（bridge）。今日 SDK `session/prompt` → `agents.create` 在 dispose / 已落盘后不够用。
4. **派生仍可用**作回退 / 关联演示（`continueLinks` / `parentSessionId`）；非本 Gate 主选路径。

### T-0b Spike 状态

更新 design 文头 / Spike Gate 节：**T-0b = PASS（same-id）**（本报告）。phase-3 Continue 切片可在人工确认 AD-CU-8 修订与 Host resume 接线后推进。

## AC-32 说明（同 id → live）

| 表面 | 今日是否可行 |
|------|----------------|
| 核心 `agents.resume`（dispose 后） | **是** — L1 已证 |
| 仅靠当前 IDE SDK prompt | **否** — 仅 create；dispose 后同 id create → `SessionAlreadyExistsError` |
| 推荐产品路径 | bridge `session/resume` → resume → 同 `tabId` `replay→live`（AD-CU-8 / phase-3） |

## 排除项（未改）

- 产品 Conversation Continue UI / Webview
- ide-bridge 帧实现
- SDK stdout 扩方法
- 改动 `packages/core/agent-loop`
- phase-2 ReplayHydrator / DEBT-001

## 降级（若本 Gate 为 FAIL）

不适用 — Gate **PASS（same-id）**。phase-3 Continue 能力上已解阻；交付 UI 前仍需 Host resume 缝。
