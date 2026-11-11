import { childrenFrom, mainChildrenFrom } from '@/lib/host/frame.ts'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import type { RunChild } from '#shared/protocol/snapshot.ts'

/**
 * The agents the frame's sample agents spawned through pi-extended-teams, for a window with no host, in the shape
 * the host sends (`RunChild`). Each standing a run's agent can have is here once. Nothing here came from hobkin.
 */
const MINUTE_MS = 60_000
const loaded = Date.now()

export const sampleChildren: Record<string, readonly RunChild[]> = {
  a1: [
    { name: 'auth-scout', role: 'read', modelSlot: 'read-collect', state: 'reported', startedAt: loaded - 9 * MINUTE_MS, endedAt: loaded - 6 * MINUTE_MS },
    { name: 'redirect-fix', role: 'write', modelSlot: 'write-feature', state: 'running', phase: 'working', activeTool: 'bash', startedAt: loaded - 5 * MINUTE_MS },
    { name: 'test-review', role: 'read', modelSlot: 'read-review', state: 'queued', queuePosition: 1, startedAt: loaded - 5 * MINUTE_MS },
  ],
  a2: [
    { name: 'changelog-reader', role: 'read', modelSlot: 'read-collect', state: 'running', group: 'deps-look', phase: 'thinking', startedAt: loaded - 3 * MINUTE_MS },
    { name: 'lockfile-check', role: 'read', modelSlot: 'read-collect', state: 'failed', group: 'deps-look', endedAt: loaded - 3 * MINUTE_MS },
    { name: 'advisory-scan', role: 'read', modelSlot: 'read-collect', state: 'stopped', startedAt: loaded - 20 * MINUTE_MS },
  ],
}

/** hobkin's own helpers in the sample: a review swarm, one still out and one in line. */
export const sampleMainChildren: readonly RunChild[] = [
  { name: 'routine-scout', role: 'read', modelSlot: 'read-collect', state: 'reported', group: 'routines', startedAt: loaded - 2 * MINUTE_MS, endedAt: loaded - MINUTE_MS },
  { name: 'routine-review', role: 'read', modelSlot: 'read-review', state: 'running', group: 'routines', phase: 'working', activeTool: 'read', startedAt: loaded - 2 * MINUTE_MS },
  { name: 'schedule-check', role: 'read', modelSlot: 'read-collect', state: 'queued', queuePosition: 1, startedAt: loaded - MINUTE_MS },
]

const NO_CHILDREN: readonly RunChild[] = []

/** The agents a run spawned: the host's for a live window, the sample's before a host has answered. */
export function useRunChildren(runId: string): readonly RunChild[] {
  const live = useHasHost()
  const children = useHost((state) => childrenFrom(state.snapshot, runId))
  return live ? children : (sampleChildren[runId] ?? NO_CHILDREN)
}

/** The agents hobkin's own chat spawned: the host's for a live window, the sample's before a host has answered. */
export function useMainChildren(): readonly RunChild[] {
  const live = useHasHost()
  const children = useHost((state) => mainChildrenFrom(state.snapshot))
  return live ? children : sampleMainChildren
}
