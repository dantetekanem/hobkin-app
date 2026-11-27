import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, FinishedGroup, StackPlace } from '#shared/protocol/work.ts'
import {
  linesOf,
  actionOf,
  entriesOf,
  gradeBlockOf,
  lowestOf,
  projectsOf,
  rateTone,
  sentenceOf,
  sortEntries,
  tagsOf,
  tallyOf,
  tallyWords,
  type Order,
} from '../src/features/work/change-list.ts'
import { sampleWork } from '../src/features/work/sample.ts'

const scoring = (rate: number, over: Record<string, unknown> = {}) => ({
  kind: 'Feature',
  rate,
  scores: ['coverage', 'proof', 'deploy and data', 'visibility', 'rollback'].map((name) => ({ name, score: Math.round(rate), evidence: '' })),
  floors: [],
  stale: false,
  ...over,
})
const MERGE = { value: 'merge', label: 'Merge it' } as const
const change = (item: string, over: Partial<FinishedChange> = {}): FinishedChange =>
  ({
    key: `p:${item}`,
    slug: 'p',
    project: 'p',
    item,
    title: `Title ${item}`,
    grade: 'P2',
    about: 'It did a thing.',
    reason: 'It has proof.',
    left: null,
    behind: 0,
    conflict: false,
    size: { lines: 100, files: 2 },
    safety: null,
    scoring: scoring(9),
    choices: [MERGE, { value: 'diff', label: 'Show the diff' }],
    ...over,
  }) as FinishedChange
const group = (name: string, changes: FinishedChange[]): FinishedGroup => ({ name, heading: name, why: null, action: null, changes }) as FinishedGroup
const place = (layer: number, of = 3): StackPlace => ({ id: 's1', layer, of, name: null, below: null, base: null })
const keysOf = (entries: ReturnType<typeof entriesOf>) => entries.map((entry) => (entry.kind === 'stack' ? `stack[${entry.layers.map(({ change }) => change.item).join(',')}]` : entry.at.change.item))

test('every change of every group is one entry in the host order, and a stack is one entry', () => {
  const entries = entriesOf([group('merge', [change('a'), change('l2', { stack: place(2) }), change('l1', { stack: place(1) })]), group('left', [change('b')])])
  assert.deepEqual(keysOf(entries), ['a', 'stack[l1,l2]', 'b'])
})

test('the list is cut by project in the order of each project\'s first entry, with its count of changes', () => {
  const entries = entriesOf([group('merge', [change('a', { slug: 'x', project: 'X' }), change('b', { slug: 'y', project: 'Y' }), change('c', { slug: 'x', project: 'X' })])])
  const projects = projectsOf(entries)
  assert.deepEqual(projects.map(({ slug, name, count }) => [slug, name, count]), [['x', 'X', 2], ['y', 'Y', 1]])
  assert.deepEqual(projects.map(({ entries: own }) => keysOf(own)), [['a', 'c'], ['b']])
  const stacked = projectsOf(entriesOf([group('merge', [change('l1', { stack: place(1, 2) }), change('l2', { stack: place(2, 2) })])]))
  assert.equal(stacked[0]!.count, 2, 'a stack counts every layer')
})

const ordered = (order: Order, changes: FinishedChange[]) => keysOf(sortEntries(entriesOf([group('merge', changes)]), order))

test('easiest first: rated before unrated, then the higher rate, the higher priority, the smaller change, and ties keep the host order', () => {
  const list = [
    change('unrated', { scoring: null }),
    change('low', { scoring: scoring(7) }),
    change('bigger', { scoring: scoring(9), grade: 'P1', size: { lines: 300, files: 1 } }),
    change('smaller', { scoring: scoring(9), grade: 'P1', size: { lines: 20, files: 1 } }),
    change('p0', { scoring: scoring(9), grade: 'P0' }),
    change('best', { scoring: scoring(9.5), grade: 'P3' }),
    change('tie1', { scoring: scoring(6), grade: 'P2' }),
    change('tie2', { scoring: scoring(6), grade: 'P2' }),
  ]
  assert.deepEqual(ordered('easiest', list), ['best', 'p0', 'smaller', 'bigger', 'low', 'tie1', 'tie2', 'unrated'])
})

test('easiest first keeps a stack together, bottom first, at its bottom layer\'s place', () => {
  const list = [change('x', { scoring: scoring(8) }), change('l2', { stack: place(2, 2), scoring: scoring(10) }), change('l1', { stack: place(1, 2), scoring: scoring(9) })]
  assert.deepEqual(ordered('easiest', list), ['stack[l1,l2]', 'x'])
})

test('priority puts P0 first and the higher rate first among equals, unrated last', () => {
  const list = [change('a', { grade: 'P2', scoring: scoring(9) }), change('b', { grade: 'P0', scoring: scoring(6) }), change('c', { grade: 'P0', scoring: scoring(8) }), change('d', { grade: 'P0', scoring: null }), change('e', { grade: null, scoring: scoring(10) })]
  assert.deepEqual(ordered('priority', list), ['c', 'b', 'd', 'a', 'e'])
})

test('best grade puts the highest rate first and the unrated last', () => {
  const list = [change('a', { scoring: scoring(7) }), change('b', { scoring: null }), change('c', { scoring: scoring(9.4) })]
  assert.deepEqual(ordered('grade', list), ['c', 'a', 'b'])
})

test('oldest puts the longest since hobkin wrote it first, and a change with no time last', () => {
  const list = [change('new', { at: '2026-11-24T10:00:00Z' }), change('none'), change('old', { at: '2026-11-20T10:00:00Z' })]
  assert.deepEqual(ordered('oldest', list), ['old', 'new', 'none'])
})

test('smallest puts the fewest lines first, and a stack counts all its layers', () => {
  const list = [
    change('big', { size: { lines: 500, files: 1 } }),
    change('none', { size: null }),
    change('l1', { stack: place(1, 2), size: { lines: 60, files: 1 } }),
    change('l2', { stack: place(2, 2), size: { lines: 70, files: 1 } }),
    change('small', { size: { lines: 40, files: 1 } }),
  ]
  assert.deepEqual(ordered('smallest', list), ['small', 'stack[l1,l2]', 'big', 'none'])
})

test('the grades block holds the rate and the five cells, or the words for why there are none', () => {
  const graded = gradeBlockOf(change('a', { scoring: scoring(8.4, { stale: true }) }), undefined)
  assert.ok(graded.kind === 'graded')
  assert.equal(graded.rate, 8.4)
  assert.deepEqual(graded.cells.map(({ label }) => label), ['Cover', 'Proof', 'Safe', 'Watch', 'Undo'])
  assert.equal(graded.stale, true)
  const noMonitoring = gradeBlockOf(change('b', { scoring: { ...scoring(8), scores: scoring(8).scores.map((each, index) => (index === 3 ? { ...each, score: null } : each)) } }), undefined)
  assert.ok(noMonitoring.kind === 'graded' && noMonitoring.cells[3]!.score === null)
  const none = change('c', { scoring: null })
  assert.deepEqual(gradeBlockOf(none, 'running'), { kind: 'words', words: 'grading' })
  assert.deepEqual(gradeBlockOf(none, 'queued'), { kind: 'words', words: 'grading' })
  assert.deepEqual(gradeBlockOf(none, 'failed'), { kind: 'words', words: 'review failed' })
  assert.deepEqual(gradeBlockOf(none, undefined), { kind: 'words', words: 'not reviewed' })
  assert.deepEqual(gradeBlockOf(none, 'ready'), { kind: 'words', words: 'not graded' })
})

test('the rate reads good at the lowest rate or more, middling from 6, and low under it', () => {
  assert.equal(rateTone(8, 8), 'good')
  assert.equal(rateTone(7.9, 8), 'middling')
  assert.equal(rateTone(5.9, 8), 'low')
  assert.equal(rateTone(9, 9.5), 'middling')
})

test('a lowest rate that is missing or not a number is 8 in the tally and in the action', () => {
  const entries = entriesOf([group('merge', [change('a')])])
  assert.equal(tallyWords(tallyOf(entries, undefined), undefined), '1 change in 1 project. 1 graded, 1 ready to merge at 8 or more.')
  assert.equal(actionOf(change('b'), Number.NaN).kind, 'merge')
  assert.equal(rateTone(7, undefined), 'middling')
})

test('the lowest rate comes from the YOLO rules, then YOLO\'s own number, and is 8 without either', () => {
  assert.equal(lowestOf(undefined), 8)
  assert.equal(lowestOf({ lowest: 7.5 } as never), 7.5)
  assert.equal(lowestOf({ lowest: 7.5, rules: { lowestRate: 9 } } as never), 9)
  assert.equal(lowestOf({ lowest: 7.5, rules: { lowestRate: null } } as never), 7.5)
})

test('the sentence is the run\'s note first, then what stands in the way, then what the change did, then why it waits', () => {
  assert.deepEqual(sentenceOf(change('a', { left: 'Say if it may.', conflict: true })), { kind: 'note', text: 'Say if it may.' })
  assert.equal(sentenceOf(change('b', { conflict: true }))?.kind, 'way')
  assert.match(sentenceOf(change('b', { conflict: true }))!.text, /conflicts/)
  assert.match(sentenceOf(change('c', { behind: 3 }))!.text, /3 commits behind/)
  assert.match(sentenceOf(change('c1', { behind: 1 }))!.text, /1 commit behind/)
  assert.match(sentenceOf(change('d', { stack: place(3) }))!.text, /Layer 2 of its stack lands first/)
  assert.match(sentenceOf(change('e', { scoring: scoring(9, { floors: [{ name: 'rollback', score: 4, needs: 7 }] }) }))!.text, /rollback is 4, under the 7 it needs/)
  assert.match(sentenceOf(change('f', { safety: { grade: 'risky', rating: 'C', stale: false } }))!.text, /risky/)
  assert.deepEqual(sentenceOf(change('g')), { kind: 'did', text: 'It did a thing.' })
  assert.deepEqual(sentenceOf(change('h', { about: null })), { kind: 'reason', text: 'It has proof.' })
  assert.equal(sentenceOf(change('i', { about: null, reason: '' })), null)
})

test('the tags run: note, conflicts, behind, pull request trouble, then size above 300 lines', () => {
  const all = change('a', { left: 'Note.', conflict: true, behind: 4, size: { lines: 1240, files: 9 }, safety: { grade: 'risky', rating: 'C', stale: false } })
  assert.deepEqual(
    tagsOf(all, { review: 'changes-requested', checks: 'failing', draft: false }).map(({ text, tone }) => `${text}:${tone}`),
    ['left you a note:note', 'conflicts:bad', '4 behind:bad', 'changes requested:bad', 'checks fail:bad', '1,240 lines:quiet'],
  )
  assert.deepEqual(tagsOf(change('b')), [])
  assert.deepEqual(tagsOf(change('c', { size: { lines: 300, files: 1 } })), [])
  assert.deepEqual(tagsOf(change('d', { conflict: null })), [], 'a conflict nobody has checked is not a tag')
})

const REFRESH = { value: 'refreshMerge', label: 'Refresh and merge it' } as const
const REBASE = { value: 'rebase', label: 'Have an agent rebase it' } as const

test('Merge, in hobkin\'s words, only at the lowest rate or more with nothing in the way', () => {
  assert.deepEqual(actionOf(change('a'), 8), { kind: 'merge', choice: 'merge', label: 'Merge it' })
  assert.deepEqual(actionOf(change('a', { scoring: scoring(8) }), 8).kind, 'merge')
  assert.equal(actionOf(change('b', { scoring: scoring(7.9) }), 8).kind, 'review')
  assert.equal(actionOf(change('c', { scoring: null }), 8).kind, 'review')
  const pr = change('d', { choices: [{ value: 'mergePr', label: 'Merge the PR on GitHub' }] })
  assert.deepEqual(actionOf(pr, 8), { kind: 'merge', choice: 'mergePr', label: 'Merge the PR on GitHub' })
})

test('a change with something in the way is not offered Merge', () => {
  const way = [
    { left: 'A note.' },
    { stack: place(2) },
    { scoring: scoring(9, { floors: [{ name: 'proof', score: 3, needs: 5 }] }) },
    { scoring: scoring(9, { stale: true }) },
    { safety: { grade: 'risky', rating: 'C', stale: false } },
    { choices: [{ value: 'diff', label: 'Show the diff' }] },
  ]
  for (const over of way) assert.equal(actionOf(change('x', over as Partial<FinishedChange>), 8).kind, 'review', JSON.stringify(over))
  assert.equal(actionOf(change('y', { safety: { grade: 'risky', rating: 'C', stale: true } }), 8).kind, 'merge', 'a risky grade on an older commit stands aside')
})

test('Refresh code when behind or in conflict, by the change\'s own way to bring it up to date, and Review where it has none', () => {
  const behind = change('a', { behind: 2, choices: [REFRESH, MERGE] })
  assert.deepEqual(actionOf(behind, 8), { kind: 'refresh', choice: 'refreshMerge', label: 'Refresh code' })
  assert.deepEqual(actionOf(change('b', { conflict: true, choices: [REBASE] }), 8), { kind: 'refresh', choice: 'rebase', label: 'Refresh code' })
  assert.equal(actionOf(change('c', { behind: 2, choices: [MERGE] }), 8).kind, 'review')
  assert.equal(actionOf(change('d', { behind: 2, left: 'Note.', choices: [REFRESH] }), 8).kind, 'review', 'a note is read first')
  assert.equal(actionOf(change('e', { behind: 2, scoring: null, choices: [REFRESH] }), 8).kind, 'refresh', 'being behind decides it, graded or not')
})

test('the tally counts the changes, the projects, the graded and those that would merge', () => {
  const entries = entriesOf([
    group('merge', [change('a', { slug: 'x' }), change('b', { slug: 'y', scoring: null }), change('c', { slug: 'y', scoring: scoring(6) })]),
    group('left', [change('l1', { slug: 'x', stack: place(1, 2) }), change('l2', { slug: 'x', stack: place(2, 2) }), change('n', { slug: 'x', left: 'Note.' })]),
  ])
  const tally = tallyOf(entries, 8)
  assert.deepEqual(tally, { changes: 6, projects: 2, graded: 5, ready: 2 })
  assert.equal(tallyWords(tally, 8), '6 changes in 2 projects. 5 graded, 2 ready to merge at 8 or more.')
  assert.equal(tallyWords({ changes: 1, projects: 1, graded: 0, ready: 0 }, 7.5), '1 change in 1 project. 0 graded, 0 ready to merge at 7.5 or more.')
  assert.equal(tallyWords({ changes: 0, projects: 0, graded: 0, ready: 0 }, 8), 'Nothing finished waits for you.')
})

test('the sample has every part the list shows: a graded stack, notes, a conflict, behind changes and one unrated', () => {
  const entries = entriesOf(sampleWork().finished)
  const changes = entries.flatMap((entry) => (entry.kind === 'stack' ? entry.layers.map(({ change: own }) => own) : [entry.at.change]))
  assert.ok(changes.some(({ scoring: own }) => own))
  assert.ok(changes.some(({ scoring: own }) => !own))
  assert.ok(changes.some(({ left }) => left))
  assert.ok(changes.some(({ conflict }) => conflict))
  assert.ok(changes.some(({ behind }) => behind > 0))
  assert.ok(entries.some(({ kind }) => kind === 'stack'))
  assert.ok(entries.some((entry) => entry.kind === 'change' && actionOf(entry.at.change, 8).kind === 'merge'))
})

test('a change of one line reads "1 line", and any other size reads in lines', () => {
  assert.equal(linesOf(1), '1 line')
  assert.equal(linesOf(2), '2 lines')
  assert.equal(linesOf(0), '0 lines')
  assert.equal(linesOf(1200), '1,200 lines')
})
