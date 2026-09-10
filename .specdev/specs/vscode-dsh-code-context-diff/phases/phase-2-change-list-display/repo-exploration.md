# Repository Exploration Report — phase-2-change-list-display

> Per-phase exploration for message-attached ChangeList + safe on-demand diff + AC-30 coexistence.  
> Spike Gate (`phase-0-spike-attribution-snapshot`) = **PASS** (2026-09-09).  
> Phase Entry Gate: user chose **(a)** prioritize GAP-CCD-010 / GAP-CCD-011 / DEBT-CCD-001 in this Phase.  
> Re-verified live code on branch `impl-phase-2-change-list-display` (2026-09-10); not a blind copy of phase-0 exploration.

## 1. Task Context

Phase 2 delivers **message-attached change awareness and display**: attribute DSH writes inside a top-level turn via recoverable `tool/result.meta.diffs` (AD-CCD-1), exclude binary / oversized / generated / outside-workspace paths (AD-CCD-8), merge same-path writes to final before/after (AD-CCD-5), persist full-file SnapshotStore blobs under extension-local storage (appendix A.3 + DEBT-CCD-001), project a `change-list` under the turn’s last assistant message (N-2; N=0 = one-line notice, no empty skeleton), serve on-demand diff via `change/get-diff` → `change/diff-content` (AC-12), open/locate files (AC-12a), provenance isolation (AC-19/21), XSS-safe rendering (AC-23), and retarget AC-30 `diff-summary` clicks to **reveal the message change-list** (N-1 / AD-CCD-4) instead of only Timeline/`reviewWorkspaceDiffs`. Out of scope: revert writeback / full mark-reviewed (phase-3), agent-loop changes, code-reference pointer surface (phase-1 already done).

## 2. Repository Overview

| Layer | Location | Role for Phase 2 |
|-------|----------|------------------|
| Extension Host + Webview | `apps/vscode-dsh/` | Primary implementation target (AD-CCD-7) |
| Write tools | `packages/fs/tool-fs`, `tool-str-replace-editor` | Produce / omit `presentationMeta.diffs` |
| Tools core | `packages/core/tools/src/index.ts` | Attaches `presentationMeta` onto parent `tool/result.meta` |
| SDK stream | `packages/sdk/*` + `session-host.ts` | `session.event` fan-out to Timeline / Conversation |
| Authority log | DSH session JSONL | **Must not** receive snapshot plaintext (AD-CCD-3 / AC-24) |
| Extension index | `extension-index.ts` / `workspaceState` | Metadata pattern only; not blob store |
| SnapshotStore | **not productized** | Spike dry-run only in tests; phase-2 owns real module |

- **Language**: TypeScript ESM monorepo (`pnpm`); vitest L2 fixtures under `apps/vscode-dsh/tests/`.
- **Missing product module**: `apps/vscode-dsh/src/change/` **does not exist** yet (expected deliverable per phase spec).
- **Git branch**: `impl-phase-2-change-list-display` (confirmed).

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|--------|
| `apps/vscode-dsh/src/timeline-store.ts` | Live `narrowDiffs` + turn window `changedFilesForLatestTurn` — attribution signal source | 👁 re-verified |
| `apps/vscode-dsh/src/replay-hydrator.ts` | `recoverableDiffsFromMeta` (same contract; cold path) | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `onSdkNotification` → assistant projection + `maybeAppendDiffSummary` (AC-30); N-2 anchor hook | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage.kind` — must add `'change-list'` | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Host↔Webview frames — no `change/*` yet | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Bubble render; `diff-summary` click → `open-workspace-diffs`; escapeHtml / safe markdown | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | Routes `action/open-workspace-diffs` → Timeline Diff | 👁 |
| `apps/vscode-dsh/src/diff-entry.ts` | Post-hoc `vscode.diff` from **log hunks** (Timeline path; weaken for AC-30 primary) | 👁 |
| `apps/vscode-dsh/src/markdown/safe-markdown.ts` | XSS baseline for text bubbles (reuse pattern for diff panes) | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.reviewWorkspaceDiffs`; `ExtensionContextLike` **lacks** `storageUri`/`globalStorageUri` today | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | Durable extension metadata pattern (`workspaceState`) | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | `client.subscribe()` → `onNotification` | 👁 |
| `apps/vscode-dsh/tests/spike-attribution-helpers.ts` | Locked SnapshotStore constants + attribution helpers (promote, don’t invent) | 👁 |
| `apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts` | Spike Gate evidence (7 passed) | 👁 |
| `apps/vscode-dsh/tests/phase5-should-polish.spec.ts` | AC-30 L2: N>0 injects diff-summary; N=0 forges none | 👁 |
| `packages/fs/tool-fs/src/write.ts` | **GAP-CCD-010**: create / identical → `diffs: []` | 👁 |
| `packages/fs/tool-fs/src/edit.ts` | Recoverable hunks via `presentationMeta` | 👁 |
| `packages/fs/tool-fs/src/diff.ts` | **DEBT-CCD-001**: `DIFF_CONTEXT = 3` contextual hunks | 👁 |
| `packages/fs/tool-str-replace-editor/src/index.ts` | **GAP-CCD-011**: `presentCall` diffs only; **no** `presentationMeta` | 👁 |
| `packages/core/tools/src/index.ts` ~1797 | Wires `presentationMeta` → result `meta` (parent-only) | 👁 |
| Spec: `design.md` AD-CCD-1…10, N-1/N-2, appendix A; `spike-report.md` | Contract truth | 👁 |
| Spec: `tech-debt-registry.md` | Inherited GAP/DEBT for this Phase | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Attribution intake (live) ✅ CONFIRMED

```
tool-fs write/edit execute
  → ToolsService createSuccessResult
       presentationMeta(args, value) → meta.diffs[]
  → session.append tool/result { message, meta }
  → SDK notify session.event
       │
       ▼
IdeSessionHost.onNotification
       │
       ▼
ConversationController.onSdkNotification
  timeline.apply(notification)          # ALL session.event
  if type === assistant/message:
    projectAssistantMessage(randomUUID())  # N-2 anchor id today = Host UUID
    maybeAppendDiffSummary(N from Timeline)
       │
       ▼
TimelineStore.applySessionEvent('tool/result')
  metaDiffs = narrowDiffs(data.meta)     # path + newText + oldText:string|null
  push TimelineItem { diffs? }
       │
       ▼
[phase-2 NEW] ChangeAttributor
  window = latest top-level turn/start… (same as changedFilesForLatestTurn)
  candidates = recoverable meta.diffs ∩ IgnoreRules
  merge same path → first oldText + last newText (AD-CCD-5)
  capture FULL-FILE before/after → SnapshotStore (DEBT-CCD-001)
  ChangeStore.upsert ChangeRecord { sourceMessageId = last assistant id }
```

**✅ CONFIRMED recoverable contract** (identical in `narrowDiffs` / `recoverableDiffsFromMeta`):

| Field | Required | Reject if |
|-------|:--------:|-----------|
| `path` | yes | missing / empty |
| `newText` | yes | not string |
| `oldText` | yes | missing key (must be `string` **or** `null`) |

### Path B — Message-attached display + AC-30 coexistence ✅ CONFIRMED (current) / ⚠️ HYPOTHESIS (target)

**Current (chat-ready):**

```
assistant/message projected
  → maybeAppendDiffSummary: if N>0 append kind:'diff-summary'
  → Webview button click → action/open-workspace-diffs
  → ChatPanelHost → dsh.reviewWorkspaceDiffs
  → TimelineStore.writeDiffsForSessionTree → vscode.diff (diff-entry)
```

**Phase-2 target (design):**

```
turn settle (prefer turn/end or idle)  # N-2 定稿
  → append kind:'change-list' under last assistant (or emptyNotice when N=0)
  → keep/retarget kind:'diff-summary' only when N>0
       click → reveal change-list (scroll + expand), NOT only Timeline
  → expand row → change/get-diff → Host reads SnapshotStore → change/diff-content
  → change/open → open file + revealLine when known
  → change/reveal-source → scroll to sourceMessageId bubble
```

### Path C — SnapshotStore layout (Spike-locked) ✅ CONFIRMED (contract) / ❌ not product code

```
storageRoot = context.storageUri.fsPath
             || globalStorageUri.fsPath/<workspaceKey>/
blob = <storageRoot>/changes/<sessionId>/<snapshotRef>.json
keys = sessionId · snapshotRef · sourceMessageId · turn
budget = 200 MiB soft / root; 2 MiB soft / blob
prune = reverted-first, then oldest session dir
authority session log / workspaceState message bodies = NEVER hold plaintext blobs
```

Evidence: `SNAPSHOT_STORE_SPIKE` + `dryRunSnapshotStore` in `spike-attribution-helpers.ts`. Product `snapshot-store.ts` still absent.

### Path D — Cold replay (same meta signal) ✅ CONFIRMED

```
session/read-log → ReplayHydrator.recoverableDiffsFromMeta
  → TimelineStore.replace
  → [phase-2] re-attribute or hydrate ChangeStore index from extension storage
```

**Note (appendix A.3):** live `sourceMessageId` = Host `randomUUID()`; cold replay prefers SDK `message.id`. Phase-2 must record the id used at attach time.

## 5. Likely Impact Surface

| Area | Change type | Risk | Notes |
|------|-------------|:----:|-------|
| **NEW** `apps/vscode-dsh/src/change/*.ts` | Attributor / ChangeStore / SnapshotStore / IgnoreRules | 🔴 High | Spec expected home; empty today |
| `conversation-controller.ts` | Wire attribution on tool/result + settle change-list on turn end; retarget AC-30 | 🔴 High | Central projection; N-2 timing vs multi-assistant |
| `message-store.ts` | Add `kind: 'change-list'` (+ optional payload fields) | 🟡 Med | Type + copy semantics |
| `chat-panel/protocol.ts` | Add `change/get-diff`, `change/diff-content`, `change/open`, `change/reveal-source` (+ stub revert?) | 🔴 High | Parse/narrow unknown postMessage |
| `chat-panel-provider.ts` | Render change-list / empty notice; safe diff expand; retarget diff-summary | 🔴 High | XSS (AC-23); no `data-message-id` today |
| `chat-panel-host.ts` | Route change/* handlers | 🟡 Med | Mirror open-workspace-diffs pattern |
| `extension.ts` | Expose `storageUri`/`globalStorageUri` on context like; L2 test hooks | 🟡 Med | `ExtensionContextLike` currently omits storage URIs |
| `diff-entry.ts` / Timeline Diff | Keep as secondary path; AC-30 primary becomes reveal list | 🟢 Low | Do not delete; weaken as main UX |
| `tool-fs` / `tool-str-replace-editor` | Optional GAP-010/011 fixes | 🟡 Med | User chose (a) — decide product vs document miss |
| phase-3 revert UI | Must not implement writeback; if buttons shown → `@STUB(phase-3-…)` + registry | 🟢 Low if omitted | Spec allows list-only |

## 6. Existing Constraints / Conventions

1. **AD-CCD-1 / AC-9**: Attribution **only** from recoverable `meta.diffs` inside top-level turn. **Forbidden**: bare `FileSystemWatcher` / all-saves intake. ✅ No such watchers under `apps/vscode-dsh/src` today.
2. **AD-CCD-7**: Do not change agent-loop / write model; implement in vscode-dsh (+ optional tool presentationMeta if closing GAPs).
3. **AD-CCD-3 / AC-24**: Snapshot plaintext only under extension-local `changes/`; never authority JSONL / chat bodies in `workspaceState`.
4. **AD-CU-6 recoverable rule**: missing `oldText` key → reject (never coerce to `''`). `oldText: null` = create semantics in Timeline Diff.
5. **MessageStore**: projection only — not a second authority DB. Change **index** may use Memento/files; blobs stay in `changes/`.
6. **Webview security**: assistant text uses `renderSafeMarkdown` / `escapeHtml`; `diff-summary` uses `textContent`. Diff panes must default-escape, no script, no external loads (AC-23 / AD-CCD-9).
7. **AC-30 existing behavior**: `maybeAppendDiffSummary` already skips N=0 (✅). Click currently opens Timeline Diff (❌ vs AD-CCD-4) — must retarget.
8. **N-2 anchor**: list hangs on **last** assistant of the turn; settle prefer `turn/end` / idle. Today every assistant projection may append a new `diff-summary` if N>0 — phase-2 must avoid duplicate lists / wrong anchors.
9. **Ignore (AD-CCD-8)**: outside workspace, binary, default **1 MiB** text, gitignore-style build/gen dirs — **no shared IgnoreRules module yet**; phase-2 must add (code-context `at-path` only covers path existence/roots).
10. **Tests**: prefer L2 inject via TimelineStore / fake SDK notify (patterns in `phase5-should-polish.spec.ts`, spike helpers). L4 not sole evidence.

## 7. Risks / Unknowns

| Item | Confidence | Detail |
|------|:----------:|--------|
| Recoverable meta.diffs path is sufficient for edit/non-empty write updates | ✅ CONFIRMED | Spike PASS + live parsers |
| Create / identical write → empty diffs (GAP-010) | ✅ CONFIRMED | `write.ts` presentationMeta |
| str_replace_editor never logs meta.diffs (GAP-011) | ✅ CONFIRMED | no `presentationMeta` in package |
| meta.diffs are DIFF_CONTEXT=3 hunks, not full file (DEBT-001) | ✅ CONFIRMED | `diff.ts` + appendix A.2 |
| Product Change* modules absent | ✅ CONFIRMED | no `src/change/` |
| `ExtensionContextLike` lacks storageUri | ✅ CONFIRMED | must extend for SnapshotStore root |
| Webview bubbles lack stable `data-message-id` / no scroll/reveal handler in provider JS | ✅ CONFIRMED | AC-19 reveal needs new DOM + Host→Webview handling |
| When exactly to **settle** change-list (every assistant vs turn/end) | ⚠️ HYPOTHESIS | Design prefers turn/end/idle; live AC-30 fires per assistant text |
| Full-file before image at attribution: read workspace vs tool `value.before` | ⚠️ HYPOTHESIS | Design allows either; tool result has before/after for write/edit but **not** on meta hunks |
| Whether to fix GAP-010/011 in tools this Phase vs document 宁可漏记 | ⚠️ HYPOTHESIS | User chose prioritize (a); product call still open |
| Subagent tree diffs rolled into parent turn for ChangeStore | ⚠️ HYPOTHESIS | Timeline has session tree; N-2 says nest into parent top-level turn |
| Replay Tab change-list hydration without blobs | ❓ UNKNOWN | Index-only stats Must; full diff May after prune |

## 8. Uncertain / Unverified

Do **not** assume these work for Phase 2 without reading/implementing:

| Symbol | Status | Caution |
|--------|--------|---------|
| Product `ChangeAttributor` / `ChangeStore` / `SnapshotStore` | ❌ absent | Spike helpers are test-only dry-run |
| `TimelineStore.collectDiffs` as AD-CCD-5 merge | ⚠️ wrong semantics | Dedupes `path+newText`; does **not** keep first-old/last-new single record |
| `diff-entry.reviewWorkspaceDiffs` as change-list diff UI | ⚠️ wrong surface | Opens `vscode.diff` from **hunk** text; AC-12 wants Webview on-demand from SnapshotStore |
| SDK `message.id` as live `sourceMessageId` | ❌ unused | `projectAssistantMessage` always `randomUUID()` |
| Webview `scroll/reveal` Host frame | ⚠️ partial | Host can post; provider script **does not** handle it yet |
| `panel/state` carrying change-list payload | ❌ absent | Design mentions it; protocol has no field today |
| IgnoreRules for binary / 1 MiB / generated dirs | ❌ absent | Must invent under AD-CCD-8 |
| Controlled snapshot comparison for create coverage | Spike optional | Only if product chooses to close GAP-010 without false positives |

## 9. Stub Detection & Registry Cross-Validation

### Phase Entry Gate inherited items (user chose **a** — prioritize)

| ID | Live code check | Match? | Implementer handling options |
|----|-----------------|:------:|------------------------------|
| **GAP-CCD-010** | `packages/fs/tool-fs/src/write.ts` `presentationMeta`: `value.before === null ? [] : computeHunkDiffs(...)`; identical texts → empty hunks | ✅ matches registry | **(1)** Prefer miss (document in ChangeAttributor + tests that create never appears). **(2)** Controlled tool/call-bound snapshot at write create (still no watcher). **(3)** Extend presentationMeta to emit synthetic create diff (`oldText: null`, full `newText`) — touches tool-fs. |
| **GAP-CCD-011** | `tool-str-replace-editor/src/index.ts`: diffs only in `presentCall`; **grep `presentationMeta` = 0 hits** | ✅ matches | **(1)** Document permanent miss under 宁可漏记 + AC-9-style test. **(2)** Add `output.presentationMeta` mirroring presentCall diffs (log path). Prefer (1) unless product requires editor-tool coverage. |
| **DEBT-CCD-001** | `tool-fs/src/diff.ts` `DIFF_CONTEXT = 3`; spike-report + design A.2 require full-file blobs | ✅ matches | **Must** at ChangeAttributor intake: write SnapshotStore with whole-file before/after (workspace read and/or tool result `before`/`after`); treat meta.diffs as **signal + path set** only. Do not store hunk-only as revert-capable blob. |

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| GAP-CCD-010 | `tool-fs/.../write.ts:presentationMeta` | create/identical → empty diffs | Confirmed empty array path | ✅ 匹配 |
| GAP-CCD-011 | `tool-str-replace-editor/.../index.ts` | no presentationMeta | Confirmed absent | ✅ 匹配 |
| DEBT-CCD-001 | design appendix A.2 / SnapshotStore | hunk ≠ full-file blob | DIFF_CONTEXT=3 confirmed; product store absent | ✅ 匹配（债仍活跃） |
| — | `apps/vscode-dsh/src/change/*` | — | Module missing (expected) | ℹ️ not a stub — greenfield |
| — | `change/revert*` UI | — | N/A | If exposed early → must `@STUB(phase-3-review-revert-replay)` |

### Stub Detection Summary

- ✅ Confirmed stubs / gaps matching registry: **3** (GAP-010, GAP-011, DEBT-001)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs in primary Phase-2 path: **0** (no fake ChangeStore shells found)
- ℹ️ Greenfield: entire `src/change/` + protocol `change/*` frames

### Recommended debt strategy for implementer (aligned with user **a**)

1. **DEBT-CCD-001** — treat as **blocking for correct SnapshotStore design** even though registry marks 🟡: implement full-file capture on day one of attribution.
2. **GAP-CCD-010 / 011** — default product stance remains **宁可漏记** unless explicitly implementing tool-side presentationMeta / controlled snapshot; either way add L2 tests that encode the chosen coverage matrix (same rows as spike coverage table).
3. Do **not** “fix” misses via FileSystemWatcher.

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `design.md` (ChangeRecord / ChangeListPayload, AD-CCD-1…9, N-1/N-2, appendix A)
2. ⭐ **MUST READ** — `phases/phase-0-spike-attribution-snapshot/spike-report.md` + `apps/vscode-dsh/tests/spike-attribution-helpers.ts`
3. ⭐ **MUST READ** — `apps/vscode-dsh/src/timeline-store.ts` (`narrowDiffs`, `changedFilesForLatestTurn`)
4. ⭐ **MUST READ** — `apps/vscode-dsh/src/conversation-controller.ts` (`projectAssistantMessage`, `maybeAppendDiffSummary`, `onSdkNotification`)
5. ⭐ **MUST READ** — `apps/vscode-dsh/src/message-store.ts` + `chat-panel/protocol.ts` + `chat-panel-provider.ts` (diff-summary render/click)
6. 🔷 **SHOULD READ** — `packages/fs/tool-fs/src/write.ts` / `edit.ts` / `diff.ts` (GAP-010 + DEBT-001)
7. 🔷 **SHOULD READ** — `packages/fs/tool-str-replace-editor/src/index.ts` (GAP-011)
8. 🔷 **SHOULD READ** — `apps/vscode-dsh/tests/phase5-should-polish.spec.ts` (AC-30 fixtures to extend)
9. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/markdown/safe-markdown.ts` (AC-23 patterns)
10. 🔹 **OPTIONAL** — `diff-entry.ts`, `replay-hydrator.ts`, phase-0 `repo-exploration.md` (background only)
11. 🔹 **OPTIONAL** — `extension-index.ts` (Memento index pattern for ChangeRecord metadata)

---

**Downstream one-liner:** Wire ChangeAttributor off Timeline/`meta.diffs` → full-file SnapshotStore under `changes/<sessionId>/` → MessageStore `change-list` + protocol `change/get-diff`; retarget AC-30 from Timeline Diff to reveal that list; encode GAP-010/011 as explicit miss-or-fix decisions; never watch the workspace for attribution.
