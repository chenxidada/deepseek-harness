# Repository Exploration Report — phase-0-spike-attribution-snapshot

> Spike Gate focus: Can vscode-dsh **attribute** DSH workspace writes via `tool/result.meta.diffs`, and where/how should **SnapshotStore** live? Spike status at exploration time: **NOT RUN**.

## 1. Task Context

Phase 0 must produce a single PASS/FAIL `spike-report.md` answering AC-S1…AC-S3 / D-10 before any phase-2/3 product ChangeList work. This exploration maps the **live** path from tool-fs (and siblings) → durable `tool/result.meta` → SDK `session.event` → `IdeSessionHost` → `TimelineStore` / ReplayHydrator, documents recoverable fields (`path` / `oldText` / `newText`), false-positive test hooks, and extension storage surfaces suitable for SnapshotStore. It does **not** implement attribution, ChangeStore, or UI. Code reference / `@path` work is out of scope (parallel `phase-1-code-context`).

## 2. Repository Overview

- **Language / packaging**: TypeScript ESM monorepo (`pnpm`), Cordis plugin compositions.
- **IDE surface**: `apps/vscode-dsh` — Extension Host + Conversation Webview; spawns `dsh --profile ide` (base + sdk-app + ide-bridge). Stdout = SDK JSON-RPC; Host approvals use `DSH_IDE_BRIDGE_SOCK`.
- **Write tools in ide**: `packages/bundle/base/cordis.patch.yml` mounts `@deepseek-ai/dsh-tool-fs` (`write` / `edit` / `read` / `read_image`) and `@deepseek-ai/dsh-tool-str-replace-editor`, plus bash/pwsh. ide patch only adds ide-bridge.
- **Persistence split**:
  - **Authority session log**: under DSH_HOME / session-persistence (via runtime + `session/read-log`). Snapshots must **not** write here (AD-CCD-3 / AC-24).
  - **Extension index**: `workspaceState` Memento (`ExtensionIndex`, key `dsh.conversationIndex`) — metadata only, no message bodies / file blobs.
  - **SnapshotStore (planned)**: extension-local files under `globalStorageUri` or workspace `storageUri` (design appendix A.3) — **not implemented yet**.

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|--------|
| `packages/fs/tool-fs/src/write.ts` | `presentationMeta` → `meta.diffs`; **create / identical overwrite → `diffs: []`** | 👁 |
| `packages/fs/tool-fs/src/edit.ts` | `presentationMeta` → `computeHunkDiffs(before, after)` | 👁 |
| `packages/fs/tool-fs/src/diff.ts` | `FileDiff` shape; `DIFF_CONTEXT = 3` contextual hunks; `diffsFromMeta` | 👁 |
| `packages/core/tools/src/index.ts` ~1797 | Attaches `presentationMeta` onto successful `tool/result.meta` (parent-only) | 👁 |
| `packages/core/session/src/types.ts` | `tool/result` event: `message` + optional opaque `meta` | 👁 |
| `packages/sdk/server` + `packages/sdk/client` | Streams every append as `session.event` | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | `client.subscribe()` → `onNotification` fan-out; `readSessionLog` | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `timeline.apply(notification)`; AC-30 `diff-summary`; assistant projection | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` | `narrowDiffs` / `writeDiffsForSession(Tree)` / `changedFilesForLatestTurn` | 👁 |
| `apps/vscode-dsh/src/diff-entry.ts` | Post-hoc `vscode.diff` via virtual `dsh-diff` (both sides from log) | 👁 |
| `apps/vscode-dsh/src/replay-hydrator.ts` | `recoverableDiffsFromMeta`; cold-log Diff rebuild | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | Existing durable extension storage pattern (`workspaceState`) | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.test.diffAvailability` / `changedFileCount`; **no** `storageUri` on `ExtensionContextLike` yet | 👁 |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | `FAKE_EMIT_WRITE_DIFF` injects recoverable `meta.diffs` | 👁 |
| `apps/vscode-dsh/tests/timeline-diff.integration.spec.ts` | End-to-end notify → TimelineStore diffs | 👁 |
| `apps/vscode-dsh/tests/timeline-projector.spec.ts` / `phase5-should-polish.spec.ts` | Unit inject patterns for turn + diffs | 👁 |
| `packages/fs/tool-str-replace-editor/src/index.ts` | Diff only on `presentCall`; **no `presentationMeta`** → no log `meta.diffs` | 👁 |
| `docs/wiki/VS Code IDE 集成/Timeline 与事后 Diff.md` | Documents GAP-010 / GAP-011 (wiki may lag code on Diff sides) | 👁 |
| Prior: `phases/phase-1-code-context/repo-exploration.md` | Composer/prompt path only — **unchanged** relevance for Spike | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Live attribution source (AD-CCD-1 candidate) ✅ CONFIRMED

```
tool-fs write/edit execute
  → ToolsService createSuccessResult
       presentationMeta(args, value) → meta { diffs: FileDiff[] }
  → session.append('tool/result', { message, meta })
  → SDK server notify('session.event', { sessionId, event })
       │
       ▼
IdeSessionHost.watchTransport → notificationListeners
       │
       ▼
ConversationController.onSdkNotification
  timeline.apply(notification)          # ALL session.event / status / subagent
  if assistant/message → projectAssistantMessage + maybeAppendDiffSummary
       │
       ▼
TimelineStore.applySessionEvent('tool/result')
  metaDiffs = narrowDiffs(data.meta)    # path + newText + oldText:string|null
  push TimelineItem { diffs?, filePath?, callId?, toolName? }
       │
       ▼
writeDiffsForSession(Tree) / changedFilesForLatestTurn
  → dsh.reviewWorkspaceDiffs / dsh.test.diffAvailability / AC-30 diff-summary
```

**✅ CONFIRMED field contract** (`TimelineDiffHunk` / `FileDiff` / `recoverableDiffsFromMeta`):

| Field | Required for recoverable | Notes |
|-------|:------------------------:|-------|
| `path` | yes | string, non-empty |
| `newText` | yes | string (may be `''`) |
| `oldText` | yes | `string` **or** `null`; **missing key → reject** (never coerce to `''`) |

No other meta keys are consumed by vscode-dsh today.

### Path B — Cold replay (same meta contract) ✅ CONFIRMED

```
Host bridge session/read-log
  → ReplayHydrator.foldTimeline / recoverableDiffsFromMeta(data.meta)
  → TimelineStore.replace(sessionId, items)
```

### Path C — L2 inject without real tools (Spike / AC-S3 harness) ✅ CONFIRMED

```
Fake IdeSessionHost.onNotification OR TimelineStore.apply directly
  session.event tool/result { meta: { diffs: [...] } }
  (+ turn/start … turn/end for latest-turn window)
```

Fixtures already used:

- Env: `FAKE_EMIT_TURN_EVENTS` + `FAKE_EMIT_WRITE_DIFF` on `fake-sdk-runtime.mjs`
- Unit: `phase5-should-polish.spec.ts` builds `HarnessNotification` and calls `notify?.(event(...))`
- Probe: `dsh.test.diffAvailability`, `dsh.test.changedFileCount`

### Path D — What does **not** produce log `meta.diffs` ✅ CONFIRMED / ⚠️ coverage hole

```
str_replace_editor  → presentCall diffs only; no presentationMeta → tool/result.meta absent
bash / pwsh writes  → no diffs meta (expected miss under 宁可漏记)
write CREATE        → presentationMeta returns { diffs: [] }  # GAP-010
write identical     → { diffs: [] }
FileSystemWatcher / onDidSave → NOT wired; must stay unused for attribution (AD-CCD-1)
```

## 5. Likely Impact Surface

| Area | Change for Spike / later | Risk |
|------|--------------------------|------|
| New probe modules under `apps/vscode-dsh/tests/` (attribution + storage dry-run) | **Add** (preferred Spike evidence) | Low |
| Optional thin helpers (e.g. `attribution-candidates.ts`) — Spike-only, not product UI | **Add** if needed for AC-S3 | Low |
| `ExtensionContextLike` + activate | **Extend** with `globalStorageUri` / `storageUri` for SnapshotStore dry-run | Medium (tests must fake URIs) |
| `TimelineStore` / `diff-entry` / AC-30 | **Reuse read-only** for Spike; product ChangeAttributor later may **fork collection** (turn-window + merge) — do **not** overload Timeline Diff UI as ChangeStore | Medium if Spike mutates product semantics |
| `packages/core/agent-loop` | **Forbidden** (AD-CCD-7) | — |
| Authority session log / ExtensionIndex Memento | **Must not** store snapshot plaintext | High if violated |
| `tool-fs` presentationMeta | Out of Spike product scope; may be **cited** as coverage FAIL reason or follow-up debt | High for create-path coverage |

## 6. Existing Constraints / Conventions

- **AD-CCD-1**: Attribute only from turn-window `tool/result` recoverable `meta.diffs` (or Spike-documented equivalent). Forbid naked watcher / all-saves.
- **AD-CCD-3 / AC-24**: Snapshots + review state extension-local; logs metadata/stats only.
- **AD-CCD-5**: Same turn + same path → merge first `oldText` + last `newText` (product phase-2; Spike should note hunk vs full-file).
- **AD-CCD-6 / N-4**: Index vs blob lifecycle; openTabSet / unreverted retention; session-delete clears; byte-budget LRU.
- **AD-CCD-7**: Implement in `apps/vscode-dsh` (+ ide bundle only for AC-3b elsewhere).
- **Registrations / stores**: Prefer pure stores (TimelineStore / MessageStore pattern) + Host wiring; L2 via `dsh.test.*`.
- **Recoverable Diff rule (AD-CU-6)**: `oldText` must be present as `string|null`; patch-only rejected.
- **Post-hoc Diff only**: `DEFAULT_POST_HOC_DIFF_ONLY = true`; mid-run confirm out of scope.
- **ExtensionIndex**: Immediate `workspaceState` writes; workspace-keyed; never chat bodies — pattern for **index** metadata, not multi-MiB blobs.
- **Tests**: Prefer keyless vitest under `apps/vscode-dsh/tests/`; reuse fake SDK runtime; Spike Gate needs runnable commands in `spike-report.md`.

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| Live path session.event → TimelineStore.diffs works when meta has recoverable hunks | ✅ CONFIRMED | Integration + unit fixtures |
| `narrowDiffs` / `recoverableDiffsFromMeta` field rules | ✅ CONFIRMED | Reject missing `oldText` |
| write **create** logs `meta.diffs: []` → Timeline sees **no** Diff | ✅ CONFIRMED | tool-fs tests + wiki GAP-010 |
| edit/write **update** meta uses **contextual hunks** (`DIFF_CONTEXT=3`), not always full-file before/after | ✅ CONFIRMED | `diff.ts`; small files may look “whole”; large files → partial snippets |
| str_replace_editor never attaches result `meta.diffs` | ✅ CONFIRMED | no `presentationMeta` |
| bash/shell workspace writes invisible to Diff attribution | ✅ CONFIRMED | no diffs meta |
| If Spike attributes **only** via non-empty recoverable meta.diffs, user save cannot false-positive | ✅ CONFIRMED | No FS watcher today; AC-S3 is mainly “don’t add watcher” + inject vs non-inject contrast |
| Whether contextual hunks suffice as SnapshotStore revert before-images | ⚠️ HYPOTHESIS | Design assumes full old/new; tool-fs meta often **hunk-local**. Spike must measure and may require controlled full-file snapshot at tool/call (appendix A.2) → possible Gate FAIL or design revision |
| No dedicated `delete` tool with diffs meta | ✅ CONFIRMED | Deletes via edit empty / bash → likely miss under 宁可漏记 |
| Live assistant `ChatMessage.id` is `randomUUID()`, not SDK `message.id`; replay hydrator prefers SDK id | ✅ CONFIRMED | sourceMessageId stability across live/replay is a phase-2 risk; Spike should document preferred key (`turn` + projected id vs SDK id) |
| Suitable blob root: `context.storageUri` (workspace) vs `globalStorageUri` | ⚠️ HYPOTHESIS | Neither used in code today; A.3 allows both. Recommend workspace `storageUri/changes/<sessionId>/` or global + `workspaceKey` mirror of ExtensionIndex — Spike must dry-run write/read/delete without touching session logs |
| Wiki claims Diff right side prefers workspace file | ❌ Speculation / stale | Current `diff-entry.ts` uses **both** sides as `dsh-diff` virtual docs from log |
| Byte budget / prune numbers | ❓ UNKNOWN | Design names LRU policy; no coded constants yet — Spike must propose concrete limits |

## 8. Uncertain / Unverified

- **Real-API write→session.event→extension** with production model (only fake/runtime unit paths verified here). Spike Gate requires at least L2 inject; real e2e optional if environment lacks key.
- Exact on-disk layout of DSH session logs under default `dshHome` for this Extension Host spawn (do not write Spike blobs there — verify path separation in dry-run).
- Whether ide profile ever prefers `str_replace_editor` over `write`/`edit` in practice (coverage hole magnitude).
- Multi-root path normalization for attribution keys (phase-1 owns `@path` multi-root; Spike should record absolute vs relative `path` as stamped by tool-fs `displayPath`).
- Subagent child `session.event` diffs: TimelineStore trees collect them via `writeDiffsForSessionTree`; N-2 says nest into parent top-level turn — Spike should confirm tree collection vs top-level-only for Gate wording.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 活跃债务为空 | N/A | ✅ 无已注册桩需校验 |

### Stub Detection Summary

- ✅ Confirmed stubs (matching registry): **0**
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0** in vscode-dsh attribution/snapshot code (feature **not started** — no `ChangeAttributor` / `SnapshotStore` / `ChangeStore` symbols).

### Related known gaps (chat-ready / wiki — not in this workflow registry)

| ID | Location | Behavior | Spike relevance |
|----|----------|----------|-----------------|
| GAP-010 | tool-fs write create / identical → `diffs: []`; Timeline has **no** call-args fallback | Create writes silent to Diff/attribution | Must appear in AC-S1 coverage / FAIL or debt |
| GAP-011 | Relative-path Diff UX (wiki) | Historical; code now both-sides virtual | Low for Spike Gate |

Do **not** treat Timeline empty-create silence as a “stub” — it is intentional tool-fs presentationMeta + missing vscode fallback.

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `apps/vscode-dsh/src/timeline-store.ts` (`narrowDiffs`, `changedFilesForLatestTurn`, `writeDiffsForSessionTree`)
2. ⭐ **MUST READ** — `packages/fs/tool-fs/src/write.ts` + `edit.ts` + `diff.ts` (what actually lands in `meta.diffs`)
3. ⭐ **MUST READ** — `apps/vscode-dsh/src/replay-hydrator.ts` (`recoverableDiffsFromMeta`)
4. ⭐ **MUST READ** — `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` + `tests/timeline-diff.integration.spec.ts` + `tests/phase5-should-polish.spec.ts` (inject / probe patterns for AC-S1/S3)
5. ⭐ **MUST READ** — `design.md` appendix A + AD-CCD-1 / AD-CCD-6 / N-4; `phases/.../spec.md` AC-S*
6. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/diff-entry.ts` (reuse for Diff open; **avoid** as ChangeStore)
7. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/extension-index.ts` + `extension.ts` `ExtensionContextLike` / `dsh.test.diffAvailability`
8. 🔷 **SHOULD READ** — `packages/fs/tool-str-replace-editor/src/index.ts` (coverage hole)
9. 🔹 **OPTIONAL** — `docs/wiki/VS Code IDE 集成/Timeline 与事后 Diff.md`; chat-ready phase-5 explorations

---

## Spike implementer checklist (derived)

### AC-S1 — Can meta.diffs stably identify DSH writes?

**Measure at least:**

1. Inject recoverable `meta.diffs` → candidates / Timeline hunks non-empty (PASS path).
2. write-create style `{ diffs: [] }` → **not** attributed unless Spike documents an allowed fallback (call-args synthesis) — today Timeline misses (GAP-010).
3. State clearly: attribution signal exists for **edit / non-empty update write** with valid meta; **not** universal for all DSH disk mutations (bash, str_replace_editor, create).
4. If full-file SnapshotStore needs full before/after: prove whether meta hunks are enough or A.2 controlled snapshot is required → may drive FAIL or design revision (not silent PASS).

### AC-S2 — Snapshot storage

- Extend / fake `ExtensionContext` with `storageUri` and/or `globalStorageUri`.
- Dry-run: write blob under `…/changes/<sessionId>/<snapshotRef>` → read → delete.
- Index keys: `sessionId` + `snapshotRef`; lifecycle note vs openTabSet / session delete / byte LRU (propose numbers).
- Assert path ≠ session log / ExtensionIndex Memento blob dump; logs only metadata.

### AC-S3 — False-positive negation

- Candidate set **A**: after injecting recoverable diffs for path `P`.
- Candidate set **B**: after simulating user save / format of path `Q` **without** meta.diffs (and without adding watchers).
- Assert `Q ∉` attributed set; document exact test command.
- **Do not** claim PASS if attribution is implemented via FileSystemWatcher.

### Reuse vs avoid

| Reuse | Avoid / do not fork as product ChangeStore |
|-------|--------------------------------------------|
| `TimelineStore.apply` / `narrowDiffs` / `recoverableDiffsFromMeta` as **signal parsers** | Treating Timeline TreeView / `diff-summary` as the change list |
| `dsh.test.*` + fake SDK inject patterns | Writing snapshots into session log or `workspaceState` bodies |
| `diff-entry` only for optional Diff open smoke | `FileSystemWatcher` / `onDidSave` attribution |
| ExtensionIndex lifecycle ideas (session clear) | Mutating `agent-loop` |

### Gate report gaps to close in `spike-report.md`

1. Coverage matrix: tool × operation × meta.diffs shape × attributed?
2. Hunk vs full-file decision for SnapshotStore.
3. Chosen storage root + prune constants.
4. sourceMessageId keying note (live UUID vs SDK id) — even if product is phase-2.
5. Explicit PASS or FAIL; on FAIL block phase-2/3 only.
)
