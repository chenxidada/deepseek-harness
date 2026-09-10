# Design Consistency Review — phase-2-change-list-display

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

> Re-review after MUST-FIX loop（`loop_count=1`）。焦点：AC-30 identity、SnapshotStore 禁止 hunk→blob、AD 对齐。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-1 · 归属 = 顶层 turn 内可恢复 `meta.diffs`；宁可漏记 | 是 | `ChangeAttributor.ingestToolResult` → `recoverableDiffsFromMeta`；头注释锁定 GAP-010/011；无 watcher / 全量 `onDidSave` 入账 | ✅ |
| 附录 A.1 覆盖边界 | 是 | create/`diffs:[]`、str_replace、bash、手动保存不入账；registry 已关闭为永久漏记 | ✅ |
| AD-CCD-2 / N-2 · 列表挂靠 turn 内最后助手；定稿 | 是 | `noteAssistant` + `clearSettled` 再 settle；空 pending 时 **re-anchor** 回写 `ChangeRecord.sourceMessageId` | ✅ |
| AD-CCD-3 · 快照仅扩展本地 | 是 | `SnapshotStore` → `<storageRoot>/changes/...`；列表 / MessageStore **无** old/new 全文 | ✅ |
| AD-CCD-4 / N-1 · AC-30 与 change-list 共存 + **identity** | 是 | N>0 注入 `diff-summary` **带 `sourceMessageId`**；点击 `action/reveal-change-list` **携带** identity；Host 按 id 定位对应 change-list；N=0 无摘要 | ✅ |
| AD-CCD-5 · 同 turn 同 path 合并 first-old + last-new | 是 | `PathMergeState`；一条 `ChangeRecord` / turn+path | ✅ |
| 附录 A.2 / DEBT-001 · hunk ≠ blob；无整文件 before 不写 blob | 是（本轮修复） | `settleTurn`：`cachedBefore` 或 create(`firstOld===null`) 才写 SnapshotStore；否则 `oldText=undefined` **省略** `snapshotRef`；**不再**把 hunk `firstOld` 作 `oldText` | ✅ |
| 附录 A.3 · 存储布局 / 根 / 预算 | 是 | `storageUri` 优先；`changes/<sessionId>/<ref>.json`；200MiB / 2MiB soft | ✅ |
| AD-CCD-6 · prune | 部分（本 Phase 合理） | oldest-session + 删会话清目录；reverted-first → phase-3 | ✅* |
| AD-CCD-7 · 禁止改 agent-loop | 是 | 仅 `apps/vscode-dsh`；无写盘 revert | ✅ |
| AD-CCD-8 · 排除规则 | 是 | `change-ignore.ts` | ✅ |
| AD-CCD-9 · Diff 渲染安全 | 是 | diff pane `textContent` only | ✅ |
| API · `change/open` vs `change/get-diff`（AC-12 / AC-12a） | 是（本轮修复） | 主键单击 → `change/open`；独立 `change-list-expand` → `change/get-diff` | ✅ |
| API · `change/reveal-source`（AC-19） | 是（本轮修复） | 「来源」→ `change/reveal-source` → Host `pushRevealSource` / `scroll/reveal-source` 滚 **助手气泡**（非 change-list） | ✅ |
| Phase-2 OOS · 无 revert / mark-reviewed 写盘 | 是 | 无 `change/revert*` UI；status 展示 unreviewed | ✅ |

\* AD-CCD-6 完整 LRU 依赖 phase-3 审阅/撤销状态；与设计分层一致。

## 本轮 MUST-FIX / SHOULD-FIX 关闭核对

| 焦点 | 设计要求 | 关闭证据 | 判定 |
|------|----------|----------|:--:|
| AC-30 identity | AD-CCD-4：点击 reveal **对应**消息下 change-list | `ChatMessage.sourceMessageId`；投影写入；webview post 携带；`requestRevealChangeList` 按 `changeList.sourceMessageId` 匹配 | ✅ |
| SnapshotStore no hunk fallback | A.2 / DEBT-001：blob = 整文件；禁止 hunk 作 oldText | `oldText` 仅 cache / create-null；缺 before → 不 `write`；`get-diff` 无 ref → `available=false` | ✅ |
| AC-12a 交互分离 | design API 表：`change/open` 打开定位；`change/get-diff` 按需正文 | 主键 vs Diff 控件职责分离 | ✅ |
| AC-19 溯源方向 | `change/reveal-source` → 来源助手 | 独立 Host→Webview `scroll/reveal-source`，不再误用 `pushRevealChangeList` | ✅ |
| N-2 多助手 re-anchor | 锚点 = turn 内最后 assistant | 空 pending 路径更新既有 record 的 `sourceMessageId` | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|-----------|---------|:--:|------|
| `change/*.ts` | `apps/vscode-dsh/src/change/` | ✅ | 符合 design 产出计划 |
| `protocol.ts` `scroll/reveal-source` | `chat-panel/` | ✅ | Host→Webview 溯源帧；与 `scroll/reveal-change-list` 对称、职责分离 |
| `message-store.ts` `sourceMessageId?` | MessageStore | ✅ | AC-30 摘要 identity；不进权威日志正文 |
| `conversation-controller.ts` | 定稿 + 投影 | ✅ | AD-CCD-2/4 接线点 |
| （无）`revert.ts` | — | ✅ | phase-3 OOS |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 模块 / 文件 | `src/change/` + kebab-case | design + vscode-dsh | ✅ |
| 类型 | `ChangeRecord` / `ChangeListPayload` / `ChangeSnapshot` | design 数据模型（`snapshotRef?`） | ✅ |
| 协议 | `change/*`、`action/reveal-change-list`、`scroll/reveal-source` | design API 表 + AC-19/30 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 模块只做一件事 | ✅ | Attributor / Store / Snapshot / Ignore 分离；open vs expand vs reveal-source 控件分离 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 仅扩展侧；未反向依赖 agent-loop |
| §2.3 接口隔离 | 明确协议面 | ✅ | Host↔Webview 窄协议 |
| §2.4 Feature 硬约束 | 禁改 agent-loop；快照仅本地；宁可漏记 | ✅ | A.2 省略 blob ≠ 用 hunk 伪造；符合「宁可漏记」 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- Blob 写入时 `newText` 仍可在磁盘不可读时回退 `merge.lastNew`（L2 / 异常路径）；主路径为 workspace after-read。与已关闭的「hunk 作 oldText」问题不同；完整 after 失败时仍写 blob 属边缘，不构成对本轮 A.2 修复的回退。
- `action/reveal-change-list.sourceMessageId` 协议层可选：生产点击路径在有 identity 时必带；缺省回退「最近列表」仅兼容，不影响 AD-CCD-4 主路径。
- `pruneToBudget` 暂用 oldest-session：与 phase-3 尚未交付 revert 状态一致。
- ChangeStore 内存索引：设计允许扩展 index；冷回放持久化非本 Phase Must。

## 详细证据索引
- 实现摘要：`implementation.md`（MUST-FIX loop）
- Attributor / A.2：`apps/vscode-dsh/src/change/change-attributor.ts`（`settleTurn` oldText 三态）
- AC-30：`conversation-controller.ts`（投影 `sourceMessageId`）+ `chat-panel-provider.ts`（click identity）+ `extension.ts`（按 id 找 list）
- AC-19：`protocol.ts` / `chat-panel-host.ts` `pushRevealSource` / `extension.ts` `requestRevealSource`
- AC-12a：`chat-panel-provider.ts`（primary `change/open` vs expand `change/get-diff`）
- 债务：`tech-debt-registry.md`（GAP-010/011 / DEBT-001 → 已解决）
