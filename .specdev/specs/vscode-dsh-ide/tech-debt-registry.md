# Tech Debt Registry

> 这是本工作流中所有已知技术债的 **唯一定义来源**。
> 所有 Phase 的 agent 共写共读。写入新债，读取已有债，解决后更新状态。

---

## 活跃债务

<!--
  ID 格式：STUB-xxx（桩代码）/ GAP-xxx（功能缺失）/ DEBT-xxx（其他技术债）
  状态：🔴 阻塞 / 🟡 非阻塞
  类型：空实现 / 假返回值 / 流程骨架 / 条件桩 / 类型占位
  来源：implementation.md / review.md / verification.md / scope-gap-report.md

  结构化索引字段（标签列）：
  - module:<name> — 所属模块。例：module:gateway
  - type:<stub|gap|debt> — 债务类型
  - concern:<topic> — 关注领域。例：concern:auth, concern:export
  - bind:<binding> — 绑定关系。例：bind:someip, bind:grpc
  标签 + depends_on → agent 精确查询。例：查「标签含 gateway 的 🔴阻塞项」→ 2 条，不扫全表
-->

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|
| GAP-010 | phase-4-timeline-diff | timeline-store | `apps/vscode-dsh/src/timeline-store.ts:applySessionEvent(tool/result)` / `narrowDiffs` | `tool/result` 仅消费 `meta.diffs`；真实 create-file 时 tool-fs 附 `diffs: []`，无 call-args 回退 → `writeDiffs*` 空、`hasDiff=false` | 对齐 Web diff-card-model：当 `meta.diffs` 空且 pending call 为 `write`/`edit` 时，从 tool/call arguments 合成 hunk | 功能缺失 | `module:timeline-store, type:gap, concern:post-hoc-diff` | diff-entry / timeline-view | phase-4-timeline-diff（后续债务修复） | 🟡非阻塞 | verification.md + review-correctness | 2026-09-07 |
| GAP-011 | phase-4-timeline-diff | diff-entry | `apps/vscode-dsh/src/diff-entry.ts:openTimelineDiff` / `looksAbsolute` | 相对路径右半侧用 `dsh-diff:new-…` 虚拟文档展示 `newText`，不打开 workspace 真实文件 | 有 `workspaceFolders` 时优先 `Uri.file(join(cwd, path))` | 已知缺陷 | `module:diff-entry, type:gap, concern:workspace-uri` | extension Diff commands | phase-4-timeline-diff（后续债务修复） | 🟡非阻塞 | verification.md + review-correctness | 2026-09-07 |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
| STUB-001 | phase-1-profile-dual-channel | ide-bridge approval answerer now forwards over Host bridge, awaits legal `ApprovalOutcome`, times out / disconnects to `unavailable`, never calls `next()` | phase-3-interaction-fail-closed | 2026-09-07 | `vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts` — round-trip + timeout + disconnect |
| STUB-002 | phase-1-profile-dual-channel | ide-bridge user-questions answerer now forwards over Host bridge and returns Host `AskUserQuestionAnswer` (or `NO_PROVIDER` fail-closed) | phase-3-interaction-fail-closed | 2026-09-07 | `vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts` — questions round-trip |
| GAP-001 | phase-1-profile-dual-channel | `redactSecrets` now accepts optional credentials bag; IdeSessionHost passes session credentials on every diagnostic redact path so credentials-only secrets are scrubbed before error UI | phase-1-profile-dual-channel | 2026-09-07 | `vitest run apps/vscode-dsh/tests/session-host.spec.ts` — credentials-only unit + initialize-error integration |
| GAP-002 | phase-1-profile-dual-channel | Added IdeSessionHost happy-path lifecycle unit with fake SDK runtime fixture asserting `connected` then ordered `shutdown` → `disconnected` | phase-1-profile-dual-channel | 2026-09-07 | `vitest run apps/vscode-dsh/tests/session-host.spec.ts` — lifecycle describe |
| GAP-003 | phase-2-multi-tab-session | `closeConversation` now awaits `host.disposeSession` before `registry.close`; dispose failure retains the Tab for retry | phase-2-multi-tab-session | 2026-09-07 | `vitest run apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts` — in-flight Tab presence + failure retention + dispose-before-close order |
| GAP-004 | phase-2-multi-tab-session | TreeView `getTreeItem` sets `command: dsh.switchConversation` with `arguments: [tabId]`; Extension command accepts optional tabId (TreeView click) else QuickPick | phase-2-multi-tab-session | 2026-09-07 | `vitest run apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts` — TreeItem.command + tabId args |
| GAP-005 | phase-3-interaction-fail-closed | `IdeSessionHost.onError` + Extension `showErrorMessage('DeepSeek Harness session error: …')` on transport/child death | phase-3-interaction-fail-closed | 2026-09-07 | `vitest run apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts` — onError notify + extension wiring |
| GAP-006 | phase-3-interaction-fail-closed | `presentApproval/Questions` receive AbortSignal; `createQuickPick().hide()` on abort (fail-closed cancels open QuickPick) | phase-3-interaction-fail-closed | 2026-09-07 | `vitest run apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts` — hide on abort + signal aborted |
| GAP-007 | phase-3-interaction-fail-closed | Added questions Host→UI→response integration symmetric to approval (`FAKE_EMIT_QUESTIONS_SESSION`) | phase-3-interaction-fail-closed | 2026-09-07 | `vitest run apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts` — GAP-007 describe |
| GAP-008 | phase-3-interaction-fail-closed | Empty-option questions use `showInputBox` to collect `custom` free text | phase-3-interaction-fail-closed | 2026-09-07 | `vitest run apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts` — InputBox custom + cancel |
| GAP-009 | phase-3-interaction-fail-closed | `closeConversation` calls `interactions.failClosedSession(sessionId)` before `disposeSession` (AD-5) | phase-3-interaction-fail-closed | 2026-09-07 | `vitest run apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts` — per-session abort before dispose |

---

## 维护规则

### 谁写入
- **implementer**：创建 `@STUB(phase-N)` 后立即注册到「活跃债务」。编码完成后检查是否有未注册的桩。
- **reviewer**：发现 implementer 未标注的桩/缺陷 → 新增条目到「活跃债务」
- **verifier**：独立验证发现疑似桩或已知缺陷 → 新增条目到「活跃债务」
- **Cursor Agent**（Phase Closure）：从 scope-gap-report.md 中同步推迟项到注册表

### 谁读取
- **code-explorer**（Phase 准备阶段）：读注册表，交叉验证代码中的桩 → 输出到 `repo-exploration.md` §9
- **plan-generator**：设计时检查 registry，确认依赖接口是否已有 stubs
- **implementer**：编码前读 registry，不把桩当真实现
- **reviewer**：审查时对照 registry，已知桩不误报为「发现」
- **verifier**：验证时对照 registry，已知桩跳过行为验证

### 谁更新状态
- **implementer**：实现之前注册的桩 → 从「活跃债务」移到「已解决」
- **reviewer**：确认桩已填实 → 可标记为已解决
- **verifier**：验证通过 → 确认可关闭
- **Cursor Agent**（Phase Closure）：标记不再适用的过时项 → ⚠️ 标记

### 字段规范

| 字段 | 说明 | 必须在 |
|------|------|:--:|
| **ID** | `STUB-N`(桩) / `GAP-N`(功能缺失) / `DEBT-N`(其他) | ✅ |
| **源Phase** | 产生该债的 Phase | ✅ |
| **模块** | 所属模块名 | ✅ |
| **文件:函数:行号** | 精确代码定位 | ✅ |
| **当前行为** | 代码实际做什么，不是意图 | ✅ |
| **预期行为** | 完整实现应该怎么做 | ✅ |
| **类型** | `空实现` / `假返回值` / `流程骨架` / `条件桩` / `类型占位` / `功能缺失` / `已知缺陷` / `性能问题` | ✅ |
| **标签** | `module:<name>`, `type:<stub\|gap\|debt>`, `concern:<topic>`, `bind:<binding>` | ✅ |
| **依赖它的模块** | 哪些模块依赖这个接口 | 🟡 尽量填 |
| **目标Phase** | 计划在哪个 Phase 解决 | ✅ |
| **阻塞** | 🔴阻塞 / 🟡非阻塞 | ✅ |
| **来源** | 谁发现的（implementation.md / review.md / verification.md / scope-gap-report.md） | ✅ |
| **注册日期** | ISO 日期 | ✅ |

### 标签规范
- 每个条目必须有 `module:` 和 `type:` 标签
- `concern:` 和 `bind:` 可选，尽可能填写以提高查询精度
- 标签使用英文小写，多词用连字符连接
- 例：`module:auth-service, type:stub, concern:password-reset, bind:email`

### 查询指引（各 agent 如何精确查询）

| Agent | 查询方式 | 示例 |
|-------|---------|------|
| **plan-generator** | 查目标Phase=N AND 阻塞=🔴 → 按标签分组 | "下一 Phase 继承了哪些阻塞债务" |
| **implementer** | 查文件:函数精确匹配 → 已知桩不当真实现 | "我依赖的这个接口是桩吗" |
| **reviewer** | 查文件含当前目录前缀 → 已知桩不重复发现 | "我审查的代码里哪些函数是已知桩" |
| **verifier** | 查阻塞=🔴 且不在已解决表中 → 跳过验证 | "哪些已知问题不需要现在验证" |
| **code-explorer** | 逐行按文件:函数:行号验证代码是否匹配 | "registry 里的桩还在代码里吗" |

### 去重与清理
- 写入前搜索标签和文件:函数避免重复
- Phase Closure 时检查文件路径/函数名是否变化 → 标记 ⚠️ 或更新
- Phase 间传递的债务不重复注册

### Phase Entry Gate 联动
- 进入新 Phase 前，Cursor Agent 读取本文件
- 筛选「目标Phase = 当前Phase」且「阻塞 = 🔴」的条目
- 向用户呈现继承的债务清单，用户确认后正式开始 Phase
- 用户可选：(a) 本 Phase 优先解决 (b) 推迟 (c) 取消
- 根据决策更新 registry 中的目标Phase
