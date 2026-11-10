import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { hashLines } from '#shared/review/lines.ts'
import { detached, foldNotes, type Note } from '#shared/review/notes.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { Reviews } from '../src/review/reviews.ts'
import { changeSource, pullSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]
const step = sample.story.find((entry) => entry.title === 'The runtime keeps the word for one turn')!
const note = (id: string, rest: Partial<Note> = {}): Note => ({ id, step: step.id, target: { kind: 'step' }, intent: 'comment', text: `note ${id}`, author: 'user', at: Number(id.slice(1)), ...rest })

function reviewsIn(home: string, actions: unknown[][] = []) {
  return new Reviews({
    store: reviewStore(home),
    sources: { change: changeSource({ find: () => null, repoOf: () => null, baseOf: async () => 'main' }), pull: pullSource({ gh: async () => ({ kind: 'missing' }) }) },
    agent: async () => null,
    work: () => ({
      workAction: async (...args: unknown[]) => {
        actions.push(args)
        return { message: 'hobkin sent the change back with your notes.' }
      },
    }),
    card: () => ({ landing: 'merge', yes: 'Merge it.' }),
    now: () => 2000,
  })
}

const ID = 'change:hobkin:7d02c9'

test('appends notes and folds them by id', (t) => {
  const home = temporaryDirectory(t)
  reviewStore(home).write({ kind: 'change', slug: 'hobkin', item: '7d02c9' }, sample, files)
  const reviews = reviewsIn(home)

  // A draft in the window is a log of puts and removes. The home keeps it folded, so each note is there once.
  reviews.saveNotes(ID, {
    entries: [
      { op: 'put', note: note('n1') },
      { op: 'put', note: note('n2') },
      { op: 'put', note: { ...note('n1'), text: 'note n1, changed' } },
      { op: 'remove', id: 'n2' },
    ],
    draft: { intent: 'question', text: 'half a thought' },
  })

  // After a restart: a new host over the same home.
  const opened = reviewsIn(home).get(ID)
  assert.deepEqual(foldNotes(opened.notes.entries).map((entry) => [entry.id, entry.text]), [['n1', 'note n1, changed']])
  assert.deepEqual(opened.notes.draft, { intent: 'question', text: 'half a thought' })
})

test('records the author', (t) => {
  const home = temporaryDirectory(t)
  reviewStore(home).write({ kind: 'change', slug: 'hobkin', item: '7d02c9' }, sample, files)
  reviewsIn(home).saveNotes(ID, { entries: [{ op: 'put', note: note('n1', { author: 'hobkin', text: 'hobkin left this.' }) }], draft: null })

  assert.deepEqual(
    foldNotes(reviewsIn(home).get(ID).notes.entries).map((entry) => [entry.author, entry.text]),
    [['hobkin', 'hobkin left this.']],
  )
})

test('ask for changes sends selected notes with their targets', async (t) => {
  const home = temporaryDirectory(t)
  reviewStore(home).write({ kind: 'change', slug: 'hobkin', item: '7d02c9' }, sample, files)
  const actions: unknown[][] = []
  const reviews = reviewsIn(home, actions)
  reviews.saveNotes(ID, { entries: [note('n1', { text: 'Clear it where it is set.' }), note('n2', { intent: 'question', text: 'Only for hobkin.' })].map((entry) => ({ op: 'put', note: entry })), draft: null })

  const preview = reviews.preview(ID, 'request-changes', 'One thing.')
  assert.equal(preview.note, ['One thing.', '', `1. Step ${sample.story.indexOf(step) + 1} of ${sample.story.length}, "${step.title}".`, '   Clear it where it is set.'].join('\n'))
  await reviews.verdict(ID, 'request-changes', 'One thing.', preview.confirm)

  assert.deepEqual(actions, [['ask', 'hobkin', '7d02c9', preview.note]])
})

test('keeps a detached note', (t) => {
  const home = temporaryDirectory(t)
  const store = reviewStore(home)
  store.write({ kind: 'change', slug: 'hobkin', item: '7d02c9' }, sample, files)
  const runtime = files.find((file) => file.fileId === 'src/cli/runtime.mjs')!
  const kept = note('n1', { target: { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 10, endLine: 10, hash: hashLines(runtime.head!, 10, 10) } })
  const moved = note('n2', { target: { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 10, endLine: 10, hash: 'written on other bytes' } })
  reviewsIn(home).saveNotes(ID, { entries: [kept, moved].map((entry) => ({ op: 'put', note: entry })), draft: null })

  const opened = reviewsIn(home).get(ID)
  const notes = foldNotes(opened.notes.entries)
  assert.deepEqual(notes.map((entry) => entry.id), ['n1', 'n2'], 'both are kept')
  assert.deepEqual(detached(notes, (fileId, side) => (side === 'added' ? files.find((file) => file.fileId === fileId)?.head : null) ?? null), ['n2'], 'and the one whose lines changed is detached')
})
