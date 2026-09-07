/**
 * SpecDev presets: root path + Orchestrator tool-policy unit checks.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SpecdevPresetsService, {
  SPECDEV_ORCHESTRATOR_PRESET_ID,
  SPECDEV_PRESET_IDS,
  SPECDEV_PRESET_ROOT,
  ORCHESTRATOR_ALLOW,
  applyOrchestratorToolPolicy,
  rolePresetId,
} from '@deepseek-ai/dsh-specdev-presets'

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: (): Promise<string> => Promise.resolve(`ran:${name}`),
  }
}

async function mintAgentScope(ctx: Context, name: string): Promise<{ scope: Scope; key: Agent }> {
  const key = { id: name as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, {
    inject: ['tools', 'systemPrompt'],
  }))
  return { scope, key }
}

describe('@deepseek-ai/dsh-specdev-presets', () => {
  it('ships every SpecDev role preset directory with agent.cordis.yml', () => {
    expect(existsSync(SPECDEV_PRESET_ROOT)).toBe(true)
    const dirs = readdirSync(SPECDEV_PRESET_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    expect(dirs).toEqual([...SPECDEV_PRESET_IDS].sort())
    for (const id of SPECDEV_PRESET_IDS) {
      expect(existsSync(join(SPECDEV_PRESET_ROOT, id, 'preset.yml'))).toBe(true)
      expect(existsSync(join(SPECDEV_PRESET_ROOT, id, 'agent.cordis.yml'))).toBe(true)
    }
    const orch = readFileSync(join(SPECDEV_PRESET_ROOT, SPECDEV_ORCHESTRATOR_PRESET_ID, 'agent.cordis.yml'), 'utf8')
    expect(orch).toContain('orchestrator-tool-policy')
    expect(orch.includes("name: '@deepseek-ai/dsh-tool-fs'\n") || orch.includes('name: "@deepseek-ai/dsh-tool-fs"')).toBe(false)
    expect(rolePresetId('implementer')).toBe('specdev-implementer')
  })

  it('publishes presetRoot on ctx.specdevPresets', async () => {
    const ctx = new Context()
    await ctx.plugin(SpecdevPresetsService)
    expect(ctx.specdevPresets.presetRoot).toBe(SPECDEV_PRESET_ROOT)
    expect(ctx.specdevPresets.orchestratorPresetId).toBe(SPECDEV_ORCHESTRATOR_PRESET_ID)
  })

  it('AC-22/SF-3: applyOrchestratorToolPolicy uses allow-list (hides write/edit)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(Tools)
    for (const name of ['read', 'write', 'edit', 'grep', 'bash', 'str_replace_editor'] as const) {
      ctx.tools.register(tool(name))
    }
    const { scope, key } = await mintAgentScope(ctx, 'orch')
    applyOrchestratorToolPolicy(scope.ctx)

    expect([...ORCHESTRATOR_ALLOW]).toEqual(expect.arrayContaining(['read', 'grep', 'bash']))
    const allowSet = new Set<string>(ORCHESTRATOR_ALLOW)
    expect(allowSet.has('write')).toBe(false)
    expect(allowSet.has('edit')).toBe(false)
    expect(allowSet.has('str_replace_editor')).toBe(false)

    const visible = new Set(ctx.tools.schemas(key).map(schema => schema.name))
    expect(visible.has('read')).toBe(true)
    expect(visible.has('grep')).toBe(true)
    expect(visible.has('bash')).toBe(true)
    expect(visible.has('write')).toBe(false)
    expect(visible.has('edit')).toBe(false)
    expect(visible.has('str_replace_editor')).toBe(false)
  })
})
