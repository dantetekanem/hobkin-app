import type { ActivityEntry } from './activity.ts'

/**
 * The agents a run's own Pi started with pi-extended-teams, as hobkin's runtime shows them (`src/cli/teams-agents.mjs`,
 * `_specs/046-teams-layer`). Display only: hobkin never starts, stops, messages or owns them, and they are never its
 * helpers. They are not `RunChild` rows and never travel in `jobChildren`.
 */

/**
 * `done`: it reported, which does not say whether the work is right. `failed`: it could not start, or it reported a
 * failure. `unknown`: no report was seen, and its run has ended or teams no longer lists it, so how it ended is not known.
 */
export type TeamsAgentState = 'queued' | 'running' | 'done' | 'failed' | 'unknown'

/** A message between the run and the agent. `run` is the run's own agent, `agent` this one, `peer` another teams agent. */
export interface TeamsMessage {
  by: 'run' | 'agent' | 'peer'
  peer?: string
  text: string
  /** Milliseconds since the epoch. */
  at?: number
}

export interface TeamsAgent {
  /** Unique within its run: the spawn call and the name. */
  key: string
  name: string
  /** What it was asked, up to 2,000 characters. Empty when neither the run nor teams said. */
  task: string
  modelSlot?: string
  state: TeamsAgentState
  /** teams' phase or tool for a running agent, when its runtime file has one. */
  phase?: string
  /** Milliseconds since the epoch: when hobkin saw it spawn, and when it reported or failed. */
  startedAt?: number
  endedAt?: number
  /** The summary of its report. */
  summary?: string
  /** The completion group of the swarm it came in. */
  group?: string
  /** `run`: only the run's own events said this. `teams`: teams' own files for the run's session filled it in. */
  from: 'run' | 'teams'
  /** Its last steps, from its own Pi session when teams kept one, kept as any agent's are. */
  steps?: readonly ActivityEntry[]
  messages?: readonly TeamsMessage[]
}

/** By run id, only for runs that started any. */
export type TeamsAgents = Record<string, readonly TeamsAgent[]>
