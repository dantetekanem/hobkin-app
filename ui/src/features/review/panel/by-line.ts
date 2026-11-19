/**
 * Who a pull request is from, in words: "By" its author, or "By" the agent that opened it, "for" whoever asked. A
 * finished change, or a pull request nobody is named for, has no by-line.
 */
import type { PullOwner } from '#shared/review/status.ts'

/** The people a by-line names, each by the name they go by. */
export interface PullPeople {
  author: { name: string } | null
  for?: { name: string }
}

export function byLineWords(people: PullPeople | null | undefined): string | null {
  if (!people?.author) return null
  return `By ${people.author.name}${people.for ? `, for ${people.for.name}` : ''}`
}

/** The people a review recorded when it recorded whose the pull request is: its author. */
export function peopleOfOwner(owner: PullOwner | undefined): PullPeople | null {
  return owner?.author ? { author: { name: owner.author } } : null
}
