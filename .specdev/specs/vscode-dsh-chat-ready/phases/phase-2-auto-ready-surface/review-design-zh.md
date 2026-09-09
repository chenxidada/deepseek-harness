# 设计一致性审查 — phase-2-auto-ready-surface

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**PASS**

> 回炉焦点：`applyInFlight` 期间 hide→show 的可见 epoch / 幂等语义（AD-CR-3）。旧报告已归档至 `.archive/review-design-*.md`。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CR-3**：仅 `conversationViewVisible ∧ hostReady` 执行就绪 | 是 | `maybeApplyReady` 入口与 in-flight settle 后均重检双门闩；失败返回 `{ applied:false, reason:'gated' }` | ✅ |
| **AD-CR-3**：可见→false 递增 `visibilityEpoch` 并清 `readyAppliedForVisibilityEpoch` | 是 | `onVisibilityChanged`：true→false 边沿 `visibilityEpoch += 1` + `readyAppliedForVisibilityEpoch = false` | ✅ |
| **AD-CR-3**：重复可见可再就绪（新 epoch 必须完整 apply） | 是（本回炉关闭缺口） | await `applyInFlight` 后若 `!readyAppliedForVisibilityEpoch` → `return this.maybeApplyReady(options)`，不再早退 `in-flight` | ✅ |
| **AD-CR-3 / AC-6**：同 epoch 幂等 — 已 apply 走 ensure，复用活动空 Tab 不叠空 | 是 | `applyBody`：`readyApplied` → `ensureReadySurface`；仅 `tabs.length===0 \|\| emptyActive` 才 `newConversationOrReuseEmpty` | ✅ |
| **AD-CR-3**：restore **不** Continue、**不**打未读 | 是 | `restoreOpenTabSet({ markUnread:false, autoContinue:false })` + `suppressUnreadForAutoReady` | ✅ |
| **AD-CR-3**：与 Start 解耦 | 是 | Coordinator 无 Start/`request`；Start 成功仅 bind + `onHostReadyChanged` | ✅ |
| **AD-CR-5**：无 workspace → 跳过 restore，直接 New | 是 | `!hasWorkspaceIndex()` → `newConversationOrReuseEmpty` | ✅ |
| **AD-CR-6**：仅活动空 Tab 复用，禁止全局偷换 | 是 | `newConversationOrReuseEmpty` 只查 `getActive()` + `!hasContent`；无 `findEmptyLive` | ✅ |
| **AD-CR-11**：不改 agent-loop | 是 | 本回炉仅改 coordinator + phase2 测试 / skill 文档 | ✅ |
| design 伪代码 latch 字段名 | 是 | `readyAppliedForVisibilityEpoch` / `visibilityEpoch` 与 design `AutoReadyLatch` 一致 | ✅ |

## AD-CR-3 可见 epoch 专项（回炉）

| 场景 | 设计要求 | 实现行为 | 判定 |
|------|---------|---------|:--:|
| hide 边沿 | bump epoch + 清 readyApplied | `onVisibilityChanged(false)` 如上 | ✅ |
| hide→show 在 **无** in-flight 时 | 新 epoch 完整 restore/New | 门闩清后 `maybeApplyReady` → `applyBody` 全路径 | ✅ |
| hide→show **期间** applyInFlight | 新 epoch **不得**被 waiter 吞掉 | settle 后重检；`!readyApplied` 递归再 apply（implementation 关闭的残余） | ✅ |
| 同 epoch 并发 waiter（已 apply） | 幂等，不叠空 Tab | settle 后 `readyApplied===true` → 返回 `in-flight` 或既有 ensure 路径 | ✅ |
| 测试锚定 | — | L1：`hide→show during applyInFlight re-applies for the new visibility epoch`（`restoreCalls >= 2`，`readyApplied === true`） | ✅ |

结论：回炉后可见 epoch 语义与 AD-CR-3「重复可见可再就绪」一致；AC-6 幂等仍由 `readyApplied` + `ensureReadySurface` / `newConversationOrReuseEmpty` 承担，未引入全局偷换。

## 模块/命名/结构审查

### 目录合理性
| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `auto-ready-coordinator.ts` | `apps/vscode-dsh/src/` | ✅ | design 指定落点；与 orchestrator 并列 |
| `phase2-auto-ready.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | epoch 回归挂在既有 Phase 2 套件 |
| `newConversationOrReuseEmpty` | `conversation-controller.ts` | ✅ | AD-CR-6 指定位置；本回炉未改动 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件名 | `auto-ready-coordinator.ts` | kebab-case | ✅ |
| 类 / 方法 | `AutoReadyCoordinator` / `maybeApplyReady` / `ensureReadySurface` | PascalCase / design 伪代码 | ✅ |
| Latch 字段 | `visibilityEpoch` / `readyAppliedForVisibilityEpoch` | design `AutoReadyLatch` | ✅ |
| 并发门闩 | `applyInFlight` | 实现细节；不违背 latch 契约 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块做一件事 | ✅ | epoch 修复仍在 coordinator 内；未渗入 Start FSM / controller |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 仍经 `AutoReadyDeps` 注入；controller 不依赖 coordinator |
| §2.3 接口隔离 | 明确接口交互 | ✅ | 门闩字段与 `maybeApplyReady` 公开契约未破坏 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
1. **in-flight 递归再入**是 AD-CR-3「新可见周期必须再就绪」的合理实现，比静默 `return in-flight` 更贴近设计；非架构偏离。
2. **既有偏差 1/2**（DEBT-002 README 等价；`markUnread`/`autoContinue` 显式恒 false）仍适用，不削弱 AD-CR-3 epoch / 幂等。
3. **DEBT-003** 仍指向 phase-4；本回炉无新增未注册 `@STUB`。
4. design 伪代码未写 in-flight 合并器；实现补充并发门闩 + epoch 再检，属于设计意图的加固，非矛盾。

## 上游偏差确认

| 上游项 | 设计一致性结论 |
|--------|----------------|
| in-flight epoch 丢 apply（原 Should-Fix / verifier MEDIUM） | ✅ 已关；现符合 AD-CR-3 |
| DEBT-002 / markUnread·autoContinue 偏差 | 仍为已文档化弱化；非 Must |
| DEBT-003 → phase-4 | 范围正确 |

## 总结

Phase 2（含 epoch 回炉）在 **可见门闩、epoch 递增/清除、新 epoch 再 apply、同 epoch AC-6 幂等、Start 解耦** 上对齐 `design.md` AD-CR-3（及 AD-CR-5/6）与 constitution §2。回炉关闭了「in-flight 吞掉新 epoch」的设计缺口；无 Must-Fix / Should-Fix。
