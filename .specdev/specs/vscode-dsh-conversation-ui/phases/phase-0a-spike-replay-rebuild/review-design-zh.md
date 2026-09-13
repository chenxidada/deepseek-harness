# 设计一致性审查 — Phase 0a（spike-replay-rebuild）

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-2：回放 = 权威日志**一次性全量**折叠 → 消息流 + Timeline | 是 | `foldMessages` / `foldTimeline` 对单次 `read(0)` / `readColdSessionLog` 全量事件折叠；测试断言无分页 | ✅ |
| AD-CU-2 读缝选型意向 #1：ide-bridge 薄方法 → persistence `open('read')` | 是（报告锁定建议） | `spike-report.md` 推荐 `session/read-log` → `readColdSessionLog`（或 `open('read')` + `interruptedTurnClosers`）；本 Spike **未落地** bridge 帧（允许留给 phase-2） | ✅ |
| AD-CU-2 次选 SDK stdout 只读 / AD-CU-12 / AD-8：不扩 stdout、不改双通道 | 是 | 报告将 SDK stdout 标为 **Avoid / rejected**；未改 `packages/sdk/**`；无新产品 stdout RPC | ✅ |
| AD-CU-2 降级：磁盘不可读 → T-0a FAIL | 是（未触发） | L1 证明 writer `flush`+`close` 后 cold read 成功 → Gate **PASS**，非降级路径 | ✅ |
| AD-CU-6：Diff 仅可恢复 `meta.diffs`；禁工作区冒充 | 是 | `recoverableDiffsFromMeta` 要求 `path`+`newText`+`oldText string\|null`；仅 patch 拒绝；探针不读文件系统 | ✅ |
| AD-CU-6 / AC-77：不完整回合可探测 | 是 | `probeIncomplete`：`openTurnInRaw` 或 cold `turn/end {interrupted}` | ✅ |
| AD-CU-12：禁止改 `packages/core/agent-loop` | 是 | 变更清单显式未改；`agent-loop` / `apps/vscode-dsh/src` / `ide-bridge/src` 无 Spike 期产品改动 | ✅ |
| T-0a PASS 须含「对相关 AD-CU 的更新建议」（至少 AD-CU-2 / ReplayHydrator） | 是 | `spike-report.md`「AD-CU 更新建议」：锁定读缝、`ReplayHydrator` 一次性折叠、可选 `session/stat`；**未擅自改** `design.md`（待人工确认回填） | ✅ |
| Spike 无产品 UI / 无历史 Webview | 是 | 仅 `apps/vscode-dsh/tests/spike-t0a-*` + Gate 报告/脚本；无 `chat-panel` / Webview / MessageStore 产品面 | ✅ |
| 组件名 **ReplayHydrator**；产品落点 `src/replay-hydrator.ts` 在 T-0a 后 | 是 | Spike 原型命名保留；产品路径未提前落地（符合「完整 bridge / 产品 hydrator 留给 phase-2」） | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `spike-t0a-replay-hydrator.ts` | `apps/vscode-dsh/tests/` | ✅ | Spec 优先 L1 探测于 `apps/vscode-dsh/tests`；纯折叠函数，无 UI |
| `spike-t0a-replay-rebuild.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 真实 JSONL persistence 集成路径 |
| `run-spike-t0a.sh` | `phases/.../test-scripts/` | ✅ | 可重复 Gate runner，挂在 Phase 产出下 |
| `spike-report.md`（+ zh） | `phases/phase-0a-spike-replay-rebuild/` | ✅ | 规定交付物 |
| `.cursor/skills/project-{test,build}/SKILL.md` | Cursor skills | ✅（附带） | 非架构面；仅追加复跑命令，不改变依赖方向 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 测试模块 | `spike-t0a-replay-hydrator.ts` | kebab-case + spike 前缀 | ✅ |
| 折叠 API | `foldMessages` / `foldTimeline` / `probeDiffAvailability` | 与探索报告「fold helpers」一致 | ✅ |
| 读缝推荐 | `session/read-log` → `readColdSessionLog` | 对齐 AD-CU-2 例名 + 现有 cold-read 模式 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | hydrator 仅折叠/探测；spec 仅 Gate 实证；无混入 UI/续写 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 测试消费 `session-persistence-jsonl` + `session-query`；未让 core 依赖 `apps/vscode-dsh` |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | 经 persistence / `readColdSessionLog` 公开 API；未侵入 agent-loop 内部 |

## 关键发现
### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- AD-CU-2 原文「次选 SDK stdout」在报告中被建议升格为 **rejected**；这是 T-0a 要求的「更新建议」，且 **未** 直接改写 `design.md`——符合「确认后写入设计修订记录」流程。
- 读缝在意向 #1 上细化为优先 `readColdSessionLog`（内存 interrupted closers），相对裸 `open('read')` 更利于 AC-77；与 repo-exploration Path B 一致。
- dispose 用 persistence 写句柄 close 模拟（未跑完整 agent dispose）属 Spike 偏差说明中的刻意范围；设计上不要求本 Phase 改 agent-loop，与 AD-CU-12 一致。
- Cursor skill 命令补充不在 Phase 产出表内，但不构成架构偏离。

## 越界检查摘要（本视角焦点）

| 禁止项 | 结果 |
|--------|:----:|
| 产品 Conversation / 历史 UI | 未出现 |
| `packages/core/agent-loop` 修改 | 未出现 |
| SDK stdout 方法扩展 | 未出现；报告明确 Avoid |
| ide-bridge 产品帧落地 | 未落地（仅文档选型，符合 Spike） |
