# Repository Exploration Report — phase-2-multitab-history-replay

## 1. Task Context

Phase 2 delivers (1) inactive-Tab **unread** dots and **approval badges** plus AD-CU-7 **serial soft-priority** interaction queue inside the existing `InteractionCoordinator`, (2) a workspace **history list** driven by `ExtensionIndex` (title/mtime/`continueCapability` mapping; open always starts as replay), and (3) product **`ReplayHydrator`** that cold-reads the authoritative log once and fully rebuilds MessageStore + Timeline + panel (`messages/replace`, `mode=replay`, composer gated). L2 Host hooks and L3 fake-Webview coverage must include history reopen, approval wake, and replay reject-send. **Must prioritize DEBT-002** (dual-running status fixture) and land **DEBT-001** (ReplayHydrator Timeline/oracle fixtures). **GAP-001** (bridge `session/resume`) is phase-3 — do not implement.

## 2. Repository Overview

| Aspect | Reality |
|--------|---------|
| Language | TypeScript ESM (`"type": "module"`) |
| Package | `@deepseek-ai/dsh-vscode-dsh` under `apps/vscode-dsh/` |
| Framework | VS Code Extension Host + thin Conversation Webview; Cordis ide profile via SDK stdio + ide-bridge NDJSON |
| Package manager | pnpm workspace (repo root) |
| Tests | Vitest under `apps/vscode-dsh/tests/`; phase scripts under `.specdev/specs/.../test-scripts/` |
| Spike fold helpers | `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts` (T-0a **PASS**) |
| Missing product files (this Phase) | `replay-hydrator.ts`, `history-view.ts` — **not present** |
| Bridge read-log | `session/read-log` **not** in `BridgeFrame` yet (T-0a selected, product not landed) |

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|:------:|
| `apps/vscode-dsh/src/interaction-coordinator.ts` | AD-CU-7: today concurrent present; must grow serial queue + soft priority + Tab-switch pending restore **in this file** | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | Needs `unread` / `approvalBadge` (and clear-on-activate); already enforces one Tab per `sessionId` | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | Live projection, close≠dispose, index upsert; needs `openHistory` / hydrate / unread fan-out | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` | Session list + openTabSet workspaceState; history list data source (AC-28/29/63) | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushStatus` / `pushFullState` / replay `ui/reject-send`; DEBT-002 fixture target | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Host↔Webview frames; may need `scroll/reveal` for AC-56 | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `replace`/`append` ready for hydrator + Tab switch | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` | Live `apply`; **no bulk replace** yet; Diff `oldText` coercion differs from spike | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | Bridge frame routing; natural home for `session/read-log` client | 👁 |
| `apps/vscode-dsh/src/conversation-tab-bar.ts` | Tab chrome; no unread/badge glyphs yet (AC-19/20/22) | 👁 |
| `apps/vscode-dsh/src/extension.ts` | Commands + L2 hooks (`dsh.test.*`); register history / open-replay hooks | 👁 |
| `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts` | Fold semantics to promote into product `ReplayHydrator` | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | L2/L3 harness pattern to extend (VP-2-*) | 👁 |
| `packages/ide/ide-bridge/src/types.ts` + `validate.ts` + plugin | Add thin `session/read-log` (+ optional `session/stat`) frames | 👁 |
| `packages/session-query/session-query/src/cold-read.ts` | `readColdSessionLog` — preferred fold input | 👁 |
| **NEW** `apps/vscode-dsh/src/replay-hydrator.ts` | Product one-shot fold → MessageStore + Timeline | 📊 design |
| **NEW** `apps/vscode-dsh/src/history-view.ts` | History TreeView over index (independent of Host) | 📊 design |

## 4. Key Entry Points / Call Paths

### Path A — Live message / status (phase-1 baseline; unread hook point)

```
IdeSessionHost (SDK notification)
  → ConversationController.onSdkNotification
       ├─ TimelineStore.apply(notification)
       ├─ session.status → registry.setStatus → panelHost.pushStatus()   # active Tab only
       └─ assistant/message → messages.append → panelHost.pushAppend()  # no-op if inactive
  → [phase-2] if Tab inactive: set unread=true; refresh Tab bar
  → [phase-2] switchConversation + panel shown → clear unread (AC-57)
```

✅ CONFIRMED: `pushAppend` / `pushStatus` only target **active** Tab (`chat-panel-host.ts`). Inactive messages still land in `MessageStore` — unread can key off inactive append without changing authority.

### Path B — Interaction today vs AD-CU-7 target

```
ide-bridge NDJSON approval/request | user-questions/request
  → IdeSessionHost.onBridgeFrame
  → InteractionCoordinator.handleApproval / handleQuestions
       today: pending Map + IMMEDIATE ui.present*(...)   # concurrent / no queue
       target: enqueue → serial present → soft-priority insert for active Tab
               Tab switch unanswered: abort UI → presented→pending (badge stays)
               fail/Abort at head → dequeue → present next
  → response frame back on bridge
  → interactions.onChange → panelHost.pushStatus (waiting-interaction)
```

✅ CONFIRMED: coordinator is **blocking single-flight per waiter id**, but **not** a global serial presentation queue — overlapping `presentApproval` calls can race. Spec requires extend **same file**, forbid `interaction-queue.ts`.

### Path C — History open → ReplayHydrator (phase-2 primary)

```
HistoryList row click / dsh.test.openHistory(sessionId)
  → ConversationController.openFromHistory(sessionId)   # NEW
       ├─ if registry.getBySessionId → switchTo (reuse tabId)  # AC-64/65
       └─ else registry.create(title, sessionId, mode='replay')  # NEW tabId
  → IdeSessionHost.readSessionLog(sessionId)            # NEW bridge client
       → BridgeFrame session/read-log
       → ide-bridge → readColdSessionLog(persistence, id)
  → ReplayHydrator.hydrate(events)
       → MessageStore.replace(sessionId, messages)
       → TimelineStore.replace/bulkApply(sessionId, rows)   # NEW API needed
  → panelHost.pushFullState()  # panel/state mode=replay + messages/replace
  → composer/send → ui/reject-send reason=replay (already gated)
```

✅ CONFIRMED: T-0a prefers bridge → `readColdSessionLog`; spike fold lives in tests only.  
⚠️ HYPOTHESIS: product may temporarily call persistence from Host tests without bridge until frame lands — prefer shipping frame in same Phase (design + spike).

### Path D — Close Tab → history replay (VP-2-history)

```
dsh.closeConversation / dsh.test.closeConversation
  → failClosedSession (pending UI abort)
  → registry.close (tabId destroyed; messages kept in memory for same process)
  → index.setOpenTabs (drops closed tab; SessionIndexEntry remains)
  → later openFromHistory → cold read (authoritative) NOT memory MessageStore alone
```

✅ CONFIRMED: close keeps MessageStore/Timeline in memory but does **not** dispose; reopen must still hydrate from log for consistency/oracle (AC-30/47).

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|:----:|
| `interaction-coordinator.ts` | Serial queue, soft priority, Tab-switch pending restore, badge signals | **HIGH** — fail-closed / Abort semantics must not regress |
| `conversation-registry.ts` + tab-bar | `unread` / `approvalBadge`; title from index | MEDIUM |
| `conversation-controller.ts` | `openFromHistory`, unread clear, hydrate orchestration | **HIGH** |
| `replay-hydrator.ts` (new) | Promote spike folds; map to `ChatMessage` / TimelineItem | **HIGH** |
| `history-view.ts` (new) | TreeView over `ExtensionIndex.sessions` | MEDIUM |
| `extension-index.ts` | Filter deleted/non-workspace; capability display helpers | LOW–MED |
| `timeline-store.ts` | Bulk replace API; align Diff `oldText: null` with AD-CU-6 | MEDIUM |
| `session-host.ts` + `ide-bridge` | `session/read-log` (+ optional `session/stat`) | **HIGH** (wire + validate) |
| `chat-panel-host.ts` / protocol | Reveal/scroll Should; DEBT-002 tests only for status | LOW (product) / MED (tests) |
| `extension.ts` L2 hooks | `openHistory`, list index, inject inactive message, wake approval | MEDIUM |
| Tests `panel-l2-l3*`, new VP-2 suites, hydrator oracle | DEBT-001/002 + AC-54/84 | MEDIUM |

## 6. Existing Constraints / Conventions

- **Projection only:** Extension never becomes second message authority (AC-45/46); index stores metadata only.
- **Close ≠ dispose:** `closeConversation` must not call `session/dispose`; delete path only (AD-CU-3/9).
- **Single open per sessionId:** `ConversationRegistry.create` throws if session already open (AC-59/64/65).
- **tabId lifecycle:** close destroys tabId; history reopen mints **new** tabId (AD-CU-5).
- **Send gate on Host:** replay → `ui/reject-send` `{ reason: 'replay' }` already implemented (`ChatPanelHost.sendPrompt`).
- **Immediate index persist:** `ExtensionIndex.writeImmediate` on every mutation (AD-CU-4).
- **Empty Tabs excluded** from persisted `openTabSet`.
- **Queue file ban:** AD-CU-7 queue **must** live in `interaction-coordinator.ts`.
- **L3 = fake Webview** (`FakeWebviewPort`), not HTML/CSP.
- **L2 hooks** already: `dsh.test.sendPrompt`, `closeConversation`, `deleteConversation`, `panelSnapshot`, `getIndex`, `openPanel`.
- **Continue / resume:** GAP-001 → phase-3; history may show AD-CU-8 capability labels but Continue product is out of scope.
- **T-0a PASS** unlocks replay slice (AC-80); prefer promoting `foldMessages` / `foldTimeline` / `recoverableDiffsFromMeta` semantics.

## 7. Risks / Unknowns

| Item | Confidence |
|------|:----------:|
| InteractionCoordinator has **no** serial presentation queue today — AD-CU-7 is a **refactor**, not a tiny patch | ✅ CONFIRMED |
| `unread` / `approvalBadge` fields absent from `ConversationTab` / tab-bar | ✅ CONFIRMED |
| `history-view.ts` / `replay-hydrator.ts` missing | ✅ CONFIRMED |
| `BridgeFrame` lacks `session/read-log` | ✅ CONFIRMED |
| TimelineStore has no bulk `replace` for replay rows | ✅ CONFIRMED |
| TimelineStore Diff path coerces missing `oldText` → `''`; spike rejects missing and allows `null` — product must follow spike/AD-CU-6 | ✅ CONFIRMED (code read) |
| `panel-l2-l3-protocol.spec.ts` has **no** dedicated dual-running AC-21 fixture (DEBT-002); verifier V-IND-5 proved behavior independently | ✅ CONFIRMED |
| Spike Gate section in `design.md` still says “NOT RUN” while spike-report is PASS — doc drift | ✅ CONFIRMED |
| Whether Extension Host can reach persistence **without** bridge in production (workspace path / child-only FS) | ⚠️ HYPOTHESIS — design prefers bridge thin frame |
| AC-16 file-change summary + AC-56 scroll/reveal product surface size | ❓ UNKNOWN — marked Should; may land thin hooks + debt |
| Host-disconnected history open messaging vs phase-3 AC-69 | ⚠️ HYPOTHESIS — spec allows partial copy; full auto-rebuild wait is phase-3 |

## 8. Uncertain / Unverified

| Symbol | Note |
|--------|------|
| Product `ReplayHydrator.hydrateFromAuthoritativeLog` | Design skeleton only; behavior = spike folds **if** promoted faithfully |
| ide-bridge `session/read-log` handler | Not implemented; wiring to `readColdSessionLog` unverified in Extension process |
| `TimelineStore.replace` (proposed) | Does not exist; implementer must add + keep live `apply` intact |
| Soft-priority queue under concurrent bridge frames | No current code path; race with `failClosedSession` on Tab close needs careful AbortController ownership |
| History list delete entry (AC-62) | `markDeleted` + delete commands exist for open Tabs; **history-row** delete UX not built |
| `continueCapability` population | Index field exists; no probe writer in phase-1 (T-0b/phase-3) — list must not show “可继续” for `unknown` |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-001 | `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts` AC-30/47 Timeline `.some`; weak replace/null fixtures | Known test gap → phase-2 product hydrator oracle | Spike Gate still uses `.some` for step/tool; full sequence + `surfaceOp:'replace'` + `oldText:null` covered in verifier script `verifier-independent-t0a.mts`, **not** in product hydrator tests (product file absent) | ✅ 匹配 — solve by product `ReplayHydrator` tests this Phase |
| DEBT-002 | `chat-panel-host.ts` `pushStatus` / active Tab; missing dedicated dual-running fixture | Test gap; implementation correct | `pushStatus`/`resolveStatus` only emit active Tab; `panel-l2-l3-protocol.spec.ts` lacks dual-running switch assertion; phase-1 verifier V-IND-5 exists but not owned product L2 suite | ✅ 匹配 — **user-priority**: add L2/L3 in phase-2 |
| GAP-001 | `sdk-server` create / no `session/resume` in ide-bridge | Missing Continue seam → phase-3 | No `session/resume` / `session/continue-capability` in `BridgeFrame` | ✅ 匹配 — **do not implement** in phase-2 |

### Stub Detection Summary

- ✅ Confirmed stubs/debts matching registry: **3** (DEBT-001, DEBT-002, GAP-001)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0** (no empty `@STUB` product APIs found in scoped paths; missing files are planned deliverables, not silent stubs)

### DEBT landfall recommendations (for implementer)

| ID | Priority | Suggested landfall |
|----|:--------:|--------------------|
| **DEBT-002** | **First (user-specified)** | Add dedicated case in `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` (or sibling `panel-multi-tab-status.spec.ts`): two Tabs `status=running`, FakeWebview attached → `pushStatus` / `switchConversation` → assert outbound `status/set` only carries **active** `sessionId` with `generating`, never the inactive one. Optionally mirror as `dsh.test.*` L2 hook if Extension Host harness is used. Close registry row after green. |
| **DEBT-001** | Same Phase | When creating `src/replay-hydrator.ts`, add `tests/replay-hydrator.spec.ts` (or phase test-scripts) with: (1) **full** Timeline kind/label/callId sequence oracle (not `.some`), (2) `surfaceOp: 'replace'` message fold, (3) recoverable Diff with `oldText: null` (create) vs missing `oldText` reject. Reuse / promote spike helpers; port assertions from `verifier-independent-t0a.mts`. |
| GAP-001 | — | Leave untouched; Continue UI phase-3. |

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/src/interaction-coordinator.ts` (entire file; queue refactor baseline)
2. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts` (close/delete/prompt/panelSnapshot/persistOpenTabs)
3. ⭐ MUST READ — `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts` + `phases/phase-0a-spike-replay-rebuild/spike-report.md` (read-seam + fold contract)
4. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` (pushStatus / reject replay / FakeWebviewPort)
5. ⭐ MUST READ — `design.md` AD-CU-5 / AD-CU-7 / AD-CU-8 + this Phase `spec.md` AC table
6. 🔷 SHOULD READ — `extension-index.ts`, `conversation-registry.ts`, `conversation-tab-bar.ts`
7. 🔷 SHOULD READ — `packages/ide/ide-bridge/src/types.ts` + `validate.ts` + `session-host.ts` bridge handler
8. 🔷 SHOULD READ — `packages/session-query/session-query/src/cold-read.ts`
9. 🔷 SHOULD READ — `tests/panel-l2-l3-protocol.spec.ts` + phase-1 `verifier-independent-phase1.mts` V-IND-5 (DEBT-002 template)
10. 🔹 OPTIONAL — `timeline-store.ts` Diff parsing (~`oldText` coercion), `interaction-ui.ts`, phase-0a `verifier-independent-t0a.mts` (DEBT-001 oracle template)
