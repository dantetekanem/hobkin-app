/**
 * Stand-ins for the views the window keeps mounted, for the frame replay. Each draws nothing (returns null), calls the
 * same hooks its view calls, and counts its own draws. The real views add their DOM, motion and faces on top, so what
 * the replay measures is a floor. Imported by `../window-frames.ts` once its module hooks resolve `@/`.
 */
import { createElement, memo, useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAgent, useRunningAgents, type RunningAgent } from '../../../ui/src/app/running-agents.ts'
import { useAgentActivity } from '../../../ui/src/features/agent-activity/use-agent-activity.ts'
import { exchangeOf } from '../../../ui/src/features/agent-activity/steps.ts'
import { canStopConversation } from '../../../ui/src/features/chat/availability.ts'
import { buildConversation } from '../../../ui/src/features/chat/conversation.ts'
import { doingNow, turnStartedAt } from '../../../ui/src/features/chat/doing.ts'
import { agentGroups, listedAgents } from '../../../ui/src/features/hobkins/list.ts'
import { useHomeModel } from '../../../ui/src/features/home/use-home.ts'
import { executionTargets } from '../../../ui/src/features/work/actions.ts'
import { helpersNow } from '../../../ui/src/features/work/child-summary.ts'
import { useMainChildren, useRunChildren } from '../../../ui/src/features/work/children.ts'
import { sameFields } from '../../../ui/src/lib/host/frame.ts'
import { useHasHost, useHost, useHostEqual } from '../../../ui/src/lib/host/hooks.ts'
import type { HostState } from '../../../ui/src/lib/host/state.ts'

export type Screen = 'home' | 'agent'

/** Draws per probe since the last `resetDraws`. */
export const draws: Record<string, number> = {}
const drew = (name: string) => void (draws[name] = (draws[name] ?? 0) + 1)
export const resetDraws = () => {
  for (const name of Object.keys(draws)) draws[name] = 0
}

/** A dock row's words, read as `AgentsDock.tsx` reads them today: the whole agents list, then this agent in it. */
function Words({ agent }: { agent: RunningAgent }) {
  drew('dock.AgentWords')
  const live = useHasHost()
  useHost((state) => (live ? listedAgents(state.snapshot).find((entry) => entry.id === agent.id)?.update : undefined))
  return null
}

function Helpers({ runId }: { runId: string }) {
  drew('dock.ChildCluster')
  useRunChildren(runId)
  return null
}

const Row = memo(function Row({ agent }: { agent: RunningAgent }) {
  drew('dock.AgentRow')
  return [createElement(Words, { key: 'words', agent }), createElement(Helpers, { key: 'helpers', runId: agent.durable?.run ?? agent.id })]
})

function Dock() {
  drew('dock.AgentsDock')
  const running = useRunningAgents()
  const { walk } = useMemo(() => agentGroups(running), [running])
  helpersNow(useMainChildren())
  return walk.map((agent) => createElement(Row, { key: agent.id, agent }))
}

function Composer() {
  drew('chat.Composer')
  useHost((state) => state.link)
  useHost((state) => state.home)
  useHost((state) => state.owner)
  useHost((state) => state.signIn)
  useHost((state) => state.models)
  useHost(canStopConversation)
  const { epoch, stopControls } = useHost(useShallow((state: HostState) => ({ epoch: state.epoch, stopControls: state.snapshot.stopControls })))
  useMemo(() => executionTargets({ link: 'open', home: '/fake/home', owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, epoch, snapshot: { stopControls } }), [epoch, stopControls])
  return null
}

function Avatar() {
  drew('chat.ChatAvatar')
  useHost((state) => state.snapshot.mood)
  useHost((state) => state.link === 'open' && state.snapshot.busy === true)
  useHost((state) => (state.snapshot.runs ?? []).some((run) => run.state === 'running' && run.kind === 'background'))
  useHost((state) => (state.snapshot.decisions?.length ?? 0) > 0)
  useHost((state) => turnStartedAt(state.snapshot))
  useHost((state) => state.question !== null)
  return null
}

function Status() {
  drew('chat.StatusLine')
  useHost((state) => doingNow(state.snapshot))
  useHost((state) => turnStartedAt(state.snapshot))
  useHost((state) => state.snapshot.learning)
  useHost((state) => state.snapshot.reportAttention)
  return null
}

function Chat() {
  drew('chat.ChatColumn')
  const messages = useHost((state) => state.messages)
  const live = useHost((state) => state.live)
  useMemo(() => buildConversation({ messages, live, now: Date.now() }), [messages, live])
  return null
}

function Home() {
  drew('home.HomeScreen')
  useHomeModel()
  return null
}

function Menu() {
  drew('menu.Agents')
  useRunningAgents()
  return null
}

function Page({ id }: { id: string }) {
  drew('agent.AgentScreen')
  useAgent(id)
  const activity = useAgentActivity(id)
  useHost((state) => state.snapshot.runs?.find((run) => run.id === id))
  useHostEqual((state) => executionTargets(state).find((row) => row.kind === 'run' && row.runId === id), sameFields)
  useMemo(() => (activity ? exchangeOf(activity.entries, [], { seenAt: (entry) => activity.timeOf(entry)?.seen, ended: activity.ended, cwd: activity.cwd, tasksOnLine: true }) : []), [activity])
  return null
}

const CHAT = ['composer', 'avatar', 'status', 'chat'] as const

/** What a screen keeps mounted: the dock and the chat always, then Home, or the menu's agents row and an agent's page. */
export function screenTree(screen: Screen, open: string): ReactNode {
  const chat = [Composer, Avatar, Status, Chat].map((probe, index) => createElement(probe, { key: CHAT[index] }))
  const rest = screen === 'home' ? [createElement(Home, { key: 'home' })] : [createElement(Menu, { key: 'menu' }), createElement(Page, { key: 'page', id: open })]
  return [createElement(Dock, { key: 'dock' }), ...chat, ...rest]
}
