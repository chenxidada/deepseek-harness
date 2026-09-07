# @deepseek-ai/dsh-vscode-dsh

VS Code Extension host for `dsh --profile ide`.

## Summary

Listens on a Host bridge socket, spawns `dsh --profile ide` with `DSH_IDE_BRIDGE_SOCK`, completes SDK `initialize` before reporting connected, and shuts down the child on deactivate. Secrets are redacted from error UI copy.

One DSH process serves the window (AD-1). Multiple conversation Tabs each bind a distinct SDK `sessionId`. Switching Tabs retargets prompts; closing a Tab ends that session by default.

## Library

- `IdeSessionHost` — Node-testable lifecycle owner (prompt + bridge `session/dispose`)
- `ConversationRegistry` / `ConversationController` — Tab ↔ `sessionId` binding
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

## Default close policy (Q-3)

Closing a conversation Tab **ends that session**: the Extension sends a Host-bridge `session/dispose` frame; the runtime calls server-owned `AgentHandle.dispose()` and clears the SDK session Map. Recoverable / keep-alive close is not the default in this version.

## Dual channel

- **SDK stdout** — JSON-RPC only (`initialize` / `session/prompt` / `shutdown`). No `session/close` on stdout.
- **Host bridge** — UDS/named-pipe NDJSON for `session/dispose` (and later approval/questions).

The Extension does **not** reimplement agent-loop, tool execution, or session persistence (AC-15).
