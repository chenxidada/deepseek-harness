/**
 * Minimal JSON-RPC SDK runtime stand-in for IdeSessionHost unit/integration tests.
 * Answers `initialize` / `session/prompt` / `shutdown` on stdio; ignores argv.
 * When `DSH_IDE_BRIDGE_SOCK` is set, connects as an ide-bridge runtime and answers
 * Host `session/dispose` / `session/delete` / `session/rename` / `session/stat` /
 * `projection/read` / `session/search` / `attachment/read` / `subagent/*` /
 * permission and approval-policy frames; optionally emits approval/questions.
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
 * - `FAKE_RENAME_LOG`: append `session/rename` lines; the stand-in normalizes the
 *   title, commits a `session/title` event, and rejects a title without visible text.
 * - `FAKE_STAT_LOG`: append `session/stat` lines; the stand-in reports `found` for the
 *   ids it was prompted with and `found: false` for every other id.
 * - `FAKE_APPROVAL_POLICY_LOG`: append `approval/policy` read and `approval/policy/set`
 *   write lines; the stand-in starts at `ask` and reports the switched policy back.
 * - `FAKE_PROJECTION_LOG`: append `projection/read` lines; the stand-in answers the
 *   registered units filtered to the requested keys.
 * - `FAKE_SEARCH_LOG`: append `session/search` lines.
 * - `FAKE_SEARCH_BODY`: the indexed sentence a query must appear in to match;
 *   matching answers one hit whose snippet is that sentence.
 * - `FAKE_SEARCH_SESSION`: session id the matched hit reports.
 * - `FAKE_SEARCH_ERROR`: answer `session/search` with this failure text instead
 *   of hits, standing in for a disabled/absent search backend.
 * - `FAKE_ATTACHMENT_LOG`: append `attachment/read` lines.
 * - `FAKE_ATTACHMENT_DATA`: base64 payload `attachment/read` answers
 *   (`ZmFrZQ==` = `fake` when unset).
 * - `FAKE_ATTACHMENT_MEDIA_TYPE`: media type the answer reports; the requested
 *   reference's own type when unset.
 * - `FAKE_ATTACHMENT_ERROR`: answer `attachment/read` with this failure text,
 *   standing in for an object the store no longer holds.
 * - `FAKE_SUBAGENT_LIST_LOG`: append `subagent/list` lines.
 * - `FAKE_SUBAGENT_CHILD` / `FAKE_SUBAGENT_LABEL` / `FAKE_SUBAGENT_MODE` /
 *   `FAKE_SUBAGENT_ACTIVITY`: the one child row `subagent/list` reports.
 * - `FAKE_SUBAGENT_SESSION_LIVE=0`: report that the addressed session has no live Agent.
 * - `FAKE_SUBAGENT_LIST_ERROR`: answer `subagent/list` with this failure text.
 * - `FAKE_SUBAGENT_PROMPT_LOG`: append `subagent/prompt` lines; the stand-in
 *   answers the message id `FAKE_SUBAGENT_MESSAGE_ID`.
 * - `FAKE_SUBAGENT_PROMPT_ERROR`: answer `subagent/prompt` with this failure text.
 * - `FAKE_SUBAGENT_INTERRUPT_LOG`: append `subagent/interrupt` lines.
 * - `FAKE_SUBAGENT_INTERRUPT_ERROR`: answer `subagent/interrupt` with this failure text.
 * - `FAKE_SPECDEV_SNAPSHOT_LOG`: append `specdev/snapshot` lines.
 * - `FAKE_SPECDEV_SLUG` / `FAKE_SPECDEV_STAGE` / `FAKE_SPECDEV_PHASE` /
 *   `FAKE_SPECDEV_PENDING_GATE` (empty for none): the workflow the snapshot reports.
 * - `FAKE_SPECDEV_NONE=1`: report no active workflow.
 * - `FAKE_SPECDEV_SNAPSHOT_ERROR`: answer `specdev/snapshot` with this failure text.
 * - `FAKE_SPECDEV_GATE_LOG`: append `specdev/confirm-gate` lines; the stand-in answers
 *   the post-change status (HG-2 passed, `FAKE_SPECDEV_STAGE_AFTER` as the stage).
 * - `FAKE_SPECDEV_GATE_ERROR`: answer `specdev/confirm-gate` with this failure text.
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
/** Effective approval policy this stand-in reports and switches; `ask` is the composed default. */
let fakeApprovalPolicy = 'ask'
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

/**
 * Client-visible projection views, filtered to the requested keys. The context
 * capacity differs from every Host-side fallback, so a caller showing it proves
 * the runtime's value won.
 */
function fakeProjectionValues(keys) {
  const all = {
    contextPressure: { pressureTokens: 1_200, projectedTokens: 1_500, contextWindow: 200_000 },
    sessionStats: { turns: 1, steps: 1 },
    turnOutline: { turns: [] },
  }
  if (keys === undefined) return all
  return Object.fromEntries(Object.entries(all).filter(([key]) => keys.includes(key)))
}

/**
 * Stand-in rows for `subagent/list`: one child whose classified facts come from
 * the env knobs, placed at depth 1 when the caller asked for the whole tree.
 * @param scope - the listing scope the Host asked for.
 */
function fakeSubagentEntries(scope) {
  const child = {
    kind: 'child',
    sessionId: process.env.FAKE_SUBAGENT_CHILD ?? 'fake-subagent-child',
    mode: process.env.FAKE_SUBAGENT_MODE ?? 'continuable',
    label: process.env.FAKE_SUBAGENT_LABEL ?? 'Fake subagent',
    activity: process.env.FAKE_SUBAGENT_ACTIVITY === 'running' ? 'running' : 'inactive',
    hasChildren: false,
  }
  if (scope !== 'descendants') return [child]
  return [{ ...child, parentSessionId: process.env.FAKE_SUBAGENT_CHILD_PARENT ?? 'fake-parent', depth: 1 }]
}

/**
 * Stand-in SpecDev status for `specdev/snapshot`: a workflow waiting at HG-2
 * with one phase in progress, named by the env knobs.
 */
function fakeSpecdevSnapshot() {
  const stage = process.env.FAKE_SPECDEV_STAGE ?? 'implementation'
  const pendingGate = process.env.FAKE_SPECDEV_PENDING_GATE ?? 'hg2'
  const slug = process.env.FAKE_SPECDEV_SLUG ?? 'fake-workflow'
  return {
    schemaVersion: 4,
    slug,
    stage,
    phase: process.env.FAKE_SPECDEV_PHASE ?? 'phase-1',
    gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' },
    steps: {
      'phase-1': { implementer: 'completed', reviewer: 'in_progress', verifier: 'pending', prototype: 'pending' },
    },
    ui: { workflow: false, phases: { 'phase-1': false } },
    pendingGate: pendingGate === '' ? null : pendingGate,
    loopCount: 1,
    nextAction: 'confirm HG-2',
    techDebtSummary: { blocking: 0, total: 2 },
    plan: [{ id: 'phase-1', dependencies: [], status: 'active' }],
    artifacts: [
      { path: `.specdev/specs/${slug}/design.md`, label: 'design.md', phaseId: null, status: 'ready' },
      { path: `.specdev/specs/${slug}/phase-plan.md`, label: 'phase-plan.md', phaseId: null, status: 'missing' },
    ],
    initiatingCommand: 'feature',
    pipelineMode: 'feature',
  }
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
      if (frame?.kind === 'session/rename' && typeof frame.id === 'string') {
        // Stand-in for `sessionTitle.rename`: the runtime normalizes the text and
        // commits a `session/title` event, which the Host projects as chrome.
        const title = String(frame.title ?? '').trim()
        if (title === '') {
          sendBridge({
            kind: 'session/rename/response',
            id: frame.id,
            ok: false,
            error: 'session title must contain visible characters',
          })
          continue
        }
        logLine('FAKE_RENAME_LOG', { sessionId: frame.sessionId, title })
        event(frame.sessionId, 'session/title', {
          title,
          messageSeqs: [],
          source: { kind: 'user' },
        })
        sendBridge({ kind: 'session/rename/response', id: frame.id, ok: true, title })
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
          options: [
            { value: 'workspace-write', name: 'Workspace write', description: '写入工作区，越界操作先询问' },
            { value: 'danger-full-access', name: 'Full access', description: '不询问，允许全部操作' },
          ],
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
      if (frame?.kind === 'approval/policy' && typeof frame.id === 'string') {
        logLine('FAKE_APPROVAL_POLICY_LOG', { kind: 'read', sessionId: frame.sessionId })
        sendBridge({
          kind: 'approval/policy/response',
          id: frame.id,
          ok: true,
          policy: fakeApprovalPolicy,
        })
        continue
      }
      if (frame?.kind === 'approval/policy/set' && typeof frame.id === 'string') {
        // Stand-in for `approval.setPolicy`: the switch holds until the process ends,
        // and the next read reports it back.
        fakeApprovalPolicy = frame.policy
        logLine('FAKE_APPROVAL_POLICY_LOG', { kind: 'set', sessionId: frame.sessionId, policy: frame.policy })
        sendBridge({
          kind: 'approval/policy/set/response',
          id: frame.id,
          ok: true,
          policy: fakeApprovalPolicy,
        })
        continue
      }
      if (frame?.kind === 'projection/read' && typeof frame.id === 'string') {
        // Stand-in for `sessionProjections.snapshot`: the client-visible units the
        // ide profile registers, filtered to the requested keys.
        const keys = Array.isArray(frame.keys) ? frame.keys : undefined
        logLine('FAKE_PROJECTION_LOG', { sessionId: frame.sessionId, keys: keys ?? null })
        sendBridge({
          kind: 'projection/read/response',
          id: frame.id,
          ok: true,
          asOfSeq: 7,
          values: fakeProjectionValues(keys),
        })
        continue
      }
      if (frame?.kind === 'session/search' && typeof frame.id === 'string') {
        // Stand-in for the runtime's full-text index: the body knob names one
        // sentence, so a caller's query matches a snippet no local index holds.
        logLine('FAKE_SEARCH_LOG', { query: frame.query, limit: frame.limit ?? null })
        const refusal = process.env.FAKE_SEARCH_ERROR
        if (refusal !== undefined) {
          sendBridge({ kind: 'session/search/response', id: frame.id, ok: false, error: refusal })
          continue
        }
        const body = process.env.FAKE_SEARCH_BODY ?? 'indexed body text'
        const hits = frame.query !== '' && body.includes(frame.query)
          ? [{
            sessionId: process.env.FAKE_SEARCH_SESSION ?? 'fake-search-hit',
            createdAt: 1_700_000_000_002,
            cwd: process.env.FAKE_SESSION_LIST_CWD ?? process.cwd(),
            title: 'Fake search hit',
            seq: 3,
            snippet: `…${body}…`,
          }]
          : []
        sendBridge({ kind: 'session/search/response', id: frame.id, ok: true, hits })
        continue
      }
      if (frame?.kind === 'attachment/read' && typeof frame.id === 'string') {
        // Stand-in for the attachment store read: the payload knob is the base64
        // the store would have returned, so a test needs no stored object.
        logLine('FAKE_ATTACHMENT_LOG', {
          attachmentId: frame.ref?.attachmentId ?? null,
          mediaType: frame.ref?.mediaType ?? null,
        })
        const refusal = process.env.FAKE_ATTACHMENT_ERROR
        if (refusal !== undefined) {
          sendBridge({ kind: 'attachment/read/response', id: frame.id, ok: false, error: refusal })
          continue
        }
        sendBridge({
          kind: 'attachment/read/response',
          id: frame.id,
          ok: true,
          mediaType: process.env.FAKE_ATTACHMENT_MEDIA_TYPE ?? frame.ref?.mediaType ?? 'image/png',
          data: process.env.FAKE_ATTACHMENT_DATA ?? 'ZmFrZQ==',
        })
        continue
      }
      if (frame?.kind === 'subagent/list' && typeof frame.id === 'string') {
        // Stand-in for the projection-backed listing: the knobs name the row, so
        // a test can present a child this process never ran.
        logLine('FAKE_SUBAGENT_LIST_LOG', { sessionId: frame.sessionId, scope: frame.scope })
        const refusal = process.env.FAKE_SUBAGENT_LIST_ERROR
        if (refusal !== undefined) {
          sendBridge({ kind: 'subagent/list/response', id: frame.id, ok: false, error: refusal })
          continue
        }
        sendBridge({
          kind: 'subagent/list/response',
          id: frame.id,
          ok: true,
          sessionLive: process.env.FAKE_SUBAGENT_SESSION_LIVE !== '0',
          entries: fakeSubagentEntries(frame.scope),
        })
        continue
      }
      if (frame?.kind === 'subagent/prompt' && typeof frame.id === 'string') {
        logLine('FAKE_SUBAGENT_PROMPT_LOG', {
          parentSessionId: frame.parentSessionId,
          childSessionId: frame.childSessionId,
          text: frame.text,
        })
        const refusal = process.env.FAKE_SUBAGENT_PROMPT_ERROR
        if (refusal !== undefined) {
          sendBridge({ kind: 'subagent/prompt/response', id: frame.id, ok: false, error: refusal })
          continue
        }
        sendBridge({
          kind: 'subagent/prompt/response',
          id: frame.id,
          ok: true,
          messageId: process.env.FAKE_SUBAGENT_MESSAGE_ID ?? 'fake-subagent-message',
        })
        continue
      }
      if (frame?.kind === 'subagent/interrupt' && typeof frame.id === 'string') {
        logLine('FAKE_SUBAGENT_INTERRUPT_LOG', {
          parentSessionId: frame.parentSessionId,
          childSessionId: frame.childSessionId,
        })
        const refusal = process.env.FAKE_SUBAGENT_INTERRUPT_ERROR
        if (refusal !== undefined) {
          sendBridge({ kind: 'subagent/interrupt/response', id: frame.id, ok: false, error: refusal })
          continue
        }
        sendBridge({ kind: 'subagent/interrupt/response', id: frame.id, ok: true })
        continue
      }
      if (frame?.kind === 'specdev/snapshot' && typeof frame.id === 'string') {
        // Stand-in for the workspace `.specdev` read: the knobs name the workflow,
        // so a test can present one this process never created.
        logLine('FAKE_SPECDEV_SNAPSHOT_LOG', { sessionId: frame.sessionId })
        const refusal = process.env.FAKE_SPECDEV_SNAPSHOT_ERROR
        if (refusal !== undefined) {
          sendBridge({ kind: 'specdev/snapshot/response', id: frame.id, ok: false, error: refusal })
          continue
        }
        sendBridge({
          kind: 'specdev/snapshot/response',
          id: frame.id,
          ok: true,
          snapshot: process.env.FAKE_SPECDEV_NONE === '1' ? null : fakeSpecdevSnapshot(),
        })
        continue
      }
      if (frame?.kind === 'specdev/confirm-gate' && typeof frame.id === 'string') {
        logLine('FAKE_SPECDEV_GATE_LOG', {
          sessionId: frame.sessionId,
          gate: frame.gate,
          decision: frame.decision,
          note: frame.note,
        })
        const refusal = process.env.FAKE_SPECDEV_GATE_ERROR
        if (refusal !== undefined) {
          sendBridge({ kind: 'specdev/confirm-gate/response', id: frame.id, ok: false, error: refusal })
          continue
        }
        const before = fakeSpecdevSnapshot()
        sendBridge({
          kind: 'specdev/confirm-gate/response',
          id: frame.id,
          ok: true,
          snapshot: {
            ...before,
            gates: { ...before.gates, hg2: 'passed', hg3: 'pending' },
            pendingGate: null,
            stage: process.env.FAKE_SPECDEV_STAGE_AFTER ?? 'implementation',
          },
        })
        continue
      }
      if (frame?.kind === 'session/stat' && typeof frame.id === 'string') {
        // Stand-in for `sessionPersistence.stat`: the ids this process was prompted with
        // are the ones it still holds; everything else was never stored here.
        const found = sessions.has(frame.sessionId)
        logLine('FAKE_STAT_LOG', { sessionId: frame.sessionId, found })
        sendBridge({
          kind: 'session/stat/response',
          id: frame.id,
          ok: true,
          found,
          ...found ? { eventCount: 2, sizeBytes: 512 } : {},
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
