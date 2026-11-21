import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useRef, useState, type ReactNode } from 'react'
import { holdStill, useStill } from '@/app/still.ts'
import { useDrop } from '@/features/agent-activity/drop.ts'
import { useRoom } from '@/features/agent-activity/TaskList.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { describeTeamsAgent, firstLine, standing, teamsCounts, teamsLine, teamsSummary, type ShownTeamsAgent } from './rules.ts'
import { TeamsAgentSheet, TeamsFace, TeamsRow, TimesOf, type SheetOpen } from './TeamsAgentSheet.tsx'
import { useTeamsAgents } from './use-teams-agents.ts'

/**
 * A run's pi-extended-teams agents, quiet on its screen (`046-teams-layer`): running ones first, each with its time.
 * A click or Enter opens one read only. They are the run's own agents, not hobkin's helpers: nothing here stops,
 * messages or counts them. A run that started none draws nothing.
 *
 * `rows`: a short list with what each was asked and its times, where the page has room (a durable hobkin's page, an
 * agent's small screen). `line`: one line beside the tasks line under an agent's shrunken header, that opens the
 * whole list under it as the tasks line does, and keeps the ones that finished as that line keeps finished tasks.
 */
type Variant = 'rows' | 'line'

/** How many rows show before the rest wait behind "+N more". */
const ROWS = 3
/** How many faces the line stacks. */
const FACES = 3

export function TeamsStrip({ runs, hue, runName, variant, className }: { runs: readonly (string | null | undefined)[]; hue: number; runName: string; variant: Variant; className?: string }) {
  const agents = useTeamsAgents(runs, variant)
  if (agents.length === 0) return null
  return <TeamsStripView agents={agents} hue={hue} runName={runName} variant={variant} className={className} />
}

/** The strip for given agents, with no host: what `TeamsStrip` draws, and what a still render draws. */
export function TeamsStripView({ agents, hue, runName, variant, className }: { agents: readonly ShownTeamsAgent[]; hue: number; runName: string; variant: Variant; className?: string }) {
  const [open, setOpen] = useState<SheetOpen>(null)
  const opener = useRef<HTMLElement | null>(null)
  const openFrom = (element: HTMLElement, next: SheetOpen) => {
    opener.current = element
    setOpen(next)
  }
  // Read as it is drawn, as a step's time is: a strip drawn yesterday that has not changed keeps its look.
  const now = Date.now()
  const shown = agents.slice(0, ROWS)
  const more = agents.length - shown.length
  const summary = teamsSummary(agents)
  const sheet = <TeamsAgentSheet agents={agents} open={open} onOpen={setOpen} hue={hue} runName={runName} opener={() => opener.current} />

  if (variant === 'line') return <TeamsLine agents={agents} hue={hue} now={now} summary={summary} onOpen={(element, agent) => openFrom(element, { agent })} sheet={sheet} className={className} />

  return (
    <section aria-label="Teams agents" className={cn('w-full min-w-0 text-left', className)}>
      <div className="flex items-center gap-2 px-2 pb-0.5 text-[12px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {more ? (
          <button type="button" onClick={(event) => openFrom(event.currentTarget, 'all')} className="shrink-0 rounded-md px-1.5 py-0.5 transition-colors duration-[140ms] ease-[ease] hover:bg-surface-2 hover:text-foreground">
            +{more} more
          </button>
        ) : null}
      </div>
      <ul className="flex flex-col">
        {shown.map((agent) => (
          <li key={agent.id} title={describeTeamsAgent(agent, now)}>
            <TeamsRow agent={agent} hue={hue} now={now} onOpen={(element) => openFrom(element, { agent: agent.id })} />
          </li>
        ))}
      </ul>
      {sheet}
    </section>
  )
}

/**
 * The agents in one line, as the tasks line beside it reads: their faces, how many, and who leads, such as
 * "2 agents · running: test-gate, observability". A click opens every one under it, with what it was asked, how it
 * stands and its times, and the same again closes it; Escape inside closes it too. A row opens that agent read only.
 * It shares its place under the header with the tasks list, so opening one closes the other.
 */
function TeamsLine({ agents, hue, now, summary, onOpen, sheet, className }: { agents: readonly ShownTeamsAgent[]; hue: number; now: number; summary: string; onOpen: (element: HTMLElement, agent: string) => void; sheet: ReactNode; className?: string }) {
  const still = useStill()
  const open = useDrop((state) => state.open === 'agents')
  const bar = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const line = teamsLine(agents)

  const toggle = () => {
    if (open && document.getElementById(panelId)?.contains(document.activeElement)) bar.current?.focus({ preventScroll: true })
    useDrop.getState().setOpen('agents', !open)
  }

  return (
    <div
      className={cn('flex w-[22rem] min-w-0 shrink items-center', className)}
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        toggle()
      }}
    >
      <motion.button
        ref={bar}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${summary}. ${open ? 'Hide' : 'Show'} every agent.`}
        onClick={toggle}
        whileTap={holdStill({ transform: 'scale(0.97)', transition: { duration: 0.14 } }, still)}
        className="flex h-7 w-full min-w-0 items-center gap-2 rounded-full bg-surface-2 pr-1.5 pl-2 text-[12px] outline-none transition-colors duration-[160ms] ease-[ease] hover:bg-secondary focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]"
      >
        <span className="flex shrink-0 items-center" aria-hidden="true">
          {agents.slice(0, FACES).map((agent, index) => (
            <span key={agent.id} className={cn(index > 0 && '-ml-1')}>
              <TeamsFace agent={agent} hue={hue} />
            </span>
          ))}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{line.count}</span>
        <span className="shrink-0 text-muted-foreground" aria-hidden="true">
          ·
        </span>
        <span className="min-w-0 flex-1 truncate text-left">
          <span className={cn(line.lead === 'failed' ? 'text-bad-fg' : 'text-muted-foreground')}>{line.lead}: </span>
          <span className="font-medium">{line.names}</span>
          {line.more ? <span className="text-muted-foreground"> +{line.more}</span> : null}
        </span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]', open && 'rotate-180')} aria-hidden="true" />
      </motion.button>
      <AnimatePresence>{open ? <AgentsPanel key="panel" id={panelId} agents={agents} hue={hue} now={now} onOpen={onOpen} still={still} /> : null}</AnimatePresence>
      {sheet}
    </div>
  )
}

/** One agent in the open list, as a task is in its own: face, name, how it stands and its times, and what it was asked under them. */
function AgentRow({ agent, hue, now, onOpen }: { agent: ShownTeamsAgent; hue: number; now: number; onOpen: (opener: HTMLElement) => void }) {
  const { note } = standing(agent, now)
  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2 py-1.5 text-left text-[13px] leading-snug transition-[background-color,transform] duration-[140ms] ease-out outline-none hover:bg-surface-2 focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)] active:scale-[0.99]"
    >
      <span className="mt-px">
        <TeamsFace agent={agent} hue={hue} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2 text-[12px]">
          <span className="min-w-0 truncate text-[13px] font-medium">{agent.name}</span>
          <span className={cn('min-w-0 flex-1 truncate', agent.state === 'failed' ? 'text-bad-fg' : 'text-muted-foreground')}>
            {agent.state}
            {note ? ` · ${note}` : ''}
          </span>
          <TimesOf agent={agent} now={now} />
        </span>
        <span className="text-[12px] break-words text-muted-foreground">{firstLine(agent.task)}</span>
      </span>
    </button>
  )
}

/** Every agent under the line, as the tasks list hangs under its own: what each was asked, how it stands and its times. */
function AgentsPanel({ id, agents, hue, now, onOpen, still }: { id: string; agents: readonly ShownTeamsAgent[]; hue: number; now: number; onOpen: (element: HTMLElement, agent: string) => void; still: boolean }) {
  const outer = useRef<HTMLDivElement>(null)
  const room = useRoom(outer)
  return (
    // Spans the row the line sits in, so the list stands under it, where the tasks list would.
    <div ref={outer} className="pointer-events-none absolute inset-x-0 top-full z-20 mt-2 flex justify-center">
      <motion.div
        id={id}
        role="region"
        aria-label="Every teams agent"
        style={{ maxHeight: room }}
        initial={holdStill({ opacity: 0, transform: 'translateY(-6px) scale(0.96)' }, still)}
        animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.sheet, opacity: tween.enter } }, still)}
        exit={holdStill({ opacity: 0, transform: 'translateY(-4px) scale(0.96)', transition: tween.exit }, still)}
        className="pointer-events-auto flex w-full max-w-[34rem] origin-top flex-col overflow-hidden rounded-[18px] border border-border bg-popover text-popover-foreground shadow-panel"
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1.5">
          <span className="text-[13px] font-medium">Teams agents</span>
          <span className="min-w-0 truncate text-[12px] text-muted-foreground tabular-nums">{teamsCounts(agents)}</span>
        </div>
        <ul aria-label="The run's teams agents, running ones first" className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {agents.map((agent) => (
            <li key={agent.id} title={describeTeamsAgent(agent, now)}>
              <AgentRow agent={agent} hue={hue} now={now} onOpen={(element) => onOpen(element, agent.id)} />
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  )
}
