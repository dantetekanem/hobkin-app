import { AnimatePresence, motion } from 'motion/react'
import { Download, ExternalLink, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { holdStill, useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { runCommand, useHasHost, useHost } from '@/lib/host/index.ts'
import { spring } from '@/lib/motion.ts'
import { isLocalPage, MAIN_CANVAS, type CanvasKind } from '#shared/protocol/canvas.ts'
import { canSave, canvasOwner, frameKey, labelFor, LOAD_PATIENCE_MS, PANEL_WIDTH, sandboxFor } from './rules.ts'
import { useCanvasPanel } from './store.ts'
import { BrowserPane, useShellBrowser } from './BrowserPane.tsx'
import { PanelButton } from './PanelButton.tsx'

const KEY_STEP = 0.03
const inMacWindow = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

declare global {
  interface Window {
    /** Development only: opens and closes the panel by hand, for checks. */
    __canvasDev?: {
      show: (url: string, title?: string, drawing?: { kind?: CanvasKind; revision?: number }) => void
      close: () => void
    }
  }
}

/**
 * The canvas: a panel that slides in from the right over the screens and shows a page in an iframe, so hobkin can
 * show work happening for real. hobkin opens it through the host (`canvas.show`); the user can close it.
 *
 * Mount it once, inside the area it should cover (that area must be `relative`): `<CanvasPanel />`.
 */
export function CanvasPanel() {
  const { open, url, title, kind, revision, reloads, width, saved, owner: shown, close: closeHere, reload, resize } = useCanvasPanel()
  const owner = useView(canvasOwner)
  const hostCanvas = useHost((state) => (owner === MAIN_CANVAS ? state.canvas : (state.canvases?.[owner] ?? null)))
  const hasHost = useHasHost()
  const still = useStill()
  const area = useRef<HTMLElement | null>(null)
  // With the shell's browser, a page is a real browser pane (036-canvas-browser). A drawing keeps its sandboxed frame.
  const browser = useShellBrowser()

  // The canvas of the page on screen, and what hobkin opened or closed through the host.
  useEffect(() => {
    useCanvasPanel.getState().sync(owner, hostCanvas)
  }, [owner, hostCanvas])

  // The commands act on the main hobkin's canvas with no `hobkin`, and on a durable hobkin's with its id.
  const ownerArgs = owner === MAIN_CANVAS ? {} : { hobkin: owner }

  const close = () => {
    closeHere()
    if (hasHost) void runCommand('canvas.close', ownerArgs).catch(() => {})
  }

  const save = () => void useCanvasPanel.getState().save(() => runCommand('canvas.save', ownerArgs))
  const openSaved = (path: string) => void runCommand('file.open', { path }).catch(() => {})

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
    window.__canvasDev = {
      show: (page, name, drawing) => useCanvasPanel.getState().show(page, name ?? null, drawing),
      close: () => useCanvasPanel.getState().close(),
    }
    return () => {
      delete window.__canvasDev
    }
  }, [])

  const openInBrowser = () => {
    if (!url) return
    if (hasHost) void runCommand('system.open', { url }).catch(() => {})
    else if (!inMacWindow) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <AnimatePresence>
      {open && url && shown === owner ? (
        <motion.aside
          key="canvas-panel"
          data-canvas-panel
          aria-label="Canvas"
          // The browser's address field puts the keyboard here on Escape, in the panel, which a second Escape closes.
          tabIndex={browser && kind === 'page' ? -1 : undefined}
          className="absolute inset-y-0 right-0 z-20 flex min-w-0 flex-col overflow-hidden rounded-l-2xl border-l border-border bg-card shadow-[0_0_48px_-12px_rgb(0_0_0/0.35)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          style={{ width: `${width * 100}%` }}
          initial={holdStill({ transform: 'translateX(100%)', opacity: 0 }, still)}
          animate={{ transform: 'translateX(0%)', opacity: 1, transition: spring.sheet }}
          exit={holdStill({ transform: 'translateX(100%)', opacity: 0, transition: { ...spring.sheet, duration: 0.3 } }, still)}
          ref={(node) => {
            area.current = node?.parentElement ?? null
          }}
        >
          <Edge width={width} resize={resize} area={area} />
          {browser && kind === 'page' ? (
            <BrowserPane
              key={shown}
              browser={browser}
              url={url}
              title={title}
              revision={revision}
              onClose={close}
              onOpenInBrowser={hasHost ? (page) => void runCommand('system.open', { url: page }).catch(() => {}) : null}
            />
          ) : (
            <>
              <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-4">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={url}>
                  {labelFor(url, title, kind)}
                </span>
                <PanelButton label="Reload" onClick={reload}>
                  <RotateCw className="size-3.5" />
                </PanelButton>
                {canSave(kind) && hasHost ? (
                  <PanelButton label="Save" onClick={save}>
                    <Download className="size-3.5" />
                  </PanelButton>
                ) : null}
                {hasHost || !inMacWindow ? (
                  <PanelButton label="Open in the browser" onClick={openInBrowser}>
                    <ExternalLink className="size-3.5" />
                  </PanelButton>
                ) : null}
                <PanelButton label="Close" onClick={close}>
                  <X className="size-3.5" />
                </PanelButton>
              </header>
              {saved ? <SavedNote saved={saved} onOpen={openSaved} /> : null}
              <Page key={frameKey(url, revision, reloads)} url={url} title={title} kind={kind} onOpenInBrowser={openInBrowser} />
            </>
          )}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

/** After Save: where the file went, with a button that opens it, or the host's sentence. */
function SavedNote({ saved, onOpen }: { saved: { path: string } | { error: string }; onOpen: (path: string) => void }) {
  const path = 'path' in saved ? saved.path : undefined
  const words = 'path' in saved ? `Saved to ${saved.path}` : saved.error
  return (
    <p role="status" className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-4 text-[12px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate" title={path}>
        {words}
      </span>
      {path !== undefined ? (
        <button type="button" className="shrink-0 rounded-full px-2 py-0.5 text-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpen(path)}>
          Open
        </button>
      ) : null}
    </p>
  )
}

/** The page, and the plain words when it does not arrive. */
function Page({ url, title, kind, onOpenInBrowser }: { url: string; title: string | null; kind: CanvasKind; onOpenInBrowser: () => void }) {
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
        title={labelFor(url, title, kind)}
        src={url}
        sandbox={sandboxFor(url, kind)}
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

/** The panel's left edge: drag it, or focus it and use the arrow keys, to change how much of the area it covers. */
function Edge({ width, resize, area }: { width: number; resize: (share: number) => void; area: { current: HTMLElement | null } }) {
  const dragging = useRef(false)
  const [active, setActive] = useState(false)

  const share = (clientX: number) => {
    const box = area.current?.getBoundingClientRect()
    return box && box.width > 0 ? (box.right - clientX) / box.width : width
  }

  const endDrag = () => {
    dragging.current = false
    setActive(false)
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
      onPointerMove={(event) => {
        if (dragging.current) resize(share(event.clientX))
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
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
      {/* While dragging, a page under the pointer would swallow the moves. The browser's page stays shown under it. */}
      {active ? <span data-canvas-shield className="fixed inset-0" /> : null}
    </div>
  )
}
