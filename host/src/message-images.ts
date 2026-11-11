import type { StoredImage } from '#shared/commands/registry.ts'

/** Request replies only: never put these bytes in state or a transcript. */
export function rasterImage(value: unknown): StoredImage | null {
  const image = value as Partial<StoredImage> | null
  if (!image || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.mimeType ?? '') || typeof image.data !== 'string') return null
  const { data, mimeType } = image
  if (!data.length || data.length > 4 * Math.ceil(5242880 / 3) || data.length % 4 || /[^A-Za-z0-9+/=]/.test(data)) return null
  const bytes = Buffer.from(data, 'base64')
  return bytes.length <= 5242880 && bytes.toString('base64') === data ? { mimeType: mimeType!, data } : null
}

type ImageApp = { runtime: { main: unknown }; messageImage?: (args: { sessionId: string; messageId: string; ordinal: number }) => unknown }
export function mainImage(current: () => ImageApp, shown: readonly string[], messageId: string, ordinal: number): StoredImage | null {
  const app = current(), main = app.runtime.main as { sessionId?: string } | null
  const sessionId = main?.sessionId
  if (!shown.includes(messageId) || !sessionId || !Number.isSafeInteger(ordinal) || ordinal < 0) return null
  const image = app.messageImage?.({ sessionId, messageId, ordinal })
  return current() === app && app.runtime.main === main && main.sessionId === sessionId ? rasterImage(image) : null
}
