import { hobkinAgentId, type HobkinEngine, type HobkinSummary } from '#shared/protocol/hobkins.ts'
import type { RunSummary, WireSnapshot } from '#shared/protocol/snapshot.ts'
import type { Tier } from '../../app/sample.ts'
import { TIER_BY_EFFORT, agentsFrom, doingOf, folderName, hueOf, isAgentRun, madeOnce, updateOf, waitNoteOf, type HostedAgent, type MadeLists } from '../../lib/host/frame.ts'

/**
 * Durable hobkins as agents of the list under the input (`034-durable-hobkins`). A durable hobkin stays listed for as long
 * as it lives, working or waiting. Each of its turns is a run of its own, but never an agent of its own: `agentsFrom`
 * leaves the runs of turns out, and the hobkin stands for them. Pure, so it is tested without a window.
 */

/** What marks an agent of the list as a durable hobkin. */
export interface DurableMark {
  /** The hobkin's own id. Its agent id is `hobkin:<id>`. */
  id: string
  state: 'working' | 'waiting'
  /** The run of the turn in flight. Null while it waits. */
  run: string | null
  /** It waits and the user has not looked yet. */
  unseen: boolean
  engine: HobkinEngine
  cwd: string
}

export interface ListedAgent extends HostedAgent {
  /** Set on a durable hobkin, which reads apart from the agents that come and go. */
  durable?: DurableMark
}

type Activity = Record<string, Parameters<typeof doingOf>[0]>

/** The tier a durable hobkin reads as: its own, or the nearest one to its thinking. Claude Code says no level, so mid. */
function tierOf(engine: HobkinEngine): Tier {
  if ('tier' in engine && engine.tier) return engine.tier
  if (engine.kind === 'pi') return TIER_BY_EFFORT[engine.effort] ?? 'mid'
  return 'mid'
}

/** One line of what it said last, as the list shows an agent's latest words. */
const oneLine = (text: string | undefined) => text?.replace(/\s+/g, ' ').trim() || undefined

function durableAgent(hobkin: HobkinSummary, activity: Activity): ListedAgent {
  const run = hobkin.state === 'working' ? hobkin.run : null
  const steps = run ? activity[run] : undefined
  const whatItDoes = run ? doingOf(steps) : { doing: 'waiting', mood: 'idle' as const }
  const update = run ? updateOf(steps) : oneLine(hobkin.last?.said)
  return {
    id: hobkinAgentId(hobkin.id),
    title: hobkin.title,
    project: folderName(hobkin.cwd),
    ...whatItDoes,
    ...(update ? { update } : {}),
    tier: tierOf(hobkin.engine),
    // Its color is its own, not its turn's, so it keeps it from one turn to the next.
    hue: hueOf(hobkin.id),
    kind: 'session',
    ...(hobkin.engine.kind === 'claude' ? { onClaudeCode: true as const } : {}),
    durable: {
      id: hobkin.id,
      state: run ? 'working' : 'waiting',
      run,
      unseen: hobkin.waiting ? !hobkin.waiting.seen : false,
      engine: hobkin.engine,
      cwd: hobkin.cwd,
    },
  }
}

/** The durable hobkins in the snapshot, newest first as the host sends them. None from a host older than them. */
export function durableAgents(snapshot: WireSnapshot): ListedAgent[] {
  const activity = (snapshot.jobActivity ?? {}) as Activity
  return (snapshot.hobkins ?? []).map((hobkin) => durableAgent(hobkin, activity))
}

const listsMade: MadeLists<ListedAgent[]> = new WeakMap()

/**
 * The agents list: the user's durable hobkins first, then the agents at work now. Made once for each host message that
 * changes the runs, the hobkins or the activity, however many readers ask.
 */
export function listedAgents(snapshot: WireSnapshot): ListedAgent[] {
  return madeOnce(listsMade, snapshot, () => [...durableAgents(snapshot), ...agentsFrom(snapshot)])
}

/** Each value of a list by its key, the first one where two share it, made once per list and kept in `made`. */
function indexBy<Value>(made: WeakMap<readonly Value[], Map<string, Value>>, values: readonly Value[], keyOf: (value: Value) => string): Map<string, Value> {
  const held = made.get(values)
  if (held) return held

  const byKey = new Map<string, Value>()
  for (const value of values) {
    const key = keyOf(value)
    if (!byKey.has(key)) byKey.set(key, value)
  }
  made.set(values, byKey)
  return byKey
}

const hobkinsByAgent = new WeakMap<readonly HobkinSummary[], Map<string, HobkinSummary>>()
const runsById = new WeakMap<readonly RunSummary[], Map<string, RunSummary>>()
const NO_HOBKINS: readonly HobkinSummary[] = []
const NO_RUNS: readonly RunSummary[] = []

/**
 * One agent's latest words, the `update` the agents list gives it, read from that agent alone: the activity of its own
 * run, or for a durable hobkin that waits the one line of what it said last. A row reads this, so a message costs it
 * one lookup instead of the whole list.
 */
export function wordsOf(snapshot: WireSnapshot, agentId: string): string | undefined {
  const activity = (snapshot.jobActivity ?? {}) as Activity

  const hobkins = indexBy(hobkinsByAgent, snapshot.hobkins ?? NO_HOBKINS, (hobkin) => hobkinAgentId(hobkin.id))
  const hobkin = hobkins.get(agentId)
  if (hobkin) {
    const turn = hobkin.state === 'working' ? hobkin.run : null
    return turn ? updateOf(activity[turn]) : oneLine(hobkin.last?.said)
  }

  const runs = indexBy(runsById, snapshot.runs ?? NO_RUNS, (run) => String(run.id))
  const run = runs.get(agentId)
  if (!run || !isAgentRun(run)) return undefined
  return run.state === 'waiting' ? waitNoteOf(run) : updateOf(activity[agentId])
}

/**
 * The agents list in its two groups: the durable hobkins, then the agents that come and go under their count.
 * `walk` is the order Up and Down go through them all, the durable hobkins first.
 */
export function agentGroups<Agent extends ListedAgent>(agents: readonly Agent[]): { durable: Agent[]; others: Agent[]; walk: Agent[] } {
  const durable = agents.filter((agent) => agent.durable)
  const others = agents.filter((agent) => !agent.durable)
  return { durable, others, walk: [...durable, ...others] }
}
