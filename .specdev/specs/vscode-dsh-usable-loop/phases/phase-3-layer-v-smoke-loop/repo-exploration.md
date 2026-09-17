# Repository Exploration Report — 真机脚本化冒烟闭环（Phase 3 / phase-level mode）

- Workflow: `vscode-dsh-usable-loop`
- Phase: `phase-3-layer-v-smoke-loop`（Layer V — VS Code Extension Development Host smoke loop，run from repo root）
- Mode: **phase-level**（`.specdev/specs/vscode-dsh-usable-loop/current-status.json:8` → `"current_phase": "phase-3-layer-v-smoke-loop"`）
- `ui: false`（`.specdev/specs/vscode-dsh-usable-loop/phase-plan.md` DAG JSON `phase-3-layer-v-smoke-loop.ui = false`）→ **no §11 UI / Design System Inventory**
- Explorer discipline: read-only. **No product code, config, `.gitignore`, README or test file was modified.** Only this report and its Chinese twin were written.

Confidence legend: ✅ CONFIRMED (function body / file content read) · ⚠️ HYPOTHESIS (signature or secondary evidence only) · ❓ UNKNOWN (not verifiable in this pass).

---

## 1. Task Context

Phase 3 builds the **only真机 (real-machine) proof layer** of this workflow: a scripted smoke loop that drives a real VS Code Extension Development Host (EDH) through 启动 → 新建会话 → prompt 真实模型往返 → 审批 → Diff, capturing per-step screenshots plus machine-readable state JSON, and — new for this Phase — a **native diff (route A)** shadow-preset pipeline that must not touch the shipped preset source tree.

Concretely the Phase must deliver (13 ACs, `spec.md` §Acceptance Criteria):

- an idempotent entry script `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` that rebuilds artifacts, resolves a qualified Node, launches the Host with a strictly bounded `PATH`, executes 6 steps in one process, and always exits `0` (outcome carried by `result` JSON only);
- two `dsh.test.*` hooks that **do not exist yet** (`dsh.test.answerApproval`) plus one **new coordinator method** (`InteractionCoordinator.resolveApproval`);
- a route-A native-diff pipeline: sandboxed `HOME` + compile-time profile user-patch layer (`PATH` prefix) + a **generated shadow copy** of `specdev-orchestrator` (the shipped preset source must stay byte-identical);
- repo hygiene: `apps/vscode-dsh/test-artifacts/` gitignored, `.specdev/specs/<slug>/artifact-index.md` git-tracked;
- **scope amendment 01**: fix `DEBT-010` (post-handshake failures never reach the host diagnostic channel) inside this Phase — adding a third `HostDiagnosticRecord.phase` member, bumping `HOST_DIAGNOSTIC_SCHEMA_VERSION` 1 → 2, and adding the two missing `record()` call sites.

This report maps the repository reality for every one of those work items, and flags the points where the spec's assumptions and the repository (or a sibling authoritative document) do not line up.

---

## 2. Repository Overview

| Item | Value | Evidence |
|---|---|---|
| VCS / root | `/workspace/chendecheng/code/need/deepseek/deepseek-harness` | cwd of this session |
| Language / module | TypeScript, pnpm monorepo | root `package.json`; `pnpm-workspace.yaml` present (workspace globs) |
| Extension app | `apps/vscode-dsh/` (VS Code extension, host code + webview + tests + test-scripts) | `apps/vscode-dsh/package.json:32` |
| Extension entry | `apps/vscode-dsh/src/extension.ts` (single large host file) | `apps/vscode-dsh/package.json` `main` |
| Host session core | `apps/vscode-dsh/src/session-host.ts` (`IdeSessionHost`) | `session-host.ts:408`, `:721` |
| Default interpreter on this box | `node -v` → **v20.16.0** | shell check (this session) |
| Qualified interpreters installed | `/usr/local/n/versions/node/22.9.0`, `/usr/local/n/versions/node/24.3.0` | `ls /usr/local/n/versions/node/` |
| Display available now | `DISPLAY=:1`; `/usr/bin/Xvfb`, `/usr/bin/xvfb-run` present | shell check |
| Screenshot/record tools | `ffmpeg`, `gnome-screenshot` present; `import`, `convert`, `scrot`, `xdotool` **absent** | shell check (`command -v`) |
| Sandbox primitive | `bwrap` present | shell check |
| Test runner | Vitest specs under `apps/vscode-dsh/tests/**` (incl. `tests/verifier-phase1/`, `tests/verifier-phase2/`) | directory listing |
| Gate aggregator | `scripts/run-gates.ts` (`doc-quick` mode) | `scripts/run-gates.ts:150` |
| Workflow state | `current_stage: phase-implementation`, `hg3: pending` | `.specdev/specs/vscode-dsh-usable-loop/current-status.json` |

Working tree note: Phase 1 + Phase 2 outputs are already merged (they live in the same tree this session reads), so nothing in this Phase starts from an empty baseline.

---

## 3. Most Relevant Areas

All entries verified by opening the file (👁 manual exploration; no code-map tool was used — `code2prompt` was not invoked because the Phase scope is a bounded ~20-file surface).

### 3.1 Test scripts (`apps/vscode-dsh/test-scripts/`)

| Path | What it is | Evidence |
|---|---|---|
| `test-scripts/run-chat-ready-regression.sh` | **The precedent** for entry-point convention + `PATH` prefixing | `:4` (`Run from repo root: bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`), `:9` (`export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH}"`) |
| `test-scripts/` full listing | Only `run-chat-ready-regression.sh` + Phase 2 verifier artifacts (`verifier-*.ts`); **no `layer-v-driver/`**, **no `layer-v-shadow-preset.sh`**, **no `run-layer-v-smoke.sh`** | `ls -la test-scripts/` |
| `test-artifacts/` | **Does not exist yet** | `ls apps/vscode-dsh/test-artifacts` → not found; `git check-ignore -v apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt` → exit 1 (not ignored) |

### 3.2 Extension host test surface (`apps/vscode-dsh/src/extension.ts`)

| Item | Reality | Evidence |
|---|---|---|
| Test-hook gate | `shouldRegisterTestHooks()` returns `process.env.VSCODE_DSH_TEST === '1' \|\| … === 'true' \|\| options.vscodeArg !== undefined` | `extension.ts:2212-2215` |
| Gate consumer | `if (shouldRegisterTestHooks()) { … registerTestHooks … }` | `extension.ts:916-917` |
| `dsh.reviewWorkspaceDiffs` | registered | `:872`; used at `:884` (safe host port) and `:1521` (test hook) |
| `dsh.test.*` hooks present | `sendPrompt:1011`, `listPendingInteractions:1097`, `getDiagnosticsText:1107`, `getStartState:1175`, `fireConversationVisibility:1190`, `triggerAutoReady:1201`, `requestStart`, `injectDisconnect`, `diffAvailability`, … (31 unique `dsh.test.*` literals in `src/`) | grep + line reads |
| `dsh.test.answerApproval` | **absent** (grep across the app: zero hits) | `grep -rn "answerApproval" apps/vscode-dsh/` → 0 |
| Command-id census | 61 unique `'dsh.*'` literals in `src/` (some are settings/context keys, e.g. `dsh.nodeBin`, `dsh.chat.focus`); 53 `registerCommand(` calls in `extension.ts` | grep counts |
| `readNodeBinSetting` / setting plumbing | defined `:2253`, read `:2335`, passed into `next.start` `:2338` | line reads |

### 3.3 Approval coordination (`apps/vscode-dsh/src/interaction-coordinator.ts`)

| Item | Reality | Evidence |
|---|---|---|
| `InteractionCoordinator.resolveApproval` | **does not exist** (no such method; class methods are `listPending`, `projectEntry`, `handleApproval`, `finishApproval`, …) | `grep -n "resolveApproval" src/interaction-coordinator.ts` → 0 |
| Whole-class public surface | `class InteractionCoordinator` methods enumerated | `:171`, `:197`, `:208`, `:256`, `:488` |
| `listPendingInteractions` projection already carries both fields Phase 3 step 4 needs | `toolName`, `reason` present in the approval projection | `:225-227` |
| Approval frame ingestion also carries them | `handleApproval` destructures `toolName` / `reason` off the frame | `:260-261` |

### 3.4 Host diagnostics (`apps/vscode-dsh/src/host-diagnostics.ts`)

| Item | Reality | Evidence |
|---|---|---|
| `HOST_DIAGNOSTIC_SCHEMA_VERSION` | `= 1` | `:20` |
| `HostDiagnosticRecord` field count | **18 fields** including `schemaVersion`, `resolvedExecutable`, `source` | `:62-81` |
| `resolvedExecutable` semantics | absolute only when the source is absolute; otherwise stored as-is | `:76-81` |
| `source` vocabulary | `dsh-node-bin` / `vscode-setting` / `process-exec-path` (external `NodeExecutableSource`) | `host-diagnostics.ts:79`; companion `NodeExecutableSource` enum in the SDK client |
| `records()` | returns the in-memory store (`readonly HostDiagnosticRecord[]`), empty unless `record()` pushed | `:385` |
| **`onStartSucceeded()`** | **body is only `chainStartSeq = null`** — emits **no** record | `:341-343` |
| `record()` call sites in app code | 3 total: `session-host.ts:451` (start failure, pre-`bridge.listen`), `host-diagnostics.ts:293` (start-failure listener snapshot), `extension.ts:2368` (safe host-port start catch) | grep `.record(` |
| Retry chain | `nextAttempt()` stitches `attempt` / `previousKind` / `previousFailureAt` from the previous **failure** record; `chainStartSeq` only exists after a failure | `:356-383` |

### 3.5 Node gating & session start (`apps/vscode-dsh/src/node-env-guard.ts`, `session-host.ts`)

| Item | Reality | Evidence |
|---|---|---|
| `validateNodeEnvironment` / `assertNodeExecutable` | real implementations (spawn + API assertions), exported with `EXPECTED_NODE_RANGE`, `DSH_NODE_BIN_VARIABLE`, `NODE_BIN_SETTING`, `REQUIRED_NODE_APIS` | `node-env-guard.ts:115`, `:155` |
| Start-time resolution chain | `resolveNodeExecutableSpec(...)` → `nodeBinSetting` | `session-host.ts:408-409` |
| Failure recording inside `start()` | `catch` → `diagnostics.record({ phase: 'pre-handshake', kind: 'node-environment', nodeExecutable, source, message })` | `session-host.ts:447-453` |
| **Post-handshake death** | `onTransportDeath` → `session.failClosedAll(...)` + log, **no diagnostics call** | `session-host.ts:721-757` |
| Auto-start failure path | `catch (err) { … output log only … }` | `auto-start-orchestrator.ts:225-229` |
| `HOME` scrub before spawn | `env.ts` provides `withoutNodeInjectionOverrides` / `augmentedPath` | `apps/vscode-dsh/src/env.ts:39-58`, `:60-78` |
| Existing diagnostics spec | asserts version literal `1` and the 18-field contract | `tests/host-diagnostics.spec.ts:16`, `:141`, `:183-184` |

### 3.6 Preset / profile overlay surface

| Item | Reality | Evidence |
|---|---|---|
| `specdev-orchestrator` row the generator must assert | `- id: orchestrator-tool-policy` + `name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'` | `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml:28-29` |
| Tool narrowing constant | `ORCHESTRATOR_ALLOW = ['read','read_image','grep','glob','bash']`; `ORCHESTRATOR_WRITE_BLOCK = ['write','edit','str_replace_editor']` | `packages/specdev/specdev-presets/src/tool-policy.ts:21-27`, `:30` |
| Agent-preset overlay config | `agent-presets` row in the **SDK-app** patch (not the IDE patch) carries `default` / `includeShippedRoot` / `includeUserRoot` / `roots` | `packages/bundle/sdk-app/cordis.patch.yml:46-55` |
| **IDE** patch | 15 lines, **no `agent-presets` row** | `packages/bundle/ide/cordis.patch.yml:1-15` (whole file) |
| Preset discovery precedence | `discoverPresets()` — earlier root wins a duplicate id (**first-root-wins**) | `packages/preset/agent-presets/src/discovery.ts:325-343` (esp. `:336-341`) |

### 3.7 Sandbox / diff-generation primitives

| Item | Reality | Evidence |
|---|---|---|
| `workspace-write` policy | RW = `workspaceRoot` (+ `--tmpfs /tmp`); **`/var/tmp` stays RO** | `packages/sandbox/sandbox-local/src/profiles.ts:19-20` |
| Escalation approval shape | `approveEscalation` builds `reason: 'escalate sandbox to <mode>: <justification>'` and routes through `approval.approver.request` | `packages/sandbox/sandbox/src/escalation.ts:157-179` |
| `write` tool diff meta | `before === null` → `diffs: []`; else computed hunks | `packages/fs/tool-fs/src/write.ts:94-99` |
| `edit` tool diff meta | `presentationMeta` → `computeHunkDiffs(before, after)` | `packages/fs/tool-fs/src/edit.ts:106-109` |
| `str_replace_editor` | emits `presentCall` only — **no `presentationMeta`** | `packages/fs/tool-str-replace-editor/src/index.ts:497` |
| Timeline diff consumer | `writeDiffsForSessionTree` (timeline entry diffs) | `apps/vscode-dsh/src/timeline.ts` |

### 3.8 Repo hygiene & docs

| Item | Reality | Evidence |
|---|---|---|
| `.gitignore` | 47 lines, no `test-artifacts` rule; `.specdev/` only partially ignored | `.gitignore:1-47` (esp. `:45-47` for the local-state block) |
| `artifact-index.md` | **does not exist**; path is *not* ignored (trackable) | `ls .specdev/specs/vscode-dsh-usable-loop/artifact-index.md` → missing; `git check-ignore` → exit 1 |
| Root scripts needed by the smoke script | `build:lib:host`, `webview:build`, `test:docs`, `typecheck`, `lint`, `test`, `doc-sync`, `hygiene` all exist | root `package.json:20-40`, `:94`, `:146-147` |
| App scripts | `webview:build`, `build:host`, `vscode:prepublish`, `prepublishOnly` | `apps/vscode-dsh/package.json:30-34` |
| `dsh.nodeBin` setting | declared in `contributes.configuration` | `apps/vscode-dsh/package.json:56-65` + `:125` |
| Bilingual docs pairing | `apps/vscode-dsh/README.md` ✅ and `apps/vscode-dsh/README.zh.md` ✅ exist; **`apps/vscode-dsh/README.i18n.yaml` does not exist** | `ls apps/vscode-dsh/README*` → only the two `.md` |
| Pairing script contract | `source <-> .zh.md <-> .i18n.yaml` enforced over the pairing corpus; only 8 manifest exclusions | `scripts/verify-translation-pairing.ts` (`isTranslationScopeFile`, `TRANSLATION_SCOPE_GLOB_EXCLUDES`), `scripts/translation-pairing.ts:132`, manifest lists 8 files |
| Doc gate wiring | `doc-quick` runs `verify-translation-pairing` + `verify-doc-refs` + `doc-standard-tests` + `docs-site-projection` | `scripts/run-gates.ts:150`, `:730`, `:738`, `:750`, `:754` |

### 3.9 Verifier artifacts already in the tree (not product code)

| Path | Nature |
|---|---|
| `apps/vscode-dsh/tests/verifier-phase1/` (`layer-a-rtl.spec.tsx`, `layer-b-lifecycle.spec.ts`, `layer-c-*.spec.ts`) | Phase 1 verifier products |
| `apps/vscode-dsh/tests/verifier-phase2/` (`layer-a-rtl.spec.tsx`, `layer-b-host.spec.ts`) | Phase 2 verifier products |
| `apps/vscode-dsh/test-scripts/verifier-*.ts` | Phase 1/2 verifier drivers |

Phase 3's own verifier will add `tests/verifier-phase3/` + `test-scripts/verifier-*.ts` in the same pattern; these must **not** be treated as product code by the implementer.

---

## 4. Key Entry Points / Call Paths

### 4.1 Path A — the smoke loop itself (what Phase 3 creates)

```
bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh          [NEW; convention from run-chat-ready-regression.sh:4]
  1. clear + rebuild release:lib + vscode-dsh webview/extension  (root package.json:23, apps/vscode-dsh/package.json:30-32)
  2. generate the shadow preset                                [NEW; reads + must NOT modify
                                                                 packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml:28-29]
  3. pick a qualified Node (never the default v20.16.0)         ← /usr/local/n/versions/node/24.3.0
  4. launch EDH: PATH strictly bounded to the qualified node dir + /usr/bin:/bin
       + profile user-patch layer (PATH prefix, compile-time)
       + HOME redirected to a disposable per-run directory      (sandbox-local works on this box: bwrap present)
  5. inside the Host, one process drives steps 1..6 through dsh.test.* hooks
  6. per-step: evidence PNG + state JSON → apps/vscode-dsh/test-artifacts/layer-v/step-<n>/
  7. always exit 0; outcome only in result JSON
```

### 4.2 Path B — how the Host actually starts (and when a diagnostic record exists)

```
dsh.test.requestStart  (extension.ts:1175 area)
   └─> IdeSessionHost.start()
         ├─ resolveNodeExecutableSpec(...)  → { source, executable }   session-host.ts:408
         ├─ nodeBinSetting                                                session-host.ts:409
         ├─ assertNodeExecutable(...)         node-env-guard.ts:155  ─┐
         │                                                             │ failure only
         │        ×  failure ──> catch ──> diagnostics.record({phase:'pre-handshake', …})   session-host.ts:447-453
         └─ bridge.listen() ─> HarnessClient.start() ─> initialize
                  │
                  ├─ success ──> diagnostics.onStartSucceeded()   host-diagnostics.ts:341-343  ← stores NOTHING
                  │
                  └─ transport death ──> onTransportDeath ──> failClosedAll(...)   session-host.ts:721-757  ← records NOTHING  (DEBT-010)
                                                                                                └─> test-scripts/run-layer-v-smoke.sh

read side: dsh.test.getDiagnosticsText  (extension.ts:1107)  →  HostDiagnostics.records()  (host-diagnostics.ts:385)
```

**This is the single most important call path for the Phase**: `dsh.test.getDiagnosticsText()` returns `[]` in a run where nothing failed.

### 4.3 Path C — route A native diff (Approach 8)

```
HOME redirection (disposable dir)                         ← keeps the user profile isolated
  └─> compile-time profile user-patch layer (PATH prefix)  ← profile overlay, not preset editing
        └─> agent-presets roots (config: packages/bundle/sdk-app/cordis.patch.yml:46-55)
              ├─ root #1 (shipped set)  → specdev-orchestrator HAS the orchestrator-tool-policy row
              │                            (…/agent.cordis.yml:28-29) → so shipped tool set excludes write/edit
              └─ root #2 (user patched layer, earlier precedence) → SHADOW copy, id collision → wins
                   per discoverPresets() first-root-wins        (packages/preset/agent-presets/src/discovery.ts:325-343)
                     └─> shadow copy has the row removed → write/edit join the window
                           └─> model calls edit/write
                                 ├─ tool-fs write → presentationMeta (before===null → diffs: [])   write.ts:94-99
                                 └─ tool-fs edit  → computeHunkDiffs                              edit.ts:106-109
                                       └─> timeline writeDiffsForSessionTree
                                             └─> dsh.openTimelineDiff  (extension.ts:872 dsh.reviewWorkspaceDiffs; :884, :1521)
                                                   └─> vscode.diff tab → screenshot evidence
```
(`str_replace_editor` participates in the same window but emits no `presentationMeta` — see `tool-str-replace-editor/src/index.ts:497`.)

---

## 5. Likely Impact Surface

### 5.1 New files (no existing behaviour touched)

| Path | Purpose | AC | Risk |
|---|---|---|---|
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` | entry script | AC-10..AC-33 | Medium — the whole Phase hangs on it; must honor `run-chat-ready-regression.sh:4,9` conventions |
| `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh` | generates the shadow preset | AC-24/AC-28/AC-29 | Medium — must be byte-neutral w.r.t. shipped source |
| `apps/vscode-dsh/test-scripts/layer-v-driver/` (+ `package.json` + `extension.js`) | the `dsh.test.*` driver extension | AC-18..AC-22 | Medium — **no `bin` field**, entry referenced by absolute path; must publish profile only when explicitly asked |
| `apps/vscode-dsh/test-artifacts/` (whole tree) | evidence root (must be gitignored) | AC-15/AC-25/AC-32 | Low, but **must add the `.gitignore` rule before any test run** (rule absent today) |
| `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md` | git-trackable artifact index | AC-33 | Low — path is not ignored today (✅ trackable) |
| `apps/vscode-dsh/README.zh.md` + `README.i18n.yaml` | required by the bilingual pairing gate (only if the Phase re-records `README.md`) | AC-13/AC-14 evidence | Medium — see §7 R3 |

### 5.2 Modified files (existing behaviour touched)

| Path | Change | AC | Risk |
|---|---|---|---|
| `apps/vscode-dsh/src/extension.ts` | register `dsh.test.answerApproval`; keep `shouldRegisterTestHooks` semantics (`:2212-2215`) | AC-21/AC-22 | Medium — the hook must not become reachable outside the test gate |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | add `InteractionCoordinator.resolveApproval` (does not exist today) | AC-21 | Medium — must reuse the existing `finishApproval` path (`:488`) rather than re-implementing resolution |
| `apps/vscode-dsh/src/host-diagnostics.ts` | `HOST_DIAGNOSTIC_SCHEMA_VERSION` 1 → 2; `phase` gains a third (post-handshake) member; record site for success/death path | AC-13/AC-14 (amended) | **High** — a contract change; `tests/host-diagnostics.spec.ts:16,141,183-184` pins `1` |
| `apps/vscode-dsh/src/session-host.ts` | `record(...)` inside `onTransportDeath` (`:721-757`) | DEBT-010 (amended) | Medium — must not double-record when a start failure already recorded |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | `record(...)` in the `catch` at `:225-229` | DEBT-010 (amended) | Medium — same double-record concern |
| `.gitignore` | add `apps/vscode-dsh/test-artifacts/` (natural home: the local-state block at `:45-47`) | AC-32 | Low |
| `apps/vscode-dsh/README.md` | re-record the smoke-loop section (if needed) | AC-13/AC-14 | Medium — triggers the pairing gate |
| `apps/vscode-dsh/tests/host-diagnostics.spec.ts` | version literal + third-`phase` expectations | DEBT-010 (amended) | Medium — spec file, not product code, but is the existing guard |

### 5.3 Untouched (verified: no write needed)

`packages/specdev/specdev-presets/presets/specdev-orchestrator/**` (must stay byte-identical), `packages/bundle/ide/cordis.patch.yml`, `packages/bundle/sdk-app/cordis.patch.yml` (read-only consumption of `agent-presets.config`), `packages/sandbox/**` (read-only consumers), the webview (`new/vscode-dsh-conversation-ui` workflow's scope).

---

## 6. Existing Constraints / Conventions

1. **Entry-point + rebuild convention** — every script documents `Run from repo root: bash apps/vscode-dsh/test-scripts/<script>.sh` (`run-chat-ready-regression.sh:4`) and rebuilds extension + webview before launching the Host. Phase 3 must follow this shape.
2. **`PATH` prefix precedent** — `export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH}"` (`run-chat-ready-regression.sh:9`). Phase 3 tightens this to an allowlist (`<node dir>` + `/usr/bin` + `/bin`) instead of an unbounded append.
3. **Test hooks are gated, not public** — all `dsh.test.*` commands live behind `shouldRegisterTestHooks()` (`extension.ts:2212-2215` consumer at `:916-917`), which is driven by `VSCODE_DSH_TEST`. A new hook added in Phase 3 must be registered inside that same block.
4. **Diagnostics contract is versioned and pinned by tests** — 18 fields, `schemaVersion` exported as `HOST_DIAGNOSTIC_SCHEMA_VERSION` (`host-diagnostics.ts:20`), asserted literally in `tests/host-diagnostics.spec.ts:16,141`. Any bump is a repo-wide, test-visible change.
5. **Sandbox truth: `/tmp` is a fresh tmpfs; only `workspaceRoot` is RW** for `workspace-write` (`sandbox-local/src/profiles.ts:19-20`) → `/var/tmp` is necessarily denied. Driver probes must expect a denial, not a write.
6. **Failure-oriented record model** — the recorder is written to be populated by *failures*: `chainStartSeq` only exists after a failure (`:356-383`), `onStartSucceeded()` clears it (`:341-343`), and all three call sites are `catch`/failure-listener paths.
7. **Shipped preset source is frozen** — the tool narrowing for `specdev-orchestrator` is a shipped row (`agent.cordis.yml:28-29` + `tool-policy.ts:21-30`). The intended change mechanism is a **shadow copy discovered first**, enabled by first-root-wins discovery (`packages/preset/agent-presets/src/discovery.ts:325-343`).
8. **Pure-CJS driver constraint (design AD-16 / spec §Hard Constraints)** — `apps/vscode-dsh/package.json` declares `"type": "module"`; a dev-path driver extension must therefore be a JS-only extension (`^1.+.+$\|^\*$\|^$` engines rule, `engines.vscode: ">=1.90.0"`), with **no `bin` field**, loaded by absolute path.
9. **Node quality gate** — the default `node` on this box is **v20.16.0**, which fails the extension's own gate; the qualified interpreter is v24.3.0 (and v22.9.0 also exists). Any new script must not inherit the ambient `node`.
10. **Bilingual doc pairing** — English source, `<name>.zh.md` translation and `<name>.i18n.yaml` metadata must be recorded together; the rule is enforced for the pairing corpus, and only 8 READMEs are exempted by the manifest.
11. **tsconfig discipline** — product code must stay in root-tsconfig typecheck (`NODE_CONFIG_EXCLUDES` in `tsconfig.json` is the documented product boundary); JSON columns/evidence files live under the excluded `test-configs/` and `test-scripts/` roots. A driver extension authored in TS would need to obey this; the design's "pure JS" choice sidesteps it.
12. **Shell strictness has no existing precedent** — `run-chat-ready-regression.sh:5` and `:9` are plain statements; `set -euo pipefail` at line 2 is present only in `scripts/fetch-specdev.sh`. Phase 3's stricter shell requirement is therefore new, not a repository convention.
13. **Verifier-produced test trees** — `tests/verifier-phase1/`, `tests/verifier-phase2/`, `test-scripts/verifier-*.ts` are *verification artifacts kept in-tree*, not product code. Phase 3's implementer must not "fix" them as if they were product.

---

## 7. Risks / Unknowns

### 7.1 🔴 Conflicts found (spec / design vs repository reality)

| # | Finding | Evidence | Impact |
|:--:|---|---|---|
| **R1** | **A green smoke run yields zero diagnostic records, so AC-11(b) and the AC-10 supplemental evidence can only be satisfied if the run *deliberately manufactures* a failure record — no document says how, and nothing in the repository emits a record on a successful path.** `dsh.test.getDiagnosticsText()` returns `[]`; the recorder writes only on failures (`onStartSucceeded()` stores nothing) and has exactly 3 call sites, all failure paths. | `host-diagnostics.ts:341-343` (success stores nothing), `:385` (store only via `record()`); call sites `session-host.ts:451`, `host-diagnostics.ts:293`, `extension.ts:2368`; `spec.md:176` (「…两条字段至少一条必须存在，若返回空数组则判 `HARNESS_ERROR`」), `spec.md:195` (「断言 `dsh.test.getDiagnosticsText` 返回记录中存在 `source === 'vscode-setting'` 且其 `resolvedExecutable` 等于预置路径」) | 🔴 Blocks the implementer: the step-1 evidence extraction has no data source on the happy path. Needs an explicit decision (see escalation) |
| **R2** | **Authoritative-document conflict on the empty case.** `design.md:321` (AD-14 决策 5): 「**数组可为空**：无任何诊断记录时**必须**返回 `[]`（合法空数组）…驱动对 `[]` **必须**视为合法且**不得**对版本做任何断言」; Phase 3 `spec.md:196` agrees (「返回 `[]` 合法且不对版本断言」). But Phase 3 `spec.md:176` AC-11(b) states the opposite (「若返回空数组则判 `HARNESS_ERROR`」), and `spec.md:195` makes the field-level assertion mandatory. Under the documented precedence (`design.md` > `phases/<phase>/spec.md`) design wins — which leaves AC-11(b) / the AC-10 supplemental permanently unpassable as written. | `design.md:321`, `design.md:447` vs `spec.md:176`, `spec.md:195`, `spec.md:196` | 🔴 same decision as R1 |

> **R1 / R2 — the only three ways a record can exist at all** (none of them is specified by any document; listed here so the decision is informed):
> **(a)** the script performs a *deliberate first failing start attempt* (e.g. before credentials are present) and then a successful one, asserting on the failed attempt's record — this uses the existing pre-handshake channel (`session-host.ts:447-453`), and is the option most consistent with "one bounded run";
> **(b)** the script induces a *post-handshake death* (`dsh.test.injectDisconnect` exists, `extension.ts:1214`) after `started`, exercising the amended DEBT-010 channel — but this perturbs the single clean session and the "no history before each step" assertion;
> **(c)** the ACs are amended to accept `[]` for the green path (design.md:321 already says so), dropping the field-level evidence — note this changes AC semantics, which `scope-amendment-01.md` §4 explicitly forbids without user approval.
| **R3** | **The bilingual pairing gate is very likely red at baseline**: `apps/vscode-dsh/README.zh.md` exists but `apps/vscode-dsh/README.i18n.yaml` does **not**, and this README is inside the pairing corpus (only 8 files are manifest-exempt, this is not obviously one of them). So AC-13 must be satisfied by *completing the pair*, not by "re-recording". Could not be executed — `test:docs` cannot run under this session's constraints (see R8). | `ls apps/vscode-dsh/README*`; `scripts/verify-translation-pairing.ts` (`isTranslationScopeFile`, `TRANSLATION_SCOPE_GLOB_EXCLUDES`); `scripts/translation-pairing.ts:132` | ⚠️→ medium: gates may fail for reasons unrelated to the Phase's change |
| **R4** | **AC-11(b)'s assertion branch is stale after amendment 01.** The spec text says the record must have `schemaVersion === 1` and exactly 18 fields; amendment 01 raises the version to 2 and adds a `phase` member. The amendment's own guidance is to use the `schemaVersion > 1` branch and assert only the 18-field **subset** — the spec text was not updated. | Phase 3 `spec.md` AC-11(b) vs `scope-amendment-01.md` §3 | Medium — an implementer reading only the spec will write a failing assertion |
| **R5** | **Line-number drift in the spec's citations.** Spec cites `extension.ts:812` for `dsh.reviewWorkspaceDiffs`; the registration is actually at `:872` (uses `:884`, `:1521`). Also `spec` cites `packages/bundle/ide/cordis.patch.yml` for the `agent-presets` overlay, but that file has no `agent-presets` row — it lives in `packages/bundle/sdk-app/cordis.patch.yml:46-55`. | `extension.ts:872`; `packages/bundle/ide/cordis.patch.yml:1-15`; `packages/bundle/sdk-app/cordis.patch.yml:46-55` | Low — navigation noise, not a blocker |
| **R6** | `resolvedExecutable` is only absolute when the configured value is absolute (`host-diagnostics.ts:76-81`). A relative `dsh.nodeBin` would leave a relative string in the record. | `host-diagnostics.ts:76-81` | Low — writing an absolute path in the driver's settings file removes the ambiguity |
| **R7** | Step 5's write target `apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt` is currently **not ignored** (`git check-ignore` exit 1) and `test-artifacts/` does not exist. | shell checks | Medium — running the script before adding the rule would dirty the tree |
| **R8** | **Gate commands could not be executed in this exploration pass.** The default interpreter is v20.16.0, which lacks a built-in module an earlier gate run required, and pnpm warns that Node ≥ 22.13 is required; running them would have required altering the host `PATH` (outside read-only scope). All gate-related claims above are therefore static-reading evidence, not execution evidence. | this session's attempted gate run (rejected); `node -v` → v20.16.0 | ⚠️ Medium — re-run inside the qualified Node before trusting green |
| **R9** | Command-id census is 61 unique `'dsh.*'` literals / 53 `registerCommand(` in `extension.ts`, against the spec's stated "69 条命令白名单". The delta is explained by non-command ids (`dsh.nodeBin` setting, context keys) and multi-line registrations, so the whitelist cannot be reproduced exactly by grep. | grep counts above | Low — verification of AC-21 should assert presence of the new id, not the total |

### 7.2 ✅ Confirmed environment facts (from the spike, re-checked)

| Fact | Status |
|---|---|
| `DISPLAY=:1` is set in the invoking shell; code paths treat `''` / unset / `:0` as no usable display | ✅ re-checked in this session |
| `/usr/bin/Xvfb`, `/usr/bin/xvfb-run`, `/usr/bin/ffmpeg`, `/usr/bin/gnome-screenshot`, `/usr/bin/bwrap` present | ✅ re-checked |
| `import`, `convert`, `scrot`, `xdotool` absent | ✅ re-checked |
| `/usr/local/n/versions/node/{22.9.0,24.3.0}` exist; default `node` is **v20.16.0** | ✅ re-checked |

### 7.3 ❓ UNKNOWN (must not be assumed downstream)

1. Whether a brand-new dev-path extension can be loaded by an already-built profile without a registry republish — design asserts it works, no execution evidence in this pass.
2. Whether `extensionKind` (ui vs workspace) in a dev path is auto-rewritten by VS Code — design cites `extensionKind.ts:65`; not re-verified here.
3. Whether a resolution chain like `[missing interpreter, present interpreter]` really produces a two-record chain through the recorder in a live Host.
4. Whether the shadow preset actually yields a tool window containing `write`/`edit` at runtime (static chain is coherent: `discovery.ts:336-341` first-root-wins + `tool-policy.ts:21-30`), but the compiled form must read the same `toolPolicyKey` the runtime reads.
5. Actual baseline status of `pnpm run test:docs` / the pairing gate (R3/R8).

---

## 8. Uncertain / Unverified

| Item | Why uncertain | Downstream rule |
|---|---|---|
| `dsh.test.getDiagnosticsText()` payload shape in a *failing* run | Contract read from `records()` + `record()`; no observed payload | Driver must read `schemaVersion` from the payload and adapt, and must tolerate `[]` (pending R1 decision) |
| Exact behaviour of `resolveApproval` once added | Method does not exist; `finishApproval` (`interaction-coordinator.ts:488`) is the likely seam | implementer must read `handleApproval`/`finishApproval` before designing the new method |
| Xvfb route selection (`reuse` vs `xvfb`) inside a live run | Spec/design describe it; not executed | verifier must record which route was taken, not assume |
| Real `p95` timings / timeouts | No run performed | Script must self-time and write timings into `result` JSON; no fixed budget promised |
| `bwrap` usability inside this container for the *driver extension's* probes | `bwrap` exists, but nested-namespace permission in this container is untested | Probe `/var/tmp` denial outcomes must be recorded as data, not asserted as an invariant of the environment |
| Whether the new `phase` member for post-handshake failures changes any existing consumer | Consumers of `phase` were not exhaustively enumerated | implementer must grep `phase` consumers before changing the union |

Note on scope: **no unregistered stubs were found** in the Phase's product surface (`grep -rn "@STUB(\|TODO\|FIXME" apps/vscode-dsh/src apps/vscode-dsh/test-scripts` → 0 hits). The 6 registry debts below are documentation-level facts about *missing* code, not markers planted in the tree.

---

## 9. Stub Detection & Registry Cross-Validation

Cross-validated against `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md` (6 active debts).

| Registry ID | Location / claim | Registry status | Repository reality | Verdict |
|---|---|:--:|---|:--:|
| **DEBT-004** | `packages/specdev/specdev-presets/src/tool-policy.ts:21-27`, `:30` — Orchestrator write-tool policy is engine-level; mechanism to silence it is unproven | 🟡 active, non-blocking | File + lines exist exactly as claimed, with real logic (`ORCHESTRATOR_ALLOW`, `ORCHESTRATOR_WRITE_BLOCK`). The **shadow-preset bypass** is coherent with first-root-wins discovery (`packages/preset/agent-presets/src/discovery.ts:325-343`) but has **no runtime proof** | ✅ 匹配（bypass 未验证 → 本 Phase 的 route A 即其验证手段） |
| **DEBT-009** | `apps/vscode-dsh/src/timeline.ts` — read-only consumer of existing `session.tree` diffs | 🟡 active, non-blocking | No new code required by Phase 3; route A's `meta.diffs` reach the timeline through the existing write path (`write.ts:94-99`, `edit.ts:106-109`) | ✅ 匹配（本 Phase 只需消费，不新建） |
| **DEBT-010** | post-handshake failures never reach the diagnostic channel | 🟡 active → **amended into Phase 3 scope** (`scope-amendment-01.md`) | Both cited locations exist exactly: `session-host.ts:721-757` (`failClosedAll` + log, no `record`) and `auto-start-orchestrator.ts:225-229` (log only). Bumping `HOST_DIAGNOSTIC_SCHEMA_VERSION` (currently `1`, `host-diagnostics.ts:20`) also forces `tests/host-diagnostics.spec.ts:16,141,183-184` to change | ⚠️ Registry mismatch **by design**: registry still lists the old non-blocking form while the amendment re-scopes it to in-Phase work. Implementer must reconcile the entry at closure |
| **DEBT-011** | `extension.ts:2212` `shouldRegisterTestHooks()` is the sole gate | 🟡 active, non-blocking | Function is at `:2212-2215` and additionally returns `true` when `options.vscodeArg !== undefined` — a nuance beyond the registry's one-line description. Consumer at `:916-917` | ⚠️ 部分匹配（描述未含 `vscodeArg` 分支）→ implementer 新增 `dsh.test.answerApproval` 必须落在这个 gate 内 |
| **DEBT-012** | Windows drive-letter branch in `run-chat-ready-regression.sh:4` / `:9` is never exercised | 🟡 active, non-blocking | Both cited lines exist and are the same lines Phase 3 reuses as its convention precedent (`:4` usage banner, `:9` PATH prefix). Phase 3 inherits the same untested-on-Windows property | ✅ 匹配（继承，不新增） |
| **DEBT-013** | `apps/vscode-dsh/src/auto-start-orchestrator.ts:225-229` — failure log not classified | 🟡 active, non-blocking | Lines exist exactly as cited (blanket `catch`). **Same code location as DEBT-010's second fix point** | ⚠️ Registry overlap: fixing DEBT-010 also addresses DEBT-013's surface — closure bookkeeping must not double-count |

### Stub Detection Summary

- ✅ Confirmed stubs matching registry: **6 / 6** locations verified to exist with the cited line ranges.
- ⚠️ Registry mismatch: **3** — DEBT-010 (re-scoped by amendment 01), DEBT-011 (`vscodeArg` branch not described), DEBT-013 (shares a location with DEBT-010).
- 🔴 Unregistered stubs: **0** — no `@STUB(` / `TODO` / `FIXME` markers in `apps/vscode-dsh/src` or `apps/vscode-dsh/test-scripts`.
- Absolute marker scan: `grep -rn "@STUB(\|TODO\|FIXME" apps/vscode-dsh/src apps/vscode-dsh/test-scripts` → **0 hits**.
- **DEBT-010 is the only registry entry that changes this Phase's implementation scope**; it is also the entry that most directly governs how Phase 3 may read `dsh.test.getDiagnosticsText` — its original form is exactly why an empty array is the expected green-run result (see R1).

---

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `.specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/spec.md` (§Acceptance Criteria + §Hard Constraints + §Verification Strategy), read together with `scope-amendment-01.md` (the amendments override AC-11/13/14 text).
2. ⭐ **MUST READ** — `apps/vscode-dsh/src/host-diagnostics.ts` (`:20`, `:62-81`, `:341-343`, `:356-385`) — the recording model is failure-only; everything about AC-11/13/14 evidence hinges on it.
3. ⭐ **MUST READ** — `apps/vscode-dsh/src/interaction-coordinator.ts` (`:197-230`, `:256-270`, `:488`) — where `resolveApproval` must be added and what projection fields already exist.
4. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` (whole file, esp. `:2`, `:4`, `:5`, `:9`) — the entry-point/PATH convention Phase 3 must follow.
5. 🔷 SHOULD READ — `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml` (`:28-29`) + `packages/specdev/specdev-presets/src/tool-policy.ts:21-30` + `packages/preset/agent-presets/src/discovery.ts:325-343` — the exact row to strip and the precedence rule that makes the shadow copy win.
6. 🔷 SHOULD READ — `packages/bundle/sdk-app/cordis.patch.yml:46-55` — the `agent-presets` config keys an overlay must restate in full (`default` / `includeShippedRoot` / `includeUserRoot` / `roots`).
7. 🔷 SHOULD READ — `apps/vscode-dsh/src/extension.ts` (`:872-890`, `:916-917`, `:1011`, `:1097`, `:1107`, `:2212-2215`, `:2335-2340`) — hook registration shapes and the test gate.
8. 🔹 OPTIONAL — `apps/vscode-dsh/src/session-host.ts:400-460`, `:721-757`; `apps/vscode-dsh/src/auto-start-orchestrator.ts:225-229`; `packages/sandbox/sandbox-local/src/profiles.ts:19-20`; `packages/fs/tool-fs/src/write.ts:94-99` / `edit.ts:106-109`.
9. 🔹 OPTIONAL — `.gitignore:1-47`, `apps/vscode-dsh/tests/host-diagnostics.spec.ts:16,141,183-184`, `scripts/verify-translation-pairing.ts` + `scripts/translation-pairing.ts:132` (pairing gate contract).

---

## Appendix — Verification method

- Every `path:line` claim was produced by reading the file in this session (Read tool) or by an explicit shell probe (`grep -n`, `awk 'NR>=…'`, `ls`, `git check-ignore`, `command -v`); no claim is inferred from a filename.
- No product code, config, `.gitignore`, README or test file was written. Only `repo-exploration.md` and `repo-exploration-zh.md` were created.
- Claims that could only be reasoned about statically are labelled ⚠️ HYPOTHESIS / ❓ UNKNOWN and are collected in §7.3 / §8 rather than presented as facts.
