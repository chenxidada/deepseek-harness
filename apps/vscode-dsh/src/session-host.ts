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
  HarnessClient,
  TransportClosedError,
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
import { buildIdeChildEnv } from './env.ts'
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
  /** Bound (ms) for permission RPC round-trips (default 5000). */
  permissionTimeoutMs?: number
}

/**
 * Owns one ide profile subprocess and its Host bridge for a VS Code window.
 * `status` becomes `connected` only after SDK `initialize` succeeds (AC-1, AC-4).
 * Multiple conversation Tabs share this process and route by `sessionId` (AD-1).
 */
export class IdeSessionHost {
  /** Current lifecycle status for UI. */
  status: IdeSessionHostStatus = 'idle'
  /** Redacted diagnostic message when status is `error`. */
  errorMessage: string | undefined
  /** Coordinates approval / questions UI waits bound to Tabs. */
  readonly interactions = new InteractionCoordinator()
  private client: HarnessClient | undefined
  private bridge: IdeBridgeHostServer | undefined
  private bridgePath: string | undefined
  private bridgeHello = false
  /** Credentials bag for this session; used only for diagnostic redaction. */
  private credentials: NodeJS.ProcessEnv | undefined
  private disposeTimeoutMs = 5_000
  private permissionTimeoutMs = 5_000
  private readonly pendingDispose = new Map<string, {
    resolve: () => void
    reject: (error: Error) => void
  }>()
  private readonly pendingPermission = new Map<string, {
    resolve: (value: PermissionRpcResult) => void
    reject: (error: Error) => void
  }>()
  private transportWatch: (() => void) | undefined
  private readonly errorListeners = new Set<(message: string) => void>()

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
   * Listen on the bridge, spawn `dsh --profile ide`, and complete initialize.
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
    this.disposeTimeoutMs = options.disposeTimeoutMs ?? 5_000
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? 5_000
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
    try {
      await bridge.listen(bridgePath)
      const env = buildIdeChildEnv({
        bridgeSock: bridgePath,
        ...options.dshHome === undefined ? {} : { dshHome: options.dshHome },
        ...options.credentials === undefined ? {} : { credentials: options.credentials },
      })
      const client = new HarnessClient({
        profile: 'ide',
        env,
        ...options.dshHome === undefined ? {} : { dshHome: options.dshHome },
        ...options.dshBin === undefined ? {} : { dshBin: options.dshBin },
        ...options.initializeTimeoutMs === undefined
          ? {}
          : { initializeTimeoutMs: options.initializeTimeoutMs },
      })
      this.client = client
      client.start()
      this.watchTransport(client)
      await client.initialize({
        cwd: options.cwd,
        provider: options.provider ?? 'deepseek-official',
        model: options.model ?? 'deepseek-v4-flash',
      })
      this.status = 'connected'
    } catch (error) {
      this.status = 'error'
      const message = error instanceof Error ? error.message : String(error)
      this.errorMessage = redactSecrets(message, this.credentials)
      await this.shutdownInternal('start failed')
      throw new Error(this.errorMessage, { cause: error })
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
        for (;;) await subscription.next()
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
    for (const [id, pending] of this.pendingPermission) {
      this.pendingPermission.delete(id)
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
    for (const [id, pending] of this.pendingPermission) {
      this.pendingPermission.delete(id)
      pending.reject(new Error(`${reason} during permission RPC`))
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
