/**
 * Extension-owned terminal execution: the ide-profile runtime hands each
 * `bash` command to this controller, which writes it into a real integrated
 * terminal, streams the terminal's output back, and reports the exit code the
 * shell reported. Terminals stay visible to the user for the whole run.
 *
 * Completion is read from the terminal's own output: every command line ends by
 * printing a per-execution status sentinel, so an execution settles even when
 * the shell integration never delivers its end event. The end event and the
 * drained output stream stay as the fallbacks for a sentinel that never prints.
 * @module @deepseek-ai/dsh-vscode-dsh/terminal-exec
 */

import { randomUUID } from 'node:crypto'
import type { BridgeFrame } from '@deepseek-ai/dsh-ide-bridge'

/** How long one terminal command may produce terminal output before a batch is sent. */
const OUTPUT_FLUSH_MS = 30

/** Batch size that flushes immediately, so a fast producer does not wait on the timer. */
const OUTPUT_FLUSH_CHARS = 8_192

/** How long a command waits for its terminal's shell integration before refusing. */
const INTEGRATION_WAIT_MS = 10_000

/** How long the exit code may lag behind the drained output stream. */
const EXIT_LAG_MS = 3_000

/** Grace period between the interrupt key and disposing the terminal under it. */
const KILL_GRACE_MS = 2_000

/** Dedicated (background) terminals kept alive for inspection. */
const DEDICATED_TERMINAL_LIMIT = 6

/** One terminal name component; a longer session id or command is truncated to it. */
const NAME_SNIPPET = 40

/** Literal the status sentinel prints before its marker. */
const SENTINEL_PREFIX = '__DSH_DONE_'

/** Literal the status sentinel prints after the status digits. */
const SENTINEL_END = '__'

/** ANSI escape sequences (CSI, OSC, single-character escapes) that carry no visible text. */
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|[@-Z\\-_])/gu

/**
 * Strip ANSI/OSC escape sequences from terminal output so sentinel parsing and
 * echo stripping operate on visible text. VS Code shell integration injects
 * OSC 633 markers around command output, and those sequences can split or wrap
 * the status sentinel, preventing detection on the raw stream.
 * @param text - raw terminal output chunk.
 * @returns the chunk with escape sequences removed.
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '')
}

/**
 * Build the command line for one runtime command. The working directory travels
 * as an explicit `cd` instead of `executeCommand`'s own `cwd` argument: VS Code
 * writes that argument into the terminal as a character-separated path, and the
 * shell then reads every character as another argument to the command.
 *
 * The line closes by printing `<prefix><marker>:<status><end>`, so the
 * controller reads completion and the exit code from terminal output that the
 * shell itself produced. The marker travels as a quoted argument, so the
 * terminal's echo of this line never contains that literal sentinel.
 * @param command - the shell source the runtime asked to run.
 * @param cwd - the directory the command must start in.
 * @param marker - per-execution sentinel marker (alphanumeric).
 * @returns one command line that enters the directory, runs the command, and reports its status.
 */
function commandLineIn(command: string, cwd: string, marker: string): string {
  const sentinel = `printf '\\n%s%s:%s%s\\n' '${SENTINEL_PREFIX}' '${marker}' "$?" '${SENTINEL_END}'`
  return `cd ${quoteForShell(cwd)} && { ${command}\n}; ${sentinel}`
}

/**
 * Quote one path as a single shell word, so a directory with spaces or shell
 * metacharacters stays one argument.
 * @param value - the raw path.
 * @returns the path in single quotes, with embedded single quotes escaped.
 */
function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Drop the command line a terminal echoes ahead of its output.
 * @param text - output received so far for one execution.
 * @param line - the exact command line handed to the terminal.
 * @returns the text without that leading echo, or `undefined` while `text` may
 *   still be an incomplete echo and must be held back.
 */
function stripLeadingEcho(text: string, line: string): string | undefined {
  if (text.startsWith(line)) {
    const rest = text.slice(line.length)
    if (rest.startsWith('\r\n')) return rest.slice(2)
    if (rest.startsWith('\n') || rest.startsWith('\r')) return rest.slice(1)
    return rest
  }
  return line.startsWith(text) ? undefined : text
}

/** The terminal surface this controller drives; the real `vscode.Terminal` satisfies it. */
export interface TerminalExecTerminal {
  readonly name: string
  readonly shellIntegration?: TerminalExecShellIntegration | undefined
  sendText(text: string, shouldExecute?: boolean): void
  show(preserveFocus?: boolean): void
  dispose(): void
}

/** The shell-integration surface of one terminal. */
export interface TerminalExecShellIntegration {
  /**
   * Run one command line in this terminal.
   * @param commandLine - the shell source to run.
   * @param cwd - working directory for this command.
   * @returns the execution handle whose `read()` streams its output.
   */
  executeCommand(commandLine: string, cwd?: string): TerminalExecExecution
}

/** One running command's output stream. */
export interface TerminalExecExecution {
  read(): AsyncIterable<string>
}

/** The `vscode.window` slice this controller uses. */
export interface TerminalExecWindow {
  createTerminal(options: { name: string }): TerminalExecTerminal
  readonly terminals: readonly TerminalExecTerminal[]
  onDidChangeTerminalShellIntegration(
    listener: (event: { terminal: TerminalExecTerminal; shellIntegration: TerminalExecShellIntegration }) => void,
  ): { dispose(): void }
  onDidEndTerminalShellExecution(
    listener: (event: {
      terminal: TerminalExecTerminal
      execution: TerminalExecExecution
      exitCode: number | undefined
    }) => void,
  ): { dispose(): void }
}

/** One in-flight execution: its terminal, its single settlement, and the interrupt grace timer. */
interface RunningTerminalExec {
  readonly terminal: TerminalExecTerminal
  /**
   * Send this execution's single exit frame; later calls are ignored.
   * @param exitCode - the shell's status, or `null` when none was reported.
   */
  settle(exitCode: number | null): void
  /**
   * Fail this execution instead of settling it, so the runtime reports the
   * cause to the model rather than reading a silent truncation as success.
   * @param error - the failure the runtime reads.
   */
  fail(error: string): void
  /** Disposes the terminal when an interrupt did not stop the command in time. */
  graceTimer?: ReturnType<typeof setTimeout>
}

/** Frame sink for one runtime connection. */
export type TerminalExecSend = (frame: BridgeFrame) => boolean

/**
 * Runs runtime-requested commands in integrated terminals. One terminal serves
 * a session's foreground commands in arrival order; a background command gets a
 * terminal of its own so a long-running job never blocks that queue.
 */
export class IdeTerminalExecController {
  private readonly shared = new Map<string, TerminalExecTerminal>()
  private readonly dedicated: TerminalExecTerminal[] = []
  private readonly chains = new Map<TerminalExecTerminal, Promise<void>>()
  private readonly running = new Map<string, RunningTerminalExec>()
  private readonly integrationListeners = new Set<
    (terminal: TerminalExecTerminal, integration: TerminalExecShellIntegration) => void
  >()
  private readonly endListeners = new Set<
    (terminal: TerminalExecTerminal, execution: TerminalExecExecution, exitCode: number | undefined) => void
  >()
  private integrationSubscription: { dispose(): void } | undefined
  private endSubscription: { dispose(): void } | undefined
  private disposed = false

  /**
   * @param window - the Extension window surface that owns the terminals.
   */
  constructor(private readonly window: TerminalExecWindow) {}

  /**
   * Handle one inbound runtime frame.
   * @param frame - a validated bridge frame from the runtime.
   * @param send - sink for the reply frames, bound to the asking connection.
   * @returns whether the frame belonged to the terminal-execution family.
   */
  handle(frame: BridgeFrame, send: TerminalExecSend): boolean {
    if (frame.kind === 'terminal/exec') {
      this.start(frame, send)
      return true
    }
    if (frame.kind === 'terminal/exec/cancel') {
      this.interrupt(frame.id)
      return true
    }
    return false
  }

  /**
   * Stop tracking every execution after its runtime connection dropped. The
   * runtime fails its own waits closed on the same edge, so each execution is
   * settled only so no waiter is left holding a terminal nobody drives.
   */
  abandonAll(): void {
    for (const running of [...this.running.values()]) running.settle(null)
    this.running.clear()
  }

  /** Release every terminal this controller created and detach its listeners. */
  dispose(): void {
    this.disposed = true
    this.abandonAll()
    this.integrationSubscription?.dispose()
    this.integrationSubscription = undefined
    this.endSubscription?.dispose()
    this.endSubscription = undefined
    for (const terminal of this.shared.values()) terminal.dispose()
    this.shared.clear()
    for (const terminal of this.dedicated) terminal.dispose()
    this.dedicated.length = 0
    this.chains.clear()
  }

  /** Start one command once the terminal it runs in is free. */
  private start(
    frame: Extract<BridgeFrame, { kind: 'terminal/exec' }>,
    send: TerminalExecSend,
  ): void {
    if (this.disposed) {
      send({
        kind: 'terminal/exec/refused',
        id: frame.id,
        error: 'the IDE terminal controller has shut down, so this command cannot run',
      })
      return
    }
    const terminal = frame.dedicated ? this.dedicatedTerminal(frame.command) : this.sharedTerminal(frame)
    // Foreground commands queue behind the session's previous one: an
    // interactive shell runs one command at a time, and the queue keeps execution
    // order equal to the order the runtime asked in.
    const previous = this.chains.get(terminal) ?? Promise.resolve()
    const next = previous.then(() => this.runOn(terminal, frame, send))
    this.chains.set(terminal, next.catch(() => {}))
  }

  /** Run one command in the given terminal, reporting start, output, and exit. */
  private async runOn(
    terminal: TerminalExecTerminal,
    frame: Extract<BridgeFrame, { kind: 'terminal/exec' }>,
    send: TerminalExecSend,
  ): Promise<void> {
    const integration = await this.awaitIntegration(terminal)
    if (integration === undefined) {
      send({
        kind: 'terminal/exec/refused',
        id: frame.id,
        error: 'this VS Code terminal has no shell integration, so its output and exit code cannot be read',
      })
      return
    }
    terminal.show(true)
    const marker = randomUUID().replaceAll('-', '')
    const line = commandLineIn(frame.command, frame.cwd, marker)

    // The end listener is registered before the command starts: an end event
    // that lands between starting the command and waiting on it would otherwise
    // be lost and leave the execution settling on its sentinel alone.
    let execution: TerminalExecExecution | undefined
    const endListener = (
      candidate: TerminalExecTerminal,
      ended: TerminalExecExecution,
      exitCode: number | undefined,
    ): void => {
      if (candidate !== terminal) return
      if (execution !== undefined && ended !== execution) return
      releaseEnd()
      endedWith.resolve(exitCode ?? null)
    }
    const releaseEnd = (): void => { this.endListeners.delete(endListener) }
    const endedWith = Promise.withResolvers<number | null>()
    this.endListeners.add(endListener)
    this.ensureEndSubscription()

    try {
      execution = integration.executeCommand(line)
    } catch (error) {
      releaseEnd()
      send({
        kind: 'terminal/exec/refused',
        id: frame.id,
        error: `the integrated terminal refused the command: ${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }

    const entry: RunningTerminalExec = {
      terminal,
      settle: (exitCode) => {
        if (!close()) return
        send({ kind: 'terminal/exec/exit', id: frame.id, exitCode })
      },
      fail: (error) => {
        if (!close()) return
        send({ kind: 'terminal/exec/refused', id: frame.id, error })
      },
    }
    const close = (): boolean => {
      if (settled) return false
      settled = true
      releaseEnd()
      this.running.delete(frame.id)
      this.clearGrace(entry)
      return true
    }
    let settled = false
    this.running.set(frame.id, entry)

    // An AbortController lets the end event or a dispose stop pumpOutput's
    // for-await loop: VS Code shell integration may never close execution.read()
    // on its own, and the sentinel printf may land outside the command's output
    // region (inside the prompt region), so pumpOutput cannot rely on either
    // signal arriving through the stream.
    const pumpAbort = new AbortController()
    const read = this.pumpOutput(frame.id, execution, send, line, marker, pumpAbort.signal)
    send({ kind: 'terminal/exec/started', id: frame.id })
    try {
      entry.settle(await this.awaitEnd(endedWith.promise, read, pumpAbort))
    } catch (error) {
      pumpAbort.abort()
      entry.fail(`the terminal stopped reporting this command: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Stream one execution's output to the runtime in bounded batches, stopping at
   * the status sentinel that command line prints, or when the abort signal fires
   * (the shell execution end event arrived through a different path).
   * @param id - the executing frame's id.
   * @param execution - the execution whose output is read.
   * @param send - sink for the output frames.
   * @param line - the exact command line handed to the terminal, for echo removal.
   * @param marker - this execution's sentinel marker.
   * @param signal - abort signal that stops the output loop when the end event arrives.
   * @returns the sentinel's exit code, or `null` when the stream ended without one.
   */
  private async pumpOutput(
    id: string,
    execution: TerminalExecExecution,
    send: TerminalExecSend,
    line: string,
    marker: string,
    signal: AbortSignal,
  ): Promise<number | null> {
    const prefix = `${SENTINEL_PREFIX}${marker}:`
    let batch = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let held = ''
    let echoPending = true
    let status: number | null = null
    const flush = (): void => {
      if (batch === '') return
      send({ kind: 'terminal/exec/output', id, data: batch })
      batch = ''
    }
    const push = (text: string): void => {
      if (text === '') return
      batch += text
      if (batch.length >= OUTPUT_FLUSH_CHARS) {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
        flush()
        return
      }
      timer ??= setTimeout(() => {
        timer = undefined
        flush()
      }, OUTPUT_FLUSH_MS)
    }
    try {
      for await (const raw of execution.read()) {
        if (this.disposed || signal.aborted) break
        const chunk = stripAnsi(raw)
        held += chunk
        if (echoPending) {
          const stripped = stripLeadingEcho(held, line)
          if (stripped === undefined) continue
          held = stripped
          echoPending = false
        }
        // Only the last `prefix.length - 1` characters can begin a sentinel
        // split across chunks; everything before them is command output.
        let holdFrom = Math.max(0, held.length - (prefix.length - 1))
        const at = held.indexOf(prefix)
        if (at >= 0) {
          const rest = held.slice(at + prefix.length)
          const digits = /^\d+/.exec(rest)?.[0]
          if (digits !== undefined && rest.startsWith(SENTINEL_END, digits.length)) {
            push(held.slice(0, at))
            status = Number(digits)
            held = ''
            break
          }
          // A status line still arriving: nothing past its start may go out.
          holdFrom = at
        }
        if (holdFrom > 0) {
          push(held.slice(0, holdFrom))
          held = held.slice(holdFrom)
        }
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      // A stream that ended without its sentinel still forwards what arrived.
      if (status === null && held !== '') push(held)
      flush()
    }
    return status
  }

  /**
   * Wait for the exit code: the sentinel when it printed, the end event when it
   * arrived first, and the drained stream plus one lag window otherwise. When the
   * end event wins the race, the pump abort signal is fired so `pumpOutput` can
   * break out of a stream that VS Code shell integration never closes.
   * @param ended - resolution carrying the end event's exit code.
   * @param read - pending output pump, resolving to the sentinel's exit code or `null`.
   * @param pumpAbort - controller whose signal stops the output loop.
   * @returns the exit code, or `null` when the terminal never reported one.
   */
  private async awaitEnd(
    ended: Promise<number | null>,
    read: Promise<number | null>,
    pumpAbort: AbortController,
  ): Promise<number | null> {
    // A sentinel already carries the status; a stream that drained without one
    // gives the end event one lag window to arrive with the real code.
    const lagged = read.then(async (status): Promise<number | null> => {
      if (status !== null) return status
      await new Promise((resolve) => { setTimeout(resolve, EXIT_LAG_MS) })
      return null
    })
    const endedCode = ended.then((code): number | null => {
      // The end event arrived: stop the pump so it does not block on a stream
      // that shell integration may never close.
      pumpAbort.abort()
      return code
    })
    return await Promise.race([endedCode, lagged])
  }

  /** Interrupt one running execution; a shell that ignores the key loses its terminal. */
  private interrupt(id: string): void {
    const running = this.running.get(id)
    if (running === undefined) return
    running.terminal.sendText('\u0003', false)
    running.graceTimer ??= setTimeout(() => {
      // A shell interrupted at the prompt never prints its status sentinel, so
      // the grace expiry is that execution's last settlement point.
      running.terminal.dispose()
      running.settle(null)
    }, KILL_GRACE_MS)
  }

  /** Clear an execution's interrupt grace timer, when one is armed. */
  private clearGrace(running: RunningTerminalExec): void {
    if (running.graceTimer === undefined) return
    clearTimeout(running.graceTimer)
    delete running.graceTimer
  }

  /** Wait for the terminal's shell integration, or `undefined` when it never arrives. */
  private async awaitIntegration(
    terminal: TerminalExecTerminal,
  ): Promise<TerminalExecShellIntegration | undefined> {
    if (terminal.shellIntegration !== undefined) return terminal.shellIntegration
    return await new Promise<TerminalExecShellIntegration | undefined>((resolve) => {
      const waiter = (candidate: TerminalExecTerminal, integration: TerminalExecShellIntegration): void => {
        if (candidate !== terminal) return
        cleanup()
        resolve(integration)
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve(undefined)
      }, INTEGRATION_WAIT_MS)
      const cleanup = (): void => {
        clearTimeout(timer)
        this.integrationListeners.delete(waiter)
      }
      this.integrationListeners.add(waiter)
      this.ensureIntegrationSubscription()
    })
  }

  /** Attach the shell-integration listener once, on first use. */
  private ensureIntegrationSubscription(): void {
    if (this.integrationSubscription !== undefined) return
    this.integrationSubscription = this.window.onDidChangeTerminalShellIntegration((event) => {
      for (const listener of [...this.integrationListeners]) listener(event.terminal, event.shellIntegration)
    })
  }

  /** Attach the execution-end listener once, on first use. */
  private ensureEndSubscription(): void {
    if (this.endSubscription !== undefined) return
    this.endSubscription = this.window.onDidEndTerminalShellExecution((event) => {
      for (const listener of [...this.endListeners]) listener(event.terminal, event.execution, event.exitCode)
    })
  }

  /** The session's reusable foreground terminal, recreated after a user disposal. */
  private sharedTerminal(frame: Extract<BridgeFrame, { kind: 'terminal/exec' }>): TerminalExecTerminal {
    const key = frame.sessionId === undefined ? 'default' : frame.sessionId.slice(0, 8)
    const existing = this.shared.get(key)
    if (existing !== undefined && this.window.terminals.includes(existing)) return existing
    const terminal = this.window.createTerminal({ name: `DSH · ${key}` })
    this.shared.set(key, terminal)
    return terminal
  }

  /** A fresh terminal for one background command, pruned at the inspection limit. */
  private dedicatedTerminal(command: string): TerminalExecTerminal {
    if (this.dedicated.length >= DEDICATED_TERMINAL_LIMIT) {
      this.dedicated.shift()?.dispose()
    }
    const firstLine = command.split('\n', 1)[0] ?? command
    const snippet = firstLine.length > NAME_SNIPPET ? `${firstLine.slice(0, NAME_SNIPPET)}…` : firstLine
    const terminal = this.window.createTerminal({ name: `DSH bg · ${snippet}` })
    this.dedicated.push(terminal)
    return terminal
  }
}
