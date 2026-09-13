# 正确性审查 — Phase 3（`phase-3-interaction-fail-closed`）— GAP-005..009

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC / GAP 验证

| AC / GAP | 描述 | 实现位置 | 判定 | 证据 |
|----------|------|---------|:--:|------|
| AC-10 | 审批/提问关联到正确会话/Tab | `interaction-coordinator.ts` `resolveTabId` / `handleApproval` / `handleQuestions` | ✅ | `getBySessionId` → `tabId` 注入 request；应答按 bridge `id` 回传。GAP-007 集成断言 `request.tabId === tab.tabId` |
| AC-16 | `approval/request` → 合法 `ApprovalOutcome` | `interaction-ui.ts` `presentApproval`；coordinator + ide-bridge（既有） | ✅ | QuickPick 映射 `allowed-once`/`rejected`/`cancelled`；非法 value → `unavailable`。既有集成/e2e 仍覆盖 |
| AC-17 | `user-questions/request` → 合法 `AskUserQuestionAnswer` | `interaction-ui.ts` `presentQuestions`；GAP-007 集成 | ✅ | 有 options → QuickPick `selected`；无 options → InputBox `custom`（GAP-008）。Host→UI→response 集成写 `selected:["yes"]` |
| AC-19 | 断连/超时/抛错/非法 fail-closed | ide-bridge + Host（既有）+ 本轮 abort 路径 | ✅ | 无 UI → approval `unavailable` / questions throw；abort → `unavailable` / throw；不静默放行 |
| AC-20 | 等待期间瀑布阻塞 | ide-bridge `awaitHost*`（既有） | ✅ | 返回未结算 Promise；合法结局或 fail-closed 才 settle |
| AC-21 / AC-22 | permission-presets 唯一权威 | `pickPermissionPreset` + Host RPC（既有） | ✅ | 无第二套策略源 |
| AC-30 | 传输/子进程死亡 → 终止等待、错误态、fail-closed | `session-host.ts` `onTransportDeath`/`notifyError`；`extension.ts` `onError`→`showErrorMessage`；UI AbortSignal | ✅ | status=`error` + `errorMessage` + `failClosedAll` + `notifyError`；Extension 展示 `DeepSeek Harness session error: …`；QuickPick `hide()`（GAP-005/006） |
| AC-31 | 入站载荷校验 | `validate.ts`（既有） | ✅ | 非法帧丢弃，不放行 |
| AC-33 | ≥1 集成 + ≥1 e2e | 既有 + `gap-005-009-debt-fix.spec.ts` | ✅ | GAP-007 questions 集成；既有 e2e 保留 |
| **GAP-005** | 错误 UI：transport death → `showErrorMessage` | `session-host.ts:106-111,302-326`；`extension.ts:96-100` | ✅ | `onError` 注册 listeners；`onTransportDeath` 在 fail-closed 后 `notifyError(errorMessage)`；Extension 订阅并 `showErrorMessage`。单测断言 listener 收到 redacted message；源码接线断言含 `session error` |
| **GAP-006** | AbortSignal → `createQuickPick().hide()` | `interaction-ui.ts:190-233`；coordinator 传 `abort.signal` | ✅ | 优先 `createQuickPick`；abort 时 `qp.hide()` + settle；无 createQuickPick 时 race `showQuickPick`。测试：`hideCount≥1` 且 outcome `cancelled`；`failClosedAll` → signal.aborted + `unavailable` |
| **GAP-007** | questions Host→UI→response 集成 | `gap-005-009-debt-fix.spec.ts` GAP-007；`fake-sdk-runtime.mjs` | ✅ | `FAKE_EMIT_QUESTIONS_SESSION` + `FAKE_QUESTIONS_LOG`；断言 Tab 绑定与 `selected:["yes"]` 写入 log |
| **GAP-008** | 空 options → `showInputBox` 收集 `custom` | `interaction-ui.ts:110-120,250-268` | ✅ | `options.length===0` 走 `promptFreeText`；非空文本写入 `custom`；取消/空白 → `selected:[]` 无 custom。双测覆盖 typed + cancel |
| **GAP-009** | 关 Tab → `failClosedSession` 再 dispose | `interaction-coordinator.ts:225-232`；`conversation-controller.ts:54-64` | ✅ | 仅 abort 匹配 `sessionId`；`closeConversation` 顺序 failClosed→dispose→registry.close。测试：drop 变 `unavailable`，keep 仍 pending；gap-003 断言顺序三元组 |

## 桩代码检测

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| STUB-001 / STUB-002 | ide-bridge answerers | ✅ 已解决 | 活跃表为空；非空壳 |
| GAP-005..009 | 见上表 | ✅ 已解决 | 已从活跃表移至「已解决」；函数体均为真实逻辑 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | 未发现 `@STUB` / `return Ok(0)` / 硬编码冒充完成 |

## 关键发现

### 🔴 Must-Fix
- （无）— GAP-005..009 均有真实逻辑与通过测试；先前 AC-30 ⚠️ / Should-Fix #1–#4 已闭合。

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- GAP-005 的 Extension 接线测试以源码正则断言为主，行为级覆盖在 `IdeSessionHost.onError` 单测；接线本身在 `extension.ts` 可读且 `stopErrorWatch` 在 start 失败 / stop / deactivate 有清理。
- `promptFreeText` 在 abort 时仅 Promise.race settle，未用 `createInputBox().hide()`；Host 等待已终止，InputBox 面板可能仍可见（低频路径，不影响 fail-closed 语义）。
- 本地复跑：`vitest run apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts` → **2 files / 12 tests passed**。
