/**
 * Session events recording SpecDev scope requests and the decisions they
 * received, so a replayed session shows what the agent asked to reach and what
 * the user allowed.
 *
 * @module @deepseek-ai/dsh-specdev-guard/events
 */

import type { SpecdevRole } from '@deepseek-ai/dsh-specdev'

/** How far a decision's approval reaches, or why the request produced none. */
export type SpecdevScopeDecision = 'once' | 'directory' | 'session' | 'rejected' | 'cancelled' | 'unavailable'

/** Payload of `specdev/scope-requested`. */
export interface SpecdevScopeRequestedEvent {
  readonly requestId: string
  readonly toolName: string
  readonly access: 'read' | 'write'
  readonly paths: readonly string[]
  readonly recursive: boolean
  readonly role?: SpecdevRole
  readonly reason?: string
}

/** Payload of `specdev/scope-decided`. */
export interface SpecdevScopeDecidedEvent {
  readonly requestId: string
  readonly decision: SpecdevScopeDecision
  readonly paths: readonly string[]
  readonly note?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A tool call named paths outside the workspace and the guard stopped it to
     * ask: `paths` are the resolved paths it could not clear, `access` whether
     * they would be read or written, `recursive` whether a directory traversal
     * named them, `role` the SpecDev role whose call it was, and `reason` the
     * asker's own explanation when the call carried one.
     */
    'specdev/scope-requested': SpecdevScopeRequestedEvent
    /**
     * The user decided a prior `specdev/scope-requested` (same `requestId`):
     * `decision` is how far the approval reaches — this call, the directory, the
     * session, or a refusal — or `cancelled` when the request was abandoned and
     * `unavailable` when no answerer was reachable; `paths` the scope now granted
     * (empty on refusal), and `note` the user's own text when they typed one.
     */
    'specdev/scope-decided': SpecdevScopeDecidedEvent
  }
}
