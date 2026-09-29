/**
 * Auto-start orchestrator: start-reason FSM (AD-CR-1 / AC-1d).
 * Pure TypeScript — no vscode dependency; IdeSessionHost.start goes through {@link StartHostPort}.
 * @module @deepseek-ai/dsh-vscode-dsh/auto-start-orchestrator
 */

/** Who triggered an automatic Start (L1-testable). */
export type StartReason =
  | 'activity-bar'
  | 'conversation-view-visible'
  | 'command-start'
  | 'command-send'
  | 'status-bar'
  | 'manual-retry'
  | 'disconnect-retry'

/** AutoStartOrchestrator lifecycle states (AC-1d). */
export type StartOrchestratorState =
  | 'idle'
  | 'starting'
  | 'pending-start'
  | 'started'
  | 'disconnected'
  | 'failed'

/** Members of {@link StartErrorKind}; the single source for both the type and the guard below. */
const START_ERROR_KINDS = [
  'invalid-setting',
  'missing-credentials',
  'dsh-entry',
  'node-environment',
  'bridge-listen',
  'spawn',
  'handshake-timeout',
  'process-failed',
] as const

/**
 * Redacted connection failure classification, aligned member-for-member with
 * the `HostStartErrorKind` vocabulary a start throws with — `IdeSessionHost.start`
 * or the `StartHostPort` wrapping it — so a typed start failure reaches this
 * snapshot instead of being flattened into the generic member (AD-4):
 * `dsh-entry` when no source provided a dsh CLI entry point,
 * `node-environment` when the Node pre-flight refused the spawn,
 * `invalid-setting` when a Node selection setting held a value of the wrong
 * type, `bridge-listen` when the ide-bridge socket refused to listen, `spawn`
 * when the runtime subprocess could not be launched, `handshake-timeout` when
 * `initialize` exceeded its bound, and `missing-credentials` when the window had
 * none to start with. `process-failed` is the single generic member: a start
 * failure that reports no class stays there rather than in a second umbrella class.
 */
export type StartErrorKind = typeof START_ERROR_KINDS[number]

/**
 * Read the machine-readable class off a thrown start failure, accepting only a
 * member of {@link START_ERROR_KINDS}. An unrecognised or absent `kind` becomes
 * the generic `process-failed` member rather than a class the failure did not
 * report.
 * @param error - value a `StartHostPort.start` implementation threw.
 * @returns the reported class, or `process-failed` when it reported none.
 */
function startErrorKindOf(error: unknown): StartErrorKind {
  const kind: unknown = typeof error === 'object' && error !== null
    ? (error as { kind?: unknown }).kind
    : undefined
  for (const candidate of START_ERROR_KINDS) {
    if (candidate === kind) return candidate
  }
  return 'process-failed'
}

/** Read-only snapshot for L2 hooks / UI projection. */
export interface StartOrchestratorSnapshot {
  state: StartOrchestratorState
  lastReason?: StartReason
  pendingReasons: readonly StartReason[]
  errorKind?: StartErrorKind
  errorMessage?: string
  autoRetryUsed: boolean
}

/**
 * Injected Host start surface (product wraps IdeSessionHost; tests inject spies).
 */
export interface StartHostPort {
  /** Whether an authoritative Host connection is already live. */
  isConnected(): boolean
  /**
   * Start (or reuse) the window Host for `reason`.
   * @param reason - start-reason that won the current run.
   */
  start(reason: StartReason): Promise<void>
  /** Preflight credential presence (env / settings / test override). */
  hasCredentials(): boolean
}

/** Optional listener for ConnectionUi / panel projection. */
export type OrchestratorListener = (snapshot: StartOrchestratorSnapshot) => void

/**
 * Serializes Start requests, owns disconnect retry-once, and exposes a snapshot.
 */
export class AutoStartOrchestrator {
  private state: StartOrchestratorState = 'idle'
  private pending: StartReason[] = []
  private lastReason: StartReason | undefined
  private errorKind: StartErrorKind | undefined
  private errorMessage: string | undefined
  private autoRetryUsed = false
  /** Monotonic generation so late settle after {@link onUserStop} is ignored. */
  private generation = 0
  private readonly listeners = new Set<OrchestratorListener>()
  private startInFlight: Promise<void> | undefined

  /**
   * @param port - Host start port (singleton IdeSessionHost behind product wiring).
   */
  constructor(private readonly port: StartHostPort) {}

  /**
   * Subscribe to snapshot changes (connection-ui / tests).
   * @param listener - receives each snapshot after a transition.
   * @returns disposer.
   */
  onChange(listener: OrchestratorListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Current orchestrator snapshot (immutable pending copy). */
  getSnapshot(): StartOrchestratorSnapshot {
    return {
      state: this.state,
      ...this.lastReason === undefined ? {} : { lastReason: this.lastReason },
      pendingReasons: [...this.pending],
      ...this.errorKind === undefined ? {} : { errorKind: this.errorKind },
      ...this.errorMessage === undefined ? {} : { errorMessage: this.errorMessage },
      autoRetryUsed: this.autoRetryUsed,
    }
  }

  /** Alias for L2 `dsh.test.getStartState`. */
  getStartState(): StartOrchestratorState {
    return this.state
  }

  /**
   * Request a Start for `reason`. Already-connected Hosts reuse without a second start.
   * Concurrent requests during starting coalesce into pending-start (one in-flight start).
   * @param reason - trigger classification.
   */
  async request(reason: StartReason): Promise<void> {
    if (this.port.isConnected()) {
      this.state = 'started'
      this.lastReason = reason
      this.clearError()
      this.notify()
      return
    }
    if (this.state === 'starting' || this.state === 'pending-start') {
      this.pending.push(reason)
      this.state = 'pending-start'
      this.lastReason = reason
      this.notify()
      if (this.startInFlight !== undefined) await this.startInFlight
      return
    }
    await this.runStart(reason)
  }

  /**
   * Non-user-Stop disconnect: leave `started`, enter `disconnected`, retry at most once.
   */
  onUnexpectedDisconnect(): void {
    if (this.state === 'starting' || this.state === 'pending-start') {
      // In-flight start settle path owns the next state.
      return
    }
    if (this.state === 'idle' || this.state === 'failed') {
      return
    }
    this.state = 'disconnected'
    this.clearError()
    this.notify()
    if (!this.autoRetryUsed) {
      this.autoRetryUsed = true
      void this.request('disconnect-retry')
    }
  }

  /**
   * User Stop / window teardown: idle, clear pending, reset auto-retry.
   * Ignores late settle from an in-flight start (HG-2).
   */
  onUserStop(): void {
    this.generation += 1
    this.state = 'idle'
    this.pending.length = 0
    this.autoRetryUsed = false
    this.clearError()
    this.lastReason = undefined
    this.notify()
  }

  private async runStart(reason: StartReason): Promise<void> {
    const generation = this.generation
    this.state = 'starting'
    this.lastReason = reason
    this.clearError()
    this.notify()

    const work = (async () => {
      try {
        if (!this.port.hasCredentials()) {
          const err = Object.assign(new Error('missing credentials'), {
            kind: 'missing-credentials' as const,
          })
          throw err
        }
        await this.port.start(reason)
        if (generation !== this.generation) return
        if (this.port.isConnected()) {
          this.state = 'started'
          this.clearError()
        } else {
          this.state = 'failed'
          this.errorKind = 'process-failed'
          this.errorMessage = 'Host start completed without a live connection'
        }
      } catch (error) {
        if (generation !== this.generation) return
        this.state = 'failed'
        this.errorKind = startErrorKindOf(error)
        this.errorMessage = error instanceof Error ? error.message : String(error)
      } finally {
        if (generation !== this.generation) {
          this.startInFlight = undefined
          return
        }
        const more = this.pending.splice(0)
        this.notify()
        const next = more.at(-1)
        if (next !== undefined && !this.port.isConnected() && generation === this.generation) {
          this.startInFlight = undefined
          await this.runStart(next)
          return
        }
        this.startInFlight = undefined
        this.notify()
      }
    })()

    this.startInFlight = work
    await work
  }

  private clearError(): void {
    this.errorKind = undefined
    this.errorMessage = undefined
  }

  private notify(): void {
    const snap = this.getSnapshot()
    for (const listener of this.listeners) {
      try {
        listener(snap)
      } catch {
        // Listeners must not break orchestrator transitions.
      }
    }
  }
}
