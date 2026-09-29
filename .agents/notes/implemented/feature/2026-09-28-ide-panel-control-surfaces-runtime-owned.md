# Agent Note: IDE panel control surfaces call the runtime service that owns them

Status: implemented

English | [中文](2026-09-28-ide-panel-control-surfaces-runtime-owned.zh.md)

## Problem

Four decisions the runtime owns had no reachable control in the VS Code panel, and the panel approximated what it could not ask.

Model selection did nothing visible. `model/select` wrote the default the SDK server read only when it created a session, and `extension.ts` injected no `requestSelectModel`, so the picker changed a preference while the Tab kept talking to the previous model. Images left the composer for any route: `dsh-llm-deepseek` declares `deepseek-v4-pro` text-only, and the runtime projects an image to placeholder text for a model whose catalog omits the image modality, so an attachment could degrade without the panel saying so.

A subagent could be watched through its Tab but not addressed: nothing listed the children or descendants of a session, nothing continued a continuable child, and nothing stopped one.

The approval policy was switchable only by picking a permission preset, and the preset picker showed raw keys because `permission/list` answered only preset ids; the ask/decide audit existed as `approval/asked` and `approval/decided` events no surface folded. SpecDev state — the active workflow, its stage, its Human Gates, its next action — was invisible, including a gate waiting for a human.

## Decision

Each control is a bridge frame that resolves the runtime service owning the decision, plus the panel surface that drives it.

**Model route.** `dsh-sdk-jsonrpc-server` publishes `sdkModelSelect`, and every session it creates, resumes, or forks installs a `ModelSelection` the next prompt assembly reads. `model/select` validates the route against the runtime's model catalog, hands it to that service so live sessions adopt it, and only then saves it as the default for later sessions; a running turn keeps the route it assembled with. The catalog's `vision` flag marks image-capable models, and the composer states that an attached image on a route without it reaches the model as placeholder text. The composer also declares each attachment's media type from the bytes it read — PNG, JPEG, WebP, or GIF — and keeps the platform's `File.type` only when the bytes carry no signature, because the runtime refuses a declaration its own detection contradicts (`image/jpg` against JPEG bytes, a WebP saved as `.png`). The user bubble for that send carries the same bytes, so the attachment is visible in the conversation without a second read. A session folded from its log has only the durable reference, so `attachment/read` resolves it through the attachment store and the resulting bytes are patched onto that bubble; the read is per image, and one the store refuses leaves just that bubble without it.

**Subagents.** `subagent/list` answers a session's children or descendants from the subagent catalog, `subagent/prompt` continues one child under its durable parent's authority (`mode: 'continuable'`, never a fresh root), and `subagent/interrupt` aborts one under the same parent. The composer offers a child address only while the child is continuable and not running; a `subagent/interrupt` on an idle or finished child succeeds as a no-op, because racing a natural completion must not read as a failure.

**Approval.** `approval/policy` reports one session's effective policy — its override, else the configured value. `approval/policy/set` switches it through the approval service, which logs the change durably and states it to the model on its next step; the panel never writes a policy itself. `approval/asked` and `approval/decided` fold into Timeline rows, so the audit the log holds is visible.

**SpecDev.** `specdev/snapshot` returns the workspace's status (slug, stage, gates, per-phase steps, loop count, next action, tech debt) or `null` when no workflow is active. `specdev/confirm-gate` is the only write and delegates to `ctx.specdev.confirmGate`, which owns gate order, artifact preconditions, and the durable `specdev/gate-decided` append; a refusal reaches the panel as the runtime's own code and message. A `dsh.specdevStatus` QuickPick and the panel's status card mirror what that read reports, and the card's one action hands the pending gate back to the Host, which asks for the decision (pass / reject / defer, with an optional note for the latter two).

**Permission presets.** `permission/list` carries each preset's `name` and `description`, so the picker shows product copy instead of raw keys.

SpecDev status is workspace state, not log state. The Extension therefore re-reads it on every `specdev/*` event, when a Tab is activated, and when a history row opens, rather than folding events into its own copy.

## Alternatives considered

**Restart the SDK runtime on a model switch.** A restart is the one mechanism that also picks up a changed composition. Rejected: it ends every live session and its in-flight turns, while the server can already hand a new route to the next prompt assembly of each live session — the switch costs one round trip instead of a session.

**Ship model selection as a preference for future sessions, with a hint.** That is what the code did, and it needed only a hint. Rejected: the user's gesture is about the conversation in front of them; making a promise the panel does not keep is worse than making the switch real.

**Let the Extension decide gate legality.** The card could pass or reject locally and write the workspace file. Rejected: gate order, artifact preconditions, and the durable append belong to the specdev service, and a second judge would drift from the workflow that owns them.

**Fold `specdev/*` events into Extension state.** The events carry the phase and gate transitions. Rejected: the panel's claim is about the workspace file the runtime writes, and another window can advance the same workflow; a folded copy would show a stale gate with no way to know.

**One generic `control/invoke` frame for subagents, approval, and SpecDev.** Fewer kinds. Rejected: each target answers different fields with different refusals, and a generic channel would either accept unvalidated payloads or grow a schema per target — the same choice the frame families already made.

**Admit images on any route and let the runtime degrade them.** No catalog read, no notice. Rejected: the composer is the last place the user can see that the model will not read the image.

## Consequences

A model switch reaches the next request of every live session; the Tab's route line follows `request/header` and `request/context`, so it reports the selection as in effect only once the runtime has used it.

Every control is addressed by session and needs a live Agent; without one the frame is refused and the panel banners the runtime's message. `approval/policy/set` and `subagent/*` therefore do not apply to a replay Tab.

SpecDev status is workspace-scoped, so a workflow started in one Tab appears in every Tab of that workspace, and the gate prompt is presented by the Extension's interaction presenter rather than inside the panel.

`subagent/interrupt` reports success for an idle target by design; a caller that needs to know whether a turn was actually aborted reads the child's events, not the acknowledgement.

A sent image is visible from the composer's bytes while its Tab holds them, and from the attachment store after a reopen: a session folded from the log carries the reference alone, so the panel reads each image back before it pushes that bubble's images. A Tab opened while the runtime is unreachable keeps that message's text and gains its images when a later open resolves them.

## Testing

`packages/ide/ide-bridge/tests/bridge-session-frames.spec.ts` pins the model, subagent, approval, SpecDev, and attachment-read frames' validation and responders, including unknown sessions, missing services, and refusal texts. `packages/sdk/server/tests/server.spec.ts` pins that a selection reaches live sessions and that a rejected route is not saved. `packages/llm/llm-deepseek/tests/adapter.spec.ts` pins the shipped catalog's modalities. `apps/vscode-dsh/tests/cap-conversation.spec.ts` drives the subagent, approval-policy, and SpecDev round-trips through the Host, pins that a `specdev/*` event triggers a re-read, pins that a prompted image rides the optimistic user bubble, and pins the replay image echo with both a resolved and a refused read. `apps/vscode-dsh/tests/cap-interaction.spec.ts` pins the gate decision presenter (pass without a note, reject and defer with one); `apps/vscode-dsh/tests/cap-webview.spec.tsx` pins the status card, the gate action, the address that reaches the composer, the attachment media type a mislabeled payload declares, the images a user bubble renders, and the images an image-carrying patch adds to a replayed bubble; `apps/vscode-dsh/tests/cap-chat-panel.spec.ts` pins the refusals and the image notice.

## Related

The frames travel on [the IDE Host bridge](../../../../docs/subsystems/ide-bridge.md); the services behind them are [the subagent subsystem](../../../../docs/subsystems/subagent.md), [the approval subsystem](../../../../docs/subsystems/approval.md), and [the SpecDev subsystem](../../../../docs/subsystems/specdev.md). The reads the panel pairs these controls with are [the IDE reads note](2026-09-28-ide-panel-reads-runtime-state.md), and the composer that hosts the child address and the image notice is [the slash-catalog note](2026-09-28-ide-composer-slash-catalog.md).
