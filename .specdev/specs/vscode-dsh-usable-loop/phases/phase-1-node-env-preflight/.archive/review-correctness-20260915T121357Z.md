# Correctness Review — Phase 1 (round 2, rework round 1)

## Perspective

**Implementation Correctness** — does the code actually work? Function bodies, real subprocess behavior,
acceptance-criteria mapping, boundary and error paths, side effects. Design consistency
(`reviewer-design`) and integration connectivity (`reviewer-connectivity`) are out of scope here.

## Verdict

**SHOULD-FIX** — all three blocking items of the previous round (**M1**, **M2**) and all ten
should-fix items (**S1–S10**) are **CONFIRMED-FIXED** by first-hand reading of the changed function
bodies, documents and tests, plus a fresh run of every acceptance command. No acceptance criterion is
unmet, no unregistered stub exists, and no functional regression was reproduced: the four red
app-suite files and six failing cases are the same set as the v8 baseline, and both green baselines
(`typecheck`, `packages/sdk/client`) stay at exit 0.

One **new** evidence-strength finding (**N1**) does not fail an AC but leaves AC-1(b) weaker than the
verification strategy its own spec prescribes, so the verdict is SHOULD-FIX rather than PASS.

Self-cleaning step 0: the previous `review-correctness.md` and `review-correctness-zh.md` existed in
the phase directory and were archived by this agent before any new content was written:

```
$ mv $PHASE_DIR/review-correctness.md    $PHASE_DIR/.archive/review-correctness-20260915T103350Z.md
$ mv $PHASE_DIR/review-correctness-zh.md $PHASE_DIR/.archive/review-correctness-zh-20260915T103350Z.md
```

Only those two files were touched; no `git` command was run and `current-status.json` was not modified.

## Independent reproduction

Branch confirmed first: `git branch --show-current` → `impl-phase-1-node-env-preflight`.
All commands from `/workspace/chendecheng/code/need/deepseek/deepseek-harness` with
`export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` and
`PNPM="pnpm --config.verify-deps-before-run=false"`.

**(1) Focused suites — matches the claim exactly.**

```
$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts
→ Test Files  4 passed (4)
→      Tests  69 passed (69)          exit 0          [claim: 69 ✓]

$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts
→ Test Files  2 passed (2)   Tests 34 passed (34)     [27 + 7 ✓]

$PNPM run test packages/sdk/client
→ Test Files  3 passed (3)   Tests 84 passed (84)     [baseline 73 + 11 ✓]
```

**(2) `typecheck` — baseline green, unchanged.** `$PNPM run typecheck` → exit 0.

**(3) App + SDK regression — identical failing set to the v8 baseline.**

```
$PNPM run test apps/vscode-dsh packages/sdk/client
→ Test Files  4 failed | 49 passed (53)
→      Tests  6 failed | 434 passed | 1 skipped (441)     exit 1
```

Failing cases, none in a file this phase touches: `spike-t0b-continue-capability.spec.ts` (whole
suite), `panel-close-delete.e2e.spec.ts` (1), `spike-t0a-replay-rebuild.spec.ts` (4: AC-30/47, AC-76,
AC-77, AC-80), `verifier-phase1/layer-a-rtl.spec.tsx` V-A4 (1). Exactly `spec.md:80`'s baseline
(4 files / 6 cases, root cause `scripts/test-invariants.ts:188`), and exactly the `53 files / 441
cases / 434 passed / 1 skipped` line `implementation.md` §4.1 claims.

**(4) Lint delta — the gate measurement, and my round-1 figure was the wrong one.**

I ran the real gate (`$PNPM run lint` → `tsx scripts/run-oxlint.ts .`) and counted per file:

```
lint exit=1; 12681 output lines; 10382 diagnostic lines across 263 files   [§4.3 claims 10382 / 263 ✓]

    0  apps/vscode-dsh/src/node-env-guard.ts               (new file)
    0  apps/vscode-dsh/tests/node-env-guard.spec.ts        (new file)
    0  apps/vscode-dsh/tests/session-host-preflight.spec.ts(new file)
    0  apps/vscode-dsh/package.json
    0  packages/sdk/client/src/{launch,types,index}.ts, tests/launch.spec.ts
    1  apps/vscode-dsh/src/session-host.ts      :595:3   typescript(require-await)
    1  apps/vscode-dsh/src/auto-start-orchestrator.ts :230:24 typescript(no-non-null-assertion)
    1  apps/vscode-dsh/src/index.ts             :97:3    typescript(no-deprecated)
    4  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts  52,53,95,96 (pre-existing mockPort helper)
   22  apps/vscode-dsh/src/extension.ts        271,375,380,385,407,425,662,750,1004,1102,1152,
                                               1418,1450,1492,1534,1791,2109×2,2110,2111,2270,2272
```

Every one of those lines is outside the added ranges. `git diff -U0` gives pure-insertion hunks for
`extension.ts` (`+48`, `+223,14`, `+2172,19`, `+2253`, `+2256`), for `auto-start-orchestrator.ts`
(`+26,30`, and the replacement at `+220`, which displaces but does not author `:230`), and for
`session-host.ts` (`+14`, `+16`, `+27`, `+29`, `+42,38`, `+106,4`, `+253,2`, `+285,6`, `+300`,
`+321,7`) — none contains `:595`. Zero new diagnostics, measured.

**Correction to my own previous report.** Item S3 of the merged round-1 report recorded my figure of
"3 diagnostics in `extension.ts`". That figure is reproducible only under the reduced rule set:

```
$PNPM exec tsx scripts/run-oxlint.ts apps/vscode-dsh/src/extension.ts                    → 22
$PNPM exec tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json <same file>          →  3  (2109:1, 2110:1, 2111:1)
```

The implementer's §4.3 table is therefore *more* accurate than my round-1 finding, and their
deliberate difference #2 (correct rather than adopt the review's number) is **upheld**. Related
measurement artifact worth recording: invoking the runner on a *single test file* inflates
type-aware diagnostics (`node-env-guard.spec.ts` → 109, `session-host-preflight.spec.ts` → 96) because
`apps/vscode-dsh/tsconfig.json` includes only `src`; in the full-corpus gate those two files report 0
and are absent from the output entirely, while other `apps/vscode-dsh/tests/**` files are present
(`spike-t0a-replay-rebuild.spec.ts` 173, `phase2-auto-ready.spec.ts` 15, …). The gate number is the
acceptance currency and it is 0 for both new spec files.

**(5) Documentation gates — same tally, and no phase file in any violation list.**

```
$PNPM run test:docs → exit 1, run-gates: 10 passed, 5 failed, 0 skipped
failing gates: markdown links | translation pairing | markdown wrap | agent note format | documentation standard tests
$ grep -icE "development(\.zh)?\.md|sdk/client/README" <docs gate output>  → 0
```

The pairing violations listed are `docs/wiki/**` (Chinese-only pages, ~30), `apps/vscode-dsh/README.md`,
`apps/vscode-dsh/tests/fixtures/screenshots/README.md`, `packages/README.*`, `packages/sdk/server/README.*`
and the `2026-09-04-ide-profile-dual-channel.md` note — matching `spec.md:98`'s baseline list. Neither
`docs/development.md` / `.zh.md` nor `packages/sdk/client/README.md` / `.zh.md` appears. The pairing
records verify against the working tree:

```
$ git hash-object docs/development.md docs/development.zh.md
32be857e74680f7631e85dcb7ed9fe21595e8111     # record: 32be857e74680f7631e85dcb7ed9fe21595e8111 ✓
821d84beefd40770ca4f5583a1aaeab64672432b     # record: 821d84beefd40770ca4f5583a1aaeab64672432b ✓
```

## Adjudication of the 13 round-1 items

| # | Item | Verdict | First-hand evidence |
|---|---|:--:|---|
| **M1** | AC-3(d) needed decidable tokens in the reload entry | **CONFIRMED-FIXED** | `docs/development.md:131` now reads "…run `Developer: Reload Window` (`workbench.action.reloadWindow`) from the Command Palette. The extension reads the setting on every start and does not cache it."; `docs/development.zh.md:136` carries the same four tokens. `DECIDABLE_ENTRY_TOKENS` now contains `workbench.action.reloadWindow` and the per-entry loop requires a token for every `- ` line under both checklist sections in both languages. |
| **M2** | `node-environment` flattened to `process-failed` at the orchestrator hop | **CONFIRMED-FIXED** | `START_ERROR_KINDS = ['missing-credentials','node-environment','process-failed']` (`auto-start-orchestrator.ts:27`); `startErrorKindOf` (`:47-55`) is the **only** writer of `this.errorKind` on the catch path (`:220`) and returns `process-failed` only for an unrecognised/absent `kind`; `HostStartErrorKind = StartErrorKind` (`session-host.ts:51`); the generic catch-all throws `process-failed` (`:327`). `'start-failed'` has zero hits anywhere under `apps/` and `packages/`. Runtime proof: `auto-start-orchestrator.spec.ts:150-164` throws the **real** `HostStartError('node-environment', …)` through the port and asserts `snapshot.errorKind === 'node-environment'`; `node-env-guard.spec.ts:648-671` drives a real `activate()` whose `settings.json` names a missing path and asserts `snapshot.errorKind === 'node-environment'` (`:666`). Both pass. |
| **S1** | AC-4 fixture payload named `zstd`/`withResolvers` | **CONFIRMED-FIXED** | `implementation.md` §3 AC-4 row and §2 use `hasZstd`/`hasWithResolvers`, matching `node-env-guard.ts:279-281` and the fixtures at `node-env-guard.spec.ts:56,286-299` and `session-host-preflight.spec.ts:80`. |
| **S2** | `process-exec-path` remedy proposed a `PATH` change | **CONFIRMED-FIXED** | `node-env-guard.ts:200` names the executable's real owner plus the two configuration levers; `PATH` is absent from every rendered diagnostic. `node-env-guard.spec.ts:415-417` asserts the third tier's message contains `this is the Extension Host's own Node.js executable, so set DSH_NODE_BIN` and does **not** contain `PATH`. |
| **S3** | lint numbers unverifiable | **CONFIRMED-FIXED** (and my round-1 number was wrong — see (4)) | Measured 10382 / 263 and the whole per-file table reproduces; §4.3 now states both commands and both values. |
| **S4** | `scope` / `markdownDescription` unrecorded | **CONFIRMED-FIXED** | `implementation.md` §5.10 records both keys with the `machine-overridable` rationale; `package.json:60-66` contains them. |
| **S5** | "not cached across starts" was unfalsifiable | **CONFIRMED-FIXED** | `node-env-guard.spec.ts:629-646` writes a real `settings.json` with `first-node`, starts, rewrites the file to `second-node`, starts again, and asserts the second snapshot's message contains `second` and **not** `first`. The value is load-bearing: `readNodeBinSetting` (`extension.ts:2179-2189`) has no cache and is called inside `createStartHostPort().start` per start (`:2253`), and a cached value *or* a cached resolution would still report `first`. Stronger than the round-1 suggestion (it also falsifies a cached file read). |
| **S6** | AC-3(a)(b) had no executable assertion | **CONFIRMED-FIXED** | `assertChecklistStructure` (`node-env-guard.spec.ts:151-165`) requires each of the four titles exactly once and every local-environment entry to carry one of seven decidable tokens; `:474-499` runs it against both language files and then deletes each face title from the in-memory text and requires the *same* assertion to throw (`:486-492`). Execution evidence: 27/27 cases green, and the deletion path is exercised on every run. |
| **S7** | "declared once" vs an `EXPECTED_NODE_RANGE` copy | **CONFIRMED-FIXED** | `docs/development.md:105`: "The floor has one owner, `engines.node` in the root `package.json`, which the extension mirrors in the range it enforces and a test keeps equal to that field"; `development.zh.md:110` says the same. `node-env-guard.spec.ts:444-447` is the test that keeps the copy equal. |
| **S8** | setting → host routing decision unrecorded | **CONFIRMED-FIXED** | `implementation.md` §5.11 with three reasons; code at `extension.ts:2253-2256` (`readNodeBinSetting(user)` → `start({ cwd, nodeBinSetting, credentials })`) and the option declaration at `session-host.ts:108-109`. |
| **S9** | probe ignored `ELECTRON_RUN_AS_NODE` | **CONFIRMED-FIXED** | `probeNodeApis(executable)` (`node-env-guard.ts:254-264`) builds `{...process.env}` and sets `ELECTRON_RUN_AS_NODE='1'` iff `executable.electronRunAsNode`, then passes `env` to `execFileAsync`; the caller at `:131` passes the resolved object. `node-env-guard.spec.ts:240-267` uses a shim that behaves as Node only under the flag and asserts `ok:true` with it and `unusable` without it — red in either direction. |
| **S10** | "Phase 2 diagnostic injection point" unrecorded | **CONFIRMED-FIXED** | `implementation.md` §5.12 names the three existing typed surfaces — `IdeSessionHost.onError` (`session-host.ts:195`), `AutoStartOrchestrator.getSnapshot()/onChange`, `HostStartError{kind,diagnostic}` (`:57-77`) — and states that no new sink type is added. I verified all three exist with those signatures. |

**The three self-reported deliberate differences** (`implementation.md` §1.3):

1. *Keeping `process-failed` as the single generic member* — **upheld.** M2 forbids a universal
   `'start-failed'` class, and that name is gone. `process-failed` is required by an **approved**
   downstream spec: Phase 2 `spec.md:61` pins "未知错误必须落到记录 `kind === 'other'`（对应
   orchestrator 的 `errorKind === 'process-failed'`）". Removing it would break Phase 2.
2. *Correcting S3's figure instead of adopting it* — **upheld**; my round-1 number came from the
   reduced rule set (see (4)).
3. *S5 satisfied by rewriting a real `settings.json`* — **upheld**; strictly stronger than the
   suggested double mutation (it also falsifies a cached file read).

## New findings

### N1 — AC-1(b)'s automated case does not locate the pinned release, so it cannot report the "pinned version absent" outcome the spec requires 🟡 Should-Fix

* **Location**: `apps/vscode-dsh/tests/node-env-guard.spec.ts:449-461`
  (`pins exactly one machine-readable version that the declared range admits (AC-1 a, b)`).
* **Spec requirement**: `spec.md:43` item (b) requires locating an install of the `.nvmrc` version in
  `/usr/local/n/versions/node/<v>`, `~/.nvm/versions/node/v<v>` or `command -v node`, calling
  `validateNodeEnvironment` on **that located interpreter**, and — when no such install exists —
  ending non-PASS with "本机无该版本安装" recorded rather than counting the check as passed.
* **What the code does instead**: after the two structural assertions it validates `process.execPath`
  (`:455-460`). Nothing asserts that the validated interpreter's reported version equals the pinned
  version, and no candidate root is searched. The assertion therefore passes on any machine whose
  test runner is *some* API-complete Node, including one where 24.3.0 is not installed at all — which
  is precisely the state item (b) exists to detect.
* **Why it matters**: AC-1 itself holds (`.nvmrc` = `24.3.0`, `grep -cE '^[0-9]+\.[0-9]+\.[0-9]+$' .nvmrc`
  → 1, `rangeAdmits('^22.19.0 || >=24.0.0','24.3.0')` true, `engines.node` identical to
  `EXPECTED_NODE_RANGE`), and `implementation.md` §4.5 records the missing real-machine probe
  (`/usr/local/n/versions/node/24.3.0/bin/node` → `ok:true`) as a manual measurement. The gap is that
  the *executable* case does not encode it, so the phase's AC-1(b) evidence rests on a report line
  rather than on an assertion.
* **Suggested fix (one assertion)**: capture the report and assert
  `validation.report.version === pinned`; if the locate step is also wanted as an assertion, walk the
  three roots for `pinned` and `expect(located).toBeDefined()` so an absent install fails loudly
  instead of silently passing.

## Stub detection

**Registered stubs (cross-checked against `tech-debt-registry.md`)**

| Registry ID | File:function | State | Note |
|---|---|:--:|---|
| `DEBT-004` | `packages/specdev/specdev-presets/src/tool-policy.ts` | ⚠️ Known, unrelated | 🟡 non-blocking, target = a future preset-strategy workflow; Phase 1 touches no file under `packages/specdev/**` (`git status` confirms). Not this phase's obligation. |
| `DEBT-001` | — | resolved | In the registry's 已解决 table, resolved by this phase's AD-9 reversal. |

**Newly found unregistered stubs**: none.

```
$ grep -nE "@STUB|TODO|FIXME|XXX|not implemented|placeholder" node-env-guard.ts session-host.ts \
    auto-start-orchestrator.ts extension.ts launch.ts types.ts   → 0 matches
$ grep -c "@STUB" <the four phase source files>                  → 0,0,0,0
```

Every function body I read executes real logic: `validateNodeEnvironment` does `stat` + `X_OK` then a
real `execFile` subprocess probe then a capability diff; `probeNodeApis` builds an explicit
environment and parses a narrowed report; `startErrorKindOf` scans a real vocabulary array;
`resolveNodeExecutableSpec` reads two real inputs and `process.versions.electron`; `readNodeBinSetting`
reads the real configuration accessor and throws on a non-string. No `(void)args`, no `return Ok(0)`,
no empty `catch` that swallows a classified failure (the two empty `catch` bodies in
`auto-start-orchestrator.ts:254` and `session-host.ts` listeners name what they swallow and cannot
hide a start failure — the failure path is outside them).

## Accept-by-AC verification

| AC | Implementation | Runtime evidence (mine) | Verdict |
|---|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0` (one line, trailing newline); root `engines.node` = `EXPECTED_NODE_RANGE` | `grep -cE '^[0-9]+\.[0-9]+\.[0-9]+$' .nvmrc` → 1; spec case `:444-447` (engines ≡ enforced range), `:449-461` (range admits the pin; `process.execPath` reports `ok:true`); docs name `.nvmrc` + pin in both languages (`:463-471`) | ✅ (evidence strength → N1) |
| AC-2 | `docs/development.md:105` / `.zh.md:110` | Both files read directly: floor, `engines.node` owner, both APIs, `.jsonl.zstd` linkage | ✅ |
| AC-3 | `docs/development.md:109-131` / `.zh.md:114-136` | `:474-499` executable structure assertions + per-face deletion falsification, both languages, green | ✅ |
| AC-4 | `validateNodeEnvironment` (`node-env-guard.ts:115-147`), called at `session-host.ts:290` before `bridge.listen` (`:291`) | `node-env-guard.spec.ts` 27 green incl. `missing`/`not-executable`/`missing-apis`/`unusable`/positive; `session-host-preflight.spec.ts` spawn count 0 exactly observed via absent witness file + absent socket + `<5s` while `initializeTimeoutMs` is 60 000 | ✅ |
| AC-5 | `launch.ts:132-135` env first, `:136-139` setting, `:140-144` `process.execPath` | `launch.spec.ts:232-247` (env wins over a non-empty setting, and over the Electron tier), `:269-273`; `session-host-preflight.spec.ts:263-326` (real shim ran; env outranks setting) | ✅ |
| AC-6 | tier 3 = `process.execPath`; `electronRunAsNode` only for that source under Electron | `launch.spec.ts:289-297` (`ELECTRON_RUN_AS_NODE === '1'`), `:299-314` (a `PATH`-shadowing shim proves resolution does **not** consult `PATH`: `which node` resolves to the shim and the spec still returns `process.execPath`) | ✅ |
| AC-7 | `session-host.ts:287-291` order resolve → gate → listen, then spawn | `session-host-preflight.spec.ts:124-153` (reject `kind==='node-environment'`, `status==='error'`, no witness, no socket, `<5s`), `:155-202` (setting source, exactly 1 resolution via spy), `:204-261`, `:305-326` | ✅ |
| AC-8 | `formatNodeEnvironmentDiagnostics` (`node-env-guard.ts:167-176`) renders exactly 5 lines | `node-env-guard.spec.ts:355-383` (path, version, both range windows, both API names, both levers, 5 lines), `:420-442` (four kinds → four distinct 5-line messages); `session-host-preflight.spec.ts:189-200` asserts all five elements on the real rejected start | ✅ |
| AC-9 | first line `Node environment check failed — source: …`; carriers `NodeEnvironmentError` / `HostStartError{kind:'node-environment'}`; class reaches the snapshot | `:380-382` (first line contains `Node environment`, no `/dsh bug|internal error|defect|broken/i`), `session-host-preflight.spec.ts:192`, and the hop assertions at `auto-start-orchestrator.spec.ts:162` and `node-env-guard.spec.ts:666` | ✅ |
| AC-10 | (a) `package.json:60-66`; (b) `development.md:107` / `.zh.md:112`; (c)(d)(e) code + tests | (a) `:504-517`; (b) files read directly; (c) `launch.spec.ts:249-267`; (d) `session-host-preflight.spec.ts:155-202` (`missing` and `missing-apis` from the setting, 1 resolution, no spawn) + `node-env-guard.spec.ts:648-671` (real `activate()`, `settings.json` byte-identical after the run); (e) `:584-686` (read per start, empty passed through, re-read not cached, non-string fails loud **before** `IdeSessionHost.start` — `startSpy` not called) | ✅ for (a)–(e); (f) is Phase 3 by design and is registered as a cross-phase dependency in `implementation.md` §3 |

AD-1 invariant (read, not assumed): `session-host.ts:287-289` mints the object → `:290`
`assertNodeExecutable(nodeExecutable)` → `:300` the *same binding* goes to `HarnessClient` →
`launch.ts:177,184` `options.nodeExecutable.path` becomes `command`. AD-2 holds: no version
comparison branch exists in the guard, and `unsupported-version` / `nodeVersionSupported` have zero
hits.

## Unverified

* **Mutation-based falsification of M2.** I attempted an out-of-tree mutation harness (copy of
  `auto-start-orchestrator.ts` with `node-environment` removed from `START_ERROR_KINDS`, driven by an
  inline probe) and the review sandbox blocked it as an unauthorized out-of-tree harness. The
  falsifiability therefore rests on (i) reading the 9-line classifier, which is the sole writer of
  `errorKind` on the catch path and returns `process-failed` for any kind outside the array, and
  (ii) the passing assertion that throws the **real** `HostStartError('node-environment')` through the
  real port. UNVERIFIED as an executed mutation; the code read is unambiguous.
* **`unusable` timeout branch.** Inducing the 10 s probe timeout needs a long-running fixture and was
  not exercised; the exit-code and non-report branches are. `implementation.md` §6.5 records the same
  limitation.
* **Real Extension Development Host, tier 3** (`process.exec-path` with no setting and no
  `DSH_NODE_BIN`) — Phase 3's remit, and its smoke presets `dsh.nodeBin`, so tier 3 stays uncovered
  there as well (carried over from round 1 as a Phase 3/4 registration item).
* **`$PNPM run doc-sync`** was not run: `spec.md:100` assigns the first `test:docs` pass to this phase
  and reserves `doc-sync` for Phase 4. `test:docs` was run and its tally matches the baseline.

## Discrepancies with `implementation.md` (round 2)

None that change a verdict. Two wording notes: §4.3's per-file table reproduces exactly under the gate
command, but the same runner applied to a single test file inflates type-aware diagnostics
(109 / 96) — worth a parenthetical if that table is ever re-measured file-by-file; and §4.5's
`/usr/bin/node` row reports 18.12.1 while §4.5's `env -i PATH=/usr/bin:/bin` probe also reports
18.12.1, consistent with each other. The AC-4 row now uses the probe's real field names (S1 ✓).

No escalation items: this is the workflow's first phase, so nothing I found can affect a completed
upstream phase, and the three escalation triggers (untestable AC, 3+ unregistered stubs, conflicting
ACs) do not apply — one unregistered stub would be required for the second, and none exists.
