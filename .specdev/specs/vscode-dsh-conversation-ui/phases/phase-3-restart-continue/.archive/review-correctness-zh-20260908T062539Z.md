# 正确性审查 — phase-3-restart-continue（PARTIAL 回炉复审）

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 独立验证

| 命令 | 结果 |
|------|------|
| `bash .../test-scripts/run-phase3-l2-l3.sh` | exit 0；3 files / **28 tests passed**（含 DEBT-003..006） |
| `tsx .../verifier-independent-phase3.mts` | exit 0；**failed=0**；V-IND-3 断言 `openTabSet.length===3` |

## DEBT-003..006 关闭核验

| ID | 声称修复 | 代码证据 | 测试证据 | 关闭？ |
|----|---------|---------|---------|:-----:|
| DEBT-003 | `persistOpenTabs` 合并 deferred；restore 批 suspend | `conversation-controller.ts:918-939` 合并 `deferredRestore`；`335/444` suspend/finally | DEBT-003 二次冷启动仍 `openTabSet=[s0,s1,s2]`；V-IND-3 length===3 | ✅ 主路径关闭 |
| DEBT-004 | 薄 Webview Continue / 查看更多 | `chat-panel-provider.ts:122-123,165-186,232-236` `syncChrome` + postMessage | DEBT-004 HTML 断言；Host `action/continue` / `action/restore-more` 已有 L3 | ✅ 关闭 |
| DEBT-005 | Host connected 自触发 latch | `session-host.ts:109-118,147-151`；controller `174-179` | DEBT-005：`status=connected` → `pendingRestore=false` + registry replay | ✅ 关闭 |
| DEBT-006 | 读失败不空剔；可二次 restore | `346-360` `loadFailed`→`hasContent=true`；失败行进 deferred；`setOpenTabs(plan.indexSet)` | DEBT-006：失败后 openTabSet 仍含 `sess-fail`；二次 restore 保留 | ⚠️ 主路径关闭；见 Should-Fix |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-33 | 恢复未关 Tab；一律 replay；无自动 prompt；空 Tab 剔除 | `restore-planner` + `restoreOpenTabSetBody` | ✅ | 强制 replay；空 content → stripped；`promptCalls===0` |
| AC-69 | 未就绪 waiting-host；就绪后自动重建 | latch + `onStatusChange`；`dsh.startSession` 亦调 restore | ✅ | waiting-host 面板态；DEBT-005 自触发；L3 FakeWebview messages/replace |
| AC-70 | UI 限 N；索引全保留；查看更多 | planner + `persistOpenTabs` 合并 deferred + `restoreMoreTabs` + Webview 按钮 | ✅ | index/openTabSet 全量；`deferredRestoreCount`；命令 `dsh.restoreMoreTabs(all)` |
| AC-34 | 活动 Tab 优先入 UI 并聚焦 | planner active-first；hydrate 后 `switchTo` | ✅ | hydrated[0]=active；V-IND-3 |
| AD-CU-4 立即持久化 | 变更立即写 workspaceState | `setOpenTabs` → `writeImmediate`；`persistOpenTabs` | ✅ | `getWriteCount()` 增加；非仅 deactivate |
| AC-76 / AD-CU-6 | Diff 门禁；禁工作区冒充 | `recoverableDiffsFromMeta`；`openTimelineDiff` 双侧 dsh-diff | ✅ | patch-only→[]；spy 无 `Uri.file` |
| AC-77 | 不完整「已停止/未完成」 | hydrator `incomplete` + notice | ✅ | L2 + V-IND-2 |
| AC-68 / AD-CU-8 | Continue 四态 | `continueChromeForTab` + Webview `syncChrome` | ✅ | Gate same-id；HTML 消费 `continue`；FAIL→hidden 逻辑在位 |
| AC-32/66/67 | 同 tabId 升级；不改前缀；derive banner | `continueConversation` + resume | ✅ | L3 FakeWebview；V-IND-1 |
| AC-54 / AC-84 | L2+L3 门禁 | `run-phase3-l2-l3.sh` + V-IND | ✅ | 28 + V-IND 全绿 |
| GAP-001 | resume 全链路 | bridge + SDK + Host | ✅ | 已解决；非空壳 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| （无活跃 STUB） | — | — | 活跃债务表为空；DEBT-003..006 / GAP-001 均在「已解决」 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | 关键路径均有真实逻辑；未发现硬编码空壳冒充产品行为 |

## 关键发现

### 🔴 Must-Fix
- （无）— 所列 AC 主路径均有可追踪真实实现；DEBT-003..005 已实关；DEBT-006 restore 主路径已关；独立 L2/L3 + V-IND 全绿。

### 🟡 Should-Fix
1. **`restoreMoreTabs` 在读失败时丢弃 deferred 行（DEBT-006 残留边界）** — `restoreMoreTabs` 用 `shift`/`splice` 取出 deferred 后调用 `openFromHistory`；若返回 `outcome:'error'`（瞬时 `readSessionLog` 失败），记录既不回填 `deferredRestore`，也不进 registry，随后 `persistOpenTabs()` 会把该 session 从 `openTabSet` 抹掉。DEBT-006 的 restore 主路径（`loadFailed`→deferred→二次 `restoreOpenTabSet`）正确，但用户点「查看更多」且读仍失败时，会绕过「不空剔」保证。建议：`error` / `host-not-ready` 时把 record 重新 push 回 `deferredRestore`（或保留在 take 失败队列），并加回归用例。

### 🟢 Observations
- 上一轮 SHOULD-FIX（Webview 未绑 Continue/查看更多；restore 读失败当空剔）均已用真实逻辑闭合，并有专属 DEBT 回归。
- AC-69 现双路径：`IdeSessionHost.onStatusChange` latch + `dsh.startSession` 显式 `restoreOpenTabSet`。
- 「全部恢复」经 `dsh.restoreMoreTabs(true|'all')` / `action/restore-more` 的 `all` 字段；薄 Webview 按钮默认一次一条，符合「查看更多」语义。
- Diff 对 patch-only 仍为「不可用」而非假重建，符合 AD-CU-6。
