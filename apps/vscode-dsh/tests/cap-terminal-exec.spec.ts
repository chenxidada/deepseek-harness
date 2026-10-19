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

/** The marker the controller embedded in one command line. */
function markerOf(commandLine: string): string {
  return /'__DSH_DONE_' '([0-9a-f]+)'/.exec(commandLine)?.[1] ?? ''
}

/** Everything one run streamed to the runtime as command output. */
function outputText(sent: readonly BridgeFrame[]): string {
  return sent
    .filter(frame => frame.kind === 'terminal/exec/output')
    .map(frame => (frame as { data: string }).data)
    .join('')
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** What the fake shell does for one `executeCommand`. */
interface FakeExecOptions {
  /** Output printed before the status sentinel. */
  output?: string
  /** Explicit raw chunks, replacing the generated echo/output/sentinel sequence. */
  chunks?: (commandLine: string) => string[]
  /** Status the sentinel reports; `undefined` prints no sentinel at all. */
  exitCode?: number
  /** Emit the wrapper echo first, as a real terminal does (default true). */
  echo?: boolean
  /** Leave the output stream open, so the execution keeps running. */
  pending?: boolean
  /** Fail the output stream with this message instead of ending it. */
  failOutput?: string
}

/** Build a terminal whose shell integration is immediately available. */
function fakeTerminal(
  name: string,
  options: FakeExecOptions = {},
  onExecute?: (execution: TerminalExecExecution) => void,
): TerminalExecTerminal & {
  integration: TerminalExecShellIntegration
  executions: TerminalExecExecution[]
  lines: string[]
  cwdArgs: (string | undefined)[]
  texts: string[]
  disposed: boolean
} {
  const executions: TerminalExecExecution[] = []
  const lines: string[] = []
  const cwdArgs: (string | undefined)[] = []
  const texts: string[] = []
  const integration: TerminalExecShellIntegration = {
    executeCommand(commandLine: string, cwd?: string) {
      lines.push(commandLine)
      cwdArgs.push(cwd)
      const exec: TerminalExecExecution = { read: () => readOf(commandLine, options) }
      executions.push(exec)
      onExecute?.(exec)
      return exec
    },
  }
  return {
    name,
    shellIntegration: integration,
    integration,
    executions,
    lines,
    cwdArgs,
    texts,
    disposed: false,
    sendText(text: string) { texts.push(text) },
    show() {},
    dispose() { this.disposed = true },
  }
}

/** The output stream one fake execution produces. */
async function* readOf(commandLine: string, options: FakeExecOptions): AsyncIterable<string> {
  if (options.failOutput !== undefined) throw new Error(options.failOutput)
  if (options.chunks !== undefined) {
    for (const chunk of options.chunks(commandLine)) yield chunk
    return
  }
  if (options.echo ?? true) yield `${commandLine}\r\n`
  if (options.output !== undefined && options.output !== '') yield options.output
  await Promise.resolve()
  if (options.pending === true) return await new Promise<never>(() => {})
  if (options.exitCode !== undefined) {
    yield `\n__DSH_DONE_${markerOf(commandLine)}:${options.exitCode}__\n`
  }
}

type IntegrationListener = (event: { terminal: TerminalExecTerminal; shellIntegration: TerminalExecShellIntegration }) => void
type EndListener = (event: {
  terminal: TerminalExecTerminal
  execution: TerminalExecExecution
  exitCode: number | undefined
}) => void

/**
 * Build a fake window that creates fake terminals with immediate integration.
 * Shell integration is already set on the terminal, so `awaitIntegration`
 * resolves synchronously from `terminal.shellIntegration`.
 */
function fakeWindow(options: {
  exec?: FakeExecOptions
  /** Fired inside `executeCommand`, before it returns, to pin the start race. */
  onExecute?: (execution: TerminalExecExecution, fireEnd: EndListener) => void
} = {}): TerminalExecWindow & {
  created: ReturnType<typeof fakeTerminal>[]
  fireEnd: EndListener
} {
  const created: ReturnType<typeof fakeTerminal>[] = []
  let endListener: EndListener = () => {}
  const fireEnd: EndListener = (event) => { endListener(event) }
  return {
    created,
    get terminals() { return created.filter(t => !t.disposed) },
    createTerminal({ name }: { name: string }) {
      const t = fakeTerminal(
        name,
        options.exec ?? {},
        options.onExecute === undefined ? undefined : (exec) => { options.onExecute?.(exec, fireEnd) },
      )
      created.push(t)
      return t
    },
    onDidChangeTerminalShellIntegration(_listener: IntegrationListener) {
      // Every fake terminal carries its integration up front, so the controller
      // never waits on this event; the subscription only has to be disposable.
      return { dispose() {} }
    },
    onDidEndTerminalShellExecution(listener: EndListener) {
      endListener = listener
      return { dispose() { endListener = () => {} } }
    },
    fireEnd,
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
  }
}

/** Sink that records what the controller sent. */
function recorder(): { sent: BridgeFrame[]; send: TerminalExecSend } {
  const sent: BridgeFrame[] = []
  return { sent, send: (frame) => { sent.push(frame); return true } }
}

/** The single frame of one kind this run sent. */
function frameOf(sent: readonly BridgeFrame[], kind: BridgeFrame['kind']): { id: string; exitCode?: number | null; error?: string } {
  const frame = sent.find(candidate => candidate.kind === kind)
  if (frame === undefined) throw new Error(`no ${kind} frame was sent`)
  return frame as { id: string; exitCode?: number | null; error?: string }
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
    // The runtime's own connect frame, which is not part of the terminal-exec family.
    const result = ctrl.handle({ kind: 'hello', role: 'runtime' }, send)
    expect(result).toBe(false)
    expect(send).not.toHaveBeenCalled()
    ctrl.dispose()
  })

  it('handle returns true for terminal/exec and sends started + output + exit', async () => {
    const win = fakeWindow({ exec: { output: 'hi\n', exitCode: 0 } })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    const result = ctrl.handle(execFrame({ id: 't-1' }), send)
    expect(result).toBe(true)

    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/started'), 3000)
    expect(frameOf(sent, 'terminal/exec/started').id).toBe('t-1')

    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)
    expect(sent.filter(f => f.kind === 'terminal/exec/output').length).toBeGreaterThanOrEqual(1)
    expect(frameOf(sent, 'terminal/exec/exit').exitCode).toBe(0)
    expect(outputText(sent)).toContain('hi\n')

    ctrl.dispose()
  })

  it('settles from the status sentinel when no end event ever arrives', async () => {
    const win = fakeWindow({ exec: { output: 'file-a\nfile-b\n', exitCode: 7 } })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-sentinel', command: 'ls' }), send)
    // Only the sentinel settles this execution: the fake never fires an end event.
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)

    expect(frameOf(sent, 'terminal/exec/exit').exitCode).toBe(7)
    const output = outputText(sent)
    expect(output).toContain('file-a\nfile-b')
    // The echoed wrapper line and the sentinel itself never reach the runtime.
    expect(output).not.toContain('__DSH_DONE_')
    expect(output).not.toContain('printf')
    expect(output).not.toContain('cd ')

    ctrl.dispose()
  })

  it('parses a status sentinel split across output chunks', async () => {
    const win = fakeWindow({
      exec: {
        chunks: (line) => {
          const marker = markerOf(line)
          return [`${line}\r\n`, 'partial', `\n__DSH_DONE_${marker.slice(0, 9)}`, `${marker.slice(9)}:3`, '__\n']
        },
      },
    })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-split', command: 'ls' }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)

    expect(frameOf(sent, 'terminal/exec/exit').exitCode).toBe(3)
    const output = outputText(sent)
    expect(output).toContain('partial')
    expect(output).not.toContain('__DSH_DONE_')

    ctrl.dispose()
  })

  it('parses sentinel when ANSI/OSC escape sequences wrap it', async () => {
    const win = fakeWindow({
      exec: {
        chunks: (line) => {
          const marker = markerOf(line)
          // Simulate VS Code shell integration injecting OSC 633 sequences
          // around and within the sentinel output line.
          return [
            `${line}\r\n`,
            'file-a\nfile-b\n',
            `\x1b]633;C\x07\n__DSH_DONE_${marker}:0__\n\x1b]633;D;0\x07`,
          ]
        },
      },
    })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-ansi', command: 'ls' }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)

    expect(frameOf(sent, 'terminal/exec/exit').exitCode).toBe(0)
    const output = outputText(sent)
    expect(output).toContain('file-a\nfile-b')
    expect(output).not.toContain('__DSH_DONE_')
    expect(output).not.toContain('\x1b')

    ctrl.dispose()
  })

  it('settles with a null exit code when the stream drains without a sentinel or end event', async () => {
    const win = fakeWindow({ exec: { output: 'no status here\n' } })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-lag' }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 8000)

    expect(frameOf(sent, 'terminal/exec/exit').exitCode).toBeNull()
    expect(outputText(sent)).toContain('no status here')

    ctrl.dispose()
  })

  it('observes an end event that fires before the execution is awaited', async () => {
    const win = fakeWindow({
      exec: { pending: true },
      onExecute: (execution, fireEnd) => {
        // The window reports the end inside executeCommand, before runOn holds
        // the execution: a listener registered after the call would lose it.
        fireEnd({ terminal: win.created[0]!, execution, exitCode: 42 })
      },
    })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-race' }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)

    expect(frameOf(sent, 'terminal/exec/exit').exitCode).toBe(42)

    ctrl.dispose()
  })

  it('fails the execution when the output stream throws', async () => {
    const win = fakeWindow({ exec: { failOutput: 'stream broke' } })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-fail' }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/refused'), 3000)

    expect(frameOf(sent, 'terminal/exec/refused').error).toContain('stream broke')
    expect(sent.some(f => f.kind === 'terminal/exec/exit')).toBe(false)

    ctrl.dispose()
  })

  it('enters the working directory with an explicit cd instead of executeCommand cwd', async () => {
    const win = fakeWindow({ exec: { exitCode: 0 } })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-cd', command: 'echo hi', cwd: "/w/it's here" }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)

    const terminal = win.created[0]!
    // VS Code renders the cwd argument of `executeCommand` as a character-spaced
    // path that the shell reads as extra arguments, so the directory must travel
    // in the command line itself, quoted as one word.
    expect(terminal.lines[0]!.startsWith("cd '/w/it'\\''s here' && { echo hi\n}; printf ")).toBe(true)
    expect(terminal.cwdArgs[0]).toBeUndefined()

    ctrl.dispose()
  })

  it('creates a dedicated terminal for dedicated: true', async () => {
    const win = fakeWindow({ exec: { exitCode: 0 } })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-bg', command: 'sleep 99', dedicated: true }), send)

    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/started'), 3000)
    expect(win.created.length).toBe(1)
    expect(win.created[0]!.name).toContain('bg')

    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 3000)
    ctrl.dispose()
  })

  it('reuses shared terminal for consecutive non-dedicated commands', async () => {
    const win = fakeWindow({ exec: { exitCode: 0 } })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-1', command: 'ls', dedicated: false }), send)
    ctrl.handle(execFrame({ id: 't-2', command: 'pwd', dedicated: false }), send)

    // Both should use the same shared terminal — only 1 created
    expect(win.created.length).toBe(1)

    await waitFor(() => sent.filter(f => f.kind === 'terminal/exec/exit').length >= 2, 5000)

    // Still only 1 terminal
    expect(win.created.length).toBe(1)
    expect(win.created[0]!.lines.length).toBe(2)
    ctrl.dispose()
  })

  it('queues the next command behind a running one on the same terminal', async () => {
    const win = fakeWindow({
      exec: { pending: true },
      onExecute: (execution, fireEnd) => {
        setTimeout(() => { fireEnd({ terminal: win.created[0]!, execution, exitCode: 0 }) }, 100)
      },
    })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-1' }), send)
    ctrl.handle(execFrame({ id: 't-2' }), send)
    await waitFor(() => sent.filter(f => f.kind === 'terminal/exec/exit').length >= 2, 5000)

    const started = sent.filter(f => f.kind === 'terminal/exec/started').map(f => (f as { id: string }).id)
    expect(started).toEqual(['t-1', 't-2'])
    ctrl.dispose()
  })

  it('handle returns true for terminal/exec/cancel and sends Ctrl-C', async () => {
    const win = fakeWindow({ exec: { pending: true } })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    // Start a command first so there is a running entry
    ctrl.handle(execFrame({ id: 't-cancel' }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/started'), 3000)

    // Now cancel it
    const cancelResult = ctrl.handle(
      { kind: 'terminal/exec/cancel', id: 't-cancel', reason: 'timeout' },
      send,
    )
    expect(cancelResult).toBe(true)
    expect(win.created[0]!.texts).toContain('\x03')

    // A shell interrupted at the prompt never prints its sentinel: the kill
    // grace disposes the terminal and settles the execution with no status.
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/exit'), 5000)
    expect(win.created[0]!.disposed).toBe(true)
    expect(frameOf(sent, 'terminal/exec/exit').exitCode).toBeNull()

    ctrl.dispose()
  })

  it('dispose cleans up terminals and refuses further starts', () => {
    const win = fakeWindow()
    const ctrl = new IdeTerminalExecController(win)
    const send: TerminalExecSend = () => true

    ctrl.handle(execFrame({ id: 't-d' }), send)
    expect(win.created.length).toBe(1)

    ctrl.dispose()
    expect(win.created[0]!.disposed).toBe(true)

    // After dispose, a new handle still returns true (kind matches) but start
    // refuses the command instead of leaving the runtime waiting on a terminal
    // that no longer exists.
    const { sent, send: after } = recorder()
    ctrl.handle(execFrame({ id: 't-after' }), after)
    expect(win.created.length).toBe(1)
    expect(frameOf(sent, 'terminal/exec/refused').id).toBe('t-after')
  })

  it('abandonAll settles running entries without disposing terminals', async () => {
    const win = fakeWindow({ exec: { pending: true } })
    const ctrl = new IdeTerminalExecController(win)
    const { sent, send } = recorder()

    ctrl.handle(execFrame({ id: 't-ab' }), send)
    await waitFor(() => sent.some(f => f.kind === 'terminal/exec/started'), 3000)

    ctrl.abandonAll()
    expect(win.created[0]!.disposed).toBe(false)
    expect(frameOf(sent, 'terminal/exec/exit').exitCode).toBeNull()

    ctrl.dispose()
  })
})
