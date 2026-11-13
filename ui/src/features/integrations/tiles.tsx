import { AppWindow, Ban, CircleAlert, Globe, KeyRound, LoaderCircle, LogIn, MapPin, Power, SquareTerminal, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { targetOf } from '#shared/integrations/servers.ts'
import type { CatalogEntry, ConfiguredServer } from '#shared/integrations/types.ts'
import { useSettings } from '@/features/settings/store.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { Item } from './items.ts'
import { ownMark, serviceMark } from './marks.ts'
import { sampleRoutines } from './sample-data.ts'
import { ServiceMark } from './ServiceMark.tsx'

type ServiceItem = Extract<Item, { kind: 'service' }>
type OwnItem = Extract<Item, { kind: 'own' }>

/** True when the app should not move: Movement is Still, or it follows a Mac that asks for less. Pulses and blur are off then. */
export function useStill(): boolean {
  const movement = useSettings((state) => state.movement)
  const reduced = useReducedMotion()
  return movement === 'still' || (movement === 'system' && Boolean(reduced))
}

/**
 * Now and then, the name of one of a connected server's tools, as if hobkin were using it, for a moment.
 * This is sample life: the host will report real calls. Nothing moves when the app should be still.
 */
export function useBusy(server: ConfiguredServer | null, still: boolean): string | null {
  const [using, setUsing] = useState<string | null>(null)
  const tools = server?.state === 'connected' ? server.tools : null

  useEffect(() => {
    if (still || !tools || tools.length === 0) return
    let timer = 0
    const rest = () => {
      timer = window.setTimeout(use, 3200 + Math.random() * 7000)
    }
    const use = () => {
      setUsing(tools[Math.floor(Math.random() * tools.length)]!.name)
      timer = window.setTimeout(() => {
        setUsing(null)
        rest()
      }, 2200)
    }
    rest()
    return () => {
      window.clearTimeout(timer)
      setUsing(null)
    }
  }, [still, tools])

  return using
}

function toolCount(server: ConfiguredServer): string {
  return server.tools.length === 1 ? '1 tool' : `${server.tools.length} tools`
}

/** What a server's state reads as, in a few words. */
export function stateText(server: ConfiguredServer): string {
  switch (server.state) {
    case 'connected':
      return server.tools.length > 0 ? `Connected, ${toolCount(server)}` : 'Connected'
    case 'connecting':
      return 'Connecting'
    case 'sign-in':
      return 'Needs sign-in'
    case 'failed':
      return 'Failed'
    case 'off':
      return 'Off'
  }
}

const CHIP_TONE: Record<ConfiguredServer['state'], string> = {
  connected: 'bg-ok/15 text-ok-fg',
  connecting: 'bg-surface-2 text-muted-foreground',
  'sign-in': 'bg-warn/15 text-warn-fg',
  failed: 'bg-bad/15 text-bad-fg',
  off: 'bg-surface-2 text-muted-foreground',
}

/** A server's state as a small pill. A change of state swaps the pill on a spring. `long` spells connected out. */
export function StateChip({ server, long = false, className }: { server: ConfiguredServer; long?: boolean; className?: string }) {
  const label = server.state === 'connected' && !long && server.tools.length > 0 ? toolCount(server) : stateText(server)
  const Icon: LucideIcon | null = server.state === 'connecting' ? LoaderCircle : server.state === 'sign-in' ? LogIn : server.state === 'failed' ? CircleAlert : server.state === 'off' ? Power : null

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={server.state}
          initial={{ opacity: 0, transform: 'translateY(6px) scale(0.96)' }}
          animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: spring.alive }}
          exit={{ opacity: 0, transform: 'translateY(-6px) scale(0.96)', transition: tween.exit }}
          className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-heading text-[12px] font-medium whitespace-nowrap', CHIP_TONE[server.state])}
        >
          {Icon ? <Icon className={cn('size-3.5', server.state === 'connecting' && 'svc-spin')} aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />}
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/**
 * The one line under a configured tile's name: what it is doing now. It keeps its height, so a change never moves the
 * tiles around it. On sample data a connected one names the routines that use it, which the host does not report yet.
 */
function Now({ server, using, live, routinesOf }: { server: ConfiguredServer; using: string | null; live: boolean; routinesOf: string }) {
  const routines = live ? [] : sampleRoutines(routinesOf)
  const text =
    server.state === 'connected'
      ? using
        ? `using ${using}`
        : live
          ? 'Pi reaches it'
          : routines.length > 0
            ? `Used by ${routines.join(' and ')}`
            : 'No routine uses it yet'
      : server.state === 'connecting'
        ? 'Pi is connecting to it'
        : server.state === 'sign-in'
          ? 'Sign in to finish connecting'
          : server.state === 'failed'
            ? (server.error ?? 'It could not connect')
            : 'Kept in Pi\'s configuration, not used'

  return (
    <span className="relative mt-1.5 block h-[18px] overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, transform: 'translateY(8px)' }}
          animate={{ opacity: 1, transform: 'translateY(0px)', transition: tween.enter }}
          exit={{ opacity: 0, transform: 'translateY(-8px)', transition: tween.exit }}
          className={cn(
            'block truncate text-[12px] leading-[18px]',
            using ? 'font-mono text-foreground' : server.state === 'failed' ? 'text-bad-fg' : 'text-muted-foreground',
          )}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** How a service in the catalog connects, in a few words. */
export function hintOf(entry: CatalogEntry): { icon: LucideIcon; text: string } {
  if (!entry.usable) return { icon: Ban, text: 'Pi cannot use it yet' }
  if (entry.connect.kind === 'header') return { icon: KeyRound, text: 'Needs a key' }
  if (entry.connect.kind === 'command') return { icon: SquareTerminal, text: 'Runs on this Mac' }
  if (entry.connect.env.length > 0) return { icon: AppWindow, text: 'Needs an app of your own' }
  if (entry.connect.fills.length > 0) return { icon: MapPin, text: 'Needs its address' }
  return { icon: LogIn, text: 'Signs in' }
}

// The keyboard's ring is drawn inside the tile, because the tile clips what it holds while it changes size in flight.
const TILE_BUTTON =
  'flex w-full gap-3 rounded-[22px] text-left -outline-offset-2 scroll-mt-[124px] scroll-mb-6 transition-transform duration-[140ms] ease-out hover:bg-surface-2/50 active:scale-[0.985]'

/** A tile's body. It carries the layout id, so it travels between the parts of the screen and grows into the detail. */
function TileBody({ itemKey, children, className }: { itemKey: string; children: ReactNode; className?: string }) {
  return (
    <motion.div
      layout
      layoutId={`svc-${itemKey}`}
      transition={spring.screen}
      // Only a tile that leaves for good plays this: one of the person's own servers, removed.
      exit={{ opacity: 0, transform: 'translateY(10px) scale(0.96)', transition: tween.exit }}
      style={{ borderRadius: 22 }}
      className={cn('overflow-hidden bg-background', className)}
    >
      {children}
    </motion.div>
  )
}

interface TileProps<Of> {
  item: Of
  /** Real data from a host. Then nothing on the tile is made up: no tool in use, no routine. */
  live: boolean
  /** The app should not move. */
  still: boolean
  onOpen: (key: string) => void
}

/** A catalog service: compact while it waits in the catalog, fuller once it is configured. */
export function ServiceTile({ item, live, still, onOpen }: TileProps<ServiceItem>) {
  const { key, entry, server } = item
  // The pulse of a tool in use is sample life, so a live tile stays quiet until the host reports real calls.
  const using = useBusy(server, still || live)
  const hint = hintOf(entry)

  return (
    <TileBody itemKey={key}>
      <button
        type="button"
        data-key-stop=""
        data-tile={key}
        aria-label={`${entry.name}, ${server ? stateText(server) : `not connected. ${hint.text}`}`}
        onClick={() => onOpen(key)}
        className={cn(TILE_BUTTON, server ? 'items-start p-4' : 'items-center p-3')}
      >
        <ServiceMark look={serviceMark(entry.id)} size={server ? 44 : 36} layoutId={`mark-${key}`} busy={using !== null} />
        <motion.span layout="position" transition={spring.screen} className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-heading text-[15px] leading-tight font-semibold tracking-[-0.015em]">{entry.name}</span>
            {server ? <StateChip server={server} /> : null}
          </span>
          {server ? (
            <>
              <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{entry.line}</span>
              <Now server={server} using={using} live={live} routinesOf={entry.id} />
            </>
          ) : (
            <span className={cn('mt-0.5 flex items-center gap-1 text-[12px]', entry.usable ? 'text-muted-foreground' : 'text-warn-fg')}>
              <hint.icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{hint.text}</span>
            </span>
          )}
        </motion.span>
      </button>
    </TileBody>
  )
}

/** A server the person added themselves: its name, where it lives, its state and tools, and its last error. */
export function OwnTile({ item, live, still, onOpen }: TileProps<OwnItem>) {
  const { key, server } = item
  const using = useBusy(server, still || live)
  const target = targetOf(server.entry)
  const Where = target.kind === 'remote' ? Globe : SquareTerminal

  return (
    <TileBody itemKey={key}>
      <button
        type="button"
        data-key-stop=""
        data-tile={key}
        aria-label={`${server.name}, your own ${target.kind === 'remote' ? 'remote server' : 'local command'}, ${stateText(server)}`}
        onClick={() => onOpen(key)}
        className={cn(TILE_BUTTON, 'items-start p-4')}
      >
        <ServiceMark look={ownMark(server.name)} size={44} layoutId={`mark-${key}`} busy={using !== null} />
        <motion.span layout="position" transition={spring.screen} className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-heading text-[15px] leading-tight font-semibold tracking-[-0.015em]">{server.name}</span>
            <StateChip server={server} />
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
            <Where className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate font-mono text-[12px]">{target.text}</span>
          </span>
          <Now server={server} using={using} live={live} routinesOf={server.name} />
        </motion.span>
      </button>
    </TileBody>
  )
}
