import { hostStore, runCommand } from '@/lib/host/client.ts'
import type { ImageLimits } from '#shared/protocol/messages.ts'
import { attachmentRefusal, fileAsBase64 } from './attachments.ts'
import type { Attachment } from './draft.ts'

/**
 * Where images wait while their message is written: the draft of hobkin's own conversation, or an agent's. Each place
 * keeps its images its own way, and the way an image gets to hobkin is the same for all of them.
 */
export interface ImageTray {
  /** How many images the message holds now. */
  count(): number
  /** Whether the draft still holds this image, anywhere it keeps one. */
  holds(id: string): boolean
  add(attachment: Attachment): void
  /** hobkin took the image and named it. */
  uploaded(id: string, handle: string): void
  /** hobkin did not take the image: it leaves the draft, and `why` says why. */
  lost(id: string, why: string): void
  /** Why a file was not attached at all. */
  refused(why: string): void
  /** The agent the message is for, by its run id or `hobkin:<id>`. None for hobkin's own conversation. */
  agent?: string
}

let uploads = 0
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** hobkin's limits on images while it is open, or null while nothing can be attached. */
export function imageLimits(): ImageLimits | null {
  const { link, owner } = hostStore.getState()
  return link === 'open' && owner?.state === 'live' ? owner.limits : null
}

/**
 * Attaches images, pasted, dropped or picked. Each one hobkin would refuse is turned away with the reason. The rest
 * show at once, from the file itself, and hobkin gets their bytes in the background.
 */
export function attachImages(files: readonly File[], tray: ImageTray): void {
  for (const file of files) {
    const refusal = attachmentRefusal(file, tray.count(), imageLimits())
    if (refusal) {
      tray.refused(refusal)
      continue
    }
    const attachment: Attachment = { id: `local:${++uploads}`, name: file.name || 'image', mimeType: file.type, preview: URL.createObjectURL(file) }
    tray.add(attachment)
    fileAsBase64(file)
      .then((data) => runCommand('conversation.attach', { name: attachment.name, data, ...(tray.agent ? { agent: tray.agent } : {}) }))
      .then(
        ({ id: handle }) => {
          // Removed while it was on its way: hobkin lets go of it again.
          if (!tray.holds(attachment.id)) {
            void runCommand('conversation.detach', { id: handle }).catch(() => {})
            return
          }
          tray.uploaded(attachment.id, handle)
        },
        (error) => {
          forgetPreviews([attachment])
          tray.lost(attachment.id, reason(error))
        },
      )
  }
}

/** Lets go of the previews once nothing draws them. */
export const forgetPreviews = (attachments: readonly Attachment[]) => attachments.forEach(({ preview }) => URL.revokeObjectURL(preview))

/** hobkin lets go of the images it holds for a message that will not go with them. */
export function releaseImages(attachments: readonly Attachment[]): void {
  for (const { handle } of attachments) if (handle) void runCommand('conversation.detach', { id: handle }).catch(() => {})
}
