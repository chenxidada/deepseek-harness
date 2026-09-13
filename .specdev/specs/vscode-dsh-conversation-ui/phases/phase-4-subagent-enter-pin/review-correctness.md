# Correctness Review — phase-4-subagent-enter-pin

## 视角
**Implementation Correctness** — 代码是否正确工作（债务清扫后复审）

## 判决
**PASS**

## 独立复跑证据

```text
PATH=... ./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts
→ Test Files 3 passed | Tests 41 passed

PATH=... ./node_modules/.bin/vitest run ... -t 'DEBT-00[7-9]|DEBT-01[0-3]'
→ Tests 8 passed | 33 skipped

bash .../test-scripts/run-phase4-l2-l3.sh
→ phase4 17/17 + tsc --noEmit exit 0

独立探针（非 implementer 套件，跑后删除）：
- DEBT-007：replay 下 panel/state.continue === continueChromeForTab === enabled ✅
- DEBT-008：context 子 Continue resume 绑 contextSessionId 并提升 live Tab ✅
```

## DEBT-007…013 关闭核查

| ID | 声称修复 | 代码证据 | 测试证据 | 判定 |
|----|---------|---------|---------|:--:|
| DEBT-007 | Continue chrome 不再仅 live 才解析 | `chat-panel-host.ts` `pushFullState` 投影路径始终 `resolveContinueChrome`；`panelSnapshot` 始终 `continueChromeForTab` | phase4 DEBT-007 + 独立探针 | ✅ 已关 |
| DEBT-008 | context 子 Continue 绑 `contextSessionId` | `effectiveContinueSessionId` / `effectiveContinueMode`；`continueConversation` resume 子 id 并 promote Tab | phase4 DEBT-008 + 独立探针 | ✅ 已关 |
| DEBT-009 | 删子立即 patch 父卡 | `deleteConversation`/`deleteSession` 清 timeline **前**取 parent，后 `markSubagentCardDeleted` | phase4 DEBT-009 | ✅ 已关 |
| DEBT-010 | restore 消费 `pinnedSubagent` | `restoreOpenTabSetBody` + `restoreMoreTabs` 成功后 `setPinnedSubagent` | phase4 DEBT-010 | ✅ 已关 |
| DEBT-011 | 父未打开/已删面包屑禁用 | `buildBreadcrumb`：`navDisabled = parentDeleted \|\| !parentOpen`；与 `navBack` 对齐 | phase4 DEBT-011 | ✅ 已关 |
| DEBT-012 | L2 冷读无 events 注入 | phase2：`openFromHistory` 走 `readSessionLog`；unbind 后 `listHistory` | phase2 DEBT-012 | ✅ 已关 |
| DEBT-013 | restoreMore batch 不缩水 | `restoreMoreTabs` 全程 `openTabPersistSuspended`，批末一次 `persistOpenTabs` | phase3 DEBT-013 | ✅ 已关 |

活跃债务表为空；registry「已解决」条目与上表一致。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-35 | 父流 subagent 入口可进入子会话可读消息流 | `openSubagentContext`；Host `nav/open-subagent` | ✅ | 设 `contextSessionId` + hydrate/`messages/replace`；非空壳 |
| AC-36 | 面包屑返回父 | `navBack`；Host `nav/back` | ✅ | 清 context 或 switch 父 Tab；测例断言 |
| AC-37 | 默认进入不占 Tab | `openSubagentContext` 默认分支 | ✅ | 仅 context；registry Tab 数不变 |
| AC-39 | 子运行中 banner；结束清除 | `onSubagentStarted` / `onSubagentFinished` | ✅ | banner「子代理运行中」；结束 clear + 卡片「已结束」 |
| AC-40 | 结束后只读回放；继续策略与父一致 | `openSubagentContext` + DEBT-007/008 Continue | ✅ | 结束进 `replay`；Continue chrome 与 Host 一致（先前 SHOULD-FIX 已关） |
| AC-71 | 运行中=只读实时；结束转回放 | `openSubagentContext` / `onSubagentFinished` / send 拒绝 | ✅ | `readonly-live`；结束转 `replay` |
| AC-38 | 可钉成 Tab | `pinSubagent` | ✅ | create + `setPinnedSubagent` + persist |
| AC-78 | 已钉后从父进入激活已有 Tab | `openSubagentContext` pinned 分支 | ✅ | `switchTo`；不设父内 context |
| AC-79 | 钉定时在子上下文 → 提升并恢复父 | `pinSubagent` | ✅ | 先清 context，mint 子 Tab，再 `switchTo(parent)` |
| AC-74 | 子已删 → 卡片不可进入 | `openSubagentContext` + `markSubagentCardDeleted` | ✅ | `outcome:'deleted'`；文案「子会话已删除」 |
| AC-75 | 父已删 → 面包屑禁用 | `buildBreadcrumb` / `navBack` | ✅ | `parentDeleted` + `navBack` → `disabled` |
| AC-54 / AC-84 | L2+L3 模拟 Webview；VP-4-sub | `phase4-subagent-enter-pin.spec.ts` + `run-phase4-l2-l3.sh` | ✅ | 17/17 + tsc；独立复跑 exit 0 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | ✅ | 活跃债务表为空 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 未发现功能空壳 / 硬编码假成功冒充导航 | — | — |

说明：`ensureChildHydrated` 中 `void item` 与空 `catch` 是故意跳过 timeline 重放 / 缺日志容错，不是功能桩。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）— 上一轮 SHOULD-FIX（Continue chrome 门控反转；context 子 Continue 未绑子 session）已由 DEBT-007/008 真实关闭，独立探针复现为 enabled / resume 子 id。

### 🟢 Observations
- DEBT-011 将「父 Tab 未打开」也映射到 `breadcrumb.parentDeleted=true`（label 区分「未打开」/「已删除」），与 `navBack` 禁用对齐；语义字段名略宽，但行为正确。
- phase2/3/4 相关套件 41/41 + DEBT 过滤 8/8 均 PASS；债务清扫未引入新的正确性回归。
