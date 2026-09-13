# Design Consistency Review — phase-1-foundation-render-probe

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CUX-1** 修订 AD-CU-1：呈现态可下放 + 强制探针；决策态留 Host | 是 | `probes.ts` 呈现探针 + `mirrorHostDecisions`；`syncComposerDisabled` 只消费 Host `mode`/`connectionPhase`；`protocol.ts` `panel/state.probes?`；provider/host/README 注释已改「允许呈现态」 | ✅ |
| AD-CUX-1：`parentReadonly`/`continueSealed` 为 Host 镜像只读 | 是 | 仅 `mirrorHostDecisions` 写入；层 B smoke 验证协议位；无 Webview 本地发明路径 | ✅ |
| AD-CUX-1：无 optimistic 时禁止造假探针 | 是 | `ChatUxProbes` 无 `optimistic`；层 A 断言 `'optimistic' in snapshot === false`；implementation 文档化「本 Phase 无 optimistic」 | ✅ |
| **AD-CUX-2** 层 A = 抽离 `render/sync` + jsdom；禁止整页 `dangerously` 作主路径；禁止仅 `toContain` | 基本是 | `tests/layer-a/*.spec.ts` `@vitest-environment jsdom` + `import` `chat-panel/render/*`；主断言用 `querySelector`/`getAttribute`；无 `runScripts:'dangerously'` 主路径。产品侧通过 `*BrowserSource()` 嵌入（设计允许「同步源」） | ⚠️ |
| AD-CUX-2：provider 改为调用/内联抽离模块 | 部分 | 已嵌入并调用 `applyFollowState` / `applyMessageIdentity` / `applyStreamingStatus` / `syncComposerDisabled`；但 HTML 在嵌入 `messageDomBrowserSource()` **之后又本地重定义 `escapeHtml`**，阴影掉抽离副本 | 🟡 偏离 |
| **AD-CUX-4** `decideFollowState` 纯函数 + `data-follow-state` | 是 | `follow-state.ts` 算法与 design 骨架一致；chassis `data-follow-state`；完整跟滚接线属 phase-2（spec Out / design 允许） | ✅ |
| AD-CUX-4 / phase-1：完整 scroll listener / chunk 可不做 | 是 | 偏差 2 记录；仅骨架 | ✅ |
| 抽离目录 `chat-panel/render/{follow-state,message-dom,sync-chrome}` + `probes.ts` | 是 | 与 design「实现方案」示意一致；`activity-dom`/`ref-cards`/`change-diff-dom` 正确推迟 | ✅ |
| change-list 完整抽离 | 否（有意） | 仍内联于 provider；**DEBT-CUX-001** → phase-4；exploration R3 / spec 产出「等」允许最小文本契约 | ✅（登记债） |
| 宪法 **§7.1** 层 A 抽离进 Must | 是 | layer-a 套件为 Must 入口 | ✅ |
| 宪法 **§7.2** 决策/呈现边界 + 探针 | 是 | 见 AD-CUX-1 行 | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `render/follow-state.ts` | `chat-panel/render/` | ✅ | 对标 design 抽离表 |
| `render/message-dom.ts` | `chat-panel/render/` | ✅ | 文本气泡 + `patchMessageDom` 骨架 |
| `render/sync-chrome.ts` | `chat-panel/render/` | ✅ | streaming / composer / theme |
| `render/index.ts` | `chat-panel/render/` | ✅ | barrel |
| `probes.ts` | `chat-panel/` | ✅ | design 明示 sibling |
| `tests/layer-a/*.spec.ts` | `apps/vscode-dsh/tests/layer-a/` | ✅ | design 指定路径 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 模块文件 | kebab-case `follow-state.ts` 等 | 与 `composer-keydown.ts` / design 一致 | ✅ |
| design 示意 `renderBubble` | `renderTextBubble` | Phase-1 文本切片命名；语义清晰 | ✅ |
| design 示意 `syncChrome` | 拆为 `applyStreamingStatus` / `syncComposerDisabled` / … | 更细粒度，职责更清 | ✅ |
| `ChatUxProbes.expanded` | 顶层 `expanded` | design 模型把展开放在 `activity` 内；Phase-1 无 activity 时顶层座位合理（AC-3 展开态） | ✅ |
| Webview 探针全局 | `window.__dshProbes` | design 允许 `dsh.test.*` **或** DOM 契约；额外全局可接受 | ✅ |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 各 render 模块一事 | ✅ | follow / message-dom / sync-chrome / probes 边界清晰 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | `sync-chrome` → `probes`/`follow-state` 为同层 chat-panel 协作；无反向依赖 Host |
| §2.3 接口隔离 | 明确 API | ✅ | 导出函数 + `ChatUxProbeStore`；Host 决策经 protocol 帧 |

## 关键发现

### 🔴 Must-Fix
（无）— 未发现违反 AD-CUX-1/2/4 或宪法 §7 / §2 的硬性架构决策破坏。

### 🟡 Should-Fix
- **产品 HTML 阴影抽离的 `escapeHtml`（AD-CUX-2 同步源一致性）**  
  `buildThinChatHtml` 已注入 `messageDomBrowserSource()`（内含 `escapeHtml`），随即又本地 `function escapeHtml(...)` 重定义（`chat-panel-provider.ts` ~L584），注释写「Prefer extracted…」但实际未调用嵌入版本。算法虽相同，却留下死嵌入副本 + 双维护点，削弱「同步源 / 调用抽离模块」意图。  
  **建议**：删除本地重定义，直接使用嵌入的 `escapeHtml`；或若必须保留包装，改为薄委托调用已嵌入函数。

### 🟢 Observations
- **DEBT-CUX-001 / GAP-CUX-001 / GAP-CUX-002** 已正确登记为 🟡 非阻塞，与 design Phase 边界一致；审查不重复判为缺陷。
- `decideFollowState` 已嵌入 HTML 但产品路径尚未接线（仅初始 `applyFollowState(..., 'off')`）— 符合 spec Out / AD-CUX-4「完整跟滚可在 phase-2」。
- `applyThemeKind`：TS 签名接受 `body` 参数，browser source 写死 `document.body` — 测试可注入性更好，产品侧合理；属可接受的双路径签名差。
- 层 A 个别断言使用 `textContent.toContain` / HTML `toContain` 做辅助检查，主路径仍为真实 DOM 属性断言，**不**构成「仅 toContain」违规。
- Provider 内联仍保留完整 `renderBubble`（含 change-list）与 `renderMessages`/`appendMessage` 列表循环 — 与 exploration 推荐切片 + DEBT-CUX-001 一致，不要求本 Phase 整页抽空。

## 详细对照摘要（本 Phase 焦点）

| 焦点 | 结论 |
|------|------|
| AD-CUX-1 / 修订 AD-CU-1 | 遵循：呈现态 + 探针；决策态 Host |
| AD-CUX-2 抽离而非整页 runScripts | 遵循（层 A 主入口）；产品 `escapeHtml` 阴影为 SHOULD-FIX |
| 层 A 基建位置 | `chat-panel/render/*` + `probes.ts` + `tests/layer-a/` 对齐 design |
| 已知推迟债 | registry 齐全，无未登记架构缺口 |
