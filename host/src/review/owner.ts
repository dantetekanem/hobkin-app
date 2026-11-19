/**
 * Whose a pull request is. It is the user's when they wrote it, by their login on its host or one of their email
 * addresses, or when an agent the home names opened it and the first "requested by" line of its description names one
 * of their addresses; an address after "modified by" on that line does not count. A pull request nobody can place is
 * someone else's. Only the user's own is merged or closed from a review.
 */
import type { PullOwner } from '#shared/review/status.ts'

/** Who the user is: their login on the host, their email addresses, and the agents that open pull requests for someone. */
export interface WhoIsMe {
  viewer: string | null
  emails?: readonly string[]
  agents?: readonly string[]
}

const EMAIL = /[^\s<>(),;:"']+@[^\s<>(),;:"']+\.[a-z]{2,}/gi

/** The addresses the first "requested by" line names, before any "modified by" on it. */
function requestedBy(description: string): string[] {
  const line = description.split('\n').find((entry) => /requested by/i.test(entry))
  if (!line) return []
  const asked = line.slice(line.search(/requested by/i)).split(/modified by/i)[0]!
  return asked.match(EMAIL) ?? []
}

export function whosePull({ author, description }: { author: string | null; description: string }, { viewer, emails = [], agents = [] }: WhoIsMe): PullOwner {
  if (!author) return { author, mine: false }
  const same = (a: string) => (b: string) => a.toLowerCase() === b.toLowerCase()
  const isMine = (address: string) => emails.some(same(address))
  const mine = (viewer != null && same(author)(viewer)) || isMine(author) || (agents.some(same(author)) && requestedBy(description).some(isMine))
  return { author, mine }
}
