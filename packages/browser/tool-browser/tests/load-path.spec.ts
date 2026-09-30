/**
 * REAL-composition tier: a test-only cordis.yml boots through the real Loader,
 * the Include builtin, and this package's module graph. It proves the tools
 * reach a deployment's catalog as the Loader unwraps this plugin's namespace,
 * and that a misconfigured row fails the boot rather than the first tool call.
 * The Loader's module hook serves the mounted packages from source, so the
 * suite never depends on built lib/.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import BrowserRuntime from '@deepseek-ai/dsh-browser'
import * as BrowserPlaywright from '@deepseek-ai/dsh-browser-playwright'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolBrowser from '@deepseek-ai/dsh-tool-browser'

/** The shipped fixture, mounted exactly as a deployment mounts the same rows. */
const FIXTURE = fileURLToPath(new URL('./fixtures/cordis.yml', import.meta.url))

/** Every tool this package contributes to the catalog, sorted. */
const TOOL_NAMES = [
  'browser_click',
  'browser_close',
  'browser_console',
  'browser_navigate',
  'browser_network',
  'browser_press',
  'browser_screenshot',
  'browser_snapshot',
  'browser_trace_start',
  'browser_trace_stop',
  'browser_type',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * The modules the Loader's import hook serves, keyed by the specifiers the
 * fixtures below use. Serving them explicitly keeps the boot on the source
 * plane: bare specifiers would otherwise reach built `lib/`.
 * @returns the specifier-to-module map.
 */
function loaderModules(): Map<string, unknown> {
  return new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-attachment-local', LocalAttachmentStore],
    ['@deepseek-ai/dsh-browser', BrowserRuntime],
    ['@deepseek-ai/dsh-browser-playwright', BrowserPlaywright],
    ['@deepseek-ai/dsh-tool-browser', ToolBrowser],
  ])
}

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
  const modules = loaderModules()
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

/**
 * Write a Loader config into a temporary directory and boot it.
 * @param lines - the entry array to write.
 * @returns the booted context.
 */
async function bootGenerated(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tool-browser-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, `${lines.join('\n')}\n`)
  return await boot(configPath)
}

/** The rows every generated config carries, through the provider row. */
function rows(configLines: readonly string[]): readonly string[] {
  return [
    '- id: system-prompt',
    "  name: '@deepseek-ai/dsh-system-prompt'",
    '- id: tools',
    "  name: '@deepseek-ai/dsh-tools'",
    '- id: browser',
    "  name: '@deepseek-ai/dsh-browser'",
    '  config:',
    '    provider: playwright',
    '- id: browser-playwright',
    "  name: '@deepseek-ai/dsh-browser-playwright'",
    ...configLines,
  ]
}

describe('real Loader composition', () => {
  it('registers the eleven browser tools with non-empty model-facing schemas', async () => {
    const ctx = await boot(FIXTURE)

    const schemas = ctx.tools.schemas()
    expect(schemas.map(schema => schema.name).sort()).toEqual(TOOL_NAMES)
    for (const schema of schemas) {
      expect(schema.description.length, schema.name).toBeGreaterThan(0)
      expect(schema.parameters.type, schema.name).toBe('object')
      expect(Object.keys(schema.parameters).length, schema.name).toBeGreaterThan(0)
    }
    const navigate = schemas.find(schema => schema.name === 'browser_navigate')
    expect(navigate?.parameters).toMatchObject({
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string' } },
    })
  })

  it('fails the boot when the provider row omits its required mode', async () => {
    await expect(bootGenerated(rows([
      '  config:',
      '    allowedOrigins:',
      "      - '*'",
    ]))).rejects.toThrow('$.mode missing required value')
  })

  it('fails the boot when this package rejects its own read bound', async () => {
    await expect(bootGenerated(rows([
      '  config:',
      '    mode: launch',
      '    allowedOrigins:',
      "      - '*'",
      '- id: tool-browser',
      "  name: '@deepseek-ai/dsh-tool-browser'",
      '  config:',
      '    maxConsoleEntries: 0',
    ]))).rejects.toThrow('tool-browser: maxConsoleEntries must be a positive integer')
  })
})
