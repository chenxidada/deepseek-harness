/**
 * Activity bubble DOM helpers for layer-A jsdom tests and Webview (AC-21–27).
 * Default collapsed; status/expanded probeable via ChatUxProbeStore.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/render/activity-dom
 */

import type { ActivityItem, ActivityStatus } from '../activity-types.ts'
import type { ChatUxProbeStore } from '../probes.ts'
import { applyMessageIdentity } from './message-dom.ts'

/** Minimal message shape for activity bubble rendering. */
export interface ActivityBubbleMessage {
  id?: string
  role?: string
  kind?: string
  turn?: number
  text?: string
  activity?: ActivityItem
}

/**
 * Render an activity bubble with identity + status/expanded chrome (AC-20/21).
 * @param doc - Document used to create elements.
 * @param msg - message fields (must carry activity payload for full chrome).
 * @param probes - optional probe store to seed presentation seats (GAP-CUX-001).
 */
export function renderActivityBubble(
  doc: Document,
  msg: ActivityBubbleMessage,
  probes?: ChatUxProbeStore,
): HTMLElement {
  const activity = msg.activity
  const id = msg.id ?? activity?.id ?? ''
  const status: ActivityStatus = activity?.status ?? 'running'
  const expanded = activity?.expanded === true
  const turn = msg.turn ?? activity?.turn
  const toolName = activity?.toolName ?? 'tool'
  const summary = activity?.summary ?? toolName

  const div = doc.createElement('div')
  div.className = 'msg bubble notice activity'
  applyMessageIdentity(div, {
    id,
    role: msg.role ?? 'notice',
    kind: 'activity',
    ...turn === undefined ? {} : { turn },
  })
  div.setAttribute('data-testid', 'activity-item')
  div.setAttribute('data-status', status)
  div.setAttribute('data-expanded', expanded ? 'true' : 'false')
  if (activity?.callId) div.setAttribute('data-call-id', activity.callId)
  if (activity?.ordinal !== undefined) {
    div.setAttribute('data-ordinal', String(activity.ordinal))
  }
  if (!expanded) div.classList.add('is-collapsed')

  const header = doc.createElement('button')
  header.type = 'button'
  header.className = 'activity-toggle'
  header.setAttribute('data-testid', 'activity-toggle')
  header.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  header.textContent = `${expanded ? '▼' : '▶'} ${summary} · ${status}`

  const body = doc.createElement('div')
  body.className = 'activity-body'
  body.setAttribute('data-testid', 'activity-body')
  body.hidden = !expanded
  body.textContent = [
    toolName,
    activity?.callId ? `callId=${activity.callId}` : '',
    `status=${status}`,
  ].filter(Boolean).join(' · ')

  header.addEventListener('click', () => {
    toggleActivityExpanded(div, probes)
  })

  div.appendChild(header)
  div.appendChild(body)

  if (probes && id) {
    probes.setActivity(id, { status, expanded })
    probes.setExpanded(id, expanded)
  }
  return div
}

/**
 * Mount one activity message into a container.
 */
export function mountActivityMessage(
  container: ParentNode,
  msg: ActivityBubbleMessage,
  probes?: ChatUxProbeStore,
): HTMLElement {
  const doc = (container as { ownerDocument?: Document }).ownerDocument ?? globalThis.document
  const el = renderActivityBubble(doc, msg, probes)
  container.appendChild(el)
  return el
}

/**
 * Toggle expanded presentation; updates DOM + probes (AC-22/26).
 * @returns new expanded value.
 */
export function toggleActivityExpanded(
  el: Element,
  probes?: ChatUxProbeStore,
): boolean {
  const next = el.getAttribute('data-expanded') !== 'true'
  applyActivityExpanded(el, next, probes)
  return next
}

/**
 * Apply expanded chrome without changing status.
 */
export function applyActivityExpanded(
  el: Element,
  expanded: boolean,
  probes?: ChatUxProbeStore,
): void {
  el.setAttribute('data-expanded', expanded ? 'true' : 'false')
  if (expanded) el.classList.remove('is-collapsed')
  else el.classList.add('is-collapsed')

  const toggle = el.querySelector('.activity-toggle')
  if (toggle) {
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    const status = el.getAttribute('data-status') ?? 'running'
    const label = (toggle.textContent ?? '').replace(/^[▶▼]\s*/, '')
    const base = label.includes(' · ')
      ? label.replace(/\s·\s(?:running|done|failed|aborted)\s*$/, '')
      : label
    toggle.textContent = `${expanded ? '▼' : '▶'} ${base} · ${status}`
  }
  const body = el.querySelector('.activity-body') as HTMLElement | null
  if (body) body.hidden = !expanded

  const id = el.getAttribute('data-message-id')
  if (probes && id) {
    const status = (el.getAttribute('data-status') ?? 'running') as ActivityStatus
    probes.setActivity(id, { status, expanded })
    probes.setExpanded(id, expanded)
  }
}

/**
 * Patch activity status on an existing bubble (AC-27); keeps expanded seat.
 */
export function applyActivityStatus(
  el: Element,
  status: ActivityStatus,
  probes?: ChatUxProbeStore,
): void {
  el.setAttribute('data-status', status)
  const expanded = el.getAttribute('data-expanded') === 'true'
  const toggle = el.querySelector('.activity-toggle')
  if (toggle) {
    const label = (toggle.textContent ?? '').replace(/^[▶▼]\s*/, '')
    const base = label.includes(' · ')
      ? label.replace(/\s·\s(?:running|done|failed|aborted)\s*$/, '')
      : label
    toggle.textContent = `${expanded ? '▼' : '▶'} ${base} · ${status}`
  }
  const body = el.querySelector('.activity-body')
  if (body) {
    const callId = el.getAttribute('data-call-id')
    const parts = [
      body.textContent?.split(' · ')[0] ?? 'tool',
      callId ? `callId=${callId}` : '',
      `status=${status}`,
    ].filter(Boolean)
    body.textContent = parts.join(' · ')
  }
  const id = el.getAttribute('data-message-id')
  if (probes && id) {
    probes.setActivity(id, { status, expanded })
  }
}

/**
 * Browser-inline source mirroring the helpers above for Webview embed.
 */
export function activityDomBrowserSource(): string {
  return `
function renderActivityBubble(doc, msg, probes) {
  msg = msg || {};
  var activity = msg.activity || {};
  var id = msg.id || activity.id || '';
  var status = activity.status || 'running';
  var expanded = activity.expanded === true;
  var turn = msg.turn !== undefined && msg.turn !== null ? msg.turn : activity.turn;
  var toolName = activity.toolName || 'tool';
  var summary = activity.summary || toolName;
  var div = doc.createElement('div');
  div.className = 'msg bubble notice activity';
  applyMessageIdentity(div, {
    id: id,
    role: msg.role || 'notice',
    kind: 'activity',
    turn: turn,
  });
  div.setAttribute('data-testid', 'activity-item');
  div.setAttribute('data-status', status);
  div.setAttribute('data-expanded', expanded ? 'true' : 'false');
  if (activity.callId) div.setAttribute('data-call-id', String(activity.callId));
  if (activity.ordinal !== undefined && activity.ordinal !== null) {
    div.setAttribute('data-ordinal', String(activity.ordinal));
  }
  if (!expanded) div.classList.add('is-collapsed');
  var header = doc.createElement('button');
  header.type = 'button';
  header.className = 'activity-toggle';
  header.setAttribute('data-testid', 'activity-toggle');
  header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  header.textContent = (expanded ? '▼ ' : '▶ ') + summary + ' · ' + status;
  var body = doc.createElement('div');
  body.className = 'activity-body';
  body.setAttribute('data-testid', 'activity-body');
  body.hidden = !expanded;
  body.textContent = [toolName, activity.callId ? ('callId=' + activity.callId) : '', 'status=' + status]
    .filter(Boolean).join(' · ');
  header.addEventListener('click', function() {
    toggleActivityExpanded(div, probes);
    try {
      vscode.postMessage({
        type: 'action/toggle-activity',
        activityId: id,
        expanded: div.getAttribute('data-expanded') === 'true',
      });
    } catch (e) {}
  });
  div.appendChild(header);
  div.appendChild(body);
  if (probes && id && typeof probes.setActivity === 'function') {
    probes.setActivity(id, { status: status, expanded: expanded });
    if (typeof probes.setExpanded === 'function') probes.setExpanded(id, expanded);
  }
  return div;
}
function toggleActivityExpanded(el, probes) {
  var next = el.getAttribute('data-expanded') !== 'true';
  applyActivityExpanded(el, next, probes);
  return next;
}
function applyActivityExpanded(el, expanded, probes) {
  el.setAttribute('data-expanded', expanded ? 'true' : 'false');
  if (expanded) el.classList.remove('is-collapsed');
  else el.classList.add('is-collapsed');
  var toggle = el.querySelector('.activity-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    var status = el.getAttribute('data-status') || 'running';
    var label = String(toggle.textContent || '').replace(/^[▶▼]\\s*/, '');
    var base = label.indexOf(' · ') >= 0
      ? label.replace(/\\s·\\s(?:running|done|failed|aborted)\\s*$/, '')
      : label;
    toggle.textContent = (expanded ? '▼ ' : '▶ ') + base + ' · ' + status;
  }
  var body = el.querySelector('.activity-body');
  if (body) body.hidden = !expanded;
  var id = el.getAttribute('data-message-id');
  if (probes && id && typeof probes.setActivity === 'function') {
    var st = el.getAttribute('data-status') || 'running';
    probes.setActivity(id, { status: st, expanded: expanded });
    if (typeof probes.setExpanded === 'function') probes.setExpanded(id, expanded);
  }
}
function applyActivityStatus(el, status, probes) {
  el.setAttribute('data-status', status);
  var expanded = el.getAttribute('data-expanded') === 'true';
  var toggle = el.querySelector('.activity-toggle');
  if (toggle) {
    var label = String(toggle.textContent || '').replace(/^[▶▼]\\s*/, '');
    var base = label.indexOf(' · ') >= 0
      ? label.replace(/\\s·\\s(?:running|done|failed|aborted)\\s*$/, '')
      : label;
    toggle.textContent = (expanded ? '▼ ' : '▶ ') + base + ' · ' + status;
  }
  var body = el.querySelector('.activity-body');
  if (body) {
    var callId = el.getAttribute('data-call-id');
    var first = String(body.textContent || '').split(' · ')[0] || 'tool';
    body.textContent = [first, callId ? ('callId=' + callId) : '', 'status=' + status]
      .filter(Boolean).join(' · ');
  }
  var id = el.getAttribute('data-message-id');
  if (probes && id && typeof probes.setActivity === 'function') {
    probes.setActivity(id, { status: status, expanded: expanded });
  }
}
`
}
