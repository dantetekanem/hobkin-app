import { CalendarClock, Eye, LoaderCircle, LogIn, PenLine, Power, RotateCw, X } from 'lucide-react'
import { motion, type Variants } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { entryText } from '#shared/integrations/entry.ts'
import { HIDDEN } from '#shared/integrations/redact.ts'
import { targetOf } from '#shared/integrations/servers.ts'
import type { ConfiguredServer, PiServerEntry, ServerTool } from '#shared/integrations/types.ts'
import { Button } from '@/components/ui/button.tsx'
import { spring, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { Item } from './items.ts'
import type { IntegrationActions } from './live.ts'
import { ownMark } from './marks.ts'
import { sampleRoutines } from './sample-data.ts'
import { ServiceMark } from './ServiceMark.tsx'
import { StateChip } from './tiles.tsx'

/** How far the screen behind the detail blurs, and how much of the canvas's own color settles over it. */
const BLUR = 'blur(10px)'
const TINT = 0.6

// The blur radius itself animates. A blurred backdrop that faded with a parent's opacity would pop instead.
const backdrop = (still: boolean): Variants => ({
  away: { backdropFilter: 'blur(0px)', transition: tween.exit },
  here: { backdropFilter: still ? 'blur(0px)' : BLUR, transition: spring.sheet },
})
const tint: Variants = {
  away: { opacity: 0, transition: tween.exit },
  here: { opacity: TINT, transition: spring.sheet },
}
// The panel grows out of the tile. What it holds fades in once it is under way, so nothing is seen stretched.
const contents: Variants = {
  away: { opacity: 0, transition: tween.exit },
  here: { opacity: 1, transition: { ...tween.enter, delay: staggerDelay } },
}

interface DetailProps {
  item: Item
  still: boolean
  /** Real data from a host: the actions change Pi's configuration, and nothing made up is shown. */
  live: boolean
  /** Pi's configuration file as the host names it. Null on sample data. */
  path: string | null
  actions: IntegrationActions
  onClose: () => void
  onRemove: () => void
}

/** Puts the keyboard on the first action of the panel, or on the panel itself when there is none. */
function landIn(panel: HTMLElement) {
  const stops = [...panel.querySelectorAll<HTMLElement>('[data-key-stop]')].filter((stop) => !stop.matches(':disabled'))
  ;(stops.find((stop) => stop.hasAttribute('data-primary')) ?? stops.find((stop) => stop.hasAttribute('data-action')) ?? stops[0] ?? panel).focus({ preventScroll: true })
}

/**
 * A server's detail: its state, what it can do, its tools, the routines that use it, its entry in Pi's configuration,
 * and its actions. It grows out of the tile that was chosen and goes back into it.
 */
export function Detail({ item, still, live, path, actions, onClose, onRemove }: DetailProps) {
  const panel = useRef<HTMLElement | null>(null)
  /** What the host said when an action did not happen. It goes with the next action. */
  const [failure, setFailure] = useState<string | null>(null)
  const run = (action: () => Promise<void>) => {
    setFailure(null)
    action().catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)))
  }
  const server = item.server

  // The keyboard lands in the panel when it opens, and comes back to it when the control it was on goes away.
  useEffect(() => {
    if (panel.current && !panel.current.contains(document.activeElement)) landIn(panel.current)
  }, [server?.state])

  return (
    <motion.div className="absolute inset-0 z-20" initial="away" animate="here" exit="away">
      <motion.div className="absolute inset-0" variants={backdrop(still)} />
      <motion.div className="absolute inset-0 bg-surface" variants={tint} onClick={onClose} />
      <motion.section
        ref={panel}
        layoutId={`svc-${item.key}`}
        transition={spring.sheet}
        data-detail=""
        tabIndex={-1}
        aria-label={`${server.name}, details`}
        style={{ borderRadius: 28 }}
        className="absolute inset-x-6 top-[112px] bottom-6 mx-auto flex max-w-[760px] flex-col overflow-hidden bg-background shadow-float outline-none"
      >
        <motion.div variants={contents} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-7 pt-6 pb-8">
          <div className="flex flex-col gap-7">
            <Head item={item} onClose={onClose} />
            <Actions server={server} live={live} actions={actions} run={run} onRemove={onRemove} />
            {failure ? <p className="rounded-2xl bg-bad/10 px-4 py-3 text-[13px] text-bad-fg">{failure}</p> : null}
            <Notice server={server} live={live} />
            <CanDo server={server} />
            <Tools server={server} />
            {/* Which routines use a server is sample data until the host reports it. */}
            {live ? null : <Routines of={server.name} />}
            <Entry name={server.name} entry={server.entry} path={path} />
          </div>
        </motion.div>
      </motion.section>
    </motion.div>
  )
}

function Block({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="eyebrow">{label}</h3>
        {aside ? <span className="text-[12px] text-muted-foreground">{aside}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Head({ item, onClose }: { item: Item; onClose: () => void }) {
  const server = item.server
  const target = targetOf(server.entry)

  return (
    <header className="flex items-start gap-4">
      <ServiceMark look={ownMark(server.name)} size={60} layoutId={`mark-${item.key}`} />
      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em]">{server.name}</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">{server.entry.description ?? target.text}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-muted-foreground">
          <StateChip server={server} long />
          <span>{target.kind === 'command' ? 'A local command' : 'A remote server'}</span>
        </div>
      </div>
      <Button variant="ghost" size="icon" aria-label="Close" data-key-stop="" onClick={onClose} className="-mt-1 -mr-2">
        <X />
      </Button>
    </header>
  )
}

interface ActionsProps {
  server: ConfiguredServer
  live: boolean
  actions: IntegrationActions
  /** Runs an action and shows why when it does not happen. */
  run: (action: () => Promise<void>) => void
  onRemove: () => void
}

function Actions({ server, live, actions, run, onRemove }: ActionsProps) {
  const [armed, setArmed] = useState(false)

  const name = server.name
  // With a host, signing in happens in a terminal with `pi mcp login`, so the way on is to look again afterwards.
  const primary =
    server.state === 'sign-in'
      ? live
        ? { label: 'Check again', icon: RotateCw, go: () => actions.signIn(name) }
        : { label: 'Sign in', icon: LogIn, go: () => actions.signIn(name) }
      : server.state === 'failed'
        ? { label: 'Try again', icon: RotateCw, go: () => actions.retry(name) }
        : server.state === 'off'
          ? { label: 'Turn on', icon: Power, go: () => actions.turnOn(name) }
          : null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {server.state === 'connecting' ? (
        <Button disabled>
          <LoaderCircle className="svc-spin" aria-hidden="true" />
          Connecting
        </Button>
      ) : null}
      {primary ? (
        <Button data-key-stop="" data-primary="" data-action="" onClick={() => run(primary.go)}>
          <primary.icon aria-hidden="true" />
          {primary.label}
        </Button>
      ) : null}
      {server.state !== 'off' ? (
        <Button variant="outline" data-key-stop="" data-action="" onClick={() => run(() => actions.turnOff(name))}>
          <Power aria-hidden="true" />
          Turn off
        </Button>
      ) : null}
      {/* Removing deletes the entry, so the first press only asks. */}
      <Button variant="destructive" data-key-stop="" data-action="" onBlur={() => setArmed(false)} onClick={() => (armed ? onRemove() : setArmed(true))}>
        {armed ? 'Press again to remove' : 'Remove'}
      </Button>
    </div>
  )
}

function Notice({ server, live }: { server: ConfiguredServer; live: boolean }) {
  if (server.state === 'sign-in' && live) {
    return (
      <p className="rounded-2xl bg-warn/15 px-4 py-3 text-[13px] leading-relaxed text-warn-fg">
        Pi needs you to sign in to {server.name}. In a terminal, run{' '}
        <code className="rounded-md bg-background/70 px-1.5 py-0.5 font-mono text-[12px] text-foreground">pi mcp login {server.name}</code>. Pi opens the page to approve in your browser and
        keeps the sign-in itself. Then check again here.
      </p>
    )
  }
  if (server.state === 'failed') {
    return (
      <div className="flex flex-col gap-1.5 rounded-2xl bg-bad/10 px-4 py-3">
        <p className="eyebrow">Pi&apos;s message</p>
        <p className="font-mono text-[13px] break-words text-bad-fg">{server.error ?? 'It could not connect.'}</p>
      </div>
    )
  }
  if (server.state === 'sign-in') {
    return (
      <p className="rounded-2xl bg-warn/15 px-4 py-3 text-[13px] text-warn-fg">
        Sign in opens its page in the browser. Once you approve, this shows connected, with no restart.
      </p>
    )
  }
  if (server.state === 'off') {
    return <p className="rounded-2xl bg-tone-1 px-4 py-3 text-[13px] text-muted-foreground">Kept in Pi&apos;s configuration with enabled set to false. Pi does not connect to it, and no routine can use it.</p>
  }
  return null
}

function Effect({ effect }: { effect: ServerTool['effect'] }) {
  const Icon = effect === 'reads' ? Eye : PenLine
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-heading text-[11px] font-medium', effect === 'reads' ? 'bg-surface-2 text-muted-foreground' : 'bg-warn/15 text-warn-fg')}>
      <Icon className="size-3" aria-hidden="true" />
      {effect}
    </span>
  )
}

function CanDo({ server }: { server: ConfiguredServer }) {
  const reads = server.tools.filter((tool) => tool.effect === 'reads').length
  return (
    <Block label="What hobkin can do with it">
      <p className="text-[13px] text-muted-foreground">
        hobkin knows a server by its tools: {reads} that read, and {server.tools.length - reads} that change something.
      </p>
    </Block>
  )
}

function Tools({ server }: { server: ConfiguredServer }) {
  const tools = server.tools
  const reads = tools.filter((tool) => tool.effect === 'reads').length
  const caption = server.state === 'connected' ? 'As the server reports them.' : tools.length > 0 ? 'As the server last reported them.' : 'They show here once it connects.'

  return (
    <Block label="Tools" aside={tools.length > 0 ? `${reads} read, ${tools.length - reads} change` : undefined}>
      <p className="text-[12px] text-muted-foreground">{caption}</p>
      {tools.length > 0 ? (
        <ul className="grid grid-cols-2 gap-1.5 @max-[720px]:grid-cols-1">
          {tools.map((tool) => (
            <li key={tool.name} className="flex min-w-0 items-center gap-2 rounded-xl bg-tone-1 py-1.5 pr-1.5 pl-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px]">{tool.name}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{tool.does}</span>
              </span>
              <Effect effect={tool.effect} />
            </li>
          ))}
        </ul>
      ) : null}
    </Block>
  )
}

function Routines({ of }: { of: string }) {
  const routines = sampleRoutines(of)
  return (
    <Block label="Routines that use it">
      {routines.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {routines.map((routine) => (
            <li key={routine} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-tone-1 px-3 text-[13px]">
              <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {routine}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">No routine uses it yet.</p>
      )}
    </Block>
  )
}

/** The entry as it sits in the file. A name read from the shell is tinted. */
function Entry({ name, entry, path }: { name: string; entry: PiServerEntry; path: string | null }) {
  // A value the host hid shows as [hidden]. A reference to the environment stays, since it holds no secret.
  const parts = entryText(name, entry).split(/(\$\{[A-Z][A-Z0-9_]*\})/)
  return (
    <Block label="Its entry in Pi's configuration" aside={<span className="font-mono">{path ?? '~/.pi/agent/mcp.json'}</span>}>
      <pre className="scroll-quiet overflow-x-auto rounded-2xl bg-code-bg p-4 font-mono text-[12px] leading-[1.7] text-code-text">
        {parts.map((part, index) =>
          part.startsWith('${') ? (
            <span key={index} className="text-code-fg">
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </pre>
      <p className="text-[12px] text-muted-foreground">
        Under mcpServers, as Pi reads it.
        {parts.some((part) => part.includes(HIDDEN)) ? ' A value written into it shows as [hidden], so no key leaves the host.' : ''} A name in {'${ }'} is read from your shell when Pi connects.
      </p>
    </Block>
  )
}
