# 正确性审查 — phase-2-stream-capabilities-full-history

> MUST-FIX 回路 #1 后复审（旧报告已归档：`.archive/review-correctness-20260913T150221Z.md`）

## 视角
**实现正确性** — 代码是否真正可工作

## 判决
**PASS**

## MUST-FIX 回路复核（本轮焦点）

| 原缺陷 | 复核 | 证据 |
|--------|:--:|------|
| AC-24 跟滚死属性 | ✅ 已修复 | `MessageList`：`onScroll` → `decideFollowState` → `setFollowState`；流开始贴底置 `'on'`；`btn-follow-resume` → `explicitResume`；根 `data-follow-state` 与探针随状态变化 |
| AC-34a 编辑/重试入口 | ✅ 已修复 | settled 用户：`btn-edit-resend` → 内联表单 → emit `action/edit-resend`；助手 settled/incomplete：`btn-retry` |
| AC-35 显式分叉 | ✅ 已修复 | 带 `turn` 的 settled 消息：`btn-branch` → emit `action/branch`；Host 仍接线 |

独立复跑层 A RTL：**13 passed**（含 follow / edit-resend / branch 行为断言）。

## 逐条 AC 验证

| AC | 判定 | 摘要 |
|----|:--:|------|
| AC-24 | ✅ | 真实滚动跟滚 + resume + 探针 |
| AC-34 / 34a | ✅ | 编辑重发与重试入口可见且 emit |
| AC-35 | ✅ | 分叉按钮 emit `action/branch` |
| AC-13c | ⚠️ | 溢出删除完整；无 Tab 右键（字面「或」已满足） |
| AC-14a/14b/20–23a/25–33/34b/36–38/44–45/53–60 | ✅ | 上轮已核实路径未回退；本回路 Should-Fix 补丁（patch streaming、历史搜索分流、菜单、pendingContinue）已落地 |
| AC-40/41/42 | ⚠️ | 层 V 无 DISPLAY，诚实不伪 PASS |
| AD-ECP-10 / 内联退役 | ✅ | follow 有行为；SPA 主路径 |

完整表格见英文版 `review-correctness.md`。

## 桩检测

- 活跃 registry：空
- 新未注册桩：**无**
- 上轮跟滚/编辑/分叉空洞：**已填实**

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
1. Tab 右键删除仍缺（Q-6）；不阻塞 AC-13c「或」。

### 🟢 Observations
- `messages/patch` 仅在 `streaming !== undefined` 时覆盖；搜索 loading、历史分流、⋮ 菜单、空态新建均有真实逻辑。
- 分叉门控依赖 `msg.turn`，与 Host 契约一致。

## 反狡辩
已读函数体并跑行为测试，不以「属性存在 / 测试绿」代替跟滚与 emit 路径验证。
