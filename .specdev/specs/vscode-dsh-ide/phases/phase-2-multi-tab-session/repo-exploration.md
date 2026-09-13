# Repository Exploration Report — Phase 2: Multi-Tab Session Binding

## 1. Task Context

Phase `phase-2-multi-tab-session` must deliver multi-conversation Tabs inside one VS Code workspace window: each Tab binds a distinct SDK `sessionId`; switching Tabs retargets input and visible session state; closing a Tab ends that session by default (Q-3 / AD-5). One `dsh --profile ide` subprocess continues to own agent-loop, tools, and persistence (AC-15). Dispose must travel Host→runtime over the ide-bridge (`session/dispose` → `AgentHandle.dispose()`), **not** via a new SDK stdout method. Approval/question Host UI remains Phase 3 (STUB-001/002). AC coverage: AC-6/7/8/9/11/15/33.

**Updated for Phase 2** relative to Phase 1 exploration: `ide` profile, `apps/vscode-dsh`, and `packages/ide/ide-bridge` now exist; gaps are multi-Tab registry/UI, Host prompt routing, and per-session dispose ownership.

## 2. Repository Overview

- **Language / runtime:** TypeScript ESM, Node `^22.19 || >=24`, Cordis plugins, pnpm workspaces.
- **IDE surface after Phase 1:** `apps/vscode-dsh` (Extension host) + `packages/ide/ide-bridge` + `packages/bundle/ide` (`dsh-base` + `sdk-app` + `ide-bridge`, `profile: ide`).
- **Dual channel (unchanged):** SDK NDJSON JSON-RPC on child stdio; Host bridge UDS/named-pipe NDJSON via `DSH_IDE_BRIDGE_SOCK`.
- **SDK multi-session reality:** `HarnessSdkJsonRpcServer` creates one agent per `sessionId` on first `session/prompt` (`getOrCreateSession`). Protocol documents **no cancel / session-close** methods (`packages/sdk/protocol/README.md` Known Limitations).
- **Product launch rule:** Extension must keep spawning `dsh --profile ide` only; no new Cordis bin.

## 3. Most Relevant Areas

| Path | Why it matters | Source |
|------|----------------|--------|
| `apps/vscode-dsh/src/session-host.ts` | Window-scoped process owner; **private** `HarnessClient`; no Tab/prompt/dispose APIs yet | 👁 |
| `apps/vscode-dsh/src/extension.ts` | Single module `host`; only `dsh.startSession` / `dsh.stopSession`; no Tab commands / WebviewView | 👁 |
| `apps/vscode-dsh/package.json` | `contributes.commands` only — no views, no Tab UI contribution points | 👁 |
| `apps/vscode-dsh/tests/session-host.spec.ts` | Lifecycle + redact fixtures to extend for ≥2-session routing | 👁 |
| `packages/ide/ide-bridge/src/types.ts` | `BridgeFrame` has hello/approval/questions/error — **no** `session/dispose` | 👁 |
| `packages/ide/ide-bridge/src/index.ts` | Runtime bridge client + Phase-3 answerer stubs; README defers session/dispose | 👁 |
| `packages/ide/ide-bridge/src/{host,client,ndjson}.ts` | Reusable Host listen / runtime connect / NDJSON framing for new dispose frames | 👁 |
| `packages/sdk/server/src/server.ts` | Owns `sessions: Map<sessionId, {handle}>`; get-or-create; shutdown disposes **all**; no per-id dispose API; zombie detection if handle disposed outside | 👁 |
| `packages/sdk/server/src/index.ts` | Publishes transport handlers only — **does not** `provide` the server instance as a Cordis service | 👁 |
| `packages/sdk/protocol/src/types.ts` + README Known Limitations | Wire methods: `initialize` / `session/prompt` / `shutdown` only — do **not** add `session/close` | 👁 |
| `packages/sdk/client/src/client.ts` | `prompt(sessionId, blocks)` already targets any id; `close()` tears down whole process | 👁 |
| `packages/sdk/client/src/api.ts` | `DeepSeekHarness.session(id?)` — multi-session-on-one-client pattern (mint UUID / reuse id) | 👁 |
| `packages/core/agent/src/index.ts` | `AgentHandle.dispose()` contract: stop loop, unregister, remove session, unwind scope | 👁 |
| `packages/acp/acp/src/session.ts` | Precedent: session module holds `AgentHandle` and closes via `handle.dispose()` | 👁 |
| `packages/bundle/base/cordis.patch.yml` | Includes `session-title` — usable later for AC-11 title signals via session events | 👁 |
| `packages/client/ui-workspace/**` | Web multi-session UX reference only — **not** to mount in ide profile | 👁 |
| `.specdev/specs/vscode-dsh-ide/design.md` | AD-1 / AD-5 / Q-3 / ConversationTab / multi-session lifecycle | 👁 |
| `tech-debt-registry.md` | STUB-001/002 → Phase 3; no Phase-2 blocking stubs | 👁 |

**Absent (Phase 2 must create):**

| Path / symbol | Design role |
|---------------|-------------|
| `ConversationRegistry` / `ConversationTab` | Extension authority for `tabId ↔ sessionId`, active pointer, titles |
| Tab bar UI + new/switch/close commands | AC-6/7/8/9 |
| Host→runtime `session/dispose` frames + handler | Q-3 dispose path |
| `IdeSessionHost` prompt / dispose / notification filter APIs | Route activity Tab without second process |
| Default close-policy docs (README) | Documented Q-3 default |

## 4. Key Entry Points / Call Paths

### Path A — Window process lifecycle (Phase 1, **reuse**)

```
activate → dsh.startSession
  → IdeSessionHost.start
       → IdeBridgeHostServer.listen(path)
       → HarnessClient({ profile: 'ide', env: DSH_IDE_BRIDGE_SOCK… })
       → client.initialize(cwd, provider, model)
       → status = 'connected'   // one process per window (AD-1)
deactivate / dsh.stopSession
  → client.close() → protocol shutdown → dispose ladder
  → bridge.close()
```

✅ CONFIRMED in `session-host.ts` / `extension.ts`. Phase 2 must **not** spawn a process per Tab.

### Path B — Multi-session prompt (SDK today → Extension must wire)

```
active Tab (sessionId = UUID)
  → (needed) IdeSessionHost / registry → HarnessClient.prompt(sessionId, blocks)
  → stdout JSON-RPC session/prompt
  → HarnessSdkJsonRpcServer.getOrCreateSession(sessionId)
       → ctx.agents.create({ sessionId })   // first prompt only
       → agent.followup(userMessage)
  → { messageId }
  → notifications session.event / session.status (filter by sessionId for Tab timeline)
```

✅ CONFIRMED server get-or-create + client `prompt(sessionId, …)`.
⚠️ HYPOTHESIS: Extension notification subscription/filtering UX — `HarnessClient` supports tree subscribe helpers; Host currently does not expose them.

### Path C — Close Tab dispose (**missing; Phase 2 primary seam**)

```
close Tab
  → ConversationRegistry.remove(tabId)
  → Host sends bridge frame session/dispose { sessionId }   // NOT stdout
  → IdeBridgeClient receives → must obtain AgentHandle for that id
  → handle.dispose()
  → server Map entry must be cleared (or equivalent owned dispose)
```

✅ CONFIRMED: protocol has no `session/close`; design mandates bridge dispose.
✅ CONFIRMED gap: `BridgeFrame` lacks dispose kinds; `ide-bridge` `apply()` has no dispose handler; `HarnessSdkJsonRpcServer.sessions` is private and unpublished.
⚠️ HYPOTHESIS (implementation choice): publish a small Cordis dispose capability from sdk-jsonrpc-server **or** add an internal `disposeSession` reached only from ide-bridge — either way must clear Map + call `handle.dispose()` to avoid zombies (see §7).

### Path D — Reference multi-session client (SDK high-level API)

```
DeepSeekHarness.session()           // mint session-<uuid>
DeepSeekHarness.session(knownId)    // reuse
  → HarnessSession.run → client.prompt(this.id, …)
```

✅ CONFIRMED in `packages/sdk/client/src/api.ts`. Good model for Extension Tab→sessionId minting (design: UUID as `sessionId`).

### Path E — ACP per-session dispose precedent

```
AcpSession.create → ctx.agents.create → keep AgentHandle
AcpSession close  → handle.dispose()
```

✅ CONFIRMED in `packages/acp/acp/src/session.ts`. ACP owns handles itself; SDK server already owns handles for ide — dispose must go through that owner (or a published capability), not a second `agents.create`.

## 5. Likely Impact Surface

| Area | Change | Risk |
|------|--------|------|
| `apps/vscode-dsh/src/` — new `ConversationRegistry` (+ Tab UI / commands) | AC-6/7/8/9/11 | **HIGH** — greenfield UI + state machine |
| `apps/vscode-dsh/src/session-host.ts` | Expose prompt / bridge send / event filter; keep one process | **HIGH** — client is currently private |
| `apps/vscode-dsh/src/extension.ts` + `package.json` contributes | New commands / views; stop conflating “window host” with “one conversation” | **HIGH** |
| `packages/ide/ide-bridge/src/types.ts` + host/client handlers | Add `session/dispose` (+ ack/error) frames | **HIGH** |
| `packages/ide/ide-bridge/src/index.ts` | Handle Host dispose frames; call into session-owner dispose | **HIGH** |
| `packages/sdk/server/src/{server,index}.ts` | Per-`sessionId` dispose that clears Map + `handle.dispose()`; optional Cordis provide | **HIGH** — ownership seam; do **not** add protocol method |
| `apps/vscode-dsh/README.md` (+ bridge README limitations) | Document default close = end session; update deferred-work bullets | **MED** |
| Tests: unit/integration (≥2 Tab switch no cross-id) + e2e (AC-33) | Fake runtime may need dispose frame support | **HIGH** |
| `tech-debt-registry.md` | No Phase-2 STUB target; leave STUB-001/002 alone | **LOW** |
| `packages/core/**/agent-loop*` / SDK protocol method set | **Forbidden** (AC-15 / design) | — |
| STUB-001/002 answerer bodies | **Out of scope** (Phase 3) | — |

## 6. Existing Constraints / Conventions

1. **AD-1:** ≤1 ide subprocess per window; multi-conversation = multi `sessionId`. ✅
2. **AD-5 / Q-3:** Tab model `ConversationTab { tabId, sessionId, title?, … }`; close Tab → dispose that session; recoverable strategy documented only, not default. ✅
3. **Do not extend SDK stdout methods** for dispose; bridge owns `session/dispose`. ✅ protocol Known Limitations + design.
4. **Stdout purity** for SDK remains; bridge traffic never writes stdout. ✅
5. **Plugin form:** ide-bridge is a function plugin (`name`/`inject`/`Config`/`apply`, no default export). ✅
6. **`AgentHandle.dispose()`** is the teardown capability; only the owning consumer should call it. ✅ agent package contract.
7. **Zombie sessions:** if an agent is detached while `SessionRecord` remains, later `session/prompt` throws `session agent was disposed outside the server: <id>` and does **not** recreate. ✅ CONFIRMED in `server.ts` + tests — Phase 2 dispose **must** remove the Map entry (or provide server-owned dispose).
8. **`HarnessClient` env:** when `env` is provided it replaces parent env; keep `buildIdeChildEnv` scrub + reinject `DSH_IDE_BRIDGE_SOCK`. ✅
9. **AC-15:** Extension drives/observes; never reimplements agent-loop / tool pipeline / persistence authority. ✅
10. **Locale / UI:** product copy should stay injectable/testable (Phase 1 used duck-typed vscode); prefer same pattern for Tab strings. ⚠️ follow existing extension style.
11. **session-title** is in `dsh-base`; LLM title provider disabled in sdk-app — AC-11 can use first-user-message summary locally and/or listen for `session/title` events if present. ⚠️ HYPOTHESIS on event delivery path through SDK notifications.

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| No `ConversationRegistry` / Tab UI / WebviewView in tree | ✅ CONFIRMED | Greenfield Extension work |
| `IdeSessionHost` does not expose `HarnessClient` or `prompt` | ✅ CONFIRMED | Must add Host APIs for AC-7 |
| `BridgeFrame` has no dispose variants | ✅ CONFIRMED | `types.ts` |
| SDK protocol has no `session/close` | ✅ CONFIRMED | README Known Limitations |
| `HarnessSdkJsonRpcServer` does not publish per-session dispose / service | ✅ CONFIRMED | Private `sessions` Map |
| External `handle.dispose()` without Map clear → permanent zombie for that id | ✅ CONFIRMED | `assertLiveAgent` path |
| ide-bridge README still lists session/dispose as deferred | ✅ CONFIRMED | Update when implementing |
| STUB-001/002 remain fail-closed answerers for Phase 3 | ✅ CONFIRMED | Do not implement in Phase 2 |
| Exact VS Code Tab chrome (WebviewView vs custom editor vs TreeView) | ❓ UNKNOWN | Spec requires Tab bar + commands; design names TabBar/ConversationView but no VS Code packaging precedent beyond command contributes |
| How ide-bridge obtains the `AgentHandle` (service provide vs shared registry vs sdk-server API) | ⚠️ HYPOTHESIS | Design says bridge calls `AgentHandle.dispose()`; ownership today is sdk-server — need an owned seam without stdout method |
| Whether Host should await dispose ack before updating Tab bar | ⚠️ HYPOTHESIS | Recommend request/response frame + fail-loud UI on timeout |
| Re-creating a Tab with a previously disposed `sessionId` | ⚠️ HYPOTHESIS | Safer to mint new UUID per new Tab (design AD-5) |

## 8. Uncertain / Unverified

- **`IdeBridgeHostServer` multi-connection semantics:** accepts multiple sockets; Phase 1 expects one runtime connection. Dispose frames assume that single connection — behavior with reconnect/drop mid-dispose not verified end-to-end.
- **Notification filtering for timeline (AC-13 is Phase 4):** Phase 2 still needs enough routing so input cannot cross Tabs (AC-7). Exact Host subscription API surface on `IdeSessionHost` not designed in code.
- **AC-11 title source:** whether to derive from local first prompt text only, or also consume `session/title` events from the runtime — `session-title` is mounted in base, but Extension does not yet subscribe to session events.
- **Fake SDK runtime fixture** (`apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs`): supports initialize/shutdown for host tests; likely needs extension for multi-id prompt and/or dispose-bridge e2e — body not fully audited for multi-session.
- **Windows named-pipe dispose path:** listen/connect code paths exist; Phase 2 should keep path-agnostic frames; pipe-specific flake not verified here.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| STUB-001 | `packages/ide/ide-bridge/src/index.ts:apply` approval listener (~L86) | Claims every `approval/request`, returns `unavailable` | Still returns `Promise.resolve('unavailable')` with `@STUB(phase-3-interaction-fail-closed)` | ✅ 匹配 |
| STUB-002 | `packages/ide/ide-bridge/src/index.ts:apply` questions listener (~L92) | Claims every `user-questions/request`, rejects `NO_PROVIDER` | Still `UserQuestionError` / `NO_PROVIDER` with Phase-3 stub marker | ✅ 匹配 |
| — | `session/dispose` / `ConversationRegistry` | Not in registry | **Absent** (not stubs — missing features for this Phase) | ✅ 预期缺口，非未注册桩 |

### Stub Detection Summary

- ✅ Confirmed stubs matching registry: **2** (STUB-001, STUB-002) — **target Phase 3; non-blocking for Phase 2**.
- ⚠️ Registry mismatch: **0**.
- 🔴 Unregistered stubs on Phase 2 primary path: **0**.
- **Phase Entry Gate:** no 🔴 items with `目标Phase = phase-2-multi-tab-session`. Safe to proceed after user confirms inherited Phase-3 stubs stay deferred.

**Related deferred (documented, not registry stubs):** ide-bridge README “session/dispose and permission RPC are deferred”; permission RPC remains later-phase (design), not Phase 2 deliverable beyond dispose.

## 10. Recommended Next Reads

1. ⭐ MUST READ — `.specdev/specs/vscode-dsh-ide/design.md` (AD-1, AD-5, Q-3, multi-session lifecycle, ConversationTab)
2. ⭐ MUST READ — `apps/vscode-dsh/src/session-host.ts` + `extension.ts` (current single-host model)
3. ⭐ MUST READ — `packages/sdk/server/src/server.ts` (`getOrCreateSession`, `assertLiveAgent`, `performShutdown`)
4. ⭐ MUST READ — `packages/ide/ide-bridge/src/types.ts` + `index.ts` + `host.ts`/`client.ts` (frame + transport extension points)
5. ⭐ MUST READ — `packages/sdk/client/src/client.ts` (`prompt`) + `api.ts` (`DeepSeekHarness.session`)
6. ⭐ MUST READ — `packages/core/agent/src/index.ts` (`AgentHandle` dispose contract)
7. 🔷 SHOULD READ — `packages/acp/acp/src/session.ts` (per-session handle ownership / dispose)
8. 🔷 SHOULD READ — `packages/sdk/protocol/README.md` Known Limitations (no session-close)
9. 🔷 SHOULD READ — `apps/vscode-dsh/tests/session-host.spec.ts` + `packages/ide/ide-bridge/tests/ide-bridge.spec.ts`
10. 🔷 SHOULD READ — Phase 1 `implementation.md` (Host/bridge status; STUB-001/002 left for Phase 3)
11. 🔹 OPTIONAL — `packages/session/session-title` (AC-11 title events) + Web `ui-workspace` (multi-session UX inspiration only)

### Implementer checklist (derived)

1. Add Extension `ConversationRegistry` (mint UUID `sessionId` per new Tab; active pointer; ≥2 Tabs).
2. Wire Tab switch → prompt/event filter uses active `sessionId` only (AC-7).
3. Expose Host APIs on `IdeSessionHost` for `prompt(sessionId, …)` and bridge `session/dispose`.
4. Extend `BridgeFrame` + ide-bridge handler; implement **server-owned** per-session dispose (Map delete + `AgentHandle.dispose()`); never add stdout `session/close`.
5. Document default close policy; leave STUB-001/002 untouched; add ≥1 integration (≥2 Tabs) + ≥1 e2e (AC-33).
