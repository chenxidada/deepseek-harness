# Correctness Review — Phase 4（Subagent 进入 / 钉 Tab / 父子已删导航）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

> 判定依据：**读 function body**（非仅签名），并交叉验证测试断言 + 独立验证脚本 V-IND-1~6（42 项断言全部 PASS）+ 11/11 vitest 用例通过。

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-35 | 父流 subagent 入口可进入子会话可读消息流 | `conversation-controller.ts:1758` `openSubagentContext` + `:2113` `ensureChildHydrated` + `:2163` `loadEvents` | ✅ | 进入时对非运行子调用 `ensureChildHydrated` → `loadEvents`（尊重 `eventOverrides`/`readSessionLog`）→ `hydrateFromAuthoritativeLog` → `messages.replace`。V-IND-1 断言 `messages/replace carries child hydrate`（`ca-vind1` 落地子消息） |
| AC-36 | 面包屑返回父 | `conversation-controller.ts:1803` `navBack` + `:2065` `buildBreadcrumb` | ✅ | `navBack` 清 `contextSessionId` 恢复父根（`outcome:'restored'`）；`buildBreadcrumb` 产出 `PanelBreadcrumb`。vitest 断言 `navBack()==={outcome:'restored'}` 且投影回到 `mode:'live'`/父 session |
| AC-37 | 进入默认不占 Tab | `conversation-controller.ts:1787`（仅 `setContextSessionId`） | ✅ | 默认路径只设 `contextSessionId`，不 `registry.create`。vitest 断言 `registry.list().length` 不变；V-IND-1 断言 `enter does not add Tab` |
| AC-38 | 可钉成 Tab | `conversation-controller.ts:1831` `pinSubagent` | ✅ | `registry.create(...)` 产独立 Tab + `setPinnedSubagent(true)` + `persistOpenTabs`。vitest 断言 `pinnedSubagent===true`；V-IND-1 断言 `openTabSet.pinnedSubagent=true` |
| AC-39 | 子进行中/结束卡片状态 | `conversation-controller.ts:1982` `onSubagentStarted` / `:2021` `onSubagentFinished` | ✅ | `subagentStatus` running↔ended 转换 + banner 进出；卡片文案随态切换。vitest 断言卡片 running→ended；`onSdkNotification` 路由 `subagent.started/finished` 亦有断言 |
| AC-40 | 子结束后进入只读回放，策略与父一致 | `conversation-controller.ts:1885` `resolvePanelProjection`（`run!=='running'`→`replay`）+ `:2085` `effectiveContinueMode` | ✅ | 已结束子投影 `mode:'replay'`；Continue chrome 走 `continueChromeForTab` 复用父策略。V-IND-3/6 断言 `panel/state.continue=enabled`（DEBT-007） |
| AC-71 | 运行中进入=只读实时；结束自动转回放 | `resolvePanelProjection`（`running`→`readonly-live`）+ `chat-panel-host.ts` `sendPrompt` reject + `:2060` `isProjectedSession` | ✅ | `sendPrompt` 对 `readonly-live` reject（vitest 断言 `{ok:false,reason:'readonly-live'}`）；`isProjectedSession` 保证子流式消息在子上下文仍推 webview（V-IND-5 断言 `messages/append` for child）；`onSubagentFinished` 后投影翻 `replay`（vitest 断言） |
| AC-74 | 子已删 → 父卡片「子会话已删除」不可进入 | `conversation-controller.ts:2094` `markSubagentCardDeleted` + `openSubagentContext:1763` | ✅ | `markSubagentCardDeleted` 用 `patchWhere` 改卡片 `subagentStatus:'deleted'`（无卡则 append）；`openSubagentContext` 对已删子返回 `outcome:'deleted'`。vitest + V-IND-2/6 断言卡片 copy「子会话已删除」+ 拒绝进入 |
| AC-75 | 父已删 → 子面包屑「父会话已删除」禁用返回 | `buildBreadcrumb:2065` + `navBack:1817` | ✅ | `buildBreadcrumb` 对父已删产出 `parentDeleted:true`+label「父会话已删除」；`navBack` 返回 `outcome:'disabled'`。vitest 断言 `breadcrumb.parentDeleted===true` + `navBack()==={outcome:'disabled'}` |
| AC-78 | 已钉后从父进入激活已有 Tab | `openSubagentContext:1769-1780` | ✅ | 对已钉子 `registry.getBySessionId` 命中 → 清父 context + `switchTo` 已有子 Tab，返回 `outcome:'activated-tab'`。vitest 断言 `outcome:'activated-tab'` 且 active=child |
| AC-79 | 钉定时处于子上下文 → 提升 Tab 并恢复父视图 | `pinSubagent:1855-1878` | ✅ | 先清 `contextSessionId` → `create` 子 Tab → `setPinnedSubagent` → `switchTo(parentTabId)` 恢复父为 active。vitest 断言父恢复 active 且 context 清空；V-IND-1 断言 `pin restores parent as active` |
| AC-54/84 | L2+L3（模拟 Webview）覆盖「进入子会话」 | `apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts`（11 用例，`FakeWebviewPort` 对接真实 `ChatPanelHost`+`ConversationController`）+ `.specdev/.../test-scripts/verifier-independent-phase4.mts`（V-IND-1~6） | ✅ | vitest 11/11 通过；V-IND-1~6 42 项断言 `failed=0`。协议帧 `nav/open-subagent`/`nav/back`/`action/pin-subagent` 均有真实路由断言 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
无。`tech-debt-registry.md` 活跃债务表为空；DEBT-007~013 已在本 Phase 重新真实成立（V-IND-3/6 覆盖 DEBT-007/008/009 的回归）。

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | — |

全库 grep：`apps/vscode-dsh/src/` 下无 `@STUB`、无 `as any`/`: any` 逃逸。所有核心方法均为真实函数体，无 `return Ok(0)` / `(void)args` 空壳。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **`buildBreadcrumb` 的 `parentDeleted` 字段名与语义轻微不符**（`conversation-controller.ts:2066-2077`）：当父会话**未打开**（非删除）时也置 `parentDeleted:true`（label 区分「父会话未打开」/「父会话已删除」）。行为正确（两种情况返回按钮都禁用，`navBack` 均返回 `disabled`），仅字段名 over-report，不影响 AC-75 验收。
- **`ensureChildHydrated` 静默吞所有读取异常**（`conversation-controller.ts:2120`，空 catch 带注释）：除「缺子日志」外也会吞掉 `readSessionLog` 超时等非常规错误，退化为空回放。符合「空 catch 须点名」约定，且属优雅降级，非正确性缺陷。
- **`extension.ts` 的 `requestNavBack` 接线丢弃 `navBack()` 返回值**：`disabled`/`noop` 结果不产生用户可见错误。因 Webview 侧面包屑在 `parentDeleted` 时已禁用返回按钮，该分支实际不会触发 `nav/back`，故无实际影响。
- **[文档保真] `implementation.md` 引用的 `test-scripts/verifier-independent-phase4.mts` 是 phase 目录下的独立验证脚本**，而非 App 的 Layer-V 运行时 smoke（`apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`，后者未含 VP-4-sub 场景）。符合 spec 的 L3 定义（fake Webview + 真实 Host，真实渲染属 L4「非达标门槛」），故不构成缺口；verifier 若需 Layer-V 覆盖可另行判断。

## 验证命令与结果

| 命令 | 结果 |
|------|------|
| `vitest run apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts` | 11/11 通过 |
| `tsx .specdev/.../test-scripts/verifier-independent-phase4.mts` | `done failed=0`（V-IND-1~6，42 项断言） |
| `tsc -p apps/vscode-dsh/tsconfig.json --noEmit` | exit 0（据 implementation.md，未独立复跑） |

## 结论

13 条 AC 均有真实代码路径满足（函数体非空壳），核心方法 `openSubagentContext`/`navBack`/`pinSubagent`/`markSubagentCardDeleted`/`resolvePanelProjection`/`isProjectedSession` 的边界（子已删/父已删/已钉/未水合/运行中/已结束）全部覆盖；`readonly-live` 发送门在 Host 侧（`sendPrompt` reject）与 Webview 侧（composer 派生 readonly）双重生效；`parseWebviewToHostMessage` 新分支 fail-closed；删除竞态经 `teardownDeletedSession` → `markSubagentCardDeleted` 正确处理。无未登记桩、无静默吞关键异常、无 `any` 逃逸。**PASS**。
