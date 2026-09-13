# Repository Exploration Report — phase-3-activity-stream

> Workflow: `vscode-dsh-chat-ux` · Phase: `phase-3-activity-stream`  
> Explored: 2026-09-11T01:07:00Z · Mode: manual (code2prompt unavailable)  
> Sources: `spec.md` (AC-13c, AC-20–28), `design.md` (ActivityItem / AD-CUX activity model), `constitution.md` §7, `exploration-findings.md` X5, `tech-debt-registry.md`, phase-1/2 `repo-exploration.md` + phase-2 `implementation.md`, live code under `apps/vscode-dsh/`, reference `packages/client/ui-chat/`, `packages/core/tools/` (read-only)  
> Phase Entry: **GAP-CUX-001 → a) resolve in this Phase** (user confirmed)

## 1. Task Context

Phase 3 delivers **conversation-inline tool/step activity items**: default collapsed, same-turn grouping (`data-turn` / group container), status machine `running → done | failed | aborted` with probes, change-list co-group contract (AC-25), replay hydrate of activity rows without enabling live send (AC-28), and **cancel→aborted** for in-flight activity items (AC-13c). Upstream phase-2 already shipped true cancel, streaming patch, live `turn/end` aborted→incomplete, and `detectIncomplete` recognizing `aborted`. Product activity UI / `activity` probe fill / `activity-dom` extract / hydrator activity fold are still missing — that is the entire Phase gap. Out of scope: T8 inline diff productization (phase-4), fork/search, thinking UI; Timeline remains a weak secondary surface, not the primary activity reader.

## 2. Repository Overview

| Item | Reality (updated vs phase-2) |
|------|------------------------------|
| Package | `@deepseek-ai/dsh-vscode-dsh` — `apps/vscode-dsh/` |
| Chat UI | Thin Webview HTML + embedded browser sources from `render/*` + `probes` |
| Layer A | ✅ `tests/layer-a/` — foundation + streaming-cancel-follow; **no** activity specs yet |
| `chat-panel/render/` | ✅ `follow-state.ts`, `message-dom.ts`, `sync-chrome.ts` — **no** `activity-dom.ts` |
| Host authority | `ChatPanelHost` + `ConversationController` + `MessageStore` |
| Cancel path | ✅ End-to-end (phase-2): `action/stop` → `cancelActiveTurn` → bridge `session/cancel` → `Agent.cancel` |
| Tool events live | ✅ Reach Host; used only for ChangeAttributor + Timeline — **not** chat activity bubbles |
| Replay | ✅ `hydrateFromAuthoritativeLog` folds user/assistant text + Timeline tool rows; **no** chat `kind:'activity'` |
| Probe seats | ✅ `probes.activity` / `setActivity` API real (GAP-CUX-001 skeleton) — **never product-filled** |

Directory focus for this Phase:

```
apps/vscode-dsh/src/chat-panel/
  probes.ts                 # GAP-CUX-001 fill target
  render/                   # ADD activity-dom.ts (NEED_EXTRACT)
  protocol.ts               # ADD action/toggle-activity
  chat-panel-provider.ts    # renderBubble activity branch + expand toggle
  chat-panel-host.ts        # optional toggle routing / probe sync
apps/vscode-dsh/src/
  conversation-controller.ts  # project tool/call|result → activity; cancel→aborted
  message-store.ts            # extend kind + activity payload
  replay-hydrator.ts          # fold tool events → activity messages (AC-28)
  timeline-store.ts           # reference only (already has tool rows)
apps/vscode-dsh/tests/layer-a/   # AC-21/22/23/25/26/27
packages/core/tools/src/index.ts # TOOL_ABORTED / TOOL_ABORTED_BEFORE_DISPATCH codes
packages/client/ui-chat/…/tool.ts # optional shape reference (do not port React)
```

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|:------:|
| `conversation-controller.ts` `onSdkNotification` (~L1655–1663) | `tool/call` → `attributor.noteToolCall` only; `tool/result` → `ingestToolResult` only; **no MessageStore activity** | 👁 |
| `conversation-controller.ts` `markTurnIncomplete` (~L1492) | Cancel/aborted sets assistant `incomplete` + notice; **does not touch activity statuses** (AC-13c gap) | 👁 |
| `message-store.ts` `ChatMessage.kind` | Union is `'text' \| 'subagent' \| 'diff-summary' \| 'notice' \| 'change-list'` — **no `'activity'`**; no `activity?: ActivityItem` | 👁 |
| `chat-panel/probes.ts` | ✅ `setActivity` mutates real map; product path never calls it → GAP-CUX-001 | 👁 |
| `chat-panel/render/` | Missing `activity-dom.ts` (design AD list); barrel exports only follow/message/sync | 👁 |
| `chat-panel/chat-panel-provider.ts` `renderBubble` | Handles text / diff-summary / change-list / user-refs; **no** `[data-kind=activity]` branch | 👁 |
| `chat-panel/protocol.ts` | Has `messages/patch`, `action/stop`; **no** `action/toggle-activity` | 👁 |
| `chat-panel/render/message-dom.ts` `applyMessageIdentity` | ✅ Sets `data-turn` / `data-kind` / `data-message-id` — **ready hook for AC-23/25** once activity messages carry `turn` | 👁 |
| `replay-hydrator.ts` | `foldMessages` = user/assistant only; `foldTimeline` has tool rows; `hydrateFromAuthoritativeLog` never emits chat activity | 👁 |
| `timeline-store.ts` tool/call\|result | ✅ Already projects Timeline tool labels/callId — **not** conversation activity (Timeline stays weak) | 👁 |
| `change` settle path `settleChangeListProjection` | change-list messages already get `turn` + `data-turn` via identity — AC-25 co-group depends on activity sharing same `turn` | 👁 |
| `chat-panel-host.ts` send gate | ✅ `mode === 'replay'` → `ui/reject-send` reason `'replay'` — AC-28 send half already satisfied | 👁 |
| `packages/core/tools` `TOOL_ABORTED` / `TOOL_ABORTED_BEFORE_DISPATCH` | ✅ Codes `'ABORTED'` / `'ABORTED_BEFORE_DISPATCH'` for status→aborted mapping (X5) | 👁 |
| `packages/client/ui-chat/.../conversation-nodes/tool.ts` | Reference: tool-call lifecycle fold from `tool/call`+`tool/result` (+ error) — conceptual only | 👁 |
| `tests/layer-a/foundation-render-probe.spec.ts` | Already asserts `setActivity` API real; extend for DOM collapsed/expanded | 👁 |
| `tests/chat-ux-streaming-cancel-follow.spec.ts` | Layer-B cancel fixtures reusable for AC-13c activity aborted | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Live tool → conversation activity (primary gap)

```
SDK session.event { type: 'tool/call', data: { turn, step, callId, name, arguments } }
  → IdeSessionHost notificationListeners
  → ConversationController.onSdkNotification
       │
       ├─ timeline.apply(...)           ✅ Timeline tool row
       ├─ attributor.noteToolCall(...)  ✅ before-image cache
       └─ MessageStore activity append  ❌ MISSING
            → kind:'activity', ActivityItem{status:'running', ordinal, turn, …}
            → panelHost.pushAppend / pushPatch
            → Webview [data-kind=activity][data-status=running][data-turn=N] collapsed
            → probes.setActivity(id, { status:'running', expanded:false })

tool/result
  → attributor.ingestToolResult         ✅
  → map error.info.code ∈ {ABORTED, ABORTED_BEFORE_DISPATCH} → aborted
     else isError → failed else → done   ❌ MISSING product mapping
  → patch activity message + probes
```

✅ **CONFIRMED**: `onSdkNotification` returns immediately after attributor for both tool types — no chat projection.  
✅ **CONFIRMED**: Activity stream is independent of text chunk path (`projectAssistantChunk`) — AC-24 feasible once tool projection exists (tool-only turn never needs chunks).

### Path B — Cancel → activity aborted (AC-13c)

```
Webview Stop → action/stop
  → ChatPanelHost → cancelActiveTurn → cancelSession → Agent.cancel   ✅ (phase-2)
  → live: tool/result ABORTED*|… then turn/end { kind:'aborted' }     ✅ (X5 / agent-loop)
  → markTurnIncomplete(sessionId, turn)                               ✅ assistant incomplete only
       │
       └─ for each activity with status==='running' in that turn
            → status='aborted'; probes.setActivity …                 ❌ NOT WIRED
```

✅ **CONFIRMED**: `markTurnIncomplete` patches streaming/last assistant + notice「已停止/未完成」; never scans `kind==='activity'`.  
⚠️ **HYPOTHESIS**: Prefer converging aborted from `tool/result` error codes **and** fail-closed on `turn/end aborted` for any still-`running` items (covers ABORTED_BEFORE_DISPATCH races / missing result). Spec maps X5 codes; both hooks should be considered.  
✅ **CONFIRMED** (constitution §7.3): cancel must **not** auto-revert files — existing cancel path does not call revert; keep that invariant.

### Path C — Replay hydrate activity (AC-28)

```
openFromHistory / cold restore
  → loadEvents → hydrateFromAuthoritativeLog(sessionId, events)
       ├─ foldMessages → text bubbles (+ incomplete notice)   ✅
       ├─ foldTimeline → Timeline tool rows                   ✅
       └─ foldActivities (needed) → ChatMessage kind:activity ❌ MISSING
  → registry mode='replay'
  → ChatPanelHost.sendPrompt: mode===replay → reject('replay') + ui/reject-send ✅
```

✅ **CONFIRMED**: Replay send gate already rejects; AC-28 “不得允许 live 发送” is Host-ready.  
✅ **CONFIRMED**: Hydrator does not emit activity chat messages today — rebuild is greenfield fold over `tool/call`+`tool/result` (+ turn/end for residual running→aborted).  
⚠️ **HYPOTHESIS**: Hydrated text bubbles currently omit `turn` (FoldedMessage has no turn) — activity fold must still attach `turn` from tool event data so AC-25 co-group works after change-list cold inject (which **does** set `turn`).

### Path D — Expand / probes / layer A (AC-21/22/26/27)

```
Default render: data-expanded=false | aria/class collapsed; probes.activity[id].expanded=false
User toggle → (local presentation) probes.setActivity + setExpanded
  optional: action/toggle-activity → Host mirror (design)   ❌ protocol missing
Layer A: import activity-dom helpers + jsdom — NEED_EXTRACT
```

✅ **CONFIRMED**: `createChatUxProbeStore().setActivity` is real mutable API (phase-1 tests).  
✅ **CONFIRMED**: No product caller of `setActivity` outside probes module / phase-1 verifier script.

### Path E — Same-turn group with change-list (AC-25)

```
Live settleChangeListProjection → ChatMessage{ kind:'change-list', turn }
  → applyMessageIdentity → data-turn=N                          ✅
Activity items for same turn → data-turn=N (or shared group wrapper)  ❌ need product
```

✅ **CONFIRMED**: Identity helper already writes `data-turn` when `msg.turn` present; change-list live path sets `turn`. Grouping contract can be attribute-equality without a new container — implementer may still add `data-activity-group` / wrapper if preferred; **hook exists**.

## 5. Likely Impact Surface

| Area | Change type | Risk | Notes |
|------|-------------|:----:|-------|
| `message-store.ts` | extend kind + `activity?` field; maybe status patch API | 🟡 | Design `ChatMessage.kind` includes `'activity'` |
| `conversation-controller.ts` | project tool/call\|result; cancel/turn-end abort running | 🔴 | Core product path; ordinal stability; AC-24 tool-only |
| `replay-hydrator.ts` | fold activities into `messages[]` | 🟡 | Must not enable send; Timeline fold stays as-is |
| `chat-panel/render/activity-dom.ts` | **NEW** extract | 🟡 | NEED_EXTRACT for AC-26 layer A |
| `render/index.ts` + `probesBrowserSource` / provider embed | wire extract | 🟡 | Mirror message-dom dual-source pattern |
| `chat-panel-provider.ts` `renderBubble` | activity branch + CSS + toggle | 🔴 | Large inline script; keep parity with activity-dom |
| `protocol.ts` / host | `action/toggle-activity` (optional if fully local) | 🟢 | Design lists W→H frame |
| `probes.ts` | product fill from DOM sync; tighten status typing | 🟢 | Close GAP-CUX-001 |
| `tests/layer-a/*` + layer-B cancel fixture | new specs | 🟡 | AC-13c, 20–28 |
| `timeline-store` / agent-loop | **do not change** for primary path | — | Timeline already has tools; O-3 no agent-loop edits |
| Change-list / diff product DOM | leave (DEBT-CUX-001 → phase-4) | 🟢 | Only share `data-turn` contract |

## 6. Existing Constraints / Conventions

1. **Constitution §7.1**: Layer A (jsdom + extracted modules) is Must — activity collapse/expand must be tested via `activity-dom` (or equivalent import), not whole-page `runScripts` alone.
2. **§7.2 / AD-CUX-1**: Activity status/expanded are **presentation** probes; Webview may own expand; Host owns decision (`mode`/send). Filling `probes.activity` is required observability.
3. **§7.3**: No auto-revert on interrupt; no thinking UI; Timeline not primary activity surface.
4. **AD-CUX ActivityItem**: `id`, `sessionId`, `turn`, `ordinal` (0-based by authoritative `tool/call` order within turn), `toolName?`, `callId?`, `status`, `expanded`, `summary?`.
5. **X5 status map**: `tool/result.error` codes `ABORTED` / `ABORTED_BEFORE_DISPATCH` → `aborted` (constants in `@deepseek-ai/dsh-tools`).
6. **Extract pattern**: phase-1 `messageDomBrowserSource()` + provider call — duplicate for activity-dom; avoid DEBT-style dual drift by making provider call the extracted helpers for activity from day one.
7. **Stable identity**: Prefer `data-message-id` / activity `id` stable across running→terminal patches (same pattern as streaming assistant `messageId`).
8. **Do not modify** `packages/core/agent-loop`.
9. **Replay mode**: `openFromHistory` / restore force `mode:'replay'`; Host `reject('replay')` already blocks send (AC-28).
10. **Phase Entry**: GAP-CUX-001 must be filled (priority a) — probe seats alone are insufficient for PASS.

## 7. Risks / Unknowns

| ID | Finding | Confidence |
|----|---------|:----------:|
| R1 | Live `tool/call`/`tool/result` never create conversation activity bubbles | ✅ CONFIRMED |
| R2 | `ChatMessage.kind` lacks `'activity'`; design already specifies it | ✅ CONFIRMED |
| R3 | `probes.setActivity` unused by product path (GAP-CUX-001) | ✅ CONFIRMED |
| R4 | `activity-dom.ts` absent — NEED_EXTRACT for layer A | ✅ CONFIRMED |
| R5 | `markTurnIncomplete` does not abort running activities (AC-13c open) | ✅ CONFIRMED |
| R6 | Hydrator rebuilds Timeline tools but not chat activity (AC-28 open) | ✅ CONFIRMED |
| R7 | Replay send already reject-closed | ✅ CONFIRMED |
| R8 | `data-turn` identity hook exists; change-list live sets `turn` | ✅ CONFIRMED |
| R9 | Whether `step/start|end` should become separate activity rows vs tools-only | ⚠️ HYPOTHESIS — spec says「工具/步骤」; design `ActivityItem` is tool-centric (`toolName`/`callId`). Clarify: tool rows as P0; step chrome optional if AC text requires visible step items |
| R10 | Exact wire path of `tool/result.error` (`error.code` vs `error.info.code`) in IDE notifications | ⚠️ HYPOTHESIS — tools package uses `error.info.code`; ui-chat reads `match.event.data.error`. Implementer must assert against real Fake/session fixtures |
| R11 | Mid-cancel may emit `assistant/message.interrupted` before `turn/end aborted` (X5) | ⚠️ HYPOTHESIS — phase-2 already handles turn/end; activity should key off tool/result + residual running on turn/end |
| R12 | Hydrated text messages omit `turn` — co-group after cold restore may need turn backfill for assistants too | ⚠️ HYPOTHESIS — AC-25 focuses activity↔change-list; change-list cold inject has turn |

## 8. Uncertain / Unverified

| Symbol | What exists | Unverified behavior |
|--------|-------------|---------------------|
| `tool/result` error payload in vscode-dsh Fake fixtures | Phase-2 cancel specs exist | Exact aborted tool/result shape in vscode-dsh tests not re-run this exploration — copy from `packages/core/tools` / agent-loop cancel specs |
| `packages/client/ui-chat` tool node status→UI mapping | Fold logic present | Not ported; do **not** assume React node states map 1:1 to ActivityStatus |
| Provider inline `applyMessageIdentity` embed | Called in `renderBubble` | Assumed same as `message-dom` extract; activity attrs must be added in both extract + any residual inline CSS |
| Ordinal vs `callId` as primary key | Design has both | Whether re-dispatch same callId can appear — treat `callId` as join key when present, else synthesize id |
| Multi-assistant same turn | change-list re-anchors | Activity ordinal should still be per-turn tool/call order, not per-assistant |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:-------------:|--------------|:----:|
| GAP-CUX-001 | `probes.ts:ChatUxProbes.activity` / `setActivity` | 流程骨架；phase-3 填实 | API 可写；**无** product fill；无 `kind:'activity'` DOM | ✅ 匹配（本 Phase 优先解决） |
| DEBT-CUX-001 | `chat-panel-provider.ts` change-list / diff 内联 | 双路径；phase-4 抽离 | change-list 仍在 provider 内联；`message-dom` 注释确认 | ✅ 匹配（不阻塞 phase-3） |
| GAP-CUX-002 | `probes` parentReadonly / continueSealed | Host 产品路径未推送；phase-5 | seats + `mirrorHostDecisions` 在；无 P-接续推送 | ✅ 匹配（非本 Phase） |

### Additional code scan (activity-related)

| Signal | Location | Verdict |
|--------|----------|---------|
| No `activity-dom.ts` | `chat-panel/render/` | 🟡 Expected gap / NEED_EXTRACT — register as work, not silent stub |
| No `action/toggle-activity` | `protocol.ts` | 🟡 Missing frame (design) — implement or document local-only |
| `setActivity` never called from provider/host/controller | product tree | ✅ Matches GAP-CUX-001 |
| Timeline tool projection looks “done” | `timeline-store.ts` | ✅ Real logic — **not** a substitute for AC-20 conversation activity |
| Hardcoded empty activity list | — | 🔴 none found |
| `@STUB` / TODO wire activity | vscode-dsh chat-panel | 🔴 none found beyond registry GAP |

### Stub Detection Summary

- ✅ Confirmed stubs/gaps matching registry: **3** (GAP-CUX-001, DEBT-CUX-001, GAP-CUX-002)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs blocking activity primary path: **0** (gap is registered as GAP-CUX-001)
- 📌 Phase-3 must **resolve GAP-CUX-001** (user Phase Entry decision **a**)

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts` (`onSdkNotification`, `markTurnIncomplete`, `settleChangeListProjection`)
2. ⭐ MUST READ — `apps/vscode-dsh/src/message-store.ts` (`ChatMessage` shape)
3. ⭐ MUST READ — `apps/vscode-dsh/src/replay-hydrator.ts` (`hydrateFromAuthoritativeLog`, `foldTimeline` tool cases)
4. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/probes.ts` + design ActivityItem block in `.specdev/specs/vscode-dsh-chat-ux/design.md`
5. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/render/message-dom.ts` (`applyMessageIdentity` / `data-turn`)
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` `renderBubble` (change-list branch as sibling pattern)
7. 🔷 SHOULD READ — `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` replay reject-send
8. 🔷 SHOULD READ — `packages/core/tools/src/index.ts` (`TOOL_ABORTED`, `TOOL_ABORTED_BEFORE_DISPATCH`)
9. 🔷 SHOULD READ — phase-2 `implementation.md` + `tests/chat-ux-streaming-cancel-follow.spec.ts` (cancel fixtures)
10. 🔹 OPTIONAL — `packages/client/ui-chat/src/client/conversation-nodes/tool.ts` (lifecycle fold reference)
11. 🔹 OPTIONAL — `apps/vscode-dsh/src/timeline-store.ts` (what Timeline already shows — do not duplicate as primary UI)
12. 🔹 OPTIONAL — `.specdev/specs/vscode-dsh-chat-ux/exploration-findings.md` X5

---

## Critical gap table (orchestrator handoff)

| Gap | AC | Current | Needed |
|-----|----|---------|--------|
| Conversation activity projection | AC-20/24 | tool events → attributor/Timeline only | MessageStore `kind:'activity'` + Webview DOM |
| Probe/product fill | AC-21/22/27 | `setActivity` skeleton | DOM + probes status/expanded |
| Cancel→aborted | AC-13c | incomplete notice only | running activities → `aborted` (no revert) |
| Same-turn group | AC-23/25 | `data-turn` on change-list/text when `turn` set | activity shares `data-turn` / group |
| Layer A extract | AC-26 | no `activity-dom.ts` | NEED_EXTRACT + jsdom tests |
| Replay rebuild | AC-28 | hydrate text+Timeline; replay reject-send ✅ | fold activities into messages |

**Output paths**

- `.specdev/specs/vscode-dsh-chat-ux/phases/phase-3-activity-stream/repo-exploration.md`
- `.specdev/specs/vscode-dsh-chat-ux/phases/phase-3-activity-stream/repo-exploration-zh.md`
