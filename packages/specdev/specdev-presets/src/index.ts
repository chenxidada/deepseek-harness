/**
 * SpecDev preset sources and shipped role-preset ids.
 *
 * The `dsh-specdev-app` bundle declares these presets for the agent-preset
 * registry (one `@deepseek-ai/dsh-agent-preset` row per directory in
 * `presets/`), so role dispatch selects them by {@link rolePresetId}.
 *
 * @module @deepseek-ai/dsh-specdev-presets
 */

import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

/** Absolute path to shipped SpecDev `presets/` directory. */
export const SPECDEV_PRESET_ROOT = fileURLToPath(new URL('../presets/', import.meta.url))

/** Role preset id for a SpecDev role label (e.g. `implementer` → `specdev-implementer`). */
export function rolePresetId(role: string): string {
  return role.startsWith('specdev-') ? role : `specdev-${role}`
}

/** Every shipped SpecDev preset directory name. */
export const SPECDEV_PRESET_IDS = [
  'specdev-requirement-analyst',
  'specdev-plan-generator',
  'specdev-code-explorer',
  'specdev-implementer',
  'specdev-reviewer-correctness',
  'specdev-reviewer-design',
  'specdev-reviewer-connectivity',
  'specdev-reviewer-visual',
  'specdev-reviewer',
  'specdev-verifier',
  'specdev-wiki',
] as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    specdevPresets: SpecdevPresetsService
  }
}

/**
 * Publishes the SpecDev preset root for roster composition.
 */
export class SpecdevPresetsService extends Service {
  static inject = []

  static Config = Schema.object({})

  /** Absolute presets directory for `agent-presets` roots. */
  readonly presetRoot: string = SPECDEV_PRESET_ROOT

  constructor(ctx: Context) {
    super(ctx, 'specdevPresets')
  }
}

export default SpecdevPresetsService
