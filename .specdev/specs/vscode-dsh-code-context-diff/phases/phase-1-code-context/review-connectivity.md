# Connectivity Review — Phase 1 (`phase-1-code-context`)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

Polish 闭环后：多 root 引用打开与发送门禁共用 `resolveAtPathInWorkspace`；冷启动 `composer/prefill` 经 `pendingPrefill` 在 `attach()` 重放；meta 打开路径仍完整。既有主路径（选区预填 → Host `@path` 门禁 → 原样 prompt；ide `file-reference-local`；AC-3a L2 stub）保持连通，契约一致。先前 SHOULD-FIX（GAP-CCD-012 / GAP-CCD-013）已接线，无端到端断裂。

## 端到端路径追踪

### Path 1: 选区 / 右键 → 脏保存 → live 预填（AC-1 / AC-2 / AD-CCD-12）+ 冷启动缓冲（GAP-CCD-013）
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
           → port 未 attach: pendingPrefill = text（latest wins）✅
           → port 已 attach: post { type: 'composer/prefill', text } ✅
         attach(port) → pushFullState() → 若 pendingPrefill 有值则重放 composer/prefill ✅
             → Webview inputEl.value = text ✅
Exit: live composer 含官方 @token + 自然语言行范围（含冷启动竞态）
```
**判定**: ✅ 数据路径完整；冷启动缓冲→attach 重放已连通（L2：`prefillComposer before attach is replayed…`）。

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
**判定**: ✅ 数据路径完整。

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
Exit: assembled system prompt 含引导
```
**判定**: ✅ 组合面连通；未改 agent-loop。

### Path 5: 引用卡打开 — 多 root + meta（AC-4 / GAP-CCD-012）
```
Entry: MessageStore user text（指针）→ Webview renderUserTextWithRefCards
  → button.ref-card[data-ref-path] + wireRefCards
  → postMessage { type: 'action/open-reference', path }
  → ChatPanelHost → deps.requestOpenReference
  → openReferencePath(vscode, path)
       → planReferenceOpen(path, { folders, preferred, exists }, selectionMetaStore)
            → resolveAtPathInWorkspace（preferred 未命中则扫全部 folder）✅ 与门禁同序
            → metaStore.get(resolved.path) ?? get(raw) → 1-based→0-based selection ✅
            → 无 meta → 仍打开文件，不解析自然语言行范围 ✅
       → openTextDocument(plan.abs) + showTextDocument({ selection? })
Exit: 编辑器打开目标文件（多 root 下非 preferred 根亦可；有 meta 时定位行）
```
**判定**: ✅ 门禁接受的相对 path 与打开侧 resolve 对齐；meta 打开仍接线。L2：`planReferenceOpen scans all roots…` + `uses SelectionMetaStore lines…`。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `askAboutSelection` | `dsh.askAboutSelection` / context menu | ✅ | `selectionMeta` + `prefillComposer` + `notify` | ✅ |
| `validateComposerAtPaths` | `ChatPanelHost.sendPrompt` | ✅ | `resolveAtPathInWorkspace` / `existsSync` | ✅ |
| `ChatPanelHost.prefillComposer` | `runAskAboutSelection` / L2 | ✅ | `pendingPrefill` 或 Webview `composer/prefill` | ✅ |
| `ChatPanelHost.attach` | `chat-panel-provider` | ✅ | `pushFullState` + 重放 `pendingPrefill` | ✅ |
| `acceptSend` | `sendPrompt` 校验通过后 | ✅ | `promptActive` → text-only blocks | ✅ |
| `assertEveryRefReadBeforeFinalAnswer` | L2 `phase1-code-context.spec.ts` | ✅ | `pathsFromReadToolArgs` / `extractAtPaths` | ✅ |
| `file-reference-local` mount | ide `cordis.patch.yml` | ✅ | `systemPrompt.section` when `read` | ✅ |
| `renderUserTextWithRefCards` / `wireRefCards` | user bubble render | ✅ | `action/open-reference` | ✅ |
| `planReferenceOpen` | `openReferencePath` / L2 | ✅ | `resolveAtPathInWorkspace` + `SelectionMetaStore` | ✅ |
| `openReferencePath` | `requestOpenReference` | ✅ | `planReferenceOpen` → `showTextDocument` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host gate → `validateComposerAtPaths` | reject reasons ⊆ RejectSendReason | `not-found` / `outside-workspace` / `ambiguous-root`（无 `unreadable`） | ✅ |
| Webview reject copy ← Host | 上述 reason 有文案 | `chat-panel-provider` reasonCopy 已含三项 | ✅ |
| `acceptSend(text)` ← gate | 原样 trimmed，无正文拼接 | `promptTab` → `[{ type:'text', text }]` | ✅ |
| Prefill Host→Webview | `composer/prefill` { text } | protocol + provider handler；cold-start 经 pendingPrefill | ✅ |
| Open Webview→Host | `action/open-reference` { path } | protocol parse + host 分发 | ✅ |
| Open resolve ↔ gate resolve | 同序多 root + exists | 二者均调 `resolveAtPathInWorkspace`；open 消费 `abs` | ✅ |
| Meta → open selection | 1-based 选区行 → 0-based | `planReferenceOpen` 转换；不解析 NL | ✅ |
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
| GAP-CCD-012 / 013、DEBT-CCD-002 | 本 Phase polish | 已解决并接线 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无 — 上轮两项已由 polish 闭环）

### 🟢 Observations
- AC-3a 覆盖断言刻意停在 L2 stub / 纯函数，不挂运行时 send 路径——与 spec「L2 stub 证明」「stub ≠ 真模型」一致，**不是**数据黑洞（DEBT-CCD-002 已文档化）。
- `pendingPrefill` 语义为 latest-wins；`attach` 在 `pushFullState` 之后重放，避免全量状态冲掉预填。
- `planReferenceOpen` 对 meta 同时尝试 `resolved.path` 与原始 card path，降低相对路径归一化后的查找缺口。
- `editor/context` 与命令共用 `dsh.askAboutSelection`（D-6）接线正确。
- 无 `@` 普通发送仍走原 gate 分支，回归路径连通。

## 详细调用点（审查证据）
- `apps/vscode-dsh/src/code-context/{selection-ask,at-path,selection-meta,open-reference,ref-read-coverage}.ts`
- `apps/vscode-dsh/src/chat-panel/{protocol,chat-panel-host,chat-panel-provider}.ts`
- `apps/vscode-dsh/src/extension.ts`（命令、门禁 deps、`openReferencePath` → `planReferenceOpen`）
- `packages/bundle/ide/cordis.patch.yml` + `package.json`
- `apps/vscode-dsh/tests/phase1-code-context.spec.ts`（polish +3 L2）
- 上轮报告归档：`.archive/review-connectivity-20260910T015636Z.md`
