# Phase 2 verification report (round 3 — lint-fix re-verification) — `phase-2-host-fail-loud-diagnostics`

| Item | Value |
|---|---|
| Workflow | `vscode-dsh-usable-loop` |
| Phase ID | `phase-2-host-fail-loud-diagnostics` (from `phase-plan.md` DAG JSON `phases[].id`) |
| Branch | `impl-phase-2-host-fail-loud-diagnostics` (`git branch --show-current`, measured) |
| Phase type | **non-UI** — `phase-plan.md:74` DAG JSON `"ui": false` → visual validation **N/A** (does not downgrade the verdict) |
| AC scope | AC-13 – AC-22 (10 criteria; round 2 evidence re-used, not re-derived) |
| Round type | **Re-verification of an upstream, pre-commit-driven change** (4 lint fixes + 7 formatting lines). Not a from-scratch re-verification. |
| Step-0 self-cleanup | `verification.md` **absent** from the direct path; the round-2 pair is already archived as `.archive/verification-20260916T060214Z.md` + `verification-zh-20260916T060214Z.md`. Nothing to archive this round. **No git command was run** for cleanup; `current-status.json` untouched. |
| Verifier | `verifier` (independent; every claim below comes from my own run, not from `implementation.md` / `review.md`) |

## 判决：PASS

**Rationale.** All four lint fixes are semantically equivalent to the removed code, established three independent ways: (a) static AST shape checks (20/20, old forms gone and new forms exact), (b) behavioural probes against the real `AutoStartOrchestrator` / `InteractionCoordinator` / `activate()` (16/16, including a 188-shape real-class comparison against a pre-fix oracle and a 512-shape loop-form superset), and (c) the `lint (staged)` gate itself returning exit 0 on exactly those three files — with a separate non-vacuity proof that the run really parses and reports on them. The two end-to-end paths round 2 rested on (AC-22 `start → failure → paired retry records`, and the `dsh.test.getDiagnosticsText` read surface) are green again on the post-change tree, `pnpm run typecheck` is exit 0, and the package suite's failure set is byte-for-byte the round-2 baseline (6 pre-existing failures in 4 files) while the with/without-probe delta is exactly +16 passed. **Round 2's PASS is therefore not invalidated by this change** — no new failure, no weakened evidence, no AC regression. The only open items are outside this Phase's deliverable (the 3 documentation-only SHOULD-FIX items awaiting your disposition, plus the already-registered `DEBT-010` and the real-machine smoke work that the spec assigns to Phase 3); they are recorded in §Out-of-scope dimensions and registered debt, not in §Residual risks.

---

## Test execution matrix

| # | Scenario | Source | Command | Result | Evidence |
|:--:|---|:--:|---|:--:|---|
| 1 | `lint (staged)` on the 3 changed files | gate | `node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern apps/vscode-dsh/src/auto-start-orchestrator.ts apps/vscode-dsh/src/interaction-coordinator.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | ✅ exit 0, zero diagnostics | shell output (`STAGED_LINT_EXIT=0`) |
| 1b | **Non-vacuity control for #1** — same wrapper, same config, same 3 files, one rule forced on | me | add `--deny no-magic-numbers` to #1 | ✅ diagnostics **3 / 9 / 1** in the three files → all three are parsed and reported under `.oxlintrc.staged.json`; #1's exit 0 therefore means "clean", not "not linted" | shell output |
| 2 | `typecheck` | gate | `pnpm run typecheck` | ✅ exit 0 | `/tmp/p3r3-typecheck.txt` |
| 3 | Targeted suite (edited spec + the two Phase-2 core specs) | gate | `pnpm exec vitest run apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/host-diagnostics.spec.ts apps/vscode-dsh/tests/session-host.spec.ts` | ✅ exit 0 — **3 files / 68 passed (68)** | `/tmp/p3r3-targeted.txt` |
| 4 | `apps/vscode-dsh` suite, **round A (no probe)** | gate | `pnpm run test apps/vscode-dsh` | ⚠️ exit 1 (repo baseline) — **4 failed \| 47 passed (51)** files; **6 failed \| 404 passed \| 1 skipped (411)** tests | `/tmp/p3r3-roundA.txt` |
| 5 | `apps/vscode-dsh` suite, **round B (with my 16-test probe)** | me | same as #4 with the probe copied into `apps/vscode-dsh/tests/` | ⚠️ exit 1 (same 6) — **4 failed \| 48 passed (52)**; **6 failed \| 420 passed \| 1 skipped (427)** | `/tmp/p3r3-roundB.txt` |
| 6 | My probe alone, verbose | me | `pnpm exec vitest run apps/vscode-dsh/tests/verifier-independent-phase3.spec.ts --reporter=verbose` | ✅ exit 0 — **16 passed (16)**, each test named in the output | `/tmp/p3r3-probe.txt` |
| 7 | Static AST equivalence checks | me | `node_modules/.bin/tsx .../test-scripts/verifier-ast-static-phase3.ts` | ✅ exit 0 — **20/20 PASS** | `/tmp` shell output (`AST_EXIT=0`) |
| 8 | Working-tree integrity (did I leave anything behind?) | me | `git diff --stat -- apps/ packages/` after every probe run | ✅ **empty** — no product file modified by me; `git status -s -- apps/vscode-dsh/tests/` shows exactly the 4 expected entries, no probe residue | shell output |

### Evidence detail

**#1 / #1b — why the "clean" reading is trustworthy, and what a proof of it would have looked like.** The four reported violations are covered by `.oxlintrc.json:151-176`, whose `files` globs include `apps/*/src/**/*.{ts,tsx}` and which sets `typescript/no-non-null-assertion: "error"` (`.oxlintrc.json:160`) — that is exactly the rule behind fixes #1 and #2. The same override block **does not** cover `apps/vscode-dsh/tests/**`, where `.oxlintrc.json:198-215` sets `typescript/no-non-null-assertion: "off"`; so fixes #3/#4 were driven by other rules in the base config, and I did not need to identify them to verify the edits (my judgement is on behaviour, not on the rule name).

The intended positive control (re-introducing the pre-fix forms and confirming the gate goes red) could not be executed as designed:

- oxlint in this repo has no stdin mode (`--stdin` → `` Error: `--stdin` is not expected in this context ``), so piping `git show HEAD:<file>` into the gate is impossible;
- and a control file placed outside an override glob proves nothing: **`.specdev/**` matches none of the `files` lists in `.oxlintrc.json`**, so linting a control in place reports zero diagnostics whether or not the rule is real. My first control attempt failed exactly this way (exit 0 on deliberately bad code) — which is why the wrapper was correct and the *control* was invalid.

The substitute control is stronger than the intended one because it uses the real corpus: `--deny no-magic-numbers` through the *same* wrapper and *same* config on the *same three files* yields diagnostics at `auto-start-orchestrator.ts` (3), `interaction-coordinator.ts` (9, including line 359 — inside the rewritten loop) and `auto-start-orchestrator.spec.ts` (1). The files are therefore loaded, parsed and reported; #1's exit 0 is a real clean bill.

**#4 / #5 — the two-round count difference (proof that my probe actually ran).** Comparing rounds A and B:

```
round A (no probe):  Test Files  4 failed | 47 passed (51)   Tests  6 failed | 404 passed | 1 skipped (411)
round B (with probe):Test Files  4 failed | 48 passed (52)   Tests  6 failed | 420 passed | 1 skipped (427)
delta:               +1 file, +16 passed, failures identical (6), skipped identical (1)
```

The delta is **exactly** my probe's 16 test cases, and the failure set is unchanged in both count and identity — so the probe was genuinely executed and genuinely green (rather than "not collected, hence zero failures"). This also reproduces the two invariants recorded in `.cursor/skills/project-test/SKILL.md`: 411 tests / 6 red without the probe (round 2 also measured 47 files / 404 passed), i.e. **this change moved nothing in the suite**.

**#7 — the 20 static checks.** They pin the mechanical claims my behavioural probes cannot see: `setConnected` has exactly one declaration whose body contains **zero `this`** (so dropping `.bind` is inert), no `let setConnected` forward declaration and no `.bind(port)` remain, all 6 call sites go through the returned port object with 0 bare `setConnected(...)` calls, `more.at(-1)` is hoisted above the guard with exactly one `next !== undefined` guard, the removed length check and asserted index read are gone, `enqueue` uses `for..of` with 0 `while` loops and 0 `this.queue[i]` reads while still splicing at `insertAt`, and `(r) => r` vs `r => r` produce an identical AST node-kind sequence (the 7 formatting-only lines are binding-neutral: 2 paren-neutral arrow params in the spec, 11 in the coordinator).

---

## Independent verification scenarios (mine, not the implementer's)

Script on disk: `.specdev/specs/vscode-dsh-usable-loop/phases/phase-2-host-fail-loud-diagnostics/test-scripts/verifier-independent-phase3.spec.ts` (16 cases). Reproduction recipe is in the file header: copy into `apps/vscode-dsh/tests/`, run, delete (deliberately kept out of the product test tree so it never pollutes coverage). That it *was* executed is independently proven by the count difference above.

| # | Scenario | What it would catch | Command | Result |
|:--:|---|---|---|:--:|
| S1-a | Empty pending list never re-enters start — the guard is load-bearing (`[].at(-1)` is `undefined`, so without the guard `undefined` would reach `runStart`) | dropping the guard while "simplifying" the rewrite | probe, S1 | ✅ |
| S1-b | A queued backlog is retried with the **LAST** reason, exactly once (the `more.at(-1)` pick, not `[0]`, not "all of them") | picking the wrong element after the hoist | probe, S1 | ✅ |
| S1-c | A live connection suppresses the retry even with a backlog | inverting the `!isConnected()` term | probe, S1 | ✅ |
| S1-d | A user stop during starting makes the late settle a no-op (generation guard) | losing the generation check in the reordered `if` | probe, S1 | ✅ |
| S1-e | `length > 0` ≡ `at(-1) !== undefined` over 7 shapes; `typeof [].at === 'function'` in the runtime used; negative control (first ≠ last element, so a first-element pick could not pass silently) | an "equivalent" rewrite that is not equivalent; a runtime without `Array.prototype.at` | probe, S1 | ✅ |
| S2-a | **Real `InteractionCoordinator`** driven through `handleApproval`/`handleQuestions`: **188 tail shapes** (2 × 94 patterns) must land where the pre-fix `while` loop put them, with an asserted discriminating count > 0 (the oracle with the `presented` clause dropped disagrees on ≥1 shape) | any change in the soft-priority insertion index, incl. a regression in the `presented` clause alone | probe, S2 | ✅ |
| S2-b | Non-active session appends; no active session appends | a rewrite that stops at the first element | probe, S2 | ✅ |
| S2-c | The two loop forms agree over a state×session **superset** (4×2×4×2×4×2 = 512 shapes, 3-entry queues) plus empty/single-entry boundaries | an off-by-one that only appears in shapes `tests/*.spec.ts` does not cover | probe, S2 | ✅ |
| S3-a | `setConnected` still flips the flag when invoked **without** a receiver (the property that made `.bind` removable, tested rather than assumed) | a refactor that silently relied on `this` | probe, S3 | ✅ |
| S3-b | The gate-released start reaches `'started'` **only because of** that call (a start that never flips the flag must not be `'started'`) | a fixture change that makes the test vacuous | probe, S3 | ✅ |
| S3-c | **Mutation control**: a start that never flips the flag fails instead | the "happy path passes trivially" failure mode | probe, S3 | ✅ |
| S3-d | Coalescing + late settle still behave as the two edited tests expect (the two call sites the fixes touched) | behaviour drift hidden inside a helper edit | probe, S3 | ✅ |
| S4-a | **AC-22 chain**: opener + paired retry, then a fresh chain after a reachable start | retry records losing `retryOfSeq` pairing after the guard rewrite | probe, S4 | ✅ |
| S4-b | The read surface is an array of **exactly the 18 declared fields** (no extra, no missing) | a shape change smuggled in with the refactor | probe, S4 | ✅ |
| S5-a | `dsh.test.getDiagnosticsText` on a **real `activate()`**: hook registered and returns the structured array (empty at first) | the read surface silently disappearing | probe, S5 | ✅ |
| S5-b | A pre-Host refusal reaches the read surface as a **paired** record through the real activation | end-to-end pairing broken while unit tests stay green | probe, S5 | ✅ |

**Method transparency — my own failed attempt this round (kept on record so it is not mistaken for a product defect).** My first lint control was written into `test-scripts/` and linted in place; it came back **exit 0** on code containing exactly the pre-fix `!`-assertion and `while`/indexed-read forms. The control was wrong, not the gate: `.specdev/**` is covered by none of `.oxlintrc.json`'s `files` globs, so no rule was ever in scope for it. I did not simply accept the green reading; I found the reason, then replaced the control with the forced-rule non-vacuity proof above (same wrapper, same config, files inside the globs). The stale control file is kept in `test-scripts/` with its header rewritten to state the location requirement, so nobody reuses it in a way that "proves" the gate is blind.

## Reviewer-suggested verification scenarios

Round 3's `review.md` is SHOULD-FIX with **no MUST-FIX**, and all three SHOULD-FIX items are self-description defects in `implementation.md` §11 with zero behavioural content. Their disposition is yours, not a verdict input, so I did not re-litigate them (and did not let them pull the verdict down). What I did check independently:

| Scenario | Command | Result |
|---|---|---|
| The 4 fixes are the *whole* product change of this round (no fifth edit hiding in the staged set) | `git diff --cached -- apps/ packages/` read end to end | ✅ The three files' hunks contain exactly fixes #1–#4 plus 7 arrow-paren/indent lines; the rest of the staged set is Phase 2's original implementation and `.specdev` documents. No unreviewed product edit. |
| The edits did not drift the tree relative to the index (nobody left the working tree half-applied) | `git diff --stat -- apps/ packages/` | ✅ empty — all product changes are staged and the working tree matches the index |
| `.at(-1)` is an established pattern in this codebase, not a novelty introduced here | `grep -rn "\.at(-1)" apps/vscode-dsh/src packages/*/*/src` | ✅ 10+ pre-existing sites (`fork/fork-orchestrator.ts:269`, `acp/acp/src/index.ts:326`, `api/gateway/src/client/journal-stream.ts:187,513`, `api/session-controller/src/history.ts:74,322`, …) |
| The rewritten loop still performs the insertion (the refactor did not orphan the splice) | AST check `coord: the insertion index is still spliced at` + S2-a real-class ordering | ✅ |

---

## End-to-end validation (real paths, not isolated unit tests)

| # | Data path | Result | Evidence |
|:--:|---|:--:|---|
| E-1 | **AC-22 chain** — `AutoStartOrchestrator.request()` → failing start → `HostFailureRecorder` opener → retry entry point → **paired** record (`retryOfSeq` → the opener), then a fresh chain after a reachable start | ✅ | S4-a on the real classes; plus the shipped `AC-22` case (`re-enters the same start port on the retry entry point`) green in the targeted run #3 (68/68) on the post-change tree |
| E-2 | **Read surface** — `records()` → `dsh.test.getDiagnosticsText` → `HostDiagnosticRecord[]` with exactly the 18 declared fields, through a **real `activate()`** (round-2's E-2/E-5 path, re-run after the change) | ✅ | S4-b (18-field array) + S5-a/S5-b (hook registered; a pre-Host refusal arrives as a paired record) |
| E-3 | **Retry tail rewrite under load** — orchestrator's `finally` block re-entering `runStart` with a backlog, with and without a live connection, with and without a generation change | ✅ | S1-a..d (real class) — the four combinations the hoisted `more.at(-1)` and the rerordered guard can take |
| E-4 | **Edited test-helper call sites** — the two `startImpl` bodies the fixes touched, exercised through the real orchestrator (coalescing + late settle), including a mutation control | ✅ | S3-a..d |

---

## 残余风险

| Risk | Severity | Blocks HG-3 | Note |
|---|:--:|:--:|---|
| The equivalence oracles are my own constructions (a transliteration of the removed `while` loop; the `length > 0` ≡ `at(-1) !== undefined` identity) rather than the pre-fix binary re-executed. | **LOW** | no | I transcribed the oracle from the **removed (`-`) lines** in `git diff --cached` and the loop body I read at `interaction-coordinator.ts:353-372`, so it is a faithful copy; and S2-a keeps a discriminating assertion (>0 shapes where the oracle disagrees) so a silent oracle/gate mismatch could not pass. |
| Everything was run under vitest + Node 24.3.0 (`Array.prototype.at` guaranteed), not inside the real VS Code Electron host. | **LOW** | no | Mitigated twice: the probe asserts `typeof [].at === 'function'` in the executing runtime, and `.at(-1)` is already used at 10+ pre-existing sites in shipped `src/` (see the reviewer-suggested table) — a runtime lacking it would already be broken across the product. |
| The 4 pre-fix violations were never reproduced in-lieu (oxlint has no stdin; a control can only be linted from inside an override glob, which means copying into a product-adjacent path). | **LOW** | no | Replaced by the forced-rule non-vacuity control (`--deny no-magic-numbers` → 3/9/1 diagnostics on the same files through the same wrapper), which proves the same thing without touching the tree. |

Nothing in the above is a defect in this Phase's deliverable, and none of the three rises above `LOW` — hence PASS.

## 范围外维度与已登记债务

Kept separate from §Residual risks on purpose: these are real, but they are **not** attributable to this Phase's deliverable, so they do not shift the verdict.

| Item | Severity (as it stands) | Why it is out of scope |
|---|:--:|---|
| 6 pre-existing failures in `apps/vscode-dsh` (4 in `spike-t0a-replay-rebuild` — `FiberState` undefined via `packages/core/agent-loop/src/index.ts:40`; 1 in `panel-close-delete.e2e`; 1 in `verifier-phase1/layer-a-rtl`; 0-test suite failure in `spike-t0b-continue-capability`) | **MEDIUM** as repo state | Present in my round-A run *and* in round-2's baseline, count and identity unchanged (6 failed in both, same 4 files). They are pre-existing, unrelated to the host diagnostics work (agent-loop / panel / RTL chrome), and unmoved by this round's change — so they are neither introduced nor hidden. Reported here in full rather than under §Residual risks because this Phase does not own them. |
| 3 SHOULD-FIX items from `review.md` (all `implementation.md` §11 self-description defects: the §11.6 ledger is not reproducible and self-contradictory, §11.7's scope statement contradicts §8.8) | **LOW** (documentation only, zero behavioural content) | `review.md` verdict is SHOULD-FIX with no MUST-FIX, and their disposition (register as debt vs. rewrite the prose) is **yours** to decide. I explicitly did not let them move the verdict. |
| `DEBT-010` (post-handshake disconnect path) | **LOW** | Excluded by the spec and already registered in `tech-debt-registry.md`; round 2 verified the entry points at the real source locations. |
| Real-machine (Layer-V) evidence for the diagnostics surfaces | **LOW** for this Phase | `phase-plan.md:77` assigns AC-11/AC-12/AC-23… to `phase-3-layer-v-smoke-loop`; the spec explicitly defers machine-level capture to that Phase. |

## Method limitations (stated in full)

1. **The lint control could not be run in place** (oxlint has no stdin; `.specdev/**` matches no override glob). Substituted with the forced-rule non-vacuity control; see §Evidence detail.
2. **The probe runs from outside the repo test tree** and was copied in/out for each run; the copy was deleted immediately after, and the count-difference method is the proof that its 16 cases executed (self-reported "16 passed" would not have been enough).
3. **Baseline instruments were re-created, not reused**: the round-2 `/tmp` captures (`/tmp/p2-baseline-*.txt`, `/tmp/p2r2-lint-norm.txt`) no longer exist. I therefore (a) re-measured a fresh round-A baseline myself and (b) cross-checked it against the constant invariants recorded in `.cursor/skills/project-test/SKILL.md` (411 tests / 6 red; 47 files / 404 passed without a probe). Both agree — the failure set is identical to round 2's, and the counts reproduce exactly.
4. **Semantics were verified at the unit/integration level, not by observing a real VS Code window.** For a non-UI Phase whose external behaviour is diagnostics content, round 2's AC evidence (field-level assertions on records, real subprocesses) is the appropriate instrument; the four fixes are pure refactors and are additionally covered by my probes on the real classes.
5. I did **not** re-derive AC-13 – AC-22 from scratch, per the assignment: this round's object is (i) equivalence of the 4 fixes, (ii) that round 2's verified end-to-end paths still pass, (iii) independent re-checking of the gates. Categories (i)–(iii) are all evidenced above.

## Pipeline compliance check

| Check | Result |
|---|---|
| Branch | ✅ `impl-phase-2-host-fail-loud-diagnostics` — `git branch --show-current` measured, matches `current_phase` |
| All product changes inside `impl-*` | ✅ staged set under `apps/` + `packages/` is the Phase-2 change set; no product file was modified outside the branch |
| Did the verifier modify product code? | ✅ **no** — `git diff --stat -- apps/ packages/` is empty after all runs; the only files I created are this report, its `-zh` twin, and my scripts under `test-scripts/` |
| Any git write/restore command run? | ✅ **none** — only read-only `git branch/show/diff/status/log`. No `add`, no `commit`, no `reset/checkout/clean/restore/stash`. |
| Probe residue | ✅ none — `git status -s -- apps/vscode-dsh/tests/` shows exactly the 4 expected entries |
| `current-status.json` touched? | ✅ no (status transitions are the orchestrator's job) |
| Temporary mutations | ✅ none performed — no product file was edited, so no restore was needed |

## Verification scripts

All on disk under `.specdev/specs/vscode-dsh-usable-loop/phases/phase-2-host-fail-loud-diagnostics/test-scripts/`:

| Script | Purpose | How to run |
|---|---|---|
| `verifier-ast-static-phase3.ts` | 20 static AST checks on the three edited files (old forms gone, new forms exact, `this`-free method, arrow-paren neutrality) | `node_modules/.bin/tsx <script>` — runs in place, touches nothing |
| `verifier-independent-phase3.spec.ts` | 16 behavioural probes (S1–S5): orchestrator retry tail, coordinator insertion (188 real-class shapes + 512-form superset), the edited helper call sites with a mutation control, the AC-22 record chain, the 18-field read surface and a real `activate()` | copy into `apps/vscode-dsh/tests/`, `pnpm exec vitest run apps/vscode-dsh/tests/verifier-independent-phase3.spec.ts [--reporter=verbose]`, then delete |
| `verifier-lint-control-phase3.ts` | Pre-fix-shaped code kept as a lint positive control for future rounds | ⚠️ Must be copied **into an override glob** (e.g. `scripts/`) before linting — a copy under `.specdev/` is in scope for no rule and will always read clean (see the file header) |

Reproduce this round's gate evidence:

```bash
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH   # v20.16.0 on the default PATH fails with a misleading `Failed to import module "unrun"`
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness

# gate 1 — staged lint on the 3 changed files (expect exit 0)
node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern \
  apps/vscode-dsh/src/auto-start-orchestrator.ts \
  apps/vscode-dsh/src/interaction-coordinator.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts

# gate 1b — non-vacuity: same wrapper/config/files, one rule forced on (expect 3/9/1 diagnostics, exit 1)
node_modules/.bin/tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --no-error-on-unmatched-pattern \
  --deny no-magic-numbers \
  apps/vscode-dsh/src/auto-start-orchestrator.ts \
  apps/vscode-dsh/src/interaction-coordinator.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts

# gate 2 / 3 / 4 / 5
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false exec vitest run \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/host-diagnostics.spec.ts \
  apps/vscode-dsh/tests/session-host.spec.ts
pnpm --config.verify-deps-before-run=false run test apps/vscode-dsh                    # round A: 411 tests, 6 red
# round B: copy the probe into apps/vscode-dsh/tests/ first, then the same command → 427 tests, 6 red, +16 passed
```

## Bottom line for HG-3

- Round 2's PASS **stands** after this change; nothing in this round invalidates it.
- No new failure, no AC regression, no product file touched by me, no gate red that was green before.
- `ui: false` confirmed at `phase-plan.md:74` → visual validation N/A; no `visual-blocking` item.
- The only items needing a human decision are the 3 documentation-only SHOULD-FIX items (§Out-of-scope), which are yours to dispose of.
