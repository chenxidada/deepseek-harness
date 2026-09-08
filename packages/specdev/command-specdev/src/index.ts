/**
 * SpecDev slash-command surface over \`ctx.specdev\`.
 * @module @deepseek-ai/dsh-command-specdev
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import {
  artifactNonEmpty,
  attachOrchestratorMetadata,
  firstReadyPhaseId,
  interpretGateReply,
  isDagPhaseId,
  readPhasePlanDag,
  requiresPhaseEntryGate,
  type SpecdevGateId,
  type SpecdevRole,
  type SpecdevSnapshot,
} from '@deepseek-ai/dsh-specdev'
import type {} from '@deepseek-ai/dsh-specdev'

export const name = 'command-specdev'
export const inject = ['commands', 'specdev']

/** Workflow-start command names that create/update a SpecDev layout. */
const WORKFLOW_START = new Set([
  'feature',
  'bugfix',
  'brief',
  'research',
  'specify',
])

/** Human-readable pipeline mode for each start command. */
const COMMAND_MODE: Readonly<Record<string, string>> = {
  feature: 'multi-phase Feature → requirement-analyst → HG-1',
  bugfix: 'condensed single-phase bugfix → design/HG path',
  brief: 'lightweight single-phase; single reviewer (not three-perspective)',
  research: 'exploration only — no implementer/reviewer/verifier',
  specify: 'requirements only; stop at HG-1',
  plan: 'architecture + phase-plan; stop at HG-2',
  implement: 'current-phase implement→review→verify loop',
  wiki: 'wiki agent dispatch',
  status: 'status report',
  'confirm-gate': 'Human Gate confirmation via confirmGate',
}

/**
 * Slugify a free-text description into a filesystem-safe workflow id.
 * @param input - command raw input / description.
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
 * Format a \`snapshot()\` view as a human-readable \`/status\` report.
 * @param snap - SpecDev snapshot.
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
      `  ${phaseId}: implementer=${triple.implementer} reviewer=${triple.reviewer} verifier=${triple.verifier}`
    ))
  return [
    `SpecDev status (schema v${String(snap.schemaVersion)})`,
    `slug: ${snap.slug}`,
    `stage: ${snap.stage}`,
    `phase: ${snap.phase ?? '(none)'}`,
    `pipelineMode: ${snap.pipelineMode ?? '(none)'}`,
    `initiatingCommand: ${snap.initiatingCommand ?? '(none)'}`,
    `gates: hg1=${snap.gates.hg1} hg2=${snap.gates.hg2} hg3=${snap.gates.hg3}`,
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
  command: string,
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
  const mode = COMMAND_MODE[command] ?? command
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
      'Stage: requirement-analysis; pendingGate: hg1.',
      `Dispatched \`${nextRole}\` (preset \`${dispatched.presetId}\`) childSession=${dispatched.childSessionId}`
        + ` mounted=${String(dispatched.mounted)} factory=${String(dispatched.factoryCreated)}.`,
      `Orchestrator metadata attached (specdev.role=orchestrator, slug=${active.slug}).`,
      'Emitted specdev/dispatch for bridge lineage (AC-24).',
      command === 'research'
        ? 'Research stops after exploration — do not dispatch implementer/reviewer/verifier.'
        : command === 'specify'
          ? 'Specify stops at HG-1 after requirements are written.'
          : 'Stop at HG-1 after requirements; only confirmGate may pass the gate.',
    ].join('\n'),
  }
}

/** `/plan` — requires HG-1 passed + non-empty requirements.md; dispatches plan-generator. */
async function runPlan(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const cwd = workspaceCwd(invocation)
  const active = ctx.specdev.active({ cwd })
  if (active === null) {
    return { kind: 'error', text: 'No active SpecDev workflow. Start with /feature (or sibling) first.' }
  }
  const status = ctx.specdev.readStatus(active.slug, { cwd })
  if (status.human_gates.hg1 !== 'passed') {
    return {
      kind: 'error',
      text: 'Refused: /plan requires HG-1 to be passed (AC-16). Confirm requirements via confirmGate first.',
    }
  }
  const slugDir = join(active.layoutRoot, 'specs', active.slug)
  if (!artifactNonEmpty(slugDir, 'requirements.md')) {
    return {
      kind: 'error',
      text: 'Refused: /plan requires non-empty requirements.md (AC-16).',
    }
  }

  attachOrchestratorMetadata(invocation.agent, active.slug)
  const dispatched = await ctx.specdev.dispatchRole(invocation.agent, {
    role: 'plan-generator',
    slug: active.slug,
  })

  const note = invocation.rawInput.trim()
  return {
    kind: 'success',
    text: [
      `SpecDev /plan for \`${active.slug}\`.`,
      'Mode: architecture + phase-plan; stop at HG-2.',
      `Dispatched \`plan-generator\` (preset \`${dispatched.presetId}\`) childSession=${dispatched.childSessionId}`
        + ` mounted=${String(dispatched.mounted)} factory=${String(dispatched.factoryCreated)}.`,
      'Emitted specdev/dispatch for bridge lineage (AC-24).',
      'After design.md + phase-plan.md exist, stop for HG-2; only confirmGate may pass.',
      note.length > 0 ? `Note: ${note}` : undefined,
    ].filter((line): line is string => line !== undefined).join('\n'),
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
      text: 'Refused: /implement requires HG-2 passed and a current_phase. Complete /plan + confirmGate(hg2) first.',
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
          'Call confirmGate({ gate:\'phase-entry\', decision:\'resolve\'|\'defer\'|\'cancel\', phaseEntry:[…] }) then re-run /implement.',
        ].join('\n'),
      }
    }
  }

  attachOrchestratorMetadata(invocation.agent, active.slug)

  let branchInfo: { branch: string; created: boolean; stayed: boolean }
  try {
    branchInfo = ctx.specdev.ensurePhaseBranch(phaseId, { cwd })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      kind: 'error',
      text: `ensurePhaseBranch failed: ${message}. Create a git repo under the workspace root (fixture project) and retry.`,
    }
  }

  const phaseDir = join(slugDir, 'phases', phaseId)
  const explorationReady = artifactNonEmpty(phaseDir, 'repo-exploration.md')
  const pipelineMode = status.pipeline_mode ?? status.initiating_command ?? 'feature'
  const brief = pipelineMode === 'brief'

  const nextRole = explorationReady ? 'implementer' : 'code-explorer'
  const dispatched = await ctx.specdev.dispatchRole(invocation.agent, {
    role: nextRole,
    slug: active.slug,
    phaseId,
  })

  const reviewHint = brief
    ? 'Brief mode: after implementer, dispatch single `reviewer` (not three-perspective).'
    : 'Feature mode: after implementer, dispatch reviewer-correctness|design|connectivity in parallel, then ctx.specdev.mergePhaseReviews.'

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
      reviewHint,
      'On review PASS/SHOULD-FIX → verifier; MUST-FIX → re-dispatch implementer (loop_count+1, max 2).',
      'Stop at HG-3: confirmGate(hg3) then ctx.specdev.completePhaseGit({ phaseId, files }) with an explicit file list (never git add -A).',
    ].join('\n'),
  }
}

/**
 * `/wiki` — registered; body deferred to Phase 5.
 * @STUB(phase-5-wiki-hardening)
 */
async function runWiki(_ctx: Context, _invocation: CommandInvocation): Promise<CommandResult> {
  // @STUB(phase-5-wiki-hardening) — wiki agent dispatch + docs/wiki generation lands in Phase 5.
  return {
    kind: 'error',
    text: [
      'SpecDev /wiki is registered but wiki dispatch is not implemented yet.',
      '@STUB(phase-5-wiki-hardening)',
      'See tech-debt-registry STUB-002.',
    ].join('\n'),
  }
}

/** `/status` — human report aligned with snapshot(). */
async function runStatus(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const cwd = workspaceCwd(invocation)
  const snap = ctx.specdev.snapshot(invocation.agent.session, { cwd })
  if (snap === null) {
    return { kind: 'error', text: 'No active SpecDev workflow (.specdev/active-workflow missing).' }
  }
  return { kind: 'success', text: formatStatusReport(snap) }
}

/** Optional `/confirm-gate` — shares confirmGate semantics only (AC-19). */
async function runConfirmGate(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const parts = invocation.rawInput.trim().split(/\s+/).filter(part => part.length > 0)
  if (parts.length < 2) {
    return {
      kind: 'error',
      text: 'Usage: /confirm-gate <hg1|hg2|hg3|phase-entry> <pass|reject|defer|确认|通过|推迟|…> [note…]',
    }
  }
  const gateRaw = parts[0]
  if (gateRaw !== 'hg1' && gateRaw !== 'hg2' && gateRaw !== 'hg3' && gateRaw !== 'phase-entry') {
    return { kind: 'error', text: `Unknown gate "${gateRaw}". Expected hg1|hg2|hg3|phase-entry.` }
  }
  const gate: SpecdevGateId = gateRaw

  if (gate === 'phase-entry') {
    return runPhaseEntryConfirmGate(ctx, invocation, parts.slice(1))
  }

  const decisionRaw = parts.slice(1).join(' ')
  const interpreted = interpretGateReply(decisionRaw)
  if (interpreted === 'ambiguous') {
    return {
      kind: 'error',
      text: [
        'Ambiguous confirmation — gate not passed (AC-26).',
        'Use explicit keywords: pass / 确认 / 通过 (or reject / 拒绝 / 不通过, or defer / 推迟).',
        `Received: ${JSON.stringify(decisionRaw)}`,
      ].join('\n'),
    }
  }
  const decision = interpreted
  const result = await ctx.specdev.confirmGate(
    invocation.agent.session,
    { gate, decision, note: decisionRaw },
    { cwd: workspaceCwd(invocation) },
  )
  if (!result.ok) {
    return {
      kind: 'error',
      text: `confirmGate failed (${result.code ?? 'unknown'}): ${result.message ?? 'no message'}`,
    }
  }
  const snap = result.snapshot
  return {
    kind: 'success',
    text: snap === undefined
      ? `Gate ${gate} decision=${decision} recorded.`
      : `Gate ${gate} decision=${decision}. pendingGate=${snap.pendingGate ?? '(none)'} stage=${snap.stage} phase=${snap.phase ?? '(none)'}`,
  }
}

/**
 * Phase Entry Gate slash form (AC-33):
 * `/confirm-gate phase-entry <resolve|defer|cancel|pass|推迟> [ID[,ID…]] [to <laterPhaseId>]`
 */
async function runPhaseEntryConfirmGate(
  ctx: Context,
  invocation: CommandInvocation,
  tokens: readonly string[],
): Promise<CommandResult> {
  if (tokens.length === 0) {
    return {
      kind: 'error',
      text: 'Usage: /confirm-gate phase-entry <resolve|defer|cancel|pass|推迟> [STUB-A,STUB-B] [to <laterPhaseId>]',
    }
  }
  const decisionToken = tokens[0]
  if (decisionToken === undefined) {
    return {
      kind: 'error',
      text: 'Usage: /confirm-gate phase-entry <resolve|defer|cancel|pass|推迟> [STUB-A,STUB-B] [to <laterPhaseId>]',
    }
  }
  let decision: 'resolve' | 'defer' | 'cancel' | 'pass'
  if (decisionToken === 'resolve' || decisionToken === 'cancel' || decisionToken === 'pass') {
    decision = decisionToken
  } else if (decisionToken === 'defer' || decisionToken === '推迟') {
    decision = 'defer'
  } else {
    const interpreted = interpretGateReply(decisionToken)
    if (interpreted === 'defer') decision = 'defer'
    else if (interpreted === 'pass') decision = 'pass'
    else if (interpreted === 'reject') decision = 'cancel'
    else {
      return {
        kind: 'error',
        text: [
          'Ambiguous phase-entry decision (AC-26).',
          'Use resolve | defer | cancel | pass | 推迟.',
          `Received: ${JSON.stringify(decisionToken)}`,
        ].join('\n'),
      }
    }
  }

  let deferredTargetPhase: string | undefined
  const idTokens: string[] = []
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === undefined) continue
    if (token === 'to') {
      const target = tokens[i + 1]
      if (target === undefined || target.trim().length === 0) {
        return { kind: 'error', text: 'phase-entry defer "to" requires a later phase id' }
      }
      deferredTargetPhase = target.trim()
      break
    }
    idTokens.push(token)
  }
  const itemIds = idTokens
    .flatMap(part => part.split(','))
    .map(id => id.trim())
    .filter(id => id.length > 0)

  const phaseEntry = itemIds.length === 0
    ? undefined
    : [{
      itemIds,
      disposition: decision === 'pass' ? 'resolve' as const : decision,
      ...deferredTargetPhase === undefined ? {} : { deferredTargetPhase },
    }]

  const result = await ctx.specdev.confirmGate(
    invocation.agent.session,
    {
      gate: 'phase-entry',
      decision,
      note: tokens.join(' '),
      ...phaseEntry === undefined ? {} : { phaseEntry },
      ...deferredTargetPhase === undefined || phaseEntry !== undefined
        ? {}
        : { deferredTargetPhase },
    },
    { cwd: workspaceCwd(invocation) },
  )
  if (!result.ok) {
    return {
      kind: 'error',
      text: `confirmGate failed (${result.code ?? 'unknown'}): ${result.message ?? 'no message'}`,
    }
  }
  const snap = result.snapshot
  const idsNote = itemIds.length > 0 ? ` items=${itemIds.join(',')}` : ''
  const targetNote = deferredTargetPhase === undefined ? '' : ` deferredTarget=${deferredTargetPhase}`
  return {
    kind: 'success',
    text: snap === undefined
      ? `Gate phase-entry decision=${decision}${idsNote}${targetNote} recorded.`
      : `Gate phase-entry decision=${decision}${idsNote}${targetNote}. pendingGate=${snap.pendingGate ?? '(none)'} stage=${snap.stage} phase=${snap.phase ?? '(none)'}`,
  }
}

/**
 * Register SpecDev slash commands on the host command registry.
 * @param ctx - context with commands + specdev.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()

  const wrap = (
    run: (invocation: CommandInvocation) => Promise<CommandResult>,
  ): ((invocation: CommandInvocation) => Promise<CommandResult>) => {
    return (invocation: CommandInvocation): Promise<CommandResult> => {
      const operation = run(invocation)
      active.add(operation)
      const retire = (): void => { active.delete(operation) }
      void operation.then(retire, retire)
      return operation
    }
  }

  ctx.effect(function* () {
    yield async () => { await Promise.allSettled(active) }

    for (const command of WORKFLOW_START) {
      yield ctx.commands.register({
        name: command,
        description: `SpecDev /${command}: ${COMMAND_MODE[command] ?? command}`,
        input: { hint: '<description>' },
        handler: wrap(invocation => runWorkflowStart(ctx, invocation, command)),
      })
    }

    yield ctx.commands.register({
      name: 'plan',
      description: `SpecDev /plan: ${COMMAND_MODE.plan}`,
      input: { hint: '[note]' },
      handler: wrap(invocation => runPlan(ctx, invocation)),
    })

    yield ctx.commands.register({
      name: 'implement',
      description: `SpecDev /implement: ${COMMAND_MODE.implement}`,
      handler: wrap(invocation => runImplement(ctx, invocation)),
    })

    yield ctx.commands.register({
      name: 'status',
      description: `SpecDev /status: ${COMMAND_MODE.status}`,
      handler: wrap(invocation => runStatus(ctx, invocation)),
    })

    yield ctx.commands.register({
      name: 'wiki',
      description: `SpecDev /wiki: ${COMMAND_MODE.wiki}`,
      handler: wrap(invocation => runWiki(ctx, invocation)),
    })

    yield ctx.commands.register({
      name: 'confirm-gate',
      description: `SpecDev /confirm-gate: ${COMMAND_MODE['confirm-gate']}`,
      input: { hint: '<hg1|hg2|hg3> <pass|确认|通过|reject|defer|推迟|…>' },
      handler: wrap(invocation => runConfirmGate(ctx, invocation)),
    })
  }, 'command-specdev lifecycle')
}

/** Read a small fixture helper for tests (tech-debt path existence). */
export function techDebtRegistryExists(layoutRoot: string, slug: string): boolean {
  return existsSync(join(layoutRoot, 'specs', slug, 'tech-debt-registry.md'))
}

/** Expose constitution presence for layout assertions. */
export function constitutionExists(layoutRoot: string): boolean {
  try {
    return readFileSync(join(layoutRoot, 'constitution.md'), 'utf8').trim().length > 0
  } catch {
    return false
  }
}
