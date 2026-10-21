/**
 * IDE-terminal bash executor: with `terminal: 'ide'` (the default) every
 * model-facing command runs in a VS Code integrated terminal through
 * `ctx.ideTerminals`, so the user watches it execute and the command inherits
 * the user's own shell environment; `terminal: 'sandbox'` runs the inherited
 * confining stack instead. One value selects the stack, so commands never split
 * between the two.
 *
 * The integrated terminal cannot confine anything, so a session whose resolved
 * mode is not `danger-full-access` is refused with an actionable message instead
 * of run unconfined. A command carrying stdin — the in-process hook bridges,
 * never a model-facing call — keeps the confining stack, the one execution a
 * terminal cannot serve.
 * @module @deepseek-ai/dsh-bash-ide-terminal
 */

import type { Volatile } from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-local'
import type {
  CollectedOutput,
  ShellExecution,
  ShellExecSpec,
  ShellProcessRead,
  ShellRunResult,
} from '@deepseek-ai/dsh-shell'
import type { SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { IdeTerminalExecution } from '@deepseek-ai/dsh-ide-bridge'
// The runtime publication of `ctx.ideTerminals` lives in the ide-bridge entry
// module; importing the execution type above is what makes it visible here.
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

/** ANSI sequences a terminal emits that carry no text: CSI, OSC, and single-character escapes. */
const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|[@-Z\\-_])/gu

/** C0 controls that carry no text; newline and tab survive. */
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu

/** One empty collected stream, for the terminal path's unused stderr. */
const EMPTY_OUTPUT: CollectedOutput = { text: '', truncated: false }

/** One reader that never produces bytes. */
const EMPTY_READER: SubprocessOutputReader = { readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }) }

/**
 * Why a confined session cannot use the IDE terminal, named with the two
 * actions that resolve it.
 * @param mode - the session's resolved sandbox mode.
 * @returns the refusal message the model reads.
 */
export function confinedModeRefusal(mode: SandboxMode): string {
  return `the IDE terminal runs commands unconfined, so sandbox mode "${mode}" cannot be honored there;`
    + ' switch this session to the danger-full-access permission preset, or switch the execution terminal'
    + ' back to the sandbox in the settings page'
}

/**
 * Normalize one terminal chunk for model consumption: drop color and cursor
 * sequences, and turn carriage-return overwrites into line breaks.
 * @param text - raw terminal output text.
 * @returns the readable text.
 */
export function normalizeTerminalOutput(text: string): string {
  return text
    .replace(ANSI_PATTERN, '')
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .replace(CONTROL_PATTERN, '')
}

/**
 * Drop the command line a terminal echoes ahead of its output, so the model
 * reads the command's result alone.
 * @param chunk - first output chunk of one execution.
 * @param command - the command line handed to the terminal.
 * @returns the chunk without a leading echo of the command.
 */
export function stripCommandEcho(chunk: string, command: string): string {
  if (!chunk.startsWith(command)) return chunk
  const rest = chunk.slice(command.length)
  if (rest.startsWith('\r\n')) return rest.slice(2)
  return rest.startsWith('\n') ? rest.slice(1) : rest
}

/**
 * Bounded, byte-offset tail of one terminal execution's output, shaped like the
 * subprocess collectors so the consuming {@link ShellProcess.readOutput} cursor
 * and independent `observed` readers share one buffer. Trimming stops on a
 * character boundary, so retained text never starts mid-character.
 */
export class TerminalOutputBuffer {
  private retained = Buffer.alloc(0)
  /** Whole-stream byte offset of `retained[0]`. */
  private start = 0
  /** Whole-stream byte offset after the last appended byte. */
  private end = 0

  /**
   * @param maxBytes - retained tail budget in bytes.
   */
  constructor(private readonly maxBytes: number) {}

  /**
   * Append one decoded chunk, trimming the oldest bytes past the budget.
   * @param text - decoded output text.
   */
  append(text: string): void {
    if (text === '') return
    const bytes = Buffer.from(text, 'utf8')
    this.retained = Buffer.concat([this.retained, bytes])
    this.end += bytes.length
    if (this.retained.length <= this.maxBytes) return
    let drop = this.retained.length - this.maxBytes
    // 0x80..0xBF is a UTF-8 continuation byte: dropping one would leave a
    // half character at the head, so the cut moves to the next boundary.
    while (drop < this.retained.length) {
      const byte = this.retained[drop] ?? 0
      if (byte < 0x80 || byte >= 0xC0) break
      drop += 1
    }
    this.retained = this.retained.subarray(drop)
    this.start += drop
  }

  /**
   * Read everything retained since one whole-stream byte offset.
   * @param fromByte - offset a prior read returned, or 0 for the first read.
   * @returns the delta text, the next offset, and whether dropped bytes preceded it.
   */
  readFrom(fromByte: number): { text: string; nextOffset: number; lossy: boolean } {
    const lossy = fromByte < this.start
    const from = lossy ? 0 : fromByte - this.start
    return { text: this.retained.subarray(from).toString('utf8'), nextOffset: this.end, lossy }
  }

  /**
   * The retained tail as one collected stream.
   * @returns the collected stdout of the execution.
   */
  toCollected(): CollectedOutput {
    return { text: this.retained.toString('utf8'), truncated: this.start > 0 }
  }
}

/**
 * Plugin config: the local executor's knobs verbatim, plus the execution-stack
 * switch. The sandbox policy (default mode, fallback root) stays on
 * `ctx.sandboxPolicy`; this plugin only chooses which stack runs a command.
 */
export interface Config extends LocalConfig {
  /**
   * Which stack runs this deployment's commands. `ide` runs every model-facing
   * command in a VS Code integrated terminal through the ide bridge; `sandbox`
   * runs the inherited confining stack. Volatile, so the settings page can
   * switch it without restarting the Host.
   */
  terminal: Volatile<'ide' | 'sandbox'>
}

/**
 * Registers as `ctx.shell` in place of the sandbox executor. It keeps the
 * confining stack mounted (and `sandboxMode` advertised) so permission presets
 * and escalation keep working; the configured value decides, for the whole
 * deployment, whether a command runs in the IDE terminal or through
 * `ctx.sandbox`.
 */
export class IdeTerminalBashExecutor extends SandboxBashExecutor {
  static override inject = ['subprocess', 'sandbox', 'sandboxPolicy', 'ideTerminals']

  static override Config = z.object({
    cwd: z.string().volatile(),
    timeoutMs: z.number().default(120_000).volatile(),
    maxTimeoutMs: z.number().default(600_000).volatile(),
    maxOutputBytes: z.number().default(64_000).volatile(),
    maxSpillBytes: z.number().default(64 * 1024 * 1024).volatile(),
    graceMs: z.number().default(3_000).volatile(),
    terminal: z.union(['ide', 'sandbox']).default('ide').volatile(),
  })

  constructor(ctx: Context, override readonly config: Config) {
    super(ctx, config)
  }

  /**
   * Run one command on the configured stack. A confined mode is refused under
   * the IDE stack because the terminal cannot confine; a stdin-carrying call
   * keeps the confining stack.
   * @param spec - the resolved execution spec.
   * @returns the live execution handle.
   */
  override async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    if (this.config.terminal.get() !== 'ide') return await super.execute(spec)
    const mode = spec.sandboxPolicy?.mode ?? this.ctx.sandboxPolicy.defaultMode
    if (mode !== 'danger-full-access') throw new Error(confinedModeRefusal(mode))
    if (spec.stdin !== undefined) return await super.execute(spec)
    return await this.executeInTerminal(spec)
  }

  /**
   * Run one command in the Extension's terminal: deadline wiring, the start
   * handshake, the output pump, and the foreground projection. Infrastructure
   * failures reject the projection while the handle still settles, matching the
   * local executor's contract.
   * @param spec - the resolved execution spec.
   * @returns the live execution handle.
   */
  private async executeInTerminal(spec: ShellExecSpec): Promise<ShellExecution> {
    const terminals = this.ctx.ideTerminals
    if (!terminals.available()) {
      throw new Error('the IDE terminal is unavailable: the Extension bridge is not connected')
    }

    // Same deadline wiring as the local executor: one fused signal drives the
    // terminal cancel, and only this executor's own timeout counts as timedOut.
    let spawnSignal: AbortSignal | undefined
    let classify: () => { timedOut: boolean; aborted: boolean }
    let disarm = (): void => {}
    if (spec.onExpiry === 'kill') {
      const d = deadline(spec.signal, spec.timeoutMs, 'BASH_TIMEOUT')
      spawnSignal = d.signal
      classify = () => {
        const timedOut = timeoutOf(d.signal, 'BASH_TIMEOUT') !== undefined
        return { timedOut, aborted: d.signal.aborted && !timedOut }
      }
      disarm = () => { d[Symbol.dispose]() }
    } else {
      spawnSignal = spec.signal
      classify = () => ({ timedOut: false, aborted: spec.signal?.aborted === true })
    }

    const sessionId = spec.sandboxPolicy?.sessionId
    let started: IdeTerminalExecution
    try {
      started = await terminals.execute({
        ...sessionId === undefined ? {} : { sessionId: String(sessionId) },
        command: spec.command,
        cwd: spec.workdir,
        // A background command runs until stopped, so it takes a terminal of its
        // own instead of queueing behind the session's foreground commands.
        dedicated: spec.onExpiry === 'none',
        timeoutMs: spec.timeoutMs,
        ...spawnSignal === undefined ? {} : { signal: spawnSignal },
      })
    } catch (error) {
      disarm()
      throw error instanceof Error ? error : new Error(String(error))
    }

    const buffer = new TerminalOutputBuffer(spec.stdoutMaxBytes)
    let providerFailure: { error: unknown; note: string } | undefined
    let providerFailureReported = false
    const cleanUpDisarm = (): void => { disarm() }
    const consumeProviderFailure = (): string => {
      if (providerFailure === undefined || providerFailureReported) return ''
      providerFailureReported = true
      return providerFailure.note
    }
    const observedStderr: SubprocessOutputReader = {
      readFrom: (fromByte) => {
        if (providerFailure === undefined) return EMPTY_READER.readFrom(fromByte)
        const note = Buffer.from(providerFailure.note, 'utf8')
        return {
          text: note.subarray(Math.min(fromByte, note.length)).toString('utf8'),
          nextOffset: note.length,
          lossy: false,
        }
      },
    }

    const outcome = started.done.then(
      exitCode => ({ exitCode }),
      (error: unknown) => ({ error }),
    )
    let stdoutOffset = 0
    let resultPromise: Promise<ShellRunResult> | undefined

    const pump = (async () => {
      let echoPending = true
      try {
        for await (const chunk of started.output) {
          const text = echoPending ? stripCommandEcho(chunk, spec.command) : chunk
          echoPending = false
          buffer.append(normalizeTerminalOutput(text))
        }
      } catch (error) {
        providerFailure = { error, note: `IDE terminal output failed: ${String(error)}` }
      }
    })()

    const doneGate = Promise.withResolvers<void>()
    const proc: ShellExecution = {
      status: 'running',
      exitCode: null,
      signal: null,
      observed: { stdout: { readFrom: fromByte => buffer.readFrom(fromByte) }, stderr: observedStderr },
      done: doneGate.promise,
      readOutput: (): ShellProcessRead => {
        const out = buffer.readFrom(stdoutOffset)
        stdoutOffset = out.nextOffset
        const failure = consumeProviderFailure()
        const separator = out.text.length > 0 && !out.text.endsWith('\n') ? '\n' : ''
        return { delta: out.text + (failure === '' ? '' : `${separator}[stderr]\n${failure}`), lossy: out.lossy }
      },
      kill: (): boolean => {
        if (proc.status !== 'running') return false
        proc.status = 'killed'
        started.interrupt()
        return true
      },
      result: (): Promise<ShellRunResult> => {
        resultPromise ??= proc.done.then(() => {
          if (providerFailure !== undefined) throw providerFailure.error
          return {
            exitCode: proc.exitCode,
            signal: proc.signal,
            ...classify(),
            timeoutMs: spec.timeoutMs,
            stdout: buffer.toCollected(),
            stderr: EMPTY_OUTPUT,
            // The command ran in the Extension's terminal, which cannot
            // confine; reaching this point means the session asked for exactly
            // that mode, so the fact is reported as it ran.
            sandbox: { mode: 'danger-full-access', denied: false },
          }
        })
        return resultPromise
      },
    }

    // Settlement lives outside the handle literal: it needs the handle itself,
    // and an immediately-invoked initializer could not reference it.
    void (async () => {
      await pump
      const settled = await outcome
      if ('error' in settled) {
        // The bridge failed under the execution: the model reads the note on
        // stderr and the projection rejects with the cause.
        proc.status = 'killed'
        providerFailure ??= { error: settled.error, note: `IDE terminal execution failed: ${String(settled.error)}` }
      } else {
        proc.status = spawnSignal?.aborted === true ? 'killed' : 'completed'
        proc.exitCode = settled.exitCode
      }
      this.onProcessDone(proc, providerFailure?.note ?? '', providerFailure !== undefined, providerFailure?.error)
      cleanUpDisarm()
      doneGate.resolve()
    })()
    return proc
  }
}

export default IdeTerminalBashExecutor
