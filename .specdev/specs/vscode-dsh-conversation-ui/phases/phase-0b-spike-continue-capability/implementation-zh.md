# Phase 0b 实现摘要

## 变更清单（文件列表）

| 文件 | 动作 | 说明 |
|------|------|------|
| `apps/vscode-dsh/tests/spike-t0b-continue-capability.spec.ts` | 新增 | L1 Gate 证据：resume / derive / probe / SDK gap |
| `apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts` | 新增 | `probeContinueCapability`、`continueLinkFromDerive`、`prefixUnchanged`、`SpikeMockAdapter` |
| `.specdev/.../phase-0b-.../test-scripts/run-spike-t0b.sh` | 新增 | 可复跑 vitest 入口 |
| `.specdev/.../phase-0b-.../spike-report.md`（+ `-zh.md`） | 新增 | Gate 报告：结论 **same-id** |
| `.specdev/.../tech-debt-registry.md` | 更新 | 登记 GAP-001 IDE resume 未接线（🟡 → phase-3） |
| `.cursor/skills/project-test/SKILL.md` | 更新 | T-0b 复跑命令 |
| `.cursor/skills/project-build/SKILL.md` | 更新 | Spike 可经 paths 引用 agent-loop 等（无需改 package.json） |

**未改：** `packages/core/agent-loop`、产品 Continue UI、ide-bridge / SDK 生产路径。

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-68** | `spike-report.md` 单一结论 **same-id**；含 AD-CU-8 更新建议；`run-spike-t0b.sh` 可复现 |
| **AC-66** | resume 与 derive 两条路径均断言旧前缀事件序列不变 |
| **AC-67** | derive 用例产出 `parentSession` + `{ fromId, toId }`（Gate 主结论仍为 same-id） |
| **AC-32** | 核心 resume→live 成功；报告标明 IDE SDK create-only 缺口 |
| **AC-28** | `probeContinueCapability` 仅返回三态；用例覆盖 AD-CU-8 映射 |

## 测试结果（命令 + 输出）

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0b-continue-capability.spec.ts
# 等同：bash .../test-scripts/run-spike-t0b.sh
```

```
Test Files  1 passed (1)
     Tests  4 passed (4)
  Duration  ~1.7s
exit 0
```

## 偏差记录

无功能性偏差。下列为相对「产品 Continue 已通」的**有意范围限制**（符合 Spike 约束）：

- **偏差描述：** 未实现 ide-bridge `session/resume` / Continue UI；仅 L1 + 报告推荐缝。
- **影响范围：** spec.md §排除项 / design.md AD-CU-8 Host 接线（phase-3）
- **原因：** Spike 禁止产品 Continue UI；不改 agent-loop；产品改动限 tests/helpers。
- **影响：** phase-3 须按报告接线 resume；登记 GAP-001。

- **偏差描述：** Gate 结论为 **same-id**（核心能力），同时文档化 IDE 路径今日不可达。
- **影响范围：** spec.md AC-32 / design.md AD-CU-8
- **原因：** 探索建议：核心 resume 成立且文档化 IDE 缺口时选 same-id，而非因 SDK 缺口降为 derive-only。
- **影响：** phase-3 交付 Continue 前必须完成 Host resume；derive 作回退已演示。
