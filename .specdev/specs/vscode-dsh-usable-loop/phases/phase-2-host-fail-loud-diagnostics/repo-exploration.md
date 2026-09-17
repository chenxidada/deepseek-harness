# Phase 2 Repo Exploration — `phase-2-host-fail-loud-diagnostics`

| Item | Value |
|---|---|
| Mode | **phase-level** (per-Phase). `current_phase` = `phase-2-host-fail-loud-diagnostics` (non-empty) in `.specdev/specs/vscode-dsh-usable-loop/current-status.json` |
| Repo root | `/workspace/chendecheng/code/need/deepseek/deepseek-harness` |
| Workflow slug | `vscode-dsh-usable-loop` |
| Authoritative scope | `phases/phase-2-host-fail-loud-diagnostics/spec.md` (AC-13 – AC-22; AD-3 / AD-4 / AD-5 / AD-13 / AD-14) |
| `ui` | **`false`** (phase-plan.md DAG JSON) → §11 is intentionally absent |
| Explored at | 2026-09-15 (branch `new/vscode-dsh`, HEAD `5307eec361`) |
| Discipline | Read-only. No product code, config, or test was modified. Only the two report files were written. |

**Evidence markers.** ✅ CONFIRMED = the claim was verified by reading the function body / executing the command in this session. ⚠️ HYPOTHESIS = derived from adjacent facts, not executed. ❓ UNKNOWN = not verifiable within this exploration.

> Every `path:line` in this report was read in this session. Line numbers are as of HEAD `5307eec361`.

---

## 1. Task Context

### 1.1 Phase goal (from `spec.md` §目标)

Turn every Host **start-failure boundary** — Node pre-flight gate / bridge listen / spawn / `initialize` handshake / child exit / missing credentials — into one inspectable, classified, already-redacted diagnostic **record**, and make the connection area show a **root-cause terminal copy** instead of the in-progress copy, **without introducing a second state authority** (still `AutoStartOrchestrator` → `ConnectionUiController`).

Two machine-readable surfaces ship in this Phase:

1. **NEW** `dsh.test.getDiagnosticsText` → `readonly HostDiagnosticRecord[]` (structured JSON record array, **18 fields**, `schemaVersion` on every record). Registered **inside** the existing `shouldRegisterTestHooks` gate.
2. **EXTEND** `dsh.test.listPendingInteractions` projection with `toolName` / `reason` (AD-13).

Plus: a VS Code **Output Channel** opened by at least one command (`dsh.showHostDiagnostics`, AC-13), fail-loud retry records (AC-22), and `TransportClosedError` structured details crossing the SDK boundary (AD-5).

### 1.2 What this exploration must establish

- The exact current state of each `primary_files` entry: existing responsibility, what Phase 2 must change, key symbols with line numbers.
- **≥3** ASCII call chains with `file:line` anchors: the **success** path, the **failure** path (where records are inserted), and the `dsh.test.*` registration/call chain including the actual gate.
- An **exhaustive** list of `errorKind` / `StartErrorKind` / `HostStartErrorKind` / `HostFailureKind` / `.diagnostic` consumption points, independently re-verifying or refuting the Phase-1 conclusion.
- Inherited-debt cross-validation: **DEBT-008**, **DEBT-009**, **DEBT-004**; plus Phase-1 F-3 landing points and the F-1 status.
- Environment facts + gate baselines (the implementer's differential gate depends on them).

### 1.3 Scope boundaries

- **In scope (DAG JSON `primary_files`)**: `apps/vscode-dsh/src/host-diagnostics.ts` (new), `src/session-host.ts`, `src/interaction-coordinator.ts`, `src/extension.ts`, `apps/vscode-dsh/package.json`, `packages/sdk/client/src/client.ts`.
- **In scope via `spec.md` §产出清单** (beyond DAG JSON): `src/auto-start-orchestrator.ts`, `tests/host-diagnostics.spec.ts` (new), `tests/session-host.spec.ts`, `tests/auto-start-orchestrator.spec.ts`, `packages/sdk/client/tests/sdk-client.spec.ts`.
- **Explicitly out of scope**: `dsh.test.answerApproval` and `InteractionCoordinator.resolveApproval` (Phase 3, AD-12) — see §7.3. `interaction-coordinator.ts` changes are **projection fields only** (`spec.md:72`).
- **Prohibited**: `packages/core/agent-loop`, new dependencies, new `contributes.configuration` (Phase 1 already added `dsh.nodeBin`).

---

## 2. Repository Overview

| Item | Value | Evidence |
|---|---|---|
| Language / module system | TypeScript, **ESM** (`"type": "module"`), `strict: true` | `spec.md:74`; ✅ `tsconfig*.json` present, imports carry `.ts` extensions (`session-host.ts:27`) |
| Monorepo | pnpm workspaces (`pnpm@11.7.0`), `packages/*`, `apps/*`, `vendor/*` | ✅ `package.json` `workspaces`, `pnpm --version` → `11.7.0` |
| Relevant apps/packages | `apps/vscode-dsh` (the VS Code extension), `packages/sdk/client` (JSON-RPC transport + launch resolution), `packages/ide/ide-bridge` (socket bridge host server) | ✅ |
| Node pin | `.nvmrc` = `24.3.0`; root `engines.node` = `^22.19.0 \|\| >=24.0.0` | ✅ |
| Test runner | Vitest. `apps/vscode-dsh/tests/**` drives **real production code** with a duck-typed `vscode` double + a real subprocess fake runtime | ✅ `node-env-guard.spec.ts:576-638`, `tests/fixtures/fake-sdk-runtime.mjs` |
| Lint | `oxlint` + `tsgolint` type-aware rules, config `.oxlintrc.json`; `pnpm run lint` = `build:lib:host && lint:contracts-ready` | ✅ `.oxlintrc.json` (12109 bytes), `package.json` |
| Docs gates | `pnpm run test:docs` = `run-gates` aggregator (15 gates) | ✅ `/tmp/p2-baseline-docs.txt` |

### 2.1 Two facts that shape this Phase

1. **`apps/vscode-dsh/src/**` is not covered by the client-UI i18n scanner** (`spec.md:75`) → product-visible copy in this app stays Chinese/English mixed by existing convention; the Output Channel's technical fragments stay verbatim English. No `verify-client-ui-i18n` constraint applies here.
2. **`packages/sdk/client/src/client.ts` is under a per-file 100% coverage gate** (`spec.md:74`, `phase-plan.md:153`). Every added branch in `client.ts` needs an executed test path — including the "signal-terminated" branch that currently does **not** exist (§5.3).

---

## 3. Most Relevant Areas

### 3.1 Primary files (DAG JSON)

---

#### 3.1.1 `apps/vscode-dsh/src/host-diagnostics.ts` — **DOES NOT EXIST** ✅ CONFIRMED

- Current responsibility: none. `Glob`/`Grep` over `apps/vscode-dsh/src` finds no such file and no `HostDiagnosticRecord` / `HOST_DIAGNOSTIC_SCHEMA_VERSION` / `HostFailureKind` symbol anywhere in the repo **outside `.specdev/`**.
- What Phase 2 must create:
  - `HostFailureKind` — the AD-14 `kind` vocabulary: `'node-environment' | 'bridge-listen' | 'spawn' | 'handshake-timeout' | 'child-exited' | 'missing-credentials' | 'other'` (7 members, `design.md:307`).
  - `HOST_DIAGNOSTIC_SCHEMA_VERSION = 1` — the **single** source of truth for `schemaVersion` (`design.md:325`, `design.md:328(c)`).
  - `HostDiagnosticRecord` — 18 fields, exact table reproduced in §3.2 below.
  - The **sink port** (injected by the extension per AD-3, `design.md:179`) + a **bounded** record store (bounded is a spec requirement — see §7.5).
  - The `HostFailureKind` → `StartErrorKind` mapping (AD-4, `design.md:186` names Phase-2 additions `spawn` / `handshake-timeout` / `bridge-listen`; `other` deliberately maps to the existing generic `process-failed`, per `spec.md:61`).
- Key symbols to create: `HOST_DIAGNOSTIC_SCHEMA_VERSION`, `HostFailureKind`, `HostDiagnosticRecord`, the sink interface, the recorder (`seq` monotonic from 1, `time` monotonic non-decreasing, `phase: 'start' | 'retry'`, `retryOfSeq`).
- Constraint: all text passes through `redactSecrets` **before** entering the sink (`spec.md:73`); `JSON.stringify(records)` must contain no credential value (`design.md:323`).

---

#### 3.1.2 `apps/vscode-dsh/src/session-host.ts` — the classification site

- **Current responsibility**: window-scoped Host — bridge listen, spawn, initialize, shutdown, multi-session routing, interaction fail-closed (`session-host.ts:1-6`). `start()` runs the ordered contract **Node gate → `bridge.listen` → spawn → `initialize`** ✅ CONFIRMED at `:286-317`.
- **Existing vocabulary + error type**:
  - `session-host.ts:27` `import type { StartErrorKind } from './auto-start-orchestrator.ts'` (type-only).
  - `session-host.ts:43-51` JSDoc describing the class vocabulary; `:53` `export type HostStartErrorKind = StartErrorKind`.
  - `session-host.ts:59-80` `class HostStartError extends Error` with `readonly kind` (`:61`) and `readonly diagnostic: NodeEnvironmentFailure | undefined` (`:62-63`), ctor `:70-79`.
- **The invariant Phase 2 must preserve**: `diagnostic` is present **exactly when** `kind === 'node-environment'` (`:62` JSDoc; `:323-327` only that branch passes `diagnostic`). ✅ CONFIRMED — `:329` throws `HostStartError('process-failed', …)` **without** `diagnostic`.
- **Failure exit (the single `catch` at `:318-330`)** ✅ CONFIRMED:

```318:330:apps/vscode-dsh/src/session-host.ts
    } catch (error) {
      this.status = 'error'
      const message = error instanceof Error ? error.message : String(error)
      this.errorMessage = redactSecrets(message, this.credentials)
      await this.shutdownInternal('start failed')
      if (error instanceof NodeEnvironmentError) {
        throw new HostStartError('node-environment', this.errorMessage, {
          cause: error,
          diagnostic: error.failure,
        })
      }
      throw new HostStartError('process-failed', this.errorMessage, { cause: error })
    }
```

- **What Phase 2 must change** (concrete, in execution order):
  1. **Hoist the resolved executable + socket path out of the `try`.** `nodeExecutable` is a `const` declared **inside** the `try` at `:289-291`, and `bridgePath` is stored on `this` at `:273`. The `catch` at `:318` therefore **cannot see `nodeExecutable`**. AC-14 requires `resolvedExecutable` on the record → the implementer must move the resolution above the `try` (or capture the resolved object in an outer `let`) — and must do so **without** breaking the AC-7 ordering contract that the gate runs before `bridge.listen` (verified by `tests/session-host-preflight.spec.ts`).
  2. **Insert the record before/around `shutdownInternal`.** `shutdownInternal` at `:786-816` sets `this.client = undefined` (`:814-815`) and disposes the client. So after `:322` the client-derived fields (`exitCode`, `terminationSignal`, `stderrTail`) are **unreachable** through `this.client`. They must come from the **thrown `error`** (AD-5 structured `TransportClosedError.details`) or be captured earlier. ⚠️ This ordering is a real trap: a naive implementation that reads `this.client` inside the `catch` after the `await` will silently produce empty fields.
  3. **Classify 4 new boundaries** into `HostFailureKind` and throw a `HostStartError` whose `kind` is the mapped `StartErrorKind`:
     - `bridge.listen` reject (`:293`) → `bridge-listen`, with `socketPath` = the absolute path.
     - `HarnessClient` spawn / constructor resolution failure (`:299-310`) → `spawn`, with `resolvedExecutable` + `source`.
     - `client.initialize()` timeout (`:312-316`) → `handshake-timeout`, with `handshakeTimeoutMs = options.initializeTimeoutMs ?? 10_000`; the thrown type is `RequestTimeoutError` (`client.ts:48-54`).
     - Anything else → `other` (must still record, with non-empty `detail` — `spec.md:48`).
     - Note: `process-failed` currently absorbs **all** of the above. Phase 1's DEBT-006 fixed exactly this flattening for `invalid-setting`; Phase 2 repeats it for the remaining boundaries, which is the point of AC-20.
  4. **`child-exited` is a sixth boundary that is NOT in `start()`.** Transport death is observed in `watchTransport` (`:568-595`) → `onTransportDeath` (`:597-627`), which sets `this.status = 'error'` and calls `notifyError`. AC-18 requires a `child-exited` record with `exitCode` / `terminationSignal`. See §7.2 — this is the one boundary whose insertion point is outside the `start()` try/catch.
- **Key symbols / line numbers**: `start()` `:259`…; pre-flight `:289-292`; `bridge.listen` `:293`; `new HarnessClient` `:299-308`; `client.start()` `:310`; `watchTransport` `:311`; `client.initialize()` `:312-316`; success `:317`; catch `:318-330`; `shutdown()` `:563-566`; `watchTransport` `:568-595`; `onTransportDeath` `:597-627`; `notifyError` `:629-637`; `shutdownInternal` `:786-816`.

---

#### 3.1.3 `apps/vscode-dsh/src/interaction-coordinator.ts` — projection only (AD-13)

- **Current projection** ✅ CONFIRMED — exactly the 6 fields the spec cites:

```188:199:apps/vscode-dsh/src/interaction-coordinator.ts
  listPending(): readonly PendingHostInteraction[] {
    return this.queue
      .filter(entry => entry.state === 'pending' || entry.state === 'presented')
      .map(entry => ({
        kind: entry.kind,
        id: entry.id,
        sessionId: entry.sessionId,
        state: entry.state,
        abort: entry.abort,
        ...entry.tabId === undefined ? {} : { tabId: entry.tabId },
      }))
  }
```

- **The data is already captured locally** ✅ CONFIRMED — `ApprovalEntry` carries `toolName: string` (`:83`) and `reason?: string` (`:84`); `handleApproval` reads `frame.toolName` / `frame.reason` (`:227-231`). So AD-13 needs **no new plumbing**, only two more keys in the `.map()` plus the `PendingHostInteraction` union (`:56-72`) gaining the two optional/required fields.
- **What Phase 2 must change**: add `toolName` and `reason` to the projection and to the `kind: 'approval'` member of `PendingHostInteraction` (`:57-64`). Questions entries (`:65-72`) have neither — the spec's "未新增其它字段" assertion (`spec.md:59`) means the `questions` arm must not silently gain fields with placeholder values; decide and document (recommended: make the two fields required on the `approval` arm only, so the union discriminates).
- **Do NOT touch**: `handleApproval` / `finishApproval` / `resolveApproval` (Phase 3, `spec.md:72`).
- **Key symbols / line numbers**: `PendingHostInteraction` `:56-72`; `ApprovalEntry` `:74-86` (`toolName` `:83`, `reason` `:84`); `listPending()` `:188-199`; `handleApproval` `:227-…`.

---

#### 3.1.4 `apps/vscode-dsh/src/extension.ts` — the presentation + wiring site (2570 lines)

- **Current responsibility**: single `activate()` that registers everything (deliberately does **not** Start, `:346-347`), plus module-level singletons.
- **Module-level state** ✅ CONFIRMED: `host` `:298`, `conversations` `:299`, `panelHost` `:300`, `orchestrator` `:320`, `connectionUi` `:321`, `credentialPresenceOverride` `:330`, `userStopping` `:332`, `hostCreateCount` `:334`, `stopOrchestratorWatch` `:317`.
- **Current wiring** (`:391-405`) ✅ CONFIRMED:

```391:405:apps/vscode-dsh/src/extension.ts
  connectionUi = new ConnectionUiController(vscode, {
    isConversationVisible: () => conversationVisible,
    applyConnectionState(state: ConnectionUiState) {
      panelHost?.applyConnectionState(state)
    },
  })
  context.subscriptions.push({ dispose: () => connectionUi?.dispose() })

  const startPort = createStartHostPort(vscode)
  orchestrator = new AutoStartOrchestrator(startPort)
  stopOrchestratorWatch?.()
  stopOrchestratorWatch = orchestrator.onChange((snap) => {
    connectionUi?.projectOrchestrator(snap)
    autoReady?.onHostReadyChanged(snap.state === 'started')
  })
```

- **The `StartHostPort` layer (where `invalid-setting` is actually thrown)** ✅ CONFIRMED:
  - `createStartHostPort(vscode)` `:2210-2284`; `start()` `:2217-2282`.
  - `readNodeBinSetting(vscode)` called at `:2255`; throws `HostStartError('invalid-setting', …)` at `:2185-2188`.
  - `readNodeBinSetting` definition `:2180-2191`.
  - On failure the port tears down watchers, `unbindConversations()`, sets `host = undefined`, and re-throws preserving `Error` identity (`:2271-2281`) — this is the hop that keeps `.kind` alive into `startErrorKindOf`.
- **Command registration sites Phase 2 extends** ✅ CONFIRMED:
  - `dsh.showPanel` `:461-469`; **`dsh.statusBarAction` `:471-475`** (`await revealConversationPanel(vscode); await orchestrator?.request('status-bar')`); **`dsh.openExtensionSettings` `:477-483`** (the existing settings deep link: `workbench.action.openSettings` + `@ext:deepseek-ai.dsh-vscode-dsh`).
  - `dsh.startSession` `:504-506`; `dsh.stopSession` `:508-…`.
  - `dsh.deleteHistory` `:948`.
- **`dsh.test.*` gate + block** ✅ CONFIRMED:

```950:952:apps/vscode-dsh/src/extension.ts
  // --- L2 Host test hooks (AD-CR-10: VSCODE_DSH_TEST / injected vscode harness only) ---
  const testDisposables: { dispose(): void }[] = []
  if (shouldRegisterTestHooks(vscodeArg)) {
```

```2139:2142:apps/vscode-dsh/src/extension.ts
function shouldRegisterTestHooks(vscodeArg?: VsCodeLike): boolean {
  if (process.env.VSCODE_DSH_TEST === '1' || process.env.VSCODE_DSH_TEST === 'true') return true
  return vscodeArg !== undefined
}
```

  - Existing `dsh.test.listPendingInteractions` registration `:1039-1042` → `() => host?.interactions.listPending() ?? []`.
  - Existing `dsh.test.getStartState` `:1108-1110`; `dsh.test.requestStart` `:1140-1144` (returns `orchestrator?.getSnapshot()`); `dsh.test.setCredentialPresence` `:1119-1122`.
- **`VsCodeLike.window` duck type**: `createStatusBarItem?` `:153-160`; `activeColorTheme?` `:162`; `onDidChangeActiveColorTheme?` `:164` — see §3.1.7 for the missing `createOutputChannel`.
- **What Phase 2 must change**:
  1. Add a `createOutputChannel` capability to the `VsCodeLike.window` interface (**does not exist today** — grep for `createOutputChannel|OutputChannel` over `apps/vscode-dsh/src` returns **zero hits** ✅ CONFIRMED).
  2. Instantiate the channel once (channel name must be stable: `DeepSeek Harness`, per AC-13(a)) and push it to `context.subscriptions`.
  3. Implement the sink port from §3.1.1 on top of that channel (AD-3: presentation lives here, classification does not).
  4. Register **`dsh.showHostDiagnostics`** (new command → `channel.show()`), and add it to `contributes.commands` (see §3.1.5).
  5. Register **`dsh.test.getDiagnosticsText`** inside the `testDisposables.push(…)` block (i.e. inside the `:952` gate), returning `readonly HostDiagnosticRecord[]`; JSDoc must state "name is retained, returns a structured JSON record array, does not return text" (`design.md:296`).
  6. Emit the AC-22 retry pair: on each `'status-bar'` / `'manual-retry'` request after a `failed` snapshot, append a `phase: 'retry'` record whose `retryOfSeq` points at the first-start record's `seq`. The retry entry point already exists (`dsh.statusBarAction` `:471-475`) and reuses the same path (`orchestrator.request` → `runStart` → `port.start`), so AC-22(c)'s "same path is reused" holds structurally.
  7. Fix DEBT-008's two `(AD-10)` → `(AD-9)` citations (see §Appendix A.1).
- **Key symbols / line numbers**: `activate` `:351`; gate call `:952`; `shouldRegisterTestHooks` `:2139-2142`; `readNodeBinSetting` `:2180-2191`; `createStartHostPort` `:2210-2284`; `collectCredentialsEnv` `:2196-2204`; `statusBarAction` `:471-475`; `openExtensionSettings` `:477-483`.

---

#### 3.1.5 `apps/vscode-dsh/package.json` — one new command contribution

- **Current state** ✅ CONFIRMED: `contributes.configuration.dsh.nodeBin` **already exists** (added by Phase 1, lines ≈57-66) → Phase 2 must **not** add a second configuration entry (`spec.md:76`).
- **`contributes.commands`** currently lists the `dsh.*` commands but **`dsh.showHostDiagnostics` is absent** ✅ CONFIRMED (and absent from the whole repo outside `.specdev/`).
- **What Phase 2 must change**: append `dsh.showHostDiagnostics` to `contributes.commands` (title + category following the neighbouring entries' style).
- ⚠️ **No package-level gate verifies `contributes`** (`phase-plan.md:138`, established in Phase 1 as a measured fact) → the "command is contributed" claim must be proven by a **runtime** test, not by assuming a gate will catch a mistake.

---

#### 3.1.6 `packages/sdk/client/src/client.ts` — AD-5 structured details (**per-file 100% coverage**)

- **Current responsibility**: JSON-RPC client over subprocess stdio (`client.ts:176-184`).
- **`TransportClosedError` is currently message-only** ✅ CONFIRMED — no structured fields at all:

```34:54:packages/sdk/client/src/client.ts
/**
 * The runtime subprocess is gone or unusable: it exited, its stdio closed, or
 * it was never launchable. The message carries the exit code and a stderr
 * tail when available.
 */
export class TransportClosedError extends Error {
  /** @param message - the failure description, including any stderr tail. */
  constructor(message: string) {
    super(message)
    this.name = 'TransportClosedError'
  }
}
```

- **Captured state that must become structured details** ✅ CONFIRMED:
  - `stderrTail: string[]` (`:191`), capped at `STDERR_TAIL_LIMIT = 400` (`:29`) by `appendStderr` (`:445-451`).
  - `exitCode: number | null | undefined` (`:195`) written by `child.once('exit', (code) => …)` (`:253-258`).
  - `spawnError: Error | undefined` (`:196`) written by `child.once('error', …)` (`:220-226`).
  - The single construction point `closedError(reason)` (`:460-466`) — **this is where message and structured fields must be produced together to prevent drift** (AD-5 `design.md:193`):

```460:466:packages/sdk/client/src/client.ts
  private closedError(reason: string): TransportClosedError {
    const parts = [`${this.runtime.description}: ${reason}`]
    if (this.spawnError !== undefined) parts.push(`spawn error: ${this.spawnError.message}`)
    if (this.exitCode !== undefined) parts.push(`exit code: ${String(this.exitCode)}`)
    if (this.stderrTail.length > 0) parts.push(`stderr tail:\n${this.stderrTail.join('\n')}`)
    return new TransportClosedError(parts.join('\n'))
  }
```

- **🔴 The `terminationSignal` gap (AC-18(b))** ✅ CONFIRMED: `child.once('exit', (code) => …)` at `:253` **discards the second argument** (`signal`). Node's `exit` event signature is `(code: number | null, signal: NodeJS.Signals | null)`; when a process is killed by a signal, `code === null`. So today the SDK **cannot** report `terminationSignal` and would print `exit code: null`. Phase 2 must capture `signal` and expose it as a structured field.
- **`executable` for AC-14**: `this.runtime.command` (`:214`, `:461`) is the spawn target; `runtime` comes from `resolveDshLaunch` unless injected (`:202-205`). `createProcessHarnessClient(options)` (`:470-476`) is the documented test constructor that injects `RuntimeProcessOptions` directly — this is the entry point AC-14 step (1) mandates for a **real** spawn failure.
- **`RequestTimeoutError`**: `:48-54`; thrown by `request()` on timeout; used for AC-15. `initialize()` uses `this.runtime.initializeTimeoutMs` (`:277`).
- **What Phase 2 must change**: add readonly structured details to `TransportClosedError` (per `spec.md:47` the test asserts at least `details.spawnError` and `details.executable`; per AD-5 at least exit code / termination signal / stderr tail / executable path / spawn error), fill them at the single `closedError` construction point, keep message prefixes verbatim (`spec.md:69`), and **add a test path for the signal branch** or per-file coverage will drop below 100%.
- **Key symbols / line numbers**: `STDERR_TAIL_LIMIT` `:29`; `TransportClosedError` `:39-45`; `RequestTimeoutError` `:48-54`; `SdkProtocolError` `:60-66`; private fields `:189-198`; `spawn` `:214-218`; `error`/`exit`/`close` handlers `:220-264`; `initialize` `:276-283`; `request` `:309-…`; `appendStderr` `:445-451`; `closedError` `:460-466`; `createProcessHarnessClient` `:470-476`.

---

#### 3.1.7 Support files (facts the implementer needs, minimal or zero change)

| File | Role in Phase 2 | Key symbols `file:line` |
|---|---|---|
| `packages/sdk/client/src/launch.ts` | **Read-only fact source.** Supplies `ResolvedNodeExecutable` (`path`, `source`, `electronRunAsNode`) and the default handshake timeout. | `DEFAULT_INITIALIZE_TIMEOUT_MS = 10_000` `:12`; `RuntimeProcessOptions.initializeTimeoutMs` `:22`; `resolveNodeExecutableSpec` `:131-145`; `resolveDshLaunch` `:164-…` (`command: nodeExecutable.path` `:184`) |
| `apps/vscode-dsh/src/redact.ts` | **Reuse, do not re-implement** (`spec.md:73`). | `redactSecrets` `:47-56`; `isCredentialShapedKey` `:13-15`; `redactBag` `:23-34` |
| `apps/vscode-dsh/src/node-env-guard.ts` | Supplies `NodeEnvironmentFailure` (the `.diagnostic` payload that Phase 2 maps into `nodeVersion` / `expectedRange` / `missingApis` / `hint`). | `NODE_BIN_SETTING` `:24`; `REQUIRED_NODE_APIS` `:27`; `NodeEnvironmentFailureKind` `:36-40`; `NodeEnvironmentFailure` `:57-76`; `NodeEnvironmentError` `:84-96`; `validateNodeEnvironment` `:115-…`; `assertNodeExecutable` `:155-158`; `formatNodeEnvironmentDiagnostics` `:167-…` |
| `apps/vscode-dsh/src/connection-ui.ts` | **Do not refactor** (AD-3 / AD-4). AC-19 / AC-20 assert its `getState()`. | `ConnectionUiState` / `getState()` `:102-104`; `projectOrchestrator` `:110-113`; `mapSnapshot` `:115-161`; **`settingsDeepLinkAvailable = snap.errorKind === 'missing-credentials'` `:140`**; message chain `:141-154`; `shouldShowStatusBar` `:163-171`; `apply` `:173-…` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | AC-19/AC-20 panel-side assertable surface. | `applyConnectionState` `:276`; `pushBanner(state.message ?? '正在连接到 Host…', 'connecting')` `:281` |
| `packages/ide/ide-bridge/src/host.ts` | `bridge.listen(path)` — the AC-16 failure boundary. | `listen(path)` `:71` |
| `apps/vscode-dsh/src/index.ts` | Library re-export surface; Phase 2's new exports should be added here for symmetry with `HostStartError` `:25` and `redactSecrets` `:41`. | `StartErrorKind` `:8`; `HostStartError` / `HostStartErrorKind` `:25` |

### 3.2 AD-14 — the 18-field `HostDiagnosticRecord` (verbatim from `design.md:300-319`)

Reproduced here because both the implementer and the reviewers depend on this list; the contract test in `host-diagnostics.spec.ts` compares against it literally.

| # | Field | Type | Nullability | Semantics |
|---:|---|---|---|---|
| 1 | `schemaVersion` | `1` (literal) | non-null (always `1`) | Contract version; single source `HOST_DIAGNOSTIC_SCHEMA_VERSION` |
| 2 | `seq` | `number` | non-null (monotonic from `1`) | Record ordinal; basis for AC-22's before/after pairing |
| 3 | `time` | `number` | non-null (epoch ms, monotonic non-decreasing) | Record timestamp |
| 4 | `phase` | `'start' \| 'retry'` | non-null | First start vs retry |
| 5 | `retryOfSeq` | `number \| null` | nullable (`null` when `phase === 'start'`) | `seq` of the first-start record this retry follows |
| 6 | `kind` | `'node-environment' \| 'bridge-listen' \| 'spawn' \| 'handshake-timeout' \| 'child-exited' \| 'missing-credentials' \| 'other'` | non-null | `HostFailureKind` |
| 7 | `resolvedExecutable` | `string \| null` | nullable (`null` for Node-unrelated failures) | Absolute path of the resolved Node executable (AC-14) |
| 8 | `source` | `'dsh-node-bin' \| 'vscode-setting' \| 'process-exec-path' \| null` | nullable | Which of the three chain sources selected it (AD-9) |
| 9 | `nodeVersion` | `string \| null` | nullable | Detected version (AC-8(b)) |
| 10 | `expectedRange` | `string \| null` | nullable | Expected version range (AC-8(c)) |
| 11 | `missingApis` | `readonly string[]` | non-null (`[]` when none) | Missing API names (AC-8(d)) |
| 12 | `socketPath` | `string \| null` | nullable | Bridge socket absolute path (AC-16) |
| 13 | `exitCode` | `number \| null` | nullable (`null` when signal-killed) | Child exit code (AC-18) |
| 14 | `terminationSignal` | `string \| null` | nullable (`null` on normal exit) | Terminating signal name (AC-18) |
| 15 | `handshakeTimeoutMs` | `number \| null` | nullable (only for `handshake-timeout`) | Handshake timeout (AC-15) |
| 16 | `stderrTail` | `readonly string[]` | non-null (`[]` when empty) | Verbatim stderr tail lines, original order, one per item, **not summarized** (AC-17) |
| 17 | `detail` | `string` | non-null (already redacted) | Failure reason (AC-14/AC-16) |
| 18 | `hint` | `string` | non-null (already redacted) | Actionable next step (AC-8(e)) |

Contract rules that constrain the implementation (all from AD-14, all testable):

- **Every field is always present**; inapplicable values are `null` or `[]` — never omitted (`design.md:298`).
- `[]` (no records) is legal; **never** `undefined` / `null` / throw; and on `[]` **no version assertion** is made (`design.md:321`).
- Return value must satisfy `Array.isArray(records) === true`; **forbidden** to wrap as `{schemaVersion, records}` (`design.md:325`).
- **Forbidden** to return a string or any whole-document rendered-text field (`text` / `renderedText` / `summary` / `log`) (`design.md:297`).
- Any change to the field set **must** bump `schemaVersion` in the same change (`design.md:327`).
- `detail` / `hint` assertions are limited to "non-empty" and "contains a specific structural token" — **never** natural-language wording (`design.md:322`).

---

## 4. Key Entry Points / Call Paths

### 4.1 Chain A — **successful** start (end-to-end, with anchors)

```
[VS Code]  activate(context, vscodeArg?)                     extension.ts:351
  ├─ connectionUi = new ConnectionUiController(vscode, …)    extension.ts:391
  ├─ startPort    = createStartHostPort(vscode)              extension.ts:399 → :2210
  ├─ orchestrator = new AutoStartOrchestrator(startPort)     extension.ts:400
  └─ orchestrator.onChange(snap => connectionUi.project…())  extension.ts:402-405

[user]  dsh.statusBarAction / activity-bar / view visible
  └─ orchestrator.request(reason)                            extension.ts:473 / :2295
       └─ runStart(reason)                                   auto-start-orchestrator.ts:198
            ├─ port.hasCredentials()?                        auto-start-orchestrator.ts:207
            └─ port.start(reason)                            auto-start-orchestrator.ts:213
                 └─ createStartHostPort().start()            extension.ts:2217
                      ├─ readNodeBinSetting(vscode)          extension.ts:2255 → :2180
                      └─ new IdeSessionHost().start({cwd, nodeBinSetting, credentials})
                                                             extension.ts:2256 → session-host.ts:259
                           ├─ resolveNodeExecutableSpec(...)  session-host.ts:289  (AD-1 single resolution)
                           ├─ assertNodeExecutable(exec)      session-host.ts:292  → node-env-guard.ts:155
                           │     └─ validateNodeEnvironment   node-env-guard.ts:115
                           ├─ bridge.listen(bridgePath)       session-host.ts:293  → ide-bridge/host.ts:71
                           ├─ new HarnessClient({nodeExecutable, …})
                           │                                 session-host.ts:299 → client.ts:201
                           ├─ client.start()  → spawn()       session-host.ts:310 → client.ts:211 → :214
                           ├─ this.watchTransport(client)     session-host.ts:311 → :568
                           └─ client.initialize({cwd,…})      session-host.ts:312 → client.ts:276
                                └─ request('initialize', …, runtime.initializeTimeoutMs)
                                                             client.ts:277 (:309; default 10s launch.ts:12)
                      └─ this.status = 'connected'            session-host.ts:317
            ├─ port.isConnected()? → state = 'started'       auto-start-orchestrator.ts:215-217
            └─ notify() → onChange listeners                 auto-start-orchestrator.ts:234/:242 → :255
  └─ ConnectionUiController.projectOrchestrator(snap)        connection-ui.ts:110
       └─ mapSnapshot: state 'started' → phase 'connected'   connection-ui.ts:126-127
            └─ message = undefined                           connection-ui.ts:143-144
```

**Where Phase 2 inserts records on this path**: nowhere. A successful start produces **no** record. (The spec's `[]` case.)

### 4.2 Chain B — **failing** start (the insertion points)

```
[any of the 6 boundaries throws inside start()]
  ├─(1) Node gate refuses   → NodeEnvironmentError       node-env-guard.ts:84 / assertNodeExecutable :155
  ├─(2) bridge.listen rejects → Error (EADDRINUSE/EACCES/ENOTDIR/…)  session-host.ts:293
  ├─(3) spawn fails          → TransportClosedError{d spawn error }  client.ts:220-226 → :460
  │      (or HarnessClient ctor / resolveDshLaunch throws → plain Error)  client.ts:204 / launch.ts:114
  ├─(4) initialize times out → RequestTimeoutError       client.ts:48 / request() :309+
  ├─(5) child exits          → TransportClosedError{exit code: N}    client.ts:253-258 → :460
  └─(6) credentials missing  → synthesized in orchestrator (never reaches the Host)
                                                         auto-start-orchestrator.ts:208-211

  catch (error)                                          session-host.ts:318
    ├─ this.status = 'error'                             session-host.ts:319
    ├─ message = error.message                           session-host.ts:320
    ├─ this.errorMessage = redactSecrets(message, creds)  session-host.ts:321  ← redact.ts:47
    ├─ await this.shutdownInternal('start failed')       session-host.ts:322 → :786
    │     └─ this.client = undefined (!!)                session-host.ts:814-815
    ├─ [★ INSERT RECORD HERE] kind = classify(error)     ← Phase 2: host-diagnostics sink
    ├─ NodeEnvironmentError → HostStartError('node-environment', …, {diagnostic})
    │                                                    session-host.ts:323-327
    └─ else                  → HostStartError('process-failed', …, {cause})
                                                         session-host.ts:329   ← Phase 2 splits this into
                                                                                bridge-listen / spawn /
                                                                                handshake-timeout / other

  throw propagates up through the StartHostPort          extension.ts:2256
    └─ catch → teardown watchers, unbindConversations(),
       host = undefined, re-throw the SAME Error instance extension.ts:2271-2280
                                                         ← THIS is why `.kind` survives the hop
       └─ runStart catch: state='failed'; errorKind = startErrorKindOf(error); errorMessage = …
                                                         auto-start-orchestrator.ts:223-227
            └─ startErrorKindOf: linear scan of START_ERROR_KINDS, else 'process-failed'
                                                         auto-start-orchestrator.ts:53-61
            └─ notify() → onChange                       auto-start-orchestrator.ts:234 → :255
  └─ connectionUi.projectOrchestrator(snap)              extension.ts:402-405 → connection-ui.ts:110
       └─ mapSnapshot: state 'failed' → phase 'failed'   connection-ui.ts:128-130
            ├─ settingsDeepLinkAvailable = errorKind === 'missing-credentials'  connection-ui.ts:140
            └─ message = snap.errorMessage ?? 'Host connection failed.'         connection-ui.ts:147 / :154
                 (the '正在连接到 Host…' literal at :142 applies ONLY to phase 'connecting')
  └─ [AC-22] retry entry: dsh.statusBarAction → revealConversationPanel + orchestrator.request('status-bar')
                                                         extension.ts:471-475
       └─ re-enters runStart → port.start → new IdeSessionHost → SAME path as Chain A
            └─ [Phase 2] append phase:'retry' record with retryOfSeq = <first-start seq>
```

**Two hard facts this chain establishes for the implementer:**

1. `A` `shutdownInternal` runs **before** the throw (`:322`), and it sets `this.client = undefined` (`:814-815`) → client-derived fields **must** come from the thrown `error` object (AD-5 `details`) or be captured before `:322`.
2. The failure path never touches `ConnectionUiController`'s `'connecting'` literal for a `failed` snapshot — AC-20 is already structurally satisfied at `connection-ui.ts:141-147`; the Phase-2 work is the **record side** (field-level `kind`), plus regression assertions.

### 4.3 Chain C — `dsh.test.*` registration and call chain (including the gate)

```
[test]  activate(context, vscodeDouble)                    extension.ts:351
  └─ shouldRegisterTestHooks(vscodeArg)                    extension.ts:952 (gate call)
       └─ definition:                                       extension.ts:2139-2142
            return env.VSCODE_DSH_TEST ∈ {'1','true'}  ||  vscodeArg !== undefined
       ├─ true  → testDisposables.push( vscode.commands.registerCommand(…) … )  extension.ts:953-1156
       │    ├─ 'dsh.test.listPendingInteractions'          extension.ts:1039-1042
       │    │     └─ () => host?.interactions.listPending() ?? []
       │    │            └─ InteractionCoordinator.listPending()  interaction-coordinator.ts:188
       │    │                  ← AD-13: add toolName / reason here (data already on ApprovalEntry :83-84)
       │    ├─ 'dsh.test.getStartState'                     extension.ts:1108-1110
       │    │     └─ orchestrator.getSnapshot()             auto-start-orchestrator.ts:124
       │    ├─ 'dsh.test.requestStart'                      extension.ts:1140-1144
       │    └─ [★ NEW] 'dsh.test.getDiagnosticsText'        ← Phase 2 registers here
       │          └─ returns readonly HostDiagnosticRecord[] (JSON records, never text)
       └─ false → the whole block is skipped (no registerCommand call at all)

[test]  commands.get('dsh.test.getDiagnosticsText')!()
  └─ read the sink's bounded record store → records.map(toRecord)
       └─ each record already passed redactSecrets before entering the sink   redact.ts:47
```

**⚠️ The gate is an OR, not just an env var** — see §7.1. `spec.md:21` cites `extension.ts:2124-2125` with the condition "`VSCODE_DSH_TEST === '1' | 'true'`"; the real definition is `:2139-2142` and it has a **second** disjunct (`vscodeArg !== undefined`).

---

## 5. Likely Impact Surface

### 5.1 Exhaustive `kind`-vocabulary consumption audit (independent re-verification)

Search patterns used: `errorKind|StartErrorKind|HostStartErrorKind|HostFailureKind|\.diagnostic` over the whole repo (all results inspected individually). The Phase-1 third-round conclusion was:

> "no `switch` over `StartErrorKind` exists anywhere; product-side readers of `.diagnostic` = 0."

**This exploration CONFIRMS both claims** ✅, with the full enumeration below.

#### 5.1.1 Vocabulary definition + production writers/readers

| # | `file:line` | Role | `switch`? | `default`? | Reads `.diagnostic` by `kind`? |
|---:|---|---|:--:|:--:|:--:|
| 1 | `auto-start-orchestrator.ts:27-32` `START_ERROR_KINDS` | **single source** of the vocabulary (currently `invalid-setting`, `missing-credentials`, `node-environment`, `process-failed`) | — | — | — |
| 2 | `auto-start-orchestrator.ts:43` | `export type StartErrorKind = typeof START_ERROR_KINDS[number]` | — | — | — |
| 3 | `auto-start-orchestrator.ts:53-61` `startErrorKindOf` | **guard / mapping** — `for…of` linear scan with `===`, trailing `return 'process-failed'` | **NO** | not applicable (fallback is the trailing `return`, not a `default:` arm) | no |
| 4 | `auto-start-orchestrator.ts:68` | snapshot field `errorKind?: StartErrorKind` | — | — | — |
| 5 | `auto-start-orchestrator.ts:98, 129, 220, 226, 251` | field storage / snapshot projection / generic write / classified write / clear | — | — | no |
| 6 | `session-host.ts:27` | type-only import of `StartErrorKind` | — | — | — |
| 7 | `session-host.ts:53` | `export type HostStartErrorKind = StartErrorKind` (alias — keeps the two vocabularies **structurally equal**) | — | — | — |
| 8 | `session-host.ts:61, 71, 78` | `HostStartError.kind` field / ctor param / assignment | — | — | — |
| 9 | `session-host.ts:324` | **writer**: `new HostStartError('node-environment', …, {diagnostic})` | — | — | no (writes) |
| 10 | `session-host.ts:329` | **writer**: `new HostStartError('process-failed', …, {cause})` | — | — | no (writes) |
| 11 | `extension.ts:34` | imports `HostStartError` | — | — | — |
| 12 | `extension.ts:2185-2188` | **writer at the `StartHostPort` layer**: `new HostStartError('invalid-setting', …)` | — | — | no |
| 13 | `extension.ts:2278-2280` | re-throw preserving `Error` identity (the hop that keeps `.kind`) | — | — | no |
| 14 | **`connection-ui.ts:140`** | **the ONLY production reader of `errorKind`**: `settingsDeepLinkAvailable = snap.errorKind === 'missing-credentials'` | **NO** (equality test) | — | **no** |
| 15 | `connection-ui.ts:117-139` | `switch (snap.state)` over **`StartOrchestratorState`** — a *state* switch, **not** a kind switch; `default:` is a `const _exhaustive: never` exhaustiveness assertion (`:134-138`) | yes (state) | yes (exhaustiveness assertion, not a swallow) | no |
| 16 | `apps/vscode-dsh/src/index.ts:8, 25` | re-export surface | — | — | — |

**Conclusion:** production code contains **exactly one** `errorKind` reader (`connection-ui.ts:140`, an equality test with no `switch` and no `default` to get wrong) and **zero** `switch` statements over `StartErrorKind`. `HostFailureKind` has **zero** occurrences anywhere outside `.specdev/` ✅. Therefore adding Phase-2 members to `START_ERROR_KINDS` cannot silently mis-route through a missing `default:` arm — the only fail-open risk would be a *new* switch that a Phase-2 author writes. **Do not introduce one**; follow `startErrorKindOf`'s existing scan-with-fallback shape.

#### 5.1.2 Production readers of `.diagnostic` — **0** ✅ CONFIRMED

`HostStartError.diagnostic` is read **only** by tests and by the Phase-1 verifier script:

| `file:line` | Context |
|---|---|
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts:180-182` | `error.diagnostic?.source` / `.executablePath` / `.kind` (optional-chained — does **not** narrow by `kind`) |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts:222-223` | `.kind` / `.executablePath` |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts:254-256` | `.source` / `.kind` / `.executablePath` |
| `.specdev/.../phase-1-node-env-preflight/test-scripts/v3-e2e-preflight.mts:107, 120, 135, 153-154, 189` | Phase-1 verifier script |

⇒ **F-3 item #2 ("narrow by `kind` before reading `.diagnostic`") has no landing point in existing product code** — the reads that need it will be the *new* Phase-2 code in `host-diagnostics.ts` / `session-host.ts` that maps `NodeEnvironmentFailure` → `nodeVersion` / `expectedRange` / `missingApis` / `hint`. See §5.3.

#### 5.1.3 Test-side consumers that will feel the vocabulary extension

| `file:line` | Assertion | Impact of adding members |
|---|---|---|
| `tests/auto-start-orchestrator.spec.ts:8, 12` | imports `StartErrorKind` + `HostStartErrorKind` | none |
| `tests/auto-start-orchestrator.spec.ts:146` | `SameSet<HostStartErrorKind, StartErrorKind>` type-level equality | **keeps the two vocabularies locked together** — a member added to only one side is a compile error here |
| `tests/auto-start-orchestrator.spec.ts:123, 162, 175` | `'missing-credentials'` / `'node-environment'` / `'process-failed'` | none (`process-failed` remains the generic member) |
| `tests/node-env-guard.spec.ts:714, 722, 735, 744` | `'node-environment'` / `'invalid-setting'` | none |
| `tests/phase1-auto-start.spec.ts:228, 231` | `'missing-credentials'` | none |
| `tests/phase4-new-conversation-chrome.spec.ts:203, 206` | `'missing-credentials'` | none |
| `.specdev/.../phase-1.../test-scripts/v3-e2e-preflight.mts:173` | `!(outcome instanceof HostStartError) || outcome.kind === 'process-failed'` | **safe**: the positive control throws a `TransportClosedError` (not a `HostStartError`), so the first disjunct is already true; this is **not** a stale assertion — see §5.4 |
| `.specdev/.../phase-1.../test-scripts/v3-e2e-preflight.mts:240` | `snapshot.errorKind === 'invalid-setting'` | **F-1 is FIXED** — see §5.4 |

### 5.2 Blast radius of the two new command surfaces

| Surface | Registration | Contributed? | Consumers |
|---|---|---|---|
| `dsh.test.getDiagnosticsText` | inside the `:952` gate → `testDisposables` | **not** contributed (test-only), correct per AD-14 decision 8 | Phase 3 driver whitelist (`phase-3 spec.md:151, 185`) |
| `dsh.test.listPendingInteractions` (extended) | same gate, `:1039-1042` | not contributed | Phase 3 AC-25 step4 asserts `toolName === 'bash'` + non-empty `reason` (`phase-3 spec.md:183`) — **this Phase's projection extension is a hard prerequisite for Phase 3** |
| `dsh.showHostDiagnostics` | production registration in `activate()` | **must be added** to `contributes.commands` | AC-13(b)(c) |

### 5.3 The concrete F-3 landing points (Phase-1 round-3 connectivity finding → Phase-2 obligation)

| F-3 requirement | Where it lands | Current state |
|---|---|---|
| (1) An explicit mapping branch for `invalid-setting` | `auto-start-orchestrator.ts:53-61` (`startErrorKindOf`) **already** accepts it, and `:27-32` already lists it | ✅ **Phase 1 already did this.** Phase 2 must **not** regress it: `invalid-setting` must keep a distinct member (not folded into `node-environment` or `other`) |
| (2) Narrow before reading `.diagnostic` | **No existing product reader** (§5.1.2). Lands in the **new** `host-diagnostics.ts` mapping: read `error.diagnostic` only on the `kind === 'node-environment'` path (or guard with `error.diagnostic !== undefined`) so the "present exactly when `node-environment`" invariant (`session-host.ts:62`) is never violated | ⚠️ New code — the invariant is stated but **not enforced by the type system** (`diagnostic: … \| undefined`), so a future `HostFailureKind` member must not be allowed to inherit it accidentally |
| (3) `launch.ts` returns the setting value verbatim → `resolvedExecutable` is absolute **only** for `process-exec-path` | `launch.ts:131-145`: `DSH_NODE_BIN` returns `environmentValue` verbatim (`:134`); `nodeBinSetting` returns `setting` verbatim (`:138`); only `process.execPath` (`:141`) is guaranteed absolute. And `client.ts:214` passes `nodeExecutable.path` straight to `spawn` as `command`, while `closedError` uses `this.runtime.description` (`:461`) for the executable identity | ✅ CONFIRMED as described. **Consequence**: the AD-14 field `resolvedExecutable` is documented as "**absolute** path" (`design.md:308`) and AC-14's test asserts equality with the absolute path the test itself passed in — so the contract holds **only** when the input is absolute. Phase 2 must decide and document whether to (a) assert absoluteness only in the `process-exec-path` / explicit-absolute-input cases, or (b) resolve the value to an absolute path before recording. **Do not silently claim absoluteness in general** |

### 5.4 F-1 status — **FIXED** ✅ CONFIRMED (independently re-verified)

- `v3-e2e-preflight.mts:240` now asserts `snapshot.errorKind === 'invalid-setting'`; `:196-198` carries a comment stating that the old `process-failed` expectation was removed and must not be restored. `:258` asserts `'node-environment'`.
- The only remaining `process-failed` occurrence is `:173` — and it is **not** the stale assertion the Phase-1 connectivity review described (that text cited `:236` "today"). `:173` is a **positive-control disjunct**: `!(outcome instanceof HostStartError) || outcome.kind === 'process-failed'`. The positive control drives a witness-script `dshBin` whose failure surfaces as a `TransportClosedError`, which is not a `HostStartError`, so the first disjunct holds **and will keep holding after Phase 2 adds members**. No action needed; **do not "fix" it**.
- ⇒ Phase-2 verifier may reuse this script's assertions without manufacturing a false red.

### 5.5 Impact/risk table

| Area | Change | Risk | Mitigation |
|---|---|:--:|---|
| `START_ERROR_KINDS` +3 members (`spawn`, `handshake-timeout`, `bridge-listen`) | additive | LOW — single source (`:27-32`), the `SameSet` test at `auto-start-orchestrator.spec.ts:146` keeps `HostStartErrorKind` in lockstep, no `switch` to break | do **not** add a `switch`; keep `startErrorKindOf`'s scan-with-fallback |
| `HostStartError.diagnostic` invariant | must stay `node-environment`-exclusive | MEDIUM — the type allows `diagnostic` on any kind | guard the read; keep `:323-327` the only writer |
| Record insertion site vs `shutdownInternal` ordering | client fields must be read from `error`, not `this.client` | **HIGH** — silent empty fields | see §4.2 note 1; assert non-empty `stderrTail` / non-null `exitCode` in AC-17/AC-18 tests |
| `child-exited` boundary lives in `onTransportDeath`, not `start()` | new insertion point outside the try/catch | MEDIUM | see §7.2 |
| `TransportClosedError` gains fields | `client.ts` is under per-file 100% coverage | **HIGH** — a new `signal` capture branch is unexecuted by default | add an explicit SIGTERM test (`spec.md:52(b)` already mandates it) |
| `listPending()` projection grows by 2 keys | consumed by `phase4-new-conversation-chrome.spec.ts`, `interaction-fail-closed*` tests | LOW | keep the `questions` arm field-free (or document the decision) |
| Output Channel added to `VsCodeLike.window` | all duck-typed doubles in `tests/**` lack `createOutputChannel` | MEDIUM — a hard `vscode.window.createOutputChannel(...)` call would throw in every existing test that activates the extension | make it **optional** (`createOutputChannel?`) like `createStatusBarItem?` (`:153`) and no-op when absent |
| `contributes.commands` addition | no package-level gate covers `contributes` | LOW | prove by runtime test, not by gate assumption |
| `packages/core/agent-loop` | untouched | — | explicitly prohibited (`spec.md:77`) |

---

## 6. Existing Constraints

### 6.1 Testing practice (`apps/vscode-dsh/tests/**`)

- **Duck-typed `vscode`, not `vi.mock('vscode')`.** The canonical double is `node-env-guard.spec.ts:587-617` (`makeVscode`) and the activation shim is `:629-638` (`activateWith`), which calls `activate({subscriptions: [], extensionPath, workspaceState}, vscode as never)`. ✅ CONFIRMED (read in full).
- **Consequence of the gate's OR**: any test that injects the double registers **all** `dsh.test.*` hooks regardless of `VSCODE_DSH_TEST` (see §7.1).
- **Real code, real subprocesses.** `spec.md:38` requires the primary verification surface to be the Node layer driving real production paths with the fake runtime (`apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs`). Existing precedent: `node-env-guard.spec.ts:1-6` ("Every case executes a real subprocess; none is a static assertion"), and `session-host-preflight.spec.ts` drives the real `IdeSessionHost`.
- **Assertion style for AC-14/15/16 etc.**: **field-level on the JSON records only**; text matching is forbidden except for AC-19/AC-20's UI `message` requirements (`spec.md:40`).
- Test files live flat under `apps/vscode-dsh/tests/` (50 test files, 55 files total in that tree) with colocated `*.spec.ts` naming; helpers sometimes live as non-spec siblings (`spike-*.ts`) — **do not** add a spec-named helper.
- Per-file cleanup is the norm: `afterEach` → `deactivate()` + `vi.restoreAllMocks()` + `commands.clear()` (`node-env-guard.spec.ts:580-585`).

### 6.2 Lint / typecheck

- `pnpm run lint` = `npm run build:lib:host && npm run lint:contracts-ready`; `build:lib:host` = `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`. ✅ CONFIRMED — in the baseline run `tsc -b tsconfig.host.json` **succeeded** (tsdown then ran), i.e. the type-level build for host packages is currently green.
- Zero-tolerance rules that the DSL of this Phase will hit:
  - `typescript(no-non-null-assertion)` — already triggered at `auto-start-orchestrator.ts:236` and `interaction-coordinator.ts:328`.
  - `@stylistic(arrow-parens)` / `@stylistic(indent)` / `typescript(require-await)` / `typescript(no-unnecessary-condition)` / `typescript(no-confusing-void-expression)` / `typescript(no-base-to-string)` / `typescript(unbound-method)`.
  - **Practical implication**: a JSDoc-documented interface with optional methods must not use `?.` on a value the checker proves non-nullish (`no-unnecessary-condition` fires on `connection-ui.ts:154`, `extension.ts:2272/2274`), and command callbacks must use `(...)` arrow parens with braces (`no-confusing-void-expression`).
- **Exports need JSDoc** (`spec.md:74`) and are enforced by `pnpm run verify-export-jsdoc` (`package.json:130`), which is also one of the `test:docs` gates — **it is in the passing set**, so new exports without JSDoc would be a **new** failure.

### 6.3 Formatting / file hygiene

- **Exactly one trailing newline** at EOF (`spec.md:74`). `verify-md-wrap` is already red for Markdown, but TS files are checked by lint/prettier-style rules.
- ESM: relative imports carry the `.ts` extension (`session-host.ts:27-32`), and `createRequire` is used when a CJS module must be loaded (`extension.ts:79, 341-342`).

### 6.4 Coverage gate — `packages/sdk/client/src/client.ts`

- Per-file **100%** (`statements`/`branches`/`functions`/`lines`) with `perFile: true`, enforced by `scripts/test-invariants.ts` (`thresholds` at `:348`, `uncoveredLocationsReporter` at `:14`, exclusion arrays at `:70`/`:80`/`:106`/`:127`). ✅ CONFIRMED (read in the prior session; unchanged by Phase 1).
- **Only** `pnpm run test:coverage` / `pnpm run test:coverage:partitioned` may be used; **`vitest run --coverage <path>` filtering is forbidden** because it drops other files out of the report (`phase-plan.md:138`).
- Baseline for this package today is **green**: `pnpm run test packages/sdk/client` → 3 files / 84 tests passed, exit 0 ✅ (see §Appendix B).

### 6.5 Product-code constraints from `spec.md:67-77`

- AD-3: classification in `IdeSessionHost`, presentation in the extension; **forbidden** to classify by parsing error-message strings in `extension.ts`.
- AD-4: **forbidden** to add `StartOrchestratorState` / `ConnectionUiPhase` members.
- AD-5: keep the message prefixes `exit code: N` / `stderr tail:` / `spawn error:` verbatim.
- AD-13: extend the projection only; **forbidden** to add new `dsh.test.*` commands that read session logs.
- Redaction: reuse `redact.ts`; **forbidden** to write a second implementation.
- No new dependencies; no new `contributes.configuration`; do not touch `packages/core/agent-loop`.
- Copy language: `apps/vscode-dsh/src` is outside the i18n scanning scope; user-visible copy keeps the existing extension style, Output Channel technical fragments stay English, both must be credential-free.

---

## 7. Risks / Unknowns

### 7.1 🔴 The `shouldRegisterTestHooks` gate is an **OR**, and `spec.md:21` mis-cites it

- `spec.md:21` states the gate is at `extension.ts:2124-2125` with condition `VSCODE_DSH_TEST === '1' | 'true'`.
- **Measured reality**: the function is at `extension.ts:2139-2142` and is:

```2139:2142:apps/vscode-dsh/src/extension.ts
function shouldRegisterTestHooks(vscodeArg?: VsCodeLike): boolean {
  if (process.env.VSCODE_DSH_TEST === '1' || process.env.VSCODE_DSH_TEST === 'true') return true
  return vscodeArg !== undefined
}
```

- **Why this matters for AC-13(d)** (`spec.md:46`) and the boundary case in `spec.md:61`: the negative case is worded "when `VSCODE_DSH_TEST` is unset, `dsh.test.getDiagnosticsText` **must not** exist (assert `registerCommand` was not called)". But **every existing test activates the extension with an injected `vscode` double** (`node-env-guard.spec.ts:629-638`), and `vscodeArg !== undefined` alone makes the gate return `true`. And the alternative — calling `activate(context)` without the double — goes through `loadVscodeApi()` (`extension.ts:340-343`), which does `require('vscode')` and **throws** in a plain Node test process. ✅ CONFIRMED by reading both.
- **So the negative assertion is not achievable with the current test harness as literally worded.** The implementer must choose an approach and record it in `implementation.md`:
  - (a) assert the gate function's behaviour indirectly by stubbing `createRequire` / `node:module` (the only way to reach `activate(ctx)` with `vscodeArg === undefined`), or
  - (b) keep the injected double and assert the **other** half of the gate semantics (env var off + double present ⇒ registered; and separately test the predicate's two disjuncts), documenting that the "not registered" direction is unobservable in-process, or
  - (c) escalate to the user for a spec clarification if (a)/(b) are deemed insufficient.
- **Do not** change `shouldRegisterTestHooks` itself — that would move all 30+ existing `dsh.test.*` hooks behind a stricter gate and break the whole test suite. ⚠️ This is a **spec-vs-repo discrepancy**, not a code defect.

### 7.2 🟡 The `child-exited` boundary is outside `start()`'s try/catch

- `spec.md:52(AC-18)` and `spec.md:61` require a `child-exited` record with `exitCode` / `terminationSignal`, and `spec.md:54(AC-20)` requires `kind` ∈ {…, `child-exited`, …}.
- But a child that **exits after a successful connect** is observed by `watchTransport` (`session-host.ts:568-595`) → `onTransportDeath` (`:597-627`), which sets `status = 'error'` and calls `notifyError` — **not** by the `start()` catch.
- ❓ UNKNOWN at exploration time: whether `start()`'s `initialize()` window can also observe an exit as `TransportClosedError` — yes it can (`client.request` at `:313-316` throws `closedError('… is not running')`), and that path **is** inside `start()`, so AC-18 can be satisfied by a child that exits **before** the handshake completes. But AC-18's wording ("当子进程退出时") does not distinguish the two.
- **Consequence**: the recorder needs a second insertion point in `onTransportDeath`, and the `HostFailureKind → StartErrorKind` mapping must answer "what `errorKind` does a post-connect `child-exited` produce?" — today `onTransportDeath` does **not** touch `errorKind`; it flows to `extension.ts:2243-2249` → `onUnexpectedDisconnect()` → `disconnected` / `disconnected-retrying`, which is **not** `failed`. AC-20 only requires `phase !== 'connecting'` for the snapshot, so this is satisfiable, but the mapping decision must be made **explicitly** and recorded.
- Recommendation for the implementer: satisfy AC-18 through the **pre-handshake** exit path inside `start()` (which produces a `failed` snapshot and an `errorKind`), and treat the post-connect exit as the `child-exited` **record** with a documented snapshot note. If that reading is rejected, this is a **spec ambiguity worth escalating before coding**, not after.

### 7.3 ✅ Precondition re-verified: `dsh.test.answerApproval` / `resolveApproval` are Phase 3

- Repo-wide grep for `answerApproval|resolveApproval` returns **only** `.specdev/` documents (design / plan / spikes / phase-3 spec). ✅ CONFIRMED — no product or test source mentions them.
- `phase-plan.md:155` and `spec.md:72` both state they are **not** delivered here. `interaction-coordinator.ts` changes are projection-only.
- ⇒ The implementer must **not** create them "while nearby" (`_probe`-style scope creep): `SPEC.md:71` forbids new `dsh.test.*` surfaces other than `getDiagnosticsText`, and AD-13 restricts this file to the projection.

### 7.4 ✅ Precondition re-verified: real spawn failure is unreachable on the normal path

- `spec.md:47`'s "important precondition": after Phase 1 the gate rejects missing / non-executable Node paths, and all three sources share one resolution chain (AD-1), so a genuine spawn failure is unreachable through the product path — which is exactly AC-7's intent.
- **Code confirms it**: `session-host.ts:289-292` resolves and validates **before** `client.start()`/`spawn()` at `:310`; `launch.ts:131-145` is the single resolution entry. ✅ CONFIRMED.
- ⇒ AC-14's two-layer evidence is **necessary**, not a convenience: layer (1) uses `createProcessHarnessClient({command: '<absolute nonexistent path>'})` (`client.ts:470-476`) to force a **real** `spawn` failure at the SDK level; layer (2) drives the Host's failure exit with the production `TransportClosedError` type.
- ⚠️ Note: layer (2) is described in `spec.md:47` as "the same type produced by step (1)". Constructing the error via the production constructor is acceptable, but a reviewer may ask whether it is a hand-built object rather than the produced one; the AC-14 text permits it (it says "using the production class `TransportClosedError` (the same type produced by step (1))").

### 7.5 🟡 "Bounded record store" is required but no bound is specified

- `phase-plan.md:147` requires "sink port + **bounded** records + redaction". Neither `spec.md` nor AD-14 states the bound, and none of the ACs assert a specific capacity. The only unbounded-growth-relevant constraint is that `seq` increases monotonically and AC-21 asserts over `JSON.stringify(records)`.
- ❓ UNKNOWN: whether a reviewer/verifier will test the bound. Recommendation: make the bound an exported named constant with JSDoc (e.g. mirroring `STDERR_TAIL_LIMIT = 400` at `client.ts:29`) and document the eviction rule; assert in `host-diagnostics.spec.ts` that exceeding it evicts oldest-first and that `seq` stays monotonic.

### 7.6 🟡 `resolvedExecutable` absoluteness

See §5.3 item (3). `resolvedExecutable` is contractual ("**absolute** path", `design.md:308`) but `launch.ts:134/138` return `DSH_NODE_BIN` and the setting **verbatim**. A relative or empty-looking value could be recorded as-is. Decide and document; do not silently assume absoluteness.

### 7.7 🟡 Output Channel must not break the 50 existing test files

Every duck-typed `vscode` double in `tests/**` omits `window.createOutputChannel`. If the extension calls it unconditionally, **all** activating tests break (including the Phase-1 regression suite). ✅ CONFIRMED that no double provides it (repo-wide grep for `createOutputChannel` = 0 hits outside `.specdev/`).

Mitigation: declare it optional in `VsCodeLike.window` next to `createStatusBarItem?` (`extension.ts:153-160`) and fall back to a no-op sink when absent — but then AC-13(a) ("`createOutputChannel` called exactly once, stable channel name") must be asserted with a double that **does** provide it, and the no-op path must also be exercised (for coverage of the fallback branch).

### 7.8 🟡 Git branch for this Phase **does not exist**

- `current-status.json` records that `impl-phase-2-host-fail-loud-diagnostics` was created. **Measured today**: `git branch --list 'impl-*'` shows only `impl-phase-1-build-outdir`, `impl-phase-1-sdk-server-specdev-ref`, `impl-phase-4-build-green-tsdown`, `impl-phase-4-subagent-enter-pin`; the current branch is **`new/vscode-dsh`** at HEAD `5307eec361` (the Phase-1 commit). `git reflog --all | grep phase-2-host` → **no output**. ✅ CONFIRMED.
- **Consequence**: `pipeline-gate.sh` blocks `implementer` dispatch unless the current branch is `impl-<current_phase>`. The scheduler must run `git checkout -b impl-phase-2-host-fail-loud-diagnostics` **before** dispatching the implementer (creating it after this exploration is the documented order in `spec-workflow.mdc` — code-explorer → branch → implementer).
- This is an **orchestration-state discrepancy**, informational for the implementer, not a code blocker. Flagged so nobody assumes "the branch already exists".

---

## 8. Uncertain / Unverified

| # | Item | Marker | Why it matters | How to resolve |
|---:|---|---|---|---|
| 8.1 | Can `IdeSessionHost.start()` observe a **post-handshake** child exit and still classify it (rather than `onTransportDeath`)? | ❓ UNKNOWN | Decides whether AC-18 needs one insertion point or two (§7.2) | Read `client.request`'s pre-flight (`client.ts:313-316`) against the fake runtime's exit timing; or simply cover AC-18 via the pre-handshake exit path |
| 8.2 | Does the AC-13(d) negative case ("gate off ⇒ not registered") have **any** in-process means of observation today? | ⚠️ HYPOTHESIS: no, without stubbing `node:module` | §7.1; affects whether the implementer can satisfy the boundary list as literally written | Attempt approach (a) in a scratch test, or escalate for a wording clarification |
| 8.3 | Are there additional duck-typed `vscode` doubles beyond `node-env-guard.spec.ts:587-617` (e.g. in `interaction-fail-closed*.spec.ts`) that also need `createOutputChannel` added? | ❓ UNKNOWN (only one double was read in full) | Determines how many test files the Output-Channel change touches | Grep each activating spec for its `vscode` literal before implementing |
| 8.4 | `HostFailureKind → StartErrorKind` mapping for `other` and `child-exited` | ⚠️ HYPOTHESIS: `other → 'process-failed'` (stated by `spec.md:61`); `child-exited` → ? (AD-4 lists only `spawn` / `handshake-timeout` / `bridge-listen` as Phase-2 additions, `design.md:186`) | A missing member in `START_ERROR_KINDS` silently degrades to `process-failed` via the fallback, which would make AC-20's `kind`-based assertions pass while the snapshot classification is wrong | Decide explicitly; if `child-exited` needs no `StartErrorKind` member (because it is never a start failure), record that decision in `implementation.md` |
| 8.5 | Whether the record store's bound is asserted by any downstream reviewer/verifier | ❓ UNKNOWN | §7.5 | Document the bound + eviction rule as a named constant; self-test it |
| 8.6 | Exact expected content of AC-22's `retryOfSeq` linkage when the first start produced **no** record (e.g. a start that fails before the recorder is wired) | ❓ UNKNOWN | AC-22(b) requires a pair; a retry with no `retryOfSeq` target is undefined by the spec | Derive from `seq` of the most recent `phase === 'start'` record; define the degenerate case (`retryOfSeq: null`? or forbid it) |
| 8.7 | Whether `vscode.window.createOutputChannel` must be **disposed** via `context.subscriptions` | ⚠️ HYPOTHESIS: yes, following the existing pattern (`:397`, `:1159+`) | Leaked channels across `activate`/`deactivate` cycles in tests could cause cross-test state | Follow the existing `context.subscriptions.push(...)` pattern |
| 8.8 | Whether `stderrTail` needs *exactly* the client's 400-line cap or a Phase-2-specific cap for the record | ❓ UNKNOWN | AC-17 requires ≥20 lines verbatim; AD-14 does not set a cap | Reuse the client's tail (`STDERR_TAIL_LIMIT = 400`, `client.ts:29`) and document it |
| 8.9 | Whether the AC-20 UI assertion needs to cover the `disconnected*` phases | ⚠️ HYPOTHESIS: no — AC-20 says "if a start already failed" | Avoids over-scoping into `connection-ui.ts` (which AD-3 forbids refactoring) | Keep assertions on `failed` snapshots only |

**No ⚫ CRITICAL finding was discovered.** The one conflict that needs a human decision is §7.1 (spec citation + an OR gate that makes the literal negative assertion unobservable) and, secondarily, §7.2 (`child-exited` insertion point). Neither invalidates completed Phase-1 work, so no Stop-the-World escalation is warranted.

---

## 9. Stub Detection

### 9.1 Registry cross-validation — active debts (3 entries, all 🟡 non-blocking)

| ID | Registry claim | Code reality (measured today) | Verdict |
|---|---|---|---|
| **DEBT-008** | 4 citation/source-phrase inaccuracies, zero behavioural impact; lines `extension.ts:224` / `:2173`, `session-host.ts:43`, `auto-start-orchestrator.ts:36` | **All four line numbers are still accurate.** `extension.ts:224` = `* Read this extension's settings (AD-10).`; `extension.ts:2173` = `* Read the \`dsh.nodeBin\` Node executable setting (AD-10).`; `session-host.ts:43` = `* Class of a failed {@link IdeSessionHost.start}, identical to the`; `auto-start-orchestrator.ts:36` = `* the \`HostStartErrorKind\` vocabulary \`IdeSessionHost.start\` throws with, so a` | ✅ **CONFIRMED as described.** Target Phase is already `phase-2-host-fail-loud-diagnostics` (user-adjudicated merge). Both files are in `primary_files` → fix here |
| **DEBT-009** | `phases/phase-1-node-env-preflight/implementation.md` §2.3 mis-classified `.cursor/skills/project-build/SKILL.md`; the tool tree is intentionally not committed | Artifact-side debt (a `.specdev` document), **outside** this Phase's `primary_files`; `.cursor/skills/project-build/SKILL.md` **is** currently modified in the working tree (`git status -s` line 1) ✅ CONFIRMED | ✅ **Not this Phase's obligation** — do not attempt to fix it here; do **not** `git add` the `.cursor/` tree (§7.8 / `AGENTS.md`: Phase commits conventionally exclude `.cursor/`) |
| **DEBT-004** | ide-profile main session is not writable; user decided this workflow will not fix it (route A bypasses it) | Fully outside `apps/vscode-dsh` and `packages/sdk/client`; no file named in the entry is in `primary_files` | ✅ **Out of scope** — must remain visible in HG-3 reporting, not resolved here |

### 9.2 DEBT-008 detail — the exact fix list (F-3 landing, zero behaviour change)

| # | Location | Current text | Required text |
|---:|---|---|---|
| 1 | `extension.ts:224` | `Read this extension's settings (AD-10).` | `(AD-9)` — `design.md:225` AD-9 = "provide the `dsh.nodeBin` VS Code setting + three-level fail-loud chain" |
| 2 | `extension.ts:2173` | `Read the \`dsh.nodeBin\` Node executable setting (AD-10).` | `(AD-9)` |
| 3 | `session-host.ts:43-44` | "Class of a failed `{@link IdeSessionHost.start}`" — the source phrase does **not** cover `invalid-setting`, which is thrown at the `StartHostPort` layer by `extension.ts:2185` | Widen to cover both: e.g. "Class of a failed Host start, thrown by `IdeSessionHost.start` or its `StartHostPort`" |
| 4 | `auto-start-orchestrator.ts:36` | "the `HostStartErrorKind` vocabulary `IdeSessionHost.start` throws with" | Same widening; and the vocabulary itself must now also mention the Phase-2 members |

> Verification anchor for the reviewer: `design.md:225` = AD-9, `design.md:243` = AD-10 (documented landing for AC-2/AC-3). Both verified in this session ✅. Also note `session-host.ts:48-50` **already** documents `invalid-setting` as a member — only the **source phrase** is stale, so this is a comment-fidelity fix, not a vocabulary fix.

### 9.3 Unregistered-stub scan over the Phase-2 surface

Searched inside the Phase-2 surface for `@STUB`, empty implementations, hardcoded returns, and `// TODO: wire`. **Result: no unregistered stubs found.** ✅ CONFIRMED

| Location | Pattern | Verdict |
|---|---|---|
| `session-host.ts:329` | `throw new HostStartError('process-failed', …)` absorbing 5 distinct boundaries | **Not a stub** — it is the *precisely documented* generic member (`session-host.ts:50-51`, AD-4 `design.md:186`). Phase 2 is the change that **splits** it; no debt entry is required, and DEBT-006 (the analogous `invalid-setting` split) is already resolved |
| `session-host.ts:815` | `this.client = undefined` after teardown | Not a stub — deliberate dispose semantics |
| `connection-ui.ts:134-138` | `default:` with `const _exhaustive: never` | Not a stub — an exhaustiveness assertion (`design.md:184` relies on this switch for `failed` rendering) |
| `auto-start-orchestrator.ts:57-60` | `for…of` scan with trailing `return 'process-failed'` | Not a stub — the documented "unrecognised `kind` ⇒ generic member" policy (`:45-52`) |
| `packages/sdk/client/src/client.ts:318-319` | `/* v8 ignore next */` + throw | Not a stub — a coverage-directed unreachable branch |
| `host-diagnostics.ts` | — | File does not exist ⇒ nothing to scan |
| Phase-2 test files | — | `host-diagnostics.spec.ts` does not exist yet |

**Boundary**: this scan covered only the Phase-2 surface. It is **not** a repo-wide stub sweep, and it deliberately makes no claim about `packages/**` files outside `packages/sdk/client`.

### 9.4 Registry hygiene note for the implementer

Because DEBT-008's target Phase is already `phase-2-host-fail-loud-diagnostics`, the correct end state after the fix is: **move DEBT-008 from 「活跃债务」 to 「已解决」** with the verification method (the four citation sites now read `AD-9` / the widened source phrase) — do **not** open a new entry, and do **not** claim DEBT-004/009.

---

## 10. Recommended Next Reads

Priority order for the implementer (each is cheap and removes a known unknown):

1. `apps/vscode-dsh/src/session-host.ts:255-330` — the `start()` body and the catch that must be restructured (the single most important read).
2. `apps/vscode-dsh/src/session-host.ts:560-640` + `:786-820` — `shutdown()`/`watchTransport`/`onTransportDeath`/`shutdownInternal`, for §7.2 and the `this.client = undefined` ordering trap.
3. `packages/sdk/client/src/client.ts:186-270` and `:440-476` — the field capture + the single `closedError` construction point (AD-5 wants both to come from one place).
4. `.specdev/.../phase-2-host-fail-loud-diagnostics/spec.md:44-63` — the AC table **and** the boundary/negative-case list; the contract test and the version-branching cases are literally enumerated there.
5. `.specdev/.../design.md:289-332` (AD-14) — the 18-field table plus decisions 9-12 (version policy) — replicated in §3.2 here.
6. `apps/vscode-dsh/src/extension.ts:950-1156` — the entire `testDisposables.push(…)` block, to see the established style for a new `dsh.test.*` command and where to insert it.
7. `apps/vscode-dsh/src/extension.ts:391-405` + `:2210-2284` — wiring and the `StartHostPort` hop (where `invalid-setting` originates).
8. `apps/vscode-dsh/tests/node-env-guard.spec.ts:576-748` — the canonical activation + snapshot-assertion pattern (`makeVscode` / `activateWith` / `dsh.test.requestStart`), including the existing `node-environment` and `invalid-setting` snapshot assertions to mirror for the new kinds.
9. `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` — the fake runtime's knobs, needed for AC-15 (never answers `initialize`), AC-17 (25 stderr lines then `exit(1)`), AC-18(a) (`exit(7)`) and AC-18(b) (SIGTERM self-kill).
10. `apps/vscode-dsh/src/interaction-coordinator.ts:56-90` + `:188-199` + `:227-260` — projection + `ApprovalEntry` (confirm `toolName`/`reason` are already stored).
11. `apps/vscode-dsh/src/connection-ui.ts:115-161` — to confirm AC-19/AC-20 need **no** production change (regression assertions only).
12. `apps/vscode-dsh/package.json` (`contributes.commands` / `contributes.configuration`) — before adding `dsh.showHostDiagnostics`.
13. `.specdev/.../tech-debt-registry.md:24-36` — the active table + the rules block, before touching DEBT-008.
14. `.specdev/.../phases/phase-1-node-env-preflight/implementation.md` — Phase-1's own record of how the `invalid-setting` split was done (the closest precedent for this Phase's splits).

---

## Appendix A — Inherited-debt cross-validation summary

| Item | Claim | Verdict | Action for Phase 2 |
|---|---|---|---|
| DEBT-004 | ide profile not writable; not fixed in this workflow | ✅ out of scope | none (must stay visible at HG-3) |
| DEBT-008 (E-1) | `extension.ts:224`, `:2173` cite `(AD-10)`, should be `(AD-9)` | ✅ **CONFIRMED**, lines accurate | fix both citations |
| DEBT-008 (E-2) | `session-host.ts:43`, `auto-start-orchestrator.ts:36` source phrases omit the `StartHostPort` layer | ✅ **CONFIRMED**, lines accurate | widen both phrases (and mention the Phase-2 members) |
| DEBT-009 | Phase-1 `implementation.md` §2.3 mis-classification | ✅ real but **out of this Phase's surface** | none here; do not commit `.cursor/` |
| F-1 | stale `errorKind === 'process-failed'` assertion in `v3-e2e-preflight.mts` | ✅ **FIXED** (`:240` now `invalid-setting`; `:173` is a legitimate positive-control disjunct) | none; do not "fix" `:173` |
| F-3 (1) `invalid-setting` mapping branch | ✅ already done in Phase 1 | do not regress; keep it a distinct member |
| F-3 (2) narrow by `kind` before reading `.diagnostic` | ⚠️ no existing product reader → lands in new code | guard the read in the new mapping |
| F-3 (3) `resolvedExecutable` absoluteness only for `process-exec-path` | ✅ CONFIRMED at `launch.ts:131-145` | decide + document (§7.6) |
| Phase Entry Gate | "target Phase = phase-2 AND 🔴 blocking" ⇒ expected empty | ✅ registry has 3 active entries, **all 🟡 non-blocking** → inherited blocking debt = **empty** (consistent with `current-status.json` D-HG3-6) | proceed |

---

## Appendix B — Environment facts & gate baselines (measured 2026-09-15, HEAD `5307eec361`)

### B.1 Environment

| Item | Value |
|---|---|
| Node in `PATH` (default) | `v20.16.0` — **not qualified** (fails `engines.node ^22.19.0 \|\| >=24.0.0`) |
| Qualified Node | `/usr/local/n/versions/node/24.3.0/bin/node` (matches `.nvmrc` = `24.3.0`) |
| Prefix for every `pnpm` command | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH` |
| pnpm | `11.7.0` |
| git | `2.50.1` → the historical `--config.verify-deps-before-run=false` workaround is **no longer needed** at this version; package-manager scripts ran normally in this session ✅ |
| Branch / HEAD | `new/vscode-dsh` / `5307eec361` "Phase phase-1-node-env-preflight: …" |
| `impl-phase-2-…` branch | **absent** (see §7.8) |
| Working tree | dirty (`.specdev/**`, `AGENTS.md`, `.cursor/**`, `pnpm-lock.yaml`, `apps/vscode-dsh/webview/dist/**` etc.) — HG-3 must list changed files explicitly, never `git add -A` |

### B.2 Gate baselines — all four gates are **RED at baseline** except the SDK-client suite

The differential rule for this Phase is **zero new failures**, not all-green (`phase-plan.md:138`, `spec.md`).

| Gate | Baseline (measured today) | Notes for the implementer |
|---|---|---|
| `pnpm run lint` | **exit 1**, **10 381** `error`-level diagnostics across **262 distinct files** | matches the figure recorded in `current-status.json` ("lint 按权威 `.oxlintrc.json` 10381 条"). `tsc -b tsconfig.host.json` inside `lint` **succeeded** (tsdown ran afterwards) |
| `pnpm run test apps/vscode-dsh` | **exit 0 but red**: `Test Files 4 failed \| 46 passed (50)`; `Tests 6 failed \| 351 passed \| 1 skipped (358)`; 4 unhandled errors; root cause traced to `scripts/test-invariants.ts:188` | full log at `/tmp/p2-baseline-vscode-dsh.txt`. The implementer must add `host-diagnostics.spec.ts` **without** growing the failed set |
| `pnpm run test packages/sdk/client` | **exit 0, green**: `Test Files 3 passed (3)`; `Tests 84 passed (84)` | full log at `/tmp/p2-baseline-sdkclient.txt`. This suite must stay green, and `client.ts` must stay at per-file 100% coverage |
| `pnpm run test:docs` | **exit 1**, `run-gates: 9 passed, 6 failed` | the 6 failing gates: `markdown links`, `translation pairing`, `markdown wrap`, `agent note format`, `doc budgets`, `documentation standard tests`. **`verify-export-jsdoc` is in the passing set** → a new export without JSDoc would be a **NEW** failure |

#### B.2.1 Pre-existing lint diagnostics **inside Phase-2 `primary_files`** (do not attribute these to your change, and do not necessarily fix them)

| File | Count | Lines (rule) |
|---|:--:|---|
| `apps/vscode-dsh/src/extension.ts` | 22 | `:2109:1`, `:2110:1`, `:2111:1` (`@stylistic(indent)`); `:271:17` (`no-unnecessary-type-parameters`); `:375:27`, `:380:29`, `:385:28` (`no-confusing-void-expression`); `:407:50`, `:662:16`, `:750:18`, `:1102:48`, `:2272:9`, `:2274:9` (`no-unnecessary-condition`); `:425:39`, `:1418:41`, `:1450:53`, `:1492:49`, `:1534:36`, `:1791:5` (`require-await`); `:1004:76` (`no-base-to-string`); `:1152:26` (`no-unnecessary-boolean-literal-compare`); `:2109:45` (`unbound-method`) |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | 9 | `:233:24`, `:411:54` (`arrow-parens`); `:328:25` (`no-non-null-assertion`); `:394:13`, `:421:15`, `:425:13`, `:446:13`, `:449:13` (`no-unnecessary-condition`); `:412:62` (`no-confusing-void-expression`) |
| `apps/vscode-dsh/src/connection-ui.ts` | 2 | `:77:34` (`unbound-method`); `:154:21` (`no-unnecessary-condition`) |
| `apps/vscode-dsh/src/session-host.ts` | 1 | `:597:3` (`require-await`) |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 1 | `:236:24` (`no-non-null-assertion`) |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | 4 | `:53:9`, `:96:9` (`prefer-const`); `:52:39`, `:95:36` (`arrow-parens`) |
| `apps/vscode-dsh/src/host-diagnostics.ts` | 0 | file does not exist |
| `packages/sdk/client/src/client.ts` | **0** | clean today → any new diagnostic here **is** a new failure |
| `packages/sdk/client/src/launch.ts` | **0** | clean |
| `apps/vscode-dsh/src/redact.ts` | **0** | clean |
| `apps/vscode-dsh/tests/session-host.spec.ts` | **0** | clean |
| `packages/sdk/client/tests/sdk-client.spec.ts` | **0** | clean |

> Differential method used by Phase 1 and expected again here: take `git diff -U0` and check that **added lines** produce zero new diagnostics, rather than requiring the global count to drop.

### B.3 Reproduction commands for every fact in this report

```bash
# environment
node --version; cat .nvmrc; git --version
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm --version
git branch --show-current; git log -1 --oneline; git branch --list 'impl-*'

# baselines
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run lint            # → exit 1, 10381 errors / 262 files
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test apps/vscode-dsh   # → 4 failed files / 6 failed tests
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test packages/sdk/client  # → 3 files / 84 tests green
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test:docs       # → 9 passed / 6 failed
```

---

*End of Phase 2 repo exploration. §11 (UI / Design System Inventory) is intentionally omitted because `ui: false` for this Phase.*
