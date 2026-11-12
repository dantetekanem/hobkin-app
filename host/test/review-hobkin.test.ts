import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { targetOfReviewId } from '#shared/review/ids.ts'
import { foldNotes, type Note } from '#shared/review/notes.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { reviewBrief, reviewCode, reviewMap } from '../src/review/guide.ts'
import { Reviews } from '../src/review/reviews.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]
const ID = 'change:hobkin:7d02c9'
const code = sample.nodes.find((node) => node.kind === 'code')!
const walk = sample.story.find((step) => step.kind === 'walk')!

function seated(t: TestContext) {
  const store = reviewStore(temporaryDirectory(t))
  store.write(targetOfReviewId(ID)!, sample, files)
  let now = 5000
  const changes: number[] = []
  const all = new Reviews({
    store,
    sources: { change: { head: async () => null, read: async () => { throw new Error('unused') } }, pull: { head: async () => null, read: async () => { throw new Error('unused') } } },
    work: () => ({ workAction: async () => null }),
    card: () => null,
    head: () => sample.change.head,
    onChange: () => changes.push(now),
    now: () => (now += 1),
  })
  return { reviews: all, store, changes }
}

test("hobkin reads a review as a map: every node with what goes in and out, every wire, the paths and the steps, and the open notes", (t) => {
  const { reviews } = seated(t)
  const map = reviewMap(reviews, ID)
  assert.equal(map.id, ID)
  assert.equal(map.title, sample.change.title)
  assert.equal(map.outdated, false)
  assert.equal(map.nodes.length, sample.nodes.length)
  assert.deepEqual(Object.keys(map.nodes.find((node) => node.id === code.id)!).sort(), ['id', 'kind', 'path', 'summary', 'title'].concat(code.io ? ['io'] : []).sort())
  assert.equal(map.wires.length, sample.edges.length)
  assert.deepEqual(map.steps[0], { step: 1, title: sample.story[0]!.title, focus: [] })
  assert.equal(map.steps.length, sample.story.length)
  assert.equal(JSON.stringify(map).includes('hash'), false, 'no hashes or positions, only what explains the change')
})

test("hobkin reads a node's own lines, numbered, without asking for whole files", (t) => {
  const { reviews } = seated(t)
  const read = reviewCode(reviews, ID, code.id)
  const anchor = code.anchors[0]!
  assert.equal(read.node, code.id)
  assert.equal(read.path, code.subtitle)
  assert.equal(read.parts[0]!.startLine, anchor.startLine)
  assert.match(read.parts[0]!.text, new RegExp(`^${anchor.startLine} `))
  assert.throws(() => reviewCode(reviews, ID, 'nowhere'), /no node nowhere/)
})

test("hobkin moves the user's view to a step or a node, and the window sees where", (t) => {
  const { reviews, changes } = seated(t)
  reviews.show(ID, { step: 3 })
  assert.deepEqual(reviews.status(ID).cursor, { step: 3, at: 5001 })
  reviews.show(ID, { node: code.id })
  assert.deepEqual(reviews.status(ID).cursor, { node: code.id, at: 5002 })
  assert.equal(changes.length, 2)
  assert.throws(() => reviews.show(ID, { step: 99 }), /has 15 steps/)
  assert.throws(() => reviews.show(ID, { node: 'nowhere' }), /no node nowhere/)
})

test('hobkin leaves notes signed as hobkin, and a save from the window keeps them unless the user removed them', (t) => {
  const { reviews, store } = seated(t)
  const target = targetOfReviewId(ID)!
  const user: Note = { id: 'n1', step: walk.id, target: { kind: 'step' }, intent: 'comment', text: 'Mine.', author: 'user', at: 1 }
  reviews.saveNotes(ID, { entries: [{ op: 'put', note: user }], draft: null })

  const left = reviews.note(ID, { node: code.id, intent: 'comment', text: 'Clear the word when the turn ends.' })
  const notes = () => foldNotes(store.notes(target).entries as never)
  const hobkins = notes().find((entry) => entry.id === left.id)!
  assert.deepEqual([hobkins.author, hobkins.intent, hobkins.target, hobkins.text], ['hobkin', 'comment', { kind: 'node', node: code.id }, 'Clear the word when the turn ends.'])
  assert.ok(sample.story.some((step) => step.id === hobkins.step), 'taken on a step of the story')
  assert.equal(reviews.status(ID).notesAt, hobkins.at)

  // The window saves the notes it knows, which do not include hobkin's yet. hobkin's stays.
  reviews.saveNotes(ID, { entries: [{ op: 'put', note: { ...user, text: 'Mine, changed.' } }], draft: null })
  assert.deepEqual(notes().map((entry) => [entry.id, entry.text]), [['n1', 'Mine, changed.'], [left.id, 'Clear the word when the turn ends.']])
  // Removed in the window, it goes.
  reviews.saveNotes(ID, { entries: [{ op: 'put', note: user }, { op: 'remove', id: left.id }], draft: null })
  assert.deepEqual(notes().map((entry) => entry.id), ['n1'])

  assert.throws(() => reviews.note(ID, { wire: 'nowhere', intent: 'comment', text: 'x' }), /no wire nowhere/)
})

test("a message sent during a review tells hobkin where the user is and how to work in the review", (t) => {
  const { reviews } = seated(t)
  const brief = reviewBrief(reviews, { id: ID, step: walk.id, node: code.id })
  assert.equal(brief.id, `review:${ID}`)
  assert.match(brief.title, new RegExp(`Review.*step ${sample.story.indexOf(walk) + 1} of ${sample.story.length}`))
  assert.match(brief.body, new RegExp(sample.change.title))
  assert.match(brief.body, new RegExp(`${code.id} ${code.title}`))
  assert.match(brief.body, /review\.map/)
  assert.match(brief.body, /review\.note/)
})

