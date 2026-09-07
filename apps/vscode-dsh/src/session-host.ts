/**
 * Window-scoped ide session host: bridge listen, spawn, initialize, shutdown.
 * @module @deepseek-ai/dsh-vscode-dsh/session-host
 */

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { HarnessClient, TransportClosedError } from '@deepseek-ai/dsh-sdk-client'
import { IdeBridgeHostServer } from '@deepseek-ai/dsh-ide-bridge'
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
}

/**
 * Owns one ide profile subprocess and its Host bridge for a VS Code window.
 * `status` becomes `connected` only after SDK `initialize` succeeds (AC-1, AC-4).
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

  /**
   * Whether the Host bridge has received a runtime `hello` frame.
   * @returns true after the ide-bridge client connects.
   */
  bridgeConnected(): boolean {
    return this.bridgeHello
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
    const bridgePath = options.bridgeSockPath
      ?? join(tmpdir(), `dsh-ide-bridge-${randomUUID()}.sock`)
    this.bridgePath = bridgePath
    const bridge = new IdeBridgeHostServer()
    this.bridge = bridge
    bridge.onFrame((frame) => {
      if (frame.kind === 'hello' && frame.role === 'runtime') {
        this.bridgeHello = true
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
   * Ordered shutdown: protocol close, then bridge (AC-3).
   */
  async shutdown(): Promise<void> {
    await this.shutdownInternal()
    if (this.status !== 'error') this.status = 'disconnected'
  }

  private async shutdownInternal(): Promise<void> {
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
