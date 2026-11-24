import type { ChangeRating } from '#shared/review/status.ts'
import type { NeedNumbers } from '../review/panel/needs.ts'

/**
 * What a waiting change says about its five ratings, always (063-yolo-settings-and-grades): the rate and the five numbers when
 * it is rated, and otherwise where it stands, never a dash or "no rate yet". The words are the host's `rating`; these only
 * fit them to the row's cell and fall back for a host that sends none. Pure.
 */

export interface RatingCell {
  /** What the cell says. */
  text: string
  /** Whether it is a rate with its numbers, which the cell shows stronger. */
  rated: boolean
  /** Whether the change ended not rated, which the cell shows as a problem. */
  bad: boolean
  /** An older rating, marked older, or null. */
  older: string | null
  /** The whole of it for a tooltip, with the host's own sentence and why. */
  tip: string
}

const tries = (count: number) => `${count} ${count === 1 ? 'try' : 'tries'}`
const short = (commit: string) => commit.slice(0, 7)

/** The cell of one change. `numbers` are the review's five numbers when it has them; a host that sends no `rating` leaves the cell to them. */
export function ratingCell(rating: ChangeRating | undefined, numbers: NeedNumbers | null): RatingCell {
  const grades = numbers ? numbers.numbers.map(({ value }) => (/^\d/.test(value) ? value : '–')).join(' ') : null
  const ratedText = (rate: string | undefined) => [rate, grades].filter(Boolean).join(' · ') || 'Rated'
  if (!rating) {
    return numbers
      ? { text: ratedText(numbers.rate || undefined), rated: true, bad: false, older: null, tip: 'Rated by its review.' }
      : { text: 'Rating not reported', rated: false, bad: false, older: null, tip: 'This hobkin does not say where its ratings stand.' }
  }
  const older = rating.older ? `older ${rating.older.rate} at ${short(rating.older.head)}` : null
  const tip = [rating.text, rating.older?.text].filter(Boolean).join(' ')
  const base = { rated: false, bad: false, older, tip }
  switch (rating.state) {
    case 'rated':
      return { ...base, text: ratedText(rating.rate === undefined ? numbers?.rate || undefined : String(rating.rate)), rated: true }
    case 'rating':
      return { ...base, text: 'Rating now' }
    case 'waits':
      return { ...base, text: rating.ahead === undefined ? 'Waits its turn' : rating.ahead === 0 ? 'Waits its turn: next' : `Waits its turn: ${rating.ahead} ahead` }
    case 'again':
      return { ...base, text: rating.tries === undefined ? 'Rating again' : rating.of === undefined ? `Rating again, try ${rating.tries}` : `Rating again, try ${rating.tries} of ${rating.of}` }
    case 'not-rated':
      return { ...base, text: rating.tries === undefined ? 'Not rated' : `Not rated after ${tries(rating.tries)}`, bad: true }
    case 'nothing':
      return { ...base, text: 'Nothing to rate' }
  }
}

const head = (start: string) => start.padEnd(40, '0')

/** The sample's rating of each waiting change, by its review id, so every state can be seen with no host. */
export const SAMPLE_RATINGS: Record<string, ChangeRating> = {
  'change:storefront:s2': { state: 'rating', text: 'Rating now.', older: { head: head('3b9d21'), rate: 8.2, text: 'Rated 8.2 at 3b9d21, an older commit.' } },
  'change:storefront:s3': { state: 'waits', text: 'Waits its turn: 3 ahead in storefront.', ahead: 3 },
  'change:storefront:s4': { state: 'again', text: 'Rating again, try 2 of 3: the answer had no score for visibility.', tries: 2, of: 3 },
  'change:storefront:s5': { state: 'not-rated', text: 'Not rated after 3 tries: the answer had no score for rollback.', tries: 3 },
  'change:search-api:q4': { state: 'rated', text: 'Rated at 4f2a9c1: 9.2.', head: head('4f2a9c1'), rate: 9.2 },
  'change:billing-api:b4': { state: 'nothing', text: 'It only edits Markdown, so there is nothing to rate.' },
}
