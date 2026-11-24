import { RotateCw } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion, type Variants } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { IntegrationsState } from '#shared/integrations/wire.ts'
import { requestCanvasFocus } from '@/app/focus.ts'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { windowParts } from '@/integration/registry.ts'
import { useGitHub } from '@/lib/host/index.ts'
import { spring, stagger, staggerDelay } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { Detail } from './Detail.tsx'
import { GitHubCard } from './GitHubCard.tsx'
import { itemsOf, type Item } from './items.ts'
import { actionsFor, useServers } from './live.ts'
import { needsLook } from './source.ts'
import { ServerTile, useStill } from './tiles.tsx'
import { isArrowKey, walk, type Box } from './walk.ts'

/** The screen's own pieces land one after another, the largest first, once the screen has arrived. */
const pieces: Variants = {
  enter: {},
  center: { transition: { staggerChildren: stagger, delayChildren: staggerDelay } },
}

/** The controls the keyboard can reach in a layer (the tiles, or the open detail), as they are now. */
function stopsIn(layer: HTMLElement): HTMLElement[] {
  return [...layer.querySelectorAll<HTMLElement>('[data-key-stop]')].filter((stop) => !stop.matches(':disabled') && stop.getClientRects().length > 0)
}

function boxOf(element: HTMLElement): Box {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Where the servers on screen come from, and when they were looked at, in one line. */
function piLine(pi: IntegrationsState): string {
  const from = `From Pi's configuration, ${pi.path ?? 'which the host reads when asked'}.`
  if (pi.checking) return `${from} Looking at each server now.`
  if (!pi.checkedAt) return from
  return `${from} Looked at ${new Date(pi.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
}

/**
 * When the frame hands the keyboard to the screen, it lands on the first tile. The screen loads when it is
 * first opened, so the keyboard may have arrived before the tiles were drawn: then it lands as they are.
 */
function useLanding(root: RefObject<HTMLDivElement | null>, scroller: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const screen = root.current?.closest<HTMLElement>('[data-canvas-screen]')
    if (!screen) return
    const land = () => {
      const first = scroller.current ? stopsIn(scroller.current)[0] : undefined
      first?.focus({ preventScroll: true })
    }
    if (document.activeElement === screen) land()
    const onFocus = (event: FocusEvent) => {
      if (event.target === screen) land()
    }
    screen.addEventListener('focus', onFocus)
    return () => screen.removeEventListener('focus', onFocus)
  }, [root, scroller])
}

/**
 * Integrations: every service hobkin can reach, of two kinds. A full integration connects its own way and has a
 * whole page in the app: GitHub, through gh. Each one's window part draws its card, above the MCP servers in Pi's
 * configuration. A tile opens to its detail, which grows out of it. Spec: 023-integrations. This file is the entry the
 * frame mounts.
 *
 * Keys: the arrows move between tiles and controls by where they sit, Enter opens one, and Escape closes an open
 * detail. An Escape with nothing of the screen's own open is left for the frame, which steps back up to Settings.
 */
export function IntegrationsScreen() {
  // With a host, only what it read from Pi's configuration. Without one, the sample.
  const { live, servers, pi } = useServers()
  const actions = actionsFor(live)
  /** What the host said when connecting or removing did not happen. */
  const [notice, setNotice] = useState<string | null>(null)
  // GitHub connects through gh (024-github), apart from Pi's servers.
  const github = useGitHub()
  // The cards of the full integrations, from their window parts. The line for GitHub stays until its part has a card.
  const cards = windowParts().flatMap((part) => (part.card ? [{ id: part.manifest.id, Card: part.card }] : []))
  const showGitHub = !cards.some((card) => card.id === 'github')
  const items = useMemo(() => itemsOf(servers), [servers])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  /** What to do once the detail has gone back into its tile. */
  const afterClose = useRef<(() => void) | null>(null)
  const still = useStill()
  const open = openKey === null ? null : (items.find((item) => item.key === openKey) ?? null)

  useLanding(root, scroller)

  // Opening the screen with a host looks at Pi's servers once, unless that was done in the last minute.
  const looked = useRef(false)
  useEffect(() => {
    if (!live || looked.current || !needsLook(pi, Date.now())) return
    looked.current = true
    actions.refresh().catch((error: unknown) => setNotice(messageOf(error)))
  }, [live, pi, actions])

  // A server that went away while its detail was open takes the detail with it.
  useEffect(() => {
    if (openKey !== null && open === null) setOpenKey(null)
  }, [openKey, open])

  /** Puts the keyboard on a tile, or on the first one when that tile is gone, and brings it into view where it lands. */
  const focusTile = (key: string | null, travels = false) => {
    requestAnimationFrame(() => {
      const list = scroller.current
      if (!list) return
      const tile = (key ? list.querySelector<HTMLElement>(`[data-tile="${CSS.escape(key)}"]`) : null) ?? stopsIn(list)[0]
      if (!tile) return
      tile.focus({ preventScroll: true })
      // A tile on its way somewhere is measured once it has arrived.
      window.setTimeout(() => tile.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' }), travels && !still ? spring.screen.duration * 1000 : 0)
    })
  }

  const close = (then?: () => void) => {
    const key = openKey
    afterClose.current = then ?? (() => focusTile(key))
    setOpenKey(null)
  }

  // Removing waits for the detail to go back into its tile. With a host the tile goes once the host reports the change,
  // so the keyboard moves on to the next tile then.
  const remove = (item: Item) => {
    const keys = items.map((other) => other.key)
    const at = keys.indexOf(item.key)
    const next = keys[at + 1] ?? keys[at - 1] ?? null
    close(() => {
      setNotice(null)
      actions.remove(item.server.name).then(
        () => focusTile(next, true),
        (error: unknown) => setNotice(messageOf(error)),
      )
    })
  }

  const lookAgain = () => {
    setNotice(null)
    actions.refresh().catch((error: unknown) => setNotice(messageOf(error)))
  }

  /** Pages › GitHub, with the keyboard on the page once it has arrived. From GitHub's card. */
  const openGitHubPage = () => {
    useView.getState().openGitHub()
    requestCanvasFocus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Escape') {
      if (openKey === null) return
      event.preventDefault()
      close()
      return
    }
    if (event.shiftKey || !isArrowKey(event.key)) return
    // In a field, Left and Right move the caret.
    if (event.target instanceof HTMLInputElement && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
    const layer = openKey === null ? scroller.current : root.current?.querySelector<HTMLElement>('[data-detail]')
    if (!layer) return
    event.preventDefault()
    const stops = stopsIn(layer)
    const next = stops[walk(stops.map(boxOf), stops.indexOf(document.activeElement as HTMLElement), event.key)]
    if (!next || next === document.activeElement) return
    next.focus({ preventScroll: true })
    next.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
  }

  const working = items.filter((item) => item.server.state === 'connected').length
  const needLook = items.length - working
  const connectedLine = live
    ? pi
      ? piLine(pi)
      : "This host does not read Pi's configuration yet. Restart it to see your servers here."
    : "Sample data. Nothing here changes Pi's configuration yet."
  // What did not go as asked, then what Pi could not read: each in its own words.
  const notices = [...(notice ? [notice] : []), ...(pi?.error ? [pi.error] : []), ...(pi?.problems ?? []).map((problem) => `Pi skipped part of its configuration: ${problem}`)]

  return (
    <div ref={root} tabIndex={-1} onKeyDown={onKeyDown} className="relative h-full outline-none">
      <LayoutGroup id="integrations">
        <motion.div ref={scroller} layoutScroll inert={open !== null} className={`${SCREEN_SCROLLER} pb-12`}>
          {/* The screen loads on demand and may arrive after the canvas has played its entrance, so it starts its own. */}
          <motion.div variants={pieces} initial="enter" animate="center" className={`flex flex-col gap-12 ${SCREEN_COLUMN}`}>
            {cards.length > 0 || showGitHub ? (
              <Hero>
                <section aria-label="Full integrations" className="flex flex-col gap-4">
                  <KindHeading title="Full integrations" line="Each connects through a tool you already use, and has a whole page in hobkin." />
                  {showGitHub ? <GitHubCard github={github} still={still} onOpen={openGitHubPage} /> : null}
                  {cards.map(({ id, Card }) => (
                    <Card key={id} still={still} />
                  ))}
                </section>
              </Hero>
            ) : null}
            <section aria-label="MCP servers" className="flex flex-col gap-10">
              <Rise>
                <KindHeading title="MCP servers" line="Allow connections to the services you use. Each is an MCP server in Pi's configuration, and routines and agents use its tools." />
              </Rise>
              <Rise>
                <Part
                  label="In Pi's configuration"
                  title={items.length === 0 ? 'No servers yet' : needLook > 0 ? `${working} connected, ${needLook} need${needLook === 1 ? 's' : ''} a look` : `${working} connected`}
                  line={connectedLine}
                  aside={
                    live && pi ? (
                      <Button variant="outline" size="sm" data-key-stop="" aria-label="Check every server again" onClick={lookAgain} className="shrink-0">
                        <RotateCw className={cn(pi.checking && 'svc-spin')} aria-hidden="true" />
                        {pi.checking ? 'Looking' : 'Check again'}
                      </Button>
                    ) : null
                  }
                >
                  {notices.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {notices.map((text) => (
                        <li key={text} className="rounded-2xl bg-warn/15 px-4 py-2.5 text-[13px] break-words text-warn-fg">
                          {text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Grid
                    count={items.length}
                    empty={live && pi?.checking ? "Reading Pi's configuration." : 'Nothing in Pi\'s configuration yet.'}
                    className="gap-3 grid-cols-3 @max-[1000px]:grid-cols-2 @max-[640px]:grid-cols-1"
                  >
                    <AnimatePresence initial={false}>
                      {items.map((item) => (
                        <ServerTile key={item.key} item={item} live={live} still={still} onOpen={setOpenKey} />
                      ))}
                    </AnimatePresence>
                  </Grid>
                  <p className="text-[13px] text-muted-foreground">
                    Servers you add with <code className="font-mono text-[12px]">pi mcp add</code> show here, with their state and tools.
                  </p>
                </Part>
              </Rise>
            </section>
          </motion.div>
        </motion.div>
        <AnimatePresence
          onExitComplete={() => {
            const then = afterClose.current
            afterClose.current = null
            then?.()
          }}
        >
          {open ? (
            <Detail
              key={open.key}
              item={open}
              still={still}
              live={live}
              path={pi?.path ?? null}
              actions={actions}
              onClose={() => close()}
              onRemove={() => remove(open)}
            />
          ) : null}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  )
}

/** The heading of one kind of integration: full integrations, or MCP servers. */
function KindHeading({ title, line }: { title: string; line: string }) {
  return (
    <header>
      <h2 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em]">{title}</h2>
      <p className="mt-1 max-w-[72ch] text-[13px] text-muted-foreground">{line}</p>
    </header>
  )
}

/** A part of the screen: a label, a line that sums it up, and its tiles. The heading glides when the parts above it change size. */
function Part({ label, title, line, aside, children }: { label: string; title: string; line: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <motion.header layout="position" transition={spring.screen} className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="eyebrow">{label}</h3>
          <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">{title}</p>
          <p className="mt-1 text-[13px] break-words text-muted-foreground">{line}</p>
        </div>
        {aside}
      </motion.header>
      {children}
    </section>
  )
}

function Grid({ count, empty, className, children }: { count: number; empty: string; className: string; children: ReactNode }) {
  return (
    <motion.div layout="position" transition={spring.screen} className={cn('grid', className)}>
      {children}
      {count === 0 ? <p className="col-span-full rounded-[22px] border border-dashed border-border-strong/40 px-4 py-5 text-[13px] text-muted-foreground">{empty}</p> : null}
    </motion.div>
  )
}
