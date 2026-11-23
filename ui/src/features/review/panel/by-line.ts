/**
 * Who a pull request is from, in words: "By" its author, or "By" the agent that opened it, "for" whoever asked. A
 * finished change, or a pull request nobody is named for, has no by-line.
 */
import type { PullOwner } from '#shared/review/status.ts'

/** Someone a by-line names: the name they go by, and their profile when one is known. */
export interface Named {
  name: string
  url?: string
}

/** The people a by-line names. */
export interface PullPeople {
  author: Named | null
  for?: Named
}

export function byLineWords(people: PullPeople | null | undefined): string | null {
  if (!people?.author) return null
  return `By ${people.author.name}${people.for ? `, for ${people.for.name}` : ''}`
}

/** The people a review recorded when it recorded whose the pull request is: its author. */
export function peopleOfOwner(owner: PullOwner | undefined): PullPeople | null {
  return owner?.author ? { author: { name: owner.author } } : null
}
