import { useRef, useState } from 'react'
import { cn } from '@/lib/utils.ts'
import { describeTeamsAgent, endText, startText, teamsSummary, type ShownTeamsAgent } from './rules.ts'
import { TeamsAgentSheet, TeamsFace, TeamsRow, type SheetOpen } from './TeamsAgentSheet.tsx'
import { useTeamsAgents } from './use-teams-agents.ts'

/**
 * A run's pi-extended-teams agents, quiet on its screen (`046-teams-layer`): running ones first, each with its time.
 * A click or Enter opens one read only. They are the run's own agents, not hobkin's helpers: nothing here stops,
 * messages or counts them. A run that started none draws nothing.
 *
 * `rows`: a short list with what each was asked and its times, where the page has room (a durable hobkin's page, an
 * agent's small screen). `line`: one line of small chips, under an agent's shrunken header.
 */
type Variant = 'rows' | 'line'

/** How many a variant shows before the rest wait behind "+N more". */
const ROOM: Record<Variant, number> = { rows: 3, line: 3 }

export function TeamsStrip({ runs, hue, runName, variant, className }: { runs: readonly (string | null | undefined)[]; hue: number; runName: string; variant: Variant; className?: string }) {
  const agents = useTeamsAgents(runs)
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
  const shown = agents.slice(0, ROOM[variant])
  const more = agents.length - shown.length
  const summary = teamsSummary(agents)
  const sheet = <TeamsAgentSheet agents={agents} open={open} onOpen={setOpen} hue={hue} runName={runName} opener={() => opener.current} />

  if (variant === 'rows') {
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

  return (
    <div role="group" aria-label={summary} className={cn('flex min-w-0 items-center gap-1.5 overflow-hidden text-[12px]', className)}>
      {shown.map((agent) => (
        <button
          key={agent.id}
          type="button"
          title={describeTeamsAgent(agent, now)}
          aria-label={describeTeamsAgent(agent, now)}
          onClick={(event) => openFrom(event.currentTarget, { agent: agent.id })}
          className="flex min-w-0 shrink items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-2.5 pl-1.5 transition-transform duration-[140ms] ease-out active:scale-[0.97] outline-none focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]"
        >
          <TeamsFace agent={agent} hue={hue} />
          <span className="truncate font-medium">{agent.name}</span>
          <span className={cn('shrink-0 tabular-nums', agent.state === 'failed' ? 'text-bad-fg' : 'text-muted-foreground')}>{chipWords(agent, now)}</span>
        </button>
      ))}
      {more ? (
        <button
          type="button"
          onClick={(event) => openFrom(event.currentTarget, 'all')}
          className="shrink-0 rounded-full px-2 py-1 text-muted-foreground transition-colors duration-[140ms] ease-[ease] hover:bg-surface-2 hover:text-foreground"
        >
          +{more} more
        </button>
      ) : null}
      {sheet}
    </div>
  )
}

/** A chip's few words: since when a running one is out, or when one finished or failed. */
function chipWords(agent: ShownTeamsAgent, now: number): string {
  if (agent.state === 'running') {
    const started = startText(agent, now)
    return started ? `since ${started}` : 'running'
  }
  const ended = endText(agent, now)
  return ended ? `${agent.state} ${ended}` : agent.state
}
