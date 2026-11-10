import { RotateCw } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion, type Variants } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { CATALOG, CHECKED } from '#shared/integrations/catalog.ts'
import { splitServers } from '#shared/integrations/servers.ts'
import type { CatalogEntry } from '#shared/integrations/types.ts'
import type { IntegrationsState } from '#shared/integrations/wire.ts'
import { focusCanvas } from '@/app/keys.ts'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useGitHub } from '@/lib/host/index.ts'
import { spring, stagger, staggerDelay } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { checkedOn, Detail } from './Detail.tsx'
import { withGh } from './gh.ts'
import { allItems, itemsOf, type Item } from './items.ts'
import { actionsFor, useServers } from './live.ts'
import { needsLook } from './source.ts'
import { OwnTile, ServiceTile, useStill } from './tiles.tsx'
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
 * Integrations: every service hobkin can reach. Three parts, in this order: what is connected, the catalog
 * of services that can be added, and the person's own servers. A tile opens to its detail, which grows out
 * of it. Spec: 023-integrations. This file is the entry the frame mounts.
 *
 * Keys: the arrows move between tiles by where they sit, Enter opens one, and Escape closes an open detail.
 * An Escape with nothing of the screen's own open is left for the frame, which steps back up to Settings.
 */
export function IntegrationsScreen() {
  // With a host, only what it read from Pi's configuration. Without one, the sample.
  const { live, servers, pi } = useServers()
  const actions = actionsFor(live)
  /** What the host said when connecting or removing did not happen. */
  const [notice, setNotice] = useState<string | null>(null)
  // GitHub connects through gh, so its tile follows how gh stands (024-github).
  const { connection, login, sample } = useGitHub()
  const items = useMemo(() => withGh(itemsOf(splitServers(servers)), { connection, login }), [servers, connection, login])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  /** What to do once the detail has gone back into its tile. */
  const afterClose = useRef<(() => void) | null>(null)
  const still = useStill()
  const open = openKey === null ? null : (allItems(items).find((item) => item.key === openKey) ?? null)

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

  // Connecting and removing wait for the detail to go back into its tile, so the tile is seen travelling to its new part.
  // With a host the tile moves once the host reports the change, so the keyboard follows it then.
  const connect = (entry: CatalogEntry, values: Record<string, string>) =>
    close(() => {
      setNotice(null)
      actions.connect(entry, values).then(
        () => focusTile(entry.id, true),
        (error: unknown) => setNotice(messageOf(error)),
      )
    })

  const remove = (item: Item) => {
    const keys = allItems(items).map((other) => other.key)
    const at = keys.indexOf(item.key)
    const next = item.kind === 'service' ? item.key : (keys[at + 1] ?? keys[at - 1] ?? null)
    close(() => {
      setNotice(null)
      ;(item.server ? actions.remove(item.server.name) : Promise.resolve()).then(
        () => focusTile(next, true),
        (error: unknown) => setNotice(messageOf(error)),
      )
    })
  }

  const lookAgain = () => {
    setNotice(null)
    actions.refresh().catch((error: unknown) => setNotice(messageOf(error)))
  }

  /** Pages › GitHub, with the keyboard on the page once it has arrived. From GitHub's detail. */
  const openGitHubPage = () => {
    useView.getState().openGitHub()
    requestAnimationFrame(focusCanvas)
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

  // GitHub works through gh, whatever its MCP server's state.
  const works = (item: Item) => item.server?.state === 'connected' || (item.kind === 'service' && item.gh?.connection === 'connected')
  const working = items.connected.filter(works).length
  const needLook = items.connected.length - working
  const fromMakers = CATALOG.every((entry) => entry.fromVendor)
  const connectedLine = live
    ? pi
      ? piLine(pi)
      : "This host does not read Pi's configuration yet. Restart it to see your servers here."
    : sample
      ? "Sample data. Nothing here changes Pi's configuration yet."
      : "Sample data, apart from GitHub through gh. Nothing here changes Pi's configuration yet."
  // What did not go as asked, then what Pi could not read: each in its own words.
  const notices = [...(notice ? [notice] : []), ...(pi?.error ? [pi.error] : []), ...(pi?.problems ?? []).map((problem) => `Pi skipped part of its configuration: ${problem}`)]

  return (
    <div ref={root} tabIndex={-1} onKeyDown={onKeyDown} className="relative h-full outline-none">
      <LayoutGroup id="integrations">
        <motion.div ref={scroller} layoutScroll inert={open !== null} className="scroll-quiet h-full overflow-y-auto px-6 pt-[116px] pb-12">
          {/* The screen loads on demand and may arrive after the canvas has played its entrance, so it starts its own. */}
          <motion.div variants={pieces} initial="enter" animate="center" className="mx-auto flex max-w-[1040px] flex-col gap-10">
            {/* Above the parts below it, so a tile flying up from the catalog passes over the tiles it crosses. */}
            <Hero className="relative z-10">
              <Part
                label="Connected"
                title={items.connected.length === 0 ? 'Nothing connected yet' : needLook > 0 ? `${working} connected, ${needLook} need${needLook === 1 ? 's' : ''} a look` : `${working} connected`}
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
                  count={items.connected.length}
                  empty={live && pi?.checking ? "Reading Pi's configuration." : 'Pick a service below to connect it.'}
                  className="gap-3 grid-cols-3 @max-[1000px]:grid-cols-2 @max-[640px]:grid-cols-1"
                >
                  {items.connected.map((item) => (item.kind === 'service' ? <ServiceTile key={item.key} item={item} live={live} still={still} onOpen={setOpenKey} /> : null))}
                </Grid>
              </Part>
            </Hero>
            <Rise>
              <Part
                label="Catalog"
                title={items.available.length === 0 ? 'Everything here is connected' : `${items.available.length} more hobkin can reach`}
                line={
                  fromMakers
                    ? `Each one is the maker's own server, read from the maker's page on ${checkedOn(CHECKED)}.`
                    : `Each one says whose server it is, read on ${checkedOn(CHECKED)}.`
                }
              >
                <Grid count={items.available.length} empty="Every service in the catalog is configured." className="grid-cols-4 gap-2.5 @max-[1000px]:grid-cols-3 @max-[760px]:grid-cols-2">
                  {items.available.map((item) => (item.kind === 'service' ? <ServiceTile key={item.key} item={item} live={live} still={still} onOpen={setOpenKey} /> : null))}
                </Grid>
              </Part>
            </Rise>
            <Rise>
              <Part
                label="Your own servers"
                title={items.own.length === 0 ? 'None yet' : items.own.length === 1 ? '1 server' : `${items.own.length} servers`}
                line={
                  <>
                    Servers you add with <code className="font-mono text-[12px]">pi mcp add</code> show here, with their state and tools.
                  </>
                }
              >
                <Grid count={items.own.length} empty="Nothing of your own yet." className="gap-3 grid-cols-2 @max-[760px]:grid-cols-1">
                  <AnimatePresence initial={false}>
                    {items.own.map((item) => (item.kind === 'own' ? <OwnTile key={item.key} item={item} live={live} still={still} onOpen={setOpenKey} /> : null))}
                  </AnimatePresence>
                </Grid>
              </Part>
            </Rise>
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
              servers={servers}
              still={still}
              live={live}
              path={pi?.path ?? null}
              actions={actions}
              onClose={() => close()}
              onConnect={(values) => {
                if (open.kind === 'service') connect(open.entry, values)
              }}
              onRemove={() => remove(open)}
              onOpenPage={open.kind === 'service' && open.gh ? openGitHubPage : undefined}
            />
          ) : null}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  )
}

/** One of the three parts: a label, a line that sums it up, and its tiles. The heading glides when the parts above it change size. */
function Part({ label, title, line, aside, children }: { label: string; title: string; line: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <motion.header layout="position" transition={spring.screen} className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="eyebrow">{label}</h2>
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
