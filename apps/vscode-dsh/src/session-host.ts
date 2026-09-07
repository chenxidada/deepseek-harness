/**
 * Window-scoped ide session host: bridge listen, spawn, initialize, shutdown,
 * multi-session prompt routing, and Host→runtime session dispose.
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
  type BridgeFrame,
} from '@deepseek-ai/dsh-ide-bridge'
import { buildIdeChildEnv } from './env.ts'
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
  private client: HarnessClient | undefined
  private bridge: IdeBridgeHostServer | undefined
  private bridgePath: string | undefined
  private bridgeHello = false
  /** Credentials bag for this session; used only for diagnostic redaction. */
  private credentials: NodeJS.ProcessEnv | undefined
  private disposeTimeoutMs = 5_000
  private readonly pendingDispose = new Map<string, {
    resolve: () => void
    reject: (error: Error) => void
  }>()

  /**
   * Whether the Host bridge has received a runtime `hello` frame.
   * @returns true after the ide-bridge client connects.
   */
  bridgeConnected(): boolean {
    return this.bridgeHello
  }

  /**
   * Absolute bridge socket path while listening, else `undefined`.
   * @returns the listen path used for `DSH_IDE_BRIDGE_SOCK`.
   */
  bridgeSockPath(): string | undefined {
    return this.bridgePath
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
    const bridgePath = options.bridgeSockPath
      ?? join(tmpdir(), `dsh-ide-bridge-${randomUUID()}.sock`)
    this.bridgePath = bridgePath
    const bridge = new IdeBridgeHostServer()
    this.bridge = bridge
    bridge.onFrame((frame: BridgeFrame) => {
      this.onBridgeFrame(frame)
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
      await this.shutdownInternal()
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
   * Ordered shutdown: protocol close, then bridge (AC-3).
   */
  async shutdown(): Promise<void> {
    await this.shutdownInternal()
    if (this.status !== 'error') this.status = 'disconnected'
  }

  private onBridgeFrame(frame: BridgeFrame): void {
    if (frame.kind === 'hello' && frame.role === 'runtime') {
      this.bridgeHello = true
      return
    }
    if (frame.kind !== 'session/dispose/response') return
    const pending = this.pendingDispose.get(frame.id)
    if (pending === undefined) return
    this.pendingDispose.delete(frame.id)
    if (frame.ok) {
      pending.resolve()
      return
    }
    pending.reject(new Error(frame.error))
  }

  private requireClient(): HarnessClient {
    if (this.status !== 'connected' || this.client === undefined) {
      throw new Error('IdeSessionHost is not connected')
    }
    return this.client
  }

  private async shutdownInternal(): Promise<void> {
    for (const [id, pending] of this.pendingDispose) {
      this.pendingDispose.delete(id)
      pending.reject(new Error('IdeSessionHost shut down during session/dispose'))
    }
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
