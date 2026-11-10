import { AnimatePresence, motion } from 'motion/react'
import { ExternalLink, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { holdStill, useStill } from '@/app/still.ts'
import { runCommand, useHasHost, useHost } from '@/lib/host/index.ts'
import { spring } from '@/lib/motion.ts'
import { isLocalPage } from '#shared/protocol/canvas.ts'
import { labelFor, LOAD_PATIENCE_MS, PANEL_WIDTH, sandboxFor } from './rules.ts'
import { useCanvasPanel } from './store.ts'

const KEY_STEP = 0.03
const inMacWindow = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

declare global {
  interface Window {
    /** Development only: opens and closes the panel by hand, for checks. */
    __canvasDev?: { show: (url: string, title?: string) => void; close: () => void }
  }
}

/**
 * The canvas: a panel that slides in from the right over the screens and shows a page in an iframe, so hobkin can
 * show work happening for real. hobkin opens it through the host (`canvas.show`); the user can close it.
 *
 * Mount it once, inside the area it should cover (that area must be `relative`): `<CanvasPanel />`.
 */
export function CanvasPanel() {
  const { open, url, title, reloads, width, close: closeHere, reload, resize } = useCanvasPanel()
  const hostCanvas = useHost((state) => state.canvas)
  const hasHost = useHasHost()
  const still = useStill()
  const area = useRef<HTMLElement | null>(null)

  // What hobkin opened or closed through the host.
  useEffect(() => {
    if (hostCanvas) useCanvasPanel.getState().apply(hostCanvas)
  }, [hostCanvas])

  const close = () => {
    closeHere()
    if (hasHost) void runCommand('canvas.close').catch(() => {})
  }

  // Escape sends it away, wherever the keyboard is in the window.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  // A way to open it by hand while developing.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__canvasDev = { show: (page, name) => useCanvasPanel.getState().show(page, name ?? null), close: () => useCanvasPanel.getState().close() }
    return () => void delete window.__canvasDev
  }, [])

  const openInBrowser = () => {
    if (!url) return
    if (hasHost) void runCommand('system.open', { url }).catch(() => {})
    else if (!inMacWindow) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <AnimatePresence>
      {open && url ? (
        <motion.aside
          key="canvas-panel"
          data-canvas-panel
          aria-label="Canvas"
          className="absolute inset-y-0 right-0 z-20 flex min-w-0 flex-col overflow-hidden rounded-l-2xl border-l border-border bg-card shadow-[0_0_48px_-12px_rgb(0_0_0/0.35)]"
          style={{ width: `${width * 100}%` }}
          initial={holdStill({ transform: 'translateX(100%)', opacity: 0 }, still)}
          animate={{ transform: 'translateX(0%)', opacity: 1, transition: spring.sheet }}
          exit={holdStill({ transform: 'translateX(100%)', opacity: 0, transition: { ...spring.sheet, duration: 0.3 } }, still)}
          ref={(node) => void (area.current = node?.parentElement ?? null)}
        >
          <Edge width={width} resize={resize} area={area} />
          <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-4">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={url}>
              {labelFor(url, title)}
            </span>
            <BarButton label="Reload" onClick={reload}>
              <RotateCw className="size-3.5" />
            </BarButton>
            {hasHost || !inMacWindow ? (
              <BarButton label="Open in the browser" onClick={openInBrowser}>
                <ExternalLink className="size-3.5" />
              </BarButton>
            ) : null}
            <BarButton label="Close" onClick={close}>
              <X className="size-3.5" />
            </BarButton>
          </header>
          <Page key={`${url}#${reloads}`} url={url} title={title} onOpenInBrowser={openInBrowser} />
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

/** The page, and the plain words when it does not arrive. */
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
    <div className="relative min-h-0 flex-1 bg-background">
      <iframe
        title={labelFor(url, title)}
        src={url}
        sandbox={sandboxFor(url)}
        referrerPolicy="no-referrer"
        className="size-full border-0 bg-white"
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)}
      />
      {refused ? (
        <div role="status" className="absolute inset-0 grid place-items-center bg-background p-8 text-center">
          <div className="flex max-w-xs flex-col items-center gap-3">
            <p className="text-[14px] font-medium">This page did not show here.</p>
            <p className="text-[13px] text-muted-foreground">
              {isLocalPage(url) ? 'It may not be running yet.' : 'It may refuse to be shown inside another app.'} You can open it in the browser instead.
            </p>
            <button type="button" className="rounded-full border border-border px-3 py-1 text-[13px] hover:bg-surface-2" onClick={onOpenInBrowser}>
              Open in the browser
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors duration-[160ms] hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  )
}

/** The panel's left edge: drag it, or focus it and use the arrow keys, to change how much of the area it covers. */
function Edge({ width, resize, area }: { width: number; resize: (share: number) => void; area: { current: HTMLElement | null } }) {
  const dragging = useRef(false)
  const [active, setActive] = useState(false)
  const share = (clientX: number) => {
    const box = area.current?.getBoundingClientRect()
    return box && box.width > 0 ? (box.right - clientX) / box.width : width
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the canvas"
      aria-valuemin={Math.round(PANEL_WIDTH.min * 100)}
      aria-valuemax={Math.round(PANEL_WIDTH.max * 100)}
      aria-valuenow={Math.round(width * 100)}
      tabIndex={0}
      className="group absolute inset-y-0 left-0 z-10 w-2.5 cursor-col-resize touch-none outline-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragging.current = true
        setActive(true)
      }}
      onPointerMove={(event) => dragging.current && resize(share(event.clientX))}
      onPointerUp={() => ((dragging.current = false), setActive(false))}
      onPointerCancel={() => ((dragging.current = false), setActive(false))}
      onDoubleClick={() => resize(PANEL_WIDTH.initial)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') resize(width + KEY_STEP)
        else if (event.key === 'ArrowRight') resize(width - KEY_STEP)
        else return
        event.preventDefault()
      }}
    >
      <span
        className={`absolute top-1/2 left-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong transition-opacity duration-[160ms] group-hover:opacity-60 group-focus-visible:opacity-100 ${active ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* While dragging, a page under the pointer would swallow the moves. */}
      {active ? <span className="fixed inset-0" /> : null}
    </div>
  )
}
