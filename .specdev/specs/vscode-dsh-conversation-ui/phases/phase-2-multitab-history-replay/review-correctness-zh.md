# 正确性审查 — phase-2-multitab-history-replay

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**PASS**

## 复审焦点（MUST-FIX loop 1 / AC-63）

| 项 | 结果 | 证据 |
|----|:--:|------|
| `resolveWorkspaceIndex` 冷读 | ✅ | `extension.ts:784-787`：未绑定 `conversations` 时 `new ExtensionIndex(workspaceKey, workspaceState)` |
| TreeView / `listHistory` / `getIndex` 无 Host | ✅ | TreeView `getRows`、`dsh.test.listHistory`、`dsh.test.getIndex` 均走 `resolveWorkspaceIndex()` |
| `openHistory` 文案 | ✅ | 无 Host 时提示需先连接；源码无 “History list is visible” |
| 回归测试 | ✅ | AC-63 用例：冷索引可 list / getIndex / TreeView；open 文案断言通过 |

## 独立验证

| 命令 | 结果 |
|------|------|
| `vitest run …/phase2-multitab-history-replay.spec.ts -t "AC-63"` | exit 0；1 passed / 7 skipped |
| `bash …/test-scripts/run-phase2-l2-l3.sh` | exit 0；3 files / 27 tests passed |
| `vitest run apps/vscode-dsh/tests` | exit 0；18 files / 67 tests passed |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-19 | 非活动新消息 → 未读点；不抢焦点 | `conversation-controller.ts`；`conversation-tab-bar.ts` | ✅ | 非活动设 unread，不 switchTo；L2 覆盖 |
| AC-57 | 激活后清未读 | `conversation-registry.ts` `switchTo` | ✅ | 目标 unread=false |
| AC-20 | 非活动审批 → 角标 | `interaction-coordinator.ts` | ✅ | 按 session 刷角标 |
| AC-58 | 串行 + 软优先 + 切 Tab demote | `interaction-coordinator.ts` | ✅ | 单飞 / 插队 / demote；L2 覆盖 |
| AC-22 | Tab 标题 | `promptTab` + `tabBarLabel` | ✅ | 首条用户消息写 title |
| AC-28 | 历史 title/mtime/capability；打开先回放 | `extension-index.ts` / `openFromHistory` | ✅ | 字段齐全；mode=replay |
| AC-29 | 非本工作区不出现 | ExtensionIndex workspace 作用域 | ✅ | Memento 按工作区 |
| **AC-63** | **列表可独立于 Host** | **`resolveWorkspaceIndex` + 历史接线** | ✅ | **冷读 workspaceState；无 Host 仍可列；打开仍要 Host** |
| AC-30 | ReplayHydrator；新 tabId；同 session 单开 | `replay-hydrator.ts` / `openFromHistory` | ✅ | hydrate + replace |
| AC-64/65 | 已有 Tab 再开 → 激活不叠 | `openFromHistory` | ✅ | 同 tabId |
| AC-31 | 回放禁 prompt；reject-send replay | `chat-panel-host.ts` | ✅ | FakeWebview L3 |
| AC-47 | 与 Timeline oracle 比对 | foldMessages / foldTimeline | ✅ | DEBT-001 PASS |
| AC-80 | 仅 T-0a PASS 后交付 | spike-report | ✅ | 可追溯 |
| AD-CU-7 | 审批状态机 | coordinator | ✅ | 真实流转 |
| AC-16 `[Should]` | 改文件摘要 | changedFileCount hook | ✅ | L2 可测 |
| AC-56 `[Should]` | scroll/reveal 优先序 | revealTarget | ✅ | user→assistant→none |
| AC-62 | 历史删除入口可发现 | package.json → dsh.deleteHistory | ✅ | 产品命令菜单 |
| AC-54/84 | L2+L3；VP-2-* | run-phase2-l2-l3.sh | ✅ | 27/27 |

## 桩代码检测

### 已注册桩
| Registry ID | 状态 | 说明 |
|-------------|:--:|------|
| GAP-001 | ⚠️ Known | 目标 phase-3 |
| DEBT-001 / DEBT-002 | ✅ Closed | 用例仍 PASS |

### 新发现的未注册桩
无。

## 关键发现

### 🔴 Must-Fix
- 无（AC-63 冷索引断裂已修复并回归通过）

### 🟡 Should-Fix
- 无阻塞。可选：补 `stopSession`/`unbind` 后再 listHistory 的 L2（与从未 start 代码路径等价）。

### 🟢 Observations
- `clearLocal()` 不清 workspaceState，unbind 后冷读可恢复已持久化 sessions。
- 删除历史仍需 Host；AC-63 仅要求列表独立。
- 不注入 events 的 bridge 冷读串联 L2 仍为可选，非本轮 Must-Fix。
