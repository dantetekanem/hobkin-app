import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { addIssue } from 'hobkin/src/cli/work/issues.mjs'
import { chooseProject, fileItem, updateItem } from 'hobkin/src/cli/work/store.mjs'
import { toPrepare } from '../src/review/seat.ts'
import { workFrom } from '../src/work.ts'
import { workReader } from '../src/work-items.ts'
import { temporaryDirectory } from './support.ts'

/** A home of the test's with one project taken. Nothing in it is ever fetched or run. */
function homeWithProject(t: TestContext) {
  const base = temporaryDirectory(t)
  const root = join(base, 'home')
  const folder = join(base, 'web')
  mkdirSync(folder, { recursive: true })
  const { slug } = chooseProject(root, folder, 'important')
  return { root, slug }
}

/** An item hobkin filed from a GitHub issue, by its own issue action, and one filed by hand. */
function fileBoth(root: string, slug: string) {
  const { id: fromIssue } = addIssue(root, slug, { repo: 'acme/web', number: 75, title: 'Idle then hide sends no stop', url: 'https://github.com/acme/web/issues/75' })
  const { id: byHand } = fileItem(root, slug, { key: 'by-hand', kind: 'improvement', title: 'Tidy the cart', brief: 'Tidy the cart.' })
  return { fromIssue, byHand }
}

/** hobkin's work status as its snapshot carries it, with only what a test needs to say. */
const status = (rest: Record<string, unknown> = {}) => ({ enabled: true, folder: '/Users/someone/code', agents: 2, agentsAllowed: 2, queued: 0, plan: [], projects: [], ...rest })

/** A row of hobkin's finished work (`readyRow` in its `src/cli/work/reads.mjs`), as `waiting.branches` and `waiting.yours` carry it. */
const finished = (slug: string, item: string, rest: Record<string, unknown> = {}) => ({
  slug,
  project: 'web',
  item,
  title: `Work ${item}`,
  grade: 'P1',
  branch: `hobkin/${item}-work`,
  head: `${item}${'0'.repeat(34)}`,
  about: 'What it did.',
  proof: 'pnpm test passes',
  left: null,
  behind: 0,
  conflict: false,
  size: { additions: 10, deletions: 2, files: 2 },
  safety: null,
  gap: 'land',
  holds: 0,
  proved: true,
  ...rest,
})

const planRow = (slug: string, item: string) => ({ key: `item:${slug}:${item}`, kind: 'item', slug, project: 'web', item, title: `Work ${item}`, grade: 'P1', why: 'important' })

const cards = (work: ReturnType<ReturnType<typeof workReader>>) => (work?.finished ?? []).flatMap(({ changes }) => changes)

test('a finished card and a queue row carry the GitHub issue their item was filed from, and one filed by hand carries none', (t) => {
  const { root, slug } = homeWithProject(t)
  const { fromIssue, byHand } = fileBoth(root, slug)
  updateItem(root, slug, byHand, { pr: 'https://github.com/acme/web/pull/78' })
  const read = workReader(() => root)

  const work = read({
    work: status({ plan: [planRow(slug, fromIssue), planRow(slug, byHand)] }),
    waiting: { branches: [finished(slug, fromIssue), finished(slug, byHand)] },
  })

  const issue ={ repo: 'acme/web', number: 75, url: 'https://github.com/acme/web/issues/75' }
  assert.deepEqual(
    cards(work).map(({ item, issue }) => [item, issue]),
    [
      [fromIssue, issue],
      [byHand, null],
    ],
  )
  assert.deepEqual(
    work!.queue.map(({ item, issue, pr }) => [item, issue, pr]),
    [
      [fromIssue, issue, null],
      [byHand, null, 'https://github.com/acme/web/pull/78'],
    ],
    "a queue row also has its item's pull request, once it has one",
  )
})

test('a finished branch whose run left a note is a Left for you card: the note whole, Review and Close without merging, and no merge', (t) => {
  const { root, slug } = homeWithProject(t)
  const { fromIssue, byHand } = fileBoth(root, slug)
  const note = 'The assigned smoke proof remains unfinished. It needs your word for a disposable browser launch.'
  const leftOne = finished(slug, fromIssue, { left: note, behind: 14 })
  const yours = [
    leftOne,
    // A step only the user can take has no branch, so it is not finished work and has no card here.
    { kind: 'item', slug, project: 'web', item: byHand, title: 'Sign in to the registry', reason: 'Only you can sign in.', answer: 'hobkin work done' },
  ]

  const work = workReader(() => root)({ work: status(), waiting: { branches: [], yours } })

  const left = work!.finished.find(({ name }) => name === 'left')!
  assert.equal(left.heading, 'Left for you')
  assert.equal(left.action, null, 'no group yes carries what a run left for the user')
  assert.deepEqual(
    left.changes.map(({ key }) => key),
    [`${slug}:${fromIssue}`],
  )
  const [card] = left.changes
  assert.equal(card!.left, note)
  assert.deepEqual(card!.issue, { repo: 'acme/web', number: 75, url: 'https://github.com/acme/web/issues/75' })
  assert.deepEqual(
    card!.choices.map(({ value, label }) => [value, label]),
    [
      ['diff', 'Show the diff'],
      ['done', 'Close without merging'],
    ],
  )
  assert.match(card!.yes, /nothing merges/i, 'the card says what closing it does')
  assert.equal(card!.head, leftOne.head, 'Review opens it at the commit the card shows')

  // With a pull request, it can be opened there too. A branch hobkin already lists in a group is not shown twice.
  const withPr = workReader(() => root)({
    work: status(),
    waiting: {
      branches: [finished(slug, byHand)],
      yours: [{ ...leftOne, pr: 'https://github.com/acme/web/pull/81' }, finished(slug, byHand, { left: 'Also left.' })],
    },
  })
  const again = withPr!.finished.find(({ name }) => name === 'left')!
  assert.deepEqual(
    again.changes.map(({ item, choices }) => [item, choices.map(({ value }) => value)]),
    [[fromIssue, ['diff', 'open', 'done']]],
  )
  assert.equal(cards(withPr).filter(({ item }) => item === byHand).length, 1)

  // Nothing left for the user, and there is no Left for you group at all.
  assert.equal(workReader(() => root)({ work: status(), waiting: { branches: [], yours: [yours[1]] } })!.finished.length, 0)
})

test('Change Review prepares by itself every finished change, a Left for you card too, since its run leaving a note is no reason to go unrated', (t) => {
  const { root, slug } = homeWithProject(t)
  const { fromIssue, byHand } = fileBoth(root, slug)
  const work = workReader(() => root)({
    work: status(),
    waiting: { branches: [finished(slug, byHand)], yours: [finished(slug, fromIssue, { left: 'A note.' })] },
  })

  assert.deepEqual(
    toPrepare(work).map(({ id }) => id),
    [`change:${slug}:${byHand}`, `change:${slug}:${fromIssue}`],
    'both cards are prepared by themselves',
  )
})

test('what the user said yes to that is still being brought up to date is listed until it merges', (t) => {
  const { root, slug } = homeWithProject(t)
  const { fromIssue, byHand } = fileBoth(root, slug)
  const said = '2026-11-12T23:11:00.000Z'
  updateItem(root, slug, fromIssue, { workNote: 'Bring this branch up to date.', mergeWhenFresh: { at: said, read: 'none', readMs: 0 } })
  const { id: reviewed } = fileItem(root, slug, { key: 'reviewed', kind: 'fix', title: 'Fix the cart total', brief: 'Fix it.' })
  const closing = [
    { slug, project: 'web', item: fromIssue, title: `Work ${fromIssue}`, branch: `hobkin/${fromIssue}-work`, doing: 'working on your note' },
    // Work mode was off, so the main agent's session does the refresh and the merge.
    { slug, project: 'web', item: byHand, title: `Work ${byHand}`, branch: `hobkin/${byHand}-work`, doing: 'refreshing it, then merging it' },
    // A review the user asked for is not a yes to merge.
    { slug, project: 'web', item: reviewed, title: 'Fix the cart total', branch: `hobkin/${reviewed}-work`, doing: 'reviewing it' },
  ]

  const work = workReader(() => root)({ work: status({ closing }), waiting: { branches: [] } })

  assert.deepEqual(
    work!.merging!.map(({ key, since, handedOff, issue }) => [key, since, handedOff, issue?.number ?? null]),
    [
      [`${slug}:${fromIssue}`, said, false, 75],
      [`${slug}:${byHand}`, null, true, null],
    ],
  )
  assert.deepEqual(workReader(() => root)({ work: status(), waiting: null })!.merging, [], 'a hobkin that lists nothing closing has nothing merging')
})

test('the items are read once for each snapshot of the work, and a home that cannot be read leaves the work as hobkin drew it', (t) => {
  const { root, slug } = homeWithProject(t)
  const { fromIssue } = fileBoth(root, slug)
  let reads = 0
  const read = workReader(() => {
    reads += 1
    return root
  })
  const snapshot = { work: status({ plan: [planRow(slug, fromIssue)] }), waiting: { branches: [finished(slug, fromIssue)] } }

  const first = read(snapshot)
  assert.equal(read({ ...snapshot, messages: [] }), first, 'a snapshot with the same work and the same waiting rows reads nothing again')
  assert.equal(reads, 1)
  assert.notEqual(read({ ...snapshot, work: status({ plan: [planRow(slug, fromIssue)] }) }), first, 'new work is read again')

  const unreadable = workReader(() => {
    throw new Error('hobkin is not open')
  })(snapshot)
  assert.deepEqual(
    unreadable!.finished.map(({ name, changes }) => [name, changes.map(({ key }) => key)]),
    workFrom(snapshot)!.finished.map(({ name, changes }) => [name, changes.map(({ key }) => key)]),
  )
  assert.deepEqual([...cards(unreadable), ...unreadable!.queue].map(({ issue }) => issue), [null, null], 'without its items nothing says which issue it came from')
  assert.equal(read({ reports: [] }), null, 'a view the terminal saved has no work mode in it')
})
