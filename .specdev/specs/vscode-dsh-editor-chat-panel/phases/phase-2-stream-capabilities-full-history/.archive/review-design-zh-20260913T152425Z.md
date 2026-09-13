# 设计一致性审查 — phase-2-stream-capabilities-full-history

> MUST-FIX 回路 #1 复审（上轮设计判决：SHOULD-FIX）

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-ECP-1 唯一 Editor WebviewPanel | 是 | `createWebviewPanel('dsh.editorChat')` + SPA HTML | ✅ |
| AD-ECP-2 单 Panel 内顶栏 Tab | 是 | `TabChrome` + `panel/tabs` | ✅ |
| AD-ECP-3 面板内完整历史 | 是 | 搜索档1+2、Continue、删除、父子、空态 CTA | ✅ |
| AD-ECP-6 统一删除 + webview modal | 是 | modal「不可恢复」→ `ui/delete-request` → `deleteSession` | ✅ |
| AD-ECP-7 Timeline 弱化 | 是 | 溢出「打开 Timeline」；活动在消息流 | ✅ |
| AD-ECP-8 React 主路径 / 内联退出 | 是 | 生产仅 SPA；`buildThinChatHtml` 仅夹具 | ✅ |
| AD-ECP-9 Host 决策 / Webview 呈现 | 是 | Bridge 薄映射 | ✅ |
| AD-ECP-10 DOM 契约 / RTL / 禁假绿 | 是 | Phase2 RTL；排除 thin HTML 证据 | ✅ |
| AD-ECP-11 retainContextWhenHidden | 是 | Panel options | ✅ |
| ui-visual-spec §5.5 历史行密度 | **本回路已修** | hover/焦点显露 ⋮；Continue/删除入菜单 | ✅ |
| ui-visual-spec §5.5 空态引导 | **本回路已修** | 「新建会话」→ `ui/tab-new` | ✅ |
| Markdown 共享 alias | **本回路已修** | `@dsh/safe-markdown` | ✅ |

## 上轮 SHOULD-FIX 闭环

1. 历史行常显双按钮 → **已改为** hover ⋮ 菜单
2. 历史空态无 CTA → **已补** 新建会话
3. Markdown 相对路径 → **已改** Vite alias

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 观察
- Tab 右键删除仍未做；AC-13c「或」已由溢出路径满足，不升格。
- `follow-state` 仍用相对路径导入，可接受；可选后续加 alias。

## 详细报告
见同目录 `review-design.md`（英文主稿）。
