import { CircleArrowUp, Folder, GitBranch, LoaderCircle, Package, RotateCw, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ExtensionEntry, ExtensionsState, PiPackage } from '#shared/pi-resources/wire.ts'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_SCROLLER_UNDER_SECOND_ROW } from '@/app/screen-layout.ts'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { Empty, messageOf, Notices, PageHeading, Part, pieces, sentence, timeOf, useLanding, walkWithArrows } from '@/features/skills/page-parts.tsx'
import { cn } from '@/lib/utils.ts'
import { extensionActions, useExtensions, useShownExtensions } from './store.ts'
import { needsUpdateCheck, updateLine } from './updates.ts'

/** What each extension built into Pi does, in Pi's own words for it. */
const BUILT_IN: Record<string, string> = {
  'llama.cpp': 'Local models from a llama.cpp router server.',
  codemode: "The codemode tool: the model writes a script that calls Pi's other tools.",
  'tool-search': 'The tool_search tool, which finds tools the model was not given and loads them.',
  mcp: "Connects Pi to MCP servers, so agents get the tools of the ones on the Integrations page.",
}

const KIND: Record<PiPackage['kind'], { icon: LucideIcon; label: string }> = {
  npm: { icon: Package, label: 'From npm' },
  git: { icon: GitBranch, label: 'From git' },
  local: { icon: Folder, label: 'A folder on this Mac' },
}

/** Where the list on the page comes from, and when Pi last checked for updates, in one line. */
function sourceLine(live: boolean, state: ExtensionsState | null, checking: boolean): string {
  if (!live) return "Sample data. Nothing here changes Pi's settings."
  if (!state) return "Reading Pi's packages and extensions."
  const from = `From Pi's settings, ${state.settings ?? 'which the host reads when asked'}.`
  if (checking) return `${from} Asking each package's registry for a newer version.`
  return state.updates.checkedAt ? `${from} ${sentence(`Checked for updates at ${timeOf(state.updates.checkedAt)}`)}` : from
}

function summaryOf(packages: readonly PiPackage[]): string {
  if (packages.length === 0) return 'No packages yet'
  const count = packages.length === 1 ? '1 package' : `${packages.length} packages`
  const updates = packages.filter(({ update }) => update === 'available').length
  return updates === 0 ? count : `${count}, ${updates} with an update`
}

/**
 * Pi extensions: every package in Pi's settings, with its version, whether an update is available and a switch for
 * each of its extensions, then the extensions in Pi's own folder and settings, and the ones built into Pi. With a
 * host, what shows is what it read from Pi, a switch changes Pi's settings through Pi's own code, and updates come
 * from Pi's own check, which only reads. Spec: 039-skills-and-extensions. This file is the entry the frame mounts.
 *
 * Keys: the arrows move between controls by where they sit. Escape is left for the frame, which steps back up to Settings.
 */
export function ExtensionsScreen() {
  const { live, state } = useShownExtensions()
  const actions = extensionActions(live)
  const turning = useExtensions((store) => store.turning)
  const asking = useExtensions((store) => store.checking)
  const [notice, setNotice] = useState<string | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const still = useStill()
  const checking = asking || state?.updates.checking === true

  useLanding(root, scroller)

  // Opening the page reads Pi's packages, then asks Pi to check for updates unless it did in the last ten minutes.
  useEffect(() => {
    let active = true
    const open = async () => {
      await actions.refresh()
      const checkIsStale = needsUpdateCheck(useExtensions.getState().live, Date.now())
      if (live && active && checkIsStale) await actions.checkUpdates()
    }

    setNotice(null)
    open().catch((error: unknown) => {
      if (active) setNotice(messageOf(error))
    })
    return () => {
      active = false
    }
  }, [actions, live])

  const turn = (entry: ExtensionEntry, on: boolean) => {
    setNotice(null)
    actions.turn(entry.path, on).catch((error: unknown) => setNotice(messageOf(error)))
  }

  const checkAgain = () => {
    setNotice(null)
    actions.checkUpdates().catch((error: unknown) => setNotice(messageOf(error)))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => walkWithArrows(event, scroller.current, still)

  const packages = state?.packages ?? []
  // What did not go as asked, then what kept Pi from reading, then what it could not read.
  const notices = [
    ...(notice ? [notice] : []),
    ...(state?.error ? [state.error] : []),
    ...(state?.problems ?? []),
  ]
  const row = (entry: ExtensionEntry, line?: string) => (
    <ExtensionRow key={entry.path} entry={entry} line={line} busy={turning.includes(entry.path)} onTurn={turn} />
  )

  return (
    <div ref={root} tabIndex={-1} onKeyDown={onKeyDown} className="relative h-full outline-none">
      <div ref={scroller} className={`${SCREEN_SCROLLER_UNDER_SECOND_ROW} pb-12`}>
        {/* The page loads on demand and may arrive after the canvas has played its entrance, so it starts its own. */}
        <motion.div variants={pieces} initial="enter" animate="center" className={`flex flex-col gap-12 ${SCREEN_COLUMN}`}>
          <Hero>
            <PageHeading
              title="Pi extensions"
              line="Packages and extensions that give Pi's agents more tools, commands and behavior. A switch writes Pi's settings, as pi config does, and takes hold when Pi next starts or reloads."
            />
          </Hero>
          <Rise>
            <Part
              label="Packages"
              title={state ? summaryOf(packages) : 'Reading'}
              line={sourceLine(live, state, checking)}
              aside={
                <Button variant="outline" size="sm" data-key-stop="" disabled={checking || !state} onClick={checkAgain}>
                  {checking ? <LoaderCircle className={cn(!still && 'animate-spin')} aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
                  {checking ? 'Checking' : 'Check for updates'}
                </Button>
              }
            >
              <Notices items={notices} />
              <div className="grid grid-cols-2 gap-3 @max-[760px]:grid-cols-1">
                {packages.length === 0 ? (
                  <Empty>{state ? 'Pi has no packages yet. pi install adds one.' : "Reading Pi's settings."}</Empty>
                ) : (
                  packages.map((pkg) => <PackageCard key={pkg.source} pkg={pkg} checking={checking} row={row} />)
                )}
              </div>
            </Part>
          </Rise>
          <Rise>
            <Part label="Your own" title={countOf(state?.own.length ?? 0)} line="In Pi's own extensions folder, and named in its settings.">
              {state && state.own.length > 0 ? (
                <ul className="flex flex-col gap-1.5 rounded-[22px] bg-background p-3">
                  {state.own.map((entry) => row(entry, entry.from === 'settings' ? "Named in Pi's settings" : "In Pi's extensions folder"))}
                </ul>
              ) : (
                <Empty>None of your own yet.</Empty>
              )}
            </Part>
          </Rise>
          <Rise>
            <Part label="Built into Pi" title={countOf(state?.builtIn.length ?? 0)} line="They come with Pi and update with it.">
              <ul className="flex flex-col gap-1.5 rounded-[22px] bg-background p-3">
                {(state?.builtIn ?? []).map((entry) => row(entry, BUILT_IN[entry.name]))}
              </ul>
            </Part>
          </Rise>
        </motion.div>
      </div>
    </div>
  )
}

const countOf = (count: number) => (count === 1 ? '1 extension' : `${count} extensions`)

/** One package: where it comes from, its version, what Pi's check found, and its extensions. */
function PackageCard({ pkg, checking, row }: { pkg: PiPackage; checking: boolean; row: (entry: ExtensionEntry) => ReactNode }) {
  const kind = KIND[pkg.kind]
  const update = updateLine(pkg, checking)
  return (
    <article aria-label={pkg.name} className="flex min-w-0 flex-col gap-3 rounded-[22px] bg-background p-4">
      <header className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-tone-1 text-muted-foreground" title={kind.label}>
          <kind.icon className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate font-heading text-[15px] leading-tight font-semibold tracking-[-0.015em]">{pkg.name}</h4>
          <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground" title={pkg.source}>
            {pkg.source}
          </p>
        </div>
        {pkg.version ? <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-surface-2 px-2.5 font-mono text-[11px] text-muted-foreground">{pkg.version}</span> : null}
      </header>
      <p className={cn('flex items-start gap-1.5 text-[12px]', update.tone === 'ok' ? 'text-ok-fg' : update.tone === 'warn' ? 'text-warn-fg' : 'text-muted-foreground')}>
        {update.tone === 'ok' ? <CircleArrowUp className="mt-px size-3.5 shrink-0" aria-hidden="true" /> : null}
        <span>{update.text}</span>
      </p>
      {pkg.extensions.length > 0 ? (
        <ul className="flex flex-col gap-1.5">{pkg.extensions.map((entry) => row(entry))}</ul>
      ) : (
        <p className="text-[12px] text-muted-foreground">{pkg.installed ? 'It brings no extensions.' : 'Its extensions show here once Pi installs it.'}</p>
      )}
      {pkg.skills > 0 ? <p className="text-[12px] text-muted-foreground">{pkg.skills === 1 ? 'It brings a skill too, on the Skills page.' : `It brings ${pkg.skills} skills too, on the Skills page.`}</p> : null}
    </article>
  )
}

/** One extension and its switch. */
function ExtensionRow({ entry, line, busy, onTurn }: { entry: ExtensionEntry; line?: string; busy: boolean; onTurn: (entry: ExtensionEntry, on: boolean) => void }) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-tone-1 py-2 pr-3 pl-3">
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-mono text-[12px]', !entry.on && 'text-muted-foreground')} title={entry.file ?? undefined}>
          {entry.name}
        </span>
        {line ? <span className="block text-[12px] text-muted-foreground">{line}</span> : null}
      </span>
      <span className="shrink-0 text-[12px] text-muted-foreground">{entry.on ? 'On' : 'Off'}</span>
      <Switch data-key-stop="" checked={entry.on} disabled={busy} aria-label={`${entry.name}, ${entry.on ? 'on' : 'off'}`} onCheckedChange={(on) => onTurn(entry, on)} />
    </li>
  )
}
