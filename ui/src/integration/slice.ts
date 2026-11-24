import type { HostState } from '../lib/host/state.ts'
import { windowPart } from './registry.ts'

/** Each part's sample, made once per window so its times count back from when the window opened. */
const slot = globalThis as { __hobkinSamples?: Map<string, unknown> }

export function sampleOf(id: string): unknown {
  const samples = (slot.__hobkinSamples ??= new Map())
  if (!samples.has(id)) samples.set(id, windowPart(id)?.sample(Date.now()))
  return samples.get(id)
}

type Held = Pick<HostState, 'slices'>

/** What the host last said of an integration. */
export const heldSlice = (state: Held, id: string): unknown => state.slices[id]

/** The slice an integration shows, without a hook: the part's sample with no host, else the host's slice, else its unknown. */
export function sliceOf<State>(id: string, state: Held, hasHost: boolean): State {
  if (!hasHost) return sampleOf(id) as State
  return (heldSlice(state, id) ?? windowPart(id)?.unknown) as State
}
