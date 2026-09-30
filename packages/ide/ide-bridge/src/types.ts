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

/**
 * Cordis service key for the approval service (`ctx.approval`).
 * Backs Host `approval/policy` reads and `approval/policy/set` switches.
 */
export const APPROVAL_SERVICE = 'approval'

/** Cordis service key for the session store (consumed via `ctx.get`). */
export const SESSIONS_SERVICE = 'sessions'

/**
 * Cordis service key for session titles (`ctx.sessionTitle`).
 * Backs Host `session/rename`, the only authority that writes a user title
 * back to the session log.
 */
export const SESSION_TITLE_SERVICE = 'sessionTitle'

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
 * Cordis service key for the attachment store (`ctx.attachments`).
 * Backs Host `attachment/read`, the only read of stored image bytes.
 */
export const ATTACHMENT_SERVICE = 'attachments'

/**
 * Cordis service key for the projection registry (`ctx.sessionProjections`).
 * Backs Host `projection/read` for live sessions.
 */
export const SESSION_PROJECTION_REGISTRY_SERVICE = 'sessionProjections'

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

/**
 * Cordis service key for the subagent runtime (`ctx.subagents`).
 * Backs Host `subagent/list`, `subagent/prompt`, and `subagent/interrupt`.
 */
export const SUBAGENT_SERVICE = 'subagents'

/**
 * Cordis service key for the SpecDev domain runtime (`ctx.specdev`).
 * Backs Host `specdev/snapshot` and `specdev/confirm-gate`.
 */
export const SPECDEV_SERVICE = 'specdev'

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

/**
 * Duck-typed session-projection registry surface backing `projection/read`.
 * Values are the units' client-visible views, so the bridge forwards what the
 * runtime already validates rather than re-deriving a fold in the IDE.
 */
export interface SessionProjectionRegistryCapability {
  /**
   * Read one consistent cut over the registered client-visible units.
   * @param session - live session whose projection values are read.
   * @param keys - optional unit keys to view; every client-visible unit when omitted.
   * @returns the cut and its log position.
   */
  snapshot(
    session: object,
    keys?: readonly string[],
  ): { readonly asOfSeq: number; readonly values: Record<string, unknown> }
}

/** Duck-typed persistence observation surface backing `session/stat`. */
export interface SessionPersistenceStatCapability {
  /**
   * Observe one stored session without reading its log.
   * @param sessionId - stored session identity.
   * @returns the stored snapshot, or `undefined` when nothing is stored under that id.
   */
  stat(sessionId: string): Promise<{
    readonly eventCount?: number
    readonly sizeBytes?: number
  } | undefined>
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

/** One cross-session full-text hit of a `session/search/response`. */
export interface BridgeSessionSearchHit extends BridgeSessionSummary {
  /** Log position of the strongest matching event. */
  seq: number
  /** Plain-text excerpt selected around the match. */
  snippet: string
}

/**
 * One durable image reference a session log recorded. A reader that has the
 * log but not the bytes sends this back to `attachment/read`, which resolves it
 * against the deployment attachment store; the reference fields are the ones
 * admission verified, so the store can re-check the bytes it returns.
 */
export interface BridgeAttachmentRef {
  /** Content-addressed attachment identity (`sha256:<hex>`). */
  attachmentId: string
  /** Media type admission verified from the bytes. */
  mediaType: string
  /** Normalized pixel width. */
  width: number
  /** Normalized pixel height. */
  height: number
  /** Normalized byte size. */
  bytes: number
  /** Display name recorded at admission, when the upload carried one. */
  name?: string
}

/**
 * Duck-typed attachment store read surface (`ctx.attachments`), matching the
 * `AttachmentStore` Service Definition without a dependency on it.
 */
export interface AttachmentReadCapability {
  /**
   * Read one stored image and verify its bytes against the reference.
   * @param ref - durable reference a session log recorded.
   * @returns the verified bytes.
   */
  readImage(ref: BridgeAttachmentRef): Promise<{ data: Uint8Array }>
}

/**
 * One row of a `subagent/list/response`. Child rows carry the classified
 * facts the runtime's projection fold served; a diagnostic row names why a
 * candidate could not be classified, so the Host can show damage instead of
 * hiding the child.
 */
export type BridgeSubagentEntry =
  | {
    kind: 'child'
    /** Durable child session identity. */
    sessionId: string
    /** Whether the child is a terminal one-shot or a resumable conversation. */
    mode: 'one-shot' | 'continuable'
    /** Durable creation label; absent when a one-shot child recorded none. */
    label?: string
    /** Whether the child's own driver was running when the runtime sampled it. */
    activity: 'running' | 'inactive'
    /** Whether the child itself has durable subagent children. */
    hasChildren: boolean
    /** Durable direct parent; present only in a descendant listing. */
    parentSessionId?: string
    /** Edge distance from the listing root; present only in a descendant listing. */
    depth?: number
  }
  | {
    kind: 'diagnostic'
    sessionId: string
    /** Why the candidate has no child row. */
    reason: 'corrupt' | 'unsupported' | 'unavailable'
    /** Durable direct parent; present only in a descendant listing. */
    parentSessionId?: string
    /** Edge distance from the listing root; present only in a descendant listing. */
    depth?: number
  }

/** Every gate a SpecDev workflow can wait at. */
export type BridgeSpecdevGateId = 'hg1' | 'hg1_5' | 'hg2' | 'hg3' | 'phase-entry' | 'prototype'

/** One workflow step's state as the runtime reports it. */
export type BridgeSpecdevStepState = 'pending' | 'in_progress' | 'completed' | 'failed'

/** One ordered phase-plan row of a SpecDev snapshot (schema v4). */
export interface BridgeSpecdevPlanRow {
  /** DAG phase id. */
  id: string
  /** Phase ids this phase waits on. */
  dependencies: string[]
  /** `done` once every step of the phase completed, `active` for the current phase, `todo` otherwise. */
  status: 'done' | 'active' | 'todo'
}

/** One workflow artifact of a SpecDev snapshot (schema v4). */
export interface BridgeSpecdevArtifactRow {
  /** Workspace-relative path with POSIX separators, e.g. `.specdev/specs/<slug>/design.md`. */
  path: string
  /** Display label (the file basename). */
  label: string
  /** Phase id the artifact belongs to, or null for a workflow-level artifact. */
  phaseId: string | null
  /** Whether the artifact exists with non-whitespace content. */
  status: 'ready' | 'missing'
}

/**
 * The SpecDev status view `ctx.specdev` serves: durable
 * `.specdev/specs/<slug>/current-status.json` scalars with the projection's
 * pending gate folded in. The IDE shows this instead of reading workspace
 * files, so a gate decision it renders matches the runtime's own order rules.
 */
export interface BridgeSpecdevSnapshot {
  /** Snapshot schema version the runtime emitted. */
  schemaVersion: number
  /** Workflow slug naming `.specdev/specs/<slug>/`. */
  slug: string
  /** Workflow stage key. */
  stage: string
  /** Current phase id, or null before any phase exists. */
  phase: string | null
  /** Human gate states. */
  gates: {
    hg1: 'pending' | 'passed'
    /** Visual-baseline gate; a workflow without a UI phase never requires it. */
    hg1_5: 'pending' | 'passed'
    hg2: 'pending' | 'passed'
    hg3: 'pending' | 'passed'
  }
  /** Per-phase step states, keyed by phase id. */
  steps: Record<string, {
    implementer: BridgeSpecdevStepState
    reviewer: BridgeSpecdevStepState
    verifier: BridgeSpecdevStepState
    /** Prototype confirmation of a UI phase. */
    prototype: 'pending' | 'passed'
  }>
  /** Visual chain declarations the phase plan carries, read from `phase-plan.md`. */
  ui: {
    /** True when any phase declares `ui: true`. */
    workflow: boolean
    /** Per-phase `ui` declaration; `'unknown'` when the plan does not carry one. */
    phases: Record<string, boolean | 'unknown'>
  }
  /** Gate the workflow is waiting at, or null when none is pending. */
  pendingGate: BridgeSpecdevGateId | null
  /** Implementer MUST-FIX loop count for the current phase. */
  loopCount: number
  /** Next action the durable status records, when it records one. */
  nextAction?: string
  /** Open tech-debt counts, when a registry is present. */
  techDebtSummary?: { blocking: number; total: number }
  /** Initiating slash command (`feature` | `bugfix` | …), schema v2 and later. */
  initiatingCommand?: string
  /** Durable pipeline mode key, schema v2 and later. */
  pipelineMode?: string
  /** Ordered phase-plan rows for progress rendering, schema v4 and later. */
  plan?: BridgeSpecdevPlanRow[]
  /** Workflow artifacts with workspace-relative paths, schema v4 and later. */
  artifacts?: BridgeSpecdevArtifactRow[]
}

/**
 * Live session handle the SpecDev frames pass through. `snapshot` resolves the
 * workspace root from the header's `cwd`, and `confirmGate` appends the durable
 * `specdev/gate-decided` event to this session's log.
 */
export interface SpecdevSessionHandle {
  readonly header: { readonly cwd?: string }
  append(type: string, data: unknown): unknown
}

/** Runtime answer to one `confirmGate` call. */
export interface SpecdevConfirmGateResult {
  /** Whether the decision was written and logged. */
  readonly ok: boolean
  /** Refusal code, present on a refusal. */
  readonly code?: string
  /** Refusal message, present on a refusal. */
  readonly message?: string
  /** Post-change snapshot, present when the runtime returns one. */
  readonly snapshot?: BridgeSpecdevSnapshot | null
}

/**
 * Duck-typed SpecDev domain surface (`ctx.specdev`) behind the SpecDev frames.
 * The runtime owns workspace resolution, gate ordering, and the durable write,
 * so the IDE asks for a decision's effect rather than editing status files.
 */
export interface SpecdevStatusCapability {
  /**
   * Read the active workflow's status, preferring the durable file and taking
   * the pending gate from the session projection.
   * @param session - session owning the log and workspace.
   * @param options - explicit workspace resolution candidates.
   * @returns the snapshot, or null when no workflow is active.
   */
  snapshot(
    session: SpecdevSessionHandle,
    options?: { cwd?: string; folders?: readonly string[] },
  ): BridgeSpecdevSnapshot | null
  /**
   * Apply one Human Gate decision through the sole accepted write path.
   * @param session - session whose log receives `specdev/gate-decided`.
   * @param request - gate, decision, and optional note.
   * @param options - explicit workspace resolution candidates.
   * @returns acceptance with the post-change snapshot, or the refusal reason.
   */
  confirmGate(
    session: SpecdevSessionHandle,
    request: { gate: string; decision: string; note?: string },
    options?: { cwd?: string; folders?: readonly string[] },
  ): Promise<SpecdevConfirmGateResult>
}

/**
 * Duck-typed session lookup for the SpecDev frames. Their handles must be the
 * runtime's own sessions — `snapshot` reads a header and `confirmGate` appends
 * to the log — so this is separate from {@link IdeBridgeSessions}, whose
 * handles only need the identity permission RPC addresses.
 */
export interface SpecdevSessionsCapability {
  /**
   * Look up a live session by id.
   * @param id - session identity (SDK / Tab sessionId).
   */
  get(id: string): SpecdevSessionHandle | undefined
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

/**
 * Duck-typed full-text search surface of `ctx.sessionQuery` behind
 * `session/search`. The runtime's derived index owns the matches and their
 * snippets, so the IDE never reads a log body to find one.
 */
export interface SessionQuerySearchCapability {
  /**
   * Search the live-preferred corpus and group hits by session.
   * @param request - query text and maximum sessions in this page.
   * @returns session hits ranked by their strongest matching event.
   */
  searchSessions(request: {
    /** Full-text query interpreted as data, never executable index syntax. */
    query: string
    /** Maximum sessions in this page. */
    limit?: number
  }): Promise<{
    items: readonly {
      /** Cloned header of the matching session. */
      header: BridgeSessionHeader
      /** Strongest matching event of this session. */
      bestMatch: {
        /** Log position of the matching event. */
        seq: number
        /** Plain-text excerpt selected around the match. */
        snippet: string
      }
    }[]
  }>
}

/**
 * One durable subagent row as `ctx.subagents` classifies it: the runtime's
 * `subagent` projection fold owns mode and label, so the bridge never parses a
 * child descriptor itself. A candidate the fold cannot identify is a
 * `diagnostic` whose reason names why.
 */
export type SubagentListRow =
  | {
    readonly kind: 'child'
    /** Durable child session identity. */
    readonly id: string
    /** Whether the logical record was resident when the runtime listed it. */
    readonly activity: 'running' | 'inactive'
    /** Whether a direct descendant is itself a durable subagent. */
    readonly hasChildren: boolean
    /** Whether the child is a terminal one-shot or a resumable conversation. */
    readonly mode: 'one-shot' | 'continuable'
    /** Durable creation label; one-shot children may lack one. */
    readonly label?: string
  }
  | {
    readonly kind: 'diagnostic'
    /** The candidate's session id. */
    readonly id: string
    /** Why the candidate has no child row. */
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/** One descendant row: the durable child facts plus its place in the tree. */
export type SubagentDescendantRow = SubagentListRow & {
  /** Durable direct parent of this candidate. */
  readonly parentId: string
  /** Edge distance from the requested root. */
  readonly depth: number
}

/**
 * Duck-typed durable subagent enumeration of `ctx.subagents` behind
 * `subagent/list`. Both reads are projection-backed and resume no Agent, so a
 * closed child is still listed.
 */
export interface SubagentListCapability {
  /**
   * Read one session's durable direct children.
   * @param parentSessionId - session whose direct children are listed.
   * @param signal - carrier cancellation observed around every persistence read.
   * @returns children and per-child diagnostics, ordered by creation time.
   */
  listChildren(parentSessionId: string, signal?: AbortSignal): Promise<readonly SubagentListRow[]>
  /**
   * Read every session-backed subagent below one root, in stable pre-order.
   * @param rootSessionId - session whose descendant tree is listed.
   * @param signal - carrier cancellation observed around every persistence read.
   * @returns interpreted subagents with their durable direct parent and depth.
   */
  listDescendants(
    rootSessionId: string,
    signal?: AbortSignal,
  ): Promise<readonly SubagentDescendantRow[]>
}

/**
 * Duck-typed continuation delivery of `ctx.subagents` behind `subagent/prompt`.
 * Only a continuable child accepts a human message, and only through its live
 * direct parent.
 */
export interface SubagentPromptCapability {
  /**
   * Deliver one human message to a continuable child through its live parent.
   * @param request - durable address, minted identity, and text content.
   * @param signal - cancellation owning the call until inbox acceptance.
   * @returns the accepted message's inbox identity.
   */
  prompt(
    request: {
      /** Client-minted identity persisted on the accepted message. */
      requestId: string
      parentSessionId: string
      childSessionId: string
      /** Required continuation discriminator. */
      mode: 'continuable'
      /** Text parts delivered as the child's user message. */
      content: readonly { readonly type: 'text'; readonly text: string }[]
    },
    signal?: AbortSignal,
  ): Promise<{ readonly messageId: string }>
}

/**
 * Duck-typed interrupt surface of `ctx.subagents` behind `subagent/interrupt`.
 * The claimed durable parent is the authority the runtime authorizes against.
 */
export interface SubagentInterruptCapability {
  /**
   * Abort one child's active turn under the claimed parent's authority.
   * @param targetSessionId - durable child session id to interrupt.
   * @param authority - user authority naming the durable direct parent.
   */
  interrupt(targetSessionId: string, authority: { kind: 'user'; parentSessionId: string }): void
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
   * Render one preset (or the derived `custom` state) as a client option,
   * carrying the display label and description the preset table declares.
   * @param name - preset table key, or `custom`.
   */
  optionOf(name: string): BridgePermissionPreset
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

/** Approval policy vocabulary accepted on the wire. */
export type BridgeApprovalPolicy = 'ask' | 'never'

/**
 * Approval-policy surface used by Host `approval/policy` frames.
 * Duck-typed against the approval Service Definition so ide-bridge stays free of
 * a hard dependency on that package.
 */
export interface ApprovalPolicyCapability {
  /** Configured policy that applies to a session with no logged override. */
  readonly config: { readonly policy?: BridgeApprovalPolicy }
  /**
   * Read a session's own last logged policy override.
   * @param session - live session object.
   */
  overrideOf(session: IdeBridgeSessionHandle): BridgeApprovalPolicy | undefined
  /**
   * Apply one policy to a live agent, which the runtime reports to the model on
   * its next step.
   * @param agent - live agent object.
   * @param policy - the policy to apply.
   */
  setPolicy(agent: object, policy: BridgeApprovalPolicy): void
}

/** One selectable permission preset as a client renders it (`permission/list` payload). */
export interface BridgePermissionPreset {
  /** Stable value the client sends back on select. */
  value: string
  /** Display label; falls back to the table key when the table declares none. */
  name: string
  /** One user-facing sentence on what the preset means, when the table declares one. */
  description?: string
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

/**
 * Session-title write surface used by Host `session/rename`.
 * Duck-typed against `SessionTitleService` so ide-bridge stays free of a hard
 * dependency on that package.
 */
export interface IdeBridgeSessionTitles {
  /**
   * Accept an explicit user title, which the service commits as a
   * `session/title` event and pins against automatic generation.
   * @param session - exact live session to rename.
   * @param title - raw user input; the service normalizes it.
   * @returns the accepted title snapshot.
   * @throws when the title normalizes to empty or the session is not live.
   */
  rename(session: IdeBridgeSessionHandle, title: string): { title: string }
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
  /** Driver status; `subagent/list` re-samples it so a row reports live work, not residency. */
  readonly status?: string
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
  /** Preset id, e.g. `specdev-implementer`. */
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
  /** Preset id, e.g. `specdev-implementer`. */
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
    /** Accept an explicit user title for one live session. */
    kind: 'session/rename'
    id: string
    sessionId: string
    title: string
  }
  | {
    kind: 'session/rename/response'
    id: string
    ok: true
    /** The normalized title the runtime committed to the session log. */
    title: string
  }
  | { kind: 'session/rename/response'; id: string; ok: false; error: string }
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
  | { kind: 'session/delete'; id: string; sessionId: string }
  | { kind: 'session/delete/response'; id: string; ok: true }
  | { kind: 'session/delete/response'; id: string; ok: false; error: string }
  | { kind: 'session/list'; id: string }
  | { kind: 'session/list/response'; id: string; ok: true; sessions: BridgeSessionSummary[] }
  | { kind: 'session/list/response'; id: string; ok: false; error: string }
  | { kind: 'session/stat'; id: string; sessionId: string }
  | {
    kind: 'session/stat/response'
    id: string
    ok: true
    /** Whether the runtime still stores a log for the asked session. */
    found: boolean
    /** Recorded event count; present only for a found session whose backend reports it. */
    eventCount?: number
    /** Stored byte size; present only for a found session whose backend reports it. */
    sizeBytes?: number
  }
  | { kind: 'session/stat/response'; id: string; ok: false; error: string }
  | { kind: 'projection/read'; id: string; sessionId: string; keys?: string[] }
  | {
    kind: 'projection/read/response'
    id: string
    ok: true
    /** Log position every returned value reflects. */
    asOfSeq: number
    /** Client-visible unit views, keyed by unit key. */
    values: Record<string, unknown>
  }
  | { kind: 'projection/read/response'; id: string; ok: false; error: string }
  | {
    kind: 'session/search'
    id: string
    /** Full-text query text, matched against indexed event content. */
    query: string
    /** Maximum sessions in one page. */
    limit?: number
  }
  | {
    kind: 'session/search/response'
    id: string
    ok: true
    /** Session hits ranked by their strongest matching event. */
    hits: BridgeSessionSearchHit[]
  }
  | { kind: 'session/search/response'; id: string; ok: false; error: string }
  | {
    kind: 'attachment/read'
    id: string
    /** Durable image reference one session log recorded, as the log stated it. */
    ref: BridgeAttachmentRef
  }
  | {
    kind: 'attachment/read/response'
    id: string
    ok: true
    /** Media type verified when the image was admitted. */
    mediaType: string
    /** Canonical base64 of the stored bytes. */
    data: string
  }
  | { kind: 'attachment/read/response'; id: string; ok: false; error: string }
  | {
    kind: 'subagent/list'
    id: string
    /** Session whose children (`children`) or whole subtree (`descendants`) is listed. */
    sessionId: string
    scope: 'children' | 'descendants'
  }
  | {
    kind: 'subagent/list/response'
    id: string
    ok: true
    /** Whether the runtime held a live Agent for the addressed session when it listed. */
    sessionLive: boolean
    entries: BridgeSubagentEntry[]
  }
  | { kind: 'subagent/list/response'; id: string; ok: false; error: string }
  | {
    kind: 'subagent/prompt'
    id: string
    /** Durable parent whose live Agent delivers the message. */
    parentSessionId: string
    /** Durable continuable child receiving the message. */
    childSessionId: string
    /** Message text; the bridge carries text only. */
    text: string
  }
  | {
    kind: 'subagent/prompt/response'
    id: string
    ok: true
    /** Identity of the message the child's inbox accepted. */
    messageId: string
  }
  | { kind: 'subagent/prompt/response'; id: string; ok: false; error: string }
  | {
    kind: 'subagent/interrupt'
    id: string
    /** Durable parent whose authority the request claims. */
    parentSessionId: string
    /** Durable child whose active turn is aborted. */
    childSessionId: string
  }
  | { kind: 'subagent/interrupt/response'; id: string; ok: true }
  | { kind: 'subagent/interrupt/response'; id: string; ok: false; error: string }
  | {
    kind: 'specdev/snapshot'
    id: string
    /** Session whose workspace active workflow is read. */
    sessionId: string
  }
  | {
    kind: 'specdev/snapshot/response'
    id: string
    ok: true
    /** Active workflow status, or null when the workspace has none. */
    snapshot: BridgeSpecdevSnapshot | null
  }
  | { kind: 'specdev/snapshot/response'; id: string; ok: false; error: string }
  | {
    kind: 'specdev/confirm-gate'
    id: string
    /** Session whose log receives the durable gate decision event. */
    sessionId: string
    /** Gate being decided. */
    gate: string
    /** Decision to apply (`pass` | `reject` | `defer` | `resolve` | `cancel`). */
    decision: string
    /** Optional human note recorded on the decision event. */
    note?: string
  }
  | {
    kind: 'specdev/confirm-gate/response'
    id: string
    ok: true
    /** Post-change status, or null when the runtime returned none. */
    snapshot: BridgeSpecdevSnapshot | null
  }
  | { kind: 'specdev/confirm-gate/response'; id: string; ok: false; error: string }
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
    /** Switchable presets in table order, plus the derived `custom` while it is current. */
    options: BridgePermissionPreset[]
    current: string
  }
  | { kind: 'permission/list/response'; id: string; ok: false; error: string }
  | { kind: 'approval/policy'; id: string; sessionId: string }
  | { kind: 'approval/policy/response'; id: string; ok: true; policy: BridgeApprovalPolicy }
  | { kind: 'approval/policy/response'; id: string; ok: false; error: string }
  | { kind: 'approval/policy/set'; id: string; sessionId: string; policy: BridgeApprovalPolicy }
  | { kind: 'approval/policy/set/response'; id: string; ok: true; policy: BridgeApprovalPolicy }
  | { kind: 'approval/policy/set/response'; id: string; ok: false; error: string }
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

/** Closed approval outcomes accepted on the wire. */
export const APPROVAL_OUTCOMES: readonly ApprovalOutcome[] = [
  'allowed-once',
  'rejected',
  'cancelled',
  'unavailable',
]

/** Closed approval policies accepted on the wire. */
export const APPROVAL_POLICIES: readonly BridgeApprovalPolicy[] = ['ask', 'never']

/** Re-export for Host consumers that only depend on the bridge types. */
export type { ApprovalOutcome, AskUserQuestionAnswer, AskUserQuestionItem }
