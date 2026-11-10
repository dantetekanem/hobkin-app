import { ArrowUpRight, CalendarClock, Eye, Info, LoaderCircle, LogIn, PenLine, Power, RotateCw, ShieldCheck, X } from 'lucide-react'
import { motion, type Variants } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { entryText, fillEntry, fillValue } from '#shared/integrations/entry.ts'
import { HIDDEN } from '#shared/integrations/redact.ts'
import { freeName, targetOf } from '#shared/integrations/servers.ts'
import type { CatalogEntry, ConfiguredServer, PiServerEntry, ServerTool } from '#shared/integrations/types.ts'
import type { GitHubConnection } from '#shared/protocol/github.ts'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useSettings } from '@/features/settings/store.ts'
import { spring, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { fillProblems, toolsOf } from './changes.ts'
import { ghLine } from './gh.ts'
import type { GhLink, Item } from './items.ts'
import type { IntegrationActions } from './live.ts'
import { ownMark, serviceMark } from './marks.ts'
import { sampleRoutines } from './sample-data.ts'
import { ServiceMark } from './ServiceMark.tsx'
import { GhChip, StateChip } from './tiles.tsx'

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
  /** Every configured server, to name a new one the way it would be added. */
  servers: readonly ConfiguredServer[]
  still: boolean
  /** Real data from a host: the actions change Pi's configuration, and nothing made up is shown. */
  live: boolean
  /** Pi's configuration file as the host names it. Null on sample data. */
  path: string | null
  actions: IntegrationActions
  onClose: () => void
  onConnect: (values: Record<string, string>) => void
  onRemove: () => void
  /** Opens the GitHub page. GitHub's detail only. */
  onOpenPage?: () => void
}

/** Puts the keyboard on the first action of the panel, or on the panel itself when there is none. */
function landIn(panel: HTMLElement) {
  const stops = [...panel.querySelectorAll<HTMLElement>('[data-key-stop]')].filter((stop) => !stop.matches(':disabled'))
  ;(stops.find((stop) => stop.hasAttribute('data-primary')) ?? stops.find((stop) => stop.hasAttribute('data-action')) ?? stops[0] ?? panel).focus({ preventScroll: true })
}

/**
 * A service's detail: what hobkin can do with it, its tools, its state, the routines that use it, the exact
 * entry it adds to Pi's configuration, the page it came from, and its actions. It grows out of the tile that
 * was chosen and goes back into it. A key is never typed here: the detail names the variable to set instead.
 */
export function Detail({ item, servers, still, live, path, actions, onClose, onConnect, onRemove, onOpenPage }: DetailProps) {
  const panel = useRef<HTMLElement | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [tried, setTried] = useState(false)
  /** What the host said when an action did not happen. It goes with the next action. */
  const [failure, setFailure] = useState<string | null>(null)
  const run = (action: () => Promise<void>) => {
    setFailure(null)
    action().catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)))
  }
  const server = item.server
  const entry = item.kind === 'service' ? item.entry : null
  const name = server?.name ?? freeName(entry!.id, servers.map((other) => other.name))
  const problems = entry && !server ? fillProblems(entry, values) : {}

  // The keyboard lands in the panel when it opens, and comes back to it when the control it was on goes away.
  useEffect(() => {
    if (panel.current && !panel.current.contains(document.activeElement)) landIn(panel.current)
  }, [server?.state])

  const connect = () => {
    if (!entry) return
    const missing = Object.keys(problems)
    if (missing.length === 0) return onConnect(values)
    setTried(true)
    panel.current?.querySelector<HTMLElement>(`[data-fill="${missing[0]}"]`)?.focus()
  }

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
        aria-label={`${entry?.name ?? name}, details`}
        style={{ borderRadius: 28 }}
        className="absolute inset-x-6 top-[112px] bottom-6 mx-auto flex max-w-[760px] flex-col overflow-hidden bg-background shadow-float outline-none"
      >
        <motion.div variants={contents} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-7 pt-6 pb-8">
          <div className="flex flex-col gap-7">
            <Head item={item} name={name} onClose={onClose} />
            {item.kind === 'service' && item.gh ? <ThroughGh gh={item.gh} onOpenPage={onOpenPage} /> : null}
            <Actions entry={entry} server={server} live={live} actions={actions} run={run} onConnect={connect} onRemove={onRemove} />
            {failure ? <p className="rounded-2xl bg-bad/10 px-4 py-3 text-[13px] text-bad-fg">{failure}</p> : null}
            <Notice entry={entry} server={server} live={live} />
            <CanDo entry={entry} server={server} />
            <Tools entry={entry} server={server} />
            {entry && entry.connect.env.length > 0 ? <Keys entry={entry} /> : null}
            {entry && !server && entry.connect.fills.length > 0 ? (
              <Fills entry={entry} values={values} problems={tried ? problems : {}} onChange={setValues} onConnect={connect} />
            ) : null}
            {entry && !server && entry.connect.before.length > 0 ? <Before steps={entry.connect.before} /> : null}
            {/* Which routines use a server is sample data until the host reports it. */}
            {live ? null : <Routines of={entry?.id ?? name} />}
            <Entry name={name} entry={server?.entry ?? previewOf(entry!, values)} configured={server !== null} path={path} />
            {entry && entry.notes.length > 0 ? <Notes notes={entry.notes} /> : null}
            <Source entry={entry} />
          </div>
        </motion.div>
      </motion.section>
    </motion.div>
  )
}

/** The entry a service would add, with whatever has been filled in so far written into it. */
function previewOf(entry: CatalogEntry, values: Readonly<Record<string, string>>): PiServerEntry {
  const filled: Record<string, string> = {}
  for (const fill of entry.connect.fills) {
    const result = fillValue(fill, values[fill.key] ?? '')
    if ('value' in result) filled[fill.key] = result.value
  }
  return fillEntry(entry.entry, filled)
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

function Head({ item, name, onClose }: { item: Item; name: string; onClose: () => void }) {
  const server = item.server
  const entry = item.kind === 'service' ? item.entry : null
  const target = server ? targetOf(server.entry) : null
  const look = entry ? serviceMark(entry.id) : ownMark(name)

  return (
    <header className="flex items-start gap-4">
      <ServiceMark look={look} size={60} layoutId={`mark-${item.key}`} />
      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em]">{entry?.name ?? name}</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">{entry?.line ?? server?.entry.description ?? target?.text}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-muted-foreground">
          {server ? (
            <StateChip server={server} long />
          ) : item.kind === 'service' && item.gh?.connection === 'connected' ? (
            <GhChip />
          ) : (
            <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-heading font-medium">Not connected</span>
          )}
          {entry ? (
            <span className="inline-flex items-center gap-1.5">
              {entry.fromVendor ? <ShieldCheck className="size-3.5 text-ok-fg" aria-hidden="true" /> : null}
              {entry.server}, by {entry.maker}
              {entry.fromVendor ? '' : ', not by the maker of the service'}
            </span>
          ) : (
            <span>Your own {target?.kind === 'command' ? 'local command' : 'remote server'}</span>
          )}
          {server && entry && server.name !== entry.id ? <span className="font-mono">{server.name}</span> : null}
        </div>
      </div>
      <Button variant="ghost" size="icon" aria-label="Close" data-key-stop="" onClick={onClose} className="-mt-1 -mr-2">
        <X />
      </Button>
    </header>
  )
}

/** What GitHub's detail says about gh, for each way gh can stand. */
const THROUGH_GH: Record<GitHubConnection, string> = {
  connected:
    'The GitHub page lists the pull requests waiting for your review, your own pull requests and your issues. It reads them with the login gh already has, and changes nothing on GitHub.',
  missing: "gh is GitHub's command line tool. Install it with brew install gh, then run gh auth login in Terminal. hobkin never asks for a token.",
  'signed-out': 'Run gh auth login in Terminal. hobkin uses the sign-in gh keeps, and never asks for a token.',
  unknown: 'hobkin is asking gh whether it is signed in.',
}

/**
 * GitHub connects through gh, with the login gh already has, and the GitHub page reads it (024-github). Its MCP
 * server below is another way in, for the tools agents use.
 */
function ThroughGh({ gh, onOpenPage }: { gh: GhLink; onOpenPage?: () => void }) {
  const showGitHubInMenu = useSettings((settings) => settings.showGitHubInMenu)
  const setShowGitHubInMenu = useSettings((settings) => settings.setShowGitHubInMenu)

  return (
    <Block label="Through gh">
      <p className="font-heading text-[15px] font-medium">{ghLine(gh)}</p>
      <p className="max-w-[64ch] text-[13px] text-muted-foreground">{THROUGH_GH[gh.connection]}</p>
      {onOpenPage ? (
        <Button className="w-fit" data-key-stop="" data-primary="" data-action="" onClick={onOpenPage}>
          <ArrowUpRight aria-hidden="true" />
          Open the GitHub page
        </Button>
      ) : null}
      <label className="flex items-center justify-between gap-3">
        <span className="font-heading text-[13px] font-medium">Show GitHub in the menu</span>
        <Switch checked={showGitHubInMenu} onCheckedChange={setShowGitHubInMenu} data-key-stop="" data-action="" />
      </label>
    </Block>
  )
}

interface ActionsProps {
  entry: CatalogEntry | null
  server: ConfiguredServer | null
  live: boolean
  actions: IntegrationActions
  /** Runs an action and shows why when it does not happen. */
  run: (action: () => Promise<void>) => void
  onConnect: () => void
  onRemove: () => void
}

function Actions({ entry, server, live, actions, run, onConnect, onRemove }: ActionsProps) {
  const [armed, setArmed] = useState(false)

  if (!server) {
    if (!entry) return null
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button data-key-stop="" data-primary="" data-action="" disabled={!entry.usable} onClick={onConnect}>
          Connect
        </Button>
        <span className="text-[13px] text-muted-foreground">{entry.connect.says}</span>
      </div>
    )
  }

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

function Notice({ entry, server, live }: { entry: CatalogEntry | null; server: ConfiguredServer | null; live: boolean }) {
  if (server?.state === 'sign-in' && live) {
    return (
      <p className="rounded-2xl bg-warn/15 px-4 py-3 text-[13px] leading-relaxed text-warn-fg">
        Pi needs you to sign in{entry ? ` to ${entry.name}` : ''}. In a terminal, run{' '}
        <code className="rounded-md bg-background/70 px-1.5 py-0.5 font-mono text-[12px] text-foreground">pi mcp login {server.name}</code>. Pi opens the page to approve in your browser and
        keeps the sign-in itself. Then check again here.
      </p>
    )
  }
  if (!server && entry && !entry.usable) {
    return <p className="rounded-2xl bg-warn/15 px-4 py-3 text-[13px] text-warn-fg">{entry.blocked}</p>
  }
  if (server?.state === 'failed') {
    return (
      <div className="flex flex-col gap-1.5 rounded-2xl bg-bad/10 px-4 py-3">
        <p className="eyebrow">Pi&apos;s message</p>
        <p className="font-mono text-[13px] break-words text-bad-fg">{server.error ?? 'It could not connect.'}</p>
      </div>
    )
  }
  if (server?.state === 'sign-in') {
    return (
      <p className="rounded-2xl bg-warn/15 px-4 py-3 text-[13px] text-warn-fg">
        Sign in opens {entry ? `${entry.name}'s` : 'its'} page in the browser. Once you approve, this shows connected, with no restart.
      </p>
    )
  }
  if (server?.state === 'off') {
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

function Column({ icon: Icon, title, lines }: { icon: typeof Eye; title: string; lines: string[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-tone-1 p-4">
      <p className="flex items-center gap-1.5 font-heading text-[13px] font-semibold">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
      </p>
      <ul className="flex flex-col gap-1.5 text-[13px] leading-snug">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

function CanDo({ entry, server }: { entry: CatalogEntry | null; server: ConfiguredServer | null }) {
  if (entry) {
    return (
      <Block label="What hobkin can do with it">
        <div className="grid grid-cols-2 gap-2.5 @max-[720px]:grid-cols-1">
          <Column icon={Eye} title="It can read" lines={entry.reads} />
          <Column icon={PenLine} title="It can change" lines={entry.changes} />
        </div>
      </Block>
    )
  }
  const tools = server?.tools ?? []
  const reads = tools.filter((tool) => tool.effect === 'reads').length
  return (
    <Block label="What hobkin can do with it">
      <p className="text-[13px] text-muted-foreground">
        hobkin knows a server of your own by its tools: {reads} that read, and {tools.length - reads} that change something.
      </p>
    </Block>
  )
}

function Tools({ entry, server }: { entry: CatalogEntry | null; server: ConfiguredServer | null }) {
  const reported = server?.state === 'connected' && server.tools.length > 0
  const tools = reported ? server.tools : server && !entry ? server.tools : toolsOf(entry)
  const reads = tools.filter((tool) => tool.effect === 'reads').length
  const caption = reported
    ? 'As the server reports them.'
    : !entry
      ? tools.length > 0
        ? 'As the server last reported them.'
        : 'They show here once it connects.'
      : tools.length > 0
        ? 'The ones the maker\'s page names. The full list comes from the server once it connects.'
        : 'The maker\'s page names none. They show here once it connects.'

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

/** "The Asana developer console" reads as "the Asana developer console" in the middle of a sentence. */
function inSentence(text: string): string {
  return text.startsWith('The ') ? `the ${text.slice(4)}` : text
}

function Keys({ entry }: { entry: CatalogEntry }) {
  return (
    <Block label="In your shell profile">
      {entry.connect.env.map((variable) => (
        <div key={variable.name} className="flex flex-col gap-2 rounded-2xl bg-tone-1 p-4">
          <p className="font-mono text-[13px] font-medium">{variable.name}</p>
          <p className="text-[13px]">
            {variable.holds}. Get it from {inSentence(variable.where)}.
          </p>
          <pre className="rounded-xl bg-code-bg px-3 py-2 font-mono text-[12px] text-code-text">export {variable.name}=</pre>
          <p className="text-[12px] text-muted-foreground">
            Set it in your shell profile, such as ~/.zshrc, with the value after the equals sign. The entry reads it from there, so hobkin never asks for it and never stores it.
          </p>
        </div>
      ))}
    </Block>
  )
}

function Fills({
  entry,
  values,
  problems,
  onChange,
  onConnect,
}: {
  entry: CatalogEntry
  values: Record<string, string>
  problems: Record<string, string>
  onChange: (values: Record<string, string>) => void
  onConnect: () => void
}) {
  return (
    <Block label="Fill in first">
      {entry.connect.fills.map((fill) => {
        const problem = problems[fill.key]
        return (
          <label key={fill.key} className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">{fill.label}</span>
            <input
              data-key-stop=""
              data-fill={fill.key}
              value={values[fill.key] ?? ''}
              placeholder={fill.example}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={problem ? true : undefined}
              onChange={(event) => onChange({ ...values, [fill.key]: event.target.value })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                onConnect()
              }}
              className={cn(
                'h-9 w-full rounded-full border bg-surface px-3.5 font-mono text-[13px] outline-offset-2 placeholder:text-muted-foreground/70',
                problem ? 'border-bad' : 'border-input',
              )}
            />
            <span className={cn('text-[12px]', problem ? 'text-bad-fg' : 'text-muted-foreground')}>{problem ?? 'Not a secret. It goes into the entry as it is.'}</span>
          </label>
        )
      })}
    </Block>
  )
}

function Before({ steps }: { steps: string[] }) {
  return (
    <Block label="Before you connect">
      <ol className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-[13px] leading-snug">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 font-heading text-[11px] font-semibold">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
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

/** The entry as it sits in the file. A name read from the shell is tinted, and a value still to fill in is marked. */
function Entry({ name, entry, configured, path }: { name: string; entry: PiServerEntry; configured: boolean; path: string | null }) {
  // A value the host hid shows as [hidden]. A reference to the environment stays, since it holds no secret.
  const parts = entryText(name, entry).split(/(\$\{[A-Z][A-Z0-9_]*\}|<[a-z][a-z0-9-]*>)/)
  return (
    <Block label="Its entry in Pi's configuration" aside={<span className="font-mono">{path ?? '~/.pi/agent/mcp.json'}</span>}>
      <pre className="scroll-quiet overflow-x-auto rounded-2xl bg-code-bg p-4 font-mono text-[12px] leading-[1.7] text-code-text">
        {parts.map((part, index) =>
          part.startsWith('${') ? (
            <span key={index} className="text-code-fg">
              {part}
            </span>
          ) : part.startsWith('<') && part.endsWith('>') ? (
            <mark key={index} className="rounded bg-warn/20 px-0.5 text-warn-fg">
              {part}
            </mark>
          ) : (
            part
          ),
        )}
      </pre>
      <p className="text-[12px] text-muted-foreground">
        {configured ? 'Under mcpServers, as Pi reads it.' : 'Connect adds this under mcpServers.'}
        {parts.some((part) => part.includes(HIDDEN)) ? ' A value written into it shows as [hidden], so no key leaves the host.' : ''} A name in {'${ }'} is read from your shell when Pi connects.
      </p>
    </Block>
  )
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <Block label="Good to know">
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note} className="flex gap-2 text-[13px] leading-snug">
            <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </Block>
  )
}

/** "2026-11-09" as "9 November 2026". */
export function checkedOn(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function Source({ entry }: { entry: CatalogEntry | null }) {
  if (!entry) {
    return (
      <Block label="Where this comes from">
        <p className="text-[13px] text-muted-foreground">You added it. hobkin shows it the way Pi reports it.</p>
      </Block>
    )
  }
  return (
    <Block label="Where this comes from">
      <a
        data-key-stop=""
        href={entry.source}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit max-w-full items-start gap-1.5 rounded-md font-mono text-[12px] break-all underline decoration-border-strong underline-offset-4 outline-offset-2 hover:decoration-foreground"
      >
        {entry.source}
        <ArrowUpRight className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      </a>
      <p className="text-[12px] text-muted-foreground">
        {entry.fromVendor ? `${entry.maker}'s own page` : 'The page'} this entry was read from, checked on {checkedOn(entry.checked)}.
      </p>
    </Block>
  )
}
