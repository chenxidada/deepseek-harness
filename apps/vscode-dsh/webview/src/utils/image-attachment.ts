/**
 * Read a dropped or pasted file into a composer attachment (feature: image-upload).
 * @module @deepseek-ai/dsh-vscode-dsh/webview/utils/image-attachment
 */

import { sniffImageMediaType } from './image-media-type.ts'

/** One image staged for the next composer send. */
export interface ComposerImage {
  /** Base64 payload without the `data:` prefix. */
  data: string
  /** Media type the bytes carry, or the platform's declaration when they carry none. */
  mimeType: string
  /** Original file name, when the drop or paste carried one. */
  name?: string
}

/**
 * Read one image file into a staged attachment.
 *
 * The runtime's admission compares the declared media type against the bytes,
 * and a platform label lies for a mislabeled file (a WebP named `.png`, an
 * `image/jpg` label), so a sniffed signature wins whenever the bytes carry one.
 * @param file - dropped or pasted file.
 * @returns the attachment, or undefined for a non-image or unreadable file.
 */
export async function readImageAttachment(file: File): Promise<ComposerImage | undefined> {
  if (!file.type.startsWith('image/')) return undefined
  const result = await new Promise<string | undefined>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : undefined)
    }
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(file)
  })
  if (result === undefined) return undefined
  // data:image/png;base64,... → the base64 payload the Host forwards.
  const base64 = result.split(',')[1] ?? ''
  if (base64 === '') return undefined
  return { data: base64, mimeType: sniffImageMediaType(base64) ?? file.type, name: file.name }
}
