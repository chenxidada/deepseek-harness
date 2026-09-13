# Phase 0a 实现摘要 — Spike 权威日志回放重建（T-0a）

## 变更清单（文件列表）

| 路径 | 说明 |
|------|------|
| `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts` | Spike 折叠/探测纯函数（ReplayHydrator 原型：messages / Timeline / Diff / incomplete） |
| `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts` | L1 集成测试：真实 JSONL persistence append+flush+close → cold read → 比对 |
| `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/test-scripts/run-spike-t0a.sh` | 可重复 Gate runner |
| `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/spike-report.md` | Gate 报告（PASS + 证据 + AD-CU 建议） |
| `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/spike-report-zh.md` | 中文镜像 |
| `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/implementation.md` | 本文件 |
| `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/implementation-zh.md` | 中文镜像 |
| `.cursor/skills/project-test/SKILL.md` | 追加 T-0a 测试命令 |
| `.cursor/skills/project-build/SKILL.md` | 追加 T-0a / Node 说明 |

**未改：** `packages/core/agent-loop`、ide-bridge 产品帧、SDK stdout、Conversation UI、`design.md`（仅报告建议回填）。

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-80** | `spike-report.md` 含方法/环境/命令/单一 **PASS**；含 AD-CU-2/6 更新建议；脚本 exit 0 |
| **AC-30 / AC-47** | `foldMessages` + `foldTimeline` 对 `readColdSessionLog` 全量事件一次性折叠；与夹具条数/顺序/角色比对 |
| **AC-76** | `probeDiffAvailability` / `recoverableDiffsFromMeta`：有/无 `meta.diffs` 夹具对照；拒绝仅 patch；不读工作区 |
| **AC-77** | 开放 turn 夹具：`openTurnInRaw` + 冷 `turn/end {interrupted}`；磁盘不变 |
| **交付物** | 报告列出推荐缝：`session/read-log` → `readColdSessionLog`；ReplayHydrator 命名保留 |

## 测试结果（命令 + 输出）

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts
# 等价：bash .specdev/specs/.../phase-0a-spike-replay-rebuild/test-scripts/run-spike-t0a.sh
```

```
Test Files  1 passed (1)
     Tests  4 passed (4)
```

Gate 判决：**PASS**（详见 `spike-report.md`）。

## 偏差记录

无功能性偏差。以下为刻意范围选择（非 FAIL）：

| 项 | 说明 | 影响 |
|----|------|------|
| ide-bridge RPC 未落地 | Spec / 探索允许「完整 bridge 留给 phase-2」；报告写清推荐落点 | design.md AD-CU-2 选型 → 待人工确认后回填；phase-2 实现帧 |
| 夹具 compression=`none` | 为可读性；读路径与默认 `zstd` 同为 persistence API | 无；生产仍走后端解码 |
| dispose 用 write handle close 模拟 | L1 证明「写端退役后磁盘仍可读」；未跑完整 agent-loop dispose | 与 persistence 合同一致；未改 agent-loop |

## 债务

无：Gate **PASS**；无 `@STUB`；未向 `tech-debt-registry.md` 登记 FAIL 项。产品缺口（无 `session/read-log` / 无产品 ReplayHydrator）属 phase-2 计划工作，非本 Spike 桩。
