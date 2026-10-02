/**
 * Newline-delimited JSON framing over a Node duplex stream (UDS or named pipe).
 * @module @deepseek-ai/dsh-ide-bridge/ndjson
 */

import { StringDecoder } from 'node:string_decoder'
import type { Duplex } from 'node:stream'
import type { BridgeFrame } from './types.ts'
import { validateBridgeFrame } from './validate.ts'

/**
 * Parse one NDJSON line into a {@link BridgeFrame}, or `undefined` when the
 * line is empty or fails AC-31 validation.
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
  return validateBridgeFrame(value)
}

/**
 * Attach NDJSON read/write helpers to a caller-owned duplex socket.
 */
export class NdjsonSocket {
  /**
   * Chunks of the line currently being received. A `session/read-log/response`
   * carries a whole stored log, so one line can exceed the socket's chunk size
   * by orders of magnitude. Appending to one growing string re-flattens it and
   * re-scans it for the delimiter on every chunk; holding the chunks and joining
   * once per completed line keeps framing linear in the bytes received.
   */
  private pendingLine: string[] = []
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
    /* v8 ignore next -- the constructor calls setEncoding('utf8'), so Node's Readable decodes every chunk before 'data' fires. */
    let rest = typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    while (rest !== '') {
      const newline = rest.indexOf('\n')
      if (newline < 0) {
        this.pendingLine.push(rest)
        return
      }
      const head = rest.slice(0, newline)
      // One join per completed line: cheap while a line spans many chunks, and
      // an empty join while a chunk carries whole lines.
      const line = this.pendingLine.length === 0 ? head : this.pendingLine.join('') + head
      this.pendingLine = []
      rest = rest.slice(newline + 1)
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
