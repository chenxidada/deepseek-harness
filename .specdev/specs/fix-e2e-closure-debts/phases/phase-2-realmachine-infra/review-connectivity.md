# Connectivity Review — Phase 2（DEBT-14 增量修复）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: `cap-selection-ask` 时序修复链路（DEBT-14 核心）

```
Entry: dsh.test.askAboutSelection  (extension.ts:1028)
  → runAskAboutSelection(vscode)                         ✅ 复用既有选择询问路径
    → revealConversationPanel → editorChatPanel.openOrFocus
      → deps.onVisibilityChanged(true)  [同步调用, editor-chat-panel.ts:200/228]
        → handleConversationVisibility(true)             ✅ 链到 autoReady
          → autoReady.onVisibilityChanged(true)
            → void maybeApplyReady()  [fire-and-forget, applyInFlight 同步置位]
              → applyBody → restoreOpenTabSet
                → 关闭所有 live Tab + 重开 replay Tab    ✅ restore 已在途
    → askAboutSelection({ ensureLiveTab: mint live Tab })  ✅ 同步 mint live
  → await autoReady?.triggerAutoReady()                  ✅ 结算 in-flight restore
    → maybeApplyReady() → await applyInFlight            ✅ 单飞等待 restore 完成
  → controller.registry.getActive()                      ✅ restore 后 active = replay
  → active.mode !== 'live' → newConversation(EMPTY_LIVE_TITLE)  ✅ mint 新 live + active
  → panelHost.pushFullState()                            ✅ webview 看到 live
Exit: active Tab = live 会话
  → dsh.test.sendPrompt → registry.getActive() = live ✅ 不 reject('replay')
  → panelSnapshot() → getActive() = live 会话          ✅ 读到同一 live 会话
```

**判定**: ✅ 数据路径完整，起点到终点连通。`triggerAutoReady()` 真实结算 restore；`newConversation` 重建 live Tab 后，`sendPrompt` 与 `panelSnapshot` 都经 `registry.getActive()` 命中同一 live 会话。

### Path 2: `triggerAutoReady()` 结算机制（非空壳验证）

```
triggerAutoReady(options)  [auto-ready-coordinator.ts:84]
  → maybeApplyReady(options)  [:96]
    ├─ applyInFlight 非空 → await applyInFlight → re-check 门控 → 返回 in-flight ✅ 等待在途 restore
    └─ 无在途 → applyBody → restoreOpenTabSet / ensureReadySurface ✅ 真实 apply
```

**判定**: ✅ 非空壳。`applyInFlight` 单飞机制保证 `triggerAutoReady()` 能 `await` 到由 `onVisibilityChanged(true)` 触发的在途 `restoreOpenTabSet`，完成结算。

### Path 3: `openOrFocus` → `onVisibilityChanged(true)` 同步性（竞态根因闭合）

```
openOrFocus  [editor-chat-panel.ts:190]
  ├─ panel 已存在 → panel.reveal() → deps.onVisibilityChanged(true) [同步, :200]
  └─ panel 首次创建 → createWebviewPanel → deps.onVisibilityChanged(true) [同步, :228]
```

**判定**: ✅ 两分支均**同步**触发 `onVisibilityChanged(true)`，`revealConversationPanel` `await openOrFocus` 返回时 `applyInFlight` 已置位，`triggerAutoReady()` 必然能等到在途 restore，不存在「visibility 事件晚于 hook 返回」的竞态窗口。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `autoReady.triggerAutoReady()` | `dsh.test.askAboutSelection` (extension.ts:1030) | ✅ | `maybeApplyReady` → `applyBody` → `restoreOpenTabSet` | ✅ |
| `controller.newConversation(EMPTY_LIVE_TITLE)` | `dsh.test.askAboutSelection` (extension.ts:1035) | ✅ | `registry.create(title)`（mint + active） | ✅ |
| `registry.getActive()` | 修复 re-check (extension.ts:1033) + `sendPrompt` + `panelSnapshot` | ✅ | `ConversationRegistry.getActive`（返回 active 副本） | ✅ |
| `panelHost.pushFullState()` | 修复 (extension.ts:1036) | ✅ | host→webview 全量状态推送 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| test hook → autoReady | `triggerAutoReady(): Promise<ApplyResult>` 结算 in-flight restore | `async triggerAutoReady(options?): Promise<AutoReadyApplyResult>`（:84） | ✅ |
| autoReady → controller | `restoreOpenTabSet` 关闭 live + 重开 replay | `restoreOpenTabSetBody` :580-583 关 live、:596 开 replay、:623 switchTo | ✅ |
| test hook → controller | `newConversation(title)` mint 新 live 且 active | `newConversation` :347 → `registry.create(title)` :88 置 active、mode 默认 'live' | ✅ |
| test hook → registry | `getActive()` 返回 `{mode, sessionId}` | `getActive()` :140 返回 Tab 副本（含 mode） | ✅ |
| sendPrompt → registry | active 为 live 时放行、replay 时 reject | `sendPrompt` :707 getActive + :715 reject('replay') | ✅ |
| panelSnapshot → registry | 读 active 会话 mode/messages | `panelSnapshot` :1712 getActive + `resolvePanelProjection` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `AutoReadyCoordinator.triggerAutoReady()` | 产品既有（非本工作流新增） | 已实现，签名未变 | ✅ |
| `ConversationRegistry.create/getActive` | 产品既有 | 已实现，签名未变 | ✅ |
| `ConversationController.newConversation` | 产品既有 | 已实现，签名未变 | ✅ |
| `restoreOpenTabSet`（DEBT 时序根因所在） | 产品既有 | 行为未改（本批只改 test hook） | ✅ |
| `dsh.test.resetToIdle`/`resetForTest`（DEBT-12） | 本 Phase 批次 3 | 已实现 | ✅ 无冲突（见下） |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **[时序安全性]** 修复的 `newConversation` 分支由 `active === undefined || active.mode !== 'live'` 精确门控：若 `triggerAutoReady()` 因 `visible=false`/`hostReady=false` 返回 `gated`（restore 未跑，`ensureLiveTab` mint 的 live Tab 仍存活），则 active 仍是 live → 不重建，`sendPrompt` 仍命中该 live Tab。两条分支均不产生断裂，属稳健设计而非缺陷。
- **[与 DEBT-12 复位链的隔离]** 修复完全落在 `dsh.test.askAboutSelection`（一个 capability 步骤内），`triggerAutoReady()` 被 `await`，restore 结算在 hook 返回前完成；DEBT-12 的 `resetToIdle`/`resetForTest` 在 capability 结束后才运行，且 `resetForTest` 只关 pinned subagent 子 Tab、不清普通 live Tab，与新建 live Tab 无竞争、无互相作废。
- **[边界正确]** 修复落在验证基建（test hook），不改 `runAskAboutSelection`/`auto-ready-coordinator`/`conversation-controller` 的产品语义，`dsh.askAboutSelection` 命令仍走原逻辑（:842-844）。
