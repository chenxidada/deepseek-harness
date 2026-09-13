# 设计一致性审查 — phase-2-stream-capabilities-full-history

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-ECP-1 唯一 Editor WebviewPanel | 是 | `editor-chat-panel.ts` → `createWebviewPanel('dsh.editorChat')`；生产 HTML=`buildEditorChatSpaHtml` | ✅ |
| AD-ECP-2 单 Panel 内顶栏 Tab | 是 | `TabChrome` + `panel/tabs`；无「一会话一 editor tab」 | ✅ |
| AD-ECP-3 面板内历史（完整 F5） | 是 | `HistoryPanel`：档1+2 搜索、Continue、删除、父子「分支自 …」、Host `parentTitle` | ✅ |
| AD-ECP-6 删除统一后端 + **webview modal** | 是 | `DeleteConfirmModal`（含「不可恢复」）→ `ui/delete-request` → `requestDeleteConfirmed` → `deleteSession({confirmed:true})`；顶栏与历史共用 `openDeleteConfirm` | ✅ |
| AD-ECP-7 Timeline 弱化 | 是 | 溢出「打开 Timeline」→ `ui/open-timeline`；活动主投影在 `activity-row`（命令为活动栏容器，已记偏差） | ✅ |
| AD-ECP-8 React SPA 主路径；内联退出生产 | 是 | Panel 仅 SPA；`buildThinChatHtml` 标注 fixture-only（DEBT-ECP-001） | ✅ |
| AD-ECP-9 Host 决策 / Webview 呈现 | 是 | Bridge 薄映射；`composerState` 镜像 Host `mode`/`status`；无本地解锁发送 | ✅ |
| AD-ECP-10 DOM 契约 / 层 A=RTL / 禁假绿 | 基本是 | Phase2 RTL 覆盖能力契约；feature 证据排除 thin HTML | ✅ |
| AD-ECP-11 retainContextWhenHidden | 是 | `editor-chat-panel.ts` options | ✅ |
| MessageBridge 薄适配 | 是 | webview Bridge + Host 路由；Host **不** import React | ✅ |
| 复用 Host sanitize Markdown | 是 | `MessageList` → `safe-markdown.ts`（Vite 打入 SPA） | ✅ |
| ui-visual-spec §5.5 历史行操作默认 | 否（密度） | 行尾**常显** Continue + 删除；规范默认 hover ⋮，禁止并列喧宾 | 🟡 |
| ui-visual-spec §5.5 历史空态引导 | 部分 | 仅文案，缺新建/开始 CTA | 🟡 |
| tokens theme-first（UI-AC-2 / §4） | 是 | `--dsh-*` ← `--vscode-*`；radius≤6；≥8px；focus；reduced-motion | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `DeleteConfirmModal.tsx` | `webview/src/components/` | ✅ | AD-ECP-6 确认 UI 在 webview |
| 顶栏/历史/消息/Composer | `components/` | ✅ | 符合 design 产出计划 |
| `message-bridge.ts` | `bridge/` | ✅ | 薄适配 |
| `chat-ui-store.ts` | `store/` | ✅ | 仅呈现态 |
| `at-path-tokens.ts` | `utils/` | ✅ | 合理；design 示意 `lib/` 亦可 |
| `tokens.css` | `styles/` | ✅ | theme-first |
| Host 删除/Timeline 接线 | `chat-panel/` + `extension.ts` | ✅ | 决策态留 Host |
| `buildThinChatHtml` 保留 | `chat-panel-provider.ts` | ✅ | 仅夹具，符合退出生产路径 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| DOM testid | kebab-case 契约名 | design DOM 契约表 | ✅ |
| Intent | `ui/delete-request` 等 | design ChromeIntent | ✅ |
| Composer 四态 + 停止中 | 四态枚举 + `stopping` +「正在停止…」 | R7 | ✅ |
| Markdown 导入 | 相对路径进 Host `src/` | 应用 `@dsh/safe-markdown` alias | 🟡 |
| Bridge `action/delete` | 类型残留；React 主路径不用 | 主契约为 `ui/delete-request` | 🟢 |

### Constitution §2 / §7 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 模块单一 | ✅ | Modal / History / Composer / Bridge 清晰 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | Host 不依赖 React；复用 Host markdown 符合 §7.3 |
| §2.3 接口隔离 | 经 protocol | ✅ | 删除经 `ui/delete-request` |
| §7.8 / §7.9 | 历史窗口 + 删除一致 | ✅ | 面板内列表；共用 modal + 同后端 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
1. **历史行操作密度偏离 §5.5**：改为 hover/焦点显现的 ⋮ 菜单（或等价弱化），避免 Continue+删除常显并列。
2. **历史空态补引导 CTA**：短文案外增加新建/开始动作。
3. **Markdown 导入改走 `@dsh/safe-markdown` alias**：替代脆弱的 `../../../src/markdown/...` 相对路径。

### 🟢 Observations
- AD-ECP-6 主路径正确；原生确认仅作遗留增强，未替代 webview 契约。
- 停止中 DOM（R7）、弱描边气泡、Timeline 弱化均符合设计；Timeline 命令偏差已记录。
- Phase Entry Gate 债务已全部关闭至「已解决」。

## 详细报告
- Spec / Implementation / Design / UI 文档见同目录与 slug 根目录对应文件。
