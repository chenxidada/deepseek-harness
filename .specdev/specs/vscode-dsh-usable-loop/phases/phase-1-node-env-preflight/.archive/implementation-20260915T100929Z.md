# Phase 1 implementation — `phase-1-node-env-preflight`

| Field | Value |
|---|---|
| Phase ID | `phase-1-node-env-preflight` (copied verbatim from `phase-plan.md` DAG JSON) |
| Workflow | `vscode-dsh-usable-loop` |
| Branch | `impl-phase-1-node-env-preflight` (all changes left in the working tree; nothing committed by this agent) |
| Executor | implementer (subagent); self-test only — the verdicts belong to the independent reviewer and verifier |
| Date (UTC) | 2026-09-15 |
| Upstream read in full | `phases/phase-1-node-env-preflight/spec.md`, `phases/phase-1-node-env-preflight/repo-exploration.md`, `requirements.md` (AC-1 – AC-10), `design.md` (AD-1, AD-2, AD-9, AD-10, AD-11), `tech-debt-registry.md` (read-only cross-check) |

Scope of this document: what changed, which acceptance criterion each change serves, and the command-plus-output evidence behind every runtime claim. `tech-debt-registry.md` gained no entry because this phase introduced no stub, placeholder, or deferred wiring; every path it adds is complete.

## 1. Change list

### 1.1 New files

| Path | Lines | Purpose |
|---|---:|---|
| `.nvmrc` | 1 | `24.3.0` — the machine-readable Node declaration AC-1 requires, naming the release this repository's checks were run against. |
| `apps/vscode-dsh/src/node-env-guard.ts` | 295 | The single pre-flight entry point: `validateNodeEnvironment()`, the throwing wrapper `assertNodeExecutable()`, the failure taxonomy, the five-element diagnostic renderer, the executable/permission probe, and the capability probe that runs a candidate as a real subprocess. |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` | 535 | 24 runtime cases: positive capability report, every failure kind, five-element diagnostic, manifest contribution, extension setting read, and the `.nvmrc` / `engines.node` / docs consistency checks (AC-1, AC-2, AC-4, AC-8, AC-9, AC-10). |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts` | 327 | 7 runtime cases for the spawn-order contract: gate → `bridge.listen` → spawn, with spawn observed through witness files rather than a mock (AC-4 order, AC-5 c, AC-7, AC-8, AC-10 c/d). |

### 1.2 Modified files

| Path | Change |
|---|---|
| `apps/vscode-dsh/package.json` | Added the first `contributes.configuration` block in `apps/`: the `dsh.nodeBin` string property, default `""`, scope `machine-overridable`, with a description naming the resolution order, what an empty value means, and the API (not version) basis of the pre-flight. |
| `apps/vscode-dsh/src/extension.ts` | `VsCodeLike` gained `workspace.getConfiguration`; `readNodeBinSetting()` reads `dsh.nodeBin` and fails loud on a non-string value before any host exists; `createStartHostPort()` passes `nodeBinSetting` into `IdeSessionHost.start()`; a `node-environment` failure is reported through the existing diagnostic path. |
| `apps/vscode-dsh/src/session-host.ts` | Added `HostStartError`/`HostStartErrorKind`, `IdeSessionHostStartOptions.nodeExecutable` and `.nodeBinSetting`, and reordered `start()` to `resolve → assertNodeExecutable → bridge.listen → client start`. The `HarnessClient` receives the same `ResolvedNodeExecutable` object the gate validated. |
| `apps/vscode-dsh/src/index.ts` | Additive re-exports of the guard types, constants, error classes, and `HostStartError`. |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`, `phase2-auto-ready.spec.ts`, `phase4-new-conversation-chrome.spec.ts` | Each inline duck-typed `vscode` double gained `workspace.getConfiguration('dsh')`, so the extension's new setting read does not throw in suites that predate it. |
| `packages/sdk/client/src/types.ts` | Added `NodeExecutableSource`, `ResolvedNodeExecutable`, `NodeExecutableRequest`, and `HarnessClientOptions.nodeExecutable` — all additive. |
| `packages/sdk/client/src/launch.ts` | `resolveNodeExecutableSpec()` is now the single resolution entry (`DSH_NODE_BIN` → `nodeBinSetting` → `process.execPath`), replacing the path-only `resolveNodeExecutable()`; `resolveDshLaunch()` consumes the caller's `ResolvedNodeExecutable` and injects `ELECTRON_RUN_AS_NODE=1` only for `process.execPath` under Electron. |
| `packages/sdk/client/src/index.ts` | Additive re-exports: `resolveNodeExecutableSpec`, `NodeExecutableRequest`, `NodeExecutableSource`, `ResolvedNodeExecutable`. |
| `packages/sdk/client/tests/launch.spec.ts` | Extended (not replaced) with 9 `it` blocks / 11 cases covering the three tiers, the Electron interaction, and the boundary inputs. |
| `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | New "Choosing the Node executable" section documenting the function, the tier order, and that probing/diagnosis belongs to the embedding application; pairing record re-recorded. |
| `docs/development.md` + `development.zh.md` + `development.i18n.yaml` | New `### Node environment` section: floor and its declaring file, `.jsonl.zstd` API dependency, the resolution order, the repository-side mechanism table, and the local-environment checklist split into *Terminal side* and *Extension subprocess side*; the `### Prerequisites` Node bullet now links to it; pairing record re-recorded. |

### 1.3 Modified or untracked in this worktree, but **not** this phase

Listed so HG-3 does not attribute them to Phase 1. Each has a modification time from 2026-09-14 or from earlier today, before this agent started; none was opened for writing by this phase.

| Path | State | Note |
|---|---|---|
| `pnpm-lock.yaml` | modified (7+/4−) | Pre-existing; this phase never ran an install (`--config.verify-deps-before-run=false` throughout). |
| `apps/vscode-dsh/webview/dist/assets/index.{css,js}` | modified | Pre-existing webview build output. |
| `.cursor/skills/project-build/SKILL.md`, `.specdev/specs/workflows.json` | modified | Pre-existing. |
| `.cursor/**`, `.trae/**`, `.explore/`, `.mcp.json`, `opencode.jsonc`, `docs/wiki/**`, `.wiki-work/`, `knowledge-base-mcp.sh` | untracked | Pre-existing tool/config/knowledge trees. |
| Thousands of `packages/**/src/*.d.ts`, `*.js`, `*.js.map`, `*.d.ts.map` | untracked | In-tree build residue. It is also the dominant source of the red `lint` baseline (single files reaching hundreds of diagnostics) and of `verify-export-jsdoc` noise; not produced by this phase. |

## 2. Acceptance-criterion coverage

| AC | Where it is implemented | What proves it |
|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0`; `EXPECTED_NODE_RANGE` is a copy of the root `engines.node` | `node-env-guard.spec.ts` → *pins exactly one machine-readable version that the declared range admits*: `.nvmrc` holds exactly one semver line, `rangeAdmits('^22.19.0 \|\| >=24.0.0', '24.3.0')` holds, and `validateNodeEnvironment(process.execPath)` reports `ok:true`; *keeps the enforced range identical to the root engines field*: `engines.node` === `EXPECTED_NODE_RANGE`; *names the pinned release in both developer docs*: both docs contain `.nvmrc` and the pinned version. |
| AC-2 | `docs/development.md` § `### Node environment` (+ zh twin) | The section names the minimum (22.19 on the 22 line, 24 and later), the declaring file (`engines.node` in the root `package.json`), both APIs (`zlib.createZstdDecompress`, `Promise.withResolvers`), and ties the APIs to `.jsonl.zstd` session logs. |
| AC-3 | Same section, two checklists | *Repository-side responsibilities* is a 5-row table, every row carrying a decidable command (`pnpm run typecheck`, `pnpm run test apps/vscode-dsh`, `pnpm run test packages/sdk/client`, `pnpm run test:docs`, `pnpm run doc-sync`). *Local-environment responsibilities* is split into `Terminal side` (3 bullets: version check, `nvm use` / `n 24.3.0`, `PATH` prepend) and `Extension subprocess side` (3 bullets: setting or `DSH_NODE_BIN`, `--version` confirmation, window reload). No entry merges the two sides into one instruction. |
| AC-4 | `validateNodeEnvironment()` in `node-env-guard.ts`, called from `IdeSessionHost.start()` before `bridge.listen`; all three sources flow through `resolveNodeExecutableSpec()`, so one gate covers all of them | (a) `inspectExecutableFile()` checks existence, regular-file, and `X_OK`; (b) `probeNodeApis()` runs the candidate as a real subprocess asking for `zlib.createZstdDecompress` and `Promise.withResolvers`. Cases: positive report on this machine's qualifying Node; `missing`; `not-executable`; `missing-apis` from a stand-in reporting `{"version":"20.16.0","zstd":false,"withResolvers":false}` with both API names listed. |
| AC-5 | `resolveNodeExecutableSpec()` reads `DSH_NODE_BIN` first, treating only the empty string as unset | `launch.spec.ts`: env set → `{source:'dsh-node-bin'}` and `ELECTRON_RUN_AS_NODE` absent even with `process.versions.electron` defined; **(b)** env + setting both non-empty → *prefers a non-empty DSH_NODE_BIN over the configuration setting*; the asymmetry is pinned by *treats an empty DSH_NODE_BIN as unset and falls through to the setting* versus *uses a whitespace-only DSH_NODE_BIN as given, because only the empty value counts as unset*; `session-host-preflight.spec.ts`: `DSH_NODE_BIN` naming a real shim → the shim ran and a real Node child ran the runtime script, while an unusable setting never reached a spawn. |
| AC-6 | Tier 3 is `process.execPath`; `electronRunAsNode` is true only for that source under Electron | `launch.spec.ts`: Electron host + no env + empty setting → `{source:'process-exec-path', electronRunAsNode:true}` and `ELECTRON_RUN_AS_NODE === '1'`; a shimmed `node` injected into `PATH` is asserted not to be the spawned executable. |
| AC-7 | `start()` order is now gate → `bridge.listen` → spawn | `session-host-preflight.spec.ts`, for an unusable candidate selected from `DSH_NODE_BIN` and for a missing and an unusable candidate selected from the setting: `start()` rejects with `kind === 'node-environment'`, the witness file proving a child process ran stays absent, `existsSync(bridgeSockPath)` is false, `host.status === 'error'`, and the elapsed time is far below `initializeTimeoutMs` (60 000 ms configured, asserted < 5 000 ms) — so the failure is neither spawn-then-crash nor a handshake timeout. |
| AC-8 | `formatNodeEnvironmentDiagnostics()` renders exactly five lines, one per element | Every failure kind yields a five-line message; the four messages are pairwise distinct. The setting-selected `missing-apis` message is asserted to contain the candidate path, the detected version (`20.16.0`), the expected range (`22.19` and `24`), both missing API names, and both authorised inputs (`DSH_NODE_BIN` and `dsh.nodeBin`). At extension level, the failed start's user-visible message is asserted to contain the offending path and `dsh.nodeBin`. |
| AC-9 | The text classifies the failure as a Node-environment problem; the carrier types are `NodeEnvironmentError` and `HostStartError{kind:'node-environment'}` | The first diagnostic line contains `Node environment`; the message names the detected version against the expected range and offers environment fixes only. No diagnostic text attributes the failure to dsh code, and no code path converts it into a generic runtime error. |
| AC-10 | (a) `apps/vscode-dsh/package.json` `contributes.configuration.dsh.nodeBin`; (b) documented priority; (c)–(e) runtime | (a) property declared `string`, default `""`, description naming the priority and "leave empty"; (b) `docs/development.md` (+ zh) states `DSH_NODE_BIN` > `dsh.nodeBin` > Extension Host Node; (c) `launch.spec.ts`: setting-only → `{path:'/y/node', source:'vscode-setting'}`, and the object the gate validates is the object handed to `resolveDshLaunch`; (d) `session-host-preflight.spec.ts`: the setting names an absent path → reject, `kind === 'node-environment'`, no witness file, no bridge socket, `status === 'error'`, and `resolveNodeExecutableSpec` was called **exactly once** (no second resolution to obtain another source); (e) `node-env-guard.spec.ts`: the extension reads `workspace.getConfiguration('dsh').get('nodeBin')` from a real `settings.json`, passes the value explicitly to the host, passes an empty value through unchanged, and fails loud on a non-string value. |

**Cross-phase dependency (AC-10 f, recorded here for the verifier's `verification.md`)**: AC-10's real-machine branch — the pre-placed `settings.json` being consumed by the resolution chain inside a real Extension Development Host — is provided by the Phase 3 smoke script per AD-11. Phase 1 judges (a)–(e) only. Phase 1 does **not** claim that branch, and it must not be recorded as a known gap that permits PASS.

**Evidence split for the invalid-setting branch (AC-10 d)**: the spec's ruling requires two labelled parts. This phase supplies (i) *proxy evidence* as an assertion that the pre-placed `settings.json` is byte-identical after the run, in `node-env-guard.spec.ts` (both the valid-path and the invalid-path cases), and (ii) *non-proxy negative evidence* as the absence of every spawn marker in `session-host-preflight.spec.ts` (witness file absent, bridge socket absent, `status === 'error'`, elapsed far below the timeout). No new observation point was introduced in product code; `resolveNodeExecutableSpec` call counting happens in the test only, through a spy on the imported module namespace.

### 2.1 Boundary and reverse cases required by the spec

| Required case | Test |
|---|---|
| Candidate absent → `missing` | `node-env-guard.spec.ts` *classifies each failure kind distinctly*; `session-host-preflight.spec.ts` *refuses a missing path named by the setting…* and *refuses a missing path named by the environment variable…* |
| Candidate present, not executable → `not-executable` | `node-env-guard.spec.ts` (mode `0o644` file) |
| Candidate executable, missing APIs → `missing-apis` | `node-env-guard.spec.ts`; `session-host-preflight.spec.ts` (both sources) |
| `DSH_NODE_BIN` empty string = unset, falls to the next tier | `launch.spec.ts` *treats an empty DSH_NODE_BIN as unset and falls through to the setting* |
| `DSH_NODE_BIN` set but invalid → fail loud, no fallback | `launch.spec.ts` (resolution returns the invalid path verbatim, and a whitespace-only value is used as given) and `session-host-preflight.spec.ts` *refuses a missing path named by the environment variable…* (reject, no spawn, no fallback to another source) |
| `dsh.nodeBin` = `"   "` → unset, next tier | `launch.spec.ts` *treats a `''` / `'   '` configuration setting as unset and falls through to process.execPath*, which pins the asymmetry against the `DSH_NODE_BIN` whitespace case |
| `dsh.nodeBin` non-empty but invalid → fail loud, no fallback to `process.execPath` | `session-host-preflight.spec.ts` *refuses an unusable executable that came from the configuration setting* and *refuses a missing path named by the setting…* |
| All sources empty on a non-Electron host → explicit error, never a `PATH`-resolved `node` | `launch.spec.ts` *never resolves Node through PATH when every source is unset* (the shimmed `PATH` `node` is proven not to be the executable) |

## 3. Test evidence

All commands run from `/workspace/chendecheng/code/need/deepseek/deepseek-harness` after `export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"`, with `pnpm --config.verify-deps-before-run=false` (abbreviated `$PNPM` below).

### 3.1 Differential result (the acceptance currency for Phase 1)

| Command | Baseline | Now | New failures |
|---|---|---|---|
| `$PNPM run typecheck` | green | **exit 0** | none |
| `$PNPM run test packages/sdk/client` | green (3 files / 73 cases) | **green, 3 files / 84 cases** (73 + 11 added) | none — the 11 additions pass |
| `$PNPM run test apps/vscode-dsh packages/sdk/client` | app suite: 48 files / 320 cases, **4 files / 6 cases red** | 53 files / 435 cases, **4 files / 6 cases red**, 428 passed, 1 skipped | none — same file set and same failing-case set as the baseline |
| `$PNPM run lint` | red | red | none from this phase: **0** diagnostics in all four new/modified test or guard files, **0** in every touched `packages/sdk/client` file; the 24 diagnostics across the three modified `apps/vscode-dsh/src` files predate this phase (see 3.3) |
| `$PNPM run test:docs` | red — `run-gates: 10 passed, 5 failed` | red — `run-gates: 10 passed, 5 failed` | none; zero occurrences of this phase's four documentation files in any violation list |

The four red app-suite files are unchanged in identity and count from the baseline: `spike-t0b-continue-capability.spec.ts` (whole file, root cause `scripts/test-invariants.ts:188` reading `ACTIVE` of `undefined`), `spike-t0a-replay-rebuild.spec.ts` (4 cases, same root cause), `panel-close-delete.e2e.spec.ts` (1 case), `verifier-phase1/layer-a-rtl.spec.tsx` (1 case). None of them is a file this phase touched, and all six failures reproduce with the same stack shape as the baseline snapshot. The membership of the last two varies between baseline runs of the same concurrency-sensitive family, but the file/case totals are identical to the baseline in every run recorded here.

### 3.2 This phase's own cases

| Command | Result |
|---|---|
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | `Test Files 3 passed (3)`, `Tests 57 passed (57)`, exit 0 |
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts` | `Tests 24 passed (24)` |
| `$PNPM run test apps/vscode-dsh/tests/session-host-preflight.spec.ts` | `Tests 7 passed (7)` |
| `$PNPM run test packages/sdk/client/tests/launch.spec.ts` | `Tests 26 passed (26)` (15 at HEAD) |

Every AC-4 / AC-7 / AC-8 / AC-10 runtime case constructs its input, executes it, and asserts the output; none is a static assertion. `node-env-guard.spec.ts` spawns each candidate with `node:child_process` for real, and `session-host-preflight.spec.ts` records the spawned executable by having the child write a witness file (`process.execPath` and `argv`), so "no child process ran" is observed rather than assumed.

### 3.3 Lint delta, per file

`grep` of the full `lint` output for each file this phase touched:

| File | Diagnostics | In added lines? |
|---|---:|---|
| `apps/vscode-dsh/src/node-env-guard.ts` (new) | 0 | — |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts` (new) | 0 | — |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` (new) | 0 | — (2 were introduced during development, `@stylistic(arrow-parens)` and `typescript(no-unnecessary-type-assertion)`, and both were fixed before this run) |
| `apps/vscode-dsh/src/extension.ts` | 22 lines: 271, 375, 380, 385, 407, 425, 662, 750, 1004, 1102, 1152, 1418, 1450, 1492, 1534, 1791, 2109, 2110, 2111, 2270, 2272 | no — added ranges are 48, 223–236, 2172–2190, 2253, 2256; every diagnostic is outside them and, after subtracting this phase's insertions, resolves to the same line as at HEAD |
| `apps/vscode-dsh/src/session-host.ts` | 1 line: 590 (`require-await`) | no — added ranges are 14, 16, 28, 41–74, 101–104, 248–249, 280–285, 295, 316–322; line 590 is unchanged code |
| `apps/vscode-dsh/src/index.ts` | 1 line: 97 (`no-deprecated` on `buildThinChatHtml`) | no — the added range is 25–39 |
| `packages/sdk/client/{src/launch.ts,src/types.ts,src/index.ts,tests/launch.spec.ts}` | 0 | — |
| `apps/vscode-dsh/package.json`, the three duck-typed `vscode` spec files | 0 in the manifest; the spec files' diagnostics are limited to their pre-existing lines (23, 26, 78, 81, 148, 188, 200, 215, 229, 231, 281, 351, 390, 401 / 102, 106, 109, 123, 127, 134, 227, 267, 300, 320, 360 / 158, 192), all outside the single 5-line insertion each received | no |

The modified-file reasoning uses pure-insertion hunks (`git diff -U0` shows `@@ -N,0 +M,k @@` for every app file hunk except four that replace a single line inside `session-host.ts`'s reworked `start()` and one inside `src/index.ts`'s export block), so shifting HEAD line numbers by the insertion count maps each diagnostic to unchanged source text.

### 3.4 Real-machine probes (evidence for AC-1 b and AC-4 a)

Probed through the shipped guard by running the compiled module with `tsx` and calling `validateNodeEnvironment({path, source, electronRunAsNode:false})`:

| Interpreter | Reported version | `zstd` | `withResolvers` | Verdict |
|---|---|---|---|---|
| `/usr/local/n/versions/node/24.3.0/bin/node` | 24.3.0 | true | true | `ok:true` — the floor does not misfire on a qualifying Node |
| `/usr/bin/node` | 18.12.1 | false | false | `missing-apis`, both names listed |
| `~/.nvm/versions/node/v22.14.0/bin/node` | 22.14.0 | false | true | `missing-apis`, `zlib.createZstdDecompress` only |
| `/usr/local/n/versions/node/22.9.0/bin/node` | 22.9.0 | false | true | `missing-apis`, `zlib.createZstdDecompress` only |

The last two rows are also the AD-2 demonstration: those interpreters are below the declared floor, yet the reported kind is `missing-apis` with the API names, never a version-based rejection, and an interpreter outside the declared range that does provide both APIs is accepted.

Two further machine measurements were taken while writing the AC-3(a) verification column, because the first wording of that row asserted something that is not true:

| Probe | Measured |
|---|---|
| `env -i PATH=/usr/bin:/bin sh -c 'command -v node; node --version'` | `/usr/bin/node`, `v18.12.1` |
| `PATH="/usr/bin:/usr/local/node/bin:$PATH" $PNPM run typecheck` | exit 1, `ERROR: This version of pnpm requires at least Node.js v22.13` |

## 4. Deviations and conflicts with the phase's stated premises

1. **AD-2 was violated by the first revision of this phase and has been corrected.** The initial `node-env-guard.ts` gated on the version string (`unsupported-version`). AD-2 states the gate is decided by capability and that the version is diagnostic only, and AC-4(c) requires the `{"version":"20.16.0",…}` stand-in to classify as `missing-apis`. The version comparison was removed, `unsupported-version` and `nodeVersionSupported()` were deleted, and the capability tests were reordered accordingly. Recorded here because the discarded revision is visible in the branch's earlier runs.
2. **A fourth failure kind, `unusable`, exists beyond the spec's three names.** It covers a candidate that exists and is executable but cannot report Node capabilities (non-zero exit, non-report output, or timeout). Folding it into `missing-apis` would have printed API names that were never observed; the kind keeps the message truthful while satisfying AC-7's obligation to block the spawn. The spec enumerates no closed taxonomy, and no AC requires exactly three kinds.
3. **Whitespace asymmetry is deliberate and matches the spec's boundary list.** `DSH_NODE_BIN='   '` counts as *set* (the value is used as given, then fails the gate loud), while `dsh.nodeBin='   '` counts as *unset* and falls through. The spec's boundary list asks for exactly this split; it is documented here so it is not read as an inconsistency.
4. **`docs/development.md` verification-wording correction.** The first revision claimed `pnpm run typecheck` refuses to start when the interpreter is outside `engines.node`. Measurement (3.4) shows the refusal comes from pnpm's own floor (22.13), not from `engines.node`, and that a clean `PATH` on this machine resolves `/usr/bin/node` v18.12.1 rather than the v20.16.0 the spec's snapshot names. The AC-3(a) row now states three decidable checks (`node --version` admitted by `engines.node`, `.nvmrc` naming the release the checks ran against, `typecheck` exiting 0) and the terminal-side bullet no longer claims which range pnpm enforces.
5. **Machine facts that differ from the spec snapshot.** The spec calls `/usr/local/n/versions/node/24.3.0` the only qualifying install; `/usr/local/bin/node` is a second, genuine v24.3.0 binary on this machine, and `~/.nvm/versions/node/v20.16.0` exists but is not what a clean `PATH` resolves. Neither difference changes the implementation.
6. **The two checklist titles and the two face titles are bold lead-ins, not ATX headings.** The section's siblings in `docs/development.md` use `##`/`###` only and lead nested lists with bold text, so the new sub-structure follows that house style. Text matching (`仓库侧职责` / `本机环境侧职责`, `终端侧` / `扩展子进程侧`, and their English counterparts) is intact for the verifier's structural assertions; if the gate's convention requires ATX headings, that is a one-line change per title.
7. **`HostStartError` is additive but changes the thrown class for every `start()` failure**, and covers both `node-environment` and `start-failed`. The pre-existing app suites still pass; the type is exported so callers can discriminate.
8. **`contributes.configuration` also carries a `title`.** Only the property block is required; the title is additive and groups the setting in the VS Code settings UI.
9. **No published name was removed.** `resolveNodeExecutable()` was private to `launch.ts` (not re-exported at HEAD), so replacing it with `resolveNodeExecutableSpec()` alters no public surface; `packages/sdk/client/src/index.ts` changes are additions only.

## 5. Unresolved items and risks

1. **AC-10(f)** (real Extension Development Host consuming the pre-placed `settings.json`) remains a Phase 3 obligation, as the spec requires. Phase 1 must not be judged complete or incomplete on that branch.
2. **`pnpm run doc-sync`** was not run: the spec assigns the first `test:docs` pass to this phase and reserves `doc-sync` for Phase 4's re-check. `test:docs` is recorded above with its exact tally.
3. **The red `lint` baseline is untouched by design.** Its dominant component is in-tree build residue (`packages/**/src/*.d.ts` and maps, untracked, hundreds of diagnostics each) plus the pre-existing `no-unsafe-*` class in `apps/vscode-dsh/tests/**`, whose structural cause is that `apps/vscode-dsh/tsconfig.json` includes only `src`, leaving those test files outside any TypeScript program. Repairing that class would mean adding the test directory to a program, which would change the `typecheck` baseline this phase is required to keep green, so it stays out of scope.
4. **`apps/vscode-dsh` has no coverage gate** and `packages/sdk/client` still holds its per-file 100% requirement; this phase added no uncovered branch to the SDK — its new code is exercised by `launch.spec.ts`.
5. **The `unusable` kind is the only place this phase could hide a regression** that unit tests would not see, because it depends on subprocess behavior (exit code, output, timeout). It is covered by a real stand-in that exits non-zero; the timeout branch is not separately exercised, since inducing it would require a long-running fixture.
6. **Two tracked files show as modified in the working tree but are not this phase's work**: `pnpm-lock.yaml` (mtime 2026-09-14 16:08) and `apps/vscode-dsh/webview/dist/assets/index.{js,css}` (mtime 2026-09-14 09:21). Both predate this phase's files (2026-09-15) and consist of pnpm re-resolution entries and a previously built webview bundle. They must be excluded from the Phase commit.

## 6. Documentation gates (commands actually executed)

| Command | Result |
|---|---|
| `$PNPM run verify-translation-pairing --write docs/development.md` | `recorded docs/development.i18n.yaml` (run twice: once for the initial section, once after the verification-wording and anchor corrections) |
| `$PNPM run verify-translation-pairing --write packages/sdk/client/README.md` | `recorded packages/sdk/client/README.i18n.yaml` |
| `$PNPM run test:docs` | exit 1 — `run-gates: 10 passed, 5 failed, 0 skipped`, the same tally as the baseline; failing gates are `markdown links`, `translation pairing`, `markdown wrap`, `agent note format`, `documentation standard tests` |

The five failing gates were checked for this phase's files line by line. `translation pairing` reports `docs/wiki/**` pages without English counterparts, `packages/README.*`, and `packages/sdk/server/README.*` — all unmodified by this phase (verified: `git status -s` reports none of them, and `apps/vscode-dsh/README.md`, `apps/vscode-dsh/tests/fixtures/screenshots/README.md`, `.agents/notes/implemented/architecture/2026-09-04-ide-profile-dual-channel.md`, and `packages/specdev/command-specdev/README.md` are likewise unmodified, so their violations are inherited). `markdown links` reports `docs/wiki/**` and two `README.zh.md` anchors in `packages/ide/ide-bridge` and `packages/bundle/ide`. One violation **was** introduced by this phase and fixed within it: linking `#node-environment` from `docs/development.zh.md` failed because the Chinese page had no explicit anchor on its Chinese heading; adding `<a id="node-environment"></a>` above `### Node 环境` cleared it, and the final `test:docs` run reports zero occurrences of this phase's files anywhere in the output.
