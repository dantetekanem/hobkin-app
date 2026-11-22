/**
 * What a review does as it goes off screen (`ReviewScreen`): the reviewer's memory is written at once, not at the end of
 * its second (spec 053), and the place is kept to come back to, or forgotten when the review was closed.
 */
import type { Camera } from '../story/camera.ts'
import { forgetPlace, keepPlace } from './place.ts'
import type { SessionStore } from './session.ts'

export function leaveReview({ session, memory, key, closed, camera }: {
  session: SessionStore
  memory: { flush(): void }
  /** The review at its commit (`memoryKey`). */
  key: string
  /** The review was closed, not left for another page: it opens again from its first step. */
  closed: boolean
  camera: Camera | null
}): void {
  memory.flush()
  if (closed) forgetPlace(key)
  else keepPlace(key, { ...session.getState().placeNow(), camera })
}
