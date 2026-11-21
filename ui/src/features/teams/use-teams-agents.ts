import { useMemo, useRef } from 'react'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import { stillRead, stillShown, teamsAgentsOf, type Reading, type ShownTeamsAgent } from './rules.ts'

const NONE: readonly ShownTeamsAgent[] = []
const CLOSED: Reading = { list: false }

/**
 * The pi-extended-teams agents of these runs that are still worth showing (`teamsAgents`, done ones left out), running ones first. A window with
 * no host has none: they are a run's own agents, never sample ones. What the user has `open` stays, marked done, until
 * they close it, so a list or a sheet never empties under them.
 */
export function useTeamsAgents(runs: readonly (string | null | undefined)[], open: Reading = CLOSED): readonly ShownTeamsAgent[] {
  const live = useHasHost()
  const all = useHost((state) => state.snapshot.teamsAgents)
  // The runs as one string, so a new array with the same runs reads the same.
  const key = runs.filter((run): run is string => Boolean(run)).join('\n')
  const reading = useRef<ReadonlySet<string>>(new Set())
  return useMemo(() => {
    const agents = live && key ? teamsAgentsOf(all, key.split('\n')) : NONE
    // Read from what was read before, so drawing again with the same agents and the same open reads the same.
    reading.current = stillRead(reading.current, agents, { list: open.list, agent: open.agent })
    const shown = stillShown(agents, reading.current)
    return shown.length ? shown : NONE
  }, [live, all, key, open.list, open.agent])
}
