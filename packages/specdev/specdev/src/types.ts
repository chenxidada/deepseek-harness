/**
 * Pure types of the SpecDev domain: durable status, bridge snapshot, session
 * events, projection key `specdev/status`, and role metadata field names —
 * free of host Cordis service imports so clients and hosts share one table.
 *
 * @module @deepseek-ai/dsh-specdev/types
 */

/**
 * Schema version of bridge snapshots (`SpecdevSnapshot.schemaVersion`).
 *
 * - v1: base status projection (slug/stage/phase/gates/steps/pendingGate/loopCount).
 * - v2: additive optional `pipelineMode` + `initiatingCommand` for workflow-start
 *   command identity (`feature` | `bugfix` | `brief` | …). Older v1 snapshots
 *   without those fields remain valid (optional fields).
 * - v3: the visual chain — `gates.hg1_5`, the per-phase `prototype` state, and
 *   the `ui` declarations read from the phase plan. A v1/v2 snapshot carries
 *   none of them, so a reader that needs the visual chain must refuse it.
 * - v4: additive optional `plan` (ordered phase-plan rows with their progress)
 *   and `artifacts` (workspace-relative artifact paths with their ready/missing
 *   state) for IDE progress and file lists.
 */
export const SPECDEV_SCHEMA_VERSION = 4 as const

/** Human Gate identifiers SpecDev can confirm. */
export type SpecdevGateId = 'hg1' | 'hg1_5' | 'hg2' | 'hg3' | 'phase-entry' | 'prototype'

/** Gate decision accepted by {@link ConfirmGateRequest}. */
export type SpecdevGateDecision = 'pass' | 'reject' | 'defer' | 'resolve' | 'cancel'

/** Every {@link SpecdevGateId}, for runtime validation of untrusted strings. */
export const SPECDEV_GATE_IDS: readonly SpecdevGateId[] = [
  'hg1',
  'hg1_5',
  'hg2',
  'hg3',
  'phase-entry',
  'prototype',
]

/**
 * Whether a value is a gate id the runtime accepts.
 * @param value - untrusted candidate.
 */
export function isSpecdevGateId(value: unknown): value is SpecdevGateId {
  return typeof value === 'string' && (SPECDEV_GATE_IDS as readonly string[]).includes(value)
}

/** Durable step state for implementer / reviewer / verifier. */
export type SpecdevStepState = 'pending' | 'in_progress' | 'completed' | 'failed'

/** Durable Human Gate state. */
export type SpecdevGateState = 'pending' | 'passed'

/**
 * SpecDev role labels attached to agents / sessions for bridge Tab lineage.
 * Full role presets land in a later phase; Phase 1 freezes the vocabulary.
 */
export type SpecdevRole =
  | 'orchestrator'
  | 'requirement-analyst'
  | 'plan-generator'
  | 'code-explorer'
  | 'implementer'
  | 'reviewer-correctness'
  | 'reviewer-design'
  | 'reviewer-connectivity'
  | 'reviewer-visual'
  | 'reviewer'
  | 'verifier'
  | 'wiki'

/** Every {@link SpecdevRole}, for runtime validation of untrusted strings. */
export const SPECDEV_ROLES: readonly SpecdevRole[] = [
  'orchestrator',
  'requirement-analyst',
  'plan-generator',
  'code-explorer',
  'implementer',
  'reviewer-correctness',
  'reviewer-design',
  'reviewer-connectivity',
  'reviewer-visual',
  'reviewer',
  'verifier',
  'wiki',
]

/** Metadata field names published on AgentOptions / session lineage. */
export const SPECDEV_META = {
  role: 'specdev.role',
  slug: 'specdev.slug',
  phaseId: 'specdev.phaseId',
} as const

/** Durable step record of one DAG phase. */
export interface SpecdevPhaseSteps {
  readonly implementer: SpecdevStepState
  readonly reviewer: SpecdevStepState
  readonly verifier: SpecdevStepState
  /** Prototype confirmation of a UI phase; `pending` until the user confirms it. */
  readonly prototype: SpecdevGateState
}

/** On-disk `current-status.json` SoT (Cursor SpecDev convention). */
export interface CurrentStatusJson {
  readonly slug: string
  readonly description?: string
  /**
   * Slash command that started this workflow (`feature` | `bugfix` | `brief` | …).
   * Additive (schema v2); absent on legacy files until backfilled.
   */
  readonly initiating_command?: string
  /**
   * Durable pipeline mode key, typically equal to {@link initiating_command}.
   * Additive (schema v2); absent on legacy files until backfilled.
   */
  readonly pipeline_mode?: string
  readonly created: string
  readonly current_stage: string
  readonly current_phase: string | null
  readonly loop_count: number
  readonly human_gates: {
    readonly hg1: SpecdevGateState
    /** Visual-baseline gate; a workflow without a UI phase never requires it. */
    readonly hg1_5: SpecdevGateState
    readonly hg2: SpecdevGateState
    readonly hg3: SpecdevGateState
  }
  readonly phases: Readonly<Record<string, SpecdevPhaseSteps>>
  readonly last_update: string
}

/** Active workflow identity resolved from the workspace `.specdev` layout. */
export interface SpecdevActive {
  readonly slug: string
  readonly workspaceRoot: string
  readonly layoutRoot: string
}

/**
 * State fields one workflow-log `workflow/state` event may patch.
 *
 * Identity fields (`slug`, `created`, pipeline command) are fixed by the log's
 * `workflow/init` line, and `last_update` follows the event timestamp, so a
 * patch carries only the fields a transition actually moves.
 */
export type SpecdevStatePatch = Partial<Pick<
  CurrentStatusJson,
  'current_stage' | 'current_phase' | 'phases' | 'loop_count' | 'human_gates'
>>

/** Bridge / projection wire view of SpecDev status (whole post-change). */
export interface SpecdevSnapshot {
  readonly schemaVersion: number
  readonly slug: string
  readonly stage: string
  readonly phase: string | null
  readonly gates: {
    readonly hg1: SpecdevGateState
    readonly hg1_5: SpecdevGateState
    readonly hg2: SpecdevGateState
    readonly hg3: SpecdevGateState
  }
  readonly steps: Readonly<Record<string, SpecdevPhaseSteps>>
  readonly pendingGate: SpecdevGateId | null
  readonly loopCount: number
  /** Snapshot v3+: the visual chain declarations read from `phase-plan.md`. */
  readonly ui: SpecdevUiView
  readonly nextAction?: string
  readonly techDebtSummary?: { readonly blocking: number; readonly total: number }
  /** Snapshot v2+: initiating slash command (`feature` | `bugfix` | …). */
  readonly initiatingCommand?: string
  /** Snapshot v2+: durable pipeline mode key (usually same as initiatingCommand). */
  readonly pipelineMode?: string
  /** Snapshot v4+: ordered phase-plan rows for IDE progress rendering. */
  readonly plan?: readonly SpecdevPlanRow[]
  /** Snapshot v4+: workflow artifacts with workspace-relative paths for IDE listing. */
  readonly artifacts?: readonly SpecdevArtifactRow[]
}

/** Snapshot v4+: ordered phase-plan rows for IDE progress rendering. */
export interface SpecdevPlanRow {
  readonly id: string
  readonly dependencies: readonly string[]
  /** done when every step of the phase completed, active for the current phase, todo otherwise. */
  readonly status: 'done' | 'active' | 'todo'
}

/** Snapshot v4+: workflow artifacts with workspace-relative paths for IDE listing. */
export interface SpecdevArtifactRow {
  /** Workspace-relative path with POSIX separators, e.g. `.specdev/specs/<slug>/design.md`. */
  readonly path: string
  /** Display label (the file basename). */
  readonly label: string
  /** Phase id the artifact belongs to, or null for a workflow-level artifact. */
  readonly phaseId: string | null
  readonly status: 'ready' | 'missing'
}

/** Visual chain declarations a snapshot carries, read from `phase-plan.md`. */
export interface SpecdevUiView {
  /** True when any phase declares `ui: true`. */
  readonly workflow: boolean
  /**
   * Per-phase declaration, `'unknown'` when the plan does not carry one: the
   * gates that depend on it fail closed rather than assume no UI.
   */
  readonly phases: Readonly<Record<string, boolean | 'unknown'>>
}

/** Host fold state for projection key `specdev/status`. */
export interface SpecdevStatusProjectionState {
  /** Latest whole SpecDev status view, or null before any SpecDev event. */
  readonly status: SpecdevSnapshot | null
  /** First fold failure message, or null while the stream is valid. */
  readonly failure: string | null
}

/** Sole Human Gate write request — orchestrator and future bridges share this. */
export interface ConfirmGateRequest {
  readonly gate: SpecdevGateId
  readonly decision: SpecdevGateDecision | string
  readonly note?: string
  /**
   * Fallback defer target when `phaseEntry[].deferredTargetPhase` is omitted.
   * Must differ from durable `current_phase` (AC-33).
   */
  readonly deferredTargetPhase?: string
  readonly phaseEntry?: readonly {
    readonly itemIds: readonly string[]
    readonly disposition: 'resolve' | 'defer' | 'cancel'
    /** Per-item defer target — must differ from current phase (AC-33). */
    readonly deferredTargetPhase?: string
  }[]
}

/** Result of {@link ConfirmGateRequest} processing. */
export interface ConfirmGateResult {
  readonly ok: boolean
  readonly code?: string
  readonly message?: string
  readonly snapshot?: SpecdevSnapshot
}

/** Options for {@link ensureLayout}. */
export interface EnsureLayoutOptions {
  readonly slug: string
  readonly command: string
  readonly description?: string
  readonly workspaceRoot?: string
  readonly folders?: readonly string[]
}

/** Candidates used by the Q-1 workspace-root resolver. */
export interface ResolveWorkspaceRootOptions {
  /** Session cwd (absolute). */
  readonly cwd?: string
  /** Explicit workspace folder roots (absolute). */
  readonly folders?: readonly string[]
}

/** Whole-view payload for `specdev/workflow`. */
export interface SpecdevWorkflowEvent {
  readonly kind: 'specdev/workflow'
  readonly version: 1
  readonly active: SpecdevActive | null
  readonly snapshot: SpecdevSnapshot | null
}

/** Whole-view payload for `specdev/gate-pending`. */
export interface SpecdevGatePendingEvent {
  readonly kind: 'specdev/gate-pending'
  readonly version: 1
  readonly gate: SpecdevGateId
  readonly snapshot: SpecdevSnapshot
}

/** Whole-view payload for `specdev/gate-decided`. */
export interface SpecdevGateDecidedEvent {
  readonly kind: 'specdev/gate-decided'
  readonly version: 1
  readonly gate: SpecdevGateId
  readonly decision: string
  readonly note?: string
  readonly snapshot: SpecdevSnapshot
}

/** Whole-view payload for `specdev/phase`. */
export interface SpecdevPhaseEvent {
  readonly kind: 'specdev/phase'
  readonly version: 1
  readonly phaseId: string | null
  readonly steps: SpecdevSnapshot['steps']
  readonly snapshot: SpecdevSnapshot
}

/** Whole-view payload for `specdev/dispatch`. */
export interface SpecdevDispatchEvent {
  readonly kind: 'specdev/dispatch'
  readonly version: 1
  readonly role: SpecdevRole
  readonly slug: string
  readonly phaseId?: string
  readonly childSessionId: string
  readonly snapshot: SpecdevSnapshot | null
}

/** Whole-view payload for `specdev/review-verdict`. */
export interface SpecdevReviewVerdictEvent {
  readonly kind: 'specdev/review-verdict'
  readonly version: 1
  readonly verdict: 'PASS' | 'SHOULD-FIX' | 'MUST-FIX'
  readonly phaseId: string
  readonly snapshot: SpecdevSnapshot | null
}

/** Whole-view payload for `specdev/advance` (emitted by advance package later). */
export interface SpecdevAdvanceEvent {
  readonly kind: 'specdev/advance'
  readonly version: 1
  readonly nextAction: string
  readonly snapshot: SpecdevSnapshot | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The workflow this session is working in, or `null` when the workspace has
     * no active workflow: `active` names the resolved slug, layout root, and
     * workspace root, and `snapshot` is the folded status the caller saw.
     */
    'specdev/workflow': SpecdevWorkflowEvent
    /**
     * A Human Gate is waiting for the user: `gate` names it and `snapshot` is
     * the status the pending decision was derived from, so a replayed session
     * shows the same gate the panel asked about.
     */
    'specdev/gate-pending': SpecdevGatePendingEvent
    /**
     * A Human Gate decision was accepted: `gate` and `decision` are the
     * decision as the runtime applied it, `note` is the user's own text when
     * the panel supplied one, and `snapshot` is the status after the decision.
     */
    'specdev/gate-decided': SpecdevGateDecidedEvent
    /**
     * The workflow's phase position changed: `phaseId` is the phase now in
     * flight (`null` once none remains), `steps` its implementer / reviewer /
     * verifier states, and `snapshot` the folded status after the change.
     */
    'specdev/phase': SpecdevPhaseEvent
    /**
     * A role child was spawned: `role` and `slug` name the dispatch, `phaseId`
     * the phase it serves when it serves one, `childSessionId` the session the
     * child runs in, and `snapshot` the status at dispatch time.
     */
    'specdev/dispatch': SpecdevDispatchEvent
    /**
     * The three-reviewer merge produced a verdict for a phase: `verdict` is the
     * merged PASS / SHOULD-FIX / MUST-FIX and `snapshot` the status after the
     * merge, which is what decides whether the phase may advance.
     */
    'specdev/review-verdict': SpecdevReviewVerdictEvent
    /**
     * A role child finished and the runtime stated what comes next:
     * `nextAction` is the guidance handed to the Orchestrator and `snapshot`
     * is the projection it was built from, or `null` when none was available.
     */
    'specdev/advance': SpecdevAdvanceEvent
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'specdev/status': SpecdevStatusProjectionState
  }
  interface SessionProjectionMap {
    /**
     * SpecDev bridge status view (≈ {@link SpecdevSnapshot}), or `null`
     * before the first SpecDev event.
     */
    'specdev/status': SpecdevSnapshot | null
  }
}

declare module '@deepseek-ai/dsh-agent' {
  interface AgentOptions {
    /** SpecDev role for this agent (orchestrator / role subagent). */
    'specdev.role'?: SpecdevRole
    /** Active SpecDev workflow slug. */
    'specdev.slug'?: string
    /** Current DAG phase id when applicable. */
    'specdev.phaseId'?: string
  }
}
