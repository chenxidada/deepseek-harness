# Repository Exploration Report — phase-5-replaceability-docs

## 1. Task Context

Phase `phase-5-replaceability-docs` documents and lightly proves AD-8 replaceability: (1) Host bridge **transport adapter**, (2) VS Code **UI presentation** (`InteractionUi`), (3) **auto-allow** via permission-presets — without modifying `packages/core/agent-loop` (AC-27), keeping new behavior in `ide-bridge` / Extension (AC-28), shipping contract docs plus ≥1 verifiable replacement path (AC-29), and ≥1 integration + ≥1 independent e2e/scriptable scenario (AC-33). Spec/hooks product packs are out of scope. Phase Entry Gate: GAP-010/011 are Phase-4 polish and **not** blocking for this Phase.

## 2. Repository Overview

| Aspect | Reality |
|--------|---------|
| Language / runtime | TypeScript ESM, Node `^22.19 \|\| >=24`, pnpm workspaces |
| IDE surface | `apps/vscode-dsh` — VS Code Extension Host (window-scoped) |
| Runtime profile | `packages/bundle/ide` → `dsh --profile ide` = `dsh-base` + `sdk-app` + `ide-bridge` |
| Bridge package | `packages/ide/ide-bridge` — NDJSON Host bridge (UDS / named pipe) |
| Core loop | `packages/core/agent-loop` — **not** a dependency of vscode-dsh or ide-bridge |
| Package manager | pnpm; tests via vitest under each package / `apps/vscode-dsh/tests` |
| Doc tiers | Package README = per-package contract home; cookbook/subsystems for cross-cutting how-tos (`docs/AGENTS.md`) |

Dual channel (unchanged): SDK **stdout** = JSON-RPC only; Host **bridge** = non-stdout NDJSON for approval / questions / permission / session dispose.

## 3. Most Relevant Areas

| Path | Why relevant | Source |
|------|--------------|:------:|
| `packages/ide/ide-bridge/src/types.ts` | `BridgeFrame` closed union — wire contract | 👁 |
| `packages/ide/ide-bridge/src/validate.ts` | `validateBridgeFrame` / outcome validators (AC-31) | 👁 |
| `packages/ide/ide-bridge/src/ndjson.ts` | `NdjsonSocket` over any `Duplex`; `parseBridgeFrame` | 👁 |
| `packages/ide/ide-bridge/src/host.ts` | Production Host listener (`IdeBridgeHostServer`) | 👁 |
| `packages/ide/ide-bridge/src/client.ts` | Runtime client (`IdeBridgeClient` → `node:net.connect`) | 👁 |
| `packages/ide/ide-bridge/src/index.ts` | Cordis answerers; fail-closed; permission RPC | 👁 |
| `packages/ide/ide-bridge/README.md` | Existing bridge docs (no AD-8 replaceability section yet) | 👁 |
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | Frame validation + UDS round-trips + permission | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | Hard-wires `new IdeBridgeHostServer()`; `setInteractionUi` | 👁 |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | `InteractionUi` seam + fail-closed | 👁 |
| `apps/vscode-dsh/src/interaction-ui.ts` | Default QuickPick/InputBox presenter (AD-8 comment) | 👁 |
| `apps/vscode-dsh/src/extension.ts` | Installs `createVscodeInteractionUi`; permission picker | 👁 |
| `apps/vscode-dsh/README.md` | Dual-channel + “does not reimplement agent-loop” (AC-15); no replaceability chapter | 👁 |
| `apps/vscode-dsh/tests/interaction-fail-closed.*.spec.ts` | Fake `InteractionUi` already used as second presenter | 👁 |
| `packages/interaction/permission-presets/` | Auto-allow = preset with `approval: 'never'` (`danger-full-access`) | 👁 |
| `packages/bundle/ide/README.md` | Profile mount notes; **stale** “UI deferred / stubs” limitation | 👁 |
| `packages/core/agent-loop/` | Grep target for AC-27 “no change” evidence | 👁 |
| `.specdev/.../design.md` AD-8 + `IdeBridgeTransport` sketch | Design authority for this Phase | 👁 |
| `.specdev/.../tech-debt-registry.md` | GAP-010/011 only active; non-blocking | 👁 |

`code2prompt` was not available on PATH; inventory is manual (👁).

## 4. Key Entry Points / Call Paths

### Path A — Production UDS transport + approval (current)

```
Extension activate
  → createVscodeInteractionUi(vscode.window)
  → IdeSessionHost.setInteractionUi(ui)
  → IdeSessionHost.start()
       → new IdeBridgeHostServer().listen(sockPath)   // concrete UDS
       → spawn dsh --profile ide + DSH_IDE_BRIDGE_SOCK
       → SDK initialize (stdout JSON-RPC)
ide-bridge apply()
  → IdeBridgeClient.connect(sockPath)
  → ctx.on('approval/request') → awaitHostApproval → send approval/request
Host IdeSessionHost.onBridgeFrame
  → InteractionCoordinator.handleApproval
  → InteractionUi.presentApproval → legal ApprovalOutcome
  → send approval/response
ide-bridge settleInboundResponse → waterfall resolves (never next() on fail)
```

### Path B — UI replaceability seam (already exercised in tests)

```
IdeSessionHost.setInteractionUi / InteractionCoordinator.setUi
  → ANY object implementing InteractionUi
       presentApproval(request, signal?) → ApprovalOutcome
       presentQuestions(request, signal?) → AskUserQuestionAnswer
Default: createVscodeInteractionUi
Tests: inline fake presenters (allowed-once / hang-until-abort)
```

### Path C — Auto-allow without agent-loop (permission-presets)

```
Extension dsh.selectPermissionPreset
  → pickPermissionPreset → Host permission/list + permission/select frames
ide-bridge handlePermissionSelect
  → ctx.get('permissionPresets').set(session, preset)
  → dsh-permission-presets writes sandbox + approval policy
       'danger-full-access' → approval policy 'never'  // auto-allow tools
agent-loop unchanged; approval service reads session policy as today
```

### Path D — Candidate memory/loopback transport proof (not shipped)

```
PassThrough / paired Duplex
  → new NdjsonSocket(duplexA)  // Host side
  → new NdjsonSocket(duplexB)  // Runtime side
  → same validateBridgeFrame / BridgeFrame kinds
  → ping hello OR one approval/request↔response
  → assert packages/core/agent-loop untouched (no import / no file change)
```

## 5. Likely Impact Surface

| Area | Change type | Risk | Notes |
|------|-------------|:----:|-------|
| `packages/ide/ide-bridge/README.md` (+ zh) | Doc: replaceability / frame contract | 🟢 Low | Natural home for transport + fail-closed + stdout purity |
| `apps/vscode-dsh/README.md` | Doc: UI + auto-allow replaceability | 🟢 Low | Link to ide-bridge README; avoid second authority |
| `packages/bundle/ide/README.md` | Doc fix stale Known Limitations | 🟡 Medium | Still claims Phase-3 stubs / deferred UI |
| Optional: `docs/cookbook/` or ide subsystem page | Only if cross-package narrative needs a home | 🟡 Medium | Spec allows docs/; prefer package README first |
| `packages/ide/ide-bridge/tests/*` | New memory/loopback transport contract test | 🟢 Low | Best AC-29+AC-33 transport proof |
| `apps/vscode-dsh/tests/*` | Explicit “second InteractionUi” proof test | 🟢 Low | Pattern already exists; name/assert as replaceability |
| `IdeBridgeTransport` interface extraction | Optional refactor | 🟡 Medium | Design sketch exists; Phase 1 review deferred it; **not required** if tests prove Duplex/NDJSON swap |
| `IdeSessionHost` DI for host server | Optional | 🟡 Medium | Currently `new IdeBridgeHostServer()`; DI only if proving Host-side swap in-process |
| `packages/core/agent-loop/**` | **Must not change** | 🔴 Block if touched | AC-27; verification should grep/diff |
| GAP-010 / GAP-011 code | Out of scope | — | Do not “fix while documenting” |

## 6. Existing Constraints / Conventions

- **Registrations are effects**; ide-bridge answerers are terminal (`_next` unused) — fail-closed never calls `next()` (AD-4).
- **Bridge inbound validation** drops illegal frames (`validateBridgeFrame` → `undefined`); no silent allow (AC-31).
- **Closed approval outcomes**: `allowed-once` \| `rejected` \| `cancelled` \| `unavailable` — not `allow-all`.
- **Permission authority**: only `dsh-permission-presets` via Host RPC (AD-6 / AC-21/22); Extension must not invent a second policy store.
- **stdout purity**: bridge never writes SDK stdout; document this in any replaceability page (Phase 5 constraint).
- **Package README ownership**: durable contracts live in package READMEs; bilingual pair required for package docs.
- **Explicit > implicit**: if extracting `IdeBridgeTransport`, keep resolve/start at the owner — do not hide defaults inside `send()`.
- **Tests describe behavior**: prove a second adapter/presenter runs one approval or hello through the **same frame validators**.
- **vscode-dsh deps**: only `dsh-ide-bridge`, `dsh-sdk-client`, `dsh-subprocess` — no core loop packages (AC-15/28).
- **ide-bridge deps**: schemastery + peer approval/questions/cordis — no agent-loop.

## 7. Risks / Unknowns

| Item | Confidence | Detail |
|------|:----------:|--------|
| Three AD-8 seams map to real code locations | ✅ CONFIRMED | Transport = HostServer/Client/Ndjson; UI = InteractionUi; auto-allow = permission-presets `never` |
| No `IdeBridgeTransport` TypeScript interface in repo | ✅ CONFIRMED | Only design.md sketch; Host/Client are concrete classes |
| UI seam is already replaceable without agent-loop | ✅ CONFIRMED | `setInteractionUi` + test fakes; coordinator only needs legal outcomes |
| Dedicated replaceability docs missing | ✅ CONFIRMED | READMEs cover dual-channel/fail-closed but not AD-8 swap recipes |
| Memory transport can reuse `NdjsonSocket(Duplex)` | ⚠️ HYPOTHESIS | Class accepts `Duplex`; PassThrough pairing not tested yet |
| Extracting transport interface required for AC-29 | ⚠️ HYPOTHESIS | Spec accepts “第二 transport 适配器 **或** 第二 UI presenter”; docs + one proof path suffice |
| Auto-allow “策略插件” = permission-presets / cordis overlay | ⚠️ HYPOTHESIS | No separate vscode auto-allow plugin; preset table / `approval: never` is the shipped knob |
| `IdeSessionHost` hard-codes UDS server → harder Host DI proof | ✅ CONFIRMED | Swap today is either new HostServer class behind same listen API, or bypass Host with NdjsonSocket tests |
| bundle/ide README stale vs Phase 3+ reality | ✅ CONFIRMED | “UI deferred / answerer stubs” is outdated |
| GAP-010/011 still present | ✅ CONFIRMED | See §9; Phase 5 must not treat as blockers |
| Whether docs go under `docs/` vs README only | ❓ UNKNOWN | Spec allows either; docs AGENTS prefers package README as contract home |

## 8. Uncertain / Unverified

| Symbol | Status | Guidance for downstream |
|--------|--------|-------------------------|
| `NdjsonSocket` over `stream.PassThrough` pair | Signature exists; **behavior unverified** for bidirectional NDJSON | Implementer must write the proof test; do not assume encoding/backpressure OK without running it |
| Future Webview `InteractionUi` | Not implemented | Out of scope beyond documenting the interface; QuickPick is the shipped presenter |
| Live `approval.setPolicy` narration parity with Web `/permission` | Documented limitation in ide-bridge README | Bridge uses `presets.set` / session-log writers; do not expand into agent-loop |
| Windows named-pipe as “second transport” proof | Host supports pipe paths; coverage is UDS-heavy | Prefer in-process Duplex for keyless CI proof |
| Whether `IdeBridgeClient.connect` can accept a custom connect fn | **Not present** | Client always `net.connect(path)`; memory proof should sit at NdjsonSocket / test double layer unless refactoring Client |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:-------------:|------------|:----:|
| GAP-010 | `apps/vscode-dsh/src/timeline-store.ts` `applySessionEvent(tool/result)` / `narrowDiffs` | 🟡非阻塞 — only consumes `meta.diffs`; no call-args fallback | ✅ Still: `metaDiffs = narrowDiffs(data.meta)` only; empty diffs → no synthetic hunk | ✅ 匹配 |
| GAP-011 | `apps/vscode-dsh/src/diff-entry.ts` `openTimelineDiff` / `looksAbsolute` | 🟡非阻塞 — relative path → `dsh-diff:new-…` virtual right pane | ✅ Still: relative → `Uri.parse('dsh-diff:new-…')`; no `workspaceFolders` join | ✅ 匹配 |
| — (Phase 5 targets) | ide-bridge / InteractionUi / permission path | — | No `@STUB`, empty bodies, or hard-coded stub returns on primary paths; `unavailable` is real fail-closed | ✅ 无新桩 |

### Stub Detection Summary

- ✅ Confirmed stubs/gaps matching registry: **2** (GAP-010, GAP-011) — Phase-4 polish; **do not block** Phase 5
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs on Phase-5 critical path: **0**
- Note: Phase Entry Gate has **no 🔴 blocking** debt targeted at `phase-5-replaceability-docs`

## 10. Recommended Next Reads

1. ⭐ MUST READ — `.specdev/specs/vscode-dsh-ide/phases/phase-5-replaceability-docs/spec.md` (AC-27/28/29/33)
2. ⭐ MUST READ — `.specdev/specs/vscode-dsh-ide/design.md` §AD-8 + `IdeBridgeTransport` / `BridgeFrame` sketch
3. ⭐ MUST READ — `packages/ide/ide-bridge/src/types.ts` + `validate.ts` + `ndjson.ts` (frame contract)
4. ⭐ MUST READ — `apps/vscode-dsh/src/interaction-coordinator.ts` (`InteractionUi`) + `interaction-ui.ts`
5. ⭐ MUST READ — `apps/vscode-dsh/src/session-host.ts` (bridge listen wiring; `setInteractionUi`)
6. 🔷 SHOULD READ — `packages/ide/ide-bridge/README.md` + `apps/vscode-dsh/README.md` (extend, don’t fork authority)
7. 🔷 SHOULD READ — `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` + `apps/vscode-dsh/tests/interaction-fail-closed.integration.spec.ts` (proof patterns)
8. 🔷 SHOULD READ — `packages/interaction/permission-presets/src/index.ts` (default presets / `never` auto-allow)
9. 🔷 SHOULD READ — Phase 3 archive `implementation-20260907T030712Z.md` (AD-8 QuickPick deviation) + Phase 1 review note on deferred `IdeBridgeTransport`
10. 🔹 OPTIONAL — `packages/bundle/ide/README.md` (fix stale limitations while documenting)
11. 🔹 OPTIONAL — `packages/core/agent-loop/README.md` (only to cite “unchanged / not imported”)
12. 🔹 OPTIONAL — `docs/AGENTS.md` tier rules for where to place the contract page

### Implementer checklist (derived)

- [ ] Document three replaceable faces + invariants (stdout exclusive; fail-closed; frame validation; no agent-loop).
- [ ] Prefer package README sections with cross-links (avoid duplicate authority).
- [ ] Ship ≥1 proof: memory/loopback NDJSON **or** named second `InteractionUi` integration test.
- [ ] Ship ≥1 e2e/scriptable scenario (can reuse Host approval path with fake UI / fake runtime).
- [ ] Record verification evidence: `git`/`rg` shows no `packages/core/agent-loop` edits; vscode-dsh/ide-bridge still do not import it.
- [ ] Leave GAP-010/011 untouched unless user redirects debt.
