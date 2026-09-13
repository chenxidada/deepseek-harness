# Correctness Review — phase-2-stream-capabilities-full-history

> Re-review after user-required Q-6 Tab right-click delete（prior archived: `.archive/review-correctness-20260913T152425Z.md`）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## Q-6 / AC-13c 焦点复核

| 检查项 | 复核 | 证据 |
|--------|:--:|------|
| Tab `contextmenu` 删除入口存在 | ✅ | `TabChrome.tsx`：`onContextMenu` → `tab-context-menu` / `menu-tab-delete-session`「删除会话」 |
| 与溢出共用 modal / `ui/delete-request` | ✅ | 右键 `openDeleteConfirm({ source: 'tab-context' })`；溢出 `source: 'chrome'`；均经 `DeleteConfirmModal` → `ui/delete-request`；Host `requestDeleteConfirmed` → `deleteSession({ confirmed: true })` |
| 可删非活动 Tab | ✅（代码） | 每 Tab `deleteSessionId = tab.sessionId ?? (active ? activeSessionId)`；`pushTabsFrame` 推送每 Tab `sessionId`；非活动走 `tab.sessionId`，不依赖 `activeSessionId` |
| 不静默删除 | ✅ | 菜单只打开 modal；取消 `btn-delete-cancel` → `closeDeleteConfirm` 无 emit；RTL 断言 cancel 后无 `ui/delete-request` |
| 关 Tab ≠ 删除 | ✅ | `tab-close` → `ui/tab-close`；删除另路径 |
| RTL 证据 | ⚠️ | 有活动 Tab：contextmenu → menu → modal「不可恢复」→ cancel 无 emit / confirm 发 `ui/delete-request`；**缺双 Tab 非活动右键删除用例** |

独立复跑：

```text
pnpm exec vitest run
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx
  apps/vscode-dsh/tests/phase2-history-delete-host.spec.ts
  apps/vscode-dsh/tests/verifier-phase2/layer-a-rtl.spec.tsx
  apps/vscode-dsh/tests/verifier-phase2/layer-b-host.spec.ts
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx
# Test Files  5 passed (5) / Tests  34 passed (34)
```

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-13c | 顶栏右键/溢出删除 | `TabChrome.tsx` + `DeleteConfirmModal.tsx` | ✅ | 右键与溢出均可触发；文案「不可恢复」；同 Host 删除后端；非静默 |
| AC-14a | 顶栏删除与历史一致 | 共用 modal / intent | ✅ | chrome / tab-context / history → 同一 `DeleteConfirmModal` + `ui/delete-request` |
| AC-14b | 溢出含删除+Timeline | `menu-delete-session` / `menu-open-timeline` | ✅ | 真实 onClick；本回路未回退 |
| AC-20 | user/assistant 可区分 | `MessageList` | ✅ | 未触碰；先验 PASS 保持 |
| AC-20a | replay 只读 | `Composer` | ✅ | 先验 PASS |
| AC-20b | 空态/loading | MessageList | ✅ | 先验 PASS |
| AC-21 / 21a | settle MD + sanitize | `SettledMarkdown` | ✅ | 先验 PASS |
| AC-22 | streaming 指示 | MessageList | ✅ | 先验 PASS |
| AC-23 / 23a | cancel / 失败 | stop + reject-send | ✅ | 先验 PASS |
| AC-24 | 跟滚可探针 | `MessageList` + follow-state | ✅ | 先验 MUST-FIX 已修；本回路未触碰 |
| AC-25 | 流式错误 fail-closed | status/set | ✅ | 先验 PASS |
| AC-30–32a | 活动/引用/变更 | ActivityRow / UserBody / ChangeList | ✅ | 先验 PASS |
| AC-33–33b | composer 四态+停止中 | Composer | ✅ | 先验 PASS |
| AC-34–35 | 重试/编辑/分叉 | MessageActions | ✅ | 先验 MUST-FIX 已修 |
| AC-36–38b | 复制/搜索/Continue | chrome + search | ✅ | 先验 PASS；TabChrome 搜索路径仍真实 |
| AC-40 / 41 / 42 | 层 V | checklist | ⚠️ | A/B 有证据；无 DISPLAY 不伪 PASS（GAP-007） |
| AC-44 | Timeline 弱化 | overflow | ✅ | `ui/open-timeline` |
| AC-45 | 无 Should 跳过 | — | ✅ | Q-6 已以真实入口关闭，非 Should 掩盖 |
| AC-53–57 / 59 | 历史完整 | HistoryPanel + Host | ✅ | 先验 PASS；删除回归 RTL 仍绿 |
| AC-60 | 删除语义一致 | 单 modal + 单 deleteSession | ✅ | 三入口（溢出/右键/历史）同源 |
| UI-AC-* | 视觉契约 | tokens + 组件 | ✅ | 本回路未换皮回退 |
| AD-ECP-10-P2 / 内联退役 | DOM + SPA | SPA 主路径 | ✅ | 先验 PASS |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | 活跃表为空 |

### 已解决项复核
| ID | 复核 | 说明 |
|----|:--:|------|
| GAP-ECP-001…007 / DEBT-ECP-001 | ✅ | 本回路未回退 |
| GAP-ECP-008 | ✅ | Q-6 右键缺口已关闭：contextmenu → modal → `ui/delete-request`；Host `panel/tabs.sessionId` |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无 |

## 关键发现

### 🔴 Must-Fix
*（无）* — Q-6 双入口与 AC-13c 确认/不可恢复/非静默删除路径均为真实逻辑，非空壳。

### 🟡 Should-Fix
1. **非活动 Tab 右键删除缺 RTL**：实现上 `tab.sessionId` 已支持非活动删除（溢出仍只删 `activeSessionId`），但 `editor-chat-phase2.spec.tsx` 仅单 Tab 活动场景。建议补双 Tab：右键非活动 → modal → `ui/delete-request` 带非活动 `sessionId`，并确认取消仍不 emit。

### 🟢 Observations
- Host `pushTabsFrame` 契约已含每 Tab `sessionId`；store 解析可选 `sessionId`；缺 id 时右键不弹菜单（防盲删），非静默删除。
- 溢出与右键互斥：`contextmenu` 关 overflow；开 overflow 清 tab context menu。
- 回归：溢出删除、历史删除、cancel 不 emit、Host 解析 — 34 测全绿。

## 反狡辩自检
| 借口 | 拒绝理由 |
|------|---------|
| 「有 contextmenu 监听就算 Q-6」 | 已追到 `openDeleteConfirm` → modal「不可恢复」→ confirm 才 `ui/delete-request` |
| 「RTL 绿了就含非活动」 | 现测仅活动单 Tab；非活动靠静态路径证明，故降为 Should-Fix 而非宣称已测 |
| 「缺 sessionId 时不弹菜单是静默失败」 | 无 session 无法安全删；与「确认前不发 delete-request」不同 |
