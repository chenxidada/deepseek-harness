# @deepseek-ai/dsh-vscode-dsh

VS Code Extension host for `dsh --profile ide`.

## Summary

Listens on a Host bridge socket, spawns `dsh --profile ide` with `DSH_IDE_BRIDGE_SOCK`, completes SDK `initialize` before reporting connected, and shuts down the child on deactivate. Secrets are redacted from error UI copy.

One DSH process serves the window (AD-1). Multiple conversation Tabs each bind a distinct SDK `sessionId`. Switching Tabs retargets prompts and filters the Timeline / Conversation panel.

The **Conversation** Webview is the live reading and input surface. It is intentionally thin: it follows Host `panel/state` / `messages/*` / `status/set` and never owns mode or send decisions. Illegal sends are rejected by the Host via `ui/reject-send`. The **Timeline** TreeView keeps short turn/step/tool/status/subagent labels and Diff entry points — it does **not** show assistant long text (that belongs in the Conversation panel).

SDK `session.event` / `session.status` / subagent notifications are projected into Timeline and MessageStore. Write/edit tool results that carry `meta.diffs` expose a **post-hoc** Diff entry (`vscode.diff`); mid-run per-file confirmation is not the default (AD-7).

## Library

- `IdeSessionHost` — Node-testable lifecycle owner (prompt + bridge `session/dispose` / `session/read-log` / `session/resume` + notification fan-out)
- `AutoStartOrchestrator` — start-reason FSM (no Start on activate)
- `AutoReadyCoordinator` — Conversation visible ∧ Host ready → restore / New (decoupled from Start)
- `ConversationRegistry` / `ConversationController` — Tab ↔ `sessionId` binding; recoverable close vs delete; **restart restore** + **Continue**; `newConversationOrReuseEmpty`
- `MessageStore` — per-session chat projection for the Conversation panel (not an authority DB)
- `ExtensionIndex` — immediate `workspaceState` writes for `openTabSet` / `activeSessionId` (metadata only)
- `ReplayHydrator` / `restore-planner` — authoritative-log hydrate; empty-Tab strip; active-first UI cap N
- `continue-capability` — T-0b Gate + AD-CU-8 top-bar Continue chrome (list hints stay decoupled)
- `ChatPanelHost` — Host↔Webview protocol + send gate + Continue / 查看更多
- `TimelineStore` — pure session-scoped turn / step / tool / short assistant label / Diff projection
- `buildIdeChildEnv` — scrub-then-reinject child environment
- `redactSecrets` — AC-32 log hygiene

## Commands

| Command | Action |
|---|---|
| `dsh.startSession` | Start / reuse the window session host (via AutoStartOrchestrator). **Does not** restore Tabs or New — AutoReady does that when Conversation is visible |
| `dsh.stopSession` | Shut down the session host (user Stop → orchestrator idle) |
| `dsh.newConversation` | Add a Tab with a fresh `sessionId`, or **reuse the active empty Tab** (AD-CR-6); auto-starts Host if needed |
| `dsh.switchConversation` | Switch the active Tab (TreeView click or QuickPick) — **does not** full auto-start |
| `dsh.closeConversation` | Close (unload) the active Tab — **does not** dispose the session |
| `dsh.deleteConversation` | Explicitly delete: confirm → `session/dispose` + clear index. Offline → **「Host 连接后可删除」** (no fake delete, no auto-start) |
| `dsh.deleteHistory` | Delete a history-list session (`session/dispose` + clear index). Offline → **「Host 连接后可删除」** (no fake delete, no auto-start) |
| `dsh.continueConversation` | Continue this session (auto-starts Host if needed) |
| `dsh.restoreMoreTabs` | Hydrate deferred restore Tabs（「查看更多 / 全部恢复」） |
| `dsh.promptActiveConversation` | Prompt the active Tab's `sessionId` (tests / scripting; auto-starts if needed) |
| `dsh.selectPermissionPreset` | Pick a permission-presets name for the active Tab |
| `dsh.reviewWorkspaceDiffs` | Open post-hoc Diff for write/edit paths on the active Tab |
| `dsh.openTimelineDiff` | Open Diff from a Timeline write row (AC-25) |
| `dsh.showPanel` | Reveal Conversation view / connection error details (**does not** force Start) |
| `dsh.openExtensionSettings` | Open VS Code Settings filtered to this extension (missing-credentials deep link) |
| `dsh.statusBarAction` | Status-bar click: reveal panel **and** auto-start (`status-bar` reason) |

### Auto-start command matrix (AC-1c / AC-1e)

| Class | Commands | Auto Start? |
|---|---|:---:|
| **Start** | `dsh.startSession` | ✅ (`command-start`) |
| **Send / New** | `dsh.newConversation`, `dsh.promptActiveConversation`, `dsh.continueConversation` | ✅ (`command-send`) |
| **Query / browse** | `dsh.openHistory`, `dsh.switchConversation`, History/Conversations refresh | ❌ |
| **Delete** | `dsh.deleteConversation`, `dsh.deleteHistory` | ❌ — offline shows「Host 连接后可删除」; never fake-deletes authority |
| **Panel / settings** | `dsh.showPanel`, `dsh.openExtensionSettings` | ❌ (show details / settings only) |
| **Status bar** | `dsh.statusBarAction` | ✅ (`status-bar`) |
| **Visibility** | Conversation `onDidChangeVisibility` / activity-bar open | ✅ |

`onStartupFinished` / `activate` **only registers** commands, views, status bar, and the orchestrator — it does **not** Start (AC-1a).

### Auto-ready timing (AD-CR-3 / AC-3/4/6)

AutoReady runs only when **Conversation is visible ∧ Host is ready**:

1. Non-empty persisted `openTabSet` → restore as `mode=replay` (active-first; **no** auto Continue; unread suppressed).
2. Empty set / **no workspace folder** → `newConversationOrReuseEmpty` → live (empty Tab **not** written to `openTabSet` until first successful prompt enqueue).
3. Repeated visibility / trigger while the **active** Tab is still empty → reuse that Tab (never globally steal another empty Tab).

Hidden Start (`dsh.startSession` / command-send while Conversation hidden) leaves **zero** Tabs until Conversation becomes visible.

**Activity-bar production signal (AC-1b):** there is no separate VS Code “activity bar container opened” event. Production relies on Conversation `onDidChangeVisibility` after reveal (status-bar click / `dsh.showPanel` / first view focus). L2 keeps `dsh.test.openActivityBar` as the explicit reveal+`activity-bar` request hook.

Settings prefix for credentials / extension config deep link: `@ext:deepseek-ai.dsh-vscode-dsh`.

### L2 test hooks (scripting / Extension Host harness)

Registered **only** when `VSCODE_DSH_TEST=1` or when `activate` receives an injected vscode test double (AD-CR-10). **Not** contributed to the production command palette.

| Command | Action |
|---|---|
| `dsh.test.sendPrompt` | Host-gated send (same gate as Webview `composer/send`) |
| `dsh.test.closeConversation` | Recoverable close; pass `{ confirmStopClose: true }` for running |
| `dsh.test.deleteConversation` | Delete path; pass `{ confirmed: true }` after confirm |
| `dsh.test.panelSnapshot` | Read panel mode / messages / index / Continue chrome |
| `dsh.test.getIndex` | Read persisted ExtensionIndex snapshot |
| `dsh.test.openPanel` | Push panel state (smoke open) |
| `dsh.test.restoreOpenTabs` | Restart restore orchestrator (optional `eventsBySession`) |
| `dsh.test.continue` | Continue active replay Tab (optional resume stub) |
| `dsh.test.restoreMoreTabs` | 「查看更多」 hydrate |
| `dsh.test.diffAvailability` | Probe recoverable log Diffs (no workspace impersonation) |
| `dsh.test.getStartState` | Orchestrator snapshot (`idle`/`starting`/`disconnected`/…) |
| `dsh.test.simulateStartupOnly` | AC-1a reverse: activate-only metrics (no Start) |
| `dsh.test.setCredentialPresence` | Simulate credential presence for AC-2 |
| `dsh.test.fireConversationVisibility` | Drive production visibility → AutoReady entry |
| `dsh.test.triggerAutoReady` | Force AutoReady apply when visible + Host ready (optional `eventsBySession`) |
| `dsh.test.openActivityBar` | AC-1b: reveal Conversation + `activity-bar` start reason |
| `dsh.test.requestStart` | Direct orchestrator `request(reason)` |
| `dsh.test.hostCreateCount` | Host construct count (AC-5) |
| `dsh.test.injectDisconnect` | Fire unexpected disconnect (AC-6a) |

## Views

| View id | Contents |
|---|---|
| `dsh.chat` | Conversation panel (live messages + composer) |
| `dsh.conversations` | Conversation Tab bar |
| `dsh.timeline` | Active Tab timeline (short labels; Diff entry) — **not** the chat transcript |

## Panel vs Timeline

| Surface | Responsibility |
|---|---|
| Conversation panel (`dsh.chat`) | Full user / assistant message text; live composer; waiting-interaction / generating status |
| Timeline (`dsh.timeline`) | Compact turn/step/tool/status/subagent labels; tool Diff entry — no assistant long body |

## Close vs delete policy (AD-CU-3)

- **Close Tab** unloads UI and destroys `tabId`, but **does not** call bridge `session/dispose`. Authority stays recoverable. Empty Tabs never enter persisted `openTabSet`.
- **Delete Conversation** requires confirmation (and Stop & Delete when running). Only then does the Extension send `session/dispose`, clear MessageStore/Timeline for that session, and tombstone the index. Parent delete does not cascade to child session authority.
- Running close prompts **Stop and Close** / **Cancel**; cancel leaves the Tab open.
- Host not ready → delete is disabled / errors with「Host 连接后可删除」(no index-only fake delete; no auto-start).

`openTabSet` / `activeSessionId` are written to `workspaceState` on every change (not only on deactivate).

## Restart restore (AD-CU-3/4/10)

- When Conversation becomes visible and Host is ready, AutoReady reads persisted `openTabSet`, **strips empty Tabs** (no messages / never sent), writes the sanitized set back immediately, and hydrates a UI subset of size **N** (`ui.restoreUiLimit`, default **8**).
- Start alone (`dsh.startSession` while Conversation hidden) does **not** restore or New.
- The last **active** session is always forced into the UI set and focused (AC-34). Remaining index rows stay in `openTabSet` (AC-70); use `dsh.restoreMoreTabs` / `action/restore-more` for 「查看更多 / 全部恢复」.
- Restored Tabs are always `mode=replay` (even if `liveIntent` was stored). No automatic Continue / prompt. AutoReady suppresses unread.
- Host not ready → `waiting-host`; when Host connects, restore hydrates automatically (AC-69). No workspace folder → AutoReady skips restore and opens a live empty Tab (AC-4b).

## Continue this session (AD-CU-8 / T-0b same-id)

- T-0b Gate is **PASS (same-id)**. Top-bar Continue is **enabled** when capability is `same-id` or `derive-only`; **disabled** + tooltip「暂不可用」 for `unknown`; **hidden** only if Gate were FAIL.
- History list hints (「可继续」) stay **decoupled** from the top-bar Continue control.
- Continue calls Host bridge `session/resume` → SDK `sdkSessionResume` → `agents.resume` (does **not** expand SDK stdout create). Same open-period `tabId` upgrades `replay→live` (AC-32). Old log prefix is not rewritten (AC-66).

## Replay Diff (AD-CU-6)

- Diff is available only when `meta.diffs` carries recoverable snapshots (`path` + `newText` + `oldText: string|null`). Patch-only (missing `oldText`) → Diff unavailable with explanation.
- Both Diff sides open as virtual `dsh-diff` documents from the log — **never** current workspace files as before/after.
- Incomplete / interrupted turns are marked on messages (`incomplete`) with notice「已停止/未完成」(AC-77).

## Dual channel

- **SDK stdout** — JSON-RPC only (`initialize` / `session/prompt` / `shutdown`) plus server notifications (`session.event`, `session.status`, `subagent.*`). No `session/close` / `session/resume` on stdout.
- **Host bridge** — UDS/named-pipe NDJSON for `session/dispose`, `session/read-log`, `session/resume`, approval/questions, and permission RPC. Bridge traffic never shares stdout with the SDK.

The Extension does **not** reimplement agent-loop, tool execution, or session persistence (AC-15). Fail-closed approvals / questions live in `InteractionCoordinator` + `ide-bridge` terminal answerers — not in `packages/core/agent-loop`.

## Replaceability (AD-8)

Authoritative transport + frame contract: [`@deepseek-ai/dsh-ide-bridge` README § Replaceability](../../packages/ide/ide-bridge/README.md#replaceability-contract-ad-8). This Extension owns the **UI presenter** and **permission picker** faces only.

| Face | Seam in this app | Default | Replace without agent-loop |
|---|---|---|---|
| UI presenter | `InteractionUi` via `IdeSessionHost.setInteractionUi` / `InteractionCoordinator.setUi` | `createVscodeInteractionUi` (QuickPick / InputBox) | Any object returning legal `ApprovalOutcome` / `AskUserQuestionAnswer`; proof: `tests/replaceability-interaction-ui.spec.ts` |
| Auto-allow | `dsh.selectPermissionPreset` → Host `permission/select` | `workspace-write`; `danger-full-access` maps to approval `never` | Switch presets through `dsh-permission-presets` only — do not store a parallel policy in the Extension |
| Transport | Host listens with `IdeBridgeHostServer` | UDS / named pipe | Swap at the duplex / `NdjsonSocket` layer in ide-bridge (memory proof lives there) |

Changing QuickPick → Webview (or another presenter), swapping the bridge duplex, or selecting an auto-allow preset must stay inside `apps/vscode-dsh` + `packages/ide/ide-bridge` (AC-27 / AC-28).
