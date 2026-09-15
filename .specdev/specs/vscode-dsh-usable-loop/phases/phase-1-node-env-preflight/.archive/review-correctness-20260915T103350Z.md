# Correctness Review — Phase 1: Node environment contract, settings surface, and pre-spawn check

## Perspective

**Implementation Correctness** — does the code actually work? Function bodies, real subprocess behavior,
acceptance-criteria mapping, boundary and error paths, side effects. Design consistency and integration
connectivity are out of scope (covered by the parallel `reviewer-design` / `reviewer-connectivity`).

## Verdict

**SHOULD-FIX** — every AC-1…AC-10 acceptance criterion has real runtime evidence, the AD-1 (same
`ResolvedNodeExecutable` validated and spawned) and AD-2 (capability-decided, version-diagnostic-only)
invariants hold, and no unregistered stub exists; but two defects that do not fail an AC will make the
next stage mislead itself: `spec.md`'s AC-4(c) fixture payload contradicts the probe's report contract
(so a literal reproduction reports AC-4(c) as failing even though the code is right), and the
`process-exec-path` remedy tells the user to fix `PATH`, which cannot affect `process.execPath` and
contradicts the documented "resolution never consults `PATH`" contract.

Self-cleaning step 0: no `review-correctness.md` / `review-correctness-zh.md` existed in the phase
directory, so nothing was archived. `current-status.json` was not touched.

## Independent reproduction

All commands from `/workspace/chendecheng/code/need/deepseek/deepseek-harness` with
`export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` and
`PNPM="pnpm --config.verify-deps-before-run=false"`.

**(1) Phase-focused tests — matches the claim.**

```
$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts \
  apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts
→ Test Files  3 passed (3)
→      Tests  57 passed (57)
→   Duration  878ms
```

**(2) typecheck — matches the claim.**

```
$PNPM run typecheck
→ typecheck exit=0
```

**(3) App + SDK regression — same identity and same root cause as the baseline snapshot.**

```
$PNPM run test apps/vscode-dsh packages/sdk/client
→ Test Files  4 failed | 49 passed (53)
→      Tests  6 failed | 428 passed | 1 skipped (435)
→ exit_code: 1
```

Failing cases, none of which touches the Node pre-flight surface:
`panel-close-delete.e2e.spec.ts` (1), `spike-t0a-replay-rebuild.spec.ts` (4: AC-30/47, AC-76, AC-77,
AC-80), `verifier-phase1/layer-a-rtl.spec.tsx` V-A4 (1); fourth failed file
`spike-t0b-continue-capability.spec.ts`. No `node-env-guard.spec.ts`,
`session-host-preflight.spec.ts` or `launch.spec.ts` file appears among them. This equals the v8
baseline in `spec.md:80` (4 files / 6 cases, root cause `scripts/test-invariants.ts:188`), and
`packages/sdk/client` grew 73 → 84 cases green as `implementation.md` states.

**(4) lint delta — measured, not inferred (see Should-Fix/Observations item O2).**

```
$PNPM run lint → exit_code: 1
grep -n 'apps/vscode-dsh/src/extension\.ts:' <lint output>  → 3 matches
   2109:1: error @stylistic(indent): Expected indentation of 8 spaces but found 10.
   2110:1: error @stylistic(indent): Expected indentation of 8 spaces but found 10.
   2111:1: error @stylistic(indent): Expected indentation of 6 spaces but found 8.
grep -n 'node-env-guard' <lint output>   → 0 matches
grep -n 'session-host\.ts' <lint output> → 0 matches
grep -n 'packages/sdk/client' <lint output> → only the "config file" info line
```

`extension.ts:2109-2111` is `askAboutSelection`'s `asRelativePath` arrow body (read at
`apps/vscode-dsh/src/extension.ts:2103-2111`), i.e. unrelated pre-existing code displaced by the new
import at `:48`; every changed hunk (`:48`, `:2179-2188`, `:2253-2256`) is diagnostic-free.

**(5) My own probe, not present in the report under review** (inline, real subprocesses):

```
node --import tsx --input-type=module -e "<probe>"
C1 exit-code-7 -> expect unusable: {"ok":false,"kind":"unusable","detail":"it exited with code 7","missing":[]}
C2 spec.md-literal payload -> spec says missing-apis: {"ok":false,"kind":"unusable","detail":"its output was not a Node.js capability report","missing":[]}
C3 code-contract payload -> expect missing-apis: {"ok":false,"kind":"missing-apis","missing":["zlib.createZstdDecompress","Promise.withResolvers"]}
C4a env="   " -> {"path":"   ","source":"dsh-node-bin","electronRunAsNode":false}
C4b setting="   " -> {"path":"/usr/local/n/versions/node/24.3.0/bin/node","source":"process-exec-path","electronRunAsNode":false}
C4c env="" setting=/y -> {"path":"/y","source":"vscode-setting","electronRunAsNode":false}
```

C1 proves the fourth failure kind reports the observed defect and fabricates no API name. C2 is a
finding (Should-Fix S1). C3 proves the AC-4(c) outcome with the contract the code actually emits. C4
proves the deliberate asymmetry required by `spec.md:106` — a whitespace-only environment variable
counts as *set*, a whitespace-only setting counts as *unset* — and that they are not collapsed into one
branch.

**(6) Electron-tier mechanism, checked headless (no GUI launch):**

```
ELECTRON_RUN_AS_NODE=1 /usr/share/code/code -e "console.log(...)"
→ vsCodeNode 22.22.0 electron 39.8.0 zstd function withResolvers function execPath /usr/share/code/code
```

The host's own VS Code binary runs as Node and provides both required APIs when the flag is present,
which is the exact invocation `probeNodeApis` performs. VS Code's extension host sets that flag itself:
`src/vs/workbench/api/node/extensionHostProcess.ts` → `patchProcess()` contains
`process.env['ELECTRON_RUN_AS_NODE'] = '1'` ("for extensions that use child_process.spawn with
process.execPath and expect to run as node process on the desktop", refs
https://github.com/microsoft/vscode/issues/151012). So the inherited-environment probe does reach the
`ok:true` path for `process-exec-path`.

**(7) `pnpm run test:docs`** was run earlier in this review session: `run-gates: 10 passed, 5 failed`,
matching the v8 baseline `spec.md:81` exactly, with no Phase-1 file in any violation list. A fresh
re-run was blocked by the sandbox (see Unverified).

## Must-Fix

None. No acceptance criterion is unmet, no unregistered stub was found, and no functional regression
was reproduced.

## Should-Fix

**S1 — `spec.md`'s AC-4(c) fixture contradicts the probe's report contract; a literal reproduction
reports AC-4(c) as failing.**

* Location: `.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/spec.md:46`
  (AC-4 verification row, item (c)) and `implementation.md` §2 AC-4 row.
* Problem: both documents specify the stand-in as printing
  `{"version":"20.16.0","zstd":false,"withResolvers":false}`. The probe emits and the parser requires
  `hasZstd` / `hasWithResolvers` (`apps/vscode-dsh/src/node-env-guard.ts:99-103`, `:268-274`), and the
  phase's own test uses those keys (`apps/vscode-dsh/tests/node-env-guard.spec.ts:56-58`, `:185-198`).
  Run with the spec's literal payload, `isNodeEnvironmentReport` returns false, so the outcome is
  `unusable`, not `missing-apis`.
* Evidence: probe case C2 above
  → `{"ok":false,"kind":"unusable","detail":"its output was not a Node.js capability report"}`;
  probe case C3 with the code's keys → `{"ok":false,"kind":"missing-apis","missing":["zlib.createZstdDecompress","Promise.withResolvers"]}`.
* Impact: the code is correct and AC-4(c) holds; the *evidence contract* is wrong. An independent
  verifier following `spec.md:46` verbatim will observe a non-`missing-apis` outcome and may record
  AC-4(c) as unverified/failed, i.e. the phase can be failed by a documentation defect. Fix the two
  payload literals to `hasZstd`/`hasWithResolvers` (the probe's report is the authoritative contract;
  a stand-in must mimic what the probe emits), and have the verifier use those keys.

**S2 — the `process-exec-path` remedy prescribes a `PATH` change that cannot fix the failure.**

* Location: `apps/vscode-dsh/src/node-env-guard.ts:198`
  (`start VS Code from a shell whose PATH resolves Node.js ${EXPECTED_NODE_RANGE}, or …`), asserted as
  intended text by `apps/vscode-dsh/tests/node-env-guard.spec.ts:305-320`.
* Problem: for the `process-exec-path` source the failing executable *is* the Extension Host's own
  `process.execPath`; nothing on `PATH` changes it, and the documented contract says resolution never
  consults `PATH` (`packages/sdk/client/README.md:58`, `docs/development.md:107`). The clause therefore
  names a lever the code does not have.
* Evidence: `validateNodeEnvironment` never reads `PATH` (only `stat`/`access`/`execFile` on the
  resolved path, `node-env-guard.ts:228-265`); `resolveNodeExecutableSpec` has exactly three inputs and
  no `PATH` lookup (`packages/sdk/client/src/launch.ts:131-145`); probe case C4b/C4c show resolution is
  decided solely by environment/setting/`process.execPath`.
* Impact: the diagnostic is still AC-8(e)-compliant (it names both `DSH_NODE_BIN` and `dsh.nodeBin`), so
  no AC fails, but the first half of the sentence sends the user to a fix that cannot work. Keep the two
  configuration levers; drop the `PATH` clause for this source.

## Observations

**O1 — the Electron tier works through the inherited environment, and that coupling is now documented
evidence rather than an assumption.** `probeNodeApis` calls `execFileAsync(path, ['-e', SOURCE], {timeout, windowsHide})`
with no `env`, so the probe inherits the parent environment, while the spawn injects
`ELECTRON_RUN_AS_NODE=1` for the same object (`launch.ts:178-192`). That asymmetry is real but benign on
the desktop extension host, because VS Code sets `process.env['ELECTRON_RUN_AS_NODE'] = '1'` inside the
extension host (VS Code `extensionHostProcess.ts` `patchProcess()`, refs issue #151012), and the
mechanism was reproduced here with the host's own binary (item 6 above). Residual risk, not a finding:
the probe's correctness depends on that external behaviour, and if it were absent the probe would launch
the Electron app instead of Node (the same consequence `launch.ts:178-179` documents for the spawn) and
then report `unusable` after the 10 s bound. Neither Phase 1 nor Phase 3 exercises this tier — Phase 3's
smoke presets `dsh.nodeBin` (AC-10(f)/AD-11) — so a one-line note in `node-env-guard.ts` recording the
dependency (or passing the flag explicitly) would remove the last untested assumption.

**O2 — `implementation.md`'s lint claim is wrong in magnitude; the conclusion still holds.** §3.3 claims
22 pre-existing diagnostics in `extension.ts`; the measured count is 3 (`2109`, `2110`, `2111`), all on
unchanged lines, with zero in `node-env-guard.ts`, `session-host.ts` and `packages/sdk/client`. An
inflated pre-existing count is exactly the argument that could hide a new diagnostic, so the reasoning
should be replaced by the measurement in `verification.md`: 0 in every file this phase created or
changed, 3 displaced pre-existing ones elsewhere.

**O3 — the `unusable` kind is necessary, non-masking, and covered.** Necessary: without it, a candidate
that never produced a report would have to be reported as `missing-apis`, whose message enumerates
`REQUIRED_NODE_APIS` (`node-env-guard.ts:220`) — names never observed on that path. Probe C1 shows the
observed detail is carried instead (`"it exited with code 7"`, `missing: []`). Non-masking: path
classification runs first (`:127-130`), so `missing`/`not-executable` can never be relabelled `unusable`,
and `missing-apis` is only produced from a parsed report (`:138-145`). Coverage:
`node-env-guard.spec.ts:323` (exit 7) plus the distinct-message test at `:319-340`.

**O4 — the spawn-count witness cannot produce a false negative that would matter.** The failing-start
tests assert three independent facts: no witness file (`session-host-preflight.spec.ts:150`, `:184`,
`:224`, `:257`), no bridge socket (`:151`, `:185`, `:225`, `:258`), and elapsed time under 5 s while
`initializeTimeoutMs` is 60 s (`:141`, `:152`, `:188`). Even if a child were spawned and died before
writing the witness, the missing socket and the 5 s-vs-60 s timing still exclude "spawn then handshake
timeout", because `bridge.listen` (`session-host.ts:286`) precedes the only spawn site
(`:292-303`). The witness is corroboration, not the sole evidence.

**O5 — `HostStartError` changes the thrown identity for every `start()` failure with no observed
regression.** The only consumer rethrows without inspecting the type
(`apps/vscode-dsh/src/extension.ts:2269-2277`), the diagnostic text is preserved as the message
(`session-host.ts:313-321`), and the unchanged app suite stays at its baseline of 4 files / 6 cases.
`HostStartError` is exported (`apps/vscode-dsh/src/index.ts:25`), so embedders can classify.

**O6 — relative paths are classified `missing`.** `resolveNodeExecutableSpec` returns a caller-supplied
value verbatim (`launch.ts:136-139`), so `dsh.nodeBin: "node"` is probed as a relative path and fails as
`missing` with `(no such file)`. That is the intended consequence of "never consult `PATH`" (AC-6), the
remedy still offers both configuration inputs, and probe C4a/C4b show the two whitespace rules are
independent; worth knowing only because the setting's description does not say "absolute".

## AC-by-AC verification

| AC | Implementation | Runtime evidence (mine, unless noted) | Verdict |
|----|---|---|:--:|
| AC-1 | `.nvmrc` = 24.3.0; root `engines.node` = `EXPECTED_NODE_RANGE` (`node-env-guard.ts:18`) | `node-env-guard.spec.ts:342-345` (range identical to `engines`), `:347-352` (exactly one version line admitted by the range), `:353-358` (real subprocess on `process.execPath` → `ok:true`); probe case C3/C4 output shows real probe execution | ✅ |
| AC-2 | `docs/development.md:105` + `docs/development.zh.md:110` (floor, `engines.node` source, both APIs, `.jsonl.zstd` link) | `node-env-guard.spec.ts:361-370` asserts both docs carry `.nvmrc`, the pinned release, `DSH_NODE_BIN`, `dsh.nodeBin`; both docs read directly | ✅ |
| AC-3 | `docs/development.md:109/121/127`, `docs/development.zh.md:114/126/132` | Text present in both languages; this phase's suite asserts only `.nvmrc`/pinned/inputs (`:361-370`) — the structural assertion is a reviewer/verifier step (also raised as review-design S3) | ✅ |
| AC-4 | `validateNodeEnvironment` (`node-env-guard.ts:115-147`): `stat`+`X_OK`, then a real `execFile` subprocess probe (`:249-265`), then capability comparison (`:138-145`) | `node-env-guard.spec.ts:118-128` (23.11.0 accepted), `:130-141`, `:185-198`, `:203-210`, `:212+`; probes C1/C2/C3 executed real stand-ins and produced the three distinct kinds | ✅ |
| AC-5 | `launch.ts:132-135` (environment wins); consumed at `:177-192` | `launch.spec.ts:232-247` (`/environment/node` wins, `ELECTRON_RUN_AS_NODE` undefined on an Electron host), `:269-273`; probe C4c | ✅ |
| AC-6 | `launch.ts:140-144` (`process.execPath`, `electronRunAsNode` from `process.versions.electron`) + `:180-182` injection | `launch.spec.ts:289-297` (Electron host → `process-exec-path`, env `'1'`), `:299-314` (a `PATH`-shadowing shim is proven *not* to be selected — falsifiable, not a text assertion); headless check of the Electron binary (item 6) | ✅ |
| AC-7 | `session-host.ts:282-286`: resolve → `assertNodeExecutable` → `listen`; the validated object is passed on (`:295`) | `session-host-preflight.spec.ts:124-153` (witness absent, socket absent, < 5 s), `:155-202` (setting source, single resolution via `:163/:183`), `:204-261` | ✅ |
| AC-8 | `formatNodeEnvironmentDiagnostics` (`node-env-guard.ts:167-176`) + `actualNodeState`/`remedy`/`pathQualifier` (`:190-221`) | `node-env-guard.spec.ts:253-275` (five lines, path, version, range, both APIs), `:319-340` (four kinds → four distinct texts); probes C1 (actual state) and the messages asserted at `session-host-preflight.spec.ts:191-200` | ✅ (see S2 for the remedy wording) |
| AC-9 | First line `Node environment check failed — source: …` (`node-env-guard.ts:170`); `HostStartError` carries `kind`/`diagnostic` (`session-host.ts:46-72`) | `session-host-preflight.spec.ts:192`, `:227`; message is the redacted diagnostic (`session-host.ts:313-321`) | ✅ |
| AC-10 | `package.json` `contributes.configuration.dsh.nodeBin` (string, default `""`, description); read at `extension.ts:2179-2188`, passed at `:2253-2256` | `node-env-guard.spec.ts:373-389` (manifest), `:455-478` (read + explicit pass-through + settings file byte-identical), `:480-498` (empty value passed through unchanged), `:500-519` (invalid path → `failed`, no rewrite), `:521-533` (non-string → fail loud before host start); `session-host-preflight.spec.ts:155-202`, `:204-235` (no fallback) | ✅ for (a)–(e); (f) is Phase 3 by design |

Key-path trace for the AD-1 invariant (read, not assumed): `session-host.ts:282-284` mints the object →
`:285` `assertNodeExecutable(nodeExecutable)` → `:295` the same binding is handed to `HarnessClient` →
`launch.ts:177` `options.nodeExecutable ?? …` → `:184` `command: nodeExecutable.path`. No second
resolution exists on the success path, and `session-host-preflight.spec.ts:163/:183` pins
"resolved exactly once" for the failing path. AD-2 holds: no version comparison exists anywhere
(`unsupported-version`, `nodeVersionSupported` and the old `resolveNodeExecutable` have zero hits in
source and tests); `version` appears only in the diagnostic fields (`node-env-guard.ts:67`, `:220`).

## Discrepancies with implementation.md

1. §3.3's "22 pre-existing diagnostics in `extension.ts`" is not reproducible: the measured count is 3,
   at `2109-2111`, on unchanged lines. The claim it supports (zero new diagnostics) is confirmed
   independently (item 4). See O2.
2. §2's AC-4 row repeats `spec.md`'s `zstd`/`withResolvers` fixture payload, which the phase's own test
   does not use and which does not produce `missing-apis`. See S1 — the AC is met, the stated evidence
   recipe is not.
3. §4's deviation #7 (every `start()` failure now throws `HostStartError`) is accurate as stated; I
   confirmed no caller depends on the previous error identity and the app suite is unchanged (O5).
4. §2.1's eight boundary cases all exist and all are falsifiable; I re-derived the two whitespace rules
   behaviourally (C4a/C4b) rather than from the test names, and the `PATH` prohibition is falsified by a
   real shadowing shim (`launch.spec.ts:299-314`), not by a text assertion.
5. §5.2's deferral of `doc-sync` to Phase 4 matches `spec.md:100` ("Phase 4 only re-checks
   `pnpm run doc-sync`; it does not own the first fixes") and `:95` (Phase 1 owns the first `test:docs`
   run); the in-phase gate was run, tally = baseline. Not an avoidance.

## Unverified

* **Fresh `pnpm run test:docs` in this pass.** The earlier run in this review session gave
  `run-gates: 10 passed, 5 failed`, identical to the v8 baseline, with no Phase-1 file listed; the
  re-run was blocked by the sandbox, so the tally is taken from that earlier execution rather than
  re-measured. UNVERIFIED as a fresh measurement.
* **Whether a *pre-*#151012 VS Code build also exports `ELECTRON_RUN_AS_NODE` from the extension host.**
  The flag-setting code is present in current VS Code source and its mechanism was reproduced with this
  host's binary, but older or non-desktop hosts were not exercised. Marked UNVERIFIED; it narrows O1
  rather than confirming a defect.
* **A real Extension Development Host run of tier 3** (`process.exec-path` with no setting and no
  `DSH_NODE_BIN`) was not performed: launching VS Code on the host was blocked by the review sandbox and
  is Phase 3's remit anyway. Because Phase 3 presets `dsh.nodeBin`, that smoke will not cover tier 3;
  UNVERIFIED and knowingly out of this phase's test surface (see O1).
* **`packages/sdk/client` README/README.zh.md anchor resolution** was confirmed for the explicit anchor
  `<a id="choosing-the-node-executable">` in the Chinese page, but I did not re-run the link gate; the
  earlier `test:docs` tally is the only evidence on file.

No escalation items: this is the first phase of the workflow, so no completed upstream phase can be
affected by what I found.
