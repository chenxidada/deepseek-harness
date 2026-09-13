# Correctness Review — phase-2-multitab-history-replay

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 复审焦点（MUST-FIX loop 1 / AC-63）

| 项 | 结果 | 证据 |
|----|:--:|------|
| `resolveWorkspaceIndex` 冷读 | ✅ | `extension.ts:784-787`：`conversations` 未绑定时 `new ExtensionIndex(workspaceKey, workspaceState)` |
| TreeView / `listHistory` / `getIndex` 无 Host | ✅ | TreeView `getRows`、`dsh.test.listHistory`、`dsh.test.getIndex` 均调用 `resolveWorkspaceIndex()` |
| `openHistory` 文案 | ✅ | 无 Host 时 `showErrorMessage(...not connected...Connect Host...)`；源码无 “History list is visible” |
| 回归测试 | ✅ | `phase2-…spec.ts` AC-63 用例：冷索引 `hist-cold-1` 可 list / getIndex / TreeView；open 文案断言通过 |

## 独立验证

| 命令 | 结果 |
|------|------|
| `vitest run …/phase2-multitab-history-replay.spec.ts -t "AC-63"` | exit 0；1 passed / 7 skipped |
| `bash …/test-scripts/run-phase2-l2-l3.sh` | exit 0；3 files / 27 tests passed |
| `vitest run apps/vscode-dsh/tests` | exit 0；18 files / 67 tests passed |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-19 | 非活动新消息 → 未读点；不抢焦点 | `conversation-controller.ts` inject/project；`conversation-tab-bar.ts` | ✅ | 非活动设 `unread=true`，不 `switchTo`；L2 覆盖 |
| AC-57 | 激活后清未读 | `conversation-registry.ts` `switchTo` | ✅ | 目标 `unread=false`；用例断言 |
| AC-20 | 非活动审批 → 角标 | `interaction-coordinator.ts` badge sync | ✅ | pending/presented 按 session 刷角标 |
| AC-58 | 串行 + 软优先 + 切 Tab demote | `interaction-coordinator.ts` enqueue/pump/onActiveSessionChange | ✅ | 单飞 presented；插队不打断；demote 不 settle；L2 覆盖 |
| AC-22 | Tab 标题 title / 首条用户消息 | `promptTab` + `tabBarLabel` | ✅ | 首条用户消息写 title |
| AC-28 | 历史 title/mtime/capability；打开先回放 | `extension-index.ts` / `openFromHistory` | ✅ | 列表字段齐全；打开 `mode=replay` |
| AC-29 | 非本工作区不出现 | `ExtensionIndex` workspace Memento | ✅ | 索引按 workspace 作用域 |
| **AC-63** | **列表可独立于 Host** | **`resolveWorkspaceIndex` + history wiring** | ✅ | **冷读 workspaceState；无 Host 仍可列索引；打开仍要求 Host（设计一致）** |
| AC-30 | 历史打开 → ReplayHydrator；新 tabId；同 session 单开 | `replay-hydrator.ts` / `openFromHistory` | ✅ | hydrate + replace；关后再开新 tabId |
| AC-64/65 | 已有 Tab 再开 → 激活不叠 | `openFromHistory` early activate | ✅ | 同 tabId；list length 1 |
| AC-31 | 回放禁 prompt；`ui/reject-send` replay | `chat-panel-host.ts` `sendPrompt` | ✅ | FakeWebview L3 |
| AC-47 | 条数/顺序/角色与 Timeline oracle | `foldMessages` / `foldTimeline` | ✅ | DEBT-001 用例 PASS |
| AC-80 | 仅 T-0a PASS 后交付回放 | spike-report Gate PASS | ✅ | 可追溯 |
| AD-CU-7 | pending→presented→resolved\|abort；切 Tab demote | coordinator 状态机 | ✅ | 真实流转 |
| AC-16 `[Should]` | 改文件摘要 | `changedFileCount` hook | ✅ | L2 hook 可测 |
| AC-56 `[Should]` | scroll/reveal 优先序 | `revealTarget` + Host 接线 | ✅ | user→assistant→none |
| AC-62 | 历史删除入口可发现 | `package.json` → `dsh.deleteHistory` | ✅ | 菜单挂产品命令；`markDeleted` 覆盖 |
| AC-54/84 | L2+L3；VP-2-* | run-phase2-l2-l3.sh | ✅ | 27/27 exit 0 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-001 | ide-bridge `session/resume` | ⚠️ Known | 目标 phase-3；本 Phase 未实现（正确） |
| DEBT-001 | ReplayHydrator Timeline oracle | ✅ Closed | 用例仍 PASS |
| DEBT-002 | 双 running 切 Tab status | ✅ Closed | 用例仍 PASS |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | AC-63 修复路径为真实冷读逻辑，非空壳 |

## 关键发现

### 🔴 Must-Fix
- 无（上一轮 connectivity MUST-FIX 的 AC-63 冷索引断裂已修复并回归通过）

### 🟡 Should-Fix
- 无阻塞项。可选：补一条 `stopSession`/`unbind` 后再 `listHistory` 的 L2（与「从未 start」同属 `conversations === undefined`，当前代码路径等价，仅测试覆盖面可加强）。

### 🟢 Observations
- `clearLocal()` 不清 `ExtensionIndex` / workspaceState，unbind 后冷读可恢复已持久化 sessions。
- `dsh.deleteHistory` 仍需 Host/controller（`host-not-ready`）；AC-63 仅要求列表独立，打开/删除回放仍可要求 Host。
- 打开回放不注入 `events` 的 bridge 冷读串联 L2 仍为可选（implementation 已记，非本轮 Must-Fix）。
