# Agent Note: Restore the general default agent and retire the SpecDev Orchestrator preset

Status: implemented

English | [中文](2026-09-30-ide-default-agent-restored.zh.md)

## Problem

The `ide` profile mounted the SpecDev Orchestrator as the deployment default agent preset for every session: `dsh-specdev-app` configured `agent-presets` with `default: specdev-orchestrator`, `includeShippedRoot: false`, and `includeUserRoot: false`. The general agent was therefore not merely non-default — it was absent from the roster, so `standard` could not be selected either, and the default identity was a workflow role: its persona (`complete: true`, which suppresses every other system-prompt section) says the agent must not edit application or business source, and its tool policy restricts the tool face to `read`/`read_image`/`grep`/`glob`/`bash` while hard-blocking `write`/`edit`/`str_replace_editor`. Those rules serve the workflow's discipline (AC-22) and are only correct inside a workflow; outside one they removed writing from the user's default agent.

The shortcut existed for a reason. A preset binds when the session is created, and a swap is accepted only before the session's first turn, while SpecDev's entry points (`/feature`, `/spec`, …) run after creation — so making the workflow role the deployment default was the one hook that guaranteed the persona and policy were in place before a workflow command ran. The cost was the coupling the user rejected: every new general capability had to be added to the workflow role's persona and allow-list, and every SpecDev change touched the default agent.

## Decision

### The IDE default agent is the general `standard` preset

`dsh-specdev-app` configures `agent-presets` with `default: standard`, `includeShippedRoot: true`, `includeUserRoot: false`, and the SpecDev preset root as an additional root, so role dispatch can mount `specdev-<role>` presets from the shipped roster. The bundle never replaces the deployment default with a workflow role.

### The SpecDev Orchestrator preset is deleted

Removed: `presets/specdev-orchestrator/`, `src/tool-policy.ts`, `src/orchestrator-tool-policy.ts`, the package's `./orchestrator-tool-policy` export and `@deepseek-ai/dsh-tools` peer dependency, `SPECDEV_ORCHESTRATOR_PRESET_ID`, and `SpecdevPresetsService.orchestratorPresetId`. `dsh-specdev-presets` ships the 11 role presets and the root a composition mounts for them.

### SpecDev is entered through its commands

Role children mount their own presets, `confirmGate` stays the only Human Gate writer, and the guard's fail-closed role/stage/branch/visual-chain checks are unchanged. The main session keeps the general agent's system prompt and full tool face: "the main session must not edit application source" is no longer a product behavior. `HarnessSdkJsonRpcServer.createSession` no longer attaches `specdev.*` metadata to every session; the workflow commands attach it when a session starts driving a workflow, which is also the only place the Orchestrator role label is now meaningful.

### The Layer-V smoke loses its shadow machinery

Route A is only the sandbox `HOME`: the shadow generator (`layer-v-shadow-preset.sh`), its `--check-shadow-preset` entry, the profile overlay that delivered the shadowed preset, the `toolPolicy` plan field, and the script's entry in `capability-domains.json` are gone. The run pins `agentPreset === 'standard'` from the session log, and the build-freshness entry is the app's real `main`, `lib/extension.cjs` (it had still named `lib/extension.js`, which the app's build stopped producing when the extension moved to the CJS shim over the ESM bundle).

## Alternatives considered

**Keep the Orchestrator default and make its tool policy configurable.** Rejected: the default identity would still be a workflow role, and every new general capability would still have to be added to it — the coupling this change removes.

**Switch the preset when a workflow command runs** (`agentPresets.select` on a session that has not run a turn, refusing otherwise). This is the shipped activation semantics and it would work, but it fixes SpecDev as a session identity: a session that ran a turn could never start a workflow, and a session that started one could never return to the general agent. The main-session discipline is not what this deployment enforces, so that state was not worth carrying.

**An IDE entry that creates a SpecDev session with the Orchestrator preset.** Keeps a console identity available, but nothing in the IDE creates sessions with a chosen preset, and the deployment default still had to stop being a workflow role. It remains available as a future entry.

**Make the discipline conditional on an active workflow** (persona fragment plus write restriction while a workflow is live). The cleanest "general agent, workflow discipline on demand" model, but the persona row replaces the section and `complete: true` suppresses the rest, so it needs new persona/policy mechanics for a discipline this deployment does not require.

**Keep the preset shipped but unselected.** Rejected: with no entry that creates such a session it has no consumer, and deleting it also removed the reason for the shadow generator and its pinned line numbers.

## Consequences

A new IDE session is a general agent: the full tool face, the shipped roster in the preset list, and no SpecDev identity unless a workflow is started. The main session can edit source directly while a workflow runs; what still binds is the gate state (`confirmGate` is the sole writer, the guard fails closed on the projection) and the runtime's advance guidance, not a narrowed tool face.

`dsh-specdev-presets` loses a public entry and a peer dependency, and `pnpm-lock.yaml` is re-recorded. The role preset headers, the presets and bundle READMEs, `docs/subsystems/specdev.md`, `docs/capability-seams.md`, and the generated Cordis catalog no longer describe an Orchestrator preset.

## Testing

`npx vitest run apps/vscode-dsh/tests packages/specdev packages/ide/ide-bridge packages/bundle/specdev-app packages/sdk/server` passes 46 files / 1296 tests: the bundle patch test pins `default: standard`, `includeShippedRoot: true`, and `includeUserRoot: false`, and the server test pins that a fresh session is not tagged and takes the deployment default. `pnpm run test:docs` passes all 15 gates.

The Layer-V smoke walks the whole five-step link on the `ide` profile and passes (run `20260930T081014Z-3193250`): the session header carries `agentPreset: 'standard'`, and the 27-tool face in `request/header` re-pins `EXPECTED_TOOL_COUNT`. The pin only became effective in that run — the extractor read `agentPreset` off the header event's `data` field, while the version-0 header is a flat first record, so every earlier run reported a null preset and the assertion had nothing to check.
