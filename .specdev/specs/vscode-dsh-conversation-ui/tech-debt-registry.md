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
| （无） | — | — | — | — | — | — | — | — | — | — | — | — |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
| DEBT-007 | phase-4-subagent-enter-pin | `pushFullState`/`panelSnapshot` 对 replay（含 context/已钉）委托 `resolveContinueChrome`/`continueChromeForTab`，不再仅 live 才解析 | phase-4-subagent-enter-pin | 2026-09-08 | vitest DEBT-007；panel/state.continue 与 Host chrome 一致 |
| DEBT-008 | phase-4-subagent-enter-pin | context 子回放 Continue 绑 `contextSessionId`；resume 子 session 并提升为 live Tab | phase-4-subagent-enter-pin | 2026-09-08 | vitest DEBT-008 |
| DEBT-009 | phase-4-subagent-enter-pin | `deleteConversation`/`deleteSession` 删子后立即 `markSubagentCardDeleted` 父卡片 | phase-4-subagent-enter-pin | 2026-09-08 | vitest DEBT-009 |
| DEBT-010 | phase-4-subagent-enter-pin | `restoreOpenTabSet` / `restoreMoreTabs` 消费 `pinnedSubagent` 恢复钉态 | phase-4-subagent-enter-pin | 2026-09-08 | vitest DEBT-010 |
| DEBT-011 | phase-4-subagent-enter-pin | 面包屑：父 Tab 未打开或已删时 `parentDeleted` 禁用可点态，与 `navBack` 对齐 | phase-4-subagent-enter-pin | 2026-09-08 | vitest DEBT-011 |
| DEBT-012 | phase-2-multitab-history-replay | L2：不注入 events 的 Host `readSessionLog` 冷读；unbind 后再 listHistory | phase-4-subagent-enter-pin | 2026-09-08 | vitest DEBT-012（phase2） |
| DEBT-013 | phase-3-restart-continue | `restoreMoreTabs` 批处理 suspend persist，all=true 中途不缩水 openTabSet | phase-4-subagent-enter-pin | 2026-09-08 | vitest DEBT-013（phase3） |
| DEBT-003 | phase-3-restart-continue | `persistOpenTabs` 合并 `deferredRestore`；restore 批处理 suspend 中间写；二次重启仍见 deferred openTabSet | phase-3-restart-continue | 2026-09-08 | vitest DEBT-003；verifier V-IND-3/V-IND-5 openTabSet.length===3 |
| DEBT-004 | phase-3-restart-continue | 真 Webview `buildThinChatHtml` 消费 `panel/state.continue` / `deferredRestoreCount`，发 `action/continue` / `action/restore-more` | phase-3-restart-continue | 2026-09-08 | vitest DEBT-004 HTML 断言 |
| DEBT-005 | phase-3-restart-continue | `IdeSessionHost.onStatusChange` + controller 在 connected 且 `pendingRestoreLatch` 时自触发 `restoreOpenTabSet` | phase-3-restart-continue | 2026-09-08 | vitest DEBT-005 |
| DEBT-006 | phase-3-restart-continue | `readSessionLog` 失败进 deferred/保留 index，不空剔；可二次 restore 成功；`restoreMoreTabs` 失败回填 deferred（MUST-FIX loop 2） | phase-3-restart-continue | 2026-09-08 | vitest DEBT-006 + restoreMoreTabs read-failure；verifier V-IND-5 二次冷启动 + deferred 全量 hydrate |
| GAP-001 | phase-0b-spike-continue-capability | ide-bridge `session/resume` + SDK `sdkSessionResume` → `agents.resume`；Host `resumeSession`；Continue 同 tabId `replay→live`；未改 SDK stdout create | phase-3-restart-continue | 2026-09-08 | `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` VP-3-continue；`packages/ide/ide-bridge/tests/ide-bridge.spec.ts` session/resume；vitest PASS |
| DEBT-001 | phase-0a-spike-replay-rebuild | 产品 `ReplayHydrator` 测试含完整 Timeline 序列 oracle、`surfaceOp:replace`、可恢复新建 `oldText:null` | phase-2-multitab-history-replay | 2026-09-08 | `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` DEBT-001 用例；vitest PASS |
| DEBT-002 | phase-1-panel-live-recoverable-close | 双 Tab 同时 running → 切 Tab → `status/set` 仅活动 sessionId generating、不串台 | phase-2-multitab-history-replay | 2026-09-08 | 同文件 DEBT-002 用例 + FakeWebviewPort；vitest PASS |

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
