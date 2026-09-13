# Correctness Review — phase-2-stream-capabilities-full-history

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**MUST-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-13c | 顶栏删除确认不可恢复 + 同步 | `DeleteConfirmModal.tsx` + `extension.ts:runDeleteConfirmed` + `TabChrome` 溢出 | ⚠️ | 溢出菜单 → modal → `ui/delete-request` → `deleteSession({confirmed:true})` 真实路径完整；**无 Tab 右键菜单**（AC-13c 正文为「或」，溢出可触发；Q-6 要求右键**与**溢出并存 → 见 Should-Fix） |
| AC-14a | 顶栏删除与历史一致 | 共用 `DeleteConfirmModal` / `ui/delete-request` | ✅ | chrome `source:'chrome'` 与 history `source:'history'` 同 modal、同 intent、同 Host 后端 |
| AC-14b | 溢出含删除 + Timeline | `TabChrome.tsx` `menu-delete-session` / `menu-open-timeline` | ✅ | 菜单项真实 `onClick` 发 intent |
| AC-20 | user/assistant 可区分 | `MessageList.tsx` `data-role` + CSS classes | ✅ | `dsh-msg-user` / `dsh-msg-assistant`；对齐/背景不同 |
| AC-20a | replay 只读禁发送 | `Composer.tsx` + `App.tsx` `disabledReason` + Host reject | ✅ | `mode=replay` → `composerState=readonly`；input disabled；Continue CTA |
| AC-20b | 空态/loading | `MessageList.tsx` `messages-empty` / `messages-loading` | ✅ | 分支有真实文案节点 |
| AC-21 | settle 可读 Markdown | `MessageList.SettledMarkdown` → `renderSafeMarkdown` | ✅ | settle 后 `msg-md` + `dangerouslySetInnerHTML` 用 sanitize 输出 |
| AC-21a | sanitize；代码块可读 | `safe-markdown.ts` + code copy 注入 | ✅ | script 被转义；`btn-copy-code` 注入 pre 旁 |
| AC-22 | streaming 指示；无 thinking | `data-streaming` + status「生成中…」；无 thinking UI | ✅ | streaming 气泡纯文本；status/set generating 驱动 |
| AC-23 | cancel 半截+已停止 | `msg-incomplete` + Host cancel→patch | ✅ | incomplete 文案「已停止 / 未完成」；`btn-stop`→`action/stop` |
| AC-23a | 失败/断连可理解提示 | `ui/reject-send` / `deriveStatusText` / `composerReason` | ✅ | reject-send 映射可读文案；error/waiting 有原因位 |
| AC-24 | 跟滚可探针 | `App.tsx` `data-follow-state` + store `followState` | ❌ | 根属性恒为初始 `'off'`；**无 scroll 监听、无 `decideFollowState`、无 resume**；探针只读死值，不满足「提供跟滚」 |
| AC-25 | 流式错误 fail-closed | `status/set` idle/disconnected → `streaming:false` | ✅ | 清除 streaming + stopping |
| AC-30/30a | 活动折叠+展开 | `ActivityRow` | ✅ | toggle 本地 expanded + `action/toggle-activity`；展开体有 tool/callId/status |
| AC-31/31a | 引用卡+插入入口 | `UserBody` `ref-card` → `action/open-reference` | ✅ | `@path` 抽取后可点 |
| AC-32/32a | 变更+审阅/撤销 | `ChangeListBubble` open/native-diff/revert | ✅ | 真实 intent，非空壳 |
| AC-33/33a/33b | composer 四态；禁用有因；停止中 | `Composer.tsx` + store derive | ✅ | 仅四态；Stop；停止中 `btn-stop[disabled]` +「正在停止…」且非第五态 |
| AC-34 | 重试/编辑 → fork+P | Host `requestRetry`/`requestEditResend` 已接线；UI 仅 `btn-retry`（incomplete） | ⚠️ | Host fork 逻辑真实；**编辑入口缺失** → 编辑路径无法从 UI 触发 |
| AC-34a | 重试/编辑/分叉入口可见 | `MessageList` 仅 incomplete 显示重试 | ❌ | **无编辑 UI**；**无显式分叉/branch UI**；不满足「消息/回合上下文可见」 |
| AC-34b | 父子可区分 | `fork-parent-banner` + `history-parent` | ✅ | Host `forkParentTitle` / `parentTitle` 投影后展示「分支自 …」 |
| AC-35 | 显式分叉 | Host `requestBranch` 已接线；React **无入口** | ❌ | bridge 有 `action/branch` 类型，**无任何组件 emit** |
| AC-36/36a | 复制可达 | `btn-copy` / `btn-copy-code` | ✅ | emit `action/copy-message` / `action/copy-code` |
| AC-37/37a | 搜索路径；不档3；只读去重 | `search-panel` + `open-search-hit`；tiers 过滤 1\|2 | ✅ | 不发 `ui/search-open` QuickPick；matchTiers 仅 1/2 |
| AC-38/38a/38b | 档1+2 + Continue 可区分 | search-panel + `btn-continue` + capability | ✅ | Continue ≠ fork；replay CTA + history Continue |
| AC-40 | 层 A+B+≥1 层 V | RTL + host spec + checklist | ⚠️ | A/B 有证据；层 V 环境无 DISPLAY（诚实 checklist，非伪 PASS） |
| AC-41 | 层 V 清单项 | `layer-v-checklist.md` | ⚠️ | checklist 已交付；人眼未跑 |
| AC-42 | 无层 V 不得 PASS | 环境阻断 | ⚠️ | 实现未伪造 V PASS（符合 GAP-007）；整 Phase 验证不得 PASS |
| AC-44 | Timeline 弱化；溢出可开 | `ui/open-timeline` → `workbench.view.extension.dsh` | ✅ | 可打开活动栏容器（偏差已记） |
| AC-45 | 无 Should | N/A（需求约束） | ✅ | 本 Phase 未以 Should 跳过功能（缺口记为 Must-Fix） |
| AC-53 | 历史打开只读 | history-select → Host openFromHistory；composer readonly | ✅ | App `readonly={mode==='replay'}` |
| AC-54 | Continue 可见；same-id | history `btn-continue` + pendingContinue → `action/continue` | ✅ | `setPendingContinue` + chrome enabled 后 auto continue；Host `continueConversation` |
| AC-55 | 历史删除确认+同步 | modal + `runDeleteConfirmed` + pushFullState | ✅ | 确认文案含「不可恢复」 |
| AC-56 | 历史搜索档1+2 | `history-search` 本地过滤 + `action/search-sessions` | ✅ | path/`@` → path 档；否则 text；非档3 |
| AC-57 | fork 父子可见 | `history-parent` + ExtensionIndex `parentTitle` | ✅ | 投影有真实逻辑 |
| AC-59 | 历史实时更新 | `registry.onChange` → `pushFullState` → `pushHistoryFrame` | ✅ | historyOpen 时刷新 rows |
| AC-60 | 顶栏↔历史删除语义一致 | 单 modal + 单 `deleteSession({confirmed:true})` | ✅ | 两入口同确认策略与后端 |
| UI-AC-20…32 | 层级/composer/指示 | tokens + 组件 | ✅ | 角色/活动弱化/sticky composer/四态可辨（DOM） |
| UI-AC-40/42/43 | 历史行/Continue/父子 | `HistoryPanel` | ✅ | 标题/时间/预览 + Continue/删除 + 分支自 |
| UI-AC-50–52 | focus/hover/reduced-motion/≥8px | `tokens.css` | ✅ | focus-visible、prefers-reduced-motion、space ladder |
| UI-AC-60–62 | 设计绑定/禁换皮 | tokens + checklist | ✅ | 无霓虹/玻璃炫技路径 |
| AD-ECP-10-P2 DOM | activity/ref/change/copy/continue/stop/follow-state | 组件 testids | ⚠️ | 契约节点大多存在；`data-follow-state` 无行为 |
| 内联退役 | `buildThinChatHtml` 退出主路径 | `editor-chat-panel.ts` SPA；provider JSDoc fixture-only | ✅ | 生产 Panel 仅 `buildEditorChatSpaHtml` |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | 活跃表为空；GAP-ECP-001…007 / DEBT-ECP-001 标「已解决」 |

### 已解决项复核
| ID | 复核 | 说明 |
|----|:--:|------|
| GAP-ECP-001 | ✅ | 四态 + disabled-reason + Continue |
| GAP-ECP-002 | ✅ | btn-stop + 停止中 R7 |
| GAP-ECP-003 | ✅ | 面板内 search-panel（非 QuickPick） |
| GAP-ECP-004 | ✅ | Continue / delete modal / parentTitle |
| GAP-ECP-005 | ✅ | MD settle + sanitize + copy |
| GAP-ECP-006 | ✅ | tokens focus/reduced-motion/≥8px |
| DEBT-ECP-001 | ✅ | 生产 SPA；thin HTML fixture-only |
| GAP-ECP-007 | ✅ | checklist + 诚实不伪 PASS |

### 新发现的未注册桩 / 功能空洞
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| `webview/src/store/chat-ui-store.ts` `followState` 恒 `'off'`；`MessageList`/`App` 无 scroll 接线 | `data-follow-state` 死属性，无跟滚逻辑 | 🔴 MUST-FIX | 移植 `decideFollowState` + scroll/atBottom/resume；探针可读真实状态 |
| `MessageList.tsx` 无 edit / branch 按钮；仅 incomplete 有 `btn-retry` | Host `requestEditResend`/`requestBranch` 可达但 UI 不 emit | 🔴 MUST-FIX | 消息/回合上下文补「编辑重发」「分叉」入口（AC-34a/35） |
| `chat-ui-store.ts` `messages/patch`：`streaming: frame.streaming === true` | Host 省略 `streaming` 时会把气泡 streaming 清成 false | 🟡 SHOULD-FIX | 仅在 `streaming !== undefined` 时覆盖；防 activityStatus 等补丁误清 |

## 关键发现

### 🔴 Must-Fix
1. **AC-24 跟滚未实现**：React 路径只有静态 `data-follow-state="off"`，未接 `decideFollowState`、无滚动接管/恢复。层 A 仅断言属性「truthy」，掩盖行为空洞。
2. **AC-34a / AC-35 分叉与编辑入口缺失**：Host 已实现 `requestRetry` / `requestEditResend` / `requestBranch`，但 Webview 仅在 incomplete 助手消息暴露「重试」；无编辑重发、无显式分叉按钮。能力在 Host 侧「假可达」、产品面不可发现。

### 🟡 Should-Fix
1. **Tab 右键删除菜单缺失**（Q-6「右键与溢出」）：当前仅溢出菜单，AC-13c 字面「或」可通过，但与 Q-6 双入口不一致。
2. **`messages/patch` streaming 字段省略时误清气泡 streaming**（见上）。
3. **搜索 loading 标志**：输入搜索未置 `searchLoading=true`，loading 指示几乎不可见。
4. **Retry 仅 incomplete**：settled 失败/完整回合无重试入口，可能弱化 AC-34a「重试可见」。

### 🟢 Observations
- 删除 AC-60 单路径实现扎实：webview modal → `ui/delete-request` → `runDeleteConfirmed` → `deleteSession({confirmed:true})`，无二次原生确认。
- Composer 四态 + 停止中 R7、MD sanitize、活动/引用/变更 DOM、历史 Continue/父子/档1+2、内联退役，函数体均为真实逻辑。
- 独立复跑：`pnpm exec vitest run apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx apps/vscode-dsh/tests/phase2-history-delete-host.spec.ts` → **10 passed**（不替代上述缺口）。

## 反狡辩自检
| 借口 | 拒绝理由 |
|------|---------|
| 「`data-follow-state` 存在且测试通过」 | 属性死值 ≠ 跟滚行为；AC-24 要求提供跟滚 |
| 「Host 已有 branch/edit」 | 签名/Host 接线 ≠ UI 可触发；AC-34a 要求上下文可见入口 |
| 「层 V 无 DISPLAY 所以整体先过」 | 本判决基于代码正确性；AC-24/34a/35 与 DISPLAY 无关 |
