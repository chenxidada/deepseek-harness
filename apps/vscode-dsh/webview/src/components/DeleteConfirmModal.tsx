import type { MessageBridge } from '../bridge/message-bridge.ts'
import type { DeleteConfirmState } from '../store/chat-ui-store.ts'
import { closeDeleteConfirm } from '../store/chat-ui-store.ts'

export interface DeleteConfirmModalProps {
  confirm: DeleteConfirmState
  bridge: MessageBridge
}

/**
 * Webview modal delete confirmation (AD-ECP-6 / AC-60).
 * Emits ui/delete-request after confirm — Host skips native re-confirm.
 */
export function DeleteConfirmModal({ confirm, bridge }: DeleteConfirmModalProps) {
  return (
    <div
      data-testid="delete-confirm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--dsh-bg)',
          color: 'var(--dsh-fg)',
          border: '1px solid var(--dsh-border)',
          borderRadius: 'var(--dsh-radius-md)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2 id="delete-confirm-title" style={{ margin: 0, fontSize: '1.05em' }}>
          删除会话
        </h2>
        <p data-testid="delete-confirm-copy" style={{ margin: 0, lineHeight: 1.45 }}>
          将永久删除
          {confirm.title ? `「${confirm.title}」` : '该会话'}
          ，此操作不可恢复。
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            data-testid="btn-delete-cancel"
            className="dsh-secondary-btn"
            onClick={() => closeDeleteConfirm()}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="btn-delete-confirm"
            className="dsh-primary-btn"
            onClick={() => {
              bridge.emitIntent({
                type: 'ui/delete-request',
                sessionId: confirm.sessionId,
              })
              closeDeleteConfirm()
            }}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}
