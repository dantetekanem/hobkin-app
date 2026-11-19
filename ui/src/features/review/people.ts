/**
 * Who each review's pull request is from, asked of the host once while the window is open, so the list of AI reviews
 * and the review panel share the answer and opening a review from the list asks nothing again. A question the host
 * could not answer is forgotten, so it is asked again the next time.
 */
import type { ReviewPeople } from '#shared/review/status.ts'

export function createPeopleCache(ask: (id: string) => Promise<ReviewPeople | null>) {
  const answers = new Map<string, Promise<ReviewPeople | null>>()
  return {
    of(id: string): Promise<ReviewPeople | null> {
      const known = answers.get(id)
      if (known) return known
      const asked = ask(id).catch((error: unknown) => {
        answers.delete(id)
        throw error
      })
      answers.set(id, asked)
      return asked
    },
  }
}
