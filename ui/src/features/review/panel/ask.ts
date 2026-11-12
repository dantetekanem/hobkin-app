/**
 * Asking hobkin from the review. The box in the panel and the quick links beside a unit's questions in the code panel
 * send the same way: one message into hobkin's conversation, with the review, the step and the node, so hobkin knows
 * what "this" is. The message shows at once in the review's conversation, and the panel stays open while the
 * reviewer talks.
 */
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import type { Level } from '#shared/review/assessment.ts'
import { RISK_WORDS, type StepUnit } from '../reading/model.ts'
import type { SessionStore } from '../state/session.ts'

export type AskCommand = (name: 'conversation.send', args: CommandArgs<'conversation.send'>) => Promise<CommandResults['conversation.send']>

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

/**
 * Sends words to hobkin from the review, about the step the reviewer is on and a node: the one given, such as the node
 * whose code is open, else the one the reviewer pointed at, else the first in focus. True once hobkin has them.
 */
export async function askHobkin(session: SessionStore, command: AskCommand, text: string, node?: string | null): Promise<boolean> {
  const words = text.trim()
  if (!words) return false
  const state = session.getState()
  const step = state.view.story[state.story.step]?.id
  const on = node ?? state.pointed ?? state.focus[0]
  const key = state.startAsk(words)
  try {
    const { queued } = await command('conversation.send', { text: words, review: { id: state.review.id, ...(step ? { step } : {}), ...(on ? { node: on } : {}) } })
    session.getState().settleAsk(key, queued ? 'queued' : 'taken')
    return true
  } catch (error) {
    session.getState().settleAsk(key, { error: error instanceof Error ? error.message : String(error) })
    return false
  }
}
