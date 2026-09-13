# 代码库探索报告 — phase-2-multitab-history-replay

## 1. 任务上下文

Phase 2 交付：（1）非活动 Tab **未读点**与**审批角标**，以及 AD-CU-7 **串行软优先**交互队列（并入既有 `InteractionCoordinator`）；（2）由 `ExtensionIndex` 驱动的工作区**历史列表**（标题/mtime/`continueCapability` 映射；打开一律先回放）；（3）产品级 **`ReplayHydrator`**：一次性冷读权威日志，全量重建 MessageStore + Timeline + 面板（`messages/replace`、`mode=replay`、composer 门禁）。L2 Host 钩子与 L3 模拟 Webview 须覆盖关 Tab→历史回放、审批唤醒、回放误发拒绝。**必须优先处理 DEBT-002**（双 running status 夹具），并落地 **DEBT-001**（ReplayHydrator Timeline/oracle 夹具）。**GAP-001**（bridge `session/resume`）属 phase-3——本 Phase 勿做。

## 2. 仓库概览

| 方面 | 现状 |
|------|------|
| 语言 | TypeScript ESM（`"type": "module"`） |
| 包 | `@deepseek-ai/dsh-vscode-dsh`，位于 `apps/vscode-dsh/` |
| 框架 | VS Code Extension Host + 极薄 Conversation Webview；Cordis ide profile（SDK stdio + ide-bridge NDJSON） |
| 包管理 | 仓库根 pnpm workspace |
| 测试 | `apps/vscode-dsh/tests/` Vitest；阶段脚本在 `.specdev/specs/.../test-scripts/` |
| Spike 折叠助手 | `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts`（T-0a **PASS**） |
| 本 Phase 尚缺产品文件 | `replay-hydrator.ts`、`history-view.ts` — **不存在** |
| Bridge 读日志 | `session/read-log` **尚未**进入 `BridgeFrame`（T-0a 已选型，产品未落地） |

## 3. 最相关区域

| 路径 | 原因 | 来源 |
|------|------|:----:|
| `apps/vscode-dsh/src/interaction-coordinator.ts` | AD-CU-7：当前并发 present；须在本文件扩展串行队列 + 软优先 + 切 Tab 回 pending | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | 需补 `unread` / `approvalBadge`（激活清除）；已有 sessionId 单开 | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | live 投影、关≠dispose、索引 upsert；需 `openHistory` / hydrate / 未读扇出 | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | 会话列表 + openTabSet workspaceState；历史列表数据源（AC-28/29/63） | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushStatus` / `pushFullState` / 回放 `ui/reject-send`；DEBT-002 夹具落点 | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Host↔Webview 帧；AC-56 可能需 `scroll/reveal` | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `replace`/`append` 已可服务 hydrator 与切 Tab | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` | live `apply`；尚无 bulk replace；Diff `oldText` 与 spike 不一致 | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | Bridge 帧路由；`session/read-log` 客户端自然挂载点 | 👁 |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` | Tab 栏；尚无未读/角标（AC-19/20/22） | 👁 |
| `apps/vscode-dsh/src/extension.ts` | 命令 + L2 钩子（`dsh.test.*`）；注册历史 / 打开回放钩子 | 👁 |
| `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts` | 折叠语义 → 提升为产品 `ReplayHydrator` | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | L2/L3 harness 样板，扩展 VP-2-* | 👁 |
| `packages/ide/ide-bridge/src/types.ts` + `validate.ts` + 插件 | 增加薄 `session/read-log`（可选 `session/stat`） | 👁 |
| `packages/session-query/session-query/src/cold-read.ts` | `readColdSessionLog` — 首选折叠输入 | 👁 |
| **新建** `apps/vscode-dsh/src/replay-hydrator.ts` | 产品一次性折叠 → MessageStore + Timeline | 📊 design |
| **新建** `apps/vscode-dsh/src/history-view.ts` | 基于索引的历史 TreeView（可独立于 Host） | 📊 design |

## 4. 关键入口 / 调用路径

### 路径 A — Live 消息 / 状态（phase-1 基线；未读挂点）

```
IdeSessionHost（SDK notification）
  → ConversationController.onSdkNotification
       ├─ TimelineStore.apply(notification)
       ├─ session.status → registry.setStatus → panelHost.pushStatus()   # 仅活动 Tab
       └─ assistant/message → messages.append → panelHost.pushAppend()  # 非活动则不推面板
  → [phase-2] 若 Tab 非活动：unread=true；刷新 Tab 栏
  → [phase-2] switchConversation 且面板已展示 → 清除未读（AC-57）
```

✅ CONFIRMED：`pushAppend` / `pushStatus` 只针对**活动** Tab。非活动消息仍写入 `MessageStore`——未读可在不改权威源的前提下挂在 inactive append 上。

### 路径 B — 交互：现状 vs AD-CU-7 目标

```
ide-bridge NDJSON approval/request | user-questions/request
  → IdeSessionHost.onBridgeFrame
  → InteractionCoordinator.handleApproval / handleQuestions
       现状：pending Map + 立即 ui.present*(...)   # 无全局串行队列
       目标：入队 → 串行呈现 → 活动 Tab 软优先插队首
             切 Tab 未作答：关弹层 → presented→pending（角标保留）
             队头 fail/Abort → 出队 → 呈现下一项
  → bridge 回响应帧
  → interactions.onChange → panelHost.pushStatus（waiting-interaction）
```

✅ CONFIRMED：协调器是**按 id 的等待者**，但**不是**全局串行呈现队列——多个 `presentApproval` 可并发。规格要求在**同一文件**扩展，禁止新建 `interaction-queue.ts`。

### 路径 C — 历史打开 → ReplayHydrator（本 Phase 主路径）

```
历史列表行点击 / dsh.test.openHistory(sessionId)
  → ConversationController.openFromHistory(sessionId)   # 新建
       ├─ 若 registry.getBySessionId → switchTo（沿用 tabId）  # AC-64/65
       └─ 否则 registry.create(title, sessionId, mode='replay')  # 新 tabId
  → IdeSessionHost.readSessionLog(sessionId)            # 新建 bridge 客户端
       → BridgeFrame session/read-log
       → ide-bridge → readColdSessionLog(persistence, id)
  → ReplayHydrator.hydrate(events)
       → MessageStore.replace(sessionId, messages)
       → TimelineStore.replace/bulkApply(sessionId, rows)   # 需新 API
  → panelHost.pushFullState()  # panel/state mode=replay + messages/replace
  → composer/send → ui/reject-send reason=replay（已门禁）
```

✅ CONFIRMED：T-0a 优选 bridge → `readColdSessionLog`；spike 折叠仅在 tests。  
⚠️ HYPOTHESIS：产品可在测试中暂直连 persistence，但同 Phase 宜落地 bridge 帧（设计 + spike 一致）。

### 路径 D — 关 Tab → 历史回放（VP-2-history）

```
dsh.closeConversation / dsh.test.closeConversation
  → failClosedSession（中止该会话 pending UI）
  → registry.close（tabId 销毁；同进程内 MessageStore 可仍保留）
  → index.setOpenTabs（去掉已关 Tab；SessionIndexEntry 仍在）
  → 之后 openFromHistory → 冷读权威日志，不以内存 MessageStore 单独为准
```

✅ CONFIRMED：关闭不 dispose；同进程内存投影可能仍在，但 AC-30/47 要求与权威日志比对，必须以冷读 hydrate。

## 5. 影响面

| 区域 | 变更 | 风险 |
|------|------|:----:|
| `interaction-coordinator.ts` | 串行队列、软优先、切 Tab 回 pending、角标信号 | **高** — fail-closed / Abort 不可回退 |
| `conversation-registry.ts` + tab-bar | `unread` / `approvalBadge`；标题来自索引 | 中 |
| `conversation-controller.ts` | `openFromHistory`、未读清除、hydrate 编排 | **高** |
| `replay-hydrator.ts`（新建） | 提升 spike 折叠；映射 ChatMessage / TimelineItem | **高** |
| `history-view.ts`（新建） | 基于 `ExtensionIndex.sessions` 的 TreeView | 中 |
| `extension-index.ts` | 过滤已删/非本工作区；capability 展示辅助 | 低–中 |
| `timeline-store.ts` | Bulk replace；`oldText: null` 对齐 AD-CU-6 | 中 |
| `session-host.ts` + `ide-bridge` | `session/read-log`（可选 `session/stat`） | **高**（线协议） |
| `chat-panel-host.ts` / protocol | Should：reveal；DEBT-002 主要是测试 | 低（产品）/ 中（测试） |
| `extension.ts` L2 钩子 | `openHistory`、列索引、注入非活动消息、审批唤醒 | 中 |
| 测试 panel-l2-l3*、新 VP-2、hydrator oracle | DEBT-001/002 + AC-54/84 | 中 |

## 6. 既有约束 / 约定

- **仅投影：** 扩展不作第二套正文权威（AC-45/46）；索引只存元数据。
- **关 ≠ dispose：** `closeConversation` 禁止 `session/dispose`；仅删除路径 dispose（AD-CU-3/9）。
- **同 sessionId 单开：** `ConversationRegistry.create` 已抛错（AC-59/64/65）。
- **tabId 生命周期：** 关闭销毁；历史再开 → **新 tabId**（AD-CU-5）。
- **发送门禁在 Host：** 回放 → `ui/reject-send` `{ reason: 'replay' }` 已实现。
- **索引立即持久化：** `ExtensionIndex.writeImmediate`（AD-CU-4）。
- **空 Tab 不进**持久化 `openTabSet`。
- **禁止**新建 `interaction-queue.ts`；队列并入 `interaction-coordinator.ts`。
- **L3 = FakeWebviewPort**，不验 HTML/CSP。
- **已有 L2 钩子：** `dsh.test.sendPrompt` / `closeConversation` / `deleteConversation` / `panelSnapshot` / `getIndex` / `openPanel`。
- **Continue / resume：** GAP-001 → phase-3；列表可按 AD-CU-8 显示能力暗示，但 Continue 产品不在本 Phase。
- **T-0a PASS** 解锁回放切片（AC-80）；优先复用 `foldMessages` / `foldTimeline` / `recoverableDiffsFromMeta` 语义。

## 7. 风险 / 未知

| 项 | 确信度 |
|----|:------:|
| InteractionCoordinator **无**串行呈现队列——AD-CU-7 是重构而非小补丁 | ✅ CONFIRMED |
| `ConversationTab` / tab-bar **无** unread / approvalBadge | ✅ CONFIRMED |
| `history-view.ts` / `replay-hydrator.ts` 缺失 | ✅ CONFIRMED |
| `BridgeFrame` 无 `session/read-log` | ✅ CONFIRMED |
| TimelineStore 无回放用 bulk `replace` | ✅ CONFIRMED |
| TimelineStore 将缺失 `oldText` 强制为 `''`；spike 拒绝缺失并允许 `null`——产品须跟 spike/AD-CU-6 | ✅ CONFIRMED |
| `panel-l2-l3-protocol.spec.ts` **无**专用双 running AC-21 夹具（DEBT-002）；verifier V-IND-5 已独立证明行为 | ✅ CONFIRMED |
| `design.md` Spike Gate 仍写 “NOT RUN”，而 spike-report 为 PASS——文档漂移 | ✅ CONFIRMED |
| 生产环境 Extension Host 能否不经 bridge 直达 persistence | ⚠️ HYPOTHESIS — 设计优选 bridge 薄帧 |
| AC-16 改文件摘要 + AC-56 scroll/reveal 产品面大小 | ❓ UNKNOWN — Should；可薄钩子 + 记债 |
| Host 未连时历史打开文案 vs phase-3 AC-69 | ⚠️ HYPOTHESIS — 规格允许说明；完整自动重建等待属 phase-3 |

## 8. 未核验 / 不确定

| 符号 | 说明 |
|------|------|
| 产品 `ReplayHydrator.hydrateFromAuthoritativeLog` | 仅设计骨架；行为取决于是否忠实提升 spike 折叠 |
| ide-bridge `session/read-log` 处理 | 未实现；Extension 进程接线未验证 |
| 拟议 `TimelineStore.replace` | 不存在；须新增且不破坏 live `apply` |
| 软优先队列与并发 bridge 帧 / 关 Tab `failClosedSession` 的 Abort 所有权 | 无现成路径，需仔细设计 |
| 历史行删除入口（AC-62） | 打开 Tab 的删除已有；**历史行**删除 UX 未建 |
| `continueCapability` 写入 | 索引字段在；phase-1 无探测写入——`unknown` 不得显示「可继续」 |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-001 | `spike-t0a-replay-rebuild.spec.ts` AC-30/47 Timeline `.some`；replace / null 夹具弱 | 已知测试缺口 → phase-2 产品 hydrator oracle | Spike Gate 仍用 `.some`；完整序列 + `surfaceOp:'replace'` + `oldText:null` 在 `verifier-independent-t0a.mts`，**不在**产品 hydrator 测试（产品文件尚无） | ✅ 匹配 — 本 Phase 用产品 `ReplayHydrator` 测试消化 |
| DEBT-002 | `chat-panel-host.ts` `pushStatus` / 活动 Tab；缺专用双 running 夹具 | 测试缺口；实现正确 | `pushStatus`/`resolveStatus` 只推活动 Tab；产品 L2 套件缺双 running 切换断言；phase-1 verifier V-IND-5 存在但不算产品 L2 拥有 | ✅ 匹配 — **用户指定优先**：phase-2 补 L2/L3 |
| GAP-001 | `sdk-server` create / ide-bridge 无 `session/resume` | Continue 缝缺失 → phase-3 | `BridgeFrame` 无 `session/resume` / `session/continue-capability` | ✅ 匹配 — **本 Phase 勿做** |

### Stub Detection Summary

- ✅ 与 registry 匹配的已知债： **3**（DEBT-001、DEBT-002、GAP-001）
- ⚠️ Registry 与代码不符： **0**
- 🔴 未注册桩： **0**（范围内无空壳 `@STUB`；缺失文件为计划产出，非静默桩）

### DEBT 落点建议（给 implementer）

| ID | 优先级 | 建议落点 |
|----|:------:|----------|
| **DEBT-002** | **最先（用户指定）** | 在 `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts`（或并列 `panel-multi-tab-status.spec.ts`）增加专用用例：两 Tab `status=running`，挂 FakeWebview → `pushStatus` / `switchConversation` → 断言出站 `status/set` 仅含**活动** `sessionId` 且为 `generating`，绝不串非活动会话。若有 Extension Host harness，可再挂 `dsh.test.*` L2。绿后关 registry。 |
| **DEBT-001** | 同 Phase | 新建 `src/replay-hydrator.ts` 时同步 `tests/replay-hydrator.spec.ts`（或 phase test-scripts）：（1）Timeline kind/label/callId **完整序列** oracle（禁止仅 `.some`）；（2）`surfaceOp: 'replace'` 消息折叠；（3）可恢复 Diff：`oldText: null`（新建）vs 缺 `oldText` 拒绝。提升 spike helpers；断言可移植自 `verifier-independent-t0a.mts`。 |
| GAP-001 | — | 不动；Continue UI 归 phase-3。 |

## 10. 建议优先阅读

1. ⭐ 必读 — `apps/vscode-dsh/src/interaction-coordinator.ts`（全文；队列重构基线）
2. ⭐ 必读 — `apps/vscode-dsh/src/conversation-controller.ts`（关删/prompt/panelSnapshot/persistOpenTabs）
3. ⭐ 必读 — `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts` + `phases/phase-0a-spike-replay-rebuild/spike-report.md`（读缝 + 折叠契约）
4. ⭐ 必读 — `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts`（pushStatus / 回放拒绝 / FakeWebviewPort）
5. ⭐ 必读 — `design.md` AD-CU-5 / AD-CU-7 / AD-CU-8 + 本 Phase `spec.md` AC 表
6. 🔷 应读 — `extension-index.ts`、`conversation-registry.ts`、`conversation-tab-bar.ts`
7. 🔷 应读 — `packages/ide/ide-bridge/src/types.ts` + `validate.ts` + `session-host.ts` bridge 处理
8. 🔷 应读 — `packages/session-query/session-query/src/cold-read.ts`
9. 🔷 应读 — `tests/panel-l2-l3-protocol.spec.ts` + phase-1 `verifier-independent-phase1.mts` V-IND-5（DEBT-002 模板）
10. 🔹 可选 — `timeline-store.ts` Diff 解析（`oldText` 强制）、`interaction-ui.ts`、phase-0a `verifier-independent-t0a.mts`（DEBT-001 oracle 模板）
