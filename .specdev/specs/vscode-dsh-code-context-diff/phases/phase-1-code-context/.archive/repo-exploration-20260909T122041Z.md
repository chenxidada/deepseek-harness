# Repository Exploration Report — phase-1-code-context

> Research question (HG-2 design validation): when a user hands focus/selection file content (e.g. lines 3–40 of a file) to the model, how does DSH actually get that content into the LLM request?

## 1. Task Context

Validate AD-CCD-11 (方案 A: rewrite authoritative user body before `composer/send` → SDK) against the live DSH core / SDK / vscode-dsh / request-context reality. Determine whether selection/@path content today is (1) inline text in the user message, (2) path+range only with core re-reading disk, or (3) a structured attachment/context protocol. Phase-1 will implement selection ask + `@path` injection on the Host; this report is the evidence base for that choice.

## 2. Repository Overview

- **Language / packaging**: TypeScript ESM monorepo (`pnpm` workspaces), Cordis plugin compositions.
- **Relevant groups**: `packages/core/` (session + agent-loop), `packages/llm/` (ContentBlock / UserMessage), `packages/sdk/` (JSON-RPC `session/prompt`), `packages/context/` (request-context plugins), `packages/attachment/` (image-only durable attachments), `apps/vscode-dsh/` (VS Code Extension Host + Webview composer), `packages/bundle/{base,sdk-app,ide,web-app}/` (profile patches).
- **vscode-dsh runtime**: Extension Host spawns `dsh --profile ide` (base + sdk-app + ide-bridge). Stdout = SDK JSON-RPC; Host approvals use `DSH_IDE_BRIDGE_SOCK`.

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|--------|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Webview→Host `composer/send` carries **only** `{ text: string }` | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `sendPrompt(text)` gates empty/replay/disconnected then `acceptSend(trimmed)` | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `acceptSend` → `controller.promptActive(text)` | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `promptTab` builds `[{ type: 'text', text }]` and calls Host SDK `prompt` | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | `prompt(sessionId, contentBlocks)` → SDK client | 👁 |
| `packages/sdk/protocol/src/types.ts` | `SessionPromptParams.contentBlocks: SdkPromptContentBlock[]` — text / durable blocks / **encoded images only** | 👁 |
| `packages/sdk/server/src/server.ts` | `durablePromptContent` + `createUserMessage` + `agent.followup` | 👁 |
| `packages/llm/llm/src/types.ts` | `ContentBlockMap`: `text` \| `reasoning` \| `image` \| `tool-call` \| `tool-result` — **no file/selection block** | 👁 |
| `packages/core/agent-loop/src/agent.ts` | `followup` → inbox → `preStep` logs `user/message` → `deriveMessages()` → LLM `messages` | 👁 |
| `packages/core/session/src/surface.ts` | `deriveEventMessage('user/message')` returns `event.data` **verbatim** | 👁 |
| `packages/context/file-reference/` | Official `@path` grammar + discovery; **never reads file contents** | 👁 |
| `packages/context/file-reference-local/` | Installs `FILE_REFERENCE_PROMPT`: model must `read` tool | 👁 |
| `packages/context/session-reference/` | **Contrast**: structured session snapshot injection at `agent/pre-step` | 👁 |
| `packages/attachment/attachment/` | Durable attachments = **raster images only** | 👁 |
| `packages/bundle/web-app/cordis.patch.yml` | Mounts `file-reference-local` + `session-reference` (web only) | 👁 |
| `packages/bundle/base/cordis.patch.yml` | Mounts `attachment-local` + `agent-instructions`; **no** file-reference | 👁 |
| `packages/bundle/ide/` | ide profile = base + sdk-app + ide-bridge; **no** file-reference mount | 👁 |
| `packages/client/ui-reference/` | Web `@` picker inserts `formatFileMention(...)` as **ordinary prompt text** | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — vscode-dsh today (plain text only) ✅ CONFIRMED

```
Webview composer
  postMessage({ type: 'composer/send', text })
       │
       ▼
ChatPanelHost.sendPrompt(text)          # apps/vscode-dsh/.../chat-panel-host.ts
  gate: empty | no-host | no-active | replay | disconnected
  acceptSend(trimmed)
       │
       ▼
ConversationController.promptActive/promptTab
  blocks = [{ type: 'text', text }]     # conversation-controller.ts ~832
  host.prompt(sessionId, blocks)
       │
       ▼
IdeSessionHost → HarnessClient.prompt   # session-host.ts
       │
       ▼
SDK JSON-RPC session/prompt
  SessionPromptParams { sessionId, contentBlocks }
       │
       ▼
HarnessSdkJsonRpcServer.prompt          # packages/sdk/server/src/server.ts
  durablePromptContent(ctx, blocks)     # images → attachment store; text passthrough
  createUserMessage({ content, source: { kind: 'user' } })
  agent.followup(message)
       │
       ▼
AgentLoop: inbox → agent/pre-step → session.append('user/message', …, surfaceOp: 'append')
  step(): buildRequest(..., session.deriveMessages(), ...)
  LLM GenerateOptions.messages = surface-derived Message[] (user content verbatim)
```

### Path B — official Web `@file` mention (path text → model `read`) ✅ CONFIRMED

```
Web composer @ trigger
  activeAtToken / fileReferences.list / formatFileMention
  inserts "@src/foo.ts" into draft text
       │
       ▼
session.prompt([{ type: 'text', text: '... @src/foo.ts ...' }])
       │
       ▼
Same Path A logging + LLM request
  Authority log contains the @path STRING, not file bytes
  System prompt may include FILE_REFERENCE_PROMPT (if file-reference-local mounted)
  Model must call tools.read to load contents
```

**✅ CONFIRMED**: Selecting an `@file` candidate **never** reads or attaches file contents (`packages/context/file-reference/README.md` Known Limitations: "No file-content reference object").

### Path C — structured context that *does* inject content (sessions only) ✅ CONFIRMED

```
Host embeds @[label](dsh-session:<id>) in user text
       │
       ▼
session-reference agent/pre-step listener
  parse mentions → prepare() reads other session surfaces
  inserts second user-role message "## Referenced sessions …"
  durable log = rewritten mention text + snapshot message
```

This is **not** a file/selection channel. It proves the *pattern* of core-side context injection exists for **cross-session** references only, and only when `dsh-session-reference` is mounted (web-app; **not** ide/vscode-dsh by default).

## 5. Likely Impact Surface

| Area | Change for Phase-1 | Risk |
|------|--------------------|------|
| `apps/vscode-dsh` Host send gate | Expand selection / `@path` into **injected text** before `promptActive` | 🟡 MEDIUM — must keep reject-send semantics; do not invent SDK fields |
| `chat-panel/protocol.ts` | May keep `composer/send.text` as sole wire field; optional UI metadata separate from authority body | 🟢 LOW if metadata stays Extension-local |
| MessageStore / Webview bubble | Foldable citation UI vs full injected body (AC-4) | 🟡 MEDIUM — UI can hide; authority text must still contain content |
| `packages/core/**`, agent-loop | **Must not change** (design + phase spec) | 🟢 LOW if Phase-1 stays Host-side |
| SDK protocol | No new content-block type needed for 方案 A | 🟢 LOW |
| `file-reference` seam | Optional later for autocomplete (OOS Phase-1); ide profile does not mount it today | 🟢 LOW |

## 6. Existing Constraints / Conventions

1. **Model-visible ⟺ logged** (root AGENTS.md): anything in the LLM request must reconstruct from the session log. Inline injection into `user/message` content satisfies this; Host-only metadata that never enters `contentBlocks` does **not**.
2. **`session/prompt` is verbatim**: protocol JSDoc — "prompt content blocks, sent verbatim as the user message" (`packages/sdk/protocol/src/types.ts`).
3. **Surface projection is pass-through**: `deriveEventMessage` for `user/message` returns `event.data` unchanged; framing belongs in content (`packages/core/session/src/surface.ts`).
4. **Content blocks today**: text + image (attachment ref) + reasoning/tool blocks. No `file`, `selection`, or `code_context` block in `ContentBlockMap`.
5. **Attachments = images only**: `dsh-attachment` README — "generic files, audio, and video are not supported yet."
6. **`@file` product contract (Web)**: mention = path string; content via `read` tool; guidance via `FILE_REFERENCE_PROMPT`.
7. **vscode-dsh composer protocol**: string-only send; no selection/attachment fields on `composer/send`.
8. **ide profile** does not mount `file-reference-local` or `session-reference` (unlike web-app).

## 7. Risks / Unknowns

| Item | Confidence | Note |
|------|------------|------|
| vscode-dsh has **no** selection / `@path` implementation yet | ✅ CONFIRMED | No `code-context/`, no `askAboutSelection`, no `@` parsing in Extension |
| Core does **not** auto-expand `@path` to file bytes for ide | ✅ CONFIRMED | file-reference never reads contents; ide doesn't mount the provider |
| AD-CCD-11 方案 A matches the only Host-side way to guarantee content reaches the model without a tool round-trip | ✅ CONFIRMED | Same as sending a longer text prompt |
| Whether future core will add a file-content ContentBlock / attachment kind | ❓ UNKNOWN | Explicitly deferred in attachment + file-reference limitations |
| Exact markdown/fence format Host should use when rewriting body | ⚠️ HYPOTHESIS | Design allows "collapsible code block or equivalent"; not fixed by core |
| If someone mounts file-reference-local onto ide later, `@path`-only text becomes "model should read" semantics — **conflicts** with Phase-1 AC-3 "authority log must contain file content" unless Host still expands | ⚠️ HYPOTHESIS | Product choice: expand anyway (方案 A) vs rely on tool |

## 8. Uncertain / Unverified

- Exact DeepSeek provider serialization of multi-block user messages with images (not needed for Phase-1 text injection).
- Whether any experimental / private package adds a file attachment block outside `ContentBlockMap` (no hits in public `packages/` for `file_context` / `CodeContext` / selection prompt blocks).
- ACP / webhook prompt paths: same `createUserMessage` + text blocks; not re-audited end-to-end for this report (orthogonal to vscode-dsh).

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 空表 | tech-debt-registry 活跃债务为空 | ✅ 匹配 |

### Stub Detection Summary

- ✅ Confirmed stubs: 0（registry 空）
- ⚠️ Registry mismatch: 0
- 🔴 Unregistered stubs: 0（本调研范围内未发现阻塞性空壳；**缺失的是功能**而非桩：vscode-dsh 尚无 code-context 模块）

**Gap (not a stub)**: Phase-1 expected modules `apps/vscode-dsh/src/code-context/selection-ask.ts` and `at-path.ts` **do not exist yet** — greenfield Host work, not incomplete stubs.

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/sdk/protocol/src/types.ts` (`SessionPromptParams`, `SdkPromptContentBlock`)
2. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts` (`promptTab`)
3. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` (`sendPrompt`)
4. ⭐ MUST READ — `packages/context/file-reference/README.md` (path-only `@file` contract)
5. 🔷 SHOULD READ — `packages/sdk/server/src/server.ts` (`prompt`, `durablePromptContent`)
6. 🔷 SHOULD READ — `packages/core/agent-loop/src/agent.ts` (`followup`, `preStep`, `buildRequest`)
7. 🔷 SHOULD READ — `packages/core/session/src/surface.ts` (`deriveEventMessage`)
8. 🔷 SHOULD READ — `packages/llm/llm/src/types.ts` (`ContentBlockMap`)
9. 🔹 OPTIONAL — `packages/context/session-reference/README.md` (contrast: structured injection that *does* exist)
10. 🔹 OPTIONAL — `packages/attachment/attachment/README.md` (image-only attachment channel)
11. 🔹 OPTIONAL — `.specdev/specs/vscode-dsh-code-context-diff/design.md` AD-CCD-11

---

## Product verdict (research deliverable)

### 1. 结论（一句话）

**当前 DSH 核心对「选区/文件上下文」没有专用进模通道：权威路径是「客户端把最终字符串（或 text ContentBlock）原样写入 `user/message`」；官方 `@file` 只塞路径文本、靠模型 `read`；不存在可被核心消费的 user/file attachment 或选区结构化字段。**

三选一映射：

| 选项 | 现状 |
|------|------|
| 1. 具体正文内联 | ✅ **唯一能保证内容立刻进模型的路径**（Host/客户端负责拼进 text） |
| 2. 仅索引/路径，核心再读盘 | ❌ **核心不读**；官方 `@file` 是「路径进正文 + 模型工具读」 |
| 3. 结构化附件/上下文协议 | ❌ **无文件/选区通道**；仅有 **图片** attachment，以及 **跨会话** session-reference（非文件） |

### 2. 证据链

**客户端/扩展交给 SDK/核心的是什么**

- vscode-dsh: `composer/send` → `text: string` only (`protocol.ts`).
- `ConversationController.promptTab`: `SdkPromptContentBlock[] = [{ type: 'text', text }]`.
- SDK wire: `session/prompt` `{ sessionId, contentBlocks }` — text or image (encoded → durable ref).

**核心如何记入权威会话日志**

- `HarnessSdkJsonRpcServer.prompt` → `createUserMessage({ content, source: { kind: 'user' } })` → `agent.followup`.
- Loop appends `user/message` with `surfaceOp: 'append'`.
- Content is whatever was in `contentBlocks` after image admission (text unchanged).

**最终如何进入 LLM request**

- `Agent.step` → `buildRequest(..., this.session.deriveMessages(), ...)`.
- `deriveEventMessage('user/message')` returns the logged `UserMessage` verbatim into `GenerateOptions.messages`.
- System prompt / tools assembled separately; they do **not** expand `@path` into file bodies.

**是否存在「只给 path，核心再 read」的官方路径**

- **No** for automatic core injection of file bytes.
- **Yes** as a *model-tool* path: `@path` text + `FILE_REFERENCE_PROMPT` + `read` tool (web profile with `file-reference-local`). That is **not** Host→core automatic read, and **ide/vscode-dsh does not mount** that provider today.

### 3. 对 vscode-dsh-code-context-diff / AD-CCD-11 的含义

- **方案 A（改写权威 user 正文）与现状一致，且对「保证模型立刻看到选区/文件内容」是必须的 Host 侧策略**：核心不会替你读盘或展开 `@path`；若不改写正文，权威日志与模型都只有路径字符串（甚至 vscode-dsh 今天连 `@` 解析都没有）。
- **方案 B（依赖 user/input attachment）当前不可用**：attachment 仅图像；无 file/selection ContentBlock；SDK/协议无对应字段。若未来核心增加正式文件附件协议，才可迁移。
- **最近似的「结构化通道」入口（不可直接复用）**：
  - Images: `SdkEncodedImageBlock` / `ctx.attachments.saveImages` → `type: 'image'`.
  - Sessions: `dsh-session-reference` prepare at `agent/pre-step` (web-mounted).
  - `@file` discovery API: `ctx.fileReferences.list` / Remote `fileReferences/list` — **discovery only**.

### 4. 明确「没有」的东西

- ❌ User/file/selection **attachment** protocol consumed by core for prompts
- ❌ `ContentBlock` type for file path, line range, or code selection
- ❌ Core automatic expansion of `@path` / selection metadata into file bytes
- ❌ vscode-dsh `composer/send` fields beyond `text`
- ❌ vscode-dsh selection ask / `@path` modules (greenfield)
- ❌ `file-reference-local` / `session-reference` on **ide** profile (web-app only among shipped profiles checked)
- ❌ Core reading editor focus/selection from VS Code (Extension owns that IO)

---

*Exploration mode: architecture-design / HG-2 validation for phase-1-code-context. code2prompt unavailable; manual path-focused exploration.*
