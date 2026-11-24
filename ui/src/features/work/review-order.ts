import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { Grade, WorkState } from '#shared/protocol/work.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import { REVIEW_ORDERS, type PriorityOf, type ReviewOrder } from './ai-reviews.ts'

/**
 * The order the user picked for the Review list (spec 032, 067), and where a review's priority comes from. The order is
 * kept in the app's own storage on this machine, so it is still there after a reload and the next time the app opens.
 */

const KEY = 'hobkin-client-review-order-2'
const FIRST_ORDER: ReviewOrder = 'easiest'

/** The order a kept value names. Anything that is no order reads as the one the list starts in. */
export function readReviewOrder(kept: string | null): ReviewOrder {
  const known = REVIEW_ORDERS.find((order) => order.value === kept)
  return known ? known.value : FIRST_ORDER
}

/**
 * Where each review's priority is read, from the work as the host tells it: a finished change's own grade, else the
 * priority of its project. A pull request, and a change of a project work mode does not know, has none.
 */
export function prioritiesOfWork(work: Pick<WorkState, 'projects' | 'finished'> | null): PriorityOf {
  const ofChange = new Map<string, Grade>()
  const ofProject = new Map<string, Grade>()
  for (const project of work?.projects ?? []) ofProject.set(project.slug, project.priority)
  for (const group of work?.finished ?? []) {
    for (const change of group.changes) {
      if (change.grade) ofChange.set(change.key, change.grade)
    }
  }

  return (item) => {
    const target = targetOfReviewId(item.id)
    if (target?.kind !== 'change') return null

    return ofChange.get(`${target.slug}:${target.item}`) ?? ofProject.get(target.slug) ?? null
  }
}

function storage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

function keptOrder(): ReviewOrder {
  try {
    return readReviewOrder(storage()?.getItem(KEY) ?? null)
  } catch {
    return FIRST_ORDER
  }
}

function keepOrder(order: ReviewOrder): void {
  try {
    storage()?.setItem(KEY, order)
  } catch {
    // Storage can be unavailable. The order still holds while the window is open.
  }
}

export interface ReviewOrderState {
  order: ReviewOrder
  choose: (order: ReviewOrder) => void
}

/** The store lives on globalThis, as the Work tab's does, so a hot update of this file keeps the order on screen. */
const holder = globalThis as { __hobkinReviewOrder?: UseBoundStore<StoreApi<ReviewOrderState>> }
export const useReviewOrder = (holder.__hobkinReviewOrder ??= create<ReviewOrderState>()(() => ({ order: keptOrder() }) as ReviewOrderState))

// The action is this copy of the file's, given to the kept store each time it loads, so a hot update brings its own.
useReviewOrder.setState({
  choose: (order) => {
    keepOrder(order)
    useReviewOrder.setState({ order })
  },
})
