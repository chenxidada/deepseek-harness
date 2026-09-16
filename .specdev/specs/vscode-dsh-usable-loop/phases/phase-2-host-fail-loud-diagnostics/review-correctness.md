# Correctness Review — Phase 2 (round 3, incremental: the four commit-gate lint rewrites)

Workflow: `vscode-dsh-usable-loop`
Phase: `phase-2-host-fail-loud-diagnostics`
Branch: `impl-phase-2-host-fail-loud-diagnostics`
Reviewer: `reviewer-correctness` (implementation correctness only)

## 视角

**Implementation Correctness** — does the code actually work?

Scope, as commissioned: **only the four rewrites that clear the repo's `pre-commit` → `lint (staged)` gate** (`auto-start-orchestrator.ts:242-243`, `interaction-coordinator.ts:357`, and two sites in `tests/auto-start-orchestrator.spec.ts`), plus the seven formatting lines the same hook's `--fix` pass applied. The Phase 2 main body (18-field diagnostics contract, listener, store, extension wiring) was closed in round 2 and is **not** re-adjudicated here; `verifier` independently PASSed it. No new severe problem in the main body surfaced during this pass.

Startup self-cleanup: **nothing to archive.** The direct path held no `review-correctness.md` / `-zh.md` (round 2's pair is already at `.archive/review-correctness-20260916T040334Z.md` / `-zh-…`). No `mv` was performed; no file outside this reviewer's own two outputs was written; no git state-changing command was run.

Continuity of this reviewer's own record: round-2 🟡-1 (`DEBT-010` provenance cited `§8.9/§8.10`) is now **fixed** — `tech-debt-registry.md:28` cites `§8.12` and names what §8.9/§8.10 actually are. Round-2 🟡-2 became `DEBT-011` by user ruling at HG-3 (accepted as debt, not reworked).

## 判决：SHOULD-FIX

The four rewrites are **behaviour-preserving** — I re-derived each equivalence, reproduced the mutation evidence, and found no suppression, no lost assertion and no new failure. **Zero MUST-FIX.** The verdict is not PASS because one accounting finding remains open (§6, 🟡-1): §11.6's repo-wide lint ledger contradicts its own table, omits a row that is visible in `git diff`, and can no longer be reproduced because its baseline artifacts are gone. This is the same class of `implementation.md` fidelity finding that this phase has already treated as SHOULD-FIX-worthy twice (round-2 🟡-1/🟡-2 → `DEBT-011`/`DEBT-012`), so downgrading it to an observation would be inconsistent with the standard already applied. It does not block: the code works, the gate is genuinely green, and the finding is in a section about a peripheral claim.

## 1. The four sites — independent equivalence derivation

### 1.1 #1 — `auto-start-orchestrator.ts:242-243` (`no-non-null-assertion`)

```242:247:apps/vscode-dsh/src/auto-start-orchestrator.ts
        const next = more.at(-1)
        if (next !== undefined && !this.port.isConnected() && generation === this.generation) {
          this.startInFlight = undefined
          await this.runStart(next)
          return
        }
```

**Precondition the equivalence rests on.** `more.at(-1) !== undefined` ⟺ `more.length > 0` holds **only** if (a) `more` is a dense JS array and (b) no element is literally `undefined`. Both hold in this code:

| Fact | Evidence |
|---|---|
| `more` is a fresh dense array | `const more = this.pending.splice(0)` (`:240`) — `splice` returns a new dense array |
| element type excludes `undefined` | `private pending: StartReason[] = []` (`:103`); `StartReason` is a 7-member string union with no `undefined` member (`:8-15`) |
| no site can insert `undefined` | all four accesses to `this.pending` are: read-spread in `getSnapshot` (`:135`), `push(reason)` with `reason: StartReason` (`:161`), `this.pending.length = 0` (`:198`), `splice(0)` (`:240`) |

**Counterfactual, stated so the precondition is not taken on faith:** if a sparse array or an `undefined` element could exist, the two forms *would* diverge — the old guard (`more.length > 0`) would enter the branch and call `runStart(undefined)`, the new guard would fall through. That divergence is unreachable (the branch would itself have been a bug), and where the forms could differ the new one is the safer. The `next === undefined` fall-through arm is therefore **reachable** (an empty `pending`, the common case) — a real narrowing rather than a dead branch. `tsc` also accepts it: `next` narrows to `StartReason` at `runStart(next)`, confirmed by `pnpm run typecheck` exit 0.

**Evaluation-order change is unobservable.** `more.at(-1)` moved above the `this.port.isConnected()` call. `at()` is a side-effect-free read of a local array that is already detached from `this.pending` by `splice(0)`, so nothing a `StartHostPort` implementation does inside `isConnected()` can change `more` or `next`. Point by point:

| Concern | Finding |
|---|---|
| `this.notify()` timing | unchanged — still at `:241`, before the guard, in both versions |
| short-circuit | `next !== undefined` is decided before `isConnected()` is consulted, exactly as `more.length > 0` was |
| `startInFlight` reset paths | unchanged: `:237` (generation mismatch, early return), `:244` (guard true, before the recursive `runStart`), `:248` (fall-through) |
| the three exits | all reachable as before — `:238`, `:246`, and the implicit return at the end of `finally` |
| once-per-pass extra read | `next` is now computed even when a later conjunct would have short-circuited; pure read, no observable effect |

### 1.2 #2 — `interaction-coordinator.ts:357` (`no-non-null-assertion`)

```353:369:apps/vscode-dsh/src/interaction-coordinator.ts
  private enqueue(entry: QueueEntry): void {
    if (this.activeSessionId !== undefined && entry.sessionId === this.activeSessionId) {
      // Soft priority: insert at front of waiting queue, same-Tab FIFO.
      let insertAt = 0
      for (const current of this.queue) {
        if (current.state === 'presented') {
          insertAt += 1
          continue
        }
        if (current.sessionId === entry.sessionId && current.state === 'pending') {
          insertAt += 1
          continue
        }
        break
      }
      this.queue.splice(insertAt, 0, entry)
      return
    }
    this.queue.push(entry)
  }
```

`insertAt` doubles as the loop index and starts at 0 with increments of exactly 1 (`:359`, `:363`), so the old `while (insertAt < this.queue.length)` read `this.queue[insertAt]` at the same indices, in the same order, as `for…of` yields.

**The mutation-during-iteration divergence class cannot arise here** — I checked the body rather than assuming: lines `:357-367` contain only `insertAt += 1`, `continue` and `break`. The `splice` is at `:368`, *after* the loop. Nothing else in the body touches `this.queue`.

Exit value per path — identical in both forms:

| Path | old `insertAt` | new `insertAt` | resulting call |
|---|:--:|:--:|---|
| break at first non-matching entry (`i = 0`) | 0 | 0 | `splice(0, 0, entry)` = prepend |
| break after `k` matching entries | `k` | `k` | `splice(k, 0, entry)` |
| every entry matches | `queue.length` | `queue.length` (one iteration per element) | `splice(length, 0, entry)` = append |
| empty queue | 0 (loop never entered) | 0 (zero iterations) | prepend |

`break` and `continue` keep their meaning in `for…of`. `this.queue` is `private readonly queue: QueueEntry[] = []` (`:117`) — a plain data field, **not** a getter — so `for…of` capturing the array once is the same object the `while` form re-read each iteration. The `QueueEntry` union (`:110`) is unaffected by the de-`!`-ing; the narrowing `current.state` / `current.sessionId` still typecheck.

One incidental robustness gain, not a behaviour change: the `for…of` form cannot loop forever, whereas the `while` form would hang if a future edit added a `continue` without the increment.

### 1.3 #3 / #4 — `tests/auto-start-orchestrator.spec.ts:52-56`, `:93-97` (`eslint(prefer-const)`)

```17:38:apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts
function mockPort(overrides?: Partial<StartHostPort> & {
  connected?: boolean
  startImpl?: (reason: StartReason) => Promise<void>
}): StartHostPort & { startCalls: StartReason[]; setConnected(v: boolean): void } {
  let connected = overrides?.connected ?? false
  const startCalls: StartReason[] = []
  const port: StartHostPort & { startCalls: StartReason[]; setConnected(v: boolean): void } = {
    startCalls,
    setConnected(v) { connected = v },
    isConnected: () => connected,
```

**`.bind(port)` was inert.** `setConnected` is a method shorthand that **never reads `this`** (`:25`) — it mutates the `connected` local closed over from `mockPort` (`:21`). So `setConnected(true)` under the old binding and `port.setConnected(true)` are the same call; even the now-non-trivial `this === port` binding is irrelevant to the observable effect.

**No TDZ.** The closure `async startImpl() { await started; port.setConnected(true) }` reads `port` only when `startImpl` is invoked. `mockPort` (`:17-38`) merely *stores* `overrides.startImpl` and calls it from inside `port.start` (`:28-35`) — it never runs it at construction. The first `orch.request(...)` (`:60`, `:101`) happens after `const port = mockPort(...)` has completed. The reference is a deferred read, as §11.3 says.

**Async ordering unchanged** — `await started` / `await gate` then `setConnected(true)`, in both versions.

## 2. Was any "lint-silencing" device used?

**No.** Every suppression family is absent from all three files:

```text
$ grep -nE "eslint-disable|oxlint-disable|ts-expect-error|ts-ignore|as any|: any|@ts-" <3 files>
(no output; exit 1)
$ grep -nE "[A-Za-z0-9_\)\]]!" <3 files>
(no output; exit 1)
```

No `eslint-disable` / `oxlint-disable`, no `@ts-expect-error` / `@ts-ignore`, no `any`, and **no non-null assertion of any variant survives** in the three files. The four sites are genuine rewrites, which is what the task premise claims.

## 3. Was test coverage weakened?

**No**, at three levels:

1. **No test was disabled or removed.** `grep -nE "\.skip|\.only|it\.todo|xit\(|xdescribe\("` over the affected spec and sources → no hits (exit 1). The spec file's diff (vs `HEAD`) is exactly three hunks plus two appended `it()` cases; the two edited tests lose only the forward-declared binding and its later assignment — **every assertion in both tests is retained** (11 `it()` / 34 `expect(` in the file).
2. **The rewritten `enqueue` branch has real behavioural coverage** — it is *not* evidenced by reasoning alone. `tests/phase2-multitab-history-replay.spec.ts:106-171` ("AD-CU-7 serial soft-priority queue (AC-20/58)") calls `setRegistry` + `onActiveSessionChange(active.sessionId)` (`:132-133`) and then enqueues for the **active** session while another entry is `presented` (`:144-148`) — that is precisely the `current.state === 'presented' → insertAt += 1` arm plus the resulting `splice(insertAt, 0, entry)` index, asserted indirectly at `:151-152` and `:161-162`. It **passes** on the rewritten loop (§7). The `break`-at-head arm is not covered by any test I could find, but its semantics are unchanged.
3. **The rewritten guard in #1 is covered** by the existing coalescing / retry cases in `auto-start-orchestrator.spec.ts` (11/11 pass), which exercise both the `next !== undefined` re-entry arm and the fall-through.

## 4. Mutation evidence — independently reproduced

§11.5's claim is that reverting #2 makes the gate fail **at the same position** the commit hook reported, proving the gate is really looking at that line rather than having silently stopped scanning the file. I reproduced it in place with an immediate, hash-verified restore:

```text
$ md5sum apps/vscode-dsh/src/interaction-coordinator.ts
db53f8bbc38accd4d7e0ce049d1888e8  apps/vscode-dsh/src/interaction-coordinator.ts
### MUTATED (for (const current of this.queue) → while (insertAt < this.queue.length) + this.queue[insertAt]!) ###
$ node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern \
    apps/vscode-dsh/src/auto-start-orchestrator.ts apps/vscode-dsh/src/interaction-coordinator.ts \
    apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts
apps/vscode-dsh/src/interaction-coordinator.ts:358:25: error typescript(no-non-null-assertion): Forbidden non-null assertion.
MUTANT_LINT_EXIT=1
### RESTORED ###
$ md5sum apps/vscode-dsh/src/interaction-coordinator.ts /tmp/p2r3-mut/coord-backup.ts   # tree unchanged
db53f8bbc38accd4d7e0ce049d1888e8  apps/vscode-dsh/src/interaction-coordinator.ts
db53f8bbc38accd4d7e0ce049d1888e8  /tmp/p2r3-mut/coord-backup.ts
$ <same staged lint over the three files>
POST_RESTORE_LINT_EXIT=0
```

**Result: identical to §11.5, `358:25`, exit 1** — the gate sees the line. The repository tree is byte-identical to its pre-mutation state (md5 match; `diff` against the backup reports no difference; no residual `while (insertAt…` / `this.queue[insertAt]` appears in `git diff HEAD`; no reviewer artifact was left in the repo).

I also independently confirmed §11's **premise** — that these four violations are pre-existing, not Phase 2 artifacts — directly against `HEAD`:

```text
$ git show HEAD:apps/vscode-dsh/src/auto-start-orchestrator.ts  | grep -n "more.length - 1]!"   → 236:
$ git show HEAD:apps/vscode-dsh/src/interaction-coordinator.ts  | grep -n "this.queue\[insertAt\]!" → 328:
$ git show HEAD:apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts | grep -n "let setConnected!" → 53:, 96:   (2 hits)
```

That is the `1 / 1 / 2` the §11 preamble asserts. The "ratchet" framing in §11 is therefore correct: the hook surfaced pre-existing violations because the change set touched those files.

## 5. §11 self-report vs. the code

### 5.1 Verified consistent

| §11 claim | Independent check |
|---|---|
| §11.1 "Before" column matches `HEAD` | confirmed for all four sites (grep against `git show HEAD:`) |
| §11.2 `noUncheckedIndexedAccess: true` blocks the naive de-`!`; `const x!: T` needs an initializer; no suppression used; no `!` left | confirmed by `tsconfig.base.json` behaviour (typecheck) + the greps in §2 |
| §11.3 all three equivalence arguments | re-derived independently in §1; each holds, including the enumeration of `insertAt`'s exit value |
| §11.4 `lint (staged)` → exit 0, no output | reproduced (§7) |
| §11.4 `pnpm run typecheck` → exit 0 | reproduced (§7) |
| §11.4 4 spec files / 66 cases passed | reproduced exactly, 66/66 (§7) |
| §11.4 `pnpm run test apps/vscode-dsh` → 6 failed / 404 passed / 1 skipped (411), same 6 | reproduced exactly, same 6 names (§7) |
| §11.5 mutation at `358:25` | reproduced verbatim (§4) |
| §11.6 the 2 *added* entries are the verifier probe's own unused directives | confirmed: `.specdev/…/verifier-independent-phase2.spec.ts:220` and `:490` are `// eslint-disable-next-line @typescript-eslint/no-explicit-any` that the profile reports as unused; both are in a `test-scripts/` probe, not product code |
| §11.6 "`pnpm run lint` is red before and after" | confirmed, `LINT_EXIT=1` |
| §11.6 "no file gained a diagnostic" (the substantive claim) | **true** for the three touched files — see 5.2 |
| §11.7 "no `@STUB` was created and none was resolved" | confirmed — `grep @STUB` over the three files → no hits |

### 5.2 🟡-1 — §11.6's ledger is internally inconsistent, omits a visible row, and is no longer reproducible

This is the one open finding. Three separable defects, all in the same section:

**(a) The heading contradicts the table.** "Removed — 7 entries, every one a removal" is followed by five rows whose counts sum to **1 + 1 + 2 + 2 + 3 = 9**. The number 7 is the *formatting-line* count the hook's `--fix` pass applied; the heading appears to have borrowed it and applied it to the whole table.

**(b) A row visible in `git diff` is missing.** The same `--fix` pass also rewrote two `@stylistic(arrow-parens)` sites in `tests/auto-start-orchestrator.spec.ts`:

```text
$ git show HEAD:apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts | grep -nE "new Promise<void>\(r =>"
52:    const started = new Promise<void>(r => { resolveStart = r })
95:    const gate = new Promise<void>(r => { resolveStart = r })
```

The table attributes 2 arrow-parens removals to `interaction-coordinator.ts` (the `new Promise((resolve) => {` sites) but **none** to the spec file. With the missing row the formatting removals are 2 + 2 + 3 = 7, which is what the heading quotes — further evidence the heading was meant as the formatting count.

**(c) The normalized totals cannot be reconciled, and the artifacts are gone.** Re-running the recipe recorded in `.cursor/skills/project-test/SKILL.md` on a fresh whole-repo lint gives **887** distinct `file|severity|rule` keys (10373 raw diagnostic instances). §11.6's arithmetic implies 886 (891 − 7 + 2); the table's own sum implies 884 (891 − 9 + 2). The baseline `/tmp/lint-base-norm.txt`, the round-2 output `/tmp/p2r2-lint-norm.txt` and §11.3's differential script `/tmp/p2r2-equivalence.ts` **no longer exist**, so neither direction of the discrepancy can be attributed. (The repo's own records disagree on the baseline size, too: `project-build` says 890 `(rule,file)` combinations while `project-test` / §11.4 say 891 entries.)

**(d) The parenthetical under-describes the coordinator's entry set.** §11.6 reads "`interaction-coordinator.ts` keeps its 5 `no-unnecessary-condition` entries, `auto-start-orchestrator.ts` and the spec keep 0". The file actually has **6** entries:

```text
$ grep -E "^apps/vscode-dsh/src/interaction-coordinator\.ts:" <whole-repo lint>
…:423:13: typescript(no-unnecessary-condition)  …:441:62: typescript(no-confusing-void-expression)
…:450:15  …:454:13  …:475:13  …:478:13: typescript(no-unnecessary-condition)
```

I verified the 6th is **pre-existing**, so §11.6's substantive claim survives: `() => resolve('unavailable')` (the flagged expression at `:441:62`) also sits at `HEAD:412` with identical text, and this round's `--fix` touched only the *preceding* line. `auto-start-orchestrator.ts` and the spec file do have 0 entries, as stated. So: **no file gained a diagnostic** — true; the enumeration offered as its evidence is incomplete, and an auditor who greps the file finds 6 where the report says 5 and cannot tell from the report whether the 6th is new.

**Why this is SHOULD-FIX rather than an observation.** It is squarely the class this phase has already ruled on twice: round-2 🟡-1 (`DEBT-010` citing the wrong sections) and 🟡-2 (§9 self-check inaccuracies) — both `implementation.md` / registry fidelity findings that the user accepted as debt rather than dismissing. The failure mode is identical: the reader following the report's evidence lands somewhere that does not match, and loses the ability to check. Nothing here is a correctness defect, and none of it touches the four rewrites. One-line fixes: correct the heading to 9 (or to "7 formatting lines + 4 gate errors"), add the spec file's `@stylistic(arrow-parens) | 2` row, name the coordinator's 6th entry, and either restore the baseline artifacts next time or state the ledger as an absolute current count rather than a diff against a `/tmp` file that will not survive.

## 6. Independent re-run evidence (commands and results)

All Node/pnpm invocations prefixed with `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`; pnpm commands with `--config.verify-deps-before-run=false`.

| # | Command | Result |
|---|---|---|
| 1 | `tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern <the 3 files>` | **exit 0, no output** (re-run after mutation restore: exit 0) |
| 2 | `pnpm run typecheck` | **exit 0** |
| 3 | `pnpm exec vitest run auto-start-orchestrator.spec.ts interaction-fail-closed.integration.spec.ts gap-005-009-debt-fix.spec.ts host-diagnostics.spec.ts` | **4 files / 66 cases passed**, exit 0 |
| 4 | `pnpm exec vitest run phase2-multitab-history-replay.spec.ts interaction-fail-closed.e2e.spec.ts` | **2 files / 10 cases passed**, exit 0 — the soft-priority test that covers the rewritten `enqueue` loop, plus an end-to-end Host/UI path |
| 5 | `pnpm run test apps/vscode-dsh` | `Test Files 4 failed \| 47 passed (51)`; `Tests 6 failed \| 404 passed \| 1 skipped (411)`; exit 1. Failing set = `panel-close-delete.e2e` VP-1-close/delete, `spike-t0a-replay-rebuild` ×4 (AC-30/47, AC-76, AC-77, AC-80), `spike-t0b-continue-capability` (0 test), `verifier-phase1/layer-a-rtl` V-A4 — **exactly the 6 baseline cases** documented in `project-test` and in my round-2 §4. No new failure. |
| 6 | `pnpm run lint` (whole repo) | exit 1 (red both before and after, as documented); 1411332 bytes; normalized 887 distinct keys / 10373 raw instances |
| 7 | mutation + restore of #2 | `358:25` exit 1 under mutation; `exit 0` after restore; md5 identical before/after |
| 8 | `git diff HEAD --stat` on the touched files | `auto-start-orchestrator.ts` 2 lines changed in the guarded block; `interaction-coordinator.ts` +37 −8 (this round) — consistent with §11.1 |

Note on baselines: `/tmp/p2-baseline-vscode-dsh.txt` and `/tmp/p2-baseline-lint.txt` **no longer exist** on this host, so the failure-set comparison in row 5 is against the 6 case names recorded in `project-test` and in my round-2 report, which my run reproduces name-for-name.

## 7. Stub Detection

### Registered debt (not re-reported)

The registry holds exactly six active entries (`tech-debt-registry.md:26-31`), all 🟡 non-blocking: `DEBT-004`, `DEBT-009`, `DEBT-010`, `DEBT-011`, `DEBT-012`, `DEBT-013`. None of them is created by, or touched by, the four rewrites; §11.7's "gains no entry" is consistent with the registry diff (the four Phase-2 entries were added at HG-3 adjudication, not by the lint round).

### New unregistered stubs

**None.** `grep -n "@STUB"` over the three touched files returns no hits (exit 1). The four edits are behaviour-preserving rewrites of existing lines and introduce no placeholder.

## 8. Key findings

### 🔴 Must-Fix

**None.** All four rewrites are semantically equivalent to their predecessors; no acceptance criterion is affected; no suppression device was used; no assertion was lost; no unregistered stub exists.

### 🟡 Should-Fix

- **🟡-1 §11.6's whole-repo lint ledger does not match its own table and is no longer reproducible.** (a) The heading "Removed — 7 entries" sits above rows summing to 9. (b) The table omits the spec file's two `@stylistic(arrow-parens)` removals, which are visible in `git diff` (`HEAD:52`, `HEAD:95` → current `:52`, `:93`) and which would bring the formatting removals to the 7 the heading quotes. (c) The documented normalization application to a fresh run gives 887 distinct keys against an implied 886 (heading) or 884 (table sum); the baseline artifacts and the differential script are gone, so the residual cannot be attributed. (d) The parenthetical names "its 5 `no-unnecessary-condition` entries" where the file has 6 — the 6th, `typescript(no-confusing-void-expression)` at `:441:62`, is likewise pre-existing (its expression is at `HEAD:412`, unchanged), so the substantive claim "no file gained a diagnostic" holds, but the evidence enumeration does not match the file. All four sub-points are wording/artefact hygiene in a section about a peripheral claim; none is a correctness defect and none touches the four rewrites.

### 🟢 Observations

- **🟢-1 #2 strictly reduces a hazard class.** The old `while (insertAt < this.queue.length)` would hang forever if a future edit added a `continue` without the `insertAt += 1`; `for…of` cannot. The rewrite is therefore a small robustness gain on top of being equivalence-preserving — worth keeping independent of the lint gate.
- **🟢-2 #1's equivalence has an on-the-record precondition that §11.3 states loosely.** §11.3 says "`at(-1)` is `undefined` exactly when `more` is empty". That is true for dense arrays; the general form of the claim is "`at(-1) !== undefined` ⟺ non-empty **and** last element not `undefined`". The precondition holds here (see §1.1) and §11.2 supplies the surrounding `noUncheckedIndexedAccess` context, so no reader is misled in practice — but the guard's correctness does depend on `StartReason` never admitting `undefined`, which is a fact about the type rather than about `at()`.
- **🟢-3 the staged gate is provably live, and the four fixes are provably load-bearing.** The mutation in §4 rules out the failure mode that would have made §11 circular ("exit 0 because the file was silently skipped"): the same invocation, config and file set reports `358:25` the moment the offending form is restored. Combined with the `HEAD` grep showing all four violations pre-exist, the round's whole justification is independently supported.
- **🟢-4 process note, not a code finding.** `/tmp` is the evidence substrate for this phase (`lint-base-norm.txt`, `p2r2-lint-norm.txt`, the baselines, the differential script) and it does not survive across rounds, which is what makes §11.6 unauditable now. Any future round whose claim rests on a `/tmp` artifact should either copy it into the phase directory or state the claim as an absolute current measurement.
- **🟢-5 the round did not touch anything else.** The only non-product tree change attributable to this round is `implementation.md` §11; the 7 formatting lines in `extension.ts` / the two source files are the hook's `--fix` output and are preserved rather than reverted (`-w` diff isolates exactly 3 whitespace-only insertion/deletion pairs in `extension.ts`; the arrow-parens sites are non-whitespace and count 2 + 2). No `@STUB`, no test-file deletion, no `.skip`.

## 9. Notes on method and limits

- **What I verified by execution:** the staged lint gate, typecheck, four targeted spec files, the soft-priority behavioural test, one end-to-end path, the full `apps/vscode-dsh` suite, the whole-repo lint, and the #2 mutation with hash-verified restore. Everything above marked "reproduced" was re-run by me on the current working tree.
- **Three mutation probes were rejected by tool policy** (a `/tmp`-based control probe, and the combined #1 + #3/#4 reversion). I did **not** escalate them, because the #2 mutation already answers the question they were meant to answer ("is the gate really scanning these files?"), and because each additional write into a workspace holding unrelated uncommitted changes carries its own risk. Consequence: for `auto-start-orchestrator.ts` and the spec file I proved the gate is live only by **inference** — same invocation, same config, same file list as the proven-live case, plus the `HEAD` grep showing the pre-fix constructs were present at the positions §11.4 reports. A direct mutation on those two files was not obtained.
- **What I did not re-run:** §11.6's repo-wide delta against its own baseline (the baseline file is gone; see §5.2(c)). I ran the whole-repo lint and normalized it, and I enumerated the three touched files' entry sets directly, which is what makes the substantive part of §11.6 checkable without the baseline.
- **Out of scope by instruction, and respected:** the Phase 2 main body (diagnostics contract, listener, store, extension wiring) was not re-adjudicated. Nothing in this pass surfaced a new severe problem in it.
- **Independence:** no finding here is taken from `implementation.md`, another reviewer's report, or the verifier's report; §6 of this document is my own reading of the code, and the tables in §5.1 mark each §11 claim as reproduced or not.
- **Tree state at hand-off:** working tree byte-identical to what I found (coordinator md5 `db53f8bbc38accd4d7e0ce049d1888e8` before and after); the two files I did not mutate were never written (their backups were never created because the command was blocked before running); no reviewer artefact left inside the repo; no `git add` / `git commit` / reset / checkout / stash / clean was executed at any point.
