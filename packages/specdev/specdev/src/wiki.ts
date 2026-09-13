/**
 * Shared wiki-agent dispatch contract (Q-3 / AC-20): manual `/wiki` and
 * final Feature HG-3 auto path both call {@link dispatchWiki}.
 *
 * Wiki output root is always workspace `docs/wiki/` (never `$DSH_HOME`).
 * No Knowledge Base / Knownbase sync (AC-55).
 *
 * @module @deepseek-ai/dsh-specdev/wiki
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  dispatchSpecdevRole,
  type DispatchSpecdevRoleResult,
} from './dispatch.ts'

/** Wiki dispatch trigger mode (Standalone vs Pipeline). */
export type WikiDispatchMode = 'standalone' | 'pipeline'

/** Request for {@link dispatchWiki}. */
export interface DispatchWikiRequest {
  readonly slug: string
  /** `standalone` = manual `/wiki`; `pipeline` = final Feature HG-3 auto. */
  readonly mode: WikiDispatchMode
  readonly phaseId?: string
  /** Optional stable child session id (tests). */
  readonly childSessionId?: string
  /**
   * Override wake prompt. When omitted, {@link wikiRolePrompt} is used.
   * Pass `null` to skip followup wake (tests).
   */
  readonly prompt?: string | null
}

/** Result of {@link dispatchWiki} (dispatch + wiki root path). */
export interface DispatchWikiResult extends DispatchSpecdevRoleResult {
  /** Absolute workspace path to `docs/wiki/` (created if missing). */
  readonly wikiRoot: string
  readonly mode: WikiDispatchMode
}

/**
 * Build the wake prompt for the wiki role (aligned with reference wiki agent).
 * @param opts - slug, mode, optional phaseId.
 */
export function wikiRolePrompt(opts: {
  readonly slug: string
  readonly mode: WikiDispatchMode
  readonly phaseId?: string
}): string {
  const phase = opts.phaseId === undefined ? '' : ` Last completed phaseId=\`${opts.phaseId}\`.`
  if (opts.mode === 'pipeline') {
    return [
      `SpecDev wiki (Pipeline mode) for workflow \`${opts.slug}\`.${phase}`,
      'Read `.specdev/specs/<slug>/design.md`, all `phases/*/implementation.md`, and `tech-debt-registry.md`.',
      'Update workspace `docs/wiki/` (theme-domain pages); append `docs/wiki/changelog.md`.',
      'Four-stage pipeline: code analysis → topic plan → deep generation → quality gate.',
      'Intermediate work under `.wiki-work/`. Do NOT sync Knowledge Base / Knownbase (AC-55).',
    ].join(' ')
  }
  return [
    `SpecDev wiki (Standalone mode) for workflow \`${opts.slug}\`.${phase}`,
    'Scan the project and update workspace `docs/wiki/` (theme-domain pages).',
    'Four-stage pipeline: code analysis → topic plan → deep generation → quality gate.',
    'Intermediate work under `.wiki-work/`. Append changelog when updating.',
    'Do NOT sync Knowledge Base / Knownbase (AC-55).',
  ].join(' ')
}

/**
 * Relative wiki output root under the workspace (Q-1).
 */
export const WIKI_RELATIVE_ROOT = 'docs/wiki'

/**
 * Ensure workspace `docs/wiki/` exists and dispatch the wiki role with the
 * shared contract used by `/wiki` and final HG-3 auto-dispatch.
 *
 * @param ctx - host context with agents / sessions / optional specdev.
 * @param parent - Orchestrator / calling agent (session cwd = workspace).
 * @param request - slug + mode (+ optional phaseId / prompt).
 */
export async function dispatchWiki(
  ctx: Context,
  parent: Agent,
  request: DispatchWikiRequest,
): Promise<DispatchWikiResult> {
  if (typeof request.slug !== 'string' || request.slug.trim().length === 0) {
    throw new TypeError('dispatchWiki requires a non-empty slug')
  }
  const slug = request.slug.trim()
  const cwd = parent.session.header.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0) {
    throw new Error('dispatchWiki requires parent.session.header.cwd (workspace root)')
  }
  const wikiRoot = join(cwd, WIKI_RELATIVE_ROOT)
  mkdirSync(wikiRoot, { recursive: true, mode: 0o755 })

  const prompt = request.prompt === undefined
    ? wikiRolePrompt({
      slug,
      mode: request.mode,
      ...request.phaseId === undefined ? {} : { phaseId: request.phaseId },
    })
    : request.prompt

  const dispatched = await dispatchSpecdevRole(ctx, parent, {
    role: 'wiki',
    slug,
    ...request.phaseId === undefined ? {} : { phaseId: request.phaseId },
    ...request.childSessionId === undefined ? {} : { childSessionId: request.childSessionId },
    prompt,
  })

  return {
    ...dispatched,
    wikiRoot,
    mode: request.mode,
  }
}

/**
 * True when a successful HG-3 pass left no remaining dependent phase
 * (`snapshot.phase === null`) — AC-20 auto-wiki trigger.
 */
export function isFinalFeatureHg3Pass(
  gate: string,
  decision: string,
  snapshot: { readonly phase: string | null } | undefined,
): boolean {
  return gate === 'hg3'
    && decision === 'pass'
    && snapshot !== undefined
    && snapshot.phase === null
}
