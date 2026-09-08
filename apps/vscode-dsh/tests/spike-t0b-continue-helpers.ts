/**
 * Spike T-0b helpers: continueCapability probe, from→to link sketch, and a
 * minimal mock LLM adapter for L1 persistentHarness (no product UI).
 */

import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'

/** AD-CU-8 / AC-28 capability values — never a binary 只读/可继续. */
export type ContinueCapability = 'same-id' | 'derive-only' | 'unknown'

/** Gate T-0b outcomes that feed the probe (AC-28 / AC-68). */
export type ContinueGateVerdict = 'same-id' | 'derive-only' | 'FAIL' | 'NOT_RUN'

/** Durable association for derive-only 「新会话 · 接续自 …」(AC-67). */
export interface ContinueLink {
  readonly fromId: SessionId
  readonly toId: SessionId
}

export interface ContinueCapabilityProbeInput {
  /** Spike Gate verdict; NOT_RUN / FAIL → fail-closed `unknown`. */
  readonly gateVerdict: ContinueGateVerdict
  /** Session present on authoritative storage (`stat` / list). */
  readonly sessionExists: boolean
  /** `ctx.agents.resume` is mounted in this composition. */
  readonly resumeApiAvailable: boolean
}

/**
 * Map Gate + session facts to list/Continue capability (AD-CU-8).
 * List hint and top-bar Continue stay decoupled at UI layer; this returns the
 * capability token only.
 *
 * @param input - gate verdict, session existence, resume API presence.
 * @returns `same-id` | `derive-only` | `unknown`.
 */
export function probeContinueCapability(input: ContinueCapabilityProbeInput): ContinueCapability {
  if (input.gateVerdict === 'FAIL' || input.gateVerdict === 'NOT_RUN') return 'unknown'
  if (!input.sessionExists) return 'unknown'
  if (input.gateVerdict === 'same-id' && input.resumeApiAvailable) return 'same-id'
  if (input.gateVerdict === 'derive-only') return 'derive-only'
  return 'unknown'
}

/**
 * Build an Extension-index style continue link after a successful derive.
 *
 * @param fromId - parent / source session id.
 * @param toId - newly created child session id.
 * @returns link sufficient for 「新会话 · 接续自 …」 banner.
 */
export function continueLinkFromDerive(fromId: SessionId, toId: SessionId): ContinueLink {
  return { fromId, toId }
}

/**
 * Assert committed prefix immutability (AC-66): first `prefix.length` events
 * after a continue path must deep-equal the snapshot taken before append.
 *
 * @param before - events frozen after writer retire / before continue.
 * @param after - events after resume/derive + further appends.
 * @returns true when the old prefix is byte/event-equal.
 */
export function prefixUnchanged(
  before: readonly SessionEvent[],
  after: readonly SessionEvent[],
): boolean {
  if (after.length < before.length) return false
  return JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before)
}

/** Scripted text stream for one model call (mirrors agent-loop MockAdapter). */
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * Minimal mock adapter: each generate consumes the next scripted chunk list.
 * Lives in the Spike tree so apps/vscode-dsh does not import agent-loop tests.
 */
export class SpikeMockAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(private script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const next = this.script.shift()
    if (next === undefined) {
      throw new Error('SpikeMockAdapter: no more scripted responses')
    }
    for (const chunk of next) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}
