/**
 * Connection UI projection: panel-primary errors + status-bar when Conversation hidden (AD-CR-4).
 * @module @deepseek-ai/dsh-vscode-dsh/connection-ui
 */

import type { StartOrchestratorSnapshot } from './auto-start-orchestrator.ts'

/** Connection / error phase shared by panel + status bar. */
export type ConnectionUiPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'disconnected-retrying'
  | 'disconnected-manual'

/** Routed connection UI state. */
export interface ConnectionUiState {
  phase: ConnectionUiPhase
  message?: string
  settingsDeepLinkAvailable: boolean
  /** When true, status bar item is shown (Conversation not visible). */
  statusBarVisible: boolean
}

/** Duck-typed StatusBarItem. */
export interface StatusBarItemLike {
  text: string
  tooltip?: string
  command?: string | { command: string; title?: string; arguments?: unknown[] }
  backgroundColor?: unknown
  show(): void
  hide(): void
  dispose(): void
}

/** Minimal vscode surface for connection-ui. */
export interface ConnectionUiVsCode {
  window: {
    createStatusBarItem?(alignment?: number, priority?: number): StatusBarItemLike
    showErrorMessage?(message: string, ...items: string[]): Promise<unknown>
  }
  StatusBarAlignment?: { Left: number; Right: number }
}

/** Panel projection port (ChatPanelHost seam). */
export interface ConnectionPanelPort {
  /** Whether the Conversation Webview is currently visible. */
  isConversationVisible(): boolean
  /**
   * Push connection phase into the panel (banner / panel/state seam).
   * @param state - routed UI state.
   */
  applyConnectionState(state: ConnectionUiState): void
}

/**
 * Maps orchestrator snapshots to panel + optional status bar (AC-2 / AC-13 / AC-14).
 */
export class ConnectionUiController {
  private readonly statusBar: StatusBarItemLike | undefined
  private conversationVisible = false
  private lastState: ConnectionUiState = {
    phase: 'idle',
    settingsDeepLinkAvailable: false,
    statusBarVisible: false,
  }

  /**
   * @param vscode - duck-typed vscode (StatusBar optional in Node tests).
   * @param panel - panel projection port.
   */
  constructor(
    vscode: ConnectionUiVsCode,
    private readonly panel: ConnectionPanelPort,
  ) {
    const create = vscode.window.createStatusBarItem
    if (create !== undefined) {
      const align = vscode.StatusBarAlignment?.Left ?? 1
      this.statusBar = create(align, 100)
      this.statusBar.command = 'dsh.statusBarAction'
    }
  }

  /** Dispose status bar resources. */
  dispose(): void {
    this.statusBar?.dispose()
  }

  /**
   * Update Conversation visibility for error routing (AD-CR-4).
   * @param visible - webview visible flag.
   */
  setConversationVisible(visible: boolean): void {
    this.conversationVisible = visible
    this.apply(this.lastState.phase === 'idle' && !visible
      ? this.lastState
      : { ...this.lastState, statusBarVisible: this.shouldShowStatusBar(this.lastState.phase) })
  }

  /** Last projected state (tests). */
  getState(): ConnectionUiState {
    return { ...this.lastState }
  }

  /**
   * Project an orchestrator snapshot into ConnectionUiState and push surfaces.
   * @param snap - orchestrator snapshot.
   */
  projectOrchestrator(snap: StartOrchestratorSnapshot): void {
    const state = this.mapSnapshot(snap)
    this.apply(state)
  }

  private mapSnapshot(snap: StartOrchestratorSnapshot): ConnectionUiState {
    let phase: ConnectionUiPhase
    switch (snap.state) {
      case 'idle':
        phase = 'idle'
        break
      case 'starting':
      case 'pending-start':
        phase = 'connecting'
        break
      case 'started':
        phase = 'connected'
        break
      case 'failed':
        phase = 'failed'
        break
      case 'disconnected':
        phase = snap.autoRetryUsed ? 'disconnected-manual' : 'disconnected-retrying'
        break
      default: {
        const _exhaustive: never = snap.state
        void _exhaustive
        phase = 'idle'
      }
    }
    // Both failures name something the settings page carries: the credentials the
    // window must provide, or the `dsh.cliPath` value that replaces a runtime the
    // automatic sources did not find.
    const settingsDeepLinkAvailable = snap.errorKind === 'missing-credentials' || snap.errorKind === 'dsh-entry'
    const message = phase === 'connecting'
      ? '正在连接到 Host…'
      : phase === 'connected'
        ? undefined
        : phase === 'idle'
          ? undefined
          : snap.errorMessage
            ?? (phase === 'disconnected-retrying'
              ? 'Host disconnected — retrying…'
              : phase === 'disconnected-manual'
                ? 'Host disconnected. Click to open panel and retry.'
                : settingsDeepLinkAvailable
                  ? 'Missing credentials. Open settings to configure.'
                  : snap.errorMessage ?? 'Host connection failed.')
    return {
      phase,
      ...message === undefined ? {} : { message },
      settingsDeepLinkAvailable,
      statusBarVisible: this.shouldShowStatusBar(phase),
    }
  }

  private shouldShowStatusBar(phase: ConnectionUiPhase): boolean {
    if (phase === 'idle' || phase === 'connected' || phase === 'connecting') {
      // Connecting still preferred on panel when visible; status bar only when panel hidden.
      if (phase === 'connecting') return !this.conversationVisible
      return false
    }
    // failed / disconnected*: panel-primary when visible; else status bar.
    return !this.conversationVisible
  }

  private apply(state: ConnectionUiState): void {
    this.lastState = state
    this.panel.applyConnectionState(state)
    const bar = this.statusBar
    if (bar === undefined) return
    if (!state.statusBarVisible) {
      bar.hide()
      return
    }
    bar.text = state.phase === 'connecting'
      ? '$(sync~spin) DSH: Connecting…'
      : state.phase === 'failed'
        ? '$(error) DSH: Host failed'
        : '$(warning) DSH: Host disconnected'
    bar.tooltip = state.message ?? 'DeepSeek Harness connection'
    bar.command = 'dsh.statusBarAction'
    bar.show()
  }
}
