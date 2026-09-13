# 设计一致性审查 — phase-3-restart-continue（PARTIAL 回炉复审）

## 视角
**设计一致性** — 代码是否遵循架构设计

## 判决
**PASS**

## 回炉对照（DEBT-003..006 × AD-CU-1/4/10）

| 债项 | 设计锚点 | 修复是否仍符合设计 | 证据 | 判定 |
|:---|:---|:---|------|:--:|
| **DEBT-003** | **AD-CU-10** 索引永久保留；**AD-CU-4** 每次变更立即写 | 是 | `persistOpenTabs`：registry（有内容）∪ `deferredRestore`（按 `sessionId` 去重）；restore 批内 `openTabPersistSuspended`，批末解除后立刻 `persistOpenTabs()` → `index.setOpenTabs`；二次冷启动可读全量 index（含未 hydrate 行） | ✅ |
| **DEBT-004** | **AD-CU-1** Webview 极薄、跟 `panel/state` | 是 | `buildThinChatHtml`：`syncChrome(msg)` 读 `continue.visibility` / `tooltip` 与 `deferredRestoreCount`；Continue /「查看更多」仅 `postMessage({ type: 'action/continue' \| 'action/restore-more' })`，无本地 mode/session 权威 | ✅ |
| **DEBT-005** | AC-69 / 恢复状态机（设计「等待 Host → 自动重建」） | 是 | `IdeSessionHost.onStatusChange` + setter 通知；controller 在 `connected && pendingRestoreLatch` 时自触发 `restoreOpenTabSet`；`restoreInFlight` 去重。不引入 Webview 侧决策 | ✅ |
| **DEBT-006** | **AD-CU-10** 未进 UI ≠ 丢索引；**AD-CU-3** 空剔仅真无内容 | 是 | `readSessionLog` catch → `loadFailed`；planner `hasContent` 对失败行返回 `true` 保留 `indexSet`；失败行进 `deferredRestore`，不空剔；可二次 restore。瞬时读失败 ≠ 空 Tab | ✅ |

上一轮 **SHOULD-FIX**（真 Webview 未消费 Continue / 查看更多 chrome）已由 DEBT-004 闭合。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CU-1**：极薄 Webview；跟 Host `panel/state`；无本地 mode/session 权威 | 是 | Host 下发 `continue` + `deferredRestoreCount`；HTML 仅渲染/转发动作；发送仍走 Host | ✅ |
| **AD-CU-4**：索引非正文权威；`openTabSet`/`mode`/`activeSessionId` 每次变更立即写 `workspaceState` | 是 | `ExtensionIndex.writeImmediate`；批末合并 deferred 的 `persistOpenTabs`；suspend 仅屏蔽 restore 中间态缩水写，不替代最终立即写 | ✅ |
| **AD-CU-3/10**：空 Tab 剔除；UI 限 N；活动优先；索引全保留 | 是 | `planRestoreOpenTabs` + deferred 合并持久化；loadFailed 保留 index；`restoreMoreTabs` / `action/restore-more` | ✅ |
| **AD-CU-5**：冷恢复新 `tabId`；Continue 同打开期同 `tabId` `replay→live`；恢复强制 `mode=replay` | 是（本轮未改语义） | `registry.create(..., 'replay')`；`continueConversation` → `setMode(..., 'live')` | ✅ |
| **AD-CU-6**：Diff 仅权威 `meta.diffs`；禁当前磁盘冒充 | 是（本轮未改） | 既有 `recoverableDiffsFromMeta` / `dsh-diff` | ✅ |
| **AD-CU-8**：Continue 四态；列表暗示与顶栏解耦；T-0b=`same-id` | 是 | `continueChromeFor` / `probeContinueCapability`；Webview 跟 Host chrome 四态（含 hidden） | ✅ |
| **AD-CU-12**：不改 `agent-loop`；resume 走 ide-bridge；勿扩 SDK stdout create | 是 | 回炉仅触达 `apps/vscode-dsh` controller/host/webview + 测试；无 agent-loop / stdout create 扩张 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `conversation-controller.ts` | `apps/vscode-dsh/src/` | ✅ | 持久化合并、latch、loadFailed 编排属产品 Host |
| `session-host.ts` | `apps/vscode-dsh/src/` | ✅ | `onStatusChange` 与既有 `onError`/`onNotification` 对称 |
| `chat-panel-provider.ts` | `apps/vscode-dsh/src/chat-panel/` | ✅ | 薄 HTML 消费协议 chrome，符合 AD-CU-1 |
| `phase3-restart-continue.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | DEBT 回归与既有 VP 布局一致 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 持久化合并 | `persistOpenTabs` + `deferredRestore` | camel；语义对齐 AC-70 | ✅ |
| 批写抑制 | `openTabPersistSuspended` | 表达 AD-CU-4 批原子写意图 | ✅ |
| Host 状态 | `onStatusChange` | 与 `onError` / `onNotification` 对称 | ✅ |
| Webview 动作 | `action/continue` / `action/restore-more` | 既有 protocol 命名 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块做一件事 | ✅ | planner / persist 合并 / Host 状态订阅 / 薄 Webview 分界清晰 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 回炉未改核心；扩展仍 → bridge → sdk service |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | Webview 只经协议消息；Host 状态经 `onStatusChange` |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）— 上一轮 AD-CU-1 Webview chrome Should-Fix 已闭合。

### 🟢 Observations
- **AD-CU-4 与 restore suspend**：批内抑制中间 `persistOpenTabs` 是为避免 registry 仅含已 hydrate 子集时写缩 index；批末合并 deferred 的立即写仍满足「每次（逻辑）变更立即落盘」，与「禁止仅 deactivate 快照」一致。
- **DEBT-006 与空剔**：失败读保留 index / deferred，与 AD-CU-3「空 Tab = 无消息」正交——瞬时失败不得冒充空剔。
- **derive-only / AC-67 完整换绑**：Gate 仍锁定 `same-id`；本轮未引入新偏差。
- **GAP-001 / agent-loop / SDK stdout create**：仍关闭/未改，符合 AD-CU-12。

## 详细证据索引
- DEBT-003/006：`conversation-controller.ts` `persistOpenTabs` / `restoreOpenTabSetBody`（`loadFailed`、`openTabPersistSuspended`、`deferredRestore`）
- DEBT-004：`chat-panel/chat-panel-provider.ts` `syncChrome` + Continue / 查看更多 buttons
- DEBT-005：`session-host.ts` `onStatusChange`；controller 构造订阅
- 协议：`chat-panel/protocol.ts` `panel/state.continue` / `deferredRestoreCount` / `action/*`
