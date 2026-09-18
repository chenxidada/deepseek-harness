# Design Consistency Review — Phase 4（复审：SHOULD-FIX-1/2 闭合核验）

## 视角

**Design Consistency** — 代码是否遵循架构设计（本轮为续做复审，核验 2 条 SHOULD-FIX 是否闭合、有无新偏离）

## 判决

**PASS**

## 复审重点结论

### SHOULD-FIX-1（钉「运行中」子 Tab 口径分裂）— 已闭合 ✅

上一轮问题：`pinSubagent` 对运行中子会话建成 `mode='live'` 的可写 Tab，与上下文进入路径 `readonly-live`（只读）口径分裂。

本轮修复（投影层最小改动，reviewer-design 建议方案 a）：

```1911:1925:apps/vscode-dsh/src/conversation-controller.ts
    // A pinned running child Tab stays read-only live until it ends (AD-CU-11),
    // mirroring the in-panel context path — no writable live seam for a running child.
    const pinnedRunning = active.pinnedSubagent === true
      && this.childRunState.get(active.sessionId) === 'running'
    return {
      mode: pinnedRunning
        ? 'readonly-live'
        : active.mode === 'replay' ? 'replay' : 'live',
      sessionId: active.sessionId,
      tabId: active.tabId,
      messages: this.messages.get(active.sessionId),
      tabStatus: active.status,
      ...active.title === undefined ? {} : { title: active.title },
      ...breadcrumb === undefined ? {} : { breadcrumb },
    }
```

- 与上下文进入路径（`resolvePanelProjection` 上下文分支，`:1889-1902`）已统一：运行中 → `readonly-live`，结束 → `replay`。
- **「registry `mode` 保持 `'live'`，投影层 `readonly-live`」不是新字段语义分裂，而是 design.md 自有的双层模型**：
  - `PanelMode`（design.md:45）= `'live' | 'replay' | 'readonly-live' | 'waiting-host' | 'empty'` —— 投影/线协议层，`panel/state.mode` 用这一层；
  - `OpenTabRecord.mode`（design.md:99，代码 `OpenTabMode`，`extension-index.ts:10`）= `'live' | 'replay'` —— Tab 注册表/持久化层。
  - `readonly-live` 从设计起就只属于 `PanelMode`（投影层），从未属于 `OpenTabMode`。实现把它落在投影层、registry 维持 `'live'`，正是对该双层模型的忠实遵循。`OpenTabMode` 的 `'live'` 语义为「已连接的 live 会话」（钉住且运行的子 Tab 确实在流式接收），「只读」是投影层叠加的表现语义，语义分层自洽，无矛盾。
- 发送无缝隙：`sendPrompt` 以投影模式为准（`chat-panel-host.ts:697-703`），`readonly-live` → `reject('readonly-live')`；Webview `deriveComposerState` 只镜像 `panel/state.mode` 映射 `readonly`，双闸门，无「钉 Tab 可写」残留。
- 结束翻转闭环：`onSubagentFinished`（`:2027-2053`）registry `'live'` → `setMode('replay')` 且 `childRunState` 置 `'ended'`，`pinnedRunning` 变 false，投影由 `readonly-live` 翻转为 `replay`。
- 测试覆盖完整：`phase4-subagent-enter-pin.spec.ts:186-212` 断言「钉运行中子 Tab 投影 `readonly-live` → `sendPrompt` 拒绝 → `finished` 后翻 `replay` → 再拒为 `replay`」。

### SHOULD-FIX-2（删除 `TimelineStore.childrenOf()` 休眠 API）— 已闭合 ✅

- `childrenOf` 公开方法已删除；`apps/vscode-dsh` 下 grep `childrenOf` 零残留。
- 私有 `children` map 保留并仍被内部使用（`clearSession`/`linkChild`/`apply` 等，`:56/:233/:239/:243/:252/:354/:357/:360/:370/:383`），无悬空引用。
- `getParent`（`:223-225`）仍导出且有消费方，面包屑族谱路径不回归。

### 新引入的设计/约定偏离 — 无

- 修复只落在投影层 `resolvePanelProjection` + 一条测试，未新增模块/依赖边、未改依赖方向、未触碰 `OpenTabMode` / 注册表 / 索引 / Webview。
- 注释 `:1911-1912` 说明「no writable live seam」的约束理由，具体、非叙述性，符合 repo 注释约定。
- 命名 `pinnedRunning` 局部变量与判别标签风格一致。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CU-11 运行中只读实时 → 结束自动回放 | 是（修复后） | 上下文路径 `:1889-1902` 与钉 Tab 根分支 `:1911-1918` 均 running→`readonly-live`、ended→`replay`；`sendPrompt` 投影门禁 `:697-703` | ✅ |
| AD-CU-11 默认父面板上下文进入（不占 Tab） | 是 | `openSubagentContext` 只设 `contextSessionId`，不 mint Tab（`:1787`） | ✅ |
| AD-CU-11 Should 钉 Tab：已钉后从父进入激活已有（AC-78） | 是 | `pinSubagent`/`openSubagentContext` 先 `getBySessionId` 命中即 `switchTo`（`:1769-1780`、`:1841-1852`） | ✅ |
| AD-CU-5 同会话单 live / 单开按 sessionId | 是 | 钉 Tab 走 `getBySessionId` 去重，`create` 亦 enforce 单开 | ✅ |
| AD-CU-1 极薄前端：Host 决策 / Webview 只镜像 | 是 | `resolvePanelProjection` 在 Host；Webview 仅镜像 `panel/state`；发送兜底在 Host `sendPrompt` | ✅ |
| AD-CU-12 不修改 agent-loop / bridge 薄适配 | 是 | 改动全部落在 `apps/vscode-dsh`（src + webview + tests） | ✅ |

## 关键发现

### 🔴 Must-Fix

无。

### 🟡 Should-Fix

无。

### 🟢 Observations

1. **`tabStatus` 来源分层差异（非偏离）**：上下文分支 `tabStatus: run === 'running' ? 'running' : 'idle'`（`:1900`）从 `childRunState` 推导；钉 Tab 根分支 `tabStatus: active.status`（`:1922`）取 Tab 自身 status。二者分层自洽——上下文无 Tab 故由 `childRunState` 推导，钉 Tab 有 Tab 故用 `tab.status`（流式时由 `:2287-2290` 置 `running`、`session.status` 通知由 `:2613-2620` 同步）。表现语义一致，不构成设计偏离。

2. **`panel/tabs` 帧仍报 registry `mode`**：`pushTabsFrame`（`chat-panel-host.ts:511`）下发 `mode: tab.mode`（registry `OpenTabMode`），钉运行中子 Tab 的 Tab 栏为 `'live'`，而面板 `panel/state.mode` 为 `readonly-live`。这是 design.md 双层模型（`OpenTabMode` 无 `readonly-live`）的自然结果，不构成可写缝隙（发送门禁走投影模式，非 Tab 栏 mode）。若后续希望 Tab 栏也区分「只读 live」，需扩展 `OpenTabMode`——属 Could 级，不阻塞本 Phase。
