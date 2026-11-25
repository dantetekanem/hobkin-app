import type { TeamsAgent, TeamsAgents, TeamsAgentState, TeamsMessage } from '#shared/protocol/teams.ts'
import { stampOf, type Stamp } from '../agent-activity/stamp.ts'
import { runsOnFull } from './runs-on.ts'

/**
 * How a run's pi-extended-teams agents read on its screen (`046-teams-layer`). Pure, so it is tested without a window.
 * These are the run's own agents, shown and never controlled: nothing here can reach them.
 */

/** One agent as a screen lists it: which run it came in, and an id no other row on the page has. */
export interface ShownTeamsAgent extends TeamsAgent {
  run: string
  id: string
}

/** What is still out first, then what hobkin cannot tell, then how the rest ended. */
const ORDER: readonly TeamsAgentState[] = ['running', 'queued', 'unknown', 'failed', 'done']

/** The agents of these runs, running ones first, each state in the order they were started. A run listed twice counts once. */
export function teamsAgentsOf(all: TeamsAgents | undefined, runs: readonly string[]): ShownTeamsAgent[] {
  if (!all) return []
  const rows = [...new Set(runs)].flatMap((run) => (all[run] ?? []).map((agent) => ({ ...agent, run, id: `${run}/${agent.key}` })))
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => ORDER.indexOf(a.row.state) - ORDER.indexOf(b.row.state) || (a.row.startedAt ?? 0) - (b.row.startedAt ?? 0) || a.index - b.index)
    .map(({ row }) => row)
}

const NONE_READ: ReadonlySet<string> = new Set()

/**
 * What a screen still shows: a done agent leaves, and a failed or unknown one stays, since it may need the user. One
 * the user is reading (`stillRead`) stays, marked done, until they close it.
 */
export function stillShown(agents: readonly ShownTeamsAgent[], reading: ReadonlySet<string> = NONE_READ): ShownTeamsAgent[] {
  return agents.filter((agent) => agent.state !== 'done' || reading.has(agent.id))
}

/** What the user has open of a strip: its whole list, under the line or in the sheet, and the one agent in the sheet. */
export interface Reading {
  list: boolean
  agent?: string
}

/**
 * The agents the user is reading, by id, from those they were reading before: while a list is open, every one it has
 * shown since it opened; while an agent's sheet is open, that one. Nothing open, none.
 */
export function stillRead(before: ReadonlySet<string>, agents: readonly ShownTeamsAgent[], open: Reading): ReadonlySet<string> {
  const reading = new Set(open.list ? before : NONE_READ)
  if (open.agent) reading.add(open.agent)

  if (open.list) {
    for (const agent of stillShown(agents, reading)) reading.add(agent.id)
  }
  return reading
}

/** How many stand in each state, in the list's order: "1 running, 1 queued, 2 done". */
export function teamsCounts(agents: readonly TeamsAgent[]): string {
  return ORDER.flatMap((state) => {
    const count = agents.filter((agent) => agent.state === state).length
    return count ? [`${count} ${state}`] : []
  }).join(', ')
}

/** "4 teams agents · 1 running, 1 queued, 2 done", or nothing when there are none. */
export function teamsSummary(agents: readonly TeamsAgent[]): string {
  if (agents.length === 0) return ''
  return `${agents.length === 1 ? '1 teams agent' : `${agents.length} teams agents`} · ${teamsCounts(agents)}`
}

/**
 * The agents in one line, as the tasks line reads: how many, "1 agent" or "3 agents". Who is running shows in the list
 * under it; the user asked on 2026-11-24 for the line to stop at the count.
 */
export function agentsCount(agents: readonly TeamsAgent[]): string {
  return agents.length === 1 ? '1 agent' : `${agents.length} agents`
}

const FIRST_LINE = 96

/** The first line of what it was asked, cut to fit a row. */
export function firstLine(task: string): string {
  const line = task.split('\n').map((part) => part.trim()).find(Boolean)
  if (!line) return 'No task was given.'
  return line.length > FIRST_LINE ? `${line.slice(0, FIRST_LINE - 1)}…` : line
}

/**
 * Where it stands, and the time that goes with it: since when a running or queued agent has been out, when a finished
 * or failed one ended, and none for one whose end hobkin never saw.
 */
export function standing(agent: TeamsAgent, now: number): { word: TeamsAgentState; note?: string; time: Stamp | null } {
  const ended = agent.state === 'done' || agent.state === 'failed'
  const at = ended ? agent.endedAt : agent.state === 'unknown' ? undefined : agent.startedAt
  const time = stampOf(at, now)

  if (agent.state === 'running' && agent.phase) return { word: agent.state, note: agent.phase, time }
  return { word: agent.state, time }
}

/** The time as a row writes it: to the second, with the day in front for another day. */
export function stampText(time: Stamp | null): string {
  if (!time) return ''
  return time.date ? `${time.date} ${time.time}` : time.time
}

/** When it started, as a row writes it, or nothing when hobkin did not see it start. */
export const startText = (agent: TeamsAgent, now: number): string => stampText(stampOf(agent.startedAt, now))

/** When it finished or failed, or nothing while it is out or when hobkin never saw it end. */
export function endText(agent: TeamsAgent, now: number): string {
  const ended = agent.state === 'done' || agent.state === 'failed'
  return ended ? stampText(stampOf(agent.endedAt, now)) : ''
}

/** What a state means, beyond its word, for the sheet and for a screen reader. */
export const MEANING: Record<TeamsAgentState, string> = {
  running: '',
  queued: 'it waits for a free place',
  done: 'it reported, which does not say whether the work is right',
  failed: 'it could not start, or it reported a failure',
  unknown: 'no report came, so how it ended is not known',
}

/** One agent in full, for a tooltip or a screen reader, with the tier, model and level it runs on as far as they are known. */
export function describeTeamsAgent(agent: TeamsAgent, now: number): string {
  const { time, note } = standing(agent, now)
  const when = time ? ` ${agent.state === 'done' || agent.state === 'failed' ? 'at' : 'since'} ${stampText(time)}` : ''
  const doing = note ? `, ${note}` : ''
  const meaning = MEANING[agent.state] ? `; ${MEANING[agent.state]}` : ''
  const runsOn = runsOnFull(agent)
  return `${agent.name}, ${agent.state}${when}${doing}${meaning}${runsOn ? `; ${runsOn}` : ''}; asked: ${firstLine(agent.task)}`
}

/** What the sheet has to show of its work besides what it was asked. */
export function whatIsKept(agent: TeamsAgent): { steps: boolean; messages: boolean } {
  return { steps: Boolean(agent.steps?.length), messages: Boolean(agent.messages?.length) }
}

/** Who wrote a message: the run's own agent goes by the run's name. */
export function whoSaid(message: TeamsMessage, agentName: string, runName: string): string {
  if (message.by === 'run') return runName
  if (message.by === 'agent') return agentName
  return message.peer ?? 'Another teams agent'
}
