import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createElement } from 'react'
import { useView } from '../src/app/view-store.ts'
import { useShownReview } from '../src/features/review/shown-review.ts'
import { mountCounting } from './render-count.ts'

const PULL = 'pr:owner/repo/7'
const CHANGE = 'change:project:item'

/** The review screen as it reads which review to show, mounted as the frame mounts it once a review opens. */
async function reviewScreen() {
  const seen: (string | null)[] = []
  const Screen = () => {
    seen.push(useShownReview())
    return null
  }
  const mounted = await mountCounting(() => createElement(Screen))
  return { mounted, shown: () => seen.at(-1) }
}

beforeEach(() => {
  useView.setState({ screen: 'work', openReview: null, trail: [] })
})

test('a closed review stays on its screen as the screen slides away, instead of the sample', async () => {
  useView.getState().openReviewFor(PULL)
  const { mounted, shown } = await reviewScreen()
  assert.equal(shown(), PULL)

  await mounted.change(() => useView.getState().closeReview())

  assert.equal(useView.getState().openReview, null, 'closing clears the open review at once')
  assert.equal(shown(), PULL, 'the screen on its way out still shows the review it showed')
  await mounted.unmount()
})

test('a review opened over the one on screen takes its place', async () => {
  useView.getState().openReviewFor(PULL)
  const { mounted, shown } = await reviewScreen()

  await mounted.change(() => useView.getState().openReviewFor(CHANGE))

  assert.equal(shown(), CHANGE)
  await mounted.unmount()
})
