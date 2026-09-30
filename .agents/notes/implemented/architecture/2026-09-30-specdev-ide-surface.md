# Agent Note: SpecDev IDE surface — snapshot v4 views, the gate decision form, and reference links

Status: implemented

English | [中文](2026-09-30-specdev-ide-surface.zh.md)

## Problem

The panel could render a SpecDev status strip and ask the Host to decide a pending gate, but it could not act on what it showed. The strip carried no plan position, no running role, no artifact list, no next-action affordance, and no record of what the session had already been granted out of the workspace, so every question those facts answer had to be asked in the chat. The gate itself was collected in a QuickPick while the card only said "a gate is pending" — the human's note never existed in the card, and a decided card looked like an undecided one. Message bodies printed `path:line` references as dead text even though the panel already knew how to open an `@` reference.

None of that was reachable from the existing wire view: `BridgeSpecdevSnapshot` carried gates, step states, and the visual-chain declarations, so the panel could only have answered them by reading `.specdev` itself — exactly the reading the bridge snapshot exists to keep on the runtime's side.

## Decision

### The runtime serves the plan and the artifact list (snapshot v4)

`SpecdevSnapshot` gains two optional views, computed by the runtime in `ide-view.ts`:

- `plan` — the phase-plan DAG in plan order, each row `{ id, dependencies, status }` with `done` when every step of the phase completed, `active` for the current phase, `todo` otherwise. A plan that cannot be parsed omits the field (`snapshot()` never throws for it).
- `artifacts` — the workflow-level `requirements.md`, `design.md`, `phase-plan.md`, and (in a UI workflow) `visual-baseline.md`, then each phase's `repo-exploration.md`, `implementation.md`, `review-correctness.md`, `review-design.md`, `review-connectivity.md`, `review.md`, and `verification.md`, plus `review-visual.md` for a phase the plan declares `ui: true`. Each row carries a workspace-relative POSIX `path`, its basename as `label`, the owning `phaseId` (or `null`), and `ready`/`missing` judged by non-empty content.

`SPECDEV_SCHEMA_VERSION` moves to 4. The projection schema, the bridge types, and the bridge validator accept the two optional fields, validate their rows when present, and keep older payloads valid. `confirmGate`'s logged snapshot carries the same views, so the offline fold still equals the live snapshot.

### The card carries the decision and the note

A pending gate renders an inline form on the card: the runtime's basis for that gate, the risk lines the status already carries (blocking debt, rework rounds, missing artifacts), a multi-line note, and the three decisions 通过并推进 / 打回修改 / 延后. The card sends one `action/specdev-gate` intent with `{ decision, note? }`; the Host applies it through `confirmGate`, which stays the only writer of gate state.

A rejection requires its note at both ends: the card keeps 打回修改 disabled until one is typed, and `applySpecdevGateDecision` refuses a note-less rejection with a warning instead of writing. Passing and deferring leave the note optional. The palette presenter (`dsh.specdevStatus` → QuickPick) collects the same three decisions and calls the same applier.

### References open through one route

Artifact rows and `path:line` references in message bodies both emit `action/open-reference` with `{ path, line? }`. The extension reveals the named line, preferring the reference's own line over stored selection meta, because the author named the line in the message. Body references are extracted in the Host's safe-markdown renderer (`file-links.ts`): at least one `/`, a file extension, then `:line` with an optional `:column`; a URL, an `@` mention, or a path without a line stays plain text.

### The strip answers the rest

The strip adds the plan order with the active phase and its dependencies, the role the current phase is running, the artifact strip, and the runtime's next action with a「填入输入框」button that fills the composer without sending. The status frame carries `lastScope` — the latest grant folded from `specdev/scope-decided` — so the card can name what this session may already reach; the grant itself still lives in the guard's session scope.

Out-of-workspace requests keep the interaction card they already used: its detail block names the tool, role, access, paths, a recursive-scan risk line, and the asker's reason, and its four options are the scope choices.

## Alternatives considered

**Keep the QuickPick as the only decision presenter.** Zero new UI. Rejected: the note is part of the decision a human makes while reading the basis on the card, and two presenters would have drifted in what they collect and what they refuse.

**Derive the plan and artifact list in the extension.** No runtime change, and the extension can list files. Rejected: the panel would read `.specdev` behind the runtime's back, duplicating the plan parse and the artifact naming the runtime owns, and a stale read would disagree with the status it renders next to.

**Emit a second intent type for file links.** Rejected: the `@` reference route already resolves workspace paths through the send gate's own check; a parallel route would need the same resolution and could disagree on escaping.

**Linkify in markdown-it (`rich-markdown.ts`).** Rejected: the panel renders through the safe subset renderer, and the thin chat HTML renders through its browser-source mirror; a third implementation would diverge in exactly the escaping rules the subset exists to guarantee.

**Send the next action as a prompt from the card.** One click to continue. Rejected: the next action is the runtime's guidance for the orchestrator, and sending it would spend a turn the human did not ask for; filling the composer keeps them in control of the wording.

## Consequences

The snapshot now has two optional views. An older payload still renders — absent fields leave those rows out — and a malformed row drops that one list rather than the whole status. `SPECDEV_SCHEMA_VERSION` is 4; the projection strict-parses the wire view, so a payload with malformed rows records a fold failure instead of degrading.

The bridge frame `specdev/status` gained `lastScope?`. It is display-only: the guard's session scope remains the authority, and the card never grants anything.

The card writes nothing itself. Every decision reaches `confirmGate` through the extension, which is also where the note requirement is enforced before the runtime sees the decision. The runtime still refuses out-of-order gates, so the palette and the card behave identically against the same rules.

`path:line` linkification applies to message bodies only; the composer keeps its `@` route.

## Testing

`packages/specdev/specdev/tests/ide-view.spec.ts` pins the plan statuses, the plan-less fallback, the artifact rows (workflow-level, per phase, UI-only rows, ready vs missing, POSIX paths); `tests/projection.spec.ts` pins the fold's acceptance and its fail-closed refusal of a malformed row; `packages/ide/ide-bridge/tests/bridge-session-frames.spec.ts` pins the v4 wire view and the row refusals. `apps/vscode-dsh/tests/cap-webview.spec.tsx` pins the strip (plan, role, scope), the artifact click, the next-action prefill, the gate form (basis, risks, disabled rejection, decision + note intent), and a `path:line` body link opening its line; `tests/cap-chat-panel.spec.ts` pins the Host forwarding a decision with its note, dropping a frame without one, the renderer's file links, and the browser-source parity fixture; `tests/cap-interaction.spec.ts` pins the note-less rejection warning; `tests/cap-conversation.spec.ts` pins the scope fold into the status frame and the decision + note round-trip through `specdev/confirm-gate`.

## Related

[The visual chain note](2026-09-30-specdev-visual-chain.md) owns the `ui` declarations and gates this surface renders; [the workflow authority note](2026-09-29-specdev-workflow-authority.md) owns the log and projection rules; [the permission model note](2026-09-30-specdev-permission-model.md) owns the scope grants the strip names; [the SpecDev subsystem doc](../../../../docs/subsystems/specdev.md) carries the user-facing picture and the [app README](../../../../apps/vscode-dsh/README.md) the panel's own behavior.
