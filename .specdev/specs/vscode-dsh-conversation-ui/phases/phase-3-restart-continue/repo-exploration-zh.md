# 代码库探索报告 — phase-3-restart-continue

## 1. 任务上下文

Phase 3 在 phase-2 多 Tab / 历史 / 回放之上交付三块产品切片：（1）**重启 / 重开 Host 后恢复**持久化的非空 `openTabSet`（一律 `mode=replay`、空 Tab 剔除、UI hydrate 上限 N 且索引全保留、活动 Tab 强制进 UI 集并聚焦、`waiting-host → replay`、按 AD-CU-4 立即写 `workspaceState`）；（2）**回放 Diff / 不完整回合**打磨（AC-76/77 + AD-CU-6：仅补丁的 `meta.diffs` 须权威前序 before；禁止当前磁盘冒充；不完整标「已停止/未完成」）；（3）**继续此会话**（Should；T-0b Gate **PASS / same-id**）：关闭 **GAP-001**，接线 ide-bridge `session/resume` → `agents.resume`，同打开期内同 `tabId` `replay→live`（AD-CU-8）。若 T-0b FAIL 则隐藏 Continue；当前 Gate 为 PASS，必须交付 Continue。

## 2. 仓库概览

| 方面 | 现状 |
|------|------|
| 语言 | TypeScript ESM（`"type": "module"`） |
| 产品应用 | `apps/vscode-dsh`（`@deepseek-ai/dsh-vscode-dsh`） |
| 运行时 | VS Code Extension Host + 极薄 Conversation Webview；Cordis `ide` profile：SDK stdio + ide-bridge NDJSON |
| 包管理 | pnpm workspace |
| 前置 Spike | T-0a **PASS**（回放折叠）；T-0b **PASS（same-id）** — 见 `phases/phase-0b-spike-continue-capability/spike-report.md` |
| Phase-2 已落地 | `ReplayHydrator`、`history-view`、`ExtensionIndex`、`openFromHistory`、`session/read-log`、InteractionCoordinator 软优先队列 |
| Phase-3 产品缺口 | 无 `restoreOpenTabs` 编排；无 Continue UI/命令；无 `session/resume` / `session/continue-capability` 帧；hydrator 未设 `incomplete`；Diff 右侧仍优先工作区文件 |
| 测试 | Vitest：`apps/vscode-dsh/tests/`；phase 脚本：`.specdev/specs/.../test-scripts/` |
| 活跃债务 | 仅 **GAP-001**（🟡 → 本 Phase）；无 🔴 |

**相对 phase-2 探索的更新**：`replay-hydrator.ts`、`history-view.ts`、bridge `session/read-log` 已**存在**。恢复 / Continue / GAP-001 仍待实现。

## 3. 最相关区域

| 路径 | 原因 | 来源 |
|------|------|:----:|
| `apps/vscode-dsh/src/extension-index.ts` | `openTabSet` / `activeSessionId` / `ui.restoreUiLimit`（N=8）；立即持久化；加载消毒；列表 `continueCapability` 暗示 | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `openFromHistory` + `persistOpenTabs`；`restoreOpenTabSet` / `continueSession` / Diff 门禁编排的自然落点 | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | 已有 `setMode(tabId, mode)` 供 Continue `replay→live`；每 `sessionId` 单 Tab | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | `session/read-log` / `session/dispose` 客户端；**需** `resumeSession`（+ 可选 continue-capability 探测） | 👁 |
| `apps/vscode-dsh/src/replay-hydrator.ts` | 折叠 + `recoverableDiffsFromMeta`（拒绝缺 `oldText`）；**尚未**标记 incomplete（AC-77） | 👁 |
| `apps/vscode-dsh/src/diff-entry.ts` | `openTimelineDiff` — 左侧 = 日志 `oldText`；**右侧优先工作区文件**（回放 Diff 违反 AD-CU-6 风险） | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` | `writeDiffsForSession` / hunk 类型 `oldText: string \| null` | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | 已有 `ChatMessage.incomplete?`；hydrator 从不赋值 | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Host↔Webview 帧；**尚无** `action/continue` / Continue 顶栏 | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushFullState` / 发送门禁；仅在无活动 Tab 时 waiting-host | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `activate` / `dsh.startSession` 连接后总是 `newConversation` — **无** openTabSet 恢复；L2 钩子注册处 | 👁 |
| `apps/vscode-dsh/src/history-view.ts` | 列表暗示 `continueCapabilityListHint`（与顶栏 Continue 解耦） | 👁 |
| `packages/ide/ide-bridge/src/types.ts` + `validate.ts` + `index.ts` | BridgeFrame 现有 dispose / read-log / permission；**GAP-001**：加 `session/resume`（+ 可选 continue-capability） | 👁 |
| `packages/sdk/server/src/server.ts` | `createSession` **仅** `agents.create`（Spike IDE 缺口）；Continue **不能**依赖 dispose 后再 create | 👁 |
| `packages/acp/acp/src/session.ts` | 参考：`AcpSession.resume` → `ctx.agents.resume({ resumeSessionId })` | 👁 |
| `packages/core/agent/src/index.ts` | `ResumeAgentOptions` / `agents.resume` — T-0b L1 已证 | 👁 |
| `apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts` | `probeContinueCapability` / `prefixUnchanged` / `continueLinkFromDerive` — 宜提升为产品 | 👁 |
| `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts` | `probeIncomplete` / Diff 可恢复性 — AC-77 产品信号源 | 👁 |
| **可能新增** restore 规划器 + Continue 命令 / L2 钩子 | `restoreOpenTabs`、`dsh.continueConversation`、`dsh.test.restoreOpenTabs`、`dsh.test.continue` | 📊 design + spec VP-3-* |

## 4. 关键入口 / 调用路径

### 路径 A — 重启恢复 openTabSet（Phase 3 主路径；**未实现**）

```
Extension activate / dsh.startSession（Host 已连接后）
  → 读 ExtensionIndex.workspaceState.openTabSet + activeSessionId
  → 过滤空 Tab（无消息 / 从未发送；剔除损坏行）
       # 立即写回消毒后的 openTabSet（AD-CU-3/4）
  → 若 Host 未就绪：
       panel/state mode=waiting-host   # AC-69
       索引仍可见；不自动 prompt
  → Host 就绪后：
       选 UI 集：activeSessionId 优先，再补满 N=restoreUiLimit
       对每个 UI Tab：
         铸造新 tabId（再开生命周期）或按规划器策略
         强制 mode=replay（即使存的是 live / liveIntent）  # AC-33
         readSessionLog → hydrateFromAuthoritativeLog
         MessageStore.replace + TimelineStore.replace
       聚焦活动 Tab；未进 UI 的索引 Tab 仍留在 openTabSet（AC-70）
       「查看更多 / 全部恢复」按需再 hydrate
```

✅ 已确认：索引持久化与 N 默认存在（`extension-index.ts`）；最接近的 hydrate 原语是 `openFromHistory`。  
✅ 已确认：`dsh.startSession` 绑定 controller 后**总是** `newConversation('New conversation')` — 无恢复路径（`extension.ts`）。  
⚠️ 假设：可用循环调用 `openFromHistory` + 规划器改写 mode→replay 并做 N 选择；冷恢复 tabId 按 AD-CU-5 应为**新** id（Continue 仅同打开期保留 tabId）。

### 路径 B — waiting-host → replay（AC-69）

```
Host 未连接时发起恢复
  → panelHost.pushFullState → mode=waiting-host（清空消息）
  → Host start / bridge hello / initialize 成功
  → 恢复编排器继续 hydrate 待恢复 UI 集
  → messages/replace + panel/state mode=replay
```

✅ 已确认：空 chrome 在未连接时已映射 `waiting-host`（`chat-panel-host.ts`）。  
⚠️ 假设：需要显式「待恢复」闩锁，避免连接后只建空白 Tab。

### 路径 C — 回放 Diff / 不完整（AC-76/77 + AD-CU-6）

```
tool/result.meta.diffs
  → recoverableDiffsFromMeta / TimelineStore 提取
       要求 path + newText + (oldText: string|null)
       仅补丁（缺 oldText）→ [] → Diff 禁用并说明
  → openTimelineDiff(hunk)
       左：dsh-diff 虚拟文档 = hunk.oldText（创建：''）
       右：今日若绝对路径则 Uri.file(工作区)   # ⚠ AD-CU-6
```

不完整：

```
权威事件（raw / cold-balanced）
  → spike probeIncomplete：未闭合 turn 或 turn/end reason.kind=interrupted
  → 产品 ChatMessage.incomplete | notice「已停止/未完成」  # hydrate 尚未接线
```

✅ 已确认：产品 hydrator + phase-2 测试已拒绝仅补丁。  
✅ 已确认：`ChatMessage.incomplete` 存在但 `hydrateFromAuthoritativeLog` 从不设置。  
✅ 已确认：Diff after 可读**当前磁盘**（`diff-entry.ts`）— 回放 Diff 门禁须修。

### 路径 D — Continue same-id（GAP-001 + AD-CU-8；**未实现**）

```
T-0b Gate = same-id（PASS）
  → probeContinueCapability({ gateVerdict:'same-id', sessionExists, resumeApiAvailable })
  → SessionIndexEntry.continueCapability = 'same-id'
  → 顶栏 Continue 可用（列表已可显示「可继续」）

用户 Continue / dsh.test.continue / action/continue
  → IdeSessionHost.resumeSession(sessionId)
       → BridgeFrame session/resume { id, sessionId }
       → ide-bridge handleResume:
            ctx.agents.resume({ resumeSessionId })   # AcpSession.resume 模式
            → session/resume/response ok
  → ConversationRegistry.setMode(tabId, 'live')      # 同打开期 tabId
  → persistOpenTabs（立即 mode=live）
  → panel/state mode=live；composer 开闸
  → 后续 prompt 走既有 session/prompt（前缀不变 — AC-66）

FAIL / unknown（AD-CU-8）：
  Gate FAIL → 隐藏 Continue
  unknown / 未探测 → 禁用 + tooltip「暂不可用」
  derive-only → 可用 + 「新会话 · 接续自 …」（回退；Gate 选 same-id）
```

✅ 已确认：SDK `getOrCreateSession` → 仅 `agents.create`；dispose 后同 id create → `SessionAlreadyExistsError`（Spike 证据）。  
✅ 已确认：BridgeFrame **无** `session/resume`。  
✅ 已确认：`agents.resume` 在 L1（T-0b）与 ACP 可用。

## 5. 可能影响面

| 区域 | 改动 | 风险 |
|------|------|:----:|
| `extension.ts` `dsh.startSession` / activate | 空白 `newConversation` 改为恢复编排 + L2 钩子（restore / continue / Diff） | **高** |
| `conversation-controller.ts` | 新增 `restoreOpenTabSet` / `continueConversation` / 空 Tab 剔除写回 / incomplete hydrate | **高** |
| `packages/ide/ide-bridge` types/validate/handler | 加 `session/resume`（+ 可选 continue-capability）；接线 `agents.resume` | **高**（GAP-001） |
| `session-host.ts` | resume 客户端往返（镜像 `readSessionLog` / `disposeSession`） | **高** |
| `replay-hydrator.ts` | 由未闭合 turn / interrupted 设置 `incomplete`；可选补丁 before 重建 | **中** |
| `diff-entry.ts`（+ Timeline Diff 命令） | 回放 Diff：两侧均来自日志快照；禁工作区 before/after | **中** |
| `chat-panel/protocol.ts` + provider + host | Continue 顶栏 / `action/continue`；派生 banner | **中** |
| `extension-index.ts` | 加载时更强空 Tab 清洗；persist 可写 `liveIntent`；恢复规划辅助 | **中** |
| `history-view.ts` / README | 文档化 N / 查看更多 / Continue / 空 Tab；列表↔顶栏保持解耦 | **低** |
| `packages/sdk/server/src/server.ts` | **优先不**扩展 stdout（AD-8）；Continue 走 bridge | **低** |
| 测试：新 `phase3-*.spec.ts` + test-scripts | VP-3-restore / VP-3-diff / VP-3-continue（条件已满足） | **高** |
| `tech-debt-registry.md` | GAP-001 落地后移入「已解决」 | 流程 |

## 6. 既有约束 / 约定

- **AD-CU-1**：Webview 极薄 — 无本地 mode 权威；Continue 须翻转 Host `panel/state`。
- **AD-CU-3/4/10**：空 Tab 永不持久化；恢复剔除空 Tab；`openTabSet` / `mode` / `activeSessionId` 每次变更即写（已有 `writeImmediate`）；UI 默认 N=8；索引保留全部非空集。
- **AD-CU-5**：每 `sessionId` 至多一个打开视图；关闭销毁 tabId；Continue 仅同打开期升级同一 tabId；重启恢复即使有 `liveIntent` 也先 replay。
- **AD-CU-6**：Diff 仅来自可恢复 `meta.diffs`；仅补丁须权威 before；**禁止当前磁盘 before/after**。
- **AD-CU-8**：能力令牌 `same-id` \| `derive-only` \| `unknown`；列表暗示 ≠ 顶栏 Continue；T-0b FAIL 隐藏 Continue（当前 N/A — Gate PASS）。
- **AD-CU-12 / AD-8**：不改 `agent-loop`；不为 resume 扩 SDK stdout；bridge 薄适配限 `packages/ide/ide-bridge`。
- 注册即 effect；品牌化 id；ESM；L2 Host 钩子须可脱离 Webview（AC-54/84）。
- 关闭 ≠ dispose（phase-1）；历史打开已用新 tabId + replay（phase-2）。

## 7. 风险 / 未知

| 项 | 确认度 | 说明 |
|----|:------:|------|
| T-0b Gate = **same-id PASS** | ✅ 已确认 | `spike-report.md`；Continue 能力已解锁 |
| GAP-001 仍开（无 bridge resume） | ✅ 已确认 | BridgeFrame + handler 无 resume；与 registry 一致 |
| startSession 无产品恢复 | ✅ 已确认 | 连接后总是 `newConversation` |
| `liveIntent` 有类型从未写入 | ✅ 已确认 | 仅出现在 `OpenTabRecord` 接口 |
| `restoreUiLimit` 已存但未用于选择 | ✅ 已确认 | 默认 8；无规划器消费 |
| 空 Tab 恢复：sanitize **不做**内容检查 | ✅ 已确认 | 加载过滤仅为结构（tabId/sessionId/mode）；内容空需消息/日志证明 |
| Incomplete UI 未产品接线 | ✅ 已确认 | 仅 spike probe；hydrator 省略 `incomplete` |
| Diff after 用工作区文件 | ✅ 已确认 | 与回放 Diff 的 AD-CU-6 冲突 |
| 仅补丁的 **before 重建** | ❓ 未知 | 产品当前**拒绝**仅补丁；phase-3 可能需「能重建则用，否则不可用」 |
| 冷重启 tabId 策略 | ⚠️ 假设 | AD-CU-5：再开铸造新 tabId；持久化 `OpenTabRecord.tabId` 可能被忽略 |
| SDK server 是否也要 resume 方法 | ⚠️ 假设 | Spike 偏好仅 bridge；stdout 保持 create/prompt/shutdown |
| 「查看更多」UI 形态 | ⚠️ 假设 | 命令 vs 面板 banner 未编码；L2 须 Host 可驱动 |

## 8. 未核实 / 勿假设

| 符号 | 状态 | 勿假设 |
|------|------|--------|
| 产品 `restoreOpenTabSet` / 规划器 | 缺失 | N 选择与活动优先行为待实现后才可知 |
| `session/resume` bridge handler | 缺失 | 错误映射、超时、与 ACP 冲突规则待定 |
| `session/continue-capability` 帧 | 可选 / 缺失 | 落地前可用 Gate 常量 `same-id`（Spike 允许） |
| 补丁 before 重建算法 | 产品未核实 | 无遍历前序快照填 `oldText` 的代码 |
| Webview Continue 按钮 / tooltip i18n | 未核实 | UI 落地须走 locale-owned 文案 |
| 跨窗口 / 多 folder workspaceKey 碰撞 | 未核实 | 索引今日按 folder 路径键控 |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:------------:|------------|:----:|
| GAP-001 | `packages/sdk/server/src/server.ts`: `createSession` / `getOrCreateSession`；`packages/ide/ide-bridge` 无 `session/resume` | 功能缺失 → phase-3 Continue | SDK 仍仅 `agents.create`；BridgeFrame 仅 dispose/read-log/permission — **无** resume/continue-capability | ✅ 匹配 — **本 Phase 关闭** |
| DEBT-001 | ReplayHydrator Timeline oracle | 已解决（phase-2） | 产品 hydrator + phase-2 测试在 | ✅ 已关闭 |
| DEBT-002 | 双 running status | 已解决（phase-2） | phase-2 夹具已关闭 | ✅ 已关闭 |

### Stub Detection Summary

- ✅ 与 registry 匹配的桩/缺口：**1**（GAP-001）
- ⚠️ Registry 不一致：**0**
- 🔴 未注册桩：**0**（未发现 `@STUB` / 空 Continue handler）
- 🟡 关注（非 registry 桩）：缺恢复编排；`incomplete` 未用；Diff 工作区 after；`liveIntent` 未用 — 属 **phase-3 范围工作**，不是未注册桩

**Phase Entry Gate：无 🔴 阻塞债。**

### GAP-001 落点（implementer 优先）

| 层 | 文件 | 工作 |
|----|------|------|
| Bridge 类型 | `packages/ide/ide-bridge/src/types.ts` | `BridgeFrame` 增加 `session/resume` + `/response`（+ 可选 `session/continue-capability`） |
| Bridge 校验 | `packages/ide/ide-bridge/src/validate.ts` | 接受/拒绝帧 |
| Bridge 运行时 | `packages/ide/ide-bridge/src/index.ts` | `handleResume` → `ctx.agents.resume({ resumeSessionId })`（镜像 `AcpSession.resume` / dispose 服务模式） |
| Host 客户端 | `apps/vscode-dsh/src/session-host.ts` | `resumeSession(sessionId)` 往返，类似 `readSessionLog` |
| 产品 Continue | `apps/vscode-dsh/src/conversation-controller.ts` | `continueConversation(tabId)` → resume → `registry.setMode(..., 'live')` → persist |
| UI / L2 | `extension.ts` + `chat-panel/*` | 命令 + 可选 `action/continue`；`dsh.test.continue` |
| 探测复用 | 提升 `tests/spike-t0b-continue-helpers.ts` → `src/`（或共享模块） | AD-CU-8 映射 |
| **避免** | 在 SDK stdout `session/prompt` 路径静默 resume | 违反 AD-8 / Spike 指引 |

## 10. 建议优先阅读

1. ⭐ 必读 — `phases/phase-3-restart-continue/spec.md`（AC-33/34/69/70/76/77/32/66–68 + VP 表）
2. ⭐ 必读 — `design.md` AD-CU-3/4/5/6/8/10 + Continue 骨架 `upgradeReplayToLive`
3. ⭐ 必读 — `phases/phase-0b-spike-continue-capability/spike-report.md`（Gate same-id + GAP 接线）
4. ⭐ 必读 — `apps/vscode-dsh/src/extension-index.ts` + `conversation-controller.ts`（`openFromHistory` / `persistOpenTabs`）
5. ⭐ 必读 — `packages/ide/ide-bridge/src/types.ts` + `index.ts`（`handleReadLog` / `handleDispose` 作 resume 模板）
6. ⭐ 必读 — `packages/acp/acp/src/session.ts`（`AcpSession.resume`）
7. 🔷 宜读 — `apps/vscode-dsh/src/replay-hydrator.ts` + `diff-entry.ts` + `tests/spike-t0a-replay-hydrator.ts`（`probeIncomplete`）
8. 🔷 宜读 — `apps/vscode-dsh/src/session-host.ts`（`readSessionLog` 模式）
9. 🔷 宜读 — `apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts` + `spike-t0b-continue-capability.spec.ts`
10. 🔷 宜读 — `apps/vscode-dsh/src/extension.ts`（`dsh.startSession`、L2 钩子）
11. 🔹 可选 — `packages/sdk/server/src/server.ts`（`createSession` 缺口证据）
12. 🔹 可选 — phase-2 `implementation.md` / `repo-exploration.md`（已落地基线）

---

### 优先改动文件（≤12）

1. `packages/ide/ide-bridge/src/types.ts`
2. `packages/ide/ide-bridge/src/validate.ts`
3. `packages/ide/ide-bridge/src/index.ts`
4. `apps/vscode-dsh/src/session-host.ts`
5. `apps/vscode-dsh/src/conversation-controller.ts`
6. `apps/vscode-dsh/src/extension.ts`
7. `apps/vscode-dsh/src/extension-index.ts`
8. `apps/vscode-dsh/src/replay-hydrator.ts`
9. `apps/vscode-dsh/src/diff-entry.ts`
10. `apps/vscode-dsh/src/chat-panel/protocol.ts`（+ 按需 host/provider）
11. `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts`（新建）+ test-scripts
12. `apps/vscode-dsh/README.md`（N / 查看更多 / Continue / 空 Tab）
