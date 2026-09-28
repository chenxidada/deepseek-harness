/**
 * Minimal JSON-RPC SDK runtime stand-in for IdeSessionHost unit/integration tests.
 * Answers `initialize` / `session/prompt` / `shutdown` on stdio; ignores argv.
 * When `DSH_IDE_BRIDGE_SOCK` is set, connects as an ide-bridge runtime and answers
 * Host `session/dispose` / `session/delete` / permission frames; optionally emits
 * approval/questions.
 *
 * Env knobs:
 * - `FAKE_FAIL_INIT_WITH_API_KEY`: answer initialize with a JSON-RPC error whose
 *   message embeds `DEEPSEEK_API_KEY` (credentials-leak probe for AC-32).
 * - `FAKE_PENDING_INIT`: never answer initialize, leaving the handshake to time
 *   out (AC-15).
 * - `FAKE_STDERR_LINES`: write this many unique marker lines (`DSH-FAKE-STDERR-<n>`)
 *   to stderr at startup, before exiting (AC-17).
 * - `FAKE_EXIT_CODE`: exit with this code once the startup stderr flush is done
 *   (AC-17, AC-18a).
 * - `FAKE_SELF_SIGNAL`: signal this process with the named signal once the startup
 *   flush is done, so the exit edge reports a signal rather than a code (AC-18b).
 * - `FAKE_PROMPT_LOG`: when set, append each prompt as JSON lines to this path.
 * - `FAKE_APPROVAL_LOG`: append approval response outcomes.
 * - `FAKE_EMIT_APPROVAL_SESSION`: after bridge hello, emit one approval/request
 *   for this sessionId (Phase 3 interaction e2e).
 * - `FAKE_EMIT_QUESTIONS_SESSION`: after bridge hello, emit one user-questions/request.
 * - `FAKE_EXIT_AFTER_MS`: exit the process after N ms (AC-30 child-death probe).
 * - `FAKE_PERMISSION_LOG`: append permission RPC lines.
 * - `FAKE_SETTINGS_LOG`: append settings RPC lines; `settings/describe` answers
 *   one `fake-settings` namespace whose revision moves on each `settings/update`.
 * - `FAKE_SESSION_LIST_CWD`: `session/list` reports this directory as the listed
 *   session's workspace, so a caller's workspace filter has something to match.
 * - `FAKE_SESSION_LIST_LOG`: append session RPC lines.
 * - `FAKE_EMIT_TURN_EVENTS`: after each prompt, stream session.status + session.event
 *   (turn / step / assistant / optional write tool) for timeline tests (Phase 4).
 * - `FAKE_EMIT_WRITE_DIFF`: with turn events, include write tool/call + tool/result
 *   carrying `meta.diffs` for post-hoc Diff (AC-23/25).
 * - `FAKE_SUBAGENT`: with turn events, also emit subagent.started/finished + child event.
 */

import process from 'node:process'
import { createInterface } from 'node:readline'
import { connect } from 'node:net'
import { appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function notify(method, params) {
  write({ jsonrpc: '2.0', method, params })
}

let eventSeq = 0
function event(sessionId, type, data) {
  notify('session.event', {
    sessionId,
    event: { type, seq: eventSeq++, time: Date.now(), data },
  })
}

function emitTurnEvents(sessionId) {
  if (process.env.FAKE_EMIT_TURN_EVENTS === undefined) return
  notify('session.status', { sessionId, status: 'running' })
  event(sessionId, 'turn/start', { turn: 0 })
  event(sessionId, 'step/start', { turn: 0, step: 0 })
  event(sessionId, 'assistant/message', {
    turn: 0,
    step: 0,
    message: {
      id: `fake-assistant-${eventSeq}`,
      role: 'assistant',
      content: [{ type: 'text', text: 'hello from fake timeline runtime' }],
      source: { kind: 'model', provider: 'fake', model: 'fake' },
    },
  })
  if (process.env.FAKE_EMIT_WRITE_DIFF !== undefined) {
    const callId = `fake-call-${eventSeq}`
    const path = 'fake-write.txt'
    event(sessionId, 'tool/call', {
      turn: 0,
      step: 0,
      callId,
      name: 'write',
      arguments: JSON.stringify({ file_path: path, content: 'fake written content' }),
    })
    event(sessionId, 'tool/result', {
      turn: 0,
      step: 0,
      message: {
        id: `fake-tool-result-${eventSeq}`,
        role: 'tool',
        callId,
        name: 'write',
        content: [{ type: 'text', text: 'wrote file' }],
      },
      meta: {
        diffs: [{ path, oldText: '', newText: 'fake written content' }],
      },
    })
  }
  event(sessionId, 'step/end', { turn: 0, step: 0 })
  event(sessionId, 'turn/end', { turn: 0, reason: { kind: 'completed' } })
  if (process.env.FAKE_SUBAGENT !== undefined) {
    const childId = `${sessionId}-child`
    notify('subagent.started', { parentSessionId: sessionId, childSessionId: childId })
    event(childId, 'assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: `fake-child-assistant-${eventSeq}`,
        role: 'assistant',
        content: [{ type: 'text', text: 'child says hi' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    })
    notify('subagent.finished', {
      provider: 'spawn',
      agentId: childId,
      parentSessionId: sessionId,
      childSessionId: childId,
      status: 'ok',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'child says hi' }],
    })
  }
  notify('session.status', { sessionId, status: 'idle' })
}

const sessions = new Set()
let bridgeSocket
let bridgeBuffer = ''

/**
 * Settings state the runtime answers `settings/describe` with. `settings/update`
 * moves the revision, so a Host round-trip observes the write.
 */
let fakeSettingsRevision = 1
function fakeSettingsNamespaces() {
  return [{
    ns: 'fake-settings',
    value: { model: 'fake-model' },
    revision: fakeSettingsRevision,
    secretFields: ['apiKey'],
  }]
}

/**
 * Deterministic `session/list` answer: one session in the workspace the knob names,
 * so a caller's workspace filter has a match, and one in a different workspace.
 */
function fakeSessionList() {
  const here = process.env.FAKE_SESSION_LIST_CWD ?? process.cwd()
  return [
    {
      sessionId: 'fake-listed-here',
      createdAt: 1_700_000_000_000,
      cwd: here,
      title: 'Fake listed session',
    },
    {
      sessionId: 'fake-listed-elsewhere',
      createdAt: 1_700_000_000_001,
      cwd: '/dsh-other-workspace',
      title: 'Elsewhere',
    },
  ]
}

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
      if (frame?.kind === 'session/delete' && typeof frame.id === 'string') {
        // The stand-in holds no session files, so erasing is bookkeeping only; the
        // confirmation is what an explicit delete waits on.
        sessions.delete(frame.sessionId)
        sendBridge({ kind: 'session/delete/response', id: frame.id, ok: true })
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
        continue
      }
      if (frame?.kind === 'session/list' && typeof frame.id === 'string') {
        logLine('FAKE_SESSION_LIST_LOG', { id: frame.id })
        sendBridge({
          kind: 'session/list/response',
          id: frame.id,
          ok: true,
          sessions: fakeSessionList(),
        })
        continue
      }
      if (frame?.kind === 'settings/describe' && typeof frame.id === 'string') {
        logLine('FAKE_SETTINGS_LOG', { kind: 'describe' })
        sendBridge({
          kind: 'settings/describe/response',
          id: frame.id,
          ok: true,
          namespaces: fakeSettingsNamespaces(),
        })
        continue
      }
      if (frame?.kind === 'settings/update' && typeof frame.id === 'string') {
        logLine('FAKE_SETTINGS_LOG', {
          kind: 'update',
          ns: frame.ns,
          patch: frame.patch,
          expectedRevision: frame.expectedRevision,
        })
        fakeSettingsRevision += 1
        sendBridge({
          kind: 'settings/update/response',
          id: frame.id,
          ok: true,
          namespace: { ns: frame.ns, value: frame.patch, revision: fakeSettingsRevision },
        })
      }
    }
  })
  socket.on('error', () => {
    // Host may close first during shutdown; ignore.
  })
}

connectBridge()

/**
 * Startup failure probes: write the marker stderr, then end the process the way
 * the knob asks for. The write callback resolves once the pipe consumed the
 * bytes, and the short delay keeps the exit edge from racing that read, so the
 * parent sees both the stderr and the end state (AC-17, AC-18).
 */
const markerLines = Number(process.env.FAKE_STDERR_LINES ?? '')
if (Number.isFinite(markerLines) && markerLines > 0) {
  const text = Array.from(
    { length: markerLines },
    (_, index) => `DSH-FAKE-STDERR-${index + 1}`,
  ).join('\n')
  process.stderr.write(`${text}\n`, () => {
    setTimeout(() => {
      // `0` is a real exit code and must survive verbatim (AC-18a); only an
      // absent or non-numeric knob falls back to the generic `1`.
      const rawCode = process.env.FAKE_EXIT_CODE
      const code = rawCode === undefined || rawCode === '' ? undefined : Number(rawCode)
      const signal = process.env.FAKE_SELF_SIGNAL
      if (typeof signal === 'string' && signal !== '') {
        process.kill(process.pid, signal)
        return
      }
      bridgeSocket?.destroy()
      process.exit(code !== undefined && Number.isFinite(code) ? code : 1)
    }, 50)
  })
}

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
    if (process.env.FAKE_PENDING_INIT !== undefined) return
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
    // Emit turn stream before the RPC result so clients can observe events
    // while awaiting the prompt receipt (mirrors real runtime ordering).
    emitTurnEvents(sessionId)
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
