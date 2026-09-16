# Phase 2 implementation — `phase-2-host-fail-loud-diagnostics`

| Field | Value |
|---|---|
| Phase ID | `phase-2-host-fail-loud-diagnostics` (copied verbatim from `phase-plan.md` DAG JSON) |
| Workflow | `vscode-dsh-usable-loop` |
| Branch | `impl-phase-2-host-fail-loud-diagnostics` — verified with `git branch --show-current` before the first edit; every change stays in the working tree, and this agent runs no git command beyond inspection |
| UI | DAG JSON says `ui: false` → no prototype gate, no `visual-baseline.md`, no styling work in this phase |
| Executor | implementer (subagent); self-test only — the verdicts belong to the independent reviewers and the verifier |
| Date (UTC) | 2026-09-15 |
| Revision | **round 1** — fresh run. `implementation.md` did not exist at startup, so the startup self-cleanup protocol had nothing to archive (`.archive/` was not touched) |
| Read in full | `spec.md`, `repo-exploration.md`, `tech-debt-registry.md`, `.cursor/skills/project-build/SKILL.md`, `.cursor/skills/project-test/SKILL.md` |
| Read as instructed (partial) | `design.md:160-333` (AD-1 – AD-14), `requirements.md:135-153` + `:334` (AC-13 – AC-22 verbatim) |
| Read for bodies, not signatures | `node-env-guard.ts`, `session-host.ts`, `extension.ts`, `auto-start-orchestrator.ts`, `redact.ts`, `interaction-coordinator.ts`, `connection-ui.ts`, `packages/sdk/client/src/client.ts`, `packages/sdk/client/src/launch.ts` |

Scope: turn every Host start-failure boundary into an inspectable, classified, redacted record, and give the user a way to see it and retry it. The work is 12 modified tracked files (+734 / −34 lines, per `git diff --stat`) plus 2 new files (about 1,450 lines: the 439-line recorder and the 1,011-line spec), all inside the phase's `primary_files`, plus the two documentation surfaces the phase owns (`tech-debt-registry.md` for DEBT-008, and the operation skills which are agent contract, not phase product — see §8.8).

## 1. What the phase delivers

```
                    ┌─────────────────────────────────────────────┐
  start() stage     │  record (18 fields, redacted)  →  sink       │
  ───────────────   │                                             │
  resolve      ──┐  │  kind: node-environment | invalid-setting   │
  preflight    ──┤  │      | bridge-listen | spawn                │
  bridge-listen ─┼──┼→     | handshake-timeout | child-exited     │
  client-create ─┤  │      | missing-credentials | other          │
  spawn        ──┤  │  + resolvedExecutable / source / socketPath │
  handshake    ──┘  │  + exitCode / terminationSignal / stderrTail│
                    │  + handshakeTimeoutMs / detail / hint       │
                    └───────────────┬─────────────────────────────┘
                                    │
        extension.ts: HostDiagnosticRecorder (bounded 200, seq-stamped, redacted)
                                    │
              ┌─────────────────────┴──────────────────────┐
              ▼                                            ▼
   Output Channel "DeepSeek Harness"            dsh.test.getDiagnosticsText
   (dsh.showHostDiagnostics reveals it)         (test gate only, returns array)
```

The chain is end-to-end: `session-host.ts` classifies the boundary → `HostDiagnosticRecorder` numbers, timestamps and redacts → the sink renders it into the channel → `ConnectionUiController` projects a terminal state (`failed` + the root-cause copy) → the status-bar entry (`dsh.statusBarAction`) retries through the same `StartHostPort`, and the retry record is paired with the record that opened the chain (`phase: 'retry'`, `retryOfSeq`).

## 2. Change list

### 2.1 New product file

| File | Lines | What it holds |
|---|---|---|
| `apps/vscode-dsh/src/host-diagnostics.ts` | 439 (new) | the whole diagnostic contract and recorder |

Exports, as measured now:

| Symbol | Line | Note |
|---|---|---|
| `HOST_DIAGNOSTIC_SCHEMA_VERSION` | `:20` | the literal `1`, single source for the contract version (AD-14) |
| `HOST_DIAGNOSTICS_CHANNEL_NAME` | `:23` | `'DeepSeek Harness'` — the one stable channel name (AC-13) |
| `HOST_DIAGNOSTIC_RECORD_LIMIT` | `:26` | `200`; the store drops the oldest record first |
| `HostFailureKind` | `:38` | 8 members: `node-environment`, `invalid-setting`, `bridge-listen`, `spawn`, `handshake-timeout`, `child-exited`, `missing-credentials`, `other` |
| `HostDiagnosticPhase` | `:49` | `'start' \| 'retry'` (AC-22) |
| `HostDiagnosticRecord` | `:57-94` | the frozen 18-field record — see §3 |
| `HostDiagnosticInput` | `:97` | the subset a boundary supplies; the store fills `schemaVersion`/`seq`/`time`/`phase`/`retryOfSeq` |
| `HostDiagnosticSink` | `:127` | port the extension implements (output channel) |
| `HostFailureRecorder` | `:139` | what `IdeSessionHost` depends on — it never learns about VS Code |
| `HostDiagnosticRecorderOptions` | `:155` | `sink`, `now`, `credentials` |
| `startErrorKindForFailure` | `:213` | `HostFailureKind` → `StartErrorKind`, **explicit** for `invalid-setting` (F-3.1) |
| `hostFailureKindForStartError` | `:227` | the reverse map, returns `null` for kinds the Host owns itself |
| `createStartFailureListener` | `:257` | orchestrator-side listener: records what the Host could not classify (AC-22) |
| `HostDiagnosticRecorder` | `:283` | bounded store, seq/timestamp/phase bookkeeping, redaction on every string field |
| `formatHostDiagnosticRecord` | `:409` | the rendered block for the channel; technical fragments stay English |

Redaction goes through `redactSecrets` imported from `./redact.ts` — no second redactor was written (AC-21).

### 2.2 Modified product files

| File | Diff | Key lines |
|---|---|---|
| `apps/vscode-dsh/src/session-host.ts` | +146 | `StartStage` (`:109`), `StartFailureContext` (`:114`), `describeStartFailure` (`:134`) — including the `bridge-listen` branch (`:175`), `HostFailureDiagnostics` + constructor param (`:223`, `:269-270`), `setCredentials` before spawn (`:377`), stage assignment per awaited step (`:403-433`), `onStartSucceeded()` on success (`:440`), `record` + `startErrorKindForFailure` in `catch` (`:445-455`) |
| `apps/vscode-dsh/src/extension.ts` | +105 | `OutputChannelLike` (`:297`), `VsCodeLike.createOutputChannel` (`:169`), module state (`:355-357`), channel + recorder + sink + orchestrator listener (`:424-448`), `dsh.showHostDiagnostics` (`:537-539`), `dsh.test.getDiagnosticsText` inside `shouldRegisterTestHooks` (`:1106-1107`), disposal wiring (`:1229`, `:1279-1281`) |
| `packages/sdk/client/src/client.ts` | +62 | `TransportClosedDetails` (`:39-50`), `NO_TRANSPORT_DETAILS` (`:53`), `TransportClosedError.details` (`:68`, `:74`), captured state (`:225-231`), signal from the exit handler (`:290`), `closedError()` (`:502`), `transportDetails()` (`:506`) |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | +19 | `START_ERROR_KINDS` extended with `bridge-listen` / `spawn` / `handshake-timeout` (`:27-43`); the Host's own `kind` is passed through instead of being flattened |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | +38 | approval projection carries `toolName` + optional `reason` (AD-13) (`:91-92`), `listPending` delegates to `projectEntry` (`:195-227`) |
| `packages/sdk/client/src/index.ts` | +4 | exports `TransportClosedDetails` and `DEFAULT_INITIALIZE_TIMEOUT_MS` |
| `apps/vscode-dsh/package.json` | +4 | `contributes.commands += dsh.showHostDiagnostics` (`:143-145`) — the only `package.json` change (no new setting, no new dependency) |

### 2.3 Test files

| File | Diff | Cases |
|---|---|---|
| `apps/vscode-dsh/tests/host-diagnostics.spec.ts` | new (1011 lines) | 36 — contract, version policy, store, classification, UI terminal states, projection, pass-through, extension surfaces |
| `apps/vscode-dsh/tests/session-host.spec.ts` | +254 | 7 new cases in `describe('IdeSessionHost start-failure diagnostics (AC-14 – AC-20)')` |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | +48 | 2 new cases (vocabulary pass-through, retry re-entry) |
| `packages/sdk/client/tests/sdk-client.spec.ts` | +47 | 3 new cases for the structured transport details |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | +35 | knobs `FAKE_STDERR_LINES` (`:241`), `FAKE_EXIT_CODE` (`:249`), `FAKE_SELF_SIGNAL` (`:250`), `FAKE_PENDING_INIT` (`:279`) |
| `packages/sdk/client/tests/fake-runtime.ts` | +6 | knobs `FAKE_EXIT_CODE` (`:65`), `FAKE_SELF_SIGNAL` (`:66`) |

Every failure boundary is driven through a **real subprocess** (`child_process.spawn` of the fixture), not through a mocked `spawn` or a stubbed private method: the spawn failure of AC-14 uses a path that does not exist, AC-15/16 use a real handshake that never answers and a real `listen` that cannot bind, AC-17/18 let the child die for real.

## 3. The frozen 18-field contract (AD-14)

| # | Field | Type | Nullability / shape |
|--:|---|---|---|
| 1 | `schemaVersion` | `typeof HOST_DIAGNOSTIC_SCHEMA_VERSION` | never null; the literal `1` |
| 2 | `seq` | `number` | starts at 1, strictly increasing over the store's life |
| 3 | `time` | `number` | ms; monotonically non-decreasing |
| 4 | `phase` | `'start' \| 'retry'` | always one of the two |
| 5 | `retryOfSeq` | `number \| null` | `null` on the opener of a chain |
| 6 | `kind` | `HostFailureKind` | one of the 8 members |
| 7 | `resolvedExecutable` | `string \| null` | absolute **only** for the `process-exec-path` source (F-3.3) |
| 8 | `source` | `NodeExecutableSource \| null` | how the executable was chosen |
| 9 | `nodeVersion` | `string \| null` | set when the pre-flight ran |
| 10 | `expectedRange` | `string \| null` | the requirement the pre-flight checked |
| 11 | `missingApis` | `readonly string[]` | empty, never absent |
| 12 | `socketPath` | `string \| null` | bridge socket that could not be bound |
| 13 | `exitCode` | `number \| null` | `null` when the child was signalled |
| 14 | `terminationSignal` | `string \| null` | `null` when the child exited with a code |
| 15 | `handshakeTimeoutMs` | `number \| null` | the bound the handshake was given |
| 16 | `stderrTail` | `readonly string[]` | verbatim, oldest line first |
| 17 | `detail` | `string` | never empty |
| 18 | `hint` | `string` | never empty |

`detail` and `hint` are the only text-rendering fields; the channel renders them but the record stays structured, so the driver never parses a log line (AD-14).

**`schemaVersion` did not change in this phase and must not.** The 18-field list was frozen by the v7 contract-completeness requirement before implementation started, so the implemented shape is the v1 shape; no field was added, removed, retyped or re-nulled while implementing. A future change to the field list has to bump `HOST_DIAGNOSTIC_SCHEMA_VERSION` in the same commit — the contract test reads the constant, so bumping it alone turns that case red until the expected list is updated too.

The version policy is covered in both directions: `schemaVersion === 1` asserts the exact field set; a fabricated `schemaVersion: 2` record is accepted after only the v1 subset is checked (and the observed version is kept as evidence); `undefined` / `null` / `0` / `"1"` (non-integer) are treated as `HARNESS_ERROR`; an empty store returns `[]` with **no** version assertion at all.

## 4. AC-13 – AC-22 → test mapping

| AC | Implementation | Test case (file:line as measured now) |
|---|---|---|
| AC-13 | channel name constant `host-diagnostics.ts:23`; created once at `extension.ts:424-425`; reveal command `extension.ts:537-539`; test-only reader inside `shouldRegisterTestHooks` `extension.ts:1106-1107` | `host-diagnostics.spec.ts:832` AC-13(a) stable name · `:838` AC-13(b)(c) reveal shows, appends nothing · `:856` AC-13(d) hook exists and returns an array · `:862` AC-13(d) gate closed → not registered |
| AC-14 | SDK: `TransportClosedDetails` + `transportDetails()` (`client.ts:39-50`, `:506`). Host: `describeStartFailure` (`session-host.ts:134`) with stage context. Extension fallback: an unclassified `StartHostPort` failure is still recorded as `other` | `sdk-client.spec.ts:406` structured spawn-failure details (real `spawn` of a non-existent absolute path) · `session-host.spec.ts:234` AC-14 (kind `spawn`, `resolvedExecutable`, `detail !== ''`, `source !== null`) · `session-host.spec.ts:267` AC-14 兜底 (unclassified → `other`) · `host-diagnostics.spec.ts:921` AC-14 兜底 through the extension (record + redaction, no secret in the banner) |
| AC-15 | `initializeTimeoutMs` resolved against `DEFAULT_INITIALIZE_TIMEOUT_MS` and stored on the record | `session-host.spec.ts:285` — fixture never answers `initialize`; asserts `kind === 'handshake-timeout'` **and** `handshakeTimeoutMs === 300` (field assertion, no wording match) · `host-diagnostics.spec.ts:680` timeout class reaches the snapshot by name |
| AC-16 | `bridge-listen` branch of `describeStartFailure` (`session-host.ts:175`) records the chosen socket path | `session-host.spec.ts:302` — an existing regular file used as the socket path makes the real `listen` fail; asserts `kind === 'bridge-listen'`, absolute `socketPath`, non-empty `detail` · `host-diagnostics.spec.ts:680` class pass-through |
| AC-17 | `stderrTail` kept verbatim in order, bounded by the SDK's existing tail limit | `session-host.spec.ts:316` — 25 unique markers (`DSH-FAKE-STDERR-<n>`) then `exit(1)`; asserts length ≥ 20 **and** element-wise equality with source lines 6–25 in order (no summarising, no "last line only") |
| AC-18 | `exitSignal` captured from the `exit` handler (`client.ts:290`) and split from `exitCode` in `transportDetails()` | `sdk-client.spec.ts:424` exit code with `terminationSignal === null` · `sdk-client.spec.ts:439` signal with `exitCode === null` · `session-host.spec.ts:345` the record tells the two apart |
| AC-19 | `missing-credentials` kind + orchestrator snapshot + UI settings entry | `host-diagnostics.spec.ts:405` recorded once, with the snapshot message · `:539` `phase === 'failed'`, missing-credentials copy, `settingsDeepLinkAvailable === true`, message ≠ `正在连接到 Host…`, status-bar retry present · `:890` end-to-end through the extension |
| AC-20 | every failure class keeps its own terminal copy; a failed Host never falls back to the connecting copy | `session-host.spec.ts:375` a chain of distinct boundaries stays distinct (`kind` + `retryOfSeq`) · `host-diagnostics.spec.ts:517` no root cause is left showing the in-progress copy (root cause read **from `kind`**, not inferred from the copy) · `:568` failed never reverts to `connecting` |
| AC-21 | `redactSecrets` applied to every string field, the JSON form and the rendered block; credential bag registered before spawn | `host-diagnostics.spec.ts:261` value absent from `records()` / `JSON.stringify(records)` / sink text / rendered block, `[redacted:DSH_TEST_TOKEN]` present · `:302` same for `KEY` / `PASSWORD` / `SECRET` / `TOKEN`-named keys of any value shape · `:921` end-to-end (channel + panel banner) |
| AC-22 | orchestrator-side listener opens/extends a chain; `onStartSucceeded()` closes it; retry re-enters the same `StartHostPort` | `host-diagnostics.spec.ts:326` every retry is paired with the record that opened the chain (`phase: 'retry'`, `retryOfSeq`, strictly increasing `seq`) · `:966` retry re-enters the same start path, `hostCreateCount` increments, chain recovers to `started` · `auto-start-orchestrator.spec.ts:205` the retry entry point re-enters the same port |

Additional cases the phase owes regardless of a single AC: the contract case (`host-diagnostics.spec.ts:114`, exactly 18 fields with declared shapes), the no-facts boundary (`:147`, still the full non-empty shape), the version split (`:209-245`), the bounded store (`:345`), copy-on-read (`:358`), non-decreasing time under a stepping clock (`:366`), `F-3.1` explicit `invalid-setting` class (`:378`), one class per failure kind (`:394`), Host-owned kinds ignored by the orchestrator-side listener (`:450`), projection surface (`:586-635`), and `F-3.2` (`:1006`, a non-preflight failure carries no `diagnostic` payload).

## 5. Gate evidence (delta vs the phase baseline)

Baselines were taken by the orchestrator at 21:03–21:04; the first product edit in this run is `client.ts` at 21:48, `host-diagnostics.ts` at 21:59, the new spec at 22:22 — so the comparison is genuinely before/after.

| Gate | Baseline | After | Delta |
|---|---|---|---|
| `pnpm run typecheck` | green | **exit 0** (`/tmp/p2-after-typecheck.txt`) | green, no new error |
| `pnpm run test apps/vscode-dsh` | 4 files / 6 cases failed, 351 passed (358) | **identical failure set**, 396 passed (403) | **zero new failures**; +1 spec file (`host-diagnostics.spec.ts`), +45 passing cases |
| `pnpm run test packages/sdk/client` | 3 files, 84 passed | **3 files, 87 passed** | all green, +3 cases |
| `client.ts` per-file coverage | (gate) | **100%** — 188/188 statements, 113/113 branches, 44/44 functions, 161/161 lines, exit 0 (`/tmp/p2-after-coverage.txt`) | gate green |
| `pnpm run lint` | 890 distinct `(rule,file)` pairs | **890 pairs, identical set *and* identical per-pair counts** | **zero new findings** (`/tmp/p2-after-lint.txt` vs `/tmp/p2-baseline-lint.txt`) |
| `pnpm run test:docs` | 1 failed / 11 passed (`scripts/doc-standard.spec.ts`) | **1 failed / 11 passed, same case** | no new failure |

The `apps/vscode-dsh` failure set is byte-identical to the baseline — the same 6 cases in the same 4 files (`spike-t0a-replay-rebuild` ×4, `spike-t0b-continue-capability`, `panel-close-delete.e2e`, `verifier-phase1/layer-a-rtl`), whose root cause is `scripts/test-invariants.ts:188` and is unrelated to this phase. The lint comparison is occurrence-level, not just set-level, so a file that gained extra findings of an already-present rule would have shown up.

Verification commands (Node 24.3.0 prefixed on `PATH`):

```
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run typecheck
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test apps/vscode-dsh
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test packages/sdk/client
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm exec vitest run --coverage \
    --coverage.include=packages/sdk/client/src/client.ts packages/sdk/client
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run lint
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test:docs
```

The coverage command narrows `coverage.include` on purpose: the repo config instruments `packages/*/*/src/**/*.{ts,tsx}` at a per-file 100% threshold, so filtering only the spec files would report every untouched source file as 0% and drown the gate. This is recorded in `project-test` so the next agent does not rediscover it.

## 6. DEBT-008 — resolved in this phase

| Item | Before | After | Evidence |
|---|---|---|---|
| E-1 citation | two JSDoc sites cited `(AD-10)`, but `design.md:225` AD-9 is "provide the `dsh.nodeBin` setting + the three-level resolution chain" while `:243` AD-10 is the *documentation landing* decision | both cite `(AD-9)` | separate `grep -rn` sweeps of `apps/vscode-dsh/src/` for `AD-9` and for `AD-10` return only `extension.ts:233` ("Read this extension's settings (AD-9)") and `extension.ts:2245` ("Read the `dsh.nodeBin` Node executable setting (AD-9)") — both are AD-9, and `AD-10` has **zero** hits |
| E-2 source phrase | the source phrases ("Class of a failed `IdeSessionHost.start`" / "the vocabulary `IdeSessionHost.start` throws with") did not cover the member `invalid-setting`, which is thrown by `extension.ts`'s `readNodeBinSetting` in the `StartHostPort` layer | both phrases now cover the `StartHostPort` layer | `session-host.ts:54` and `auto-start-orchestrator.ts:40` both carry "or the `StartHostPort` wrapping it" |

Only JSDoc wording moved: no class, member, type or behaviour changed, and the existing behaviour cases stay green. The prompt's approximate line numbers (`:224`, `:2173`) had drifted after Phase 1; the actual sites were located by measurement. The registry entry moved from "活跃债务" to "已解决" with the verification text above; the active table now lists 2 entries (DEBT-004, DEBT-009) and the summary note was corrected accordingly.

## 7. F-3 landings (handed over from Phase 1 review round 3)

| Item | Landing |
|---|---|
| F-3.1 — `invalid-setting` must have an explicit branch | `hostFailureKindForStartError` (`host-diagnostics.ts:227`) and `startErrorKindForFailure` (`:213`) both name it explicitly instead of letting it fall through a default; asserted by `host-diagnostics.spec.ts:378` and `:394` (the latter checks every kind maps onto exactly one orchestrator class) |
| F-3.2 — narrow on `kind` before reading `.diagnostic` | the pre-existing invariant survives: `.diagnostic` exists exactly when `kind === 'node-environment'`. New code paths added in `session-host.ts` respect it, and `host-diagnostics.spec.ts:1006` asserts that a non-preflight failure carries no `diagnostic` payload at all |
| F-3.3 — `resolvedExecutable` is absolute only for `process-exec-path` | `launch.ts:132-139` returns a setting-sourced Node path verbatim, so nothing in the diagnostics assumes absoluteness. The record's field doc states the restriction (`host-diagnostics.ts:70`), and the assertion in `session-host.spec.ts:234` pins the value the Host actually resolved rather than re-absolutising it |

## 8. Deviations from `spec.md` / `repo-exploration.md`

Each item is a place where the implementation deliberately does something other than the literal instruction, or where the code base contradicted the exploration report.

**8.1 `apps/vscode-dsh/src/connection-ui.ts` needed no change** — the spec's file list assigns AC-19/AC-20 UI projection to this file. Measured, the projection already exists and already does what the ACs demand: `errorKind === 'missing-credentials'` drives `settingsDeepLinkAvailable` (`connection-ui.ts:140`), `phase = 'failed'` is the terminal state (`:128-129`), the message falls back to the Host's own `errorMessage` (`:152-154`), and the status bar always carries `command = 'dsh.statusBarAction'` (`:81`, `:188`). Editing it would have been a no-op rewrite, so the phase instead added the missing *evidence*: `host-diagnostics.spec.ts:517`, `:539`, `:568` drive the real `ConnectionUiController` (with a VS Code shim, not a stub of the controller). Impact: `spec.md` §primary_files only; no behaviour deviates from AC-19/AC-20.

**8.2 `packages/sdk/client/src/index.ts` is in the change set** — it exports `TransportClosedDetails` and `DEFAULT_INITIALIZE_TIMEOUT_MS`. The first is required so the SDK's structured error is usable by a consumer (AC-14's SDK layer); the second keeps AC-15's `handshakeTimeoutMs === 300` assertion tied to the product default instead of a literal copied into the Host. Impact: additive to `spec.md` §primary_files.

**8.3 Test fixtures gained knobs** — `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` and `packages/sdk/client/tests/fake-runtime.ts`. AC-15/17/18 ask for real process behaviour (never answering `initialize`, a long stderr tail, a specific exit code, self-signalling), and the fixtures are the only place that can express it. No production file was reshaped for testability, and no dependency was added. Impact: test-only surface beyond the spec's file list.

**8.4 `interaction-coordinator.ts` changed slightly more than "add two projection fields"** — the approval branch was extracted into a private `projectEntry` (`:195-227`) instead of an inline ternary chain. The two new fields are the functional part; the extraction keeps the projection readable and satisfies the repo's indentation rule. Public surface is unchanged (same return shape, `reason` still omitted when absent).

**8.5 Retry records are produced by the orchestrator-side listener, not by the UI** — AC-22(b) wants records "before and after" a retry, paired through `retryOfSeq`. The mechanism is `createStartFailureListener` (`host-diagnostics.ts:257`) plus the store's chain bookkeeping: the Host classifies what it can and the extension records what the orchestrator projected, with dedup so one failure is not recorded twice. `dsh.test.answerApproval` / `InteractionCoordinator.resolveApproval` were **not** added — they belong to Phase 3 (AD-12).

**8.6 AC-14 is evidenced twice, with a real spawn in both layers** — the SDK layer failure is produced by `createProcessHarnessClient({ command: '<absolute path that does not exist>' })`, so the real `child_process.spawn` fails and `TransportClosedError.details.spawnError` / `.executable` are asserted; the Host layer is driven by that same production error type through `IdeSessionHost`. Neither layer mocks the spawn.

**8.7 Extension-level fallback for an unclassified failure** — the spec asks AC-14's fallback to be complete: any throw during `IdeSessionHost.start()` must still produce a record. `IdeSessionHost` covers its own boundaries; for a failure thrown in the `StartHostPort` layer around it (entry resolution, `new HarnessClient()`), `createStartHostPort` takes `diagnostics.lastSeq()` before the attempt and, in `catch`, records a generic `other` record only when **both** hold: the error is not a `HostStartError` (that class is recorded by the Host boundary or by the orchestrator listener for `missing-credentials` / `invalid-setting`), and `lastSeq()` did not move (the Host recorded nothing). The dedup is what keeps one attempt from being reported as two records (AD-3, AC-22). Classification stays structural — `extension.ts` never matches on message text.

**8.8 `.cursor/skills/*` updates are not phase product** — this agent's contract requires updating `project-build` / `project-test` after successful build/test work, and both were updated. They sit in the tool tree, which the user ruled out of the phase's commit set (DEBT-009), so `git status` shows them but the phase's product change set (§2) does not include them. One finding worth the orchestrator's attention: the working-tree `project-build/SKILL.md` had been reset to a one-line skeleton at 20:57 (after Phase 1's window), dropping 56 lines that `HEAD` still contains. This agent restored those entries from `git show HEAD:` with per-entry status (`❌ 未验证（回补）`; the two claims that are now wrong are marked `⚠️ 已过期` with the reason — the "host git 2.25.1 needs the pnpm bypass" workaround, and "Node v20.16.0" as an environment fact). It did **not** invent replacements for anything it could not verify, and it left the missing knowledge as a visible warning in the skill rather than a silent gap. Raising this as a debt entry was left to the orchestrator on purpose, since it concerns the tool tree that was ruled out of scope.

## 9. Anti-stub and pre-completion self-check

| Check | Result |
|---|---|
| Empty shells / no-ops in new code | none — `grep -rn '@STUB'` over `apps/vscode-dsh/src`, `apps/vscode-dsh/tests`, `packages/sdk/client/src`, `packages/sdk/client/tests` returns nothing |
| Deceptive comments | none — no `TODO` / `FIXME` / "will be wired" / "placeholder" in the touched product files |
| `tech-debt-registry.md` | no new active entry needed: the phase adds no stub, and the one stub it inherited (DEBT-008) is resolved and moved to the closed table |
| Store → reader connectivity | the recorder's `records()` is read by `dsh.test.getDiagnosticsText` (`extension.ts:1107`) and by `createStartFailureListener`'s dedup check; the sink is read by the output channel (`extension.ts:432`); both are exercised end-to-end (`host-diagnostics.spec.ts:856` reader via the registered command, `:966` retry chain through the sink) |
| Caller → callee connectivity | `IdeSessionHost` depends on the `HostFailureRecorder` port, not on VS Code; the extension supplies the real recorder. Traced end-to-end: `start()` → `describeStartFailure` → `record` → sink → channel, plus `onChange` → listener → `record` → retry chain |
| Do the tests fail when the feature is off? | yes: the version case reads `HOST_DIAGNOSTIC_SCHEMA_VERSION` (bumping the constant turns it red), the AC-17 case fails if the tail is summarised or truncated, the AC-18 case fails if signal and exit code are not split, and the AC-22 case fails if retry records are not paired |
| Out-of-scope prohibitions | `resolveApproval` / `answerApproval` absent; `packages/core/agent-loop` untouched; `package.json` diff is commands-only (no dependency, no new configuration key); no new `StartOrchestratorState` / `ConnectionUiPhase` member; no review item codes in test names or comments; no sidecar / `workflow-context.md` file |

## 10. What this phase did not touch

`apps/vscode-dsh/src/connection-ui.ts`, `apps/vscode-dsh/src/node-env-guard.ts`, `apps/vscode-dsh/src/redact.ts`, `packages/sdk/client/src/launch.ts`, `packages/core/agent-loop/**`, `design.md`, `requirements.md`, `phase-plan.md`, `spec.md`, `repo-exploration.md`, and `current-status.json` (status transitions belong to the orchestrator). No git command beyond inspection was run: no add, commit, branch or stash, so the whole change set is still in the working tree for the orchestrator to commit at HG-3.
