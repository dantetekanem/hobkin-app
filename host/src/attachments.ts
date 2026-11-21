import { randomUUID } from 'node:crypto'
import type { HobkinApplication, ImageContent, ImageHandle } from 'hobkin/src/cli/application.mjs'
import type { ImageLimits } from '#shared/protocol/messages.ts'
import { Unavailable } from './commands.ts'

export interface AttachedImage {
  id: string
  name: string
  mimeType: string
  /** Something hobkin did to the image that the user should know, such as shrinking it. */
  notice?: string
}

/** An image hobkin holds, and the agent whose message it is for. None for hobkin's own conversation. */
interface Pending {
  handle: ImageHandle
  agent: string | undefined
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

/**
 * Images attached to the messages being written: hobkin's own, and each agent's. hobkin takes an image from the
 * clipboard, checks it, shrinks it and keeps it as a private file until the message goes. Here the UI sends the bytes,
 * and this stands where hobkin expects the clipboard, so every one of hobkin's own checks still applies and hobkin
 * needs no change.
 */
export class Attachments {
  private readonly pending = new Map<string, Pending>()
  private upload: Buffer | null = null
  private turn: Promise<unknown> = Promise.resolve()

  /** What hobkin reads in place of the system clipboard: the image the UI sent, and no file or text. */
  readonly clipboard = {
    getImage: async () => this.upload,
    getText: async () => '',
  }

  /**
   * Hands one image to hobkin. One at a time, because hobkin reads its clipboard once per paste. `agent` names the
   * agent the message is for: its images count against that message alone, and the agent's model takes them, so
   * what hobkin's own model can see does not matter.
   */
  attach(app: HobkinApplication, limits: ImageLimits, { name, bytes, agent }: { name: string; bytes: Buffer; agent?: string }): Promise<AttachedImage> {
    const attached = this.turn.then(async () => {
      if (this.attachedFor(agent) >= limits.images) throw Error(`A message can hold ${limits.images} images.`)
      if (bytes.length > limits.imageBytes) throw Error(`That image is over ${megabytes(limits.imageBytes)} MB, too big to attach.`)

      this.upload = bytes
      try {
        const { image, notice } = await (agent === undefined ? app.pasteImage() : app.pastedImages.paste())
        // With no image back, the notice is hobkin's reason for refusing it.
        if (!image) throw Error(notice ?? 'That image cannot be attached.')
        const id = randomUUID()
        this.pending.set(id, { handle: { file: image.file, mimeType: image.mimeType }, agent })
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
    const pending = this.pending.get(id)
    if (!pending) throw Error('That image is not attached any more.')
    this.pending.delete(id)
    app.dropImages([pending.handle])
  }

  /** The images to send, in the order asked. They stay attached until hobkin has taken the message. */
  handles(ids: readonly string[]): ImageHandle[] {
    return ids.map((id) => {
      const pending = this.pending.get(id)
      if (!pending) throw Error('An image of this message is not attached any more.')
      return pending.handle
    })
  }

  /** hobkin took the message and the images with it. */
  sent(ids: readonly string[]): void {
    for (const id of ids) this.pending.delete(id)
  }

  private attachedFor(agent: string | undefined): number {
    return [...this.pending.values()].filter((pending) => pending.agent === agent).length
  }
}

/** What a message to an agent needs of the images attached for it (`agent.say`, `hobkin.say`). */
export interface AgentImages {
  /** The images as Pi takes them, in the order asked. Throws when one is not attached any more. */
  contents(ids: readonly string[]): ImageContent[]
  /** The agent has them: they leave the draft, and hobkin deletes their files. */
  given(ids: readonly string[]): void
  /** hobkin's words for a message of pictures alone, since a turn needs words. */
  wordsAlone(): string
}

export function agentImages(attachments: Attachments, app: () => HobkinApplication, wordsAlone: () => string): AgentImages {
  return {
    contents: (ids) => app().pastedImages.contents(attachments.handles(ids)),
    given: (ids) => {
      const handles = attachments.handles(ids)
      attachments.sent(ids)
      app().dropImages(handles)
    },
    wordsAlone,
  }
}

/** The images attached for an agent's message, as Pi takes them. One that is not attached any more refuses the message. */
export function imageContents(attached: AgentImages | undefined, ids: readonly string[]): ImageContent[] {
  if (!attached) throw new Unavailable('Images cannot go to an agent from this host.')
  try {
    return attached.contents(ids)
  } catch (error) {
    throw new Unavailable(error instanceof Error ? error.message : String(error))
  }
}
