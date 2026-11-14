import { useIsPresent } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import { useHasHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { BrowserPane, useShellBrowser } from './BrowserPane.tsx'
import { DidNotShow, SavedNoteRow } from './CanvasNotes.tsx'
import { closeCanvasFromKeys, openInBrowser, openSaved } from './controls.ts'
import { LiveDrawing } from './LiveDrawing.tsx'
import { drawingOf, isOpen, labelFor, LOAD_PATIENCE_MS, sandboxFor } from './rules.ts'
import { savedNote, useCanvasBoards } from './store.ts'
import { useBoard } from './use-board.ts'

/**
 * One owner's canvas: the area that shows its page or drawing (`040-canvas-board`). The main canvas's place and a
 * durable hobkin's split each mount one, so both can be on screen while one gives way to the other. It reads the
 * canvas straight from the host's state, and one on its way out keeps showing what it showed, out of the keyboard's way.
 *
 * The area is where the keyboard is "in the canvas": Escape there closes it, Command+S saves a drawing (`keys.ts`).
 */
export function CanvasView({ owner, arrived, className, style, ref }: {
  owner: string
  /** The canvas has arrived where it shows: a drawing then plays its first entrance. */
  arrived: boolean
  className?: string
  style?: CSSProperties
  ref?: Ref<HTMLDivElement>
}) {
  const present = useIsPresent()
  const live = useBoard(owner)
  const kept = useRef<(CanvasState & { url: string }) | null>(null)
  if (present && isOpen(live)) kept.current = live
  const canvas = kept.current
  const board = useCanvasBoards((state) => state.boards[owner])
  // With the shell's browser, a page is a real browser pane (036-canvas-browser). A drawing keeps its sandboxed frame.
  const browser = useShellBrowser()
  const hasHost = useHasHost()
  const kind = canvas?.kind ?? 'page'
  const note = savedNote(board, canvas)
  const label = canvas ? labelFor(canvas.url, canvas.title, kind) : 'Canvas'

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      data-canvas-board={owner}
      data-canvas-kind={kind}
      tabIndex={-1}
      inert={!present}
      className={cn('flex min-h-0 flex-col overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', className)}
      style={style}
    >
      {canvas && note ? <SavedNoteRow note={note} onOpen={openSaved} /> : null}
      {!canvas ? null : browser && kind === 'page' ? (
        <BrowserPane
          browser={browser}
          url={canvas.url}
          title={canvas.title}
          revision={canvas.revision}
          onEscape={() => closeCanvasFromKeys(owner)}
          onOpenInBrowser={hasHost ? openInBrowser : null}
        />
      ) : kind === 'drawing' ? (
        <LiveDrawing
          // Another drawing loads anew; a new revision of this one changes it in place.
          key={drawingOf(canvas.url)}
          url={canvas.url}
          title={canvas.title}
          revision={canvas.revision}
          reloads={board?.reloads ?? 0}
          arrived={arrived}
          onOpenInBrowser={() => openInBrowser(canvas.url)}
        />
      ) : (
        <Page key={`${canvas.url}#${canvas.revision ?? 0}#${board?.reloads ?? 0}`} url={canvas.url} title={canvas.title} onOpenInBrowser={() => openInBrowser(canvas.url)} />
      )}
    </div>
  )
}

/** A web page framed, when the shell has no browser of its own, and the plain words when it does not arrive. */
function Page({ url, title, onOpenInBrowser }: { url: string; title: string | null; onOpenInBrowser: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [late, setLate] = useState(false)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setLate(true), LOAD_PATIENCE_MS)
    return () => clearTimeout(timer)
  }, [])

  const refused = !loaded && (late || broken)
  return (
    <div className="relative min-h-0 flex-1 bg-surface">
      <iframe
        title={labelFor(url, title)}
        src={url}
        sandbox={sandboxFor(url)}
        referrerPolicy="no-referrer"
        // A web page expects a browser's white under it.
        className="size-full border-0 bg-white"
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)}
      />
      {refused ? <DidNotShow url={url} onOpenInBrowser={onOpenInBrowser} /> : null}
    </div>
  )
}
