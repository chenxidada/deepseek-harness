/**
 * Change-list / diff-summary / inline-diff DOM helpers (AC-42/43 / AD-CUX-8 / DEBT-CUX-001).
 * Diff data comes from Host `change/get-diff` → `change/diff-content`; this module only renders.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/render/change-diff-dom
 */

import type { ChangeListPayload } from '../../change/types.ts'
import { applyMessageIdentity, type TextBubbleMessage } from './message-dom.ts'

/** Minimal change-list / diff-summary message shape. */
export interface ChangeDiffBubbleMessage extends TextBubbleMessage {
  changeList?: ChangeListPayload
  text?: string
}

/** Optional postMessage sink (Webview vscode API or test spy). */
export type ChangeDiffPostMessage = (message: Record<string, unknown>) => void

/**
 * Status label for change-list rows (AC-10 neutral phrasing).
 * @param status - ChangeStatus string.
 */
export function changeStatusLabel(status: string | undefined): string {
  if (status === 'unreviewed') return '未查看'
  if (status === 'reviewed') return '已审阅'
  if (status === 'reverted') return '已撤销'
  return String(status || '')
}

/**
 * Fill an inline diff pane from Host `change/diff-content` (XSS-safe textContent).
 * @param pane - `.change-diff-pane` element.
 * @param msg - diff-content fields.
 */
export function fillChangeDiffPane(
  pane: Element,
  msg: {
    available: boolean
    oldText?: string | null
    newText?: string
    reason?: string
  },
): void {
  if (!msg.available) {
    pane.textContent = msg.reason || '完整 diff 不可用'
    return
  }
  const oldPart = msg.oldText === null || msg.oldText === undefined
    ? '(new file)\n'
    : String(msg.oldText)
  const newPart = String(msg.newText || '')
  pane.textContent = `--- before ---\n${oldPart}\n--- after ---\n${newPart}`
}

/**
 * Render a diff-summary entry bubble (AC-30 secondary → reveal change-list).
 */
export function renderDiffSummaryBubble(
  doc: Document,
  msg: ChangeDiffBubbleMessage,
  postMessage?: ChangeDiffPostMessage,
): HTMLElement {
  const div = doc.createElement('div')
  div.className = `msg bubble ${msg.role ?? 'notice'}`
  applyMessageIdentity(div, {
    ...msg,
    role: msg.role ?? 'notice',
    kind: 'diff-summary',
  })
  div.setAttribute('data-kind', 'diff-summary')
  if (msg.sourceMessageId) {
    div.setAttribute('data-source-message-id', String(msg.sourceMessageId))
  }
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.className = 'diff-summary-entry'
  btn.setAttribute('data-testid', 'diff-summary-entry')
  btn.textContent = msg.text || ''
  btn.addEventListener('click', () => {
    const reveal: Record<string, unknown> = { type: 'action/reveal-change-list' }
    if (msg.sourceMessageId) reveal.sourceMessageId = String(msg.sourceMessageId)
    postMessage?.(reveal)
  })
  div.appendChild(btn)
  return div
}

/**
 * Render a change-list bubble with inline expand + explicit native-diff entry (T8 / AC-43).
 */
export function renderChangeListBubble(
  doc: Document,
  msg: ChangeDiffBubbleMessage,
  postMessage?: ChangeDiffPostMessage,
): HTMLElement {
  const div = doc.createElement('div')
  div.className = `msg bubble ${msg.role ?? 'notice'}`
  applyMessageIdentity(div, {
    ...msg,
    role: msg.role ?? 'notice',
    kind: 'change-list',
  })
  div.setAttribute('data-kind', 'change-list')
  div.setAttribute('data-testid', 'change-list')

  const payload = msg.changeList
  if (payload?.sourceMessageId) {
    div.setAttribute('data-source-message-id', String(payload.sourceMessageId))
  }

  const wrap = doc.createElement('div')
  wrap.className = 'change-list'
  if (payload?.emptyNotice) {
    wrap.className += ' change-list-empty'
    wrap.setAttribute('data-empty', 'true')
    wrap.textContent = msg.text || '本回合没有可展示的文件变更'
    div.appendChild(wrap)
    return div
  }

  const header = doc.createElement('div')
  header.className = 'change-list-header'
  header.textContent = msg.text || ''
  wrap.appendChild(header)

  const changes = payload?.changes ?? []
  for (const change of changes) {
    const row = doc.createElement('div')
    row.className = 'change-list-row'

    const select = doc.createElement('input')
    select.type = 'checkbox'
    select.className = 'change-list-select'
    select.setAttribute('data-testid', 'change-list-select')
    select.setAttribute('data-change-id', String(change.changeId || ''))
    select.disabled = change.status === 'reverted'

    const openBtn = doc.createElement('button')
    openBtn.type = 'button'
    openBtn.className = 'change-list-item'
    openBtn.setAttribute('data-testid', 'change-list-item')
    openBtn.setAttribute('data-change-id', String(change.changeId || ''))
    openBtn.setAttribute('data-path', String(change.path || ''))
    openBtn.textContent = `${String(change.path || '')} · ${String(change.kind || '')}`
      + ` · +${String(change.additions || 0)}/-${String(change.deletions || 0)}`
      + ` · ${changeStatusLabel(change.status)}`
    openBtn.addEventListener('click', () => {
      postMessage?.({
        type: 'change/open',
        changeId: change.changeId,
        path: change.path,
      })
    })

    const expandBtn = doc.createElement('button')
    expandBtn.type = 'button'
    expandBtn.className = 'change-list-expand'
    expandBtn.setAttribute('data-testid', 'change-list-expand')
    expandBtn.setAttribute('data-change-id', String(change.changeId || ''))
    expandBtn.textContent = 'Diff'
    expandBtn.title = '展开/折叠内联 diff（默认）'

    const nativeBtn = doc.createElement('button')
    nativeBtn.type = 'button'
    nativeBtn.className = 'change-list-open-native-diff'
    nativeBtn.setAttribute('data-testid', 'change-list-open-native-diff')
    nativeBtn.setAttribute('data-change-id', String(change.changeId || ''))
    nativeBtn.textContent = '在编辑器中打开 Diff'
    nativeBtn.title = '在 VS Code 原生 Diff 中打开'
    nativeBtn.addEventListener('click', () => {
      postMessage?.({ type: 'change/open-native-diff', changeId: change.changeId })
    })

    const diffPane = doc.createElement('div')
    diffPane.className = 'change-diff-pane'
    diffPane.hidden = true
    diffPane.setAttribute('data-testid', 'change-diff-pane')
    diffPane.setAttribute('data-change-id', String(change.changeId || ''))

    expandBtn.addEventListener('click', () => {
      const expanded = expandBtn.classList.contains('is-expanded')
      if (expanded) {
        expandBtn.classList.remove('is-expanded')
        openBtn.classList.remove('is-expanded')
        diffPane.hidden = true
        return
      }
      expandBtn.classList.add('is-expanded')
      openBtn.classList.add('is-expanded')
      diffPane.hidden = false
      diffPane.textContent = 'Loading diff…'
      postMessage?.({ type: 'change/get-diff', changeId: change.changeId })
    })

    const sourceBtn = doc.createElement('button')
    sourceBtn.type = 'button'
    sourceBtn.className = 'change-list-reveal-source'
    sourceBtn.setAttribute('data-testid', 'change-list-reveal-source')
    sourceBtn.textContent = '来源'
    sourceBtn.title = '定位到来源助手消息'
    sourceBtn.addEventListener('click', () => {
      if (!payload?.sourceMessageId) return
      postMessage?.({
        type: 'change/reveal-source',
        sourceMessageId: String(payload.sourceMessageId),
      })
    })

    const reviewBtn = doc.createElement('button')
    reviewBtn.type = 'button'
    reviewBtn.className = 'change-list-mark-reviewed'
    reviewBtn.setAttribute('data-testid', 'change-list-mark-reviewed')
    reviewBtn.setAttribute('data-change-id', String(change.changeId || ''))
    reviewBtn.textContent = '已审阅'
    reviewBtn.title = '标记为已审阅（不写盘）'
    reviewBtn.disabled = change.status === 'reverted' || change.status === 'reviewed'
    reviewBtn.addEventListener('click', () => {
      postMessage?.({ type: 'change/mark-reviewed', changeId: change.changeId })
    })

    const revertBtn = doc.createElement('button')
    revertBtn.type = 'button'
    revertBtn.className = 'change-list-revert'
    revertBtn.setAttribute('data-testid', 'change-list-revert')
    revertBtn.setAttribute('data-change-id', String(change.changeId || ''))
    revertBtn.textContent = '撤销'
    revertBtn.title = '撤销此文件变更'
    revertBtn.disabled = change.status === 'reverted'
    revertBtn.addEventListener('click', () => {
      postMessage?.({ type: 'change/revert', changeId: change.changeId })
    })

    row.appendChild(select)
    row.appendChild(openBtn)
    row.appendChild(expandBtn)
    row.appendChild(nativeBtn)
    row.appendChild(sourceBtn)
    row.appendChild(reviewBtn)
    row.appendChild(revertBtn)
    wrap.appendChild(row)
    wrap.appendChild(diffPane)
  }

  const batchBar = doc.createElement('div')
  batchBar.className = 'change-list-batch'
  const revertManyBtn = doc.createElement('button')
  revertManyBtn.type = 'button'
  revertManyBtn.className = 'change-list-revert-many'
  revertManyBtn.setAttribute('data-testid', 'change-list-revert-many')
  revertManyBtn.textContent = '撤销勾选'
  revertManyBtn.addEventListener('click', () => {
    const ids: string[] = []
    const boxes = wrap.querySelectorAll('.change-list-select:checked')
    for (const box of boxes) {
      const id = box.getAttribute('data-change-id')
      if (id) ids.push(id)
    }
    if (ids.length === 0) return
    postMessage?.({ type: 'change/revert-many', changeIds: ids })
  })
  const revertAllBtn = doc.createElement('button')
  revertAllBtn.type = 'button'
  revertAllBtn.className = 'change-list-revert-all'
  revertAllBtn.setAttribute('data-testid', 'change-list-revert-all')
  revertAllBtn.textContent = '全部撤销'
  revertAllBtn.addEventListener('click', () => {
    const ids: string[] = []
    for (const change of changes) {
      if (change.status === 'reverted') continue
      if (change.changeId) ids.push(String(change.changeId))
    }
    if (ids.length === 0) return
    postMessage?.({ type: 'change/revert-many', changeIds: ids })
  })
  batchBar.appendChild(revertManyBtn)
  batchBar.appendChild(revertAllBtn)
  wrap.appendChild(batchBar)
  div.appendChild(wrap)
  return div
}

/**
 * Mount a change-list or diff-summary message.
 */
export function mountChangeDiffMessage(
  container: ParentNode,
  msg: ChangeDiffBubbleMessage,
  postMessage?: ChangeDiffPostMessage,
): HTMLElement {
  const doc = (container as { ownerDocument?: Document }).ownerDocument ?? globalThis.document
  const el = msg.kind === 'diff-summary'
    ? renderDiffSummaryBubble(doc, msg, postMessage)
    : renderChangeListBubble(doc, msg, postMessage)
  container.appendChild(el)
  return el
}

/**
 * Browser-inline source mirroring the helpers above for Webview embed (DEBT-CUX-001).
 * Expects `applyMessageIdentity` from message-dom browser source.
 */
export function changeDiffDomBrowserSource(): string {
  return `
function changeStatusLabel(status) {
  if (status === 'unreviewed') return '未查看';
  if (status === 'reviewed') return '已审阅';
  if (status === 'reverted') return '已撤销';
  return String(status || '');
}
function fillChangeDiffPane(pane, msg) {
  if (!msg.available) {
    pane.textContent = msg.reason || '完整 diff 不可用';
    return;
  }
  var oldPart = msg.oldText === null || msg.oldText === undefined
    ? '(new file)\\n'
    : String(msg.oldText);
  var newPart = String(msg.newText || '');
  pane.textContent = '--- before ---\\n' + oldPart + '\\n--- after ---\\n' + newPart;
}
function renderDiffSummaryBubble(doc, msg, postMessage) {
  msg = msg || {};
  var div = doc.createElement('div');
  div.className = 'msg bubble ' + (msg.role || 'notice');
  applyMessageIdentity(div, {
    id: msg.id,
    role: msg.role || 'notice',
    kind: 'diff-summary',
    turn: msg.turn,
    sourceMessageId: msg.sourceMessageId,
  });
  div.setAttribute('data-kind', 'diff-summary');
  if (msg.sourceMessageId) {
    div.setAttribute('data-source-message-id', String(msg.sourceMessageId));
  }
  var btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'diff-summary-entry';
  btn.setAttribute('data-testid', 'diff-summary-entry');
  btn.textContent = msg.text || '';
  btn.addEventListener('click', function() {
    var reveal = { type: 'action/reveal-change-list' };
    if (msg.sourceMessageId) reveal.sourceMessageId = String(msg.sourceMessageId);
    if (typeof postMessage === 'function') postMessage(reveal);
    else try { vscode.postMessage(reveal); } catch (e) {}
  });
  div.appendChild(btn);
  return div;
}
function renderChangeListBubble(doc, msg, postMessage) {
  msg = msg || {};
  var post = typeof postMessage === 'function'
    ? postMessage
    : function(m) { try { vscode.postMessage(m); } catch (e) {} };
  var div = doc.createElement('div');
  div.className = 'msg bubble ' + (msg.role || 'notice');
  applyMessageIdentity(div, {
    id: msg.id,
    role: msg.role || 'notice',
    kind: 'change-list',
    turn: msg.turn,
    sourceMessageId: msg.sourceMessageId,
  });
  div.setAttribute('data-kind', 'change-list');
  div.setAttribute('data-testid', 'change-list');
  var payload = msg.changeList || {};
  if (payload.sourceMessageId) {
    div.setAttribute('data-source-message-id', String(payload.sourceMessageId));
  }
  var wrap = doc.createElement('div');
  wrap.className = 'change-list';
  if (payload.emptyNotice) {
    wrap.className += ' change-list-empty';
    wrap.setAttribute('data-empty', 'true');
    wrap.textContent = msg.text || '本回合没有可展示的文件变更';
    div.appendChild(wrap);
    return div;
  }
  var header = doc.createElement('div');
  header.className = 'change-list-header';
  header.textContent = msg.text || '';
  wrap.appendChild(header);
  var changes = payload.changes || [];
  for (var i = 0; i < changes.length; i++) {
    (function(change) {
      var row = doc.createElement('div');
      row.className = 'change-list-row';
      var select = doc.createElement('input');
      select.type = 'checkbox';
      select.className = 'change-list-select';
      select.setAttribute('data-testid', 'change-list-select');
      select.setAttribute('data-change-id', String(change.changeId || ''));
      select.disabled = change.status === 'reverted';
      var openBtn = doc.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'change-list-item';
      openBtn.setAttribute('data-testid', 'change-list-item');
      openBtn.setAttribute('data-change-id', String(change.changeId || ''));
      openBtn.setAttribute('data-path', String(change.path || ''));
      openBtn.textContent = String(change.path || '') + ' · ' + String(change.kind || '')
        + ' · +' + String(change.additions || 0) + '/-' + String(change.deletions || 0)
        + ' · ' + changeStatusLabel(change.status);
      openBtn.addEventListener('click', function() {
        post({ type: 'change/open', changeId: change.changeId, path: change.path });
      });
      var expandBtn = doc.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'change-list-expand';
      expandBtn.setAttribute('data-testid', 'change-list-expand');
      expandBtn.setAttribute('data-change-id', String(change.changeId || ''));
      expandBtn.textContent = 'Diff';
      expandBtn.title = '展开/折叠内联 diff（默认）';
      var nativeBtn = doc.createElement('button');
      nativeBtn.type = 'button';
      nativeBtn.className = 'change-list-open-native-diff';
      nativeBtn.setAttribute('data-testid', 'change-list-open-native-diff');
      nativeBtn.setAttribute('data-change-id', String(change.changeId || ''));
      nativeBtn.textContent = '在编辑器中打开 Diff';
      nativeBtn.title = '在 VS Code 原生 Diff 中打开';
      nativeBtn.addEventListener('click', function() {
        post({ type: 'change/open-native-diff', changeId: change.changeId });
      });
      var diffPane = doc.createElement('div');
      diffPane.className = 'change-diff-pane';
      diffPane.hidden = true;
      diffPane.setAttribute('data-testid', 'change-diff-pane');
      diffPane.setAttribute('data-change-id', String(change.changeId || ''));
      expandBtn.addEventListener('click', function() {
        var expanded = expandBtn.classList.contains('is-expanded');
        if (expanded) {
          expandBtn.classList.remove('is-expanded');
          openBtn.classList.remove('is-expanded');
          diffPane.hidden = true;
          return;
        }
        expandBtn.classList.add('is-expanded');
        openBtn.classList.add('is-expanded');
        diffPane.hidden = false;
        diffPane.textContent = 'Loading diff…';
        post({ type: 'change/get-diff', changeId: change.changeId });
      });
      var sourceBtn = doc.createElement('button');
      sourceBtn.type = 'button';
      sourceBtn.className = 'change-list-reveal-source';
      sourceBtn.setAttribute('data-testid', 'change-list-reveal-source');
      sourceBtn.textContent = '来源';
      sourceBtn.title = '定位到来源助手消息';
      sourceBtn.addEventListener('click', function() {
        if (!payload.sourceMessageId) return;
        post({
          type: 'change/reveal-source',
          sourceMessageId: String(payload.sourceMessageId),
        });
      });
      var reviewBtn = doc.createElement('button');
      reviewBtn.type = 'button';
      reviewBtn.className = 'change-list-mark-reviewed';
      reviewBtn.setAttribute('data-testid', 'change-list-mark-reviewed');
      reviewBtn.setAttribute('data-change-id', String(change.changeId || ''));
      reviewBtn.textContent = '已审阅';
      reviewBtn.title = '标记为已审阅（不写盘）';
      reviewBtn.disabled = change.status === 'reverted' || change.status === 'reviewed';
      reviewBtn.addEventListener('click', function() {
        post({ type: 'change/mark-reviewed', changeId: change.changeId });
      });
      var revertBtn = doc.createElement('button');
      revertBtn.type = 'button';
      revertBtn.className = 'change-list-revert';
      revertBtn.setAttribute('data-testid', 'change-list-revert');
      revertBtn.setAttribute('data-change-id', String(change.changeId || ''));
      revertBtn.textContent = '撤销';
      revertBtn.title = '撤销此文件变更';
      revertBtn.disabled = change.status === 'reverted';
      revertBtn.addEventListener('click', function() {
        post({ type: 'change/revert', changeId: change.changeId });
      });
      row.appendChild(select);
      row.appendChild(openBtn);
      row.appendChild(expandBtn);
      row.appendChild(nativeBtn);
      row.appendChild(sourceBtn);
      row.appendChild(reviewBtn);
      row.appendChild(revertBtn);
      wrap.appendChild(row);
      wrap.appendChild(diffPane);
    })(changes[i]);
  }
  var batchBar = doc.createElement('div');
  batchBar.className = 'change-list-batch';
  var revertManyBtn = doc.createElement('button');
  revertManyBtn.type = 'button';
  revertManyBtn.className = 'change-list-revert-many';
  revertManyBtn.setAttribute('data-testid', 'change-list-revert-many');
  revertManyBtn.textContent = '撤销勾选';
  revertManyBtn.addEventListener('click', function() {
    var ids = [];
    var boxes = wrap.querySelectorAll('.change-list-select:checked');
    for (var bi = 0; bi < boxes.length; bi++) {
      var id = boxes[bi].getAttribute('data-change-id');
      if (id) ids.push(id);
    }
    if (ids.length === 0) return;
    post({ type: 'change/revert-many', changeIds: ids });
  });
  var revertAllBtn = doc.createElement('button');
  revertAllBtn.type = 'button';
  revertAllBtn.className = 'change-list-revert-all';
  revertAllBtn.setAttribute('data-testid', 'change-list-revert-all');
  revertAllBtn.textContent = '全部撤销';
  revertAllBtn.addEventListener('click', function() {
    var ids = [];
    for (var ci = 0; ci < changes.length; ci++) {
      if (changes[ci].status === 'reverted') continue;
      if (changes[ci].changeId) ids.push(String(changes[ci].changeId));
    }
    if (ids.length === 0) return;
    post({ type: 'change/revert-many', changeIds: ids });
  });
  batchBar.appendChild(revertManyBtn);
  batchBar.appendChild(revertAllBtn);
  wrap.appendChild(batchBar);
  div.appendChild(wrap);
  return div;
}
`
}
