# Correctness Review — phase-2-stream-capabilities-full-history

> Re-review after MUST-FIX loop #1（prior archived: `.archive/review-correctness-20260913T150221Z.md`）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## MUST-FIX 回路复核（本轮焦点）

| 原缺陷 | 复核 | 证据 |
|--------|:--:|------|
| AC-24 跟滚死属性 | ✅ 已修复 | `MessageList`：`onScroll` → `decideFollowState` → `setFollowState`；流开始贴底置 `'on'`；`btn-follow-resume` → `explicitResume`；根 `data-follow-state` + `__dshProbes.getFollowState()` 随状态变 |
| AC-34a 编辑/重试入口 | ✅ 已修复 | settled 用户：`btn-edit-resend` → 内联表单 → emit `action/edit-resend { messageId, text }`；settled/incomplete 助手：`btn-retry` → `action/retry` |
| AC-35 显式分叉 | ✅ 已修复 | settled 且 `typeof msg.turn === 'number'`：`btn-branch` → emit `action/branch { turn }`；Host `chat-panel-host` / `extension.requestBranch` 仍接线 |

独立复跑：`pnpm exec vitest run …/editor-chat-phase2.spec.tsx …/phase2-history-delete-host.spec.ts` → **13 passed**（含 follow / edit-resend / branch 行为断言，非仅属性存在）。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-13c | 顶栏右键/溢出删除 | `TabChrome` 溢出 + `DeleteConfirmModal` | ⚠️ | 溢出→modal→`ui/delete-request`→`deleteSession({confirmed:true})` 完整；**仍无 Tab 右键**（字面「或」已满足；Q-6 双入口见 Should-Fix） |
| AC-14a | 顶栏删除与历史一致 | 共用 modal / intent | ✅ | chrome/history 同源确认与 Host 后端 |
| AC-14b | 溢出含删除+Timeline | `menu-delete-session` / `menu-open-timeline` | ✅ | 真实 onClick |
| AC-20 | user/assistant 可区分 | `MessageList` `data-role` + class | ✅ | `dsh-msg-user` / `dsh-msg-assistant` |
| AC-20a | replay 只读 | `Composer` + `readonly` | ✅ | replay → composer readonly；禁发送 |
| AC-20b | 空态/loading | `messages-empty` / `messages-loading` | ✅ | 真实分支节点 |
| AC-21 | settle Markdown | `SettledMarkdown` + `@dsh/safe-markdown` | ✅ | `renderSafeMarkdown` → `msg-md` |
| AC-21a | sanitize + 代码块 | safe-markdown + `btn-copy-code` | ✅ | script 转义；代码块旁复制 |
| AC-22 | streaming 指示 | `data-streaming` + status | ✅ | 流中纯文本；「生成中…」 |
| AC-23 | cancel 半截+已停止 | `msg-incomplete` + `btn-stop` | ✅ | 文案「已停止 / 未完成」 |
| AC-23a | 失败提示 | reject-send / statusText | ✅ | 可读原因位 |
| AC-24 | 跟滚可探针 | `MessageList.tsx` + `follow-state.ts` + store | ✅ | scroll 监听 + `decideFollowState` + resume；探针随动（见上表） |
| AC-25 | 流式错误 fail-closed | `status/set` idle/disconnected | ✅ | 清 streaming |
| AC-30/30a | 活动折叠 | `ActivityRow` | ✅ | toggle + 展开体字段 |
| AC-31/31a | 引用卡 | `UserBody` `ref-card` | ✅ | emit `action/open-reference` |
| AC-32/32a | 变更审阅/撤销 | `ChangeListBubble` | ✅ | open / native-diff / revert |
| AC-33/33a/33b | composer 四态+停止中 | `Composer` + store | ✅ | 仅四态；R7 停止中非第五态 |
| AC-34 | 重试/编辑 → fork | Host + UI emit | ✅ | UI 现可触发；Host `requestRetry`/`requestEditResend` 真实 |
| AC-34a | 入口可见 | `MessageActions` | ✅ | 编辑重发 / 重试（settled+incomplete）可见 |
| AC-34b | 父子可区分 | fork banner + history-parent | ✅ | 「分支自 …」 |
| AC-35 | 显式分叉 | `btn-branch` | ✅ | emit `action/branch`；依赖消息带 `turn`（与 Host 契约一致） |
| AC-36/36a | 复制 | `btn-copy` / `btn-copy-code` | ✅ | 真实 intent |
| AC-37/37a | 搜索路径；非档3 | search-panel | ✅ | tiers 1\|2；非 QuickPick 主路径 |
| AC-38/38a/38b | 档1+2 + Continue | search + continue chrome | ✅ | Continue ≠ fork |
| AC-40 | 层 A+B+≥1 V | RTL + host + checklist | ⚠️ | A/B 有证据；层 V 无 DISPLAY（诚实，非伪 PASS） |
| AC-41 | 层 V 清单 | `layer-v-checklist.md` | ⚠️ | 清单已交付；人眼未跑 |
| AC-42 | 无 V 不得 PASS | 环境阻断 | ⚠️ | 符合 GAP-007；整 Phase 验证不得宣称 V PASS |
| AC-44 | Timeline 弱化 | `ui/open-timeline` | ✅ | 溢出可开 |
| AC-45 | 无 Should 跳过 | — | ✅ | 功能缺口未用 Should 掩盖 |
| AC-53 | 历史打开只读 | history-select → replay | ✅ | composer readonly |
| AC-54 | Continue same-id | pendingContinue + auto continue | ✅ | chrome enabled 后 `action/continue`；disabled/hidden 清 sticky |
| AC-55 | 历史删除确认 | modal + deleteSession | ✅ | 「不可恢复」 |
| AC-56 | 历史搜索档1+2 | history query + `historySearchHits` | ✅ | `searchOrigin='history'` 分流，不强制顶栏 panel |
| AC-57 | fork 父子可见 | `history-parent` | ✅ | parentTitle 投影 |
| AC-59 | 历史实时更新 | registry → pushHistoryFrame | ✅ | 打开时刷新 |
| AC-60 | 删除语义一致 | 单 modal + 单 deleteSession | ✅ | 双入口同路径 |
| UI-AC-20…32 | 层级/composer | tokens + 组件 | ✅ | DOM/样式可辨 |
| UI-AC-40/42/43 | 历史行 | `HistoryPanel` ⋮ 菜单 | ✅ | Continue/删除入菜单；父子可读；空态 CTA |
| UI-AC-50–52 | focus/motion/间距 | `tokens.css` | ✅ | focus-visible / reduced-motion / ≥8px |
| UI-AC-60–62 | 禁换皮 | tokens | ✅ | 无霓虹/玻璃路径 |
| AD-ECP-10-P2 DOM | follow/activity/… | testids | ✅ | `data-follow-state` **有行为** |
| 内联退役 | SPA 主路径 | `buildEditorChatSpaHtml` | ✅ | thin HTML fixture-only |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | 活跃表为空 |

### 已解决项复核
| ID | 复核 | 说明 |
|----|:--:|------|
| GAP-ECP-001…007 / DEBT-ECP-001 | ✅ | 本回路未回退；跟滚/编辑/分叉空洞已填实 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无 |

## 关键发现

### 🔴 Must-Fix
*（无）* — 上轮三条 MUST-FIX 均已在函数体与 RTL 行为测试中核实，非橡皮图章。

### 🟡 Should-Fix
1. **Tab 右键删除菜单仍缺**（Q-6 双入口）：AC-13c「或」已被溢出路径满足；若要对齐 Q-6「右键与溢出并存」，仍需补 context menu（implementer 已记为可选，未登记为空壳桩）。

### 🟢 Observations
- 上轮 Should-Fix 中 **`messages/patch` 省略 `streaming` 误清** 已修：`frame.streaming !== undefined` 才覆盖气泡字段。
- **搜索 loading**：`TabChrome` 发起搜索时 `setSearchLoading(true)`。
- **历史搜索分流 / ⋮ 菜单 / 空态新建 / pendingContinue 清理**：均有真实逻辑。
- 编辑重发用内联表单而非 `prompt`：仍 emit 正确 intent，行为等价（偏差已记）。
- 分叉按钮门控 `msg.turn`：无 turn 则不展示——与 Host `requestBranch(turn)` 契约一致，非空壳。

## 反狡辩自检
| 借口 | 拒绝理由 |
|------|---------|
| 「测试绿了就算跟滚修好」 | 已读 `onScroll`/`decideFollowState`/`resumeFollow` 函数体，并确认 RTL 模拟滚离底部→`off`→resume→`on` |
| 「有 btn-edit-resend 就行」 | 确认确认按钮 emit `action/edit-resend` 带 `messageId`+`text`，非 noop |
| 「有 btn-branch 就行」 | 确认 emit `action/branch` 带 `turn`；Host host/extension 仍接线 |
