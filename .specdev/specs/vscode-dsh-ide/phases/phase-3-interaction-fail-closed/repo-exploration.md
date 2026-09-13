# Repository Exploration Report — Phase 3: Interaction Fail-Closed

## 1. Task Context

Phase `phase-3-interaction-fail-closed` fills STUB-001 / STUB-002 and delivers the Host-bridge human-interaction loop: when DSH emits `approval/request` or `user-questions/request`, `ide-bridge` forwards over the non-stdout UDS/NDJSON bridge; the VS Code Extension shows UI bound to the correct Tab/`sessionId` (AC-10); Host responses map to legal `ApprovalOutcome` / `AskUserQuestionAnswer` (AC-16/17); disconnect, timeout, throw, illegal payload, and child-process death all fail-closed without silent allow (AC-19/20/30/31). Permission UI must call only `dsh-permission-presets` (AC-21/22). Must not remount Web `ui-approval` / `ui-user-questions`. ≥1 integration + ≥1 independent e2e (AC-33).

**Updated for Phase 3** vs Phase 2 exploration: multi-Tab registry, `session/dispose`, and `IdeSessionHost` prompt/dispose routing exist; approval/questions answerers remain fail-closed stubs; Host `onBridgeFrame` ignores interaction frames; no ApprovalPanel / Questions / PermissionPicker UI.

## 2. Repository Overview

- **Language / runtime:** TypeScript ESM, Node `^22.19 || >=24`, Cordis plugins, pnpm workspaces.
- **IDE stack (Phases 1–2):** `apps/vscode-dsh` + `packages/ide/ide-bridge` + `packages/bundle/ide` (`dsh-base` + `sdk-app` + `ide-bridge`, `profile: ide`).
- **Dual channel (unchanged):** SDK NDJSON JSON-RPC on child stdio; Host bridge UDS/named-pipe NDJSON via `DSH_IDE_BRIDGE_SOCK` (AC-18 — do not regress).
- **Interaction capability packages:** `packages/interaction/user-approval`, `user-questions`, `permission-presets` (Service Definitions + waterfall events).
- **ACP precedent:** `packages/acp/acp` registers a machine `approval/request` answerer over ACP JSON-RPC `session/request_permission` (same-process waterfall → client RPC). No ACP `user-questions` answerer.
- **Anti-pattern:** `packages/client/ui-approval` / `ui-user-questions` are Web Host answerers — **forbidden** on the ide profile (AD-3 / AC-5).

## 3. Most Relevant Areas

| Path | Why it matters | Source |
|------|----------------|--------|
| `packages/ide/ide-bridge/src/index.ts` | **STUB-001/002** terminal answerers; only handles Host `session/dispose` inbound today | 👁 |
| `packages/ide/ide-bridge/src/types.ts` | `BridgeFrame` already declares approval / user-questions request+response kinds; **no** `permission/select` yet | 👁 |
| `packages/ide/ide-bridge/src/{client,host,ndjson}.ts` | Transport + framing; `parseBridgeFrame` is kind-only (weak for AC-31) | 👁 |
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | Asserts stub fail-closed + dispose round-trip; must grow for real round-trips | 👁 |
| `packages/ide/ide-bridge/README.md` | Explicitly defers Host UI round-trips + permission RPC to later phase | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | Host listen + spawn; `onBridgeFrame` only hello + dispose/response; `pendingDispose` timeout pattern reusable | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | `getBySessionId` exists for AC-10 Tab routing; no `pendingInteraction` field yet | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | Tab ↔ prompt/dispose; no interaction wait-state API | 👁 |
| `apps/vscode-dsh/src/extension.ts` | Commands for start/stop/new/switch/close; **no** approval/questions/permission commands or panels | 👁 |
| `packages/interaction/user-approval/src/{index,types}.ts` | `ApprovalOutcome` vocabulary; waterfall + service fail-closed / normalize rogue returns | 👁 |
| `packages/interaction/user-questions/src/{index,types}.ts` | `AskUserQuestionAnswer`; `UserQuestionError` codes incl. `NO_PROVIDER` | 👁 |
| `packages/interaction/permission-presets/src/index.ts` | Sole permission authority: `set(session, name)` / `/permission` command + `permissions` projection | 👁 |
| `packages/acp/acp/src/index.ts` L152–173 | Ownership-gated approval answerer + outcome mapping (primary precedent) | 👁 |
| `packages/acp/acp/tests/approval.spec.ts` | Maps allow/reject/cancel; unknown→reject; client throw→`unavailable`; foreign/`next()` | 👁 |
| `packages/client/ui-approval/src/client/index.ts` | Web pending-interaction pattern (reference only — do not mount) | 👁 |
| `packages/bundle/ide/cordis.patch.yml` | Mounts only `ide-bridge`; comments forbid ui-approval dual-mount | 👁 |
| `.specdev/specs/vscode-dsh-ide/design.md` AD-4/AD-5/AD-6 | Terminal answerer semantics; Tab anti-cross-talk; permission-presets only | 👁 |
| `tech-debt-registry.md` | STUB-001/002 → this Phase (🟡 non-blocking) | 👁 |

**Absent (Phase 3 must create):**

| Path / symbol | Design role |
|---------------|-------------|
| Real bridge round-trip in answerers | Replace stubs: send request, await response, map outcomes |
| Host pending-interaction map + timeout | Mirror `pendingDispose`; settle on disconnect/shutdown |
| Extension ApprovalPanel / Questions UI | AC-16/17 presentation; bind via `sessionId` → Tab |
| PermissionPicker + bridge permission RPC | AC-21/22; frame kind missing from `BridgeFrame` today |
| Stricter inbound frame validation | AC-31 (beyond `kind: string` cast) |
| Fail-closed tests: disconnect / timeout / illegal / child exit | AC-19/30/33 |

## 4. Key Entry Points / Call Paths

### Path A — Approval waterfall → Host UI (Phase 3 primary; currently stubbed)

```
Tool / policy asks approval
  → ApprovalService.request(req)          // requires open turn; audits asked/decided
  → ctx.waterfall('approval/request', req, default=unavailable)
       → ide-bridge listener (terminal)
            TODAY: return 'unavailable'   // STUB-001; does NOT call next()
            NEEDED:
              if !connected → 'unavailable'
              send BridgeFrame { kind:'approval/request', id, sessionId: agent.session.id, toolName, reason? }
              await Host approval/response (timeout / abort)
              map legal ApprovalOutcome; illegal → 'unavailable'
  → session.append('approval/decided', { outcome })
  → tool continues / rejects under existing contract (AC-20: waterfall blocks until settle)
```

✅ CONFIRMED stub + ApprovalService fail-closed containment.
✅ CONFIRMED `BridgeFrame` request/response kinds already typed.
⚠️ HYPOTHESIS: ownership filter like ACP (`ownedRecord` / `next()` for foreign agents) — current stub claims **every** request (matches AD-4 “terminal for ide profile” but diverges from ACP’s ownership `next()`).

### Path B — User-questions waterfall → Host UI (stubbed)

```
UserQuestionService.ask(request)
  → validate questions / live root agent
  → waterfall('user-questions/request', …, noAnswerer=NO_PROVIDER)
       → ide-bridge TODAY: reject UserQuestionError NO_PROVIDER  // STUB-002
       → NEEDED: bridge round-trip → AskUserQuestionAnswer
```

✅ CONFIRMED: ACP has **no** user-questions answerer — IDE must invent Host UI mapping; Web `ui-user-questions` is reference-only.
✅ CONFIRMED: answer shape is `{ answers: AskUserQuestionAnswerItem[] }`.

### Path C — ACP approval precedent (machine client, same waterfall role)

```
ctx.on('approval/request', (request, next) => {
  record = ownedRecord(request.agent)
  if (!record || !request.callId) return next()
  drainUpdates → conn.request(session/requestPermission, { allow-once, reject-once })
  map: cancelled | allow-once→allowed-once | else→rejected
})
// client throw → ApprovalService.catch → 'unavailable'
```

✅ CONFIRMED in `packages/acp/acp/src/index.ts` + `tests/approval.spec.ts`.
Note: ACP uses **same** JSON-RPC channel; IDE must use **side** bridge (AD-2).

### Path D — Permission preset (AC-21/22; bridge RPC missing)

```
Extension PermissionPicker selects preset name
  → NEEDED: Host→runtime frame (design: permission/select { sessionId, preset })
  → runtime: ctx.permissionPresets.set(session, name)
       → append permission/preset + setSandboxMode + setApprovalPolicy/setPolicy
  → subsequent sandbox + approval policy match preset
```

✅ CONFIRMED sole write API: `PermissionPresetService.set` / `/permission` command.
✅ CONFIRMED `BridgeFrame` **lacks** permission kinds today (README: deferred).
⚠️ HYPOTHESIS: implement Host→runtime `permission/select` (+ optional response) in this Phase per design.md wire sketch.

### Path E — Tab association (AC-10; Host side partial)

```
approval/request frame.sessionId
  → ConversationRegistry.getBySessionId(sessionId)
  → focus / annotate that Tab; record pendingInteraction
  → user answers → approval/response { id, outcome } on same connection
```

✅ CONFIRMED `getBySessionId` exists.
❌ ABSENT: pending-interaction state, UI panels, Host handler for inbound approval/questions requests.

## 5. Likely Impact Surface

| Area | Change type | Risk |
|------|-------------|------|
| `packages/ide/ide-bridge/src/index.ts` | Replace stubs with awaitable round-trips; pending-map; timeout; ownership policy | 🔴 High — core AC-16/17/19/20 |
| `packages/ide/ide-bridge/src/types.ts` | Possibly add permission frames; tighten response types (`AskUserQuestionAnswer` vs `unknown`) | 🟠 Medium |
| `packages/ide/ide-bridge/src/ndjson.ts` | Stricter `parseBridgeFrame` / validators for AC-31 | 🟠 Medium |
| `apps/vscode-dsh/src/session-host.ts` | Handle inbound approval/questions; pending maps; cancel on shutdown/transport death (AC-30) | 🔴 High |
| `apps/vscode-dsh/src/conversation-*` + `extension.ts` | Pending interaction binding; Approval/Questions/Permission UI | 🔴 High |
| `packages/ide/ide-bridge/tests` + `apps/vscode-dsh/tests` | Fail-closed matrix + Tab routing + e2e | 🟠 Medium |
| `tech-debt-registry.md` | Move STUB-001/002 → resolved when filled | 🟢 Low |
| `packages/bundle/ide` | Likely unchanged if only bridge behavior grows | 🟢 Low |
| `packages/interaction/*` | Prefer **consume**, not change Service Definitions | 🟢 Low (avoid unless wire gap) |

## 6. Existing Constraints / Conventions

- **AD-4:** Terminal answerer; on owned/claimed requests do **not** `next()` to an empty Web Host; fail with `unavailable` / equivalent.
- **AD-3 / AC-5:** Never mount `dsh-client-ui-approval` / `ui-user-questions` on ide profile.
- **AD-6 / AC-22:** Permission changes only through `permission-presets` (no second authority).
- **AD-2 / AC-18:** Interaction traffic stays on Host bridge, never SDK stdout.
- **Waterfall semantics:** Returning without `next()` claims the request; `ApprovalService` already normalizes rogue outcomes and contains throws → `unavailable`.
- **User-questions fail-closed:** Missing answerer → `UserQuestionError` `NO_PROVIDER`; abort → `ASK_ABORTED`.
- **Registrations are effects:** keep `ctx.on` / `ctx.effect` disposal clean (client close on fiber dispose already present).
- **Dispose timeout pattern:** `IdeSessionHost.disposeTimeoutMs` + `pendingDispose` Map is the template for approval/question waits.
- **Tests:** Prefer keyless bridge/fail-closed paths; REAL composition for product-visible plugins where required by package policy.
- **Per-file comments / JSDoc:** Follow package AGENTS; update README Known Limitations when stubs leave.

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| STUB-001/002 still match registry behavior | ✅ CONFIRMED | Lines shifted (~95/101 vs registry L86/L92); behavior identical |
| `BridgeFrame` already has approval/questions kinds | ✅ CONFIRMED | Host does not handle them yet |
| ApprovalService contains throw/illegal → `unavailable` | ✅ CONFIRMED | Extra Host validation still required (AC-31) |
| ACP is the approval mapping precedent | ✅ CONFIRMED | No user-questions ACP precedent |
| Permission bridge frame not implemented | ✅ CONFIRMED | Design shows it; types/README defer |
| Whether ide-bridge should `next()` for non-owned agents | ⚠️ HYPOTHESIS | AD-4 says next for non-owned; current stub claims all; ide profile has no second answerer so either works fail-closed, but ownership filtering aids future composition |
| How to surface Questions UI in VS Code (modal vs webview vs QuickPick) | ❓ UNKNOWN | Spec says “Questions UI”; presentation strategy is AD-8 replaceable |
| Child-process exit → cancel pending UI waits | ⚠️ HYPOTHESIS | `shutdownInternal` clears dispose waiters; need explicit child/`TransportClosed` watch for in-flight approval/questions (AC-30) |
| Exact timeout default for interaction waits | ❓ UNKNOWN | Dispose default 5000ms; design does not pin approval timeout |
| Mapping `agent.session.id` ↔ Tab `sessionId` | ✅ CONFIRMED | Both are SDK session UUIDs; registry already keys on them |

## 8. Uncertain / Unverified

- **`PermissionPresetService` live `setPolicy` path from bridge:** `/permission` command uses `ctx.approval.setPolicy(agent, …)` for live switches; `set(session, name)` uses `setApprovalPolicy(session, …)` (log-only). Bridge handler must pick the correct writer for a live agent session — body of `set` / command handler read, but Host wiring not yet designed.
- **SDK notification subscription for “tool is waiting” UX:** Host may rely solely on bridge request frames; whether timeline status also needs `session.event` filtering was not verified in this pass.
- **Windows named-pipe approval latency / path quirks:** Host server supports pipe paths; fail-closed tests today are UDS-oriented.
- **AbortSignal from ApprovalRequest / AskUserQuestionRequest:** Must race Host wait vs `signal` → `cancelled` / `ASK_ABORTED`; Host UI cancel semantics not specified beyond vocabulary.
- **Illegal `AskUserQuestionAnswer` structure:** Service does not appear to deeply validate answer items after waterfall return — Host→runtime validation should reject malformed answers before resolving the waterfall.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| STUB-001 | `packages/ide/ide-bridge/src/index.ts:apply` (~L95–97; registry cites L86) | Claims every `approval/request`, returns `unavailable`, no Host round-trip | Same: `@STUB(phase-3-interaction-fail-closed)`, returns `'unavailable'`, does not call `next()` | ✅ 匹配（行号漂移） |
| STUB-002 | `packages/ide/ide-bridge/src/index.ts:apply` (~L101–105; registry cites L92) | Claims every `user-questions/request`, rejects `NO_PROVIDER` | Same: rejects `UserQuestionError(..., 'NO_PROVIDER')` | ✅ 匹配（行号漂移） |
| — | `parseBridgeFrame` | 未注册 | Accepts any object with string `kind` as `BridgeFrame` (weak validation) | 🟡 非桩；AC-31 缺口 |
| — | `IdeSessionHost.onBridgeFrame` | 未注册 | Ignores approval/questions frames (no handler) | 🟡 功能缺失（本 Phase 范围，非已标 `@STUB`） |
| — | Extension Approval/Questions/Permission UI | 未注册 | Absent | 🟡 功能缺失（本 Phase 产出） |

### Stub Detection Summary

- ✅ Confirmed stubs: **2**（STUB-001、STUB-002 与 registry 行为一致）
- ⚠️ Registry mismatch: **0** 行为不匹配；**行号**已漂移（建议 implementer 更新 registry 定位）
- 🔴 Unregistered stubs: **0**（未发现新的 `@STUB` / 空壳函数冒充完成逻辑）
- 🟡 Phase-scope gaps (not stubs): Host interaction handlers + UI + permission RPC + inbound schema validation

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/ide/ide-bridge/src/index.ts` (stubs + dispose handler pattern)
2. ⭐ MUST READ — `packages/ide/ide-bridge/src/types.ts` (`BridgeFrame` wire contract)
3. ⭐ MUST READ — `packages/acp/acp/src/index.ts` (approval answerer) + `packages/acp/acp/tests/approval.spec.ts`
4. ⭐ MUST READ — `packages/interaction/user-approval/src/{types,index}.ts` (`ApprovalOutcome`, fail-closed decide path)
5. ⭐ MUST READ — `packages/interaction/user-questions/src/{types,index}.ts` (answer + error codes)
6. ⭐ MUST READ — `apps/vscode-dsh/src/session-host.ts` (pendingDispose / bridge lifecycle to extend)
7. 🔷 SHOULD READ — `apps/vscode-dsh/src/conversation-registry.ts` (`getBySessionId`)
8. 🔷 SHOULD READ — `packages/interaction/permission-presets/src/index.ts` (`set` / `/permission`)
9. 🔷 SHOULD READ — `.specdev/specs/vscode-dsh-ide/design.md` AD-4 / AD-5 / AD-6 + bridge frame sketch
10. 🔹 OPTIONAL — `packages/client/ui-approval` / `ui-user-questions` (pending-interaction UX patterns only)
11. 🔹 OPTIONAL — Phase 1/2 `implementation.md` (confirm STUB deferral history)
