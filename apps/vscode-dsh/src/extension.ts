/**
 * VS Code Extension entry. Uses a duck-typed vscode surface so unit tests and
 * Node tooling do not require the VS Code engine types at compile time.
 * @module @deepseek-ai/dsh-vscode-dsh/extension
 */

import { IdeSessionHost } from './session-host.ts'
import { redactSecrets } from './redact.ts'

/** Minimal vscode API surface used by this Extension. */
interface VsCodeLike {
  window: {
    showErrorMessage(message: string): Thenable<unknown>
    showInformationMessage(message: string): Thenable<unknown>
  }
  workspace: {
    workspaceFolders?: readonly { uri: { fsPath: string } }[]
  }
  commands: {
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): { dispose(): void }
  }
}

/** Disposable registration handle. */
interface Disposable {
  dispose(): void
}

/** Extension context subset. */
interface ExtensionContextLike {
  subscriptions: Disposable[]
  extensionPath: string
}

let host: IdeSessionHost | undefined

/**
 * Activate the Extension: register start/stop commands.
 * @param context - VS Code extension context.
 * @param vscode - the vscode module (injected for testability).
 */
export function activate(context: ExtensionContextLike, vscode: VsCodeLike): void {
  const start = vscode.commands.registerCommand('dsh.startSession', async () => {
    if (host !== undefined && host.status === 'connected') {
      await vscode.window.showInformationMessage('DeepSeek Harness IDE session is already connected.')
      return
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (folder === undefined) {
      await vscode.window.showErrorMessage('Open a workspace folder before starting a DeepSeek Harness session.')
      return
    }
    const next = new IdeSessionHost()
    host = next
    try {
      await next.start({ cwd: folder })
      await vscode.window.showInformationMessage('DeepSeek Harness IDE session connected.')
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error))
      await vscode.window.showErrorMessage(`DeepSeek Harness failed to connect: ${message}`)
    }
  })
  const stop = vscode.commands.registerCommand('dsh.stopSession', async () => {
    const current = host
    host = undefined
    if (current === undefined) {
      await vscode.window.showInformationMessage('No DeepSeek Harness IDE session is running.')
      return
    }
    await current.shutdown()
    await vscode.window.showInformationMessage('DeepSeek Harness IDE session stopped.')
  })
  context.subscriptions.push(start, stop)
}

/**
 * Deactivate: shut down any live host.
 */
export async function deactivate(): Promise<void> {
  const current = host
  host = undefined
  if (current !== undefined) await current.shutdown()
}
