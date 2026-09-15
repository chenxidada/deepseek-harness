# Phase 1 Verification Report — `phase-1-node-env-preflight`

## 判决：PARTIAL

All ten acceptance criteria are achieved in the scope Phase 1 can judge (AC-1 – AC-10 (e)) with independent execution evidence, the three open items from the previous round (D-1, D-2, N1) are independently confirmed fixed, and the differential gates show zero new failures. The verdict is not PASS for exactly one reason: AC-10's real-machine consumption branch (AC-10 (f)) is deferred by this workflow's design to Phase 3, and the spec explicitly forbids recording that deferral and still returning PASS. No CRITICAL or MEDIUM **functional** defect was found. Seven review items remain open, all of them document/reference fidelity with zero behavioural impact — see §7.

Verification executed on branch `impl-phase-1-node-env-preflight` (working tree, no Phase 1 commit) at HEAD `d92b0e55e1`, on 2026-09-15.

> **AC-10 cross-Phase registration (spec requires this wording verbatim):** AC-10 真机消费分支由 Phase 3 提供证据（跨 Phase 依赖）. Phase 1 is **not** failed for this, this report does **not** claim the real-machine branch was verified here, and if Phase 3's supplementary evidence row fails then the whole of AC-10 fails. §4.4 states why this registration still forces a non-PASS verdict.

---

## 0. Verification environment and measurement basis

| Item | Value (measured this session) |
|---|---|
| Branch | `impl-phase-1-node-env-preflight` — matches the required branch |
| HEAD | `d92b0e55e1` (spec-status housekeeping; contains no Phase 1 code) |
| Default `node` | v20.16.0 — unqualified (missing `zlib.createZstdDecompress`, `Promise.withResolvers`) |
| Qualifying Node | `/usr/local/n/versions/node/24.3.0` |
| Command prefix | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm --config.verify-deps-before-run=false` |
| Module plane exercised | Source plane: `@deepseek-ai/dsh-sdk-client` → `packages/sdk/client/src/index.ts` (v0 row below) |

### 0.1 Differential regression matrix

Baseline is partially red by design; the criterion is *zero new failures and an identical failure set*, not all-green.

| Gate | Baseline (spec) | Measured now | New failures |
|---|---|---|---|
| `pnpm run typecheck` | green | exit 0 | 0 |
| `pnpm test packages/sdk/client` | green | exit 0 — `Test Files 3 passed (3)`, `Tests 84 passed (84)` | 0 |
| `pnpm run test apps/vscode-dsh` | red — 4 files / 6 cases | exit 1 — `Test Files 4 failed \| 46 passed (50)`, `Tests 6 failed \| 351 passed \| 1 skipped (358)` | 0 |
| `pnpm run test:docs` | red — 10 passed / 5 failed | exit 1 — `run-gates: 10 passed, 5 failed, 0 skipped in 26.78s` | 0 |
| `pnpm run lint` | red | exit 1 — **10381** diagnostics (rule set: `.oxlintrc.json`, the authoritative gate config) | 0 |

- Failing `apps/vscode-dsh` files are exactly the baseline four: `spike-t0b-continue-capability.spec.ts`, `panel-close-delete.e2e.spec.ts`, `spike-t0a-replay-rebuild.spec.ts` (4 cases), `verifier-phase1/layer-a-rtl.spec.tsx`.
- Failing doc gates are exactly the baseline five: markdown links, translation pairing, markdown wrap, agent note format, documentation standard tests.
- No Phase 1 file appears in any failure set. This Phase's own doc pair is clean: `docs/development` occurs **0** times in the whole `test:docs` output, and the recorded pair hashes in `docs/development.i18n.yaml` match the working tree exactly (`development.md` → `32be857e…`, `development.zh.md` → `821d84be…`).
- Reported lint total differs by one from the round-3 review's 10382; the decisive measurement is §0.2 rather than the total.

### 0.2 Lint, added lines only

Rule set: `.oxlintrc.json` (the gate). `.oxlintrc.staged.json` is a different, type-analysis-free subset and is not used here.

I intersected every diagnostic line with the added-line ranges of the working-tree diff for all 25 Phase 1 paths (`git diff -U0` new-file ranges; untracked files treated as wholly added):

| File | Diagnostics in file | On an added line |
|---|:--:|:--:|
| `apps/vscode-dsh/src/extension.ts` | 22 | 0 |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 1 | 0 |
| `apps/vscode-dsh/src/session-host.ts` | 1 | 0 |
| `apps/vscode-dsh/src/index.ts` | 1 | 0 |
| `apps/vscode-dsh/tests/{auto-start-orchestrator,phase1-auto-start,phase2-auto-ready,phase4-new-conversation-chrome}.spec.ts` | 4 / 2 / 15 / 11 | 0 each |
| all other Phase 1 paths (new guard, new specs, SDK files, docs, manifests) | 0 | n/a |

Zero new lint diagnostics on added lines; no `NEW-DIAGNOSTIC` line was produced for any file. Diagnostics under this Phase's own artifact directory: **0**.

---

## 1. Test execution matrix

Rows marked "static" are text/structure assertions and are explicitly **not** end-to-end. Every behavioural criterion additionally has a runtime row.

| Criterion | Source | Command | Result | Evidence |
|---|---|:--:|:--:|---|
| AC-1 (a) machine-readable pin | spec | `tsx v1-ac1-pinned-locate.mts` | ✅ | `AC-1a exactly one version line 1 line(s)`; `version form 24.3.0`; `ends with one newline ".0\n"`; `no CR`; root `engines.node` equals the enforced constant `^22.19.0 \|\| >=24.0.0` |
| AC-1 (b) the pinned release runs the gate | spec | `tsx v1-ac1-pinned-locate.mts` | ✅ | Located `/usr/local/n/versions/node/24.3.0/bin/node`, the same path via harness `PATH`, and `/usr/local/bin/node`; each → `ok:true version=24.3.0 hasZstd=true hasWithResolvers=true`; `~/.nvm/versions/node/v24.3.0` absent. `FAILURES=0`. Predicate controls reject 22.18.0 / 23.5.0 / 20.16.0. Independent confirmation of the repository test's pass/no-skip in §4.2 |
| AC-1 (c) docs name the pin | spec | `tsx v1-ac1-pinned-locate.mts` | ✅ (static) | Both `docs/development.md` and `docs/development.zh.md` contain `.nvmrc` and `24.3.0` |
| AC-2 Node prerequisite list | spec | `tsx v5-docs-ac2-ac3.mts` | ✅ (static) | Both languages: floor `22.19` ✅, owner (`engines.node` + `package.json`) ✅, `zlib.createZstdDecompress` ✅, `Promise.withResolvers` ✅, `.jsonl.zstd` link ✅ |
| AC-3 two responsibility lists, two faces | spec | `tsx v5-docs-ac2-ac3.mts` | ✅ (static) | `{"repositoryOnce":true,"localOnce":true,"faceOnce":[true,true],"bulletsPerFace":[3,3],"everyEntryDecidable":true}` for both languages; `terminal=3 bullets, subprocess=3 bullets, shared=0`; `5 repository rows name a pnpm run command`; negative controls: removing either face title or either list title makes the predicate false (8 controls, all as required) |
| AC-4 spawn-time checks before spawn | spec | `tsx --import … v3-e2e-preflight.mts` | ✅ (runtime) | Three failure kinds end to end — `missing-apis` (scenario 1), `missing` (scenarios 2, 3), `not-executable` (scenario 5): every one `spawnCount=0`, `no bridge socket existsSync=false`, host status `error`. Ordering visible in the shipped code at `session-host.ts:289-310` (gate, then `bridge.listen`, then the same object handed to `HarnessClient`) |
| AC-4 order contract | spec | implementer suite `session-host-preflight.spec.ts` (context only) | ✅ | Covered by the suite in §0.1; my own runtime evidence is the `spawnCount=0` rows above plus the positive control in §2 |
| AC-5 `DSH_NODE_BIN` wins, no Electron override | spec | `tsx v2-resolution-priority.mts` | ✅ | `{"path":"/x/node","source":"dsh-node-bin","electronRunAsNode":false}`; `launch.command === '/x/node'`; `ELECTRON_RUN_AS_NODE === undefined` both off Electron and with Electron simulated; env-vs-setting conflict still yields `dsh-node-bin`; failure path (v3 scenario 3) `source=dsh-node-bin kind=missing spawnCount=0` |
| AC-6 tier 3 is `process.execPath`, never `PATH` | spec | `tsx v2-resolution-priority.mts` | ✅ | `{"path":"/usr/local/n/versions/node/24.3.0/bin/node","source":"process-exec-path","electronRunAsNode":false}`; under simulated Electron `electronRunAsNode:true` → `ELECTRON_RUN_AS_NODE === '1'`; `PATH shim shadows node which=/tmp/…/node` yet `PATH node is not selected resolved=…/24.3.0/bin/node` |
| AC-7 stop before socket and spawn | spec | `tsx --import … v3-e2e-preflight.mts` | ✅ (runtime) | Scenario 1: `kind=node-environment`, `host.status=error`, `host.errorMessage === diagnostic`, `diagnostic.kind=missing-apis`, no socket, `spawnCount=0`, no witness file, `elapsed=8ms of 60000ms bound` — i.e. not a handshake timeout. Scenarios 2/3/5 identical in shape |
| AC-8 five-element diagnostic | spec | `tsx --import … v3-e2e-preflight.mts` | ✅ (runtime) | Real message is exactly 5 lines: path ✅, detected `20.16.0` ✅, range (`22.19` and `24`) ✅, both API names ✅, both remedies (`DSH_NODE_BIN` and `dsh.nodeBin`) ✅ |
| AC-9 classified as environment, not a dsh defect | spec | `tsx --import … v3-e2e-preflight.mts`, `tsx v4-m2-classification.mts` | ✅ (runtime) | First line `Node environment check failed — source: dsh.nodeBin setting`; no `dsh bug` / `internal error` / `defect` / `broken`; the class survives to the consumer snapshot in three independent observations (§3) |
| AC-10 (a) manifest surface | spec | manifest read | ✅ (static) | `dsh.nodeBin`: `type "string"`, `default ""`, `scope "machine-overridable"`, non-empty `description` naming both APIs, the range, the resolution order, and "Leave empty to not participate in resolution" |
| AC-10 (b) priority chain documented | spec | `tsx v5-docs-ac2-ac3.mts` | ✅ (static) | `DSH_NODE_BIN`, `dsh.nodeBin`, `process.execPath` all present in both developer docs |
| AC-10 (c) setting source, one shared object | spec | `tsx v2-resolution-priority.mts` | ✅ (runtime) | Empty env + `nodeBinSetting='/y/from-setting'` → `{"path":"/y/from-setting","source":"vscode-setting"}`; `spawn command is the setting`; no Electron flag; `AD-1 retained object is spawned /frozen/node` and `AD-1 absent object resolves fresh /x/later` |
| AC-10 (d) invalid setting fails loud, no fallback | spec | `tsx --import … v3-e2e-preflight.mts` | ✅ (runtime) | Scenario 2 (`missing` via the setting): `kind=missing`, `spawnCount=0`, no socket, message names the absent path. Scenario 5: `not-executable`. Scenario 7 (same path through the real `activate()`): snapshot `state=failed`, `errorKind=node-environment`, message names both the path and `dsh.nodeBin` |
| AC-10 (e) extension reads the setting and passes it on | spec | `tsx --import … v3-e2e-preflight.mts` | ✅ (runtime) | Scenario 6: real activation reads `dsh` then `dsh.nodeBin`; non-string fails loud (`dsh.nodeBin must be a path to a Node.js executable string, got number`), `spawnCount=0`, and no pre-flight diagnostic (so the throw precedes the start). Scenario 8, positive and the strongest available: a valid executable named **only** by `settings.json` becomes the interpreter actually spawned — spawn log `{"command":"/tmp/dsh-verify-e2e-oXsiak/node-good-8","args":["--import",…"apps/cli/src/bin.ts","--profile","ide",…]}` |
| AC-10 (f) real-machine branch | Phase 3 | not available in Phase 1 | ⏳ registered | Cross-Phase dependency, see the box at the top and §4.4. Not counted as a Phase 1 failure; not claimed as verified |
| Regression (differential) | spec | §0.1 / §0.2 | ✅ | typecheck green; `packages/sdk/client` green; `apps/vscode-dsh`, `test:docs`, `lint` red at exactly the baseline failure sets; zero diagnostics on added lines |

### 1.1 Evidence strength for the AC-10 invalid-setting branch (spec-mandated labelling)

The invalid-setting branch rests on two parts and the first is **proxy evidence**:

1. **Proxy evidence** — the preset `settings.json` is byte-identical after the run (`AC-10d proxy: settings.json untouched bytes identical`). This only shows the extension did not rewrite the setting into another source.
2. **Non-proxyable negative evidence** — no Host child process was created (`AC-10d real activation spawn count 0`, `AC-10d no socket`, `existsSync(bridgeSockPath)===false`). This is the only observation in this scenario a script cannot manufacture.

No independent observation point was added (per the user's HG-2 ruling), so this branch is **not** described here as "the resolution chain was directly observed consuming the setting". The direct positive observation of the setting reaching a spawn does exist, but through the real `activate()` in scenario 8 rather than through a `.test.*` projection.

---

## 2. Independent scenarios designed by this verifier

The implementer's tests are not the basis of any verdict. Every row below builds its own inputs, calls production code, and asserts observable output.

| # | Scenario | Script | Result |
|:--:|---|---|:--:|
| 1 | Which module plane is exercised, so every other row names the artifact it measured | `v0-resolution-probe.mts` | ✅ `@deepseek-ai/dsh-sdk-client` → `packages/sdk/client/src/index.ts` |
| 2 | Locate the pinned release in the roots the spec names, then run the shipped gate on each located interpreter; independent range predicate with its own controls | `v1-ac1-pinned-locate.mts` | ✅ 21 rows (17 assertions + 4 INFO), `FAILURES=0` |
| 3 | Resolve the Node executable through the real entry under every source combination: env/setting conflicts, whitespace boundaries, a `PATH` shim that really shadows `node`, simulated Electron | `v2-resolution-priority.mts` | ✅ 19 rows, `FAILURES=0` |
| 4 | Drive the real `IdeSessionHost` and the real extension `activate()` through eight scenarios, with `child_process.spawn` counted by a preload wrapper instead of inferred | `v3-e2e-preflight.mts` | ✅ 46 rows, `FAILURES=0` |
| 5 | Consumer-visible classification plus its falsifiability via a one-line mutant, and (new this round) a drift guard that the mutant is the shipped module minus that one line | `v4-m2-classification.mts` + `mutation/auto-start-orchestrator-flattened.ts` | ✅ 9 rows, `FAILURES=0` |
| 6 | Doc contract for AC-2 / AC-3 with negative controls that must make each predicate false | `v5-docs-ac2-ac3.mts` | ✅ 18 rows, `FAILURES=0` |
| 7 | **New this round — N3.1:** whether `source` changes any check outcome or only the text, and whether probe mode follows `electronRunAsNode` rather than `source` | `v6-source-label-behaviour.mts` | ✅ 10 rows, `FAILURES=0` |

Scenario 4 exists only because a passing run needs a positive control: scenario 1's "no child process" is evidence only because scenario 4 shows the same instrumentation recording a spawn (`spawnCount=1`, shim log and witness file written).

### 2.1 Independent end-to-end runtime path (constructed input → execution → asserted output)

The strongest single path: **`settings.json` value → real `vscode.workspace.getConfiguration('dsh').get('nodeBin')` → `readNodeBinSetting` → `IdeSessionHost.start` → resolution → pre-flight → real `child_process.spawn`, measured by a preload wrapper.**

- Constructed input: a temp `settings.json` whose `dsh.nodeBin` names an executable shim; `DSH_NODE_BIN` unset.
- Execution: real `activate()` + real `dsh.test.requestStart`; the shim is a shell script that appends to its own log then `exec`s real Node.
- Asserted output: `spawnCount >= 1`; the shim's invocation log exists; the spawn log's command field is exactly the shim path, with argv `… apps/cli/src/bin.ts --profile ide …`.
- Failure-path twin of the same path: a `missing` path from the setting yields `state=failed / errorKind=node-environment / spawnCount=0 / settings.json bytes unchanged`.

---

## 3. End-to-end data paths verified

| Data path | Result | Evidence |
|---|:--:|---|
| `settings.json` → `getConfiguration('dsh').get('nodeBin')` → `readNodeBinSetting` → `start()` option → `resolveNodeExecutableSpec` → `assertNodeExecutable` → real spawn | ✅ | v3 scenario 8 spawn log (command is exactly the setting value) |
| `DSH_NODE_BIN` → resolution → spawn | ✅ | v3 scenario 4: shim log written, witness script executed |
| Invalid Node → `NodeEnvironmentError` → `HostStartError('node-environment')` → `startErrorKindOf` → snapshot `errorKind` | ✅ | v3 scenario 1 (`error.kind`), scenario 7 (real activation snapshot), v4 part A |
| Non-string setting → `HostStartError('invalid-setting')` → snapshot `errorKind` | ✅ | v3 scenario 6 (`D-2 non-string class is invalid-setting invalid-setting`) |
| Invalid Node → stop before `bridge.listen` → no socket, no child | ✅ | v3 scenarios 1, 2, 3, 5 |
| SDK public surface → extension consumer | ✅ | v0 probe shows both sides resolve the same source module |

---

## 4. Handover items (7 from the merged report, plus the two F-items I was told to fix)

### 4.1 D-2 falsifiability — independently reproduced inside the repository, with a proven clean restore

The correctness view's probe was twice blocked as out-of-tree; the connectivity view reproduced it with its own mutant. I reproduced it a third time, using the **shipped repository file** rather than any fixture:

1. Baseline: `git hash-object apps/vscode-dsh/src/auto-start-orchestrator.ts` → `63e427f48e78d8562a48083597f51d211b0be644`; `git diff -- <file> | sha256sum` → `5d9afbed6c26bfd87224b2459a638c673ae575599e89defe5ff719dd9bcb1435`.
2. Mutation: deleted `'invalid-setting',` from `START_ERROR_KINDS` in that file.
3. Execution: `vitest run apps/vscode-dsh/tests/node-env-guard.spec.ts -t "classifies a non-string setting"` →

```
 × |thread-safe| … > classifies a non-string setting as invalid-setting, not a process failure 17ms
   → expected 'process-failed' to be 'invalid-setting' // Object.is equality
AssertionError: expected 'process-failed' to be 'invalid-setting'
 ❯ apps/vscode-dsh/tests/node-env-guard.spec.ts:744:32
    744|     expect(snapshot.errorKind).toBe('invalid-setting')
```

4. Restore: re-inserted the member; `git hash-object` → `63e427f48e78d8562a48083597f51d211b0be644` (**identical**), `git diff -- <file> | sha256sum` → `5d9afbed…` (**identical**), `git diff --stat` unchanged at `+37 −7`.

So the assertion at `node-env-guard.spec.ts:744` is falsifiable on the shipped file, and the working tree is provably back to its pre-probe state. This closes the difference the correctness view flagged: the in-repo `auto-start-orchestrator.spec.ts:166-176` case (no `kind` → `process-failed`) only exercises the fallback; the probe above exercises "remove the member ⇒ red", which is the claim D-2 needs.

### 4.2 N1 (AC-1 b) — independently confirmed as a real pass, not a permanent skip

`vitest run apps/vscode-dsh/tests/node-env-guard.spec.ts --reporter=verbose`:

```
 ✓ |thread-safe| … > locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) 55ms
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

A `↓ skipped` case renders with a downward arrow and is excluded from `Tests passed`; here it is `✓` with a 55 ms duration, consistent with three real subprocess capability probes, and the file reports **0 skipped**. The case is also non-vacuous by construction (`node-env-guard.spec.ts:502-516`: `ctx.skip` only when nothing was located; otherwise every located interpreter must report `ok:true` **and** `report.version === pinned`, followed by `expect(located.length).toBeGreaterThan(0)`). My own independent locator (v1) finds the same two distinct interpreter paths, so AC-1(b) is both passed and independently corroborated.

### 4.3 N3.1 — the mislabelled `source` has zero behavioural impact; independently measured

`node-env-guard.ts` uses `executable.source` in exactly two places, both textual: `:120` → `sourceLabel`, consumed by the message's first line (`:170`) and by the remedy (`:192`). The probe's invocation mode is driven by the separate field `executable.electronRunAsNode` (`:258`). My independent probe (`v6-source-label-behaviour.mts`) measures both halves rather than reading them:

- Same candidate, all three `source` values → **identical verdict**: `{"ok":true,"report":{"version":"24.3.0",…}}` for the good candidate; `{"ok":false,"kind":"missing-apis","missingApis":[…]}` for the bad one, with the kind unchanged across sources.
- Diagnostic text *does* differ across sources (3 distinct first lines), so `source` is not inert — it is only text.
- Probe mode: a shim that records the flag it saw reports `ELECTRON_RUN_AS_NODE=1` for `electronRunAsNode:true` under all three sources and `unset` for `false` under all three. Mode follows `electronRunAsNode`, never `source`.

Conclusion: N3.1 stands as originally graded — a wording defect on the failure path of test/verifier code, not an AC failure. Runtime grading takes the success path, where the label is never rendered.

### 4.4 AC-10 (f) — registered, and it **does** keep the verdict at PARTIAL

The dependency is registered verbatim above, and Phase 1 is not failed for it. It nevertheless forces a non-PASS verdict, for two reasons that point the same way:

1. **The spec says so directly.** The AC-10 cross-Phase note reads "**不得** 因此把 AC-10 记为 known gap 后判 PASS". A deferred, per-seam-unevidenced AC branch is exactly a recorded gap, and the spec forecloses the shortcut of recording it and clearing the Phase.
2. **My own verdict definition.** `PASS` requires every acceptance criterion met with no CRITICAL/MEDIUM residual risk; an unverified branch of a `[Must]` AC cannot be rated LOW. It is registered as MEDIUM in §6.

This is a *designed* limitation, not a defect: the branch needs a real Extension Development Host, which Phase 3 owns. The distinction matters for the HG-3 decision — the honest reading is "Phase 1's own scope is complete and independently verified; one branch of one AC, by construction, cannot be cleared until Phase 3". I am not softening the verdict to let the pipeline advance, and I am not inflating it either: PARTIAL is the accurate word.

### 4.5 E-1 — confirmed: `(AD-10)` is cited where `(AD-9)` is meant

`grep -n "AD-9\|AD-10" apps/vscode-dsh/src/extension.ts` →

```
224:     * Read this extension's settings (AD-10).
2173: * Read the `dsh.nodeBin` Node executable setting (AD-10). A non-string value
```

`design.md:225` = `### AD-9: 提供 dsh.nodeBin VS Code 设置项 …`; `design.md:243` = `### AD-10: AC-2 / AC-3 的文档落点 …`. Both citations sit on added lines describing setting *reading*, so following the number lands the reader on the documentation decision. Confirmed as reported. No runtime effect.

### 4.6 E-2 — confirmed: the member list and the source sentence are not self-consistent

- `session-host.ts:43`: "Class of a failed {@link IdeSessionHost.start}".
- `auto-start-orchestrator.ts:36`: "the `HostStartErrorKind` vocabulary `IdeSessionHost.start` throws with".
- Actual throw site of the member in question: `extension.ts:2186` inside `readNodeBinSetting`, which is called from `createStartHostPort`'s `start()` (`extension.ts:2210-2217`) — i.e. the `StartHostPort` implementation, not `IdeSessionHost.start`.
- `grep -rn "invalid-setting" apps/vscode-dsh/src/` returns only the vocabulary/JSDoc sites plus that throw. Confirmed as reported. No runtime effect.

### 4.7 E-3 — confirmed: `implementation.md` §2.3 misattributes a file this Phase wrote

`implementation.md:105` still reads:

```
| `.cursor/skills/project-build/SKILL.md`, `.specdev/specs/workflows.json` | modified | Pre-existing. |
```

Measured: mtime `2026-09-15 20:11:19 +0800` (this rework window; the orchestrator measured 09-14 17:10 → 09-15 20:11), `git diff --stat` → `1 file changed, 25 insertions(+), 2 deletions(-)`, and the diff contains **8** hits of this Phase's vocabulary (`invalid-setting|24.3.0|nodeBin|20.16`). The file is git-tracked, unlike `.cursor/skills/project-test/SKILL.md` (untracked, `git ls-files --error-unmatch` fails). So the "Pre-existing" classification is false as of this round, and — as the design view noted — this touches the HG-3 commit scope rather than runtime behaviour. It is a documentation correction, not a code defect.

### 4.8 F-1 and F-2 — both fixed by me this round (my own artifacts)

**F-1.** `v3-e2e-preflight.mts:236` previously asserted the pre-rework value. It now reads `check('D-2 non-string class is invalid-setting', snapshot.errorKind === 'invalid-setting', …)`, the stale "today" label is gone, and the scenario carries a comment recording why a stale expectation here would manufacture a false red. Re-running the whole script set yields `FAILURES=0` for every script, with this row reporting `invalid-setting` from the real activation.

**F-2.** `mutation/auto-start-orchestrator-flattened.ts` is no longer a stale copy: it is now the shipped `auto-start-orchestrator.ts` with exactly one line (`  'node-environment',`) deleted and nothing else, and `v4-m2-classification.mts` **enforces** that relationship instead of asserting it in prose. The new guard computes the single-deletion diff between the two files and reports `removed line 30: "  'node-environment',"`; any added line, changed line, or second deletion makes it fail. Part D of v4 still observes `real=node-environment mutant=process-failed`, so the falsifiability control still works.

### 4.9 F-3 — recorded as a Phase 2 input, no Phase 1 change

`launch.ts:131-145` returns the caller-supplied value verbatim for two of the three sources — `{ path: environmentValue, source: 'dsh-node-bin' }` and `{ path: setting, source: 'vscode-setting' }` (the latter only guarded by `setting.trim() !== ''`). Only `process-exec-path` is guaranteed absolute. So `ResolvedNodeExecutable.path` is absolute **only** for tier 3, and Phase 2 must add an explicit mapping branch for `invalid-setting` and narrow on `kind` before reading `.diagnostic`. Recorded for Phase 2; Phase 1 needs no change (its own path, `session-host.ts:289-292`, consumes the resolved object without assuming absoluteness).

---

## 5. Stub-aware validation

`tech-debt-registry.md` has one active entry, `DEBT-004` (ide-profile main session unwritable; user-ruled out of this workflow, off the Phase 1 path) and three newly resolved entries `DEBT-005`/`DEBT-006`/`DEBT-007`. Parameter-variation test on the key path: `resolveNodeExecutableSpec` returned three distinct results across distinct inputs (`/x/node` / `dsh-node-bin`, `/y/from-setting` / `vscode-setting`, `process.execPath` / `process-exec-path`), and `validateNodeEnvironment` returned `ok:true` for 24.3.0 and `ok:false` with four distinct kinds (`missing`, `not-executable`, `unusable`, `missing-apis`) — output varies with input in both, so neither is a stub. No unregistered stub was found, so no new registry entry was added. I verified the three resolved entries are genuinely resolved: D-1 zero codes (§4 above and §7), D-2 a real member with a proven falsification, N1 a real running case.

---

## 6. Residual risks

| Risk | Severity | Explanation |
|---|:--:|---|
| AC-10 (f) real-machine branch unverified | 🟡 MEDIUM | Deferred by design to Phase 3. Until then AC-10 is not fully evidenced. Registered, not traded away |
| AC-1 (b) automation skips on a host without the pinned release | 🟢 LOW | The case runs and passes here (55 ms, 0 skipped) and this report independently reproduces the host facts, but on a machine with no 24.3.0 install the case reports `skipped` rather than failing. That is the behaviour the spec's verification strategy and DEBT-007 prescribe; recorded so it is not mistaken for a gate |
| E-1 / E-2 wrong `AD` number and inaccurate member-source sentences | 🟢 LOW | Comment/JSDoc fidelity only; no behaviour and no AC depends on it. Correcting them means editing product source, which the loop ceiling now blocks — see §7 |
| E-3 `implementation.md` misattributes a Phase file | 🟢 LOW (for behaviour) / decision needed | Affects the HG-3 commit set, not runtime behaviour |
| N3.1 `source:'process-exec-path'` labels a non-`execPath` interpreter | 🟢 LOW | Proven text-only by §4.3, on the failure path of test/verifier code |
| Harness scripts are outside the repository gates | 🟢 LOW | `test-scripts/*.mts` are not covered by `typecheck`/`lint` (0 diagnostics there); their real check is that they execute, which they did this round |
| Ordering proof is code order plus measured absence, not an injected race | 🟢 LOW | "No socket, no child" is measured in four failure scenarios; interleaving under a hostile scheduler was not exercised |

No CRITICAL risk. No MEDIUM **functional** risk.

---

## 7. Issue list — what is still open (verdict is PARTIAL)

1. **AC-10 (f) is not verified in Phase 1.** The real-machine consumption branch needs the Phase 3 smoke script (AD-11). A recorded cross-Phase dependency is not a solved requirement, so the Phase cannot be cleared outright. This is the sole reason this verdict is not PASS.
2. **E-1** — change `(AD-10)` to `(AD-9)` at `extension.ts:224` and `:2173`.
3. **E-2** — the source sentences at `session-host.ts:43` and `auto-start-orchestrator.ts:36` do not cover `invalid-setting`, which is thrown by `extension.ts`'s `readNodeBinSetting` (inside `StartHostPort`), not by `IdeSessionHost.start`.
4. **E-3** — `implementation.md:105` classifies `.cursor/skills/project-build/SKILL.md` as "Pre-existing"; this round's implementer wrote it (mtime 20:11, `+25 −2`, 8 Phase keywords). Affects the HG-3 commit set.
5. **N3.1** — `node-env-guard.spec.ts:509` and `v1-ac1-pinned-locate.mts` label a located interpreter `source:'process-exec-path'`. Zero behavioural impact (§4.3); the wording is what needs correcting.
6. **F-3** — Phase 2 must add an explicit `invalid-setting` mapping branch and narrow on `kind` before reading `.diagnostic`; `launch.ts:131-145` guarantees absoluteness only for `process-exec-path`.
7. **F-1 / F-2 are closed** — fixed by this verifier in this round, with the mutant drift now enforced by a guard (§4.8).

**A decision is required from the orchestrator/user for items 2 and 3.** They are product-source edits (`apps/vscode-dsh/src/*.ts`), and this Phase's `loop_count` is already at its ceiling of 2, so `pipeline-gate.sh` will refuse an implementer dispatch. I therefore do **not** assume a rework round is available: either the user authorizes these comment-level corrections outside the loop, or they are carried as known documentation debt. Items 4 (spec-side document) and 6 (Phase 2 input) are not blocked by the loop ceiling.

Why PARTIAL, stated plainly: D-1, D-2 and N1 — the three drivers of the previous round's PARTIAL — are all independently confirmed fixed, so the earlier reasons no longer apply. What remains is a single by-design deferral (AC-10 (f)) that the spec forbids clearing, and seven open items whose severity I checked one by one: all are comment, reference, or commit-attribution fidelity with zero behavioural impact, except F-3 which belongs to Phase 2. No acceptance criterion fails, no end-to-end path is broken, and no CRITICAL or MEDIUM functional defect exists.

---

## 8. Difference from the previous round

| Round | Verdict | Drivers |
|---|:--:|---|
| Round 1 (2026-09-15 19:05) | PARTIAL | (1) AC-10 (f) deferred; (2) N1 — AC-1 (b)'s automation asserted `process.execPath`; (3) D-1 open; (4) D-2 open. Plus a MEDIUM for AC-1 (b) having no repository-resident coverage |
| This round | PARTIAL | **Only** AC-10 (f), by design. Drivers (2), (3), (4) are gone; the AC-1 (b) coverage MEDIUM is gone |

What changed in the evidence, not just in the prose:

- **(2) N1** — the case now implements the spec's three-root locator and this round it *runs* (55 ms, `✓`, 28 passed / 0 skipped, §4.2). Previously the AC's evidence rested entirely on my own out-of-repo script.
- **(3) D-1** — `grep -rnE '\((S[0-9]+|M[0-9]+)[,)]|// *(S|M)[0-9]+:' apps/vscode-dsh/` exits 1 (no match), while `AD-*` references are still present (5 / 2 / 1 in `session-host.ts` / `extension.ts` / `auto-start-orchestrator.ts`), i.e. the codes were removed without deleting the legitimate decision ids.
- **(4) D-2** — `invalid-setting` is a real, propagated vocabulary member (three structurally equal sets), the observed snapshot class is `invalid-setting`, and I reproduced the "remove the member ⇒ red" falsification on the shipped file with a proven clean restore (§4.1).
- New this round: the two defects in **my own** evidence channel (F-1 stale assertion, F-2 drifting mutant) are fixed and the mutant drift is now machine-enforced; and N3.1 is settled by measurement rather than by reading (§4.3).

The verdict is unchanged in *value* but not for continuity: the composition of the drivers has changed completely, from three open items plus a coverage gap to one by-design deferral. I did not carry the previous PARTIAL forward, and I did not upgrade it to PASS — the deciding rule is the spec's own prohibition on clearing a deferred AC branch.

---

## 9. Pipeline compliance

- Branch: `impl-phase-1-node-env-preflight` — the required branch, confirmed before any claim was made. ✅
- Phase 1 changes live in the working tree on that branch, uncommitted, as the workflow requires (implementer does not commit; the orchestrator commits at HG-3).
- HEAD `d92b0e55e1` contains no Phase 1 code; the last six commits across all refs are housekeeping/other-phase commits.
- No non-specs file was changed outside the `impl-*` branch.
- Pre-existing, non-Phase artifacts present in the working tree and **not** attributed to Phase 1: `pnpm-lock.yaml`, `apps/vscode-dsh/webview/dist/assets/*`, `.specdev/specs/workflows.json`.
- Method constraints honoured: no `git` write command was used (only `hash-object`, `diff`, `log`, `ls-files`, `branch`, `rev-parse`); the mutation of `auto-start-orchestrator.ts` was made with an editor edit and restored to the identical blob; `current-status.json`, `review.md`, `review-*.md`, `implementation.md` and `spec.md` were not modified; no commit was created.
- Startup self-cleanup: this round's `verification.md` and `verification-zh.md` were archived to `.archive/verification-{,-zh}-20260915T123532Z.md` by `mv` before rewriting.

---

## 10. Verification scripts

All under `.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/test-scripts/`.

| Script | Purpose | This round |
|---|---|---|
| `spawn-counter-preload.mjs` | Wraps `child_process.spawn` and appends each call to `DSH_VERIFY_SPAWN_LOG`, making "no child process" a measurement | unchanged |
| `run-harness.sh` | Sets `PATH` and the spawn log, then runs a scenario through `tsx` | unchanged |
| `v0-resolution-probe.mts` | Names the module plane (source vs built `lib`) each import resolves to | 0 failures |
| `v1-ac1-pinned-locate.mts` | AC-1 (a)(b)(c): locate the pinned release in the required roots and run the shipped gate on it | 21 rows (17 assertions), 0 failures |
| `v2-resolution-priority.mts` | AC-5, AC-6, AC-10 (c), AD-1 identity, whitespace boundaries, `PATH` shim, Electron flag | 19 rows, 0 failures |
| `v3-e2e-preflight.mts` | AC-4, AC-5 failure path, AC-7, AC-8, AC-9, AC-10 (d)(e), D-2, through the real host and the real activation | 46 rows, 0 failures; **F-1 fixed** |
| `v4-m2-classification.mts` + `mutation/auto-start-orchestrator-flattened.ts` | AC-9 classification, its falsifiability, and the mutant drift guard | 9 rows, 0 failures; **F-2 fixed** |
| `v5-docs-ac2-ac3.mts` | AC-2, AC-3, AC-1 (c), AC-10 (b) as static assertions with negative controls (explicitly not end to end) | 18 rows, 0 failures |
| `v6-source-label-behaviour.mts` | **new** — N3.1: `source` affects text only, and probe mode follows `electronRunAsNode` | 10 rows, 0 failures |

Total: 119 executed assertions, 0 failures, and no silent skips (the only script with a skip mechanism, `v1`, turns "not located" into a recorded FAIL rather than a skip).

Reproduction commands:

```sh
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
TS=.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/test-scripts
./node_modules/.bin/tsx $TS/v0-resolution-probe.mts
./node_modules/.bin/tsx $TS/v1-ac1-pinned-locate.mts
./node_modules/.bin/tsx $TS/v2-resolution-priority.mts
DSH_VERIFY_SPAWN_LOG=/tmp/dsh-verify-spawn.log \
  sh $TS/run-harness.sh --import ./$TS/spawn-counter-preload.mjs ./$TS/v3-e2e-preflight.mts
./node_modules/.bin/tsx $TS/v4-m2-classification.mts
./node_modules/.bin/tsx $TS/v5-docs-ac2-ac3.mts
./node_modules/.bin/tsx $TS/v6-source-label-behaviour.mts
```
