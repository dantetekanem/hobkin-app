import type { StackCard } from './types.ts'

/** What the stage card shows in its fixed text box: one passage under the title, and a row of short facts. */
export interface CardText {
  detail: string | null
  chips: string[]
}

const ENDS_SENTENCE = /[.!?:…]$/

/** The detail, then the next step, with a full stop between them when the detail does not end a sentence itself. */
function passage(detail: string | null, next: string | null): string | null {
  if (!next) return detail
  const step = `Next: ${next}`
  if (!detail?.trim()) return step
  const lead = detail.trim()
  return ENDS_SENTENCE.test(lead) ? `${lead} ${step}` : `${lead}. ${step}`
}

/**
 * A card's words, fitted to the stage's fixed text box so the buttons under it never move: its detail and next step
 * as one passage (or why the user is the one to decide, when it has neither), and its facts, hobkin's pick and the
 * choices it will ask as short chips.
 */
export function cardText(card: StackCard): CardText {
  const chips = card.facts.map(fact => `${fact.label} ${fact.value}`)
  if (card.pick) chips.push(`hobkin suggests ${card.pick}`)
  if (card.choices.length) chips.push(`You choose from: ${card.choices.join(' · ')}`)

  return {
    detail: passage(card.detail, card.next) || card.why,
    chips,
  }
}
