# 设计一致性审查 — Phase 4（phase-4-timeline-diff）

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-7** 事后 Diff；从 `session.event` 写文件类 tool 结果和/或 git 收集路径；默认非逐步确认 | 是 | `timeline-store.ts` 从 `tool/result` → `meta.diffs` 投影 hunks；`diff-entry.ts` 导出 `DEFAULT_POST_HOC_DIFF_ONLY = true`；`extension.ts` 仅注册 `dsh.reviewWorkspaceDiffs` / `dsh.openTimelineDiff`，无执行中写前确认命令 | ✅ |
| **扩展只投影，不重实现 loop**（架构摘要 / AD-8 / 禁止改 `agent-loop`） | 是 | 改动仅在 `apps/vscode-dsh/**`；无 `packages/core` / agent-loop 变更；`TimelineStore.apply` 只映射 SDK 通知 → UI 行，不执行工具、不写 session 日志 | ✅ |
| **AD-1 / AC-7** 按 `sessionId` 过滤时间线，多 Tab 不串台 | 是 | 活动 Tab `sessionId` → `itemsForSessionTree` / `writeDiffsForSessionTree`；store 按 session 分桶 | ✅ |
| **AD-2** 时间线走 SDK stdout 通知，不走 Host bridge | 是 | `watchTransport` → `subscribe` → `onNotification` → Controller 投影；bridge 仍只服务审批/提问/dispose | ✅ |
| **AD-5** Tab↔session；关闭清理本地投影 | 是 | 关 Tab `clearSession`；shutdown `clear`；未把 Spec 状态写入时间线 | ✅ |
| **AD-3 / Web UI** 不挂载 `ui-*` 到 ide | 是 | 不 import `dsh-client-ui-*`；本地复刻 `meta.diffs` narrowing | ✅ |
| **包落点** Diff / Timeline 在 `apps/vscode-dsh` | 是 | `timeline-store` / `timeline-view` / `diff-entry` + Extension 注册 | ✅ |
| **组件图** DiffEntry / 时间线投影面 | 是 | TreeView `dsh.timeline` + `dsh-diff` content provider + 命令入口 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `timeline-store.ts` | `apps/vscode-dsh/src/` | ✅ | 纯投影 store，无 vscode 依赖 |
| `timeline-view.ts` | `apps/vscode-dsh/src/` | ✅ | TreeView 适配，与 Tab 栏同层 |
| `diff-entry.ts` | `apps/vscode-dsh/src/` | ✅ | 事后 Diff 打开策略，与 store 解耦 |
| `tests/timeline-*.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 与既有 Extension 测试布局一致 |
| `fake-sdk-runtime.mjs` 扩展 | `tests/fixtures/` | ✅ | 脚本化通知供投影测试，非运行时权威源 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 文件名 | `timeline-store.ts` 等 | kebab-case | ✅ |
| 类/类型 | `TimelineStore` 等 | PascalCase | ✅ |
| 命令/视图 id | `dsh.timeline` 等 | `dsh.*` 前缀 | ✅ |
| 常量 | `DEFAULT_POST_HOC_DIFF_ONLY` | SCREAMING_SNAKE | ✅ |

### 宪法 §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | Store / View / DiffEntry / Controller 职责分离 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 无反向依赖 core/agent-loop；无 Web UI 包依赖 |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | Host `onNotification`；duck-typed vscode |

## Spec / Phase 约束对照

| 约束（spec.md） | 遵循 | 说明 |
|----------------|:--:|------|
| AD-7；事件权威 = session 日志 / SDK 通知；扩展只投影 | ✅ | 权威源为通知流 |
| 按 `sessionId` 过滤 | ✅ | 活动 Tab tree 过滤 |
| 不把 Spec 状态写入时间线 Must | ✅ | 仅 turn/step/tool/assistant/status/subagent |
| 不在范围：写前确认 / 审批 UI / Spec 面板 | ✅ | 无对应命令或模块 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **未实现纯 Git/SCM 路径**：AD-7 / AC-23 允许「tool 事件和/或 git」。本 Phase 仅用 `meta.diffs`；与 implementation 偏差说明一致，仍满足事后 Diff。
- **AD-5 散文中的 `timelineCursor`**：正式 Tab 接口未要求；用 `TimelineStore` 缓冲即可。
- **`void DEFAULT_POST_HOC_DIFF_ONLY`**：用于锁定 AC-24 默认；策略定义在 `diff-entry.ts`。

## Registry 交叉
`tech-debt-registry.md` 活跃表为空；本 Phase 未引入未注册桩或设计偏离债务。
