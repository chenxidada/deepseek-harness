/**
 * Layer B — Phase 2 Host wiring: parentTitle history rows + confirmed delete path.
 */
import { describe, expect, it } from 'vitest'
import { ExtensionIndex } from '../src/extension-index.ts'
import { parseWebviewToHostMessage } from '../src/chat-panel/protocol.ts'

describe('phase-2 host wiring (parentTitle + delete-request)', () => {
  it('listHistorySessions projects parentTitle from parentSessionId / forkLabel', () => {
    const index = new ExtensionIndex('/ws')
    index.upsertSession({
      sessionId: 'parent',
      title: 'Parent Chat',
      mtime: 2,
    })
    index.upsertSession({
      sessionId: 'child',
      title: 'Child Chat',
      mtime: 3,
      parentSessionId: 'parent',
      forkLabel: '派生自 Parent Chat',
      continueCapability: 'same-id',
    })
    const rows = index.listHistorySessions()
    const child = rows.find(r => r.sessionId === 'child')
    expect(child?.parentTitle).toBe('Parent Chat')
    expect(child?.continueHint).toMatch(/可继续/)
  })

  it('parses ui/delete-request and ui/open-timeline intents', () => {
    expect(parseWebviewToHostMessage({
      type: 'ui/delete-request',
      sessionId: 's1',
    })).toEqual({ type: 'ui/delete-request', sessionId: 's1' })
    expect(parseWebviewToHostMessage({ type: 'ui/open-timeline' }))
      .toEqual({ type: 'ui/open-timeline' })
    expect(parseWebviewToHostMessage({ type: 'ui/delete-request' })).toBeUndefined()
  })
})
