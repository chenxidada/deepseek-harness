# Design Consistency Review — Phase 3 (phase-3-review-revert-replay)

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

> Re-review after Should-Fix polish（AC-18 混批 + `sanitizeReason` 元数据化）。上轮 AD-CCD-6 / N-4 闭合保持；本轮焦点：`sanitizeReason` 与 AC-24「仅元数据」精神对齐。`design-zh` AD-CCD-14 同步由调度者已完成，本审查确认无文档冲突。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-3 · 快照/审阅仅扩展本地；禁权威日志明文（AC-24） | 是 | index / change-list 无 old/new；`executeRevert` catch → `write-failed:${sanitizeReason(...)}`；content-like / 超长 freeform → `io-error`（不再截断前缀泄露） | ✅ |
| A.3 · 日志仅元数据与统计 | 是 | 失败 reason 优先短码（`EACCES` / kebab）或 `io-error` / `unknown`；L2 断言正文不出现在 reason | ✅ |
| Constitution 敏感数据 · 快照/旧文不得明文进扩展日志 | 是 | 同 `sanitizeReason` 硬化；与 §2.4 本地状态 / 非权威日志一致 | ✅ |
| AD-CCD-6 / N-4 · 索引 / prune / openTabSet unreverted / 删会话清目录 | 是 | 上轮已闭合；本 polish 未改生命周期 | ✅ |
| AD-CCD-7 · 禁改 agent-loop；主落 vscode-dsh | 是 | 变更仅 `apps/vscode-dsh` `change/` + tests | ✅ |
| AD-CCD-10 · 文档层 / workspace.fs；turn 倒序；后续确认 | 是 | 既有实现保持 | ✅ |
| N-3 / AC-17 · content hash ± isDirty | 是 | 无 mtime 唯一判定 | ✅ |
| AC-11 · mark-reviewed 不写盘 | 是 | 状态 + index only | ✅ |
| Constitution §2.4 · 撤销经 VS Code FS/文档 | 是（产品主路径） | Host 优先文档层 / `workspace.fs` | ✅ |

## 本轮 Should-Fix 闭合（设计视角）

| 项 | AC-24 / 设计精神 | 证据 | 状态 |
|----|------------------|------|:----:|
| `sanitizeReason` 仅截断仍可能泄露正文前缀 | 「日志仅元数据」——不得以截断正文冒充安全 | `looksLikeFileContent` / `len > 80` → `io-error`；短 kebab/errno 直通；空 → `unknown`；L2 `write-failed:io-error` 且不含 secret | ✅ 已闭 |
| AC-18 写失败混批 | 架构无新增决策；结果契约仍为 per-id | 同批 throw+success；失败 path 状态不变 — 属正确性夹具，设计模块边界未漂 | ✅ 无偏差 |
| design-zh AD-CCD-14 | 与 design.md / Phase1-P2A `file_path` 主字段对齐 | 调度者已同步；本 Phase 未改 phase-1 引用路径 | ✅ 无冲突 |

## 模块/命名/结构审查

### 目录合理性
| 新文件 / 改动 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `sanitizeReason` 硬化 | `apps/vscode-dsh/src/change/revert.ts` | ✅ | 仍在 revert 失败路径旁，符合 AD-CCD-10 / AC-24 边界 |
| `sanitizeReason` re-export | `change/index.ts` | ✅ | 与既有 change 公共面一致；测试可直接断言 |
| AC-18 / AC-24 L2 | `tests/phase3-review-revert-replay.spec.ts` | ✅ | 未引入新模块或跨层依赖 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| `sanitizeReason` | 动词+Reason | 既有 kebab 协议 + camel 函数 | ✅ |
| `looksLikeFileContent` | 私有启发式 | 实现细节，非公开协议 | ✅ |
| `io-error` / `unknown` | 短元数据码 | A.3「仅元数据」 | ✅ |
| `MAX_FREEFORM_REASON_LEN = 80` | 常量上限 | 替代旧截断前缀策略 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 模块各司其职 | ✅ | sanitize 留在 revert 写失败路径 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 无 agent-loop 依赖 |
| §2.3 接口隔离 | 明确接口 | ✅ | 公开 `sanitizeReason`；启发式私有 |
| §2.4 Feature 专属 | 禁 agent-loop；快照本地；撤销经 VS Code | ✅ | 未破坏 |
| 敏感数据 | 快照/旧文不进扩展日志 | ✅ | 元数据化对齐 AC-24 |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）本轮 polish 已闭合上轮 `sanitizeReason` Should-Fix；无新的架构偏离。

### 🟢 Observations
- `sanitizeReason` 对 **≤80 且不像正文** 的短 freeform 仍原样返回（例如短英文 errno 句）。AC-24 目标是快照/旧文**明文**，非任意诊断字符串；短码直通符合「元数据优先」。启发式（≥4 空格 / 源码 token）覆盖典型正文泄露，可接受。
- `design-zh` AD-CCD-14（`file_path` 主字段 + aliases）与英文 design / 修订表一致；本 Phase 无实施面触达，无需代码跟进。
- AD-CCD-6 soft-budget 保护仍为「队尾优先保留」，与上轮 PASS 解读一致。

## 范围焦点核对（本委托）

| 焦点 | 结论 |
|------|------|
| `sanitizeReason` metadata-only ↔ AC-24 | ✅ 内容型/超长 → `io-error`；不再截断前缀泄露 |
| design-zh AD-CCD-14 sync | ✅ 调度者已对齐；无冲突 |
| 既有 AD / 模块落点 | ✅ 相对上轮 PASS 保持；polish 无架构漂移 |
