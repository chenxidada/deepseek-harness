# Design Consistency Review — Phase 4 (phase-4-timeline-diff)

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-7** 事后 Diff；从 `session.event` 写文件类 tool 结果和/或 git 收集路径；默认非逐步确认 | 是 | `timeline-store.ts` 从 `tool/result` → `meta.diffs` 投影 hunks；`diff-entry.ts` 导出 `DEFAULT_POST_HOC_DIFF_ONLY = true`；`extension.ts` 仅注册 `dsh.reviewWorkspaceDiffs` / `dsh.openTimelineDiff`，无 mid-run write-confirm 命令 | ✅ |
| **扩展只投影，不重实现 loop**（架构摘要 / AD-8 / 包落点禁止改 `agent-loop`） | 是 | 改动仅在 `apps/vscode-dsh/**`；`git status` 无 `packages/core` / agent-loop 变更；`TimelineStore.apply` 只映射 SDK 通知 → UI rows，不执行工具、不写 session log | ✅ |
| **AD-1 / AC-7** 按 `sessionId` 过滤时间线，多 Tab 不串台 | 是 | `getActiveTimelineItems` / Diff 命令用活动 Tab `sessionId` → `itemsForSessionTree` / `writeDiffsForSessionTree`；store 按 session 分桶 | ✅ |
| **AD-2** 时间线走 SDK stdout 通知，不走 Host bridge | 是 | `IdeSessionHost.watchTransport` → `client.subscribe()` → `onNotification` fan-out → `ConversationController.onSdkNotification`；bridge 仍只服务审批/提问/dispose | ✅ |
| **AD-5** Tab↔session；关闭清理本地投影 | 是 | 关 Tab 调 `timeline.clearSession`；shutdown `timeline.clear`；未把 Spec 状态写入时间线 | ✅ |
| **AD-3 / Web UI** 不挂载 `ui-*` 投影栈到 ide | 是 | 新模块不 import `dsh-client-ui-*`；算法本地复刻（`meta.diffs` narrowing），符合 exploration「copy patterns, do not import Web」 | ✅ |
| **包落点** Diff / Timeline 在 `apps/vscode-dsh` | 是 | 新文件：`timeline-store.ts`、`timeline-view.ts`、`diff-entry.ts` + Extension 注册 | ✅ |
| **组件图** DiffEntry / ConversationView 投影面 | 是 | TreeView `dsh.timeline` + Diff content provider `dsh-diff` + 命令入口，对齐既有 Conversations TreeView 模式 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `timeline-store.ts` | `apps/vscode-dsh/src/` | ✅ | 纯投影 store，无 vscode 依赖；职责单一 |
| `timeline-view.ts` | `apps/vscode-dsh/src/` | ✅ | TreeView 适配；与 `conversation-tab-bar` 同层 |
| `diff-entry.ts` | `apps/vscode-dsh/src/` | ✅ | 事后 Diff 打开策略；与 store 解耦 |
| `tests/timeline-*.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 与既有 Extension 测试布局一致 |
| `fake-sdk-runtime.mjs` 扩展 | `tests/fixtures/` | ✅ | 脚本化 `session.event` / Diff meta，服务投影测试，非 runtime 权威源 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件名 | `timeline-store.ts` / `timeline-view.ts` / `diff-entry.ts` | kebab-case | ✅ |
| 类/类型 | `TimelineStore` / `TimelineItem` / `DiffOpenArgs` | PascalCase | ✅ |
| 命令/视图 id | `dsh.timeline` / `dsh.reviewWorkspaceDiffs` / `dsh.openTimelineDiff` | `dsh.*` 前缀，对齐既有命令 | ✅ |
| 常量 | `DEFAULT_POST_HOC_DIFF_ONLY` | SCREAMING_SNAKE 产品默认 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | Store=投影缓冲；View=TreeView；DiffEntry=打开 Diff；Controller=路由+应用通知 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 未反向依赖 core/agent-loop；Extension → SDK client 通知面；无 Web UI 包依赖 |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | Host `onNotification` 订阅面；duck-typed vscode 与 Phase 1–3 一致 |

## Spec / Phase 约束对照

| 约束（spec.md） | 遵循 | 说明 |
|----------------|:--:|------|
| AD-7；事件权威 = session 日志 / SDK 通知；扩展只投影 | ✅ | 权威源为通知流；UI 只投影 |
| 按 `sessionId` 过滤 | ✅ | 活动 Tab tree 过滤 |
| 不把 Spec 状态写入时间线 Must | ✅ | 仅 turn/step/tool/assistant/status/subagent |
| 不在范围：写前确认 / 审批 UI / Spec 面板 | ✅ | 无对应命令或模块 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **Git/SCM-only 路径未实现**：AD-7 / AC-23 允许「tool 事件和/或 git」。本 Phase 仅走 `tool/result.meta.diffs`；无 hunks 时信息提示而非调 git/SCM API。与 `implementation.md` Deviations 一致，仍满足「and/or」与事后 Diff 语义；后续若要 git-only 审阅可加 fallback 而不改命令面。
- **AD-5 散文中的 `timelineCursor`**：正式 `ConversationTab` 接口未要求该字段；实现用 `TimelineStore` 缓冲 + 活动 Tab 过滤，符合 exploration 建议，未引入设计冲突。
- **`void DEFAULT_POST_HOC_DIFF_ONLY`**：命令处理器内引用常量以锁定 AC-24 默认；策略实体在 `diff-entry.ts`，非空壳策略模块。

## Registry 交叉
`tech-debt-registry.md` 活跃表为空；本 Phase 未引入未注册桩或设计偏离债务。
