/**
 * Fail-closed SpecDev role dispatch / pre-step checks (pipeline-gate intent).
 *
 * @module @deepseek-ai/dsh-specdev-guard/check
 */

import type { SpecdevRole } from '@deepseek-ai/dsh-specdev'
import {
  SPECDEV_LOOP_MAX,
  type AuthoritativeSpecdevStatus,
} from './authority.ts'

/** Structured denial returned by gate checks (thrown / reject / tools deny). */
export interface SpecdevGateDenial {
  readonly code: string
  readonly reason: string
  /** When true, Orchestrator must escalate to the user (AC-38). */
  readonly escalate?: boolean
}

/** Options for role evaluation beyond authoritative status. */
export interface EvaluateRoleOptions {
  /** Current git branch (`null` = unavailable / fail-closed for implementer). */
  readonly gitBranch?: string | null
  /**
   * Whether the current phase is a UI phase. `'unknown'` — the phase plan does
   * not declare it — fails closed for the roles the visual chain holds back.
   */
  readonly uiPhase?: boolean | 'unknown'
  /** Whether the user confirmed the current phase's static prototype. */
  readonly prototypeConfirmed?: boolean
}

/** Roles that require `phase-implementation` stage (AC-36). */
const IMPLEMENTATION_ROLES: ReadonlySet<SpecdevRole> = new Set([
  'implementer',
  'reviewer',
  'reviewer-correctness',
  'reviewer-design',
  'reviewer-connectivity',
  'reviewer-visual',
  'verifier',
])

/** Roles a UI phase holds back until the user confirms the prototype. */
const PROTOTYPE_GATED_ROLES: ReadonlySet<SpecdevRole> = new Set([
  'reviewer',
  'reviewer-correctness',
  'reviewer-design',
  'reviewer-connectivity',
  'reviewer-visual',
  'verifier',
])

/**
 * Evaluate whether a SpecDev role may be dispatched / enter a step.
 * Returns a denial or `undefined` to allow.
 *
 * @param role - SpecDev role being dispatched or waking.
 * @param auth - authoritative status (projection / fail-closed).
 * @param options - git branch and related checks.
 */
export function evaluateRoleDispatch(
  role: SpecdevRole,
  auth: AuthoritativeSpecdevStatus,
  options: EvaluateRoleOptions = {},
): SpecdevGateDenial | undefined {
  if (auth.fileHgDiverged) {
    // Soft signal in reason; concrete role rules below still apply using auth gates.
  }

  if (IMPLEMENTATION_ROLES.has(role) && auth.stage !== 'phase-implementation') {
    return {
      code: 'SPECDEV_STAGE_MISMATCH',
      reason: `⛔ SpecDev gate: stage is \`${auth.stage}\`, cannot dispatch ${role}. Complete HG-1 and HG-2 first.`,
    }
  }

  const uiDenial = evaluateUiGate(role, auth, options)
  if (uiDenial !== undefined) return uiDenial

  switch (role) {
    case 'requirement-analyst':
    case 'code-explorer':
    case 'orchestrator':
    case 'wiki':
      return undefined

    case 'plan-generator':
      if (auth.gates.hg1 !== 'passed') {
        return {
          code: 'SPECDEV_HG1_PENDING',
          reason: '⛔ SpecDev gate: Human Gate 1 not passed. Confirm requirements before plan-generator.',
        }
      }
      return undefined

    case 'implementer':
      return evaluateImplementer(auth, options)

    case 'reviewer':
    case 'reviewer-correctness':
    case 'reviewer-design':
    case 'reviewer-connectivity':
      if (auth.gates.hg2 !== 'passed') {
        return {
          code: 'SPECDEV_HG2_PENDING',
          reason: `⛔ SpecDev gate: Human Gate 2 not passed. Cannot dispatch ${role}.`,
        }
      }
      if (auth.phase === null || auth.phase.length === 0) {
        return {
          code: 'SPECDEV_PHASE_MISSING',
          reason: '⛔ SpecDev gate: current_phase is empty. Finish HG-2 / phase plan first.',
        }
      }
      return undefined

    case 'verifier':
      if (auth.gates.hg2 !== 'passed') {
        return {
          code: 'SPECDEV_HG2_PENDING',
          reason: '⛔ SpecDev gate: Human Gate 2 not passed. Cannot dispatch verifier.',
        }
      }
      if (auth.phase === null || auth.phase.length === 0) {
        return {
          code: 'SPECDEV_PHASE_MISSING',
          reason: '⛔ SpecDev gate: current_phase is empty. Finish HG-2 / phase plan first.',
        }
      }
      return undefined

    default:
      return undefined
  }
}

/**
 * The visual chain rules for one dispatch: a UI phase holds its reviewers and
 * verifier back until the user confirms the prototype, and the visual reviewer
 * exists only for a UI phase. A phase whose plan does not declare `ui` is
 * refused rather than read as "no UI", because that reading would silently drop
 * every visual check.
 * @param role - role being dispatched or waking.
 * @param auth - authoritative status.
 * @param options - ui declaration and prototype confirmation of the current phase.
 */
function evaluateUiGate(
  role: SpecdevRole,
  auth: AuthoritativeSpecdevStatus,
  options: EvaluateRoleOptions,
): SpecdevGateDenial | undefined {
  const phase = auth.phase ?? '(none)'
  if (role === 'reviewer-visual' && options.uiPhase === false) {
    return {
      code: 'SPECDEV_UI_NOT_DECLARED',
      reason: `⛔ SpecDev gate: reviewer-visual reviews a UI phase against the visual baseline; phase \`${phase}\` declares ui: false.`,
    }
  }
  if (!PROTOTYPE_GATED_ROLES.has(role)) return undefined
  if (options.uiPhase === 'unknown') {
    return {
      code: 'SPECDEV_UI_UNKNOWN',
      reason: `⛔ SpecDev gate: phase-plan.md does not declare ui for phase \`${phase}\`, so the visual gates cannot be evaluated. Add \`ui: true\` or \`ui: false\` to that phase.`,
    }
  }
  if (options.uiPhase === true && options.prototypeConfirmed !== true) {
    return {
      code: 'SPECDEV_PROTOTYPE_PENDING',
      reason: `⛔ SpecDev gate: phase \`${phase}\` is a UI phase whose prototype is not confirmed. Present the prototype to the user, confirm it through the prototype gate, then dispatch ${role}.`,
    }
  }
  return undefined
}

/**
 * Implementer-specific matrix: HG-2, loop cap, phase, git branch (AC-36/37/38).
 * @param auth - authoritative status.
 * @param options - git branch.
 */
function evaluateImplementer(
  auth: AuthoritativeSpecdevStatus,
  options: EvaluateRoleOptions,
): SpecdevGateDenial | undefined {
  if (auth.gates.hg2 !== 'passed') {
    return {
      code: 'SPECDEV_HG2_PENDING',
      reason: '⛔ SpecDev gate: Human Gate 2 not passed. Confirm design before implementer.',
    }
  }
  if (auth.loopCount >= SPECDEV_LOOP_MAX) {
    return {
      code: 'SPECDEV_LOOP_MAX',
      reason: `⛔ SpecDev gate: implementer↔reviewer loop_count=${String(auth.loopCount)} >= ${String(SPECDEV_LOOP_MAX)}. Escalate to user — no further automatic loops.`,
      escalate: true,
    }
  }
  if (auth.phase === null || auth.phase.length === 0) {
    return {
      code: 'SPECDEV_PHASE_MISSING',
      reason: '⛔ SpecDev gate: current_phase is empty. Finish HG-2 / phase plan first.',
    }
  }
  const expected = `impl-${auth.phase}`
  const actual = options.gitBranch
  if (actual === undefined) {
    // Caller omitted branch check (non-implementer path); treat as fail-closed deny.
    return {
      code: 'SPECDEV_BRANCH_UNKNOWN',
      reason: `⛔ SpecDev gate: git branch unavailable; need \`${expected}\` (AC-37).`,
    }
  }
  if (actual === null || actual.length === 0) {
    return {
      code: 'SPECDEV_BRANCH_UNKNOWN',
      reason: `⛔ SpecDev gate: git branch unavailable; need \`${expected}\` (AC-37).`,
    }
  }
  if (actual !== expected) {
    return {
      code: 'SPECDEV_BRANCH_MISMATCH',
      reason: `⛔ SpecDev gate: git branch is \`${actual}\`, need \`${expected}\`. Create/switch branch first (Phase 4 creates; this gate only denies).`,
    }
  }
  return undefined
}

/**
 * Format a denial for tools / thrown errors, including escalate marker.
 * @param denial - structured denial.
 */
export function formatGateDenial(denial: SpecdevGateDenial): string {
  if (denial.escalate === true) {
    return `${denial.reason} [escalate:user][code=${denial.code}]`
  }
  return `${denial.reason} [code=${denial.code}]`
}

/**
 * Detect whether a tool path targets durable SpecDev status (AC-28 defense).
 * @param filePath - tool `file_path` / `path` argument.
 */
export function isCurrentStatusPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized === 'current-status.json'
    || normalized.endsWith('/current-status.json')
}

/**
 * Extract a filesystem path from common write/edit tool arguments.
 * @param args - tool arguments bag.
 */
export function toolFilePath(args: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of ['file_path', 'path', 'filePath'] as const) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}
