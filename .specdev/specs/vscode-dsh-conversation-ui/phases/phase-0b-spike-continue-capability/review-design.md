# Design Consistency Review — Phase 0b (spike-continue-capability)

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-8：`continueCapability` 仅 `same-id` \| `derive-only` \| `unknown`；禁「只读/可继续」二元标 | 是 | `ContinueCapability` 三态；`probeContinueCapability` 表驱动用例；无二元标 | ✅ |
| AD-CU-8 映射表：Gate PASS 选定 same-id → 顶栏 Continue **可用**（原位续写） | 是 | Gate 结论 **same-id**；报告 AD-CU 更新建议锁定 same-id 路径；列表/Continue 解耦由 capability token 表达 | ✅ |
| AD-CU-8 / T-0b FAIL → 列表不暗示、顶栏 **隐藏**（本 Gate 未走 FAIL） | 是（未触发） | 报告 Degradation 节标明 N/A；AD-CU 建议保留 FAIL 行 fail-closed hide | ✅ |
| AD-CU-8 / AC-66：续写或派生均不改写旧前缀 | 是 | resume / derive 用例均断言 `prefixUnchanged` / parent 事件序列不变 | ✅ |
| AD-CU-8 / AC-67：派生 → 新 id + 「接续自」关联数据 | 是 | `parentSession` + `continueLinkFromDerive({ fromId, toId })`；Gate 主路径仍为 same-id | ✅ |
| AD-CU-12：禁止改 `packages/core/agent-loop`；新行为优先 `apps/vscode-dsh`；bridge 薄适配限 ide-bridge | 是 | 变更仅 tests/helpers + Gate 文档/脚本 + skill 复跑说明；未改 agent-loop / ide-bridge 产品帧 / SDK | ✅ |
| T-0b：不交付 Continue 产品 UI（留给 phase-3） | 是 | 无 `chat-panel` / Webview Continue / `conversation-controller` Continue 接线 | ✅ |
| T-0b PASS 须含「对相关 AD-CU 的更新建议」（至少 AD-CU-8） | 是 | `spike-report.md` §AD-CU update suggestions；**未擅自改** `design.md`（待人工确认回填） | ✅ |
| T-0b 推荐 Host 缝：优先 bridge `session/resume` → `agents.resume`；Avoid 静默 SDK create 复用 | 是 | Recommended Host / probe seam 表 Rank 1–3 + Avoid；与 repo-exploration Path D / ACP 先例一致 | ✅ |
| Spike 探针可仅 tests；宿主层 L1 即可 | 是 | `apps/vscode-dsh/tests/spike-t0b-*` + `run-spike-t0b.sh`；无 L2 强制 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `spike-t0b-continue-capability.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 与 phase-0a `spike-t0a-*` 对称；L1 Gate 实证 | 
| `spike-t0b-continue-helpers.ts` | `apps/vscode-dsh/tests/` | ✅ | 探针/关联/前缀 oracle/Mock 适配器；非产品 `src/` | 
| `run-spike-t0b.sh` | `phases/.../test-scripts/` | ✅ | 可重复 Gate runner | 
| `spike-report.md` (+ zh) | `phases/phase-0b-.../` | ✅ | 规定交付物 | 
| `tech-debt-registry.md` GAP-001 | registry | ✅ | IDE resume 缺口登记到 phase-3 | 
| `.cursor/skills/project-{test,build}/SKILL.md` | Cursor skills | ✅（附带） | 仅追加复跑命令，不改依赖方向 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 测试/助手 | `spike-t0b-continue-*.ts` | kebab-case + spike 前缀（对齐 0a） | ✅ |
| 探针 API | `probeContinueCapability` / `ContinueCapability` | 对齐 design `continueCapability` 字段语义 | ✅ |
| 关联 | `continueLinkFromDerive` / `ContinueLink` | 对齐 design `continueLinks: { fromId, toId }` | ✅ |
| Gate 常量 | `GATE_VERDICT = 'same-id'` | 单一 Gate 结论写入报告 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | helpers = 探测/关联/前缀/Mock；spec = Gate 实证；无混入产品 Continue UI |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 测试消费 agent / persistence / agent-loop；未让 core 依赖 `apps/vscode-dsh` |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | 经公开 `agents.resume` / `agents.create({ seed, meta })`；未侵入 agent-loop 内部实现 |

## GAP-001 登记合理性

| 项 | 评估 |
|----|------|
| 内容 | IDE SDK `create`-only + 无 bridge `session/resume` / continue-capability — 与 exploration Path B、Gate 证据一致 |
| 目标 Phase | `phase-3-restart-continue` — 符合 T-0b「Continue 产品切片仅 phase-3」 |
| 阻塞级 | 🟡非阻塞 — 正确：不阻塞 phase-2；Continue 产品接线是 phase-3 本职，非本 Spike 产品交付 |
| 与 Gate same-id | 一致：Gate 证明 **core** 同 id 续写能力；GAP 记录 **Host 路径未接线**，报告要求 phase-3 先 bridge resume 再上 Continue |

## 关键发现
### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- `probeContinueCapability` 在 `gateVerdict === 'FAIL'` 时返回 `unknown`（AD-CU-8 会话态「禁用」），而 AD-CU-8 Gate FAIL 行要求顶栏 **隐藏**。二者层级不同：Gate 常量 vs 会话 capability。报告已保留 FAIL→hide 建议；phase-3 Host 须 **先** 读 Gate 再消费探针，避免把 FAIL 当成「仅禁用」。
- Gate 选 **same-id** 同时文档化 IDE create-only 缺口，符合 exploration「Gate = 能力，非 AD-CU-9/产品接线」；与 AD-CU-8「优先同 sessionId 续写」一致，未因 SDK 缺口降格 derive-only。
- `design.md` Spike 头仍写 NOT RUN — 符合「确认后写入设计修订记录」；本 Phase 未越权回填。
- Cursor skill 复跑说明不在 Phase 产出表内，但不构成架构偏离（同 phase-0a）。

## 越界检查摘要（本视角焦点）

| 禁止项 | 结果 |
|--------|:----:|
| 产品 Conversation Continue UI | 未出现 |
| `packages/core/agent-loop` 修改 | 未出现 |
| SDK stdout 方法扩展 | 未出现；报告明确 Avoid |
| ide-bridge 产品帧落地 | 未落地（仅文档选型 + GAP-001，符合 Spike） |
| 静默启用 phase-3 Continue 而无 Gate/接线 | 未出现；GAP + AD-CU 建议显式要求 Host resume |
