import { Paperclip, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { RefObject } from 'react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { IMAGE_ACCEPT } from './attachments.ts'
import type { Attachment } from './draft.ts'
import { ImagePreview } from './ImagePreview.tsx'

/** The images attached to the draft, as thumbnails. Each can be removed before sending. */
export function AttachmentTray({ attachments, onRemove }: { attachments: readonly Attachment[]; onRemove: (id: string) => void }) {
  return (
    <ul aria-label="Attached images" className="flex flex-wrap gap-2 empty:hidden [&:not(:empty)]:px-1.5 [&:not(:empty)]:pt-1.5 [&:not(:empty)]:pb-2">
      <AnimatePresence initial={false}>
        {attachments.map((attachment) => {
          const onItsWay = attachment.handle === undefined
          return (
            <motion.li
              key={attachment.id}
              aria-busy={onItsWay || undefined}
              initial={{ opacity: 0, transform: 'translateY(8px) scale(0.96)' }}
              // Lighter until hobkin holds it. Opacity only, so the tray keeps its size.
              animate={{ opacity: onItsWay ? 0.55 : 1, transform: 'translateY(0px) scale(1)', transition: spring.alive }}
              exit={{ opacity: 0, transform: 'translateY(0px) scale(0.96)', transition: tween.exit }}
              className="group relative size-14"
            >
              <ImagePreview attachment={attachment} />
              <button
                type="button"
                onClick={() => onRemove(attachment.id)}
                aria-label={`Remove ${attachment.name}`}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-border-strong bg-card text-foreground outline-offset-1 transition-[transform,background-color] duration-[140ms] ease-out hover:bg-surface-2 active:scale-[0.97]"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}

export interface AttachButtonProps {
  /** The hidden file input. The composer opens it from the keyboard too. */
  picker: RefObject<HTMLInputElement | null>
  disabled: boolean
  onPick: (files: File[]) => void
}

/** Opens the system's file picker for images. Command+U does the same from the input. */
export function AttachButton({ picker, disabled, onPick }: AttachButtonProps) {
  return (
    <>
      <input
        ref={picker}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          onPick([...(event.target.files ?? [])])
          // The same file can be picked again after it was removed.
          event.target.value = ''
        }}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              onClick={() => picker.current?.click()}
              aria-label="Attach an image"
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-offset-2 transition-[transform,background-color,color] duration-[140ms] ease-out hover:bg-surface-2 hover:text-foreground active:scale-[0.97] disabled:opacity-40"
            />
          }
        >
          <Paperclip className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>
          Attach an image <Kbd>⌘U</Kbd>
        </TooltipContent>
      </Tooltip>
    </>
  )
}
