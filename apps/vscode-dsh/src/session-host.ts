/**
 * Window-scoped ide session host: bridge listen, spawn, initialize, shutdown,
 * multi-session prompt routing, Host→runtime session dispose, and interaction
 * fail-closed (approval / user-questions / permission-presets).
 * @module @deepseek-ai/dsh-vscode-dsh/session-host
 */

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_INITIALIZE_TIMEOUT_MS,
  HarnessClient,
  RequestTimeoutError,
  TransportClosedError,
  resolveNodeExecutableSpec,
  type HarnessNotification,
  type ResolvedNodeExecutable,
  type SdkPromptContentBlock,
} from '@deepseek-ai/dsh-sdk-client'
import {
  IdeBridgeHostServer,
  isApprovalOutcome,
  isAskUserQuestionAnswer,
  type AskUserQuestionAnswer,
  type BridgeFrame,
  type IdeBridgeHostConnection,
} from '@deepseek-ai/dsh-ide-bridge'
import type { StartErrorKind } from './auto-start-orchestrator.ts'
import { buildIdeChildEnv } from './env.ts'
import { assertNodeExecutable, NodeEnvironmentError, type NodeEnvironmentFailure } from './node-env-guard.ts'
import {
  startErrorKindForFailure,
  type HostDiagnosticInput,
  type HostFailureRecorder,
} from './host-diagnostics.ts'
import { InteractionCoordinator, type InteractionUi } from './interaction-coordinator.ts'
import type { ConversationRegistry } from './conversation-registry.ts'
import { redactSecrets } from './redact.ts'

/** Observable session-host lifecycle for UI binding. */
export type IdeSessionHostStatus =
  | 'idle'
  | 'starting'
  | 'connected'
  | 'error'
  | 'disconnected'

/**
 * Class of a failed {@link IdeSessionHost.start}, identical to the
 * {@link StartErrorKind} the auto-start orchestrator projects, so the class
 * survives that hop instead of being flattened. The class of a start failure is
 * the same whether it was thrown by {@link IdeSessionHost.start} or by the
 * `StartHostPort` wrapping it — the latter is where a wrong-typed Node selection
 * setting (`invalid-setting`) is raised. `node-environment` means the
 * spawn was refused by the Node pre-flight, so the failure belongs to the
 * developer's Node installation rather than to dsh (AC-7, AC-9);
 * `invalid-setting` means a Node selection setting held a value of the wrong
 * type, so the failure belongs to that setting's value rather than to dsh;
 * `bridge-listen` means the ide-bridge socket refused to listen (AC-16),
 * `spawn` means the runtime subprocess could not be launched (AC-14), and
 * `handshake-timeout` means `initialize` exceeded its bound (AC-15);
 * `process-failed` is the generic member for a start failure this phase does
 * not classify further — including a child that ran and then exited on its own
 * (AD-4, AD-5).
 */
export type HostStartErrorKind = StartErrorKind

/**
 * Failed start with a machine-readable class. A `node-environment` failure
 * carries the pre-flight `diagnostic` that produced it.
 */
export class HostStartError extends Error {
  /** Which start stage failed. */
  readonly kind: HostStartErrorKind
  /** Pre-flight diagnostic; present exactly when `kind` is `node-environment`. */
  readonly diagnostic: NodeEnvironmentFailure | undefined

  /**
   * @param kind - which start stage failed.
   * @param message - redacted user-facing message.
   * @param options - original cause and, for pre-flight failures, the diagnostic.
   */
  constructor(
    kind: HostStartErrorKind,
    message: string,
    options: { cause?: unknown; diagnostic?: NodeEnvironmentFailure } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'HostStartError'
    this.kind = kind
    this.diagnostic = options.diagnostic
  }
}

/**
 * Port the Host reports start failures to. The Host only classifies the failure;
 * storing it, redacting it and rendering it belong to the sink behind this port
 * (AD-3, AD-13). Extends {@link HostFailureRecorder} — which carries the
 * credential bag used for redaction (AC-21) — with the success edge that closes
 * a failure chain (AC-22).
 */
export interface HostFailureDiagnostics extends HostFailureRecorder {
  /** The start in flight reached `initialize`; it must not be reported as a retry (AC-22). */
  onStartSucceeded(): void
}

/** Which awaited step of {@link IdeSessionHost.start} was running when it failed (AD-3). */
type StartStage = 'resolve' | 'preflight' | 'bridge-listen' | 'client-create' | 'spawn' | 'handshake'

/** Facts the start sequence holds at the moment a boundary failed (AD-3). */
interface StartFailureContext {
  /** Boundary that failed; disambiguates failures the error type cannot classify. */
  stage: StartStage
  /** Bound the child was given for `initialize`, which is the recorded bound (AC-15). */
  initializeTimeoutMs: number
  /** Absolute bridge socket path the Host asked to listen on (AC-16). */
  socketPath: string
  /** Resolved Node executable, present once resolution succeeded. */
  nodeExecutable?: ResolvedNodeExecutable
}

/**
 * Classify one start failure into the boundary it belongs to, without reading
 * its message (AC-20). The error's own type decides for the failures this phase
 * can name from the SDK and the pre-flight; the stage that threw decides the
 * rest — a bare bridge-listen rejection (AC-16) is the only such failure, and
 * anything else deliberately lands on the generic class rather than on a class
 * guessed from text (AD-3, AC-14).
 * @param error - the thrown value.
 * @param context - facts the start sequence held when it failed.
 * @returns the input for one diagnostic record.
 */
function describeStartFailure(error: unknown, context: StartFailureContext): HostDiagnosticInput {
  const detail = error instanceof Error ? error.message : String(error)
  const located = context.nodeExecutable === undefined
    ? {}
    : { resolvedExecutable: context.nodeExecutable.path, source: context.nodeExecutable.source }
  if (error instanceof NodeEnvironmentError) {
    const failure = error.failure
    return {
      kind: 'node-environment',
      resolvedExecutable: failure.executablePath,
      source: failure.source,
      expectedRange: failure.expected,
      missingApis: failure.missingApis,
      hint: failure.remedy,
      detail,
      ...failure.version === undefined ? {} : { nodeVersion: failure.version },
    }
  }
  if (error instanceof TransportClosedError) {
    const details = error.details
    return {
      // A launch that never reached its process is a spawn failure; a process
      // that ran and then ended is a child exit (AD-5).
      kind: details.spawnError === undefined ? 'child-exited' : 'spawn',
      ...located,
      ...details.executable === undefined ? {} : { resolvedExecutable: details.executable },
      ...details.exitCode === null ? {} : { exitCode: details.exitCode },
      ...details.terminationSignal === null ? {} : { terminationSignal: details.terminationSignal },
      stderrTail: details.stderrTail,
      detail,
    }
  }
  if (error instanceof RequestTimeoutError) {
    return {
      kind: 'handshake-timeout',
      handshakeTimeoutMs: context.initializeTimeoutMs,
      ...located,
      socketPath: context.socketPath,
      detail,
    }
  }
  if (context.stage === 'bridge-listen') {
    return { kind: 'bridge-listen', socketPath: context.socketPath, detail, ...located }
  }
  return { kind: 'other', ...located, detail }
}

/** Options for {@link IdeSessionHost.start}. */
export interface IdeSessionHostStartOptions {
  /** Workspace cwd recorded on SDK initialize. */
  cwd: string
  /** Provider route (default `deepseek-official`). */
  provider?: string
  /** Model id (default `deepseek-v4-flash`). */
  model?: string
  /** Optional Harness home for the child. */
  dshHome?: string
  /** Absolute bridge socket path; defaults to a unique temp path. */
  bridgeSockPath?: string
  /** Extra credential env merged after scrub (never logged). */
  credentials?: NodeJS.ProcessEnv
  /** Optional override of the dsh CLI module path for tests. */
  dshBin?: string
  /** Bound (ms) for initialize (default client value). */
  initializeTimeoutMs?: number
  /** Bound (ms) for bridge dispose round-trips (default 5000). */
  disposeTimeoutMs?: number
  /** Bound (ms) for bridge cancel round-trips (default 5000; AD-CUX-3). */
  cancelTimeoutMs?: number
  /** Bound (ms) for bridge fork round-trips (default 5000; AD-CUX-5). */
  forkTimeoutMs?: number
  /** Bound (ms) for permission RPC round-trips (default 5000). */
  permissionTimeoutMs?: number
  /** Resolved Node executable to pre-flight and spawn; resolved from the fields below when omitted (AD-1). */
  nodeExecutable?: ResolvedNodeExecutable
  /** `dsh.nodeBin` setting value used when no resolved executable is supplied. */
  nodeBinSetting?: string
}

/**
 * Owns one ide profile subprocess and its Host bridge for a VS Code window.
 * `status` becomes `connected` only after SDK `initialize` succeeds (AC-1, AC-4).
 * Multiple conversation Tabs share this process and route by `sessionId` (AD-1).
 */
export class IdeSessionHost {
  /** Redacted diagnostic message when status is `error`. */
  errorMessage: string | undefined
  /** Coordinates approval / questions UI waits bound to Tabs. */
  readonly interactions = new InteractionCoordinator()
  private readonly diagnostics: HostFailureDiagnostics | undefined
  private client: HarnessClient | undefined
  private bridge: IdeBridgeHostServer | undefined
  private bridgePath: string | undefined
  private bridgeHello = false
  /** Credentials bag for this session; used only for diagnostic redaction. */
  private credentials: NodeJS.ProcessEnv | undefined
  private disposeTimeoutMs = 5_000
  private cancelTimeoutMs = 5_000
  private forkTimeoutMs = 5_000
  private permissionTimeoutMs = 5_000
  private readLogTimeoutMs = 15_000
  private readonly pendingDispose = new Map<string, {
    resolve: () => void
    reject: (error: Error) => void
  }>()
  private readonly pendingCancel = new Map<string, {
    resolve: () => void
    reject: (error: Error) => void
  }>()
  private readonly pendingFork = new Map<string, {
    resolve: (childSessionId: string) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingPermission = new Map<string, {
    resolve: (value: PermissionRpcResult) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingReadLog = new Map<string, {
    resolve: (events: unknown[]) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingResume = new Map<string, {
    resolve: () => void
    reject: (error: Error) => void
  }>()
  private resumeTimeoutMs = 15_000
  private transportWatch: (() => void) | undefined
  private readonly errorListeners = new Set<(message: string) => void>()
  private readonly notificationListeners = new Set<(notification: HarnessNotification) => void>()
  private readonly statusListeners = new Set<(status: IdeSessionHostStatus) => void>()
  private _status: IdeSessionHostStatus = 'idle'

  /**
   * @param diagnostics - sink for start-failure records, when the extension has one (AC-13).
   */
  constructor(diagnostics?: HostFailureDiagnostics) {
    this.diagnostics = diagnostics
  }

  /** Current lifecycle status for UI. */
  get status(): IdeSessionHostStatus {
    return this._status
  }

  set status(value: IdeSessionHostStatus) {
    if (this._status === value) return
    this._status = value
    for (const listener of this.statusListeners) {
      try {
        listener(value)
      } catch {
        // Status listeners must not interrupt Host lifecycle transitions.
      }
    }
  }

  /**
   * Whether the Host bridge has received a runtime `hello` frame.
   * @returns true after the ide-bridge client connects.
   */
  bridgeConnected(): boolean {
    return this.bridgeHello
  }

  /**
   * Subscribe to asynchronous Host error diagnostics (transport death / AC-30 UI).
   * Listeners fire after `status` becomes `error` and `errorMessage` is set (GAP-005).
   * @param listener - receives the redacted error message.
   * @returns disposer that removes the listener.
   */
  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  /**
   * Subscribe to Host lifecycle status transitions (idle/starting/connected/error/disconnected).
   * @param listener - receives each new status value.
   * @returns disposer that removes the listener.
   */
  onStatusChange(listener: (status: IdeSessionHostStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  /**
   * Subscribe to SDK notifications (session.event / session.status / subagent.*).
   * The transport watcher demultiplexes every notification to listeners while still
   * detecting transport death (AC-13). Listeners must not throw.
   * @param listener - receives each notification payload.
   * @returns disposer that removes the listener.
   */
  onNotification(listener: (notification: HarnessNotification) => void): () => void {
    this.notificationListeners.add(listener)
    return () => {
      this.notificationListeners.delete(listener)
    }
  }

  /**
   * Absolute bridge socket path while listening, else `undefined`.
   * @returns the listen path used for `DSH_IDE_BRIDGE_SOCK`.
   */
  bridgeSockPath(): string | undefined {
    return this.bridgePath
  }

  /**
   * Install the VS Code (or test) interaction UI presenter.
   * @param ui - approval / questions presenter.
   */
  setInteractionUi(ui: InteractionUi): void {
    this.interactions.setUi(ui)
  }

  /**
   * Bind Tab registry for sessionId → Tab routing on inbound interactions (AC-10).
   * @param registry - conversation registry, or `undefined` to clear.
   */
  setConversationRegistry(registry: ConversationRegistry | undefined): void {
    this.interactions.setRegistry(registry)
  }

  /**
   * Pre-flight the resolved Node executable, then listen on the bridge, spawn
   * `dsh --profile ide`, and complete initialize (AC-4, AC-7). Every failure on
   * those boundaries is classified and recorded before it is thrown, so a start
   * that fails leaves an inspectable record rather than only a message (AC-14
   * – AC-18).
   * @param options - workspace and launch options.
   */
  async start(options: IdeSessionHostStartOptions): Promise<void> {
    if (this.status === 'starting' || this.status === 'connected') {
      throw new Error('IdeSessionHost is already started')
    }
    this.status = 'starting'
    this.errorMessage = undefined
    this.bridgeHello = false
    this.credentials = options.credentials
    this.diagnostics?.setCredentials(options.credentials)
    this.disposeTimeoutMs = options.disposeTimeoutMs ?? 5_000
    this.cancelTimeoutMs = options.cancelTimeoutMs ?? 5_000
    this.forkTimeoutMs = options.forkTimeoutMs ?? 5_000
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? 5_000
    // The bound the child is given is also the bound recorded on a timeout, so
    // the record cannot claim a bound the runtime never had (AC-15).
    const initializeTimeoutMs = options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS
    const bridgePath = options.bridgeSockPath
      ?? join(tmpdir(), `dsh-ide-bridge-${randomUUID()}.sock`)
    this.bridgePath = bridgePath
    const bridge = new IdeBridgeHostServer()
    this.bridge = bridge
    bridge.onFrame((frame: BridgeFrame, connection: IdeBridgeHostConnection) => {
      void this.onBridgeFrame(frame, connection)
    })
    bridge.onDisconnect(() => {
      // Runtime socket loss: cancel Host UI waits (AC-30). Runtime answerers
      // independently fail-closed on their disconnect edge.
      if (this.bridgeHello) {
        this.interactions.failClosedAll('ide-bridge runtime disconnected')
      }
    })
    // Boundary the next awaited step can fail on. It disambiguates the one
    // failure this phase cannot classify by type: a bare `Error` from the
    // bridge listen (AD-3, AC-16).
    let stage: StartStage = 'resolve'
    let nodeExecutable: ResolvedNodeExecutable | undefined
    try {
      // Node pre-flight first: a subprocess that cannot run must fail before any
      // socket is opened, and the validated object is the one that gets spawned (AD-1).
      nodeExecutable = options.nodeExecutable ?? resolveNodeExecutableSpec(
        options.nodeBinSetting === undefined ? {} : { nodeBinSetting: options.nodeBinSetting },
      )
      stage = 'preflight'
      await assertNodeExecutable(nodeExecutable)
      stage = 'bridge-listen'
      await bridge.listen(bridgePath)
      const env = buildIdeChildEnv({
        bridgeSock: bridgePath,
        ...options.dshHome === undefined ? {} : { dshHome: options.dshHome },
        ...options.credentials === undefined ? {} : { credentials: options.credentials },
      })
      stage = 'client-create'
      const client = new HarnessClient({
        profile: 'ide',
        env,
        nodeExecutable,
        ...options.dshHome === undefined ? {} : { dshHome: options.dshHome },
        ...options.dshBin === undefined ? {} : { dshBin: options.dshBin },
        initializeTimeoutMs,
      })
      this.client = client
      stage = 'spawn'
      client.start()
      this.watchTransport(client)
      stage = 'handshake'
      await client.initialize({
        cwd: options.cwd,
        provider: options.provider ?? 'deepseek-official',
        model: options.model ?? 'deepseek-v4-flash',
      })
      this.status = 'connected'
      this.diagnostics?.onStartSucceeded()
    } catch (error) {
      this.status = 'error'
      const message = error instanceof Error ? error.message : String(error)
      this.errorMessage = redactSecrets(message, this.credentials)
      const failure = describeStartFailure(error, {
        stage,
        initializeTimeoutMs,
        socketPath: bridgePath,
        ...nodeExecutable === undefined ? {} : { nodeExecutable },
      })
      this.diagnostics?.record(failure)
      await this.shutdownInternal('start failed')
      if (error instanceof NodeEnvironmentError) {
        throw new HostStartError('node-environment', this.errorMessage, {
          cause: error,
          diagnostic: error.failure,
        })
      }
      throw new HostStartError(startErrorKindForFailure(failure.kind), this.errorMessage, { cause: error })
    }
  }

  /**
   * Queue a prompt on the given SDK session (active Tab target, AC-7).
   * @param sessionId - Tab-bound SDK session identity.
   * @param contentBlocks - user content blocks.
   * @returns durable message id from the runtime.
   */
  async prompt(sessionId: string, contentBlocks: SdkPromptContentBlock[]): Promise<string> {
    const client = this.requireClient()
    return client.prompt(sessionId, contentBlocks)
  }

  /**
   * Cancel the active turn via Host bridge `session/cancel` → Agent.cancel (AD-CUX-3).
   * Timeout default 5000ms, no retry; failure/timeout reject for AC-13d fail-closed.
   * @param sessionId - Tab-bound SDK session identity.
   */
  async cancelSession(sessionId: string): Promise<void> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot cancel session')
    }
    const id = randomUUID()
    const response = new Promise<void>((resolve, reject) => {
      this.pendingCancel.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingCancel.get(id)
      if (pending === undefined) return
      this.pendingCancel.delete(id)
      pending.reject(new Error(`session/cancel timed out after ${this.cancelTimeoutMs}ms`))
    }, this.cancelTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'session/cancel', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/cancel')
      }
      await response
    } finally {
      clearTimeout(timer)
      this.pendingCancel.delete(id)
    }
  }

  /**
   * Fork a live parent session via Host bridge `session/fork` (AD-CUX-5).
   * Timeout default 5000ms, no retry.
   * @param parentSessionId - parent Tab-bound SDK session identity.
   * @param options - optional inclusive boundary seq and child id.
   * @returns child session id.
   */
  async forkSession(
    parentSessionId: string,
    options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
  ): Promise<string> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot fork session')
    }
    const id = randomUUID()
    const response = new Promise<string>((resolve, reject) => {
      this.pendingFork.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingFork.get(id)
      if (pending === undefined) return
      this.pendingFork.delete(id)
      pending.reject(new Error(`session/fork timed out after ${this.forkTimeoutMs}ms`))
    }, this.forkTimeoutMs)
    try {
      const sent = bridge.broadcast({
        kind: 'session/fork',
        id,
        parentSessionId,
        ...options?.emptySeed === true ? { emptySeed: true as const } : {},
        ...options?.boundarySeq === undefined ? {} : { boundarySeq: options.boundarySeq },
        ...options?.childSessionId === undefined ? {} : { childSessionId: options.childSessionId },
      })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/fork')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingFork.delete(id)
    }
  }

  /**
   * Dispose one session via Host bridge `session/dispose` (Q-3 / AD-5).
   * Does not add a stdout SDK method.
   * @param sessionId - Tab-bound SDK session identity.
   */
  async disposeSession(sessionId: string): Promise<void> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot dispose session')
    }
    const id = randomUUID()
    const response = new Promise<void>((resolve, reject) => {
      this.pendingDispose.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingDispose.get(id)
      if (pending === undefined) return
      this.pendingDispose.delete(id)
      pending.reject(new Error(`session/dispose timed out after ${this.disposeTimeoutMs}ms`))
    }, this.disposeTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'session/dispose', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/dispose')
      }
      await response
    } finally {
      clearTimeout(timer)
      this.pendingDispose.delete(id)
    }
  }

  /**
   * Cold-read one session log via Host bridge `session/read-log` (T-0a / AD-CU-2).
   * @param sessionId - Tab-bound SDK session identity.
   * @returns cold-balanced authoritative events for ReplayHydrator.
   */
  async readSessionLog(sessionId: string): Promise<unknown[]> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot read session log')
    }
    const id = randomUUID()
    const response = new Promise<unknown[]>((resolve, reject) => {
      this.pendingReadLog.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingReadLog.get(id)
      if (pending === undefined) return
      this.pendingReadLog.delete(id)
      pending.reject(new Error(`session/read-log timed out after ${this.readLogTimeoutMs}ms`))
    }, this.readLogTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'session/read-log', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/read-log')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingReadLog.delete(id)
    }
  }

  /**
   * Resume one session via Host bridge `session/resume` → `agents.resume` (GAP-001).
   * @param sessionId - Tab-bound SDK session identity.
   */
  async resumeSession(sessionId: string): Promise<void> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot resume session')
    }
    const id = randomUUID()
    const response = new Promise<void>((resolve, reject) => {
      this.pendingResume.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingResume.get(id)
      if (pending === undefined) return
      this.pendingResume.delete(id)
      pending.reject(new Error(`session/resume timed out after ${this.resumeTimeoutMs}ms`))
    }, this.resumeTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'session/resume', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/resume')
      }
      await response
    } finally {
      clearTimeout(timer)
      this.pendingResume.delete(id)
    }
  }

  /**
   * Apply a permission-presets name for a session via Host bridge (AC-21 / AC-22).
   * @param sessionId - Tab-bound SDK session identity.
   * @param preset - preset table key owned by dsh-permission-presets.
   */
  async selectPermissionPreset(sessionId: string, preset: string): Promise<string> {
    const result = await this.permissionRpc({
      kind: 'permission/select',
      sessionId,
      preset,
    })
    if (!result.ok) throw new Error(result.error)
    if (!('preset' in result)) throw new Error('unexpected permission/list response for select')
    return result.preset
  }

  /**
   * List permission-presets for a session via Host bridge (AC-21 / AC-22).
   * @param sessionId - Tab-bound SDK session identity.
   */
  async listPermissionPresets(sessionId: string): Promise<{ presets: string[]; current: string }> {
    const result = await this.permissionRpc({
      kind: 'permission/list',
      sessionId,
    })
    if (!result.ok) throw new Error(result.error)
    if (!('presets' in result)) throw new Error('unexpected permission/select response for list')
    return { presets: result.presets, current: result.current }
  }

  /**
   * Ordered shutdown: protocol close, then bridge (AC-3). Fail-closes pending UI (AC-30).
   */
  async shutdown(): Promise<void> {
    await this.shutdownInternal('IdeSessionHost shut down')
    if (this.status !== 'error') this.status = 'disconnected'
  }

  private watchTransport(client: HarnessClient): void {
    this.transportWatch?.()
    const subscription = client.subscribe()
    let stopped = false
    const loop = async (): Promise<void> => {
      try {
        for (;;) {
          const notification = await subscription.next()
          for (const listener of this.notificationListeners) {
            try {
              listener(notification)
            } catch {
              // Listener failures must not interrupt transport death detection.
            }
          }
        }
      } catch {
        if (!stopped) {
          void this.onTransportDeath('SDK transport closed or child process exited')
        }
      }
    }
    void loop()
    this.transportWatch = () => {
      stopped = true
      subscription.close()
    }
  }

  private async onTransportDeath(reason: string): Promise<void> {
    if (this.status !== 'connected' && this.status !== 'starting') return
    this.status = 'error'
    this.errorMessage = redactSecrets(reason, this.credentials)
    this.interactions.failClosedAll(reason)
    for (const [id, pending] of this.pendingDispose) {
      this.pendingDispose.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingCancel) {
      this.pendingCancel.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingFork) {
      this.pendingFork.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingPermission) {
      this.pendingPermission.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingReadLog) {
      this.pendingReadLog.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingResume) {
      this.pendingResume.delete(id)
      pending.reject(new Error(reason))
    }
    this.notifyError(this.errorMessage)
  }

  private notifyError(message: string): void {
    for (const listener of this.errorListeners) {
      try {
        listener(message)
      } catch {
        // Listener failures must not interrupt Host fail-closed cleanup.
      }
    }
  }

  private async onBridgeFrame(
    frame: BridgeFrame,
    connection: IdeBridgeHostConnection,
  ): Promise<void> {
    if (frame.kind === 'hello' && frame.role === 'runtime') {
      this.bridgeHello = true
      return
    }
    if (frame.kind === 'session/dispose/response') {
      const pending = this.pendingDispose.get(frame.id)
      if (pending === undefined) return
      this.pendingDispose.delete(frame.id)
      if (frame.ok) {
        pending.resolve()
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'session/cancel/response') {
      const pending = this.pendingCancel.get(frame.id)
      if (pending === undefined) return
      this.pendingCancel.delete(frame.id)
      if (frame.ok) {
        pending.resolve()
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'session/fork/response') {
      const pending = this.pendingFork.get(frame.id)
      if (pending === undefined) return
      this.pendingFork.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.childSessionId)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'session/read-log/response') {
      const pending = this.pendingReadLog.get(frame.id)
      if (pending === undefined) return
      this.pendingReadLog.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.events)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'session/resume/response') {
      const pending = this.pendingResume.get(frame.id)
      if (pending === undefined) return
      this.pendingResume.delete(frame.id)
      if (frame.ok) {
        pending.resolve()
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'permission/select/response' || frame.kind === 'permission/list/response') {
      const pending = this.pendingPermission.get(frame.id)
      if (pending === undefined) return
      this.pendingPermission.delete(frame.id)
      pending.resolve(frameToPermissionResult(frame))
      return
    }
    if (frame.kind === 'approval/request') {
      const outcome = await this.interactions.handleApproval(frame)
      const legal = isApprovalOutcome(outcome) ? outcome : 'unavailable'
      connection.send({ kind: 'approval/response', id: frame.id, outcome: legal })
      return
    }
    if (frame.kind === 'user-questions/request') {
      try {
        const answer = await this.interactions.handleQuestions(frame)
        if (!isAskUserQuestionAnswer(answer)) {
          connection.send({
            kind: 'user-questions/response',
            id: frame.id,
            error: 'illegal AskUserQuestionAnswer from Host UI',
          })
          return
        }
        connection.send({ kind: 'user-questions/response', id: frame.id, answer })
      } catch (error) {
        connection.send({
          kind: 'user-questions/response',
          id: frame.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  private async permissionRpc(
    request:
      | { kind: 'permission/select'; sessionId: string; preset: string }
      | { kind: 'permission/list'; sessionId: string },
  ): Promise<PermissionRpcResult> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot call permission RPC')
    }
    const id = randomUUID()
    const response = new Promise<PermissionRpcResult>((resolve, reject) => {
      this.pendingPermission.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingPermission.get(id)
      if (pending === undefined) return
      this.pendingPermission.delete(id)
      pending.reject(new Error(`permission RPC timed out after ${this.permissionTimeoutMs}ms`))
    }, this.permissionTimeoutMs)
    try {
      const frame: BridgeFrame = request.kind === 'permission/select'
        ? {
          kind: 'permission/select',
          id,
          sessionId: request.sessionId,
          preset: request.preset,
        }
        : { kind: 'permission/list', id, sessionId: request.sessionId }
      const sent = bridge.broadcast(frame)
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive permission RPC')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingPermission.delete(id)
    }
  }

  private requireClient(): HarnessClient {
    if (this.status !== 'connected' || this.client === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    return this.client
  }

  private async shutdownInternal(reason: string): Promise<void> {
    this.interactions.failClosedAll(reason)
    for (const [id, pending] of this.pendingDispose) {
      this.pendingDispose.delete(id)
      pending.reject(new Error(`${reason} during session/dispose`))
    }
    for (const [id, pending] of this.pendingCancel) {
      this.pendingCancel.delete(id)
      pending.reject(new Error(`${reason} during session/cancel`))
    }
    for (const [id, pending] of this.pendingFork) {
      this.pendingFork.delete(id)
      pending.reject(new Error(`${reason} during session/fork`))
    }
    for (const [id, pending] of this.pendingPermission) {
      this.pendingPermission.delete(id)
      pending.reject(new Error(`${reason} during permission RPC`))
    }
    for (const [id, pending] of this.pendingReadLog) {
      this.pendingReadLog.delete(id)
      pending.reject(new Error(`${reason} during session/read-log`))
    }
    for (const [id, pending] of this.pendingResume) {
      this.pendingResume.delete(id)
      pending.reject(new Error(`${reason} during session/resume`))
    }
    this.transportWatch?.()
    this.transportWatch = undefined
    const client = this.client
    this.client = undefined
    if (client !== undefined) {
      try {
        await client.close()
      } catch (error) {
        if (!(error instanceof TransportClosedError)) {
          // Best-effort dispose; surface later via errorMessage if still starting.
          this.errorMessage ??= redactSecrets(
            error instanceof Error ? error.message : String(error),
            this.credentials,
          )
        }
      }
    }
    const bridge = this.bridge
    this.bridge = undefined
    if (bridge !== undefined) {
      await bridge.close()
    }
    this.bridgeHello = false
    this.bridgePath = undefined
    this.credentials = undefined
  }
}

type PermissionRpcResult =
  | { ok: true; preset: string }
  | { ok: true; presets: string[]; current: string }
  | { ok: false; error: string }

function frameToPermissionResult(
  frame: Extract<BridgeFrame, { kind: 'permission/select/response' | 'permission/list/response' }>,
): PermissionRpcResult {
  if (frame.kind === 'permission/select/response') {
    if (frame.ok) return { ok: true, preset: frame.preset }
    return { ok: false, error: frame.error }
  }
  if (frame.ok) return { ok: true, presets: frame.presets, current: frame.current }
  return { ok: false, error: frame.error }
}

/** Re-export answer type for tests. */
export type { AskUserQuestionAnswer }
