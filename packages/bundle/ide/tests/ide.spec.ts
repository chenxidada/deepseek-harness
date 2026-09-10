/** ide bundle patch composition and AC-5 mutual exclusion. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const FORBIDDEN_IDS = new Set(['ui-approval', 'ui-user-questions'])
const FORBIDDEN_NAMES = new Set([
  '@deepseek-ai/dsh-client-ui-approval',
  '@deepseek-ai/dsh-client-ui-user-questions',
])

describe('dsh-ide bundle', () => {
  it('stacks on sdk-app, inserts ide-bridge, and excludes Web UI answerers (AC-5)', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-ide-bridge')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{
      id?: string
      config?: { profile?: string }
      insert?: Array<{ id?: string; name?: string }>
    }>
    expect(patches.find(patch => patch.id === 'sdk-app-startup')?.config?.profile).toBe('ide')
    const rows = patches.flatMap(patch => patch.insert ?? [])
    expect(rows.find(row => row.id === 'ide-bridge')?.name).toBe('@deepseek-ai/dsh-ide-bridge')
    expect(rows.find(row => row.id === 'file-reference-local')?.name)
      .toBe('@deepseek-ai/dsh-file-reference-local')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-file-reference-local')
    for (const patch of patches) {
      expect(FORBIDDEN_IDS.has(patch.id ?? '')).toBe(false)
      for (const row of patch.insert ?? []) {
        expect(FORBIDDEN_IDS.has(row.id ?? '')).toBe(false)
        expect(FORBIDDEN_NAMES.has(row.name ?? '')).toBe(false)
      }
    }
  })
})
