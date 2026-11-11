import { hasHost, IN_MAC_WINDOW } from '../../lib/host/frame.ts'
import { canUseModel, type HostState } from '../../lib/host/state.ts'

/** Stop uses the connected owner's authority, not a model's availability. */
export function canStopConversation(state: Pick<HostState, 'link' | 'home' | 'owner' | 'snapshot'>): boolean {
  return state.home !== null && state.link === 'open' && state.owner?.state === 'live' && state.snapshot.busy === true
}

/** Model setup must not replace the screens that hold existing agent controls. */
export function needsSignInCanvas(state: Pick<HostState, 'link' | 'signIn' | 'models'>, screen: string): boolean {
  if (['agent', 'mind', 'work', 'world'].includes(screen) || state.link !== 'open') return false
  if (state.signIn.status === 'signing-in') return true
  const known = state.models !== null || state.signIn.status !== 'unknown'
  return known && !canUseModel(state)
}

/** Whether a message can be sent now, and the reason shown in the input when it cannot. */
export type Availability = { ready: true } | { ready: false; reason: string }

export function availabilityOf(state: Pick<HostState, 'link' | 'home' | 'owner' | 'signIn' | 'models'>, macWindow = IN_MAC_WINDOW): Availability {
  if (!hasHost(state, macWindow)) {
    return { ready: false, reason: state.link === 'connecting' ? 'Looking for hobkin.' : 'This is sample data. Start the host to talk to hobkin.' }
  }
  if (state.home === null) return { ready: false, reason: 'Connecting to hobkin…' }
  if (state.link !== 'open') return { ready: false, reason: 'Reconnecting to hobkin. You can send again once it is back.' }

  const { owner } = state
  // A sign-in under way for a second provider takes nothing away: the first one still answers.
  const known = state.models !== null || state.signIn.status !== 'unknown'
  if (known && !canUseModel(state)) return { ready: false, reason: 'Connect a model to talk to hobkin.' }
  if (owner?.state === 'failed') return { ready: false, reason: `hobkin could not start: ${owner.message}` }
  if (owner?.state !== 'live') return { ready: false, reason: 'hobkin is starting.' }
  return { ready: true }
}
