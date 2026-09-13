# Phase 2 验证报告（GAP-003 / GAP-004 债务修复回路）

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-6: 新建 Tab 分配可区分 sessionId | spec | `tsx …/verifier-independent-unit.mts` V-U1 + `tsx …/verifier-independent-e2e.mts` | ✅ | 3 Tabs → 3 distinct sessionIds；e2e 同证 |
| AC-7: 切换 Tab 不串 sessionId | spec | `tsx …/verifier-independent-e2e.mts` V-E2E-1 | ✅ | 交错 A→C→B→A prompt；`FAKE_PROMPT_LOG` 4 条 1:1 |
| AC-8 / GAP-003: dispose 成功后才删注册表 | spec+debt | unit V-U3 + `verifier-gap-003-004-e2e.mts` | ✅ | dispose 进行中 Tab 仍在；成功后删除；失败可重试 |
| AC-9: ≥2 Tab 同工作区 | spec | unit V-U1 + e2e | ✅ | registry ≥3；e2e 三 Tab |
| AC-11: 首条消息作标题 | spec | e2e V-E2E-1 | ✅ | Tab A/B/C title = 首条用户消息 |
| AC-15: 不重实现 agent-loop | spec | unit V-U5 | ✅ | Extension src 无 forbidden imports |
| AC-33: ≥1 集成 + ≥1 独立 e2e | spec | gap-e2e + independent-e2e | ✅ | 两条 verifier 自有 e2e 全部 PASS |
| GAP-004: TreeView command → switch | debt | unit V-U4 + gap-e2e V-GAP-E2E-2 | ✅ | `dsh.switchConversation` + tabId；点击切 Tab 后 wire 正确 |
| 回归: dispose → Map.delete + AgentHandle.dispose | review | `tsx …/verifier-dispose-map-handle.mts` | ✅ | order=`map.delete` → `handle.dispose`；bridge ok:true |
| STUB-001/002 fail-closed | debt | unit V-U6 | ✅ | `unavailable` / `NO_PROVIDER` + `@STUB(phase-3…)` 仍在 |
| implementer suite（记录，不单独采信） | impl | vitest apps/vscode-dsh + ide-bridge | ✅ | 21/21 passed |
| implementer GAP 回归（记录） | impl | vitest `gap-003-004-debt-fix.spec.ts` | ✅ | 4/4 passed |
| SDK disposeSession clears | impl | vitest server `-t "disposeSession clears"` | ✅ | 1 passed |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-U3-retry: dispose 失败保留 Tab → 第二次 close 成功删除（implementer 未测 fail→retry） | `tsx …/verifier-independent-unit.mts` | ✅ |
| V-U4-click: TreeView arg → `switchConversation` → `promptActive` 路由到正确 sessionId（implementer 仅断言 command 字符串） | 同上 | ✅ |
| V-GAP-E2E-1/2: 真实 IdeSessionHost + fake runtime — dispose 进行中 Tab 仍在；TreeView 切 Tab 后 `FAKE_PROMPT_LOG` 无串会话 | `tsx …/verifier-gap-003-004-e2e.mts` | ✅ |
| V-U6: STUB-001/002 静态 fail-closed 回归 | unit V-U6 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| dispose 失败路径保留 Tab | unit V-U3-retry + debt-fix vitest | ✅ |
| dispose→close 顺序 | unit V-U3-order | ✅ |
| TreeItem.command + tabId args | unit V-U4 | ✅ |
| Map.delete before AgentHandle.dispose | `verifier-dispose-map-handle.mts` | ✅ |
| 多 Tab 不串 sessionId | `verifier-independent-e2e.mts` | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| ConversationController → IdeSessionHost.prompt → fake SDK → FAKE_PROMPT_LOG（3-Tab 交错） | ✅ | V-E2E-1：4 条 log 文本/sessionId 1:1，无交叉 |
| closeConversation → Host.disposeSession → bridge `session/dispose` → registry.close | ✅ | V-GAP-E2E-1：dispose 进行中 `registry.get(drop)` 非空；成功后 undefined；邻 Tab 仍可 prompt |
| TreeView getTreeItem.command.args → switchConversation → promptActive → wire | ✅ | V-GAP-E2E-2：entry2 sessionId = switch-target；已关 Tab 不出现在 TreeView args / prompt log |
| Host broadcast session/dispose → Cordis `sdkSessionDispose` → Map.delete → handle.dispose | ✅ | V-DISPOSE-1/2：order + `ok:true` |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 同一 tabId 并发双重 closeConversation | 🟢 LOW | reviewer 已观察；二次 dispose 依赖 Host；非本债务范围 |
| Extension 命令 handler 无 VS Code 宿主集成测试 | 🟢 LOW | TreeView arg → controller 路径已由 verifier 模拟；真实 VS Code UI 点击未跑 |

无 CRITICAL / MEDIUM 残余风险；GAP-003/004 行为已端到端证实。

## Pipeline 合规检查

- 当前分支：`impl-phase-2-multi-tab-session`
- Pipeline compliance: ✅ 所有 Phase 2 非 specs 改动位于 `impl-*` 分支工作区（implementer 惯例：HG-3 前不自行 commit）
- `git branch --show-current` = `impl-phase-2-multi-tab-session`
- STUB-001/002 仍在 `tech-debt-registry.md` 活跃债务（目标 Phase 3）；GAP-003/004 已在「已解决」

## 验证脚本

落盘于 `test-scripts/`：

| 脚本 | 用途 |
|------|------|
| `run-verifier.sh` | 一键跑全部 verifier + implementer 记录套件 |
| `verifier-independent-unit.mts` | V-U1…V-U6（含 GAP-003/004 关闭断言 + fail→retry + TreeView-click） |
| `verifier-independent-e2e.mts` | 3-Tab 交错路由 + close 后存活 Tab |
| `verifier-gap-003-004-e2e.mts` | **新增** GAP 债务修复独立 e2e（live Host） |
| `verifier-dispose-map-handle.mts` | Map.delete → AgentHandle.dispose + bridge wiring |

运行结果：`ALL VERIFIER STEPS OK`（2026-09-07，Node v24.3.0）。
