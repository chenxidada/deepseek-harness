# Phase 1 实现摘要 — phase-1-auto-start-orchestrator（Should-Fix #2/#3）

## 本轮范围（仅关 Should-Fix #2 与 #3）

用户明确要求本 Phase 关闭合并审查 Should-Fix **#2** 与 **#3**。**未**扩大到 #1（活动栏生产信号）或 #4（Continue 旁路）。

| # | 项 | 本轮动作 | 关闭？ |
|---|----|---------|:-----:|
| 2 | AC-13：connecting 投影缺专用 L2 | 新增正式 L2：Host `start` 挂起期间断言 `getChatPanelHost().getConnectionPhase()==='connecting'`，settle 后为 `connected` | ✅ |
| 3 | `deleteHistory` 第二分支缺独立 L2 | 拆成两条独立 L2：unbound（无 controller）+ bound+host-offline（controller 仍绑、Host 断） | ✅ |
| 1 | AC-1b 生产活动栏信号 | 未改（偏差 2） | — |
| 4 | Webview Continue 旁路 | 未改 | — |

功能侧 AC-1e 提示路径此前已对齐；本轮为**测试补强**，未改 `extension.ts` / `connection-ui.ts` 产品逻辑（已有 `getConnectionPhase` / `getConversationController` 可观测钩子足够）。

## 变更清单（文件列表）

### 本轮
- `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` — AC-13 mid-flight connecting L2；AC-1e `deleteHistory` unbound / bound+offline 双 L2
- `.cursor/skills/project-test/SKILL.md` — chat-ready Phase 1 用例数与说明更新

### 未改（本轮）
- `apps/vscode-dsh/src/extension.ts` / `connection-ui.ts` / `chat-panel/*`（产品路径已满足，无需新钩子）
- `packages/core/**/agent-loop*`（AC-26）
- Should-Fix #1 / #4

## 对每个验收标准的实现说明（本轮相关）

| AC | 本轮 |
|----|------|
| AC-13 | L2：`requestStart` 时 `IdeSessionHost.start` 挂起 → orchestrator `starting`/`pending-start` → panel `connectionPhase==='connecting'`；release 后 `connected` + orchestrator `started` |
| AC-1e | L2 ① unbound：`getConversationController()===undefined` → 提示「Host 连接后可删除」+ `start`=0；L2 ② bound+offline：首启成功后断线、disconnect-retry 挂起以保持 controller 绑定 → `deleteSession`→`host-not-ready` → 同文案且 `start` 调用数在 delete 前后不增 |

其余 AC 以前轮实现为准（未回退）。

## 测试结果（命令 + 输出）

```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts
# Test Files  2 passed (2)
# Tests  15 passed (15)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests
# Test Files  21 passed (21)
# Tests  95 passed (95)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0
```

## 偏差记录

### 偏差 1 — Start 成功路径仍绑定 restore/New（继承）
- **偏差描述**：`StartHostPort.start` 成功后仍调用 `restoreOpenTabSet` + 空则 `newConversation`。
- **影响范围**：spec.md §不在本 Phase 范围 / design.md AD-CR-3
- **原因**：完整 AutoReady 属 phase-2（DEBT-001）
- **影响**：phase-2 拆出；仅激活仍不 New（AC-1a）

### 偏差 2 — 活动栏打开的产品信号（继承；Should-Fix #1 未做）
- **偏差描述**：生产「点击活动栏」无独立事件时，主要依赖 Conversation 可见性 / test hook / 状态栏。
- **影响范围**：spec.md AC-1b；design.md AD-CR-2
- **原因**：repo-exploration R8；本轮按用户约定不扩大到 #1
- **影响**：L2 仍证明 reveal+request

## 债务

见 `tech-debt-registry.md`：STUB-001、DEBT-001（本轮无新增桩；无已解决项变更）。

## Should-Fix 状态

1. AC-1b 生产活动栏信号 — **仍开**（本轮未做）
2. AC-13 connecting 专用 L2 — **已关闭**
3. `deleteHistory` unbound vs bound+offline 独立 L2 — **已关闭**
4. Webview `action/continue` 旁路 — **仍开**（本轮未做）
