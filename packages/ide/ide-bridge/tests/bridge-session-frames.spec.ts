/**
 * Host-frame handlers for the IDE session/model/settings surface
 * (`session/delete`, `model/list`, `model/select`, `settings/describe`,
 * `settings/update`), their frame validation, and the failure paths the shared
 * dispatch and the approval / user-questions answerers report to the Host.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  IDE_BRIDGE_SOCK_ENV,
  IdeBridgeClient,
  IdeBridgeHostServer,
  NdjsonSocket,
  PERMISSION_PRESETS_SERVICE,
  SESSIONS_SERVICE,
  SDK_SESSION_CANCEL_SERVICE,
  SDK_SESSION_DELETE_SERVICE,
  SDK_SESSION_DISPOSE_SERVICE,
  SDK_SESSION_FORK_SERVICE,
  SDK_SESSION_RESUME_SERVICE,
  SESSION_PERSISTENCE_SERVICE,
  SESSION_PROJECTION_CACHE_SERVICE,
  SESSION_QUERY_SERVICE,
  validateBridgeFrame,
  type BridgeFrame,
  type IdeBridgeConnectionState,
  type IdeBridgeHostConnection,
} from '../src/index.ts'

/** Frames that carry a request id, i.e. everything but hello / error. */
type IdFrame = Extract<BridgeFrame, { id: string }>

/** Every frame the runtime can answer, i.e. all but the handshake. */
type HostFrame = Exclude<BridgeFrame, { kind: 'hello' }>

/** One mounted runtime client plus the Host the test drives it from. */
interface HostHarness {
  /** Host listener the runtime connected to. */
  host: IdeBridgeHostServer
  /** Host context that mounted the runtime client. */
  ctx: Context
  /** Non-hello frames the Host received, in arrival order. */
  received: BridgeFrame[]
  /** Dispose the mounted runtime; repeats are no-ops. */
  dispose(): Promise<void>
}

/** Timeout args kept short so a refused answer cannot be mistaken for a wait. */
const WAIT_MS = 3_000

const dirs: string[] = []
const originalSock = process.env[IDE_BRIDGE_SOCK_ENV]
const openHosts: IdeBridgeHostServer[] = []
const openClients: IdeBridgeClient[] = []

afterEach(async () => {
  for (const client of openClients.splice(0)) client.close()
  for (const host of openHosts.splice(0)) await host.close().catch(() => {
    // A Host whose listen failed still holds a server that refuses to close.
  })
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
  if (originalSock === undefined) Reflect.deleteProperty(process.env, IDE_BRIDGE_SOCK_ENV)
  else process.env[IDE_BRIDGE_SOCK_ENV] = originalSock
})

/** Register a Host for teardown, so a failed assertion cannot leak a listener. */
function trackedHost(): IdeBridgeHostServer {
  const host = new IdeBridgeHostServer()
  openHosts.push(host)
  return host
}

/** Register a runtime client for teardown. */
function trackedClient(state: IdeBridgeConnectionState): IdeBridgeClient {
  const client = new IdeBridgeClient(state)
  openClients.push(client)
  return client
}

/** A fresh temporary directory holding `bridge.sock`. */
async function socketPath(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return join(dir, 'bridge.sock')
}

/**
 * Mount the runtime plugin against a fresh Host socket, run `body`, then tear
 * both down. `provide` registers the service stubs the frame under test reads.
 * @param provide - registers service stubs on the context before `apply`.
 * @param body - assertions to run while the runtime is connected.
 * @param config - ide-bridge config, e.g. a short interaction timeout.
 * @returns whatever `body` returns.
 */
async function withBridge<T>(
  provide: (ctx: Context) => void,
  body: (harness: HostHarness) => Promise<T>,
  config: { interactionTimeoutMs?: number } = {},
): Promise<T> {
  const path = await socketPath('dsh-ide-frames-')
  const host = trackedHost()
  const received: BridgeFrame[] = []
  host.onFrame((frame) => {
    if (frame.kind !== 'hello') received.push(frame)
  })
  await host.listen(path)
  const ctx = new Context()
  provide(ctx)
  process.env[IDE_BRIDGE_SOCK_ENV] = path
  apply(ctx, config)
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await ctx.fiber.dispose()
  }
  try {
    await vi.waitFor(() => {
      expect(host.connectionCount()).toBeGreaterThanOrEqual(1)
    }, { timeout: WAIT_MS })
    return await body({ host, ctx, received, dispose })
  } finally {
    await dispose()
    await host.close()
  }
}

/** Await the response frame carrying `id`. */
async function awaitFrame(received: BridgeFrame[], id: string): Promise<BridgeFrame> {
  await vi.waitFor(() => {
    expect(received.some(frame => frame.kind !== 'hello' && frame.id === id)).toBe(true)
  }, { timeout: WAIT_MS })
  const hit = received.find(frame => frame.kind !== 'hello' && frame.id === id)
  if (hit === undefined) throw new Error(`no bridge response for request ${id}`)
  return hit
}

/**
 * Broadcast one Host request and await its response. The broadcast count also
 * asserts that the runtime holds exactly the one live connection.
 * @param harness - mounted bridge pair.
 * @param frame - Host request frame.
 * @returns the runtime's response frame for `frame.id`.
 */
async function roundTrip(harness: HostHarness, frame: IdFrame): Promise<BridgeFrame> {
  expect(harness.host.broadcast(frame)).toBe(1)
  return await awaitFrame(harness.received, frame.id)
}

/** Await a frame the Host received, proving the runtime processed it. */
async function awaitReceived(
  harness: HostHarness,
  predicate: (frame: BridgeFrame) => boolean,
): Promise<BridgeFrame> {
  await vi.waitFor(() => {
    expect(harness.received.some(predicate)).toBe(true)
  }, { timeout: WAIT_MS })
  const hit = harness.received.find(predicate)
  if (hit === undefined) throw new Error('no matching frame received by the Host')
  return hit
}

/** The Host frame that settles a pending question request. */
function stubAgent(id: string, sessionId: string): Agent {
  return { id, session: { id: sessionId } } as unknown as Agent
}

/** Answer every Host frame with `respond`, keeping the frames the Host sent. */
function hostResponder(
  harness: HostHarness,
  respond: (frame: HostFrame, connection: { send(frame: BridgeFrame): boolean }) => void,
): HostFrame[] {
  const sent: HostFrame[] = []
  harness.host.onFrame((frame, connection) => {
    if (frame.kind === 'hello') return
    sent.push(frame)
    respond(frame, connection)
  })
  return sent
}

describe('ide-bridge delete / model / settings frame validation (AC-31)', () => {
  it('accepts session/delete and drops malformed variants', () => {
    expect(validateBridgeFrame({ kind: 'session/delete', id: 'del-1', sessionId: 'sess-1' }))
      .toEqual({ kind: 'session/delete', id: 'del-1', sessionId: 'sess-1' })
    expect(validateBridgeFrame({ kind: 'session/delete', id: '', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/delete', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/delete', id: 'del-1', sessionId: '' })).toBeUndefined()
  })

  it('accepts session/delete/response and requires an error text on failure', () => {
    expect(validateBridgeFrame({ kind: 'session/delete/response', id: 'del-1', ok: true }))
      .toEqual({ kind: 'session/delete/response', id: 'del-1', ok: true })
    expect(validateBridgeFrame({ kind: 'session/delete/response', id: 'del-1', ok: false, error: 'gone' }))
      .toEqual({ kind: 'session/delete/response', id: 'del-1', ok: false, error: 'gone' })
    expect(validateBridgeFrame({ kind: 'session/delete/response', id: 'del-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/delete/response', id: '', ok: true })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/delete/response', id: 'del-1', ok: 'yes' })).toBeUndefined()
  })

  it('accepts session/list and drops an id-less frame', () => {
    expect(validateBridgeFrame({ kind: 'session/list', id: 'sl-1' }))
      .toEqual({ kind: 'session/list', id: 'sl-1' })
    expect(validateBridgeFrame({ kind: 'session/list', id: '' })).toBeUndefined()
  })

  it('accepts session/list/response only as complete session rows', () => {
    const sessions = [
      { sessionId: 'sess-a', createdAt: 1_700_000_000_000, cwd: '/w', title: 'A' },
      { sessionId: 'sess-b', createdAt: 1_700_000_000_001, parentSessionId: 'sess-a' },
    ]
    expect(validateBridgeFrame({ kind: 'session/list/response', id: 'sl-1', ok: true, sessions }))
      .toEqual({ kind: 'session/list/response', id: 'sl-1', ok: true, sessions })
    expect(validateBridgeFrame({ kind: 'session/list/response', id: 'sl-1', ok: false, error: 'no corpus' }))
      .toEqual({ kind: 'session/list/response', id: 'sl-1', ok: false, error: 'no corpus' })
    expect(validateBridgeFrame({ kind: 'session/list/response', id: 'sl-1', ok: true, sessions: 'sess-a' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/list/response', id: 'sl-1', ok: true, sessions: [] }))
      .toEqual({ kind: 'session/list/response', id: 'sl-1', ok: true, sessions: [] })
    // A row without identity or creation time cannot be listed, and optional fields stay typed.
    expect(validateBridgeFrame({
      kind: 'session/list/response',
      id: 'sl-1',
      ok: true,
      sessions: [{ sessionId: '', createdAt: 1 }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'session/list/response',
      id: 'sl-1',
      ok: true,
      sessions: [{ sessionId: 'sess-a', createdAt: 'now' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'session/list/response',
      id: 'sl-1',
      ok: true,
      sessions: [{ sessionId: 'sess-a', createdAt: 1, title: 7 }],
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/list/response', id: 'sl-1', ok: false })).toBeUndefined()
  })

  it('accepts model/list and drops an id-less frame', () => {
    expect(validateBridgeFrame({ kind: 'model/list', id: 'ml-1' }))
      .toEqual({ kind: 'model/list', id: 'ml-1' })
    expect(validateBridgeFrame({ kind: 'model/list', id: '' })).toBeUndefined()
  })

  it('accepts model/list/response only with providers and a current selection', () => {
    const providers = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'v4',
        name: 'V4',
        vision: true,
        contextWindow: 128_000,
        reasoningEfforts: [{ id: 'low', name: 'Low' }],
      }],
    }]
    const current = { provider: 'deepseek-official', model: 'v4' }
    expect(validateBridgeFrame({ kind: 'model/list/response', id: 'ml-1', ok: true, providers, current }))
      .toEqual({ kind: 'model/list/response', id: 'ml-1', ok: true, providers, current })
    expect(validateBridgeFrame({ kind: 'model/list/response', id: 'ml-1', ok: false, error: 'llm offline' }))
      .toEqual({ kind: 'model/list/response', id: 'ml-1', ok: false, error: 'llm offline' })
    expect(validateBridgeFrame({ kind: 'model/list/response', id: 'ml-1', ok: true, current })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'model/list/response', id: 'ml-1', ok: true, providers, current: null })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'model/list/response', id: 'ml-1', ok: true, providers, current: 'deepseek-official/v4' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'model/list/response', id: 'ml-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'model/list/response', ok: true, providers, current })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'model/list/response', id: 'ml-1', ok: 1, providers, current })).toBeUndefined()
  })

  it('accepts model/select with and without a reasoning effort', () => {
    expect(validateBridgeFrame({ kind: 'model/select', id: 'ms-1', provider: 'deepseek-official', model: 'v4' }))
      .toEqual({ kind: 'model/select', id: 'ms-1', provider: 'deepseek-official', model: 'v4' })
    expect(validateBridgeFrame({
      kind: 'model/select',
      id: 'ms-1',
      provider: 'deepseek-official',
      model: 'v4',
      reasoningEffort: 'high',
    })).toEqual({
      kind: 'model/select',
      id: 'ms-1',
      provider: 'deepseek-official',
      model: 'v4',
      reasoningEffort: 'high',
    })
    expect(validateBridgeFrame({ kind: 'model/select', id: '', provider: 'p', model: 'm' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'model/select', id: 'ms-1', provider: '', model: 'm' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'model/select', id: 'ms-1', provider: 'p', model: '' })).toBeUndefined()
  })

  it('accepts model/select/response and requires an error text on failure', () => {
    expect(validateBridgeFrame({ kind: 'model/select/response', id: 'ms-1', ok: true }))
      .toEqual({ kind: 'model/select/response', id: 'ms-1', ok: true })
    expect(validateBridgeFrame({ kind: 'model/select/response', id: 'ms-1', ok: false, error: 'read-only' }))
      .toEqual({ kind: 'model/select/response', id: 'ms-1', ok: false, error: 'read-only' })
    expect(validateBridgeFrame({ kind: 'model/select/response', id: 'ms-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'model/select/response', ok: true })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'model/select/response', id: 'ms-1', ok: 'true' })).toBeUndefined()
  })

  it('accepts settings/describe and drops an id-less frame', () => {
    expect(validateBridgeFrame({ kind: 'settings/describe', id: 'sd-1' }))
      .toEqual({ kind: 'settings/describe', id: 'sd-1' })
    expect(validateBridgeFrame({ kind: 'settings/describe', id: '' })).toBeUndefined()
  })

  it('accepts settings/describe/response only as projected namespaces', () => {
    const namespaces = [
      { ns: 'llm-deepseek', value: { model: 'v4' }, revision: 3, secretFields: ['apiKey'] },
      { ns: 'plain', value: 1, revision: 0 },
    ]
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces }))
      .toEqual({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces })
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: false, error: 'no settings' }))
      .toEqual({ kind: 'settings/describe/response', id: 'sd-1', ok: false, error: 'no settings' })
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces: 'todo' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces: [{ value: 1, revision: 0 }] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces: [{ ns: '', revision: 0 }] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces: [{ ns: 'todo' }] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces: [{ ns: 'todo', revision: 1.5 }] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces: [{ ns: 'todo', revision: 1, secretFields: 'apiKey' }] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces: [{ ns: 'todo', revision: 1, secretFields: [7] }] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: true, namespaces: [null] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: 'sd-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/describe/response', id: '', ok: true, namespaces })).toBeUndefined()
  })

  it('accepts settings/update with an optional expectedRevision', () => {
    expect(validateBridgeFrame({ kind: 'settings/update', id: 'su-1', ns: 'todo', patch: { showCompleted: true } }))
      .toEqual({ kind: 'settings/update', id: 'su-1', ns: 'todo', patch: { showCompleted: true } })
    expect(validateBridgeFrame({ kind: 'settings/update', id: 'su-1', ns: 'todo', patch: {}, expectedRevision: 4 }))
      .toEqual({ kind: 'settings/update', id: 'su-1', ns: 'todo', patch: {}, expectedRevision: 4 })
    expect(validateBridgeFrame({ kind: 'settings/update', id: '', ns: 'todo', patch: {} })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/update', id: 'su-1', ns: '', patch: {} })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/update', id: 'su-1', ns: 'todo', patch: null })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/update', id: 'su-1', ns: 'todo', patch: ['showCompleted'] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/update', id: 'su-1', ns: 'todo', patch: {}, expectedRevision: '4' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/update', id: 'su-1', ns: 'todo', patch: {}, expectedRevision: 4.5 })).toBeUndefined()
  })

  it('accepts settings/update/response only as a projected namespace', () => {
    const namespace = { ns: 'todo', value: { showCompleted: true }, revision: 1 }
    expect(validateBridgeFrame({ kind: 'settings/update/response', id: 'su-1', ok: true, namespace }))
      .toEqual({ kind: 'settings/update/response', id: 'su-1', ok: true, namespace })
    expect(validateBridgeFrame({ kind: 'settings/update/response', id: 'su-1', ok: false, error: 'conflict' }))
      .toEqual({ kind: 'settings/update/response', id: 'su-1', ok: false, error: 'conflict' })
    expect(validateBridgeFrame({ kind: 'settings/update/response', id: 'su-1', ok: true })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/update/response', id: 'su-1', ok: true, namespace: [] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/update/response', id: 'su-1', ok: true, namespace: { value: 1, revision: 0 } })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/update/response', id: 'su-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'settings/update/response', ok: true, namespace })).toBeUndefined()
  })
})

describe('ide-bridge remaining frame-kind validation (AC-31)', () => {
  it('drops non-objects, arrays, and unknown kinds', () => {
    expect(validateBridgeFrame('hello')).toBeUndefined()
    expect(validateBridgeFrame(null)).toBeUndefined()
    expect(validateBridgeFrame(['hello'])).toBeUndefined()
    expect(validateBridgeFrame({ role: 'runtime' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'unknown/frame', id: 'x' })).toBeUndefined()
  })

  it('accepts both hello roles and drops unknown ones', () => {
    expect(validateBridgeFrame({ kind: 'hello', role: 'runtime' })).toEqual({ kind: 'hello', role: 'runtime' })
    expect(validateBridgeFrame({ kind: 'hello', role: 'host' })).toEqual({ kind: 'hello', role: 'host' })
    expect(validateBridgeFrame({ kind: 'hello', role: 'peer' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'hello' })).toBeUndefined()
  })

  it('accepts approval/request with and without a reason', () => {
    expect(validateBridgeFrame({ kind: 'approval/request', id: 'a-1', sessionId: 'sess-1', toolName: 'bash' }))
      .toEqual({ kind: 'approval/request', id: 'a-1', sessionId: 'sess-1', toolName: 'bash' })
    expect(validateBridgeFrame({
      kind: 'approval/request',
      id: 'a-1',
      sessionId: 'sess-1',
      toolName: 'bash',
      reason: 'writes outside the workspace',
    })).toEqual({
      kind: 'approval/request',
      id: 'a-1',
      sessionId: 'sess-1',
      toolName: 'bash',
      reason: 'writes outside the workspace',
    })
    expect(validateBridgeFrame({ kind: 'approval/request', sessionId: 'sess-1', toolName: 'bash' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'approval/request', id: 'a-1', toolName: 'bash' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'approval/request', id: 'a-1', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'approval/request',
      id: 'a-1',
      sessionId: 'sess-1',
      toolName: 'bash',
      reason: 3,
    })).toBeUndefined()
  })

  it('accepts user-questions/request only with well-formed questions', () => {
    expect(validateBridgeFrame({
      kind: 'user-questions/request',
      id: 'q-1',
      sessionId: 'sess-1',
      questions: [{ id: 'q1', question: 'Continue?' }],
    })).toEqual({
      kind: 'user-questions/request',
      id: 'q-1',
      sessionId: 'sess-1',
      questions: [{ id: 'q1', question: 'Continue?' }],
    })
    expect(validateBridgeFrame({ kind: 'user-questions/request', sessionId: 'sess-1', questions: [] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'user-questions/request', id: 'q-1', questions: [] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'user-questions/request', id: 'q-1', sessionId: 'sess-1', questions: {} })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'user-questions/request',
      id: 'q-1',
      sessionId: 'sess-1',
      questions: [{ id: '', question: 'Continue?' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'user-questions/request',
      id: 'q-1',
      sessionId: 'sess-1',
      questions: [{ question: 'Continue?' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'user-questions/request',
      id: 'q-1',
      sessionId: 'sess-1',
      questions: [{ id: 'q1' }],
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'user-questions/request', id: 'q-1', sessionId: 'sess-1', questions: [null] })).toBeUndefined()
  })

  it('accepts user-questions/response with either an answer or an error', () => {
    const answer = { answers: [{ id: 'q1', selected: ['yes'], custom: 'other' }] }
    expect(validateBridgeFrame({ kind: 'user-questions/response', id: 'q-1', answer }))
      .toEqual({ kind: 'user-questions/response', id: 'q-1', answer })
    expect(validateBridgeFrame({ kind: 'user-questions/response', id: 'q-1', error: 'declined' }))
      .toEqual({ kind: 'user-questions/response', id: 'q-1', error: 'declined' })
    expect(validateBridgeFrame({ kind: 'user-questions/response', answer })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'user-questions/response', id: 'q-1', error: 7 })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'user-questions/response', id: 'q-1', answer: 'yes' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'user-questions/response', id: 'q-1', answer: null })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'user-questions/response', id: 'q-1', answer: { answers: 'none' } })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'user-questions/response', id: 'q-1', answer: { answers: [1] } })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'user-questions/response',
      id: 'q-1',
      answer: { answers: [{ selected: ['yes'] }] },
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'user-questions/response',
      id: 'q-1',
      answer: { answers: [{ id: '', selected: ['yes'] }] },
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'user-questions/response',
      id: 'q-1',
      answer: { answers: [{ id: 'q1', selected: ['yes'], custom: 7 }] },
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'user-questions/response', id: 'q-1' })).toBeUndefined()
  })

  it('validates session/dispose, read-log, resume, and cancel frames', () => {
    expect(validateBridgeFrame({ kind: 'session/dispose', id: 'd-1', sessionId: 'sess-1' }))
      .toEqual({ kind: 'session/dispose', id: 'd-1', sessionId: 'sess-1' })
    expect(validateBridgeFrame({ kind: 'session/dispose', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/dispose', id: 'd-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/dispose/response', id: 'd-1', ok: true }))
      .toEqual({ kind: 'session/dispose/response', id: 'd-1', ok: true })
    expect(validateBridgeFrame({ kind: 'session/dispose/response', id: 'd-1', ok: false, error: 'unknown session' }))
      .toEqual({ kind: 'session/dispose/response', id: 'd-1', ok: false, error: 'unknown session' })
    expect(validateBridgeFrame({ kind: 'session/dispose/response', id: 'd-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/dispose/response', ok: true })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/dispose/response', id: 'd-1', ok: 1 })).toBeUndefined()

    expect(validateBridgeFrame({ kind: 'session/read-log', id: 'r-1', sessionId: 'sess-1' }))
      .toEqual({ kind: 'session/read-log', id: 'r-1', sessionId: 'sess-1' })
    expect(validateBridgeFrame({ kind: 'session/read-log', id: 'r-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/read-log/response', id: 'r-1', ok: true, events: [{ type: 'user/message' }] }))
      .toEqual({ kind: 'session/read-log/response', id: 'r-1', ok: true, events: [{ type: 'user/message' }] })
    expect(validateBridgeFrame({ kind: 'session/read-log/response', id: 'r-1', ok: false, error: 'no stored log' }))
      .toEqual({ kind: 'session/read-log/response', id: 'r-1', ok: false, error: 'no stored log' })
    expect(validateBridgeFrame({ kind: 'session/read-log/response', id: 'r-1', ok: true })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/read-log/response', id: 'r-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/read-log/response', ok: true, events: [] })).toBeUndefined()

    expect(validateBridgeFrame({ kind: 'session/resume', id: 're-1', sessionId: 'sess-1' }))
      .toEqual({ kind: 'session/resume', id: 're-1', sessionId: 'sess-1' })
    expect(validateBridgeFrame({ kind: 'session/resume', id: 're-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/resume/response', id: 're-1', ok: true }))
      .toEqual({ kind: 'session/resume/response', id: 're-1', ok: true })
    expect(validateBridgeFrame({ kind: 'session/resume/response', id: 're-1', ok: false, error: 'log is corrupt' }))
      .toEqual({ kind: 'session/resume/response', id: 're-1', ok: false, error: 'log is corrupt' })
    expect(validateBridgeFrame({ kind: 'session/resume/response', id: 're-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/resume/response', ok: true })).toBeUndefined()

    expect(validateBridgeFrame({ kind: 'session/cancel', id: 'c-1', sessionId: 'sess-1' }))
      .toEqual({ kind: 'session/cancel', id: 'c-1', sessionId: 'sess-1' })
    expect(validateBridgeFrame({ kind: 'session/cancel', id: 'c-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/cancel/response', id: 'c-1', ok: true }))
      .toEqual({ kind: 'session/cancel/response', id: 'c-1', ok: true })
    expect(validateBridgeFrame({ kind: 'session/cancel/response', id: 'c-1', ok: false, error: 'turn already settled' }))
      .toEqual({ kind: 'session/cancel/response', id: 'c-1', ok: false, error: 'turn already settled' })
    expect(validateBridgeFrame({ kind: 'session/cancel/response', id: 'c-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/cancel/response', ok: true })).toBeUndefined()
  })

  it('validates session/fork frames and their boundary options', () => {
    expect(validateBridgeFrame({ kind: 'session/fork', id: 'f-1', parentSessionId: 'parent-1' }))
      .toEqual({ kind: 'session/fork', id: 'f-1', parentSessionId: 'parent-1' })
    expect(validateBridgeFrame({
      kind: 'session/fork',
      id: 'f-1',
      parentSessionId: 'parent-1',
      emptySeed: true,
      childSessionId: 'child-1',
    })).toEqual({
      kind: 'session/fork',
      id: 'f-1',
      parentSessionId: 'parent-1',
      emptySeed: true,
      childSessionId: 'child-1',
    })
    expect(validateBridgeFrame({ kind: 'session/fork', id: 'f-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/fork', id: 'f-1', parentSessionId: 'parent-1', emptySeed: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/fork', id: 'f-1', parentSessionId: 'parent-1', boundarySeq: -1 })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/fork', id: 'f-1', parentSessionId: 'parent-1', boundarySeq: 1.5 })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'session/fork',
      id: 'f-1',
      parentSessionId: 'parent-1',
      emptySeed: true,
      boundarySeq: 2,
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/fork', id: 'f-1', parentSessionId: 'parent-1', childSessionId: '' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/fork/response', id: 'f-1', ok: true, childSessionId: 'child-1' }))
      .toEqual({ kind: 'session/fork/response', id: 'f-1', ok: true, childSessionId: 'child-1' })
    expect(validateBridgeFrame({ kind: 'session/fork/response', id: 'f-1', ok: false, error: 'no live parent' }))
      .toEqual({ kind: 'session/fork/response', id: 'f-1', ok: false, error: 'no live parent' })
    expect(validateBridgeFrame({ kind: 'session/fork/response', id: 'f-1', ok: true })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/fork/response', id: 'f-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'session/fork/response', id: 'f-1', ok: 'yes' })).toBeUndefined()
  })

  it('validates continue-capability frames and their capability vocabulary', () => {
    expect(validateBridgeFrame({ kind: 'session/continue-capability', id: 'cc-1', sessionId: 'sess-1' }))
      .toEqual({ kind: 'session/continue-capability', id: 'cc-1', sessionId: 'sess-1' })
    expect(validateBridgeFrame({ kind: 'session/continue-capability', id: 'cc-1' })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'session/continue-capability/response',
      id: 'cc-1',
      ok: true,
      capability: 'derive-only',
    })).toEqual({
      kind: 'session/continue-capability/response',
      id: 'cc-1',
      ok: true,
      capability: 'derive-only',
    })
    expect(validateBridgeFrame({
      kind: 'session/continue-capability/response',
      id: 'cc-1',
      ok: true,
      capability: 'guess',
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'session/continue-capability/response',
      id: 'cc-1',
      ok: false,
      error: 'probe failed',
    })).toEqual({
      kind: 'session/continue-capability/response',
      id: 'cc-1',
      ok: false,
      error: 'probe failed',
    })
    expect(validateBridgeFrame({ kind: 'session/continue-capability/response', id: 'cc-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'session/continue-capability/response',
      ok: true,
      capability: 'unknown',
    })).toBeUndefined()
  })

  it('validates permission frames', () => {
    expect(validateBridgeFrame({ kind: 'permission/select', id: 'p-1', sessionId: 'sess-1', preset: 'workspace-write' }))
      .toEqual({ kind: 'permission/select', id: 'p-1', sessionId: 'sess-1', preset: 'workspace-write' })
    expect(validateBridgeFrame({ kind: 'permission/select', id: 'p-1', sessionId: 'sess-1' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'permission/select', id: 'p-1', sessionId: 'sess-1', preset: '' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'permission/select', sessionId: 'sess-1', preset: 'workspace-write' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'permission/select/response', id: 'p-1', ok: true, preset: 'workspace-write' }))
      .toEqual({ kind: 'permission/select/response', id: 'p-1', ok: true, preset: 'workspace-write' })
    expect(validateBridgeFrame({ kind: 'permission/select/response', id: 'p-1', ok: false, error: 'unknown preset' }))
      .toEqual({ kind: 'permission/select/response', id: 'p-1', ok: false, error: 'unknown preset' })
    expect(validateBridgeFrame({ kind: 'permission/select/response', id: 'p-1', ok: true })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'permission/select/response', id: 'p-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'permission/select/response', ok: true, preset: 'workspace-write' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'permission/list', id: 'pl-1', sessionId: 'sess-1' }))
      .toEqual({ kind: 'permission/list', id: 'pl-1', sessionId: 'sess-1' })
    expect(validateBridgeFrame({ kind: 'permission/list', id: 'pl-1' })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'permission/list/response',
      id: 'pl-1',
      ok: true,
      presets: ['workspace-write'],
      current: 'workspace-write',
    })).toEqual({
      kind: 'permission/list/response',
      id: 'pl-1',
      ok: true,
      presets: ['workspace-write'],
      current: 'workspace-write',
    })
    expect(validateBridgeFrame({ kind: 'permission/list/response', id: 'pl-1', ok: false, error: 'no sessions' }))
      .toEqual({ kind: 'permission/list/response', id: 'pl-1', ok: false, error: 'no sessions' })
    expect(validateBridgeFrame({
      kind: 'permission/list/response',
      id: 'pl-1',
      ok: true,
      presets: 'workspace-write',
      current: 'workspace-write',
    })).toBeUndefined()
    expect(validateBridgeFrame({
      kind: 'permission/list/response',
      id: 'pl-1',
      ok: true,
      presets: [''],
      current: 'workspace-write',
    })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'permission/list/response', id: 'pl-1', ok: true, presets: ['workspace-write'] })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'permission/list/response', id: 'pl-1', ok: false })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'permission/list/response', ok: true, presets: [], current: 'workspace-write' })).toBeUndefined()
  })

  it('accepts error frames with and without an id', () => {
    expect(validateBridgeFrame({ kind: 'error', message: 'Host failed' }))
      .toEqual({ kind: 'error', message: 'Host failed' })
    expect(validateBridgeFrame({ kind: 'error', id: 'e-1', message: 'Host failed' }))
      .toEqual({ kind: 'error', id: 'e-1', message: 'Host failed' })
    expect(validateBridgeFrame({ kind: 'error', id: 7, message: 'Host failed' })).toBeUndefined()
    expect(validateBridgeFrame({ kind: 'error' })).toBeUndefined()
  })
})

describe('ide-bridge session/delete frames', () => {
  it('deletes through sdkSessionDelete and answers ok', async () => {
    const deleted: string[] = []
    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_DELETE_SERVICE, {
        deleteSession: async (sessionId: string) => {
          deleted.push(sessionId)
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/delete', id: 'del-1', sessionId: 'sess-a' }))
        .toEqual({ kind: 'session/delete/response', id: 'del-1', ok: true })
      expect(deleted).toEqual(['sess-a'])
    })
  })

  it('reports a failing sdkSessionDelete and a missing service', async () => {
    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_DELETE_SERVICE, {
        deleteSession: async (sessionId: string) => {
          if (sessionId === 'sess-error') throw new Error('session is open')
          throw 'storage is read-only'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/delete', id: 'del-error', sessionId: 'sess-error' }))
        .toEqual({ kind: 'session/delete/response', id: 'del-error', ok: false, error: 'session is open' })
      expect(await roundTrip(harness, { kind: 'session/delete', id: 'del-text', sessionId: 'sess-text' }))
        .toEqual({ kind: 'session/delete/response', id: 'del-text', ok: false, error: 'storage is read-only' })
    })

    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/delete', id: 'del-missing', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'session/delete/response',
          id: 'del-missing',
          ok: false,
          error: 'sdkSessionDelete service is not available',
        })
    })
  })
})

describe('ide-bridge session/list frames', () => {
  it('lists every session, taking each title from the projection cache', async () => {
    const viewed: Array<{ id: string; inherited: number; keys: readonly string[] }> = []
    await withBridge((ctx) => {
      ctx.provide(SESSION_QUERY_SERVICE, {
        listSessions: async () => [
          { header: { id: 'sess-cached', createdAt: 1_700_000_000_000, cwd: '/w', isSeeded: false } },
          {
            header: {
              id: 'sess-seeded',
              createdAt: 1_700_000_000_001,
              cwd: '/w',
              isSeeded: true,
              parentSession: 'sess-cached',
            },
          },
          { header: { id: 'sess-cwdless', createdAt: 1_700_000_000_002, isSeeded: false } },
        ],
      })
      ctx.provide(SESSION_PROJECTION_CACHE_SERVICE, {
        cachedSnapshot: (
          header: { id: string },
          inheritedEventCount: number,
          keys?: readonly string[],
        ) => {
          viewed.push({ id: header.id, inherited: inheritedEventCount, keys: keys ?? [] })
          return header.id === 'sess-cached' ? { values: { title: 'Cached title' } } : undefined
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/list', id: 'sl-1' })).toEqual({
        kind: 'session/list/response',
        id: 'sl-1',
        ok: true,
        sessions: [
          { sessionId: 'sess-cached', createdAt: 1_700_000_000_000, cwd: '/w', title: 'Cached title' },
          { sessionId: 'sess-seeded', createdAt: 1_700_000_000_001, cwd: '/w', parentSessionId: 'sess-cached' },
          { sessionId: 'sess-cwdless', createdAt: 1_700_000_000_002 },
        ],
      })
      // A seeded log's inherited prefix is unreadable from listing metadata, so only an
      // unseeded row is witnessed against the cache — at the zero cut the Host API uses.
      expect(viewed.map(entry => [entry.id, entry.inherited])).toEqual([
        ['sess-cached', 0],
        ['sess-cwdless', 0],
      ])
      expect(viewed[0]?.keys).toEqual(['title'])
    })
  })

  it('answers without titles when the runtime mounts no projection cache', async () => {
    await withBridge((ctx) => {
      ctx.provide(SESSION_QUERY_SERVICE, {
        listSessions: async () => [
          { header: { id: 'sess-plain', createdAt: 1_700_000_000_003, isSeeded: false } },
        ],
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/list', id: 'sl-nocache' })).toEqual({
        kind: 'session/list/response',
        id: 'sl-nocache',
        ok: true,
        sessions: [{ sessionId: 'sess-plain', createdAt: 1_700_000_000_003 }],
      })
    })
  })

  it('reports a missing sessionQuery service and a failing listing', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/list', id: 'sl-missing' })).toEqual({
        kind: 'session/list/response',
        id: 'sl-missing',
        ok: false,
        error: 'sessionQuery service is not available',
      })
    })

    await withBridge((ctx) => {
      ctx.provide(SESSION_QUERY_SERVICE, {
        listSessions: async () => {
          throw new Error('session corpus is unavailable')
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/list', id: 'sl-error' })).toEqual({
        kind: 'session/list/response',
        id: 'sl-error',
        ok: false,
        error: 'session corpus is unavailable',
      })
    })

    await withBridge((ctx) => {
      ctx.provide(SESSION_QUERY_SERVICE, {
        listSessions: async () => {
          throw 'persistence is read-only'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/list', id: 'sl-text' })).toEqual({
        kind: 'session/list/response',
        id: 'sl-text',
        ok: false,
        error: 'persistence is read-only',
      })
    })
  })
})

describe('ide-bridge model/list frames', () => {
  it('lists providers with vision, context window, and reasoning efforts from resolveModelInfo', async () => {
    const resolved: Array<{ provider: string; model: string }> = []
    await withBridge((ctx) => {
      ctx.provide('llm', {
        listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
        listModels: async () => [
          { id: 'v4-flash', name: 'V4 Flash', inputModalities: ['text', 'image'] },
          { id: 'v4-lite', name: 'V4 Lite', inputModalities: ['text'] },
        ],
        resolveModelInfo: async (provider: string, model: string) => {
          resolved.push({ provider, model })
          if (model !== 'v4-flash') return {}
          return {
            context: { contextWindow: 128_000 },
            reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
          }
        },
      })
      ctx.provide('agentDefaultModel', {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'v4-flash', reasoningEffort: 'high' }),
        saveSelection: async () => {},
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'model/list', id: 'ml-1' })).toEqual({
        kind: 'model/list/response',
        id: 'ml-1',
        ok: true,
        providers: [{
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [
            {
              id: 'v4-flash',
              name: 'V4 Flash',
              vision: true,
              contextWindow: 128_000,
              reasoningEfforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
            },
            { id: 'v4-lite', name: 'V4 Lite' },
          ],
        }],
        current: { provider: 'deepseek-official', model: 'v4-flash', reasoningEffort: 'high' },
      })
      expect(resolved).toEqual([
        { provider: 'deepseek-official', model: 'v4-flash' },
        { provider: 'deepseek-official', model: 'v4-lite' },
      ])
    })
  })

  it('keeps the list when resolveModelInfo throws and when no efforts are declared', async () => {
    await withBridge((ctx) => {
      ctx.provide('llm', {
        listProviders: () => [{ id: 'pi-ai', name: 'Pi' }],
        listModels: async () => [{ id: 'broken', name: 'Broken' }, { id: 'no-efforts', name: 'No Efforts' }],
        resolveModelInfo: async (_provider: string, model: string) => {
          if (model === 'broken') throw new Error('adapter exposes no metadata')
          return { reasoning: { efforts: [] } }
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'model/list', id: 'ml-throws' })).toEqual({
        kind: 'model/list/response',
        id: 'ml-throws',
        ok: true,
        providers: [{
          id: 'pi-ai',
          name: 'Pi',
          models: [{ id: 'broken', name: 'Broken' }, { id: 'no-efforts', name: 'No Efforts' }],
        }],
        current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      })
    })
  })

  it('lists models when the adapter exposes no resolveModelInfo', async () => {
    await withBridge((ctx) => {
      ctx.provide('llm', {
        listProviders: () => [
          { id: 'deepseek-official', name: 'DeepSeek' },
          { id: 'pi-ai', name: 'Pi' },
        ],
        listModels: async (provider: string) => provider === 'deepseek-official'
          ? [{ id: 'v4', name: 'V4', inputModalities: ['text'] }]
          : [],
      })
      ctx.provide('agentDefaultModel', {
        currentSelection: () => ({ provider: 'pi-ai', model: 'glm' }),
        saveSelection: async () => {},
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'model/list', id: 'ml-plain' })).toEqual({
        kind: 'model/list/response',
        id: 'ml-plain',
        ok: true,
        providers: [
          { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'v4', name: 'V4' }] },
          { id: 'pi-ai', name: 'Pi', models: [] },
        ],
        current: { provider: 'pi-ai', model: 'glm' },
      })
    })
  })

  it('reports a missing llm service and a failing provider listing', async () => {
    await withBridge((ctx) => {
      ctx.provide('agentDefaultModel', {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'v4' }),
        saveSelection: async () => {},
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'model/list', id: 'ml-missing' }))
        .toEqual({ kind: 'model/list/response', id: 'ml-missing', ok: false, error: 'llm service is not available' })
    })

    await withBridge((ctx) => {
      ctx.provide('llm', {
        listProviders: () => {
          throw new Error('provider registry is closed')
        },
        listModels: async () => [],
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'model/list', id: 'ml-fail' }))
        .toEqual({ kind: 'model/list/response', id: 'ml-fail', ok: false, error: 'provider registry is closed' })
    })

    await withBridge((ctx) => {
      ctx.provide('llm', {
        listProviders: () => [{ id: 'pi-ai', name: 'Pi' }],
        listModels: async () => {
          throw 'model catalogue unavailable'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'model/list', id: 'ml-text' }))
        .toEqual({ kind: 'model/list/response', id: 'ml-text', ok: false, error: 'model catalogue unavailable' })
    })
  })
})

describe('ide-bridge model/select frames', () => {
  it('saves the selected model with and without a reasoning effort', async () => {
    const saved: Array<{ provider: string; model: string; reasoningEffort?: string }> = []
    await withBridge((ctx) => {
      ctx.provide('agentDefaultModel', {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'v4' }),
        saveSelection: async (next: { provider: string; model: string; reasoningEffort?: string }) => {
          saved.push(next)
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, {
        kind: 'model/select',
        id: 'ms-high',
        provider: 'deepseek-official',
        model: 'v4',
        reasoningEffort: 'high',
      })).toEqual({ kind: 'model/select/response', id: 'ms-high', ok: true })
      expect(await roundTrip(harness, { kind: 'model/select', id: 'ms-plain', provider: 'pi-ai', model: 'glm' }))
        .toEqual({ kind: 'model/select/response', id: 'ms-plain', ok: true })
      expect(saved).toStrictEqual([
        { provider: 'deepseek-official', model: 'v4', reasoningEffort: 'high' },
        { provider: 'pi-ai', model: 'glm' },
      ])
    })
  })

  it('reports a missing service and a failing save', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'model/select', id: 'ms-missing', provider: 'p', model: 'm' }))
        .toEqual({
          kind: 'model/select/response',
          id: 'ms-missing',
          ok: false,
          error: 'agentDefaultModel service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide('agentDefaultModel', {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'v4' }),
        saveSelection: async (next: { provider: string; model: string }) => {
          if (next.model === 'v4') throw new Error('settings are read-only')
          throw 'settings file is locked'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'model/select', id: 'ms-error', provider: 'deepseek-official', model: 'v4' }))
        .toEqual({ kind: 'model/select/response', id: 'ms-error', ok: false, error: 'settings are read-only' })
      expect(await roundTrip(harness, { kind: 'model/select', id: 'ms-text', provider: 'pi-ai', model: 'glm' }))
        .toEqual({ kind: 'model/select/response', id: 'ms-text', ok: false, error: 'settings file is locked' })
    })
  })
})

describe('ide-bridge settings/describe frames', () => {
  it('projects only the wire fields and maps secrets to their dotted paths', async () => {
    const calls: Array<{ redactSecrets?: boolean } | undefined> = []
    const descriptors = [
      {
        ns: 'llm-deepseek',
        value: { apiKey: '[redacted]', model: 'deepseek-v4-flash' },
        revision: 7,
        base: { model: 'deepseek-v4-flash' },
        user: { apiKey: '[redacted]' },
        secrets: [{ path: ['apiKey'], set: true }, { path: ['nested', 'token'], set: false }],
        schema: { apiKey: { role: 'secret' } },
        applies: 'runtime',
      },
      { ns: 'todo', value: { showCompleted: false }, revision: 0, secrets: [] },
      { ns: 'plain', value: 3, revision: 2 },
    ]
    await withBridge((ctx) => {
      ctx.provide('settings', {
        describe: (options?: { redactSecrets?: boolean }) => {
          calls.push(options)
          return descriptors
        },
        update: async () => {},
      })
    }, async (harness) => {
      const response = await roundTrip(harness, { kind: 'settings/describe', id: 'sd-1' })
      expect(calls).toStrictEqual([{ redactSecrets: true }])
      expect(response).toEqual({
        kind: 'settings/describe/response',
        id: 'sd-1',
        ok: true,
        namespaces: [
          {
            ns: 'llm-deepseek',
            value: { apiKey: '[redacted]', model: 'deepseek-v4-flash' },
            base: { model: 'deepseek-v4-flash' },
            user: { apiKey: '[redacted]' },
            revision: 7,
            secretFields: ['apiKey', 'nested.token'],
          },
          { ns: 'todo', value: { showCompleted: false }, revision: 0 },
          { ns: 'plain', value: 3, revision: 2 },
        ],
      })
      // Field-by-field projection: the descriptor's schema and other
      // enumerable properties never reach the Host.
      if (response.kind !== 'settings/describe/response' || !response.ok) {
        throw new Error('expected a successful settings/describe response')
      }
      expect(response.namespaces.map(view => Object.keys(view))).toEqual([
        ['ns', 'value', 'base', 'user', 'revision', 'secretFields'],
        ['ns', 'value', 'revision'],
        ['ns', 'value', 'revision'],
      ])
    })
  })

  it('reports a missing settings service and a failing describe', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'settings/describe', id: 'sd-missing' }))
        .toEqual({
          kind: 'settings/describe/response',
          id: 'sd-missing',
          ok: false,
          error: 'settings service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide('settings', {
        describe: () => {
          throw new Error('settings registry is closed')
        },
        update: async () => {},
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'settings/describe', id: 'sd-error' }))
        .toEqual({ kind: 'settings/describe/response', id: 'sd-error', ok: false, error: 'settings registry is closed' })
    })

    await withBridge((ctx) => {
      ctx.provide('settings', {
        describe: () => {
          throw 'settings are unavailable'
        },
        update: async () => {},
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'settings/describe', id: 'sd-text' }))
        .toEqual({ kind: 'settings/describe/response', id: 'sd-text', ok: false, error: 'settings are unavailable' })
    })
  })
})

describe('ide-bridge settings/update frames', () => {
  it('merges the patch and answers with the namespace re-read after the write', async () => {
    const updates: Array<{ ns: string; patch: object; expectedRevision: number | undefined }> = []
    let descriptor = {
      ns: 'todo',
      value: { showCompleted: false, filter: 'open' },
      revision: 4,
      user: {},
      secrets: [{ path: ['token'], set: false }],
    }
    await withBridge((ctx) => {
      ctx.provide('settings', {
        describe: () => [descriptor],
        update: async (ns: string, patch: object, expectedRevision?: number) => {
          updates.push({ ns, patch, expectedRevision })
          descriptor = {
            ns,
            value: { ...descriptor.value, ...patch },
            revision: descriptor.revision + 1,
            user: patch,
            secrets: descriptor.secrets,
          }
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, {
        kind: 'settings/update',
        id: 'su-1',
        ns: 'todo',
        patch: { showCompleted: true },
        expectedRevision: 4,
      })).toEqual({
        kind: 'settings/update/response',
        id: 'su-1',
        ok: true,
        namespace: {
          ns: 'todo',
          value: { showCompleted: true, filter: 'open' },
          user: { showCompleted: true },
          revision: 5,
          secretFields: ['token'],
        },
      })
      expect(updates).toStrictEqual([
        { ns: 'todo', patch: { showCompleted: true }, expectedRevision: 4 },
      ])
    })
  })

  it('writes unconditionally when the frame omits expectedRevision', async () => {
    const updates: Array<{ ns: string; patch: object; expectedRevision: number | undefined }> = []
    await withBridge((ctx) => {
      ctx.provide('settings', {
        describe: () => [{ ns: 'todo', value: { showCompleted: true }, revision: 5 }],
        update: async (ns: string, patch: object, expectedRevision?: number) => {
          updates.push({ ns, patch, expectedRevision })
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, {
        kind: 'settings/update',
        id: 'su-plain',
        ns: 'todo',
        patch: { showCompleted: true },
      })).toEqual({
        kind: 'settings/update/response',
        id: 'su-plain',
        ok: true,
        namespace: { ns: 'todo', value: { showCompleted: true }, revision: 5 },
      })
      expect(updates).toStrictEqual([
        { ns: 'todo', patch: { showCompleted: true }, expectedRevision: undefined },
      ])
    })
  })

  it('reports a missing service, a failing update, and an unregistered namespace', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'settings/update', id: 'su-missing', ns: 'todo', patch: {} }))
        .toEqual({
          kind: 'settings/update/response',
          id: 'su-missing',
          ok: false,
          error: 'settings service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide('settings', {
        describe: () => [],
        update: async (ns: string) => {
          if (ns === 'todo') throw new Error('revision conflict: expected 4')
          throw 'settings file is read-only'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'settings/update', id: 'su-error', ns: 'todo', patch: {} }))
        .toEqual({ kind: 'settings/update/response', id: 'su-error', ok: false, error: 'revision conflict: expected 4' })
      expect(await roundTrip(harness, { kind: 'settings/update', id: 'su-text', ns: 'other', patch: {} }))
        .toEqual({ kind: 'settings/update/response', id: 'su-text', ok: false, error: 'settings file is read-only' })
    })

    await withBridge((ctx) => {
      ctx.provide('settings', {
        describe: () => [{ ns: 'other', value: 1, revision: 0 }],
        update: async () => {},
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'settings/update', id: 'su-unregistered', ns: 'todo', patch: {} }))
        .toEqual({
          kind: 'settings/update/response',
          id: 'su-unregistered',
          ok: false,
          error: 'settings namespace "todo" is not registered',
        })
    })
  })
})

describe('ide-bridge Host frame service-failure paths', () => {
  it('reports a missing and a failing sdkSessionDispose', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/dispose', id: 'dispose-missing', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'session/dispose/response',
          id: 'dispose-missing',
          ok: false,
          error: 'sdkSessionDispose service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_DISPOSE_SERVICE, {
        disposeSession: async (sessionId: string) => {
          if (sessionId === 'sess-error') throw new Error('session belongs to another runtime')
          throw 'session map is being torn down'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/dispose', id: 'dispose-error', sessionId: 'sess-error' }))
        .toEqual({
          kind: 'session/dispose/response',
          id: 'dispose-error',
          ok: false,
          error: 'session belongs to another runtime',
        })
      expect(await roundTrip(harness, { kind: 'session/dispose', id: 'dispose-text', sessionId: 'sess-text' }))
        .toEqual({
          kind: 'session/dispose/response',
          id: 'dispose-text',
          ok: false,
          error: 'session map is being torn down',
        })
    })
  })

  it('reports a missing persistence, a failing open, and a failing read', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/read-log', id: 'read-missing', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'session/read-log/response',
          id: 'read-missing',
          ok: false,
          error: 'sessionPersistence service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(SESSION_PERSISTENCE_SERVICE, {
        open: async (sessionId: string) => {
          if (sessionId === 'sess-error') throw new Error(`no stored log for ${sessionId}`)
          throw 'log directory is missing'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/read-log', id: 'read-error', sessionId: 'sess-error' }))
        .toEqual({
          kind: 'session/read-log/response',
          id: 'read-error',
          ok: false,
          error: 'no stored log for sess-error',
        })
      expect(await roundTrip(harness, { kind: 'session/read-log', id: 'read-text', sessionId: 'sess-text' }))
        .toEqual({
          kind: 'session/read-log/response',
          id: 'read-text',
          ok: false,
          error: 'log directory is missing',
        })
    })

    const closed: string[] = []
    await withBridge((ctx) => {
      ctx.provide(SESSION_PERSISTENCE_SERVICE, {
        open: async () => ({
          read: async () => {
            throw new Error('log is truncated')
          },
          close: async () => {
            closed.push('closed')
          },
        }),
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/read-log', id: 'read-fail', sessionId: 'sess-a' }))
        .toEqual({ kind: 'session/read-log/response', id: 'read-fail', ok: false, error: 'log is truncated' })
      // The open handle is released before the read failure is reported.
      expect(closed).toEqual(['closed'])
    })
  })

  it('reports a missing and a failing sdkSessionResume', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/resume', id: 'resume-missing', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'session/resume/response',
          id: 'resume-missing',
          ok: false,
          error: 'sdkSessionResume service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_RESUME_SERVICE, {
        resumeSession: async (sessionId: string) => {
          if (sessionId === 'sess-error') throw new Error(`session log for ${sessionId} is corrupt`)
          throw 'agents service is not mounted'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/resume', id: 'resume-error', sessionId: 'sess-error' }))
        .toEqual({
          kind: 'session/resume/response',
          id: 'resume-error',
          ok: false,
          error: 'session log for sess-error is corrupt',
        })
      expect(await roundTrip(harness, { kind: 'session/resume', id: 'resume-text', sessionId: 'sess-text' }))
        .toEqual({
          kind: 'session/resume/response',
          id: 'resume-text',
          ok: false,
          error: 'agents service is not mounted',
        })
    })
  })

  it('reports a missing and a failing sdkSessionCancel', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/cancel', id: 'cancel-missing', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'session/cancel/response',
          id: 'cancel-missing',
          ok: false,
          error: 'sdkSessionCancel service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_CANCEL_SERVICE, {
        cancelSession: async (sessionId: string) => {
          if (sessionId === 'sess-error') throw new Error('turn already settled')
          throw 'agent loop is not running'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/cancel', id: 'cancel-error', sessionId: 'sess-error' }))
        .toEqual({ kind: 'session/cancel/response', id: 'cancel-error', ok: false, error: 'turn already settled' })
      expect(await roundTrip(harness, { kind: 'session/cancel', id: 'cancel-text', sessionId: 'sess-text' }))
        .toEqual({ kind: 'session/cancel/response', id: 'cancel-text', ok: false, error: 'agent loop is not running' })
    })
  })

  it('forks with emptySeed plus childSessionId and reports a missing and a failing fork', async () => {
    const forked: Array<{ parent: string; options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string } }> = []
    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_FORK_SERVICE, {
        forkSession: async (
          parentSessionId: string,
          options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
        ) => {
          forked.push({ parent: parentSessionId, ...options === undefined ? {} : { options } })
          return 'child-from-fork'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, {
        kind: 'session/fork',
        id: 'fork-empty',
        parentSessionId: 'parent-a',
        emptySeed: true,
        childSessionId: 'child-requested',
      })).toEqual({
        kind: 'session/fork/response',
        id: 'fork-empty',
        ok: true,
        childSessionId: 'child-from-fork',
      })
      expect(forked).toStrictEqual([
        { parent: 'parent-a', options: { emptySeed: true, childSessionId: 'child-requested' } },
      ])
    })

    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/fork', id: 'fork-missing', parentSessionId: 'parent-a' }))
        .toEqual({
          kind: 'session/fork/response',
          id: 'fork-missing',
          ok: false,
          error: 'sdkSessionFork service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_FORK_SERVICE, {
        forkSession: async (parentSessionId: string) => {
          if (parentSessionId === 'parent-error') throw new Error('parent session is not live')
          throw 'fork is disabled for this profile'
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/fork', id: 'fork-error', parentSessionId: 'parent-error' }))
        .toEqual({ kind: 'session/fork/response', id: 'fork-error', ok: false, error: 'parent session is not live' })
      expect(await roundTrip(harness, { kind: 'session/fork', id: 'fork-text', parentSessionId: 'parent-text' }))
        .toEqual({ kind: 'session/fork/response', id: 'fork-text', ok: false, error: 'fork is disabled for this profile' })
    })
  })

  it('answers continueCapability unknown without a resume service or a stored log', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/continue-capability', id: 'cc-noservice', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'session/continue-capability/response',
          id: 'cc-noservice',
          ok: true,
          capability: 'unknown',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_RESUME_SERVICE, { resumeSession: async () => {} })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/continue-capability', id: 'cc-nolog', sessionId: 'sess-a' }))
        .toEqual({ kind: 'session/continue-capability/response', id: 'cc-nolog', ok: true, capability: 'unknown' })
    })
  })

  it('answers continueCapability same-id only for a non-empty stored log', async () => {
    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_RESUME_SERVICE, { resumeSession: async () => {} })
      ctx.provide(SESSION_PERSISTENCE_SERVICE, {
        open: async () => ({
          read: async () => [{ type: 'user/message' }],
          close: async () => {},
        }),
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/continue-capability', id: 'cc-exists', sessionId: 'sess-a' }))
        .toEqual({ kind: 'session/continue-capability/response', id: 'cc-exists', ok: true, capability: 'same-id' })
    })

    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_RESUME_SERVICE, { resumeSession: async () => {} })
      ctx.provide(SESSION_PERSISTENCE_SERVICE, {
        open: async () => ({ read: async () => [], close: async () => {} }),
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/continue-capability', id: 'cc-empty', sessionId: 'sess-a' }))
        .toEqual({ kind: 'session/continue-capability/response', id: 'cc-empty', ok: true, capability: 'unknown' })
    })

    await withBridge((ctx) => {
      ctx.provide(SDK_SESSION_RESUME_SERVICE, { resumeSession: async () => {} })
      ctx.provide(SESSION_PERSISTENCE_SERVICE, {
        open: async () => {
          throw new Error('no stored log for sess-a')
        },
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'session/continue-capability', id: 'cc-open-fails', sessionId: 'sess-a' }))
        .toEqual({
          kind: 'session/continue-capability/response',
          id: 'cc-open-fails',
          ok: true,
          capability: 'unknown',
        })
    })
  })

  it('reports permission/select failures for unknown presets, unknown sessions, and a rejecting set', async () => {
    const session = { id: 'sess-perm' }
    await withBridge((ctx) => {
      ctx.provide(PERMISSION_PRESETS_SERVICE, {
        names: ['workspace-write'],
        set: () => {},
        current: () => 'workspace-write',
      })
    }, async (harness) => {
      expect(await roundTrip(harness, {
        kind: 'permission/select',
        id: 'perm-nosessions',
        sessionId: 'sess-perm',
        preset: 'workspace-write',
      })).toEqual({
        kind: 'permission/select/response',
        id: 'perm-nosessions',
        ok: false,
        error: 'sessions service is not available',
      })
    })

    await withBridge((ctx) => {
      ctx.provide(SESSIONS_SERVICE, {
        get: (id: string) => id === session.id ? session : undefined,
      })
    }, async (harness) => {
      expect(await roundTrip(harness, {
        kind: 'permission/select',
        id: 'perm-nopresets',
        sessionId: 'sess-perm',
        preset: 'workspace-write',
      })).toEqual({
        kind: 'permission/select/response',
        id: 'perm-nopresets',
        ok: false,
        error: 'permissionPresets service is not available',
      })
    })

    await withBridge((ctx) => {
      ctx.provide(SESSIONS_SERVICE, {
        get: (id: string) => id === session.id ? session : undefined,
      })
      ctx.provide(PERMISSION_PRESETS_SERVICE, {
        names: ['workspace-write', 'error-preset', 'text-preset'],
        set: (_target: { id: string }, name: string) => {
          if (name === 'error-preset') throw new Error('preset is not permitted here')
          if (name === 'text-preset') throw 'permission authority is offline'
        },
        current: () => 'workspace-write',
      })
    }, async (harness) => {
      expect(await roundTrip(harness, {
        kind: 'permission/select',
        id: 'perm-unknown-preset',
        sessionId: 'sess-perm',
        preset: 'danger-full-access',
      })).toEqual({
        kind: 'permission/select/response',
        id: 'perm-unknown-preset',
        ok: false,
        error: 'unknown preset "danger-full-access" (available: workspace-write, error-preset, text-preset)',
      })
      expect(await roundTrip(harness, {
        kind: 'permission/select',
        id: 'perm-unknown-session',
        sessionId: 'sess-other',
        preset: 'workspace-write',
      })).toEqual({
        kind: 'permission/select/response',
        id: 'perm-unknown-session',
        ok: false,
        error: 'unknown session "sess-other"',
      })
      expect(await roundTrip(harness, {
        kind: 'permission/select',
        id: 'perm-error',
        sessionId: 'sess-perm',
        preset: 'error-preset',
      })).toEqual({ kind: 'permission/select/response', id: 'perm-error', ok: false, error: 'preset is not permitted here' })
      expect(await roundTrip(harness, {
        kind: 'permission/select',
        id: 'perm-text',
        sessionId: 'sess-perm',
        preset: 'text-preset',
      })).toEqual({ kind: 'permission/select/response', id: 'perm-text', ok: false, error: 'permission authority is offline' })
    })
  })

  it('answers permission/list from the presets service and reports unknown sessions', async () => {
    const session = { id: 'sess-perm' }
    await withBridge(() => {}, async (harness) => {
      expect(await roundTrip(harness, { kind: 'permission/list', id: 'list-missing', sessionId: 'sess-perm' }))
        .toEqual({
          kind: 'permission/list/response',
          id: 'list-missing',
          ok: false,
          error: 'permissionPresets or sessions service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(SESSIONS_SERVICE, {
        get: (id: string) => id === session.id ? session : undefined,
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'permission/list', id: 'list-nopresets', sessionId: 'sess-perm' }))
        .toEqual({
          kind: 'permission/list/response',
          id: 'list-nopresets',
          ok: false,
          error: 'permissionPresets or sessions service is not available',
        })
    })

    await withBridge((ctx) => {
      ctx.provide(SESSIONS_SERVICE, {
        get: (id: string) => id === session.id ? session : undefined,
      })
      ctx.provide(PERMISSION_PRESETS_SERVICE, {
        names: ['workspace-write', 'danger-full-access'],
        set: () => {},
        current: () => 'workspace-write',
      })
    }, async (harness) => {
      expect(await roundTrip(harness, { kind: 'permission/list', id: 'list-unknown', sessionId: 'sess-other' }))
        .toEqual({
          kind: 'permission/list/response',
          id: 'list-unknown',
          ok: false,
          error: 'unknown session "sess-other"',
        })
      expect(await roundTrip(harness, { kind: 'permission/list', id: 'list-ok', sessionId: 'sess-perm' }))
        .toEqual({
          kind: 'permission/list/response',
          id: 'list-ok',
          ok: true,
          presets: ['workspace-write', 'danger-full-access'],
          current: 'workspace-write',
        })
    })
  })

  it('records the connection failure and fails closed when no Host listens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-nosock-'))
    dirs.push(dir)
    const ctx = new Context()
    process.env[IDE_BRIDGE_SOCK_ENV] = join(dir, 'missing.sock')
    apply(ctx, {})
    try {
      await vi.waitFor(() => {
        expect(ctx.ideBridge.error).toBeDefined()
      }, { timeout: WAIT_MS })
      expect(ctx.ideBridge.connected).toBe(false)
      expect(await ctx.waterfall(
        'approval/request',
        { agent: stubAgent('a', 'sess-a'), toolName: 'bash' },
        () => Promise.resolve('allowed-once' as const),
      )).toBe('unavailable')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('ide-bridge interaction answerer failure paths', () => {
  it('forwards the reason, signal, and agent id of an approval request', async () => {
    await withBridge(() => {}, async (harness) => {
      const sent = hostResponder(harness, (frame, connection) => {
        if (frame.kind !== 'approval/request') return
        connection.send({ kind: 'approval/response', id: frame.id, outcome: 'allowed-once' })
      })
      const controller = new AbortController()
      const outcome = await harness.ctx.waterfall('approval/request', {
        agent: { id: 'agent-without-live-session' } as unknown as Agent,
        toolName: 'bash',
        reason: 'writes outside the workspace',
        signal: controller.signal,
      }, () => Promise.resolve('allowed-once' as const))
      expect(outcome).toBe('allowed-once')
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        kind: 'approval/request',
        sessionId: 'agent-without-live-session',
        toolName: 'bash',
        reason: 'writes outside the workspace',
      })
    })
  })

  it('answers cancelled for an aborted approval and for an abort during the wait', async () => {
    await withBridge(() => {}, async (harness) => {
      const aborted = new AbortController()
      aborted.abort()
      expect(await harness.ctx.waterfall('approval/request', {
        agent: stubAgent('a', 'sess-a'),
        toolName: 'bash',
        signal: aborted.signal,
      }, () => Promise.resolve('allowed-once' as const))).toBe('cancelled')
      // Withdrawing before the send leaves the Host untouched.
      expect(harness.received.some(frame => frame.kind === 'approval/request')).toBe(false)
    }, { interactionTimeoutMs: 5_000 })

    const controller = new AbortController()
    await withBridge(() => {}, async (harness) => {
      const pending = harness.ctx.waterfall('approval/request', {
        agent: stubAgent('a', 'sess-a'),
        toolName: 'bash',
        signal: controller.signal,
      }, () => Promise.resolve('allowed-once' as const))
      await awaitReceived(harness, frame => frame.kind === 'approval/request')
      controller.abort()
      expect(await pending).toBe('cancelled')
    }, { interactionTimeoutMs: 5_000 })
  })

  it('answers unavailable when the socket refuses an oversized approval frame', async () => {
    await withBridge(() => {}, async (harness) => {
      // A frame larger than the socket's writable buffer is refused by write():
      // the answerer must fail closed instead of awaiting a Host reply.
      expect(await harness.ctx.waterfall('approval/request', {
        agent: stubAgent('a', 'sess-a'),
        toolName: 'bash',
        reason: 'r'.repeat(2_000_000),
      }, () => Promise.resolve('allowed-once' as const))).toBe('unavailable')
    }, { interactionTimeoutMs: 5_000 })
  })

  it('returns the Host answer for a question request carrying a signal', async () => {
    await withBridge(() => {}, async (harness) => {
      hostResponder(harness, (frame, connection) => {
        if (frame.kind !== 'user-questions/request') return
        connection.send({
          kind: 'user-questions/response',
          id: frame.id,
          answer: { answers: [{ id: 'q1', selected: ['yes'] }] },
        })
      })
      const controller = new AbortController()
      const answer = await harness.ctx.waterfall('user-questions/request', {
        agent: stubAgent('a', 'sess-a'),
        questions: [{ id: 'q1', question: 'Continue?' }],
        signal: controller.signal,
      }, () => Promise.reject(new Error('unexpected fallthrough')))
      expect(answer).toEqual({ answers: [{ id: 'q1', selected: ['yes'] }] })
    })
  })

  it('reports aborted, timed-out, and refused question requests', async () => {
    await withBridge(() => {}, async (harness) => {
      const aborted = new AbortController()
      aborted.abort()
      await expect(harness.ctx.waterfall('user-questions/request', {
        questions: [{ id: 'q1', question: 'Continue?' }],
        signal: aborted.signal,
      }, () => Promise.reject(new Error('unexpected fallthrough'))))
        .rejects.toMatchObject({ code: 'ASK_ABORTED' })
    })

    const controller = new AbortController()
    await withBridge(() => {}, async (harness) => {
      const pending = harness.ctx.waterfall('user-questions/request', {
        questions: [{ id: 'q1', question: 'Continue?' }],
        signal: controller.signal,
      }, () => Promise.reject(new Error('unexpected fallthrough')))
      await awaitReceived(harness, frame => frame.kind === 'user-questions/request')
      controller.abort()
      await expect(pending).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    }, { interactionTimeoutMs: 5_000 })

    await withBridge(() => {}, async (harness) => {
      await expect(harness.ctx.waterfall('user-questions/request', {
        questions: [{ id: 'q1', question: 'Continue?' }],
      }, () => Promise.reject(new Error('unexpected fallthrough'))))
        .rejects.toMatchObject({ code: 'NO_PROVIDER', message: 'user-questions timed out after 60ms' })
    }, { interactionTimeoutMs: 60 })

    await withBridge(() => {}, async (harness) => {
      // As with approvals, a frame the socket refuses must fail closed.
      await expect(harness.ctx.waterfall('user-questions/request', {
        questions: [{ id: 'q1', question: 'q'.repeat(2_000_000) }],
      }, () => Promise.reject(new Error('unexpected fallthrough'))))
        .rejects.toMatchObject({
          code: 'NO_PROVIDER',
          message: 'ide-bridge failed to send user-questions/request',
        })
    }, { interactionTimeoutMs: 5_000 })
  })

  it('rejects a pending question when the Host answers with an error frame', async () => {
    await withBridge(() => {}, async (harness) => {
      hostResponder(harness, (frame, connection) => {
        if (frame.kind !== 'user-questions/request') return
        connection.send({ kind: 'user-questions/response', id: frame.id, error: 'Host declined to ask' })
      })
      await expect(harness.ctx.waterfall('user-questions/request', {
        questions: [{ id: 'q1', question: 'Continue?' }],
      }, () => Promise.reject(new Error('unexpected fallthrough'))))
        .rejects.toMatchObject({ code: 'NO_PROVIDER', message: 'Host declined to ask' })
    })
  })

  it('ignores responses for unknown ids and fails closed when disposed', async () => {
    await withBridge(() => {}, async (harness) => {
      expect(harness.host.broadcast({ kind: 'approval/response', id: 'unknown-approval', outcome: 'allowed-once' })).toBe(1)
      expect(harness.host.broadcast({
        kind: 'user-questions/response',
        id: 'unknown-questions',
        answer: { answers: [] },
      })).toBe(1)
      // The socket is FIFO, so this round trip proves the runtime processed
      // both unmatched responses without settling anything.
      expect(await roundTrip(harness, { kind: 'settings/describe', id: 'unmatched-barrier' }))
        .toEqual({
          kind: 'settings/describe/response',
          id: 'unmatched-barrier',
          ok: false,
          error: 'settings service is not available',
        })

      const pending = harness.ctx.waterfall('user-questions/request', {
        questions: [{ id: 'q1', question: 'Continue?' }],
      }, () => Promise.reject(new Error('unexpected fallthrough')))
      await awaitReceived(harness, frame => frame.kind === 'user-questions/request')
      await harness.dispose()
      await expect(pending).rejects.toMatchObject({
        code: 'NO_PROVIDER',
        message: 'ide-bridge disposed during pending user-questions',
      })
    }, { interactionTimeoutMs: 5_000 })
  })
})

/**
 * Cross-linked duplex pair: writes on one side surface as reads on the other,
 * giving the framing tests a transport that is not a UDS.
 * @param options - `objectMode` keeps pushed chunks undecoded.
 * @returns the Host and runtime ends of the pair.
 */
function createMemoryDuplexPair(options: { objectMode?: boolean } = {}): [Duplex, Duplex] {
  const aToB = new PassThrough({ ...options, encoding: 'utf8' })
  const bToA = new PassThrough({ ...options, encoding: 'utf8' })
  const hostSide = Duplex.from({ writable: aToB, readable: bToA })
  const runtimeSide = Duplex.from({ writable: bToA, readable: aToB })
  // Duplex.from destroy emits ABORT_ERR; swallow so NdjsonSocket.close is clean.
  const ignoreAbort = (error: NodeJS.ErrnoException): void => {
    if (error.code === 'ABORT_ERR') return
    throw error
  }
  hostSide.on('error', ignoreAbort)
  runtimeSide.on('error', ignoreAbort)
  return [hostSide, runtimeSide]
}

describe('ide-bridge transport lifecycle paths', () => {
  it('drops one Host connection without stopping the listener', async () => {
    const path = await socketPath('dsh-ide-conn-')
    const host = trackedHost()
    let connection: IdeBridgeHostConnection | undefined
    let disconnects = 0
    host.onFrame((frame, handle) => {
      if (frame.kind === 'hello') connection = handle
    })
    host.onDisconnect(() => {
      disconnects += 1
    })
    await host.listen(path)

    const first = trackedClient({ connected: false, sockPath: path })
    await first.connect()
    await vi.waitFor(() => {
      expect(connection).toBeDefined()
    }, { timeout: WAIT_MS })
    const handle = connection
    if (handle === undefined) throw new Error('the Host never received a connection handle')

    handle.close()
    expect(host.connectionCount()).toBe(0)
    await vi.waitFor(() => {
      expect(disconnects).toBe(1)
    }, { timeout: WAIT_MS })

    // The listener keeps accepting runtimes after one connection closed.
    const second = trackedClient({ connected: false, sockPath: path })
    await second.connect()
    await vi.waitFor(() => {
      expect(host.connectionCount()).toBe(1)
    }, { timeout: WAIT_MS })
  })

  it('reports a refused broadcast and replaces a stale listen path', async () => {
    const path = await socketPath('dsh-ide-stale-')
    await writeFile(path, '')
    const host = trackedHost()
    await host.listen(path)
    expect(existsSync(path)).toBe(true)
    const client = trackedClient({ connected: false, sockPath: path })
    await client.connect()
    await vi.waitFor(() => {
      expect(host.connectionCount()).toBe(1)
    }, { timeout: WAIT_MS })

    expect(host.broadcast({ kind: 'error', id: 'small', message: 'ok' })).toBe(1)
    // A frame larger than the socket's writable buffer is refused by write(),
    // and the Host must count it as unsent rather than as delivered.
    expect(host.broadcast({ kind: 'error', id: 'huge', message: 'm'.repeat(2_000_000) })).toBe(0)
  })

  it('rejects a second listen and a close with no running server', async () => {
    const path = await socketPath('dsh-ide-close-')
    const host = trackedHost()
    await host.listen(path)
    await expect(host.listen(`${path}.other`)).rejects.toThrow('IdeBridgeHostServer is already listening')
    await host.close()
    await expect(host.close()).resolves.toBeUndefined()

    // A failed listen keeps the server, and closing it reports the failure.
    const failed = trackedHost()
    await expect(failed.listen(join(tmpdir(), 'dsh-ide-missing-dir', 'bridge.sock'))).rejects.toThrow()
    await expect(failed.close()).rejects.toMatchObject({ code: 'ERR_SERVER_NOT_RUNNING' })
  })

  it('stays disconnected when the socket closes before the connect settled', async () => {
    const path = await socketPath('dsh-ide-midconnect-')
    const host = trackedHost()
    await host.listen(path)
    const state: IdeBridgeConnectionState = { connected: false, sockPath: path }
    const client = trackedClient(state)
    const attempt = client.connect()
    void attempt.catch(() => {
      // A destroyed socket may settle the attempt with an error; state holds the outcome.
    })
    client.close()
    expect(client.send({ kind: 'hello', role: 'runtime' })).toBe(false)
    expect(state.connected).toBe(false)
  })

  it('notifies disconnect listeners until their disposer removes them', async () => {
    const path = await socketPath('dsh-ide-disconnect-')
    const host = trackedHost()
    await host.listen(path)

    const kept = trackedClient({ connected: false, sockPath: path })
    let keptCount = 0
    kept.onDisconnect(() => {
      keptCount += 1
    })
    await kept.connect()
    kept.close()
    expect(keptCount).toBe(1)

    const dropped = trackedClient({ connected: false, sockPath: path })
    let droppedCount = 0
    const remove = dropped.onDisconnect(() => {
      droppedCount += 1
    })
    remove()
    await dropped.connect()
    dropped.close()
    expect(droppedCount).toBe(0)
  })

  it('rejects a connect without a socket path and a send without framing', async () => {
    const client = trackedClient({ connected: false, sockPath: null })
    await expect(client.connect()).rejects.toThrow('DSH_IDE_BRIDGE_SOCK is not set')
    expect(client.send({ kind: 'hello', role: 'runtime' })).toBe(false)
  })

  it('ignores unparsable lines and refuses sends on a closed framing socket', async () => {
    const [hostSide, runtimeSide] = createMemoryDuplexPair()
    const framing = new NdjsonSocket(runtimeSide)
    const frames: BridgeFrame[] = []
    framing.onFrame((frame) => {
      frames.push(frame)
    })
    runtimeSide.push('not-json\n{"kind":"hello","role":"host"}\n')
    await vi.waitFor(() => {
      expect(frames).toEqual([{ kind: 'hello', role: 'host' }])
    }, { timeout: WAIT_MS })
    expect(framing.send({ kind: 'hello', role: 'runtime' })).toBe(true)
    framing.close()
    framing.close()
    expect(framing.send({ kind: 'hello', role: 'runtime' })).toBe(false)
    hostSide.destroy()
  })

  it('decodes buffer chunks from a transport that keeps them undecoded', async () => {
    const [hostSide, runtimeSide] = createMemoryDuplexPair({ objectMode: true })
    const framing = new NdjsonSocket(runtimeSide)
    const frames: BridgeFrame[] = []
    framing.onFrame((frame) => {
      frames.push(frame)
    })
    hostSide.resume()
    runtimeSide.push(Buffer.from('{"kind":"hello","role":"host"}\n'))
    await vi.waitFor(() => {
      expect(frames).toEqual([{ kind: 'hello', role: 'host' }])
    }, { timeout: WAIT_MS })
    framing.close()
  })
})

describe('ide-bridge session/read-log closer fallbacks', () => {
  it('returns the raw events when dsh-session exposes no interrupt closers', async () => {
    vi.doMock('@deepseek-ai/dsh-session', () => ({ interruptedTurnClosers: undefined }))
    try {
      await withBridge((ctx) => {
        ctx.provide(SESSION_PERSISTENCE_SERVICE, {
          open: async () => ({
            read: async () => [{ type: 'user/message' }],
            close: async () => {},
          }),
        })
      }, async (harness) => {
        expect(await roundTrip(harness, { kind: 'session/read-log', id: 'closers-absent', sessionId: 'sess-a' }))
          .toEqual({
            kind: 'session/read-log/response',
            id: 'closers-absent',
            ok: true,
            events: [{ type: 'user/message' }],
          })
      })
    } finally {
      vi.doUnmock('@deepseek-ai/dsh-session')
      vi.resetModules()
    }
  })

  it('returns the raw events when dsh-session cannot be loaded', async () => {
    vi.doMock('@deepseek-ai/dsh-session', () => {
      throw new Error('session package is not installed')
    })
    try {
      await withBridge((ctx) => {
        ctx.provide(SESSION_PERSISTENCE_SERVICE, {
          open: async () => ({
            read: async () => [{ type: 'user/message' }],
            close: async () => {},
          }),
        })
      }, async (harness) => {
        expect(await roundTrip(harness, { kind: 'session/read-log', id: 'closers-unloadable', sessionId: 'sess-a' }))
          .toEqual({
            kind: 'session/read-log/response',
            id: 'closers-unloadable',
            ok: true,
            events: [{ type: 'user/message' }],
          })
      })
    } finally {
      vi.doUnmock('@deepseek-ai/dsh-session')
      vi.resetModules()
    }
  })
})
