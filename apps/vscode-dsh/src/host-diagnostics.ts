/**
 * Host start-failure diagnostics: the failure vocabulary, the structured record
 * contract, and the bounded, redacted record store the Extension presents.
 * {@link IdeSessionHost} observes each failure boundary, classifies it, and
 * hands the fields here; nothing in this module reads a message to decide what
 * a failure was (AD-3).
 * @module @deepseek-ai/dsh-vscode-dsh/host-diagnostics
 */

import type { NodeExecutableSource } from '@deepseek-ai/dsh-sdk-client'
import type { StartErrorKind, StartOrchestratorSnapshot } from './auto-start-orchestrator.ts'
import { redactSecrets } from './redact.ts'

/**
 * Contract version stamped onto every record (AD-14). The single source of the
 * version: a change to the record field set increments this constant in the same
 * change, and a reader switches its assertions on the value it read back rather
 * than on assumptions about the producer.
 *
 * v2 added the `post-handshake` member of {@link HostDiagnosticPhase} (DEBT-010),
 * so a record can say that the runtime died after the handshake rather than while
 * a start step was running. The field set is unchanged at 18 fields: the new
 * boundary is expressed through the existing `phase` member, not through a
 * second record surface.
 *
 * v3 added the `dsh-entry` member of {@link HostFailureKind}: a start that finds
 * no dsh CLI entry point now reports the runtime resolution boundary instead of
 * landing in `other`. The field set is unchanged at 18 fields: the entry path
 * and the probed sources are carried by `detail`, and the remedy by `hint`.
 */
export const HOST_DIAGNOSTIC_SCHEMA_VERSION = 3

/** Stable name of the VS Code Output Channel carrying Host start diagnostics (AC-13). */
export const HOST_DIAGNOSTICS_CHANNEL_NAME = 'DeepSeek Harness'

/** Newest records the store keeps; the oldest record is dropped first. */
export const HOST_DIAGNOSTIC_RECORD_LIMIT = 200

/**
 * Which Host start boundary a record describes (AC-14 – AC-20): the dsh CLI
 * entry point not resolving before any spawn (`dsh-entry`), the Node
 * pre-flight refusing the spawn (`node-environment`), the ide-bridge socket
 * refusing to listen (`bridge-listen`), the runtime subprocess not launching
 * (`spawn`), `initialize` exceeding its bound (`handshake-timeout`), the runtime
 * process being reaped (`child-exited`, before the handshake or after it — the
 * record's `phase` says which), no
 * provider credentials for the Extension Host (`missing-credentials`), and a
 * failure no boundary claims (`other`).
 *
 * The vocabulary is one member per boundary the Host classifies plus the `other`
 * bucket; a failure with no boundary behind it has no member here. It is
 * deliberately **not** the same list as `StartErrorKind`: that type also carries
 * `invalid-setting`, which the `StartHostPort` layer raises while reading a Node
 * selection setting — before any Host boundary exists — so no record can cover
 * it, and its message is carried by the Extension's `other` fallback instead.
 */
export type HostFailureKind =
  | 'dsh-entry'
  | 'node-environment'
  | 'bridge-listen'
  | 'spawn'
  | 'handshake-timeout'
  | 'child-exited'
  | 'missing-credentials'
  | 'other'

/**
 * Which failure boundary a record belongs to (AC-22, DEBT-010).
 *
 * `start` and `retry` describe a failure raised while the start sequence itself
 * was running: the first attempt to fail, and each later attempt within the same
 * failure chain. `post-handshake` describes the third boundary: the runtime
 * connection was already established (`initialize` succeeded) and then died. A
 * record of that boundary is not part of a start chain, so it carries no
 * `retryOfSeq`, and a start retried after it pairs with it as the chain's opener.
 */
export type HostDiagnosticPhase = 'start' | 'retry' | 'post-handshake'

/**
 * One Host start failure, structured field by field (AD-14). Every field is
 * always present: a field that does not apply to this boundary is `null`, and a
 * list field is empty rather than absent. `schemaVersion` is the literal
 * {@link HOST_DIAGNOSTIC_SCHEMA_VERSION} and is never nullable.
 */
export interface HostDiagnosticRecord {
  /** Contract version of this record; see {@link HOST_DIAGNOSTIC_SCHEMA_VERSION}. */
  readonly schemaVersion: typeof HOST_DIAGNOSTIC_SCHEMA_VERSION
  /** Record serial, starting at 1 and strictly increasing over the store's life. */
  readonly seq: number
  /** Wall-clock time of the record in milliseconds; monotonically non-decreasing. */
  readonly time: number
  /** Whether this record is the start of a failure chain or a retry within one. */
  readonly phase: HostDiagnosticPhase
  /** `seq` of the record that opened this failure chain; `null` for the opener itself. */
  readonly retryOfSeq: number | null
  /** Which boundary failed. */
  readonly kind: HostFailureKind
  /**
   * Path of the Node executable the Host resolved and spawned, when known. It is
   * absolute only for the `process-exec-path` source: `DSH_NODE_BIN` and the
   * `dsh.nodeBin` setting are returned by `resolveNodeExecutableSpec` exactly as
   * the caller wrote them, so a relative value there stays relative here.
   */
  readonly resolvedExecutable: string | null
  /** Input that selected `resolvedExecutable`, when known. */
  readonly source: NodeExecutableSource | null
  /** Node version the pre-flight reported, when the executable ran and reported one. */
  readonly nodeVersion: string | null
  /** Node requirement the pre-flight checked against, when it ran. */
  readonly expectedRange: string | null
  /** Required Node APIs the executable did not provide; empty unless the pre-flight found some. */
  readonly missingApis: readonly string[]
  /** Absolute bridge socket path the Host listened on, when one was chosen. */
  readonly socketPath: string | null
  /** Exit code of the reaped runtime process, when it exited with one. */
  readonly exitCode: number | null
  /** Signal that terminated the runtime process, when it was signalled. */
  readonly terminationSignal: string | null
  /** Bound (ms) the handshake was given, when the failure is a handshake timeout. */
  readonly handshakeTimeoutMs: number | null
  /** Retained stderr of the runtime process, oldest line first, verbatim. */
  readonly stderrTail: readonly string[]
  /** Why the boundary failed, redacted; never empty. */
  readonly detail: string
  /** What to change so the next start can succeed, redacted; never empty. */
  readonly hint: string
}

/** Fields the Host supplies for one failure boundary; the store fills the rest. */
export interface HostDiagnosticInput {
  /** Which boundary failed. */
  kind: HostFailureKind
  /**
   * Set to `post-handshake` when the boundary is the runtime connection dying
   * after `initialize` succeeded. Omitted means a start-step failure, which the
   * store places in the chain as its opener or as the next retry link (AC-22).
   */
  phase?: 'post-handshake'
  /** Why it failed, redacted by the store; omitted means the kind's own sentence. */
  detail?: string
  /** What to change, redacted by the store; omitted means the kind's own remedy. */
  hint?: string
  /**
   * Path of the Node executable the Host resolved; absolute only for the
   * `process-exec-path` source (the `DSH_NODE_BIN` and `dsh.nodeBin` inputs are
   * taken verbatim).
   */
  resolvedExecutable?: string
  /** Input that selected `resolvedExecutable`. */
  source?: NodeExecutableSource
  /** Node version the pre-flight reported. */
  nodeVersion?: string
  /** Node requirement the pre-flight checked against. */
  expectedRange?: string
  /** Required Node APIs the pre-flight found missing. */
  missingApis?: readonly string[]
  /** Bridge socket path the Host listened on. */
  socketPath?: string
  /** Exit code of the reaped runtime process; `0` is a value, not an absence. */
  exitCode?: number
  /** Signal that terminated the runtime process. */
  terminationSignal?: string
  /** Bound (ms) the handshake was given. */
  handshakeTimeoutMs?: number
  /** Retained stderr lines of the runtime process, oldest first. */
  stderrTail?: readonly string[]
}

/** Presenter of already-redacted records (the Extension renders the Output Channel). */
export interface HostDiagnosticSink {
  /**
   * Present one record; called once per stored record, in store order.
   * @param record - the stored, redacted record.
   */
  present(record: HostDiagnosticRecord): void
}

/**
 * Port {@link IdeSessionHost} records through (AD-3): the Host owns observation
 * and classification, this port owns retention, redaction, and presentation.
 */
export interface HostFailureRecorder {
  /**
   * Bind the credential bag of the current start so its values are scrubbed from
   * every record field (AC-21). The bag itself is never recorded.
   * @param credentials - credentials merged into the child env, or `undefined` to clear.
   */
  setCredentials(credentials: NodeJS.ProcessEnv | undefined): void
  /**
   * Record one failure boundary.
   * @param input - the fields this boundary contributes.
   * @returns the stored record.
   */
  record(input: HostDiagnosticInput): HostDiagnosticRecord
  /**
   * `seq` of the newest record, when the store can report one. It is the
   * high-water mark a caller reads before and after an attempt to tell "a
   * boundary already recorded this failure" apart from "none did" (AC-22,
   * DEBT-010). Optional: a recorder that retains nothing has no mark to report.
   * @returns the newest `seq`, or `null` while nothing has been recorded.
   */
  lastSeq?(): number | null
}

/** Constructor options of {@link HostDiagnosticRecorder}. */
export interface HostDiagnosticRecorderOptions {
  /** Presentation target; records are retained whether or not a sink is bound. */
  sink?: HostDiagnosticSink
  /** Credential bag merged into redaction until {@link HostDiagnosticRecorder.setCredentials} replaces it. */
  credentials?: NodeJS.ProcessEnv
  /** Time source in milliseconds (tests pin it); defaults to `Date.now`. */
  now?: () => number
}

/**
 * Per-kind sentence used when a boundary reports no `detail` of its own, so a
 * record always carries a non-empty reason.
 */
const FAILURE_DETAILS: Readonly<Record<HostFailureKind, string>> = {
  'dsh-entry': 'No source provided a dsh CLI entry point for this window.',
  'node-environment': 'The Node.js executable the Host resolved failed the pre-flight.',
  'bridge-listen': 'The Host could not listen on its ide-bridge socket.',
  spawn: 'The dsh runtime subprocess could not be launched.',
  'handshake-timeout': 'The dsh runtime did not answer initialize within its bound.',
  'child-exited': 'The dsh runtime process was reaped: before the handshake completed, or after it while the Host held the connection live.',
  'missing-credentials': 'No provider credentials were found for the Extension Host.',
  other: 'The Host start failed without a boundary that classified it.',
}

/** Per-kind remedy used when a boundary reports no `hint` of its own. */
const FAILURE_HINTS: Readonly<Record<HostFailureKind, string>> = {
  'dsh-entry': 'Install @deepseek-ai/dsh in the workspace, or set DSH_BIN or the dsh.cliPath setting to its dsh bin.',
  'node-environment': 'Point dsh.nodeBin or DSH_NODE_BIN at a Node.js ^22.19.0 || >=24.0.0 executable.',
  'bridge-listen': 'Remove a stale bridge socket at that path and retry the connection.',
  spawn: 'Check the Node.js executable path and the dsh CLI installation, then retry.',
  'handshake-timeout': 'Raise initializeTimeoutMs or inspect the runtime log for a slow start.',
  'child-exited': 'Read the stderr tail above: it carries the runtime note on why it stopped.',
  'missing-credentials': 'Set DEEPSEEK_API_KEY for the environment that launches VS Code, then retry.',
  other: 'Open the DeepSeek Harness output channel and report the record above.',
}

/**
 * Orchestrator-facing class for a boundary the Host classified (AD-4): every
 * {@link HostFailureKind} has an explicit member so the class survives the hop
 * into `StartOrchestratorSnapshot` instead of being flattened, and the map is
 * total so a new kind cannot be added without deciding its orchestrator class.
 */
const START_ERROR_KIND_BY_FAILURE: Readonly<Record<HostFailureKind, StartErrorKind>> = {
  'dsh-entry': 'dsh-entry',
  'node-environment': 'node-environment',
  'bridge-listen': 'bridge-listen',
  spawn: 'spawn',
  'handshake-timeout': 'handshake-timeout',
  'child-exited': 'process-failed',
  'missing-credentials': 'missing-credentials',
  'other': 'process-failed',
}

/**
 * Map a Host failure kind onto the class the orchestrator projects (AD-4).
 * @param kind - the boundary the Host classified.
 * @returns the orchestrator-facing class of that boundary.
 */
export function startErrorKindForFailure(kind: HostFailureKind): StartErrorKind {
  return START_ERROR_KIND_BY_FAILURE[kind]
}

/**
 * Kind the Extension records for a start failure that never reached the
 * `IdeSessionHost` boundary (AD-3): the orchestrator's own `missing-credentials`
 * pre-flight. Every other member names a Host boundary, and the Host writes its
 * own record for those, so recording them here as well would count one attempt
 * twice (AC-22).
 *
 * `invalid-setting` is spelled out explicitly rather than left to a fall-through
 * or a `default`: it is raised by the `StartHostPort` layer while reading a Node
 * selection setting, so it is thrown before any Host boundary exists and
 * {@link HostFailureKind} has no member for it. `null` here is what keeps the
 * failure from being recorded twice — the Extension's own `other` fallback in
 * `createStartHostPort` carries its message instead.
 * @param kind - class read off the thrown start failure, when it reported one.
 * @returns the kind to record, or `null` when some other point already owns that
 *   failure's record (a Host boundary, or the Extension's `other` fallback).
 */
export function hostFailureKindForStartError(kind: StartErrorKind | undefined): HostFailureKind | null {
  switch (kind) {
    case 'missing-credentials':
      return 'missing-credentials'
    case 'invalid-setting':
      return null
    case 'dsh-entry':
    case 'node-environment':
    case 'bridge-listen':
    case 'spawn':
    case 'handshake-timeout':
    case 'process-failed':
    case undefined:
      return null
  }
}

/**
 * Bind a recorder to an orchestrator snapshot stream (AC-19). The orchestrator
 * refuses a start before the Host is reached — no credentials — so those
 * failures have no Host boundary to speak for them and are recorded here from
 * the class the failure carries.
 *
 * The guard is armed per attempt, not per chain. Within one attempt the snapshot
 * can move to `failed` more than once (the reason records the failure, the
 * disconnect edge repeats it), so the same class repeating the same message is
 * recorded once; any transition leaving `failed` re-arms the guard, because
 * every attempt passes through `starting` before it can fail. A retry is
 * therefore recorded as the next link of the chain even when the failure never
 * reached `started` — the pre-Host refusals — which is exactly the state whose
 * retry entry AC-22(c) requires to produce a paired record.
 *
 * `process-failed` is the one class the Host owns that can also arrive with no
 * record behind it: the orchestrator synthesises that state itself when a start
 * resolves without leaving a live connection (`auto-start-orchestrator.ts`, the
 * `isConnected()` else-branch), and nothing else speaks for it (DEBT-010). The
 * store's high-water mark tells the two apart without reading the message: a
 * Host boundary that spoke for the failure moved it, and a failure nobody
 * recorded left it where the attempt began. The unrecorded case is written here
 * in the bucket for a failure no boundary claims, so the attempt is never
 * invisible; the recorded case is left alone, because recording it again would
 * count one attempt twice.
 * @param recorder - sink for orchestrator-side start failures.
 * @returns listener for the orchestrator's snapshot stream.
 */
export function createStartFailureListener(
  recorder: HostFailureRecorder,
): (snapshot: StartOrchestratorSnapshot) => void {
  /** The store's mark, when the recorder retains records at all. */
  const mark = (): number | null => recorder.lastSeq?.() ?? null
  let attemptMark = mark()
  let recorded: string | undefined
  return (snapshot: StartOrchestratorSnapshot): void => {
    if (snapshot.state !== 'failed') {
      recorded = undefined
      attemptMark = mark()
      return
    }
    const kind = hostFailureKindForStartError(snapshot.errorKind)
    const detail = snapshot.errorMessage ?? ''
    const signature = `${kind ?? `unowned:${String(snapshot.errorKind)}`}\u0000${detail}`
    if (signature === recorded) return
    if (kind !== null) {
      recorded = signature
      recorder.record(detail === '' ? { kind } : { kind, detail })
      return
    }
    if (snapshot.errorKind !== 'process-failed') return
    // A Host boundary that recorded this failure moved the mark during the
    // attempt; a mark that never moved means no boundary spoke for it at all.
    if (mark() !== attemptMark) return
    recorded = signature
    recorder.record(detail === '' ? { kind: 'other' } : { kind: 'other', detail })
  }
}

/**
 * Bounded, redacted store of Host start failures (AC-13 – AC-22). Every string
 * field is scrubbed through {@link redactSecrets} on the way in, so neither the
 * records nor anything rendered from them can carry a credential value (AC-21):
 * a path is scrubbed like any other text, because a credential value embedded in
 * a path is still a leaked credential.
 */
export class HostDiagnosticRecorder implements HostFailureRecorder {
  private readonly store: HostDiagnosticRecord[] = []
  private sink: HostDiagnosticSink | undefined
  private readonly clock: () => number
  private credentials: NodeJS.ProcessEnv | undefined
  private serial = 0
  private lastTime = 0
  /** `seq` of the record that opened the current failure chain; `null` between chains. */
  private chainStartSeq: number | null = null

  /** @param options - sink, initial credentials, and time source. */
  constructor(options: HostDiagnosticRecorderOptions = {}) {
    this.sink = options.sink
    this.clock = options.now ?? (() => Date.now())
    this.credentials = options.credentials
  }

  /**
   * Replace the credential bag merged into redaction (AC-21).
   * @param credentials - session credentials, or `undefined` to scan only the environment.
   */
  setCredentials(credentials: NodeJS.ProcessEnv | undefined): void {
    this.credentials = credentials
  }

  /**
   * Bind or clear the presentation target.
   * @param sink - sink to receive later records, or `undefined` to detach.
   */
  setSink(sink: HostDiagnosticSink | undefined): void {
    this.sink = sink
  }

  /**
   * Close the current failure chain: the next record opens a new one (AC-22).
   * Called when a start attempt reaches `connected`.
   */
  onStartSucceeded(): void {
    this.chainStartSeq = null
  }

  /**
   * Record one failure boundary.
   * @param input - the fields this boundary contributes.
   * @returns the stored record.
   */
  record(input: HostDiagnosticInput): HostDiagnosticRecord {
    const kind = input.kind
    const afterHandshake = input.phase === 'post-handshake'
    const record: HostDiagnosticRecord = {
      schemaVersion: HOST_DIAGNOSTIC_SCHEMA_VERSION,
      seq: ++this.serial,
      time: this.nextTime(),
      phase: afterHandshake ? 'post-handshake' : this.chainStartSeq === null ? 'start' : 'retry',
      // A death after the handshake is not a retry of a failed start, so it opens
      // its own chain instead of extending one (DEBT-010).
      retryOfSeq: afterHandshake ? null : this.chainStartSeq,
      kind,
      resolvedExecutable: this.text(input.resolvedExecutable),
      source: input.source ?? null,
      nodeVersion: this.text(input.nodeVersion),
      expectedRange: this.text(input.expectedRange),
      missingApis: [...(input.missingApis ?? [])],
      socketPath: this.text(input.socketPath),
      exitCode: input.exitCode ?? null,
      terminationSignal: this.text(input.terminationSignal),
      handshakeTimeoutMs: input.handshakeTimeoutMs ?? null,
      stderrTail: (input.stderrTail ?? []).map(line => this.redact(line)),
      detail: this.redact(this.fallback(input.detail, FAILURE_DETAILS[kind])),
      hint: this.redact(this.fallback(input.hint, FAILURE_HINTS[kind])),
    }
    // A post-handshake death opens the chain it may be retried from, so the retry
    // that follows keeps a `retryOfSeq` pointing at the boundary that ended it.
    this.chainStartSeq ??= record.seq
    this.store.push(record)
    if (this.store.length > HOST_DIAGNOSTIC_RECORD_LIMIT) {
      this.store.splice(0, this.store.length - HOST_DIAGNOSTIC_RECORD_LIMIT)
    }
    this.sink?.present(record)
    return record
  }

  /**
   * Retained records, oldest first.
   * @returns a copy of the store; mutating it cannot reach the store.
   */
  records(): readonly HostDiagnosticRecord[] {
    return [...this.store]
  }

  /**
   * `seq` of the newest stored record.
   * @returns that `seq`, or `null` while nothing has been recorded.
   */
  lastSeq(): number | null {
    return this.store[this.store.length - 1]?.seq ?? null
  }

  /** Prefer reported text over the kind's own sentence; never yield an empty string. */
  private fallback(reported: string | undefined, own: string): string {
    if (reported === undefined || reported === '') return own
    return reported
  }

  /** Scrub one string field, mapping an absent or empty value onto the contract's `null`. */
  private text(value: string | undefined): string | null {
    if (value === undefined || value === '') return null
    return this.redact(value)
  }

  /** Scrub free-form text against the environment and the session's credential bag (AC-21). */
  private redact(text: string): string {
    return redactSecrets(text, this.credentials)
  }

  /** Monotonically non-decreasing time, so records keep their store order by timestamp. */
  private nextTime(): number {
    const now = this.clock()
    if (now > this.lastTime) this.lastTime = now
    return this.lastTime
  }
}

/**
 * Render one record as the Output Channel's block (AC-13). Every element the
 * record carries appears in it, verbatim and unsummarised, so the rendered form
 * cannot hide what the structured form recorded (AC-17); the renderer adds
 * labels only, and its input is already redacted (AC-21).
 * @param record - the stored record to render.
 * @returns the record as a multi-line block, one element per line.
 */
export function formatHostDiagnosticRecord(record: HostDiagnosticRecord): string {
  const lines = [
    `[dsh] Host start failure #${String(record.seq)} (${record.phase}) — ${record.kind}`,
    `  time: ${new Date(record.time).toISOString()}`,
  ]
  if (record.retryOfSeq !== null) lines.push(`  retry of: #${String(record.retryOfSeq)}`)
  if (record.resolvedExecutable !== null) {
    lines.push(`  node executable: ${record.resolvedExecutable}${sourceLabel(record.source)}`)
  }
  if (record.nodeVersion !== null) lines.push(`  node version: ${record.nodeVersion}`)
  if (record.expectedRange !== null) lines.push(`  expected: ${record.expectedRange}`)
  if (record.missingApis.length > 0) lines.push(`  missing apis: ${record.missingApis.join(', ')}`)
  if (record.socketPath !== null) lines.push(`  bridge socket: ${record.socketPath}`)
  if (record.exitCode !== null) lines.push(`  exit code: ${String(record.exitCode)}`)
  if (record.terminationSignal !== null) lines.push(`  termination signal: ${record.terminationSignal}`)
  if (record.handshakeTimeoutMs !== null) {
    lines.push(`  handshake timeout: ${String(record.handshakeTimeoutMs)}ms`)
  }
  if (record.stderrTail.length > 0) {
    lines.push(`  stderr tail (${String(record.stderrTail.length)} lines):`)
    for (const line of record.stderrTail) lines.push(`    ${line}`)
  }
  lines.push(`  detail: ${record.detail}`, `  hint: ${record.hint}`)
  return lines.join('\n')
}

/** Executable-source suffix, so a rendered path names what selected it. */
function sourceLabel(source: NodeExecutableSource | null): string {
  if (source === null) return ''
  return ` (source: ${source})`
}
