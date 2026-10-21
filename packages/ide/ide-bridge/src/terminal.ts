/**
 * Runtime-side provider for the `terminal/exec` frame family: start handshake,
 * output stream, exit code, cancellation, and fail-closed settlement when the
 * Extension refuses the command or the bridge drops mid-execution.
 * @module @deepseek-ai/dsh-ide-bridge/terminal
 */

import { randomUUID } from 'node:crypto'
import type { BridgeFrame, IdeTerminalExecution, IdeTerminalExecRequest } from './types.ts'

/** The two connection facts one execution needs from the bridge client. */
export interface IdeTerminalTransport {
  /** Send one frame; `false` means the write was not accepted. */
  send(frame: BridgeFrame): boolean
  /** Whether the Extension connection is live. */
  readonly connected: boolean
}

/** How long the start handshake may take before the caller stops waiting. */
const START_HANDSHAKE_TIMEOUT_MS = 30_000

/**
 * One in-flight execution: the streams a frame router feeds, plus the state an
 * output iterator reads. `ended` marks that no further chunk can arrive.
 */
export interface PendingIdeTerminalExecution {
  /** The Extension accepted the command line. */
  start(): void
  /** The Extension could not run the command at all. */
  refuse(error: Error): void
  /** One output chunk arrived. */
  output(data: string): void
  /** The execution settled with this exit code. */
  exit(exitCode: number | null): void
  /** The bridge failed under a running execution. */
  fail(error: Error): void
  /** Chunks produced but not yet yielded to the consumer. */
  readonly queue: string[]
  /** Consumers waiting for the next chunk. */
  readonly waiters: Array<() => void>
  /** True once no further chunk can arrive. */
  readonly ended: boolean
}

/** One execution's mutable stream state behind its sink interface. */
type TerminalExecState = PendingIdeTerminalExecution

/**
 * The in-flight executions one bridge connection owns, keyed by frame id.
 * Exported so the plugin can hold the map the frame router and the failure
 * sweep share.
 */
export type IdeTerminalExecutions = Map<string, TerminalExecState>

/**
 * Route one inbound frame to its execution.
 * @param pending - in-flight executions keyed by frame id.
 * @param frame - one validated inbound frame.
 * @returns whether the frame belonged to this family and was claimed.
 */
export function settleTerminalExecFrame(
  pending: IdeTerminalExecutions,
  frame: BridgeFrame,
): boolean {
  switch (frame.kind) {
    case 'terminal/exec/started':
      pending.get(frame.id)?.start()
      return true
    case 'terminal/exec/refused':
      pending.get(frame.id)?.refuse(new Error(frame.error))
      return true
    case 'terminal/exec/output':
      pending.get(frame.id)?.output(frame.data)
      return true
    case 'terminal/exec/exit':
      pending.get(frame.id)?.exit(frame.exitCode)
      return true
    default:
      return false
  }
}

/**
 * Fail every in-flight execution after the bridge dropped: a caller must never
 * keep waiting on a terminal nobody is driving.
 * @param pending - in-flight executions keyed by frame id.
 */
export function failClosedTerminalExecutions(pending: IdeTerminalExecutions): void {
  for (const state of [...pending.values()]) {
    state.fail(new Error('ide-bridge disconnected during a terminal execution'))
  }
}

/**
 * Start one command in an Extension terminal.
 * @param transport - live bridge client surface.
 * @param pending - in-flight executions keyed by frame id.
 * @param request - command, working directory, ownership, and cancellation.
 * @returns the started execution.
 * @throws Error when the bridge is disconnected or its write was refused, and
 *   the Extension's own refusal text when it refused to run the command.
 */
export async function startIdeTerminalExecution(
  transport: IdeTerminalTransport,
  pending: IdeTerminalExecutions,
  request: IdeTerminalExecRequest,
  startTimeoutMs = START_HANDSHAKE_TIMEOUT_MS,
): Promise<IdeTerminalExecution> {
  if (!transport.connected) {
    throw new Error('IDE terminal execution is unavailable: the IDE bridge is not connected')
  }
  const id = randomUUID()
  const start = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<number | null>()
  const queue: string[] = []
  const waiters: Array<() => void> = []
  // A command that named its own deadline should not sit in the terminal queue
  // much past it: the caller has already returned the promoted job by then.
  const handshakeTimeoutMs = Math.min(startTimeoutMs, (request.timeoutMs ?? startTimeoutMs) + 2_000)
  let started = false
  let ended = false
  /** Set when the caller cancelled before the start handshake completed. */
  let deferredCancel: string | undefined
  /** The handshake deadline, cleared by the first frame that settles the start. */
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined
  const clearHandshake = (): void => {
    if (handshakeTimer === undefined) return
    clearTimeout(handshakeTimer)
    handshakeTimer = undefined
  }
  const wake = (): void => {
    for (const waiter of waiters.splice(0)) waiter()
  }

  const state: TerminalExecState = {
    queue,
    waiters,
    get ended() { return ended },
    start: () => {
      clearHandshake()
      started = true
      start.resolve()
      if (deferredCancel !== undefined) {
        const reason = deferredCancel
        deferredCancel = undefined
        transport.send({ kind: 'terminal/exec/cancel', id, reason })
      }
    },
    refuse: (error) => {
      if (ended) return
      clearHandshake()
      ended = true
      pending.delete(id)
      if (started) {
        // The Extension accepted the command and then gave up driving it (its own
        // failure, with no exit frame following): the running execution's consumer
        // takes the refusal text instead of a bare unknown exit code.
        finished.reject(error)
      } else {
        // A refusal before the handshake is the caller's rejection; `finished` still
        // settles so no observer sees an unhandled rejection.
        start.reject(error)
        finished.resolve(null)
      }
      wake()
    },
    output: (data) => {
      if (ended) return
      queue.push(data)
      wake()
    },
    exit: (exitCode) => {
      if (ended) return
      clearHandshake()
      ended = true
      pending.delete(id)
      finished.resolve(exitCode)
      wake()
    },
    fail: (error) => {
      if (ended) return
      clearHandshake()
      ended = true
      pending.delete(id)
      // Before the handshake this is the caller's rejection; after it, `done`
      // carries the failure to the running execution's consumer.
      start.reject(error)
      finished.reject(error)
      wake()
    },
  }
  pending.set(id, state)

  const sent = transport.send({
    kind: 'terminal/exec',
    id,
    ...request.sessionId === undefined ? {} : { sessionId: request.sessionId },
    ...request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs },
    command: request.command,
    cwd: request.cwd,
    dedicated: request.dedicated,
  })
  if (!sent) {
    pending.delete(id)
    throw new Error('IDE terminal execution could not reach the Extension: the bridge write was refused')
  }
  // A frame the Extension never answers must not keep the shell execution (and
  // its job) in preparation forever: a queued command behind a dead terminal is
  // exactly that case, and `job_kill` has no process to reach until this
  // handshake settles.
  handshakeTimer = setTimeout(() => {
    if (ended) return
    handshakeTimer = undefined
    ended = true
    pending.delete(id)
    transport.send({ kind: 'terminal/exec/cancel', id, reason: 'start-timeout' })
    start.reject(new Error(`the IDE terminal did not accept the command within ${handshakeTimeoutMs}ms`))
    finished.resolve(null)
    wake()
  }, handshakeTimeoutMs)

  const cancel = (reason: string): void => {
    if (ended) return
    if (!started) {
      deferredCancel = reason
      return
    }
    transport.send({ kind: 'terminal/exec/cancel', id, reason })
  }
  const signal = request.signal
  if (signal?.aborted === true) cancel('aborted')
  else signal?.addEventListener('abort', () => { cancel('aborted') }, { once: true })

  await start.promise
  return {
    output: streamOf(state),
    done: finished.promise,
    interrupt: () => { cancel('killed') },
  }
}

/**
 * One async iterable over the chunks an execution's frames produced. Iteration
 * ends once the execution settled and the queue drained.
 * @param state - the execution's stream state.
 */
async function* streamOf(state: TerminalExecState): AsyncIterable<string> {
  while (true) {
    const chunk = state.queue.shift()
    if (chunk !== undefined) {
      yield chunk
      continue
    }
    if (state.ended) return
    await new Promise<void>((resolve) => { state.waiters.push(resolve) })
  }
}
