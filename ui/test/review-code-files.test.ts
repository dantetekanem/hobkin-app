import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Note } from '#shared/review/notes.ts'
import type { Review, ReviewFile, ReviewNode } from '#shared/review/types.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession, reviewNodesOf } from '../src/features/review/state/session.ts'
import { fileRows, shortenPath, storyOrder, totalsOf } from '../src/features/review/diff/files.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review

/** The files in the order the code view lists them, as the open review's story tells them. */
function ordered(review: Review): ReviewFile[] {
  const { view } = createSession(review, createReviewMemory(memoryStorage())).getState()
  const partOf = (id: string) => review.nodes.find((node) => node.id === id)
  return storyOrder(review.files, view.story, (id) => reviewNodesOf(view, id), partOf)
}

test('the changed files are listed in the order the story tells them, and the rest after them by path', () => {
  assert.deepEqual(ordered(sample).map((file) => file.path), [
    'test/cli-doing.test.mjs',
    'src/cli/doing.mjs',
    'src/cli/runtime.mjs',
    'test/cli-event-recording.test.mjs',
    'src/cli/application.mjs',
    'src/cli/ui.mjs',
    'test/cli-ui.test.mjs',
    'docs/guide.md',
    'CHANGELOG.md',
  ])

  // Files no step shows come after, by path. A file shown only for unchanged code in it is never listed.
  const untold = { ...sample, story: sample.story.map((step) => (step.id === 's13' ? { ...step, focus: [] } : step)) }
  assert.deepEqual(ordered(untold).map((file) => file.path).slice(-2), ['CHANGELOG.md', 'docs/guide.md'])
  assert.ok(!ordered(sample).some((file) => file.status === 'unchanged'))

  // A part with no lines, as a binary file's, puts the file it names where its step is.
  const logo: ReviewFile = { id: 'logo', path: 'assets/logo.png', status: 'added', binary: true, additions: 0, deletions: 0, summarized: false }
  const part = { id: 'f1', kind: 'file', title: 'logo.png', subtitle: 'assets/logo.png', change: 'added', summary: '', anchors: [], position: { x: 0, y: 0 } } satisfies ReviewNode
  const order = storyOrder([...sample.files, logo], [{ focus: ['u4'] }, { focus: ['f1'] }], (id) => [id], (id) => (id === 'f1' ? part : sample.nodes.find((node) => node.id === id)))
  assert.deepEqual(order.map((file) => file.path).slice(0, 2), ['src/cli/doing.mjs', 'assets/logo.png'])
})

test('a file row says its status, its size, its notes, whether a part of it needs the reviewer, and whether it is seen', () => {
  const note = (id: string, target: Note['target'], intent: Note['intent']): Note => ({ id, step: 's6', target, intent, text: 'Why?', author: 'user', at: 1 })
  const notes = [
    note('n1', { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 150, endLine: 151, hash: 'h' }, 'comment'),
    note('n2', { kind: 'node', node: 'u5' }, 'question'),
    note('n3', { kind: 'node', node: 'u2' }, 'comment'),
    note('n4', { kind: 'step' }, 'comment'),
  ]
  const nodes = sample.nodes.map((node) =>
    node.id === 'u8' ? { ...node, attention: { tier: 'needs-you' as const, rank: 1, reasons: [] } } : node.id === 'u17' ? { ...node, level: 'high' as const } : node,
  )
  const rows = fileRows(ordered(sample), { nodes, notes, seen: new Set(['u5', 'u6', 'u2']) })
  const row = (path: string) => rows.find((each) => each.file.path === path)!

  assert.deepEqual([row('src/cli/doing.mjs').letter, row('src/cli/ui.mjs').letter], ['A', 'M'])
  assert.deepEqual([row('src/cli/ui.mjs').additions, row('src/cli/ui.mjs').deletions], [10, 2])
  assert.deepEqual([row('src/cli/runtime.mjs').comments, row('src/cli/runtime.mjs').questions], [1, 1])
  assert.deepEqual([row('src/cli/doing.mjs').comments, row('src/cli/doing.mjs').questions], [1, 0])
  assert.deepEqual(rows.filter((each) => each.needsYou).map((each) => each.file.path), ['src/cli/ui.mjs', 'test/cli-ui.test.mjs'])
  // Seen once every changed part in it is: runtime.mjs has u5 and u6, doing.mjs has u4 and u3 still to see.
  assert.deepEqual(rows.filter((each) => each.seen).map((each) => each.file.path), ['src/cli/runtime.mjs'])
  assert.deepEqual(totalsOf(rows), { files: 9, additions: 111, deletions: 2 })

  // Deleted and renamed files have their own letters.
  const other = (status: ReviewFile['status']): ReviewFile => ({ id: status, path: `${status}.txt`, status, binary: false, additions: 0, deletions: 0, summarized: false })
  assert.deepEqual(fileRows([other('deleted'), other('renamed')], { nodes: [], notes: [], seen: new Set() }).map((each) => each.letter), ['D', 'R'])
})

test('a long path is shortened from the left, keeping as many of its last folders as fit', () => {
  assert.equal(shortenPath('src/cli/doing.mjs', 40), 'src/cli/doing.mjs')
  assert.equal(shortenPath('ui/src/features/review/code/DiffView.tsx', 24), '…/code/DiffView.tsx')
  assert.equal(shortenPath('ui/src/features/review/code/DiffView.tsx', 14), '…/DiffView.tsx')
  // A name too long by itself keeps both its ends, so files with the same start stay apart.
  assert.equal(shortenPath('ui/src/features/review/code/DiffView.tsx', 10), 'DiffV….tsx')
  assert.equal(shortenPath('CHANGELOG.md', 8), 'CHAN….md')
})
