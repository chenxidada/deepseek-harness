# 设计一致性审查 — Phase 3（phase-3-review-revert-replay）

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-3 · 快照/审阅仅扩展本地；禁权威日志明文 | 是 | `change-index.ts` 写入 `<storageRoot>/changes/<sessionId>/index.json`；列表载荷无 old/new；`sanitizeReason` | ✅ |
| AD-CCD-6 / N-4 · 索引 Must；prune 后不伪造；删会话清目录 | 部分 | 索引持久化 + 冷启动 hydrate + get-diff unavailable + 删会话清盘/内存均有；但 prune **未**挂 settle/write；**未**保护 openTabSet/unreverted | 🟡 |
| AD-CCD-6 · LRU：已 reverted 优先，再最旧 session | 是（算法） | `pruneToBudget` fullyReverted 优先再 mtime；缺产品调用点 | ✅ / 🟡 |
| AD-CCD-7 · 禁改 agent-loop | 是 | 仅改 `apps/vscode-dsh`；无 agent-loop diff | ✅ |
| AD-CCD-10 · 文档层/fs；turn 倒序；后续变更确认 | 是 | `createRevertWorkspace` + `orderChangeIdsForBatch` + `confirm-later-changes` | ✅ |
| N-3 / AC-17 · hash ± isDirty；禁仅 mtime | 是 | `analyzeRevertGates` 实现 OR 逻辑 | ✅ |
| AC-11 · 标记已审阅不写盘 | 是 | 仅改 status / 消息投影 / 本地 index | ✅ |
| 附录 A.3 · 存储布局与索引 | 是 | blob 与 `index.json` 同会话目录 | ✅ |
| Constitution §2.4 | 是（产品主路径） | 撤销经 VS Code 文档/`workspace.fs`；状态扩展本地 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `change/revert.ts` | `apps/vscode-dsh/src/change/` | ✅ | 符合 design 产出清单 |
| `change/change-index.ts` | `apps/vscode-dsh/src/change/` | ✅ | A.3 扩展索引 |
| chat-panel / interaction-ui 增量 | 既有模块 | ✅ | 延续 phase-2 模式 |

### 命名规范审查
协议名、gate kind、状态文案均与 design / AC-10 一致。✅

### Constitution §2 检查
§2.1–§2.4 均未违反：职责分离清晰、无 agent-loop 依赖、接口鸭类型隔离、撤销写盘面正确。

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
1. **AD-CCD-6 prune 未挂入产品写路径**：reverted-first 算法已实现，但 settle/write 从不调用，200 MiB 软上限不会自动生效。
2. **openTabSet / unreverted 保留未进入 prune 选择**：超预算时仍可能 prune 打开中的 unreverted 会话。

### 🟢 Observations
- 删会话经 `attributor.clearSession` 间接清 ChangeStore，行为正确、耦合略隐式。
- 「后续变更」确认文案偏 UX，非架构违规。
- L2 Node fs 回退可接受；产品路径优先 VS Code API。

## 范围焦点核对

| 焦点 | 结论 |
|------|------|
| reviewed / revert ADs | ✅ |
| AC-17 gates | ✅ |
| no agent-loop | ✅ |
| snapshot lifecycle | 🟡 主路径齐；auto-prune / openTabSet 缺口 |
| prune reverted-first | ✅ 算法；调用点缺失 → Should-Fix |
| module placement | ✅ |
