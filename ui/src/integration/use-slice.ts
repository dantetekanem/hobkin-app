import { useHasHost, useHost } from '../lib/host/hooks.ts'
import { heldSlice, sampleOf } from './slice.ts'
import { windowPart } from './registry.ts'

/**
 * An integration's state as the screen draws it: the part's sample with no host, and with one the slice the host
 * sent under the integration's id, or the part's `unknown` while it has not.
 */
export function useSlice<State>(id: string): State {
  const live = useHasHost()
  const held = useHost((state) => heldSlice(state, id))
  return (live ? (held ?? windowPart(id)?.unknown) : sampleOf(id)) as State
}
