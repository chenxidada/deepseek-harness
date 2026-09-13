# Correctness Review — Phase 0b (spike-continue-capability)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 独立复跑

```bash
bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-0b-spike-continue-capability/test-scripts/run-spike-t0b.sh
```

| 项 | 结果 |
|----|------|
| Exit | 0 |
| Files | 1 passed |
| Tests | **4 passed** |
| Duration | ~1.57s |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-68 | Gate 正式结论 + 可复跑证据 + AD-CU 更新建议 | `spike-report.md` Verdict=`same-id`; AD-CU-8 §; `run-spike-t0b.sh` | ✅ | 报告单一结论 **same-id (PASS)**；含 AD-CU-8 四条回填建议；独立复跑 4/4 通过 |
| AC-66 | 续写/派生不篡改已落盘旧前缀 | `spike-t0b-continue-capability.spec.ts` resume+derive tests; `prefixUnchanged` | ✅ | resume：`after.slice(0,prefix)` 事件序列等于 dispose 前快照；derive：parent cold-read 全等；函数体为 `JSON.stringify` 前缀深比较，非空壳 |
| AC-67 | 派生路径可演示 from→to 关联 | derive test + `continueLinkFromDerive` | ✅ | `parentSession`/`isSeeded`/`inheritedEventCount` 断言；`{ fromId, toId }` 可驱动 banner（Gate 主路径仍为 same-id，派生作 fallback demo） |
| AC-32 | 标明同 id 转 live 是否可行 | resume test + sdk-gap test + report AC-32 table | ✅ | Core：`agents.resume` 同 id 续 turn `[1,2]`；IDE：create-only 路径 dispose 后 `SessionAlreadyExistsError`；报告表标明 Core Yes / IDE No |
| AC-28 | 探测三态；对照 AD-CU-8 | `probeContinueCapability` + AC-28 case table | ✅ | 仅返回 `same-id`\|`derive-only`\|`unknown`；NOT_RUN/FAIL/缺会话/无 resume API → `unknown`；与 design AD-CU-8 四态表一致；无二元「只读/可继续」 |

### Gate 结论核对

| 检查项 | 期望 | 实际 | 判定 |
|--------|------|------|:--:|
| 单一 Verdict | `same-id` / `derive-only` / FAIL | **same-id** | ✅ |
| 与测试常量一致 | Gate 与 `GATE_VERDICT` 对齐 | `GATE_VERDICT = 'same-id'` | ✅ |
| AD-CU-8 建议齐全 | Lock Gate / Probe / IDE resume / Derive fallback | 报告 §「AD-CU update suggestions」四条齐全 | ✅ |
| FAIL 债务 | FAIL 才强制阻塞债 | PASS；GAP-001 登记 IDE 接线缺口（🟡→phase-3） | ✅ |

## Stub Detection（桩代码检测）

### 已注册桩 / 缺口（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-001 | `packages/sdk/server/src/server.ts`: `createSession` / `getOrCreateSession`；ide-bridge 无 `session/resume` | ⚠️ Known | 已注册；`createSession` 仍仅 `agents.create`；ide-bridge grep 无 resume/continue-capability — 与 Spike「产品未接线」一致，非未注册桩 |
| DEBT-001 | phase-0a Timeline 测试债 | ⚠️ Known | 属 phase-0a/phase-2；本 Phase 未引入新行为 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | Spike helpers（`probeContinueCapability` / `prefixUnchanged` / `SpikeMockAdapter.stream`）均含真实分支与流逻辑；无 `(void)args` / 硬编码假成功 |

## 关键函数体抽查

| 符号 | 判定 | 说明 |
|------|:--:|------|
| `probeContinueCapability` | ✅ | FAIL/NOT_RUN → unknown；缺会话 → unknown；same-id∧resume → same-id；derive-only → derive-only；其余 unknown |
| `prefixUnchanged` | ✅ | `after.length < before` → false；否则前缀 `JSON.stringify` 深等 |
| `continueLinkFromDerive` | ✅ | 返回 `{ fromId, toId }` 结构（AC-67 关联草图，非产品 UI） |
| `SpikeMockAdapter.stream` | ✅ | 消费 scripted chunks；耗尽抛错；尊重 abort |
| Resume L1 路径 | ✅ | 真实 `JsonlSessionPersistence` + `AgentLoop`；`agents.resume` 后续 followup 追加且前缀不变 |

## 关键发现

### 🔴 Must-Fix
- 无

### 🟡 Should-Fix
- 无（边界与 AC 映射均满足 Spike 范围；IDE 缺口已登记 GAP-001，不构成未满足 AC）

### 🟢 Observations
- AC-32「静态 oracle」对 SDK create-only 主要靠注释 + 运行时 create 失败；未对 `server.ts` 做源码断言。证据足以支撑 Gate，phase-3 接线前可再加只读源码/契约检查。
- AC-66 用事件序列深等（非原始 JSONL 字节哈希）；与 spec「字节/事件序列」表述兼容，且与 persistence append-only 契约一致。
- Gate 选 **same-id** 基于 **core** `agents.resume` 能力；产品 Continue 仍依赖 GAP-001（bridge resume）落地后才可发货 — 与 spike-report / implementation 偏差说明一致，不降级为 derive-only。

## 总结

Spike T-0b 交付物完整：报告结论 **same-id**、AD-CU-8 建议齐全、L1 证据可复跑（4/4）。五条 AC 均有真实代码路径与断言覆盖；无未注册桩。**判决 PASS。**
