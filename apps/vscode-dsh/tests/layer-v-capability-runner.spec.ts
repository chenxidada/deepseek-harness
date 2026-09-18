/**
 * Phase 1 (`phase-1-driver-framework-pilot`) integration test for the multi-capability
 * runner (AD-2 / AD-3 / AD-4).
 *
 * The runner is the dependency-free half of `layer-v-capability-driver`: it turns
 * `layer-v-capabilities.json` into per-capability verdicts and one aggregate conclusion,
 * and it is deliberately free of any `vscode` import so this suite can drive the whole
 * path — manifest → selection → credential gate → step execution → AD-4 assertion →
 * aggregate conclusion — against a mock host under plain Node. `extension.cjs` is the
 * only file that knows `vscode.commands`; it is not required here.
 *
 * AD-4 (assertions are "key-area presence + non-degeneration", never pixel equality) is
 * exercised through `matchesExpect`: a field path resolves to a literal (deep-equal) or a
 * type predicate (`$string` / `$number` / `$boolean` / `$object` / `$array` / `$array:N` /
 * `$present`), and a `$root` path names "the whole result" for commands that return a bare
 * array (e.g. `dsh.test.listHistory`).
 *
 * Every case that claims a *pass* also asserts the mirror-image *fail*, so a shell that
 * returned a constant would be caught (anti-stub): the run only passes when the function
 * is genuinely sensitive to its input.
 */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/** The runner's own module, required rather than re-implemented. */
const require = createRequire(import.meta.url)
const runner = require('../test-scripts/layer-v-capability-driver/capability-runner.cjs') as {
  StageError: new (conclusion: string, detail: { reason: string; evidence?: unknown; step?: string }) => Error & {
    conclusion: string
    reason: string
    evidence?: unknown
    step?: string
  }
  linkFailure: (reason: string, evidence?: unknown) => Error
  harnessError: (reason: string, evidence?: unknown) => Error
  skipNoCredentials: (reason: string, evidence?: unknown) => Error
  CONCLUSION_PRECEDENCE: string[]
  safeJson: (value: unknown) => unknown
  unwrap: (value: unknown) => unknown
  resolvePath: (value: unknown, fieldPath: string) => unknown
  deepEqual: (a: unknown, b: unknown) => boolean
  MATCHERS: Record<string, { name: string; test: (value: unknown) => boolean }>
  resolveMatcher: (pred: string) => (value: unknown) => boolean
  typePredicate: (value: unknown, pred: string) => boolean
  matchesExpect: (actual: unknown, expect: unknown) => { ok: boolean; path?: string; expected?: unknown; actual?: unknown }
  selectCapabilities: (manifest: unknown, selector?: { only?: string[] }) => Array<{ id: string; group: string }>
  runManifest: (
    manifest: unknown,
    host: {
      executeCommand: (id: string, ...args: unknown[]) => Promise<unknown>
      capture: (fileName: string) => Promise<unknown>
    },
    options?: { selector?: { only?: string[] }; hasCredential?: boolean; stepTimeoutMs?: number; journal?: (entry: object) => void },
  ) => Promise<{ conclusion: string; capabilities: Array<{ id: string; conclusion: string; steps?: unknown[] }> }>
  overallConclusion: (results: Array<{ conclusion: string }>) => string
}

const {
  matchesExpect,
  selectCapabilities,
  runManifest,
  overallConclusion,
  resolvePath,
  deepEqual,
  MATCHERS,
  resolveMatcher,
  typePredicate,
  linkFailure,
} = runner

/** A mock host whose commands answer a fixed map; the capture is a non-degenerate stub PNG. */
function mockHost(answers: Record<string, unknown>): {
  executeCommand: (id: string, ...args: unknown[]) => Promise<unknown>
  capture: (fileName: string) => Promise<unknown>
} {
  return {
    executeCommand: async (id, ..._args) => {
      if (id in answers) return answers[id]
      throw new Error(`unexpected command ${id}`)
    },
    capture: async () => ({ ok: true, file: 'probe.png', verdict: { ok: true, size: 1024 } }),
  }
}

describe('AD-4: matchesExpect distinguishes inputs (anti-stub)', () => {
  it('accepts a matching literal and rejects a mismatching one', () => {
    expect(matchesExpect({ viewId: 'dsh.editorChat', panelOpen: true }, { panelOpen: true }).ok).toBe(true)
    expect(matchesExpect({ panelOpen: false }, { panelOpen: true }).ok).toBe(false)
  })

  it('resolves a dotted field path against a nested result', () => {
    expect(matchesExpect({ outer: { inner: 'x' } }, { 'outer.inner': 'x' }).ok).toBe(true)
    expect(matchesExpect({ outer: { inner: 'x' } }, { 'outer.inner': 'y' }).ok).toBe(false)
  })

  it('applies a $root predicate to the whole result, for bare-array commands', () => {
    expect(matchesExpect([{ id: 'a' }], '$array').ok).toBe(true)
    expect(matchesExpect({ rows: [] }, '$array').ok).toBe(false)
    expect(matchesExpect([1, 2, 3], '$array:2').ok).toBe(true)
    expect(matchesExpect([1], '$array:2').ok).toBe(false)
  })

  it('applies type predicates to a named field', () => {
    expect(matchesExpect({ state: 'started' }, { state: '$string' }).ok).toBe(true)
    expect(matchesExpect({ state: 7 }, { state: '$string' }).ok).toBe(false)
  })

  it('names the failing path so the mismatch is diagnosable, not a bare boolean', () => {
    const verdict = matchesExpect({ a: { b: 1 } }, { 'a.b': 2 })
    expect(verdict.ok).toBe(false)
    expect(verdict.path).toBe('a.b')
  })
})

describe('AD-3: selectCapabilities drives the manifest', () => {
  const manifest = {
    capabilities: [
      { id: 'cap-1', group: 'react-spa-main' },
      { id: 'cap-2', group: 'react-spa-main' },
      { id: 'cap-3', group: 'editor-panel' },
    ],
  }

  it('runs everything when no selector is given', () => {
    expect(selectCapabilities(manifest).map(cap => cap.id)).toEqual(['cap-1', 'cap-2', 'cap-3'])
  })

  it('filters by group', () => {
    expect(selectCapabilities(manifest, { only: ['editor-panel'] }).map(cap => cap.id)).toEqual(['cap-3'])
  })

  it('filters by exact id', () => {
    expect(selectCapabilities(manifest, { only: ['cap-2'] }).map(cap => cap.id)).toEqual(['cap-2'])
  })
})

describe('conclusion aggregation never merges or downgrades', () => {
  it('returns PASS only when every capability passed', () => {
    expect(overallConclusion([{ conclusion: 'PASS' }, { conclusion: 'PASS' }])).toBe('PASS')
  })

  it('lets LINK_FAILURE outrank PASS', () => {
    expect(overallConclusion([{ conclusion: 'PASS' }, { conclusion: 'LINK_FAILURE' }])).toBe('LINK_FAILURE')
  })

  it('lets SKIPPED_NO_CREDENTIALS outrank PASS (fail-closed)', () => {
    expect(overallConclusion([{ conclusion: 'PASS' }, { conclusion: 'SKIPPED_NO_CREDENTIALS' }])).toBe('SKIPPED_NO_CREDENTIALS')
  })

  it('reports a harness error for an empty selection', () => {
    expect(overallConclusion([])).toBe('HARNESS_ERROR')
  })
})

describe('StageError carries its classification', () => {
  it('classifies a link failure with a reason and evidence', () => {
    const error = linkFailure('the panel did not open', { viewId: null })
    expect(error).toBeInstanceOf(Error)
    expect((error as Error & { conclusion: string }).conclusion).toBe('LINK_FAILURE')
  })
})

describe('runManifest end-to-end (manifest → gate → steps → conclusion)', () => {
  it('fail-closes a model-gated capability when no credential is present', async () => {
    const manifest = {
      capabilities: [
        { id: 'gated', group: 'session', title: 'gated', requiresModel: true, steps: [] },
      ],
    }
    // The host must not be touched for a gated capability, so any command is an error.
    const result = await runManifest(manifest, mockHost({}), { hasCredential: false })
    expect(result.conclusion).toBe('SKIPPED_NO_CREDENTIALS')
    expect(result.capabilities[0].conclusion).toBe('SKIPPED_NO_CREDENTIALS')
  })

  it('passes a capability whose command + assertion + screenshot all succeed', async () => {
    const manifest = {
      capabilities: [
        {
          id: 'cap-1',
          group: 'react-spa-main',
          title: 'root',
          requiresModel: false,
          steps: [
            { kind: 'command', step: 'open', command: 'dsh.showPanel' },
            { kind: 'assert', step: 'panel-open', command: 'dsh.showPanel', expect: { panelOpen: true } },
            { kind: 'screenshot', step: 'shot', file: 'cap-1.png' },
          ],
        },
      ],
    }
    const result = await runManifest(manifest, mockHost({ 'dsh.showPanel': { viewId: 'dsh.editorChat', panelOpen: true } }), { hasCredential: false })
    expect(result.conclusion).toBe('PASS')
    expect(result.capabilities[0].conclusion).toBe('PASS')
    expect((result.capabilities[0].steps as unknown[]).length).toBe(3)
  })

  it('classifies a failing assertion as LINK_FAILURE, not a pass', async () => {
    const manifest = {
      capabilities: [
        {
          id: 'cap-1',
          group: 'react-spa-main',
          title: 'root',
          requiresModel: false,
          steps: [{ kind: 'assert', step: 'panel-open', command: 'dsh.showPanel', expect: { panelOpen: true } }],
        },
      ],
    }
    const result = await runManifest(manifest, mockHost({ 'dsh.showPanel': { panelOpen: false } }), { hasCredential: false })
    expect(result.conclusion).toBe('LINK_FAILURE')
    expect(result.capabilities[0].conclusion).toBe('LINK_FAILURE')
  })

  it('journals every step, including the failure that threw (crash-localisable)', async () => {
    const manifest = {
      capabilities: [
        {
          id: 'cap-1',
          group: 'react-spa-main',
          title: 'root',
          requiresModel: false,
          steps: [
            { kind: 'command', step: 'open', command: 'dsh.showPanel' },
            { kind: 'assert', step: 'panel-open', command: 'dsh.showPanel', expect: { panelOpen: true } },
          ],
        },
      ],
    }
    const entries: Array<Record<string, unknown>> = []
    const result = await runManifest(manifest, mockHost({ 'dsh.showPanel': { panelOpen: false } }), {
      hasCredential: false,
      journal: entry => entries.push(entry as Record<string, unknown>),
    })
    // The PASS command step and the FAILING assert step are both journaled, in order, naming
    // capability + step + verdict — the fields the design contract requires.
    expect(result.conclusion).toBe('LINK_FAILURE')
    expect(entries.map(e => `${e.capability}:${e.step}:${e.verdict}`)).toEqual([
      'cap-1:open:PASS',
      'cap-1:panel-open:LINK_FAILURE',
    ])
  })
})

describe('resolvePath / deepEqual / typePredicate primitives', () => {
  it('resolves a dotted path and $root', () => {
    expect(resolvePath({ a: { b: 3 } }, 'a.b')).toBe(3)
    expect(resolvePath([1, 2], '$root')).toEqual([1, 2])
  })

  it('deep-equals structurally, not by reference', () => {
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('classifies type predicates, including the array-length form', () => {
    expect(typePredicate('x', '$string')).toBe(true)
    expect(typePredicate(1, '$string')).toBe(false)
    expect(typePredicate([1, 2], '$array:2')).toBe(true)
    expect(typePredicate([1], '$array:2')).toBe(false)
  })

  it('exposes the pluggable matcher registry (the Phase 2/3 extension point)', () => {
    // The shipped matchers are the exact set `matchesExpect` routes through; a future
    // `$selector` / `$visible` matcher is one extra registry entry, not an edit to the core.
    expect(Object.keys(MATCHERS).sort()).toEqual(['$array', '$boolean', '$number', '$object', '$present', '$string'])
    expect(resolveMatcher('$string')('x')).toBe(true)
    expect(resolveMatcher('$array:2')([1, 2])).toBe(true)
    expect(resolveMatcher('$array:2')([1])).toBe(false)
    expect(resolveMatcher('$not-a-matcher')({})).toBe(false)
  })
})
