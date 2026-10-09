import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  IdeTerminalExecController,
  type TerminalExecWindow,
  type TerminalExecTerminal,
  type TerminalExecShellIntegration,
  type TerminalExecExecution,
  type TerminalExecSend,
} from '../src/terminal-exec.ts'
import type { BridgeFrame } from '@deepseek-ai/dsh-ide-bridge'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** An async iterable that yields the given chunks. */
async function* iterableOf(...chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out'))
        return
      }
      setTimeout(poll, 20)
    }
    poll()
  })
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Build a terminal whose shell integration is immediately available. */
function fakeTerminal(name: string): TerminalExecTerminal & {
  integration: TerminalExecShellIntegration
  executions: TerminalExecExecution[]
  texts: string[]
  disposed: boolean
} {
  const executions: TerminalExecExecution[] = []
  const texts: string[] = []
  const integration: TerminalExecShellIntegration = {
    executeCommand(commandLine: string, _cwd?: string) {
      const exec: TerminalExecExecution = { read: () => iterableOf(`output of: ${commandLine}\n`) }
      executions.push(exec)
      return exec
    },
  }
  return {
    name,
    shellIntegration: integration,
    integration,
    executions,
    texts,
    disposed: false,
    sendText(text: string) { texts.push(text) },
    show() {},
    dispose() { this.disposed = true },
  }
}

type IntegrationListener = (event: { terminal: TerminalExecTerminal; shellIntegration: TerminalExecShellIntegration }) => void
type EndListener = (event: { execution: TerminalExecExecution; exitCode: number | undefined }) => void

/**
 * Build a fake window that creates fake terminals with immediate integration.
 * Shell integration is already set on the terminal, so `awaitIntegration`
 * resolves synchronously from `terminal.shellIntegration`.
 */
function fakeWindow(): TerminalExecWindow & {
  created: ReturnType<typeof fakeTerminal>[]
  fireEnd: (event: { execution: TerminalExecExecution; exitCode: number | undefined }) => void
} {
  const created: ReturnType<typeof fakeTerminal>[] = []
  let _integrationListener: IntegrationListener = () => {}
  let endListener: EndListener = () => {}
  return {
    created,
    get terminals() { return created.filter(t => !t.disposed) },
    createTerminal({ name }: { name: string }) {
      const t = fakeTerminal(name)
      created.push(t)
      return t
    },
    onDidChangeTerminalShellIntegration(listener: IntegrationListener) {
      _integrationListener = listener
      return { dispose() { _integrationListener = () => {} } }
    },
    onDidEndTerminalShellExecution(listener: EndListener) {
      endListener = listener
      return { dispose() { endListener = () => {} } }
    },
    fireEnd(event: { execution: TerminalExecExecution; exitCode: number | undefined }) {
      endListener(event)
    },
  }
}

/** Build a `terminal/exec` frame. */
function execFrame(
  overrides: Partial<{ id: string; command: string; cwd: string; dedicated: boolean; sessionId: string }> = {},
): BridgeFrame {
  return {
    kind: 'terminal/exec',
    id: overrides.id ?? 't-1',
    command: overrides.command ?? 'echo hi',
    cwd: overrides.cwd ?? '/w',
    dedicated: overrides.dedicated ?? false,
    ...('sessionId' in overrides ? { sessionId: overrides.sessionId } : {}),
  } as BridgeFrame
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cap:terminal-exec — IDE terminal execution controller', () => {
  afterEach(() => { vi.useRealTimers() })

  it('handle returns false for non-terminal frames', () => {
    const win = fakeWindow()
    const ctrl = new IdeTerminalExecController(win)
    const send = vi.fn<TerminalExecSend>(() => true)
    const result = ctrl.handle({ kind: 'hello', version: 1 } as BridgeFrame, send)
    expect(result).toBe(false)
    expect(send).not.toHaveBeenCalled()
    ctrl.dispose()
  })

  it('handle returns true for terminal/exec and sends started + output + exit', async () => {
    const win = fakeWindow()
    const ctrl = new IdeTerminalExecController(win)
    const sent: BridgeFrame[] = []
    const send: TerminalExecSend = (frame) => { sent.push(frame); return true }

    const result = ctrl.handle(execFrame({ id: 't-1' }), send)
    expect(result).toBe(true)

    // Wait for started (runOn is async but shell integration is immediate)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/started'), 3000)
    const startedFrame = sent.find(f => f.kind === 'terminal/exec/started')!
    expect((startedFrame as { id: string }).id).toBe('t-1')

    // Fire the end event for the execution so the controller resolves the exit code
    const terminal = win.created[0]!
    const execution = terminal.executions[0]!
    win.fireEnd({ execution, exitCode: 0 })

    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)

    const outputFrames = sent.filter(f => f.kind === 'terminal/exec/output')
    expect(outputFrames.length).toBeGreaterThanOrEqual(1)

    const exitFrame = sent.find(f => f.kind === 'terminal/exec/exit') as { kind: string; id: string; exitCode: number | null }
    expect(exitFrame.id).toBe('t-1')
    expect(exitFrame.exitCode).toBe(0)

    ctrl.dispose()
  })

  it('creates a dedicated terminal for dedicated: true', async () => {
    const win = fakeWindow()
    const ctrl = new IdeTerminalExecController(win)
    const sent: BridgeFrame[] = []
    const send: TerminalExecSend = (frame) => { sent.push(frame); return true }

    ctrl.handle(execFrame({ id: 't-bg', command: 'sleep 99', dedicated: true }), send)

    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/started'), 3000)
    expect(win.created.length).toBe(1)
    expect(win.created[0]!.name).toContain('bg')

    // Clean up: fire end so runOn finishes
    win.fireEnd({ execution: win.created[0]!.executions[0]!, exitCode: 0 })
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)
    ctrl.dispose()
  })

  it('reuses shared terminal for consecutive non-dedicated commands', async () => {
    const win = fakeWindow()
    const ctrl = new IdeTerminalExecController(win)
    const sent: BridgeFrame[] = []
    const send: TerminalExecSend = (frame) => { sent.push(frame); return true }

    ctrl.handle(execFrame({ id: 't-1', command: 'ls', dedicated: false }), send)
    ctrl.handle(execFrame({ id: 't-2', command: 'pwd', dedicated: false }), send)

    // Both should use the same shared terminal — only 1 created
    expect(win.created.length).toBe(1)

    // Let the first finish, then the second will start
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/started'), 3000)
    win.fireEnd({ execution: win.created[0]!.executions[0]!, exitCode: 0 })
    await waitFor(() => sent.filter(f => f.kind === 'terminal/exec/started').length >= 2, 3000)
    win.fireEnd({ execution: win.created[0]!.executions[1]!, exitCode: 0 })
    await waitFor(() => sent.filter(f => f.kind === 'terminal/exec/exit').length >= 2, 3000)

    // Still only 1 terminal
    expect(win.created.length).toBe(1)
    ctrl.dispose()
  })

  it('handle returns true for terminal/exec/cancel and sends Ctrl-C', async () => {
    const win = fakeWindow()
    const ctrl = new IdeTerminalExecController(win)
    const sent: BridgeFrame[] = []
    const send: TerminalExecSend = (frame) => { sent.push(frame); return true }

    // Start a command first so there is a running entry
    ctrl.handle(execFrame({ id: 't-cancel' }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/started'), 3000)

    // Now cancel it
    const cancelResult = ctrl.handle(
      { kind: 'terminal/exec/cancel', id: 't-cancel', reason: 'timeout' } as BridgeFrame,
      send,
    )
    expect(cancelResult).toBe(true)

    const terminal = win.created[0]!
    expect(terminal.texts).toContain('\x03')

    // Clean up
    win.fireEnd({ execution: terminal.executions[0]!, exitCode: 130 })
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)
    ctrl.dispose()
  })

  it('dispose cleans up terminals and allows no further starts', () => {
    const win = fakeWindow()
    const ctrl = new IdeTerminalExecController(win)
    const send: TerminalExecSend = () => true

    ctrl.handle(execFrame({ id: 't-d' }), send)
    expect(win.created.length).toBe(1)

    ctrl.dispose()
    expect(win.created[0]!.disposed).toBe(true)

    // After dispose, a new handle still returns true (kind matches) but start
    // bails out early because disposed is true — no new terminal is created.
    const sent: BridgeFrame[] = []
    ctrl.handle(execFrame({ id: 't-after' }), (f) => { sent.push(f); return true })
    expect(win.created.length).toBe(1)
  })

  it('abandonAll clears running entries without disposing terminals', async () => {
    const win = fakeWindow()
    const ctrl = new IdeTerminalExecController(win)
    const sent: BridgeFrame[] = []
    const send: TerminalExecSend = (frame) => { sent.push(frame); return true }

    ctrl.handle(execFrame({ id: 't-ab' }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/started'), 3000)

    ctrl.abandonAll()
    // Terminal is still alive for user inspection
    expect(win.created[0]!.disposed).toBe(false)

    // Clean up
    win.fireEnd({ execution: win.created[0]!.executions[0]!, exitCode: 0 })
    ctrl.dispose()
  })
})
