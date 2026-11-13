import { useMemo } from 'react'
import { create } from 'zustand'
import type { Choice } from '@/features/questions/queue.ts'
import { useQuestions } from '@/features/questions/store.ts'
import { useSettings } from '@/features/settings/store.ts'
import { useAgentThreads } from '@/features/work/agent-threads.ts'
import { createAgentControls, executionTargets, receiptText, type AgentControlState } from '@/features/work/actions.ts'
import { runExecution } from '@/features/work/store.ts'
import { listedAgents, type ListedAgent } from '@/features/hobkins/list.ts'
import { hobkinOfAgent } from '#shared/protocol/hobkins.ts'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import { hasHost } from '@/lib/host/frame.ts'
import { hostStore, useHasHost, useHost } from '@/lib/host/index.ts'
import { agentQuestionId, answeredAgents, nextAsking, waitingFirst } from './asking.ts'
import { useView } from './view-store.ts'

/**
 * The agents working right now, for the frame. With a host connected they are hobkin's own: every run that is
 * not the main conversation (agents it started, routines running), with what each is doing and its mood from
 * its activity. With no host they are sample values: as many as the "Agents at once" setting allows, two of
 * them waiting for the user, to show what that looks like.
 */
export interface RunningAgent extends ListedAgent {
  /** What the agent is waiting on the user for, in its own words. Absent while it gets on with its work. */
  asks?: string
  /** The answers it offers, shown in the question sheet. The user can always type another. */
  choices?: Choice[]
  /** The choice the agent recommends, and why. */
  recommended?: string
  why?: string
}

const POOL: RunningAgent[] = [
  { id: 'a1', title: 'Fix the login redirect loop', project: 'storefront', doing: 'running the auth tests', tier: 'high', hue: 262, mood: 'working', kind: 'work' },
  {
    id: 'a2',
    title: 'Look for dependency updates',
    project: 'billing-api',
    doing: 'reading the changelog',
    tier: 'fast',
    hue: 200,
    mood: 'searching',
    kind: 'work',
    asks: 'One update changes how invoices round. Take it now, or hold it for a review?',
    choices: [
      { value: 'take', label: 'Take it now' },
      { value: 'hold', label: 'Hold it for a review' },
    ],
    recommended: 'hold',
    why: 'Rounding changes what customers are charged, so a person should see it before it ships.',
  },
  { id: 'a3', title: 'Morning recap', project: 'routine', doing: 'writing the report', tier: 'mid', hue: 86, mood: 'thinking', kind: 'routine' },
  { id: 'a4', title: 'Tighten the checkout tests', project: 'storefront', doing: 'reading the test file', tier: 'mid', hue: 20, mood: 'working', kind: 'work' },
  {
    id: 'a5',
    title: 'Review the invoice export',
    project: 'billing-api',
    doing: 'grading the diff',
    tier: 'high',
    hue: 320,
    mood: 'focused',
    kind: 'work',
    asks: 'The export has no test for refunds. Should I add one before I grade it?',
    choices: [
      { value: 'add', label: 'Add the refund test first' },
      { value: 'grade', label: 'Grade it as it is' },
    ],
    recommended: 'add',
    why: 'Refunds are where exports like this usually break.',
  },
  { id: 'a6', title: 'Refresh the install guide', project: 'docs-site', doing: 'checking the commands', tier: 'fast', hue: 150, mood: 'working', kind: 'work' },
  { id: 'a7', title: 'Watch the last release', project: 'storefront', doing: 'reading the error log', tier: 'fast', hue: 40, mood: 'searching', kind: 'work' },
  { id: 'a8', title: 'Plan the rate limiter', project: 'billing-api', doing: 'tracing the request path', tier: 'max', hue: 290, mood: 'thinking', kind: 'work' },
]

/** The questions answered in this window. Sample state: the host will say which agents are waiting. */
const useAnswered = create<{ ids: readonly string[] }>()(() => ({ ids: [] }))

/** An agent that has had its answer gets on with its work. */
function settle(agent: RunningAgent, answered: readonly string[]): RunningAgent {
  if (!agent.asks || !answered.includes(agent.id)) return agent
  const { asks: _answered, ...working } = agent
  return working
}

function running(limit: number, answered: readonly string[]): RunningAgent[] {
  // An agent that waits for the user comes first, so it is never below the fold of a long list.
  return waitingFirst(POOL.slice(0, limit).map((agent) => settle(agent, answered)))
}

/** hobkin's agents with a host: the user's durable hobkins, then every run at work that is not the main conversation. */
function useHostedAgents(): RunningAgent[] {
  const runs = useHost((state) => state.snapshot.runs)
  const jobActivity = useHost((state) => state.snapshot.jobActivity)
  const hobkins = useHost((state) => state.snapshot.hobkins)
  return useMemo(() => listedAgents({ runs, jobActivity, hobkins }), [runs, jobActivity, hobkins])
}

export function useRunningAgents(): RunningAgent[] {
  const live = useHasHost()
  const hosted = useHostedAgents()
  const limit = useSettings((state) => state.agents)
  const answered = useAnswered((state) => state.ids)
  return useMemo(() => (live ? hosted : running(limit, answered)), [live, hosted, limit, answered])
}

/** One agent, following whether it is still waiting. It is found even after it has left the list. */
export function useAgent(id: string | null): RunningAgent | undefined {
  const live = useHasHost()
  const hosted = useHostedAgents()
  const answered = useAnswered((state) => state.ids)
  return useMemo(() => {
    if (live) return hosted.find((agent) => agent.id === id)
    const agent = POOL.find((entry) => entry.id === id)
    return agent && settle(agent, answered)
  }, [id, live, hosted, answered])
}

/** The running agents as they are this instant, for code outside a component. */
export function runningAgents(): RunningAgent[] {
  const host = hostStore.getState()
  if (hasHost(host)) return listedAgents(host.snapshot)
  return running(useSettings.getState().agents, useAnswered.getState().ids)
}

export const useAgentControl = create<AgentControlState>()(() => ({ target: null, busy: false, result: null }))
export const agentControls = createAgentControls({
  selected: () => {
    const view = useView.getState()
    const host = hostStore.getState()
    // A durable hobkin is stopped through the run of its turn in flight. Stop never ends the hobkin.
    const runId = view.screen === 'agent' ? (turnInFlight(host.snapshot, view.openAgent) ?? view.openAgent) : null
    const control =
      view.screen === 'agent'
        ? executionTargets(host).find(target => target.kind === 'run' && target.runId === runId)
        : undefined
    const agent = view.screen === 'agent' ? findAgent(view.openAgent) : undefined

    if (control) {
      return {
        id: control.runId,
        title: control.label,
        project: control.rootId,
        kind: control.kind,
        source: JSON.stringify([host.home, host.epoch, control.epoch]),
      }
    }

    if (!hasHost(host) && agent) {
      return { ...agent, source: `${host.home}:${host.epoch}` }
    }

    return undefined
  },
  send: async (id, mode = 'stop') => {
    const target = executionTargets(hostStore.getState()).find(target => target.kind === 'run' && target.runId === id)
    if (!target) throw new Error('No live control for this run. Nothing was stopped.')
    const receipt = await runExecution(target, mode, 'for-now')
    return receipt ? receiptText(receipt) : 'Current execution result unknown.'
  },
  changed: (state) => useAgentControl.setState(state),
})
const unsubscribeControls = hostStore.subscribe((state, previous) => {
  if (state.home !== previous.home || state.epoch !== previous.epoch || state.link !== previous.link) agentControls.reset()
})
import.meta.hot?.dispose(unsubscribeControls)

/** What the agent asked, also after the user has answered it, so the canvas can keep the exchange. */
export function questionOf(id: string | null): string | undefined {
  // Sample agents only. A real agent's question reaches the user through hobkin's own questions (the question sheet).
  if (hasHost(hostStore.getState())) return undefined
  return POOL.find((entry) => entry.id === id)?.asks
}

/** What some sample agents have done so far, in hobkin's activity shape, by agent id. A real agent's comes from the host (`useAgentActivity`). */
export { SAMPLE_ACTIVITY } from '@/features/agent-activity/sample.ts'

/** The run of a durable hobkin's turn in flight, for its agent id. Null for any other agent, and while it waits. */
function turnInFlight(snapshot: WireSnapshot, agentId: string | null): string | null {
  const id = hobkinOfAgent(agentId)
  return id ? (snapshot.hobkins?.find((hobkin) => hobkin.id === id)?.run ?? null) : null
}

export function findAgent(id: string | null): RunningAgent | undefined {
  const host = hostStore.getState()
  if (hasHost(host)) return listedAgents(host.snapshot).find((agent) => agent.id === id)
  const agent = POOL.find((entry) => entry.id === id)
  return agent && settle(agent, useAnswered.getState().ids)
}

/** The user answered this agent. */
export function answerAgent(id: string): void {
  const { ids } = useAnswered.getState()
  if (!ids.includes(id)) useAnswered.setState({ ids: [...ids, id] })
}

/**
 * Puts an agent's question in the question sheet, the same one Action Items uses: its choices, the one it
 * recommends, and room to type another answer. False when the agent is not waiting.
 */
export function askAgent(id: string): boolean {
  const agent = findAgent(id)
  if (!agent?.asks) return false
  useView.getState().closeVeil()
  useQuestions.getState().raise({
    id: agentQuestionId(agent.id),
    from: agent.title,
    question: agent.asks,
    choices: agent.choices ?? [],
    recommended: agent.recommended,
    why: agent.why,
  })
  return true
}

/** Asks the next agent that is waiting, after the one on the canvas. False when nobody is waiting. */
export function answerNext(): boolean {
  const view = useView.getState()
  const next = nextAsking(runningAgents(), view.screen === 'agent' ? view.openAgent : null)
  return next ? askAgent(next) : false
}

// An answer given in the sheet, here or from Action Items, reaches the agent that asked: it stops waiting,
// and its exchange keeps the answer in words.
useQuestions.subscribe((state, previous) => {
  if (state.queue.answered === previous.queue.answered) return
  const labelOf = (agentId: string, value: string) => POOL.find((agent) => agent.id === agentId)?.choices?.find((choice) => choice.value === value)?.label
  for (const { agentId, text } of answeredAgents(previous.queue.answered, state.queue.answered, labelOf)) {
    answerAgent(agentId)
    useAgentThreads.getState().say(agentId, text)
  }
})
