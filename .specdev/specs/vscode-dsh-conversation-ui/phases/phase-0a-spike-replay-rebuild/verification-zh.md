# Phase 0a 验证报告 — Spike T-0a 权威日志回放重建

## 判决：PASS

Gate T-0a 能力锚点（AC-80 / AC-30·47 / AC-76 / AC-77）在 L1 真跑下均满足；`spike-report.md` 为单一 **PASS** 且含 AD-CU-2/6 回填建议。Reviewer **SHOULD-FIX**（Timeline 全序 oracle、`surfaceOp: replace`、`oldText: null`）未改 implementer 产品测试，但 verifier 独立断言脚本已覆盖并通过，故不降为 PARTIAL。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-80: Gate 报告 + 可复跑脚本 + AD-CU 建议 | spec | `test -f spike-report.md` + V-IND-5 + `run-spike-t0a.sh` | ✅ | 报告 Verdict=**PASS**；含 AD-CU-2/6、`session/read-log`→`readColdSessionLog`、ReplayHydrator；runner exit 0 |
| AC-30/47: 冷读一次性折叠 messages + Timeline | spec + impl suite | `bash .../run-spike-t0a.sh` | ✅ | vitest `Tests 4 passed`；cold events === fixture；roles/texts/seq 单调 |
| AC-30/47: Timeline **全序** oracle（独立） | verifier | `tsx verifier-independent-t0a.mts` V-IND-1 | ✅ | kind/label/callId/hasRecoverableDiffs 五元组 `deepEqual` 期望序列 |
| AC-76: 有/无 diffs + patch-only 拒绝 | spec | implementer vitest AC-76 | ✅ | available true/false；patch-only → `[]` |
| AC-76: `oldText: null` + 缺省 oldText 拒绝（独立） | verifier / Should-Fix | V-IND-3 + V-IND-4 | ✅ | null → recoverable；missing/undefined/patch → `[]`；冷读 JSONL e2e hunkCount=1 |
| AC-77: 开放 turn / interrupted closer | spec | implementer vitest AC-77 | ✅ | raw 无 turn/end；cold `interrupted`；磁盘不变 |
| AC-80 跨 Context list/stat/read | spec | implementer vitest AC-80 | ✅ | 第二 Context 可见同 root session |
| 交付物存在 | spec | `ls`/`test -f` | ✅ | spike-report(+zh)、hydrator、spec、run-spike-t0a.sh |
| 禁止改 agent-loop | constraint | `git status packages/core/agent-loop` | ✅ | 无改动 |

## 独立验证场景（verifier 设计，implementer 未测）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-IND-1 Timeline 完整序列 oracle（非 `.some`） | `tsx .../verifier-independent-t0a.mts` | ✅ |
| V-IND-2 `surfaceOp: 'replace'` 删旧 bar + 参数变化（append 保留双条） | 同上 | ✅ |
| V-IND-3 `oldText: null` 可恢复 vs 缺省/patch 拒绝 | 同上 | ✅ |
| V-IND-4 真实 JSONL cold-read + null-oldText Diff e2e | 同上 | ✅ |
| V-IND-5 spike-report AD-CU 回填字段齐全 | 同上 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 复跑 Gate vitest / shell runner | `run-spike-t0a.sh` | ✅ 4/4 exit 0 |
| 强化 Timeline 比对 | V-IND-1（独立脚本，未改产品测试） | ✅ 行为正确 |
| 补 replace 夹具 | V-IND-2 | ✅ 行为正确 |
| 补 oldText:null 夹具 | V-IND-3/4 | ✅ 行为正确 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| create→append→flush→close → `readColdSessionLog` → `foldMessages`/`foldTimeline`/`probeDiff*` | ✅ | implementer 4 tests + V-IND-4 |
| Writer dispose 后第二 Cordis Context `list`/`stat`/cold-read | ✅ | AC-80 vitest |
| Producer(meta.diffs) → probe → available/hunks（含 null oldText） | ✅ | V-IND-3/4；无 workspace FS |

## Gate / AD-CU 回填核对

| 项 | 状态 |
|----|:--:|
| `spike-report.md` 单一 Verdict **PASS** | ✅ |
| 方法 / 环境 / 可复跑命令 | ✅ |
| AD-CU-2：锁 `session/read-log`→`readColdSessionLog`；ReplayHydrator 一次性折叠；拒 SDK stdout | ✅ |
| AD-CU-6：可恢复 diffs（path + newText + oldText string\|null）；incomplete = raw open turn 或 cold interrupted | ✅ |
| T-0a 状态更新建议（design 头 / Spike Gate） | ✅ |
| design.md 尚未回填（待 HG / 人工确认） | 预期外置；非本 Spike 失败 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| implementer vitest 仍对 step/tool 用 `.some`，未含 replace/null-oldText 夹具 | 🟢 LOW | 行为已由 V-IND-* 证明；建议 phase-2 ReplayHydrator 产品测试吸收（见 registry DEBT-001） |
| ide-bridge `session/read-log` 未落地 | 🟢 LOW | Spec 允许留给 phase-2；报告已选型 |
| 未跑 L2 Extension Host | — | Spec 明确 L1 即可 |

## 问题清单（为何不是 FAIL / 为何可为 PASS）

无阻塞问题。SHOULD-FIX 未改 implementer 夹具，但：
1. AC 能力锚点均有真跑证据；
2. verifier 独立脚本覆盖审查缺口并全部 PASS；
3. 无 CRITICAL/MEDIUM 残余风险 → 判决 **PASS**（非 PARTIAL）。

## Pipeline 合规检查

Pipeline compliance: ✅ 代码与 specs 变更均在 `impl-phase-0a-spike-replay-rebuild` 分支工作区（尚未 commit，符合 HG-3 前由调度者统一提交的约定）。`packages/core/agent-loop` 无改动。

## 验证脚本

| 脚本 | 路径 |
|------|------|
| Gate runner（implementer） | `test-scripts/run-spike-t0a.sh` |
| Verifier 总控 | `test-scripts/run-verifier-t0a.sh` |
| 独立断言 | `test-scripts/verifier-independent-t0a.mts` |

### 复跑命令

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/test-scripts/run-verifier-t0a.sh
```
