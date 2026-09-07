/**
 * Host-side bridge listener for Extension and tests.
 * @module @deepseek-ai/dsh-ide-bridge/host
 */

import { createServer, type Server, type Socket } from 'node:net'
import { unlinkSync, existsSync } from 'node:fs'
import { NdjsonSocket } from './ndjson.ts'
import type { BridgeFrame } from './types.ts'

/** One accepted runtime connection. */
export interface IdeBridgeHostConnection {
  /** Send a frame to the runtime. */
  send(frame: BridgeFrame): boolean
  /** Close this connection. */
  close(): void
}

/**
 * Listen on a Unix domain socket (or Windows named pipe path) for ide-bridge.
 */
export class IdeBridgeHostServer {
  private server: Server | undefined
  private readonly connections = new Set<NdjsonSocket>()
  private frameHandler: ((frame: BridgeFrame, connection: IdeBridgeHostConnection) => void) | undefined
  private path: string | undefined

  /**
   * Install the inbound frame handler.
   * @param handler - receives each frame with its connection handle.
   */
  onFrame(handler: (frame: BridgeFrame, connection: IdeBridgeHostConnection) => void): void {
    this.frameHandler = handler
  }

  /**
   * Number of currently open runtime connections.
   * @returns the live connection count.
   */
  connectionCount(): number {
    return this.connections.size
  }

  /**
   * Bind and listen on the given path.
   * @param path - Unix domain socket path or Windows named pipe path.
   * @returns settles when the server is listening.
   */
  listen(path: string): Promise<void> {
    if (this.server !== undefined) {
      return Promise.reject(new Error('IdeBridgeHostServer is already listening'))
    }
    this.path = path
    if (process.platform !== 'win32' && existsSync(path)) {
      unlinkSync(path)
    }
    return new Promise((resolve, reject) => {
      const server = createServer(socket => this.accept(socket))
      this.server = server
      server.once('error', reject)
      server.listen(path, () => {
        server.off('error', reject)
        resolve()
      })
    })
  }

  /** Stop listening and close every connection. Idempotent. */
  async close(): Promise<void> {
    for (const connection of [...this.connections]) connection.close()
    this.connections.clear()
    const server = this.server
    this.server = undefined
    if (server === undefined) return
    await new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined || error === null ? resolve() : reject(error))
    })
    if (this.path !== undefined && process.platform !== 'win32' && existsSync(this.path)) {
      try {
        unlinkSync(this.path)
      } catch {
        // The listen path may already be removed by the OS after close.
      }
    }
    this.path = undefined
  }

  private accept(socket: Socket): void {
    const framing = new NdjsonSocket(socket)
    this.connections.add(framing)
    const handle: IdeBridgeHostConnection = {
      send: frame => framing.send(frame),
      close: () => {
        framing.close()
        this.connections.delete(framing)
      },
    }
    framing.onFrame(frame => this.frameHandler?.(frame, handle))
    socket.once('close', () => {
      this.connections.delete(framing)
    })
  }
}
