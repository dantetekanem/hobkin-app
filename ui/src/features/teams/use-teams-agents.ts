import { useMemo } from 'react'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import { stillShown, teamsAgentsOf, type ShownTeamsAgent } from './rules.ts'

const NONE: readonly ShownTeamsAgent[] = []

export function useTeamsAgents(runs: readonly (string | null | undefined)[]): readonly ShownTeamsAgent[] {
  const live = useHasHost()
  const all = useHost((state) => state.snapshot.teamsAgents)
  const key = runs.filter(Boolean).join('\n')
  return useMemo(() => live && key ? stillShown(teamsAgentsOf(all, key.split('\n'))) : NONE, [live, all, key])
}
