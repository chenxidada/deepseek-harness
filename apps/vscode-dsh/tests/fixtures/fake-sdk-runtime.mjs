#!/usr/bin/env node
/**
 * Minimal JSON-RPC SDK runtime stand-in for IdeSessionHost unit/integration tests.
 * Answers `initialize` / `session/prompt` / `shutdown` on stdio; ignores argv.
 * When `DSH_IDE_BRIDGE_SOCK` is set, connects as an ide-bridge runtime and answers
 * Host `session/dispose` / permission frames; optionally emits approval/questions.
 *
 * Env knobs:
 * - `FAKE_FAIL_INIT_WITH_API_KEY`: answer initialize with a JSON-RPC error whose
 *   message embeds `DEEPSEEK_API_KEY` (credentials-leak probe for AC-32).
 * - `FAKE_PROMPT_LOG`: when set, append each prompt as JSON lines to this path.
 * - `FAKE_APPROVAL_LOG`: append approval response outcomes.
 * - `FAKE_EMIT_APPROVAL_SESSION`: after bridge hello, emit one approval/request
 *   for this sessionId (Phase 3 interaction e2e).
 * - `FAKE_EMIT_QUESTIONS_SESSION`: after bridge hello, emit one user-questions/request.
 * - `FAKE_EXIT_AFTER_MS`: exit the process after N ms (AC-30 child-death probe).
 * - `FAKE_PERMISSION_LOG`: append permission RPC lines.
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
let bridgeBuffer = ''

function sendBridge(frame) {
  if (bridgeSocket === undefined || bridgeSocket.destroyed) return false
  bridgeSocket.write(`${JSON.stringify(frame)}\n`)
  return true
}

function logLine(envKey, payload) {
  const logPath = process.env[envKey]
  if (typeof logPath === 'string' && logPath !== '') {
    appendFileSync(logPath, `${JSON.stringify(payload)}\n`)
  }
}

function connectBridge() {
  const path = process.env.DSH_IDE_BRIDGE_SOCK
  if (path === undefined || path === '') return
  const socket = connect(path)
  bridgeSocket = socket
  socket.setEncoding('utf8')
  socket.once('connect', () => {
    socket.write(`${JSON.stringify({ kind: 'hello', role: 'runtime' })}\n`)
    const approvalSession = process.env.FAKE_EMIT_APPROVAL_SESSION
    if (typeof approvalSession === 'string' && approvalSession !== '') {
      setTimeout(() => {
        sendBridge({
          kind: 'approval/request',
          id: `fake-approval-${randomUUID()}`,
          sessionId: approvalSession,
          toolName: 'bash',
          reason: 'fake-runtime approval probe',
        })
      }, 30)
    }
    const questionsSession = process.env.FAKE_EMIT_QUESTIONS_SESSION
    if (typeof questionsSession === 'string' && questionsSession !== '') {
      setTimeout(() => {
        sendBridge({
          kind: 'user-questions/request',
          id: `fake-questions-${randomUUID()}`,
          sessionId: questionsSession,
          questions: [{ id: 'q1', question: 'proceed?', options: [{ label: 'yes' }, { label: 'no' }] }],
        })
      }, 30)
    }
  })
  socket.on('data', (chunk) => {
    bridgeBuffer += chunk
    for (;;) {
      const newline = bridgeBuffer.indexOf('\n')
      if (newline < 0) break
      const line = bridgeBuffer.slice(0, newline)
      bridgeBuffer = bridgeBuffer.slice(newline + 1)
      let frame
      try {
        frame = JSON.parse(line)
      } catch {
        continue
      }
      if (frame?.kind === 'session/dispose' && typeof frame.id === 'string') {
        sessions.delete(frame.sessionId)
        sendBridge({ kind: 'session/dispose/response', id: frame.id, ok: true })
        continue
      }
      if (frame?.kind === 'approval/response' && typeof frame.id === 'string') {
        logLine('FAKE_APPROVAL_LOG', { id: frame.id, outcome: frame.outcome })
        continue
      }
      if (frame?.kind === 'user-questions/response' && typeof frame.id === 'string') {
        logLine('FAKE_QUESTIONS_LOG', {
          id: frame.id,
          answer: frame.answer,
          error: frame.error,
        })
        continue
      }
      if (frame?.kind === 'permission/select' && typeof frame.id === 'string') {
        logLine('FAKE_PERMISSION_LOG', {
          kind: 'select',
          sessionId: frame.sessionId,
          preset: frame.preset,
        })
        sendBridge({
          kind: 'permission/select/response',
          id: frame.id,
          ok: true,
          preset: frame.preset,
        })
        continue
      }
      if (frame?.kind === 'permission/list' && typeof frame.id === 'string') {
        logLine('FAKE_PERMISSION_LOG', { kind: 'list', sessionId: frame.sessionId })
        sendBridge({
          kind: 'permission/list/response',
          id: frame.id,
          ok: true,
          presets: ['workspace-write', 'danger-full-access'],
          current: 'workspace-write',
        })
      }
    }
  })
  socket.on('error', () => {
    // Host may close first during shutdown; ignore.
  })
}

connectBridge()

const exitAfter = Number(process.env.FAKE_EXIT_AFTER_MS ?? '')
if (Number.isFinite(exitAfter) && exitAfter > 0) {
  setTimeout(() => {
    bridgeSocket?.destroy()
    process.exit(1)
  }, exitAfter)
}

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
