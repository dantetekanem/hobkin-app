import { useMemo } from 'react'
import { create } from 'zustand'
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

export function useSubagents(agentId: string): readonly ActivityAgent[] {
  const jobs = useAgentJobs(agentId)
  const teams = useTeamsAgents(jobs)
  const helpers = useJobsHelpers(jobs)
  return useMemo(() => activityAgents(teams, helpers.filter(helperStays)), [teams, helpers])
}
