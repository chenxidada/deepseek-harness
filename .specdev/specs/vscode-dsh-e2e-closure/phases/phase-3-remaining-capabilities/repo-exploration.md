# Repository Exploration Report — phase-3-remaining-capabilities (Phase-level)

## 1. Task Context

This phase builds true-machine EDH (Extension Development Host) drivers + screenshots + assertions for the remaining 6 host-side capability groups from the "Real Functional Capability List" (`repo-exploration.md` §12): §12.4 Subagent enter/pin (ids #22–#23), §12.5 Code context (@path / selection-ask, #24–#26), §12.6 Change list (#27–#29), §12.7 Search (#30–#31), §12.10 History (#37–#38), §12.11 Interaction/approval fail-closed (#39–#40). It reuses the Phase 1 framework: `run-layer-v-capabilities.sh` + `layer-v-capabilities.json` manifest + `layer-v-capability-driver/` (pure orchestration `capability-runner.cjs` + host binding `extension.cjs`).

This exploration answers four core questions: (1) which of the six capability groups are fully implemented in `apps/vscode-dsh/src/` (directly drivable via manifest steps) vs. partial / missing test hooks (needing implementer to add hooks); (2) which involve real LLM round-trips (inheriting AC-9) vs. pure host-state operations; (3) which existing `dsh.test.*` hooks cover these and which new hooks are needed; (4) which reusable step templates exist from Phase 1/2.

Headline conclusion: **all 14 target capabilities have complete product implementations ✅**, but the manifest steps are entirely **placeholder / weak assertions** (`listHistory` standing in for search, `openSubagent("__child__")` passing a fake id, `openHistory("")` passing an empty string, `listPendingInteractions` only asserting `$array`). **2 of the 6 groups need the implementer to add new product test hooks** (§12.6 revert, §12.11 interaction injection); the other 4 only require rewriting manifest steps + pre-arranging real sessions/subagents.

## 2. Repository Overview

| Item | Value | Evidence |
|----|----|------|
| Target app | `@deepseek-ai/dsh-vscode-dsh` (VS Code extension, TypeScript ESM) | `apps/vscode-dsh/package.json:2,13` |
| Session runtime | `IdeSessionHost` bridges the `dsh --profile ide` subprocess | `apps/vscode-dsh/src/session-host.ts:430` |
| Driver layer | CJS extension `layer-v-capability-driver/`: `capability-runner.cjs` (pure orchestration, does not import vscode) + `extension.cjs` (binds `vscode.commands` + screenshots) | `capability-runner.cjs:47-48`, `extension.cjs:144-159` |
| manifest | `layer-v-capabilities.json` (41 items, each with `id`/`group`/`ac`/`requiresModel`/`steps`/`evidence`) | `test-scripts/layer-v-capabilities.json` |
| Test-hook gating | `dsh.test.*` registered only when `VSCODE_DSH_TEST=1/true` or vscode is injected | `src/extension.ts:2343-2346` |
| Exit-code contract | 0=PASS / 1=LINK_FAILURE / 2=SKIPPED_NO_DISPLAY / 3=SKIPPED_NO_CREDENTIALS / 4=HARNESS_ERROR | `capability-runner.cjs:66` |

**Step types (already supported by the runner; Phase 3 needs no runner changes)**: `command` / `assert` / `wait` / `stream` (`requireIncrement` increment gate) / `replay` (close tab → `openHistory` reopen as replay) / `screenshot` (`pngVerdict` non-degenerate check) — `capability-runner.cjs:600-772`. Assertions go through the pluggable `MATCHERS` registry (`$string`/`$number`/`$boolean`/`$object`/`$array`/`$array:N`/`$present`), plus inline-parsed `$contains:`/`$assistantContains:`/`$assistantClosed:` — `capability-runner.cjs:321-369`. **"Implementing runStep" in Phase 3 is essentially rewriting the manifest `steps` arrays; only when a new hook is needed does product source code get touched.**

## 3. Most Relevant Areas

### 3.1 §12.4 Subagent (#22–#23, group `subagent`)

| File:line | Content | Hook |
|------|------|------|
| `src/conversation-controller.ts:1758` | `openSubagentContext(childSessionId)`: already-pinned child → `switchTo`; otherwise `ensureChildHydrated` + `setContextSessionId`; returns `{outcome:'opened-context'\|'activated-tab'\|'deleted'\|'missing'\|'host-not-ready'}` | `dsh.test.openSubagent` (`extension.ts:1289`) |
| `src/conversation-controller.ts:1831` | `pinSubagent(childSessionId?)`: promote child to independent tab (`registry.create` + `setPinnedSubagent`); returns `{outcome:'pinned'\|'activated'\|'deleted'\|'missing'}` | `dsh.test.pinSubagent` (`extension.ts:1304`) |
| `src/conversation-controller.ts:1803` | `navBack()`: exit subagent context / return from pinned child tab to parent; returns `{outcome:'restored'\|'noop'\|'disabled'}` | `dsh.test.navBack` (`extension.ts:1297`) |
| `src/conversation-controller.ts:1934` | `applyTestSubagentNotification(phase, parent, child)`: synthesize L2 `subagent.started/finished` to inject a real subagent | `dsh.test.injectSubagent` (`extension.ts:1313`) |

**Verdict**: product implementation ✅ complete; all 4 hooks ✅ exist. **No new hook needed**, but current manifest steps pass a fake id `__child__`, which will necessarily return `missing`/`host-not-ready`; they must be rewritten to "inject a real subagent via `injectSubagent` first, then open/pin/nav".

### 3.2 §12.5 Code context (#24–#26, group `code-context`)

| File:line | Content | Hook |
|------|------|------|
| `src/code-context/at-path.ts:54` | `extractAtPathTokens(text)`: extract `@path`/`@"…"` tokens (pure function, does not read files) | none (only reachable via `prefillComposer` side effect) |
| `src/code-context/at-path.ts:110` | `resolveAtPathInWorkspace(rawPath, opts)`: in-workspace path resolution | none |
| `src/code-context/selection-ask.ts:143` | `askAboutSelection(deps)`: dirty-save → build pointer text → prefill (**does not trigger model round-trip**) | `dsh.test.askAboutSelection` (`extension.ts:1016`) → `runAskAboutSelection` (`extension.ts:2299`) |
| `src/chat-panel/render/ref-cards.ts:23` | `segmentTextWithRefs` / `renderRefCardNodes`: ref-card rendering (`@` token → ref card) | — |
| — | `panelHost.prefillComposer(text)` | `dsh.test.prefillComposer` (`extension.ts:1019`) |

**Verdict**: product implementation ✅ complete; `prefillComposer`/`askAboutSelection` hooks ✅ exist. **However**:
- `@path token` / `workspace-path-resolve` are **pure functions**; `prefillComposer` returns only `{ok:true}`, so the "token was actually extracted/resolved" cannot be asserted. End-to-end assertion requires observing webview ref-card rendering or a new hook → see §7 R3.
- `askAboutSelection` requires an active editor + non-empty selection (`getActiveEditor().selection`); a headless EDH has no active editor by default → necessarily returns `no-editor`/`empty-selection`. It also **only prefills, does not trigger a model round-trip** — see §7 R1.

### 3.3 §12.6 Change list (#27–#29, group `change-list`)

| File:line | Content | Hook |
|------|------|------|
| `src/change/change-index.ts:34,54` | `writeChangeIndex` / `readChangeIndex`: ChangeRecord metadata index persist/cold-read | — |
| `src/change/change-store.ts:19,108` | `ChangeStore.upsert` / `toListPayload`: per-session change index | — |
| `src/change/change-attributor.ts:69,91,153` | `noteToolCall` (before snapshot) / `ingestToolResult` (ingest `meta.diffs`) / `settleTurn` (materialize ChangeRecord + SnapshotStore blob) | — |
| `src/change/snapshot-store.ts:87` | `SnapshotStore.write`: full-file before/after blob | — |
| `src/change/revert.ts:187` | `executeRevert(deps, changeId)`: revert a single change (writes workspace, not a stub) | **no `dsh.test.revert` hook** |
| `src/conversation-controller.ts:1223,1270` | `revertChange` / `revertChanges`: revert orchestration (only reachable via Webview/`reviewWorkspaceDiffs`) | **no hook** |
| `src/conversation-controller.ts:1469` | `changedFileCount(sessionId)`: `timeline.writeDiffsForSession(sessionId).length` | `dsh.test.changedFileCount` (`extension.ts:1135`) |
| `src/chat-panel/render/change-diff-dom.ts:35` | `fillChangeDiffPane`: Diff rendering (XSS-safe textContent) | — |
| — | `timeline.writeDiffsForSessionTree(active.sessionId)` returns restorable hunks | `dsh.test.diffAvailability` (`extension.ts:1221`) |

**Verdict**: product implementation ✅ complete. `changedFileCount`/`diffAvailability` hooks ✅ exist (but both are **read-only**: with no changes they return `{count:0}`/`{available:false}`). **Missing `dsh.test.revert*` hook** → §12.6 "snapshot & revert" (#28) cannot be machine-driven; same nature as the Phase 2 fork-hook gap, see §7 R2. Change **generation** depends on a real model round-trip triggering a write tool (`meta.diffs`) → `ChangeAttributor.ingestToolResult`, so `requiresModel:true` is correct.

### 3.4 §12.7 Search (#30–#31, group `search`)

| File:line | Content | Hook |
|------|------|------|
| `src/search/session-search.ts:46` | `searchSessions(extensionIndex, pathIndex, query)`: Tier-1 (title/firstUserPreview) + Tier-2 (path→session) search, **never reads body** | **no `dsh.test.searchSessions`** |
| `src/search/session-search.ts:116` | `matchTier1Field(row, text)`: case-insensitive substring match | — |
| `src/conversation-controller.ts:1356` | `searchSessions(query)` → `runSessionSearch` | — |
| `src/extension.ts:730` | product command `dsh.searchSessions` (no args → InputBox; passing `{text}`/`{path}` or a string → returns `{outcome, hits}`) | product command, drivable via `executeCommand` |

**Verdict**: product implementation ✅ complete. **No test hook**, but the product command `dsh.searchSessions` accepts arguments (`{text: '...'}`) and returns structured `hits`, so it **can be driven directly via `executeCommand('dsh.searchSessions', {text})` — no new hook needed** (a thin wrapper hook could be added for `dsh.test.*` gating consistency, see §7 R4). Current manifest steps use `dsh.test.listHistory` (**not search**) — a placeholder error.

### 3.5 §12.10 History (#37–#38, group `history`)

| File:line | Content | Hook |
|------|------|------|
| `src/history-view.ts:133` | `listHistoryFromIndex(index)`: host-independent history list (`index.listHistorySessions()`) | `dsh.test.listHistory` (`extension.ts:1077`) |
| `src/conversation-controller.ts:389` | `openFromHistory(sessionId, {events?})`: cold-read authoritative log → replay tab (`host.readSessionLog`) | `dsh.test.openHistory` (`extension.ts:1057`) |

**Verdict**: product implementation ✅ complete; both hooks ✅ exist. The current `cap-open-from-history` manifest step passes `args: [""]` (empty string) → `openHistory` hook rejects empty sessionId and returns `{outcome:'missing'}` (`extension.ts:1064-1066`), **a placeholder that necessarily fails**. Must be rewritten to "create a real session via round-trip first → `listHistory` to get real sessionId → `openHistory(sessionId)`". `openFromHistory` without injected events requires the host to be connected (`readSessionLog`), so `requiresModel` should be false (replay has no generation) but its precondition depends on a session created by a real round-trip.

### 3.6 §12.11 Interaction/approval fail-closed (#39–#40, group `interaction`)

| File:line | Content | Hook |
|------|------|------|
| `src/interaction-coordinator.ts:217` | `InteractionCoordinator.listPending()`: pending/presented interaction projection | `dsh.test.listPendingInteractions` (`extension.ts:1097`) |
| `src/interaction-coordinator.ts:288` | `resolveApproval(id, outcome)`: UI-less answer to an approval (AD-12); `unknown-id`/`invalid-outcome` fail-closed | `dsh.test.answerApproval` (`extension.ts:1109`) |
| `src/interaction-coordinator.ts:308,341` | `handleApproval` / `handleQuestions`: enqueue + serial presentation (**only reachable via `session-host.ts:938,945` bridge frames**) | **no injection hook** |
| `src/interaction-coordinator.ts:372,390` | `failClosedAll` / `failClosedSession`: fail-closed queue purge on host death / tab close | `dsh.test.injectDisconnect` (`extension.ts:1277`) can trigger indirectly |
| `src/interaction-ui.ts:72` | `createVscodeInteractionUi`: QuickPick/InputBox presentation (replaceable AD-8) | — |

**Verdict**: product implementation ✅ complete. `listPendingInteractions`/`answerApproval` hooks ✅ exist. **But there is no `dsh.test.injectApproval` (inject pending approval request) hook** — `handleApproval` is only called by real runtime bridge frames (`session-host.ts:938`), and triggering a bridge frame requires a real model round-trip that issues an approval-requiring tool call. Therefore "approval queue / answerApproval / fail-closed" cannot be machine-driven without an injection hook or a controllable approval tool, see §7 R5. This is the **second gap requiring a new product hook**.

## 4. Key Entry Points / Call Paths

### 4.1 Subagent enter/pin tab (§12.4, pure host state)

```
dsh.test.injectSubagent({phase:'finished', parentSessionId, childSessionId})  (extension.ts:1313)
 └─ controller.applyTestSubagentNotification(...)  (conversation-controller.ts:1934)
     └─ timeline.apply('subagent.finished') + onSubagentStarted → real child session enters index

dsh.test.openSubagent(childSessionId)  (extension.ts:1289)
 └─ controller.openSubagentContext(childSessionId)  (conversation-controller.ts:1758)
     ├─ child already pinned → registry.switchTo(pinned.tabId) → {outcome:'activated-tab'}
     └─ else ensureChildHydrated → registry.setContextSessionId → {outcome:'opened-context', mode:'replay'|'readonly-live'}

dsh.test.pinSubagent(childSessionId)  (extension.ts:1304)
 └─ controller.pinSubagent(childSessionId)  (:1831)
     └─ registry.create(title, childId, mode) + setPinnedSubagent → {outcome:'pinned'}

dsh.test.navBack()  (extension.ts:1297)
 └─ controller.navBack()  (:1803) → {outcome:'restored'|'noop'|'disabled'}
```

### 4.2 Code context (§12.5, @path pure function / selection prefill)

```
dsh.test.prefillComposer('@README.md')  (extension.ts:1019)
 └─ panelHost.prefillComposer(text) → {ok:true}   ← no parse result returned (R3)

dsh.test.askAboutSelection()  (extension.ts:1016) → runAskAboutSelection (extension.ts:2299)
 └─ askAboutSelection(deps)  (selection-ask.ts:143)
     ├─ getActiveEditor().selection empty → {ok:false, reason:'empty-selection'}   ← headless precondition gap
     ├─ dirty → save → toWorkspaceRelativePath → buildPointerText  (:83)
     ├─ ensureLiveTab() (if replay, mint a live tab)
     └─ prefillComposer(pointerText) → {ok:true, pointerText, path, startLine, endLine}
[model round-trip point] requires a subsequent dsh.test.sendPrompt(pointerText) (hook itself does not generate)
```

### 4.3 Change list generation & revert (§12.6, real model triggers attribution + gap)

```
[real model round-trip] sendPrompt("modify <file> ...") → model calls write/edit tool
 └─ tool/result.meta.diffs → ChangeAttributor.ingestToolResult(sessionId, turn, meta)  (change-attributor.ts:91)
     └─ settleTurn → SnapshotStore.write(before/after) + ChangeStore.upsert(record)  (:153)

dsh.test.changedFileCount()  (extension.ts:1135)
 └─ controller.changedFileCount(active.sessionId)  (:1469) → timeline.writeDiffsForSession().length

dsh.test.diffAvailability()  (extension.ts:1221)
 └─ controller.timeline.writeDiffsForSessionTree(active.sessionId) → {available, hunks}

[gap] no dsh.test.revert* hook → executeRevert (revert.ts:187) only reachable via reviewWorkspaceDiffs/Webview (R2)
```

## 5. Likely Impact Surface

| Target | Files touched | Risk |
|------|------|:--:|
| Rewrite 14 target manifest steps + assertions (reuse marker template + orchestration preconditions) | `test-scripts/layer-v-capabilities.json` | low (JSON steps/expect/args) |
| §12.6 revert hook `dsh.test.revert` (calls `controller.revertChange`/`executeRevert`) | `src/extension.ts` (`shouldRegisterTestHooks` block `:1009-1328`) + possibly `src/conversation-controller.ts` | **medium-high** (touches product source; `ui:false` but needs implementer branch + review) |
| §12.11 interaction injection hook `dsh.test.injectApproval` (calls `host.interactions.handleApproval`) | `src/extension.ts` (same block) | **medium-high** (same) |
| (optional) §12.7 add `dsh.test.searchSessions` thin hook | `src/extension.ts` (same block) | low (not required: product command already drivable via executeCommand) |
| Orchestration preconditions: real sessions/subagents/selections | driver-layer manifest steps (no product code changes) | medium (needs real LLM round-trips to create sessions, real write tool to trigger changes, EDH to create active editor + selection) |
| Run artifacts | `test-artifacts/layer-v-capabilities/` (gitignored) | low |

**Note**: this workflow is `ui_relevant:false`, but adding hooks for §12.6/§12.11 will still touch product `src/extension.ts`. Per `spec-workflow.mdc`, that must be done by the implementer on the `impl-phase-3-remaining-capabilities` branch, then reviewed + verified. It is the same pattern as the Phase 2 `dsh.test.fork*` hooks (`extension.ts:1189-1215`), which can be used directly as a reference.

## 6. Existing Constraints / Conventions

- **marker real round-trip pattern (proven in Phase 2)**: `newConversation` → `sendPrompt("…LAYER-V-CAP-N-OK")` → `wait $assistantContains:LAYER-V-CAP-N-OK` (or `$assistantClosed:` for close-needed rounds) → `screenshot`. `$assistantContains` matches only assistant text (does not echo user bubbles); `$assistantClosed` additionally requires `!streaming` — `capability-runner.cjs:351-367`. Any Phase 3 capability involving a model round-trip must mirror this pattern.
- **session/connection preamble (Phase 2 reusable template)**: `reveal-editor-panel`(`dsh.showPanel`) → `open-activity-bar`(`dsh.test.openActivityBar`) → `fire-conversation-visible`(`dsh.test.fireConversationVisibility`, args `[true]`) → `wait host-started`(`dsh.test.simulateStartupOnly`, expect `{ok:true,startState:'started',hostStatus:'connected'}`) → `assert new-conversation`(`dsh.test.newConversation`, expect `{outcome:'created'}`) — `layer-v-capabilities.json:186-195`. Pure host-state capabilities can skip the preamble, but capabilities requiring a connected host (openSubagent/pinSubagent require `host.status==='connected'`) must include it.
- **credential gating**: `requiresModel:true` with no `DEEPSEEK_API_KEY` → `SKIPPED_NO_CREDENTIALS`(exit 3), which outranks PASS — `capability-runner.cjs:847-863`. Phase 3's "change-list 3 items" and "selection-ask" inherit this semantics if `requiresModel:true`.
- **AC-9 rule**: `dsh.test.injectAssistant`/`dsh.test.answerApproval`/`restoreOpenTabs` (with events) injection/replay are **assistance only**; they must not be accepted as equivalent to a model round-trip — `spec.md`.
- **assertion extension point**: adding `$selector`/`$visible` only requires registering an entry in `MATCHERS`; the `matchesExpect` core is unchanged — `capability-runner.cjs:321-328`. The six groups can use existing matchers; none new needed.
- **test-hook gating**: new hooks must be written inside `if (shouldRegisterTestHooks(vscodeArg))` (`extension.ts:1010-1328`) and pushed to `testDisposables` — `extension.ts:1331-1354`.
- **CJS driver + pure-orchestration layering**: `capability-runner.cjs` does not import vscode; `extension.cjs` binds the host. Adding capability steps does not require driver changes, only manifest JSON.
- **journal/exit-code contract**: append journal per step, `verdict ∈ {PASS, LINK_FAILURE, HARNESS_ERROR, SKIPPED_NO_CREDENTIALS}`, screenshot `pngVerdict` non-degenerate — fixed in Phase 1.

## 7. Risks / Unknowns

| # | Risk/Unknown | Confidence | Notes |
|---|---|---|---|
| R1 | §12.5 `selection-ask`'s `requiresModel:true` mismatches reality: `askAboutSelection` only dirty-save + prefill, **does not trigger a model round-trip** | ✅ CONFIRMED | `selection-ask.ts:143-196` has no `promptTab`/`host.prompt` anywhere; spec.md's "selection-ask triggers a model round-trip" refers to the user **sending** after prefill. To satisfy AC-9, manifest must chain `askAboutSelection` → `sendPrompt(pointer)` → `wait $assistantContains`. `askAboutSelection`+screenshot alone does not satisfy AC-9. |
| R2 | §12.6 "snapshot & revert" lacks `dsh.test.revert*` hook; the machine-drive path needs a new hook (same as Phase 2 fork gap) | ❓ UNKNOWN (gap confirmed, resolution undecided) | `executeRevert`/`revertChange` reachable only via `dsh.reviewWorkspaceDiffs`(Webview) and Webview revert messages; no command, no test hook. Needs spec/implementer decision on whether to add `dsh.test.revert` in `extension.ts`. |
| R3 | §12.5 `@path`/`workspace-path-resolve` cannot be machine-asserted for "resolution result" | ⚠️ HYPOTHESIS | `extractAtPathTokens`/`resolveAtPathInWorkspace` are pure functions; `prefillComposer` returns only `{ok:true}`. A true-machine assertion can only check "webview shows a ref-card after prefill" or add a hook returning the resolved result. No such hook currently exists. |
| R4 | §12.7 search has no `dsh.test.searchSessions`, but product command `dsh.searchSessions` is drivable via executeCommand with args | ✅ CONFIRMED | `extension.ts:730-748`: passing `{text}`/`{path}`/string → returns `{outcome, hits}` without InputBox. Only no-args pops InputBox (headless-unfriendly). Can use product command directly; no new hook needed. |
| R5 | §12.11 interaction fail-closed cannot be machine-driven: no `dsh.test.injectApproval` to inject pending approval | ❓ UNKNOWN (gap confirmed) | `handleApproval` reachable only via `session-host.ts:938` bridge frames, which need a real model round-trip issuing an approval-requiring tool. `listPendingInteractions` is always empty → `$array` weak assertion always passes. To test "answerApproval/fail-closed/queue" needs an injection hook or a controllable approval tool. |
| R6 | headless EDH has no active editor/selection; `askAboutSelection` precondition is hard to satisfy | ⚠️ HYPOTHESIS | `runAskAboutSelection` depends on `vscode.window.activeTextEditor.selection` (`extension.ts:2308`). EDH must first `vscode.commands.executeCommand('vscode.open')` + set selection to be non-empty. Not yet tested whether the sandbox HOME can stably create an active editor. |
| R7 | §12.4 subagent precondition: must `injectSubagent` a real child first, otherwise open/pin returns missing | ✅ CONFIRMED | `openSubagentContext` on unknown childSessionId calls `ensureChildHydrated` (reads index/log); `injectSubagent` is the only hook that injects a real subagent without a model. Current `__child__` fake id necessarily fails. |
| R8 | change-list 3 items are `requiresModel:true` and require the model to **actually produce a write-tool call**; steering the model to write a specific file is hard | ⚠️ HYPOTHESIS | Change attribution depends on `meta.diffs` (`change-attributor.ts:91`), requiring the model to run str_replace_editor/edit on a workspace file producing `presentationMeta`. The prompt must precisely induce a file write; if the model refuses/only talks, `changedFileCount` stays 0. |
| R9 | true-machine loop duration: 14 items include multiple real model round-trips + file writes | ⚠️ HYPOTHESIS | Recommend verifying in batches via `--capability <id>` (S-2, `run-layer-v-capabilities.sh:213-234`), consistent with Phase 2 R6. |

## 8. Uncertain / Unverified

| Signature | Location | Status |
|------|------|------|
| Whether `dsh.test.askAboutSelection` stably gets active editor + selection in a headless EDH | `extension.ts:2308` | ❓ untested (R6) |
| Whether `host.interactions.handleApproval` can be injected directly by the driver layer (no test hook) | `session-host.ts:938` | ✅ read: bridge-frame-only, no hook |
| Whether `dsh.searchSessions` product command's arg path stably returns hits (no InputBox) | `extension.ts:740-748` | ✅ read: passing object/string does not pop InputBox |
| Whether `injectSubagent`-created child can be correctly hydrated by `openSubagentContext` (without a real fork) | `conversation-controller.ts:1934` | ⚠️ signature exists, not end-to-end tested |
| Whether `SnapshotStore.write`/`ChangeAttributor.settleTurn` stably produce `snapshotRef` under a real write tool | `change-attributor.ts:153` | ✅ logic read; "does the real model trigger a write tool" untested |
| Whether `executeRevert`'s `workspace.writeText`/`deleteFile` is writable under sandbox HOME | `revert.ts:187-218` | ⚠️ signature exists, sandbox write permission untested |

## 9. Stub Detection & Registry Cross-Validation

`tech-debt-registry.md` currently has 3 active debts (DEBT-1/2/3), all 🟡 non-blocking, target `phase-5-cleanup-orchestration-regression`.

### Registry verification result

| Registry ID | File:line | Registry status | Actual code status | Verdict |
|-------------|-----------|:--:|------------|:--:|
| DEBT-1 | `layer-v-capability-driver/capability-runner.cjs` (`StageError`/`safeJson`/`pngVerdict`/`sha256Of`/`resolveCaptureTool` and 13+ primitives) | known defect: mirrors `layer-v-driver/extension.cjs` semantic copy | code still a second independent copy (`capability-runner.cjs:69-475`) | ✅ match (target phase-5, not handled this phase; byte-identical semantics do not affect this phase) |
| DEBT-2 | `sdk/server` `createForkedSession` emptySeed + `conversation-controller.forkFromClosedTurn` retry | known defect: shadow preset autonomous loop grabs retry first input | belongs to §12.8 fork (Phase 2 scope), **unrelated to this phase's six groups** | ✅ match (does not block this phase) |
| DEBT-3 | `layer-v-capabilities.json` #18 `stream` step `requireIncrement:true` | known defect: streaming increment fluctuates across runs (150ms polling occasionally misses samples) | belongs to Phase 2 `cap-message-store-stream-patch` #18, **this phase's six groups do not depend on `stream` increment** (unless a stream step is added for selection-ask) | ✅ match (does not block this phase; if selection-ask uses a `stream` step, note same-origin timing sensitivity) |

### Stub Detection Summary

- ✅ Confirmed stubs (match registry): 3 (DEBT-1/2/3, all 🟡 non-blocking, target phase-5, no blocking intersection with this phase's six groups)
- ⚠️ Registry mismatch: 0
- 🔴 Unregistered stubs: 0 (six-group source files `code-context/*`/`change/*`/`search/*`/`interaction-coordinator.ts`/`interaction-ui.ts`/`history-view.ts` all read — all real logic, no empty shell / `return 0` / `@STUB` / TODO stub)

**This phase's gaps (not stubs; "missing driver-trigger surface", same nature as the Phase 2 fork gap, no `@STUB` registration needed)**:
1. §12.6 revert has no `dsh.test.revert*` hook (`revertChange`/`executeRevert` Webview-only reachable);
2. §12.11 interaction has no `dsh.test.injectApproval` hook (`handleApproval` runtime-bridge-frame-only reachable).

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/src/extension.ts` (`:1009-1328` all test hooks, `:2343-2346` gating, `:2299-2337` runAskAboutSelection) — the only correct place to add hooks
2. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` (14 target items' current placeholder steps, see §3 per group)
3. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` (`:600-772` step types, `:321-369` matchers incl. `$assistantContains`/`$assistantClosed`)
4. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts` (`:389` openFromHistory, `:1223/1270` revertChange, `:1356` searchSessions, `:1469` changedFileCount, `:1758/1803/1831/1934` subagent)
5. 🔷 SHOULD READ — `apps/vscode-dsh/src/code-context/at-path.ts` + `selection-ask.ts` (`:54/110` extract/resolve, `:143` askAboutSelection pure prefill)
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/change/change-attributor.ts` (`:91/153` meta.diffs ingest & settle) + `revert.ts` (`:187` executeRevert)
7. 🔷 SHOULD READ — `apps/vscode-dsh/src/search/session-search.ts` (`:46` searchSessions) + `history-view.ts` (`:133` listHistoryFromIndex)
8. 🔷 SHOULD READ — `apps/vscode-dsh/src/interaction-coordinator.ts` (`:217/288/308/372` listPending/resolveApproval/handleApproval/failClosedAll)
9. 🔹 OPTIONAL — Phase 2 delivered fork hooks `dsh.test.forkRetry/forkBranch` (`extension.ts:1189-1215`) as the authoritative precedent for "adding a new test hook"
