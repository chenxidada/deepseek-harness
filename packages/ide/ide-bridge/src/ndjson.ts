/**
 * Newline-delimited JSON framing over a Node duplex stream (UDS or named pipe).
 * @module @deepseek-ai/dsh-ide-bridge/ndjson
 */

import { StringDecoder } from 'node:string_decoder'
import type { Duplex } from 'node:stream'
import type { BridgeFrame } from './types.ts'

/**
 * Parse one NDJSON line into a {@link BridgeFrame}, or `undefined` when the
 * line is empty or not a recognized frame object.
 * @param line - one trimmed NDJSON line.
 * @returns the frame, or `undefined` when the line should be ignored.
 */
export function parseBridgeFrame(line: string): BridgeFrame | undefined {
  const trimmed = line.trim()
  if (trimmed === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const kind = (value as { kind?: unknown }).kind
  if (typeof kind !== 'string') return undefined
  return value as BridgeFrame
}

/**
 * Attach NDJSON read/write helpers to a caller-owned duplex socket.
 */
export class NdjsonSocket {
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')
  private closed = false
  private frameHandler: ((frame: BridgeFrame) => void) | undefined

  /**
   * @param socket - connected duplex (Unix domain socket or named pipe).
   */
  constructor(private readonly socket: Duplex) {
    this.socket.setEncoding('utf8')
    this.socket.on('data', this.onData)
    this.socket.on('error', this.onError)
    this.socket.on('close', this.onClose)
  }

  /**
   * Install the frame handler, replacing any prior handler.
   * @param handler - invoked for each successfully parsed frame.
   */
  onFrame(handler: (frame: BridgeFrame) => void): void {
    this.frameHandler = handler
  }

  /**
   * Write one frame as a single NDJSON line.
   * @param frame - the frame to send.
   * @returns whether the write was accepted by the stream.
   */
  send(frame: BridgeFrame): boolean {
    if (this.closed || this.socket.destroyed) return false
    return this.socket.write(`${JSON.stringify(frame)}\n`)
  }

  /** Detach listeners and end the socket. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.socket.off('data', this.onData)
    this.socket.off('error', this.onError)
    this.socket.off('close', this.onClose)
    this.socket.destroy()
  }

  private readonly onData = (chunk: string): void => {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      const frame = parseBridgeFrame(line)
      if (frame !== undefined) this.frameHandler?.(frame)
    }
  }

  private readonly onError = (): void => {
    this.close()
  }

  private readonly onClose = (): void => {
    this.closed = true
  }
}
