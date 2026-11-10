import { randomUUID } from 'node:crypto'
import type { HobkinApplication, ImageHandle } from 'hobkin/src/cli/application.mjs'
import type { ImageLimits } from '#shared/protocol/messages.ts'

export interface AttachedImage {
  id: string
  name: string
  mimeType: string
  /** Something hobkin did to the image that the user should know, such as shrinking it. */
  notice?: string
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

/**
 * Images attached to the message being written. hobkin takes an image from the clipboard, checks it, shrinks
 * it and keeps it as a private file until the message goes. Here the UI sends the bytes, and this stands where
 * hobkin expects the clipboard, so every one of hobkin's own checks still applies and hobkin needs no change.
 */
export class Attachments {
  private readonly pending = new Map<string, ImageHandle>()
  private upload: Buffer | null = null
  private turn: Promise<unknown> = Promise.resolve()

  /** What hobkin reads in place of the system clipboard: the image the UI sent, and no file or text. */
  readonly clipboard = {
    getImage: async () => this.upload,
    getText: async () => '',
  }

  /** Hands one image to hobkin. One at a time, because hobkin reads its clipboard once per paste. */
  attach(app: HobkinApplication, limits: ImageLimits, { name, bytes }: { name: string; bytes: Buffer }): Promise<AttachedImage> {
    const attached = this.turn.then(async () => {
      if (this.pending.size >= limits.images) throw Error(`A message can hold ${limits.images} images.`)
      if (bytes.length > limits.imageBytes) throw Error(`That image is over ${megabytes(limits.imageBytes)} MB, too big to attach.`)

      this.upload = bytes
      try {
        const { image, notice } = await app.pasteImage()
        // With no image back, the notice is hobkin's reason for refusing it.
        if (!image) throw Error(notice ?? 'That image cannot be attached.')
        const id = randomUUID()
        this.pending.set(id, { file: image.file, mimeType: image.mimeType })
        return { id, name, mimeType: image.mimeType, ...(notice ? { notice } : {}) }
      } finally {
        this.upload = null
      }
    })
    this.turn = attached.catch(() => {})
    return attached
  }

  /** Takes an image back out of the draft. hobkin deletes its file. */
  detach(app: HobkinApplication, id: string): void {
    const handle = this.pending.get(id)
    if (!handle) throw Error('That image is not attached any more.')
    this.pending.delete(id)
    app.dropImages([handle])
  }

  /** The images to send, in the order asked. They stay attached until hobkin has taken the message. */
  handles(ids: readonly string[]): ImageHandle[] {
    return ids.map((id) => {
      const handle = this.pending.get(id)
      if (!handle) throw Error('An image of this message is not attached any more.')
      return handle
    })
  }

  /** hobkin took the message and the images with it. */
  sent(ids: readonly string[]): void {
    for (const id of ids) this.pending.delete(id)
  }
}
