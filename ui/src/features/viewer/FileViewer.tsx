import { Dialog } from '@base-ui/react/dialog'
import { ExternalLink, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImageFile } from '#shared/protocol/files.ts'
import { focusHome } from '@/app/focus-home.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Markdown } from '@/features/chat/markdown.ts'
import { formatBytes } from '@/features/settings/backup.ts'
import '@/features/review/code/code.css'
import { languageOf } from '@/features/review/code/languages.ts'
import { FONT, tokenStyle } from '@/features/review/code/tokens.ts'
import { useHighlighted } from '@/features/review/code/use-highlighted.ts'
import { runCommand, useHasHost } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useViewer } from './store.ts'
import { type FileState, useFile } from './use-file.ts'

/** Past this many lines a file is drawn plain: coloring every line of a huge file would stall the window. */
const HIGHLIGHT_LINES = 5000

/** A name that says image: its frame fills the sheet before the bytes arrive. The bytes decide what it is. */
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i

/**
 * The file viewer (_specs/027-links-and-files): a sheet over a blurred window. A Markdown file is rendered the way
 * the chat renders it, any other text is code, an image is drawn to fit, and a file that cannot be shown says why
 * in plain words.
 */
export function FileViewer() {
  const open = useViewer((state) => state.open)
  const path = useViewer((state) => state.path)
  const closeViewer = useViewer((state) => state.closeViewer)
  const still = useStill()
  const wasOpen = useRef(false)

  // Closing hands the keyboard home (an agent's screen keeps it), unless something else has taken it.
  useEffect(() => {
    if (wasOpen.current && !open) {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) focusHome()
      })
    }
    wasOpen.current = open
  }, [open])

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && closeViewer()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim backdrop-blur-md transition-opacity duration-[320ms] ease-[ease] data-[ending-style]:opacity-0 data-[ending-style]:duration-[200ms] data-[starting-style]:opacity-0" />
        <Dialog.Popup
          aria-label="File"
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-72px)] min-h-[200px] w-[min(900px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] bg-background shadow-float outline-none',
            'transition-[translate,scale,opacity] duration-[440ms] ease-[var(--ease-drawer)]',
            'data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[ending-style]:duration-[200ms]',
            // Under Still the sheet only fades: it neither travels nor grows.
            !still && 'data-[starting-style]:translate-y-[12%] data-[starting-style]:scale-[0.92] data-[ending-style]:scale-[0.97]',
          )}
        >
          {path !== null ? <Sheet path={path} still={still} /> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Sheet({ path, still }: { path: string; still: boolean }) {
  const state = useFile(path)
  const hasHost = useHasHost()
  const closeViewer = useViewer((store) => store.closeViewer)
  const [problem, setProblem] = useState<string | null>(null)
  const name = (state.status === 'ready' ? state.file.name : path.split('/').at(-1)) || path
  // An image's frame fills the sheet from the start, so nothing moves while it loads.
  const pictured = state.status === 'ready' ? state.file.kind === 'image' : IMAGE_NAME.test(path)
  // The image frame stays mounted from reading to drawn; anything else lands anew once read.
  const contentKey = pictured ? `image ${path}` : state.status === 'ready' ? state.file.path : state.status

  const openInApp = () => {
    setProblem(null)
    runCommand('file.open', { path }).catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
  }

  return (
    <>
      <motion.header
        className="flex items-center gap-3 px-6 pt-5 pb-3"
        initial={holdStill({ opacity: 0, transform: 'translateY(-14px)' }, still)}
        animate={holdStill({ opacity: 1, transform: 'translateY(0px)' }, still)}
        transition={{ transform: spring.rise, opacity: tween.enter }}
      >
        <div className="min-w-0 flex-1">
          <Dialog.Title className="truncate text-[17px] leading-snug font-semibold">{name}</Dialog.Title>
          <Dialog.Description className="truncate text-[12.5px] text-muted-foreground" title={path}>
            {state.status === 'ready' ? state.file.path : path}
          </Dialog.Description>
        </div>
        <Button variant="outline" size="sm" onClick={openInApp} disabled={!hasHost}>
          <ExternalLink data-icon="inline-start" />
          Open in default app
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={closeViewer}>
          <X />
        </Button>
        <Kbd>Esc</Kbd>
      </motion.header>
      {problem ? <p className="px-6 pb-2 text-[13px] text-destructive">{problem}</p> : null}
      <motion.div
        // Scrolls with the arrow keys once focused.
        tabIndex={0}
        className={cn(
          'min-h-0 flex-1 px-6 pt-1 outline-none',
          // basis-[100vh] asks for more than the sheet's most, so the frame takes every pixel the header leaves.
          pictured ? 'flex basis-[100vh] flex-col gap-3 overflow-hidden pb-5' : 'overflow-y-auto pb-6',
        )}
        initial={holdStill({ opacity: 0, transform: 'translateY(26px) scale(0.98)' }, still)}
        animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)' }, still)}
        transition={{ transform: spring.rise, opacity: tween.enter, delay: 0.08 }}
        key={contentKey}
      >
        {pictured ? <Picture state={state} /> : <Body state={state} />}
      </motion.div>
    </>
  )
}

function Body({ state }: { state: FileState }) {
  if (state.status === 'loading') return <p className="py-8 text-center text-[14px] text-muted-foreground">Reading the file...</p>
  if (state.status === 'refused') return <p className="py-8 text-center text-[14px] text-muted-foreground">{state.reason}</p>
  const { file } = state
  // Images go to Picture.
  if (file.kind === 'image') return null
  if (file.markdown) return <article className="text-[15px] leading-[1.65]"><Markdown text={file.text} /></article>
  if (file.text === '') return <p className="py-8 text-center text-[14px] text-muted-foreground">The file is empty.</p>
  return <Code text={file.text} path={file.path} />
}

/**
 * An image drawn whole inside the sheet, never larger than it is, with its size in pixels and bytes under it. Only
 * ever an `<img>`, so an SVG's script does not run. While it loads, or when it cannot be drawn, the frame stays.
 */
function Picture({ state }: { state: FileState }) {
  const [drawn, setDrawn] = useState<Drawn>(null)
  const file = state.status === 'ready' && state.file.kind === 'image' ? state.file : null
  const words = frameWords(state, drawn)
  const caption = captionOf(file, drawn)

  return (
    <>
      <div className="relative min-h-0 flex-1">
        {file && drawn !== 'broken' ? (
          <img
            src={file.url}
            alt={file.name}
            draggable={false}
            onLoad={(event) => setDrawn({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setDrawn('broken')}
            className={cn('absolute inset-0 m-auto max-h-full max-w-full transition-opacity duration-200', drawn ? 'opacity-100' : 'opacity-0')}
          />
        ) : null}
        {words ? <p className="absolute inset-0 flex items-center justify-center text-center text-[14px] text-muted-foreground">{words}</p> : null}
      </div>
      <p className="h-5 shrink-0 text-center text-[12.5px] leading-5 text-muted-foreground tabular-nums">{caption}</p>
    </>
  )
}

/** The image's size in pixels once the window has drawn it, or `broken` when it could not. */
type Drawn = { width: number; height: number } | 'broken' | null

/** What the frame says where the image would be: while the file is read, when it is refused, or when it cannot be drawn. */
function frameWords(state: FileState, drawn: Drawn): string | null {
  if (state.status === 'loading') return 'Reading the file...'
  if (state.status === 'refused') return state.reason
  if (drawn === 'broken') return 'This image cannot be drawn.'
  return null
}

/** The line under the image: its size in pixels and bytes, shown with the image once it is drawn. */
function captionOf(file: ImageFile | null, drawn: Drawn): string | null {
  if (!file || !drawn) return null
  const bytes = formatBytes(file.bytes)
  if (drawn === 'broken') return bytes
  return `${drawn.width} × ${drawn.height} px · ${bytes}`
}

/** Text that is not Markdown, as code: Shiki's colors for both themes, and plain text where it has none yet. */
function Code({ text, path }: { text: string; path: string }) {
  const lines = useMemo(() => text.replace(/\n$/, '').split('\n'), [text])
  const colored = lines.length <= HIGHLIGHT_LINES
  const highlighted = useHighlighted(colored ? text : null, languageOf(path))

  return (
    <pre className="dv-code overflow-x-auto rounded-xl bg-code-bg p-4 font-mono text-[13px] leading-[1.7] text-code-text">
      {lines.map((line, index) => {
        const parts = highlighted.lines[index]
        return (
          <div key={index} className="min-h-[1.7em]">
            {parts
              ? parts.map(([piece, style], at) => {
                  const look = highlighted.styles[style]
                  return (
                    <span
                      key={at}
                      style={look ? tokenStyle(look) : undefined}
                      data-li={look && look.lightFont & FONT.italic ? '' : undefined}
                      data-di={look && look.darkFont & FONT.italic ? '' : undefined}
                      data-lb={look && look.lightFont & FONT.bold ? '' : undefined}
                      data-db={look && look.darkFont & FONT.bold ? '' : undefined}
                    >
                      {piece}
                    </span>
                  )
                })
              : line}
          </div>
        )
      })}
    </pre>
  )
}
