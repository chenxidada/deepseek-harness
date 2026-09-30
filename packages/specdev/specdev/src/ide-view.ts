/**
 * IDE-facing views of a SpecDev snapshot: the phase-plan rows a progress list
 * renders and the artifact rows a file list renders.
 *
 * Both are derived from the workspace the snapshot already resolved, so an
 * artifact row is `ready` exactly when the workflow wrote that file.
 *
 * @module @deepseek-ai/dsh-specdev/ide-view
 */

import { posix } from 'node:path'
import { artifactNonEmpty, type PhasePlanDag } from './phase-plan.ts'
import { phaseDirOf } from './ui-chain.ts'
import type {
  CurrentStatusJson,
  SpecdevArtifactRow,
  SpecdevPlanRow,
  SpecdevUiView,
} from './types.ts'

/** Workflow-level artifacts, in the order the workflow writes them. */
const WORKFLOW_ARTIFACTS = ['requirements.md', 'design.md', 'phase-plan.md'] as const

/** Visual baseline, listed only in a workflow whose plan declares a UI phase. */
const VISUAL_BASELINE_ARTIFACT = 'visual-baseline.md'

/** Review reports a phase writes before its merge. */
const PHASE_ARTIFACTS_BEFORE_MERGE = [
  'repo-exploration.md',
  'implementation.md',
  'review-correctness.md',
  'review-design.md',
  'review-connectivity.md',
] as const

/** Fourth reviewer report, written by a phase whose plan declares `ui: true`. */
const VISUAL_REVIEW_ARTIFACT = 'review-visual.md'

/** Artifacts a phase writes at and after its merged review. */
const PHASE_ARTIFACTS_AFTER_MERGE = ['review.md', 'verification.md'] as const

/**
 * Ordered phase-plan rows for IDE progress rendering.
 * @param status - durable status the rows measure progress against.
 * @param dag - parsed `phase-plan.md` DAG.
 * @returns one row per plan phase with its dependencies and its progress.
 */
export function planRowsOf(
  status: CurrentStatusJson,
  dag: PhasePlanDag,
): readonly SpecdevPlanRow[] {
  return dag.phases.map(phase => ({
    id: phase.id,
    dependencies: phase.dependencies,
    status: planRowStatus(status, phase.id),
  }))
}

/**
 * Workflow artifacts with workspace-relative paths for IDE listing: the
 * workflow-level documents first, then every phase's artifacts in plan order —
 * or in durable-status order when the plan does not parse.
 * @param slugDir - `.specdev/specs/<slug>`.
 * @param slug - workflow slug the returned paths are relative to.
 * @param status - durable status, read for its phase ids when the plan does not parse.
 * @param ui - visual chain declarations of the same snapshot.
 * @param dag - parsed `phase-plan.md` DAG, or undefined when it does not parse.
 * @returns one row per artifact, each `ready` or `missing`.
 */
export function artifactRowsOf(
  slugDir: string,
  slug: string,
  status: CurrentStatusJson,
  ui: SpecdevUiView,
  dag: PhasePlanDag | undefined,
): readonly SpecdevArtifactRow[] {
  const rows: SpecdevArtifactRow[] = []
  const workflowNames = ui.workflow
    ? [...WORKFLOW_ARTIFACTS, VISUAL_BASELINE_ARTIFACT]
    : WORKFLOW_ARTIFACTS
  for (const fileName of workflowNames) {
    rows.push(artifactRow(slugDir, slugArtifactPath(slug, fileName), fileName, null))
  }
  for (const phaseId of planPhaseIds(dag, status)) {
    for (const fileName of phaseArtifactNames(ui.phases[phaseId] === true)) {
      rows.push(artifactRow(
        phaseDirOf(slugDir, phaseId),
        phaseArtifactPath(slug, phaseId, fileName),
        fileName,
        phaseId,
      ))
    }
  }
  return rows
}

/**
 * Progress of one plan phase: `done` once every step completed, `active` for
 * the durable current phase, `todo` otherwise.
 * @param status - durable status.
 * @param phaseId - DAG phase id.
 */
function planRowStatus(status: CurrentStatusJson, phaseId: string): SpecdevPlanRow['status'] {
  const steps = status.phases[phaseId]
  if (steps !== undefined
    && steps.implementer === 'completed'
    && steps.reviewer === 'completed'
    && steps.verifier === 'completed') {
    return 'done'
  }
  return status.current_phase === phaseId ? 'active' : 'todo'
}

/**
 * The artifacts of one phase, in the order the phase writes them.
 * @param visualPhase - whether the plan declares `ui: true` for the phase.
 */
function phaseArtifactNames(visualPhase: boolean): readonly string[] {
  return [
    ...PHASE_ARTIFACTS_BEFORE_MERGE,
    ...visualPhase ? [VISUAL_REVIEW_ARTIFACT] : [],
    ...PHASE_ARTIFACTS_AFTER_MERGE,
  ]
}

/**
 * Phase ids the artifact listing walks: the plan's order, or the durable
 * status's own key order when the plan does not parse.
 * @param dag - parsed phase plan, or undefined.
 * @param status - durable status.
 */
function planPhaseIds(
  dag: PhasePlanDag | undefined,
  status: CurrentStatusJson,
): readonly string[] {
  return dag === undefined
    ? Object.keys(status.phases)
    : dag.phases.map(phase => phase.id)
}

/**
 * Workspace-relative POSIX path of one workflow-level artifact.
 * @param slug - workflow slug.
 * @param fileName - artifact file name.
 */
function slugArtifactPath(slug: string, fileName: string): string {
  return posix.join('.specdev', 'specs', slug, fileName)
}

/**
 * Workspace-relative POSIX path of one phase artifact.
 * @param slug - workflow slug.
 * @param phaseId - DAG phase id.
 * @param fileName - artifact file name.
 */
function phaseArtifactPath(slug: string, phaseId: string, fileName: string): string {
  return posix.join('.specdev', 'specs', slug, 'phases', phaseId, fileName)
}

/**
 * One artifact row, whose state is read from the file the workflow writes.
 * @param dir - directory the artifact lives in.
 * @param path - workspace-relative POSIX path the row reports.
 * @param fileName - artifact file name, which is also the row label.
 * @param phaseId - owning phase id, or null for a workflow-level artifact.
 */
function artifactRow(
  dir: string,
  path: string,
  fileName: string,
  phaseId: string | null,
): SpecdevArtifactRow {
  return {
    path,
    label: fileName,
    phaseId,
    status: artifactNonEmpty(dir, fileName) ? 'ready' : 'missing',
  }
}
