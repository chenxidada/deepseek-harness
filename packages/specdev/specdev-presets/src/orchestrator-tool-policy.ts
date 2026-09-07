/**
 * Standing-mount plugin for the SpecDev Orchestrator preset: narrows tools so
 * joined Orchestrator agents cannot write/edit application source (AC-22).
 *
 * @module @deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { applyOrchestratorToolPolicy } from './tool-policy.ts'

export const name = 'specdev-orchestrator-tool-policy'
export const inject = ['tools']

/**
 * Restrict + guard on the standing mount scope (inherited by joined agents).
 * @param ctx - standing preset context (scoped).
 */
export function apply(ctx: Context): void {
  applyOrchestratorToolPolicy(ctx)
}
