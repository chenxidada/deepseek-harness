# Correctness Review — phase-4-subagent-enter-pin

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 独立复跑证据

```text
bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/run-phase4-l2-l3.sh
# Test Files  1 passed (1) | Tests  12 passed (12) | exit 0
# tsc -p apps/vscode-dsh/tsconfig.json --noEmit → exit 0

# 附加：phase3-restart-continue.spec.ts 13/13 PASS（未覆盖本 Phase 引入的 Continue chrome 回归）
```

独立探针（非 implementer 测试）：
- `readonly-live` 下子 `session.event` → `messages/append` 实时投影 ✅
- 父 Tab / 已钉子 Tab 处于 `replay` 时：`continueChromeForTab` = `enabled`，但 `pushFullState` 的 `panel/state.continue` = `{ visibility: 'hidden' }` ❌

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-35 | 父流 subagent 入口可进入子会话可读消息流 | `conversation-controller.ts` `onSubagentStarted` / `openSubagentContext`；`chat-panel-host.ts` `nav/open-subagent` | ✅ | `subagent.started` 追加 `kind:'subagent'` 卡片；`openSubagentContext` 设 `contextSessionId` 并 `pushFullState` → `messages/replace`；函数体非空壳 |
| AC-36 | 面包屑返回父 | `navBack`；Host `nav/back`；HTML `backBtn` | ✅ | 有 `contextSessionId` 时清除并恢复父 `sessionId`；测例断言 `panel/state` |
| AC-37 | 默认进入不占 Tab | `openSubagentContext` 默认分支 | ✅ | 只 `setContextSessionId`；`registry.list().length` 不变（测例） |
| AC-39 | 子运行中 banner；结束清除 + 卡片「已结束」 | `onSubagentStarted` / `onSubagentFinished` / `isParentCurrentContext` | ✅ | banner「子代理运行中」；`subagent-clear`；卡片 `text:'已结束，可进入回放'` / `subagentStatus:'ended'` |
| AC-40 | 结束后只读回放；回放/继续策略与父一致 | `openSubagentContext` + `resolvePanelProjection`；Continue 路径 | ⚠️ | 结束后进入 `mode:'replay'` ✅；composer 拒绝 ✅。但 `pushFullState`/`panelSnapshot` 在 `resolvePanelProjection` 下用 `mode === 'live'` 才解析 Continue chrome，与 `continueChromeForTab`（仅 `replay` 启用）**反转**，父/已钉子 Tab 回放顶栏 Continue 被隐藏 — 不满足 P1-A「继续」Should 策略（见关键发现） |
| AC-71 | 运行中进入=只读实时；结束自动转回放 | `openSubagentContext` / `onSubagentFinished` / `sendPrompt` | ✅ | `readonly-live` + `reject('readonly-live')`；子结束且在 context 中 → `ensureChildHydrated` + `mode:'replay'`；独立探针确认 live append |
| AC-38 | 可钉成 Conversations Tab | `pinSubagent` | ✅ | `registry.create` + `setPinnedSubagent` + `persistOpenTabs`；Tab 数 +1；恢复父为 active |
| AC-78 | 已钉后从父进入 → 激活已有子 Tab | `openSubagentContext` pinned 分支 | ✅ | `getBySessionId` → `switchTo`；清 `contextSessionId`；不设父内子上下文 |
| AC-79 | 钉定时在子上下文 → 提升 Tab 并恢复父视图 | `pinSubagent` | ✅ | 先清 context，mint 子 Tab，再 `switchTo(parentTabId)` |
| AC-74 | 子已删 → 卡片不可进入 | `openSubagentContext` + `markSubagentCardDeleted` | ✅ | `index.isDeleted` → `outcome:'deleted'`；卡片「子会话已删除」；context 不切换 |
| AC-75 | 父已删 → 面包屑禁用返回 | `buildBreadcrumb` / `navBack` / HTML | ✅ | `parentDeleted:true` + label「父会话已删除」；`navBack` → `disabled`；父删保留子 Tab（偏差 1，符合 AC-75） |
| AC-54 / AC-84 | L2+L3 模拟 Webview；覆盖进入子会话 | `phase4-subagent-enter-pin.spec.ts` + `run-phase4-l2-l3.sh` | ✅ | FakeWebview `nav/open-subagent`；12/12 + tsc；独立复跑 exit 0 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | ✅ | 活跃债务表为空；无已知桩需豁免 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 未发现 `(void)args` / 硬编码假成功冒充导航 / 空壳 `openSubagentContext` | — | — |

说明：`ensureChildHydrated` 中 `void item` 与空 `catch` 是故意跳过 timeline 重放 / 缺日志容错，不是功能桩。

## 关键发现

### 🔴 Must-Fix
（无）— Phase 4 Must AC 主路径均有真实函数体，且 L2/L3 门禁独立复跑通过。

### 🟡 Should-Fix
1. **Continue chrome 门控反转（Phase 4 引入回归）** — `chat-panel-host.ts` `pushFullState` 与 `conversation-controller.ts` `panelSnapshot`：
   - 现状：`projection.mode === 'live' ? resolveContinueChrome() : { visibility: 'hidden' }`
   - `continueChromeForTab` 仅在 Tab `mode === 'replay'` 时返回 `enabled`
   - 结果：父回放 Tab、已钉子回放 Tab 的 `panel/state.continue` 恒为 hidden，尽管 Host 侧 Continue 能力为 enabled（独立探针复现）
   - 影响 AC-40「继续策略与父一致」（requirements：打开只读为 Must，继续为 Should）及 Phase 3 Continue 顶栏 UX
   - 修复方向：对 `replay`（或始终委托 `resolveContinueChrome`）解析 chrome，勿在 `live` 才调用

2. **纯 context 子回放的 Continue 未绑到子 session** — `continueConversation` / `continueChromeForTab` 仍读父 Tab；即便修复 (1)，未钉的子 context 也不会对子 `sessionId` 做 resume。repo-exploration §8 已提示；可通过「先钉再 Continue」规避，但若要严格对齐 P1-A Should，需显式设计。

### 🟢 Observations
- Live 投影路径真实：`projectAssistantMessage` 用 `contextSessionId ?? sessionId` 作为 effective；独立探针在 `readonly-live` 下收到子 `messages/append`。
- 父删不关子 Tab（implementation 偏差 1）与 AC-75 / AC-61 一致，非缺陷。
- phase4 测例未断言 `panel/state.continue`，故 Continue 回归未被门禁捕获。
