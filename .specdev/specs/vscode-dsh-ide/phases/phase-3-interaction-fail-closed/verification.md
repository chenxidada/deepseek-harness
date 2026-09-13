# Phase 3 验证报告 — GAP-005..009 债务修复回路

## 判决：PASS

GAP-005..009 均已以独立脚本（非 implementer 套件）证明关闭；approval/questions 主路径、permission-presets、STUB-001/002、AC-30 全链路（fail-closed + 用户可见错误 + QuickPick hide）通过。旧 verification 中「gap 仍存在」断言已作废并翻转。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-10 Tab 关联（双 session 不串台） | spec | `verifier-independent-unit.mts` V-U2 | ✅ | `first → Tab A` / `second → Tab B` / `do not cross Tabs` |
| AC-16 approval Host 往返 | spec | `verifier-independent-e2e.mts` V-E2E-2 | ✅ | `approval Host round-trip logged allowed-once` |
| AC-17 questions Host→UI→response | spec | V-E2E-1 + GAP-007 产品树测 | ✅ | tabB（非 active tabA）+ log `selected:["yes"]` |
| AC-19 fail-closed / 不 next() | spec | V-E2E-5 | ✅ | `nextCalled === false`；非法 `allow-all` 丢弃后合法 `rejected` |
| AC-20 瀑布阻塞至结算 | spec | ide-bridge waterfall | ✅ | 未结算 Promise 直至 Host response / fail-closed |
| AC-21/22 permission-presets only | spec | V-E2E-3 | ✅ | list/select RPC；runtime log `kind:list|select` |
| AC-30 子进程退出 fail-closed | spec | V-E2E-4 | ✅ | pending 清空；`status=error` / lastError |
| AC-30 / **GAP-005** 用户可见错误 | debt-fix | V-E2E-4 + V-U8 | ✅ | `onError` 收到 transport 文案；extension `showErrorMessage(…session error…)` |
| AC-31 入站校验 | spec | V-U1 / V-E2E-5 | ✅ | `allow-all` / 非 string selected / 未知 kind → undefined |
| AC-33 ≥1 集成 + ≥1 e2e | spec | V-E2E-1..6 + vitest | ✅ | verifier e2e + 产品树集成 |
| **GAP-006** QuickPick hide | debt-fix | V-U6 + **V-E2E-6** | ✅ | `hideCount≥1`；子进程退出路径 hide |
| **GAP-007** questions 集成 | debt-fix | V-E2E-1 + gap-005-009 suite | ✅ | Host→UI→response + Tab 绑定 |
| **GAP-008** 空 options → InputBox | debt-fix | V-U5 | ✅ | 无 QuickPick；`custom` 写入；取消无 custom |
| **GAP-009** 关 Tab failClosedSession | debt-fix | V-U7 + V-U9 | ✅ | pending→unavailable；仅目标 session abort |
| STUB-001/002 填实 | registry | V-U3 | ✅ | outcome/answer 随 UI 输入变化 |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-U1 AC-31 参数变化拒非法帧 | `verifier-independent-unit.mts` | ✅ |
| V-U5 GAP-008 CLOSED（原「gap 探针」已翻转） | 同上 | ✅ |
| V-U6 GAP-006 CLOSED（AbortSignal + hide） | 同上 | ✅ |
| V-U7 GAP-009 CLOSED（关 Tab abort） | 同上 | ✅ |
| V-U8 GAP-005 CLOSED（onError 接线） | 同上 | ✅ |
| **V-U9 INDEPENDENT：failClosedSession 按 session 隔离 abort** | 同上 | ✅ |
| V-E2E-1 questions 错 active Tab 不串台 | `verifier-independent-e2e.mts` | ✅ |
| V-E2E-4 子进程退出 + onError 通知 | 同上 | ✅ |
| **V-E2E-6 INDEPENDENT：子进程退出 → QuickPick hide（implementer 未写此合成路径）** | 同上 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| GAP-005 transport → showErrorMessage | V-U8 + V-E2E-4 onError | ✅ 已关闭 |
| GAP-006 failClosed → QuickPick hide | V-U6 + V-E2E-6 | ✅ 已关闭 |
| GAP-007 questions 产品树集成 | gap-005-009 + V-E2E-1 | ✅ 已关闭 |
| GAP-008 InputBox custom | V-U5 | ✅ 已关闭 |
| GAP-009 关 Tab failClosedSession | V-U7 / V-U9 | ✅ 已关闭 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| approval/request → Host UI(Tab) → ApprovalOutcome → runtime log | ✅ | V-E2E-2 |
| user-questions/request → Host UI(正确 Tab) → AskUserQuestionAnswer | ✅ | V-E2E-1 |
| permission/list\|select → permission-presets（假 runtime） | ✅ | V-E2E-3 |
| child exit → failClosedAll → pending 空 + onError | ✅ | V-E2E-4 |
| child exit → AbortSignal → createQuickPick.hide() | ✅ | V-E2E-6 |
| illegal approval/response → 丢弃 → 不放行 / 不 next() | ✅ | V-E2E-5 |
| closeConversation → failClosedSession → dispose → registry.close | ✅ | V-U7 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| `promptFreeText` abort 时仅 Promise.race settle，未 `createInputBox().hide()` | 🟢 LOW | Host 等待已终止；空 options 低频；不影响 fail-closed 语义（reviewer Observation） |
| Extension `onError`→`showErrorMessage` 接线以源码 + Host 运行时 onError 合成证明 | 🟢 LOW | 未在真实 VS Code 进程内弹出 Message；fake window 足以覆盖契约 |

无 🟡 MEDIUM / 🔴 CRITICAL 残余风险。活跃债务表为空。

## Pipeline 合规检查

- 当前分支：`impl-phase-3-interaction-fail-closed`
- Pipeline compliance: ✅ 所有非 specs 产品改动均在 `impl-*` 工作分支上（未提交工作区；符合「implementer 不自行 commit」约定）
- STUB-001/002、GAP-005..009：registry「已解决」；本轮行为验证确认可关闭
- 疑似新桩：无

## implementer 套件（仅记录，不单独信任）

```
vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts apps/vscode-dsh/tests/
→ Test Files  9 passed (9) / Tests  41 passed (41)

vitest run apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts
→ Test Files  1 passed (1) / Tests  8 passed (8)
```

## 验证脚本

| 脚本 | 用途 |
|------|------|
| `test-scripts/run-verifier.sh` | 聚合 runner |
| `test-scripts/verifier-independent-unit.mts` | V-U1..U9（含 GAP 关闭断言翻转） |
| `test-scripts/verifier-independent-e2e.mts` | V-E2E-1..6（含 onError / QuickPick hide e2e） |

```
bash .specdev/specs/vscode-dsh-ide/phases/phase-3-interaction-fail-closed/test-scripts/run-verifier.sh
→ ALL VERIFIER STEPS OK
```
