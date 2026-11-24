import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readNeeds, readNeedsList } from '../review/needs.ts'
import { readCarried, readOutdated, readRepoLines, readTurn } from '../review/status.ts'

const HEAD = 'a'.repeat(40)
const score = (value: number, evidence = 'A line of evidence.') => ({ score: value, evidence })

test("a review's ratings are read without trust: whole scores from 1 to 10 with a line of evidence, a known kind, a full commit and who made them", () => {
  const sent = {
    kind: 'bug-fix',
    scores: { coverage: score(8), proof: score(6), safety: score(9), rollback: score(7) },
    missing: 'A test of the empty cart.',
    floors: [{ name: 'proof', score: 6, needs: 7 }],
    head: HEAD,
    by: 'change-review',
    at: '2026-11-23T10:00:00.000Z',
  }

  assert.deepEqual(readNeeds(sent), sent, 'visibility left out: no monitoring is known')
  assert.deepEqual(readNeeds({ ...sent, rate: 7.5 })?.rate, 7.5)
  assert.deepEqual([readNeeds({ ...sent, monitoring: 'unknown' })?.monitoring, readNeeds({ ...sent, monitoring: 'maybe' })?.monitoring], ['unknown', undefined])

  // A score that is no whole number from 1 to 10, or has no evidence, is dropped; the others stay.
  const odd = readNeeds({ ...sent, scores: { coverage: score(11), proof: score(6.5), safety: score(9, ''), rollback: score(7, 'one\ntwo'), visibility: score(5) } })
  assert.deepEqual(odd?.scores, { visibility: score(5) })
  // Without a full commit or a maker, they cannot be placed, so none are read.
  for (const wrong of [{ ...sent, head: 'abc1234' }, { ...sent, by: 'someone' }, 'nothing', null]) assert.equal(readNeeds(wrong), undefined, JSON.stringify(wrong))
  assert.equal(readNeeds({ ...sent, kind: 'a guess' })?.kind, undefined)
  assert.deepEqual(readNeeds({ ...sent, floors: [{ name: 'speed', score: 1, needs: 5 }, { name: 'safety', score: 4, needs: 8 }] })?.floors, [{ name: 'safety', score: 4, needs: 8 }])
  assert.deepEqual(readNeedsList([sent, 'junk', { ...sent, by: 'hobkin' }]).map((needs) => needs.by), ['change-review', 'hobkin'])
  assert.deepEqual(readNeedsList(undefined), [])
})

test("a row's turn, its outdated mark, a carried review and the list's line for each repository are read without trust", () => {
  assert.deepEqual(readTurn({ ahead: 3, why: 'Waits its turn: 3 ahead in shop.' }), { ahead: 3, why: 'Waits its turn: 3 ahead in shop.' })
  assert.equal(readTurn({ ahead: -1, why: 'x' }), undefined)
  assert.deepEqual(readOutdated({ builtFor: 'b'.repeat(40) }), { builtFor: 'b'.repeat(40) })
  assert.equal(readOutdated({ builtFor: 'not a commit' }), undefined)
  assert.deepEqual(readCarried({ from: 'c'.repeat(40), why: 'Only the start moved.' }), { from: 'c'.repeat(40), why: 'Only the start moved.' })
  assert.equal(readCarried({ from: 'c'.repeat(40) }), undefined)
  const line = { project: 'shop', current: 3, waiting: 12, outdated: 2, builtThisWeek: 9, tokensThisWeek: 1_100_000 }
  assert.deepEqual(readRepoLines([line, { ...line, project: '', current: 1 }, { project: 'acme/api', current: 1, waiting: 0, outdated: 0, builtThisWeek: 1 }]), [line, { project: 'acme/api', current: 1, waiting: 0, outdated: 0, builtThisWeek: 1 }])
  assert.deepEqual(readRepoLines(undefined), [], 'a list from an older host has none')
})
