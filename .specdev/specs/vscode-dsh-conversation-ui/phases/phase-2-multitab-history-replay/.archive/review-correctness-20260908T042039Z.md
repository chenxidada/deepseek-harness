# Correctness Review — phase-2-multitab-history-replay

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 独立验证

| 命令 | 结果 |
|------|------|
| `bash …/test-scripts/run-phase2-l2-l3.sh` | exit 0；3 files / 26 tests passed |
| `vitest run apps/vscode-dsh/tests` | exit 0；18 files / 66 tests passed |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-19 | 非活动新消息 → 未读点；不抢焦点 | `conversation-controller.ts` `projectAssistantMessage` / `injectAssistantMessage`；`conversation-tab-bar.ts` `tabBarLabel` | ✅ | 非活动 append 设 `unread=true`，不 `switchTo`；Tab 标签加 `●`；L2 用例覆盖 |
| AC-57 | 激活后清未读 | `conversation-registry.ts` `switchTo` | ✅ | `switchTo` 将目标 `unread=false`；phase2 用例断言 activate 后清除 |
| AC-20 | 非活动审批 → 角标；会话关联 | `interaction-coordinator.ts` `syncApprovalBadges` / `hasPendingForSession`；`setApprovalBadge` | ✅ | pending/presented 按 sessionId 刷角标；队列用例断言 badge |
| AC-58 | 串行单弹层 + 软优先 + 切 Tab demote | `interaction-coordinator.ts` `enqueue` / `pump` / `onActiveSessionChange` / `presentEntry` | ✅ | 全局 `presentedId` 单飞；活动 pending 插队且跳过 `presented`；未作答 demote `presented→pending` 不 settle；队头 fail 出队；L2 覆盖 |
| AC-22 | Tab 标题 title / 首条用户消息 | `conversation-controller.ts` `promptTab` + `titleFromFirstMessage`；`tabBarLabel` | ✅ | 首条用户消息写 title；标签用 `tab.title` |
| AC-28 | 工作区历史 title/mtime/capability；打开先回放 | `extension-index.ts` `listHistorySessions` / `continueCapabilityListHint`；`openFromHistory` | ✅ | 列表字段齐全；unknown 无「可继续」；打开 `mode='replay'` |
| AC-29 | 非本工作区不出现 | `ExtensionIndex` workspaceState 作用域 | ✅ | 索引按 workspace Memento；列表仅本地 snapshot sessions |
| AC-63 | 列表可独立于 Host | `history-view.ts` `listHistoryFromIndex` / `createHistoryView` | ✅ | `getRows()` 只读 index，无 Host 依赖 |
| AC-30 | 历史打开 → ReplayHydrator；新 tabId；同 session 单开 | `replay-hydrator.ts`；`openFromHistory`；`registry.create(..., 'replay')` | ✅ | hydrate → `messages.replace` + `timeline.replace`；关后再开新 tabId；VP-2-history |
| AC-64/65 | 已有 Tab 再开 → 激活不叠副本 | `openFromHistory` early `getBySessionId` → `activated` | ✅ | 用例断言 `activated` + 同 tabId + list length 1 |
| AC-31 | 回放禁 prompt；`ui/reject-send` replay | `chat-panel-host.ts` `sendPrompt` | ✅ | `mode === 'replay'` → `reject('replay')`；FakeWebview L3 |
| AC-47 | 条数/顺序/角色与 Timeline 可对权威日志 | `foldMessages` / `foldTimeline` / DEBT-001 用例 | ✅ | oracle 断言 messages + turn/step/tool 序列；`surfaceOp:replace` |
| AC-80 | 仅 T-0a PASS 后交付回放 | `phase-0a-…/spike-report.md` Gate **PASS** | ✅ | 静态可追溯；产品 hydrator 已落地 |
| AD-CU-7 状态机 | pending→presented→resolved\|abort；切 Tab demote | `InteractionPresentationState` + demote/settle 路径 | ✅ | 状态字段真实流转；demote 不 settle bridge |
| AC-16 `[Should]` | 改文件摘要链 Timeline/Diff | `changedFileCount` + `dsh.test.changedFileCount` | ✅ | Host 钩子可测写 diff 数；面板文案未做（spec 允许 hook） |
| AC-56 `[Should]` | scroll/reveal 定位优先序 | `revealTarget`；`ChatPanelHost` `scroll/reveal`；`resolveReveal` 接线 | ✅ | user→assistant→none 实逻辑；Host 已接线（phase2 套件无专用 L3 断言，见 Observations） |
| AC-62 | 历史行删除入口可发现 | `package.json` menu + `dsh.test.deleteHistory` → `deleteSession`/`markDeleted` | ✅ | 菜单 `viewItem == dshHistorySession`；命令已注册；`markDeleted` 列表用例覆盖 |
| AC-54/84 | L2+L3 模拟 Webview；VP-2-* | `run-phase2-l2-l3.sh` + phase2 spec | ✅ | 关 Tab→回放、审批唤醒、回放误发均有用例；脚本 exit 0 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-001 | ide-bridge `session/resume` 等 | ⚠️ Known | 仍活跃、目标 phase-3；**未误报**；本 Phase 无 resume 实现（正确） |
| DEBT-001 | ReplayHydrator Timeline oracle | ✅ Closed | `foldTimeline` + `oldText:null` + `timeline.replace`；DEBT-001 用例 PASS |
| DEBT-002 | 双 running 切 Tab status | ✅ Closed | `pushStatus` 仅活动 `sessionId`；DEBT-002 用例 PASS |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | 关键路径均有真实逻辑；未新建 `interaction-queue.ts` |

## 关键发现

### 🔴 Must-Fix
- 无

### 🟡 Should-Fix
- 无阻塞项。可选：为 AC-56 增一条 FakeWebview `scroll/reveal` 优先序断言（代码已通，phase2 套件仅间接覆盖）。

### 🟢 Observations
- AC-16 产品面板未渲染「本回合改了 N 个文件」文案；以 L2 hook `changedFileCount` 满足 Should「可测或 hook」。
- AC-58 切 Tab 用例通过再次 `onActiveSessionChange(active)` 触发 demote（presented 属 inactive）；产品路径 `switchConversation` 同样调用该 API，逻辑等价。
- Host 未连 `openFromHistory` → `host-not-ready`（implementation 偏差记录；对齐 phase-3 AC-69），符合本 Phase 排除项。
- GAP-001 Continue/`session/resume` 未实现 — 按 registry 正确推迟，非新缺陷。
