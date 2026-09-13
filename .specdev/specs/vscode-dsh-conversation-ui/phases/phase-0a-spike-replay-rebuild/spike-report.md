# Spike Report — T-0a Authoritative Log Replay Rebuild

| Field | Value |
|-------|-------|
| **Gate** | T-0a |
| **Verdict** | **PASS** |
| **Date (UTC)** | 2026-09-08T02:14:15Z |
| **Slug / Phase** | `vscode-dsh-conversation-ui` / `phase-0a-spike-replay-rebuild` |
| **Environment** | Linux; Node 24.3.0 (`/usr/local/n/versions/node/24.3.0`); repo root |
| **Host layer** | L1 (vitest + real JSONL persistence); no Extension Host |

## Method

1. Mount `@deepseek-ai/dsh-session-persistence-jsonl` over a temp `root` (`compression: 'none'` for readable fixtures; production default remains `zstd` — API path identical).
2. Materialize three fixtures via `create` → `append` → **`flush`** → `close` (writer retired; log remains on disk — persistence half of agent dispose).
3. Cold-read via `open(id, 'read')` + `handle.read(0)` and via `readColdSessionLog` (open read + in-memory `interruptedTurnClosers`).
4. Fold once (no paging) with Spike helpers in `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts`:
   - messages: `user/message` + `assistant/message` (roles, order, seq)
   - Timeline: `turn` / `step` / `tool` rows
   - Diff probe: recoverable `tool/result.meta.diffs` only (never workspace files)
   - Incomplete: open turn on raw disk **or** `turn/end {interrupted}` after cold balance
5. Reopen a second Cordis Context on the same `root` and `list` / `stat` / cold-read (cross-instance visibility).

## Command (repeatable)

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts

# or:
bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/test-scripts/run-spike-t0a.sh
```

**Result:** `Test Files 1 passed | Tests 4 passed` (exit 0).

## Evidence by AC

| AC | Result | Evidence |
|----|:------:|----------|
| **AC-80** | PASS | This report + script above; verdict single **PASS**; AD-CU update suggestions below |
| **AC-30 / AC-47** | PASS | Fixture with diffs: after writer close, cold events === fixture; folded messages `['user','assistant']` texts match; turn/step/tool present; full log from one `read(0)` |
| **AC-76** | PASS | Fixture A (`meta.diffs` with `oldText`/`newText`) → `available=true`, hunkCount=1; Fixture B (no diffs) → `available=false`; patch-only meta rejected; no workspace FS consulted |
| **AC-77** | PASS | Open-turn fixture: raw has no `turn/end`; `probeIncomplete.openTurnInRaw=true`; cold adds `turn/end {interrupted}`; disk unchanged (closers memory-only) |

### Fixtures

| Id | Contents |
|----|----------|
| `t0a-balanced-with-diffs` / `t0a-with-diffs` | Balanced turn + `tool/result.meta.diffs` recoverable snapshot |
| `t0a-without-diffs` | Balanced turn + tool result **without** diffs |
| `t0a-open-turn` | `turn/start` + user/assistant mid-step; **no** `turn/end` |
| `t0a-survive-dispose` | Balanced no-diff; second Context list/stat/read |

## Selected read-log seam (for ReplayHydrator)

| Rank | Seam | Spike finding |
|------|------|---------------|
| **1 — Prefer** | ide-bridge thin frames `session/read-log` (+ optional `session/stat` / list) → **`readColdSessionLog(persistence, id)`** (or equivalent: `open('read')` + `interruptedTurnClosers`) | Matches AD-CU-2 priority #1; keeps SDK stdout closed; mirrors existing Host `session/dispose` pattern; cold balance covers AC-77 without mutating disk |
| **2 — Spike proof only** | Direct persistence / `readColdSessionLog` in vitest (this Gate) | Sufficient for PASS; not a product seam |
| **Avoid** | New SDK stdout methods | Conflicts with AD-8 closed method set |

**Payload note:** Prefer returning cold-balanced `events` (plus `header`) to Extension so ReplayHydrator does not reimplement interrupt closers. Diff/incomplete probes stay Host-side pure folds over that array.

**Not landed in this Spike:** ide-bridge RPC frames (documented only; phase-2 implements).

## AD-CU update suggestions (Spike → design backfill)

Confirm and write into `design.md`「设计修订记录」after HG review:

### AD-CU-2 (projection / read seam) — update

1. **Lock read API:** Host → ide-bridge `session/read-log` → `readColdSessionLog` (preferred) or `sessionPersistence.open(id,'read')` + in-memory `interruptedTurnClosers`. Drop “选型意向”; mark SDK stdout as **rejected** for cold read.
2. **ReplayHydrator contract:** One-shot fold of the returned event array into `messages/replace` + Timeline bulk apply; no pagination; component name stays **ReplayHydrator**.
3. **Optional:** `session/stat` / list on the same bridge for history open preflight (existence / revision), still not on SDK stdout.

### AD-CU-6 (Diff / incomplete) — confirm with evidence

1. Diff enablement = presence of **recoverable** `meta.diffs` entries (`path: string`, `newText: string`, `oldText: string | null`). Patch-only or missing fields → Diff unavailable. Never use workspace files as before/after.
2. Incomplete UI signal = raw open turn **or** cold `turn/end.reason.kind === 'interrupted'`. Prefer hydrating from cold-balanced events so interrupted turns always show a closer.

### T-0a Spike status

Update design header / Spike Gate section: **T-0a = PASS** (this report). Phase-2 replay slice may proceed pending human confirmation of AD-CU edits.

## Out of scope (unchanged)

- Product Conversation Webview / history UI
- ide-bridge frame implementation
- SDK stdout expansion
- `packages/core/agent-loop` changes
- Continue / T-0b

## Degradation (if this were FAIL)

N/A — Gate **PASS**. Phase-2 replay rebuild is unblocked by this Spike.
