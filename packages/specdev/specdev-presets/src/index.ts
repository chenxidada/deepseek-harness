/**
 * SpecDev preset root + Orchestrator tool policy service.
 *
 * Mounts as \`ctx.specdevPresets\` so sdk-app can point \`agent-presets.roots\`
 * at {@link SpecdevPresetsService.presetRoot} via \`!!js\`.
 *
 * @module @deepseek-ai/dsh-specdev-presets
 */

import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export { applyOrchestratorToolPolicy, ORCHESTRATOR_ALLOW } from './tool-policy.ts'

/** Absolute path to shipped SpecDev \`presets/\` directory. */
export const SPECDEV_PRESET_ROOT = fileURLToPath(new URL('../presets/', import.meta.url))

/** Preset id for the main-session Orchestrator (model A). */
export const SPECDEV_ORCHESTRATOR_PRESET_ID = 'specdev-orchestrator'

/** Role preset id for a SpecDev role label (e.g. \`implementer\` → \`specdev-implementer\`). */
export function rolePresetId(role: string): string {
  return role.startsWith('specdev-') ? role : `specdev-${role}`
}

/** Every shipped SpecDev preset directory name. */
export const SPECDEV_PRESET_IDS = [
  'specdev-orchestrator',
  'specdev-requirement-analyst',
  'specdev-plan-generator',
  'specdev-code-explorer',
  'specdev-implementer',
  'specdev-reviewer-correctness',
  'specdev-reviewer-design',
  'specdev-reviewer-connectivity',
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
  static inject = [] as const

  static Config = Schema.object({})

  /** Absolute presets directory for \`agent-presets\` roots. */
  readonly presetRoot = SPECDEV_PRESET_ROOT

  /** Default roster preset id for SpecDev sdk sessions. */
  readonly orchestratorPresetId = SPECDEV_ORCHESTRATOR_PRESET_ID

  constructor(ctx: Context) {
    super(ctx, 'specdevPresets')
  }
}

export default SpecdevPresetsService
