/**
 * Parse SpecDev \`phase-plan.md\` DAG JSON and pick the first ready phase id.
 *
 * @module @deepseek-ai/dsh-specdev/phase-plan
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SpecdevError } from './status.ts'

/** One phase node in the DAG embedded in \`phase-plan.md\`. */
export interface PhasePlanNode {
  readonly id: string
  readonly dependencies: readonly string[]
}

/** Parsed DAG table from \`phase-plan.md\`. */
export interface PhasePlanDag {
  readonly phases: readonly PhasePlanNode[]
}

/**
 * Extract the first fenced \`\`\`json block that contains a \`phases\` array.
 * @param markdown - phase-plan.md contents.
 */
export function extractPhasePlanDagJson(markdown: string): unknown {
  const fence = /```json\s*([\s\S]*?)```/i.exec(markdown)
  if (fence === null || fence[1] === undefined) {
    throw new SpecdevError('phase-plan.md has no ```json fence', 'SPECDEV_PHASE_PLAN_INVALID')
  }
  try {
    return JSON.parse(fence[1]) as unknown
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new SpecdevError(`phase-plan.md JSON is invalid: ${detail}`, 'SPECDEV_PHASE_PLAN_INVALID')
  }
}

/**
 * Validate and normalize a DAG document.
 * @param raw - JSON-parsed unknown value.
 */
export function parsePhasePlanDag(raw: unknown): PhasePlanDag {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SpecdevError('phase-plan DAG must be a JSON object', 'SPECDEV_PHASE_PLAN_INVALID')
  }
  const phasesRaw = (raw as { phases?: unknown }).phases
  if (!Array.isArray(phasesRaw) || phasesRaw.length === 0) {
    throw new SpecdevError('phase-plan DAG phases must be a non-empty array', 'SPECDEV_PHASE_PLAN_INVALID')
  }
  const phases: PhasePlanNode[] = []
  for (const [index, entry] of phasesRaw.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SpecdevError(`phase-plan phases[${String(index)}] must be an object`, 'SPECDEV_PHASE_PLAN_INVALID')
    }
    const id = (entry as { id?: unknown }).id
    const dependencies = (entry as { dependencies?: unknown }).dependencies
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new SpecdevError(`phase-plan phases[${String(index)}].id must be a non-empty string`, 'SPECDEV_PHASE_PLAN_INVALID')
    }
    if (!Array.isArray(dependencies) || dependencies.some(dep => typeof dep !== 'string')) {
      throw new SpecdevError(
        `phase-plan phases[${String(index)}].dependencies must be a string array`,
        'SPECDEV_PHASE_PLAN_INVALID',
      )
    }
    phases.push({ id: id.trim(), dependencies: dependencies.map(dep => dep.trim()) })
  }
  return { phases }
}

/**
 * First phase whose every dependency id appears earlier in the plan as a
 * completed dependency set — for HG-2 bootstrap, "ready" means \`dependencies\`
 * is empty (no prior phases required).
 * @param dag - parsed DAG.
 */
export function firstReadyPhaseId(dag: PhasePlanDag): string | null {
  for (const phase of dag.phases) {
    if (phase.dependencies.length === 0) return phase.id
  }
  return dag.phases[0]?.id ?? null
}

/**
 * Read and parse \`phase-plan.md\` under a slug directory.
 * @param slugDir - \`.specdev/specs/<slug>\`.
 */
export function readPhasePlanDag(slugDir: string): PhasePlanDag {
  const path = join(slugDir, 'phase-plan.md')
  if (!existsSync(path)) {
    throw new SpecdevError('phase-plan.md is missing', 'SPECDEV_PHASE_PLAN_MISSING')
  }
  const markdown = readFileSync(path, 'utf8')
  return parsePhasePlanDag(extractPhasePlanDagJson(markdown))
}

/**
 * Whether a markdown artifact exists and has non-whitespace content.
 * @param slugDir - slug directory.
 * @param fileName - file under the slug directory.
 */
export function artifactNonEmpty(slugDir: string, fileName: string): boolean {
  const path = join(slugDir, fileName)
  if (!existsSync(path)) return false
  return readFileSync(path, 'utf8').trim().length > 0
}
