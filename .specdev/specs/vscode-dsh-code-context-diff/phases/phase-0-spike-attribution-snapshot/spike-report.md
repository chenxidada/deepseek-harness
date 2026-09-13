# Spike Gate Report — phase-0-spike-attribution-snapshot

| Field | Value |
|-------|-------|
| **Verdict** | **PASS** |
| Workflow | `vscode-dsh-code-context-diff` |
| Phase | `phase-0-spike-attribution-snapshot` |
| Date (UTC) | 2026-09-09 |
| Environment | Linux, Node + vitest keyless L2 (no model key) |

---

## AC-S1 — Can bridge / `tool/result.meta.diffs` stably attribute DSH writes?

### Method

1. Reuse production parsers: `recoverableDiffsFromMeta` (`replay-hydrator.ts`) and `TimelineStore.changedFilesForLatestTurn` / `narrowDiffs` (`timeline-store.ts`).
2. Spike helpers: `apps/vscode-dsh/tests/spike-attribution-helpers.ts` — `attributionCandidatesFromMeta`, `attributionPathsForLatestTurn`.
3. Inject `session.event` → `tool/result` with recoverable vs empty vs patch-only meta (no workspace watcher intake).

### Coverage matrix (tool × operation × meta → attributed?)

| Tool / path | Operation | `meta.diffs` shape | Attributed? | Notes |
|-------------|-----------|--------------------|:-----------:|-------|
| tool-fs `edit` | update | recoverable hunks (`path` + `oldText` + `newText`) | **Yes** | Primary PASS path |
| tool-fs `write` | update (before ≠ null) | contextual hunks via `computeHunkDiffs` | **Yes** | Same contract |
| tool-fs `write` | **create** / identical | `{ diffs: [] }` | **No** | GAP-010; 宁可漏记 |
| tool-str-replace-editor | any | no `presentationMeta` | **No** | Coverage hole; 宁可漏记 |
| bash / pwsh | disk writes | no diffs meta | **No** | Expected miss |
| User save / format | editor save | no `session.event` meta | **No** | AC-S3; must stay unattributed |
| Patch-only meta | — | missing `oldText` | **No** | AD-CU-6 reject |

### Answers

1. **Sufficient for stable attribution when recoverable `meta.diffs` are present** inside a top-level turn window (`turn/start` …). Bridge path `session.event` → TimelineStore is already proven by chat-ready fixtures; Spike reconfirmed with L2 inject.
2. **Not universal** for all DSH disk mutations — create / shell / str_replace_editor miss. Design AD-CCD-1 **宁可漏记** accepts these misses; they are **not** Gate FAIL.
3. **Controlled snapshot comparison (appendix A.2)** remains feasible as a *future* tool/call-bound fallback for create coverage, but is **not required** for attribution Gate PASS. False-positive bound: any comparison must stay bound to tool/call; never whole-workspace watch/save intake.
4. **Hunk vs full-file**: tool-fs `DIFF_CONTEXT = 3` stores **contextual hunks**, not always full-file before/after. For phase-2/3 SnapshotStore blobs used in revert, product **must** capture full-file images at attribution time (workspace read of `path` + after-image from tool result / disk) when hunks are partial; `meta.diffs` remains the **attribution signal**, not necessarily the sole blob payload. See design appendix A write-back.

### Commands

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts
```

**Result (2026-09-09):** `7 passed` — exit 0.

---

## AC-S2 — SnapshotStore location, keys, lifecycle, caps, prune

Aligned with design appendix A.3 / AD-CCD-6 / N-4 (locked below; written back to `design.md`).

| Item | Locked value |
|------|----------------|
| **Root** | Prefer `ExtensionContext.storageUri.fsPath` (workspace-scoped). Fallback: `globalStorageUri.fsPath` + `workspaceKey` segment (mirror ExtensionIndex). |
| **Layout** | `<storageRoot>/changes/<sessionId>/<snapshotRef>.json` |
| **Association keys** | `sessionId`, `snapshotRef`, `sourceMessageId`, `turn` |
| **Index vs blob** | ChangeRecord index (path/type/status/refs) may live in extension Memento/index; **blobs** only under `changes/` files — never in authority session JSONL, never chat bodies in `workspaceState`. |
| **Lifecycle** | openTabSet / unreverted retain blobs; session delete → `rm -rf changes/<sessionId>/`; byte-budget prune: **reverted first**, then **oldest session** dir (`lru-reverted-first-then-oldest-session`). |
| **Byte budget** | Soft total **200 MiB** per storage root; per-blob soft cap **2 MiB**. |
| **sourceMessageId note** | Live projection uses `randomUUID()`; cold replay prefers SDK `message.id`. Phase-2 must record the id used at list attach time and not assume live≡replay equality without hydrator mapping. |
| **Probe logs** | Metadata only (`blobPath`, `bytesWritten`, …) — no snapshot plaintext in extension/authority logs. |

### Dry-run evidence

Same vitest file — describe `Spike phase-0 — AC-S2 SnapshotStore dry-run`: write → read → delete under temp `workspaceStorage/changes/...`; authority marker under `.dsh/sessions/` **untouched** (`touchedAuthorityLog === false`).

Constants: `SNAPSHOT_STORE_SPIKE` in `spike-attribution-helpers.ts`.

---

## AC-S3 — False-positive negation (user manual save)

### Case

Inside an open turn window:

1. Inject recoverable `meta.diffs` for `src/dsh-owned.ts` → **must** appear in attribution set.
2. Simulate user manual save of `src/user-manual.ts` **without** emitting `meta.diffs` and **without** workspace watch/save intake → `src/user-manual.ts` **must not** appear in attribution set.

### Command + expected outcome

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts -t "user manual save"
```

**Expected:** test PASS; attribution paths `=== ['src/dsh-owned.ts']`; `user-manual.ts ∉` set; `simulateUserManualSave(...).emittedMetaDiffs === false`.

**Forbidden PASS evidence:** bare FileSystemWatcher / all-saves intake. Helpers assert no `vscode` watch/save API imports.

---

## Gate decision

| Criterion | Result |
|-----------|--------|
| AC-S1 | **PASS** — recoverable `meta.diffs` stably attributes; gaps documented under 宁可漏记 |
| AC-S2 | **PASS** — storage path/keys/lifecycle/caps locked + dry-run |
| AC-S3 | **PASS** — reproducible false-positive negation |

### Overall: **PASS**

- Allows `phase-2-change-list-display` / `phase-3-review-revert-replay` after HG-3 (phase-0).
- Does **not** block `phase-1-code-context`.
- design.md 附录 A updated with empirical lock-in + hunk→full-file blob rule.

### Deliverables

| Artifact | Path |
|----------|------|
| This report | `.specdev/specs/vscode-dsh-code-context-diff/phases/phase-0-spike-attribution-snapshot/spike-report.md` |
| Helpers | `apps/vscode-dsh/tests/spike-attribution-helpers.ts` |
| Tests | `apps/vscode-dsh/tests/spike-attribution-snapshot.spec.ts` |
| Design write-back | `.specdev/specs/vscode-dsh-code-context-diff/design.md` 附录 A |
| Debt | `.specdev/specs/vscode-dsh-code-context-diff/tech-debt-registry.md` (GAP-CCD-010 / GAP-CCD-011 / DEBT-CCD-001) |
