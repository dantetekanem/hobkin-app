import type { CommandArgs, CommandResults, TakenBack } from '#shared/commands/registry.ts'
import { hobkinOfAgent } from '#shared/protocol/hobkins.ts'
import type { HostState } from '../../lib/host/state.ts'
import { draftAfterStop } from '../chat/outbox.ts'
import { executionTargets, type ExecutionControl } from './actions.ts'

/**
 * Talking to an agent from its page, one way for every agent: a run hobkin started and a durable hobkin the user started
 * and drives. Each agent's own commands are behind it (`agentTalk`), its turn in flight stops the same way (`talkTurn`),
 * and the keys are the main chat's (`composer-keys.ts`). The page's controls are `useTalkControls`. Pure, so the rules
 * are tested without a window.
 */

/** The agent a talk box speaks to. */
export type TalkAgent = { kind: 'run'; run: string } | { kind: 'hobkin'; id: string }

/** How a message waits for the agent's turn in flight, as Pi's keys queue it: Enter steers, Alt+Enter follows up, Control+Enter interrupts. */
export type TalkQueue = 'steer' | 'follow-up' | 'interrupt'

/** What Continue sends after the user stopped a durable hobkin's turn. Pi cannot resume a stopped run, so the user's word goes. */
export const CONTINUE_WORDS = 'Continue'

export interface TalkMessage {
  text: string
  noteId?: string
  /** The handles of the images attached for this agent. */
  images?: readonly string[]
  /** When the user pressed Enter, for the timing of a turn the words start. */
  sentAt?: number
  queue?: TalkQueue
}

export interface TalkSaid {
  /** The words wait for the turn in flight. */
  queued: boolean
  /** The words started the agent's next turn: a durable hobkin's that waited. */
  started: boolean
  /** The run the words reached or started. */
  run: string
  /** What a turn the words interrupted never read, as the user typed it. */
  unsent: readonly TakenBack[]
}

/** What a talk box does to its agent through the host. Stop and force are its turn's (`talkTurn`), the same for every agent. */
export interface AgentTalk {
  /** While the agent works the words reach its turn as `queue` says; a durable hobkin that waits takes them as its next turn. */
  say(message: TalkMessage): Promise<TalkSaid>
  /** Pi's Alt+Up: what waits for the turn in flight comes back, and the turn goes on. */
  takeBack(): Promise<readonly TakenBack[]>
}

/** How the host is asked: `runCommand`, or a fake in a test. */
export type TalkRun = <Name extends 'agent.say' | 'agent.dequeue' | 'hobkin.say' | 'hobkin.dequeue'>(name: Name, args: CommandArgs<Name>) => Promise<CommandResults[Name]>

export function agentTalk(agent: TalkAgent, run: TalkRun): AgentTalk {
  const words = ({ text, noteId, images, queue }: TalkMessage) => ({
    ...(text ? { text } : {}),
    ...(noteId ? { noteId } : {}),
    ...(images?.length ? { images: [...images] } : {}),
    ...(queue ? { queue } : {}),
  })

  if (agent.kind === 'run') {
    return {
      say: async (message) => {
        const said = await run('agent.say', { run: agent.run, ...words(message) })
        return { queued: said.queued, started: false, run: agent.run, unsent: said.unsent ?? [] }
      },
      takeBack: async () => (await run('agent.dequeue', { run: agent.run })).unsent,
    }
  }
  return {
    say: async (message) => {
      const sentAt = message.sentAt === undefined ? {} : { sentAt: message.sentAt }
      const said = await run('hobkin.say', { id: agent.id, ...words(message), ...sentAt })
      return { queued: said.queued, started: said.started, run: said.run, unsent: said.unsent ?? [] }
    },
    takeBack: async () => (await run('hobkin.dequeue', { id: agent.id })).unsent,
  }
}

/** The run of the agent's turn in flight: a run is its own turn, and a durable hobkin's is the run of the turn it works on. */
function turnRun(state: Pick<HostState, 'snapshot'>, agent: TalkAgent): string | null {
  if (agent.kind === 'run') return agent.run
  return state.snapshot.hobkins?.find((hobkin) => hobkin.id === agent.id)?.run ?? null
}

/** The control that stops the agent's turn in flight, while there is one to stop. */
export function talkTurn(state: Pick<HostState, 'link' | 'home' | 'owner' | 'snapshot' | 'epoch'>, agent: TalkAgent): ExecutionControl | undefined {
  const run = turnRun(state, agent)
  if (run === null) return undefined
  return executionTargets(state).find((target) => target.kind === 'run' && target.runId === run && target.canStop)
}

/** What End ends on an agent's page: a durable hobkin, or a run, which End force stops. */
export type EndTarget = { kind: 'hobkin'; id: string } | { kind: 'run'; control: ExecutionControl }

/**
 * What End and Control+X end for an agent, by the id the window names it with: a durable hobkin the host has, never
 * only its turn, or a run while the host can force stop it. Null when there is nothing to end, as once a run has finished.
 */
export function endTarget(state: Pick<HostState, 'link' | 'home' | 'owner' | 'snapshot' | 'epoch'>, agentId: string): EndTarget | null {
  const hobkin = hobkinOfAgent(agentId)
  if (hobkin !== null) return state.snapshot.hobkins?.some((summary) => summary.id === hobkin) ? { kind: 'hobkin', id: hobkin } : null
  const control = executionTargets(state).find((target) => target.kind === 'run' && target.runId === agentId && target.canForce)
  return control ? { kind: 'run', control } : null
}

/** The agent's last turn is one the user stopped and nothing has started since, so it can go on. A run ends when it is stopped. */
export function stoppedTurn(state: Pick<HostState, 'snapshot'>, agent: TalkAgent): boolean {
  if (agent.kind === 'run') return false
  const hobkin = state.snapshot.hobkins?.find((summary) => summary.id === agent.id)
  return hobkin?.state === 'waiting' && hobkin.last?.status === 'interrupted'
}

/** A message the page sent that may still wait for the turn: how it waits, and whether the turn has read it yet. */
export interface WaitingNote {
  id: string
  text: string
  queue?: 'steer' | 'follow-up'
  waiting: boolean
}

/** A quiet row above the box for a message that waits for the turn, with how it waits. */
export interface QueuedRow {
  key: string
  queue: 'steer' | 'follow-up'
  text: string
}

/** The rows for what waits for the turn, in the order it was sent. */
export function waitingRows(notes: readonly WaitingNote[]): QueuedRow[] {
  return notes.flatMap((note) => (note.waiting && note.queue ? [{ key: note.id, queue: note.queue, text: note.text }] : []))
}

/** The box once what was given back is in it, ahead of what is being typed. */
export const draftWithTakenBack = (draft: string, unsent: readonly TakenBack[]): string => draftAfterStop(unsent.map(({ text }) => text), draft)

/** The page's notes that came back into the box, by their ids: they leave the page. */
export const takenNoteIds = (unsent: readonly TakenBack[]): string[] => unsent.flatMap(({ noteId }) => (noteId ? [noteId] : []))
