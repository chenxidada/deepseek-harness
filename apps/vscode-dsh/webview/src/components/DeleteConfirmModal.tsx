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
      className="dsh-modal-backdrop"
    >
      <div
        className="dsh-modal"
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        <h2 id="delete-confirm-title" className="dsh-modal-head" style={{ margin: 0 }}>
          删除会话
        </h2>
        <p data-testid="delete-confirm-copy" className="dsh-modal-body" style={{ margin: 0 }}>
          将永久删除
          {confirm.title ? `「${confirm.title}」` : '该会话'}
          ，此操作不可恢复。
        </p>
        <div className="dsh-modal-actions">
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
