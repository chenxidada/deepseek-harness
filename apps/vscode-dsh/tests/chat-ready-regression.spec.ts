/**
 * vscode-dsh-chat-ready Feature regression matrix documentation (AC-R1).
 *
 * Programmable evidence lives in the named phase suites below.
 * One-command entry (preferred):
 *   bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh
 *
 * Matrix (Must paths):
 * | Segment            | AC / path                         | Suite file                              |
 * |--------------------|-----------------------------------|-----------------------------------------|
 * | Auto-start         | AC-1a reverse; AC-1d/6a slice     | auto-start-orchestrator + phase1       |
 * | Auto-ready         | AC-3/4/4a/6/7 view-visible        | phase2-auto-ready                       |
 * | Chat UI chassis    | AC-8/12/16/16a/17/19              | phase3-chat-ui-chassis                  |
 * | New chrome         | AC-15/22/24/6                     | phase4-new-conversation-chrome          |
 * | Polish             | AC-28…32, AC-34                   | phase5-should-polish                    |
 * | Prior behavior     | AC-27 sample                      | phase3-restart-continue / multitab / close |
 *
 * This file intentionally holds only a smoke assert that the documented
 * regression entry exists — full behavior coverage stays in the phase suites
 * (avoid duplicating hundreds of cases here).
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('chat-ready-regression (AC-R1 entry)', () => {
  it('documents and keeps the one-command regression script on disk', () => {
    const script = resolve(
      import.meta.dirname,
      '../test-scripts/run-chat-ready-regression.sh',
    )
    expect(existsSync(script)).toBe(true)
  })
})
