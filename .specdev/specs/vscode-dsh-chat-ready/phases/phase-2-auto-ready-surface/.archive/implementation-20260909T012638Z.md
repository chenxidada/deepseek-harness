# Phase 2 实现摘要 — phase-2-auto-ready-surface

## 变更清单（文件列表）

### 新增
- `apps/vscode-dsh/src/auto-ready-coordinator.ts` — AutoReady latch + restore/New/ensure（AD-CR-3/5/6）
- `apps/vscode-dsh/tests/phase2-auto-ready.spec.ts` — L2 AC-3/4/4a/4b/6/7 + L1 reuse/coordinator

### 修改
- `apps/vscode-dsh/src/extension.ts` — 移除 Start 成功路径 restore/New（DEBT-001）；接线 `AutoReadyCoordinator`；`dsh.newConversation` → `newConversationOrReuseEmpty`；`dsh.test.triggerAutoReady`
- `apps/vscode-dsh/src/conversation-controller.ts` — `newConversationOrReuseEmpty`；`restoreOpenTabSet` 接受 `markUnread`/`autoContinue`（AutoReady 恒为 false）
- `apps/vscode-dsh/src/connection-ui.ts` — 删除 `AutoReadyLatchSeam`（STUB-001）
- `apps/vscode-dsh/src/index.ts` — 导出 `AutoReadyCoordinator`（替代 LatchSeam）
- `apps/vscode-dsh/README.md` — Auto-ready timing；Start 不再 restore；DEBT-002 生产活动栏等价说明
- `.specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md` — STUB-001 / DEBT-001 / DEBT-002 → 已解决
- `.cursor/skills/project-test/SKILL.md` / `project-build/SKILL.md` — Phase 2 命令与说明

### 未改
- `packages/core/**/agent-loop*`（AC-26 / AD-CR-11）
- DEBT-003（Webview Continue 旁路 → phase-4）

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| AC-3 | 可见∧就绪 → `restoreOpenTabSet({ markUnread:false, autoContinue:false })`；不调用 `continueConversation`；`suppressUnreadForAutoReady` |
| AC-4 | 空 openTabSet → `newConversationOrReuseEmpty` → live；`sendPrompt` 可入队；unread false |
| AC-4a | 既有 `persistOpenTabs` 跳过 `!hasContent`；首条成功 `prompt*` 后写入；L2 证明转换点 |
| AC-4b | `hasWorkspaceIndex()` = `workspaceFolders.length > 0`；无 folder 跳过 restore，直接 New；Start 仍执行 |
| AC-6 | `ensureReadySurface` / `newConversationOrReuseEmpty` 仅复用**活动**空 Tab；禁止全局偷换 |
| AC-7 | L2：`fireConversationVisibility` 主路径 + `simulateStartupOnly` / hidden Start 仍 0 Tab |
| AC-27 | 全量 `apps/vscode-dsh/tests` 103/103 回归绿 |

## 测试结果（命令 + 输出）

```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts
# Test Files  3 passed (3)
# Tests  23 passed (23)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests
# Test Files  22 passed (22)
# Tests  103 passed (103)

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0
```

## 偏差记录

### 偏差 1 — DEBT-002 以 README 等价声明关闭（非独立 VS Code 事件接线）
- **偏差描述**：未新增生产侧「活动栏容器打开」独立监听；README 声明生产 AC-1b 等价于 Conversation 可见性（reveal / status-bar / showPanel）；L2 保留 `dsh.test.openActivityBar`。
- **影响范围**：spec.md 不在本 Phase Must 强制像素级活动栏 API；design.md AD-CR-2；Entry Gate「DEBT-002 余力」
- **原因**：repo-exploration R8 — 无可靠 VS Code container-open 事件；余力路径选探索建议 (a)
- **影响**：产品仍依赖可见性主路径；phase-4 若需更强活动栏信号可再增强

### 偏差 2 — `restoreOpenTabSet` 的 markUnread/autoContinue 为显式 API 接受但不改变既有 hydrate 行为
- **偏差描述**：选项写入签名并在 AutoReady 恒传 `false`；函数体不因此分支调用 Continue 或打未读（既有 restore 本就不做这两件事）；另以 `suppressUnreadForAutoReady` 防御性清 unread。
- **影响范围**：spec.md AC-3；design.md AD-CR-3 伪代码
- **原因**：既有 restore 路径已满足语义；显式选项便于契约与 L2 可读性
- **影响**：无行为回退

## 债务

| ID | 状态 |
|----|------|
| STUB-001 | ✅ 已解决（本 Phase） |
| DEBT-001 | ✅ 已解决（本 Phase） |
| DEBT-002 | ✅ 已解决（本 Phase，README 等价） |
| DEBT-003 | 🟡 仍活跃 → phase-4 |

无新增 `@STUB`。
