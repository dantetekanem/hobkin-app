import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sampleGitHub, type IssueWork } from '#shared/protocol/github.ts'
import { issueChip, JUST_ADDED } from '../src/features/github/issue-work.ts'
import { sampleWork } from '../src/features/work/sample.ts'

const filed = (state: string, pr: string | null = null): IssueWork => ({ slug: 'storefront', project: 'storefront', item: 'caa304', state, pr })

test("a filed issue's chip says where its hobkin item stands, in plain words", () => {
  const words = Object.fromEntries(['open', 'stuck', 'doing', 'waiting', 'branch', 'pr', 'merged', 'done', 'declined', 'dropped', 'noted'].map((state) => [state, issueChip(filed(state)).label]))
  assert.deepEqual(words, {
    open: 'In queue',
    stuck: 'In queue',
    doing: 'Working',
    waiting: 'Waiting for you',
    branch: 'Waiting for you',
    pr: 'PR open',
    merged: 'Merged',
    done: 'Done',
    declined: 'Declined',
    dropped: 'Dropped',
    noted: 'Filed',
  })
})

test('right after Add to queue it says Added to queue, until its item moves on from the queue', () => {
  assert.equal(JUST_ADDED.label, 'Added to queue')
  assert.equal(issueChip(filed('open'), true).label, 'Added to queue')
  assert.equal(issueChip(filed('doing'), true).label, 'Working')
})

test('the chip opens the item on the Work screen where Work shows it: its row in the queue, or its finished card', () => {
  assert.equal(issueChip(filed('open')).target, '[data-queue-row="item:storefront:caa304"]')
  assert.equal(issueChip(filed('branch')).target, '[data-change="storefront:caa304"]')
  assert.equal(issueChip(filed('pr', 'https://github.com/acme/web/pull/7')).target, '[data-change="storefront:caa304"]')
  for (const state of ['doing', 'waiting', 'merged', 'done', 'declined', 'dropped']) assert.equal(issueChip(filed(state)).target, null, state)
})

test('the sample shows every chip, one issue with nothing filed, and the items it links to are in the Work sample', () => {
  const issues = sampleGitHub(Date.parse('2026-11-12T12:00:00Z')).issues
  assert.deepEqual(issues.map(({ work }) => (work ? issueChip(work).label : 'Add to queue')).toSorted(), ['Add to queue', 'Declined', 'Done', 'In queue', 'Merged', 'PR open', 'Waiting for you', 'Working'])

  const work = sampleWork()
  const rows = new Set(work.queue.map(({ key }) => `[data-queue-row="${key}"]`))
  const cards = new Set(work.finished.flatMap(({ changes }) => changes).map(({ key }) => `[data-change="${key}"]`))
  for (const { work: filedFor } of issues) {
    const target = filedFor ? issueChip(filedFor).target : null
    if (target) assert.ok(rows.has(target) || cards.has(target), target)
  }
})
