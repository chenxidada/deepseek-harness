// @vitest-environment jsdom
/**
 * cap:model-providers — the settings page's 模型提供方 editor.
 *
 * One save rewrites the whole `models` array, so every expectation here is about
 * what a save actually writes back: fields the form does not show must survive,
 * an untouched route must write nothing, and input modalities must reach the
 * profile.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMessageBridge } from '../webview/src/bridge/message-bridge.ts'
import { ModelProvidersSection } from '../webview/src/components/ModelProvidersSection.tsx'
import type { DiscoveryReply, SettingsState } from '../webview/src/store/chat-ui-store.ts'

/** One captured `settings/mutate` intent. */
interface MutateIntent {
  type: 'settings/mutate'
  ops: Array<{ op: string; path: string[]; value?: unknown }>
}

/** A settings state whose user layer declares one route named `acme`. */
function stateWithRoute(route: Record<string, unknown>): SettingsState {
  return {
    namespaces: [{
      ns: 'llm-pi-ai',
      value: { providers: { acme: route } },
      user: { providers: { acme: route } },
      revision: 4,
    }],
  }
}

/** Render the section, open the route's editor, and return the live intent list. */
function openEditor(route: Record<string, unknown>): MutateIntent[] {
  const intents: MutateIntent[] = []
  const bridge = createMessageBridge({
    postToHost: (message) => {
      if ((message as { type?: string }).type === 'settings/mutate') intents.push(message as MutateIntent)
    },
    // No window listener: the page under test owns the frames, not this spec.
    onHostMessage: () => () => {},
  })
  render(<ModelProvidersSection settingsState={stateWithRoute(route)} credentials={[]} bridge={bridge} />)
  fireEvent.click(screen.getByTestId('settings-provider-edit'))
  return intents
}

/** The `models` array a save wrote, or undefined when it wrote none. */
function savedModels(intents: MutateIntent[]): unknown {
  for (const intent of intents) {
    const op = intent.ops.find(entry => entry.path.join('.') === 'providers.acme.models')
    if (op !== undefined) return op.value
  }
  return undefined
}

/** One row's input-type checkbox, addressed by the modality it declares. */
function inputTypeBox(modality: string): HTMLInputElement {
  const boxes = screen.getAllByTestId('settings-provider-model-input') as HTMLInputElement[]
  const found = boxes.find(box => box.dataset.modality === modality)
  if (found === undefined) throw new Error(`no ${modality} checkbox is rendered`)
  return found
}

afterEach(cleanup)

describe('cap:model-providers — the provider editor round-trip', () => {
  it('CAP-MODEL-PROVIDERS-001 writes only the edited field and never rewrites untouched model rows', () => {
    const intents = openEditor({
      baseURL: 'https://gateway.example/v1',
      api: 'openai-completions',
      models: [{
        id: 'deepseek-v4.1-flash',
        name: 'V4.1 Flash',
        contextWindow: 1_000_000,
        input: ['text', 'image'],
        reasoningEfforts: { high: 'high' },
        compat: { supportsDeveloperRole: false },
      }],
    })

    fireEvent.change(screen.getByTestId('settings-provider-name'), { target: { value: 'Acme Gateway' } })
    fireEvent.click(screen.getByTestId('settings-provider-save'))

    // A save writes the edited path only. The stored rows keep `reasoningEfforts`
    // and `compat`, which the form never shows, because nothing rewrites them.
    expect(intents.flatMap(intent => intent.ops)).toEqual([
      { op: 'set', path: ['providers', 'acme', 'displayName'], value: 'Acme Gateway' },
    ])
  })

  it('CAP-MODEL-PROVIDERS-002 writes nothing when the editor is left untouched', () => {
    const intents = openEditor({
      baseURL: 'https://gateway.example/v1',
      api: 'openai-completions',
      models: [{ id: 'deepseek-v4.1-flash', input: ['text', 'image'] }],
    })

    fireEvent.click(screen.getByTestId('settings-provider-save'))

    expect(intents).toEqual([])
  })

  it('CAP-MODEL-PROVIDERS-003 declares image input on a model that declared none', () => {
    const intents = openEditor({
      baseURL: 'https://gateway.example/v1',
      api: 'openai-completions',
      models: [{ id: 'deepseek-v4.1-flash' }],
    })

    expect(inputTypeBox('text').checked).toBe(true)
    expect(inputTypeBox('image').checked).toBe(false)

    fireEvent.click(inputTypeBox('image'))
    fireEvent.click(screen.getByTestId('settings-provider-save'))

    expect(savedModels(intents)).toEqual([{ id: 'deepseek-v4.1-flash', input: ['text', 'image'] }])
  })

  it('CAP-MODEL-PROVIDERS-004 returns to no declaration when the choice matches the route default', () => {
    const intents = openEditor({
      baseURL: 'https://gateway.example/v1',
      api: 'openai-completions',
      models: [{ id: 'deepseek-v4.1-flash' }],
    })

    fireEvent.click(inputTypeBox('image'))
    fireEvent.click(inputTypeBox('image'))
    fireEvent.click(screen.getByTestId('settings-provider-save'))

    expect(intents).toEqual([])
  })

  it('CAP-MODEL-PROVIDERS-005 reads the route defaultInput as the row it inherits', () => {
    const intents = openEditor({
      baseURL: 'https://gateway.example/v1',
      api: 'openai-completions',
      defaultInput: ['text', 'image'],
      models: [{ id: 'deepseek-v4.1-flash' }],
    })

    expect(inputTypeBox('image').checked).toBe(true)

    // Unchecking the inherited image must write the narrower declaration.
    fireEvent.click(inputTypeBox('image'))
    fireEvent.click(screen.getByTestId('settings-provider-save'))

    expect(savedModels(intents)).toEqual([{ id: 'deepseek-v4.1-flash', input: ['text'] }])
  })

  it('CAP-MODEL-PROVIDERS-006 refuses to clear the last remaining modality', () => {
    openEditor({
      baseURL: 'https://gateway.example/v1',
      api: 'openai-completions',
      models: [{ id: 'deepseek-v4.1-flash', input: ['image'] }],
    })

    expect(inputTypeBox('image').checked).toBe(true)
    expect(inputTypeBox('image').disabled).toBe(true)
    expect(inputTypeBox('text').disabled).toBe(false)
  })
})

describe('cap:model-providers — the endpoint interrogation round-trip', () => {
  /** One captured Webview→Host intent of any type. */
  type CapturedIntent = Record<string, unknown> & { type: string }

  /**
   * Render the section over one route with a captured intent list and a
   * controllable discovery reply, and open the route's editor.
   */
  function renderEditor(): {
    intents: CapturedIntent[]
    rerender: (discovery?: DiscoveryReply) => void
  } {
    const intents: CapturedIntent[] = []
    const bridge = createMessageBridge({
      postToHost: (message) => {
        intents.push(message as CapturedIntent)
      },
      onHostMessage: () => () => {},
    })
    const route = { baseURL: 'https://gateway.example/v1', api: 'openai-completions', models: [{ id: 'kept' }] }
    const element = (discovery?: DiscoveryReply): ReactElement => (
      <ModelProvidersSection
        settingsState={stateWithRoute(route)}
        credentials={[{ ref: 'ACME_API_KEY', configured: true, writable: true }]}
        discovery={discovery}
        bridge={bridge}
      />
    )
    const view = render(element())
    fireEvent.click(screen.getByTestId('settings-provider-edit'))
    return {
      intents,
      rerender: (discovery) => {
        view.rerender(element(discovery))
      },
    }
  }

  it('CAP-MODEL-PROVIDERS-007 asks the endpoint through the Host and adopts the picked candidates', () => {
    const { intents, rerender } = renderEditor()

    fireEvent.click(screen.getByTestId('settings-provider-fetch-models'))
    const request = intents.find(intent => intent.type === 'settings/discover-models')
    // The request describes the draft: namespace, route, endpoint, and protocol.
    expect(request).toMatchObject({
      settingsNs: 'llm-pi-ai',
      provider: 'acme',
      baseURL: 'https://gateway.example/v1',
      api: 'openai-completions',
    })
    expect(typeof request?.requestId).toBe('string')

    rerender({
      requestId: request?.requestId as string,
      models: [{ id: 'deepseek-v4-pro', name: 'V4 Pro', contextWindow: 1_000_000 }],
    })
    fireEvent.click(screen.getByTestId('settings-provider-candidate'))
    fireEvent.click(screen.getByTestId('settings-provider-adopt-models'))
    fireEvent.click(screen.getByTestId('settings-provider-save'))

    const mutations = intents.filter(intent => intent.type === 'settings/mutate') as unknown as MutateIntent[]
    expect(savedModels(mutations)).toEqual([
      { id: 'kept' },
      { id: 'deepseek-v4-pro', name: 'V4 Pro', contextWindow: 1_000_000 },
    ])
  })

  it('CAP-MODEL-PROVIDERS-008 shows the interrogation refusal in place and keeps the draft', () => {
    const { intents, rerender } = renderEditor()

    fireEvent.click(screen.getByTestId('settings-provider-fetch-models'))
    const request = intents.find(intent => intent.type === 'settings/discover-models')
    rerender({ requestId: request?.requestId as string, error: 'models endpoint answered 401' })

    expect(screen.queryByTestId('settings-provider-candidates')).toBeNull()
    expect(screen.getByTestId('settings-provider-fetch-error').textContent)
      .toContain('拉取失败：models endpoint answered 401')
    // The reference the route already carries is what the key field reports.
    expect(screen.getByTestId('settings-provider-key-input').getAttribute('placeholder'))
      .toContain('ACME_API_KEY')
  })
})
