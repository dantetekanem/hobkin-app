import { useMemo } from 'react'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import { teamsAgentsOf, type ShownTeamsAgent } from './rules.ts'

const NONE: readonly ShownTeamsAgent[] = []

/**
 * The pi-extended-teams agents of these runs, as the host has them (`teamsAgents`), running ones first. A window with
 * no host has none: they are a run's own agents, never sample ones.
 */
export function useTeamsAgents(runs: readonly (string | null | undefined)[]): readonly ShownTeamsAgent[] {
  const live = useHasHost()
  const all = useHost((state) => state.snapshot.teamsAgents)
  // The runs as one string, so a new array with the same runs reads the same.
  const key = runs.filter((run): run is string => Boolean(run)).join('\n')
  return useMemo(() => {
    const shown = live && key ? teamsAgentsOf(all, key.split('\n')) : NONE
    return shown.length ? shown : NONE
  }, [live, all, key])
}
