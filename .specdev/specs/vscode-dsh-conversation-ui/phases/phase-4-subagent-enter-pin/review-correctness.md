# Correctness Review — phase-4-subagent-enter-pin（复审）

## 视角
**Implementation Correctness** — 代码是否正确工作（SHOULD-FIX 修复核实 + 回归复查）

## 判决
**PASS**

## 复审范围

上一轮合并判决 SHOULD-FIX，共 2 条 Should-Fix，implementer 已修复。本次复审核实 2 条修复是否真实生效、有无引入回归，并复查整体 AC 满足度。

## SHOULD-FIX 修复核实

### SHOULD-FIX-1：钉「运行中」子 Tab 投影 `readonly-live`（消除口径分裂）

| 检查点 | 代码证据 | 判定 |
|--------|---------|:--:|
| 根分支对 `pinnedSubagent && running` 投影 `readonly-live` | `conversation-controller.ts:1913-1918`：`pinnedRunning = active.pinnedSubagent === true && childRunState.get(active.sessionId) === 'running'` → `mode: pinnedRunning ? 'readonly-live' : active.mode === 'replay' ? 'replay' : 'live'` | ✅ |
| `sendPrompt` 据此 reject | `chat-panel-host.ts:699-702`：`projection.mode === 'readonly-live'` → `reject('readonly-live')` | ✅ |
| 结束后翻转到 `replay`（registry `mode` 仍 `'live'` 的兜底链路成立） | `conversation-controller.ts:2028` 先置 `childRunState='ended'`（使 `pinnedRunning` 变 false）；`:2048-2052` 兜底 `childTab.mode === 'live'` → `setMode('replay')` → 投影翻转为 `replay` | ✅ |

**兜底链路时序核实**：`onSubagentFinished` 中 `childRunState.set('ended')`（`:2028`）先于 `setMode('replay')`（`:2050`）执行，且中间无 `pushFullState` 介入（context 分支 `:2041-2045` 提前 return，钉 Tab 分支在 `:2050` 先 setMode 再 `:2051` hydrate、`:2053` pushFullState）。因此不存在「ended 但 mode 仍 live」的瞬时可写窗口，翻转为原子安全。✅

### SHOULD-FIX-2：删除 `TimelineStore.childrenOf()` 休眠 API

| 检查点 | 代码证据 | 判定 |
|--------|---------|:--:|
| `childrenOf` 已删除 | 全树 `apps/vscode-dsh` 下 grep `childrenOf` 零匹配 | ✅ |
| 私有 `children` map 保留 | `timeline-store.ts:56` `private readonly children = new Map<...>()` | ✅ |
| 内部逻辑未破坏 | `linkChild`（`:353-361`）、`clearSession`（`:233-247`）、`apply`（`:85/100` 调 linkChild）、`collectTree`（`:383`）、`depthOf`（`:370`）、`getParent`（`:223-225`）全部引用 `children`/`parents`，无悬空引用 | ✅ |

## 回归检查

| 检查点 | 结论 |
|--------|------|
| `readonly-live` 投影下 `pushStatus` | `chat-panel-host.ts:642-649` 走 `resolvePanelProjection()` → `projection.tabStatus` → `resolveStatus`，正常下发 `status/set`，无异常路径 | ✅ |
| `readonly-live` 投影下 `pushAppend`/`pushPatch` | `chat-panel-host.ts:563-566/575-588` 以 `projectedSessionId()`（= 子 session id）门控；子 session 流式消息在钉 Tab/上下文两种投影下均命中 | ✅ |
| 钉运行中子 Tab 的 Continue chrome | `effectiveContinueMode` 对无 context 的钉 Tab 返回 `tab.mode='live'` → `continueChromeFor` 返回 `disabled('already-live','已是 live')`。即「运行中=已是 live」→ Continue 禁用，与投影 `readonly-live`（composer 只读）语义一致，**无新增口径分裂** | ✅ |
| `parseWebviewToHostMessage` fail-closed | `protocol.ts` 对 `nav/open-subagent`/`action/pin-subagent`/`nav/back` 缺字段/错类型返回 `undefined`，不误放行 | ✅ |
| 测试覆盖新行为且有真实断言 | `phase4-subagent-enter-pin.spec.ts:186-212` 新增用例「pinned running child Tab projects readonly-live and rejects send until finished」，断言 `projection.mode === 'readonly-live'`、`sendPrompt` reject `readonly-live`、结束后 `mode === 'replay'` + reject `replay`，共 12 用例全 PASS | ✅ |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-35 | 父流入口进入子可读消息流 | `openSubagentContext` `:1758-1796` | ✅ | 设 `contextSessionId` + `ensureChildHydrated`；`pushFullState` 以子投影下发 `messages/replace` |
| AC-36 | 面包屑返回父 | `navBack` `:1803-1824` | ✅ | 清 context 或 switch 父 Tab；测试断言 `outcome:'restored'` |
| AC-37 | 默认进入不占 Tab | `openSubagentContext` 默认分支 | ✅ | 仅设 context，registry Tab 数不变（测试 `:112`） |
| AC-38 | 可钉成 Tab | `pinSubagent` `:1831-1879` | ✅ | `create` + `setPinnedSubagent(true)` + `persistOpenTabs` |
| AC-39 | 子运行/结束卡片状态 | `onSubagentStarted` `:1988-2025` / `onSubagentFinished` `:2027-2054` | ✅ | 卡片 `subagentStatus` running↔ended；banner 生命周期 |
| AC-40 | 结束后只读回放；Continue 与父一致 | `resolvePanelProjection` + `effectiveContinueMode` | ✅ | 结束投影 `replay`；Continue chrome 与 Host 一致 |
| AC-71 | 运行中=只读实时；结束转回放 | `resolvePanelProjection` `:1891-1902`（context）/`:1913-1918`（钉 Tab）+ `sendPrompt` reject | ✅ | 两条路径均 `readonly-live`，结束转 `replay` |
| AC-74 | 子已删卡片不可进入 | `openSubagentContext` `:1763-1767` + `markSubagentCardDeleted` | ✅ | `outcome:'deleted'`；文案「子会话已删除」 |
| AC-75 | 父已删面包屑禁用返回 | `buildBreadcrumb` `:2071-2085` / `navBack` `:1817-1819` | ✅ | `parentDeleted:true` + `navBack → 'disabled'` |
| AC-78 | 已钉后从父进入激活已有 Tab | `openSubagentContext` `:1769-1781` | ✅ | `outcome:'activated-tab'` + `switchTo` |
| AC-79 | 钉定时在子上下文 → 提升并恢复父 | `pinSubagent` `:1861-1871` | ✅ | 先清 context → mint 子 Tab → `switchTo(parentTabId)` |
| AC-54/84 | L2+L3 模拟 Webview；VP-4-sub | `phase4-subagent-enter-pin.spec.ts`（12 用例）+ `verifier-independent-phase4.mts` | ✅ | 12/12 + tsc exit 0 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | ✅ | 活跃债务表为空（`tech-debt-registry.md` 活跃表「（无）」） |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 未发现功能空壳 / 硬编码假成功 | — | — |

说明：`ensureChildHydrated` 中空 `catch`（`:2126-2128`）是缺子日志容错（进入仍允许空回放），非功能桩。全树无 `@STUB`/`@TODO`/`@FIXME` 标记；`apps/vscode-dsh/src` 下 `\bany\b` 匹配全部为注释/文档措辞，无 `: any`/`as any`/`<any>` 类型逃逸。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）— 2 条 SHOULD-FIX 均已真实关闭，且未引入回归。

### 🟢 Observations

- **钉运行中子 Tab 的 `tabStatus` 投影与 context 路径不对称（非本次修复引入）**：`resolvePanelProjection` 根分支对钉运行中子 Tab 用 `tabStatus: active.status`（registry 字段，`create` 默认 `'idle'`，`onSubagentStarted` 不更新它），而 context 分支用 `tabStatus: run === 'running' ? 'running' : 'idle'`（派生自 `childRunState`）。因此钉运行中子 Tab 的 `status/set` 可能显示 `idle` 而非 `generating`（除非该子 session 另有 `session.status` 通知到达 `onSdkNotification:2613-2621`）。影响面：仅状态指示器，**不影响** `sendPrompt` 门控（`readonly-live` mode 独立拒绝发送）、**不破坏任何 AC**、**非本轮修复引入的回归**。属轻微 UX 一致性问题，若后续想对齐，可让根分支对 `pinnedSubagent && running` 同样派生 `tabStatus: 'running'`。
- SHOULD-FIX-1 采用「投影层最小改动」：钉 Tab 的 registry `mode` 仍为 `'live'`，运行状态由投影层 `readonly-live` 表达，`OpenTabMode` 未扩展。语义自洽，`onSubagentFinished` 的 `childTab.mode === 'live'` 兜底（`:2049`）因此得以成立。
