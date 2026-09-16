# Connectivity Review — Phase 2 (`phase-2-host-fail-loud-diagnostics`)

## 视角

**Integration Connectivity** — are the parts actually wired together? This report traces end-to-end data
paths, upstream/downstream connections and cross-module contracts only. It does not judge implementation
correctness (reviewer-correctness), design/architecture choices (reviewer-design) or appearance
(reviewer-visual).

Scope: AC-13 – AC-22 of `spec.md`, the failure boundaries enumerated in `repo-exploration.md`
(§"Key Entry Points / Call Paths"), and AD-3 / AD-5 / AD-13 / AD-14 of `design.md`.

## 判决：MUST-FIX

Six of the seven wiring edges this phase adds are genuinely connected: producer → bounded store → sink →
Output Channel is one chain on one recorder instance; the `dsh.test.getDiagnosticsText` hook lives inside the
test gate and returns the store's own array; the reveal command matches `package.json` character-for-character
and really calls `channel.show()`; the SDK's structured exit facts traverse `client.ts → index.ts →
session-host.ts` with no export break; the retry entry points all converge on the one `StartHostPort`; and the
AD-13 projection is assigned from validated wire data. Two edges are broken/inert: the sixth start-failure
boundary (`onTransportDeath`) has no record edge at all, and the orchestrator-side retry → record edge is
suppressed for the two classes the orchestrator itself owns, so a repeated identical failure records nothing.

---

## 端到端路径追踪

### Path 1 — Host-classified start failure → record → store → Output Channel → reveal (CONNECTED)

```
Entry: IdeSessionHost.start() throws                              session-host.ts:441  (catch)
  → describeStartFailure(error, {stage, timeout, socket, node})    session-host.ts:445  ✅ classified → HostDiagnosticInput
      ├─ node pre-flight refusal (NodeEnvironmentError)            session-host.ts:139-151 ✅ → 'node-environment'
      ├─ bridge.listen refusal                                     session-host.ts:175-177 ✅ → 'bridge-listen'
      ├─ TransportClosedError + spawnError                         session-host.ts:157     ✅ → 'spawn'
      ├─ TransportClosedError without spawnError                   session-host.ts:157     ✅ → 'child-exited'
      └─ nothing named it                                          session-host.ts:178     ✅ → 'other'
    → this.diagnostics?.record(failure)                           session-host.ts:451  ✅ the only record() call site in src/
      → HostDiagnosticRecorder.record(input)                       host-diagnostics.ts:329 ✅
        → store.push(record)                                       host-diagnostics.ts:352 ✅
        → bound: oldest dropped past 200                           host-diagnostics.ts:353-355 ✅ (limit :26)
        → sink?.present(record)                                    host-diagnostics.ts:356 ✅ every record, unconditionally
          → extension sink closure                                 extension.ts:430-434 ✅
            → hostDiagnosticsChannel?.appendLine(format(record))   extension.ts:432   ✅
              → createOutputChannel('DeepSeek Harness')            extension.ts:424-425 ✅ (name const host-diagnostics.ts:23)
Exit: rendered block in the channel (formatHostDiagnosticRecord host-diagnostics.ts:409-433);
      dsh.showHostDiagnostics → channel.show()                     extension.ts:537-539 ✅
```
**判定**: ✅ complete, and one instance throughout — the recorder is created at `extension.ts:429`, published
at `:436`, handed to the port at `:445` and to the Host at `:2310`; the test hook reads the same object
(`:1107`). No copy of the store exists anywhere.

### Path 2 — Orchestrator-owned class → record → same store → same channel (CONNECTED)

```
Entry: runStart → !hasCredentials()                               auto-start-orchestrator.ts:214-218 ✅ kind='missing-credentials'
       (or StartHostPort's readNodeBinSetting throws HostStartError('invalid-setting') inside port.start)
  → startErrorKindOf(error) — structural read of `.kind`          auto-start-orchestrator.ts:60-68 ✅ (no text matching, AD-3)
  → snapshot {state:'failed', errorKind, errorMessage}            auto-start-orchestrator.ts:132-140 ✅
  → notify()                                                      auto-start-orchestrator.ts:262 ✅
  → extension onChange listener                                   extension.ts:449-453 ✅
    → createStartFailureListener(recorder)                        host-diagnostics.ts:257-275 ✅
      → hostFailureKindForStartError(snapshot.errorKind)          host-diagnostics.ts:266 ✅ (null → skip, so Host-owned classes are not double-recorded)
      → recorder.record({kind, detail})                           host-diagnostics.ts:272 ✅ → same sink as Path 1
  → connectionUi.projectOrchestrator(snapshot)                    extension.ts:450 → connection-ui.ts:110-113 ✅
    → mapSnapshot: 'failed' / errorMessage / deep link            connection-ui.ts:128-140, :147 ✅
      → panel.applyConnectionState + status bar tooltip           connection-ui.ts:173-189 ✅
Exit: redacted message in panel + status bar; the failure recorded once ✅
```
**判定**: ✅ complete for the first attempt, single-record by construction (`missing-credentials` never reaches
the port's generic fallback `extension.ts:2363-2372`; an `invalid-setting` `HostStartError` is excluded there
by `!(error instanceof HostStartError)`). A **retry** on this same class does not produce a second record —
see Path 4b.

### Path 3 — SDK structured exit facts → package boundary → Host record (CONNECTED)

```
Entry: child_process 'exit' (code, signal)                        client.ts:288-293 ✅
  → this.exitSignal = signal ?? undefined                         client.ts:290 (field :230) ✅
  → closedError(reason)                                           client.ts:496-502 ✅
    → transportDetails()                                          client.ts:506-511 ✅ {executable, exitCode, terminationSignal, stderrTail, spawnError}
      → new TransportClosedError(message, details)                client.ts:502 ✅
        → @deepseek-ai/dsh-sdk-client exports                     packages/sdk/client/src/index.ts:14-20 ✅ (value + type both exported)
          → session-host import                                   session-host.ts:15 ✅ (tsconfig.base.json:214 maps the specifier to src/)
            → describeStartFailure branches                        session-host.ts:152-164 ✅
              → kind = spawnError === undefined ? 'child-exited' : 'spawn'   session-host.ts:157 ✅
              → exitCode / terminationSignal / stderrTail / resolvedExecutable ✅
Exit: structured values in the store, in its JSON form and in the rendered block ✅
```
**判定**: ✅ complete. The emitted declaration surface is not stale either —
`packages/sdk/client/lib/types/index.d.ts:14` already exports `TransportClosedDetails`.

### Path 4a — Retry on a **Host-classified** failure re-enters the same path and pairs its record (CONNECTED)

```
Entry: dsh.statusBarAction                                       extension.ts:519-523 ✅
       (or the panel button: chat-panel-provider.ts:1126 posts
        'action/retry-connect' → chat-panel-host.ts:728-729 → deps
        .requestRetryConnect)                                     extension.ts:1426 ✅
  → orchestrator.request(reason)                                  auto-start-orchestrator.ts:152-169 ✅
    → runStart → this.port.start(reason)                          auto-start-orchestrator.ts:205-220 ✅
      → createStartHostPort.start (the single port bound at)      extension.ts:445 → :2293 ✅
        → hostCreateCount += 1                                    extension.ts:2311 ✅ (incremented on every re-entry)
        → new IdeSessionHost(diagnostics)                         extension.ts:2310 ✅ same recorder instance
          → Host records its own boundary on each attempt          session-host.ts:451 ✅
            → phase 'retry' + retryOfSeq = chain opener's seq      host-diagnostics.ts:335-336, :351 ✅
Exit: opening record + retry record traced by retryOfSeq; snapshot recovers to 'started' on success ✅
      (proved end-to-end at host-diagnostics.spec.ts:966-1003 with the Host-owned 'node-environment' class)
```
**判定**: ✅ complete for Host-classified classes.

### Path 4b — Retry on an **orchestrator-owned** failure (`missing-credentials` / `invalid-setting`) records nothing (INERT EDGE)

```
Entry: dsh.statusBarAction in the failed state of AC-19         extension.ts:519-523 → :1426 ✅
  → request → runStart (same port path)                          auto-start-orchestrator.ts:152-169, :205 ✅
    → failure repeats with the same class and the same message    auto-start-orchestrator.ts:214-218, :230-234 ✅
      → listener: state==='starting' did NOT clear the guard      host-diagnostics.ts:262-264 (only 'started' clears it)
        → signature `${kind}\0${detail}` equals the previous one  host-diagnostics.ts:269-270 🔴 early return
        → recorder.record(...)                                    host-diagnostics.ts:272 🔴 never reached
Exit: ⛔ retry attempt leaves no record; the channel shows nothing new for a retry the user just clicked
```
**判定**: 🔴 MUST-FIX — see finding C-1.

### Path 5 — Interaction projection carries real wire data (CONNECTED)

```
Entry: bridge frame 'approval/request' {toolName (required), reason?}  ide-bridge/src/types.ts:175-181 ✅
  → validateBridgeFrame (toolName must be non-empty)               ide-bridge/src/validate.ts:75-86 ✅
    → session-host frame switch                                    session-host.ts:839-843 ✅
      → InteractionCoordinator.handleApproval(frame)               interaction-coordinator.ts:257-277 ✅ (entry.toolName := frame.toolName, :273)
        → queue → listPending()                                    interaction-coordinator.ts:197-201 ✅
          → projectEntry → { toolName, reason? }                   interaction-coordinator.ts:208-228 ✅ (:225, :227)
            → dsh.test.listPendingInteractions (pass-through)      extension.ts:1096-1099 ✅ (no field stripping)
Exit: Phase 3's driver can read toolName / reason off the projection ✅
```
**判定**: ✅ complete. `toolName` cannot be fabricated or empty from the production path (wire validation),
and `reason` is omitted — not nulled — when the runtime sent none.

### Path 6 — Runtime death **after** a successful connect → nothing recorded (MISSING EDGE)

```
Entry: the child exits after the handshake succeeded
  → watchTransport → onTransportDeath(reason)                      session-host.ts:698 → :727-757 ✅ status='error' (:729), notifyError (:756)
    → diagnostics.record(...)                                      🔴 ABSENT — no call site in :727-757,
                                                                     and session-host.ts:451 is the only record() call in src/
  → store / Output Channel / dsh.test.getDiagnosticsText            🔴 never observe the event
  → orchestrator: snapshot 'disconnected' → listener records nothing host-diagnostics.ts:262 (records only when state==='failed')
  → a later retry finds the chain already closed                     host-diagnostics.ts:320 ← session-host.ts:440
Exit: ⛔ this failure boundary leaves no record anywhere
```
**判定**: 🔴 MUST-FIX — see finding C-2.

---

## 上下游连接检查

| New / changed surface | Upstream (who calls it) | Link | Downstream (what it calls) | Link |
|---|---|:--:|---|:--:|
| `describeStartFailure()` (`session-host.ts:134`) | `start()` catch (`:445`) | ✅ | `HostDiagnosticInput` → recorder | ✅ |
| `HostDiagnosticRecorder.record()` (`host-diagnostics.ts:329`) | `session-host.ts:451`, `host-diagnostics.ts:272`, `extension.ts:2368` | ✅ | `store.push` + `sink.present` (`:352`, `:356`) | ✅ |
| extension sink closure (`extension.ts:430-434`) | recorder ctor (`:429`) | ✅ | `channel.appendLine(format…)` (`:432`) | ✅ |
| `formatHostDiagnosticRecord()` (`host-diagnostics.ts:409`) | sink only | ✅ | Output Channel text | ✅ |
| `createStartFailureListener()` (`host-diagnostics.ts:257`) | `extension.ts:448` | ✅ | recorder (`:272`) — **suppressed on repeat (Path 4b)** | 🔴 |
| `dsh.showHostDiagnostics` (`extension.ts:537`) | `package.json:143-145` | ✅ ID character-for-character | `channel.show()` (`:538`) | ✅ |
| `dsh.test.getDiagnosticsText` (`extension.ts:1105-1108`) | inside `shouldRegisterTestHooks` (`:1009`, guard `:2211-2214`) | ✅ registered only inside the gate | `hostDiagnostics.records()` (`:1107`) — same instance | ✅ |
| `startErrorKindForFailure()` (`host-diagnostics.ts:213`) | `session-host.ts:459` | ✅ | `HostStartError.kind` | ✅ |
| `hostFailureKindForStartError()` (`host-diagnostics.ts:227`) | `host-diagnostics.ts:266` | ✅ | snapshot class → record kind | ✅ |
| `TransportClosedError.details` (`client.ts:66`) | `closedError()` (`:502`) | ✅ | `session-host.ts:152-164` | ✅ |
| `onTransportDeath` (`session-host.ts:727`) | `watchTransport` (`:698`) | ✅ | recorder | ❌ **no edge** (C-2) |
| `HostDiagnosticRecorder.setSink()` (`host-diagnostics.ts:312`) | **none** | ❌ unwired | — | n/a |
| `HostDiagnosticRecorder.setCredentials()` (`host-diagnostics.ts:304`) | `session-host.ts:377` | ✅ | per-record redaction (`:389-390`) | ✅ |
| `onStartSucceeded()` (`host-diagnostics.ts:320`) | `session-host.ts:440` | ✅ | chain bookkeeping (`:321`) | ✅ |
| `lastSeq()` (`host-diagnostics.ts:372`) | `extension.ts:2331`, `:2366` | ✅ | attempt-scoped dedup for the port fallback | ✅ |
| AD-13 projection fields | `handleApproval` (`interaction-coordinator.ts:273`) | ✅ | `extension.ts:1098` | ✅ |

## 跨模块契约验证

| Boundary | Caller expects | Callee provides | Match |
|---|---|---|:--:|
| `extension.ts` → `IdeSessionHost` ctor | `HostFailureDiagnostics` (record / setCredentials / onStartSucceeded / lastSeq) | `HostDiagnosticRecorder` implements `HostFailureRecorder` (`host-diagnostics.ts:283`) | ✅ |
| `extension.ts` → `StartHostPort.start` | fallback record only when nothing else recorded | `lastSeq()` before/after (`:2331`, `:2366`) | ✅ |
| `auto-start-orchestrator` → thrown start error | a member of `START_ERROR_KINDS` (`:27-35`) | `startErrorKindForFailure` names `invalid-setting` explicitly (`host-diagnostics.ts:213-224`, F-3.1) | ✅ |
| `auto-start-orchestrator` → snapshot | `errorKind` faithful to the thrown class | structural read, no text matching (`:60-68`) — consistent with AD-3 (`spec.md:67`) | ✅ |
| `ConnectionUiController` ← snapshot | `errorKind`, `errorMessage` | set on both failure paths (`auto-start-orchestrator.ts:227-233`) | ✅ |
| record field `resolvedExecutable` | documented "absolute path" (`host-diagnostics.ts:70`, `:104`) | `resolveNodeExecutableSpec` returns `DSH_NODE_BIN` / setting values **verbatim** (`launch.ts:133-139`) | ⚠️ see C-4 |
| record field `socketPath` | absolute bridge socket | Host-built temp path, asserted equal at `session-host.spec.ts:312` | ✅ |
| `phase` / `retryOfSeq` on a retry | a retry is the second record of the same failure | true for Host-classified classes; **not produced at all** for orchestrator-owned repeats (C-1) | 🔴 |
| SDK `TransportClosedDetails` | type usable by the app | value + type both exported (`packages/sdk/client/src/index.ts:14-20`) | ✅ |
| approval frame → projection | `toolName` non-empty, `reason` optional | non-empty enforced on the wire (`validate.ts:77`) | ✅ |

## 跨 Phase 依赖检查

| This phase depends on | From | Interface state | Link |
|---|:--:|:--:|:--:|
| `resolveNodeExecutableSpec` / `ResolvedNodeExecutable` | Phase 1 / SDK | unchanged; consumed at `session-host.ts:408` | ✅ |
| `NodeEnvironmentError.failure` | Phase 1 | narrowed by `instanceof` before reading (`session-host.ts:139-151`, F-3.2) | ✅ |
| `HostStartError` / `StartErrorKind` vocabulary | Phase 1 | extended additively with `bridge-listen` / `spawn` / `handshake-timeout` (`auto-start-orchestrator.ts:27-35`) | ✅ |
| `redactSecrets` | Phase 1 | reused, not re-implemented (`host-diagnostics.ts:12`, `extension.ts:54`) | ✅ |
| `shouldRegisterTestHooks` gate | earlier phase | reused, new command registered inside it (`extension.ts:1009`, `:1105-1108`) | ✅ |
| `errorKind === 'missing-credentials'` → settings deep link | earlier phase | already projected (`connection-ui.ts:140`); no rework (implementation §8.1) | ✅ |
| DEBT-008 (comment/reference fidelity, user-assigned to this phase) | Phase 1 review | registry row is in the resolved table (`tech-debt-registry.md:47`); probes re-run here: `AD-9` at `extension.ts:233`, `:2245`; widened source sentence at `session-host.ts:54`, `auto-start-orchestrator.ts:40` | ✅ |
| Phase 3 machine driver asserts `resolvedExecutable` is absolute (`spec.md:57`) | Phase 3 | rests on the contract in C-4 | ⚠️ |
| AC-30's child-death probe (`FAKE_EXIT_AFTER_MS`) | earlier phase | still available and used (`tests/interaction-fail-closed.e2e.spec.ts:98`) | ✅ |

---

## 关键发现

### 🔴 Must-Fix

**C-1 — A retry that repeats the same orchestrator-owned failure records nothing, so the retry → record edge
is inert for exactly the classes AC-19/AC-22(c) put in front of the user.**
`createStartFailureListener` keeps a closure-level `recorded` signature and returns early when the same
`(kind, message)` pair recurs (`host-diagnostics.ts:260`, `:269-270`); it is cleared only by a *successful*
start (`:263`). A retry re-enters with `state = 'starting'` (`auto-start-orchestrator.ts:207`), which does
**not** clear it, then fails with the identical class and message — `'missing credentials'` is thrown as a
constant (`auto-start-orchestrator.ts:215-218`), and `readNodeBinSetting` throws a constant text as well — so
`recorder.record(...)` at `host-diagnostics.ts:272` is never reached. Because these two classes have no Host
boundary to speak for them (`hostFailureKindForStartError` returns `null` for Host-owned kinds, `:227`), no
other producer writes the record. Measured consequence: in the AC-19 failed state (status bar visible and
clickable, `host-diagnostics.spec.ts:917-918`), clicking retry grows the store by 0 records; the channel and
`dsh.test.getDiagnosticsText` are silent for a retry the user just triggered, and AC-22(b)'s "records increase
in pairs" is unmet for this class. The AC-22 evidence that does exist is carried by the Host-owned
`node-environment` class (`host-diagnostics.spec.ts:966-1003`), where the Host writes its own record on every
attempt, bypassing the guard; the store-level pairing case (`:326-343`) calls `record()` directly and never
exercises the listener.
Resolution: scope the guard to one **attempt** (clear it when a new attempt starts, e.g. on the `'starting'`
transition, or key it on a start generation) instead of to the failure chain — while keeping the
one-attempt-can-notify-twice protection the current comment claims, if that case is real (the comment names a
"disconnect edge" repeat; for these two classes the disconnect edge does not produce a second `failed`
snapshot, `auto-start-orchestrator.ts:174-189`, `:214-234`). Add retry-pairing evidence for
`missing-credentials`, since that is the state AC-22(c) mandates a clickable entry in.

**C-2 — The sixth start-failure boundary (runtime death after a successful connect) has no record edge.**
`repo-exploration.md:123` enumerates it explicitly ("`child-exited` is a sixth boundary that is NOT in
`start()`. … the recorder needs a second insertion point in `onTransportDeath`"), and `:603-605` requires the
`HostFailureKind → StartErrorKind` question for a post-connect exit to be decided **explicitly** (open
question 8.1, `:648`). Measured: the implementation has exactly one `record()` call site in `src/`
(`session-host.ts:451`, inside `start()`'s catch); `onTransportDeath` (`:727-757`) sets `status = 'error'`
(`:729`) and calls `notifyError` (`:756`) but never touches `diagnostics`. The orchestrator-side listener
cannot compensate, because it records only while `snapshot.state === 'failed'` (`host-diagnostics.ts:262`)
and a post-connect death produces `disconnected` → `disconnected-retrying`
(`auto-start-orchestrator.ts:174-189`). The store's own vocabulary also pins the class to the pre-handshake
window (`host-diagnostics.ts:174`), so `child-exited` is unreachable for the case the boundary describes.
`implementation.md` §8 lists eight deviations and never mentions `onTransportDeath`, i.e. the mandated second
insertion point was neither wired nor explicitly declined.
Impact: a Host that dies after connecting (`spec.md:61`: "子进程正常退出码 0 后断线（记录
`kind === 'child-exited'`）") moves the user-visible state to `disconnected` while the Output Channel and
`dsh.test.getDiagnosticsText` stay empty — the fail-loud surface is silent for the failure a user most often
sees, and it also removes the "before" record AC-22(b) pairs a retry with in that scenario.
Resolution (either, decided explicitly and recorded in `implementation.md`): (a) wire the second insertion
point — record `child-exited` from `onTransportDeath` with the terminated child's exit facts and answer
exploration §7.2/§8.1 in the same change; or (b) record a reviewed deviation that post-connect death is out of
this phase's record vocabulary, align `host-diagnostics.ts:174` and the kind's own sentence with that
decision, and register the residual gap so Phase 3's machine run does not read an empty channel as
"no failure happened".

### 🟡 Should-Fix

**C-3 — `HostDiagnosticRecorder.setSink()` has no caller anywhere in the repo.**
Defined at `host-diagnostics.ts:312`; the only production sink wiring is the constructor option
(`extension.ts:429-434`), and no test uses it either. The wired path is unaffected, but an unused public seam
on a new class is speculative surface: remove it, or give it a current owner and need.

**C-4 — `resolvedExecutable` is documented as an absolute path, but the producer only guarantees that for one
of the three sources, and a Phase 3 consumer asserts absoluteness.**
The record field says "**Absolute** path of the Node executable the Host resolved and spawned"
(`host-diagnostics.ts:70`; the input repeats it at `:104`), while `resolveNodeExecutableSpec` returns the
`DSH_NODE_BIN` value (`launch.ts:134`) and the `dsh.nodeBin` setting value (`launch.ts:138`) **verbatim** —
absoluteness holds only for `process-exec-path`. This phase's own implementation table states the narrower
truth ("absolute **only** for the `process-exec-path` source (F-3.3)", `implementation.md:108`), so the field
JSDoc and the phase's declared contract disagree. The consumer that would trip on it is cross-phase:
`spec.md:57` requires the Phase 3 machine driver to assert that a `node-environment` record's
`resolvedExecutable` is an absolute path. The value itself flows correctly, so this is a contract gap at the
module boundary rather than a broken call — either state the restriction in the field doc, or re-absolutize at
the record boundary (which this phase deliberately did not do).

### 🟢 Observations

- **O-1** — `apps/vscode-dsh/src/index.ts` does not re-export anything from `./host-diagnostics.ts`, although
  the package re-exports other modules (`:25`, `:41`). No consumer exists today and `spec.md` does not require
  it, so this is not a break; noted because Phase 3's driver may want to type the `dsh.test.getDiagnosticsText`
  result instead of re-declaring the 18 fields.
- **O-2** — Degradation when the host has no `createOutputChannel`: the channel stays `undefined`
  (`extension.ts:424-426`) while the sink is still wired (`:430-434`), so records are stored and readable
  through the test hook but never rendered. Deliberate and documented in-code (`:427-428`).
- **O-3** — After a post-connect death the *next* attempt is recorded with `phase: 'start'`, not `'retry'`,
  because a successful start closed the chain (`host-diagnostics.ts:320` ← `session-host.ts:440`). Consistent
  with "chain opens on failure, closes on success", but whichever resolution C-2 takes must also state whether
  a post-connect death should open a chain.
- **O-4** — No `@STUB` marker exists in `apps/vscode-dsh/src` after this phase, and the registry's active table
  gains no entry from it (`tech-debt-registry.md:33-35`); the only phase-touched row is DEBT-008, correctly
  moved to the resolved table (`:47`). Cross-checked against the code, not taken from the report.

---

## Evidence run in this review

| Check | Command | Result |
|---|---|---|
| Compile-level connectivity | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run typecheck` | exit 0 |
| Exercise the wired paths (Paths 1, 2, 3, 4a, 5) through production code | `pnpm run test apps/vscode-dsh/tests/host-diagnostics` | exit 0 — 1 file, **36/36** tests passed |

Both read from redirected output files, not from the implementer's report. Path 4b and Path 6 were traced by
reading function bodies; neither has a test that would have failed on them.
