# Phase 3 验证报告 — interaction fail-closed

## 判决：PARTIAL

主路径（approval / questions Host 往返、permission-presets、fail-closed、STUB 填实、AC-31）已由 **verifier 独立脚本** 端到端证明。合并审查 SHOULD-FIX 五项均获独立证据确认并登记为 GAP-005..009（🟡非阻塞）→ 不能判 PASS。

## 为什么不是 PASS（问题清单）

1. **GAP-005 / AC-30 展示错误态不完整**：`onTransportDeath` 写入 `status='error'` 与 `failClosedAll`，但 `extension.ts` 无异步 `showErrorMessage` → 用户可能只看到卡住的 QuickPick。
2. **GAP-006**：`failClosedAll` 不取消已打开的 QuickPick（UI Promise 在 abort 后仍继续）。
3. **GAP-007**：产品树 `apps/vscode-dsh/tests` 缺 questions 成功路径集成测（功能本身经 V-E2E-1 已证明可用）。
4. **GAP-008**：无 options 提问仅 `(skip)`，无 InputBox 自由文本。
5. **GAP-009 / AD-5**：`closeConversation` 不 abort 该 session 未结算 Host UI。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-10 Tab 关联（双 session 不串台） | spec | `tsx …/verifier-independent-unit.mts` V-U2 | ✅ | `first → Tab A` / `second → Tab B` / `do not cross Tabs` |
| AC-16 approval Host 往返 | spec | `tsx …/verifier-independent-e2e.mts` V-E2E-2 | ✅ | `approval Host round-trip logged allowed-once` |
| AC-17 questions Host→UI→response | spec + **独立** | `tsx …/verifier-independent-e2e.mts` V-E2E-1 | ✅ | `FAKE_EMIT_QUESTIONS_SESSION`→tabB；log `selected:["yes"]`；active 为 tabA 不串台 |
| AC-19 fail-closed / 不 next() | spec | V-E2E-5 + implementer suite | ✅ | `nextCalled === false`；非法 `allow-all` 丢弃后合法 `rejected` |
| AC-20 瀑布阻塞至结算 | spec | ide-bridge waterfall 往返 | ✅ | 未结算 Promise 直至 Host response / fail-closed |
| AC-21/22 permission-presets only | spec | V-E2E-3 | ✅ | list/select RPC；runtime log `kind:list|select` |
| AC-30 子进程退出 fail-closed（核心） | spec | V-E2E-4 | ✅ | pending 清空；`lastError`/`status=error` |
| AC-30 用户可见错误 UI | spec | V-U8 | ❌→GAP | 无 transport-death `showErrorMessage` |
| AC-31 入站校验 | spec | V-U1 / V-E2E-5 | ✅ | `allow-all` / 非 string selected / 未知 kind → undefined |
| AC-33 ≥1 集成 + ≥1 e2e | spec | V-E2E-1..4 + implementer | ✅ | verifier e2e + vitest 集成/e2e |
| STUB-001/002 填实 | registry | V-U3 | ✅ | Host outcome/answer 随 UI 输入变化（非恒 unavailable） |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-U1 AC-31 参数变化拒非法帧 | `verifier-independent-unit.mts` | ✅ |
| V-U2 双 Tab 审批路由 | 同上 | ✅ |
| V-U3 STUB 反桩（多 outcome/answer） | 同上 | ✅ |
| V-U5/U6/U7/U8 GAP 探针 | 同上 | ✅（确认缺口） |
| **V-E2E-1 questions Extension 集成（implementer 未写）** | `verifier-independent-e2e.mts` | ✅ |
| V-E2E-5 非法 outcome 丢弃 + 不 next() | 同上 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| transport death 缺 showErrorMessage | V-U8 静态 + V-E2E-4 运行时 | ✅ 确认 GAP-005 |
| failClosed 不取消 QuickPick | V-U6 | ✅ 确认 GAP-006 |
| questions 缺产品树集成测 | 对照 `apps/vscode-dsh/tests` + V-E2E-1 | ✅ 功能通；测试债 GAP-007 |
| 无 options 自由文本弱 | V-U5 | ✅ 确认 GAP-008 |
| 关 Tab 未 abort | V-U7 | ✅ 确认 GAP-009 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| approval/request → Host UI(Tab) → ApprovalOutcome → runtime log | ✅ | V-E2E-2 + fake `FAKE_APPROVAL_LOG` |
| user-questions/request → Host UI(正确 Tab) → AskUserQuestionAnswer | ✅ | V-E2E-1 + `FAKE_QUESTIONS_LOG` |
| permission/list\|select → permissionPresets（假 runtime 唯一写入口） | ✅ | V-E2E-3 |
| child exit → failClosedAll → pending 空 | ✅ | V-E2E-4 |
| illegal approval/response → 丢弃 → 不放行 | ✅ | V-E2E-5 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| AC-30 用户可见错误展示不足（GAP-005） | 🟡 MEDIUM | 状态已写；VS Code 弹错未接 |
| QuickPick 悬空（GAP-006） | 🟡 MEDIUM | Host 等待已结算；面板可能仍挂起 |
| 关 Tab 未结算交互（GAP-009） | 🟡 MEDIUM | 与 AD-5 不一致；晚到应答成孤儿帧 |
| 自由文本提问弱（GAP-008） | 🟢 LOW | 合法答案形状仍可 skip；体验缺口 |
| questions 产品树缺对称集成测（GAP-007） | 🟢 LOW | verifier 已覆盖；回归面略薄 |

## Pipeline 合规检查

- 当前分支：`impl-phase-3-interaction-fail-closed`
- Pipeline compliance: ✅ 本 Phase 非 specs 改动均在 `impl-*` 工作分支上（未提交工作区；符合「implementer 不自行 commit」约定）
- STUB-001/002：registry「已解决」；V-U3 行为确认非桩

## implementer 套件（仅记录，不单独信任）

```
PATH=…/node/24.3.0/bin:$PATH ./node_modules/.bin/vitest run \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts apps/vscode-dsh/tests/
→ Test Files  8 passed (8) / Tests  33 passed (33)
```

## 验证脚本

| 脚本 | 用途 |
|------|------|
| `test-scripts/run-verifier.sh` | 一键：unit + e2e + implementer suite |
| `test-scripts/verifier-independent-unit.mts` | V-U1..U8 |
| `test-scripts/verifier-independent-e2e.mts` | V-E2E-1..5（含 questions 独立路径） |

运行：

```sh
bash .specdev/specs/vscode-dsh-ide/phases/phase-3-interaction-fail-closed/test-scripts/run-verifier.sh
```
