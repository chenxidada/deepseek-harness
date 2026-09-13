# Spike Report — T-0b Continue Capability (same-id / derive)

| Field | Value |
|-------|-------|
| **Gate** | T-0b |
| **Verdict** | **same-id** (PASS) |
| **Date (UTC)** | 2026-09-08T02:51:48Z |
| **Slug / Phase** | `vscode-dsh-conversation-ui` / `phase-0b-spike-continue-capability` |
| **Environment** | Linux; Node 24.3.0 (`/usr/local/n/versions/node/24.3.0`); repo root |
| **Host layer** | L1 (vitest + real JSONL persistence + AgentLoop); no Extension Host; no product Continue UI |

## Method

1. Mount Cordis harness: LLM + SessionStore + projection + system-prompt + tools + AgentRegistry + `JsonlSessionPersistence` (`compression: 'none'`) + AgentLoop; register `SpikeMockAdapter`.
2. **same-id path:** `agents.create` → completed turn → `dispose` → snapshot prefix via `open('read')` → second Context on same root → prove `agents.create(sameId)` throws `SessionAlreadyExistsError` → `agents.resume({ resumeSessionId })` → followup turn → assert `prefixUnchanged` (AC-66) and turn numbering continues (AC-32 core).
3. **derive path:** parent create/dispose → `agents.create(newId, { seed, parentSession, isSeeded, inheritedEventCount })` → child followup → parent cold-read unchanged; `continueLinkFromDerive({ fromId, toId })` for AC-67 banner data; child header carries `parentSession`.
4. **continueCapability probe:** `probeContinueCapability({ gateVerdict, sessionExists, resumeApiAvailable })` → `same-id` | `derive-only` | `unknown` (AC-28 / AD-CU-8); never binary 只读/可继续.
5. **IDE gap:** After dispose, create fails; write reopen still works. Static: SDK `createSession` always `agents.create` (never `resume`) — product Continue must not rely on today's `session/prompt` alone.

## Command (repeatable)

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0b-continue-capability.spec.ts

# or:
bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-0b-spike-continue-capability/test-scripts/run-spike-t0b.sh
```

**Result:** `Test Files 1 passed | Tests 4 passed` (exit 0).

## Evidence by AC

| AC | Result | Evidence |
|----|:------:|----------|
| **AC-68** | PASS | This report: single verdict **same-id**; AD-CU-8 update suggestions below; script above |
| **AC-66** | PASS | Resume after dispose: `after.slice(0, prefix.length)` event-equal to prefix; derive: parent events unchanged after child create+append |
| **AC-67** | PASS (demo) | Derive returns new id; header.`parentSession` + `{ fromId, toId }` link drive 「新会话 · 接续自 …」 (fallback path proven; Gate chose same-id) |
| **AC-32** | PASS (core) / gap (IDE) | Core: `agents.resume` restores same id to live and accepts followup. IDE SDK path today: create-only → post-dispose same-id create fails (`SessionAlreadyExistsError`); Host must add bridge `session/resume` (or equivalent) before product Continue |
| **AC-28** | PASS | Probe returns only `same-id` \| `derive-only` \| `unknown`; mapped to AD-CU-8 table; Gate constant for this PASS = `same-id` |

### Fixtures / cases

| Id / case | Role |
|-----------|------|
| `t0b-same-id-resume` | Lifecycle create → dispose → resume → second turn; prefix oracle |
| `t0b-parent` / `t0b-child` | Seeded derive with `parentSession` + continue link |
| probe table | NOT_RUN/FAIL/missing session/no resume API → `unknown`; Gate same-id → `same-id`; Gate derive-only → `derive-only` |
| `t0b-sdk-gap` | Post-dispose create fails; write open still available |

## Recommended Host / probe seam (phase-3)

| Rank | Seam | Finding |
|------|------|---------|
| **1 — Prefer same-id product** | ide-bridge `session/resume { sessionId }` → `ctx.agents.resume` (ACP `AcpSession.resume` pattern); optional `session/continue-capability` | Unlocks AD-CU-8 `same-id` Continue; keeps SDK stdout closed (AD-8) |
| **2 — Derive fallback** | bridge or Extension: `agents.create(newId, { seed, meta.parentSession, isSeeded })` + persist `continueLinks` | Use if product rejects resume; UI 「新会话 · 接续自 …」 |
| **3 — Spike proof only** | Direct `agents.resume` / create+seed in vitest (this Gate) | Sufficient for PASS |
| **Avoid** | Silent SDK `create` reuse after dispose; rewriting JSONL prefix; binary 只读/可继续 | Violates AC-66/28 |

**Not landed in this Spike:** ide-bridge frames, Extension Continue UI, SDK method changes (documented gap only).

## AD-CU update suggestions (Spike → design backfill)

Confirm and write into `design.md`「设计修订记录」after HG review:

### AD-CU-8 (continueCapability) — update

1. **Lock Gate result:** T-0b = **PASS (same-id)**. Top-bar Continue may ship in phase-3 as same-id path once Host wires resume; list mapping uses probe tokens only (`same-id` / `derive-only` / `unknown`); T-0b FAIL row remains for fail-closed hide.
2. **Probe placement:** Prefer ide-bridge `session/continue-capability` (or Gate-constant `same-id` until bridge lands) feeding `SessionIndexEntry.continueCapability`. Default fail-closed: missing probe → `unknown` (list: no hint; Continue: disabled + tooltip「暂不可用」).
3. **IDE requirement:** Product same-id Continue **requires** Host path to `agents.resume` (bridge). Today's SDK `session/prompt` → `agents.create` is insufficient after dispose / materialized log.
4. **Derive remains available** as fallback / association demo (`continueLinks` / `parentSessionId`); not the selected primary Gate path.

### T-0b Spike status

Update design header / Spike Gate section: **T-0b = PASS (same-id)** (this report). Phase-3 Continue slice may proceed pending human confirmation of AD-CU-8 edits and Host resume wiring.

## AC-32 note (same-id → live)

| Surface | Feasible today? |
|---------|-----------------|
| Core `agents.resume` after dispose | **Yes** — proven L1 |
| IDE Extension via current SDK prompt alone | **No** — create-only; post-dispose create → `SessionAlreadyExistsError` |
| Recommended product path | bridge `session/resume` → resume → then same `tabId` `replay→live` (AD-CU-8 / phase-3) |

## Out of scope (unchanged)

- Product Conversation Continue UI / Webview
- ide-bridge frame implementation
- SDK stdout expansion
- `packages/core/agent-loop` changes
- phase-2 ReplayHydrator / DEBT-001

## Degradation (if this were FAIL)

N/A — Gate **PASS (same-id)**. Phase-3 Continue unblocked by capability; still needs Host resume seam before shipping UI.
