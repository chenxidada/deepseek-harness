/**
 * Media-type detection for composer uploads.
 *
 * The runtime's attachment admission compares the declared media type against
 * the bytes and refuses a mismatch (`IMAGE_TYPE_MISMATCH`). A platform label is
 * not that fact: a WebP saved as `.png` reports `image/png`, and some tools
 * report the non-canonical `image/jpg`. The composer therefore declares what the
 * bytes carry whenever they carry a supported signature.
 */

/** Media types the runtime accepts for one uploaded image. */
export type UploadableImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Non-ASCII-safe signature of a PNG stream. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Read one upload's media type from its leading bytes.
 * @param base64 - attachment payload without the data-URL prefix.
 * @returns the canonical media type, or undefined when the bytes carry no supported signature.
 */
export function sniffImageMediaType(base64: string): UploadableImageMediaType | undefined {
  let bytes: number[]
  try {
    // 16 base64 characters are exactly the 12 bytes every signature test reads.
    bytes = Array.from(atob(base64.slice(0, 16)), character => character.charCodeAt(0))
  } catch {
    // A malformed payload is the runtime's to refuse; the caller keeps its declared type.
    return undefined
  }
  const ascii = (offset: number, length: number): string => bytes.length < offset + length
    ? ''
    : String.fromCharCode(...bytes.slice(offset, offset + length))
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  return undefined
}
