/**
 * Host-bridge wire frames and connection state for the ide profile.
 * @module @deepseek-ai/dsh-ide-bridge/types
 */

import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'

/** Environment variable naming the Host bridge socket or named pipe. */
export const IDE_BRIDGE_SOCK_ENV = 'DSH_IDE_BRIDGE_SOCK'

/** Cordis service key publishing live bridge connection state. */
export const IDE_BRIDGE_SERVICE = 'ideBridge'

/**
 * Cordis service key for server-owned per-session dispose.
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionDispose`.
 */
export const SDK_SESSION_DISPOSE_SERVICE = 'sdkSessionDispose'

/**
 * Cordis service key for server-owned per-session resume (Continue same-id).
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionResume`.
 */
export const SDK_SESSION_RESUME_SERVICE = 'sdkSessionResume'

/**
 * Cordis service key for server-owned per-session cancel (Stop / I-真).
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionCancel`.
 */
export const SDK_SESSION_CANCEL_SERVICE = 'sdkSessionCancel'

/**
 * Cordis service key for server-owned per-session fork (retry / edit / branch).
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionFork`.
 */
export const SDK_SESSION_FORK_SERVICE = 'sdkSessionFork'

/**
 * Cordis service key for server-owned per-session delete.
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionDelete`.
 */
export const SDK_SESSION_DELETE_SERVICE = 'sdkSessionDelete'

/** Cordis service key for permission presets (consumed via `ctx.get`). */
export const PERMISSION_PRESETS_SERVICE = 'permissionPresets'

/** Cordis service key for the session store (consumed via `ctx.get`). */
export const SESSIONS_SERVICE = 'sessions'

/**
 * Cordis service key for the session corpus listing (`ctx.sessionQuery`).
 * Used by Host `session/list` to enumerate sessions without resuming an Agent.
 */
export const SESSION_QUERY_SERVICE = 'sessionQuery'

/**
 * Cordis service key for the listing projection cache (`ctx.sessionProjectionCache`).
 * Used by Host `session/list` for titles, so listing never replays a log per row.
 */
export const SESSION_PROJECTION_CACHE_SERVICE = 'sessionProjectionCache'

/**
 * Cordis service key for durable session persistence (`ctx.sessionPersistence`).
 * Used by Host `session/read-log` cold reads (T-0a / AD-CU-2).
 */
export const SESSION_PERSISTENCE_SERVICE = 'sessionPersistence'

/**
 * Cordis service key for server-owned per-session materialization.
 * Published by `@deepseek-ai/dsh-sdk-jsonrpc-server` as `sdkSessionEnsure`, and
 * called before a command runs against a Tab that never prompted.
 */
export const SDK_SESSION_ENSURE_SERVICE = 'sdkSessionEnsure'

/**
 * Cordis service key for the live-agent registry (`ctx.agents`).
 * The command and skill frames address one agent through its session id.
 */
export const AGENTS_SERVICE = 'agents'

/**
 * Cordis service key for the human-command registry (`ctx.commands`).
 * Backs Host `commands/list` and `commands/execute`.
 */
export const COMMANDS_SERVICE = 'commands'

/**
 * Cordis service key for the agent-preset roster (`ctx.agentPresets`).
 * Backs Host `agent-presets/list`.
 */
export const AGENT_PRESETS_SERVICE = 'agentPresets'

/**
 * Cordis service key for the skill registry (`ctx.skills`).
 * Backs Host `skills/list`.
 */
export const SKILLS_SERVICE = 'skills'

/** Duck-typed persistence open/read surface for cold log reads. */
export interface SessionPersistenceReadCapability {
  /**
   * Open a stored session handle.
   * @param sessionId - stored session identity.
   * @param mode - must be `'read'` for cold hydrate.
   */
  open(
    sessionId: string,
    mode: 'read',
  ): Promise<{
    read(from: number): Promise<readonly unknown[]>
    close(): Promise<void>
  }>
}

/** Stored session header fields a `session/list` row reports. */
export interface BridgeSessionHeader {
  /** Session identity. */
  readonly id: string
  /** Log creation time in epoch milliseconds; part of the projection-cache identity. */
  readonly createdAt: number
  /** Recorded working directory, absent when the session was created without one. */
  readonly cwd?: string
  /** Whether the log is a fork seed; a seeded log has no listing-readable cache row. */
  readonly isSeeded: boolean
  /** Parent session identity for a fork or a delegated child. */
  readonly parentSession?: string
}

/** One session row of a `session/list/response`. */
export interface BridgeSessionSummary {
  /** Session identity. */
  sessionId: string
  /** Log creation time in epoch milliseconds. */
  createdAt: number
  /** Recorded working directory, absent when the session was created without one. */
  cwd?: string
  /** Parent session identity for a fork or a delegated child. */
  parentSessionId?: string
  /** Projection-cached title; absent when this lifecycle has no cached title row. */
  title?: string
}

/** Duck-typed session corpus enumeration for `session/list`. */
export interface SessionQueryListCapability {
  /**
   * Read every logical session without resuming an Agent.
   * @param signal - optional cancellation for persistence reads.
   * @returns one record per session, in no promised order.
   */
  listSessions(signal?: AbortSignal): Promise<readonly { header: BridgeSessionHeader }[]>
}

/** Duck-typed listing read of the projection cache for `session/list` titles. */
export interface SessionProjectionCacheListCapability {
  /**
   * View stored projection values without reading any log.
   * @param header - the listed session's header, which witnesses the record's identity.
   * @param inheritedEventCount - exact inherited prefix length; `0` for an unseeded log.
   * @param keys - projection keys the caller needs.
   * @returns the served values, or `undefined` when no usable row matches this lifecycle.
   */
  cachedSnapshot(
    header: BridgeSessionHeader,
    inheritedEventCount: number,
    keys?: readonly string[],
  ): { values: Record<string, unknown> } | undefined
}

/** Live connection state exposed to the runtime and tests. */
export interface IdeBridgeConnectionState {
  /** Whether the runtime currently holds an open Host socket. */
  connected: boolean
  /** Resolved socket path from the environment, or `null` when unset. */
  sockPath: string | null
  /** Last connection failure message when disconnected after an attempt. */
  error?: string
}

/**
 * Server-owned session dispose capability consumed by ide-bridge.
 * Must clear the SDK session Map before `AgentHandle.dispose()`.
 */
export interface SdkSessionDisposeCapability {
  /**
   * Dispose one session when present; no-op when unknown.
   * @param sessionId - SDK session identity.
   */
  disposeSession(sessionId: string): Promise<void>
}

/**
 * Server-owned session resume capability for Continue (GAP-001 / AD-CU-8).
 * Must register the resumed AgentHandle in the SDK session Map so later
 * `session/prompt` reuses the live agent instead of `agents.create`.
 */
export interface SdkSessionResumeCapability {
  /**
   * Resume one persisted session into the live SDK Map.
   * No-op (success) when already live. Uses `agents.resume`, never stdout create.
   * @param sessionId - SDK session identity.
   */
  resumeSession(sessionId: string): Promise<void>
}

/**
 * Server-owned session cancel capability for Stop (AD-CUX-3 / I-真).
 * Must call `Agent.cancel({ kind:'user' }, { keepInbox: true })` without dispose.
 */
export interface SdkSessionCancelCapability {
  /**
   * Cancel the active turn when present; no-op when unknown.
   * @param sessionId - SDK session identity.
   */
  cancelSession(sessionId: string): Promise<void>
}

/**
 * Server-owned session fork capability for retry / edit-resend / branch (AD-CUX-5).
 * Must create a prompt-ready child with `parentSession` lineage.
 */
export interface SdkSessionForkCapability {
  /**
   * Fork a live parent session at an inclusive boundary seq (or empty seed).
   * @param parentSessionId - parent SDK session identity.
   * @param options - boundary seq, emptySeed, and optional child id.
   * @returns child session id.
   */
  forkSession(
    parentSessionId: string,
    options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
  ): Promise<string>
}

/**
 * Server-owned session delete capability consumed by ide-bridge.
 * Must dispose the session from memory AND delete its persistent storage.
 */
export interface SdkSessionDeleteCapability {
  /**
   * Delete one session's persistent data and memory handle.
   * @param sessionId - SDK session identity.
   */
  deleteSession(sessionId: string): Promise<void>
}

/** Minimal session handle needed to apply a permission preset. */
export interface IdeBridgeSessionHandle {
  /** Session identity matching the Host Tab `sessionId`. */
  readonly id: string
}

/**
 * Permission-presets write surface used by Host `permission/select`.
 * Duck-typed against `PermissionPresetService` so ide-bridge stays free of a
 * hard dependency on that package.
 */
export interface IdeBridgePermissionPresets {
  /** Advertised switchable preset names. */
  readonly names: readonly string[]
  /**
   * Apply one preset through the sole permission authority.
   * @param session - live session object.
   * @param name - preset table key.
   */
  set(session: IdeBridgeSessionHandle, name: string): void
  /**
   * Resolve the effective preset for a session.
   * @param session - live session object.
   */
  current(session: IdeBridgeSessionHandle): string
}

/**
 * One settings namespace as the runtime projects it onto the wire.
 * Redaction belongs to the runtime: `value`, `base`, and `user` carry every
 * `role('secret')` field removed, and `secretFields` names those positions.
 */
export interface SettingsNamespaceView {
  /** Registered namespace key (`llm-deepseek`, `llm-pi-ai`, …). */
  ns: string
  /** Redacted resolved value: schema defaults, then composition base, then user layer. */
  value: unknown
  /** Redacted composition `base` layer, when the registrant declared one. */
  base?: unknown
  /** Redacted raw user section; a key's presence here marks it user-overridden. */
  user?: unknown
  /** Monotonic revision of the raw user section, sent back as `expectedRevision`. */
  revision: number
  /**
   * Dotted paths of the schema-declared secret positions removed from the three
   * layers above; present when the namespace declares any.
   */
  secretFields?: string[]
}

/** Session store lookup used by permission RPC. */
export interface IdeBridgeSessions {
  /**
   * Look up a live session by id.
   * @param id - session identity (SDK / Tab sessionId).
   */
  get(id: string): IdeBridgeSessionHandle | undefined
}

/** Duck-typed live-agent registry (`ctx.agents`) behind the command and skill frames. */
export interface IdeBridgeAgents {
  /**
   * Look up a live agent by session id.
   * @param id - session identity from the Host Tab binding.
   * @returns the live agent, or `undefined` when that session is not materialized.
   */
  get(id: string): IdeBridgeLiveAgent | undefined
}

/**
 * Minimal live-agent surface the command and skill frames read. An agent is both
 * the command-scope key and the viewing scope a skill listing merges layers for.
 */
export interface IdeBridgeLiveAgent {
  /** The agent's session, read for the cwd that scopes a skill listing. */
  readonly session: { readonly header: { readonly cwd?: string } }
}

/** Duck-typed human-command registry (`ctx.commands`). */
export interface IdeBridgeCommands {
  /**
   * List the effective command descriptors for one agent.
   * @param agent - the live agent whose scoped layer shadows globals.
   * @returns name-sorted descriptors after scoped shadowing.
   */
  list(agent: object): readonly IdeBridgeCommandDescriptor[]
  /**
   * Parse and execute one complete slash line without sending it to the model.
   * @param agent - the receiving live agent.
   * @param line - complete slash-command line.
   * @param images - composer images; this bridge is a text surface and always
   *   passes none, so a command that declares `input.images` still runs, without
   *   attachments.
   * @param signal - caller lifetime.
   * @returns the settled execution, or `undefined` when the line resolves no command.
   */
  execute(
    agent: object,
    line: string,
    images: readonly unknown[],
    signal: AbortSignal,
  ): Promise<IdeBridgeCommandExecution | undefined>
}

/** One command row the registry advertises. */
export interface IdeBridgeCommandDescriptor {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary from the command's own registration. */
  readonly description: string
  /** Optional free-form input contract the command declared. */
  readonly input?: {
    /** Placeholder shown before the user supplies free-form input. */
    readonly hint: string
    /** Whether composer images may accompany an invocation. */
    readonly images?: boolean
  }
}

/** One settled command execution the registry returns. */
export interface IdeBridgeCommandExecution {
  /** Pairing id carried by this execution's `command/run` and `command/done` records. */
  readonly commandId: string
  /** The handler's normalized outcome. */
  readonly result: {
    /** Whether the handler reported success. */
    readonly kind: 'success' | 'error'
    /** Result text the dispatching surface renders; absent when the handler printed none. */
    readonly text?: string
  }
}

/** Duck-typed agent-preset roster (`ctx.agentPresets`). */
export interface IdeBridgeAgentPresets {
  /** Id of this deployment's default preset. */
  readonly defaultId: string
  /**
   * Every preset the configured roots currently supply.
   * @returns the presets, first-root-wins per id.
   */
  list(): Promise<readonly IdeBridgeAgentPresetListing[]>
}

/** One preset row a roster read returns; the bridge projects it onto the wire. */
export interface IdeBridgeAgentPresetListing {
  /** Preset id, e.g. `specdev-orchestrator`. */
  readonly id: string
  /** Display name when the composition declares one. */
  readonly name?: string | undefined
  /** One-line purpose when the composition declares one. */
  readonly description?: string | undefined
  /** Why the preset cannot be mounted; absent for a usable preset. */
  readonly broken?: string | undefined
}

/** Duck-typed skill registry read surface (`ctx.skills`). */
export interface IdeBridgeSkills {
  /**
   * List the skills visible to one viewing scope.
   * @param options - workspace selector and the viewing scope (the live agent).
   * @returns every skill of the merged layers, before invocation filtering.
   */
  list(options: {
    readonly cwd?: string | undefined
    readonly scope?: object | undefined
  }): Promise<readonly IdeBridgeSkillListing[]>
}

/** One skill row a listing returns; the bridge projects it onto the wire. */
export interface IdeBridgeSkillListing {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string | undefined
  /** Invocation controls; the bridge keeps only user-invocable skills. */
  readonly invocation: { readonly userInvocable: boolean }
}

/** Server-owned per-session materialization (`sdkSessionEnsure`). */
export interface SdkSessionEnsureCapability {
  /**
   * Ensure one session has a live agent; no-op when it is already live.
   * @param sessionId - SDK session identity from the Host Tab binding.
   */
  ensureSession(sessionId: string): Promise<void>
}

/** One command row of a `commands/list/response`. */
export interface BridgeCommandSummary {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary shown beside the name. */
  readonly description: string
  /** Free-form input placeholder; absent when the command declares no input. */
  readonly inputHint?: string
}

/** One settled command outcome of a `commands/execute/response`. */
export interface BridgeCommandOutcome {
  /** Pairing id correlating this execution with its logged run/done records. */
  readonly commandId: string
  /** Whether the handler reported success. */
  readonly ok: boolean
  /** Result text to render; absent when the handler printed none. */
  readonly text?: string
}

/** One agent-preset row of an `agent-presets/list/response`. */
export interface BridgeAgentPresetSummary {
  /** Preset id, e.g. `specdev-orchestrator`. */
  readonly id: string
  /** Display name when the composition declares one. */
  readonly name?: string
  /** One-line purpose when the composition declares one. */
  readonly description?: string
  /** Whether this is the deployment's default preset. */
  readonly isDefault: boolean
  /** Why the preset cannot be mounted; absent for a usable preset. */
  readonly broken?: string
}

/** One skill row of a `skills/list/response`. */
export interface BridgeSkillSummary {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description shown beside the name. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
}

/**
 * NDJSON frames exchanged on the Host bridge (not SDK stdout).
 * Approval / user-questions round-trips and permission-preset RPC share this
 * channel; illegal inbound frames must be rejected (AC-31).
 */
export type BridgeFrame =
  | { kind: 'hello'; role: 'runtime' | 'host' }
  | {
    kind: 'approval/request'
    id: string
    sessionId: string
    toolName: string
    reason?: string
  }
  | { kind: 'approval/response'; id: string; outcome: ApprovalOutcome }
  | {
    kind: 'user-questions/request'
    id: string
    sessionId: string
    questions: AskUserQuestionItem[]
  }
  | {
    kind: 'user-questions/response'
    id: string
    answer?: AskUserQuestionAnswer
    error?: string
  }
  | { kind: 'session/dispose'; id: string; sessionId: string }
  | { kind: 'session/dispose/response'; id: string; ok: true }
  | { kind: 'session/dispose/response'; id: string; ok: false; error: string }
  | { kind: 'session/read-log'; id: string; sessionId: string }
  | {
    kind: 'session/read-log/response'
    id: string
    ok: true
    /** Cold-balanced authoritative events (JSON-serializable SessionEvent[]). */
    events: unknown[]
  }
  | { kind: 'session/read-log/response'; id: string; ok: false; error: string }
  | { kind: 'session/resume'; id: string; sessionId: string }
  | { kind: 'session/resume/response'; id: string; ok: true }
  | { kind: 'session/resume/response'; id: string; ok: false; error: string }
  | { kind: 'session/cancel'; id: string; sessionId: string }
  | { kind: 'session/cancel/response'; id: string; ok: true }
  | { kind: 'session/cancel/response'; id: string; ok: false; error: string }
  | {
    kind: 'session/fork'
    id: string
    parentSessionId: string
    /** Inclusive source event seq; omit without emptySeed = tip (last event). */
    boundarySeq?: number
    /** Explicit empty seed; mutually exclusive with boundarySeq. */
    emptySeed?: boolean
    childSessionId?: string
  }
  | { kind: 'session/fork/response'; id: string; ok: true; childSessionId: string }
  | { kind: 'session/fork/response'; id: string; ok: false; error: string }
  | { kind: 'session/continue-capability'; id: string; sessionId: string }
  | {
    kind: 'session/continue-capability/response'
    id: string
    ok: true
    capability: 'same-id' | 'derive-only' | 'unknown'
  }
  | {
    kind: 'session/continue-capability/response'
    id: string
    ok: false
    error: string
  }
  | { kind: 'session/delete'; id: string; sessionId: string }
  | { kind: 'session/delete/response'; id: string; ok: true }
  | { kind: 'session/delete/response'; id: string; ok: false; error: string }
  | { kind: 'session/list'; id: string }
  | { kind: 'session/list/response'; id: string; ok: true; sessions: BridgeSessionSummary[] }
  | { kind: 'session/list/response'; id: string; ok: false; error: string }
  | { kind: 'model/list'; id: string }
  | {
    kind: 'model/list/response'
    id: string
    ok: true
    providers: Array<{
      id: string
      name: string
      models: Array<{
        id: string
        name: string
        vision?: boolean
        contextWindow?: number
        reasoningEfforts?: Array<{ id: string; name: string }>
      }>
    }>
    current: { provider: string; model: string; reasoningEffort?: string }
  }
  | { kind: 'model/list/response'; id: string; ok: false; error: string }
  | { kind: 'model/select'; id: string; provider: string; model: string; reasoningEffort?: string }
  | { kind: 'model/select/response'; id: string; ok: true }
  | { kind: 'model/select/response'; id: string; ok: false; error: string }
  | { kind: 'permission/select'; id: string; sessionId: string; preset: string }
  | { kind: 'permission/select/response'; id: string; ok: true; preset: string }
  | { kind: 'permission/select/response'; id: string; ok: false; error: string }
  | { kind: 'permission/list'; id: string; sessionId: string }
  | {
    kind: 'permission/list/response'
    id: string
    ok: true
    presets: string[]
    current: string
  }
  | { kind: 'permission/list/response'; id: string; ok: false; error: string }
  | { kind: 'settings/describe'; id: string }
  | {
    kind: 'settings/describe/response'
    id: string
    ok: true
    /** Redacted projection: value/base/user are the redacted layers; secretFields lists redacted positions. */
    namespaces: SettingsNamespaceView[]
  }
  | { kind: 'settings/describe/response'; id: string; ok: false; error: string }
  | {
    kind: 'settings/update'
    id: string
    ns: string
    patch: Record<string, unknown>
    /** Revision the Host read; omitted writes unconditionally. */
    expectedRevision?: number
  }
  | {
    kind: 'settings/update/response'
    id: string
    ok: true
    namespace: SettingsNamespaceView
  }
  | { kind: 'settings/update/response'; id: string; ok: false; error: string }
  | { kind: 'commands/list'; id: string; sessionId: string }
  | { kind: 'commands/list/response'; id: string; ok: true; commands: BridgeCommandSummary[] }
  | { kind: 'commands/list/response'; id: string; ok: false; error: string }
  | { kind: 'commands/execute'; id: string; sessionId: string; line: string }
  | {
    kind: 'commands/execute/response'
    id: string
    ok: true
    /** Whether the line resolved a registered command; false leaves it to the prompt path. */
    matched: boolean
    /** The settled execution; absent when `matched` is false. */
    outcome?: BridgeCommandOutcome
  }
  | { kind: 'commands/execute/response'; id: string; ok: false; error: string }
  | { kind: 'agent-presets/list'; id: string }
  | {
    kind: 'agent-presets/list/response'
    id: string
    ok: true
    presets: BridgeAgentPresetSummary[]
  }
  | { kind: 'agent-presets/list/response'; id: string; ok: false; error: string }
  | { kind: 'skills/list'; id: string; sessionId: string }
  | { kind: 'skills/list/response'; id: string; ok: true; skills: BridgeSkillSummary[] }
  | { kind: 'skills/list/response'; id: string; ok: false; error: string }
  | { kind: 'error'; id?: string; message: string }

/** Closed approval outcomes accepted on the wire. */
export const APPROVAL_OUTCOMES: readonly ApprovalOutcome[] = [
  'allowed-once',
  'rejected',
  'cancelled',
  'unavailable',
]

/** Re-export for Host consumers that only depend on the bridge types. */
export type { ApprovalOutcome, AskUserQuestionAnswer, AskUserQuestionItem }
