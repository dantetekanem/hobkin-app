import { useEffect, useState } from 'react'
import type { ReviewPeople } from '#shared/review/status.ts'
import { runCommand } from '@/lib/host/index.ts'
import { createPeopleCache } from './people.ts'

const people = createPeopleCache((id) => runCommand('review.people', { id }))

/** Who a pull request review is from, as the host says, once it has said. Nothing is asked while `ask` is false. */
export function usePullPeople(id: string, ask: boolean): ReviewPeople | null {
  const [found, setFound] = useState<{ id: string; people: ReviewPeople | null } | null>(null)
  useEffect(() => {
    if (!ask) return
    let current = true
    people.of(id).then(
      (answer) => current && setFound({ id, people: answer }),
      // Not answered now: the by-line waits, and it is asked again the next time.
      () => {},
    )
    return () => {
      current = false
    }
  }, [id, ask])
  return found?.id === id ? found.people : null
}
