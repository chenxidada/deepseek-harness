/**
 * SpecDev gate progression: what follows a Human Gate decision is state-machine
 * behavior, not a command's. A final Feature HG-3 pass (`snapshot.phase === null`)
 * auto-dispatches the wiki role, so the same decision applied from the panel, the
 * IDE bridge, or a direct `confirmGate` call reaches the same next step.
 *
 * @module @deepseek-ai/dsh-specdev/progression
 */

import type { Context } from '@deepseek-ai/cordis'
import { dispatchWiki, isFinalFeatureHg3Pass } from './wiki.ts'

/**
 * Install the gate-decision progression listener.
 *
 * The listener fires on the appended `specdev/gate-decided` session event and
 * never mutates gate state itself: a failed dispatch is logged and the workflow
 * stays where the decision left it.
 *
 * @param ctx - host context that owns the SpecDev service.
 */
export function installGateProgression(ctx: Context): void {
  ctx.root.on('session/event', (session, event) => {
    if (event.type !== 'specdev/gate-decided') return
    if (!isFinalFeatureHg3Pass(event.data.gate, event.data.decision, event.data.snapshot)) return
    const slug = event.data.snapshot.slug
    const parent = ctx.get('agents')?.get(session.id)
    if (parent === undefined) return
    void dispatchWiki(ctx, parent, { slug, mode: 'pipeline' }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`specdev: final HG-3 wiki auto-dispatch failed: ${message}`)
    })
  })
}
