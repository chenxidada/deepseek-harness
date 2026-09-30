/**
 * SpecDev role metadata attached to agent options: the runtime validation the
 * attach path applies to untrusted role / slug / phaseId values, and the
 * partial reads that tolerate an agent carrying only some of them.
 */

import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  attachSpecdevMetadata,
  parseSpecdevRole,
  readSpecdevMetadata,
  SPECDEV_META,
  SPECDEV_ROLES,
} from '@deepseek-ai/dsh-specdev'

/** An agent-shaped options bag; metadata helpers touch nothing else. */
function optionBag(initial: Record<string, unknown> = {}): Agent {
  return { options: { ...initial } } as unknown as Agent
}

describe('parseSpecdevRole', () => {
  it('accepts every published role and refuses anything else', () => {
    for (const role of SPECDEV_ROLES) expect(parseSpecdevRole(role)).toBe(role)
    expect(() => parseSpecdevRole('reviewer-unknown')).toThrow(/specdev.role must be one of/)
    expect(() => parseSpecdevRole(7)).toThrow(TypeError)
  })
})

describe('attachSpecdevMetadata', () => {
  it('attaches role, slug, and phaseId and returns the same agent', () => {
    const agent = optionBag()
    expect(attachSpecdevMetadata(agent, { role: 'verifier', slug: ' wf ', phaseId: ' p1 ' })).toBe(agent)
    expect(agent.options[SPECDEV_META.role]).toBe('verifier')
    expect(agent.options[SPECDEV_META.slug]).toBe('wf')
    expect(agent.options[SPECDEV_META.phaseId]).toBe('p1')
  })

  it('refuses an invalid role, slug, or phaseId', () => {
    const agent = optionBag()
    expect(() => attachSpecdevMetadata(agent, { role: 'nope' as never, slug: 'wf' }))
      .toThrow(/specdev.role must be one of/)
    expect(() => attachSpecdevMetadata(agent, { role: 'verifier', slug: '   ' }))
      .toThrow(/specdev.slug must be a non-empty string/)
    expect(() => attachSpecdevMetadata(agent, { role: 'verifier', slug: 7 as unknown as string }))
      .toThrow(/specdev.slug must be a non-empty string/)
    expect(() => attachSpecdevMetadata(agent, { role: 'verifier', slug: 'wf', phaseId: ' ' }))
      .toThrow(/specdev.phaseId must be a non-empty string/)
  })

  it('clears a previously attached phaseId when none is given', () => {
    const agent = optionBag({ [SPECDEV_META.phaseId]: 'p1' })
    attachSpecdevMetadata(agent, { role: 'verifier', slug: 'wf' })
    expect(SPECDEV_META.phaseId in agent.options).toBe(false)
  })
})

describe('readSpecdevMetadata', () => {
  it('reads each field independently and drops empty ones', () => {
    expect(readSpecdevMetadata(optionBag())).toEqual({})
    expect(readSpecdevMetadata(optionBag({ [SPECDEV_META.slug]: '', [SPECDEV_META.phaseId]: 7 }))).toEqual({})
    expect(readSpecdevMetadata(optionBag({
      [SPECDEV_META.role]: 'implementer',
      [SPECDEV_META.slug]: 'wf',
    }))).toEqual({ role: 'implementer', slug: 'wf' })
  })

  it('refuses a role value that is not a published role', () => {
    expect(() => readSpecdevMetadata(optionBag({ [SPECDEV_META.role]: 'nope' })))
      .toThrow(/specdev.role must be one of/)
  })
})
