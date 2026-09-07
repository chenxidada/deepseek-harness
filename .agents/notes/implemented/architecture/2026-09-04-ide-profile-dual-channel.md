# IDE profile dual-channel Host bridge

## Context

The VS Code Extension must drive DeepSeek Harness without putting Host approval or user-questions traffic on SDK stdout. ACP already answers permissions on its own stdio protocol; the IDE profile cannot share that channel with `dsh-sdk-jsonrpc-server`.

## Decision

Ship `ide` as `dsh-base` + `dsh-sdk-app` + `dsh-ide`, with `dsh-ide-bridge` connecting to an Extension-owned Unix domain socket (Windows: named pipe) named by `DSH_IDE_BRIDGE_SOCK`. SDK initialize/prompt/shutdown stay on stdio JSON-RPC. Bridge answerers fail closed until Phase 3 completes Host UI round-trips. Web `ui-approval` / `ui-user-questions` rows are forbidden in the ide patch (static assertion).

## Consequences

- Extension builds child env with `scrubbedParentEnv` then re-injects `DSH_IDE_BRIDGE_SOCK` (and `DSH_HOME` when needed).
- `PROFILE_TEMPLATES.ide` and the `apps/cli` in-box dependency on `@deepseek-ai/dsh-ide` are required for installation-first resolution.
- Full approval and user-questions Host UI remain `@STUB(phase-3-interaction-fail-closed)`.
