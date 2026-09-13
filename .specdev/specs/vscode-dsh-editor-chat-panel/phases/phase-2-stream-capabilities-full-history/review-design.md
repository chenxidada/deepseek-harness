# Design Consistency Review — phase-2-stream-capabilities-full-history

> Re-review after Q-6 Tab right-click delete loop（prior: PASS；本回路补齐顶栏右键入口）

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-ECP-6** 删除统一后端 + **单一 webview modal** | 是 | 三入口均 `openDeleteConfirm` → 唯一 `DeleteConfirmModal`（文案含「不可恢复」）→ `ui/delete-request` → `requestDeleteConfirmed` → `deleteSession({ confirmed: true })`；无 `showWarningMessage` 作唯一确认 | ✅ |
| **Q-6 = A / E16 / §7.9** 顶栏右键 **与** 溢出均 Must | 是 | Tab `onContextMenu` → `tab-context-menu` / `menu-tab-delete-session`（`source: 'tab-context'`）；溢出 `menu-delete-session`（`source: 'chrome'`）；历史仍 `source: 'history'` | ✅ |
| AD-ECP-6「关 Tab ≠ 删除」 | 是 | Tab `×` → `ui/tab-close`；删除仅经 modal 确认路径 | ✅ |
| AC-14b 溢出含删除 + Timeline | 是 | `overflow-menu`：`menu-delete-session` + `menu-open-timeline` | ✅ |
| AC-60 顶栏↔历史语义一致 | 是 | 同一 modal / intent / Host 后端；`DeleteConfirmState.source` 仅作呈现溯源 | ✅ |
| AD-ECP-2 单 Panel 内顶栏 Tab | 是 | 右键菜单挂在 `tab-item` 旁，非原生 VS Code editor tab 菜单 | ✅ |
| AD-ECP-9 / MessageBridge 薄适配 | 是 | Webview 只发 `ui/delete-request{sessionId}`；Host 裁定删除 | ✅ |
| panel/tabs 携带可删 `sessionId` | 是 | `protocol.ts` + `pushTabsFrame` 推送每 Tab `sessionId`；store 解析进 `TabChromeItem`（右键可删非活动 Tab） | ✅ |
| ui-visual-spec 中等密度 / 菜单气质 | 是 | 右键菜单与溢出共用 `.dsh-menu-item`（8×10 padding、hover list）；壳层同 `minWidth:160` / border / shadow / padding:4；互斥开关（开一方关另一方）；`openDeleteConfirm` 顺带 `overflowOpen:false` | ✅ |
| AD-ECP-7 / 8 / 10 / 11 | 是（本回路未回退） | Timeline 仍在溢出；SPA 主路径；RTL 覆盖 contextmenu→modal；retain 未改 | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新文件 / 改动 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `TabChrome.tsx`（contextmenu + 菜单） | `webview/src/components/` | ✅ | 顶栏交互归属 chrome 组件；未另起 Host 原生菜单 |
| `chat-ui-store.ts`（`source: 'tab-context'`） | `webview/src/store/` | ✅ | 呈现态溯源枚举扩展，非第二套删除权威 |
| `protocol.ts` / `chat-panel-host.ts`（tabs.sessionId） | `src/chat-panel/` | ✅ | Host 决策投影补字段，符合 Bridge 单向下行 |
| `DeleteConfirmModal.tsx` | `components/` | ✅ | AD-ECP-6 确认 UI 仍唯一归属 webview |
| RTL `editor-chat-phase2.spec.tsx` | `tests/layer-a-rtl/` | ✅ | 层 A 可断言确认框 DOM（design 选型理由） |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| Context menu 容器 | `data-testid="tab-context-menu"` | 可扩展 DOM 契约 | ✅ |
| 右键删除项 | `menu-tab-delete-session` | 与溢出 `menu-delete-session` 区分入口、同语义 | ✅ |
| source 枚举 | `'chrome' \| 'tab-context' \| 'history'` | 注释与 Q-6 三入口对齐 | ✅ |
| Intent | `ui/delete-request` | design ChromeIntent | ✅ |
| 协议字段 | `panel/tabs.tabs[].sessionId` | Registry 身份；右键目标正确性 | ✅ |

### Constitution §2 / §7 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 模块单一 | ✅ | Modal 只确认；TabChrome 只开确认；Host 只执行 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | Host 不 import React；webview 不直调 `deleteSession` |
| §2.3 接口隔离 | 经 protocol / Bridge | ✅ | 删除仅 `ui/delete-request` |
| §7.7 全文无 Should；低频能力 Must | 删除 Must | ✅ | 右键不再缺席 |
| §7.9 删除一致 | 右键+溢出+历史同确认/后端 | ✅ | 本回路关闭先前「仅溢出」缺口 |

## Q-6 / AD-ECP-6 路径对照（本回路焦点）

```
[右键] Tab contextmenu
  → tab-context-menu / menu-tab-delete-session
  → openDeleteConfirm({ source: 'tab-context', sessionId })
        │
[溢出] menu-delete-session
  → openDeleteConfirm({ source: 'chrome', … })
        │
[历史] btn-history-delete
  → openDeleteConfirm({ source: 'history', … })
        ▼
  DeleteConfirmModal（唯一确认 UI）
  → ui/delete-request { sessionId }
  → requestDeleteConfirmed → deleteSession({ confirmed: true })
```

无第二条确认栈；原生 dialog 未替代 webview modal。

## 关键发现

### 🔴 Must-Fix
（无）— 未发现违反 AD-ECP-6、Q-6 双入口、Constitution §2/§7.9，或把确认挪出 webview modal 的架构漂移。

### 🟡 Should-Fix
（无）— 右键菜单与溢出菜单视觉密度一致（共享 `.dsh-menu-item` + 同壳样式）；单条目右键菜单未形成「演示按钮墙」；关 Tab 与删除路径分离正确。

### 🟢 Observations
- 右键 / 溢出菜单壳层仍各写一份 inline 定位样式；密度已由共享 class 保证，后续可抽小组件减重复（非本回路债务）。
- Tab 在缺 `sessionId` 时回退 `activeSessionId`：Host 已推送每 Tab `sessionId`，回退仅为防御；非活动 Tab 正常路径不再依赖活动会话。
- Host 仍保留 `action/delete` → `requestDelete`（可含原生确认）旧通道；本 feature React 主路径不走该 intent，不破坏 AD-ECP-6「webview modal 为契约确认」决议。
- 上轮 Observation「Tab 右键未做」已由本回路关闭（GAP-ECP-008 → 已解决）。

## 详细报告
- Spec: `phases/phase-2-stream-capabilities-full-history/spec.md`
- Implementation: `phases/phase-2-stream-capabilities-full-history/implementation.md`（Q-6 Tab 右键回路）
- Prior: `.archive/review-design-20260913T152425Z.md`
- Design: `design.md` AD-ECP-6 / Q-6 / VP-6
- UI: `ui-visual-spec.md` §3 chrome / P4 密度；历史 §5.5 不约束顶栏右键形态
