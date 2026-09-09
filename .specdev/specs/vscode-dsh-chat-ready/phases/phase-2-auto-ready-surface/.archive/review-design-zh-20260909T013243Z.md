# 设计一致性审查 — phase-2-auto-ready-surface

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CR-3**：AutoReady 与 Start 解耦；仅 `visible ∧ hostReady` 就绪；hide 增 `visibilityEpoch` 清 `readyApplied`；restore 不 Continue、不打未读 | 是 | `auto-ready-coordinator.ts` 门闩 + epoch；`createStartHostPort.start` 仅 bind + push，无 restore/New（DEBT-001）；`restoreOpenTabSet({ markUnread:false, autoContinue:false })` + `suppressUnreadForAutoReady` | ✅ |
| **AD-CR-5**：无 workspace folder → 跳过 restore，直接 New；Start 仍可跑 | 是 | `hasWorkspaceIndex: () => workspaceFolders.length > 0`；无 folder 分支走 `newConversationOrReuseEmpty` | ✅ |
| **AD-CR-6**：`newConversationOrReuseEmpty` 仅复用**活动**空 Tab；禁止全局偷换；自动/命令共用 | 是 | `conversation-controller.ts` 仅查 `getActive()` + `!hasContent`；无 `findEmptyLive`；`dsh.newConversation` 与 AutoReady 均调用该 API | ✅ |
| **AD-CR-2**（DEBT-002 余力）：活动栏打开 → `request('activity-bar')` + reveal | 部分 / 文档等价 | 生产无独立 container-open 监听；README 声明等价于 Conversation `onDidChangeVisibility`；L2 保留 `openActivityBar`（偏差 1，Entry Gate 允许方案 a） | 🟢 已文档化偏差 |
| **AD-CR-10**：可见性 L2 经生产入口；`dsh.test.triggerAutoReady` | 是 | `fireConversationVisibility` → `handleConversationVisibility` → `onVisibilityChanged`；新增 `dsh.test.triggerAutoReady` | ✅ |
| **AD-CR-11**：不改 agent-loop | 是 | 未改 `packages/core/**/agent-loop*` | ✅ |
| 伪代码：`maybeApply` / `ensureReadySurface` / restore 选项 | 是 | `applyBody` + `ensureReadySurface`（AC-6 幂等）；选项写入签名（偏差 2：行为靠既有 hydrate + suppress） | ✅ |
| STUB-001 → `AutoReadyCoordinator` | 是 | 新文件替代 `AutoReadyLatchSeam`；`connection-ui` / `index` 已切换导出 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `auto-ready-coordinator.ts` | `apps/vscode-dsh/src/` | ✅ | 与 design 文件落点一致；与 `auto-start-orchestrator.ts` 并列 |
| `phase2-auto-ready.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 与既有 phase L2 套件一致 |
| `newConversationOrReuseEmpty` | `conversation-controller.ts` | ✅ | design「修改」清单指定位置 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件名 | `auto-ready-coordinator.ts` | kebab-case | ✅ |
| 类名 | `AutoReadyCoordinator` | PascalCase；替换 LatchSeam | ✅ |
| 方法 | `newConversationOrReuseEmpty` / `maybeApplyReady` / `ensureReadySurface` | 与 design 伪代码一致 | ✅ |
| Latch 字段 | `readyAppliedForVisibilityEpoch` / `visibilityEpoch` | 与 design latch 接口一致 | ✅ |
| 空 Tab 探测 | `messages.hasContent` | D-23 / 前序 persist 约定（非 `findEmptyLive`） | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块做一件事 | ✅ | Start FSM / AutoReady 门闩 / Tab 生命周期分属 orchestrator / coordinator / controller |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | Coordinator 经 `AutoReadyDeps` 注入 `getController`；controller 不依赖 coordinator |
| §2.3 接口隔离 | 明确接口交互 | ✅ | `AutoReadyDeps` / `AutoReadyRestoreOptions` 显式 seam；extension 接线 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无 — 已知偏差均已写入 implementation.md，且不破坏 AD-CR-3/6 架构决策）

### 🟢 Observations
1. **偏差 1（DEBT-002 README 等价）**：相对 AD-CR-2「活动栏容器打开即 `request('activity-bar')`」字面生产接线仍弱；与 repo-exploration 方案 (a) / Entry Gate 一致，且不影响 Phase 2 Must（AD-CR-3/6）。Registry 标「已解决」可接受为流程关闭，若后续要加强活动栏 reason 可在 phase-4 再增强。
2. **偏差 2（markUnread / autoContinue）**：API 显式接受并恒传 `false`，函数体 `void` 后依赖既有 hydrate（本就不 Continue / 不打未读）+ `suppressUnreadForAutoReady`。满足 design「不 Continue、不打未读」语义与 spec「扩展参数或包装」；契约可读，非架构偏离。
3. **suppressUnread 落点**：design 文件清单把「就绪未读抑制」写在 controller 旁注，实现放在 coordinator（与伪代码 `this.suppressUnreadForAutoReady()` 一致）——职责更清晰。
4. **标题文案**：design 伪代码用「新对话」，实现沿用既有英文 `'New conversation'`（与当前 extension 命令文案一致）。
5. **DEBT-003** 仍指向 phase-4，本 Phase 未误关；无新增未注册 `@STUB`。

## 上游偏差确认

| 上游项 | 设计一致性结论 |
|--------|----------------|
| DEBT-002 README 等价关闭 | 不违反 AD-CR-3/6；相对 AD-CR-2 为已文档化弱化，非 Must |
| markUnread/autoContinue 显式 API + 既有 hydrate | 符合 AD-CR-3 意图；非 Must |
| STUB-001 / DEBT-001 已关 | 源码与 registry 一致，架构解耦成立 |
| DEBT-003 → phase-4 | 范围正确，未越权 |

## 总结

Phase 2 实现在**模块划分、Start/就绪解耦、可见门闩、仅活动空 Tab 复用**上对齐 design.md（AD-CR-3/5/6）与 constitution §2。两处实现偏差均为已声明、不削弱核心架构决策的余力/契约显式化选择。
