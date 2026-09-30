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
  private disconnectHandler: (() => void) | undefined
  private path: string | undefined

  /**
   * Install the inbound frame handler.
   * @param handler - receives each frame with its connection handle.
   */
  onFrame(handler: (frame: BridgeFrame, connection: IdeBridgeHostConnection) => void): void {
    this.frameHandler = handler
  }

  /**
   * Install a handler invoked when a runtime connection closes (AC-30).
   * @param handler - called after the connection is removed from the set.
   */
  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler
  }

  /**
   * Number of currently open runtime connections.
   * @returns the live connection count.
   */
  connectionCount(): number {
    return this.connections.size
  }

  /**
   * Send one frame to every open runtime connection.
   * @param frame - Host→runtime frame.
   * @returns the number of connections that accepted the write.
   */
  broadcast(frame: BridgeFrame): number {
    let sent = 0
    for (const connection of this.connections) {
      if (connection.send(frame)) sent += 1
    }
    return sent
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
      const server = createServer((socket) => { this.accept(socket) })
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
      server.close((error) => {
        if (error === undefined) {
          resolve()
          return
        }
        reject(error)
      })
    })
    /* v8 ignore if -- closing the listening handle makes libuv unlink the bound Unix path, and a Windows named pipe is not a file. */
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
      this.disconnectHandler?.()
    })
  }
}
