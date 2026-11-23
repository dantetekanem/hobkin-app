import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { nodeRect } from '#shared/review/layout.ts'
import type { Review, ReviewNode } from '#shared/review/types.ts'
import { arrange, isLineCount } from '../src/features/review/graph/arrange.ts'
import { pullReview } from '../src/features/review/sample/pull.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { showPlace } from '../src/features/review/state/cursor.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const pull = pullReview('pr:hobkin-sample/storefront/482')
const titled = (review: Review, title: string) => review.nodes.find((node) => node.title === title)!
const overlaps = (a: ReviewNode, b: ReviewNode) => {
  const [one, two] = [nodeRect(a.kind, a.position), nodeRect(b.kind, b.position)]
  return one.x < two.x + two.width && two.x < one.x + one.width && one.y < two.y + two.height && two.y < one.y + one.height
}

test('tests fold into one card for each subject, with their helper, and never stand in a column', () => {
  const shape = arrange(pull)
  const groups = Object.values(shape.groups)
  const of = (title: string) => groups.find((group) => group.subject === titled(pull, title).id)!

  // Three cards: seven tests for the helper, the one the change removed among them by what it says it covers, six for
  // fetch_errors with the helper they use, seven for report.
  assert.deepEqual(groups.map((group) => [shape.nodes.find((node) => node.id === group.id)!.title, group.tests.length, group.helpers.length]), [
    ['7 tests for link_user_tags', 7, 0],
    ['6 tests for fetch_errors', 6, 1],
    ['7 tests for report', 7, 0],
  ])
  assert.ok(of('link_user_tags').tests.includes(titled(pull, 'looks each tag up by its handle').id))
  assert.deepEqual(of('fetch_errors').helpers, [titled(pull, 'stub_monitor').id])
  // What ran, what failed, what was not run, and what proves the change.
  assert.deepEqual(of('link_user_tags').counts, { ran: 6, failed: 0, notRun: 1, proves: 3 })
  assert.deepEqual(of('fetch_errors').counts, { ran: 6, failed: 1, notRun: 0, proves: 0 })
  assert.deepEqual(of('report').counts, { ran: 6, failed: 0, notRun: 1, proves: 0 })
  // A card is as loud as its worst test: a failed one shows.
  assert.equal(shape.nodes.find((node) => node.id === of('fetch_errors').id)!.status, 'failed')

  // No test is drawn alone. Each folded one, helper too, is kept aside under its card, for its code and its notes.
  const drawnTests = shape.nodes.filter((node) => node.kind === 'test')
  assert.deepEqual(drawnTests.map((node) => node.id).sort(), groups.map((group) => group.id).sort())
  for (const test of pull.nodes.filter((node) => node.kind === 'test')) {
    assert.ok(shape.groupOf[test.id], `${test.title} is folded`)
    assert.ok(shape.hidden.some((node) => node.id === test.id))
  }
  // Each card has one wire to what its tests cover, in place of one for each test.
  for (const group of groups) {
    assert.deepEqual(shape.edges.filter((edge) => edge.from === group.id || edge.to === group.id).map((edge) => [edge.kind, edge.to]), [['exercises', group.subject]])
  }
  // Every test says what it covers, by the wire that leaves it.
  assert.equal(shape.covers[titled(pull, 'links a handle with dots and dashes').id], titled(pull, 'link_user_tags').id)
})

test('the graph reads the way a request goes, with its tests in a lane under it', () => {
  const shape = arrange(pull)
  const at = (title: string) => shape.nodes.find((node) => node.title === title)!
  const x = (title: string) => at(title).position.x

  // Where a request enters, the unchanged code on its way, the change, then what the change calls.
  for (const way of [['GET /posts/:id', 'PostsController#show', 'render_body', 'link_user_tags', 'User.find_by_handles'], ['GET /feed', 'FeedsController#index', 'render_body']]) {
    for (let index = 1; index < way.length; index += 1) assert.ok(x(way[index - 1]!) < x(way[index]!), `${way[index - 1]} before ${way[index]}`)
  }
  // Its wires run as they are read: a caller's wire leaves it for what it calls.
  assert.ok(shape.edges.some((edge) => edge.from === at('render_body').id && edge.to === at('link_user_tags').id && edge.kind === 'calls'))
  assert.ok(shape.edges.some((edge) => edge.from === at('GET /posts/:id').id && edge.to === at('PostsController#show').id))

  // Tests are off the way: each card sits under it, just left of what it covers.
  const way = shape.nodes.filter((node) => node.kind !== 'test')
  const bottom = Math.max(...way.map((node) => node.position.y + nodeRect(node.kind, node.position).height))
  for (const group of Object.values(shape.groups)) {
    const card = shape.nodes.find((node) => node.id === group.id)!
    const subject = shape.nodes.find((node) => node.id === group.subject)!
    assert.ok(card.position.y > bottom, `${card.title} sits under the way`)
    assert.ok(card.position.x + 288 < subject.position.x, `${card.title} sits left of ${subject.title}`)
  }
  // A changed node nothing wires stays among the rest: there is no block apart.
  assert.ok(!('apart' in shape))
  // Nothing overlaps, and the same review always lays out the same way.
  for (const [index, one] of shape.nodes.entries()) for (const two of shape.nodes.slice(index + 1)) assert.equal(overlaps(one, two), false, `${one.title} and ${two.title}`)
  assert.deepEqual(arrange(pullReview('pr:hobkin-sample/storefront/482')).nodes, shape.nodes)
})

test("a step that focused tests focuses their card, and rides their card's wire", () => {
  const shape = arrange(sample)
  const doing = sample.story.find((step) => step.focus.length === 3 && step.focus.every((id) => sample.nodes.find((node) => node.id === id)?.kind === 'test'))!
  const group = shape.groupOf[doing.focus[0]!]!
  assert.ok(doing.focus.every((id) => shape.groupOf[id] === group), 'the three tests of doingAfter are one card')
  assert.deepEqual(shape.story.find((step) => step.id === doing.id)!.focus, [group])
  // Each acceptance line still proves its card: three wires, one from each line.
  assert.deepEqual(shape.edges.filter((edge) => edge.to === group && edge.kind === 'proves').map((edge) => edge.from), ['A1', 'A2', 'A3'])
  // A step that rode a folded test's wire rides the card's.
  for (const step of shape.story) if (step.travel) assert.ok(shape.edges.some((edge) => edge.id === step.travel), `${step.id} rides a wire that is drawn`)
  // No two of its steps land on the same card, so it keeps every step.
  assert.deepEqual(shape.story.map((step) => step.id), sample.story.map((step) => step.id))
})

test('single tests stay cards of their own until there are too many, then they fold by file', () => {
  const node = (id: string, kind: ReviewNode['kind'], subtitle: string): ReviewNode => ({ id, kind, title: id, subtitle, change: 'added', summary: '', anchors: [], position: { x: 0, y: 0 }, ...(kind === 'test' ? { status: 'passed' as const } : {}) })
  const code = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id, 'code', 'src/app.ts'))
  const tests = code.map((_, index) => node(`t${index}`, 'test', 'test/app.test.ts'))
  const edges = tests.map((test, index) => ({ id: `exercises:${test.id}>${code[index]!.id}`, from: test.id, to: code[index]!.id, kind: 'exercises' as const, certainty: 'host' as const }))
  const few = arrange({ nodes: [...code.slice(0, 4), ...tests.slice(0, 4)], edges: edges.slice(0, 4), story: [] })
  assert.deepEqual(Object.keys(few.groups), [], 'four tests of four subjects stay as they are')
  const many = arrange({ nodes: [...code, ...tests], edges, story: [] })
  const [byFile] = Object.values(many.groups)
  assert.deepEqual([byFile!.file, byFile!.tests.length, many.nodes.find((entry) => entry.id === byFile!.id)!.title], ['test/app.test.ts', 6, '6 tests in app.test.ts'])
  // The card wires to every subject its tests cover.
  assert.equal(many.edges.filter((edge) => edge.from === byFile!.id).length, 6)
})

test('a line count is never what a card says a node is', () => {
  for (const words of ['4 lines added and 1 line removed.', '2 lines added and 2 lines removed.', 'New in this change. 12 lines added.', 'Removed in this change. 1 line removed.', 'No lines changed.', '1,204 lines added.']) assert.equal(isLineCount(words), true, words)
  for (const words of ['Covers link_user_tags.', 'Renders @mira and expects a link.', 'Adds 4 lines added to the log.']) assert.equal(isLineCount(words), false, words)
})

test('a folded test is found, focused, shown and noted on its card', () => {
  const memory = createReviewMemory(memoryStorage())
  const session = createSession(pull, memory)
  const stop = session.connect()
  const test = titled(pull, 'tries once more when the monitor times out')
  const card = session.getState().view.groupOf[test.id]!

  // Pointing at a folded test focuses its card, and its own code is the one shown.
  session.getState().focusOn(test.id)
  assert.deepEqual(session.getState().focus, [card])
  assert.equal(session.getState().openCode(test.id), true)
  assert.deepEqual([session.getState().code, session.getState().focus], [test.id, [card]])
  assert.equal(session.getState().nodeOf.get(test.id)?.title, test.title, 'it is found by its id, though it is not drawn')

  // Its card lists its tests in place, and anything that moves the reviewer closes the list.
  session.getState().openTests(card)
  assert.equal(session.getState().opened, card)
  session.getState().openTests('not-a-card')
  assert.equal(session.getState().opened, null)
  session.getState().openTests(card)
  session.getState().step(1)
  assert.equal(session.getState().opened, null)

  // Its notes are read on its card, and a card can be moved like any node.
  session.getState().showNotes({ node: test.id })
  assert.deepEqual(session.getState().notesShown, { kind: 'node', node: card })
  memory.getState().moveNode(pull, card, { x: 10, y: 20 })
  assert.deepEqual(session.getState().view.nodes.find((node) => node.id === card)!.position, { x: 10, y: 20 })
  stop()
})

test('steps that land on the same card are one step, named for the card and listing its tests', () => {
  const node = (id: string, kind: ReviewNode['kind'], change: Partial<ReviewNode> = {}): ReviewNode => ({ id, kind, title: id, subtitle: kind === 'test' ? 'test/show_test.rb' : 'app/show.rb', change: 'added', summary: 'New in this change. 4 lines added.', anchors: [], position: { x: 0, y: 0 }, ...change })
  const code = ['show', 'index', 'edit'].map((id) => node(id, 'code'))
  const results = ['passed', 'passed', 'failed', 'proves-change', 'not-run'] as const
  const tests = results.map((status, index) => node(`t${index + 1}`, 'test', { title: `renders case ${index + 1}`, status }))
  const edges = tests.map((test) => ({ id: `exercises:${test.id}>show`, from: test.id, to: 'show', kind: 'exercises' as const, certainty: 'host' as const }))
  const walk = (id: string, focus: string[]) => ({ id, kind: 'walk' as const, title: focus.join(', '), text: 'New in this change. 4 lines added.', focus, criteria: [] })
  const story = [walk('s1', ['show']), walk('s2', ['index']), walk('s3', ['edit']), ...tests.map((test, index) => walk(`s${index + 4}`, [test.id]))]
  const review = { nodes: [...code, ...tests], edges, story }

  // Three code steps and five steps of tests on one subject fold to four steps.
  const shape = arrange(review)
  assert.deepEqual(shape.story.map((step) => step.id), ['s1', 's2', 's3', 's4'])
  const merged = shape.story[3]!
  assert.deepEqual(merged.focus, ['tests:show'])
  assert.deepEqual(merged.steps, ['s4', 's5', 's6', 's7', 's8'])
  assert.equal(merged.title, '5 tests for show')
  assert.equal(merged.text, 'Passed: renders case 1 and renders case 2. Failed: renders case 3. Proves the change: renders case 4. Not run: renders case 5.')
  assert.deepEqual(['s1', 's4', 's6', 's8'].map((id) => shape.stepOf[id]), [0, 3, 3, 3])

  // hobkin names steps as the review tells them: its step 6 is a test step, now the merged one.
  const session = createSession({ ...pull, ...review, story: [...story] } as Review, createReviewMemory(memoryStorage()))
  assert.equal(showPlace(session, { step: 6 }), true)
  assert.equal(session.getState().story.step, 3)
  // Told the other way round, tests first, hobkin's step 6 is the code step that now comes second.
  const testsFirst = [...tests.map((test, index) => walk(`s${index + 1}`, [test.id])), walk('s6', ['show']), walk('s7', ['index']), walk('s8', ['edit'])]
  const other = createSession({ ...pull, ...review, story: testsFirst } as Review, createReviewMemory(memoryStorage()))
  assert.equal(showPlace(other, { step: 6 }), true)
  assert.deepEqual([other.getState().story.step, other.getState().focus], [1, ['show']])
  assert.equal(showPlace(other, { step: 3 }), true)
  assert.deepEqual(other.getState().focus, ['tests:show'], 'a test step goes to the step that took it in')

  // A step that comes back to a card shown already joins the step that showed it. A step with more than the card does not.
  const back = arrange({ ...review, story: [walk('a', ['t1']), walk('b', ['show']), walk('c', ['t2']), walk('d', ['t3', 'index'])] })
  assert.deepEqual(back.story.map((step) => [step.id, step.steps]), [['a', ['a', 'c']], ['b', ['b']], ['d', ['d']]])
  // Steps the model wrote about the same code are kept apart: only cards of tests fold steps together.
  const twice = arrange({ ...review, story: [walk('x', ['show']), walk('y', ['show'])] })
  assert.equal(twice.story.length, 2)
})
