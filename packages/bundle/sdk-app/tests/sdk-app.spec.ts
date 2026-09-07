/** The SDK app bundle's declared profile patch. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-sdk-app bundle', () => {
  it('declares startup-gated JSON-RPC serving without overriding base HMR policy', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-sdk-jsonrpc-server')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ id?: string; disabled?: boolean; insert?: Array<{ id?: string; inject?: string[]; name?: string }> }>
    expect(patches.find(patch => patch.id === 'hmr')).toBeUndefined()
    expect(patches.find(patch => patch.id === 'session-title-llm')).toMatchObject({ disabled: true })
    expect(patches.find(patch => patch.id === 'plan-mode')).toMatchObject({ disabled: true })
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-specdev')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-command-specdev')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-specdev-presets')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-agent-presets')
    const rows = patches.flatMap(patch => patch.insert ?? [])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.name).toBe('@deepseek-ai/dsh-sdk-app')
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')?.inject).toEqual(['sdkAppStartup', 'loader'])
    expect(rows.find(row => row.id === 'specdev')?.name).toBe('@deepseek-ai/dsh-specdev')
    expect(rows.find(row => row.id === 'specdev-presets')?.name).toBe('@deepseek-ai/dsh-specdev-presets')
    expect(rows.find(row => row.id === 'agent-presets')?.name).toBe('@deepseek-ai/dsh-agent-presets')
    expect(rows.find(row => row.id === 'agent-presets')?.inject).toEqual(['specdevPresets'])
    expect(rows.find(row => row.id === 'command-specdev')?.name).toBe('@deepseek-ai/dsh-command-specdev')
    expect(rows.find(row => row.id === 'command-specdev')?.inject).toEqual(['specdev', 'commands'])
  })
})
