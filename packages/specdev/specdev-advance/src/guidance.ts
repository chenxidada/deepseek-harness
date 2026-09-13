/**
 * Next-step guidance text for SpecDev role completion (pipeline-advance intent).
 * Never auto-passes Human Gates.
 *
 * @module @deepseek-ai/dsh-specdev-advance/guidance
 */

import type { SpecdevRole } from '@deepseek-ai/dsh-specdev'

/**
 * Build Orchestrator-facing nextAction guidance for a completed role.
 * @param role - SpecDev role that just went idle / ended.
 */
export function guidanceForRole(role: SpecdevRole): string {
  switch (role) {
    case 'requirement-analyst':
      return [
        '📋 requirement-analyst completed → requirements.md',
        '⏸️ Human Gate 1 — present requirements to the user.',
        'Wait for an explicit confirm, then call ctx.specdev.confirmGate({ gate: "hg1", decision: "pass" }).',
        'Do not auto-continue. Do not flip human_gates in JSON by hand.',
      ].join('\n')

    case 'plan-generator':
      return [
        '🏗️ plan-generator completed → design.md + phase-plan.md',
        '⏸️ Human Gate 2 — present the design to the user.',
        'Wait for an explicit confirm, then call ctx.specdev.confirmGate({ gate: "hg2", decision: "pass" }).',
        'Do not auto-continue. Do not flip human_gates in JSON by hand.',
      ].join('\n')

    case 'implementer':
      return [
        '💻 implementer completed → phases/<phase>/implementation.md',
        'Next: dispatch reviewer-correctness, reviewer-design, and reviewer-connectivity in parallel,',
        'then call ctx.specdev.mergePhaseReviews(session, phaseId) to write review.md.',
        'On MUST-FIX, call ctx.specdev.bumpLoopCount() then re-dispatch implementer (max 2).',
      ].join('\n')

    case 'reviewer-correctness':
      return '🔍 reviewer-correctness (1/3) completed. Wait for reviewer-design + reviewer-connectivity, then ctx.specdev.mergePhaseReviews.'

    case 'reviewer-design':
      return '🔍 reviewer-design completed. Check whether all three review reports are ready, then ctx.specdev.mergePhaseReviews.'

    case 'reviewer-connectivity':
      return '🔍 reviewer-connectivity completed. Check whether all three review reports are ready, then ctx.specdev.mergePhaseReviews.'

    case 'reviewer':
      return [
        '🔍 reviewer completed → review.md',
        'PASS / SHOULD-FIX → dispatch verifier. MUST-FIX → ctx.specdev.bumpLoopCount() then dispatch implementer.',
      ].join('\n')

    case 'verifier':
      return [
        '✅ verifier completed → verification.md',
        '⏸️ Human Gate 3 — present verification to the user.',
        'Record the completed phaseId NOW (confirmGate will advance current_phase).',
        'Wait for an explicit Phase pass, then confirmGate({ gate: "hg3", decision: "pass" }).',
        'After confirmGate, call ctx.specdev.completePhaseGit({ phaseId: <recorded>, files }) with an explicit file list.',
        'If this was the final Feature phase (snapshot.phase === null / no remaining dependent phase):',
        '  AC-20 expects wiki auto-dispatch via /confirm-gate or ctx.specdev.dispatchWiki({ mode: "pipeline" }) → docs/wiki/.',
        'Do not auto-merge git or flip hg3 in JSON by hand. No Knowledge Base sync.',
      ].join('\n')

    case 'code-explorer':
      return '🔎 code-explorer completed → repo-exploration.md. Next: ensure impl-<phase> branch, then dispatch implementer.'

    case 'wiki':
      return [
        '📚 wiki agent completed. Review docs/wiki/ updates and changelog.',
        'No Knowledge Base / Knownbase sync (AC-55).',
      ].join('\n')

    case 'orchestrator':
      return 'Orchestrator idle — no SpecDev advance action.'

    default:
      return `SpecDev role ${String(role)} completed. Review outputs; do not auto-pass Human Gates.`
  }
}
