# Repository Exploration Report — Phase 1 `phase-1-node-env-preflight`

Workflow: `vscode-dsh-usable-loop` · Phase: `phase-1-node-env-preflight` · Branch: `impl-phase-1-node-env-preflight` (HEAD `d92b0e55e1`, identical to the `new/vscode-dsh` merge base — no Phase 1 commit exists yet)
Explorer: `code-explorer` (read-only). Every claim below carries a `file:line` or a command transcript; unverifiable claims are marked in §7/§8.

---

## 1. Task Context

Phase 1 must make "this Node cannot run the harness" fail loudly **before any subprocess is spawned**, with a five-element actionable diagnostic, and must introduce the extension's **first** settings entry `dsh.nodeBin` as tier 2 of a three-tier Node resolution chain (`DSH_NODE_BIN` > VS Code setting > Extension Host's own Node). The setting source and the two pre-existing sources must share one validation gate and one resolved result, and the `DSH_NODE_BIN` / `process.execPath` paths must not regress. The codebase currently has **no** Node pre-flight check of any kind: `IdeSessionHost.start()` goes `bridge.listen` → `HarnessClient.start()` (spawn) with no gate in between, and the Extension never reads `workspace.getConfiguration`. One relevant commit (`f9af9f2fa5`) already landed the tier-3 semantics inside `packages/sdk/client`, which changes what Phase 1 must add versus what already exists (see §7 "Prompt premise corrections").

---

## 2. Repository Overview

- **Language / module system**: TypeScript everywhere, ESM-only (`"type": "module"`), local relative imports carry the `.ts` extension (e.g. `apps/vscode-dsh/src/session-host.ts:25` `import { buildIdeChildEnv } from './env.ts'`).
- **Package manager / Node floor**: pnpm workspaces, `packageManager: "pnpm@11.7.0"` (`package.json:7`), `engines.node: "^22.19.0 || >=24.0.0"` (`package.json:8-10`). No `.nvmrc` exists at the repo root (verified `ls -a | grep -i nvm` → empty).
- **Two relevant workspaces**:
  - `packages/sdk/client` — `@deepseek-ai/dsh-sdk-client`, the package that resolves the dsh launch spec and spawns the runtime subprocess (`packages/sdk/client/package.json:2`, `:16-22` exports map has only `.`).
  - `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh`, the VS Code extension host (`private: true`, `apps/vscode-dsh/package.json:1-14`); it depends on the SDK client (`apps/vscode-dsh/package.json:208` `"@deepseek-ai/dsh-sdk-client": "workspace:^"`), so app-level tests may import SDK symbols directly.
- **Test runner**: Vitest with two projects, `thread-safe` and `process-bound`, both `pool: 'forks'` (`vitest.config.ts:155-190`); test discovery includes apps: `'apps/*/tests/**/*.spec.{ts,tsx}'` (`vitest.config.ts:115`).
- **Coverage gate**: `coverage.include: ['packages/*/*/src/**/*.{ts,tsx}']` with `perFile: true` and 100/100/100/100 thresholds (`vitest.config.ts:198`, `:348-356`). **`apps/vscode-dsh/src` is not coverage-gated**; the SDK package's `src` is.

---

## 3. Most Relevant Areas

| Path | Role | Touched by Phase 1? |
|---|---|---|
| `packages/sdk/client/src/launch.ts` | `resolveNodeExecutable` (`:126-131`), `resolveDshLaunch` (`:150-186`), Electron env branch (`:163-168`) | ✅ modify |
| `packages/sdk/client/src/index.ts` | Public re-exports; currently exports **no** `launch.ts` symbol (`:1-22`) | ✅ additive re-export |
| `packages/sdk/client/src/types.ts` | `HarnessClientOptions` (`:24-53`) — no Node-executable field today | ✅ likely additive option |
| `packages/sdk/client/src/client.ts` | `spawn` site `:214-218`; `resolveDshLaunch` call `:204`; injectable `runtime` ctor param `:202` | ⚠️ read-only unless typing changes |
| `packages/sdk/client/tests/{launch.spec.ts,fake-runtime.ts,dispose.spec.ts,sdk-client.spec.ts}` | Existing tests for the resolution/launch surface | ✅ extend |
| `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | Public contract ("launch spec is explicit — callers may name the runtime executable via `dshBin`", `README.md:16`); **zero** mention of a Node executable / `DSH_NODE_BIN` / `execPath` | ✅ update (pair + re-record) |
| `apps/vscode-dsh/src/session-host.ts` | `IdeSessionHostStartOptions` (`:39-64`), `start()` ordering `:210-269` | ✅ modify |
| `apps/vscode-dsh/src/env.ts` | `buildIdeChildEnv` (`:30-40`) | ⚠️ read-only candidate |
| `apps/vscode-dsh/src/extension.ts` | 2401 lines; `activate` `:336`; `createStartHostPort` `:2174-2246`; `start()` call site `:2219-2222`; `VsCodeLike` `:108-266` | ✅ modify |
| `apps/vscode-dsh/src/index.ts` | Library re-export surface (`:1-161`) | ✅ additive export |
| `apps/vscode-dsh/src/node-env-guard.ts` | **Does not exist** (expected new file) | ✅ new |
| `apps/vscode-dsh/package.json` | `contributes` (`:56-203`) has **no** `configuration` key; `files` (`:24-29`); no `scripts.test` | ✅ add `configuration` |
| `apps/vscode-dsh/tests/*.spec.ts` | 48 spec files; duck-typed `vscode` built inline per file; fixture runtime at `tests/fixtures/fake-sdk-runtime.mjs` | ✅ add spec |
| `docs/development.md` / `.zh.md` / `.i18n.yaml` | Contributor doc; Node prerequisite already at `development.md:11`; sections listed in §3.1 | ✅ update (pair + re-record) |
| `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md` | Only `DEBT-004` active | read-only |

### 3.1 `docs/development.md` current structure (insertion points for AC-2 / AC-3)

| Line | Heading |
|---|---|
| `:7` | `## Setup tutorial` |
| `:9` | `### Prerequisites` — **already contains** "Node.js supports 22.19+ and 24+. CI covers 22.19, 24, and 26; see the [Node engine floor Agent Note](…)" (`:11`) |
| `:16` | `### First-time setup` |
| `:42` | `## Contributor reference` |
| `:44` | `### TypeScript project layout` |
| `:92` | `### Environment variables` |
| `:103` | `### Git integrations` |
| `:121` | `### CI gates` |
| `:125` | `### Daily commands` |
| `:129` | `### Profile runs` |
| `:149` | `### TODO markers` |
| `:159` | `### Documenting types verbatim (ts type-equiv)` |

`docs/development.zh.md` mirrors the same heading sequence (`:9 搭建教程`, `:11 前置条件`, `:44 贡献者参考`, `:96 环境变量`, …), so a new section must be added to both sides and the pair re-recorded.

---

## 4. Key Entry Points / Call Paths

### Chain A — Extension start → Node resolution → subprocess spawn (today)

```
VS Code activate
└─ apps/vscode-dsh/src/extension.ts:336  activate(context, vscodeArg?)
   ├─ :384  const startPort = createStartHostPort(vscode)
   └─ :385  orchestrator = new AutoStartOrchestrator(startPort)
        └─ visibility / reason → handleConversationVisibility (:2252) → orchestrator.request(reason)
             └─ extension.ts:2174  createStartHostPort(vscode).start(_reason)   [body :2174-2244]
                ├─ :2196  const cwd = resolveStartCwd(vscode)                 [def :2133-2144]
                ├─ :2198  const next = new IdeSessionHost()
                ├─ :2218  const credentials = collectCredentialsEnv()
                └─ :2219-2222  await next.start({ cwd, credentials? })   ← AC-10(a) wants `dsh.nodeBin` read here
                     └─ apps/vscode-dsh/src/session-host.ts:210  IdeSessionHost.start(options)  [body :210-269]
                        ├─ :222-224  bridgePath = options.bridgeSockPath ?? tmpdir()/dsh-ide-bridge-<uuid>.sock ; this.bridgePath = bridgePath
                        ├─ :225-236  const bridge = new IdeBridgeHostServer(); onFrame/onDisconnect
                        ├─ :238  await bridge.listen(bridgePath)          ← socket file exists after this line
                        ├─ :239-243  const env = buildIdeChildEnv({bridgeSock, dshHome?, credentials?})   [env.ts:30-40]
                        ├─ :244-252  new HarnessClient({ profile:'ide', env, dshHome?, dshBin?, initializeTimeoutMs? })
                        │     └─ packages/sdk/client/src/client.ts:202-204  this.runtime = runtime ?? resolveDshLaunch(options)
                        │           └─ packages/sdk/client/src/launch.ts:150-186  resolveDshLaunch
                        │                ├─ :154  profile = options.profile ?? 'sdk'
                        │                ├─ :155-157  dshBin given → nodeArgs=[resolve(cwd,dshBin)] ; else installedDshNodeLaunch()
                        │                ├─ :165-168  dshNodeBinSet = process.env.DSH_NODE_BIN非空 ; electronNodeEnv = {ELECTRON_RUN_AS_NODE:'1'} when process.versions.electron && !dshNodeBinSet
                        │                └─ :170  command = resolveNodeExecutable()      [def :126-131]
                        ├─ :254  client.start()   ← SPAWN     (client.ts:211-218 → child_process.spawn)
                        └─ :256-260  await client.initialize({cwd, provider, model}) → :261 status='connected'
```

### Chain B — Node gate failure → diagnostic exit (**target** state of AC-7; absent today)

```
IdeSessionHost.start(options)                     apps/vscode-dsh/src/session-host.ts:210
 │
 ├─ [MISSING TODAY] node pre-flight gate
 │    required order:  gate  →  :238 bridge.listen  →  :254 spawn
 │    actual order:            :238 bridge.listen  →  :254 spawn   (no gate)
 │
 └─ today's only failure path when the resolved Node is unusable:
      client.start() :254 → spawn (client.ts:214)
        → child 'error' (client.ts:220-226): spawnError recorded, transport closed, subscriptions failed
        → initialize rejects (:256)
        → catch :262-268: status='error'; errorMessage = redactSecrets(message, credentials) (:265);
                          await shutdownInternal('start failed') (:266); throw new Error(errorMessage) (:267)
        → createStartHostPort catch :2233-2243: unwinds watchers, host=undefined, rethrows
        → AutoStartOrchestrator / ConnectionUi surface the message
      Consequence: the bridge socket has ALREADY been created (:238), the error text is a raw
      OS/spawn message, and there is no five-element diagnostic.
```

### Chain C — Settings entry (tier 2), **absent today**

```
apps/vscode-dsh/src/**  grep "getConfiguration"  → 0 matches
apps/vscode-dsh/tests/** grep "getConfiguration" → 0 matches
apps/vscode-dsh/package.json:56-203  contributes = { commands, menus, viewsContainers, views, keybindings }
                                     → no `configuration` key ⇒ `dsh.nodeBin` does not exist yet
```

---

## 5. Likely Impact Surface

| # | File | Change kind | Downstream dependents | Risk |
|---|---|---|---|---|
| 1 | `packages/sdk/client/src/launch.ts` | modify (`resolveNodeExecutable` / new spec resolver / Electron branch) | `client.ts:204` is the only in-repo caller; tests `tests/launch.spec.ts` import it directly | **HIGH** — public-ish behavior; `DSH_NODE_BIN` + `process.execPath` regressions land here. Note the duplicated `DSH_NODE_BIN` presence test at `:127` and `:165` must stay consistent |
| 2 | `packages/sdk/client/src/index.ts` | additive export | `apps/vscode-dsh` imports `HarnessClient`/`TransportClosedError` from the package root (`session-host.ts:11-16`) | LOW |
| 3 | `packages/sdk/client/src/types.ts` | additive option field (if the resolved Node must travel as an explicit input) | `client.ts`, `apps/vscode-dsh/src/session-host.ts:244-252` | MEDIUM — a new field is part of the public option type |
| 4 | `packages/sdk/client/README.md` + `README.zh.md` + `README.i18n.yaml` | doc pair | `verify-package-readme-limitations`, `verify-translation-pairing` | MEDIUM — forgetting the `--write` re-record turns CI red (`docs/i18n/README.md:38`) |
| 5 | `apps/vscode-dsh/src/node-env-guard.ts` | new file | new; imported by `session-host.ts` and/or `extension.ts`; re-exported by `src/index.ts` | MEDIUM — gate semantics and diagnostic wording are the Phase deliverable |
| 6 | `apps/vscode-dsh/src/session-host.ts` | modify (`start()` ordering + new option) | `extension.ts:2198/2219`; ≥10 spec files construct `new IdeSessionHost()` | **HIGH** — reordering listen/spawn changes socket side effects that existing tests assert |
| 7 | `apps/vscode-dsh/src/extension.ts` | modify (read `dsh.nodeBin`, pass explicitly) | `src/index.ts:129-139` re-exports `activate`; 3+ spec files inject `makeVscode` | MEDIUM — 2401-line file; `VsCodeLike` (`:108-266`) gains `workspace.getConfiguration`, which every duck-typed mock must then satisfy (optional-member tolerance required) |
| 8 | `apps/vscode-dsh/package.json` | add `contributes.configuration` | VS Code load path only | LOW-MEDIUM — no repo gate validates it (see §6), so a malformed schema is only caught at runtime |
| 9 | `apps/vscode-dsh/tests/*` (new spec + possibly 3 `makeVscode` helpers) | add | — | MEDIUM — baseline has 4 already-failing files (§6), so the new spec must be provably clean in isolation |
| 10 | `docs/development.md` + `.zh.md` + `.i18n.yaml` | doc pair | `doc-quick` aggregate | MEDIUM — `verify-md-wrap` / `verify-md-links` are currently red at baseline |
| 11 | `.nvmrc` (new) | new file | unknown consumers | LOW — none found; no gate reads it |

---

## 6. Existing Constraints / Conventions

**Code conventions (verified in-file)**
- ESM + `.ts` local relative imports (`session-host.ts:25`). All exported functions/methods carry JSDoc; function-like exports document `@param`/`@returns` and describe return contracts (e.g. `launch.ts:119-125`, `session-host.ts:206-209`).
- The gate `verify-export-jsdoc` globs **only** `packages/*/*/src/**/*.ts` (`scripts/verify-export-jsdoc.ts:569`) — `apps/vscode-dsh/src` is **not** scanned. The app nevertheless follows the same JSDoc style; keep it.
- `verify-client-ui-i18n` scans only `apps/web/src/**/*.{ts,tsx}` (`scripts/verify-client-ui-i18n.ts:313`) — hardcoded English copy in `apps/vscode-dsh` is **not** gated.
- No gate in `scripts/` reads VS Code `contributes` (grep over `scripts/*.ts` for `contributes` returns only unrelated prose) — `verify-package-invariants` is about "package-owned invariant source and publication rules" (`scripts/verify-package-invariants.ts:1`). So `contributes.configuration` correctness is runtime-only territory.

**Test conventions (verified in `apps/vscode-dsh/tests/`)**
- Vitest, `describe/it/expect`, no `vi.mock` in the session-host suite; the runtime is exercised by spawning the real fixture `tests/fixtures/fake-sdk-runtime.mjs` via the `dshBin` option (`tests/session-host.spec.ts:13`, `:111`).
- Temp dirs via `mkdtemp` + `afterEach` `rm(..., {recursive:true, force:true})` (`tests/session-host.spec.ts:71-77`); `bridgeSockPath` is passed explicitly per test (`:86`).
- The duck-typed `vscode` object is defined **inline per spec file** — `function makeVscode` exists only in `tests/phase1-auto-start.spec.ts`, `tests/phase2-auto-ready.spec.ts`, `tests/phase4-new-conversation-chrome.spec.ts`. There is **no shared fake-vscode helper module**; a new `workspace.getConfiguration` member must be added to whichever mock the new spec uses.
- No existing test mocks `node:child_process` anywhere under `apps/vscode-dsh/tests` (grep: 0 matches), so "spawn count 0" is not an established pattern here.
- Fixture `tests/fixtures/fake-sdk-runtime.mjs` is a scripted JSON-RPC runtime with env knobs (`FAKE_PROMPT_LOG`, `FAKE_FAIL_INIT_WITH_API_KEY`, `FAKE_EXIT_AFTER_MS`, …) documented at `:1-27`; it is a real subprocess, so "did not spawn" cannot be observed by it and must be observed another way (⚠️ see §8).

**Commands — Node toolchain (hard environment facts, all re-verified this session)**
```sh
node -v                     # v20.16.0  (nvm default; BELOW the repo floor)
git --version               # git version 2.25.1  (< 2.26 required by install-lefthook)
ls /usr/local/n/versions/node/     # 22.9.0  24.3.0
ls ~/.nvm/versions/node/           # v20.16.0  v22.14.0
pnpm -v                     # under v20.16.0 → crashes (node:sqlite UNKNOWN BUILTIN MODULE)
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm -v   # 11.7.0  ✅
```
- **24.3.0 is the only locally installed Node that satisfies `engines.node`** (22.9.0 < 22.19.0; 22.14.0 < 22.19.0).
- Required prefix for every pnpm invocation in this worktree:
  `PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run <script>`
  (`--config.verify-deps-before-run=false` is needed because pnpm's implicit dependency check would run `pnpm install`, which fails here on the git 2.25.1 / lefthook check.)

**Commands — tests**
```sh
# ✅ VERIFIED this session — the `--` form RUNS THE ENTIRE SUITE (1106 files / 15940 tests), it does NOT filter:
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test -- apps/vscode-dsh packages/sdk/client
#    → "Test Files 465 failed | 631 passed | 10 skipped (1106)"   (terminals/875531.txt)
#    → "Test Files 466 failed | 630 passed | 10 skipped (1106)"   (terminals/23785.txt)

# ✅ Filtering works WITHOUT the `--` separator (verified earlier in this session):
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test packages/sdk/client
#    → Test Files 3 passed (3) / Tests 73 passed (73)
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test apps/vscode-dsh
#    → Test Files 4 failed | 44 passed (48) / Tests 6 failed | 313 passed | 1 skipped (320)   ← PRE-EXISTING baseline red
```
**The regression command written in `spec.md` (`pnpm run test -- apps/vscode-dsh packages/sdk/client`) does not do what the phase assumes.** See §7 premise correction #2.

**Commands — coverage (per-file 100% for `packages/*/*/src`)**
```sh
# ❌ VERIFIED BROKEN for scoping: a filename filter makes EVERY untouched file report 0% and fail the global thresholds
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run --coverage packages/sdk/client
#    → "ERROR: Coverage for statements (0%) does not meet global threshold (100%) for packages/experimental/inspector/..." (terminals/359852.txt)
# ✅ Only supported shapes: the full gate, or the partition runner (CI uses DSH_COVERAGE_PARTITIONS=4, .github/workflows/ci.yml:106)
DSH_COVERAGE_PARTITIONS=4 PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test:coverage:partitioned
```
There is no per-package coverage partition (`scripts/coverage-partitions.ts` splits *test files* by weight, and the merged run enforces the whole include glob).

**Commands — documentation gates**
```sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm --config.verify-deps-before-run=false run test:docs
# = `tsx scripts/run-gates.ts doc-quick`  (package.json test:docs)
# ❌ BASELINE RED: "run-gates: 10 passed, 5 failed, 0 skipped in 31.25s" (terminals/710480.txt)
#    failures: verify-md-links, verify-translation-pairing, verify-md-wrap, verify-agent-note-format, doc-standard.spec.ts
# ⚠️ `./node_modules/.bin/tsx scripts/run-gates.ts doc-quick` FAILS outright:
#    "Error: pnpm invocation: npm_execpath is unavailable; invoke the script through pnpm run."
#    (scripts/pnpm-invocation.ts:15) — the aggregate must be entered through pnpm.
```
Known baseline causes worth naming so Phase 1 is not blamed for them:
- `verify-md-wrap` aborts with `ENOTDIR` on the symlink `snapshots/acp/image-compaction/system-prompt.expected.md → ../../session/read-image/system-prompt.expected.md` (`scripts/repo-files.ts:44` via `globSync`).
- `verify-agent-note-format` flags `.agents/notes/implemented/architecture/2026-09-04-ide-profile-dual-channel.md` (missing `# Agent Note:` header / `Status: implemented` / `## Problem`).
- `verify-translation-pairing` lists ~30 files, including `apps/vscode-dsh/README.md` (no `.zh.md` counterpart), the Chinese-only `docs/wiki/**` pages, and out-of-sync `packages/README.md` / `packages/sdk/server/README.md` pairs.
- `verify-md-links` flags `packages/bundle/ide/README.zh.md:18 #known-limitations-and-deferred-work`.

**Translation-pair contract (for any doc edit in this phase)**
- A pair is three sibling files: `foo.md`, `foo.zh.md`, `foo.i18n.yaml` holding both blob hashes (`docs/i18n/README.md:10-18`). Editing one side turns the gate red until the counterpart is updated **and** the pair is re-recorded: `pnpm run verify-translation-pairing --write <pair>` (`docs/i18n/README.md:38`; flag implemented at `scripts/verify-translation-pairing.ts:147-174`).
- `docs/development.md` / `.zh.md` / `.i18n.yaml` all exist, as do `packages/sdk/client/README{,.zh}.md,.i18n.yaml`.
- Markdown paragraphs must be one physical line (`verify-md-wrap`, `docs/AGENTS.md`).

---

## 7. Risks / Unknowns

| # | Statement | Confidence |
|---|---|---|
| R-1 | `resolveNodeExecutable()` today = `DSH_NODE_BIN` (non-empty) else `process.execPath`; the old `process.versions.electron → 'node'` PATH fallback was **removed** by `f9af9f2fa5`. The only Electron-specific branch left is `ELECTRON_RUN_AS_NODE: '1'` injection in `resolveDshLaunch` | ✅ CONFIRMED (`packages/sdk/client/src/launch.ts:126-131`, `:163-168`; `git show f9af9f2fa5`) |
| R-2 | `f9af9f2fa5` is an ancestor of HEAD and is on `impl-phase-1-node-env-preflight` / `new/vscode-dsh` but **not** master | ✅ CONFIRMED (`git merge-base --is-ancestor f9af9f2fa5 HEAD` → yes; `git branch --contains` → the two impl branches) |
| R-3 | The `DSH_NODE_BIN` presence test is **duplicated** (`:127` in `resolveNodeExecutable`, `:165` in `resolveDshLaunch`). If a tier-2 setting is added without unifying this, a setting-provided Node would be treated as "electron path in use" and `ELECTRON_RUN_AS_NODE` would be injected for a real Node binary | ✅ CONFIRMED (both lines read); the consequence for the new tier is ⚠️ HYPOTHESIS |
| R-4 | `IdeSessionHost.start()` currently does `bridge.listen` (`:238`) **before** anything that touches Node, and spawns at `:254`; no pre-flight check exists | ✅ CONFIRMED (`session-host.ts:210-269`) |
| R-5 | `IdeSessionHostStartOptions` (`:39-64`) has no Node-executable field; `HarnessClientOptions` (`types.ts:24-53`) has none either. The only existing channel for a Node choice is the parent-process env var `DSH_NODE_BIN` read inside `launch.ts` | ✅ CONFIRMED |
| R-6 | `buildIdeChildEnv` scrubs every `DSH_*` name (`env.ts:30-40` → `scrubbedParentEnv`, `packages/subprocess/subprocess/src/index.ts:64-78`, prefix from `DSH_ENV_PREFIX` at `:17`), so `DSH_NODE_BIN` never leaks into the child env; the parent Extension Host's `process.env.DSH_NODE_BIN` still wins for tier 1 | ✅ CONFIRMED |
| R-7 | Baseline local Node is **v20.16.0** (below floor) and pnpm 11.7.0 cannot run under it; only `/usr/local/n/versions/node/24.3.0/bin` qualifies | ✅ CONFIRMED (commands in §6) |
| R-8 | The `--` argument form of `pnpm run test` does not filter; the full suite is massively red at baseline (466 failed files, `test-invariants` `requireActive` unhandled rejections: "settled without becoming active", `scripts/test-invariants.ts:186-191`) | ✅ CONFIRMED (two transcripts). Root cause of the mass failures is ❓ UNKNOWN — it is not Phase 1 code and not investigated further here |
| R-9 | `apps/vscode-dsh` filtered baseline is itself red: 4 failed files / 6 failed tests (e.g. `spike-t0a-replay-rebuild.spec.ts`, `panel-close-delete.e2e.spec.ts`, `verifier-phase1/layer-a-rtl.spec.tsx`) | ✅ CONFIRMED earlier this session via `pnpm … run test apps/vscode-dsh`; re-verification was blocked by auto-review, so treat the exact counts as baseline-but-recheck |
| R-10 | `pnpm run test:docs` is red at baseline for 5 unrelated reasons (§6). Phase 1 must diff against that baseline, not require a green aggregate | ✅ CONFIRMED (terminals/710480.txt) |
| R-11 | `contributes.configuration` is absent; no repo gate validates `contributes` | ✅ CONFIRMED (package.json:56-203; grep over `scripts/*.ts`) |
| R-12 | `docs/development.md:11` already states the Node prerequisite ("Node.js supports 22.19+ and 24+"). Phase 1 extends an existing bullet, it is not writing into a blank section | ✅ CONFIRMED |
| R-13 | Deprecated/authority-misleading artifacts exist and must not be treated as current: `.explore/06-external-interfaces-and-boundaries.md:56` still documents the pre-`f9af9f2fa5` Electron behavior ("Electron 的 `process.execPath` 不可用，优先 `DSH_NODE_BIN` 或 PATH 上的 `node`"), and `packages/sdk/client/src/launch.d.ts` + `packages/sdk/client/lib/**` + `packages/subprocess/subprocess/src/index.js` are untracked build residue (`git ls-files packages/sdk/client/src/` lists only the 6 real `.ts` sources) | ✅ CONFIRMED |
| R-14 | Reading paths outside the workspace (e.g. an absolute `node` binary under `/usr/local/n/...`) may be refused in the sandboxed tool path; the shell commands in this report ran through the allowlisted (unsandboxed) path | ⚠️ HYPOTHESIS (observed earlier this session, not re-verified) |
| R-15 | Where the new gate should live (SDK package vs app) is a design decision; the repo has no precedent for an app-side Node probe, and the SDK package is the only coverage-gated side | ❓ UNKNOWN (design target, not explorer's call) |
| R-16 | Making `HarnessClient.start()`'s `spawn` observable (for a "spawn count 0" assertion) has no precedent in this test suite; options are spying on `HarnessClient.prototype.start` / `vi.mock('node:child_process')` / asserting an absent side-effect marker | ⚠️ HYPOTHESIS |
| R-17 | `apps/vscode-dsh` is not coverage-gated, so the new app-side code needs no 100% coverage by the repo gate; the SDK-side change **is** gated per file | ✅ CONFIRMED (`vitest.config.ts:198`) |

### Prompt premise corrections (explicit)

1. **"`resolveNodeExecutable` may return `'node'` via PATH / Electron branch"** — outdated. Since `f9af9f2fa5` (`launch.ts` HEAD) there is no `'node'` fallback; tier 3 is already `process.execPath`. Phase 1's tier-3 work is therefore *preservation + validation*, not implementation. Do **not** re-introduce a PATH fallback.
2. **`pnpm run test -- apps/vscode-dsh packages/sdk/client`** (the command quoted in the Phase 1 spec) does **not** scope the run; it executes all 1106 test files, of which ~466 fail at baseline. Use the no-`--` form (`pnpm run test apps/vscode-dsh packages/sdk/client`) and diff against the known baseline.
3. **Per-file coverage cannot be checked by filtering** (`vitest run --coverage <path>` fails on unrelated files at 0%). Only `pnpm run test:coverage` / `test:coverage:partitioned` are supported.
4. `pnpm`/`node` must be prefixed with the Node 24.3.0 bin directory **and** `--config.verify-deps-before-run=false`; plain `pnpm run test` in this worktree crashes or tries a failing `pnpm install`.
5. `docs/development.md` is not a blank slate for Node prerequisites (`:11`).
6. `verify-export-jsdoc` does not cover `apps/` (only `packages/*/*/src`), and no gate inspects `contributes`.

---

## 8. Uncertain / Unverified

- **`IdeBridgeHostServer.listen()` filesystem semantics** (`packages/ide-bridge`, called at `session-host.ts:238`): it is assumed to be the operation that creates the bridge socket file, which is what makes AC-7(ii) (`existsSync(bridgeSockPath) === false` after a failed gate) meaningful. The implementation was **not** read in this pass. Treat "listen creates the socket path" as ⚠️ HYPOTHESIS until verified.
- **Failure cleanup of a half-started host**: `shutdownInternal` (`session-host.ts:724-...)` closes the client and rejects pending maps; whether it best-effort-unlinks the bridge socket file was not verified. A gate that throws before `bridge.listen` avoids this question entirely — deliberately do not assume `shutdownInternal` removes a socket.
- **`HarnessClient.subscribe()` / `initialize()` behavior on a spawn `'error'` event** (`client.ts:220-226`, `:307-320`): read partially; the exact rejection text composition is `closedError` (`client.ts:460-465` — includes `spawn error: <message>` when `spawnError` is set). Do not assume the message content.
- **`redactSecrets` behavior on arbitrary Node diagnostic paths** (`apps/vscode-dsh/src/redact.ts`): only the two tests in `tests/session-host.spec.ts:37-68` were read; the scrubber's full pattern set was not.
- **`process.execPath` value inside a real VS Code Extension Host** (Electron binary vs. an internal Node): taken from the f9af9f2fa5 commit message and the `launch.ts:119-125` JSDoc; not observable in this environment.
- **`apps/vscode-dsh/tsconfig.json` project wiring for a new `src/*.ts` file** (`apps/vscode-dsh/tsconfig.json`, `tsdown.config.ts`): not read; assume new files under `src/` are picked up by convention (⚠️ HYPOTHESIS).
- **Root cause of the 466-file full-suite failure** (`scripts/test-invariants.ts:186-191` `requireActive`): ❓ UNKNOWN.

---

## 9. Stub Detection & Registry Cross-Validation

`tech-debt-registry.md` active table (per phase prompt and re-read this session) contains only `DEBT-004`, unrelated to the Node path; `DEBT-001..003` are resolved/withdrawn.

| Registry ID | Location | Registry state | Code reality | Verdict |
|---|---|---|---|---|
| `DEBT-004` | (not on the Node path) | active, non-blocking | not inspected (out of Phase 1 scope) | ➖ out of scope |
| — | `packages/sdk/client/src/launch.ts:126-131` `resolveNodeExecutable()` | not registered | real implementation (explicit env read + `process.execPath`), not a stub | ✅ no stub |
| — | `packages/sdk/client/src/launch.ts:137-142` `installedDshNodeLaunch()` | not registered | one-line delegation to `resolveDshNodeLaunchFromManifests` | ✅ legitimate |
| — | `packages/sdk/client/src/client.ts:214-218` `spawn` site | not registered | real `child_process.spawn` with `error`/`exit`/`close` wiring | ✅ no stub |
| — | `apps/vscode-dsh/src/session-host.ts:210-269` `IdeSessionHost.start()` | not registered | full listen → spawn → initialize path with error unwind | ✅ no stub |
| — | `apps/vscode-dsh/src/node-env-guard.ts` | n/a | **file does not exist** (`ls apps/vscode-dsh/src/`) | ℹ️ expected new file |

Scans performed:
- `grep -rn "TODO\|FIXME\|XXX\|@STUB\|placeholder\|NotImplemented" packages/sdk/client/src apps/vscode-dsh/src` → only benign hits (`interaction-ui.ts:30,217` quick-pick `placeholder`, `chat-panel-provider.ts:655` HTML `placeholder=`, `conversation-titles.ts:10` / `extension-index.ts:198,278` describe empty-Tab "placeholder" *domain* concepts). **No unregistered stubs on the Node resolution path.**

### Stub Detection Summary
- ✅ Confirmed stubs matching registry: 0
- ⚠️ Registry mismatches: 0
- 🔴 Unregistered stubs: 0 (on the Phase 1 path)
- ℹ️ Artifacts a careless reader may mistake for source: `packages/sdk/client/src/launch.d.ts`, `packages/sdk/client/lib/**`, `packages/subprocess/subprocess/src/index.js` (untracked build residue), and the stale `.explore/06-external-interfaces-and-boundaries.md` (describes pre-`f9af9f2fa5` behavior).

**No escalation is raised**: the primary Phase 1 data path has no unregistered, blocking stub.

---

## 10. Recommended Next Reads

1. ⭐ `packages/sdk/client/src/launch.ts` (whole file, 187 lines) — the entire current Node resolution + Electron env logic.
2. ⭐ `apps/vscode-dsh/src/session-host.ts:39-64` and `:210-269` — the start ordering the gate must precede.
3. ⭐ `.specdev/specs/vscode-dsh-usable-loop/phases/phase-1-node-env-preflight/spec.md` — the acceptance checkpoint list this report is scoped to.
4. 🔷 `apps/vscode-dsh/src/extension.ts:108-266` (`VsCodeLike`), `:2133-2144` (`resolveStartCwd`), `:2174-2246` (`createStartHostPort.start`) — where the setting must be read and passed explicitly.
5. 🔷 `apps/vscode-dsh/tests/session-host.spec.ts` — the closest existing test shape for a new pre-flight spec (fixture runtime, tmpdir, error-path assertions).
6. 🔷 `packages/sdk/client/tests/launch.spec.ts` — existing expectations for `resolveNodeExecutable` / `resolveDshLaunch` that must not regress.
7. 🔷 `packages/sdk/client/README.md` + `README.i18n.yaml` — the doc pair contract for the public-surface change.
8. 🔹 `packages/subprocess/subprocess/src/index.ts:64-78` — what `buildIdeChildEnv` actually scrubs.
9. 🔹 `docs/development.md:1-160` + `docs/i18n/README.md` — where the Node prerequisite/ownership lists go and how the pair is re-recorded.
10. 🔹 `scripts/verify-translation-pairing.ts:1-20,147-174` — the `--write` mechanics.

### Reproducible command set (copy-paste)

```sh
cd /workspace/chendecheng/code/need/deepseek/deepseek-harness
export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
node -v && pnpm -v                      # v24.3.0 / 11.7.0
PNPM="pnpm --config.verify-deps-before-run=false"

$PNPM run test packages/sdk/client      # 3 files / 73 tests green (baseline)
$PNPM run test apps/vscode-dsh          # 48 files, 4 red files (baseline)
$PNPM run test:docs                     # 10 passed, 5 failed (baseline)
git show f9af9f2fa5 --stat              # 1 file, +12 -7
git show f9af9f2fa5 -- packages/sdk/client/src/launch.ts
git merge-base --is-ancestor f9af9f2fa5 HEAD && echo present
```
