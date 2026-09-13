# Design Consistency Review — Phase 3 (GAP-005..009)

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-5** 关 Tab：dispose session + 未结算交互 fail-closed；按 session 不串台 | 是 | `ConversationController.closeConversation`：`failClosedSession(sessionId)` → `disposeSession` → `registry.close`；`InteractionCoordinator.failClosedSession` 仅 abort 匹配 `entry.sessionId` 的 pending | ✅ |
| **AC-30** 传输关闭/子进程退出：终止 UI 等待、错误态、未结算 fail-closed | 是 | `IdeSessionHost.onTransportDeath`：`status='error'` + `errorMessage` + `failClosedAll` + `notifyError`；Extension `onError` → `showErrorMessage`；UI `AbortSignal` → QuickPick `hide()` | ✅ |
| **AD-4** 终端 answerer；失败不 `next()`；断连/超时/非法 → fail-closed | 是（本轮未改语义） | 债务修复仅补 Host/Extension 观察与关 Tab 路径；answerer 仍在 `ide-bridge`，实现声明无 AD-4 偏差 | ✅ |
| **AD-6** 权限只走 permission-presets | 是（本轮未改） | 无第二套权限权威；GAP 套件不触及 permission 面 | ✅ |
| **AD-2** Bridge 非 stdout | 是 | 交互/错误仍经 Host bridge + Host 本地状态；无审批塞入 SDK stdout | ✅ |
| **AD-8** UI 呈现可替换 | 是 | `InteractionUi` / `InteractionWindow` 抽象 `createQuickPick` / `showInputBox`；AbortSignal 为呈现契约扩展，非 VS Code 硬耦合进 Host 核心 | ✅ |
| 失败模式表：SDK 关闭 → 终止等待、错误态、fail-closed | 是 | GAP-005 补齐此前仅有内部 `error` 状态、缺少用户可见错误展示的缺口，与「错误态」一致 | ✅ |
| AskUser 词汇 `{ selected, custom? }` | 是 | GAP-008 空 options → `showInputBox` → `custom`；取消/空白 → `selected:[]` 无 custom；对齐 `dsh-user-questions` README | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `session-host.ts` (`onError` / `notifyError`) | `apps/vscode-dsh/src/` | ✅ | Host 拥有传输生命周期；错误诊断从 Host 发出符合组件图 |
| `interaction-coordinator.ts` (`failClosedSession`) | `apps/vscode-dsh/src/` | ✅ | pending 等待权威在 Coordinator；按 session 收敛符合 AD-5 |
| `conversation-controller.ts`（关 Tab 顺序） | `apps/vscode-dsh/src/` | ✅ | Controller 编排 Tab 生命周期；先 fail-closed 再 dispose |
| `interaction-ui.ts`（AbortSignal / InputBox） | `apps/vscode-dsh/src/` | ✅ | VS Code 呈现策略层（AD-8） |
| `extension.ts`（`onError` → `showErrorMessage`） | `apps/vscode-dsh/src/` | ✅ | Extension 负责用户可见错误投影 |
| `tests/gap-005-009-debt-fix.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 债务修复测试与既有 gap 套件并列 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件名 | kebab-case (`interaction-coordinator.ts` 等) | 仓库 kebab-case | ✅ |
| `onError` / `notifyError` | 与 Host 观察模式一致 | 生命周期事件 listener API | ✅ |
| `failClosedSession` / `failClosedAll` | 对称命名 | 全量 vs 按 session 语义清晰 | ✅ |
| `createQuickPick` / `showInputBox` | 贴合 VS Code API 面 | InteractionWindow 适配层 | ✅ |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | Host 通知错误；Coordinator abort；Controller 编排关 Tab；UI 呈现；Extension 投影消息 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 仍为 Extension → Host → Coordinator → `InteractionUi`；未反向依赖、未改 `packages/core` |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | `InteractionUi.present*(…, AbortSignal?)`；`onError` disposer；无穿透内部 Map |

## GAP 逐项设计一致性

| GAP | 设计锚点 | 遵循？ | 说明 |
|-----|---------|:--:|------|
| **GAP-005** | AC-30 错误态 / 失败模式表 | ✅ | `onError` 在 status/errorMessage/failClosedAll 之后通知；用户可见 `showErrorMessage` |
| **GAP-006** | AC-30「终止 UI 等待」 | ✅ | AbortSignal 传入 present*；`createQuickPick().hide()` 关闭打开面板 |
| **GAP-007** | AC-10/17 + AD-5 Tab 关联 | ✅ | questions 与 approval 对称 Host→UI→response；`sessionId`→Tab |
| **GAP-008** | user-questions 词汇 + AD-8 UI | ✅ | 空 options 收集 `custom`；合法 `AskUserQuestionAnswer` |
| **GAP-009** | AD-5 关 Tab 未结算 fail-closed | ✅ | 按 session abort，再 dispose，再 registry.close |

## Registry 对照

- GAP-005..009 已从活跃表移至「已解决」；活跃表为空。
- 与 `implementation.md` 债务章节一致；无未登记新桩/缺口（设计面）。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
1. **`pendingInteraction` 仍不在 `ConversationTab` 字段上**：由 `InteractionCoordinator.pending` Map 承担等价职责（前轮审查已接受）；本轮 GAP-009 强化了按 `sessionId` 清理，与 AD-5 一致。
2. **`onError` 未出现在 design.md 实体示意中**：属 Host→Extension 观察面的合理增量，不改变 AD-2/AD-4 通道职责划分。
3. **关 Tab 顺序** `failClosedSession → disposeSession → registry.close` 同时满足 AD-5（未结算 fail-closed）与既有 GAP-003（dispose 成功后再摘 Tab）。

## 总结

GAP-005..009 债务修复在设计上闭合了 **AC-30**（用户可见错误 + 终止打开 UI）与 **AD-5**（关 Tab 按 session fail-closed）的缺口，未引入与 AD-4/AD-6/AD-2 冲突的结构，目录与依赖方向保持既有 Extension Host 分层。**判决：PASS。**
