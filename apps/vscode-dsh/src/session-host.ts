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
  type BridgeAgentPresetSummary,
  type BridgeApprovalPolicy,
  type BridgeAttachmentRef,
  type BridgeCommandSummary,
  type BridgeFrame,
  type BridgeGoalView,
  type BridgePermissionPreset,
  type BridgeSessionSearchHit,
  type BridgeSkillSummary,
  type BridgeSpecdevSnapshot,
  type BridgeSubagentEntry,
  type IdeBridgeHostConnection,
  type SettingsNamespaceView,
} from '@deepseek-ai/dsh-ide-bridge'
import type { StartErrorKind } from './auto-start-orchestrator.ts'
import { buildIdeChildEnv } from './env.ts'
import { assertNodeExecutable, NodeEnvironmentError, type NodeEnvironmentFailure } from './node-env-guard.ts'
import { DshEntryError, resolveDshEntry, type DshEntryFailure } from './dsh-entry-guard.ts'
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
 * `dsh-entry` means no source provided a dsh CLI entry point, so the failure
 * belongs to the window's environment rather than to dsh either;
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
 * carries the pre-flight `diagnostic` that produced it, and a `dsh-entry`
 * failure carries the entry-resolution diagnostic instead.
 */
export class HostStartError extends Error {
  /** Which start stage failed. */
  readonly kind: HostStartErrorKind
  /** Node pre-flight diagnostic; present exactly when `kind` is `node-environment`. */
  readonly diagnostic: NodeEnvironmentFailure | undefined
  /** dsh entry resolution diagnostic; present exactly when `kind` is `dsh-entry`. */
  readonly entryDiagnostic: DshEntryFailure | undefined

  /**
   * @param kind - which start stage failed.
   * @param message - redacted user-facing message.
   * @param options - original cause and, for pre-flight failures, the diagnostic.
   */
  constructor(
    kind: HostStartErrorKind,
    message: string,
    options: { cause?: unknown; diagnostic?: NodeEnvironmentFailure; entryDiagnostic?: DshEntryFailure } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'HostStartError'
    this.kind = kind
    this.diagnostic = options.diagnostic
    this.entryDiagnostic = options.entryDiagnostic
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
  if (error instanceof DshEntryError) {
    return { kind: 'dsh-entry', hint: error.failure.remedy, detail }
  }
  if (error instanceof DshEntryError) {
    return { kind: 'dsh-entry', hint: error.failure.remedy, detail }
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
  /** Model id (default `deepseek-flash`). */
  model?: string
  /** Optional Harness home for the child. */
  dshHome?: string
  /** Absolute bridge socket path; defaults to a unique temp path. */
  bridgeSockPath?: string
  /** Extra credential env merged after scrub (never logged). */
  credentials?: NodeJS.ProcessEnv
  /** Explicit dsh CLI entry point; wins over every configured and automatic source. */
  dshBin?: string
  /** `dsh.cliPath` setting value used when no explicit entry point is supplied. */
  cliPathSetting?: string
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
  /** Bound (ms) for settings RPC round-trips (default 5000). */
  settingsTimeoutMs?: number
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
  /** Identity of this Host instance; a reader compares it with the Tab controller's Host. */
  readonly instanceId: string = randomUUID()
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
  /**
   * Node executable the last successful resolution produced (AD-1, DEBT-010).
   * Retained past the handshake so a record of the runtime dying *after* it can
   * carry the same executable and source the spawn used, instead of reporting a
   * boundary with fewer facts than the start itself had.
   */
  private nodeExecutable: ResolvedNodeExecutable | undefined
  private disposeTimeoutMs = 5_000
  private cancelTimeoutMs = 5_000
  private forkTimeoutMs = 5_000
  private permissionTimeoutMs = 5_000
  private readLogTimeoutMs = 15_000
  private statTimeoutMs = 5_000
  private projectionTimeoutMs = 5_000
  /** Bound for a content search. Longer than the other round trips because the
   * runtime opens and reconciles its derived index on the first search.
   */
  private searchTimeoutMs = 15_000
  /**
   * Bound for one stored-image read. Longer than an ordinary round trip because
   * the answer carries the image bytes, which can be megabytes.
   */
  private attachmentTimeoutMs = 30_000
  /**
   * Bound for a subagent listing. Longer than an ordinary round trip because a
   * child the runtime no longer holds live is identified by observing its log.
   */
  private subagentListTimeoutMs = 30_000
  /** Bound for one subagent continuation prompt and one interrupt acknowledgement. */
  private subagentTimeoutMs = 10_000
  /** Bound for one SpecDev status read and one gate confirmation. */
  private specdevTimeoutMs = 10_000
  /** Bound for one goal read behind the panel's goal card. */
  private goalTimeoutMs = 10_000
  private approvalPolicyTimeoutMs = 5_000
  private settingsTimeoutMs = 5_000
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
  private readonly pendingDelete = new Map<string, {
    resolve: (ok: boolean) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingRename = new Map<string, {
    resolve: (title: string) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingStat = new Map<string, {
    resolve: (value: SessionStatResult) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingProjection = new Map<string, {
    resolve: (value: SessionProjectionSnapshot) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSearch = new Map<string, {
    resolve: (value: BridgeSessionSearchHit[]) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingAttachment = new Map<string, {
    resolve: (value: StoredAttachmentBytes) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSubagentList = new Map<string, {
    resolve: (value: SubagentListResult) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSubagentPrompt = new Map<string, {
    resolve: (messageId: string) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSubagentInterrupt = new Map<string, {
    resolve: () => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSpecdevSnapshot = new Map<string, {
    resolve: (value: BridgeSpecdevSnapshot | null) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSpecdevGate = new Map<string, {
    resolve: (value: BridgeSpecdevSnapshot | null) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingGoalRead = new Map<string, {
    resolve: (value: BridgeGoalView | null) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingApprovalPolicy = new Map<string, {
    resolve: (value: BridgeApprovalPolicy) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingApprovalPolicySet = new Map<string, {
    resolve: (value: BridgeApprovalPolicy) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingModelList = new Map<string, {
    resolve: (value: ModelListResult) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSessionList = new Map<string, {
    resolve: (rows: HostSessionRow[]) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingModelSelect = new Map<string, {
    resolve: () => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSettingsDescribe = new Map<string, {
    resolve: (namespaces: SettingsNamespaceView[]) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSettingsUpdate = new Map<string, {
    resolve: (namespace: SettingsNamespaceView) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingCommandList = new Map<string, {
    resolve: (commands: BridgeCommandSummary[]) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingCommandExecute = new Map<string, {
    resolve: (result: CommandExecuteResult) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingAgentPresets = new Map<string, {
    resolve: (presets: BridgeAgentPresetSummary[]) => void
    reject: (error: Error) => void
  }>()
  private readonly pendingSkillList = new Map<string, {
    resolve: (skills: BridgeSkillSummary[]) => void
    reject: (error: Error) => void
  }>()
  private resumeTimeoutMs = 15_000
  private deleteTimeoutMs = 5_000
  private renameTimeoutMs = 5_000
  private modelRpcTimeoutMs = 5_000
  private sessionListTimeoutMs = 10_000
  /** Bound (ms) for the three catalog reads the composer's `/` menu needs. */
  private slashCatalogTimeoutMs = 15_000
  /**
   * Bound (ms) for `commands/execute`. A command handler is free to do real work —
   * a workflow start dispatches a subagent — so this is far longer than an RPC bound.
   */
  private commandExecuteTimeoutMs = 120_000
  /** Latest successful `model/list` payload, reused by token-status context window. */
  private modelListCache: ModelListResult | undefined
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
   * Pre-flight the resolved Node executable, resolve the dsh CLI entry point,
   * then listen on the bridge, spawn `dsh --profile ide`, and complete
   * initialize (AC-4, AC-7). Every failure on
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
    this.settingsTimeoutMs = options.settingsTimeoutMs ?? 5_000
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
      this.nodeExecutable = nodeExecutable
      stage = 'preflight'
      await assertNodeExecutable(nodeExecutable)
      // The runtime entry point is resolved next, still before any socket: a window
      // that has a Node but no dsh reports the missing runtime with its diagnostic
      // instead of a module resolution error from the spawn.
      const entry = resolveDshEntry({
        cwd: options.cwd,
        ...options.dshBin === undefined ? {} : { explicitPath: options.dshBin },
        ...options.cliPathSetting === undefined ? {} : { cliPathSetting: options.cliPathSetting },
      })
      if (!entry.ok) throw new DshEntryError(entry.failure)
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
        dshBin: entry.entry.path,
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
        model: options.model ?? 'deepseek-flash',
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
      if (error instanceof DshEntryError) {
        throw new HostStartError('dsh-entry', this.errorMessage, {
          cause: error,
          entryDiagnostic: error.failure,
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
   * Delete one session's persisted data via Host bridge `session/delete`.
   * @param sessionId - Tab-bound SDK session identity.
   * @returns true when the runtime confirmed deletion.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot delete session')
    }
    const id = randomUUID()
    const response = new Promise<boolean>((resolve, reject) => {
      this.pendingDelete.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingDelete.get(id)
      if (pending === undefined) return
      this.pendingDelete.delete(id)
      pending.reject(new Error(`session/delete timed out after ${this.deleteTimeoutMs}ms`))
    }, this.deleteTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'session/delete', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/delete')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingDelete.delete(id)
    }
  }

  /**
   * Accept an explicit user title for one session via Host bridge `session/rename`.
   * @param sessionId - Tab-bound SDK session identity.
   * @param title - title text the user typed; the runtime normalizes it.
   * @returns the normalized title the runtime wrote to the session log.
   */
  async renameSession(sessionId: string, title: string): Promise<string> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot rename session')
    }
    const id = randomUUID()
    const response = new Promise<string>((resolve, reject) => {
      this.pendingRename.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingRename.get(id)
      if (pending === undefined) return
      this.pendingRename.delete(id)
      pending.reject(new Error(`session/rename timed out after ${this.renameTimeoutMs}ms`))
    }, this.renameTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'session/rename', id, sessionId, title })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/rename')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingRename.delete(id)
    }
  }

  /**
   * Observe one session's durable state via Host bridge `session/stat`.
   * @param sessionId - Tab-bound SDK session identity.
   * @returns whether the runtime still stores the session, plus its reported size when known.
   */
  async statSession(sessionId: string): Promise<SessionStatResult> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot stat session')
    }
    const id = randomUUID()
    const response = new Promise<SessionStatResult>((resolve, reject) => {
      this.pendingStat.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingStat.get(id)
      if (pending === undefined) return
      this.pendingStat.delete(id)
      pending.reject(new Error(`session/stat timed out after ${this.statTimeoutMs}ms`))
    }, this.statTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'session/stat', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/stat')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingStat.delete(id)
    }
  }

  /**
   * Read one consistent cut of a live session's registered projection units via
   * Host bridge `projection/read`.
   * @param sessionId - Tab-bound SDK session identity.
   * @param keys - unit keys to view; every client-visible unit when omitted.
   * @returns the values and the log position they reflect.
   */
  async readProjection(sessionId: string, keys?: string[]): Promise<SessionProjectionSnapshot> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot read projection')
    }
    const id = randomUUID()
    const response = new Promise<SessionProjectionSnapshot>((resolve, reject) => {
      this.pendingProjection.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingProjection.get(id)
      if (pending === undefined) return
      this.pendingProjection.delete(id)
      pending.reject(new Error(`projection/read timed out after ${this.projectionTimeoutMs}ms`))
    }, this.projectionTimeoutMs)
    try {
      const sent = bridge.broadcast({
        kind: 'projection/read',
        id,
        sessionId,
        ...keys === undefined ? {} : { keys },
      })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive projection/read')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingProjection.delete(id)
    }
  }

  /**
   * Search the session corpus for content matches via Host bridge `session/search`.
   * @param query - full-text query text, matched against indexed event content.
   * @param limit - maximum sessions in one page.
   * @returns hits ranked by their strongest matching event, each with its snippet.
   */
  async searchSessions(query: string, limit?: number): Promise<BridgeSessionSearchHit[]> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot search sessions')
    }
    const id = randomUUID()
    const response = new Promise<BridgeSessionSearchHit[]>((resolve, reject) => {
      this.pendingSearch.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingSearch.get(id)
      if (pending === undefined) return
      this.pendingSearch.delete(id)
      pending.reject(new Error(`session/search timed out after ${this.searchTimeoutMs}ms`))
    }, this.searchTimeoutMs)
    try {
      const sent = bridge.broadcast({
        kind: 'session/search',
        id,
        query,
        ...limit === undefined ? {} : { limit },
      })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/search')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingSearch.delete(id)
    }
  }

  /**
   * Read one stored image's bytes via Host bridge `attachment/read`. A session
   * log records only the durable reference, so this is how a panel that folded
   * a session from its log renders the images that session sent.
   * @param ref - durable reference the session log recorded.
   * @returns the media type admission verified plus the canonical base64 payload.
   */
  async readAttachment(ref: BridgeAttachmentRef): Promise<StoredAttachmentBytes> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot read an attachment')
    }
    const id = randomUUID()
    const response = new Promise<StoredAttachmentBytes>((resolve, reject) => {
      this.pendingAttachment.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingAttachment.get(id)
      if (pending === undefined) return
      this.pendingAttachment.delete(id)
      pending.reject(new Error(`attachment/read timed out after ${this.attachmentTimeoutMs}ms`))
    }, this.attachmentTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'attachment/read', id, ref })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive attachment/read')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingAttachment.delete(id)
    }
  }

  /**
   * List one session's durable subagent children or its whole subtree via Host
   * bridge `subagent/list`.
   * @param sessionId - parent (`children`) or root (`descendants`) session.
   * @param scope - whether to read direct children or the whole subtree.
   * @returns the rows plus whether the runtime held a live Agent for that session.
   */
  async listSubagents(sessionId: string, scope: 'children' | 'descendants'): Promise<SubagentListResult> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot list subagents')
    }
    const id = randomUUID()
    const response = new Promise<SubagentListResult>((resolve, reject) => {
      this.pendingSubagentList.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingSubagentList.get(id)
      if (pending === undefined) return
      this.pendingSubagentList.delete(id)
      pending.reject(new Error(`subagent/list timed out after ${this.subagentListTimeoutMs}ms`))
    }, this.subagentListTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'subagent/list', id, sessionId, scope })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive subagent/list')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingSubagentList.delete(id)
    }
  }

  /**
   * Deliver one message to a continuable subagent child via Host bridge
   * `subagent/prompt`. Only the child's live direct parent can deliver it, so a
   * refusal names the address rather than a missing route.
   * @param parentSessionId - durable parent whose live Agent delivers the message.
   * @param childSessionId - durable continuable child receiving it.
   * @param text - message text.
   * @returns identity of the message the child's inbox accepted.
   */
  async promptSubagent(parentSessionId: string, childSessionId: string, text: string): Promise<string> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot prompt a subagent')
    }
    const id = randomUUID()
    const response = new Promise<string>((resolve, reject) => {
      this.pendingSubagentPrompt.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingSubagentPrompt.get(id)
      if (pending === undefined) return
      this.pendingSubagentPrompt.delete(id)
      pending.reject(new Error(`subagent/prompt timed out after ${this.subagentTimeoutMs}ms`))
    }, this.subagentTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'subagent/prompt', id, parentSessionId, childSessionId, text })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive subagent/prompt')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingSubagentPrompt.delete(id)
    }
  }

  /**
   * Abort one subagent child's active turn via Host bridge `subagent/interrupt`.
   * The runtime admits an absent or already-finished target as a no-op.
   * @param parentSessionId - durable parent whose authority the request claims.
   * @param childSessionId - durable child whose active turn is aborted.
   */
  async interruptSubagent(parentSessionId: string, childSessionId: string): Promise<void> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot interrupt a subagent')
    }
    const id = randomUUID()
    const response = new Promise<void>((resolve, reject) => {
      this.pendingSubagentInterrupt.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingSubagentInterrupt.get(id)
      if (pending === undefined) return
      this.pendingSubagentInterrupt.delete(id)
      pending.reject(new Error(`subagent/interrupt timed out after ${this.subagentTimeoutMs}ms`))
    }, this.subagentTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'subagent/interrupt', id, parentSessionId, childSessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive subagent/interrupt')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingSubagentInterrupt.delete(id)
    }
  }

  /**
   * Read one session's workspace SpecDev status via Host bridge `specdev/snapshot`.
   * @param sessionId - Tab-bound SDK session identity.
   * @returns the active workflow status, or null when the workspace has none.
   */
  async readSpecdevSnapshot(sessionId: string): Promise<BridgeSpecdevSnapshot | null> {
    return await this.specdevRoundTrip(
      { kind: 'specdev/snapshot', sessionId },
      this.pendingSpecdevSnapshot,
      'specdev/snapshot',
      'cannot read the SpecDev status',
    )
  }

  /**
   * Apply one Human Gate decision via Host bridge `specdev/confirm-gate`. The
   * runtime owns gate ordering and the durable write, so a refusal names the
   * runtime's own reason.
   * @param sessionId - Tab-bound SDK session identity owning the log.
   * @param request - gate, decision, and optional note.
   * @returns the post-change status, or null when the runtime returned none.
   */
  async confirmSpecdevGate(
    sessionId: string,
    request: { gate: string; decision: string; note?: string },
  ): Promise<BridgeSpecdevSnapshot | null> {
    return await this.specdevRoundTrip(
      { kind: 'specdev/confirm-gate', sessionId, ...request },
      this.pendingSpecdevGate,
      'specdev/confirm-gate',
      'cannot confirm the SpecDev gate',
    )
  }

  /**
   * Broadcast one SpecDev frame and await its response, which both frames spell
   * as a nullable snapshot.
   * @param frame - request payload without the round-trip id.
   * @param pending - map holding this frame kind's waiters.
   * @param kind - wire frame kind, used in the failure texts.
   * @param action - verb phrase naming what could not run, used in the hello failure.
   * @returns the answered snapshot, or null when the runtime reported none.
   */
  private async specdevRoundTrip(
    frame:
      | { kind: 'specdev/snapshot'; sessionId: string }
      | { kind: 'specdev/confirm-gate'; sessionId: string; gate: string; decision: string; note?: string },
    pending: Map<string, { resolve: (value: BridgeSpecdevSnapshot | null) => void; reject: (error: Error) => void }>,
    kind: 'specdev/snapshot' | 'specdev/confirm-gate',
    action: string,
  ): Promise<BridgeSpecdevSnapshot | null> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error(`ide-bridge runtime is not connected; ${action}`)
    }
    const id = randomUUID()
    const response = new Promise<BridgeSpecdevSnapshot | null>((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const waiting = pending.get(id)
      if (waiting === undefined) return
      pending.delete(id)
      waiting.reject(new Error(`${kind} timed out after ${this.specdevTimeoutMs}ms`))
    }, this.specdevTimeoutMs)
    try {
      const sent = bridge.broadcast({ ...frame, id })
      if (sent === 0) {
        throw new Error(`no ide-bridge runtime connection to receive ${kind}`)
      }
      return await response
    } finally {
      clearTimeout(timer)
      pending.delete(id)
    }
  }

  /**
   * Read one session's goal via Host bridge `goal/read`. The runtime answers the
   * durable phase plus the process-local activation flag the panel needs, so the
   * card never folds the goal log itself.
   * @param sessionId - Tab-bound SDK session identity.
   * @returns the current goal, or null when the session has none.
   */
  async readGoal(sessionId: string): Promise<BridgeGoalView | null> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot read the goal')
    }
    const id = randomUUID()
    const response = new Promise<BridgeGoalView | null>((resolve, reject) => {
      this.pendingGoalRead.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const waiting = this.pendingGoalRead.get(id)
      if (waiting === undefined) return
      this.pendingGoalRead.delete(id)
      waiting.reject(new Error(`goal/read timed out after ${this.goalTimeoutMs}ms`))
    }, this.goalTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'goal/read', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive goal/read')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingGoalRead.delete(id)
    }
  }

  /**
   * Read one session's effective approval policy via Host bridge `approval/policy`.
   * @param sessionId - Tab-bound SDK session identity.
   * @returns the policy every ask for this session resolves under right now.
   */
  async readApprovalPolicy(sessionId: string): Promise<BridgeApprovalPolicy> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot read approval policy')
    }
    const id = randomUUID()
    const response = new Promise<BridgeApprovalPolicy>((resolve, reject) => {
      this.pendingApprovalPolicy.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingApprovalPolicy.get(id)
      if (pending === undefined) return
      this.pendingApprovalPolicy.delete(id)
      pending.reject(new Error(`approval/policy timed out after ${this.approvalPolicyTimeoutMs}ms`))
    }, this.approvalPolicyTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'approval/policy', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive approval/policy')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingApprovalPolicy.delete(id)
    }
  }

  /**
   * Switch one session's approval policy via Host bridge `approval/policy/set`.
   * The runtime logs the change and states it to the model on its next step.
   * @param sessionId - Tab-bound SDK session identity.
   * @param policy - policy to apply for this session.
   * @returns the policy the runtime accepted.
   */
  async setApprovalPolicy(sessionId: string, policy: BridgeApprovalPolicy): Promise<BridgeApprovalPolicy> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot set approval policy')
    }
    const id = randomUUID()
    const response = new Promise<BridgeApprovalPolicy>((resolve, reject) => {
      this.pendingApprovalPolicySet.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingApprovalPolicySet.get(id)
      if (pending === undefined) return
      this.pendingApprovalPolicySet.delete(id)
      pending.reject(new Error(`approval/policy/set timed out after ${this.approvalPolicyTimeoutMs}ms`))
    }, this.approvalPolicyTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'approval/policy/set', id, sessionId, policy })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive approval/policy/set')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingApprovalPolicySet.delete(id)
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
  async listPermissionPresets(sessionId: string): Promise<PermissionPresetList> {
    const result = await this.permissionRpc({
      kind: 'permission/list',
      sessionId,
    })
    if (!result.ok) throw new Error(result.error)
    if (!('options' in result)) throw new Error('unexpected permission/select response for list')
    return { options: result.options, current: result.current }
  }

  /**
   * List available model providers and the current selection via Host bridge `model/list`.
   * @returns providers with models and the current default selection.
   */
  async listModels(): Promise<ModelListResult> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot list models')
    }
    const id = randomUUID()
    const response = new Promise<ModelListResult>((resolve, reject) => {
      this.pendingModelList.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingModelList.get(id)
      if (pending === undefined) return
      this.pendingModelList.delete(id)
      pending.reject(new Error(`model/list timed out after ${this.modelRpcTimeoutMs}ms`))
    }, this.modelRpcTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'model/list', id })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive model/list')
      }
      const result = await response
      this.modelListCache = result
      return result
    } finally {
      clearTimeout(timer)
      this.pendingModelList.delete(id)
    }
  }

  /**
   * Latest successful `model/list` payload, without another bridge round-trip.
   * @returns the cached catalog, or `undefined` before the first successful list.
   */
  cachedModelList(): ModelListResult | undefined {
    return this.modelListCache
  }

  /**
   * Enumerate every session the runtime can see via Host bridge `session/list`.
   * Rows carry the runtime's workspace and projection-cached title, so the History
   * list can show sessions this Extension never opened.
   * @returns one row per session the runtime lists.
   */
  async listSessions(): Promise<HostSessionRow[]> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot list sessions')
    }
    const id = randomUUID()
    const response = new Promise<HostSessionRow[]>((resolve, reject) => {
      this.pendingSessionList.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingSessionList.get(id)
      if (pending === undefined) return
      this.pendingSessionList.delete(id)
      pending.reject(new Error(`session/list timed out after ${this.sessionListTimeoutMs}ms`))
    }, this.sessionListTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'session/list', id })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive session/list')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingSessionList.delete(id)
    }
  }

  /**
   * Enumerate the commands one session can run via Host bridge `commands/list`.
   *
   * The runtime materializes a session that never prompted before answering, so a
   * freshly opened Tab sees the same catalog its first prompt would run against.
   * @param sessionId - session whose agent-scoped command view is requested.
   * @returns the commands the runtime advertises.
   */
  async listCommands(sessionId: string): Promise<BridgeCommandSummary[]> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot list commands')
    }
    const id = randomUUID()
    const response = new Promise<BridgeCommandSummary[]>((resolve, reject) => {
      this.pendingCommandList.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingCommandList.get(id)
      if (pending === undefined) return
      this.pendingCommandList.delete(id)
      pending.reject(new Error(`commands/list timed out after ${this.slashCatalogTimeoutMs}ms`))
    }, this.slashCatalogTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'commands/list', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive commands/list')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingCommandList.delete(id)
    }
  }

  /**
   * Run one slash line against a session without sending it to the model.
   *
   * A line the registry does not resolve comes back `matched: false`, which leaves
   * the caller on the prompt path — the user's text is never dropped.
   * @param sessionId - session that receives the command.
   * @param line - complete slash-command line, e.g. `/compact`.
   * @returns the settled execution, or `matched: false` for an unresolved line.
   */
  async executeCommand(sessionId: string, line: string): Promise<CommandExecuteResult> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot execute a command')
    }
    const id = randomUUID()
    const response = new Promise<CommandExecuteResult>((resolve, reject) => {
      this.pendingCommandExecute.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingCommandExecute.get(id)
      if (pending === undefined) return
      this.pendingCommandExecute.delete(id)
      pending.reject(new Error(`commands/execute timed out after ${this.commandExecuteTimeoutMs}ms`))
    }, this.commandExecuteTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'commands/execute', id, sessionId, line })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive commands/execute')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingCommandExecute.delete(id)
    }
  }

  /**
   * Enumerate the agent presets this deployment can mount via Host bridge
   * `agent-presets/list`. The roster is global: it does not depend on a session.
   * @returns one row per preset, with the deployment's default marked.
   */
  async listAgentPresets(): Promise<BridgeAgentPresetSummary[]> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot list agent presets')
    }
    const id = randomUUID()
    const response = new Promise<BridgeAgentPresetSummary[]>((resolve, reject) => {
      this.pendingAgentPresets.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingAgentPresets.get(id)
      if (pending === undefined) return
      this.pendingAgentPresets.delete(id)
      pending.reject(new Error(`agent-presets/list timed out after ${this.slashCatalogTimeoutMs}ms`))
    }, this.slashCatalogTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'agent-presets/list', id })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive agent-presets/list')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingAgentPresets.delete(id)
    }
  }

  /**
   * Enumerate the skills one session's composition offers to a human command via
   * Host bridge `skills/list`, which returns only user-invocable skills.
   * @param sessionId - session whose composition scopes the catalog.
   * @returns the skills a `/` line may name.
   */
  async listSkills(sessionId: string): Promise<BridgeSkillSummary[]> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot list skills')
    }
    const id = randomUUID()
    const response = new Promise<BridgeSkillSummary[]>((resolve, reject) => {
      this.pendingSkillList.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingSkillList.get(id)
      if (pending === undefined) return
      this.pendingSkillList.delete(id)
      pending.reject(new Error(`skills/list timed out after ${this.slashCatalogTimeoutMs}ms`))
    }, this.slashCatalogTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'skills/list', id, sessionId })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive skills/list')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingSkillList.delete(id)
    }
  }

  /**
   * Select a model via Host bridge `model/select`.
   * @param provider - provider id.
   * @param model - model id.
   * @param reasoningEffort - optional reasoning effort level.
   */
  async selectModel(provider: string, model: string, reasoningEffort?: string): Promise<void> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot select model')
    }
    const id = randomUUID()
    const response = new Promise<void>((resolve, reject) => {
      this.pendingModelSelect.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingModelSelect.get(id)
      if (pending === undefined) return
      this.pendingModelSelect.delete(id)
      pending.reject(new Error(`model/select timed out after ${this.modelRpcTimeoutMs}ms`))
    }, this.modelRpcTimeoutMs)
    try {
      const sent = bridge.broadcast({
        kind: 'model/select',
        id,
        provider,
        model,
        ...reasoningEffort !== undefined ? { reasoningEffort } : {},
      })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive model/select')
      }
      await response
    } finally {
      clearTimeout(timer)
      this.pendingModelSelect.delete(id)
    }
  }

  /**
   * Read every settings namespace via Host bridge `settings/describe`.
   * The runtime redacts `role('secret')` fields before answering.
   * @returns redacted namespace projections.
   */
  async describeSettings(): Promise<SettingsNamespaceView[]> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot describe settings')
    }
    const id = randomUUID()
    const response = new Promise<SettingsNamespaceView[]>((resolve, reject) => {
      this.pendingSettingsDescribe.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingSettingsDescribe.get(id)
      if (pending === undefined) return
      this.pendingSettingsDescribe.delete(id)
      pending.reject(new Error(`settings/describe timed out after ${this.settingsTimeoutMs}ms`))
    }, this.settingsTimeoutMs)
    try {
      const sent = bridge.broadcast({ kind: 'settings/describe', id })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive settings/describe')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingSettingsDescribe.delete(id)
    }
  }

  /**
   * Merge one patch into a settings namespace via Host bridge `settings/update`.
   * @param ns - registered namespace key.
   * @param patch - fields to merge into the namespace's user section.
   * @param expectedRevision - revision the caller read; omitted writes unconditionally.
   * @returns the namespace's redacted view after the write.
   */
  async updateSetting(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<SettingsNamespaceView> {
    const bridge = this.bridge
    if (this.status !== 'connected' || bridge === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    if (!this.bridgeHello) {
      throw new Error('ide-bridge runtime is not connected; cannot update settings')
    }
    const id = randomUUID()
    const response = new Promise<SettingsNamespaceView>((resolve, reject) => {
      this.pendingSettingsUpdate.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      const pending = this.pendingSettingsUpdate.get(id)
      if (pending === undefined) return
      this.pendingSettingsUpdate.delete(id)
      pending.reject(new Error(`settings/update timed out after ${this.settingsTimeoutMs}ms`))
    }, this.settingsTimeoutMs)
    try {
      const sent = bridge.broadcast({
        kind: 'settings/update',
        id,
        ns,
        patch,
        ...expectedRevision === undefined ? {} : { expectedRevision },
      })
      if (sent === 0) {
        throw new Error('no ide-bridge runtime connection to receive settings/update')
      }
      return await response
    } finally {
      clearTimeout(timer)
      this.pendingSettingsUpdate.delete(id)
    }
  }

  /**
   * Ordered shutdown: protocol close, then bridge (AC-3). Fail-closes pending UI (AC-30).
   */
  async shutdown(): Promise<void> {
    await this.shutdownInternal('IdeSessionHost shut down')
    if (this.status !== 'error') this.status = 'disconnected'
  }

  /**
   * Make the live runtime connection die, the way an unexpected runtime exit
   * makes it die (test hook behind `dsh.test.injectDisconnect`, AC-6a).
   *
   * A crash cannot be requested from the runtime, and the client owns the child,
   * so this asks the client to tear that child down without the user-stop
   * bookkeeping (`shutdownInternal`) that marks the watcher stopped. The
   * transport subscription then fails exactly as it does after a runtime exit,
   * and {@link onTransportDeath} records the boundary with the executable and
   * source the start resolved (DEBT-010). Status transitions to `error` as it
   * does for any unexpected death, which is what drives the orchestrator's
   * retry-once path.
   * @returns settlement of the runtime teardown; a no-op unless a live
   *   connection is held, so a call cannot manufacture a death to record.
   */
  async injectRuntimeDeath(): Promise<void> {
    const client = this.client
    if (this.status !== 'connected' || client === undefined) return
    try {
      await client.close()
    } catch {
      // The death edge is the signal; a teardown error adds no fact to it.
    }
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
      } catch (error) {
        if (!stopped) {
          void this.onTransportDeath(error)
        }
      }
    }
    void loop()
    this.transportWatch = () => {
      stopped = true
      subscription.close()
    }
  }

  /**
   * The runtime connection died while the Host held it live.
   *
   * Two cases reach here, and only one of them is a record boundary of its own.
   * A death while the start is still in flight is already spoken for by the
   * awaited `initialize()`, whose rejection `start()` classifies and records, so
   * recording it here too would count one attempt twice (AC-22). A death *after*
   * the handshake has no such owner, so this is where that boundary is recorded
   * (DEBT-010): it carries the executable and source the Host resolved and
   * spawned, plus whatever process end state the transport could report.
   *
   * The record is written before the status transition, so the record exists
   * before any status listener (the orchestrator's retry-once path) can react to
   * the death and start an attempt of its own.
   * @param error - value the transport subscription failed with.
   */
  private async onTransportDeath(error: unknown): Promise<void> {
    if (this.status !== 'connected' && this.status !== 'starting') return
    const afterHandshake = this.status === 'connected'
    const reason = error instanceof Error ? error.message : String(error)
    this.errorMessage = redactSecrets(reason, this.credentials)
    if (afterHandshake) {
      // The boundary is asserted, but it must not be able to skip the teardown below: a Host
      // left believing it is connected after its transport died is a worse failure than a
      // diagnostic that says why it could not be written. A violation therefore becomes the
      // failure text — the record is then absent, which the run's own assertions report.
      try {
        this.recordTransportDeath(reason, error)
      } catch (violation) {
        const message = violation instanceof Error ? violation.message : String(violation)
        this.errorMessage = `${this.errorMessage} — host diagnostic invariant violated: ${message}`
      }
    }
    this.status = 'error'
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
    for (const [id, pending] of this.pendingDelete) {
      this.pendingDelete.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingRename) {
      this.pendingRename.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingModelList) {
      this.pendingModelList.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingSessionList) {
      this.pendingSessionList.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingStat) {
      this.pendingStat.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingProjection) {
      this.pendingProjection.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingGoalRead) {
      this.pendingGoalRead.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingSearch) {
      this.pendingSearch.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingAttachment) {
      this.pendingAttachment.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingSubagentList) {
      this.pendingSubagentList.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingSubagentPrompt) {
      this.pendingSubagentPrompt.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingSubagentInterrupt) {
      this.pendingSubagentInterrupt.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingSpecdevSnapshot) {
      this.pendingSpecdevSnapshot.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingSpecdevGate) {
      this.pendingSpecdevGate.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingApprovalPolicy) {
      this.pendingApprovalPolicy.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingApprovalPolicySet) {
      this.pendingApprovalPolicySet.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingModelSelect) {
      this.pendingModelSelect.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingSettingsDescribe) {
      this.pendingSettingsDescribe.delete(id)
      pending.reject(new Error(reason))
    }
    for (const [id, pending] of this.pendingSettingsUpdate) {
      this.pendingSettingsUpdate.delete(id)
      pending.reject(new Error(reason))
    }
    this.notifyError(this.errorMessage)
  }

  /**
   * Record the runtime connection dying after the handshake (DEBT-010).
   *
   * The record keeps the executable and source the Host resolved and spawned, so
   * the post-handshake boundary reports the same launch facts the start would
   * have reported had it failed; the transport's process end state is carried
   * when it could report one. The kind is `child-exited`: the runtime stopped
   * talking to the Host, which for this transport is the process being gone.
   * @param reason - redacted-ready failure text from the transport.
   * @param error - value the transport subscription failed with.
   */
  private recordTransportDeath(reason: string, error: unknown): void {
    const recorder = this.diagnostics
    if (recorder === undefined) return
    const details = error instanceof TransportClosedError ? error.details : undefined
    // The post-handshake boundary exists only after a start succeeded, and `start` assigns
    // `nodeExecutable` before it can succeed, so both fields are always available here. They
    // are asserted rather than spread conditionally because a record missing them would still
    // parse and still pass a field-*set* check: the launch facts the post-handshake boundary
    // exists to report would simply be absent, and nothing downstream could tell.
    const resolved = this.requireNodeExecutable()
    recorder.record({
      kind: 'child-exited',
      phase: 'post-handshake',
      detail: reason,
      resolvedExecutable: resolved.path,
      source: resolved.source,
      ...details?.exitCode === null || details?.exitCode === undefined ? {} : { exitCode: details.exitCode },
      ...details?.terminationSignal === null || details?.terminationSignal === undefined
        ? {}
        : { terminationSignal: details.terminationSignal },
      ...details === undefined || details.stderrTail.length === 0 ? {} : { stderrTail: details.stderrTail },
    })
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
    if (frame.kind === 'session/delete/response') {
      const pending = this.pendingDelete.get(frame.id)
      if (pending === undefined) return
      this.pendingDelete.delete(frame.id)
      if (frame.ok) {
        pending.resolve(true)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'session/rename/response') {
      const pending = this.pendingRename.get(frame.id)
      if (pending === undefined) return
      this.pendingRename.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.title)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'session/list/response') {
      const pending = this.pendingSessionList.get(frame.id)
      if (pending === undefined) return
      this.pendingSessionList.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.sessions.map(row => ({
          sessionId: row.sessionId,
          createdAt: row.createdAt,
          ...row.cwd === undefined ? {} : { cwd: row.cwd },
          ...row.parentSessionId === undefined ? {} : { parentSessionId: row.parentSessionId },
          ...row.title === undefined ? {} : { title: row.title },
        })))
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'session/stat/response') {
      const pending = this.pendingStat.get(frame.id)
      if (pending === undefined) return
      this.pendingStat.delete(frame.id)
      if (frame.ok) {
        pending.resolve({
          found: frame.found,
          ...frame.eventCount === undefined ? {} : { eventCount: frame.eventCount },
          ...frame.sizeBytes === undefined ? {} : { sizeBytes: frame.sizeBytes },
        })
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'projection/read/response') {
      const pending = this.pendingProjection.get(frame.id)
      if (pending === undefined) return
      this.pendingProjection.delete(frame.id)
      if (frame.ok) {
        pending.resolve({ asOfSeq: frame.asOfSeq, values: frame.values })
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'session/search/response') {
      const pending = this.pendingSearch.get(frame.id)
      if (pending === undefined) return
      this.pendingSearch.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.hits)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'attachment/read/response') {
      const pending = this.pendingAttachment.get(frame.id)
      if (pending === undefined) return
      this.pendingAttachment.delete(frame.id)
      if (frame.ok) {
        pending.resolve({ mediaType: frame.mediaType, data: frame.data })
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'subagent/list/response') {
      const pending = this.pendingSubagentList.get(frame.id)
      if (pending === undefined) return
      this.pendingSubagentList.delete(frame.id)
      if (frame.ok) {
        pending.resolve({ sessionLive: frame.sessionLive, entries: frame.entries })
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'subagent/prompt/response') {
      const pending = this.pendingSubagentPrompt.get(frame.id)
      if (pending === undefined) return
      this.pendingSubagentPrompt.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.messageId)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'subagent/interrupt/response') {
      const pending = this.pendingSubagentInterrupt.get(frame.id)
      if (pending === undefined) return
      this.pendingSubagentInterrupt.delete(frame.id)
      if (frame.ok) {
        pending.resolve()
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'specdev/snapshot/response') {
      const pending = this.pendingSpecdevSnapshot.get(frame.id)
      if (pending === undefined) return
      this.pendingSpecdevSnapshot.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.snapshot)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'goal/read/response') {
      const pending = this.pendingGoalRead.get(frame.id)
      if (pending === undefined) return
      this.pendingGoalRead.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.goal)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'specdev/confirm-gate/response') {
      const pending = this.pendingSpecdevGate.get(frame.id)
      if (pending === undefined) return
      this.pendingSpecdevGate.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.snapshot)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'approval/policy/response') {
      const pending = this.pendingApprovalPolicy.get(frame.id)
      if (pending === undefined) return
      this.pendingApprovalPolicy.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.policy)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'approval/policy/set/response') {
      const pending = this.pendingApprovalPolicySet.get(frame.id)
      if (pending === undefined) return
      this.pendingApprovalPolicySet.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.policy)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'commands/list/response') {
      const pending = this.pendingCommandList.get(frame.id)
      if (pending === undefined) return
      this.pendingCommandList.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.commands.map(row => ({
          name: row.name,
          description: row.description,
          ...row.inputHint === undefined ? {} : { inputHint: row.inputHint },
        })))
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'commands/execute/response') {
      const pending = this.pendingCommandExecute.get(frame.id)
      if (pending === undefined) return
      this.pendingCommandExecute.delete(frame.id)
      if (frame.ok) {
        pending.resolve({
          matched: frame.matched,
          ...frame.outcome === undefined ? {} : {
            outcome: {
              commandId: frame.outcome.commandId,
              ok: frame.outcome.ok,
              ...frame.outcome.text === undefined ? {} : { text: frame.outcome.text },
            },
          },
        })
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'agent-presets/list/response') {
      const pending = this.pendingAgentPresets.get(frame.id)
      if (pending === undefined) return
      this.pendingAgentPresets.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.presets.map(row => ({
          id: row.id,
          isDefault: row.isDefault,
          ...row.name === undefined ? {} : { name: row.name },
          ...row.description === undefined ? {} : { description: row.description },
          ...row.broken === undefined ? {} : { broken: row.broken },
        })))
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'skills/list/response') {
      const pending = this.pendingSkillList.get(frame.id)
      if (pending === undefined) return
      this.pendingSkillList.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.skills.map(row => ({
          name: row.name,
          description: row.description,
          ...row.whenToUse === undefined ? {} : { whenToUse: row.whenToUse },
        })))
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'model/list/response') {
      const pending = this.pendingModelList.get(frame.id)
      if (pending === undefined) return
      this.pendingModelList.delete(frame.id)
      if (frame.ok) {
        pending.resolve({ ok: true, providers: frame.providers, current: frame.current })
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'model/select/response') {
      const pending = this.pendingModelSelect.get(frame.id)
      if (pending === undefined) return
      this.pendingModelSelect.delete(frame.id)
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
    if (frame.kind === 'settings/describe/response') {
      const pending = this.pendingSettingsDescribe.get(frame.id)
      if (pending === undefined) return
      this.pendingSettingsDescribe.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.namespaces)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'settings/update/response') {
      const pending = this.pendingSettingsUpdate.get(frame.id)
      if (pending === undefined) return
      this.pendingSettingsUpdate.delete(frame.id)
      if (frame.ok) {
        pending.resolve(frame.namespace)
        return
      }
      pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'approval/expired' || frame.kind === 'user-questions/expired') {
      // The runtime gave up on this id: retire the wait so a card on screen stops
      // accepting an answer that could no longer reach the call.
      this.interactions.expire(frame.id, frame.reason)
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

  /**
   * The resolved Node executable, asserted rather than optional: every failure boundary past
   * `resolve` reports it as a launch fact, and a boundary that silently dropped it would make
   * the launch unidentifiable in exactly the records that exist to identify it.
   */
  private requireNodeExecutable(): ResolvedNodeExecutable {
    const resolved = this.nodeExecutable
    if (resolved === undefined) {
      throw new Error('IdeSessionHost has no resolved Node executable; a start never reached its pre-flight')
    }
    return resolved
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
    for (const [id, pending] of this.pendingDelete) {
      this.pendingDelete.delete(id)
      pending.reject(new Error(`${reason} during session/delete`))
    }
    for (const [id, pending] of this.pendingRename) {
      this.pendingRename.delete(id)
      pending.reject(new Error(`${reason} during session/rename`))
    }
    for (const [id, pending] of this.pendingModelList) {
      this.pendingModelList.delete(id)
      pending.reject(new Error(`${reason} during model/list`))
    }
    for (const [id, pending] of this.pendingSessionList) {
      this.pendingSessionList.delete(id)
      pending.reject(new Error(`${reason} during session/list`))
    }
    for (const [id, pending] of this.pendingStat) {
      this.pendingStat.delete(id)
      pending.reject(new Error(`${reason} during session/stat`))
    }
    for (const [id, pending] of this.pendingProjection) {
      this.pendingProjection.delete(id)
      pending.reject(new Error(`${reason} during projection/read`))
    }
    for (const [id, pending] of this.pendingSearch) {
      this.pendingSearch.delete(id)
      pending.reject(new Error(`${reason} during session/search`))
    }
    for (const [id, pending] of this.pendingAttachment) {
      this.pendingAttachment.delete(id)
      pending.reject(new Error(`${reason} during attachment/read`))
    }
    for (const [id, pending] of this.pendingSubagentList) {
      this.pendingSubagentList.delete(id)
      pending.reject(new Error(`${reason} during subagent/list`))
    }
    for (const [id, pending] of this.pendingSubagentPrompt) {
      this.pendingSubagentPrompt.delete(id)
      pending.reject(new Error(`${reason} during subagent/prompt`))
    }
    for (const [id, pending] of this.pendingSubagentInterrupt) {
      this.pendingSubagentInterrupt.delete(id)
      pending.reject(new Error(`${reason} during subagent/interrupt`))
    }
    for (const [id, pending] of this.pendingSpecdevSnapshot) {
      this.pendingSpecdevSnapshot.delete(id)
      pending.reject(new Error(`${reason} during specdev/snapshot`))
    }
    for (const [id, pending] of this.pendingSpecdevGate) {
      this.pendingSpecdevGate.delete(id)
      pending.reject(new Error(`${reason} during specdev/confirm-gate`))
    }
    for (const [id, pending] of this.pendingGoalRead) {
      this.pendingGoalRead.delete(id)
      pending.reject(new Error(`${reason} during goal/read`))
    }
    for (const [id, pending] of this.pendingApprovalPolicy) {
      this.pendingApprovalPolicy.delete(id)
      pending.reject(new Error(`${reason} during approval/policy`))
    }
    for (const [id, pending] of this.pendingApprovalPolicySet) {
      this.pendingApprovalPolicySet.delete(id)
      pending.reject(new Error(`${reason} during approval/policy/set`))
    }
    for (const [id, pending] of this.pendingModelSelect) {
      this.pendingModelSelect.delete(id)
      pending.reject(new Error(`${reason} during model/select`))
    }
    for (const [id, pending] of this.pendingSettingsDescribe) {
      this.pendingSettingsDescribe.delete(id)
      pending.reject(new Error(`${reason} during settings/describe`))
    }
    for (const [id, pending] of this.pendingSettingsUpdate) {
      this.pendingSettingsUpdate.delete(id)
      pending.reject(new Error(`${reason} during settings/update`))
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
  | { ok: true; options: BridgePermissionPreset[]; current: string }
  | { ok: false; error: string }

/** Successful model/list bridge response payload. */
export type ModelListResult = {
  ok: true
  providers: Array<{
    id: string
    name: string
    models: Array<{
      id: string
      name: string
      vision?: boolean
      /** Provider-declared prompt capacity for this route, when the runtime reports one. */
      contextWindow?: number
      /** Adapter-declared reasoning efforts this route accepts, when the runtime reports any. */
      reasoningEfforts?: Array<{ id: string; name: string }>
    }>
  }>
  current: { provider: string; model: string; reasoningEffort?: string }
}

/**
 * One session row of a successful `session/list` bridge response.
 * Rows describe every session the runtime can see, across workspaces; the
 * caller filters by working directory.
 */
export interface HostSessionRow {
  sessionId: string
  createdAt: number
  cwd?: string
  parentSessionId?: string
  /** Projection-cached title; absent when the runtime holds no cached title row. */
  title?: string
}

/** Switchable permission presets plus the effective one, from a `permission/list` round trip. */
export interface PermissionPresetList {
  /** Options in table order, each carrying its label and description; `custom` joins while effective. */
  options: BridgePermissionPreset[]
  /** The effective preset value for the session. */
  current: string
}

/** Durable state of one session, from a `session/stat` round trip. */
export interface SessionStatResult {
  /** Whether the runtime still stores a log for the asked session. */
  found: boolean
  /** Recorded event count; present only when the backend reports one. */
  eventCount?: number
  /** Stored byte size; present only when the backend reports one. */
  sizeBytes?: number
}

/** One projection cut of a live session, from a `projection/read` round trip. */
export interface SessionProjectionSnapshot {
  /** Log position every returned value reflects. */
  asOfSeq: number
  /** Client-visible unit views, keyed by unit key. */
  values: Record<string, unknown>
}

/** One stored image's bytes, from an `attachment/read` round trip. */
export interface StoredAttachmentBytes {
  /** Media type admission verified for these bytes. */
  mediaType: string
  /** Canonical base64 of the stored image. */
  data: string
}

/** Durable subagent rows plus the addressed session's live state, from a `subagent/list` round trip. */
export interface SubagentListResult {
  /** Whether the runtime held a live Agent for the addressed session. */
  sessionLive: boolean
  /** Classified child rows and per-candidate diagnostics. */
  entries: BridgeSubagentEntry[]
}

/** Outcome of one Host bridge `commands/execute` round trip. */
export interface CommandExecuteResult {
  /**
   * False when the runtime resolved no command for the line. The caller keeps
   * that text on the prompt path instead of dropping it.
   */
  matched: boolean
  /** Settled outcome; present only for a matched line. */
  outcome?: {
    /** Pairing id of this execution's `command/run` and `command/done` records. */
    commandId: string
    /** Whether the handler reported success. */
    ok: boolean
    /** Result text to render; absent when the handler printed none. */
    text?: string
  }
}

function frameToPermissionResult(
  frame: Extract<BridgeFrame, { kind: 'permission/select/response' | 'permission/list/response' }>,
): PermissionRpcResult {
  if (frame.kind === 'permission/select/response') {
    if (frame.ok) return { ok: true, preset: frame.preset }
    return { ok: false, error: frame.error }
  }
  if (frame.ok) return { ok: true, options: frame.options, current: frame.current }
  return { ok: false, error: frame.error }
}

/** Re-export answer type for tests. */
export type { AskUserQuestionAnswer }

/** Re-export the redacted settings namespace projection the panel forwards. */
export type { SettingsNamespaceView }
