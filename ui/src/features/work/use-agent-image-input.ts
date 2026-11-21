import { useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { Attachment } from '@/features/chat/draft.ts'
import { imagesReady, useAgentImages } from './agent-images.ts'

const NONE: readonly Attachment[] = []
const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true

/**
 * An agent's input taking images as the main input does: pasted or dropped on the box, shown in the same tray, and
 * Backspace at the very start takes the last one out. `agent` is the run id, or `hobkin:<id>` for a durable hobkin.
 * While `open` is false nothing more can reach the agent, so nothing is attached.
 */
export function useAgentImageInput(agent: string, open: boolean) {
  const attachments = useAgentImages((images) => images.trays[agent] ?? NONE)
  const problem = useAgentImages((images) => images.problems[agent] ?? null)
  const [dropping, setDropping] = useState(false)
  const { attach, detach } = useAgentImages.getState()

  return {
    attachments,
    /** Why the last image was not attached. */
    problem,
    /** Files are being dragged over the box. */
    dropping: dropping && open,
    /** hobkin holds every image, so the message can go. */
    ready: imagesReady(attachments),
    remove: (id: string) => detach(agent, id),
    /** A copied picture or file is attached. Copied words are pasted as usual. */
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = [...event.clipboardData.files]
      if (!files.length || !open) return
      event.preventDefault()
      attach(agent, files)
    },
    /** Backspace at the very start of the box: there is nothing left to delete but the last image. True when it took one. */
    removeLast: (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      const atStart = event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0
      if (event.key !== 'Backspace' || !plain || !atStart || !attachments.length) return false
      event.preventDefault()
      detach(agent, attachments.at(-1)!.id)
      return true
    },
    /** For the box: a file dropped on it is attached. */
    dropTarget: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!carriesFiles(event) || !open) return
        event.preventDefault()
        setDropping(true)
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        setDropping(false)
        if (!carriesFiles(event) || !open) return
        event.preventDefault()
        attach(agent, [...event.dataTransfer.files])
      },
    },
  }
}
