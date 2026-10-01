/** SpecDev bundle patch composition. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { SPECDEV_PRESET_IDS } from '@deepseek-ai/dsh-specdev-presets'

const root = fileURLToPath(new URL('..', import.meta.url))

/** One inserted patch row with the fields this bundle's patches declare. */
interface InsertedRow {
  id?: string
  name?: string
  inject?: string[]
  config?: { default?: unknown; id?: unknown; plugins?: unknown }
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string[] } }
}

const patchFiles = manifest.dsh?.bundle?.patch ?? []

function loadRows(file: string): InsertedRow[] {
  const patches = yaml.load(readFileSync(resolve(root, file), 'utf8'), { schema: entryListSchema }) as
    Array<{ insert?: InsertedRow[] }>
  return patches.flatMap(patch => patch.insert ?? [])
}

describe('dsh-specdev-app bundle', () => {
  it('stacks on sdk-app, inserts the SpecDev runtime, and keeps the general default', () => {
    for (const dependency of [
      '@deepseek-ai/dsh-specdev',
      '@deepseek-ai/dsh-specdev-guard',
      '@deepseek-ai/dsh-specdev-presets',
      '@deepseek-ai/dsh-tool-subagent',
      '@deepseek-ai/dsh-agent-preset',
      '@deepseek-ai/dsh-agent-preset-registry',
    ]) {
      expect(manifest.dependencies).toHaveProperty(dependency)
    }
    expect(patchFiles[0]).toBe('./cordis.patch.yml')
    const rows = loadRows('./cordis.patch.yml')
    expect(rows.find(row => row.id === 'specdev')?.name).toBe('@deepseek-ai/dsh-specdev')
    expect(rows.find(row => row.id === 'specdev-guard')?.name).toBe('@deepseek-ai/dsh-specdev-guard')
    expect(rows.find(row => row.id === 'specdev-guard')?.inject).toEqual(['specdev', 'tools', 'sessionProjections'])
    expect(rows.find(row => row.id === 'specdev-presets')?.name).toBe('@deepseek-ai/dsh-specdev-presets')
    // The shipped `standard` preset cannot mount without this Host row
    // (`tool-subagent: modelSelectionSettings requires ... in the Host scope`),
    // so the layer that makes it the default must also host it.
    expect(rows.find(row => row.id === 'subagent-model-selection-settings')?.name)
      .toBe('@deepseek-ai/dsh-tool-subagent/model-selection-settings')
    // The main session must stay a general agent: a workflow role as the
    // deployment default would take the general agent away from the IDE.
    const registry = rows.find(row => row.id === 'agent-preset-registry')
    expect(registry?.name).toBe('@deepseek-ai/dsh-agent-preset-registry')
    expect(registry?.config?.default).toBe('standard')
  })

  it('declares the shipped standard preset and every SpecDev role preset', () => {
    const declared = new Map<string, unknown>()
    for (const file of patchFiles.slice(1)) {
      for (const row of loadRows(file)) {
        expect(row.name).toBe('@deepseek-ai/dsh-agent-preset')
        expect(Array.isArray(row.config?.plugins)).toBe(true)
        declared.set(String(row.config?.id), file)
      }
    }
    expect([...declared.keys()].sort()).toEqual(['standard', ...SPECDEV_PRESET_IDS].sort())
  })
})
