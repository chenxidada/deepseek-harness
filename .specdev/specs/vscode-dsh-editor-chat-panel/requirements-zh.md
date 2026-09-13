# Requirements: vscode-dsh-editor-chat-panel

<!--
  slug: vscode-dsh-editor-chat-panel
  audience: plan-generator / implementer / reviewer / verifier / HG-1
  language: zh (canonical). Mirror: requirements-zh.md
  constitution: .specdev/specs/vscode-dsh-editor-chat-panel/constitution.md (§7)
  ui-ref: .specdev/specs/vscode-dsh-editor-chat-panel/references/editor-chat-panel-ui-ref.png
  prior: vscode-dsh-conversation-ui / chat-ready / code-context-diff / vscode-dsh-chat-ux
  deferred-from: vscode-dsh-chat-ux/feature-delivery-summary.md
  created: 2026-09-11
  status: HG-1 passed 2026-09-11（完整性+合入增量；Q-1=A Q-2=A Q-3=A Q-4=B Q-5=A Q-6=A Q-7=A；全文无 Should）
  amended: completeness-review + no-should-policy + q6-delete-must + q7-no-auto-open
-->

> 中文镜像：与 `requirements.md` 内容一致（本文件即同步副本）。

## 术语（全文统一）

| 术语 | 含义 |
|------|------|
| **Host** | Extension Host 侧控制器与权威状态持有者（`ConversationController` / `ChatPanelHost` 等） |
| **Editor Chat Panel** | 编辑器区 `WebviewPanel` 承载的主对话面（本 feature 目标壳层） |
| **侧栏 View** | 现有 `WebviewView`（`dsh.chat`）及/或 Conversations `TreeView` Tab 条 |
| **面板内顶栏 Tab** | Editor Chat Panel **内部** chrome 上的多会话 Tab（非 VS Code 侧栏 TreeView；非「每会话一个 VS Code editor tab」） |
| **ConversationRegistry** | 扩展侧 Tab 身份权威：`tabId` / `sessionId` / `activeTabId` / 未关集合等 |
| **决策态** | Host 裁决：`mode` / `sessionId` / 能否发送 / Continue / 变更审阅权威结果等 |
| **呈现态** | Webview 可持有：滚动、展开折叠、流式中间态、跟滚、`follow-state` 等 |
| **层 A** | 可脚本 DOM（jsdom 等）按固定 DOM 契约断言真实节点/属性 |
| **层 B** | Host/控制器/协议证据（FakeWebview、索引、cancel/fork 调用结果等） |
| **层 V（Visible）** | **人眼可用**证据：在真实 VS Code 扩展宿主中打开 Editor Chat Panel，核对关键 chrome 与信息层级**可见可读**。Must 达标 = **层 A + 层 B + 层 V** |
| **可用级呈现** | 日常可阅读：settle 后 Markdown 可读、层级分明、活动/引用/变更可见可操作、composer 可用 |
| **搜索档 1 / 2 / 3** | 标题+预览 / 变更路径→session / 正文全文（档 3 **本 feature 不做**） |
| **live / replay** | Host `mode`：live 可发送；replay 只读，禁直接发送（可提供 Continue→live） |
| **composer 四态** | **live** / **readonly** / **waiting** / **error**；层 V 必须可区分 |

详见权威文件 `requirements.md`（同目录）全文 — 本镜像在 HG-1 锁定后与权威稿同步；若短暂不一致以 `requirements.md` 为准。

同步要点（2026-09-11）：Q-1…Q-7 已拍；E14 全文无 Should；AC-1b…1f / 10a–c / 11a–b / 13a–b / 14a–c / 20a–b / 21a / 23a / 30a–38b / 45 等 Must AC 已合入。
