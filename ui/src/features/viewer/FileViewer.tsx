import { Dialog } from '@base-ui/react/dialog'
import { ExternalLink, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { focusHome } from '@/app/focus-home.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Markdown } from '@/features/chat/markdown.ts'
import '@/features/review/code/code.css'
import { languageOf } from '@/features/review/code/languages.ts'
import { FONT, tokenStyle } from '@/features/review/code/tokens.ts'
import { useHighlighted } from '@/features/review/code/use-highlighted.ts'
import { runCommand, useHasHost } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useViewer } from './store.ts'
import { useFile } from './use-file.ts'

/** Past this many lines a file is drawn plain: coloring every line of a huge file would stall the window. */
const HIGHLIGHT_LINES = 5000

/**
 * The file viewer (_specs/027-links-and-files): a sheet over a blurred window. A Markdown file is rendered the way
 * the chat renders it, any other text is code, and a file that cannot be shown says why in plain words.
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
        className="min-h-0 flex-1 overflow-y-auto px-6 pt-1 pb-6 outline-none"
        initial={holdStill({ opacity: 0, transform: 'translateY(26px) scale(0.98)' }, still)}
        animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)' }, still)}
        transition={{ transform: spring.rise, opacity: tween.enter, delay: 0.08 }}
        key={state.status === 'ready' ? state.file.path : state.status}
      >
        <Body state={state} />
      </motion.div>
    </>
  )
}

function Body({ state }: { state: ReturnType<typeof useFile> }) {
  if (state.status === 'loading') return <p className="py-8 text-center text-[14px] text-muted-foreground">Reading the file...</p>
  if (state.status === 'refused') return <p className="py-8 text-center text-[14px] text-muted-foreground">{state.reason}</p>
  const { file } = state
  if (file.markdown) return <article className="text-[15px] leading-[1.65]"><Markdown text={file.text} /></article>
  if (file.text === '') return <p className="py-8 text-center text-[14px] text-muted-foreground">The file is empty.</p>
  return <Code text={file.text} path={file.path} />
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
