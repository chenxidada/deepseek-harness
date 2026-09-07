# @deepseek-ai/dsh-vscode-dsh

VS Code Extension host for `dsh --profile ide`.

## Summary

Listens on a Host bridge socket, spawns `dsh --profile ide` with `DSH_IDE_BRIDGE_SOCK`, completes SDK `initialize` before reporting connected, and shuts down the child on deactivate. Secrets are redacted from error UI copy.

One DSH process serves the window (AD-1). Multiple conversation Tabs each bind a distinct SDK `sessionId`. Switching Tabs retargets prompts and filters the Timeline; closing a Tab ends that session by default.

SDK `session.event` / `session.status` / subagent notifications are projected into a Timeline TreeView. Write/edit tool results that carry `meta.diffs` expose a **post-hoc** Diff entry (`vscode.diff`); mid-run per-file confirmation is not the default (AD-7).

## Library

- `IdeSessionHost` — Node-testable lifecycle owner (prompt + bridge `session/dispose` + notification fan-out)
- `ConversationRegistry` / `ConversationController` — Tab ↔ `sessionId` binding + timeline projection
- `TimelineStore` — pure session-scoped turn / step / tool / assistant / Diff projection
- `buildIdeChildEnv` — scrub-then-reinject child environment
- `redactSecrets` — AC-32 log hygiene

## Commands

| Command | Action |
|---|---|
| `dsh.startSession` | Start the window session host and open the first conversation Tab |
| `dsh.stopSession` | Shut down the session host |
| `dsh.newConversation` | Add a Tab with a fresh `sessionId` |
| `dsh.switchConversation` | Switch the active Tab (TreeView click or QuickPick) |
| `dsh.closeConversation` | Close the active Tab and dispose its session |
| `dsh.promptActiveConversation` | Prompt the active Tab's `sessionId` (tests / scripting) |
| `dsh.selectPermissionPreset` | Pick a permission-presets name for the active Tab |
| `dsh.reviewWorkspaceDiffs` | Open post-hoc Diff for write/edit paths on the active Tab |
| `dsh.openTimelineDiff` | Open Diff from a Timeline write row (AC-25) |

## Views

| View id | Contents |
|---|---|
| `dsh.conversations` | Conversation Tab bar |
| `dsh.timeline` | Active Tab timeline (turn / step / tool / assistant; subagent nesting) |

## Default close policy (Q-3)

Closing a conversation Tab **ends that session**: the Extension sends a Host-bridge `session/dispose` frame; the runtime calls server-owned `AgentHandle.dispose()` and clears the SDK session Map. Recoverable / keep-alive close is not the default in this version.

## Dual channel

- **SDK stdout** — JSON-RPC only (`initialize` / `session/prompt` / `shutdown`) plus server notifications (`session.event`, `session.status`, `subagent.*`). No `session/close` on stdout.
- **Host bridge** — UDS/named-pipe NDJSON for `session/dispose`, approval/questions, and permission RPC.

The Extension does **not** reimplement agent-loop, tool execution, or session persistence (AC-15).
