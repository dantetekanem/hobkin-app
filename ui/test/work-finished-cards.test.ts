import assert from 'node:assert/strict'
import { test } from 'node:test'
import { endAtWord, needsFirst } from '../src/features/work/finished-cards.ts'
import { sampleWork } from '../src/features/work/sample.ts'

test('the finished changes that need the user come first, then what runs left for them, and the other groups keep hobkin order', () => {
  const groups = sampleWork().finished
  assert.deepEqual(groups.map(({ name }) => name), ['merge', 'refresh', 'needs', 'left'], 'the host sends them in this order')
  assert.deepEqual(needsFirst(groups).map(({ name }) => name), ['needs', 'left', 'merge', 'refresh'])
  assert.deepEqual(needsFirst(groups.filter(({ name }) => name !== 'needs')).map(({ name }) => name), ['left', 'merge', 'refresh'])
})

// A proof as a hobkin from before it sent proofs whole sent one to a card on 2026-11-12: its first 260 characters, cut inside "required".
const CUT_BY_AN_OLDER_HOBKIN =
  'Before-edit graph check failed on Pi0.74.0; baseline pnpm-imported audit returned61 records (23high/29moderate/9low), all dev. Final audit exits0/no advisories; named Pi advisories absent and extract-zip removed. Native lock validation155nodes/no invalid requi'

test('a proof an older hobkin cut at 260 characters inside a word ends at the last whole word, with an ellipsis', () => {
  assert.equal(CUT_BY_AN_OLDER_HOBKIN.length, 260)
  const shown = endAtWord(CUT_BY_AN_OLDER_HOBKIN)
  assert.ok(shown.endsWith('Native lock validation155nodes/no invalid…'), shown)
  assert.ok(!shown.includes('requi'))
})

test('a line hobkin or the host cut at a word stays as it came, and a whole line stays as it is, however long', () => {
  assert.equal(endAtWord('Each merges at the commit its card showed, or not at…'), 'Each merges at the commit its card showed, or not at…')
  assert.equal(endAtWord('pnpm test checkout: 52 pass'), 'pnpm test checkout: 52 pass')
  const whole = `${'All 157 tests pass on Node 22. '.repeat(30)}Nothing pushed`
  assert.ok(whole.length > 260)
  assert.equal(endAtWord(whole), whole, 'hobkin sends a proof whole now, so a long one that ends without a stop was not cut')
})
