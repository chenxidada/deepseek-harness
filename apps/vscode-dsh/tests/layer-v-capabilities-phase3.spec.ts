/**
 * Phase 3 (`phase-3-remaining-capabilities`) anti-stub tests for the Layer V manifest.
 *
 * Phase 3 rewrites the 14 placeholder capability steps for the remaining 6 host-side groups
 * (§12.4 subagent, §12.5 code-context, §12.6 change-list, §12.7 search, §12.10 history,
 * §12.11 interaction) into real EDH-driven sequences. A placeholder manifest would keep
 * `dsh.test.getStartState` waits, empty `openHistory('')` args, `openSubagent('__child__')`
 * fake ids, or `listPendingInteractions` asserted only as `$array`. These tests pin the
 * anti-stub contract directly against `layer-v-capabilities.json`: every target capability
 * must name real hooks, every `assert` step must carry an `expect`, every prompt sent to the
 * model must be followed by a marker round-trip assertion, and no placeholder hook may remain.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test-scripts',
  'layer-v-capabilities.json',
)

interface ManifestStep {
  kind: string
  step: string
  command?: string
  args?: unknown[]
  expect?: unknown
  timeoutMs?: number
}

interface ManifestCapability {
  id: string
  group: string
  title: string
  ac: string[]
  requiresModel: boolean
  steps: ManifestStep[]
}

interface Manifest {
  capabilities: ManifestCapability[]
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
const byId = new Map(manifest.capabilities.map(cap => [cap.id, cap]))

/** The 14 capabilities this Phase drives (§12.4/12.5/12.6/12.7/12.10/12.11). */
const TARGET_IDS = [
  'cap-open-subagent-context',
  'cap-pin-subagent-tab',
  'cap-at-path-token',
  'cap-workspace-path-resolve',
  'cap-selection-ask',
  'cap-change-index-store',
  'cap-snapshot-revert',
  'cap-change-diff-render',
  'cap-session-search',
  'cap-tier1-field-match',
  'cap-history-list',
  'cap-open-from-history',
  'cap-interaction-coordinator',
  'cap-interaction-ui',
]

/** Hooks whose presence proves the manifest no longer uses Phase 2 placeholder commands. */
const PLACEHOLDER_HOOKS = new Set([
  'dsh.test.getStartState',
])

function stepsOf(id: string): ManifestStep[] {
  const cap = byId.get(id)
  if (cap === undefined) throw new Error(`missing manifest capability ${id}`)
  return cap.steps
}

function commandsOf(id: string): string[] {
  return stepsOf(id).map(step => step.command).filter((c): c is string => typeof c === 'string')
}

/** A model round-trip marker assertion: assistant text carries the marker. */
function isMarkerExpect(expect: unknown): boolean {
  return typeof expect === 'string'
    && (expect.startsWith('$assistantContains:') || expect.startsWith('$assistantClosed:'))
}

describe('Phase 3 manifest: 14 target capabilities are present', () => {
  it('every target id exists in the manifest', () => {
    for (const id of TARGET_IDS) {
      expect(byId.has(id), `missing ${id}`).toBe(true)
    }
  })

  it('every target capability has at least one step', () => {
    for (const id of TARGET_IDS) {
      expect(stepsOf(id).length, `${id} has no steps`).toBeGreaterThan(0)
    }
  })
})

describe('Phase 3 manifest: no placeholder hooks remain', () => {
  it('no target step still waits on dsh.test.getStartState', () => {
    for (const id of TARGET_IDS) {
      for (const command of commandsOf(id)) {
        expect(PLACEHOLDER_HOOKS.has(command), `${id} still uses ${command}`).toBe(false)
      }
    }
  })

  it('no target step drives a fake subagent id or an empty id arg', () => {
    for (const id of TARGET_IDS) {
      for (const step of stepsOf(id)) {
        const args = step.args ?? []
        for (const arg of args) {
          if (typeof arg === 'string') {
            expect(arg, `${id} step ${step.step} passes a placeholder string arg`).not.toBe('__child__')
            expect(arg, `${id} step ${step.step} passes an empty id arg`).not.toBe('')
          }
        }
      }
    }
  })
})

describe('Phase 3 manifest: assert steps carry expectations', () => {
  it('every assert step names an expect, so a stub could not pass silently', () => {
    for (const id of TARGET_IDS) {
      for (const step of stepsOf(id)) {
        if (step.kind === 'assert') {
          expect(step.expect, `${id} step ${step.step} is an assert without expect`).toBeDefined()
        }
      }
    }
  })

  it('every command-driving step (assert/wait/stream/replay) names the command it drives', () => {
    const commandDriving = new Set(['assert', 'wait', 'stream', 'replay'])
    for (const id of TARGET_IDS) {
      for (const step of stepsOf(id)) {
        if (commandDriving.has(step.kind)) {
          expect(typeof step.command, `${id} step ${step.step} (${step.kind}) has no command`).toBe('string')
        }
      }
    }
  })
})

describe('Phase 3 manifest: every prompt is answered by a marker round-trip (AC-9)', () => {
  it('a sendPrompt step is always followed by a marker wait/stream assertion', () => {
    for (const id of TARGET_IDS) {
      const steps = stepsOf(id)
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i]
        if (step.command !== 'dsh.test.sendPrompt') continue
        const hasMarkerAfter = steps.slice(i + 1).some(later =>
          (later.kind === 'wait' || later.kind === 'stream') && isMarkerExpect(later.expect),
        )
        expect(hasMarkerAfter, `${id} step ${step.step} sends a prompt but no marker round-trip follows`).toBe(true)
      }
    }
  })

  it('no model gate uses $contains, which a user-bubble echo would satisfy', () => {
    for (const id of TARGET_IDS) {
      for (const step of stepsOf(id)) {
        if (step.kind !== 'wait' && step.kind !== 'stream') continue
        if (typeof step.expect === 'string' && step.expect.startsWith('$contains:')) {
          expect(false, `${id} step ${step.step} uses $contains for a model gate`).toBe(true)
        }
      }
    }
  })
})

describe('Phase 3 manifest: each group drives its real product surface', () => {
  it('subagent drives dsh.test.injectSubagent then open/pin', () => {
    expect(commandsOf('cap-open-subagent-context')).toContain('dsh.test.injectSubagent')
    expect(commandsOf('cap-open-subagent-context')).toContain('dsh.test.openSubagent')
    expect(commandsOf('cap-pin-subagent-tab')).toContain('dsh.test.injectSubagent')
    expect(commandsOf('cap-pin-subagent-tab')).toContain('dsh.test.pinSubagent')
  })

  it('code-context uses dsh.test.resolveAtPath for @path resolution', () => {
    expect(commandsOf('cap-at-path-token')).toContain('dsh.test.resolveAtPath')
    expect(commandsOf('cap-workspace-path-resolve')).toContain('dsh.test.resolveAtPath')
  })

  it('selection-ask opens an editor selection before asking the model', () => {
    expect(commandsOf('cap-selection-ask')).toContain('dsh.test.openEditorWithSelection')
    expect(commandsOf('cap-selection-ask')).toContain('dsh.test.askAboutSelection')
    expect(commandsOf('cap-selection-ask')).toContain('dsh.test.sendPrompt')
  })

  it('change-list drives the new revert hooks and diff availability', () => {
    expect(commandsOf('cap-change-index-store')).toContain('dsh.test.listChanges')
    expect(commandsOf('cap-snapshot-revert')).toContain('dsh.test.revertAllChanges')
    expect(commandsOf('cap-change-diff-render')).toContain('dsh.test.diffAvailability')
    expect(commandsOf('cap-change-diff-render')).toContain('dsh.test.changedFileCount')
  })

  it('search drives dsh.test.searchSessions, not a product QuickPick command', () => {
    expect(commandsOf('cap-session-search')).toContain('dsh.test.searchSessions')
    expect(commandsOf('cap-tier1-field-match')).toContain('dsh.test.searchSessions')
  })

  it('history drives dsh.test.listHistory, and open-from-history uses a replay step', () => {
    expect(commandsOf('cap-history-list')).toContain('dsh.test.listHistory')
    const reopenSteps = stepsOf('cap-open-from-history')
    const hasReplay = reopenSteps.some(step => step.kind === 'replay')
    expect(hasReplay, 'cap-open-from-history has no replay step').toBe(true)
  })

  it('interaction drives dsh.test.injectApproval + dsh.test.answerApproval + listPendingInteractions', () => {
    for (const id of ['cap-interaction-coordinator', 'cap-interaction-ui']) {
      const commands = commandsOf(id)
      expect(commands).toContain('dsh.test.injectApproval')
      expect(commands).toContain('dsh.test.answerApproval')
      expect(commands).toContain('dsh.test.listPendingInteractions')
    }
  })
})
