import { ALWAYS_CHOICE, type Sure } from '../../../../shared/protocol/question.ts'
import { clockTime, dayLabel, timeOf } from '../reports/time.ts'
import type { Choice, Question } from './queue.ts'

/**
 * What a card says of itself, in the words the sheet and Action Items show (075 S7): how sure hobkin is of its pick,
 * whether it can be undone, what hobkin does if nobody answers, and the rule a learn card's last choice keeps.
 */

const SURE_WORDS: Record<Sure, string> = { high: 'sure', medium: 'fairly sure', low: 'not sure' }

export const sureWords = (sure: Sure) => SURE_WORDS[sure]

/** The deadline as the conversation writes a time, with its day when it is not today. */
function byWhen(at: number, now: number): string {
  const day = dayLabel(at, now)
  return day === 'Today' ? clockTime(at) : `${day}, ${clockTime(at)}`
}

/** The card's facts in one line's parts: whether it can be undone, then what happens if nobody answers. */
export function factsOf(question: Question, now: number): string[] {
  const facts: string[] = []
  if (question.reversible !== undefined) {
    facts.push(question.reversible ? 'Can be undone' : "Can't be undone")
  }

  const pick = question.choices.find(({ value }) => value === question.recommended)
  const takenAt = timeOf(question.defaultsAt)
  if (pick && takenAt !== null) {
    facts.push(`If you don't answer by ${byWhen(takenAt, now)}, hobkin picks ${pick.label}`)
  }
  return facts
}

/** The rule a learn card's last choice keeps, without the "Always:" it is labelled with, or null for any other choice. */
export function ruleOf(choice: Choice, question: Question): string | null {
  if (!question.learn || choice.value !== ALWAYS_CHOICE) return null
  return choice.label.replace(/^Always:\s*/i, '')
}
