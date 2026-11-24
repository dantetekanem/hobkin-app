/**
 * The verdict's foot, at the bottom of the review panel for every review (the user, 2026-11-24: "verdict should be fixed
 * in the bottom with my options"). Four places that never move from one review to the next: Approve, Approve and merge,
 * the third (Send fixes on a finished change, Comment on a pull request) and Remove. A choice that review cannot be given
 * keeps its place, off, with the reason. Remove is the review and the code: its first press does not act, it shows what
 * will go and offers two ways out (`removeChoices`). Pure, but for the one-confirm removal store.
 */
import { createStore } from 'zustand/vanilla'
import type { PullOwner } from '#shared/review/status.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { CONFIRM_MS, VERDICT_CHOICES, verdictChoices, verdictKind } from '../verdict.ts'

/** A place in the foot that gives one of the host's verdicts. `offered` is false where this review cannot be given it. */
export interface FootSlot {
  verdict: Verdict
  label: string
  keys?: string
  offered: boolean
}

/** What the foot offers one review: three verdict places, the reason one of them is off, and how Remove goes. */
export interface Foot {
  slots: FootSlot[]
  /** Why a place is off, for the review that is someone else's pull request. */
  why: string | null
  remove: RemoveWays
}

/**
 * How Remove goes. `both`: the review's own no, which closes the pull request or says no to the change and deletes the
 * branch, or only the review taken out of the list. `review`: only the review, for another author's pull request, which
 * has no branch of the user's to delete and is closed by its author.
 */
export type RemoveWays = 'both' | 'review'

export function footOf(id: string, owner?: PullOwner | null): Foot {
  const kind = verdictKind(id)
  const { choices, why } = verdictChoices(id, owner)
  const offered = new Set(choices.map((choice) => choice.verdict))
  const slots = VERDICT_CHOICES[kind].slice(0, 3).map(({ verdict, label, keys }) => ({ verdict, label, ...(keys ? { keys } : {}), offered: offered.has(verdict) }))
  const own = kind === 'change' || owner?.mine === true
  return { slots, why, remove: own ? 'both' : 'review' }
}

/** What Remove sends. `delete`: the host's `discard-branch` verdict, shown first and confirmed. `review`: `review.remove`. */
export type RemoveChoice =
  | { id: 'delete'; label: string; sends: { command: 'review.verdict'; verdict: 'discard-branch' } }
  | { id: 'review'; label: string; sends: { command: 'review.remove' } }

export const REMOVE_REVIEW_ONLY = 'Only remove the review'
export const REMOVE_THE_REVIEW = 'Remove the review'
/** What Remove says for a pull request that is someone else's, where only the review goes. */
export const REMOVE_REVIEW_LINES = ['Take this review off your list, with the notes you wrote on it.', 'The pull request is not touched: its author closes it.'] as const
/** What the second choice keeps, said under the first's own lines. */
export const KEEPS = `${REMOVE_REVIEW_ONLY} keeps the branch and the pull request as they are.`

/** The choices Remove shows after its first press, the default first: the first one has the keyboard. */
export function removeChoices(ways: RemoveWays): RemoveChoice[] {
  if (ways === 'review') return [{ id: 'review', label: REMOVE_THE_REVIEW, sends: { command: 'review.remove' } }]
  return [
    { id: 'delete', label: 'Remove it and delete the branch', sends: { command: 'review.verdict', verdict: 'discard-branch' } },
    { id: 'review', label: REMOVE_REVIEW_ONLY, sends: { command: 'review.remove' } },
  ]
}

type RemoveCommand = (name: 'review.remove', args: { id: string }) => Promise<unknown>

/**
 * `review.remove`, asked once in place. `ask` shows what goes and waits ten seconds for `run`, which does it and tells
 * `removed`. `run` without `ask` is for the choice that is itself the second press. Escape or the ten seconds go back.
 */
export function createReviewRemoval({ id, command, removed, confirmMs = CONFIRM_MS }: { id: string; command: RemoveCommand; removed: () => void | Promise<void>; confirmMs?: number }) {
  const store = createStore<{ asked: boolean; busy: boolean; error: string | null }>(() => ({ asked: false, busy: false, error: null }))
  let waiting: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(waiting)
    if (store.getState().asked) store.setState({ asked: false })
  }
  const ask = () => {
    if (store.getState().busy) return
    clearTimeout(waiting)
    store.setState({ asked: true, error: null })
    waiting = setTimeout(cancel, confirmMs)
  }
  const run = async () => {
    if (store.getState().busy) return
    clearTimeout(waiting)
    store.setState({ asked: false, busy: true, error: null })
    try {
      await command('review.remove', { id })
      await removed()
    } catch (error) {
      store.setState({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      store.setState({ busy: false })
    }
  }
  return Object.assign(store, { ask, run, cancel })
}
