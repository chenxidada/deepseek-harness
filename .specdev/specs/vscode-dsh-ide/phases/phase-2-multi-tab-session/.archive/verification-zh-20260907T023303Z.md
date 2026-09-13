# Phase 2 验证报告 — phase-2-multi-tab-session

## 判决：PARTIAL

主路径（多 Tab `sessionId`、切换不串会话、关 Tab → bridge dispose → Map 清理 + `AgentHandle.dispose`）已由 **verifier 独立脚本** 运行时证明；implementer 套件交叉通过。因审查 SHOULD-FIX / Known Gaps（GAP-003、GAP-004）仍未解决，按规则不得判 PASS。

## 为何不是 PASS（问题清单）

1. **GAP-003（🟡 MEDIUM）**：`closeConversation` 先 `registry.close` 再 `await disposeSession`。dispose 失败时 UI 已无 Tab，runtime session 可能残留且无法从 Tab 栏重试关闭。独立单元 V-U3 已复现「dispose 进行中 Tab 已消失」。
2. **GAP-004（🟡 MEDIUM / UX）**：Conversations TreeView 未接线 `switchConversation`（无 `command` / selection handler）；切换仅靠 QuickPick。AC-7 命令路径可用，但「点侧栏 Tab」未接通。V-U4 已确认。
3. **STUB-001 / STUB-002**：目标 Phase 3 — 本 Phase **跳过**完整 Host 审批/提问往返（不计入失败）。

主路径 Must AC（AC-6/7/8/9/15/33 成功路径）与 dispose Map+handle 顺序 **已独立证明**；PARTIAL 仅因上述未关闭 Known Gaps。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-6/9: ≥3 Tab 可区分 sessionId | verifier | `tsx …/verifier-independent-unit.mts` + e2e | ✅ | V-U1 / V-E2E-1: 3 个互异 UUID sessionId |
| AC-7: 切换不串会话（3-Tab 交错） | verifier | `tsx …/verifier-independent-e2e.mts` | ✅ | FAKE_PROMPT_LOG 4+2 行与 Tab A/B/C 一一对应 |
| AC-8/Q-3: 关 Tab → bridge dispose | verifier + impl | e2e + dispose-map-handle + vitest | ✅ | close 后 registry 无该 session；Host `session/dispose/response ok` |
| AC-8: Map.delete → AgentHandle.dispose | verifier | `tsx …/verifier-dispose-map-handle.mts` | ✅ | order=`["map.delete:owned-v","handle.dispose"]` |
| AC-11: 首条消息标题 | verifier e2e | 同上 | ✅ | titles = alpha-1 / beta-1 / gamma-1 |
| AC-15: 扩展不重实现 agent-loop | verifier | V-U5 静态扫 src | ✅ | 6 个 Extension 源文件无禁止 import |
| AC-33: ≥1 集成 + ≥1 e2e | spec | implementer + verifier e2e | ✅ | impl 17 tests；verifier e2e ALL PASS |
| GAP-003 确认 | verifier | V-U3 | ⚠️ Known | dispose 进行中 registry 已空 |
| GAP-004 确认 | verifier | V-U4 | ⚠️ Known | TreeItem.command === undefined |
| STUB-001/002 Host 往返 | registry | — | ⏭ | Phase 3；跳过 |

### Implementer 套件（记录，不单独作为判决依据）

```text
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
./node_modules/.bin/vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts
# Test Files  5 passed (5)
# Tests       17 passed (17)

./node_modules/.bin/vitest run packages/sdk/server/tests/server.spec.ts -t "disposeSession clears"
# Tests  1 passed | 32 skipped
```

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-U1 三 Tab 参数变化 + 关中间 Tab | `verifier-independent-unit.mts` | ✅ |
| V-U2 titleFromFirstMessage 反桩（多输入不同输出） | 同上 | ✅ |
| V-U3 GAP-003 时序观测 | 同上 | ✅（确认 gap） |
| V-U4 GAP-004 TreeView 无 command | 同上 | ✅（确认 gap） |
| V-U5 AC-15 静态禁止 import | 同上 | ✅ |
| V-E2E-1 三 Tab 交错 prompt（impl 仅测 2 Tab 顺序） | `verifier-independent-e2e.mts` | ✅ |
| V-E2E-2 关中 Tab 后 A/C 仍隔离 | 同上 | ✅ |
| V-DISPOSE-1 Map→dispose 顺序 + 可重建 | `verifier-dispose-map-handle.mts` | ✅ |
| V-DISPOSE-2 Host bridge → sdkSessionDispose | 同上 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 主路径 vitest（apps + ide-bridge） | `vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/…` | ✅ 17/17 |
| disposeSession clears Map | `vitest … server.spec.ts -t "disposeSession clears"` | ✅ |
| 关 Tab 先删注册表（Should-Fix） | V-U3 | ⚠️ 确认为 GAP-003 |
| TreeView 未接线 switch | V-U4 | ⚠️ 确认为 GAP-004 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| newConversation ×3 → 独立 sessionId | ✅ | V-E2E-1 |
| switch → promptActive → stdout `session/prompt`（FAKE_PROMPT_LOG） | ✅ | 交错 A→C→B→A 无串话 |
| closeConversation → Host `session/dispose` → runtime ack | ✅ | V-E2E-2 + V-DISPOSE-2 |
| sdk `disposeSession` → Map.delete → `handle.dispose()` | ✅ | V-DISPOSE-1 顺序断言 |
| 关 Tab 后剩余 Tab 仍用原 sessionId | ✅ | post-close prompts A/C |
| STUB-001/002 Host UI 往返 | ⏭ | Phase 3 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| GAP-003 dispose 失败留下无 Tab 的 runtime session | 🟡 MEDIUM | 成功路径已证；失败路径未修 |
| GAP-004 侧栏点击无法切换 | 🟡 MEDIUM | QuickPick 路径满足 AC-7；产品期望侧栏切换则需补线 |
| STUB-001/002 审批/提问 | 🟡（延期） | 目标 Phase 3；本 Phase 跳过 |
| Fake runtime ≠ 真实 agent-loop | 🟢 LOW | dispose Map+handle 已对真实 `HarnessSdkJsonRpcServer` 证明；prompt 路由用 fake 子进程 |

## Pipeline 合规检查

- 当前分支：`impl-phase-2-multi-tab-session`
- 非 specs 改动均在该 `impl-*` 工作区（未提交；未在 main 上直接编码）
- Pipeline compliance: ✅ 所有本 Phase 代码变更位于 `impl-phase-2-multi-tab-session`

## 验证脚本

落盘目录：`.specdev/specs/vscode-dsh-ide/phases/phase-2-multi-tab-session/test-scripts/`

| 文件 | 用途 |
|------|------|
| `run-verifier.sh` | 一键跑全部 verifier + implementer 交叉套件 |
| `verifier-independent-unit.mts` | V-U1…U5 |
| `verifier-independent-e2e.mts` | V-E2E-1/2 |
| `verifier-dispose-map-handle.mts` | V-DISPOSE-1/2 |

运行：

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  bash .specdev/specs/vscode-dsh-ide/phases/phase-2-multi-tab-session/test-scripts/run-verifier.sh
# → ALL VERIFIER STEPS OK（本机 2026-09-07）
```

## 债务注册更新

- 新增 **GAP-003**、**GAP-004** → `tech-debt-registry.md` 活跃债务（🟡非阻塞）
- STUB-001/002 保持指向 Phase 3
