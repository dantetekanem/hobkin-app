import { useMemo, useRef } from 'react'
import { create } from 'zustand'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { useAgentJobs, useJobsHelpers } from '@/features/agent-activity/agent-jobs.ts'
import { activityAgents, helperStays, type ActivityAgent } from './activity.ts'
import { useTeamsAgents } from './use-teams-agents.ts'

/**
 * The navigator open over an agent's page: whose agents, the one it shows, where the keyboard goes back to, and the right
 * side of the window it covers (`data-canvas-surface`), or none outside the window.
 */
export interface NavigatorOpen {
  agent: string
  at: string
  from: HTMLElement | null
  side: HTMLElement | null
}

/**
 * One navigator for the window, as pi-extended-teams has one agent navigation. `rows` are the agents each strip draws
 * now, by its agent's id, so Down in that agent's input knows whether there is anything to open.
 */
export const useNavigator = create<{ open: NavigatorOpen | null; rows: Record<string, readonly string[]> }>(() => ({ open: null, rows: {} }))

/**
 * Opens the navigator over `agent`'s agents, on `at` or its first. False when its strip draws none, so the key that
 * asked is left to do what it does without it.
 */
export function openNavigator(agent: string, { at, from }: { at?: string; from?: HTMLElement | null } = {}): boolean {
  const ids = useNavigator.getState().rows[agent]
  if (!ids?.length) return false

  const shown = at && ids.includes(at) ? at : ids[0]!
  // Opened by a key, the keyboard goes back to where it was: the agent's input.
  const keyboard = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  const back = from ?? keyboard
  const side = back?.closest<HTMLElement>('[data-canvas-surface]') ?? null
  useNavigator.setState({ open: { agent, at: shown, from: back, side } })
  return true
}

export const closeNavigator = () => useNavigator.setState({ open: null })

/** Whether `agent`'s strip draws any agents now. Under its input, they take the place of its empty status line. */
export const useHasSubagents = (agent: string): boolean => useNavigator((state) => (state.rows[agent]?.length ?? 0) > 0)

export const moveNavigator = (at: string) => useNavigator.setState((state) => (state.open ? { open: { ...state.open, at } } : state))

const keyOf = (child: RunChild) => child.id ?? child.name
const NOTHING_READ: ReadonlySet<string> = new Set()

/**
 * An agent's agents as its strip and navigator show them: the pi-extended-teams agents of all its jobs, done ones left
 * out, and the helpers hobkin started for them, those that reported, completed or were cancelled left out; what is still
 * out first. While the user is `reading` them in the navigator, every one it has shown stays, marked as it ends, so
 * nothing leaves under them; closed, those that ended leave.
 */
export function useSubagents(agentId: string, reading: boolean): readonly ActivityAgent[] {
  const jobs = useAgentJobs(agentId)
  const teams = useTeamsAgents(jobs, { list: reading })
  const helpers = useJobsHelpers(jobs)
  // The helpers shown since the navigator opened, by key. Read from what was read before, as `useTeamsAgents` does.
  const read = useRef<ReadonlySet<string>>(NOTHING_READ)
  return useMemo(() => {
    const readBefore = reading ? read.current : NOTHING_READ
    const shownHelpers = helpers.filter((child) => helperStays(child) || readBefore.has(keyOf(child)))
    read.current = reading ? new Set([...readBefore, ...shownHelpers.map(keyOf)]) : NOTHING_READ
    return activityAgents(teams, shownHelpers)
  }, [teams, helpers, reading])
}
