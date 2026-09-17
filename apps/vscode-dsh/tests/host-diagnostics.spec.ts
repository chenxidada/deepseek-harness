/**
 * Phase 2 Host start-failure diagnostics: the record contract and its version
 * policy (AC-13, AD-14), redaction and the retry chain (AC-21, AC-22), the
 * interaction projection (AD-13), and the Extension surfaces that expose them.
 * The Host's own failure boundaries are exercised in `session-host.spec.ts`.
 */

import Module from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveNodeExecutableSpec } from '@deepseek-ai/dsh-sdk-client'
import {
  HOST_DIAGNOSTIC_RECORD_LIMIT,
  HOST_DIAGNOSTIC_SCHEMA_VERSION,
  HOST_DIAGNOSTICS_CHANNEL_NAME,
  HostDiagnosticRecorder,
  createStartFailureListener,
  formatHostDiagnosticRecord,
  hostFailureKindForStartError,
  startErrorKindForFailure,
  type HostDiagnosticRecord,
} from '../src/host-diagnostics.ts'
import {
  AutoStartOrchestrator,
  type StartErrorKind,
  type StartHostPort,
  type StartOrchestratorSnapshot,
} from '../src/auto-start-orchestrator.ts'
import { ConnectionUiController, type StatusBarItemLike } from '../src/connection-ui.ts'
import { InteractionCoordinator } from '../src/interaction-coordinator.ts'
import { HostStartError } from '../src/session-host.ts'
import {
  activate,
  deactivate,
  getChatPanelHost,
} from '../src/extension.ts'

/**
 * The 18 AD-14 record fields, each with the shape the design table declares.
 * This is the expectation source: the assertions below compare the produced
 * record against this table, never against the implementation's own types.
 */
const RECORD_FIELDS: ReadonlyArray<{
  name: string
  type: 'number' | 'string' | 'string[]'
  nullable: boolean
  enum?: readonly string[]
}> = [
  { name: 'schemaVersion', type: 'number', nullable: false },
  { name: 'seq', type: 'number', nullable: false },
  { name: 'time', type: 'number', nullable: false },
  { name: 'phase', type: 'string', nullable: false, enum: ['start', 'retry', 'post-handshake'] },
  { name: 'retryOfSeq', type: 'number', nullable: true },
  {
    name: 'kind',
    type: 'string',
    nullable: false,
    // The design table's member list (AD-14 `kind` row), not a transcription of
    // the implementation's type: six AC-named boundaries plus the `other` bucket.
    // `invalid-setting` is deliberately absent — it names a `StartErrorKind` the
    // StartHostPort layer raises before any Host boundary exists.
    enum: [
      'node-environment',
      'bridge-listen',
      'spawn',
      'handshake-timeout',
      'child-exited',
      'missing-credentials',
      'other',
    ],
  },
  { name: 'resolvedExecutable', type: 'string', nullable: true },
  {
    name: 'source',
    type: 'string',
    nullable: true,
    enum: ['dsh-node-bin', 'vscode-setting', 'process-exec-path'],
  },
  { name: 'nodeVersion', type: 'string', nullable: true },
  { name: 'expectedRange', type: 'string', nullable: true },
  { name: 'missingApis', type: 'string[]', nullable: false },
  { name: 'socketPath', type: 'string', nullable: true },
  { name: 'exitCode', type: 'number', nullable: true },
  { name: 'terminationSignal', type: 'string', nullable: true },
  { name: 'handshakeTimeoutMs', type: 'number', nullable: true },
  { name: 'stderrTail', type: 'string[]', nullable: false },
  { name: 'detail', type: 'string', nullable: false },
  { name: 'hint', type: 'string', nullable: false },
]

/**
 * Field names a rendered-text surface would carry. AD-14 forbids the record
 * from carrying one, so the contract test asserts their absence by name.
 */
const TEXT_RENDER_FIELDS = ['text', 'renderedText', 'summary', 'log'] as const

function expectFieldShape(record: Record<string, unknown>, field: typeof RECORD_FIELDS[number]): void {
  const value = record[field.name]
  if (value === null) {
    expect(field.nullable, `${field.name} is null but AD-14 declares it non-nullable`).toBe(true)
    return
  }
  expect(value, `${field.name} must always be present`).toBeDefined()
  if (field.type === 'string[]') {
    expect(Array.isArray(value), `${field.name} must be an array`).toBe(true)
    for (const item of value as unknown[]) expect(typeof item).toBe('string')
    return
  }
  expect(typeof value, `${field.name} must be a ${field.type}`).toBe(field.type)
  if (field.enum !== undefined) {
    expect(field.enum, `${field.name} must be one of its members`).toContain(value)
  }
}

describe('HostDiagnosticRecord contract (AD-14 / AC-13)', () => {
  // The single contract-completeness case the phase owes (spec.md:63): field set,
  // per-field shape, version source, and the absence of a text-rendering field
  // are asserted together, so a change to the record cannot satisfy one clause by
  // breaking another.
  it('AC-13: a record carries exactly the 18 AD-14 fields with their declared shapes', () => {
    const recorder = new HostDiagnosticRecorder()
    const record = recorder.record({
      kind: 'handshake-timeout',
      detail: 'initialize timed out after 300ms',
      handshakeTimeoutMs: 300,
      resolvedExecutable: '/usr/bin/node',
      source: 'process-exec-path',
      socketPath: '/tmp/dsh-bridge.sock',
      stderrTail: ['one', 'two'],
    })

    const produced = record as unknown as Record<string, unknown>
    expect(RECORD_FIELDS).toHaveLength(18)
    expect(Object.keys(produced).sort()).toEqual(RECORD_FIELDS.map(field => field.name).sort())
    for (const field of RECORD_FIELDS) expectFieldShape(produced, field)

    // (c) The version is the literal v2 and it comes from the product constant:
    // bumping the constant without moving the field table fails right here.
    expect(HOST_DIAGNOSTIC_SCHEMA_VERSION).toBe(2)
    expect(record.schemaVersion).toBe(HOST_DIAGNOSTIC_SCHEMA_VERSION)

    // (d) No rendered-text field exists, by name and by value.
    for (const field of TEXT_RENDER_FIELDS) expect(produced[field]).toBeUndefined()
    for (const key of Object.keys(produced)) expect(TEXT_RENDER_FIELDS).not.toContain(key)

    // Fields this boundary does not fill are null / empty, never absent.
    expect(record.retryOfSeq).toBeNull()
    expect(record.nodeVersion).toBeNull()
    expect(record.expectedRange).toBeNull()
    expect(record.exitCode).toBeNull()
    expect(record.terminationSignal).toBeNull()
    expect(record.missingApis).toEqual([])
    expect(record.detail).toBe('initialize timed out after 300ms')
    expect(record.hint).not.toBe('')
    expect(record.handshakeTimeoutMs).toBe(300)
    expect(record.resolvedExecutable).toBe('/usr/bin/node')
    expect(record.source).toBe('process-exec-path')
    expect(record.socketPath).toBe('/tmp/dsh-bridge.sock')
    expect(record.stderrTail).toEqual(['one', 'two'])
  })

  it('AD-14: a boundary with no facts of its own still yields the full non-empty shape', () => {
    const recorder = new HostDiagnosticRecorder()
    const record = recorder.record({ kind: 'other' })

    for (const field of RECORD_FIELDS) expectFieldShape(record as unknown as Record<string, unknown>, field)
    expect(record.detail).not.toBe('')
    expect(record.hint).not.toBe('')
    expect(record.stderrTail).toEqual([])
    expect(record.missingApis).toEqual([])
    expect(record.source).toBeNull()
    expect(record.resolvedExecutable).toBeNull()
  })

  it('AD-14: the version is the v2 literal sourced from the single product constant', () => {
    const recorder = new HostDiagnosticRecorder()
    const record = recorder.record({ kind: 'other' })

    // Literal assertion: bumping the constant must fail here, which is what
    // forces the field table and the version to move together.
    expect(HOST_DIAGNOSTIC_SCHEMA_VERSION).toBe(2)
    expect(record.schemaVersion).toBe(2)
    expect(record.schemaVersion).toBe(HOST_DIAGNOSTIC_SCHEMA_VERSION)
  })

  it('AD-14: no rendered-text field exists on a record', () => {
    const recorder = new HostDiagnosticRecorder()
    const record = recorder.record({ kind: 'spawn', detail: 'spawn ENOENT' }) as unknown as Record<string, unknown>

    for (const field of TEXT_RENDER_FIELDS) expect(record[field]).toBeUndefined()
    for (const key of Object.keys(record)) expect(TEXT_RENDER_FIELDS).not.toContain(key)
  })
})

/**
 * Reading policy of AD-14 decisions 9–12: assert the field set exactly for the
 * version this reader knows, restrict to that version's subset for a newer one,
 * and treat an absent or malformed version as a harness error. This mirrors what
 * a driver of `dsh.test.getDiagnosticsText` must do with the array it reads back.
 */
function readRecords(raw: unknown): { version: number | null; records: readonly Record<string, unknown>[] } {
  if (!Array.isArray(raw)) throw new Error('HARNESS_ERROR: diagnostics hook did not return an array')
  if (raw.length === 0) return { version: null, records: [] }
  const records = raw as readonly Record<string, unknown>[]
  const version = records[0].schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`HARNESS_ERROR: unusable schemaVersion ${JSON.stringify(version)}`)
  }
  for (const record of records) {
    if (version === HOST_DIAGNOSTIC_SCHEMA_VERSION) {
      expect(Object.keys(record).sort()).toEqual(RECORD_FIELDS.map(field => field.name).sort())
      for (const field of RECORD_FIELDS) expectFieldShape(record, field)
      continue
    }
    // A newer contract: only the subset this reader depends on, so a field a
    // later version added is not a failure.
    for (const name of ['seq', 'phase', 'retryOfSeq', 'kind', 'stderrTail', 'detail', 'hint']) {
      expect(record[name], `${name} must survive a version bump`).toBeDefined()
    }
  }
  return { version, records }
}

describe('diagnostics reading policy (AD-14 version split)', () => {
  const known = new HostDiagnosticRecorder().record({ kind: 'other' }) as unknown as Record<string, unknown>

  it('accepts an empty store without asserting any version', () => {
    const read = readRecords([])
    expect(read.records).toEqual([])
    expect(read.version).toBeNull()
  })

  it('asserts the exact field set for a record of the version the reader knows', () => {
    const read = readRecords([{ ...known }])
    expect(read.version).toBe(HOST_DIAGNOSTIC_SCHEMA_VERSION)
    expect(Object.keys(read.records[0])).toHaveLength(18)
  })

  it('accepts a future version and only checks the subset it depends on', () => {
    const future = { ...known, schemaVersion: HOST_DIAGNOSTIC_SCHEMA_VERSION + 1, futureField: 'added later' }
    const read = readRecords([future])
    // The observed version is evidence a driver records, not a failure.
    expect(read.version).toBe(HOST_DIAGNOSTIC_SCHEMA_VERSION + 1)
    expect(read.records[0].kind).toBe('other')
    expect(read.records[0].futureField).toBe('added later')
  })

  it('treats a missing, null, zero, or non-integer version as a harness error', () => {
    const { schemaVersion: _dropped, ...withoutVersion } = known
    const unusable = [
      withoutVersion,
      { ...known, schemaVersion: null },
      { ...known, schemaVersion: 0 },
      { ...known, schemaVersion: String(HOST_DIAGNOSTIC_SCHEMA_VERSION) },
      { ...known, schemaVersion: 1.5 },
    ]
    for (const bad of unusable) expect(() => readRecords([bad])).toThrow(/HARNESS_ERROR/)
  })

  it('treats a non-array payload as a harness error', () => {
    expect(() => readRecords(undefined)).toThrow(/HARNESS_ERROR/)
    expect(() => readRecords({ schemaVersion: 2, records: [] })).toThrow(/HARNESS_ERROR/)
  })
})

/**
 * The absolute-path clause of AD-14's `resolvedExecutable` row is conditional:
 * only the `process-exec-path` source is absolute by construction, because
 * `resolveNodeExecutableSpec` hands back `DSH_NODE_BIN` and the `dsh.nodeBin`
 * setting verbatim (`launch.ts:132-139`). This pins the direction that does
 * hold, so a future change that makes the field unconditionally absolute has to
 * come here and say so.
 */
describe('resolved executable path shape (AD-1 / AD-9)', () => {
  const previousNodeBin = process.env.DSH_NODE_BIN

  afterEach(() => {
    if (previousNodeBin === undefined) delete process.env.DSH_NODE_BIN
    else process.env.DSH_NODE_BIN = previousNodeBin
  })

  it('resolves an absolute path for the process-exec-path source and records it unchanged', () => {
    delete process.env.DSH_NODE_BIN
    const resolved = resolveNodeExecutableSpec()

    expect(resolved.source).toBe('process-exec-path')
    expect(isAbsolute(resolved.path)).toBe(true)

    const record = new HostDiagnosticRecorder().record({
      kind: 'other',
      resolvedExecutable: resolved.path,
      source: resolved.source,
    })
    expect(record.resolvedExecutable).toBe(resolved.path)
    expect(isAbsolute(record.resolvedExecutable ?? '')).toBe(true)
  })

  it('passes a caller-supplied setting through verbatim rather than absolutising it', () => {
    delete process.env.DSH_NODE_BIN
    const relative = 'relative/node'
    const resolved = resolveNodeExecutableSpec({ nodeBinSetting: relative })

    expect(resolved).toMatchObject({ path: relative, source: 'vscode-setting' })
    expect(isAbsolute(resolved.path)).toBe(false)
  })
})

describe('HostDiagnosticRecorder store (AC-21 / AC-22)', () => {
  const SECRET = 'super-secret-value-1234'
  const secondSecret = 'second-secret-value-9876'
  const previousToken = process.env.DSH_TEST_TOKEN

  afterEach(() => {
    if (previousToken === undefined) delete process.env.DSH_TEST_TOKEN
    else process.env.DSH_TEST_TOKEN = previousToken
  })

  it('AC-21: redacts credential values from every field, the JSON form, and the rendered block', () => {
    process.env.DSH_TEST_TOKEN = SECRET
    const presented: HostDiagnosticRecord[] = []
    const recorder = new HostDiagnosticRecorder({
      sink: { present: record => presented.push(record) },
      credentials: { DSH_TEST_SECRET: secondSecret },
    })
    const record = recorder.record({
      kind: 'child-exited',
      detail: `runtime stopped after token=${SECRET} and secret=${secondSecret}`,
      resolvedExecutable: `/tmp/${SECRET}/node`,
      socketPath: `/tmp/${secondSecret}.sock`,
      exitCode: 1,
      stderrTail: [`boom ${SECRET}`, 'plain line'],
      hint: `rotate ${secondSecret}`,
    })

    for (const text of [record.detail, record.hint, record.resolvedExecutable, record.socketPath]) {
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain(secondSecret)
    }
    for (const line of record.stderrTail) expect(line).not.toContain(SECRET)
    expect(record.detail).toContain('[redacted:DSH_TEST_TOKEN]')
    expect(record.detail).toContain('[redacted:DSH_TEST_SECRET]')
    expect(record.hint).toContain('[redacted:DSH_TEST_SECRET]')

    // The serialized form is what `dsh.test.getDiagnosticsText` hands a driver.
    expect(JSON.stringify(recorder.records())).not.toContain(SECRET)
    expect(JSON.stringify(presented)).not.toContain(SECRET)
    expect(JSON.stringify(presented)).toContain('[redacted:DSH_TEST_TOKEN]')

    // The rendered block carries every element, so it cannot hide a field.
    const rendered = presented.map(formatHostDiagnosticRecord).join('\n')
    expect(rendered).not.toContain(SECRET)
    expect(rendered).toContain('[redacted:DSH_TEST_TOKEN]')
    expect(rendered).toContain('plain line')
    expect(rendered).toContain('child-exited')
    expect(rendered).toContain('exit code: 1')
    expect(rendered).toContain('stderr tail (2 lines):')
  })

  it('AC-21: redacts credential-named keys whatever value shape reached the record', () => {
    const values = {
      DSH_TEST_API_KEY: 'key-value-aaaa',
      DSH_TEST_PASSWORD: 'password-value-bbbb',
      DSH_TEST_SECRET: 'secret-value-cccc',
      DSH_TEST_TOKEN: 'token-value-dddd',
    }
    const recorder = new HostDiagnosticRecorder({ credentials: values })
    const record = recorder.record({
      kind: 'other',
      detail: Object.values(values).join(' '),
      stderrTail: Object.entries(values).map(([key, value]) => `${key}=${value}`),
    })

    for (const value of Object.values(values)) {
      expect(record.detail).not.toContain(value)
      expect(record.stderrTail.join('\n')).not.toContain(value)
    }
    expect(record.detail).toContain('[redacted:DSH_TEST_API_KEY]')
    expect(record.detail).toContain('[redacted:DSH_TEST_PASSWORD]')
    expect(record.detail).toContain('[redacted:DSH_TEST_SECRET]')
    expect(record.detail).toContain('[redacted:DSH_TEST_TOKEN]')
  })

  it('AC-22: a failure chain pairs every retry with the record that opened it', () => {
    const recorder = new HostDiagnosticRecorder()
    const first = recorder.record({ kind: 'node-environment' })
    const second = recorder.record({ kind: 'node-environment' })

    expect(first).toMatchObject({ seq: 1, phase: 'start', retryOfSeq: null })
    expect(second).toMatchObject({ seq: 2, phase: 'retry', retryOfSeq: first.seq })
    expect(recorder.lastSeq()).toBe(second.seq)

    const third = recorder.record({ kind: 'bridge-listen' })
    expect(third).toMatchObject({ seq: 3, phase: 'retry', retryOfSeq: first.seq })
    expect(third.seq).toBeGreaterThan(second.seq)

    // A start that succeeds closes the chain: the next failure opens a new one.
    recorder.onStartSucceeded()
    const fourth = recorder.record({ kind: 'spawn' })
    expect(fourth).toMatchObject({ seq: 4, phase: 'start', retryOfSeq: null })
  })

  it('DEBT-010: a post-handshake death is its own phase and opens the chain a retry joins', () => {
    const recorder = new HostDiagnosticRecorder()
    // A start that reached `connected` closes any earlier chain...
    recorder.record({ kind: 'other' })
    recorder.onStartSucceeded()

    // ...so the death that follows is not a retry of that start, and it says so
    // through the third `phase` member instead of a field of its own.
    const death = recorder.record({ kind: 'child-exited', phase: 'post-handshake' })
    expect(death).toMatchObject({ phase: 'post-handshake', retryOfSeq: null })
    expect(Object.keys(death)).toHaveLength(18)

    // A retry driven by that death still pairs with the record that ended the
    // previous connection, so AC-22's chain survives the new boundary.
    const retry = recorder.record({ kind: 'spawn' })
    expect(retry).toMatchObject({ phase: 'retry', retryOfSeq: death.seq })
  })

  it('keeps the store bounded, dropping the oldest records first', () => {
    const recorder = new HostDiagnosticRecorder()
    const overflow = 5
    for (let index = 0; index < HOST_DIAGNOSTIC_RECORD_LIMIT + overflow; index += 1) {
      recorder.record({ kind: 'other' })
    }
    const records = recorder.records()

    expect(records).toHaveLength(HOST_DIAGNOSTIC_RECORD_LIMIT)
    expect(records[0].seq).toBe(overflow + 1)
    expect(records[records.length - 1].seq).toBe(HOST_DIAGNOSTIC_RECORD_LIMIT + overflow)
  })

  it('returns a copy, so a reader cannot reach into the store', () => {
    const recorder = new HostDiagnosticRecorder()
    recorder.record({ kind: 'other', stderrTail: ['kept'] })
    const records = recorder.records() as HostDiagnosticRecord[]
    records.length = 0
    expect(recorder.records()).toHaveLength(1)
  })

  it('keeps record time non-decreasing even when the clock steps backwards', () => {
    let now = 1_000
    const recorder = new HostDiagnosticRecorder({ now: () => now })
    const first = recorder.record({ kind: 'other' })
    now = 500
    const second = recorder.record({ kind: 'other' })
    expect(first.time).toBe(1_000)
    expect(second.time).toBe(1_000)
  })
})

describe('start-failure classification (AD-3 / AD-4)', () => {
  it('keeps the record vocabulary to the six AC-named boundaries plus `other`', () => {
    const kind = RECORD_FIELDS.find(field => field.name === 'kind')
    expect(kind?.enum).toEqual([
      'node-environment',
      'bridge-listen',
      'spawn',
      'handshake-timeout',
      'child-exited',
      'missing-credentials',
      'other',
    ])
    // Reverse assertion: `invalid-setting` is a `StartErrorKind`, not a record
    // kind — the StartHostPort layer raises it before any Host boundary exists.
    expect(kind?.enum).not.toContain('invalid-setting')
  })

  it('does not record a class another layer already speaks for', () => {
    // An explicit decision about `invalid-setting` rather than a fall-through: the
    // StartHostPort layer raises it before any Host boundary exists, and the
    // Extension's own `other` fallback carries its message, so a record here
    // would count one attempt twice (AC-22).
    expect(hostFailureKindForStartError('invalid-setting')).toBeNull()
    // The one refusal this listener does own: it is raised by the orchestrator
    // itself, before the Host is entered.
    expect(hostFailureKindForStartError('missing-credentials')).toBe('missing-credentials')
    // The Host records its own boundary for these, so this listener stays silent.
    const hostOwned: readonly StartErrorKind[] = [
      'node-environment',
      'bridge-listen',
      'spawn',
      'handshake-timeout',
      'process-failed',
    ]
    for (const kind of hostOwned) expect(hostFailureKindForStartError(kind)).toBeNull()
    expect(hostFailureKindForStartError(undefined)).toBeNull()
  })

  it('maps every record kind onto exactly one orchestrator class', () => {
    expect(startErrorKindForFailure('node-environment')).toBe('node-environment')
    expect(startErrorKindForFailure('bridge-listen')).toBe('bridge-listen')
    expect(startErrorKindForFailure('spawn')).toBe('spawn')
    expect(startErrorKindForFailure('handshake-timeout')).toBe('handshake-timeout')
    expect(startErrorKindForFailure('missing-credentials')).toBe('missing-credentials')
    expect(startErrorKindForFailure('child-exited')).toBe('process-failed')
    expect(startErrorKindForFailure('other')).toBe('process-failed')
  })

  it('AC-19: records a missing-credentials attempt once, with the snapshot message', () => {
    const recorder = new HostDiagnosticRecorder()
    const listener = createStartFailureListener(recorder)
    const failed: StartOrchestratorSnapshot = {
      state: 'failed',
      pendingReasons: [],
      errorKind: 'missing-credentials',
      errorMessage: 'missing credentials',
      autoRetryUsed: false,
    }

    // One failed attempt moves the snapshot more than once (the reason records
    // it, the disconnect edge repeats it); it must still be one record.
    listener(failed)
    listener(failed)
    const opening = recorder.record({ kind: 'other' })
    const records = recorder.records()

    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      kind: 'missing-credentials',
      detail: 'missing credentials',
      phase: 'start',
      retryOfSeq: null,
    })
    expect(opening).toMatchObject({ seq: 2, phase: 'retry', retryOfSeq: records[0].seq })
  })

  it('leaves an invalid-setting refusal to the Extension fallback, not this listener', () => {
    const recorder = new HostDiagnosticRecorder()
    const listener = createStartFailureListener(recorder)
    listener({
      state: 'failed',
      pendingReasons: [],
      errorKind: 'invalid-setting',
      errorMessage: 'dsh.nodeBin must be a path to a Node.js executable string, got number',
      autoRetryUsed: false,
    })

    // No record here: the StartHostPort layer raised this before any Host boundary
    // existed, so the record vocabulary has no member for it. The Extension's own
    // catch records it once as `other`, which is what keeps the failure visible
    // without counting one attempt twice (see the extension-level case below).
    expect(recorder.records()).toEqual([])
  })

  it('ignores Host-owned kinds and non-failed snapshots, and reopens a chain after an attempt ends', () => {
    const recorder = new HostDiagnosticRecorder()
    const listener = createStartFailureListener(recorder)
    listener({ state: 'starting', pendingReasons: [], autoRetryUsed: false })
    listener({ state: 'started', pendingReasons: [], autoRetryUsed: false })
    listener({
      state: 'failed',
      pendingReasons: [],
      errorKind: 'spawn',
      errorMessage: 'spawn ENOENT',
      autoRetryUsed: false,
    })
    listener({ state: 'failed', pendingReasons: [], errorMessage: 'unclassified', autoRetryUsed: false })
    expect(recorder.records()).toEqual([])

    listener({ state: 'failed', pendingReasons: [], errorKind: 'missing-credentials', autoRetryUsed: false })
    const records = recorder.records()
    expect(records).toHaveLength(1)
    // No message supplied: the record still carries the kind's own sentence.
    expect(records[0].detail).not.toBe('')

    // Leaving `failed` re-arms the guard — that edge is the attempt boundary, so
    // the next failure of the same class is a new attempt rather than a repeat of
    // the old one.
    listener({ state: 'started', pendingReasons: [], autoRetryUsed: false })
    listener({ state: 'failed', pendingReasons: [], errorKind: 'missing-credentials', autoRetryUsed: false })
    expect(recorder.records()).toHaveLength(2)
    expect(recorder.records()[1]).toMatchObject({ phase: 'retry', retryOfSeq: records[0].seq })
  })
})

/**
 * The guard behind AC-22(b). Two behaviours have to hold at once: one attempt is
 * recorded once, and every new attempt is recorded as the next link of the
 * chain. The case that used to break is a retry of a pre-Host refusal — a
 * failure that never reaches `started` — which the guard suppressed forever,
 * leaving AC-22(c)'s retry entry with no record pair on exactly the state that
 * offers it.
 */
describe('start-failure listener attempt boundary (AC-22)', () => {
  /** A pre-Host refusal, as the orchestrator projects it. */
  function refusal(): StartOrchestratorSnapshot {
    return {
      state: 'failed',
      pendingReasons: [],
      errorKind: 'missing-credentials',
      errorMessage: 'missing credentials',
      autoRetryUsed: false,
    }
  }

  /** A snapshot that ends an attempt; every attempt passes through `starting`. */
  function attemptBoundary(): StartOrchestratorSnapshot {
    return { state: 'starting', pendingReasons: [], autoRetryUsed: false }
  }

  it('records one attempt once, however often the snapshot repeats the failure', () => {
    const recorder = new HostDiagnosticRecorder()
    const listener = createStartFailureListener(recorder)
    // Within one attempt the snapshot can settle more than once (the failure
    // itself, then the disconnect edge) with an identical class and message.
    listener(refusal())
    listener(refusal())
    listener(refusal())
    expect(recorder.records()).toHaveLength(1)
  })

  it('records a retry of a pre-Host refusal as the next link of the chain', () => {
    const recorder = new HostDiagnosticRecorder()
    const listener = createStartFailureListener(recorder)
    listener(refusal())
    listener(attemptBoundary())
    listener(refusal())

    const records = recorder.records()
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ kind: 'missing-credentials', phase: 'start', retryOfSeq: null })
    expect(records[1]).toMatchObject({
      kind: 'missing-credentials',
      detail: 'missing credentials',
      phase: 'retry',
      retryOfSeq: records[0].seq,
    })
    expect(records[1].seq).toBeGreaterThan(records[0].seq)
  })

  it('re-arms on a queued retry, so a coalesced second reason also gets a record', async () => {
    // The queued path in `AutoStartOrchestrator.runStart` (the `pending` splice)
    // starts a second attempt without a user action; it must produce its own
    // record for the same reason the manual retry does.
    const gates: Array<() => void> = []
    const starts: string[] = []
    const port: StartHostPort = {
      isConnected: () => false,
      hasCredentials: () => true,
      async start(reason) {
        starts.push(reason)
        await new Promise<void>(resolve => gates.push(resolve))
        throw Object.assign(new Error('missing credentials'), { kind: 'missing-credentials' as const })
      },
    }
    const recorder = new HostDiagnosticRecorder()
    const orchestrator = new AutoStartOrchestrator(port)
    orchestrator.onChange(createStartFailureListener(recorder))

    const first = orchestrator.request('command-start')
    await Promise.resolve()
    // A second reason arrives while the first attempt is in flight: it coalesces
    // into `pending-start` instead of starting a parallel attempt.
    const queued = orchestrator.request('command-send')
    await Promise.resolve()
    expect(starts).toEqual(['command-start'])

    gates[0]()
    while (gates.length < 2) await Promise.resolve()
    gates[1]()
    await first
    await queued

    expect(starts).toEqual(['command-start', 'command-send'])
    const records = recorder.records()
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ phase: 'start', retryOfSeq: null })
    expect(records[1]).toMatchObject({ phase: 'retry', retryOfSeq: records[0].seq })
    expect(records[1].seq).toBeGreaterThan(records[0].seq)
  })

  /**
   * The second record edge DEBT-010 located. `AutoStartOrchestrator.runStart`
   * synthesises a `failed` snapshot with `errorKind: 'process-failed'` when a
   * start resolves without leaving a live connection; no Host boundary speaks
   * for that state, so before this edge it left no record at all. The two cases
   * below are the whole decision: unrecorded → one record; already recorded →
   * none, because recording it again would count one attempt twice (AC-22).
   */
  it('records a start that resolved without a live connection, once, as `other`', async () => {
    // A port that violates the start contract in exactly the way the
    // orchestrator's else-branch covers: `start` resolves, nothing is connected.
    const port: StartHostPort = {
      isConnected: () => false,
      hasCredentials: () => true,
      async start() {},
    }
    const recorder = new HostDiagnosticRecorder()
    const orchestrator = new AutoStartOrchestrator(port)
    const listener = createStartFailureListener(recorder)
    orchestrator.onChange(listener)

    await orchestrator.request('command-start')
    expect(orchestrator.getSnapshot()).toMatchObject({
      state: 'failed',
      errorKind: 'process-failed',
      errorMessage: 'Host start completed without a live connection',
    })

    const records = recorder.records()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'other', phase: 'start', retryOfSeq: null })
    expect(records[0].detail).toBe('Host start completed without a live connection')

    // The snapshot can settle more than once within one attempt; the record does not.
    orchestrator.onChange(listener)()
    expect(recorder.records()).toHaveLength(1)
  })

  it('leaves a `process-failed` failure alone when a Host boundary already recorded it', async () => {
    // The Host's own `child-exited`/`other` boundary maps onto `process-failed`
    // and records through the same store, so the mark moves during the attempt.
    const port: StartHostPort = {
      isConnected: () => false,
      hasCredentials: () => true,
      async start() {
        recorder.record({ kind: 'child-exited', detail: 'runtime stopped before the handshake' })
        throw new HostStartError('process-failed', 'runtime stopped before the handshake')
      },
    }
    const recorder = new HostDiagnosticRecorder()
    const orchestrator = new AutoStartOrchestrator(port)
    orchestrator.onChange(createStartFailureListener(recorder))

    await orchestrator.request('command-start')
    expect(orchestrator.getSnapshot()).toMatchObject({ state: 'failed', errorKind: 'process-failed' })
    const records = recorder.records()
    expect(records).toHaveLength(1)
    expect(records[0].kind).toBe('child-exited')
  })
})

describe('ConnectionUi terminal states (AC-19 / AC-20)', () => {
  function statusBarItem(): StatusBarItemLike & { shown: boolean } {
    const item = {
      text: '',
      command: undefined as StatusBarItemLike['command'],
      shown: false,
      show() { item.shown = true },
      hide() { item.shown = false },
      dispose() {},
    }
    return item
  }

  function controller(): { ui: ConnectionUiController; bar: ReturnType<typeof statusBarItem>; applied: string[] } {
    const bar = statusBarItem()
    const applied: string[] = []
    const ui = new ConnectionUiController(
      { window: { createStatusBarItem: () => bar }, StatusBarAlignment: { Left: 1, Right: 2 } },
      {
        isConversationVisible: () => false,
        applyConnectionState: state => applied.push(state.phase),
      },
    )
    return { ui, bar, applied }
  }

  /** Every root cause AC-20 must keep out of the in-progress copy, with its own text. */
  const ROOT_CAUSES: ReadonlyArray<{ kind: StartErrorKind; message: string }> = [
    { kind: 'spawn', message: 'runtime subprocess could not be launched' },
    { kind: 'handshake-timeout', message: 'initialize did not answer within 300ms' },
    { kind: 'bridge-listen', message: 'ide-bridge socket refused to listen' },
    { kind: 'process-failed', message: 'runtime process exited before the handshake' },
    { kind: 'missing-credentials', message: 'missing credentials' },
    { kind: 'node-environment', message: 'Node environment check failed' },
    { kind: 'invalid-setting', message: 'dsh.nodeBin held a value of the wrong type' },
  ]

  it('AC-20: no failing root cause is left showing the in-progress copy', () => {
    const { ui, applied } = controller()
    for (const cause of ROOT_CAUSES) {
      ui.projectOrchestrator({
        state: 'failed',
        pendingReasons: [],
        errorKind: cause.kind,
        errorMessage: cause.message,
        autoRetryUsed: false,
      })
      const state = ui.getState()
      // The root cause is read off `errorKind`, never reverse-engineered from text.
      expect(state.phase).toBe('failed')
      expect(state.phase).not.toBe('connecting')
      expect(state.message).toBe(cause.message)
      expect(state.message).not.toBe('正在连接到 Host…')
      expect(state.message).not.toBe('')
      expect(state.statusBarVisible).toBe(true)
      expect(applied[applied.length - 1]).toBe('failed')
    }
  })

  it('AC-19: missing credentials offers the settings entry and drops the connecting copy', () => {
    const { ui: missingUi, bar } = controller()
    missingUi.projectOrchestrator({
      state: 'failed',
      pendingReasons: [],
      errorKind: 'missing-credentials',
      errorMessage: 'missing credentials',
      autoRetryUsed: false,
    })
    const state = missingUi.getState()
    expect(state.phase).toBe('failed')
    expect(state.message).toContain('missing credentials')
    expect(state.settingsDeepLinkAvailable).toBe(true)
    expect(state.message).not.toBe('正在连接到 Host…')

    // AC-22(c): the retry entry the failure state points at is clickable.
    expect(bar.command).toBe('dsh.statusBarAction')
    expect(bar.shown).toBe(true)

    // A failure with no root cause of its own still gets a terminal sentence.
    const { ui: otherUi } = controller()
    otherUi.projectOrchestrator({ state: 'failed', pendingReasons: [], autoRetryUsed: false })
    expect(otherUi.getState()).toMatchObject({
      phase: 'failed',
      message: 'Host connection failed.',
      settingsDeepLinkAvailable: false,
    })
  })

  it('never projects a failed Host back to the connecting copy', () => {
    const { ui } = controller()
    ui.projectOrchestrator({ state: 'starting', pendingReasons: [], autoRetryUsed: false })
    expect(ui.getState().phase).toBe('connecting')
    ui.projectOrchestrator({
      state: 'failed',
      pendingReasons: [],
      errorKind: 'bridge-listen',
      errorMessage: 'ide-bridge socket refused to listen',
      autoRetryUsed: false,
    })
    expect(ui.getState()).toMatchObject({
      phase: 'failed',
      message: 'ide-bridge socket refused to listen',
    })
  })
})

describe('InteractionCoordinator.listPending projection (AD-13)', () => {
  function coordinator(): InteractionCoordinator {
    const instance = new InteractionCoordinator()
    instance.setUi({
      presentApproval: () => new Promise<never>(() => {}),
      presentQuestions: () => new Promise<never>(() => {}),
    })
    return instance
  }

  it('carries the approval tool name and reason verbatim without widening the surface', () => {
    const instance = coordinator()
    void instance.handleApproval({
      id: 'approval-1',
      sessionId: 'session-a',
      toolName: 'bash',
      reason: 'needs to run the test suite',
    })

    const pending = instance.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      kind: 'approval',
      id: 'approval-1',
      sessionId: 'session-a',
      toolName: 'bash',
      reason: 'needs to run the test suite',
    })
    // The projection stays a projection: the queue's settle hook is not exposed.
    expect(Object.keys(pending[0]).sort()).toEqual(
      ['abort', 'id', 'kind', 'reason', 'sessionId', 'state', 'toolName'],
    )
  })

  it('omits the optional fields an approval did not carry', () => {
    const instance = coordinator()
    void instance.handleApproval({
      id: 'approval-2',
      sessionId: 'session-a',
      toolName: 'read',
    })

    const pending = instance.listPending()
    expect(pending[0]).toMatchObject({ kind: 'approval', toolName: 'read' })
    expect(Object.keys(pending[0]).sort()).toEqual(
      ['abort', 'id', 'kind', 'sessionId', 'state', 'toolName'],
    )
  })

  it('keeps a questions entry unchanged', () => {
    const instance = coordinator()
    void instance.handleQuestions({
      id: 'questions-1',
      sessionId: 'session-b',
      questions: [{ id: 'q1', question: 'proceed?', options: [{ label: 'yes' }] }],
    })

    const pending = instance.listPending()
    expect(pending).toHaveLength(1)
    expect(Object.keys(pending[0]).sort()).toEqual(['abort', 'id', 'kind', 'sessionId', 'state'])
  })
})

describe('orchestrator failure-class pass-through (AC-15 / AC-16 / AD-4)', () => {
  function portThrowing(error: unknown): StartHostPort {
    return {
      isConnected: () => false,
      hasCredentials: () => true,
      async start() {
        throw error
      },
    }
  }

  it('keeps every Host failure class on the snapshot instead of flattening it', async () => {
    const classes: readonly StartErrorKind[] = [
      'node-environment',
      'invalid-setting',
      'bridge-listen',
      'spawn',
      'handshake-timeout',
      'process-failed',
    ]
    for (const kind of classes) {
      // The real carrier the Host throws, so this asserts the hop, not a shape.
      const orchestrator = new AutoStartOrchestrator(portThrowing(new HostStartError(kind, `start failed: ${kind}`)))
      await orchestrator.request('command-start')
      const snapshot = orchestrator.getSnapshot()
      expect(snapshot.state).toBe('failed')
      expect(snapshot.errorKind).toBe(kind)
      expect(snapshot.errorMessage).toBe(`start failed: ${kind}`)
    }
  })

  it('AC-15 / AC-16: the timeout and listen classes reach the snapshot by name', async () => {
    const orchestrator = new AutoStartOrchestrator(
      portThrowing(new HostStartError('handshake-timeout', 'initialize did not answer within 300ms')),
    )
    await orchestrator.request('command-start')
    expect(orchestrator.getSnapshot()).toMatchObject({
      state: 'failed',
      errorKind: 'handshake-timeout',
    })

    const listening = new AutoStartOrchestrator(
      portThrowing(new HostStartError('bridge-listen', 'ide-bridge socket refused to listen')),
    )
    await listening.request('command-start')
    expect(listening.getSnapshot()).toMatchObject({ state: 'failed', errorKind: 'bridge-listen' })
  })
})

describe('Extension Host diagnostic surfaces (AC-13 / AC-14 / AC-19 / AC-21 / AC-22)', () => {
  interface FakeChannel {
    name: string
    lines: string[]
    shown: number
    disposed: number
  }

  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const channels: FakeChannel[] = []
  const executed: string[] = []
  let statusBar: {
    text: string
    command?: string | { command: string }
    tooltip?: string
    shown: boolean
    hidden: number
  } | undefined
  let nodeBin: unknown
  const dirs: string[] = []
  const secretRestores: Array<() => void> = []

  /**
   * `DSH_NODE_BIN` outranks `dsh.nodeBin` in the resolution chain, so an inherited
   * value would re-source the executable out from under the starts below and the
   * field assertions would describe that input instead of the setting. Every case
   * in this block drives the setting path, so the variable is pinned to absent.
   */
  const inheritedNodeBin = process.env.DSH_NODE_BIN

  beforeEach(() => {
    delete process.env.DSH_NODE_BIN
  })

  afterEach(async () => {
    if (inheritedNodeBin === undefined) delete process.env.DSH_NODE_BIN
    else process.env.DSH_NODE_BIN = inheritedNodeBin
    await deactivate()
    commands.clear()
    channels.length = 0
    executed.length = 0
    statusBar = undefined
    nodeBin = undefined
    for (const restore of secretRestores.splice(0)) restore()
    while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
  })

  function fakeOutputChannel(name: string) {
    const channel: FakeChannel = { name, lines: [], shown: 0, disposed: 0 }
    channels.push(channel)
    return {
      appendLine(value: string) {
        channel.lines.push(value)
      },
      show() {
        channel.shown += 1
      },
      dispose() {
        channel.disposed += 1
      },
    }
  }

  function makeVscode(opts?: { withOutputChannel?: boolean }) {
    return {
      window: {
        async showErrorMessage(message: string) {
          executed.push(`error:${message}`)
        },
        async showInformationMessage(message: string) {
          executed.push(`info:${message}`)
        },
        ...opts?.withOutputChannel === false ? {} : { createOutputChannel: fakeOutputChannel },
        createStatusBarItem: () => {
          statusBar = { text: '', shown: false, hidden: 0 }
          return {
            get text() { return statusBar!.text },
            set text(value: string) { statusBar!.text = value },
            get command() { return statusBar!.command },
            set command(value: string | { command: string } | undefined) { statusBar!.command = value },
            get tooltip() { return statusBar!.tooltip },
            set tooltip(value: string | undefined) { statusBar!.tooltip = value },
            show() { statusBar!.shown = true },
            hide() { statusBar!.shown = false; statusBar!.hidden += 1 },
            dispose() {},
          }
        },
        registerWebviewViewProvider(viewId: string, provider: unknown) {
          expect(viewId).toBe('dsh.chat')
          void provider
          return { dispose() {} }
        },
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-phase2' } }],
        getConfiguration() {
          return { get: (key: string) => (key === 'nodeBin' ? nodeBin : undefined) }
        },
      },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
        async executeCommand(command: string) {
          executed.push(`exec:${command}`)
        },
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
    }
  }

  function activateWith(vscode: ReturnType<typeof makeVscode>): void {
    activate({
      subscriptions: [],
      extensionPath: '/tmp/dsh-phase2',
      workspaceState: {
        get() { return undefined },
        update() {},
      },
    }, vscode)
  }

  function startSnapshot(): { state: string; errorKind?: string; errorMessage?: string } {
    return commands.get('dsh.test.getStartState')!() as { state: string; errorKind?: string }
  }

  function records(): readonly HostDiagnosticRecord[] {
    const value = commands.get('dsh.test.getDiagnosticsText')!()
    expect(Array.isArray(value)).toBe(true)
    return value as readonly HostDiagnosticRecord[]
  }

  function panelConnectionMessages(): readonly string[] {
    return (getChatPanelHost()?.getOutboundLog() ?? [])
      .filter(frame => frame.type === 'panel/state' && typeof frame.connectionMessage === 'string')
      .map(frame => (frame as { connectionMessage: string }).connectionMessage)
  }

  /** Absolute path that cannot be executed, so the Node pre-flight refuses it. */
  async function unusableNodeBin(label: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-phase2-'))
    dirs.push(dir)
    const path = join(dir, `${label}-not-a-node`)
    await writeFile(path, '#!/bin/sh\nexit 0\n')
    return path
  }

  it('AC-13(a): opens one output channel whose name is stable', () => {
    activateWith(makeVscode())
    expect(channels.map(channel => channel.name)).toEqual([HOST_DIAGNOSTICS_CHANNEL_NAME])
    expect(HOST_DIAGNOSTICS_CHANNEL_NAME).toBe('DeepSeek Harness')
  })

  it('AC-13(b)(c): the reveal command shows the channel and appends nothing', async () => {
    activateWith(makeVscode())
    expect(commands.has('dsh.showHostDiagnostics')).toBe(true)
    expect(channels[0].shown).toBe(0)

    const shown = await commands.get('dsh.showHostDiagnostics')!() as { ok: boolean }
    expect(shown.ok).toBe(true)
    expect(channels[0].shown).toBe(1)
    expect(channels[0].lines).toEqual([])

    // A surface with no Output Channel still answers the command rather than throwing.
    await deactivate()
    commands.clear()
    channels.length = 0
    activateWith(makeVscode({ withOutputChannel: false }))
    await expect(Promise.resolve(commands.get('dsh.showHostDiagnostics')!())).resolves.toEqual({ ok: true })
  })

  it('AC-13(d): the diagnostics hook exists inside the test gate and returns an array', () => {
    activateWith(makeVscode())
    expect(commands.has('dsh.test.getDiagnosticsText')).toBe(true)
    expect(records()).toEqual([])
  })

  it('AC-21(e): the approval hook is registered in the same gate and refuses without a Host', () => {
    activateWith(makeVscode())
    expect(commands.has('dsh.test.answerApproval')).toBe(true)
    const answer = commands.get('dsh.test.answerApproval')!
    // A driver must be able to tell "gate open, nothing to answer" from "command
    // absent": the refusal is a value, never a throw.
    expect(answer('call-1', 'allowed-once')).toEqual({ ok: false, reason: 'no-host' })
    expect(answer('', 'allowed-once')).toEqual({ ok: false, reason: 'invalid-id' })
    expect(answer(undefined, undefined)).toEqual({ ok: false, reason: 'invalid-id' })
  })

  it('AC-13(d): with the test gate closed the hook is never registered', async () => {
    // `activate` resolves `vscode` through `createRequire` when no module is
    // injected, which is the only path where the gate can be observed closed.
    const module = Module as unknown as { _load: (...args: unknown[]) => unknown }
    const original = module._load
    const fake = makeVscode()
    module._load = function (request: unknown, ...rest: unknown[]): unknown {
      if (request === 'vscode') return fake
      return original.call(this, request, ...rest)
    }
    const previousTestEnv = process.env.VSCODE_DSH_TEST
    delete process.env.VSCODE_DSH_TEST
    try {
      activate({
        subscriptions: [],
        extensionPath: '/tmp/dsh-phase2',
        workspaceState: { get() { return undefined }, update() {} },
      })
      expect(commands.has('dsh.showHostDiagnostics')).toBe(true)
      expect(commands.has('dsh.test.getDiagnosticsText')).toBe(false)
      expect([...commands.keys()].filter(command => command.startsWith('dsh.test.'))).toEqual([])
    } finally {
      module._load = original
      if (previousTestEnv === undefined) delete process.env.VSCODE_DSH_TEST
      else process.env.VSCODE_DSH_TEST = previousTestEnv
    }
  })

  it('AC-19: no credentials is a classified record plus a terminal UI state', async () => {
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(false)
    await commands.get('dsh.test.requestStart')!('command-start')

    const snapshot = startSnapshot()
    expect(snapshot.state).toBe('failed')
    expect(snapshot.errorKind).toBe('missing-credentials')

    const record = records().find(entry => entry.kind === 'missing-credentials')
    expect(record).toBeDefined()
    expect(record!.phase).toBe('start')
    expect(record!.retryOfSeq).toBeNull()
    expect(record!.detail).not.toBe('')

    const panel = getChatPanelHost()
    expect(panel?.getConnectionPhase()).toBe('failed')
    const messages = panelConnectionMessages()
    expect(messages.length).toBeGreaterThan(0)
    // The terminal state carries the root cause; the in-progress copy is not the last word.
    expect(messages[messages.length - 1]).toContain('missing credentials')
    expect(messages[messages.length - 1]).not.toBe('正在连接到 Host…')

    // The settings entry the failure points at, plus the clickable retry entry.
    expect(commands.has('dsh.openExtensionSettings')).toBe(true)
    await commands.get('dsh.openExtensionSettings')!()
    expect(executed).toContain('exec:workbench.action.openSettings')
    expect(statusBar?.command).toBe('dsh.statusBarAction')
    expect(statusBar?.shown).toBe(true)
  })

  it('AC-14 兜底: a pre-Host setting refusal is recorded once, as `other`', async () => {
    // A non-string `dsh.nodeBin` is refused by `readNodeBinSetting` before the Host
    // is entered, so no boundary exists that could name it. The store's
    // high-water mark is the only signal that separates "already recorded" from
    // "nobody recorded it", and here it did not move — which is exactly why this
    // failure stays visible instead of vanishing with the narrowed vocabulary.
    nodeBin = 42
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')

    expect(startSnapshot()).toMatchObject({ state: 'failed', errorKind: 'invalid-setting' })
    const recorded = records()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].kind).toBe('other')
    expect(recorded[0].detail).toContain('dsh.nodeBin')
  })

  it('AC-22: a retry after a pre-Host refusal adds a paired record', async () => {
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(false)
    await commands.get('dsh.test.requestStart')!('command-start')

    const opened = records()
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ kind: 'missing-credentials', phase: 'start', retryOfSeq: null })

    // The retry entry this failure state offers (AC-22c), taken on the very state
    // whose failure never reaches `started`: the record pair used to be suppressed
    // here for every retry, so this is the case the guard re-arm exists for.
    expect(statusBar?.command).toBe('dsh.statusBarAction')
    expect(statusBar?.shown).toBe(true)
    await commands.get('dsh.statusBarAction')!()

    const paired = records()
    expect(paired).toHaveLength(2)
    expect(paired[1]).toMatchObject({
      kind: 'missing-credentials',
      phase: 'retry',
      retryOfSeq: paired[0].seq,
    })
    expect(paired[1].seq).toBeGreaterThan(paired[0].seq)
    expect(startSnapshot()).toMatchObject({ state: 'failed', errorKind: 'missing-credentials' })
  })

  it('AC-14 兜底: a start failure records the resolved executable and hides no secret', async () => {
    const secret = 'super-secret-value-1234'
    const previousSecret = process.env.DSH_TEST_TOKEN
    secretRestores.push(() => {
      if (previousSecret === undefined) delete process.env.DSH_TEST_TOKEN
      else process.env.DSH_TEST_TOKEN = previousSecret
    })
    process.env.DSH_TEST_TOKEN = secret
    const dir = await mkdtemp(join(tmpdir(), 'dsh-phase2-'))
    dirs.push(dir)
    // The credential value sits inside the executable path, so a leak would be
    // visible in records, JSON, the channel, and the panel banner alike.
    nodeBin = join(dir, `${secret}-node`)

    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')

    const record = records().find(entry => entry.kind === 'node-environment')
    expect(record).toBeDefined()
    expect(record!.resolvedExecutable).not.toBeNull()
    expect(record!.resolvedExecutable).toContain('[redacted:DSH_TEST_TOKEN]')
    expect(record!.source).toBe('vscode-setting')
    expect(record!.detail).not.toBe('')

    // Four surfaces, no plaintext: the store, its JSON form, the sink, the UI.
    const serialized = JSON.stringify(records())
    expect(serialized).not.toContain(secret)
    expect(serialized).toContain('[redacted:DSH_TEST_TOKEN]')

    const appended = channels[0].lines.join('\n')
    expect(appended).not.toContain(secret)
    expect(appended).toContain('[redacted:DSH_TEST_TOKEN]')

    const messages = panelConnectionMessages()
    expect(messages.length).toBeGreaterThan(0)
    for (const message of messages) expect(message).not.toContain(secret)
    expect(messages.join('\n')).toContain('[redacted:DSH_TEST_TOKEN]')

    const snapshot = startSnapshot()
    expect(snapshot.state).toBe('failed')
    expect(snapshot.errorKind).toBe('node-environment')
    expect(snapshot.errorMessage).not.toContain(secret)
  })

  it('AC-22: a retry re-enters the same start path, pairs the record, and can recover', async () => {
    nodeBin = await unusableNodeBin('unusable')
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)

    await commands.get('dsh.test.requestStart')!('command-start')
    expect(startSnapshot()).toMatchObject({ state: 'failed', errorKind: 'node-environment' })
    expect(await commands.get('dsh.test.hostCreateCount')!()).toEqual({ count: 1 })

    // The failure state offers a clickable retry entry (AC-22c).
    expect(statusBar?.command).toBe('dsh.statusBarAction')
    expect(statusBar?.shown).toBe(true)

    await commands.get('dsh.statusBarAction')!()
    expect(startSnapshot()).toMatchObject({ state: 'failed', errorKind: 'node-environment' })
    expect(await commands.get('dsh.test.hostCreateCount')!()).toEqual({ count: 2 })

    // Retry before/after: one paired addition, traced back to the first record.
    const paired = records()
    expect(paired).toHaveLength(2)
    const [opening, retry] = paired
    expect(opening.phase).toBe('start')
    expect(opening.retryOfSeq).toBeNull()
    expect(retry.phase).toBe('retry')
    expect(retry.retryOfSeq).toBe(opening.seq)
    expect(retry.seq).toBeGreaterThan(opening.seq)
    // Both attempts re-entered the same launch path: same executable, same cause.
    expect(retry.resolvedExecutable).toBe(opening.resolvedExecutable)
    expect(retry.source).toBe(opening.source)
    expect(retry.detail).toBe(opening.detail)

    const snapshot = await commands.get('dsh.test.requestStart')!('manual-retry') as {
      state: string
      errorKind?: string
    }
    expect(snapshot.state).toBe('failed')
    expect(snapshot.errorKind).toBe('node-environment')
    expect(records()).toHaveLength(3)
  })

  it('a non-preflight failure carries no diagnostic payload', () => {
    const invalid = new HostStartError('invalid-setting', 'dsh.nodeBin held a value of the wrong type')
    expect(invalid.kind).toBe('invalid-setting')
    expect(invalid.diagnostic).toBeUndefined()
  })
})
