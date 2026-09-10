# Repository Exploration Report — phase-2-streaming-cancel-follow

> Workflow: `vscode-dsh-chat-ux` · Phase: `phase-2-streaming-cancel-follow`  
> Explored: 2026-09-10T12:16:39Z · Mode: manual (code2prompt unavailable)  
> Sources: `spec.md`, `design.md` (AD-CUX-3/4/7/10), `exploration-findings.md` (X1/X5), `tech-debt-registry.md`, phase-1 `repo-exploration.md`, live code under `apps/vscode-dsh/`, `packages/ide/ide-bridge/`, `packages/sdk/server/`, `packages/core/agent-loop/` (read-only)

## 1. Task Context

Phase 2 delivers **streaming text chunk projection**, **「生成中」chrome + `streaming` probe**, **I-真 cancel** (bridge `session/cancel` → `sdkSessionCancel` → `Agent.cancel({ kind:'user' }, { keepInbox: true })`), **follow-state product wiring** (decision fn already exists; need scroll/resume UX), **incomplete recognition of live `turn/end` `aborted`**, and **fail-closed** on cancel/disconnect errors — without thinking/reasoning UI (T6 lock B). Depends on phase-1 layer-A foundation (`render/*`, `probes`, `patchMessageDom` skeleton, `decideFollowState`). Out of scope: activity-item UI (phase-3 / AC-13c), fork, search, auto-revert.

## 2. Repository Overview

| Item | Reality (updated vs phase-1) |
|------|------------------------------|
| Package | `@deepseek-ai/dsh-vscode-dsh` — `apps/vscode-dsh/` |
| Chat UI | Thin Webview HTML + embedded browser sources from `render/*` + `probes` |
| Layer A | ✅ `apps/vscode-dsh/tests/layer-a/` exists (`foundation-render-probe`, `protocol-decision-smoke`) |
| `chat-panel/render/` | ✅ `follow-state.ts`, `message-dom.ts`, `sync-chrome.ts` |
| Host authority | `ChatPanelHost` + `ConversationController` + `MessageStore` |
| Bridge pattern | dispose / read-log / resume / continue-capability triads — **no** `session/cancel` |
| SDK server | `sdkSessionDispose` / `sdkSessionResume` Cordis services — **no** cancel service |
| Core cancel | ✅ `Agent.cancel(cause, { keepInbox? })` in agent-loop (**do not modify**) |
| Chunk events | ✅ Live wire already emits `assistant/chunk` with `text-delta` / `reasoning-delta` via `session.event` |

Directory focus for this Phase:

```
apps/vscode-dsh/src/chat-panel/          # protocol, host, provider, render, probes
apps/vscode-dsh/src/conversation-controller.ts
apps/vscode-dsh/src/message-store.ts
apps/vscode-dsh/src/session-host.ts
apps/vscode-dsh/src/replay-hydrator.ts   # detectIncomplete
packages/ide/ide-bridge/src/             # types, validate, handleHostFrame
packages/sdk/server/src/                 # session-dispose/resume pattern → cancel
packages/core/agent-loop/src/agent.ts    # read-only cancel contract
apps/vscode-dsh/tests/layer-a/           # extend for AC-71 patch+follow
```

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|:------:|
| `apps/vscode-dsh/src/conversation-controller.ts` (`onSdkNotification` ~L1426) | Only projects `assistant/message` (+ tool/turn settle); **ignores `assistant/chunk` and `turn/end` aborted for incomplete** | 👁 |
| `apps/vscode-dsh/src/session-host.ts` (`disposeSession` / `resumeSession`) | Gold pattern for Host→bridge round-trip + timeout; **no `cancelSession`** | 👁 |
| `packages/ide/ide-bridge/src/{types,validate,index}.ts` | Frame union + `handleHostFrame` switch; add `session/cancel` triad | 👁 |
| `packages/sdk/server/src/{session-dispose,session-resume,index,server}.ts` | Cordis service + `rec.handle.agent.*` access; add `sdkSessionCancel` → `agent.cancel(..., { keepInbox: true })` | 👁 |
| `packages/core/agent-loop/src/agent.ts` (`cancel` L143–149) | ✅ CONFIRMED real cancel + `keepInbox`; **forbidden to edit** | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `append`/`replace` only — **no text patch / streaming fields API** | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | No `messages/patch`, no `action/stop` | 👁 |
| `apps/vscode-dsh/src/chat-panel/render/message-dom.ts` (`patchMessageDom`) | ✅ Skeleton ready (text XOR appendText, `data-incomplete`); Webview script **does not** handle `messages/patch` yet | 👁 |
| `apps/vscode-dsh/src/chat-panel/render/follow-state.ts` | ✅ `decideFollowState` / `applyFollowState` match AD-CUX-4; product scroll listeners / init-on-stream **not wired** | 👁 |
| `apps/vscode-dsh/src/chat-panel/render/sync-chrome.ts` (`applyStreamingStatus`) | Maps Host `status === 'generating'` → probe streaming + 「Generating…」 | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | Message handler: replace/append/status only; **no Stop control**, no patch, no follow scroll | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushAppend` / `pushFullState` / `pushStatus`; `running`→`generating`; **no `pushPatch` / stop handler** | 👁 |
| `apps/vscode-dsh/src/replay-hydrator.ts` (`detectIncomplete`) | Recognizes open turn + `interrupted` only — **not `aborted`** (X5 / AC-13b) | 👁 |
| `apps/vscode-dsh/src/chat-panel/probes.ts` | streaming / followState seats ready; activity still GAP-CUX-001 | 👁 |
| `packages/sdk/client/tests/fake-runtime.ts` | Example chunk + aborted reason shapes for Fake/layer-B fixtures | 👁 |
| `apps/vscode-dsh/tests/layer-a/foundation-render-probe.spec.ts` | Existing decideFollowState + patchMessageDom identity tests — extend for AC-71 | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | Layer-B FakeWebviewPort pattern for cancel/patch spy tests | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Live chunk today → gap (must implement)

```
SDK session.event { type: 'assistant/chunk', data: { turn, step, chunk } }
  → IdeSessionHost notificationListeners
  → ConversationController.onSdkNotification
       │
       ├─ session.status → registry + pushStatus   ✅ CONFIRMED
       ├─ tool/call|result|turn/end|assistant/message  ✅ (partial)
       └─ assistant/chunk  ❌ DROPPED (early return after non-matching types)
```

✅ **CONFIRMED**: `onSdkNotification` ends with `if (record.type !== 'assistant/message') return` — chunks never reach MessageStore/Webview.

**Desired (design AD-CUX-10):**

```
assistant/chunk (chunk.type === 'text-delta')
  → ensure streaming assistant bubble (stable messageId)
  → MessageStore.patch + ChatPanelHost.push messages/patch
  → Webview patchMessageDom (same data-message-id)
  → probes.streaming=true; decideFollowState → data-follow-state
  → IGNORE reasoning-delta (AD-CUX-7 / T6)
assistant/message (complete text)
  → converge bubble via patch text= (or replace id) + streaming false
turn/end reason.kind === 'aborted' | 'interrupted'
  → mark incomplete + notice「已停止/未完成」; streaming false
```

### Path B — I-真 cancel (missing end-to-end; core exists)

```
[missing] Webview Stop → action/stop
  → ChatPanelHost → ConversationController.cancelActiveTurn
  → IdeSessionHost.cancelSession(sessionId)     [MISSING — mirror disposeSession]
       → bridge broadcast { kind:'session/cancel', id, sessionId }
       → ide-bridge handleCancel → ctx.get(sdkSessionCancel)
       → SdkSessionCancel.cancelSession
       → rec.handle.agent.cancel({ kind:'user' }, { keepInbox: true })  ✅ EXISTS
  → response ok/error + Host timeout → AC-13d fail-closed
  → live events close with turn/end { kind:'aborted', reason:{ kind:'user' } }  ✅ (agent-loop)
```

✅ **CONFIRMED** (X1 still accurate): bridge has dispose/resume/read-log/continue-capability; **no cancel frame**.  
✅ **CONFIRMED**: `Agent.cancel` with `keepInbox` is real logic in `packages/core/agent-loop/src/agent.ts` — do not change.  
⚠️ **HYPOTHESIS**: cancel timeout should mirror `disposeTimeoutMs` default **5000ms** (phase-2 spec did **not** pin ms / retry — implementer must choose and document; design allows single timeout, fail-closed).

### Path C — Follow-state (skeleton → product)

```
phase-1: decideFollowState + applyFollowState + data-follow-state + probes  ✅
phase-2 needs:
  - on first chunk / streaming→true: init follow=on unless takeover already true (HG-2 P2-2)
  - scroll listener → atBottom / userTookOver (same rule) → decideFollowState → syncFollowPresentation
  - explicit「回到底部」→ explicitResume=true → on
  - on patch when follow=on: keep-bottom strategy (scrollIntoView / scrollTop — not pixel AC)
  - cancel/disconnect fail-closed: streaming=false; do NOT force-reset follow-state
```

✅ **CONFIRMED**: `decideFollowState` already implements stay-current when `!userTookOver && !atBottom && !explicitResume` (P2-2 skeleton branch).

### Path D — Incomplete / aborted (hydrate gap; live gap)

```
hydrateFromAuthoritativeLog → detectIncomplete(events)
  → openTurns>0 OR reason.kind==='interrupted'   ✅
  → reason.kind==='aborted'                      ❌ NOT recognized
  → notice「已停止/未完成」 when incomplete        ✅ (hydrate path only)

Live onSdkNotification turn/end:
  → only change-list settle enqueue               ✅
  → does NOT set ChatMessage.incomplete / notice ❌
```

## 5. Likely Impact Surface

| Area | Change type | Risk | Notes |
|------|-------------|:----:|-------|
| `packages/ide/ide-bridge` types/validate/handle | add cancel triad | 🟡 | Copy dispose/resume pattern; package tests in `ide-bridge.spec.ts` |
| `packages/sdk/server` `session-cancel.ts` + provide + `server.cancelSession` | add | 🟡 | `rec.handle.agent.cancel({ kind:'user' }, { keepInbox: true })`; no-op if unknown session? (dispose no-ops missing — match that) |
| `apps/vscode-dsh/.../session-host.ts` `cancelSession` | add | 🟡 | pending map + timeout + response handler |
| `conversation-controller.ts` chunk + cancel + aborted | modify | 🔴 | Core product path; stable streaming messageId; converge on assistant/message |
| `message-store.ts` patch / streaming flags | modify | 🟡 | Need `patch(messageId, { text\|appendText, incomplete?, streaming? })` + ensure-bubble |
| `protocol.ts` `messages/patch` + `action/stop` | modify | 🟢 | Design contracts clear; text XOR appendText |
| `chat-panel-host.ts` pushPatch + stop routing | modify | 🟡 | Layer-B spy surface |
| `chat-panel-provider.ts` Stop UI + patch + follow scroll | modify | 🔴 | Large inline script; keep dual-source parity with `render/*` |
| `replay-hydrator.detectIncomplete` | modify | 🟢 | Add `aborted` (+ keep `interrupted`) |
| `render/message-dom.ts` / follow / sync | light extend | 🟢 | Skeleton mostly sufficient; may need streaming attr / incomplete notice styling |
| `tests/layer-a/*` + new layer-B chat-ux specs | add | 🟡 | AC-71 Must; AC-13 spy cancel |
| `packages/core/agent-loop` | **none** | — | O-3 / phase constraint |
| Activity UI / AC-13c | defer | 🟢 | Host may map aborted codes for later; no product UI this Phase |

**Risk legend**: 🟢 low · 🟡 medium · 🔴 high

## 6. Existing Constraints / Conventions

1. **I-真 only** — Stop must call bridge cancel → Agent.cancel; frontend-only stop of append is forbidden for AC-13 acceptance (T3 / AD-CUX-3). ✅
2. **Do not modify agent-loop** — cancel already correct; only wire (O-3). ✅
3. **T6 lock B** — never project `reasoning-delta` / thinking UI; only text-delta + generating chrome (AD-CUX-7). ✅
4. **`messages/patch` identity** — must not pass AC-10/18 by full `messages/replace` per chunk (R1 / AD-CUX-10). text XOR appendText. ✅
5. **Host decisions vs presentation** — mode/send stay Host; streaming/follow are presentation (AD-CUX-1); Stop is a Webview **action** that Host executes. ✅
6. **Dispose/resume triad style** — Host broadcast + pending promise + timeout + bridge handler + Cordis `ctx.get(SERVICE)` + response frame. ✅ CONFIRMED in session-host + ide-bridge.
7. **Browser dual-source** — provider embeds `*BrowserSource()` strings; keep TS + inline in sync (phase-1 pattern). ✅
8. **Status→streaming chrome** — `ChatPanelHost.resolveStatus`: tab `running` → `generating` → `applyStreamingStatus` sets probe. Chunk path should keep this consistent (or set streaming explicitly on first chunk). ✅
9. **Assistant id today** — `projectAssistantMessage` always `randomUUID()` on complete message; streaming requires **pre-allocating stable id on first chunk** and converging the same node. ✅ CONFIRMED gap.
10. **No stdout SDK cancel** — cancel stays on Host bridge like dispose/resume (X1). ✅

## 7. Risks / Unknowns

| ID | Claim | Confidence |
|----|-------|:----------:|
| R1 | X1 still true: no `session/cancel` anywhere in ide-bridge / sdk server / IdeSessionHost | ✅ CONFIRMED |
| R2 | X5 still true: `detectIncomplete` ignores `aborted`; live cancel closes with `aborted` not `interrupted` | ✅ CONFIRMED |
| R3 | Chunk events already reach Host via `session.event` without SDK stdout changes (AC-17) | ✅ CONFIRMED (fake-runtime + session packages emit them; Host just drops) |
| R4 | Cancel timeout ms / single-retry not pinned in phase-2 `spec.md` | ❓ UNKNOWN — recommend default **5000ms**, **no retry**, fail-closed (mirror dispose) |
| R5 | Whether unknown-session cancel should `ok:true` no-op (like dispose) vs error | ⚠️ HYPOTHESIS — prefer dispose-like no-op for idempotency |
| R6 | Streaming bubble creation: empty append then appendText vs create-with-first-delta | ⚠️ HYPOTHESIS — design says ensure bubble + patch; pick one and keep `data-message-id` stable |
| R7 | Converge: final `assistant/message` may use log message.id vs Host-generated streaming id | ⚠️ HYPOTHESIS — Host should map turn→streamingMessageId; prefer Host identity over inventing dual nodes |
| R8 | Follow “atBottom” threshold / scroll container (`#messages` vs chassis) | ❓ UNKNOWN — AC only requires probeable takeover condition + `data-follow-state` |
| R9 | Webview Stop chrome does not exist yet (no button / action/stop) | ✅ CONFIRMED |
| R10 | Fail-closed UX: `ui/banner` vs status text vs notice message | ⚠️ HYPOTHESIS — `ui/banner` already exists on Host |
| R11 | DEBT-CUX-001 dual-path extract does not block phase-2 | ✅ CONFIRMED (targets phase-4) |

## 8. Uncertain / Unverified

Do **not** assume the following until implementer verifies:

| Symbol | Why uncertain |
|--------|----------------|
| Exact `assistant/chunk` payload nesting under `session.event` in production IDE child | Fake-runtime + session packages confirmed shape `{ turn, step, chunk: { type:'text-delta', text } }`; live IDE path not re-traced end-to-end in this exploration |
| Whether mid-cancel emits `assistant/message` with `interrupted: true` before `turn/end aborted` | X5 claims yes; vscode-dsh never reads `interrupted` field today |
| `ChatMessage.streaming` field | Design model includes it; `message-store.ts` ChatMessage has **no** `streaming` yet |
| Activity aborted mapping (`ABORTED` / `ABORTED_BEFORE_DISPATCH`) | Needed for phase-3 AC-13c; optional Host prep only this Phase |
| Pixel scroll behavior under jsdom | Layer A must **not** assert pixels (AC-14/71) — use attributes + decision fn |
| Cancel while Host `status !== 'connected'` | Fail-closed path required; exact banner copy TBD |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-CUX-001 | `chat-panel-provider.ts` change-list/diff dual path | 🟡非阻塞 → phase-4 | Still dual-path (message-dom extracted; change-list inline) | ✅ 匹配 |
| GAP-CUX-001 | `probes.ts` activity seats | 🟡 → phase-3 | `setActivity` API present; no product fill | ✅ 匹配 |
| GAP-CUX-002 | `parentReadonly` / `continueSealed` | 🟡 → phase-5 | Protocol + `mirrorHostDecisions` ready; Host product path not pushing | ✅ 匹配 |
| — targeting phase-2 | — | none 🔴 | N/A | ✅ no blocking inherited debt |

### Code scan (phase-2 primary path)

| Signal | Location | Verdict |
|--------|----------|---------|
| `@STUB` markers | chat-panel / session-host / conversation-controller | ✅ none found |
| Empty cancel handlers | — | 🟡 **GAP** (feature missing, not fake stub body) |
| `patchMessageDom` | `message-dom.ts` | ✅ real DOM patch logic (not stub) |
| `decideFollowState` | `follow-state.ts` | ✅ real pure function |
| `detectIncomplete` missing `aborted` | `replay-hydrator.ts` | 🟡 **known defect/gap** for AC-13b — not registered; should be fixed this Phase (not a stub) |
| `onSdkNotification` ignore chunk | `conversation-controller.ts` | 🟡 GAP for AC-10 — intentional pre-phase absence |
| Activity probe empty | `probes.ts` | ✅ matches GAP-CUX-001 |

### Stub Detection Summary

- ✅ Confirmed stubs matching registry: **0** (no STUB-* entries)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs (empty fake bodies on primary path): **0**
- 🟡 Feature gaps Phase 2 must implement (not stubs): `session/cancel` triad, `cancelSession`, `messages/patch` protocol+store+webview, chunk projection, `action/stop`, follow product wiring, `detectIncomplete`+live aborted incomplete

**Escalation**: none (no 🔴 unregistered stub blocking the primary data path; cancel/chunk are missing features with clear mirror patterns).

## 10. Recommended Next Reads

### ⭐ MUST READ (implementer before coding)

1. `.specdev/specs/vscode-dsh-chat-ux/phases/phase-2-streaming-cancel-follow/spec.md` — full AC list + Follow P2-2 constraints
2. `apps/vscode-dsh/src/conversation-controller.ts` — `onSdkNotification`, `projectAssistantMessage` (~L1320–1476)
3. `apps/vscode-dsh/src/session-host.ts` — `disposeSession` / `resumeSession` (+ response routing ~L479+) as cancel template
4. `packages/ide/ide-bridge/src/index.ts` — `handleDispose` / `handleResume` triad
5. `packages/sdk/server/src/server.ts` — `disposeSession` + `rec.handle.agent.followup` (cancel sibling)
6. `packages/core/agent-loop/src/agent.ts` — `cancel` + `CancelOptions.keepInbox` (**read only**)
7. `apps/vscode-dsh/src/replay-hydrator.ts` — `detectIncomplete` + hydrate notice「已停止/未完成」
8. `design.md` AD-CUX-3 / 4 / 7 / 10 + streaming/cancel ASCII flows

### 🔷 SHOULD READ

9. `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts` — extend frames / pushPatch
10. `apps/vscode-dsh/src/chat-panel/render/{message-dom,follow-state,sync-chrome}.ts` + provider message listener (~L902+)
11. `apps/vscode-dsh/src/message-store.ts` — add patch without breaking change-list APIs
12. `packages/sdk/client/tests/fake-runtime.ts` — chunk + aborted fixtures
13. `exploration-findings.md` X1 / X5
14. `apps/vscode-dsh/tests/layer-a/foundation-render-probe.spec.ts` + `panel-l2-l3-protocol.spec.ts`

### 🔹 OPTIONAL

15. `packages/core/agent-loop/tests/cancel.spec.ts` / `loop.spec.ts` — cancel→`aborted` behavior evidence
16. `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` — existing incomplete/`interrupted` assertions to extend for `aborted`
17. phase-1 `repo-exploration.md` — foundation baseline (mostly superseded for render/probes)

---

### Delta vs phase-1 exploration (unchanged vs updated)

| Topic | Status |
|-------|--------|
| Layer-A extract / probes / follow skeleton / `patchMessageDom` | **updated** — phase-1 delivered |
| `session/cancel` wiring | **unchanged** from X1 — still absent |
| Chunk consumption in `onSdkNotification` | **unchanged** — still drops chunks |
| `detectIncomplete` + `aborted` | **unchanged** from X5 — still missing |
| Stop UI / `action/stop` | **updated finding** — confirmed absent in provider/protocol |
| Registry | **updated** — three 🟡 debts; none target phase-2 as 🔴 |
