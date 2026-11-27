import { memo, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { ChildHood } from '@/features/work/ChildAgents.tsx'
import { describeChild } from '@/features/work/child-summary.ts'
import { cn } from '@/lib/utils.ts'
import { activityHeader, activityLine, agentName, shownRows, stepAgent, stillOut, type ActivityAgent, type ActivityLine } from './activity.ts'
import { describeTeamsAgent, type ShownTeamsAgent } from './rules.ts'
import { faceHue, TeamsAgentBody } from './TeamsAgentBody.tsx'
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
 * see more in the screen like floating ... not the pill". A heading with how many are out, then one row each: its name,
 * the model and level it runs on, its tier, how long it has been out, what its context holds and what it is doing. Down
 * from the agent's empty input, or a click on a row, opens the navigator floating over the page.
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

/** An agent's own color, as its face is tinted: its name and its dot. */
const tint = (hue: number): CSSProperties => ({ color: `oklch(var(--agent-l, 0.62) 0.11 ${hue})` })

/** Each agent keeps its face's hue by its name, so it keeps its color as it moves in the list. */
const agentHue = (pageHue: number, agent: ActivityAgent) => faceHue(pageHue, agentName(agent))

/** Everything a row knows, for a hover and a screen reader. */
function describe(agent: ActivityAgent, line: ActivityLine): string {
  const told = agent.kind === 'teams' ? describeTeamsAgent(agent.teams, Date.now()) : describeChild(agent.helper)
  return line.tokens ? `${told}; context ${line.tokens}` : told
}

const DOING: Record<ActivityLine['tone'], string> = {
  live: 'text-foreground',
  waiting: 'text-muted-foreground',
  bad: 'text-bad-fg',
  quiet: 'text-muted-foreground',
}

/** Its standing at a glance: a dot that breathes while it runs, a ring while it waits, red once it failed. */
function Dot({ tone, hue }: { tone: ActivityLine['tone']; hue: number }) {
  return (
    <span
      aria-hidden="true"
      style={tone === 'live' || tone === 'waiting' ? tint(hue) : undefined}
      className={cn(
        'size-1.5 shrink-0 self-center rounded-full',
        tone === 'live' && 'aa-running bg-current',
        tone === 'waiting' && 'border border-current',
        tone === 'bad' && 'bg-bad',
        tone === 'quiet' && 'bg-muted-foreground/50',
      )}
    />
  )
}

/** The tree's branch before a row, as pi-extended-teams draws it. */
function Branch({ last }: { last: boolean }) {
  return (
    <span aria-hidden="true" className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
      {last ? '└─' : '├─'}
    </span>
  )
}

/** The words after the name: what it runs on, its tier, time and context, muted, then what it is doing. */
function LineWords({ line }: { line: ActivityLine }) {
  const meta = [line.runsOn, line.tier, line.elapsed, line.tokens].filter(Boolean).join(' · ')
  return (
    <span className="min-w-0 flex-1 truncate">
      {meta ? <span className="text-muted-foreground tabular-nums">{meta} · </span> : null}
      <span className={DOING[line.tone]}>{line.doing}</span>
    </span>
  )
}

interface StripProps {
  agents: readonly ActivityAgent[]
  hue: number
  keys: boolean
  onOpen: (at: string, from: HTMLElement) => void
  className?: string
}

/** The heading and the rows, as pi-extended-teams' activity widget reads: ten rows at most, the rest counted. Exported for still renders. */
export function ActivityStrip({ agents, hue, keys, onOpen, className }: StripProps) {
  const models = useModelChoices()
  // Only the strip ticks, once a second while one is out.
  const now = useNow(agents.some(stillOut), 1000)
  const { rows, more } = shownRows(agents)

  return (
    <section aria-label="Agent activity" className={cn('px-3 pt-2 text-[12px] leading-[19px]', className)}>
      <p className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-medium">Agent activity</span>
        <span className="min-w-0 truncate text-muted-foreground tabular-nums">
          {activityHeader(agents)}
          {keys ? ' · ↓ navigate' : ''}
        </span>
      </p>
      <ul aria-label="Its agents, running ones first">
        {rows.map((agent, index) => (
          <li key={agent.id}>
            <ActivityRow agent={agent} line={activityLine(agent, now, models)} hue={agentHue(hue, agent)} last={!more && index === rows.length - 1} onOpen={(from) => onOpen(agent.id, from)} />
          </li>
        ))}
        {more ? (
          <li className="flex items-baseline gap-1.5 text-muted-foreground">
            <Branch last />… {more} more {more === 1 ? 'agent' : 'agents'}
          </li>
        ) : null}
      </ul>
    </section>
  )
}

/** One agent under the input. A click opens the navigator on it. */
function ActivityRow({ agent, line, hue, last, onOpen }: { agent: ActivityAgent; line: ActivityLine; hue: number; last: boolean; onOpen: (from: HTMLElement) => void }) {
  return (
    <button
      type="button"
      title={describe(agent, line)}
      onClick={(event) => onOpen(event.currentTarget)}
      className="flex w-full min-w-0 items-baseline gap-1.5 rounded-md text-left outline-none transition-colors duration-[140ms] ease-[ease] hover:bg-surface-2 focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]"
    >
      <Branch last={last} />
      <Dot tone={line.tone} hue={hue} />
      <span className="shrink-0 font-medium" style={tint(hue)}>
        {line.name}
      </span>
      <LineWords line={line} />
    </button>
  )
}

/** The chosen agent's line in the navigator, ticking while it is out. */
function DetailLine({ agent, hue }: { agent: ActivityAgent; hue: number }) {
  const models = useModelChoices()
  const now = useNow(stillOut(agent), 1000)
  const line = activityLine(agent, now, models)
  return (
    <p className="flex min-w-0 items-baseline gap-1.5">
      <Dot tone={line.tone} hue={hue} />
      <span className="shrink-0 font-medium" style={tint(hue)}>
        {line.name}
      </span>
      <LineWords line={line} />
    </p>
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
 * pi-extended-teams' agent navigation, floating over the page: every agent, the chosen one marked, its line and the
 * keys, then what hobkin has of its work, followed at the newest unless the user scrolls up. Up and Down walk the
 * agents, Up from the first and Escape go back to the input, Left and Right go round, Page Up and Page Down scroll and
 * End follows again. Read only: there is no input and no stop, as hobkin never reaches the agents it shows.
 */
function AgentNavigator({ agents, open, hue, name }: NavigatorProps) {
  const chosen = open ? (agents.find((agent) => agent.id === open.at) ?? agents[0]) : undefined
  const chosenRow = useRef<HTMLButtonElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  // Where the keyboard goes back to. Kept past the close, which draws with no `open` left to read it from.
  const from = useRef<HTMLElement | null>(null)
  if (open) from.current = open.from

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
    <Dialog
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
      <DialogContent
        showCloseButton={false}
        initialFocus={chosenRow}
        finalFocus={() => (from.current?.isConnected ? from.current : false)}
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
        className={cn(NAVIGATOR, 'motion-reduce:animate-none')}
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
      </DialogContent>
    </Dialog>
  )
}

/** The navigator's box, floating over the page. */
export const NAVIGATOR = 'z-[60] flex h-[min(86dvh,860px)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 text-[12.5px] sm:max-w-[860px]'

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

const CHOICE = 'flex w-full items-baseline gap-2 rounded-md px-1 text-left outline-none hover:bg-surface-2 focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]'

/** What the navigator holds, top to bottom. Exported for still renders, which draw it without the dialog around it. */
export function NavigatorPanel({ agents, chosen, hue, name, title, chosenRow, body, onScroll }: PanelProps) {
  return (
    <>
      <header className="shrink-0 px-4 pt-3 pb-2">
        {title}
        <ul aria-label="Agents" className="scroll-quiet mt-1.5 max-h-[28dvh] overflow-y-auto">
          <li>
            <button type="button" onClick={closeNavigator} className={cn(CHOICE, 'text-muted-foreground')}>
              <span aria-hidden="true" className="w-4 shrink-0 text-center">
                ↑
              </span>
              {name}
            </button>
          </li>
          {agents.map((agent) => (
            <li key={agent.id}>
              <AgentChoice agent={agent} hue={agentHue(hue, agent)} current={agent.id === chosen.id} ref={agent.id === chosen.id ? chosenRow : undefined} />
            </li>
          ))}
        </ul>
      </header>
      <div className="shrink-0 border-t border-border px-4 py-2">
        <DetailLine agent={chosen} hue={agentHue(hue, chosen)} />
        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted-foreground">
          {NAVIGATOR_KEYS.map(({ key, does }) => (
            <span key={does} className="flex items-center gap-1">
              <Kbd>{key}</Kbd>
              {does}
            </span>
          ))}
        </p>
      </div>
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

/** One agent in the navigator's list, marked with an arrow while it is the one shown. A click shows it. */
function AgentChoice({ agent, hue, current, ref }: { agent: ActivityAgent; hue: number; current: boolean; ref?: RefObject<HTMLButtonElement | null> }) {
  const color = current ? tint(hue) : undefined
  return (
    <button ref={ref} type="button" aria-current={current} onClick={() => moveNavigator(agent.id)} className={cn(CHOICE, current && 'bg-surface-2')}>
      <span aria-hidden="true" className="w-4 shrink-0 text-center" style={color}>
        {current ? '→' : ''}
      </span>
      <span className={current ? 'font-medium' : undefined} style={color}>
        {agentName(agent)}
      </span>
    </button>
  )
}
