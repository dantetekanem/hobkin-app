import { useIsPresent } from 'motion/react'
import { useRef, useState } from 'react'
import { focusInput } from '@/app/focus.ts'
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog.tsx'
import type { Attachment } from './draft.ts'

/** Borrows the draft's object URL; the attachment remains its sole owner. */
export function ImagePreview({ attachment }: { attachment: Attachment }) {
  const present = useIsPresent()
  const [open, setOpen] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const close = useRef<HTMLButtonElement | null>(null)

  return (
    <Dialog
      open={open && present}
      onOpenChange={(next, details) => {
        if (details.reason === 'escape-key') {
          details.event.preventDefault()
          details.event.stopPropagation()
        }
        setOpen(next)
        if (next) setZoomed(false)
      }}
    >
      <DialogTrigger
        ref={opener}
        disabled={!present}
        render={<button type="button" aria-label={`Preview ${attachment.name}`} className="block rounded-xl outline-offset-2" />}
      >
        <img src={attachment.preview} alt={attachment.name} className="size-14 rounded-xl border border-border object-cover" />
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        initialFocus={close}
        finalFocus={() => {
          if (present && opener.current?.isConnected) return opener.current
          focusInput()
          return false
        }}
        // Portals still bubble through React: none of these keys belong to the prompt or frame.
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
          }
        }}
        onClick={(event) => event.stopPropagation()}
        className="z-[60] flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col sm:max-w-[min(90vw,1200px)] motion-reduce:animate-none"
      >
        <header className="flex shrink-0 items-center gap-3">
          <DialogTitle className="min-w-0 flex-1 truncate">{attachment.name}</DialogTitle>
          <button
            type="button"
            aria-pressed={zoomed}
            onClick={() => setZoomed((value) => !value)}
            className="rounded-lg border border-border px-3 py-1.5 outline-offset-2"
          >
            {zoomed ? 'Reset zoom' : 'Zoom in'}
          </button>
          <DialogClose ref={close} render={<button type="button" className="rounded-lg border border-border px-3 py-1.5 outline-offset-2" />}>
            Close
          </DialogClose>
        </header>
        <div className="min-h-0 overflow-auto overscroll-contain rounded-lg" tabIndex={0} aria-label="Image preview">
          <img
            src={attachment.preview}
            alt={attachment.name}
            className={zoomed ? 'block max-w-none' : 'mx-auto block max-h-[72dvh] max-w-full object-contain'}
            style={zoomed ? { width: '200%', height: 'auto' } : undefined}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
