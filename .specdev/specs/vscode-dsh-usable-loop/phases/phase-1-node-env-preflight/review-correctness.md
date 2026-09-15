# Correctness Review — Phase 1 (round 3, rework round 2)

## Perspective

**Implementation Correctness** — does the code actually work? Function bodies, real subprocess
behaviour, acceptance-criteria mapping, boundary and error paths, side effects. Design consistency
(`reviewer-design`) and integration connectivity (`reviewer-connectivity`) are out of scope here.

## Verdict

**SHOULD-FIX** — all three rework items (**D-1**, **D-2**, **N1**) are **CONFIRMED-FIXED** by
first-hand reading of the changed function bodies, the three call chains, the documents and the tests,
plus a fresh run of every acceptance command. No acceptance criterion is unmet and no unregistered
stub exists. The differential gate is clean: `typecheck` exit 0, `packages/sdk/client` green, the app
suite red with exactly the baseline 4 files / 6 cases, `test:docs` 10 passed / 5 failed with this
phase's documented pair absent from every violation list, and `lint` 10 382 diagnostics across 263
files with **zero** diagnostics on any line this phase added — the same metrics as before the rework.

The verdict is SHOULD-FIX rather than PASS for one **new** item (**N3.1**) that fails no AC: the
`AC-1(b)` case hands the located interpreter to `validateNodeEnvironment` with
`source: 'process-exec-path'`, although the located interpreter is not `process.execPath`. I traced the
field's consumers and the mislabel is inert on this case's pass path, but it would misdescribe the
failure if a located interpreter ever failed the pre-flight. It is a label-accuracy defect, not a
behavioural one, so it is SHOULD-FIX and **does not justify another rework round**: nothing routes back
to the implementer for it, and HG-3 may proceed with this finding recorded.

Branch confirmed before any work: `git branch --show-current` → `impl-phase-1-node-env-preflight`.

Self-cleaning step 0: the previous `review-correctness.md` and `review-correctness-zh.md` existed in
the phase directory and were archived by this agent before any new content was written:

```
$ PHASE_DIR=.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight
$ mv $PHASE_DIR/review-correctness.md    $PHASE_DIR/.archive/review-correctness-20260915T121357Z.md
$ mv $PHASE_DIR/review-correctness-zh.md $PHASE_DIR/.archive/review-correctness-zh-20260915T121357Z.md
```

Only those two files were touched. **No `git` command was run in this review** (the `git` calls below
are read-only inspections the workflow itself prescribes), and `current-status.json` was not modified.

## Adjudication of D-1 / D-2 / N1

### D-1 — review item codes cleared, `AD-*` references kept: **CONFIRMED-FIXED** ✅

The item's own probe returns nothing:

```
$ grep -rnE '\((S[0-9]+|M[0-9]+)[,)]|// *(S|M)[0-9]+:' apps/vscode-dsh/
(no output; exit 1)
```

The four named sites, read at their current line numbers:

| Site | Current text | Judgement |
|---|---|:--:|
| `node-env-guard.spec.ts:267` | `it('probes a process-exec-path candidate in the Electron mode the spawn will use', …)` | `(S9)` gone ✅ |
| `node-env-guard.spec.ts:685` | `it('re-reads the setting on every start instead of caching the first value (AD-9)', …)` | `S5` gone, `AD-9` **kept** ✅ |
| `node-env-guard.spec.ts:699` | `// A cached resolution or setting value would still report the first path here.` | `// M2:` gone ✅ |
| `auto-start-orchestrator.spec.ts:144` | `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4)', …)` | `M2` gone, `AD-4` **kept** ✅ |

The reverse direction is intact — `AD-*` was not collaterally deleted:

```
$ grep -rnE 'AD-[0-9]+' apps/vscode-dsh/src/*.ts apps/vscode-dsh/tests/*.ts
auto-start-orchestrator.ts:38 (AD-4)   extension.ts:224 / :2173 (AD-10)
session-host.ts:51 / :108 (AD-4 / AD-1)   node-env-guard.ts:111 / :152 / :250 (AD-2 / AD-1 / AD-1)
auto-start-orchestrator.spec.ts:14 / :144 (AD-4)   node-env-guard.spec.ts:216 (AD-2) / :685 (AD-9)
```

**Residue I did find, and why it is not a violation.** A wider scan surfaces `AC-S1` / `AC-S2` /
`AC-S3` in `tests/spike-attribution-snapshot.spec.ts:3,30,90,152` and
`tests/spike-attribution-helpers.ts:73`. Those are acceptance-criteria identifiers of the separate
`Spike phase-0` spec (`describe('Spike phase-0 — AC-S1 attribution via meta.diffs')`), not review item
codes, and they live in files this phase never touched (`git diff --stat` lists neither). Item D-1
targets `S*`/`M*` *review* codes from this workflow's reports; `AC-S*` is an AC namespace, the same
kind of citable contract as `AD-*`. Nothing to fix.

`grep -rnE 'review (item|round)|round [0-9]|must-fix|should-fix'` over `apps/vscode-dsh/src` and
`tests` → **0 matches**, so no other review-history vocabulary was left behind.

### D-2 — `invalid-setting` for a non-string `dsh.nodeBin`: **CONFIRMED-FIXED** ✅

**(1) The class really travels from `readNodeBinSetting` to the orchestrator snapshot.** I traced every
hop instead of trusting the summary:

```
extension.ts:2184-2189   typeof value !== 'string' → throw new HostStartError('invalid-setting', …)
extension.ts:2253        try {                                  ← the throw is inside this try
extension.ts:2255          const nodeBinSetting = readNodeBinSetting(vscode)   ← throws here
extension.ts:2256          await next.start({ cwd, … })                     ← never reached
extension.ts:2278-2280   } catch { … throw error instanceof Error ? error : … }   ← instance preserved
auto-start-orchestrator.ts:213  await this.port.start(reason)     ← port.start rejects
auto-start-orchestrator.ts:226  this.errorKind = startErrorKindOf(error)
auto-start-orchestrator.ts:53-61  startErrorKindOf → membership scan → 'invalid-setting'
auto-start-orchestrator.ts:129  getSnapshot() → errorKind
```

`startErrorKindOf` is the **only** writer of `errorKind` on the catch path (`:226`); the other writer
(`:220`, `'process-failed'`) sits on the "start completed without a live connection" branch, which this
scenario cannot reach because `port.start` rejected. The test asserts the **snapshot**, not the text
(`node-env-guard.spec.ts:744`), and it executes:

```
$ pnpm run test apps/vscode-dsh/tests/node-env-guard.spec.ts --reporter=verbose
 ✓ … > extension reads dsh.nodeBin (AC-10 e) > classifies a non-string setting as invalid-setting, not a process failure 1ms
 Tests  28 passed (28)
```

**(2) `node-environment` is genuinely not reused.** `START_ERROR_KINDS` (`:27-32`) holds four distinct
members, and `HostStartError`'s `diagnostic` stays `undefined` for the new class (`session-host.ts:78`
copies `options.diagnostic`, which the `invalid-setting` construction omits). The invariant
"*Pre-flight diagnostic; present exactly when `kind` is `node-environment`*" (`session-host.ts:62`)
therefore still holds. I checked every reader of `.diagnostic` in this app — only
`session-host-preflight.spec.ts:180-182,222-223,254-256`, all inside `node-environment` scenarios. No
consumer assumes its presence for another class.

**(3) No switch lost exhaustiveness.** There is **no `switch` over `StartErrorKind` anywhere in the
repository**:

```
$ grep -rn "switch" apps/vscode-dsh/src --include=*.ts
connection-ui.ts:117   switch (snap.state)      ← StartOrchestratorState, not the kind union
extension.ts:1854      switch (gate.kind)       ← RevertGate, unrelated union
replay-hydrator.ts:252 switch (event.type)      ← session event type
```

`connection-ui.ts:134-138`'s `default:` is an **exhaustiveness assertion**, not a swallowing default:
`const _exhaustive: never = snap.state` fails to compile if a state member is added — and it guards
`StartOrchestratorState`, which this round did not change. The only consumer that branches on the kind
is an equality test, `connection-ui.ts:140`: `snap.errorKind === 'missing-credentials'`. With
`invalid-setting` this is `false`, so `settingsDeepLinkAvailable` is false and the `failed` phase
renders `snap.errorMessage` — correct: a wrong-typed `dsh.nodeBin` is not a credentials problem, and
the message the user sees is the specific "must be a path … got number" text. `typecheck` exit 0 is the
mechanical confirmation that no union member is left unhandled. `grep -rn "StartErrorKind"` outside
`apps/vscode-dsh` → no hits, so there is no missed consumer in `packages/**`.

**(4) The three word lists agree.** `auto-start-orchestrator.ts:34-42` (naming `node-environment`,
`invalid-setting`, `process-failed` as the generic member), `session-host.ts:42-52` (same three, with
the setting-value meaning), and `design.md:186` / `design-zh.md:187` ("…加本工作流新增的
`node-environment` 与 `invalid-setting`（Phase 1，`dsh.nodeBin` 取值类型错误）、以及 `spawn` /
`handshake-timeout` / `bridge-listen`（Phase 2）") are consistent in both languages. No fourth
vocabulary exists (`grep -rn "missing-credentials"` finds only `START_ERROR_KINDS`, the throw site in
the orchestrator, and tests).

**(5) The new assertion is genuinely falsifiable — with one unexecuted half.** The assertion is
`expect(snapshot.errorKind).toBe('invalid-setting')`, i.e. it demands a **specific non-generic** member.
Given (1), the value can only arise from (a) `'invalid-setting'` being present in `START_ERROR_KINDS`
**and** (b) the thrown carrier holding that `kind`. Removing either therefore makes the case red. I
verified half of that dynamically with an **existing in-repo case** that I ran:

```
auto-start-orchestrator.spec.ts:166-176
  throw new Error('spawn EBADF')  →  expect(orch.getSnapshot().errorKind).toBe('process-failed')   ✓ green
```

That is the executed proof that a `kind`-less carrier yields the generic member — i.e. the D-2
assertion cannot be satisfied by a bare `Error`, which is exactly the pre-fix code shape. The
complementary mutation (deleting the array member) I did **not** execute; see *Unverified* — the
sandbox rejects out-of-tree probe scripts, the same limitation round 2 recorded. The code read is
unambiguous either way: `startErrorKindOf` returns `process-failed` for any value outside the array.

**(6) No conflict with Phase 2.** Phase 2's spec expects to extend the same union — line 88 lists
`apps/vscode-dsh/src/auto-start-orchestrator.ts（StartErrorKind 扩展 + 读取校验过的 kind）`, and its
`spawn` / `handshake-timeout` / `bridge-listen` members are disjoint from `invalid-setting`. Phase 2
also depends on the generic member surviving (line 61: `kind === 'other'` for a record "对应
orchestrator 的 `errorKind === 'process-failed'`"), and it does — the implementer kept
`process-failed` and only removed the second umbrella class `'start-failed'` in round 1. Phase 2's
`HostFailureKind` is a separate type in a separate module and is untouched. Finally, `invalid-setting`
is thrown in `extension.ts` **before** `IdeSessionHost.start` is invoked, so it does not fall inside
Phase 2's "every failure during `start()` must produce a diagnostic record" scope.

### N1 — AC-1(b) three-location locator: **CONFIRMED-FIXED**, with one new SHOULD-FIX 🟡

**(1) The three locations exist and the version equality is really asserted.** The helpers are
`pinnedInstallRoots` (`:89-101`, `/usr/local/n/versions/node/<v>` and `~/.nvm/versions/node/v<v>`),
`nodeOnPath` (`:103-107`, `command -v node`) and `reportedVersion` (`:109-113`). The case asserts both:

```486:517:apps/vscode-dsh/tests/node-env-guard.spec.ts
    ctx.skip(
      located.length === 0,
      `no install of ${pinned} to locate; checked ${checked.join('; ')}`,
    )
    for (const { label, path } of located) {
      const validation = await validateNodeEnvironment({ path, source: 'process-exec-path', electronRunAsNode: false })
      expect(validation.ok, `${label} (${path}) was rejected by the pre-flight`).toBe(true)
      if (!validation.ok) continue
      expect(validation.report.version, label).toBe(pinned)
    }
```

`report.version === pinned` on a **successful** `ok` is stronger than the spec text, which asks only
for `ok:true` (`spec.md:43`). So the case proves *the pinned release* passes, not that *some* Node
passes.

**(2) The skip is not a permanent skip — it really executes here, and I measured why.** Verbose run
(literal line):

```
 ✓ |thread-safe| apps/vscode-dsh/tests/node-env-guard.spec.ts > node environment diagnostic (AC-8, AC-9)
   > locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) 53ms
```

I reproduced the locator's inputs independently:

```
$ P=$(tr -d '\n' < .nvmrc)        # 24.3.0, 7 bytes, one semver line, trailing newline
PRESENT /usr/local/n/versions/node/24.3.0/bin/node -> v24.3.0
ABSENT  /home/chendc/.nvm/versions/node/v24.3.0/bin/node
command -v node -> /usr/local/n/versions/node/24.3.0/bin/node ; version=v24.3.0
```

Three paths checked, **two located**, both validated by a real subprocess probe (53 ms is
consistent with two `execFile` probes, not with a constant read). The `ctx.skip` branch is not taken.

**(3) 🟡 SHOULD-FIX — `source: 'process-exec-path'` is a semantic mislabel, but inert.**

The located interpreter is not `process.execPath`. I traced what `source` can influence in
`validateNodeEnvironment` (`node-env-guard.ts`): `base.source` (:119), `base.sourceLabel` (:120) and
`nodeEnvironmentRemedy(executable.source)` (:125). Those three feed **only the rendered diagnostic**
(`sourceLabel` → first line, `remedy` → last line). No branch anywhere selects behaviour from
`source`:

- the probe mode is decided by a **separate** field: `if (executable.electronRunAsNode)
  environment.ELECTRON_RUN_AS_NODE = '1'` (`:258`);
- the case passes `electronRunAsNode: false` explicitly, so the Electron branch is off;
- on the pass path the returned object is `{ ok: true, report }` — no label is read.

The dedicated Electron case proves the fields are independent by flipping **only**
`electronRunAsNode` while holding `source: 'process-exec-path'` constant
(`node-env-guard.spec.ts:281-293`: `true` → `ok`, `false` → `failure.kind === 'unusable'`).

Consequence: **no validation-behaviour deviation, and no effect on AC-1 or any assertion.** The
inaccuracy is confined to the hypothetical failure path — if a located interpreter ever failed the
pre-flight, the message would read `source: the Extension Host Node.js process` and the remedy would
advise about the Extension Host's Node, which is wrong for an interpreter found under
`/usr/local/n/...` or on `PATH`. Nothing asserts that text today, so the case cannot pass or fail
incorrectly; a future reader could be misled by it. Two observations make the mislabel hard to avoid
entirely: `NodeExecutableSource` is a closed 3-member union with no member for "an interpreter found on
the machine", and `source` is a required field of `ResolvedNodeExecutable` — so the case must pick one
and all three are inexact. The honest minimum is a comment saying the value is nominal for this
locator (as the case already does for the PATH-hit rule at `:488-490`), or asserting on
`failure.executablePath` rather than trusting the source label. Not MUST-FIX: it changes no AC outcome
and no product behaviour.

**(4) `spec.md` AC-1 and `.nvmrc` are unmodified.** `spec.md:26` still carries AC-1's original
requirement text and `spec.md:43` still carries the three-location verification strategy *including*
"若三处均无该版本安装 → 以非 PASS 结束并在 `verification.md` 写明「本机无该版本安装」，**不得** 记为通过".
`.nvmrc` is `24.3.0` + newline, 7 bytes, exactly one semver line. The implementation is a strict
superset of the spec's requirement, not a weakening.

## Accept-by-AC verification

Every AC-1 – AC-10 still has executable evidence after the split; nothing regressed.

| AC | Implementation | Runtime evidence (mine) | Verdict |
|---|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0`; `EXPECTED_NODE_RANGE` ≡ root `engines.node` | (a) `:476-482` exactly one semver line + `rangeAdmits`; **executed**; (b) `:484-517` three roots, two located, each `ok:true` **and** `report.version === pinned` — **executed, 53 ms, not skipped**; (c) `:519-528` both docs; `:471-474` engines ≡ enforced range | ✅ |
| AC-2 | `docs/development.md` § *Node environment* (+ zh) | Both files read; floor, `engines.node` owner, both APIs, `.jsonl.zstd` linkage present | ✅ |
| AC-3 | Same section, two checklists, two faces | `:530-555` four titles + per-entry decidable token, plus the delete-a-face-title falsification that makes the same assertion throw — green | ✅ |
| AC-4 | `validateNodeEnvironment` (`node-env-guard.ts:115-147`), called at `session-host.ts:292` before `bridge.listen` (`:293`) | `:216-241` capability-vs-version cases; **forward coverage preserved by `:244-251` (`process.execPath`, `hasZstd`/`hasWithResolvers` both true)** — this is the assertion the split moved out of AC-1; `missing` / `not-executable` / `unusable` / `missing-apis`; `session-host-preflight.spec.ts` spawn count 0 | ✅ |
| AC-5 | `launch.ts` env first, then setting, then `process.execPath` | `launch.spec.ts` env-vs-setting precedence; `session-host-preflight.spec.ts` real shim ran | ✅ |
| AC-6 | tier 3 = `process.execPath`; `electronRunAsNode` only for that source under Electron | `launch.spec.ts` Electron + `PATH`-shadowing shim; `node-env-guard.spec.ts:281-293` proves the flag, not `source`, drives the mode | ✅ |
| AC-7 | `session-host.ts:286-330` order resolve → gate → `listen` → spawn; `:318-330` typed carriers | `session-host-preflight.spec.ts:146,178,221,253` (`kind === 'node-environment'`), no spawn, no socket, `status === 'error'`, elapsed < 5 000 ms | ✅ |
| AC-8 | `formatNodeEnvironmentDiagnostics` renders exactly 5 lines | `:447-469` (four kinds, 5 lines each, pairwise distinct), `:420-445` (both levers, no `PATH`), `session-host-preflight.spec.ts:189-200` | ✅ |
| AC-9 | first line `Node environment check failed — source: …`; carriers `NodeEnvironmentError` / `HostStartError{kind:'node-environment'}` | `:380-382` no defect attribution; hop asserted at `auto-start-orchestrator.spec.ts:162` and `node-env-guard.spec.ts:722`; non-Node classes now also survive (`invalid-setting` per D-2) | ✅ |
| AC-10 | (a) `package.json` `contributes.configuration`; (b) documented priority; (c)–(e) runtime | `:558-573` (type/default/description), `:640-663` (setting read + passed + file untouched), `:665-683` (empty preserved), `:685-702` (re-read, not cached), `:704-727` (unusable path fails loud, `errorKind === 'node-environment'`, file byte-identical), `:729-747` (**new** `invalid-setting` on the snapshot, `start` never called) | ✅ (a)–(e); (f) Phase 3 by design |
| Regression | see the gate block below | all five differential commands reproduce the baseline | ✅ |

AD-1 still holds by reading, not assumption: `session-host.ts:289-291` mints the object → `:292`
validates that binding → `:302` hands **the same binding** to `HarnessClient`, so the validated and the
spawned executable cannot diverge. AD-2 holds: no version-comparison branch exists
(`unsupported-version` / `nodeVersionSupported` have zero hits).

## Differential gates (real commands, real output)

Run from the repo root with `export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` and
`PNPM="pnpm --config.verify-deps-before-run=false"`.

| Command | Baseline | Mine | New failures |
|---|---|---|---|
| `$PNPM run typecheck` | green | **exit 0** (`tsc -b tsconfig.client.json`) | none |
| `$PNPM run test packages/sdk/client` | green, 3 files / 73 | **exit 0**, `Test Files 3 passed (3)`, `Tests 84 passed (84)` | none |
| `$PNPM run test apps/vscode-dsh packages/sdk/client` | 4 files / 6 cases red | **exit 1**, `Test Files 4 failed \| 49 passed (53)`, `Tests 6 failed \| 435 passed \| 1 skipped (442)` | none |
| `$PNPM run test:docs` | 10 passed / 5 failed | **exit 1**, `run-gates: 10 passed, 5 failed, 0 skipped`, same five gates | none |
| `$PNPM run lint` | red | **exit 1**, **10 382** diagnostics across **263** files | none (see below) |

The six red cases are the baseline's six, in the baseline's four files — none touched by this phase:
`spike-t0b-continue-capability.spec.ts` (whole suite), `panel-close-delete.e2e.spec.ts` (1),
`spike-t0a-replay-rebuild.spec.ts` (4: AC-30/47, AC-76, AC-77, AC-80),
`verifier-phase1/layer-a-rtl.spec.tsx` V-A4. The case total rose 441 → 442 because N1 split one case
into two.

Focused suites:

```
$ $PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts \
      apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
      apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts
 Test Files  4 passed (4)      Tests  70 passed (70)      exit 0

$ $PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts --reporter=verbose
 Tests  28 passed (28)        exit 0
```

`test:docs` names this phase's documented pair nowhere:

```
$ grep -cE 'docs/development\.(md|zh\.md)' <test:docs output>   → 0
$ grep -cE 'sdk/client/README'              <test:docs output>   → 0
$ grep -E '^  - FAILED'                     <test:docs output>
  - FAILED markdown links / translation pairing / markdown wrap / agent note format / documentation standard tests
```

The violations listed are `docs/wiki/**` Chinese-only pages, `apps/vscode-dsh/README.md`, its
screenshots fixture README, `packages/README.*`, `packages/sdk/server/README.*` and the
`2026-09-04-ide-profile-dual-channel.md` note — the same set `spec.md:98` records as pre-existing.

**Lint delta — zero on added lines, measured against `git diff -U0` added ranges.** The gate produced
`10 382` diagnostics / `263` files, identical to the implementer's §4.3 total and to the previous
round. Per file, and checked against every added range:

| File | Diagnostics | Added ranges (cumulative, `git diff -U0`) | On an added line? |
|---|---:|---|---|
| `node-env-guard.ts` (new) / `node-env-guard.spec.ts` (new) / `session-host-preflight.spec.ts` (new) | 0 / 0 / 0 | whole files | — |
| `auto-start-orchestrator.ts` | 1 — `:236:24` | `26-61`, `226` | no |
| `session-host.ts` | 1 — `:597:3` | `14`, `16`, `27`, `29`, `42-81`, `108-111`, `255-256`, `287-292`, `302`, `323-329` | no |
| `extension.ts` | 22 — `271, 375, 380, 385, 407, 425, 662, 750, 1004, 1102, 1152, 1418, 1450, 1492, 1534, 1791, 2109×3, 2110, 2111, 2272, 2274` | `34`, `48`, `223-236`, `2172-2192`, `2255`, `2258` | no |
| `index.ts` | 1 — `:97:3` | `25-39` | no |
| `auto-start-orchestrator.spec.ts` | 4 — `52, 53, 95, 96` | `8`, `12-15`, `143-177` | no |
| `phase1/2/4` duck-typed suites | 2 / 15 / 11 | `70-74`, `49-53`, `75-79` | no |
| `packages/sdk/client/{launch,types,index}.ts`, `tests/launch.spec.ts` | 0 | — | — |

## Stub detection

**Registered stubs (cross-checked against `tech-debt-registry.md`)**

| Registry ID | File:function | State | Note |
|---|---|:--:|---|
| `DEBT-004` | `packages/specdev/specdev-presets/src/tool-policy.ts` | ⚠️ Known, unrelated | 🟡 non-blocking; target = a later preset-strategy workflow. Phase 1 touches no file under `packages/specdev/**`. Not this phase's obligation. |

`DEBT-005` / `DEBT-006` / `DEBT-007` sit in the registry's 已解决 table as resolved by this round, and
**all three resolutions hold under first-hand inspection**: DEBT-005 by the D-1 scan above, DEBT-006 by
the traced chain and the passing snapshot assertion, DEBT-007 by the executed AC-1(b) case asserting
`report.version === pinned`. Moving them to 已解决 was correct, not premature.

**Newly found unregistered stubs: none.**

```
$ grep -nE "@STUB|TODO|FIXME|XXX|not implemented|placeholder" \
    node-env-guard.ts session-host.ts auto-start-orchestrator.ts node-env-guard.spec.ts \
    launch.ts types.ts   →  (0 matches)
```

Every function body I read executes real logic. `validateNodeEnvironment` does `stat` + `X_OK`, then a
real `execFile` probe, then a capability diff. `probeNodeApis` builds an explicit environment and
narrows the parsed report. `startErrorKindOf` scans a real vocabulary array. `readNodeBinSetting` reads
the real configuration accessor, distinguishes `undefined`/`null`, and throws a typed error on a
non-string. The two empty `catch` bodies (`auto-start-orchestrator.ts:260` listener isolation,
`extension.ts:2228`) name what they swallow and cannot hide a start failure (the failure path is
outside them).

## Key findings

### 🔴 Must-Fix

None. No acceptance criterion is unmet, no unregistered stub exists, no functional regression
reproduced, and no gate shows a new failure.

### 🟡 Should-Fix

- **N3.1 — `AC-1(b)` labels the located interpreter `source: 'process-exec-path'`** though it is not
  `process.execPath` (`node-env-guard.spec.ts:506-511`). Inert on this case's pass path, because
  `source` only feeds `sourceLabel`/`remedy` while the probe mode comes from the independent
  `electronRunAsNode` field (`node-env-guard.ts:119-125`, `:258`). It would mislabel the diagnostic if
  a located interpreter ever failed the pre-flight. One comment (or asserting on
  `failure.executablePath`) closes it. Not MUST-FIX and not a reason to rework the phase.

### 🟢 Observations

- `reportedVersion(onPath)` is evaluated twice for the PATH candidate (`:497` inside the note template,
  `:498` in the hit test), so the case spawns one extra `--version` probe per run. Harmless.
- On this machine the PATH location resolves to the *same* absolute path as the `n` root, so that
  interpreter is validated twice. Idempotent; the two-probe timing is what the 53 ms reflects.
- `expect(located.length).toBeGreaterThan(0)` (`:516`) is unreachable when `ctx.skip` fires, since the
  skip signal short-circuits. A harmless belt-and-braces line.
- `ctx.skip` writes the pinned version and all three checked paths into the case note, which satisfies
  the mechanical half of `spec.md:43`'s "end non-PASS and say so"; recording it in `verification.md`
  remains the verifier's obligation when the branch is taken. Not applicable on this machine.
- The registry's DEBT-007 note describes counterfactual probes against the **previous** revision's
  case form. That form no longer exists in the tree, so the counterfactual half is not
  re-derivable — the current form is verified directly and is strictly stronger.

## Unverified

- **Array-removal mutation for D-2.** I attempted an out-of-tree probe (a `/tmp` script importing
  `auto-start-orchestrator.ts` and driving it with synthetic carriers) and the sandbox rejected it as
  an unauthorized out-of-tree harness — the same limitation round 2 recorded; the probe file was
  deleted. The falsifiability therefore rests on (i) the traced sole-writer chain plus the membership
  array, and (ii) the **executed** in-repo case `auto-start-orchestrator.spec.ts:166-176` proving a
  `kind`-less carrier yields `process-failed`. The code read is unambiguous.
- **`unusable` timeout branch** (inducing the 10 s probe timeout needs a long-running fixture).
  `implementation.md` §6.5 records the same limitation.
- **Real Extension Development Host, tier 3** (`process-exec-path` with no setting and no
  `DSH_NODE_BIN`) — Phase 3's remit, carried over unchanged.
- **`$PNPM run doc-sync`** was not run: `spec.md:100` assigns the first `test:docs` pass to this phase
  and reserves `doc-sync` for Phase 4. `test:docs` was run and its tally matches the baseline.

## Discrepancies with `implementation.md` (round 3)

None that change a verdict. Three wording notes: §1.3's "no `switch` over `StartErrorKind` exists" is
correct, and I confirmed the `connection-ui.ts:134` `default:` is an exhaustiveness assertion rather
than a swallowing default; §4.2's `Tests 70 passed (70)` reproduces in the four-spec command but not
in the single-file verbose run (28), which is expected; and §4.3's `10 382` figure reproduces exactly
under the gate command (my run: `10 382` diagnostics across `263` files), though the raw output file is
12 721 lines — the implementer's number is the diagnostic count, mine agrees.

No escalation items: this is the workflow's first phase, so nothing I found can affect a completed
upstream phase, and none of the three escalation triggers applies (one unregistered stub would be
required for the systemic-stub trigger, and none exists).
