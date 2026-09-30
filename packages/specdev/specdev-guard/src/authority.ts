/**
 * Authoritative SpecDev gate view: session projection / confirmGate events,
 * never raw `current-status.json` Human Gate flips (AC-28).
 *
 * @module @deepseek-ai/dsh-specdev-guard/authority
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-specdev'
import type {
  SpecdevGateId,
  SpecdevSnapshot,
} from '@deepseek-ai/dsh-specdev'

/** Max automatic implementer↔reviewer loops before escalate (AC-38). */
export const SPECDEV_LOOP_MAX = 2

/** Where gate authority came from. */
export type SpecdevGateAuthoritySource = 'projection' | 'fail-closed'

/** Fail-closed / projection-backed status used by pipeline-gate checks. */
export interface AuthoritativeSpecdevStatus {
  readonly slug: string | null
  readonly stage: string
  readonly phase: string | null
  readonly gates: SpecdevSnapshot['gates']
  readonly pendingGate: SpecdevGateId | null
  readonly loopCount: number
  readonly authority: SpecdevGateAuthoritySource
  /**
   * True when durable file claims a Human Gate `passed` that the projection
   * does not — a raw JSON bypass attempt (AC-28).
   */
  readonly fileHgDiverged: boolean
  /** Latest projected snapshot when authority is projection; else null. */
  readonly snapshot: SpecdevSnapshot | null
}

const PENDING_GATES = {
  hg1: 'pending',
  hg1_5: 'pending',
  hg2: 'pending',
  hg3: 'pending',
} as const satisfies AuthoritativeSpecdevStatus['gates']

/**
 * Resolve gate-relevant status from SpecDev projection events (confirmGate),
 * fail-closed when no projection exists. Optionally detects file vs projection
 * HG divergence without honoring the file pass.
 *
 * @param ctx - host context with `specdev` + `sessionProjections`.
 * @param session - session whose projection carries gate-decided events.
 * @param options - workspace resolution options for file comparison.
 */
export function resolveAuthoritativeStatus(
  ctx: Context,
  session: Session,
  options: { readonly cwd?: string } = {},
): AuthoritativeSpecdevStatus {
  const cwd = options.cwd ?? session.header.cwd ?? process.cwd()
  const projections = ctx.get('sessionProjections')
  const projected = projections?.stateOf(session, 'specdev/status')
  const fileSnap = ctx.specdev.mirrorSnapshot({ cwd })

  if (projected !== undefined && projected.failure === null && projected.status !== null) {
    const status = projected.status
    // Fail-closed loop: honor the higher of projection vs file so a file bump
    // cannot lower the cap, and a missing projection update cannot ignore file.
    const loopCount = Math.max(status.loopCount, fileSnap?.loopCount ?? 0)
    const fileHgDiverged = fileSnap !== null && gatesDiverged(fileSnap.gates, status.gates)
    return {
      slug: status.slug,
      stage: status.stage,
      phase: status.phase,
      gates: status.gates,
      pendingGate: status.pendingGate,
      loopCount,
      authority: 'projection',
      fileHgDiverged,
      snapshot: status,
    }
  }

  // No confirmGate / SpecDev events yet → treat all HG as pending (AC-28).
  const fileHgDiverged = fileSnap !== null && (
    fileSnap.gates.hg1 === 'passed'
    || fileSnap.gates.hg1_5 === 'passed'
    || fileSnap.gates.hg2 === 'passed'
    || fileSnap.gates.hg3 === 'passed'
  )
  return {
    slug: fileSnap?.slug ?? null,
    stage: 'unknown',
    phase: null,
    gates: PENDING_GATES,
    pendingGate: null,
    loopCount: Math.max(fileSnap?.loopCount ?? 0, 0),
    authority: 'fail-closed',
    fileHgDiverged,
    snapshot: null,
  }
}

/**
 * True when the file claims a gate is passed that authority does not.
 * @param fileGates - durable JSON gates.
 * @param authGates - projection / fail-closed gates.
 */
function gatesDiverged(
  fileGates: SpecdevSnapshot['gates'],
  authGates: SpecdevSnapshot['gates'],
): boolean {
  return (['hg1', 'hg1_5', 'hg2', 'hg3'] as const).some(
    key => fileGates[key] === 'passed' && authGates[key] !== 'passed',
  )
}
