/**
 * Asking hobkin from the review. The review's input, the quick link beside each unit that needs a look, and the quick
 * links beside a unit's questions in the code panel all send the same way: one message into hobkin's conversation,
 * with the review, the step and the node, so hobkin knows what "this" is. hobkin answers in its chat, which comes into
 * view beside the review for it, while the keyboard stays in the review.
 */
import type { StoreApi } from 'zustand/vanilla'
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import type { Level, Unit } from '#shared/review/assessment.ts'
import { useView } from '../../../app/view-store.ts'
import { RISK_WORDS, type StepUnit } from '../reading/model.ts'
import type { MemoryState } from '../state/memory.ts'
import type { SessionStore } from '../state/session.ts'

export type AskCommand = (name: 'conversation.send', args: CommandArgs<'conversation.send'>) => Promise<CommandResults['conversation.send']>

/**
 * A message the reviewer sent hobkin from the review, and where it stands. `sending`: on its way. `queued`: hobkin
 * took it and reads it after what it is doing. `taken`: hobkin is reading it. `failed`: it did not go.
 */
export interface PendingAsk {
  key: string
  text: string
  /** When it was sent, in milliseconds. */
  at: number
  state: 'sending' | 'queued' | 'taken' | 'failed'
  error?: string
}

/** Words that end without a stop get one. */
const sentence = (text: string) => {
  const words = text.trim()
  return /[.?!:]$/.test(words) ? words : `${words}.`
}
const about = (unit: Pick<StepUnit, 'title'>) => (unit.title ? `About "${unit.title}": ` : '')

/** A unit's question, asked of hobkin as the reviewer would ask it. */
export function questionAsk(unit: Pick<StepUnit, 'title'>, question: { text: string }): string {
  return `${about(unit)}${sentence(question.text)}`
}

/** What would change a unit's level, asked of hobkin as a way to get there. */
export function changeAsk(unit: Pick<StepUnit, 'title'>, change: { text: string; level: Level }): string {
  return `${about(unit)}the change review says this would make it ${RISK_WORDS[change.level].toLowerCase()}: ${sentence(change.text)} How would we do it?`
}

/** A unit that needs a look, asked of hobkin: why it has its level, and where to look. */
export function unitAsk(unit: Pick<Unit, 'title' | 'level'>): string {
  return `${about(unit)}why is it ${RISK_WORDS[unit.level].toLowerCase()}, and what should I check first?`
}

/**
 * Sends words to hobkin from the review, about the step the reviewer is on and a node: the one given, such as the node
 * whose code is open, else the one the reviewer pointed at, else the first in focus. hobkin's chat comes into view
 * beside the review, wide enough to read the answer. The keyboard stays where it is and never goes to the chat's
 * input, where an Escape meant for the review would stop hobkin. True once hobkin has the words.
 */
export async function askHobkin(session: SessionStore, command: AskCommand, text: string, { node }: { node?: string | null } = {}): Promise<boolean> {
  const words = text.trim()
  if (!words) return false
  const state = session.getState()
  const step = state.view.story[state.story.step]?.id
  const on = node ?? state.pointed ?? state.focus[0]
  const key = state.startAsk(words)
  useView.getState().disengageCanvas()
  try {
    const { queued } = await command('conversation.send', { text: words, review: { id: state.review.id, ...(step ? { step } : {}), ...(on ? { node: on } : {}) } })
    session.getState().settleAsk(key, queued ? 'queued' : 'taken')
    return true
  } catch (error) {
    session.getState().settleAsk(key, { error: error instanceof Error ? error.message : String(error) })
    return false
  }
}

/**
 * Keeps what the reviewer wrote in the review's input, and says where the keyboard goes next. A comment is kept as a
 * note on what they are on, for the verdict, and the keyboard goes back to the review. A question is kept too and goes
 * to hobkin at once through `send`, which marks it asked once hobkin has it; the input is ready for the next question,
 * about what the reviewer is on now, and the keyboard stays in it. A question that did not go waits, not asked yet. With no hobkin
 * to send to, as in a sample review, a question waits like a comment. A note being changed is only changed.
 */
export async function submitNote(session: SessionStore, memory: StoreApi<MemoryState>, send: ((text: string) => Promise<boolean>) | null): Promise<'review' | 'input'> {
  const note = session.getState().saveNote()
  if (!note || note.intent !== 'question' || !send) return 'review'
  session.getState().startNote('question')
  if (await send(note.text)) memory.getState().markSent(session.getState().review, [note.id], Date.now())
  return 'input'
}
