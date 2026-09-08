# @deepseek-ai/dsh-vscode-dsh

VS Code Extension host for `dsh --profile ide`.

## Summary

Listens on a Host bridge socket, spawns `dsh --profile ide` with `DSH_IDE_BRIDGE_SOCK`, completes SDK `initialize` before reporting connected, and shuts down the child on deactivate. Secrets are redacted from error UI copy.

One DSH process serves the window (AD-1). Multiple conversation Tabs each bind a distinct SDK `sessionId`. Switching Tabs retargets prompts and filters the Timeline / Conversation panel.

The **Conversation** Webview is the live reading and input surface. It is intentionally thin: it follows Host `panel/state` / `messages/*` / `status/set` and never owns mode or send decisions. Illegal sends are rejected by the Host via `ui/reject-send`. The **Timeline** TreeView keeps short turn/step/tool/status/subagent labels and Diff entry points — it does **not** show assistant long text (that belongs in the Conversation panel).

SDK `session.event` / `session.status` / subagent notifications are projected into Timeline and MessageStore. Write/edit tool results that carry `meta.diffs` expose a **post-hoc** Diff entry (`vscode.diff`); mid-run per-file confirmation is not the default (AD-7).

## Library

- `IdeSessionHost` — Node-testable lifecycle owner (prompt + bridge `session/dispose` + notification fan-out)
- `ConversationRegistry` / `ConversationController` — Tab ↔ `sessionId` binding; recoverable close vs delete
- `MessageStore` — per-session chat projection for the Conversation panel (not an authority DB)
- `ExtensionIndex` — immediate `workspaceState` writes for `openTabSet` / `activeSessionId` (metadata only)
- `ChatPanelHost` — Host↔Webview protocol + send gate
- `TimelineStore` — pure session-scoped turn / step / tool / short assistant label / Diff projection
- `buildIdeChildEnv` — scrub-then-reinject child environment
- `redactSecrets` — AC-32 log hygiene

## Commands

| Command | Action |
|---|---|
| `dsh.startSession` | Start the window session host and open the first conversation Tab |
| `dsh.stopSession` | Shut down the session host |
| `dsh.newConversation` | Add a Tab with a fresh `sessionId` |
| `dsh.switchConversation` | Switch the active Tab (TreeView click or QuickPick) |
| `dsh.closeConversation` | Close (unload) the active Tab — **does not** dispose the session |
| `dsh.deleteConversation` | Explicitly delete: confirm → `session/dispose` + clear index |
| `dsh.promptActiveConversation` | Prompt the active Tab's `sessionId` (tests / scripting) |
| `dsh.selectPermissionPreset` | Pick a permission-presets name for the active Tab |
| `dsh.reviewWorkspaceDiffs` | Open post-hoc Diff for write/edit paths on the active Tab |
| `dsh.openTimelineDiff` | Open Diff from a Timeline write row (AC-25) |

### L2 test hooks (scripting / Extension Host harness)

| Command | Action |
|---|---|
| `dsh.test.sendPrompt` | Host-gated send (same gate as Webview `composer/send`) |
| `dsh.test.closeConversation` | Recoverable close; pass `{ confirmStopClose: true }` for running |
| `dsh.test.deleteConversation` | Delete path; pass `{ confirmed: true }` after confirm |
| `dsh.test.panelSnapshot` | Read panel mode / messages / index |
| `dsh.test.getIndex` | Read persisted ExtensionIndex snapshot |
| `dsh.test.openPanel` | Push panel state (smoke open) |

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
- Host not ready → delete is disabled / errors (no index-only fake delete).

`openTabSet` / `activeSessionId` are written to `workspaceState` on every change (not only on deactivate).

## Dual channel

- **SDK stdout** — JSON-RPC only (`initialize` / `session/prompt` / `shutdown`) plus server notifications (`session.event`, `session.status`, `subagent.*`). No `session/close` on stdout.
- **Host bridge** — UDS/named-pipe NDJSON for `session/dispose`, approval/questions, and permission RPC. Bridge traffic never shares stdout with the SDK.

The Extension does **not** reimplement agent-loop, tool execution, or session persistence (AC-15). Fail-closed approvals / questions live in `InteractionCoordinator` + `ide-bridge` terminal answerers — not in `packages/core/agent-loop`.

## Replaceability (AD-8)

Authoritative transport + frame contract: [`@deepseek-ai/dsh-ide-bridge` README § Replaceability](../../packages/ide/ide-bridge/README.md#replaceability-contract-ad-8). This Extension owns the **UI presenter** and **permission picker** faces only.

| Face | Seam in this app | Default | Replace without agent-loop |
|---|---|---|---|
| UI presenter | `InteractionUi` via `IdeSessionHost.setInteractionUi` / `InteractionCoordinator.setUi` | `createVscodeInteractionUi` (QuickPick / InputBox) | Any object returning legal `ApprovalOutcome` / `AskUserQuestionAnswer`; proof: `tests/replaceability-interaction-ui.spec.ts` |
| Auto-allow | `dsh.selectPermissionPreset` → Host `permission/select` | `workspace-write`; `danger-full-access` maps to approval `never` | Switch presets through `dsh-permission-presets` only — do not store a parallel policy in the Extension |
| Transport | Host listens with `IdeBridgeHostServer` | UDS / named pipe | Swap at the duplex / `NdjsonSocket` layer in ide-bridge (memory proof lives there) |

Changing QuickPick → Webview (or another presenter), swapping the bridge duplex, or selecting an auto-allow preset must stay inside `apps/vscode-dsh` + `packages/ide/ide-bridge` (AC-27 / AC-28).
