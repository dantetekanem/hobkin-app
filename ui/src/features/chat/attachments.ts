import type { ImageLimits } from '#shared/protocol/messages.ts'

/** The image types hobkin can send to a model (`src/cli/paste-image.mjs`). */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/** For the file picker. */
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',')

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

/**
 * Why a file cannot be attached, or null when it can. The limits are hobkin's own, which the host passes on,
 * so a file hobkin would refuse is turned away here before any of it is sent. hobkin still checks what arrives.
 */
export function attachmentRefusal(file: { name: string; type: string; size: number }, attached: number, limits: ImageLimits | null): string | null {
  if (!limits) return 'Images can be attached once hobkin is connected.'
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return `${file.name} cannot be sent. PNG, JPEG, GIF and WebP can.`
  if (attached >= limits.images) return `A message can hold ${limits.images} images.`
  if (file.size > limits.imageBytes) return `${file.name} is over ${megabytes(limits.imageBytes)} MB, too big to attach.`
  return null
}

/** A file's bytes in base64, as the host takes them. */
export function fileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? Error('The file could not be read.'))
    // A data URL is `data:<type>;base64,<bytes>`. The browser encodes it without holding the page up.
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1))
    reader.readAsDataURL(file)
  })
}
