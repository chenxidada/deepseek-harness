# 正确性审查 — phase-2-stream-capabilities-full-history

> 用户强制要求 Q-6 Tab 右键删除后的重审（旧稿已归档：`.archive/review-correctness-20260913T152425Z.md`）

## 视角
**实现正确性** — 代码是否真正工作

## 判决
**SHOULD-FIX**

## Q-6 / AC-13c 焦点复核

| 检查项 | 复核 | 证据 |
|--------|:--:|------|
| Tab `contextmenu` 删除入口存在 | ✅ | `TabChrome.tsx`：`onContextMenu` → `tab-context-menu` / `menu-tab-delete-session`「删除会话」 |
| 与溢出共用 modal / `ui/delete-request` | ✅ | 右键 `source: 'tab-context'`；溢出 `source: 'chrome'`；均经 `DeleteConfirmModal` → `ui/delete-request` → `deleteSession({ confirmed: true })` |
| 可删非活动 Tab | ✅（代码） | 每 Tab 用 `tab.sessionId`；Host `pushTabsFrame` 推送；不依赖活动会话 |
| 不静默删除 | ✅ | 仅打开 modal；取消无 emit；RTL 有 cancel 断言 |
| 关 Tab ≠ 删除 | ✅ | `ui/tab-close` 与删除分流 |
| RTL 证据 | ⚠️ | 活动 Tab 全路径有测；**缺双 Tab 非活动右键用例** |

独立复跑：5 个测试文件 / 34 用例全部通过。

## 逐条 AC 验证

| AC | 判定 | 摘要 |
|----|:--:|------|
| AC-13c | ✅ | 右键 + 溢出均可；「不可恢复」；同后端；非静默 |
| AC-14a / AC-60 | ✅ | 溢出 / 右键 / 历史 三入口同源 modal + intent |
| AC-14b / AC-44 | ✅ | 溢出含删除 + Timeline |
| AC-20…39（本回路未改功能） | ✅ | 先验 PASS / 已修 MUST-FIX 保持 |
| AC-40 / 41 / 42 | ⚠️ | 层 V 无 DISPLAY，诚实不伪 PASS |
| AC-53–57 / 59 | ✅ | 历史路径回归仍绿 |
| UI-AC / DOM / 内联退役 | ✅ | 未回退 |

## 桩检测

- 活跃债务：无
- GAP-ECP-008（Q-6 右键缺口）：已关闭且代码核实
- 新未注册桩：无

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
1. **补非活动 Tab 右键删除 RTL**：双 Tab 场景右键非活动 → modal → `ui/delete-request` 带非活动 `sessionId`；取消仍不 emit。

### 🟢 观察
- 缺 `sessionId` 时不弹菜单，防盲删，不等于静默删除。
- 溢出与右键菜单互斥关闭。
- 溢出 / 历史删除回归 34 测全绿。
