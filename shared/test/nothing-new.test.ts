import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNothingNewReport, withoutNothingNew } from '../reports/nothing-new.ts'

test('a report whose whole text is Nothing new is a nothing-new report', () => {
  for (const text of ['Nothing new.', 'Nothing new', '  nothing new.\n', 'NOTHING NEW.', '**Nothing new.**', '**Nothing new**.']) {
    assert.equal(isNothingNewReport(text), true, JSON.stringify(text))
  }
})

test('a report that says more, or something else, is a real report', () => {
  for (const text of ['Nothing new. The build is green.', 'Nothing new.\n\nBut the deploy is late.', 'Useful: Nothing new.', 'Nothing newer.', '', 'Nothing']) {
    assert.equal(isNothingNewReport(text), false, JSON.stringify(text))
  }
  assert.equal(isNothingNewReport(undefined), false)
  assert.equal(isNothingNewReport(null), false)
})

test('withoutNothingNew drops nothing-new reports and keeps the rest in order', () => {
  const rows = [{ id: 'a', body: 'Nothing new.' }, { id: 'b', body: 'Critical: Down.' }, { id: 'c', body: 'nothing new' }, { id: 'd' }]
  assert.deepEqual(withoutNothingNew(rows).map(({ id }) => id), ['b', 'd'])
})
