# Design Consistency Review — phase-1-shell-tabs-basic-history

> Re-review after Must-Fix loop #1 (`loop_count=1`). Prior report archived to `.archive/review-design-20260913T135603Z.md`.

## 视角
**Design Consistency** — 代码是否遵循架构设计 / UI 契约

## 判决
**PASS**

## 上轮 Should-Fix 落地核对

| # | 上轮条目 | 本轮证据 | 判定 |
|:-:|---------|----------|:--:|
| 1 | Status 布局 → Messages → Status → Composer（ui-visual-spec §3） | `App.tsx`：`MessageList` → `[data-testid="status"]` → `Composer`；层 A `editor-chat-shell.spec.tsx` 断言顺序 `messages-empty` → `status` → `composer` | ✅ 已落地 |
| 2 | `webview:build` 入扩展发布链路 | `package.json`：`vscode:prepublish` + `prepublishOnly` → `pnpm run webview:build` | ✅ 已落地 |
| 3 | Token 别名对齐 visual-spec §4 | `tokens.css`：`--dsh-btn-*`、`--dsh-panel-bg`、`--dsh-radius-sm/md`；保留 `--dsh-button-*` 作 legacy 别名 | ✅ 已落地 |

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-ECP-1 唯一主面 = Editor `WebviewPanel` | 是 | `createWebviewPanel('dsh.editorChat')`；生产 HTML = SPA；侧栏 migration tip | ✅ |
| AD-ECP-2 单 Panel 内顶栏 Tab | 是 | React `TabChrome` + `panel/tabs` | ✅ |
| AD-ECP-3 历史 = 面板内列表（P1） | 是 | `HistoryPanel` + empty/loading/row 契约 | ✅ |
| AD-ECP-4 关 Panel×running → 提示、不 cancel | 是 | `onDidDispose` → InformationMessage；不 `requestStop` | ✅ |
| AD-ECP-5 不自动弹 Panel（Q-7） | 是 | activate 不 `openOrFocus`；AC-1c 仅在**用户意图成功路径** reveal（见下） | ✅ |
| AD-ECP-8 React+Vite 主呈现路径 | 是 | `buildEditorChatSpaHtml`；`buildThinChatHtml` `@deprecated` | ✅ |
| AD-ECP-9 决策态 Host | 是 | store 只 `applyHostFrame`；Host 无 React import | ✅ |
| AD-ECP-10 契约/探针/CSP/打包 | 是 | MessageBridge；RTL≠探针；CSP+asWebviewUri；dist 纳入 files；**prepublish 已挂 webview:build** | ✅ |
| AD-ECP-11 `retainContextWhenHidden: true` | 是 | `editor-chat-panel.ts` options 显式 true | ✅ |
| 先建后拆 | 是 | 新壳可聊后侧栏切断 writable attach | ✅ |
| P1 豁免 | 是 | GAP-ECP-* 登记；未冒充 P2 交付 | ✅ |

## AC-1c 与 design 一致性（本轮焦点）

AC-1c（外部打开聚焦并切会话）**不破坏** AD-ECP：

| 约束 | AC-1c 实现方式 | 是否冲突 |
|------|----------------|:--:|
| AD-ECP-1 单例 Panel | 统一走 `revealConversationPanel` → `openOrFocus({ sessionId })`，无第二套 Panel | ✅ 无冲突 |
| AD-ECP-5 / Q-7 不无故自动弹 | 仅 `opened`/`activated`/switch 成功后 reveal；`host-not-ready`/`missing`/`error`/取消 **不** reveal | ✅ 无冲突 |
| AD-ECP-9 决策态 Host | 会话切换仍由 Controller/Registry；Panel 只 create/reveal + `pushFullState` | ✅ 无冲突 |
| 单轨 API（implementation 自述） | 避免「命令内 switch + 另 reveal」双轨；`sessionId` 透传 `openOrFocus` | ✅ 符合 AD-ECP-1 单面 |

入口接线：`dsh.switchConversation` / `dsh.openHistory` / `dsh.searchSessions`（选中成功）末尾 `revealConversationPanel(..., { sessionId })`。测试钩子未强制 reveal（implementation 偏差已记）——设计上可接受，生产命令已对齐。

## 模块/命名/结构审查

### 目录合理性
与 design 文件计划一致（`webview/` SPA、`editor-chat-panel.ts`、bridge/store/components）。Host 侧无独立 `chat-panel/bridge/` —— design 标可选，仍可接受。本轮仅改 `App.tsx` / `tokens.css` / `package.json` / `extension.ts` / 测试，无目录漂移。

### 命名规范审查

| 文件/符号 | 实际命名 | 规范 | 判定 |
|-----------|---------|------|:--:|
| DOM 契约 | `editor-chat-root` / `status` / `composer` / … | design DOM 表 | ✅ |
| CSS tokens | `--dsh-btn-*` + legacy `--dsh-button-*` | visual-spec §4 | ✅ |
| viewType | `dsh.editorChat` | design 示例 | ✅ |

### Constitution §2 / §7 检查

| 条款 | 是否违反 | 说明 |
|------|:--:|------|
| §2.1 单一职责 | ✅ | Panel controller / Host / SPA 边界清晰；AC-1c 未把决策塞进 webview |
| §2.2 依赖方向 | ✅ | Host 不 import React |
| §2.3 接口隔离 | ✅ | protocol 帧 + chrome intents |
| §7.1 编辑器 Panel + 面板内 Tab | ✅ | AC-1c 强化外部入口落在 Editor Panel |
| §7.8 历史非空窗 | ✅ | 未回退 |
| §7.9 删除一致 | — | P2 / GAP |

## UI / 视觉契约（P1）

| UI-AC / 契约 | 判定 |
|--------------|:--:|
| UI-AC-1 / §3 布局 Messages→Status→Composer | ✅（本轮已修） |
| UI-AC-2 theme-first + token 别名 | ✅ |
| UI-AC-10–14 / 24 / 40–41 / 50 | ✅（相对上轮无回退） |
| P1 豁免项 | ✅ 仍延后 |

## 打包 / CI / CSP（AD-ECP-10）

| 项 | 判定 |
|----|:--:|
| Vite + `webview:build` | ✅ |
| prepublish / vscode:prepublish 挂钩 | ✅（本轮已修） |
| dist 纳入发布 + `.vscodeignore` 保留 | ✅ |
| CSP / asWebviewUri / 无 CDN | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）— 上轮三项均已落地；本轮未发现新的设计偏离。

### 🟢 Observations
- AC-1c 用「成功才 reveal」精确切分用户意图 vs Q-7 自动弹，是正确的设计解读。
- `dsh.test.*` 钩子不强制 reveal：不构成生产路径设计违规；verifier 应以生产命令/层 B 新用例为准。
- Host `chat-panel/bridge/` 仍未独立成目录：继续符合 design「可选」。

## 详细对照摘要（给 merge）

| 焦点 | 结论 |
|------|------|
| 上轮 Should-Fix ×3 | 全部落地 |
| AD-ECP-1…5, 8–11 | 仍遵循 |
| AC-1c vs Q-7 / 单例 Panel | 一致，无破坏 |
| UI §3 布局 / token / prepublish | 已对齐 |

---

**Verdict: PASS**
路径：`.specdev/specs/vscode-dsh-editor-chat-panel/phases/phase-1-shell-tabs-basic-history/review-design.md`
