/**
 * "Code stale · Refresh": a press asks the host to start an agent that brings the change's branch up to date with the
 * branch it merges into. This is the button's state; what a press does is the stack button's store with its own words.
 */
import type { ReviewStatus } from '#shared/review/status.ts'
import { createStackStart } from './stack-start.ts'

export const SAMPLE_REFRESH_CODE = 'A sample review starts nothing.'

export interface RefreshCodeInput {
  /** The change merged: it has no button. */
  merged: boolean
  /** The host is starting the agent now. */
  busy: boolean
  /** What the host knows about the branch; missing or null parts are unknown. */
  code: ReviewStatus['code']
}

export interface RefreshCodeState {
  shown: boolean
  busy: boolean
  tooltip: string
}

export function refreshCodeButton({ merged, busy, code }: RefreshCodeInput): RefreshCodeState {
  const behind = code?.behind ?? 0
  const conflict = code?.conflict === true
  if (merged || (behind < 1 && !conflict)) return { shown: false, busy: false, tooltip: '' }
  const base = code?.base ?? 'the branch it merges into'
  const name = code?.base ?? 'it'
  const count = `${behind} ${behind === 1 ? 'commit' : 'commits'} behind ${base}`
  const tooltip =
    behind > 0 && conflict
      ? `${count}, and it conflicts with it. An agent merges ${name} into it, settles the conflict and runs the tests.`
      : behind > 0
        ? `${count}. An agent merges ${name} into it, settles any conflict and runs the tests.`
        : `It conflicts with ${base}. An agent settles the conflict and runs the tests.`
  return { shown: true, busy, tooltip }
}

export const createRefreshCode = (flow: Omit<Parameters<typeof createStackStart>[0], 'sample'>) => createStackStart({ ...flow, sample: SAMPLE_REFRESH_CODE })
