# 代码库探索报告 — phase-2-auto-ready-surface

## 1. Task Context

`vscode-dsh-chat-ready` Phase 2 要在 **Conversation 视图可见** 且 **Host 就绪** 时自动就绪：有非空 `openTabSet` 则 restore（回放、活动优先、不自动 Continue、不打未读）；否则自动 New → live；空 Tab 不入持久化 `openTabSet`；无工作区跳过 restore 直接 New；重复自动就绪经 `newConversationOrReuseEmpty` **仅复用活动空 Tab**。关闭继承债 **STUB-001**（LatchSeam → AutoReadyCoordinator）与 **DEBT-001**（从 Start 成功路径拆掉 restore/New），有余力再补 **DEBT-002**；补齐 AC-3/4/4a/4b/6/7 的 L2 证据，并保持 AC-1a 反向仍绿。

## 2. Repository Overview

| 项 | 现状 |
|----|------|
| 包 | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| 语言 | TypeScript ESM；duck-typed `vscode` 供 Node L1/L2 |
| 入口 | `src/extension.ts`（`activate` / `deactivate`） |
| 自动建连（已完成） | `src/auto-start-orchestrator.ts` + `extension.ts` 内 `StartHostPort` |
| 自动就绪（桩） | `src/connection-ui.ts` → 仅 `AutoReadyLatchSeam`；**无** `auto-ready-coordinator.ts` |
| 会话 UI | `conversation-controller` + registry / message-store / extension-index |
| 可见性 | `chat-panel-provider` → `onDidChangeVisibility` → `handleConversationVisibility` |
| 测试 | Vitest `apps/vscode-dsh/tests/` |
| 前序 Phase | `phase-1-auto-start-orchestrator` HG-3 已通过；偏差记为 DEBT-001/002 + STUB-001 |

本环境无 `code2prompt`，地图由定向 Grep/Read 构建（👁）。

## 3. Most Relevant Areas

| 路径 | 与 Phase 2 的关系 | 来源 |
|------|-------------------|------|
| `apps/vscode-dsh/src/connection-ui.ts`（`AutoReadyLatchSeam` ~L199–226） | **STUB-001**：只改 latch；`@STUB(phase-2)` | 👁 |
| `apps/vscode-dsh/src/extension.ts`（`createStartHostPort` ~L1193–1198） | **DEBT-001**：Start 成功仍 restore + 空则 New | 👁 |
| `apps/vscode-dsh/src/extension.ts`（`handleConversationVisibility` ~L1219–1226） | 可见 → latch + `request('conversation-view-visible')`；尚无就绪 apply | 👁 |
| `apps/vscode-dsh/src/extension.ts`（`onActivityBarOpened` ~L1232–1237） | **DEBT-002**：逻辑已有；仅 L2 `openActivityBar` 调用 | 👁 |
| `apps/vscode-dsh/src/extension.ts`（orchestrator `onChange` ~L230–233） | `started` → `onHostReadyChanged(true)` | 👁 |
| `apps/vscode-dsh/src/extension.ts`（`dsh.newConversation` ~L291–301） | 始终 `newConversation`，无复用 | 👁 |
| `apps/vscode-dsh/src/extension.ts`（`fireConversationVisibility` ~L772–781） | 已走生产可见入口（符合 AD-CR-10） | 👁 |
| `apps/vscode-dsh/src/extension.ts`（`resolveStartCwd` ~L1103–1113） | AD-CR-5 cwd 降级已存在 | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | New / restore / persist / prompt 入队落盘 | 👁 |
| `apps/vscode-dsh/src/message-store.ts`（`hasContent`） | 空 Tab 判定 | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | unread 标志 | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 可见性订阅 | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `sendPrompt` L2/composer | 👁 |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | Start FSM；AutoReady 不得重入 Start | 👁 |
| `apps/vscode-dsh/src/index.ts` | 需导出 coordinator / 复用 API | 👁 |
| `apps/vscode-dsh/README.md` | 仍写 restore-on-start | 👁 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | AC-1a 反向须保持 | 👁 |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | restore / 空剥离基线 | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | 未读 / 空 openTabSet 基线 | 👁 |
| `design.md` AD-CR-3/5/6/10 | 目标算法 + `triggerAutoReady` | 👁 |
| `tech-debt-registry.md` | STUB-001 / DEBT-001 / DEBT-002 | 👁 |

**今日缺失（本 Phase 新建）：**

- `auto-ready-coordinator.ts`
- `ConversationController.newConversationOrReuseEmpty`
- `dsh.test.triggerAutoReady`
- 可选：`restoreOpenTabSet` 未读抑制参数或事后 `suppressUnreadForAutoReady`

## 4. Key Entry Points / Call Paths

### Path A — 今日：Start 仍拥有 restore/New（DEBT-001）✅ CONFIRMED

```
orchestrator.request(reason)
  → StartHostPort.start
       → IdeSessionHost.start(...)
       → bindConversations(...)
       → restoreOpenTabSet()          ← Phase 2 删除
       → empty → newConversation()    ← Phase 2 删除
       → pushFullState()
  → state = started → onHostReadyChanged(true)  ← 桩：只改字段
```

**关闭 DEBT-001：** 在 `bindConversations` 之后删除 restore/New。Start 只负责建 Host、绑定 controller、推状态。可聊面改由 AutoReady 在 `visible && hostReady` 时创建。隐藏 Conversation 时的 Start（如 command-send）必须留下 **0 Tab**（AC-1a）。

### Path B — 目标 L2 主路径（AC-7）

```
Conversation 可见
  → onDidChangeVisibility / 初始 visible
  → handleConversationVisibility(true)
       ├─ AutoReadyCoordinator.onVisibilityChanged(true) → maybeApplyReady
       └─ request('conversation-view-visible') → Start（无 restore/New）
            → started → onHostReadyChanged(true) → maybeApplyReady
                 → 有工作区索引：restore（无 Continue）/ 空则 New
                 → 无工作区：直接 New
                 → suppressUnread；AC-6 走 ensureReadySurface / reuse
```

**AC-1a 仍绿：** `simulateStartupOnly` — 无可见、无 request、Start spy=0、tabs/openTabSet=0。不要在 `activate` 里 apply。

| 钩子 | 状态 | 用途 |
|------|------|------|
| `fireConversationVisibility` | ✅ 已有 | 生产可见入口 |
| `triggerAutoReady` | ❌ 缺失 | 可见+就绪下强制编排 |
| `sendPrompt` / `getIndex` | ✅ | AC-4 / AC-4a |
| `openActivityBar` | ✅ | AC-1b L2；生产缺口见 DEBT-002 |

### Path C — LatchSeam → AutoReadyCoordinator（STUB-001）

```
今日：只更新 visible/hostReady/epoch；不 apply
目标：两入口共用 maybeApplyReady / ensureReadySurface；
      extension 替换实例；fireVisibility 仍走同一 onVisibilityChanged
```

### Path D — 空 Tab → 首条入队后持久化（AC-4a + HG-2）✅ CONFIRMED

```
New → persistOpenTabs 跳过 !hasContent → 不入 openTabSet
首条成功 promptTab/sendPrompt → append + persistOpenTabs → 写入 openTabSet
重启 restore 不会恢复「从未入队」的空会话
```

代码空判定 = `!hasContent`；产品 D-23 = 从未成功入队 prompt。自动 New 场景在首条成功入队前二者等价。

### Path E — 仅活动空 Tab 复用（AD-CR-6）— 缺口

```
今日：只有 newConversation；无 newConversationOrReuseEmpty；无全局 findEmptyLive（好）
目标：活动为空 → 聚焦复用；活动有内容/无活动 → 新建（禁止全局偷换）
```

## 5. Likely Impact Surface

| 区域 | 改动 | 风险 |
|------|------|------|
| `createStartHostPort.start` | 拆除 restore/New | **高** — 须与 AutoReady 同 PR |
| 新建 `auto-ready-coordinator.ts` | latch + apply | **高** — 可见/就绪时序 |
| `connection-ui.ts` | 移除或转发旧 Seam | 中 |
| `conversation-controller.ts` | 复用 API；未读抑制 | 中 |
| `dsh.newConversation` | 改走 reuse | 低 |
| 测试钩子 / 新 L2 | `triggerAutoReady` + AC-3…7 | 中 |
| 前序 restore/未读测试 | AC-27 回归 | 中 |
| DEBT-002 | 文档等价或轻量接线 | 低–中 |

## 6. Existing Constraints / Conventions

- **AD-CR-3：** 就绪与 Start 解耦；仅 `visible && hostReady`；隐藏抬 epoch、清 readyApplied。
- **AD-CR-5：** 无 folder 仍 Start（cwd 已降级）；就绪跳过 restore。
- **AD-CR-6：** 仅活动空 Tab 复用。
- **AD-CR-10：** L2 可见性必须经 `handleConversationVisibility`；禁止测钩直接改 latch。
- **AD-CU-3/4：** 空 Tab 不入持久化；立即写 workspaceState。
- **Restore：** 恒 `replay`；今日 Body 不自动 Continue；活动强制进 UI 集。
- **Unread：** 非活动 assistant 投影才打点；restore 用 `replace`，默认 unread=false。
- **AD-CR-11：** 不改 `packages/core/agent-loop`。

## 7. Risks / Unknowns

| ID | 项 | 确认度 |
|----|-----|--------|
| R1 | 拆 Start restore 而不接 AutoReady → 已连但 0 Tab | ✅ CONFIRMED |
| R2 | LatchSeam 为 STUB-001 流程骨架 | ✅ CONFIRMED |
| R3 | 无 `newConversationOrReuseEmpty`，New 会叠 Tab | ✅ CONFIRMED |
| R4 | 可见与 hostReady 先后不定 → 两入口须共用 maybeApplyReady | ✅ CONFIRMED |
| R5 | `pendingRestoreLatch` 在 connected 时仍可能自动 restore，与 AutoReady 竞态 | ✅ CONFIRMED |
| R6 | 设计仍要显式 suppressUnread（防御性） | ⚠️ HYPOTHESIS |
| R7 | `hasContent` vs D-23「成功入队」在失败投影边角 | ❓ UNKNOWN |
| R8 | 生产活动栏打开 API（DEBT-002） | ❓ UNKNOWN |
| R9 | readyApplied 后用户关光 Tab → ensureReadySurface 须再 New 且不叠空 | ⚠️ HYPOTHESIS |
| R10 | `hasWorkspaceIndex()` 精确谓词 | ⚠️ HYPOTHESIS |

## 8. Uncertain / Unverified

- `hasWorkspaceIndex()` 用 `workspaceFolders`、空 `workspaceKey` 还是「视为空 openTabSet」——须与 AC-4b 一致。
- `markUnread` / `autoContinue` 参数今日不存在；Continue 本未自动调用；可能只需事后清 unread。
- `host.prompt` 失败是否留下用户气泡导致误持久化。
- 真实 VS Code 下 `retainContextWhenHidden` + `onDidChangeVisibility` 未在此再实测。
- 仅点开活动栏、Conversation 非首视图时，生产是否完全依赖 reveal 后的可见事件。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| STUB-001 | `AutoReadyLatchSeam.onVisibilityChanged` / `onHostReadyChanged` | 只更新 latch | ✅ 字段+epoch；无 restore/New；有 `@STUB` | ✅ 匹配 |
| DEBT-001 | `createStartHostPort.start` | Start 仍 restore+New | ✅ ~L1194–1198 仍在 | ✅ 匹配 |
| DEBT-002 | `onActivityBarOpened` | 生产缺独立信号 | ✅ 仅测试钩调用 | ✅ 匹配 |
| DEBT-003 | Continue 旁路 | phase-4 | 本 Phase 不深验 | — |
| — | `newConversationOrReuseEmpty` | 未注册 | **不存在**（预期交付物） | ✅ 预期缺口 |
| — | `auto-ready-coordinator.ts` | 未注册 | **不存在** | ✅ 预期缺口 |

### Stub Detection Summary

- ✅ Confirmed stubs: **1**（STUB-001）
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**

### 债务关闭建议

1. **DEBT-001（Must）：** 与 AutoReady apply **同变更**拆除 Start 上的 restore/New。
2. **STUB-001（Must）：** 新建 coordinator；接线可见性 + hostReady；加 `triggerAutoReady`。
3. **DEBT-002（余力）：** (a) README 声明 Conversation 可见为生产等价；或 (b) 任一 `dsh.*` 视图 resolve 时调用一次 `onActivityBarOpened`。不阻塞 Must AC。

## 10. Recommended Next Reads

1. ⭐ MUST READ — `extension.ts`（Start 端口、可见性、活动栏、测试钩）
2. ⭐ MUST READ — `connection-ui.ts`（`AutoReadyLatchSeam`）
3. ⭐ MUST READ — `conversation-controller.ts`（New / restore / persist / prompt）
4. ⭐ MUST READ — `design.md` AD-CR-3/5/6 + AutoReady 伪代码
5. ⭐ MUST READ — 本 Phase `spec.md`（含 HG-2 空 Tab 持久化备注）
6. 🔷 SHOULD READ — `chat-panel-provider.ts` 可见性
7. 🔷 SHOULD READ — `phase1-auto-start.spec.ts` AC-1a
8. 🔷 SHOULD READ — `message-store.ts` / `restore-planner.ts`
9. 🔷 SHOULD READ — `tech-debt-registry.md`
10. 🔹 OPTIONAL — phase-1 implementation 偏差；restore 基线测试；README

---

### 实施速查

**关 DEBT-001：** Start 成功只 `bindConversations` + `pushFullState`，删除 restore/New。

**关 STUB-001：** `maybeApplyReady` 门闩 `visible && hostReady`；工作区 restore / 无工作区 New；一律 `newConversationOrReuseEmpty`；suppressUnread；永不 auto Continue。

**AD-CR-6：** 落地 `newConversationOrReuseEmpty`；自动就绪与 `dsh.newConversation` 共用。

**L2 AC-7：** `fireVisibility(true)` → 断言 live|restore；并复跑 AC-1a `simulateStartupOnly`。
