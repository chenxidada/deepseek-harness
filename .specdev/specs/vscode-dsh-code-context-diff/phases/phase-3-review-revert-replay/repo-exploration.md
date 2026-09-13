# Repository Exploration Report — phase-3-review-revert-replay

> Per-phase exploration for mark-reviewed, single/batch revert (conflict + AC-17), replay path+stats (AC-22), log safety (AC-24), and chat-ready regression (AC-25).  
> Live-verified on branch `impl-phase-3-review-revert-replay` (2026-09-10).  
> Phase Entry Gate: active registry table empty; prior GAP/DEBT closed in phase-1/2.  
> Reuses phase-2 exploration as background; sections below mark **unchanged** vs **updated for Phase 3**.

## 1. Task Context

Phase 3 builds on the phase-2 ChangeList data surface (attribution → `ChangeStore` + full-file `SnapshotStore` + message-attached `change-list` UI) to deliver: **mark reviewed** without any workspace write (AC-11); **single-file and batch revert** via VS Code document / `workspace.fs` with create-delete confirm, delete-restore conflict, later-turn confirm, and N-3 content-hash dirty gate (AC-13…18, AD-CCD-10); **new ChangeRecords after revert** when DSH writes again (AC-16); **history replay** showing at least path + stats without inventing pruned blob bodies (AC-22 / N-4); **no snapshot plaintext in extension logs** (AC-24); and **chat-ready Must regression** (AC-25). Out of scope: write-approval gates, Git-driven revert, mid-version restore, agent-loop edits, new code-reference work.

## 2. Repository Overview

| Layer | Location | Role for Phase 3 |
|-------|----------|------------------|
| Extension Host + Webview | `apps/vscode-dsh/` | Primary implementation target (AD-CCD-7) |
| Change domain (phase-2 delivered) | `apps/vscode-dsh/src/change/` | Types, ChangeStore, SnapshotStore, ChangeAttributor, ignore rules — **no `revert.ts` yet** |
| Chat panel | `apps/vscode-dsh/src/chat-panel/*` | Protocol + Host routing + Webview change-list rows (open / get-diff / reveal-source only) |
| Conversation | `apps/vscode-dsh/src/conversation-controller.ts` | Live settle → change-list projection; history hydrate **does not** rebuild ChangeStore |
| Confirm UX patterns | `apps/vscode-dsh/src/interaction-ui.ts` | `showWarningMessage` confirm helpers (reuse style for revert gates) |
| Dirty-doc pattern | `apps/vscode-dsh/src/code-context/selection-ask.ts` | `isDirty` + `save()` duck type (AC-17 OR with hash) |
| Chat-ready regression entry | `apps/vscode-dsh/tests/chat-ready-regression.spec.ts` + `test-scripts/run-chat-ready-regression.sh` | AC-25 smoke entry |
| Authority log | DSH session JSONL via `session/read-log` | Must never hold snapshot plaintext (AC-24 / AD-CCD-3) |

- **Language**: TypeScript ESM monorepo (`pnpm`); vitest L2 under `apps/vscode-dsh/tests/`.
- **Git branch**: `impl-phase-3-review-revert-replay` (confirmed).
- **Missing product module**: `apps/vscode-dsh/src/change/revert.ts` does **not** exist (expected phase-3 deliverable).

## 3. Most Relevant Areas

| Path | Why | Source | vs phase-2 |
|------|-----|--------|------------|
| `apps/vscode-dsh/src/change/types.ts` | `ChangeStatus` already includes `reviewed` / `reverted`; `afterContentHash` ready for AC-17 | 👁 | unchanged type surface |
| `apps/vscode-dsh/src/change/change-store.ts` | In-memory index; `upsert` by `(sessionId, turn, path)`; **no persist / updateStatus helper / list-by-path across turns** | 👁 | **updated emphasis** for status + AC-22 |
| `apps/vscode-dsh/src/change/snapshot-store.ts` | `read` / `write` / `clearSession` / `pruneToBudget`; `hashTextContent`; prune comment says reverted-first is **phase-3** | 👁 | **updated** — restore source + prune policy |
| `apps/vscode-dsh/src/change/change-attributor.ts` | Sets `status: 'unreviewed'`, fills `afterContentHash`; always new `changeId` on settle | 👁 | unchanged intake; AC-16 depends on new turn upsert |
| `apps/vscode-dsh/src/change/index.ts` | Public exports — will need `revert` exports | 👁 | gap |
| `apps/vscode-dsh/src/change/revert.ts` | **Expected new module** (spec output) | 👁 | **missing** |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Has `change/get-diff|open|reveal-source`; **no** `mark-reviewed` / `revert` / `revert-many` | 👁 | **updated** hang points |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | Routes get-diff/open/reveal; deps hooks pattern for extension wiring | 👁 | extend same pattern |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | change-list row UI: open + Diff + 来源; status chip only special-cases `unreviewed`→`未查看` | 👁 | add reviewed / revert / batch UI |
| `apps/vscode-dsh/src/extension.ts` | `requestChangeDiff` / `Open` / `RevealSource`; `VsCodeLike.workspace` **lacks** `fs` / `textDocuments` / `applyEdit` | 👁 | **updated** — must widen duck type for AD-CCD-10 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `settleChangeListProjection`; `openFromHistory` / restore hydrate **omit** ChangeStore + change-list | 👁 | **critical AC-22 gap** |
| `apps/vscode-dsh/src/replay-hydrator.ts` | Authority fold → text + timeline only; **no** `kind: 'change-list'` | 👁 | **updated** |
| `apps/vscode-dsh/src/interaction-ui.ts` | Confirm dialog patterns for Stop/Delete | 👁 | reuse for AC-14/15/17 / AD-CCD-10 |
| `apps/vscode-dsh/src/code-context/selection-ask.ts` | Dirty save gate pattern | 👁 | AC-17 `isDirty` OR |
| `apps/vscode-dsh/tests/phase2-change-list-display.spec.ts` | Phase-2 L2 fixtures / Host fake patterns | 👁 | regression baseline |
| `apps/vscode-dsh/tests/chat-ready-regression.spec.ts` | AC-25 entry documentation | 👁 | regression |
| Spec: `design.md` N-3/N-4, AD-CCD-3/6/10, A.3 index note | Contract truth | 👁 | — |
| Spec: `tech-debt-registry.md` | Active empty | 👁 | Entry Gate clear |

## 4. Key Entry Points / Call Paths

### Path A — Mark reviewed (target; not implemented) ⚠️ HYPOTHESIS hang points ✅ CONFIRMED absence

```
Webview change-list row
  → post { type: 'change/mark-reviewed', changeId }
       │
       ▼
ChatPanelHost.handleMessage  (NEW branch)
  → deps.requestMarkReviewed(changeId)
       │
       ▼
extension / ConversationController
  → ChangeStore.upsert({ ...record, status: 'reviewed', updatedAt })
  → refresh MessageStore change-list payload for that turn
  → panelHost.pushFullState() / targeted update
  → MUST NOT call workspace write / SnapshotStore.write
```

**Hang points (✅ CONFIRMED live):**
- Protocol union + `parseWebviewToHostMessage` in `protocol.ts` (after existing `change/*`).
- `ChatPanelHost` inbound switch (~L476) next to `change/get-diff`.
- Webview row actions in `chat-panel-provider.ts` ~L638–707 (alongside Diff / 来源).
- Status label currently: `unreviewed` → `未查看`; else raw `String(status)` — needs `reviewed` / `reverted` product copy.

### Path B — Single / batch revert + conflict gates (target) ⚠️ HYPOTHESIS

```
Webview
  → change/revert { changeId }  OR  change/revert-many { changeIds[] }
       │
       ▼
Host → extension confirm gates (interaction-ui style):
  1. kind=created → confirm delete (AC-14)
  2. kind=deleted → if path exists → conflict confirm (AC-15)
  3. later unreverted same path (higher turn) → 「后续变更」confirm (AD-CCD-10)
  4. AC-17: hash(current) != afterContentHash OR open doc isDirty → 「将丢失后续改动」
  cancel any gate → no write, status unchanged
       │
       ▼
revert.ts (NEW) — AD-CCD-10 write surface:
  open doc? → edit via TextDocument / WorkspaceEdit
  else → workspace.fs write/delete/create
  restore image from SnapshotStore.read(sessionId, snapshotRef).oldText
       │
       ▼
on success: status=reverted; optional blob retention (N-4 / AD-CCD-6)
on failure: error to user; status unchanged (AC-13)
batch: per-file success/fail array (AC-18)
same-path many: sort by turn DESC before execute (AD-CCD-10)
```

**Snapshot restore (✅ CONFIRMED API):**
- `SnapshotStore.read(sessionId, snapshotRef)` → `{ oldText, newText, path }` or `undefined` if pruned/missing.
- Revert of `modified` / `deleted` needs `oldText`; `created` revert deletes file (oldText was `null`).
- If `snapshotRef` missing or `read` returns undefined → fail without inventing content (aligns AC-12 / AC-22 prune policy).

**AC-17 dirty (✅ CONFIRMED primitives, ⚠️ wiring):**
- `hashTextContent` in `snapshot-store.ts` (same as settle’s `afterContentHash`).
- `ChangeRecord.afterContentHash` set at settle ✅.
- Current workspace text: reuse `wireChangePipeline`’s `readWorkspaceText` / disk read.
- Open-buffer dirty: `selection-ask`’s `TextDocumentLike.isDirty` pattern; `VsCodeLike` today has **no** `workspace.textDocuments` — must extend duck type.

### Path C — Replay / cold start path+stats (AC-22) — gap ✅ CONFIRMED

**Current (broken for change-list replay):**

```
openFromHistory / restoreOpenTabs
  → host.readSessionLog
  → hydrateFromAuthoritativeLog  # text + timeline ONLY
  → messages.replace / timeline.replace
  → NO ChangeStore load
  → NO kind:'change-list' bubbles
```

**Phase-3 target (design A.3 + N-4):**

```
persist ChangeRecord metadata index under extension storage (NOT authority log)
  e.g. alongside <storageRoot>/changes/<sessionId>/ …
on openFromHistory / restore:
  load index → ChangeStore.upsert*
  inject / merge change-list messages under sourceMessageId (path + stats Must)
  get-diff: SnapshotStore.read → available true|false; false → reason, never forge bodies
pruneToBudget: prefer dropping reverted sessions first (phase-3), then oldest session
```

### Path D — Live attribution (phase-2) — unchanged ✅ CONFIRMED

```
tool/call → ChangeAttributor.noteToolCall (before-cache)
tool/result meta.diffs → ingestToolResult
assistant/message | turn/end → settleChangeListProjection
  → settleTurn → SnapshotStore.write + ChangeStore.upsert(status=unreviewed)
  → MessageStore kind:'change-list' (+ diff-summary when N>0)
```

## 5. Likely Impact Surface

| Area | Change type | Risk | Notes |
|------|-------------|:----:|-------|
| `change/revert.ts` (new) | Add | 🔴 High | Write-path correctness; create/delete/conflict; no agent-loop |
| `change/change-store.ts` | Extend | 🟡 Med | Status updates; cross-turn list-by-path for AD-CCD-10; optional durable index I/O |
| `change/snapshot-store.ts` | Extend prune | 🟡 Med | Reverted-first LRU (comment already anticipates) |
| `chat-panel/protocol.ts` + host + provider | Add messages + UI | 🟡 Med | mark-reviewed / revert / revert-many + batch UX |
| `extension.ts` VsCodeLike + handlers | Widen API + wire | 🔴 High | Needs `workspace.fs`, docs, edits; confirm dialogs |
| `conversation-controller.ts` | Hydrate + delete cleanup | 🔴 High | AC-22 inject lists; delete should clear ChangeStore + SnapshotStore (AD-CCD-6) — **today neither cleared** |
| `replay-hydrator.ts` | Possibly unchanged | 🟢 Low | Prefer extension-local index inject over stuffing authority log |
| Phase-2 tests / chat-ready suites | Regression | 🟡 Med | Must keep AC-6…12a/19/30 green |
| `agent-loop` / tool-fs | **Must not touch** | — | AD-CCD-7 |

## 6. Existing Constraints / Conventions

1. **AD-CCD-7**: Implement in `apps/vscode-dsh`; do not change agent-loop write model. Revert is the Feature’s only product write-back path.
2. **AD-CCD-3 / AC-24**: Snapshots + review state are extension-local; authority JSONL and `workspaceState` message bodies must not hold old/new plaintext. A.3 allows a **metadata** index under extension storage.
3. **AD-CCD-10**: Open document → document layer; closed → `workspace.fs`. Batch same-path → **turn descending**. Later unreverted turn confirm is distinct from AC-17 user-dirty copy.
4. **N-3 / AC-17**: SHA-256 of authoritative content vs `afterContentHash`, OR `isDirty` — **never mtime-only**.
5. **N-4 / AC-22**: Index metadata Must on replay; pruned blob → 「完整 diff 不可用」, no forged bodies (phase-2 get-diff already returns that reason string).
6. **AD-CCD-5**: Same turn same path merges at settle; upsert key `(turn, path)` — after revert, a **new turn** yields a new record (AC-16).
7. **Host↔Webview**: All frames go through `protocol.ts` parse + `ChatPanelHost` deps hooks (phase-2 pattern for get-diff/open).
8. **Confirm UX**: Prefer `interaction-ui.ts` / `showWarningMessage` style; cancel = no write.
9. **AC-10 wording**: Status chips must stay neutral (no “pending approval”); extend carefully for `reviewed` / `reverted`.
10. **Duck-typed vscode**: Tests inject partial `VsCodeLike`; new FS APIs must be optional-safe for L2.

## 7. Risks / Unknowns

| Item | Confidence | Detail |
|------|:----------:|--------|
| No `revert.ts` / no mark-reviewed / revert protocol | ✅ CONFIRMED | Glob + grep; UI rows lack buttons |
| ChangeStore memory-only; replay hydrate omits change-list | ✅ CONFIRMED | `openFromHistory` + `hydrateFromAuthoritativeLog` |
| `deleteConversation` does not clear ChangeStore / SnapshotStore | ✅ CONFIRMED | AD-CCD-6 session delete should clear `changes/<sessionId>/` — gap for phase-3 |
| `pruneToBudget` oldest-session only (not reverted-first) | ✅ CONFIRMED | Explicit comment: phase-3 |
| `VsCodeLike` lacks `workspace.fs` / textDocuments / applyEdit | ✅ CONFIRMED | extension.ts interface |
| AC-24: no OutputChannel / appendLine logging of blobs today | ✅ CONFIRMED | No extension logger hits for oldText; still must not add plaintext logs when implementing revert |
| Exact on-disk ChangeRecord index filename/layout | ⚠️ HYPOTHESIS | A.3 says “可放扩展 index”; phase-2 only wrote blob `*.json` |
| Whether replay inject merges into MessageStore by `sourceMessageId` vs turn | ⚠️ HYPOTHESIS | Live uses Host UUID; cold log prefers SDK message.id (A.3) — matching may be imperfect |
| Batch UI: checkbox vs “revert all” control | ❓ UNKNOWN | Spec allows 勾选或全部; product UX not locked in code |
| Whether open dirty buffer should auto-save before hash compare | ❓ UNKNOWN | N-3 says isDirty OR hash; selection-ask saves before cite — revert may only warn |

## 8. Uncertain / Unverified

| Symbol | What exists | Not verified |
|--------|-------------|--------------|
| `workspace.fs.writeFile/delete/createDirectory` via product VsCodeLike | Not typed on extension duck | Runtime vscode has them; L2 must stub |
| `WorkspaceEdit` / `applyEdit` for open docs | Not used in vscode-dsh today | Prefer document edit vs fs when open (AD-CCD-10) — behavior untested |
| Cross-turn “later unreverted” scan | No helper | Need `ChangeStore.list` filter by path + status + turn |
| Persist format for ChangeRecord index | None | Implementer must choose layout under storageRoot without putting blobs in workspaceState |
| `pushFullState` cost after every mark-reviewed | Exists | May need lighter status patch — unverified necessity |
| AC-25 full matrix runtime | Script exists | Not re-executed in this exploration |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| *(active table empty)* | — | — | — | ✅ no active debt |
| GAP-CCD-010 | tool-fs create/identical | 已解决 | Attributor still ignores empty diffs | ✅ 匹配 |
| GAP-CCD-011 | str_replace_editor | 已解决 | No presentationMeta intake | ✅ 匹配 |
| DEBT-CCD-001 | full-file blob vs hunk | 已解决 | settle writes full-file when before-cache present | ✅ 匹配 |
| GAP-CCD-012 / 013 / DEBT-CCD-002 | phase-1 polish | 已解决 | out of phase-3 scope | ✅ 匹配 |
| — | `change/revert.ts` | 未注册 | **file missing** (planned deliverable, not a stub) | ⚪ expected gap |
| — | `change/mark-reviewed` protocol | 未注册 | absent (phase-3 scope) | ⚪ expected gap |
| — | `deleteConversation` → SnapshotStore.clearSession | 未注册 | **missing cleanup** vs AD-CCD-6 | 🟡 candidate GAP (not a code stub; lifecycle hole) |

### Stub Detection Summary

- ✅ Confirmed stubs matching registry: **0** (active empty).
- ⚠️ Registry mismatch: **0**.
- 🔴 Unregistered stubs (empty body / fake return posing as done): **0** in `src/change/` product paths.
- ⚪ Expected phase-3 absences (not stubs): `revert.ts`, mark-reviewed / revert protocol & UI, durable ChangeRecord index, reverted-first prune, session-delete snapshot clear.

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `apps/vscode-dsh/src/change/snapshot-store.ts` (`read` / `hashTextContent` / `pruneToBudget`)
2. ⭐ **MUST READ** — `apps/vscode-dsh/src/change/change-store.ts` + `types.ts` (`afterContentHash`, status enum)
3. ⭐ **MUST READ** — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts` (extend change/* like get-diff)
4. ⭐ **MUST READ** — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` change-list row block (~617–710)
5. ⭐ **MUST READ** — `apps/vscode-dsh/src/extension.ts` `requestChangeDiff` / `openChangedPath` / `VsCodeLike` / `wireChangePipeline`
6. ⭐ **MUST READ** — `apps/vscode-dsh/src/conversation-controller.ts` `settleChangeListProjection` + `openFromHistory` + `deleteConversation`
7. 🔷 **SHOULD READ** — `design.md` N-3/N-4, AD-CCD-6/10, appendix A.3
8. 🔷 **SHOULD READ** — `interaction-ui.ts` confirm helpers; `selection-ask.ts` dirty pattern
9. 🔷 **SHOULD READ** — `tests/phase2-change-list-display.spec.ts` Host fake + change protocol fixtures
10. 🔹 **OPTIONAL** — `tests/chat-ready-regression.spec.ts` + `run-chat-ready-regression.sh` for AC-25
11. 🔹 **OPTIONAL** — phase-2 `implementation.md` (delivered surface; do not re-build attribution)

### Phase-2 delivered vs Phase-3 gaps (summary)

| Delivered (phase-2) | Still missing (phase-3) |
|---------------------|-------------------------|
| Attribution + ChangeStore + SnapshotStore blobs | `revert.ts` write-back |
| Message change-list + get-diff / open / reveal-source | mark-reviewed + revert(+many) protocol/UI |
| `afterContentHash` populated | AC-17 gate using hash + isDirty |
| Status type includes reviewed/reverted | Status transitions + labels |
| get-diff prune → unavailable reason | AC-22 cold/replay index hydrate + path/stats bubbles |
| prune oldest-session | reverted-first prune; session-delete clear |
| AC-24 for message bodies / authority (phase-2 verified) | Keep logs metadata-only when adding revert diagnostics |
