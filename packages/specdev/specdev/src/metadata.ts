/**
 * SpecDev role / slug / phaseId metadata attach helpers for AgentOptions.
 *
 * @module @deepseek-ai/dsh-specdev/metadata
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  SPECDEV_META,
  SPECDEV_ROLES,
  type SpecdevRole,
} from './types.ts'

/** Options accepted by {@link attachSpecdevMetadata}. */
export interface SpecdevMetadataAttach {
  readonly role: SpecdevRole
  readonly slug: string
  readonly phaseId?: string
}

/**
 * Validate and return a SpecDev role string.
 * @param value - untrusted role candidate.
 */
export function parseSpecdevRole(value: unknown): SpecdevRole {
  if (typeof value !== 'string' || !(SPECDEV_ROLES as readonly string[]).includes(value)) {
    throw new TypeError(`specdev.role must be one of: ${SPECDEV_ROLES.join(', ')}`)
  }
  return value as SpecdevRole
}

/**
 * Attach SpecDev metadata fields onto a live agent's options object.
 * Mutates `agent.options` in place (harness AgentOptions is a plain bag).
 * @param agent - live agent receiving metadata.
 * @param meta - role / slug / optional phaseId.
 * @returns the same agent for chaining.
 */
export function attachSpecdevMetadata(agent: Agent, meta: SpecdevMetadataAttach): Agent {
  const role = parseSpecdevRole(meta.role)
  if (typeof meta.slug !== 'string' || meta.slug.trim().length === 0) {
    throw new TypeError('specdev.slug must be a non-empty string')
  }
  agent.options[SPECDEV_META.role] = role
  agent.options[SPECDEV_META.slug] = meta.slug.trim()
  if (meta.phaseId !== undefined) {
    if (typeof meta.phaseId !== 'string' || meta.phaseId.trim().length === 0) {
      throw new TypeError('specdev.phaseId must be a non-empty string when provided')
    }
    agent.options[SPECDEV_META.phaseId] = meta.phaseId.trim()
  } else {
    // Static key: clears without triggering no-dynamic-delete.
    delete agent.options['specdev.phaseId']
  }
  return agent
}

/**
 * Read SpecDev metadata from an agent, if present.
 * @param agent - agent to inspect.
 */
export function readSpecdevMetadata(agent: Agent): {
  role?: SpecdevRole
  slug?: string
  phaseId?: string
} {
  const role = agent.options[SPECDEV_META.role]
  const slug = agent.options[SPECDEV_META.slug]
  const phaseId = agent.options[SPECDEV_META.phaseId]
  return {
    ...role === undefined ? {} : { role: parseSpecdevRole(role) },
    ...typeof slug === 'string' && slug.length > 0 ? { slug } : {},
    ...typeof phaseId === 'string' && phaseId.length > 0 ? { phaseId } : {},
  }
}
