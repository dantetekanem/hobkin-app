/**
 * The first-run setup as a line of steps: a hello, what hobkin does, connecting a model, the first settings, and
 * the hand-off to the app. Pure rules only. See _specs/025-onboarding.
 */

export const STEPS = ['welcome', 'about', 'connect', 'settings', 'ready'] as const
export type Step = (typeof STEPS)[number]

export interface Flow {
  step: Step
  /** 1 when the last move went on, -1 when it went back. The steps travel that way. */
  direction: 1 | -1
  /** How the setup ended, once it has: gone through to the end, or skipped. */
  ended: 'done' | 'skipped' | null
}

export type FlowEvent = 'next' | 'back' | 'skip'

export function startFlow(): Flow {
  return { step: 'welcome', direction: 1, ended: null }
}

/** One move. Going on from the last step ends the setup. There is nothing behind the first one, and nothing moves once it ended. */
export function stepFlow(flow: Flow, event: FlowEvent): Flow {
  if (flow.ended) return flow
  const at = STEPS.indexOf(flow.step)
  switch (event) {
    case 'next':
      return at === STEPS.length - 1 ? { ...flow, ended: 'done' } : { step: STEPS[at + 1]!, direction: 1, ended: null }
    case 'back':
      return at === 0 ? flow : { step: STEPS[at - 1]!, direction: -1, ended: null }
    case 'skip':
      return { ...flow, ended: 'skipped' }
  }
}
