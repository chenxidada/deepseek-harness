/** SpecDev bundle patch composition. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-specdev-app bundle', () => {
  it('stacks on sdk-app, inserts the SpecDev runtime, and keeps the general default', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    for (const dependency of [
      '@deepseek-ai/dsh-specdev',
      '@deepseek-ai/dsh-specdev-guard',
      '@deepseek-ai/dsh-specdev-presets',
      '@deepseek-ai/dsh-agent-presets',
      '@deepseek-ai/dsh-tool-subagent',
    ]) {
      expect(manifest.dependencies).toHaveProperty(dependency)
    }
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{
      id?: string
      insert?: Array<{
        id?: string
        name?: string
        inject?: string[]
        config?: { default?: unknown; includeShippedRoot?: unknown; includeUserRoot?: unknown }
      }>
    }>
    const rows = patches.flatMap(patch => patch.insert ?? [])
    expect(rows.find(row => row.id === 'specdev')?.name).toBe('@deepseek-ai/dsh-specdev')
    expect(rows.find(row => row.id === 'specdev-guard')?.name).toBe('@deepseek-ai/dsh-specdev-guard')
    expect(rows.find(row => row.id === 'specdev-guard')?.inject).toEqual(['specdev', 'tools', 'sessionProjections'])
    expect(rows.find(row => row.id === 'specdev-presets')?.name).toBe('@deepseek-ai/dsh-specdev-presets')
    // The shipped `standard` preset cannot mount without this Host row
    // (`tool-subagent: modelSelectionSettings requires ... in the Host scope`),
    // so the layer that makes it the default must also host it.
    expect(rows.find(row => row.id === 'subagent-model-selection-settings')?.name)
      .toBe('@deepseek-ai/dsh-tool-subagent/model-selection-settings')
    expect(rows.find(row => row.id === 'agent-presets')?.name).toBe('@deepseek-ai/dsh-agent-presets')
    expect(rows.find(row => row.id === 'agent-presets')?.inject).toEqual(['specdevPresets'])
    // The main session must stay a general agent: a workflow role as the
    // deployment default would take the general agent away from the IDE.
    const presetsConfig = rows.find(row => row.id === 'agent-presets')?.config
    expect(presetsConfig?.default).toBe('standard')
    expect(presetsConfig?.includeShippedRoot).toBe(true)
    expect(presetsConfig?.includeUserRoot).toBe(false)
  })
})
