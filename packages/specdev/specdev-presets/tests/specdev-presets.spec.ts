/**
 * SpecDev preset roster: the shipped root, its ids, and the published service.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SpecdevPresetsService, {
  SPECDEV_PRESET_IDS,
  SPECDEV_PRESET_ROOT,
  rolePresetId,
} from '@deepseek-ai/dsh-specdev-presets'

describe('@deepseek-ai/dsh-specdev-presets', () => {
  it('ships every SpecDev role preset directory with a persona row', () => {
    expect(existsSync(SPECDEV_PRESET_ROOT)).toBe(true)
    const dirs = readdirSync(SPECDEV_PRESET_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    expect(dirs).toEqual([...SPECDEV_PRESET_IDS].sort())
    for (const id of SPECDEV_PRESET_IDS) {
      expect(existsSync(join(SPECDEV_PRESET_ROOT, id, 'preset.yml'))).toBe(true)
      const agent = readFileSync(join(SPECDEV_PRESET_ROOT, id, 'agent.cordis.yml'), 'utf8')
      expect(agent).toContain('@deepseek-ai/dsh-persona')
    }
    expect(rolePresetId('implementer')).toBe('specdev-implementer')
  })

  it('keeps a role label that already carries the preset prefix', () => {
    expect(rolePresetId('specdev-verifier')).toBe('specdev-verifier')
  })

  it('publishes presetRoot on ctx.specdevPresets', async () => {
    const ctx = new Context()
    await ctx.plugin(SpecdevPresetsService)
    expect(ctx.specdevPresets.presetRoot).toBe(SPECDEV_PRESET_ROOT)
  })
})
