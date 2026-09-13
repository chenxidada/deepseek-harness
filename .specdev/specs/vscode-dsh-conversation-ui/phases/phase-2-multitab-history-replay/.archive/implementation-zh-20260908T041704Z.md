# Phase 2 实现摘要

## 变更清单（文件列表）

### 新增
- `apps/vscode-dsh/src/replay-hydrator.ts` — 产品 ReplayHydrator（foldMessages / foldTimeline / hydrateFromAuthoritativeLog）
- `apps/vscode-dsh/src/history-view.ts` — 工作区历史 TreeView（独立于 Host 列索引）
- `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` — L2/L3：未读、审批队列、历史回放、DEBT-001/002
- `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-2-multitab-history-replay/test-scripts/run-phase2-l2-l3.sh`

### 修改（vscode-dsh）
- `apps/vscode-dsh/src/interaction-coordinator.ts` — AD-CU-7 全局串行队列 + 软优先 + 切 Tab demote `presented→pending`
- `apps/vscode-dsh/src/conversation-registry.ts` — `unread` / `approvalBadge`；激活清未读
- `apps/vscode-dsh/src/conversation-tab-bar.ts` — Tab 标签未读点 / 审批角标
- `apps/vscode-dsh/src/conversation-controller.ts` — `openFromHistory`、injectAssistant、reveal、未读 fan-out、active→coordinator
- `apps/vscode-dsh/src/extension-index.ts` — `listHistorySessions` + AD-CU-8 `continueCapabilityListHint`
- `apps/vscode-dsh/src/timeline-store.ts` — `replace` bulk；Diff `oldText: string | null`（拒缺失）
- `apps/vscode-dsh/src/diff-entry.ts` — null oldText → 空左侧文档
- `apps/vscode-dsh/src/session-host.ts` — `readSessionLog` → bridge `session/read-log`
- `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts` — `scroll/reveal`
- `apps/vscode-dsh/src/extension.ts` + `package.json` + `index.ts` — History 视图 / 命令 / L2 钩子

### 修改（ide-bridge）
- `packages/ide/ide-bridge/src/types.ts` / `validate.ts` / `index.ts` — `session/read-log` (+ response)；`SESSION_PERSISTENCE_SERVICE`
- `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` — read-log 往返用例
- `packages/ide/ide-bridge/lib/types/**` — 重建声明产物

### 债务 / 技能
- `.specdev/specs/vscode-dsh-conversation-ui/tech-debt-registry.md` — **关闭 DEBT-001、DEBT-002**；GAP-001 仍活跃
- `.cursor/skills/project-test/SKILL.md` / `project-build/SKILL.md`

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| AC-19/57 | 非活动 assistant append → `unread=true`；`switchTo` / `switchConversation` 清除 |
| AC-20/58 | coordinator 队列：全局单弹层、活动软优先插队、队头 fail 出队、切 Tab 未作答 demote 回 pending（角标保留）并唤醒目标 |
| AC-22 | Tab 标题沿用 title / 首条用户消息（既有） |
| AC-28/29/63 | `ExtensionIndex.listHistorySessions` + History TreeView；workspaceState 作用域；unknown 不显示「可继续」 |
| AC-30/64/65/47 | `openFromHistory` → ReplayHydrator → `messages.replace` + `timeline.replace`；mode=replay；同 session 单开激活；关后再开新 tabId |
| AC-31 | 既有 Host `sendPrompt` replay → `ui/reject-send`；L3 FakeWebview 覆盖 |
| AC-80 | 依赖 phase-0a spike-report PASS（前置已满足） |
| AC-54/84 | `run-phase2-l2-l3.sh` + phase2 spec（关 Tab→回放、审批唤醒、回放误发） |
| AC-16/56/62 | Should：`changedFileCount` / `revealTarget`+`scroll/reveal` / history 行 `dsh.test.deleteHistory` + 菜单 |

## 测试结果（命令 + 输出）

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
# exit 0

bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-2-multitab-history-replay/test-scripts/run-phase2-l2-l3.sh
# Test Files 3 passed | Tests 26 passed

PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests
# Test Files 18 passed | Tests 66 passed
```

## 偏差记录

无阻塞偏差。

- **偏差描述**：Host 未连时 `openFromHistory` 返回 `host-not-ready`（说明文案经 `dsh.openHistory`）；完整「等待 Host 后自动重建」对齐 phase-3 AC-69。
- **影响范围**：spec.md 约束「Host 未连打开历史须有说明」/ design 失败模式表
- **原因**：phase-2 明确不交付重启全集 / AC-69 自动重建
- **影响**：phase-3 可接续自动 hydrate

- **偏差描述**：未实现 GAP-001 `session/resume` / Continue 产品（按指令勿做）。
- **影响范围**：AD-CU-8 Continue 列；phase-3
- **原因**：排除项
- **影响**：列表可写 unknown / same-id 暗示，顶栏 Continue 仍待 phase-3

## 已关闭债务

- **DEBT-001** — ReplayHydrator 完整 Timeline oracle + replace + oldText:null
- **DEBT-002** — 双 running 切 Tab status 不串

## 未改范围

- `packages/core/**/agent-loop*` — 未改
- Continue / resume / 重启未关 Tab 集 — phase-3
- 未新建 `interaction-queue.ts`
