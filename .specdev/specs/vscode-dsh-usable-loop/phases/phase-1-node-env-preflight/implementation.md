# Phase 1 implementation — `phase-1-node-env-preflight`

| Field | Value |
|---|---|
| Phase ID | `phase-1-node-env-preflight` (copied verbatim from `phase-plan.md` DAG JSON) |
| Workflow | `vscode-dsh-usable-loop` |
| Branch | `impl-phase-1-node-env-preflight` — verified with `git branch --show-current` before any edit; every change stays in the working tree and this agent runs no git command beyond inspection |
| Executor | implementer (subagent); self-test only — the verdicts belong to the independent reviewer and verifier |
| Date (UTC) | 2026-09-15 |
| Revision | **rework round 2**, answering `review.md` §二 **N1 / D-1 / D-2** and `verification.md` §7. The previous revision was archived by this agent at startup to `phases/phase-1-node-env-preflight/.archive/implementation-20260915T115405Z.md` (`implementation-zh-20260915T115405Z.md` likewise) and is superseded, not deleted. |
| Upstream read in full | `spec.md`, `review.md` (§二 / §四), `verification.md` (§7), `review-correctness.md`, `review-design.md`, `review-connectivity.md`, `repo-exploration.md`, `requirements.md`, `design.md` (AD-4 word list), `tech-debt-registry.md` |

Scope: this round changes exactly three things — the review item codes in test names and comments (D-1), the machine-readable class of a non-string `dsh.nodeBin` value (D-2), and the AC-1(b) three-location locator (N1) — plus the two documentation surfaces the changes require (`design.md` / `design-zh.md` AD-4 word list, `tech-debt-registry.md`). The existing Phase 1 implementation was not rewritten: every edit is additive or a text substitution on a line this phase already owned. §3–§5 carry forward the round-1 content so this file stands alone for the reviewer; line numbers are the ones measured now, after this round's shifts.

## 1. Rework round 2 (N1, D-1, D-2)

### 1.1 Summary

| # | Reviewer's verdict | State | Where |
|---|---|---|---|
| D-1 | 🟡 should-fix (design) | **done** | `apps/vscode-dsh/tests/node-env-guard.spec.ts:267`, `:685`, `:698`; `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts:144` |
| D-2 | 🟡 should-fix (design; connectivity reproduced it independently) | **done** | `apps/vscode-dsh/src/auto-start-orchestrator.ts:27-43`; `apps/vscode-dsh/src/session-host.ts:42-53`; `apps/vscode-dsh/src/extension.ts:2172-2191`; `apps/vscode-dsh/tests/node-env-guard.spec.ts:729-747`; `design.md:186` + `design-zh.md:187` |
| N1 | 🟡 should-fix (correctness) | **done** | `apps/vscode-dsh/tests/node-env-guard.spec.ts:89-113`, `:476-482`, `:484-517` |

No item is deferred. §5 records the three places where this round deliberately did something other than the literal wording it was given, with the reason.

### 1.2 D-1 — review item codes removed from test names and comments

`AGENTS.md:144` forbids preserving review history in code, and `S*` / `M*` item codes have no precedent in this repository (`packages/client/ui-commands`' `S1` / `S2` are variable names). Four sites were cleared, each keeping its descriptive wording:

| Site | Before | After |
|---|---|---|
| `node-env-guard.spec.ts:267` | `probes a process-exec-path candidate in the Electron mode the spawn will use (S9)` | `probes a process-exec-path candidate in the Electron mode the spawn will use` |
| `node-env-guard.spec.ts:685` | `re-reads the setting on every start instead of caching the first value (S5, AD-9)` | `re-reads the setting on every start instead of caching the first value (AD-9)` |
| `node-env-guard.spec.ts:698` | `// M2: A cached resolution or setting value would still report the first path here.` | `// A cached resolution or setting value would still report the first path here.` |
| `auto-start-orchestrator.spec.ts:144` | `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4, M2)')` | `describe('AutoStartOrchestrator start-failure classification (AC-9, AD-4)')` |

`AD-*` references are **kept**, because they are `design.md` architecture-decision numbers, i.e. a citable contract with existing precedent in this module (`session-host.ts:106` cites AD-1, `extension.ts:2173` cites AD-10). The scan and its result are in §4.4.

### 1.3 D-2 — `invalid-setting` as the class of a non-string Node selection setting

**The chain the review established.** `readNodeBinSetting` threw a bare `Error` with no `kind`; the call sits inside `createStartHostPort`'s `start()` (`extension.ts:2255`), so the throw surfaced to `startErrorKindOf` (`auto-start-orchestrator.ts:53`, called at `:226`), which by construction can only return a member of `START_ERROR_KINDS`; a `kind`-less error therefore became `process-failed`. The user-visible text was already correct (`dsh.nodeBin must be a path to a Node.js executable string, got number`); only the machine-readable field lied, and nothing asserted it.

**What changed.**

1. `START_ERROR_KINDS` (`auto-start-orchestrator.ts:27-32`) gained `'invalid-setting'`. That array is the single source of truth for the vocabulary: `:43` derives `StartErrorKind`, and `session-host.ts:53` declares `HostStartErrorKind = StartErrorKind`, so the type, the runtime guard, and the host's thrown class cannot drift apart.
2. `readNodeBinSetting` (`extension.ts:2180-2191`) now throws `HostStartError('invalid-setting', …)` instead of a bare `Error`, so the class reaches `startErrorKindOf` and is passed through unchanged. `HostStartError` was already imported from `session-host.ts`, and its `.kind` field is exactly what the guard reads.
3. `node-env-guard.spec.ts:729-747` asserts the **orchestrator snapshot**, not the error text: after activating with `get('nodeBin') === 42`, the `dsh.test.requestStart` snapshot must have `state === 'failed'` and `errorKind === 'invalid-setting'` (`:744`), the message must name the setting and the type it got, and `IdeSessionHost.prototype.start` must not have been called. The earlier round's gap was precisely the absence of this assertion.

**Word-list decision and its reason.** `invalid-setting` was added as a new member rather than reusing `node-environment`. `session-host.ts:62` carries the invariant *"Pre-flight diagnostic; present exactly when `kind` is `node-environment`"*, which round 2's review confirmed as correct; a wrong-typed setting has no pre-flight diagnostic, because no interpreter was ever inspected, so reusing `node-environment` would have made `diagnostic` mandatory-but-absent and broken the invariant. The new member also matches the module's existing precedent: `missing-credentials` is likewise neither a Node nor a process class. `process-failed` stays as the single generic member for a failure that reports no class — the review asked to remove `'start-failed'` as a universal class, which was done in round 1, not to remove the generic member, and Phase 2's spec asserts `process-failed` for an unclassified failure.

**Documentation kept in step (three places, one vocabulary).** `StartErrorKind`'s JSDoc (`auto-start-orchestrator.ts:34-42`) and `HostStartErrorKind`'s JSDoc (`session-host.ts:42-52`) now both name `invalid-setting` and say what it means; the AD-4 word list in `design.md:186` and `design-zh.md:187` now reads `missing-credentials` / `process-failed` plus this workflow's `node-environment` / `invalid-setting` (Phase 1) and `spawn` / `handshake-timeout` / `bridge-listen` (Phase 2).

**Exhaustiveness.** No `switch` over `StartErrorKind` exists in the repository; the only consumer that branches on it is `connection-ui.ts:140`, which *equality*-tests `'missing-credentials'` to decide whether to offer the credentials deep link. `invalid-setting` therefore correctly takes the non-credentials branch — a type error in `dsh.nodeBin` is not a credentials problem — and no `default:` had to be added anywhere. `typecheck` exits 0 (§4.1), which is the mechanical confirmation that no union member was left unhandled.

### 1.4 N1 — AC-1(b) locates the pinned release in the three documented places

`spec.md:43`'s AC-1 verification strategy (b) requires locating the `.nvmrc` version in `/usr/local/n/versions/node/<v>`, `~/.nvm/versions/node/v<v>` and `command -v node` and running `validateNodeEnvironment` on the interpreter that is found. The previous single case was named `AC-1 a, b` but its (b) half asserted against `process.execPath`, so it passed on a machine without the pinned release — the AC's *requirement* (one line, valid semver, admitted by the range) was covered, the *verification step* was not.

The case is now split so each name matches its assertions:

- `node-env-guard.spec.ts:476-482` — **AC-1 a**: `.nvmrc` holds exactly one non-empty line, it matches `^\d+\.\d+\.\d+$`, and `rangeAdmits(EXPECTED_NODE_RANGE, pinned)` is true.
- `node-env-guard.spec.ts:484-517` — **AC-1 b**: `pinnedInstallRoots(pinned)` (`:89-101`) yields the two version-named roots, and `nodeOnPath()` (`:103-107`) resolves `command -v node`. The two version-named roots are a hit by path, since the path names the version; `PATH` is not version-named, so `reportedVersion()` (`:109-113`) must report the pinned version for it to count. Every located interpreter is passed to `validateNodeEnvironment`, and for each the case asserts `validation.ok === true` (`:512`) **and** `validation.report.version === pinned` (`:514`) — the second assertion is what makes the case prove the pinned release rather than any working Node.
- When nothing is located, `ctx.skip` (`:502-505`) reports the case as **skipped**, with the pinned version and all three checked paths in the message, which is spec.md's "end non-PASS and say so in `verification.md`" rather than a silent pass.

The forward-coverage assertion that used to be attached to AC-1 — that this machine's interpreter passes the pre-flight — is not re-attached to AC-1; the phase's own AC-4 cases and the round-1 real-machine probes (§4.5) carry it. `spec.md` and `.nvmrc` are unmodified.

## 2. Change list

### 2.1 New files (this phase)

| Path | Lines | Purpose |
|---|---:|---|
| `.nvmrc` | 1 | `24.3.0` — the machine-readable Node declaration AC-1 requires. Unchanged in this round. |
| `apps/vscode-dsh/src/node-env-guard.ts` | 303 | The single pre-flight entry point: `validateNodeEnvironment()`, the throwing wrapper `assertNodeExecutable()`, the failure taxonomy, the five-element diagnostic renderer, the executable/permission probe, and the capability probe that runs a candidate as a real subprocess in the caller's invocation mode. Unchanged in this round. |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` | 748 | 28 runtime cases. **Changed in this round:** the AC-1 locator helpers and the AC-1(a)/(b) split (N1), the `invalid-setting` snapshot assertion (D-2), and the three item-code removals (D-1). |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts` | 327 | 7 runtime cases for the spawn-order contract: gate → `bridge.listen` → spawn, with spawns observed through witness files rather than a mock. Unchanged in this round. |

### 2.2 Modified files (all rounds; ★ = changed in this round)

| Path | Change |
|---|---|
| ★ `apps/vscode-dsh/src/auto-start-orchestrator.ts` | `START_ERROR_KINDS` gained `invalid-setting` and its JSDoc names it (D-2). Round 1 introduced the array as the shared vocabulary, the `startErrorKindOf` guard, and the `:226` projection of the thrown class. |
| ★ `apps/vscode-dsh/src/session-host.ts` | `HostStartErrorKind`'s JSDoc names `invalid-setting` and says the class belongs to the setting's value (D-2). Round 1 added the `HostStartError` carrier, the `nodeExecutable` / `nodeBinSetting` options, the `resolve → assertNodeExecutable → bridge.listen → client start` order, and made the generic catch-all throw `process-failed`. |
| ★ `apps/vscode-dsh/src/extension.ts` | `readNodeBinSetting` throws `HostStartError('invalid-setting', …)` and its JSDoc names the class (D-2). Round 1 added `VsCodeLike.workspace.getConfiguration`, the setting read, and the `nodeBinSetting` pass to `IdeSessionHost.start`. |
| `apps/vscode-dsh/src/node-env-guard.ts` | Round 1: the probe takes the resolved executable and injects `ELECTRON_RUN_AS_NODE=1` for an `electronRunAsNode` candidate; the `process-exec-path` remedy names the executable's owner and the two levers instead of `PATH`. Unchanged in this round. |
| `apps/vscode-dsh/src/index.ts` | Additive re-exports of the guard types, constants, error classes, and `HostStartError`. |
| `apps/vscode-dsh/package.json` | The first `contributes.configuration` block in `apps/`: the `dsh.nodeBin` string property with `default`, `scope`, `description`, `markdownDescription`. |
| ★ `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | The `M2` item code was removed from the describe title (D-1). Round 1 added the `SameSet` vocabulary pin and three classification cases. |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`, `phase2-auto-ready.spec.ts`, `phase4-new-conversation-chrome.spec.ts` | Each inline duck-typed `vscode` double gained `workspace.getConfiguration('dsh')`, so the extension's setting read does not throw in suites that predate it (5 lines each). |
| `packages/sdk/client/src/types.ts`, `src/launch.ts`, `src/index.ts` | `ResolvedNodeExecutable` / `NodeExecutableRequest` / `NodeExecutableSource` and the single `resolveNodeExecutableSpec()` entry (all additive). |
| `packages/sdk/client/tests/launch.spec.ts` | Extended (not replaced) with 11 cases covering the three tiers, the Electron interaction, and the boundary inputs. |
| `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | New "Choosing the Node executable" section; pairing recorded. |
| `docs/development.md` + `development.zh.md` + `development.i18n.yaml` | New `### Node environment` section and the AC-3 checklists; round 1 gave the reload step its command tokens and corrected the floor's ownership wording; pairing recorded. |
| ★ `design.md` + `design-zh.md` | The AD-4 word list now enumerates the whole `StartErrorKind` vocabulary including `invalid-setting` (D-2). |

### 2.3 Modified or untracked in this worktree, but **not** this phase

Listed so HG-3 does not attribute them to Phase 1. None was opened for writing by this phase.

| Path | State | Note |
|---|---|---|
| `pnpm-lock.yaml` | modified | Pre-existing; this phase never ran an install (`--config.verify-deps-before-run=false` throughout). |
| `apps/vscode-dsh/webview/dist/assets/index.{css,js}` | modified | Pre-existing webview build output. |
| `.cursor/skills/project-build/SKILL.md`, `.specdev/specs/workflows.json` | modified | Pre-existing. |
| `.cursor/**`, `.trae/**`, `.explore/`, `.mcp.json`, `opencode.jsonc`, `docs/wiki/**`, `.wiki-work/` | untracked | Pre-existing tool/config/knowledge trees. |
| Thousands of `packages/**/src/*.d.ts`, `*.js`, `*.js.map`, `*.d.ts.map` | untracked | In-tree build residue and a dominant component of the red `lint` baseline; not produced by this phase. |

## 3. Acceptance-criterion coverage

| AC | Where it is implemented | What proves it |
|---|---|---|
| AC-1 | `.nvmrc` = `24.3.0`; `EXPECTED_NODE_RANGE` mirrors the root `engines.node` | **(a)** `node-env-guard.spec.ts:476-482` — exactly one semver line and `rangeAdmits('^22.19.0 \|\| >=24.0.0', pinned)`. **(b)** `:484-517` — the two version-named roots and `command -v node`, then `validateNodeEnvironment` on each located interpreter requiring `ok:true` **and** `report.version === pinned`, or a reported skip naming the pin and the three paths. **(c)** `:519-528` — both developer docs name `.nvmrc`, the pinned version, `DSH_NODE_BIN` and `dsh.nodeBin`. Plus *keeps the enforced range identical to the root engines field*: `engines.node` === `EXPECTED_NODE_RANGE`. |
| AC-2 | `docs/development.md` § `### Node environment` (+ zh twin) | The section names the minimum (22.19 on the 22 line, 24 and later), the declaring file (`engines.node` in the root `package.json`), both APIs (`zlib.createZstdDecompress`, `Promise.withResolvers`), and ties the APIs to `.jsonl.zstd` session logs. |
| AC-3 | Same section, two checklists | **Implemented:** *Repository-side responsibilities* is a 5-row table whose every row carries a decidable command; *Local-environment responsibilities* splits into *Terminal side* (3 bullets) and *Extension subprocess side* (3 bullets, including the reload with `workbench.action.reloadWindow`). No entry merges the two sides. **Proved by** `:530-548`: for both language files each of the four titles must occur exactly once and every local-environment entry must carry a decidable token from `DECIDABLE_ENTRY_TOKENS`; the same case then deletes each face title and requires its own assertion to throw, so (a) and (b) fail if either face stops being listed separately. |
| AC-4 | `validateNodeEnvironment()` in `node-env-guard.ts`, called from `IdeSessionHost.start()` before `bridge.listen`; all three sources flow through `resolveNodeExecutableSpec()`, so one gate covers all of them | (a) `inspectExecutableFile()` checks existence, regular file, and `X_OK`; (b) `probeNodeApis()` runs the candidate as a real subprocess asking for `zlib.createZstdDecompress` and `Promise.withResolvers`. Cases: positive report on this machine's qualifying Node; `missing`; `not-executable`; `missing-apis` from the `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}` stand-in with both API names listed; and the `electronRunAsNode` case in §4.4. |
| AC-5 | `resolveNodeExecutableSpec()` reads `DSH_NODE_BIN` first, treating only the empty string as unset | `launch.spec.ts`: env set → `{source:'dsh-node-bin'}` and `ELECTRON_RUN_AS_NODE` absent even with `process.versions.electron` defined; env + setting both non-empty → the env wins; the asymmetry is pinned by "empty `DSH_NODE_BIN` falls through" versus "whitespace-only `DSH_NODE_BIN` is used as given". `session-host-preflight.spec.ts`: a `DSH_NODE_BIN` shim runs and a real Node child runs the runtime script, while an unusable setting never reaches a spawn. |
| AC-6 | Tier 3 is `process.execPath`; `electronRunAsNode` is true only for that source under Electron | `launch.spec.ts`: Electron host + no env + empty setting → `{source:'process-exec-path', electronRunAsNode:true}` and `ELECTRON_RUN_AS_NODE === '1'`; a shimmed `node` injected into `PATH` is asserted not to be the spawned executable. No diagnostic for this tier mentions `PATH`. |
| AC-7 | `start()` order is gate → `bridge.listen` → spawn | `session-host-preflight.spec.ts`, for an unusable candidate from `DSH_NODE_BIN` and a missing and an unusable candidate from the setting: `start()` rejects with `kind === 'node-environment'`, the witness file proving a child ran stays absent, `existsSync(bridgeSockPath)` is false, `host.status === 'error'`, and elapsed time is far below the configured 60 000 ms `initializeTimeoutMs` (asserted < 5 000 ms) — so the failure is neither spawn-then-crash nor a handshake timeout. |
| AC-8 | `formatNodeEnvironmentDiagnostics()` renders exactly five lines, one per element | Every failure kind yields a five-line message and the four messages are pairwise distinct. The `process-exec-path` message is asserted to contain the candidate path, the detected version, the expected range (both `22.19` and `24`), the missing API names, and both authorised inputs. At extension level the failed start's message is asserted to contain the offending path and `dsh.nodeBin`. |
| AC-9 | The text classifies the failure as a Node-environment problem; the carriers are `NodeEnvironmentError` and `HostStartError{kind:'node-environment'}`, and the class reaches the orchestrator snapshot unchanged | The first diagnostic line contains `Node environment`; the message names the detected version against the expected range and offers environment fixes only; no diagnostic attributes the failure to dsh code. The hop is asserted at both levels: `auto-start-orchestrator.spec.ts:150-176` (port → snapshot) and `node-env-guard.spec.ts:722` (real activation → snapshot). Non-Node classes now also survive the hop: `invalid-setting` per §1.3, and `process-failed` for an unclassified failure. |
| AC-10 | (a) `apps/vscode-dsh/package.json` `contributes.configuration.dsh.nodeBin`; (b) documented priority; (c)–(e) runtime | (a) declared `string`, default `""`, description naming the priority and "leave empty". (b) `docs/development.md` (+ zh) states `DSH_NODE_BIN` > `dsh.nodeBin` > Extension Host Node. (c) setting-only → `{source:'vscode-setting'}`, and the object the gate validates is the object handed to `resolveDshLaunch`. (d) the setting names an absent path → reject, `kind === 'node-environment'`, no witness file, no bridge socket, `status === 'error'`, and `resolveNodeExecutableSpec` called **exactly once**. (e) the extension reads `workspace.getConfiguration('dsh').get('nodeBin')` from a real `settings.json`, passes the value explicitly to the host, passes an empty value through unchanged, re-reads it on the next start, and classifies a non-string value as `invalid-setting` before any host exists (`node-env-guard.spec.ts:729-747`). |

**Cross-phase dependency (AC-10 f).** AC-10's real-machine branch — the pre-placed `settings.json` consumed by the resolution chain inside a real Extension Development Host — is provided by the Phase 3 smoke script per AD-11. Phase 1 judges (a)–(e) only and does not claim that branch.

**Evidence split for the invalid-setting branch.** (i) *Proxy evidence* is the byte-identical `settings.json` after the run, which shows the extension consumes the setting rather than rewriting it. (ii) *Non-proxy negative evidence* is the absence of every spawn marker: the witness file, the bridge socket, and `status === 'error'`, with `start()` asserted never to have been called. No observation point was added to product code; the call counting happens in the test through a spy on the imported module namespace.

## 4. Test evidence

All commands run from `/workspace/chendecheng/code/need/deepseek/deepseek-harness` after `export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"`, with `pnpm --config.verify-deps-before-run=false` (abbreviated `$PNPM`).

### 4.1 Differential result (the acceptance currency for Phase 1)

| Command | Spec baseline | This round, measured | New failures |
|---|---|---|---|
| `$PNPM run typecheck` | green | **exit 0** (`tsc -b tsconfig.client.json`) | none |
| `$PNPM run test packages/sdk/client` | green (3 files / 73 cases) | green, exit 0 — `Test Files 3 passed (3)`, `Tests 84 passed (84)` | none |
| `$PNPM run test apps/vscode-dsh packages/sdk/client` | app suite 48 files / 320 cases, **4 files / 6 cases red** | exit 1 — `Test Files 4 failed \| 49 passed (53)`, `Tests 6 failed \| 435 passed \| 1 skipped (442)` | none — same 4 files, same 6 cases |
| `$PNPM run lint` | red | exit 1 — **10 382** diagnostic lines, identical to the previous round's measurement; `extension.ts` 22, `auto-start-orchestrator.ts` 1 (`:236`), `session-host.ts` 1 (`:597`), `node-env-guard.spec.ts` **0** | none (see §4.3) |
| `$PNPM run test:docs` | red — `run-gates: 10 passed, 5 failed, 0 skipped` | red — `run-gates: 10 passed, 5 failed, 0 skipped in 27.53s`, same five gates (`markdown links`, `translation pairing`, `markdown wrap`, `agent note format`, `documentation standard tests`) | none; `grep -cE "development\.(md\|zh\.md)"` over the output returns **0** |
| `$PNPM run test <path>` (with `--`) | not usable — runs the whole corpus | not used, per the spec | — |

The four red app-suite files are unchanged in identity and count from the baseline: `spike-t0b-continue-capability.spec.ts` (whole suite, `Cannot read properties of undefined (reading 'UNLOADING')` at `packages/core/agent-loop/src/index.ts:40`), `spike-t0a-replay-rebuild.spec.ts` (4 cases, `Cannot read properties of undefined (reading 'PENDING')` at `scripts/test-invariants.ts:88`), `panel-close-delete.e2e.spec.ts` (1 case), `verifier-phase1/layer-a-rtl.spec.tsx` (1 case). None is a file this phase touched. Case totals rose from 441 to 442 because N1 split one case into two.

### 4.2 This phase's own cases

| Command | Result |
|---|---|
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | `Test Files 4 passed (4)`, `Tests 70 passed (70)`, exit 0 |
| `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts --reporter=verbose` | `Tests 28 passed (28)`, exit 0 |

Verbose output for the three N1/D-2 cases, verbatim:

```
✓ … > node environment diagnostic (AC-8, AC-9) > pins exactly one machine-readable version that the declared range admits (AC-1 a) 1ms
✓ … > node environment diagnostic (AC-8, AC-9) > locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) 53ms
✓ … > node environment diagnostic (AC-8, AC-9) > names the pinned release in both developer docs (AC-1 c, AC-3) 1ms
✓ … > extension reads dsh.nodeBin (AC-10 e) > re-reads the setting on every start instead of caching the first value (AD-9) 3ms
✓ … > extension reads dsh.nodeBin (AC-10 e) > classifies a non-string setting as invalid-setting, not a process failure 1ms
```

The AC-1(b) case taking 53 ms is itself evidence that it spawned the located interpreters rather than reading a constant. Every AC-4 / AC-7 / AC-8 / AC-9 / AC-10 runtime case constructs its input, executes it, and asserts the output; none is a static assertion.

### 4.3 Lint delta, per file (measured)

`$PNPM run lint` (the gate: `tsx scripts/run-oxlint.ts .`, authoritative `.oxlintrc.json`) exits 1 both at the baseline and now, yielding **10 382** diagnostic lines — the same total the previous round measured. Per file this phase touched:

| File | Diagnostics | On a line this phase added? |
|---|---:|---|
| `apps/vscode-dsh/src/node-env-guard.ts` (new) | 0 | — |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` (new) | 0 | — (including the 24 lines of locator helpers and assertions added this round) |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts` (new) | 0 | — |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 1 — `:236:24` (`no-non-null-assertion`) | no — added ranges are `26-61` and `226`; `:236` is `more[more.length - 1]!`, unchanged text, at `:230` before this round's six added lines |
| `apps/vscode-dsh/src/session-host.ts` | 1 — `:597:3` (`require-await`) | no — added ranges are `14`, `16`, `27`, `29`, `42-81`, `108-111`, `255-256`, `287-292`, `302`, `323-329` |
| `apps/vscode-dsh/src/extension.ts` | 22 — `:271`, `:375`, `:380`, `:385`, `:407`, `:425`, `:662`, `:750`, `:1004`, `:1102`, `:1152`, `:1418`, `:1450`, `:1492`, `:1534`, `:1791`, `:2109` (2), `:2110`, `:2111`, `:2272`, `:2274` | no — added ranges are `34`, `48`, `223-236`, `2172-2192`, `2255`, `2258`; every one of the 22 is outside them |
| `apps/vscode-dsh/src/index.ts` | 1 — `:97:3` (`no-deprecated`) | no — the added range is `25-39` |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | 4 — `:52:39`, `:53:9`, `:95:36`, `:96:9` | no — added ranges are `8`, `12-15`, `143-177`; all four are in the pre-existing `mockPort` helper |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts`, `phase2-auto-ready.spec.ts`, `phase4-new-conversation-chrome.spec.ts` | 2 / 15 / 11 | no — the added ranges are `70-74`, `49-53`, `75-79` |
| `packages/sdk/client/{src/launch.ts,src/types.ts,src/index.ts,tests/launch.spec.ts}` | 0 | — |
| `apps/vscode-dsh/package.json` | 0 | — |

Added ranges are read off `git diff -U0` hunk headers (cumulative for rounds 1–2, since nothing is committed). Under the reduced rule set (`.oxlintrc.staged.json`, what `lint:fix` uses) `extension.ts` yields **3** diagnostics, all on unmodified code; this report states the value each command produces rather than choosing one, and the zero-new conclusion holds under either.

### 4.4 Falsification probes (this round's runtime claims)

Each probe mutated one file, ran the exact command, recorded the red result, then restored the file and re-confirmed green. Nothing was left behind: the spec file's `sha256` after restore is `6ccde32118ced45094069c10e8ac4016eca350a42904f042c810fc131dd0cacb`, identical to the pre-probe hash, and a scan for the probe markers (`// PROBE N1`, `// PROBE D-2`) returns no matches.

| Claim | Mutation applied | Observed (verbatim fragments) | Restored |
|---|---|---|---|
| **D-1** — item codes are gone and `AD-*` survived | none needed; the probe is the scan the item itself specifies, plus a reverse check that the retained references are still there | `grep -rnE '\((S[0-9]+\|M[0-9]+)[,)]\|// *(S\|M)[0-9]+:' apps/vscode-dsh/` → **no output, exit 1**. `grep -rnE 'AD-[0-9]+' apps/vscode-dsh/src/*.ts` still lists `auto-start-orchestrator.ts:38` (AD-4), `extension.ts:224`/`:2173` (AD-10), `session-host.ts:51`/`:108` (AD-4/AD-1), `node-env-guard.ts:111`/`:152`/`:250` (AD-2/AD-1/AD-1) | n/a — no mutation |
| **D-2a** — the new class must be a vocabulary member, not a rename of the generic one | removed `'invalid-setting'` from `START_ERROR_KINDS`, so the thrown class falls to the generic member | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts -t "invalid-setting"` → exit 1, `Tests 1 failed \| 27 skipped (28)`, `AssertionError: expected 'process-failed' to be 'invalid-setting' // Object.is equality` | yes |
| **D-2b** — the source must carry the class, not the guard guess it | reverted `readNodeBinSetting` to `throw new Error(…)` (the pre-fix, `kind`-less form) | same command → exit 1, `Tests 1 failed \| 27 skipped (28)`, `AssertionError: expected 'process-failed' to be 'invalid-setting' // Object.is equality` | yes |
| **N1-P1** — the case must validate the *located* interpreter, not any working Node | pinned the AC-1(b) case's version to `22.14.0`, which is installed in the nvm root but lacks the APIs | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts -t "AC-1 b"` → exit 1, `× locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b)`, `AssertionError: ~/.nvm/versions/node/v22.14.0/bin/node (/home/chendc/.nvm/versions/node/v22.14.0/bin/node) was rejected by the pre-flight: expected false to be true` | yes |
| **N1-P2** — an absent pin must end non-PASS, and the legacy form would have passed | pinned the same case to `24.4.0`, which is installed nowhere | `$PNPM run test apps/vscode-dsh/tests/node-env-guard.spec.ts -t "AC-1 b" --reporter=verbose` → exit 0 with `↓ … locates the pinned release in each documented root and the pre-flight accepts it (AC-1 b) 15ms [no install of 24.4.0 to locate; checked /usr/local/n/versions/node/24.4.0/bin/node=absent; ~/.nvm/versions/node/v24.4.0/bin/node=absent; command -v node=/usr/local/n/versions/node/24.3.0/bin/node (24.3.0)]` and `Tests 28 skipped (28)`. Contrast with the previous round's AC-1 case, which asserted `process.execPath` and would have reported **pass** under the same mutation — that is the gap N1 names | yes |

After the restorations: `$PNPM run typecheck` exit 0 and the four-spec command in §4.2 reports `Tests 70 passed (70)`, exit 0.

### 4.5 Real-machine probes (round-1 evidence, still current)

Probed through the shipped guard by running the compiled module with `tsx` and calling `validateNodeEnvironment({path, source, electronRunAsNode:false})`:

| Interpreter | Reported version | `hasZstd` | `hasWithResolvers` | Verdict |
|---|---|---|---|---|
| `/usr/local/n/versions/node/24.3.0/bin/node` | 24.3.0 | true | true | `ok:true` |
| `/usr/bin/node` | 18.12.1 | false | false | `missing-apis`, both names listed |
| `~/.nvm/versions/node/v22.14.0/bin/node` | 22.14.0 | false | true | `missing-apis`, `zlib.createZstdDecompress` only |
| `/usr/local/n/versions/node/22.9.0/bin/node` | 22.9.0 | false | true | `missing-apis`, `zlib.createZstdDecompress` only |

The last two rows are also the AD-2 demonstration: those interpreters are below the declared floor, yet the reported kind is `missing-apis` with API names, never a version-based rejection. Two further machine measurements:

| Probe | Measured |
|---|---|
| `env -i PATH=/usr/bin:/bin sh -c 'command -v node; node --version'` | `/usr/bin/node`, `v18.12.1` |
| `PATH="/usr/bin:/usr/local/node/bin:$PATH" $PNPM run typecheck` | exit 1, `ERROR: This version of pnpm requires at least Node.js v22.13` |

## 5. Deviations and conflicts with the phase's stated premises

1. **D-2 is satisfied with a new vocabulary member, not by reusing `node-environment`.** The reasoning is in §1.3: `session-host.ts:62`'s diagnostic invariant would break. This is a deliberate reading of the instruction's intent ("an independent machine-readable class") rather than the shortest edit.
2. **N1 keeps the AC-1(b) case's previous `process.execPath` assertion out of AC-1.** Re-attaching it would have re-welded the AC to this machine's installed versions; AC-4's forward coverage and §4.5's probes carry that observation instead.
3. **D-1 removes the item code from `auto-start-orchestrator.spec.ts:144`'s describe title as well**, beyond the three sites the review listed, because the same rule applies and the review's own text names the file.
4. **`process-failed` is kept as the single generic member.** Round 1 removed `'start-failed'` as a universal class, which is what the review asked; Phase 2's spec asserts `errorKind === 'process-failed'` for an unclassified failure, so dropping the member would break an approved downstream spec.
5. **AD-2 was violated by the first revision of this phase and was corrected in round 1.** The initial `node-env-guard.ts` gated on the version string (`unsupported-version`); AD-2 states the gate is decided by capability, and AC-4(c) requires the `{"version":"20.16.0",…}` stand-in to classify as `missing-apis`. The version comparison was removed and the capability tests reordered.
6. **A fourth failure kind, `unusable`, exists beyond the spec's three names.** It covers a candidate that exists and is executable but cannot report Node capabilities (non-zero exit, non-report output, or timeout). Folding it into `missing-apis` would print API names that were never observed. The spec enumerates no closed taxonomy.
7. **Whitespace asymmetry is deliberate and matches the spec's boundary list.** `DSH_NODE_BIN='   '` counts as *set* (used as given, then fails the gate loud), while `dsh.nodeBin='   '` counts as *unset* and falls through.
8. **The `docs/development.md` verification wording was corrected in round 1.** The first revision claimed `pnpm run typecheck` refuses to start when the interpreter is outside `engines.node`; measurement (§4.5) shows the refusal comes from pnpm's own floor (22.13), and that a clean `PATH` on this machine resolves `/usr/bin/node` v18.12.1 rather than the v20.16.0 the spec's snapshot names.
9. **Machine facts that differ from the spec snapshot.** The spec calls `/usr/local/n/versions/node/24.3.0` the only qualifying install; `/usr/local/bin/node` is a second genuine v24.3.0 binary, and `~/.nvm/versions/node/v20.16.0` exists but is not what a clean `PATH` resolves. Neither difference changes the implementation, and AC-1(b) now tolerates either by locating on version rather than on a hardcoded single path.
10. **The two checklist titles and the two face titles are bold lead-ins, not ATX headings**, following the house style of their siblings in `docs/development.md`. The structural assertions match the label text, so they are independent of the emphasis markup.
11. **`HostStartError` is additive but changes the thrown class for every `start()` failure**, and now covers `invalid-setting`, `node-environment`, and `process-failed`. The pre-existing app suites still pass; the type is exported so callers can discriminate.
12. **`contributes.configuration` also carries a `title`** (added in round 1): only the property block is required; the title groups the setting in the VS Code settings UI.
13. **No published name was removed.** `resolveNodeExecutable()` was private to `launch.ts` at HEAD, so replacing it with `resolveNodeExecutableSpec()` alters no public surface.
14. **The `dsh.nodeBin` property carries two keys beyond the required minimum**: `"scope": "machine-overridable"` because the offending value is a property of the machine, and `"markdownDescription"` so the settings UI renders the API names and range as code.
15. **The setting is routed to the host as an explicit input, not read implicitly.** `extension.ts:2255-2258` reads it and passes it to `IdeSessionHost.start`, because the host is also exercised without VS Code, the SDK already models the same input as a request object, and `readNodeBinSetting` returns `undefined` for unset so that "unset" and "empty string" stay distinguishable at the editor boundary.
16. **The "diagnostic injection point reserved for Phase 2" is three existing typed surfaces**, not a new sink: `IdeSessionHost.onError`, `AutoStartOrchestrator.getSnapshot()` / `onChange()`, and `HostStartError{kind, diagnostic}`. Phase 2 still owns the sink type, its six-class `HostFailureKind` vocabulary, and redaction policy.
17. **`StartErrorKind` lost the `'other'` member in round 1.** Keeping both `'other'` and `process-failed` would leave two generic classes. `'other'` remains in Phase 2's record vocabulary, a different type in a different phase.

## 6. Unresolved items and risks

1. **AC-10(f)** (real Extension Development Host consuming the pre-placed `settings.json`) remains a Phase 3 obligation, as the spec requires. Phase 1 must not be judged complete or incomplete on that branch.
2. **`$PNPM run doc-sync`** was not run: the spec assigns the first `test:docs` pass to this phase and reserves `doc-sync` for Phase 4's re-check.
3. **The red `lint` baseline is untouched by design.** Its components are in-tree build residue (untracked `packages/**/src/*.d.ts` and maps) and the pre-existing `no-unsafe-*` / `no-unnecessary-*` class in `apps/vscode-dsh/tests/**`, whose structural cause is that `apps/vscode-dsh/tsconfig.json` includes only `src`, leaving those test files outside any TypeScript program. Repairing that class would change the `typecheck` baseline this phase must keep green.
4. **`apps/vscode-dsh` has no coverage gate** while `packages/sdk/client` keeps its per-file 100% requirement. This phase added no uncovered branch to the SDK.
5. **`unusable` is the only classification that depends on subprocess behaviour** (exit code, output, timeout) and so is where a unit-test-only regression could hide. It is covered by a real stand-in that exits non-zero and by the `electronRunAsNode` case; the timeout branch is not separately exercised, since inducing it needs a long-running fixture.
6. **AC-1(b) is environment-dependent by design.** On a machine with no install of the pinned release it reports skipped rather than passed, and the verifier must record that outcome as non-PASS rather than as success — which is exactly what the spec's verification strategy requires. On this machine it passed by executing `/usr/local/n/versions/node/24.3.0/bin/node` and the identical interpreter that `command -v node` resolves.
7. **The app-suite red set is concurrency-sensitive in membership but stable in count.** The four failing files and six failing cases matched the baseline in every run recorded here, but the two single-case failures belong to the same shared-resource family that varies between runs. A verifier reading a different pair should compare totals and root causes, not just names.

## 7. Documentation gates (commands actually executed)

| Command | Result |
|---|---|
| `$PNPM run test:docs` | exit 1 — `run-gates: 10 passed, 5 failed, 0 skipped in 27.53s`, identical to the baseline tally and to the previous round's failing five (`markdown links`, `translation pairing`, `markdown wrap`, `agent note format`, `documentation standard tests`) |
| `grep -cE "development\.(md\|zh\.md)"` over the `test:docs` output | **0** — neither file of this phase's documentation pair appears in any violation list |
| `$PNPM run verify-translation-pairing --write docs/development.md` | recorded in round 1 for the M1 and S7 edits; **not re-run this round**, because this round changes no documentation prose that is paired — `design.md` / `design-zh.md` are workflow artifacts outside the pairing gate, and the two AD-4 lines were edited identically in both languages |

This round touched no paired documentation pair. The five failing gates were checked line by line: `translation pairing` reports `docs/wiki/**` pages without English counterparts and `packages/**/README.*`, `markdown links` reports `docs/wiki/**` and two `README.zh.md` anchors in `packages/ide/ide-bridge` and `packages/bundle/ide` — none of them this phase's files.
