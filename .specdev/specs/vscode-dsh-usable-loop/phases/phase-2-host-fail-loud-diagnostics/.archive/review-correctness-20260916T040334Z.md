# Correctness Review — Phase 2 (round 2, post-rework re-review)

Workflow: `vscode-dsh-usable-loop`
Phase: `phase-2-host-fail-loud-diagnostics`
Branch: `impl-phase-2-host-fail-loud-diagnostics`
Reviewer: `reviewer-correctness` (implementation correctness only)

## 视角

**Implementation Correctness** — does the code actually work?

Scope: the round-1 fix set (2 blocking items + 12 SHOULD-FIX + 1 adjudicated severity ruling) re-verified against the current working tree, plus a fresh AC-13 – AC-22 pass over the function bodies. Not re-derived from `implementation.md`.

Startup self-cleanup: **no predecessor existed in the direct path** — round-1's `review-correctness.md` / `review-correctness-zh.md` had already been moved to `.archive/` (`review-correctness-20260915T163340Z.md`, `-zh`). Nothing was archived by this run, and nothing outside this phase's two own output files was touched.

## 判决：SHOULD-FIX

Basis for this verdict, stated plainly so the severity is not read as "the rework failed":

- **Both round-1 blocking items are resolved and independently confirmed** — `MF-1` (vocabulary narrowed to the frozen 7) and `C-1` (retry records now produced on every failure state, including pre-Host refusals). Confirmed by code reading *and* by two mutations I applied and reverted (see §4.6–§4.7): each fix is load-bearing, and each fix's test goes red when the fix is removed.
- **12 / 12 SHOULD-FIX items are resolved** — verified one by one in §1.
- **The adjudicated C-2 reading is honored** — pre-handshake evidence (including the `exitCode === 0` instance), the decision written into `implementation.md` §8.12, and the residual gap registered as `DEBT-010`.
- **Zero new failures** anywhere: test failure set byte-identical to the phase baseline, typecheck green, no new lint rule instance.
- The verdict is **not** PASS because two non-behavioral, documentation-fidelity findings remain open (§5, 🟡-1 and 🟡-2). This phase's own round-1 precedent treats documentation fidelity (SF-4, SF-6, SF-7, SF-8) as SHOULD-FIX-worthy, so downgrading these to "observations" here would be inconsistent with the standard already applied to this phase. Neither finding blocks: the code works, every AC holds, and no stub is unregistered.

## 1. Round-1 fix set — independent re-verification

### 1.1 Blocking items

| # | Item | Verdict | Independent evidence |
|---|------|:--:|------|
| MF-1 | `kind` vocabulary narrowed back to the frozen 7 members | ✅ Resolved | `HostFailureKind` is exactly 7 members (`host-diagnostics.ts:44-51`). All three `Record<HostFailureKind, …>` tables have 7 keys each and no extra: `FAILURE_DETAILS` (`:182-190`), `FAILURE_HINTS` (`:193-201`), `START_ERROR_KIND_BY_FAILURE` (`:209-217`). `invalid-setting` appears **only** in JSDoc (`:40`, `:235-240`, `:55-58` of `session-host.ts`, `:43` of `auto-start-orchestrator.ts`), in the one explicit `case 'invalid-setting': return null` (`:249-250`), and in tests. `design.md` / `design-zh.md` are **unchanged** (`git status -s` reports neither). The contract case takes its expectation from an independent literal table transcribed from the design list (`host-diagnostics.spec.ts:45-91`, note `:60-63` on why `invalid-setting` is absent) and compares it against the *produced* record's key set (`:136`), not against the implementation's types; the reverse assertion is explicit (`:439-450`, `expect(kind?.enum).not.toContain('invalid-setting')`) and the null case is asserted directly (`:458`). |
| C-1 | Retry after a pre-Host refusal must produce a paired record | ✅ Resolved | The guard re-arms on **any** transition leaving `failed` (`host-diagnostics.ts:283-286`: `if (snapshot.state !== 'failed') { recorded = undefined; return }`). Both directions verified: (a) retry pairing asserted through the real extension wiring at `host-diagnostics.spec.ts:1117-1142` (`phase === 'retry'`, `retryOfSeq === paired[0].seq`, `seq` strictly increasing) and at `:597` / `:616`; (b) within one attempt the orchestrator notifies twice with the *same* snapshot (`auto-start-orchestrator.ts:241` and `:249` — the reason write and the `finally` write), and the signature guard (`host-diagnostics.ts:289-292`) suppresses the duplicate, so one attempt is one record. I re-ran this discrimination myself under mutation (§4.6): reverting the guard to round-0's `state === 'started'` semantics turns exactly 3 cases red while the attempt-internal dedup case stays green. |

### 1.2 The 12 SHOULD-FIX items

| # | Round-1 item | Verdict | Evidence |
|---|---|:--:|---|
| SF-1 / SF-2 | contract completeness must be a **single** case | ✅ | One `it` asserts (a) field set, (b) per-field shape, (c) version source, (d) absence of a text-render field: `host-diagnostics.spec.ts:122-160` |
| SF-3 | `F-3.x` review item codes must be gone from test names/comments | ✅ | `grep -rnE '\((S[0-9]+\|M[0-9]+\|C-[0-9]+)\|F-3\|SF-[0-9]' apps/vscode-dsh/tests packages/sdk/client/tests` → zero hits; `AD-*` retained (18 occurrences in `host-diagnostics.spec.ts`) |
| SF-4 / SF-5 | `resolvedExecutable` absoluteness must be **documented** + both directions pinned | ✅ | The restriction is written on the record field (`host-diagnostics.ts:75-80`) and mirrored on the input (`:114-118`); both directions asserted (`host-diagnostics.spec.ts:284` for `process-exec-path`, `:300` for a caller-supplied setting passed through verbatim) |
| SF-6 | registration JSDoc must say it returns records, never text (AD-14 decision 2 / `spec.md:70`) | ✅ | `extension.ts:1100-1105` states the name is historical and "this returns the `HostDiagnosticRecord[]` array and never text" |
| SF-7 | SDK `termination signal:` prefix beyond the frozen prefix set must be recorded in §8 | ✅ | `implementation.md` §8.11, with the added reason (the old guard printed `exit code: null` for a signalled child) and the cost |
| SF-8 | §8.1 premise must be rewritten to the real one | ✅ | `implementation.md:202` replaces the round-0 claim with the checked fact (file list never included `connection-ui.ts`; the projection already existed) |
| SF-9 | "fewer than 20 stderr lines → record the lines that exist" must be asserted | ✅ | `session-host.spec.ts:362`: `expect(codeRecord.stderrTail).toEqual(['DSH-FAKE-STDERR-1'])` — no padding to the AC-17 floor (`spec.md:51` requires `>= 20` only for a 25-line tail, asserted at `:320-343`) |
| SF-10 | AC-18's `exitCode === 0` instance must be reachable | ✅ | Fixture now passes the knob through verbatim, `0` included (`tests/fixtures/fake-sdk-runtime.mjs:249-259`); the instance is asserted (`session-host.spec.ts:366-378`, `exitCode: 0, terminationSignal: null`) |
| SF-11 | post-handshake deaths produce no record — the trade-off must be left on the record | ✅ | `implementation.md` §8.12 (ruling + cost + why a `phase` member addition would force a `schemaVersion` bump), plus `DEBT-010` in the registry (`tech-debt-registry.md:28`) |
| SF-12 | queued/coalesced retry path must be inside AC-22's verification surface | ✅ | `host-diagnostics.spec.ts:616` covers it — and it is discriminating: under mutation it goes red (§4.6) |

### 1.3 Adjudicated C-2 (`spec.md:61`, post-handshake exit)

The scheduler's ruling (`review.md` "严重度裁定": evidence window = pre-handshake, `implementation.md` §8.12 + `DEBT-010`) is implemented as ruled: the `child-exited` classification does not depend on the exit code's truthiness (`session-host.ts:157` keys off `details.spawnError === undefined`), and the `exitCode === 0` instance is now reachable and asserted. `DEBT-010` is registered 🟡 non-blocking with a stated Phase-3 trigger ("a smoke run that reads an empty `getDiagnosticsText()` must not read it as 'no failure occurred'"), which is the correct handling for a gap that is a design decision rather than a coding error. Acknowledgement recorded 🟢-2 below.

### 1.4 O-5 (`setSink` callers) — carried over unchanged

`HostDiagnosticRecorder.setSink()` (`host-diagnostics.ts:333-335`) still has **zero callers** repo-wide (`grep -rn setSink` → only its own definition and the generated `lib/types/host-diagnostics.d.ts` declaration). Round-1 classified this as **O-5, a non-blocking observation** (not one of the 12 SFs), so the implementer owed no fix here and none was made. It is not a stub (it is fully implemented and functionally correct); the sink is supplied through the constructor option, which is what the product uses (`extension.ts:429-433`). Recorded again as 🟢-1 with a concrete disposition recommendation.

## 2. AC-13 – AC-22 verification

| AC | Requirement (abridged) | Implementation | Verdict | Evidence |
|----|------|------|:--:|------|
| AC-13 | Output Channel named/created once, revealable, records retained | `host-diagnostics.ts:23` (name), `:26` (limit 200), `:374-376` (trim) ; `extension.ts:424-426` (single `createOutputChannel`), `:537-540` (reveal command), `:1280-1282` (disposed with the window); `package.json:143-145` | ✅ | Renderer emits every field verbatim (`host-diagnostics.ts:430-452`); tests assert one channel, the reveal command, and the registered hook: `host-diagnostics.spec.ts:1010`, `:1016`, `:1034`, `:1040` |
| AC-14 | Every start failure reachable; classification never from text | `session-host.ts:134-179` (`describeStartFailure`, message read only as `detail` at `:135`), `:441-460` (catch → `record`); SDK side `client.ts:496-514`; extension fallback `extension.ts:2332`, `:2367-2372` | ✅ | Real spawn failure in both layers (`sdk-client.spec.ts:406`), bare-non-Error fallback (`session-host.spec.ts:267`), `other` bucket (`:178`), extension fallback exactly once (`host-diagnostics.spec.ts:1099-1115`) |
| AC-15 | Handshake exceeding its bound recorded with the bound | `session-host.ts:166-174`; bound from the product default at `:384` (`DEFAULT_INITIALIZE_TIMEOUT_MS`) | ✅ | `session-host.spec.ts:285-300` (300 ms asserted, never a literal in the Host), `host-diagnostics.spec.ts:858` |
| AC-16 | Bridge-listen failure recorded | `session-host.ts:175-177` + stage assigned by the throwing step (`:413-414`) | ✅ | `session-host.spec.ts:302-315` |
| AC-17 | ≥ last 20 lines of stderr, verbatim, no summarising | `session-host.ts:162` passes `details.stderrTail` through; SDK retains 400 lines (`client.ts:29`, `:481-487`); record copies line by line (`host-diagnostics.ts:368`) | ✅ | 25-line tail asserted line-by-line against the source (`session-host.spec.ts:316-343`); short tail not padded (`:362`) |
| AC-18 | Exit code recorded; signal recorded when no code | `client.ts:288-291` (`code`/`signal` captured without a truthiness test), `:499-500` (code branch before signal branch, so `0` still prints as a code), `:506-514` (structured details); `session-host.ts:157-161` | ✅ | `exitCode: 7`, `exitCode: 0`, and `terminationSignal: 'SIGTERM'` with `exitCode: null`: `session-host.spec.ts:345-393`; SDK layer `sdk-client.spec.ts:424`, `:439` |
| AC-19 | Missing credentials → failure state + settings entry + no in-progress copy | Listener records it (`host-diagnostics.ts:247-248`, `:278-295`); UI projection already existed and is consumed unchanged (`connection-ui.ts:140`, `:128-129`, `:152-154`) | ✅ | Record + snapshot + four UI assertions: `host-diagnostics.spec.ts:484`, `:695`, `:1068` |
| AC-20 | Failure must not leave the in-progress copy; root cause from `kind`, never from text | `describeStartFailure` distinguishes `child-exited` vs `spawn` structurally (`session-host.ts:157`) and never matches message text | ✅ | Full classification sweep `host-diagnostics.spec.ts:746`; distinct boundaries on one chain `:695`; `session-host.spec.ts:395` |
| AC-21 | All text redacted before it reaches the channel or the UI | Every string field goes through `redact` (`host-diagnostics.ts:410-412`, applied at `:359-370`); credentials registered **before** spawn (`session-host.ts:377`) | ✅ | Env value + credentials bag + JSON serialisation + rendered text all asserted secret-free: `host-diagnostics.spec.ts:320`, `:361`, `:1144-1180` |
| AC-22 | Clickable retry, same path, records appended before/after | Listener `host-diagnostics.ts:278-295`; chain bookkeeping `:341-343`, `:356-357`, `:372`; retry entry `extension.ts:2367-2372` path re-entered via `auto-start-orchestrator.ts:205-249` | ✅ | Entry clickable: `host-diagnostics.spec.ts:1068`; path reuse with call count: `auto-start-orchestrator.spec.ts:205-224`; paired records: `host-diagnostics.spec.ts:1117-1142`; sink-side chain: `:1189-1230` |
| AD-13 projection | `toolName` + non-empty `reason` projected, no extra fields | `interaction-coordinator.ts:208-229` (two branches, `reason` omitted when absent) | ✅ | Exact key-set assertions with and without `reason`: `host-diagnostics.spec.ts:779-809` |

Contract integrity (`spec.md:63`): 18 fields, always present, `null`/`[]` rather than absent — asserted against the design-derived table, including field-set equality (`host-diagnostics.spec.ts:122-160`). Version policy (`> 1` tolerated, `< 1`/missing/non-integer rejected, `[]` legal): `:226-266`.

## 3. Stub Detection

Against `tech-debt-registry.md`.

### Registered debt (not re-reported)

| Registry ID | File:function | Status | Note |
|---|---|:--:|---|
| DEBT-004 | `packages/specdev/specdev-presets/src/tool-policy.ts:21-27`, `:30` | ⚠️ Known 🟡 | Out of this phase's scope by user ruling; not a Phase-2 artifact |
| DEBT-009 | `phases/phase-1-node-env-preflight/implementation.md` §2.3 | ⚠️ Known 🟡 | Documentation classification debt carried from Phase 1 |
| DEBT-010 | `host-diagnostics.ts:260-294` + `session-host.ts` fail-loud exits | ⚠️ Known 🟡 | Post-handshake runtime disconnect produces no record — deliberately out of this phase's AC surface (§8.12). Correctly registered, so **not** re-reported as new |
| DEBT-008 | — | ✅ Resolved | Moved to the resolved table; both edits landed (`extension.ts:233`, `:2245` reference AD-9; `session-host.ts:54` / `auto-start-orchestrator.ts:40` extend the provenance sentence to `StartHostPort`) |

Active table contains exactly `DEBT-004` / `DEBT-009` / `DEBT-010` (`tech-debt-registry.md:26-28`), all 🟡 — described consistently at `:34`.

### New unregistered stubs

**None.** `grep -rn '@STUB' apps/vscode-dsh/src apps/vscode-dsh/tests packages/sdk/client/src packages/sdk/client/tests` → zero hits; no `TODO` / `FIXME` / "placeholder" / "will be wired" in the touched product files. No function body in the change set is a shell: every branch I traced computes a real value (classification, redaction, chain bookkeeping, projection).

## 4. Independent re-run evidence (with deltas)

Environment: Node `24.3.0` (`PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`). Phase baseline artifacts reused from `/tmp/p2-baseline-*.txt`.

| Gate | Command (abridged) | Result | Delta vs baseline |
|---|---|---|---|
| Typecheck | `pnpm run typecheck` | exit **0**, `error TS` count **0** (`/tmp/rc2-typecheck.txt`) | green → green |
| `apps/vscode-dsh` suite | `pnpm run test apps/vscode-dsh` | **6 failed / 404 passed / 1 skipped (411)** (`/tmp/rc2-vscode-dsh.txt`) | **Zero new failures**: `diff /tmp/rc2-fails-base.txt /tmp/rc2-fails-cur.txt` shows only per-test timing differences (16→21 ms, 2→4 ms, 115→114 ms, 24→37 ms); same 6 names, same 4 files, all Phase-1/spike/e2e areas. Passed count `351 → 404` = the phase's own added cases |
| `packages/sdk/client` suite | `pnpm run test packages/sdk/client` | **87 / 87 passed**, exit 0 (`/tmp/rc2-sdkclient.txt`) | baseline 84 → +3, all green |
| `client.ts` per-file coverage | `pnpm exec vitest run --coverage --coverage.include=src/client.ts packages/sdk/client` | exit 0 — **Stmts 188/188, Branch 113/113, Funcs 44/44, Lines 161/161 (100%)** (`/tmp/rc2-cov-client.txt`) | identical to the round-1 figure: the new signal/`exitCode === 0` branches are genuinely executed, not merely present |
| Phase-2 targeted specs | `pnpm exec vitest run host-diagnostics.spec.ts session-host.spec.ts auto-start-orchestrator.spec.ts sdk-client.spec.ts` | **113 / 113 passed**, exit 0 (`/tmp/rc2-targeted-r3.txt`) | 4 files green after the mutation restores below |
| Lint gate | `pnpm run lint` | exit 1 — repo-wide red, as at baseline (`/tmp/rc2-lint-full.txt`) | **Zero new rule instances.** Normalising away line/column (`sed`), the error multiset is identical: **10381 lines both sides, `diff` = IDENTICAL**. The raw-line diff is entirely line-number shifts inside the edited files (extension.ts +77, session-host.ts +130, interaction-coordinator.ts +30, auto-start-orchestrator.ts +7), with no rule firing that did not already fire at baseline. `host-diagnostics.spec.ts` (new file) contributes 0 diagnostics |
| Whole-repo `pnpm run test:coverage` | — | Not used as a gate | Known permanently red on this host; per instruction, per-file coverage was used instead |

### 4.6 Mutation A — is `C-1`'s fix load-bearing?

Procedure: backed up `host-diagnostics.ts` (+ sha1), replaced the re-arm branch with round-0 semantics (`if (snapshot.state === 'started') recorded = undefined; if (snapshot.state !== 'failed') return`), ran the suite, then restored by reversing the exact edit; restore verified by `diff` + sha1 (`37be2046…` matched).

Result (`/tmp/rc2-mutA.txt`): **3 failed / 41 passed (44)**, exit 1 — red on

1. `records a retry of a pre-Host refusal as the next link of the chain` (SF-12/C-1 pairing)
2. `re-arms on a queued retry, so a coalesced second reason also gets a record` (SF-12's queued-retry gap)
3. `AC-22: a retry after a pre-Host refusal adds a paired record` (end-to-end through the real extension)

while the attempt-internal dedup case stayed **green** — exactly the discrimination C-1 needs. This independently confirms (a) the guard change is what makes the retry pair appear, and (b) the three cases are not vacuous.

Note: `implementation.md` §9 records this mutation as producing **2** failures. My measurement is **3**. The discrepancy understates the implementer's own evidence (the third case is the end-to-end one); recorded as 🟡-2, not as a defect in the code.

### 4.7 Mutation B — is `A′`'s fix load-bearing?

Procedure: same backup/restore discipline on `extension.ts`; re-inserted the removed heuristic into the fallback condition (`… && !(error instanceof HostStartError) && …`), ran the suite, reversed the edit, verified byte-identical restore (sha1 `2aed2b6b…` matched).

Result (`/tmp/rc2-mutB.txt`): **1 failed / 43 passed (44)**, exit 1 — red on exactly `AC-14 兜底: a pre-Host setting refusal is recorded once, as 'other'`, and nothing else. So the `lastSeq()` signal alone is what carries coverage for a failure no Host boundary owns, and re-introducing the heuristic re-opens the coverage hole that `A′` closed.

### 4.8 Tree state after mutation testing

Both files were restored byte-identically (sha1 verified against the pre-mutation backups) and the full targeted set re-ran green (**113 / 113**, `/tmp/rc2-targeted-r3.txt`). No git command other than read-only inspection was run; `current-status.json` was not touched.

## 5. Key findings

### 🔴 Must-Fix

**None.** Both round-1 blocking items are resolved and independently confirmed; no AC is unmet; no unregistered stub exists.

### 🟡 Should-Fix

- **🟡-1 `DEBT-010`'s provenance cites the wrong sections.** `tech-debt-registry.md:28` ends with "…本 Phase 内已按握手前读法取证并显式留痕（`implementation.md` §8.9/§8.10）". The ruling and the留痕 live in **§8.12**; §8.9 is the vocabulary narrowing and §8.10 the fallback signal. A reader following the citation lands on the wrong deviation. One-line fix: `§8.9/§8.10` → `§8.12`. (Owner is the scheduler, who drafted the registry entry — but it is part of this phase's evidence chain, so it is reported here rather than silently ignored.)
- **🟡-2 `implementation.md` §9 self-check repeats two inaccuracies.** (a) The mutation that restores round-0's listener guard is recorded as "**2 failures**"; measured 3 (§4.6) — the understatement hides one end-to-end case. (b) The store→reader row credits `createStartFailureListener` with reading `records()` for its dedup; the listener never calls `records()`, it compares signatures from the snapshot (`host-diagnostics.ts:289-292`), and the store's `lastSeq()` (`:393-395`) is what the *extension* fallback reads. Both are wording fixes in a self-report table; the underlying behaviour is correct.

### 🟢 Observations

- **🟢-1 `setSink` is still dead public API** (round-1 O-5, unchanged). `host-diagnostics.ts:333-335` has no caller in the whole repo and no test; the sink is injected through the constructor option (`extension.ts:429-433`). It is not a stub — it works — so this is not a correctness defect and, consistent with round-1's classification, not a should-fix. Recommendation for a later cleanup pass: delete it (the constructor option is the product path) or state its owner in the JSDoc. Leaving an untested public mutator with no consumer invites a future caller to re-point the channel silently.
- **🟢-2 `DEBT-010`'s residual gap is correctly scoped, and I confirm the trade-off is real, not a convenience.** Wiring post-handshake deaths would require a third `phase` member, which AD-14 decision 11 forces a `schemaVersion` bump for, which would break Phase 3's `=== 1` exact-field assertion. Registering the gap with a stated Phase-3 trigger is the right call; the only risk is a Phase-3 smoke run misreading an empty record array, which the registry entry names explicitly.
- **🟢-3 the vocabulary case at `host-diagnostics.spec.ts:437-451` compares the design literal against itself.** It is tautological as written — it can only fail if someone edits the literal. The real binding to the implementation comes from three other places: the produced record's key set (`:136`), the explicit `invalid-setting → null` assertion (`:458`), and the compile-time totality of `Record<HostFailureKind, StartErrorKind>` (`host-diagnostics.ts:209`), which makes a new or removed member a type error. So the contract *is* enforced; if a runtime vocabulary list is ever exported, `:437` should compare against that instead of against its own literal.
- **🟢-4 redaction is applied at the store boundary, not at the render boundary**, and `stderrTail` is copied line by line through `redact` before storage (`host-diagnostics.ts:368`) — so a credential value that appears only inside a stderr line cannot reach the channel via the rendered path either. This is the correct direction (fail-safe by construction rather than by call-site discipline) and is why AC-21's four-surface assertion is meaningful.

## 6. Notes on method and limits

- I re-read every function body in the change set rather than trusting `implementation.md`; the AC table cites the line that decides each verdict.
- I ran two mutations of the reviewed tree and reverted them, because "the test passes" is not evidence that the fix is what makes it pass. Both restores were verified by `diff` and sha1; the tree was re-run green afterwards. This is the only write I performed, and it left no trace in the working tree.
- What I did **not** verify: whether the *text* of `DEBT-010`'s gap assessment (cost of a `schemaVersion` bump breaking Phase 3) matches Phase 3's actual spec — that belongs to Phase 3's own review. I also did not re-derive Phase 1's `invalid-setting` path beyond confirming it is untouched and still asserted (`node-env-guard.spec.ts:729-744`).
