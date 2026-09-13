# 设计一致性审查 — Phase 3（phase-3-review-revert-replay）

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

> Should-Fix polish 后再审（AC-18 混批 + `sanitizeReason` 元数据化）。上轮 AD-CCD-6 / N-4 闭合保持；本轮焦点：`sanitizeReason` 与 AC-24「仅元数据」精神对齐。`design-zh` AD-CCD-14 同步由调度者已完成，本审查确认无文档冲突。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-3 · 快照/审阅仅扩展本地；禁权威日志明文（AC-24） | 是 | index / change-list 无 old/new；写失败 → `write-failed:${sanitizeReason(...)}`；内容型/超长 → `io-error`（不再截断前缀泄露） | ✅ |
| A.3 · 日志仅元数据与统计 | 是 | 短码直通或 `io-error` / `unknown`；L2 断言正文不进 reason | ✅ |
| Constitution 敏感数据 · 快照/旧文不得明文进扩展日志 | 是 | 同 `sanitizeReason` 硬化 | ✅ |
| AD-CCD-6 / N-4 · 索引 / prune / openTabSet unreverted / 删会话清目录 | 是 | 上轮已闭合；本 polish 未改生命周期 | ✅ |
| AD-CCD-7 · 禁改 agent-loop；主落 vscode-dsh | 是 | 仅 `apps/vscode-dsh` change/ + tests | ✅ |
| AD-CCD-10 · 文档层 / workspace.fs；turn 倒序；后续确认 | 是 | 既有实现保持 | ✅ |
| N-3 / AC-17 · content hash ± isDirty | 是 | 无 mtime 唯一判定 | ✅ |
| AC-11 · mark-reviewed 不写盘 | 是 | 状态 + index only | ✅ |
| Constitution §2.4 · 撤销经 VS Code FS/文档 | 是（产品主路径） | Host 优先文档层 / `workspace.fs` | ✅ |

## 本轮 Should-Fix 闭合（设计视角）

| 项 | AC-24 / 设计精神 | 证据 | 状态 |
|----|------------------|------|:----:|
| `sanitizeReason` 仅截断仍可能泄露正文前缀 | 「日志仅元数据」 | content-like / `len > 80` → `io-error`；L2 `write-failed:io-error` | ✅ 已闭 |
| AC-18 写失败混批 | 无新架构决策；per-id 结果契约不变 | 同批 throw+success；设计边界未漂 | ✅ 无偏差 |
| design-zh AD-CCD-14 | 与 design.md / P2-A `file_path` 对齐 | 调度者已同步；本 Phase 未改引用路径 | ✅ 无冲突 |

## 模块/命名/结构审查

### 目录合理性
| 新文件 / 改动 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `sanitizeReason` 硬化 | `change/revert.ts` | ✅ | 留在写失败路径旁 |
| re-export | `change/index.ts` | ✅ | 公共面一致 |
| AC-18 / AC-24 L2 | `tests/phase3-…spec.ts` | ✅ | 无跨层新依赖 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| `sanitizeReason` | camelCase | 既有风格 | ✅ |
| `io-error` / `unknown` | 短元数据码 | A.3 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1–§2.4 | 职责 / 依赖 / 接口 / Feature 专属 | ✅ | 未破坏 |
| 敏感数据 | 快照/旧文不进扩展日志 | ✅ | 元数据化对齐 AC-24 |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- ≤80 且不像正文的短 freeform 仍可直通；AC-24 针对快照/旧文明文，短码直通可接受。
- `design-zh` AD-CCD-14 已与英文对齐；本 Phase 无需代码跟进。
- AD-CCD-6 soft-budget 仍为队尾优先保留。

## 范围焦点核对（本委托）

| 焦点 | 结论 |
|------|------|
| `sanitizeReason` 元数据化 ↔ AC-24 | ✅ |
| design-zh AD-CCD-14 sync | ✅ |
| 既有 AD / 模块落点 | ✅ 无架构漂移 |
