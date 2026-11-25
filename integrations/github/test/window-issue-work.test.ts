import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sampleGitHub, type IssueWork } from '../protocol.ts'
import type { FinishedGroupName, WorkState } from '#shared/protocol/work.ts'
import { issueChip, JUST_ADDED, placeOnWork, type WorkPlace } from '../window/issue-work.ts'
import { sampleWork } from '../../../ui/src/features/work/sample.ts'

const filed = (state: string, pr: string | null = null): IssueWork => ({ slug: 'storefront', project: 'storefront', item: 'caa304', state, pr })
const card = (group: FinishedGroupName): WorkPlace => ({ on: 'card', group })
const CARD = '[data-change="storefront:caa304"]'

test("a filed issue's chip says what its hobkin item waits on, and leads to where the user can act on it", () => {
  // Every finished state reads the same at the same card.
  const chipsAt = (place: WorkPlace) => ['branch', 'pr', 'waiting'].map((state) => issueChip(filed(state), place))
  const leadsToCard = (label: string) => ({ label, tone: 'warn', target: CARD })

  // A run that left a note: the note is on its Left for you card.
  for (const chip of chipsAt(card('left'))) assert.deepEqual(chip, leadsToCard('Read its note'))
  // A group's one yes merges it, or brings it up to date and merges it.
  for (const chip of [...chipsAt(card('merge')), ...chipsAt(card('refresh'))]) assert.deepEqual(chip, leadsToCard('Approve its change'))
  // Something holds it back from one yes, and its card says what.
  for (const chip of chipsAt(card('needs'))) assert.deepEqual(chip, leadsToCard('Review its change'))
  // The user said yes, and it is being brought up to date before it merges: nothing waits on them, and Work shows no card for it.
  assert.deepEqual(issueChip(filed('open'), { on: 'merging' }), { label: 'Merging after your yes', tone: 'live', target: null })
})

test('a chip with nowhere to go on the Work screen is never a call to act', () => {
  const places: WorkPlace[] = [null, { on: 'queue' }, { on: 'merging' }, card('left'), card('needs'), card('merge'), card('refresh')]
  for (const state of ['open', 'stuck', 'doing', 'waiting', 'branch', 'pr', 'merged', 'done', 'declined', 'dropped', 'noted']) {
    for (const place of places) {
      const chip = issueChip(filed(state), place)
      if (!chip.target) assert.notEqual(chip.tone, 'warn', `${state} at ${JSON.stringify(place)}`)
    }
  }
  // Finished work the Work screen has no card for says it is finished, and nothing more.
  assert.deepEqual(issueChip(filed('branch'), null), { label: 'Finished', tone: 'quiet', target: null })
  assert.deepEqual(issueChip(filed('pr', 'https://github.com/acme/web/pull/7'), null), { label: 'PR open', tone: 'ok', target: null })
  assert.deepEqual(issueChip(filed('waiting'), null), { label: 'Filed', tone: 'quiet', target: null })
})

test('the other states say where the item stands, and a queued one opens its row while the queue lists it', () => {
  const words = Object.fromEntries(['open', 'stuck', 'doing', 'merged', 'done', 'declined', 'dropped', 'noted'].map((state) => [state, issueChip(filed(state), null).label]))
  assert.deepEqual(words, {
    open: 'In queue',
    stuck: 'In queue',
    doing: 'Working',
    // A merge is the work done: hobkin closes the issue as it merges.
    merged: 'Done',
    done: 'Done',
    declined: 'Declined',
    dropped: 'Dropped',
    noted: 'Filed',
  })
  assert.equal(issueChip(filed('open'), { on: 'queue' }).target, '[data-queue-row="item:storefront:caa304"]')
  assert.equal(issueChip(filed('open'), null).target, null)
})

test('merged work on a project that deploys says it waits for its deploy, since its issue stays open until a deploy that carries it holds', () => {
  const merged = (deploy?: string | null) => issueChip({ ...filed('merged'), deploy }, null)

  // Merged since the last deploy, or carried by one that regressed: the next calm deploy closes it.
  for (const deploy of ['waiting', 'regressed']) assert.deepEqual(merged(deploy), { label: 'Merged, waits for deploy', tone: 'quiet', target: null }, deploy)
  assert.deepEqual(merged('deploying'), { label: 'Deploying', tone: 'live', target: null })
  // Live, a project that does not deploy, or a host older than the deploy field: the merge is the work done.
  for (const deploy of ['live', null, undefined]) assert.equal(merged(deploy).label, 'Done', String(deploy))
  assert.equal(issueChip({ ...filed('done'), deploy: 'waiting' }, null).label, 'Done', 'only a merge waits for a deploy')
})

test('right after Add to queue it says Added to queue, until its item moves on from the queue', () => {
  assert.equal(JUST_ADDED.label, 'Added to queue')
  assert.equal(issueChip(filed('open'), { on: 'queue' }, true).label, 'Added to queue')
  assert.equal(issueChip(filed('doing'), null, true).label, 'Working')
})

test('where the Work screen shows an item is read from the work it draws', () => {
  const work = sampleWork()
  const place = (key: string) => {
    const [slug, item] = key.split(':') as [string, string]
    return placeOnWork(work, slug, item)
  }
  for (const group of work.finished) {
    for (const { key } of group.changes) assert.deepEqual(place(key), { on: 'card', group: group.name }, key)
  }
  for (const { key } of work.merging ?? []) assert.deepEqual(place(key), { on: 'merging' }, key)
  for (const { slug, item } of work.queue) {
    if (slug && item) assert.deepEqual(placeOnWork(work, slug, item), { on: 'queue' }, `${slug}:${item}`)
  }
  assert.equal(placeOnWork(work, 'storefront', 'nothing'), null)
  assert.equal(placeOnWork(null, 'storefront', 'd2c4e8'), null, 'before the host has said anything about work mode')
  const older: WorkState = { ...work, merging: undefined }
  assert.doesNotThrow(() => placeOnWork(older, 'storefront', 'd2c4e8'), 'a host older than the merging rows')
})

test('the sample shows every chip, one issue with nothing filed, and every chip that leads somewhere finds its place in the Work sample', () => {
  const issues = sampleGitHub(Date.parse('2026-11-12T12:00:00Z')).issues
  const work = sampleWork()
  const chipOf = (filedFor: IssueWork) => issueChip(filedFor, placeOnWork(work, filedFor.slug, filedFor.item))
  assert.deepEqual(issues.map(({ work: filedFor }) => (filedFor ? chipOf(filedFor).label : 'Add to queue')).toSorted(), [
    'Add to queue',
    'Approve its change',
    'Approve its change',
    'Declined',
    'Done',
    'In queue',
    'Merged, waits for deploy',
    'Read its note',
    'Working',
  ])

  const places = new Set([
    ...work.queue.map(({ key }) => `[data-queue-row="${key}"]`),
    ...work.finished.flatMap(({ changes }) => changes).map(({ key }) => `[data-change="${key}"]`),
  ])
  for (const { work: filedFor } of issues) {
    const target = filedFor ? chipOf(filedFor).target : null
    if (target) assert.ok(places.has(target), target)
  }
})
