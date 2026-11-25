import { useRef, useState } from 'react'
import { useDrop } from '@/features/agent-activity/drop.ts'
import { teamsGlow } from '@/features/agent-activity/glow.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { cn } from '@/lib/utils.ts'
import { FoldLine, RunsOnLine } from './FoldLine.tsx'
import { agentsCount, describeTeamsAgent, firstLine, standing, teamsCounts, teamsSummary, type ShownTeamsAgent } from './rules.ts'
import { runsOnWords } from './runs-on.ts'
import { TeamsAgentSheet, TeamsFace, TimesOf, type SheetOpen } from './TeamsAgentSheet.tsx'
import { useTeamsAgents } from './use-teams-agents.ts'

/**
 * A run's pi-extended-teams agents on its screen (`046-teams-layer`), folded into one line beside the tasks line: their
 * faces and how many. A press opens every one under it, running ones first, and a row opens that agent read only. They
 * are the run's own agents, not hobkin's helpers: nothing here stops, messages or counts them. A run that started none
 * draws nothing.
 */
export function TeamsStrip({ runs, hue, runName, className }: { runs: readonly (string | null | undefined)[]; hue: number; runName: string; className?: string }) {
  const [open, setOpen] = useState<SheetOpen>(null)
  const listOpen = useDrop((state) => state.open === 'agents')
  const sheetAgent = open !== null && open !== 'all' ? open.agent : undefined
  // What the user reads stays until they close it: the open list and the agent in the sheet.
  const agents = useTeamsAgents(runs, { list: listOpen || open === 'all', agent: sheetAgent })
  if (agents.length === 0) return null
  return <TeamsStripView agents={agents} open={open} onOpen={setOpen} hue={hue} runName={runName} className={className} />
}

/** The line for given agents, with no host: what `TeamsStrip` draws, and what a still render draws. */
export function TeamsStripView({ agents, open, onOpen, hue, runName, className }: { agents: readonly ShownTeamsAgent[]; open: SheetOpen; onOpen: (next: SheetOpen) => void; hue: number; runName: string; className?: string }) {
  const opener = useRef<HTMLElement | null>(null)
  const openFrom = (element: HTMLElement, agent: string) => {
    opener.current = element
    onOpen({ agent })
  }
  const faces = agents.map((agent) => ({ key: agent.id, face: <TeamsFace agent={agent} hue={hue} /> }))
  const list = {
    title: 'Teams agents',
    counts: teamsCounts(agents),
    label: "The run's teams agents, running ones first",
    rows: <AgentRows agents={agents} hue={hue} onOpen={openFrom} />,
  }
  return (
    <FoldLine
      drop="agents"
      faces={faces}
      count={agentsCount(agents)}
      summary={teamsSummary(agents)}
      live={teamsGlow(agents)}
      hue={hue}
      list={list}
      className={className}
    >
      <TeamsAgentSheet agents={agents} open={open} onOpen={onOpen} hue={hue} runName={runName} opener={() => opener.current} />
    </FoldLine>
  )
}

/** The open list's rows, read as they are drawn, as a step's time is. */
function AgentRows({ agents, hue, onOpen }: { agents: readonly ShownTeamsAgent[]; hue: number; onOpen: (element: HTMLElement, agent: string) => void }) {
  const models = useModelChoices()
  const now = Date.now()
  return agents.map((agent) => (
    <li key={agent.id} title={describeTeamsAgent(agent, now)}>
      <AgentRow agent={agent} hue={hue} now={now} runsOn={runsOnWords(agent, models)} onOpen={(element) => onOpen(element, agent.id)} />
    </li>
  ))
}

/**
 * One agent in the open list, as a task is in its own: face, name, how it stands and its times; the tier, model and
 * thinking level it runs on, as far as they are known; and what it was asked.
 */
function AgentRow({ agent, hue, now, runsOn, onOpen }: { agent: ShownTeamsAgent; hue: number; now: number; runsOn: readonly string[]; onOpen: (opener: HTMLElement) => void }) {
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
        <RunsOnLine words={runsOn} />
        <span className="text-[12px] break-words text-muted-foreground">{firstLine(agent.task)}</span>
      </span>
    </button>
  )
}
