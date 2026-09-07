/**
 * Orchestrator tool restrict/guard helpers (AC-22).
 *
 * Design model A: `restrict({ allow: [...] })` + guard against business write
 * tools. The allow set is filtered to tools currently present on the host so
 * `tools.restrict` does not throw on unknown names.
 *
 * @module @deepseek-ai/dsh-specdev-presets/tool-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

/**
 * Global tools Orchestrator may inherit when present (inspect / schedule).
 * Explicitly excludes business write tools (`write` / `edit` / `str_replace_editor`).
 *
 * Scope-local tools registered by the Orchestrator preset (e.g. `grep`/`glob`
 * from `tool-fs-search`) remain visible regardless of this list.
 */
export const ORCHESTRATOR_ALLOW = [
  'read',
  'read_image',
  'grep',
  'glob',
  'bash',
] as const

/** Tool names that edit application source — always blocked by guard (defense in depth). */
const ORCHESTRATOR_WRITE_BLOCK = ['write', 'edit', 'str_replace_editor'] as const

/**
 * Apply Orchestrator tool narrowing on a scoped agent (or standing) context.
 * @param ctx - scoped tools context (agent.ctx or standing mount ctx).
 */
export function applyOrchestratorToolPolicy(ctx: Context): void {
  const known = new Set(ctx.tools.schemas().map(schema => schema.name))
  const allowExisting = ORCHESTRATOR_ALLOW.filter(name => known.has(name))
  if (allowExisting.length > 0) {
    ctx.tools.restrict({ allow: [...allowExisting] })
  }
  ctx.tools.guard((exec) => {
    for (const blocked of ORCHESTRATOR_WRITE_BLOCK) {
      if (exec.name === blocked) {
        return 'SpecDev Orchestrator must not edit application source (AC-22)'
      }
    }
    return undefined
  })
}
