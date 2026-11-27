import { Cpu, Gauge, Layers3, PencilLine, ScanSearch, Timer, type LucideIcon } from 'lucide-react'
import { memo, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { DialogTitle } from '@/components/ui/dialog.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
// The moving dots after what a running agent is doing (`aa-dots`).
import '@/features/agent-activity/agent-activity.css'
import { useNow } from '@/features/chat/use-now.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { ChildHood } from '@/features/work/ChildAgents.tsx'
import { describeChild } from '@/features/work/child-summary.ts'
import { cn } from '@/lib/utils.ts'
import { activityHeader, activityLine, agentName, shownRows, stepAgent, stillOut, type ActivityAgent, type ActivityLine } from './activity.ts'
import { describeTeamsAgent, type ShownTeamsAgent } from './rules.ts'
import { faceHue, TeamsAgentBody, TeamsFace } from './TeamsAgentBody.tsx'
import { closeNavigator, moveNavigator, openNavigator, useNavigator, useSubagents, type NavigatorOpen } from './use-activity.ts'

interface SubagentActivityProps {
  /** The agent whose agents these are, as the window names it: a run's id, `hobkin:<id>`, or `MAIN_ACTIVITY`. */
  agentId: string
  hue: number
  /** Its name, which the navigator's way back says. */
  name: string
  /** Down from its input opens the navigator, so the heading says so. hobkin's mind has no input of its own. */
  keys?: boolean
  className?: string
}

/**
 * An agent's agents under its input, as pi-extended-teams draws them under Pi's editor (046-teams-layer). The user,
 * 2026-11-27: "behind the input, showing a quick status update, tokens used, how long is running, if press down i can
 * see more in the screen like floating ... not the pill". A heading with how many are out, then one row each: its face
 * and name, what it is doing, and chips for the model and level it runs on, its tier, how long it has been out and what
 * its context holds. Down from the agent's empty input, or a click on a row, opens the navigator floating over the page.
 *
 * Its pi-extended-teams agents are shown and never controlled; hobkin's own helpers share the list as they shared the
 * header's lines. An agent with none draws nothing. It sits in the input's part, so it draws again only when what it
 * shows changes, never for a key typed in the input.
 */
export const SubagentActivity = memo(SubagentActivityView)

function SubagentActivityView({ agentId, hue, name, keys = true, className }: SubagentActivityProps) {
  const open = useNavigator((state) => (state.open?.agent === agentId ? state.open : null))
  const agents = useSubagents(agentId, open !== null)
  usePublishedRows(agentId, agents)

  if (agents.length === 0) return null
  return (
    <>
      <ActivityStrip agents={agents} hue={hue} keys={keys} onOpen={(at, from) => openNavigator(agentId, { at, from })} className={className} />
      <AgentNavigator agents={agents} open={open} hue={hue} name={name} />
    </>
  )
}

/** Tells the navigator which agents this strip draws, so Down in the input can open it. With none, or gone, it closes what it opened. */
function usePublishedRows(agentId: string, agents: readonly ActivityAgent[]) {
  const key = agents.map((agent) => agent.id).join('\n')

  useLayoutEffect(() => {
    const ids = key ? key.split('\n') : []
    useNavigator.setState((state) => ({
      rows: { ...state.rows, [agentId]: ids },
      open: state.open?.agent === agentId && ids.length === 0 ? null : state.open,
    }))
  }, [agentId, key])

  useLayoutEffect(() => {
    return () => {
      useNavigator.setState((state) => {
        const rows = { ...state.rows }
        delete rows[agentId]
        return { rows, open: state.open?.agent === agentId ? null : state.open }
      })
    }
  }, [agentId])
}

/** An agent's own color, as its face is tinted: its name. */
const tint = (hue: number): CSSProperties => ({ color: `oklch(var(--agent-l, 0.62) 0.11 ${hue})` })

/** Each agent keeps its face's hue by its name, so it keeps its color as it moves in the list. */
const agentHue = (pageHue: number, agent: ActivityAgent) => faceHue(pageHue, agentName(agent))

/** Everything a row knows, for a hover and a screen reader. */
function describe(agent: ActivityAgent, line: ActivityLine): string {
  const told = agent.kind === 'teams' ? describeTeamsAgent(agent.teams, Date.now()) : describeChild(agent.helper)
  if (!line.context) return told
  const share = line.context.share === undefined ? '' : `, ${line.context.share}% of its window`
  return `${told}; its context holds ${line.context.tokens} tokens${share}`
}

/*
 * The rows share one grid. Faces, names and what each is doing take the left, the text the room that is left over. Each
 * kind of chip has a column of its own on the right, as wide as its widest chip down the list, and each chip is as
 * wide as its words and keeps to its column's right edge, so the chips line up at the right with no empty room in them
 * (the user, 2026-11-27: "the badges should align (they in the right, text in the left), and they should not have
 * useless gap, like in seconds"). A column no row has anything for takes no room. On a narrow page the model and the
 * tier give way first.
 */
const LIST = 'grid grid-cols-[auto_minmax(0,max-content)_minmax(0,1fr)_auto_auto_auto_auto] gap-y-px'
const MODEL_CELL = 'col-start-4 hidden @3xl:flex'
const TIER_CELL = 'col-start-5 hidden @2xl:flex'
const TIME_CELL = 'col-start-6 flex'
const CONTEXT_CELL = 'col-start-7 flex'

/** A chip of a row, drawn as the GitHub page draws a stack's layer: an icon and its words in a rounded pill. */
const CHIP =
  'inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 font-heading text-[11.5px] font-medium whitespace-nowrap tabular-nums [&_svg]:size-3 [&_svg]:shrink-0'

/** One part as a chip at its column's right, or nothing when hobkin does not know it. */
function Chip({ icon: Icon, cell, shown, className, children }: { icon: LucideIcon; cell: string; shown: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn(cell, 'justify-end', shown && 'pl-1.5')}>
      {shown ? (
        <span className={cn(CHIP, className)}>
          <Icon aria-hidden="true" className="text-muted-foreground" />
          {children}
        </span>
      ) : null}
    </span>
  )
}

/** A teams tier says what kind of work it is: reading or writing. One of hobkin's tiers is only a level. */
function tierIcon(tier: string): LucideIcon {
  if (tier.startsWith('read')) return ScanSearch
  if (tier.startsWith('write')) return PencilLine
  return Layers3
}

/** pi-extended-teams warns at 75% and 90% of the window. */
function contextTone(share: number | undefined): string {
  if (share === undefined || share < 75) return ''
  return share < 90 ? 'text-warn-fg' : 'text-bad-fg'
}

/** The chips at the row's right, each in its own column. */
function Chips({ line }: { line: ActivityLine }) {
  const share = line.context?.share
  return (
    <>
      <Chip icon={Cpu} cell={MODEL_CELL} shown={line.model !== ''}>
        {line.model}
        {line.level ? <span className="text-muted-foreground">· {line.level}</span> : null}
      </Chip>
      <Chip icon={tierIcon(line.tier)} cell={TIER_CELL} shown={line.tier !== ''}>
        {line.tier}
      </Chip>
      <Chip icon={Timer} cell={TIME_CELL} shown={line.elapsed !== ''}>
        {line.elapsed}
      </Chip>
      <Chip icon={Gauge} cell={CONTEXT_CELL} shown={line.context !== null} className={contextTone(share)}>
        {line.context?.tokens}
        {share !== undefined ? <span className={contextTone(share) || 'text-muted-foreground'}>· {share}%</span> : null}
      </Chip>
    </>
  )
}

/** Its face, as hobkin draws an agent: a running one moves, and an ended one wears its mark. */
function AgentFace({ agent, hue }: { agent: ActivityAgent; hue: number }) {
  if (agent.kind === 'teams') return <TeamsFace agent={agent.teams} hue={hue} size={16} />
  return <ChildHood child={agent.helper} hue={agentHue(hue, agent)} size={16} />
}

/**
 * Its own words read a little softer than the page's text (the user, 2026-11-27: "a bit darker"); what it was asked, its
 * tool or its standing read quieter, and a failure in red.
 */
function doingTone(line: ActivityLine): string {
  if (line.tone === 'bad') return 'text-bad-fg'
  return line.ownWords ? 'text-foreground/80' : 'text-muted-foreground'
}

/**
 * What it is doing. While it runs, three dots that light in turn end it (the user: "have an … animated at the end, so we
 * see movement"). They stand where words cut short would end with "…", so a running row's words are cut plain.
 */
function Doing({ line }: { line: ActivityLine }) {
  const running = line.tone === 'live'
  return (
    <span className={cn('col-start-3 flex min-w-0 items-baseline pr-1.5 pl-2.5', doingTone(line))}>
      <span className={cn('min-w-0 truncate', running && '[text-overflow:clip]')}>{line.doing}</span>
      {running ? (
        <span aria-hidden="true" className="aa-dots shrink-0">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      ) : null}
    </span>
  )
}

interface RowProps {
  agent: ActivityAgent
  line: ActivityLine
  hue: number
  /** The one the navigator shows. */
  current?: boolean
  rowRef?: RefObject<HTMLButtonElement | null>
  onSelect: (from: HTMLElement) => void
}

/** One agent: its face and name, what it is doing, and its chips. A click opens it in the navigator. */
function AgentRow({ agent, line, hue, current = false, rowRef, onSelect }: RowProps) {
  return (
    <button
      ref={rowRef}
      type="button"
      aria-current={current || undefined}
      title={describe(agent, line)}
      onClick={(event) => onSelect(event.currentTarget)}
      className={cn(
        'col-span-full grid h-7 grid-cols-subgrid items-center rounded-lg px-1.5 text-left text-[12.5px] outline-none transition-colors duration-[140ms] ease-[ease] hover:bg-tone-1 focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]',
        current && 'bg-tone-2 hover:bg-tone-2',
      )}
    >
      <span className="col-start-1">
        <AgentFace agent={agent} hue={hue} />
      </span>
      <span className="col-start-2 max-w-[11.25rem] truncate pl-2.5 font-medium" style={tint(agentHue(hue, agent))}>
        {line.name}
      </span>
      <Doing line={line} />
      <Chips line={line} />
    </button>
  )
}

interface RowsProps {
  agents: readonly ActivityAgent[]
  hue: number
  label: string
  chosen?: string
  chosenRow?: RefObject<HTMLButtonElement | null>
  onSelect: (at: string, from: HTMLElement) => void
}

/** The rows, each on the clock: only they tick, once a second while one is out. */
function AgentRows({ agents, hue, label, chosen, chosenRow, onSelect }: RowsProps) {
  const models = useModelChoices()
  const now = useNow(agents.some(stillOut), 1000)
  return (
    <ul aria-label={label} className={LIST}>
      {agents.map((agent) => {
        const current = agent.id === chosen
        return (
          <li key={agent.id} className="col-span-full grid grid-cols-subgrid">
            <AgentRow
              agent={agent}
              line={activityLine(agent, now, models)}
              hue={hue}
              current={current}
              rowRef={current ? chosenRow : undefined}
              onSelect={(from) => onSelect(agent.id, from)}
            />
          </li>
        )
      })}
    </ul>
  )
}

interface StripProps {
  agents: readonly ActivityAgent[]
  hue: number
  keys: boolean
  onOpen: (at: string, from: HTMLElement) => void
  className?: string
}

/** The heading and the rows, as pi-extended-teams' activity widget reads: ten rows at most, the rest in the navigator. Exported for still renders. */
export function ActivityStrip({ agents, hue, keys, onOpen, className }: StripProps) {
  const { rows, more } = shownRows(agents)
  return (
    <section aria-label="Agent activity" className={cn('@container pt-1.5', className)}>
      <p className="flex h-6 items-center gap-2 px-1.5 text-[12px]">
        <span className="font-medium">Agent activity</span>
        <span className="text-muted-foreground tabular-nums">{activityHeader(agents)}</span>
        {keys ? (
          <span className="ml-auto flex items-center gap-1 text-[11.5px] text-muted-foreground">
            <Kbd className="h-4 min-w-4 px-1 text-[10.5px]">↓</Kbd>
            navigate
          </span>
        ) : null}
      </p>
      <AgentRows agents={rows} hue={hue} label="Its agents, running ones first" onSelect={onOpen} />
      {more ? (
        <p className="flex h-6 items-center px-1.5 text-[12px] text-muted-foreground">
          {more} more {more === 1 ? 'agent' : 'agents'} in the navigator
        </p>
      ) : null}
    </section>
  )
}

/** A helper's own: how it stands and what it runs on. hobkin keeps none of its steps. */
function HelperBody({ child, hue }: { child: RunChild; hue: number }) {
  return (
    <div className="flex items-start gap-3 text-[13px] leading-snug">
      <ChildHood child={child} hue={hue} size={30} />
      <div className="min-w-0 flex-1">
        <p>{describeChild(child)}.</p>
        <p className="mt-2 text-muted-foreground">One of hobkin's own helpers. hobkin keeps none of a helper's steps, so there is nothing more of its work to show.</p>
      </div>
    </div>
  )
}

/** Where hobkin read a teams agent from, and that it only shows it. */
function sourceNote(agent: ShownTeamsAgent): string {
  const source = agent.from === 'teams' ? 'Read from pi-extended-teams’ own files.' : 'From the run’s own calls to pi-extended-teams.'
  return `${source} hobkin shows these agents and does not control them.`
}

const NAVIGATOR_KEYS: readonly { key: string; does: string }[] = [
  { key: '↑', does: 'previous' },
  { key: '↓', does: 'next agent' },
  { key: '←→', does: 'agent' },
  { key: 'PgUp PgDn', does: 'scroll' },
  { key: 'End', does: 'follow' },
  { key: 'esc', does: 'back' },
]

/** Near the bottom counts as at the bottom, so new steps keep it there. */
const atBottom = (element: HTMLElement) => element.scrollHeight - element.scrollTop - element.clientHeight < 24

interface NavigatorProps {
  agents: readonly ActivityAgent[]
  open: NavigatorOpen | null
  hue: number
  /** The agent whose agents these are, which Up from the first goes back to. */
  name: string
}

/**
 * pi-extended-teams' agent navigation over the right side of the window, 95% of its width and height (the user,
 * 2026-11-27: "press down should take 95% of width/height of this right side of the window, not a float"): every agent's
 * row, the one shown marked, the keys, then what hobkin has of its work, followed at the newest unless the user scrolls
 * up. Up and Down walk the agents, Up from the first and Escape go back to the input, Left and Right go round, Page Up
 * and Page Down scroll and End follows again. Read only: there is no input and no stop, as hobkin never reaches the
 * agents it shows.
 */
function AgentNavigator({ agents, open, hue, name }: NavigatorProps) {
  const chosen = open ? (agents.find((agent) => agent.id === open.at) ?? agents[0]) : undefined
  const chosenRow = useRef<HTMLButtonElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  // Where the keyboard goes back to, and the side it covers. Kept past the close, which draws with no `open` left to read.
  const from = useRef<HTMLElement | null>(null)
  const side = useRef<HTMLElement | null>(null)
  if (open) {
    from.current = open.from
    side.current = open.side
  }
  // Inside the right side it sits over that side alone, above its menu; with none, over the window.
  const place = side.current ? 'absolute' : 'fixed'

  // A new agent shows from its newest, with its row in sight and the keyboard on it.
  useLayoutEffect(() => {
    follow.current = true
    chosenRow.current?.focus({ preventScroll: true })
    chosenRow.current?.scrollIntoView({ block: 'nearest' })
  }, [chosen?.id])

  // While following, what arrives stays in sight.
  useLayoutEffect(() => {
    const scroller = body.current
    if (scroller && follow.current) scroller.scrollTop = scroller.scrollHeight
  })

  const move = (step: 1 | -1, round = false) => {
    const ids = agents.map((agent) => agent.id)
    const next = stepAgent(ids, chosen?.id ?? null, step, round)
    if (next === null) closeNavigator()
    else moveNavigator(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Portals still bubble through React: none of these keys belong to the page under it.
    event.stopPropagation()
    if (event.metaKey || event.ctrlKey || event.altKey) return

    const scroller = body.current
    switch (event.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'ArrowRight':
        move(1, true)
        break
      case 'ArrowLeft':
        move(-1, true)
        break
      case 'PageDown':
        scroller?.scrollBy({ top: scroller.clientHeight * 0.9 })
        break
      case 'PageUp':
        scroller?.scrollBy({ top: -scroller.clientHeight * 0.9 })
        break
      case 'Home':
        scroller?.scrollTo({ top: 0 })
        break
      case 'End':
        follow.current = true
        scroller?.scrollTo({ top: scroller.scrollHeight })
        break
      case 'Escape':
        closeNavigator()
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <DialogPrimitive.Root
      open={chosen !== undefined}
      onOpenChange={(next, details) => {
        // Escape closes the navigator only, never the page or the canvas behind it.
        if (details.reason === 'escape-key') {
          details.event.preventDefault()
          details.event.stopPropagation()
        }
        if (!next) closeNavigator()
      }}
    >
      {/* The portal's own element covers the side out of its grid's flow: in flow it took a row, and the page shrank. */}
      <DialogPrimitive.Portal container={side.current ?? undefined} className={cn(place, 'inset-0 z-[60]')}>
        <DialogPrimitive.Backdrop className="absolute inset-0 bg-black/15 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          initialFocus={chosenRow}
          finalFocus={() => (from.current?.isConnected ? from.current : false)}
          onKeyDown={onKeyDown}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            NAVIGATOR,
            'absolute inset-[2.5%] outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none',
          )}
        >
        {chosen ? (
          <NavigatorPanel
            agents={agents}
            chosen={chosen}
            hue={hue}
            name={name}
            title={<DialogTitle className="text-[13px] font-medium">Agent navigation</DialogTitle>}
            chosenRow={chosenRow}
            body={body}
            onScroll={(scroller) => {
              follow.current = atBottom(scroller)
            }}
          />
        ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** The navigator's box. Its place and size are the right side's (`AgentNavigator`). */
export const NAVIGATOR = 'flex flex-col overflow-hidden rounded-[22px] bg-popover text-[12.5px] text-popover-foreground shadow-panel ring-1 ring-foreground/10'

interface PanelProps {
  agents: readonly ActivityAgent[]
  chosen: ActivityAgent
  hue: number
  name: string
  title: ReactNode
  chosenRow?: RefObject<HTMLButtonElement | null>
  body?: RefObject<HTMLDivElement | null>
  onScroll?: (scroller: HTMLElement) => void
}

/** What the navigator holds, top to bottom. Exported for still renders, which draw it without the dialog around it. */
export function NavigatorPanel({ agents, chosen, hue, name, title, chosenRow, body, onScroll }: PanelProps) {
  return (
    <>
      <header className="@container shrink-0 px-3 pt-3 pb-2">
        <div className="px-1.5">{title}</div>
        <button
          type="button"
          onClick={closeNavigator}
          className="mt-1 flex h-7 w-full items-center gap-2.5 rounded-lg px-1.5 text-left text-[12.5px] text-muted-foreground outline-none transition-colors duration-[140ms] ease-[ease] hover:bg-tone-1 focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]"
        >
          <span aria-hidden="true" className="w-4 shrink-0 text-center">
            ↑
          </span>
          {name}
        </button>
        <div className="scroll-quiet max-h-[30dvh] overflow-y-auto">
          <AgentRows agents={agents} hue={hue} label="Agents" chosen={chosen.id} chosenRow={chosenRow} onSelect={(at) => moveNavigator(at)} />
        </div>
      </header>
      <p className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
        {NAVIGATOR_KEYS.map(({ key, does }) => (
          <span key={does} className="flex items-center gap-1">
            <Kbd>{key}</Kbd>
            {does}
          </span>
        ))}
      </p>
      <div
        ref={body}
        tabIndex={0}
        aria-label={`What ${agentName(chosen)} did`}
        onScroll={(event) => onScroll?.(event.currentTarget)}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border px-4 py-3 outline-none"
      >
        {chosen.kind === 'teams' ? (
          <TeamsAgentBody agent={chosen.teams} hue={hue} runName={name} now={Date.now()} />
        ) : (
          <HelperBody child={chosen.helper} hue={agentHue(hue, chosen)} />
        )}
      </div>
      {chosen.kind === 'teams' ? <p className="shrink-0 border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">{sourceNote(chosen.teams)}</p> : null}
    </>
  )
}
