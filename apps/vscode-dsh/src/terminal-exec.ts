/**
 * Extension-owned terminal execution: the ide-profile runtime hands each
 * `bash` command to this controller, which writes it into a real integrated
 * terminal, streams the terminal's output back, and reports the exit code the
 * command reported. Terminals stay visible to the user for the whole run.
 *
 * Execution deliberately does not depend on VS Code terminal shell integration.
 * Shell integration is absent or unreliable in some hosts (Trae, sandboxed
 * extension hosts), and a terminal without it used to refuse every command.
 * Instead the command runs through a small bash wrapper whose `tee` keeps the
 * user watching the same output while writing it to a file the extension polls;
 * the wrapper's `EXIT` trap writes the status. This is the same terminal, the
 * same shell environment, and the same visible output, with no shell-integration
 * event that can fail to arrive.
 * @module @deepseek-ai/dsh-vscode-dsh/terminal-exec
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BridgeFrame } from '@deepseek-ai/dsh-ide-bridge'

/** Shell a terminal must own; the IDE terminal executor is bash-only. */
const SHELL_PATH = process.platform === 'win32' ? undefined : '/bin/bash'

/** Longest a foreground execution may produce no output before its terminal is reset. */
const NO_OUTPUT_RESET_CAP_MS = 20_000

/** Poll interval for the wrapper's output and status files. */
const POLL_MS = 25

/** Grace period between the interrupt key and disposing the terminal under it. */
const KILL_GRACE_MS = 2_000

/** Dedicated (background) terminals kept alive for inspection. */
const DEDICATED_TERMINAL_LIMIT = 6

/** One terminal name component; a longer session id or command is truncated to it. */
const NAME_SNIPPET = 40

/** ANSI escape sequences (CSI, OSC, single-character escapes) that carry no visible text. */
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|[@-Z\\-_])/gu

/**
 * Strip ANSI/OSC escape sequences from terminal output so the model reads text.
 * @param text - raw terminal output.
 * @returns the text without escape sequences.
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '')
}

/**
 * Quote one path as a single shell word.
 * @param value - the raw path.
 * @returns the path in single quotes, with embedded single quotes escaped.
 */
function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** The terminal surface this controller drives; the real `vscode.Terminal` satisfies it. */
export interface TerminalExecTerminal {
  readonly name: string
  sendText(text: string, shouldExecute?: boolean): void
  show(preserveFocus?: boolean): void
  dispose(): void
}

/** The `vscode.window` slice this controller uses. */
export interface TerminalExecWindow {
  createTerminal(options: { name: string; shellPath?: string }): TerminalExecTerminal
  readonly terminals: readonly TerminalExecTerminal[]
}

/** One command the runner must execute in the given terminal. */
export interface TerminalRunRequest {
  /** Terminal the command is typed into. */
  terminal: TerminalExecTerminal
  /** Shell source the runtime asked to run. */
  command: string
  /** Absolute working directory the command must start in. */
  cwd: string
  /** Caller's execution deadline, when it named one. */
  timeoutMs?: number
  /** Whether this execution owns its terminal and may run indefinitely. */
  dedicated: boolean
  /** Aborted when the execution is cancelled or the controller shuts down. */
  signal: AbortSignal
  /** Receives each visible output chunk as it arrives. */
  onOutput: (text: string) => void
}

/**
 * Executes one command in a terminal and resolves with its exit code. The
 * default implementation is {@link FileTerminalCommandRunner}; tests supply a
 * fake so the controller's queue, frames, and cancellation stay testable.
 */
export interface TerminalCommandRunner {
  /**
   * @param request - terminal, command, working directory, and output sink.
   * @returns the command's exit code, or `null` when no code was reported.
   */
  run(request: TerminalRunRequest): Promise<number | null>
}

/**
 * Runs a command by typing a bash wrapper into the terminal. The wrapper tees
 * output to the terminal and a file, and its `EXIT` trap writes the status to a
 * second file; polling those files is what the controller reads. No shell
 * integration event participates.
 */
export class FileTerminalCommandRunner implements TerminalCommandRunner {
  /**
   * @param noOutputResetMs - longest a foreground command may produce no
   *   output before its terminal is disposed; tests shorten it.
   */
  constructor(private readonly noOutputResetMs = NO_OUTPUT_RESET_CAP_MS) {}

  /**
   * @param request - terminal, command, working directory, and output sink.
   * @returns the command's exit code, or `null` when no code was reported.
   */
  async run(request: TerminalRunRequest): Promise<number | null> {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-terminal-'))
    const script = join(dir, 'run.sh')
    const output = join(dir, 'output.log')
    const status = join(dir, 'status')
    // The trap writes the status for every exit path, including a failed `cd`
    // or a command that calls `exit` itself. `tee` keeps the terminal visible
    // while the extension reads the same bytes from the file.
    writeFileSync(script, [
      '#!/usr/bin/env bash',
      `trap 's=$?; printf "%s" "$s" > ${quoteForShell(status)}' EXIT`,
      `cd ${quoteForShell(request.cwd)} || exit 125`,
      `{ ${request.command}`,
      `} 2>&1 | tee ${quoteForShell(output)}`,
      'exit "${PIPESTATUS[0]}"',
      '',
    ].join('\n'))
    try {
      request.terminal.sendText(`/bin/bash ${quoteForShell(script)}`, true)
      return await this.poll(request, output, status)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /**
   * Poll the wrapper's output and status files until the command settles.
   * @param request - the running execution.
   * @param output - path of the tee'd output file.
   * @param status - path of the exit-status file.
   * @returns the command's exit code, or `null` when it was cancelled.
   */
  private async poll(
    request: TerminalRunRequest,
    output: string,
    status: string,
  ): Promise<number | null> {
    let offset = 0
    let sawOutput = false
    const startedAt = Date.now()
    const deadline = startedAt
      + Math.min(request.timeoutMs ?? this.noOutputResetMs, this.noOutputResetMs)
    while (true) {
      if (request.signal.aborted) return null
      const delta = this.readFrom(output, offset)
      if (delta.text !== '') {
        offset = delta.next
        if (delta.text.trim() !== '') sawOutput = true
        request.onOutput(stripAnsi(delta.text))
      }
      if (existsSync(status)) {
        const rest = this.readFrom(output, offset)
        if (rest.text !== '') request.onOutput(stripAnsi(rest.text))
        const code = Number.parseInt(readFileSync(status, 'utf8').trim(), 10)
        return Number.isFinite(code) ? code : null
      }
      if (!request.dedicated && !sawOutput && Date.now() >= deadline) {
        request.terminal.dispose()
        throw new Error(
          `the IDE terminal did not run this command within ${deadline - startedAt}ms; `
          + 'the terminal was reset so later commands are not blocked',
        )
      }
      await new Promise((resolve) => { setTimeout(resolve, POLL_MS) })
    }
  }

  /**
   * Read the bytes appended to a file since `offset`.
   * @param path - file to read.
   * @param offset - byte offset a previous read returned.
   * @returns the new text and the next offset; an absent file yields no text.
   */
  private readFrom(path: string, offset: number): { text: string; next: number } {
    try {
      const buffer = readFileSync(path)
      if (buffer.length <= offset) return { text: '', next: offset }
      return { text: buffer.subarray(offset).toString('utf8'), next: buffer.length }
    } catch {
      return { text: '', next: offset }
    }
  }
}

/** One in-flight execution: its terminal, its single settlement, and its cancel hook. */
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
  /** Abort the runner; the execution settles as cancelled. */
  cancel(): void
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
  private readonly runner: TerminalCommandRunner
  private disposed = false

  /**
   * @param window - the Extension window surface that owns the terminals.
   * @param options - no-output reset window and an optional runner override.
   */
  constructor(
    private readonly window: TerminalExecWindow,
    options: { noOutputResetMs?: number; runner?: TerminalCommandRunner } = {},
  ) {
    this.runner = options.runner ?? new FileTerminalCommandRunner(options.noOutputResetMs)
  }

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
    for (const running of [...this.running.values()]) {
      running.cancel()
      running.settle(null)
    }
    this.running.clear()
  }

  /** Release every terminal this controller created and detach its listeners. */
  dispose(): void {
    this.disposed = true
    this.abandonAll()
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
    // A background command owns its terminal and never queues. A foreground
    // command queues behind the session's previous one, but resolves the
    // terminal again when its turn comes: the queued terminal may have been
    // disposed by the no-output reset while this command waited.
    if (frame.dedicated) {
      void this.runOn(this.dedicatedTerminal(frame.command), frame, send)
      return
    }
    const initial = this.sharedTerminal(frame)
    const previous = this.chains.get(initial) ?? Promise.resolve()
    const next = previous.then(() => this.runOn(this.sharedTerminal(frame), frame, send))
    this.chains.set(initial, next.catch(() => {}))
  }

  /** Run one command in the given terminal, reporting start, output, and exit. */
  private async runOn(
    terminal: TerminalExecTerminal,
    frame: Extract<BridgeFrame, { kind: 'terminal/exec' }>,
    send: TerminalExecSend,
  ): Promise<void> {
    terminal.show(true)
    const abort = new AbortController()
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
      cancel: () => { abort.abort() },
    }
    const close = (): boolean => {
      if (settled) return false
      settled = true
      abort.abort()
      this.running.delete(frame.id)
      this.clearGrace(entry)
      return true
    }
    let settled = false
    this.running.set(frame.id, entry)
    send({ kind: 'terminal/exec/started', id: frame.id })
    try {
      const exitCode = await this.runner.run({
        terminal,
        command: frame.command,
        cwd: frame.cwd,
        ...frame.timeoutMs === undefined ? {} : { timeoutMs: frame.timeoutMs },
        dedicated: frame.dedicated,
        signal: abort.signal,
        onOutput: (data) => {
          if (!settled) send({ kind: 'terminal/exec/output', id: frame.id, data })
        },
      })
      entry.settle(exitCode)
    } catch (error) {
      if (abort.signal.aborted) entry.settle(null)
      else entry.fail(`the terminal stopped reporting this command: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Interrupt one running execution; a shell that ignores the key loses its terminal. */
  private interrupt(id: string): void {
    const running = this.running.get(id)
    if (running === undefined) return
    running.cancel()
    running.terminal.sendText('\u0003', false)
    running.graceTimer ??= setTimeout(() => {
      // A shell interrupted at the prompt never writes its status, so the
      // grace expiry is that execution's last settlement point.
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

  /** The session's reusable foreground terminal, recreated after a user disposal. */
  private sharedTerminal(frame: Extract<BridgeFrame, { kind: 'terminal/exec' }>): TerminalExecTerminal {
    const key = frame.sessionId === undefined ? 'default' : frame.sessionId.slice(0, 8)
    const existing = this.shared.get(key)
    if (existing !== undefined && this.window.terminals.includes(existing)) return existing
    const terminal = this.window.createTerminal({
      name: `DSH · ${key}`,
      ...SHELL_PATH === undefined ? {} : { shellPath: SHELL_PATH },
    })
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
    const terminal = this.window.createTerminal({
      name: `DSH bg · ${snippet}`,
      ...SHELL_PATH === undefined ? {} : { shellPath: SHELL_PATH },
    })
    this.dedicated.push(terminal)
    return terminal
  }
}
