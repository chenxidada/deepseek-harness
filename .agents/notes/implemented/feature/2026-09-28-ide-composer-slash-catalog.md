# Agent Note: The IDE composer's `/` menu reads and runs the runtime catalogs

Status: implemented

English | [中文](2026-09-28-ide-composer-slash-catalog.zh.md)

## Problem

The VS Code Extension's composer had no read of the runtime's command registry and no way to run a line against it. A user typing `/feature <description>` in the panel watched the text leave as an ordinary prompt: `dsh-sdk-jsonrpc-server` serves `initialize`, `session/prompt`, and `shutdown` on stdout, and the Web client's command surfaces (`commands/list`, `commands/execute`, `skills/list`) ride the Host API's HTTP transport, which the `ide` profile does not mount. The same gap hit the Extension's own compaction button, which reached the model as the literal text `/compact` instead of running the command of that name.

A Tab that never prompted worsened it: the runtime holds no Agent for it, and every command path in the runtime resolves the registry through a live Agent, so the menu could not borrow the Web's assumption that a session always has one.

## Decision

Four bridge frames carry the catalogs and the execution, and one new SDK-server service gives the command path a live Agent to run against.

`commands/list`, `commands/execute`, `agent-presets/list`, and `skills/list` join the bridge frame inventory, each answering a `<kind>/response` frame and each resolving the service the runtime itself serves (`ctx.commands`, `ctx.agentPresets`, `ctx.skills`). They stay separate frames because they have separate owners, scopes, and failure texts: the preset roster is deployment-wide, the other two are addressed by `sessionId`.

`ctx.sdkSessionEnsure` publishes `ensureSession(sessionId)` from `dsh-sdk-jsonrpc-server`, delegating to the same `getOrCreateSession` that `session/prompt` uses. The bridge resolves it through `ctx.get` and calls it whenever a session-scoped request finds no live Agent, so a command issued from an empty Tab runs against the composition its first prompt would have created — no second creation route exists.

The Extension aggregates the three catalogs behind one Webview frame pair (`composer/slash-query` → `composer/slash-candidates`), ranked and capped in the Host. Picking a row inserts `/name ` for a command or a skill and the bare preset id for an agent row, because a preset is bound when the session is created and the row is prompt guidance rather than a command.

A sent command line runs before the `@path` and prompt gates, since a command's arguments are free-form text. `commands/execute` reporting `matched: false` — no command claims the line — returns the line to the prompt path, which is where `dsh-tool-skill`'s `agent/pre-step` boundary already reads a leading `/name` as a skill invocation. The result is a local notice in the message flow: the composer, not the model, renders what a command printed.

## Alternatives considered

**List the catalogs without running them.** The smallest bridge change would have answered the menu from the registries and left every sent line on the prompt path. Rejected: a menu that offers `/feature` and then ships `/feature` to the model as prose makes the Extension lie about the runtime, and the same lie was already the compaction button's bug.

**One `slash/list` frame carrying all three catalogs.** Fewer kinds to validate and one round trip per keystroke. Rejected because the three catalogs share none of their scoping: fusing them would put the deployment's preset roster and a session's skills behind one failure text, and a caller that wants only the presets would drag a session read.

**A dedicated execution frame for skills.** Symmetry with `commands/execute` would let a skill row skip the prompt path. Rejected: `agent/pre-step` already reads a leading `/name` off any prompt, so skills need listing only; a second route would give one name two execution meanings and two places to change when skill invocation moves.

**Materialize the session only for `commands/execute`,** keeping the catalog reads non-activating as the Web's `skills/list` is. Rejected: an empty Tab would then show no skills, and its rows would come from a different composition than the prompt that follows the menu. The accepted cost is a materialized session for a Tab where the user only opened the menu.

**Insert an agent row as a command (`/preset <id>`).** One gesture for all three groups. Rejected: nothing on the runtime side switches a live session's preset, so the insertion would promise a switch the command cannot perform.

**Report each command's `acceptsImages` flag on its row.** The registry declares it. Rejected: this bridge carries no images at all, so the flag would advertise a capability the transport always refuses; the composer banners a slash line sent with attachments and keeps it a plain message instead.

## Consequences

The composer's rows are runtime truth: every name the menu offers resolves in the registry the runtime serves, and the Extension filters a preset the deployment cannot mount before the row is rendered. A run command's output reaches the user without entering the model's context, so a later turn cannot refer to what a command printed, and the session log still records the run and its outcome through the command registry's own events.

The Extension now materializes a Tab's session on a menu open. A user who types `/`, reads the list, and closes the Tab leaves a session behind, and the first `skills/list` for a session costs the same composition mount its first prompt would have paid.

`skills/list` is activating on this surface while the Web's same Remote is explicitly not, because the Web's composer only ever sees sessions that already have an Agent. The asymmetry is the price of the IDE's empty Tab; a future surface that reads a catalog for a Tab it does not intend to run in should resolve an existing Agent instead of ensuring one.

The composer's 压缩上下文 button and `dsh.triggerCompact` take the command path first and fall back to the prompt path only when no command claims `/compact`, so a composition without that command keeps its previous behavior instead of failing.

## Testing

`packages/ide/ide-bridge/tests/bridge-command-frames.spec.ts` covers the four frames' validation and responders, including the missing-service and no-live-agent failures; `packages/sdk/server/tests/plugin-apply.spec.ts` proves `ensureSession` materializes once and reuses the live session. `apps/vscode-dsh/tests/cap-chat-panel.spec.ts` pins ranking, caching, the empty answer without a catalog, command routing ahead of the send gate, and the attachment banner; `cap-webview.spec.tsx` pins the menu's insertion, Escape, argument flow, and agent-row id.

## Related

The Web's own command surfaces and their assembly are [the web-command-surfaces Agent Note](../architecture/2026-07-25-web-command-surfaces-and-assembly.md); the skill gesture the prompt path keeps is [user-explicit skill invocation](2026-08-08-user-explicit-skill-invocation.md), and how the Web's catalogs follow a preset switch is [the slash-catalog Agent Note](../bug-fix/2026-08-10-slash-catalog-follows-preset-switch.md). The channel and frame families that carry these frames are [the IDE Host bridge subsystem](../../../../docs/subsystems/ide-bridge.md).
