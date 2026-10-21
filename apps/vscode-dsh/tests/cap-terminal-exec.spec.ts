import { describe, expect, it, vi } from 'vitest'
import {
  IdeTerminalExecController,
  type TerminalCommandRunner,
  type TerminalExecSend,
  type TerminalExecTerminal,
  type TerminalExecWindow,
  type TerminalRunRequest,
} from '../src/terminal-exec.ts'
import type { BridgeFrame } from '@deepseek-ai/dsh-ide-bridge'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      setTimeout(poll, 10)
    }
    poll()
  })
}

/** A terminal that records what the controller typed and whether it was disposed. */
interface FakeTerminal extends TerminalExecTerminal {
  texts: string[]
  disposed: boolean
  shown: boolean
}

function fakeTerminal(name: string): FakeTerminal {
  return {
    name,
    texts: [],
    disposed: false,
    shown: false,
    sendText(text: string) { this.texts.push(text) },
    show() { this.shown = true },
    dispose() { this.disposed = true },
  }
}

function fakeWindow(): TerminalExecWindow & { created: FakeTerminal[] } {
  const created: FakeTerminal[] = []
  return {
    created,
    get terminals() { return created.filter(terminal => !terminal.disposed) },
    createTerminal({ name }: { name: string }) {
      const terminal = fakeTerminal(name)
      created.push(terminal)
      return terminal
    },
  }
}

/** A runner whose behavior is supplied per call index. */
class FakeRunner implements TerminalCommandRunner {
  readonly requests: TerminalRunRequest[] = []

  constructor(
    private readonly behavior: (request: TerminalRunRequest, index: number) => Promise<number | null>,
  ) {}

  run(request: TerminalRunRequest): Promise<number | null> {
    const index = this.requests.length
    this.requests.push(request)
    return this.behavior(request, index)
  }
}

function execFrame(
  overrides: Partial<{ id: string; command: string; cwd: string; dedicated: boolean; sessionId: string; timeoutMs: number }> = {},
): BridgeFrame {
  return {
    kind: 'terminal/exec',
    id: overrides.id ?? 't-1',
    command: overrides.command ?? 'echo hi',
    cwd: overrides.cwd ?? '/w',
    dedicated: overrides.dedicated ?? false,
    ...('sessionId' in overrides ? { sessionId: overrides.sessionId } : {}),
    ...('timeoutMs' in overrides ? { timeoutMs: overrides.timeoutMs } : {}),
  }
}

function recorder(): { sent: BridgeFrame[]; send: TerminalExecSend } {
  const sent: BridgeFrame[] = []
  return { sent, send: (frame) => { sent.push(frame); return true } }
}

function outputText(sent: readonly BridgeFrame[]): string {
  return sent
    .filter(frame => frame.kind === 'terminal/exec/output')
    .map(frame => (frame as { data: string }).data)
    .join('')
}

function frameOf(sent: readonly BridgeFrame[], kind: BridgeFrame['kind']): { id: string; exitCode?: number | null; error?: string } {
  const frame = sent.find(candidate => candidate.kind === kind)
  if (frame === undefined) throw new Error(`no ${kind} frame was sent`)
  return frame as { id: string; exitCode?: number | null; error?: string }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cap:terminal-exec — IDE terminal execution controller', () => {
  it('handle returns false for non-terminal frames', () => {
    const controller = new IdeTerminalExecController(fakeWindow(), { runner: new FakeRunner(async () => 0) })
    const send = vi.fn<TerminalExecSend>(() => true)
    expect(controller.handle({ kind: 'hello', role: 'runtime' }, send)).toBe(false)
    expect(send).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('starts the command, streams output, and reports its exit code', async () => {
    const runner = new FakeRunner(async (request) => {
      request.onOutput('hi\n')
      return 0
    })
    const controller = new IdeTerminalExecController(fakeWindow(), { runner })
    const { sent, send } = recorder()

    controller.handle(execFrame({ id: 't-1' }), send)
    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/exit'), 3000)

    expect(frameOf(sent, 'terminal/exec/started').id).toBe('t-1')
    expect(frameOf(sent, 'terminal/exec/exit').exitCode).toBe(0)
    expect(outputText(sent)).toBe('hi\n')
    expect(runner.requests[0]!.command).toBe('echo hi')
    expect(runner.requests[0]!.cwd).toBe('/w')

    controller.dispose()
  })

  it('fails the execution when the runner reports a dead terminal', async () => {
    const runner = new FakeRunner(async (request) => {
      request.terminal.dispose()
      throw new Error('the IDE terminal did not run this command within 20ms; the terminal was reset')
    })
    const win = fakeWindow()
    const controller = new IdeTerminalExecController(win, { runner })
    const { sent, send } = recorder()

    controller.handle(execFrame({ id: 't-dead', timeoutMs: 20 }), send)
    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/refused'), 3000)

    expect(frameOf(sent, 'terminal/exec/refused').error).toContain('the terminal was reset')
    expect(win.created[0]!.disposed).toBe(true)
    expect(sent.some(frame => frame.kind === 'terminal/exec/exit')).toBe(false)

    controller.dispose()
  })

  it('runs a queued command on a fresh terminal after the first one is reset', async () => {
    const runner = new FakeRunner(async (request, index) => {
      if (index === 0) {
        request.terminal.dispose()
        throw new Error('the IDE terminal did not run this command; the terminal was reset')
      }
      request.onOutput('hi\n')
      return 0
    })
    const win = fakeWindow()
    const controller = new IdeTerminalExecController(win, { runner })
    const { sent, send } = recorder()

    controller.handle(execFrame({ id: 't-first', command: 'ls -la', timeoutMs: 30 }), send)
    controller.handle(execFrame({ id: 't-second', command: 'echo hi', timeoutMs: 30 }), send)

    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/exit' && (frame as { id: string }).id === 't-second'), 3000)
    expect(win.created.length).toBe(2)
    expect(win.created[0]!.disposed).toBe(true)
    expect(outputText(sent)).toContain('hi\n')

    controller.dispose()
  })

  it('runs a background command in a dedicated terminal without queueing', async () => {
    const runner = new FakeRunner(async (request) => {
      request.onOutput('tick\n')
      return 0
    })
    const win = fakeWindow()
    const controller = new IdeTerminalExecController(win, { runner })
    const { sent, send } = recorder()

    controller.handle(execFrame({ id: 't-bg', command: 'sleep 99; echo tick', dedicated: true }), send)
    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/exit'), 3000)

    expect(win.created[0]!.name.startsWith('DSH bg · ')).toBe(true)
    expect(win.created[0]!.shown).toBe(true)

    controller.dispose()
  })

  it('reuses the shared terminal for consecutive foreground commands', async () => {
    const runner = new FakeRunner(async (request) => {
      request.onOutput('ok\n')
      return 0
    })
    const win = fakeWindow()
    const controller = new IdeTerminalExecController(win, { runner })
    const { sent, send } = recorder()

    controller.handle(execFrame({ id: 't-1' }), send)
    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/exit' && (frame as { id: string }).id === 't-1'), 3000)
    controller.handle(execFrame({ id: 't-2' }), send)
    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/exit' && (frame as { id: string }).id === 't-2'), 3000)

    expect(win.created.length).toBe(1)

    controller.dispose()
  })

  it('passes the frame deadline and dedicated flag to the runner', async () => {
    const runner = new FakeRunner(async () => 0)
    const controller = new IdeTerminalExecController(fakeWindow(), { runner })
    const { sent, send } = recorder()

    controller.handle(execFrame({ id: 't-meta', timeoutMs: 1234, dedicated: false }), send)
    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/exit'), 3000)

    expect(runner.requests[0]!.timeoutMs).toBe(1234)
    expect(runner.requests[0]!.dedicated).toBe(false)

    controller.dispose()
  })

  it('sends Ctrl-C and aborts the runner on a cancel frame', async () => {
    const runner = new FakeRunner(async (request) => {
      await new Promise<void>((resolve) => { request.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return null
    })
    const win = fakeWindow()
    const controller = new IdeTerminalExecController(win, { runner })
    const { sent, send } = recorder()

    controller.handle(execFrame({ id: 't-kill' }), send)
    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/started'), 3000)
    controller.handle({ kind: 'terminal/exec/cancel', id: 't-kill', reason: 'killed' }, send)
    await waitFor(() => win.created[0]!.texts.includes('\u0003'), 3000)

    expect(win.created[0]!.texts).toContain('\u0003')

    controller.dispose()
  })

  it('refuses a command after disposal and settles running entries on abandonAll', async () => {
    const runner = new FakeRunner(async (request) => {
      await new Promise<void>((resolve) => { request.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return null
    })
    const controller = new IdeTerminalExecController(fakeWindow(), { runner })
    const { sent, send } = recorder()

    controller.handle(execFrame({ id: 't-live' }), send)
    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/started'), 3000)
    controller.abandonAll()
    await waitFor(() => sent.some(frame => frame.kind === 'terminal/exec/exit'), 3000)

    controller.dispose()
    controller.handle(execFrame({ id: 't-after' }), send)
    expect(sent.some(frame => frame.kind === 'terminal/exec/refused' && (frame as { id: string }).id === 't-after')).toBe(true)
  })
})
