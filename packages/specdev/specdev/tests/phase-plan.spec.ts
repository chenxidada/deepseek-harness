/**
 * SpecDev `phase-plan.md` DAG parsing: the fence extraction, every validation
 * the plan document must pass, and the ready-phase selection the gates and the
 * phase runtime use.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  artifactNonEmpty,
  extractPhasePlanDagJson,
  firstReadyPhaseId,
  isDagPhaseId,
  nextReadyPhaseId,
  parsePhasePlanDag,
  phaseUiOf,
  readPhasePlanDag,
  type PhasePlanDag,
} from '@deepseek-ai/dsh-specdev'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

/** Error code a call throws, or a failure when it does not throw. */
function codeOf(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error: unknown) {
    return (error as { code?: string }).code
  }
  throw new Error('expected the call to throw')
}

describe('extractPhasePlanDagJson', () => {
  it('refuses markdown without a json fence and invalid json inside one', () => {
    expect(codeOf(() => extractPhasePlanDagJson('# Plan\n\nno fence\n'))).toBe('SPECDEV_PHASE_PLAN_INVALID')
    expect(() => extractPhasePlanDagJson('# Plan\n\n```json\n{ not json }\n```\n'))
      .toThrow(/phase-plan\.md JSON is invalid/)
  })

  it('returns the parsed document from the first json fence', () => {
    expect(extractPhasePlanDagJson('# Plan\n\n```json\n{"phases":[{"id":"p1","dependencies":[]}]}\n```\n'))
      .toEqual({ phases: [{ id: 'p1', dependencies: [] }] })
  })
})

describe('parsePhasePlanDag validation', () => {
  it('refuses documents that are not an object with a non-empty phases array', () => {
    for (const raw of [null, 'plan', [], 7, {}]) {
      expect(codeOf(() => parsePhasePlanDag(raw))).toBe('SPECDEV_PHASE_PLAN_INVALID')
    }
    expect(codeOf(() => parsePhasePlanDag({ phases: [] }))).toBe('SPECDEV_PHASE_PLAN_INVALID')
  })

  it('refuses a phase node that is not an object', () => {
    expect(() => parsePhasePlanDag({ phases: [null] })).toThrow(/phases\[0\] must be an object/)
  })

  it('refuses an invalid id, dependencies, or ui declaration', () => {
    expect(() => parsePhasePlanDag({ phases: [{ id: '  ', dependencies: [] }] }))
      .toThrow(/phases\[0\]\.id must be a non-empty string/)
    expect(() => parsePhasePlanDag({ phases: [{ id: 'p1', dependencies: 'p0' }] }))
      .toThrow(/phases\[0\]\.dependencies must be a string array/)
    expect(() => parsePhasePlanDag({ phases: [{ id: 'p1', dependencies: [7] }] }))
      .toThrow(/phases\[0\]\.dependencies must be a string array/)
    expect(() => parsePhasePlanDag({ phases: [{ id: 'p1', dependencies: [], ui: 'yes' }] }))
      .toThrow(/phases\[0\]\.ui must be a boolean/)
  })

  it('trims ids and dependencies and keeps a declared ui flag', () => {
    const dag = parsePhasePlanDag({ phases: [{ id: ' p1 ', dependencies: [' p0 '], ui: false }] })
    expect(dag.phases).toEqual([{ id: 'p1', dependencies: ['p0'], ui: false }])
  })
})

describe('ready-phase selection', () => {
  const dag: PhasePlanDag = {
    phases: [
      { id: 'p1', dependencies: [] },
      { id: 'p2', dependencies: ['p1'] },
      { id: 'p3', dependencies: ['p2'] },
    ],
  }

  it('picks the first phase without dependencies', () => {
    expect(firstReadyPhaseId(dag)).toBe('p1')
    expect(firstReadyPhaseId({ phases: [{ id: 'dependent', dependencies: ['other'] }] })).toBe('dependent')
    expect(firstReadyPhaseId({ phases: [] })).toBeNull()
  })

  it('names the next phase whose dependencies are all done', () => {
    expect(nextReadyPhaseId(dag, new Set(['p1']))).toBe('p2')
    expect(nextReadyPhaseId(dag, ['p1', 'p2'])).toBe('p3')
    expect(nextReadyPhaseId(dag, new Set(['p2']))).toBe('p1')
    expect(nextReadyPhaseId(dag, new Set(['p1', 'p2', 'p3']))).toBeNull()
  })

  it('skips a phase whose dependencies are still open', () => {
    const reversed: PhasePlanDag = {
      phases: [
        { id: 'p2', dependencies: ['p1'] },
        { id: 'p1', dependencies: [] },
      ],
    }
    expect(nextReadyPhaseId(reversed, [])).toBe('p1')
  })

  it('reports whether an id belongs to the plan', () => {
    expect(isDagPhaseId(dag, ' p2 ')).toBe(true)
    expect(isDagPhaseId(dag, 'p9')).toBe(false)
  })

  it('reads a ui declaration per phase and leaves it absent otherwise', () => {
    const declared = parsePhasePlanDag({ phases: [{ id: 'p1', dependencies: [], ui: true }] })
    expect(phaseUiOf(declared, 'p1')).toBe(true)
    expect(phaseUiOf(dag, 'p1')).toBeUndefined()
  })
})

describe('plan file access', () => {
  it('refuses a missing plan and reads a present one', () => {
    const slugDir = tempDir('specdev-plan-')
    expect(codeOf(() => readPhasePlanDag(slugDir))).toBe('SPECDEV_PHASE_PLAN_MISSING')
    writeFileSync(
      join(slugDir, 'phase-plan.md'),
      '# Plan\n\n```json\n{"phases":[{"id":"p1","dependencies":[]}]}\n```\n',
    )
    expect(readPhasePlanDag(slugDir).phases.map(phase => phase.id)).toEqual(['p1'])
  })

  it('reports artifacts that are missing, whitespace-only, or present', () => {
    const slugDir = tempDir('specdev-plan-artifact-')
    expect(artifactNonEmpty(slugDir, 'requirements.md')).toBe(false)
    writeFileSync(join(slugDir, 'requirements.md'), '  \n\n')
    expect(artifactNonEmpty(slugDir, 'requirements.md')).toBe(false)
    writeFileSync(join(slugDir, 'requirements.md'), '\n# Requirements\n')
    expect(artifactNonEmpty(slugDir, 'requirements.md')).toBe(true)
  })
})
