# Repository Exploration Report — phase-3-restart-continue

## 1. Task Context

Phase 3 delivers three product slices on top of phase-2 multitab/history/replay: (1) **restart / Host-reopen restore** of the persisted non-empty `openTabSet` (always `mode=replay`, empty Tabs stripped, UI hydrate capped at N with index retained, active Tab forced into the UI set + focus, `waiting-host → replay` after Host ready, immediate `workspaceState` writes per AD-CU-4); (2) **replay Diff / incomplete** polish (AC-76/77 + AD-CU-6: patch-only `meta.diffs` need authoritative pre-turn before; never impersonate with current disk; incomplete turns marked 「已停止/未完成」); (3) **Continue this session** (Should, T-0b Gate **PASS / same-id**): close **GAP-001** by wiring ide-bridge `session/resume` → `agents.resume`, then same-open-period same `tabId` `replay→live` (AD-CU-8). T-0b FAIL would hide Continue; current Gate is PASS so Continue must ship.

## 2. Repository Overview

| Aspect | Reality |
|--------|---------|
| Language | TypeScript ESM (`"type": "module"`) |
| Product app | `apps/vscode-dsh` (`@deepseek-ai/dsh-vscode-dsh`) |
| Runtime | VS Code Extension Host + thin Conversation Webview; Cordis `ide` profile via SDK stdio + ide-bridge NDJSON |
| Package manager | pnpm workspace |
| Prior spikes | T-0a **PASS** (replay fold); T-0b **PASS (same-id)** — `phases/phase-0b-spike-continue-capability/spike-report.md` |
| Phase-2 landed | `ReplayHydrator`, `history-view`, `ExtensionIndex`, `openFromHistory`, `session/read-log`, InteractionCoordinator soft-priority queue |
| Phase-3 gaps (product) | No `restoreOpenTabs` orchestration; no Continue UI/command; no `session/resume` / `session/continue-capability` frames; hydrator does not set `incomplete`; Diff right side still prefers workspace file |
| Tests | Vitest under `apps/vscode-dsh/tests/`; phase scripts under `.specdev/specs/.../test-scripts/` |
| Active debt | **GAP-001** only (🟡 → this Phase); no 🔴 entries |

**Updated for Phase 3** vs phase-2 exploration: `replay-hydrator.ts`, `history-view.ts`, and bridge `session/read-log` are now **present** (no longer “missing product files”). Restore / Continue / GAP-001 remain open.

## 3. Most Relevant Areas

| Path | Why | Source |
|------|-----|:------:|
| `apps/vscode-dsh/src/extension-index.ts` | `openTabSet` / `activeSessionId` / `ui.restoreUiLimit` (N=8); immediate persist; load sanitize; list `continueCapability` hints | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `openFromHistory` + `persistOpenTabs`; natural home for `restoreOpenTabSet` / `continueSession` / Diff gate orchestration | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | `setMode(tabId, mode)` already exists for Continue `replay→live`; one Tab per `sessionId` | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | Bridge client for `session/read-log` / `session/dispose`; **needs** `resumeSession` (+ optional continue-capability probe) | 👁 |
| `apps/vscode-dsh/src/replay-hydrator.ts` | Fold + `recoverableDiffsFromMeta` (rejects missing `oldText`); **does not** mark incomplete messages yet (AC-77) | 👁 |
| `apps/vscode-dsh/src/diff-entry.ts` | `openTimelineDiff` — left = log `oldText`; **right prefers workspace file** (AD-CU-6 risk for replay) | 👁 |
| `apps/vscode-dsh/src/timeline-store.ts` | `writeDiffsForSession` / hunk typing `oldText: string \| null` | 👁 |
| `apps/vscode-dsh/src/message-store.ts` | `ChatMessage.incomplete?` field exists; hydrator never sets it | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Host↔Webview frames; **no** `action/continue` / Continue chrome yet | 👁 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `pushFullState` / send gate; waiting-host only when **no** active Tab | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `activate` / `dsh.startSession` always `newConversation` after connect — **no** openTabSet restore; L2 hooks registry | 👁 |
| `apps/vscode-dsh/src/history-view.ts` | List hints via `continueCapabilityListHint` (decoupled from top-bar Continue) | 👁 |
| `packages/ide/ide-bridge/src/types.ts` + `validate.ts` + `index.ts` | BridgeFrame today: dispose / read-log / permission; **GAP-001**: add `session/resume` (+ optional `session/continue-capability`) | 👁 |
| `packages/sdk/server/src/server.ts` | `createSession` → **only** `agents.create` (spike IDE gap); Continue must **not** rely on post-dispose create | 👁 |
| `packages/acp/acp/src/session.ts` | Reference pattern: `AcpSession.resume` → `ctx.agents.resume({ resumeSessionId })` | 👁 |
| `packages/core/agent/src/index.ts` | `ResumeAgentOptions` / `agents.resume` — proven by T-0b L1 | 👁 |
| `apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts` | `probeContinueCapability` / `prefixUnchanged` / `continueLinkFromDerive` — promote into product | 👁 |
| `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts` | `probeIncomplete` / Diff recoverability — AC-77 product signal source | 👁 |
| **NEW** (likely) restore planner + Continue command / L2 hooks | `restoreOpenTabs`, `dsh.continueConversation`, `dsh.test.restoreOpenTabs`, `dsh.test.continue` | 📊 design + spec VP-3-* |

## 4. Key Entry Points / Call Paths

### Path A — Restart restore openTabSet (phase-3 primary; **not implemented**)

```
Extension activate / dsh.startSession (after Host connected)
  → read ExtensionIndex.workspaceState.openTabSet + activeSessionId
  → filter empty Tabs (no messages / never sent; also drop corrupt rows)
       # write-back sanitized openTabSet immediately (AD-CU-3/4)
  → if Host not ready:
       panel/state mode=waiting-host   # AC-69
       keep index visible; do NOT auto-prompt
  → when Host ready:
       select UI set: activeSessionId first, then fill to N=restoreUiLimit
       for each UI Tab:
         mint NEW tabId (reopen lifecycle) OR restore planner policy
         force mode=replay (even if stored mode=live / liveIntent)  # AC-33
         readSessionLog → hydrateFromAuthoritativeLog
         MessageStore.replace + TimelineStore.replace
       focus active Tab; non-UI indexed Tabs remain in openTabSet (AC-70)
       「查看更多 / 全部恢复」 hydrates additional index rows on demand
```

✅ CONFIRMED: index persistence + N default exist (`extension-index.ts`); `openFromHistory` is the closest hydrate primitive.  
✅ CONFIRMED: `dsh.startSession` currently binds controller then **always** `newConversation('New conversation')` — no restore path (`extension.ts`).  
⚠️ HYPOTHESIS: product may reuse `openFromHistory` in a loop with a planner that rewrites mode→replay and applies N selection; tabId on cold restore should be **new** per AD-CU-5 (Continue keeps tabId only within one open period).

### Path B — waiting-host → replay (AC-69)

```
Restore requested while IdeSessionHost.status !== 'connected'
  → panelHost.pushFullState → mode=waiting-host (+ empty messages clear)
  → Host start / bridge hello / initialize succeeds
  → restore orchestrator resumes hydrate for pending openTabSet UI set
  → messages/replace + panel/state mode=replay
```

✅ CONFIRMED: empty chrome already maps disconnected → `waiting-host` (`chat-panel-host.ts`).  
⚠️ HYPOTHESIS: need an explicit “pending restore” latch so connect does not only create a blank Tab.

### Path C — Replay Diff / incomplete (AC-76/77 + AD-CU-6)

```
tool/result.meta.diffs
  → recoverableDiffsFromMeta / TimelineStore extract
       requires path + newText + (oldText: string|null)
       patch-only (missing oldText) → [] → Diff disabled + explain
  → openTimelineDiff(hunk)
       left: dsh-diff virtual doc from hunk.oldText (create: '')
       right: TODAY Uri.file(workspace path) if absolute   # ⚠ AD-CU-6
```

Incomplete:

```
authoritative events (raw / cold-balanced)
  → spike probeIncomplete: open turn OR turn/end reason.kind=interrupted
  → product ChatMessage.incomplete | notice 「已停止/未完成」  # NOT wired in hydrate yet
```

✅ CONFIRMED: patch-only rejection already in product hydrator + phase-2 tests.  
✅ CONFIRMED: `ChatMessage.incomplete` exists but `hydrateFromAuthoritativeLog` never sets it.  
✅ CONFIRMED: Diff after side can read **current disk** (`diff-entry.ts`) — must fix for replay Diff before gate.

### Path D — Continue same-id (GAP-001 + AD-CU-8; **not implemented**)

```
T-0b Gate = same-id (PASS)
  → probeContinueCapability({ gateVerdict:'same-id', sessionExists, resumeApiAvailable })
  → SessionIndexEntry.continueCapability = 'same-id'
  → Top-bar Continue ENABLED (list already shows「可继续」 via continueCapabilityListHint)

User Continue / dsh.test.continue / action/continue
  → IdeSessionHost.resumeSession(sessionId)
       → BridgeFrame session/resume { id, sessionId }
       → ide-bridge handleResume:
            ctx.agents.resume({ resumeSessionId })   # AcpSession.resume pattern
            → session/resume/response ok
  → ConversationRegistry.setMode(tabId, 'live')      # same open-period tabId
  → persistOpenTabs (mode=live immediately)
  → panel/state mode=live; composer ungated
  → follow-up prompt via existing session/prompt (prefix unchanged — AC-66)

FAIL / unknown paths (AD-CU-8):
  FAIL Gate → hide Continue
  unknown / missing probe → disable + tooltip「暂不可用」
  derive-only → available + 「新会话 · 接续自 …」(fallback; Gate chose same-id)
```

✅ CONFIRMED: SDK `getOrCreateSession` → `agents.create` only; post-dispose same-id create fails (`SessionAlreadyExistsError`) — spike evidence.  
✅ CONFIRMED: BridgeFrame has **no** `session/resume` today.  
✅ CONFIRMED: `agents.resume` works at L1 (T-0b) and in ACP.

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|:----:|
| `extension.ts` `dsh.startSession` / activate | Replace blank `newConversation` with restore orchestrator + L2 hooks (`restore`, `continue`, Diff probes) | **HIGH** |
| `conversation-controller.ts` | Add `restoreOpenTabSet` / `continueConversation` / empty-tab strip write-back / incomplete hydrate wiring | **HIGH** |
| `packages/ide/ide-bridge` types/validate/handler | Add `session/resume` (+ optional continue-capability); wire `agents.resume` | **HIGH** (GAP-001) |
| `session-host.ts` | Client round-trip for resume (mirror `readSessionLog` / `disposeSession`) | **HIGH** |
| `replay-hydrator.ts` | Set `incomplete` / notice from open-turn / interrupted closers; optional patch-before rebuild helper | **MEDIUM** |
| `diff-entry.ts` (+ Timeline Diff command) | Replay Diff: both sides from log snapshots; ban workspace before/after | **MEDIUM** |
| `chat-panel/protocol.ts` + provider + host | Continue chrome / `action/continue`; banners for derive | **MEDIUM** |
| `extension-index.ts` | Stronger empty-Tab purge on load; maybe write `liveIntent` on persist; restore planner helpers | **MEDIUM** |
| `history-view.ts` / README | Document N / 查看更多 / Continue / empty Tab; keep list↔top-bar decoupled | **LOW** |
| `packages/sdk/server/src/server.ts` | Prefer **not** expanding stdout (AD-8); Continue via bridge. Optional note only if product mistakenly calls create | **LOW** |
| Tests: new `phase3-*.spec.ts` + test-scripts | VP-3-restore / VP-3-diff / VP-3-continue (condition met) | **HIGH** |
| `tech-debt-registry.md` | Move GAP-001 → 已解决 after land | process |

## 6. Existing Constraints / Conventions

- **AD-CU-1**: Webview is thin — no local mode authority; Continue must flip Host `panel/state`.
- **AD-CU-3/4/10**: Empty Tabs never persist; restore strips empties; `openTabSet` / `mode` / `activeSessionId` write on every mutation (already via `writeImmediate`); UI N=8 default; index keeps full non-empty set.
- **AD-CU-5**: One open view per `sessionId`; tabId destroyed on close; Continue upgrades **same open-period** tabId only; restart restore presents **replay** even if `liveIntent`.
- **AD-CU-6**: Diff only from recoverable `meta.diffs`; patch-only needs authoritative before; **no current-disk before/after**.
- **AD-CU-8**: Capability tokens `same-id` \| `derive-only` \| `unknown`; list hints ≠ top-bar Continue; T-0b FAIL hides Continue (N/A — Gate PASS).
- **AD-CU-12 / AD-8**: Do not change `agent-loop`; do not expand SDK stdout for resume; bridge thin adapt in `packages/ide/ide-bridge`.
- **Registrations are effects**; branded ids; ESM; Host L2 hooks must drive behavior without Webview (spec AC-54/84).
- Close ≠ dispose (phase-1); history open already uses new tabId + replay (phase-2).

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| T-0b Gate = **same-id PASS** | ✅ CONFIRMED | `spike-report.md`; Continue unblocked |
| GAP-001 still open (no bridge resume) | ✅ CONFIRMED | `BridgeFrame` + handler lack resume; registry matches |
| No product restore on startSession | ✅ CONFIRMED | always `newConversation` after connect |
| `liveIntent` typed but never written | ✅ CONFIRMED | only appears on `OpenTabRecord` interface |
| `restoreUiLimit` stored but unused for selection | ✅ CONFIRMED | default 8; no planner consumes it for hydrate subset |
| Empty-Tab recovery: sanitize does **not** content-check | ✅ CONFIRMED | load filter is structural (tabId/sessionId/mode); content empty needs message/log proof at restore |
| Incomplete UI not product-wired | ✅ CONFIRMED | spike probe only; hydrator omits `incomplete` |
| Diff after uses workspace file | ✅ CONFIRMED | conflicts with AD-CU-6 for replay Diff |
| Patch-only **before rebuild** from prior snapshot | ❓ UNKNOWN | product currently **rejects** patch-only; phase-3 may need reconstruct-or-disable (spec: if cannot rebuild → unavailable) |
| Exact tabId policy on cold restart | ⚠️ HYPOTHESIS | AD-CU-5 says reopen mints new tabId; persisted `OpenTabRecord.tabId` may be ignored on restore |
| Whether SDK server also needs resume method | ⚠️ HYPOTHESIS | spike prefers bridge-only; stdout stay create/prompt/shutdown |
| 「查看更多」 UI surface | ⚠️ HYPOTHESIS | command vs panel banner — not coded; must be Host-drivable for L2 |

## 8. Uncertain / Unverified

| Symbol | Status | Do not assume |
|--------|--------|----------------|
| Product `restoreOpenTabSet` / planner | Missing | Behavior of N selection + active priority until implemented |
| `session/resume` bridge handler | Missing | Error mapping, timeout, live-session conflict vs ACP rules |
| `session/continue-capability` frame | Optional / missing | May use Gate-constant `same-id` until probe lands (spike allows) |
| Patch-before reconstruction algorithm | Unverified in product | No code walks prior turn snapshots to fill `oldText` |
| Webview Continue button / tooltip i18n | Unverified | Locale-owned copy rules apply when UI lands |
| Cross-window / multi-folder workspaceKey collisions | Unverified | Index is folder-path keyed today |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:------------:|------------|:----:|
| GAP-001 | `packages/sdk/server/src/server.ts`: `createSession` / `getOrCreateSession`; `packages/ide/ide-bridge` 无 `session/resume` | 功能缺失 → phase-3 Continue | SDK still `agents.create` only; BridgeFrame has dispose/read-log/permission only — **no** resume/continue-capability | ✅ 匹配 — **close in this Phase** |
| DEBT-001 | ReplayHydrator Timeline oracle | 已解决 (phase-2) | Product hydrator + phase-2 DEBT-001 tests present | ✅ 已关闭 |
| DEBT-002 | Dual-running status | 已解决 (phase-2) | phase-2 fixture closed | ✅ 已关闭 |

### Stub Detection Summary

- ✅ Confirmed stubs/gaps matching registry: **1** (GAP-001)
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0** (no `@STUB` / empty Continue handlers found)
- 🟡 Attention (not registry stubs): missing restore orchestration; `incomplete` unused; Diff workspace after; `liveIntent` unused — these are **phase-3 scope work**, not unregistered stubs

**No 🔴 blocking debt** for Phase Entry Gate.

### GAP-001 落点（implementer 优先）

| Layer | File | Work |
|-------|------|------|
| Bridge types | `packages/ide/ide-bridge/src/types.ts` | Add `session/resume` + `/response` (+ optional `session/continue-capability`) to `BridgeFrame` |
| Bridge validate | `packages/ide/ide-bridge/src/validate.ts` | Accept/reject frames |
| Bridge runtime | `packages/ide/ide-bridge/src/index.ts` | `handleResume` → `ctx.agents.resume({ resumeSessionId })` (mirror `AcpSession.resume` / dispose service pattern) |
| Host client | `apps/vscode-dsh/src/session-host.ts` | `resumeSession(sessionId)` round-trip like `readSessionLog` |
| Product Continue | `apps/vscode-dsh/src/conversation-controller.ts` | `continueConversation(tabId)` → resume → `registry.setMode(..., 'live')` → persist |
| UI / L2 | `extension.ts` + `chat-panel/*` | Command + optional `action/continue`; `dsh.test.continue` |
| Probe reuse | promote `tests/spike-t0b-continue-helpers.ts` → `src/` (or shared module) | AD-CU-8 mapping |
| **Avoid** | Expanding SDK stdout `session/prompt` path to silent resume | Violates AD-8 / spike guidance |

## 10. Recommended Next Reads

1. ⭐ MUST READ — `phases/phase-3-restart-continue/spec.md` (AC-33/34/69/70/76/77/32/66–68 + VP table)
2. ⭐ MUST READ — `design.md` AD-CU-3/4/5/6/8/10 + Continue skeleton `upgradeReplayToLive`
3. ⭐ MUST READ — `phases/phase-0b-spike-continue-capability/spike-report.md` (Gate same-id + GAP wiring)
4. ⭐ MUST READ — `apps/vscode-dsh/src/extension-index.ts` + `conversation-controller.ts` (`openFromHistory` / `persistOpenTabs`)
5. ⭐ MUST READ — `packages/ide/ide-bridge/src/types.ts` + `index.ts` (`handleReadLog` / `handleDispose` as resume template)
6. ⭐ MUST READ — `packages/acp/acp/src/session.ts` (`AcpSession.resume`)
7. 🔷 SHOULD READ — `apps/vscode-dsh/src/replay-hydrator.ts` + `diff-entry.ts` + `tests/spike-t0a-replay-hydrator.ts` (`probeIncomplete`)
8. 🔷 SHOULD READ — `apps/vscode-dsh/src/session-host.ts` (`readSessionLog` pattern)
9. 🔷 SHOULD READ — `apps/vscode-dsh/tests/spike-t0b-continue-helpers.ts` + `spike-t0b-continue-capability.spec.ts`
10. 🔷 SHOULD READ — `apps/vscode-dsh/src/extension.ts` (`dsh.startSession`, L2 hooks)
11. 🔹 OPTIONAL — `packages/sdk/server/src/server.ts` (`createSession` gap evidence)
12. 🔹 OPTIONAL — phase-2 `implementation.md` / `repo-exploration.md` for landed baseline

---

### Preferential edit list (≤12)

1. `packages/ide/ide-bridge/src/types.ts`
2. `packages/ide/ide-bridge/src/validate.ts`
3. `packages/ide/ide-bridge/src/index.ts`
4. `apps/vscode-dsh/src/session-host.ts`
5. `apps/vscode-dsh/src/conversation-controller.ts`
6. `apps/vscode-dsh/src/extension.ts`
7. `apps/vscode-dsh/src/extension-index.ts`
8. `apps/vscode-dsh/src/replay-hydrator.ts`
9. `apps/vscode-dsh/src/diff-entry.ts`
10. `apps/vscode-dsh/src/chat-panel/protocol.ts` (+ host/provider as needed)
11. `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` (new) + test-scripts
12. `apps/vscode-dsh/README.md` (N / 查看更多 / Continue / empty Tab)
