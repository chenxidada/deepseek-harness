# Repository Exploration Report — phase-1-code-context

> Fresh exploration (2026-09-09). Prior residual reports live under `.archive/` and were **not** used as source. Findings below are from live tree under `apps/vscode-dsh`, `packages/bundle/ide`, `packages/context/file-reference*`, `packages/fs/tool-fs`.

## 1. Task Context

Phase `phase-1-code-context` delivers the **R3.1a pointer model** for code references in vscode-dsh: dirty-document auto-save before selection/right-click prefill of official `@path` / `@"path with spaces"` plus natural-language line range (no selection body / `languageId`); Host send-gate that extracts and validates `@` tokens without reading file contents into the prompt; ide bundle pre-mount of `file-reference-local` so assembled system prompt carries `FILE_REFERENCE_PROMPT` (AC-3b); L2 stub proof that every deduped valid reference path is covered by at least one `read` whose args map to that path before the turn’s final `assistant/message` (AC-3a); reference-card metadata + replay-Tab routing to live. **Out of scope:** ChangeList UI (phase-2), attribution Spike (phase-0 done), agent-loop edits, old AD-CCD-11 body injection.

## 2. Repository Overview

| Aspect | Reality |
|--------|---------|
| Language / runtime | TypeScript (ESM), VS Code Extension Host |
| App surface | `apps/vscode-dsh` — Conversation Webview + Host gate + ide spawn |
| Package manager | pnpm workspace (`workspace:^`) |
| Ide runtime | `dsh --profile ide` = `dsh-base` + `dsh-sdk-app` + `dsh-ide` (`packages/bundle/ide`) |
| Tools / FS | `dsh-base` mounts `@deepseek-ai/dsh-tool-fs` (`read` / `write` / `edit`) |
| File-reference seam | `packages/context/file-reference` (grammar + `FILE_REFERENCE_PROMPT`); local provider `packages/context/file-reference-local` |
| Tests | Vitest L2 under `apps/vscode-dsh/tests/`; package REAL-composition elsewhere |

**Directory snapshot (relevant):**

```
apps/vscode-dsh/src/
  chat-panel/     # protocol, host gate, webview HTML/JS
  extension.ts    # commands, ensureHostForSend, panel wiring
  conversation-controller.ts / conversation-registry.ts / message-store.ts
  session-host.ts # spawn --profile ide
  # code-context/  ← ABSENT (to be created this Phase)

packages/bundle/ide/cordis.patch.yml   # only ide-bridge today
packages/context/file-reference{,-local}/
packages/fs/tool-fs/src/read.ts        # tool name `read`, arg `file_path`
```

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|:------:|
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `sendPrompt` / `acceptSend` gate; replay reject; `ui/reject-send` / `ui/banner` | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `composer/send` = `{ text }` only; `RejectSendReason` has no at-path reasons yet | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Composer `#input`; bubble render; **no** Host→Webview prefill frame; no reference-card UI | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `promptActive` / `promptTab` → SDK `[{ type: 'text', text }]`; `newConversationOrReuseEmpty`; live/replay | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | `mode: 'live' \| 'replay'`; send blocked when replay | 👁 |
| `apps/vscode-dsh/src/extension.ts` | Command registry / `ensureHostForSend`; **no** `dsh.askAboutSelection`; `VsCodeLike` lacks editor/selection APIs | 👁 |
| `apps/vscode-dsh/package.json` | contributes: no ask-selection command; no `editor/context` menu | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage.kind`: `text` \| `subagent` \| `diff-summary` \| `notice` — no reference-card kind yet | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | Spawns `profile: 'ide'` | 👁 |
| `packages/bundle/ide/cordis.patch.yml` | Inserts only `ide-bridge` — **no** `file-reference-local` | 👁 |
| `packages/bundle/ide/package.json` | Depends only on `dsh-ide-bridge` | 👁 |
| `packages/bundle/web-app/cordis.patch.yml` | Reference mount pattern: `file-reference-local` insert | 👁 |
| `packages/bundle/base/cordis.patch.yml` | `tool-fs` present → ide inherits `read` | 👁 |
| `packages/context/file-reference/src/grammar.ts` | `activeAtToken`, `formatFileMention` (quoted spaces) | 👁 |
| `packages/context/file-reference/src/index.ts` | Stable `FILE_REFERENCE_PROMPT` constant | 👁 |
| `packages/context/file-reference-local/src/index.ts` | Registers `context:file-reference` **only if** `tools.get('read')` exists | 👁 |
| `packages/fs/tool-fs/src/read.ts` | Schema: **`file_path`** (required), `offset`, `limit` — not `path`/`file`/`target` | 👁 |
| `apps/vscode-dsh/src/code-context/*` | Spec target modules — **directory does not exist** | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Composer send today (must extend for AC-3)

```
Webview #input Enter
  → postMessage { type: 'composer/send', text }
  → ChatPanelHost.handleWebviewMessage
  → ChatPanelHost.sendPrompt(text)
       gates: empty | no-host | no-active | replay | disconnected
       ★ NO @path extract / resolve yet
  → deps.acceptSend(trimmed)   [extension.ts → controller.promptActive]
  → ConversationController.promptTab
  → host.prompt(sessionId, [{ type: 'text', text }])   // pointer-only if gate preserves text
  → MessageStore project user bubble (full text as-is)
```

### Path B — Selection ask (to build; AC-1/2/12)

```
Command dsh.askAboutSelection  OR  editor/context menu (same handler)
  → read active editor selection / document
  → if empty → notice (AC-2); return
  → if isDirty → document.save(); fail → warn, no prefill (AD-CCD-12)
  → formatOfficialAtPath(relPath) + natural-language line range
       (spaces → formatFileMention / @"…")
  → storeSelectionMeta({ path, startLine, endLine })  // local only
  → ensure live Tab (if active.mode === 'replay' → do not send to replay;
       activate/reuse live via newConversationOrReuseEmpty / switch)
  → Host→Webview composer prefill frame  ★ does not exist yet
```

### Path C — AC-3b ide mount + AC-3a coverage

```
IdeSessionHost.start → spawn dsh --profile ide
  → stacks dsh-base (tool-fs → tools.register('read')) + dsh-ide patch
  → ★ today: no file-reference-local
  → after AD-CCD-13 insert:
       LocalFileReferenceService installPrompt
       → systemPrompt.section('context:file-reference', FILE_REFERENCE_PROMPT)
         when tools.get('read') !== undefined

L2 AC-3a:
  extractAtPaths(userText) → dedupe normalize → assert each covered by
  tool/call name≈read with args.file_path covering path
  before last assistant/message in turn (N-2)
```

## 5. Likely Impact Surface

| Area | Change type | Risk |
|------|-------------|:----:|
| **New** `apps/vscode-dsh/src/code-context/selection-ask.ts` | Dirty-save + prefill orchestration | Medium |
| **New** `apps/vscode-dsh/src/code-context/at-path.ts` | Full-message `@` extract + workspace resolve (`not-found` / `outside-workspace` / `ambiguous-root`) | High (multi-root + spaces) |
| **New** `apps/vscode-dsh/src/code-context/selection-meta.ts` | Extension-local line meta for card open | Low |
| **New** `apps/vscode-dsh/src/code-context/ref-read-coverage.ts` | Pure covering-path predicate (P1-1 / AD-CCD-14) | Medium |
| `chat-panel/protocol.ts` + host + provider | Extend `RejectSendReason`; add prefill + optional open-ref frames; wire gate before `acceptSend` | High |
| `extension.ts` + `package.json` | Register `dsh.askAboutSelection`; `editor/context`; widen `VsCodeLike` for editor/save | Medium |
| `message-store.ts` / bubble render | Reference-card recognition (AC-4); no file body in authoritative text | Medium |
| `packages/bundle/ide/cordis.patch.yml` + `package.json` | Insert + depend on `dsh-file-reference-local` (mirror web-app) | Medium (idle cost; must document) |
| `apps/vscode-dsh/tests/*` | L2: dirty save, spaces path, multi-ref coverage, replay→live, no body injection | High |
| `apps/vscode-dsh/package.json` dependencies | Likely add `@deepseek-ai/dsh-file-reference` for grammar reuse (or mirror) | Low |

**Must not touch:** `packages/core/agent-loop`, phase-2 change-list modules, forcing body injection.

## 6. Existing Constraints / Conventions

1. **Host owns decisions** — Webview is thin; illegal sends → `ui/reject-send`; notices → `ui/banner` (AD-CU-1 pattern).
2. **Composer protocol is text-only** — `composer/send: { text }`; `promptTab` builds `SdkPromptContentBlock[]` with `{ type: 'text', text }` only — aligns with AD-CCD-11 (no file ContentBlock).
3. **Replay Tabs reject send** — `active.mode === 'replay'` → reason `'replay'`; AC-1 must prefill a **live** Tab instead.
4. **Empty live Tab reuse** — `newConversationOrReuseEmpty` only reuses **active** empty Tab (AD-CR-6); do not steal inactive empties.
5. **Official `@` grammar** — reuse/mirror `activeAtToken` / `formatFileMention` from `@deepseek-ai/dsh-file-reference/grammar`; quoted form mandatory for whitespace paths.
6. **No full-sentence extractor in grammar package** — only cursor-local `activeAtToken`; Host must implement scan-all-tokens equivalent (design: “复用或镜像”).
7. **Ide inherits `read` via dsh-base `tool-fs`** — AC-3b / P2-3 precondition satisfied at composition level ✅.
8. **file-reference-local prompt is conditional** — section text is `''` when `read` missing; with base stack it should populate.
9. **AD-CCD-15** — accept whole-file `read`; document in implementation README/comments; do not regress to inline selection body.
10. **Package REAL-composition** — product-visible plugins need Loader-backed tests (`packages/AGENTS.md`); ide mount should assert assembled prompt contains `FILE_REFERENCE_PROMPT`.
11. **vscode-dsh deps today** — only ide-bridge / sdk-client / subprocess; adding `dsh-file-reference` is a deliberate dependency decision vs copy-mirror.

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| Ide profile already registers `read` via base `tool-fs` | ✅ CONFIRMED | `packages/bundle/base/cordis.patch.yml` insert `tool-fs`; ide README: tools owned by base/sdk-app |
| Ide does **not** mount `file-reference-local` today | ✅ CONFIRMED | `packages/bundle/ide/cordis.patch.yml` only `ide-bridge` |
| `read` tool arg field is `file_path` (snake_case) | ✅ CONFIRMED | `packages/fs/tool-fs/src/read.ts` schema + `parseReadArgs` |
| Design AD-CCD-14 examples list `path`/`file`/`target` — **must map to `file_path`** and back-write AD if needed (P2-A) | ✅ CONFIRMED gap vs design wording | Implementer must document extraction rule |
| No `composer/prefill` (or equivalent) Host→Webview message | ✅ CONFIRMED | protocol + provider only clear input on send |
| `VsCodeLike` lacks `window.activeTextEditor` / `TextDocument.isDirty` / `save` | ✅ CONFIRMED | Must extend duck type + L2 fakes |
| `RejectSendReason` lacks not-found / outside-workspace / ambiguous-root | ✅ CONFIRMED | Extend union + Webview copy |
| Grammar has no `extractAtPaths(fullText)` | ✅ CONFIRMED | New scan logic required |
| Idle CPU/memory cost of mounting file-reference-local (WorkspaceFileSearch indexing) | ⚠️ HYPOTHESIS | Spec requires observation in implementation.md (P2-2), no hard threshold |
| Multi-root resolve using active editor folder first | ⚠️ HYPOTHESIS | Design rule clear; VS Code API wiring not yet in extension |
| Best L2 stub strategy (Host-side coverage fn vs full llm-replay session) | ⚠️ HYPOTHESIS | Design allows hybrid; at least one path through real session event types |
| Whether vscode-dsh should depend on `dsh-file-reference` package vs mirror grammar | ❓ UNKNOWN | Prefer workspace dep for single grammar source |
| Exact Chinese natural-language line-range copy (`的 N-M 行`) localization | ❓ UNKNOWN | Spec examples use Chinese; confirm product copy |

## 8. Uncertain / Unverified

- **`WorkspaceFileSearch` background cost** under ide spawn — not measured in this exploration; required as Phase deliverable observation, not assumed cheap.
- **Session log shape for tool args in vscode-dsh L2** — spike/continue tests show Host mocking patterns; exact `tool/call` argument recovery path for AC-3a through ide-bridge was not end-to-end exercised here. Do not assume a particular JSON field name beyond tool-fs schema until a fixture reads a real/logged call.
- **Webview reference-card click → open at meta lines** — no existing open-file-from-bubble protocol; behavior must be designed within Host (not by parsing natural-language line range from message text).
- **`dsh.promptActiveConversation`** — exists for raw text prompt; not a substitute for selection prefill UX.
- Functions **not** verified as product-ready for this Phase (signatures exist elsewhere but Host does not call them):
  - `formatFileMention` / `activeAtToken` — ✅ read bodies; Host unused
  - `LocalFileReferenceService.list` — discovery OOS for Phase UI; mount only for prompt
  - Coverage helpers — **do not exist** yet

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| GAP-CCD-010 | `packages/fs/tool-fs/src/write.ts:presentationMeta` | create / identical overwrite → `meta.diffs: []` | `value.before === null ? [] : computeHunkDiffs(...)` | ✅ 匹配 |
| GAP-CCD-011 | `packages/fs/tool-str-replace-editor/src/index.ts` | only `presentCall` diffs; no `presentationMeta` | No `presentationMeta` in package source | ✅ 匹配 |
| DEBT-CCD-001 | design appendix / SnapshotStore | meta hunk ≠ full-file blob | Design-level; no phase-1 SnapshotStore product code | ✅ 匹配（文档债） |

All three target **`phase-2-change-list-display`**, blocking = 🟡 non-blocking. **None block phase-1.**

### Phase-1 surface stubs

| Location | Finding |
|----------|---------|
| `apps/vscode-dsh/src/code-context/` | **Absent** — expected greenfield, not an unregistered stub |
| Send path | Real gate + prompt; missing at-path logic = **feature gap**, not a fake stub |
| Ide patch | Missing `file-reference-local` = **planned insert**, not a stub |

### Stub Detection Summary

- ✅ Confirmed stubs / gaps matching registry: **3** (all phase-2 targets)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs on phase-1 primary path: **0**
- Note: do not treat missing `code-context/` as STUB — it is greenfield scope for this Phase

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/fs/tool-fs/src/read.ts` (confirm `file_path` for AD-CCD-14 / P2-A backfill)
2. ⭐ MUST READ — `packages/context/file-reference/src/grammar.ts` + `index.ts` (`FILE_REFERENCE_PROMPT`, `formatFileMention`)
3. ⭐ MUST READ — `packages/context/file-reference-local/src/index.ts` (prompt install gated on `read`)
4. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/{protocol,chat-panel-host,chat-panel-provider}.ts`
5. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts` (`promptTab`, `newConversationOrReuseEmpty`)
6. ⭐ MUST READ — `.specdev/specs/vscode-dsh-code-context-diff/design.md` AD-CCD-11…15
7. 🔷 SHOULD READ — `packages/bundle/web-app/cordis.patch.yml` (canonical `file-reference-local` insert) + `packages/bundle/ide/cordis.patch.yml`
8. 🔷 SHOULD READ — `apps/vscode-dsh/src/extension.ts` (`ensureHostForSend`, command registration pattern, `VsCodeLike`)
9. 🔷 SHOULD READ — `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` + `phase3-chat-ui-chassis.spec.ts` (send / replay reject patterns)
10. 🔹 OPTIONAL — `packages/test-support/llm-replay/README.md` (if pursuing REAL session AC-3a fixtures)
11. 🔹 OPTIONAL — `packages/client/ui-reference/` (Web `@` UX reference only; vscode-dsh does not share this UI)

### Implementer entry checklist (P2-A / P2-3)

- [x] P2-3: ide default agent has `read` via base `tool-fs` — **CONFIRMED**
- [x] P2-A: read args schema primary field = **`file_path`** — **CONFIRMED**; update AD-CCD-14 wording when implementing coverage helper
- [ ] Add ide `file-reference-local` mount + package dependency
- [ ] Implement Host at-path gate **without** pre-send content read
- [ ] Add composer prefill protocol + selection command/menu
- [ ] Record idle CPU/mem observation + AD-CCD-15 accept note in implementation.md
