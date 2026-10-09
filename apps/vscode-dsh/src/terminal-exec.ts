/**
 * Extension-owned terminal execution: the ide-profile runtime hands each
 * `bash` command to this controller, which writes it into a real integrated
 * terminal, streams the terminal's output back, and reports the exit code the
 * shell reported. Terminals stay visible to the user for the whole run.
 * @module @deepseek-ai/dsh-vscode-dsh/terminal-exec
 */

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
    listener: (event: { execution: TerminalExecExecution; exitCode: number | undefined }) => void,
  ): { dispose(): void }
}

/** One in-flight execution: its terminal plus the interrupt grace timer, if any. */
interface RunningTerminalExec {
  readonly terminal: TerminalExecTerminal
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
    (execution: TerminalExecExecution, exitCode: number | undefined) => void
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
   * runtime fails its own waits closed on the same edge, so this controller only
   * releases bookkeeping; terminals stay for the user to read.
   */
  abandonAll(): void {
    for (const running of this.running.values()) this.clearGrace(running)
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
    if (this.disposed) return
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
      if (!this.disposed) {
        send({
          kind: 'terminal/exec/refused',
          id: frame.id,
          error: 'this VS Code terminal has no shell integration, so its output and exit code cannot be read',
        })
      }
      return
    }
    terminal.show(true)
    let execution: TerminalExecExecution
    try {
      execution = integration.executeCommand(frame.command, frame.cwd)
    } catch (error) {
      send({
        kind: 'terminal/exec/refused',
        id: frame.id,
        error: `the integrated terminal refused the command: ${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }

    const entry: RunningTerminalExec = { terminal }
    this.running.set(frame.id, entry)
    const read = this.pumpOutput(frame.id, execution, send)
    send({ kind: 'terminal/exec/started', id: frame.id })

    const exitCode = await this.awaitEnd(execution, read)
    await read
    this.running.delete(frame.id)
    this.clearGrace(entry)
    send({ kind: 'terminal/exec/exit', id: frame.id, exitCode })
  }

  /** Stream one execution's output to the runtime in bounded batches. */
  private async pumpOutput(
    id: string,
    execution: TerminalExecExecution,
    send: TerminalExecSend,
  ): Promise<void> {
    let batch = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = (): void => {
      if (batch === '') return
      send({ kind: 'terminal/exec/output', id, data: batch })
      batch = ''
    }
    try {
      for await (const chunk of execution.read()) {
        if (this.disposed) return
        batch += chunk
        if (batch.length >= OUTPUT_FLUSH_CHARS) {
          if (timer !== undefined) clearTimeout(timer)
          timer = undefined
          flush()
          continue
        }
        timer ??= setTimeout(() => {
          timer = undefined
          flush()
        }, OUTPUT_FLUSH_MS)
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      flush()
    }
  }

  /** Wait for the exit code, bounded by the drained stream plus a short lag. */
  private async awaitEnd(execution: TerminalExecExecution, read: Promise<void>): Promise<number | null> {
    const ended = new Promise<number | null>((resolve) => {
      const listener = (candidate: TerminalExecExecution, exitCode: number | undefined): void => {
        if (candidate !== execution) return
        this.endListeners.delete(listener)
        resolve(exitCode ?? null)
      }
      this.endListeners.add(listener)
    })
    this.ensureEndSubscription()
    // Shell integration reports the end event; a terminal whose integration lost
    // the marker still ends the output stream, so the drained stream plus one lag
    // window settles the execution with an unreported exit code.
    const lagged = read.then(async () => {
      await new Promise((resolve) => { setTimeout(resolve, EXIT_LAG_MS) })
      return null as number | null
    })
    return await Promise.race([ended, lagged])
  }

  /** Interrupt one running execution; a shell that ignores the key loses its terminal. */
  private interrupt(id: string): void {
    const running = this.running.get(id)
    if (running === undefined) return
    running.terminal.sendText('\u0003', false)
    running.graceTimer ??= setTimeout(() => {
      running.terminal.dispose()
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
      for (const listener of [...this.endListeners]) listener(event.execution, event.exitCode)
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
