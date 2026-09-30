/**
 * SpecDev slash-command surface over `ctx.specdev`.
 *
 * Commands are the workflow's entry and advance points; Human Gate decisions
 * are applied by the panel through `ctx.specdev.confirmGate`, so no gate
 * command exists here. Registration is optional: it happens only in
 * compositions that provide the `commands` registry.
 *
 * @module @deepseek-ai/dsh-specdev/commands
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-commands'
import {
  artifactNonEmpty,
  firstReadyPhaseId,
  isDagPhaseId,
  readPhasePlanDag,
} from './phase-plan.ts'
import { requiresPhaseEntryGate } from './tech-debt.ts'
import { attachOrchestratorMetadata } from './dispatch.ts'
import type { SpecdevRole, SpecdevSnapshot } from './types.ts'

/** Workflow-start command names that create a SpecDev layout. */
export type WorkflowStartCommand = 'feature' | 'bugfix' | 'research'

/** Workflow-start commands in registration order. */
const WORKFLOW_START: readonly WorkflowStartCommand[] = [
  'feature',
  'bugfix',
  'research',
]

/** Human-readable pipeline mode for each command. */
const COMMAND_MODE: Readonly<Record<WorkflowStartCommand | 'spec' | 'implement' | 'status' | 'wiki', string>> = {
  feature: 'multi-phase Feature → requirement-analyst → HG-1',
  bugfix: 'condensed single-phase bugfix → design/HG path',
  research: 'exploration only — no implementer/reviewer/verifier',
  spec: 'requirements then design; stops at HG-2 with no implementation',
  implement: 'current-phase implement→review→verify loop',
  wiki: 'wiki agent → workspace docs/wiki/ (no KB sync)',
  status: 'status report',
}

/**
 * Slugify a free-text description into a filesystem-safe workflow id.
 * @param input - command raw input / description.
 * @returns the slug, or a timestamped fallback when the input has no alphanumerics.
 */
export function slugifyDescription(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug.length > 0 ? slug : `workflow-${Date.now().toString(36)}`
}

/**
 * Format a `snapshot()` view as a human-readable `/status` report.
 * @param snap - SpecDev snapshot.
 * @returns the multi-line report text.
 */
export function formatStatusReport(snap: SpecdevSnapshot): string {
  const debt = snap.techDebtSummary
  const debtLine = debt === undefined
    ? 'tech debt: (not summarized)'
    : `tech debt: blocking=${String(debt.blocking)} total=${String(debt.total)}`
  const steps = Object.entries(snap.steps)
  const stepLines = steps.length === 0
    ? ['  (no phase steps yet)']
    : steps.map(([phaseId, triple]) => (
      `  ${phaseId}: implementer=${triple.implementer} reviewer=${triple.reviewer}`
        + ` verifier=${triple.verifier} prototype=${triple.prototype}`
    ))
  return [
    `SpecDev status (schema v${String(snap.schemaVersion)})`,
    `slug: ${snap.slug}`,
    `stage: ${snap.stage}`,
    `phase: ${snap.phase ?? '(none)'}`,
    `pipelineMode: ${snap.pipelineMode ?? '(none)'}`,
    `initiatingCommand: ${snap.initiatingCommand ?? '(none)'}`,
    `gates: hg1=${snap.gates.hg1} hg1_5=${snap.gates.hg1_5} hg2=${snap.gates.hg2} hg3=${snap.gates.hg3}`,
    `uiWorkflow: ${String(snap.ui.workflow)}`,
    `pendingGate: ${snap.pendingGate ?? '(none)'}`,
    `loopCount: ${String(snap.loopCount)}`,
    debtLine,
    `nextAction: ${snap.nextAction ?? '(none)'}`,
    'steps:',
    ...stepLines,
  ].join('\n')
}

/** Resolve workspace cwd for SpecDev APIs from the invoking agent session. */
function workspaceCwd(invocation: CommandInvocation): string {
  return invocation.agent.session.header.cwd ?? process.cwd()
}

/** Start a workflow command: ensure layout + dispatch next role + report. */
async function runWorkflowStart(
  ctx: Context,
  invocation: CommandInvocation,
  command: WorkflowStartCommand,
): Promise<CommandResult> {
  const description = invocation.rawInput.trim()
  if (description.length === 0) {
    return { kind: 'error', text: `Usage: /${command} <description>` }
  }
  const slug = slugifyDescription(description)
  const cwd = workspaceCwd(invocation)
  const active = await ctx.specdev.ensureLayout({
    slug,
    command,
    description,
    workspaceRoot: cwd,
  })
  const mode = COMMAND_MODE[command]
  const nextRole: SpecdevRole = command === 'research'
    ? 'code-explorer'
    : 'requirement-analyst'

  attachOrchestratorMetadata(invocation.agent, active.slug)
  const dispatched = await ctx.specdev.dispatchRole(invocation.agent, {
    role: nextRole,
    slug: active.slug,
  })

  return {
    kind: 'success',
    text: [
      `SpecDev workflow \`${active.slug}\` ready under ${active.layoutRoot}.`,
      `Mode: ${mode}.`,
      command === 'research'
        ? 'Stage: requirement-analysis; no Human Gate — exploration only.'
        : 'Stage: requirement-analysis; pendingGate: hg1.',
      `Dispatched \`${nextRole}\` (preset \`${dispatched.presetId}\`) childSession=${dispatched.childSessionId}`
        + ` mounted=${String(dispatched.mounted)} factory=${String(dispatched.factoryCreated)}.`,
      `Orchestrator metadata attached (specdev.role=orchestrator, slug=${active.slug}).`,
      'Emitted specdev/dispatch for bridge lineage (AC-24).',
      command === 'research'
        ? 'Research stops after exploration — do not dispatch implementer/reviewer/verifier.'
        : 'Stop at HG-1 after requirements; the panel applies the gate decision.',
    ].join('\n'),
  }
}

/**
 * `/spec <description>` — start a spec-only workflow: requirements, then design.
 * `/spec` without a description — continue the active workflow, dispatching
 * plan-generator once HG-1 passed (the former `/plan` step).
 */
async function runSpec(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const description = invocation.rawInput.trim()
  const cwd = workspaceCwd(invocation)
  if (description.length === 0) return continueSpecDesign(ctx, invocation, cwd)

  const slug = slugifyDescription(description)
  const active = await ctx.specdev.ensureLayout({
    slug,
    command: 'spec',
    description,
    workspaceRoot: cwd,
  })
  attachOrchestratorMetadata(invocation.agent, active.slug)
  const dispatched = await ctx.specdev.dispatchRole(invocation.agent, {
    role: 'requirement-analyst',
    slug: active.slug,
  })

  return {
    kind: 'success',
    text: [
      `SpecDev workflow \`${active.slug}\` ready under ${active.layoutRoot}.`,
      `Mode: ${COMMAND_MODE.spec}.`,
      'Stage: requirement-analysis; pendingGate: hg1.',
      `Dispatched \`requirement-analyst\` (preset \`${dispatched.presetId}\`) childSession=${dispatched.childSessionId}`
        + ` mounted=${String(dispatched.mounted)} factory=${String(dispatched.factoryCreated)}.`,
      'Run /spec again after HG-1 is confirmed to continue with design.md + phase-plan.md (stop at HG-2).',
      'No implementation runs under /spec — hand the approved spec to /implement.',
    ].join('\n'),
  }
}

/**
 * Design step of `/spec`: requires HG-1 passed and a non-empty requirements.md,
 * then dispatches plan-generator and stops at HG-2.
 */
async function continueSpecDesign(
  ctx: Context,
  invocation: CommandInvocation,
  cwd: string,
): Promise<CommandResult> {
  const active = ctx.specdev.active({ cwd })
  if (active === null) {
    return { kind: 'error', text: 'No active SpecDev workflow. Start with /spec <description> first.' }
  }
  const status = ctx.specdev.readStatus(active.slug, { cwd })
  if (status.human_gates.hg2 === 'passed') {
    return {
      kind: 'success',
      text: [
        `SpecDev \`${active.slug}\` already has an approved design (HG-2 passed).`,
        'Nothing left for /spec — run /implement for the current phase.',
      ].join('\n'),
    }
  }
  if (status.human_gates.hg1 !== 'passed') {
    return {
      kind: 'error',
      text: [
        'Refused: /spec requires HG-1 to be passed before the design step (AC-16).',
        'Confirm the requirements in the panel, then run /spec again.',
      ].join('\n'),
    }
  }
  const slugDir = join(active.layoutRoot, 'specs', active.slug)
  if (!artifactNonEmpty(slugDir, 'requirements.md')) {
    return {
      kind: 'error',
      text: 'Refused: /spec requires non-empty requirements.md (AC-16).',
    }
  }

  attachOrchestratorMetadata(invocation.agent, active.slug)
  const dispatched = await ctx.specdev.dispatchRole(invocation.agent, {
    role: 'plan-generator',
    slug: active.slug,
  })

  return {
    kind: 'success',
    text: [
      `SpecDev /spec design step for \`${active.slug}\`.`,
      'Mode: architecture + phase-plan; stop at HG-2 (HG-1.5 first when the plan declares a UI phase).',
      `Dispatched \`plan-generator\` (preset \`${dispatched.presetId}\`) childSession=${dispatched.childSessionId}`
        + ` mounted=${String(dispatched.mounted)} factory=${String(dispatched.factoryCreated)}.`,
      'Emitted specdev/dispatch for bridge lineage (AC-24).',
      'After design.md + phase-plan.md exist, stop for HG-2; the panel applies the gate decision.',
    ].join('\n'),
  }
}

/**
 * `/implement` — start the current-phase runtime loop (AC-17 / STUB-001):
 * Phase Entry Gate → ensurePhaseBranch → dispatch code-explorer (or implementer
 * when exploration already exists). Orchestrator continues via advance + helpers
 * (three-review merge / verifier / confirmGate(hg3) + completePhaseGit).
 */
async function runImplement(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const cwd = workspaceCwd(invocation)
  const active = ctx.specdev.active({ cwd })
  if (active === null) {
    return { kind: 'error', text: 'No active SpecDev workflow. Start with /feature (or sibling) first.' }
  }
  const status = ctx.specdev.readStatus(active.slug, { cwd })
  if (status.human_gates.hg2 !== 'passed') {
    return {
      kind: 'error',
      text: 'Refused: /implement requires HG-2 passed and a current_phase. Complete /spec + confirmGate(hg2) first.',
    }
  }
  const phaseId = status.current_phase
  if (phaseId === null || phaseId.trim().length === 0) {
    return {
      kind: 'error',
      text: 'Refused: /implement requires current_phase (DAG phases[].id). Pass HG-2 so SpecDev can select the first ready phase.',
    }
  }

  const slugDir = join(active.layoutRoot, 'specs', active.slug)
  let dag
  try {
    dag = readPhasePlanDag(slugDir)
  } catch (error: unknown) {
    /* v8 ignore next -- readPhasePlanDag reports every failure as SpecdevError. */
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: `Refused: cannot read phase-plan DAG (${message}).` }
  }
  if (!isDagPhaseId(dag, phaseId)) {
    return {
      kind: 'error',
      text: `Refused: current_phase=${phaseId} is not a DAG phases[].id (AC-42).`,
    }
  }

  // Phase Entry Gate (AC-33): Phase 2+ with blocking inherited debt must disposition first.
  const firstReady = firstReadyPhaseId(dag)
  if (requiresPhaseEntryGate(phaseId, firstReady)) {
    const blocking = ctx.specdev.listPhaseEntryDebt(phaseId, { cwd })
    if (blocking.length > 0) {
      const table = ctx.specdev.presentPhaseEntryDebt(phaseId, { cwd })
      return {
        kind: 'error',
        text: [
          `Phase Entry Gate: blocking inherited debt for \`${phaseId}\` must be dispositioned before implementer (AC-33).`,
          table,
          'Apply a phase-entry decision in the panel (resolve / defer / cancel), then re-run /implement.',
        ].join('\n'),
      }
    }
  }

  attachOrchestratorMetadata(invocation.agent, active.slug)

  let branchInfo: { branch: string; created: boolean; stayed: boolean }
  try {
    branchInfo = ctx.specdev.ensurePhaseBranch(phaseId, { cwd })
  } catch (error: unknown) {
    /* v8 ignore next -- ensurePhaseBranch reports every failure as SpecdevError. */
    const message = error instanceof Error ? error.message : String(error)
    return {
      kind: 'error',
      text: `ensurePhaseBranch failed: ${message}. Create a git repo under the workspace root (fixture project) and retry.`,
    }
  }

  const phaseDir = join(slugDir, 'phases', phaseId)
  const explorationReady = artifactNonEmpty(phaseDir, 'repo-exploration.md')

  const nextRole = explorationReady ? 'implementer' : 'code-explorer'
  const dispatched = await ctx.specdev.dispatchRole(invocation.agent, {
    role: nextRole,
    slug: active.slug,
    phaseId,
  })

  return {
    kind: 'success',
    text: [
      `SpecDev /implement for \`${active.slug}\` phase=\`${phaseId}\`.`,
      `Branch: ${branchInfo.branch} (created=${String(branchInfo.created)} stayed=${String(branchInfo.stayed)}).`,
      `Dispatched \`${nextRole}\` (preset \`${dispatched.presetId}\`) childSession=${dispatched.childSessionId}`
        + ` followup=${String(dispatched.followupSent)} mounted=${String(dispatched.mounted)}.`,
      explorationReady
        ? 'repo-exploration.md present — started at implementer.'
        : 'Started at code-explorer → then implementer (gate requires impl-<phase> branch).',
      'After implementer, dispatch reviewer-correctness|design|connectivity in parallel (plus reviewer-visual in a UI phase), then ctx.specdev.mergePhaseReviews.',
      'On review PASS/SHOULD-FIX → verifier; MUST-FIX → re-dispatch implementer (loop_count+1, max 2).',
      'Stop at HG-3: the panel applies confirmGate(hg3), then ctx.specdev.completePhaseGit({ phaseId, files }) with an explicit file list (never git add -A).',
    ].join('\n'),
  }
}

/**
 * `/wiki` — shared wiki dispatch contract (Q-3 / STUB-002 closed).
 * Standalone mode → workspace `docs/wiki/`; same helper as final HG-3 auto path.
 */
async function runWiki(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const cwd = workspaceCwd(invocation)
  const active = ctx.specdev.active({ cwd })
  if (active === null) {
    return {
      kind: 'error',
      text: 'No active SpecDev workflow. Start with /feature (or sibling) first, then /wiki.',
    }
  }

  attachOrchestratorMetadata(invocation.agent, active.slug)
  const note = invocation.rawInput.trim()
  const status = ctx.specdev.readStatus(active.slug, { cwd })
  const phaseId = status.current_phase ?? undefined

  const dispatched = await ctx.specdev.dispatchWiki(invocation.agent, {
    slug: active.slug,
    mode: 'standalone',
    ...phaseId === undefined ? {} : { phaseId },
  })

  return {
    kind: 'success',
    text: [
      `SpecDev /wiki (Standalone) for \`${active.slug}\`.`,
      `Wiki root: ${dispatched.wikiRoot}`,
      `Dispatched \`wiki\` (preset \`${dispatched.presetId}\`) childSession=${dispatched.childSessionId}`
        + ` followup=${String(dispatched.followupSent)} mounted=${String(dispatched.mounted)}.`,
      'Same wiki-agent contract as final Feature HG-3 auto-dispatch (Q-3).',
      'No Knowledge Base / Knownbase sync (AC-55).',
      note.length > 0 ? `Note: ${note}` : undefined,
    ].filter((line): line is string => line !== undefined).join('\n'),
  }
}

/** `/status` — human report aligned with snapshot(). */
function runStatus(ctx: Context, invocation: CommandInvocation): CommandResult {
  const cwd = workspaceCwd(invocation)
  const snap = ctx.specdev.snapshot(invocation.agent.session, { cwd })
  if (snap === null) {
    return { kind: 'error', text: 'No active SpecDev workflow (.specdev/active-workflow missing).' }
  }
  return { kind: 'success', text: formatStatusReport(snap) }
}

/**
 * Register the SpecDev slash commands on the host command registry.
 *
 * Runs only while `commands` is available: compositions without a command
 * registry keep the runtime without the command surface.
 *
 * @param ctx - host context that owns the SpecDev service.
 */
export function installSpecdevCommands(ctx: Context): void {
  ctx.inject(['commands'], (commandCtx) => {
    const active = new Set<Promise<CommandResult>>()

    const wrap = (
      run: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>,
    ): ((invocation: CommandInvocation) => Promise<CommandResult>) => {
      return (invocation: CommandInvocation): Promise<CommandResult> => {
        const operation = Promise.resolve(run(invocation))
        active.add(operation)
        const retire = (): void => { active.delete(operation) }
        void operation.then(retire, retire)
        return operation
      }
    }

    commandCtx.effect(function* () {
      yield async () => { await Promise.allSettled(active) }

      for (const command of WORKFLOW_START) {
        yield commandCtx.commands.register({
          name: command,
          description: `SpecDev /${command}: ${COMMAND_MODE[command]}`,
          input: { hint: '<description>' },
          handler: wrap(invocation => runWorkflowStart(commandCtx, invocation, command)),
        })
      }

      yield commandCtx.commands.register({
        name: 'spec',
        description: `SpecDev /spec: ${COMMAND_MODE.spec}`,
        input: { hint: '[description]' },
        handler: wrap(invocation => runSpec(commandCtx, invocation)),
      })

      yield commandCtx.commands.register({
        name: 'implement',
        description: `SpecDev /implement: ${COMMAND_MODE.implement}`,
        handler: wrap(invocation => runImplement(commandCtx, invocation)),
      })

      yield commandCtx.commands.register({
        name: 'status',
        description: `SpecDev /status: ${COMMAND_MODE.status}`,
        handler: wrap(invocation => runStatus(commandCtx, invocation)),
      })

      yield commandCtx.commands.register({
        name: 'wiki',
        description: `SpecDev /wiki: ${COMMAND_MODE.wiki}`,
        handler: wrap(invocation => runWiki(commandCtx, invocation)),
      })
    }, 'specdev commands lifecycle')
  })
}
