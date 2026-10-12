/**
 * Real-composition coverage for @deepseek-ai/dsh-path-guard. The tool registry is
 * mounted for real and every case drives an actual `ctx.tools.execute` call, so
 * the guard runs on the same `tools/pre-execute` waterfall it intercepts in
 * production. A recorder listener registered BEFORE the guard wraps it and
 * captures the decision it returns, which is the only way to read the exact
 * approval text without an approval channel in the composition.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import * as pathGuard from '@deepseek-ai/dsh-path-guard'

const testSignal = new AbortController().signal

/** A path outside the workspace root, used as the denied case in every form. */
const OUTSIDE = '/etc/hosts'

/** A tool that echoes the path argument the guard knows how to inspect. */
function pathTool(name: string) {
  return defineContentToolFixture({
    name,
    description: 'echoes its arguments',
    parameters: {},
    execute(args: unknown) {
      return Promise.resolve([{ type: 'text' as const, text: `ran:${JSON.stringify(args)}` }])
    },
  })
}

/** Mount the registry, a decision recorder, and the guard under test. */
async function setup(allowedPaths: string[] = []) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const decisions: PreToolDecision[] = []
  ctx.on('tools/pre-execute', async (_exec, next): Promise<PreToolDecision> => {
    const decision = await next()
    decisions.push(decision)
    return decision
  })
  await ctx.plugin(pathGuard, { allowedPaths })
  return { ctx, decisions }
}

/** Drive one tool call to completion through the real registry. */
function run(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({ callId: ToolCallId('c1'), name, arguments: args, signal: testSignal })
}

describe('path-guard namespace', () => {
  it('exports the function-plugin form and no default export', () => {
    expect(pathGuard.name).toBe('path-guard')
    expect(pathGuard.inject).toEqual(['tools'])
    expect(pathGuard.Config).toBeDefined()
    expect(typeof pathGuard.apply).toBe('function')
    expect('default' in pathGuard).toBe(false)
  })
})

describe('path-guard path arguments', () => {
  it('lets a workspace-internal path through unchanged', async () => {
    const { ctx, decisions } = await setup()
    ctx.tools.register(pathTool('read'))
    const result = await run(ctx, 'read', { file_path: 'src/index.ts' })
    expect(result.isError).toBe(false)
    expect(decisions).toEqual([{ kind: 'allow' }])
  })

  it('treats the workspace root itself as internal', async () => {
    const { ctx } = await setup()
    ctx.tools.register(pathTool('read'))
    expect((await run(ctx, 'read', { file_path: '.' })).isError).toBe(false)
  })

  it('lets a relative path that climbs back inside the workspace through', async () => {
    const { ctx } = await setup()
    ctx.tools.register(pathTool('glob'))
    expect((await run(ctx, 'glob', { path: 'packages/guard/../guard/path-guard/src' })).isError).toBe(false)
  })

  it('asks the user for a single path outside the workspace', async () => {
    const { ctx, decisions } = await setup()
    ctx.tools.register(pathTool('read'))
    const result = await run(ctx, 'read', { file_path: OUTSIDE })
    expect(result.isError).toBe(true)
    expect(decisions).toEqual([{
      kind: 'ask',
      reason: `Tool "read" accesses path outside workspace: ${OUTSIDE}`,
      displayReason: {
        en: `Tool "read" accesses path outside workspace: ${OUTSIDE}`,
        zh: `工具 read 访问工作空间外路径：${OUTSIDE}`,
      },
    }])
  })

  it('checks every tool name in the path-argument table', async () => {
    const { ctx } = await setup()
    for (const name of ['read', 'read_image', 'write', 'edit', 'str_replace_editor', 'glob', 'grep', 'lsp']) {
      ctx.tools.register(pathTool(name))
      const key = name === 'str_replace_editor' || name === 'glob' || name === 'grep' ? 'path' : 'file_path'
      expect((await run(ctx, name, { [key]: OUTSIDE })).isError).toBe(true)
    }
  })

  it('ignores non-string, empty, and missing path arguments', async () => {
    const { ctx } = await setup()
    ctx.tools.register(pathTool('read'))
    expect((await run(ctx, 'read', { file_path: 42 })).isError).toBe(false)
    expect((await run(ctx, 'read', { file_path: '' })).isError).toBe(false)
    expect((await run(ctx, 'read', {})).isError).toBe(false)
  })
})

describe('path-guard shell workdir', () => {
  it('checks a shell tool through its workdir and cwd arguments', async () => {
    const { ctx } = await setup()
    ctx.tools.register(pathTool('bash'))
    expect((await run(ctx, 'bash', { workdir: 'packages' })).isError).toBe(false)
    expect((await run(ctx, 'bash', { workdir: '/etc' })).isError).toBe(true)
    expect((await run(ctx, 'bash', { cwd: '/etc' })).isError).toBe(true)
    expect((await run(ctx, 'bash', { workdir: 42, cwd: '' })).isError).toBe(false)
  })

  it('checks a pwsh workdir the same way', async () => {
    const { ctx } = await setup()
    ctx.tools.register(pathTool('pwsh'))
    expect((await run(ctx, 'pwsh', { cwd: '/etc' })).isError).toBe(true)
  })

  it('summarizes several outside directories as the first one plus a count', async () => {
    const { ctx, decisions } = await setup()
    ctx.tools.register(pathTool('bash'))
    const result = await run(ctx, 'bash', { workdir: '/etc', cwd: '/usr' })
    expect(result.isError).toBe(true)
    expect(decisions).toEqual([{
      kind: 'ask',
      reason: 'Tool "bash" accesses path outside workspace: /etc and 1 more',
      displayReason: {
        en: 'Tool "bash" accesses path outside workspace: /etc and 1 more',
        zh: '工具 bash 访问工作空间外路径：/etc and 1 more',
      },
    }])
  })

  it('ignores a command string that only mentions an outside path', async () => {
    const { ctx } = await setup()
    ctx.tools.register(pathTool('bash'))
    expect((await run(ctx, 'bash', { command: `cat ${OUTSIDE}` })).isError).toBe(false)
  })
})

describe('path-guard whitelist', () => {
  it('lets a path inside a whitelisted root through', async () => {
    const { ctx } = await setup(['/etc'])
    ctx.tools.register(pathTool('read'))
    expect((await run(ctx, 'read', { file_path: OUTSIDE })).isError).toBe(false)
  })

  it('still denies a path outside both the workspace and the whitelist', async () => {
    const { ctx } = await setup(['/usr'])
    ctx.tools.register(pathTool('read'))
    expect((await run(ctx, 'read', { file_path: OUTSIDE })).isError).toBe(true)
  })

  it('honors a whitelist entry that is itself the accessed directory', async () => {
    const { ctx } = await setup(['/etc'])
    ctx.tools.register(pathTool('read'))
    expect((await run(ctx, 'read', { file_path: '/etc' })).isError).toBe(false)
  })
})

describe('path-guard argument forms', () => {
  it('leaves a tool with no known path argument unchecked', async () => {
    const { ctx } = await setup()
    ctx.tools.register(pathTool('web_search'))
    expect((await run(ctx, 'web_search', { query: OUTSIDE })).isError).toBe(false)
  })

  it('treats a payload that is not a keyed object as having no paths', async () => {
    const { ctx, decisions } = await setup()
    ctx.tools.register(pathTool('read'))
    // Every form reaches the guard, which finds no path field and delegates. The
    // registry rejects `null` and an array later in its own validation, so only
    // the decision is asserted here.
    for (const args of [null, [OUTSIDE], `file_path=${OUTSIDE}`, 42]) {
      const before = decisions.length
      await run(ctx, 'read', args)
      expect(decisions.length, JSON.stringify(args)).toBe(before + 1)
      expect(decisions.at(-1)).toEqual({ kind: 'allow' })
    }
  })
})
