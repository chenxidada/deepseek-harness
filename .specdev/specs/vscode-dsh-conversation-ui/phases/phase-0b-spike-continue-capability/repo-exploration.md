# Repository Exploration Report — phase-0b-spike-continue-capability

## 1. Task Context

Phase 0b is Spike Gate **T-0b** (status: **NOT RUN**): prove, without product Continue UI, whether DSH can **append to the same `sessionId` authoritative log without rewriting the committed prefix**, and if not (or if the IDE Host path cannot reach that API), whether a **derive-only** path can mint a new id plus durable from→to association for AC-67 / AD-CU-8. Gate must write a single verdict (`same-id` | `derive-only` | FAIL), define `continueCapability` probe semantics (`same-id` / `derive-only` / `unknown`), and recommend Host seams for phase-3. This exploration maps persistence reopen-write, `agents.resume`, IDE SDK create-only gap, fork/seed derive primitives, and where capability metadata should hang — so implementer can run L1 evidence without changing `agent-loop` or shipping Continue UI.

## 2. Repository Overview

- **Language / runtime:** TypeScript ESM, Node `^22.19 || >=24`, Cordis plugin composition.
- **Package manager:** pnpm workspaces (`packages/<group>/<pkg>/`, apps under `apps/`).
- **Authoritative log:** `@deepseek-ai/dsh-session` event stream; durable via `@deepseek-ai/dsh-session-persistence` + JSONL backend (`session-persistence-jsonl`). Semantics: **append-only contiguous seq**; writers never rewrite prior events; `open(id,'write')` after prior writer close continues at stored next-seq.
- **Same-id live restore API:** `ctx.agents.resume({ resumeSessionId })` in `@deepseek-ai/dsh-agent` / implemented by `@deepseek-ai/dsh-agent-loop` → `persistence.open(id,'write')` + read + optional durable `interruptedTurnClosers` append + publish with `source: 'resume'`.
- **IDE Host path today:** `apps/vscode-dsh` → SDK stdout JSON-RPC (`initialize` / `session/prompt` / `shutdown`) + `packages/ide/ide-bridge` NDJSON (`session/dispose`, approvals, permission). **SDK server always `agents.create` — never `agents.resume`.**
- **Cold-read precedent (phase-0a PASS):** `readColdSessionLog` + `apps/vscode-dsh/tests/spike-t0a-*` — reuse as fixture style for prefix-immutability checks.
- **code2prompt:** unavailable; exploration used targeted glob/grep + file reads (👁). Updated relative to phase-0a exploration for **continue/resume/derive** focus.

## 3. Most Relevant Areas

| Area | Path | Why | Source |
|------|------|-----|--------|
| Persistence reopen-write contract | `packages/session/session-persistence/tests/contract.ts` | After close, `open(id,'write')` continues at next-seq; create rejects existing id (`SessionAlreadyExistsError`) | 👁 |
| Persistence Service Definition | `packages/session/session-persistence/src/index.ts`, `errors.ts` | `create` / `open('read'\|'write')` / `stat` / `list`; append-only contract | 👁 |
| AgentLoop resume | `packages/core/agent-loop/src/index.ts` (`resume` / `resumeWith`) | Production same-id continue: open write → read → closers → publish | 👁 |
| Resume evidence suite | `packages/core/agent-loop/tests/resume.spec.ts` | dispose releases write ownership; resume across process lifetime; interrupted closers append after prefix | 👁 |
| CreateAgentOptions seed/fork meta | `packages/core/agent/src/index.ts` | `parentSession`, `isSeeded`, `seed`, `inheritedEventCount` for derive | 👁 |
| In-memory fork helper | `packages/core/session/src/index.ts` (`SessionStore.fork`) | New child id + seeded prefix + `parentSession` / `isSeeded` | 👁 |
| Persistence docs (resume vs fork) | `docs/subsystems/persistence.md` | Explicit: resume = `agents.resume`; fork/replay = `agents.create({ seed, meta })` | 👁 |
| SDK create-only session open | `packages/sdk/server/src/server.ts` (`createSession`, `disposeSession`, `getOrCreateSession`) | IDE prompt path never resumes; dispose clears Map then dispose so later prompt **re-creates** | 👁 |
| ACP resume reference | `packages/acp/acp/src/session.ts`, `packages/acp/acp/src/index.ts` | Working product consumer of `agents.resume` (`session/resume`) — template for IDE seam | 👁 |
| ide-bridge frames | `packages/ide/ide-bridge/src/types.ts`, `index.ts` | Host dispose today; no resume / continue-probe frame yet | 👁 |
| VS Code Host wiring | `apps/vscode-dsh/src/session-host.ts`, `conversation-controller.ts` | Tab close **currently** calls `disposeSession` (contradicts future AD-CU-9 intent) | 👁 |
| Design continue types | `.specdev/specs/vscode-dsh-conversation-ui/design.md` | `continueCapability`, `continueLinks`, AD-CU-8, T-0b | 👁 |
| Phase-0a cold-read spike | `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts`, `spike-t0a-replay-hydrator.ts` | L1 fixture pattern; `readColdSessionLog` for prefix oracle | 👁 |
| Subagent fork (related, not product Continue) | `packages/subagent/subagent-fork-in-process/` | Seeded **new** child from parent completed-turn prefix — prove derive data model, not UI Continue | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Same-id continue at persistence + agent-loop (✅ available; Spike L1 primary)

```
Lifecycle 1:
  agents.create({ sessionId })
    → persistence.create(header) → write ownership
    → live followup → session/event → handle.append (+ flush)
    → AgentHandle.dispose → handle.close  (materialized log remains)

Lifecycle 2 (same id, new process or after dispose):
  agents.resume({ resumeSessionId })
    → persistence.open(id, 'write')     # continues at next-seq
    → handle.read(0)                    # committed prefix
    → optional append(interruptedTurnClosers)  # tail repair only
    → setupAndPublish(..., source: 'resume')
    → further followup appends AFTER prefix

Prefix immutability:
  open('read') / readColdSessionLog before vs after resume append
  → events[0..prefixLen) byte/event-equal
```

✅ CONFIRMED: contract + `resume.spec.ts` (ownership release, cross-lifecycle resume, closers appended after committed prefix; torn tail truncated then continue).

### Path B — IDE SDK / vscode-dsh prompt path today (❌ no same-id resume)

```
Extension IdeSessionHost.prompt(sessionId)
  → SDK JSON-RPC session/prompt
  → HarnessSdkJsonRpcServer.getOrCreateSession
      if Map hit → reuse live handle
      else → createSession → agents.create({ sessionId })   # NEVER resume
  → agent.followup

After Tab close (current code):
  ConversationController.closeConversation
    → bridge session/dispose
    → disposeSession: Map.delete → handle.dispose
  Later prompt same sessionId → agents.create again
    → persistence.create → SessionAlreadyExistsError if log materialized
```

✅ CONFIRMED: `server.ts` create-only; dispose comment explicitly says later prompt **recreates**. Persistence `create` refuses existing ids. Therefore **product Continue cannot rely on today's SDK prompt alone** for same-id after dispose.

⚠️ Note: AD-CU-9 designs “close Tab ≠ dispose”; current `closeConversation` still disposes — phase-1 debt vs design. Spike should test **both** “still live in Map” and “disposed + resume” scenarios; Gate verdict is about **capability**, not shipping AD-CU-9.

### Path C — Derive-only (new id + association)

```
Option C1 — durable fork lineage on authoritative header:
  readColdSessionLog(oldId) / open('read')
  → agents.create({
       sessionId: newId,
       seed: balancedCompletedTurnPrefix(events),  # or full balanced log
       inheritedEventCount: seed.length,
       meta: { parentSession: oldId, isSeeded: true, cwd }
     })
  → old log untouched; new header.parentSession = oldId

Option C2 — Extension-only association (design already sketched):
  ExtensionIndexStore.continueLinks: { fromId, toId }[]
  + SessionIndexEntry.parentSessionId?
  → new empty session via normal SDK create(newId)
  → UI banner 「新会话 · 接续自 …」 from index (AC-67)
```

✅ CONFIRMED primitives: `CreateAgentOptions.seed` + `meta.parentSession`/`isSeeded`; `SessionStore.fork`; subagent-fork completed-turn prefix. C2 fields exist in **design only** — no ExtensionIndexStore implementation yet.

### Path D — Intended product Host seam for Continue + probe (not implemented)

```
Extension Continue / History list
  → (preferred) ide-bridge thin frames:
        session/resume { sessionId }           # same-id → agents.resume
        session/continue-capability { id }     # → same-id | derive-only | unknown
        session/derive-continue { fromId }     # optional: create seeded child + return toId
  → OR Gate-constant capability until bridge lands
  → Tab: same tabId, mode replay→live only after success (AD-CU-8 / AC-32)

Avoid: extending SDK stdout method set (AD-8 closed: initialize / session/prompt / shutdown)
```

Reference consumer: ACP `session/resume` → `AcpSession.resume` → `agents.resume`.

## 5. Likely Impact Surface

| Surface | Change in 0b? | Risk | Notes |
|---------|---------------|------|-------|
| `spike-report.md` + L1 vitest/script | **Yes (required)** | Low | Mirror T-0a placement under `apps/vscode-dsh/tests/` |
| `packages/core/agent-loop` | **Forbidden** | — | Spec: do not change agent-loop; consume `resume` as-is |
| `packages/sdk/server` create→resume | Optional prototype **or** document-only Host recommendation | High if shipped without design lock | Spike may prove gap without fixing; phase-3 + AD-CU update decide |
| `packages/ide/ide-bridge` resume/probe frames | Optional thin prototype OR report-only | Medium | Prefer document recommended frames like T-0a did for `session/read-log` |
| `apps/vscode-dsh` Continue UI / Webview | **No** | — | Spec forbids product Continue UI |
| Extension index `continueLinks` / `continueCapability` | Design-only until phase-3 | Low for Spike | Spike may dry-run association struct in test memory |
| Persistence / session-query | Prefer consume as-is | Low | Prefix oracle via `open('read')` / `readColdSessionLog` |
| phase-2 ReplayHydrator / DEBT-001 | Unrelated | — | Non-blocking for 0b |

## 6. Existing Constraints / Conventions

- **Append-only authoritative log:** no rewrite of committed prefix; torn tails truncated on write open; readers never see torn records (`session-persistence` contract).
- **Same-id live restore = `agents.resume`:** documented in `docs/subsystems/persistence.md` and agent-loop README; create is for fresh or seeded **new** identities.
- **Fork/derive = new sessionId** with optional `seed` + `parentSession` + `isSeeded` + `inheritedEventCount` — does not mutate parent log.
- **SDK stdout closed method set** (AD-8): Host per-session lifecycle already uses **bridge** (`session/dispose`); resume/probe should follow the same channel.
- **AD-CU-8:** list mapping and top-bar Continue are **decoupled**; forbidden binary “只读/可继续”; T-0b FAIL → hide Continue.
- **AD-CU-12:** no `agent-loop` edits; prefer `apps/vscode-dsh` + thin `ide-bridge`.
- **Model-visible ⟺ logged:** Continue must not invent assistant text; derive seed must be validated contiguous balanced events.
- **Tests:** behavior vitest under app/package `tests/`; L1 sufficient for Gate (no L2 Extension Host required). Prefer flush before dispose in fixtures (lesson from T-0a).
- **Interrupted resume note for AC-66:** resume may **append** synthetic closers to the **tail**; that is not rewriting the old prefix — Spike must assert prefix equality, not full-log equality, when closers apply.

## 7. Risks / Unknowns

| Item | Confidence | Note |
|------|:----------:|------|
| Persistence same-id write reopen preserves prefix and appends at next-seq | ✅ CONFIRMED | `contract.ts` + storage semantics |
| `agents.resume` restores same id and can continue after dispose | ✅ CONFIRMED | `resume.spec.ts` multi-lifecycle |
| IDE SDK path does not call resume; post-dispose same-id create fails on materialized log | ✅ CONFIRMED | `server.ts` + `SessionAlreadyExistsError` |
| ACP already wires resume as a product pattern | ✅ CONFIRMED | `AcpSession.resume` / `session/resume` |
| Whether Gate should declare **same-id** (core capable) vs **derive-only** (IDE path incomplete) | ⚠️ HYPOTHESIS | Spec asks DSH capability + Host recommendation; recommend: core same-id PASS **if** Spike proves resume path + documents IDE gap + recommended bridge/SDK fix for phase-3; only choose derive-only if resume is rejected as product strategy |
| Best derive seed cut (full log vs completed-turn prefix vs empty + UI-only link) | ⚠️ HYPOTHESIS | Subagent-fork uses completed-turn prefix; Continue UX may want full replayable history — Spike should try at least one seeded create and one link-only dry-run |
| Current Tab close disposes (vs AD-CU-9) | ✅ CONFIRMED (code) | Affects in-process Continue without resume; product phase-1 must align |
| Whether multi-window / multi-process write lease blocks resume | ❓ UNKNOWN | Ownership is in-process; Spike single-process is enough for Gate |
| KV-cache / request reconstruction after resume for IDE models | ❓ UNKNOWN | Out of Spike scope unless Gate needs “prompt succeeds”; prefer mock adapter for L1 |
| Exact Host probe placement (bridge vs Extension Gate constant) | ⚠️ HYPOTHESIS | Design allows list metadata from probe; recommend bridge probe for per-session truth + Gate fail-closed default `unknown` |

## 8. Uncertain / Unverified

- **End-to-end IDE profile:** create → prompt → dispose → resume → prompt under real `dsh --profile ide` composition — not executed in this exploration; L1 with `persistentHarness` / JSONL mount is the intended Gate path (like T-0a).
- **SDK recreate after dispose with real persistence:** inferred from create + `SessionAlreadyExistsError`; Spike should **empirically** assert create fails and resume succeeds on the same root.
- **`SessionStore.fork` vs `agents.create({seed})` for durable derive:** fork helper creates live in-memory child; durable derive for Continue should go through `agents.create` with persistence mounted so the child materializes — Spike must not assume `sessions.fork` alone persists.
- **Balanced seed validation failures** on open/incomplete parent turns — resume closers vs derive seed requirements differ; Spike should use a **completed** prefix fixture for derive and a separate interrupted fixture for resume closers.
- **Extension workspaceState index shape** — design-only; do not treat as authoritative association store until phase-3.
- **Python SDK “reuse id to continue” prose** (`docs/user/guide/python-sdk.md`) — means reuse while the **same live Map session** exists across `run()` calls, not post-dispose resume via SDK protocol.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-001 | `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts`: Timeline `.some` / missing replace & null-oldText fixtures | 🟡非阻塞；目标 phase-2 | Still uses `.some` for step/tool existence (lines ~65–66); no product Continue stubs | ✅ 匹配（与本 Phase 无关；非 🔴） |
| — | `apps/vscode-dsh` Continue / `continueCapability` probe | 未注册 | **Absent** (design-only names) | 🟡 Capability gap，非桩 |
| — | `packages/sdk/server` resume | 未注册 | create-only by design today | 🟡 Capability gap，非桩 |
| — | `packages/ide/ide-bridge` session/resume | 未注册 | No resume/probe frames | 🟡 Capability gap，非桩 |

### Stub Detection Summary

- ✅ Confirmed stubs: **0** matching registry STUB entries for this Phase (none targeting phase-0b; DEBT-001 is test debt, not empty Continue implementation).
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0** (no `@STUB` / empty Continue handlers found on the continue path).
- 🟡 Capability gaps (document in Spike; register as GAP/DEBT only if Gate FAIL or intentional placeholders left):
  - IDE SDK/`session/prompt` cannot resume a materialized disposed session.
  - No `continueCapability` probe API on bridge or Extension index yet.
  - No `continueLinks` persistence implementation yet (design sketch only).
- Phase Entry Gate: **no 🔴 debt targeting phase-0b**.

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/core/agent-loop/src/index.ts` (`resume` / `resumeWith` / `createStoredSession`)
2. ⭐ MUST READ — `packages/core/agent-loop/tests/resume.spec.ts` (dispose → reopen write; multi-lifecycle resume; closers)
3. ⭐ MUST READ — `packages/sdk/server/src/server.ts` (`createSession`, `disposeSession`) — IDE gap
4. ⭐ MUST READ — `.specdev/specs/vscode-dsh-conversation-ui/design.md` AD-CU-8 / T-0b; phase `spec.md` AC table
5. 🔷 SHOULD READ — `packages/acp/acp/src/session.ts` (`AcpSession.resume`) — Host wiring template
6. 🔷 SHOULD READ — `packages/session/session-persistence/tests/contract.ts` (reopen-write / AlreadyExists)
7. 🔷 SHOULD READ — `docs/subsystems/persistence.md` (resume vs create+seed)
8. 🔷 SHOULD READ — `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts` + `packages/session-query/.../cold-read.ts` (prefix oracle pattern)
9. 🔹 OPTIONAL — `packages/ide/ide-bridge/src/types.ts` (where to add resume/probe frames)
10. 🔹 OPTIONAL — `packages/core/agent/src/index.ts` CreateAgentOptions; `packages/subagent/subagent-fork-in-process/` seed cut

### Spike probe entry files (recommendation)

| Priority | File | Role |
|----------|------|------|
| **1 — primary L1 harness** | `apps/vscode-dsh/tests/spike-t0b-continue-capability.spec.ts` (new; mirror T-0a) | Gate evidence: prefix oracle + resume + create-fail + derive association |
| **2 — optional helpers** | `apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts` | Shared prefix snapshot / capability enum / derive link struct |
| **3 — oracle / contrast** | `packages/core/agent-loop/tests/resume.spec.ts` | Do not modify; cite as production resume behavior |
| **4 — gap proof** | `packages/sdk/server/src/server.ts` | Static evidence create-only; optional focused test if needed |
| **5 — avoid for Gate body** | `packages/ide/ide-bridge` product frames | Report recommended API; implement only if Spike chooses to prototype |

### Suggested L1 method (no Extension Host)

1. Temp root + mount JSONL persistence (and/or agent-loop `persistentHarness` with mock adapter).
2. **Prefix fixture:** create → append balanced completed turn(s) → flush → dispose/close → snapshot events (and optional raw bytes) as `prefix`.
3. **same-id path:** `agents.resume(sameId)` → append one more turn → cold-read → assert `events.slice(0, prefix.length) === prefix` (AC-66) and further seq contiguous.
4. **SDK/create gap:** after dispose, `agents.create(sameId)` (or persistence.create) → expect `SessionAlreadyExistsError` / already-exists — documents why IDE prompt alone is insufficient.
5. **derive path:** `agents.create(newId, { seed: prefix, meta: { parentSession: oldId, isSeeded: true }, inheritedEventCount })` → assert old cold-read unchanged; new header.parentSession / link struct `{ fromId, toId }` sufficient for UI banner (AC-67).
6. **continueCapability probe sketch:** function returning `'same-id' | 'derive-only' | 'unknown'` from (Gate result ∧ session.stat present ∧ resume available flag); map to AD-CU-8 table (AC-28).
7. Write `spike-report.md` with single verdict + **AD-CU-8 update suggestions** (probe seam, IDE resume requirement).

### Recommended Host / probe seam (for spike-report AD-CU update)

| Rank | Seam | Verdict |
|------|------|---------|
| **1 — Prefer same-id product** | ide-bridge `session/resume` → `ctx.agents.resume` (ACP pattern); optional `session/continue-capability` | Unlocks AD-CU-8 `same-id`; keeps SDK stdout closed |
| **2 — Derive fallback** | bridge or Extension: create new id + persist `continueLinks` / `parentSession` | AD-CU-8 `derive-only` if resume rejected for product reasons |
| **3 — Spike proof only** | Direct `agents.resume` / persistence in vitest | Sufficient for Gate evidence |
| **Avoid** | Silent SDK `create` reuse after dispose; rewriting old JSONL; binary 只读/可继续 labels | Violates AC-66/28 and current persistence rules |

---

*Exploration mode: first exploration for phase-0b (updated focus vs phase-0a). Registry: DEBT-001 only (phase-2, 🟡). Spike Gate T-0b NOT RUN.*
