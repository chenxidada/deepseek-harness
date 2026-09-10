/**
 * Verifier-owned independent scenarios for phase-1-code-context.
 * Does NOT reuse implementer assertions as the sole proof — designs new cases.
 *
 * Note: AC-3a L2 stub asserts session-log coverage; it is NOT a live-model guarantee.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  askAboutSelection,
  assertEveryRefReadBeforeFinalAnswer,
  extractAtPaths,
  normalizePathKey,
  pathsFromReadToolArgs,
  planReferenceOpen,
  readArgsCoverPath,
  resolveAtPathInWorkspace,
  SelectionMetaStore,
  validateComposerAtPaths,
} from '../../../../../../apps/vscode-dsh/src/code-context/index.ts'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ccd-v1-'))
  roots.push(root)
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body, 'utf8')
  }
  return root
}

function connectedHost(prompts: string[]): IdeSessionHost {
  return {
    status: 'connected' as const,
    interactions: { failClosedSession() {}, listPending() { return [] } },
    setConversationRegistry() {},
    onNotification() { return () => {} },
    async prompt(_sessionId: string, blocks: { text?: string }[]) {
      prompts.push(blocks[0]?.text ?? '')
      return 'msg-v'
    },
    async disposeSession() {},
  } as unknown as IdeSessionHost
}

describe('verifier independent — AC-1 clean doc + e2e prefill→gate→send', () => {
  it('non-dirty selection prefills pointer; Host send keeps pointer-only (no body)', async () => {
    const root = tempWorkspace({ 'lib/core.ts': 'export const SECRET_SHOULD_NOT_LEAVE=1\n' })
    const meta = new SelectionMetaStore()
    const prefills: string[] = []
    let saveCalls = 0

    const ask = await askAboutSelection({
      getActiveEditor: () => ({
        document: {
          uri: { fsPath: join(root, 'lib/core.ts') },
          isDirty: false,
          save: () => {
            saveCalls += 1
            return true
          },
          languageId: 'typescript',
        },
        selection: {
          isEmpty: false,
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
      }),
      getWorkspaceFolders: () => [root],
      ensureLiveTab: () => ({ tabId: 't', sessionId: 's', mode: 'live' }),
      prefillComposer: (text) => { prefills.push(text) },
      notify: () => {},
      selectionMeta: meta,
    })

    expect(ask.ok).toBe(true)
    expect(saveCalls).toBe(0) // clean doc → no save
    if (!ask.ok) return
    expect(ask.pointerText).toBe('@lib/core.ts 的 1 行')
    expect(ask.pointerText).not.toContain('SECRET')
    expect(prefills).toEqual([ask.pointerText])
    expect(meta.get('lib/core.ts')?.startLine).toBe(1)

    // E2E Host gate: send prefilled text + user question → acceptSend pointer only
    const prompts: string[] = []
    const host = connectedHost(prompts)
    const controller = new ConversationController(host)
    controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      getAtPathResolveOptions: () => ({ workspaceFolders: [root] }),
    })
    const sendText = `${ask.pointerText} 这段做什么？`
    const result = await panel.sendPrompt(sendText)
    expect(result.ok).toBe(true)
    expect(prompts).toEqual([sendText])
    expect(prompts[0]).not.toContain('SECRET_SHOULD_NOT_LEAVE')
    const stored = controller.messages.get(controller.registry.getActive()!.sessionId)[0]?.text
    expect(stored).toBe(sendText)
    expect(stored).not.toContain('SECRET')
  })
})

describe('verifier independent — AC-3 spaces path through Host gate', () => {
  it('quoted spaces path + NL range validates and sends as-is', async () => {
    const root = tempWorkspace({ 'notes/my design.md': '# BODY_MUST_NOT_INJECT\n' })
    const prompts: string[] = []
    const host = connectedHost(prompts)
    const controller = new ConversationController(host)
    controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      getAtPathResolveOptions: () => ({ workspaceFolders: [root] }),
    })
    const text = '@"notes/my design.md" 的 1-3 行 请总结'
    expect(extractAtPaths(text)).toEqual(['notes/my design.md'])
    const gate = validateComposerAtPaths(text, { workspaceFolders: [root] })
    expect(gate).toEqual({ ok: true, paths: ['notes/my design.md'] })
    const sent = await panel.sendPrompt(text)
    expect(sent.ok).toBe(true)
    expect(prompts[0]).toBe(text)
    expect(prompts[0]).not.toContain('BODY_MUST_NOT_INJECT')
  })
})

describe('verifier independent — AC-3a scenarios implementer did not write', () => {
  it('alias field `path` (not file_path) still covers reference', () => {
    const result = assertEveryRefReadBeforeFinalAnswer(
      [
        { type: 'tool/call', name: 'read', args: { path: 'src/alias.ts' } },
        { type: 'assistant/message' },
      ],
      '@src/alias.ts',
    )
    expect(result.ok).toBe(true)
  })

  it('N-2 anchor uses LAST assistant/message; earlier assistant does not close window', () => {
    const result = assertEveryRefReadBeforeFinalAnswer(
      [
        { type: 'assistant/message' }, // intermediate
        { type: 'tool/call', name: 'read', args: { file_path: 'src/a.ts' } },
        { type: 'assistant/message' }, // final
      ],
      '@src/a.ts',
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.finalAssistantIndex).toBe(2)
  })

  it('whole-file read with offset/limit still covers (AD-CCD-15)', () => {
    const result = assertEveryRefReadBeforeFinalAnswer(
      [
        {
          type: 'tool/call',
          name: 'read',
          args: { file_path: 'src/a.ts', offset: 1, limit: 500 },
        },
        { type: 'assistant/message' },
      ],
      '@src/a.ts',
    )
    expect(result.ok).toBe(true)
  })

  it('quoted spaces path covered when read args use same path', () => {
    const result = assertEveryRefReadBeforeFinalAnswer(
      [
        { type: 'tool/call', name: 'read', args: { file_path: 'docs/my notes.md' } },
        { type: 'assistant/message' },
      ],
      '@"docs/my notes.md" 的 2-9 行',
    )
    expect(result.ok).toBe(true)
  })

  it('parameter variation: pathsFromReadToolArgs is not a constant stub', () => {
    const a = pathsFromReadToolArgs({ file_path: 'one.ts' })
    const b = pathsFromReadToolArgs({ file_path: 'two.ts' })
    const c = pathsFromReadToolArgs({ query: 'one.ts' })
    expect(a).toEqual(['one.ts'])
    expect(b).toEqual(['two.ts'])
    expect(a).not.toEqual(b)
    expect(c).toEqual([])
    expect(readArgsCoverPath(['src/'], 'src/a.ts')).toBe(false)
    expect(readArgsCoverPath(['src/'], 'src/a.ts', { allowDirectoryPrefix: true })).toBe(true)
  })
})

describe('verifier independent — AC-4 meta open semantics (L2)', () => {
  it('SelectionMetaStore drives 0-based selection; NL range is never parsed from text', () => {
    const store = new SelectionMetaStore()
    store.set({ path: 'src/x.ts', startLine: 10, endLine: 20 })
    const meta = store.get('src/x.ts')
    expect(meta).toEqual({ path: normalizePathKey('src/x.ts'), startLine: 10, endLine: 20 })

    // Mirror openReferencePath selection conversion (extension.ts) — meta only.
    const selection = meta === undefined
      ? undefined
      : {
        start: { line: Math.max(0, meta.startLine - 1), character: 0 },
        end: { line: Math.max(0, meta.endLine - 1), character: 0 },
      }
    expect(selection).toEqual({
      start: { line: 9, character: 0 },
      end: { line: 19, character: 0 },
    })

    // Prove we do not parse NL from message text for line numbers.
    const messageText = '@src/x.ts 的 3-40 行'
    const nlMatch = /的\s*(\d+)\s*-\s*(\d+)\s*行/.exec(messageText)
    expect(nlMatch?.[1]).toBe('3')
    // Open path MUST use meta (10-20), not NL (3-40)
    expect(selection!.start.line).not.toBe(Number(nlMatch![1]) - 1)
    expect(selection!.start.line).toBe(9)
  })

  it('Host forwards action/open-reference to requestOpenReference with path only', async () => {
    const opened: string[] = []
    const prompts: string[] = []
    const host = connectedHost(prompts)
    const controller = new ConversationController(host)
    controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      requestOpenReference: async (path) => { opened.push(path) },
    })
    await panel.handleWebviewMessage({ type: 'action/open-reference', path: 'src/x.ts' })
    expect(opened).toEqual(['src/x.ts'])
  })
})

describe('verifier independent — known Should-Fix boundary probes', () => {
  it('multi-root: open aligns with gate resolve when preferred misses (GAP-CCD-012 closed)', () => {
    const rootA = tempWorkspace({ 'shared/a.ts': 'A' })
    const rootB = tempWorkspace({ 'only-in-b.ts': 'B_BODY' })

    const ok = validateComposerAtPaths('@only-in-b.ts', {
      workspaceFolders: [rootA, rootB],
      preferredFolder: rootB,
    })
    expect(ok).toEqual({ ok: true, paths: ['only-in-b.ts'] })

    // Preferred = rootA (active editor in A) — open must still find rootB via scan.
    const plan = planReferenceOpen('only-in-b.ts', {
      workspaceFolders: [rootA, rootB],
      preferredFolder: rootA,
    })
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.abs).toBe(resolve(join(rootB, 'only-in-b.ts')))
      expect(existsSync(plan.abs)).toBe(true)
    }
    expect(existsSync(resolve(join(rootA, 'only-in-b.ts')))).toBe(false)
  })

  it('cold-start: prefill before attach is replayed on attach() (GAP-CCD-013 closed)', () => {
    const prompts: string[] = []
    const host = connectedHost(prompts)
    const controller = new ConversationController(host)
    controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    panel.prefillComposer('@src/a.ts 的 1 行')
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    const prefills = fake.receivedFromHost.filter(m => m.type === 'composer/prefill')
    expect(prefills).toEqual([{ type: 'composer/prefill', text: '@src/a.ts 的 1 行' }])
  })

  // NEW polish probe (implementer suite does not assert latest-wins + clear-on-replay)
  it('cold-start: multiple prefills before attach replay ONLY latest, then clear (GAP-CCD-013)', () => {
    const prompts: string[] = []
    const host = connectedHost(prompts)
    const controller = new ConversationController(host)
    controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    panel.prefillComposer('@old.ts 的 1 行')
    panel.prefillComposer('@new.ts 的 2 行')
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    const prefills = fake.receivedFromHost.filter(m => m.type === 'composer/prefill')
    expect(prefills).toEqual([{ type: 'composer/prefill', text: '@new.ts 的 2 行' }])

    // Second attach must not re-fire stale pendingPrefill
    const fake2 = new FakeWebviewPort()
    panel.attach(fake2)
    expect(fake2.receivedFromHost.filter(m => m.type === 'composer/prefill')).toEqual([])
  })

  // NEW: gate accepts path only in non-preferred root + meta lines drive open plan
  it('multi-root: gate+open+meta when path only in non-preferred root (GAP-CCD-012 e2e)', () => {
    const rootA = tempWorkspace({ 'a-only.ts': 'A' })
    const rootB = tempWorkspace({ 'b-only.ts': 'B_SECRET' })
    const meta = new SelectionMetaStore()
    meta.set({ path: 'b-only.ts', startLine: 5, endLine: 8 })

    // Gate: preferred=rootB finds it; also succeeds when preferred=rootA via full scan
    expect(validateComposerAtPaths('@b-only.ts', {
      workspaceFolders: [rootA, rootB],
      preferredFolder: rootA,
    })).toEqual({ ok: true, paths: ['b-only.ts'] })

    const plan = planReferenceOpen(
      'b-only.ts',
      { workspaceFolders: [rootA, rootB], preferredFolder: rootA },
      meta,
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.abs).toBe(resolve(join(rootB, 'b-only.ts')))
    expect(plan.selection).toEqual({
      start: { line: 4, character: 0 },
      end: { line: 7, character: 0 },
    })
  })
})

describe('verifier independent — DEBT-CCD-002 stub ≠ true-model docs', () => {
  it('ref-read-coverage module header + phase1 test header state stub ≠ true-model', async () => {
    const { readFileSync } = await import('node:fs')
    const cov = readFileSync(
      resolve('apps/vscode-dsh/src/code-context/ref-read-coverage.ts'),
      'utf8',
    )
    const testHeader = readFileSync(
      resolve('apps/vscode-dsh/tests/phase1-code-context.spec.ts'),
      'utf8',
    ).slice(0, 1200)
    expect(cov).toMatch(/Stub\s*≠\s*true-model|stub\s*≠\s*true-model|NOT a live-model/i)
    expect(cov).toMatch(/runtime guarantee/i)
    expect(testHeader).toMatch(/stub\s*≠\s*true-model|Stub\s*≠\s*true-model/i)
    expect(testHeader).toMatch(/runtime guarantee/i)
  })
})

describe('verifier independent — P1-2 / resolve static contract', () => {
  it('resolve reasons never include unreadable; unreadable file still ok if exists', () => {
    const root = tempWorkspace({ 'locked.ts': 'x' })
    const result = resolveAtPathInWorkspace('locked.ts', {
      workspaceFolders: [root],
      // Existence-only probe — gate must not attempt content read
      exists: (abs) => existsSync(abs),
    })
    expect(result.ok).toBe(true)
    const missing = resolveAtPathInWorkspace('gone.ts', { workspaceFolders: [root] })
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.reason).not.toBe('unreadable' as typeof missing.reason)
      expect(['not-found', 'outside-workspace', 'ambiguous-root']).toContain(missing.reason)
    }
  })
})
