# Feature 交付总结：vscode-dsh-code-context-diff

<!--
  slug: vscode-dsh-code-context-diff
  kind: delivery-handoff
  audience: product / next-feature planning / HG-3 closeout
  created: 2026-09-10
  status: feature complete (Must); 无开放 Should/Could；活跃债空
  predecessor: vscode-dsh-chat-ready
-->

## 一句话

本 Feature 在 chat-ready 之上交付了 **「指针式代码引用 + 消息下可审阅/可撤销的变更列表」**：选区/`@路径` 只传指针（磁盘 `read` 取内容）、可恢复 `meta.diffs` 归因入账、扩展本地整文件 SnapshotStore、消息附属 change-list / 安全 on-demand diff、审阅与冲突门禁撤销、冷启动/回放 hydrate。**不改** `packages/core/agent-loop`；**不用**裸 FileSystemWatcher 全量入账；create / str_replace 无 meta 时按「宁可漏记」永久不入账。

## 验收结论

| 项 | 状态 |
|----|------|
| Phase 0…3 | implementer → reviewer → verifier 均完成；各 Phase HG-3 通过并合入 `master` |
| Spike Gate | phase-0 **PASS**（阻塞 phase-2/3；不阻塞 phase-1） |
| 活跃技术债 | **空**（`tech-debt-registry.md`） |
| 审查 Should-Fix | **已全部关闭**（含 AC-18 混批写失败夹具、`sanitizeReason` 硬化、`design-zh` AD-CCD-14 同步） |
| 达标证据 | 以各 Phase L2 vitest + verifier 独立场景为主；L4 不作 Must 唯一证据 |

### 合入提交（`master`）

| Phase | Commit | 概要 |
|-------|--------|------|
| phase-0 | `fbc807a4ed` | Spike Gate PASS：归因 + SnapshotStore 生命周期 |
| phase-1 | `52af62f168` | 指针预填、`@path` 门禁、FILE_REFERENCE 挂载 |
| phase-2 | `b35d6363e2` | 消息 change-list + 整文件快照 + AC-30 reveal |
| phase-3 | `8c61a2030b` | 审阅 / 撤销 / 冷启动 hydrate + 债务清理 |

## 已交付 Must（按能力）

### A. Spike：归属与快照契约（phase-0 · AC-S1…S3）

- 可恢复 `tool/result.meta.diffs`（`path` + `newText` + `oldText: string\|null`）足以稳定归因 DSH 写入（AD-CCD-1）
- SnapshotStore 布局锁定：`storageUri…/changes/<sessionId>/<snapshotRef>.json`；200 MiB / 2 MiB；LRU prune 策略（附录 A.3）
- 误报否定：用户手动保存（无 meta）不得入账；禁止 watcher 冒充 PASS
- `design.md` 附录 A 实证回写（`design-zh` 已对齐）

### B. 代码引用：指针 + 磁盘 read（phase-1 · AC-1…4 / 3a / 3b）

- 脏保存后选区/右键预填官方 `@` / `@"…"` 指针 + 自然语言行范围；无正文 / `languageId` 注入
- Host `@path` 发送门禁（`not-found` / `outside-workspace` / `ambiguous-root`）；原样纳入 prompt
- AC-3a：L2 stub 每去重 path ≥1 次 covering `read`（主字段 `file_path`）；**stub ≠ 真模型**已文档化
- AC-3b：ide bundle 预挂载 `file-reference-local` → `FILE_REFERENCE_PROMPT`
- 引用卡 + `SelectionMetaStore` 打开行号；多 root 打开与门禁同序 resolve；冷启动 `pendingPrefill` 重放

### C. 消息附属变更列表（phase-2 · AC-5…12a / 19–21 / 23 + AC-30）

- `ChangeAttributor` / `ChangeStore` / `SnapshotStore`：可恢复 meta 入账；同 turn 同 path 合并；整文件 before/after blob（meta 仅信号）
- 消息下 `change-list`；N=0 空说明且无 `diff-summary`；安全 on-demand diff（CSP / textContent）
- 主键单击 → `change/open`；独立 expand → `change/get-diff`；「来源」→ 助手气泡
- AC-30：`diff-summary` 携带 `sourceMessageId`，reveal **对应** turn 列表（非 reverse().find 最近一条）
- 产品策略：GAP-010/011（create / str_replace 无 meta）**宁可漏记**，永久不入 ChangeList

### D. 审阅 / 撤销 / 回放（phase-3 · AC-11 / 13–18 / 22 / 24 / 25）

- 标记已审阅：仅状态 + 扩展 index，不写工作区
- 单文件 / 批量撤销：SnapshotStore `oldText` 恢复；created 删除确认；deleted 同名冲突确认；AC-17 content-hash ∨ `isDirty`
- 同 path 多 turn：倒序批量；仅选早 turn 时「后续变更」确认（AD-CCD-10）
- 冷启动 `restoreOpenTabSet` 与 `openFromHistory` 对称 `hydrateChangeListsFromIndex`（path + 统计；prune 后不伪造 diff）
- settle 后 best-effort prune（reverted-first；保护 open unreverted）；删会话清 `changes/<sessionId>/`
- AC-24：快照明文不进权威日志 / 扩展日志；失败 reason 元数据化（content-like → `io-error`）
- AC-25：不破坏 chat-ready Must（回归抽测）

## 产品策略与已知边界（非债）

| 策略 / 边界 | 说明 |
|-------------|------|
| 宁可漏记 | create / identical overwrite（空 `diffs`）、`tool-str-replace-editor` 无 presentationMeta → **不入账**；不以 watcher 补洞 |
| hunk ≠ blob | 入账信号用 meta；撤销/diff 用整文件 SnapshotStore；无 before-cache 时省略 blob（`available=false`） |
| AC-3a stub | L2 强制 covering read；真模型覆盖另记观测，不作 Must 唯一证据 |
| 软预算 prune | 200 MiB；open unreverted 排队尾优先保留，预算耗尽仍可删 |

## Out of Scope（明确不做）

| 项 | 说明 |
|----|------|
| 改 `packages/core/agent-loop` | 禁止 |
| 裸 FileSystemWatcher 全量入账 | 禁止（伪 PASS） |
| 快照明文写入权威会话日志 | 禁止 |
| Cursor 全量产品对标 | 不升为 Must |
| 为「漏记」工具补 presentationMeta / 改写盘模型 | 本 Feature 选择文档化漏记，非本 DAG 交付 |

## 已关闭技术债（registry）

| ID | 解决 Phase | 要点 |
|----|:----------:|------|
| GAP-CCD-010 | phase-2 | create → 空 diffs：宁可漏记 |
| GAP-CCD-011 | phase-2 | str_replace 无 meta：宁可漏记 |
| DEBT-CCD-001 | phase-2 | 整文件 blob；meta 仅信号 |
| GAP-CCD-012 | phase-1 polish | 多 root 打开 ≡ 门禁 resolve |
| GAP-CCD-013 | phase-1 polish | 冷启动 prefill 缓冲重放 |
| DEBT-CCD-002 | phase-1 polish | stub ≠ 真模型文档 |

## 回归命令与结果（抽样）

**按 Phase 主套件（合入前 verifier 证据）：**

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts
# phase-0：7 passed

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase1-code-context.spec.ts \
  packages/bundle/ide/tests/ide.spec.ts
# phase-1（polish 后）：24 passed

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/phase5-should-polish.spec.ts
# phase-2：28 passed

./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
# phase-3（Should-Fix polish 后）：16 passed

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts
# AC-25 / 前序回归：30 passed（phase-3 verifier）
```

### 矩阵勾选（能力 → 锚点）

| 区段 | 覆盖 | 锚点 | 状态 |
|------|------|------|:----:|
| Spike 归因 / 误报 | AC-S1…S3 | `spike-attribution-snapshot` | ✅ |
| 指针预填 / `@path` | AC-1…4 / 3a / 3b | `phase1-code-context` + `ide.spec` | ✅ |
| 变更列表 / AC-30 | AC-5…12a / 19–21 / 23 | `phase2-change-list-display` | ✅ |
| 审阅撤销 / 冷启动 | AC-11 / 13–18 / 22 / 24 | `phase3-review-revert-replay` | ✅ |
| 前序 chat-ready | AC-25 | `chat-ready-regression` / `phase3-restart-continue` | ✅ |

## 关键路径

| 用途 | 路径 |
|------|------|
| 需求 / 设计 / Phase 计划 | `.specdev/specs/vscode-dsh-code-context-diff/` |
| 技术债 | `tech-debt-registry.md` |
| Spike 报告 | `phases/phase-0-spike-attribution-snapshot/spike-report.md` |
| 代码引用 | `apps/vscode-dsh/src/code-context/` |
| 变更列表 / 撤销 | `apps/vscode-dsh/src/change/` |
| Host / Webview / 控制器 | `apps/vscode-dsh/src/{extension,conversation-controller,chat-panel}/` |
| ide FILE_REFERENCE | `packages/bundle/ide/cordis.patch.yml` + `file-reference-local` |
| 各 Phase 验证证据 | `phases/*/verification.md` |

## 收尾说明

- 本文件用于 Feature 关闭时的能力 / 缺口 / 策略交接。
- 行为验收以各 `phases/*/verification.md` 为准；本文不替代 AC 逐条证据。
- 产品策略「宁可漏记」是**刻意决策**，不是未关闭的债；若未来要为 create/str_replace 入账，须新 Feature（仍禁裸 watcher）。
- Wiki 已在 Feature 完成后委托更新（见 `docs/wiki/` 相关 IDE / Timeline / Conversation 页）。
