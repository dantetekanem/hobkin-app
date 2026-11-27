import type { RunChild } from '#shared/protocol/snapshot.ts'
import type { ModelChoice } from '#shared/tiers/tiers.ts'
import { childLine } from '../work/child-summary.ts'
import type { ShownTeamsAgent } from './rules.ts'

/**
 * An agent's agents under its input, as pi-extended-teams draws its activity under Pi's editor (046-teams-layer): one
 * row each, with its model and level, its tier, how long it has been out, what its context holds and what it is doing.
 * Its pi-extended-teams agents and the helpers hobkin started for it share the list. Pure, so it is tested without a window.
 */

/** One row: a teams agent, or one of hobkin's own helpers. Its id is unique among both. */
export type ActivityAgent = { kind: 'teams'; id: string; teams: ShownTeamsAgent } | { kind: 'helper'; id: string; helper: RunChild }

/** As many rows as pi-extended-teams draws before it counts the rest. */
export const MOST_ROWS = 10

type Standing = 'out' | 'waiting' | 'lost' | 'failed' | 'ended'

/** Running first, then waiting, then those whose end hobkin never saw, then failures, then the rest. */
const RANK: Record<Standing, number> = { out: 0, waiting: 1, lost: 2, failed: 3, ended: 4 }

const TEAMS_STANDING: Record<ShownTeamsAgent['state'], Standing> = { running: 'out', queued: 'waiting', unknown: 'lost', failed: 'failed', done: 'ended' }
const HELPER_STANDING: Record<RunChild['state'], Standing> = {
  running: 'out',
  queued: 'waiting',
  cancelling: 'waiting',
  unknown: 'lost',
  stopped: 'lost',
  failed: 'failed',
  reported: 'ended',
  completed: 'ended',
  cancelled: 'ended',
}

const standingOf = (agent: ActivityAgent): Standing => (agent.kind === 'teams' ? TEAMS_STANDING[agent.teams.state] : HELPER_STANDING[agent.helper.state])

/** It runs or waits, so its time still counts. */
export const stillOut = (agent: ActivityAgent): boolean => RANK[standingOf(agent)] <= RANK.waiting

/** Its name, whichever kind it is. */
export const agentName = (agent: ActivityAgent): string => (agent.kind === 'teams' ? agent.teams.name : agent.helper.name)

/** Both kinds in one list, what is still out first. The sort is stable: in a tie teams agents come first, each kind in its own order. */
export function activityAgents(teams: readonly ShownTeamsAgent[], helpers: readonly RunChild[]): ActivityAgent[] {
  const rows: ActivityAgent[] = [
    ...teams.map((agent) => ({ kind: 'teams' as const, id: `teams:${agent.id}`, teams: agent })),
    ...helpers.map((child) => ({ kind: 'helper' as const, id: `helper:${child.id ?? child.name}`, helper: child })),
  ]
  return rows.sort((a, b) => RANK[standingOf(a)] - RANK[standingOf(b)])
}

/**
 * A helper stays under the input while it is out, and once it failed or hobkin never saw it end, as a teams agent does:
 * those may need the user. One that reported, completed or was cancelled leaves.
 */
export const helperStays = (child: RunChild): boolean => HELPER_STANDING[child.state] !== 'ended'

/** "38s", "1m05s", and past the hour "1h05m": pi-extended-teams' clock, with hours. */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
  return minutes > 0 ? `${minutes}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

/** "980", "7.1k", "26k", "1.3M", as pi-extended-teams counts tokens. */
export function tokenCount(count: number): string {
  if (count < 1000) return `${count}`
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

/** "26k tok (10%)": what its context holds, and its share of the model's window when the window knows the model. */
export function tokensText(tokens: number | undefined, context: number | undefined): string {
  if (tokens === undefined) return ''
  const share = context ? ` (${Math.round((tokens / context) * 100)}%)` : ''
  return `${tokenCount(tokens)} tok${share}`
}

/** One row's words, each part empty when hobkin does not know it. */
export interface ActivityLine {
  name: string
  /** Its model's own id and its level, "gpt-6-luna/max". */
  runsOn: string
  /** Its tier, a teams tier such as "read-review" or one of hobkin's. */
  tier: string
  /** How long it has been out, or how long it ran once it ended. */
  elapsed: string
  tokens: string
  /** What it is doing, in its own words while it runs, or how it stands. */
  doing: string
  /** `live` while it runs, `waiting` while it waits, `bad` once it failed, `quiet` otherwise. */
  tone: 'live' | 'waiting' | 'bad' | 'quiet'
}

const TONE: Record<Standing, ActivityLine['tone']> = { out: 'live', waiting: 'waiting', lost: 'quiet', failed: 'bad', ended: 'quiet' }

/** The model's own id after its provider, with its level: "gpt-6-luna/max". */
function shortRunsOn(model: string | undefined, thinking: string | undefined): string {
  const id = model ? model.slice(model.lastIndexOf('/') + 1) : ''
  return [id, thinking].filter(Boolean).join('/')
}

/** Out, it counts to now; ended, to its end. A time hobkin did not see gives none. */
function spanText(startedAt: number | undefined, endedAt: number | undefined, out: boolean, now: number): string {
  const end = out ? now : endedAt
  return startedAt !== undefined && end !== undefined ? elapsedText(end - startedAt) : ''
}

/** What a teams agent is doing, or how it stands, in a few words. */
function teamsDoing(agent: ShownTeamsAgent): string {
  if (agent.state === 'running') return agent.progress ?? agent.phase ?? 'running'
  if (agent.state === 'unknown') return 'unknown · no report came'
  if ((agent.state === 'failed' || agent.state === 'done') && agent.summary) return `${agent.state} · ${agent.summary}`
  return agent.state
}

/** A row's words at `now`, with its context's share of its model's window when `choices` know the model. */
export function activityLine(agent: ActivityAgent, now: number, choices: readonly ModelChoice[]): ActivityLine {
  return agent.kind === 'teams' ? teamsLine(agent.teams, now, choices) : helperLine(agent.helper, now)
}

function teamsLine(agent: ShownTeamsAgent, now: number, choices: readonly ModelChoice[]): ActivityLine {
  const standing = TEAMS_STANDING[agent.state]
  const out = standing === 'out' || standing === 'waiting'
  const context = agent.model ? choices.find((choice) => choice.id === agent.model)?.context : undefined
  return {
    name: agent.name,
    runsOn: shortRunsOn(agent.model, agent.thinking),
    tier: agent.modelSlot ?? '',
    // One whose end hobkin never saw has no time to count to.
    elapsed: standing === 'lost' ? '' : spanText(agent.startedAt, agent.endedAt, out, now),
    tokens: tokensText(agent.tokens, context),
    doing: teamsDoing(agent),
    tone: TONE[standing],
  }
}

/** hobkin measures none of a helper's tokens, so its row has none. */
function helperLine(helper: RunChild, now: number): ActivityLine {
  const standing = HELPER_STANDING[helper.state]
  const out = standing === 'out' || standing === 'waiting'
  return {
    name: helper.name,
    runsOn: shortRunsOn(helper.model, helper.thinking),
    tier: helper.modelSlot ?? '',
    elapsed: spanText(helper.startedAt, helper.endedAt, out, now),
    tokens: '',
    doing: childLine(helper),
    tone: TONE[standing],
  }
}

/** "3 active · 1 failed · 2 unknown": what is out, then what failed and what hobkin lost track of. */
export function activityHeader(agents: readonly ActivityAgent[]): string {
  const count = (...standings: Standing[]) => agents.filter((agent) => standings.includes(standingOf(agent))).length
  const parts = [
    { count: count('out', 'waiting'), word: 'active' },
    { count: count('failed'), word: 'failed' },
    { count: count('lost'), word: 'unknown' },
    { count: count('ended'), word: 'done' },
  ]
  return parts
    .filter((part) => part.count > 0)
    .map((part) => `${part.count} ${part.word}`)
    .join(' · ')
}

/** The rows the strip draws, and how many more the navigator holds. */
export function shownRows(agents: readonly ActivityAgent[]): { rows: readonly ActivityAgent[]; more: number } {
  return agents.length <= MOST_ROWS ? { rows: agents, more: 0 } : { rows: agents.slice(0, MOST_ROWS), more: agents.length - MOST_ROWS }
}

/**
 * The agent the navigator goes to from `at`, as pi-extended-teams walks its agents: Down to the next, staying on the
 * last; Up to the previous, and from the first out of the navigator (null); with `round`, Left and Right go round.
 */
export function stepAgent(ids: readonly string[], at: string | null, step: 1 | -1, round = false): string | null {
  if (ids.length === 0) return null
  const index = at === null ? -1 : ids.indexOf(at)
  if (index === -1) return ids[0]!
  const next = index + step
  if (round) return ids[(next + ids.length) % ids.length]!
  if (next < 0) return null
  return ids[Math.min(next, ids.length - 1)]!
}
