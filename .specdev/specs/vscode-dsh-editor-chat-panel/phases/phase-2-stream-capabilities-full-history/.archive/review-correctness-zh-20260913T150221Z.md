# 正确性审查 — phase-2-stream-capabilities-full-history

## 视角
**实现正确性** — 代码是否真正能工作

## 判决
**MUST-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-13c | 顶栏删除确认不可恢复 + 同步 | `DeleteConfirmModal.tsx` + `extension.ts:runDeleteConfirmed` + `TabChrome` 溢出 | ⚠️ | 溢出 → modal → `ui/delete-request` → `deleteSession({confirmed:true})` 路径完整；**无 Tab 右键菜单**（AC-13c 正文为「或」；Q-6 要求右键与溢出并存 → Should-Fix） |
| AC-14a | 顶栏删除与历史一致 | 共用 `DeleteConfirmModal` / `ui/delete-request` | ✅ | chrome / history 同 modal、同 intent、同后端 |
| AC-14b | 溢出含删除 + Timeline | `TabChrome.tsx` | ✅ | 菜单项真实发 intent |
| AC-20 | user/assistant 可区分 | `MessageList.tsx` | ✅ | `data-role` + 不同样式 |
| AC-20a | replay 只读禁发送 | `Composer` + `App` | ✅ | readonly + Continue CTA |
| AC-20b | 空态/loading | `messages-empty` / `messages-loading` | ✅ | 真实节点 |
| AC-21 | settle 可读 Markdown | `SettledMarkdown` → `renderSafeMarkdown` | ✅ | settle 后渲染 sanitize HTML |
| AC-21a | sanitize；代码块可读 | `safe-markdown` + code copy | ✅ | 无 script；代码块可复制 |
| AC-22 | streaming 指示；无 thinking | `data-streaming` +「生成中…」 | ✅ | 无 thinking UI |
| AC-23 | cancel 半截+已停止 | `msg-incomplete` + Stop | ✅ | 「已停止 / 未完成」+ `action/stop` |
| AC-23a | 失败/断连提示 | reject-send / status / composerReason | ✅ | 可读文案 |
| AC-24 | 跟滚可探针 | `data-follow-state` | ❌ | 恒为 `'off'`；无滚动/decideFollowState/resume |
| AC-25 | 流式错误 fail-closed | status idle/disconnected | ✅ | 清除 streaming |
| AC-30/30a | 活动折叠+展开 | `ActivityRow` | ✅ | toggle + 展开细节 |
| AC-31/31a | 引用卡 | `ref-card` | ✅ | 可点 open-reference |
| AC-32/32a | 变更审阅/撤销 | `ChangeListBubble` | ✅ | 真实 intent |
| AC-33/33a/33b | 四态+停止中 | `Composer` | ✅ | R7 非第五态 |
| AC-34 | 重试/编辑 → fork | Host 已接线；UI 仅 incomplete 重试 | ⚠️ | **编辑入口缺失** |
| AC-34a | 重试/编辑/分叉可见 | `MessageList` | ❌ | 无编辑、无显式分叉 UI |
| AC-34b | 父子可区分 | fork banner / history-parent | ✅ | 「分支自 …」 |
| AC-35 | 显式分叉 | Host 有、React 无入口 | ❌ | 无组件 emit `action/branch` |
| AC-36/36a | 复制 | btn-copy / btn-copy-code | ✅ | |
| AC-37/37a | 搜索；不档3 | search-panel | ✅ | tiers 仅 1/2 |
| AC-38/38a/38b | 档1+2 + Continue | search + Continue CTA | ✅ | |
| AC-40 | 层 A+B+V | RTL + host + checklist | ⚠️ | V 无 DISPLAY |
| AC-41 | 层 V 清单 | `layer-v-checklist.md` | ⚠️ | 已交付未人眼跑 |
| AC-42 | 无 V 不得 PASS | 环境 | ⚠️ | 未伪造 V PASS |
| AC-44 | Timeline 弱化 | open-timeline | ✅ | |
| AC-45 | 无 Should | — | ✅ | 缺口按 Must-Fix 记 |
| AC-53 | 历史只读 | replay + readonly | ✅ | |
| AC-54 | Continue same-id | pendingContinue | ✅ | |
| AC-55 | 历史删除 | modal + deleteConfirmed | ✅ | |
| AC-56 | 历史搜索档1+2 | history-search | ✅ | |
| AC-57 | 父子可见 | parentTitle | ✅ | |
| AC-59 | 历史实时更新 | registry.onChange→pushFullState | ✅ | |
| AC-60 | 删除语义一致 | 单路径 | ✅ | |
| UI-AC-* | 视觉/交互契约 | tokens + 组件 | ✅ | 含 focus / reduced-motion |
| AD-ECP-10-P2 | DOM 契约 | testids | ⚠️ | follow-state 无行为 |
| 内联退役 | thin HTML 退出主路径 | SPA only | ✅ | |

## 桩代码检测

### 已注册桩
活跃表为空；GAP-ECP-001…007 / DEBT-ECP-001 标已解决，抽查与代码一致。

### 新发现空洞
| 位置 | 行为 | 严重性 |
|------|------|:--:|
| `followState` 死值、无跟滚接线 | AC-24 不满足 | 🔴 |
| 无编辑/显式分叉 UI | AC-34a / AC-35 不满足 | 🔴 |
| `messages/patch` 省略 streaming 时误清 | 边界缺陷 | 🟡 |

## 关键发现

### 🔴 Must-Fix
1. **AC-24**：跟滚未实现，仅有死属性。
2. **AC-34a / AC-35**：编辑与显式分叉入口缺失（Host 已接线，UI 不可发现）。

### 🟡 Should-Fix
1. Tab 右键删除（对齐 Q-6）。
2. patch 时 streaming 字段省略误清。
3. 搜索 loading 未置位。
4. 重试仅限 incomplete 消息。

### 🟢 Observations
- AC-60 删除单路径、Composer 四态+停止中、MD sanitize、历史 Continue/父子/搜索、内联退役均为真实实现。
- 复跑相关 Vitest：10 passed（不掩盖上述缺口）。
