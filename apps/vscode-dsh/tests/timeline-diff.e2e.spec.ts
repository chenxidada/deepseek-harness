/**
 * E2E: Extension command surface exposes Timeline view data + Diff jump (AC-13/23/25/33).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { activate, deactivate, getTimelineTreeItems, getWriteDiffEntries } from '../src/extension.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { timelineTreeItems } from '../src/timeline-view.ts'
import { openTimelineDiff } from '../src/diff-entry.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

describe('timeline Diff e2e (AC-13/23/25)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await deactivate()
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('active Tab timeline rows and Diff command open vscode.diff for write entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-timeline-e2e-'))
    dirs.push(dir)

    const host = new IdeSessionHost()
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-timeline-e2e',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EMIT_TURN_EVENTS: '1',
        FAKE_EMIT_WRITE_DIFF: '1',
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000)

    const controller = new ConversationController(host)
    const tab = controller.newConversation('e2e')
    const receipt = await controller.promptActive('please write')
    expect(typeof receipt.messageId).toBe('string')
    expect(receipt.messageId.length).toBeGreaterThan(0)

    await waitFor(() => controller.timeline.writeDiffsForSessionTree(tab.sessionId).length > 0, 5_000)

    const rows = timelineTreeItems(controller.timeline.itemsForSessionTree(tab.sessionId))
    expect(rows.some(row => row.kind === 'tool')).toBe(true)
    expect(rows.some(row => row.kind === 'assistant' || row.kind === 'turn')).toBe(true)

    const diffs = controller.timeline.writeDiffsForSessionTree(tab.sessionId)
    const executed: Array<{ command: string; args: unknown[] }> = []
    const contents = new Map<string, string>()
    await openTimelineDiff(
      {
        Uri: {
          parse(value: string) {
            return {
              scheme: value.split(':')[0] ?? '',
              path: value.replace(/^[^:]+:\/\//, '').replace(/^dsh-diff:/, ''),
              toString() {
                return value
              },
            }
          },
          file(path: string) {
            return { scheme: 'file', path, fsPath: path, toString: () => `file://${path}` }
          },
        },
        workspace: {
          registerTextDocumentContentProvider(scheme: string, provider: {
            provideTextDocumentContent(uri: { toString(): string }): string
          }) {
            expect(scheme).toBe('dsh-diff')
            return {
              dispose() {},
              // Capture provider for later open (tests call provide directly via openTimelineDiff internals).
              _provider: provider,
            }
          },
        },
        commands: {
          async executeCommand(command: string, ...args: unknown[]) {
            executed.push({ command, args })
            // Simulate content provider being asked for left side.
            const left = args[0] as { toString(): string }
            if (left !== undefined) {
              contents.set(left.toString(), diffs[0]?.oldText ?? '')
            }
            return undefined
          },
        },
      },
      diffs[0]!,
    )
    expect(executed).toHaveLength(1)
    expect(executed[0]?.command).toBe('vscode.diff')
    expect(String(executed[0]?.args[2] ?? '')).toContain('fake-write.txt')

    // Default is post-hoc only — no mid-run confirm command in package contributes is asserted via constant.
    expect(getWriteDiffEntries).toBeTypeOf('function')
    expect(getTimelineTreeItems).toBeTypeOf('function')

    await host.shutdown()
  })

  it('activate registers timeline + review Diff commands without mid-run write confirm', async () => {
    const commands = new Map<string, (...args: unknown[]) => unknown>()
    const treeViews: string[] = []
    activate(
      { subscriptions: [], extensionPath: dirOrCwd() },
      {
        window: {
          async showErrorMessage() { return undefined },
          async showInformationMessage() { return undefined },
          createTreeView(viewId: string) {
            treeViews.push(viewId)
            return { dispose() {} }
          },
        },
        workspace: { workspaceFolders: [{ uri: { fsPath: dirOrCwd() } }] },
        commands: {
          registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
            commands.set(command, callback)
            return { dispose() {} }
          },
          async executeCommand() { return undefined },
        },
        TreeItem: class {
          label: string
          description?: string
          contextValue?: string
          command?: unknown
          constructor(label: string) {
            this.label = label
          }
        },
        TreeItemCollapsibleState: { None: 0 },
        EventEmitter: class {
          event = {}
          fire() {}
          dispose() {}
        },
        Uri: {
          parse(value: string) {
            return { scheme: 'dsh-diff', path: value, toString: () => value }
          },
          file(path: string) {
            return { scheme: 'file', path, fsPath: path, toString: () => `file://${path}` }
          },
        },
      } as never,
    )

    expect(commands.has('dsh.reviewWorkspaceDiffs')).toBe(true)
    expect(commands.has('dsh.openTimelineDiff')).toBe(true)
    expect(commands.has('dsh.confirmWriteBeforeExecute')).toBe(false)
    expect(treeViews).toContain('dsh.timeline')
  })
})

function dirOrCwd(): string {
  return process.cwd()
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out'))
        return
      }
      setTimeout(poll, 20)
    }
    poll()
  })
}
