# Connectivity Review — Phase 1 (`phase-1-node-env-preflight`)

- **Role**: `reviewer-connectivity` (one of three parallel reviewers).
- **Scope**: integration connectivity only — do the pieces actually connect and does data flow end to end. Implementation correctness and design consistency are the other two reviewers' scope and are not assessed here.
- **Repository**: `/workspace/chendecheng/code/need/deepseek/deepseek-harness`, branch `impl-phase-1-node-env-preflight` (read-only review; no code, spec status, or git state was modified).

## 判决

**SHOULD-FIX**

Every traced end-to-end chain is connected today. The AD-1 identity invariant holds (the object the pre-flight validates is the same object handed to `spawn()`), the setting-sourced executable is **not** mis-injected with `ELECTRON_RUN_AS_NODE`, the tier-3 Electron path does get the flag in the real spawn env, the pre-flight failure reaches the user-visible carrier, and the gate really does run before `bridge.listen`. Nothing is broken, so no MUST-FIX.

Three connections, however, hold by convention rather than by code:

- **S-1** The pre-flight probe executes the tier-3 Electron executable *without* the `ELECTRON_RUN_AS_NODE` mode that the very same `ResolvedNodeExecutable` declares for spawn. Empirically demonstrated (probe F below) to fail `unusable` when the flag is not inherited; it passes on a real host only because VS Code's Extension Host happens to export the flag.
- **S-2** `HostStartError.kind` / `.diagnostic` are written but read by no Phase 1 consumer; the phase spec claims an extension-side "diagnostic injection point for Phase 2" (`spec.md:133`) that `implementation.md` never records.
- **S-3** `AutoStartOrchestrator` flattens every start failure to `process-failed` (`auto-start-orchestrator.ts:192-196`), so the `node-environment` class stops being machine-readable one hop below the host.

Verdict rationale: paths complete, connection improvable → SHOULD-FIX (not PASS, because "any link that rests on an implicit assumption cannot count as PASS"; not MUST-FIX, because no link is severed and no acceptance criterion is violated — AC-5/AC-6/AC-10 pin `resolveDshLaunch().environment()`, not the probe's env, see `spec.md:47-49,53`).

## 端到端链路追踪

### Chain 1 — VS Code setting → real `spawn()`

| # | Hop | `file:line` | Connected | Note |
|---|-----|-------------|:--:|------|
| 1 | `dsh.nodeBin` declared (`string`, default `""`, priority + "leave empty" in description) | `apps/vscode-dsh/package.json:60-66` | ✅ | Satisfies AC-10(a); a `settings.json` value is therefore accepted by VS Code and reaches `getConfiguration` |
| 2 | Extension reads the setting | `apps/vscode-dsh/src/extension.ts:2179-2189` (`readNodeBinSetting`) | ✅ | `workspace.getConfiguration?.('dsh')` → `.get?.('nodeBin')`; `undefined`/`null` → `undefined`; non-string throws (fail loud, no default) |
| 3 | Read at each start, handed to the host | `extension.ts:2253-2256` | ✅ | Read inside the start path (no cross-start caching, AC-9/AD-10); `{ nodeBinSetting }` spread only when defined |
| 4 | Host resolves + gates | `apps/vscode-dsh/src/session-host.ts:282-285` | ✅ | `resolveNodeExecutableSpec({nodeBinSetting})` then `assertNodeExecutable(same binding)` |
| 5 | Resolution (tier 2) | `packages/sdk/client/src/launch.ts:136-139` | ✅ | Setting non-empty after `trim()` → `{path: setting, source:'vscode-setting', electronRunAsNode:false}` |
| 6 | Gate consumes that object | `apps/vscode-dsh/src/node-env-guard.ts:155-158` → `115-147` | ✅ | `NodeEnvironmentFailure.source` = `executable.source` (`node-env-guard.ts:118-122`) — the field-level evidence Phase 3 will assert on |
| 7 | Same object handed to the client | `session-host.ts:292-301` (field at `:295`) | ✅ | `nodeExecutable` is the identical binding validated at `:285` |
| 8 | Launch spec consumes it, no re-resolution | `launch.ts:164-192` (consumption at `:177`, command at `:184`) | ✅ | `options.nodeExecutable ?? resolveNodeExecutableSpec()` — the fallback is not taken on this path |
| 9 | Real spawn | `packages/sdk/client/src/client.ts:214-218` (`command`/`args`/`env: this.runtime.environment()`) | ✅ | `args` includes `--profile ide` (`launch.ts:185`); `environment()` is invoked at the spawn site, so the flag is materialised there |

**AD-1 invariant — is the validated object the same one spawned?** Yes.
- Identity: `session-host.ts:282` binds one `const nodeExecutable`; `:285` validates that binding; `:295` forwards that binding. No copy, no re-derivation.
- `launch.ts:177` only resolves when `options.nodeExecutable` is **absent**; on the IDE path it is always present.
- **No hop re-reads the environment or re-resolves on this path.** Empirically proven by my own probe (chain D/E in "Independent validation"): resolve while `DSH_NODE_BIN=/frozen/node`, then delete the variable, then call `resolveDshLaunch` with the retained object → `command` stayed `/frozen/node` (a re-resolving implementation would have returned `process.execPath`). Inverse control: calling `resolveDshLaunch` with **no** object returned `/late/node`, i.e. the fallback does exist and is honestly reachable only for direct SDK callers.
- The integration test asserts the same property on the failing path: `apps/vscode-dsh/tests/session-host-preflight.spec.ts:163` spies `resolveNodeExecutableSpec` and expects exactly one call with no second source (test at `:155`, `:204`).

### Chain 2 — `DSH_NODE_BIN` (tier 1) → spawn

| # | Hop | `file:line` | Connected | Note |
|---|-----|-------------|:--:|------|
| 1 | Parent Extension Host environment read | `launch.ts:132` (`process.env.DSH_NODE_BIN`) | ✅ | Read in the resolving process; resolution runs inside the Extension Host (`session-host.ts:282`), **not** in the child — the two are not conflated |
| 2 | Non-empty → tier 1 wins | `launch.ts:133-134` | ✅ | Precedence over the setting confirmed empirically (`{"path":"/env/node","source":"dsh-node-bin","electronRunAsNode":false}` even with `nodeBinSetting=/setting/node`) and by `launch.spec.ts` AC-5(b) |
| 3 | `electronRunAsNode:false` → no flag | `launch.ts:180-182` | ✅ | Empirically: env-sourced launch exposes `environment().ELECTRON_RUN_AS_NODE === undefined` under a defined `process.versions.electron` (AC-5(a)) |
| 4 | Child env scrub | `apps/vscode-dsh/src/env.ts:30-39` + `packages/subprocess/subprocess/src/index.ts:64-68` | ✅ | `scrubbedParentEnv()` drops `DSH_*` and sensitive names — **no impact on this chain**: tier 1 reads the *parent* env at resolve time (`launch.ts:132`), while the scrub shapes only what the already-resolved `dsh` child sees. The resolution result travels as an object (`nodeExecutable`), not as a re-read variable |

### Chain 3 — Electron tier 3 (`process.execPath` + `ELECTRON_RUN_AS_NODE`)

| # | Hop | `file:line` | Connected | Note |
|---|-----|-------------|:--:|------|
| 1 | Tier 3 selected and the mode declared | `launch.ts:140-144` | ✅ | `{path: process.execPath, source:'process-exec-path', electronRunAsNode: process.versions.electron !== undefined}` |
| 2 | Launch injects the flag | `launch.ts:180-182`, spread at `:190` | ✅ | `{ELECTRON_RUN_AS_NODE:'1'}` is spread **after** `options.env`, so it wins over a scrubbed inherited env |
| 3 | Flag reaches the real spawn `env` | `client.ts:216` (`env: this.runtime.environment()`) | ✅ | Traced to the actual `spawn()` call, not merely to the closure's return value |
| 4 | Second, independent route | `env.ts:32` → `subprocess/src/index.ts:67` | ✅ | The scrub drops only sensitive + `DSH_*` names, so `ELECTRON_RUN_AS_NODE` also survives intact in `buildIdeChildEnv` — two independent routes to the child, so the spawn env cannot lose the flag |
| 5 | Empirical, tier 3 | own probe C | ✅ | `commandIsExecPath:true`, `electronEnv:'1'` |
| 6 | Empirical, tier 2 (**the phase's most fragile link**) | own probe A | ✅ | `{"command":"/setting/node"}` and `ELECTRON_RUN_AS_NODE` **absent** (key absent from the serialised env) — no mis-injection from the setting source; the earlier duplicated `DSH_NODE_BIN` emptiness test no longer leaks into the setting branch |
| 7 | Empirical, tier 1 | own probe B | ✅ | `{"command":"/env/node"}`, flag absent |
| 8 | Gate probe env | `apps/vscode-dsh/src/node-env-guard.ts:253-256` | 🟡 | `execFileAsync(path, ['-e', PROBE_SOURCE], {timeout, windowsHide})` passes **no `env`** → the probe inherits the raw `process.env` and never applies `executable.electronRunAsNode` (S-1) |
| 9 | Empirical, gate under tier 3 | own probe F | 🟡 | With `{electronRunAsNode:true}` and the flag removed from the parent env → `unusable`; with the flag present → `ok`. The gate therefore validates the Electron executable only when the mode happens to be inherited |

### Chain 4 — pre-flight failure → user-visible diagnostic

| # | Hop | `file:line` | Connected | Note |
|---|-----|-------------|:--:|------|
| 1 | Gate throws | `node-env-guard.ts:155-158` (`NodeEnvironmentError`) | ✅ | Carries the 5-element failure (`:167-176`) |
| 2 | Host captures, classifies, redacts | `session-host.ts:311-322` | ✅ | `status='error'` (`:312`), `errorMessage=redactSecrets(5-element text)` (`:314`), `shutdownInternal` (`:315`), then `HostStartError('node-environment', …, {diagnostic: error.failure})` (`:317-320`) |
| 3 | Legacy class preserved | `session-host.ts:322` | ✅ | Non-`NodeEnvironmentError` → `HostStartError('start-failed')`; deviation #7 did not swallow the pre-existing class |
| 4 | Orchestrator snapshot | `apps/vscode-dsh/src/auto-start-orchestrator.ts:189-197` | ✅ | `state='failed'`, `errorMessage=error.message` (the 5-element text survives) |
| 5 | …but the class is flattened | `auto-start-orchestrator.ts:192-196`, type at `:27` | 🟡 | Any error that is not `missing-credentials` becomes `process-failed`; `node-environment` is not representable in `StartErrorKind` (S-3) |
| 6 | UI state | `apps/vscode-dsh/src/connection-ui.ts:141-160` (`message` at `:147`), `shouldShowStatusBar` at `:163-170` | ✅ | `failed` → panel-primary when the panel is visible, status bar otherwise — at least one carrier always shows the message |
| 7 | Panel carrier | `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:282-284` (`pushBanner(state.message, 'failed')`) | ✅ | The message text is the banner body |
| 8 | Secondary carrier **not** taken | `extension.ts:2238-2239` (`next.onError` → `showErrorMessage`) | ⚠️ | Pre-flight failures produce no `HarnessClient`, so no `errorListeners` fire. Correct today because ConnectionUi is the designated primary carrier; see implicit assumption I-7 |
| 9 | End-to-end test of the whole chain | `apps/vscode-dsh/tests/node-env-guard.spec.ts:500-519` | ✅ | A real `settings.json` on disk → real `activate` → real `IdeSessionHost.start` (not mocked) → `dsh.test.requestStart` → `snapshot.state==='failed'`, `errorMessage` contains the absent path **and** `dsh.nodeBin`; the settings file is byte-identical afterwards (proxy evidence of no silent fallback) |

### Chain 5 — AC-7 ordering (`node gate → bridge.listen → spawn`)

| # | Hop | `file:line` | Connected | Note |
|---|-----|-------------|:--:|------|
| 1 | Status/field bookkeeping | `session-host.ts:253-266` | ⚠️ | Pre-gate writes exist: `status='starting'` (`:256`) and `bridgePath` (`:266`). They are not spawn/socket side effects; the only observable effect is a status notification with phase `starting` |
| 2 | Bridge constructed + handlers registered | `session-host.ts:267-278` | ⚠️ | Construction and handler registration precede the gate, but neither creates the socket — the socket is created in `listen()` |
| 3 | Gate | `session-host.ts:285` | ✅ | `await assertNodeExecutable(nodeExecutable)` |
| 4 | Socket creation | `session-host.ts:286` | ✅ | `await bridge.listen(bridgePath)` — strictly after the gate |
| 5 | Spawn | `session-host.ts:292-303` → `client.ts:214` | ✅ | Strictly after both |
| 6 | AC-7(ii) proof | `session-host-preflight.spec.ts` | ✅ | Gate failure → `existsSync(bridgeSockPath) === false` and no witness file; `status === 'error'`; elapsed far below the handshake timeout (AC-7(iv)) |
| 7 | Fail-closed cleanup | `session-host.ts:315` → `shutdownInternal` | ✅ | On failure the bridge is closed; the test's socket-absent assertion confirms no socket is left behind |

I found **no side effect that precedes the gate beyond `status='starting'` and object construction**; in particular nothing on the pre-gate path reaches `IdeBridgeHostServer.listen()`, so AC-7(ii) is not vacuous.

### Chain 6 — do the tests cover the chain, or only isolated units?

| Question | Evidence | Verdict |
|---|---|:--:|
| Real child process rather than mocks? | `session-host-preflight.spec.ts:7-10,40-62` — `dshBin` points at a witness `.cjs` that does `writeFileSync(...)`; the test reads that file | ✅ Real |
| Whole chain (setting → gate → no spawn) or only `node-env-guard`? | `:124` (missing API), `:155` (setting source, incl. `resolveNodeExecutableSpec` call count), `:204` (missing path via setting), `:237` (env source), `:263/:284` (positive spawn through each source), `:305` (env over setting) — all through a real `IdeSessionHost.start()` | ✅ End-to-end |
| Positive control (proves the harness would notice a spawn)? | `:263/:284` assert `witness.execPath === process.execPath`, i.e. the witness *does* get written when start succeeds | ✅ |
| Real `settings.json` consumed by the extension? | `node-env-guard.spec.ts:434-436,500-519` | ✅ |
| Result (first-hand) | `pnpm run test apps/vscode-dsh/tests/session-host-preflight.spec.ts` → **1 file / 7 tests passed**; `pnpm run typecheck` → exit 0 | ✅ |

## Must-Fix

None. No severed link, no contract mismatch, no frozen interface touched, no cross-Phase regression found.

## Should-Fix

**🟡 S-1 — the pre-flight probe does not apply the invocation mode the resolved object declares.**
`apps/vscode-dsh/src/node-env-guard.ts:253-256` runs the candidate with `{timeout, windowsHide}` and no `env`, while `launch.ts:180-190` spawns the same object with `ELECTRON_RUN_AS_NODE=1` when `electronRunAsNode` is true. My probe F reproduces the divergence: a candidate that only behaves as Node with the flag returns `failure.kind === 'unusable'` when the parent env lacks the flag, and `ok` when it has it. On a real VS Code host the flag *is* present — `/usr/share/code/resources/app/out/vs/workbench/api/node/extensionHostProcess.js` sets `process.env.ELECTRON_RUN_AS_NODE="1"` in its process bootstrap (same statement group as `process.crash = …`), so the real Extension Host, its probe, and the spawned child all inherit it. Impact is therefore bounded, and the failure direction is fail-loud (refuse to start) rather than a broken child. Suggested direction: pass `env: {...process.env, ...executable.electronRunAsNode ? {ELECTRON_RUN_AS_NODE:'1'} : {}}` to the probe so validation happens in the same mode the object will be spawned in. Scope note: AC-5/AC-6/AC-10 test the launch environment, not the probe environment (`spec.md:47-49,53`), which is why this is not MUST-FIX.

**🟡 S-2 — the claimed Phase 2 injection point is not recorded, and `HostStartError.diagnostic` has no Phase 1 consumer.**
`spec.md:133` says `extension.ts` was modified "为 Phase 2 预留诊断注入点", but `implementation.md` / `implementation-zh.md` contain no mention of Phase 2 at all (verified by search). The actual injection surface does exist and is exported (`apps/vscode-dsh/src/index.ts:25`, `session-host.ts:46,52-70`, `:317-320`), and the error object is in scope at `auto-start-orchestrator.ts:189-197`, so Phase 2 can attach without new plumbing. What is missing is only the traceability sentence plus the acknowledgement that `kind`/`diagnostic` are written-but-unread in Phase 1 (write-then-read-next-phase, not a data black hole — the user-visible message already flows through `errorMessage`). Suggested direction: add the Phase 2 hand-off note to `implementation.md` §4/§5 and to `tech-debt-registry.md` if the registry is the intended carrier.

**🟡 S-3 — the machine-readable class does not survive the orchestrator hop.**
`auto-start-orchestrator.ts:27` defines `StartErrorKind = 'missing-credentials' | 'process-failed' | 'other'` and `:192-196` maps everything except `missing-credentials` to `process-failed`. `HostStartError.kind === 'node-environment'` (`session-host.ts:317`) is therefore readable only inside `runStart`'s catch. Any Phase 2 diagnostic record built on the snapshot must either widen this type or read the originating error. Suggested direction: let the catch carry `HostStartError.kind` (and `diagnostic`) into the snapshot rather than collapsing to `process-failed`.

## 隐式假设清单

| # | Assumption | Where it is relied on | Why it matters |
|---|-----------|----------------------|----------------|
| I-1 | The Extension Host process has `ELECTRON_RUN_AS_NODE=1` in its environment | `node-env-guard.ts:253` (probe) | The tier-3 gate passes only through inheritance (S-1, probe F). Verified statically in the installed VS Code build; not verified at runtime in a real Extension Development Host |
| I-2 | A Node path named by tier 1/2 runs as Node *without* the flag | `launch.ts:134,138,180-182` | Deliberate (JSDoc `launch.ts:126-127`): pointing `dsh.nodeBin` at the Electron binary itself would be probed and spawned without the flag and fail loud — an accepted failure mode, not a silent one |
| I-3 | Callers that resolved an executable always forward it | `session-host.ts:282-295`; fallback at `launch.ts:177` | AD-1 holds only because the host binds and forwards one object. A caller that passes `nodeBinSetting` but omits `nodeExecutable` silently re-resolves from the current environment. No such caller exists in the repo today (only `session-host.ts` and the SDK's own default path) |
| I-4 | Constructing the bridge and registering handlers is side-effect free | `session-host.ts:267-278` | AC-7(ii) depends on the socket being created only inside `listen()` (`:286`); verified by the socket-absent assertion |
| I-5 | Whitespace-only sources behave differently by design | `launch.ts:133` (`!== ''`) vs `:137` (`.trim() !== ''`) | `DSH_NODE_BIN=' '` counts as *set* and fails loud at the gate; `dsh.nodeBin=' '` counts as *unset* and falls through to tier 3. Both directions are fail-loud-or-documented; recorded here because the asymmetry is invisible at the call site |
| I-6 | "spawn count 0" refers to the `dsh` runtime child, not to every child process | `session-host-preflight.spec.ts:40-62` | The gate's own probe is a child process of the candidate interpreter (the legacy candidate in AC-4(c) *is* executed before it is rejected). The witness-file technique correctly scopes the observation to the `dsh` child; a future driver asserting "no child process at all" would be wrong |
| I-7 | ConnectionUi is the primary diagnostic carrier for pre-flight failures | `extension.ts:2238-2239` vs `connection-ui.ts:147` | `next.onError` never fires for a pre-flight failure (no client ⇒ no error listeners). One of the two ConnectionUi carriers is always shown, so the message is not lost; a future change that keyed the failure display on `onError` alone would lose it |
| I-8 | Redaction does not strip the diagnostic text | `session-host.ts:314` | AC-8 assertions read the redacted `host.errorMessage` and match path, version range and API names; the passing AC-8 cases confirm redaction leaves the 5 elements intact |

## 跨 Phase 接口面

**Phase 2 (fail-loud diagnostics) — can it attach without changing this phase's interfaces?**
The inputs Phase 2 needs are already exported and additive: `HostStartError` + `HostStartErrorKind` (`index.ts:25`), `diagnostic: NodeEnvironmentFailure` with `source`/`sourceLabel`/`executablePath`/`kind`/`missingApis` (`session-host.ts:56`, `:317-320`, `node-env-guard.ts:118-122`), and the guard's own exports (`index.ts:26-39`). The originating error object is in scope at the consumption point (`auto-start-orchestrator.ts:189-197`), so Phase 2 can read `kind`/`diagnostic` there without new plumbing from Phase 1. What Phase 2 must necessarily *widen* is `StartErrorKind` (`:27`) and the guard's failure-kind vocabulary — both are declared in Phase 2's own spec, which states it modifies `session-host.ts` and `auto-start-orchestrator.ts`; that is additive widening, not a break of a Phase 1 interface that another phase already depends on. The only gap is documentation (S-2): `spec.md:133`'s "injection point for Phase 2" claim is absent from `implementation.md`.

**Phase 3 (real-machine smoke) — can it attach without changing this phase's interfaces?**
Yes. Phase 3's field-level assertion (`source === 'vscode-setting'`, `resolvedExecutable` equals the pre-placed path) needs: (i) a single resolution entry exposing the source — `resolveNodeExecutableSpec` (`launch.ts:131-145`) with `NodeExecutableSource` in `packages/sdk/client/src/types.ts`; (ii) a real `settings.json` → `dsh.nodeBin` consumption path — `package.json:60-66` + `extension.ts:2179-2189`; (iii) an observation surface for the source — `failure.source` (`node-env-guard.ts:59,119`) carried into `HostStartError.diagnostic` for Phase 2's record. Its AD-11 requirement to explicitly clear an inherited `DSH_NODE_BIN` is exactly the precedence this review confirmed empirically (tier 1 outranks the setting — probe B), so Phase 3's precondition is real, not hypothetical.

**AC-10(f) division of labour — consistent across the three documents?**
Yes, identically: `spec.md:102` ("Phase 1 judges (a)–(e); the real-machine branch is Phase 3's evidence; must be recorded verbatim in `verification.md`; failing it invalidates the whole AC"), `implementation.md:68` and `:163`, and the Phase 3 side `phases/phase-3-layer-v-smoke-loop/spec.md:9` and `:195` ("补充证据（非二次归属）", AC-10 归属 Phase 1). No contradiction in ownership or in the fail-through rule.

## 未验证项

- **UNVERIFIED (runtime)**: the real Electron Extension Host actually exports `ELECTRON_RUN_AS_NODE=1` to extensions. Evidence is static (`/usr/share/code/resources/app/out/vs/workbench/api/node/extensionHostProcess.js`, a `process.env.ELECTRON_RUN_AS_NODE="1"` assignment in the Extension Host process bootstrap). No Extension Development Host was launched in this review — that is Phase 3's obligation.
- **UNVERIFIED**: the practical impact of S-1 on a real host (no test covers the probe's env under Electron; the phase's ACs target `resolveDshLaunch().environment()`).
- **UNVERIFIED**: whether `Editor`-side values for `dsh.nodeBin` from a *user* settings file (`scope: machine-overridable`) reach `getConfiguration('dsh')` unchanged through VS Code's precedence chain; only the test double and the declaration were inspected.
- **NOT RUN (out of the requested scope)**: `pnpm run test:coverage`, `pnpm run lint`, `doc-sync` gates, and every e2e/snapshot suite outside `apps/vscode-dsh` + `packages/sdk/client`.

## Verification commands and results (first-hand)

| Command | Result |
|---|---|
| `pnpm run test apps/vscode-dsh/tests/session-host-preflight.spec.ts` | **1 file / 7 tests passed** |
| `pnpm run test apps/vscode-dsh packages/sdk/client` | 4 files / 6 cases red: `panel-close-delete.e2e.spec.ts` (1 of 4), `spike-t0a-replay-rebuild.spec.ts` (4 of 4), `spike-t0b-continue-capability.spec.ts` (collection error, 0 tests), `verifier-phase1/layer-a-rtl.spec.tsx` (1 of 7). Observed causes: `TypeError: Cannot read properties of undefined (reading 'UNLOADING')`, `expected true to be false`, `expected '' to contain '--dsh-chrome-height'` — none on the Node resolution or launch path ⇒ identical to the declared baseline, no new failure introduced |
| `pnpm run typecheck` | exit 0 |
| Own probe: `tsx /tmp/dsh-conn-probe/probe.mts` (written outside the repo; no repository file touched) | A: setting + Electron ⇒ `command=/setting/node`, no `ELECTRON_RUN_AS_NODE`. B: env + setting + Electron ⇒ `/env/node`, no flag. C: tier 3 ⇒ `commandIsExecPath:true`, flag `'1'`. D: resolve under `/frozen/node`, delete the env var, launch the retained object ⇒ `stillFrozen:true` (no re-resolution). E: launch without an object ⇒ `/late/node` (fallback exists, direct-SDK callers only). F: gate with `electronRunAsNode:true` ⇒ `unusable` without the inherited flag, `ok` with it |
