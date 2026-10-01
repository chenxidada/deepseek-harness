/**
 * REAL-composition tier (packages/AGENTS.md): the browser seam and this
 * provider boot from a test-only cordis.yml through the real Loader + Include
 * path, and a session opened through `ctx.browser` runs on the page the
 * provider acquired. The same composition with a broken config fails the boot
 * rather than the first session.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import BrowserRuntime from '@deepseek-ai/dsh-browser'
import type { BrowserSessionKey } from '@deepseek-ai/dsh-browser'
import * as plugin from '../src/index.ts'
import { fakePlaywright, resetFakePlaywright } from './fake-playwright.ts'

vi.mock('playwright-core', () => fakePlaywright)

/** Provider row the shipped fixture uses: a path relative to that file. */
const FIXTURE_PROVIDER_SPECIFIER = '../../src/index.ts'

/** Provider row generated configs use: the absolute location of this package's entry. */
const PROVIDER_URL = new URL('../src/index.ts', import.meta.url).href

/** The shipped fixture. */
const FIXTURE = fileURLToPath(new URL('./fixtures/cordis.yml', import.meta.url))

/** Conversation identity the session under test is opened under. */
const KEY = 'loader-composition' as BrowserSessionKey

let root: string | undefined
let context: Context | undefined

beforeEach(() => { resetFakePlaywright() })

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a Loader config through the real Loader, the Include builtin, and this
 * package's module graph.
 * @param configPath - the cordis.yml to boot.
 * @returns the booted context.
 */
async function boot(configPath: string): Promise<Context> {
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(`${dirname(configPath)}/`).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  // The custom importer bypasses Node resolution, so it serves exactly the
  // specifiers the configs below use.
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-browser', BrowserRuntime],
    [FIXTURE_PROVIDER_SPECIFIER, plugin],
    [PROVIDER_URL, plugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  // `loader.await()` only settles the row tree; each entry's own fiber carries
  // its import/apply outcome, so a broken row surfaces only when awaited.
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

/**
 * Write a Loader config into a temporary directory and boot it.
 * @param lines - the entry array to write.
 * @returns the booted context.
 */
async function bootGenerated(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-browser-playwright-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, `${lines.join('\n')}\n`)
  return await boot(configPath)
}

/** The browser and provider rows every generated config carries. */
function rows(configLines: readonly string[]): readonly string[] {
  return [
    '- id: browser',
    "  name: '@deepseek-ai/dsh-browser'",
    '- id: browser-playwright',
    `  name: '${PROVIDER_URL}'`,
    ...configLines,
  ]
}

describe('real Loader composition', () => {
  it('boots the shipped fixture and opens a session on the provider it registered', async () => {
    const ctx = await boot(FIXTURE)

    const session = await ctx.browser.session(KEY)
    expect(session.key).toBeTruthy()
    await expect(session.act({ kind: 'press', key: 'Tab' }))
      .resolves.toEqual({ url: 'https://example.com/', title: 'Example', snapshot: null })
    expect(fakePlaywright.chromium.launch).toHaveBeenCalledWith({ headless: true })

    await session.close()
    expect(fakePlaywright.chromium.fixture.browser.close).toHaveBeenCalledTimes(1)
  })

  it('fails the boot when the config omits the required mode', async () => {
    await expect(bootGenerated(rows([]))).rejects.toThrow('$.mode missing required value')
  })

  it('fails the boot when attach mode names no endpoint', async () => {
    await expect(bootGenerated(rows([
      '  config:',
      '    mode: attach',
      '    allowedOrigins:',
      "      - '*'",
    ]))).rejects.toThrow('browser-playwright: attach mode requires exactly one of cdpEndpoint or endpoint')
  })

  it('fails the boot when the trace directory is blank', async () => {
    await expect(bootGenerated(rows([
      '  config:',
      '    mode: launch',
      '    allowedOrigins:',
      "      - '*'",
      "    traceDir: ''",
    ]))).rejects.toThrow('browser-playwright: traceDir must be a non-empty string')
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in plugin).toBe(false)
  })
})
