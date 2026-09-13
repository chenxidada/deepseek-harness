# Solution Design: vscode-dsh-editor-chat-panel（中文镜像）

> Canonical：[`design.md`](./design.md)。本文与 canonical 同步；实施以 `design.md` 为准。

## 范围覆盖

完整 feature，**2 Phase** DAG。P1=壳+React 脚手架+顶栏 Tab+基础历史+最小可聊；P2=可读流+能力+完整历史+内联主路径退出。

Phase ID：`phase-1-shell-tabs-basic-history` → `phase-2-stream-capabilities-full-history`。

旧三 Phase 目录 **OBSOLETE**。HG-1/HG-UI 锁定 Q-1…Q-7、E14–E16、U1–U6 不变。

UI 输入：`requirements-ui.md` + `ui-visual-spec.md`（呈现结果；技术栈见 AD-ECP-8）。

## 架构摘要

唯一编辑器区 `WebviewPanel`；呈现层为 **React + Vite SPA**；Host 经既有 protocol 下发决策态；React 经 MessageBridge 持呈现态。Registry 为 Tab 权威。不重做 agent-loop。验证层 A（RTL）+ B（FakeWebview）+ V（真机）；禁止 `buildThinChatHtml` 假绿。

## 架构决策（摘要）

| ID | 决议 |
|----|------|
| AD-ECP-1 | 唯一 Editor WebviewPanel；废弃侧栏主聊 |
| AD-ECP-2 | 面板内顶栏多 Tab |
| AD-ECP-3 | 面板内历史列表；P1 骨架 / P2 完整 |
| AD-ECP-4 | 关 Panel×running：后台继续+提示 |
| AD-ECP-5 | 不自动弹 Panel |
| AD-ECP-6 | 删除统一 `deleteSession` |
| AD-ECP-7 | Timeline 弱化 |
| **AD-ECP-8** | **React+Vite SPA 主路径**（推翻内联 HTML） |
| AD-ECP-9 | 决策态 Host / 呈现态 Webview |
| **AD-ECP-10** | **验证架构**：A=RTL+DOM 契约；B=FakeWebview；V=真机+§9；Bridge+探针；CSP；内联退役 |

## AD-ECP-8（现行）

采用 React + Vite（或等价）webview SPA 作为唯一主呈现路径。理由：对齐主流、避免二次重写、UO-4 授权 design 选型。否决：继续内联 HTML 为主路径。约束：Host/protocol 不变；theme-first；开源只借前端；P1 起 React 主路径；P2 退出内联主路径。

## AD-ECP-10（验证专章摘要）

- 层 A：RTL+jsdom；固定 data-testid / data-message-id / data-role 等；禁 buildThinChatHtml 假绿。
- 层 B：FakeWebview + 协议帧；Host 不依赖 React。
- 层 V：真机 + ui-visual-spec §9；双主题抽检。
- MessageBridge：帧 ↔ store；`__dshProbes` 兼容。
- CSP / asWebviewUri 冒烟 Must（P1）。
- 闭环：composer → Host → messages/state → React → A/B/V。

## 文件产出计划

```
apps/vscode-dsh/webview/          — React+Vite
apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts
apps/vscode-dsh/src/chat-panel/bridge/
```

`buildThinChatHtml`：deprecated → P2 退出主路径。

## Phase DAG

P1（无依赖）→ P2。选 2 Phase：避免空壳 SPA 与多余 HG-3；不采用「先内联再 React」。

## 修订记录

| # | 日期 | 变更 |
|---|------|------|
| 1 | 2026-09-13 | F5/E16/UI；2 Phase |
| 2 | 2026-09-13 | AD-ECP-8→React；AD-ECP-10 验证专章 |

详见 canonical `design.md` 全文。
