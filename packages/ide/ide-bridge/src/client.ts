/**
 * Runtime-side Host bridge client: connect to the Extension-owned socket.
 * @module @deepseek-ai/dsh-ide-bridge/client
 */

import { connect, type Socket } from 'node:net'
import { NdjsonSocket } from './ndjson.ts'
import type { BridgeFrame, IdeBridgeConnectionState } from './types.ts'

/** Mutable connection state shared with the Cordis service. */
export type MutableIdeBridgeState = IdeBridgeConnectionState

/**
 * Connect to a Host bridge path and keep {@link MutableIdeBridgeState} current.
 */
export class IdeBridgeClient {
  private socket: Socket | undefined
  private framing: NdjsonSocket | undefined
  private frameHandler: ((frame: BridgeFrame) => void) | undefined

  /**
   * @param state - shared connection state published on the Cordis context.
   */
  constructor(private readonly state: MutableIdeBridgeState) {}

  /**
   * Install a handler for inbound Host frames.
   * @param handler - invoked for each frame after hello.
   */
  onFrame(handler: (frame: BridgeFrame) => void): void {
    this.frameHandler = handler
  }

  /**
   * Open a connection to the Host socket path recorded in {@link state}.
   * @returns a promise that settles when the TCP/UDS connect attempt finishes.
   */
  connect(): Promise<void> {
    const path = this.state.sockPath
    if (path === null) {
      this.state.connected = false
      this.state.error = 'DSH_IDE_BRIDGE_SOCK is not set'
      return Promise.reject(new Error(this.state.error))
    }
    return new Promise((resolve, reject) => {
      const socket = connect(path)
      this.socket = socket
      let settled = false
      socket.once('connect', () => {
        this.framing = new NdjsonSocket(socket)
        this.framing.onFrame(frame => this.frameHandler?.(frame))
        this.framing.send({ kind: 'hello', role: 'runtime' })
        this.state.connected = true
        this.state.error = undefined
        settled = true
        resolve()
      })
      socket.once('error', (error: Error) => {
        this.state.connected = false
        this.state.error = error.message
        if (!settled) {
          settled = true
          reject(error)
        }
      })
      socket.once('close', () => {
        this.state.connected = false
        this.framing = undefined
        this.socket = undefined
      })
    })
  }

  /**
   * Send one frame when connected.
   * @param frame - the outbound frame.
   * @returns whether the write was accepted.
   */
  send(frame: BridgeFrame): boolean {
    return this.framing?.send(frame) ?? false
  }

  /** Close the socket and clear connection state. */
  close(): void {
    this.framing?.close()
    this.framing = undefined
    this.socket?.destroy()
    this.socket = undefined
    this.state.connected = false
  }
}
