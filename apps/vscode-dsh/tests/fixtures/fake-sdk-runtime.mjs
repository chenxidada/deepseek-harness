#!/usr/bin/env node
/**
 * Minimal JSON-RPC SDK runtime stand-in for IdeSessionHost unit/integration tests.
 * Answers `initialize` / `session/prompt` / `shutdown` on stdio; ignores argv.
 * When `DSH_IDE_BRIDGE_SOCK` is set, connects as an ide-bridge runtime and answers
 * Host `session/dispose` frames (Phase 2 multi-Tab teardown).
 *
 * Env knobs:
 * - `FAKE_FAIL_INIT_WITH_API_KEY`: answer initialize with a JSON-RPC error whose
 *   message embeds `DEEPSEEK_API_KEY` (credentials-leak probe for AC-32).
 * - `FAKE_PROMPT_LOG`: when set, append each prompt as JSON lines to this path.
 */

import process from 'node:process'
import { createInterface } from 'node:readline'
import { connect } from 'node:net'
import { appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const sessions = new Set()
let bridgeSocket

function connectBridge() {
  const path = process.env.DSH_IDE_BRIDGE_SOCK
  if (path === undefined || path === '') return
  const socket = connect(path)
  bridgeSocket = socket
  let buffer = ''
  socket.setEncoding('utf8')
  socket.once('connect', () => {
    socket.write(`${JSON.stringify({ kind: 'hello', role: 'runtime' })}\n`)
  })
  socket.on('data', (chunk) => {
    buffer += chunk
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let frame
      try {
        frame = JSON.parse(line)
      } catch {
        continue
      }
      if (frame?.kind === 'session/dispose' && typeof frame.id === 'string') {
        sessions.delete(frame.sessionId)
        socket.write(`${JSON.stringify({ kind: 'session/dispose/response', id: frame.id, ok: true })}\n`)
      }
    }
  })
  socket.on('error', () => {
    // Host may close first during shutdown; ignore.
  })
}

connectBridge()

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line.trim()) return
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }
  if (frame.method === 'initialize') {
    if (process.env.FAKE_FAIL_INIT_WITH_API_KEY !== undefined) {
      const key = process.env.DEEPSEEK_API_KEY ?? ''
      write({
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: 7, message: `scripted init failure leaked=${key}` },
      })
      return
    }
    write({
      jsonrpc: '2.0',
      id: frame.id,
      result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } },
    })
    return
  }
  if (frame.method === 'session/prompt') {
    const sessionId = frame.params?.sessionId
    const contentBlocks = frame.params?.contentBlocks ?? []
    sessions.add(sessionId)
    const messageId = randomUUID()
    const logPath = process.env.FAKE_PROMPT_LOG
    if (typeof logPath === 'string' && logPath !== '') {
      appendFileSync(logPath, `${JSON.stringify({ sessionId, contentBlocks, messageId })}\n`)
    }
    write({
      jsonrpc: '2.0',
      id: frame.id,
      result: { messageId },
    })
    return
  }
  if (frame.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: frame.id, result: {} })
    bridgeSocket?.destroy()
    process.exit(0)
  }
})
process.stdin.on('end', () => {
  bridgeSocket?.destroy()
  process.exit(0)
})
