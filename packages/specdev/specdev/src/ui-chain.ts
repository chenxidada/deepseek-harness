/**
 * SpecDev visual chain: which phases declare UI work, whether the workflow has
 * any, and whether a phase's implementation carries the static prototype the
 * user must confirm before reviewers run.
 *
 * Every answer comes from `phase-plan.md`, so the plan stays the one place a
 * phase's UI nature is declared.
 *
 * @module @deepseek-ai/dsh-specdev/ui-chain
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPhasePlanDag, type PhasePlanDag } from './phase-plan.ts'
import { SpecdevError } from './status.ts'

/** Heading the implementer writes when it stops on a static prototype. */
export const PROTOTYPE_HEADING = '## Prototype'

/** One phase's UI declaration as the runtime reads it. */
export type PhaseUiDeclaration = boolean | 'unknown'

/**
 * Read the workflow's phase plan.
 *
 * A plan that does not exist yet is an empty DAG: the workflow simply has no
 * phases. A plan that exists but cannot be read or parsed is `unknown`, which
 * every caller treats as fail-closed rather than as "no UI".
 *
 * @param slugDir - `.specdev/specs/<slug>`.
 * @returns the parsed DAG, the empty DAG, or `'unknown'`.
 */
function readDag(slugDir: string): PhasePlanDag | 'unknown' {
  try {
    return readPhasePlanDag(slugDir)
  } catch (error: unknown) {
    if (error instanceof SpecdevError && error.code === 'SPECDEV_PHASE_PLAN_MISSING') {
      return { phases: [] }
    }
    return 'unknown'
  }
}

/**
 * Per-phase UI declarations of a workflow.
 * @param slugDir - `.specdev/specs/<slug>`.
 * @returns each phase's declaration; a phase whose plan is unreadable reads `'unknown'`.
 */
export function phaseUiDeclarations(slugDir: string): Readonly<Record<string, PhaseUiDeclaration>> {
  const dag = readDag(slugDir)
  if (dag === 'unknown') return {}
  const declarations: Record<string, PhaseUiDeclaration> = {}
  for (const phase of dag.phases) declarations[phase.id] = phase.ui ?? 'unknown'
  return declarations
}

/**
 * Whether a workflow includes UI work, which turns on the visual chain
 * (HG-1.5, the prototype gate, and the visual reviewer).
 * @param slugDir - `.specdev/specs/<slug>`.
 * @returns true, false, or `'unknown'` when the plan exists but cannot be read.
 */
export function uiWorkflowOf(slugDir: string): boolean | 'unknown' {
  const dag = readDag(slugDir)
  if (dag === 'unknown') return 'unknown'
  return dag.phases.some(phase => phase.ui === true)
}

/**
 * Whether the phase's implementation carries the prototype section the user
 * confirms before reviewers run.
 * @param phaseDir - `phases/<phaseId>` under the slug directory.
 */
export function hasPrototypeSection(phaseDir: string): boolean {
  const path = join(phaseDir, 'implementation.md')
  if (!existsSync(path)) return false
  return readFileSync(path, 'utf8').includes(PROTOTYPE_HEADING)
}

/**
 * The directory of one DAG phase.
 * @param slugDir - `.specdev/specs/<slug>`.
 * @param phaseId - DAG phase id.
 */
export function phaseDirOf(slugDir: string, phaseId: string): string {
  return join(slugDir, 'phases', phaseId)
}
