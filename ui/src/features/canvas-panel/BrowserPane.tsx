import { useIsPresent } from 'motion/react'
import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStill } from '@/app/still.ts'
import { shell, type BrowserShell, type BrowserShown } from '@/lib/native.ts'
import { PanelButton } from './PanelButton.tsx'
import { addressFrom, areaOf, barOf, covered, createNativeView, nativeShown, type NativeView } from './browser.ts'

/** The shell's browser, once it has said whether it has one. Asked when the panel first loads, so it is known by the time a page opens. */
let known: BrowserShell | null = null
void shell().then((offered) => {
  known = offered.browser
})

/** The canvas's browser when the shell has it, or null: the panel then frames pages as before. */
export function useShellBrowser(): BrowserShell | null {
  const [browser, setBrowser] = useState(known)
  useEffect(() => {
    let mounted = true
    void shell().then((offered) => {
      if (mounted) setBrowser(offered.browser)
    })
    return () => {
      mounted = false
    }
  }, [])
  return browser
}

/** The keyboard goes back to the panel, which a second Escape closes. */
const focusPanel = (from: Element) => from.closest<HTMLElement>('[data-canvas-panel]')?.focus()

/**
 * A page canvas as a real browser (_specs/036-canvas-browser): the bar has Back, Forward, Reload, an address field,
 * Open in the browser and Close, and the page shows in a native webview the shell lays exactly over the page area. A
 * native view draws over everything, so it hides whenever anything covers the area or the panel is leaving. What the
 * user browses to stays here: hobkin's canvas keeps the page hobkin showed.
 */
export function BrowserPane({ browser, url, title, revision, onClose, onOpenInBrowser }: {
  browser: BrowserShell
  url: string
  title: string | null
  revision: number | undefined
  onClose: () => void
  /** Null when there is no way to the Mac's browser. */
  onOpenInBrowser: ((page: string) => void) | null
}) {
  const present = useIsPresent()
  const still = useStill()
  const area = useRef<HTMLDivElement | null>(null)
  const view = useRef<NativeView | null>(null)
  const [shown, setShown] = useState<BrowserShown | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const bar = barOf({ url, title, shown, editing })

  // What the panel wants of the native view, read on every frame.
  const wanted = useRef({ url, visit: revision ?? 0, present })
  wanted.current = { url, visit: revision ?? 0, present }

  // The native view lives as long as this pane. Each frame: where the page area is, and whether anything covers it.
  // Only a change reaches the shell.
  useEffect(() => {
    const native = createNativeView(browser)
    view.current = native
    let frame = 0
    const tick = () => {
      const element = area.current
      const at = element ? areaOf(element.getBoundingClientRect(), { width: innerWidth, height: innerHeight }) : null
      const ours = ({ x, y }: { x: number; y: number }) => {
        const hit = document.elementFromPoint(x, y)
        // The edge's drag shield lies over the whole window while the panel is resized; it does not hide the page.
        return hit !== null && (element?.contains(hit) === true || hit.closest('[data-canvas-shield]') !== null)
      }
      const show = at !== null && nativeShown({ open: wanted.current.present, covered: covered(at, ours), area: at })
      void native.sync({ url: wanted.current.url, visit: wanted.current.visit, area: show ? at : null })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      view.current = null
      void native.close()
    }
  }, [browser])

  // What the browser shows: as it says, and once a second, since a page can change its address without loading.
  useEffect(() => {
    let mounted = true
    const take = (next: BrowserShown | null) => {
      if (mounted && next) setShown(next)
    }
    const stop = browser.onShown(take)
    const timer = setInterval(() => void browser.shown().then(take, () => {}), 1000)
    return () => {
      mounted = false
      clearInterval(timer)
      void stop.then((unlisten) => unlisten(), () => {})
    }
  }, [browser])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // Back to the panel, without closing it.
      event.preventDefault()
      setEditing(null)
      setRefusal(null)
      focusPanel(event.currentTarget)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const typed = addressFrom(event.currentTarget.value)
      if ('refused' in typed) {
        setRefusal(typed.refused)
        return
      }
      setRefusal(null)
      setEditing(null)
      void view.current?.go(typed.url)
      focusPanel(event.currentTarget)
    }
  }

  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-2">
        <PanelButton label="Back" disabled={!bar.back} onClick={() => void view.current?.back()}>
          <ArrowLeft className="size-3.5" />
        </PanelButton>
        <PanelButton label="Forward" disabled={!bar.forward} onClick={() => void view.current?.forward()}>
          <ArrowRight className="size-3.5" />
        </PanelButton>
        <PanelButton label="Reload" onClick={() => void view.current?.reload()}>
          <RotateCw className={`size-3.5 ${bar.loading && !still ? 'animate-spin' : ''}`} />
        </PanelButton>
        <span className="ml-1 max-w-[35%] min-w-0 shrink truncate text-[13px] font-medium" title={bar.label}>
          {bar.label}
        </span>
        <input
          aria-label="Address"
          value={bar.field}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onFocus={(event) => {
            setEditing(bar.field)
            event.currentTarget.select()
          }}
          onChange={(event) => {
            setEditing(event.currentTarget.value)
            setRefusal(null)
          }}
          onBlur={() => setEditing(null)}
          onKeyDown={onKeyDown}
          className="ml-1 h-7 min-w-0 flex-1 rounded-full bg-surface-2 px-3 text-[12.5px] text-muted-foreground outline-none focus:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        {onOpenInBrowser ? (
          <PanelButton label="Open in the browser" onClick={() => onOpenInBrowser(bar.opens)}>
            <ExternalLink className="size-3.5" />
          </PanelButton>
        ) : null}
        <PanelButton label="Close" onClick={onClose}>
          <X className="size-3.5" />
        </PanelButton>
      </header>
      {refusal ? (
        <p role="status" className="flex h-7 shrink-0 items-center border-b border-border px-4 text-[12px] text-muted-foreground">
          {refusal}
        </p>
      ) : null}
      {/* The native view lies exactly over this. */}
      <div ref={area} data-canvas-browser-area aria-busy={bar.loading} className="relative min-h-0 flex-1 bg-background" />
    </>
  )
}
