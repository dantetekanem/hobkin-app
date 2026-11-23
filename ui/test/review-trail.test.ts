import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Review, ReviewLifecycle, ReviewNode } from '#shared/review/types.ts'
import { originWords, trailOf } from '../src/features/review/graph/trail.ts'
import { pullReview } from '../src/features/review/sample/pull.ts'

const pull = pullReview('pr:hobkin-sample/storefront/482')
const idOf = (title: string) => pull.nodes.find((node) => node.title === title)!.id
const titles = (review: Review, ids: readonly string[]) => ids.map((id) => review.nodes.find((node) => node.id === id)!.title)
/** The review with one node's life cycle changed. */
const withLifecycle = (review: Review, id: string, change: (lifecycle: ReviewLifecycle) => ReviewLifecycle | undefined): Review => ({
  ...review,
  nodes: review.nodes.map((node) => {
    if (node.id !== id) return node
    const { lifecycle, ...rest } = node
    const next = change(lifecycle ?? { role: 'changed', hops: 0 })
    return (next ? { ...rest, lifecycle: next } : rest) as ReviewNode
  }),
})
/** As an older host wrote it: no origin and no reason for none. */
const older = (lifecycle: ReviewLifecycle): ReviewLifecycle => {
  const { origin: _origin, none: _none, ...rest } = lifecycle
  return rest
}

test('found by itself, the way in to link_user_tags runs from GET /posts/:id, the nearest, and counts the other two', () => {
  const review = withLifecycle(pull, idOf('link_user_tags'), older)
  const trail = trailOf(review, idOf('link_user_tags'))!
  // The origin first, then each call on the way, to the node's own caller. The controller its route reaches is passed on the way.
  assert.deepEqual(titles(review, trail.chain), ['GET /posts/:id', 'PostsController#show', 'render_body'])
  assert.deepEqual(trail.origin, { kind: 'route', label: 'GET /posts/:id', exact: true })
  assert.equal(trail.more, 2, 'GET /feed and the app that answers a failing request')
  assert.equal(trail.why, null)

  // The three are as near: the one the review lists first is the way in.
  const feedFirst = { ...review, nodes: [...review.nodes.filter((node) => node.title === 'GET /feed'), ...review.nodes.filter((node) => node.title !== 'GET /feed')] }
  assert.deepEqual(titles(feedFirst, trailOf(feedFirst, idOf('link_user_tags'))!.chain), ['GET /feed', 'FeedsController#index', 'render_body'])
  // A nearer way in wins whatever the order.
  const nearer = { ...review, edges: [...review.edges, { id: 'called-by:c1>c8', from: idOf('render_body'), to: idOf('config.exceptions_app'), kind: 'called-by' as const, certainty: 'host' as const }] }
  assert.deepEqual(titles(nearer, trailOf(nearer, idOf('link_user_tags'))!.chain), ['config.exceptions_app', 'render_body'])
})

test("the host's chain wins: its origin, its words and its count", () => {
  assert.deepEqual(trailOf(pull, idOf('link_user_tags')), { chain: ['c5', 'c2', 'c1'], origin: { kind: 'route', label: 'GET /posts/:id', exact: true }, more: 2, why: null })
  // The host walked another way than the wires show here: its way is the one told.
  const failing = withLifecycle(pull, idOf('link_user_tags'), (lifecycle) => ({ ...older(lifecycle), origin: { kind: 'exceptions-app', label: 'A failing request', exact: true, chain: ['c8', 'c7', 'c1'] } }))
  assert.deepEqual(trailOf(failing, idOf('link_user_tags')), { chain: ['c8', 'c7', 'c1'], origin: { kind: 'exceptions-app', label: 'A failing request', exact: true }, more: 0, why: null })
})

test('with no way in it says why: in the review\'s words, in an older review\'s, or in what the graph shows', () => {
  // The host's reason.
  assert.deepEqual(trailOf(pull, idOf('fetch_errors')), { chain: [], origin: null, more: 0, why: 'The scan found no caller.' })
  const words = (['no-callers', 'only-tests', 'limit', 'time', 'not-looked'] as const).map((none) => trailOf(withLifecycle(pull, idOf('fetch_errors'), (lifecycle) => ({ ...older(lifecycle), none })), idOf('fetch_errors'))!.why!)
  assert.deepEqual(words, ['The scan found no caller.', 'Only tests call it.', 'The scan stopped before it reached a way in.', 'The scan ran out of time before it reached a way in.', 'Its way in was not looked for.'])
  // An older review says it in a line.
  assert.equal(trailOf(withLifecycle(pull, idOf('fetch_errors'), older), idOf('fetch_errors'))!.why, 'No route reaches it within 4 calls: a script someone runs by hand')
  // A node the host says nothing of: why nothing wires it, else what the graph shows.
  assert.equal(trailOf(pull, idOf('README.md'))!.why, 'Documentation: no code reads it.')
  assert.equal(trailOf(pull, idOf('report'))!.why, 'The review shows no caller of it.')
  const unsaid = withLifecycle(pull, idOf('link_user_tags'), () => undefined)
  const noEntries = { ...unsaid, nodes: unsaid.nodes.map(({ entry: _entry, ...node }) => node) }
  assert.deepEqual(trailOf(noEntries, idOf('link_user_tags')), { chain: [], origin: null, more: 0, why: 'None of its callers in the review leads to a way in.' })
  // Code that is itself where a request enters is its own way in.
  const job: Review = { ...pull, nodes: pull.nodes.map((node) => (node.title === 'fetch_errors' ? { ...node, entry: { kind: 'job', exact: true } } : node)) }
  assert.deepEqual(trailOf(withLifecycle(job, idOf('fetch_errors'), older), idOf('fetch_errors')), { chain: [], origin: { kind: 'job', label: 'fetch_errors', exact: true }, more: 0, why: null })
  // Only changed code has a way in.
  for (const title of ['render_body', 'GET /posts/:id', 'links a handle with dots and dashes']) assert.equal(trailOf(pull, idOf(title)), null, title)
})

test('a way in says what kind it is in plain words', () => {
  assert.deepEqual(['route', 'controller', 'exceptions-app', 'job', 'command', 'task', 'listener', 'load'].map(originWords), ['Request', 'Request', 'Failed request', 'Job', 'Command', 'Task', 'Listener', 'On load'])
  assert.equal(originWords('schedule'), 'Schedule', 'a kind the window does not know reads as its name')
})
