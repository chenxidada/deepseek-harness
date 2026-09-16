# Connectivity Review — Phase 2 (`phase-2-host-fail-loud-diagnostics`)

## 视角

**Integration Connectivity** — do the pieces actually connect end-to-end? This report traces end-to-end data
paths, upstream/downstream connections and cross-module contracts only. It does not judge implementation
correctness (`reviewer-correctness`), design/architecture choices (`reviewer-design`) or appearance
(`reviewer-visual`).

**Round-3 scope: the four rewrites made to clear the repo's own `pre-commit` gate (`lefthook`, job
`lint (staged)`), plus the seven formatting lines that same hook's `--fix` pass had already applied.**

| # | Site (post-fix) | Rule cleared | Change |
|---|---|---|---|
| 1 | `apps/vscode-dsh/src/auto-start-orchestrator.ts:242-243` | `typescript(no-non-null-assertion)` | `const next = more.at(-1)` hoisted above the guard; guard becomes `next !== undefined && …` |
| 2 | `apps/vscode-dsh/src/interaction-coordinator.ts:357` | `typescript(no-non-null-assertion)` | `while (insertAt < …) { const current = this.queue[insertAt]! … }` → `for (const current of this.queue) { … }` |
| 3 | `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:52,56` | `eslint(prefer-const)` | forward-declared `let setConnected!` + `.bind(port)` deleted; `startImpl` calls `port.setConnected(true)` directly |
| 4 | `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:93,97` | `eslint(prefer-const)` | same as #3 |
| — | `extension.ts` ×3 `@stylistic(indent)`, `interaction-coordinator.ts` ×2 `@stylistic(arrow-parens)`, `auto-start-orchestrator.ts` ×2 `@stylistic(arrow-parens)` | `--fix` pass already in the tree | 7 formatting lines, preserved verbatim |

**Out of scope by instruction, and not re-litigated here:** the Phase 2 body (the diagnostic record surface,
`createStartFailureListener`, the `dsh.test.getDiagnosticsText` projection, the extension wiring, the
`invalid-setting` → `other` fallback) was reviewed and closed in round 2, and the residual post-handshake gap
(C-2) is settled as `DEBT-010`. Neither is reopened below.

## 判决：PASS

All four rewrites are connectivity-neutral. Every arm of the two rewritten guards is still reachable **and is
reached at runtime**, including the arm the hoist touches: the coalesced-retry recursion
(`next !== undefined && !isConnected() && generation === this.generation`) is exercised through the real
`AutoStartOrchestrator`, and the `retryOfSeq` pairing edge (AC-22) still produces paired records on both the
fall-through arm and the recursion arm. The `enqueue` scan's `insertAt` — the loop's only product, consumed by
the `splice` on the next line — is provably identical on **all 4 681** queue shapes I enumerated, including
`break`, all-`presented`, and empty queues. No suppression construct was used to clear the gate, no new
producer-less snapshot or dead branch was introduced, and Phase 3's read surface
(`dsh.test.getDiagnosticsText` → `HostDiagnosticRecord[]`) is untouched and still green through the registered
command.

---

## 4 处改写逐一裁定

| # | Connectivity question asked | Verdict | Basis |
|---|---|:--:|---|
| 1 | Does the hoist change the observable order of `this.notify()` and the `startInFlight` reset? Are all exits still reachable? | ✅ equivalent | `more.at(-1)` is a pure read of a fresh `splice(0)` array that no listener can reach; the `notify()` at `:241` and the two resets (`:244`, `:248`) keep their positions. Probe B: 24 guard inputs, **0 mismatches in both the outcome and the `isConnected()` call count** |
| 1 | Does the `generation !== this.generation` early exit (`:236-239`) interact with the new `next === undefined` arm so that retry records stop pairing? | ✅ no | The early exit is byte-identical and is taken before the tail; the `next === undefined` arm's fall-through body (`startInFlight = undefined; notify()`) is exactly what the old `more.length === 0` short-circuit body was. Probe C2: three failing attempts → **3 records, every retry paired to the opener's `seq`** |
| 2 | Is `insertAt`'s final value unchanged on every path (break / all-presented / empty)? | ✅ equivalent | Probe A: **4 681 queue shapes, 0 mismatches**, plus explicit `tail = length` checks for the all-`presented` and all-same-session-`pending` shapes. `for…of` over an array re-reads `length` per step and its `break`/`continue` map 1:1 onto the `while` form; the body never mutates `this.queue` (the `splice` is after the loop) |
| 3/#4 | Does deleting the forward declaration + `.bind(port)` break the mock's connect flip? | ✅ connected | `mockPort`'s `setConnected(v) { connected = v }` closes over the helper's local `connected` and never reads `this` (`tests/auto-start-orchestrator.spec.ts:21-26`), so `.bind(port)` was inert. `mockPort` only invokes `startImpl` inside `start()` (`:28-33`), i.e. after `const port` is initialised, so the self-reference is a deferred read and no TDZ is possible. Both rewritten cases pass **and** the coalescing case's `getStartState() === 'started'` assertion is only satisfiable if `setConnected(true)` really ran |
| — | Any suppression used (`eslint-disable` / `oxlint-disable` / `@ts-expect-error` / `@ts-ignore` / `as any`)? | ✅ none | `rg` over the three files for all five patterns → **no matches**; likewise no `!` non-null assertion remains (`\)!`, `\]!`, `!.`, `as any`, `as unknown as` → no matches) |

---

## 端到端路径追踪

Probe scripts are throwaway (`/tmp/p2r3-probe.mts`, deliberately **not** added to the repo test tree) and drive
the **real** production classes — `AutoStartOrchestrator` + `createStartFailureListener` +
`HostDiagnosticRecorder` — never a re-implementation of them.

### Path A — failing start with nothing queued → the `next === undefined` arm (the hoist's new arm)

```
Entry: orch.request('command-start')                     auto-start-orchestrator.ts:152
  → runStart('command-start')                            :205
    → :207 state = 'starting'  → :210 notify()           ✅  listener sees 'starting' (recorder guard re-arms)
    → :220 await this.port.start('command-start')        ✅  port throws {kind:'missing-credentials'}
    → :232-234 state = 'failed', errorKind/errorMessage  ✅
    → finally :236 generation unchanged → :240 more = pending.splice(0) === []   ✅
      → :241 notify()                                    ✅  listener records #1 (phase 'start')
      → :242 const next = more.at(-1) === undefined      ← the hoisted read
      → :243 next !== undefined is FALSE → short-circuit  ✅  isConnected() NOT called (same as the old form)
      → :248 startInFlight = undefined; :249 notify()     ✅  same snapshot → signature guard suppresses #2
Exit: 1 record {kind:'missing-credentials', phase:'start', retryOfSeq:null}   ✅
      notify sequence: starting -> failed -> failed
```

**判定**: ✅ connected. The empty-`more` arm reaches the tail and records exactly once, which is the state
AC-22's chain then builds on.

### Path B — coalesced second reason while the first attempt is in flight → the recursion arm

```
Entry: request('command-start') then, while in flight, request('command-send')
  → :160-164 state = 'pending-start', pending.push('command-send'), notify()   ✅
  → the in-flight attempt fails                                                    ✅
  → finally :240 more = pending.splice(0) === ['command-send']                    ✅
    → :241 notify() → listener records #1 (phase 'start')                          ✅
    → :242 next = 'command-send'  (=== more[more.length - 1])                      ✅
    → :243 next !== undefined ✅ && !isConnected() ✅ && generation unchanged ✅   → RECURSION
      → :244 startInFlight = undefined
      → :245 await this.runStart('command-send')                                    ✅ same entry point
        → :207 'starting' → :210 notify → listener re-arms                          ✅
        → the queued attempt fails → :241 notify → listener records #2 (phase 'retry') ✅
Exit: startCalls === ['command-start','command-send']; 2 records, recs[1].retryOfSeq === recs[0].seq
      notify sequence: starting -> pending-start -> failed -> starting -> failed -> failed   ✅
```

**判定**: ✅ connected — this is the arm fix #1 rewrote, and it is the same arm the documented Path 4 of the
round-2 report covers. My run observes the paired record and the reason the recursion carried.

### Path C — retry pairing through the real extension commands (AC-22)

```
Entry: the failed state an orchestrator-owned refusal produces
  → dsh.test.setCredentialPresence(false)  → dsh.test.requestStart('command-start')   ✅ real commands
    → orchestrator → listener → recorder → records() = 1 opener (phase 'start')       ✅
  → dsh.statusBarAction (the clickable retry entry)                                   ✅ real command
    → request('manual-retry') → runStart → same StartHostPort                          ✅ same path
    → listener records #2 (phase 'retry', retryOfSeq = opener.seq)                     ✅ paired
Exit: records() = 2, paired and strictly increasing                                    ✅
```

**判定**: ✅ connected. Runtime evidence from my own filtered runs of the phase's extension-level case
(`host-diagnostics.spec.ts:1117`, "AC-22: a retry after a pre-Host refusal adds a paired record") and of the
coalesced-listener case (`:616`, "re-arms on a queued retry"), both `1 passed`; the same chain also passes
end-to-end through my Path B probe on the production classes alone.

---

## 上下游连接检查

| Rewritten surface | Upstream (who calls it) | Link | Downstream (what it consumes) | Link |
|---|---|:--:|---|:--:|
| `runStart`'s `finally` tail (`auto-start-orchestrator.ts:240-249`) | `runStart` (`:205`), reached from `request` (`:168`), `onUnexpectedDisconnect` (`:187`), and recursively from `:245` | ✅ unchanged entry set | `this.notify()` (`:241`, `:249`) → extension `onChange` (`extension.ts:449-453`) → UI projection + `createStartFailureListener` | ✅ |
| `more.at(-1)` (`:242`) | the tail, unconditionally | ✅ | the recursion call at `:245` receives the last spliced reason | ✅ (probe B/C3) |
| `next !== undefined` (`:243`) | the tail | ✅ reachable both ways | short-circuits `isConnected()` exactly as `more.length > 0` did | ✅ (probe B call counts) |
| `enqueue`'s scan (`interaction-coordinator.ts:357-367`) | `enqueue` callers (`handleApproval` / `handleQuestions` paths) | ✅ unchanged | `this.queue.splice(insertAt, 0, entry)` (`:368`) then `pump` / `pickNext` / `listPending` | ✅ (probe A exhaustive) |
| `port.setConnected(true)` in the spec (`:56`, `:97`) | the `startImpl` override, invoked by `mockPort.start` | ✅ | `isConnected: () => connected` (`:26`) → the orchestrator's `:222` / `:243` reads | ✅ (tests green) |

## 跨模块契约验证

| Boundary | Caller expects | Callee provides | Match |
|---|---|---|:--:|
| tail → `runStart(next)` recursion | a `StartReason` | the last element of `pending: StartReason[]` | ✅ |
| tail → `notify()` stream | the same snapshot sequence as before | two emits (opener + settle) on the recursion path, two on the fall-through path | ✅ (probe B call counts; probe C notify sequences) |
| `enqueue` → `Array.prototype.splice` | a valid insertion index in `[0, queue.length]` | `insertAt` = leading run of `presented`, or same-session `pending`, else the break index; `length` when all match | ✅ (probe A) |
| `StartHostPort.setConnected` (test double) | flips the mock's `connected` the orchestrator reads | method shorthand closing over the helper local, no `this` use | ✅ |
| Phase 3 ← `dsh.test.getDiagnosticsText` | `HostDiagnosticRecord[]` with the frozen 18-field v1 shape | `() => hostDiagnostics?.records() ?? []` (`extension.ts:1107-1108`), untouched by this round | ✅ |

## 跨 Phase 依赖与 Phase 3 接入面

| Item | State | Note |
|---|---|---|
| Phase 3 reads `dsh.test.getDiagnosticsText` | ✅ unaffected | None of the four sites is in `host-diagnostics.ts`, none is on the read path, and the record shape/`schemaVersion` region is not among the rewritten lines. The read surface is verified **live**: the phase's own spec (44 cases, including AC-13(d) gate-open/gate-closed at `:1034` / `:1040` and the AC-22 command case at `:1117`) passes, and my Path B probe reads the same recorder instance the listener writes to |
| Phase 3's recorded warning (`DEBT-010`: an empty `getDiagnosticsText()` must not be read as "no failure occurred") | ✅ unchanged | The adjudicated post-handshake gap is untouched by this round; the `process-failed` snapshot synthesis (`auto-start-orchestrator.ts:225-229`) is not part of the rewrite |
| Phase 1's frozen `StartHostErrorKind` vocabulary | ✅ unchanged | The round-3 diff to `auto-start-orchestrator.ts` does not touch `START_ERROR_KINDS`, `startErrorKindOf`, or the `catch` block |
| Fix #2's file (`interaction-coordinator.ts`) is also the AD-13 projection surface | ✅ unchanged | `projectEntry` / `listPending` / the approval/`questions` entry shapes are not among the rewritten lines; the four interaction specs I ran are green |

---

## 关键发现

### 🔴 Must-Fix

None. No end-to-end path is broken by the four rewrites: the retry → record pairing edge and the coalesced
recursion are both reached and paired at runtime, and the `enqueue` scan is bit-identical on all enumerated
inputs.

### 🟡 Should-Fix

None **for this round's scope**. The two carried items from round 2 were adjudicated into the registry by the
orchestrator and are deliberately **not** re-raised here:

- round-2 S-1 (`HostDiagnosticRecorder.setSink()` has no caller) → registered as `DEBT-013` (`tech-debt-registry.md`), user ruled "承接为债、本 Phase 不改";
- round-2 S-2 (`DEBT-010`'s locator) → the active row now carries `session-host.ts:727-757` (`onTransportDeath`) **and** the second locator `auto-start-orchestrator.ts:225-229`.

### 🟢 Observations

- **G-1 — The hoist adds one pure read in a case where the old `&&` chain short-circuited.** In the old form,
  when `more.length > 0` and `isConnected()` was already `true`, the element read `more[more.length - 1]` was
  never evaluated; the new form evaluates `more.at(-1)` unconditionally. `more` is a fresh array produced by
  `pending.splice(0)` and is not reachable from any listener, and `Array.prototype.at` has no side effects
  (checked directly: `[].at(-1) === undefined`, `['x','y'].at(-1) === 'y'`), so no downstream value or
  ordering can change. Probe B's call-count column confirms the *observable* interaction is identical:
  `isConnected()` is called 0 times when `more` is empty and exactly 1 time otherwise, in both formulations.
- **G-2 — The only input on which the two guard forms can differ is type-illegal, and the new arm is the safer
  one.** If `pending` ever held an `undefined` element, the old form would have taken the retry arm and called
  `runStart(undefined)`; the new form falls through and starts nothing. This is unreachable as written:
  `pending` is private, written only by `request(reason: StartReason)` over a closed string union
  (`auto-start-orchestrator.ts:8-15`), so `more.at(-1) === undefined` ⟺ `more` is empty. Recorded so the
  "equivalence" above is not read as "identical on inputs the type system permits but semantics forbid".
- **G-3 — `enqueue`'s changed line has no branch-level test of its own.** The visible ordering contract is
  pinned by `phase2-multitab-history-replay.spec.ts:143-152` ("Soft priority: active pending inserts ahead of
  waiting (not interrupting presented)"), which is Probe A's *tail-equals-length* class. The `break`-early and
  empty-queue shapes are covered only by my exhaustive differential run — the same evidence class the repo's
  own test skill prescribes for `no existing case covers that logic` rewrites. Not a finding; recorded so a
  future reader knows which half is test-pinned.
- **G-4 — The retry-record listener's silence on four classes is by design, not a new producer gap.** My probe
  initially asserted a record for a `bridge-listen` snapshot and got zero — which is exactly what
  `hostFailureKindForStartError` (`host-diagnostics.ts:245-259`) prescribes: only `missing-credentials` is
  recorded here, because the Host writes its own record for `node-environment` / `bridge-listen` / `spawn` /
  `handshake-timeout` and the extension's `other` fallback covers `invalid-setting`. The set of `errorKind`
  values the orchestrator can project is unchanged by the rewrite (`startErrorKindOf` and the `catch` are
  byte-identical), so **no new producer-less snapshot and no new dead branch** was introduced by these four
  edits. I searched for both deliberately (the question was asked).
- **G-5 — The 7 formatting lines are off-chain.** The three `@stylistic(indent)` lines in `extension.ts` form
  the file's **only** whitespace-only hunk (3 `-` / 3 `+`, identical after stripping whitespace), inside
  `runAskAboutSelection`'s `asRelativePath` arrow — a site no Phase 2 or Phase 3 chain touches. The four
  `@stylistic(arrow-parens)` lines are parenthesization of a single arrow parameter
  (`new Promise(resolve => …)` → `new Promise((resolve) => …)`, `interaction-coordinator.ts:263` and `:440`):
  the parameter name and the body are unchanged, so no call target, argument, or default value moves.

---

## 已执行的验证动作

Everything below was read from redirected output files or from the command's own exit status, not from the
implementer's report.

| Action | Command | Result |
|---|---|---|
| The commit gate these rewrites exist for | `node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern <3 files>` | ✅ `EXIT=0`, output **empty (0 lines)** |
| Full package regression | `pnpm run test apps/vscode-dsh` | ✅ `Test Files 4 failed \| 47 passed (51)`, `Tests 6 failed \| 404 passed \| 1 skipped (411)` — failure set is the documented constant baseline, name for name: `spike-t0a-replay-rebuild` ×4, `spike-t0b-continue-capability`, `panel-close-delete.e2e`, `verifier-phase1/layer-a-rtl` |
| Phase integration surfaces | `pnpm run test apps/vscode-dsh/tests/{host-diagnostics,auto-start-orchestrator,interaction-fail-closed.integration,gap-005-009-debt-fix}` | ✅ 4 files / **66 passed**, exit 0 |
| Enqueue-adjacent interaction surfaces | `pnpm run test apps/vscode-dsh/tests/{phase2-multitab-history-replay,interaction-fail-closed.e2e,panel-l2-l3-protocol}` | ✅ 3 files / **16 passed**, exit 0 |
| Named end-to-end cases (AC-22 pairing, coalesced retry, retry re-entry, coalescing, HG-2 late settle) | `pnpm exec vitest run <spec> -t "<name>"` ×5 | ✅ each `1 passed` (43 / 10 skipped respectively) |
| Differential equivalence of fix #2 | `/tmp/p2r3-probe.mts` Probe A | ✅ `4681 queue shapes, 0 mismatches`; all-`presented` and all-same-`pending` tails = `queue.length` |
| Differential equivalence of fix #1 + reachability of all outcomes | same file, Probe B | ✅ `24 guard inputs, 0 mismatches; reached=fallthrough/isConnected-calls=0, fallthrough/isConnected-calls=1, retry/isConnected-calls=1` |
| Real-class end-to-end FSM (fall-through arm, retry pairing, coalesced recursion, success-suppresses-recursion, re-entrant `onUserStop`) | same file, Probe C1–C5 | ✅ `PROBE: ALL CHECKS PASSED` (exit 0). C1 `1 record, phase 'start', retryOfSeq null`; C2 `3 records, all retryOfSeq = opener`; C2b success adds no record; C3 `startCalls ['command-start','command-send']`, 2 paired records; C4 coalesced-on-success → 1 start; C5 `startCalls ['command-start']`, state `idle` |
| Reachability of the `generation === this.generation` conjunct after the hoist | Probe C5 (a listener calls `onUserStop()` from inside the `notify()` at `:241`, with `more` non-empty and the port disconnected) | ✅ the arm is taken and suppresses the retry → the conjunct is **not** a dead condition, and the hoist did not weaken stale-generation protection |
| Suppression constructs | `rg 'eslint-disable\|oxlint-disable\|ts-expect-error\|ts-ignore\|as any\|as unknown as\|\)!\|\]!' <3 files>` | ✅ no matches |
| `Array.prototype.at` semantics assumed by the hoist | `node -e '…'` on `[]` and `['x','y']` | ✅ `{empty:true, last:"y"}` |
| The 7 formatting lines | hunk classification of `git diff HEAD -- <file>` + reading the whitespace-only hunk | ✅ `extension.ts`: 1 whitespace-only hunk of exactly 3 lines (off-chain); `interaction-coordinator.ts`: the 2 `arrow-parens` sites are single-parameter parenthesization |

**Limitation stated honestly.** `/tmp/p2-baseline-vscode-dsh.txt` no longer exists (the baseline file was not
present in `/tmp` at review time), so the 6-case failure set above was compared against the invariant recorded
in `.cursor/skills/project-test/SKILL.md` (the four files and six case names) and against `implementation.md`
§11.4 — both list exactly the set I measured. I did not re-run the whole-repo lint comparison from §11.6; the
staged profile, which is the gate these rewrites exist for, is green and empty.

---

## 范围声明

This report covers **connectivity only**, within the round-3 scope of the four `lint (staged)` rewrites and
the seven `--fix` formatting lines. Behavioural correctness of the rewrites beyond equivalence, the soundness
of the chosen formulations, and the round-2 body (diagnostic record surface, listener, projection, extension
wiring) belong to the other three reviewer perspectives and to the already-merged round-2 reports; the
post-handshake gap is settled as `DEBT-010` and is not reopened.
