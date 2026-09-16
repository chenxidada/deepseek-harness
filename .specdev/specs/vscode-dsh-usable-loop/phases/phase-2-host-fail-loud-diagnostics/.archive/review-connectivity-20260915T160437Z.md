# Connectivity Review — Phase 2

Workflow: `vscode-dsh-usable-loop` · Phase: `phase-2-host-fail-loud-diagnostics` · Branch: `impl-phase-2-host-fail-loud-diagnostics`
Scope reviewed: AC-13 – AC-22 of `spec.md`, AD-1 – AD-14 of `design.md`, the call paths in `repo-exploration.md` §4, and every file listed in `spec.md` §产出清单.
Evidence type: **function bodies read + line-anchored locations + execution of the repo's own suites** (`pnpm run typecheck` and the Phase 2 spec files, re-run this session).

## 视角

**Integration Connectivity** — do the pieces actually connect? End-to-end data paths, upstream/downstream integration, cross-module wiring. Not code style (`reviewer-design`), not behavioural correctness (`reviewer-correctness`), not appearance (`reviewer-visual`).

## 判决：MUST-FIX

Twenty of the twenty-one wiring edges in this phase are genuinely connected: the record producer → bounded store → sink → Output Channel chain is real, the `dsh.test.getDiagnosticsText` hook is registered inside the gate and returns the store's own array (same instance, no copy), `dsh.showHostDiagnostics` matches `package.json` byte-for-byte and really calls `channel.show()`, the SDK structured details traverse `client.ts → index.ts → session-host.ts` with no type break, and the AD-13 projection is assigned at both ends. One edge is broken: the retry → "append a record" edge is inert for the two failure classes the orchestrator itself owns, because the listener's de-duplication guard is scoped to the failure *chain* rather than to a single *attempt* — so a retry that fails again with the same class and message records nothing, in exactly the failed state AC-19 mandates and AC-22(c) requires a clickable retry entry in. That makes AC-22's third mandatory clause unreachable for `missing-credentials` and `invalid-setting`, and it is not covered by any existing test (the AC-22 cases exercise a Host-owned class, which bypasses the guard).

## 端到端路径追踪

### Path 1: Host boundary failure → record → bounded store → Output Channel → user-visible (AC-13 / AC-14 / AC-15 / AC-16 / AC-18)

```
Entry: IdeSessionHost.start() fails at one of six boundaries
  → session-host.ts:411/413/420/430/433   stage variable marks the boundary       ✅ set
  → session-host.ts:445   describeStartFailure(error, {…, stage, socketPath,
                          exitCode, terminationSignal, stderrTail})               ✅ arguments supplied
      ├─ node pre-flight refusal (NodeEnvironmentError.failure) → 'node-environment' ✅
      ├─ bridge.listen refusal (stage === 'bridge-listen')      → 'bridge-listen'    ✅
      ├─ TransportClosedError.details.spawnError defined        → 'spawn'            ✅
      ├─ TransportClosedError.details.exitCode/signal           → 'child-exited'     ✅
      └─ no boundary named it                                   → 'other'            ✅
  → session-host.ts:451   this.diagnostics?.record(failure)                        ✅ single entry point
  → session-host.ts:454/459   throw HostStartError(…, diagnostic?)  ← same failure  ✅
  ── record side ──
  → host-diagnostics.ts:329-358   record(): per-field redaction + 18-field assembly ✅
  → host-diagnostics.ts:351-354   chainStartSeq ??= seq; splice past 200            ✅ bounded
  → host-diagnostics.ts:356       this.sink?.present(record)                        ✅ sink invoked
  → extension.ts:429-435          sink.present = channel.appendLine(format(record)) ✅ one recorder
  → extension.ts:424-426          createOutputChannel('DeepSeek Harness')           ✅ created first
Exit: one appended line in channel 'DeepSeek Harness' (formatHostDiagnosticRecord)   ✅
```

**Verdict**: ✅ fully connected. All four segments are real calls — no "function exists but nobody subscribes". `extension.ts:437-443` clears the channel and the recorder in one `dispose`, so there is no window where the sink writes to a disposed channel.

### Path 2: SDK structured details → Host classification → record fields (AC-14 / AC-16)

```
Entry: real spawn failure / subprocess exit (packages/sdk/client)
  → client.ts:290        child.once('exit', (code, signal) => this.exitSignal = signal) ✅ caught
  → client.ts:496-503    closedError(reason) → new TransportClosedError(msg, details)   ✅ producer fills
  → client.ts:506-512    transportDetails() → { executable, exitCode, terminationSignal,
                                                stderrTail, spawnError }                 ✅ field by field
  → src/index.ts:18      export { TransportClosedError }                                ✅ runtime value
  → src/index.ts:20      export type { …, TransportClosedDetails }                      ✅ type nameable
  → session-host.ts:134  describeStartFailure reads error.details.{…}                   ✅ consumer reads
  → record.{resolvedExecutable, exitCode, terminationSignal, stderrTail, socketPath}    ✅ lands in 18 fields
Exit: structured fields inside the record array (Phase 3 driver asserts them)            ✅
```

**Verdict**: ✅ no break. Type and runtime values are exported on separate lines (`index.ts:20` / `index.ts:18`); `apps/vscode-dsh` consumes the package entry point (not a deep path), and `pnpm run typecheck` exits 0, proving that property's type resolves across the package boundary. The `NodeJS.Signals → string | null` assignment holds at compile time.

### Path 3: orchestrator-side pre-flight failure → listener → record (AC-19 / F-3.1)

```
Entry A (first attempt, credentials missing):
  start requested → auto-start-orchestrator.ts:214   !port.hasCredentials()
  → :215-218   throw Error('missing credentials', { kind: 'missing-credentials' })  ✅
  → :232-234   state='failed', errorKind='missing-credentials',
               errorMessage='missing credentials'  (the throw's literal, constant)
  → :241 notify() → extension.ts:452 recordOrchestratorFailure(snap)                ✅ subscribed
  → host-diagnostics.ts:266-267   hostFailureKindForStartError → 'missing-credentials' ✅ not null
  → :272   recorder.record({ kind, detail })                                        ✅
Exit A: 1 record (phase 'start')                                                    ✅ connected

Entry B (retry, credentials still missing — the same failed state):
  → auto-start-orchestrator.ts:207   state='starting'
  → :210 notify() → host-diagnostics.ts:262-265   not failed → return, **guard not cleared** ⚠️
  → :220 skipped (port.start never entered) → :232-234 same kind + same message
  → :241 / :249   two notifies
  → host-diagnostics.ts:269-270   signature === recorded → return                    🔴 no record
Exit B: **0 records** — the retry is invisible in the diagnostic channel             🔴 broken
```

**Verdict**: 🔴 MUST-FIX — see finding C-1. First attempt connected, retry broken.

### Path 4: retry entry → same start path → paired records (AC-22)

```
Entry: click the retry entry while failed
  → panel path: extension.ts requestRetryConnect → orchestrator.request(…)
  → status-bar path: extension.ts:537 'dsh.statusBarAction' → same orchestrator.request(…) ✅ single entry
  → auto-start-orchestrator.ts:205  runStart(reason) — the only start implementation,
                                    no parallel path                                     ✅ path reuse
  → :220  await this.port.start(reason)
  → extension.ts:2310  new IdeSessionHost(diagnostics)  ← **the same recorder instance**  ✅
  → extension.ts:2311  hostCreateCount += 1                                              ✅ (reset at :382)
  → on failure, the new Host's own session-host.ts:451 records it                        ✅
Exit (Host-reachable class, e.g. node-environment / spawn):
     channel gains a line; array gains 1 record, phase='retry', retryOfSeq=first seq     ✅
     (host-diagnostics.spec.ts:966 measured 1→2 records and hostCreateCount 1→2)
Exit (orchestrator-owned class, e.g. missing-credentials / invalid-setting):
     array gains 0 records                                                               🔴
```

**Verdict**: path reuse and `hostCreateCount` ✅; **record pairing holds only for Host-reachable classes.** The fallback comment at `extension.ts:2357-2362` assumes "the Host records its own boundary or the orchestrator does (missing-credentials / invalid-setting)" — but on a retry the orchestrator's listener is suppressed by the guard while the Host is never entered (`:214` throws before `:220`), so that attempt has no recorder on either side. See C-1.

### Path 5: diagnostic read surfaces (AC-13 / AD-14 hook contract)

```
Entry: extension command surface
  ├─ package.json:143  { "command": "dsh.showHostDiagnostics", "title": … }            ✅ contributed
  ├─ extension.ts:537  registerCommand('dsh.showHostDiagnostics')  ← byte-identical      ✅
  │    → :538  hostDiagnosticsChannel?.show()                                          ✅ really called
  │    → name = HOST_DIAGNOSTICS_CHANNEL_NAME = 'DeepSeek Harness' (single source)      ✅ stable
  └─ extension.ts:1105-1108  registerCommand('dsh.test.getDiagnosticsText')
       └─ the register call sits **inside** the shouldRegisterTestHooks if-block        ✅ inside gate
            → () => hostDiagnostics?.records() ?? []                                    ✅ array, never null
            → hostDiagnostics is the instance handed to createStartHostPort
              (:436 → :445 → :2310 → :1107)                                             ✅ no copy
Exit: structured HostDiagnosticRecord[]                                                 ✅
```

**Verdict**: ✅ fully connected. `contributes.commands` holds 21 entries, 21 unique. With the gate closed the command is **not registered** (not "registered but returning empty") — the contract holds.

### Path 6: approval interaction projection (AD-13)

```
Entry: bridge frame kind === 'approval/request'
  → session-host.ts:839-840    this.interactions.handleApproval(frame)  ← frame carries toolName/reason ✅
  → interaction-coordinator.ts:265-277   ApprovalEntry{ toolName: frame.toolName,
                                           …reason === undefined ? {} : { reason } }    ✅ assigned
  → :197-200  listPending() → :208-228 projectEntry(entry)
       ├─ :225  toolName: entry.toolName                                                ✅ read back
       └─ :227  …reason conditional spread                                              ✅
  ├─ consumer A (Phase 1 UI path): :434-440 HostApprovalRequest{ toolName, …reason }
  │    → interaction-ui.ts:75                                                           ✅
  └─ consumer B (read surface): extension.ts:1098 () => host?.interactions.listPending() ✅
Exit: the projected array (asserted by the Phase 3 driver)                              ✅
```

**Verdict**: ✅ no "field added to the type but never assigned" break. Upstream frame → queue entry → projection all have real assignments and real readers.

## 上下游连接检查

| New component / field | Upstream (who calls / assigns) | Status | Downstream (who consumes) | Status |
|---|---|:--:|---|:--:|
| `HostDiagnosticRecorder` (store + sink) | `extension.ts:429` (the only instantiation) | ✅ | `extension.ts:432` sink → Output Channel | ✅ |
| `HostFailureRecorder` interface | `session-host.ts:451` `diagnostics?.record()` | ✅ | line above | ✅ |
| `describeStartFailure()` | `session-host.ts:445` catch block | ✅ | `:451` record + `:454/:459` throw | ✅ |
| `startErrorKindForFailure()` | `session-host.ts:459` | ✅ | `auto-start-orchestrator.ts:64-66` allowlist check | ✅ |
| `hostFailureKindForStartError()` | `host-diagnostics.ts:266` listener | ✅ | `:272` record | ✅ |
| `createStartFailureListener()` | `extension.ts:448` construction | ✅ | `extension.ts:452` every onChange | ✅ |
| `dsh.showHostDiagnostics` | `package.json:143` | ✅ | `extension.ts:537` byte-identical | ✅ |
| `dsh.test.getDiagnosticsText` | `extension.ts:1105` (inside gate) | ✅ | `hostDiagnostics.records()` same instance | ✅ |
| `TransportClosedDetails` | `client.ts:506-512` produces | ✅ | `session-host.ts:134` consumes | ✅ |
| `PendingHostInteraction.toolName/reason` | `interaction-coordinator.ts:273/276` | ✅ | `:225/:227` → `:437-438` / `:1098` | ✅ |
| `HostDiagnosticRecorder.setSink()` | **no caller anywhere** | ⚠️ | — | ❌ unwired |
| `HOST_DIAGNOSTIC_RECORD_LIMIT` | `host-diagnostics.ts:353` | ✅ | `host-diagnostics.spec.ts` | ✅ |
| `invalid-setting` explicit branch (F-3.1) | `extension.ts:2256-2261` throws; called at `:2334` | ✅ | orchestrator `:233` → listener → record | ✅ |

## 跨模块契约验证

| Between | Caller expects | Callee delivers | Match? |
|---|---|---|:--:|
| `extension.ts` → `HostDiagnosticRecorder` | `records(): readonly HostDiagnosticRecord[]` | `:364-366` returns the internal store read-only | ✅ |
| `extension.ts` → `dsh.test.getDiagnosticsText` | `Array.isArray(records) === true` | `:1107` `records() ?? []` | ✅ |
| `session-host.ts` → `HostFailureRecorder` | `record(input: HostDiagnosticInput)` | `:329` accepts a subset of the 18 fields | ✅ |
| `IdeSessionHost.start` → `AutoStartOrchestrator` | thrown error carries `.kind ∈ HostStartErrorKind` | `HostStartError` sets `kind` (`session-host.ts:454/459`) | ✅ |
| `AutoStartOrchestrator.port` → `StartHostPort.start` | `StartErrorKind` allowlist | widened to include bridge-listen/spawn/handshake-timeout (`:28-36`) | ✅ |
| `ConnectionUiController` ← orchestrator snapshot | `errorKind` drives the terminal copy | `:136` conditional spread; `connection-ui.ts` projection | ✅ |
| **`resolvedExecutable` "absolute path" contract** | type doc + Phase 3 spec assert absolute (`host-diagnostics.ts:71`, `spec.md:57`) | `launch.ts:133-138` returns the setting **verbatim**; only `process-exec-path` (`:140-144`) is inherently absolute; no `isAbsolute` check anywhere in `apps/vscode-dsh/src` or `packages/sdk/client/src` for this chain | ⚠️ see O-1 |

## 跨 Phase 依赖检查

| This phase depends on | From | Interface state | Connectivity |
|---|:--:|:--:|:--:|
| `IdeSessionHost.start` / `HostStartError.diagnostic` (F-3.2 invariant) | Phase 1 | signature unchanged, JSDoc extended | ✅ no new unguarded `.diagnostic` read |
| `AutoStartOrchestrator` / `StartHostPort` | Phase 1 | **enum widened** (3 new `StartErrorKind` members), additive | ✅ existing members keep semantics |
| `ConnectionUiController.getState()` | Phase 1 | unchanged | ✅ |
| `interactions.listPending()` | Phase 1 | **return shape widened** (`toolName` required, `reason` optional) | ✅ existing consumers ignore new fields |
| `packages/sdk/client` public exports | Phase 1 | **additive** (`TransportClosedDetails`, `DEFAULT_INITIALIZE_TIMEOUT_MS`), nothing removed | ✅ |
| host diagnostics vs the IDE bridge socket | Phase 1 | different socket paths, no cross-read/write | ✅ |

## 关键发现

### 🔴 Must-Fix

**C-1 — the retry → "append a record" edge is broken for orchestrator-owned failure classes (AC-22's third clause is unreachable in those states)**

- Location: `apps/vscode-dsh/src/host-diagnostics.ts:257-274` — `:260` guard declaration, `:263` its **only** clearing point, `:269-271` the suppression.
- Upstream: `apps/vscode-dsh/src/auto-start-orchestrator.ts:207-210` (a retry sets `'starting'` and notifies), `:214-219` (missing credentials throws **before `port.start`**), `:232-234` (`errorKind` / `errorMessage` are constant).
- Downstream: `apps/vscode-dsh/src/extension.ts:448-453` (listener subscription), `:2357-2362` (the fallback comment that assumes the orchestrator will have recorded it).

The `recorded` de-duplication guard is cleared **only when the snapshot reaches `state === 'started'`** (`:263`; every other non-`failed` state returns early without clearing). `missing-credentials` and `invalid-setting` **can never reach `started`**, therefore:

1. First attempt → 1 record (`phase: 'start'`) ✅
2. User clicks retry (status bar `dsh.statusBarAction` or the panel entry) → `:214` still finds no credentials → throws the same `Error('missing credentials')` → identical `kind` and identical `message` → `:270` hits the guard → **0 records**
3. Third, fourth, Nth retries behave the same → the channel keeps exactly one record no matter how many attempts were made, and no `phase === 'retry'` + `retryOfSeq` pair is ever produced

Why this is not "by design": `spec.md:34` makes AC-22 `[Must]` and states that after triggering the entry the system **必须 在重试的前后向诊断通道追加记录**; `spec.md:31` (AC-19) defines `missing-credentials` as *the* failed state, and that state must offer a clickable retry entry (`spec.md:56` AC-22(c) asserts `statusBar.command === 'dsh.statusBarAction'`, which this phase's own `host-diagnostics.spec.ts:917-918` asserts too). In other words, **the retry entry the spec mandates is offered precisely in the state where this record edge is dead.** The queued-retry recursion at `auto-start-orchestrator.ts:242-246` has the same shape (`runStart(next)` sets `'starting'` again without clearing the guard), so a queued retry also leaves no record.

The `extension.ts:2357-2362` fallback (`!(error instanceof HostStartError) && lastSeq() === seqBeforeStart` → write `kind: 'other'`) cannot cover it: `missing-credentials` is thrown at `:214`, so `port.start` (`:2290-2375`) is never entered and that catch never runs.

Blast radius: all retries in the `missing-credentials` and `invalid-setting` states (including the retry AC-22(c) requires during the AC-19 terminal state). `node-environment` / `spawn` / `bridge-listen` / `handshake-timeout` / `child-exited` go through the Host's own `record()` and are **unaffected** — which is exactly why the existing tests miss it: `host-diagnostics.spec.ts:966` (AC-22) drives `node-environment`, and `review-correctness.md`'s AC-22(b) evidence (`host-diagnostics.spec.ts:984-1003`) drives the same Host-owned class.

Smallest change that removes the dead edge (recorded here, not prescribed as a design choice): scope the guard's lifetime to a single attempt — e.g. also clear `recorded` on the `'starting'` branch at `:262`. `runStart` always sets `'starting'` and notifies before any failure (`:207/:210`), and the two notifies inside one attempt (`:241`, `:249`) both occur *after* the last `'starting'`, so within-attempt de-duplication survives and the success-path clearing semantics are unchanged.

> Evidence note: this finding is a **code-tracing** conclusion, corroborated by the repo's own assertion of the guard's lifetime semantics at `host-diagnostics.spec.ts:405-477` (that case explicitly asserts only `'started'` clears the guard, and never exercises "fail again in the same failed state"). I intended to execute a one-shot probe of the exact sequence, but the sandbox blocked running an uninspected script; no runtime evidence was obtained for this item, and every statement above was verified by reading the cited lines directly. Recommend the implementer add an extension-level case after the fix (missing-credentials state → trigger retry → assert 1→2 records with the second `phase === 'retry'`).

### 🟡 Should-Fix

**C-2 — the "subprocess exit" boundary only has a recorder on the pre-handshake entry; a post-connect exit is unrecorded and the trade-off is undocumented**

- `session-host.ts:445-451` is the only insertion point for a record (inside `start()`).
- A runtime that dies *after* connecting takes the other chain: `client.ts:445` → the Host's `onTransportDeath` edge → `extension.ts:2321-2325` `orchestrator.onUnexpectedDisconnect()`, which never reaches `diagnostics.record` (`repo-exploration.md` §7.2 anticipated this).
- `spec.md:30` (AC-18) says "**当** 子进程退出 **时**" without a pre/post-handshake qualifier; `spec.md:52` gives the testable reading (`process.exit(7)` / `SIGTERM` with `FAKE_PENDING_INIT`), which lands on the pre-handshake path and is covered and passing (`session-host.spec.ts:345-375`) ✅.
- Why not MUST-FIX: the acceptance reading is satisfied. But `implementation.md` records no decision for this trade-off (a search for `onTransportDeath` / post-connect returns nothing), and a post-connect crash really is invisible in the channel. Either write the trade-off into `implementation.md` as a deviation, or add the second insertion point.

**C-3 — the queued-retry path is outside AC-22's verified surface**

- `auto-start-orchestrator.ts:240-247`: when a start fails while reasons are queued, the orchestrator `await this.runStart(next)` directly.
- While C-1 stands, this path also leaves no record (the `'starting'` transition does not clear the guard); fixing C-1 resolves it as a side effect.
- Existing coverage only exercises an explicitly triggered retry (`auto-start-orchestrator.spec.ts:205`, `host-diagnostics.spec.ts:966`), never one driven by a queued reason — a gap in AC-22's verification surface.

### 🟢 Observations

**O-1 — `resolvedExecutable`'s "absolute" is a documentary contract, not a programmatic guarantee (no Phase 2 consumer is harmed)**

- Producer: `packages/sdk/client/src/launch.ts:131-145` returns `DSH_NODE_BIN` (`:133-134`) and `dsh.nodeBin` (`:136-138`) **verbatim**; only `process-exec-path` (`:140-144`) is inherently absolute. No `isAbsolute` check exists for this chain in `apps/vscode-dsh/src` or `packages/sdk/client/src` (all `isAbsolute` hits there belong to `code-context` / `change`).
- Consumers: the field doc claims absolute (`host-diagnostics.ts:71-72`), and the frozen Phase 3 spec will assert "the `node-environment` record's `resolvedExecutable` is absolute" (`spec.md:57`).
- The contract is nonetheless declared where a user can see it: `apps/vscode-dsh/package.json:64` (the `dsh.nodeBin` description) reads "Absolute path to the Node.js executable…". So this is not a broken link — only a note that documentation is the sole guarantee, and a relative value would produce a record violating its own doc. No Phase 2 consumer decides anything differently either way (`formatHostDiagnosticRecord`, the spec cases).
- Aside: `implementation.md`'s F-3.3 landing note says the record field doc "states the restriction", but `host-diagnostics.ts:71` / `:105` claim absoluteness without stating any restriction — a prose-fidelity gap (for `reviewer-design` to judge; recorded here only as the connectivity-relevant fact).

**O-2 — `HostDiagnosticRecorder.setSink()` has no caller**

- `host-diagnostics.ts:312-314` defines the setter; a repo-wide search (`src` + `tests`) matches only the definition. The sink is actually injected through the constructor (`:294-296`). A "reserved for later" public surface with no current consumer; no functional impact.

**O-3 — without `createOutputChannel`, record visibility degrades (defensive branch, unreachable in real VS Code)**

- `extension.ts:424-426` leaves the channel `undefined` when `createOutputChannel` is not a function, so `:432`'s optional call silently skips — while the store keeps accumulating.
- Real VS Code always provides `window.createOutputChannel`, so this branch only applies to duck-typed hosts; the AC-13(a) assertion also uses a double that provides the API. Not a gate risk; recorded because in that environment records are readable only through `dsh.test.getDiagnosticsText`.

**O-4 — `apps/vscode-dsh/src/index.ts` does not re-export the new diagnostics module**

- The new contract (`HostDiagnosticRecord` / `HostFailureKind` / `formatHostDiagnosticRecord`, …) is reachable only via the deep path `./host-diagnostics.ts`; the package entry point does not carry it.
- No current consumer needs it (the extension consumes it internally; the Phase 3 driver goes through the command surface rather than a type import), so this is not a break — just a note that a later phase wanting the types will need the export.

## 已执行的验证动作

| Action | Command / location | Result |
|---|---|---|
| Compile-level connectivity | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run typecheck` | ✅ exit 0, no cross-package type break |
| Command-ID consistency | `node -e` over `package.json` + `rg` on `registerCommand` | ✅ 21 commands, 21 unique; `dsh.showHostDiagnostics` / `dsh.test.getDiagnosticsText` byte-identical |
| Store instance identity | traced `extension.ts:436 → :445 → :2310 → :1107` | ✅ single instance, no copy |
| Gate position for the hook | read the if-block boundary around `extension.ts:1105` | ✅ inside `shouldRegisterTestHooks` |
| Bidirectional kind mapping | `host-diagnostics.ts:213-241` + `auto-start-orchestrator.ts:28-36/60-68` | ✅ both directions complete (8 members); `invalid-setting` has an explicit branch (`extension.ts:2256-2261`) |
| F-3.2 invariant | search for `.diagnostic` reads in new code | ✅ zero hits in new production code; the only new read is a case asserting `undefined` |
| Dead code / unwired surface | search for consumers of each new export | ⚠️ `setSink` has none (O-2) |

## 范围声明

This report covers **connectivity only**, within the Phase 2 scope defined by `spec.md` (AC-13 – AC-22) and `design.md` (AD-1 – AD-14). Behavioural correctness (redaction completeness, per-field assembly) belongs to `reviewer-correctness`; the soundness of design choices belongs to `reviewer-design`; appearance belongs to `reviewer-visual`.
