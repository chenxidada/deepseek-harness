# Connectivity Review — Phase 2 (`phase-2-host-fail-loud-diagnostics`)

## 视角

**Integration Connectivity** — do the pieces actually connect end-to-end? This report traces end-to-end data
paths, upstream/downstream connections and cross-module contracts only. It does not judge implementation
correctness (`reviewer-correctness`), design/architecture choices (`reviewer-design`) or appearance
(`reviewer-visual`).

Scope: AC-13 – AC-22 of `spec.md`, the failure boundaries enumerated in `repo-exploration.md`
(§"Key Entry Points / Call Paths", §7.2, §8.1), and AD-3 / AD-4 / AD-5 / AD-13 / AD-14 of `design.md`.
Round: **2** (re-review after the round-1 rework). The round-1 merged report is
`.archive/review-20260915T163307Z.md`; my two round-1 reports are
`.archive/review-connectivity-20260915T160437Z.md` and `.archive/review-connectivity-20260915T163355Z.md`.

## 判决：SHOULD-FIX

Every end-to-end data path this phase adds is now genuinely connected, including the one that was broken in
round 1. The retry → "append a record" edge is live again for the two orchestrator-owned classes: the
de-duplication guard now re-arms on **any** transition leaving `failed`
(`host-diagnostics.ts:283-286`), and every attempt passes through `starting` before it can fail
(`auto-start-orchestrator.ts:207-210`), so a repeated `missing-credentials` refusal grows the store 1 → 2 with
the second entry carrying `phase: 'retry'` and `retryOfSeq` pointing at the opener — verified by running the
suite, not by reading the ledger (the extension-level case drives the real `dsh.statusBarAction` command and
asserts the pair). Within-attempt de-duplication survived the change; the queued-retry recursion now records
too; and the `invalid-setting` gap left by narrowing the record vocabulary is closed by the Extension fallback
on the high-water-mark signal alone, producing exactly one `other` record. Producer → bounded store → sink →
Output Channel remain one chain on one recorder instance, the read surfaces are registered inside the test
gate and read that same instance, the SDK's structured exit facts cross the package boundary with no export
break, and the AD-13 projection is assigned from validated wire data at both ends.

What remains is cleanup, not a break: one public seam on the new class still has no caller anywhere, and the
debt entry that carries the adjudicated post-handshake gap points at the wrong file/function, so it does not
lead a future reader to the edge that is actually missing.

---

## 端到端路径追踪

### Path 1 — Host-classified start failure → record → store → sink → Output Channel → reveal (CONNECTED, regression)

```
Entry: IdeSessionHost.start() throws                              session-host.ts:441  (catch)
  → describeStartFailure(error, {stage, timeoutMs, socketPath, nodeExecutable})
                                                                  session-host.ts:445  ✅ classified
      ├─ NodeEnvironmentError.failure                             session-host.ts:139-151 ✅ → 'node-environment'
      ├─ TransportClosedError + spawnError                        session-host.ts:152-157 ✅ → 'spawn'
      ├─ TransportClosedError without spawnError                  session-host.ts:157     ✅ → 'child-exited'
      ├─ RequestTimeoutError                                      session-host.ts:166-173 ✅ → 'handshake-timeout'
      ├─ stage === 'bridge-listen'                                session-host.ts:175-176 ✅ → 'bridge-listen'
      └─ nothing named it                                         session-host.ts:178     ✅ → 'other'
    → this.diagnostics?.record(failure)                           session-host.ts:451  ✅ the only record() call site in src/
      → HostDiagnosticRecorder.record(input)                      host-diagnostics.ts:350 ✅
        → per-field redaction, 18-field assembly                  host-diagnostics.ts:352-371 ✅
        → chainStartSeq ??= record.seq                            host-diagnostics.ts:372 ✅
        → store.push + bound 200 (oldest dropped)                 host-diagnostics.ts:373-376 ✅
        → this.sink?.present(record)                              host-diagnostics.ts:377 ✅ every record
          → extension sink closure                               extension.ts:430-434 ✅
            → hostDiagnosticsChannel?.appendLine(format(record)) extension.ts:432   ✅
              → createOutputChannel('DeepSeek Harness')           extension.ts:424-425 ✅ (name const host-diagnostics.ts:23)
  → throw HostStartError(startErrorKindForFailure(failure.kind))  session-host.ts:459  ✅ same failure object
Exit: rendered block in the channel;  dsh.showHostDiagnostics → channel.show()   extension.ts:537-539 ✅
```

**判定**: ✅ complete, and one instance throughout — the recorder is created at `extension.ts:429`, published
to the module at `:436`, handed to the port at `:445` and to each new Host at `:2311`; the read surface
returns that same object at `:1108`. No copy of the store exists anywhere.

### Path 2 — Retry of an orchestrator-owned pre-Host refusal → paired record (CONNECTED — this is the round-1 C-1 edge)

```
Entry: the failed state AC-19 defines (credentials missing, status bar visible + clickable)
  → connection-ui.ts:184-188     bar.command = 'dsh.statusBarAction', failed label        ✅ entry offered
  ├─ status-bar entry:  extension.ts:519-523  registerCommand('dsh.statusBarAction')
  │                       → orchestrator.request('status-bar')                           ✅
  ├─ panel entry:       chat-panel-provider.ts:1126 posts 'action/retry-connect'
  │                     → protocol.ts:304 parses it
  │                       → chat-panel-host.ts:728-729  deps.requestRetryConnect?.()
  │                         → extension.ts:1427-1429  orchestrator.request('manual-retry') ✅
  └─ test entry:        extension.ts:1207-1211  orchestrator.request(r)                    ✅
        ⇓ all three converge on the single start implementation
  → AutoStartOrchestrator.runStart(reason)          auto-start-orchestrator.ts:205         ✅ no parallel path
    → :207 state = 'starting'                       auto-start-orchestrator.ts:207         ✅
    → :210 notify()                                 auto-start-orchestrator.ts:210         ✅
      → extension.ts:449-453 onChange                → connectionUi.projectOrchestrator    ✅
                                                     → recordOrchestratorFailure(snap)     ✅
        → host-diagnostics.ts:283-286  state !== 'failed'  → recorded = undefined  ✅ GUARD RE-ARMED
        → return                                                                    ✅ (early return, no record)
    → :214 !port.hasCredentials() → throw Error('missing credentials', {kind:'missing-credentials'})
                                                    auto-start-orchestrator.ts:214-219     ✅ before port.start
    → :232-234 state='failed', errorKind/errorMessage set (both constant)              ✅
    → :241 notify()                                                                    ✅
      → listener: state === 'failed', kind !== null
        → hostFailureKindForStartError('missing-credentials') === 'missing-credentials' ✅ (host-diagnostics.ts:247-248)
        → signature `${kind}\0${detail}` !== recorded                                  ✅ guard was re-armed above
        → recorder.record({kind, detail})            host-diagnostics.ts:293            ✅ RECORD WRITTEN
          → phase = chainStartSeq === null ? 'start' : 'retry'  host-diagnostics.ts:356 ✅ 'retry'
          → retryOfSeq = chainStartSeq                          host-diagnostics.ts:357 ✅ points at the opener
          → sink → channel                                       (as Path 1)           ✅
    → :249 notify()  (second settle inside the same attempt)                            ✅
      → listener: same signature === recorded → suppressed     host-diagnostics.ts:291  ✅ no duplicate
  → onStartSucceeded() is NEVER called (the Host is never entered)                      ✅ chain stays open
Exit: store 1 → 2;  records()[1] = {kind:'missing-credentials', phase:'retry',
        retryOfSeq: records()[0].seq, seq > records()[0].seq}                           ✅ paired + traceable
```

**判定**: ✅ **the round-1 break is closed.** Runtime evidence, not a code-reading claim: the extension-level
case at `host-diagnostics.spec.ts:1117-1142` activates the real extension, drives the real
`dsh.test.setCredentialPresence` + `dsh.statusBarAction` commands through the real `AutoStartOrchestrator`, and
asserts `records()` goes 1 → 2 with `phase: 'retry'` and `retryOfSeq === paired[0].seq`. The case is
**structurally discriminating**: `'missing credentials'` is a constant literal
(`auto-start-orchestrator.ts:215`) and `errorKind` is constant (`:233`), so both attempts produce an identical
signature — under the round-1 guard (cleared only on `state === 'started'`, which this state can never reach)
the second write would have been suppressed and the `toHaveLength(2)` assertion would fail. Two further cases
pin the two halves of the contract: `:586-595` (three identical failed snapshots → **one** record) and
`:597-614` (a retry after a re-armed boundary → **two**).

### Path 3 — `invalid-setting` after the vocabulary narrowing → extension fallback → exactly one `other` record (CONNECTED)

```
Entry: start requested with the dsh.nodeBin setting holding a non-string value
  → createStartHostPort.start                     extension.ts:2294
    → :2332  const seqBeforeStart = diagnostics?.lastSeq() ?? null   extension.ts:2332  ✅ high-water mark taken
    → :2334  collectCredentialsEnv()                                  extension.ts:2334  ✅
    → :2335  readNodeBinSetting(vscode)                               extension.ts:2335  ✅
      → extension.ts:2257-2261  throw HostStartError('invalid-setting')                  ✅ thrown inside the try
    → catch                                            extension.ts:2351-2372            ✅
      → :2356 unbindConversations(); :2357 host = undefined                               ✅
      → :2367  diagnostics.lastSeq() === seqBeforeStart                                  ✅ nothing else recorded
        → diagnostics.record({kind:'other', detail: redactSecrets(message)})  :2368-2371  ✅ ONE record written
        → → sink → channel                                             (as Path 1)        ✅
    → :2373-2375 rethrow the same error                                                   ✅
  → orchestrator catch → state='failed', errorKind='invalid-setting'   auto-start-orchestrator.ts:232-233 ✅
    → :241 notify() → listener                                                           ✅
      → hostFailureKindForStartError('invalid-setting') → explicit `case` → null
                                                     host-diagnostics.ts:249-250          ✅ NO second record
Exit: exactly one record, kind 'other', carrying the setting message                      ✅ one, not two, not zero
```

**判定**: ✅ connected. The record vocabulary narrowed to the contract's 7 members
(`host-diagnostics.ts:44-51`), and the message that loses its own `kind` is re-homed on the Extension's `other`
bucket through the precise signal alone — the round-1 `!(error instanceof HostStartError)` heuristic is gone
(`extension.ts:2367`). Both directions of the "one attempt = one record" rule are pinned: this case by
`host-diagnostics.spec.ts:1099-1115` (asserts length 1, kind `other`, detail contains `dsh.nodeBin`) and the
listener's refusal to touch it by `:512-528` (empty store after an `invalid-setting` snapshot). The double-count
risk that motivated the removed heuristic is covered on the other side: a failure a boundary already recorded
moves the high-water mark, so `:2367` skips it — the Host-owned retry case at `:1189-1227` asserts exactly
2 records after one retry, not 3.

### Path 4 — Queued (coalesced) retry inside `runStart`'s `finally` → record (CONNECTED; was a gap in round 1)

```
Entry: a second start reason arrives while the first attempt is in flight
  → request('command-send')                        auto-start-orchestrator.ts:152-169
    → :160 state === 'starting' → pending.push; state = 'pending-start'; :164 notify()  ✅
      → listener: 'pending-start' !== 'failed' → recorded = undefined                   ✅ guard re-armed
  → the in-flight attempt fails → catch → state='failed'                                ✅
  → finally :240 const more = this.pending.splice(0)                                    ✅ queued reason kept
    → :241 notify() → listener records #1 (phase 'start')                               ✅
    → :242 more.length > 0 && !isConnected && generation unchanged
    → :245 await this.runStart(next)                                                     ✅ recursion, same class
      → :207 'starting' → :210 notify → guard re-armed                                  ✅
      → the queued attempt fails → :241 notify → listener records #2 (phase 'retry')     ✅
Exit: two records for two attempts, second paired with the first                        ✅
```

**判定**: ✅ connected. This path was inert in round 1 for the same reason as Path 2 (the `starting`
transition did not clear the guard) and is fixed by the same change. Runtime evidence:
`host-diagnostics.spec.ts:616-655` drives the real `AutoStartOrchestrator` with a real port whose `start`
throws the `missing-credentials` class, lets the second reason coalesce into `pending-start`, and asserts
`starts === ['command-start','command-send']` plus two records with `phase: 'retry'` and the correct
`retryOfSeq`.

### Path 5 — Diagnostic read surfaces (CONNECTED, regression)

```
Entry: extension command surface
  ├─ package.json:142-145  { "command": "dsh.showHostDiagnostics",
  │                          "title": "DeepSeek Harness: Show Host Start Diagnostics" }   ✅ contributed
  ├─ extension.ts:537-539  registerCommand('dsh.showHostDiagnostics')  ← byte-identical       ✅
  │    → :538  hostDiagnosticsChannel?.show()                                                 ✅ really called
  │    → name = HOST_DIAGNOSTICS_CHANNEL_NAME = 'DeepSeek Harness' (single source, :23)       ✅ stable
  └─ extension.ts:1100-1109 registerCommand('dsh.test.getDiagnosticsText')
       └─ the register call sits INSIDE the shouldRegisterTestHooks if-block
            gate opens at  extension.ts:1009;  block closes at  extension.ts:1224            ✅ inside gate
            → () => hostDiagnostics?.records() ?? []     extension.ts:1108                    ✅ array, never null
            → hostDiagnostics is the instance handed to the Host
              (:436 → :445 → :2311)                                                          ✅ same instance
            → records() returns [...this.store]          host-diagnostics.ts:385-387        ✅ shared elements
Exit: structured HostDiagnosticRecord[]                                                       ✅
```

**判定**: ✅ connected. `dsh.test.getDiagnosticsText` is reachable only through the gate — and the negative
direction is now genuinely observable: `host-diagnostics.spec.ts:1040-1066` stubs `node:module._load` to reach
`activate(ctx)` with no injected `vscode` double, then asserts `dsh.showHostDiagnostics` **is** registered while
`dsh.test.getDiagnosticsText` **is not** and the whole `dsh.test.*` prefix is empty. The phase's own read helper
goes through the registered command rather than the recorder (`host-diagnostics.spec.ts:989-993`), so every AC
assertion in that file exercises this wiring, not a shortcut.

### Path 6 — Runtime death **after** a successful connect → no record (UNCHANGED — adjudicated, now documented)

```
Entry: the child exits after the handshake succeeded
  → watchTransport loop rejects                             session-host.ts:714-718  ✅ observed
    → onTransportDeath(reason)                              session-host.ts:727-757  ✅ status='error' (:729), notifyError (:756)
      → diagnostics.record(...)                             🔴 ABSENT — no call site in :727-757; session-host.ts:451 is the
                                                               only record() call site in src/
  → store / channel / dsh.test.getDiagnosticsText           never observe the event
  → orchestrator: 'started' → onUnexpectedDisconnect() → 'disconnected'
                                                            auto-start-orchestrator.ts:174-189 ✅
    → listener: state !== 'failed'                          host-diagnostics.ts:283-285  ✅ contributes nothing (by design)
Exit: nothing recorded                                                                      ⚠️ unchanged

Second, narrower entry into the same gap — a death landing inside the start window's last instant:
  → start() resolves with status = 'connected'             session-host.ts:439  ✅
  → the transport dies before the orchestrator reads it    session-host.ts:729 (status = 'error')  ✅ observed
  → :222 this.port.isConnected() === false                 auto-start-orchestrator.ts:2289  ✅
    → :226-228 state='failed', errorKind='process-failed', message set  ← pre-existing Phase 1
                                                    branch (the phase's diff to this file touches
                                                    START_ERROR_KINDS + its JSDoc only)        ✅
    → :241 notify() → listener
      → hostFailureKindForStartError('process-failed') → null   host-diagnostics.ts:255      ✅ by design
    → extension port: start() resolved, so its catch never runs → no `other` fallback         ✅ no throw
  → store: one `failed` snapshot, zero records             ⚠️ same root cause as DEBT-010
```

**判定**: ⚠️ **not a break under the accepted reading — and no longer silent.** See the ruling review below. The
second entry shown above is the sharpest form of the gap: a `failed` snapshot whose message the orchestrator
synthesised itself (`auto-start-orchestrator.ts:227`), for which no producer exists anywhere — the listener
declines it by design (`host-diagnostics.ts:255`) and the port's fallback is only reachable through a `throw`
(`extension.ts:2351`). It is phase-1 code reached through a post-handshake death, so it lands inside the
adjudicated scope rather than outside it, but it is a second locator the debt row does not carry (S-2).

---

## 上下游连接检查

| New / changed surface | Upstream (who calls it) | Link | Downstream (what it calls) | Link |
|---|---|:--:|---|:--:|
| `describeStartFailure()` (`session-host.ts:134`) | `start()` catch (`:445`) | ✅ | `HostDiagnosticInput` → recorder (`:451`) | ✅ |
| `startErrorKindForFailure()` (`host-diagnostics.ts:224`) | `session-host.ts:459` | ✅ | `HostStartError.kind` (`session-host.ts:67`, `:454/459`) | ✅ |
| `HostDiagnosticRecorder.record()` (`host-diagnostics.ts:350`) | `session-host.ts:451`; `host-diagnostics.ts:293`; `extension.ts:2368` | ✅ | `store.push` + `sink.present` (`:373`, `:377`) | ✅ |
| extension sink closure (`extension.ts:430-434`) | recorder ctor (`:429`) | ✅ | `channel.appendLine(format…)` (`:432`) | ✅ |
| `createStartFailureListener()` (`host-diagnostics.ts:278`) | `extension.ts:448` | ✅ | recorder (`:293`) — **now reached on every attempt** | ✅ |
| orchestrator `onChange` subscription (`extension.ts:449-453`) | `AutoStartOrchestrator.onChange` (`:449`) | ✅ | UI projection + listener (`:450`, `:452`) | ✅ |
| `dsh.statusBarAction` (`extension.ts:519`) | `package.json:147`; `connection-ui.ts:81`, `:188` | ✅ | `orchestrator.request` (`:521`) → `runStart` | ✅ |
| panel `action/retry-connect` (`chat-panel-provider.ts:1126`) | webview message | ✅ | `chat-panel-host.ts:729` → `extension.ts:1428` → `request` | ✅ |
| `dsh.showHostDiagnostics` (`extension.ts:537`) | `package.json:143` | ✅ ID character-for-character | `channel.show()` (`:538`) | ✅ |
| `dsh.test.getDiagnosticsText` (`extension.ts:1106-1109`) | inside `shouldRegisterTestHooks` (`:1009`) | ✅ gate genuinely closes | `hostDiagnostics.records()` (`:1108`) — same instance | ✅ |
| `hostFailureKindForStartError()` (`host-diagnostics.ts:245`) | `host-diagnostics.ts:287` | ✅ | snapshot class → record kind (or `null` to defer) | ✅ |
| `START_ERROR_KIND_BY_FAILURE` (`host-diagnostics.ts:209`) | compile-time total over 7 kinds | ✅ | `startErrorKindForFailure` (`:224`) → `HostStartError.kind` | ✅ |
| `TransportClosedError.details` (`client.ts:68`, `:506-513`) | `closedError()` (`:496-503`) | ✅ | `session-host.ts:152-164` | ✅ |
| `TransportClosedDetails` export (`packages/sdk/client/src/index.ts:20`) | `client.ts:39` | ✅ value + type both exported | `session-host.ts:15` import | ✅ |
| `onTransportDeath` (`session-host.ts:727`) | `watchTransport` (`:716`) | ✅ | recorder | ❌ **no edge** (adjudicated) |
| `HostDiagnosticRecorder.setSink()` (`host-diagnostics.ts:333`) | **no caller anywhere** | ❌ unwired | — | n/a |
| `HostDiagnosticRecorder.setCredentials()` (`host-diagnostics.ts:325`) | `session-host.ts:377` | ✅ | per-record redaction (`:411`) | ✅ |
| `onStartSucceeded()` (`host-diagnostics.ts:341`) | `session-host.ts:440` | ✅ | closes the chain (`:342`) | ✅ |
| `lastSeq()` (`host-diagnostics.ts:393`) | `extension.ts:2332`, `:2367` | ✅ | attempt-scoped dedup for the port fallback | ✅ |
| `records()` (`host-diagnostics.ts:385`) | `extension.ts:1108`; test helper (`spec:990`) | ✅ | command + assertions | ✅ |
| AD-13 projection fields | `handleApproval` (`interaction-coordinator.ts:273`, `:276`) | ✅ | `projectEntry` (`:225`, `:227`) → `extension.ts:1098` | ✅ |
| `FAKE_STDERR_LINES` / `FAKE_EXIT_CODE` / `FAKE_SELF_SIGNAL` (`fixtures/fake-sdk-runtime.mjs:241-259`) | — | ✅ | `session-host.spec.ts:324`, `:351`, `:371`, `:385` | ✅ |
| `FAKE_EXIT_CODE` / `FAKE_SELF_SIGNAL` (`packages/sdk/client/tests/fake-runtime.ts:65-66`) | — | ✅ | `sdk-client.spec.ts:424`, `:439` | ✅ |

## 跨模块契约验证

| Boundary | Caller expects | Callee provides | Match |
|---|---|---|:--:|
| `extension.ts` → `IdeSessionHost` ctor | `HostFailureDiagnostics` (extends `HostFailureRecorder` + `onStartSucceeded`) | `HostDiagnosticRecorder` implements it (`host-diagnostics.ts:304`; `session-host.ts:103-106`) | ✅ |
| `extension.ts` → `StartHostPort.start` fallback | a record only when nothing else recorded | `lastSeq()` before/after (`:2332`, `:2367`) — precise signal, no `instanceof` heuristic | ✅ |
| `auto-start-orchestrator` → thrown start error | a member of `START_ERROR_KINDS` (`:27-35`) | structural read, no text matching (`:60-68`), consistent with AD-3 (`spec.md:67`) | ✅ |
| `auto-start-orchestrator` → snapshot | `errorKind` faithful to the thrown class | set on both failure paths (`:227`, `:233`) | ✅ |
| record `phase` / `retryOfSeq` on a retry | the retry is the chain's next link | true on every producer — Host record (`session-host.ts:451`) and orchestrator listener (`host-diagnostics.ts:356-357`) both read the same `chainStartSeq` (`:372`) | ✅ |
| `HostDiagnosticRecord.kind` vocabulary | exactly the frozen 7 members | `host-diagnostics.ts:44-51` (7); the contract test takes its expectation from the design list, not from the type (`spec:450`) | ✅ |
| `resolvedExecutable` "absolute path" | field doc states the restriction | doc now says absolute **only** for `process-exec-path` (`host-diagnostics.ts:75-80`, `:114-118`); producer `launch.ts:132-139` unchanged | ✅ (contract aligned) |
| SDK `TransportClosedDetails` | type usable by the app | value + type exported on separate lines (`index.ts:14-20`) | ✅ |
| approval frame → projection | `toolName` non-empty, `reason` optional | wire validation + conditional spread (`interaction-coordinator.ts:273-276`) | ✅ |
| `phase` vocabulary vs a post-connect death | `'start' \| 'retry'` only | no third member; the gap is documented + registered instead | ✅ (see ruling) |

## 跨 Phase 依赖检查

| This phase depends on | From | Interface state | Link |
|---|:--:|:--:|:--:|
| `resolveNodeExecutableSpec` / `ResolvedNodeExecutable` | Phase 1 / SDK | unchanged; consumed at `session-host.ts:408` | ✅ |
| `NodeEnvironmentError.failure` | Phase 1 | narrowed by `instanceof` before reading (`session-host.ts:139-151`) | ✅ |
| `HostStartError` / `StartErrorKind` vocabulary | Phase 1 | extended additively with `bridge-listen` / `spawn` / `handshake-timeout` (`auto-start-orchestrator.ts:27-35`); `HostStartErrorKind = StartErrorKind` (`session-host.ts:67`) | ✅ |
| `redactSecrets` | Phase 1 | reused, not re-implemented (`host-diagnostics.ts:12`) | ✅ |
| `shouldRegisterTestHooks` gate | earlier phase | reused unchanged; the new command is inside it (`extension.ts:1009`, `:1106-1109`) | ✅ |
| `ConnectionUiController` / `errorKind → settingsDeepLinkAvailable` | Phase 1 | unchanged (`connection-ui.ts:140`), `bar.command` (`:188`) | ✅ |
| DEBT-008 (comment/reference fidelity, user-assigned to this phase) | Phase 1 review | resolved row present (`tech-debt-registry.md:48`); re-probed here: `AD-9` at `extension.ts:233`, `:2245`; no `AD-10` for the setting read | ✅ |
| DEBT-010 (post-handshake gap) | this phase | registered 🟡 non-blocking (`tech-debt-registry.md:28`) — **locator imprecise**, see S-2 | ⚠️ |
| Phase 3 machine driver asserts `resolvedExecutable` is absolute (`spec.md:57`) | Phase 3 | rests on the field doc, which now states the `process-exec-path`-only restriction honestly | ⚠️ carried (no Phase 2 consumer harmed) |

---

## 严重度裁定复核 —— 我是否同意 C-2 的握手前读法

The orchestrator ruled that AC-18's `child-exited` evidence is the **pre-handshake** exit path
(`spec.md:52` drives it with `process.exit(7)` / `SIGTERM` under `FAKE_PENDING_INIT`), that a post-handshake
death is a runtime disconnect rather than a start-failure boundary, and converted my round-1 round-2-rerun
finding into "evidence + explicit ledger entry + registered residual gap". **I reviewed the ruling against the
sources myself and concur.** The reasons, from the text rather than from the ruling's summary:

- `spec.md:13` scopes the whole AC set to "Host **启动**的每个失败边界" — a post-handshake death is outside that
  window by construction.
- `spec.md:52` is the spec's own verification method for AC-18 and it lands inside the start window
  (`FAKE_PENDING_INIT` + a real exit code / self-signal). The acceptance reading is therefore reachable and is
  reached — `session-host.spec.ts:351`, `:371`, `:385` cover `exitCode === 7`, `exitCode === 0` and `SIGTERM`
  in three distinct assertions, and all three pass in my run.
- The record vocabulary is itself start-centric: `FAILURE_DETAILS['child-exited']` reads "was reaped **before
  the handshake completed**" (`host-diagnostics.ts:187`), and `phase` is `'start' | 'retry'` (`:54`). Wiring the
  post-connect edge would need a third `phase` member — a field-surface change that AD-14 decision 11 says must
  bump `schemaVersion` (`spec.md:70`), breaking Phase 3's `=== 1` exact-field assertion. The cost/benefit is
  genuinely lopsided.
- The gap is **no longer silent**, which was my actual objection: `implementation.md:224` (§8.12) names the
  mechanism correctly (`TransportClosedError` / transport-watcher, channel untouched), and `DEBT-010` warns
  Phase 3 that an empty `getDiagnosticsText()` must not be read as "no failure occurred".

I have **no new evidence** that would overturn the ruling, and `repo-exploration.md:606` itself recommended
exactly this resolution ("satisfy AC-18 through the pre-handshake exit path inside `start()` … If that reading
is rejected, this is a spec ambiguity worth escalating before coding, not after"). I therefore do **not**
re-raise it as a blocking item. What I do raise is the precision of its handover (S-2 below). While checking the
ruling I did find one further sub-case of the same gap — a death landing between `session-host.ts:439` and the
orchestrator's `:222` read, which leaves a synthesised `process-failed` snapshot with no record producer
(Path 6, second entry). That is *inside* the adjudicated scope rather than evidence against it: it is the same
post-connect edge seen one instant earlier, so it argues for a fuller debt locator, not for reopening the
decision.

---

## 关键发现

### 🔴 Must-Fix

None. The round-1 blocking edge (retry → "append a record" for orchestrator-owned classes) is connected, and
the rework introduced no new break: every failure path inside `createStartHostPort.start` still yields exactly
one record, and the `starting`-transition re-arm cannot double-record within one attempt (no non-`failed`
notify occurs between the two settles in `runStart`'s `finally`, `auto-start-orchestrator.ts:240-249`).

### 🟡 Should-Fix

**S-1 — `HostDiagnosticRecorder.setSink()` still has no caller anywhere in the repo.**

- Location: `apps/vscode-dsh/src/host-diagnostics.ts:333-335` (definition, with its JSDoc at `:329-332`).
- Measured: a repo-wide search for `setSink(` returns **one** occurrence — the definition. No production call
  site, no test uses it, no doc names an owner. The wired path is the constructor option (`:316`) as consumed
  at `extension.ts:429-434`.
- Why it matters for connectivity: an exported seam on a brand-new class with no consumer is a second,
  never-exercised path to the same field (`private sink`), i.e. the reader cannot tell which one is
  authoritative. This repo's own convention requires a current owner and need for exactly this kind of surface
  (`packages/AGENTS.md`, "Require a current owner and need").
- Carried over unchanged from round 1 (it was C-3 then and is listed as O-5 in the merged report). Resolution
  is one of: delete it, or name its owner and the case that needs a late-bound sink.
- Not a MUST-FIX: the constructor path is complete and the dead seam cannot be reached, so no end-to-end path
  is broken.

**S-2 — `DEBT-010` cites the wrong file/function for the edge that is actually missing.**

- Location: `tech-debt-registry.md:28`, column `文件:函数:行号` reads
  "`apps/vscode-dsh/src/host-diagnostics.ts:260-294`（`createStartFailureListener`）与 `apps/vscode-dsh/src/session-host.ts`
  的 fail-loud 出口（`describeStartFailure` / `StartStage` 覆盖的五个启动阶段）".
- The absent insertion point is `session-host.ts:727-757` (`onTransportDeath`) — the private method that already
  sets `status = 'error'` (`:729`) and calls `notifyError` (`:756`) but never touches `diagnostics`. The cited
  `describeStartFailure` / `StartStage` are the *present* fail-loud surface, not the *absent* edge; a reader
  acting on this row looks in `start()`'s catch and finds nothing missing.
- A **second** locator is missing too: `auto-start-orchestrator.ts:225-229` is the one place a `failed` snapshot
  is synthesised by the orchestrator itself and owned by nothing — the listener declines `process-failed` by
  design (`host-diagnostics.ts:255`) and the port's `other` fallback needs a `throw` (`extension.ts:2351`), so
  that attempt ends with zero records. It is reached through the same post-handshake death (`session-host.ts:729`
  flips the status between `:439` and the orchestrator's `:222` read), so it belongs in this row's scope rather
  than in a new one. Note that `host-diagnostics.ts:229-240` justifies the `null` with "the Host writes its own
  record for those" — true for every *thrown* member, but not for this synthesised one, which is what the row
  should capture so the next owner does not re-derive it.
- Why it matters for connectivity: the registry row is the cross-phase handover channel for a deliberately
  unwired edge. If its locator does not lead to the missing edge, the handover is degraded — and AD-14's
  `schemaVersion` cost note (correctly spelled out in the same row) makes it more likely the next owner
  re-derives the location from scratch.
- Cheap fix: add `session-host.ts:727-757` (`onTransportDeath`) and `auto-start-orchestrator.ts:225-229` to that
  column, next to the existing cites.
- Not a MUST-FIX: the row's *decision* content and its Phase 3 warning are accurate; only the pointer is off, and
  no Phase-2 acceptance path depends on the unwired edge.

### 🟢 Observations

- **O-1 — `apps/vscode-dsh/src/index.ts` does not re-export `./host-diagnostics.ts`.** The new contract
  (`HostDiagnosticRecord`, `HostFailureKind`, `formatHostDiagnosticRecord`, …) is reachable only by the deep
  path. No consumer needs it today — the extension consumes it internally and Phase 3's driver goes through the
  command surface — and `spec.md` does not require the export, so this is not a break. Noted because a future
  consumer that wants to type the `dsh.test.getDiagnosticsText` result would otherwise re-declare the 18 fields.
- **O-2 — Degradation when the host has no `createOutputChannel`.** `extension.ts:424-426` leaves the channel
  `undefined`, so `:432`'s optional call is skipped while the store keeps accumulating. Real VS Code always
  provides the API, the AC-13(a) double provides it, and `host-diagnostics.spec.ts:1026-1031` asserts the
  degraded host still answers the reveal command instead of throwing. Records stay readable through the test
  hook. Deliberate and documented in-code (`:427-428`).
- **O-3 — After a post-connect death the next attempt is recorded with `phase: 'start'`, not `'retry'`.**
  `onStartSucceeded()` closes the chain on a successful start (`host-diagnostics.ts:341-343` ←
  `session-host.ts:440`), so whichever resolution `DEBT-010` eventually takes must also state whether a
  post-connect death should open a chain. Consistent with the current "chain opens on failure, closes on
  success" rule; flagged so the debt's owner does not have to re-derive it.
- **O-4 — `resolvedExecutable`'s absoluteness remains a documentary contract.** `launch.ts:132-139` returns the
  `DSH_NODE_BIN` and setting values verbatim; only `process-exec-path` is inherently absolute. The field doc no
  longer overstates it (`host-diagnostics.ts:75-80`), no Phase 2 consumer decides anything differently, and
  `apps/vscode-dsh/package.json`'s `dsh.nodeBin` description already tells the user "absolute path". Phase 3's
  driver assertion (`spec.md:57`) is the only place that would notice a relative value.
- **O-5 — A stray probe file is present in the working tree.**
  `apps/vscode-dsh/tests/zz-rc2-probe.spec.ts` (untracked, mtime 00:36) declares itself as
  "TEMPORARY independent probe (reviewer-correctness, round 2) … Deleted after the run". It is a peer
  reviewer's in-flight artifact, not phase product, and it is **not** mine to remove — flagged only so it is
  not swept into the phase's commit set at HG-3. No production or phase test file references it.
- **O-6 — `pnpm-lock.yaml` shows workspace drift that is not attributable to this phase.** The diff touches
  `tsdown`, a `dsh-specdev` importer reordering, and a `vite` 6 → 8 link; none of it corresponds to a
  dependency this phase adds (`spec.md:76` forbids new dependencies, and `package.json`'s diff is
  commands-only). Recorded so it is not read as a phase change.

---

## 已执行的验证动作

Everything below was read from redirected output files, not from the implementer's report.

| Action | Command / location | Result |
|---|---|---|
| Compile-level connectivity across the package boundary | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run typecheck` | ✅ exit 0, `grep -c 'error TS'` → **0** |
| Run the phase's own spec (the file carrying every AC case) | `pnpm run test apps/vscode-dsh/tests/host-diagnostics` | ✅ exit 0 — 1 file, **44/44** passed (round 1 measured 36; +8 cases this rework) |
| Exercise the SDK → Host → orchestrator chains through production code | `pnpm run test packages/sdk/client/tests/sdk-client apps/vscode-dsh/tests/session-host apps/vscode-dsh/tests/auto-start-orchestrator` | ✅ exit 0 — 4 files, **76/76** passed |
| Command-ID consistency | `package.json:142-145` vs `extension.ts:537`; `package.json:69-153` vs the `registerCommand` calls | ✅ `dsh.showHostDiagnostics` character-for-character; no orphan contribution |
| Gate position for the read surface | read the `if (shouldRegisterTestHooks(…))` block boundary (`extension.ts:1009` … `:1224`) | ✅ `:1106-1109` is inside the gate |
| Gate-closed direction | read `host-diagnostics.spec.ts:1040-1066` (`node:module._load` stub) | ✅ command absent, and absent for the whole `dsh.test.*` prefix |
| Store instance identity | traced `extension.ts:429 → :436 → :445 → :2311 → :1108` | ✅ single instance, no copy |
| Dead code / unwired surface | search every new export for a consumer | ⚠️ `setSink` has none (S-1); every other export has a real caller |
| Reachability of the synthesised `process-failed` snapshot | read `session-host.ts:439` against `auto-start-orchestrator.ts:222` / `extension.ts:2289` | ⚠️ reachable only through the post-handshake death → 0 records; branch itself is pre-existing (the phase's diff to that file is `START_ERROR_KINDS` + JSDoc) |
| Fixture knobs | search each new knob for a consumer | ✅ all used (`session-host.spec.ts:324`, `:351`, `:371`, `:385`; `sdk-client.spec.ts:424`, `:439`) |
| Review-item codes in code | `rg 'F-3\.[0-9]|\((S[0-9]+|M[0-9]+|C-[0-9]+)[,)]' apps/vscode-dsh` | ✅ zero matches (`AD-*` references retained) |
| Round-1 blocking edge closed | run + read `host-diagnostics.spec.ts:1117-1142`, `:586-595`, `:597-614`, `:616-655`, `:1189-1227` | ✅ connected, discriminating, covering both halves of the dedup contract |

Not performed: I did not mutate production source to re-derive the round-1 failure mode, because that would
alter the tree under review. Discriminance of the new retry case was established by reading the constants that
make the two attempts' signatures identical (`auto-start-orchestrator.ts:215`, `:233`) against the round-1
guard's documented lifetime, plus the measured green run.

---

## 范围声明

This report covers **connectivity only**, within the Phase 2 scope defined by `spec.md` (AC-13 – AC-22) and
`design.md` (AD-1 – AD-14). Behavioural correctness (redaction completeness, per-field assembly, assertion
strength) belongs to `reviewer-correctness`; the soundness of the design choices and the vocabulary narrowing
belong to `reviewer-design`; appearance belongs to `reviewer-visual` (N/A for this non-UI phase).
