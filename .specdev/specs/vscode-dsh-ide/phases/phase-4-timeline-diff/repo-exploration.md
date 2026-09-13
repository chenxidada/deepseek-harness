# Repository Exploration Report — Phase 4: Timeline + Post-Hoc Diff

## 1. Task Context

Phase `phase-4-timeline-diff` must subscribe to SDK notifications for the active (or matching) Tab’s `sessionId`, project `session.event` / `session.status` into a turn / step / tool / assistant timeline, and expose a **post-hoc** Diff/SCM review entry after workspace file mutations (AD-7; AC-12/13/23/24). Should items: subagent hierarchy labels (AC-14) and timeline write-item → Diff jump (AC-25). The Extension **projects only** — it must not reimplement agent-loop, tools, or session persistence (AC-15). Filter by `sessionId` so multi-Tab timelines do not cross-talk (AC-7). Spec-panel state is out of Must scope.

**Updated for Phase 4** vs Phase 2/3 explorations: multi-Tab registry, `prompt` → `messageId`, bridge dispose, and interaction fail-closed are in place. **Missing:** notification fan-out into UI, Timeline view, write-tool path collection, Diff/SCM commands, and fake-runtime scripted `session.event` / `session.status` for keyless tests.

## 2. Repository Overview

- **Language / runtime:** TypeScript ESM, Node `^22.19 || >=24`, Cordis plugins, pnpm workspaces.
- **IDE stack (Phases 1–3):** `apps/vscode-dsh` + `packages/ide/ide-bridge` + `packages/bundle/ide` (`dsh-base` + `sdk-app` + `ide-bridge`, `profile: ide`).
- **Dual channel (unchanged):** SDK NDJSON JSON-RPC on child stdio (`initialize` / `session/prompt` / `shutdown` + server notifications); Host bridge UDS/named-pipe NDJSON via `DSH_IDE_BRIDGE_SOCK` (approval / questions / dispose / permission — **not** the timeline path).
- **Notification authority:** `HarnessSdkJsonRpcServer` forwards every `session/event` → `session.event`, every `agent/status` → `session.status`, and in-process subagent edges → `subagent.started` / `subagent.finished` (`packages/sdk/server/src/server.ts`). Runtime notifies for **all** sessions; client-side filters scope them.
- **Web UI precedent (reference only):** `packages/client/ui-conversation`, `ui-tool`, `ui-trajectory` project the same session-log vocabulary into chat/timeline cards — **do not mount** on the ide profile (AD-3 / AC-5 pattern).

## 3. Most Relevant Areas

| Path | Why it matters | Source |
|------|----------------|--------|
| `apps/vscode-dsh/src/session-host.ts` | Owns private `HarnessClient`; `prompt()` returns `messageId` (AC-12); `watchTransport` **subscribes then discards** all notifications — only detects transport death | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | `promptActive` / `promptTab` already target Tab `sessionId` and return `{ messageId, sessionId, tabId }` | 👁 |
| `apps/vscode-dsh/src/conversation-registry.ts` | `ConversationTab { tabId, sessionId, title?, status }` — **no** `timelineCursor` / timeline buffer; comments already mention “timeline projection” on `switchTo` | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.promptActiveConversation` exists; only TreeView is `dsh.conversations` — **no** Timeline / Diff views or commands | 👁 |
| `apps/vscode-dsh/package.json` | `contributes.views` = Conversations only; no timeline / SCM / Diff commands | 👁 |
| `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` | Answers `session/prompt` with `messageId` but **does not** emit `session.event` / `session.status` / subagent / write-tool meta — insufficient for AC-13/23 e2e as-is | 👁 |
| `packages/sdk/client/src/client.ts` | `prompt` → `messageId`; `subscribe(filter?)`; **`subscribeSessionTree(sessionId)`** scopes root + `subagent.started` descendants (AC-13/14) | 👁 |
| `packages/sdk/client/tests/fake-runtime.ts` | Full scripted turn notifications (`turn/start`, `assistant/message`, `tool/*`, `session.status`, optional `FAKE_SUBAGENT`) — **reusable pattern** for ide fake runtime | 👁 |
| `packages/sdk/protocol/src/types.ts` | Wire types: `SessionEventNotification`, `SessionStatusNotification`, `SubagentStarted/FinishedNotification` | 👁 |
| `packages/sdk/server/src/server.ts` | Emission site for all four notification methods | 👁 |
| `packages/core/session/src/types.ts` | `SessionEventMap`: `turn/start|end`, `step/start|end`, `assistant/message`, `tool/call`, `tool/result` (+ optional `meta`) | 👁 |
| `packages/fs/tool-fs/tests/tools.spec.ts` (§ result-time contextual diff) | `write` / `edit` attach `meta: { diffs: [{ path, oldText, newText }] }` on success — primary Diff path for AD-7 | 👁 |
| `packages/client/ui-tool/src/client/tool/models/{tool-call-model,diff-card-model}.ts` | Pure projection: `classifyTool('write'|'edit')`, `file_path` from args, `meta.diffs` → DiffCard — **copy patterns, do not import Web packages into Extension** | 👁 |
| `packages/client/ui-trajectory/src/client/timeline.ts` | Web trajectory overview projection — conceptual only; VS Code needs a simpler TreeView/Webview | 👁 |
| `packages/client/ui-conversation/src/client/contract/*` | Conversation node fold over `SessionEventLike` — shows turn/step/tool pairing rules | 👁 |
| `.specdev/specs/vscode-dsh-ide/design.md` AD-7 / Prompt sequence | Post-hoc Diff; prompt → `messageId` → filtered notifications → timeline | 👁 |
| `tech-debt-registry.md` | Active debt empty; STUB/GAP 001–009 resolved in Phases 1–3 | 👁 |

**Absent (Phase 4 must create):**

| Path / symbol | Design role |
|---------------|-------------|
| Notification fan-out on `IdeSessionHost` | Second `subscribe` / shared dispatch of `session.event` / `session.status` / subagent (today’s watcher drains without forwarding) |
| Per-Tab timeline store + optional `timelineCursor` | Filter by `sessionId`; update on switch (AC-7/13) |
| Timeline UI (`views` / TreeView / Webview) | turn / step / tool / assistant rows |
| Diff/SCM entry commands | Open `vscode.diff` and/or reveal SCM after write/edit paths (AC-23/24); Should: jump from timeline row (AC-25) |
| Fake-runtime event scripting | Emit status + events (+ write `tool/call`/`tool/result` with `meta.diffs`) for keyless integration/e2e (AC-33) |

## 4. Key Entry Points / Call Paths

### Path A — Prompt with `messageId` receipt (AC-12 — **mostly done**)

```
dsh.promptActiveConversation / ConversationController.promptActive(text)
  → registry.getActive().sessionId
  → IdeSessionHost.prompt(sessionId, [{ type:'text', text }])
  → HarnessClient.prompt → JSON-RPC session/prompt
  → HarnessSdkJsonRpcServer → { messageId }
  → (optional) setTitle from first message
```

✅ CONFIRMED in `conversation-controller.ts` / `session-host.ts` / multi-tab integration test (asserts distinct `sessionId` routing; does not assert timeline yet).

### Path B — Session notifications → Tab timeline (AC-13 — **gap**)

```
Runtime session.append / agent status
  → sdk-jsonrpc-server transport.notify('session.event'|'session.status', { sessionId, … })
  → HarnessClient fans out to subscriptions
  → TODAY IdeSessionHost.watchTransport: for (;;) await subscription.next()  // discard body
  → NEEDED:
       Host.onNotification / timelineProjector
         filter sessionId === tab.sessionId (or subscribeSessionTree(root))
         map event.type → turn | step | tool | assistant row
         refresh Timeline view for that Tab / active Tab
```

✅ CONFIRMED emission + client subscribe APIs.
✅ CONFIRMED Host currently **does not** project notifications into UI.
⚠️ HYPOTHESIS: one process-wide subscription + per-Tab filter is simpler than one `subscribeSessionTree` per Tab; either works if filters stay session-scoped.

### Path C — Subagent hierarchy (AC-14 Should)

```
session/created with parentSession → notify('subagent.started', { parentSessionId, childSessionId })
subagent/end (local) → notify('subagent.finished', { …, status, stopReason })
  → HarnessClient.subscribeSessionTree(root) tracks descendant sessionIds
  → Timeline marks child events under parent Tab (indent / badge)
```

✅ CONFIRMED protocol + `subscribeSessionTree` / SDK fake `FAKE_SUBAGENT`.
⚠️ HYPOTHESIS: Extension may keep a parent→children map from `subagent.started` even without using `subscribeSessionTree` literally.

### Path D — Post-hoc Diff / SCM (AC-23/24/25 — **gap**)

```
tool/call { name: 'write'|'edit', arguments: JSON with file_path }
  → tool/result { …, meta?: { diffs: [{ path, oldText, newText }] } }   // dsh-tool-fs
  → Timeline projector records WriteFile item { path, diffs? }
  → UI offers:
       a) vscode.diff (VirtualDocument / temp URI with oldText vs workspace file)
       b) and/or vscode.scm / git open-change for workspace path
  → Default: no mid-run per-file approval UI (AC-24; Phase 3 approval is separate)
```

✅ CONFIRMED `tool/result.meta.diffs` contract in tool-fs tests + Web `diff-card-model.ts`.
✅ CONFIRMED **no** `vscode.diff` usage anywhere in this repo today.
⚠️ HYPOTHESIS: git/SCM-only path without tool meta still satisfies AC-23 “tool events and/or git”; prefer tool meta when present (richer, matches AD-7).

## 5. Likely Impact Surface

| Area | Change type | Risk |
|------|-------------|------|
| `apps/vscode-dsh/src/session-host.ts` | Add notification listeners / fan-out without breaking transport-death watch | 🔴 High — dual subscribers must both see events; death path must still fail-closed |
| New `timeline-projector.ts` / store | Pure map SessionEvent → UI rows; per-`sessionId` buffers | 🟡 Medium |
| `conversation-registry.ts` | Optional cursor / status sync from `session.status` | 🟡 Medium |
| `extension.ts` + `package.json` | New view(s), Diff/SCM commands, activationEvents | 🟡 Medium |
| `conversation-tab-bar.ts` or new TreeDataProvider | Timeline TreeView beside Conversations | 🟡 Medium |
| `tests/fixtures/fake-sdk-runtime.mjs` | Emit status + events (+ write meta) after prompt | 🔴 High for AC-33 — without this, timeline/Diff e2e cannot be keyless |
| `apps/vscode-dsh/tests/*` | ≥1 integration + ≥1 e2e (AC-33) | 🟡 Medium |
| SDK / agent-loop / tool-fs | **Must not change** for this Phase (project only) | — |
| Web `packages/client/ui-*` | Reference only; no ide profile mount | — |

## 6. Existing Constraints / Conventions

1. **AD-7:** Post-hoc Diff only; event authority = session log / SDK notifications; Extension projects.
2. **AD-1 / AC-15:** One `dsh --profile ide` process per window; do not reimplement loop/tools/persistence in Extension.
3. **AC-7:** Prompt and timeline filter by Tab `sessionId` — never show Tab A events on Tab B.
4. **SDK protocol:** stdout methods stay `initialize` / `session/prompt` / `shutdown`; do not add timeline RPCs.
5. **Duck-typed `vscode` surface:** Extension avoids hard `@types/vscode` compile dependency; extend the same pattern for `workspace.openTextDocument` / `commands.executeCommand('vscode.diff', …)` / TreeView.
6. **Registrations are effects; tests are Node vitest** under `apps/vscode-dsh/tests/` with fake runtime `dshBin`.
7. **Web packages are forbidden on ide profile** — reuse *algorithms* (path from args, narrow `meta.diffs`), not Cordis UI plugins.
8. **Client UI i18n rule** applies to Web; Extension currently uses English command strings in `package.json` / `showInformationMessage` (match existing Phase 1–3 style unless design says otherwise).
9. **Fail-closed interactions (Phase 3)** stay on the bridge channel; timeline must not block approval/questions.

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| `watchTransport` discards all notification payloads today | ✅ CONFIRMED | Must add fan-out or replace with a demultiplexer that still rejects on close |
| Fake ide runtime lacks event stream | ✅ CONFIRMED | AC-13/23 tests need new env knobs mirroring SDK `fake-runtime.ts` |
| `tool/result.meta.diffs` is the best Diff source for write/edit | ✅ CONFIRMED | tool-fs attaches structured hunks; Web already narrows them |
| Mid-execution per-file confirm is out of scope | ✅ CONFIRMED | AC-26 Could; AC-24 forbids making it default |
| Whether Timeline is TreeView vs WebviewPanel | ⚠️ HYPOTHESIS | Spec says “Timeline 视图”; Conversations already use TreeView — lowest-friction fit |
| Whether to store `timelineCursor` on `ConversationTab` | ⚠️ HYPOTHESIS | AD-5 prose mentioned it; formal design interface omitted it; Phase 2 deferred — optional buffer cursor ok |
| Git/SCM without tool meta sufficient for AC-23 | ⚠️ HYPOTHESIS | Allowed by wording; weaker UX; recommend tool-path first |
| Subagent child events on parent Tab without tree subscribe | ⚠️ HYPOTHESIS | Filtering only exact `sessionId` would miss child events — use tree or parent map for AC-14 |
| VirtualDocument provider for `vscode.diff` old side | ❓ UNKNOWN | Not present in repo; implementer must choose content provider vs temp files |

## 8. Uncertain / Unverified

- Exact VS Code API surface for SCM reveal (`git.openChange` vs `scm.open`) under the Extension’s duck-typed layer — **not verified** against a real VS Code host in this exploration.
- Whether ide profile’s default tool set always includes `write`/`edit` with meta in REAL composition e2e — unit/integration can script meta; REAL-profile e2e may need API key and is out of Phase 4’s keyless fake path.
- `IdeSessionHost` does not currently call `registry.setStatus` from `session.status` — Tab `status` stays local unless Phase 4 wires it (useful for running/idle chrome, not strictly AC-13 wording).
- Full `ConversationNodeAssembler` fold semantics — only sampled; Extension should implement a **minimal** projector, not port the Web chat stack.

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| （无活跃项） | — | 空表 | 活跃债务为空 | ✅ 匹配 |
| STUB-001/002 | ide-bridge answerers | 已解决 | Phase 3 已实现真实 round-trip | ✅ 匹配（已解决） |
| GAP-003..009 | vscode-dsh close/UI/onError | 已解决 | 对应实现与测试存在 | ✅ 匹配（已解决） |
| — | `IdeSessionHost.watchTransport` | 未注册 | 有意仅作死亡探测，**不是**桩；但相对 Phase 4 目标是功能缺口 | 🟡 功能缺口（应实现，不必标 STUB） |
| — | Timeline / Diff modules | 未注册 | **文件不存在**（尚待 Phase 4 新建） | ✅ 非桩 — 缺失实现 |

### Stub Detection Summary

- ✅ Confirmed stubs: **0**（活跃表为空；代码中无 `@STUB` / 空壳 timeline API）
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**
- 📌 **Phase 4 functional gaps (not stubs):** notification projection, Timeline UI, Diff/SCM entry, fake-runtime event scripting

Scanned `apps/vscode-dsh/src` for `TODO`/`FIXME`/`@STUB`/empty timeline APIs — none relevant beyond ordinary UI placeholders (`placeholder` QuickPick props).

## 10. Recommended Next Reads

1. ⭐ MUST READ — `.specdev/specs/vscode-dsh-ide/phases/phase-4-timeline-diff/spec.md` (AC-12/13/14/23/24/25/33)
2. ⭐ MUST READ — `.specdev/specs/vscode-dsh-ide/design.md` (AD-7 + Prompt sequence §)
3. ⭐ MUST READ — `apps/vscode-dsh/src/session-host.ts` (`prompt`, `watchTransport`)
4. ⭐ MUST READ — `packages/sdk/client/src/client.ts` (`prompt`, `subscribe`, `subscribeSessionTree`)
5. ⭐ MUST READ — `packages/sdk/protocol/src/types.ts` (notification payloads)
6. 🔷 SHOULD READ — `packages/core/session/src/types.ts` (`SessionEventMap` tool/turn/assistant)
7. 🔷 SHOULD READ — `packages/sdk/client/tests/fake-runtime.ts` (event scripting to copy into ide fixture)
8. 🔷 SHOULD READ — `packages/client/ui-tool/src/client/tool/models/diff-card-model.ts` + `tool-call-model.ts` (path + `meta.diffs` narrowing)
9. 🔷 SHOULD READ — `apps/vscode-dsh/src/conversation-controller.ts` + `conversation-registry.ts` (AC-12 routing / Tab filter)
10. 🔹 OPTIONAL — `packages/fs/tool-fs/tests/tools.spec.ts` (§ result-time contextual diff)
11. 🔹 OPTIONAL — `packages/client/ui-trajectory/src/client/timeline.ts` (Web overview only)
12. 🔹 OPTIONAL — Phase 2/3 `implementation.md` for Host/registry invariants not to regress
