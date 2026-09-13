# Repository Exploration Report — phase-5-fork-retry-branch

> Workflow: `vscode-dsh-chat-ux` · Phase: `phase-5-fork-retry-branch`  
> Explored: 2026-09-11T02:21:49Z · Mode: manual (code2prompt unavailable)  
> Sources: `spec.md` AC-30–34 / AC-60–66; `design.md` AD-CUX-5/6 + ForkRequest; `requirements.md` T1/E2/T2; `constitution.md` §7; `tech-debt-registry.md` GAP-CUX-002; phase-2/3/4 `implementation.md`; live code under `apps/vscode-dsh/`, `packages/ide/ide-bridge/`, `packages/sdk/server/`, `packages/core/session/`  
> Phase Entry: **GAP-CUX-002 → a) resolve in this Phase** (user confirmed)

## 1. Task Context

Phase 5 delivers **message copy** (AC-30); **retry / edit-resend = `sessions.fork` @ closed turn + P-接续 + parent Tab E2** (AC-31/31b/32/66); **explicit branch = same fork + P-标明** (AC-60–63); illegal-boundary reject including aborted turn itself (AC-34/61); **child ChangeStore empty bucket at fork-time disk** (AC-64); and **Continue remains same-id resume** as a contrast path (AC-65). Product must not truncate in-session, not copy parent Change index, and must not change agent-loop. Phase Entry debt **GAP-CUX-002** requires Host product path to push `parentReadonly` / `continueSealed` on P-接续 and assert E2 via probes (protocol seats already exist from phase-1).

## 2. Repository Overview

| Item | Reality |
|------|---------|
| Package | `@deepseek-ai/dsh-vscode-dsh` — `apps/vscode-dsh/` |
| Multi-Tab | ✅ `ConversationRegistry` live\|replay + `ExtensionIndex.parentSessionId?` field |
| Continue | ✅ `continueConversation` → bridge `session/resume` → same `sessionId` + `setMode(live)` |
| Cancel (phase-2) | ✅ bridge `session/cancel` → `sdkSessionCancel` → `Agent.cancel` |
| Core fork | ✅ `SessionStore.fork(source, boundarySeq?, childId?)` — rejects `OPEN_TURN`; **accepts aborted `turn/end`** |
| Web Remote fork | ✅ `packages/api/session-controller` `@Remote('fork')` (web GUI; **not** vscode ide-bridge path) |
| ide-bridge fork | ❌ **no** `session/fork` frame / validate / handler |
| SDK fork service | ❌ **no** `sdkSessionFork` (only dispose / resume / cancel) |
| fork-orchestrator | ❌ `apps/vscode-dsh/src/fork/` **absent** |
| Copy message | ❌ only fenced-code `action/copy-code` + `dsh.copyToClipboard`; no `action/copy-message` / `lastCopiedText` |
| E2 probes | ⚠️ protocol + `mirrorHostDecisions` ready; Host `pushFullState` **never** emits `probes` (GAP-CUX-002) |
| ChangeStore | ✅ per-`sessionId` Map — new id ⇒ empty list if not copied |

Directory focus for this Phase:

```
apps/vscode-dsh/src/
  fork/fork-orchestrator.ts          # ADD — P-接续 / P-标明 + boundary gate + E2
  conversation-controller.ts         # wire forkFromClosedTurn / applyContinueSwitch / applyBranchMark
  conversation-registry.ts           # REUSE create / setMode / switchTo / status=running
  continue-capability.ts             # EXTEND — Continue sealed beyond mere replay
  session-host.ts                    # ADD forkSession (mirror cancelSession)
  chat-panel/protocol.ts             # ADD action/retry|edit-resend|branch|copy-message
  chat-panel/chat-panel-host.ts      # wire actions; push panel/state.probes
  chat-panel/chat-panel-provider.ts  # UI entries + copy + parent/child chrome
  chat-panel/probes.ts               # REUSE mirrorHostDecisions (GAP-CUX-002 sink)
  change/change-store.ts             # REUSE empty bucket — do not copy parent
  extension-index.ts                 # write parentSessionId / optional forkLabel
  extension.ts                       # lastCopiedText test hook + copy path
packages/ide/ide-bridge/…            # ADD session/fork frames (mirror cancel)
packages/sdk/server/…                # ADD sdkSessionFork → sessions.fork
packages/core/session/src/index.ts   # REUSE only — do not relax OPEN_TURN; product rejects aborted
```

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|:------:|
| `packages/core/session/src/index.ts` `SessionStore.fork` (~L1147) | Authoritative seed cut; sets `meta.parentSession`; rejects open turn | 👁 |
| `packages/core/session/tests/fork.spec.ts` | ✅ Confirms aborted/`interrupted` `turn/end` are **accepted** by core — product must filter (AC-34) | 👁 |
| `packages/api/session-controller/src/commands.ts` `fork` (~L188) | Web Remote reference: observe log → find `turn/end` ≥ atSeq → `agents.create` seeded child | 👁 |
| `packages/ide/ide-bridge/src/types.ts` `BridgeFrame` | Has dispose/resume/cancel/continue-capability — **no fork** | 👁 |
| `packages/sdk/server/src/session-cancel.ts` (+ resume/dispose) | Template for new `sdkSessionFork` Cordis service | 👁 |
| `apps/vscode-dsh/src/session-host.ts` `cancelSession` / `resumeSession` | Host broadcast + pending map + timeout pattern to clone for fork | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` `continueConversation` (~L640) | AC-65 contrast: same-id resume; **must not** be reused for P-接续 (AC-66) | 👁 |
| `apps/vscode-dsh/src/continue-capability.ts` `continueChromeFor` | Replay + same-id → **enabled**; E2 needs extra sealed gate | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` `sendPrompt` / `pushFullState` | Replay rejects send ✅; `pushFullState` omits `probes` ❌ | 👁 |
| `apps/vscode-dsh/src/chat-panel/probes.ts` | GAP-CUX-002 sink — `mirrorHostDecisions` ✅; product push missing | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `probes?` seats exist; no retry/edit/branch/copy-message actions | 👁 |
| `apps/vscode-dsh/src/change/change-store.ts` | AC-64: `list(newId)` empty unless `upsert`/`clearSession` misuse copies parent | 👁 |
| `apps/vscode-dsh/src/extension-index.ts` `SessionIndexEntry.parentSessionId?` | Field ready; product path does not populate on fork yet | 👁 |
| `apps/vscode-dsh/src/extension.ts` `dsh.copyToClipboard` | Code-block only; no `lastCopiedText` observability | 👁 |
| `apps/vscode-dsh/src/replay-hydrator.ts` `detectIncomplete` | Maps aborted/`interrupted` → incomplete — useful for boundary UI disable | 👁 |
| `packages/client/ui-chat/.../apply.ts` `forkAt` | Web UI pattern: fork then open child — presentation only, not vscode Host | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Continue today (AC-65 contrast; must stay same-id)

```
Webview action/continue | command dsh.continueConversation
  → ConversationController.continueConversation(tabId?)
       continueChromeFor(mode=replay, capability) → enabled?
       → IdeSessionHost.resumeSession(sessionId)
            bridge broadcast session/resume
            → sdkSessionResume → agents.resume
       → registry.setMode(tabId, 'live')   // SAME sessionId / tabId
       → pushFullState()
```

✅ CONFIRMED: sessionId unchanged. P-接续 **must not** call this path on the parent id (AC-66).

### Path B — Target P-接续 (retry / edit-resend) — mostly missing

```
Webview action/retry | action/edit-resend     ❌ not in protocol
  → fork-orchestrator.forkFromClosedTurn({ intent:'retry'|'edit-resend', boundary, … })  ❌ absent
       1. parent running? → reject (HG-2 P2-1)     ❌ no product gate yet
       2. validate boundary → normal closed turn/end, NOT aborted  ❌ must add
            (core SessionStore.fork WILL accept aborted — product must refuse first)
       3. bridge session/fork → sdkSessionFork → sessions.fork   ❌ bridge/SDK missing
       4. applyContinueSwitch:
            registry.create(title, childSessionId, 'live') → active
            registry.setMode(parentTabId, 'replay')
            seal Continue on parent + reject-send (replay already)
            index.upsertSession({ parentSessionId, forkLabel? })
            push panel/state.probes { parentReadonly:true, continueSealed:true }  ← GAP-CUX-002
            hydrate child messages from seeded log / open child Tab
```

### Path C — Target P-标明 (explicit branch)

```
Webview action/branch { turn }               ❌ absent
  → same forkFromClosedTurn({ intent:'branch' })
  → applyBranchMark: open child Tab; parent mode/Continue UNCHANGED
  → probes parentReadonly NOT forced true
```

### Path D — Copy (AC-30)

```
Today: fenced code → action/copy-code → dsh.copyToClipboard → vscode.env.clipboard
Missing: action/copy-message + Host lastCopiedText (or Fake clipboard) for layer B
```

### Path E — Cancel pattern to mirror for fork (phase-2 reuse)

```
cancelActiveTurn → host.cancelSession → bridge session/cancel → sdkSessionCancel → Agent.cancel
```

Implement fork with the same Host pending-map + timeout + Cordis service shape; **do not** touch agent-loop.

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|:----:|
| New `fork/fork-orchestrator.ts` + controller methods | Primary product orchestration | 🔴 High |
| ide-bridge + sdk `session/fork` | New wire + Cordis service | 🔴 High |
| `continue-capability` / `continueChromeFor` | Seal Continue when `continueSealed` even if mode=replay | 🔴 High (E2 false-positive if skipped) |
| `chat-panel-host.pushFullState` | Emit Host decision probes (GAP-CUX-002) | 🟡 Med |
| protocol + provider UI | retry / edit / branch / copy-message entries | 🟡 Med |
| `ExtensionIndex` parentSessionId / forkLabel | AC-63 parent/child copy | 🟡 Med |
| `ChangeStore` | Must **not** copy parent records on fork (empty bucket) | 🟡 Med if mis-wired |
| `MessageStore` / hydrator | Child Tab projection after fork; edit-resend seed text | 🟡 Med |
| Layer B tests `chat-ux-fork-*.spec.ts` | AC-31/31b/60/64/65/66 | 🟡 Med |
| agent-loop / SessionStore OPEN_TURN rules | Out of scope — reuse only | ✅ None if untouched |

## 6. Existing Constraints / Conventions

1. **Constitution §7.4**: fork boundary = closed turn; aborted turn itself illegal; Continue = same-id ≠ fork; no in-session truncate; no agent-loop edits.
2. **AD-CUX-5**: retry/edit → P-接续 + force parent `mode=replay` + E2; branch → P-标明 (parent mode unchanged); boundary must map to non-aborted `turn/end` before core fork.
3. **AD-CUX-6 / R8**: child Change baseline = disk at fork time; do not copy parent Change index; no checkout.
4. **AD-CUX-1 / probes**: `parentReadonly` / `continueSealed` are **Host decision mirrors** — Webview only applies via `mirrorHostDecisions`; never invent locally.
5. **Multi-Tab**: one open Tab per `sessionId` (`ConversationRegistry.create` throws on duplicate); child needs new id.
6. **Send gate**: Host `sendPrompt` rejects `mode === 'replay'` with `ui/reject-send reason=replay` — reuse for E2 send block after forcing replay.
7. **Continue chrome today**: replay + same-id ⇒ **enabled** — sealing requires an **additional** Host flag, not replay alone (AC-31b rejects “still live, frontend-only disable”).
8. **Bridge pattern (phase-2)**: Cordis service on SDK server + `BridgeFrame` + validate + Host pending map + timeout; no stdout protocol expansion.
9. **Phase-2/3/4 reuse boundary**: consume cancel/incomplete/activity/refs/change-diff as-is; do not regress streaming/follow/activity/diff; search stays phase-6.
10. **Tests**: layer B mandatory for Host fork/E2/AC-64/Continue contrast; FakeWebview / controller overrides pattern from phase-2/3 specs.

## 7. Risks / Unknowns

| ID | Finding | Confidence |
|----|---------|:----------:|
| R1 | Core `SessionStore.fork` **accepts** aborted/`interrupted`/`error`/`max-tokens` `turn/end` as boundary (`fork.spec.ts` “accepts every turn/end reason”). Product orchestrator **must** reject aborted (and likely incomplete) before calling core — core will not enforce AC-34. | ✅ CONFIRMED |
| R2 | ide-bridge / sdkSessionFork **absent**; web `session-controller.fork` is a different transport (Remote). vscode must add bridge seam (design), not call web Remote from Extension. | ✅ CONFIRMED |
| R3 | `pushFullState` never includes `probes` — GAP-CUX-002 still accurate; layer-A can mirror manually but product P-接续 path does not push. | ✅ CONFIRMED |
| R4 | E2 Continue seal ≠ mode=replay: today Continue stays enabled on replay Tabs. Need Host `continueSealed` → chrome disabled/hidden + probe true. | ✅ CONFIRMED |
| R5 | Edit-resend seed rewrite: `SessionStore.fork` copies log prefix verbatim; `ForkRequest.editedText` needs either post-fork seed mutation, fork-before-user + new prompt, or `agents.create` with rewritten seed (web controller style). Exact shape not implemented in vscode. | ⚠️ HYPOTHESIS |
| R6 | Mapping UI `messageId` / `turn` → authoritative `seq` of closed `turn/end`: MessageStore has optional `turn` + `incomplete`; cold path has `readSessionLog`. Live mapping helper for fork boundary not present. | ⚠️ HYPOTHESIS |
| R7 | Parent running gate: `registry.status === 'running'` from `session.status` exists; no fork entry points yet to disable. | ✅ CONFIRMED (status) / ❓ UNKNOWN (UX copy for reject reason) |
| R8 | Whether sdkSessionFork should call `sessions.fork` vs `agents.create` (web uses create with seed): ide runtime already has live SessionStore — prefer `sessions.fork` per design. Need verify agent registration for child after fork. | ⚠️ HYPOTHESIS |
| R9 | Subagent `parentSession` notifications may collide with conversation-fork lineage in TimelineStore — product should set ExtensionIndex `parentSessionId` explicitly for chat forks. | ⚠️ HYPOTHESIS |

## 8. Uncertain / Unverified

| Symbol | Why unverified | Downstream rule |
|--------|----------------|-----------------|
| `agents.create` after `sessions.fork` in ide profile | Not traced end-to-end for child promptability in vscode Host | Do not assume child is prompt-ready without sdkSessionFork integration test |
| Edit-resend seed rewrite API | No vscode helper exists | Implementer must choose one design-compatible approach and cover with layer B |
| `forkLabel` / 「派生自 …」 chrome | Index field optional; UI strings not present | Add with AC-63; do not invent alternate lineage store |
| Timeout ms for session/fork | Cancel uses 5000ms no-retry | Likely mirror; confirm in implementation notes |
| Whether `interrupted` alone is illegal like `aborted` | Spec emphasizes aborted; design says non-aborted normal `turn/end` | Treat incomplete markers (`detectIncomplete`) as illegal boundary unless HG clarifies |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| GAP-CUX-002 | `apps/vscode-dsh/src/chat-panel/probes.ts` `mirrorHostDecisions` + `protocol.ts` `panel/state.probes` | 协议位就绪；Host 产品路径未在 P-接续推送 | ✅ seats + mirror + layer-A tests exist; ❌ `ChatPanelHost.pushFullState` never sets `probes`; ❌ no P-接续 caller | ✅ 匹配（仍为 gap；本 Phase 填实） |

### Additional stub / gap scan (phase-5 surface)

| Signal | Location | Verdict |
|--------|----------|:------:|
| Missing module | `apps/vscode-dsh/src/fork/` | 🔴 product gap (planned deliverable, not a fake stub) |
| Missing bridge kinds | `session/fork` in ide-bridge types/validate/index | 🔴 gap |
| Missing SDK service | `sdkSessionFork` | 🔴 gap |
| Missing W→H actions | `action/retry`, `action/edit-resend`, `action/branch`, `action/copy-message` | 🔴 gap |
| Missing observability | `lastCopiedText` / Fake clipboard for AC-30 layer B | 🔴 gap |
| `action/retry-connect` | connection retry only — **not** message retry | ✅ not a stub; do not confuse |
| `message-store` `copyMessage` | deep-copy helper — **not** clipboard copy | ✅ not a stub |
| No `@STUB(phase-5…)` in vscode-dsh fork paths | — | ✅ none found |
| Core fork empty returns | N/A — real seed logic | ✅ not a stub |

### Stub Detection Summary

- ✅ Confirmed stubs/gaps matching registry: **1** (GAP-CUX-002)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered product gaps (expected for this Phase deliverable, not silent stubs): fork-orchestrator, bridge/SDK fork, message copy observability, retry/edit/branch actions, Continue sealed gate
- No critical unregistered **fake implementation** pretending to fork/retry

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/core/session/src/index.ts` (`fork` / `_forkSeed`) + `packages/core/session/tests/fork.spec.ts` (aborted accepted)
2. ⭐ MUST READ — `.specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/spec.md` (all ACs) + `design.md` AD-CUX-5/6 + ForkRequest
3. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts` `continueConversation` + `cancelActiveTurn`
4. ⭐ MUST READ — `apps/vscode-dsh/src/continue-capability.ts` + `chat-panel-host.ts` `sendPrompt` / `pushFullState`
5. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/probes.ts` + `protocol.ts` probes seats (GAP-CUX-002)
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/session-host.ts` cancel/resume pending-map pattern
7. 🔷 SHOULD READ — `packages/ide/ide-bridge/src/{types,validate,index}.ts` cancel handler as fork template
8. 🔷 SHOULD READ — `packages/sdk/server/src/session-cancel.ts` + `server.ts` provide wiring
9. 🔷 SHOULD READ — `packages/api/session-controller/src/commands.ts` `fork` (boundary resolution reference only)
10. 🔷 SHOULD READ — `apps/vscode-dsh/src/change/change-store.ts` + phase-4 change attribution (AC-64 empty bucket)
11. 🔹 OPTIONAL — `packages/client/ui-chat/src/client/apply.ts` `forkAt` (web UX reference)
12. 🔹 OPTIONAL — phase-2/3 `implementation.md` for bridge/test conventions

---

### Critical gap table (orchestrator handoff)

| Gap | AC | Status |
|-----|----|--------|
| Message copy + `lastCopiedText` | AC-30 | Missing |
| Bridge/SDK `session/fork` | AC-31/33/60 | Missing |
| `fork-orchestrator` + P-接续 E2 (mode→replay + sealed Continue + probes) | AC-31/31b/66 | Missing; GAP-CUX-002 |
| Edit-resend boundary + edited seed | AC-32 | Missing |
| P-标明 (parent mode unchanged) | AC-60/62/63 | Missing |
| Reject aborted/open/running boundaries | AC-34/61 + P2-1 | Core alone insufficient |
| Child ChangeStore empty / no checkout | AC-64 | Natural if no copy; must assert |
| Continue same-id contrast | AC-65 | ✅ Exists — protect |
