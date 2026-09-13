# Phase 5 实现摘要 — phase-5-fork-retry-branch

## 变更清单（文件列表）

### 新增
| 文件 | 说明 |
|------|------|
| `apps/vscode-dsh/src/fork/fork-orchestrator.ts` | 边界校验（closed / 非 aborted）+ P-接续/P-标明 presentation 辅助 |
| `packages/sdk/server/src/session-fork.ts` | `sdkSessionFork` Cordis 服务契约 |
| `apps/vscode-dsh/tests/chat-ux-fork-retry-branch.spec.ts` | 层 B：AC-30/31/31b/32/33/34/60/64/65/66 + P2-1 |

### 修改
| 文件 | 说明 |
|------|------|
| `packages/ide/ide-bridge/src/types.ts` | `session/fork` 帧 + `SDK_SESSION_FORK_SERVICE` |
| `packages/ide/ide-bridge/src/validate.ts` | fork 帧校验 |
| `packages/ide/ide-bridge/src/index.ts` | `handleFork` → sdkSessionFork |
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | fork 解析 + Host round-trip |
| `packages/sdk/server/src/server.ts` | `forkSession`：fork-seed + `agents.create`（prompt-ready child） |
| `packages/sdk/server/src/index.ts` | provide `sdkSessionFork` |
| `apps/vscode-dsh/src/session-host.ts` | `forkSession` pending-map（镜像 cancel） |
| `apps/vscode-dsh/src/fork` 编排接入 `conversation-controller.ts` | `forkFromClosedTurn` / `applyContinueSwitch` / `applyBranchMark` / E2 Sets |
| `apps/vscode-dsh/src/continue-capability.ts` | `continueSealed` → Continue disabled |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `action/retry|edit-resend|branch|copy-message`；`forkParentTitle` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 动作接线；`pushFullState` 下发 probes（GAP-CUX-002） |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 复制/重试/编辑重发/分叉按钮；父子文案 |
| `apps/vscode-dsh/src/extension.ts` | copy → `lastCopiedText`；fork 动作；`dsh.test.lastCopiedText` |
| `apps/vscode-dsh/src/extension-index.ts` | `forkLabel` 字段 |
| `.specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md` | **GAP-CUX-002 → 已解决** |

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-30** | `action/copy-message` → Host/`dsh.copyToClipboard`；`lastCopiedText` + `dsh.test.lastCopiedText` / `getLastCopiedText()` |
| **AC-31** | `forkFromClosedTurn({intent:'retry'})` → bridge/SDK fork → `applyContinueSwitch`（父 `mode→replay`，切 child） |
| **AC-31b** | 父记入 `parentReadonlySessions` + `continueSealedSessions`；`pushFullState.probes`；Continue sealed；层 B 拒「仍 live 无探针」 |
| **AC-32** | `intent:'edit-resend'` 同 P-接续；`editedText` 自动 prompt child |
| **AC-33** | 三入口共用 `forkFromClosedTurn`；无 truncate API |
| **AC-34/61** | 产品先验：`resolveClosedTurnBoundary` 拒 aborted/open；核心 alone 不够 |
| **AC-60** | `intent:'branch'` → `applyBranchMark`；父 mode 不变 |
| **AC-62** | presentation `continue-switch` vs `branch-mark`；banner kind 区分 |
| **AC-63** | `parentSessionId` + `forkLabel`「派生自 …」；`forkParentTitle` |
| **AC-64** | fork 不拷贝 ChangeStore；子 `list(childId)=[]`；无 checkout |
| **AC-65** | `continueConversation` 仍 same-id resume（对照） |
| **AC-66** | P-接续不调父 id `continueConversation`/`resume`；绑定 child Tab |
| **P2-1** | 父 `status===running` 拒绝 fork |
| **GAP-CUX-002** | Host 产品路径推送 probes；已关闭 |

## 测试结果（命令 + 输出）

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-fork-retry-branch.spec.ts
# Test Files  1 passed (1)
# Tests  10 passed (10)

./node_modules/.bin/vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts -t "fork"
# Tests  1 passed (session/fork Host round-trip)

./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts
# Tests  7 passed (回归)
```

合计本 Phase 主测：**10 + 1 bridge fork + 7 cancel 回归 = 18 passed**。

## 偏差记录

### 偏差 1：sdkSessionFork 使用 `agents.create`+seed，而非直接 `sessions.fork` 后挂 Agent
- **偏差描述**：`HarnessSdkJsonRpcServer.forkSession` 用与 `SessionStore._forkSeed` 等价的 seed 切分，再 `agents.create` 注册 prompt-ready child。
- **影响范围**：design.md Bridge/SDK § / AD-CUX-5
- **原因**：单独 `sessions.fork` 会在 SessionStore 留下无 Agent 的会话，后续 `agents.create` 同 id 冲突；web Remote 亦用 `agents.create`+seed。
- **影响**：语义与 lineage（`parentSession`/`isSeeded`）一致；子会话可 prompt。

### 偏差 2：retry/edit 的实际 fork 边界为「目标 turn 的前一 closed turn」
- **偏差描述**：校验目标 turn 为正常 closed 后，retry/edit 在 prior turn/end（或空）处 fork，再对 child auto-prompt；branch 仍在目标 turn/end 处 fork。
- **影响范围**：spec.md AC-31/32；design.md ForkRequest「seed 含该 user」
- **原因**：若在目标 turn/end 处 fork，seed 已含完整 user+assistant，再 prompt 会重复；prior-cut + prompt 等价于「丢弃其后并重发」。
- **影响**：层 B 覆盖 P-接续/E2；下游勿假设 retry 的 boundarySeq 等于目标 turn/end。

### 偏差 3：edit-resend 的 editedText 经 child prompt 写入，非改写冻结 seed 事件
- **偏差描述**：不改写 frozen seed 内 user/message；fork 后对 child `promptTab(editedText)`。
- **影响范围**：design.md ForkRequest.editedText
- **原因**：SessionEvent 深冻结，seed 改写成本高且易踩不变量。
- **影响**：子会话日志以「prior 前缀 + 新 turn」呈现；对产品重试/编辑可接受。
