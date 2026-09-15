# Phase 1 implementation — `phase-1-node-env-preflight`

| Field | Value |
|---|---|
| Phase ID | `phase-1-node-env-preflight` (copied verbatim from `phase-plan.md` DAG JSON) |
| Workflow | `vscode-dsh-usable-loop` |
| Branch | `impl-phase-1-node-env-preflight` (all changes left in the working tree; nothing committed by this agent) |
| Executor | implementer (subagent); self-test only — the verdicts belong to the independent reviewer and verifier |
| Date (UTC) | 2026-09-15 |
| Revision | rework round 1, answering `review.md` **MUST-FIX** (M1 + M2 + S1–S10). The previous revision of this file was archived by this agent at startup to `phases/phase-1-node-env-preflight/.archive/implementation-20260915T100929Z.md` (`implementation-zh-20260915T100929Z.md` likewise) and is superseded, not deleted. |
| Upstream read in full | `phases/phase-1-node-env-preflight/spec.md`, `review.md`, `review-correctness.md`, `review-design.md`, `review-connectivity.md`, `repo-exploration.md`, `requirements.md` (AC-1 – AC-10), `design.md` (AD-1 – AD-11), `tech-debt-registry.md` (read-only cross-check) |

Scope of this document: what changed in this rework round, which acceptance criterion and which review item each change serves, and the command-plus-output evidence behind every runtime claim. `tech-debt-registry.md` gained no entry: this phase introduces no stub, placeholder, or deferred wiring, and the registry's existing entries were neither modified nor re-registered.

## 1. Rework round response (M1, M2, S1–S10)

### 1.1 Summary

| # | Verdict | State | Where |
|---|---|---|---|
| M1 | 🔴 must-fix | **done** | `docs/development.md:131`, `docs/development.zh.md:136`, `docs/development.i18n.yaml` |
| M2 | 🔴 must-fix | **done** | `apps/vscode-dsh/src/auto-start-orchestrator.ts:26-55,220`, `apps/vscode-dsh/src/session-host.ts:27,42-51,327`, `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:144-177`, `apps/vscode-dsh/tests/node-env-guard.spec.ts:666` |
| S1 | 🟡 should-fix | **done** | this file, §3 AC-4 row |
| S2 | 🟡 should-fix | **done** | `apps/vscode-dsh/src/node-env-guard.ts:192-201`, assertion `apps/vscode-dsh/tests/node-env-guard.spec.ts:415-417` |
| S3 | 🟡 should-fix | **done, with a measured correction** | this file, §4.3 |
| S4 | 🟡 should-fix | **done** | this file, §5.10 |
| S5 | 🟡 should-fix | **done** | `apps/vscode-dsh/tests/node-env-guard.spec.ts:629-646` |
| S6 | 🟡 should-fix | **done** | `apps/vscode-dsh/tests/node-env-guard.spec.ts:96-165,474-499` |
| S7 | 🟡 should-fix | **done** | `docs/development.md:105`, `docs/development.zh.md:110`, pairing re-recorded |
| S8 | 🟡 should-fix | **done** | this file, §5.11 |
| S9 | 🟡 should-fix | **done** | `apps/vscode-dsh/src/node-env-guard.ts:254-258`, `apps/vscode-dsh/tests/node-env-guard.spec.ts:240-267` |
| S10 | 🟡 should-fix | **done** | this file, §5.12 |

No item is skipped. §1.3 lists the three places where the rework deliberately did something other than the literal wording of the review item, with the reason.

### 1.2 Per-item detail

**M1 — AC-3(d) command tokens.** `docs/development.md:131` previously read "Reload the window after changing either …" as a bare instruction. It now names the executable inputs and the reload action by its command id: *"Reload the window after changing either `dsh.nodeBin` or `DSH_NODE_BIN`: run `Developer: Reload Window` (`workbench.action.reloadWindow`) from the Command Palette. The extension reads the setting on every start and does not cache it."* The Chinese twin carries the same tokens (`Developer: Reload Window` / `workbench.action.reloadWindow` / `dsh.nodeBin` / `DSH_NODE_BIN`). Re-recorded with `$PNPM run verify-translation-pairing --write docs/development.md`, which rewrote both hashes in `docs/development.i18n.yaml` (see §7). `$PNPM run test:docs` afterwards reports the baseline tally `10 passed, 5 failed` and **zero** occurrences of `development.md` or `development.zh.md` anywhere in its output.

**M2 — the typed `node-environment` class survives the orchestrator hop.** Three changes, all in the classification path, none extending into Phase 2's diagnostic machinery:

1. `StartErrorKind` now contains the class the host throws. `apps/vscode-dsh/src/auto-start-orchestrator.ts:26-27` holds one array, `START_ERROR_KINDS = ['missing-credentials', 'node-environment', 'process-failed']`, and `:29-37` derives `StartErrorKind` from it, so the type and the runtime vocabulary cannot drift apart. The unused `'other'` umbrella member is gone.
2. The catch no longer flattens by elimination. `:39-55` adds `startErrorKindOf(error)`, which reads the machine-readable `kind` off the thrown object and accepts only a member of the vocabulary; anything unrecognised becomes the single generic member `process-failed`. `:220` now reads `this.errorKind = startErrorKindOf(error)` (the previous two-branch ternary recognised only `missing-credentials`). The no-live-connection path at `:214` keeps reporting `process-failed`.
3. The member sets are identical by construction, not by convention: `session-host.ts:27` imports `StartErrorKind` and `:42-51` declares `export type HostStartErrorKind = StartErrorKind`, whose JSDoc states the alignment and the meaning of `node-environment`. The generic catch-all at `:327` throws `HostStartError('process-failed', …)`; the name `'start-failed'` no longer exists anywhere.

Runtime cases were **required**, so the assertion is not type-level. `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:144-177` adds `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4, M2)')`: (a) `:145` pins the two vocabularies as the same set through a `SameSet<A extends B, B extends A>` helper; (b) `:150-164` throws the real `HostStartError('node-environment', …)` through the port and asserts `orch.getSnapshot().errorKind === 'node-environment'` plus an environment-scoped message (this is the hop the review found flattened); (c) `:166-176` throws a plain `Error('spawn EBADF')` and asserts the generic member, so the new fallback is pinned too. The end-to-end observation point is strengthened as well: `node-env-guard.spec.ts:648-671` drives a real extension activation whose `settings.json` names a missing path, and now asserts `snapshot.errorKind === 'node-environment'` (`:666`) on the snapshot the L2 projection exposes — this is the assertion the review demanded, and §4.4 records the probe that shows it goes red when the classification is flattened.

**S1 — AC-4 fixture field names.** §3's AC-4 row describes the stand-in as reporting `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}`. Code and tests were already correct (`node-env-guard.ts:275-282` narrows on `hasZstd`/`hasWithResolvers`; `node-env-guard.spec.ts:286-299` builds the same payload); only this summary's prose was wrong, and only the prose changed.

**S2 — the `process-exec-path` remedy no longer proposes `PATH`.** `apps/vscode-dsh/src/node-env-guard.ts:192-201` renders the third tier's remedy; `:200` now reads *"this is the Extension Host's own Node.js executable, so set `DSH_NODE_BIN` or the `dsh.nodeBin` setting to a Node.js `^22.19.0 || >=24.0.0` executable, or install a VS Code build whose bundled Node.js provides `zlib.createZstdDecompress` and `Promise.withResolvers`"* — the two levers that actually apply to that tier, plus the reinstall path. The JSDoc at `:185-191` records why the executable's owner is named instead of `PATH`. `PATH` no longer appears in any diagnostic. The assertion is in `node-env-guard.spec.ts:415-417`: the third tier's message must contain `this is the Extension Host's own Node.js executable, so set DSH_NODE_BIN` and must **not** contain `PATH`.

**S3 — lint numbers are measured values.** §4.3 replaces the earlier qualitative claim with per-file counts from this round's `$PNPM run lint`, plus the exact lines, plus the proof that no diagnostic falls on a line this phase added. It also records a correction to the review's own figure: the gate reports 22 diagnostics in `extension.ts`, not 3 — 3 is what the *same file* yields under `.oxlintrc.staged.json`, the reduced rule set `lint:fix` uses. Both numbers are reproduced in §4.3 with their commands. The zero-new conclusion is unchanged and now rests on measured data rather than on a running total.

**S4 — manifest deviation recorded.** §5.10 records the two `dsh.nodeBin` keys the phase added beyond the minimum: `scope: "machine-overridable"` and `markdownDescription`.

**S5 — a case that can falsify caching.** `node-env-guard.spec.ts:629-646` activates once, starts once against a `settings.json` naming `first-node`, rewrites the file to `second-node`, and starts again. It asserts the second snapshot's message contains `second` and does **not** contain `first`. The `vscode` double's `get()` re-reads the file on every call (`:564-571`), so the case falsifies both a cached setting value and a cached resolution. §4.4 records the probe: memoising `readNodeBinSetting` turns this case red.

**S6 — AC-3(a)(b) as executable assertions.** `node-env-guard.spec.ts:96-165` adds the machinery — `CHECKLIST_LABELS` (`repository` / `localEnvironment` / `faces`), `countOccurrences`, `sectionAfter`, `localEnvironmentEntries`, and `assertChecklistStructure`, which requires each of the four titles to occur exactly once and every local-environment entry to carry at least one decidable token from `DECIDABLE_ENTRY_TOKENS` (`nvm`, `n 24.3.0`, `export PATH=`, `node --version`, `DSH_NODE_BIN`, `dsh.nodeBin`, `workbench.action.reloadWindow`). `:474-499` runs it against both language files and then falsifies itself in place: for each face title it deletes that title from the document text and requires the *same* assertion to throw (`:486-492`). §4.4 additionally records an out-of-test probe on the real `docs/development.md`.

**S7 — the floor's ownership wording.** `docs/development.md:105` now says the floor *"has one owner, `engines.node` in the root `package.json`, which the extension mirrors in the range it enforces and a test keeps equal to that field"*, replacing "declared once". The Chinese twin at `:107` says the same. This matches the code: `EXPECTED_NODE_RANGE` is a copy, and `node-env-guard.spec.ts:444` fails if the copy and `engines.node` diverge. The pairing record was re-recorded in the same round as M1.

**S8** and **S10** are documented in §5.11 and §5.12 (routing decision; Phase 2 injection point).

**S9 — the probe now runs candidates in the mode they will be spawned in.** `apps/vscode-dsh/src/node-env-guard.ts:254-258` takes the `ResolvedNodeExecutable` instead of a bare path, builds an explicit environment, and sets `ELECTRON_RUN_AS_NODE=1` when `executable.electronRunAsNode`; `:260-264` passes that environment to `execFileAsync`. The caller at `:131` already held the object, so the gate now probes under exactly the conditions `resolveDshLaunch` will spawn with. `node-env-guard.spec.ts:240-267` proves it with a real stand-in that behaves as Node only when the flag is present: with `electronRunAsNode: true` the validation is `ok:true` (`:259`), and with `electronRunAsNode: false` the same file is `unusable` (`:265-266`) — so the case fails in either direction, whether the flag is wrongly omitted or wrongly injected. §4.4 records the probe that omitting the flag turns the first assertion red.

### 1.3 Deliberate differences from the review's literal wording

1. **`process-failed` is kept as the single generic member; the review did not ask for its removal and Phase 2 needs it.** M2 forbids keeping `'start-failed'` as a universal class, which is done. It does not ask to drop `process-failed`: the Phase 2 spec asserts `errorKind === 'process-failed'` for an unclassified failure on the boundary list, and AD-4 calls the extension additive. Removing it would break an approved downstream spec. What changed is that `process-failed` is now reached only through `startErrorKindOf`'s documented fallback and the `'other'` umbrella member is gone, so there is exactly one generic member rather than two.
2. **S3's figure is corrected rather than adopted.** The review states the measured value for `extension.ts` is 3; this round measures 22 under the gate command and reproduces the review's 3 only under `.oxlintrc.staged.json`. §4.3 shows both, names both commands, and keeps the zero-new conclusion, which holds under either rule set. Adopting 3 as *the* measured value would have replaced one unverifiable number with another.
3. **S5 is satisfied with a stronger mechanism than the one suggested.** The review proposed changing what the `vscode` double returns; the case instead rewrites a real `settings.json` between starts, so it also falsifies a cached file read, not just a cached value. The orchestrator-level effect the review asked for (the second start uses the new value) is asserted identically.

## 2. Change list

### 2.1 New files (this phase)

| Path | Lines | Purpose |
|---|---:|---|
| `.nvmrc` | 1 | `24.3.0` — the machine-readable Node declaration AC-1 requires, naming the release this repository's checks were run against. |
| `apps/vscode-dsh/src/node-env-guard.ts` | 303 | The single pre-flight entry point: `validateNodeEnvironment()`, the throwing wrapper `assertNodeExecutable()`, the failure taxonomy, the five-element diagnostic renderer, the executable/permission probe, and the capability probe that runs a candidate as a real subprocess in the caller's invocation mode. |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` | 687 | 27 runtime cases: capability gate, every failure kind, five-element diagnostic, the AC-3 structural assertions, the manifest contribution, the extension's setting read, and the `.nvmrc` / `engines.node` consistency checks (AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-10). |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts` | 327 | 7 runtime cases for the spawn-order contract: gate → `bridge.listen` → spawn, with spawns observed through witness files rather than a mock (AC-4 order, AC-5 c, AC-7, AC-8, AC-10 c/d). |

### 2.2 Modified files (both rounds; ★ = changed in this rework round)

| Path | Change |
|---|---|
| ★ `apps/vscode-dsh/src/auto-start-orchestrator.ts` | One `START_ERROR_KINDS` array feeds both the `StartErrorKind` type and the `startErrorKindOf` guard; `node-environment` is a member and `'other'` is gone; the catch classifies by the thrown object's `kind` (M2). |
| ★ `apps/vscode-dsh/src/session-host.ts` | `HostStartErrorKind` is now `StartErrorKind` itself (single vocabulary, AD-4); the generic catch-all throws `process-failed`; `HostStartError` / `HostStartErrorKind`, `IdeSessionHostStartOptions.nodeExecutable` / `.nodeBinSetting`, and the `resolve → assertNodeExecutable → bridge.listen → client start` order were added in the first round. |
| ★ `apps/vscode-dsh/src/node-env-guard.ts` | `probeNodeApis` takes the resolved executable and injects `ELECTRON_RUN_AS_NODE=1` for an `electronRunAsNode` candidate (S9); the `process-exec-path` remedy names the executable's owner and the two levers instead of `PATH` (S2). |
| ★ `apps/vscode-dsh/src/extension.ts` | `VsCodeLike` gained `workspace.getConfiguration`; `readNodeBinSetting()` reads `dsh.nodeBin` and fails loud on a non-string value before any host exists; `createStartHostPort()` passes `nodeBinSetting` into `IdeSessionHost.start()`; a `node-environment` failure is reported through the existing diagnostic path. |
| `apps/vscode-dsh/src/index.ts` | Additive re-exports of the guard types, constants, error classes, and `HostStartError`. |
| `apps/vscode-dsh/package.json` | First `contributes.configuration` block in `apps/`: the `dsh.nodeBin` string property with `default`, `scope`, `description`, and `markdownDescription`. |
| ★ `apps/vscode-dsh/tests/node-env-guard.spec.ts` | S6 structure assertions and helpers; S9 case; S2 assertion; S5 case; the L2 `errorKind === 'node-environment'` assertion (M2). |
| ★ `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | `SameSet` vocabulary pin plus three classification cases (M2). |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`, `phase2-auto-ready.spec.ts`, `phase4-new-conversation-chrome.spec.ts` | Each inline duck-typed `vscode` double gained `workspace.getConfiguration('dsh')`, so the extension's new setting read does not throw in suites that predate it (5 lines each, no other change). |
| `packages/sdk/client/src/types.ts`, `src/launch.ts`, `src/index.ts` | `ResolvedNodeExecutable` / `NodeExecutableRequest` / `NodeExecutableSource` and the single `resolveNodeExecutableSpec()` entry (all additive; `resolveDshLaunch` consumes the caller's object and injects `ELECTRON_RUN_AS_NODE=1` only for `process.execPath` under Electron). |
| `packages/sdk/client/tests/launch.spec.ts` | Extended (not replaced) with 11 cases covering the three tiers, the Electron interaction, and the boundary inputs. |
| `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | New "Choosing the Node executable" section; pairing re-recorded. |
| ★ `docs/development.md` + `development.zh.md` + `development.i18n.yaml` | New `### Node environment` section (floor and its owner, the `.jsonl.zstd` API dependency, the resolution order, the repository-side mechanism table, the local-environment checklist split into a terminal side and an extension-subprocess side); M1 gives the reload entry its command tokens and S7 corrects the ownership wording; pairing re-recorded. |

### 2.3 Modified or untracked in this worktree, but **not** this phase

Listed so HG-3 does not attribute them to Phase 1. Each has a modification time of 2026-09-14 or earlier, before this agent started; none was opened for writing by this phase.

| Path | State | Note |
|---|---|---|
| `pnpm-lock.yaml` | modified | Pre-existing; this phase never ran an install (`--config.verify-deps-before-run=false` throughout). |
| `apps/vscode-dsh/webview/dist/assets/index.{css,js}` | modified | Pre-existing webview build output. |
| `.cursor/skills/project-build/SKILL.md`, `.specdev/specs/workflows.json` | modified | Pre-existing. |
| `.cursor/**`, `.trae/**`, `.explore/`, `.mcp.json`, `opencode.jsonc`, `docs/wiki/**`, `.wiki-work/` | untracked | Pre-existing tool/config/knowledge trees. |
| Thousands of `packages/**/src/*.d.ts`, `*.js`, `*.js.map`, `*.d.ts.map` | untracked | In-tree build residue, and a dominant component of the red `lint` baseline; not produced by this phase. |

## 3. Acceptance-criterion coverage

| AC | Where it is implemented | What proves it |
|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0`; `EXPECTED_NODE_RANGE` mirrors the root `engines.node` | `node-env-guard.spec.ts` → *pins exactly one machine-readable version that the declared range admits*: `.nvmrc` holds exactly one semver line, `rangeAdmits('^22.19.0 \|\| >=24.0.0', '24.3.0')` holds, and `validateNodeEnvironment(process.execPath)` reports `ok:true`; *keeps the enforced range identical to the root engines field*: `engines.node` === `EXPECTED_NODE_RANGE`; *names the pinned release in both developer docs*: both docs contain `.nvmrc` and the pinned version. |
| AC-2 | `docs/development.md` § `### Node environment` (+ zh twin) | The section names the minimum (22.19 on the 22 line, 24 and later), the declaring file (`engines.node` in the root `package.json`), both APIs (`zlib.createZstdDecompress`, `Promise.withResolvers`), and ties the APIs to `.jsonl.zstd` session logs. |
| AC-3 | Same section, two checklists | **Implemented:** *Repository-side responsibilities* is a 5-row table, every row carrying a decidable command (`pnpm run typecheck`, `pnpm run test apps/vscode-dsh`, `pnpm run test packages/sdk/client`, `pnpm run test:docs`, `pnpm run doc-sync`); *Local-environment responsibilities* splits into a *Terminal side* (3 bullets: version check, `nvm use` / `n 24.3.0`, `PATH` prepend) and an *Extension subprocess side* (3 bullets: setting or `DSH_NODE_BIN`, `--version` confirmation, window reload with `workbench.action.reloadWindow`). No entry merges the two sides into one instruction. **Proved by:** `node-env-guard.spec.ts:474-499` asserts, for both language files, that each of the four titles occurs exactly once and every local-environment entry carries one of the decidable tokens in `DECIDABLE_ENTRY_TOKENS`; the same test then deletes each face title and requires its own assertion to throw, so (a) and (b) fail if either face stops being listed separately. |
| AC-4 | `validateNodeEnvironment()` in `node-env-guard.ts`, called from `IdeSessionHost.start()` before `bridge.listen`; all three sources flow through `resolveNodeExecutableSpec()`, so one gate covers all of them | (a) `inspectExecutableFile()` checks existence, regular file, and `X_OK`; (b) `probeNodeApis()` runs the candidate as a real subprocess asking for `zlib.createZstdDecompress` and `Promise.withResolvers`. Cases: positive report on this machine's qualifying Node; `missing`; `not-executable`; `missing-apis` from a stand-in reporting `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}` with both API names listed; and the `electronRunAsNode` case in §4.4. |
| AC-5 | `resolveNodeExecutableSpec()` reads `DSH_NODE_BIN` first, treating only the empty string as unset | `launch.spec.ts`: env set → `{source:'dsh-node-bin'}` and `ELECTRON_RUN_AS_NODE` absent even with `process.versions.electron` defined; (b) env + setting both non-empty → *prefers a non-empty DSH_NODE_BIN over the configuration setting*; the asymmetry is pinned by *treats an empty DSH_NODE_BIN as unset and falls through to the setting* versus *uses a whitespace-only DSH_NODE_BIN as given, because only the empty value counts as unset*; `session-host-preflight.spec.ts`: `DSH_NODE_BIN` naming a real shim → the shim ran and a real Node child ran the runtime script, while an unusable setting never reached a spawn. |
| AC-6 | Tier 3 is `process.execPath`; `electronRunAsNode` is true only for that source under Electron | `launch.spec.ts`: Electron host + no env + empty setting → `{source:'process-exec-path', electronRunAsNode:true}` and `ELECTRON_RUN_AS_NODE === '1'`; a shimmed `node` injected into `PATH` is asserted not to be the spawned executable. No diagnostic for this tier mentions `PATH` (`node-env-guard.spec.ts:417`). |
| AC-7 | `start()` order is gate → `bridge.listen` → spawn | `session-host-preflight.spec.ts`, for an unusable candidate selected from `DSH_NODE_BIN` and for a missing and an unusable candidate selected from the setting: `start()` rejects with `kind === 'node-environment'`, the witness file proving a child process ran stays absent, `existsSync(bridgeSockPath)` is false, `host.status === 'error'`, and the elapsed time is far below `initializeTimeoutMs` (60 000 ms configured, asserted < 5 000 ms) — so the failure is neither spawn-then-crash nor a handshake timeout. |
| AC-8 | `formatNodeEnvironmentDiagnostics()` renders exactly five lines, one per element | Every failure kind yields a five-line message and the four messages are pairwise distinct. The `process-exec-path` message is asserted to contain the candidate path, the detected version, the expected range (both `22.19` and `24`), the missing API names, and both authorised inputs (`DSH_NODE_BIN` and `dsh.nodeBin`). At extension level, the failed start's user-visible message is asserted to contain the offending path and `dsh.nodeBin`. |
| AC-9 | The text classifies the failure as a Node-environment problem; the carriers are `NodeEnvironmentError` and `HostStartError{kind:'node-environment'}`, and the class reaches the orchestrator snapshot unchanged | The first diagnostic line contains `Node environment`; the message names the detected version against the expected range and offers environment fixes only; no diagnostic attributes the failure to dsh code, and no code path converts it into a generic runtime error. The snapshot hop is asserted at both levels: `auto-start-orchestrator.spec.ts:150-164` (port → snapshot) and `node-env-guard.spec.ts:666` (real extension activation → snapshot). |
| AC-10 | (a) `apps/vscode-dsh/package.json` `contributes.configuration.dsh.nodeBin`; (b) documented priority; (c)–(e) runtime | (a) property declared `string`, default `""`, description naming the priority and "leave empty"; (b) `docs/development.md` (+ zh) states `DSH_NODE_BIN` > `dsh.nodeBin` > Extension Host Node; (c) `launch.spec.ts`: setting-only → `{path:'/y/node', source:'vscode-setting'}`, and the object the gate validates is the object handed to `resolveDshLaunch`; (d) `session-host-preflight.spec.ts`: the setting names an absent path → reject, `kind === 'node-environment'`, no witness file, no bridge socket, `status === 'error'`, and `resolveNodeExecutableSpec` was called **exactly once** (no second resolution to obtain another source); (e) `node-env-guard.spec.ts`: the extension reads `workspace.getConfiguration('dsh').get('nodeBin')` from a real `settings.json`, passes the value explicitly to the host, passes an empty value through unchanged, re-reads it on the next start instead of caching it, and fails loud on a non-string value. |

**Cross-phase dependency (AC-10 f, recorded here for the verifier's `verification.md`)**: AC-10's real-machine branch — the pre-placed `settings.json` being consumed by the resolution chain inside a real Extension Development Host — is provided by the Phase 3 smoke script per AD-11. Phase 1 judges (a)–(e) only, does **not** claim that branch, and must not be recorded as a known gap that permits PASS.

**Evidence split for the invalid-setting branch (AC-10 d)**: (i) *proxy evidence* is the assertion that the pre-placed `settings.json` is byte-identical after the run (`node-env-guard.spec.ts:670`), which shows the extension consumes the setting instead of rewriting it into another source; (ii) *non-proxy negative evidence* is the absence of every spawn marker in `session-host-preflight.spec.ts` (witness file absent, bridge socket absent, `status === 'error'`, elapsed far below the timeout). No observation point was added to product code; the `resolveNodeExecutableSpec` call counting happens in the test through a spy on the imported module namespace.

## 4. Test evidence

All commands run from `/workspace/chendecheng/code/need/deepseek/deepseek-harness` after `export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"`, with `pnpm --config.verify-deps-before-run=false` (abbreviated `$PNPM` below).

### 4.1 Differential result (the acceptance currency for Phase 1)

| Command | Before this phase (spec baseline) | After this rework round | New failures |
|---|---|---|---|
| `$PNPM run typecheck` | green | **exit 0** | none |
| `$PNPM run test packages/sdk/client` | green (3 files / 73 cases) | **green, exit 0 — 3 files / 84 cases** (73 + 11 added) | none |
| `$PNPM run test apps/vscode-dsh packages/sdk/client` | app suite 48 files / 320 cases, **4 files / 6 cases red** | 53 files / 441 cases, **4 files / 6 cases red**, 434 passed, 1 skipped, exit 1 | none — same file set and same failing-case set |
| `$PNPM run lint` | red (existing `apps/vscode-dsh/tests/**` and in-tree build residue) | red, exit 1 — 10 382 diagnostic lines across 263 files; **0** in every file this phase created, **0** on every line this phase added | none (see 4.3) |
| `$PNPM run test:docs` | red — `run-gates: 10 passed, 5 failed, 0 skipped` | red — `run-gates: 10 passed, 5 failed, 0 skipped`, same five gates | none; zero occurrences of this phase's documentation pair in the output |
| `$PNPM run test <path>` (with `--`) | not usable — runs the whole 1 106-file corpus | not used, per the spec | — |

The four red app-suite files are unchanged in identity and count from the baseline snapshot: `spike-t0b-continue-capability.spec.ts` (whole suite, root cause `Cannot read properties of undefined (reading 'UNLOADING')` at `packages/core/agent-loop/src/index.ts:40`), `spike-t0a-replay-rebuild.spec.ts` (4 cases, root cause `Cannot read properties of undefined (reading 'PENDING')` at `scripts/test-invariants.ts:88`), `panel-close-delete.e2e.spec.ts` (1 case), `verifier-phase1/layer-a-rtl.spec.tsx` (1 case). None is a file this phase touched.

### 4.2 This phase's own cases

| Command | Result |
|---|---|
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | `Test Files 4 passed (4)`, `Tests 69 passed (69)`, exit 0 |
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts` | `Test Files 3 passed (3)`, `Tests 43 passed (43)`, exit 0 |
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts` | `Tests 27 passed (27)` |

Every AC-4 / AC-7 / AC-8 / AC-9 / AC-10 runtime case constructs its input, executes it, and asserts the output; none is a static assertion. `node-env-guard.spec.ts` spawns each candidate with `node:child_process` for real, `session-host-preflight.spec.ts` records the spawned executable by having the child write a witness file (`process.execPath` and `argv`), and the AC-10(e) / M2 / S5 cases drive a real `activate()` against a real `settings.json` — so "no child process ran" and "the snapshot says `node-environment`" are observed, not assumed.

### 4.3 Lint delta, per file (measured)

`$PNPM run lint` (the gate: `tsx scripts/run-oxlint.ts .`) exits 1 both at the baseline and now. This round's run yields **10 382** diagnostic lines across **263** files. Per file this phase touched:

| File | Diagnostics | On a line this phase added? |
|---|---:|---|
| `apps/vscode-dsh/src/node-env-guard.ts` (new) | 0 | — |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` (new) | 0 | — (3 were introduced during development — 2 × `@stylistic(arrow-parens)`, 1 × `typescript(no-non-null-assertion)` — and all 3 were fixed before this run) |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts` (new) | 0 | — |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 1 — `:230:24` (`no-non-null-assertion`) | no — added ranges are `26-55` and `220`; `:230` is `more[more.length - 1]!`, unchanged text shifted by the `:220` replacement |
| `apps/vscode-dsh/src/session-host.ts` | 1 — `:595:3` (`require-await`) | no — added ranges are `14`, `16`, `27`, `29`, `42-79`, `106-109`, `253-254`, `285-290`, `300`, `321-327` |
| `apps/vscode-dsh/src/extension.ts` | 22 — `:271`, `:375`, `:380`, `:385`, `:407`, `:425`, `:662`, `:750`, `:1004`, `:1102`, `:1152`, `:1418`, `:1450`, `:1492`, `:1534`, `:1791`, `:2109` (2), `:2110`, `:2111`, `:2270`, `:2272` | no — added ranges are `48`, `223-236`, `2172-2190`, `2253`, `2256`; every one of the 22 is outside them |
| `apps/vscode-dsh/src/index.ts` | 1 — `:97:3` (`no-deprecated` on `buildThinChatHtml`) | no — the added range is `25-39` |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | 4 — `:52:39`, `:53:9`, `:95:36`, `:96:9` | no — added ranges are `8`, `12-15`, `143-177`; all four are inside the pre-existing `mockPort` helper |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | 2 — `:158`, `:192` | no — the added range is `70-74` |
| `apps/vscode-dsh/tests/phase2-auto-ready.spec.ts` | 15 | no — the added range is `49-53` |
| `apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts` | 11 | no — the added range is `75-79` |
| `packages/sdk/client/{src/launch.ts,src/types.ts,src/index.ts,tests/launch.spec.ts}` | 0 | — |
| `apps/vscode-dsh/package.json` | 0 | — |

**Relation to the review's S3 figure.** The review states `extension.ts` yields 3 diagnostics. That number is reproducible with the reduced rule set, and both commands are recorded here so the difference is not a matter of opinion:

| Command | `extension.ts` diagnostics |
|---|---|
| `$PNPM exec tsx scripts/run-oxlint.ts apps/vscode-dsh/src/extension.ts` | 22 |
| `$PNPM exec tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json apps/vscode-dsh/src/extension.ts` | **3** — `:2109:1` and `:2110:1` (`@stylistic(indent)`), `:2111:1` (`@stylistic(indent)`) |

Under the gate's rule set the file's 22 diagnostics are 21 distinct lines, all on unmodified code; under the staged rule set they are 3, also all on unmodified code. The zero-new conclusion therefore holds under either measurement, and this report states the value each command produces instead of choosing one. The lines are unchanged source regardless: `git diff -U0` shows pure-insertion hunks for `extension.ts` (`@@ -47,0 +48 @@`, `@@ -221,0 +223,14 @@`, `@@ -2156,0 +2172,19 @@`, `@@ -2218,0 +2253 @@`, `@@ -2220,0 +2256 @@`), and no diagnostic line number falls inside them.

### 4.4 Falsification probes (the rework's runtime claims)

Each probe mutated product code or a document, ran the exact command, recorded the red result, then restored the file and confirmed the suite green again. This is how the falsifiability of M2, S5, S6, and S9 was established rather than asserted.

| Claim | Mutation applied | Observed | Restored |
|---|---|---|---|
| M2 — the class survives the hop | `startErrorKindOf` restricted to recognise only `missing-credentials` and return `process-failed` otherwise (the pre-fix behaviour) | `$PNPM run test apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/node-env-guard.spec.ts` → exit 1, `Tests 2 failed \| 34 passed (36)`: `projects a host node-environment failure as node-environment, not a dsh process failure` and `fails loud on an unusable path named by settings.json and leaves the file untouched`. Both levels are covered: the orchestrator snapshot and the real extension activation. | yes |
| S9 — the probe uses the spawn mode | `if (executable.electronRunAsNode)` → `&& false`, so the probe never injects the flag | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts` → exit 1, `Tests 1 failed \| 26 passed (27)`: `probes a process-exec-path candidate in the Electron mode the spawn will use (S9)` — the `electronRunAsNode: true` candidate stops being `ok:true`. | yes |
| S5 — nothing is cached across starts | `readNodeBinSetting` memoised in a module-level variable | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts` → exit 1, `Tests 4 failed \| 23 passed (27)`, including `re-reads the setting on every start instead of caching the first value (S5, AD-9)` and `passes an empty setting through unchanged instead of inventing a path`. | yes |
| S6 — the checklist structure is load-bearing | Removed the phrase `Terminal side` from the real `docs/development.md` (`*Terminal side* — the Node that runs …` → `The Node that runs …`) | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts -t "keeps the AC-3 checklist structure"` → exit 1, `1 failed \| 26 skipped (27)`, `AssertionError: …/docs/development.md: expected [Function] to not throw an error but 'Error: checklist title "Terminal side" occurs 0 times, expected exactly 1' was thrown`. The test's own in-place deletion of each face title (`:486-492`) repeats this falsification on every run without touching the file. | yes — restored byte-identically, verified by `sha256sum -c` against the pre-probe hash |

After the restorations: `$PNPM run typecheck` exit 0, and the four-spec command in 4.2 `Tests 69 passed (69)`, exit 0. A scan for leftover probe markers (`cachedNodeBinSetting`, `electronRunAsNode && false`, `candidate === 'missing-credentials'` inside the guard) returns no matches.

### 4.5 Real-machine probes (evidence for AC-1 b and AC-4 a)

Probed through the shipped guard by running the compiled module with `tsx` and calling `validateNodeEnvironment({path, source, electronRunAsNode:false})`:

| Interpreter | Reported version | `hasZstd` | `hasWithResolvers` | Verdict |
|---|---|---|---|---|
| `/usr/local/n/versions/node/24.3.0/bin/node` | 24.3.0 | true | true | `ok:true` — the floor does not misfire on a qualifying Node |
| `/usr/bin/node` | 18.12.1 | false | false | `missing-apis`, both names listed |
| `~/.nvm/versions/node/v22.14.0/bin/node` | 22.14.0 | false | true | `missing-apis`, `zlib.createZstdDecompress` only |
| `/usr/local/n/versions/node/22.9.0/bin/node` | 22.9.0 | false | true | `missing-apis`, `zlib.createZstdDecompress` only |

The last two rows are also the AD-2 demonstration: those interpreters are below the declared floor, yet the reported kind is `missing-apis` with API names, never a version-based rejection, and an interpreter outside the declared range that does provide both APIs is accepted.

Two further machine measurements, taken while writing the AC-3(a) verification column because the first wording of that row asserted something untrue:

| Probe | Measured |
|---|---|
| `env -i PATH=/usr/bin:/bin sh -c 'command -v node; node --version'` | `/usr/bin/node`, `v18.12.1` |
| `PATH="/usr/bin:/usr/local/node/bin:$PATH" $PNPM run typecheck` | exit 1, `ERROR: This version of pnpm requires at least Node.js v22.13` |

## 5. Deviations and conflicts with the phase's stated premises

1. **AD-2 was violated by the first revision of this phase and has been corrected.** The initial `node-env-guard.ts` gated on the version string (`unsupported-version`). AD-2 states the gate is decided by capability and that the version is diagnostic only, and AC-4(c) requires the `{"version":"20.16.0",…}` stand-in to classify as `missing-apis`. The version comparison was removed, `unsupported-version` and `nodeVersionSupported()` were deleted, and the capability tests were reordered accordingly.
2. **A fourth failure kind, `unusable`, exists beyond the spec's three names.** It covers a candidate that exists and is executable but cannot report Node capabilities (non-zero exit, non-report output, or timeout). Folding it into `missing-apis` would print API names that were never observed; the kind keeps the message truthful while satisfying AC-7's obligation to block the spawn. The spec enumerates no closed taxonomy, and no AC requires exactly three kinds.
3. **Whitespace asymmetry is deliberate and matches the spec's boundary list.** `DSH_NODE_BIN='   '` counts as *set* (the value is used as given, then fails the gate loud), while `dsh.nodeBin='   '` counts as *unset* and falls through. The spec's boundary list asks for exactly this split.
4. **`docs/development.md` verification-wording correction.** The first revision claimed `pnpm run typecheck` refuses to start when the interpreter is outside `engines.node`. Measurement (4.5) shows the refusal comes from pnpm's own floor (22.13), not from `engines.node`, and that a clean `PATH` on this machine resolves `/usr/bin/node` v18.12.1 rather than the v20.16.0 the spec's snapshot names. The AC-3(a) row now states three decidable checks (`node --version` admitted by `engines.node`, `.nvmrc` naming the release the checks ran against, `typecheck` exiting 0).
5. **Machine facts that differ from the spec snapshot.** The spec calls `/usr/local/n/versions/node/24.3.0` the only qualifying install; `/usr/local/bin/node` is a second, genuine v24.3.0 binary on this machine, and `~/.nvm/versions/node/v20.16.0` exists but is not what a clean `PATH` resolves. Neither difference changes the implementation.
6. **The two checklist titles and the two face titles are bold lead-ins, not ATX headings.** The section's siblings in `docs/development.md` use `##`/`###` only and lead nested lists with bold text, so the new sub-structure follows that house style. The verifier's structural assertions and the executable assertions in `node-env-guard.spec.ts` match the label text (`Repository-side responsibilities` / `Local-environment responsibilities`, `Terminal side` / `Extension subprocess side`, and their Chinese counterparts), so they are independent of the emphasis markup. If a future gate requires ATX headings, that is a one-line change per title plus the same labels.
7. **`HostStartError` is additive but changes the thrown class for every `start()` failure**, and covers `node-environment` and `process-failed`. The pre-existing app suites still pass; the type is exported so callers can discriminate.
8. **`contributes.configuration` also carries a `title`.** Only the property block is required; the title is additive and groups the setting in the VS Code settings UI.
9. **No published name was removed.** `resolveNodeExecutable()` was private to `launch.ts` (not re-exported at HEAD), so replacing it with `resolveNodeExecutableSpec()` alters no public surface; `packages/sdk/client/src/index.ts` changes are additions only.
10. **S4 — the `dsh.nodeBin` property carries two keys beyond the required minimum.** `apps/vscode-dsh/package.json` declares `"scope": "machine-overridable"` and `"markdownDescription"` in addition to `type` / `default` / `description`. Rationale: the offending value is a property of the machine (an installed interpreter path), not of the repository, so a workspace-level override of a user's machine setting is the wrong power to grant, and `machine-overridable` is the narrowest scope that still allows a machine-level override. `markdownDescription` duplicates `description` in Markdown so the settings UI renders the two API names and the range as code; VS Code prefers `markdownDescription` when present, and `description` remains for surfaces that read it. `node-env-guard.spec.ts:508-517` asserts the behaviour-bearing parts (priority, empty value, `22.19`, `24`) through `description`; the two extra keys add no behaviour.
11. **S8 — the setting is routed to the host as an explicit input, not read implicitly.** `extension.ts:2253-2256` (`createStartHostPort()`) calls `readNodeBinSetting(vscode)` and passes the result as `IdeSessionHost.start({ cwd, nodeBinSetting, credentials })` (`session-host.ts:106-109` declares the option). Three reasons: (a) `IdeSessionHost` is the process/transport seam and must not depend on the `vscode` module — it is exercised without VS Code in `session-host-preflight.spec.ts`; (b) the SDK already models the same input as a request object (`resolveNodeExecutableSpec({ nodeBinSetting })`), so the host passes the identical value to both the gate and the resolver and the object the gate validated is the object that spawns; (c) `readNodeBinSetting` returns `undefined` for unset rather than `''`, keeping "unset" and "empty string" distinguishable at the editor boundary while the resolver keeps its own documented empty-string semantics. A non-string value throws inside `readNodeBinSetting` before any host exists, which is the fail-loud requirement of AC-10(e).
12. **S10 — what "a diagnostic injection point reserved for Phase 2" concretely means.** spec.md:133 assigns `extension.ts` the task of reading the setting, passing it as an explicit input, and reserving a diagnostic injection point for Phase 2's AC-13 – AC-22. In this phase that reservation is these three existing, typed observation surfaces, with no new sink type and no `HostFailureKind` added:
    - `IdeSessionHost.onError(listener) → disposer` (`session-host.ts:195-200`) — the pre-existing error observation port the extension already subscribes to inside `createStartHostPort()`. A Phase 2 diagnostics sink attaches the same way `setInteractionUi` / `onError` are injected today, i.e. before `start()`, and needs no change to `start()`.
    - `AutoStartOrchestrator.getSnapshot()` / `onChange(handler)` — the L2 projection already carries `state`, `errorKind` (which after M2 can say `node-environment`), and `errorMessage`. Phase 2's recorder can subscribe here for failures that never reach `start()`.
    - `HostStartError{kind, diagnostic}` (`session-host.ts:57-77`) — for the `node-environment` class the thrown error already carries the structured `NodeEnvironmentFailure`, so a Phase 2 recorder reads `error.diagnostic` instead of re-parsing the rendered message.
    Together these are the written interface Phase 2 attaches to; Phase 2 still owns the sink type, the six-class `HostFailureKind` vocabulary (including its own `other`), and redaction policy.
13. **`StartErrorKind` lost the `'other'` member.** Keeping both `'other'` and `process-failed` would leave two generic classes, which is the flattening M2 exists to remove; the vocabulary is now exactly the classes this phase can produce plus the one documented generic member. `'other'` remains in Phase 2's *record* vocabulary, which is a different type in a different phase.

## 6. Unresolved items and risks

1. **AC-10(f)** (real Extension Development Host consuming the pre-placed `settings.json`) remains a Phase 3 obligation, as the spec requires. Phase 1 must not be judged complete or incomplete on that branch.
2. **`$PNPM run doc-sync`** was not run: the spec assigns the first `test:docs` pass to this phase and reserves `doc-sync` for Phase 4's re-check. `test:docs` is recorded with its exact tally in §4.1 and §7.
3. **The red `lint` baseline is untouched by design.** Its components are in-tree build residue (untracked `packages/**/src/*.d.ts` and maps) and the pre-existing `no-unsafe-*` / `no-unnecessary-*` class in `apps/vscode-dsh/tests/**`, whose structural cause is that `apps/vscode-dsh/tsconfig.json` includes only `src`, leaving those test files outside any TypeScript program. Repairing that class would mean adding the test directory to a program, which would change the `typecheck` baseline this phase is required to keep green, so it stays out of scope.
4. **`apps/vscode-dsh` has no coverage gate** while `packages/sdk/client` keeps its per-file 100% requirement. This phase added no uncovered branch to the SDK: its new code is exercised by `launch.spec.ts` (11 new cases).
5. **`unusable` is the only classification that depends on subprocess behaviour** (exit code, output, timeout) and so is the place a unit-test-only regression could hide. It is covered by a real stand-in that exits non-zero and by the S9 case; the timeout branch is not separately exercised, since inducing it needs a long-running fixture.
6. **Two tracked files show as modified in the working tree but are not this phase's work**: `pnpm-lock.yaml` and `apps/vscode-dsh/webview/dist/assets/index.{js,css}` (both dated 2026-09-14). They consist of pnpm re-resolution entries and a previously built webview bundle, and must be excluded from the Phase commit.
7. **The app-suite red set is concurrency-sensitive in membership but stable in count.** The four failing files and six failing cases match the baseline snapshot in every run recorded here, but the two single-case failures (`panel-close-delete.e2e.spec.ts`, `verifier-phase1/layer-a-rtl.spec.tsx`) belong to the same shared-resource family that varies between runs. A verifier reading a different pair should compare totals and root causes, not just names.

## 7. Documentation gates (commands actually executed)

| Command | Result |
|---|---|
| `$PNPM run verify-translation-pairing --write docs/development.md` | `recorded docs/development.i18n.yaml`; both hashes updated (`development.md` → `32be857e…`, `development.zh.md` → `821d84be…`) for the M1 and S7 edits together |
| `$PNPM run verify-translation-pairing --write packages/sdk/client/README.md` | `recorded packages/sdk/client/README.i18n.yaml` (first round) |
| `$PNPM run test:docs` | exit 1 — `run-gates: 10 passed, 5 failed, 0 skipped`, identical to the baseline tally; failing gates `markdown links`, `translation pairing`, `markdown wrap`, `agent note format`, `documentation standard tests` |
| `rg -c "development\.md\|development\.zh\.md"` over the `test:docs` output | **0** — neither file of this phase's pair appears in any violation list |

The five failing gates were checked line by line for this phase's files. `translation pairing` reports `docs/wiki/**` pages without English counterparts, `packages/README.*`, and `packages/sdk/server/README.*` — none modified by this phase. `markdown links` reports `docs/wiki/**` and two `README.zh.md` anchors in `packages/ide/ide-bridge` and `packages/bundle/ide`. One violation **was** introduced by this phase in the first round and fixed within it: linking `#node-environment` from `docs/development.zh.md` failed because the Chinese page had no explicit anchor; adding `<a id="node-environment"></a>` above the heading cleared it.
