# Connectivity Review — Phase 1 (`phase-1-node-env-preflight`), round 2

| Field | Value |
|---|---|
| Perspective | **Integration Connectivity** — do the pieces actually connect end to end |
| Branch under review | `impl-phase-1-node-env-preflight` (confirmed with `git branch --show-current`) |
| Object under review | `implementation.md` (rework round 1, 2026-09-15 18:32) |
| Round | 2 — after the round-1 merged **MUST-FIX** verdict |
| Previous report | archived by this agent at startup to `.archive/review-connectivity-20260915T103404Z.md` (and the `-zh` twin), per the startup self-cleanup protocol |
| Upstream read in full | `spec.md`, `repo-exploration.md`, `implementation.md`, `design.md`, `requirements.md`, `phase-plan.md`, archived round-1 `review-connectivity.md`, `.archive/review-20260915T103312Z.md` |

## Verdict

**PASS** — every path this phase is required to connect is connected end to end, and every cross-module contract the phase introduces is consistent on both sides. No end-to-end path is broken, no contract is inconsistent, no cross-phase interface was changed without notice.

One **observation** (not a connectivity defect, not blocking) concerns the structured class of a failure branch no AC enumerates: see 🟢 O-1. It is recorded here so the orchestrator can route it (Phase 2 owns the record vocabulary) rather than lose it.

Evidence for this verdict is my own reading of the code plus two independent measurement sets: a probe harness outside the repository (`/tmp/dsh-conn-probe2/probe.mts`, approved by the user) and the repository's own differential gates.

---

## 1. Verdict on the 13 round-1 findings

Legend: **FIXED-VERIFIED** = I re-derived the fix myself from code and/or executed it; **FIXED** = fix present in the artifact under review.

| # | Round-1 finding | Verdict | My verification (independent) |
|---|---|---|---|
| **M1** | `docs/development.md` / `.zh.md` lacked AC-3(d)'s decidable tokens | **FIXED-VERIFIED** | `docs/development.md:131` contains `Developer: Reload Window`, `workbench.action.reloadWindow`, `dsh.nodeBin`, `DSH_NODE_BIN`; `docs/development.zh.md:136` carries the same four tokens. Token chain doc → setting key → command id closes. |
| **M2** | `HostStartError{kind:'node-environment'}` flattened to `process-failed` at the orchestrator hop | **FIXED-VERIFIED** | Three independent confirmations: (i) code — `auto-start-orchestrator.ts:26-27` holds one array `START_ERROR_KINDS = ['missing-credentials','node-environment','process-failed']`, `:29-37` derives the type from it, `:47-55` `startErrorKindOf` is the only writer of `errorKind` on the catch path (`:220`), and `session-host.ts:51` declares `HostStartErrorKind = StartErrorKind` (shared by construction, not by convention); (ii) my probe G — a **real** `HostStartError('node-environment', …)` thrown through the port yields `snapshot.errorKind === 'node-environment'`, a plain `Error('spawn EBADF')` yields `process-failed`, and a legacy `{kind:'other'}` object yields `process-failed`; (iii) runtime case at `node-env-guard.spec.ts:666` (real activation → L2 snapshot). Falsifiability: the assertion compares to the literal `'node-environment'`, and probe G shows a flattening implementation produces `'process-failed'` on that same snapshot — so the case can go red; `implementation.md` §4.4 records the executed mutation (`Tests 2 failed | 34 passed (36)`). |
| **S1** | `implementation.md` AC-4 row named payload fields `zstd`/`withResolvers` | **FIXED** | §3 AC-4 row now reads `{"version":"20.16.0","hasZstd":false,"hasWithResolvers":false}`, matching the narrowing guard at `node-env-guard.ts:275-282` and the fixture at `node-env-guard.spec.ts:286-299`. |
| **S2** | `process-exec-path` remedy suggested `PATH`, contradicting the never-consult-`PATH` contract | **FIXED-VERIFIED** | `node-env-guard.ts:200` now names the executable's owner plus the two real levers. `grep -nE "PATH" apps/vscode-dsh/src/node-env-guard.ts` → one hit, `:190`, the JSDoc that states resolution *never consults* `PATH`; no diagnostic string contains `PATH`. Asserted bidirectionally at `node-env-guard.spec.ts:415-417`. |
| **S3** | `implementation.md`'s `extension.ts` lint count was untrue | **FIXED-VERIFIED** | I re-ran the gate myself (`pnpm --config.verify-deps-before-run=false run lint`): `extension.ts` = **22** diagnostics (matching §4.3, not the round-1 figure of 3), `session-host.ts` = 1 (`:595`), `auto-start-orchestrator.ts` = 1 (`:230`), `index.ts` = 1 (`:97`), and **0** in `node-env-guard.ts`, `node-env-guard.spec.ts`, `session-host-preflight.spec.ts`, `packages/sdk/client/{src/launch.ts,src/types.ts,src/index.ts,tests/launch.spec.ts}`. I also confirmed the "no new diagnostic" half myself: `:230` lies outside the orchestrator's added hunks (`@@ -26,2 +26,30 @@`, `@@ -192,5 +220 @@`), `:595` is outside `session-host.ts`'s added ranges, `index.ts:97` is outside its `@@ -25 +25,15 @@`, and none of the 22 `extension.ts` lines fall in its five inserted hunks. |
| **S4** | Manifest's extra `scope` / `markdownDescription` unrecorded | **FIXED-VERIFIED** | `implementation.md` §5.10 records both keys with rationale; `apps/vscode-dsh/package.json` diff shows `type`, `default`, `scope: "machine-overridable"`, `description`, `markdownDescription`. |
| **S5** | AD-9 "re-read, never cache" had no falsifiable test | **FIXED** | `node-env-guard.spec.ts:629-646` activates once and starts twice, rewriting the **real** `settings.json` between starts, and asserts the second snapshot's message contains `second` and not `first`; the `vscode` double re-reads the file per call (`:564-571`), so a cached value or a cached resolution both go red. §4.4 records the executed mutation (`Tests 4 failed | 23 passed (27)`). |
| **S6** | AC-3(a)(b) structural claims had no executable assertion | **FIXED** | `node-env-guard.spec.ts:96-165` adds `assertChecklistStructure` (each of the four titles exactly once; every local-environment entry carries a decidable token) and `:474-499` runs it against the **real** `docs/development.md` + `.zh.md` (`:31-32`), then deletes each face title in place and requires the same assertion to throw. |
| **S7** | "declared once" wording conflicted with `EXPECTED_NODE_RANGE` being a copy | **FIXED-VERIFIED** | `docs/development.md:105` now says the floor "has one owner, `engines.node` in the root `package.json`, which the extension mirrors in the range it enforces and a test keeps equal to that field"; the test exists — `node-env-guard.spec.ts:444-446` asserts `engines.node === EXPECTED_NODE_RANGE`. |
| **S8** | Setting → host routing decision unrecorded | **FIXED-VERIFIED** | §5.11 records the routing with three reasons; the wiring is real: `extension.ts:2253` `readNodeBinSetting(vscode)` → `:2254-2258` `next.start({ cwd, nodeBinSetting, credentials })` → `session-host.ts:106-109` declares the option → `:287-289` resolves once with it. |
| **S9** (raised by this perspective in round 1) | `probeNodeApis()` passed no `env`, so an `ELECTRON_RUN_AS_NODE` candidate was misjudged | **FIXED-VERIFIED** | `node-env-guard.ts:254-258` now takes the `ResolvedNodeExecutable`, builds an explicit environment, and sets `ELECTRON_RUN_AS_NODE=1` iff `executable.electronRunAsNode`; `:260-264` passes it to `execFileAsync`. The probed object is the spawned object: `session-host.ts:290` asserts `nodeExecutable`, `:300` hands the same object to `HarnessClient`, `client.ts:204` → `launch.ts:177` consumes `options.nodeExecutable` without re-resolving. Case `node-env-guard.spec.ts:240-267` is bidirectional (`ok:true` with the flag, `unusable` without). My probe F reproduced it independently: with `electronRunAsNode:true` the shim observed `ELECTRON_RUN_AS_NODE="1"`; with `false` it observed `""`. |
| **S10** | Phase 2's "diagnostic injection point" unrecorded | **FIXED-VERIFIED** | §5.12 names three typed surfaces with file/line: `IdeSessionHost.onError(listener) → disposer` (exists at `session-host.ts:195-200`; already subscribed at `extension.ts:2237-2240`), `AutoStartOrchestrator.getSnapshot()/onChange()` (exists; consumed at `extension.ts:402-405`), and `HostStartError{kind, diagnostic}` (`session-host.ts:57-77`). Phase 2 therefore attaches at an existing port rather than inventing a new sink. |

### 1.1 The implementer's three declared deviations from the literal review wording

| # | Deviation | My ruling |
|---|---|---|
| 1 | Keeps `process-failed` as the single generic member instead of deleting it | **Stands.** The vocabulary is one array (`START_ERROR_KINDS`) that is both the type and the guard, and the second umbrella member `'other'` is gone. I checked that nothing in the app referenced the removed member: `grep -rn "'other'\|"other"" apps/vscode-dsh/src apps/vscode-dsh/tests` → two hits, both unrelated to `errorKind` (`phase1-code-context.spec.ts:131`, `timeline-projector.spec.ts:59`); the only `errorKind` comparison in product code is `connection-ui.ts:140` against `'missing-credentials'`. `typecheck` is green, so no consumer lost a case. Phase 2's spec referencing `errorKind === 'process-failed'` for unclassified failures stays valid. |
| 2 | Corrects S3's figure (22 under the gate) instead of adopting the review's 3 | **Stands.** My independent gate run measured 22 for `extension.ts` and 0 for the three new files, and 1 each for the four touched pre-existing files on lines outside the added hunks (§1 above). Adopting 3 as "the" number would have been wrong under the gate command. |
| 3 | Satisfies S5 with a real `settings.json` rewrite rather than by changing the double's return | **Stands.** A stronger falsifier: it can catch a cached file read as well as a cached value, and the orchestrator-level assertion (second start sees the second value) is identical. |

---

## 2. End-to-end path tracing

### Path 1 — configured Node executable reaches the spawn (AC-5 / AC-6 / AC-10)

```
Entry: VS Code manifest key `contributes.configuration.properties["dsh.nodeBin"]`
  → extension.ts:2180  vscode.workspace.getConfiguration('dsh').get('nodeBin')      ✅ key read by name
  → extension.ts:2182-2188  undefined/null → undefined; non-string → fail loud     ✅ no silent default
  → extension.ts:2253-2256  IdeSessionHost.start({ nodeBinSetting })               ✅ explicit input, not implicit read
  → session-host.ts:287-289 resolveNodeExecutableSpec({ nodeBinSetting })          ✅ single resolution entry
       ├ DSH_NODE_BIN non-empty        → {source:'dsh-node-bin',     electronRunAsNode:false}
       ├ nodeBinSetting non-empty(trim)→ {source:'vscode-setting',   electronRunAsNode:false}
       └ otherwise                     → {source:'process-exec-path',electronRunAsNode:process.versions.electron!==undefined}
  → session-host.ts:290  assertNodeExecutable(SAME object)                         ✅ probed object == spawned object
  → session-host.ts:300  new HarnessClient({ nodeExecutable })                     ✅ object carried, not re-derived
  → client.ts:204        resolveDshLaunch(options)                                 ✅
  → launch.ts:177        options.nodeExecutable ?? resolveNodeExecutableSpec()     ✅ no second resolution
  → launch.ts:180-182    ELECTRON_RUN_AS_NODE only when electronRunAsNode          ✅ flag cannot leak to tiers 1/2
  → launch.ts:184-192    command = executed path, env built once                   ✅
Exit: spawned `dsh --profile ide` under the validated executable
```

**Judgement: connected.** The round-1 risk that a second, independent emptiness check would classify a caller-named executable as Electron is closed: `launch.ts` contains exactly two non-empty checks, both inside the single `resolveNodeExecutableSpec` (`:133` for `DSH_NODE_BIN`, `:137` for the setting — `:64` is the unrelated dsh-bin check), and `electronRunAsNode` is computed in exactly one place (`:143`). The only two production call sites of the resolver are `launch.ts:177` and `session-host.ts:287`, and the VS Code path always supplies the object, so resolution happens exactly once.

Measured on the real modules through my probe:

```
A.tier2.spec          => {"path":"/setting/node","source":"vscode-setting","electronRunAsNode":false}
A.tier2.command       => "/setting/node"
A.tier2.flagKey       => "ABSENT"
B.tier1.spec          => {"path":"/env/node","source":"dsh-node-bin","electronRunAsNode":false}
B.tier1.command       => "/env/node"
B.tier1.flagKey       => "ABSENT"
C.tier3.spec          => {"path":"/usr/local/n/versions/node/24.3.0/bin/node","source":"process-exec-path","electronRunAsNode":true}
C.tier3.isExecPath    => true
C.tier3.flag          => "1"
D.retainedObject.command => "/frozen/node"
D.noObjectFallback.command => "/usr/local/n/versions/node/24.3.0/bin/node"
E.settingSource.command => "/setting/node"
E.settingSource.isPathShim => false
E.tier3.commandIsExecPath => true
E.tier3.isPathShim => false
```

`D` shows the identity invariant (a retained object wins even after `DSH_NODE_BIN` changes; only an absent object falls back), `E` shows a `node` shim prepended to `PATH` is never selected for either the setting source or tier 3 — i.e. **no `PATH` fallback was reintroduced by the rework**.

### Path 2 — Node-environment failure reaches the VS Code surface (AC-7 / AC-8 / AC-9, M2)

```
Entry: candidate fails the pre-flight
  → node-env-guard.ts:230-244  inspectExecutableFile → 'missing' | 'not-executable'
  → node-env-guard.ts:254-273  probeNodeApis → 'unusable' | report
  → node-env-guard.ts:138-145  missing REQUIRED_NODE_APIS → 'missing-apis'
  → node-env-guard.ts:167-176  formatNodeEnvironmentDiagnostics → five lines
  → NodeEnvironmentError(message, failure)                                        ✅ structured payload kept
  → session-host.ts:319        errorMessage = redactSecrets(...)                  ✅ redaction applied once, before projection
  → session-host.ts:321-325    throw HostStartError('node-environment', message, {cause, diagnostic})
  → extension.ts:2215-2279     port.start() rethrows unchanged                    ✅ no wrapping that would drop `kind`
  → auto-start-orchestrator.ts:207 await port.start() → :217 catch
  → auto-start-orchestrator.ts:220 this.errorKind = startErrorKindOf(error)       ✅ reads `kind`, vocabulary-checked
  → auto-start-orchestrator.ts:123 snapshot {state:'failed', errorKind, errorMessage}
  → extension.ts:402-405       orchestrator.onChange → connectionUi.projectOrchestrator(snap)
  → connection-ui.ts:140       settingsDeepLinkAvailable = errorKind === 'missing-credentials'  → false
  → connection-ui.ts:147-154   message = snap.errorMessage                        ✅ the five-line diagnostic text
  → connection-ui.ts:173-186   panel.applyConnectionState + status bar text       ✅ visible surface
Exit: user sees an environment-scoped message naming the path, the expectation and the fix
```

**Judgement: connected, and the class is consumed rather than written-and-ignored.** `errorKind` is read by the UI projection (deep-link decision) and `errorMessage` is rendered; the runtime case `node-env-guard.spec.ts:648-671` exercises exactly this chain through a real `activate()` and asserts `state === 'failed'`, `errorKind === 'node-environment'` (`:666`), the message containing the offending path and `dsh.nodeBin` (`:667-668`), and the `settings.json` being byte-identical afterwards (`:670`).

The `dsh.test.requestStart` route used by that case is the production object, not a test double of the orchestrator: `extension.ts:1142-1143` returns `orchestrator?.getSnapshot()` from the same singleton whose `onChange` feeds `connectionUi`. So the assertion is on the real projection, one hop before the UI card.

### Path 3 — probe runs in the mode the spawn will use (S9 / AD-1)

```
node-env-guard.ts:131  probeNodeApis(executable)     ← the resolved object
  → :257-258  env = {...process.env}; if (executable.electronRunAsNode) env.ELECTRON_RUN_AS_NODE = '1'
  → :260-264  execFileAsync(executable.path, ['-e', PROBE_SOURCE], { env })
launch.ts:180-182       spawn env gets ELECTRON_RUN_AS_NODE only when the same flag is true
```

**Judgement: connected.** Probe F (`F.electronMode.ok => true`, `F.electronMode.flagSeenByProbe => "\"1\""`, `F.plainMode.flagSeenByProbe => "\"\""`) shows the flag reaches the candidate exactly when the spawner would set it, and never otherwise.

### Path 4 — Phase 2 handoff surfaces (S10, cross-phase connectivity)

```
(I) IdeSessionHost.onError(listener) → disposer     session-host.ts:195-200   already wired at extension.ts:2237-2240
(II) orchestrator.getSnapshot() / onChange(handler)  auto-start-orchestrator.ts:123-124  consumed at extension.ts:402-405, 1108-1113
(III) HostStartError{kind, diagnostic}               session-host.ts:57-77     carried from error.failure at :324
```

**Judgement: connected for the handoff, with one deliberate reservation.** (I) and (II) have live Phase-1 consumers. (III) has **no Phase-1 reader of `.diagnostic`** — `grep -rn "\.diagnostic\b" apps/vscode-dsh/src` returns only its declaration and its assignment. That is the surface `spec.md:133` reserves for Phase 2, and §5.12 now records it explicitly (including that a Phase 2 recorder reads `error.diagnostic` rather than re-parsing the rendered text), so this is a documented reservation rather than an unowned dead-end. See 🟢 O-2.

---

## 3. Upstream / downstream connection check

| New or changed unit | Upstream (who calls it) | Connected | Downstream (what it calls) | Connected |
|---|---|:--:|---|:--:|
| `resolveNodeExecutableSpec()` (`launch.ts:131`) | `session-host.ts:287`, `launch.ts:177`, 10 cases in `launch.spec.ts` | ✅ | `process.env.DSH_NODE_BIN`, caller-supplied setting, `process.execPath`/`process.versions.electron` | ✅ |
| `resolveDshLaunch()` (`launch.ts:164`) | `client.ts:204` | ✅ | `resolveNodeExecutableSpec()` fallback, env/argv assembly | ✅ |
| `assertNodeExecutable()` (`node-env-guard.ts:155`) | `session-host.ts:290` | ✅ | `validateNodeEnvironment()` → `probeNodeApis()` → real subprocess | ✅ |
| `readNodeBinSetting()` (`extension.ts:2179`) | `extension.ts:2253` inside `createStartHostPort().start()` | ✅ | `vscode.workspace.getConfiguration('dsh').get('nodeBin')` | ✅ |
| `IdeSessionHost.start({nodeBinSetting, nodeExecutable})` (`session-host.ts:257`) | `extension.ts:2254`; `session-host-preflight.spec.ts` (no VS Code) | ✅ | pre-flight → `bridge.listen` → `HarnessClient(nodeExecutable)` | ✅ |
| `HostStartError{kind, diagnostic}` (`session-host.ts:57`) | thrown at `:322`, `:327`; asserted in 3 test files | ✅ | `AutoStartOrchestrator` catch `:217-221` → snapshot → ConnectionUi | ✅ |
| `startErrorKindOf()` (`auto-start-orchestrator.ts:47`) | `:220` (only writer of `errorKind`) | ✅ | `START_ERROR_KINDS` vocabulary | ✅ |
| `contributes.configuration["dsh.nodeBin"]` (`package.json`) | VS Code settings UI; asserted by `nodeBinProperty()` in the spec | ✅ | `NODE_BIN_SETTING` constant used by the runtime read and the diagnostics | ✅ |

**Orphan check (dead new exports, never called anywhere):** none that matter. `formatNodeEnvironmentDiagnostics` looks orphaned from outside but is the body of `NodeEnvironmentError`'s message (`:92`); `validateNodeEnvironment` is called by `assertNodeExecutable` and 11 test sites; `REQUIRED_NODE_APIS`, `EXPECTED_NODE_RANGE`, `DSH_NODE_BIN_VARIABLE`, `NODE_BIN_SETTING` are consumed by the guard, the extension, and the spec; `NodeEnvironmentReport` / `NodeEnvironmentValidation` are the declared return types of the validation seam and are re-exported through `apps/vscode-dsh/src/index.ts`. `HostStartError` / `HostStartErrorKind` are thrown, asserted, and re-exported.

---

## 4. Cross-module contract consistency

| Between | Caller expects | Callee provides | Consistent? |
|---|---|---|:--:|
| `auto-start-orchestrator` ← `session-host` | `kind` drawn from the orchestrator's own vocabulary | `HostStartErrorKind = StartErrorKind` (type alias, not a copy); generic catch throws `process-failed` | ✅ |
| `session-host` → `HarnessClient` | `nodeExecutable?: ResolvedNodeExecutable` | `HarnessClientOptions.nodeExecutable` (`types.ts:61`) forwarded to `resolveDshLaunch` | ✅ |
| `session-host` → `node-env-guard` | object to pre-flight is the object to spawn | `assertNodeExecutable(executable)` takes the same reference; probe uses `executable.electronRunAsNode` | ✅ |
| `node-env-guard` → `dsh-sdk-client` | `NodeExecutableSource` union from the SDK | `packages/sdk/client/src/types.ts:36,43,61` — the union used in diagnostics is the resolver's own union | ✅ |
| manifest key ↔ runtime read | `contributes.configuration.properties` key equals the key the extension reads | `NODE_BIN_SETTING = 'dsh.nodeBin'` and `properties[NODE_BIN_SETTING]` is asserted against the real `apps/vscode-dsh/package.json` (`node-env-guard.spec.ts:167-176`, throws if missing) | ✅ |
| manifest default ↔ resolver semantics | declared default `""` should mean "do not participate" | `readNodeBinSetting` returns `""` unchanged; `resolveNodeExecutableSpec` treats `''` as unset (`:137`) → tier 3 | ✅ |
| probe env ↔ spawn env | same invocation mode | both inject `ELECTRON_RUN_AS_NODE=1` only when `electronRunAsNode` | ✅ |
| docs ↔ resolution order | docs state `DSH_NODE_BIN` > `dsh.nodeBin` > Extension Host Node, never `PATH` | `launch.ts:122-127` doc and `:133-143` code; `docs/development.md:107` and `.zh.md:112` | ✅ |

There is **no repository gate** over `contributes.configuration` (the user flagged this), so the manifest↔code key coupling rests entirely on `nodeBinProperty()` reading the real manifest and looking the entry up by the same constant the runtime uses. That is the correct place for the assertion, and it exists.

---

## 5. Cross-phase dependency check

| This phase's dependency / obligation | Phase | Interface state | Connected |
|---|---|:--:|:--:|
| `errorKind === 'process-failed'` for unclassified failures (Phase 2 spec's boundary list) | Phase 2 | `process-failed` retained as the single documented fallback (`auto-start-orchestrator.ts:47-55`) | ✅ |
| Phase 2's record vocabulary keeps its own `'other'` class | Phase 2 | `'other'` removed from **this** app's `StartErrorKind` (§5.13) and, per my grep, referenced by no consumer here — the two vocabularies stay separate types in separate phases | ✅ |
| Phase 2's diagnostics sink attaches at a stated surface | Phase 2 | three surfaces named in §5.12; (I)/(II) live, (III) reserved with the reason (`HostStartError.diagnostic`) | ✅ |
| AC-10(f) — real Extension Development Host consuming a pre-placed `settings.json` | Phase 3 | Phase 1 claims (a)–(e) only and does not claim that branch; the Phase 3 precondition is real because tier 1 outranks the setting (probe B) and Phase 3's AD-11 requires clearing an inherited `DSH_NODE_BIN` | ✅ |
| SDK surface used by the second phase of resolution | `packages/sdk/client` | `resolveNodeExecutableSpec` / `ResolvedNodeExecutable` / `NodeExecutableSource` are additive; no published name was removed (`resolveNodeExecutable` was private at HEAD) | ✅ |

---

## 6. Findings

### 🟢 O-1 — the non-string `dsh.nodeBin` branch keeps the generic class (observation, route to Phase 2)

`extension.ts:2183-2187` throws a plain `Error` for a non-string setting. That throw happens at `:2253`, inside `createStartHostPort().start()`, so it is caught at `auto-start-orchestrator.ts:217` and classified `process-failed` by `:47-55` — while a *path* failure from the same source is classified `node-environment`. The test at `node-env-guard.spec.ts:673-686` asserts the message (containing `dsh.nodeBin` and `string`) but not `errorKind`.

Why this is **not** a connectivity verdict driver: the data path is intact — the message reaches the same visible surface through the same snapshot hop — and no AC enumerates a class for a type error; the record vocabulary that would need a configuration-error member belongs to Phase 2 (§5.12). Recommendation (one of): have `readNodeBinSetting` surface a `kind` so the class travels, or record the choice in §5 and let Phase 2 assign the member. Severity: should-fix at the policy level, no path broken.

### 🟢 O-2 — `HostStartError.diagnostic` is written and not read in Phase 1

Confirmed by `grep -rn "\.diagnostic\b" apps/vscode-dsh/src` (declaration + assignment only). This is the surface `spec.md:133` reserves for Phase 2 and §5.12 now names it with its file/line and the reason (a recorder reads `error.diagnostic` instead of re-parsing the message). Not an unowned dead-end: the reservation is written down, which is exactly what round 1's S-2 asked for.

### 🟢 O-3 — a direct SDK consumer cannot pass the setting name; it must pre-resolve

`HarnessClientOptions` exposes `nodeExecutable` but no `nodeBinSetting`, and `resolveDshLaunch` (`launch.ts:177`) calls `resolveNodeExecutableSpec()` with no request object. So tier 2 is only reachable through the two-step documented at `types.ts:26-28` and `README.md`: resolve, then pass the object. This keeps AD-1's "one resolution, validated object is spawned object" invariant, and there is no partial input that silently misresolves — a consumer either supplies the resolved object or gets tiers 1/3. Recorded so a future embedder is not surprised.

### 🟢 O-4 — three working-tree modifications belong to no phase and must stay out of the Phase commit

`pnpm-lock.yaml` and `apps/vscode-dsh/webview/dist/assets/index.{js,css}` are modified in the worktree but predate this phase: `stat -c '%y'` gives `pnpm-lock.yaml → 2026-09-14 16:08:25` and `webview/dist/assets/index.js → 2026-09-14 09:21:32`, against `node-env-guard.ts → 2026-09-15 18:27:43`. §2.3 and §6.6 already disclaim them and require exclusion. Since HG-3 commits must enumerate files rather than `git add -A`, this is the list to watch.

---

## 7. Evidence (commands actually executed by this reviewer)

| Command | Result |
|---|---|
| `git branch --show-current` | `impl-phase-1-node-env-preflight` |
| `pnpm --config.verify-deps-before-run=false run typecheck` | exit 0 (baseline green, still green) |
| `pnpm --config.verify-deps-before-run=false run test packages/sdk/client` | `Test Files 3 passed (3)`, `Tests 84 passed (84)`, exit 0 |
| `pnpm --config.verify-deps-before-run=false run test apps/vscode-dsh` | `Test Files 4 failed \| 46 passed (50)`, `Tests 6 failed \| 350 passed \| 1 skipped (357)`, exit 1. Failing files: `spike-t0a-replay-rebuild.spec.ts` (4 cases), `spike-t0b-continue-capability.spec.ts` (suite), `panel-close-delete.e2e.spec.ts` (1), `verifier-phase1/layer-a-rtl.spec.tsx` (1) → **identical set and count to the baseline**, root cause unchanged (`scripts/test-invariants.ts:88` / `:188`). No new failure. |
| `pnpm --config.verify-deps-before-run=false run test apps/vscode-dsh/tests/node-env-guard.spec.ts apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts apps/vscode-dsh/tests/session-host-preflight.spec.ts packages/sdk/client/tests/launch.spec.ts` | `Test Files 4 passed (4)`, `Tests 69 passed (69)`, exit 0 |
| `pnpm --config.verify-deps-before-run=false run test:docs` | `run-gates: 10 passed, 5 failed, 0 skipped` — same five gates as baseline; `grep -c "development\.md\|development\.zh\.md"` over the output = **0** |
| `pnpm --config.verify-deps-before-run=false run lint` | exit 1 (baseline red). Per-file: new files **0**; `extension.ts` 22; `session-host.ts` 1 (`:595`); `auto-start-orchestrator.ts` 1 (`:230`); `index.ts` 1 (`:97`) — every diagnostic outside the phase's added line ranges (§1, S3). |
| `./node_modules/.bin/tsx /tmp/dsh-conn-probe2/probe.mts` (independent harness outside the repo, user-approved) | probes A–G as quoted in §2; exit 0 |
| `grep -rn "DSH_NODE_BIN" --include=*.ts packages/sdk/client/src apps/vscode-dsh/src` | one reader (`launch.ts:132`) plus constants/diagnostic text → single resolution entry confirmed |
| `grep -rn "ELECTRON_RUN_AS_NODE" --include=*.ts …/src` | exactly two writers, both gated on `electronRunAsNode` (`launch.ts:181`, `node-env-guard.ts:258`) |
| `git diff -U0 -- apps/vscode-dsh/src/{session-host.ts,auto-start-orchestrator.ts,index.ts} \| grep -E "^@@"` | added ranges `session-host.ts` {14,16,27,29,42-79,106-109,253-254,285-290,300,321-327}, `auto-start-orchestrator.ts` {26-55,220}, `index.ts` {25-39} — used to place the lint findings off the added lines |

## 8. Summary for the orchestrator

* Required connectivity (setting → resolution → pre-flight → spawn; pre-flight failure → redacted message → typed class → snapshot → VS Code surface) is **connected end to end**, verified by code tracing, by the repository's own runtime cases, and by an independent out-of-repo probe that reproduced the tier order, the absence of any `PATH` fallback, the probe/spawn mode agreement, and the survival of `node-environment` across the orchestrator hop.
* Differential acceptance holds: `typecheck` green, `packages/sdk/client` green (84 cases), app-suite red set identical to baseline (4 files / 6 cases), `test:docs` identical tally, lint red with zero diagnostics on lines this phase added.
* Round-2 verdict on all 13 round-1 findings: **all fixed**; the implementer's three declared deviations **stand**.
* One observation worth routing (`🟢 O-1`, non-string setting keeps the generic class) and three hygiene observations (`🟢 O-2` reserved Phase 2 surface, `O-3` SDK two-step, `O-4` exclude non-phase artifacts from the commit).
