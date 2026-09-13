# Repository Exploration Report — phase-0a-spike-replay-rebuild

## 1. Task Context

Phase 0a is Spike Gate **T-0a** (status: **NOT RUN**): prove, without product UI, that DSH **authoritative session logs** can be opened after agent dispose and folded once into (a) user/assistant message stream order/roles, (b) Timeline turn/step/tool rows, (c) Diff availability via `tool/result.meta.diffs`, and (d) incomplete/interrupted turn observability — then recommend the Host **read-log seam** for later `ReplayHydrator` (AD-CU-2). Deliverable is `spike-report.md` + a repeatable L1 script/test (prefer `apps/vscode-dsh/tests` or `packages/ide/ide-bridge/tests`). This exploration maps existing persistence / query / bridge / SDK / vscode-dsh surfaces so implementer can prove PASS/FAIL without inventing storage or changing `agent-loop`.

## 2. Repository Overview

- **Language / runtime:** TypeScript ESM, Node `^22.19 || >=24`, Cordis plugin composition.
- **Package manager:** pnpm workspaces (`packages/<group>/<pkg>/`, apps under `apps/`).
- **Authoritative log:** `@deepseek-ai/dsh-session` `SessionEvent` stream; durable via `@deepseek-ai/dsh-session-persistence` + shipped JSONL backend `@deepseek-ai/dsh-session-persistence-jsonl` (default `session.jsonl.zstd` under `dshHomePath('sessions')`).
- **Query layer:** `@deepseek-ai/dsh-session-query` (+ sqlite backend mounted in `dsh-base` with `openAt: never` — exact reads still work; FTS disabled).
- **IDE Host path:** `apps/vscode-dsh` → SDK JSON-RPC stdout + `packages/ide/ide-bridge` NDJSON Host bridge; profile `dsh --profile ide` = `dsh-base` + `dsh-sdk-app` + `dsh-ide`.
- **code2prompt:** unavailable in this environment; exploration used targeted glob/grep + file reads (👁).

## 3. Most Relevant Areas

| Area | Path | Why | Source |
|------|------|-----|--------|
| Persistence Service Definition | `packages/session/session-persistence/src/index.ts`, `handle.ts` | `create` / `open(id,'read'\|'write')` / `stat` / `list` / `SessionHandle.read` | 👁 |
| JSONL backend | `packages/session/session-persistence-jsonl/` | On-disk layout, materialization, no delete API | 👁 |
| Cold read + interrupt closers | `packages/session-query/session-query/src/cold-read.ts` | `readColdSessionLog` = open read + `interruptedTurnClosers` in memory | 👁 |
| Session query API | `packages/session-query/session-query/src/index.ts` | `listSessions`, `readSession`, `readSurface`, `listEvents` | 👁 |
| Interrupt repair | `packages/core/session/src/repair.ts` | Synthetic `tool/result` / `step/end` / `turn/end {interrupted}` | 👁 |
| Surface fold | `packages/core/session/src/surface.ts` (`foldSurface`) | Model-visible message surface from event log | 👁 |
| Base composition | `packages/bundle/base/cordis.patch.yml` | Mounts persistence-jsonl + session-query-sqlite | 👁 |
| ide-bridge wire | `packages/ide/ide-bridge/src/types.ts`, `index.ts` | Current `BridgeFrame` set; no read-log yet; `ctx.get` pattern | 👁 |
| SDK protocol | `packages/sdk/protocol/`, `packages/sdk/server/README.md` | stdout = `initialize` / `session/prompt` / `shutdown` only | 👁 |
| Timeline projector | `apps/vscode-dsh/src/timeline-store.ts` | Live `session.event` → turn/tool/diffs; reuse for fold logic | 👁 |
| Session binding | `apps/vscode-dsh/src/conversation-controller.ts`, `session-host.ts` | Tab `sessionId` → prompt/dispose; timeline clear on close | 👁 |
| Diff meta producers | `packages/fs/tool-fs/`, `packages/core/tools/src/presentation.ts` (`FileDiff`) | `meta.diffs` with `oldText: string \| null`, `newText` | 👁 |
| Existing L1 patterns | `apps/vscode-dsh/tests/timeline-projector.spec.ts`, `packages/session/session-persistence/tests/contract.ts` | Fixture-style event projection; open-read contract | 👁 |
| Phase / design | `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/spec.md`, `design.md` AD-CU-2 / T-0a | Gate AC-80/30/47/76/77 | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Authoritative write (production ide stack)

```
dsh --profile ide
  → agent-loop create/resume
      → sessionPersistence.create / open(id,'write')
      → live session/event → JSONL append (+ flush barrier)
  → Host session/dispose (bridge)
      → sdkSessionDispose.disposeSession
      → AgentHandle.dispose → session/disposed
      → persistence write handle drain + close
      → **materialized .jsonl(.zstd) remains on disk** (no delete API)
```

✅ CONFIRMED: dispose retires the in-process writer; it does **not** erase a materialized log (`session-persistence-jsonl` README: “Nothing deletes session files”).

### Path B — Cold read (available today, in-process)

```
sessionPersistence.open(id, 'read')
  → handle.read(0) → validated SessionEvent[]
  → handle.close()

OR (preferred for AC-77 balance):

readColdSessionLog(persistence, id)
  → open('read') + read + close
  → events.concat(interruptedTurnClosers(events))   // memory only

OR (higher-level, live-preferred):

ctx.sessionQuery.readSession(id)
  → corpus.load → Session.create validation → cloned { header, events }
```

### Path C — Live UI projection today (not replay)

```
IdeSessionHost.onNotification
  → ConversationController → TimelineStore.apply(HarnessNotification)
      session.event: turn/step/tool/assistant + tool/result.meta.diffs
      session.status / subagent.*
```

No `MessageStore` / `ReplayHydrator` files exist yet (design-only names).

### Path D — Intended product Host seam (not implemented; AD-CU-2 preference)

```
Extension IdeSessionHost
  → bridge frame session/read-log | session/stat   # NEW thin frames
  → ide-bridge plugin
      → ctx.get('sessionPersistence') | sessionQuery
      → open('read') / readSession / stat
  → Extension ReplayHydrator → messages/replace + TimelineStore bulk apply
```

## 5. Likely Impact Surface

| Surface | Change in 0a? | Risk | Notes |
|---------|---------------|------|-------|
| `spike-report.md` + L1 test/script | **Yes (required)** | Low | Proof only; no product UI |
| `packages/ide/ide-bridge` | Optional thin prototype OR document-only recommendation | Medium if implemented | Full RPC can wait for phase-2 |
| `apps/vscode-dsh` UI / Webview | **No** | — | Spec forbids product replay UI |
| `TimelineStore` | Read-only reuse / extract fold helpers in tests | Low | May mirror `applySessionEvent` for bulk hydrate later |
| `packages/core/agent-loop` | **Forbidden** | — | Spec + AD-CU-12 |
| SDK stdout protocol | **Avoid** | High if touched | Would break AD-8 dual-channel purity |
| Persistence / session-query packages | Prefer consume as-is | Low | Already expose read/list/stat |

## 6. Existing Constraints / Conventions

- **Registrations are effects**; bridge optional services via `ctx.get(...)` (ide-bridge already does this for dispose/presets/sessions).
- **SDK stdout exclusive JSON-RPC** (`initialize` / `session/prompt` / `shutdown`); per-session dispose already on **bridge**, not stdout — same pattern fits read-log.
- **Model-visible ⟺ logged**; UI must reconstruct from `SessionEvent`, not Extension index (AD-CU-4).
- **Persistence:** append-only contiguous seq; torn tails never returned; `open('read')` concurrent with writers allowed; `SessionReadOnlyError` on mutate.
- **Diff policy (AD-CU-6):** only log `meta.diffs`; if only patch without recoverable before → Diff unavailable; **never** use current workspace files as before/after.
- **Client UI i18n / locale-owned copy** applies to product strings later; Spike report can be English/zh markdown under `.specdev`.
- Tests: behavior-focused vitest under package/app `tests/`; L1 sufficient for Gate (no L2 Extension Host required).

## 7. Risks / Unknowns

| Item | Confidence | Note |
|------|:----------:|------|
| Materialized logs survive dispose and are readable via `open('read')` | ✅ CONFIRMED | Contract + JSONL README; never-appended pending sessions erase on creator close — Spike fixtures **must append+flush** |
| Event vocabulary includes user/assistant/turn/step/tool + `meta.diffs` | ✅ CONFIRMED | TimelineStore + tool-fs attach full `oldText`/`newText` (null = new file) |
| Incomplete turns detectable via open turn **or** synthetic `turn/end {interrupted}` after `interruptedTurnClosers` | ✅ CONFIRMED (library) | Spike must still **empirically** assert on fixtures (AC-77) |
| ide profile mounts persistence + sessionQuery | ✅ CONFIRMED | Inherited from `dsh-base` cordis.patch.yml |
| ide-bridge has no read-log / list / hydrate today | ✅ CONFIRMED | `BridgeFrame` union ends at permission + dispose + hello |
| SDK has no session read/list API | ✅ CONFIRMED | Protocol methods closed set |
| Best Host seam = bridge wrapping persistence vs sessionQuery | ⚠️ HYPOTHESIS | Design prefers bridge → `open('read')`; `sessionQuery.readSession` already balances interrupts — Spike should compare payload size / error taxonomy |
| zstd logs need backend decoder (not raw `fs.readFile`) | ✅ CONFIRMED | Default `compression: 'zstd'`; Spike must use persistence API |
| Whether dispose-before-flush loses last turn in real ide runs | ❓ UNKNOWN | Flush policy exists (`session/flush`); Spike should flush before dispose in fixtures |
| Exact message-bar folding rules for Conversation Webview (vs `foldSurface`) | ⚠️ HYPOTHESIS | Product MessageStore not implemented; Spike can fold `user/message` + `assistant/message` (+ surfaceOp replace) and document any gap vs `foldSurface` |

## 8. Uncertain / Unverified

- **`AgentHandle.dispose` → persistence close ordering under ide profile** — documented in agent-loop README; not re-executed end-to-end in this exploration. Spike script should dispose via the same path it claims to prove, or at least close the write handle after flush.
- **`sessionQuery.readSession` vs raw `handle.read` for Diff scanning** — both return events; closers differ (query balances). Prefer documenting which API the Gate used.
- **`TimelineStore.narrowDiffs` coerces non-string `oldText` to `''`** — loses `null` “new file” distinction; product Diff UI may need a stricter narrower later (Spike can detect presence of `meta.diffs` without going through TimelineStore).
- **Multi-process same `root` write lease** — persistence ownership is in-process only; Spike single-process is fine.
- **Extension `workspaceState` index** — out of scope for 0a; do not confuse with authoritative log.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 空表（无活跃债务） | N/A | ✅ 匹配（无条目可校验） |

### Stub Detection Summary

- ✅ Confirmed stubs: **0**（registry 无活跃项；相关路径未见 `@STUB` / 空壳读日志 API）
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**
- 🟡 Capability gaps (not stubs — document in Spike if FAIL, else phase-2 work):
  - **GAP (product):** no `session/read-log` / `session/stat` on ide-bridge yet
  - **GAP (product):** no `ReplayHydrator` / `MessageStore` / `messages/replace` in `apps/vscode-dsh`
  - **GAP (protocol):** SDK stdout cannot list/read cold sessions by design
  - These are **missing product seams**, not fake implementations; do not register as STUB unless implementer leaves intentional placeholders.

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/session/session-persistence/README.md` + `src/handle.ts` (`open`/`read`/`stat`/`list`)
2. ⭐ MUST READ — `packages/session-query/session-query/src/cold-read.ts` + `packages/core/session/src/repair.ts` (`interruptedTurnClosers`)
3. ⭐ MUST READ — `.specdev/specs/vscode-dsh-conversation-ui/design.md` § AD-CU-2 / T-0a; phase `spec.md` Gate table
4. 🔷 SHOULD READ — `packages/ide/ide-bridge/src/types.ts` + `README.md` AD-8 dual-channel (where to add thin read frames)
5. 🔷 SHOULD READ — `apps/vscode-dsh/src/timeline-store.ts` + `tests/timeline-projector.spec.ts` (fold turn/tool/diffs without UI)
6. 🔷 SHOULD READ — `packages/bundle/base/cordis.patch.yml` (persistence root + session-query mount)
7. 🔹 OPTIONAL — `packages/sdk/server/README.md` (why **not** to extend stdout)
8. 🔹 OPTIONAL — `packages/fs/tool-fs/tests/tools.spec.ts` Diff meta examples; `packages/core/tools/src/presentation.ts` `FileDiff`

### Spike script placement (recommendation)

| Priority | Location | Rationale |
|----------|----------|-----------|
| **1** | `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts` (name flexible) | Same app as future ReplayHydrator; can import TimelineStore fold helpers; matches phase spec preference |
| **2** | `packages/ide/ide-bridge/tests/` | Only if Spike prototypes bridge frames; otherwise keep Gate independent of wire |
| **3** | Pure persistence fixture under `packages/session/session-persistence-jsonl/tests/` | Fastest for “disk after close” but weaker link to vscode fold |

**Suggested L1 method (no Extension Host):**

1. Temp `root` + mount/create JSONL persistence (or Loader mini-composition).
2. Fixture A: balanced turn with `user/message`, `assistant/message`, `tool/call`+`tool/result` **with** `meta.diffs`, `turn/end completed` → flush → close write.
3. Fixture B: same without `meta.diffs`.
4. Fixture C: open turn (no `turn/end`) → flush → close.
5. After writer gone: `open('read')` / `readColdSessionLog` → assert counts/order/roles; Diff probe true/false; incomplete via open-turn **or** closer `reason.kind === 'interrupted'`.
6. Write results into `phases/phase-0a-spike-replay-rebuild/spike-report.md` with AD-CU-2 update suggestion.

### Recommended read-log seam (for spike-report AD-CU update)

| Rank | Seam | Verdict |
|------|------|---------|
| **Prefer** | ide-bridge thin `session/read-log` (+ optional `session/stat` / list) → `sessionPersistence.open(id,'read')` **or** `sessionQuery.readSession` | Matches AD-CU-2; keeps SDK stdout pure; mirrors existing `session/dispose` Host pattern |
| **Spike-only proof** | Direct `sessionPersistence` / `readColdSessionLog` in vitest | Sufficient for Gate PASS evidence; no UI |
| **Avoid** | New SDK stdout methods | Couples Extension to protocol expansion; conflicts with documented AD-8 closed method set |

---

*Exploration mode: first exploration for this Phase (no prior repo-exploration.md). Registry empty. Spike Gate NOT RUN.*
