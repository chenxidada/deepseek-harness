# Correctness Review — phase-3-restart-continue

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 独立验证

| 命令 | 结果 |
|------|------|
| `bash .../test-scripts/run-phase3-l2-l3.sh` | exit 0；3 files / **24 tests passed** |
| `vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | exit 0；20 files / **90 tests passed** |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-33 | 恢复未关 Tab；一律 replay；无自动 prompt；空 Tab 剔除 | `restore-planner.ts:38-89`；`conversation-controller.ts:277-399` | ✅ | `planRestoreOpenTabs` 强制 `mode=replay`；无 content → `stripped`；`restoreOpenTabSet` 写回 sanitized index；测试断言 `promptCalls===0` |
| AC-69 | 未就绪 waiting-host；就绪后重建 | `conversation-controller.ts:294-301,792-800`；`extension.ts:208-219` | ✅ | 断开 → `outcome:'waiting-host'` + `panel/state`；`dsh.startSession` 在 connect 后调用 `restoreOpenTabSet` → hydrate + `messages/replace` / `replay`（L2+L3 覆盖） |
| AC-70 | UI 限 N；索引全保留；查看更多 | `restore-planner.ts:69-89`；`restoreMoreTabs` `conversation-controller.ts:406-450`；`action/restore-more` | ✅ | `indexSet` 全量、`uiSet≤N`、`deferred`；`restoreMoreTabs(all)` / L2 hook / Host 协议存在 |
| AC-34 | 活动 Tab 优先入 UI 并聚焦 | `restore-planner.ts:73-79`；`conversation-controller.ts:378-386` | ✅ | active 先入 `uiSet`；hydrate 后 `registry.switchTo(activeTabId)`；测试 active=`sess-c` 且 hydrated[0] 为 c |
| AD-CU-4 立即持久化 | openTabSet/mode/active 立即写 | `extension-index.ts:131-143,211-215`；`persistOpenTabs` | ✅ | `setOpenTabs` → `writeImmediate`；restore / Continue 后 `persistOpenTabs`；测试 `getWriteCount()` 增加 |
| AC-76 | 无 Diff 快照禁用；有则可用；禁工作区冒充 | `replay-hydrator.ts:251-265`；`diff-entry.ts:66-109` | ✅ | 缺 `oldText` → `[]`；`openTimelineDiff` 双侧 `dsh-diff`；spy 无 `Uri.file` |
| Diff before（AD-CU-6） | 仅补丁无法重建 → 不可用 | `recoverableDiffsFromMeta` + `isRecoverableReplayDiff` | ✅ | patch-only 拒绝；不读磁盘作 before/after（无「假重建」路径） |
| AC-77 | 不完整回合「已停止/未完成」 | `replay-hydrator.ts:72-92,274-286` | ✅ | `detectIncomplete`（open turn / interrupted）；末条 `incomplete` + notice 文案 |
| AC-68 / AD-CU-8 | T-0b PASS 交付；FAIL 隐藏；四态 | `continue-capability.ts:17,53-83`；`continueConversation` / `continueChromeForTab` | ⚠️ | Gate=`same-id`；chrome enabled/disabled+「暂不可用」/FAIL→hidden 有真实逻辑与 L2；**Webview HTML 未绑定 `panel/state.continue`**（见 Should-Fix）；命令 `dsh.continueConversation` 可用 |
| AC-32 | 同打开期同 tabId replay→live | `conversation-controller.ts:458-510` | ✅ | `resumeSession` 后 `setMode(tab.tabId,'live')`；L3 FakeWebview `action/continue` 断言同 tabId |
| AC-66 | 不改写旧权威前缀 | Continue → 同 `sessionId` prompt；`prefixUnchanged` helper | ✅ | same-id resume 不重写日志；follow-up 同 sessionId（L2）；无 create 旁路 |
| AC-67 | 派生 banner / 换绑 | `continueConversation` banner 分支；`continueLinkFromDerive` | ✅ | Gate 主路径 same-id；derive-only banner 字符串就绪；非本 Gate 主路径 |
| AC-54 / AC-84 | L2 hooks + L3 FakeWebview | `extension.ts` hooks；`phase3-restart-continue.spec.ts`；`run-phase3-l2-l3.sh` | ✅ | restore / diff / continue / restoreMore 钩子注册；脚本 24 tests exit 0；T-0b PASS 故 Continue 未跳过 |
| GAP-001 | bridge resume + sdkSessionResume | `ide-bridge` `handleResume`；`sdk/server` `resumeSession`→`agents.resume`+Map；`session-host.resumeSession` | ✅ | 函数体真实；registry「已解决」；ide-bridge + phase3 Continue 测试 PASS |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| （无活跃 STUB） | — | — | 活跃债务表为空 |
| GAP-001 | resume 全链路 | ✅ 已关闭 | 已移入「已解决」；代码非空壳 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | 关键路径均有真实逻辑；未发现 `return []`/`return true` 硬编码冒充产品行为的未注册桩 |

## 关键发现

### 🔴 Must-Fix
- （无）— 所列 AC 均有可追踪的真实实现路径；GAP-001 已关闭；独立复跑 L2/L3 与扩展 vitest 全绿。

### 🟡 Should-Fix
1. **Webview 未消费 Continue / 查看更多 chrome** — `chat-panel-provider.ts` 内嵌 HTML 忽略 `panel/state.continue` 与 `deferredRestoreCount`，无 Continue /「查看更多」控件，也不发 `action/continue` / `action/restore-more`。Host 协议、命令与 L2/L3（FakeWebview）正确；spec 将真实渲染标为 L4，但产品文案写「顶栏 Continue」。建议在 Webview 绑定 chrome，或明确文档仅命令入口。
2. **`readSessionLog` 失败被当成空 Tab 永久剔除** — `restoreOpenTabSet` 中 `catch` 将失败填入空 messages，随后 `planRestoreOpenTabs` 剔除并 `setOpenTabs` 写回。瞬时读失败会丢 openTabSet 行（历史索引仍在）。建议失败行保留在 index / deferred，或重试，勿当 empty strip。

### 🟢 Observations
- GAP-001 关闭路径完整：`IdeSessionHost.resumeSession` → bridge `session/resume` → `sdkSessionResume` → `agents.resume` + session Map 登记；未走 SDK stdout create。
- AC-69「自动」重建由 `dsh.startSession` 在 connect 成功后编排，而非 Host status 变更监听器；与产品启动路径一致，L2 用二次 `restoreOpenTabSet` 模拟。
- Diff 对 patch-only 采取「不可用」而非尝试前序快照重建，符合 AD-CU-6「无法重建 → 不可用」。
- derive-only 换绑 sessionId 未做完整产品路径；当前 Gate 为 same-id，可接受。
