import { ChatPanelHost, FakeWebviewPort, buildThinChatHtml } from '../src/chat-panel/index.ts'
import { SelectionMetaStore, askAboutSelection, assertEveryRefReadBeforeFinalAnswer, buildPointerText, extractAtPathTokens, extractAtPaths, formatOfficialAtPath, pathsFromReadToolArgs, planReferenceOpen, readArgsCoverPath, validateComposerAtPaths } from '../src/code-context/index.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { FILE_REFERENCE_PROMPT } from '@deepseek-ai/dsh-file-reference'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

describe('cap:code-context — @path resolution, references, and selection context', () => {
  describe('phase1-code-context.spec.ts', () => {
    const roots: string[] = []

    afterEach(() => {
      while (roots.length > 0) {
        const root = roots.pop()
        if (root !== undefined) rmSync(root, { recursive: true, force: true })
      }
    })

    function tempWorkspace(files: Record<string, string>): string {
      const root = mkdtempSync(join(tmpdir(), 'dsh-ccd-phase1-'))
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
          return 'msg-1'
        },
        async disposeSession() {},
      } as unknown as IdeSessionHost
    }

    describe('phase-1 @path grammar + resolve (P1-2 / P1-3)', () => {
      it('CAP-CODE-CONTEXT-001 extracts plain and quoted tokens; NL suffix is not part of path', () => {
        const tokens = extractAtPathTokens('@src/foo.ts 的 3-40 行 and @"my file.ts" 的 1 行')
        expect(tokens.map(t => t.path)).toEqual(['src/foo.ts', 'my file.ts'])
        expect(extractAtPaths('@src/a.ts @src/a.ts')).toEqual(['src/a.ts'])
        expect(formatOfficialAtPath('src/my file.ts')).toBe('@"src/my file.ts"')
        expect(formatOfficialAtPath('src/foo.ts')).toBe('@src/foo.ts')
      })

      it('CAP-CODE-CONTEXT-002 does not treat email-like @ as a file token', () => {
        expect(extractAtPaths('ping user@example.com please')).toEqual([])
      })

      it('CAP-CODE-CONTEXT-003 rejects not-found / outside-workspace / ambiguous-root; never unreadable', () => {
        const rootA = tempWorkspace({ 'src/a.ts': 'a' })
        const rootB = tempWorkspace({ 'src/a.ts': 'a-b', 'only-b.ts': 'b' })
        const ok = validateComposerAtPaths('@src/a.ts please', {
          workspaceFolders: [rootA],
        })
        expect(ok).toEqual({ ok: true, paths: ['src/a.ts'] })

        const missing = validateComposerAtPaths('@missing.ts', { workspaceFolders: [rootA] })
        expect(missing).toMatchObject({ ok: false, reason: 'not-found' })

        const outside = validateComposerAtPaths(`@${join(tmpdir(), 'nope-outside.ts')}`, {
          workspaceFolders: [rootA],
        })
        expect(outside).toMatchObject({ ok: false, reason: 'outside-workspace' })

        const ambiguous = validateComposerAtPaths('@src/a.ts', {
          workspaceFolders: [rootA, rootB],
        })
        expect(ambiguous).toMatchObject({ ok: false, reason: 'ambiguous-root' })

        const preferred = validateComposerAtPaths('@src/a.ts', {
          workspaceFolders: [rootA, rootB],
          preferredFolder: rootB,
        })
        expect(preferred).toEqual({ ok: true, paths: ['src/a.ts'] })

        // P1-2: reason union must not include unreadable
        if (!missing.ok) {
          expect(['not-found', 'outside-workspace', 'ambiguous-root']).toContain(missing.reason)
          expect(missing.reason).not.toBe('unreadable')
        }
      })

      it('CAP-CODE-CONTEXT-004 spaces-path L2 fixture: quoted token validates when file exists', () => {
        const root = tempWorkspace({ 'docs/design notes.md': '# notes' })
        const text = '@"docs/design notes.md" 的 1-2 行'
        expect(extractAtPaths(text)).toEqual(['docs/design notes.md'])
        expect(validateComposerAtPaths(text, { workspaceFolders: [root] }))
          .toEqual({ ok: true, paths: ['docs/design notes.md'] })
      })
    })

    describe('phase-1 Host send gate — pointer only, no body inject', () => {
      it('CAP-CODE-CONTEXT-005 accepts valid @path as-is and rejects invalid without reading content into prompt', async () => {
        const root = tempWorkspace({
          'src/ok.ts': 'SECRET_BODY_SHOULD_NOT_APPEAR',
          'src/other.ts': 'other',
        })
        const prompts: string[] = []
        const host = connectedHost(prompts)
        const controller = new ConversationController(host)
        controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          getAtPathResolveOptions: () => ({ workspaceFolders: [root] }),
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)

        const accepted = await panel.sendPrompt('@src/ok.ts 这段怎么改？')
        expect(accepted.ok).toBe(true)
        expect(prompts).toEqual(['@src/ok.ts 这段怎么改？'])
        expect(prompts[0]).not.toContain('SECRET_BODY')
        expect(controller.messages.get(controller.registry.getActive()!.sessionId)[0]?.text)
          .toBe('@src/ok.ts 这段怎么改？')

        panel.clearOutboundLog()
        const rejected = await panel.sendPrompt('@nope.ts')
        expect(rejected).toEqual({ ok: false, reason: 'not-found' })
        expect(panel.getOutboundLog().some(m => m.type === 'ui/reject-send' && m.reason === 'not-found')).toBe(true)
        expect(prompts).toHaveLength(1)
      })

      it('CAP-CODE-CONTEXT-006 plain send without @ still works (regression)', async () => {
        const prompts: string[] = []
        const host = connectedHost(prompts)
        const controller = new ConversationController(host)
        controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          getAtPathResolveOptions: () => ({ workspaceFolders: [tempWorkspace({})] }),
        })
        const result = await panel.sendPrompt('hello without refs')
        expect(result.ok).toBe(true)
        expect(prompts).toEqual(['hello without refs'])
      })
    })

    describe('phase-1 selection ask (AD-CCD-12)', () => {
      it('CAP-CODE-CONTEXT-007 empty selection notices and does not prefill', async () => {
        const notices: string[] = []
        const prefills: string[] = []
        const meta = new SelectionMetaStore()
        const root = tempWorkspace({ 'a.ts': 'x' })
        const result = await askAboutSelection({
          getActiveEditor: () => ({
            document: {
              uri: { fsPath: join(root, 'a.ts') },
              isDirty: false,
              save: () => true,
              languageId: 'typescript',
            },
            selection: {
              isEmpty: true,
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          }),
          getWorkspaceFolders: () => [root],
          ensureLiveTab: () => ({ tabId: 't', sessionId: 's', mode: 'live' }),
          prefillComposer: (text) => { prefills.push(text) },
          notify: (text) => { notices.push(text) },
          selectionMeta: meta,
        })
        expect(result).toEqual({ ok: false, reason: 'empty-selection' })
        expect(prefills).toEqual([])
        expect(notices.some(n => n.includes('选中'))).toBe(true)
      })

      it('CAP-CODE-CONTEXT-008 dirty save failure blocks prefill; success prefills official token + NL range without body', async () => {
        const root = tempWorkspace({ 'src/my file.ts': 'LINE_BODY_SECRET' })
        const meta = new SelectionMetaStore()
        const prefills: string[] = []
        let saveCalls = 0

        const fail = await askAboutSelection({
          getActiveEditor: () => ({
            document: {
              uri: { fsPath: join(root, 'src/my file.ts') },
              isDirty: true,
              save: () => {
                saveCalls += 1
                return false
              },
              languageId: 'typescript',
            },
            selection: {
              isEmpty: false,
              start: { line: 2, character: 0 },
              end: { line: 4, character: 5 },
            },
          }),
          getWorkspaceFolders: () => [root],
          ensureLiveTab: () => ({ tabId: 't', sessionId: 's', mode: 'live' }),
          prefillComposer: (text) => { prefills.push(text) },
          notify: () => {},
          selectionMeta: meta,
        })
        expect(fail).toEqual({ ok: false, reason: 'save-failed' })
        expect(saveCalls).toBe(1)
        expect(prefills).toEqual([])

        const ok = await askAboutSelection({
          getActiveEditor: () => ({
            document: {
              uri: { fsPath: join(root, 'src/my file.ts') },
              isDirty: true,
              save: () => {
                saveCalls += 1
                return true
              },
              languageId: 'typescript',
            },
            selection: {
              isEmpty: false,
              start: { line: 2, character: 0 },
              end: { line: 4, character: 5 },
            },
          }),
          getWorkspaceFolders: () => [root],
          ensureLiveTab: () => ({ tabId: 't', sessionId: 's', mode: 'live' }),
          prefillComposer: (text) => { prefills.push(text) },
          notify: () => {},
          selectionMeta: meta,
        })
        expect(ok.ok).toBe(true)
        if (ok.ok) {
          expect(ok.pointerText).toBe('@"src/my file.ts" 的 3-5 行')
          expect(ok.pointerText).not.toContain('LINE_BODY')
          expect(ok.pointerText).not.toContain('typescript')
          expect(prefills).toEqual([ok.pointerText])
          expect(meta.get('src/my file.ts')).toEqual({
            path: 'src/my file.ts',
            startLine: 3,
            endLine: 5,
          })
        }
      })

      it('CAP-CODE-CONTEXT-009 replay active Tab forces a new live Tab before prefill', async () => {
        const root = tempWorkspace({ 'a.ts': 'x' })
        const prompts: string[] = []
        const host = connectedHost(prompts)
        const controller = new ConversationController(host)
        const live = controller.newConversation('live')
        await controller.promptTab(live.tabId, 'history')
        const replay = controller.registry.create('replay', undefined, 'replay')
        expect(controller.registry.getActive()?.mode).toBe('replay')
        expect(replay.mode).toBe('replay')

        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        const meta = new SelectionMetaStore()
        const modes: string[] = []

        const result = await askAboutSelection({
          getActiveEditor: () => ({
            document: {
              uri: { fsPath: join(root, 'a.ts') },
              isDirty: false,
              save: () => true,
            },
            selection: {
              isEmpty: false,
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          }),
          getWorkspaceFolders: () => [root],
          ensureLiveTab: () => {
            const active = controller.registry.getActive()
            if (active !== undefined && active.mode === 'live') {
              modes.push('reuse-live')
              return { tabId: active.tabId, sessionId: active.sessionId, mode: 'live' }
            }
            const next = controller.newConversation('from-selection')
            modes.push(next.mode)
            panel.pushFullState()
            return { tabId: next.tabId, sessionId: next.sessionId, mode: 'live' }
          },
          prefillComposer: (text) => { panel.prefillComposer(text) },
          notify: () => {},
          selectionMeta: meta,
        })
        expect(result.ok).toBe(true)
        expect(modes).toEqual(['live'])
        expect(controller.registry.getActive()?.mode).toBe('live')
        expect(fake.receivedFromHost.some(m => m.type === 'composer/prefill')).toBe(true)
        // Sending to the previous replay Tab is rejected by Host gate.
        controller.registry.switchTo(replay.tabId)
        const rejected = await panel.sendPrompt('should fail on replay')
        expect(rejected).toEqual({ ok: false, reason: 'replay' })
      })
    })

    describe('phase-1 read coverage stub (AD-CCD-14 / P2-A file_path)', () => {
      // Stub ≠ true-model: these fixtures assert covering-path rule on log samples only.
      it('CAP-CODE-CONTEXT-010 P2-A: pathsFromReadToolArgs prefers file_path and aliases', () => {
        expect(pathsFromReadToolArgs({ file_path: 'src/a.ts' })).toEqual(['src/a.ts'])
        expect(pathsFromReadToolArgs({ path: 'x', file: 'y', target: 'z' })).toEqual(['x', 'y', 'z'])
        expect(readArgsCoverPath(['src/a.ts'], 'src/a.ts')).toBe(true)
        expect(readArgsCoverPath(['src'], 'src/a.ts')).toBe(false)
      })

      it('CAP-CODE-CONTEXT-011 ① single ref without read before final answer → fail', () => {
        const result = assertEveryRefReadBeforeFinalAnswer(
          [
            { type: 'assistant/message' },
          ],
          '@src/a.ts 请解释',
        )
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.missing).toEqual(['src/a.ts'])
      })

      it('CAP-CODE-CONTEXT-012 ② two paths, only one covered → fail', () => {
        const result = assertEveryRefReadBeforeFinalAnswer(
          [
            { type: 'tool/call', name: 'read', args: { file_path: 'src/a.ts' } },
            { type: 'assistant/message' },
          ],
          '@src/a.ts @src/b.ts',
        )
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.missing).toEqual(['src/b.ts'])
      })

      it('CAP-CODE-CONTEXT-013 ③ both paths covered (any order) → pass', () => {
        const result = assertEveryRefReadBeforeFinalAnswer(
          [
            { type: 'tool/call', name: 'read', args: { file_path: 'src/b.ts' } },
            { type: 'tool/call', name: 'read', args: { file_path: 'src/a.ts' } },
            { type: 'assistant/message' },
          ],
          '@src/a.ts @src/b.ts',
        )
        expect(result.ok).toBe(true)
      })

      it('CAP-CODE-CONTEXT-014 ④ same path twice in text needs only one covering read', () => {
        const result = assertEveryRefReadBeforeFinalAnswer(
          [
            { type: 'tool/call', name: 'read', args: { file_path: 'src/a.ts' } },
            { type: 'assistant/message' },
          ],
          '@src/a.ts 前面 @src/a.ts 后面',
        )
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.paths).toEqual(['src/a.ts'])
      })

      it('CAP-CODE-CONTEXT-015 ⑤ fake read args that cannot map to path → fail', () => {
        const result = assertEveryRefReadBeforeFinalAnswer(
          [
            { type: 'tool/call', name: 'read', args: { query: 'src/a.ts' } },
            { type: 'assistant/message' },
          ],
          '@src/a.ts',
        )
        expect(result.ok).toBe(false)
      })

      it('CAP-CODE-CONTEXT-016 read after final assistant does not count', () => {
        const result = assertEveryRefReadBeforeFinalAnswer(
          [
            { type: 'assistant/message' },
            { type: 'tool/call', name: 'read', args: { file_path: 'src/a.ts' } },
          ],
          '@src/a.ts',
        )
        expect(result.ok).toBe(false)
      })
    })

    describe('phase-1 ide mount + reference cards', () => {
      it('CAP-CODE-CONTEXT-017 ide cordis.patch.yml pre-mounts file-reference-local', () => {
        const root = fileURLToPath(new URL('../../../packages/bundle/ide', import.meta.url))
        const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
        expect(patch).toContain("name: '@deepseek-ai/dsh-file-reference-local'")
        expect(patch).toContain('id: file-reference-local')
        const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>
        }
        expect(pkg.dependencies).toHaveProperty('@deepseek-ai/dsh-file-reference-local')
        // Assembled prompt guidance constant is the product text (provider installs it when read exists).
        expect(FILE_REFERENCE_PROMPT).toContain('Tokens prefixed with @')
        expect(FILE_REFERENCE_PROMPT).toContain('use the read tool')
      })

      it('CAP-CODE-CONTEXT-018 agent-loop is not modified by this phase (static guard)', () => {
        // Soft guard: implementation must not import agent-loop from vscode-dsh or ide patch.
        const vscodePkg = JSON.parse(
          readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
        ) as { dependencies?: Record<string, string> }
        expect(vscodePkg.dependencies ?? {}).not.toHaveProperty('@deepseek-ai/dsh-agent-loop')
      })

      it('CAP-CODE-CONTEXT-019 thin chat HTML renders ref-cards and composer/prefill handler', () => {
        const html = buildThinChatHtml('csp-nonce-test')
        expect(html).toContain('ref-card')
        expect(html).toContain('action/open-reference')
        expect(html).toContain('composer/prefill')
        expect(html).toContain('renderUserTextWithRefCards')
      })

      it('CAP-CODE-CONTEXT-020 buildPointerText uses quoted form for whitespace paths', () => {
        expect(buildPointerText('src/foo.ts', 1, 3)).toBe('@src/foo.ts 的 1-3 行')
        expect(buildPointerText('a b.ts', 2, 2)).toBe('@"a b.ts" 的 2 行')
      })
    })

    describe('phase-1 polish — multi-root open + cold-start prefill', () => {
      it('CAP-CODE-CONTEXT-021 planReferenceOpen scans all roots like the send gate (GAP-CCD-012)', () => {
        const rootA = tempWorkspace({ 'shared/a.ts': 'A' })
        const rootB = tempWorkspace({ 'only-in-b.ts': 'B_BODY' })

        const gate = validateComposerAtPaths('@only-in-b.ts', {
          workspaceFolders: [rootA, rootB],
          preferredFolder: rootA,
        })
        expect(gate).toEqual({ ok: true, paths: ['only-in-b.ts'] })

        // Preferred = rootA (file not there); open must still resolve under rootB.
        const plan = planReferenceOpen('only-in-b.ts', {
          workspaceFolders: [rootA, rootB],
          preferredFolder: rootA,
        })
        expect(plan.ok).toBe(true)
        if (plan.ok) {
          expect(plan.abs).toBe(resolve(join(rootB, 'only-in-b.ts')))
          expect(plan.path).toBe('only-in-b.ts')
        }

        const preferredOnly = resolve(join(rootA, 'only-in-b.ts'))
        expect(existsSync(preferredOnly)).toBe(false)
        if (plan.ok) expect(existsSync(plan.abs)).toBe(true)
      })

      it('CAP-CODE-CONTEXT-022 planReferenceOpen uses SelectionMetaStore lines, not NL ( open hook)', () => {
        const root = tempWorkspace({ 'src/x.ts': 'line1\nline2\nline3\n' })
        const meta = new SelectionMetaStore()
        meta.set({ path: 'src/x.ts', startLine: 10, endLine: 20 })
        const plan = planReferenceOpen(
          'src/x.ts',
          { workspaceFolders: [root], preferredFolder: root },
          meta,
        )
        expect(plan.ok).toBe(true)
        if (plan.ok) {
          expect(plan.abs).toBe(resolve(join(root, 'src/x.ts')))
          expect(plan.selection).toEqual({
            start: { line: 9, character: 0 },
            end: { line: 19, character: 0 },
          })
          // NL in a message would say 3-40; open must not use that.
          expect(plan.selection.start.line).not.toBe(2)
        }
      })

      it('CAP-CODE-CONTEXT-023 prefillComposer before attach is replayed on attach (GAP-CCD-013)', () => {
        const prompts: string[] = []
        const host = connectedHost(prompts)
        const controller = new ConversationController(host)
        controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        panel.prefillComposer('@src/a.ts 的 1 行')
        panel.prefillComposer('@src/b.ts 的 2 行') // latest wins
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        const prefills = fake.receivedFromHost.filter(m => m.type === 'composer/prefill')
        expect(prefills).toHaveLength(1)
        expect(prefills[0]).toEqual({ type: 'composer/prefill', text: '@src/b.ts 的 2 行' })
      })
    })
  })

})
