# Phase 0b 验证报告 — Spike T-0b Continue Capability

## 判决：PASS

Gate T-0b 正式结论为 **same-id**（PASS）。AC-68/66/67/32/28 在 L1 真跑下满足；`spike-report.md` 含 AD-CU-8 回填建议；GAP-001（IDE resume 未接线）已登记为 🟡非阻塞 → phase-3。Verifier 独立断言（前缀字节 / 三态边界 / IDE create-only / 报告与债务）全部通过。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-68: Gate 报告单一结论 + AD-CU-8 建议 + 可复跑脚本 | spec | `run-spike-t0b.sh` + V-IND-4 | ✅ | Verdict=**same-id** (PASS)；含 AD-CU-8 / `session/resume`→`agents.resume`；runner exit 0 |
| AC-66: resume 后旧前缀事件不变 | spec / impl | vitest AC-66/32 | ✅ | `prefixUnchanged(prefix, after)`；turn 1→2 |
| AC-66: resume 后 JSONL **前缀字节**不变（独立） | verifier | V-IND-1 | ✅ | `afterBytes.subarray(0, prefixLen)` deepEqual `prefixBytes` |
| AC-66/67: derive 父日志不变 + `{fromId,toId}` | spec / impl | vitest AC-66/67 | ✅ | parent events equal；`parentSession`；link banner 数据 |
| AC-32: core `agents.resume`→live | spec / impl | vitest AC-66/32 | ✅ | 同 id followup 成功 |
| AC-32: IDE create-only 缺口 | spec / impl + V-IND-3 | vitest + static | ✅ | dispose 后 create→`SessionAlreadyExistsError`；SDK 无 `agents.resume`；bridge 无 `session/resume` |
| AC-28: 三态探测（无二元只读/可继续） | spec / impl | vitest AC-28 | ✅ | 6 组映射；仅 `same-id`\|`derive-only`\|`unknown` |
| AC-28: derive-only+resume 边界（独立） | verifier | V-IND-2 | ✅ | Gate derive-only + resumeApiAvailable:true → 仍 `derive-only` |
| GAP-001 登记 | debt | V-IND-4 + registry | ✅ | `tech-debt-registry.md` GAP-001 → phase-3-restart-continue，🟡 |
| 禁止改 agent-loop | constraint | `git status packages/core/agent-loop` | ✅ | 无改动 |

## 独立验证场景（verifier 设计，implementer 未测）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-IND-1 磁盘 JSONL 前缀**字节**在 resume 追加后不变（非仅事件 deep-equal） | `tsx verifier-independent-t0b.mts` | ✅ |
| V-IND-2 `derive-only` + `resumeApiAvailable:true` 仍返回 `derive-only`；缺 session / FAIL → `unknown` | 同上 | ✅ |
| V-IND-3 SDK `server.ts` 仅 `agents.create`；ide-bridge 无 resume / continue-capability 帧 | 同上 | ✅ |
| V-IND-4 spike-report same-id + AD-CU-8 建议 + GAP-001 | 同上 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 复跑 Gate vitest / shell runner | `run-spike-t0b.sh` | ✅ 4/4 exit 0 |
| Gate 结论 same-id 与 AD-CU-8 映射一致 | V-IND-4 + report 读 | ✅ |
| GAP-001 已登记且非阻塞 | registry + V-IND-4 | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| create→turn→dispose → `agents.resume` → followup → 读 JSONL 前缀字节 + 事件 | ✅ | impl AC-66/32 + V-IND-1 |
| parent create→dispose → seed create(child) → parent cold-read 不变 + link | ✅ | impl AC-66/67 |
| `probeContinueCapability` Gate/facts → AD-CU-8 三态 | ✅ | impl AC-28 + V-IND-2 |
| IDE SDK create-only（静态 + dispose 后 create 失败） | ✅ | impl gap test + V-IND-3 |

## Gate / AD-CU 回填核对

| 项 | 状态 |
|----|:--:|
| `spike-report.md` 单一 Verdict **same-id** (PASS) | ✅ |
| 方法 / 环境 / 可复跑命令 | ✅ |
| AD-CU-8：锁 T-0b=PASS(same-id)；探针三态；Host 需 `session/resume`；derive 作 fallback | ✅ |
| T-0b 状态更新建议（design 头 / Spike Gate） | ✅ |
| design.md 尚未回填（待 HG / 人工确认） | 预期外置；非本 Spike 失败 |
| GAP-001 IDE resume unwired → phase-3 | ✅ |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| IDE/product Continue 今日仍不可达（无 bridge resume） | 🟢 LOW | 已登记 GAP-001；Gate 证明的是 core 能力，产品接线属 phase-3；非 Gate FAIL |
| 探针将 Gate FAIL 收成 `unknown`（design Observation） | 🟢 LOW | phase-3 Host 须先读 Gate 再消费探针；不阻断本 Spike |
| 未跑 L2 Extension Host | — | Spec 明确 L1 即可 |

## 问题清单（为何不是 FAIL / 为何可为 PASS）

无阻塞问题：
1. Gate 结论 **same-id** 有 L1 真跑证据（resume 前缀不变）；
2. AD-CU-8 回填建议齐全；GAP-001 已登记；
3. Verifier 独立场景（字节前缀 / 三态边界 / IDE 缺口）全部 PASS；
4. 无 CRITICAL/MEDIUM 残余风险 → 判决 **PASS**。

## Pipeline 合规检查

Pipeline compliance: ✅ 代码与 specs 变更均在 `impl-phase-0b-spike-continue-capability` 分支工作区（尚未 commit，符合 HG-3 前由调度者统一提交的约定）。`packages/core/agent-loop` 无改动。

## 验证脚本

| 脚本 | 路径 |
|------|------|
| Gate runner（implementer） | `test-scripts/run-spike-t0b.sh` |
| Verifier 总控 | `test-scripts/run-verifier-t0b.sh` |
| 独立断言 | `test-scripts/verifier-independent-t0b.mts` |

### 复跑命令

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-0b-spike-continue-capability/test-scripts/run-verifier-t0b.sh
```
