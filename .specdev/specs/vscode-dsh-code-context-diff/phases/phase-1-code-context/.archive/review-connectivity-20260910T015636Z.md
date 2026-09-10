# Connectivity Review — Phase 1 (`phase-1-code-context`)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

主路径（选区预填 → Host `@path` 门禁 → 原样 prompt；ide `file-reference-local` 挂载；引用卡 → meta 打开；AC-3a L2 stub）均已接线且契约一致。两项非断裂级软缺口：冷启动下 `composer/prefill` 可能在 Webview `attach` 前发出且不重放；引用打开未复用门禁的多 root resolve。

## 端到端路径追踪

### Path 1: 选区 / 右键 → 脏保存 → live 预填（AC-1 / AC-2 / AD-CCD-12）
```
Entry: Command dsh.askAboutSelection  OR  editor/context（同命令，D-6）
  → extension.runAskAboutSelection
    → ensureHostForSend + revealConversationPanel
    → askAboutSelection(deps)
         empty selection → notify banner ✅（AC-2）
         dirty → document.save(); fail → notify，不 prefill ✅
         buildPointerText(formatOfficialAtPath + 「的 N-M 行」) ✅ 无正文/languageId
         selectionMeta.set({ path, startLine, endLine }) ✅
         ensureLiveTab（replay → newConversation live）✅
         prefillComposer → ChatPanelHost.prefillComposer
           → post { type: 'composer/prefill', text }
             → Webview inputEl.value = text ✅（port 已 attach 时）
Exit: live composer 含官方 @token + 自然语言行范围
```
**判定**: ✅ 主链路连通。⚠️ 冷启动时 `post` 仅 `port?.postMessage`，`attach()` 只 `pushFullState()`、**不重放**挂起的 `composer/prefill` → 首次 reveal 竞态下预填可能丢失（见 Should-Fix）。

### Path 2: 发送 → `@path` Host 门禁 → 原样 prompt（AC-3）
```
Entry: Webview composer/send { text }
  → ChatPanelHost.handleWebviewMessage → sendPrompt
    → validateComposerAtPaths(trimmed, getAtPathResolveOptions())
         reasons: not-found | outside-workspace | ambiguous-root ✅（无 unreadable）
         fail → ui/banner + ui/reject-send ✅；Webview reasonCopy 已映射 ✅
         ok → acceptSend(trimmed)  // 原样文本，无读盘拼接
           → ConversationController.promptActive/promptTab
             → host.prompt(sessionId, [{ type: 'text', text }]) ✅
             → MessageStore 用户气泡 text = 指针全文 ✅
Exit: SDK prompt 与权威 user 消息均为指针文本，无文件正文
```
**判定**: ✅ 数据路径完整；L2 夹具确认 `SECRET_BODY` 未进入 prompt。

### Path 3: AC-3a covering-read stub（AD-CCD-14 / P2-A）
```
Entry: L2 会话事件序列 + userText（含 @path）
  → assertEveryRefReadBeforeFinalAnswer
    → extractAtPaths / referencePaths 去重
    → tool/call name=read，pathsFromReadToolArgs（主字段 file_path）
    → readArgsCoverPath 规范化相等，须早于最后一条 assistant/message
Exit: { ok, missing?, paths } — 夹具 ①②③④⑤ 覆盖
```
**判定**: ✅ 按设计为 **L2 stub 断言面**（非运行时强制）；与 `at-path` 提取契约一致。产品侧「模型应 read」依赖 Path 4 的 `FILE_REFERENCE_PROMPT`，非本函数死接线。

### Path 4: AC-3b ide 预挂载 FILE_REFERENCE_PROMPT
```
Entry: IdeSessionHost.start → spawn dsh --profile ide
  → dsh-base cordis：tool-fs → tools.register('read') ✅（P2-3）
  → packages/bundle/ide/cordis.patch.yml insert file-reference-local ✅
  → ide package.json 依赖 @deepseek-ai/dsh-file-reference-local ✅
  → LocalFileReferenceService.installPrompt
       when tools.get('read') → systemPrompt.section(FILE_REFERENCE_PROMPT)
Exit: assembled system prompt 含引导（既有 REAL「installs read-tool guidance」+ 本 Phase 静态 mount 断言）
```
**判定**: ✅ 组合面连通；未改 agent-loop。

### Path 5: 引用卡打开（AC-4）
```
Entry: MessageStore user text（指针）→ Webview renderUserTextWithRefCards
  → button.ref-card[data-ref-path] + wireRefCards
  → postMessage { type: 'action/open-reference', path }
  → ChatPanelHost → deps.requestOpenReference
  → openReferencePath(vscode, path)
       selectionMetaStore.get(path) → showTextDocument selection（1-based→0-based）✅
       无 meta → 仍打开文件，不解析自然语言行范围 ✅
Exit: 编辑器打开目标文件（有 meta 时定位行）
```
**判定**: ✅ 选区预填路径下 meta→打开连通。⚠️ 打开侧用 `preferredWorkspaceFolder` 拼相对路径，**未**复用 `resolveAtPathInWorkspace` 多 root 扫描；门禁已通过的相对 path 在非 preferred root 下可能打不开（见 Should-Fix）。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `askAboutSelection` | `dsh.askAboutSelection` / context menu | ✅ | `selectionMeta` + `prefillComposer` + `notify` | ✅ |
| `validateComposerAtPaths` | `ChatPanelHost.sendPrompt` | ✅ | `resolveAtPathInWorkspace` / `existsSync` | ✅ |
| `ChatPanelHost.prefillComposer` | `runAskAboutSelection` / L2 | ✅ | Webview `composer/prefill` handler | ⚠️ 依赖 port 已 attach |
| `acceptSend` | `sendPrompt` 校验通过后 | ✅ | `promptActive` → text-only blocks | ✅ |
| `assertEveryRefReadBeforeFinalAnswer` | L2 `phase1-code-context.spec.ts` | ✅ | `pathsFromReadToolArgs` / `extractAtPaths` | ✅ |
| `file-reference-local` mount | ide `cordis.patch.yml` | ✅ | `systemPrompt.section` when `read` | ✅ |
| `renderUserTextWithRefCards` / `wireRefCards` | user bubble render | ✅ | `action/open-reference` | ✅ |
| `openReferencePath` | `requestOpenReference` | ✅ | `SelectionMetaStore` + `showTextDocument` | ⚠️ 多 root 弱于门禁 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host gate → `validateComposerAtPaths` | reject reasons ⊆ RejectSendReason | `not-found` / `outside-workspace` / `ambiguous-root`（无 `unreadable`） | ✅ |
| Webview reject copy ← Host | 上述 reason 有文案 | `chat-panel-provider` reasonCopy 已含三项 | ✅ |
| `acceptSend(text)` ← gate | 原样 trimmed，无正文拼接 | `promptTab` → `[{ type:'text', text }]` | ✅ |
| Prefill Host→Webview | `composer/prefill` { text } | protocol + provider handler | ✅ |
| Open Webview→Host | `action/open-reference` { path } | protocol parse + host 分发 | ✅ |
| Coverage ← tool-fs read | 入参 path 字段 | 主字段 `file_path`（+ path/file/target 别名） | ✅ |
| ide mount ← base | `read` 存在才写非空 section | `tools.get('read')` 门控 + base `tool-fs` | ✅ |
| Grammar | 官方 `@` / `@"…"` | `formatFileMention` + Host 全句扫描 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Conversation 面板 / `ensureHostForSend` / text-only composer | vscode-dsh-chat-ready 基线 | 已实现，本 Phase 扩展协议 | ✅ |
| Spike 归属 / ChangeList | phase-0 / phase-2 | 本 Phase 明确不依赖、未触碰 | ✅ |
| agent-loop | — | 禁止修改；未接线改动 | ✅ |
| GAP-CCD-010/011、DEBT-CCD-001 | phase-2 | 未接入本 Phase 路径 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
1. **冷启动 `composer/prefill` 可能丢失**：`ChatPanelHost.post` 在 `port` 未 attach 时只写入 outbound log；`attach()` 不重放 `composer/prefill`。`runAskAboutSelection` 在 `revealConversationPanel` 后立即 prefill，首次打开 Conversation 视图时存在竞态，AC-1 预填可能对用户不可见。建议：attach 时重放最近一次 prefill，或 await view resolved 后再 prefill。
2. **引用打开未对齐门禁多 root resolve**：`openReferencePath` 仅用 `preferredWorkspaceFolder` 拼接相对 path；`validateComposerAtPaths` / `resolveAtPathInWorkspace` 会扫全部 roots。多 root 下门禁已接受的相对引用，切换活动编辑器后点击引用卡可能找不到文件。建议复用同一 resolve（或按 folders 依次探测）。

### 🟢 Observations
- AC-3a 覆盖断言刻意停在 L2 stub / 纯函数，不挂运行时 send 路径——与 spec「L2 stub 证明」「stub ≠ 真模型」一致，**不是**数据黑洞。
- P2-A 将 `file_path` 落在 `ref-read-coverage.ts` + implementation.md，未回写 `design.md` AD-CCD-14——契约在代码侧一致；文档漂移交由调度者/设计补丁（非连通性断裂）。
- `editor/context` 与命令共用 `dsh.askAboutSelection`（D-6）接线正确。
- 无 `@` 普通发送仍走原 gate 分支，回归路径连通。

## 详细调用点（审查证据）
- `apps/vscode-dsh/src/code-context/{selection-ask,at-path,selection-meta,ref-read-coverage}.ts`
- `apps/vscode-dsh/src/chat-panel/{protocol,chat-panel-host,chat-panel-provider}.ts`
- `apps/vscode-dsh/src/extension.ts`（命令、门禁 deps、`openReferencePath`）
- `packages/bundle/ide/cordis.patch.yml` + `package.json`
- `packages/context/file-reference-local/src/index.ts`
- `apps/vscode-dsh/tests/phase1-code-context.spec.ts`
