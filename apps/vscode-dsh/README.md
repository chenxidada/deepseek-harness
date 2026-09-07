# @deepseek-ai/dsh-vscode-dsh

VS Code Extension host for `dsh --profile ide`.

## Summary

Listens on a Host bridge socket, spawns `dsh --profile ide` with `DSH_IDE_BRIDGE_SOCK`, completes SDK `initialize` before reporting connected, and shuts down the child on deactivate. Secrets are redacted from error UI copy.

## Library

- `IdeSessionHost` — Node-testable lifecycle owner
- `buildIdeChildEnv` — scrub-then-reinject child environment
- `redactSecrets` — AC-32 log hygiene

## Commands

| Command | Action |
|---|---|
| `dsh.startSession` | Start the window session host |
| `dsh.stopSession` | Shut down the session host |
