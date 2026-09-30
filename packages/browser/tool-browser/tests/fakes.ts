/**
 * Scripted stand-ins the browser-tool specs share: an attachment store that
 * records every committed image, and an exact-route model catalog the
 * screenshot gate resolves against. Mounting these instead of the real
 * services keeps each spec on the behavior it asserts.
 */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'

/** Provider id the fake catalog registers under; agent routes must name it. */
export const FAKE_PROVIDER = 'fake'

/** The image-capable route the screenshot gate accepts. */
export const IMAGE_ROUTE = { provider: FAKE_PROVIDER, model: 'vision-model' } as const

/** A route whose model declares no image input. */
export const TEXT_ROUTE = { provider: FAKE_PROVIDER, model: 'text-model' } as const

/** Deployment image limits the fake store reports; the refusal text names them. */
export const FAKE_IMAGE_LIMITS: ImageAttachmentLimits = Object.freeze({
  maxImageBytes: 20 * 1024 * 1024,
  maxImagesPerMessage: 20,
  maxMessageImageBytes: 200 * 1024 * 1024,
  maxImagePixels: 4_000_000,
  maxImageDimension: 8192,
  mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
})

/**
 * A stand-in attachment store: every commit is recorded, and a spec can script
 * either the reference a commit answers or the failure it raises.
 */
export class FakeAttachmentStore extends AttachmentStore {
  /** Every input `saveImage` received, in call order. */
  readonly saved: SaveImageAttachment[] = []

  /** Reference every commit answers; absent derives one from the committed input. */
  ref: ImageAttachmentRef | undefined

  /** Failure raised by every commit instead of answering a reference. */
  failure: Error | undefined

  readonly imageLimits = FAKE_IMAGE_LIMITS

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    if (this.failure !== undefined) return Promise.reject(this.failure)
    return Promise.resolve(this.ref ?? {
      attachmentId: AttachmentId('sha256:fake'),
      mediaType: input.mediaType,
      bytes: input.data.length,
      width: 1280,
      height: 720,
      ...input.name === undefined ? {} : { name: input.name },
    })
  }

  readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    throw new Error('the browser tool specs never read an image back')
  }
}

/**
 * Mount the fake store and report it for direct assertions.
 * @param ctx - context to mount into.
 * @returns the mounted store.
 */
export async function mountFakeAttachments(ctx: Context): Promise<FakeAttachmentStore> {
  await ctx.plugin(FakeAttachmentStore)
  const store = ctx.get('attachments')
  if (!(store instanceof FakeAttachmentStore)) throw new Error('expected the fake attachment store to be mounted')
  return store
}

/** The models the fake catalog answers; an unlisted id resolves without declared modalities. */
const ROUTE_MODELS: readonly LlmModelInfo[] = [
  { provider: FAKE_PROVIDER, id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
  { provider: FAKE_PROVIDER, id: 'text-model', name: 'Text', inputModalities: ['text'] },
]

/** Exact-route adapter; `stream` is unreachable in these specs. */
export class RouteAdapter extends LlmAdapter {
  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(ROUTE_MODELS)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const declared = ROUTE_MODELS.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: declared?.name ?? model,
      ...declared?.inputModalities === undefined ? {} : { inputModalities: [...declared.inputModalities] },
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('the browser tool specs never stream')
  }
}

/**
 * Mount the real LLM runtime with the fake catalog, exactly as a deployment
 * registers one adapter for its provider.
 * @param ctx - context to mount into.
 */
export async function mountFakeRoute(ctx: Context): Promise<void> {
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter([FAKE_PROVIDER], new RouteAdapter())
}
