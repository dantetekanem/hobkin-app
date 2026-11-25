import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { sameFields } from '@/lib/host/frame.ts'
import { runCommand, useHost, useHostEqual } from '@/lib/host/index.ts'
import { composerKey } from '../chat/composer-keys.ts'
import { STOP_ARMED_MS, stopKey } from '../chat/stop-key.ts'
import { armedAt, type ArmedStop } from '../chat/stop-turn.ts'
import { executionKey } from './actions.ts'
import { runExecution, useExecution } from './store.ts'
import type { TakenBack } from '#shared/commands/registry.ts'
import { agentTalk, CONTINUE_WORDS, draftWithTakenBack, stoppedTurn, takenNoteIds, talkTurn, type AgentTalk, type TalkAgent, type TalkQueue } from './talk.ts'

/** What the page's box does when a key or the button asks: its own way of sending and taking back, so its rows stay right. */
export interface TalkBox {
  /** The draft can go: words or images, every image held, nothing else under way. */
  canSend: boolean
  /** The box holds no words and no images. */
  empty: boolean
  /** Something the user sent waits for the turn in flight. */
  queued: boolean
  /** Sends `words`, or the draft without them, waiting for the turn in flight as `queue` says. */
  send: (words?: string, queue?: TalkQueue) => void
  /** Changes the box's words, as React's setter does. */
  setDraft: (update: (draft: string) => string) => void
  /** The page's notes that came back into the box leave the page, by their ids. */
  dropNotes: (noteIds: readonly string[]) => void
  /** Says under the box why something did not happen. */
  setProblem: (problem: string) => void
}

export interface TalkControls {
  /** The agent's commands: say and take back. */
  talk: AgentTalk
  /** A turn runs that can be stopped now: the button is Stop. */
  working: boolean
  stopping: boolean
  /** The first Esc of a stop was pressed during this turn, and a second soon after stops it. */
  stopArmed: boolean
  /** The last turn is one the user stopped and nothing has started since, so Enter in an empty box continues it. */
  stopped: boolean
  stop: () => void
  force: () => void
  /** Pi's Alt+Up: what waits for the turn comes back into the box, ahead of what is being typed. */
  takeBack: () => Promise<void>
  /** Puts what a turn gave back unread into the box, as a message that interrupted it does. */
  giveBack: (unsent: readonly TakenBack[]) => void
  /** The keys the box shares with the main chat. True when the key was used; Escape with no turn running is left to the page. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
}

/**
 * The controls of an agent's message box, the same for a run and a durable hobkin as for the main chat: Enter steers the
 * turn in flight, Alt+Enter follows it up, Control+Enter stops it and sends at once, Alt+Up takes back what waits, Enter in
 * an empty box continues a turn the user stopped, and Escape twice or Control+C stops the turn. Stop and force reach the
 * turn's run as the host's stop controls have it (`talkTurn`).
 */
export function useTalkControls(agent: TalkAgent, box: TalkBox): TalkControls {
  const agentKey = agent.kind === 'run' ? agent.run : agent.id
  const talk = useMemo(() => agentTalk(agent, runCommand), [agent.kind, agentKey])
  const target = useHostEqual((state) => talkTurn(state, agent), sameFields)
  const stopped = useHost((state) => stoppedTurn(state, agent))
  const execution = useExecution()
  const stopping = target !== undefined && execution.pending[executionKey(target, 'stop')] === true
  const working = target !== undefined

  // When the first Escape was pressed, and during which turn, while the second is waited for.
  const [armed, setArmed] = useState<ArmedStop | null>(null)
  const turn = target?.runId ?? null
  const armedSince = armedAt(armed, turn)
  useEffect(() => {
    if (armed === null) return
    if (armedSince === null) return setArmed(null)
    const timer = setTimeout(() => setArmed(null), STOP_ARMED_MS)
    return () => clearTimeout(timer)
  }, [armed, armedSince])

  const stop = () => {
    setArmed(null)
    if (target) void runExecution(target, 'stop')
  }
  const force = () => {
    if (target) void runExecution(target, 'force')
  }

  const giveBack = (unsent: readonly TakenBack[]) => {
    if (!unsent.length) return
    box.setDraft((draft) => draftWithTakenBack(draft, unsent))
    box.dropNotes(takenNoteIds(unsent))
  }
  const takeBack = async () => {
    try {
      giveBack(await talk.takeBack())
    } catch (error) {
      box.setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return false
    const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey

    if (event.key === 'Escape' && bare && turn !== null) {
      // One Escape never stops: the first asks, and a second soon after stops the turn the first was pressed during.
      const pressed = stopKey(armedSince, Date.now())
      if (pressed.stop) stop()
      else setArmed(pressed.armedAt === null ? null : { at: pressed.armedAt, turn })
      return true
    }
    if (event.key === 'c' && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && working) {
      stop()
      return true
    }

    const action = composerKey(
      { key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey },
      { turnRunning: working, canSend: box.canSend, empty: box.empty, stopped, queued: box.queued },
    )
    switch (action?.do) {
      case undefined:
        return false
      case 'send':
        box.send()
        break
      case 'follow-up':
      case 'interrupt':
        box.send(undefined, action.do)
        break
      case 'continue':
        box.send(CONTINUE_WORDS)
        break
      case 'dequeue':
        void takeBack()
        break
      case 'nothing':
        break
    }
    return true
  }

  return { talk, working, stopping, stopArmed: armedSince !== null, stopped, stop, force, takeBack, giveBack, onKeyDown }
}
